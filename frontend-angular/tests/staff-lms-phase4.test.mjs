import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Phase 4 reuses SOPs and enforces evidence-backed skill learning', () => {
  const migration = read('../backend-rust/migrations/0363_lms_certification_skills_closure.sql');
  const routes = read('../backend-rust/src/routes/staff_enterprise.rs');
  const repository = read('../backend-rust/src/repositories/staff_enterprise_repository.rs');
  const manager = read('src/app/pages/staff/control-center/staff-control-center-page.component.ts');
  const mobile = read('../staff-app/src/app/features/staff/staff-rules.page.ts');

  assert.match(migration, /staff_course_profiles/);
  assert.match(migration, /staff_skill_requirements/);
  assert.match(migration, /enforce_course_completion_evidence/);
  assert.match(migration, /acknowledged_at IS NOT NULL AND evidence\.quiz_passed=TRUE/);
  for (const path of ['/staff-enterprise/lms', '/lms/enrolments', '/lms/skill-requirements', '/certifications/:id/renew']) {
    assert.match(routes, new RegExp(path.replaceAll('/', '\\/')));
  }
  assert.match(repository, /document\.document_type='sop' AND document\.status='published'/);
  assert.match(repository, /requirement\.scope_type='role'/);
  assert.match(repository, /requirement\.scope_type='service'/);
  assert.match(repository, /verification_status='verified'/);
  assert.match(repository, /status='completed'.*completed_at/s);
  assert.match(manager, /this\.loadOne\('\/staff-enterprise\/lms'/);
  assert.match(mobile, /Training completion recorded/);
});
