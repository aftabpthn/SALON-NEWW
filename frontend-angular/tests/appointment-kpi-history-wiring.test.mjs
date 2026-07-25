import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('appointment KPI cards open API-backed status and waitlist history', () => {
  const component = read('../src/app/pages/appointments/appointments-page.component.ts');
  const template = read('../src/app/pages/appointments/appointments-page.component.html');

  assert.match(template, /openSummaryMetric\(item\.label, item\.statuses, item\.command\)/);
  assert.match(template, /kpiHistoryAppointmentRows/);
  assert.match(template, /kpiHistoryWaitlistRows/);
  assert.match(component, /this\.isActiveDayAppointment\(item\).*statuses\.includes/s);
  assert.match(component, /if \(command === 'waitlist'\) void this\.loadWaitlist\(\)/);
});
