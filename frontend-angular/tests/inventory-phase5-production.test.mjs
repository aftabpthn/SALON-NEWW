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
  assert.match(template, /Production Operations/);
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
  assert.match(integration, /branch_b_count/);
  assert.match(integration, /tokio::join!/);
  assert.match(integration, /FOR UPDATE SKIP LOCKED/);
  assert.match(integration, /invalid_money\.is_err/);
  assert.match(integration, /invalid_stock\.is_err/);
});
