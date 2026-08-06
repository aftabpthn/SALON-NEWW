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
    pub subcategory: String,
    pub brand: String,
    pub product_usage: String,
    pub unit: String,
    pub package_unit: String,
    pub units_per_package: i32,
    pub stock_quantity: i32,
    pub reorder_point: i32,
    pub alert_level: i32,
    pub desired_level: i32,
    pub order_level: i32,
    pub safety_stock_level: i32,
    pub unit_cost_paise: i64,
    pub retail_price_paise: i64,
    pub hsn_code: String,
    pub gst_percent: i32,
    pub barcode: String,
    pub barcodes: Vec<String>,
    pub batch_tracked: bool,
    pub dual_use_stock: bool,
    pub center_available: bool,
    pub online_sale_enabled: bool,
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

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryKitOperationRecord {
    pub id: String,
    pub kit_inventory_item_id: String,
    pub operation_type: String,
    pub quantity: i32,
    pub comments: String,
    pub actor_user_id: String,
    pub source_receipt_id: Option<String>,
    pub source_receipt_line_id: Option<String>,
    pub unit_cost_paise: i64,
    pub stock_after_quantity: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryAdjustmentRecord {
    pub id: String,
    pub inventory_item_id: String,
    pub item_name: String,
    pub business_date: NaiveDate,
    pub source: String,
    pub status: String,
    pub stock_before_quantity: i32,
    pub requested_stock_quantity: i32,
    pub quantity_delta: i32,
    pub unit_cost_paise: i64,
    pub value_paise: i64,
    pub material: bool,
    pub reason: String,
    pub evidence_reference: String,
    pub requested_by_user_id: String,
    pub reviewed_by_user_id: Option<String>,
    pub review_idempotency_key: Option<String>,
    pub review_note: String,
    pub adjustment_ledger_id: Option<String>,
    pub requested_at: DateTime<Utc>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub applied_at: Option<DateTime<Utc>>,
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
    pub alert_level: i32,
    pub desired_level: i32,
    pub order_level: i32,
    pub safety_stock_level: i32,
    pub pending_po_quantity: i64,
    pub pending_transfer_quantity: i64,
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
    pub retail_shelf_quantity: i64,
    pub sealed_backbar_quantity: i64,
    pub sealed_backbar_balance: i64,
    pub open_container_balance: i64,
    pub physical_total_quantity: i64,
    pub open_container_unit: Option<String>,
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
    pub stock_before_quantity: i32,
    pub stock_after_quantity: i32,
    pub recorded_stock_after_quantity: Option<i32>,
    pub source: String,
    pub source_type: String,
    pub source_id: String,
    pub actor_user_id: Option<String>,
    pub client_id: Option<String>,
    pub appointment_id: Option<String>,
    pub service_id: Option<String>,
    pub staff_id: Option<String>,
    pub backbar_container_id: Option<String>,
    pub batch_allocations: Value,
    pub provenance_complete: bool,
    pub snapshot_status: String,
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
    pub item_brand: String,
    pub client_id: Option<String>,
    pub appointment_id: Option<String>,
    pub client_name: String,
    pub service_id: Option<String>,
    pub service_name: String,
    pub staff_id: Option<String>,
    pub staff_name: String,
    pub source: String,
    pub expected_quantity: i64,
    pub actual_quantity: i64,
    pub wasted_quantity: i64,
    pub selected_batch_id: Option<String>,
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
    pub selected_batch_id: Option<String>,
    pub actor_user_id: String,
    pub status: String,
    pub container_id: Option<String>,
    pub staff_id: Option<String>,
    pub unit_cost_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct OpenBackbarContainer {
    pub id: String,
    pub remaining_quantity: i32,
    pub unit_cost_paise: i64,
}

pub struct CreateInventory<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub sku: &'a str,
    pub name: &'a str,
    pub category: &'a str,
    pub subcategory: &'a str,
    pub brand: &'a str,
    pub product_usage: &'a str,
    pub unit: &'a str,
    pub package_unit: &'a str,
    pub units_per_package: i32,
    pub stock_quantity: i32,
    pub reorder_point: i32,
    pub alert_level: i32,
    pub desired_level: i32,
    pub order_level: i32,
    pub safety_stock_level: i32,
    pub unit_cost_paise: i64,
    pub retail_price_paise: i64,
    pub hsn_code: &'a str,
    pub gst_percent: i32,
    pub barcode: &'a str,
    pub batch_tracked: bool,
    pub dual_use_stock: bool,
    pub center_available: bool,
    pub online_sale_enabled: bool,
    pub active: bool,
}

pub struct UpdateInventory<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub sku: Option<&'a str>,
    pub name: Option<&'a str>,
    pub category: Option<&'a str>,
    pub subcategory: Option<&'a str>,
    pub brand: Option<&'a str>,
    pub product_usage: Option<&'a str>,
    pub unit: Option<&'a str>,
    pub package_unit: Option<&'a str>,
    pub units_per_package: Option<i32>,
    pub reorder_point: Option<i32>,
    pub alert_level: Option<i32>,
    pub desired_level: Option<i32>,
    pub order_level: Option<i32>,
    pub safety_stock_level: Option<i32>,
    pub unit_cost_paise: Option<i64>,
    pub retail_price_paise: Option<i64>,
    pub hsn_code: Option<&'a str>,
    pub gst_percent: Option<i32>,
    pub barcode: Option<&'a str>,
    pub batch_tracked: Option<bool>,
    pub dual_use_stock: Option<bool>,
    pub center_available: Option<bool>,
    pub online_sale_enabled: Option<bool>,
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
               item.alert_level, item.desired_level, item.order_level, item.safety_stock_level,
               COALESCE((
                 SELECT SUM(line.quantity-line.received_quantity)
                 FROM purchase_order_lines line
                 JOIN purchase_orders po ON po.id=line.purchase_order_id
                   AND po.tenant_id=line.tenant_id AND po.branch_id=line.branch_id
                 WHERE line.tenant_id=item.tenant_id AND line.branch_id=item.branch_id
                   AND line.inventory_item_id=item.id
                   AND po.status IN ('pending_approval','approved','partially_received')
               ),0)::BIGINT AS pending_po_quantity,
               COALESCE((
                 SELECT SUM(GREATEST(line.quantity-line.received_retail_quantity-line.received_consumable_quantity-line.damaged_quantity-line.expired_quantity-line.short_quantity,0))
                 FROM inventory_transfer_lines line
                 JOIN inventory_transfers transfer ON transfer.id=line.transfer_id AND transfer.tenant_id=line.tenant_id
                 WHERE line.tenant_id=item.tenant_id
                   AND transfer.destination_branch_id=item.branch_id
                   AND line.destination_inventory_item_id=item.id
                   AND transfer.status IN ('raised','approved','dispatched','in_transit','partially_received')
               ),0)::BIGINT AS pending_transfer_quantity,
               item.unit_cost_paise, item.created_at,
               MAX(ledger.created_at) FILTER (WHERE ledger.quantity_delta < 0) AS last_outbound_at
        FROM inventory_items item
        LEFT JOIN inventory_stock_ledger ledger
          ON ledger.tenant_id = item.tenant_id
         AND ledger.branch_id = item.branch_id
         AND ledger.inventory_item_id = item.id
        WHERE item.tenant_id = $1 AND item.branch_id = $2 AND item.active = TRUE
        GROUP BY item.id, item.sku, item.name, item.stock_quantity, item.reorder_point,
                 item.alert_level, item.desired_level, item.order_level, item.safety_stock_level,
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
    offset: i64,
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
            " AND (LOWER(item.name) LIKE ${query_param}\n         OR LOWER(item.sku) LIKE ${query_param}\n         OR LOWER(item.category) LIKE ${query_param}\n         OR LOWER(COALESCE(ledger.source_id, '')) LIKE ${query_param}\n         OR LOWER(COALESCE(ledger.source_label, '')) LIKE ${query_param}\n         OR LOWER(COALESCE(source_ledger.reversal_reason, '')) LIKE ${query_param}\n         OR LOWER(COALESCE(source_ledger.reversal_of_ledger_id, '')) LIKE ${query_param}\n         OR LOWER(ledger.source_type) LIKE ${query_param})\n"
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
               COALESCE(NULLIF(source_ledger.reversal_reason, ''), NULLIF(ledger.source_label, ''), ledger.source_id) AS source,
               CASE WHEN source_ledger.reversal_of_ledger_id IS NULL THEN ledger.source_type ELSE 'ledger_reversal' END AS source_type,
               COALESCE(source_ledger.reversal_of_ledger_id, ledger.source_id) AS source_id,
               COALESCE(NULLIF(source_ledger.reversed_by_user_id, ''), ledger.actor_user_id) AS actor_user_id,
               ledger.client_id, ledger.appointment_id, ledger.service_id, ledger.staff_id,
               ledger.backbar_container_id, ledger.batch_allocations,
               ledger.provenance_complete, ledger.snapshot_status,
               ledger.created_at
        FROM inventory_digital_twin_ledger ledger
        JOIN inventory_items item ON item.id = ledger.inventory_item_id
          AND item.tenant_id = ledger.tenant_id AND item.branch_id = ledger.branch_id
        JOIN inventory_stock_ledger source_ledger ON source_ledger.id = ledger.id
          AND source_ledger.tenant_id = ledger.tenant_id AND source_ledger.branch_id = ledger.branch_id
        WHERE ledger.tenant_id = $1
          AND ledger.branch_id = $2{where_sql}
        ORDER BY ledger.created_at DESC, ledger.id DESC
        LIMIT ${next_param} OFFSET ${offset_param}
        "#,
        where_sql = where_sql,
        offset_param = next_param + 1,
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

    query = query.bind(limit).bind(offset);

    let rows = query.fetch_all(db).await?;

    log_slow_inventory_query(
        "inventory.ledger",
        tenant_id,
        branch_id,
        started.elapsed().as_millis(),
        &format!(
            "movement={}, limit={}, offset={}, has_query={}",
            movement,
            limit,
            offset,
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
        WITH open_containers AS (
          SELECT container.inventory_item_id,
            SUM(container.remaining_quantity::BIGINT-COALESCE((SELECT SUM(event.quantity_delta::BIGINT) FROM inventory_backbar_container_events event WHERE event.container_id=container.id AND event.tenant_id=container.tenant_id AND event.branch_id=container.branch_id AND event.created_at>=($3::date+INTERVAL '1 day')),0))::BIGINT AS quantity_as_of,
            SUM((container.remaining_quantity::BIGINT-COALESCE((SELECT SUM(event.quantity_delta::BIGINT) FROM inventory_backbar_container_events event WHERE event.container_id=container.id AND event.tenant_id=container.tenant_id AND event.branch_id=container.branch_id AND event.created_at>=($3::date+INTERVAL '1 day')),0))*COALESCE(container.unit_cost_paise,0))::BIGINT AS value_as_of
          FROM inventory_backbar_containers container
          WHERE container.tenant_id=$1 AND container.branch_id=$2 AND container.opened_at<($3::date+INTERVAL '1 day')
          GROUP BY container.inventory_item_id
        ), values AS (
          SELECT item.id,item.name,item.category,item.reorder_point,item.unit_cost_paise,
            item.stock_quantity::BIGINT-COALESCE(ledger.quantity_delta_sum,0)+COALESCE(container.quantity_as_of,0) AS quantity_as_of,
            item.stock_quantity::BIGINT*item.unit_cost_paise-COALESCE(ledger.value_delta_sum,0)+COALESCE(container.value_as_of,0) AS value_as_of
          FROM inventory_items item
          LEFT JOIN (
            SELECT inventory_item_id,SUM(quantity_delta::BIGINT) AS quantity_delta_sum,SUM(quantity_delta::BIGINT*unit_cost_paise) AS value_delta_sum
            FROM inventory_stock_ledger
            WHERE tenant_id=$1 AND branch_id=$2 AND created_at>=($3::date+INTERVAL '1 day')
            GROUP BY inventory_item_id
          ) ledger ON ledger.inventory_item_id=item.id
          LEFT JOIN open_containers container ON container.inventory_item_id=item.id
          WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.created_at<($3::date+INTERVAL '1 day')
        )
        SELECT id AS inventory_item_id,name AS product_name,category,quantity_as_of::BIGINT AS stock_quantity,
               (CASE WHEN quantity_as_of<>0 THEN value_as_of/quantity_as_of ELSE unit_cost_paise END)::BIGINT AS unit_cost_paise,
               value_as_of::BIGINT AS stock_value_paise,
               item.reorder_point
        FROM values item
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
        WITH open_container_values AS (
          SELECT container.inventory_item_id,
            COALESCE(SUM(container.remaining_quantity::BIGINT - COALESCE((
              SELECT SUM(event.quantity_delta::BIGINT)
              FROM inventory_backbar_container_events event
              WHERE event.tenant_id=container.tenant_id
                AND event.branch_id=container.branch_id
                AND event.container_id=container.id
                AND event.created_at >= ($3::date + INTERVAL '1 day')
            ),0)),0)::BIGINT AS quantity_as_of,
            COALESCE(SUM((container.remaining_quantity::BIGINT - COALESCE((
              SELECT SUM(event.quantity_delta::BIGINT)
              FROM inventory_backbar_container_events event
              WHERE event.tenant_id=container.tenant_id
                AND event.branch_id=container.branch_id
                AND event.container_id=container.id
                AND event.created_at >= ($3::date + INTERVAL '1 day')
            ),0))*COALESCE(container.unit_cost_paise,0)),0)::BIGINT AS value_as_of,
            COUNT(*) FILTER (WHERE container.unit_cost_paise IS NULL OR container.unit_cost_paise<=0)::BIGINT AS missing_cost
          FROM inventory_backbar_containers container
          WHERE container.tenant_id=$1 AND container.branch_id=$2
            AND container.opened_at < ($3::date + INTERVAL '1 day')
          GROUP BY container.inventory_item_id
        ), item_values AS (
          SELECT
            item.id,
            item.unit_cost_paise,
            CASE WHEN item.created_at < ($3::date + INTERVAL '1 day') THEN
              item.stock_quantity::BIGINT
              - COALESCE(SUM(ledger.quantity_delta::BIGINT)
                  FILTER (WHERE ledger.created_at >= ($3::date + INTERVAL '1 day')), 0)::BIGINT
            ELSE 0 END + COALESCE(container.quantity_as_of,0) AS quantity_as_of,
            CASE WHEN item.created_at < ($3::date + INTERVAL '1 day') THEN
              item.stock_quantity::BIGINT * item.unit_cost_paise
              - COALESCE(SUM(ledger.quantity_delta::BIGINT * ledger.unit_cost_paise)
                  FILTER (WHERE ledger.created_at >= ($3::date + INTERVAL '1 day')), 0)::BIGINT
            ELSE 0 END + COALESCE(container.value_as_of,0) AS value_as_of,
            COALESCE(container.missing_cost,0) AS missing_container_cost
          FROM inventory_items item
          LEFT JOIN inventory_stock_ledger ledger
            ON ledger.tenant_id = item.tenant_id
           AND ledger.branch_id = item.branch_id
           AND ledger.inventory_item_id = item.id
          LEFT JOIN open_container_values container ON container.inventory_item_id=item.id
          WHERE item.tenant_id = $1 AND item.branch_id = $2
          GROUP BY item.id,container.quantity_as_of,container.value_as_of,container.missing_cost
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
          COUNT(*) FILTER (WHERE quantity_as_of > 0 AND (unit_cost_paise <= 0 OR missing_container_cost > 0))::BIGINT
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
          (
            COALESCE((SELECT SUM(ABS(ledger.quantity_delta)::BIGINT)
              FROM inventory_stock_ledger ledger
              LEFT JOIN pos_sale_lines line ON line.id=ledger.sale_line_id
               AND line.tenant_id=ledger.tenant_id AND line.branch_id=ledger.branch_id
              WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2
                AND ledger.inventory_item_id=$3
                AND ((ledger.movement_type='sale' AND line.line_type='service')
                  OR (ledger.movement_type='consumption' AND ledger.backbar_container_id IS NULL))), 0)
            + COALESCE((SELECT SUM(ABS(event.quantity_delta)::BIGINT)
              FROM inventory_backbar_container_events event
              JOIN inventory_backbar_containers container ON container.id=event.container_id
               AND container.tenant_id=event.tenant_id AND container.branch_id=event.branch_id
              WHERE event.tenant_id=$1 AND event.branch_id=$2
                AND container.inventory_item_id=$3 AND event.event_type='consumed'), 0)
          )::BIGINT AS consumed_quantity,
          COALESCE((SELECT CASE WHEN item.dual_use_stock THEN GREATEST(item.stock_quantity-
              (SELECT COALESCE(SUM(container.capacity_quantity),0)::INTEGER FROM inventory_backbar_containers container
               WHERE container.tenant_id=$1 AND container.branch_id=$2
                 AND container.inventory_item_id=$3 AND container.status='sealed'),0)
            ELSE item.stock_quantity END::BIGINT
           FROM inventory_items item
           WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.id=$3),0)::BIGINT AS retail_shelf_quantity,
          (SELECT COUNT(*)::BIGINT FROM inventory_backbar_containers container
           WHERE container.tenant_id=$1 AND container.branch_id=$2
             AND container.inventory_item_id=$3 AND container.status='sealed') AS sealed_backbar_quantity,
          COALESCE((SELECT SUM(container.capacity_quantity)::BIGINT FROM inventory_backbar_containers container
           WHERE container.tenant_id=$1 AND container.branch_id=$2
             AND container.inventory_item_id=$3 AND container.status='sealed'),0)::BIGINT AS sealed_backbar_balance,
          COALESCE((SELECT SUM(container.remaining_quantity)::BIGINT
           FROM inventory_backbar_containers container
           WHERE container.tenant_id=$1 AND container.branch_id=$2
             AND container.inventory_item_id=$3 AND container.status='open'),0)::BIGINT AS open_container_balance,
          COALESCE((SELECT item.stock_quantity::BIGINT+COALESCE((SELECT SUM(container.remaining_quantity)::BIGINT
           FROM inventory_backbar_containers container WHERE container.tenant_id=$1 AND container.branch_id=$2
             AND container.inventory_item_id=$3 AND container.status='open'),0)
           FROM inventory_items item WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.id=$3),0)::BIGINT AS physical_total_quantity,
          (SELECT CASE WHEN COUNT(DISTINCT container.unit)=1 THEN MIN(container.unit)
                  WHEN COUNT(*)=0 THEN NULL ELSE 'mixed' END
           FROM inventory_backbar_containers container
           WHERE container.tenant_id=$1 AND container.branch_id=$2
             AND container.inventory_item_id=$3 AND container.status='open') AS open_container_unit
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_one(db)
    .await
}

pub async fn create(
    tx: &mut Transaction<'_, Postgres>,
    input: CreateInventory<'_>,
) -> Result<InventoryRecord, sqlx::Error> {
    sqlx::query_as::<_, InventoryRecord>(
        r#"
        INSERT INTO inventory_items (
          tenant_id, branch_id, sku, name, category, subcategory, brand, product_usage,
          unit, package_unit, units_per_package, stock_quantity, reorder_point, alert_level,
          desired_level, order_level, safety_stock_level, unit_cost_paise, retail_price_paise,
          hsn_code, gst_percent, barcode, batch_tracked, dual_use_stock, center_available, online_sale_enabled, active
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
        RETURNING
          id,tenant_id,branch_id,sku,name,category,subcategory,brand,product_usage,unit,
          package_unit,units_per_package,stock_quantity,reorder_point,alert_level,desired_level,
          order_level,safety_stock_level,unit_cost_paise,retail_price_paise,hsn_code,gst_percent,barcode,
          CASE WHEN barcode='' THEN ARRAY[]::TEXT[] ELSE ARRAY[barcode]::TEXT[] END AS barcodes,
          batch_tracked,dual_use_stock,center_available,online_sale_enabled,active,created_at,updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.sku)
    .bind(input.name)
    .bind(input.category)
    .bind(input.subcategory)
    .bind(input.brand)
    .bind(input.product_usage)
    .bind(input.unit)
    .bind(input.package_unit)
    .bind(input.units_per_package)
    .bind(input.stock_quantity)
    .bind(input.reorder_point)
    .bind(input.alert_level)
    .bind(input.desired_level)
    .bind(input.order_level)
    .bind(input.safety_stock_level)
    .bind(input.unit_cost_paise)
    .bind(input.retail_price_paise)
    .bind(input.hsn_code)
    .bind(input.gst_percent)
    .bind(input.barcode)
    .bind(input.batch_tracked)
    .bind(input.dual_use_stock)
    .bind(input.center_available)
    .bind(input.online_sale_enabled)
    .bind(input.active)
    .fetch_one(&mut **tx)
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
          subcategory = COALESCE($7, subcategory),
          brand = COALESCE($8, brand),
          product_usage = COALESCE($9, product_usage),
          unit = COALESCE($10, unit),
          package_unit = COALESCE($11, package_unit),
          units_per_package = COALESCE($12, units_per_package),
          reorder_point = COALESCE($13, reorder_point),
          alert_level = COALESCE($14, alert_level),
          desired_level = COALESCE($15, desired_level),
          order_level = COALESCE($16, order_level),
          safety_stock_level = COALESCE($17, safety_stock_level),
          unit_cost_paise = COALESCE($18, unit_cost_paise),
          retail_price_paise = COALESCE($19, retail_price_paise),
          hsn_code = COALESCE($20, hsn_code),
          gst_percent = COALESCE($21, gst_percent),
          barcode = COALESCE($22, barcode),
          batch_tracked = COALESCE($23, batch_tracked),
          dual_use_stock = COALESCE($24, dual_use_stock),
          center_available = COALESCE($25, center_available),
          online_sale_enabled = COALESCE($26, online_sale_enabled),
          active = COALESCE($27, active),
          updated_at = NOW()
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        RETURNING
          id,tenant_id,branch_id,sku,name,category,subcategory,brand,product_usage,unit,
          package_unit,units_per_package,stock_quantity,reorder_point,alert_level,desired_level,
          order_level,safety_stock_level,unit_cost_paise,retail_price_paise,hsn_code,gst_percent,barcode,
          COALESCE((SELECT ARRAY_AGG(entry.barcode ORDER BY entry.is_primary DESC,entry.created_at,entry.id)
            FROM inventory_item_barcodes entry WHERE entry.tenant_id=$1 AND entry.branch_id=$2
              AND entry.inventory_item_id=inventory_items.id AND entry.active),ARRAY[]::TEXT[]) AS barcodes,
          batch_tracked,dual_use_stock,center_available,online_sale_enabled,active,created_at,updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.id)
    .bind(input.sku)
    .bind(input.name)
    .bind(input.category)
    .bind(input.subcategory)
    .bind(input.brand)
    .bind(input.product_usage)
    .bind(input.unit)
    .bind(input.package_unit)
    .bind(input.units_per_package)
    .bind(input.reorder_point)
    .bind(input.alert_level)
    .bind(input.desired_level)
    .bind(input.order_level)
    .bind(input.safety_stock_level)
    .bind(input.unit_cost_paise)
    .bind(input.retail_price_paise)
    .bind(input.hsn_code)
    .bind(input.gst_percent)
    .bind(input.barcode)
    .bind(input.batch_tracked)
    .bind(input.dual_use_stock)
    .bind(input.center_available)
    .bind(input.online_sale_enabled)
    .bind(input.active)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn replace_barcodes(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    barcodes: &[String],
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM inventory_item_barcodes WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3")
        .bind(tenant_id).bind(branch_id).bind(inventory_item_id).execute(&mut **tx).await?;
    for (index, value) in barcodes.iter().enumerate() {
        sqlx::query("INSERT INTO inventory_item_barcodes(tenant_id,branch_id,inventory_item_id,barcode,is_primary) VALUES($1,$2,$3,$4,$5)")
            .bind(tenant_id).bind(branch_id).bind(inventory_item_id).bind(value).bind(index == 0)
            .execute(&mut **tx).await?;
    }
    Ok(())
}

pub async fn upsert_product_master_value(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    kind: &str,
    label: &str,
    parent_code: &str,
    actor_user_id: &str,
) -> Result<(), sqlx::Error> {
    if label.trim().is_empty() {
        return Ok(());
    }
    let code = label
        .trim()
        .to_lowercase()
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() {
                value
            } else {
                '-'
            }
        })
        .collect::<String>();
    let code = code.trim_matches('-');
    if code.is_empty() {
        return Ok(());
    }
    sqlx::query("INSERT INTO inventory_master_values(tenant_id,branch_id,kind,code,label,parent_code,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,branch_id,kind,(LOWER(code))) DO UPDATE SET label=EXCLUDED.label,parent_code=EXCLUDED.parent_code,active=TRUE,updated_at=NOW()")
        .bind(tenant_id).bind(branch_id).bind(kind).bind(code).bind(label.trim()).bind(parent_code).bind(actor_user_id)
        .execute(&mut **tx).await?;
    Ok(())
}

pub async fn master_edit_locked(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE((SELECT master_edit_lock FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),FALSE)")
        .bind(tenant_id).bind(branch_id).fetch_one(&mut **tx).await
}

pub async fn has_open_product_operations(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(r#"SELECT EXISTS(
      SELECT 1 FROM purchase_order_lines line JOIN purchase_orders po ON po.id=line.purchase_order_id
      WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.inventory_item_id=$3
        AND po.status IN ('draft','pending_approval','approved','partially_received')
      UNION ALL
      SELECT 1 FROM stock_count_session_items audit_item JOIN stock_count_sessions audit ON audit.id=audit_item.session_id
      WHERE audit_item.tenant_id=$1 AND audit_item.branch_id=$2 AND audit_item.inventory_item_id=$3
        AND audit.status NOT IN ('posted','cancelled','rejected')
    )"#).bind(tenant_id).bind(branch_id).bind(inventory_item_id).fetch_one(&mut **tx).await
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
    source: &str,
    evidence_reference: &str,
    business_date: Option<NaiveDate>,
    adjustment_request_id: Option<&str>,
    idempotency_key: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO inventory_stock_ledger (tenant_id,branch_id,inventory_item_id,sale_id,sale_line_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity,adjustment_reason,adjustment_source,adjustment_evidence_reference,adjustment_business_date,adjustment_request_id,adjustment_idempotency_key) VALUES ($1,$2,$3,NULL,NULL,'adjustment',$4,$5,$6,$7,$8,$9,$10,$11,NULLIF($12,'')) RETURNING id",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(inventory_item_id)
    .bind(quantity_delta)
    .bind(unit_cost_paise)
    .bind(stock_after_quantity)
    .bind(reason)
    .bind(source)
    .bind(evidence_reference)
    .bind(business_date)
    .bind(adjustment_request_id)
    .bind(idempotency_key)
    .fetch_one(&mut **tx)
    .await
}

const ADJUSTMENT_SELECT: &str = "SELECT request.id,request.inventory_item_id,item.name AS item_name,request.business_date,request.source,request.status,request.stock_before_quantity,request.requested_stock_quantity,request.quantity_delta,request.unit_cost_paise,request.value_paise,request.material,request.reason,request.evidence_reference,request.requested_by_user_id,request.reviewed_by_user_id,request.review_idempotency_key,request.review_note,request.adjustment_ledger_id,request.requested_at,request.reviewed_at,request.applied_at FROM inventory_adjustment_requests request JOIN inventory_items item ON item.id=request.inventory_item_id AND item.tenant_id=request.tenant_id AND item.branch_id=request.branch_id";

pub async fn adjustment_request_replay(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    idempotency_key: &str,
) -> Result<Option<InventoryAdjustmentRecord>, sqlx::Error> {
    sqlx::query_as(&format!("{ADJUSTMENT_SELECT} WHERE request.tenant_id=$1 AND request.branch_id=$2 AND request.idempotency_key=$3"))
        .bind(tenant_id).bind(branch_id).bind(idempotency_key)
        .fetch_optional(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_adjustment_request(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    business_date: NaiveDate,
    source: &str,
    status: &str,
    stock_before_quantity: i32,
    requested_stock_quantity: i32,
    quantity_delta: i32,
    unit_cost_paise: i64,
    value_paise: i64,
    material: bool,
    reason: &str,
    evidence_reference: &str,
    actor_user_id: &str,
    idempotency_key: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_adjustment_requests(tenant_id,branch_id,inventory_item_id,business_date,source,status,stock_before_quantity,requested_stock_quantity,quantity_delta,unit_cost_paise,value_paise,material,reason,evidence_reference,requested_by_user_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(inventory_item_id).bind(business_date).bind(source).bind(status)
        .bind(stock_before_quantity).bind(requested_stock_quantity).bind(quantity_delta).bind(unit_cost_paise)
        .bind(value_paise).bind(material).bind(reason).bind(evidence_reference).bind(actor_user_id).bind(idempotency_key)
        .fetch_one(&mut **tx).await
}

pub async fn adjustment_request_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<InventoryAdjustmentRecord>, sqlx::Error> {
    sqlx::query_as(&format!("{ADJUSTMENT_SELECT} WHERE request.tenant_id=$1 AND request.branch_id=$2 AND request.id=$3 FOR UPDATE OF request,item"))
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut **tx).await
}

pub async fn finish_adjustment_request(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    expected_status: &str,
    status: &str,
    reviewer: Option<&str>,
    review_note: &str,
    ledger_id: Option<&str>,
    review_idempotency_key: Option<&str>,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE inventory_adjustment_requests SET status=$5,reviewed_by_user_id=$6,review_note=$7,adjustment_ledger_id=$8,review_idempotency_key=$9,reviewed_at=CASE WHEN $6 IS NULL THEN reviewed_at ELSE NOW() END,applied_at=CASE WHEN $5='applied' THEN NOW() ELSE applied_at END WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status=$4")
        .bind(tenant_id).bind(branch_id).bind(id).bind(expected_status).bind(status).bind(reviewer).bind(review_note).bind(ledger_id).bind(review_idempotency_key)
        .execute(&mut **tx).await?.rows_affected()==1)
}

pub async fn add_adjustment_event(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
    event_type: &str,
    actor_user_id: &str,
    note: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO inventory_adjustment_events(tenant_id,branch_id,adjustment_request_id,event_type,actor_user_id,note) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(tenant_id).bind(branch_id).bind(request_id).bind(event_type).bind(actor_user_id).bind(note)
        .execute(&mut **tx).await?;
    Ok(())
}

pub async fn list_adjustment_requests(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
) -> Result<Vec<InventoryAdjustmentRecord>, sqlx::Error> {
    sqlx::query_as(&format!("{ADJUSTMENT_SELECT} WHERE request.tenant_id=$1 AND request.branch_id=$2 AND ($3='' OR request.inventory_item_id=$3) ORDER BY request.requested_at DESC,request.id DESC LIMIT 500"))
        .bind(tenant_id).bind(branch_id).bind(inventory_item_id).fetch_all(db).await
}

pub async fn list_backbar_usage(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    business_date: Option<NaiveDate>,
    staff_id: &str,
    client_id: &str,
    appointment_id: &str,
    limit: i64,
) -> Result<Vec<BackbarUsageRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH usage AS (
          SELECT usage.id, usage.inventory_item_id, item.name AS item_name, item.brand AS item_brand,
                 usage.client_id, usage.appointment_id,
                 COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', client.first_name, client.last_name)), ''), '') AS client_name,
                 usage.service_id, COALESCE(service.name, '') AS service_name,
                 usage.staff_id,
                 COALESCE(NULLIF(staff.appointment_display_name, ''),
                          NULLIF(BTRIM(CONCAT_WS(' ', staff.first_name, staff.last_name)), ''), '') AS staff_name,
                 'Manual'::TEXT AS source, usage.expected_quantity::BIGINT AS expected_quantity,
                 usage.actual_quantity::BIGINT AS actual_quantity, usage.wasted_quantity::BIGINT,
                 usage.selected_batch_id,
                 (usage.actual_quantity - usage.expected_quantity)::BIGINT AS variance_quantity,
                 usage.max_quantity::BIGINT, usage.wastage_percent,
                 usage.approval_threshold_percent, usage.unit, usage.status, usage.notes,
                 usage.review_note, usage.reviewed_at, usage.created_at
          FROM inventory_backbar_usage usage
          JOIN inventory_items item ON item.id=usage.inventory_item_id
            AND item.tenant_id=usage.tenant_id AND item.branch_id=usage.branch_id
          LEFT JOIN clients client ON client.id=usage.client_id
            AND client.tenant_id=usage.tenant_id AND client.branch_id=usage.branch_id
          LEFT JOIN services service ON service.id=usage.service_id
            AND service.tenant_id=usage.tenant_id AND service.branch_id=usage.branch_id
          LEFT JOIN staff ON staff.id=usage.staff_id
            AND staff.tenant_id=usage.tenant_id AND staff.branch_id=usage.branch_id
          WHERE usage.tenant_id=$1 AND usage.branch_id=$2
          UNION ALL
          SELECT ledger.id, ledger.inventory_item_id, item.name, item.brand,
                 NULLIF(sale.client_id, '') AS client_id, NULL::TEXT AS appointment_id,
                 COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', client.first_name, client.last_name)), ''), '') AS client_name,
                 NULLIF(line.item_id, ''), line.item_name,
                 NULLIF(line.staff_id, ''),
                 COALESCE(NULLIF(staff.appointment_display_name, ''),
                          NULLIF(BTRIM(CONCAT_WS(' ', staff.first_name, staff.last_name)), ''), '') AS staff_name,
                 sale.invoice_number, ABS(ledger.quantity_delta)::BIGINT, ABS(ledger.quantity_delta)::BIGINT,
                 0::BIGINT, NULL::TEXT, 0::BIGINT, 0::BIGINT, 0::DOUBLE PRECISION, 0::DOUBLE PRECISION,
                 item.unit, 'auto_consumed'::TEXT, ''::TEXT, ''::TEXT, NULL::TIMESTAMPTZ,
                 ledger.created_at
          FROM inventory_stock_ledger ledger
          JOIN inventory_items item ON item.id=ledger.inventory_item_id
            AND item.tenant_id=ledger.tenant_id AND item.branch_id=ledger.branch_id
          JOIN pos_sale_lines line ON line.id=ledger.sale_line_id AND line.line_type='service'
            AND line.tenant_id=ledger.tenant_id AND line.branch_id=ledger.branch_id
          JOIN pos_sales sale ON sale.id=ledger.sale_id
            AND sale.tenant_id=ledger.tenant_id AND sale.branch_id=ledger.branch_id
          LEFT JOIN clients client ON client.id=NULLIF(sale.client_id, '')
            AND client.tenant_id=ledger.tenant_id AND client.branch_id=ledger.branch_id
          LEFT JOIN staff ON staff.id=NULLIF(line.staff_id, '')
            AND staff.tenant_id=ledger.tenant_id AND staff.branch_id=ledger.branch_id
          WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2 AND ledger.movement_type='sale'
        )
        SELECT id, inventory_item_id, item_name, item_brand, client_id, appointment_id, client_name, service_id, service_name, staff_id, staff_name,
               source, expected_quantity, actual_quantity, wasted_quantity, selected_batch_id,
               variance_quantity, max_quantity,
               wastage_percent, approval_threshold_percent, unit, status, notes, review_note,
               reviewed_at, created_at
        FROM usage
        WHERE ($3::DATE IS NULL OR created_at::DATE=$3)
          AND ($4='' OR staff_id=$4)
          AND ($5='' OR client_id=$5)
          AND ($6='' OR appointment_id=$6)
        ORDER BY created_at DESC, id DESC
        LIMIT $7
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(business_date)
    .bind(staff_id)
    .bind(client_id)
    .bind(appointment_id)
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
        SELECT usage.id, usage.inventory_item_id, item.name AS item_name, item.brand AS item_brand,
               usage.client_id, usage.appointment_id,
               COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', client.first_name, client.last_name)), ''), '') AS client_name,
               usage.service_id, COALESCE(service.name, '') AS service_name,
               usage.staff_id,
               COALESCE(NULLIF(staff.appointment_display_name, ''),
                        NULLIF(BTRIM(CONCAT_WS(' ', staff.first_name, staff.last_name)), ''), '') AS staff_name,
               'Manual'::TEXT AS source, usage.expected_quantity::BIGINT AS expected_quantity,
               usage.actual_quantity::BIGINT AS actual_quantity, usage.wasted_quantity::BIGINT,
               usage.selected_batch_id,
               (usage.actual_quantity - usage.expected_quantity)::BIGINT AS variance_quantity,
               usage.max_quantity::BIGINT, usage.wastage_percent,
               usage.approval_threshold_percent, usage.unit, usage.status, usage.notes,
               usage.review_note, usage.reviewed_at, usage.created_at
        FROM inventory_backbar_usage usage
        JOIN inventory_items item ON item.id=usage.inventory_item_id
          AND item.tenant_id=usage.tenant_id AND item.branch_id=usage.branch_id
        LEFT JOIN clients client ON client.id=usage.client_id
          AND client.tenant_id=usage.tenant_id AND client.branch_id=usage.branch_id
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
    appointment_id: Option<&str>,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(snapshot.recipe_json,service.product_consumption_json)::TEXT FROM services service LEFT JOIN appointment_service_recipe_snapshots snapshot ON snapshot.tenant_id=service.tenant_id AND snapshot.branch_id=service.branch_id AND snapshot.service_id=service.id AND snapshot.appointment_id=$4 WHERE service.tenant_id=$1 AND service.branch_id=$2 AND service.id=$3 AND service.active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(service_id).bind(appointment_id).fetch_optional(&mut **tx).await
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
    service_id: Option<&str>,
    staff_id: Option<&str>,
) -> Result<bool, sqlx::Error> {
    if let Some(appointment_id) = appointment_id {
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND client_id=$4 AND ($5='' OR COALESCE(NULLIF(service_ids_json,''),'[]')::JSONB ? $5) AND ($6='' OR staff_id=$6))")
            .bind(tenant_id)
            .bind(branch_id)
            .bind(appointment_id)
            .bind(client_id)
            .bind(service_id.unwrap_or_default())
            .bind(staff_id.unwrap_or_default())
            .fetch_one(&mut **tx)
            .await
    } else {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)",
        )
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
    min_quantity: i32,
    expected_quantity: i32,
    actual_quantity: i32,
    wasted_quantity: i32,
    selected_batch_id: Option<&str>,
    max_quantity: i32,
    usage_profile: &str,
    waste_reason: &str,
    wastage_percent: f64,
    approval_threshold_percent: f64,
    status: &str,
    notes: &str,
    actor_user_id: &str,
    idempotency_key: &str,
    bowl_id: Option<&str>,
    bowl_line_no: i32,
    component_type: &str,
    container_id: Option<&str>,
    unit_cost_paise: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO inventory_backbar_usage (id,tenant_id,branch_id,inventory_item_id,service_id,staff_id,client_id,appointment_id,unit,min_quantity,expected_quantity,actual_quantity,wasted_quantity,selected_batch_id,max_quantity,usage_profile,waste_reason,wastage_percent,approval_threshold_percent,status,notes,actor_user_id,idempotency_key,bowl_id,bowl_line_no,component_type,container_id,unit_cost_paise) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)")
        .bind(id).bind(tenant_id).bind(branch_id).bind(inventory_item_id).bind(service_id).bind(staff_id)
        .bind(client_id).bind(appointment_id).bind(unit).bind(min_quantity).bind(expected_quantity).bind(actual_quantity).bind(wasted_quantity).bind(selected_batch_id).bind(max_quantity)
        .bind(usage_profile).bind(waste_reason).bind(wastage_percent).bind(approval_threshold_percent).bind(status).bind(notes).bind(actor_user_id).bind(idempotency_key)
        .bind(bowl_id).bind(bowl_line_no).bind(component_type).bind(container_id).bind(unit_cost_paise)
        .execute(&mut **tx).await?;
    Ok(())
}

