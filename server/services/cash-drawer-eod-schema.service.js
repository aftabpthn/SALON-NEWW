import { columnsFor, db } from "../db.js";

let ensured = false;

function hasColumn(table, column) {
  try {
    return columnsFor(table).includes(column);
  } catch {
    return false;
  }
}

function ensureColumn(table, column, definition) {
  if (!hasColumn(table, column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

export function ensureCashDrawerEodSchema() {
  if (ensured) return;

  ensureColumn("cash_drawer_sessions", "businessDate", "TEXT DEFAULT ''");
  ensureColumn("cash_drawer_sessions", "openingBalancePaise", "INTEGER DEFAULT 0");
  ensureColumn("cash_drawer_sessions", "openedBy", "TEXT DEFAULT ''");
  ensureColumn("cash_drawer_sessions", "closedBy", "TEXT DEFAULT ''");
  ensureColumn("cash_drawer_sessions", "cashCollectedPaise", "INTEGER DEFAULT 0");
  ensureColumn("cash_drawer_sessions", "cashPayoutPaise", "INTEGER DEFAULT 0");
  ensureColumn("cash_drawer_sessions", "expectedCashPaise", "INTEGER DEFAULT 0");
  ensureColumn("cash_drawer_sessions", "countedCashPaise", "INTEGER DEFAULT 0");
  ensureColumn("cash_drawer_sessions", "variancePaise", "INTEGER DEFAULT 0");
  ensureColumn("cash_drawer_sessions", "varianceReason", "TEXT DEFAULT ''");
  ensureColumn("cash_drawer_sessions", "notes", "TEXT DEFAULT ''");
  ensureColumn("cash_drawer_sessions", "blindClose", "INTEGER DEFAULT 1");
  ensureColumn("cash_drawer_sessions", "overrideBy", "TEXT DEFAULT ''");
  ensureColumn("cash_drawer_sessions", "overrideAt", "TEXT DEFAULT ''");
  ensureColumn("cash_drawer_sessions", "cashOperationImpactPaise", "INTEGER DEFAULT 0");
  ensureColumn("cash_drawer_sessions", "cashDropPaise", "INTEGER DEFAULT 0");
  ensureColumn("cash_drawer_sessions", "cashPickupPaise", "INTEGER DEFAULT 0");
  ensureColumn("cash_drawer_sessions", "pettyCashPayoutPaise", "INTEGER DEFAULT 0");
  ensureColumn("cash_drawer_sessions", "safeMovePaise", "INTEGER DEFAULT 0");
  ensureColumn("cash_drawer_sessions", "nextDayFloatSuggestion", "TEXT DEFAULT '{}'");
  ensureColumn("cash_drawer_sessions", "primaryTillId", "TEXT DEFAULT ''");
  ensureColumn("cash_drawer_sessions", "riskScore", "INTEGER DEFAULT 0");
  ensureColumn("cash_drawer_sessions", "riskLevel", "TEXT DEFAULT 'low'");
  ensureColumn("cash_drawer_sessions", "riskEvaluatedAt", "TEXT DEFAULT ''");
  ensureColumn("cash_drawer_sessions", "approvalStatus", "TEXT DEFAULT 'not_required'");
  ensureColumn("cash_drawer_sessions", "approvalRequestId", "TEXT DEFAULT ''");

  db.exec(`
    CREATE TABLE IF NOT EXISTS cashDrawerEodSettings (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      blindClose INTEGER DEFAULT 1,
      reportChannel TEXT DEFAULT 'whatsapp,inapp',
      ownerRecipient TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId)
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodDenominations (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      denominationPaise INTEGER NOT NULL,
      kind TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 0,
      subtotalPaise INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodCollections (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      mode TEXT NOT NULL,
      autoAmountPaise INTEGER NOT NULL DEFAULT 0,
      finalAmountPaise INTEGER NOT NULL DEFAULT 0,
      manualAdjustmentPaise INTEGER NOT NULL DEFAULT 0,
      adjustmentReason TEXT DEFAULT '',
      updatedBy TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, sessionId, mode)
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodCollectionAdjustments (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      mode TEXT NOT NULL,
      previousFinalAmountPaise INTEGER DEFAULT 0,
      nextFinalAmountPaise INTEGER DEFAULT 0,
      reason TEXT DEFAULT '',
      changedBy TEXT DEFAULT '',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodSettlements (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      mode TEXT NOT NULL,
      grossPaise INTEGER NOT NULL DEFAULT 0,
      settlementChargePaise INTEGER NOT NULL DEFAULT 0,
      netPaise INTEGER NOT NULL DEFAULT 0,
      bankRef TEXT DEFAULT '',
      reconciled INTEGER DEFAULT 0,
      updatedBy TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, sessionId, mode)
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodReports (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      businessDate TEXT NOT NULL,
      openingBalancePaise INTEGER DEFAULT 0,
      cashCollectedPaise INTEGER DEFAULT 0,
      cashPayoutPaise INTEGER DEFAULT 0,
      expectedCashPaise INTEGER DEFAULT 0,
      countedCashPaise INTEGER DEFAULT 0,
      variancePaise INTEGER DEFAULT 0,
      varianceReason TEXT DEFAULT '',
      denominationBreakdown TEXT DEFAULT '[]',
      modeWiseCollection TEXT DEFAULT '[]',
      settlementBreakdown TEXT DEFAULT '[]',
      invoiceCount INTEGER DEFAULT 0,
      closedBy TEXT DEFAULT '',
      openedAt TEXT DEFAULT '',
      closedAt TEXT DEFAULT '',
      reportChannel TEXT DEFAULT 'whatsapp,inapp',
      notificationStatus TEXT DEFAULT 'pending',
      notificationRef TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, sessionId)
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodTills (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      tillName TEXT NOT NULL,
      cashierId TEXT DEFAULT '',
      openingFloatPaise INTEGER DEFAULT 0,
      cashCollectedPaise INTEGER DEFAULT 0,
      cashDropPaise INTEGER DEFAULT 0,
      cashPickupPaise INTEGER DEFAULT 0,
      pettyCashPayoutPaise INTEGER DEFAULT 0,
      expectedCashPaise INTEGER DEFAULT 0,
      countedCashPaise INTEGER DEFAULT 0,
      variancePaise INTEGER DEFAULT 0,
      status TEXT DEFAULT 'open',
      openedBy TEXT DEFAULT '',
      openedAt TEXT NOT NULL,
      closedBy TEXT DEFAULT '',
      closedAt TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, sessionId, tillName)
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodCashOperations (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      tillId TEXT DEFAULT '',
      type TEXT NOT NULL,
      amountPaise INTEGER NOT NULL DEFAULT 0,
      impactPaise INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      entryBy TEXT DEFAULT '',
      entryAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodHandovers (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      tillId TEXT DEFAULT '',
      outgoingCashierId TEXT DEFAULT '',
      incomingCashierId TEXT NOT NULL,
      countedCashPaise INTEGER DEFAULT 0,
      countBreakdown TEXT DEFAULT '[]',
      signature TEXT NOT NULL,
      notes TEXT DEFAULT '',
      handedOverAt TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodThreeWayMatches (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      mode TEXT NOT NULL,
      posCollectionPaise INTEGER DEFAULT 0,
      settlementGrossPaise INTEGER DEFAULT 0,
      physicalCashPaise INTEGER DEFAULT 0,
      posSettlementDeltaPaise INTEGER DEFAULT 0,
      posPhysicalDeltaPaise INTEGER DEFAULT 0,
      status TEXT DEFAULT 'matched',
      exceptionReason TEXT DEFAULT '',
      computedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, sessionId, mode)
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodSettlementImports (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      provider TEXT DEFAULT '',
      businessDate TEXT DEFAULT '',
      fileName TEXT DEFAULT '',
      rowCount INTEGER DEFAULT 0,
      matchedCount INTEGER DEFAULT 0,
      unmatchedCount INTEGER DEFAULT 0,
      pendingCount INTEGER DEFAULT 0,
      importedBy TEXT DEFAULT '',
      importedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodSettlementImportRows (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      importId TEXT NOT NULL,
      provider TEXT DEFAULT '',
      mode TEXT DEFAULT 'online',
      paymentRef TEXT DEFAULT '',
      bankRef TEXT DEFAULT '',
      amountPaise INTEGER DEFAULT 0,
      settlementChargePaise INTEGER DEFAULT 0,
      netPaise INTEGER DEFAULT 0,
      paymentDate TEXT DEFAULT '',
      creditedDate TEXT DEFAULT '',
      status TEXT DEFAULT 'unmatched',
      invoiceId TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      rawJson TEXT DEFAULT '{}',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodPendingSettlements (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      mode TEXT DEFAULT 'online',
      grossPaise INTEGER DEFAULT 0,
      netPaise INTEGER DEFAULT 0,
      paymentRef TEXT DEFAULT '',
      expectedCreditDate TEXT DEFAULT '',
      creditedAt TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      settlementId TEXT DEFAULT '',
      importRowId TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, sessionId, mode, paymentRef)
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodDepositSlips (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      slipNo TEXT NOT NULL,
      amountPaise INTEGER DEFAULT 0,
      denominationBreakdown TEXT DEFAULT '[]',
      status TEXT DEFAULT 'draft',
      bankName TEXT DEFAULT '',
      depositRef TEXT DEFAULT '',
      depositedBy TEXT DEFAULT '',
      depositedAt TEXT DEFAULT '',
      confirmedBy TEXT DEFAULT '',
      confirmedAt TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, slipNo)
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodAccountingPostings (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      businessDate TEXT NOT NULL,
      journalEntryId TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      debitPaise INTEGER DEFAULT 0,
      creditPaise INTEGER DEFAULT 0,
      lineBreakdown TEXT DEFAULT '[]',
      failureReason TEXT DEFAULT '',
      postedBy TEXT DEFAULT '',
      postedAt TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, sessionId)
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodTaxRegisters (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      businessDate TEXT NOT NULL,
      country TEXT DEFAULT 'IN',
      taxType TEXT DEFAULT 'GST',
      grossSalesPaise INTEGER DEFAULT 0,
      taxableSalesPaise INTEGER DEFAULT 0,
      outputTaxPaise INTEGER DEFAULT 0,
      gstPaise INTEGER DEFAULT 0,
      vatPaise INTEGER DEFAULT 0,
      invoiceCount INTEGER DEFAULT 0,
      registerJson TEXT DEFAULT '{}',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, sessionId)
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodTallyExports (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      businessDate TEXT NOT NULL,
      format TEXT DEFAULT 'csv',
      fileName TEXT DEFAULT '',
      content TEXT DEFAULT '',
      createdBy TEXT DEFAULT '',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodProfitFeeds (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      businessDate TEXT NOT NULL,
      cashPositionPaise INTEGER DEFAULT 0,
      bankSettlementPaise INTEGER DEFAULT 0,
      gatewayChargePaise INTEGER DEFAULT 0,
      variancePaise INTEGER DEFAULT 0,
      journalEntryId TEXT DEFAULT '',
      payloadJson TEXT DEFAULT '{}',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, sessionId)
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodRiskEvents (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      businessDate TEXT NOT NULL,
      cashierId TEXT DEFAULT '',
      code TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'low',
      scoreImpact INTEGER DEFAULT 0,
      title TEXT NOT NULL,
      detail TEXT DEFAULT '',
      status TEXT DEFAULT 'open',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashDrawerEodApprovalRequests (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      businessDate TEXT NOT NULL,
      approvalType TEXT NOT NULL DEFAULT 'cashRiskClose',
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT NOT NULL,
      requestedBy TEXT DEFAULT '',
      requestedAt TEXT NOT NULL,
      reviewedBy TEXT DEFAULT '',
      reviewedAt TEXT DEFAULT '',
      reviewNote TEXT DEFAULT '',
      riskScore INTEGER DEFAULT 0,
      blockers TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      approvalToken TEXT DEFAULT '',
      approvalTokenExpiresAt TEXT DEFAULT '',
      approvalLink TEXT DEFAULT '',
      whatsappMessageId TEXT DEFAULT '',
      whatsappMessage TEXT DEFAULT '',
      whatsappDeepLink TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_sessions_day
      ON cash_drawer_sessions(tenant_id, branch_id, businessDate, status);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_denoms_session
      ON cashDrawerEodDenominations(tenantId, branchId, sessionId);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_collections_session
      ON cashDrawerEodCollections(tenantId, branchId, sessionId);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_settlements_session
      ON cashDrawerEodSettlements(tenantId, branchId, sessionId);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_reports_day
      ON cashDrawerEodReports(tenantId, branchId, businessDate);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_tills_session
      ON cashDrawerEodTills(tenantId, branchId, sessionId, status);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_ops_session
      ON cashDrawerEodCashOperations(tenantId, branchId, sessionId, type);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_handovers_session
      ON cashDrawerEodHandovers(tenantId, branchId, sessionId, handedOverAt);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_three_way_session
      ON cashDrawerEodThreeWayMatches(tenantId, branchId, sessionId, status);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_import_rows_session
      ON cashDrawerEodSettlementImportRows(tenantId, branchId, sessionId, status);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_pending_status
      ON cashDrawerEodPendingSettlements(tenantId, branchId, status, expectedCreditDate);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_deposit_slips_session
      ON cashDrawerEodDepositSlips(tenantId, branchId, sessionId, status);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_accounting_session
      ON cashDrawerEodAccountingPostings(tenantId, branchId, sessionId, status);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_tax_register_day
      ON cashDrawerEodTaxRegisters(tenantId, branchId, businessDate);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_profit_feed_day
      ON cashDrawerEodProfitFeeds(tenantId, branchId, businessDate);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_risk_session
      ON cashDrawerEodRiskEvents(tenantId, branchId, sessionId, severity);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_approval_status
      ON cashDrawerEodApprovalRequests(tenantId, branchId, status, requestedAt);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_eod_approval_session
      ON cashDrawerEodApprovalRequests(tenantId, branchId, sessionId, status);
  `);

  ensureColumn("cashDrawerEodSettlements", "settlementStatus", "TEXT DEFAULT 'pending'");
  ensureColumn("cashDrawerEodSettlements", "creditedAt", "TEXT DEFAULT ''");
  ensureColumn("cashDrawerEodSettlements", "importBatchId", "TEXT DEFAULT ''");
  ensureColumn("cashDrawerEodSettlements", "matchedInvoiceIds", "TEXT DEFAULT '[]'");

  ensureColumn("cashDrawerEodReports", "cashOperationImpactPaise", "INTEGER DEFAULT 0");
  ensureColumn("cashDrawerEodReports", "cashDropPaise", "INTEGER DEFAULT 0");
  ensureColumn("cashDrawerEodReports", "cashPickupPaise", "INTEGER DEFAULT 0");
  ensureColumn("cashDrawerEodReports", "pettyCashPayoutPaise", "INTEGER DEFAULT 0");
  ensureColumn("cashDrawerEodReports", "safeMovePaise", "INTEGER DEFAULT 0");
  ensureColumn("cashDrawerEodReports", "floatSuggestion", "TEXT DEFAULT '{}'");
  ensureColumn("cashDrawerEodReports", "tillBreakdown", "TEXT DEFAULT '[]'");
  ensureColumn("cashDrawerEodReports", "operationBreakdown", "TEXT DEFAULT '[]'");
  ensureColumn("cashDrawerEodReports", "handoverBreakdown", "TEXT DEFAULT '[]'");
  ensureColumn("cashDrawerEodReports", "journalEntryId", "TEXT DEFAULT ''");
  ensureColumn("cashDrawerEodReports", "accountingStatus", "TEXT DEFAULT 'pending'");
  ensureColumn("cashDrawerEodReports", "taxRegisterId", "TEXT DEFAULT ''");
  ensureColumn("cashDrawerEodReports", "tallyExportId", "TEXT DEFAULT ''");

  ensureColumn("cashDrawerEodApprovalRequests", "approvalToken", "TEXT DEFAULT ''");
  ensureColumn("cashDrawerEodApprovalRequests", "approvalTokenExpiresAt", "TEXT DEFAULT ''");
  ensureColumn("cashDrawerEodApprovalRequests", "approvalLink", "TEXT DEFAULT ''");
  ensureColumn("cashDrawerEodApprovalRequests", "whatsappMessageId", "TEXT DEFAULT ''");
  ensureColumn("cashDrawerEodApprovalRequests", "whatsappMessage", "TEXT DEFAULT ''");
  ensureColumn("cashDrawerEodApprovalRequests", "whatsappDeepLink", "TEXT DEFAULT ''");

  ensured = true;
}
