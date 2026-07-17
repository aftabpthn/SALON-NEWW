import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { teamChatService } from "./team-chat.service.js";
import { ensureTeamChatSchema } from "./team-chat-schema.service.js";
import { realtimeService } from "./realtime.service.js";
import { ensureOwnerOperationsSchema } from "./owner-operations-schema.service.js";
import { badRequest, forbidden, notFound } from "../utils/app-error.js";

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLowerCase();
const paise = (value) => Math.round(Number(value || 0) * 100);
const jsonArray = (value) => { try { const result = Array.isArray(value) ? value : JSON.parse(value || "[]"); return Array.isArray(result) ? result : []; } catch { return []; } };
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${randomUUID().slice(0, 12)}`;

function ownerContext(access, requestedBranch = "all") {
  if (lower(access?.role) !== "owner") throw forbidden("Owner role is required");
  const owner = db.prepare(`SELECT id, role, status, branchIds FROM tenant_users WHERE tenantId = @tenantId AND id = @userId`).get({ tenantId: text(access?.tenantId), userId: text(access?.userId) });
  if (!owner || lower(owner.role) !== "owner" || lower(owner.status) !== "active") throw forbidden("Active owner access is required");
  const assigned = [...new Set(jsonArray(owner.branchIds).map(text).filter(Boolean))];
  if (!assigned.length) throw forbidden("This owner has no assigned branches");
  const params = { tenantId: text(access.tenantId) };
  const names = assigned.map((branchId, index) => { params[`branch${index}`] = branchId; return `@branch${index}`; });
  const branches = db.prepare(`SELECT id, name, status FROM branches WHERE tenantId = @tenantId AND id IN (${names.join(",")}) ORDER BY name, id`).all(params);
  const requested = text(requestedBranch || "all");
  const selected = lower(requested) === "all" ? branches : branches.filter((branch) => branch.id === requested);
  if (!selected.length) throw forbidden("The requested branch is not assigned to this owner");
  return { tenantId: text(access.tenantId), ownerUserId: text(access.userId), branches, selected, branchIds: selected.map((branch) => branch.id) };
}

function inScope(ids, column = "branchId", prefix = "scope") {
  const params = {};
  const names = ids.map((value, index) => { params[`${prefix}${index}`] = value; return `@${prefix}${index}`; });
  return { sql: `${column} IN (${names.join(",")})`, params };
}

function paging(query = {}) {
  const page = Math.max(1, Number.parseInt(text(query.page), 10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(text(query.pageSize), 10) || 30));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function response(items, total, pageInfo, metadata = {}) {
  return {
    items,
    page: { page: pageInfo.page, pageSize: pageInfo.pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageInfo.pageSize)), hasMore: pageInfo.offset + items.length < total },
    metadata: { timezone: "Asia/Kolkata", partial: false, unavailableSources: [], ...metadata }
  };
}

function branchMap(context) { return new Map(context.branches.map((branch) => [branch.id, branch.name])); }
function sortDirection(value) { return lower(value) === "asc" ? "ASC" : "DESC"; }
function tableColumns(table) { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)); }

function clients(access, query = {}) {
  const context = ownerContext(access, query.branchId);
  const clientColumns = tableColumns("clients");
  const pageInfo = paging(query);
  const scope = inScope(context.branchIds, "c.branchId", "clientBranch");
  const where = ["c.tenantId = @tenantId", scope.sql];
  if (clientColumns.has("deletedAt")) where.push("(c.deletedAt IS NULL OR c.deletedAt = '')");
  const params = { tenantId: context.tenantId, ...scope.params, limit: pageInfo.pageSize, offset: pageInfo.offset };
  const search = text(query.search);
  if (search) { const fields = ["c.name", "c.phone", "c.email", "c.id"]; if (clientColumns.has("originalRecordId")) fields.push("c.originalRecordId"); where.push(`(${fields.map((field) => `${field} LIKE @search`).join(" OR ")})`); params.search = `%${search}%`; }
  if (query.relationship === "new") where.push("COALESCE(c.visitCount,0) = 0");
  if (query.relationship === "returning") where.push("COALESCE(c.visitCount,0) > 0");
  if (clientColumns.has("status") && query.status === "active") where.push("(c.status IS NULL OR lower(c.status) = 'active')");
  if (query.status === "inactive") where.push(clientColumns.has("status") ? "lower(COALESCE(c.status,'')) = 'inactive'" : "1 = 0");
  if (query.lastVisit === "never") where.push("COALESCE(c.lastVisitAt,'') = ''");
  if (query.lastVisit === "range" && query.from && query.to) { where.push("substr(c.lastVisitAt,1,10) BETWEEN @from AND @to"); params.from = text(query.from); params.to = text(query.to); }
  if (query.outstanding === "yes") where.push("EXISTS (SELECT 1 FROM invoices i JOIN sales s ON s.id=i.saleId AND s.tenantId=c.tenantId WHERE i.tenantId=c.tenantId AND i.clientId=c.id AND s.branchId=c.branchId AND COALESCE(i.balance,0)>0)");
  const whereSql = where.join(" AND ");
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM clients c WHERE ${whereSql}`).get(params)?.count || 0);
  const names = branchMap(context);
  const statusSelect = clientColumns.has("status") ? "c.status" : "'active' AS status";
  const rows = db.prepare(`SELECT c.id,c.name,c.phone,c.email,c.branchId,${statusSelect},c.visitCount,c.totalSpend,c.lastVisitAt,c.walletBalance,c.loyaltyPoints,c.membershipId,c.createdAt,c.updatedAt,
    COALESCE((SELECT SUM(i.balance) FROM invoices i JOIN sales s ON s.id=i.saleId AND s.tenantId=c.tenantId WHERE i.tenantId=c.tenantId AND i.clientId=c.id AND s.branchId=c.branchId AND COALESCE(i.balance,0)>0),0) AS outstanding
    FROM clients c WHERE ${whereSql} ORDER BY c.updatedAt ${sortDirection(query.sortDirection)}, c.id LIMIT @limit OFFSET @offset`).all(params);
  return response(rows.map((row) => ({ id: row.id, name: row.name, phone: text(row.phone), email: text(row.email), branchId: row.branchId, branchName: names.get(row.branchId) || "Assigned branch", status: row.status || "active", visitCount: Number(row.visitCount || 0), totalSpendPaise: paise(row.totalSpend), lastVisitAt: text(row.lastVisitAt), walletBalancePaise: paise(row.walletBalance), loyaltyPoints: Number(row.loyaltyPoints || 0), membershipId: text(row.membershipId), outstandingPaise: paise(row.outstanding), createdAt: row.createdAt, updatedAt: row.updatedAt })), total, pageInfo, { filters: { branchId: text(query.branchId || "all"), search } });
}

