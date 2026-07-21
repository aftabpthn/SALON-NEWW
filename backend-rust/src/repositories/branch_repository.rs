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
    pub discount_paise: i64,
    pub tax_paise: i64,
    pub refund_paise: i64,
    pub tip_paise: i64,
    pub average_ticket_paise: i64,
    pub sale_count: i64,
    pub appointment_count: i64,
    pub lost_appointment_count: i64,
    pub booked_minutes: i64,
    pub scheduled_minutes: i64,
    pub utilization_bps: i64,
    pub void_count: i64,
    pub cash_variance_paise: i64,
    pub open_till_count: i64,
    pub transfer_count: i64,
    pub shortage_count: i64,
    pub inventory_value_paise: i64,
    pub membership_liability_paise: i64,
    pub membership_redeemed_paise: i64,
    pub cross_location_redeemed_paise: i64,
    pub gift_card_liability_paise: i64,
    pub loyalty_points_balance: i64,
    pub shared_customer_count: i64,
    pub royalty_outstanding_paise: i64,
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

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterBranchSettlementRecord {
    pub id: String,
    pub branch_id: String,
    pub redemption_branch_id: String,
    pub redemption_id: String,
    pub amount_paise: i64,
    pub status: String,
    pub version: i32,
    pub payment_method: String,
    pub settlement_reference: String,
    pub source_accrual_journal_id: String,
    pub target_accrual_journal_id: String,
    pub source_payment_journal_id: String,
    pub target_payment_journal_id: String,
    pub settled_by_user_id: String,
    pub settled_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct InterBranchRedemptionRecord {
    pub id: String,
    pub source_branch_id: String,
    pub redemption_branch_id: String,
    pub amount_paise: i64,
    pub business_date: NaiveDate,
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

pub async fn accessible_branch_ids(
    db: &PgPool,
    tenant_id: &str,
    actor_user_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT DISTINCT branch_id FROM user_branch_roles
            WHERE tenant_id=$1 AND user_id=$2 AND active=TRUE
              AND (access_type='permanent' OR CURRENT_DATE BETWEEN valid_from AND valid_until)"#,
    )
    .bind(tenant_id)
    .bind(actor_user_id)
    .fetch_all(db)
    .await
}

pub async fn has_assigned_branch_access(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    actor_user_id: &str,
    branch_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM user_branch_roles WHERE tenant_id=$1 AND user_id=$2
            AND branch_id=$3 AND active=TRUE AND (access_type='permanent'
              OR CURRENT_DATE BETWEEN valid_from AND valid_until))"#,
    )
    .bind(tenant_id)
    .bind(actor_user_id)
    .bind(branch_id)
    .fetch_one(&mut **tx)
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
           DO UPDATE SET
             sku=CASE WHEN 'sku'=ANY(inventory_items.franchise_override_fields) THEN inventory_items.sku ELSE EXCLUDED.sku END,
             name=CASE WHEN 'name'=ANY(inventory_items.franchise_override_fields) THEN inventory_items.name ELSE EXCLUDED.name END,
             category=CASE WHEN 'category'=ANY(inventory_items.franchise_override_fields) THEN inventory_items.category ELSE EXCLUDED.category END,
             unit=CASE WHEN 'unit'=ANY(inventory_items.franchise_override_fields) THEN inventory_items.unit ELSE EXCLUDED.unit END,
             hsn_code=CASE WHEN 'hsnCode'=ANY(inventory_items.franchise_override_fields) THEN inventory_items.hsn_code ELSE EXCLUDED.hsn_code END,
             gst_percent=CASE WHEN 'gstPercent'=ANY(inventory_items.franchise_override_fields) THEN inventory_items.gst_percent ELSE EXCLUDED.gst_percent END,
             barcode=CASE WHEN 'barcode'=ANY(inventory_items.franchise_override_fields) THEN inventory_items.barcode ELSE EXCLUDED.barcode END,
             batch_tracked=CASE WHEN 'batchTracked'=ANY(inventory_items.franchise_override_fields) THEN inventory_items.batch_tracked ELSE EXCLUDED.batch_tracked END,
             active=CASE WHEN 'active'=ANY(inventory_items.franchise_override_fields) THEN inventory_items.active ELSE EXCLUDED.active END,
             updated_at=NOW()"#,
    )
    .bind(tenant_id)
    .bind(central_branch_id)
    .execute(&mut **tx)
    .await?
    .rows_affected();

    Ok(published)
}

