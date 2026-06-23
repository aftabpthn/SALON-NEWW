import { db } from "../db.js";
import { happyHoursEngine } from "../utils/happy-hours-engine.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS happyHoursMemberWalletSuggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    clientId TEXT NOT NULL DEFAULT '',
    membershipId TEXT NOT NULL DEFAULT '',
    membershipStatus TEXT NOT NULL DEFAULT 'none',
    signalDate TEXT NOT NULL,
    dayOfWeek TEXT NOT NULL DEFAULT '',
    hourSlot INTEGER NOT NULL DEFAULT 0,
    cartTotalPaise INTEGER NOT NULL DEFAULT 0,
    baseDiscountPercent REAL NOT NULL DEFAULT 0,
    walletBalancePaise INTEGER NOT NULL DEFAULT 0,
    loyaltyPoints INTEGER NOT NULL DEFAULT 0,
    creditsRemaining INTEGER NOT NULL DEFAULT 0,
    visitCount INTEGER NOT NULL DEFAULT 0,
    totalSpendPaise INTEGER NOT NULL DEFAULT 0,
    walletCoveragePercent REAL NOT NULL DEFAULT 0,
    loyaltyTier TEXT NOT NULL DEFAULT 'standard',
    membershipPosture TEXT NOT NULL DEFAULT 'unknown',
    discountPosture TEXT NOT NULL DEFAULT 'unknown',
    campaignAngle TEXT NOT NULL DEFAULT 'collect_member_wallet_data',
    suggestedDiscountPercent INTEGER NOT NULL DEFAULT 0,
    expectedDiscountPaise INTEGER NOT NULL DEFAULT 0,
    expectedWalletUsePaise INTEGER NOT NULL DEFAULT 0,
    expectedNetRevenuePaise INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'suggested',
    reasons TEXT NOT NULL DEFAULT '[]',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_memberWalletSuggestions_scope
    ON happyHoursMemberWalletSuggestions(tenantId, branchId, status, clientId, createdAt);
