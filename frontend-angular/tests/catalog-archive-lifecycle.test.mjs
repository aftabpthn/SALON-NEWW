import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('package and membership catalogs archive and restore without hard delete', () => {
  const packageRepository = read('../../backend-rust/src/repositories/packages_repository.rs');
  const membershipRepository = read('../../backend-rust/src/repositories/membership_repository.rs');
  const packageRoute = read('../../backend-rust/src/routes/packages.rs');
  const membershipRoute = read('../../backend-rust/src/routes/memberships.rs');
  const packagePage = read('../src/app/pages/packages/packages-page.component.ts');
  const membershipPage = read('../src/app/pages/memberships/memberships-page.component.ts');

  assert.doesNotMatch(packageRepository, /DELETE\s+FROM\s+packages/i);
  assert.doesNotMatch(membershipRepository, /DELETE\s+FROM\s+memberships/i);
  assert.match(packageRepository, /UPDATE packages[\s\S]*SET active = FALSE/);
  assert.match(membershipRepository, /UPDATE memberships SET active = FALSE/);
  assert.match(packageRoute, /"deleted": false, "archived": true/);
  assert.match(membershipRoute, /"deleted": false, "archived": true/);
  assert.match(packagePage, /\{ active: !item\.active \}/);
  assert.match(membershipPage, /\{ active: !item\.active \}/);
});
