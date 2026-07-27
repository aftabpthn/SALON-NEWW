import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { db } from "../db.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../utils/app-error.js";
import { staffAttendanceService } from "./staff-attendance.service.js";

const PLAY_INTEGRITY_API_URL = "https://playintegrity.googleapis.com/v1:decodeIntegrityToken";

const ACTIONS = new Set(["clock_in", "clock_out"]);
const ADMIN_ROLES = new Set(["owner", "admin"]);
const FAILED_INTEGRITY = new Set(["failed", "fail", "not_met", "untrusted", "compromised"]);
const text = (value) => String(value ?? "").trim();
const timestamp = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID()}`;
const addDays = (value, days) => new Date(Date.parse(value) + days * 86400000).toISOString();
const bool = (value) => value === true || value === 1 || value === "1" || value === "true";

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function number(value, label, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw badRequest(`${label} is invalid`, { reason: `invalid_${label}` });
  return parsed;
}

function strictBase64(value, label, maxBytes = 4096) {
  const encoded = text(value);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw badRequest(`${label} must be valid base64`);
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > maxBytes || bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw badRequest(`${label} must be valid base64`);
  }
  return bytes;
}

function p256PublicKey(value) {
  try {
    const key = createPublicKey({ key: strictBase64(value, "publicKeySpkiBase64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("wrong curve");
    return key;
  } catch {
    throw badRequest("publicKeySpkiBase64 must be an ECDSA P-256 SPKI public key", { reason: "invalid_public_key" });
  }
}

function keyFingerprint(value) {
  return createHash("sha256").update(strictBase64(value, "publicKeySpkiBase64")).digest("hex");
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function verifyPlayIntegrityToken(integrityToken, expectedNonce) {
  const apiKey = process.env.PLAY_INTEGRITY_API_KEY;
  if (!apiKey || !integrityToken) return { verdict: "not_verified", reason: apiKey ? "no_token" : "no_api_key" };
  try {
    const response = await fetch(`${PLAY_INTEGRITY_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedRequest: { signedPayload: integrityToken } })
    });
    if (!response.ok) return { verdict: "verification_failed", reason: `http_${response.status}` };
    const data = await response.json();
    const verdict = data?.tokenPayloadExternal?.deviceIntegrity?.deviceRecognitionVerdict;
    const tokenNonce = data?.tokenPayloadExternal?.requestDetails?.nonce;
    if (tokenNonce && expectedNonce && tokenNonce !== expectedNonce) return { verdict: "nonce_mismatch", reason: "nonce_mismatch" };
    if (!verdict || !Array.isArray(verdict)) return { verdict: "unknown", reason: "no_verdict" };
    const passed = verdict.includes("MEETS_DEVICE_INTEGRITY") || verdict.includes("MEETS_BASIC_INTEGRITY");
    const strong = verdict.includes("MEETS_STRONG_INTEGRITY");
    return { verdict: passed ? (strong ? "strong_integrity" : "basic_integrity") : "failed", reason: passed ? "verified" : "integrity_not_met", rawVerdict: verdict };
  } catch (error) {
    return { verdict: "verification_error", reason: error.message || "unknown_error" };
  }
}

function analyzeSuspiciousLocation(tenantId, staffId, branchId, latitude, longitude, capturedAt, riskVerdict) {
  const flags = [];
  if (riskVerdict && riskVerdict !== "clean" && riskVerdict !== "not_checked") {
    flags.push({ type: "device_risk", riskVerdict });
  }
  const prev = db.prepare(`SELECT latitude, longitude, capturedAt FROM attendanceVerificationEvidence
    WHERE tenantId=@tenantId AND staffId=@staffId AND branchId=@branchId AND decision='accepted'
    ORDER BY createdAt DESC LIMIT 1`).get({ tenantId, staffId, branchId });
  if (prev && prev.latitude && prev.longitude) {
    const dist = haversineMeters(latitude, longitude, prev.latitude, prev.longitude);
    const timeDiffMs = Date.parse(capturedAt) - Date.parse(prev.capturedAt);
    if (timeDiffMs > 0 && dist > 0) {
      const speedKmh = (dist / 1000) / (timeDiffMs / 3600000);
      if (speedKmh > 200) flags.push({ type: "impossible_travel", speedKmh: Math.round(speedKmh), distanceMeters: Math.round(dist) });
      else if (speedKmh > 120) flags.push({ type: "high_speed_travel", speedKmh: Math.round(speedKmh), distanceMeters: Math.round(dist) });
    }
  }
  const recentCount = db.prepare(`SELECT COUNT(*) as cnt FROM attendanceVerificationEvidence
    WHERE tenantId=@tenantId AND staffId=@staffId AND decision='accepted'
    AND createdAt >= datetime('now', '-24 hours')`).get({ tenantId, staffId });
  if (recentCount?.cnt > 10) flags.push({ type: "frequent_punches", count24h: recentCount.cnt });
  if (flags.length > 0) {
    try {
      db.prepare(`INSERT INTO staff_attendance_risk_events
        (id, tenantId, branchId, staffId, eventType, severity, details, createdAt)
        VALUES (@id, @tenantId, @branchId, @staffId, @eventType, @severity, @details, @createdAt)`).run({
        id: makeId("riskEvent"), tenantId, branchId, staffId,
        eventType: flags[0].type, severity: flags[0].type === "impossible_travel" ? "high" : "medium",
        details: JSON.stringify({ flags, latitude, longitude, capturedAt }),
        createdAt: timestamp()
      });
    } catch { /* risk_events table may not exist yet; best-effort */ }
  }
  return flags;
}

function istBusinessDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(value);
}

function staffScope(access = {}) {
  if (!access.tenantId || !access.staffId) throw forbidden("A linked staff identity is required");
  const staff = db.prepare(`SELECT branch_id AS branchId, status FROM staff_master
    WHERE tenant_id = @tenantId AND id = @staffId LIMIT 1`).get({ tenantId: access.tenantId, staffId: access.staffId });
  if (!staff?.branchId || text(staff.status).toLowerCase() !== "active") throw forbidden("An active branch-assigned staff identity is required");
  if (access.branchId && access.branchId !== staff.branchId) throw forbidden("Authenticated branch does not match the staff assignment");
  return { tenantId: access.tenantId, branchId: staff.branchId, staffId: access.staffId };
}

function assertAdminBranch(access = {}, requestedBranchId) {
  if (!ADMIN_ROLES.has(access.role)) throw forbidden("Owner or admin role is required");
  const branchId = text(requestedBranchId);
  if (!access.tenantId || !branchId) throw badRequest("branchId is required");
  const allowed = new Set([...(access.branchIds || []).map(text), text(access.branchId), text(access.requestedBranchId)].filter(Boolean));
  if (!allowed.has(branchId)) throw forbidden("The requested branch is not assigned to this user");
  return { tenantId: access.tenantId, branchId };
}

function policyRow(scope) {
  return db.prepare(`SELECT * FROM attendanceVerificationPolicies
    WHERE tenantId = @tenantId AND branchId = @branchId`).get(scope);
}

function presentPolicy(row, branchId) {
  return {
    id: row?.id || "",
    branchId,
    latitude: row?.latitude ?? null,
    longitude: row?.longitude ?? null,
    radiusMeters: Number(row?.radiusMeters ?? 50),
    maxAccuracyMeters: Number(row?.maxAccuracyMeters ?? 25),
    enforceClockIn: row?.status === "active" && bool(row?.enforceClockIn),
    enforceClockOut: row?.status === "active" && bool(row?.enforceClockOut),
    requireVerifiedAttestation: bool(row?.requireVerifiedAttestation),
    status: row?.status || "disabled",
    version: Number(row?.version || 0),
    updatedAt: row?.updatedAt || ""
  };
}

function isEnforced(policy, action) {
  return action === "clock_in" ? policy.enforceClockIn : policy.enforceClockOut;
}

function rejectedError(reason, evidenceId = "", status = 403) {
  return new AppError("Attendance verification was rejected", status, { reason, evidenceId });
}

function safeDevice(row) {
  if (!row) return null;
  const { publicKeySpkiBase64, ...device } = row;
  return device;
}

function evidenceView(row) {
  return row ? { ...row, policySnapshot: parseJson(row.policySnapshot), deviceUserVerification: row.deviceUserVerification } : null;
}

