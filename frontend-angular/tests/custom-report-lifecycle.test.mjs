import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('custom reports stop schedules and archive without hard delete', () => {
  const repository = read('../backend-rust/src/repositories/analytics_repository.rs');
  const service = read('../backend-rust/src/services/analytics_service.rs');
  const routes = read('../backend-rust/src/routes/reports.rs');
  const page = read('src/app/pages/reports/reports-page.component.html');

  assert.match(routes, /reports\/custom\/:id\/lifecycle/);
  assert.match(service, /custom-report\.schedule\.stopped/);
  assert.match(service, /custom-report\.archived/);
  assert.match(service, /custom-report\.restored/);
  assert.match(repository, /schedule_frequency='none'/);
  assert.match(repository, /next_run_at=CASE WHEN schedule_frequency='none' THEN NULL ELSE \$5 END/);
  assert.match(repository, /active=CASE WHEN \$5='archive' THEN FALSE WHEN \$5='restore' THEN TRUE/);
  assert.doesNotMatch(repository, /DELETE FROM custom_reports/i);
  assert.match(page, />Stop schedule</);
  assert.match(page, />Archive</);
  assert.match(page, />Restore</);
});
