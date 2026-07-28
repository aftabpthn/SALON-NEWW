import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('update password clears the forced-change flag while reset keeps it', () => {
  const page = read('../src/app/pages/staff/staff-page.component.ts');
  const route = read('../../backend-rust/src/routes/staff.rs');
  const service = read('../../backend-rust/src/services/staff_service.rs');

  assert.match(page, /mustChangePassword: this\.passwordAction === 'reset'/);
  assert.match(page, /await this\.loadBranchAccess\(\)/);
  assert.match(route, /payload\.must_change_password\.unwrap_or\(true\)/);
  assert.match(service, /must_change_password=\$4/);
  assert.match(service, /CASE WHEN \$4 THEN NULL ELSE NOW\(\) END/);
});