pub async fn central_sync_gap_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    central_branch_id: &str,
) -> Result<(i64, i64), sqlx::Error> {
    sqlx::query_as(
        r#"WITH targets AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id
               FROM branches branch JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
                AND branch.active=TRUE
                AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)<>$2
           )
           SELECT
             (SELECT COUNT(*)::BIGINT FROM targets target CROSS JOIN services master
               LEFT JOIN services linked ON linked.tenant_id=$1 AND linked.branch_id=target.branch_id
                AND linked.central_master_service_id=master.id
               WHERE master.tenant_id=$1 AND master.branch_id=$2 AND (linked.id IS NULL
                 OR (NOT ('name'=ANY(linked.franchise_override_fields)) AND linked.name<>master.name)
                 OR (NOT ('category'=ANY(linked.franchise_override_fields)) AND linked.category<>master.category)
                 OR (NOT ('durationMinutes'=ANY(linked.franchise_override_fields)) AND linked.duration_minutes<>master.duration_minutes)
                 OR (NOT ('pricePaise'=ANY(linked.franchise_override_fields)) AND linked.price_paise<>master.price_paise)
                 OR (NOT ('gstPercent'=ANY(linked.franchise_override_fields)) AND linked.gst_percent<>master.gst_percent)
                 OR (NOT ('sacCode'=ANY(linked.franchise_override_fields)) AND linked.sac_code<>master.sac_code)
                 OR (NOT ('waitTimeMinutes'=ANY(linked.franchise_override_fields)) AND linked.wait_time_minutes<>master.wait_time_minutes)
                 OR (NOT ('cleanupTimeMinutes'=ANY(linked.franchise_override_fields)) AND linked.cleanup_time_minutes<>master.cleanup_time_minutes)
                 OR (NOT ('bufferTimeMinutes'=ANY(linked.franchise_override_fields)) AND linked.buffer_time_minutes<>master.buffer_time_minutes)
                 OR (NOT ('active'=ANY(linked.franchise_override_fields)) AND linked.active<>master.active))) AS service_gap,
             (SELECT COUNT(*)::BIGINT FROM targets target CROSS JOIN inventory_items master
               LEFT JOIN inventory_items linked ON linked.tenant_id=$1 AND linked.branch_id=target.branch_id
                AND linked.central_master_item_id=master.id
               WHERE master.tenant_id=$1 AND master.branch_id=$2 AND (linked.id IS NULL
                 OR (NOT ('sku'=ANY(linked.franchise_override_fields)) AND linked.sku<>master.sku)
                 OR (NOT ('name'=ANY(linked.franchise_override_fields)) AND linked.name<>master.name)
                 OR (NOT ('category'=ANY(linked.franchise_override_fields)) AND linked.category<>master.category)
                 OR (NOT ('unit'=ANY(linked.franchise_override_fields)) AND linked.unit<>master.unit)
                 OR (NOT ('hsnCode'=ANY(linked.franchise_override_fields)) AND linked.hsn_code<>master.hsn_code)
                 OR (NOT ('gstPercent'=ANY(linked.franchise_override_fields)) AND linked.gst_percent<>master.gst_percent)
                 OR (NOT ('barcode'=ANY(linked.franchise_override_fields)) AND linked.barcode<>master.barcode)
                 OR (NOT ('batchTracked'=ANY(linked.franchise_override_fields)) AND linked.batch_tracked<>master.batch_tracked)
                 OR (NOT ('active'=ANY(linked.franchise_override_fields)) AND linked.active<>master.active))) AS product_gap"#,
    )
    .bind(tenant_id)
    .bind(central_branch_id)
    .fetch_one(&mut **tx)
    .await
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
    start_date: NaiveDate,
    end_date: NaiveDate,
    region: &str,
    zone: &str,
    cluster: &str,
    branch_id: &str,
    actor_user_id: &str,
    unrestricted: bool,
) -> Result<Vec<BranchComparisonRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH scoped_branches AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name,COALESCE(branch.code,'') AS branch_code,
                    branch.region_name,branch.zone_name,branch.cluster_name,branch.active,
                    branch.royalty_bps,branch.royalty_minimum_paise
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
                AND ($4='' OR LOWER(branch.region_name)=LOWER($4))
                AND ($5='' OR LOWER(branch.zone_name)=LOWER($5))
                AND ($6='' OR LOWER(branch.cluster_name)=LOWER($6))
                AND ($7='' OR COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=$7
                  OR LOWER(COALESCE(branch.code,''))=LOWER($7))
                AND ($9 OR EXISTS(
                  SELECT 1 FROM user_branch_roles access
                   WHERE access.tenant_id=$1 AND access.user_id=$8 AND access.active=TRUE
                     AND access.branch_id=COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)
                     AND (access.access_type='permanent' OR
                       (CURRENT_DATE BETWEEN access.valid_from AND access.valid_until))))
           ), sales AS (
             SELECT sale.branch_id,
                    COALESCE(SUM(sale.total_paise),0)::BIGINT AS revenue_paise,
                    COALESCE(SUM(sale.discount_paise),0)::BIGINT AS discount_paise,
                    COALESCE(SUM(sale.tax_paise),0)::BIGINT AS tax_paise,
                    COALESCE(SUM(sale.tip_paise),0)::BIGINT AS tip_paise,
                    COUNT(*)::BIGINT AS sale_count
               FROM pos_sales sale
               JOIN scoped_branches branch ON branch.branch_id=sale.branch_id
              WHERE sale.tenant_id=$1
                AND sale.status NOT IN ('draft','open','voided','cancelled','refunded')
                AND COALESCE(sale.finalized_at,sale.created_at)>=$2
                AND COALESCE(sale.finalized_at,sale.created_at)<$3::DATE+INTERVAL '1 day'
              GROUP BY sale.branch_id
           ), refunds AS (
             SELECT refund.branch_id,COALESCE(SUM(refund.amount_paise),0)::BIGINT AS refund_paise
               FROM pos_invoice_refunds refund
               JOIN scoped_branches branch ON branch.branch_id=refund.branch_id
              WHERE refund.tenant_id=$1 AND refund.created_at>=$2
                AND refund.created_at<$3::DATE+INTERVAL '1 day'
              GROUP BY refund.branch_id
           ), voids AS (
             SELECT void.branch_id,COUNT(*)::BIGINT AS void_count
               FROM pos_invoice_voids void
               JOIN scoped_branches branch ON branch.branch_id=void.branch_id
              WHERE void.tenant_id=$1 AND void.created_at>=$2
                AND void.created_at<$3::DATE+INTERVAL '1 day'
              GROUP BY void.branch_id
           ), appointment_metrics AS (
             SELECT appointment.branch_id,
                    COUNT(*) FILTER (WHERE appointment.status NOT IN ('cancelled','canceled','void','no_show'))::BIGINT AS appointment_count,
                    COUNT(*) FILTER (WHERE appointment.status IN ('cancelled','canceled','void','no_show'))::BIGINT AS lost_appointment_count,
                    COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60,0))
                      FILTER (WHERE appointment.status NOT IN ('cancelled','canceled','void','no_show')),0)::BIGINT AS booked_minutes
               FROM appointments appointment
               JOIN scoped_branches branch ON branch.branch_id=appointment.branch_id
              WHERE appointment.tenant_id=$1
                AND appointment.start_at>=$2
                AND appointment.start_at<$3::DATE+INTERVAL '1 day'
              GROUP BY appointment.branch_id
           ), schedule_metrics AS (
             SELECT schedule.branch_id,
                    COALESCE(SUM(
                      COALESCE(EXTRACT(EPOCH FROM (schedule.shift1_end-schedule.shift1_start))::BIGINT/60,0)
                      + COALESCE(EXTRACT(EPOCH FROM (schedule.shift2_end-schedule.shift2_start))::BIGINT/60,0)
                    ),0)::BIGINT AS scheduled_minutes
               FROM staff_schedules schedule
               JOIN scoped_branches branch ON branch.branch_id=schedule.branch_id
              WHERE schedule.tenant_id=$1 AND schedule.schedule_date BETWEEN $2 AND $3
                AND schedule.status='working'
              GROUP BY schedule.branch_id
           ), inventory_value AS (
             SELECT item.branch_id,
                    COALESCE(SUM(GREATEST(item.stock_quantity,0)::BIGINT*GREATEST(item.unit_cost_paise,0)),0)::BIGINT AS inventory_value_paise
               FROM inventory_items item
               JOIN scoped_branches branch ON branch.branch_id=item.branch_id
              WHERE item.tenant_id=$1 AND item.active=TRUE
              GROUP BY item.branch_id
           ), shortages AS (
             SELECT item.branch_id,COUNT(*)::BIGINT AS shortage_count
               FROM inventory_items item
               JOIN scoped_branches branch ON branch.branch_id=item.branch_id
              WHERE item.tenant_id=$1 AND item.active=TRUE
                AND item.stock_quantity<=item.reorder_point
              GROUP BY item.branch_id
           ), transfers AS (
             SELECT branch.branch_id,COUNT(DISTINCT transfer.id)::BIGINT AS transfer_count
               FROM scoped_branches branch
               JOIN inventory_transfers transfer ON transfer.tenant_id=$1
                AND (transfer.source_branch_id=branch.branch_id OR transfer.destination_branch_id=branch.branch_id)
              WHERE transfer.created_at>=$2 AND transfer.created_at<$3::DATE+INTERVAL '1 day'
                AND transfer.status<>'cancelled'
              GROUP BY branch.branch_id
           ), cash_controls AS (
             SELECT till.branch_id,
                    COALESCE(SUM(till.variance_paise) FILTER (WHERE till.status='closed'),0)::BIGINT AS cash_variance_paise,
                    COUNT(*) FILTER (WHERE till.status<>'closed')::BIGINT AS open_till_count
               FROM cash_drawer_tills till
               JOIN scoped_branches branch ON branch.branch_id=till.branch_id
              WHERE till.tenant_id=$1 AND till.opened_at>=$2
                AND till.opened_at<$3::DATE+INTERVAL '1 day'
              GROUP BY till.branch_id
           ), membership_liability AS (
             SELECT credit.branch_id,
                    COALESCE(SUM(GREATEST(credit.remaining_qty,0)::BIGINT*GREATEST(credit.unit_value_paise,0)),0)::BIGINT AS membership_liability_paise
               FROM client_membership_credits credit
               JOIN scoped_branches branch ON branch.branch_id=credit.branch_id
              WHERE credit.tenant_id=$1 AND credit.active=TRUE
              GROUP BY credit.branch_id
           ), membership_redemptions AS (
             SELECT redemption.branch_id,
                    COALESCE(SUM(redemption.quantity::BIGINT*credit.unit_value_paise),0)::BIGINT AS membership_redeemed_paise,
                    COALESCE(SUM(redemption.quantity::BIGINT*credit.unit_value_paise)
                      FILTER (WHERE credit.branch_id<>redemption.branch_id),0)::BIGINT AS cross_location_redeemed_paise
               FROM pos_membership_redemptions redemption
               JOIN client_membership_credits credit ON credit.id=redemption.client_membership_credit_id
                AND credit.tenant_id=redemption.tenant_id
               JOIN scoped_branches branch ON branch.branch_id=redemption.branch_id
              WHERE redemption.tenant_id=$1 AND redemption.created_at>=$2
                AND redemption.created_at<$3::DATE+INTERVAL '1 day'
              GROUP BY redemption.branch_id
           ), gift_liability AS (
             SELECT card.branch_id,COALESCE(SUM(card.balance_paise),0)::BIGINT AS gift_card_liability_paise
               FROM gift_cards card JOIN scoped_branches branch ON branch.branch_id=card.branch_id
              WHERE card.tenant_id=$1 AND card.status='active' GROUP BY card.branch_id
           ), loyalty_liability AS (
             SELECT latest.branch_id,COALESCE(SUM(latest.balance_after),0)::BIGINT AS loyalty_points_balance
               FROM (SELECT DISTINCT ON (ledger.branch_id,ledger.client_id)
                            ledger.branch_id,ledger.client_id,ledger.balance_after
                       FROM membership_reward_ledger ledger
                       JOIN scoped_branches branch ON branch.branch_id=ledger.branch_id
                      WHERE ledger.tenant_id=$1
                      ORDER BY ledger.branch_id,ledger.client_id,ledger.created_at DESC,ledger.id DESC) latest
              GROUP BY latest.branch_id
           ), shared_customers AS (
             SELECT link.branch_id,COUNT(DISTINCT link.account_id)::BIGINT AS shared_customer_count
               FROM customer_account_clients link
               JOIN scoped_branches branch ON branch.branch_id=link.branch_id
              WHERE link.tenant_id=$1 AND EXISTS(
                SELECT 1 FROM customer_account_clients other
                 WHERE other.account_id=link.account_id AND other.tenant_id=link.tenant_id
                   AND other.branch_id<>link.branch_id)
              GROUP BY link.branch_id
           ), royalty_liability AS (
             SELECT statement.branch_id,
                    COALESCE(SUM(statement.royalty_paise),0)::BIGINT AS royalty_outstanding_paise
               FROM franchise_royalty_statements statement
               JOIN scoped_branches branch ON branch.branch_id=statement.branch_id
              WHERE statement.tenant_id=$1 AND statement.status<>'paid'
              GROUP BY statement.branch_id
           )
           SELECT branch.branch_id,branch.branch_name,branch.branch_code,
                  branch.region_name,branch.zone_name,branch.cluster_name,branch.active,
                  COALESCE(sales.revenue_paise,0) AS revenue_paise,
                  COALESCE(sales.discount_paise,0) AS discount_paise,
                  COALESCE(sales.tax_paise,0) AS tax_paise,
                  COALESCE(refunds.refund_paise,0) AS refund_paise,
                  COALESCE(sales.tip_paise,0) AS tip_paise,
                  CASE WHEN COALESCE(sales.sale_count,0)=0 THEN 0
                    ELSE sales.revenue_paise/sales.sale_count END::BIGINT AS average_ticket_paise,
                  COALESCE(sales.sale_count,0) AS sale_count,
                  COALESCE(appointment_metrics.appointment_count,0) AS appointment_count,
                  COALESCE(appointment_metrics.lost_appointment_count,0) AS lost_appointment_count,
                  COALESCE(appointment_metrics.booked_minutes,0) AS booked_minutes,
                  COALESCE(schedule_metrics.scheduled_minutes,0) AS scheduled_minutes,
                  CASE WHEN COALESCE(schedule_metrics.scheduled_minutes,0)=0 THEN 0 ELSE
                    LEAST(10000,COALESCE(appointment_metrics.booked_minutes,0)*10000/schedule_metrics.scheduled_minutes)
                  END::BIGINT AS utilization_bps,
                  COALESCE(voids.void_count,0) AS void_count,
                  COALESCE(cash_controls.cash_variance_paise,0) AS cash_variance_paise,
                  COALESCE(cash_controls.open_till_count,0) AS open_till_count,
                  COALESCE(transfers.transfer_count,0) AS transfer_count,
                  COALESCE(shortages.shortage_count,0) AS shortage_count,
                  COALESCE(inventory_value.inventory_value_paise,0) AS inventory_value_paise,
                  COALESCE(membership_liability.membership_liability_paise,0) AS membership_liability_paise,
                  COALESCE(membership_redemptions.membership_redeemed_paise,0) AS membership_redeemed_paise,
                  COALESCE(membership_redemptions.cross_location_redeemed_paise,0) AS cross_location_redeemed_paise,
                  COALESCE(gift_liability.gift_card_liability_paise,0) AS gift_card_liability_paise,
                  COALESCE(loyalty_liability.loyalty_points_balance,0) AS loyalty_points_balance,
                  COALESCE(shared_customers.shared_customer_count,0) AS shared_customer_count,
                  COALESCE(royalty_liability.royalty_outstanding_paise,0) AS royalty_outstanding_paise,
                  COALESCE((SELECT (settings.settings_json#>>'{crossLocation,enabled}')::BOOLEAN
                              FROM membership_settings settings
                             WHERE settings.tenant_id=$1 AND settings.branch_id=branch.branch_id),FALSE) AS sharing_enabled,
                  COALESCE((SELECT (settings.settings_json#>>'{crossLocation,acceptInbound}')::BOOLEAN
                              FROM membership_settings settings
                             WHERE settings.tenant_id=$1 AND settings.branch_id=branch.branch_id),FALSE) AS accept_inbound,
                  CASE WHEN policy.central_branch_id IS NULL OR branch.branch_id=policy.central_branch_id THEN 0 ELSE
                    (SELECT COUNT(*) FROM services master
                      WHERE master.tenant_id=$1 AND master.branch_id=policy.central_branch_id
                        AND (NOT EXISTS(SELECT 1 FROM services linked WHERE linked.tenant_id=$1
                          AND linked.branch_id=branch.branch_id AND linked.central_master_service_id=master.id)
                          OR EXISTS(SELECT 1 FROM services linked WHERE linked.tenant_id=$1
                            AND linked.branch_id=branch.branch_id AND linked.central_master_service_id=master.id
                            AND ((NOT ('name'=ANY(linked.franchise_override_fields)) AND linked.name<>master.name)
                              OR (NOT ('category'=ANY(linked.franchise_override_fields)) AND linked.category<>master.category)
                              OR (NOT ('durationMinutes'=ANY(linked.franchise_override_fields)) AND linked.duration_minutes<>master.duration_minutes)
                              OR (NOT ('pricePaise'=ANY(linked.franchise_override_fields)) AND linked.price_paise<>master.price_paise)
                              OR (NOT ('gstPercent'=ANY(linked.franchise_override_fields)) AND linked.gst_percent<>master.gst_percent)
                              OR (NOT ('sacCode'=ANY(linked.franchise_override_fields)) AND linked.sac_code<>master.sac_code)
                              OR (NOT ('waitTimeMinutes'=ANY(linked.franchise_override_fields)) AND linked.wait_time_minutes<>master.wait_time_minutes)
                              OR (NOT ('cleanupTimeMinutes'=ANY(linked.franchise_override_fields)) AND linked.cleanup_time_minutes<>master.cleanup_time_minutes)
                              OR (NOT ('bufferTimeMinutes'=ANY(linked.franchise_override_fields)) AND linked.buffer_time_minutes<>master.buffer_time_minutes)
                              OR (NOT ('active'=ANY(linked.franchise_override_fields)) AND linked.active<>master.active)))))
                  END::BIGINT AS service_sync_gap,
                  CASE WHEN policy.central_branch_id IS NULL OR branch.branch_id=policy.central_branch_id THEN 0 ELSE
                    (SELECT COUNT(*) FROM inventory_items master
                      WHERE master.tenant_id=$1 AND master.branch_id=policy.central_branch_id
                        AND (NOT EXISTS(SELECT 1 FROM inventory_items linked WHERE linked.tenant_id=$1
                          AND linked.branch_id=branch.branch_id AND linked.central_master_item_id=master.id)
                          OR EXISTS(SELECT 1 FROM inventory_items linked WHERE linked.tenant_id=$1
                            AND linked.branch_id=branch.branch_id AND linked.central_master_item_id=master.id
                            AND ((NOT ('sku'=ANY(linked.franchise_override_fields)) AND linked.sku<>master.sku)
                              OR (NOT ('name'=ANY(linked.franchise_override_fields)) AND linked.name<>master.name)
                              OR (NOT ('category'=ANY(linked.franchise_override_fields)) AND linked.category<>master.category)
                              OR (NOT ('unit'=ANY(linked.franchise_override_fields)) AND linked.unit<>master.unit)
                              OR (NOT ('hsnCode'=ANY(linked.franchise_override_fields)) AND linked.hsn_code<>master.hsn_code)
                              OR (NOT ('gstPercent'=ANY(linked.franchise_override_fields)) AND linked.gst_percent<>master.gst_percent)
                              OR (NOT ('barcode'=ANY(linked.franchise_override_fields)) AND linked.barcode<>master.barcode)
                              OR (NOT ('batchTracked'=ANY(linked.franchise_override_fields)) AND linked.batch_tracked<>master.batch_tracked)
                              OR (NOT ('active'=ANY(linked.franchise_override_fields)) AND linked.active<>master.active)))))
                  END::BIGINT AS product_sync_gap
             FROM scoped_branches branch
             LEFT JOIN franchise_policies policy ON policy.tenant_id=$1
             LEFT JOIN sales ON sales.branch_id=branch.branch_id
             LEFT JOIN refunds ON refunds.branch_id=branch.branch_id
             LEFT JOIN voids ON voids.branch_id=branch.branch_id
             LEFT JOIN appointment_metrics ON appointment_metrics.branch_id=branch.branch_id
             LEFT JOIN schedule_metrics ON schedule_metrics.branch_id=branch.branch_id
             LEFT JOIN inventory_value ON inventory_value.branch_id=branch.branch_id
             LEFT JOIN shortages ON shortages.branch_id=branch.branch_id
             LEFT JOIN transfers ON transfers.branch_id=branch.branch_id
             LEFT JOIN cash_controls ON cash_controls.branch_id=branch.branch_id
             LEFT JOIN membership_liability ON membership_liability.branch_id=branch.branch_id
             LEFT JOIN membership_redemptions ON membership_redemptions.branch_id=branch.branch_id
             LEFT JOIN gift_liability ON gift_liability.branch_id=branch.branch_id
             LEFT JOIN loyalty_liability ON loyalty_liability.branch_id=branch.branch_id
             LEFT JOIN shared_customers ON shared_customers.branch_id=branch.branch_id
             LEFT JOIN royalty_liability ON royalty_liability.branch_id=branch.branch_id
            ORDER BY branch.active DESC,branch.branch_name,branch.branch_id"#,
    )
    .bind(tenant_id)
    .bind(start_date)
    .bind(end_date)
    .bind(region)
    .bind(zone)
    .bind(cluster)
    .bind(branch_id)
    .bind(actor_user_id)
    .bind(unrestricted)
    .fetch_all(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn multi_branch_drilldown(
    db: &PgPool,
    tenant_id: &str,
    start_date: NaiveDate,
    end_date: NaiveDate,
    region: &str,
    zone: &str,
    cluster: &str,
    branch_id: &str,
    actor_user_id: &str,
    unrestricted: bool,
    kind: &str,
) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let scope = r#"WITH scoped_branches AS (
      SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,branch.name AS branch_name
        FROM branches branch JOIN tenants tenant ON tenant.id=branch.tenant_id
       WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
         AND $2::DATE <= $3::DATE
         AND ($4='' OR LOWER(branch.region_name)=LOWER($4))
         AND ($5='' OR LOWER(branch.zone_name)=LOWER($5))
         AND ($6='' OR LOWER(branch.cluster_name)=LOWER($6))
         AND ($7='' OR COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=$7 OR LOWER(COALESCE(branch.code,''))=LOWER($7))
         AND ($9 OR EXISTS(SELECT 1 FROM user_branch_roles access WHERE access.tenant_id=$1
           AND access.user_id=$8 AND access.active=TRUE
           AND access.branch_id=COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)
           AND (access.access_type='permanent' OR CURRENT_DATE BETWEEN access.valid_from AND access.valid_until)))
    )"#;
    let body = match kind {
        "sales" => {
            r#"SELECT jsonb_build_object('kind','sale','branchId',sale.branch_id,'branchName',branch.branch_name,
          'id',sale.id,'invoiceNumber',sale.invoice_number,'clientId',sale.client_id,'staffId',sale.staff_id,
          'staffName',COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),'Unassigned'),
          'services',COALESCE((SELECT jsonb_agg(DISTINCT line.item_name) FILTER (WHERE line.line_type='service') FROM pos_sale_lines line WHERE line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id),'[]'::JSONB),
          'status',sale.status,'totalPaise',sale.total_paise,'discountPaise',sale.discount_paise,'taxPaise',sale.tax_paise,
          'occurredAt',COALESCE(sale.finalized_at,sale.created_at))
          FROM pos_sales sale JOIN scoped_branches branch ON branch.branch_id=sale.branch_id
          LEFT JOIN staff ON staff.tenant_id=sale.tenant_id AND staff.branch_id=sale.branch_id AND staff.id=sale.staff_id
         WHERE sale.tenant_id=$1 AND COALESCE(sale.finalized_at,sale.created_at)>=$2
           AND COALESCE(sale.finalized_at,sale.created_at)<$3::DATE+INTERVAL '1 day'
         ORDER BY COALESCE(sale.finalized_at,sale.created_at) DESC,sale.id LIMIT 200"#
        }
        "appointments" => {
            r#"SELECT jsonb_build_object('kind','appointment','branchId',appointment.branch_id,'branchName',branch.branch_name,
          'id',appointment.id,'clientId',appointment.client_id,'staffId',appointment.staff_id,
          'staffName',COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),'Unassigned'),
          'services',appointment.service_ids_json,'status',appointment.status,'occurredAt',appointment.start_at)
          FROM appointments appointment JOIN scoped_branches branch ON branch.branch_id=appointment.branch_id
          LEFT JOIN staff ON staff.tenant_id=appointment.tenant_id AND staff.branch_id=appointment.branch_id AND staff.id=appointment.staff_id
         WHERE appointment.tenant_id=$1 AND appointment.start_at>=$2
           AND appointment.start_at<$3::DATE+INTERVAL '1 day'
         ORDER BY appointment.start_at DESC,appointment.id LIMIT 200"#
        }
        "refunds" => {
            r#"SELECT jsonb_build_object('kind','refund','branchId',refund.branch_id,'branchName',branch.branch_name,
          'id',refund.id,'invoiceId',refund.sale_id,'amountPaise',refund.amount_paise,'reason',refund.reason,
          'occurredAt',refund.created_at)
          FROM pos_invoice_refunds refund JOIN scoped_branches branch ON branch.branch_id=refund.branch_id
         WHERE refund.tenant_id=$1 AND refund.created_at>=$2 AND refund.created_at<$3::DATE+INTERVAL '1 day'
         ORDER BY refund.created_at DESC,refund.id LIMIT 200"#
        }
        "transfers" => {
            r#"SELECT jsonb_build_object('kind','transfer','branchId',transfer.source_branch_id,
          'branchName',source.branch_name,'id',transfer.id,'sourceBranchId',transfer.source_branch_id,
          'destinationBranchId',transfer.destination_branch_id,'status',transfer.status,
          'quantity',COALESCE(SUM(line.quantity),0),'valuePaise',COALESCE(SUM(line.quantity::BIGINT*line.unit_cost_paise),0),
          'occurredAt',transfer.dispatched_at)
          FROM inventory_transfers transfer
          JOIN LATERAL (
            SELECT branch.branch_name FROM scoped_branches branch
             WHERE branch.branch_id IN (transfer.source_branch_id,transfer.destination_branch_id)
             ORDER BY (branch.branch_id=transfer.source_branch_id) DESC LIMIT 1
          ) source ON TRUE
          LEFT JOIN inventory_transfer_lines line ON line.tenant_id=transfer.tenant_id AND line.transfer_id=transfer.id
         WHERE transfer.tenant_id=$1 AND transfer.dispatched_at>=$2 AND transfer.dispatched_at<$3::DATE+INTERVAL '1 day'
         GROUP BY transfer.id,source.branch_name ORDER BY transfer.dispatched_at DESC,transfer.id LIMIT 200"#
        }
        "registerClosings" => {
            r#"SELECT jsonb_build_object('kind','registerClosing','branchId',session.branch_id,
          'branchName',branch.branch_name,'id',COALESCE(till.id,session.id),'sessionId',session.id,
          'tillId',till.id,'tillName',COALESCE(till.till_name,'Main register'),
          'businessDate',session.business_date,'openingCashPaise',COALESCE(till.opening_cash_paise,session.opening_cash_paise),
          'expectedCashPaise',COALESCE(till.expected_cash_paise,session.expected_cash_paise),
          'countedCashPaise',COALESCE(till.counted_cash_paise,session.counted_cash_paise),
          'variancePaise',COALESCE(till.variance_paise,session.variance_paise),
          'status',COALESCE(till.status,session.status),'openedAt',COALESCE(till.opened_at,session.opened_at),
          'closeRequestedAt',COALESCE(till.close_requested_at,session.close_requested_at),
          'approvedAt',COALESCE(till.approved_at,session.approved_at),
          'closedAt',COALESCE(till.closed_at,session.closed_at),'occurredAt',COALESCE(till.closed_at,session.closed_at,session.opened_at))
          FROM cash_drawer_sessions session JOIN scoped_branches branch ON branch.branch_id=session.branch_id
          LEFT JOIN cash_drawer_tills till ON till.tenant_id=session.tenant_id AND till.branch_id=session.branch_id
           AND till.drawer_session_id=session.id
         WHERE session.tenant_id=$1 AND session.business_date BETWEEN $2 AND $3
         ORDER BY session.business_date DESC,session.opened_at DESC,till.opened_at,till.id LIMIT 500"#
        }
        "conflicts" => {
            r#"SELECT row FROM (
          SELECT jsonb_build_object('kind','fieldConflict','id','service:'||branch.branch_id||':'||master.id||':'||diff.field_name,
            'branchId',branch.branch_id,'branchName',branch.branch_name,'entityType','service','entityId',master.id,
            'entityName',master.name,'fieldName',diff.field_name,'centralValue',diff.central_value,
            'branchValue',diff.branch_value,'overridden',diff.overridden,
            'status',CASE WHEN diff.overridden THEN 'controlled_override' ELSE 'mismatch' END) AS row
            FROM franchise_policies policy JOIN scoped_branches branch ON branch.branch_id<>policy.central_branch_id
            JOIN services master ON master.tenant_id=$1 AND master.branch_id=policy.central_branch_id
            LEFT JOIN services linked ON linked.tenant_id=$1 AND linked.branch_id=branch.branch_id
             AND linked.central_master_service_id=master.id
            CROSS JOIN LATERAL (VALUES
              ('name',to_jsonb(master.name),to_jsonb(linked.name),COALESCE('name'=ANY(linked.franchise_override_fields),FALSE)),
              ('category',to_jsonb(master.category),to_jsonb(linked.category),COALESCE('category'=ANY(linked.franchise_override_fields),FALSE)),
              ('durationMinutes',to_jsonb(master.duration_minutes),to_jsonb(linked.duration_minutes),COALESCE('durationMinutes'=ANY(linked.franchise_override_fields),FALSE)),
              ('pricePaise',to_jsonb(master.price_paise),to_jsonb(linked.price_paise),COALESCE('pricePaise'=ANY(linked.franchise_override_fields),FALSE)),
              ('gstPercent',to_jsonb(master.gst_percent),to_jsonb(linked.gst_percent),COALESCE('gstPercent'=ANY(linked.franchise_override_fields),FALSE)),
              ('sacCode',to_jsonb(master.sac_code),to_jsonb(linked.sac_code),COALESCE('sacCode'=ANY(linked.franchise_override_fields),FALSE)),
              ('waitTimeMinutes',to_jsonb(master.wait_time_minutes),to_jsonb(linked.wait_time_minutes),COALESCE('waitTimeMinutes'=ANY(linked.franchise_override_fields),FALSE)),
              ('cleanupTimeMinutes',to_jsonb(master.cleanup_time_minutes),to_jsonb(linked.cleanup_time_minutes),COALESCE('cleanupTimeMinutes'=ANY(linked.franchise_override_fields),FALSE)),
              ('bufferTimeMinutes',to_jsonb(master.buffer_time_minutes),to_jsonb(linked.buffer_time_minutes),COALESCE('bufferTimeMinutes'=ANY(linked.franchise_override_fields),FALSE)),
              ('active',to_jsonb(master.active),to_jsonb(linked.active),COALESCE('active'=ANY(linked.franchise_override_fields),FALSE))
            ) diff(field_name,central_value,branch_value,overridden)
           WHERE diff.central_value IS DISTINCT FROM diff.branch_value
          UNION ALL
          SELECT jsonb_build_object('kind','fieldConflict','id','product:'||branch.branch_id||':'||master.id||':'||diff.field_name,
            'branchId',branch.branch_id,'branchName',branch.branch_name,'entityType','product','entityId',master.id,
            'entityName',master.name,'fieldName',diff.field_name,'centralValue',diff.central_value,
            'branchValue',diff.branch_value,'overridden',diff.overridden,
            'status',CASE WHEN diff.overridden THEN 'controlled_override' ELSE 'mismatch' END) AS row
            FROM franchise_policies policy JOIN scoped_branches branch ON branch.branch_id<>policy.central_branch_id
            JOIN inventory_items master ON master.tenant_id=$1 AND master.branch_id=policy.central_branch_id
            LEFT JOIN inventory_items linked ON linked.tenant_id=$1 AND linked.branch_id=branch.branch_id
             AND linked.central_master_item_id=master.id
            CROSS JOIN LATERAL (VALUES
              ('sku',to_jsonb(master.sku),to_jsonb(linked.sku),COALESCE('sku'=ANY(linked.franchise_override_fields),FALSE)),
              ('name',to_jsonb(master.name),to_jsonb(linked.name),COALESCE('name'=ANY(linked.franchise_override_fields),FALSE)),
              ('category',to_jsonb(master.category),to_jsonb(linked.category),COALESCE('category'=ANY(linked.franchise_override_fields),FALSE)),
              ('unit',to_jsonb(master.unit),to_jsonb(linked.unit),COALESCE('unit'=ANY(linked.franchise_override_fields),FALSE)),
              ('hsnCode',to_jsonb(master.hsn_code),to_jsonb(linked.hsn_code),COALESCE('hsnCode'=ANY(linked.franchise_override_fields),FALSE)),
              ('gstPercent',to_jsonb(master.gst_percent),to_jsonb(linked.gst_percent),COALESCE('gstPercent'=ANY(linked.franchise_override_fields),FALSE)),
              ('barcode',to_jsonb(master.barcode),to_jsonb(linked.barcode),COALESCE('barcode'=ANY(linked.franchise_override_fields),FALSE)),
              ('batchTracked',to_jsonb(master.batch_tracked),to_jsonb(linked.batch_tracked),COALESCE('batchTracked'=ANY(linked.franchise_override_fields),FALSE)),
              ('active',to_jsonb(master.active),to_jsonb(linked.active),COALESCE('active'=ANY(linked.franchise_override_fields),FALSE))
            ) diff(field_name,central_value,branch_value,overridden)
           WHERE diff.central_value IS DISTINCT FROM diff.branch_value
        ) conflicts ORDER BY row->>'branchName',row->>'entityType',row->>'entityName',row->>'fieldName' LIMIT 500"#
        }
        "interBranchSettlements" => {
            r#"SELECT jsonb_build_object('kind','interBranchSettlement','branchId',redemption.branch_id,
          'branchName',target.branch_name,'id',redemption.id,'redemptionId',redemption.id,
          'invoiceId',redemption.sale_id,'membershipName',redemption.membership_name,
          'serviceName',redemption.service_name,'sourceBranchId',credit.branch_id,
          'sourceBranchName',source.branch_name,'redemptionBranchId',redemption.branch_id,
          'redemptionBranchName',target.branch_name,
          'valuePaise',COALESCE(NULLIF(redemption.redeemed_value_paise,0),redemption.quantity::BIGINT*credit.unit_value_paise),
          'status',COALESCE(settlement.status,'open'),'version',COALESCE(settlement.version,0),
          'settlementId',settlement.id,'paymentMethod',settlement.payment_method,
          'settlementReference',settlement.settlement_reference,'settledByUserId',settlement.settled_by_user_id,
          'settledAt',settlement.settled_at,'occurredAt',redemption.created_at)
          FROM pos_membership_redemptions redemption
          JOIN client_membership_credits credit ON credit.id=redemption.client_membership_credit_id
           AND credit.tenant_id=redemption.tenant_id AND credit.branch_id<>redemption.branch_id
          JOIN pos_sales sale ON sale.id=redemption.sale_id AND sale.tenant_id=redemption.tenant_id
           AND sale.branch_id=redemption.branch_id AND sale.status NOT IN ('draft','open','voided','cancelled','refunded')
          JOIN scoped_branches source ON source.branch_id=credit.branch_id
          JOIN scoped_branches target ON target.branch_id=redemption.branch_id
          LEFT JOIN multi_branch_settlements settlement ON settlement.tenant_id=redemption.tenant_id
           AND settlement.redemption_id=redemption.id
         WHERE redemption.tenant_id=$1 AND redemption.created_at>=$2
           AND redemption.created_at<$3::DATE+INTERVAL '1 day'
         ORDER BY (settlement.id IS NULL) DESC,redemption.created_at DESC,redemption.id LIMIT 500"#
        }
        _ => {
            r#"SELECT jsonb_build_object('kind','membershipRedemption','branchId',redemption.branch_id,
          'branchName',branch.branch_name,'id',redemption.id,'invoiceId',redemption.sale_id,
          'membershipName',redemption.membership_name,'serviceName',redemption.service_name,
          'quantity',redemption.quantity,'valuePaise',redemption.quantity::BIGINT*credit.unit_value_paise,
          'sourceBranchId',credit.branch_id,'crossLocation',credit.branch_id<>redemption.branch_id,
          'occurredAt',redemption.created_at)
          FROM pos_membership_redemptions redemption
          JOIN client_membership_credits credit ON credit.id=redemption.client_membership_credit_id AND credit.tenant_id=redemption.tenant_id
          JOIN scoped_branches branch ON branch.branch_id=redemption.branch_id
         WHERE redemption.tenant_id=$1 AND redemption.created_at>=$2 AND redemption.created_at<$3::DATE+INTERVAL '1 day'
         ORDER BY redemption.created_at DESC,redemption.id LIMIT 200"#
        }
    };
    sqlx::query_scalar::<_, serde_json::Value>(&format!("{scope} {body}"))
        .bind(tenant_id)
        .bind(start_date)
        .bind(end_date)
        .bind(region)
        .bind(zone)
        .bind(cluster)
        .bind(branch_id)
        .bind(actor_user_id)
        .bind(unrestricted)
        .fetch_all(db)
        .await
}

