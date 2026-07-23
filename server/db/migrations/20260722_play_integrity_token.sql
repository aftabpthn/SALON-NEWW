-- P1: Add integrityToken column to store Play Integrity API JWS token
ALTER TABLE attendanceVerificationChallenges ADD COLUMN integrityToken TEXT NOT NULL DEFAULT '';
ALTER TABLE attendanceVerificationEvidence ADD COLUMN integrityToken TEXT NOT NULL DEFAULT '';

-- P2: Add attestationChain column to store Android Key Attestation cert chain
ALTER TABLE attendanceTrustedDevices ADD COLUMN attestationChain TEXT NOT NULL DEFAULT '';

-- P3: Add riskVerdict column to store root/hook/tamper risk signals
ALTER TABLE attendanceVerificationChallenges ADD COLUMN riskVerdict TEXT NOT NULL DEFAULT '';
