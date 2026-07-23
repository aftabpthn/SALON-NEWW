import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { db } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/app-error.js";
import { realtimeService } from "./realtime.service.js";
import { staffOsService } from "./staff-os.service.js";

const ACTIONS = new Set(["clock_in", "clock_out"]);
const DEVICE_STATUSES = new Set(["trusted", "revoked"]);
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${randomUUID()}`;
const text = (value) => String(value ?? "").trim();
const bool = (value, fallback = false) => value === undefined ? fallback : value === true || value === 1 || value === "1" || value === "true";
const businessDate = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);

function strictBase64(value, label, maxBytes = 4096) {
  const encoded = text(value);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw badRequest(`${label} must be valid base64`);
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > maxBytes || bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) throw badRequest(`${label} must be valid base64`);
  return bytes;
}

function publicKeyFromSpki(value) {
  try {
    const key = createPublicKey({ key: strictBase64(value, "publicKeySpkiBase64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("curve");
    return key;
  } catch {
    throw badRequest("publicKeySpkiBase64 must be an ECDSA P-256 SPKI public key");
  }
}

function number(value, label, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw badRequest(`${label} is invalid`);
  return parsed;
}

function json(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function ownerBranches(access) {
  if (text(access?.role).toLowerCase() !== "owner") throw forbidden("Owner role is required");
  const owner = db.prepare(`SELECT status, branchIds FROM tenant_users WHERE tenantId = @tenantId AND id = @userId AND lower(role) = 'owner'`).get({ tenantId: access.tenantId, userId: access.userId });
  if (!owner || text(owner.status).toLowerCase() !== "active") throw forbidden("Active owner access is required");
  const branchIds = json(owner.branchIds, []).map(text).filter(Boolean);
  if (!branchIds.length) throw forbidden("This owner has no assigned branches");
  return [...new Set(branchIds)];
}

function assertOwnerBranch(access, branchId) {
  if (!ownerBranches(access).includes(text(branchId))) throw forbidden("The requested branch is not accessible to this owner");
  return text(branchId);
}

function staffScope(access) {
  if (!access?.tenantId || !access?.staffId) throw forbidden("A staff self identity is required");
  const row = db.prepare(`SELECT branchId FROM (
    SELECT branch_id AS branchId, 1 AS priority FROM staff_master WHERE tenant_id = @tenantId AND id = @staffId
    UNION ALL SELECT branchId, 2 FROM staff WHERE tenantId = @tenantId AND id = @staffId
  ) ORDER BY priority LIMIT 1`).get({ tenantId: access.tenantId, staffId: access.staffId });
  if (!row?.branchId) throw forbidden("The logged-in staff member has no branch assignment");
  if (access.branchId && access.branchId !== row.branchId) throw forbidden("The authenticated branch does not match the staff assignment");
  return { tenantId: access.tenantId, branchId: row.branchId, staffId: access.staffId, userId: access.userId || "" };
}

function policyRow(tenantId, branchId) {
  return db.prepare(`SELECT * FROM attendanceLocationPolicies WHERE tenantId = @tenantId AND branchId = @branchId`).get({ tenantId, branchId });
}

function presentPolicy(row, branchId) {
  const active = row?.status === "active";
  const policy = {
    id: row?.id || "", branchId, latitude: row?.latitude ?? null, longitude: row?.longitude ?? null,
    radiusMeters: Number(row?.radiusMeters ?? 50), maxAccuracyMeters: Number(row?.maxAccuracyMeters ?? 50),
    biometricRequired: bool(row?.biometricRequired, true), locationRequired: bool(row?.locationRequired, true),
    clockInEnforced: active && bool(row?.clockInEnforced), clockOutEnforced: active && bool(row?.clockOutEnforced),
    status: active ? "enabled" : "disabled", version: Number(row?.version || 0), updatedAt: row?.updatedAt || ""
  };
  return { ...policy, enabled: active, requireBiometric: policy.biometricRequired, requireLocation: policy.locationRequired, enforceClockIn: policy.clockInEnforced, enforceClockOut: policy.clockOutEnforced };
}

function enforcement(policy, action) {
  return action === "clock_in" ? policy.clockInEnforced : policy.clockOutEnforced;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1); const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function emit(type, payload, scope) {
  realtimeService.broadcast(type, payload, { tenantId: scope.tenantId, branchId: scope.branchId });
}

function evidenceView(row) {
  if (!row) return null;
  const overridden = Boolean(row.ownerOverrideAt);
  return {
    ...row,
    action: row.attemptedAction,
    distanceMeters: row.serverDistanceMeters,
    policySnapshot: json(row.policySnapshot, {}),
    biometricSignatureValid: bool(row.biometricSignatureValid),
    biometricVerified: bool(row.biometricSignatureValid),
    deviceVerified: bool(row.biometricSignatureValid),
    decision: overridden ? "overridden" : row.decision,
    overridden,
    override: overridden ? { reason: row.ownerOverrideReason, overriddenAt: row.ownerOverrideAt, overriddenBy: row.ownerOverrideBy } : null
  };
}

function insertEvidence(data) {
  const row = { id: id("attEvidence"), createdAt: now(), ...data };
  db.prepare(`INSERT INTO attendancePunchEvidence
    (id, tenantId, branchId, staffId, deviceKeyId, deviceId, challengeId, attemptedAction, capturedAt, latitude, longitude, accuracyMeters, serverDistanceMeters, policySnapshot, policyVersion, biometricSignatureValid, decision, reason, attendanceId, createdAt)
    VALUES (@id, @tenantId, @branchId, @staffId, @deviceKeyId, @deviceId, @challengeId, @attemptedAction, @capturedAt, @latitude, @longitude, @accuracyMeters, @serverDistanceMeters, @policySnapshot, @policyVersion, @biometricSignatureValid, @decision, @reason, @attendanceId, @createdAt)`).run(row);
  return row;
}

function attendanceState(scope, action, attendanceId, capturedAt) {
  const open = attendanceId
    ? db.prepare(`SELECT id, status, clock_in_at AS clockInAt FROM staff_attendance_logs WHERE tenant_id = @tenantId AND branch_id = @branchId AND staff_id = @staffId AND id = @attendanceId`).get({ ...scope, attendanceId })
    : db.prepare(`SELECT id, status, clock_in_at AS clockInAt FROM staff_attendance_logs WHERE tenant_id = @tenantId AND branch_id = @branchId AND staff_id = @staffId AND status = 'clocked_in' ORDER BY created_at DESC LIMIT 1`).get(scope);
  if (action === "clock_in" && open?.status === "clocked_in") return { reason: "already_clocked_in", attendanceId: open.id };
  if (action === "clock_out" && (!open || open.status !== "clocked_in")) return { reason: "no_open_attendance", attendanceId: attendanceId || "" };
  if (action === "clock_out" && Date.parse(capturedAt) < Date.parse(open.clockInAt)) return { reason: "clock_out_before_clock_in", attendanceId: open.id };
  return { reason: "", attendanceId: action === "clock_out" ? open.id : "", businessDate: businessDate(new Date(capturedAt)) };
}

export class MobileAttendanceVerificationService {
  assertNormalPunchAllowed(action, access) {
    if (!access?.staffId) return;
    const scope = staffScope(access); const policy = presentPolicy(policyRow(scope.tenantId, scope.branchId), scope.branchId);
    if (enforcement(policy, action)) throw forbidden("Owner policy requires an online verified attendance punch for this action");
  }

  staffPolicy(access) {
    const scope = staffScope(access); const policy = presentPolicy(policyRow(scope.tenantId, scope.branchId), scope.branchId);
    return { ...policy, enforcementRequired: policy.clockInEnforced || policy.clockOutEnforced, onlineOnly: true, normalFlowWhenNotEnforced: "/api/v1/staff-os/attendance/clock-in|clock-out" };
  }

  staffDevice(access, query = {}) {
    const scope = staffScope(access);
    const deviceId = text(query.deviceId);
    const row = db.prepare(`SELECT id, deviceId, deviceLabel, platform, status, version, approvedAt, revokedAt, createdAt, updatedAt FROM staffAttendanceDeviceKeys WHERE tenantId = @tenantId AND branchId = @branchId AND staffId = @staffId AND (@deviceId = '' OR deviceId = @deviceId) ORDER BY updatedAt DESC LIMIT 1`).get({ ...scope, deviceId });
    if (!row) throw notFound("Attendance device not found");
    return { ...row, trusted: row.status === "trusted", approved: row.status === "trusted", denied: row.status === "revoked" };
  }

  registerDevice(payload, access) {
    const scope = staffScope(access); const deviceId = text(payload.deviceId); const deviceLabel = text(payload.deviceLabel).slice(0, 120); const platform = text(payload.platform).slice(0, 40);
    if (!deviceId || deviceId.length > 200) throw badRequest("deviceId is required");
    publicKeyFromSpki(payload.publicKeySpkiBase64);
    const keyBase64 = text(payload.publicKeySpkiBase64); const stamp = now();
    const saved = db.transaction(() => {
      const existing = db.prepare(`SELECT * FROM staffAttendanceDeviceKeys WHERE tenantId = @tenantId AND branchId = @branchId AND staffId = @staffId AND deviceId = @deviceId`).get({ ...scope, deviceId });
      if (existing?.status === "revoked") throw conflict("This device was revoked; the owner must explicitly review a new device registration");
      if (existing) {
        const sameKey = existing.publicKeySpkiBase64 === keyBase64;
        db.prepare(`UPDATE staffAttendanceDeviceKeys SET deviceLabel = @deviceLabel, platform = @platform, publicKeySpkiBase64 = @publicKeySpkiBase64, status = CASE WHEN @sameKey = 1 THEN status ELSE 'pending' END, approvedBy = CASE WHEN @sameKey = 1 THEN approvedBy ELSE '' END, approvedAt = CASE WHEN @sameKey = 1 THEN approvedAt ELSE NULL END, version = version + 1, updatedAt = @updatedAt WHERE id = @id`).run({ id: existing.id, deviceLabel, platform, publicKeySpkiBase64: keyBase64, sameKey: sameKey ? 1 : 0, updatedAt: stamp });
        return existing.id;
      }
      const keyId = id("attDevice");
      db.prepare(`INSERT INTO staffAttendanceDeviceKeys (id, tenantId, branchId, staffId, deviceId, deviceLabel, platform, publicKeySpkiBase64, status, version, createdAt, updatedAt) VALUES (@id, @tenantId, @branchId, @staffId, @deviceId, @deviceLabel, @platform, @publicKeySpkiBase64, 'pending', 1, @createdAt, @updatedAt)`).run({ id: keyId, ...scope, deviceId, deviceLabel, platform, publicKeySpkiBase64: keyBase64, createdAt: stamp, updatedAt: stamp });
      return keyId;
    })();
    emit("attendance.device.registered", { id: saved, staffId: scope.staffId }, scope);
    const registered = db.prepare(`SELECT id, deviceId, deviceLabel, platform, status, version, createdAt, updatedAt FROM staffAttendanceDeviceKeys WHERE id = @id AND tenantId = @tenantId`).get({ id: saved, tenantId: scope.tenantId });
    return { ...registered, trusted: registered.status === "trusted", approved: registered.status === "trusted", denied: registered.status === "revoked" };
  }

  createChallenge(payload, access) {
    const scope = staffScope(access); const action = text(payload.action); const deviceId = text(payload.deviceId);
    if (!ACTIONS.has(action)) throw badRequest("action must be clock_in or clock_out");
    if (action === "clock_in" && text(payload.attendanceId)) throw badRequest("attendanceId is valid only for clock_out");
    const policy = presentPolicy(policyRow(scope.tenantId, scope.branchId), scope.branchId);
    if (!enforcement(policy, action)) return { enforcementRequired: false, action, onlineOnly: true, normalPunchEndpoint: `/api/v1/staff-os/attendance/${action === "clock_in" ? "clock-in" : "clock-out"}` };
    const device = db.prepare(`SELECT * FROM staffAttendanceDeviceKeys WHERE tenantId = @tenantId AND branchId = @branchId AND staffId = @staffId AND deviceId = @deviceId`).get({ ...scope, deviceId });
    if (!device || device.status !== "trusted") throw forbidden(device?.status === "revoked" ? "The attendance device is revoked" : "An owner-approved trusted device is required");
    const latitude = number(payload.latitude, "latitude", -90, 90); const longitude = number(payload.longitude, "longitude", -180, 180); const accuracyMeters = number(payload.accuracyMeters, "accuracyMeters", 0, 10000);
    const captured = new Date(payload.capturedAt); const age = Date.now() - captured.getTime();
    if (!Number.isFinite(captured.getTime()) || age < -30000 || age > 120000) throw badRequest("capturedAt must be a fresh online location capture within 2 minutes");
    if (policy.latitude === null || policy.longitude === null) throw conflict("The enforced attendance policy has no branch coordinates");
    const state = attendanceState(scope, action, text(payload.attendanceId), captured.toISOString());
    if (state.reason) throw conflict(state.reason === "already_clocked_in" ? "Staff is already clocked in" : "No matching open attendance exists");
    const challengeId = id("attChallenge"); const nonce = randomBytes(32).toString("base64url"); const expiresAt = new Date(Date.now() + 120000).toISOString();
    const snapshot = { ...policy }; const bound = { challengeId, nonce, tenantId: scope.tenantId, branchId: scope.branchId, staffId: scope.staffId, deviceId, action, attendanceId: state.attendanceId, latitude, longitude, accuracyMeters, capturedAt: captured.toISOString(), policyVersion: policy.version };
    const signingPayload = JSON.stringify(bound); const locationHash = createHash("sha256").update(JSON.stringify({ latitude, longitude, accuracyMeters, capturedAt: captured.toISOString() })).digest("hex");
    db.prepare(`INSERT INTO attendancePunchChallenges (id, tenantId, branchId, staffId, deviceId, action, attendanceId, nonce, locationHash, boundCapturePayload, policyVersion, expiresAt, createdAt) VALUES (@id, @tenantId, @branchId, @staffId, @deviceId, @action, @attendanceId, @nonce, @locationHash, @boundCapturePayload, @policyVersion, @expiresAt, @createdAt)`).run({ id: challengeId, ...scope, deviceId, action, attendanceId: state.attendanceId, nonce, locationHash, boundCapturePayload: JSON.stringify({ signingPayload, policySnapshot: snapshot }), policyVersion: policy.version, expiresAt, createdAt: now() });
    const signingPayloadBase64 = Buffer.from(signingPayload, "utf8").toString("base64");
    return { enforcementRequired: true, challengeId, expiresAt, algorithm: "SHA256withECDSA", signingPayloadBase64, nonceBase64: signingPayloadBase64 };
  }

  verifiedPunch(payload, access) {
    const scope = staffScope(access); const challengeId = text(payload.challengeId); const deviceId = text(payload.deviceId);
    if (!challengeId || !deviceId) throw badRequest("challengeId and deviceId are required");
    let signature = null;
    try { signature = strictBase64(payload.signatureBase64, "signatureBase64", 512); } catch { /* Persist this as a rejected punch attempt below. */ }
    const outcome = db.transaction(() => {
      const challenge = db.prepare(`SELECT * FROM attendancePunchChallenges WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId AND staffId = @staffId`).get({ id: challengeId, ...scope });
      if (!challenge) return { status: 404, reason: "challenge_not_found" };
      const bound = json(challenge.boundCapturePayload, {}); const capture = json(bound.signingPayload, {}); const policy = presentPolicy(policyRow(scope.tenantId, scope.branchId), scope.branchId); const snapshot = bound.policySnapshot || policy;
      const device = db.prepare(`SELECT * FROM staffAttendanceDeviceKeys WHERE tenantId = @tenantId AND branchId = @branchId AND staffId = @staffId AND deviceId = @deviceId`).get({ ...scope, deviceId });
      const evidenceBase = { ...scope, deviceKeyId: device?.id || "", deviceId, challengeId, attemptedAction: challenge.action, capturedAt: capture.capturedAt || challenge.createdAt, latitude: capture.latitude ?? null, longitude: capture.longitude ?? null, accuracyMeters: capture.accuracyMeters ?? null, serverDistanceMeters: null, policySnapshot: JSON.stringify(snapshot), policyVersion: challenge.policyVersion, biometricSignatureValid: 0, attendanceId: "" };
      const consume = db.prepare(`UPDATE attendancePunchChallenges SET usedAt = @usedAt WHERE id = @id AND tenantId = @tenantId AND usedAt IS NULL`).run({ usedAt: now(), id: challenge.id, tenantId: scope.tenantId });
      let reason = ""; let signatureValid = false; let distance = null;
      if (consume.changes !== 1) reason = "challenge_replayed";
      else if (!signature) reason = "invalid_signature_encoding";
      else if (challenge.deviceId !== deviceId || capture.deviceId !== deviceId) reason = "device_mismatch";
      else if (!device || device.status !== "trusted") reason = device?.status === "revoked" ? "device_revoked" : "device_not_trusted";
      else if (Date.parse(challenge.expiresAt) < Date.now() || Date.now() - Date.parse(capture.capturedAt) > 120000) reason = "challenge_or_location_stale";
      else if (!enforcement(policy, challenge.action) || policy.version !== challenge.policyVersion) reason = "policy_changed";
      else {
        try { signatureValid = verify("sha256", Buffer.from(bound.signingPayload, "utf8"), publicKeyFromSpki(device.publicKeySpkiBase64), signature); } catch { signatureValid = false; }
        if (!signatureValid) reason = "invalid_biometric_signature";
      }
      if (!reason) {
        if (!Number.isFinite(capture.latitude) || !Number.isFinite(capture.longitude) || !Number.isFinite(capture.accuracyMeters)) reason = "invalid_location";
        else if (capture.accuracyMeters > policy.maxAccuracyMeters) reason = "location_accuracy_exceeded";
        else {
          distance = haversineMeters(capture.latitude, capture.longitude, policy.latitude, policy.longitude);
          if (distance > policy.radiusMeters) reason = "outside_attendance_radius";
        }
      }
      if (!reason) reason = attendanceState(scope, challenge.action, challenge.attendanceId, capture.capturedAt).reason;
      if (reason) {
        const evidence = insertEvidence({ ...evidenceBase, serverDistanceMeters: distance, biometricSignatureValid: signatureValid ? 1 : 0, decision: "rejected", reason });
        return { status: reason === "challenge_replayed" ? 409 : 403, reason, evidence };
      }
      const attendancePayload = { staffId: scope.staffId, branchId: scope.branchId, attendanceId: challenge.attendanceId, businessDate: businessDate(new Date(capture.capturedAt)), ...(challenge.action === "clock_in" ? { clockInAt: capture.capturedAt } : { clockOutAt: capture.capturedAt }), source: "mobile_verified", gpsLat: capture.latitude, gpsLng: capture.longitude, deviceId };
      const verifiedAccess = { ...access, branchId: scope.branchId, attendanceVerificationApproved: true };
      const attendance = challenge.action === "clock_in" ? staffOsService.clockIn(attendancePayload, verifiedAccess) : staffOsService.clockOut(attendancePayload, verifiedAccess);
      const evidence = insertEvidence({ ...evidenceBase, serverDistanceMeters: distance, biometricSignatureValid: 1, decision: "accepted", reason: "verified", attendanceId: attendance.id });
      return { status: 200, attendance, evidence };
    })();
    if (!outcome.evidence) throw notFound("Attendance challenge not found");
    emit("attendance.verification.decided", { evidenceId: outcome.evidence.id, staffId: scope.staffId, decision: outcome.evidence.decision, reason: outcome.reason || "verified", attendanceId: outcome.attendance?.id || "" }, scope);
    if (outcome.reason) {
      const error = outcome.status === 409 ? conflict("Attendance verification was rejected", { reason: outcome.reason, evidenceId: outcome.evidence.id }) : forbidden("Attendance verification was rejected");
      error.details = { reason: outcome.reason, evidenceId: outcome.evidence.id };
      throw error;
    }
    return { attendance: outcome.attendance, evidence: evidenceView(outcome.evidence) };
  }

  ownerPolicy(access, branchId) { const scopedBranch = assertOwnerBranch(access, branchId); return presentPolicy(policyRow(access.tenantId, scopedBranch), scopedBranch); }

  updateOwnerPolicy(payload, access, branchId) {
    const scopedBranch = assertOwnerBranch(access, branchId); const current = policyRow(access.tenantId, scopedBranch); const version = Number(payload.version ?? 0);
    if (current && version !== Number(current.version)) throw conflict("Attendance policy was updated by another request");
    const requestedStatus = text(payload.status || "disabled");
    const policy = { id: current?.id || id("attPolicy"), tenantId: access.tenantId, branchId: scopedBranch, latitude: payload.latitude === null ? null : number(payload.latitude, "latitude", -90, 90), longitude: payload.longitude === null ? null : number(payload.longitude, "longitude", -180, 180), radiusMeters: number(payload.radiusMeters ?? 50, "radiusMeters", 25, 500), maxAccuracyMeters: number(payload.maxAccuracyMeters ?? 50, "maxAccuracyMeters", 1, 500), biometricRequired: bool(payload.biometricRequired ?? payload.requireBiometric, true) ? 1 : 0, locationRequired: bool(payload.locationRequired ?? payload.requireLocation, true) ? 1 : 0, clockInEnforced: bool(payload.clockInEnforced ?? payload.enforceClockIn) ? 1 : 0, clockOutEnforced: bool(payload.clockOutEnforced ?? payload.enforceClockOut) ? 1 : 0, status: requestedStatus === "enabled" ? "active" : requestedStatus, userId: access.userId || "", stamp: now() };
    if (!['active', 'disabled'].includes(policy.status)) throw badRequest("status must be active or disabled");
    if (policy.status === "active" && (policy.clockInEnforced || policy.clockOutEnforced) && (policy.latitude === null || policy.longitude === null || !policy.locationRequired || !policy.biometricRequired)) throw badRequest("Enforced mobile attendance requires branch coordinates, location, and biometric signature verification");
    if (current) db.prepare(`UPDATE attendanceLocationPolicies SET latitude=@latitude, longitude=@longitude, radiusMeters=@radiusMeters, maxAccuracyMeters=@maxAccuracyMeters, biometricRequired=@biometricRequired, locationRequired=@locationRequired, clockInEnforced=@clockInEnforced, clockOutEnforced=@clockOutEnforced, status=@status, version=version+1, updatedBy=@userId, updatedAt=@stamp WHERE id=@id AND tenantId=@tenantId AND branchId=@branchId`).run(policy);
    else db.prepare(`INSERT INTO attendanceLocationPolicies (id, tenantId, branchId, latitude, longitude, radiusMeters, maxAccuracyMeters, biometricRequired, locationRequired, clockInEnforced, clockOutEnforced, status, version, createdBy, updatedBy, createdAt, updatedAt) VALUES (@id,@tenantId,@branchId,@latitude,@longitude,@radiusMeters,@maxAccuracyMeters,@biometricRequired,@locationRequired,@clockInEnforced,@clockOutEnforced,@status,1,@userId,@userId,@stamp,@stamp)`).run(policy);
    emit("attendance.policy.updated", { branchId: scopedBranch }, { tenantId: access.tenantId, branchId: scopedBranch });
    return this.ownerPolicy(access, scopedBranch);
  }

  ownerDevices(access, query = {}) {
    const branches = ownerBranches(access); const branchId = text(query.branchId); if (branchId) assertOwnerBranch(access, branchId);
    const params = { tenantId: access.tenantId, branchId, staffId: text(query.staffId), status: text(query.status) };
    const branchSlots = branches.map((value, index) => { params[`ownerBranch${index}`] = value; return `@ownerBranch${index}`; });
    const items = db.prepare(`SELECT d.id, d.branchId, d.staffId, COALESCE(sm.full_name, s.name, 'Staff') AS staffName, d.deviceId, d.deviceLabel, d.platform, d.publicKeySpkiBase64, d.status, d.version, d.approvedBy, d.approvedAt, d.revokedBy, d.revokedAt, d.createdAt, d.updatedAt, (SELECT MAX(c.usedAt) FROM attendancePunchChallenges c WHERE c.tenantId=d.tenantId AND c.branchId=d.branchId AND c.staffId=d.staffId AND c.deviceId=d.deviceId) AS lastUsedAt FROM staffAttendanceDeviceKeys d LEFT JOIN staff_master sm ON sm.tenant_id=d.tenantId AND sm.id=d.staffId LEFT JOIN staff s ON s.tenantId=d.tenantId AND s.id=d.staffId WHERE d.tenantId=@tenantId AND d.branchId IN (${branchSlots.join(",")}) AND (@branchId='' OR d.branchId=@branchId) AND (@staffId='' OR d.staffId=@staffId) AND (@status='' OR d.status=@status) ORDER BY d.updatedAt DESC`).all(params).map((row) => {
      const { publicKeySpkiBase64, ...safe } = row;
      return { ...safe, publicKeyFingerprint: createHash("sha256").update(Buffer.from(publicKeySpkiBase64, "base64")).digest("hex"), registeredAt: row.createdAt };
    });
    return { items };
  }

  updateDeviceStatus(deviceKeyId, payload, access) {
    const status = text(payload.status); if (!DEVICE_STATUSES.has(status)) throw badRequest("status must be trusted or revoked");
    const row = db.prepare(`SELECT * FROM staffAttendanceDeviceKeys WHERE id=@id AND tenantId=@tenantId`).get({ id: deviceKeyId, tenantId: access.tenantId }); if (!row) throw notFound("Attendance device not found"); assertOwnerBranch(access, row.branchId);
    if (Number(payload.version) !== Number(row.version)) throw conflict("Attendance device was updated by another request"); const stamp = now();
    db.prepare(`UPDATE staffAttendanceDeviceKeys SET status=@status, approvedBy=CASE WHEN @status='trusted' THEN @userId ELSE approvedBy END, approvedAt=CASE WHEN @status='trusted' THEN @stamp ELSE approvedAt END, revokedBy=CASE WHEN @status='revoked' THEN @userId ELSE '' END, revokedAt=CASE WHEN @status='revoked' THEN @stamp ELSE NULL END, version=version+1, updatedAt=@stamp WHERE id=@id AND tenantId=@tenantId`).run({ id: row.id, tenantId: access.tenantId, status, userId: access.userId || "", stamp });
    emit("attendance.device.status_updated", { id: row.id, staffId: row.staffId, status }, row);
    return this.ownerDevices(access, { branchId: row.branchId, staffId: row.staffId }).items.find((item) => item.id === row.id);
  }

  ownerEvidence(access, query = {}) {
    const branches = ownerBranches(access); const branchId = text(query.branchId); if (branchId) assertOwnerBranch(access, branchId);
    const decision = text(query.decision); const params = { tenantId: access.tenantId, branchId, staffId: text(query.staffId), date: text(query.date), from: text(query.from), to: text(query.to), decision: decision === "overridden" ? "" : decision, overriddenOnly: decision === "overridden" ? 1 : 0 };
    const branchSlots = branches.map((value, index) => { params[`ownerBranch${index}`] = value; return `@ownerBranch${index}`; });
    const items = db.prepare(`SELECT e.*, COALESCE(sm.full_name, s.name, 'Staff') AS staffName FROM attendancePunchEvidence e LEFT JOIN staff_master sm ON sm.tenant_id=e.tenantId AND sm.id=e.staffId LEFT JOIN staff s ON s.tenantId=e.tenantId AND s.id=e.staffId WHERE e.tenantId=@tenantId AND e.branchId IN (${branchSlots.join(",")}) AND (@branchId='' OR e.branchId=@branchId) AND (@staffId='' OR e.staffId=@staffId) AND (@date='' OR date(e.capturedAt, '+5 hours', '+30 minutes')=@date) AND (@from='' OR date(e.capturedAt, '+5 hours', '+30 minutes')>=@from) AND (@to='' OR date(e.capturedAt, '+5 hours', '+30 minutes')<=@to) AND (@decision='' OR e.decision=@decision) AND (@overriddenOnly=0 OR e.ownerOverrideAt IS NOT NULL) ORDER BY e.capturedAt DESC LIMIT 500`).all(params).map(evidenceView);
    return { items };
  }

  overrideEvidence(evidenceId, payload, access) {
    const reason = text(payload.reason); if (!reason) throw badRequest("An override reason is required");
    const result = db.transaction(() => {
      const evidence = db.prepare(`SELECT e.*, c.attendanceId AS boundAttendanceId FROM attendancePunchEvidence e LEFT JOIN attendancePunchChallenges c ON c.id=e.challengeId AND c.tenantId=e.tenantId WHERE e.id=@id AND e.tenantId=@tenantId`).get({ id: evidenceId, tenantId: access.tenantId });
      if (!evidence) throw notFound("Attendance evidence not found"); assertOwnerBranch(access, evidence.branchId);
      if (evidence.decision !== "rejected") throw conflict("Only rejected evidence can be overridden"); if (evidence.ownerOverrideAt) throw conflict("This evidence was already overridden");
      const state = attendanceState(evidence, evidence.attemptedAction, evidence.boundAttendanceId, evidence.capturedAt); if (state.reason) throw conflict(`Override cannot create an invalid attendance state: ${state.reason}`);
      const attendancePayload = { staffId: evidence.staffId, branchId: evidence.branchId, attendanceId: evidence.boundAttendanceId, businessDate: businessDate(new Date(evidence.capturedAt)), ...(evidence.attemptedAction === "clock_in" ? { clockInAt: evidence.capturedAt } : { clockOutAt: evidence.capturedAt }), source: "owner_verified_override", gpsLat: evidence.latitude, gpsLng: evidence.longitude, deviceId: evidence.deviceId };
      const delegatedAccess = { ...access, branchId: evidence.branchId, requestedBranchId: evidence.branchId };
      const attendance = evidence.attemptedAction === "clock_in" ? staffOsService.clockIn(attendancePayload, delegatedAccess) : staffOsService.clockOut(attendancePayload, delegatedAccess); const stamp = now();
      db.prepare(`UPDATE attendancePunchEvidence SET attendanceId=@attendanceId, ownerOverrideBy=@ownerOverrideBy, ownerOverrideReason=@ownerOverrideReason, ownerOverrideAt=@ownerOverrideAt WHERE id=@id AND tenantId=@tenantId AND decision='rejected' AND ownerOverrideAt IS NULL`).run({ attendanceId: attendance.id, ownerOverrideBy: access.userId || "", ownerOverrideReason: reason, ownerOverrideAt: stamp, id: evidence.id, tenantId: access.tenantId });
      return { attendance, evidence: { ...evidence, attendanceId: attendance.id, ownerOverrideBy: access.userId || "", ownerOverrideReason: reason, ownerOverrideAt: stamp } };
    })();
    emit("attendance.evidence.overridden", { evidenceId, attendanceId: result.attendance.id, staffId: result.evidence.staffId }, result.evidence);
    return { attendance: result.attendance, evidence: evidenceView(result.evidence) };
  }

  enrichAttendanceResult(result, access) {
    const attendanceItems = Array.isArray(result?.items) ? result.items : result?.attendance ? [result.attendance] : [];
    if (!attendanceItems.length) return result;
    const evidence = new Map();
    for (const item of attendanceItems) {
      const row = db.prepare(`SELECT * FROM attendancePunchEvidence WHERE tenantId=@tenantId AND branchId=@branchId AND attendanceId=@attendanceId ORDER BY createdAt DESC LIMIT 1`).get({ tenantId: access.tenantId, branchId: item.branchId, attendanceId: item.id });
      if (row) evidence.set(item.id, evidenceView(row));
    }
    if (result.attendance) return { ...result, attendance: { ...result.attendance, verificationEvidence: evidence.get(result.attendance.id) || null } };
    return { ...result, items: result.items.map((item) => ({ ...item, verificationEvidence: evidence.get(item.id) || null })) };
  }
}

export const mobileAttendanceVerificationService = new MobileAttendanceVerificationService();
