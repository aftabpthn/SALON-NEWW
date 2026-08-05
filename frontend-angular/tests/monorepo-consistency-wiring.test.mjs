import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const script = read('../../scripts/check-monorepo-consistency.mjs');
const workflow = read('../../.github/workflows/staff-quality-gate.yml');
const baseline = JSON.parse(read('../../docs/evidence/monorepo-consistency-baseline.json'));
const docs = read('../../docs/MONOREPO_CONSISTENCY.md');

test('the check runs in the pull-request gate', () => {
  assert.match(workflow, /node scripts\/check-monorepo-consistency\.mjs/);
  // The gate is the only workflow that runs on pull_request, so a check that is
  // not in it is a check that never runs — which is how the parity register
  // rotted in the first place.
  assert.match(workflow, /on:\s*\n\s*pull_request:/);
});

test('the baseline is a debt ceiling, not a rubber stamp', () => {
  // --baseline must refuse to record a list worse than the one on disk,
  // otherwise the check can be waved through instead of satisfied.
  assert.match(script, /Refusing to record a worse baseline/);
  assert.match(script, /process\.exit\(1\)/);
});

test('new drift fails the build while known drift does not', () => {
  assert.match(script, /newDrift\.length \|\| newForks\.length/);
  // Failing today on the Angular 20-vs-21 gap would only teach people to skip
  // the check, so the existing gap is recorded rather than enforced.
  assert.ok(baseline.driftedDependencies.length > 0, 'baseline should record the known drift');
  assert.ok(baseline.driftedDependencies.includes('@angular/core'));
});

test('app shells are not treated as forked shared code', () => {
  // Every app has its own screens; app.component.ts and app.routes.ts are
  // supposed to differ, and flagging them would drown the real signal.
  assert.doesNotMatch(script, /SHARED_CONCERNS = \[[^\]]*app\.component\.ts/s);
  assert.doesNotMatch(script, /SHARED_CONCERNS = \[[^\]]*app\.routes\.ts/s);
  assert.match(script, /SHARED_CONCERNS = \[[^\]]*csrf\.interceptor\.ts/s);
  assert.ok(!baseline.forkedSharedModules.includes('app.component.ts'));
  // csrf.interceptor.ts used to stand here as the example of a recorded fork.
  // Unifying it across the three apps burned that entry off the baseline, so
  // the assertion moved to a module that is still forked.
  assert.ok(baseline.forkedSharedModules.includes('auth.service.ts'));
});

test('the debt has a written route out', () => {
  // A baseline with no plan to reduce it is just a permanent excuse.
  assert.match(docs, /Burning the baseline down/);
  assert.match(docs, /Angular 20 to 21/);
});
