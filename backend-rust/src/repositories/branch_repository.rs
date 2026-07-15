use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchRecord {
    pub id: String,
    pub name: String,
    pub code: String,
    pub region_name: String,
    pub zone_name: String,
    pub cluster_name: String,
    pub address: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub booking_deposit_percent: i32,
    pub royalty_bps: i32,
    pub royalty_minimum_paise: i64,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

const BRANCH_COLUMNS: &str = r#"
    COALESCE(NULLIF(b.scope_id, ''), b.id::text) AS id,
    b.name,
    COALESCE(b.code, '') AS code,
    b.region_name,
    b.zone_name,
    b.cluster_name,
    b.address,
    b.latitude,
    b.longitude,
    b.booking_deposit_percent,
    b.royalty_bps,
    b.royalty_minimum_paise,
    b.active,
    b.created_at,
    b.updated_at
"#;

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FranchisePolicyRecord {
    pub central_branch_id: String,
    pub allowed_override_fields: Vec<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CentralServiceMasterRecord {
    pub id: String,
    pub name: String,
    pub category: String,
    pub duration_minutes: i32,
    pub price_paise: i64,
    pub active: bool,
    pub linked_branch_count: i64,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CentralProductMasterRecord {
    pub id: String,
    pub sku: String,
    pub name: String,
    pub category: String,
    pub active: bool,
    pub linked_branch_count: i64,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoyaltyStatementRecord {
    pub id: String,
    pub branch_id: String,
    pub branch_name: String,
    pub period_start: NaiveDate,
    pub gross_sales_paise: i64,
    pub royalty_bps: i32,
    pub minimum_paise: i64,
    pub royalty_paise: i64,
    pub status: String,
    pub journal_entry_id: Option<String>,
    pub payment_journal_entry_id: Option<String>,
    pub paid_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct RoyaltyRuleInput {
    pub branch_id: String,
    pub royalty_bps: i32,
    pub minimum_paise: i64,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchComparisonRecord {
    pub branch_id: String,
    pub branch_name: String,
    pub branch_code: String,
    pub region_name: String,
    pub zone_name: String,
    pub cluster_name: String,
    pub active: bool,
    pub revenue_paise: i64,
    pub sale_count: i64,
    pub appointment_count: i64,
    pub sharing_enabled: bool,
    pub accept_inbound: bool,
    pub service_sync_gap: i64,
    pub product_sync_gap: i64,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiBranchApprovalRecord {
    pub id: String,
    pub branch_id: String,
    pub action: String,
    pub status: String,
    pub note: String,
    pub decision_note: String,
    pub requested_by: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiBranchAuditRecord {
    pub id: String,
    pub branch_id: Option<String>,
    pub event_type: String,
    pub outcome: String,
    pub actor_user_id: Option<String>,
    pub details: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    query: &str,
) -> Result<Vec<BranchRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT {BRANCH_COLUMNS}
        FROM branches b
        JOIN tenants t ON t.id=b.tenant_id
        WHERE COALESCE(NULLIF(t.scope_id, ''), t.id::text)=$1
          AND ($2='' OR b.name ILIKE '%' || $2 || '%' OR COALESCE(b.code, '') ILIKE '%' || $2 || '%'
            OR b.region_name ILIKE '%' || $2 || '%' OR b.zone_name ILIKE '%' || $2 || '%'
            OR b.cluster_name ILIKE '%' || $2 || '%')
        ORDER BY b.active DESC, b.region_name, b.zone_name, b.cluster_name, b.name ASC
        LIMIT 500
        "#
    ))
    .bind(tenant_id)
    .bind(query)
    .fetch_all(db)
    .await
}

pub async fn lock_tenant(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT id::text FROM tenants WHERE COALESCE(NULLIF(scope_id, ''), id::text)=$1 AND status='active' FOR UPDATE",
    )
    .bind(tenant_id)
    .fetch_optional(&mut **tx)
    .await?
    .is_some())
}

pub async fn create(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    name: &str,
    code: &str,
    region_name: &str,
    zone_name: &str,
    cluster_name: &str,
    address: &str,
    latitude: Option<f64>,
    longitude: Option<f64>,
    booking_deposit_percent: i32,
) -> Result<Option<BranchRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO branches (
          tenant_id, name, code, region_name, zone_name, cluster_name,
          address, latitude, longitude, booking_deposit_percent, active, scope_id
        )
        SELECT t.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, gen_random_uuid()::text
        FROM tenants t
        WHERE COALESCE(NULLIF(t.scope_id, ''), t.id::text)=$1 AND t.status='active'
        RETURNING COALESCE(NULLIF(scope_id, ''), id::text) AS id,
                  name, COALESCE(code, '') AS code, region_name, zone_name, cluster_name,
                  address, latitude, longitude, booking_deposit_percent,
                  royalty_bps, royalty_minimum_paise,
                  active, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(name)
    .bind(code)
    .bind(region_name)
    .bind(zone_name)
    .bind(cluster_name)
    .bind(address)
    .bind(latitude)
    .bind(longitude)
    .bind(booking_deposit_percent)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn grant_management_access(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO user_branch_roles (
          tenant_id, user_id, branch_id, role_id, role_name, is_default, active
        )
        SELECT u.tenant_id, u.id, $2, r.id, r.name,
               NOT EXISTS (
                 SELECT 1 FROM user_branch_roles existing
                 WHERE existing.tenant_id=u.tenant_id
                   AND existing.user_id=u.id
                   AND existing.is_default=TRUE
                   AND existing.active=TRUE
               ),
               TRUE
        FROM users u
        JOIN roles r
          ON r.tenant_id=u.tenant_id
         AND (
           (u.role_id IS NOT NULL AND r.id=u.role_id)
           OR (u.role_id IS NULL AND LOWER(r.name)=LOWER(u.role_name))
         )
        WHERE u.tenant_id=$1
          AND u.active=TRUE
          AND REGEXP_REPLACE(LOWER(r.name), '[-_ ]', '', 'g') IN ('owner', 'admin', 'superadmin')
        ON CONFLICT (tenant_id, user_id, branch_id) DO UPDATE
        SET role_id=EXCLUDED.role_id,
            role_name=EXCLUDED.role_name,
            active=TRUE,
            updated_at=NOW()
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn get_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<BranchRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT {BRANCH_COLUMNS}
        FROM branches b
        JOIN tenants t ON t.id=b.tenant_id
        WHERE COALESCE(NULLIF(t.scope_id, ''), t.id::text)=$1
          AND COALESCE(NULLIF(b.scope_id, ''), b.id::text)=$2
        FOR UPDATE OF b
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn active_count(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM branches b
        JOIN tenants t ON t.id=b.tenant_id
        WHERE COALESCE(NULLIF(t.scope_id, ''), t.id::text)=$1 AND b.active=TRUE
        "#,
    )
    .bind(tenant_id)
    .fetch_one(&mut **tx)
    .await
}

pub async fn update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    name: &str,
    code: &str,
    region_name: &str,
    zone_name: &str,
    cluster_name: &str,
    address: &str,
    latitude: Option<f64>,
    longitude: Option<f64>,
    booking_deposit_percent: i32,
    active: bool,
) -> Result<Option<BranchRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE branches b
        SET name=$3, code=$4, region_name=$5, zone_name=$6, cluster_name=$7,
            address=$8, latitude=$9, longitude=$10, booking_deposit_percent=$11,
            active=$12, updated_at=NOW()
        FROM tenants t
        WHERE b.tenant_id=t.id
          AND COALESCE(NULLIF(t.scope_id, ''), t.id::text)=$1
          AND COALESCE(NULLIF(b.scope_id, ''), b.id::text)=$2
        RETURNING COALESCE(NULLIF(b.scope_id, ''), b.id::text) AS id,
                  b.name, COALESCE(b.code, '') AS code, b.region_name, b.zone_name,
                  b.cluster_name, b.address, b.latitude, b.longitude,
                  b.booking_deposit_percent, b.royalty_bps, b.royalty_minimum_paise,
                  b.active, b.created_at, b.updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(name)
    .bind(code)
    .bind(region_name)
    .bind(zone_name)
    .bind(cluster_name)
    .bind(address)
    .bind(latitude)
    .bind(longitude)
    .bind(booking_deposit_percent)
    .bind(active)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn franchise_policy(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Option<FranchisePolicyRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT central_branch_id,allowed_override_fields,updated_at FROM franchise_policies WHERE tenant_id=$1",
    )
    .bind(tenant_id)
    .fetch_optional(db)
    .await
}

pub async fn branch_in_tenant(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT EXISTS(
             SELECT 1 FROM branches b JOIN tenants t ON t.id=b.tenant_id
              WHERE COALESCE(NULLIF(t.scope_id,''),t.id::TEXT)=$1
                AND COALESCE(NULLIF(b.scope_id,''),b.id::TEXT)=$2 AND b.active=TRUE
           )"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(&mut **tx)
    .await
}

pub async fn save_franchise_policy(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    central_branch_id: &str,
    allowed_override_fields: &[String],
    actor: &str,
) -> Result<FranchisePolicyRecord, sqlx::Error> {
    sqlx::query(
        r#"UPDATE services SET central_master_service_id=NULL,updated_at=NOW()
            WHERE tenant_id=$1 AND central_master_service_id IS NOT NULL
              AND EXISTS(SELECT 1 FROM franchise_policies WHERE tenant_id=$1 AND central_branch_id<>$2)"#,
    )
    .bind(tenant_id)
    .bind(central_branch_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        r#"UPDATE inventory_items SET central_master_item_id=NULL,updated_at=NOW()
            WHERE tenant_id=$1 AND central_master_item_id IS NOT NULL
              AND EXISTS(SELECT 1 FROM franchise_policies WHERE tenant_id=$1 AND central_branch_id<>$2)"#,
    )
    .bind(tenant_id)
    .bind(central_branch_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query_as(
        r#"INSERT INTO franchise_policies(
             tenant_id,central_branch_id,allowed_override_fields,created_by,updated_by
           ) VALUES($1,$2,$3,$4,$4)
           ON CONFLICT(tenant_id) DO UPDATE SET
             central_branch_id=EXCLUDED.central_branch_id,
             allowed_override_fields=EXCLUDED.allowed_override_fields,
             updated_by=EXCLUDED.updated_by,updated_at=NOW()
           RETURNING central_branch_id,allowed_override_fields,updated_at"#,
    )
    .bind(tenant_id)
    .bind(central_branch_id)
    .bind(allowed_override_fields)
    .bind(actor)
    .fetch_one(&mut **tx)
    .await
}

pub async fn save_royalty_rules(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    rules: &[RoyaltyRuleInput],
) -> Result<u64, sqlx::Error> {
    let mut updated = 0;
    for rule in rules {
        updated += sqlx::query(
            r#"UPDATE branches b SET royalty_bps=$3,royalty_minimum_paise=$4,updated_at=NOW()
               FROM tenants t WHERE t.id=b.tenant_id
                 AND COALESCE(NULLIF(t.scope_id,''),t.id::TEXT)=$1
                 AND COALESCE(NULLIF(b.scope_id,''),b.id::TEXT)=$2"#,
        )
        .bind(tenant_id)
        .bind(&rule.branch_id)
        .bind(rule.royalty_bps)
        .bind(rule.minimum_paise)
        .execute(&mut **tx)
        .await?
        .rows_affected();
    }
    Ok(updated)
}

pub async fn central_service_masters(
    db: &PgPool,
    tenant_id: &str,
    central_branch_id: &str,
) -> Result<Vec<CentralServiceMasterRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT master.id,master.name,master.category,master.duration_minutes,
                  master.price_paise::BIGINT AS price_paise,master.active,
                  COUNT(linked.id)::BIGINT AS linked_branch_count
             FROM services master
             LEFT JOIN services linked ON linked.tenant_id=master.tenant_id
               AND linked.central_master_service_id=master.id
            WHERE master.tenant_id=$1 AND master.branch_id=$2
            GROUP BY master.id,master.name,master.category,master.duration_minutes,
                     master.price_paise,master.active
            ORDER BY master.active DESC,master.category,master.name"#,
    )
    .bind(tenant_id)
    .bind(central_branch_id)
    .fetch_all(db)
    .await
}

