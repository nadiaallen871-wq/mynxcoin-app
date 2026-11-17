export const DEPOSIT_STATUS = {
  INITIATED: { label: 'Starting', tone: 'neutral' },
  PENDING: { label: 'Awaiting payment', tone: 'warning' },
  SUCCEEDED: { label: 'Received', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  REVERSED: { label: 'Reversed', tone: 'danger' },
};

export const WITHDRAWAL_STATUS = {
  REQUESTED: { label: 'Under review', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'info' },
  PROCESSING: { label: 'Sending', tone: 'info' },
  COMPLETED: { label: 'Sent', tone: 'success' },
  FAILED: { label: 'Payout failed', tone: 'danger' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  RETURNED: { label: 'Returned to wallet', tone: 'neutral' },
};

export const ORDER_STATUS = {
  PENDING: { label: 'Pending confirmation', tone: 'warning' },
  PROCESSING: { label: 'Processing', tone: 'info' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  ACTIVE: { label: 'Active', tone: 'success' },
  MATURED: { label: 'Matured', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  FAILED: { label: 'Failed', tone: 'danger' },
};

export const HOLDING_STATUS = {
  ACTIVE: { label: 'Active', tone: 'success' },
  MATURITY_DUE: { label: 'Maturing', tone: 'info' },
  MATURED: { label: 'Matured', tone: 'neutral' },
};

export const RISK_FLAGS = {
  VELOCITY_24H: '3+ withdrawals in 24h',
  LARGE_AMOUNT: 'Large amount',
  NEW_DESTINATION: 'New destination',
  RECENT_DEPOSIT: 'Deposit in last 24h',
};

export const MOMO_NETWORKS = [
  { value: 'MTN', label: 'MTN Mobile Money' },
  { value: 'TELECEL', label: 'Telecel Cash' },
  { value: 'AIRTELTIGO', label: 'AirtelTigo Money' },
];

/** Common Ghanaian bank codes for the sandbox form (the provider's bank list replaces this when live). */
export const BANKS = [
  { value: 'GCB', label: 'GCB Bank' },
  { value: 'ECOBANK', label: 'Ecobank Ghana' },
  { value: 'STANBIC', label: 'Stanbic Bank' },
  { value: 'ABSA', label: 'Absa Bank Ghana' },
  { value: 'CAL', label: 'CalBank' },
  { value: 'FIDELITY', label: 'Fidelity Bank' },
];

/** One key per intended money movement, so a retried submission can never duplicate it. */
export const newIdempotencyKey = () => crypto.randomUUID();
