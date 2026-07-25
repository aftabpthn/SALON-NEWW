import { test as setup } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loginThroughUi } from './auth-flow';

const authFile = join(__dirname, '..', 'playwright', '.auth', 'user.json');

setup('authenticate with a real tenant user', async ({ page, context }) => {
  await loginThroughUi(page, context, true);
  mkdirSync(dirname(authFile), { recursive: true });
  await context.storageState({ path: authFile });
});
