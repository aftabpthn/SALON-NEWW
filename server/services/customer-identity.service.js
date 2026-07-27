import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { ensureCustomerIdentitySchema } from "./customer-identity-schema.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;

function phoneDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(value = "") {
  const digits = phoneDigits(value);
  if (!digits) return "";
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return String(value || "").startsWith("+") ? `+${digits}` : `+${digits}`;
}

function cleanEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

// ─── Schema init ─────────────────────────────────────────────────────
ensureCustomerIdentitySchema();

// ─── Find or create global account ───────────────────────────────────

function findAccountByPhone(phone) {
  if (!phone) return null;
  return db.prepare("SELECT * FROM customer_accounts WHERE phone = @phone LIMIT 1").get({ phone }) || null;
}

function findAccountByEmail(email) {
  if (!email) return null;
  return db.prepare("SELECT * FROM customer_accounts WHERE LOWER(email) = @email LIMIT 1").get({ email }) || null;
}

function findAccountByFirebaseUid(firebaseUid) {
  if (!firebaseUid) return null;
  return db.prepare("SELECT * FROM customer_accounts WHERE firebase_uid = @firebaseUid LIMIT 1").get({ firebaseUid }) || null;
}

function findAccountById(id) {
  if (!id) return null;
  return db.prepare("SELECT * FROM customer_accounts WHERE id = @id LIMIT 1").get({ id }) || null;
}

function createAccount({ name, phone, email, firebaseUid, authProvider }) {
  const stamp = now();
  const id = makeId("ca");
  db.prepare(`
    INSERT INTO customer_accounts (id, name, phone, email, phone_verified, email_verified, firebase_uid, auth_provider, status, created_at, updated_at)
    VALUES (@id, @name, @phone, @email, @phoneVerified, @emailVerified, @firebaseUid, @authProvider, 'active', @now, @now)
  `).run({
    id,
    name: name || "",
    phone: phone || "",
    email: email || "",
    phoneVerified: phone ? 1 : 0,
    emailVerified: email ? 1 : 0,
    firebaseUid: firebaseUid || "",
    authProvider: authProvider || "phone",
    now: stamp
  });
  return findAccountById(id);
}

function updateAccount(account, { name, phone, email, firebaseUid, authProvider }) {
  const stamp = now();
  const updates = { id: account.id, updatedAt: stamp };
  const sets = ["updated_at = @updatedAt"];
  if (name && (!account.name || account.name === "Customer")) { sets.push("name = @name"); updates.name = name; }
  if (phone && !account.phone) { sets.push("phone = @phone", "phone_verified = 1"); updates.phone = phone; }
  if (email && !account.email) { sets.push("email = @email", "email_verified = 1"); updates.email = email; }
  if (firebaseUid && !account.firebase_uid) { sets.push("firebase_uid = @firebaseUid"); updates.firebaseUid = firebaseUid; }
  if (authProvider) { sets.push("auth_provider = @authProvider"); updates.authProvider = authProvider; }
  if (sets.length > 1) {
    db.prepare(`UPDATE customer_accounts SET ${sets.join(", ")} WHERE id = @id`).run(updates);
  }
  return findAccountById(account.id);
}

/**
 * Find or create global customer account by verified identifiers.
 * Phone match takes priority → email → firebase → create new.
 * Returns { account, isExisting }.
 */
export function resolveOrCreateAccount({ name = "", phone = "", email = "", firebaseUid = "", authProvider = "phone" }) {
  const normPhone = normalizePhone(phone);
  const normEmail = cleanEmail(email);

  // Try phone match first (highest confidence)
  if (normPhone) {
    const byPhone = findAccountByPhone(normPhone);
    if (byPhone) {
      const updated = updateAccount(byPhone, { name, phone: normPhone, email: normEmail, firebaseUid, authProvider });
      return { account: updated, isExisting: true };
    }
  }

  // Try email match
  if (normEmail) {
    const byEmail = findAccountByEmail(normEmail);
    if (byEmail) {
      const updated = updateAccount(byEmail, { name, phone: normPhone, email: normEmail, firebaseUid, authProvider });
      return { account: updated, isExisting: true };
    }
  }

  // Try firebase uid match
  if (firebaseUid) {
    const byFirebase = findAccountByFirebaseUid(firebaseUid);
    if (byFirebase) {
      const updated = updateAccount(byFirebase, { name, phone: normPhone, email: normEmail, firebaseUid, authProvider });
      return { account: updated, isExisting: true };
    }
  }

  // No match — create new account
  const account = createAccount({ name, phone: normPhone, email: normEmail, firebaseUid, authProvider });
  return { account, isExisting: false };
}

