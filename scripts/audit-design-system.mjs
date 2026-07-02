import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const root = process.cwd();
const srcAppDir = join(root, 'src', 'app');
const sharedUiDir = join(srcAppDir, 'shared', 'ui');
const stylesPath = join(root, 'src', 'styles.css');
const barrelPath = join(sharedUiDir, 'index.ts');
const cardThemePath = join(sharedUiDir, 'aura-card', 'aura-card.theme.ts');
const catalogPath = join(root, 'docs', 'aura-component-catalog.md');
const tokenDecisionPath = join(root, 'docs', 'aura-token-source-decision.md');
const cardInventoryPath = join(root, 'docs', 'aura-card-migration-inventory.md');
const cssSplitPlanPath = join(root, 'docs', 'aura-css-split-plan.md');
const accessibilityChecklistPath = join(root, 'docs', 'aura-accessibility-qa-checklist.md');
const performanceBudgetPath = join(root, 'docs', 'aura-performance-budget-plan.md');
const angularConfigPath = join(root, 'angular.json');
const scssTokenPath = join(root, 'src', 'app', 'core', 'styles', '_tokens.scss');

const canonicalSelectors = [
  'aura-badge',
  'aura-button',
  'aura-card',
  'aura-drawer',
  'aura-empty',
  'aura-kpi-card',
  'aura-page-header',
  'aura-skeleton',
  'aura-stat-strip',
  'aura-table',
  'aura-tabs'
];

const legacySelectors = [
  'aura-legacy-badge',
  'aura-legacy-button',
  'aura-legacy-drawer',
  'aura-legacy-empty',
  'aura-legacy-page-header',
  'aura-legacy-skeleton',
  'aura-legacy-stat-strip',
  'aura-legacy-table',
  'aura-legacy-tabs'
];

const legacyFolders = [
  'badge',
  'button',
  'drawer',
  'empty',
  'page-header',
  'skeleton',
  'stat-strip',
  'table',
  'tabs'
];

const requiredStyles = [
  '--radius-xs: 4px',
  '--aura-radius-sm: var(--radius-xs)',
  '--aura-radius-md: var(--radius-sm)',
  '--aura-radius-lg: var(--radius-md)',
  '--aura-primary: var(--color-primary)',
  '--aura-card: var(--color-surface)',
  '--metric-card-radius',
  '--card-border-radius',
  'aura-card--type-metric',
  'aura-card--tone-teal',
  'aura-card--tone-violet',
  'aura-card--tone-slate',
  ':root[data-theme="high-contrast"]'
];

const requiredBarrelExports = [
  './aura-badge/aura-badge.component',
  './aura-button/aura-button.component',
  './aura-card/aura-card.component',
  './aura-card/aura-card.theme',
  './aura-drawer/aura-drawer.component',
  './aura-empty/aura-empty.component',
  './aura-kpi-card/aura-kpi-card.component',
  './aura-page-header/aura-page-header.component',
  './aura-skeleton/aura-skeleton.component',
  './aura-stat-strip/aura-stat-strip.component',
  './aura-table/aura-table.component',
  './aura-tabs/aura-tabs.component'
];

function walk(dir, extensions = ['.ts']) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path, extensions);
    return extensions.includes(extname(path)) ? [path] : [];
  });
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function readIfExists(path) {
  return existsSync(path) ? read(path) : '';
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel && !rel.startsWith('..') && !rel.startsWith(sep);
}

const failures = [];
const notes = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function countInMap(map, key) {
  return map.get(key)?.length ?? 0;
}

const selectorPattern = /selector:\s*['"]([^'"]+)['"]/g;
const selectors = new Map();

for (const file of walk(sharedUiDir)) {
  const source = read(file);
  for (const match of source.matchAll(selectorPattern)) {
    const selector = match[1];
    if (!selector.startsWith('aura-')) continue;
    const list = selectors.get(selector) ?? [];
    list.push(relative(root, file));
    selectors.set(selector, list);
  }
}

for (const [selector, files] of selectors) {
  expect(files.length === 1, `Duplicate selector '${selector}' found in ${files.join(', ')}`);
}

for (const selector of canonicalSelectors) {
  expect(countInMap(selectors, selector) === 1, `Missing canonical selector '${selector}'`);
}

