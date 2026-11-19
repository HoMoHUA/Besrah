import { describe, expect, it } from 'vitest';
import { budgetTier, describeProfileCode, encodeProfile, PROFILE_CODE_PATTERN } from '../../src/profile/code.js';

describe('profile code v1 (D17)', () => {
  it('nothing stated is "0XXX", incomplete, and every position says it was not stated', () => {
    const p = encodeProfile({});
    expect(p).toMatchObject({ version: 1, code: '0XXX', complete: false });
    expect(p.positions.every(x => x.source === 'not_stated' && x.from === null)).toBe(true);
  });
  it('the owner example shape: budget digit + transit + food + shop letters, each traced to the preference it came from', () => {
    const p = encodeProfile({ foodBudgetToman: 250_000, transitPriority: 'time', foodPreferredVerticals: ['cafe'], shopPriority: 'quality' });
    expect(p.code).toBe('2ACB');
    expect(p.complete).toBe(true);
    expect(p.positions.map(x => x.from)).toEqual(['foodBudgetToman', 'transitPriority', 'foodPreferredVerticals', 'shopPriority']);
    expect(PROFILE_CODE_PATTERN.test(p.code)).toBe(true);
  });
  it('budget tiers have fixed, documented bounds (toman per food item)', () => {
    expect([undefined, 0, -5, 1.5, 100_000, 149_999, 150_000, 299_999, 300_000, 599_999, 600_000, 5_000_000].map(v => budgetTier(v as number)))
      .toEqual([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it('flowers and "other" are not a food style: the next stated favourite decides, else X', () => {
    expect(encodeProfile({ foodPreferredVerticals: ['flowers', 'sweets'] }).code).toBe('0XDX');
    expect(encodeProfile({ foodPreferredVerticals: ['flowers', 'other'] }).code).toBe('0XXX');
    expect(encodeProfile({ foodPreferredVerticals: ['produce'] }).code).toBe('0XEX');
  });
  it('every transit and shop choice has its own letter', () => {
    expect(['time', 'walk', 'cost', 'balanced'].map(t => encodeProfile({ transitPriority: t as 'time' }).code[1])).toEqual(['A', 'B', 'C', 'D']);
    expect(['price', 'quality', 'installment', 'balanced'].map(s => encodeProfile({ shopPriority: s as 'price' }).code[3])).toEqual(['A', 'B', 'C', 'D']);
  });
  it('describe decodes a valid code and rejects anything else instead of guessing', () => {
    expect(describeProfileCode('2ACB')!.map(x => x.meaning)).toEqual(['بودجه: ۱۵۰ تا ۳۰۰ هزار تومان', 'سفر: زودتر رسیدن مهم تر است', 'غذا: کافه و سبک', 'خرید: کیفیت و برند']);
    expect(describeProfileCode('0XXX')!.every(x => x.source === 'not_stated')).toBe(true);
    for (const bad of ['', '5ACB', '2ACBX', '2ZCB', '2AFB', '2ACE', 2, null, undefined, '2acb']) expect(describeProfileCode(bad)).toBeNull();
  });
});