pub async fn lock_backbar_usage_for_review(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<BackbarUsageForReview>, sqlx::Error> {
    sqlx::query_as("SELECT id,inventory_item_id,actual_quantity,selected_batch_id,actor_user_id,status,container_id,staff_id,unit_cost_paise FROM inventory_backbar_usage WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut **tx).await
}

pub async fn lock_open_backbar_container(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
) -> Result<Option<OpenBackbarContainer>, sqlx::Error> {
    sqlx::query_as("SELECT container.id,container.remaining_quantity,COALESCE(container.unit_cost_paise,item.unit_cost_paise) AS unit_cost_paise FROM inventory_backbar_containers container JOIN inventory_items item ON item.id=container.inventory_item_id AND item.tenant_id=container.tenant_id AND item.branch_id=container.branch_id WHERE container.tenant_id=$1 AND container.branch_id=$2 AND container.inventory_item_id=$3 AND container.status='open' FOR UPDATE OF container")
        .bind(tenant_id).bind(branch_id).bind(inventory_item_id).fetch_optional(&mut **tx).await
}

pub async fn has_backbar_containers(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM inventory_backbar_containers WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND status IN ('sealed','open'))")
        .bind(tenant_id).bind(branch_id).bind(inventory_item_id).fetch_one(&mut **tx).await
}

pub async fn consume_open_backbar_container(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    container_id: &str,
    quantity: i32,
    actor_user_id: &str,
    idempotency_key: &str,
    usage_id: &str,
) -> Result<i32, sqlx::Error> {
    let remaining = sqlx::query_scalar::<_, i32>("UPDATE inventory_backbar_containers SET remaining_quantity=remaining_quantity-$4,status=CASE WHEN remaining_quantity-$4=0 THEN 'empty' ELSE status END,closed_by=CASE WHEN remaining_quantity-$4=0 THEN $5 ELSE closed_by END,closed_at=CASE WHEN remaining_quantity-$4=0 THEN NOW() ELSE closed_at END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='open' AND remaining_quantity >= $4 RETURNING remaining_quantity")
        .bind(tenant_id).bind(branch_id).bind(container_id).bind(quantity).bind(actor_user_id).fetch_one(&mut **tx).await?;
    sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,quantity_delta,remaining_after,actor_user_id,idempotency_key,metadata) VALUES($1,$2,$3,'consumed',$4,$5,$6,$7,jsonb_build_object('backbarUsageId',$8))")
        .bind(tenant_id).bind(branch_id).bind(container_id).bind(-quantity).bind(remaining).bind(actor_user_id).bind(idempotency_key).bind(usage_id).execute(&mut **tx).await?;
    Ok(remaining)
}

