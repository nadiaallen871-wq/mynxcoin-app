import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  RoundingMode,
  add,
  allocate,
  divideRounded,
  fromDecimalString,
  money,
  multiplyByRate,
  subtract,
  sum,
  toDecimalString,
  toJSON,
} from '../../src/utils/money.js';

describe('money parsing and formatting', () => {
  it('parses decimal strings exactly', () => {
    expect(fromDecimalString('1,250.50', 'GHS').minor).toBe(125050n);
    expect(fromDecimalString('0.1', 'GHS').minor).toBe(10n);
    expect(fromDecimalString('-3', 'GHS').minor).toBe(-300n);
    expect(fromDecimalString('1500', 'JPY').minor).toBe(1500n);
  });

  it('rejects excess precision instead of rounding silently', () => {
    expect(() => fromDecimalString('1.005', 'GHS')).toThrow(MoneyError);
    expect(() => fromDecimalString('1.5', 'JPY')).toThrow(MoneyError);
  });

  it('rejects malformed input and fractional numbers', () => {
    expect(() => fromDecimalString('1e3', 'GHS')).toThrow(MoneyError);
    expect(() => fromDecimalString('abc', 'GHS')).toThrow(MoneyError);
    expect(() => money(1.5, 'GHS')).toThrow(MoneyError);
    expect(() => money('10', 'ghs')).toThrow(MoneyError);
  });

  it('round-trips to decimal strings', () => {
    expect(toDecimalString(money(125050n, 'GHS'))).toBe('1250.50');
    expect(toDecimalString(money(-5n, 'GHS'))).toBe('-0.05');
    expect(toDecimalString(money(0n, 'GHS'))).toBe('0.00');
    expect(toDecimalString(money(1500n, 'JPY'))).toBe('1500');
  });

  it('serialises amounts as strings for JSON safety', () => {
    expect(toJSON(money(9007199254740993n, 'GHS'))).toEqual({ amountMinor: '9007199254740993', currency: 'GHS' });
  });
});

describe('money arithmetic', () => {
  it('avoids floating-point error (0.1 + 0.2)', () => {
    const total = add(fromDecimalString('0.10', 'GHS'), fromDecimalString('0.20', 'GHS'));
    expect(toDecimalString(total)).toBe('0.30');
  });

  it('never mixes currencies', () => {
    expect(() => add(money(1n, 'GHS'), money(1n, 'USD'))).toThrow(/Currency mismatch/);
    expect(() => subtract(money(1n, 'GHS'), money(1n, 'USD'))).toThrow(/Currency mismatch/);
  });

  it('sums lists in one currency', () => {
    expect(sum([money(100n, 'GHS'), money(250n, 'GHS')], 'GHS').minor).toBe(350n);
  });
});

describe('rounding', () => {
  const cases = [
    // [numerator, denominator, mode, expected]
    [25n, 10n, RoundingMode.HALF_EVEN, 2n],
    [35n, 10n, RoundingMode.HALF_EVEN, 4n],
    [-25n, 10n, RoundingMode.HALF_EVEN, -2n],
    [25n, 10n, RoundingMode.HALF_UP, 3n],
    [-25n, 10n, RoundingMode.HALF_UP, -3n],
    [29n, 10n, RoundingMode.DOWN, 2n],
    [21n, 10n, RoundingMode.UP, 3n],
    [-21n, 10n, RoundingMode.FLOOR, -3n],
    [-29n, 10n, RoundingMode.CEIL, -2n],
    [20n, 10n, RoundingMode.UP, 2n],
  ];
  it.each(cases)('%s / %s with %s = %s', (n, d, mode, expected) => {
    expect(divideRounded(n, d, mode)).toBe(expected);
  });

  it('requires a known rounding mode and non-zero divisor', () => {
    expect(() => divideRounded(1n, 2n, 'NEAREST')).toThrow(MoneyError);
    expect(() => divideRounded(1n, 0n, RoundingMode.DOWN)).toThrow(MoneyError);
  });

  it('applies rates exactly', () => {
    // 1.5% fee on GH₵ 1,000.33 = 15.00495 → HALF_EVEN → 15.00
    expect(multiplyByRate(fromDecimalString('1000.33', 'GHS'), '0.015', RoundingMode.HALF_EVEN).minor).toBe(1500n);
    expect(multiplyByRate(fromDecimalString('1000.33', 'GHS'), '0.015', RoundingMode.UP).minor).toBe(1501n);
  });
});

describe('allocate', () => {
  it('splits without losing or creating a minor unit', () => {
    const parts = allocate(money(100n, 'GHS'), [1, 1, 1]);
    expect(parts.map((p) => p.minor)).toEqual([34n, 33n, 33n]);
    expect(sum(parts, 'GHS').minor).toBe(100n);
  });

  it('handles negative amounts and uneven weights', () => {
    const parts = allocate(money(-1001n, 'GHS'), [70, 20, 10]);
    expect(sum(parts, 'GHS').minor).toBe(-1001n);
  });

  it('preserves totals for many random splits', () => {
    for (let i = 0; i < 500; i++) {
      const total = BigInt(Math.floor(Math.random() * 1e9));
      const weights = Array.from({ length: 1 + (i % 7) }, () => Math.floor(Math.random() * 100) + 1);
      expect(sum(allocate(money(total, 'GHS'), weights), 'GHS').minor).toBe(total);
    }
  });
});
