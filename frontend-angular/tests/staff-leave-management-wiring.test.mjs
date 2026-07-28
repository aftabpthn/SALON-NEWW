import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('leave management tabs and actions use connected leave APIs', () => {
  const component = read('../src/app/pages/staff/leave-management/staff-leave-management-page.component.ts');
  const template = read('../src/app/pages/staff/leave-management/staff-leave-management-page.component.html');
  const routes = read('../../backend-rust/src/routes/staff_leave.rs');

  assert.match(component, /type LeaveTab = 'requests' \| 'balances' \| 'calendar'/);
  assert.match(component, /private readonly route = inject\(ActivatedRoute\)/);
  assert.match(component, /this\.applyQueryParams\(\)/);
  assert.match(component, /async selectTab\(tab: LeaveTab\)/);
  assert.match(component, /queryParams: \{[\s\S]*tab: this\.activeTab,[\s\S]*staffId: this\.staffId \|\| null,[\s\S]*status: this\.status \|\| null/);
  assert.match(template, /\(click\)="selectTab\(tab\.key\)"/);

  for (const endpoint of [
    '/staff-leave/requests',
    '/staff-leave/balances',
    '/staff-leave/requests/${this.selectedRequest.id}/${decision}',
  ]) {
    assert.ok(component.includes(endpoint), `missing ${endpoint}`);
  }

  assert.match(component, /get canExport\(\) \{ return this\.activeTab === 'balances' \? this\.balances\.length > 0 : this\.requests\.length > 0; \}/);
  assert.match(template, /\[disabled\]="!canExport"/);
  assert.match(component, /if \(this\.staffId\) this\.form\.staffId = this\.staffId/);
  assert.doesNotMatch(component, /localStorage|sessionStorage/);

  assert.match(routes, /"\/staff-leave\/requests"[\s\S]*get\(list_requests\)\.post\(create_request\)/);
  assert.match(routes, /route\("\/staff-leave\/balances", get\(list_balances\)\)/);
  assert.match(routes, /route\("\/staff-leave\/requests\/:id\/approve", post\(approve\)\)/);
  assert.match(routes, /route\("\/staff-leave\/requests\/:id\/reject", post\(reject\)\)/);
  assert.match(routes, /staff_leave_service::approve/);
  assert.match(routes, /staff_leave_service::reject/);
});
