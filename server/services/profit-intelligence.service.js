import { db } from "../db.js";
import { tenantService } from "./tenant.service.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const OPERATING_EXPENSE_LIMIT = 1000;
const BREAKDOWN_LIMIT = 12;

const toPaise = (value) => Math.round((Number(value) || 0) * 100);
const fromPaise = (value) => Math.round(Number(value || 0)) / 100;
const clampPaise = (value) => Math.max(0, Math.round(Number(value || 0)));

function istDate(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function monthStart(dateText = istDate()) {
  return `${dateText.slice(0, 7)}-01`;
}

function tableExists(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=@name").get({ name }));
}

function safeAll(sql, params = {}) {
  try {
    return db.prepare(sql).all(params);
  } catch {
    return [];
  }
}

function safeGet(sql, params = {}) {
  try {
    return db.prepare(sql).get(params) || {};
  } catch {
    return {};
  }
}

function periodParams(query = {}, access = {}) {
  const to = String(query.to || query.endDate || istDate()).slice(0, 10);
  const from = String(query.from || query.startDate || monthStart(to)).slice(0, 10);
  const branchId = String(query.branchId || access.branchId || "").trim();
  if (branchId) tenantService.assertBranchAccess(access, branchId);
  return {
    tenantId: access.tenantId,
    branchId,
    from,
    to,
    startAt: `${from}T00:00:00`,
    endAt: `${to}T23:59:59`
  };
}

function marginBps(amountPaise, revenuePaise) {
  if (!revenuePaise) return 0;
  return Math.round((Number(amountPaise || 0) / Number(revenuePaise || 1)) * 10000);
}

function classifyExpense(category = "") {
  const text = String(category || "").toLowerCase();
  if (/(cogs|consume|consumable|product cost|backbar|recipe)/.test(text)) return "productCost";
  if (/(salary|payroll|commission|incentive|bonus|overtime|pf|esi|tds|leave)/.test(text)) return "staffCost";
  return "operatingExpense";
}

function revenueType(line = {}) {
  const text = [
    line.type,
    line.itemType,
    line.category,
    line.name,
    line.serviceName,
    line.productName
  ].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("membership")) return "membership";
  if (text.includes("package")) return "package";
  if (text.includes("gift")) return "giftCard";
  if (text.includes("tip")) return "tips";
  if (text.includes("cancel")) return "cancellationFees";
  if (text.includes("late")) return "lateFees";
  if (text.includes("product") || text.includes("retail")) return "product";
  if (text.includes("addon") || text.includes("add-on")) return "addOn";
  return "service";
}

function lineAmountPaise(line = {}) {
  const direct = line.total ?? line.amount ?? line.netAmount ?? line.lineTotal;
  if (direct !== undefined && direct !== null && direct !== "") return toPaise(direct);
  return toPaise(Number(line.price || line.rate || 0) * Number(line.quantity || line.qty || 1));
}

function lineName(line = {}) {
  return String(line.name || line.serviceName || line.productName || line.itemName || line.id || "Unmapped").trim() || "Unmapped";
}

function lineServiceId(line = {}) {
  return String(line.serviceId || line.service_id || line.id || "").trim();
}

function lineCategory(line = {}, serviceLookup = new Map()) {
  const serviceId = lineServiceId(line);
  const service = serviceId ? serviceLookup.get(serviceId) : null;
  const category = line.category || service?.category || (revenueType(line) === "product" ? "Products" : "Services");
  return String(category || "Uncategorized").trim() || "Uncategorized";
}

function mapKey(parts = []) {
  return parts.map((part) => String(part || "").trim().toLowerCase()).join("|");
}

function addAmount(map, key, seed, field, amountPaise) {
  if (!map.has(key)) map.set(key, { ...seed });
  const row = map.get(key);
  row[field] = Number(row[field] || 0) + Number(amountPaise || 0);
  return row;
}

