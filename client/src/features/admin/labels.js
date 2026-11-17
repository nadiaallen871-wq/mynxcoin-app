export const APPROVAL_STATUS = {
  PENDING: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Approved and applied', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  CANCELLED: { label: 'Withdrawn', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  FAILED: { label: 'Could not be applied', tone: 'danger' },
};

export const APPROVAL_TYPES = {
  SETTING_CHANGE: 'Setting change',
  ROLE_GRANT: 'Role grant',
  CURRENCY_STATUS: 'Currency change',
  TAX_RULE: 'Tax rule',
};

export const ALERT_RULES = {
  LARGE_DEPOSIT: 'Large deposit',
  AMOUNT_MISMATCH: 'Provider amount mismatch',
  WITHDRAWAL_RISK_FLAGS: 'Withdrawal with several risk flags',
  PASS_THROUGH: 'Money in and straight out',
  SUSPICIOUS_LOGIN: 'Suspicious sign-in',
  REFERRAL_ABUSE_SIGNAL: 'Referral abuse signal',
};

export const SEVERITY = {
  LOW: { label: 'Low', tone: 'neutral' },
  MEDIUM: { label: 'Medium', tone: 'warning' },
  HIGH: { label: 'High', tone: 'danger' },
};

export const ALERT_STATUS = {
  OPEN: { label: 'Open', tone: 'warning' },
  DISMISSED: { label: 'Dismissed', tone: 'neutral' },
  ESCALATED: { label: 'Escalated to case', tone: 'info' },
};

export const CASE_TYPES = {
  AML: 'Anti-money laundering',
  SANCTIONS: 'Sanctions',
  PEP: 'Politically exposed person',
  FRAUD: 'Fraud',
  KYC: 'Identity (KYC)',
  OTHER: 'Other',
};

export const CASE_STATUS = {
  OPEN: { label: 'Open', tone: 'warning' },
  INVESTIGATING: { label: 'Investigating', tone: 'info' },
  ESCALATED: { label: 'Escalated', tone: 'danger' },
  CLOSED_NO_ACTION: { label: 'Closed: no action', tone: 'neutral' },
  CLOSED_ACTION_TAKEN: { label: 'Closed: action taken', tone: 'success' },
};

export const CASE_PRIORITY = {
  LOW: { label: 'Low', tone: 'neutral' },
  NORMAL: { label: 'Normal', tone: 'neutral' },
  HIGH: { label: 'High', tone: 'warning' },
  CRITICAL: { label: 'Critical', tone: 'danger' },
};

export const CASE_EVENTS = {
  OPENED: 'Case opened',
  NOTE: 'Note',
  ALERT_LINKED: 'Alert linked',
  STATUS_CHANGED: 'Status changed',
  OUTCOME_RECORDED: 'Outcome recorded',
  PRIORITY_CHANGED: 'Priority changed',
  ASSIGNED: 'Assignment changed',
  REPORT_RECORDED: 'Regulatory report recorded',
  RISK_RATING_CHANGED: 'Risk rating changed',
  WALLET_FROZEN: 'Wallet frozen',
  WALLET_UNFROZEN: 'Wallet unfrozen',
};

export const REPORTS = {
  'financial-summary': {
    label: 'Financial summary',
    description: 'Deposits, withdrawals, investments, maturities, fees and referral rewards by day.',
  },
  investors: { label: 'Investor activity', description: 'New investors and identity verifications by day.' },
  investments: { label: 'Investments by product', description: 'Orders confirmed in the period and current active principal per product.' },
  transactions: {
    label: 'Journal entries',
    description: 'Every ledger entry posted in the period (up to 10,000 rows). For regulatory and audit requests.',
  },
};

export const PENDING_LABELS = {
  approvalRequests: { label: 'Approval requests', to: '/admin/approvals' },
  ledgerAdjustments: { label: 'Ledger adjustments', to: '/admin/ledger' },
  kycReviews: { label: 'KYC reviews', to: '/admin/kyc' },
  withdrawals: { label: 'Withdrawals to review', to: '/admin/payments' },
  orders: { label: 'Orders to confirm', to: '/admin/orders' },
  referrals: { label: 'Referrals held', to: '/admin/referrals' },
  unassignedTickets: { label: 'Unassigned tickets', to: '/admin/support' },
  monitoringAlerts: { label: 'Monitoring alerts', to: '/admin/compliance' },
};
