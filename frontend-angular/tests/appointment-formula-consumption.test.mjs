import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('appointment formula consumption keeps recipe, attribution and approval wiring connected', () => {
  const page = readFileSync('src/app/pages/inventory/backbar-consumption/backbar-consumption-page.component.ts', 'utf8');
  const template = readFileSync('src/app/pages/inventory/backbar-consumption/backbar-consumption-page.component.html', 'utf8');
  const api = readFileSync('src/app/features/inventory/backbar-control.service.ts', 'utf8');
  assert.match(page, /appointmentId: this\.draft\.appointmentId \|\| null/);
  assert.match(page, /this\.backbar\.usage\(this\.filterDate, this\.filterStaff, this\.filterClient, this\.filterAppointment\)/);
  assert.match(template, /Recipe expected quantity/);
  assert.match(template, /Actual mixed quantity/);
  assert.match(template, /review\(row, 'approve'\)/);
  assert.match(api, /query\.set\('appointmentId', appointmentId\)/);
});
