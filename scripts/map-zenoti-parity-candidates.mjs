#!/usr/bin/env node
// Triage helper for an official competitor master parity register.
//
// Most rows carry the blocker "No AuraShine evidence is mapped for this public
// Zenoti capability." That is a statement about missing *mapping
// work*, not about missing product: spot checks found shipped features sitting
// in the unmapped pile. With every row equally opaque there is no way to tell
// the two apart, so the register cannot be used to steer roadmap decisions.
//
// This script does not decide anything. For each unmapped row it searches the
// real AuraShine surface — mounted route literals, backend module names,
// frontend route paths, database tables — and reports what it found, so a human
// reviews a ranked worklist instead of thousands of identical rows. Nothing here writes
// to the register or marks a row Complete; that still requires real evidence,
// entered by a person, exactly as the register's own rules demand.
//
//   node scripts/map-zenoti-parity-candidates.mjs                     # Zenoti
//   node scripts/map-zenoti-parity-candidates.mjs --vendor salonist  # Salonist
//   node scripts/map-zenoti-parity-candidates.mjs --vendor dingg     # DINGG

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const vendorFlag = process.argv.indexOf('--vendor');
const vendor = vendorFlag >= 0 ? process.argv[vendorFlag + 1]?.toLowerCase() : 'zenoti';
if (!['zenoti', 'salonist', 'dingg'].includes(vendor)) throw new Error(`Unsupported vendor: ${vendor}`);
const vendorName = vendor === 'dingg' ? 'DINGG' : `${vendor[0].toUpperCase()}${vendor.slice(1)}`;
const registerPath = resolve(root, `docs/evidence/${vendor}-master-parity-register.json`);
const jsonOut = resolve(root, `docs/evidence/${vendor}-parity-candidates.json`);
const mdOut = resolve(root, `docs/${vendor.toUpperCase()}_PARITY_TRIAGE.md`);
const featureOf = (row) => row.zenotiFeature ?? row.feature;

// Words that appear in nearly every Help Center title and carry no signal about
// which part of the product a capability belongs to.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'in',
  'is', 'it', 'of', 'on', 'or', 'the', 'to', 'up', 'use', 'using', 'via', 'when', 'with', 'you',
  'your', 'about', 'after', 'all', 'also', 'any', 'been', 'before', 'between', 'both', 'but', 'not',
  'other', 'over', 'same', 'some', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'under', 'until', 'what', 'which', 'while', 'who', 'will',
  'zenoti', 'faqs', 'faq', 'troubleshooting', 'overview', 'guide', 'new', 'set', 'setup', 'more',
]);

const tokenise = (value) => [...new Set(
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
)];

function walk(dir, test, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(path, test, found);
    else if (test(entry.name)) found.push(path);
  }
  return found;
}

const read = (path) => readFileSync(path, 'utf8');

/** Everything AuraShine actually exposes, indexed by the words in its names. */
function auraSurface() {
  const routeRoot = resolve(root, 'backend-rust/src/routes');
  const routeMod = read(resolve(routeRoot, 'mod.rs'));
  const mountedRouteModules = new Set([
    ...routeMod.matchAll(/\.merge\(\s*([A-Za-z0-9_]+)::[A-Za-z0-9_]*router\s*\(/g),
  ].map((match) => match[1]));
  const routeFiles = ['mod.rs', ...[...mountedRouteModules].map((name) => `${name}.rs`)]
    .map((name) => resolve(routeRoot, name));
  const routes = new Set();
  for (const file of routeFiles) {
    for (const match of read(file).matchAll(/\.route\(\s*"([^"]+)"/g)) routes.add(match[1]);
  }

  const modules = new Set();
  for (const dir of ['services', 'repositories']) {
    for (const name of readdirSync(resolve(root, 'backend-rust/src', dir))) {
      if (name.endsWith('.rs') && name !== 'mod.rs') modules.add(`${dir}/${name.replace(/\.rs$/, '')}`);
    }
  }
  for (const name of mountedRouteModules) modules.add(`routes/${name}`);

  const pages = new Set();
  for (const app of ['frontend-angular', 'staff-app', 'customer-app']) {
    const appRoot = resolve(root, app, 'src/app');
    for (const file of walk(appRoot, (name) => /(?:page|component)\.ts$/.test(name))) {
      pages.add(`${app}:${relative(appRoot, file).replaceAll('\\', '/').replace(/\.ts$/, '')}`);
    }
  }

  const tables = new Set();
  for (const file of walk(resolve(root, 'backend-rust/migrations'), (name) => name.endsWith('.sql'))) {
    for (const match of read(file).matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z0-9_]+)/gi)) {
      tables.add(match[1].toLowerCase());
    }
  }

  const tests = new Set();
  for (const app of ['frontend-angular', 'staff-app', 'customer-app']) {
    for (const directory of ['tests', 'src/app']) {
      const testRoot = resolve(root, app, directory);
      try {
        for (const file of walk(testRoot, (name) => /(?:test\.mjs|spec\.ts)$/.test(name))) {
          tests.add(`${app}:${relative(resolve(root, app), file).replaceAll('\\', '/')}`);
        }
      } catch { /* The app may not own both test roots. */ }
    }
  }

  // One inverted index over every surface entry, so a lookup is a set union
  // rather than a scan of ~1500 entries per row.
  const index = new Map();
  const add = (kind, value) => {
    for (const word of tokenise(value)) {
      if (!index.has(word)) index.set(word, []);
      index.get(word).push({ kind, value });
    }
  };
  for (const route of routes) add('route', route);
  for (const module of modules) add('module', module);
  for (const page of pages) add('page', page);
  for (const table of tables) add('table', table);
  for (const test of tests) add('test', test);
  return { index, counts: { routes: routes.size, modules: modules.size, pages: pages.size, tables: tables.size, tests: tests.size } };
}