for (const selector of legacySelectors) {
  expect(countInMap(selectors, selector) === 1, `Missing legacy selector '${selector}'`);
}

const appFiles = walk(srcAppDir, ['.ts', '.html']);
const legacySelectorPattern = /<\/?aura-legacy-[a-z-]+\b/g;
const legacyImportPattern = new RegExp(`from\\s+['"][^'"]*shared/ui/(${legacyFolders.join('|')})/`, 'g');
const legacyLeaks = [];

for (const file of appFiles) {
  if (isInside(sharedUiDir, file)) continue;
  const source = read(file);
  if (legacySelectorPattern.test(source) || legacyImportPattern.test(source)) {
    legacyLeaks.push(relative(root, file));
  }
}

expect(legacyLeaks.length === 0, `Legacy Aura usage leaked outside shared UI: ${legacyLeaks.join(', ')}`);

const styles = read(stylesPath);
for (const token of requiredStyles) {
  expect(styles.includes(token), `Missing styles contract '${token}' in src/styles.css`);
}

const barrel = read(barrelPath);
for (const exportPath of requiredBarrelExports) {
  expect(barrel.includes(exportPath), `Missing shared UI barrel export '${exportPath}'`);
}

expect(existsSync(cardThemePath), 'Missing aura-card.theme.ts');
expect(read(cardThemePath).includes('auraCardTokens'), 'aura-card.theme.ts must export auraCardTokens');
expect(existsSync(catalogPath), 'Missing docs/aura-component-catalog.md');
expect(read(catalogPath).includes('## Legacy Shims'), 'Component catalog must document legacy shims');
expect(existsSync(cardInventoryPath), 'Missing docs/aura-card-migration-inventory.md');
expect(read(cardInventoryPath).includes('## Current Footprint'), 'Card migration inventory must document current footprint');
expect(existsSync(cssSplitPlanPath), 'Missing docs/aura-css-split-plan.md');
expect(read(cssSplitPlanPath).includes('## Target Layers'), 'CSS split plan must document target layers');
expect(existsSync(accessibilityChecklistPath), 'Missing docs/aura-accessibility-qa-checklist.md');
expect(read(accessibilityChecklistPath).includes('## Theme Checks'), 'Accessibility QA checklist must document theme checks');
expect(existsSync(performanceBudgetPath), 'Missing docs/aura-performance-budget-plan.md');
expect(read(performanceBudgetPath).includes('## Design-System Targets'), 'Performance budget plan must document design-system targets');
expect(existsSync(tokenDecisionPath), 'Missing docs/aura-token-source-decision.md');
const tokenDecision = read(tokenDecisionPath);
expect(tokenDecision.includes('src/styles.css') && tokenDecision.includes('runtime source of truth'), 'Token source decision must identify src/styles.css as runtime source of truth');
expect(read(angularConfigPath).includes('"styles": ["src/styles.css"]'), 'angular.json must keep src/styles.css as the style entrypoint');
expect(existsSync(scssTokenPath), 'Missing legacy SCSS token reference file');

const styleFiles = walk(join(root, 'src'), ['.css', '.scss']);
const scssTokenImportPattern = /@(?:use|import)\s+['"][^'"]*(?:_tokens|tokens)/;
const scssTokenConsumers = styleFiles.filter((file) => file !== scssTokenPath && scssTokenImportPattern.test(readIfExists(file)));
expect(scssTokenConsumers.length === 0, `SCSS token file is imported by runtime style files: ${scssTokenConsumers.map((file) => relative(root, file)).join(', ')}`);

notes.push(`Checked ${selectors.size} Aura selectors across shared UI.`);
notes.push(`Canonical selectors: ${canonicalSelectors.length}; legacy selectors: ${legacySelectors.length}.`);
notes.push(`Checked ${appFiles.length} app template/script files for legacy Aura leaks outside shared UI.`);
notes.push('Checked token bridge, SCSS token source decision, card utility aliases, barrel exports, catalog docs, card migration inventory, CSS split plan, accessibility QA checklist, and performance budget plan.');

if (failures.length) {
  console.error('Aura design-system audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Aura design-system audit passed.');
for (const note of notes) console.log(`- ${note}`);