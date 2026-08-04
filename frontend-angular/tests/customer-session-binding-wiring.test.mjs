import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const service = read('../../backend-rust/src/services/customer_portal_service.rs');
const route = read('../../backend-rust/src/routes/customer_portal.rs');
const repo = read('../../backend-rust/src/repositories/customer_portal_repository.rs');

test('a refresh token is checked against the device that obtained it', () => {
  // A rotated refresh token is still a bearer token: whoever holds it is
  // treated as the guest, so it has to be tied to something.
  assert.match(service, /pub async fn refresh\([\s\S]{0,300}?user_agent: &str,[\s\S]{0,60}?ip_hash: &str,/);
  assert.match(service, /repo::session_binding/);
  assert.match(route, /service::refresh\([\s\S]{0,300}?header::USER_AGENT/);
});

test('a device mismatch revokes rather than merely refusing', () => {
  const refreshBody = service.slice(service.indexOf('pub async fn refresh('), service.indexOf('fn bundle('));
  assert.match(refreshBody, /user_agent_family\(&stored_agent\) != user_agent_family\(user_agent\)/);
  // Leaving the session live would give a thief a second attempt.
  assert.match(refreshBody, /revoke_session[\s\S]{0,200}?device mismatch on refresh/);
  assert.match(refreshBody, /refresh_device_mismatch/);
});

test('an address change is recorded and never blocks', () => {
  // Mobile networks rotate addresses constantly; blocking would sign guests
  // out on the train, and a control people disable protects nothing.
  const refreshBody = service.slice(service.indexOf('pub async fn refresh('), service.indexOf('fn bundle('));
  assert.match(refreshBody, /refresh_address_changed/);
  assert.match(refreshBody, /"success"/);
  assert.match(refreshBody, /touch_session_ip/);
  // The address branch itself must not revoke. Bounded to the branch body so
  // the assertion cannot pass or fail on unrelated code further down.
  const branchStart = refreshBody.indexOf('stored_ip != ip_hash');
  const addressBranch = refreshBody.slice(branchStart, refreshBody.indexOf('\n        }', branchStart));
  assert.ok(addressBranch.length > 0 && addressBranch.length < 800, 'branch body should be short');
  assert.doesNotMatch(addressBranch, /revoke/);
});

test('live sessions are capped by trimming the oldest, not refusing the newest', () => {
  // A guest on a new phone must always be able to sign in.
  assert.match(service, /const MAX_ACTIVE_SESSIONS: i64 = 5;/);
  // Matched across lines: rustfmt decides where the arguments wrap, and the
  // property under test is that the cap is applied, not how it is laid out.
  assert.match(service, /revoke_sessions_beyond\([\s\S]{0,120}?MAX_ACTIVE_SESSIONS/);
  assert.match(repo, /ORDER BY last_used_at DESC, created_at DESC\s*\n\s*OFFSET \$2/);
});

test('the guest can see their own account activity', () => {
  // customer_security_events shipped with the portal and nothing ever wrote to
  // or read from it — the same orphan-schema shape the audit found elsewhere.
  assert.match(repo, /pub async fn record_security_event/);
  assert.match(repo, /pub async fn security_events/);
  assert.match(route, /"\/customer\/security-events"/);
  assert.match(service, /"session_started"/);
});
