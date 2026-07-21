import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/pages/data-migration/csv-import.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { parseCsv } = await import(`data:text/javascript,${encodeURIComponent(js)}`);

test('CSV import preserves quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('firstName,notes\r\nAftab,"Hair, Skin"\r\nSara,"She said ""yes"""'), [
    ['firstName', 'notes'],
    ['Aftab', 'Hair, Skin'],
    ['Sara', 'She said "yes"'],
  ]);
});

test('Data Migration workspace keeps the seven-stage workflow on the shared store', () => {
  const store = readFileSync('src/app/pages/data-migration/data-migration.store.ts', 'utf8');
  const page = readFileSync('src/app/pages/data-migration/integrations-data-page.component.ts', 'utf8');
  const template = readFileSync('src/app/pages/data-migration/integrations-data-page.component.html', 'utf8');

  assert.match(store, /providedIn:\s*'root'/);
  assert.match(store, /\/settings\/integrations\/import-jobs/);
  assert.match(store, /\/settings\/integrations\/import-source-files/);
  assert.match(store, /\/settings\/integrations\/import-mappings/);
  assert.match(store, /\/settings\/integrations\/import-templates/);
  assert.match(page, /inject\(DataMigrationStore\)/);
  assert.match(page, /migration\.reload\(\)/);
  assert.match(page, /migration\.loadGovernance\(job\.id\)/);
  assert.match(page, /import-mapping-suggestions/);
  assert.match(page, /sourceFileId:\s*this\.selectedSourceFileId/);
  assert.match(page, /mapping:\s*this\.selectedMappingId \? \{\} : this\.suggestedMapping/);
  assert.match(page, /mode:\s*'dry-run'/);
  assert.match(page, /migration\.loadFailureAssistant\(job\.id\)/);
  assert.match(store, /import-monitoring/);

  for (const stage of ['Source / upload', 'Mapping', 'Validation', 'Worker progress', 'Approval', 'Reconciliation', 'History / rollback']) {
    assert.match(template, new RegExp(stage.replace('/', '\\/'), 'i'));
  }
  assert.match(template, /preRollbackImpact/);
  assert.match(template, /recoveryRecommendations/);
});
