import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.js";

const migrationPath = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations", "20260721_mobile_attendance_verification.sql");
let ensured = false;

function addColumn(table, definition) {
  const column = definition.split(/\s+/, 1)[0];
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

export function ensureAttendanceVerificationSchema() {
  if (ensured) return;
  db.exec(readFileSync(migrationPath, "utf8"));
  addColumn("attendanceVerificationPolicies", "requireVerifiedAttestation INTEGER NOT NULL DEFAULT 0 CHECK (requireVerifiedAttestation IN (0, 1))");
  addColumn("attendanceTrustedDevices", "publicKeyAlgorithm TEXT NOT NULL DEFAULT 'ECDSA_P256_SHA256'");
  addColumn("attendanceTrustedDevices", "hardwareBackedClaim INTEGER NOT NULL DEFAULT 0 CHECK (hardwareBackedClaim IN (0, 1))");
  addColumn("attendanceTrustedDevices", "verificationCapability TEXT NOT NULL DEFAULT 'biometric_or_device_credential'");
  addColumn("attendanceTrustedDevices", "attestationStatus TEXT NOT NULL DEFAULT 'unverified' CHECK (attestationStatus IN ('unverified', 'verified'))");
  addColumn("attendanceTrustedDevices", "attestationChain TEXT NOT NULL DEFAULT ''");
  addColumn("attendanceVerificationChallenges", "clientPunchId TEXT NOT NULL DEFAULT ''");
  addColumn("attendanceVerificationChallenges", "idempotencyKey TEXT NOT NULL DEFAULT ''");
  addColumn("attendanceVerificationChallenges", "evidenceId TEXT NOT NULL DEFAULT ''");
  addColumn("attendanceVerificationChallenges", "resultDecision TEXT NOT NULL DEFAULT ''");
  addColumn("attendanceVerificationChallenges", "resultReason TEXT NOT NULL DEFAULT ''");
  addColumn("attendanceVerificationChallenges", "resultJson TEXT NOT NULL DEFAULT ''");
  addColumn("attendanceVerificationChallenges", "integrityToken TEXT NOT NULL DEFAULT ''");
  addColumn("attendanceVerificationEvidence", "integrityToken TEXT NOT NULL DEFAULT ''");
  addColumn("attendanceVerificationChallenges", "riskVerdict TEXT NOT NULL DEFAULT ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idxAttendanceChallengeClientPunch ON attendanceVerificationChallenges(tenantId, branchId, staffId, clientPunchId) WHERE clientPunchId <> ''");
  ensured = true;
}