pub async fn review_backbar_usage(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
    reviewed_by_user_id: &str,
    review_note: &str,
    unit_cost_paise: Option<i64>,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE inventory_backbar_usage SET status=$4,reviewed_by_user_id=$5,reviewed_at=NOW(),review_note=$6,unit_cost_paise=COALESCE($7,unit_cost_paise) WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending_approval'")
        .bind(tenant_id).bind(branch_id).bind(id).bind(status).bind(reviewed_by_user_id).bind(review_note).bind(unit_cost_paise)
        .execute(&mut **tx).await?.rows_affected() == 1)
}

pub async fn backbar_usage_by_id(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<BackbarUsageRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT usage.id,usage.inventory_item_id,item.name AS item_name,item.brand AS item_brand,usage.client_id,usage.appointment_id,
                  COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),'') AS client_name,usage.service_id,
                  COALESCE(service.name,'') AS service_name,usage.staff_id,
                  COALESCE(NULLIF(staff.appointment_display_name,''),NULLIF(BTRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),'') AS staff_name,
                  'Manual'::TEXT AS source,usage.expected_quantity::BIGINT,usage.actual_quantity::BIGINT,
                  usage.wasted_quantity::BIGINT,usage.selected_batch_id,
                  (usage.actual_quantity-usage.expected_quantity)::BIGINT AS variance_quantity,
                  usage.max_quantity::BIGINT,usage.wastage_percent,usage.approval_threshold_percent,
                  usage.unit,usage.status,usage.notes,usage.review_note,usage.reviewed_at,usage.created_at
           FROM inventory_backbar_usage usage
           JOIN inventory_items item ON item.id=usage.inventory_item_id AND item.tenant_id=usage.tenant_id AND item.branch_id=usage.branch_id
           LEFT JOIN clients client ON client.id=usage.client_id AND client.tenant_id=usage.tenant_id AND client.branch_id=usage.branch_id
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