// ─── Lazy linking ────────────────────────────────────────────────────

function logLinkAction({ accountId, clientId, tenantId, action, matchField, confidence, details = {} }) {
  const id = makeId("cala");
  db.prepare(`
    INSERT INTO customer_account_link_audit (id, customer_account_id, client_id, tenant_id, action, match_field, confidence, details, created_at)
    VALUES (@id, @accountId, @clientId, @tenantId, @action, @matchField, @confidence, @details, @now)
  `).run({
    id,
    accountId,
    clientId,
    tenantId,
    action,
    matchField,
    confidence,
    details: JSON.stringify(details),
    now: now()
  });
}

function findMatchingClients({ phone = "", email = "" }) {
  const matches = [];
  const normPhone = phoneDigits(phone).slice(-10);
  const normEmail = cleanEmail(email);

  if (normPhone) {
    const rows = db.prepare(`
      SELECT id, tenantId, phone, email, name FROM clients
      WHERE COALESCE(phone, '') != ''
    `).all();
    for (const row of rows) {
      if (phoneDigits(row.phone).slice(-10) === normPhone) {
        matches.push({ ...row, matchField: "phone" });
      }
    }
  }

  if (normEmail) {
    const rows = db.prepare(`
      SELECT id, tenantId, phone, email, name FROM clients
      WHERE LOWER(COALESCE(email, '')) = @email
    `).all({ email: normEmail });
    for (const row of rows) {
      if (!matches.find((m) => m.id === row.id)) {
        matches.push({ ...row, matchField: "email" });
      }
    }
  }

  return matches;
}

/**
 * Lazy-link matching tenant clients to a global account.
 * Called after successful OTP verification.
 * Only links clients that are NOT already linked.
 * Auto-links if 1-5 matches with high confidence.
 * Flags for review if ambiguous (>5 matches or already linked to different accounts).
 */
export function lazyLinkClients(account, { phone = "", email = "" }) {
  const accountId = account.id;
  const matches = findMatchingClients({ phone, email });

  if (!matches.length) return { linked: 0, flagged: 0, matches: [] };

  let linked = 0;
  let flagged = 0;

  // Deduplicate: group by clientId
  const seen = new Set();
  const unique = matches.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  // Find already-linked clients (different account)
  const alreadyLinkedToOther = [];
  const unlinked = [];

  for (const match of unique) {
    const existing = db.prepare("SELECT customerAccountId FROM clients WHERE id = @id").get({ id: match.id });
    if (existing && existing.customerAccountId && existing.customerAccountId !== accountId) {
      alreadyLinkedToOther.push({ ...match, existingAccountId: existing.customerAccountId });
    } else if (!existing || !existing.customerAccountId) {
      unlinked.push(match);
    }
    // If already linked to THIS account, skip silently
  }

  // If there are matches linked to OTHER accounts, flag for review (ambiguous)
  if (alreadyLinkedToOther.length > 0) {
    const flagId = makeId("calfl");
    db.prepare(`
      INSERT INTO customer_account_link_flags (id, customer_account_id, candidate_client_ids, match_field, status, created_at)
      VALUES (@id, @accountId, @candidateIds, @matchField, 'pending', @now)
    `).run({
      id: flagId,
      accountId,
      candidateIds: JSON.stringify(alreadyLinkedToOther.map((m) => ({ clientId: m.id, tenantId: m.tenantId, existingAccountId: m.existingAccountId }))),
      matchField: alreadyLinkedToOther[0].matchField,
      now: now()
    });
    logLinkAction({ accountId, clientId: alreadyLinkedToOther[0].id, tenantId: alreadyLinkedToOther[0].tenantId, action: "flagged", matchField: alreadyLinkedToOther[0].matchField, confidence: "ambiguous", details: { reason: "client_linked_to_other_account", count: alreadyLinkedToOther.length } });
    flagged++;
  }

  // Auto-link unlinked clients (high confidence)
  for (const match of unlinked) {
    db.prepare("UPDATE clients SET customerAccountId = @accountId WHERE id = @id").run({ accountId, id: match.id });
    linked++;
    logLinkAction({ accountId, clientId: match.id, tenantId: match.tenantId, action: "auto_linked", matchField: match.matchField, confidence: "high", details: { clientName: match.name } });
  }

  return { linked, flagged, matches: unique.map((m) => ({ clientId: m.id, tenantId: m.tenantId, name: m.name })) };
}

