/**
 * Transactional message templates. Each returns { subject, body, containsSecret }.
 * `containsSecret` marks bodies holding links or codes that grant access. Those
 * bodies are redacted from the outbox after delivery in staging and production.
 *
 * Plain text. Per-user preferences (TEMPLATE_META below) decide which channels are used;
 * security and account emails cannot be switched off.
 */
const sign = '\n\n— The Mynx team\nIf you did not expect this message, contact support immediately.';

export const TEMPLATES = {
  'verify-email': ({ firstName, link }) => ({
    subject: 'Confirm your email address',
    body: `Hi ${firstName},\n\nConfirm your email address to activate your Mynx account:\n${link}\n\nThis link expires in 24 hours.${sign}`,
    containsSecret: true,
  }),
  'already-registered': ({ loginLink, resetLink }) => ({
    subject: 'Someone tried to register with your email',
    body: `Someone tried to create a Mynx account with this email address, but you already have one.\n\nSign in: ${loginLink}\nForgot your password? ${resetLink}${sign}`,
    containsSecret: false,
  }),
  'password-reset': ({ firstName, link }) => ({
    subject: 'Reset your password',
    body: `Hi ${firstName},\n\nUse this link to choose a new password:\n${link}\n\nThe link expires in 30 minutes and can be used once. All your active sessions will be signed out.${sign}`,
    containsSecret: true,
  }),
  'account-setup': ({ firstName, link }) => ({
    subject: 'Set up your Mynx staff account',
    body: `Hi ${firstName},\n\nAn administrator created a Mynx staff account for you. Choose your password here:\n${link}\n\nThe link expires in 24 hours. You will be asked to set up two-factor authentication before you can use the admin console.${sign}`,
    containsSecret: true,
  }),
  'password-changed': ({ firstName }) => ({
    subject: 'Your password was changed',
    body: `Hi ${firstName},\n\nThe password for your Mynx account was just changed, and your other sessions were signed out.${sign}`,
    containsSecret: false,
  }),
  'login-alert': ({ firstName, ip, userAgent, time }) => ({
    subject: 'New sign-in to your account',
    body: `Hi ${firstName},\n\nYour password was used to sign in from a new device or location.\n\nTime: ${time}\nIP address: ${ip ?? 'unknown'}\nDevice: ${userAgent ?? 'unknown'}\n\nIf this was not you, reset your password now and review your active sessions.${sign}`,
    containsSecret: false,
  }),
  'account-locked': ({ firstName, minutes, resetLink }) => ({
    subject: 'Your account was temporarily locked',
    body: `Hi ${firstName},\n\nAfter several incorrect password attempts, sign-in to your account is locked for ${minutes} minutes.\n\nIf this was not you, reset your password: ${resetLink}${sign}`,
    containsSecret: false,
  }),
  'mfa-enabled': ({ firstName }) => ({
    subject: 'Two-factor authentication enabled',
    body: `Hi ${firstName},\n\nTwo-factor authentication is now on for your account. Keep your recovery codes somewhere safe.${sign}`,
    containsSecret: false,
  }),
  'mfa-disabled': ({ firstName }) => ({
    subject: 'Two-factor authentication disabled',
    body: `Hi ${firstName},\n\nTwo-factor authentication was turned off for your account. Your account is now less secure.${sign}`,
    containsSecret: false,
  }),
  'recovery-codes-regenerated': ({ firstName }) => ({
    subject: 'New recovery codes generated',
    body: `Hi ${firstName},\n\nNew two-factor recovery codes were generated. Your previous codes no longer work.${sign}`,
    containsSecret: false,
  }),
  'recovery-code-used': ({ firstName, remaining }) => ({
    subject: 'A recovery code was used',
    body: `Hi ${firstName},\n\nA recovery code was used to sign in. You have ${remaining} unused codes left.${sign}`,
    containsSecret: false,
  }),
  'phone-code': ({ code }) => ({
    subject: null,
    body: `Your Mynx verification code is ${code}. It expires in 10 minutes. Never share this code.`,
    containsSecret: true,
  }),
  'kyc-submitted': ({ firstName }) => ({
    subject: 'We received your verification details',
    body: `Hi ${firstName},\n\nThanks for submitting your identity verification. Our compliance team will review it, usually within 2 business days. We will email you when there is an update.${sign}`,
    containsSecret: false,
  }),
  'kyc-approved': ({ firstName }) => ({
    subject: 'Your identity is verified',
    body: `Hi ${firstName},\n\nGood news: your identity verification is complete and your account is verified.${sign}`,
    containsSecret: false,
  }),
  'kyc-resubmission': ({ firstName, notes }) => ({
    subject: 'Action needed: update your verification',
    body: `Hi ${firstName},\n\nWe need a little more from you to complete your verification:\n\n${notes}\n\nSign in and open the Verification page to update your details or documents.${sign}`,
    containsSecret: false,
  }),
  // Deliberately generic: AML rules forbid disclosing screening outcomes ("tipping off").
  'kyc-rejected': ({ firstName }) => ({
    subject: 'Update on your verification',
    body: `Hi ${firstName},\n\nAfter review, we are unable to verify your account at this time. If you have questions, please contact support.${sign}`,
    containsSecret: false,
  }),
  'deposit-received': ({ firstName, amount }) => ({
    subject: 'Deposit received',
    body: `Hi ${firstName},\n\nWe received your deposit of ${amount}. It is now in your available balance.${sign}`,
    containsSecret: false,
  }),
  'payment-failed': ({ firstName, amount }) => ({
    subject: 'Your payment did not go through',
    body: `Hi ${firstName},\n\nYour deposit of ${amount} was not completed and no money was taken from your wallet. You can try again from the Deposit page.${sign}`,
    containsSecret: false,
  }),
  'withdrawal-requested': ({ firstName, amount, destination }) => ({
    subject: 'Withdrawal request received',
    body: `Hi ${firstName},\n\nWe received your request to withdraw ${amount} to ${destination}. The amount is set aside while we review it. If you did not make this request, contact support immediately.${sign}`,
    containsSecret: false,
  }),
  'withdrawal-completed': ({ firstName, amount, destination }) => ({
    subject: 'Withdrawal sent',
    body: `Hi ${firstName},\n\nYour withdrawal of ${amount} to ${destination} has been sent.${sign}`,
    containsSecret: false,
  }),
  'withdrawal-rejected': ({ firstName, amount }) => ({
    subject: 'Withdrawal not processed',
    body: `Hi ${firstName},\n\nYour withdrawal of ${amount} could not be processed and the money has been returned to your available balance. Contact support if you have questions.${sign}`,
    containsSecret: false,
  }),
  'investment-submitted': ({ firstName, amount, product }) => ({
    subject: 'Investment order received',
    body: `Hi ${firstName},\n\nYour order to invest ${amount} in ${product} was received. The money is reserved in your wallet while we place it. We will email you when it is confirmed.${sign}`,
    containsSecret: false,
  }),
  'investment-confirmed': ({ firstName, amount, product }) => ({
    subject: 'Investment confirmed',
    body: `Hi ${firstName},\n\nYour investment of ${amount} in ${product} is confirmed and now appears in your portfolio.${sign}`,
    containsSecret: false,
  }),
  'investment-rejected': ({ firstName, amount, product }) => ({
    subject: 'Investment order not completed',
    body: `Hi ${firstName},\n\nYour order to invest ${amount} in ${product} could not be completed. The reserved money has been returned to your available balance.${sign}`,
    containsSecret: false,
  }),
  'investment-matured': ({ firstName, product, proceeds }) => ({
    subject: 'Your investment has matured',
    body: `Hi ${firstName},\n\nYour investment in ${product} has matured. ${proceeds} has been added to your available balance.${sign}`,
    containsSecret: false,
  }),
  'account-suspended': ({ firstName }) => ({
    subject: 'Your account has been suspended',
    body: `Hi ${firstName},\n\nYour Mynx account has been suspended and you have been signed out. Contact support for more information.${sign}`,
    containsSecret: false,
  }),
  'referral-reward': ({ firstName, amount, friend }) => ({
    subject: 'You earned a referral reward',
    body: `Hi ${firstName},\n\n${friend} made their first investment, so ${amount} has been added to your available balance.${sign}`,
    containsSecret: false,
  }),
  'ticket-created': ({ firstName, number, subject }) => ({
    subject: `We received your request #${number}`,
    body: `Hi ${firstName},\n\nThanks for contacting us about "${subject}". Our team will reply in your support inbox, and we will email you when they do.${sign}`,
    containsSecret: false,
  }),
  'ticket-reply': ({ firstName, number }) => ({
    subject: `New reply to your request #${number}`,
    body: `Hi ${firstName},\n\nOur support team replied to request #${number}. Sign in and open Support to read it.${sign}`,
    containsSecret: false,
  }),
  'ticket-resolved': ({ firstName, number }) => ({
    subject: `Request #${number} resolved`,
    body: `Hi ${firstName},\n\nWe marked request #${number} as resolved. If anything is still wrong, reply to reopen it.${sign}`,
    containsSecret: false,
  }),
};

