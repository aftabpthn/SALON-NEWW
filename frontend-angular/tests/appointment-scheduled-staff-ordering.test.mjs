import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('scheduled staff supports drag ordering, A-Z sorting, and saved order', () => {
  const component = read('../src/app/pages/appointments/appointments-page.component.ts');
  const template = read('../src/app/pages/appointments/appointments-page.component.html');

  assert.match(template, /draggable="true"/);
  assert.match(template, /dropScheduledStaff\(person\.id, \$event\)/);
  assert.match(template, /sortScheduledStaffAlphabetically\(\)/);
  assert.match(component, /localeCompare\(second\.name/);
  assert.match(component, /orderedIds: this\.staff\.map/);
});

test('staff calendar keeps readable columns with a visible horizontal scrollbar', () => {
  const component = read('../src/app/pages/appointments/appointments-page.component.ts');
  const styles = read('../src/app/pages/appointments/appointments-page.component.css');

  assert.match(component, /repeat\(\$\{staffCount\}, \$\{staffWidth\}\)/);
  assert.match(component, /minmax\(220px, 1fr\)/);
  assert.match(styles, /overflow-x: scroll;/);
  assert.match(styles, /\.time-col \{[\s\S]*?position: sticky;[\s\S]*?left: 0;/);
});
