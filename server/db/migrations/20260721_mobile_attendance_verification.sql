CREATE TABLE IF NOT EXISTS attendanceVerificationPolicies (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  radiusMeters INTEGER NOT NULL DEFAULT 50 CHECK (radiusMeters BETWEEN 10 AND 1000),
  maxAccuracyMeters INTEGER NOT NULL DEFAULT 25 CHECK (maxAccuracyMeters BETWEEN 1 AND 500),
  enforceClockIn INTEGER NOT NULL DEFAULT 0 CHECK (enforceClockIn IN (0, 1)),
  enforceClockOut INTEGER NOT NULL DEFAULT 0 CHECK (enforceClockOut IN (0, 1)),
  requireVerifiedAttestation INTEGER NOT NULL DEFAULT 0 CHECK (requireVerifiedAttestation IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('active', 'disabled')),
  version INTEGER NOT NULL DEFAULT 1,
  retentionClass TEXT NOT NULL DEFAULT 'policy',
  createdBy TEXT NOT NULL DEFAULT '',
  updatedBy TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (tenantId, branchId)
);

CREATE TABLE IF NOT EXISTS attendanceTrustedDevices (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  staffId TEXT NOT NULL,
  deviceId TEXT NOT NULL,
  deviceLabel TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  publicKeySpkiBase64 TEXT NOT NULL,
  keyFingerprint TEXT NOT NULL,
  publicKeyAlgorithm TEXT NOT NULL DEFAULT 'ECDSA_P256_SHA256',
  hardwareBackedClaim INTEGER NOT NULL DEFAULT 0 CHECK (hardwareBackedClaim IN (0, 1)),
  verificationCapability TEXT NOT NULL DEFAULT 'biometric_or_device_credential',
  attestationStatus TEXT NOT NULL DEFAULT 'unverified' CHECK (attestationStatus IN ('unverified', 'verified')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'revoked')),
  version INTEGER NOT NULL DEFAULT 1,
  approvedBy TEXT NOT NULL DEFAULT '',
  approvedAt TEXT,
  revokedBy TEXT NOT NULL DEFAULT '',
  revokedAt TEXT,
  retentionClass TEXT NOT NULL DEFAULT 'device-registration',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (tenantId, branchId, staffId, deviceId)
);

CREATE TABLE IF NOT EXISTS attendanceVerificationChallenges (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  staffId TEXT NOT NULL,
  deviceKeyId TEXT NOT NULL,
  deviceId TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('clock_in', 'clock_out')),
  attendanceId TEXT NOT NULL DEFAULT '',
  nonce TEXT NOT NULL UNIQUE,
  signingPayload TEXT NOT NULL,
  policySnapshot TEXT NOT NULL,
  policyVersion INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracyMeters REAL NOT NULL,
  capturedAt TEXT NOT NULL,
  mockLocation INTEGER NOT NULL DEFAULT 0 CHECK (mockLocation IN (0, 1)),
  integrityVerdict TEXT NOT NULL DEFAULT 'not_provided',
  expiresAt TEXT NOT NULL,
  usedAt TEXT,
  clientPunchId TEXT NOT NULL DEFAULT '',
  idempotencyKey TEXT NOT NULL DEFAULT '',
  evidenceId TEXT NOT NULL DEFAULT '',
  resultDecision TEXT NOT NULL DEFAULT '',
  resultReason TEXT NOT NULL DEFAULT '',
  resultJson TEXT NOT NULL DEFAULT '',
  retainUntil TEXT NOT NULL,
  retentionClass TEXT NOT NULL DEFAULT 'short-lived-challenge',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendanceVerificationEvidence (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  staffId TEXT NOT NULL,
  deviceKeyId TEXT NOT NULL DEFAULT '',
  deviceId TEXT NOT NULL,
  keyFingerprint TEXT NOT NULL DEFAULT '',
  challengeId TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL CHECK (action IN ('clock_in', 'clock_out')),
  attendanceId TEXT NOT NULL DEFAULT '',
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracyMeters REAL NOT NULL,
  serverDistanceMeters REAL,
  capturedAt TEXT NOT NULL,
  mockLocation INTEGER NOT NULL DEFAULT 0 CHECK (mockLocation IN (0, 1)),
  integrityVerdict TEXT NOT NULL DEFAULT 'not_provided',
  deviceUserVerification TEXT NOT NULL DEFAULT 'ecdsa-p256',
  signatureValid INTEGER NOT NULL DEFAULT 0 CHECK (signatureValid IN (0, 1)),
  policySnapshot TEXT NOT NULL,
  policyVersion INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  reason TEXT NOT NULL,
  retainUntil TEXT NOT NULL,
  retentionClass TEXT NOT NULL DEFAULT 'attendance-security-evidence',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendanceDeviceReviews (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  staffId TEXT NOT NULL,
  deviceKeyId TEXT NOT NULL,
  deviceId TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'revoked')),
  reason TEXT NOT NULL,
  reviewedBy TEXT NOT NULL,
  deviceSnapshot TEXT NOT NULL,
  retainUntil TEXT NOT NULL,
  retentionClass TEXT NOT NULL DEFAULT 'attendance-device-review',
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idxAttendanceVerificationPolicyScope ON attendanceVerificationPolicies(tenantId, branchId, status);
CREATE INDEX IF NOT EXISTS idxAttendanceTrustedDeviceScope ON attendanceTrustedDevices(tenantId, branchId, staffId, status);
CREATE INDEX IF NOT EXISTS idxAttendanceChallengeExpiry ON attendanceVerificationChallenges(tenantId, branchId, staffId, expiresAt, usedAt);
CREATE INDEX IF NOT EXISTS idxAttendanceChallengeRetention ON attendanceVerificationChallenges(retainUntil);
CREATE INDEX IF NOT EXISTS idxAttendanceEvidenceScope ON attendanceVerificationEvidence(tenantId, branchId, staffId, createdAt, decision);
CREATE INDEX IF NOT EXISTS idxAttendanceEvidenceAttendance ON attendanceVerificationEvidence(tenantId, branchId, attendanceId);
CREATE INDEX IF NOT EXISTS idxAttendanceEvidenceRetention ON attendanceVerificationEvidence(retainUntil);
CREATE INDEX IF NOT EXISTS idxAttendanceDeviceReviewScope ON attendanceDeviceReviews(tenantId, branchId, deviceKeyId, createdAt);
CREATE INDEX IF NOT EXISTS idxAttendanceDeviceReviewRetention ON attendanceDeviceReviews(retainUntil);

CREATE TRIGGER IF NOT EXISTS attendanceEvidenceNoUpdate
BEFORE UPDATE ON attendanceVerificationEvidence
BEGIN SELECT RAISE(ABORT, 'attendance verification evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS attendanceEvidenceNoDelete
BEFORE DELETE ON attendanceVerificationEvidence
BEGIN SELECT RAISE(ABORT, 'attendance verification evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS attendanceDeviceReviewNoUpdate
BEFORE UPDATE ON attendanceDeviceReviews
BEGIN SELECT RAISE(ABORT, 'attendance device review is immutable'); END;

CREATE TRIGGER IF NOT EXISTS attendanceDeviceReviewNoDelete
BEFORE DELETE ON attendanceDeviceReviews
BEGIN SELECT RAISE(ABORT, 'attendance device review is immutable'); END;
