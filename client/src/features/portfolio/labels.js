/** Journal entry types as investors see them. */
export const ENTRY_TYPES = {
  DEPOSIT: 'Deposit',
  WITHDRAWAL_REQUEST: 'Withdrawal',
  WITHDRAWAL_RETURN: 'Withdrawal returned',
  WITHDRAWAL: 'Withdrawal paid out',
  RESERVATION: 'Reserved for order',
  RELEASE: 'Reservation released',
  INVESTMENT_CONFIRMATION: 'Investment',
  MATURITY: 'Maturity proceeds',
  REFERRAL_REWARD: 'Referral reward',
  FX_CONVERSION: 'Currency conversion',
  ADJUSTMENT: 'Adjustment',
  REVERSAL: 'Reversal',
};

export const VALUATION = {
  ACCRUED: {
    label: 'Estimated',
    tone: 'info',
    hint: 'Interest accrued at the contract rate, less fees so far. Not guaranteed until settled.',
  },
  COST: { label: 'At cost', tone: 'neutral', hint: 'No reliable price is available, so the amount invested is shown.' },
  SETTLED: { label: 'Realized', tone: 'success', hint: 'Proceeds actually received at maturity, after fees.' },
};

export const NOTIFICATION_CATEGORIES = {
  ACCOUNT: 'Account',
  SECURITY: 'Security',
  KYC: 'Verification',
  PAYMENTS: 'Deposits and withdrawals',
  INVESTMENTS: 'Investments',
  REFERRALS: 'Referrals',
  SUPPORT: 'Support',
};

export const DOCUMENT_KINDS = {
  ACCOUNT_STATEMENT: 'Account statement',
  PORTFOLIO_STATEMENT: 'Portfolio statement',
  TRANSACTION_REPORT: 'Transaction report',
  INVESTMENT_CONFIRMATION: 'Investment confirmation',
  DEPOSIT_RECEIPT: 'Deposit receipt',
  WITHDRAWAL_RECEIPT: 'Withdrawal receipt',
  TAX_STATEMENT: 'Tax statement',
};

export const REFERRAL_STATUS = {
  PENDING: { label: 'Signed up', tone: 'neutral' },
  QUALIFIED: { label: 'Being checked', tone: 'warning' },
  REWARDED: { label: 'Rewarded', tone: 'success' },
  REJECTED: { label: 'Not rewarded', tone: 'danger' },
  NOT_ELIGIBLE: { label: 'Not eligible', tone: 'neutral' },
};

export const TICKET_STATUS = {
  OPEN: { label: 'Open', tone: 'info' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  AWAITING_CUSTOMER: { label: 'Awaiting your reply', staffLabel: 'Awaiting customer', tone: 'warning' },
  ESCALATED: { label: 'Escalated', tone: 'danger' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

export const TICKET_CATEGORIES = {
  ACCOUNT: 'My account',
  VERIFICATION: 'Identity verification',
  DEPOSITS: 'Deposits',
  WITHDRAWALS: 'Withdrawals',
  INVESTMENTS: 'Investments',
  TECHNICAL: 'Something is not working',
  COMPLAINT: 'Make a complaint',
  OTHER: 'Something else',
};

export const TICKET_PRIORITY = {
  LOW: { label: 'Low', tone: 'neutral' },
  NORMAL: { label: 'Normal', tone: 'neutral' },
  HIGH: { label: 'High', tone: 'warning' },
  URGENT: { label: 'Urgent', tone: 'danger' },
};

export const KYC_STATUS = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  UNDER_REVIEW: { label: 'Under review', tone: 'info' },
  RESUBMISSION_REQUIRED: { label: 'Action needed', tone: 'warning' },
  APPROVED: { label: 'Verified', tone: 'success' },
  REJECTED: { label: 'Not approved', tone: 'danger' },
};
