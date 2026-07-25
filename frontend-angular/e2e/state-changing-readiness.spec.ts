import { test, expect } from '@playwright/test';
import { escapeRegex, requiredEnv } from './helpers';

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  test.skip(process.env['E2E_ALLOW_WRITES'] !== 'true', 'State-changing tests require E2E_ALLOW_WRITES=true on a dedicated staging tenant');
});

test('appointment can be created and updated through the UI', async ({ page }) => {
  const values = requiredEnv(
    'E2E_CLIENT_QUERY',
    'E2E_SERVICE_QUERY',
    'E2E_STAFF_QUERY',
    'E2E_APPOINTMENT_DATE',
    'E2E_APPOINTMENT_TIME',
    'E2E_APPOINTMENT_UPDATE_NOTE',
  );

  await page.goto('/appointments');
  await page.getByRole('button', { name: 'New booking' }).click();
  const flyout = page.getByLabel('New booking flyout');

  const clientInput = flyout.getByPlaceholder('Search client').first();
  await clientInput.fill(values['E2E_CLIENT_QUERY']);
  await flyout.locator('.linked-field .picker-results button')
    .filter({ hasText: new RegExp(escapeRegex(values['E2E_CLIENT_QUERY']), 'i') }).first().click();

  const serviceLine = flyout.getByLabel('Service line').first();
  const guestInput = serviceLine.getByPlaceholder('Search guest');
  if (!(await guestInput.inputValue())) {
    await guestInput.fill(values['E2E_CLIENT_QUERY']);
    await serviceLine.locator('.picker-results button')
      .filter({ hasText: new RegExp(escapeRegex(values['E2E_CLIENT_QUERY']), 'i') }).first().click();
  }

  await serviceLine.getByPlaceholder('Search service').fill(values['E2E_SERVICE_QUERY']);
  await serviceLine.locator('.picker-results button')
    .filter({ hasText: new RegExp(escapeRegex(values['E2E_SERVICE_QUERY']), 'i') }).first().click();

  await serviceLine.getByPlaceholder('Search staff').fill(values['E2E_STAFF_QUERY']);
  await serviceLine.locator('.picker-results button')
    .filter({ hasText: new RegExp(escapeRegex(values['E2E_STAFF_QUERY']), 'i') }).first().click();

  await flyout.getByLabel('Booking date').fill(values['E2E_APPOINTMENT_DATE']);
  await serviceLine.getByLabel('Choose start time').selectOption(values['E2E_APPOINTMENT_TIME']);

  const createResponse = page.waitForResponse(
    (response) => response.url().includes('/api/v1/appointments/batch') && response.request().method() === 'POST',
  );
  await flyout.getByRole('button', { name: 'Create booking' }).click();
  expect((await createResponse).ok()).toBe(true);
  await expect(flyout).not.toBeVisible();

  await page.getByLabel('Staff grid mode').selectOption({ label: 'List' });
  const createdCard = page.locator('article.list-appointment')
    .filter({ hasText: new RegExp(escapeRegex(values['E2E_CLIENT_QUERY']), 'i') })
    .filter({ hasText: new RegExp(escapeRegex(values['E2E_SERVICE_QUERY']), 'i') })
    .first();
  await expect(createdCard).toBeVisible();
  await createdCard.click();
  await page.getByRole('button', { name: 'Edit Booking' }).click();

  const editFlyout = page.getByLabel('New booking flyout');
  await editFlyout.getByLabel('Notes').fill(values['E2E_APPOINTMENT_UPDATE_NOTE']);
  const updateResponse = page.waitForResponse(
    (response) => response.url().includes('/api/v1/appointments/batch') && response.request().method() === 'POST',
  );
  await editFlyout.getByRole('button', { name: 'Save booking' }).click();
  expect((await updateResponse).ok()).toBe(true);
  await expect(editFlyout).not.toBeVisible();
});

test('POS creates a paid invoice through the UI', async ({ page }) => {
  const values = requiredEnv('E2E_POS_SERVICE', 'E2E_POS_STAFF', 'E2E_POS_PAYMENT_METHOD');

  await page.goto('/pos');
  await page.getByRole('button', { name: 'Walk-in Client' }).click();
  const serviceSearch = page.getByPlaceholder('Search service by name or code');
  await serviceSearch.fill(values['E2E_POS_SERVICE']);
  await page.locator('.quick-catalog-row .search-results button')
    .filter({ hasText: new RegExp(escapeRegex(values['E2E_POS_SERVICE']), 'i') }).first().click();

  const line = page.locator('.item-row').first();
  await line.getByPlaceholder('Search staff').fill(values['E2E_POS_STAFF']);
  await line.locator('.search-results button')
    .filter({ hasText: new RegExp(escapeRegex(values['E2E_POS_STAFF']), 'i') }).first().click();

  const payment = page.locator('label.payment-method')
    .filter({ hasText: new RegExp(escapeRegex(values['E2E_POS_PAYMENT_METHOD']), 'i') }).first();
  await payment.getByRole('button', { name: /^Click / }).click();

  const saveResponse = page.waitForResponse(
    (response) => response.url().includes('/api/v1/pos/sales') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save sale and invoice' }).click();
  expect((await saveResponse).ok()).toBe(true);
  await expect(page).toHaveURL(/\/pos\/invoices(?:[/?#]|$)/);
});

test('staff branch access can be saved and reloaded', async ({ page }) => {
  const values = requiredEnv('E2E_STAFF_QUERY');

  await page.goto('/staff');
  const search = page.locator('header.page-header input[type="search"]');
  await search.fill(values['E2E_STAFF_QUERY']);
  await search.press('Enter');
  const employee = page.locator('button.employee-name')
    .filter({ hasText: new RegExp(escapeRegex(values['E2E_STAFF_QUERY']), 'i') }).first();
  await expect(employee).toBeVisible();
  await employee.click();

  await page.getByRole('button', { name: 'Branch Access' }).click();
  await expect(page.locator('section.branch-access-panel')).toBeVisible();
  const save = page.getByRole('button', { name: 'Save branch access' });
  await expect(save, 'The staging staff fixture must already have a linked login').toBeVisible();

  const saveResponse = page.waitForResponse(
    (response) => response.url().includes('/branch-access') && response.request().method() === 'PUT',
  );
  await save.click();
  expect((await saveResponse).ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Branch Access' }).click();
  await expect(page.locator('section.branch-access-panel')).toBeVisible();
});