function clientDetail(clientId, access, query = {}) {
  const context = ownerContext(access, query.branchId);
  const scope = inScope(context.branchIds, "branchId", "clientDetailBranch");
  const client = db.prepare(`SELECT * FROM clients WHERE tenantId=@tenantId AND id=@clientId AND ${scope.sql}`).get({ tenantId: context.tenantId, clientId: text(clientId), ...scope.params });
  if (!client) throw notFound("Client not found in the selected owner branches");
  const appointmentScope = inScope(context.branchIds, "a.branchId", "visitBranch");
  const appointments = db.prepare(`SELECT a.id,a.branchId,a.startAt,a.endAt,a.status,a.serviceIds,a.notes,a.createdAt FROM appointments a WHERE a.tenantId=@tenantId AND a.clientId=@clientId AND ${appointmentScope.sql} ORDER BY a.startAt DESC LIMIT 100`).all({ tenantId: context.tenantId, clientId: client.id, ...appointmentScope.params });
  const salesScope = inScope(context.branchIds, "s.branchId", "saleBranch");
  const purchases = db.prepare(`SELECT s.id,s.branchId,s.items,s.total,s.status,s.createdAt,i.id AS invoiceId,i.invoiceNumber,i.balance,i.paid FROM sales s LEFT JOIN invoices i ON i.tenantId=s.tenantId AND i.saleId=s.id WHERE s.tenantId=@tenantId AND s.clientId=@clientId AND ${salesScope.sql} ORDER BY s.createdAt DESC LIMIT 100`).all({ tenantId: context.tenantId, clientId: client.id, ...salesScope.params });
  const membership = client.membershipId ? db.prepare(`SELECT id,planName,planCredits,creditsRemaining,validityDate,status,branchId FROM memberships WHERE tenantId=@tenantId AND id=@membershipId AND clientId=@clientId AND branchId=@branchId LIMIT 1`).get({ tenantId: context.tenantId, membershipId: client.membershipId, clientId: client.id, branchId: client.branchId }) || null : null;
  const outstanding = Number(db.prepare(`SELECT COALESCE(SUM(i.balance),0) AS total FROM invoices i JOIN sales s ON s.id=i.saleId AND s.tenantId=i.tenantId WHERE i.tenantId=@tenantId AND i.clientId=@clientId AND s.branchId=@branchId AND COALESCE(i.balance,0)>0`).get({ tenantId: context.tenantId, clientId: client.id, branchId: client.branchId })?.total || 0);
  const names = branchMap(context);
  return {
    client: { id: client.id, name: client.name, phone: text(client.phone), email: text(client.email), gender: text(client.gender), birthday: text(client.birthday), anniversary: text(client.anniversary), tags: jsonArray(client.tags).map(text), notes: text(client.notes), branchId: client.branchId, branchName: names.get(client.branchId) || "Assigned branch", status: client.status || "active", visitCount: Number(client.visitCount || 0), totalSpendPaise: paise(client.totalSpend), walletBalancePaise: paise(client.walletBalance), loyaltyPoints: Number(client.loyaltyPoints || 0), membershipId: text(client.membershipId), outstandingPaise: paise(outstanding), lastVisitAt: text(client.lastVisitAt), createdAt: client.createdAt, updatedAt: client.updatedAt },
    appointments: appointments.map((item) => ({ ...item, branchName: names.get(item.branchId) || "Assigned branch", serviceIds: jsonArray(item.serviceIds).map(text) })),
    purchases: purchases.map((item) => ({ id: item.id, branchId: item.branchId, branchName: names.get(item.branchId) || "Assigned branch", items: jsonArray(item.items), totalPaise: paise(item.total), paidPaise: paise(item.paid), balancePaise: paise(item.balance), status: item.status, createdAt: item.createdAt, invoiceId: text(item.invoiceId), invoiceNumber: text(item.invoiceNumber) })),
    membership,
    metadata: { timezone: "Asia/Kolkata", partial: true, unavailableSources: ["client documents", "client preferences", "client package assignments"], branchRelationship: context.branchIds }
  };
}

