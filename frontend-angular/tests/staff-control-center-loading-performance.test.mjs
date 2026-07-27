import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/app/pages/staff/control-center/staff-control-center-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/staff/control-center/staff-control-center-page.component.html', 'utf8');
const routes = readFileSync('src/app/app.routes.ts', 'utf8');
const backend = ['staff_advanced.rs', 'staff_enterprise.rs', 'staff_operations.rs', 'marketing_leads.rs']
  .map((file) => readFileSync(`../backend-rust/src/routes/${file}`, 'utf8'))
  .join('\n');
const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('staff control center loads only the active tab', () => {
  const refresh = block('async refresh()', 'private tabRequests');
  const command = block("if (tab === 'command')", "if (tab === 'workforce')");
  const content = block("if (tab === 'content')", "this.loadList('/staff/approvals");

  assert.match(refresh, /tabRequests\(this\.activeTab\)/);
  assert.equal((command.match(/this\.load(?:One|List)\(/g) || []).length, 2);
  assert.match(content, /this\.loadList\('\/staff\/tasks'/);
  assert.match(content, /this\.loadList\('\/marketing\/offers'/);
  assert.match(content, /this\.loadList\('\/staff\/payroll-adjustment-rules'/);
  assert.match(source, /async selectTab\(tab: WorkspaceTab\)[\s\S]*await this\.refresh\(\)/);
});

test('staff control center actions, pages and API paths stay connected', () => {
  const handlers = [...template.matchAll(/\(click\)="([A-Za-z][A-Za-z0-9]*)\(/g)].map((match) => match[1]);
  for (const handler of new Set(handlers)) assert.match(source, new RegExp(`\\b${handler}\\(`), `missing ${handler}`);

  for (const label of [
    'Add shift swap', 'Add branch transfer', 'Optimize roster',
    'Add license', 'Add review', 'Assign training', 'Add coaching goal',
    'Add biometric device', 'Register gateway', 'Add device mapping', 'Register mobile device',
    'Add approval', 'Add notification template', 'Add feedback resolution',
    'Add task', 'Add offer', 'Add penalty/payroll rule',
    'Add evidence', 'Add geo rule', 'Provider config', 'Add risk', 'Payroll preview',
  ]) {
    assert.ok(template.includes(label), `${label} command is missing`);
  }

  for (const route of ['staff', 'staff/attendance-summary', 'staff/leave-management', 'staff/payroll']) {
    assert.match(routes, new RegExp(`path: '${route.replace('/', '\\/')}'`), `missing route ${route}`);
  }

  assert.match(source, /this\.action\('\/staff\/coach\/goals'/);
  assert.match(source, /this\.action\('\/staff\/approvals'/);
  assert.match(source, /this\.action\(`\/staff\/feedback\/\$\{feedbackId\}`/);

  const apiPaths = [...source.matchAll(/this\.(?:loadOne|loadList|action|actionWithHeaders)(?:<[^>]+>)?\(\s*([`'"])(\/[\s\S]*?)\1/g)]
    .map((match) => match[2].split('?')[0].replace(/\$\{[^}]+\}/g, ':'));
  const backendPaths = [...backend.matchAll(/"(\/[^"?]+)"/g)].map((match) => match[1].replace(/:[^/]+/g, ':'));
  for (const path of new Set(apiPaths)) assert.ok(backendPaths.includes(path), `missing backend route ${path}`);
});
