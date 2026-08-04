import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/app/pages/staff/attendance-summary/staff-attendance-summary-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/staff/attendance-summary/staff-attendance-summary-page.component.html', 'utf8');
const repository = readFileSync('../backend-rust/src/repositories/staff_attendance_repository.rs', 'utf8');

test('attendance summary loads without a per-staff fan-out and includes active staff', () => {
  // The original defect was a roster fan-out on init: the page pulled the
  // staff list and then queried per staff member. Pin that shape, not the exact
  // body of ngOnInit — the pending-corrections panel renders on first paint and
  // legitimately adds a second, constant-cost request.
  const onInit = source.match(/ngOnInit\(\)\s*\{([^}]*)\}/);
  assert.ok(onInit, 'ngOnInit should exist');
  const initialLoads = onInit[1].match(/this\.load[A-Za-z]*\(/g) || [];
  assert.deepEqual(initialLoads, ['this.loadSummary(', 'this.loadCorrectionRequests(']);
  assert.doesNotMatch(source, /\/staff\/list/);
  assert.doesNotMatch(repository, /a\.staff_id IS NOT NULL OR su\.staff_id IS NOT NULL/);
});

test('attendance summary actions stay wired', () => {
  const handlers = [...template.matchAll(/\(click\)="([A-Za-z][A-Za-z0-9]*)\(/g)].map((match) => match[1]);
  for (const handler of new Set(handlers)) assert.match(source, new RegExp(`\\b${handler}\\(`), `missing ${handler}`);
  for (const path of ['/staff-attendance/summary', '/details', '/correction']) assert.match(source, new RegExp(path));
});

test('manager can save physical attendance with every supported status', () => {
  assert.match(template, /Physical attendance/);
  for (const status of ['present', 'absent', 'late', 'half_day', 'leave', 'weekly_off', 'holiday']) {
    assert.match(template, new RegExp(`value="${status}"`));
  }
  for (const path of ['/clock-in', '/clock-out', '/correction']) assert.match(source, new RegExp(path));
  assert.match(source, /await this\.loadSummary\(\)/);
});

test('attendance details show saved shifts, metrics and calculation source', () => {
  for (const field of ['scheduledShift1Start', 'scheduledShift1End', 'scheduledShift2Start', 'scheduledShift2End']) assert.match(source, new RegExp(field));
  for (const label of ['Clock in', 'Clock out', 'Worked', 'Break', 'Scheduled', 'Late', 'Early leave', 'Overtime']) assert.match(template, new RegExp(label));
  assert.match(template, /sourceLabel\(detail\)/);
  assert.match(repository, /s\.shift1_start AS scheduled_shift1_start/);
});
