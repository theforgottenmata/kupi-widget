import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  markBest,
  normalizeProduct,
  pairWithLd,
  priceLabel,
  rangeLabel,
  validLabel,
} from '../src/normalize.ts';
import { parseProductPage } from '../src/parse.ts';
import type { LdOffer, RawOffer, WatchedProduct } from '../src/types.ts';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, `${name}.html`), 'utf8');
const TODAY = '2026-08-24'; // pondělí

function run(product: WatchedProduct, slugs: string[] = product.slugs) {
  const offers: RawOffer[] = [];
  const ldOffers: LdOffer[] = [];
  for (const slug of slugs) {
    const page = parseProductPage(fixture(slug));
    offers.push(...page.offers);
    ldOffers.push(...page.ldOffers);
  }
  return normalizeProduct({ product, offers, ldOffers, today: TODAY });
}

describe('párování DOM <-> JSON-LD', () => {
  it('páruje podle obchod + cena, ne podle pořadí', () => {
    const offers = [
      { store: 'Lidl', price: 17.9, future: false },
      { store: 'Albert', price: 19.9, future: false },
    ] as RawOffer[];
    const ld: LdOffer[] = [
      { store: 'Albert', price: 19.9, priceValidUntil: '2026-09-01' },
      { store: 'Lidl', price: 17.9, priceValidUntil: '2026-08-30' },
    ];
    const paired = pairWithLd(offers, ld);
    assert.equal(paired[0].ld?.priceValidUntil, '2026-08-30');
    assert.equal(paired[1].ld?.priceValidUntil, '2026-09-01');
  });

  it('každý záznam z JSON-LD se spotřebuje jen jednou', () => {
    const offers = [
      { store: 'Albert', price: 19.9, future: false },
      { store: 'Albert', price: 19.9, future: false },
    ] as RawOffer[];
    const ld: LdOffer[] = [{ store: 'Albert', price: 19.9, priceValidUntil: '2026-09-01' }];
    const paired = pairWithLd(offers, ld);
    assert.ok(paired[0].ld);
    assert.equal(paired[1].ld, undefined);
  });

  it('nenapárovaný řádek se NEZAHAZUJE', () => {
    const offers = [{ store: 'Globus', price: 29.9, future: false }] as RawOffer[];
    assert.equal(pairWithLd(offers, []).length, 1);
  });
});

describe('formátování pro widget', () => {
  it('priceLabel', () => {
    assert.equal(priceLabel(99.9, '1 kg'), '99,90 Kč / 1 kg');
    assert.equal(priceLabel(17.9, undefined), '17,90 Kč');
  });

  it('validLabel pro aktivní akce dává přednost naléhavosti', () => {
    assert.equal(validLabel('active', TODAY, undefined, '2026-08-24'), 'dnes končí');
    assert.equal(validLabel('active', TODAY, undefined, '2026-08-25'), 'zítra končí');
    assert.equal(validLabel('active', TODAY, undefined, '2026-08-26'), 'do st 26. 8.');
    assert.equal(validLabel('active', TODAY, undefined, '2026-09-10'), 'do čt 10. 9.');
    assert.equal(validLabel('active', TODAY, undefined, undefined), 'platí nyní');
  });

  it('validLabel pro připravované akce', () => {
    assert.equal(validLabel('upcoming', TODAY, '2026-08-25'), 'od zítřka');
    assert.equal(validLabel('upcoming', TODAY, '2026-08-28'), 'od pá 28. 8.');
    assert.equal(validLabel('upcoming', TODAY, '2026-09-15'), 'od út 15. 9.');
  });

  it('rangeLabel je čistě faktický termín', () => {
    assert.equal(rangeLabel('2026-08-28', '2026-08-30'), 'pá 28. 8. – ne 30. 8.');
    assert.equal(rangeLabel(undefined, '2026-08-26'), 'do st 26. 8.');
    assert.equal(rangeLabel('2026-08-28', undefined), 'od pá 28. 8.');
    assert.equal(rangeLabel(undefined, undefined), 'termín neuveden');
  });
});

describe('SCÉNÁŘ 4: kureci-prsni-rizky end-to-end', () => {
  const deals = run({ name: 'Kuřecí prsa', slugs: ['kureci-prsni-rizky'], unitKey: '1-kg' });

  it('vrátí tři nabídky, aktivní před připravovanou', () => {
    assert.equal(deals.length, 3);
    assert.deepEqual(
      deals.map((deal) => deal.status),
      ['active', 'active', 'upcoming'],
    );
  });

  it('připravovaná akce má správné datumy i popisek', () => {
    const upcoming = deals.find((deal) => deal.status === 'upcoming')!;
    assert.equal(upcoming.store, 'Penny Market');
    assert.equal(upcoming.validFrom, '2026-08-28');
    assert.equal(upcoming.validTo, '2026-08-30'); // z JSON-LD
    assert.equal(upcoming.priceLabel, '99,90 Kč / 1 kg');
    assert.equal(upcoming.validLabel, 'od pá 28. 8.');
    assert.equal(upcoming.rangeLabel, 'pá 28. 8. – ne 30. 8.');
    assert.equal(upcoming.discountPercent, 54);
  });

  it('aktivní akce mají popisek podle dne v týdnu', () => {
    assert.deepEqual(
      deals.filter((deal) => deal.status === 'active').map((deal) => deal.validLabel),
      ['do st 26. 8.', 'do ne 30. 8.'],
    );
  });
});