pub async fn central_product_masters(
    db: &PgPool,
    tenant_id: &str,
    central_branch_id: &str,
) -> Result<Vec<CentralProductMasterRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT master.id,master.sku,master.name,master.category,master.active,
                  COUNT(linked.id)::BIGINT AS linked_branch_count
             FROM inventory_items master
             LEFT JOIN inventory_items linked ON linked.tenant_id=master.tenant_id
               AND linked.central_master_item_id=master.id
            WHERE master.tenant_id=$1 AND master.branch_id=$2
            GROUP BY master.id,master.sku,master.name,master.category,master.active
            ORDER BY master.active DESC,master.category,master.name"#,
    )
    .bind(tenant_id)
    .bind(central_branch_id)
    .fetch_all(db)
    .await
}

pub async fn publish_central_services(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    central_branch_id: &str,
) -> Result<u64, sqlx::Error> {
    sqlx::query(
        r#"WITH candidates AS (
             SELECT target.id AS target_id,master.id AS master_id,
                    ROW_NUMBER() OVER(PARTITION BY target.branch_id,master.id ORDER BY target.created_at,target.id) AS position
               FROM services master
               JOIN services target ON target.tenant_id=master.tenant_id
                AND target.branch_id<>master.branch_id
                AND LOWER(target.name)=LOWER(master.name)
                AND target.central_master_service_id IS NULL
              WHERE master.tenant_id=$1 AND master.branch_id=$2
           )
           UPDATE services target SET central_master_service_id=candidate.master_id,updated_at=NOW()
             FROM candidates candidate
            WHERE target.id=candidate.target_id AND candidate.position=1"#,
    )
    .bind(tenant_id)
    .bind(central_branch_id)
    .execute(&mut **tx)
    .await?;

    let mut published = sqlx::query(
        r#"INSERT INTO services(
             tenant_id,branch_id,name,category,duration_minutes,price_paise,gst_percent,sac_code,
             wait_time_minutes,cleanup_time_minutes,buffer_time_minutes,product_consumption_json,
             active,central_master_service_id
           )
           SELECT $1,COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT),master.name,master.category,
                  master.duration_minutes,master.price_paise,master.gst_percent,master.sac_code,
                  master.wait_time_minutes,master.cleanup_time_minutes,master.buffer_time_minutes,
                  '[]'::JSONB,master.active,master.id
             FROM services master
             JOIN tenants tenant ON COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
             JOIN branches branch ON branch.tenant_id=tenant.id AND branch.active=TRUE
              AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)<>$2
            WHERE master.tenant_id=$1 AND master.branch_id=$2
           ON CONFLICT(tenant_id,branch_id,central_master_service_id)
             WHERE central_master_service_id IS NOT NULL
           DO UPDATE SET
             name=CASE WHEN 'name'=ANY(services.franchise_override_fields) THEN services.name ELSE EXCLUDED.name END,
             category=CASE WHEN 'category'=ANY(services.franchise_override_fields) THEN services.category ELSE EXCLUDED.category END,
             duration_minutes=CASE WHEN 'durationMinutes'=ANY(services.franchise_override_fields) THEN services.duration_minutes ELSE EXCLUDED.duration_minutes END,
             price_paise=CASE WHEN 'pricePaise'=ANY(services.franchise_override_fields) THEN services.price_paise ELSE EXCLUDED.price_paise END,
             gst_percent=CASE WHEN 'gstPercent'=ANY(services.franchise_override_fields) THEN services.gst_percent ELSE EXCLUDED.gst_percent END,
             sac_code=CASE WHEN 'sacCode'=ANY(services.franchise_override_fields) THEN services.sac_code ELSE EXCLUDED.sac_code END,
             wait_time_minutes=CASE WHEN 'waitTimeMinutes'=ANY(services.franchise_override_fields) THEN services.wait_time_minutes ELSE EXCLUDED.wait_time_minutes END,
             cleanup_time_minutes=CASE WHEN 'cleanupTimeMinutes'=ANY(services.franchise_override_fields) THEN services.cleanup_time_minutes ELSE EXCLUDED.cleanup_time_minutes END,
             buffer_time_minutes=CASE WHEN 'bufferTimeMinutes'=ANY(services.franchise_override_fields) THEN services.buffer_time_minutes ELSE EXCLUDED.buffer_time_minutes END,
             active=CASE WHEN 'active'=ANY(services.franchise_override_fields) THEN services.active ELSE EXCLUDED.active END,
             updated_at=NOW()"#,
    )
    .bind(tenant_id)
    .bind(central_branch_id)
    .execute(&mut **tx)
    .await?
    .rows_affected();

    sqlx::query(
        r#"WITH candidates AS (
             SELECT target.id AS target_id,master.id AS master_id,
                    ROW_NUMBER() OVER(PARTITION BY target.branch_id,master.id ORDER BY target.created_at,target.id) AS position
               FROM inventory_items master
               JOIN inventory_items target ON target.tenant_id=master.tenant_id
                AND target.branch_id<>master.branch_id AND target.central_master_item_id IS NULL
                AND ((TRIM(master.sku)<>'' AND LOWER(TRIM(target.sku))=LOWER(TRIM(master.sku)))
                  OR (TRIM(master.sku)='' AND LOWER(target.name)=LOWER(master.name)))
              WHERE master.tenant_id=$1 AND master.branch_id=$2
           )
           UPDATE inventory_items target SET central_master_item_id=candidate.master_id,updated_at=NOW()
             FROM candidates candidate
            WHERE target.id=candidate.target_id AND candidate.position=1"#,
    )
    .bind(tenant_id)
    .bind(central_branch_id)
    .execute(&mut **tx)
    .await?;

    published += sqlx::query(
        r#"INSERT INTO inventory_items(
             tenant_id,branch_id,sku,name,category,unit,stock_quantity,reorder_point,
             unit_cost_paise,hsn_code,gst_percent,barcode,batch_tracked,active,central_master_item_id
           )
           SELECT $1,COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT),master.sku,master.name,
                  master.category,master.unit,0,0,0,master.hsn_code,master.gst_percent,
                  master.barcode,master.batch_tracked,master.active,master.id
             FROM inventory_items master
             JOIN tenants tenant ON COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
             JOIN branches branch ON branch.tenant_id=tenant.id AND branch.active=TRUE
              AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)<>$2
            WHERE master.tenant_id=$1 AND master.branch_id=$2
           ON CONFLICT(tenant_id,branch_id,central_master_item_id)
             WHERE central_master_item_id IS NOT NULL
           DO UPDATE SET sku=EXCLUDED.sku,name=EXCLUDED.name,category=EXCLUDED.category,
             unit=EXCLUDED.unit,hsn_code=EXCLUDED.hsn_code,gst_percent=EXCLUDED.gst_percent,
             barcode=EXCLUDED.barcode,batch_tracked=EXCLUDED.batch_tracked,active=EXCLUDED.active,
             updated_at=NOW()"#,
    )
    .bind(tenant_id)
    .bind(central_branch_id)
    .execute(&mut **tx)
    .await?
    .rows_affected();

    Ok(published)
}

