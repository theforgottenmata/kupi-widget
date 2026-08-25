import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { parseLdOffers, parsePercent, parsePrice, parseProductPage, parseUnit } from '../src/parse.ts';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, `${name}.html`), 'utf8');

describe('drobné parsery', () => {
  it('parsePrice zvládne českou čárku i nezlomitelnou mezeru', () => {
    assert.equal(parsePrice('99,90 Kč'), 99.9);
    assert.equal(parsePrice('1 299,90 Kč'), 1299.9);
    assert.equal(parsePrice('nesmysl'), undefined);
  });

  it('parsePercent zvládne en dash', () => {
    assert.equal(parsePercent('–54 %'), 54);
    assert.equal(parsePercent(undefined), undefined);
  });

  it('parseUnit odstraní vedoucí lomítko', () => {
    assert.equal(parseUnit('/ 1 kg'), '1 kg');
    assert.equal(parseUnit('/ 250 g'), '250 g');
  });
});

describe('SCÉNÁŘ 1+4: kureci-prsni-rizky', () => {
  const page = parseProductPage(fixture('kureci-prsni-rizky'));

  it('je detail produktu se třemi nabídkami', () => {
    assert.equal(page.isProductPage, true);
    assert.equal(page.pageTitle, 'Kuřecí prsní řízky');
    assert.equal(page.offers.length, 3);
  });

  it('vytáhne všechna pole prvního řádku', () => {
    assert.deepEqual(page.offers[0], {
      discountId: 10803699,
      productId: 791,
      shopId: 7,
      store: 'Penny Market',
      price: 99.9,
      unit: '1 kg',
      unitKey: '1-kg',
      discountPercent: 54,
      unitPriceText: '99,90 Kč / 1 kg',
      validityText: 'pá 28. 8. – ne 30. 8.',
      note: undefined,
      future: true,
    });
  });

  it('připravovanou akci pozná podle třídy price_future_discount', () => {
    assert.deepEqual(
      page.offers.map((offer) => offer.future),
      [true, false, false],
    );
  });

  it('přečte poznámku z .discount_note', () => {
    assert.equal(page.offers[1].note, 'baleno, max 5 balení/osoba/den');
  });

  it('JSON-LD tady pokrývá všechny tři nabídky', () => {
    assert.equal(page.ldOffers.length, 3);
    assert.deepEqual(page.ldOffers[0], { store: 'Penny Market', price: 99.9, priceValidUntil: '2026-08-30' });
  });
});

describe('SCÉNÁŘ 2+3: maslo', () => {
  const page = parseProductPage(fixture('maslo'));

  it('posbírá řádky ze VŠECH bloků .discounts_table', () => {
    assert.equal(page.offers.length, 5);
  });

  it('JSON-LD nepokrývá všechny řádky', () => {
    assert.equal(page.ldOffers.length, 4);
    assert.ok(page.ldOffers.length < page.offers.length);
  });

  it('všechny řádky patří stejnému produktu', () => {
    assert.deepEqual(new Set(page.offers.map((offer) => offer.productId)), new Set([6905]));
  });
});

describe('SCÉNÁŘ 5: banany', () => {
  const page = parseProductPage(fixture('banany'));

  it('má 6 řádků, ale jen 4 záznamy v JSON-LD', () => {
    assert.equal(page.offers.length, 6);
    assert.equal(page.ldOffers.length, 4);
  });

  it('relativní validita se do parseru dostane jako text', () => {
    assert.equal(page.offers[0].validityText, 'dnes končí');
  });
});

describe('produkt bez akcí a stránka kategorie', () => {
  it('platný detail bez nabídek není chyba', () => {
    const page = parseProductPage(fixture('ryze'));
    assert.equal(page.isProductPage, true);
    assert.equal(page.offers.length, 0);
  });

  it('stránka kategorie se pozná podle chybějícího Product JSON-LD', () => {
    const page = parseProductPage(fixture('vejce-kategorie'));
    assert.equal(page.isProductPage, false);
  });
});

describe('odolnost', () => {
  it('rozbité JSON-LD nepoloží parser', () => {
    const html = '<html><head><script type="application/ld+json">{ tohle není JSON</script></head><body></body></html>';
    assert.deepEqual(parseLdOffers(html), []);
    assert.equal(parseProductPage(html).isProductPage, false);
  });

  it('řádek bez ceny se zahodí, zbytek projde', () => {
    const html = fixture('kureci-prsni-rizky').replace('99,90&nbsp;Kč', '');
    assert.equal(parseProductPage(html).offers.length, 2);
  });
});
