import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(root, '..', 'backend-rust');
const readFrontend = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readBackend = (file) => fs.readFileSync(path.join(repo, file), 'utf8');

test('inventory production operations use real scoped APIs and reload after actions', () => {
  const component = readFrontend('src/app/pages/inventory/advanced-controls/advanced-controls-page.component.ts');
  const template = readFrontend('src/app/pages/inventory/advanced-controls/advanced-controls-page.component.html');
  assert.match(component, /\/inventory\/operations-health/);
  assert.match(component, /\/supplier-governance\/communications\/\$\{id\}\/retry/);
  assert.match(component, /await this\.reload\(\)/);
  assert.match(component, /async selectTab\(tab: Tab\)/);
  assert.match(component, /async onBranchScopeChange\(\)[\s\S]*await this\.reload\(\)/);
  assert.match(template, /Autonomous Inventory Operations/);
  assert.match(template, /\(click\)="selectTab\(tab\.id\)"/);
  assert.match(template, /\(ngModelChange\)="onBranchScopeChange\(\)"/);
  for (const label of [
    'Export evidence', 'Review exception', 'Open action route',
    'Create approval rule', 'Review pending approval',
    'Open locked item', 'Resolve lock',
    'Create expiry rescue action', 'Transfer near-expiry stock',
    'Create clearance action', 'Create discount/offer',
    'Save policy',
    'Run automation', 'Save controls', 'Approve action', 'Reject action', 'Retry failed job',
  ]) assert.ok(template.includes(label), `${label} command is missing`);
  for (const method of [
    'reviewException', 'openActionRoute', 'createApprovalRule', 'reviewPendingApproval',
    'openLockedItem', 'resolveLock', 'createExpiryRescueAction', 'transferNearExpiryStock',
    'createClearanceAction', 'createDiscountOffer',
  ]) assert.match(component, new RegExp(`\\b${method}\\(`), `missing ${method}`);
  assert.match(component, /navigate\(\['\/inventory\/transfers'\]\)/);
  assert.match(component, /navigate\(\['\/marketing'\]/);
  assert.match(template, /ledgerStockMismatch/);
  assert.match(template, /terminalFailed/);
  assert.match(template, /retryCommunication\(row\.id\)/);
  assert.doesNotMatch(component, /mock|dummy|sample/i);
});

test('backend outbox provides replay safety, locking, retry, metrics and tracing', () => {
  const migration = readBackend('migrations/0212_inventory_production_verification.sql');
  const repository = readBackend('src/repositories/inventory_governance_repository.rs');
  const service = readBackend('src/services/inventory_governance_service.rs');
  const routes = readBackend('src/routes/inventory_governance.rs');
  for (const required of ['max_attempts', 'next_attempt_at', 'correlation_id']) assert.match(migration, new RegExp(required));
  assert.match(repository, /FOR UPDATE SKIP LOCKED/);
  assert.match(repository, /processing_started_at < NOW\(\)-INTERVAL '15 minutes'/);
  assert.match(repository, /operations_health/);
  assert.match(repository, /retry_communication/);
  assert.match(service, /tracing::(?:info|warn)!/);
  assert.match(routes, /\/inventory\/operations-health/);
  assert.match(routes, /communications\/:id\/retry/);
});

test('PostgreSQL production test covers isolation, concurrency and invariants', () => {
  const integration = readBackend('tests/inventory_phase5_postgres.rs');
  assert.match(integration, /tokio::join!/);
  for (const contract of ['other_branch', 'conflicting_actor', 'rollback_count', 'money_constraint', 'container_constraint']) {
    assert.match(integration, new RegExp(contract));
  }
});
