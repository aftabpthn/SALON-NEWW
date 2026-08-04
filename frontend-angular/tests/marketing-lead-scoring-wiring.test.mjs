import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const page = read('../src/app/pages/marketing/marketing-leads-page.component.ts');
const template = read('../src/app/pages/marketing/marketing-leads-page.component.html');
const route = read('../../backend-rust/src/routes/marketing_leads.rs');
const service = read('../../backend-rust/src/services/marketing_lead_scoring_service.rs');
const migration = read('../../backend-rust/migrations/0414_marketing_lead_scoring.sql');
const main = read('../../backend-rust/src/main.rs');

test('lead scoring is reachable end to end', () => {
  for (const path of ['/marketing/leads/:id/score', '/marketing/leads/:id/score/mode', '/marketing/leads/score/refresh']) {
    assert.match(route, new RegExp(path.replace(/[/:]/g, '\\$&')), `missing route ${path}`);
  }
  // Reads and writes are gated separately: seeing a score is a read, changing
  // how it is produced is a write.
  assert.match(route, /async fn lead_score\([\s\S]{0,400}?require_permission\(&claims, false\)/);
  assert.match(route, /async fn set_lead_score_mode\([\s\S]{0,500}?require_permission\(&claims, true\)/);
  assert.match(route, /async fn refresh_lead_scores\([\s\S]{0,400}?require_permission\(&claims, true\)/);

  assert.match(page, /\/marketing\/leads\/\$\{lead\.id\}\/score/);
  assert.match(page, /\/marketing\/leads\/\$\{lead\.id\}\/score\/mode/);
  assert.match(template, /drawer === 'lead-score'/);
});

test('a manual score is never overwritten by the worker', () => {
  // The whole point of score_source: a number a manager set deliberately must
  // survive every scoring pass.
  assert.match(migration, /score_source TEXT NOT NULL DEFAULT 'manual'/);
  assert.match(migration, /CHECK \(score_source IN \('manual', 'auto'\)\)/);
  assert.match(service, /score_source = 'auto'"#/);
  // Both the read that picks leads up and the write that stores a score filter
  // on it, so neither half can drift into touching manual rows.
  const autoFilters = service.match(/score_source = 'auto'/g) || [];
  assert.ok(autoFilters.length >= 3, `expected the auto filter on select and update, found ${autoFilters.length}`);
});

test('every score keeps the factors that produced it', () => {
  assert.match(migration, /score_factors_json JSONB NOT NULL DEFAULT '\[\]'::JSONB/);
  assert.match(migration, /score_model_version TEXT NOT NULL/);
  assert.match(service, /pub const MODEL_VERSION/);
  assert.match(service, /score_factors_json = \$5/);
  // A score with no explanation is the thing this replaces, so the UI has to
  // render the breakdown rather than just the number.
  assert.match(template, /factor\.label/);
  assert.match(template, /factor\.detail/);
  assert.match(template, /factor\.points/);
});

test('source quality is learned from the branch rather than hard-coded', () => {
  assert.match(service, /FROM marketing_leads[\s\S]{0,200}?GROUP BY source/);
  assert.match(service, /branch_conversion_rate/);
  assert.match(service, /SOURCE_CONFIDENCE_SAMPLE/);
  assert.doesNotMatch(service, /"referral" => 30|"walk_in" => 20/, 'weights must not be hard-coded per source');
  assert.match(template, /branchConversionRate/);
});

test('scoring runs on a worker and stays inside the column constraint', () => {
  assert.match(main, /"marketing_lead_scoring"/);
  assert.match(main, /marketing_lead_scoring_service::process_due/);
  // marketing_leads.score is CHECK (score BETWEEN 0 AND 100).
  assert.match(service, /clamp\(0, 100\)/);
  assert.match(service, /score_computed_at < NOW\(\) - INTERVAL '1 hour'/);
});
