import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/app/pages/staff/attendance-summary/staff-attendance-summary-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/staff/attendance-summary/staff-attendance-summary-page.component.html', 'utf8');
const repository = readFileSync('../backend-rust/src/repositories/staff_attendance_repository.rs', 'utf8');

test('attendance summary uses one initial request and includes active staff', () => {
  assert.match(source, /ngOnInit\(\) \{ void this\.loadSummary\(\); \}/);
  assert.doesNotMatch(source, /\/staff\/list/);
  assert.doesNotMatch(repository, /a\.staff_id IS NOT NULL OR su\.staff_id IS NOT NULL/);
});

test('attendance summary actions stay wired', () => {
  const handlers = [...template.matchAll(/\(click\)="([A-Za-z][A-Za-z0-9]*)\(/g)].map((match) => match[1]);
  for (const handler of new Set(handlers)) assert.match(source, new RegExp(`\\b${handler}\\(`), `missing ${handler}`);
  for (const path of ['/staff-attendance/summary', '/details', '/correction']) assert.match(source, new RegExp(path));
});
