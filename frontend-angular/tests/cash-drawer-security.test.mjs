import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('cash drawer retries, reconciliation review, and imports are guarded', () => {
  const migration = read('../backend-rust/migrations/0238_cash_drawer_retry_security.sql');
  const repository = read('../backend-rust/src/repositories/cash_drawer_repository.rs');
  const service = read('../backend-rust/src/services/cash_drawer_service.rs');
  const route = read('../backend-rust/src/routes/cash_drawer.rs');
  const security = read('../backend-rust/src/services/security_service.rs');
  const config = read('../backend-rust/src/config.rs');
  const component = read('src/app/pages/pos/cash-drawer/pos-cash-drawer-page.component.ts');

  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_drawer_movement_idempotency/);
  assert.match(repository, /ON CONFLICT \(tenant_id, branch_id, idempotency_key\).*DO NOTHING/);
  assert.match(service, /movement_session_by_idempotency/);
  assert.match(repository, /created_by_user_id<>\$4/);
  assert.match(service, /record_audit_tx/);
  assert.match(security, /pub async fn record_audit_tx/);
  assert.match(config, /PAYMENT_PROVIDERS.*razorpay.*cashfree.*phonepe/);
  assert.match(route, /PAYMENT_PROVIDERS\.contains/);
  assert.match(component, /movementIdempotencyKey = crypto\.randomUUID\(\)/);
  assert.match(component, /if \(this\.busy\) return/);
  assert.match(component, /file\.size > 1_048_576/);
  assert.match(component, /lines\.length - 1 > 500/);
  assert.match(component, /canReviewReconciliation\(row/);
});
