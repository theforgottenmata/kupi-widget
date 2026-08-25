/**
 * Převod surových nabídek na finální Deal[] — včetně hotových textů pro widget.
 *
 * Veškerá logika (datumy, status, maxPrice, dedup, řazení, formátování)
 * žije tady. Widget pak jen vykresluje řetězce.
 */

import { addDays, diffDays, parseValidity, weekdayWithDate, type IsoDate } from './dates.ts';
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
 * Krátký popisek pro widget na ploše. Naléhavost má přednost před datem:
 * "dnes končí" řekne víc než "do po 24. 8.".
 *
 *   "dnes končí" / "zítra končí" / "do st 26. 8." / "od pá 28. 8."
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
    return `od ${weekdayWithDate(validFrom)}`;
  }

  if (!validTo) return 'platí nyní';
  const days = diffDays(today, validTo);
  if (days <= 0) return 'dnes končí';
  if (days === 1) return 'zítra končí';
  return `do ${weekdayWithDate(validTo)}`;
}

/**
 * Úplný termín pro detailní seznam, kde je místo. Čistě faktický, bez
 * relativních formulací:
 *
 *   "pá 28. 8. – ne 30. 8." / "do st 26. 8." / "od pá 28. 8."
 *
 * U aktivních akcí zná Kupi jen konec platnosti, začátek proto většinou chybí.
 */
export function rangeLabel(validFrom?: IsoDate, validTo?: IsoDate): string {
  if (validFrom && validTo) return `${weekdayWithDate(validFrom)} – ${weekdayWithDate(validTo)}`;
  if (validTo) return `do ${weekdayWithDate(validTo)}`;
  if (validFrom) return `od ${weekdayWithDate(validFrom)}`;
  return 'termín neuveden';
}

/**
 * Rozebere text z `.price_per_unit` na číslo a jednotku.
 *
 * Kupi tam dává cenu už přepočtenou na základní jednotku — u nápojů za litr,
 * u vážených potravin za kilo. Je to jediný spolehlivý způsob, jak porovnat
 * 9,90 Kč / 0,5 kg proti 14,90 Kč / 1 kg, protože samotná `price` je cena
 * za balení.
 *
 *   "79,60 Kč / 1 kg" -> { price: 79.6, unit: "1 kg" }
 *   "14,27 Kč / 1 l"  -> { price: 14.27, unit: "1 l" }
 */
export function parseUnitPrice(text: string | undefined): { price: number; unit: string } | undefined {
  if (!text) return undefined;
  const match = text.replace(/ /g, ' ').match(/^\s*([\d\s.,]+)\s*Kč\s*\/\s*(.+?)\s*$/);
  if (!match) return undefined;
  const price = Number.parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
  const unit = match[2].trim();
  if (!Number.isFinite(price) || !unit) return undefined;
  return { price, unit };
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

    // Přepočtenou cenu uvádíme jen tehdy, když říká něco navíc — u nabídky
    // za 1 kg by jen zopakovala cenu balení.
    const parsedPerUnit = parseUnitPrice(offer.unitPriceText);
    const mainLabel = priceLabel(offer.price, offer.unit);
    const perUnitLabel = parsedPerUnit ? priceLabel(parsedPerUnit.price, parsedPerUnit.unit) : undefined;
    const perUnit = perUnitLabel !== undefined && perUnitLabel !== mainLabel ? parsedPerUnit : undefined;

    deals.push({
      product: product.name,
      store: offer.store,
      status,
      priceLabel: mainLabel,
      unitPrice: perUnit?.price,
      unitPriceUnit: perUnit?.unit,
      unitPriceLabel: perUnit ? perUnitLabel : undefined,
      validLabel: validLabel(status, today, validFrom, validTo),
      rangeLabel: rangeLabel(validFrom, validTo),
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

/**
 * Cena, podle které má smysl nabídky porovnávat.
 *
 * `price` je cena balení, takže 9,90 Kč za půl kila vypadá levněji než
 * 14,90 Kč za kilo, přestože je dražší. Když Kupi uvádí přepočet na základní
 * jednotku, řídíme se jím.
 */
export function comparablePrice(deal: Deal): number {
  return deal.unitPrice ?? deal.price;
}

/** Aktivní před připravovanými, uvnitř skupiny od nejlevnějšího. */
export function compareDeals(a: Deal, b: Deal): number {
  if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
  if (a.product !== b.product) return a.product.localeCompare(b.product, 'cs');
  return comparablePrice(a) - comparablePrice(b);
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
    const price = comparablePrice(deal);
    if (current === undefined || price < current) cheapest.set(key, price);
  }

  const taken = new Set<string>();
  for (const deal of deals) {
    const key = `${deal.product}|${deal.status}`;
    deal.best = !taken.has(key) && comparablePrice(deal) === cheapest.get(key);
    if (deal.best) taken.add(key);
  }
  return deals;
}

export { addDays };
