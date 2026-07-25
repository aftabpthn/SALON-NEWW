use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use std::time::Instant;

const SLOW_INVENTORY_QUERY_MS: u128 = 250;

fn log_slow_inventory_query(
    op: &str,
    tenant_id: &str,
    branch_id: &str,
    duration_ms: u128,
    context: &str,
) {
    if duration_ms >= SLOW_INVENTORY_QUERY_MS {
        tracing::warn!(
            tenant_id = %tenant_id,
            branch_id = %branch_id,
            operation = op,
            duration_ms = duration_ms,
            context = %context,
            "slow inventory query"
        );
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct InventoryRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub sku: String,
    pub name: String,
    pub category: String,
    pub unit: String,
    pub stock_quantity: i32,
    pub reorder_point: i32,
    pub unit_cost_paise: i64,
    pub hsn_code: String,
    pub gst_percent: i32,
    pub barcode: String,
    pub batch_tracked: bool,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryBatchRecord {
    pub id: String,
    pub inventory_item_id: String,
    pub product_name: String,
    pub batch_number: String,
    pub barcode: String,
    pub expiry_date: Option<NaiveDate>,
    pub received_date: NaiveDate,
    pub quantity: i32,
    pub unit_cost_paise: i64,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryKitComponentRecord {
    pub component_inventory_item_id: String,
    pub component_name: String,
    pub quantity: i32,
}

#[derive(Debug, Clone, FromRow)]
pub struct BatchAllocationRecord {
    pub batch_id: String,
    pub batch_number: String,
    pub barcode: String,
    pub expiry_date: Option<NaiveDate>,
    pub received_date: NaiveDate,
    pub unit_cost_paise: i64,
    pub quantity: i32,
}

#[derive(Debug, Clone, FromRow)]
pub struct BatchReturnAllocationRecord {
    pub batch_id: String,
    pub allocated_quantity: i64,
    pub restored_quantity: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct InventoryControlItem {
    pub id: String,
    pub sku: String,
    pub name: String,
    pub stock_quantity: i32,
    pub reorder_point: i32,
    pub unit_cost_paise: i64,
    pub created_at: DateTime<Utc>,
    pub last_outbound_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow)]
pub struct InventoryControlCounts {
    pub pending_purchase_orders: i64,
    pub in_transit_transfers: i64,
    pub adjustment_entries: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct InventoryGlSnapshot {
    pub product_count: i64,
    pub inventory_value_paise: i64,
    pub gl_value_paise: i64,
    pub missing_cost_products: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct InventoryGlAuditRow {
    pub id: String,
    pub source_type: String,
    pub source_id: String,
    pub memo: String,
    pub amount_paise: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct InventoryProduct360Summary {
    pub stock_in_quantity: i64,
    pub stock_out_quantity: i64,
    pub last_movement_at: Option<DateTime<Utc>>,
    pub last_receipt_date: Option<NaiveDate>,
    pub last_supplier: Option<String>,
    pub recipe_count: i64,
    pub consumed_quantity: i64,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryLedgerRecord {
    pub id: String,
    pub inventory_item_id: String,
    pub item_name: String,
    pub movement_type: String,
    pub quantity_delta: i64,
    pub unit_cost_paise: i64,
    pub value_paise: i64,
    pub stock_after_quantity: Option<i32>,
    pub source: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryValuationRecord {
    pub inventory_item_id: String,
    pub product_name: String,
    pub category: String,
    pub stock_quantity: i64,
    pub unit_cost_paise: i64,
    pub stock_value_paise: i64,
    pub reorder_point: i32,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackbarUsageRecord {
    pub id: String,
    pub inventory_item_id: String,
    pub item_name: String,
    pub client_id: Option<String>,
    pub appointment_id: Option<String>,
    pub service_id: Option<String>,
    pub service_name: String,
    pub staff_id: Option<String>,
    pub staff_name: String,
    pub source: String,
    pub expected_quantity: i64,
    pub actual_quantity: i64,
    pub variance_quantity: i64,
    pub max_quantity: i64,
    pub wastage_percent: f64,
    pub approval_threshold_percent: f64,
    pub unit: String,
    pub status: String,
    pub notes: String,
    pub review_note: String,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct BackbarUsageForReview {
    pub id: String,
    pub inventory_item_id: String,
    pub actual_quantity: i32,
    pub status: String,
}

pub struct CreateInventory<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub sku: &'a str,
    pub name: &'a str,
    pub category: &'a str,
    pub unit: &'a str,
    pub stock_quantity: i32,
    pub reorder_point: i32,
    pub unit_cost_paise: i64,
    pub hsn_code: &'a str,
    pub gst_percent: i32,
    pub barcode: &'a str,
    pub batch_tracked: bool,
    pub active: bool,
}

pub struct UpdateInventory<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub sku: Option<&'a str>,
    pub name: Option<&'a str>,
    pub category: Option<&'a str>,
    pub unit: Option<&'a str>,
    pub reorder_point: Option<i32>,
    pub unit_cost_paise: Option<i64>,
    pub hsn_code: Option<&'a str>,
    pub gst_percent: Option<i32>,
    pub barcode: Option<&'a str>,
    pub batch_tracked: Option<bool>,
    pub active: Option<bool>,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    q: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<InventoryRecord>, sqlx::Error> {
    let started = Instant::now();
    let normalized_query = q.trim().to_lowercase();
    let rows = if normalized_query.is_empty() {
        sqlx::query_as::<_, InventoryRecord>(&select_sql(
            r#"
        WHERE tenant_id = $1
          AND branch_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3 OFFSET $4
        "#,
        ))
        .bind(tenant_id)
        .bind(branch_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(db)
        .await?
    } else {
        let like_pattern = format!("%{}%", normalized_query);
        sqlx::query_as::<_, InventoryRecord>(&select_sql(
            r#"
        WHERE tenant_id = $1
          AND branch_id = $2
          AND (
            LOWER(sku) LIKE $3
            OR LOWER(name) LIKE $3
            OR LOWER(category) LIKE $3
            OR LOWER(barcode) LIKE $3
          )
        ORDER BY created_at DESC, id DESC
        LIMIT $4 OFFSET $5
        "#,
        ))
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&like_pattern)
        .bind(limit)
        .bind(offset)
        .fetch_all(db)
        .await?
    };

    log_slow_inventory_query(
        "inventory.list",
        tenant_id,
        branch_id,
        started.elapsed().as_millis(),
        &format!(
            "page_limit={limit}, page_offset={offset}, has_query={}",
            !normalized_query.is_empty()
        ),
    );

    Ok(rows)
}

pub async fn count(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    q: &str,
) -> Result<i64, sqlx::Error> {
    let started = Instant::now();
    let normalized_query = q.trim().to_lowercase();
    let total = if normalized_query.is_empty() {
        sqlx::query_scalar(
            r#"SELECT COUNT(*)::BIGINT FROM inventory_items
               WHERE tenant_id=$1 AND branch_id=$2"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_one(db)
        .await?
    } else {
        let like_pattern = format!("%{}%", normalized_query);
        sqlx::query_scalar(
            r#"SELECT COUNT(*)::BIGINT FROM inventory_items
               WHERE tenant_id=$1 AND branch_id=$2
                 AND (LOWER(sku) LIKE $3 OR LOWER(name) LIKE $3
                      OR LOWER(category) LIKE $3 OR LOWER(barcode) LIKE $3)"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&like_pattern)
        .fetch_one(db)
        .await?
    };

    log_slow_inventory_query(
        "inventory.count",
        tenant_id,
        branch_id,
        started.elapsed().as_millis(),
        &format!("query_present={}", !normalized_query.is_empty()),
    );

    Ok(total)
}
pub async fn control_items(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<InventoryControlItem>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT item.id, item.sku, item.name, item.stock_quantity, item.reorder_point,
               item.unit_cost_paise, item.created_at,
               MAX(ledger.created_at) FILTER (WHERE ledger.quantity_delta < 0) AS last_outbound_at
        FROM inventory_items item
        LEFT JOIN inventory_stock_ledger ledger
          ON ledger.tenant_id = item.tenant_id
         AND ledger.branch_id = item.branch_id
         AND ledger.inventory_item_id = item.id
        WHERE item.tenant_id = $1 AND item.branch_id = $2 AND item.active = TRUE
        GROUP BY item.id, item.sku, item.name, item.stock_quantity, item.reorder_point,
                 item.unit_cost_paise, item.created_at
        ORDER BY item.name
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn control_counts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<InventoryControlCounts, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT
          (SELECT COUNT(*)::BIGINT FROM purchase_orders
           WHERE tenant_id = $1 AND branch_id = $2 AND status = 'pending_approval') AS pending_purchase_orders,
          (SELECT COUNT(*)::BIGINT FROM inventory_transfers
           WHERE tenant_id = $1 AND (source_branch_id = $2 OR destination_branch_id = $2)
             AND status = 'in_transit') AS in_transit_transfers,
          (SELECT COUNT(*)::BIGINT FROM inventory_stock_ledger
           WHERE tenant_id = $1 AND branch_id = $2 AND movement_type = 'adjustment') AS adjustment_entries
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn list_ledger(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    movement: &str,
    q: &str,
    limit: i64,
) -> Result<Vec<InventoryLedgerRecord>, sqlx::Error> {
    let started = Instant::now();
    let normalized_query = q.trim().to_lowercase();
    let from_ts = from
        .and_then(|value| value.and_hms_opt(0, 0, 0))
        .map(|value| Utc.from_utc_datetime(&value));
    let to_ts = to
        .and_then(|value| value.succ_opt())
        .and_then(|value| value.and_hms_opt(0, 0, 0))
        .map(|value| Utc.from_utc_datetime(&value));
    let q_like = if normalized_query.is_empty() {
        String::new()
    } else {
        format!("%{}%", normalized_query)
    };

    let has_from = from_ts.is_some();
    let has_to = to_ts.is_some();
    let has_movement = !movement.is_empty();
    let has_query = !q_like.is_empty();

    let mut next_param = 3;
    let mut where_sql = String::new();

    if has_from {
        where_sql.push_str(&format!(" AND ledger.created_at >= ${next_param}\n"));
        next_param += 1;
    }

    if has_to {
        where_sql.push_str(&format!(" AND ledger.created_at < ${next_param}\n"));
        next_param += 1;
    }

    if has_movement {
        where_sql.push_str(&format!(" AND ledger.movement_type = ${next_param}\n"));
        next_param += 1;
    }

    if has_query {
        let query_param = next_param;
        where_sql.push_str(&format!(
            " AND (LOWER(item.name) LIKE ${query_param}\n         OR LOWER(item.sku) LIKE ${query_param}\n         OR LOWER(item.category) LIKE ${query_param}\n         OR LOWER(COALESCE(ledger.source_id, '')) LIKE ${query_param}\n         OR LOWER(COALESCE(ledger.source_label, '')) LIKE ${query_param}\n         OR LOWER(COALESCE(ledger.reversal_reason, '')) LIKE ${query_param}\n         OR LOWER(COALESCE(ledger.reversal_of_ledger_id, '')) LIKE ${query_param}\n         OR LOWER(ledger.source_type) LIKE ${query_param})\n"
        ));
        next_param += 1;
    }

    let sql = format!(
        r#"
        SELECT ledger.id, ledger.inventory_item_id, item.name AS item_name,
               ledger.movement_type, ledger.quantity_delta::BIGINT AS quantity_delta,
               ledger.unit_cost_paise, ledger.value_paise,
               ledger.stock_before_quantity, ledger.stock_after_quantity,
               ledger.recorded_stock_after_quantity,
               COALESCE(NULLIF(ledger.reversal_reason, ''), NULLIF(ledger.source_label, ''), ledger.source_id) AS source,
               CASE WHEN ledger.reversal_of_ledger_id IS NULL THEN ledger.source_type ELSE 'ledger_reversal' END AS source_type,
               COALESCE(ledger.reversal_of_ledger_id, ledger.source_id) AS source_id,
               COALESCE(NULLIF(ledger.reversed_by_user_id, ''), ledger.actor_user_id) AS actor_user_id,
               ledger.client_id, ledger.appointment_id, ledger.service_id, ledger.staff_id,
               ledger.backbar_container_id, ledger.batch_allocations,
               ledger.provenance_complete, ledger.snapshot_status,
               ledger.created_at
        FROM inventory_digital_twin_ledger ledger
        JOIN inventory_items item ON item.id = ledger.inventory_item_id
          AND item.tenant_id = ledger.tenant_id AND item.branch_id = ledger.branch_id
        WHERE ledger.tenant_id = $1
          AND ledger.branch_id = $2{where_sql}
        ORDER BY ledger.created_at DESC, ledger.id DESC
        LIMIT ${next_param}
        "#,
        where_sql = where_sql
    );

    let mut query = sqlx::query_as::<_, InventoryLedgerRecord>(&sql)
        .bind(tenant_id)
        .bind(branch_id);

    if let Some(from_ts) = from_ts {
        query = query.bind(from_ts);
    }
    if let Some(to_ts) = to_ts {
        query = query.bind(to_ts);
    }
    if has_movement {
        query = query.bind(movement);
    }
    if has_query {
        query = query.bind(&q_like);
    }

    query = query.bind(limit);

    let rows = query.fetch_all(db).await?;

    log_slow_inventory_query(
        "inventory.ledger",
        tenant_id,
        branch_id,
        started.elapsed().as_millis(),
        &format!(
            "movement={}, limit={}, has_query={}",
            movement,
            limit,
            !normalized_query.is_empty()
        ),
    );

    Ok(rows)
}

pub async fn valuation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    as_of: NaiveDate,
) -> Result<Vec<InventoryValuationRecord>, sqlx::Error> {
    let started = Instant::now();
    let rows = sqlx::query_as(
        r#"
        SELECT item.id AS inventory_item_id, item.name AS product_name, item.category,
               (item.stock_quantity::BIGINT
                 - COALESCE(ledger.quantity_delta_sum, 0)::BIGINT)
                 AS stock_quantity,
               item.unit_cost_paise,
               (item.stock_quantity::BIGINT * item.unit_cost_paise
                 - COALESCE(ledger.value_delta_sum, 0)::BIGINT)
                 AS stock_value_paise,
               item.reorder_point
        FROM inventory_items item
        LEFT JOIN (
          SELECT
            inventory_item_id,
            COALESCE(SUM(quantity_delta::BIGINT), 0) AS quantity_delta_sum,
            COALESCE(SUM(quantity_delta::BIGINT * unit_cost_paise), 0) AS value_delta_sum
          FROM inventory_stock_ledger
          WHERE tenant_id = $1
            AND branch_id = $2
            AND created_at >= ($3::date + INTERVAL '1 day')
          GROUP BY inventory_item_id
        ) ledger ON ledger.inventory_item_id = item.id
        WHERE item.tenant_id = $1
          AND item.branch_id = $2
          AND item.created_at < ($3::date + INTERVAL '1 day')
        ORDER BY item.name
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(as_of)
    .fetch_all(db)
    .await?;

    log_slow_inventory_query(
        "inventory.valuation",
        tenant_id,
        branch_id,
        started.elapsed().as_millis(),
        &format!("as_of={as_of}"),
    );

    Ok(rows)
}
pub async fn gl_reconciliation_snapshot(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    as_of: NaiveDate,
    account_code: &str,
) -> Result<InventoryGlSnapshot, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH item_values AS (
          SELECT
            item.id,
            item.unit_cost_paise,
            CASE WHEN item.created_at < ($3::date + INTERVAL '1 day') THEN
              item.stock_quantity::BIGINT
              - COALESCE(SUM(ledger.quantity_delta::BIGINT)
                  FILTER (WHERE ledger.created_at >= ($3::date + INTERVAL '1 day')), 0)::BIGINT
            ELSE 0 END AS quantity_as_of,
            CASE WHEN item.created_at < ($3::date + INTERVAL '1 day') THEN
              item.stock_quantity::BIGINT * item.unit_cost_paise
              - COALESCE(SUM(ledger.quantity_delta::BIGINT * ledger.unit_cost_paise)
                  FILTER (WHERE ledger.created_at >= ($3::date + INTERVAL '1 day')), 0)::BIGINT
            ELSE 0 END AS value_as_of
          FROM inventory_items item
          LEFT JOIN inventory_stock_ledger ledger
            ON ledger.tenant_id = item.tenant_id
           AND ledger.branch_id = item.branch_id
           AND ledger.inventory_item_id = item.id
          WHERE item.tenant_id = $1 AND item.branch_id = $2
          GROUP BY item.id
        )
        SELECT
          COUNT(*) FILTER (WHERE quantity_as_of <> 0)::BIGINT AS product_count,
          COALESCE(SUM(value_as_of), 0)::BIGINT AS inventory_value_paise,
          COALESCE((
            SELECT SUM(line.debit_paise - line.credit_paise)::BIGINT
            FROM accounting_journal_entries entry
            JOIN accounting_journal_lines line ON line.journal_entry_id = entry.id
            WHERE entry.tenant_id = $1
              AND entry.branch_id = $2
              AND entry.created_at < ($3::date + INTERVAL '1 day')
              AND line.account_code = $4
          ), 0)::BIGINT AS gl_value_paise,
          COUNT(*) FILTER (WHERE quantity_as_of > 0 AND unit_cost_paise <= 0)::BIGINT
            AS missing_cost_products
        FROM item_values
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(as_of)
    .bind(account_code)
    .fetch_one(db)
    .await
}

pub async fn gl_reconciliation_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    as_of: NaiveDate,
    account_code: &str,
    limit: i64,
) -> Result<Vec<InventoryGlAuditRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT entry.id, entry.source_type, entry.source_id, entry.memo,
               SUM(line.debit_paise - line.credit_paise)::BIGINT AS amount_paise,
               entry.created_at
        FROM accounting_journal_entries entry
        JOIN accounting_journal_lines line ON line.journal_entry_id = entry.id
        WHERE entry.tenant_id = $1
          AND entry.branch_id = $2
          AND entry.created_at < ($3::date + INTERVAL '1 day')
          AND line.account_code = $4
        GROUP BY entry.id
        ORDER BY entry.created_at DESC, entry.id DESC
        LIMIT $5
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(as_of)
    .bind(account_code)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn get(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<InventoryRecord>, sqlx::Error> {
    sqlx::query_as::<_, InventoryRecord>(&select_sql(
        r#"
        WHERE tenant_id = $1
          AND branch_id = $2
          AND id = $3
        LIMIT 1
        "#,
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn product_360_summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<InventoryProduct360Summary, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT
          COALESCE((SELECT SUM(quantity_delta::BIGINT) FROM inventory_stock_ledger
            WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND quantity_delta > 0), 0)::BIGINT AS stock_in_quantity,
          COALESCE((SELECT SUM(ABS(quantity_delta)::BIGINT) FROM inventory_stock_ledger
            WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND quantity_delta < 0), 0)::BIGINT AS stock_out_quantity,
          (SELECT MAX(created_at) FROM inventory_stock_ledger
            WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3) AS last_movement_at,
          (SELECT receipt.received_date FROM purchase_receipt_lines line
            JOIN purchase_receipts receipt ON receipt.id=line.purchase_receipt_id
             AND receipt.tenant_id=line.tenant_id AND receipt.branch_id=line.branch_id
            WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.inventory_item_id=$3
            ORDER BY receipt.received_date DESC, receipt.created_at DESC LIMIT 1) AS last_receipt_date,
          (SELECT receipt.supplier_name FROM purchase_receipt_lines line
            JOIN purchase_receipts receipt ON receipt.id=line.purchase_receipt_id
             AND receipt.tenant_id=line.tenant_id AND receipt.branch_id=line.branch_id
            WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.inventory_item_id=$3
            ORDER BY receipt.received_date DESC, receipt.created_at DESC LIMIT 1) AS last_supplier,
          (SELECT COUNT(*)::BIGINT FROM services service
            WHERE service.tenant_id=$1 AND service.branch_id=$2
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(service.product_consumption_json) entry
                WHERE COALESCE(entry->>'itemId', entry->>'productId', entry->>'inventoryItemId')=$3
              )) AS recipe_count,
          COALESCE((SELECT SUM(ABS(ledger.quantity_delta)::BIGINT)
            FROM inventory_stock_ledger ledger
            JOIN pos_sale_lines line ON line.id=ledger.sale_line_id
             AND line.tenant_id=ledger.tenant_id AND line.branch_id=ledger.branch_id
            WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2
              AND ledger.inventory_item_id=$3 AND ledger.movement_type='sale'
              AND line.line_type='service'), 0)::BIGINT AS consumed_quantity
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_one(db)
    .await
}

pub async fn create(
    db: &PgPool,
    input: CreateInventory<'_>,
) -> Result<InventoryRecord, sqlx::Error> {
    sqlx::query_as::<_, InventoryRecord>(
        r#"
        INSERT INTO inventory_items (
          tenant_id, branch_id, sku, name, category, unit,
          stock_quantity, reorder_point, unit_cost_paise, hsn_code, gst_percent, barcode, batch_tracked, active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING
          id, tenant_id, branch_id, sku, name, category, unit,
          stock_quantity, reorder_point, unit_cost_paise, hsn_code, gst_percent, barcode, batch_tracked, active, created_at, updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.sku)
    .bind(input.name)
    .bind(input.category)
    .bind(input.unit)
    .bind(input.stock_quantity)
    .bind(input.reorder_point)
    .bind(input.unit_cost_paise)
    .bind(input.hsn_code)
    .bind(input.gst_percent)
    .bind(input.barcode)
    .bind(input.batch_tracked)
    .bind(input.active)
    .fetch_one(db)
    .await
}

pub async fn update(
    tx: &mut Transaction<'_, Postgres>,
    input: UpdateInventory<'_>,
) -> Result<Option<InventoryRecord>, sqlx::Error> {
    sqlx::query_as::<_, InventoryRecord>(
        r#"
        UPDATE inventory_items
        SET
          sku = COALESCE($4, sku),
          name = COALESCE($5, name),
          category = COALESCE($6, category),
          unit = COALESCE($7, unit),
          reorder_point = COALESCE($8, reorder_point),
          unit_cost_paise = COALESCE($9, unit_cost_paise),
          hsn_code = COALESCE($10, hsn_code),
          gst_percent = COALESCE($11, gst_percent),
          barcode = COALESCE($12, barcode),
          batch_tracked = COALESCE($13, batch_tracked),
          active = COALESCE($14, active),
          updated_at = NOW()
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        RETURNING
          id, tenant_id, branch_id, sku, name, category, unit,
          stock_quantity, reorder_point, unit_cost_paise, hsn_code, gst_percent, barcode, batch_tracked, active, created_at, updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.id)
    .bind(input.sku)
    .bind(input.name)
    .bind(input.category)
    .bind(input.unit)
    .bind(input.reorder_point)
    .bind(input.unit_cost_paise)
    .bind(input.hsn_code)
    .bind(input.gst_percent)
    .bind(input.barcode)
    .bind(input.batch_tracked)
    .bind(input.active)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn lock_for_adjustment(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<InventoryRecord>, sqlx::Error> {
    sqlx::query_as::<_, InventoryRecord>(&select_sql(
        "WHERE tenant_id = $1 AND branch_id = $2 AND id = $3 FOR UPDATE",
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn franchise_override_context(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<(Option<String>, Vec<String>, Vec<String>)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT item.central_master_item_id,item.franchise_override_fields,
                  COALESCE(policy.allowed_override_fields,'{}'::TEXT[])
             FROM inventory_items item
             LEFT JOIN franchise_policies policy ON policy.tenant_id=item.tenant_id
            WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.id=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn record_franchise_overrides(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    fields: &[String],
) -> Result<(), sqlx::Error> {
    if fields.is_empty() {
        return Ok(());
    }
    sqlx::query(
        r#"UPDATE inventory_items
              SET franchise_override_fields=ARRAY(
                    SELECT DISTINCT UNNEST(franchise_override_fields || $4::TEXT[])),
                  updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
              AND central_master_item_id IS NOT NULL"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(fields)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn adjustment_replay(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    idempotency_key: &str,
) -> Result<Option<(String, i32)>, sqlx::Error> {
    sqlx::query_as(
        "SELECT inventory_item_id, stock_after_quantity FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND adjustment_idempotency_key=$3 AND movement_type='adjustment'",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(idempotency_key)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn apply_adjusted_stock(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    stock_quantity: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE inventory_items SET stock_quantity=$4, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(stock_quantity)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn apply_stock_and_cost(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    stock_quantity: i32,
    unit_cost_paise: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_items SET stock_quantity=$4,unit_cost_paise=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).bind(stock_quantity).bind(unit_cost_paise)
        .execute(&mut **tx).await?;
    Ok(())
}

pub async fn add_adjustment_ledger(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    quantity_delta: i32,
    unit_cost_paise: i64,
    stock_after_quantity: i32,
    reason: &str,
    idempotency_key: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO inventory_stock_ledger (tenant_id, branch_id, inventory_item_id, sale_id, sale_line_id, movement_type, quantity_delta, unit_cost_paise, stock_after_quantity, adjustment_reason, adjustment_idempotency_key) VALUES ($1,$2,$3,NULL,NULL,'adjustment',$4,$5,$6,$7,NULLIF($8,'')) RETURNING id",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(inventory_item_id)
    .bind(quantity_delta)
    .bind(unit_cost_paise)
    .bind(stock_after_quantity)
    .bind(reason)
    .bind(idempotency_key)
    .fetch_one(&mut **tx)
    .await
}

pub async fn list_backbar_usage(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    business_date: Option<NaiveDate>,
    staff_id: &str,
    limit: i64,
) -> Result<Vec<BackbarUsageRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH usage AS (
          SELECT usage.id, usage.inventory_item_id, item.name AS item_name,
                 usage.client_id, usage.appointment_id,
                 usage.service_id, COALESCE(service.name, '') AS service_name,
                 usage.staff_id,
                 COALESCE(NULLIF(staff.appointment_display_name, ''),
                          NULLIF(BTRIM(CONCAT_WS(' ', staff.first_name, staff.last_name)), ''), '') AS staff_name,
                 'Manual'::TEXT AS source, usage.expected_quantity::BIGINT AS expected_quantity,
                 usage.actual_quantity::BIGINT AS actual_quantity,
                 (usage.actual_quantity - usage.expected_quantity)::BIGINT AS variance_quantity,
                 usage.max_quantity::BIGINT, usage.wastage_percent,
                 usage.approval_threshold_percent, usage.unit, usage.status, usage.notes,
                 usage.review_note, usage.reviewed_at, usage.created_at
          FROM inventory_backbar_usage usage
          JOIN inventory_items item ON item.id=usage.inventory_item_id
            AND item.tenant_id=usage.tenant_id AND item.branch_id=usage.branch_id
          LEFT JOIN services service ON service.id=usage.service_id
            AND service.tenant_id=usage.tenant_id AND service.branch_id=usage.branch_id
          LEFT JOIN staff ON staff.id=usage.staff_id
            AND staff.tenant_id=usage.tenant_id AND staff.branch_id=usage.branch_id
          WHERE usage.tenant_id=$1 AND usage.branch_id=$2
          UNION ALL
          SELECT ledger.id, ledger.inventory_item_id, item.name,
                 NULLIF(sale.client_id, '') AS client_id, NULL::TEXT AS appointment_id,
                 NULLIF(line.item_id, ''), line.item_name,
                 NULLIF(line.staff_id, ''),
                 COALESCE(NULLIF(staff.appointment_display_name, ''),
                          NULLIF(BTRIM(CONCAT_WS(' ', staff.first_name, staff.last_name)), ''), '') AS staff_name,
                 sale.invoice_number, ABS(ledger.quantity_delta)::BIGINT, ABS(ledger.quantity_delta)::BIGINT,
                 0::BIGINT, 0::BIGINT, 0::DOUBLE PRECISION, 0::DOUBLE PRECISION,
                 item.unit, 'auto_consumed'::TEXT, ''::TEXT, ''::TEXT, NULL::TIMESTAMPTZ,
                 ledger.created_at
          FROM inventory_stock_ledger ledger
          JOIN inventory_items item ON item.id=ledger.inventory_item_id
            AND item.tenant_id=ledger.tenant_id AND item.branch_id=ledger.branch_id
          JOIN pos_sale_lines line ON line.id=ledger.sale_line_id AND line.line_type='service'
            AND line.tenant_id=ledger.tenant_id AND line.branch_id=ledger.branch_id
          JOIN pos_sales sale ON sale.id=ledger.sale_id
            AND sale.tenant_id=ledger.tenant_id AND sale.branch_id=ledger.branch_id
          LEFT JOIN staff ON staff.id=NULLIF(line.staff_id, '')
            AND staff.tenant_id=ledger.tenant_id AND staff.branch_id=ledger.branch_id
          WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2 AND ledger.movement_type='sale'
        )
        SELECT id, inventory_item_id, item_name, client_id, appointment_id, service_id, service_name, staff_id, staff_name,
               source, expected_quantity, actual_quantity, variance_quantity, max_quantity,
               wastage_percent, approval_threshold_percent, unit, status, notes, review_note,
               reviewed_at, created_at
        FROM usage
        WHERE ($3::DATE IS NULL OR created_at::DATE=$3)
          AND ($4='' OR staff_id=$4)
        ORDER BY created_at DESC, id DESC
        LIMIT $5
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(business_date)
    .bind(staff_id)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn backbar_usage_by_key(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    idempotency_key: &str,
) -> Result<Option<BackbarUsageRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT usage.id, usage.inventory_item_id, item.name AS item_name,
               usage.client_id, usage.appointment_id,
               usage.service_id, COALESCE(service.name, '') AS service_name,
               usage.staff_id,
               COALESCE(NULLIF(staff.appointment_display_name, ''),
                        NULLIF(BTRIM(CONCAT_WS(' ', staff.first_name, staff.last_name)), ''), '') AS staff_name,
               'Manual'::TEXT AS source, usage.expected_quantity::BIGINT AS expected_quantity,
               usage.actual_quantity::BIGINT AS actual_quantity,
               (usage.actual_quantity - usage.expected_quantity)::BIGINT AS variance_quantity,
               usage.max_quantity::BIGINT, usage.wastage_percent,
               usage.approval_threshold_percent, usage.unit, usage.status, usage.notes,
               usage.review_note, usage.reviewed_at, usage.created_at
        FROM inventory_backbar_usage usage
        JOIN inventory_items item ON item.id=usage.inventory_item_id
          AND item.tenant_id=usage.tenant_id AND item.branch_id=usage.branch_id
        LEFT JOIN services service ON service.id=usage.service_id
          AND service.tenant_id=usage.tenant_id AND service.branch_id=usage.branch_id
        LEFT JOIN staff ON staff.id=usage.staff_id
          AND staff.tenant_id=usage.tenant_id AND staff.branch_id=usage.branch_id
        WHERE usage.tenant_id=$1 AND usage.branch_id=$2 AND usage.idempotency_key=$3
        "#,
    )
    .bind(tenant_id).bind(branch_id).bind(idempotency_key).fetch_optional(&mut **tx).await
}

pub async fn service_recipe(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT product_consumption_json::TEXT FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(service_id).fetch_optional(&mut **tx).await
}

pub async fn active_staff_exists(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE)")
        .bind(tenant_id).bind(branch_id).bind(staff_id).fetch_one(&mut **tx).await
}

pub async fn client_attribution_exists(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    appointment_id: Option<&str>,
) -> Result<bool, sqlx::Error> {
    if let Some(appointment_id) = appointment_id {
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND client_id=$4)")
            .bind(tenant_id)
            .bind(branch_id)
            .bind(appointment_id)
            .bind(client_id)
            .fetch_one(&mut **tx)
            .await
    } else {
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)")
            .bind(tenant_id)
            .bind(branch_id)
            .bind(client_id)
            .fetch_one(&mut **tx)
            .await
    }
}
#[allow(clippy::too_many_arguments)]
pub async fn insert_backbar_usage(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    inventory_item_id: &str,
    service_id: Option<&str>,
    staff_id: Option<&str>,
    client_id: Option<&str>,
    appointment_id: Option<&str>,
    unit: &str,
    expected_quantity: i32,
    actual_quantity: i32,
    max_quantity: i32,
    wastage_percent: f64,
    approval_threshold_percent: f64,
    status: &str,
    notes: &str,
    actor_user_id: &str,
    idempotency_key: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO inventory_backbar_usage (id,tenant_id,branch_id,inventory_item_id,service_id,staff_id,client_id,appointment_id,unit,expected_quantity,actual_quantity,max_quantity,wastage_percent,approval_threshold_percent,status,notes,actor_user_id,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)")
        .bind(id).bind(tenant_id).bind(branch_id).bind(inventory_item_id).bind(service_id).bind(staff_id)
        .bind(client_id).bind(appointment_id).bind(unit).bind(expected_quantity).bind(actual_quantity).bind(max_quantity).bind(wastage_percent)
        .bind(approval_threshold_percent).bind(status).bind(notes).bind(actor_user_id).bind(idempotency_key)
        .execute(&mut **tx).await?;
    Ok(())
}

pub async fn lock_backbar_usage_for_review(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<BackbarUsageForReview>, sqlx::Error> {
    sqlx::query_as("SELECT id,inventory_item_id,actual_quantity,status FROM inventory_backbar_usage WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut **tx).await
}

pub async fn review_backbar_usage(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
    reviewed_by_user_id: &str,
    review_note: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE inventory_backbar_usage SET status=$4,reviewed_by_user_id=$5,reviewed_at=NOW(),review_note=$6 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending_approval'")
        .bind(tenant_id).bind(branch_id).bind(id).bind(status).bind(reviewed_by_user_id).bind(review_note)
        .execute(&mut **tx).await?.rows_affected() == 1)
}

pub async fn backbar_usage_by_id(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<BackbarUsageRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT usage.id,usage.inventory_item_id,item.name AS item_name,usage.client_id,usage.appointment_id,usage.service_id,
                  COALESCE(service.name,'') AS service_name,usage.staff_id,
                  COALESCE(NULLIF(staff.appointment_display_name,''),NULLIF(BTRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),'') AS staff_name,
                  'Manual'::TEXT AS source,usage.expected_quantity::BIGINT,usage.actual_quantity::BIGINT,
                  (usage.actual_quantity-usage.expected_quantity)::BIGINT AS variance_quantity,
                  usage.max_quantity::BIGINT,usage.wastage_percent,usage.approval_threshold_percent,
                  usage.unit,usage.status,usage.notes,usage.review_note,usage.reviewed_at,usage.created_at
           FROM inventory_backbar_usage usage
           JOIN inventory_items item ON item.id=usage.inventory_item_id AND item.tenant_id=usage.tenant_id AND item.branch_id=usage.branch_id
           LEFT JOIN services service ON service.id=usage.service_id AND service.tenant_id=usage.tenant_id AND service.branch_id=usage.branch_id
           LEFT JOIN staff ON staff.id=usage.staff_id AND staff.tenant_id=usage.tenant_id AND staff.branch_id=usage.branch_id
           WHERE usage.tenant_id=$1 AND usage.branch_id=$2 AND usage.id=$3"#,
    )
    .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut **tx).await
}

pub async fn add_backbar_ledger(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    usage_id: &str,
    quantity: i32,
    unit_cost_paise: i64,
    stock_after: i32,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_stock_ledger (tenant_id,branch_id,inventory_item_id,sale_id,sale_line_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity,backbar_usage_id) VALUES ($1,$2,$3,NULL,NULL,'consumption',$4,$5,$6,$7) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(inventory_item_id).bind(-quantity).bind(unit_cost_paise)
        .bind(stock_after).bind(usage_id).fetch_one(&mut **tx).await
}

pub async fn list_batches(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<InventoryBatchRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT batch.id, batch.inventory_item_id, item.name AS product_name,
                  batch.batch_number, batch.barcode, batch.expiry_date, batch.received_date,
                  batch.quantity, batch.unit_cost_paise
           FROM inventory_batches batch
           JOIN inventory_items item ON item.id=batch.inventory_item_id
             AND item.tenant_id=batch.tenant_id AND item.branch_id=batch.branch_id
           WHERE batch.tenant_id=$1 AND batch.branch_id=$2
           ORDER BY batch.expiry_date NULLS LAST, item.name, batch.batch_number"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn upsert_batch(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    batch_number: &str,
    barcode: &str,
    expiry_date: Option<NaiveDate>,
    received_date: NaiveDate,
    quantity: i32,
    unit_cost_paise: i64,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar(
        r#"INSERT INTO inventory_batches
             (tenant_id,branch_id,inventory_item_id,batch_number,barcode,expiry_date,received_date,quantity,unit_cost_paise)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id,branch_id,inventory_item_id,batch_number)
           DO UPDATE SET quantity=inventory_batches.quantity+EXCLUDED.quantity,
                         barcode=CASE WHEN EXCLUDED.barcode='' THEN inventory_batches.barcode ELSE EXCLUDED.barcode END,
                         expiry_date=COALESCE(EXCLUDED.expiry_date,inventory_batches.expiry_date),
                         unit_cost_paise=EXCLUDED.unit_cost_paise,updated_at=NOW()
           RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(inventory_item_id)
    .bind(batch_number)
    .bind(barcode)
    .bind(expiry_date)
    .bind(received_date)
    .bind(quantity)
    .bind(unit_cost_paise)
    .fetch_one(&mut **tx)
    .await
}

pub async fn add_batch_movement(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    batch_id: &str,
    stock_ledger_id: &str,
    quantity_delta: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO inventory_batch_movements (tenant_id,branch_id,batch_id,stock_ledger_id,quantity_delta) VALUES ($1,$2,$3,$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(batch_id).bind(stock_ledger_id).bind(quantity_delta)
        .execute(&mut **tx).await?;
    Ok(())
}

pub async fn lock_fefo_batches(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
) -> Result<Vec<BatchAllocationRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id AS batch_id,batch_number,barcode,expiry_date,received_date,unit_cost_paise,quantity
           FROM inventory_batches
           WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND quantity>0
             AND (expiry_date IS NULL OR expiry_date>=CURRENT_DATE)
           ORDER BY expiry_date NULLS LAST,received_date,id FOR UPDATE"#,
    )
    .bind(tenant_id).bind(branch_id).bind(inventory_item_id)
    .fetch_all(&mut **tx).await
}

pub async fn lock_batch_by_number(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    batch_number: &str,
) -> Result<Option<BatchAllocationRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id AS batch_id,batch_number,barcode,expiry_date,received_date,unit_cost_paise,quantity
           FROM inventory_batches
           WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND batch_number=$4
           FOR UPDATE"#,
    )
    .bind(tenant_id).bind(branch_id).bind(inventory_item_id).bind(batch_number)
    .fetch_optional(&mut **tx).await
}

pub async fn set_batch_quantity(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    batch_id: &str,
    quantity: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_batches SET quantity=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(batch_id).bind(quantity)
        .execute(&mut **tx).await?;
    Ok(())
}

pub async fn stock_ledger_batch_allocations(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    stock_ledger_id: &str,
) -> Result<Vec<BatchAllocationRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT batch.id AS batch_id,batch.batch_number,batch.barcode,batch.expiry_date,
                  batch.received_date,batch.unit_cost_paise,ABS(movement.quantity_delta) AS quantity
           FROM inventory_batch_movements movement
           JOIN inventory_batches batch ON batch.id=movement.batch_id
             AND batch.tenant_id=movement.tenant_id AND batch.branch_id=movement.branch_id
           WHERE movement.tenant_id=$1 AND movement.branch_id=$2
             AND movement.stock_ledger_id=$3 AND movement.quantity_delta<0
           ORDER BY batch.expiry_date NULLS LAST,batch.received_date,batch.id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(stock_ledger_id)
    .fetch_all(&mut **tx)
    .await
}

pub async fn sale_batch_allocations_for_return(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_stock_ledger_id: &str,
) -> Result<Vec<BatchReturnAllocationRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT source.batch_id,ABS(source.quantity_delta)::BIGINT AS allocated_quantity,
                  COALESCE(SUM(restored.quantity_delta),0)::BIGINT AS restored_quantity
           FROM inventory_batch_movements source
           JOIN inventory_batches batch ON batch.id=source.batch_id
           JOIN inventory_stock_ledger sale_ledger ON sale_ledger.id=source.stock_ledger_id
             AND sale_ledger.tenant_id=source.tenant_id AND sale_ledger.branch_id=source.branch_id
           LEFT JOIN inventory_stock_ledger return_ledger ON return_ledger.tenant_id=sale_ledger.tenant_id
             AND return_ledger.branch_id=sale_ledger.branch_id AND return_ledger.sale_id=sale_ledger.sale_id
             AND return_ledger.sale_line_id=sale_ledger.sale_line_id AND return_ledger.inventory_item_id=sale_ledger.inventory_item_id
             AND return_ledger.movement_type='return'
           LEFT JOIN inventory_batch_movements restored ON restored.stock_ledger_id=return_ledger.id
             AND restored.batch_id=source.batch_id AND restored.quantity_delta>0
           WHERE source.tenant_id=$1 AND source.branch_id=$2 AND source.stock_ledger_id=$3
             AND source.quantity_delta<0
           GROUP BY source.batch_id,source.quantity_delta,batch.expiry_date,batch.received_date
           ORDER BY batch.expiry_date NULLS LAST,batch.received_date,source.batch_id"#,
    )
    .bind(tenant_id).bind(branch_id).bind(sale_stock_ledger_id)
    .fetch_all(&mut **tx).await
}

pub async fn add_to_batch_quantity(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    batch_id: &str,
    quantity: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_batches SET quantity=quantity+$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(batch_id).bind(quantity)
        .execute(&mut **tx).await?;
    Ok(())
}

pub async fn kit_components(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
) -> Result<Vec<InventoryKitComponentRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT component.component_inventory_item_id,item.name AS component_name,component.quantity
           FROM inventory_kit_components component
           JOIN inventory_items item ON item.id=component.component_inventory_item_id
             AND item.tenant_id=component.tenant_id AND item.branch_id=component.branch_id
           WHERE component.tenant_id=$1 AND component.branch_id=$2 AND component.kit_inventory_item_id=$3
           ORDER BY item.name,item.id"#,
    )
    .bind(tenant_id).bind(branch_id).bind(kit_inventory_item_id)
    .fetch_all(db).await
}

pub async fn kit_components_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
) -> Result<Vec<InventoryKitComponentRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT component.component_inventory_item_id,item.name AS component_name,component.quantity
           FROM inventory_kit_components component
           JOIN inventory_items item ON item.id=component.component_inventory_item_id
             AND item.tenant_id=component.tenant_id AND item.branch_id=component.branch_id
           WHERE component.tenant_id=$1 AND component.branch_id=$2 AND component.kit_inventory_item_id=$3
           ORDER BY component.component_inventory_item_id FOR UPDATE OF component"#,
    )
    .bind(tenant_id).bind(branch_id).bind(kit_inventory_item_id)
    .fetch_all(&mut **tx).await
}

pub async fn has_kit_components(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM inventory_kit_components WHERE tenant_id=$1 AND branch_id=$2 AND kit_inventory_item_id=$3)")
        .bind(tenant_id).bind(branch_id).bind(inventory_item_id).fetch_one(&mut **tx).await
}

pub async fn replace_kit_components(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
    components: &[(String, i32)],
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM inventory_kit_components WHERE tenant_id=$1 AND branch_id=$2 AND kit_inventory_item_id=$3")
        .bind(tenant_id).bind(branch_id).bind(kit_inventory_item_id).execute(&mut **tx).await?;
    for (component_id, quantity) in components {
        sqlx::query("INSERT INTO inventory_kit_components (tenant_id,branch_id,kit_inventory_item_id,component_inventory_item_id,quantity) SELECT $1,$2,$3,item.id,$5 FROM inventory_items item WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.id=$4 AND item.active=TRUE")
            .bind(tenant_id).bind(branch_id).bind(kit_inventory_item_id).bind(component_id).bind(quantity)
            .execute(&mut **tx).await?;
    }
    Ok(())
}

pub async fn kit_assembly_by_key(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    idempotency_key: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT id FROM inventory_kit_assemblies WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant_id).bind(branch_id).bind(idempotency_key).fetch_optional(&mut **tx).await
}

pub async fn create_kit_assembly(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
    quantity: i32,
    idempotency_key: &str,
    actor_user_id: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_kit_assemblies (tenant_id,branch_id,kit_inventory_item_id,quantity,idempotency_key,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(kit_inventory_item_id).bind(quantity).bind(idempotency_key).bind(actor_user_id)
        .fetch_one(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn add_kit_ledger(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    assembly_id: &str,
    movement_type: &str,
    quantity_delta: i32,
    unit_cost_paise: i64,
    stock_after_quantity: i32,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_stock_ledger (tenant_id,branch_id,inventory_item_id,sale_id,sale_line_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity,kit_assembly_id) VALUES ($1,$2,$3,NULL,NULL,$4,$5,$6,$7,$8) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(inventory_item_id).bind(movement_type).bind(quantity_delta)
        .bind(unit_cost_paise).bind(stock_after_quantity).bind(assembly_id).fetch_one(&mut **tx).await
}

pub async fn delete(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM inventory_items
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

fn select_sql(where_clause: &str) -> String {
    format!(
        r#"
        SELECT
          id, tenant_id, branch_id, sku, name, category, unit,
          stock_quantity, reorder_point, unit_cost_paise, hsn_code, gst_percent, barcode, batch_tracked, active, created_at, updated_at
        FROM inventory_items
        {where_clause}
        "#,
    )
}


#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryCommandCenterMetrics {
    pub stockout_risk: i64,
    pub overstock_risk: i64,
    pub open_purchase_orders: i64,
    pub in_transit_stock: i64,
    pub consumption_expected_quantity: i64,
    pub consumption_actual_quantity: i64,
    pub open_stock_audits: i64,
    pub ledger_trust_exceptions: i64,
    pub pending_approvals: i64,
    pub supplier_risk: i64,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryTransferOpportunity {
    pub source_branch_id: String,
    pub source_branch_name: String,
    pub destination_branch_id: String,
    pub destination_branch_name: String,
    pub source_inventory_item_id: String,
    pub destination_inventory_item_id: String,
    pub product_name: String,
    pub sku: String,
    pub category: String,
    pub source_stock_quantity: i32,
    pub destination_stock_quantity: i32,
    pub source_daily_usage: f64,
    pub destination_daily_usage: f64,
    pub suggested_quantity: i32,
    pub transfer_unit_cost_paise: Option<i64>,
    pub purchase_unit_cost_paise: Option<i64>,
    pub stock_transfer_cost_paise: Option<i64>,
    pub transport_cost_paise: Option<i64>,
    pub handling_cost_paise: Option<i64>,
    pub delay_cost_paise: Option<i64>,
    pub estimated_transfer_cost_paise: Option<i64>,
    pub estimated_purchase_cost_paise: Option<i64>,
    pub savings_paise: Option<i64>,
    pub cost_decision: String,
    pub source_coverage_days_after: Option<f64>,
    pub destination_coverage_days_after: Option<f64>,
    pub source_safe: bool,
    pub owner_approval_required: bool,
    pub approval_reason: String,
    pub earliest_expiry_date: Option<NaiveDate>,
    pub earliest_batch_id: Option<String>,
    pub earliest_batch_number: Option<String>,
    pub earliest_batch_quantity: Option<i32>,
}

#[derive(Debug, Clone, FromRow)]
pub struct InventoryExceptionEvidence {
    pub exception_type: String,
    pub entity_id: String,
    pub subject: String,
    pub severity: String,
    pub confidence_bps: i32,
    pub evidence: Value,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryExceptionReviewRecord {
    pub id: String,
    pub recommendation_key: String,
    pub category: String,
    pub evidence_hash: String,
    pub decision: String,
    pub review_note: String,
    pub reviewed_by: String,
    pub reviewed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryAutomationPolicy {
    pub tenant_id: String,
    pub branch_id: String,
    pub enabled: bool,
    pub auto_transfer_drafts: bool,
    pub auto_po_drafts: bool,
    pub monthly_budget_paise: i64,
    pub category_budgets_paise: Value,
    pub expiry_rescue_days: i32,
    pub run_interval_minutes: i32,
    pub escalation_minutes: i32,
    pub min_confidence_bps: i32,
    pub last_run_at: Option<DateTime<Utc>>,
    pub next_run_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryAutomationAction {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub action_type: String,
    pub status: String,
    pub dedupe_key: String,
    pub title: String,
    pub rationale: String,
    pub confidence_bps: i32,
    pub estimated_cost_paise: i64,
    pub payload_json: Value,
    pub requested_by: String,
    pub reviewed_by: Option<String>,
    pub review_note: String,
    pub resource_type: String,
    pub resource_id: String,
    pub last_error: String,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default)]
pub struct InventoryAutomationBudgetPosition {
    pub purchase_commitment_paise: i64,
    pub pending_expense_paise: i64,
    pub available_cash_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct InventoryCategoryCommitment {
    pub category: String,
    pub committed_paise: i64,
}

pub async fn product_360_extended(
    _db: &PgPool,
    _tenant_id: &str,
    _branch_id: &str,
    _id: &str,
) -> Result<Value, sqlx::Error> {
    Ok(serde_json::json!({
        "branchStocks": [],
        "expiryTimeline": [],
        "clientUsage": [],
        "entityLedger": [],
        "margin": {}
    }))
}

pub async fn service_recipe_versions(
    _db: &PgPool,
    _tenant_id: &str,
    _branch_id: &str,
    _service_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    Ok(Vec::new())
}

pub async fn command_center_metrics(
    _db: &PgPool,
    _tenant_id: &str,
    _branch_id: &str,
) -> Result<InventoryCommandCenterMetrics, sqlx::Error> {
    Ok(InventoryCommandCenterMetrics {
        stockout_risk: 0,
        overstock_risk: 0,
        open_purchase_orders: 0,
        in_transit_stock: 0,
        consumption_expected_quantity: 0,
        consumption_actual_quantity: 0,
        open_stock_audits: 0,
        ledger_trust_exceptions: 0,
        pending_approvals: 0,
        supplier_risk: 0,
    })
}

pub async fn transfer_opportunities(
    _db: &PgPool,
    _tenant_id: &str,
    _branch_id: &str,
    _limit: i64,
) -> Result<Vec<InventoryTransferOpportunity>, sqlx::Error> {
    Ok(Vec::new())
}

pub async fn exception_evidence(
    _db: &PgPool,
    _tenant_id: &str,
    _branch_id: &str,
    _variance_threshold_bps: i64,
    _limit: usize,
) -> Result<Vec<InventoryExceptionEvidence>, sqlx::Error> {
    Ok(Vec::new())
}

pub async fn exception_reviews(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<InventoryExceptionReviewRecord>, sqlx::Error> {
    sqlx::query_as::<_, InventoryExceptionReviewRecord>(
        "SELECT DISTINCT ON (recommendation_key,evidence_hash) id,recommendation_key,category,evidence_hash,decision,review_note,reviewed_by,reviewed_at FROM inventory_exception_reviews WHERE tenant_id=$1 AND branch_id=$2 ORDER BY recommendation_key,evidence_hash,reviewed_at DESC,id DESC",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn record_exception_review(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    recommendation_key: &str,
    category: &str,
    evidence_hash: &str,
    decision: &str,
    review_note: &str,
    reviewed_by: &str,
) -> Result<InventoryExceptionReviewRecord, sqlx::Error> {
    sqlx::query_as::<_, InventoryExceptionReviewRecord>(
        "INSERT INTO inventory_exception_reviews(tenant_id,branch_id,recommendation_key,category,evidence_hash,decision,review_note,reviewed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,recommendation_key,category,evidence_hash,decision,review_note,reviewed_by,reviewed_at",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(recommendation_key)
    .bind(category)
    .bind(evidence_hash)
    .bind(decision)
    .bind(review_note)
    .bind(reviewed_by)
    .fetch_one(db)
    .await
}

pub async fn automation_policy(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<InventoryAutomationPolicy>, sqlx::Error> {
    sqlx::query_as::<_, InventoryAutomationPolicy>(
        "SELECT tenant_id,branch_id,enabled,auto_transfer_drafts,auto_po_drafts,monthly_budget_paise,category_budgets_paise,expiry_rescue_days,run_interval_minutes,escalation_minutes,min_confidence_bps,last_run_at,next_run_at,updated_at FROM inventory_automation_policies WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn save_automation_policy(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    enabled: bool,
    auto_transfer_drafts: bool,
    auto_po_drafts: bool,
    monthly_budget_paise: i64,
    category_budgets_paise: &Value,
    expiry_rescue_days: i32,
    run_interval_minutes: i32,
    escalation_minutes: i32,
    min_confidence_bps: i32,
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO inventory_automation_policies(tenant_id,branch_id,enabled,auto_transfer_drafts,auto_po_drafts,monthly_budget_paise,category_budgets_paise,expiry_rescue_days,run_interval_minutes,escalation_minutes,min_confidence_bps,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (tenant_id,branch_id) DO UPDATE SET enabled=EXCLUDED.enabled,auto_transfer_drafts=EXCLUDED.auto_transfer_drafts,auto_po_drafts=EXCLUDED.auto_po_drafts,monthly_budget_paise=EXCLUDED.monthly_budget_paise,category_budgets_paise=EXCLUDED.category_budgets_paise,expiry_rescue_days=EXCLUDED.expiry_rescue_days,run_interval_minutes=EXCLUDED.run_interval_minutes,escalation_minutes=EXCLUDED.escalation_minutes,min_confidence_bps=EXCLUDED.min_confidence_bps,updated_by=EXCLUDED.updated_by,updated_at=NOW()",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(enabled)
    .bind(auto_transfer_drafts)
    .bind(auto_po_drafts)
    .bind(monthly_budget_paise)
    .bind(category_budgets_paise)
    .bind(expiry_rescue_days)
    .bind(run_interval_minutes)
    .bind(escalation_minutes)
    .bind(min_confidence_bps)
    .bind(actor)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn automation_actions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: i64,
) -> Result<Vec<InventoryAutomationAction>, sqlx::Error> {
    sqlx::query_as::<_, InventoryAutomationAction>(
        "SELECT id,tenant_id,branch_id,action_type,status,dedupe_key,title,rationale,confidence_bps,estimated_cost_paise,payload_json,requested_by,reviewed_by,review_note,resource_type,resource_id,last_error,reviewed_at,completed_at,created_at,updated_at FROM inventory_automation_actions WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT $3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn automation_budget_position(
    _db: &PgPool,
    _tenant_id: &str,
    _branch_id: &str,
) -> Result<InventoryAutomationBudgetPosition, sqlx::Error> {
    Ok(InventoryAutomationBudgetPosition::default())
}

pub async fn inventory_category_commitments(
    _db: &PgPool,
    _tenant_id: &str,
    _branch_id: &str,
) -> Result<Vec<InventoryCategoryCommitment>, sqlx::Error> {
    Ok(Vec::new())
}

pub async fn touch_automation_policy(db: &PgPool, tenant_id: &str, branch_id: &str) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE inventory_automation_policies SET last_run_at=NOW(),next_run_at=NOW()+(run_interval_minutes || ' minutes')::INTERVAL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND enabled=TRUE")
        .bind(tenant_id).bind(branch_id).execute(db).await?.rows_affected() == 1)
}

pub async fn recover_stale_automation_actions(_db: &PgPool) -> Result<u64, sqlx::Error> { Ok(0) }

pub async fn claim_due_automation_policies(_db: &PgPool, _limit: i64) -> Result<Vec<InventoryAutomationPolicy>, sqlx::Error> { Ok(Vec::new()) }

pub async fn escalate_due_automation_actions(_db: &PgPool) -> Result<u64, sqlx::Error> { Ok(0) }

pub async fn escalate_automation_actions(_db: &PgPool, _tenant_id: &str, _branch_id: &str, _minutes: i32) -> Result<u64, sqlx::Error> { Ok(0) }

pub async fn reject_automation_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    note: &str,
) -> Result<Option<InventoryAutomationAction>, sqlx::Error> {
    sqlx::query_as::<_, InventoryAutomationAction>("UPDATE inventory_automation_actions SET status='rejected',reviewed_by=$4,review_note=$5,reviewed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending_approval' RETURNING id,tenant_id,branch_id,action_type,status,dedupe_key,title,rationale,confidence_bps,estimated_cost_paise,payload_json,requested_by,reviewed_by,review_note,resource_type,resource_id,last_error,reviewed_at,completed_at,created_at,updated_at")
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor).bind(note).fetch_optional(db).await
}

pub async fn claim_automation_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    note: &str,
) -> Result<Option<InventoryAutomationAction>, sqlx::Error> {
    sqlx::query_as::<_, InventoryAutomationAction>("UPDATE inventory_automation_actions SET status='approved',reviewed_by=$4,review_note=$5,reviewed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending_approval' RETURNING id,tenant_id,branch_id,action_type,status,dedupe_key,title,rationale,confidence_bps,estimated_cost_paise,payload_json,requested_by,reviewed_by,review_note,resource_type,resource_id,last_error,reviewed_at,completed_at,created_at,updated_at")
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor).bind(note).fetch_optional(db).await
}

pub async fn finish_automation_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    resource_type: &str,
    resource_id: &str,
) -> Result<Option<InventoryAutomationAction>, sqlx::Error> {
    sqlx::query_as::<_, InventoryAutomationAction>("UPDATE inventory_automation_actions SET status='completed',resource_type=$4,resource_id=$5,completed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='approved' RETURNING id,tenant_id,branch_id,action_type,status,dedupe_key,title,rationale,confidence_bps,estimated_cost_paise,payload_json,requested_by,reviewed_by,review_note,resource_type,resource_id,last_error,reviewed_at,completed_at,created_at,updated_at")
        .bind(tenant_id).bind(branch_id).bind(id).bind(resource_type).bind(resource_id).fetch_optional(db).await
}

pub async fn fail_automation_action(db: &PgPool, tenant_id: &str, branch_id: &str, id: &str, error: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_automation_actions SET status='failed',last_error=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).bind(error).execute(db).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn create_automation_action(
    _db: &PgPool,
    _tenant_id: &str,
    _branch_id: &str,
    _action_type: &str,
    _status: &str,
    _dedupe_key: &str,
    _title: &str,
    _rationale: &str,
    _confidence_bps: i32,
    _estimated_cost_paise: i64,
    _payload: &Value,
    _actor: &str,
    _resource_type: &str,
    _resource_id: &str,
) -> Result<Option<InventoryAutomationAction>, sqlx::Error> {
    Ok(None)
}

pub async fn notify_automation_action(
    _db: &PgPool,
    _tenant_id: &str,
    _branch_id: &str,
    _action: &InventoryAutomationAction,
) -> Result<(), sqlx::Error> {
    Ok(())
}