pub async fn inter_branch_redemption_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    redemption_id: &str,
) -> Result<Option<InterBranchRedemptionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT redemption.id,credit.branch_id AS source_branch_id,
                  redemption.branch_id AS redemption_branch_id,
                  COALESCE(NULLIF(redemption.redeemed_value_paise,0),
                    redemption.quantity::BIGINT*credit.unit_value_paise)::BIGINT AS amount_paise,
                  sale.business_date
             FROM pos_membership_redemptions redemption
             JOIN client_membership_credits credit ON credit.id=redemption.client_membership_credit_id
              AND credit.tenant_id=redemption.tenant_id AND credit.branch_id<>redemption.branch_id
             JOIN pos_sales sale ON sale.id=redemption.sale_id AND sale.tenant_id=redemption.tenant_id
              AND sale.branch_id=redemption.branch_id
            WHERE redemption.tenant_id=$1 AND redemption.id=$2
              AND sale.status NOT IN ('draft','open','voided','cancelled','refunded')
            FOR UPDATE OF redemption"#,
    )
    .bind(tenant_id)
    .bind(redemption_id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn inter_branch_settlement_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    redemption_id: &str,
) -> Result<Option<InterBranchSettlementRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,branch_id,redemption_branch_id,redemption_id,amount_paise,status,version,
                  payment_method,settlement_reference,source_accrual_journal_id,
                  target_accrual_journal_id,source_payment_journal_id,target_payment_journal_id,
                  settled_by_user_id,settled_at
             FROM multi_branch_settlements WHERE tenant_id=$1 AND redemption_id=$2 FOR UPDATE"#,
    )
    .bind(tenant_id)
    .bind(redemption_id)
    .fetch_optional(&mut **tx)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn insert_inter_branch_settlement(
    tx: &mut Transaction<'_, Postgres>,
    id: &str,
    tenant_id: &str,
    redemption: &InterBranchRedemptionRecord,
    payment_method: &str,
    settlement_reference: &str,
    source_accrual_journal_id: &str,
    target_accrual_journal_id: &str,
    source_payment_journal_id: &str,
    target_payment_journal_id: &str,
    actor: &str,
) -> Result<InterBranchSettlementRecord, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO multi_branch_settlements(
             id,tenant_id,branch_id,redemption_branch_id,redemption_id,amount_paise,
             payment_method,settlement_reference,source_accrual_journal_id,
             target_accrual_journal_id,source_payment_journal_id,target_payment_journal_id,
             settled_by_user_id
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id,branch_id,redemption_branch_id,redemption_id,amount_paise,status,version,
             payment_method,settlement_reference,source_accrual_journal_id,
             target_accrual_journal_id,source_payment_journal_id,target_payment_journal_id,
             settled_by_user_id,settled_at"#,
    )
    .bind(id)
    .bind(tenant_id)
    .bind(&redemption.source_branch_id)
    .bind(&redemption.redemption_branch_id)
    .bind(&redemption.id)
    .bind(redemption.amount_paise)
    .bind(payment_method)
    .bind(settlement_reference)
    .bind(source_accrual_journal_id)
    .bind(target_accrual_journal_id)
    .bind(source_payment_journal_id)
    .bind(target_payment_journal_id)
    .bind(actor)
    .fetch_one(&mut **tx)
    .await
}

