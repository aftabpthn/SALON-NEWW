import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/pages/reports/reports-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/reports/reports-page.component.html', 'utf8');

test('Profit Copilot exposes reconciled fact and immutable version evidence', () => {
  for (const field of ['copilotFactSchemaVersion', 'copilotFactHash', 'reconciliationReady', 'recommendationVersionId', 'evaluationStatus']) {
    assert.ok(page.includes(field), `${field} is not wired`);
  }
  assert.match(template, /RECONCILED FACTS/);
  assert.match(template, /recommendationVersion/);
});

test('Profit Copilot feedback stays inside the existing Reports workspace', () => {
  assert.match(page, /profit-intelligence\/copilot\/recommendations\/\$\{row\.recommendationVersionId\}\/feedback/);
  assert.match(template, /submitCopilotFeedback\(insight,'accepted'\)/);
  assert.match(template, /submitCopilotFeedback\(insight,'rejected'\)/);
});
