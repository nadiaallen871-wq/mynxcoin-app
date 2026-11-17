/**
 * Permission catalogue and default role grants.
 *
 * Permission keys follow `resource:action[:scope]`. The `:own` scope means the
 * actor's own records, and `:any` means any user's records. The seed script syncs
 * this catalogue into the `permissions`, `roles` and `role_permissions` tables.
 * Runtime checks read from the database, so administrators can adjust grants
 * (with audit). System roles cannot be deleted.
 *
 * Separation of duties: no default role holds both the `:initiate` and
 * `:approve` permission for the same financial action.
 */
export const PERMISSIONS = Object.freeze({
  // Users and access
  'users:read:any': 'View any user account',
  'users:manage': 'Create, suspend and reactivate user accounts',
  'roles:read': 'View roles and permissions',
  'roles:manage': 'Create, edit and assign roles and permissions',
  'sessions:revoke:any': "Revoke any user's sessions",

  // Investor self-service
  'profile:read:own': 'View own profile',
  'profile:update:own': 'Update own profile',
  'wallet:read:own': 'View own wallet and transactions',
  'deposits:create:own': 'Initiate own deposits',
  'withdrawals:create:own': 'Request own withdrawals',
  'investments:order:own': 'Place own investment orders',
  'portfolio:read:own': 'View own portfolio',
  'documents:read:own': 'View own documents',
  'kyc:submit:own': 'Submit own KYC application',
  'referrals:read:own': 'View own referrals',
  'support:tickets:own': 'Create and reply to own support tickets',
  'fx:convert:own': 'Convert between own currency wallets',

  // Onboarding and compliance
  'kyc:read:any': 'View KYC applications and documents',
  'kyc:review': 'Approve, reject or request resubmission of KYC applications',
  'compliance:cases:read': 'View compliance cases',
  'compliance:cases:manage': 'Open, escalate and resolve compliance cases',
  'fraud:alerts:read': 'View fraud alerts',
  'fraud:alerts:manage': 'Triage fraud alerts',

  // Products
  'products:read:any': 'View all products including drafts',
  'products:manage': 'Create and edit investment products',
  'products:publish': 'Publish, suspend and archive investment products',

  // Finance
  'wallet:read:any': 'View any wallet and transaction history',
  'deposits:read:any': 'View all deposits',
  'deposits:review': 'Review flagged deposits',
  'withdrawals:read:any': 'View all withdrawals',
  'withdrawals:approve': 'Approve or reject withdrawals (checker)',
  'ledger:read': 'View ledger accounts and journals',
  'ledger:adjustment:initiate': 'Propose a manual ledger adjustment (maker)',
  'ledger:adjustment:approve': 'Approve a manual ledger adjustment (checker)',
  'reconciliation:run': 'Run and resolve reconciliations',
  'investments:orders:read:any': 'View all investment orders',
  'investments:orders:manage': 'Confirm, allocate or reject investment orders',
  'fees:manage': 'Manage fee schedules',
  'fx:manage': 'Refresh exchange rates, view FX positions and request currency changes',
  'tax:rules:manage': 'Propose tax rules for tax statements',

  // Support
  'support:tickets:read:any': 'View all support tickets',
  'support:tickets:manage': 'Assign, reply to and resolve support tickets',
  'support:faq:manage': 'Manage FAQ content',

  // Platform
  'admin:dashboard': 'Access the admin dashboard',
  'reports:read': 'View and export reports',
  'audit:read': 'View audit logs',
  'settings:read': 'View system settings',
  'settings:manage': 'Propose system setting changes',
  'approvals:decide': 'Decide maker-checker approval requests',
  'notifications:manage': 'Manage notification templates',
  'referrals:manage': 'Manage referral campaigns and rewards',
});

const INVESTOR_SELF_SERVICE = [
  'profile:read:own',
  'profile:update:own',
  'wallet:read:own',
  'deposits:create:own',
  'withdrawals:create:own',
  'investments:order:own',
  'portfolio:read:own',
  'documents:read:own',
  'kyc:submit:own',
  'referrals:read:own',
  'support:tickets:own',
  'fx:convert:own',
];

