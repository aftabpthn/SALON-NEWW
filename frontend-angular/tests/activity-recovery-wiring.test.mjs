import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('activity recovery is audit-backed, permission-scoped, and never hard deletes', () => {
  const component = read('../src/app/pages/security/activity-recovery/activity-recovery-page.component.ts');
  const template = read('../src/app/pages/security/activity-recovery/activity-recovery-page.component.html');
  const routes = read('../src/app/app.routes.ts');
  const securityRepository = read('../../backend-rust/src/repositories/security_repository.rs');
  const packageRepository = read('../../backend-rust/src/repositories/packages_repository.rs');
  const membershipRepository = read('../../backend-rust/src/repositories/membership_repository.rs');

  assert.match(routes, /path: 'activity-recovery'[\s\S]*security\.read/);
  assert.match(component, /\/security\/audit\?q=/);
  assert.match(component, /visibleCount = 8/);
  assert.match(template, /@for \(event of visibleEvents/);
  assert.match(template, /Show more/);
  assert.match(template, /events\.length \? 'No matching activity records' : 'No activity records yet'/);
  assert.match(template, /recordName\(selected\) === '—' \? 'Audit record'/);
  for (const action of ['added', 'stopped', 'edited', 'saved', 'submitted', 'approved', 'deactivated', 'archived', 'cancelled', 'withdrawn', 'revoked', 'disconnected', 'drafted']) {
    assert.match(component, new RegExp(`'${action}'`));
  }
  for (const endpoint of ['/packages/${id}/restore', '/memberships/${id}/restore', '/reports/custom/${id}/lifecycle', '/whatsapp-campaign-planner/plans/${id}/restore', '/staff-leave/requests/${id}/restore']) {
    assert.ok(component.includes(endpoint), `missing restore endpoint ${endpoint}`);
  }
  assert.doesNotMatch(template, />\s*Delete\s*</i);
  assert.doesNotMatch(component, /api\.delete\(/);
  assert.doesNotMatch(packageRepository, /DELETE\s+FROM\s+packages/i);
  assert.doesNotMatch(membershipRepository, /DELETE\s+FROM\s+memberships/i);
  assert.match(securityRepository, /LEFT JOIN users actor/);
});
