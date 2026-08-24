/**
 * Stahování stránek z Kupi.cz.
 *
 * Slušné chování: sekvenčně, pauza mezi requesty, rozumný User-Agent.
 * Při 10–20 produktech je to pár desítek requestů denně.
 *
 * Hlavičky jsou schválně kompletní sada, jakou posílá skutečný prohlížeč.
 * Holý fetch() bez nich vypadá jako bot a Kupi ho odmítá.
 */

const BASE_URL = 'https://www.kupi.cz/sleva/';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const BROWSER_HEADERS: Record<string, string> = {
  'user-agent': USER_AGENT,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.8',
  'accept-encoding': 'gzip, deflate, br',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  referer: 'https://www.kupi.cz/',
};

export const REQUEST_DELAY_MS = 1_500;
const TIMEOUT_MS = 20_000;
const RETRIES = 1;

export function slugUrl(slug: string): string {
  return BASE_URL + encodeURIComponent(slug);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chyba HTTP i s tělem odpovědi a diagnostickými hlavičkami.
 *
 * Bez těla se 403 nedá odladit — potřebujeme vidět, jestli jde o Cloudflare
 * challenge, blokaci celého rozsahu IP, nebo něco jiného.
 */
export class HttpError extends Error {
  status: number;
  slug: string;
  body: string;
  diagnostics: Record<string, string>;

  constructor(status: number, slug: string, body: string, diagnostics: Record<string, string>) {
    super(`${slug}: HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.slug = slug;
    this.body = body;
    this.diagnostics = diagnostics;
  }
}

const DIAGNOSTIC_HEADERS = [
  'server',
  'content-type',
  'cf-ray',
  'cf-mitigated',
  'cf-cache-status',
  'x-served-by',
  'retry-after',
  'location',
];

async function fetchOnce(slug: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(slugUrl(slug), {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      const diagnostics: Record<string, string> = {};
      for (const header of DIAGNOSTIC_HEADERS) {
        const value = response.headers.get(header);
        if (value) diagnostics[header] = value;
      }
      let body = '';
      try {
        body = await response.text();
      } catch {
        body = '(tělo odpovědi se nepodařilo přečíst)';
      }
      throw new HttpError(response.status, slug, body, diagnostics);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Stáhne HTML jednoho slugu. Jeden retry na síťovou chybu nebo 5xx. */
export async function fetchSlug(slug: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await fetchOnce(slug);
    } catch (error) {
      lastError = error;
      const retriable = !(error instanceof HttpError) || error.status >= 500;
      if (!retriable || attempt === RETRIES) break;
      await sleep(3_000);
    }
  }
  throw lastError;
}

export interface FetchedPage {
  slug: string;
  html: string;
}

/** Sekvenčně stáhne všechny slugy. Chyby propadnou volajícímu jako výjimka. */
export async function fetchAll(
  slugs: string[],
  log: (message: string) => void = () => {},
): Promise<FetchedPage[]> {
  const pages: FetchedPage[] = [];
  for (const [index, slug] of slugs.entries()) {
    if (index > 0) await sleep(REQUEST_DELAY_MS);
    log(`  GET /sleva/${slug}`);
    pages.push({ slug, html: await fetchSlug(slug) });
  }
  return pages;
}
