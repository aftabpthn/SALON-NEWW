import { expect, type BrowserContext, type Page } from '@playwright/test';
import { escapeRegex, requiredEnv } from './helpers';

export async function loginThroughUi(
  page: Page,
  context: BrowserContext,
  resetSession = false,
): Promise<void> {
  const values = requiredEnv('E2E_TENANT_CONTEXT', 'E2E_LOGIN_ID', 'E2E_PASSWORD');
  const tenantContext = values['E2E_TENANT_CONTEXT'];
  const mfaCode = process.env['E2E_MFA_CODE']?.trim() || '';
  const branchName = process.env['E2E_BRANCH_NAME']?.trim() || '';

  await context.addInitScript(({ tenant, reset }) => {
    if (reset) {
      for (const key of [
        'aurashine_access_token',
        'aurashine_branch_id',
        'aurashine_branch_name',
        'aurashine_must_change_password',
      ]) localStorage.removeItem(key);
    }
    localStorage.setItem('aurashine_tenant_id', tenant);
  }, { tenant: tenantContext, reset: resetSession });

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Login ID or email').fill(values['E2E_LOGIN_ID']);
  await page.getByLabel('Password').fill(values['E2E_PASSWORD']);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  const mfaInput = page.getByLabel('Authenticator or recovery code');
  if (await mfaInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
    if (!mfaCode) throw new Error('E2E_MFA_CODE is required for this account');
    await mfaInput.fill(mfaCode);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }

  if (await page.getByRole('heading', { name: 'Select branch' }).isVisible({ timeout: 10_000 }).catch(() => false)) {
    if (!branchName) throw new Error('E2E_BRANCH_NAME is required when the user has multiple branches');
    await page.getByPlaceholder('Search assigned branches').fill(branchName);
    await page.getByRole('button', { name: new RegExp(escapeRegex(branchName), 'i') }).click();
  }

  await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);
  await expect(page.getByRole('heading', { name: 'Change password' })).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('aurashine_access_token'))).toBeTruthy();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('aurashine_branch_id'))).toBeTruthy();
}
