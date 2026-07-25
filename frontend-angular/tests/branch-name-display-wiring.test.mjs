import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('user-facing branch UUIDs use the shared branch name resolver', () => {
  const pipe = read('src/app/shared/pipes/branch-name.pipe.ts');
  const auth = read('src/app/core/services/auth.service.ts');
  const templates = [
    'src/app/pages/staff/staff-page.component.html',
    'src/app/pages/clients/clients-page.component.html',
    'src/app/pages/finance/balance-sheet/balance-sheet-page.component.html',
    'src/app/pages/marketing/marketing-leads-page.component.html',
    'src/app/pages/inventory/inventory-page.component.html',
    'src/app/pages/reports/reports-page.component.html',
  ].map(read).join('\n');

  assert.match(pipe, /auth\.branchNameFor\(branchId\)/);
  assert.match(auth, /branchNames\.set\(branch\.branchId, branch\.branchName\)/);
  assert.match(templates, /\| branchName/);
  assert.doesNotMatch(templates, /\{\{\s*(?:row|branch|employee|report)\.(?:branchId|sourceBranchId|destinationBranchId)\s*\}\}/);
  assert.doesNotMatch(read('src/app/pages/pos/happy-hours/happy-hours-page.component.html'), /\{\{\s*row\.branchId\s*\}\}/);
});