pub async fn color_bowl_identity_by_key(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    idempotency_key: &str,
) -> Result<Option<(String, String)>, sqlx::Error> {
    sqlx::query_as("SELECT id,request_hash FROM inventory_color_bowls WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant_id).bind(branch_id).bind(idempotency_key).fetch_optional(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn insert_color_bowl(
    tx: &mut Transaction<'_, Postgres>,
    id: &str,
    tenant_id: &str,
    branch_id: &str,
    appointment_id: &str,
    client_id: &str,
    service_id: &str,
    staff_id: &str,
    notes: &str,
    actor_user_id: &str,
    idempotency_key: &str,
    request_hash: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO inventory_color_bowls(id,tenant_id,branch_id,appointment_id,client_id,service_id,staff_id,notes,actor_user_id,idempotency_key,request_hash,service_price_paise) SELECT $1,$2,$3,$4,$5,service.id,$7,$8,$9,$10,$11,service.price_paise FROM services service WHERE service.tenant_id=$2 AND service.branch_id=$3 AND service.id=$6 AND service.active=TRUE")
        .bind(id).bind(tenant_id).bind(branch_id).bind(appointment_id).bind(client_id).bind(service_id).bind(staff_id).bind(notes).bind(actor_user_id).bind(idempotency_key).bind(request_hash).execute(&mut **tx).await?;
    Ok(())
}

pub async fn color_bowl_by_id(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
          'id',bowl.id,'appointmentId',bowl.appointment_id,'clientId',bowl.client_id,
          'clientName',COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),''),
          'serviceId',bowl.service_id,'serviceName',service.name,'servicePricePaise',bowl.service_price_paise,'staffId',bowl.staff_id,
          'staffName',COALESCE(NULLIF(staff.appointment_display_name,''),NULLIF(BTRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),''),
          'notes',bowl.notes,'createdAt',bowl.created_at,
          'status',CASE WHEN EXISTS(SELECT 1 FROM inventory_backbar_usage u WHERE u.bowl_id=bowl.id AND u.status='pending_approval') THEN 'pending_approval'
                        WHEN EXISTS(SELECT 1 FROM inventory_backbar_usage u WHERE u.bowl_id=bowl.id AND u.status='rejected') THEN 'rejected' ELSE 'recorded' END,
          'expectedQuantity',COALESCE((SELECT SUM(u.expected_quantity) FROM inventory_backbar_usage u WHERE u.bowl_id=bowl.id),0),
          'actualQuantity',COALESCE((SELECT SUM(u.actual_quantity) FROM inventory_backbar_usage u WHERE u.bowl_id=bowl.id),0),
          'expectedCostPaise',COALESCE((SELECT SUM(u.expected_quantity::BIGINT*u.unit_cost_paise) FROM inventory_backbar_usage u WHERE u.bowl_id=bowl.id),0),
          'actualCostPaise',COALESCE((SELECT SUM(u.actual_quantity::BIGINT*u.unit_cost_paise) FROM inventory_backbar_usage u WHERE u.bowl_id=bowl.id),0),
          'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'usageId',u.id,'componentType',u.component_type,'inventoryItemId',u.inventory_item_id,
            'itemName',item.name,'itemBrand',item.brand,'usageProfile',u.usage_profile,
            'minQuantity',u.min_quantity,'expectedQuantity',u.expected_quantity,'maxQuantity',u.max_quantity,
            'actualQuantity',u.actual_quantity,'varianceQuantity',u.actual_quantity-u.expected_quantity,
            'unit',u.unit,'unitCostPaise',u.unit_cost_paise,'containerId',u.container_id,
            'status',u.status,'wasteReason',u.waste_reason,'notes',u.notes) ORDER BY u.bowl_line_no)
            FROM inventory_backbar_usage u JOIN inventory_items item ON item.id=u.inventory_item_id
              AND item.tenant_id=u.tenant_id AND item.branch_id=u.branch_id WHERE u.bowl_id=bowl.id),'[]'::JSONB)
        ) FROM inventory_color_bowls bowl
        JOIN clients client ON client.id=bowl.client_id AND client.tenant_id=bowl.tenant_id AND client.branch_id=bowl.branch_id
        JOIN services service ON service.id=bowl.service_id AND service.tenant_id=bowl.tenant_id AND service.branch_id=bowl.branch_id
        JOIN staff ON staff.id=bowl.staff_id AND staff.tenant_id=bowl.tenant_id AND staff.branch_id=bowl.branch_id
        WHERE bowl.tenant_id=$1 AND bowl.branch_id=$2 AND bowl.id=$3"#,
    )
    .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

pub async fn list_color_bowls(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    business_date: Option<NaiveDate>,
    client_id: &str,
    appointment_id: &str,
    limit: i64,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
          'id',bowl.id,'appointmentId',bowl.appointment_id,'clientId',bowl.client_id,
          'clientName',COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),''),
          'serviceId',bowl.service_id,'serviceName',service.name,'servicePricePaise',bowl.service_price_paise,'staffId',bowl.staff_id,
          'staffName',COALESCE(NULLIF(staff.appointment_display_name,''),NULLIF(BTRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),''),
          'notes',bowl.notes,'createdAt',bowl.created_at,
          'status',CASE WHEN EXISTS(SELECT 1 FROM inventory_backbar_usage u WHERE u.bowl_id=bowl.id AND u.status='pending_approval') THEN 'pending_approval'
                        WHEN EXISTS(SELECT 1 FROM inventory_backbar_usage u WHERE u.bowl_id=bowl.id AND u.status='rejected') THEN 'rejected' ELSE 'recorded' END,
          'expectedQuantity',COALESCE((SELECT SUM(u.expected_quantity) FROM inventory_backbar_usage u WHERE u.bowl_id=bowl.id),0),
          'actualQuantity',COALESCE((SELECT SUM(u.actual_quantity) FROM inventory_backbar_usage u WHERE u.bowl_id=bowl.id),0),
          'expectedCostPaise',COALESCE((SELECT SUM(u.expected_quantity::BIGINT*u.unit_cost_paise) FROM inventory_backbar_usage u WHERE u.bowl_id=bowl.id),0),
          'actualCostPaise',COALESCE((SELECT SUM(u.actual_quantity::BIGINT*u.unit_cost_paise) FROM inventory_backbar_usage u WHERE u.bowl_id=bowl.id),0),
          'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'usageId',u.id,'componentType',u.component_type,'inventoryItemId',u.inventory_item_id,
            'itemName',item.name,'itemBrand',item.brand,'usageProfile',u.usage_profile,
            'minQuantity',u.min_quantity,'expectedQuantity',u.expected_quantity,'maxQuantity',u.max_quantity,
            'actualQuantity',u.actual_quantity,'varianceQuantity',u.actual_quantity-u.expected_quantity,
            'unit',u.unit,'unitCostPaise',u.unit_cost_paise,'containerId',u.container_id,
            'status',u.status,'wasteReason',u.waste_reason,'notes',u.notes) ORDER BY u.bowl_line_no)
            FROM inventory_backbar_usage u JOIN inventory_items item ON item.id=u.inventory_item_id
              AND item.tenant_id=u.tenant_id AND item.branch_id=u.branch_id WHERE u.bowl_id=bowl.id),'[]'::JSONB)
        ) FROM inventory_color_bowls bowl
        JOIN clients client ON client.id=bowl.client_id AND client.tenant_id=bowl.tenant_id AND client.branch_id=bowl.branch_id
        JOIN services service ON service.id=bowl.service_id AND service.tenant_id=bowl.tenant_id AND service.branch_id=bowl.branch_id
        JOIN staff ON staff.id=bowl.staff_id AND staff.tenant_id=bowl.tenant_id AND staff.branch_id=bowl.branch_id
        WHERE bowl.tenant_id=$1 AND bowl.branch_id=$2
          AND ($3::DATE IS NULL OR (bowl.created_at AT TIME ZONE 'Asia/Kolkata')::DATE=$3)
          AND ($4='' OR bowl.client_id=$4) AND ($5='' OR bowl.appointment_id=$5)
        ORDER BY bowl.created_at DESC,bowl.id DESC LIMIT $6"#,
    )
    .bind(tenant_id).bind(branch_id).bind(business_date).bind(client_id).bind(appointment_id).bind(limit).fetch_all(db).await
}

pub async fn client_formula_recommendation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    service_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar::<_, Value>(
        r#"WITH latest AS (
          SELECT bowl.id,bowl.created_at
          FROM inventory_color_bowls bowl
          WHERE bowl.tenant_id=$1 AND bowl.branch_id=$2 AND bowl.client_id=$3 AND bowl.service_id=$4
            AND EXISTS (SELECT 1 FROM inventory_backbar_usage usage WHERE usage.bowl_id=bowl.id AND usage.status='recorded')
            AND NOT EXISTS (SELECT 1 FROM inventory_backbar_usage usage WHERE usage.bowl_id=bowl.id AND usage.status<>'recorded')
          ORDER BY bowl.created_at DESC,bowl.id DESC LIMIT 1
        ) SELECT jsonb_build_object(
          'sourceBowlId',latest.id,'usedAt',latest.created_at,
          'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'componentType',usage.component_type,'inventoryItemId',usage.inventory_item_id,
            'itemName',item.name,'itemBrand',item.brand,'suggestedQuantity',usage.actual_quantity,
            'unit',usage.unit,'usageProfile',usage.usage_profile) ORDER BY usage.bowl_line_no)
            FROM inventory_backbar_usage usage
            JOIN inventory_items item ON item.id=usage.inventory_item_id AND item.tenant_id=usage.tenant_id AND item.branch_id=usage.branch_id AND item.active=TRUE
            WHERE usage.bowl_id=latest.id AND usage.status='recorded'),'[]'::JSONB)
        ) FROM latest"#,
    )
    .bind(tenant_id).bind(branch_id).bind(client_id).bind(service_id).fetch_optional(db).await
}

