use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, FromRow)]
pub struct DemandInput {
    pub inventory_item_id: String,
    pub product_name: String,
    pub sku: String,
    pub stock_quantity: i32,
    pub reorder_point: i32,
    pub alert_level: i32,
    pub desired_level: i32,
    pub order_level: i32,
    pub safety_stock_level: i32,
    pub unit_cost_paise: i64,
    pub gst_percent: i32,
    pub supplier_id: String,
    pub lead_time_days: i32,
    pub supplier_score_bps: Option<i32>,
    pub on_time_rate_bps: Option<i32>,
    pub fill_rate_bps: Option<i32>,
    pub return_rate_bps: Option<i32>,
    pub expiry_risk_bps: Option<i32>,
    pub minimum_order_quantity: i32,
    pub pack_size: i32,
    pub safety_stock_days: i32,
    pub demand_history: i64,
    pub demand_7: i64,
    pub consumption_history: i64,
    pub pending_po_quantity: i64,
    pub pending_transfer_quantity: i64,
    pub expiring_quantity: i64,
    pub inactive_days: i64,
}
#[derive(Debug, FromRow)]
pub struct ForecastConfig {
    pub history_days: i32,
    pub coverage_days: i32,
}
#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastRun {
    pub id: String,
    pub model_version: String,
    pub history_start: NaiveDate,
    pub history_end: NaiveDate,
    pub created_by: String,
    pub evidence_snapshot: Value,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub id: String,
    pub forecast_run_id: String,
    pub inventory_item_id: String,
    pub product_name: String,
    pub sku: String,
    pub product_category: String,
    pub current_stock: i32,
    pub reorder_level: i32,
    pub supplier_id: String,
    pub status: String,
    pub suggested_quantity: i32,
    pub unit_cost_paise: i64,
    pub confidence_bps: i32,
    pub explanation: Value,
    pub purchase_order_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub async fn demand_inputs(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    history_days: i32,
) -> Result<Vec<DemandInput>, sqlx::Error> {
    sqlx::query_as(r#"SELECT item.id inventory_item_id,item.name product_name,item.sku,item.stock_quantity,item.reorder_point,item.alert_level,item.desired_level,item.order_level,item.safety_stock_level,selected.unit_cost_paise,item.gst_percent,selected.supplier_id,selected.lead_time_days,selected.supplier_score_bps,selected.on_time_rate_bps,selected.fill_rate_bps,selected.return_rate_bps,selected.expiry_risk_bps,selected.minimum_order_quantity,selected.pack_size,selected.safety_stock_days,
 COALESCE((SELECT SUM(ABS(l.quantity_delta)) FROM inventory_stock_ledger l WHERE l.tenant_id=item.tenant_id AND l.branch_id=item.branch_id AND l.inventory_item_id=item.id AND l.quantity_delta<0 AND l.movement_type IN ('sale','consumption') AND l.created_at>=NOW()-($3::INT*INTERVAL '1 day')),0)::BIGINT demand_history,
 COALESCE((SELECT SUM(ABS(l.quantity_delta)) FROM inventory_stock_ledger l WHERE l.tenant_id=item.tenant_id AND l.branch_id=item.branch_id AND l.inventory_item_id=item.id AND l.quantity_delta<0 AND l.movement_type IN ('sale','consumption') AND l.created_at>=NOW()-INTERVAL '7 days'),0)::BIGINT demand_7,
 COALESCE((SELECT SUM(actual_quantity) FROM inventory_backbar_usage u WHERE u.tenant_id=item.tenant_id AND u.branch_id=item.branch_id AND u.inventory_item_id=item.id AND u.status='recorded' AND u.created_at>=NOW()-($3::INT*INTERVAL '1 day')),0)::BIGINT consumption_history,
 COALESCE((SELECT SUM(line.quantity-line.received_quantity) FROM purchase_order_lines line JOIN purchase_orders po ON po.id=line.purchase_order_id AND po.tenant_id=line.tenant_id AND po.branch_id=line.branch_id WHERE line.tenant_id=item.tenant_id AND line.branch_id=item.branch_id AND line.inventory_item_id=item.id AND po.status IN ('pending_approval','approved','partially_received')),0)::BIGINT pending_po_quantity,
 COALESCE((SELECT SUM(GREATEST(line.quantity-line.received_retail_quantity-line.received_consumable_quantity-line.damaged_quantity-line.expired_quantity-line.short_quantity,0)) FROM inventory_transfer_lines line JOIN inventory_transfers transfer ON transfer.id=line.transfer_id AND transfer.tenant_id=line.tenant_id WHERE line.tenant_id=item.tenant_id AND transfer.destination_branch_id=item.branch_id AND line.destination_inventory_item_id=item.id AND transfer.status IN ('raised','approved','dispatched','in_transit','partially_received')),0)::BIGINT pending_transfer_quantity,
 COALESCE((SELECT SUM(batch.quantity) FROM inventory_batches batch WHERE batch.tenant_id=item.tenant_id AND batch.branch_id=item.branch_id AND batch.inventory_item_id=item.id AND batch.quantity>0 AND batch.expiry_date<=CURRENT_DATE+30),0)::BIGINT expiring_quantity,
 COALESCE((SELECT EXTRACT(DAY FROM NOW()-MAX(l.created_at)) FROM inventory_stock_ledger l WHERE l.tenant_id=item.tenant_id AND l.branch_id=item.branch_id AND l.inventory_item_id=item.id AND l.quantity_delta<0 AND l.movement_type IN ('sale','consumption')),999)::BIGINT inactive_days
 FROM inventory_items item
 JOIN LATERAL (
   SELECT terms.supplier_id,terms.lead_time_days,terms.minimum_order_quantity,terms.pack_size,terms.safety_stock_days,
          COALESCE(price.unit_cost_paise,item.unit_cost_paise) unit_cost_paise,
          metrics.supplier_score_bps,metrics.on_time_rate_bps,metrics.fill_rate_bps,
          metrics.return_rate_bps,metrics.expiry_risk_bps
   FROM supplier_inventory_terms terms
   JOIN suppliers supplier ON supplier.id=terms.supplier_id AND supplier.tenant_id=terms.tenant_id AND supplier.branch_id=terms.branch_id AND supplier.active=TRUE
   LEFT JOIN LATERAL (
     SELECT listed.unit_cost_paise FROM supplier_price_lists listed
     WHERE listed.tenant_id=terms.tenant_id AND listed.branch_id=terms.branch_id
       AND listed.supplier_id=terms.supplier_id AND listed.inventory_item_id=terms.inventory_item_id
       AND listed.effective_from<=CURRENT_DATE AND (listed.effective_to IS NULL OR listed.effective_to>=CURRENT_DATE)
     ORDER BY listed.effective_from DESC LIMIT 1
   ) price ON TRUE
   LEFT JOIN LATERAL (
     SELECT scored.*,
       CASE WHEN scored.on_time_rate_bps IS NULL OR scored.fill_rate_bps IS NULL THEN NULL ELSE
         ((scored.on_time_rate_bps*35+scored.fill_rate_bps*30+
           (10000-scored.return_rate_bps)*20+(10000-scored.expiry_risk_bps)*15)/100)::INT
       END supplier_score_bps
     FROM (
       SELECT
         CASE WHEN performance.received_orders=0 THEN NULL ELSE
           LEAST(10000,(10000*performance.on_time_orders/performance.received_orders)::INT) END on_time_rate_bps,
         CASE WHEN performance.ordered_quantity=0 THEN NULL ELSE
           LEAST(10000,(10000*performance.received_quantity/performance.ordered_quantity)::INT) END fill_rate_bps,
         CASE WHEN performance.received_quantity=0 THEN 0 ELSE
           LEAST(10000,(10000*performance.returned_quantity/performance.received_quantity)::INT) END return_rate_bps,
         CASE WHEN performance.received_quantity=0 THEN 0 ELSE
           LEAST(10000,(10000*performance.expiring_quantity/performance.received_quantity)::INT) END expiry_risk_bps
       FROM (
         SELECT
           COUNT(DISTINCT po.id) FILTER (WHERE EXISTS (
             SELECT 1 FROM purchase_receipts receipt
             WHERE receipt.tenant_id=po.tenant_id AND receipt.branch_id=po.branch_id
               AND receipt.purchase_order_id=po.id AND receipt.rolled_back_at IS NULL
           ))::BIGINT received_orders,
           COUNT(DISTINCT po.id) FILTER (WHERE EXISTS (
             SELECT 1 FROM purchase_receipts receipt
             WHERE receipt.tenant_id=po.tenant_id AND receipt.branch_id=po.branch_id
               AND receipt.purchase_order_id=po.id AND receipt.rolled_back_at IS NULL
               AND (po.expected_date IS NULL OR receipt.received_date<=po.expected_date)
           ))::BIGINT on_time_orders,
           COALESCE(SUM(line.quantity),0)::BIGINT ordered_quantity,
           COALESCE(SUM(line.received_quantity),0)::BIGINT received_quantity,
           COALESCE((SELECT SUM(return_line.quantity) FROM purchase_returns returned
             JOIN purchase_return_lines return_line ON return_line.purchase_return_id=returned.id
               AND return_line.tenant_id=returned.tenant_id AND return_line.branch_id=returned.branch_id
             WHERE returned.tenant_id=terms.tenant_id AND returned.branch_id=terms.branch_id
               AND returned.supplier_id=terms.supplier_id
               AND return_line.inventory_item_id=terms.inventory_item_id),0)::BIGINT returned_quantity,
           COALESCE((SELECT SUM(batch.quantity) FROM inventory_batches batch
             WHERE batch.tenant_id=terms.tenant_id AND batch.branch_id=terms.branch_id
               AND batch.inventory_item_id=terms.inventory_item_id AND batch.quantity>0
               AND batch.expiry_date<=CURRENT_DATE+30 AND EXISTS (
                 SELECT 1 FROM purchase_receipts receipt
                 JOIN purchase_receipt_lines receipt_line ON receipt_line.purchase_receipt_id=receipt.id
                   AND receipt_line.tenant_id=receipt.tenant_id AND receipt_line.branch_id=receipt.branch_id
                 WHERE receipt.tenant_id=terms.tenant_id AND receipt.branch_id=terms.branch_id
                   AND receipt.supplier_id=terms.supplier_id AND receipt.rolled_back_at IS NULL
                   AND receipt_line.inventory_item_id=terms.inventory_item_id
                   AND receipt_line.batch_number=batch.batch_number
               )),0)::BIGINT expiring_quantity
         FROM purchase_orders po
         JOIN purchase_order_lines line ON line.purchase_order_id=po.id
           AND line.tenant_id=po.tenant_id AND line.branch_id=po.branch_id
           AND line.inventory_item_id=terms.inventory_item_id
         WHERE po.tenant_id=terms.tenant_id AND po.branch_id=terms.branch_id
           AND po.supplier_id=terms.supplier_id
       ) performance
     ) scored
   ) metrics ON TRUE
   WHERE terms.tenant_id=item.tenant_id AND terms.branch_id=item.branch_id
     AND terms.inventory_item_id=item.id AND terms.active=TRUE
   ORDER BY CASE WHEN COALESCE(price.unit_cost_paise,item.unit_cost_paise)>0 THEN 0 ELSE 1 END,
            metrics.supplier_score_bps DESC NULLS LAST,
            COALESCE(price.unit_cost_paise,item.unit_cost_paise),terms.lead_time_days,terms.supplier_id
   LIMIT 1
 ) selected ON TRUE
 WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.active=TRUE"#).bind(tenant).bind(branch).bind(history_days).fetch_all(db).await
}
pub async fn forecast_config(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<ForecastConfig, sqlx::Error> {
    sqlx::query_as("SELECT COALESCE((SELECT reorder_history_days FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),60)::INT history_days,COALESCE((SELECT reorder_coverage_days FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),30)::INT coverage_days")
        .bind(tenant).bind(branch).fetch_one(db).await
}
pub async fn create_run(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    actor: &str,
    history_days: i32,
    evidence: &Value,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_reorder_forecast_runs(tenant_id,branch_id,model_version,history_start,history_end,created_by,evidence_snapshot) VALUES($1,$2,'seasonal-demand-v4',CURRENT_DATE-$3,CURRENT_DATE,$4,$5) RETURNING id").bind(tenant).bind(branch).bind(history_days).bind(actor).bind(evidence).fetch_one(&mut **tx).await
}
pub async fn insert_recommendation(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    run: &str,
    row: &RecommendationDraft,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO inventory_reorder_recommendations(tenant_id,branch_id,forecast_run_id,inventory_item_id,supplier_id,suggested_quantity,unit_cost_paise,confidence_bps,explanation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(tenant).bind(branch).bind(run).bind(&row.inventory_item_id).bind(&row.supplier_id).bind(row.suggested_quantity).bind(row.unit_cost_paise).bind(row.confidence_bps).bind(&row.explanation).execute(&mut **tx).await?;
    Ok(())
}
pub struct RecommendationDraft {
    pub inventory_item_id: String,
    pub supplier_id: String,
    pub suggested_quantity: i32,
    pub unit_cost_paise: i64,
    pub confidence_bps: i32,
    pub explanation: Value,
}
pub async fn latest_run(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Option<ForecastRun>, sqlx::Error> {
    sqlx::query_as("SELECT id,model_version,history_start,history_end,created_by,evidence_snapshot,created_at FROM inventory_reorder_forecast_runs WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 1").bind(tenant).bind(branch).fetch_optional(db).await
}
pub async fn recommendations(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    run: &str,
) -> Result<Vec<Recommendation>, sqlx::Error> {
    sqlx::query_as("SELECT r.id,r.forecast_run_id,r.inventory_item_id,item.name product_name,item.sku,COALESCE(NULLIF(item.category,''),'uncategorized') product_category,item.stock_quantity current_stock,item.reorder_point reorder_level,r.supplier_id,r.status,r.suggested_quantity,r.unit_cost_paise,r.confidence_bps,r.explanation,r.purchase_order_id,r.created_at FROM inventory_reorder_recommendations r JOIN inventory_items item ON item.id=r.inventory_item_id AND item.tenant_id=r.tenant_id AND item.branch_id=r.branch_id WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.forecast_run_id=$3 ORDER BY r.created_at").bind(tenant).bind(branch).bind(run).fetch_all(db).await
}
pub async fn begin_conversion(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
) -> Result<Option<Recommendation>, sqlx::Error> {
    sqlx::query_as("UPDATE inventory_reorder_recommendations r SET status='converting',approved_by=$4,approved_at=NOW() WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.id=$3 AND r.status='pending_approval' RETURNING r.id,r.forecast_run_id,r.inventory_item_id,(SELECT name FROM inventory_items WHERE id=r.inventory_item_id AND tenant_id=r.tenant_id AND branch_id=r.branch_id) product_name,(SELECT sku FROM inventory_items WHERE id=r.inventory_item_id AND tenant_id=r.tenant_id AND branch_id=r.branch_id) sku,(SELECT COALESCE(NULLIF(category,''),'uncategorized') FROM inventory_items WHERE id=r.inventory_item_id AND tenant_id=r.tenant_id AND branch_id=r.branch_id) product_category,(SELECT stock_quantity FROM inventory_items WHERE id=r.inventory_item_id AND tenant_id=r.tenant_id AND branch_id=r.branch_id) current_stock,(SELECT reorder_point FROM inventory_items WHERE id=r.inventory_item_id AND tenant_id=r.tenant_id AND branch_id=r.branch_id) reorder_level,r.supplier_id,r.status,r.suggested_quantity,r.unit_cost_paise,r.confidence_bps,r.explanation,r.purchase_order_id,r.created_at").bind(tenant).bind(branch).bind(id).bind(actor).fetch_optional(&mut **tx).await
}
pub async fn finish_conversion(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    po: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE inventory_reorder_recommendations SET status='converted',purchase_order_id=$4 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='converting'").bind(tenant).bind(branch).bind(id).bind(po).execute(db).await?.rows_affected()==1)
}

pub async fn run_by_id(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<ForecastRun>, sqlx::Error> {
    sqlx::query_as("SELECT id,model_version,history_start,history_end,created_by,evidence_snapshot,created_at FROM inventory_reorder_forecast_runs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(tenant).bind(branch).bind(id).fetch_optional(db).await
}
pub async fn upsert_terms(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    supplier: &str,
    item: &str,
    lead: i32,
    moq: i32,
    pack: i32,
    safety: i32,
    vendor_part_number: &str,
    purchase_unit: &str,
    conversion_quantity: i32,
    center_available: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO supplier_inventory_terms(tenant_id,branch_id,supplier_id,inventory_item_id,lead_time_days,minimum_order_quantity,pack_size,safety_stock_days,vendor_part_number,purchase_unit,conversion_quantity,center_available) SELECT $1,$2,s.id,i.id,$5,$6,$7,$8,$9,$10,$11,$12 FROM suppliers s JOIN inventory_items i ON i.tenant_id=$1 AND i.branch_id=$2 AND i.id=$4 WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3 AND s.active=TRUE AND i.active=TRUE ON CONFLICT(tenant_id,branch_id,supplier_id,inventory_item_id) DO UPDATE SET lead_time_days=EXCLUDED.lead_time_days,minimum_order_quantity=EXCLUDED.minimum_order_quantity,pack_size=EXCLUDED.pack_size,safety_stock_days=EXCLUDED.safety_stock_days,vendor_part_number=EXCLUDED.vendor_part_number,purchase_unit=EXCLUDED.purchase_unit,conversion_quantity=EXCLUDED.conversion_quantity,center_available=EXCLUDED.center_available,active=TRUE,updated_at=NOW()").bind(tenant).bind(branch).bind(supplier).bind(item).bind(lead).bind(moq).bind(pack).bind(safety).bind(vendor_part_number).bind(purchase_unit).bind(conversion_quantity).bind(center_available).execute(db).await?;
    Ok(())
}
