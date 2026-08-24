/**
 * Práce s českými datumy z Kupi.cz.
 *
 * Kupi v DOM neuvádí rok — píše "pá 28. 8. – ne 30. 8." nebo "platí do středy 26. 8.",
 * někdy jen "dnes končí" / "zítra končí". Rok proto odvozujeme vůči dnešku.
 *
 * Datum reprezentujeme jako string "YYYY-MM-DD". Veškerá aritmetika běží v UTC
 * nad polednem, aby nás nerozhodil přechod na letní čas.
 */

export type IsoDate = string; // "YYYY-MM-DD"

const DAY_MS = 86_400_000;

/** Dnešek v pražském čase. GitHub Actions běží v UTC, proto explicitní timezone. */
export function todayInPrague(now: Date = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts; // en-CA dává rovnou YYYY-MM-DD
}

export function toUtc(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12, 0, 0);
}

export function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/**
 * Doplní rok ke dni a měsíci bez roku.
 *
 * Pravidlo: vezmi rok, ve kterém datum vyjde nejblíž dnešku, s tolerancí
 * 60 dní do minulosti. Akce z Kupi jsou vždy v okně zhruba -14 až +30 dní,
 * takže tohle spolehlivě zvládne i přelom roku (28. 12. -> 3. 1.).
 */
export function resolveYear(day: number, month: number, today: IsoDate): IsoDate {
  const currentYear = Number(today.slice(0, 4));
  const candidates = [currentYear - 1, currentYear, currentYear + 1].map((y) => {
    const iso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { iso, delta: diffDays(today, iso) };
  });

  // Nejdřív zkus datum, které není víc než 60 dní v minulosti.
  const forward = candidates
    .filter((c) => c.delta >= -60)
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  if (forward.length > 0) return forward[0].iso;

  // Fallback: prostě nejbližší.
  return candidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0].iso;
}

export interface ParsedValidity {
  validFrom?: IsoDate;
  validTo?: IsoDate;
  /** false = text jsme nerozpoznali; volající se musí opřít o JSON-LD. */
  recognized: boolean;
}

const DATE_RE = /(\d{1,2})\.\s*(\d{1,2})\./g;

/**
 * Rozparsuje text z .discounts_validity.
 *
 * Ověřené varianty na živých stránkách:
 *   "pá 28. 8. – ne 30. 8."     -> from + to
 *   "st 26. 8. – út 1. 9."      -> from + to (přes konec měsíce)
 *   "platí do středy 26. 8."    -> jen to
 *   "platí do neděle 30. 8."    -> jen to
 *   "dnes končí"                -> to = dnes
 *   "zítra končí"               -> to = zítra
 *
 * Cokoli jiného vrátí recognized: false — nikdy neháže výjimku, aby jedna
 * neznámá formulace nepoložila celý běh.
 */
export function parseValidity(text: string | undefined, today: IsoDate): ParsedValidity {
  if (!text) return { recognized: false };
  const t = text.trim().toLowerCase();

  if (t.includes('dnes končí')) return { validTo: today, recognized: true };
  if (t.includes('zítra končí')) return { validTo: addDays(today, 1), recognized: true };

  DATE_RE.lastIndex = 0;
  const found: Array<{ d: number; m: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = DATE_RE.exec(t)) !== null) {
    found.push({ d: Number(match[1]), m: Number(match[2]) });
  }

  if (found.length === 0) return { recognized: false };

  if (found.length === 1) {
    // "platí do středy 26. 8." — jediné datum je konec platnosti.
    const only = resolveYear(found[0].d, found[0].m, today);
    if (t.includes(' do ') || t.startsWith('do ')) return { validTo: only, recognized: true };
    // "od pátku 28. 8." nebo podobné — jediné datum je začátek.
    if (t.includes('od ')) return { validFrom: only, recognized: true };
    return { validTo: only, recognized: true };
  }

  // Dvě a víc dat: první je začátek, poslední konec.
  const first = found[0];
  const last = found[found.length - 1];
  const validFrom = resolveYear(first.d, first.m, today);
  let validTo = resolveYear(last.d, last.m, today);

  // Rozsah přes Silvestr: 28. 12. – 3. 1. vyjde jako 2026-12-28 – 2026-01-03.
  if (diffDays(validFrom, validTo) < 0) {
    const y = Number(validTo.slice(0, 4)) + 1;
    validTo = `${y}${validTo.slice(4)}`;
  }

  return { validFrom, validTo, recognized: true };
}

const WEEKDAY_GENITIVE = [
  'neděle', // 0
  'pondělí',
  'úterý',
  'středy',
  'čtvrtka',
  'pátku',
  'soboty',
];

export function weekdayGenitive(date: IsoDate): string {
  return WEEKDAY_GENITIVE[new Date(toUtc(date)).getUTCDay()];
}

/** "28. 8." */
export function shortCzechDate(date: IsoDate): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d}. ${m}.`;
}