pub async fn royalty_statements(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Vec<RoyaltyStatementRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT statement.id,statement.branch_id,COALESCE(branch.name,statement.branch_id) AS branch_name,
                  statement.period_start,statement.gross_sales_paise,statement.royalty_bps,
                  statement.minimum_paise,statement.royalty_paise,statement.status,
                  statement.journal_entry_id,statement.payment_journal_entry_id,
                  statement.paid_at,statement.created_at
             FROM franchise_royalty_statements statement
             LEFT JOIN tenants tenant ON COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=statement.tenant_id
             LEFT JOIN branches branch ON branch.tenant_id=tenant.id
              AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=statement.branch_id
            WHERE statement.tenant_id=$1
            ORDER BY statement.period_start DESC,branch.name,statement.id LIMIT 240"#,
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
}

pub async fn create_royalty_drafts(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    period_start: NaiveDate,
    actor: &str,
) -> Result<Vec<RoyaltyStatementRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH totals AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name,branch.royalty_bps,branch.royalty_minimum_paise,
                    COALESCE(SUM(sale.total_paise) FILTER(
                      WHERE sale.status NOT IN ('draft','open','voided','cancelled','refunded')
                    ),0)::BIGINT AS gross_sales_paise
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
               LEFT JOIN pos_sales sale ON sale.tenant_id=$1
                AND sale.branch_id=COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)
                AND (COALESCE(sale.finalized_at,sale.created_at) AT TIME ZONE 'Asia/Kolkata')::DATE >= $2
                AND (COALESCE(sale.finalized_at,sale.created_at) AT TIME ZONE 'Asia/Kolkata')::DATE < ($2 + INTERVAL '1 month')::DATE
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1 AND branch.active=TRUE
                AND (branch.royalty_bps>0 OR branch.royalty_minimum_paise>0)
              GROUP BY branch.id,branch.scope_id,branch.name,branch.royalty_bps,branch.royalty_minimum_paise
           ), inserted AS (
             INSERT INTO franchise_royalty_statements(
               tenant_id,branch_id,period_start,gross_sales_paise,royalty_bps,minimum_paise,
               royalty_paise,status,created_by
             )
             SELECT $1,branch_id,$2,gross_sales_paise,royalty_bps,royalty_minimum_paise,
                    GREATEST(ROUND(gross_sales_paise::NUMERIC*royalty_bps/10000)::BIGINT,royalty_minimum_paise),
                    'draft',$3 FROM totals
              WHERE GREATEST(ROUND(gross_sales_paise::NUMERIC*royalty_bps/10000)::BIGINT,royalty_minimum_paise)>0
             ON CONFLICT(tenant_id,branch_id,period_start) DO NOTHING
             RETURNING *
           )
           SELECT inserted.id,inserted.branch_id,totals.name AS branch_name,inserted.period_start,
                  inserted.gross_sales_paise,inserted.royalty_bps,inserted.minimum_paise,
                  inserted.royalty_paise,inserted.status,inserted.journal_entry_id,
                  inserted.payment_journal_entry_id,inserted.paid_at,inserted.created_at
             FROM inserted JOIN totals ON totals.branch_id=inserted.branch_id
            ORDER BY totals.name,inserted.id"#,
    )
    .bind(tenant_id)
    .bind(period_start)
    .bind(actor)
    .fetch_all(&mut **tx)
    .await
}