pub async fn color_service_margins(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"WITH bowl_cost AS (
          SELECT bowl.id,bowl.service_id,bowl.service_price_paise,
            SUM(usage.expected_quantity::BIGINT*usage.unit_cost_paise)::BIGINT expected_cost_paise,
            SUM(usage.actual_quantity::BIGINT*usage.unit_cost_paise)::BIGINT actual_cost_paise
          FROM inventory_color_bowls bowl
          JOIN inventory_backbar_usage usage ON usage.bowl_id=bowl.id AND usage.tenant_id=bowl.tenant_id AND usage.branch_id=bowl.branch_id
          WHERE bowl.tenant_id=$1 AND bowl.branch_id=$2
            AND (bowl.created_at AT TIME ZONE 'Asia/Kolkata')::DATE=$3
            AND NOT EXISTS (SELECT 1 FROM inventory_backbar_usage blocked WHERE blocked.bowl_id=bowl.id AND blocked.status<>'recorded')
          GROUP BY bowl.id,bowl.service_id,bowl.service_price_paise
        ) SELECT jsonb_build_object(
          'date',$3::DATE,'serviceId',cost.service_id,'serviceName',service.name,
          'bowlCount',COUNT(*)::BIGINT,'pricedBowlCount',COUNT(cost.service_price_paise)::BIGINT,
          'revenuePaise',COALESCE(SUM(cost.service_price_paise),0)::BIGINT,
          'expectedCostPaise',COALESCE(SUM(cost.expected_cost_paise),0)::BIGINT,
          'actualCostPaise',COALESCE(SUM(cost.actual_cost_paise),0)::BIGINT,
          'marginPaise',CASE WHEN COUNT(cost.service_price_paise)=COUNT(*) THEN SUM(cost.service_price_paise)-SUM(cost.actual_cost_paise) ELSE NULL END,
          'marginBps',CASE WHEN COUNT(cost.service_price_paise)=COUNT(*) AND SUM(cost.service_price_paise)>0
            THEN ((SUM(cost.service_price_paise)-SUM(cost.actual_cost_paise))*10000/SUM(cost.service_price_paise))::BIGINT ELSE NULL END)
        FROM bowl_cost cost
        JOIN services service ON service.id=cost.service_id AND service.tenant_id=$1 AND service.branch_id=$2
        GROUP BY cost.service_id,service.name
        ORDER BY SUM(cost.actual_cost_paise) DESC,service.name"#,
    )
    .bind(tenant_id).bind(branch_id).bind(business_date).fetch_all(db).await
}

pub async fn daily_color_variance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
          'date',$3::DATE,'inventoryItemId',usage.inventory_item_id,'itemName',item.name,'itemBrand',item.brand,
          'unit',usage.unit,'expectedQuantity',SUM(usage.expected_quantity)::BIGINT,
          'actualQuantity',SUM(usage.actual_quantity)::BIGINT,
          'varianceQuantity',SUM(usage.actual_quantity-usage.expected_quantity)::BIGINT,
          'expectedCostPaise',SUM(usage.expected_quantity::BIGINT*usage.unit_cost_paise)::BIGINT,
          'actualCostPaise',SUM(usage.actual_quantity::BIGINT*usage.unit_cost_paise)::BIGINT,
          'varianceCostPaise',SUM((usage.actual_quantity-usage.expected_quantity)::BIGINT*usage.unit_cost_paise)::BIGINT,
          'bowlCount',COUNT(DISTINCT usage.bowl_id)::BIGINT)
        FROM inventory_backbar_usage usage
        JOIN inventory_items item ON item.id=usage.inventory_item_id AND item.tenant_id=usage.tenant_id AND item.branch_id=usage.branch_id
        WHERE usage.tenant_id=$1 AND usage.branch_id=$2 AND usage.bowl_id IS NOT NULL
          AND (usage.created_at AT TIME ZONE 'Asia/Kolkata')::DATE=$3
        GROUP BY usage.inventory_item_id,item.name,item.brand,usage.unit
        ORDER BY ABS(SUM((usage.actual_quantity-usage.expected_quantity)::BIGINT*usage.unit_cost_paise)) DESC,item.name"#,
    )
    .bind(tenant_id).bind(branch_id).bind(business_date).fetch_all(db).await
}

pub async fn color_staff_shift_dashboard(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
          'date',$3::DATE,'staffId',staff.id,
          'staffName',COALESCE(NULLIF(staff.appointment_display_name,''),NULLIF(BTRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),staff.id),
          'shiftStatus',COALESCE(schedule.status,'not_set'),
          'shift1Start',CASE WHEN schedule.shift1_start IS NULL THEN NULL ELSE TO_CHAR(schedule.shift1_start,'HH24:MI') END,
          'shift1End',CASE WHEN schedule.shift1_end IS NULL THEN NULL ELSE TO_CHAR(schedule.shift1_end,'HH24:MI') END,
          'shift2Start',CASE WHEN schedule.shift2_start IS NULL THEN NULL ELSE TO_CHAR(schedule.shift2_start,'HH24:MI') END,
          'shift2End',CASE WHEN schedule.shift2_end IS NULL THEN NULL ELSE TO_CHAR(schedule.shift2_end,'HH24:MI') END,
          'attendanceStatus',COALESCE(attendance.status,''),'clockInAt',attendance.clock_in_at,'clockOutAt',attendance.clock_out_at,
          'unit',COALESCE(metrics.unit,''),'bowlCount',COALESCE(metrics.bowl_count,0),
          'clientCount',COALESCE(metrics.client_count,0),'rootTouchUpCount',COALESCE(metrics.root_touch_up_count,0),
          'fullColourCount',COALESCE(metrics.full_colour_count,0),'expectedQuantity',COALESCE(metrics.expected_quantity,0),
          'actualQuantity',COALESCE(metrics.actual_quantity,0),'varianceQuantity',COALESCE(metrics.variance_quantity,0),
          'varianceCostPaise',COALESCE(metrics.variance_cost_paise,0),'excessLineCount',COALESCE(metrics.excess_line_count,0),
          'wasteLineCount',COALESCE(metrics.waste_line_count,0),'pendingApprovalCount',COALESCE(metrics.pending_approval_count,0))
        FROM staff
        LEFT JOIN staff_schedules schedule ON schedule.tenant_id=$1 AND schedule.branch_id=$2 AND schedule.staff_id=staff.id AND schedule.schedule_date=$3
        LEFT JOIN staff_attendance_records attendance ON attendance.tenant_id=$1 AND attendance.branch_id=$2 AND attendance.staff_id=staff.id AND attendance.business_date=$3
        LEFT JOIN LATERAL (
          SELECT CASE WHEN COUNT(*)=0 THEN '' WHEN COUNT(DISTINCT usage.unit)=1 THEN MIN(usage.unit) ELSE 'mixed' END unit,
            COUNT(DISTINCT usage.bowl_id)::BIGINT bowl_count,COUNT(DISTINCT usage.client_id)::BIGINT client_count,
            COUNT(DISTINCT usage.bowl_id) FILTER (WHERE usage.usage_profile='root_touch_up')::BIGINT root_touch_up_count,
            COUNT(DISTINCT usage.bowl_id) FILTER (WHERE usage.usage_profile='full_colour')::BIGINT full_colour_count,
            COALESCE(SUM(usage.expected_quantity),0)::BIGINT expected_quantity,
            COALESCE(SUM(usage.actual_quantity),0)::BIGINT actual_quantity,
            COALESCE(SUM(usage.actual_quantity-usage.expected_quantity),0)::BIGINT variance_quantity,
            COALESCE(SUM((usage.actual_quantity-usage.expected_quantity)::BIGINT*usage.unit_cost_paise),0)::BIGINT variance_cost_paise,
            COUNT(*) FILTER (WHERE usage.max_quantity>0 AND usage.actual_quantity>usage.max_quantity)::BIGINT excess_line_count,
            COUNT(*) FILTER (WHERE usage.waste_reason<>'')::BIGINT waste_line_count,
            COUNT(*) FILTER (WHERE usage.status='pending_approval')::BIGINT pending_approval_count
          FROM inventory_backbar_usage usage WHERE usage.tenant_id=$1 AND usage.branch_id=$2 AND usage.staff_id=staff.id
            AND usage.bowl_id IS NOT NULL AND (usage.created_at AT TIME ZONE 'Asia/Kolkata')::DATE=$3
        ) metrics ON TRUE
        WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.active=TRUE
        ORDER BY COALESCE(metrics.variance_cost_paise,0) DESC,staff.first_name,staff.last_name,staff.id"#,
    )
    .bind(tenant_id).bind(branch_id).bind(business_date).fetch_all(db).await
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

pub async fn is_kit_component(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM inventory_kit_components WHERE tenant_id=$1 AND branch_id=$2 AND component_inventory_item_id=$3)")
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

pub async fn kit_operation_by_key(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    idempotency_key: &str,
) -> Result<Option<InventoryKitOperationRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,kit_inventory_item_id,operation_type,quantity,comments,actor_user_id,source_receipt_id,source_receipt_line_id,unit_cost_paise,stock_after_quantity,created_at FROM inventory_kit_assemblies WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant_id).bind(branch_id).bind(idempotency_key).fetch_optional(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_kit_operation(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
    operation_type: &str,
    quantity: i32,
    idempotency_key: &str,
    actor_user_id: &str,
    comments: &str,
    source_receipt_id: Option<&str>,
    source_receipt_line_id: Option<&str>,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_kit_assemblies (tenant_id,branch_id,kit_inventory_item_id,operation_type,quantity,idempotency_key,actor_user_id,comments,source_receipt_id,source_receipt_line_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(kit_inventory_item_id).bind(operation_type).bind(quantity).bind(idempotency_key).bind(actor_user_id).bind(comments).bind(source_receipt_id).bind(source_receipt_line_id)
        .fetch_one(&mut **tx).await
}

pub async fn finish_kit_operation(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    unit_cost_paise: i64,
    stock_after_quantity: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_kit_assemblies SET unit_cost_paise=$4,stock_after_quantity=$5 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).bind(unit_cost_paise).bind(stock_after_quantity)
        .execute(&mut **tx).await?;
    Ok(())
}

pub async fn kit_history(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
) -> Result<Vec<InventoryKitOperationRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,kit_inventory_item_id,operation_type,quantity,comments,actor_user_id,source_receipt_id,source_receipt_line_id,unit_cost_paise,stock_after_quantity,created_at FROM inventory_kit_assemblies WHERE tenant_id=$1 AND branch_id=$2 AND kit_inventory_item_id=$3 ORDER BY created_at DESC,id DESC LIMIT 100")
        .bind(tenant_id).bind(branch_id).bind(kit_inventory_item_id).fetch_all(db).await
}

pub async fn kit_auto_unbundle(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE((SELECT auto_unbundle_on_receive FROM inventory_kit_settings WHERE tenant_id=$1 AND branch_id=$2 AND kit_inventory_item_id=$3),FALSE)")
        .bind(tenant_id).bind(branch_id).bind(kit_inventory_item_id).fetch_one(&mut **tx).await
}

pub async fn kit_auto_unbundle_value(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE((SELECT auto_unbundle_on_receive FROM inventory_kit_settings WHERE tenant_id=$1 AND branch_id=$2 AND kit_inventory_item_id=$3),FALSE)")
        .bind(tenant_id).bind(branch_id).bind(kit_inventory_item_id).fetch_one(db).await
}

