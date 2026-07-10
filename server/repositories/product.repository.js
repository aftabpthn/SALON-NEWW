import { columnsFor, db, deserialize } from "../db.js";
import { BaseRepository } from "./base.repository.js";

function truthy(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

export class ProductRepository extends BaseRepository {
  constructor() {
    super("products");
  }

  list(query = {}, scope = {}) {
    if (!truthy(query.noLimit) && !truthy(query.all)) return super.list(query, scope);
    const columns = columnsFor(this.table);
    const where = [];
    const params = {};
    const q = query.q || scope.q || "";
    const branchId = query.branchId || scope.branchId || "";
    const tenantId = query.tenantId || scope.tenantId || "";
    if (q) {
      where.push(`(${columns.map((column) => `${column} LIKE @q`).join(" OR ")})`);
      params.q = `%${q}%`;
    }
    if (branchId) {
      where.push("branchId = @branchId");
      params.branchId = branchId;
    }
    if (tenantId) {
      where.push("tenantId = @tenantId");
      params.tenantId = tenantId;
    }
    const sql = `SELECT * FROM products${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY createdAt DESC`;
    return db.prepare(sql).all(params).map((row) => deserialize(this.table, row));
  }
}
