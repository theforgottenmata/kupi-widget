/**
 * Stahování stránek z Kupi.cz.
 *
 * Slušné chování: sekvenčně, pauza mezi requesty, rozumný User-Agent.
 * Při 10–20 produktech je to pár desítek requestů denně.
 */

const BASE_URL = 'https://www.kupi.cz/sleva/';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export const REQUEST_DELAY_MS = 1_500;
const TIMEOUT_MS = 20_000;
const RETRIES = 1;

export function slugUrl(slug: string): string {
  return BASE_URL + encodeURIComponent(slug);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, slug: string) {
    super(`${slug}: HTTP ${status}`);
    this.status = status;
    this.name = 'HttpError';
  }
}

async function fetchOnce(slug: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(slugUrl(slug), {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'cs,en;q=0.8',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new HttpError(response.status, slug);
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
