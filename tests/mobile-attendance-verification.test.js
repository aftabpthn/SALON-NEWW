import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import test from "node:test";
import { db } from "../server/db.js";
import { ensureStaffOsSchema } from "../server/services/staff-os-schema.service.js";
import { ensureAttendanceVerificationSchema } from "../server/services/attendance-verification-schema.service.js";
import { MobileAttendanceVerificationService } from "../server/services/mobile-attendance-verification.service.js";
import { assertStaffAttendanceVerification } from "../server/services/attendance-verification-policy.service.js";
import { mobileAttendanceVerificationRouter } from "../server/routes/mobile-attendance-verification.routes.js";

ensureStaffOsSchema();
ensureAttendanceVerificationSchema();

function fixture({ approve = true } = {}) {
  const suffix = randomUUID();
  const tenantId = `attendance_test_tenant_${suffix}`;
  const branchId = `attendance_test_branch_${suffix}`;
  const staffId = `attendance_test_staff_${suffix}`;
  const deviceId = `attendance_test_device_${suffix}`;
  const calls = [];
  const service = new MobileAttendanceVerificationService({
    clockIn(payload, access) {
      calls.push({ action: "clock_in", payload, access });
      return { id: `attendance_${suffix}`, ...payload };
    },
    clockOut(payload, access) {
      calls.push({ action: "clock_out", payload, access });
      return { id: `attendance_${suffix}`, ...payload };
    }
  });
  const staffAccess = { tenantId, branchId, staffId, userId: `user_${suffix}`, role: "staff" };
  const adminAccess = { tenantId, branchId, branchIds: [branchId], userId: `admin_${suffix}`, role: "admin" };
  db.prepare(`INSERT INTO tenants (id,name,slug,createdAt,updatedAt)
    VALUES (@id,'Attendance Test',@slug,@stamp,@stamp)`).run({ id: tenantId, slug: `attendance-test-${suffix}`, stamp: new Date().toISOString() });
  db.prepare(`INSERT INTO staff_master
    (id, tenant_id, branch_id, employee_code, first_name, full_name, status)
    VALUES (@id, @tenantId, @branchId, @employeeCode, 'Test', 'Test Staff', 'active')`).run({
    id: staffId, tenantId, branchId, employeeCode: `EMP_${suffix}`
  });
  service.updateAdminPolicy(branchId, {
    latitude: 28.6139,
    longitude: 77.209,
    radiusMeters: 50,
    maxAccuracyMeters: 25,
    enforceClockIn: true,
    enforceClockOut: true,
    status: "active"
  }, adminAccess);
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeySpkiBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  let device = service.registerDevice({
    deviceId, deviceLabel: "Test phone", platform: "android", publicKeySpkiBase64,
    publicKeyAlgorithm: "ECDSA_P256_SHA256", hardwareBacked: true,
    verificationCapability: "biometric_or_device_credential"
  }, staffAccess);
  if (approve) {
    device = service.reviewDevice(device.id, { decision: "approved", reason: "Test approval", version: device.version }, adminAccess);
  }
  return { service, calls, staffAccess, adminAccess, deviceId, device, privateKey };
}

function challengeAndSignature(context, overrides = {}) {
  const challenge = context.service.createChallenge({
    action: "clock_in",
    clientPunchId: `punch_${randomUUID()}`,
    deviceId: context.deviceId,
    latitude: 28.6139,
    longitude: 77.209,
    accuracyMeters: 10,
    capturedAt: new Date().toISOString(),
    mockLocation: false,
    ...overrides
  }, context.staffAccess);
  const signingPayload = Buffer.from(challenge.signingPayloadBase64, "base64");
  const decodedPayload = JSON.parse(signingPayload.toString("utf8"));
  assert.equal(decodedPayload.latitude, overrides.latitude ?? 28.6139);
  assert.equal(decodedPayload.accuracyMeters, overrides.accuracyMeters ?? 10);
  return {
    challenge,
    signatureBase64: sign("sha256", signingPayload, context.privateKey).toString("base64")
  };
}

function expectReason(fn, reason) {
  assert.throws(fn, (error) => {
    assert.equal(error.details?.reason, reason);
    return true;
  });
}

test("verified attendance accepts an accurate location inside 50m and delegates once", () => {
  const context = fixture();
  const signed = challengeAndSignature(context);
  const result = context.service.submitVerifiedPunch({
    challengeId: signed.challenge.challengeId,
    deviceId: context.deviceId,
    signatureBase64: signed.signatureBase64,
    idempotencyKey: signed.challenge.challengeId
  }, context.staffAccess);
  assert.equal(result.evidence.decision, "accepted");
  assert.equal(result.evidence.deviceUserVerification, "ecdsa-p256");
  assert.equal(context.calls.length, 1);
  assert.equal(context.calls[0].access.attendanceVerificationApproved, true);
});

test("verified attendance rejects a server-computed distance over 50m without attendance", () => {
  const context = fixture();
  const signed = challengeAndSignature(context, { latitude: 28.6149 });
  expectReason(() => context.service.submitVerifiedPunch({
    challengeId: signed.challenge.challengeId, deviceId: context.deviceId, signatureBase64: signed.signatureBase64, idempotencyKey: signed.challenge.challengeId
  }, context.staffAccess), "outside_attendance_radius");
  assert.equal(context.calls.length, 0);
});

