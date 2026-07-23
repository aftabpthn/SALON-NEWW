-- Owner-controlled, online-only mobile attendance verification.

CREATE TABLE IF NOT EXISTS attendanceLocationPolicies (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  radiusMeters INTEGER NOT NULL DEFAULT 50 CHECK (radiusMeters BETWEEN 25 AND 500),
  maxAccuracyMeters INTEGER NOT NULL DEFAULT 50 CHECK (maxAccuracyMeters BETWEEN 1 AND 500),
  biometricRequired INTEGER NOT NULL DEFAULT 1 CHECK (biometricRequired IN (0, 1)),
  locationRequired INTEGER NOT NULL DEFAULT 1 CHECK (locationRequired IN (0, 1)),
  clockInEnforced INTEGER NOT NULL DEFAULT 0 CHECK (clockInEnforced IN (0, 1)),
  clockOutEnforced INTEGER NOT NULL DEFAULT 0 CHECK (clockOutEnforced IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('active', 'disabled')),
  version INTEGER NOT NULL DEFAULT 1,
  createdBy TEXT NOT NULL DEFAULT '',
  updatedBy TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (tenantId, branchId)
);

CREATE TABLE IF NOT EXISTS staffAttendanceDeviceKeys (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  staffId TEXT NOT NULL,
  deviceId TEXT NOT NULL,
  deviceLabel TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  publicKeySpkiBase64 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'trusted', 'revoked')),
  version INTEGER NOT NULL DEFAULT 1,
  approvedBy TEXT NOT NULL DEFAULT '',
  approvedAt TEXT,
  revokedBy TEXT NOT NULL DEFAULT '',
  revokedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (tenantId, branchId, staffId, deviceId)
);

CREATE TABLE IF NOT EXISTS attendancePunchChallenges (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  staffId TEXT NOT NULL,
  deviceId TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('clock_in', 'clock_out')),
  attendanceId TEXT NOT NULL DEFAULT '',
  nonce TEXT NOT NULL UNIQUE,
  locationHash TEXT NOT NULL,
  boundCapturePayload TEXT NOT NULL,
  policyVersion INTEGER NOT NULL,
  expiresAt TEXT NOT NULL,
  usedAt TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendancePunchEvidence (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  staffId TEXT NOT NULL,
  deviceKeyId TEXT NOT NULL DEFAULT '',
  deviceId TEXT NOT NULL,
  challengeId TEXT NOT NULL DEFAULT '',
  attemptedAction TEXT NOT NULL CHECK (attemptedAction IN ('clock_in', 'clock_out')),
  capturedAt TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  accuracyMeters REAL,
  serverDistanceMeters REAL,
  policySnapshot TEXT NOT NULL,
  policyVersion INTEGER NOT NULL,
  biometricSignatureValid INTEGER NOT NULL DEFAULT 0 CHECK (biometricSignatureValid IN (0, 1)),
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  reason TEXT NOT NULL DEFAULT '',
  attendanceId TEXT NOT NULL DEFAULT '',
  ownerOverrideBy TEXT NOT NULL DEFAULT '',
  ownerOverrideReason TEXT NOT NULL DEFAULT '',
  ownerOverrideAt TEXT,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idxAttendancePoliciesScope ON attendanceLocationPolicies(tenantId, branchId, status);
CREATE INDEX IF NOT EXISTS idxAttendanceDevicesScope ON staffAttendanceDeviceKeys(tenantId, branchId, staffId, status);
CREATE INDEX IF NOT EXISTS idxAttendanceChallengesScope ON attendancePunchChallenges(tenantId, branchId, staffId, expiresAt, usedAt);
CREATE INDEX IF NOT EXISTS idxAttendanceEvidenceScope ON attendancePunchEvidence(tenantId, branchId, staffId, capturedAt, decision);
CREATE INDEX IF NOT EXISTS idxAttendanceEvidenceAttendance ON attendancePunchEvidence(tenantId, branchId, attendanceId);

CREATE TRIGGER IF NOT EXISTS protectAttendancePunchEvidence
BEFORE UPDATE OF tenantId, branchId, staffId, deviceKeyId, deviceId, challengeId, attemptedAction,
  capturedAt, latitude, longitude, accuracyMeters, serverDistanceMeters, policySnapshot,
  policyVersion, biometricSignatureValid, decision, reason, createdAt
ON attendancePunchEvidence
BEGIN
  SELECT RAISE(ABORT, 'attendance punch evidence is immutable');
END;