pub async fn mark_royalty_posted(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    id: &str,
    journal_entry_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE franchise_royalty_statements SET status='posted',journal_entry_id=$3,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND status='draft'")
        .bind(tenant_id).bind(id).bind(journal_entry_id).execute(&mut **tx).await?;
    Ok(())
}

pub async fn royalty_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    id: &str,
) -> Result<Option<RoyaltyStatementRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT statement.id,statement.branch_id,COALESCE(branch.name,statement.branch_id) AS branch_name,
                  statement.period_start,statement.gross_sales_paise,statement.royalty_bps,
                  statement.minimum_paise,statement.royalty_paise,statement.status,
                  statement.journal_entry_id,statement.payment_journal_entry_id,
                  statement.paid_at,statement.created_at
             FROM franchise_royalty_statements statement
             LEFT JOIN tenants tenant ON COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=statement.tenant_id
             LEFT JOIN branches branch ON branch.tenant_id=tenant.id
              AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=statement.branch_id
            WHERE statement.tenant_id=$1 AND statement.id=$2 FOR UPDATE OF statement"#,
    )
    .bind(tenant_id)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn mark_royalty_paid(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    id: &str,
    payment_journal_entry_id: &str,
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE franchise_royalty_statements SET status='paid',payment_journal_entry_id=$3,paid_by=$4,paid_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND status='posted'")
        .bind(tenant_id).bind(id).bind(payment_journal_entry_id).bind(actor).execute(&mut **tx).await?;
    Ok(())
}

