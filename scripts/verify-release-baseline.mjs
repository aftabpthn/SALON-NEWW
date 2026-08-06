import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const baselineVersion = '2026.08.06-parity-refresh.1';
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const normalizePath = (path) => path.replace(/\{[^}]+\}|:[A-Za-z_][A-Za-z0-9_]*/g, ':id').replace(/\/$/, '') || '/';
const hash = (algorithm, value) => createHash(algorithm).update(value).digest('hex');

function mountedRoutePaths() {
  const routeRoot = resolve(root, 'backend-rust/src/routes');
  const mod = read('backend-rust/src/routes/mod.rs');
  const modules = new Set([...mod.matchAll(/\.merge\(\s*([A-Za-z0-9_]+)::[A-Za-z0-9_]*router\s*\(/g)].map((match) => match[1]));
  const paths = new Set(['/health', '/api', '/api/v1']);
  const files = ['mod.rs', ...[...modules].map((module) => `${module}.rs`)].filter((file) => existsSync(resolve(routeRoot, file)));
  for (const file of files) {
    const source = readFileSync(resolve(routeRoot, file), 'utf8');
    for (const match of source.matchAll(/\.route\(\s*"([^"]+)"/g)) {
      const path = normalizePath(match[1]);
      paths.add(path);
      paths.add(`/api${path}`);
      paths.add(`/api/v1${path}`);
    }
  }
  return { modules: [...modules].sort(), paths };
}

function documentedRoutes(mounted) {
  const source = read('docs/README.md');
  const claims = new Map();
  for (const match of source.matchAll(/(?<![A-Za-z0-9])\/(?:api(?:\/v1)?(?:\/[A-Za-z0-9_:{}/.-]+)?|health)(?![A-Za-z0-9])/g)) {
    const endpoint = normalizePath(match[0]);
    if (claims.has(endpoint)) continue;
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    let classification = 'future';
    if (mounted.paths.has(endpoint)) classification = 'mounted';
    else if (/\/quality\/seed-demo$/.test(endpoint)) classification = 'retired';
    else if (/webhook|provider|marketplace|white-label\/domains/.test(endpoint)) classification = 'external';
    claims.set(endpoint, { endpoint, classification, readmeLine: line });
  }
  return [...claims.values()].sort((left, right) => left.endpoint.localeCompare(right.endpoint));
}

function localDocLinks() {
  const source = read('docs/README.md');
  const missing = [];
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(?:https?:\/\/|#|mailto:)/.test(target)) continue;
    const clean = target.split('#')[0];
    if (clean === './ROUTE_CATALOG.md') continue;
    if (!existsSync(resolve(root, 'docs', clean))) missing.push({ target, line: source.slice(0, match.index).split(/\r?\n/).length });
  }
  return missing;
}

function migrations() {
  const directory = resolve(root, 'backend-rust/migrations');
  const rows = readdirSync(directory).flatMap((file) => {
    const match = file.match(/^(\d+)_.*\.sql$/);
    if (!match) return [];
    const bytes = readFileSync(resolve(directory, file));
    return [{ version: Number(match[1]), file, checksum: hash('sha384', bytes) }];
  }).sort((left, right) => left.version - right.version);
  const versions = new Set();
  const duplicates = [];
  for (const row of rows) versions.has(row.version) ? duplicates.push(row.version) : versions.add(row.version);
  const gaps = [];
  for (let version = rows[0]?.version || 0; version <= (rows.at(-1)?.version || 0); version++) if (!versions.has(version)) gaps.push(version);
  return { rows, duplicates, gaps };
}

function databaseMigrations(sourceRows) {
  const sql = "SELECT version,description,success,encode(checksum,'hex') FROM _sqlx_migrations ORDER BY version";
  const output = execFileSync('docker', ['exec', 'aurashine-postgres', 'psql', '-U', 'postgres', '-d', 'aura_shine', '-At', '-F', '|', '-c', sql], { encoding: 'utf8' });
  const applied = output.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [version, description, success, checksum] = line.split('|');
    return { version: Number(version), description, success: success === 't', checksum };
  });
  const source = new Map(sourceRows.map((row) => [row.version, row]));
  const missingSource = applied.filter((row) => !source.has(row.version)).map((row) => row.version);
  const failed = applied.filter((row) => !row.success).map((row) => row.version);
  const checksumMismatch = applied.filter((row) => source.has(row.version) && source.get(row.version).checksum !== row.checksum).map((row) => row.version);
  const appliedVersions = new Set(applied.map((row) => row.version));
  const unapplied = sourceRows.filter((row) => !appliedVersions.has(row.version)).map((row) => row.version);
  return { appliedCount: applied.length, latestApplied: applied.at(-1)?.version || 0, missingSource, failed, checksumMismatch, unapplied };
}

function newestMtime(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return readdirSync(path, { withFileTypes: true }).reduce((latest, entry) => Math.max(latest, newestMtime(resolve(path, entry.name))), stat.mtimeMs);
}

