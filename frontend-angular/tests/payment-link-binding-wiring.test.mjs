import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const service = read('../../backend-rust/src/services/payment_link_access_service.rs');
const route = read('../../backend-rust/src/routes/payment_platform.rs');
const pos = read('../../backend-rust/src/routes/pos.rs');
const dispute = read('../../backend-rust/src/services/payment_dispute_service.rs');
const policy = read('../../backend-rust/src/services/security_service.rs');
const migration = read('../../backend-rust/migrations/0417_payment_link_access_control.sql');

test('the guest is handed our token, not the provider URL', () => {
  // A provider checkout URL is a bearer credential: forwarded once, anyone who
  // has it can see and pay the invoice. Routing the open through us is what
  // makes a challenge and telemetry possible at all.
  assert.match(pos, /supersede_other_links\(/);
  assert.match(pos, /issue_access_token\(/);
  assert.match(pos, /response\.guest_link_token = access_token;/);
  assert.match(route, /"\/public\/pay\/:token"/);
  assert.match(route, /"\/public\/pay\/:token\/verify"/);
});

test('only the hash of a token is stored', () => {
  // A database dump must not hand over live payment links.
  assert.match(service, /access_token_hash = \$4/);
  assert.match(service, /auth_service::token_hash\(&token\)/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_payment_links_access_token/);
  // The plaintext token is returned once, from the mint, and never re-read.
  assert.doesNotMatch(service, /SELECT[\s\S]{0,200}?access_token(?!_hash)/);
});

test('the attempt cap is what makes a four digit challenge meaningful', () => {
  // 10^4 combinations fall to a script in seconds; the cap is the control.
  assert.match(service, /const MAX_FAILED_VERIFICATIONS: i32 = 5;/);
  const verifyBody = service.slice(
    service.indexOf('pub async fn verify('),
    service.indexOf('pub async fn events('),
  );
  assert.match(verifyBody, /failed_verifications >= MAX_FAILED_VERIFICATIONS/);
  assert.match(verifyBody, /failed_verifications = failed_verifications \+ 1/);
  // A spent link must stop answering on open too, not only on verify.
  const openBody = service.slice(
    service.indexOf('pub async fn open('),
    service.indexOf('pub async fn verify('),
  );
  assert.match(openBody, /failed_verifications >= MAX_FAILED_VERIFICATIONS/);
});

test('a missing phone forwards through instead of locking the guest out', () => {
  // Verification protects the link; it must never become the reason an invoice
  // cannot be paid when there is nothing to check against.
  assert.match(service, /!link\.require_verification \|\| link\.phone_last_four\.len\(\) < 4/);
});

test('a wrong token and a missing one are answered the same way', () => {
  // Otherwise the endpoint becomes an oracle for which tokens exist.
  assert.match(service, /ok_or_else\(\|\| AppError::not_found\("this payment link is not valid"\)\)/);
});

test('one invoice has one working link', () => {
  // An older URL in a chat thread must not keep taking payments after the
  // amount has been revised.
  assert.match(service, /SET status = 'cancelled', superseded_by = \$5/);
  assert.match(service, /AND id <> \$4 AND status = 'pending'/);
  // And the superseded link has to say why rather than fail silently.
  assert.match(service, /newer payment link replaced this one/);
});

test('every interaction is recorded, and recording never blocks a payment', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS pos_payment_link_events/);
  for (const event of ['opened', 'verification_failed', 'verified', 'redirected', 'blocked']) {
    assert.match(service, new RegExp(`"${event}"`), `${event} should be recorded`);
  }
  // Swallowed on purpose: telemetry is not worth failing a guest's payment.
  assert.match(service, /Telemetry must never be the reason a guest cannot pay/);
  assert.match(service, /let _ = sqlx::query\([\s\S]{0,120}?INSERT INTO pos_payment_link_events/);
});

test('the source address comes from the middleware header, not the client', () => {
  // x-aurashine-source-ip is stripped from inbound requests and re-set by
  // security_headers; trusting a client-sent header would make the telemetry
  // worthless as dispute evidence.
  assert.match(route, /"x-aurashine-source-ip"/);
});

test('link activity reaches the dispute evidence pack', () => {
  // This is the point of the telemetry: a hosted checkout cannot otherwise
  // show that the guest themselves authorised the charge.
  assert.match(dispute, /"paymentLinkActivity": link_activity/);
  assert.match(dispute, /FROM pos_payment_link_events event/);
});

test('phone verification is a tenant policy, defaulting to on', () => {
  assert.match(policy, /pub payment_link_phone_verification: bool,/);
  assert.match(policy, /payment_link_phone_verification: true,/);
  assert.match(pos, /\.payment_link_phone_verification;/);
});
