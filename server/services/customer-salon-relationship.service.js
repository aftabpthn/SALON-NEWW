import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function ensureCustomerSalonRelationshipSchema() {
  const sql = readFileSync(
    join(__dirname, '..', 'db', 'migrations', '20260725_customer_salon_relationship.sql'),
    'utf8'
  );
  db.exec(sql);
  console.log('[MIGRATION] customerSalonRelationship + customerPrimarySalons tables ready');
}

// ─── Relationship CRUD ───────────────────────────────────────────────

export function getOrCreateRelationship({ customerId, tenantId, branchId, businessId, businessName }) {
  const rel = db.prepare(`
    SELECT * FROM customerSalonRelationships
    WHERE customerId = @customerId AND tenantId = @tenantId AND branchId = @branchId
  `).get({ customerId, tenantId, branchId });

  if (rel) return rel;

  const id = `csr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO customerSalonRelationships (id, customerId, tenantId, branchId, businessId, businessName, relationshipType, visitCount, lastVisitAt, isFavorite, createdAt, updatedAt)
    VALUES (@id, @customerId, @tenantId, @branchId, @businessId, @businessName, 'guest', 0, '', 0, @now, @now)
  `).get({ id, customerId, tenantId, branchId, businessId: businessId || '', businessName: businessName || '', now });

  return db.prepare(`
    SELECT * FROM customerSalonRelationships WHERE id = @id
  `).get({ id });
}

export function incrementVisitCount({ customerId, tenantId, branchId }) {
  const now = new Date().toISOString();
  const rel = db.prepare(`
    SELECT * FROM customerSalonRelationships
    WHERE customerId = @customerId AND tenantId = @tenantId AND branchId = @branchId
  `).get({ customerId, tenantId, branchId });

  if (!rel) return null;

  const newCount = rel.visitCount + 1;
  let type = rel.relationshipType;
  if (newCount >= 10) type = 'loyal';
  else if (newCount >= 3) type = 'regular';
  else if (newCount >= 1) type = 'returning';

  db.prepare(`
    UPDATE customerSalonRelationships
    SET visitCount = @newCount, lastVisitAt = @now, relationshipType = @type, updatedAt = @now
    WHERE customerId = @customerId AND tenantId = @tenantId AND branchId = @branchId
  `).get({ customerId, tenantId, branchId, newCount, now, type });

  return db.prepare(`
    SELECT * FROM customerSalonRelationships
    WHERE customerId = @customerId AND tenantId = @tenantId AND branchId = @branchId
  `).get({ customerId, tenantId, branchId });
}

/**
 * Get all salons a customer has visited across all tenants.
 * Marketplace view: customer sees all their salon relationships.
 * Intentionally cross-tenant — the customer IS the entity spanning tenants.
 */
export function getAllRelationships(customerId) {
  return db.prepare(`
    SELECT * FROM customerSalonRelationships
    WHERE customerId = @customerId
    ORDER BY visitCount DESC, lastVisitAt DESC
  `).all({ customerId });
}

/**
 * Get a customer's relationships within a specific tenant only.
 * Use when tenant-scoped data is required (e.g., admin/ops views).
 */
export function getRelationshipsByTenant(customerId, tenantId) {
  return db.prepare(`
    SELECT * FROM customerSalonRelationships
    WHERE customerId = @customerId AND tenantId = @tenantId
    ORDER BY visitCount DESC, lastVisitAt DESC
  `).all({ customerId, tenantId });
}

// ─── Primary Salon ───────────────────────────────────────────────────

/**
 * Get customer's primary salon across all tenants.
 * Design: one primary salon per customer (marketplace-wide).
 * Intentionally cross-tenant.
 */
export function getPrimarySalon(customerId) {
  return db.prepare(`
    SELECT * FROM customerPrimarySalons WHERE customerId = @customerId
  `).get({ customerId });
}

/**
 * Get customer's primary salon within a specific tenant.
 */
export function getPrimarySalonByTenant(customerId, tenantId) {
  return db.prepare(`
    SELECT * FROM customerPrimarySalons WHERE customerId = @customerId AND tenantId = @tenantId
  `).get({ customerId, tenantId });
}

export function setPrimarySalon({ customerId, tenantId, branchId, businessId, businessName, reason }) {
  const id = `cps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const payload = { id, customerId, tenantId, branchId: branchId || '', businessId: businessId || '', businessName: businessName || '', reason: reason || 'manual', now };

  const existing = getPrimarySalon(customerId);
  if (existing) {
    db.prepare(`
      UPDATE customerPrimarySalons
      SET tenantId = @tenantId,
          branchId = @branchId,
          businessId = @businessId,
          businessName = @businessName,
          reason = @reason,
          setAt = @now
      WHERE customerId = @customerId
    `).run(payload);
    return getPrimarySalon(customerId);
  }

  db.prepare(`
    INSERT INTO customerPrimarySalons (id, customerId, tenantId, branchId, businessId, businessName, reason, setAt)
    VALUES (@id, @customerId, @tenantId, @branchId, @businessId, @businessName, @reason, @now)
  `).run(payload);

  return db.prepare(`SELECT * FROM customerPrimarySalons WHERE id = @id`).get({ id });
}

export function removePrimarySalon(customerId, tenantId) {
  if (tenantId) {
    db.prepare(`DELETE FROM customerPrimarySalons WHERE customerId = @customerId AND tenantId = @tenantId`).run({ customerId, tenantId });
  } else {
    // Fallback: remove all primary salons for this customer (profile-level action)
    db.prepare(`DELETE FROM customerPrimarySalons WHERE customerId = @customerId`).run({ customerId });
  }
  return { ok: true };
}

export function shouldPromptPrimarySalon(customerId) {
  const existing = getPrimarySalon(customerId);
  if (existing) return { prompt: false, reason: 'already_has_primary' };

  const rels = getAllRelationships(customerId);
  const eligible = rels.filter(r => r.visitCount >= 3);
  if (eligible.length === 0) return { prompt: false, reason: 'not_enough_visits' };

  const top = eligible.sort((a, b) => b.visitCount - a.visitCount)[0];
  return { prompt: true, reason: '3+_visits', suggestedSalon: top };
}

// ─── Combined: record visit (upsert relationship + increment) ──────

export function recordVisit({ customerId, tenantId, branchId, businessId, businessName }) {
  if (!customerId || !tenantId) return null;
  getOrCreateRelationship({ customerId, tenantId, branchId: branchId || '', businessId: businessId || '', businessName: businessName || '' });
  return incrementVisitCount({ customerId, tenantId, branchId: branchId || '' });
}

// ─── Service object for structured imports ───────────────────────

export const customerSalonRelationshipService = {
  ensureCustomerSalonRelationshipSchema,
  getOrCreateRelationship,
  incrementVisitCount,
  getAllRelationships,
  getRelationshipsByTenant,
  getPrimarySalon,
  getPrimarySalonByTenant,
  setPrimarySalon,
  removePrimarySalon,
  shouldPromptPrimarySalon,
  recordVisit
};