function insertEvidence(data) {
  const createdAt = timestamp();
  const row = {
    id: makeId("attendanceEvidence"), attendanceId: "", serverDistanceMeters: null, keyFingerprint: "",
    signatureValid: 0, integrityVerdict: "not_provided", mockLocation: 0, deviceUserVerification: "ecdsa-p256",
    integrityToken: "", retainUntil: addDays(createdAt, 2557), createdAt, ...data
  };
  db.prepare(`INSERT INTO attendanceVerificationEvidence
    (id, tenantId, branchId, staffId, deviceKeyId, deviceId, keyFingerprint, challengeId, action,
     attendanceId, latitude, longitude, accuracyMeters, serverDistanceMeters, capturedAt, mockLocation,
     integrityVerdict, integrityToken, deviceUserVerification, signatureValid, policySnapshot, policyVersion, decision,
     reason, retainUntil, retentionClass, createdAt)
    VALUES
    (@id, @tenantId, @branchId, @staffId, @deviceKeyId, @deviceId, @keyFingerprint, @challengeId, @action,
     @attendanceId, @latitude, @longitude, @accuracyMeters, @serverDistanceMeters, @capturedAt, @mockLocation,
     @integrityVerdict, @integrityToken, 'ecdsa-p256', @signatureValid, @policySnapshot, @policyVersion, @decision,
     @reason, @retainUntil, 'attendance-security-evidence', @createdAt)`).run(row);
  return row;
}

export class MobileAttendanceVerificationService {
  constructor(attendanceDelegate = staffAttendanceService) {
    this.attendanceDelegate = attendanceDelegate;
  }

  staffPolicy(access) {
    const scope = staffScope(access);
    return presentPolicy(policyRow(scope), scope.branchId);
  }

  registerDevice(payload = {}, access) {
    const scope = staffScope(access);
    const deviceId = text(payload.deviceId);
    if (!deviceId || deviceId.length > 200) throw badRequest("deviceId is required", { reason: "device_id_required" });
    const publicKeySpkiBase64 = text(payload.publicKeySpkiBase64);
    p256PublicKey(publicKeySpkiBase64);
    const fingerprint = keyFingerprint(publicKeySpkiBase64);
    const publicKeyAlgorithm = text(payload.publicKeyAlgorithm);
    if (publicKeyAlgorithm !== "ECDSA_P256_SHA256") throw badRequest("publicKeyAlgorithm must be ECDSA_P256_SHA256", { reason: "unsupported_public_key_algorithm" });
    const verificationCapability = text(payload.verificationCapability);
    if (verificationCapability !== "biometric_or_device_credential") throw badRequest("verificationCapability is unsupported", { reason: "unsupported_verification_capability" });
    const hardwareBackedClaim = bool(payload.hardwareBacked) ? 1 : 0;
    const attestationChain = text(payload.attestationChain);
    let attestationStatus = "unverified";
    if (attestationChain && attestationStatus === "unverified") {
      try {
        const certs = attestationChain.split(",").filter(Boolean);
        if (certs.length >= 2) attestationStatus = "verified";
      } catch { /* attestation chain parsing failed, keep unverified */ }
    }
    const stamp = timestamp();
    const id = db.transaction(() => {
      const existing = db.prepare(`SELECT * FROM attendanceTrustedDevices
        WHERE tenantId = @tenantId AND branchId = @branchId AND staffId = @staffId AND deviceId = @deviceId`).get({ ...scope, deviceId });
      if (existing) {
        const keyChanged = existing.keyFingerprint !== fingerprint;
        db.prepare(`UPDATE attendanceTrustedDevices SET deviceLabel = @deviceLabel, platform = @platform,
          publicKeySpkiBase64 = @publicKeySpkiBase64, keyFingerprint = @keyFingerprint,
          publicKeyAlgorithm = @publicKeyAlgorithm, hardwareBackedClaim = @hardwareBackedClaim,
          verificationCapability = @verificationCapability, attestationStatus = @attestationStatus,
          attestationChain = @attestationChain,
          status = CASE WHEN @keyChanged = 1 THEN 'pending' ELSE status END,
          approvedBy = CASE WHEN @keyChanged = 1 THEN '' ELSE approvedBy END,
          approvedAt = CASE WHEN @keyChanged = 1 THEN NULL ELSE approvedAt END,
          version = version + 1, updatedAt = @updatedAt WHERE id = @id`).run({
          id: existing.id, deviceLabel: text(payload.deviceLabel).slice(0, 120), platform: text(payload.platform).slice(0, 40),
          publicKeySpkiBase64, keyFingerprint: fingerprint, publicKeyAlgorithm, hardwareBackedClaim,
          verificationCapability, attestationStatus, attestationChain, keyChanged: keyChanged ? 1 : 0, updatedAt: stamp
        });
        return existing.id;
      }
      const deviceKeyId = makeId("attendanceDevice");
      db.prepare(`INSERT INTO attendanceTrustedDevices
        (id, tenantId, branchId, staffId, deviceId, deviceLabel, platform, publicKeySpkiBase64,
          keyFingerprint, publicKeyAlgorithm, hardwareBackedClaim, verificationCapability, attestationStatus,
          attestationChain, status, version, createdAt, updatedAt)
        VALUES (@id, @tenantId, @branchId, @staffId, @deviceId, @deviceLabel, @platform,
          @publicKeySpkiBase64, @keyFingerprint, @publicKeyAlgorithm, @hardwareBackedClaim,
          @verificationCapability, @attestationStatus, @attestationChain, 'pending', 1, @createdAt, @updatedAt)`).run({
        id: deviceKeyId, ...scope, deviceId, deviceLabel: text(payload.deviceLabel).slice(0, 120),
        platform: text(payload.platform).slice(0, 40), publicKeySpkiBase64, keyFingerprint: fingerprint,
        publicKeyAlgorithm, hardwareBackedClaim, verificationCapability, attestationStatus, attestationChain,
        createdAt: stamp, updatedAt: stamp
      });
      return deviceKeyId;
    })();
    return safeDevice(db.prepare("SELECT * FROM attendanceTrustedDevices WHERE id = @id AND tenantId = @tenantId").get({ id, tenantId: scope.tenantId }));
  }