test("verified attendance rejects GPS accuracy over 25m without attendance", () => {
  const context = fixture();
  const signed = challengeAndSignature(context, { accuracyMeters: 26 });
  expectReason(() => context.service.submitVerifiedPunch({
    challengeId: signed.challenge.challengeId, deviceId: context.deviceId, signatureBase64: signed.signatureBase64, idempotencyKey: signed.challenge.challengeId
  }, context.staffAccess), "location_accuracy_exceeded");
  assert.equal(context.calls.length, 0);
});

test("verified attendance rejects native mockLocation without attendance", () => {
  const context = fixture();
  const signed = challengeAndSignature(context, { mockLocation: true });
  expectReason(() => context.service.submitVerifiedPunch({
    challengeId: signed.challenge.challengeId, deviceId: context.deviceId, signatureBase64: signed.signatureBase64, idempotencyKey: signed.challenge.challengeId
  }, context.staffAccess), "mock_location_detected");
  assert.equal(context.calls.length, 0);
});

test("verified attendance safely replays the prior result for the same idempotency key", () => {
  const context = fixture();
  const signed = challengeAndSignature(context);
  const submission = { challengeId: signed.challenge.challengeId, deviceId: context.deviceId, signatureBase64: signed.signatureBase64, idempotencyKey: signed.challenge.challengeId };
  const first = context.service.submitVerifiedPunch(submission, context.staffAccess);
  const replay = context.service.submitVerifiedPunch(submission, context.staffAccess);
  assert.equal(replay.attendance.id, first.attendance.id);
  assert.equal(replay.evidence.id, first.evidence.id);
  assert.equal(context.calls.length, 1);
});

test("owner contract exposes exact policy and device review values", () => {
  const context = fixture({ approve: false });
  const policy = context.service.adminPolicy(context.staffAccess.branchId, context.adminAccess);
  assert.equal(policy.status, "active");
  assert.equal(policy.radiusMeters, 50);
  assert.equal(policy.maxAccuracyMeters, 25);
  assert.equal(policy.requireVerifiedAttestation, false);
  assert.equal(context.device.status, "pending");
  assert.equal(context.device.publicKeyAlgorithm, "ECDSA_P256_SHA256");
  assert.equal(context.device.hardwareBackedClaim, 1);
  assert.equal(context.device.attestationStatus, "unverified");
  const approved = context.service.reviewDevice(context.device.id, {
    decision: "approved", reason: "Owner explicit test approval", version: context.device.version
  }, context.adminAccess);
  assert.equal(approved.status, "approved");
  assert.equal(context.service.adminDevices({ branchId: context.staffAccess.branchId }, context.adminAccess).items.length, 1);
});

test("owner route contract uses the documented attendance-verification endpoints", () => {
  const routes = mobileAttendanceVerificationRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  assert.ok(routes.includes("GET /attendance-verification/branches/:branchId/policy"));
  assert.ok(routes.includes("PUT /attendance-verification/branches/:branchId/policy"));
  assert.ok(routes.includes("GET /attendance-verification/devices"));
  assert.ok(routes.includes("POST /attendance-verification/devices/:id/reviews"));
  assert.ok(routes.includes("GET /attendance-verification/evidence"));
});

test("linked manager self punch cannot bypass active verification", () => {
  const context = fixture();
  db.prepare(`INSERT INTO tenant_users
    (id, tenantId, email, name, role, branchIds, staffId, status, createdAt, updatedAt)
    VALUES (@id,@tenantId,@email,'Linked Manager','manager',@branchIds,@staffId,'active',@stamp,@stamp)`).run({
    id: context.staffAccess.userId, tenantId: context.staffAccess.tenantId,
    email: `${randomUUID()}@example.test`, branchIds: JSON.stringify([context.staffAccess.branchId]),
    staffId: context.staffAccess.staffId, stamp: new Date().toISOString()
  });
  expectReason(() => assertStaffAttendanceVerification(
    { branchId: context.staffAccess.branchId },
    { ...context.staffAccess, staffId: "", role: "manager" },
    "clock_in"
  ), "verification_required");
});

test("managed attendance uses the target staff branch policy", () => {
  const context = fixture();
  expectReason(() => assertStaffAttendanceVerification(
    { staffId: context.staffAccess.staffId, branchId: context.staffAccess.branchId },
    { ...context.adminAccess, branchId: `other_${randomUUID()}` },
    "clock_in"
  ), "verification_required");
});

test("challenge rejects a revoked device", () => {
  const context = fixture({ approve: false });
  // First approve, then revoke
  const revoked = context.service.reviewDevice(context.device.id, { decision: "revoked", reason: "Test revocation", version: context.device.version }, context.adminAccess);
  expectReason(() => context.service.createChallenge({
    action: "clock_in",
    clientPunchId: `punch_${randomUUID()}`,
    deviceId: context.deviceId,
    latitude: 28.6139,
    longitude: 77.209,
    accuracyMeters: 10,
    capturedAt: new Date().toISOString(),
    mockLocation: false
  }, context.staffAccess), "device_revoked");
  assert.equal(context.calls.length, 0);
});

test("challenge allows a pending device through biometric verification", () => {
  const context = fixture({ approve: false });
  const challenge = context.service.createChallenge({
    action: "clock_in",
    clientPunchId: `punch_${randomUUID()}`,
    deviceId: context.deviceId,
    latitude: 28.6139,
    longitude: 77.209,
    accuracyMeters: 10,
    capturedAt: new Date().toISOString(),
    mockLocation: false
  }, context.staffAccess);
  assert.equal(challenge.enforcementRequired, true);
  assert.ok(challenge.challengeId);
});
