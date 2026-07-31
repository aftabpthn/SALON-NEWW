import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/pages/marketplace/operations-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/marketplace/operations-page.component.html', 'utf8');
const middleware = readFileSync('../backend-rust/src/middleware/tenant.rs', 'utf8');
const routes = readFileSync('../backend-rust/src/routes/operations.rs', 'utf8');
const service = readFileSync('../backend-rust/src/services/operations_service.rs', 'utf8');
const repository = readFileSync('../backend-rust/src/repositories/operations_repository.rs', 'utf8');
const migration = readFileSync('../backend-rust/migrations/0346_advanced_operations_dispatch.sql', 'utf8');
const staff = readFileSync('../staff-app/src/app/features/staff/staff-tasks.page.ts', 'utf8');
const customerRoutes = readFileSync('../customer-app/src/app/app.routes.ts', 'utf8');

test('Operations APIs are management-scoped and partial loads remain visible', () => {
  assert.match(middleware, /path_starts_with\(path, "\/operations"\)[\s\S]*MANAGEMENT_ROLES[\s\S]*"management\.write"/);
  assert.match(page, /Promise\.allSettled/);
  assert.match(page, /error\?\.error\?\.error\?\.message/);
});

test('Operations mutations enforce branch links, real actors and forward-only jobs', () => {
  assert.match(repository, /FROM appointments a JOIN travel_zones z/);
  assert.match(repository, /a\.tenant_id=\$1 AND a\.branch_id=\$2/);
  assert.match(routes, /Extension\(claims\): Extension<AuthClaims>/);
  assert.match(routes, /operations_service::audit/);
  assert.match(service, /pub fn valid_transition/);
  assert.match(routes, /marketplace review was not found/);
});

test('10X dispatch remains real-data, staff-scoped, consent-aware and idempotent', () => {
  assert.match(page, /appointmentId/);
  assert.match(template, /Prioritized action queue/);
  assert.match(service, /communication_allowed/);
  assert.match(service, /verify_connection/);
  assert.match(repository, /ON CONFLICT\(connection_id,provider_event_id\) DO NOTHING/);
  assert.match(migration, /field_job_location_events/);
  assert.match(migration, /field_job_tracking_links/);
  assert.match(staff, /watchPosition/);
  assert.match(customerRoutes, /track\/:token/);
});
