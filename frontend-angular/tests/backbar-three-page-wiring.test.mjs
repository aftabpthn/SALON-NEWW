import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const frontend = path.resolve(import.meta.dirname, '..');
const backend = path.resolve(frontend, '..', 'backend-rust');
const readFrontend = (file) => fs.readFileSync(path.join(frontend, file), 'utf8');
const readBackend = (file) => fs.readFileSync(path.join(backend, file), 'utf8');

test('8th-point inventory workflow exposes the three approved page views', () => {
  const routes = readFrontend('src/app/app.routes.ts');
  const recipes = readFrontend('src/app/pages/inventory/service-recipes/service-recipes-page.component.html');
  const consume = readFrontend('src/app/pages/inventory/backbar-consumption/backbar-consumption-page.component.html');
  const containers = readFrontend('src/app/pages/inventory/backbar-containers/backbar-container-control-page.component.html');
  assert.match(routes, /inventory\/recipes/);
  assert.match(routes, /inventory\/backbar'/);
  assert.match(routes, /inventory\/backbar\/containers/);
  assert.match(recipes, /Service Recipe Command Center/);
  assert.match(recipes, /Demand 15 Days/);
  assert.match(consume, /Live Product Consume/);
  assert.match(consume, /Over-limit usage requires (owner|manager) approval/);
  assert.match(containers, /Backbar Container Control/);
  assert.match(containers, /Product 360/);
});

test('backbar pages share one API service and reload real server data after writes', () => {
  const service = readFrontend('src/app/features/inventory/backbar-control.service.ts');
  const consume = readFrontend('src/app/pages/inventory/backbar-consumption/backbar-consumption-page.component.ts');
  const containers = readFrontend('src/app/pages/inventory/backbar-containers/backbar-container-control-page.component.ts');
  for (const contract of ['/inventory/backbar-usage', '/inventory/backbar-containers']) assert.match(service, new RegExp(contract.replaceAll('/', '\\/')));
  assert.match(service, /product360\(productId: string\)/);
  assert.match(consume, /BackbarControlService/);
  assert.match(containers, /await this\.load\(\)/);
  assert.doesNotMatch(service, /mock|dummy|sample/i);
});

test('service recipe approval queue exposes permission-gated approve and reject actions', () => {
  const component = readFrontend('src/app/pages/inventory/service-recipes/service-recipes-page.component.ts');
  const template = readFrontend('src/app/pages/inventory/service-recipes/service-recipes-page.component.html');
  const service = readFrontend('src/app/features/inventory/backbar-control.service.ts');
  const route = readBackend('src/routes/inventory.rs');
  const adjustment = readBackend('src/services/inventory_adjustment_service.rs');

  assert.match(component, /hasRole\('owner'\).*hasPermission\('inventory\.approve'\)/);
  assert.match(component, /reviewUsage\(row\.id, \{ decision, reviewNote:/);
  assert.match(component, /this\.usage = await this\.get<Usage\[]>\('\/inventory\/backbar-usage\?limit=500'\)/);
  assert.match(template, /\(click\)="review\(row, 'approve'\)"/);
  assert.match(template, /\(click\)="review\(row, 'reject'\)"/);
  assert.match(service, /\/inventory\/backbar-usage\/\$\{id\}\/review/);
  assert.match(route, /permission == "inventory\.approve"/);
  assert.match(adjustment, /backbar usage requester cannot approve their own variance/);
});

test('backend rejects a second open container for the same product', () => {
  const repository = readBackend('src/repositories/inventory_governance_repository.rs');
  assert.match(repository, /NOT EXISTS/);
  assert.match(repository, /active\.inventory_item_id=c\.inventory_item_id AND active\.status='open'/);
});
