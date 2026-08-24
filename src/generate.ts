/**
 * Vstupní bod. Přečte watchlist, stáhne stránky, vygeneruje deals.json.
 *
 * Spuštění:
 *   npm run generate              ostrý běh proti Kupi.cz
 *   npm run generate -- --dry     nic nezapíše, jen vypíše výsledek
 *   npm run generate -- --fixtures  běh nad fixtures/, bez sítě
 *
 * Klíčové pravidlo: při jakémkoli podezření na rozbitý výstup se deals.json
 * NEPŘEPÍŠE a proces skončí nenulovým kódem. Poslední funkční data zůstanou.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { todayInPrague } from './dates.ts';
import { normalizeProduct, compareDeals, markBest } from './normalize.ts';
import { parseProductPage } from './parse.ts';
import { fetchAll } from './scrape.ts';
import type { Deal, DealsFile, LdOffer, RawOffer, WatchedProduct } from './types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WATCHLIST_PATH = path.join(ROOT, 'watchlist.json');
const DEALS_PATH = path.join(ROOT, 'deals.json');
const FIXTURES_DIR = path.join(ROOT, 'fixtures');
const DEBUG_DIR = path.join(ROOT, '.debug');

/**
 * Uložení staženého HTML pro ladění. Zapíná se proměnnou KUPI_SAVE_HTML=1
 * (nastavuje ji GitHub Action a nahrává složku jako artifact i při selhání).
 * Bez toho by se parser po rozbití nedal doladit — stránka už bude jiná.
 */
async function saveDebugHtml(slug: string, html: string): Promise<void> {
  if (process.env.KUPI_SAVE_HTML !== '1') return;
  await mkdir(DEBUG_DIR, { recursive: true });
  await writeFile(path.join(DEBUG_DIR, `${slug}.html`), html, 'utf8');
}

export interface SanityVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Ochrana existujícího deals.json.
 *
 * Nestačí hlídat nulu — když parser částečně praskne, spadne počet nabídek
 * skokově (28 -> 2) a to je stejně podezřelé jako nula.
 *
 * Pozor: nula nabídek u JEDNOHO produktu je normální stav, na Kupi to je běžné.
 * Hlídáme proto celkový součet, ne jednotlivé produkty.
 */
export function sanityCheck(next: Deal[], previous: Deal[] | undefined, errors: string[]): SanityVerdict {
  if (errors.length > 0) {
    return { ok: false, reason: `chyby při stahování/parsování:\n  - ${errors.join('\n  - ')}` };
  }
  if (!previous || previous.length === 0) {
    return { ok: true }; // první běh nebo prázdná historie: není proti čemu měřit
  }
  if (next.length === 0) {
    return { ok: false, reason: `0 nabídek, minule ${previous.length}` };
  }
  if (previous.length >= 5 && next.length < previous.length * 0.5) {
    return { ok: false, reason: `propad počtu nabídek: ${previous.length} -> ${next.length}` };
  }
  return { ok: true };
}

async function readWatchlist(): Promise<WatchedProduct[]> {
  const raw = JSON.parse(await readFile(WATCHLIST_PATH, 'utf8')) as WatchedProduct[];
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('watchlist.json je prázdný nebo není pole');
  return raw.filter((product) => product.enabled !== false);
}

async function readPreviousDeals(): Promise<Deal[] | undefined> {
  if (!existsSync(DEALS_PATH)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(DEALS_PATH, 'utf8')) as DealsFile;
    return Array.isArray(parsed.deals) ? parsed.deals : undefined;
  } catch {
    return undefined;
  }
}

async function loadPages(
  slugs: string[],
  useFixtures: boolean,
  log: (message: string) => void,
): Promise<Array<{ slug: string; html: string }>> {
  if (!useFixtures) {
    const fetched = await fetchAll(slugs, log);
    for (const page of fetched) await saveDebugHtml(page.slug, page.html);
    return fetched;
  }
  const pages = [];
  for (const slug of slugs) {
    const file = path.join(FIXTURES_DIR, `${slug}.html`);
    if (!existsSync(file)) {
      log(`  přeskakuji ${slug} (chybí fixture)`);
      continue;
    }
    pages.push({ slug, html: await readFile(file, 'utf8') });
  }
  return pages;
}

export async function generate(options: { dry?: boolean; fixtures?: boolean } = {}): Promise<number> {
  const log = (message: string) => console.log(message);
  const today = todayInPrague();
  const watchlist = await readWatchlist();
  const errors: string[] = [];
  const allDeals: Deal[] = [];

  log(`Dnešek (Praha): ${today}`);
  log(`Sleduji ${watchlist.length} produktů\n`);

  for (const product of watchlist) {
    const offers: RawOffer[] = [];
    const ldOffers: LdOffer[] = [];

    let pages: Array<{ slug: string; html: string }> = [];
    try {
      pages = await loadPages(product.slugs, options.fixtures === true, log);
    } catch (error) {
      errors.push(`${product.name}: ${(error as Error).message}`);
      continue;
    }

    for (const page of pages) {
      const parsed = parseProductPage(page.html);
      if (!parsed.isProductPage) {
        // Buď špatný slug (kategorie místo produktu), nebo změna HTML.
        // Obojí chceme vidět jako chybu, ne jako nula nabídek.
        errors.push(`${product.name}: /sleva/${page.slug} není detail produktu`);
        continue;
      }
      offers.push(...parsed.offers);
      ldOffers.push(...parsed.ldOffers);
    }

    const deals = normalizeProduct({ product, offers, ldOffers, today });
    allDeals.push(...deals);
    log(`  ${product.name}: ${deals.length} nabídek (z ${offers.length} řádků)`);
  }

  allDeals.sort(compareDeals);
  markBest(allDeals);

  const previous = await readPreviousDeals();
  const verdict = sanityCheck(allDeals, previous, errors);

  log('');
  if (!verdict.ok) {
    console.error(`SANITY CHECK NEPROŠEL: ${verdict.reason}`);
    console.error('deals.json zůstává beze změny.');
    return 1;
  }

  const output: DealsFile = {
    updatedAt: new Date().toISOString(),
    deals: allDeals,
  };

  if (options.dry) {
    log(JSON.stringify(output, null, 2));
    log(`\n(dry run — nezapisuji)`);
    return 0;
  }

  await writeFile(DEALS_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  log(`Zapsáno ${allDeals.length} nabídek do deals.json`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = new Set(process.argv.slice(2));
  generate({ dry: args.has('--dry'), fixtures: args.has('--fixtures') })
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