// ─── Query helpers ───────────────────────────────────────────────────

export function getAccountById(id) {
  return findAccountById(id);
}

export function getAccountByPhone(phone) {
  return findAccountByPhone(normalizePhone(phone));
}

export function getAccountByEmail(email) {
  return findAccountByEmail(cleanEmail(email));
}

/**
 * Get all tenant client records linked to a global account.
 * Returns an array of { tenantId, clientId, clientName, salonName, ... }.
 */
export function getLinkedClients(accountId) {
  return db.prepare(`
    SELECT c.id AS clientId, c.tenantId, c.name AS clientName, c.phone, c.email,
           c.walletBalance, c.loyaltyPoints, c.visitCount, c.totalSpend, c.lastVisitAt,
           c.branchId, c.createdAt, c.updatedAt
    FROM clients c
    WHERE c.customerAccountId = @accountId
    ORDER BY c.totalSpend DESC
  `).all({ accountId });
}

/**
 * Get pending link flags for an account.
 */
export function getPendingFlags(accountId) {
  return db.prepare(`
    SELECT * FROM customer_account_link_flags
    WHERE customer_account_id = @accountId AND status = 'pending'
    ORDER BY created_at DESC
  `).all({ accountId });
}

/**
 * Resolve a link flag: accept or dismiss.
 */
export function resolveFlag(flagId, { accept = false, resolvedBy = "" }) {
  const flag = db.prepare("SELECT * FROM customer_account_link_flags WHERE id = @id").get({ id: flagId });
  if (!flag) return null;

  if (accept) {
    const candidates = JSON.parse(flag.candidate_client_ids || "[]");
    for (const c of candidates) {
      // Only link if not already linked to another account
      const existing = db.prepare("SELECT customerAccountId FROM clients WHERE id = @id").get({ id: c.clientId });
      if (!existing || !existing.customerAccountId) {
        db.prepare("UPDATE clients SET customerAccountId = @accountId WHERE id = @id").run({ accountId: flag.customer_account_id, id: c.clientId });
        logLinkAction({ accountId: flag.customer_account_id, clientId: c.clientId, tenantId: c.tenantId, action: "manual_linked", matchField: flag.match_field, confidence: "high", details: { resolvedBy, accepted: true } });
      }
    }
  } else {
    logLinkAction({ accountId: flag.customer_account_id, clientId: "none", tenantId: "none", action: "dismissed", matchField: flag.match_field, confidence: "low", details: { resolvedBy, accepted: false } });
  }

  db.prepare("UPDATE customer_account_link_flags SET status = @status, resolved_by = @resolvedBy, resolved_at = @resolvedAt WHERE id = @id").run({
    status: accept ? "resolved" : "dismissed",
    resolvedBy,
    resolvedAt: now(),
    id: flagId
  });

  return { id: flagId, status: accept ? "resolved" : "dismissed" };
}

/**
 * Update global account profile.
 */
export function updateProfile(accountId, { name, dateOfBirth, gender, profileImage }) {
  const account = findAccountById(accountId);
  if (!account) return null;

  const stamp = now();
  const sets = ["updated_at = @updatedAt"];
  const params = { id: accountId, updatedAt: stamp };

  if (name !== undefined) { sets.push("name = @name"); params.name = name; }
  if (dateOfBirth !== undefined) { sets.push("date_of_birth = @dob"); params.dob = dateOfBirth; }
  if (gender !== undefined) { sets.push("gender = @gender"); params.gender = gender; }
  if (profileImage !== undefined) { sets.push("profile_image = @img"); params.img = profileImage; }

  db.prepare(`UPDATE customer_accounts SET ${sets.join(", ")} WHERE id = @id`).run(params);
  return findAccountById(accountId);
}

/**
 * Get link audit log for an account.
 */
export function getLinkAuditLog(accountId) {
  return db.prepare(`
    SELECT * FROM customer_account_link_audit
    WHERE customer_account_id = @accountId
    ORDER BY created_at DESC
    LIMIT 50
  `).all({ accountId });
}
