import { AppError, ConflictError, ValidationError } from '../../utils/errors.js';
import { fromDecimalString, money, toDecimalString } from '../../utils/money.js';

/** Money-moving actions require completed identity verification. */
export async function assertVerified(prisma, userId) {
  const profile = await prisma.investorProfile.findUnique({ where: { userId }, select: { kycStatus: true } });
  if (profile?.kycStatus !== 'APPROVED') {
    throw new AppError('Complete identity verification before moving money', { status: 403, code: 'KYC_REQUIRED' });
  }
}

export async function assertWalletActive(prisma, userId, currency) {
  const wallet = await prisma.wallet.findUnique({ where: { userId_currency: { userId, currency } } });
  if (wallet?.status === 'FROZEN') throw new ConflictError('This wallet is frozen. Contact support.', 'WALLET_FROZEN');
}

/** Parses a decimal amount for an active currency into minor units, or throws a 422 field error. */
export async function parseAmount(prisma, amount, currency, path = 'amount') {
  const cur = await prisma.currency.findUnique({ where: { code: currency } });
  const fail = (message) => new ValidationError([{ location: 'body', path, message, code: 'invalid' }]);
  if (!cur?.isActive) throw fail('This currency is not available');
  try {
    const m = fromDecimalString(String(amount), currency, { [currency]: cur.minorUnits });
    if (m.minor <= 0n) throw fail('Enter an amount greater than zero');
    return { minor: m.minor, minorUnits: cur.minorUnits };
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw fail(err.message);
  }
}

/** Human-readable amount for emails, e.g. "GHS 1,250.00". */
export function displayAmount(minor, currency, minorUnits = 2) {
  const [whole, frac] = toDecimalString(money(minor, currency), { [currency]: minorUnits }).split('.');
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`;
}

export const firstNameOf = async (tx, userId) =>
  (await tx.userProfile.findUnique({ where: { userId }, select: { firstName: true } }))?.firstName ?? 'there';