pub async fn multi_branch_approvals(
    db: &PgPool,
    tenant_id: &str,
    actor_user_id: &str,
    unrestricted: bool,
) -> Result<Vec<MultiBranchApprovalRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,branch_id,action,status,note,decision_note,requested_by,decided_by,
                  decided_at,version,created_at,updated_at
             FROM multi_branch_approvals WHERE tenant_id=$1
              AND ($3 OR branch_id IN (SELECT branch_id FROM user_branch_roles
                WHERE tenant_id=$1 AND user_id=$2 AND active=TRUE
                  AND (access_type='permanent' OR CURRENT_DATE BETWEEN valid_from AND valid_until)))
            ORDER BY (status='pending') DESC,created_at DESC,id LIMIT 200"#,
    )
    .bind(tenant_id)
    .bind(actor_user_id)
    .bind(unrestricted)
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
    actor_user_id: &str,
    unrestricted: bool,
) -> Result<Vec<MultiBranchAuditRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,branch_id,event_type,outcome,user_id AS actor_user_id,
                  details_json AS details,created_at
             FROM auth_audit_logs
            WHERE tenant_id=$1 AND event_type LIKE 'multi_branch.%'
              AND ($3 OR branch_id IN (SELECT branch_id FROM user_branch_roles
                WHERE tenant_id=$1 AND user_id=$2 AND active=TRUE
                  AND (access_type='permanent' OR CURRENT_DATE BETWEEN valid_from AND valid_until)))
            ORDER BY created_at DESC,id LIMIT 200"#,
    )
    .bind(tenant_id)
    .bind(actor_user_id)
    .bind(unrestricted)
    .fetch_all(db)
    .await
}