function inventory(access, query = {}) {
  const context = ownerContext(access, query.branchId);
  const pageInfo = paging(query);
  const scope = inScope(context.branchIds, "p.branchId", "productBranch");
  const where = ["p.tenantId=@tenantId", scope.sql];
  const params = { tenantId: context.tenantId, ...scope.params, limit: pageInfo.pageSize, offset: pageInfo.offset };
  const search = text(query.search);
  if (search) { where.push("(p.id LIKE @search OR p.name LIKE @search OR p.sku LIKE @search OR p.category LIKE @search OR p.supplier LIKE @search)"); params.search = `%${search}%`; }
  if (query.category) { where.push("p.category=@category"); params.category = text(query.category); }
  if (query.supplier) { where.push("p.supplier=@supplier"); params.supplier = text(query.supplier); }
  if (query.status === "low") where.push("p.stock > 0 AND p.stock <= p.lowStockThreshold");
  else if (query.status === "out") where.push("p.stock <= 0");
  else if (query.status === "reorder") where.push("p.stock <= p.lowStockThreshold");
  else if (query.status) { where.push("p.status=@status"); params.status = text(query.status); }
  const whereSql = where.join(" AND ");
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM products p WHERE ${whereSql}`).get(params)?.count || 0);
  const metric = db.prepare(`SELECT COUNT(*) AS products,SUM(CASE WHEN stock>0 AND stock<=lowStockThreshold THEN 1 ELSE 0 END) AS lowStock,SUM(CASE WHEN stock<=0 THEN 1 ELSE 0 END) AS outOfStock,SUM(CASE WHEN stock<=lowStockThreshold THEN 1 ELSE 0 END) AS reorderCount,SUM(stock*unitCost) AS stockValue FROM products p WHERE p.tenantId=@tenantId AND ${scope.sql}`).get({ tenantId: context.tenantId, ...scope.params });
  const categories = db.prepare(`SELECT DISTINCT trim(category) AS value FROM products p WHERE p.tenantId=@tenantId AND ${scope.sql} AND trim(COALESCE(category,''))<>'' ORDER BY value`).all({ tenantId: context.tenantId, ...scope.params }).map((row) => row.value);
  const suppliers = db.prepare(`SELECT DISTINCT trim(supplier) AS value FROM products p WHERE p.tenantId=@tenantId AND ${scope.sql} AND trim(COALESCE(supplier,''))<>'' ORDER BY value`).all({ tenantId: context.tenantId, ...scope.params }).map((row) => row.value);
  const sort = { name: "p.name", stock: "p.stock", value: "(p.stock*p.unitCost)", updated: "p.updatedAt" }[text(query.sort)] || "p.updatedAt";
  const names = branchMap(context);
  const rows = db.prepare(`SELECT p.* FROM products p WHERE ${whereSql} ORDER BY ${sort} ${sortDirection(query.sortDirection)}, p.id LIMIT @limit OFFSET @offset`).all(params);
  return { ...response(rows.map((row) => ({ id: row.id, name: row.name, sku: row.sku, category: row.category, supplier: row.supplier, branchId: row.branchId, branchName: names.get(row.branchId) || "Assigned branch", stock: Number(row.stock || 0), lowStockThreshold: Number(row.lowStockThreshold || 0), expiryDate: text(row.expiryDate), unitCostPaise: paise(row.unitCost), pricePaise: paise(row.price), stockValuePaise: paise(Number(row.stock || 0) * Number(row.unitCost || 0)), status: row.status || "active", updatedAt: row.updatedAt })), total, pageInfo), metrics: { products: Number(metric.products || 0), lowStock: Number(metric.lowStock || 0), outOfStock: Number(metric.outOfStock || 0), reorderCount: Number(metric.reorderCount || 0), stockValuePaise: paise(metric.stockValue) }, facets: { categories, suppliers } };
}

function inventoryDetail(productId, access, query = {}) {
  const context = ownerContext(access, query.branchId);
  const scope = inScope(context.branchIds, "branchId", "productDetailBranch");
  const product = db.prepare(`SELECT * FROM products WHERE tenantId=@tenantId AND id=@productId AND ${scope.sql}`).get({ tenantId: context.tenantId, productId: text(productId), ...scope.params });
  if (!product) throw notFound("Product not found in the selected owner branches");
  const transactions = db.prepare(`SELECT id,type,quantity,unitCost,totalCost,reason,referenceType,referenceId,createdAt FROM inventory_transactions WHERE tenantId=@tenantId AND productId=@productId AND branchId=@branchId ORDER BY createdAt DESC LIMIT 200`).all({ tenantId: context.tenantId, productId: product.id, branchId: product.branchId });
  const names = branchMap(context);
  return { product: { id: product.id, name: product.name, sku: product.sku, category: product.category, supplier: product.supplier, branchId: product.branchId, branchName: names.get(product.branchId) || "Assigned branch", stock: Number(product.stock || 0), lowStockThreshold: Number(product.lowStockThreshold || 0), expiryDate: text(product.expiryDate), unitCostPaise: paise(product.unitCost), pricePaise: paise(product.price), stockValuePaise: paise(Number(product.stock || 0) * Number(product.unitCost || 0)), status: product.status || "active", updatedAt: product.updatedAt }, transactions: transactions.map((item) => ({ id: item.id, type: item.type, quantity: Number(item.quantity || 0), unitCostPaise: paise(item.unitCost), totalCostPaise: paise(item.totalCost), reason: text(item.reason), referenceType: text(item.referenceType), referenceId: text(item.referenceId), createdAt: item.createdAt })), metadata: { timezone: "Asia/Kolkata", partial: false, unavailableSources: [] } };
}

function marketing(access, query = {}) {
  const context = ownerContext(access, query.branchId);
  const pageInfo = paging(query);
  const where = ["tenantId=@tenantId"];
  const params = { tenantId: context.tenantId, limit: pageInfo.pageSize, offset: pageInfo.offset };
  const search = text(query.search);
  if (search) { where.push("(name LIKE @search OR channel LIKE @search)"); params.search = `%${search}%`; }
  if (query.status) { where.push("status=@status"); params.status = text(query.status); }
  if (query.channel) { where.push("channel=@channel"); params.channel = text(query.channel); }
  if (context.branchIds.length && query.branchId && query.branchId !== "all") { where.push("branchId=@branchId"); params.branchId = text(query.branchId); }
  const whereSql = where.join(" AND ");
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM campaigns WHERE ${whereSql}`).get(params)?.count || 0);
  const names = branchMap(context);
  const items = db.prepare(`SELECT id,name,channel,segmentRule,status,scheduledAt,sentCount,branchId,createdAt,updatedAt FROM campaigns WHERE ${whereSql} ORDER BY updatedAt DESC,id LIMIT @limit OFFSET @offset`).all(params).map((row) => ({ ...row, audience: jsonArray(row.segmentRule), branchName: row.branchId ? (names.get(row.branchId) || "Assigned branch") : "Tenant-wide", scope: row.branchId ? "branch" : "tenant-wide", sentCount: Number(row.sentCount || 0) }));
  return response(items, total, pageInfo, { partial: text(query.branchId || "all") !== "all", unavailableSources: ["delivery failure and engagement counts"], scopeNote: "Campaigns can be tenant-wide or branch-scoped." });
}

