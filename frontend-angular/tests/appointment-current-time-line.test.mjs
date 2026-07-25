import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('current-time line auto-scrolls into view below appointment cards', () => {
  const component = read('../src/app/pages/appointments/appointments-page.component.ts');
  const styles = read('../src/app/pages/appointments/appointments-page.component.css');

  assert.match(component, /updateCurrentTimeLine\(true\)/);
  assert.match(component, /grid\.scrollTop = Math\.max\(0, headerHeight \+ this\.currentTimeTop/);
  assert.match(styles, /\.current-time-line \{[\s\S]*?z-index: 1;/);
  assert.match(styles, /\.booking \{[\s\S]*?z-index: 2;/);
});
