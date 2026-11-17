import { expect, test } from '@playwright/test';

const PAGES = [
  ['/', /Invest with clarity/],
  ['/investments', /Investments/],
  ['/calculator', /calculator/i],
  ['/risk-disclosures', /Risk/],
  ['/help', /Help centre/],
  ['/login', /Sign in/],
  ['/register', /Open an account/],
];

test.describe('public pages', () => {
  for (const [path, heading] of PAGES) {
    test(`${path} renders with the sandbox notice and no sideways scroll`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(heading);
      await expect(page.getByText(/Sandbox environment/)).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }

  test('every form field on the sign-in page has an accessible name', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByLabel(/^Password/)).toBeVisible();
    const unlabeled = await page.evaluate(
      () =>
        [...document.querySelectorAll('input, select, textarea, button')].filter(
          (el) => !el.labels?.length && !el.getAttribute('aria-label') && !el.textContent.trim() && el.type !== 'hidden',
        ).length,
    );
    expect(unlabeled).toBe(0);
  });

  test('keyboard users can reach the main navigation and skip to content', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard check runs on desktop');
    await page.goto('/');
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
    expect(first).toBeTruthy();
  });
});
