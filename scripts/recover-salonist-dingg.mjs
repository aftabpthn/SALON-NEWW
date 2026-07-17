import { createHash } from "node:crypto";
import XLSX from "xlsx";
import { db } from "../server/db.js";
import { balanceSheetService } from "../server/services/balance-sheet.service.js";
import { ensureMigrationTargetMetadataSchema } from "../server/services/migration-target-metadata-schema.service.js";
import { migrationService } from "../server/services/migration.service.js";

const TENANT_ID = "tenant_salonist";
const BRANCH_ID = "branch_363bdc6b-2";
const OWNER_ID = "tu_6abfbedb-a";
const RECOVERY_JOB_ID = "migrec_salonist_missing_v1";
const RECOVERY_BATCH_ID = "batchrec_salonist_missing_v1";
const stamp = new Date().toISOString();
const access = { tenantId: TENANT_ID, branchId: BRANCH_ID, branchIds: [BRANCH_ID], role: "owner", userId: OWNER_ID };

const clean = (value) => String(value ?? "").trim();
const amount = (value) => {
  const parsed = Number(clean(value).replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const paise = (value) => Math.round(amount(value) * 100);
const phone = (value) => {
  const digits = clean(value).replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};
const key = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
const bool = (value) => ["yes", "true", "1", "y", "enabled"].includes(clean(value).toLowerCase());
const idFor = (prefix, value) => `${prefix}_${createHash("sha256").update(`${TENANT_ID}:${value}`).digest("hex").slice(0, 16)}`;
const rowsFor = (workbook, sheet) => XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { defval: "", raw: true, blankrows: false });
const dateIso = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const text = clean(value);
  if (!text) return "";
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let first = Number(slash[1]), second = Number(slash[2]), year = Number(slash[3]);
    if (year < 100) year += 2000;
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;
    return new Date(Date.UTC(year, month - 1, day)).toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};

ensureMigrationTargetMetadataSchema();

const dingg = XLSX.readFile("DINGG DATA TO SALONIST.xlsx", { cellDates: true, cellFormula: false });
const salonist = XLSX.readFile("DINGG EXCEL.xlsx", { cellDates: true, cellFormula: false });
const clientsSource = rowsFor(dingg, "clint ");
const customersSource = rowsFor(salonist, "Customers");
const serviceHistorySource = rowsFor(salonist, "Service History");
const unpaidInvoiceSource = rowsFor(dingg, "clint unpadie");
const serviceSource = rowsFor(salonist, "Services");
const productSource = rowsFor(salonist, "Products");
const membershipSource = rowsFor(salonist, "Membership");
const invoiceSource = rowsFor(dingg, "invoice");

const result = {
  imported: {},
  autoFixed: {},
  needsReview: {},
  failed: 0,
  silentSkipped: 0,
  storedFields: []
};

function upsertRecoveryJob(status = "running", summary = {}) {
  db.prepare(`
    INSERT INTO migration_large_jobs (
      id, tenantId, branchId, sourceSoftware, resource, fileName, status,
      totalRows, processedRows, validRows, warningRows, errorRows, importedRows, skippedRows,
      mapping, settings, summary, createdBy, startedAt, completedAt, createdAt, updatedAt
    ) VALUES (
      @id, @tenantId, @branchId, @sourceSoftware, @resource, @fileName, @status,
      @totalRows, @processedRows, @validRows, @warningRows, @errorRows, @importedRows, 0,
      @mapping, @settings, @summary, @createdBy, @startedAt, @completedAt, @createdAt, @updatedAt
    ) ON CONFLICT(id) DO UPDATE SET
      status=excluded.status, totalRows=excluded.totalRows, processedRows=excluded.processedRows,
      validRows=excluded.validRows, warningRows=excluded.warningRows, errorRows=excluded.errorRows,
      importedRows=excluded.importedRows, skippedRows=0, summary=excluded.summary,
      completedAt=excluded.completedAt, updatedAt=excluded.updatedAt
  `).run({
    id: RECOVERY_JOB_ID,
    tenantId: TENANT_ID,
    branchId: BRANCH_ID,
    sourceSoftware: "dingg",
    resource: "recovery",
    fileName: "DINGG DATA TO SALONIST.xlsx + DINGG EXCEL.xlsx",
    status,
    totalRows: Number(summary.totalRows || 0),
    processedRows: Number(summary.processedRows || 0),
    validRows: Number(summary.validRows || 0),
    warningRows: Number(summary.warningRows || 0),
    errorRows: Number(summary.errorRows || 0),
    importedRows: Number(summary.importedRows || 0),
    mapping: "{}",
    settings: JSON.stringify({ additive: true, idempotent: true, preserveExisting: true }),
    summary: JSON.stringify(summary),
    createdBy: OWNER_ID,
    startedAt: stamp,
    completedAt: status === "completed" ? stamp : "",
    createdAt: stamp,
    updatedAt: stamp
  });
}

function stageRow({ sourceSheet, sourceRowNumber, resource, sourceExternalId, status, action, targetId = "", raw, warnings = [] }) {
  const id = idFor("migstage", `${sourceSheet}:${sourceRowNumber}:${resource}`);
  db.prepare(`
    INSERT INTO migration_staging_rows (
      id, tenantId, branchId, jobId, resource, sourceSheet, sourceRowNumber, sourceExternalId,
      status, action, targetId, payload, raw, errors, warnings, createdAt, updatedAt
    ) VALUES (
      @id, @tenantId, @branchId, @jobId, @resource, @sourceSheet, @sourceRowNumber, @sourceExternalId,
      @status, @action, @targetId, @payload, @raw, '[]', @warnings, @createdAt, @updatedAt
    ) ON CONFLICT(id) DO UPDATE SET
      status=excluded.status, action=excluded.action, targetId=excluded.targetId,
      payload=excluded.payload, raw=excluded.raw, errors='[]', warnings=excluded.warnings, updatedAt=excluded.updatedAt
  `).run({
    id,
    tenantId: TENANT_ID,
    branchId: BRANCH_ID,
    jobId: RECOVERY_JOB_ID,
    resource,
    sourceSheet,
    sourceRowNumber,
    sourceExternalId,
    status,
    action,
    targetId,
    payload: JSON.stringify({ targetId, recoveryBatchId: RECOVERY_BATCH_ID }),
    raw: JSON.stringify(raw || {}),
    warnings: JSON.stringify(warnings),
    createdAt: stamp,
    updatedAt: stamp
  });
  return id;
}

function clientByPhoneOrName(clientPhone, name) {
  const normalizedPhone = phone(clientPhone);
  if (normalizedPhone) {
    const byPhone = db.prepare(`
      SELECT * FROM clients WHERE tenantId=@tenantId AND branchId=@branchId
      AND substr(replace(replace(replace(phone, ' ', ''), '-', ''), '+', ''), -10)=@phone LIMIT 1
    `).get({ tenantId: TENANT_ID, branchId: BRANCH_ID, phone: normalizedPhone });
    if (byPhone) return byPhone;
  }
  const normalizedName = key(name);
  return normalizedName
    ? db.prepare("SELECT * FROM clients WHERE tenantId=@tenantId AND branchId=@branchId AND lower(replace(name, ' ', ''))=@name LIMIT 1")
      .get({ tenantId: TENANT_ID, branchId: BRANCH_ID, name: normalizedName })
    : null;
}

