/** Human-readable labels for onboarding and KYC enums, shared by investor and admin screens. */
export const KYC_STATUS = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  UNDER_REVIEW: { label: 'Under review', tone: 'warning' },
  RESUBMISSION_REQUIRED: { label: 'Action needed', tone: 'warning' },
  APPROVED: { label: 'Verified', tone: 'success' },
  REJECTED: { label: 'Not approved', tone: 'danger' },
};

export const DOC_STATUS = {
  MISSING: { label: 'Missing', tone: 'neutral' },
  UPLOADED: { label: 'Uploaded', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

export const SCREENING_STATUS = {
  CLEAR: { label: 'Clear', tone: 'success' },
  POTENTIAL_MATCH: { label: 'Potential match', tone: 'danger' },
  ERROR: { label: 'Error', tone: 'warning' },
};

export const DOCUMENT_TYPES = {
  IDENTITY_FRONT: { label: 'Identity document (front)', hint: 'A clear photo or scan of the front of the ID you entered.' },
  IDENTITY_BACK: { label: 'Identity document (back)', hint: 'The back of your Ghana Card, driver’s licence or voter ID.' },
  PROOF_OF_ADDRESS: {
    label: 'Proof of address',
    hint: 'A utility bill, bank statement or tenancy agreement from the last 3 months showing your name and address.',
  },
  SELFIE: { label: 'Selfie', hint: 'A photo of your face in good light. No hats or sunglasses.' },
  CERTIFICATE_OF_INCORPORATION: { label: 'Certificate of incorporation', hint: 'Issued by the Registrar of Companies.' },
  OTHER: { label: 'Other document', hint: '' },
};

export const ID_TYPES = { GHANA_CARD: 'Ghana Card', PASSPORT: 'Passport', DRIVERS_LICENSE: 'Driver’s licence', VOTER_ID: 'Voter ID' };
export const EMPLOYMENT = {
  EMPLOYED: 'Employed',
  SELF_EMPLOYED: 'Self-employed',
  UNEMPLOYED: 'Not employed',
  RETIRED: 'Retired',
  STUDENT: 'Student',
  OTHER: 'Other',
};
export const INCOME_BANDS = {
  UNDER_12K: 'Under GH₵ 12,000',
  FROM_12K_TO_60K: 'GH₵ 12,000 – 60,000',
  FROM_60K_TO_240K: 'GH₵ 60,000 – 240,000',
  FROM_240K_TO_1M: 'GH₵ 240,000 – 1,000,000',
  OVER_1M: 'Over GH₵ 1,000,000',
};
export const SOURCES = {
  SALARY: 'Salary or wages',
  BUSINESS_INCOME: 'Business income',
  SAVINGS: 'Savings',
  INVESTMENTS: 'Investment returns',
  INHERITANCE: 'Inheritance',
  GIFT: 'Gift',
  PENSION: 'Pension',
  SALE_OF_PROPERTY: 'Sale of property',
  OTHER: 'Other',
};
export const OBJECTIVES = {
  CAPITAL_PRESERVATION: 'Protect my capital',
  INCOME: 'Regular income',
  BALANCED_GROWTH: 'Balanced growth',
  LONG_TERM_GROWTH: 'Long-term growth',
  RETIREMENT: 'Retirement',
  EDUCATION: 'Education',
};
export const EXPERIENCE = {
  NONE: 'None',
  LIMITED: 'Limited (under 2 years)',
  MODERATE: 'Moderate (2–5 years)',
  EXTENSIVE: 'Extensive (over 5 years)',
};
export const RISK_PROFILES = {
  CONSERVATIVE: 'Conservative',
  MODERATELY_CONSERVATIVE: 'Moderately conservative',
  BALANCED: 'Balanced',
  GROWTH: 'Growth',
  AGGRESSIVE: 'Aggressive',
};
export const COUNTRIES = {
  GH: 'Ghana',
  NG: 'Nigeria',
  CI: 'Côte d’Ivoire',
  TG: 'Togo',
  BF: 'Burkina Faso',
  KE: 'Kenya',
  ZA: 'South Africa',
  GB: 'United Kingdom',
  US: 'United States',
  CA: 'Canada',
  DE: 'Germany',
  CN: 'China',
  IN: 'India',
};
export const GH_REGIONS = [
  'Greater Accra',
  'Ashanti',
  'Central',
  'Eastern',
  'Western',
  'Western North',
  'Volta',
  'Oti',
  'Northern',
  'Savannah',
  'North East',
  'Upper East',
  'Upper West',
  'Bono',
  'Bono East',
  'Ahafo',
];

export const SECTION_LABELS = {
  contact: 'Contact details',
  personal: 'Personal and identity details',
  address: 'Residential address',
  financial: 'Employment and source of funds',
  investment: 'Investment profile',
  institution: 'Organisation details',
  declarations: 'Declarations',
  riskAssessment: 'Risk questionnaire',
  documents: 'Documents',
};

export const options = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
