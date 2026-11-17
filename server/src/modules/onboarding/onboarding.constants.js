/**
 * Onboarding reference data and the suitability (risk) questionnaire.
 * The questionnaire is served to the client and scored only on the server.
 * Changing questions or points requires a new version string.
 */
export const SOURCE_OF_FUNDS = [
  'SALARY',
  'BUSINESS_INCOME',
  'SAVINGS',
  'INVESTMENTS',
  'INHERITANCE',
  'GIFT',
  'PENSION',
  'SALE_OF_PROPERTY',
  'OTHER',
];
export const INVESTMENT_OBJECTIVES = ['CAPITAL_PRESERVATION', 'INCOME', 'BALANCED_GROWTH', 'LONG_TERM_GROWTH', 'RETIREMENT', 'EDUCATION'];
export const EMPLOYMENT_STATUSES = ['EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'RETIRED', 'STUDENT', 'OTHER'];
export const INCOME_BANDS = ['UNDER_12K', 'FROM_12K_TO_60K', 'FROM_60K_TO_240K', 'FROM_240K_TO_1M', 'OVER_1M'];
export const EXPERIENCE_LEVELS = ['NONE', 'LIMITED', 'MODERATE', 'EXTENSIVE'];
export const ID_TYPES = ['GHANA_CARD', 'PASSPORT', 'DRIVERS_LICENSE', 'VOTER_ID'];
export const DOCUMENT_TYPES = ['IDENTITY_FRONT', 'IDENTITY_BACK', 'PROOF_OF_ADDRESS', 'SELFIE', 'CERTIFICATE_OF_INCORPORATION', 'OTHER'];

/** Identity number formats per document type (Ghana Card: GHA-123456789-0). */
export const ID_NUMBER_PATTERNS = {
  GHANA_CARD: /^GHA-\d{9}-\d$/,
  PASSPORT: /^[A-Z0-9]{6,9}$/,
  DRIVERS_LICENSE: /^[A-Z0-9-]{6,20}$/,
  VOTER_ID: /^\d{10}$/,
};

/** Card-type IDs have a back side that must also be uploaded. */
const ID_TYPES_WITH_BACK = new Set(['GHANA_CARD', 'DRIVERS_LICENSE', 'VOTER_ID']);

export function requiredDocumentTypes({ userType, idType }) {
  const types = ['IDENTITY_FRONT', 'PROOF_OF_ADDRESS', 'SELFIE'];
  if (ID_TYPES_WITH_BACK.has(idType)) types.splice(1, 0, 'IDENTITY_BACK');
  if (userType === 'INSTITUTIONAL') types.push('CERTIFICATE_OF_INCORPORATION');
  return types;
}

export const MINIMUM_AGE = 18;

export const RISK_QUESTIONNAIRE = Object.freeze({
  version: '2026.1',
  questions: [
    {
      id: 'horizon',
      text: 'How long do you expect to keep this money invested?',
      options: [
        { id: 'lt1', label: 'Less than 1 year', points: 0 },
        { id: '1to3', label: '1 to 3 years', points: 2 },
        { id: '3to5', label: '3 to 5 years', points: 4 },
        { id: '5to10', label: '5 to 10 years', points: 6 },
        { id: 'gt10', label: 'More than 10 years', points: 8 },
      ],
    },
    {
      id: 'drawdown',
      text: 'Your investment falls 20% in a few months. What would you most likely do?',
      options: [
        { id: 'sell_all', label: 'Sell everything to avoid further losses', points: 0 },
        { id: 'sell_some', label: 'Sell some of it', points: 2 },
        { id: 'hold', label: 'Hold and wait for a recovery', points: 5 },
        { id: 'buy_more', label: 'Invest more while prices are lower', points: 8 },
      ],
    },
    {
      id: 'objective',
      text: 'What is your main goal for this investment?',
      options: [
        { id: 'preserve', label: 'Protect what I have', points: 0 },
        { id: 'income', label: 'Earn regular income', points: 3 },
        { id: 'balanced', label: 'A balance of income and growth', points: 5 },
        { id: 'growth', label: 'Grow my money over the long term', points: 8 },
      ],
    },
    {
      id: 'emergency_fund',
      text: 'How many months of expenses do you have in savings outside this investment?',
      options: [
        { id: 'none', label: 'None', points: 0, capacityCap: 'MODERATELY_CONSERVATIVE' },
        { id: 'lt3', label: 'Less than 3 months', points: 2 },
        { id: '3to6', label: '3 to 6 months', points: 5 },
        { id: 'gt6', label: 'More than 6 months', points: 8 },
      ],
    },
    {
      id: 'share_of_wealth',
      text: 'What share of your total savings and investments would this be?',
      options: [
        { id: 'gt50', label: 'More than half', points: 0, capacityCap: 'MODERATELY_CONSERVATIVE' },
        { id: '25to50', label: '25% to 50%', points: 2 },
        { id: '10to25', label: '10% to 25%', points: 5 },
        { id: 'lt10', label: 'Less than 10%', points: 8 },
      ],
    },
    {
      id: 'knowledge',
      text: 'How would you describe your knowledge of investments?',
      options: [
        { id: 'none', label: 'I am new to investing', points: 0 },
        { id: 'basic', label: 'I understand the basics', points: 3 },
        { id: 'good', label: 'I am comfortable with most investment types', points: 6 },
        { id: 'advanced', label: 'I have advanced or professional knowledge', points: 8 },
      ],
    },
    {
      id: 'income_stability',
      text: 'How stable is your income?',
      options: [
        { id: 'unstable', label: 'Unstable or irregular', points: 0 },
        { id: 'somewhat', label: 'Somewhat stable', points: 3 },
        { id: 'stable', label: 'Stable', points: 6 },
        { id: 'very_stable', label: 'Very stable and likely to grow', points: 8 },
      ],
    },
    {
      id: 'loss_tolerance',
      text: 'What is the largest one-year loss you could accept without changing your plans?',
      options: [
        { id: 'none', label: 'I cannot accept any loss', points: 0 },
        { id: 'up5', label: 'Up to 5%', points: 2 },
        { id: 'up15', label: 'Up to 15%', points: 5 },
        { id: 'up30', label: '30% or more', points: 8 },
      ],
    },
  ],
});

export const RISK_PROFILE_ORDER = ['CONSERVATIVE', 'MODERATELY_CONSERVATIVE', 'BALANCED', 'GROWTH', 'AGGRESSIVE'];

/**
 * Scores answers on 0–100 and maps them to a profile. Capacity for loss caps the
 * result: someone with no emergency savings, or investing most of their wealth,
 * is never classed above "moderately conservative", whatever their stated appetite.
 * Throws on a missing or unknown answer.
 */
export function scoreQuestionnaire(answers, questionnaire = RISK_QUESTIONNAIRE) {
  let points = 0;
  let max = 0;
  let cap = null;
  for (const q of questionnaire.questions) {
    const option = q.options.find((o) => o.id === answers?.[q.id]);
    if (!option) throw new Error(`Missing or invalid answer for "${q.id}"`);
    points += option.points;
    max += Math.max(...q.options.map((o) => o.points));
    if (option.capacityCap && (cap === null || RISK_PROFILE_ORDER.indexOf(option.capacityCap) < RISK_PROFILE_ORDER.indexOf(cap))) {
      cap = option.capacityCap;
    }
  }
  const score = Math.round((points / max) * 100);
  let profile =
    score <= 20
      ? 'CONSERVATIVE'
      : score <= 40
        ? 'MODERATELY_CONSERVATIVE'
        : score <= 60
          ? 'BALANCED'
          : score <= 80
            ? 'GROWTH'
            : 'AGGRESSIVE';
  if (cap && RISK_PROFILE_ORDER.indexOf(profile) > RISK_PROFILE_ORDER.indexOf(cap)) profile = cap;
  return { score, riskProfile: profile, capped: Boolean(cap) };
}