function notificationCategory(row) {
  const value = `${lower(row.type)} ${lower(row.status)} ${lower(row.message)} ${lower(row.channel)}`;
  if (/failed|error|overdue|action|required|pending/.test(value)) return "action-required";
  if (/inventory|stock|product|expiry|waste/.test(value)) return "inventory";
  if (/payment|invoice|refund|finance|cash|payroll/.test(value)) return "financial";
  if (/staff|leave|attendance|roster|team/.test(value)) return "staff";
  if (/system|security|backup|integration|sync/.test(value)) return "system";
  return "business";
}

function notificationCategorySql() {
  const source = "lower(COALESCE(n.type,'') || ' ' || COALESCE(n.status,'') || ' ' || COALESCE(n.message,'') || ' ' || COALESCE(n.channel,''))";
  const matches = (terms) => `(${terms.map((term) => `${source} LIKE '%${term}%'`).join(" OR ")})`;
  return `CASE WHEN ${matches(["failed", "error", "overdue", "action", "required", "pending"])} THEN 'action-required' WHEN ${matches(["inventory", "stock", "product", "expiry", "waste"])} THEN 'inventory' WHEN ${matches(["payment", "invoice", "refund", "finance", "cash", "payroll"])} THEN 'financial' WHEN ${matches(["staff", "leave", "attendance", "roster", "team"])} THEN 'staff' WHEN ${matches(["system", "security", "backup", "integration", "sync"])} THEN 'system' ELSE 'business' END`;
}

