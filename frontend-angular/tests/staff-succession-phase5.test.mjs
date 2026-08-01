import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Phase 5 calculates evidence and keeps promotion human-approved', () => {
  const migration = read('../backend-rust/migrations/0365_succession_promotion_readiness.sql');
  const routes = read('../backend-rust/src/routes/staff_hrms.rs');
  const repository = read('../backend-rust/src/repositories/staff_hrms_repository.rs');
  const manager = read('src/app/pages/staff/control-center/staff-control-center-page.component.ts');

  assert.match(migration, /staff_succession_signal_snapshot/);
  assert.match(migration, /staff_succession_history/);
  assert.match(migration, /skills\.score\*30/);
  assert.match(migration, /appraisal\.score\*30/);
  assert.match(migration, /attendance\.score\*20/);
  assert.match(migration, /training\.score\*20/);
  assert.match(routes, /\/staff\/hrms\/promotion-readiness/);
  assert.match(routes, /\/staff\/hrms\/succession-candidates\/:id\/decision/);
  assert.match(repository, /nominated_by<>\$4/);
  assert.match(repository, /evidence_coverage_percent>=75/);
  assert.match(repository, /'transactionalWritesPerformed',FALSE/);
  assert.match(manager, /decideSuccessionCandidate/);
});