const READ_ONLY_OVERSIGHT = [
  'admin:dashboard',
  'users:read:any',
  'roles:read',
  'kyc:read:any',
  'compliance:cases:read',
  'fraud:alerts:read',
  'products:read:any',
  'wallet:read:any',
  'deposits:read:any',
  'withdrawals:read:any',
  'ledger:read',
  'investments:orders:read:any',
  'reports:read',
  'audit:read',
  'settings:read',
];

export const ROLES = Object.freeze({
  SUPER_ADMIN: {
    name: 'Super Administrator',
    description: 'Full platform governance. Financial actions still require a second approver.',
    // Holds every permission except the maker side of ledger adjustments, so a
    // super admin can never create and approve the same adjustment.
    permissions: Object.keys(PERMISSIONS).filter((p) => !p.endsWith(':own') && p !== 'ledger:adjustment:initiate'),
  },
  ADMIN: {
    name: 'Administrator',
    description: 'Day-to-day platform administration',
    permissions: [
      ...READ_ONLY_OVERSIGHT,
      'users:manage',
      'sessions:revoke:any',
      'products:manage',
      'support:tickets:read:any',
      'support:faq:manage',
      'notifications:manage',
      'settings:manage',
      'referrals:manage',
    ],
  },
  OPERATIONS_MANAGER: {
    name: 'Operations Manager',
    description: 'Oversees operations, approvals and reconciliation',
    permissions: [...READ_ONLY_OVERSIGHT, 'deposits:review', 'investments:orders:manage', 'approvals:decide', 'support:tickets:read:any'],
  },
  FINANCE_OFFICER: {
    name: 'Finance Officer',
    description: 'Handles withdrawals, ledger adjustments (maker) and reconciliation',
    permissions: [
      'admin:dashboard',
      'wallet:read:any',
      'deposits:read:any',
      'deposits:review',
      'withdrawals:read:any',
      'withdrawals:approve',
      'ledger:read',
      'ledger:adjustment:initiate',
      'reconciliation:run',
      'fees:manage',
      'fx:manage',
      'tax:rules:manage',
      'reports:read',
    ],
  },
  COMPLIANCE_OFFICER: {
    name: 'Compliance Officer',
    description: 'KYC review, AML monitoring and compliance cases',
    permissions: [
      'admin:dashboard',
      'users:read:any',
      'kyc:read:any',
      'kyc:review',
      'compliance:cases:read',
      'compliance:cases:manage',
      'fraud:alerts:read',
      'fraud:alerts:manage',
      'deposits:read:any',
      'withdrawals:read:any',
      'reports:read',
      'audit:read',
    ],
  },
  SUPPORT_AGENT: {
    name: 'Customer Support Agent',
    description: 'Handles support tickets. No access to financial or identity data.',
    permissions: ['admin:dashboard', 'support:tickets:read:any', 'support:tickets:manage'],
  },
  INVESTMENT_MANAGER: {
    name: 'Investment Manager',
    description: 'Manages investment products and order allocation',
    permissions: [
      'admin:dashboard',
      'products:read:any',
      'products:manage',
      'products:publish',
      'investments:orders:read:any',
      'investments:orders:manage',
      'reports:read',
    ],
  },
  AUDITOR: {
    name: 'Auditor',
    description: 'Read-only access to records, ledger and audit trails',
    permissions: READ_ONLY_OVERSIGHT,
  },
  INDIVIDUAL_INVESTOR: {
    name: 'Individual Investor',
    description: 'Retail investor account',
    permissions: INVESTOR_SELF_SERVICE,
  },
  INSTITUTIONAL_INVESTOR: {
    name: 'Institutional Investor',
    description: 'Eligible organisation investing on its own account',
    permissions: INVESTOR_SELF_SERVICE,
  },
});

/** Pairs that must never be granted to the same role (separation of duties). */
export const CONFLICTING_PERMISSIONS = Object.freeze([
  ['ledger:adjustment:initiate', 'ledger:adjustment:approve'],
  ['withdrawals:create:own', 'withdrawals:approve'],
]);
