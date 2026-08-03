use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct PackageRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub name: String,
    pub description: String,
    pub price_paise: i64,
    pub discount_percent: i32,
    pub validity_days: i32,
    pub service_ids_json: String,
    pub paid_sessions: i32,
    pub free_sessions: i32,
    pub cost_price_paise: i64,
    pub service_rows_json: String,
    pub rules_json: String,
    pub show_mobile_app: bool,
    pub show_online_booking: bool,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

pub struct CreatePackage<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub name: &'a str,
    pub description: &'a str,
    pub price_paise: i64,
    pub discount_percent: i32,
    pub validity_days: i32,
    pub service_ids_json: &'a str,
    pub paid_sessions: i32,
    pub free_sessions: i32,
    pub cost_price_paise: i64,
    pub service_rows_json: &'a str,
    pub rules_json: &'a str,
    pub show_mobile_app: bool,
    pub show_online_booking: bool,
    pub active: bool,
}

pub struct UpdatePackage<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub name: Option<&'a str>,
    pub description: Option<&'a str>,
    pub price_paise: Option<i64>,
    pub discount_percent: Option<i32>,
    pub validity_days: Option<i32>,
    pub service_ids_json: Option<&'a str>,
    pub paid_sessions: Option<i32>,
    pub free_sessions: Option<i32>,
    pub cost_price_paise: Option<i64>,
    pub service_rows_json: Option<&'a str>,
    pub rules_json: Option<&'a str>,
    pub show_mobile_app: Option<bool>,
    pub show_online_booking: Option<bool>,
    pub active: Option<bool>,
}

#[derive(Debug, FromRow, Serialize)]
pub struct PackageReportRow {
    pub id: String,
    pub client_id: String,
    pub client_name: String,
    pub contact: String,
    pub package_id: String,
    pub package_name: String,
    pub service_id: String,
    pub service_name: String,
    pub invoice_id: String,
    pub invoice_number: String,
    pub unit_value_paise: i64,
    pub issued_value_paise: i64,
    pub redeemed_value_paise: i64,
    pub pending_value_paise: i64,
    pub total_qty: i32,
    pub redeemed_qty: i32,
    pub pending_qty: i32,
    pub sold_at: DateTime<Utc>,
    pub expires_at: Option<NaiveDate>,
    pub frozen_at: Option<DateTime<Utc>>,
    pub frozen_until: Option<NaiveDate>,
    pub status: String,
}

#[derive(Debug, FromRow, Serialize)]
pub struct PackageReportSummary {
    pub total_rows: i64,
    pub total_qty: i64,
    pub redeemed_qty: i64,
    pub pending_qty: i64,
    pub issued_value_paise: i64,
    pub redeemed_value_paise: i64,
    pub pending_value_paise: i64,
}