function notificationRows(context, query = {}, includePaging = true) {
  ensureOwnerOperationsSchema();
  const pageInfo = paging(query);
  const scope = inScope(context.branchIds, "c.branchId", "notificationBranch");
  const where = ["n.tenantId=@tenantId", `(COALESCE(n.clientId,'')='' OR c.id IS NULL OR ${scope.sql})`];
  const params = { tenantId: context.tenantId, ownerUserId: context.ownerUserId, ...scope.params, limit: pageInfo.pageSize, offset: pageInfo.offset };
  const search = text(query.search);
  if (search) { where.push("(n.message LIKE @search OR n.type LIKE @search OR n.channel LIKE @search)"); params.search = `%${search}%`; }
  if (query.type) { where.push("n.type=@type"); params.type = text(query.type); }
  if (query.status) { where.push("n.status=@status"); params.status = text(query.status); }
  if (query.category) { where.push(`${notificationCategorySql()}=@category`); params.category = text(query.category); }
  if (query.read === "read") where.push("COALESCE(r.readAt,'')<>''");
  if (query.read === "unread") where.push("COALESCE(r.readAt,'')=''");
  const whereSql = where.join(" AND ");
  const join = `LEFT JOIN clients c ON c.tenantId=n.tenantId AND c.id=n.clientId LEFT JOIN ownerNotificationReceipts r ON r.tenantId=n.tenantId AND r.notificationId=n.id AND r.ownerUserId=@ownerUserId AND r.branchId=CASE WHEN c.id IS NULL THEN '__tenant__' ELSE c.branchId END`;
  const sql = `SELECT n.id,n.clientId,n.type,n.channel,n.message,n.status,n.createdAt,COALESCE(r.readAt,'') AS readAt,CASE WHEN c.id IS NULL THEN '__tenant__' ELSE c.branchId END AS receiptBranchId,CASE WHEN c.id IS NULL THEN NULL ELSE c.branchId END AS branchId FROM notifications n ${join} WHERE ${whereSql} ORDER BY n.createdAt DESC,n.id${includePaging ? " LIMIT @limit OFFSET @offset" : ""}`;
  return { rows: db.prepare(sql).all(params), pageInfo, params, whereSql, join };
}

