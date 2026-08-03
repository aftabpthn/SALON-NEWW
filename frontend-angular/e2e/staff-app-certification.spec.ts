import { test, expect } from '@playwright/test';

type Persona = {
  id: 'restricted-provider' | 'senior-provider-frontdesk' | 'manager';
  tenantId: string;
  branchId?: string;
  loginId: string;
  password: string;
  mfaCode?: string;
  allowedPaths: string[];
  deniedPaths: string[];
};

const required = new Set(['restricted-provider', 'senior-provider-frontdesk', 'manager']);
const personas = (() => {
  const value = JSON.parse(process.env['E2E_STAFF_PERSONAS'] || '[]') as Persona[];
  if (value.length !== 3 || value.some((persona) => !required.has(persona.id))) {
    throw new Error('E2E_STAFF_PERSONAS must contain restricted-provider, senior-provider-frontdesk and manager.');
  }
  return value;
})();

for (const persona of personas) {
  test(`${persona.id}: login, scope, reload, denial and offline shell`, async ({ page, context }) => {
    const serverErrors: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/') && response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto('/staff/login');
    await page.getByLabel('Salon code').fill(persona.tenantId);
    if (persona.branchId) await page.getByLabel('Branch code (optional)').fill(persona.branchId);
    await page.getByLabel('Staff login ID').fill(persona.loginId);
    await page.getByLabel('Password').fill(persona.password);
    await page.getByRole('button', { name: 'Open staff app' }).click();
    const mfa = page.getByLabel('Authenticator or recovery code');
    if (await mfa.isVisible().catch(() => false)) {
      if (!persona.mfaCode) throw new Error(`${persona.id} requires mfaCode`);
      await mfa.fill(persona.mfaCode);
      await page.getByRole('button', { name: 'Open staff app' }).click();
    }
    await expect(page).toHaveURL(/\/staff\/dashboard(?:[/?#]|$)/);
    await expect(page.locator('.staff-app-shell')).toBeVisible();
    await expect(page.locator('.dashboard-blocking-state')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])));
    expect(Object.keys(storage).some((key) => /password|token|mfa|pin/i.test(key))).toBe(false);
    expect(Object.values(storage).some((value) => typeof value === 'string' && /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value))).toBe(false);

    await page.reload();
    await expect(page).toHaveURL(/\/staff\/dashboard(?:[/?#]|$)/);
    for (const path of persona.allowedPaths) {
      await page.goto(path);
      await expect(page).not.toHaveURL(/\/staff\/(?:login|permission-denied)(?:[/?#]|$)/);
      await expect(page.locator('.staff-app-shell')).toBeVisible();
    }
    for (const path of persona.deniedPaths) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/staff\/permission-denied(?:[/?#]|$)/);
    }

    await page.goto('/staff/dashboard');
    await context.setOffline(true);
    await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText('Online', { exact: true }).first()).toBeVisible();
    expect(serverErrors).toEqual([]);
  });
}
