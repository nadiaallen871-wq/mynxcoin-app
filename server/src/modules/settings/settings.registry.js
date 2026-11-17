/**
 * Every system setting the platform understands. A setting that is not listed here
 * cannot be read or changed through the API. Values are validated against their
 * definition before a change request is accepted, and again when it is applied.
 *
 * `editable: false` settings are shown but cannot be changed from the admin console
 * (they need a deployment or a go-live sign-off outside the application).
 */
export const SETTINGS = [
  {
    key: 'platform.maintenance_mode',
    group: 'Platform',
    type: 'boolean',
    default: false,
    description: 'When on, investors cannot deposit, withdraw or place orders. Reading and signing in still work.',
  },
  {
    key: 'platform.announcement',
    group: 'Platform',
    type: 'string',
    default: '',
    maxLength: 300,
    description: 'Short notice shown to every visitor at the top of the site. Leave empty for none.',
  },
  {
    key: 'platform.base_currency',
    group: 'Platform',
    type: 'string',
    default: 'GHS',
    editable: false,
    description: 'Reporting currency for platform-level summaries.',
  },
  {
    key: 'platform.go_live_approved',
    group: 'Platform',
    type: 'boolean',
    default: false,
    editable: false,
    sensitive: true,
    description: 'Set only after every go-live prerequisite is signed off. Cannot be changed from the console.',
  },
  {
    key: 'payments.deposit_min_minor',
    group: 'Payments',
    type: 'money',
    default: 1000,
    min: 100,
    max: 100_000_00,
    description: 'Smallest deposit.',
  },
  {
    key: 'payments.deposit_max_minor',
    group: 'Payments',
    type: 'money',
    default: 5_000_000,
    min: 1000,
    max: 1_000_000_00,
    description: 'Largest single deposit.',
  },
  {
    key: 'payments.withdrawal_min_minor',
    group: 'Payments',
    type: 'money',
    default: 1000,
    min: 100,
    max: 100_000_00,
    description: 'Smallest withdrawal.',
  },
  {
    key: 'payments.withdrawal_fee_minor',
    group: 'Fees',
    type: 'money',
    default: 0,
    min: 0,
    max: 100_00,
    description: 'Flat fee charged on each withdrawal.',
  },
  {
    key: 'payments.large_withdrawal_minor',
    group: 'Risk',
    type: 'money',
    default: 1_000_000,
    min: 1000,
    max: 1_000_000_00,
    description: 'Withdrawals at or above this amount are flagged "Large amount" for the reviewer.',
  },
  {
    key: 'monitoring.large_deposit_minor',
    group: 'Risk',
    type: 'money',
    default: 2_000_000,
    min: 1000,
    max: 1_000_000_00,
    description: 'Deposits at or above this amount raise a monitoring alert.',
  },
  {
    key: 'monitoring.pass_through_hours',
    group: 'Risk',
    type: 'integer',
    default: 48,
    min: 1,
    max: 720,
    description: 'A withdrawal of most of the money deposited within this many hours, with no investment in between, raises an alert.',
  },
  {
    key: 'fx.conversions_enabled',
    group: 'Currency exchange',
    type: 'boolean',
    default: true,
    description: 'When off, investors cannot convert between their currency wallets.',
  },
  {
    key: 'fx.spread_bps',
    group: 'Fees',
    type: 'integer',
    default: 150,
    min: 0,
    max: 1000,
    description: 'Conversion fee in basis points of the amount converted (150 = 1.5%).',
  },
  {
    key: 'fx.max_rate_age_minutes',
    group: 'Currency exchange',
    type: 'integer',
    default: 60,
    min: 1,
    max: 1440,
    description: 'Rates older than this are refreshed from the provider before a quote is given.',
  },
  {
    key: 'risk.concentration_threshold_bps',
    group: 'Risk',
    type: 'integer',
    default: 4000,
    min: 500,
    max: 10_000,
    description: 'Products or issuers holding more than this share of customer investments are flagged (4000 = 40%).',
  },
  {
    key: 'risk.high_risk_level',
    group: 'Risk',
    type: 'integer',
    default: 5,
    min: 2,
    max: 7,
    description: 'Products at or above this risk level count as high risk in portfolio metrics.',
  },
  {
    key: 'support.first_response_target_hours',
    group: 'Support',
    type: 'integer',
    default: 24,
    min: 1,
    max: 168,
    description: 'Target time for the first reply. Tickets past it are counted as overdue in the support report.',
  },
];

export const SETTINGS_BY_KEY = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));

/** Returns an error message, or null if the value is valid for the setting. */
export function validateSettingValue(def, value) {
  if (!def) return 'Unknown setting';
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Must be on or off';
    case 'string':
      if (typeof value !== 'string') return 'Must be text';
      return value.length > (def.maxLength ?? 500) ? `At most ${def.maxLength ?? 500} characters` : null;
    case 'integer':
    case 'money':
      if (!Number.isSafeInteger(value)) return 'Must be a whole number';
      if (def.min !== undefined && value < def.min) return `Must be at least ${def.min}`;
      if (def.max !== undefined && value > def.max) return `Must be at most ${def.max}`;
      return null;
    default:
      return 'Unsupported setting type';
  }
}

/** Cross-setting rules checked against the full set of values that would result from a change. */
export function crossCheck(values) {
  if (values['payments.deposit_max_minor'] < values['payments.deposit_min_minor']) return 'The maximum deposit cannot be below the minimum';
  if (values['payments.withdrawal_fee_minor'] >= values['payments.withdrawal_min_minor'])
    return 'The withdrawal fee must be smaller than the minimum withdrawal';
  return null;
}