function notifications(access, query = {}) {
  const context = ownerContext(access, query.branchId);
  const result = notificationRows(context, query);
  const names = branchMap(context);
  const items = result.rows.map((row) => ({ ...row, category: notificationCategory(row), isRead: !!row.readAt, branchId: row.branchId || null, branchName: row.branchId ? names.get(row.branchId) || "Assigned branch" : "Tenant-wide", scope: row.branchId ? "branch" : "tenant-wide", destination: null }));
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM notifications n ${result.join} WHERE ${result.whereSql}`).get(result.params)?.count || 0);
  const unreadTotal = Number(db.prepare(`SELECT COUNT(*) AS count FROM notifications n ${result.join} WHERE ${result.whereSql} AND COALESCE(r.readAt,'')=''`).get(result.params)?.count || 0);
  return response(items, total, result.pageInfo, { partial: true, unavailableSources: ["authoritative notification branch mapping", "direct-navigation targets"], scopeNote: "Legacy generic notifications are tenant-wide; read receipts are owner-specific.", unreadTotal });
}

function setNotificationRead(notificationId, read, access) {
  const context = ownerContext(access, "all");
  ensureOwnerOperationsSchema();
  const notification = db.prepare(`SELECT n.id,c.branchId FROM notifications n LEFT JOIN clients c ON c.tenantId=n.tenantId AND c.id=n.clientId WHERE n.tenantId=@tenantId AND n.id=@notificationId`).get({ tenantId: context.tenantId, notificationId: text(notificationId) });
  if (!notification) throw notFound("Notification not found");
  if (notification.branchId && !context.branchIds.includes(notification.branchId)) throw forbidden("This notification is outside the owner's assigned branches");
  const receiptBranchId = notification.branchId || "__tenant__";
  const timestamp = now();
  db.prepare(`INSERT INTO ownerNotificationReceipts (id,tenantId,branchId,ownerUserId,notificationId,readAt,createdAt,updatedAt) VALUES (@id,@tenantId,@branchId,@ownerUserId,@notificationId,@readAt,@createdAt,@updatedAt)
    ON CONFLICT(tenantId,branchId,ownerUserId,notificationId) DO UPDATE SET readAt=excluded.readAt,updatedAt=excluded.updatedAt`).run({ id: id("owner_notice"), tenantId: context.tenantId, branchId: receiptBranchId, ownerUserId: context.ownerUserId, notificationId: notification.id, readAt: read ? timestamp : "", createdAt: timestamp, updatedAt: timestamp });
  return { notificationId: notification.id, isRead: !!read, readAt: read ? timestamp : "" };
}

function markAllNotificationsRead(access, query = {}) {
  const context = ownerContext(access, query.branchId);
  const category = text(query.category);
  const rows = notificationRows(context, { ...query, page: 1, pageSize: 100 }, false).rows.filter((row) => !category || notificationCategory(row) === category);
  const timestamp = now();
  const upsert = db.prepare(`INSERT INTO ownerNotificationReceipts (id,tenantId,branchId,ownerUserId,notificationId,readAt,createdAt,updatedAt) VALUES (@id,@tenantId,@branchId,@ownerUserId,@notificationId,@readAt,@createdAt,@updatedAt)
    ON CONFLICT(tenantId,branchId,ownerUserId,notificationId) DO UPDATE SET readAt=excluded.readAt,updatedAt=excluded.updatedAt`);
  db.transaction(() => rows.forEach((row) => upsert.run({ id: id("owner_notice"), tenantId: context.tenantId, branchId: row.receiptBranchId, ownerUserId: context.ownerUserId, notificationId: row.id, readAt: timestamp, createdAt: timestamp, updatedAt: timestamp })))();
  return { updated: rows.length, readAt: timestamp };
}

function chatAccess(access, branchId) { return { ...access, branchId, requestedBranchId: branchId }; }
function ownerUnreadCount(conversation, access) {
  const params = { tenantId: access.tenantId, branchId: conversation.branchId, conversationId: conversation.id, userId: access.userId };
  const table = conversation.type === "team" ? "staffChatMessages" : "staffPrivateChatMessages";
  const conversationColumn = conversation.type === "team" ? "threadId" : "conversationId";
  const senderColumn = conversation.type === "team" ? "senderStaffId" : "senderUserId";
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} m WHERE m.tenantId=@tenantId AND m.branchId=@branchId AND m.${conversationColumn}=@conversationId AND m.${senderColumn}<>@userId
    AND NOT EXISTS (SELECT 1 FROM staffChatMessageReceipts r WHERE r.tenantId=m.tenantId AND r.branchId=m.branchId AND r.conversationId=@conversationId AND r.messageId=m.id AND r.userId=@userId AND r.readAt<>'')`).get(params)?.count || 0);
}
function chats(access, query = {}) {
  const context = ownerContext(access, query.branchId);
  const names = branchMap(context);
  const search = lower(query.search);
  const items = context.selected.flatMap((branch) => teamChatService.listConversations(chatAccess(access, branch.id)).map((conversation) => ({ ...conversation, branchName: names.get(branch.id) || "Assigned branch", unreadCount: ownerUnreadCount(conversation, access) }))).filter((item) => !search || lower(`${item.title} ${item.branchName}`).includes(search)).sort((a, b) => text(b.lastMessageAt || b.updatedAt).localeCompare(text(a.lastMessageAt || a.updatedAt)));
  const pageInfo = paging(query); const sliced = items.slice(pageInfo.offset, pageInfo.offset + pageInfo.pageSize);
  return response(sliced, items.length, pageInfo, { partial: true, unavailableSources: ["global message search"] });
}