const PACKAGE_REPORT_CTE: &str = r#"
WITH redemption_totals AS (
  SELECT client_package_credit_id,
         COALESCE(SUM(quantity),0)::INTEGER AS redeemed_qty,
         COALESCE(SUM(redeemed_value_paise),0)::BIGINT AS redeemed_value_paise
    FROM pos_package_redemptions
   WHERE tenant_id=$1 AND source_branch_id=$2
   GROUP BY client_package_credit_id
), base AS (
  SELECT cpc.*, CONCAT_WS(' ',c.first_name,c.last_name) AS client_name, c.phone AS contact,
         COALESCE(ps.invoice_number,'') AS invoice_number,
         COALESCE(psl.package_value_paise,0)::BIGINT AS package_value_paise,
         SUM(cpc.total_qty) OVER (PARTITION BY cpc.source_sale_id,cpc.package_id)::BIGINT AS sale_credit_qty,
         COALESCE(rt.redeemed_qty,0)::INTEGER AS ledger_redeemed_qty,
         COALESCE(rt.redeemed_value_paise,0)::BIGINT AS ledger_redeemed_value_paise
    FROM client_package_credits cpc
    JOIN clients c ON c.id=cpc.client_id AND c.tenant_id=cpc.tenant_id AND c.branch_id=cpc.branch_id
    LEFT JOIN pos_sales ps ON ps.id=cpc.source_sale_id AND ps.tenant_id=cpc.tenant_id AND ps.branch_id=cpc.branch_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(taxable_paise),0)::BIGINT AS package_value_paise
        FROM pos_sale_lines
       WHERE tenant_id=cpc.tenant_id AND branch_id=cpc.branch_id
         AND sale_id=cpc.source_sale_id AND line_type='package' AND item_id=cpc.package_id
    ) psl ON TRUE
    LEFT JOIN redemption_totals rt ON rt.client_package_credit_id=cpc.id
   WHERE cpc.tenant_id=$1 AND cpc.branch_id=$2
), valued AS (
  SELECT base.*,
         LEAST(total_qty,GREATEST(0,ledger_redeemed_qty))::INTEGER AS redeemed_qty,
         GREATEST(total_qty-LEAST(total_qty,GREATEST(0,ledger_redeemed_qty)),0)::INTEGER AS pending_qty,
         CASE WHEN issued_value_paise>0 THEN issued_value_paise
              WHEN sale_credit_qty>0 THEN package_value_paise*total_qty/sale_credit_qty ELSE 0 END::BIGINT AS effective_issued_value_paise
    FROM base
), report_rows AS (
  SELECT id,client_id,client_name,contact,package_id,package_name,service_id,service_name,
         source_sale_id AS invoice_id,invoice_number,
         CASE WHEN unit_value_paise>0 THEN unit_value_paise
              WHEN total_qty>0 THEN effective_issued_value_paise/total_qty ELSE 0 END::BIGINT AS unit_value_paise,
         effective_issued_value_paise AS issued_value_paise,
         CASE WHEN ledger_redeemed_value_paise>0 THEN LEAST(ledger_redeemed_value_paise,effective_issued_value_paise)
              WHEN total_qty>0 THEN (effective_issued_value_paise/total_qty)*redeemed_qty ELSE 0 END::BIGINT AS redeemed_value_paise,
         GREATEST(effective_issued_value_paise-
           CASE WHEN ledger_redeemed_value_paise>0 THEN LEAST(ledger_redeemed_value_paise,effective_issued_value_paise)
                WHEN total_qty>0 THEN (effective_issued_value_paise/total_qty)*redeemed_qty ELSE 0 END,0)::BIGINT AS pending_value_paise,
         total_qty,redeemed_qty,pending_qty,created_at AS sold_at,expires_at,frozen_at,frozen_until,
         CASE WHEN pending_qty=0 THEN 'completed'
              WHEN expires_at IS NOT NULL AND expires_at<CURRENT_DATE THEN 'expired'
              ELSE 'pending' END AS status
    FROM valued
)
"#;

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    q: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<PackageRecord>, sqlx::Error> {
    sqlx::query_as::<_, PackageRecord>(&select_sql(
        r#"
        WHERE tenant_id = $1
          AND branch_id = $2
          AND (
            $3 = ''
            OR name ILIKE '%' || $3 || '%'
            OR description ILIKE '%' || $3 || '%'
          )
        ORDER BY created_at DESC
        LIMIT $4 OFFSET $5
        "#,
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(q)
    .bind(limit)
    .bind(offset)
    .fetch_all(db)
    .await
}

pub async fn get(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<PackageRecord>, sqlx::Error> {
    sqlx::query_as::<_, PackageRecord>(&select_sql(
        r#"
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3 AND active = TRUE
        LIMIT 1
        "#,
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn create(db: &PgPool, input: CreatePackage<'_>) -> Result<PackageRecord, sqlx::Error> {
    sqlx::query_as::<_, PackageRecord>(
        r#"
        INSERT INTO packages (
          tenant_id, branch_id, name, description, price_paise, discount_percent, validity_days, service_ids_json,
          paid_sessions, free_sessions, cost_price_paise, service_rows_json, rules_json, show_mobile_app, show_online_booking, active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16)
        RETURNING
          id, tenant_id, branch_id, name, description, price_paise::BIGINT AS price_paise,
          discount_percent, validity_days, service_ids_json::TEXT AS service_ids_json,
          paid_sessions, free_sessions, cost_price_paise, service_rows_json::TEXT AS service_rows_json,
          rules_json::TEXT AS rules_json, show_mobile_app, show_online_booking,
          active, created_at, updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.name)
    .bind(input.description)
    .bind(input.price_paise)
    .bind(input.discount_percent)
    .bind(input.validity_days)
    .bind(input.service_ids_json)
    .bind(input.paid_sessions)
    .bind(input.free_sessions)
    .bind(input.cost_price_paise)
    .bind(input.service_rows_json)
    .bind(input.rules_json)
    .bind(input.show_mobile_app)
    .bind(input.show_online_booking)
    .bind(input.active)
    .fetch_one(db)
    .await
}

pub async fn update(
    db: &PgPool,
    input: UpdatePackage<'_>,
) -> Result<Option<PackageRecord>, sqlx::Error> {
    sqlx::query_as::<_, PackageRecord>(
        r#"
        UPDATE packages
        SET
          name = COALESCE($4, name),
          description = COALESCE($5, description),
          price_paise = COALESCE($6, price_paise),
          discount_percent = COALESCE($7, discount_percent),
          validity_days = COALESCE($8, validity_days),
          service_ids_json = COALESCE($9::jsonb, service_ids_json),
          active = COALESCE($10, active),
          paid_sessions = COALESCE($11, paid_sessions),
          free_sessions = COALESCE($12, free_sessions),
          cost_price_paise = COALESCE($13, cost_price_paise),
          service_rows_json = COALESCE($14::jsonb, service_rows_json),
          rules_json = COALESCE($15::jsonb, rules_json),
          show_mobile_app = COALESCE($16, show_mobile_app),
          show_online_booking = COALESCE($17, show_online_booking),
          updated_at = NOW()
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        RETURNING
          id, tenant_id, branch_id, name, description, price_paise::BIGINT AS price_paise,
          discount_percent, validity_days, service_ids_json::TEXT AS service_ids_json,
          paid_sessions, free_sessions, cost_price_paise, service_rows_json::TEXT AS service_rows_json,
          rules_json::TEXT AS rules_json, show_mobile_app, show_online_booking,
          active, created_at, updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.id)
    .bind(input.name)
    .bind(input.description)
    .bind(input.price_paise)
    .bind(input.discount_percent)
    .bind(input.validity_days)
    .bind(input.service_ids_json)
    .bind(input.active)
    .bind(input.paid_sessions)
    .bind(input.free_sessions)
    .bind(input.cost_price_paise)
    .bind(input.service_rows_json)
    .bind(input.rules_json)
    .bind(input.show_mobile_app)
    .bind(input.show_online_booking)
    .fetch_optional(db)
    .await
}

pub async fn archive(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE packages
        SET active = FALSE, updated_at = NOW()
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

pub async fn restore(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "UPDATE packages SET active=TRUE,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=FALSE RETURNING name",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

fn select_sql(where_clause: &str) -> String {
    format!(
        r#"
        SELECT
          id, tenant_id, branch_id, name, description,
          price_paise::BIGINT AS price_paise, discount_percent, validity_days,
          service_ids_json::TEXT AS service_ids_json, paid_sessions, free_sessions,
          cost_price_paise, service_rows_json::TEXT AS service_rows_json,
          rules_json::TEXT AS rules_json, show_mobile_app, show_online_booking,
          active, created_at, updated_at
        FROM packages
        {where_clause}
        "#,
    )
}

pub async fn get_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT settings_json::TEXT FROM package_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn save_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    settings_json: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar::<_, String>("INSERT INTO package_settings (tenant_id,branch_id,settings_json) VALUES ($1,$2,$3::jsonb) ON CONFLICT (tenant_id,branch_id) DO UPDATE SET settings_json=EXCLUDED.settings_json,updated_at=NOW() RETURNING settings_json::TEXT")
        .bind(tenant_id).bind(branch_id).bind(settings_json).fetch_one(db).await
}

pub async fn package_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
    search: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    limit: i64,
    offset: i64,
) -> Result<Vec<PackageReportRow>, sqlx::Error> {
    let sql = format!("{PACKAGE_REPORT_CTE} SELECT * FROM report_rows WHERE ($3='' OR status=$3) AND ($4='' OR client_name ILIKE '%'||$4||'%' OR contact ILIKE '%'||$4||'%' OR package_name ILIKE '%'||$4||'%' OR service_name ILIKE '%'||$4||'%') AND ($5::DATE IS NULL OR sold_at::DATE >= $5) AND ($6::DATE IS NULL OR sold_at::DATE <= $6) ORDER BY sold_at DESC,id LIMIT $7 OFFSET $8");
    sqlx::query_as::<_, PackageReportRow>(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(status)
        .bind(search)
        .bind(from)
        .bind(to)
        .bind(limit)
        .bind(offset)
        .fetch_all(db)
        .await
}

pub async fn package_report_summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
    search: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
) -> Result<PackageReportSummary, sqlx::Error> {
    let sql = format!("{PACKAGE_REPORT_CTE} SELECT COUNT(*)::BIGINT AS total_rows,COALESCE(SUM(total_qty),0)::BIGINT AS total_qty,COALESCE(SUM(redeemed_qty),0)::BIGINT AS redeemed_qty,COALESCE(SUM(pending_qty),0)::BIGINT AS pending_qty,COALESCE(SUM(issued_value_paise),0)::BIGINT AS issued_value_paise,COALESCE(SUM(redeemed_value_paise),0)::BIGINT AS redeemed_value_paise,COALESCE(SUM(pending_value_paise),0)::BIGINT AS pending_value_paise FROM report_rows WHERE ($3='' OR status=$3) AND ($4='' OR client_name ILIKE '%'||$4||'%' OR contact ILIKE '%'||$4||'%' OR package_name ILIKE '%'||$4||'%' OR service_name ILIKE '%'||$4||'%') AND ($5::DATE IS NULL OR sold_at::DATE >= $5) AND ($6::DATE IS NULL OR sold_at::DATE <= $6)");
    sqlx::query_as::<_, PackageReportSummary>(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(status)
        .bind(search)
        .bind(from)
        .bind(to)
        .fetch_one(db)
        .await
}
