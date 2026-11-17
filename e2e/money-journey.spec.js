import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { totp } from '../server/src/utils/totp.js';

/**
 * The core money journey in a real browser, against a real API and database:
 * sign in → deposit through the sandbox checkout → request a withdrawal →
 * a Finance Officer (with MFA) approves it → the investor sees it paid out.
 */
const accounts = () => JSON.parse(readFileSync(join(import.meta.dirname, '.auth', 'accounts.json'), 'utf8'));

async function signIn(page, email, password, mfaSecret) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (mfaSecret) {
    await page.getByLabel('Authentication code').fill(totp(mfaSecret, Date.now() + 30_000));
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  // Wait until sign-in has finished, so a following navigation cannot cancel it.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe.serial('deposit, withdrawal and approval', () => {
  test('investor deposits through the sandbox checkout and requests a withdrawal', async ({ page }) => {
    const { investor, password } = accounts();
    await signIn(page, investor.email, password);
    await expect(page.getByRole('heading', { name: /Welcome, Esi/ })).toBeVisible();

    await page.goto('/app/deposit');
    await page.getByLabel(/Amount/).fill('250');
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page.getByRole('heading', { name: 'Simulated checkout' })).toBeVisible();
    await page.getByRole('button', { name: 'Simulate successful payment' }).click();
    await expect(page.getByText('Received', { exact: true })).toBeVisible();

    await page.goto('/app/wallet');
    await expect(page.getByText('GH₵250.00').first()).toBeVisible();

    await page.goto('/app/withdraw');
    await page.getByLabel(/Amount/).fill('100');
    await page.getByLabel('Mobile number').fill('0241234567');
    await page.getByRole('button', { name: 'Review withdrawal' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Request withdrawal' }).click();
    await expect(page).toHaveURL(/\/app\/transactions/);
    await expect(page.getByText('Under review').first()).toBeVisible();
  });

  test('finance officer signs in with MFA and approves the withdrawal', async ({ page }) => {
    const { finance, investor, password } = accounts();
    await signIn(page, finance.email, password, finance.mfaSecret);
    await page.goto('/admin/payments');
    const row = page.getByRole('row').filter({ hasText: investor.email });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve and send' }).click();
    await page.getByLabel('Status').selectOption('');
    await expect(page.getByRole('row').filter({ hasText: investor.email }).getByText('Sent')).toBeVisible();
  });

  test('investor sees the withdrawal paid out and the balance reduced', async ({ page }) => {
    const { investor, password } = accounts();
    await signIn(page, investor.email, password);
    await page.goto('/app/transactions?tab=withdrawals');
    await expect(page.getByText('Sent').first()).toBeVisible();
    await page.goto('/app/wallet');
    await expect(page.getByText('GH₵150.00').first()).toBeVisible();
  });
});
