import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('all eight inventory completion contracts are wired to real persistence and APIs', () => {
  const migration = read('backend-rust/migrations/0230_inventory_intelligence_completion.sql');
  const extraction = read('ai-service/purchase_bill_extraction.py');
  const purchaseRepo = read('backend-rust/src/repositories/purchase_bill_draft_repository.rs');
  const reorder = read('backend-rust/src/services/inventory_reorder_forecast_service.rs');
  const inventoryRepo = read('backend-rust/src/repositories/inventory_repository.rs');
  const governanceRepo = read('backend-rust/src/repositories/inventory_governance_repository.rs');
  const controls = read('backend-rust/src/services/inventory_controls_service.rs');
  const backbar = read('frontend-angular/src/app/pages/inventory/backbar-consumption/backbar-consumption-page.component.ts');
  const recipes = read('frontend-angular/src/app/pages/inventory/service-recipes/service-recipes-page.component.ts');
  const containers = read('frontend-angular/src/app/pages/inventory/backbar-containers/backbar-container-control-page.component.ts');

  assert.match(extraction, /_extract_anthropic/);
  assert.match(extraction, /_local_ocr/);
  assert.match(migration, /purchase_bill_item_aliases/);
  assert.match(purchaseRepo, /learn_item_alias/);

  assert.match(migration, /reorder_history_days[\s\S]*DEFAULT 60/);
  assert.match(migration, /reorder_coverage_days[\s\S]*DEFAULT 30/);
  assert.match(reorder, /seasonal-demand-v3/);

  assert.match(inventoryRepo, /'branchStocks'/);
  assert.match(inventoryRepo, /'clientUsage'/);
  assert.match(inventoryRepo, /pub async fn exception_evidence[\s\S]*inventory_backbar_usage[\s\S]*purchase_bill_drafts[\s\S]*inventory_digital_twin_ledger[\s\S]*inventory_backbar_containers/);
  assert.match(governanceRepo, /qualityEvents/);
  assert.match(governanceRepo, /replacementOptions/);

  assert.match(inventoryRepo, /ORDER BY expiry_date NULLS LAST,received_date,id FOR UPDATE/);
  assert.match(controls, /all_branches/);

  assert.match(migration, /service_recipe_versions/);
  assert.match(migration, /client_id TEXT REFERENCES clients/);
  assert.match(backbar, /clientId: this\.draft\.clientId/);
  assert.match(recipes, /missingRecipeAlerts/);
  assert.match(recipes, /service-recipes\/\$\{serviceId\}\/versions/);
  assert.match(containers, /containerLabel/);
  assert.match(containers, /window\.print/);
});

test('autonomous inventory stays budgeted, scheduled and approval controlled', () => {
  const migration = read('backend-rust/migrations/0242_inventory_autonomous_operations.sql');
  const budgetMigration = read('backend-rust/migrations/0246_inventory_cashflow_category_budgets.sql');
  const routes = read('backend-rust/src/routes/inventory.rs');
  const controls = read('backend-rust/src/services/inventory_controls_service.rs');
  const repository = read('backend-rust/src/repositories/inventory_repository.rs');
  const worker = read('backend-rust/src/main.rs');
  const page = read('frontend-angular/src/app/pages/inventory/advanced-controls/advanced-controls-page.component.ts');

  assert.match(migration, /inventory_automation_policies/);
  assert.match(migration, /inventory_automation_actions/);
  assert.match(budgetMigration, /category_budgets_paise/);
  assert.match(routes, /inventory\/autonomous-operations\/actions\/:id\/review/);
  assert.match(controls, /budget_allows\(remaining_budget, cost\)/);
  assert.match(controls, /spendable_budget\(policy\.monthly_budget_paise, &budget\)/);
  assert.match(controls, /category_remaining[\s\S]*recommendation\.product_category/);
  assert.match(repository, /outgoing_fund_vouchers[\s\S]*status='pending'/);
  assert.match(repository, /CASH_ON_HAND','BANK_CLEARING/);
  assert.match(controls, /pg_try_advisory_lock/);
  assert.match(controls, /transfer_opportunities\([\s\S]*destination_branch[\s\S]*option\.suggested_quantity >= quantity/);
  assert.match(controls, /option\.source_safe[\s\S]*option\.cost_decision != "purchase"/);
  assert.match(controls, /transfer draft is stale; live stock, demand, safety, or cost no longer supports it/);
  assert.match(controls, /"destinationBranchId": option\.destination_branch_id/);
  assert.match(controls, /"route": "\/inventory\/transfers"/);
  assert.match(controls, /"transfer_draft" \| "expiry_rescue"[\s\S]*execute_approved_transfer/);
  assert.match(controls, /expiry rescue is stale; the batch, demand, safety, quantity, or cost changed/);
  assert.match(controls, /"reconciliation" => \{[\s\S]*gl_reconciliation[\s\S]*issue_count > 0[\s\S]*still has unresolved GL or Digital Twin exceptions/);
  assert.match(controls, /inventory_transfer_service::dispatch/);
  assert.match(controls, /purchase_service::transition_order/);
  assert.match(repository, /recover_stale_automation_actions/);
  assert.match(worker, /process_due_automation/);
  assert.match(page, /saveAutomationPolicy/);
  assert.match(page, /reviewAutomation/);
  assert.match(page, /row\.actionType === 'transfer_draft' \|\| row\.actionType === 'expiry_rescue'[\s\S]*return '\/inventory\/transfers'/);
});

test('transfer optimizer compares configurable landed cost with purchase cost', () => {
  const migration = read('backend-rust/migrations/0245_inventory_transfer_landed_cost.sql');
  const repository = read('backend-rust/src/repositories/inventory_repository.rs');
  const controls = read('backend-rust/src/services/inventory_controls_service.rs');
  const page = read('frontend-angular/src/app/pages/inventory/advanced-controls/advanced-controls-page.component.html');

  for (const field of ['transfer_base_transport_cost_paise', 'transfer_cost_per_km_paise', 'transfer_handling_cost_per_unit_paise', 'transfer_delay_cost_per_unit_day_paise', 'transfer_expected_days']) assert.match(migration, new RegExp(field));
  for (const component of ['stock_transfer_cost_paise', 'transport_cost_paise', 'handling_cost_paise', 'delay_cost_paise']) assert.match(repository, new RegExp(component));
  assert.match(repository, /landed_transfer_cost_paise[\s\S]*landed_purchase_cost_paise/);
  assert.match(repository, /distance_km/);
  assert.match(controls, /estimated_transfer_cost_paise[\s\S]*estimated_purchase_cost_paise/);
  assert.match(page, /Transfer base transport/);
  assert.match(page, /Transfer delay per unit\/day/);
});
