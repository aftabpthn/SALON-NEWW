import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';

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

export function getAllRelationships(customerId) {
  return db.prepare(`
    SELECT * FROM customerSalonRelationships
    WHERE customerId = @customerId
    ORDER BY visitCount DESC, lastVisitAt DESC
  `).all({ customerId });
}

// ─── Primary Salon ───────────────────────────────────────────────────

export function getPrimarySalon(customerId) {
  return db.prepare(`
    SELECT * FROM customerPrimarySalons WHERE customerId = @customerId
  `).get({ customerId });
}

export function setPrimarySalon({ customerId, tenantId, branchId, businessId, businessName, reason }) {
  const id = `cps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`DELETE FROM customerPrimarySalons WHERE customerId = @customerId`).get({ customerId });

  db.prepare(`
    INSERT INTO customerPrimarySalons (id, customerId, tenantId, branchId, businessId, businessName, reason, setAt)
    VALUES (@id, @customerId, @tenantId, @branchId, @businessId, @businessName, @reason, @now)
  `).get({ id, customerId, tenantId, branchId, businessId: businessId || '', businessName: businessName || '', reason: reason || 'manual', now });

  return db.prepare(`SELECT * FROM customerPrimarySalons WHERE id = @id`).get({ id });
}

export function removePrimarySalon(customerId) {
  db.prepare(`DELETE FROM customerPrimarySalons WHERE customerId = @customerId`).get({ customerId });
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
