import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('staff profile photos reach authenticated appointment avatars', () => {
  const backend = read('../../backend-rust/src/routes/staff.rs');
  const appointments = read('../src/app/pages/appointments/appointments-page.component.ts');
  const template = read('../src/app/pages/appointments/appointments-page.component.html');
  const staff = read('../src/app/pages/staff/staff-page.component.ts');
  const staffTemplate = read('../src/app/pages/staff/staff-page.component.html');

  assert.match(backend, /pub photo_url: String/);
  assert.match(backend, /FROM staff_profiles/);
  assert.match(appointments, /this\.api\.getBlob\(url\)/);
  assert.match(appointments, /scheduledStaffSelection = Object\.fromEntries\(this\.staff\.map/);
  assert.match(template, /@if \(column\.photoUrl\)/);
  assert.match(staff, /Photo must be JPG or PNG/);
  assert.match(staffTemplate, /accept="image\/jpeg,image\/png"/);
});