/**
 * Notification category, in-app link and whether the user may switch the email off.
 * Templates absent from this map (links, codes, sign-up notices) are always emailed
 * and never appear in the in-app centre, because they carry secrets or precede an account.
 */
export const TEMPLATE_META = {
  'password-changed': { category: 'SECURITY', link: '/app/security' },
  'login-alert': { category: 'SECURITY', link: '/app/security' },
  'account-locked': { category: 'SECURITY' },
  'mfa-enabled': { category: 'SECURITY', link: '/app/security' },
  'mfa-disabled': { category: 'SECURITY', link: '/app/security' },
  'recovery-codes-regenerated': { category: 'SECURITY', link: '/app/security' },
  'recovery-code-used': { category: 'SECURITY', link: '/app/security' },
  'account-suspended': { category: 'ACCOUNT' },
  'kyc-submitted': { category: 'KYC', link: '/app/verification' },
  'kyc-approved': { category: 'KYC', link: '/app/verification' },
  'kyc-resubmission': { category: 'KYC', link: '/app/verification' },
  'kyc-rejected': { category: 'KYC', link: '/app/verification' },
  'deposit-received': { category: 'PAYMENTS', link: '/app/transactions' },
  'payment-failed': { category: 'PAYMENTS', link: '/app/transactions' },
  'withdrawal-requested': { category: 'PAYMENTS', link: '/app/transactions?tab=withdrawals' },
  'withdrawal-completed': { category: 'PAYMENTS', link: '/app/transactions?tab=withdrawals' },
  'withdrawal-rejected': { category: 'PAYMENTS', link: '/app/transactions?tab=withdrawals' },
  'investment-submitted': { category: 'INVESTMENTS', link: '/app/investments' },
  'investment-confirmed': { category: 'INVESTMENTS', link: '/app/investments' },
  'investment-rejected': { category: 'INVESTMENTS', link: '/app/investments' },
  'investment-matured': { category: 'INVESTMENTS', link: '/app/investments' },
  'referral-reward': { category: 'REFERRALS', link: '/app/referrals' },
  'ticket-created': { category: 'SUPPORT', link: '/app/support' },
  'ticket-reply': { category: 'SUPPORT', link: '/app/support' },
  'ticket-resolved': { category: 'SUPPORT', link: '/app/support' },
};

/** Categories whose email cannot be switched off: people must always hear about security and account changes. */
export const MANDATORY_EMAIL_CATEGORIES = new Set(['SECURITY', 'ACCOUNT']);
export const NOTIFICATION_CATEGORIES = ['ACCOUNT', 'SECURITY', 'KYC', 'PAYMENTS', 'INVESTMENTS', 'REFERRALS', 'SUPPORT'];

/** Short in-app text: the email body without the greeting and sign-off. */
export function inAppText(body) {
  return body
    .replace(/^Hi [^\n]*,\n\n/, '')
    .split('\n\n— The Mynx team')[0]
    .trim()
    .slice(0, 2000);
}

export function renderTemplate(name, vars) {
  const template = TEMPLATES[name];
  if (!template) throw new Error(`Unknown message template: ${name}`);
  return template(vars);
}
