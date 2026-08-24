import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addDays,
  diffDays,
  parseValidity,
  resolveYear,
  shortCzechDate,
  weekdayShort,
  weekdayWithDate,
} from '../src/dates.ts';

const TODAY = '2026-08-24'; // pondělí

describe('resolveYear', () => {
  it('doplní aktuální rok pro blízké datum', () => {
    assert.equal(resolveYear(28, 8, TODAY), '2026-08-28');
  });

  it('u data těsně v minulosti zůstane v aktuálním roce', () => {
    assert.equal(resolveYear(20, 8, TODAY), '2026-08-20');
  });

  it('SCÉNÁŘ 7: na konci prosince přiřadí lednu příští rok', () => {
    assert.equal(resolveYear(3, 1, '2026-12-28'), '2027-01-03');
  });

  it('SCÉNÁŘ 7: začátkem ledna přiřadí prosinci minulý rok', () => {
    assert.equal(resolveYear(26, 12, '2027-01-02'), '2026-12-26');
  });
});

describe('parseValidity', () => {
  it('rozsah se dvěma daty', () => {
    assert.deepEqual(parseValidity('pá 28. 8. – ne 30. 8.', TODAY), {
      validFrom: '2026-08-28',
      validTo: '2026-08-30',
      recognized: true,
    });
  });

  it('rozsah přes konec měsíce', () => {
    assert.deepEqual(parseValidity('st 26. 8. – út 1. 9.', TODAY), {
      validFrom: '2026-08-26',
      validTo: '2026-09-01',
      recognized: true,
    });
  });

  it('"platí do <den> D. M." dá jen konec platnosti', () => {
    assert.deepEqual(parseValidity('platí do středy 26. 8.', TODAY), {
      validTo: '2026-08-26',
      recognized: true,
    });
  });

  it('SCÉNÁŘ 5: "dnes končí"', () => {
    assert.deepEqual(parseValidity('dnes končí', TODAY), { validTo: '2026-08-24', recognized: true });
  });

  it('SCÉNÁŘ 5: "zítra končí"', () => {
    assert.deepEqual(parseValidity('zítra končí', TODAY), { validTo: '2026-08-25', recognized: true });
  });

  it('SCÉNÁŘ 7: rozsah přes Silvestr posune konec do dalšího roku', () => {
    assert.deepEqual(parseValidity('po 28. 12. – ne 3. 1.', '2026-12-28'), {
      validFrom: '2026-12-28',
      validTo: '2027-01-03',
      recognized: true,
    });
  });

  it('neznámý formát nespadne, jen se označí jako nerozpoznaný', () => {
    assert.deepEqual(parseValidity('zcela nový formát validity', TODAY), { recognized: false });
    assert.deepEqual(parseValidity(undefined, TODAY), { recognized: false });
    assert.deepEqual(parseValidity('', TODAY), { recognized: false });
  });
});

describe('pomocné funkce', () => {
  it('addDays a diffDays fungují přes přelom měsíce', () => {
    assert.equal(addDays('2026-08-31', 1), '2026-09-01');
    assert.equal(diffDays('2026-08-24', '2026-09-01'), 8);
    assert.equal(diffDays('2026-08-24', '2026-08-20'), -4);
  });

  it('addDays přežije přechod na zimní čas', () => {
    // V ČR se mění čas v noci na neděli 25. 10. 2026.
    assert.equal(addDays('2026-10-24', 3), '2026-10-27');
  });

  it('weekdayShort používá stejné zkratky jako Kupi', () => {
    assert.equal(weekdayShort('2026-08-24'), 'po');
    assert.equal(weekdayShort('2026-08-26'), 'st');
    assert.equal(weekdayShort('2026-08-28'), 'pá');
    assert.equal(weekdayShort('2026-08-30'), 'ne');
  });

  it('weekdayWithDate spojí den a datum', () => {
    assert.equal(weekdayWithDate('2026-08-28'), 'pá 28. 8.');
    assert.equal(weekdayWithDate('2026-09-01'), 'út 1. 9.');
  });

  it('shortCzechDate', () => {
    assert.equal(shortCzechDate('2026-09-01'), '1. 9.');
  });
});
