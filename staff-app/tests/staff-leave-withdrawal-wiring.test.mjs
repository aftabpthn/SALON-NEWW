import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('pending leave requests are withdrawn without hard delete', () => {
  const route = read('../backend-rust/src/routes/staff_leave.rs');
  const repository = read('../backend-rust/src/repositories/staff_leave_repository.rs');
  const migration = read('../backend-rust/migrations/0285_staff_leave_withdrawal.sql');
  const page = read('src/app/features/staff/staff-leaves.page.ts');
  const client = read('src/app/core/staff-app.service.ts');
  const dates = read('src/app/core/business-date.ts');

  assert.match(route, /requests\/:id\/withdraw/);
  assert.match(route, /staff\.leave\.withdrawn/);
  assert.match(repository, /status='withdrawn'/);
  assert.match(repository, /staff_id=\$4 AND status='pending' AND version=\$6/);
  assert.doesNotMatch(repository, /DELETE FROM staff_leave_requests/i);
  assert.match(migration, /'withdrawn'/);
  assert.match(page, /\(click\)="withdrawLeave\(leave\)"/);
  assert.match(client, /"staff\.app\.leaves\.manage": \["staff\.leave\.manage"/);
  assert.match(route, /"staff\.leave\.manage",\s*"staff\.self_manage"/);
  assert.match(page, /aura-staff-date-picker/);
  assert.match(page, /parseDisplayBusinessDate/);
  assert.match(dates, /parsed\.getUTCFullYear\(\) === year/);
});
