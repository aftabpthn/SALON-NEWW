import { test, expect } from '@playwright/test';
import { escapeRegex, expectResponsiveViewport, installApiLatency } from './helpers';
import { loginThroughUi } from './auth-flow';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }, testInfo) => {
  await installApiLatency(page, testInfo);
});

test('login and branch selection work under the project network profile', async ({ page, context }) => {
  await context.clearCookies();
  await loginThroughUi(page, context, true);
  await expect(page.locator('.branch-trigger')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in' })).not.toBeVisible();
  await expectResponsiveViewport(page);
});

test('critical CRM screens render within the device viewport', async ({ page }) => {
  for (const route of ['/dashboard', '/appointments', '/pos', '/clients', '/staff']) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(route.replace('/', '\\/') + '(?:[/?#]|$)'));
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).not.toBeVisible();
    await expectResponsiveViewport(page);
  }
});

test('selected branch survives a browser reload', async ({ page }) => {
  await page.goto('/dashboard');
  const before = await page.evaluate(() => ({
    id: localStorage.getItem('aurashine_branch_id'),
    name: localStorage.getItem('aurashine_branch_name'),
  }));
  expect(before.id).toBeTruthy();

  await page.reload();
  await expect(page.locator('.branch-trigger')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('aurashine_branch_id'))).toBe(before.id);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('aurashine_branch_name'))).toBe(before.name);
});

test('branch switch updates context and restores the original branch', async ({ page }) => {
  const targetBranch = process.env['E2E_SECOND_BRANCH_NAME']?.trim();
  test.skip(!targetBranch, 'Set E2E_SECOND_BRANCH_NAME to exercise a real second branch');

  await page.goto('/dashboard');
  const original = await page.evaluate(() => ({
    id: localStorage.getItem('aurashine_branch_id'),
    name: localStorage.getItem('aurashine_branch_name') || '',
  }));
  expect(original.id).toBeTruthy();
  expect(original.name).toBeTruthy();
  test.skip(original.name.toLowerCase() === targetBranch!.toLowerCase(), 'Second branch must differ from the login branch');

  const switchTo = async (branchName: string) => {
    await page.locator('.branch-trigger').click();
    const option = page.getByRole('option').filter({ hasText: new RegExp(escapeRegex(branchName), 'i') });
    await expect(option).toBeVisible();
    await option.click();
    await page.waitForLoadState('domcontentloaded');
  };

  try {
    await switchTo(targetBranch!);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('aurashine_branch_name'))).toMatch(
      new RegExp(escapeRegex(targetBranch!), 'i'),
    );
    await expect.poll(() => page.evaluate(() => localStorage.getItem('aurashine_branch_id'))).not.toBe(original.id);
  } finally {
    if (original.name) {
      await switchTo(original.name);
      await expect.poll(() => page.evaluate(() => localStorage.getItem('aurashine_branch_id'))).toBe(original.id);
    }
  }
});

test('client search returns a real tenant record', async ({ page }) => {
  const query = process.env['E2E_CLIENT_QUERY']?.trim();
  test.skip(!query, 'Set E2E_CLIENT_QUERY to a real client name, code, phone, or email');

  await page.goto('/clients');
  const search = page.getByLabel('Search clients');
  await search.fill(query!);
  const matchingRow = page.locator('button.client-list-row').filter({ hasText: new RegExp(escapeRegex(query!), 'i') }).first();
  await expect(matchingRow).toBeVisible();
});

test('expired access token refreshes without losing branch context', async ({ page }) => {
  await page.goto('/dashboard');
  const before = await page.evaluate(() => ({
    token: localStorage.getItem('aurashine_access_token') || '',
    branch: localStorage.getItem('aurashine_branch_id') || '',
  }));
  expect(before.token).toBeTruthy();
  expect(before.branch).toBeTruthy();

  const expired = await page.evaluate(() => {
    const key = 'aurashine_access_token';
    const token = localStorage.getItem(key) || '';
    const parts = token.split('.');
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    payload.exp = 1;
    const encoded = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const value = [parts[0], encoded, parts[2]].join('.');
    localStorage.setItem(key, value);
    return value;
  });

  await page.goto('/clients');
  await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('aurashine_access_token'))).not.toBe(expired);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('aurashine_branch_id'))).toBe(before.branch);
});

test('POS reports offline and recovers when connectivity returns', async ({ page, context }) => {
  await page.goto('/pos');
  await expect(page.getByRole('heading', { name: 'Counter checkout' })).toBeVisible();

  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save offline checkout' })).toBeVisible();

  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(page.getByRole('button', { name: 'Save sale and invoice' })).toBeVisible();
});
