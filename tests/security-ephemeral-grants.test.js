import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { ensureSecurityEphemeralGrantsSchema } from "../server/migrations/create-security-ephemeral-grants.js";
import { SecurityEphemeralGrantStore } from "../server/stores/security-ephemeral-grant.store.js";
import { RealtimeService } from "../server/services/realtime.service.js";
import { WebauthnService } from "../server/services/webauthn.service.js";
import { authService } from "../server/services/auth.service.js";

function databases() {
  const directory = mkdtempSync(join(tmpdir(), "aura-grants-"));
  const path = join(directory, "grants.sqlite");
  const first = new Database(path);
  ensureSecurityEphemeralGrantsSchema(first);
  const second = new Database(path);
  return {
    first,
    second,
    close() {
      first.close();
      second.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

const binding = {
  subjectId: "subject-1",
  userId: "user-1",
  staffId: "staff-1",
  tenantId: "tenant-1",
  branchId: "branch-1",
  sessionId: "session-1"
};

function issue(store, proof, overrides = {}) {
  store.issue({ proof, ttlSeconds: 60, type: "test", purpose: "login", ...binding, ...overrides, payload: { ok: true } });
}

function consume(store, proof, overrides = {}) {
  return store.consume({ proof, type: "test", purpose: "login", ...binding, ...overrides });
}

test("SQLite grants consume across instances once and store only a proof hash", () => {
  const pair = databases();
  try {
    const first = new SecurityEphemeralGrantStore(pair.first);
    const second = new SecurityEphemeralGrantStore(pair.second);
    const proof = first.randomId();
    assert.equal(Buffer.from(proof, "base64url").length, 32);
    issue(first, proof);

    const row = pair.first.prepare("SELECT id, proofHash, payload FROM securityEphemeralGrants WHERE tenantId = @tenantId").get({ tenantId: binding.tenantId });
    assert.equal(Buffer.from(row.id, "base64url").length, 32);
    assert.notEqual(row.proofHash, proof);
    assert.equal(JSON.stringify(row).includes(proof), false);
    assert.equal(consume(second, proof).payload.ok, true);
    assert.equal(consume(first, proof), null);
  } finally {
    pair.close();
  }
});

test("SQLite grants reject expiry and every security binding mismatch", () => {
  const database = new Database(":memory:");
  ensureSecurityEphemeralGrantsSchema(database);
  let currentTime = Date.now();
  const store = new SecurityEphemeralGrantStore(database, { clock: () => currentTime });
  try {
    const mismatches = [
      ["tenantId", "tenant-2"],
      ["userId", "user-2"],
      ["purpose", "register"],
      ["subjectId", "subject-2"],
      ["staffId", "staff-2"],
      ["branchId", "branch-2"],
      ["sessionId", "session-2"],
      ["type", "other"]
    ];
    for (const [field, value] of mismatches) {
      const proof = store.randomId();
      issue(store, proof);
      assert.equal(consume(store, proof, { [field]: value }), null, field);
      assert.ok(consume(store, proof), `${field} mismatch must not burn the grant`);
    }

    const expired = store.randomId();
    issue(store, expired);
    currentTime += 61_000;
    assert.equal(consume(store, expired), null);
  } finally {
    database.close();
  }
});

test("atomic UPDATE RETURNING permits only one simultaneous consumer", async () => {
  const pair = databases();
  try {
    const first = new SecurityEphemeralGrantStore(pair.first);
    const second = new SecurityEphemeralGrantStore(pair.second);
    const proof = first.randomId();
    issue(first, proof);
    const results = await Promise.all([Promise.resolve().then(() => consume(first, proof)), Promise.resolve().then(() => consume(second, proof))]);
    assert.equal(results.filter(Boolean).length, 1);
  } finally {
    pair.close();
  }
});

test("realtime tickets survive service instances, reject replay, and fail closed", () => {
  const pair = databases();
  try {
    const issuer = new RealtimeService({ grantStore: new SecurityEphemeralGrantStore(pair.first) });
    const consumer = new RealtimeService({ grantStore: new SecurityEphemeralGrantStore(pair.second) });
    consumer.assertCurrentAuthorization = () => {};
    const access = { userId: "user-1", tenantId: "tenant-1", role: "owner", staffId: "staff-1", jti: "access-jti", permissions: ["*"] };
    const response = issuer.issueTicket(access);
    assert.equal(response.expiresIn, 30);
    assert.ok(Array.isArray(response.channels));
    assert.equal(consumer.consumeTicket(response.ticket).auth.sub, access.userId);
    assert.throws(() => issuer.consumeTicket(response.ticket), /expired or already used/);

    const failed = new RealtimeService({ grantStore: { randomId: () => "x".repeat(43), issue: () => { throw new Error("store unavailable"); } } });
    assert.throws(() => failed.issueTicket(access), /store unavailable/);
  } finally {
    pair.close();
  }
});

function registrationAccess(overrides = {}) {
  return { userId: "user-1", staffId: "staff-1", tenantId: "tenant-1", branchId: "branch-1", jti: "access-jti", loginId: "user@example.test", ...overrides };
}

function registrationBindings(access) {
  return { subjectId: access.userId, userId: access.userId, staffId: access.staffId, tenantId: access.tenantId, branchId: access.branchId, sessionId: access.jti };
}

test("WebAuthn registration begins persistently and its finish helper enforces all bindings", () => {
  const pair = databases();
  try {
    const issuer = new WebauthnService({ grantStore: new SecurityEphemeralGrantStore(pair.first) });
    const consumer = new WebauthnService({ grantStore: new SecurityEphemeralGrantStore(pair.second) });
    const access = registrationAccess();
    const begun = issuer.beginRegistration(access);
    assert.equal(begun.publicKey.challenge.length, 43);
    const claims = authService.verifyJwt(begun.challengeToken);
    assert.equal(Buffer.from(claims.sessionNonce, "base64url").length, 32);
    assert.equal(claims.sessionId, access.jti);

    for (const [field, value] of [["tenantId", "wrong"], ["userId", "wrong"], ["staffId", "wrong"], ["branchId", "wrong"], ["sessionId", "wrong"], ["subjectId", "wrong"]]) {
      assert.throws(() => consumer.consumeChallenge(begun.challengeToken, "register", { ...registrationBindings(access), [field]: value }), /expired or already used/);
    }
    assert.equal(consumer.consumeChallenge(begun.challengeToken, "register", registrationBindings(access)).sub, access.userId);
    assert.throws(() => issuer.consumeChallenge(begun.challengeToken, "register", registrationBindings(access)), /expired or already used/);
  } finally {
    pair.close();
  }
});

test("WebAuthn auth challenges carry a strong nonce and consume across instances concurrently", async () => {
  const pair = databases();
  try {
    const first = new WebauthnService({ grantStore: new SecurityEphemeralGrantStore(pair.first) });
    const second = new WebauthnService({ grantStore: new SecurityEphemeralGrantStore(pair.second) });
    const bindings = { subjectId: "user-1", userId: "user-1", staffId: "staff-1", tenantId: "tenant-1", branchId: "", sessionId: "" };
    const issued = first.issueChallenge("auth", bindings);
    const claims = authService.verifyJwt(issued.token);
    assert.equal(Buffer.from(claims.sessionNonce, "base64url").length, 32);
    const consumeBindings = { ...bindings, sessionId: claims.sessionNonce };
    assert.throws(() => second.consumeChallenge(issued.token, "register", consumeBindings), /Invalid WebAuthn challenge/);
    const results = await Promise.allSettled([
      Promise.resolve().then(() => first.consumeChallenge(issued.token, "auth", consumeBindings)),
      Promise.resolve().then(() => second.consumeChallenge(issued.token, "auth", consumeBindings))
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  } finally {
    pair.close();
  }
});

test("WebAuthn challenges expire in the persistent store and store failures fail closed", () => {
  const database = new Database(":memory:");
  ensureSecurityEphemeralGrantsSchema(database);
  let currentTime = Date.now();
  const store = new SecurityEphemeralGrantStore(database, { clock: () => currentTime });
  try {
    const service = new WebauthnService({ grantStore: store });
    const access = registrationAccess();
    const begun = service.beginRegistration(access);
    currentTime += 301_000;
    assert.throws(() => service.consumeChallenge(begun.challengeToken, "register", registrationBindings(access)), /expired or already used/);

    const failed = new WebauthnService({ grantStore: { issue: () => { throw new Error("store unavailable"); } } });
    assert.throws(() => failed.beginRegistration(access), /store unavailable/);
  } finally {
    database.close();
  }
});