function ensureRecoveryClient({ id, name, originalRecordId, notes }) {
  db.prepare(`
    INSERT INTO clients (
      id, tenantId, branchId, name, phone, email, gender, birthday, anniversary, tags, notes,
      walletBalance, loyaltyPoints, totalSpend, visitCount, lastVisitAt, visitHistory, purchaseHistory,
      whatsappHistory, consentForms, communicationPreferences, imported, originalSystem,
      originalRecordId, importedAt, importBatchId, createdAt, updatedAt
    ) VALUES (
      @id, @tenantId, @branchId, @name, '', '', '', '', '', '[]', @notes,
      0, 0, 0, 0, '', '[]', '[]', '[]', '[]', '{}', 1, 'dingg',
      @originalRecordId, @stamp, @batchId, @stamp, @stamp
    ) ON CONFLICT(id) DO UPDATE SET name=excluded.name, notes=excluded.notes, updatedAt=excluded.updatedAt
  `).run({ id, tenantId: TENANT_ID, branchId: BRANCH_ID, name, notes, originalRecordId, stamp, batchId: RECOVERY_BATCH_ID });
  return db.prepare("SELECT * FROM clients WHERE id=@id AND tenantId=@tenantId").get({ id, tenantId: TENANT_ID });
}

upsertRecoveryJob();