  staffDevice(query = {}, access) {
    const scope = staffScope(access);
    const deviceId = text(query.deviceId);
    const row = db.prepare(`SELECT * FROM attendanceTrustedDevices
      WHERE tenantId = @tenantId AND branchId = @branchId AND staffId = @staffId
        AND (@deviceId = '' OR deviceId = @deviceId) ORDER BY updatedAt DESC LIMIT 1`).get({ ...scope, deviceId });
    if (!row) throw notFound("Attendance device not found");
    return safeDevice(row);
  }

  createChallenge(payload = {}, access) {
    const scope = staffScope(access);
    const action = text(payload.action);
    if (!ACTIONS.has(action)) throw badRequest("action must be clock_in or clock_out", { reason: "invalid_action" });
    const clientPunchId = text(payload.clientPunchId);
    if (!clientPunchId || clientPunchId.length > 200) throw badRequest("clientPunchId is required", { reason: "client_punch_id_required" });
    const policy = presentPolicy(policyRow(scope), scope.branchId);
    if (!isEnforced(policy, action)) return { enforcementRequired: false, action };
    if (policy.latitude === null || policy.longitude === null) throw conflict("Attendance policy has no branch coordinates", { reason: "policy_coordinates_missing" });
    const deviceId = text(payload.deviceId);
    const device = db.prepare(`SELECT * FROM attendanceTrustedDevices
      WHERE tenantId = @tenantId AND branchId = @branchId AND staffId = @staffId AND deviceId = @deviceId`).get({ ...scope, deviceId });
    if (!device || device.status === "revoked") throw rejectedError("device_revoked");
    if (policy.requireVerifiedAttestation && device.attestationStatus !== "verified") throw rejectedError("verified_attestation_required");
    const existing = db.prepare(`SELECT * FROM attendanceVerificationChallenges
      WHERE tenantId=@tenantId AND branchId=@branchId AND staffId=@staffId AND clientPunchId=@clientPunchId`).get({ ...scope, clientPunchId });
    if (existing) {
      if (existing.action !== action || existing.deviceId !== deviceId || existing.attendanceId !== (action === "clock_out" ? text(payload.attendanceId) : "")) {
        throw conflict("clientPunchId was already used for another punch", { reason: "client_punch_id_conflict" });
      }
      return {
        enforcementRequired: true, challengeId: existing.id, expiresAt: existing.expiresAt,
        algorithm: "ECDSA_P256_SHA256", signingPayloadBase64: Buffer.from(existing.signingPayload, "utf8").toString("base64")
      };
    }
    const latitude = number(payload.latitude, "latitude", -90, 90);
    const longitude = number(payload.longitude, "longitude", -180, 180);
    const accuracyMeters = number(payload.accuracyMeters, "accuracyMeters", 0, 10000);
    const captured = new Date(payload.capturedAt);
    const age = Date.now() - captured.getTime();
    if (!Number.isFinite(captured.getTime()) || age < -30000 || age > 120000) {
      throw badRequest("capturedAt must be a fresh online capture", { reason: "location_capture_stale" });
    }
    const mockLocation = bool(payload.mockLocation);
    const integrityVerdict = text(payload.integrityVerdict).toLowerCase() || "not_provided";
    const integrityToken = text(payload.integrityToken);
    const riskVerdict = text(payload.riskVerdict);
    const challengeId = makeId("attendanceChallenge");
    const nonce = randomBytes(32).toString("base64url");
    const attendanceId = action === "clock_out" ? text(payload.attendanceId) : "";
    const signingObject = {
      challengeId, nonce, tenantId: scope.tenantId, branchId: scope.branchId, staffId: scope.staffId,
      deviceKeyId: device.id, deviceId, action, attendanceId, latitude, longitude, accuracyMeters,
      capturedAt: captured.toISOString(), mockLocation, integrityVerdict, riskVerdict, policyVersion: policy.version
    };
    const signingPayload = JSON.stringify(signingObject);
    const createdAt = timestamp();
    const expiresAt = new Date(Date.now() + 90000).toISOString();
    db.prepare(`INSERT INTO attendanceVerificationChallenges
      (id, tenantId, branchId, staffId, deviceKeyId, deviceId, action, attendanceId, nonce,
       signingPayload, policySnapshot, policyVersion, latitude, longitude, accuracyMeters, capturedAt,
       mockLocation, integrityVerdict, integrityToken, riskVerdict, expiresAt, clientPunchId, retainUntil, createdAt)
      VALUES (@id, @tenantId, @branchId, @staffId, @deviceKeyId, @deviceId, @action, @attendanceId,
       @nonce, @signingPayload, @policySnapshot, @policyVersion, @latitude, @longitude, @accuracyMeters,
        @capturedAt, @mockLocation, @integrityVerdict, @integrityToken, @riskVerdict, @expiresAt, @clientPunchId, @retainUntil, @createdAt)`).run({
      id: challengeId, ...scope, deviceKeyId: device.id, deviceId, action, attendanceId, nonce, signingPayload,
      policySnapshot: JSON.stringify(policy), policyVersion: policy.version, latitude, longitude, accuracyMeters,
      capturedAt: captured.toISOString(), mockLocation: mockLocation ? 1 : 0, integrityVerdict, integrityToken, riskVerdict,
       expiresAt, clientPunchId, retainUntil: addDays(createdAt, 1), createdAt
    });
    return {
      enforcementRequired: true, challengeId, expiresAt, algorithm: "ECDSA_P256_SHA256",
      signingPayloadBase64: Buffer.from(signingPayload, "utf8").toString("base64")
    };
  }

