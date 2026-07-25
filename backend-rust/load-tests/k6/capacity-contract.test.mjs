import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = await readFile(join(here, 'capacity.js'), 'utf8');
const guide = await readFile(join(here, '..', 'README.md'), 'utf8');

test('capacity gate keeps the agreed latency thresholds', () => {
  assert.match(script, /thresholds\.normal_api_duration\s*=\s*\['p\(95\)<500'\]/);
  assert.match(script, /thresholds\.dashboard_report_duration\s*=\s*\['p\(95\)<2000'\]/);
  assert.match(script, /thresholds\.multi_branch_duration\s*=\s*\['p\(95\)<2000'\]/);
  assert.match(script, /thresholds\.branch_switch_duration\s*=\s*\['p\(95\)<1000'\]/);
  assert.match(script, /api_error_rate:\s*\[\x27rate<0\.01\x27\]/);
});

test('capacity gate requires real canonical branch data and protected credentials', () => {
  assert.match(script, /K6_EXPECTED_BRANCHES/);
  assert.match(script, /at least \$\{expectedBranches\} real branches are required/);
  assert.match(guide, /Every branch ID must be the canonical `branches\.id` UUID/);
  assert.match(guide, /Store `K6_USERS_JSON` as a protected secret/);
  assert.match(guide, /at least `K6_EXPECTED_BRANCHES` branches/);
});

test('pool profile has explicit connection-pool and dropped-iteration gates', () => {
  assert.match(script, /pool_exhaustion_errors\s*=\s*\['count==0'\]/);
  assert.match(script, /dropped_iterations\s*=\s*\['count==0'\]/);
  assert.match(script, /executor:\s*'constant-arrival-rate'/);
});
