/**
 * Exact money arithmetic using BigInt integer minor units.
 *
 * Rules:
 *  - An amount is { minor: bigint, currency: 'GHS' }.
 *  - Never construct amounts from JS numbers that may be fractional.
 *  - Decimal strings ("12.34") are parsed exactly, and too many fractional
 *    digits are rejected instead of being silently rounded.
 *  - Division and percentage operations require an explicit rounding mode.
 *  - Different currencies can never be combined.
 */

export const RoundingMode = Object.freeze({
  HALF_EVEN: 'HALF_EVEN', // banker's rounding: default for accounting
  HALF_UP: 'HALF_UP',
  DOWN: 'DOWN', // toward zero
  UP: 'UP', // away from zero
  FLOOR: 'FLOOR',
  CEIL: 'CEIL',
});

/** Minor-unit exponents. The DB `currencies` table is authoritative at runtime. */
export const CURRENCY_EXPONENTS = Object.freeze({ GHS: 2, USD: 2, EUR: 2, GBP: 2, NGN: 2, KES: 2, XOF: 0, JPY: 0 });

export class MoneyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MoneyError';
  }
}

const CURRENCY_RE = /^[A-Z]{3}$/;

function assertCurrency(currency) {
  if (typeof currency !== 'string' || !CURRENCY_RE.test(currency)) {
    throw new MoneyError(`Invalid currency code: ${currency}`);
  }
}

export function exponentFor(currency, exponents = CURRENCY_EXPONENTS) {
  assertCurrency(currency);
  const exp = exponents[currency];
  if (exp === undefined) throw new MoneyError(`Unsupported currency: ${currency}`);
  return exp;
}

function toBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new MoneyError('Minor-unit numbers must be safe integers');
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new MoneyError(`Invalid minor-unit amount: ${String(value)}`);
}

export function money(minor, currency) {
  assertCurrency(currency);
  return Object.freeze({ minor: toBigInt(minor), currency });
}

/** Parse a human decimal string such as "1,250.50" → 125050n minor units (exact). */
export function fromDecimalString(input, currency, exponents = CURRENCY_EXPONENTS) {
  const exp = exponentFor(currency, exponents);
  if (typeof input !== 'string') throw new MoneyError('Decimal amount must be a string');
  const cleaned = input.trim().replace(/,/g, '');
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) throw new MoneyError(`Invalid decimal amount: ${input}`);
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > exp) {
    throw new MoneyError(`${currency} supports at most ${exp} decimal places`);
  }
  const minor = BigInt(whole + fraction.padEnd(exp, '0'));
  return money(sign ? -minor : minor, currency);
}