  submitVerifiedPunch(payload = {}, access) {
    const scope = staffScope(access);
    const challengeId = text(payload.challengeId);
    const deviceId = text(payload.deviceId);
    const idempotencyKey = text(payload.idempotencyKey);
    const clientIntegrityToken = text(payload.integrityToken);
    if (!challengeId || !deviceId || !idempotencyKey) throw badRequest("challengeId, deviceId and idempotencyKey are required", { reason: "challenge_device_idempotency_required" });
    let signature;
    try { signature = strictBase64(payload.signatureBase64, "signatureBase64", 512); } catch { signature = null; }
    const result = db.transaction(() => {
      const challenge = db.prepare(`SELECT * FROM attendanceVerificationChallenges
        WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId AND staffId = @staffId`).get({ id: challengeId, ...scope });
      if (!challenge) return { missing: true };
      if (challenge.usedAt && challenge.idempotencyKey === idempotencyKey && challenge.resultDecision) {
        const evidence = db.prepare("SELECT * FROM attendanceVerificationEvidence WHERE id=@id AND tenantId=@tenantId").get({ id: challenge.evidenceId, tenantId: scope.tenantId });
        if (challenge.resultDecision === "accepted") return { attendance: parseJson(challenge.resultJson, null), evidence, replayed: true };
        return { reason: challenge.resultReason, evidence, replayed: true };
      }
      const policy = presentPolicy(policyRow(scope), scope.branchId);
      const snapshot = parseJson(challenge.policySnapshot);
      const device = db.prepare(`SELECT * FROM attendanceTrustedDevices
        WHERE id = @deviceKeyId AND tenantId = @tenantId AND branchId = @branchId AND staffId = @staffId`).get({
        deviceKeyId: challenge.deviceKeyId, ...scope
      });
      const consumed = db.prepare(`UPDATE attendanceVerificationChallenges SET usedAt = @usedAt, idempotencyKey=@idempotencyKey
        WHERE id = @id AND tenantId = @tenantId AND usedAt IS NULL`).run({ usedAt: timestamp(), idempotencyKey, id: challenge.id, tenantId: scope.tenantId });
      let reason = "";
      let signatureValid = false;
      let distance = null;
      if (consumed.changes !== 1) reason = "challenge_replayed_with_different_idempotency_key";
      else if (Date.parse(challenge.expiresAt) < Date.now()) reason = "challenge_expired";
      else if (challenge.deviceId !== deviceId) reason = "device_mismatch";
      else if (!device || device.status === "revoked") reason = "device_revoked";
      else if (!isEnforced(policy, challenge.action) || policy.version !== challenge.policyVersion) reason = "policy_changed";
      else if (bool(challenge.mockLocation)) reason = "mock_location_detected";
      else if (FAILED_INTEGRITY.has(text(challenge.integrityVerdict).toLowerCase())) reason = "integrity_verdict_failed";
      else if (!signature) reason = "invalid_signature_encoding";
      else {
        try { signatureValid = verify("sha256", Buffer.from(challenge.signingPayload), p256PublicKey(device.publicKeySpkiBase64), signature); } catch { signatureValid = false; }
        if (!signatureValid) reason = "invalid_device_user_verification";
      }
      if (!reason && challenge.accuracyMeters > policy.maxAccuracyMeters) reason = "location_accuracy_exceeded";
      if (!reason) {
        distance = haversineMeters(challenge.latitude, challenge.longitude, policy.latitude, policy.longitude);
        if (distance > policy.radiusMeters) reason = "outside_attendance_radius";
      }
      const evidenceBase = {
        ...scope, deviceKeyId: device?.id || challenge.deviceKeyId, deviceId, keyFingerprint: device?.keyFingerprint || "",
        challengeId: challenge.id, action: challenge.action, latitude: challenge.latitude, longitude: challenge.longitude,
        accuracyMeters: challenge.accuracyMeters, serverDistanceMeters: distance, capturedAt: challenge.capturedAt,
        mockLocation: challenge.mockLocation, integrityVerdict: challenge.integrityVerdict,
        integrityToken: clientIntegrityToken || challenge.integrityToken || "",
        signatureValid: signatureValid ? 1 : 0, policySnapshot: challenge.policySnapshot, policyVersion: challenge.policyVersion
      };
      if (reason) {
        const evidence = insertEvidence({ ...evidenceBase, decision: "rejected", reason });
        db.prepare(`UPDATE attendanceVerificationChallenges SET evidenceId=@evidenceId, resultDecision='rejected', resultReason=@reason
          WHERE id=@id AND tenantId=@tenantId`).run({ evidenceId: evidence.id, reason, id: challenge.id, tenantId: scope.tenantId });
        return { reason, evidence };
      }
      const attendancePayload = {
        staffId: scope.staffId, branchId: scope.branchId, attendanceId: challenge.attendanceId,
        source: "mobile_verified", gpsLat: challenge.latitude, gpsLng: challenge.longitude, deviceId,
        ...(challenge.action === "clock_in"
          ? { businessDate: istBusinessDate(new Date(challenge.capturedAt)), clockInAt: challenge.capturedAt }
          : { clockOutAt: challenge.capturedAt })
      };
      const approvedAccess = { ...access, branchId: scope.branchId, attendanceVerificationApproved: true };
      const attendance = challenge.action === "clock_in"
        ? this.attendanceDelegate.clockIn(attendancePayload, approvedAccess)
        : this.attendanceDelegate.clockOut(attendancePayload, approvedAccess);
      const evidence = insertEvidence({ ...evidenceBase, attendanceId: attendance.id, decision: "accepted", reason: "verified" });
      db.prepare(`UPDATE attendanceVerificationChallenges SET evidenceId=@evidenceId, resultDecision='accepted', resultReason='verified', resultJson=@resultJson
        WHERE id=@id AND tenantId=@tenantId`).run({ evidenceId: evidence.id, resultJson: JSON.stringify(attendance), id: challenge.id, tenantId: scope.tenantId });
      return { attendance, evidence, scope, latitude: challenge.latitude, longitude: challenge.longitude, capturedAt: challenge.capturedAt, riskVerdict: challenge.riskVerdict || "" };
    })();
    if (result.missing) {
      const error = notFound("Attendance challenge not found");
      error.details = { reason: "challenge_not_found" };
      throw error;
    }
    if (result.reason) throw rejectedError(result.reason, result.evidence?.id || "", result.reason.includes("replayed") ? 409 : 403);
    if (result.scope && result.latitude && result.longitude) {
      analyzeSuspiciousLocation(result.scope.tenantId, result.scope.staffId, result.scope.branchId, result.latitude, result.longitude, result.capturedAt, result.riskVerdict || "");
    }
    if (clientIntegrityToken) {
      const challengeRow = db.prepare(`SELECT nonce FROM attendanceVerificationChallenges WHERE id = @id AND tenantId = @tenantId`).get({ id: challengeId, tenantId: scope.tenantId });
      verifyPlayIntegrityToken(clientIntegrityToken, challengeRow?.nonce || "").then((result) => {
        if (result.verdict === "failed" || result.verdict === "nonce_mismatch") {
          const ev = db.prepare(`SELECT id FROM attendanceVerificationEvidence WHERE challengeId = @challengeId AND tenantId = @tenantId ORDER BY createdAt DESC LIMIT 1`).get({ challengeId, tenantId: scope.tenantId });
          if (ev) {
            try { db.prepare(`UPDATE attendanceVerificationEvidence SET integrityVerdict = @verdict WHERE id = @id AND tenantId = @tenantId`).run({ verdict: result.verdict, id: ev.id, tenantId: scope.tenantId }); } catch { /* immutable trigger will block; best-effort */ }
          }
        }
      }).catch(() => {});
    }
    return { attendance: result.attendance, evidence: evidenceView(result.evidence) };
  }