pub async fn save_kit_auto_unbundle(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
    enabled: bool,
    actor_user_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO inventory_kit_settings(tenant_id,branch_id,kit_inventory_item_id,auto_unbundle_on_receive,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,branch_id,kit_inventory_item_id) DO UPDATE SET auto_unbundle_on_receive=EXCLUDED.auto_unbundle_on_receive,updated_by=EXCLUDED.updated_by,updated_at=NOW()")
        .bind(tenant_id).bind(branch_id).bind(kit_inventory_item_id).bind(enabled).bind(actor_user_id)
        .execute(&mut **tx).await?;
    Ok(())
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

pub async fn discontinue(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    replacement_id: Option<&str>,
    reason: &str,
    actor: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let stock = sqlx::query_scalar::<_, i32>("SELECT stock_quantity FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_one(&mut *tx).await?;
    if stock != 0 {
        return Err(sqlx::Error::Protocol(
            "product stock must be zero before discontinuation".into(),
        ));
    }
    let blocked = sqlx::query_scalar::<_, bool>(r#"SELECT
      EXISTS(SELECT 1 FROM purchase_order_lines line JOIN purchase_orders po ON po.id=line.purchase_order_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.inventory_item_id=$3 AND po.status IN ('draft','pending_approval','approved','partially_received'))
      OR EXISTS(SELECT 1 FROM inventory_transfer_lines line JOIN inventory_transfers transfer ON transfer.id=line.transfer_id WHERE line.tenant_id=$1 AND (line.source_inventory_item_id=$3 OR line.destination_inventory_item_id=$3) AND transfer.status='in_transit')
      OR EXISTS(SELECT 1 FROM inventory_batches batch WHERE batch.tenant_id=$1 AND batch.branch_id=$2 AND batch.inventory_item_id=$3 AND batch.quantity>0)
      OR EXISTS(SELECT 1 FROM inventory_backbar_containers container WHERE container.tenant_id=$1 AND container.branch_id=$2 AND container.inventory_item_id=$3 AND container.remaining_quantity>0)"#)
        .bind(tenant_id).bind(branch_id).bind(id).fetch_one(&mut *tx).await?;
    if blocked {
        return Err(sqlx::Error::Protocol(
            "product has an open purchase order, in-transit transfer, batch balance, or container balance".into(),
        ));
    }
    if let Some(replacement) = replacement_id {
        let valid = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE)")
            .bind(tenant_id).bind(branch_id).bind(replacement).fetch_one(&mut *tx).await?;
        if !valid || replacement == id {
            return Err(sqlx::Error::Protocol(
                "replacement product is invalid".into(),
            ));
        }
    }
    sqlx::query("UPDATE inventory_items SET active=FALSE,center_available=FALSE,online_sale_enabled=FALSE,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).execute(&mut *tx).await?;
    let event = sqlx::query_scalar::<_, Value>("INSERT INTO inventory_product_lifecycle_events(tenant_id,branch_id,inventory_item_id,event_type,replacement_inventory_item_id,reason,actor_user_id) VALUES($1,$2,$3,'discontinued',$4,$5,$6) RETURNING jsonb_build_object('id',id,'eventType',event_type,'replacementInventoryItemId',replacement_inventory_item_id,'reason',reason,'actorUserId',actor_user_id,'createdAt',created_at)")
        .bind(tenant_id).bind(branch_id).bind(id).bind(replacement_id).bind(reason).bind(actor).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(event)
}

pub async fn reactivate(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    reason: &str,
    actor: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let changed = sqlx::query("UPDATE inventory_items SET active=TRUE,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=FALSE")
        .bind(tenant_id).bind(branch_id).bind(id).execute(&mut *tx).await?.rows_affected();
    if changed != 1 {
        return Err(sqlx::Error::RowNotFound);
    }
    let event = sqlx::query_scalar::<_, Value>("INSERT INTO inventory_product_lifecycle_events(tenant_id,branch_id,inventory_item_id,event_type,reason,actor_user_id) VALUES($1,$2,$3,'reactivated',$4,$5) RETURNING jsonb_build_object('id',id,'eventType',event_type,'replacementInventoryItemId',replacement_inventory_item_id,'reason',reason,'actorUserId',actor_user_id,'createdAt',created_at)")
        .bind(tenant_id).bind(branch_id).bind(id).bind(reason).bind(actor).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(event)
}

pub async fn lifecycle_events(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',event.id,'eventType',event.event_type,'replacementInventoryItemId',event.replacement_inventory_item_id,'replacementProductName',replacement.name,'reason',event.reason,'actorUserId',event.actor_user_id,'createdAt',event.created_at) FROM inventory_product_lifecycle_events event LEFT JOIN inventory_items replacement ON replacement.id=event.replacement_inventory_item_id WHERE event.tenant_id=$1 AND event.branch_id=$2 AND event.inventory_item_id=$3 ORDER BY event.created_at DESC")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_all(db).await
}

fn select_sql(where_clause: &str) -> String {
    format!(
        r#"
        SELECT
          item.id,item.tenant_id,item.branch_id,item.sku,item.name,item.category,item.subcategory,item.brand,
          item.product_usage,item.unit,item.package_unit,item.units_per_package,item.stock_quantity,
          item.reorder_point,item.alert_level,item.desired_level,item.order_level,item.safety_stock_level,
          item.unit_cost_paise,item.retail_price_paise,item.hsn_code,item.gst_percent,item.barcode,
          COALESCE((SELECT ARRAY_AGG(entry.barcode ORDER BY entry.is_primary DESC,entry.created_at,entry.id)
            FROM inventory_item_barcodes entry WHERE entry.tenant_id=item.tenant_id
              AND entry.branch_id=item.branch_id AND entry.inventory_item_id=item.id AND entry.active),ARRAY[]::TEXT[]) AS barcodes,
          item.batch_tracked,item.dual_use_stock,item.center_available,item.online_sale_enabled,item.active,item.created_at,item.updated_at
        FROM inventory_items item
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
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        WITH reference_item AS (
          SELECT sku FROM inventory_items
          WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
        ), matching_items AS (
          SELECT item.*
          FROM inventory_items item
          JOIN reference_item reference ON reference.sku=item.sku
          WHERE item.tenant_id=$1 AND item.branch_id=$2
        )
        SELECT jsonb_build_object(
          'branchStocks', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'branchId',item.branch_id,'branchName',COALESCE(branch.name,item.branch_id),
              'inventoryItemId',item.id,'stockQuantity',item.stock_quantity,
              'reorderPoint',item.reorder_point,'unitCostPaise',item.unit_cost_paise,
              'stockValuePaise',item.stock_quantity::BIGINT*item.unit_cost_paise
            ) ORDER BY COALESCE(branch.name,item.branch_id))
            FROM matching_items item
            LEFT JOIN branches branch ON branch.id::TEXT=item.branch_id AND branch.tenant_id::TEXT=$1
          ),'[]'::JSONB),
          'expiryTimeline', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'branchId',item.branch_id,'branchName',COALESCE(branch.name,item.branch_id),
              'batchNumber',batch.batch_number,'expiryDate',batch.expiry_date,
              'receivedDate',batch.received_date,'quantity',batch.quantity,
              'unitCostPaise',batch.unit_cost_paise
            ) ORDER BY batch.expiry_date NULLS LAST,batch.received_date,batch.id)
            FROM matching_items item
            JOIN inventory_batches batch ON batch.tenant_id=item.tenant_id
              AND batch.branch_id=item.branch_id AND batch.inventory_item_id=item.id
            LEFT JOIN branches branch ON branch.id::TEXT=item.branch_id AND branch.tenant_id::TEXT=$1
            WHERE batch.quantity>0
          ),'[]'::JSONB),
          'clientUsage', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'clientId',usage.client_id,'clientName',usage.client_name,
              'quantity',usage.quantity,'visits',usage.visits,'lastUsedAt',usage.last_used_at
            ) ORDER BY usage.last_used_at DESC)
            FROM (
              SELECT ledger.client_id,
                     BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)) AS client_name,
                     SUM(ABS(ledger.quantity_delta))::BIGINT AS quantity,
                     COUNT(DISTINCT COALESCE(ledger.appointment_id,ledger.source_id,ledger.id))::BIGINT AS visits,
                     MAX(ledger.created_at) AS last_used_at
              FROM inventory_digital_twin_ledger ledger
              JOIN matching_items item ON item.id=ledger.inventory_item_id
                AND item.branch_id=ledger.branch_id
              LEFT JOIN clients client ON client.tenant_id=ledger.tenant_id AND client.id=ledger.client_id
              WHERE ledger.client_id IS NOT NULL AND ledger.quantity_delta<0
              GROUP BY ledger.client_id,client.first_name,client.last_name
            ) usage
          ),'[]'::JSONB),
          'entityLedger', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id',ledger.id,'branchId',ledger.branch_id,
              'branchName',COALESCE(branch.name,ledger.branch_id),
              'movementType',ledger.movement_type,'quantityDelta',ledger.quantity_delta,
              'unitCostPaise',ledger.unit_cost_paise,
              'stockBeforeQuantity',ledger.stock_before_quantity,
              'stockAfterQuantity',ledger.stock_after_quantity,
              'recordedStockAfterQuantity',ledger.recorded_stock_after_quantity,
              'source',ledger.source_label,'sourceType',ledger.source_type,
              'sourceId',ledger.source_id,'actorUserId',ledger.actor_user_id,
              'clientId',ledger.client_id,'appointmentId',ledger.appointment_id,
              'serviceId',ledger.service_id,'staffId',ledger.staff_id,
              'backbarContainerId',ledger.backbar_container_id,
              'batchAllocations',COALESCE(ledger.batch_allocations,'[]'::JSONB),
              'provenanceComplete',ledger.provenance_complete,
              'snapshotStatus',ledger.snapshot_status,'createdAt',ledger.created_at
            ) ORDER BY ledger.created_at DESC,ledger.id DESC)
            FROM inventory_digital_twin_ledger ledger
            JOIN matching_items item ON item.id=ledger.inventory_item_id
              AND item.branch_id=ledger.branch_id
            LEFT JOIN branches branch ON branch.id::TEXT=ledger.branch_id AND branch.tenant_id::TEXT=$1
          ),'[]'::JSONB),
          'margin', COALESCE((
            SELECT jsonb_build_object(
              'revenuePaise',COALESCE(SUM(line.line_total_paise),0)::BIGINT,
              'costPaise',COALESCE(SUM(ABS(ledger.quantity_delta)::BIGINT*ledger.unit_cost_paise),0)::BIGINT,
              'marginPaise',(COALESCE(SUM(line.line_total_paise),0)
                -COALESCE(SUM(ABS(ledger.quantity_delta)::BIGINT*ledger.unit_cost_paise),0))::BIGINT
            )
            FROM matching_items item
            JOIN pos_sale_lines line ON line.tenant_id=item.tenant_id
              AND line.branch_id=item.branch_id AND line.item_id=item.id AND line.line_type='product'
            JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id
              AND sale.branch_id=line.branch_id AND sale.status NOT IN ('void','voided','cancelled')
            LEFT JOIN inventory_stock_ledger ledger ON ledger.tenant_id=line.tenant_id
              AND ledger.branch_id=line.branch_id AND ledger.sale_line_id=line.id
              AND ledger.inventory_item_id=item.id AND ledger.movement_type='sale'
          ),jsonb_build_object('revenuePaise',0,'costPaise',0,'marginPaise',0))
        )
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_one(db)
    .await
}

pub async fn service_recipe_versions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
             'id',id,'serviceId',service_id,'versionNumber',version_number,
             'recipe',recipe_json,'changedBy',changed_by,
             'changeSource',change_source,'createdAt',created_at)
           FROM service_recipe_versions
           WHERE tenant_id=$1 AND branch_id=$2 AND service_id=$3
           ORDER BY version_number DESC"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .fetch_all(db)
    .await
}

pub async fn command_center_metrics(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<InventoryCommandCenterMetrics, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT
          (SELECT COUNT(*) FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND active AND stock_quantity<=0)::BIGINT AS stockout_risk,
          (SELECT COUNT(*) FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND active AND reorder_point>0 AND stock_quantity>reorder_point*3)::BIGINT AS overstock_risk,
          (SELECT COUNT(*) FROM purchase_orders WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('draft','pending_approval','approved','partially_received'))::BIGINT AS open_purchase_orders,
          (SELECT COALESCE(SUM(line.quantity),0) FROM inventory_transfers transfer JOIN inventory_transfer_lines line ON line.tenant_id=transfer.tenant_id AND line.transfer_id=transfer.id WHERE transfer.tenant_id=$1 AND transfer.destination_branch_id=$2 AND transfer.status='in_transit')::BIGINT AS in_transit_stock,
          (SELECT COALESCE(SUM(expected_quantity),0) FROM inventory_backbar_usage WHERE tenant_id=$1 AND branch_id=$2 AND created_at>=NOW()-INTERVAL '30 days')::BIGINT AS consumption_expected_quantity,
          (SELECT COALESCE(SUM(actual_quantity),0) FROM inventory_backbar_usage WHERE tenant_id=$1 AND branch_id=$2 AND created_at>=NOW()-INTERVAL '30 days')::BIGINT AS consumption_actual_quantity,
          (SELECT COUNT(*) FROM stock_count_sessions WHERE tenant_id=$1 AND branch_id=$2 AND status NOT IN ('posted','cancelled','rejected'))::BIGINT AS open_stock_audits,
          (SELECT COUNT(*) FROM inventory_digital_twin_ledger WHERE tenant_id=$1 AND branch_id=$2 AND (NOT provenance_complete OR snapshot_status='mismatch'))::BIGINT AS ledger_trust_exceptions,
          ((SELECT COUNT(*) FROM purchase_orders WHERE tenant_id=$1 AND branch_id=$2 AND status='pending_approval')+
           (SELECT COUNT(*) FROM stock_count_sessions WHERE tenant_id=$1 AND branch_id=$2 AND status='pending_approval')+
           (SELECT COUNT(*) FROM inventory_backbar_usage WHERE tenant_id=$1 AND branch_id=$2 AND status='pending_approval')+
           (SELECT COUNT(*) FROM inventory_negative_stock_requests WHERE tenant_id=$1 AND branch_id=$2 AND status='pending')+
           (SELECT COUNT(*) FROM inventory_automation_actions WHERE tenant_id=$1 AND branch_id=$2 AND status='pending_approval'))::BIGINT AS pending_approvals,
          (SELECT COUNT(DISTINCT supplier.id) FROM suppliers supplier JOIN purchase_orders po ON po.tenant_id=supplier.tenant_id AND po.branch_id=supplier.branch_id AND po.supplier_id=supplier.id WHERE supplier.tenant_id=$1 AND supplier.branch_id=$2 AND supplier.active AND po.status IN ('approved','partially_received') AND po.expected_date<CURRENT_DATE)::BIGINT AS supplier_risk"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(db)
    .await
}

