import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sanityCheck } from '../src/generate.ts';
import type { Deal } from '../src/types.ts';

const deal = (index: number): Deal => ({
  product: `P${index}`,
  store: 'Lidl',
  status: 'active',
  priceLabel: '10,00 Kč',
  validLabel: 'platí nyní',
  best: true,
  price: 10,
});

const many = (count: number) => Array.from({ length: count }, (_, i) => deal(i));

describe('sanityCheck', () => {
  it('první běh bez historie projde', () => {
    assert.equal(sanityCheck(many(3), undefined, []).ok, true);
    assert.equal(sanityCheck(many(3), [], []).ok, true);
  });

  it('jakákoli chyba při stahování zablokuje zápis', () => {
    const verdict = sanityCheck(many(30), many(28), ['Máslo: HTTP 503']);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason!, /HTTP 503/);
  });

  it('nula nabídek proti neprázdné historii zablokuje zápis', () => {
    assert.equal(sanityCheck([], many(28), []).ok, false);
  });

  it('propad 28 -> 2 zablokuje zápis', () => {
    const verdict = sanityCheck(many(2), many(28), []);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason!, /28 -> 2/);
  });

  it('běžné kolísání projde', () => {
    assert.equal(sanityCheck(many(20), many(28), []).ok, true);
    assert.equal(sanityCheck(many(14), many(28), []).ok, true);
    assert.equal(sanityCheck(many(40), many(28), []).ok, true);
  });

  it('malá historie se neporovnává poměrem — jinak by 3 -> 1 padalo zbytečně', () => {
    assert.equal(sanityCheck(many(1), many(3), []).ok, true);
  });
});