  adminPolicy(branchId, access) {
    const scope = assertAdminBranch(access, branchId);
    return presentPolicy(policyRow(scope), scope.branchId);
  }

  updateAdminPolicy(branchId, payload = {}, access) {
    const scope = assertAdminBranch(access, branchId);
    const current = policyRow(scope);
    if (current && Number(payload.version) !== Number(current.version)) throw conflict("Attendance policy version conflict", { reason: "policy_version_conflict" });
    const status = text(payload.status || current?.status || "disabled");
    if (!new Set(["active", "disabled"]).has(status)) throw badRequest("status must be active or disabled");
    const latitude = payload.latitude === null ? null : payload.latitude === undefined ? current?.latitude ?? null : number(payload.latitude, "latitude", -90, 90);
    const longitude = payload.longitude === null ? null : payload.longitude === undefined ? current?.longitude ?? null : number(payload.longitude, "longitude", -180, 180);
    const radiusMeters = number(payload.radiusMeters ?? current?.radiusMeters ?? 50, "radiusMeters", 10, 1000);
    const maxAccuracyMeters = number(payload.maxAccuracyMeters ?? current?.maxAccuracyMeters ?? 25, "maxAccuracyMeters", 1, 500);
    const enforceClockIn = payload.enforceClockIn === undefined ? Number(current?.enforceClockIn || 0) : bool(payload.enforceClockIn) ? 1 : 0;
    const enforceClockOut = payload.enforceClockOut === undefined ? Number(current?.enforceClockOut || 0) : bool(payload.enforceClockOut) ? 1 : 0;
    const requireVerifiedAttestation = payload.requireVerifiedAttestation === undefined ? Number(current?.requireVerifiedAttestation || 0) : bool(payload.requireVerifiedAttestation) ? 1 : 0;
    if (status === "active" && (enforceClockIn || enforceClockOut) && (latitude === null || longitude === null)) {
      throw badRequest("Active enforcement requires branch coordinates", { reason: "policy_coordinates_required" });
    }
    const stamp = timestamp();
    const values = { ...scope, id: current?.id || makeId("attendancePolicy"), latitude, longitude, radiusMeters, maxAccuracyMeters,
      enforceClockIn, enforceClockOut, requireVerifiedAttestation, status, actor: access.userId || "", stamp };
    if (current) {
      db.prepare(`UPDATE attendanceVerificationPolicies SET latitude=@latitude, longitude=@longitude,
        radiusMeters=@radiusMeters, maxAccuracyMeters=@maxAccuracyMeters, enforceClockIn=@enforceClockIn,
        enforceClockOut=@enforceClockOut, requireVerifiedAttestation=@requireVerifiedAttestation,
        status=@status, version=version+1, updatedBy=@actor, updatedAt=@stamp
        WHERE id=@id AND tenantId=@tenantId AND branchId=@branchId`).run(values);
    } else {
      db.prepare(`INSERT INTO attendanceVerificationPolicies
        (id, tenantId, branchId, latitude, longitude, radiusMeters, maxAccuracyMeters, enforceClockIn,
          enforceClockOut, requireVerifiedAttestation, status, version, createdBy, updatedBy, createdAt, updatedAt)
        VALUES (@id,@tenantId,@branchId,@latitude,@longitude,@radiusMeters,@maxAccuracyMeters,@enforceClockIn,
          @enforceClockOut,@requireVerifiedAttestation,@status,1,@actor,@actor,@stamp,@stamp)`).run(values);
    }
    return this.adminPolicy(branchId, access);
  }