`);

function normalizeScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function toPaise(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount > 100000 ? amount : amount * 100);
}

function percent(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}

function q(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error("Unsafe identifier");
  return `"${identifier}"`;
}

function tableExists(tableName) {
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = @tableName").get({ tableName }));
  } catch {
    return false;
  }
}

function safeColumns(tableName) {
  if (!tableExists(tableName)) return [];
  try {
    return db.prepare(`PRAGMA table_info(${q(tableName)})`).all().map((column) => column.name);
  } catch {
    return [];
  }
}

function column(columns, candidates) {
  return candidates.find((candidate) => columns.includes(candidate)) || "";
}

function slot(input = {}) {
  const date = input.signalDate ? new Date(`${String(input.signalDate).slice(0, 10)}T00:00:00+05:30`) : new Date();
  const parts = happyHoursEngine.getISTComponents(date);
  return {
    signalDate: String(input.signalDate || parts.nowDate).slice(0, 10),
    dayOfWeek: String(input.dayOfWeek || parts.nowDay).slice(0, 3).toLowerCase(),
    hourSlot: Math.max(0, Math.min(23, Number.parseInt(input.hourSlot ?? parts.nowTime.slice(0, 2), 10) || 0))
  };
}

function clientSnapshot(scope = {}) {
  const columns = safeColumns("clients");
  if (!columns.length || !scope.clientId) return {};
  const idCol = column(columns, ["id", "clientId"]);
  if (!idCol) return {};
  const tenantCol = column(columns, ["tenantId", "tenant_id"]);
  const branchCol = column(columns, ["branchId", "branch_id"]);
  const membershipCol = column(columns, ["membershipId", "membership_id"]);
  const walletCol = column(columns, ["walletBalance", "walletBalancePaise", "wallet_balance"]);
  const loyaltyCol = column(columns, ["loyaltyPoints", "loyalty_points"]);
  const visitCol = column(columns, ["visitCount", "visit_count"]);
  const spendCol = column(columns, ["totalSpend", "totalSpendPaise", "total_spend"]);
  const tenantWhere = tenantCol ? `AND ${q(tenantCol)} = @tenantId` : "";
  const branchWhere = branchCol ? `AND (${q(branchCol)} = @branchId OR COALESCE(${q(branchCol)}, '') = '')` : "";

  try {
    const row = db.prepare(`
      SELECT ${membershipCol ? q(membershipCol) : "''"} AS membershipId,
             ${walletCol ? q(walletCol) : "0"} AS walletBalance,
             ${loyaltyCol ? q(loyaltyCol) : "0"} AS loyaltyPoints,
             ${visitCol ? q(visitCol) : "0"} AS visitCount,
             ${spendCol ? q(spendCol) : "0"} AS totalSpend
      FROM clients
      WHERE ${q(idCol)} = @clientId
        ${tenantWhere}
        ${branchWhere}
      LIMIT 1
    `).get(scope);
    if (!row) return {};
    return {
      membershipId: String(row.membershipId || ""),
      walletBalancePaise: toPaise(row.walletBalance),
      loyaltyPoints: Number(row.loyaltyPoints || 0),
      visitCount: Number(row.visitCount || 0),
      totalSpendPaise: toPaise(row.totalSpend)
    };
  } catch {
    return {};
  }
}

function membershipSnapshot(scope = {}) {
  const columns = safeColumns("memberships");
  if (!columns.length) return {};
  const idCol = column(columns, ["id", "membershipId"]);
  const clientCol = column(columns, ["clientId", "client_id"]);
  if (!idCol || !clientCol) return {};
  const tenantCol = column(columns, ["tenantId", "tenant_id"]);
  const branchCol = column(columns, ["branchId", "branch_id"]);
  const statusCol = column(columns, ["status"]);
  const creditsCol = column(columns, ["creditsRemaining", "credits_remaining"]);
  const autoRenewCol = column(columns, ["autoRenew", "auto_renew"]);
  const validCol = column(columns, ["validityDate", "validUntil", "expiresAt"]);
  const loyaltyMultiplierCol = column(columns, ["loyaltyMultiplier", "loyalty_multiplier"]);
  const tenantWhere = tenantCol ? `AND ${q(tenantCol)} = @tenantId` : "";
  const branchWhere = branchCol ? `AND (${q(branchCol)} = @branchId OR COALESCE(${q(branchCol)}, '') = '')` : "";
  const membershipWhere = scope.membershipId ? `OR ${q(idCol)} = @membershipId` : "";

  try {
    const row = db.prepare(`
      SELECT ${q(idCol)} AS membershipId,
             ${statusCol ? q(statusCol) : "'active'"} AS membershipStatus,
             ${creditsCol ? q(creditsCol) : "0"} AS creditsRemaining,
             ${autoRenewCol ? q(autoRenewCol) : "0"} AS autoRenew,
             ${validCol ? q(validCol) : "''"} AS validityDate,
             ${loyaltyMultiplierCol ? q(loyaltyMultiplierCol) : "1"} AS loyaltyMultiplier
      FROM memberships
      WHERE (${q(clientCol)} = @clientId ${membershipWhere})
        ${tenantWhere}
        ${branchWhere}
      ORDER BY CASE WHEN LOWER(COALESCE(${statusCol ? q(statusCol) : "'active'"}, 'active')) = 'active' THEN 0 ELSE 1 END,
               updatedAt DESC
      LIMIT 1
    `).get(scope);
    if (!row) return {};
    return {
      membershipId: String(row.membershipId || ""),
      membershipStatus: String(row.membershipStatus || "active").toLowerCase(),
      creditsRemaining: Math.max(0, Number(row.creditsRemaining || 0)),
      autoRenew: Number(row.autoRenew || 0),
      validityDate: String(row.validityDate || ""),
      loyaltyMultiplier: Number(row.loyaltyMultiplier || 1)
    };
  } catch {
    return {};
  }
}

function walletActivity(scope = {}) {
  const columns = safeColumns("wallet_transactions");
  if (!columns.length || !scope.clientId) return { walletActivityCount: 0 };
  const tenantCol = column(columns, ["tenantId", "tenant_id"]);
  const branchCol = column(columns, ["branchId", "branch_id"]);
  const clientCol = column(columns, ["clientId", "client_id"]);
  const amountCol = column(columns, ["amount", "amountPaise"]);
  if (!tenantCol || !clientCol) return { walletActivityCount: 0 };
  const branchWhere = branchCol ? `AND (${q(branchCol)} = @branchId OR COALESCE(${q(branchCol)}, '') = '')` : "";
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS walletActivityCount,
             COALESCE(SUM(${amountCol ? q(amountCol) : "0"}), 0) AS walletFlow
      FROM wallet_transactions
      WHERE ${q(tenantCol)} = @tenantId
        AND ${q(clientCol)} = @clientId
        ${branchWhere}
    `).get(scope);
    return {
      walletActivityCount: Number(row?.walletActivityCount || 0),
      walletFlowPaise: toPaise(row?.walletFlow || 0)
    };
  } catch {
    return { walletActivityCount: 0, walletFlowPaise: 0 };
  }
}

