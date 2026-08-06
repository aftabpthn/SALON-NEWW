import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const component = readFileSync(new URL('../src/app/pages/appointments/appointments-page.component.ts', import.meta.url), 'utf8');

test('appointment calendar uses saved branch time settings without hiding previous slots', () => {
  assert.match(component, /getJson<any>\('\/api\/v1\/appointment-settings'\)/);
  assert.match(component, /const start = this\.minutesFromTime\(this\.appointmentSettings\.startTime\)/);
  assert.match(component, /const end = Math\.max\(start \+ this\.appointmentSettings\.slotMinutes, this\.minutesFromTime\(this\.appointmentSettings\.endTime\)\)/);
  assert.match(component, /grid\.scrollTop = this\.appointmentSettings\.previousTimeSlot\s*\? 0\s*:/);
});