// Counting shared words treats "manage" and "no-show" as equally informative,
// which they are not: the first appears across hundreds of routes, the second
// names one specific thing. Weight each word by how rare it is on the surface,
// then score a candidate by the share of the capability's meaning it explains.
// That also removes the bias against short titles — "Enable queue" has only two
// words, and matching the rare one should count.
// A word the surface has never heard of is the strongest signal available: it
// is the reason "Backup your data" must not score as built merely because
// "data" appears everywhere. Absent words are therefore weighted as maximally
// rare, so failing to match one costs more than matching a common one gains.
function inverseFrequency(surface) {
  const total = surface.counts.routes + surface.counts.modules + surface.counts.pages + surface.counts.tables;
  const absent = Math.log(total);
  return (word) => {
    const occurrences = surface.index.get(word)?.length || 0;
    return occurrences ? Math.log(total / occurrences) : absent;
  };
}

// A table proves a migration ran, not that anything can reach the data. The
// A migration can leave a table with no route, service or screen touching it,
// while a plain keyword score rates that a perfect match.
// Matches that are only tables get their own band so the pattern is visible
// instead of being counted as progress.
function confidenceOf(coverage, kindSet, decisive) {
  if (kindSet.size && [...kindSet].every((kind) => kind === 'table')) return 'schema-only';
  // "Allow recording reasons for no-show appointments" is mostly filler that no
  // route path would ever contain, so coverage alone buries it — yet
  // /appointments/:id/no-show names the thing exactly. A reachable surface that
  // matches the capability's rarest term is decisive on its own.
  if (decisive && kindSet.size >= 1) return coverage >= 0.35 ? 'high' : 'medium';
  if (coverage >= 0.6 && kindSet.size >= 2) return 'high';
  if (coverage >= 0.6 || (coverage >= 0.35 && kindSet.size >= 2)) return 'medium';
  if (coverage >= 0.15) return 'low';
  return 'none';
}

function candidatesFor(row, surface, weightOf) {
  const words = tokenise(featureOf(row));
  // Absent words stay in the denominator: a capability whose distinctive term
  // appears nowhere is exactly the gap we want to see.
  const totalWeight = words.reduce((sum, word) => sum + weightOf(word), 0);
  const hits = new Map();
  const matched = new Set();
  for (const word of words) {
    for (const entry of surface.index.get(word) || []) {
      const key = `${entry.kind}:${entry.value}`;
      if (!hits.has(key)) hits.set(key, { ...entry, words: new Set() });
      hits.get(key).words.add(word);
      matched.add(word);
    }
  }
  const scored = [...hits.values()].map((hit) => {
    const matchedWords = [...hit.words].sort();
    const weight = matchedWords.reduce((sum, word) => sum + weightOf(word), 0);
    return { kind: hit.kind, value: hit.value, matchedWords, coverage: totalWeight ? weight / totalWeight : 0 };
  }).sort((left, right) => right.coverage - left.coverage || left.value.localeCompare(right.value));

  const ranked = scored.slice(0, 6);
  const best = ranked[0]?.coverage || 0;
  // The capability's rarest present term. A route or screen carrying that exact
  // term is the strongest evidence a name-based search can produce.
  const rarest = words.filter((word) => surface.index.has(word))
    .sort((left, right) => weightOf(right) - weightOf(left))[0];
  const decisive = Boolean(rarest) && scored.some((hit) =>
    (hit.kind === 'route' || hit.kind === 'page') && hit.matchedWords.includes(rarest));
  // Only candidates close to the best one count towards cross-surface
  // agreement, so a strong route match is not diluted by weak noise below it.
  const kinds = new Set(scored.filter((hit) => hit.coverage >= best * 0.8).map((hit) => hit.kind));
  return {
    id: row.id,
    feature: featureOf(row),
    officialUrl: row.officialUrl,
    searchWords: words,
    matchedWords: [...matched].sort(),
    coverage: Number(best.toFixed(3)),
    decisiveTerm: decisive ? rarest : null,
    confidence: ranked.length ? confidenceOf(best, kinds, decisive) : 'none',
    candidates: ranked.map((hit) => ({ ...hit, coverage: Number(hit.coverage.toFixed(3)) })),
  };
}