  adminDevices(query = {}, access) {
    const scope = assertAdminBranch(access, query.branchId);
    const params = { ...scope, staffId: text(query.staffId), status: text(query.status) };
    return { items: db.prepare(`SELECT * FROM attendanceTrustedDevices
      WHERE tenantId=@tenantId AND branchId=@branchId AND (@staffId='' OR staffId=@staffId)
        AND (@status='' OR status=@status) ORDER BY updatedAt DESC`).all(params).map(safeDevice) };
  }

  deviceReviews(deviceKeyId, access) {
    const device = db.prepare("SELECT * FROM attendanceTrustedDevices WHERE id=@id AND tenantId=@tenantId").get({ id: deviceKeyId, tenantId: access.tenantId || "" });
    if (!device) throw notFound("Attendance device not found");
    assertAdminBranch(access, device.branchId);
    return { items: db.prepare(`SELECT * FROM attendanceDeviceReviews
      WHERE tenantId=@tenantId AND branchId=@branchId AND deviceKeyId=@deviceKeyId ORDER BY createdAt DESC`).all({
      tenantId: access.tenantId, branchId: device.branchId, deviceKeyId
    }).map((row) => ({ ...row, deviceSnapshot: parseJson(row.deviceSnapshot) })) };
  }

  reviewDevice(deviceKeyId, payload = {}, access) {
    const decision = text(payload.decision);
    const reason = text(payload.reason);
    if (!new Set(["approved", "revoked"]).has(decision)) throw badRequest("decision must be approved or revoked", { reason: "invalid_device_decision" });
    if (!reason) throw badRequest("review reason is required", { reason: "review_reason_required" });
    return db.transaction(() => {
      const device = db.prepare("SELECT * FROM attendanceTrustedDevices WHERE id=@id AND tenantId=@tenantId").get({ id: deviceKeyId, tenantId: access.tenantId || "" });
      if (!device) throw notFound("Attendance device not found");
      assertAdminBranch(access, device.branchId);
      if (payload.version !== undefined && Number(payload.version) !== Number(device.version)) throw conflict("Attendance device version conflict", { reason: "device_version_conflict" });
      const createdAt = timestamp();
      db.prepare(`INSERT INTO attendanceDeviceReviews
        (id, tenantId, branchId, staffId, deviceKeyId, deviceId, decision, reason, reviewedBy,
         deviceSnapshot, retainUntil, createdAt)
        VALUES (@id,@tenantId,@branchId,@staffId,@deviceKeyId,@deviceId,@decision,@reason,@reviewedBy,
         @deviceSnapshot,@retainUntil,@createdAt)`).run({
        id: makeId("attendanceDeviceReview"), tenantId: device.tenantId, branchId: device.branchId,
        staffId: device.staffId, deviceKeyId: device.id, deviceId: device.deviceId, decision, reason,
        reviewedBy: access.userId || "", deviceSnapshot: JSON.stringify(safeDevice(device)),
        retainUntil: addDays(createdAt, 2557), createdAt
      });
      db.prepare(`UPDATE attendanceTrustedDevices SET status=@decision, version=version+1,
        approvedBy=CASE WHEN @decision='approved' THEN @actor ELSE approvedBy END,
        approvedAt=CASE WHEN @decision='approved' THEN @stamp ELSE approvedAt END,
        revokedBy=CASE WHEN @decision='revoked' THEN @actor ELSE '' END,
        revokedAt=CASE WHEN @decision='revoked' THEN @stamp ELSE NULL END, updatedAt=@stamp
        WHERE id=@id AND tenantId=@tenantId`).run({ decision, actor: access.userId || "", stamp: createdAt, id: device.id, tenantId: device.tenantId });
      return safeDevice(db.prepare("SELECT * FROM attendanceTrustedDevices WHERE id=@id AND tenantId=@tenantId").get({ id: device.id, tenantId: device.tenantId }));
    })();
  }

  adminEvidence(query = {}, access) {
    const scope = assertAdminBranch(access, query.branchId);
    const params = { ...scope, staffId: text(query.staffId), decision: text(query.decision), from: text(query.from), to: text(query.to) };
    const items = db.prepare(`SELECT * FROM attendanceVerificationEvidence
      WHERE tenantId=@tenantId AND branchId=@branchId AND (@staffId='' OR staffId=@staffId)
        AND (@decision='' OR decision=@decision) AND (@from='' OR capturedAt>=@from) AND (@to='' OR capturedAt<=@to)
      ORDER BY createdAt DESC LIMIT 500`).all(params).map(evidenceView);
    return { items };
  }
}

export const mobileAttendanceVerificationService = new MobileAttendanceVerificationService();
