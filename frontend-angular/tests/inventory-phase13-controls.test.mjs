import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Phase 13 inventory mutations share scope, replay, audit and cost-mask controls', () => {
  const migration = read('backend-rust/migrations/0374_inventory_phase13_operational_controls.sql');
  const tenant = read('backend-rust/src/middleware/tenant.rs');
  const routes = read('backend-rust/src/routes/mod.rs');
  const authService = read('backend-rust/src/services/auth_service.rs');
  const inventoryRoute = read('backend-rust/src/routes/inventory.rs');
  const purchases = read('backend-rust/src/routes/purchases.rs');
  const transfers = read('backend-rust/src/routes/inventory_transfers.rs');
  const purchaseService = read('backend-rust/src/services/purchase_service.rs');
  const transferService = read('backend-rust/src/services/inventory_transfer_service.rs');
  const adjustmentService = read('backend-rust/src/services/inventory_adjustment_service.rs');
  const auditService = read('backend-rust/src/services/stock_audit_service.rs');
  const interceptor = read('frontend-angular/src/app/core/interceptors/auth.interceptor.ts');
  const auth = read('frontend-angular/src/app/core/services/auth.service.ts');
  const page = read('frontend-angular/src/app/pages/inventory/inventory-page.component.ts');
  const template = read('frontend-angular/src/app/pages/inventory/inventory-page.component.html');

  const scopeMigration = read('backend-rust/migrations/0375_inventory_idempotency_branch_scope.sql');
  assert.match(migration, /inventory_api_idempotency/);
  assert.match(scopeMigration, /UNIQUE \(tenant_id, branch_id, idempotency_key\)/);
  assert.match(tenant, /require_inventory_idempotency[\s\S]*x-idempotency-replayed/);
  assert.match(tenant, /inventory\.api\.mutation[\s\S]*deviceId[\s\S]*requestId[\s\S]*idempotencyKey/);
  assert.match(routes, /require_inventory_idempotency/);
  assert.match(routes, /x-device-id[\s\S]*x-request-id[\s\S]*idempotency-key/);
  assert.match(authService, /masked_fields: scope\.masked_fields\.to_vec\(\)/);
  assert.match(authService, /has_field_mask/);
  assert.match(inventoryRoute, /inventory_cost_hidden[\s\S]*product cost visibility permission is required/);
  assert.match(purchases, /require_cost_visibility\(&claims\)\?/);
  assert.match(transfers, /has_field_mask\("inventory\.cost"\)/);
  assert.match(purchaseService, /purchase order creator cannot approve or reject/);
  assert.match(transferService, /created_by_user_id == actor[\s\S]*raised_by_user_id/);
  assert.match(adjustmentService, /requester cannot approve or reject the same material adjustment/);
  assert.match(auditService, /creator, submitter, or counter cannot approve/);
  assert.match(interceptor, /Idempotency-Key/);
  assert.match(interceptor, /switchMap\(\(\) => next\(withSession\(contextualRequest, auth\)\)\)/);
  assert.match(auth, /hasFieldMask/);
  assert.match(page, /canViewInventoryCost[\s\S]*unitCostPaise/);
  assert.match(page, /private async mutate[\s\S]*await this\.reload\(\)/);
  assert.match(template, /@if \(canViewInventoryCost\)/);
});
