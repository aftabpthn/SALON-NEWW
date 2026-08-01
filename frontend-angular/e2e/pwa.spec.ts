import { test, expect } from '@playwright/test';

test('production app shell installs and reloads while offline', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestUrl).toBeTruthy();
  const manifestResponse = await page.request.get(new URL(manifestUrl!, page.url()).toString());
  expect(manifestResponse.ok()).toBe(true);

  const scriptUrl = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service worker is not supported');
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || '';
  });
  expect(scriptUrl).toMatch(/ngsw-worker\.js$/);

  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  }
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || ''))
    .toMatch(/ngsw-worker\.js$/);
  await expect.poll(() => page.evaluate(async () => {
    const manifest = await fetch('/ngsw.json').then((response) => response.json()) as {
      assetGroups?: Array<{ name: string; urls: string[] }>;
    };
    const required = manifest.assetGroups?.find((group) => group.name === 'app-shell')?.urls || [];
    const cachedRequests = (await Promise.all(
      (await caches.keys()).map(async (name) => (await caches.open(name)).keys()),
    )).flat();
    const cachedPaths = new Set(cachedRequests.map((request) => new URL(request.url).pathname));
    return required.length > 0 && required.every((url) => cachedPaths.has(url));
  })).toBe(true);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