/** Format minor units as a plain decimal string ("1250.50"). Display formatting belongs to the client. */
export function toDecimalString(amount, exponents = CURRENCY_EXPONENTS) {
  const exp = exponentFor(amount.currency, exponents);
  const negative = amount.minor < 0n;
  const abs = (negative ? -amount.minor : amount.minor).toString().padStart(exp + 1, '0');
  const whole = exp === 0 ? abs : abs.slice(0, -exp);
  const fraction = exp === 0 ? '' : `.${abs.slice(-exp)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

function assertSameCurrency(a, b) {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export const add = (a, b) => (assertSameCurrency(a, b), money(a.minor + b.minor, a.currency));
export const subtract = (a, b) => (assertSameCurrency(a, b), money(a.minor - b.minor, a.currency));
export const negate = (a) => money(-a.minor, a.currency);
export const isZero = (a) => a.minor === 0n;
export const isNegative = (a) => a.minor < 0n;
export const compare = (a, b) => (assertSameCurrency(a, b), a.minor === b.minor ? 0 : a.minor > b.minor ? 1 : -1);

export function sum(amounts, currency) {
  return amounts.reduce((acc, item) => add(acc, item), money(0n, currency));
}

/**
 * Integer division of numerator/denominator (both bigint) with an explicit rounding mode.
 */
export function divideRounded(numerator, denominator, mode) {
  if (!Object.values(RoundingMode).includes(mode)) throw new MoneyError(`Unknown rounding mode: ${mode}`);
  if (denominator === 0n) throw new MoneyError('Division by zero');
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const quotient = numerator / denominator; // truncates toward zero
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;

  const positive = numerator > 0n;
  const twiceRem = (remainder < 0n ? -remainder : remainder) * 2n;
  const awayFromZero = positive ? quotient + 1n : quotient - 1n;

  switch (mode) {
    case RoundingMode.DOWN:
      return quotient;
    case RoundingMode.UP:
      return awayFromZero;
    case RoundingMode.FLOOR:
      return positive ? quotient : quotient - 1n;
    case RoundingMode.CEIL:
      return positive ? quotient + 1n : quotient;
    case RoundingMode.HALF_UP:
      return twiceRem >= denominator ? awayFromZero : quotient;
    case RoundingMode.HALF_EVEN:
    default:
      if (twiceRem > denominator) return awayFromZero;
      if (twiceRem < denominator) return quotient;
      return quotient % 2n === 0n ? quotient : awayFromZero;
  }
}

/**
 * Multiply an amount by a decimal rate given as a string ("0.015" = 1.5%).
 * The rate is parsed exactly, so no float is involved.
 */
export function multiplyByRate(amount, rate, mode) {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(String(rate).trim());
  if (!match) throw new MoneyError(`Invalid rate: ${rate}`);
  const [, sign, whole, fraction = ''] = match;
  const scale = 10n ** BigInt(fraction.length);
  let numerator = BigInt(whole + fraction);
  if (sign) numerator = -numerator;
  return money(divideRounded(amount.minor * numerator, scale, mode), amount.currency);
}

/** Parses a non-negative decimal string ("0.125") into an exact fraction { numerator, scale }. */
function parseRate(rate) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(rate).trim());
  if (!match) throw new MoneyError(`Invalid rate: ${rate}`);
  const [, whole, fraction = ''] = match;
  return { numerator: BigInt(whole + fraction), scale: 10n ** BigInt(fraction.length) };
}

/**
 * Simple (non-compounding) accrual: amount × annualRate × days / basis.
 * The whole calculation is one exact fraction, rounded once with the given mode.
 */
export function accrue(amount, annualRate, days, mode, basis = 365) {
  if (!Number.isSafeInteger(days) || days < 0) throw new MoneyError('days must be a non-negative integer');
  const { numerator, scale } = parseRate(annualRate);
  return money(divideRounded(amount.minor * numerator * BigInt(days), scale * BigInt(basis), mode), amount.currency);
}

/**
 * Split an amount into parts proportional to integer weights. The parts are
 * guaranteed to sum exactly to the original: remainders go to the largest
 * fractional shares first (largest-remainder method).
 */
export function allocate(amount, weights) {
  if (!weights.length) throw new MoneyError('At least one weight required');
  const big = weights.map(toBigInt);
  if (big.some((w) => w < 0n)) throw new MoneyError('Weights must be non-negative');
  const total = big.reduce((a, b) => a + b, 0n);
  if (total === 0n) throw new MoneyError('Weights must not all be zero');

  const sign = amount.minor < 0n ? -1n : 1n;
  const abs = amount.minor * sign;
  const shares = big.map((w) => ({ base: (abs * w) / total, rem: (abs * w) % total }));
  let leftover = abs - shares.reduce((a, s) => a + s.base, 0n);
  const order = shares
    .map((s, index) => ({ index, rem: s.rem }))
    .sort((x, y) => (y.rem > x.rem ? 1 : y.rem < x.rem ? -1 : x.index - y.index));
  for (const { index } of order) {
    if (leftover === 0n) break;
    shares[index].base += 1n;
    leftover -= 1n;
  }
  return shares.map((s) => money(s.base * sign, amount.currency));
}

/** JSON-safe representation for API responses. */
export function toJSON(amount) {
  return { amountMinor: amount.minor.toString(), currency: amount.currency };
}