pub async fn branch_comparison(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Vec<BranchComparisonRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH scoped_branches AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name,COALESCE(branch.code,'') AS branch_code,
                    branch.region_name,branch.zone_name,branch.cluster_name,branch.active
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
           )
           SELECT branch.branch_id,branch.branch_name,branch.branch_code,
                  branch.region_name,branch.zone_name,branch.cluster_name,branch.active,
                  COALESCE((SELECT SUM(sale.total_paise) FROM pos_sales sale
                             WHERE sale.tenant_id=$1 AND sale.branch_id=branch.branch_id
                               AND sale.status NOT IN ('draft','open','voided','cancelled','refunded')
                               AND COALESCE(sale.finalized_at,sale.created_at)>=NOW()-INTERVAL '30 days'),0)::BIGINT AS revenue_paise,
                  COALESCE((SELECT COUNT(*) FROM pos_sales sale
                             WHERE sale.tenant_id=$1 AND sale.branch_id=branch.branch_id
                               AND sale.status NOT IN ('draft','open','voided','cancelled','refunded')
                               AND COALESCE(sale.finalized_at,sale.created_at)>=NOW()-INTERVAL '30 days'),0)::BIGINT AS sale_count,
                  COALESCE((SELECT COUNT(*) FROM appointments appointment
                             WHERE appointment.tenant_id=$1 AND appointment.branch_id=branch.branch_id
                               AND appointment.status NOT IN ('cancelled','canceled','void','no_show')
                               AND appointment.start_at>=NOW()-INTERVAL '30 days'),0)::BIGINT AS appointment_count,
                  COALESCE((SELECT (settings.settings_json#>>'{crossLocation,enabled}')::BOOLEAN
                              FROM membership_settings settings
                             WHERE settings.tenant_id=$1 AND settings.branch_id=branch.branch_id),FALSE) AS sharing_enabled,
                  COALESCE((SELECT (settings.settings_json#>>'{crossLocation,acceptInbound}')::BOOLEAN
                              FROM membership_settings settings
                             WHERE settings.tenant_id=$1 AND settings.branch_id=branch.branch_id),FALSE) AS accept_inbound,
                  CASE WHEN policy.central_branch_id IS NULL OR branch.branch_id=policy.central_branch_id THEN 0 ELSE
                    (SELECT COUNT(*) FROM services master
                      WHERE master.tenant_id=$1 AND master.branch_id=policy.central_branch_id
                        AND NOT EXISTS(SELECT 1 FROM services linked WHERE linked.tenant_id=$1
                          AND linked.branch_id=branch.branch_id AND linked.central_master_service_id=master.id))
                  END::BIGINT AS service_sync_gap,
                  CASE WHEN policy.central_branch_id IS NULL OR branch.branch_id=policy.central_branch_id THEN 0 ELSE
                    (SELECT COUNT(*) FROM inventory_items master
                      WHERE master.tenant_id=$1 AND master.branch_id=policy.central_branch_id
                        AND NOT EXISTS(SELECT 1 FROM inventory_items linked WHERE linked.tenant_id=$1
                          AND linked.branch_id=branch.branch_id AND linked.central_master_item_id=master.id))
                  END::BIGINT AS product_sync_gap
             FROM scoped_branches branch
             LEFT JOIN franchise_policies policy ON policy.tenant_id=$1
            ORDER BY branch.active DESC,branch.branch_name,branch.branch_id"#,
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
}

pub async fn multi_branch_approvals(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Vec<MultiBranchApprovalRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,branch_id,action,status,note,decision_note,requested_by,decided_by,
                  decided_at,version,created_at,updated_at
             FROM multi_branch_approvals WHERE tenant_id=$1
            ORDER BY (status='pending') DESC,created_at DESC,id LIMIT 200"#,
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
}

pub async fn create_multi_branch_approval(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    note: &str,
) -> Result<MultiBranchApprovalRecord, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO multi_branch_approvals(tenant_id,branch_id,action,note,requested_by)
           VALUES($1,$2,'publish_central_masters',$3,$4)
           RETURNING id,branch_id,action,status,note,decision_note,requested_by,decided_by,
                     decided_at,version,created_at,updated_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(note)
    .bind(actor)
    .fetch_one(&mut **tx)
    .await
}