const register = JSON.parse(read(registerPath));
const surface = auraSurface();
const weightOf = inverseFrequency(surface);
const unmapped = register.rows.filter((row) => row.status === 'Unmapped');
const triaged = unmapped.map((row) => candidatesFor(row, surface, weightOf));

const byConfidence = { high: [], medium: [], 'schema-only': [], low: [], none: [] };
for (const row of triaged) byConfidence[row.confidence].push(row);

const summary = {
  generatedAt: new Date().toISOString(),
  registerRows: register.rows.length,
  unmappedRows: unmapped.length,
  auraSurface: surface.counts,
  confidence: Object.fromEntries(Object.entries(byConfidence).map(([key, rows]) => [key, rows.length])),
  note: 'Candidates are search results, not evidence. A row only becomes Complete when a reviewer records the real UI, API route and test that satisfy it.',
};

if (!process.argv.includes('--summary')) {
  writeFileSync(jsonOut, `${JSON.stringify({ ...summary, rows: triaged }, null, 2)}\n`);

  const section = (title, rows, limit) => [
    `## ${title} (${rows.length})`,
    '',
    ...(rows.length ? [
      `| ${vendorName} capability | Matched | Strongest AuraShine candidates |`,
      '|---|---|---|',
      ...rows.slice(0, limit).map((row) => {
        const candidates = row.candidates.slice(0, 3).map((hit) => `\`${hit.kind}: ${hit.value}\``).join('<br>') || '—';
        return `| [${row.id}](${row.officialUrl}) ${row.feature.replace(/\|/g, '\\|').slice(0, 70)} | ${row.matchedWords.slice(0, 4).join(', ')} | ${candidates} |`;
      }),
      ...(rows.length > limit ? ['', `_${rows.length - limit} more in the JSON report._`] : []),
    ] : ['_None._']),
    '',
  ].join('\n');

  writeFileSync(mdOut, [
    `# ${vendorName} parity triage`,
    '',
    `Generated ${summary.generatedAt} from \`docs/evidence/${vendor}-master-parity-register.json\`.`,
    '',
    '**This file decides nothing.** Every row below is still `Unmapped`. The register',
    'marks a capability Complete only when a person records the real UI, API route and',
    'test behind it, and that rule does not change here. What this adds is a starting',
    `point: the register said ${unmapped.length} rows were equally unknown, and they are not.`,
    '',
    `AuraShine surface searched: ${surface.counts.routes} mounted route literals, ${surface.counts.modules} backend modules, ${surface.counts.pages} frontend pages/components, ${surface.counts.tables} database tables, ${surface.counts.tests} focused frontend tests.`,
    '',
    '| Band | Rows | What it means |',
    '|---|---:|---|',
    `| High | ${byConfidence.high.length} | A route or screen carries the capability's most distinctive term. Very likely already built — verify and map. |`,
    `| Medium | ${byConfidence.medium.length} | Partial agreement across surfaces. Probably adjacent to something that exists. |`,
    `| Schema-only | ${byConfidence['schema-only'].length} | Tables match but no route, module or screen does. Review for an incomplete flow or obsolete schema. |`,
    `| Low | ${byConfidence.low.length} | One weak signal. Treat as unknown. |`,
    `| None | ${byConfidence.none.length} | Nothing in the codebase resembles it. Most likely a genuine gap. |`,
    '',
    '### How to read this',
    '',
    'Work **High** first: it is the cheapest way to replace a misleading parity',
    'number with a real one. **Schema-only** is the most actionable band — each row',
    'is either a feature to finish or a migration to delete, and leaving it half-done',
    'is what made the register look complete when it was not. **None** is the honest',
    `roadmap input, but read it with judgement: it also contains ${vendorName}-branded`,
    'things (their assistant, their payments status page) that are not gaps to close,',
    'and specific hardware models that belong in a support matrix rather than a',
    'feature backlog.',
    '',
    'Matching is by name only, so it misses features that exist under different',
    'wording. A shipped workflow can still land in Low when its route, table and',
    'screen use another domain term. Absence of a match is a',
    'prompt to look, not a verdict.',
    '',
    section('High confidence — verify and map', byConfidence.high, 60),
    section('Schema-only — finish it or drop the tables', byConfidence['schema-only'], 60),
    section('No match — likely genuine gaps', byConfidence.none, 60),
  ].join('\n'));
}

console.log(JSON.stringify(summary, null, 2));
