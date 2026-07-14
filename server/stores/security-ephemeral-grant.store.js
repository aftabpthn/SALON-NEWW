import { createHash, randomBytes } from "node:crypto";
import { db } from "../db.js";

const text = (value) => String(value || "");
const hashProof = (proof) => createHash("sha256").update(String(proof)).digest("hex");

export class SecurityEphemeralGrantStore {
  constructor(database = db, { clock = () => Date.now() } = {}) {
    this.database = database;
    this.clock = clock;
  }

  randomId() {
    return randomBytes(32).toString("base64url");
  }

  issue({ proof, ttlSeconds, type, purpose, subjectId = "", userId = "", staffId = "", tenantId, branchId = "", sessionId = "", payload = {} }) {
    if (!proof || !tenantId || !type || !purpose || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error("Invalid ephemeral grant");
    }
    const createdAt = new Date(this.clock()).toISOString();
    const expiresAt = new Date(this.clock() + ttlSeconds * 1000).toISOString();
    const grant = {
      id: this.randomId(),
      proofHash: hashProof(proof),
      type: text(type),
      purpose: text(purpose),
      subjectId: text(subjectId),
      userId: text(userId),
      staffId: text(staffId),
      tenantId: text(tenantId),
      branchId: text(branchId),
      sessionId: text(sessionId),
      payload: JSON.stringify(payload),
      expiresAt,
      createdAt
    };
    this.database.prepare(`
      INSERT INTO securityEphemeralGrants (
        id, proofHash, type, purpose, subjectId, userId, staffId, tenantId,
        branchId, sessionId, payload, expiresAt, createdAt
      ) VALUES (
        @id, @proofHash, @type, @purpose, @subjectId, @userId, @staffId, @tenantId,
        @branchId, @sessionId, @payload, @expiresAt, @createdAt
      )
    `).run(grant);
    return { id: grant.id, expiresAt };
  }

  consume({ proof, type, purpose, subjectId = "", userId = "", staffId = "", tenantId, branchId = "", sessionId = "" }) {
    const consumedAt = new Date(this.clock()).toISOString();
    const row = this.database.prepare(`
      UPDATE securityEphemeralGrants
         SET consumedAt = @consumedAt
       WHERE proofHash = @proofHash
         AND type = @type
         AND purpose = @purpose
         AND subjectId = @subjectId
         AND userId = @userId
         AND staffId = @staffId
         AND tenantId = @tenantId
         AND branchId = @branchId
         AND sessionId = @sessionId
         AND consumedAt = ''
         AND expiresAt > @consumedAt
      RETURNING id, payload, expiresAt, createdAt
    `).get({
      proofHash: hashProof(proof),
      type: text(type),
      purpose: text(purpose),
      subjectId: text(subjectId),
      userId: text(userId),
      staffId: text(staffId),
      tenantId: text(tenantId),
      branchId: text(branchId),
      sessionId: text(sessionId),
      consumedAt
    });
    if (!row) return null;
    return { ...row, payload: JSON.parse(row.payload || "{}") };
  }

  cleanup({ consumedRetentionSeconds = 3600 } = {}) {
    const now = new Date(this.clock()).toISOString();
    const consumedBefore = new Date(this.clock() - consumedRetentionSeconds * 1000).toISOString();
    return this.database.prepare(`
      DELETE FROM securityEphemeralGrants
       WHERE expiresAt <= @now
          OR (consumedAt != '' AND consumedAt <= @consumedBefore)
    `).run({ now, consumedBefore }).changes;
  }
}

export const securityEphemeralGrantStore = new SecurityEphemeralGrantStore();