function marginRow(row = {}) {
  const revenuePaise = Number(row.revenuePaise || 0);
  const productCostPaise = Number(row.productCostPaise || 0);
  const staffCostPaise = Number(row.staffCostPaise || 0);
  const operatingExpensePaise = Number(row.operatingExpensePaise || 0);
  const grossProfitPaise = revenuePaise - productCostPaise;
  const netProfitPaise = grossProfitPaise - staffCostPaise - operatingExpensePaise;
  return {
    ...row,
    grossProfitPaise,
    netProfitPaise,
    grossMarginBps: marginBps(grossProfitPaise, revenuePaise),
    netMarginBps: marginBps(netProfitPaise, revenuePaise)
  };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function revenueBreakdown(invoices = []) {
  const totals = new Map();
  for (const invoice of invoices) {
    const lines = parseJsonArray(invoice.lineItems);
    if (!lines.length) {
      totals.set("service", Number(totals.get("service") || 0) + toPaise(invoice.total));
      continue;
    }
    for (const line of lines) {
      const type = revenueType(line);
      totals.set(type, Number(totals.get(type) || 0) + lineAmountPaise(line));
    }
  }
  return [...totals.entries()]
    .map(([key, amountPaise]) => ({ key, label: labelForRevenue(key), amountPaise }))
    .sort((a, b) => b.amountPaise - a.amountPaise);
}

function labelForRevenue(key) {
  return {
    service: "Service Sales",
    product: "Product Sales",
    membership: "Membership Sales",
    package: "Package Sales",
    giftCard: "Gift Card Sales",
    tips: "Tips",
    addOn: "Add-on Services",
    cancellationFees: "Cancellation Fees",
    lateFees: "Late Fees"
  }[key] || key;
}

export class ProfitIntelligenceService {
  summary(query = {}, access = {}) {
    const params = periodParams(query, access);
    const invoices = this.invoiceRows(params);
    const payments = this.paymentRows(params);
    const revenuePaise = invoices.reduce((sum, row) => sum + toPaise(row.total), 0);
    const collectionsPaise = payments.reduce((sum, row) => sum + Math.max(0, toPaise(row.amount)), 0);
    const refundPaise = payments.reduce((sum, row) => sum + Math.abs(Math.min(0, toPaise(row.amount))), 0);
    const expenseRows = this.operatingExpenseRows(params);
    const expenseTotals = this.classifiedExpenses(expenseRows);
    const journalCogsPaise = this.journalCogsPaise(params);
    const consumeCogsPaise = this.productConsumeCogsPaise(params);
    const operationalCogsPaise = consumeCogsPaise + expenseTotals.productCostPaise;
    const productCostPaise = journalCogsPaise > 0 ? journalCogsPaise : operationalCogsPaise;
    const payoutStaffPaise = this.staffPayoutPaise(params);
    const commissionPaise = this.salesCommissionPaise(params);
    const staffCostPaise = payoutStaffPaise > 0 ? payoutStaffPaise : expenseTotals.staffCostPaise + commissionPaise;
    const operatingExpensePaise = expenseTotals.operatingExpensePaise;
    const grossProfitPaise = revenuePaise - productCostPaise;
    const netProfitPaise = grossProfitPaise - staffCostPaise - operatingExpensePaise - refundPaise;
    const breakdown = revenueBreakdown(invoices);

    return {
      period: { from: params.from, to: params.to, branchId: params.branchId },
      metrics: {
        revenuePaise,
        collectionsPaise,
        refundPaise,
        productCostPaise,
        staffCostPaise,
        operatingExpensePaise,
        grossProfitPaise,
        netProfitPaise,
        grossMarginBps: marginBps(grossProfitPaise, revenuePaise),
        netMarginBps: marginBps(netProfitPaise, revenuePaise)
      },
      revenueBreakdown: breakdown,
      expenseBreakdown: expenseTotals.breakdown,
      sourceHealth: {
        invoices: invoices.length,
        payments: payments.length,
        expenses: expenseRows.length,
        cogsSource: journalCogsPaise > 0 ? "journalEntryLines" : consumeCogsPaise > 0 ? "productConsumeDrafts" : expenseTotals.productCostPaise > 0 ? "financeExpenses" : "missing",
        staffCostSource: payoutStaffPaise > 0 ? "financeStaffPayouts" : commissionPaise > 0 ? "salesCommission" : expenseTotals.staffCostPaise > 0 ? "financeExpenses" : "missing"
      },
      diagnostics: this.diagnostics({ revenuePaise, productCostPaise, staffCostPaise, operatingExpensePaise, invoices }),
      display: {
        revenue: fromPaise(revenuePaise),
        grossProfit: fromPaise(grossProfitPaise),
        netProfit: fromPaise(netProfitPaise)
      }
    };
  }

  breakdown(query = {}, access = {}) {
    const params = periodParams(query, access);
    const invoices = this.invoiceRows(params);
    const expenseRows = this.operatingExpenseRows(params);
    const expenseTotals = this.classifiedExpenses(expenseRows);
    const consumeRows = this.productConsumeRows(params);
    const serviceLookup = this.serviceLookup(params);
    const branchLookup = this.branchLookup(params);
    const salesCommission = this.salesCommissionRows(params);
    const payoutRows = this.staffPayoutRows(params);
    const journalCogsRows = this.journalCogsRows(params);
    const useJournalCogs = journalCogsRows.reduce((sum, row) => sum + Number(row.productCostPaise || 0), 0) > 0;

    return {
      period: { from: params.from, to: params.to, branchId: params.branchId },
      serviceProfit: this.serviceProfitRows({ invoices, consumeRows, serviceLookup }),
      staffProfit: this.staffProfitRows({ invoices, consumeRows }),
      branchProfit: this.branchProfitRows({ invoices, expenseRows, consumeRows, salesCommission, payoutRows, journalCogsRows, useJournalCogs, branchLookup }),
      categoryProfit: this.categoryProfitRows({ invoices, consumeRows, serviceLookup }),
      sourceHealth: {
        cogsSource: useJournalCogs ? "journalEntryLines" : consumeRows.length ? "productConsumeDrafts" : expenseTotals.productCostPaise > 0 ? "financeExpenses" : "missing",
        staffCostSource: payoutRows.length ? "financeStaffPayouts" : salesCommission.length ? "salesCommission" : expenseTotals.staffCostPaise > 0 ? "financeExpenses" : "missing"
      }
    };
  }

  invoiceRows(params) {
    if (!tableExists("invoices")) return [];
    return safeAll(`
      SELECT i.id, i.invoiceNumber, i.lineItems, i.total, i.subtotal, i.discount, i.status,
        COALESCE(NULLIF(i.branchId, ''), s.branchId, '') AS branchId,
        COALESCE(s.staffId, '') AS staffId,
        COALESCE(s.commissionTotal, 0) AS commissionTotal
      FROM invoices i
      LEFT JOIN sales s ON s.id = i.saleId AND s.tenantId = i.tenantId
      WHERE i.tenantId = @tenantId
        AND i.createdAt BETWEEN @startAt AND @endAt
        AND lower(COALESCE(i.status, '')) NOT IN ('void', 'cancelled', 'canceled')
        AND (@branchId = '' OR COALESCE(NULLIF(i.branchId, ''), s.branchId, '') = @branchId)
      ORDER BY i.createdAt DESC
    `, params);
  }

  serviceProfitRows({ invoices = [], consumeRows = [], serviceLookup = new Map() }) {
    const rows = new Map();
    for (const invoice of invoices) {
      const lines = parseJsonArray(invoice.lineItems);
      const lineTotalPaise = lines.reduce((sum, line) => sum + lineAmountPaise(line), 0) || toPaise(invoice.total);
      for (const line of lines) {
        const serviceId = lineServiceId(line);
        const service = serviceId ? serviceLookup.get(serviceId) : null;
        const serviceName = service?.name || lineName(line);
        const amountPaise = lineAmountPaise(line);
        const staffCostPaise = lineTotalPaise ? Math.round(toPaise(invoice.commissionTotal) * amountPaise / lineTotalPaise) : 0;
        const key = serviceId || mapKey([serviceName]);
        const row = addAmount(rows, key, {
          serviceId,
          serviceName,
          category: lineCategory(line, serviceLookup),
          revenuePaise: 0,
          productCostPaise: 0,
          staffCostPaise: 0,
          invoiceCount: 0
        }, "revenuePaise", amountPaise);
        row.staffCostPaise += staffCostPaise;
        row.invoiceCount += 1;
      }
    }
    for (const consume of consumeRows) {
      const key = consume.serviceId || mapKey([consume.serviceName]);
      const row = addAmount(rows, key, {
        serviceId: consume.serviceId,
        serviceName: consume.serviceName || "Unmapped service",
        category: serviceLookup.get(consume.serviceId)?.category || "Services",
        revenuePaise: 0,
        productCostPaise: 0,
        staffCostPaise: 0,
        invoiceCount: 0
      }, "productCostPaise", consume.productCostPaise);
      if (!row.serviceName || row.serviceName === "Unmapped service") row.serviceName = consume.serviceName || row.serviceName;
    }
    return [...rows.values()].map(marginRow).sort((a, b) => b.netProfitPaise - a.netProfitPaise).slice(0, BREAKDOWN_LIMIT);
  }

  staffProfitRows({ invoices = [], consumeRows = [] }) {
    const rows = new Map();
    for (const invoice of invoices) {
      const lines = parseJsonArray(invoice.lineItems);
      const lineTotalPaise = lines.reduce((sum, line) => sum + lineAmountPaise(line), 0) || toPaise(invoice.total);
      for (const line of lines) {
        const amountPaise = lineAmountPaise(line);
        const staffCostPaise = lineTotalPaise ? Math.round(toPaise(invoice.commissionTotal) * amountPaise / lineTotalPaise) : 0;
        for (const split of this.staffSplits(line, invoice, amountPaise, staffCostPaise)) {
          const key = split.staffId || mapKey([split.staffName]) || "unassigned";
          const row = addAmount(rows, key, {
            staffId: split.staffId,
            staffName: split.staffName,
            revenuePaise: 0,
            productCostPaise: 0,
            staffCostPaise: 0,
            clientCount: 0,
            ticketCount: 0
          }, "revenuePaise", split.revenuePaise);
          row.staffCostPaise += split.staffCostPaise;
          row.ticketCount += 1;
        }
      }
    }
    for (const consume of consumeRows) {
      const key = consume.staffId || mapKey([consume.staffName]) || "unassigned";
      const row = addAmount(rows, key, {
        staffId: consume.staffId,
        staffName: consume.staffName || "Unassigned",
        revenuePaise: 0,
        productCostPaise: 0,
        staffCostPaise: 0,
        clientCount: 0,
        ticketCount: 0
      }, "productCostPaise", consume.productCostPaise);
      if (!row.staffName || row.staffName === "Unassigned") row.staffName = consume.staffName || row.staffName;
    }
    return [...rows.values()]
      .map((row) => marginRow({ ...row, avgTicketPaise: row.ticketCount ? Math.round(row.revenuePaise / row.ticketCount) : 0 }))
      .sort((a, b) => b.netProfitPaise - a.netProfitPaise)
      .slice(0, BREAKDOWN_LIMIT);
  }

  branchProfitRows({ invoices = [], expenseRows = [], consumeRows = [], salesCommission = [], payoutRows = [], journalCogsRows = [], useJournalCogs = false, branchLookup = new Map() }) {
    const rows = new Map();
    const hasConsumeCogs = consumeRows.some((row) => Number(row.productCostPaise || 0) > 0);
    const hasPayouts = payoutRows.some((row) => Number(row.staffCostPaise || 0) > 0);
    const hasSalesCommission = salesCommission.some((row) => Number(row.staffCostPaise || 0) > 0);
    const seed = (branchId) => ({
      branchId,
      branchName: branchLookup.get(branchId)?.name || branchId || "All branches",
      revenuePaise: 0,
      productCostPaise: 0,
      staffCostPaise: 0,
      operatingExpensePaise: 0,
      invoiceCount: 0
    });
    for (const invoice of invoices) {
      const branchId = invoice.branchId || "";
      const row = addAmount(rows, branchId, seed(branchId), "revenuePaise", toPaise(invoice.total));
      row.invoiceCount += 1;
    }
    for (const expense of expenseRows) {
      const branchId = expense.branchId || "";
      const bucket = classifyExpense(expense.category);
      if (bucket === "operatingExpense") {
        addAmount(rows, branchId, seed(branchId), "operatingExpensePaise", toPaise(expense.amount));
      } else if (bucket === "productCost" && !useJournalCogs && !hasConsumeCogs) {
        addAmount(rows, branchId, seed(branchId), "productCostPaise", toPaise(expense.amount));
      } else if (bucket === "staffCost" && !hasPayouts && !hasSalesCommission) {
        addAmount(rows, branchId, seed(branchId), "staffCostPaise", toPaise(expense.amount));
      }
    }
    if (useJournalCogs) {
      for (const cogs of journalCogsRows) addAmount(rows, cogs.branchId || "", seed(cogs.branchId || ""), "productCostPaise", cogs.productCostPaise);
    } else {
      for (const consume of consumeRows) addAmount(rows, consume.branchId || "", seed(consume.branchId || ""), "productCostPaise", consume.productCostPaise);
    }
    if (payoutRows.length) {
      for (const payout of payoutRows) addAmount(rows, payout.branchId || "", seed(payout.branchId || ""), "staffCostPaise", payout.staffCostPaise);
    } else {
      for (const commission of salesCommission) addAmount(rows, commission.branchId || "", seed(commission.branchId || ""), "staffCostPaise", commission.staffCostPaise);
    }
    return [...rows.values()].map(marginRow).sort((a, b) => b.netProfitPaise - a.netProfitPaise).slice(0, BREAKDOWN_LIMIT);
  }

  categoryProfitRows({ invoices = [], consumeRows = [], serviceLookup = new Map() }) {
    const rows = new Map();
    for (const invoice of invoices) {
      const lines = parseJsonArray(invoice.lineItems);
      const lineTotalPaise = lines.reduce((sum, line) => sum + lineAmountPaise(line), 0) || toPaise(invoice.total);
      for (const line of lines) {
        const category = lineCategory(line, serviceLookup);
        const amountPaise = lineAmountPaise(line);
        const staffCostPaise = lineTotalPaise ? Math.round(toPaise(invoice.commissionTotal) * amountPaise / lineTotalPaise) : 0;
        const row = addAmount(rows, category, {
          category,
          revenuePaise: 0,
          productCostPaise: 0,
          staffCostPaise: 0,
          itemCount: 0
        }, "revenuePaise", amountPaise);
        row.staffCostPaise += staffCostPaise;
        row.itemCount += 1;
      }
    }
    for (const consume of consumeRows) {
      const category = serviceLookup.get(consume.serviceId)?.category || "Services";
      addAmount(rows, category, {
        category,
        revenuePaise: 0,
        productCostPaise: 0,
        staffCostPaise: 0,
        itemCount: 0
      }, "productCostPaise", consume.productCostPaise);
    }
    return [...rows.values()].map(marginRow).sort((a, b) => b.netProfitPaise - a.netProfitPaise).slice(0, BREAKDOWN_LIMIT);
  }

  staffSplits(line = {}, invoice = {}, revenuePaise = 0, staffCostPaise = 0) {
    const rawSplits = Array.isArray(line.staffSplits) ? line.staffSplits.filter((split) => split?.staffId) : [];
    if (!rawSplits.length) {
      return [{
        staffId: line.staffId || invoice.staffId || "",
        staffName: line.staffName || line.assignedStaffName || line.staffId || invoice.staffId || "Unassigned",
        revenuePaise,
        staffCostPaise
      }];
    }
    const totalShare = rawSplits.reduce((sum, split) => sum + Number(split.share || Number(split.percent || 0) / 100 || 0), 0);
    let allocatedRevenue = 0;
    let allocatedStaff = 0;
    return rawSplits.map((split, index) => {
      const rawShare = Number(split.share || Number(split.percent || 0) / 100 || 0);
      const share = totalShare > 0 ? rawShare / totalShare : 1 / rawSplits.length;
      const splitRevenue = index === rawSplits.length - 1 ? revenuePaise - allocatedRevenue : Math.round(revenuePaise * share);
      const splitStaff = index === rawSplits.length - 1 ? staffCostPaise - allocatedStaff : Math.round(staffCostPaise * share);
      allocatedRevenue += splitRevenue;
      allocatedStaff += splitStaff;
      return {
        staffId: split.staffId || "",
        staffName: split.staffName || split.staffId || "Unassigned",
        revenuePaise: splitRevenue,
        staffCostPaise: splitStaff
      };
    });
  }

  paymentRows(params) {
    if (!tableExists("payments")) return [];
    return safeAll(`
      SELECT p.id, p.amount, p.mode, p.createdAt,
        COALESCE(NULLIF(i.branchId, ''), s.branchId, '') AS branchId
      FROM payments p
      JOIN invoices i ON i.id = p.invoiceId AND i.tenantId = p.tenantId
      LEFT JOIN sales s ON s.id = i.saleId AND s.tenantId = p.tenantId
      WHERE p.tenantId = @tenantId
        AND p.createdAt BETWEEN @startAt AND @endAt
        AND (@branchId = '' OR COALESCE(NULLIF(i.branchId, ''), s.branchId, '') = @branchId)
    `, params);
  }

  operatingExpenseRows(params) {
    if (!tableExists("finance_expenses")) return [];
    return safeAll(`
      SELECT id, branchId, category, vendor, amount, taxAmount, paymentMode, paidAt, createdAt, status
      FROM finance_expenses
      WHERE tenantId = @tenantId
        AND COALESCE(NULLIF(paidAt, ''), createdAt) BETWEEN @startAt AND @endAt
        AND lower(COALESCE(status, 'paid')) NOT IN ('void', 'cancelled', 'canceled')
        AND (@branchId = '' OR branchId = @branchId)
      ORDER BY COALESCE(NULLIF(paidAt, ''), createdAt) DESC
      LIMIT ${OPERATING_EXPENSE_LIMIT}
    `, params);
  }

  productConsumeRows(params) {
    if (!tableExists("product_consume_drafts")) return [];
    return safeAll(`
      SELECT branch_id AS branchId, service_id AS serviceId, service_name AS serviceName,
        staff_id AS staffId, staff_name AS staffName, COALESCE(SUM(actual_cost), 0) AS actualCost
      FROM product_consume_drafts
      WHERE tenant_id = @tenantId
        AND created_at BETWEEN @startAt AND @endAt
        AND lower(status) IN ('confirmed', 'posted', 'consumed', 'approved')
        AND (@branchId = '' OR branch_id = @branchId)
      GROUP BY branch_id, service_id, service_name, staff_id, staff_name
    `, params).map((row) => ({ ...row, productCostPaise: toPaise(row.actualCost) }));
  }

  salesCommissionRows(params) {
    if (!tableExists("sales")) return [];
    return safeAll(`
      SELECT branchId, staffId, COALESCE(SUM(commissionTotal), 0) AS commissionTotal
      FROM sales
      WHERE tenantId = @tenantId
        AND createdAt BETWEEN @startAt AND @endAt
        AND lower(COALESCE(status, 'completed')) NOT IN ('void', 'cancelled', 'canceled')
        AND (@branchId = '' OR branchId = @branchId)
      GROUP BY branchId, staffId
    `, params).map((row) => ({ ...row, staffCostPaise: toPaise(row.commissionTotal) }));
  }

  staffPayoutRows(params) {
    if (!tableExists("finance_staff_payouts")) return [];
    return safeAll(`
      SELECT branchId, staffId, COALESCE(SUM(netAmount), 0) AS netAmount
      FROM finance_staff_payouts
      WHERE tenantId = @tenantId
        AND lower(COALESCE(status, 'pending')) NOT IN ('void', 'cancelled', 'canceled')
        AND @from <= periodEnd
        AND @to >= periodStart
        AND (@branchId = '' OR branchId = @branchId)
      GROUP BY branchId, staffId
    `, params).map((row) => ({ ...row, staffCostPaise: toPaise(row.netAmount) }));
  }

  journalCogsRows(params) {
    if (!tableExists("journalEntryLines") || !tableExists("journalEntries") || !tableExists("chartOfAccounts")) return [];
    return safeAll(`
      SELECT COALESCE(NULLIF(l.branchId, ''), e.branchId, '') AS branchId,
        COALESCE(SUM(l.debitPaise - l.creditPaise), 0) AS cogsPaise
      FROM journalEntryLines l
      JOIN journalEntries e ON e.id = l.journalEntryId AND e.tenantId = l.tenantId
      JOIN chartOfAccounts a ON a.id = l.accountId AND a.tenantId = l.tenantId
      WHERE l.tenantId = @tenantId
        AND e.status = 'posted'
        AND e.businessDate BETWEEN @from AND @to
        AND (a.accountSubType = 'cogs' OR a.code = '5000')
        AND (@branchId = '' OR l.branchId = @branchId OR e.branchId = @branchId)
      GROUP BY COALESCE(NULLIF(l.branchId, ''), e.branchId, '')
    `, params).map((row) => ({ ...row, productCostPaise: clampPaise(row.cogsPaise) }));
  }

  serviceLookup(params) {
    if (!tableExists("services")) return new Map();
    const rows = safeAll(`
      SELECT id, name, category, branchId
      FROM services
      WHERE tenantId = @tenantId
        AND (@branchId = '' OR branchId = @branchId OR branchId = '')
      LIMIT 5000
    `, params);
    return new Map(rows.flatMap((row) => [
      [row.id, row],
      [mapKey([row.name]), row]
    ]));
  }

  branchLookup(params) {
    if (!tableExists("branches")) return new Map();
    const rows = safeAll(`
      SELECT id, name
      FROM branches
      WHERE tenantId = @tenantId
        AND (@branchId = '' OR id = @branchId)
    `, params);
    return new Map(rows.map((row) => [row.id, row]));
  }

  classifiedExpenses(rows = []) {
    const totals = {
      productCostPaise: 0,
      staffCostPaise: 0,
      operatingExpensePaise: 0,
      breakdown: []
    };
    const breakdown = new Map();
    for (const row of rows) {
      const amountPaise = toPaise(row.amount);
      const bucket = classifyExpense(row.category);
      totals[`${bucket}Paise`] += amountPaise;
      const key = row.category || "Uncategorized";
      const current = breakdown.get(key) || { category: key, amountPaise: 0, bucket };
      current.amountPaise += amountPaise;
      breakdown.set(key, current);
    }
    totals.breakdown = [...breakdown.values()].sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 8);
    return totals;
  }

  journalCogsPaise(params) {
    if (!tableExists("journalEntryLines") || !tableExists("journalEntries") || !tableExists("chartOfAccounts")) return 0;
    const row = safeGet(`
      SELECT COALESCE(SUM(l.debitPaise - l.creditPaise), 0) AS cogsPaise
      FROM journalEntryLines l
      JOIN journalEntries e ON e.id = l.journalEntryId AND e.tenantId = l.tenantId
      JOIN chartOfAccounts a ON a.id = l.accountId AND a.tenantId = l.tenantId
      WHERE l.tenantId = @tenantId
        AND e.status = 'posted'
        AND e.businessDate BETWEEN @from AND @to
        AND (a.accountSubType = 'cogs' OR a.code = '5000')
        AND (@branchId = '' OR l.branchId = @branchId OR e.branchId = @branchId)
    `, params);
    return clampPaise(row.cogsPaise);
  }

  productConsumeCogsPaise(params) {
    if (!tableExists("product_consume_drafts")) return 0;
    const row = safeGet(`
      SELECT COALESCE(SUM(actual_cost), 0) AS actualCost
      FROM product_consume_drafts
      WHERE tenant_id = @tenantId
        AND created_at BETWEEN @startAt AND @endAt
        AND lower(status) IN ('confirmed', 'posted', 'consumed', 'approved')
        AND (@branchId = '' OR branch_id = @branchId)
    `, params);
    return toPaise(row.actualCost);
  }

  staffPayoutPaise(params) {
    if (!tableExists("finance_staff_payouts")) return 0;
    const row = safeGet(`
      SELECT COALESCE(SUM(netAmount), 0) AS netAmount
      FROM finance_staff_payouts
      WHERE tenantId = @tenantId
        AND lower(COALESCE(status, 'pending')) NOT IN ('void', 'cancelled', 'canceled')
        AND @from <= periodEnd
        AND @to >= periodStart
        AND (@branchId = '' OR branchId = @branchId)
    `, params);
    return toPaise(row.netAmount);
  }

  salesCommissionPaise(params) {
    if (!tableExists("sales")) return 0;
    const row = safeGet(`
      SELECT COALESCE(SUM(commissionTotal), 0) AS commissionTotal
      FROM sales
      WHERE tenantId = @tenantId
        AND createdAt BETWEEN @startAt AND @endAt
        AND lower(COALESCE(status, 'completed')) NOT IN ('void', 'cancelled', 'canceled')
        AND (@branchId = '' OR branchId = @branchId)
    `, params);
    return toPaise(row.commissionTotal);
  }

  diagnostics({ revenuePaise, productCostPaise, staffCostPaise, operatingExpensePaise, invoices }) {
    const warnings = [];
    if (revenuePaise > 0 && productCostPaise === 0) warnings.push("COGS source missing: approve product consume drafts or post inventory COGS journals.");
    if (revenuePaise > 0 && staffCostPaise === 0) warnings.push("Staff cost source missing: run staff payout or commission calculation for this period.");
    if (revenuePaise > 0 && operatingExpensePaise === 0) warnings.push("Operating expenses missing for this period.");
    if (!invoices.length) warnings.push("No invoices found for this period and branch.");
    return { warnings };
  }
}

export const profitIntelligenceService = new ProfitIntelligenceService();
