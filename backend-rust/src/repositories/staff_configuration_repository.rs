use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RoleOptionRecord {
    pub id: String,
    pub name: String,
    pub assigned: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CatalogOptionRecord {
    pub item_type: String,
    pub id: String,
    pub name: String,
    pub category: String,
    pub assigned: bool,
    pub commission_percent: Option<i32>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CommissionRuleRecord {
    pub id: String,
    pub name: String,
    pub applies_to: String,
    pub rate_percent: i32,
    pub effective_from: Option<NaiveDate>,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PayRateRecord {
    pub id: String,
    pub rate_type: String,
    pub amount_paise: i64,
    pub effective_from: Option<NaiveDate>,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LeavePolicyRecord {
    pub id: String,
    pub name: String,
    pub leave_type: String,
    pub annual_days: i32,
    pub active: bool,
}

#[derive(Debug, Clone)]
pub struct CatalogAssignmentInput {
    pub item_type: String,
    pub item_id: String,
    pub commission_percent: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct CommissionRuleInput {
    pub name: String,
    pub applies_to: String,
    pub rate_percent: i32,
    pub effective_from: Option<NaiveDate>,
    pub active: bool,
}

#[derive(Debug, Clone)]
pub struct PayRateInput {
    pub rate_type: String,
    pub amount_paise: i64,
    pub effective_from: Option<NaiveDate>,
    pub active: bool,
}

#[derive(Debug, Clone)]
pub struct LeavePolicyInput {
    pub name: String,
    pub leave_type: String,
    pub annual_days: i32,
    pub active: bool,
}

pub struct ReplaceConfigurationInput {
    pub role_ids: Vec<String>,
    pub catalog_assignments: Vec<CatalogAssignmentInput>,
    pub commission_rules: Vec<CommissionRuleInput>,
    pub pay_rates: Vec<PayRateInput>,
    pub leave_policies: Vec<LeavePolicyInput>,
}

pub async fn list_roles(
    db: &PgPool,
    tenant_id: &str,
    staff_id: &str,
) -> Result<Vec<RoleOptionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT r.id, r.name, (a.role_id IS NOT NULL) AS assigned
        FROM roles r
        LEFT JOIN staff_role_assignments a ON a.role_id=r.id AND a.staff_id=$2
        WHERE r.tenant_id=$1
        ORDER BY r.name
        "#,
    )
    .bind(tenant_id)
    .bind(staff_id)
    .fetch_all(db)
    .await
}

pub async fn list_catalog(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<CatalogOptionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH catalog AS (
          SELECT 'service'::TEXT AS item_type, id, name, category FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=true
          UNION ALL
          SELECT 'product', id, name, category FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND active=true
          UNION ALL
          SELECT 'membership', id, name, plan_type AS category FROM memberships WHERE tenant_id=$1 AND branch_id=$2 AND active=true
          UNION ALL
          SELECT 'package', id, name, '' AS category FROM packages WHERE tenant_id=$1 AND branch_id=$2 AND active=true
        )
        SELECT c.item_type, c.id, c.name, c.category,
               (a.item_id IS NOT NULL) AS assigned, a.commission_percent
        FROM catalog c
        LEFT JOIN staff_catalog_assignments a
          ON a.staff_id=$3 AND a.item_type=c.item_type AND a.item_id=c.id
        ORDER BY c.item_type, c.category, c.name
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .fetch_all(db)
    .await
}

pub async fn list_commission_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<CommissionRuleRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,name,applies_to,rate_percent,effective_from,active FROM staff_commission_rules WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 ORDER BY created_at,id")
        .bind(tenant_id).bind(branch_id).bind(staff_id).fetch_all(db).await
}

pub async fn list_pay_rates(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<PayRateRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,rate_type,amount_paise,effective_from,active FROM staff_pay_rates WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 ORDER BY created_at,id")
        .bind(tenant_id).bind(branch_id).bind(staff_id).fetch_all(db).await
}

pub async fn list_leave_policies(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<LeavePolicyRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,name,leave_type,annual_days,active FROM staff_leave_policies WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 ORDER BY created_at,id")
        .bind(tenant_id).bind(branch_id).bind(staff_id).fetch_all(db).await
}

pub async fn role_ids_belong_to_tenant(
    db: &PgPool,
    tenant_id: &str,
    role_ids: &[String],
) -> Result<bool, sqlx::Error> {
    if role_ids.is_empty() {
        return Ok(true);
    }
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM roles WHERE tenant_id=$1 AND id=ANY($2)",
    )
    .bind(tenant_id)
    .bind(role_ids)
    .fetch_one(db)
    .await?;
    Ok(count == role_ids.len() as i64)
}

pub async fn catalog_item_belongs_to_scope(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    item_type: &str,
    item_id: &str,
) -> Result<bool, sqlx::Error> {
    let table = match item_type {
        "service" => "services",
        "product" => "inventory_items",
        "membership" => "memberships",
        "package" => "packages",
        _ => return Ok(false),
    };
    let sql = format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=true)");
    sqlx::query_scalar(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(item_id)
        .fetch_one(db)
        .await
}

pub async fn replace_configuration(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    input: ReplaceConfigurationInput,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query(
        "DELETE FROM staff_role_assignments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM staff_catalog_assignments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM staff_commission_rules WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM staff_pay_rates WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(staff_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "DELETE FROM staff_leave_policies WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .execute(&mut *tx)
    .await?;

    for role_id in input.role_ids {
        sqlx::query("INSERT INTO staff_role_assignments(tenant_id,branch_id,staff_id,role_id) VALUES($1,$2,$3,$4)").bind(tenant_id).bind(branch_id).bind(staff_id).bind(role_id).execute(&mut *tx).await?;
    }
    for item in input.catalog_assignments {
        sqlx::query("INSERT INTO staff_catalog_assignments(tenant_id,branch_id,staff_id,item_type,item_id,commission_percent) VALUES($1,$2,$3,$4,$5,$6)").bind(tenant_id).bind(branch_id).bind(staff_id).bind(item.item_type).bind(item.item_id).bind(item.commission_percent).execute(&mut *tx).await?;
    }
    for rule in input.commission_rules {
        sqlx::query("INSERT INTO staff_commission_rules(tenant_id,branch_id,staff_id,name,applies_to,rate_percent,effective_from,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(tenant_id).bind(branch_id).bind(staff_id).bind(rule.name).bind(rule.applies_to).bind(rule.rate_percent).bind(rule.effective_from).bind(rule.active).execute(&mut *tx).await?;
    }
    for rate in input.pay_rates {
        sqlx::query("INSERT INTO staff_pay_rates(tenant_id,branch_id,staff_id,rate_type,amount_paise,effective_from,active) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(tenant_id).bind(branch_id).bind(staff_id).bind(rate.rate_type).bind(rate.amount_paise).bind(rate.effective_from).bind(rate.active).execute(&mut *tx).await?;
    }
    for policy in input.leave_policies {
        sqlx::query("INSERT INTO staff_leave_policies(tenant_id,branch_id,staff_id,name,leave_type,annual_days,active) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(tenant_id).bind(branch_id).bind(staff_id).bind(policy.name).bind(policy.leave_type).bind(policy.annual_days).bind(policy.active).execute(&mut *tx).await?;
    }
    tx.commit().await
}
