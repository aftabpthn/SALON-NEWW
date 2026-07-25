import { expect, type Page, type TestInfo } from '@playwright/test';

export function requiredEnv(...names: string[]): Record<string, string> {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    throw new Error('Missing required E2E environment variables: ' + missing.join(', '));
  }
  return Object.fromEntries(names.map((name) => [name, process.env[name]!.trim()]));
}

export async function installApiLatency(page: Page, testInfo: TestInfo): Promise<void> {
  const profile = String(testInfo.project.metadata['networkProfile'] || '');
  const delayMs = profile === 'slow-4g' ? 900 : profile === '4g' ? 150 : 0;
  if (!delayMs) return;

  await page.route('**/api/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  });
}

export async function expectResponsiveViewport(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'Page shell must not overflow the device viewport').toBeLessThanOrEqual(2);
}

export function escapeRegex(value: string): string {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}
