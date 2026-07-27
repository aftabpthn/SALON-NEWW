import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('employee schedule cells can copy the first shift time by tick', () => {
  const component = read('../src/app/pages/availability/availability-page.component.ts');
  const template = read('../src/app/pages/availability/availability-page.component.html');
  const styles = read('../src/app/pages/availability/availability-page.component.css');

  assert.match(component, /timeTemplateFor\(staffId: string\)[\s\S]*this\.days\.map/);
  assert.match(component, /applyTemplateTime\(event: Event, person: ScheduleStaff, date: string\)/);
  assert.match(component, /shift1Start: template\.shift1Start/);
  assert.match(component, /shift2End: template\.shift2End/);
  assert.match(component, /status: 'working' as ScheduleStatus/);
  assert.match(component, /this\.api\.put<ApiEnvelope<unknown>>\('\/staff-schedule'/);

  assert.match(template, /class="time-copy-toggle"/);
  assert.match(template, /\[class\.active\]="hasTemplateTime\(person\.id,date\)"/);
  assert.match(template, /\(click\)="applyTemplateTime\(\$event,person,date\)"/);
  assert.match(template, /class="schedule-cell-main"[\s\S]*openEditor\(person,date\)/);
  assert.match(styles, /\.time-copy-toggle/);
  assert.match(styles, /\.time-copy-toggle\.active/);
});
