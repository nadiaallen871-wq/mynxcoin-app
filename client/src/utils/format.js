/**
 * Display formatting only. Financial values arrive from the API as minor-unit
 * strings and are never used for calculation in the browser.
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

/**
 * Format a minor-unit amount string ("125050") with its currency exponent,
 * without converting through a JS float.
 */
export function formatMoney(amountMinor, currency, { minorUnits = 2, locale = 'en-GH' } = {}) {
  if (amountMinor === null || amountMinor === undefined) return '—';
  const raw = String(amountMinor);
  if (!/^-?\d+$/.test(raw)) throw new Error(`Invalid minor-unit amount: ${raw}`);
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).padStart(minorUnits + 1, '0');
  const whole = minorUnits ? digits.slice(0, -minorUnits) : digits;
  const fraction = minorUnits ? digits.slice(-minorUnits) : '';

  // Intl formats the integer part from a BigInt, so there is no float rounding.
  // The absolute value is formatted and the sign added separately, because -0n
  // would lose the sign of amounts such as -0.50.
  const parts = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).formatToParts(BigInt(whole));

  const decimalSep = new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.';
  const lastInteger = parts.findLast((p) => p.type === 'integer');
  let out = '';
  for (const part of parts) {
    out += part.value;
    if (part === lastInteger && fraction) out += decimalSep + fraction;
  }
  return negative && /[1-9]/.test(digits) ? `-${out}` : out;
}

export function formatDateTime(iso, locale = 'en-GH') {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
