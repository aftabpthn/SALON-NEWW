import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('appointment formula consumption keeps recipe, attribution and approval wiring connected', () => {
  const page = readFileSync('src/app/pages/inventory/backbar-consumption/backbar-consumption-page.component.ts', 'utf8');
  const template = readFileSync('src/app/pages/inventory/backbar-consumption/backbar-consumption-page.component.html', 'utf8');
  const api = readFileSync('src/app/features/inventory/backbar-control.service.ts', 'utf8');
  // The appointment is now mandatory on a bowl rather than an optional field
  // that fell back to null, so assert both the guard and the payload.
  assert.match(page, /!this\.draft\.appointmentId[\s\S]{0,200}?Appointment, client, service and stylist are required/);
  assert.match(page, /appointmentId: this\.draft\.appointmentId/);
  assert.match(page, /this\.backbar\.usage\(this\.filterDate, this\.filterStaff, this\.filterClient, this\.filterAppointment\)/);
  // Expected-vs-actual is the point of the recipe check; the columns were
  // renamed but must both stay on the page alongside the variance.
  assert.match(template, /Expected/);
  assert.match(template, /Actual/);
  assert.match(template, /[Vv]ariance/);
  assert.match(template, /review\(row, 'approve'\)/);
  assert.match(api, /query\.set\('appointmentId', appointmentId\)/);
});