describe('SCÉNÁŘ 2+3: maslo — neúplné JSON-LD a duplicity', () => {
  const deals = run({ name: 'Máslo', slugs: ['maslo'], unitKey: '250-g', maxPrice: 45 });

  it('z pěti řádků zbydou po dedupu čtyři nabídky', () => {
    assert.equal(deals.length, 4);
  });

  it('řádek bez záznamu v JSON-LD dostane datum z textu', () => {
    const albert = deals.filter((deal) => deal.store === 'Albert' && deal.price === 19.9);
    assert.equal(albert.length, 1);
    assert.equal(albert[0].validTo, '2026-09-01');
  });

  it('"zítra končí" se přeloží na konkrétní datum', () => {
    const hruska = deals.find((deal) => deal.store === 'Hruška')!;
    assert.equal(hruska.status, 'active');
    assert.equal(hruska.validTo, '2026-08-25');
    assert.equal(hruska.validLabel, 'zítra končí');
  });

  it('poznámky se přenesou do výstupu', () => {
    assert.ok(deals.some((deal) => deal.note?.includes('max 12 ks/osoba/den')));
  });
});

describe('SCÉNÁŘ 5: banany — dnes končí a neznámý formát', () => {
  const deals = run({ name: 'Banány', slugs: ['banany'], unitKey: '1-kg' });

  it('nabídka končící dnes zůstává ve výstupu', () => {
    const kaufland = deals.find((deal) => deal.store === 'Kaufland')!;
    assert.equal(kaufland.validTo, '2026-08-24');
    assert.equal(kaufland.validLabel, 'dnes končí');
  });

  it('řádek mimo JSON-LD s neznámou validitou se nezahodí', () => {
    const globus = deals.find((deal) => deal.store === 'Globus')!;
    assert.equal(globus.validTo, undefined);
    assert.equal(globus.status, 'active');
    assert.equal(globus.validLabel, 'platí nyní');
  });

  it('všech 6 řádků projde', () => {
    assert.equal(deals.length, 6);
  });
});

describe('SCÉNÁŘ 6: víc slugů na jeden produkt', () => {
  const deals = run({ name: 'Cibule', slugs: ['cibule', 'cibule-cervena'], unitKey: '1-kg', maxPrice: 15 });

  it('slije oba slugy, dedupuje shodný řádek a odfiltruje drahou nabídku', () => {
    assert.deepEqual(
      deals.map((deal) => `${deal.store} ${deal.price}`),
      ['Penny Market 9.9', 'Albert 12.9', 'Lidl 14.9'],
    );
  });

  it('maxPrice se NEaplikuje na jinou jednotku', () => {
    const penny = deals.find((deal) => deal.store === 'Penny Market')!;
    assert.equal(penny.unitKey, '0.5-kg');
  });

  it('nabídka nad maxPrice se shodnou jednotkou vypadne', () => {
    assert.equal(
      deals.find((deal) => deal.store === 'Kaufland'),
      undefined,
    );
  });
});

describe('markBest', () => {
  it('označí právě jednu nejlevnější nabídku na produkt a status', () => {
    const deals = run({ name: 'Banány', slugs: ['banany'], unitKey: '1-kg' });
    markBest(deals);

    const bestActive = deals.filter((deal) => deal.best && deal.status === 'active');
    assert.equal(bestActive.length, 1);
    assert.equal(bestActive[0].store, 'Kaufland'); // 19,90 Kč

    const bestUpcoming = deals.filter((deal) => deal.best && deal.status === 'upcoming');
    assert.equal(bestUpcoming.length, 1);
    assert.equal(bestUpcoming[0].store, 'Albert');
  });

  it('při shodě ceny označí jen jednu nabídku', () => {
    const deals = run({ name: 'Máslo', slugs: ['maslo'], unitKey: '250-g' });
    markBest(deals);
    const products = deals.filter((deal) => deal.best).map((deal) => `${deal.product}|${deal.status}`);
    assert.equal(new Set(products).size, products.length);
  });
});

describe('expirované akce', () => {
  it('nabídka s validTo v minulosti se zahodí', () => {
    const offers = [{ store: 'Lidl', price: 10, future: false, validityText: 'platí do pátku 21. 8.' }] as RawOffer[];
    const deals = normalizeProduct({
      product: { name: 'Test', slugs: [] },
      offers,
      ldOffers: [],
      today: TODAY,
    });
    assert.equal(deals.length, 0);
  });
});