let unknownClient;
const recoveryTx = db.transaction(() => {
  const walikinRowNumber = clientsSource.findIndex((row) => clean(row.Code) === "SKA3668") + 2;
  const walikinRaw = clientsSource[walikinRowNumber - 2];
  const walikin = ensureRecoveryClient({
    id: idFor("clientrec", "clint:SKA3668"),
    name: clean(walikinRaw.Name) || "WALIKIN (Walk-in/Unknown)",
    originalRecordId: "SKA3668",
    notes: "Walk-in/Unknown customer recovered without source phone"
  });
  stageRow({
    sourceSheet: "clint",
    sourceRowNumber: walikinRowNumber,
    resource: "clients",
    sourceExternalId: "SKA3668",
    status: "needs_review",
    action: "imported_missing_phone",
    targetId: walikin.id,
    raw: walikinRaw,
    warnings: ["Source phone is missing"]
  });
  result.imported.walikinCustomer = 1;
  result.needsReview.missingPhoneCustomer = 1;

  unknownClient = ensureRecoveryClient({
    id: idFor("clientrec", "unknown-history-client"),
    name: "Unknown Customer (Recovered History)",
    originalRecordId: "recovery:unknown-history-client",
    notes: "Deterministic client for source history rows with blank customer identity"
  });

  let genderMerged = 0;
  const sourceClientByPhone = new Map(clientsSource.map((row) => [phone(row.Mobile), row]));
  for (const row of customersSource) {
    const existingSource = sourceClientByPhone.get(phone(row.Mobile));
    if (!existingSource || clean(existingSource.Gender) || !clean(row.Gender)) continue;
    const target = clientByPhoneOrName(row.Mobile, row.Name);
    if (!target || clean(target.gender)) continue;
    db.prepare("UPDATE clients SET gender=@gender, updatedAt=@updatedAt WHERE id=@id AND tenantId=@tenantId")
      .run({ gender: clean(row.Gender), updatedAt: stamp, id: target.id, tenantId: TENANT_ID });
    genderMerged++;
  }
  result.autoFixed.customerGenderMerged = customersSource.filter((row) => {
    const original = sourceClientByPhone.get(phone(row.Mobile));
    if (!original || clean(original.Gender) || !clean(row.Gender)) return false;
    return clean(clientByPhoneOrName(row.Mobile, row.Name)?.gender).toLowerCase() === clean(row.Gender).toLowerCase();
  }).length;

  let consentUpdated = 0;
  for (const row of clientsSource) {
    const target = clean(row.Code) === "SKA3668"
      ? walikin
      : db.prepare("SELECT * FROM clients WHERE tenantId=@tenantId AND originalSystem=@system AND originalRecordId=@recordId LIMIT 1")
        .get({ tenantId: TENANT_ID, system: "dingg", recordId: clean(row.Code) }) || clientByPhoneOrName(row.Mobile, row.Name);
    if (!target) throw new Error(`Client consent target missing for ${clean(row.Code) || clean(row.Name)}`);
    const preferences = {
      transactional: {
        sms: bool(row["Transaction Sms"]),
        email: bool(row["Transaction Email"]),
        whatsapp: bool(row["Transaction Whatsapp"])
      },
      promotional: {
        sms: bool(row["Promotional Sms"]),
        email: bool(row["Promotional Email"]),
        whatsapp: bool(row["Promotional Whatsapp"])
      },
      source: "dingg",
      sourceRecordId: clean(row.Code)
    };
    db.prepare("UPDATE clients SET communicationPreferences=@preferences, updatedAt=@updatedAt WHERE id=@id AND tenantId=@tenantId")
      .run({ preferences: JSON.stringify(preferences), updatedAt: stamp, id: target.id, tenantId: TENANT_ID });
    db.prepare(`
      INSERT INTO client_communication_consents (
        id, tenantId, branchId, clientId, sourceSystem, sourceRecordId,
        transactionalSms, promotionalSms, transactionalEmail, promotionalEmail,
        transactionalWhatsapp, promotionalWhatsapp, raw, createdAt, updatedAt
      ) VALUES (
        @id, @tenantId, @branchId, @clientId, 'dingg', @sourceRecordId,
        @transactionalSms, @promotionalSms, @transactionalEmail, @promotionalEmail,
        @transactionalWhatsapp, @promotionalWhatsapp, @raw, @createdAt, @updatedAt
      ) ON CONFLICT(tenantId, branchId, sourceSystem, sourceRecordId) DO UPDATE SET
        clientId=excluded.clientId, transactionalSms=excluded.transactionalSms,
        promotionalSms=excluded.promotionalSms, transactionalEmail=excluded.transactionalEmail,
        promotionalEmail=excluded.promotionalEmail, transactionalWhatsapp=excluded.transactionalWhatsapp,
        promotionalWhatsapp=excluded.promotionalWhatsapp, raw=excluded.raw, updatedAt=excluded.updatedAt
    `).run({
      id: idFor("consentrec", clean(row.Code) || `clint:${consentUpdated + 2}`),
      tenantId: TENANT_ID,
      branchId: BRANCH_ID,
      clientId: target.id,
      sourceRecordId: clean(row.Code) || `clint:${consentUpdated + 2}`,
      transactionalSms: preferences.transactional.sms ? 1 : 0,
      promotionalSms: preferences.promotional.sms ? 1 : 0,
      transactionalEmail: preferences.transactional.email ? 1 : 0,
      promotionalEmail: preferences.promotional.email ? 1 : 0,
      transactionalWhatsapp: preferences.transactional.whatsapp ? 1 : 0,
      promotionalWhatsapp: preferences.promotional.whatsapp ? 1 : 0,
      raw: JSON.stringify(row),
      createdAt: stamp,
      updatedAt: stamp
    });
    consentUpdated++;
  }
  result.imported.customerConsentPreferences = consentUpdated;
  result.storedFields.push("clients.communicationPreferences", "clients.gender", "client_communication_consents.*");

  const serviceByName = new Map(db.prepare("SELECT * FROM services WHERE tenantId=@tenantId").all({ tenantId: TENANT_ID }).map((row) => [key(row.name), row]));
  let membershipPrices = 0;
  for (const [index, row] of serviceSource.entries()) {
    const target = serviceByName.get(key(row["Service Name"]));
    if (!target) throw new Error(`Service target missing for source row ${index + 2}`);
    const sourceExternalId = `Services:${index + 2}`;
    if (sourceExternalId === "Services:159") continue;
    db.prepare("UPDATE services SET membershipPricePaise=@price, membershipPriceRecorded=1, updatedAt=@updatedAt WHERE id=@id AND tenantId=@tenantId")
      .run({ price: paise(row["membership price"]), updatedAt: stamp, id: target.id, tenantId: TENANT_ID });
    membershipPrices++;
  }
  const nailArts = serviceByName.get(key("Nail Arts"));
  const duplicateNailRaw = serviceSource[157];
  const nailMapId = idFor("migmap", "services:Services:159");
  db.prepare(`
    INSERT INTO migration_id_map (
      id, tenantId, jobId, sourceSoftware, resource, sourceExternalId, targetId, targetTable,
      branchId, confidence, linkType, createdAt, updatedAt
    ) VALUES (
      @id, @tenantId, @jobId, 'dingg', 'services', 'Services:159', @targetId, 'services',
      @branchId, 100, 'linked', @stamp, @stamp
    ) ON CONFLICT(tenantId, jobId, resource, sourceExternalId) DO UPDATE SET
      targetId=excluded.targetId, confidence=100, linkType='linked', updatedAt=excluded.updatedAt
  `).run({ id: nailMapId, tenantId: TENANT_ID, jobId: RECOVERY_JOB_ID, targetId: nailArts.id, branchId: BRANCH_ID, stamp });
  stageRow({
    sourceSheet: "Services",
    sourceRowNumber: 159,
    resource: "services",
    sourceExternalId: "Services:159",
    status: "auto_fixed",
    action: "linked_duplicate",
    targetId: nailArts.id,
    raw: duplicateNailRaw,
    warnings: ["Duplicate service linked to existing Nail Arts; conflicting source price preserved"]
  });
  result.imported.serviceMembershipPrices = membershipPrices;
  result.autoFixed.duplicateNailArtsLinked = 1;
  result.storedFields.push("services.membershipPricePaise", "migration_id_map.targetId");

  const products = db.prepare("SELECT * FROM products WHERE tenantId=@tenantId AND branchId=@branchId").all({ tenantId: TENANT_ID, branchId: BRANCH_ID });
  const productBySource = new Map(products.map((row) => [clean(row.originalRecordId), row]));
  const seenProductSkus = new Set();
  const sourceQrCounts = productSource.reduce((counts, row) => {
    const sourceQrCode = clean(row["QR Code"]);
    if (sourceQrCode) counts.set(sourceQrCode, (counts.get(sourceQrCode) || 0) + 1);
    return counts;
  }, new Map());
  let issueValues = 0, issueTransactions = 0, qrCodes = 0;
  for (const [index, row] of productSource.entries()) {
    if (!clean(row["Product Name"])) continue;
    const rowNumber = index + 2;
    const sourceSku = clean(row["SKU NO "]) || `DINGG-${String(rowNumber).padStart(5, "0")}`;
    const targetSku = seenProductSkus.has(sourceSku.toLowerCase()) ? `${sourceSku}-${rowNumber}` : sourceSku;
    seenProductSkus.add(targetSku.toLowerCase());
    const target = productBySource.get(targetSku) || products.find((item) => key(item.name) === key(row["Product Name"]));
    if (!target) throw new Error(`Product target missing for source row ${rowNumber}`);
    if (clean(row.Issue) !== "") {
      const quantity = amount(row.Issue);
      db.prepare(`
        UPDATE products SET legacyIssueQuantity=@quantity, legacyIssueRecorded=1, updatedAt=@updatedAt
        WHERE id=@id AND tenantId=@tenantId
      `).run({ quantity, updatedAt: stamp, id: target.id, tenantId: TENANT_ID });
      issueValues++;
      if (quantity !== 0) {
        const txId = idFor("invtxrec", `Products:${rowNumber}:issue`);
        db.prepare(`
          INSERT INTO inventory_transactions (
            id, tenantId, productId, branchId, type, quantity, unitCost, totalCost, reason,
            referenceType, referenceId, createdAt, imported, originalSystem, originalRecordId, importedAt, importBatchId
          ) VALUES (
            @id, @tenantId, @productId, @branchId, 'historical_issue', @quantity, @unitCost, @totalCost, @reason,
            'migration_recovery', @batchId, @createdAt, 1, 'dingg', @originalRecordId, @importedAt, @batchId
          ) ON CONFLICT(id) DO UPDATE SET
            quantity=excluded.quantity, unitCost=excluded.unitCost, totalCost=excluded.totalCost,
            reason=excluded.reason, importedAt=excluded.importedAt
        `).run({
          id: txId,
          tenantId: TENANT_ID,
          productId: target.id,
          branchId: BRANCH_ID,
          quantity: -Math.abs(quantity),
          unitCost: amount(row["Cost Price"]),
          totalCost: -Math.abs(quantity) * amount(row["Cost Price"]),
          reason: "Recovered DINGG historical Issue value; current product stock intentionally unchanged",
          batchId: RECOVERY_BATCH_ID,
          createdAt: stamp,
          originalRecordId: `Products:${rowNumber}:issue`,
          importedAt: stamp
        });
        issueTransactions++;
      }
    }
    if (clean(row["QR Code"])) {
      const sourceQrCode = clean(row["QR Code"]);
      const qrCode = sourceQrCounts.get(sourceQrCode) > 1 ? `DINGG-${rowNumber}-${sourceQrCode}` : sourceQrCode;
      db.prepare("UPDATE products SET sourceQrCode=@sourceQrCode, qrCode=@qrCode, updatedAt=@updatedAt WHERE id=@id AND tenantId=@tenantId")
        .run({ sourceQrCode, qrCode, updatedAt: stamp, id: target.id, tenantId: TENANT_ID });
      qrCodes++;
    }
  }
  result.imported.productIssueValues = issueValues;
  result.imported.historicalIssueTransactions = issueTransactions;
  result.imported.productQrCodes = qrCodes;
  result.autoFixed.duplicateQrCodesDisambiguated = [...sourceQrCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  result.storedFields.push("products.legacyIssueQuantity", "products.legacyIssueRecorded", "products.sourceQrCode", "products.qrCode", "inventory_transactions.quantity");

  const liveStaff = db.prepare("SELECT * FROM staff WHERE tenantId=@tenantId AND branchId=@branchId").all({ tenantId: TENANT_ID, branchId: BRANCH_ID });
  const exactStaff = new Map(liveStaff.map((row) => [key(row.name), row]));
  const primaryStaff = liveStaff.filter((row) => clean(row.originalRecordId).startsWith("Staff:"));
  const primaryExactStaff = new Map(primaryStaff.map((row) => [key(row.name), row]));
  const primaryStaffTokens = new Map();
  for (const row of primaryStaff) {
    for (const token of clean(row.name).split(/\s+/).map(key).filter(Boolean)) {
      if (!primaryStaffTokens.has(token)) primaryStaffTokens.set(token, row);
    }
  }
  const aliases = new Map();
  for (const row of liveStaff) {
    const firstName = key(clean(row.name).split(/\s+/)[0]);
    if (firstName && !aliases.has(firstName)) aliases.set(firstName, row);
  }
  let historicalStaffCreated = 0;
  const staffForName = (name) => {
    const normalized = key(name);
    let target = primaryExactStaff.get(normalized)
      || primaryStaffTokens.get(normalized)
      || primaryStaff.find((row) => key(row.name).startsWith(normalized))
      || exactStaff.get(normalized)
      || aliases.get(normalized)
      || liveStaff.find((row) => key(row.name).startsWith(normalized));
    if (target) return target;
    const id = idFor("staffrec", `membership:${normalized}`);
    db.prepare(`
      INSERT INTO staff (
        id, tenantId, branchId, name, role, phone, email, shift, status, assignedServices,
        commissionRule, attendance, performance, createdAt, updatedAt, imported, originalSystem,
        originalRecordId, importedAt, importBatchId
      ) VALUES (
        @id, @tenantId, @branchId, @name, 'Historical staff', '', '', '', 'inactive', '[]',
        '{}', '[]', '{}', @stamp, @stamp, 1, 'dingg', @originalRecordId, @stamp, @batchId
      ) ON CONFLICT(id) DO UPDATE SET name=excluded.name, updatedAt=excluded.updatedAt
    `).run({ id, tenantId: TENANT_ID, branchId: BRANCH_ID, name: clean(name), stamp, originalRecordId: `Membership Staff:${clean(name)}`, batchId: RECOVERY_BATCH_ID });
    target = db.prepare("SELECT * FROM staff WHERE id=@id AND tenantId=@tenantId").get({ id, tenantId: TENANT_ID });
    liveStaff.push(target);
    exactStaff.set(normalized, target);
    aliases.set(normalized, target);
    historicalStaffCreated++;
    return target;
  };
  let membershipStaffMapped = 0;
  for (const [index, row] of membershipSource.entries()) {
    const staffName = clean(row["STAFF NAME "]);
    if (!staffName) continue;
    const originalRecordId = `Membership:${index + 2}`;
    const membership = db.prepare("SELECT * FROM memberships WHERE tenantId=@tenantId AND originalSystem='dingg' AND originalRecordId=@originalRecordId LIMIT 1")
      .get({ tenantId: TENANT_ID, originalRecordId });
    if (!membership) throw new Error(`Membership target missing for ${originalRecordId}`);
    const staff = staffForName(staffName);
    db.prepare(`
      UPDATE memberships SET soldByStaffId=@staffId, soldByStaffName=@staffName, updatedAt=@updatedAt
      WHERE id=@id AND tenantId=@tenantId
    `).run({ staffId: staff.id, staffName, updatedAt: stamp, id: membership.id, tenantId: TENANT_ID });
    membershipStaffMapped++;
  }
  result.imported.membershipStaffMappings = membershipStaffMapped;
  result.autoFixed.historicalStaffCreated = db.prepare(`
    SELECT COUNT(*) AS count FROM staff
    WHERE tenantId=@tenantId AND originalSystem='dingg' AND originalRecordId LIKE 'Membership Staff:%'
  `).get({ tenantId: TENANT_ID }).count;
  result.storedFields.push("memberships.soldByStaffId", "memberships.soldByStaffName");

  let packageCreditsRecovered = 0;
  for (const [index, row] of rowsFor(salonist, "Package Balance").entries()) {
    if (!clean(row.CustomerName)) continue;
    const originalRecordId = `Package Balance:${index + 2}`;
    const updated = db.prepare(`
      UPDATE memberships SET
        planCredits=@planCredits, creditsRemaining=@creditsRemaining, updatedAt=@updatedAt
      WHERE tenantId=@tenantId AND originalSystem='dingg' AND originalRecordId=@originalRecordId
    `).run({
      planCredits: Math.round(amount(row["Origna Mnts"])),
      creditsRemaining: Math.round(amount(row["Remaingi Balance"])),
      updatedAt: stamp,
      tenantId: TENANT_ID,
      originalRecordId
    });
    if (updated.changes !== 1) throw new Error(`Package membership target missing for ${originalRecordId}`);
    packageCreditsRecovered++;
  }
  result.autoFixed.packageCreditBalancesRecovered = packageCreditsRecovered;
  result.storedFields.push("memberships.planCredits", "memberships.creditsRemaining");

  const visitCountByClient = new Map();
  for (const row of clientsSource) {
    const target = clean(row.Code) === "SKA3668"
      ? walikin
      : db.prepare("SELECT * FROM clients WHERE tenantId=@tenantId AND originalSystem='dingg' AND originalRecordId=@originalRecordId LIMIT 1")
        .get({ tenantId: TENANT_ID, originalRecordId: clean(row.Code) }) || clientByPhoneOrName(row.Mobile, row.Name);
    if (!target) throw new Error(`Visit-count target missing for ${clean(row.Code) || clean(row.Name)}`);
    visitCountByClient.set(target.id, (visitCountByClient.get(target.id) || 0) + Math.round(amount(row.Visit)));
  }
  db.prepare("UPDATE clients SET visitCount=0, updatedAt=@updatedAt WHERE tenantId=@tenantId AND originalSystem='dingg'")
    .run({ updatedAt: stamp, tenantId: TENANT_ID });
  const updateVisitCount = db.prepare("UPDATE clients SET visitCount=@visitCount, updatedAt=@updatedAt WHERE tenantId=@tenantId AND id=@id");
  for (const [id, visitCount] of visitCountByClient) updateVisitCount.run({ visitCount, updatedAt: stamp, tenantId: TENANT_ID, id });
  result.autoFixed.customerVisitCountsReconciled = clientsSource.length;
  result.storedFields.push("clients.visitCount");

  const syncInvoiceAliases = db.prepare(`
    UPDATE invoices SET
      tenant_id=@tenantId, branch_id=branchId, customer_id=clientId, invoice_no=invoiceNumber,
      payment_status=status, paid_amount=paid, due_amount=balance, discount_total=discount,
      grand_total=total, created_at=createdAt, updated_at=@updatedAt,
      subtotal_paise=ROUND(subtotal * 100), discount_total_paise=ROUND(discount * 100),
      tax_total_paise=ROUND(gstAmount * 100), grand_total_paise=ROUND(total * 100),
      paid_amount_paise=ROUND(paid * 100), due_amount_paise=ROUND(balance * 100)
    WHERE tenantId=@tenantId
  `);
  result.autoFixed.invoiceEnterpriseAliasesSynced = syncInvoiceAliases.run({ tenantId: TENANT_ID, updatedAt: stamp }).changes;
  result.storedFields.push("invoices.tenant_id", "invoices.branch_id", "invoices.invoice_no", "invoices.*_paise");

  const miscRows = XLSX.utils.sheet_to_json(salonist.Sheets.Miscellaneous, { header: 1, defval: "", raw: true, blankrows: false });
  const misc = Object.fromEntries(miscRows.map(([label, value]) => [key(label), clean(value)]));
  const businessKey = `business.details.settings.${BRANCH_ID}`;
  const reputationKey = `marketplace.reputation.settings.${BRANCH_ID}`;
  const existingBusiness = db.prepare("SELECT * FROM settings WHERE tenantId=@tenantId AND key=@key").get({ tenantId: TENANT_ID, key: businessKey });
  const existingReputation = db.prepare("SELECT * FROM settings WHERE tenantId=@tenantId AND key=@key").get({ tenantId: TENANT_ID, key: reputationKey });
  const parseJson = (value) => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
  const businessValue = parseJson(existingBusiness?.value);
  businessValue.settings = businessValue.settings || {};
  businessValue.settings.socialOnlineProfile = {
    ...(businessValue.settings.socialOnlineProfile || {}),
    googleProfileLink: misc.goolellink || "",
    facebookLink: misc.facebooklink || "",
    instagramLink: misc.instagram || ""
  };
  businessValue.settings.branding = { ...(businessValue.settings.branding || {}), logoUrl: misc.logo || "" };
  businessValue.settings.legalRegistration = {
    ...(businessValue.settings.legalRegistration || {}),
    registrationNumber: misc.taxnumber || "",
    registrationLabel: "GSTIN"
  };
  const reputationValue = parseJson(existingReputation?.value);
  reputationValue.settings = { ...(reputationValue.settings || {}), googleReviewUrl: misc.goolereviewlink || "" };
  const upsertSetting = db.prepare(`
    INSERT INTO settings (id, tenantId, branchId, key, value, scope, createdAt, updatedAt)
    VALUES (@id, @tenantId, @branchId, @key, @value, 'branch', @stamp, @stamp)
    ON CONFLICT(tenantId, key) DO UPDATE SET branchId=excluded.branchId, value=excluded.value, updatedAt=excluded.updatedAt
  `);
  upsertSetting.run({ id: idFor("settingrec", businessKey), tenantId: TENANT_ID, branchId: BRANCH_ID, key: businessKey, value: JSON.stringify(businessValue), stamp });
  upsertSetting.run({ id: idFor("settingrec", reputationKey), tenantId: TENANT_ID, branchId: BRANCH_ID, key: reputationKey, value: JSON.stringify(reputationValue), stamp });
  db.prepare("UPDATE branches SET gstin=@gstin, updatedAt=@updatedAt WHERE id=@branchId AND tenantId=@tenantId")
    .run({ gstin: misc.taxnumber || "", updatedAt: stamp, branchId: BRANCH_ID, tenantId: TENANT_ID });
  result.imported.miscellaneousSettings = 5;
  result.storedFields.push("settings.value", "branches.gstin");

  const dailyRows = XLSX.utils.sheet_to_json(salonist.Sheets["Daily reports "], { header: 1, defval: "", raw: true, blankrows: false });
  for (let index = 0; index < dailyRows.length; index++) {
    const [serialNumber, email, name, designation] = dailyRows[index];
    const isHeader = index === 0;
    stageRow({
      sourceSheet: "Daily reports",
      sourceRowNumber: index + 2,
      resource: "tenant_users",
      sourceExternalId: `Daily reports:${index + 2}`,
      status: isHeader ? "auto_fixed" : "needs_review",
      action: isHeader ? "header_preserved" : "review_identity",
      raw: { serialNumber, email, name, designation },
      warnings: isHeader ? [] : clean(email) ? ["Source owner email is malformed or unverified; credentials were not provisioned"] : ["Source row has no user identity values"]
    });
  }
  result.autoFixed.dailyReportHeaderPreserved = dailyRows.length ? 1 : 0;
  result.needsReview.dailyReportRows = Math.max(0, dailyRows.length - 1);
});

recoveryTx();

const missingHistoryRows = serviceHistorySource.map((row, index) => ({ row, rowNumber: index + 2 })).filter(({ row }) =>
  !clean(row["Customer Name"]) || !clean(row["Service / product Name"]) || amount(row.Amount) === 0
);
const recoveredSalesRows = missingHistoryRows.map(({ row, rowNumber }) => {
  const target = clean(row["Customer Name"]) ? clientByPhoneOrName(row["Customer Mobile"], row["Customer Name"]) : null;
  return {
    originalRecordId: `Service History:${rowNumber}`,
    clientId: target?.id || unknownClient.id,
    clientName: clean(row["Customer Name"]) || unknownClient.name,
    clientPhone: phone(row["Customer Mobile"]),
    staffName: clean(row["Stylist Name"]),
    branchId: BRANCH_ID,
    serviceName: clean(row["Service / product Name"]),
    lineItem: `${clean(row.Type) || "Item"}: ${clean(row["Service / product Name"])}`,
    subtotal: amount(row.Amount),
    total: amount(row.Amount),
    status: "completed",
    createdAt: dateIso(row.Date)
  };
});

const zeroInvoices = unpaidInvoiceSource.map((row, index) => ({ row, rowNumber: index + 2 })).filter(({ row }) =>
  clean(row["Invoice Number"]) && amount(row["Invoice Total"]) === 0
).map(({ row }) => {
  const target = clientByPhoneOrName(row["Customer Mobile"], row["Customer Name"]);
  return {
    originalRecordId: clean(row["Invoice Number"]),
    invoiceNumber: clean(row["Invoice Number"]),
    clientId: target?.id || unknownClient.id,
    clientName: clean(row["Customer Name"]) || unknownClient.name,
    clientPhone: phone(row["Customer Mobile"]),
    branchId: BRANCH_ID,
    subtotal: 0,
    total: 0,
    balance: 0,
    status: "unpaid",
    createdAt: dateIso(row.Date)
  };
});

function importRecoveryRows(resource, rows, fileName) {
  const table = resource === "invoices" ? "invoices" : "sales";
  const missingRows = rows.filter((row) => !db.prepare(`
    SELECT id FROM ${table} WHERE tenantId=@tenantId AND originalSystem='dingg' AND originalRecordId=@originalRecordId LIMIT 1
  `).get({ tenantId: TENANT_ID, originalRecordId: row.originalRecordId }));
  if (!missingRows.length) return { alreadyImported: true, summary: { importedRows: rows.length, errorRows: 0 } };
  const mapping = Object.fromEntries(Object.keys(missingRows[0] || {}).map((field) => [field, field]));
  return migrationService.import({
    rows: missingRows,
    resource,
    mapping,
    sourceSoftware: "dingg",
    fileName,
    branchId: BRANCH_ID,
    skipApprovalGate: true,
    allowPartialImport: false,
    migrationMode: true
  }, access);
}

const salesImport = importRecoveryRows("sales", recoveredSalesRows, "salonist-dingg-recovery-service-history.xlsx");
const invoiceImport = importRecoveryRows("invoices", zeroInvoices, "salonist-dingg-recovery-zero-invoices.xlsx");

function neutralizeDuplicateRecoveryRows() {
  const sourceIds = [...recoveredSalesRows.map((row) => row.originalRecordId), ...zeroInvoices.map((row) => row.originalRecordId)];
  let duplicateSalesVoided = 0;
  let duplicateInvoicesVoided = 0;
  let duplicateJournalsReversed = 0;
  for (const originalRecordId of sourceIds) {
    const sales = db.prepare(`
      SELECT * FROM sales
      WHERE tenantId=@tenantId AND originalSystem='dingg' AND originalRecordId=@originalRecordId
      ORDER BY importedAt ASC, id ASC
    `).all({ tenantId: TENANT_ID, originalRecordId });
    const canonicalSale = sales[0];
    for (const duplicate of sales.slice(1)) {
      if (duplicate.status === "voided_recovery_duplicate") continue;
      const journal = db.prepare(`
        SELECT * FROM journalEntries
        WHERE tenantId=@tenantId AND sourceType='migration.sale.recorded' AND sourceId=@sourceId
        ORDER BY createdAt DESC LIMIT 1
      `).get({ tenantId: TENANT_ID, sourceId: duplicate.id });
      if (journal?.status === "posted") {
        balanceSheetService.reverseJournal(journal.id, { reason: `Recovery duplicate neutralized: ${originalRecordId}` }, access);
        duplicateJournalsReversed++;
      }
      db.prepare(`
        UPDATE sales SET
          status='voided_recovery_duplicate', recoveryDuplicateOf=@canonicalId,
          recoveryOriginalTotalPaise=@originalTotalPaise,
          recoveryVoidReason='Idempotency rerun duplicate; canonical source record retained',
          subtotal=0, discount=0, gstAmount=0, total=0, updatedAt=@updatedAt
        WHERE tenantId=@tenantId AND id=@id
      `).run({
        canonicalId: canonicalSale.id,
        originalTotalPaise: paise(duplicate.total),
        updatedAt: stamp,
        tenantId: TENANT_ID,
        id: duplicate.id
      });
      if (duplicate.clientId && duplicate.clientId !== unknownClient.id) {
        const client = db.prepare("SELECT * FROM clients WHERE tenantId=@tenantId AND id=@id").get({ tenantId: TENANT_ID, id: duplicate.clientId });
        if (client) {
          let purchaseHistory;
          try { purchaseHistory = JSON.parse(client.purchaseHistory || "[]"); } catch { purchaseHistory = []; }
          const index = purchaseHistory.findLastIndex((item) => clean(item.date) === clean(duplicate.createdAt) && amount(item.amount) === amount(duplicate.total));
          if (index >= 0) purchaseHistory.splice(index, 1);
          db.prepare(`
            UPDATE clients SET visitCount=@visitCount, purchaseHistory=@purchaseHistory, updatedAt=@updatedAt
            WHERE tenantId=@tenantId AND id=@id
          `).run({
            visitCount: Math.max(0, Number(client.visitCount || 0) - 1),
            purchaseHistory: JSON.stringify(purchaseHistory),
            updatedAt: stamp,
            tenantId: TENANT_ID,
            id: client.id
          });
        }
      }
      duplicateSalesVoided++;
    }

    const invoices = db.prepare(`
      SELECT * FROM invoices
      WHERE tenantId=@tenantId AND originalSystem='dingg' AND originalRecordId=@originalRecordId
      ORDER BY importedAt ASC, id ASC
    `).all({ tenantId: TENANT_ID, originalRecordId });
    const canonicalInvoice = invoices[0];
    for (const duplicate of invoices.slice(1)) {
      if (duplicate.status === "voided_recovery_duplicate") continue;
      db.prepare(`
        UPDATE invoices SET
          status='voided_recovery_duplicate', recoveryDuplicateOf=@canonicalId,
          recoveryOriginalTotalPaise=@originalTotalPaise,
          recoveryVoidReason='Idempotency rerun duplicate; canonical source record retained',
          subtotal=0, discount=0, gstAmount=0, total=0, paid=0, balance=0, updatedAt=@updatedAt
        WHERE tenantId=@tenantId AND id=@id
      `).run({
        canonicalId: canonicalInvoice.id,
        originalTotalPaise: paise(duplicate.total),
        updatedAt: stamp,
        tenantId: TENANT_ID,
        id: duplicate.id
      });
      duplicateInvoicesVoided++;
    }
  }

  const canonicalUnknownSales = db.prepare(`
    SELECT createdAt, total FROM sales
    WHERE tenantId=@tenantId AND clientId=@clientId AND originalSystem='dingg'
      AND originalRecordId IN ('Service History:1322', 'Service History:1323')
      AND status<>'voided_recovery_duplicate'
    ORDER BY createdAt, originalRecordId
  `).all({ tenantId: TENANT_ID, clientId: unknownClient.id });
  db.prepare(`
    UPDATE clients SET totalSpend=@totalSpend, visitCount=@visitCount,
      purchaseHistory=@purchaseHistory, lastVisitAt=@lastVisitAt, updatedAt=@updatedAt
    WHERE tenantId=@tenantId AND id=@id
  `).run({
    totalSpend: canonicalUnknownSales.reduce((sum, row) => sum + amount(row.total), 0),
    visitCount: 0,
    purchaseHistory: JSON.stringify(canonicalUnknownSales.map((row) => ({ date: row.createdAt, invoice: "Imported", amount: row.total }))),
    lastVisitAt: canonicalUnknownSales.at(-1)?.createdAt || "",
    updatedAt: stamp,
    tenantId: TENANT_ID,
    id: unknownClient.id
  });
  return { duplicateSalesVoided, duplicateInvoicesVoided, duplicateJournalsReversed };
}

neutralizeDuplicateRecoveryRows();
result.imported.remainingServiceHistoryRows = Number(salesImport.summary?.importedRows || (salesImport.alreadyImported ? recoveredSalesRows.length : 0));
result.autoFixed.blankCustomerHistoryLinkedToUnknown = recoveredSalesRows.filter((row) => row.clientId === unknownClient.id && !clean(row.clientPhone)).length;
result.imported.zeroAmountHistoryRows = recoveredSalesRows.filter((row) => amount(row.total) === 0).length;
result.imported.zeroTotalInvoices = Number(invoiceImport.summary?.importedRows || (invoiceImport.alreadyImported ? zeroInvoices.length : 0));
result.autoFixed.duplicateRecoverySalesVoided = db.prepare(`
  SELECT COUNT(*) AS count FROM sales WHERE tenantId=@tenantId AND status='voided_recovery_duplicate'
`).get({ tenantId: TENANT_ID }).count;
result.autoFixed.duplicateRecoveryInvoicesVoided = db.prepare(`
  SELECT COUNT(*) AS count FROM invoices WHERE tenantId=@tenantId AND status='voided_recovery_duplicate'
`).get({ tenantId: TENANT_ID }).count;
result.autoFixed.duplicateRecoveryJournalsReversed = db.prepare(`
  SELECT COUNT(*) AS count FROM journalEntries
  WHERE tenantId=@tenantId AND status='reversed' AND sourceType='migration.sale.recorded'
    AND sourceId IN (SELECT id FROM sales WHERE tenantId=@tenantId AND status='voided_recovery_duplicate')
`).get({ tenantId: TENANT_ID }).count;

const voucherTx = db.transaction(() => {
  const vouchers = [];
  const prepaidRow = rowsFor(salonist, "Prepaid  Voucher").find((row) => clean(row["Client Name"]));
  if (prepaidRow) vouchers.push({
    sourceExternalId: "Prepaid Voucher:2",
    clientName: clean(prepaidRow["Client Name"]),
    clientPhone: phone(prepaidRow["Client Number "]),
    name: clean(prepaidRow["Prepaid Name"]),
    initialValue: amount(prepaidRow["Actual "]),
    balance: amount(prepaidRow["Current Balance"]),
    expiryDate: dateIso(prepaidRow["End Date"]).slice(0, 10),
    invoiceNumber: ""
  });
  for (const [index, row] of invoiceSource.entries()) {
    const value = amount(row["Voucher/prepaid Issued"]);
    if (!value || clean(row.Location) === "Total" || clean(row["Invoice Number"]) === "Invoice Number") continue;
    vouchers.push({
      sourceExternalId: `invoice:${index + 2}:voucher-issued`,
      clientName: clean(row.Name),
      clientPhone: phone(row.Mobile),
      name: "Issued prepaid voucher",
      initialValue: value,
      balance: value,
      expiryDate: "",
      invoiceNumber: clean(row["Invoice Number"])
    });
  }
  for (const voucher of vouchers) {
    const client = clientByPhoneOrName(voucher.clientPhone, voucher.clientName) || unknownClient;
    const invoice = voucher.invoiceNumber
      ? db.prepare("SELECT * FROM invoices WHERE tenantId=@tenantId AND invoiceNumber=@invoiceNumber LIMIT 1").get({ tenantId: TENANT_ID, invoiceNumber: voucher.invoiceNumber })
      : null;
    const cardId = idFor("giftcardrec", voucher.sourceExternalId);
    const code = `DINGG-${createHash("sha256").update(voucher.sourceExternalId).digest("hex").slice(0, 12).toUpperCase()}`;
    const codeHash = createHash("sha256").update(code).digest("hex");
    db.prepare(`
      INSERT INTO gift_cards (
        id, tenantId, branchId, tenant_id, branch_id, code, code_hash, display_code_last4,
        clientId, customer_id, purchaser_customer_id, initialValue, initial_value, initialValuePaise,
        balance, balancePaise, expiryDate, expiry_date, status, redeemHistory, currency,
        created_invoice_id, createdAt, updatedAt, created_at, originalSystem, originalRecordId, importedAt, importBatchId
      ) VALUES (
        @id, @tenantId, @branchId, @tenantId, @branchId, @code, @codeHash, @last4,
        @clientId, @clientId, @clientId, @initialValue, @initialValue, @initialValuePaise,
        @balance, @balancePaise, @expiryDate, @expiryDate, 'active', '[]', 'INR',
        @invoiceId, @createdAt, @createdAt, @createdAt, 'dingg', @originalRecordId, @createdAt, @batchId
      ) ON CONFLICT(id) DO UPDATE SET
        clientId=excluded.clientId, customer_id=excluded.customer_id, initialValue=excluded.initialValue,
        initial_value=excluded.initial_value, initialValuePaise=excluded.initialValuePaise,
        balance=excluded.balance, balancePaise=excluded.balancePaise, expiryDate=excluded.expiryDate,
        expiry_date=excluded.expiry_date, updatedAt=excluded.updatedAt, importedAt=excluded.importedAt
    `).run({
      id: cardId,
      tenantId: TENANT_ID,
      branchId: BRANCH_ID,
      code,
      codeHash,
      last4: code.slice(-4),
      clientId: client.id,
      initialValue: voucher.initialValue,
      initialValuePaise: paise(voucher.initialValue),
      balance: voucher.balance,
      balancePaise: paise(voucher.balance),
      expiryDate: voucher.expiryDate,
      invoiceId: invoice?.id || "",
      createdAt: stamp,
      originalRecordId: voucher.sourceExternalId,
      batchId: RECOVERY_BATCH_ID
    });
    const issueTxId = idFor("giftctxrec", `${voucher.sourceExternalId}:issue`);
    db.prepare(`
      INSERT INTO gift_card_transactions (
        id, tenant_id, tenantId, branch_id, branchId, gift_card_id, invoice_id, type,
        amount, amountPaise, balance_after, balanceAfterPaise, description, created_by, created_at,
        originalSystem, originalRecordId, importedAt, importBatchId
      ) VALUES (
        @id, @tenantId, @tenantId, @branchId, @branchId, @giftCardId, @invoiceId, 'issue',
        @amount, @amountPaise, @amount, @amountPaise, @description, @createdBy, @createdAt,
        'dingg', @originalRecordId, @createdAt, @batchId
      ) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount, amountPaise=excluded.amountPaise,
        balance_after=excluded.balance_after, balanceAfterPaise=excluded.balanceAfterPaise, importedAt=excluded.importedAt
    `).run({
      id: issueTxId,
      tenantId: TENANT_ID,
      branchId: BRANCH_ID,
      giftCardId: cardId,
      invoiceId: invoice?.id || "",
      amount: voucher.initialValue,
      amountPaise: paise(voucher.initialValue),
      description: `Recovered ${voucher.name}`,
      createdBy: OWNER_ID,
      createdAt: stamp,
      originalRecordId: `${voucher.sourceExternalId}:issue`,
      batchId: RECOVERY_BATCH_ID
    });
    if (voucher.balance < voucher.initialValue) {
      const redeemTxId = idFor("giftctxrec", `${voucher.sourceExternalId}:opening-redemption`);
      const redeemed = voucher.initialValue - voucher.balance;
      db.prepare(`
        INSERT INTO gift_card_transactions (
          id, tenant_id, tenantId, branch_id, branchId, gift_card_id, invoice_id, type,
          amount, amountPaise, balance_after, balanceAfterPaise, description, created_by, created_at,
          originalSystem, originalRecordId, importedAt, importBatchId
        ) VALUES (
          @id, @tenantId, @tenantId, @branchId, @branchId, @giftCardId, '', 'opening_redemption',
          @amount, @amountPaise, @balance, @balancePaise, @description, @createdBy, @createdAt,
          'dingg', @originalRecordId, @createdAt, @batchId
        ) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount, amountPaise=excluded.amountPaise,
          balance_after=excluded.balance_after, balanceAfterPaise=excluded.balanceAfterPaise, importedAt=excluded.importedAt
      `).run({
        id: redeemTxId,
        tenantId: TENANT_ID,
        branchId: BRANCH_ID,
        giftCardId: cardId,
        amount: -redeemed,
        amountPaise: -paise(redeemed),
        balance: voucher.balance,
        balancePaise: paise(voucher.balance),
        description: "Recovered opening voucher redemption",
        createdBy: OWNER_ID,
        createdAt: stamp,
        originalRecordId: `${voucher.sourceExternalId}:opening-redemption`,
        batchId: RECOVERY_BATCH_ID
      });
    }
  }
  return vouchers.length;
});

result.imported.issuedVouchers = voucherTx();
result.storedFields.push("gift_cards.initialValuePaise", "gift_cards.balancePaise", "gift_card_transactions.amountPaise");

const scalar = (sql, params = {}) => db.prepare(sql).get({ tenantId: TENANT_ID, branchId: BRANCH_ID, ...params });
result.verification = {
  recoveredConsentSourceRows: scalar("SELECT COUNT(*) AS count FROM client_communication_consents WHERE tenantId=@tenantId AND branchId=@branchId AND sourceSystem='dingg'").count,
  clientsWithRecoveredConsent: scalar("SELECT COUNT(*) AS count FROM clients WHERE tenantId=@tenantId AND json_extract(communicationPreferences, '$.source')='dingg'").count,
  servicesWithMembershipPrice: scalar("SELECT COUNT(*) AS count FROM services WHERE tenantId=@tenantId AND membershipPriceRecorded=1").count,
  productsWithIssueValue: scalar("SELECT COUNT(*) AS count FROM products WHERE tenantId=@tenantId AND legacyIssueRecorded=1").count,
  historicalIssueTransactions: scalar("SELECT COUNT(*) AS count FROM inventory_transactions WHERE tenantId=@tenantId AND referenceType='migration_recovery'").count,
  productsWithQrCode: scalar("SELECT COUNT(*) AS count FROM products WHERE tenantId=@tenantId AND qrCode<>''").count,
  membershipsWithSellingStaff: scalar("SELECT COUNT(*) AS count FROM memberships WHERE tenantId=@tenantId AND soldByStaffId<>''").count,
  packageMembershipsWithCredits: scalar("SELECT COUNT(*) AS count FROM memberships WHERE tenantId=@tenantId AND originalRecordId LIKE 'Package Balance:%' AND planCredits>0").count,
  totalClientVisitCount: scalar("SELECT SUM(visitCount) AS value FROM clients WHERE tenantId=@tenantId").value,
  invoicesWithEnterpriseTenant: scalar("SELECT COUNT(*) AS count FROM invoices WHERE tenantId=@tenantId AND tenant_id=@tenantId AND status<>'voided_recovery_duplicate'").count,
  recoveredGiftCards: scalar("SELECT COUNT(*) AS count FROM gift_cards WHERE tenantId=@tenantId AND importBatchId=@batchId", { batchId: RECOVERY_BATCH_ID }).count,
  zeroAmountHistorySales: scalar("SELECT COUNT(*) AS count FROM sales WHERE tenantId=@tenantId AND originalRecordId IN ('Service History:5969','Service History:6000','Service History:6071','Service History:6092','Service History:6093','Service History:6119','Service History:6132','Service History:6136') AND status<>'voided_recovery_duplicate'").count,
  recoveredZeroInvoices: scalar("SELECT COUNT(*) AS count FROM invoices WHERE tenantId=@tenantId AND originalRecordId IN ('V/2025-26/0451','V/2024-25/7817','V/2024-25/7709','V/2025-26/0091') AND status<>'voided_recovery_duplicate'").count,
  activeRecoverySaleDuplicates: scalar("SELECT COUNT(*) AS count FROM (SELECT originalRecordId FROM sales WHERE tenantId=@tenantId AND status<>'voided_recovery_duplicate' AND (originalRecordId LIKE 'Service History:%' OR originalRecordId LIKE 'V/%') GROUP BY originalRecordId HAVING COUNT(*)>1)").count,
  activeRecoveryInvoiceDuplicates: scalar("SELECT COUNT(*) AS count FROM (SELECT originalRecordId FROM invoices WHERE tenantId=@tenantId AND status<>'voided_recovery_duplicate' AND originalRecordId IN ('V/2025-26/0451','V/2024-25/7817','V/2024-25/7709','V/2025-26/0091') GROUP BY originalRecordId HAVING COUNT(*)>1)").count,
  voidedRecoverySales: scalar("SELECT COUNT(*) AS count FROM sales WHERE tenantId=@tenantId AND status='voided_recovery_duplicate'").count,
  voidedRecoveryInvoices: scalar("SELECT COUNT(*) AS count FROM invoices WHERE tenantId=@tenantId AND status='voided_recovery_duplicate'").count,
  reversedDuplicateJournals: scalar("SELECT COUNT(*) AS count FROM journalEntries WHERE tenantId=@tenantId AND status='reversed' AND sourceType='migration.sale.recorded' AND sourceId IN (SELECT id FROM sales WHERE tenantId=@tenantId AND status='voided_recovery_duplicate')").count,
  needsReviewRows: scalar("SELECT COUNT(*) AS count FROM migration_staging_rows WHERE tenantId=@tenantId AND jobId=@jobId AND status='needs_review'", { jobId: RECOVERY_JOB_ID }).count,
  autoFixedRows: scalar("SELECT COUNT(*) AS count FROM migration_staging_rows WHERE tenantId=@tenantId AND jobId=@jobId AND status='auto_fixed'", { jobId: RECOVERY_JOB_ID }).count,
  membershipStaffOrphans: scalar("SELECT COUNT(*) AS count FROM memberships m LEFT JOIN staff s ON s.tenantId=m.tenantId AND s.id=m.soldByStaffId WHERE m.tenantId=@tenantId AND m.soldByStaffId<>'' AND s.id IS NULL").count,
  productStock: scalar("SELECT SUM(stock) AS value FROM products WHERE tenantId=@tenantId").value,
  openingStockTransactions: scalar("SELECT SUM(quantity) AS value FROM inventory_transactions WHERE tenantId=@tenantId AND type='import_opening_stock'").value,
  tenantLeakage: scalar("SELECT COUNT(*) AS count FROM clients WHERE importBatchId=@batchId AND tenantId<>@tenantId", { batchId: RECOVERY_BATCH_ID }).count
};

const needsReview = Object.values(result.needsReview).reduce((sum, value) => sum + Number(value || 0), 0);
const imported = Object.values(result.imported).reduce((sum, value) => sum + Number(value || 0), 0);
const autoFixed = Object.values(result.autoFixed).reduce((sum, value) => sum + Number(value || 0), 0);
const summary = {
  ...result,
  totals: { imported, autoFixed, needsReview, failed: result.failed, silentSkipped: result.silentSkipped },
  totalRows: imported + autoFixed + needsReview,
  processedRows: imported + autoFixed + needsReview,
  validRows: imported + autoFixed,
  warningRows: needsReview,
  errorRows: result.failed,
  importedRows: imported
};
upsertRecoveryJob("completed", summary);
console.log(JSON.stringify(summary, null, 2));
