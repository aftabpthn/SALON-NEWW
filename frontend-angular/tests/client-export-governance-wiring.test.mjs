import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const service = read('../../backend-rust/src/services/client_export_governance_service.rs');
const clients = read('../../backend-rust/src/routes/clients.rs');
const security = read('../../backend-rust/src/routes/security.rs');
const auth = read('../../backend-rust/src/services/auth_service.rs');
const tenant = read('../../backend-rust/src/middleware/tenant.rs');
const migration = read('../../backend-rust/migrations/0416_client_export_governance.sql');
const policy = read('../../backend-rust/src/services/security_service.rs');

test('bulk client export is authorised before it reads and recorded after', () => {
  const body = clients.slice(
    clients.indexOf('async fn bulk_export_clients'),
    clients.indexOf('const EXPORT_KIND_BULK') > clients.indexOf('async fn bulk_export_clients')
      ? clients.length
      : clients.indexOf('async fn ', clients.indexOf('async fn bulk_export_clients') + 10),
  );
  const authoriseAt = body.indexOf('client_export_governance_service::authorise');
  const readAt = body.indexOf('clients_repository::list');
  const recordAt = body.indexOf('client_export_governance_service::record');
  assert.ok(authoriseAt > -1, 'export must be authorised');
  assert.ok(recordAt > -1, 'export must be recorded');
  // Authorising after the read would still return the data it was meant to
  // withhold.
  assert.ok(authoriseAt < readAt, 'authorisation must happen before the database read');
  assert.ok(readAt < recordAt, 'the ledger records what actually came back');
  assert.match(body, /rows\.len\(\) as i64/, 'record the rows returned, not the page size');
});

test('every export carries a watermark back to the caller', () => {
  assert.match(migration, /watermark TEXT NOT NULL/);
  assert.match(migration, /idx_client_export_events_watermark[\s\S]{0,80}?\(watermark\)/);
  assert.match(clients, /x-aurashine-export-watermark/);
  // Reproducible from the stored event, so a marker found on a leaked file can
  // be verified rather than merely looked up.
  assert.match(service, /fn watermark_for/);
  assert.match(service, /Sha256::new\(\)/);
});

test('the elevation permission exists in the catalog and is not invented locally', () => {
  // A permission the catalog does not define fails require_route_role for
  // every caller — the bug that took /staff/rules down.
  assert.match(auth, /code: "security\.export\.elevated"/);
  assert.match(service, /"security\.export\.elevated"/);
  // Reuses the existing temporary-elevation mechanism rather than adding a
  // second approval path.
  assert.match(service, /active_elevated_permissions/);
  assert.match(tenant, /path_starts_with\(path, "\/security"\)/);
});

test('the budget is off by default and recording is not', () => {
  // Turning governance on must not break a tenant's workflow the day it ships;
  // the ledger fills either way so the policy can be enabled from evidence.
  assert.match(policy, /client_export_budget_enforced: false/);
  assert.match(policy, /client_export_daily_row_budget: 2_000/);
  assert.match(service, /policy\.client_export_budget_enforced/);
});

test('anomaly detection compares a user against themselves, with a floor', () => {
  // A global threshold is unusable: a marketing manager exporting weekly is not
  // suspicious and a receptionist suddenly taking the book is.
  assert.match(service, /ANOMALY_FLOOR_ROWS/);
  assert.match(service, /row_count < ANOMALY_FLOOR_ROWS/);
  assert.match(service, /GROUP BY DATE_TRUNC\('day', created_at\)/);
  // Today is excluded so one big export cannot raise its own baseline.
  assert.match(service, /created_at < DATE_TRUNC\('day', NOW\(\)\)/);
  assert.match(service, /'client_export_spike'/);
});

test('the audit is readable and a user can see their own limit', () => {
  assert.match(security, /"\/security\/client-exports"/);
  assert.match(security, /"\/security\/client-exports\/usage"/);
  // Reading the branch's export history is a security read; knowing your own
  // remaining budget is not.
  assert.match(security, /async fn list_client_exports\([\s\S]{0,400}?require_security_read\(&claims\)/);
  assert.doesNotMatch(
    security.slice(security.indexOf('async fn client_export_usage')),
    /^[\s\S]{0,300}?require_security_read/,
  );
});
