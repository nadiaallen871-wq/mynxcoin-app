import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from './password.js';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(320);
// Policy checks (length, common passwords) run in the service, so that every
// path that sets a password applies the same rules.
const password = z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH);
const name = z.string().trim().min(1, 'Required').max(100);
const token = z.string().min(20).max(200);
const totpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
const recoveryCode = z.string().trim().min(10).max(20);

export const registerSchema = z
  .object({
    email,
    password,
    firstName: name,
    lastName: name,
    accountType: z.enum(['INDIVIDUAL', 'INSTITUTIONAL']).default('INDIVIDUAL'),
    organizationName: z.string().trim().min(2).max(200).optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default('GH'),
    referralCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{6,16}$/, 'Referral codes are 6 to 16 letters and numbers')
      .optional(),
    acceptTerms: z.literal(true, { error: 'You must accept the terms and risk disclosures' }),
  })
  .refine((v) => v.accountType !== 'INSTITUTIONAL' || v.organizationName, {
    path: ['organizationName'],
    message: 'Organisation name is required for institutional accounts',
  });

export const loginSchema = z.object({ email, password });
export const emailOnlySchema = z.object({ email });
export const tokenSchema = z.object({ token });
export const resetPasswordSchema = z.object({ token, password });
export const changePasswordSchema = z.object({ currentPassword: password, newPassword: password });

export const mfaSetupSchema = z.object({ password });
export const mfaEnableSchema = z.object({ code: totpCode });
export const mfaChallengeSchema = z
  .object({ code: totpCode.optional(), recoveryCode: recoveryCode.optional() })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), { message: 'Provide either a code or a recovery code' });
export const mfaStepUpSchema = z
  .object({ password, code: totpCode.optional(), recoveryCode: recoveryCode.optional() })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), { message: 'Provide either a code or a recovery code' });
