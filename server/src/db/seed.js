import { CONFLICTING_PERMISSIONS, PERMISSIONS, ROLES } from '../config/permissions.js';

/**
 * Idempotent seed: syncs the permission catalogue, system roles, currencies and
 * default settings. It is safe to run repeatedly in every environment. It never
 * creates users and never inserts financial data.
 */

const CURRENCIES = [
  { code: 'GHS', name: 'Ghana Cedi', symbol: 'GH₵', minorUnits: 2, isActive: true },
  { code: 'USD', name: 'US Dollar', symbol: '$', minorUnits: 2, isActive: false },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', minorUnits: 2, isActive: false },
];

/** Default marketplace categories (reference data only: no products are seeded). */
const CATEGORIES = [
  { slug: 'government-securities', name: 'Government securities', description: 'Treasury bills and government bonds', sortOrder: 10 },
  { slug: 'fixed-income', name: 'Fixed income', description: 'Corporate bonds, fixed deposits and fixed-income funds', sortOrder: 20 },
  { slug: 'money-market', name: 'Money market', description: 'Short-term, lower-risk funds', sortOrder: 30 },
  { slug: 'equities', name: 'Equities', description: 'Equity and balanced funds', sortOrder: 40 },
  { slug: 'real-estate', name: 'Real estate', description: 'Property-backed investments', sortOrder: 50 },
];

/**
 * System chart of accounts, created for every currency. Customer wallet accounts
 * (2000/2010) are created per user on demand. Draft structure for accountant review
 * (see documentation/financial-ledger.md).
 */
export const CHART_OF_ACCOUNTS = [
  { code: '1000', name: 'Operational cash: bank', type: 'ASSET', normalBalance: 'DEBIT', purpose: 'OPERATIONAL_BANK' },
  { code: '1010', name: 'Client money: bank (segregated)', type: 'ASSET', normalBalance: 'DEBIT', purpose: 'CLIENT_MONEY_BANK' },
  { code: '1100', name: 'Payment clearing', type: 'ASSET', normalBalance: 'DEBIT', purpose: 'PAYMENT_CLEARING' },
  { code: '1200', name: 'Investment positions at custodian', type: 'ASSET', normalBalance: 'DEBIT', purpose: 'INVESTMENT_POSITIONS' },
  { code: '2100', name: 'Withdrawals payable', type: 'LIABILITY', normalBalance: 'CREDIT', purpose: 'WITHDRAWALS_PAYABLE' },
  { code: '2200', name: 'Investment subscriptions pending', type: 'LIABILITY', normalBalance: 'CREDIT', purpose: 'SUBSCRIPTIONS_PENDING' },
  { code: '2300', name: 'Customer investment holdings', type: 'LIABILITY', normalBalance: 'CREDIT', purpose: 'CUSTOMER_HOLDINGS' },
  { code: '3000', name: 'Retained earnings', type: 'EQUITY', normalBalance: 'CREDIT', purpose: 'RETAINED_EARNINGS' },
  { code: '3900', name: 'Manual adjustments (maker-checker)', type: 'CLEARING', normalBalance: 'DEBIT', purpose: 'MANUAL_ADJUSTMENTS' },
  { code: '4000', name: 'Fee income: management', type: 'REVENUE', normalBalance: 'CREDIT', purpose: 'FEE_INCOME_MANAGEMENT' },
  {
    code: '4010',
    name: 'Fee income: transaction and withdrawal',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    purpose: 'FEE_INCOME_TRANSACTION',
  },
  { code: '5000', name: 'Payment provider charges', type: 'EXPENSE', normalBalance: 'DEBIT', purpose: 'PROVIDER_CHARGES' },
  { code: '5100', name: 'Referral rewards expense', type: 'EXPENSE', normalBalance: 'DEBIT', purpose: 'REFERRAL_EXPENSE' },
  { code: '9000', name: 'FX clearing', type: 'CLEARING', normalBalance: 'DEBIT', purpose: 'FX_CLEARING' },
];

const SETTINGS = [
  { key: 'platform.maintenance_mode', value: false, description: 'When true, investor write operations are disabled' },
  { key: 'platform.base_currency', value: 'GHS', description: 'Reporting currency for platform-level summaries' },
  {
    key: 'platform.go_live_approved',
    value: false,
    description: 'Set only after every go-live prerequisite is signed off',
    isSensitive: true,
  },
];

export function assertNoConflicts(roles = ROLES) {
  for (const [key, role] of Object.entries(roles)) {
    for (const [a, b] of CONFLICTING_PERMISSIONS) {
      if (role.permissions.includes(a) && role.permissions.includes(b)) {
        throw new Error(`Role ${key} violates separation of duties: ${a} + ${b}`);
      }
    }
    for (const p of role.permissions) {
      if (!PERMISSIONS[p]) throw new Error(`Role ${key} references unknown permission ${p}`);
    }
  }
}

export async function seed(client) {
  assertNoConflicts();

  await client.$transaction(async (tx) => {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await tx.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
    }
    const permissionIds = Object.fromEntries((await tx.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]));

    for (const [key, def] of Object.entries(ROLES)) {
      const role = await tx.role.upsert({
        where: { key },
        update: { name: def.name, description: def.description, isSystem: true },
        create: { key, name: def.name, description: def.description, isSystem: true },
      });
      // System role grants are owned by code: the seed adds missing grants and removes stale ones.
      const wanted = new Set(def.permissions.map((p) => permissionIds[p]));
      await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: [...wanted] } } });
      await tx.rolePermission.createMany({
        data: [...wanted].map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }

    for (const c of CURRENCIES) {
      await tx.currency.upsert({
        where: { code: c.code },
        update: { name: c.name, symbol: c.symbol, minorUnits: c.minorUnits },
        create: c,
      });
    }
    for (const s of SETTINGS) {
      // Never overwrite an operator-changed value. Only create missing keys.
      await tx.systemSetting.upsert({ where: { key: s.key }, update: {}, create: s });
    }
    for (const currency of CURRENCIES.map((c) => c.code)) {
      for (const a of CHART_OF_ACCOUNTS) {
        const exists = await tx.ledgerAccount.findFirst({ where: { purpose: a.purpose, currency, ownerUserId: null } });
        if (!exists) await tx.ledgerAccount.create({ data: { ...a, currency, allowNegative: true } });
      }
    }
    for (const c of CATEGORIES) {
      // Create only. Staff may rename or deactivate categories afterwards.
      await tx.investmentCategory.upsert({ where: { slug: c.slug }, update: {}, create: c });
    }
  });

  return {
    permissions: Object.keys(PERMISSIONS).length,
    roles: Object.keys(ROLES).length,
    currencies: CURRENCIES.length,
    settings: SETTINGS.length,
    categories: CATEGORIES.length,
    ledgerAccounts: CHART_OF_ACCOUNTS.length * CURRENCIES.length,
  };
}