pub async fn transfer_opportunities(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: i64,
) -> Result<Vec<InventoryTransferOpportunity>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH usage AS (
          SELECT branch_id,inventory_item_id,
                 ABS(COALESCE(SUM(quantity_delta) FILTER (WHERE quantity_delta<0),0))::DOUBLE PRECISION/60.0 AS daily_usage
          FROM inventory_stock_ledger
          WHERE tenant_id=$1 AND created_at>=NOW()-INTERVAL '60 days'
          GROUP BY branch_id,inventory_item_id
        ), candidates AS (
          SELECT
            source.branch_id AS source_branch_id,
            COALESCE(source_branch.name,source.branch_id) AS source_branch_name,
            destination.branch_id AS destination_branch_id,
            COALESCE(destination_branch.name,destination.branch_id) AS destination_branch_name,
            source.id AS source_inventory_item_id,
            destination.id AS destination_inventory_item_id,
            destination.name AS product_name,destination.sku,destination.category,
            source.stock_quantity AS source_stock_quantity,
            destination.stock_quantity AS destination_stock_quantity,
            COALESCE(source_usage.daily_usage,0)::DOUBLE PRECISION AS source_daily_usage,
            COALESCE(destination_usage.daily_usage,0)::DOUBLE PRECISION AS destination_daily_usage,
            source.reorder_point AS source_reorder_point,
            destination.reorder_point AS destination_reorder_point,
            source.unit_cost_paise AS transfer_unit_cost_paise,
            COALESCE(price.unit_cost_paise,NULLIF(destination.unit_cost_paise,0)) AS purchase_unit_cost_paise,
            policy.transfer_base_transport_cost_paise,
            policy.transfer_cost_per_km_paise,
            policy.transfer_handling_cost_per_unit_paise,
            policy.transfer_delay_cost_per_unit_day_paise,
            policy.transfer_expected_days,
            CASE WHEN source_branch.latitude IS NULL OR source_branch.longitude IS NULL
                   OR destination_branch.latitude IS NULL OR destination_branch.longitude IS NULL THEN NULL
              ELSE 6371.0*2.0*ASIN(SQRT(LEAST(1.0,GREATEST(0.0,
                POWER(SIN(RADIANS(destination_branch.latitude-source_branch.latitude)/2.0),2)
                +COS(RADIANS(source_branch.latitude))*COS(RADIANS(destination_branch.latitude))
                 *POWER(SIN(RADIANS(destination_branch.longitude-source_branch.longitude)/2.0),2)
              )))) END AS distance_km,
            batch.id AS earliest_batch_id,batch.batch_number AS earliest_batch_number,
            batch.expiry_date AS earliest_expiry_date,batch.quantity AS earliest_batch_quantity
          FROM inventory_items destination
          JOIN inventory_items source ON source.tenant_id=destination.tenant_id
            AND source.sku=destination.sku AND source.branch_id<>destination.branch_id
            AND source.active AND source.stock_quantity>0
          LEFT JOIN usage source_usage ON source_usage.branch_id=source.branch_id AND source_usage.inventory_item_id=source.id
          LEFT JOIN usage destination_usage ON destination_usage.branch_id=destination.branch_id AND destination_usage.inventory_item_id=destination.id
          LEFT JOIN inventory_policies policy ON policy.tenant_id=destination.tenant_id AND policy.branch_id=destination.branch_id
          LEFT JOIN branches source_branch ON source_branch.id::TEXT=source.branch_id AND source_branch.tenant_id::TEXT=$1
          LEFT JOIN branches destination_branch ON destination_branch.id::TEXT=destination.branch_id AND destination_branch.tenant_id::TEXT=$1
          LEFT JOIN LATERAL (
            SELECT MIN(list.unit_cost_paise)::BIGINT AS unit_cost_paise
            FROM supplier_price_lists list
            JOIN suppliers supplier ON supplier.id=list.supplier_id AND supplier.tenant_id=list.tenant_id
              AND supplier.branch_id=list.branch_id AND supplier.active
            WHERE list.tenant_id=destination.tenant_id AND list.branch_id=destination.branch_id
              AND list.inventory_item_id=destination.id AND list.effective_from<=CURRENT_DATE
              AND (list.effective_to IS NULL OR list.effective_to>=CURRENT_DATE)
          ) price ON TRUE
          LEFT JOIN LATERAL (
            SELECT live.id,live.batch_number,live.expiry_date,live.quantity
            FROM inventory_batches live
            WHERE live.tenant_id=source.tenant_id AND live.branch_id=source.branch_id
              AND live.inventory_item_id=source.id AND live.quantity>0
            ORDER BY expiry_date NULLS LAST,received_date,id
            LIMIT 1
          ) batch ON TRUE
          WHERE destination.tenant_id=$1 AND destination.branch_id=$2 AND destination.active
        ), quantified AS (
          SELECT candidates.*,
            GREATEST(0,LEAST(
              source_stock_quantity-GREATEST(source_reorder_point,CEIL(source_daily_usage*7.0)::INTEGER),
              GREATEST(destination_reorder_point,CEIL(destination_daily_usage*30.0)::INTEGER)-destination_stock_quantity
            ))::INTEGER AS suggested_quantity
          FROM candidates
        ), costs AS (
          SELECT quantified.*,
            transfer_unit_cost_paise*suggested_quantity::BIGINT AS stock_transfer_cost_paise,
            CASE WHEN transfer_base_transport_cost_paise IS NULL OR transfer_cost_per_km_paise IS NULL OR distance_km IS NULL THEN NULL
              ELSE transfer_base_transport_cost_paise+ROUND(distance_km*transfer_cost_per_km_paise)::BIGINT END AS transport_cost_paise,
            CASE WHEN transfer_handling_cost_per_unit_paise IS NULL THEN NULL
              ELSE transfer_handling_cost_per_unit_paise*suggested_quantity::BIGINT END AS handling_cost_paise,
            CASE WHEN transfer_delay_cost_per_unit_day_paise IS NULL OR transfer_expected_days IS NULL THEN NULL
              ELSE transfer_delay_cost_per_unit_day_paise*transfer_expected_days::BIGINT*suggested_quantity::BIGINT END AS delay_cost_paise,
            purchase_unit_cost_paise*suggested_quantity::BIGINT AS landed_purchase_cost_paise
          FROM quantified WHERE suggested_quantity>0
        ), landed AS (
          SELECT costs.*,
            stock_transfer_cost_paise+transport_cost_paise+handling_cost_paise+delay_cost_paise AS landed_transfer_cost_paise
          FROM costs
        )
        SELECT source_branch_id,source_branch_name,destination_branch_id,destination_branch_name,
          source_inventory_item_id,destination_inventory_item_id,product_name,sku,category,
          source_stock_quantity,destination_stock_quantity,source_daily_usage,destination_daily_usage,
          suggested_quantity,transfer_unit_cost_paise,purchase_unit_cost_paise,
          stock_transfer_cost_paise,transport_cost_paise,handling_cost_paise,delay_cost_paise,
          landed_transfer_cost_paise AS estimated_transfer_cost_paise,
          landed_purchase_cost_paise AS estimated_purchase_cost_paise,
          landed_purchase_cost_paise-landed_transfer_cost_paise AS savings_paise,
          CASE WHEN landed_transfer_cost_paise IS NULL OR landed_purchase_cost_paise IS NULL THEN 'cost_review'
               WHEN landed_transfer_cost_paise<landed_purchase_cost_paise THEN 'transfer'
               WHEN landed_transfer_cost_paise>landed_purchase_cost_paise THEN 'purchase' ELSE 'equal' END AS cost_decision,
          CASE WHEN source_daily_usage>0 THEN ROUND(((source_stock_quantity-suggested_quantity)::NUMERIC/source_daily_usage::NUMERIC)*10)/10 ELSE NULL END::DOUBLE PRECISION AS source_coverage_days_after,
          CASE WHEN destination_daily_usage>0 THEN ROUND(((destination_stock_quantity+suggested_quantity)::NUMERIC/destination_daily_usage::NUMERIC)*10)/10 ELSE NULL END::DOUBLE PRECISION AS destination_coverage_days_after,
          (source_stock_quantity-suggested_quantity)>=GREATEST(source_reorder_point,CEIL(source_daily_usage*7.0)::INTEGER) AS source_safe,
          (landed_transfer_cost_paise IS NULL OR landed_purchase_cost_paise IS NULL OR landed_transfer_cost_paise>=landed_purchase_cost_paise) AS owner_approval_required,
          CASE WHEN landed_transfer_cost_paise IS NULL OR landed_purchase_cost_paise IS NULL THEN 'Distance, policy, or supplier cost needs owner review'
               WHEN landed_transfer_cost_paise>=landed_purchase_cost_paise THEN 'Purchase cost is equal to or lower than landed transfer cost'
               ELSE '' END AS approval_reason,
          earliest_expiry_date,earliest_batch_id,earliest_batch_number,earliest_batch_quantity
        FROM landed
        ORDER BY owner_approval_required,savings_paise DESC NULLS LAST,earliest_expiry_date NULLS LAST,product_name
        LIMIT $3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn exception_evidence(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    variance_threshold_bps: i64,
    limit: usize,
) -> Result<Vec<InventoryExceptionEvidence>, sqlx::Error> {
    sqlx::query_as::<_, InventoryExceptionEvidence>(
        r#"
        WITH consumption AS (
          SELECT 'consumption_variance'::TEXT AS exception_type,usage.id AS entity_id,
            item.name||COALESCE(' · '||NULLIF(service.name,''),'') AS subject,
            CASE WHEN usage.expected_quantity=0 OR ABS(usage.actual_quantity-usage.expected_quantity)::BIGINT*10000>=GREATEST(usage.expected_quantity,1)*$4*2 THEN 'critical' ELSE 'warning' END::TEXT AS severity,
            LEAST(10000,CASE WHEN usage.expected_quantity=0 THEN 10000 ELSE 7000+(ABS(usage.actual_quantity-usage.expected_quantity)::BIGINT*3000/GREATEST(usage.expected_quantity,1)) END)::INTEGER AS confidence_bps,
            jsonb_build_object('expectedQuantity',usage.expected_quantity,'actualQuantity',usage.actual_quantity,'staffId',usage.staff_id,'serviceId',usage.service_id,'recordedAt',usage.created_at) AS evidence
          FROM inventory_backbar_usage usage
          JOIN inventory_items item ON item.id=usage.inventory_item_id AND item.tenant_id=usage.tenant_id AND item.branch_id=usage.branch_id
          LEFT JOIN services service ON service.id=usage.service_id AND service.tenant_id=usage.tenant_id AND service.branch_id=usage.branch_id
          WHERE usage.tenant_id=$1 AND usage.branch_id=$2 AND usage.status<>'rejected'
            AND (usage.expected_quantity=0 OR ABS(usage.actual_quantity-usage.expected_quantity)::BIGINT*10000>=GREATEST(usage.expected_quantity,1)*$4)
        ), usage_totals AS (
          SELECT usage.inventory_item_id,usage.staff_id,item.name,
            COALESCE(SUM(usage.actual_quantity) FILTER (WHERE usage.created_at>=NOW()-INTERVAL '7 days'),0)::BIGINT AS current_7,
            COALESCE(SUM(usage.actual_quantity) FILTER (WHERE usage.created_at>=NOW()-INTERVAL '28 days' AND usage.created_at<NOW()-INTERVAL '7 days'),0)::BIGINT AS prior_21
          FROM inventory_backbar_usage usage
          JOIN inventory_items item ON item.id=usage.inventory_item_id AND item.tenant_id=usage.tenant_id AND item.branch_id=usage.branch_id
          WHERE usage.tenant_id=$1 AND usage.branch_id=$2 AND usage.status<>'rejected' AND usage.created_at>=NOW()-INTERVAL '28 days'
          GROUP BY usage.inventory_item_id,usage.staff_id,item.name
        ), unusual AS (
          SELECT 'unusual_usage'::TEXT,inventory_item_id||':'||COALESCE(NULLIF(staff_id,''),'unassigned'),
            name||COALESCE(' · staff '||NULLIF(staff_id,''),''),'warning'::TEXT,8500::INTEGER,
            jsonb_build_object('current7DayQuantity',current_7,'prior21DayQuantity',prior_21,'staffId',staff_id)
          FROM usage_totals WHERE current_7>0 AND current_7*3>GREATEST(prior_21,1)*2
        ), irregular_purchase AS (
          SELECT 'irregular_purchase'::TEXT,draft.id,draft.supplier_name||COALESCE(' · '||NULLIF(draft.bill_number,''),''),
            CASE WHEN jsonb_array_length(draft.warnings)>=3 THEN 'critical' ELSE 'warning' END::TEXT,
            LEAST(9500,7000+jsonb_array_length(draft.warnings)*500)::INTEGER,
            jsonb_build_object('warningCount',jsonb_array_length(draft.warnings),'billNumber',draft.bill_number,'status',draft.status)
          FROM purchase_bill_drafts draft
          WHERE draft.tenant_id=$1 AND draft.branch_id=$2 AND draft.status IN ('review','extraction_failed')
            AND jsonb_typeof(draft.warnings)='array' AND jsonb_array_length(draft.warnings)>0
        ), supplier_delay AS (
          SELECT 'supplier_delay'::TEXT,orders.id,orders.order_number||' · '||supplier.name,
            CASE WHEN CURRENT_DATE-orders.expected_date>=14 THEN 'critical' ELSE 'warning' END::TEXT,
            LEAST(9800,7500+(CURRENT_DATE-orders.expected_date)*100)::INTEGER,
            jsonb_build_object('daysOverdue',CURRENT_DATE-orders.expected_date,'supplierId',orders.supplier_id,'expectedDate',orders.expected_date)
          FROM purchase_orders orders
          JOIN suppliers supplier ON supplier.id=orders.supplier_id AND supplier.tenant_id=orders.tenant_id AND supplier.branch_id=orders.branch_id
          WHERE orders.tenant_id=$1 AND orders.branch_id=$2 AND orders.status IN ('approved','partially_received') AND orders.expected_date<CURRENT_DATE
        ), negative AS (
          SELECT 'negative_stock'::TEXT,item.id,item.name,'critical'::TEXT,10000::INTEGER,
            jsonb_build_object('stockQuantity',item.stock_quantity,'pendingRequestId',request.id,'requestedStockQuantity',request.requested_stock_quantity)
          FROM inventory_items item
          LEFT JOIN inventory_negative_stock_requests request ON request.tenant_id=item.tenant_id AND request.branch_id=item.branch_id AND request.inventory_item_id=item.id AND request.status='pending'
          WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.active AND item.stock_quantity<0
        ), missing_recipe AS (
          SELECT 'missing_recipe'::TEXT,service.id,service.name,'warning'::TEXT,9000::INTEGER,
            jsonb_build_object('upcomingAppointments',COUNT(appointment.id),'serviceId',service.id)
          FROM services service
          JOIN appointments appointment ON appointment.tenant_id=service.tenant_id AND appointment.branch_id=service.branch_id
            AND appointment.start_at>=NOW() AND appointment.start_at<NOW()+INTERVAL '15 days'
            AND appointment.status NOT IN ('cancelled','completed','paid')
            AND COALESCE(appointment.service_ids_json,'[]')::JSONB ? service.id
          WHERE service.tenant_id=$1 AND service.branch_id=$2 AND service.active
            AND jsonb_typeof(COALESCE(service.product_consumption_json,'[]'::JSONB))='array'
            AND jsonb_array_length(COALESCE(service.product_consumption_json,'[]'::JSONB))=0
          GROUP BY service.id,service.name
        ), suspicious_adjustment AS (
          SELECT 'suspicious_adjustment'::TEXT,ledger.id,item.name,
            CASE WHEN ledger.stock_after_quantity<0 OR ABS(ledger.quantity_delta)::BIGINT*10000>=GREATEST(ABS(ledger.stock_before_quantity),1)*$4*2 THEN 'critical' ELSE 'warning' END::TEXT,
            LEAST(9800,7500+COUNT(*) OVER (PARTITION BY ledger.inventory_item_id)*300)::INTEGER,
            jsonb_build_object('quantityDelta',ledger.quantity_delta,'stockBeforeQuantity',ledger.stock_before_quantity,
              'repeatCount24h',COUNT(*) OVER (PARTITION BY ledger.inventory_item_id),'actorUserId',ledger.actor_user_id,'createdAt',ledger.created_at)
          FROM inventory_digital_twin_ledger ledger
          JOIN inventory_items item ON item.id=ledger.inventory_item_id AND item.tenant_id=ledger.tenant_id AND item.branch_id=ledger.branch_id
          WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2 AND ledger.movement_type='adjustment' AND ledger.created_at>=NOW()-INTERVAL '24 hours'
            AND ABS(ledger.quantity_delta)::BIGINT*10000>=GREATEST(ABS(ledger.stock_before_quantity),1)*$4
        ), container_state AS (
          SELECT container.inventory_item_id,item.name,
            COUNT(*) FILTER (WHERE container.status='open')::BIGINT AS open_count,
            SUM(container.remaining_quantity) FILTER (WHERE container.status='open')::BIGINT AS remaining_quantity,
            BOOL_OR((container.status='open' AND (container.remaining_quantity=0 OR container.opened_at IS NULL OR container.closed_at IS NOT NULL))
              OR (container.status='empty' AND container.remaining_quantity<>0)) AS invalid_state
          FROM inventory_backbar_containers container
          JOIN inventory_items item ON item.id=container.inventory_item_id AND item.tenant_id=container.tenant_id AND item.branch_id=container.branch_id
          WHERE container.tenant_id=$1 AND container.branch_id=$2
          GROUP BY container.inventory_item_id,item.name
        ), container_violation AS (
          SELECT 'container_violation'::TEXT,inventory_item_id,name,
            CASE WHEN open_count>1 THEN 'critical' ELSE 'warning' END::TEXT,9500::INTEGER,
            jsonb_build_object('openCount',open_count,'remainingQuantity',COALESCE(remaining_quantity,0),'invalidState',invalid_state)
          FROM container_state WHERE open_count>1 OR invalid_state
        ), evidence AS (
          SELECT * FROM consumption UNION ALL SELECT * FROM unusual UNION ALL SELECT * FROM irregular_purchase
          UNION ALL SELECT * FROM supplier_delay UNION ALL SELECT * FROM negative UNION ALL SELECT * FROM missing_recipe
          UNION ALL SELECT * FROM suspicious_adjustment UNION ALL SELECT * FROM container_violation
        )
        SELECT exception_type,entity_id,subject,severity,confidence_bps,evidence
        FROM evidence
        ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END,confidence_bps DESC,exception_type,entity_id
        LIMIT $3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(i64::try_from(limit.clamp(1, 500)).unwrap_or(500))
    .bind(variance_threshold_bps.clamp(0, 10_000))
    .fetch_all(db)
    .await
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
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<InventoryAutomationBudgetPosition, sqlx::Error> {
    let (purchase_commitment_paise, pending_expense_paise, available_cash_paise) =
        sqlx::query_as::<_, (i64, i64, i64)>(
            r#"SELECT
              (SELECT COALESCE(SUM(total_paise),0)::BIGINT FROM purchase_orders
               WHERE tenant_id=$1 AND branch_id=$2
                 AND status IN ('draft','pending_approval','approved','partially_received')
                 AND created_at>=DATE_TRUNC('month',CURRENT_DATE)) AS purchase_commitment_paise,
              (SELECT COALESCE(SUM(line.amount_paise),0)::BIGINT
               FROM outgoing_fund_vouchers voucher
               JOIN outgoing_fund_lines line ON line.tenant_id=voucher.tenant_id
                 AND line.branch_id=voucher.branch_id AND line.voucher_id=voucher.id
               WHERE voucher.tenant_id=$1 AND voucher.branch_id=$2 AND voucher.status='pending'
                 AND voucher.payment_account_code IN ('CASH_ON_HAND','BANK_CLEARING')
                 AND voucher.business_date>=DATE_TRUNC('month',CURRENT_DATE)::DATE) AS pending_expense_paise,
              (SELECT COALESCE(SUM(line.debit_paise-line.credit_paise),0)::BIGINT
               FROM accounting_journal_entries entry
               JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id
               WHERE entry.tenant_id=$1 AND entry.branch_id=$2
                 AND line.account_code IN ('CASH_ON_HAND','BANK_CLEARING')) AS available_cash_paise"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_one(db)
        .await?;
    Ok(InventoryAutomationBudgetPosition {
        purchase_commitment_paise,
        pending_expense_paise,
        available_cash_paise,
    })
}

pub async fn inventory_category_commitments(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<InventoryCategoryCommitment>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT item.category,COALESCE(SUM(line.total_paise),0)::BIGINT AS committed_paise
           FROM purchase_orders orders
           JOIN purchase_order_lines line ON line.tenant_id=orders.tenant_id
             AND line.branch_id=orders.branch_id AND line.purchase_order_id=orders.id
           JOIN inventory_items item ON item.tenant_id=line.tenant_id
             AND item.branch_id=line.branch_id AND item.id=line.inventory_item_id
           WHERE orders.tenant_id=$1 AND orders.branch_id=$2
             AND orders.status IN ('draft','pending_approval','approved','partially_received')
             AND orders.created_at>=DATE_TRUNC('month',CURRENT_DATE)
           GROUP BY item.category"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn touch_automation_policy(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE inventory_automation_policies SET last_run_at=NOW(),next_run_at=NOW()+(run_interval_minutes || ' minutes')::INTERVAL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND enabled=TRUE")
        .bind(tenant_id).bind(branch_id).execute(db).await?.rows_affected() == 1)
}

pub async fn recover_stale_automation_actions(db: &PgPool) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "UPDATE inventory_automation_actions SET status='pending_approval',reviewed_by=NULL,reviewed_at=NULL,review_note='',last_error='Recovered after interrupted approval execution',updated_at=NOW() WHERE status='approved' AND updated_at<NOW()-INTERVAL '15 minutes'",
    )
    .execute(db)
    .await?
    .rows_affected())
}

