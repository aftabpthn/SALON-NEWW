import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../backend-rust/migrations/0388_staff_ai_scribe.sql');
const service = read('../../backend-rust/src/services/staff_ai_scribe_service.rs');
const route = read('../../backend-rust/src/routes/staff_scribe.rs');
const routes = read('../../backend-rust/src/routes/mod.rs');
const tenant = read('../../backend-rust/src/middleware/tenant.rs');
const auth = read('../../backend-rust/src/services/auth_service.rs');
const main = read('../../backend-rust/src/main.rs');
const python = read('../../ai-service/staff_ai.py');

test('the schema that existed alone is now reachable', () => {
  // 0388 shipped these tables and nothing touched them. The point of this test
  // is that the orphan-schema state cannot return unnoticed.
  assert.match(service, /staff_ai_scribe_sessions/);
  assert.match(service, /staff_ai_scribe_events/);
  assert.match(routes, /pub mod staff_scribe;/);
  assert.match(routes, /\.merge\(staff_scribe::router\(\)\)/);
  for (const path of [
    '/staff-scribe/sessions',
    '/staff-scribe/sessions/:id/transcribe',
    '/staff-scribe/sessions/:id/approve',
    '/staff-scribe/sessions/:id/revoke',
  ]) {
    assert.match(route, new RegExp(path.replace(/[/:]/g, '\\$&')), `missing route ${path}`);
  }
});

test('every scribe permission is in the authoritative catalog', () => {
  // A route mapped to a permission the catalog does not define makes
  // require_route_role fail the whole request with a 500, which is exactly the
  // bug that took /staff/rules down.
  for (const permission of ['staff.app.scribe.read', 'staff.app.scribe.manage']) {
    assert.match(auth, new RegExp(`code: "${permission.replace(/\./g, '\\.')}"`), `${permission} missing from catalog`);
    assert.match(tenant, new RegExp(permission.replace(/\./g, '\\.')), `${permission} missing from route matrix`);
  }
  assert.match(tenant, /path_starts_with\(path, "\/staff-scribe"\)/);
});

test('audio is never retained', () => {
  // The database refuses a row claiming otherwise; the service must not try.
  assert.match(migration, /CHECK \(audio_retained=FALSE AND audio_retention_until IS NULL\)/);
  assert.doesNotMatch(service, /audio_retained\s*=\s*(TRUE|true)/);
  assert.doesNotMatch(service, /INSERT INTO[\s\S]{0,400}?audio_retention_until/);
  // Nothing writes the bytes anywhere: they go to the provider and are dropped.
  assert.doesNotMatch(service, /std::fs::|tokio::fs::|File::create/);
});

test('a recording cannot happen without granted consent', () => {
  assert.match(service, /consent_status != "granted"[\s\S]{0,200}?forbidden/);
  // A refusal is stored rather than dropped, so "we asked" is evidence.
  assert.match(service, /"refused" => "refused"/);
  assert.match(service, /consent_evidence_sha256/);
});

test('revoking consent destroys the transcript, not just a flag', () => {
  assert.match(service, /status = 'revoked'[\s\S]{0,300}?transcript = ''/);
  assert.match(service, /structured_summary = '\{\}'::JSONB/);
  assert.match(service, /form_suggestions = '\[\]'::JSONB/);
});

test('a suggestion cannot reach a client record without review', () => {
  // approve() writes input.responses — what the staff member submitted — and
  // never form_suggestions.
  assert.match(service, /INSERT INTO client_form_submissions[\s\S]{0,900}?RETURNING id/);
  const approveBody = service.slice(service.indexOf('pub async fn approve'), service.indexOf('pub async fn revoke'));
  assert.match(approveBody, /\.bind\(&input\.responses\)/);
  assert.doesNotMatch(approveBody, /\.bind\(&?current\.form_suggestions\)/);
  // Optimistic concurrency: reviewing a draft that changed underneath must fail.
  assert.match(approveBody, /version = \$6/);
  assert.match(approveBody, /conflict/);
});

test('transcripts expire and the worker runs the purge', () => {
  assert.match(migration, /transcript_retention_until TIMESTAMPTZ NOT NULL DEFAULT \(NOW\(\) \+ INTERVAL '90 days'\)/);
  assert.match(service, /pub async fn purge_expired_transcripts/);
  assert.match(main, /staff_ai_scribe_service::purge_expired_transcripts/);
});

test('no provider means no transcript rather than an invented one', () => {
  // A fabricated clinical note is worse than no note.
  assert.match(python, /SCRIBE_PROVIDER_NOT_CONFIGURED/);
  assert.match(python, /HTTP_503_SERVICE_UNAVAILABLE/);
  assert.match(service, /AI_SERVICE_NOT_CONFIGURED/);
  assert.match(service, /SCRIBE_EMPTY_TRANSCRIPT/);
  // Suggestions quote the sentence they came from rather than paraphrasing.
  assert.match(python, /"evidence": sentence/);
});