function executableFreshness() {
  const executable = resolve(root, 'backend-rust/target/debug/aura-shine-backend.exe');
  if (!existsSync(executable)) return { fresh: false, executable, reason: 'missing executable' };
  const inputMtime = Math.max(
    newestMtime(resolve(root, 'backend-rust/src')),
    newestMtime(resolve(root, 'backend-rust/migrations')),
    statSync(resolve(root, 'backend-rust/Cargo.toml')).mtimeMs,
    statSync(resolve(root, 'backend-rust/Cargo.lock')).mtimeMs
  );
  const executableMtime = statSync(executable).mtimeMs;
  return { fresh: executableMtime >= inputMtime, executable, inputMtime: new Date(inputMtime).toISOString(), executableMtime: new Date(executableMtime).toISOString() };
}

async function health(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return { url, status: response.status, ok: response.ok, body: (await response.text()).slice(0, 500) };
  } catch (error) {
    return { url, status: 0, ok: false, error: String(error) };
  }
}

function routeMarkdown(routes, mountedCount) {
  const counts = Object.fromEntries(['mounted', 'future', 'external', 'retired'].map((value) => [value, routes.filter((route) => route.classification === value).length]));
  return `# AuraShine Route Catalog\n\nBaseline: **${baselineVersion}**  \nRust mounted route literals: **${mountedCount}**  \nREADME claims: **${routes.length}** — mounted ${counts.mounted}, future ${counts.future}, external ${counts.external}, retired ${counts.retired}.\n\nOnly \`mounted\` rows are current HTTP contracts. \`future\` rows are documentation targets, \`external\` rows require provider activation, and \`retired\` rows must not be called.\n\n| README endpoint | Classification | README line |\n|---|---|---:|\n${routes.map((route) => `| \`${route.endpoint}\` | ${route.classification} | ${route.readmeLine} |`).join('\n')}\n`;
}

const mounted = mountedRoutePaths();
const routes = documentedRoutes(mounted);
const migrationSource = migrations();
const missingDocs = localDocLinks();
const readme = read('docs/README.md');
const sourceChecks = {
  baselineVersion,
  generatedAt: new Date().toISOString(),
  routeClaims: routes.length,
  routeClassifications: Object.fromEntries(['mounted', 'future', 'external', 'retired'].map((value) => [value, routes.filter((route) => route.classification === value).length])),
  knownRouteContradictions: routes.filter((route) => !['mounted', 'future', 'external', 'retired'].includes(route.classification)).length,
  missingDocumentReferences: missingDocs,
  canonicalPorts: {
    frontend4200: readme.includes('http://127.0.0.1:4200'),
    backend8082: readme.includes('http://127.0.0.1:8082/health'),
    proxy8082: read('frontend-angular/proxy.conf.json').includes('http://127.0.0.1:8082'),
    staleLocal8080: /127\.0\.0\.1:8080|localhost:8080/.test(readme)
  },
  migrations: { sourceCount: migrationSource.rows.length, first: migrationSource.rows[0]?.version, latest: migrationSource.rows.at(-1)?.version, duplicates: migrationSource.duplicates, gaps: migrationSource.gaps }
};

const errors = [];
if (sourceChecks.knownRouteContradictions) errors.push('Unclassified README routes remain.');
if (missingDocs.length) errors.push(`Missing README document references: ${missingDocs.map((row) => row.target).join(', ')}`);
if (!sourceChecks.canonicalPorts.frontend4200 || !sourceChecks.canonicalPorts.backend8082 || !sourceChecks.canonicalPorts.proxy8082 || sourceChecks.canonicalPorts.staleLocal8080) errors.push('Canonical 4200 -> 8082 runtime documentation is inconsistent.');
if (migrationSource.duplicates.length) errors.push(`Duplicate migration versions: ${migrationSource.duplicates.join(',')}`);

if (process.argv.includes('--runtime')) {
  sourceChecks.databaseMigrations = databaseMigrations(migrationSource.rows);
  sourceChecks.executable = executableFreshness();
  sourceChecks.health = await Promise.all([health('http://127.0.0.1:8082/health'), health('http://127.0.0.1:4200/api/v1/health')]);
  const db = sourceChecks.databaseMigrations;
  if (db.missingSource.length || db.failed.length || db.checksumMismatch.length || db.unapplied.length) errors.push(`Migration runtime mismatch: ${JSON.stringify(db)}`);
  if (!sourceChecks.executable.fresh) errors.push(`Backend executable is stale: ${JSON.stringify(sourceChecks.executable)}`);
  if (sourceChecks.health.some((check) => !check.ok)) errors.push(`Runtime health failed: ${JSON.stringify(sourceChecks.health)}`);
}

if (process.argv.includes('--write')) {
  writeFileSync(resolve(root, 'docs/ROUTE_CATALOG.md'), routeMarkdown(routes, mounted.paths.size).replace(/[ \t]+$/gm, ''));
  writeFileSync(resolve(root, 'docs/evidence/release-baseline-source.json'), `${JSON.stringify({ ...sourceChecks, errors }, null, 2)}\n`);
}

console.log(JSON.stringify({ ...sourceChecks, errors }, null, 2));
if (errors.length) process.exit(1);