pub async fn multi_branch_approval_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    id: &str,
) -> Result<Option<MultiBranchApprovalRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,branch_id,action,status,note,decision_note,requested_by,decided_by,
                  decided_at,version,created_at,updated_at
             FROM multi_branch_approvals WHERE tenant_id=$1 AND id=$2 FOR UPDATE"#,
    )
    .bind(tenant_id)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn decide_multi_branch_approval(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    id: &str,
    version: i32,
    decision: &str,
    actor: &str,
    note: &str,
) -> Result<Option<MultiBranchApprovalRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"UPDATE multi_branch_approvals
              SET status=$4,decision_note=$6,decided_by=$5,decided_at=NOW(),
                  version=version+1,updated_at=NOW()
            WHERE tenant_id=$1 AND id=$2 AND version=$3 AND status='pending'
        RETURNING id,branch_id,action,status,note,decision_note,requested_by,decided_by,
                  decided_at,version,created_at,updated_at"#,
    )
    .bind(tenant_id)
    .bind(id)
    .bind(version)
    .bind(decision)
    .bind(actor)
    .bind(note)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn franchise_policy_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
) -> Result<Option<FranchisePolicyRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT central_branch_id,allowed_override_fields,updated_at FROM franchise_policies WHERE tenant_id=$1 FOR UPDATE",
    )
    .bind(tenant_id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn audit_multi_branch(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    session_id: Option<&str>,
    event_type: &str,
    details: serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO auth_audit_logs(
             tenant_id,user_id,session_id,branch_id,event_type,outcome,details_json
           ) VALUES($1,$2,$3,$4,$5,'success',$6)"#,
    )
    .bind(tenant_id)
    .bind(actor)
    .bind(session_id)
    .bind(branch_id)
    .bind(event_type)
    .bind(details)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn multi_branch_audit(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Vec<MultiBranchAuditRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,branch_id,event_type,outcome,user_id AS actor_user_id,
                  details_json AS details,created_at
             FROM auth_audit_logs
            WHERE tenant_id=$1 AND event_type LIKE 'multi_branch.%'
            ORDER BY created_at DESC,id LIMIT 200"#,
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
}