function chatMessages(conversationId, access, query = {}) {
  const branchId = text(query.branchId);
  if (!branchId || lower(branchId) === "all") throw badRequest("A branchId is required for conversation messages");
  ownerContext(access, branchId);
  return { items: teamChatService.listMessages(text(conversationId), chatAccess(access, branchId)), metadata: { timezone: "Asia/Kolkata", branchId, partial: false, unavailableSources: [] } };
}

function sendChatMessage(conversationId, payload, access) {
  const branchId = text(payload?.branchId);
  if (!branchId || lower(branchId) === "all") throw badRequest("A branchId is required to send a message");
  ownerContext(access, branchId);
  return teamChatService.sendMessage(text(conversationId), payload, chatAccess(access, branchId));
}

function createPrivateChat(payload, access) {
  const branchId = text(payload?.branchId);
  if (!branchId || lower(branchId) === "all") throw badRequest("A branchId is required to create a private conversation");
  const context = ownerContext(access, branchId);
  ensureTeamChatSchema();
  const staffId = text(payload?.staffId);
  const staff = db.prepare(`SELECT u.id,u.name FROM tenant_users u JOIN staff s ON s.tenantId=u.tenantId AND s.id=u.staffId
    WHERE u.tenantId=@tenantId AND u.staffId=@staffId AND u.status='active' AND s.branchId=@branchId AND lower(u.role)<>'owner' LIMIT 1`).get({ tenantId: context.tenantId, staffId, branchId });
  if (!staff) throw notFound("Active staff login not found in this branch");
  const create = db.transaction(() => {
    const existing = db.prepare(`SELECT * FROM staffPrivateConversations WHERE tenantId=@tenantId AND branchId=@branchId AND staffUserId=@staffUserId AND ownerUserId=@ownerUserId`).get({ tenantId: context.tenantId, branchId, staffUserId: staff.id, ownerUserId: context.ownerUserId });
    if (existing) return { row: existing, created: false };
    const createdAt = now();
    const row = { id: id("private_chat"), tenantId: context.tenantId, branchId, staffUserId: staff.id, ownerUserId: context.ownerUserId, createdAt, updatedAt: createdAt };
    db.prepare(`INSERT INTO staffPrivateConversations (id,tenantId,branchId,staffUserId,ownerUserId,createdAt,updatedAt) VALUES (@id,@tenantId,@branchId,@staffUserId,@ownerUserId,@createdAt,@updatedAt)`).run(row);
    const insert = db.prepare(`INSERT INTO staffPrivateConversationParticipants (id,tenantId,branchId,conversationId,userId,participantRole,createdAt) VALUES (@id,@tenantId,@branchId,@conversationId,@userId,@participantRole,@createdAt)`);
    insert.run({ id: id("chat_part"), tenantId: context.tenantId, branchId, conversationId: row.id, userId: staff.id, participantRole: "staff", createdAt });
    insert.run({ id: id("chat_part"), tenantId: context.tenantId, branchId, conversationId: row.id, userId: context.ownerUserId, participantRole: "owner", createdAt });
    return { row, created: true };
  });
  const result = create();
  const conversation = { id: result.row.id, type: "private-owner", title: `${staff.name || "Staff member"} · Private`, branchId, branchName: context.selected[0].name, participantUserIds: [staff.id, context.ownerUserId], messageCount: 0, unreadCount: 0, lastMessageAt: "", createdAt: result.row.createdAt, updatedAt: result.row.updatedAt };
  if (result.created) {
    repositories.auditLogs.create({ id: id("audit"), branchId, actorUserId: context.ownerUserId, action: "owner.team_chat_conversation_created", entityType: "staffPrivateConversations", entityId: result.row.id, severity: "info", details: { staffUserId: staff.id } }, { tenantId: context.tenantId });
    realtimeService.sendToUsers("team-chat.conversation-created", { conversation }, { tenantId: context.tenantId, branchId, userIds: conversation.participantUserIds });
  }
  return conversation;
}

function markChatReceipts(conversationId, payload, access) {
  const branchId = text(payload?.branchId);
  if (!branchId || lower(branchId) === "all") throw badRequest("A branchId is required for message receipts");
  ownerContext(access, branchId);
  return teamChatService.markReceipts(text(conversationId), payload, chatAccess(access, branchId));
}

export const ownerOperationsService = { clients, clientDetail, inventory, inventoryDetail, marketing, notifications, setNotificationRead, markAllNotificationsRead, chats, chatMessages, sendChatMessage, createPrivateChat, markChatReceipts };
