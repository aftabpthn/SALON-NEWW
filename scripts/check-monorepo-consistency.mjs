#!/usr/bin/env node
// Monorepo consistency: stop the three front-end apps drifting further apart.
//
// This repository is a monorepo — one git repo holding three Angular apps, a
// Rust backend and a Python service — with none of the tooling a monorepo
// normally brings. Nothing enforced that the apps agree, and they stopped
// agreeing: 16 of the 21 dependencies they share are on different versions,
// including a whole major of Angular, and cross-cutting modules copied between
// apps have diverged in place.
//
// The fix is not to align everything today. Moving staff-app and customer-app
// from Angular 20 to 21 is a major upgrade that has to be done and tested
// deliberately, not swept in by a lint script. So this records what is already
// wrong as a baseline and fails only on *new* drift: the debt stays visible and
// countable, and nothing can quietly add to it.
//
//   node scripts/check-monorepo-consistency.mjs             # verify
//   node scripts/check-monorepo-consistency.mjs --baseline  # re-record
//
// Re-recording is how you *reduce* the baseline after aligning something. It
// will refuse to record a baseline that is worse than the one on disk, so it
// cannot be used to paper over a regression.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const baselinePath = resolve(root, 'docs/evidence/monorepo-consistency-baseline.json');

const APPS = ['frontend-angular', 'staff-app', 'customer-app'];

// Modules that solve the same problem in more than one app. These are the ones
// where divergence is a bug rather than a design: a CSRF interceptor that
// retries in one app and not another is one app quietly missing a fix.
//
// App shells and route tables are deliberately excluded — every app has its own
// screens, so app.component.ts and app.routes.ts are *supposed* to differ.
const SHARED_CONCERNS = [
  'csrf.interceptor.ts',
  'auth.guard.ts',
  'auth.interceptor.ts',
  'auth.service.ts',
  'clock.service.ts',
];

const read = (path) => readFileSync(path, 'utf8');
const sha = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

function packageDeps(app) {
  const manifest = JSON.parse(read(resolve(root, app, 'package.json')));
  return { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) };
}

/** Dependencies more than one app declares, and whether they agree. */
function dependencyDrift() {
  const byDependency = new Map();
  for (const app of APPS) {
    for (const [name, version] of Object.entries(packageDeps(app))) {
      if (!byDependency.has(name)) byDependency.set(name, {});
      byDependency.get(name)[app] = version;
    }
  }
  const drift = [];
  for (const [name, versions] of [...byDependency].sort()) {
    const apps = Object.keys(versions);
    if (apps.length < 2) continue;
    if (new Set(Object.values(versions)).size === 1) continue;
    drift.push({ dependency: name, versions });
  }
  return drift;
}

function walk(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else found.push(path);
  }
  return found;
}

/** Cross-cutting modules that exist in several apps and no longer match. */
function forkedSharedConcerns() {
  const byName = new Map();
  for (const app of APPS) {
    for (const path of walk(resolve(root, app, 'src/app'))) {
      const name = path.split('/').pop();
      if (!SHARED_CONCERNS.includes(name)) continue;
      if (!byName.has(name)) byName.set(name, {});
      byName.get(name)[app] = sha(read(path));
    }
  }
  const forked = [];
  for (const [name, hashes] of [...byName].sort()) {
    const apps = Object.keys(hashes);
    if (apps.length < 2) continue;
    if (new Set(Object.values(hashes)).size === 1) continue;
    forked.push({ module: name, apps: apps.sort() });
  }
  return forked;
}

const current = {
  driftedDependencies: dependencyDrift().map((entry) => entry.dependency),
  forkedSharedModules: forkedSharedConcerns().map((entry) => entry.module),
};

if (process.argv.includes('--baseline')) {
  if (existsSync(baselinePath)) {
    const previous = JSON.parse(read(baselinePath));
    // A baseline is a debt ceiling. Letting it rise on demand would turn this
    // check into a rubber stamp, which is the failure mode it exists to avoid.
    const worse = [
      ...current.driftedDependencies.filter((name) => !previous.driftedDependencies.includes(name))
        .map((name) => `dependency ${name} drifted`),
      ...current.forkedSharedModules.filter((name) => !previous.forkedSharedModules.includes(name))
        .map((name) => `shared module ${name} forked`),
    ];
    if (worse.length) {
      console.error('Refusing to record a worse baseline. Fix these first:\n  ' + worse.join('\n  '));
      process.exit(1);
    }
  }
  writeFileSync(baselinePath, `${JSON.stringify({
    recordedAt: new Date().toISOString(),
    note: 'Known drift. New entries fail CI; this list should only ever shrink.',
    ...current,
  }, null, 2)}\n`);
  console.log(JSON.stringify({ recorded: current }, null, 2));
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error(`Missing ${baselinePath}; run once with --baseline.`);
  process.exit(1);
}

const baseline = JSON.parse(read(baselinePath));
const newDrift = current.driftedDependencies.filter((name) => !baseline.driftedDependencies.includes(name));
const newForks = current.forkedSharedModules.filter((name) => !baseline.forkedSharedModules.includes(name));
const fixed = [
  ...baseline.driftedDependencies.filter((name) => !current.driftedDependencies.includes(name)),
  ...baseline.forkedSharedModules.filter((name) => !current.forkedSharedModules.includes(name)),
];

const summary = {
  apps: APPS.length,
  driftedDependencies: current.driftedDependencies.length,
  forkedSharedModules: current.forkedSharedModules.length,
  baselineDriftedDependencies: baseline.driftedDependencies.length,
  baselineForkedSharedModules: baseline.forkedSharedModules.length,
  newDrift,
  newForks,
  fixedSinceBaseline: fixed,
};
console.log(JSON.stringify(summary, null, 2));

if (newDrift.length || newForks.length) {
  console.error(
    '\nNew drift since the baseline:\n' +
    newDrift.map((name) => `  ${name} is on a different version in different apps`).join('\n') +
    (newDrift.length && newForks.length ? '\n' : '') +
    newForks.map((name) => `  ${name} exists in several apps and they no longer match`).join('\n') +
    '\n\nAlign it, or if the difference is deliberate run --baseline to record it.'
  );
  process.exit(1);
}

if (fixed.length) {
  console.log(`\n${fixed.length} baseline item(s) fixed. Run --baseline to lock the improvement in.`);
}
