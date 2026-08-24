/**
 * Parsování produktové stránky Kupi.cz.
 *
 * Struktura ověřená na živých stránkách (srpen 2026):
 *
 *   .discount_row[data-product][data-discount][data-shop][data-key]
 *     .discounts_shop_name            -> obchod
 *     .discounts_price                -> wrapper; třída price_future_discount = připravovaná akce
 *       .discount_price_value         -> "99,90 Kč"
 *       .discount_amount              -> "/ 1 kg"
 *       .discount_percentage          -> "–54 %"   (pozor: EN DASH U+2013)
 *     .discounts_validity             -> "platí do středy 26. 8." apod.
 *     .discount_note                  -> "max 5 balení/osoba/den"
 *
 *   <script type="application/ld+json"> s @type: Product
 *     offers.offers[] = { offeredBy, price, priceValidUntil }
 *
 * Dvě věci, na které je potřeba dávat pozor a jsou ošetřené níže:
 *  1) Stránka má víc bloků .discounts_table (zvýrazněná nabídka + zbytek).
 *     Bereme všechny .discount_row, ale filtrujeme na převažující data-product,
 *     aby nás nechytly případné sekce s podobnými produkty.
 *  2) JSON-LD nepokrývá všechny řádky (ověřeno: máslo 5 řádků / 4 offers,
 *     banány 9 řádků / 7 offers). Proto se jím jen doplňuje validTo.
 */

import * as cheerio from 'cheerio';
import type { LdOffer, ParsedPage, RawOffer } from './types.ts';

/** "1 299,90 Kč" -> 1299.9 ; vrací undefined, když to není číslo. */
export function parsePrice(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const cleaned = text
    .replace(/ /g, ' ')
    .replace(/\s/g, '')
    .replace(/[^\d,.-]/g, '')
    .replace(',', '.');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

/** "–54 %" -> 54 (znaménko ignorujeme, Kupi používá en dash) */
export function parsePercent(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.match(/(\d+)\s*%/);
  return match ? Number(match[1]) : undefined;
}

/** "/ 1 kg" -> "1 kg" */
export function parseUnit(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/ /g, ' ').replace(/^\s*\/\s*/, '').trim();
  return cleaned || undefined;
}

function textOf($: cheerio.CheerioAPI, row: cheerio.Cheerio<any>, selector: string): string | undefined {
  const el = row.find(selector).first();
  if (el.length === 0) return undefined;
  const value = el.text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  return value || undefined;
}

function num(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseLdOffers(html: string): LdOffer[] {
  const $ = cheerio.load(html);
  const offers: LdOffer[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    if (offers.length > 0) return;
    let json: any;
    try {
      json = JSON.parse($(el).text());
    } catch {
      return; // rozbité JSON-LD nesmí položit celý parser
    }
    const nodes = Array.isArray(json) ? json : [json];
    for (const node of nodes) {
      if (node?.['@type'] !== 'Product') continue;
      const list = node?.offers?.offers;
      if (!Array.isArray(list)) continue;
      for (const offer of list) {
        const price = typeof offer?.price === 'number' ? offer.price : parsePrice(String(offer?.price));
        if (typeof offer?.offeredBy !== 'string' || price === undefined) continue;
        offers.push({
          store: offer.offeredBy.trim(),
          price,
          priceValidUntil:
            typeof offer?.priceValidUntil === 'string' && /^\d{4}-\d{2}-\d{2}/.test(offer.priceValidUntil)
              ? offer.priceValidUntil.slice(0, 10)
              : undefined,
        });
      }
    }
  });

  return offers;
}

export function parseProductPage(html: string): ParsedPage {
  const $ = cheerio.load(html);

  const ldOffers = parseLdOffers(html);
  const hasProductLd = $('script[type="application/ld+json"]')
    .toArray()
    .some((el) => {
      try {
        const json = JSON.parse($(el).text());
        const nodes = Array.isArray(json) ? json : [json];
        return nodes.some((n: any) => n?.['@type'] === 'Product');
      } catch {
        return false;
      }
    });

  const rows = $('.discount_row').toArray();

  // Stránka bez Product JSON-LD není detail produktu (kategorie, redirect,
  // nebo Kupi změnilo HTML). Tohle musí vyvolat chybu, ne tichých 0 nabídek.
  if (!hasProductLd) {
    return { isProductPage: false, offers: [], ldOffers: [], pageTitle: $('h1').first().text().trim() || undefined };
  }

  // Převažující data-product — ochrana proti sekcím s jinými produkty.
  const counts = new Map<string, number>();
  for (const el of rows) {
    const id = $(el).attr('data-product') ?? '';
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let dominant = '';
  let best = 0;
  for (const [id, count] of counts) {
    if (count > best) {
      dominant = id;
      best = count;
    }
  }

  const offers: RawOffer[] = [];
  for (const el of rows) {
    const row = $(el);
    if ((row.attr('data-product') ?? '') !== dominant) continue;

    const store = textOf($, row, '.discounts_shop_name');
    const price = parsePrice(textOf($, row, '.discount_price_value'));
    if (!store || price === undefined) continue; // nekompletní řádek radši zahodit

    offers.push({
      discountId: num(row.attr('data-discount')),
      productId: num(row.attr('data-product')),
      shopId: num(row.attr('data-shop')),
      store,
      price,
      unit: parseUnit(textOf($, row, '.discount_amount')),
      unitKey: row.attr('data-key')?.trim() || undefined,
      discountPercent: parsePercent(textOf($, row, '.discount_percentage')),
      validityText: textOf($, row, '.discounts_validity'),
      note: textOf($, row, '.discount_note'),
      future: row.find('.discounts_price').first().hasClass('price_future_discount'),
    });
  }

  return {
    isProductPage: true,
    pageTitle: $('h1').first().text().replace(/\s+/g, ' ').trim() || undefined,
    offers,
    ldOffers,
  };
}
