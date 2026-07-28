import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('schedule drawer supports adding and removing second shift', () => {
  const component = read('../src/app/pages/availability/availability-page.component.ts');
  const template = read('../src/app/pages/availability/availability-page.component.html');
  const css = read('../src/app/pages/availability/availability-page.component.css');

  assert.match(component, /editorSecondShiftOpen = false/);
  assert.match(component, /this\.editorSecondShiftOpen = this\.hasSecondShift\(this\.editorDraft\)/);
  assert.match(component, /hasSecondShift\(entry: ScheduleEntry\)/);
  assert.match(component, /addSecondShift\(\)[\s\S]+this\.editorSecondShiftOpen = true/);
  assert.match(component, /removeSecondShift\(\)[\s\S]+this\.editorDraft\.shift2Start = ''/);

  assert.match(template, /@if \(hasSecondShift\(editorDraft\)\)/);
  assert.match(template, /Add shift/);
  assert.match(template, /Remove/);
  assert.match(template, /\[\(ngModel\)\]="editorDraft\.shift2Start"/);
  assert.match(template, /\[\(ngModel\)\]="editorDraft\.shift2End"/);

  assert.match(css, /\.add-shift-button/);
  assert.match(css, /\.link-button/);
});