function loyaltyTier(points = 0) {
  if (points >= 2000) return "platinum";
  if (points >= 1000) return "gold";
  if (points >= 350) return "silver";
  return "standard";
}

function daysUntil(dateText) {
  if (!dateText) return 9999;
  const date = new Date(dateText);
  if (!Number.isFinite(date.getTime())) return 9999;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function profile(input = {}) {
  const hasMembership = input.membershipStatus === "active" || input.creditsRemaining > 0 || Boolean(input.membershipId);
  if (hasMembership && input.creditsRemaining > 0) {
    return {
      membershipPosture: "active_credit_member",
      discountPosture: "redeem_credit_first",
      cap: 8,
      points: -5,
      angle: "redeem_membership_credit",
      reason: "Active membership credits available hain; cash discount kam rakho aur credit/wallet redeem karao."
    };
  }
  if (hasMembership && input.membershipExpiryDays <= 30) {
    return {
      membershipPosture: "renewal_window",
      discountPosture: "renewal_nudge",
      cap: 18,
      points: 6,
      angle: "membership_renewal_offer",
      reason: "Membership expiry near hai; renewal-linked offer useful ho sakta hai."
    };
  }
  if (!hasMembership && (input.visitCount >= 3 || input.totalSpendPaise >= 2000000)) {
    return {
      membershipPosture: "membership_conversion",
      discountPosture: "convert_to_member",
      cap: 22,
      points: 8,
      angle: "convert_to_membership",
      reason: "Repeat/high-spend client membership convert ho sakta hai; discount ko membership signup se tie karo."
    };
  }
  if (input.walletCoveragePercent >= 50) {
    return {
      membershipPosture: "wallet_rich",
      discountPosture: "use_wallet_not_discount",
      cap: 10,
      points: -3,
      angle: "wallet_redemption_offer",
      reason: "Wallet balance cart ka strong part cover karta hai; extra discount ki zarurat kam hai."
    };
  }
  return {
    membershipPosture: "standard_client",
    discountPosture: "standard_nudge",
    cap: 15,
    points: 2,
    angle: "loyalty_points_nudge",
    reason: "Membership/wallet signal normal hai; small loyalty nudge enough hai."
  };
}

function buildSuggestion(input = {}, mode = "recommended") {
  const current = normalizeScope(input);
  const currentSlot = slot(input);
  const clientId = String(input.clientId || "").trim();
  const baseClient = {
    clientId,
    membershipId: String(input.membershipId || "").trim(),
    walletBalancePaise: intPaise(input.walletBalancePaise),
    loyaltyPoints: Math.max(0, Number.parseInt(input.loyaltyPoints, 10) || 0),
    visitCount: Math.max(0, Number.parseInt(input.visitCount, 10) || 0),
    totalSpendPaise: intPaise(input.totalSpendPaise)
  };
  const fromClient = clientSnapshot({ ...current, clientId });
  const memberInput = { ...current, clientId, membershipId: baseClient.membershipId || fromClient.membershipId || "" };
  const fromMembership = membershipSnapshot(memberInput);
  const wallet = walletActivity({ ...current, clientId });
  const cartTotalPaise = intPaise(input.cartTotalPaise || input.servicePricePaise);
  const walletBalancePaise = baseClient.walletBalancePaise || fromClient.walletBalancePaise || 0;
  const loyaltyPoints = baseClient.loyaltyPoints || fromClient.loyaltyPoints || 0;
  const visitCount = baseClient.visitCount || fromClient.visitCount || 0;
  const totalSpendPaise = baseClient.totalSpendPaise || fromClient.totalSpendPaise || 0;
  const requestedStatus = String(input.membershipStatus || "").toLowerCase();
  const membershipStatus = requestedStatus && requestedStatus !== "none"
    ? requestedStatus
    : String(fromMembership.membershipStatus || "none").toLowerCase();
  const membershipId = baseClient.membershipId || fromMembership.membershipId || fromClient.membershipId || "";
  const requestedCredits = Number.parseInt(input.creditsRemaining, 10) || 0;
  const creditsRemaining = Math.max(0, requestedCredits || Number(fromMembership.creditsRemaining || 0));
  const walletCoveragePercent = cartTotalPaise ? percent((walletBalancePaise / cartTotalPaise) * 100) : 0;
  const currentTier = loyaltyTier(loyaltyPoints);
  const context = {
    membershipId,
    membershipStatus,
    creditsRemaining,
    visitCount,
    totalSpendPaise,
    walletCoveragePercent,
    membershipExpiryDays: daysUntil(input.validityDate || fromMembership.validityDate)
  };
  const currentProfile = profile(context);
  const reasons = [currentProfile.reason];
  let points = currentProfile.points;
  let cap = currentProfile.cap;
  let discountPosture = currentProfile.discountPosture;

  if (currentTier === "platinum" || currentTier === "gold") {
    points -= 2;
    cap = Math.min(cap, 12);
    discountPosture = "loyalty_privilege";
    reasons.push("High loyalty tier hai; deep discount ke bajay privilege/wallet redemption better hai.");
  } else if (currentTier === "standard" && visitCount <= 1) {
    points += 4;
    cap = Math.min(24, cap + 4);
    reasons.push("New/low-visit client ko acquisition nudge diya ja sakta hai.");
  }

  if (wallet.walletActivityCount >= 3) reasons.push("Wallet activity present hai; redemption-led offer practical hai.");
  if (!clientId && !membershipId && !walletBalancePaise && !loyaltyPoints) reasons.push("Client signal missing hai; suggestion review-only rakho.");
  if (mode === "conservative") points -= 4;
  if (mode === "aggressive") points += 5;

  const baseDiscountPercent = percent(input.baseDiscountPercent, 5);
  const suggestedDiscountPercent = Math.round(Math.max(0, Math.min(cap, baseDiscountPercent + points)));
  const expectedDiscountPaise = Math.round(cartTotalPaise * (suggestedDiscountPercent / 100));
  const expectedWalletUsePaise = Math.min(walletBalancePaise, Math.max(0, cartTotalPaise - expectedDiscountPaise), Math.round(cartTotalPaise * 0.5));
  const expectedNetRevenuePaise = Math.max(0, cartTotalPaise - expectedDiscountPaise);

  return {
    ...current,
    ...currentSlot,
    clientId,
    membershipId,
    membershipStatus,
    cartTotalPaise,
    baseDiscountPercent,
    walletBalancePaise,
    loyaltyPoints,
    creditsRemaining,
    visitCount,
    totalSpendPaise,
    walletCoveragePercent,
    loyaltyTier: currentTier,
    membershipPosture: currentProfile.membershipPosture,
    discountPosture,
    campaignAngle: currentProfile.angle,
    suggestedDiscountPercent,
    expectedDiscountPaise,
    expectedWalletUsePaise,
    expectedNetRevenuePaise,
    status: clientId || membershipId || walletBalancePaise || loyaltyPoints ? "ready" : "collecting",
    mode,
    reasons
  };
}

export function evaluate(scope = {}) {
  const best = buildSuggestion(scope, "recommended");
  const rows = [
    buildSuggestion(scope, "conservative"),
    best,
    buildSuggestion(scope, "aggressive")
  ];
  return {
    status: best.status,
    best,
    rows,
    summary: {
      membershipPosture: best.membershipPosture,
      discountPosture: best.discountPosture,
      walletCoveragePercent: best.walletCoveragePercent,
      loyaltyTier: best.loyaltyTier,
      maxDiscountPercent: Math.max(...rows.map((row) => Number(row.suggestedDiscountPercent || 0))),
      expectedWalletUsePaise: best.expectedWalletUsePaise
    }
  };
}

export function saveSuggestion(scope = {}) {
  const row = evaluate(scope).best;
  const payload = {
    ...row,
    reasons: JSON.stringify(row.reasons || []),
    status: "suggested"
  };
  const result = db.prepare(`
    INSERT INTO happyHoursMemberWalletSuggestions (
      tenantId, branchId, clientId, membershipId, membershipStatus,
      signalDate, dayOfWeek, hourSlot, cartTotalPaise, baseDiscountPercent,
      walletBalancePaise, loyaltyPoints, creditsRemaining, visitCount, totalSpendPaise,
      walletCoveragePercent, loyaltyTier, membershipPosture, discountPosture, campaignAngle,
      suggestedDiscountPercent, expectedDiscountPaise, expectedWalletUsePaise,
      expectedNetRevenuePaise, status, reasons
    )
    VALUES (
      @tenantId, @branchId, @clientId, @membershipId, @membershipStatus,
      @signalDate, @dayOfWeek, @hourSlot, @cartTotalPaise, @baseDiscountPercent,
      @walletBalancePaise, @loyaltyPoints, @creditsRemaining, @visitCount, @totalSpendPaise,
      @walletCoveragePercent, @loyaltyTier, @membershipPosture, @discountPosture, @campaignAngle,
      @suggestedDiscountPercent, @expectedDiscountPaise, @expectedWalletUsePaise,
      @expectedNetRevenuePaise, @status, @reasons
    )
  `).run(payload);
  return getSuggestion({ ...row, id: Number(result.lastInsertRowid) });
}

export function listSuggestions(scope = {}) {
  const current = normalizeScope(scope);
  const status = String(scope.status || "").trim();
  const limit = Math.min(100, Math.max(1, Number.parseInt(scope.limit, 10) || 25));
  return {
    rows: db.prepare(`
      SELECT *
      FROM happyHoursMemberWalletSuggestions
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND (@status = '' OR status = @status)
      ORDER BY createdAt DESC, id DESC
      LIMIT @limit
    `).all({ ...current, status, limit }).map(parseSuggestion)
  };
}

export function updateStatus(scope = {}) {
  const current = normalizeScope(scope);
  const id = Number.parseInt(scope.id, 10) || 0;
  const status = String(scope.status || "suggested").trim();
  db.prepare(`
    UPDATE happyHoursMemberWalletSuggestions
    SET status = @status
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `).run({ ...current, id, status });
  return getSuggestion({ ...current, id });
}

function getSuggestion(scope = {}) {
  const current = normalizeScope(scope);
  const id = Number.parseInt(scope.id, 10) || 0;
  const row = db.prepare(`
    SELECT *
    FROM happyHoursMemberWalletSuggestions
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `).get({ ...current, id });
  return parseSuggestion(row);
}

function parseSuggestion(row) {
  if (!row) return null;
  return {
    ...row,
    reasons: JSON.parse(row.reasons || "[]")
  };
}

export const happyHoursMemberWalletRepo = {
  evaluate,
  saveSuggestion,
  listSuggestions,
  updateStatus
};