pub async fn claim_due_automation_policies(
    db: &PgPool,
    limit: i64,
) -> Result<Vec<InventoryAutomationPolicy>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH due AS (
             SELECT tenant_id,branch_id FROM inventory_automation_policies
             WHERE enabled=TRUE AND next_run_at<=NOW()
             ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT $1
           )
           UPDATE inventory_automation_policies policy
           SET last_run_at=NOW(),next_run_at=NOW()+(policy.run_interval_minutes||' minutes')::INTERVAL,updated_at=NOW()
           FROM due WHERE policy.tenant_id=due.tenant_id AND policy.branch_id=due.branch_id
           RETURNING policy.tenant_id,policy.branch_id,policy.enabled,policy.auto_transfer_drafts,
             policy.auto_po_drafts,policy.monthly_budget_paise,policy.category_budgets_paise,
             policy.expiry_rescue_days,policy.run_interval_minutes,policy.escalation_minutes,
             policy.min_confidence_bps,policy.last_run_at,policy.next_run_at,policy.updated_at"#,
    )
    .bind(limit.clamp(1, 100))
    .fetch_all(db)
    .await
}

pub async fn escalate_due_automation_actions(db: &PgPool) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        r#"INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json)
           SELECT action.tenant_id,action.branch_id,'','inventory-autopilot','inventory_automation_escalation',
             'Inventory approval overdue',action.title,'inventory_automation_action',action.id,
             jsonb_build_object('actionType',action.action_type,'requestedAt',action.created_at)
           FROM inventory_automation_actions action
           JOIN inventory_automation_policies policy ON policy.tenant_id=action.tenant_id AND policy.branch_id=action.branch_id
           WHERE action.status='pending_approval'
             AND action.created_at<=NOW()-(policy.escalation_minutes||' minutes')::INTERVAL
           ON CONFLICT DO NOTHING"#,
    )
    .execute(db)
    .await?
    .rows_affected())
}

pub async fn escalate_automation_actions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    minutes: i32,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        r#"INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json)
           SELECT tenant_id,branch_id,'','inventory-autopilot','inventory_automation_escalation',
             'Inventory approval overdue',title,'inventory_automation_action',id,
             jsonb_build_object('actionType',action_type,'requestedAt',created_at)
           FROM inventory_automation_actions
           WHERE tenant_id=$1 AND branch_id=$2 AND status='pending_approval'
             AND created_at<=NOW()-($3||' minutes')::INTERVAL
           ON CONFLICT DO NOTHING"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(minutes.clamp(30, 10_080))
    .execute(db)
    .await?
    .rows_affected())
}

pub async fn reject_automation_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    note: &str,
) -> Result<Option<InventoryAutomationAction>, sqlx::Error> {
    sqlx::query_as::<_, InventoryAutomationAction>("UPDATE inventory_automation_actions SET status='rejected',reviewed_by=$4,review_note=$5,reviewed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending_approval' AND requested_by<>$4 RETURNING id,tenant_id,branch_id,action_type,status,dedupe_key,title,rationale,confidence_bps,estimated_cost_paise,payload_json,requested_by,reviewed_by,review_note,resource_type,resource_id,last_error,reviewed_at,completed_at,created_at,updated_at")
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
    sqlx::query_as::<_, InventoryAutomationAction>("UPDATE inventory_automation_actions SET status='approved',reviewed_by=$4,review_note=$5,reviewed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending_approval' AND requested_by<>$4 RETURNING id,tenant_id,branch_id,action_type,status,dedupe_key,title,rationale,confidence_bps,estimated_cost_paise,payload_json,requested_by,reviewed_by,review_note,resource_type,resource_id,last_error,reviewed_at,completed_at,created_at,updated_at")
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

pub async fn fail_automation_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    error: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_automation_actions SET status='failed',last_error=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).bind(error).execute(db).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn create_automation_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action_type: &str,
    status: &str,
    dedupe_key: &str,
    title: &str,
    rationale: &str,
    confidence_bps: i32,
    estimated_cost_paise: i64,
    payload: &Value,
    actor: &str,
    resource_type: &str,
    resource_id: &str,
) -> Result<Option<InventoryAutomationAction>, sqlx::Error> {
    sqlx::query_as::<_, InventoryAutomationAction>(
        r#"INSERT INTO inventory_automation_actions(tenant_id,branch_id,action_type,status,dedupe_key,title,rationale,confidence_bps,estimated_cost_paise,payload_json,requested_by,resource_type,resource_id,completed_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $4='completed' THEN NOW() END)
           ON CONFLICT (tenant_id,branch_id,dedupe_key) DO NOTHING
           RETURNING id,tenant_id,branch_id,action_type,status,dedupe_key,title,rationale,confidence_bps,estimated_cost_paise,payload_json,requested_by,reviewed_by,review_note,resource_type,resource_id,last_error,reviewed_at,completed_at,created_at,updated_at"#,
    )
    .bind(tenant_id).bind(branch_id).bind(action_type).bind(status).bind(dedupe_key)
    .bind(title).bind(rationale).bind(confidence_bps).bind(estimated_cost_paise)
    .bind(payload).bind(actor).bind(resource_type).bind(resource_id)
    .fetch_optional(db).await
}

pub async fn notify_automation_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action: &InventoryAutomationAction,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json)
           VALUES($1,$2,'','inventory-autopilot','inventory_automation',$3,$4,'inventory_automation_action',$5,$6)
           ON CONFLICT DO NOTHING"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&action.title).bind(&action.rationale)
    .bind(&action.id).bind(serde_json::json!({"actionType":action.action_type,"status":action.status}))
    .execute(db).await?;
    Ok(())
}
