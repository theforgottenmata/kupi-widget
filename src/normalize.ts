/**
 * Převod surových nabídek na finální Deal[] — včetně hotových textů pro widget.
 *
 * Veškerá logika (datumy, status, maxPrice, dedup, řazení, formátování)
 * žije tady. Widget pak jen vykresluje řetězce.
 */

import {
  addDays,
  diffDays,
  parseValidity,
  shortCzechDate,
  weekdayGenitive,
  type IsoDate,
} from './dates.ts';
import type { Deal, DealStatus, LdOffer, RawOffer, WatchedProduct } from './types.ts';

/**
 * Napáruje JSON-LD na DOM nabídku podle obchod + cena. NIKDY ne podle pořadí.
 * Každý JSON-LD záznam se spotřebuje maximálně jednou, takže dva stejné
 * řádky od stejného obchodu dostanou dva různé záznamy, ne ten samý.
 *
 * JSON-LD nemusí obsahovat všechny nabídky — nenapárovaný DOM řádek se
 * nezahazuje, jen se u něj spolehneme na datum z textu.
 */
export function pairWithLd(offers: RawOffer[], ldOffers: LdOffer[]): Array<{ offer: RawOffer; ld?: LdOffer }> {
  const pool = ldOffers.map((ld) => ({ ld, used: false }));

  return offers.map((offer) => {
    const hit = pool.find(
      (entry) =>
        !entry.used &&
        entry.ld.store.toLowerCase() === offer.store.toLowerCase() &&
        Math.abs(entry.ld.price - offer.price) < 0.005,
    );
    if (hit) {
      hit.used = true;
      return { offer, ld: hit.ld };
    }
    return { offer };
  });
}

export function formatPrice(price: number): string {
  return `${price.toFixed(2).replace('.', ',')} Kč`;
}

export function priceLabel(price: number, unit?: string): string {
  return unit ? `${formatPrice(price)} / ${unit}` : formatPrice(price);
}

/**
 * "do čtvrtka" / "dnes končí" / "od pátku" / "od 28. 8."
 * Do sedmi dnů používáme název dne, dál konkrétní datum — ať je to ve widgetu
 * krátké, ale nikdy dvojznačné.
 */
export function validLabel(
  status: DealStatus,
  today: IsoDate,
  validFrom?: IsoDate,
  validTo?: IsoDate,
): string {
  if (status === 'upcoming') {
    if (!validFrom) return 'brzy';
    const days = diffDays(today, validFrom);
    if (days <= 0) return 'od dneška';
    if (days === 1) return 'od zítřka';
    if (days <= 7) return `od ${weekdayGenitive(validFrom)}`;
    return `od ${shortCzechDate(validFrom)}`;
  }

  if (!validTo) return 'platí nyní';
  const days = diffDays(today, validTo);
  if (days <= 0) return 'dnes končí';
  if (days === 1) return 'zítra končí';
  if (days <= 7) return `do ${weekdayGenitive(validTo)}`;
  return `do ${shortCzechDate(validTo)}`;
}

function dedupeKey(deal: Deal): string {
  return [deal.product, deal.store, deal.price, deal.unitKey ?? '', deal.validFrom ?? '', deal.validTo ?? ''].join('|');
}

export interface NormalizeInput {
  product: WatchedProduct;
  offers: RawOffer[];
  ldOffers: LdOffer[];
  today: IsoDate;
}

/**
 * Jeden produkt (klidně slitý z víc slugů) -> hotové nabídky.
 *
 * Pořadí kroků: napárovat LD -> datumy -> status -> zahodit expirované
 * -> maxPrice -> dedup -> labels.
 */
export function normalizeProduct({ product, offers, ldOffers, today }: NormalizeInput): Deal[] {
  const deals: Deal[] = [];

  for (const { offer, ld } of pairWithLd(offers, ldOffers)) {
    const parsed = parseValidity(offer.validityText, today);

    // validTo: JSON-LD má rok, takže vyhrává. Text je fallback.
    const validTo = ld?.priceValidUntil ?? parsed.validTo;
    const validFrom = parsed.validFrom;

    // Status primárně z třídy price_future_discount — je to explicitní
    // signál od Kupi. Datum slouží jen jako záložní varianta.
    let status: DealStatus = offer.future ? 'upcoming' : 'active';
    if (!offer.future && validFrom && diffDays(today, validFrom) > 0) status = 'upcoming';
    if (offer.future && validFrom && diffDays(today, validFrom) <= 0) status = 'active';

    // Expirované pryč. Když datum neznáme, nabídku raději necháme.
    if (validTo && diffDays(today, validTo) < 0) continue;

    deals.push({
      product: product.name,
      store: offer.store,
      status,
      priceLabel: priceLabel(offer.price, offer.unit),
      validLabel: validLabel(status, today, validFrom, validTo),
      best: false, // doplní markBest() až nad kompletním seznamem
      price: offer.price,
      unit: offer.unit,
      unitKey: offer.unitKey,
      discountPercent: offer.discountPercent,
      validFrom,
      validTo,
      note: offer.note,
      discountId: offer.discountId,
      productId: offer.productId,
      shopId: offer.shopId,
    });
  }

  const withinBudget = deals.filter((deal) => applyMaxPrice(deal, product));

  const seen = new Set<string>();
  const unique = withinBudget.filter((deal) => {
    const key = dedupeKey(deal);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.sort(compareDeals);
}

/**
 * maxPrice platí JEN pro nabídky se shodným unitKey. Nabídka s jinou
 * jednotkou projde nefiltrovaná — nechceme porovnávat 129 Kč/kg
 * proti 79 Kč/balení, ale ani takovou nabídku tiše ztratit.
 */
export function applyMaxPrice(deal: Deal, product: WatchedProduct): boolean {
  if (product.maxPrice === undefined) return true;
  if (product.unitKey === undefined) return deal.price <= product.maxPrice;
  if (deal.unitKey !== product.unitKey) return true;
  return deal.price <= product.maxPrice;
}

/** Aktivní před připravovanými, uvnitř skupiny od nejlevnějšího. */
export function compareDeals(a: Deal, b: Deal): number {
  if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
  if (a.product !== b.product) return a.product.localeCompare(b.product, 'cs');
  return a.price - b.price;
}

/**
 * Označí nejlevnější nabídku každé dvojice (produkt, status).
 * Běží až nad kompletním seznamem, protože jeden produkt může přijít
 * z víc slugů. Widget pak jen filtruje `best`.
 */
export function markBest(deals: Deal[]): Deal[] {
  const cheapest = new Map<string, number>();
  for (const deal of deals) {
    const key = `${deal.product}|${deal.status}`;
    const current = cheapest.get(key);
    if (current === undefined || deal.price < current) cheapest.set(key, deal.price);
  }

  const taken = new Set<string>();
  for (const deal of deals) {
    const key = `${deal.product}|${deal.status}`;
    deal.best = !taken.has(key) && deal.price === cheapest.get(key);
    if (deal.best) taken.add(key);
  }
  return deals;
}

export { addDays };
