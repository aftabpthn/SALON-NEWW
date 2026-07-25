use chrono::{NaiveDate, NaiveTime};
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
    pub base_price_paise: Option<i64>,
    pub pricing_level_id: Option<String>,
    pub pricing_level_price_paise: Option<i64>,
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

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffCategoryRecord {
    pub id: String,
    pub code: String,
    pub name: String,
    pub designation: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffPricingLevelRecord {
    pub id: String,
    pub code: String,
    pub name: String,
    pub rank: i32,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ShiftTemplateRecord {
    pub id: String,
    pub code: String,
    pub name: String,
    pub shift1_start: NaiveTime,
    pub shift1_end: NaiveTime,
    pub shift2_start: Option<NaiveTime>,
    pub shift2_end: Option<NaiveTime>,
    pub break_minutes: i32,
    pub weekly_off_days: Vec<i16>,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceRuleRecord {
    pub grace_minutes: i32,
    pub half_day_after_minutes: i32,
    pub absent_after_minutes: i32,
    pub overtime_after_minutes: i32,
    pub early_leave_grace_minutes: i32,
    pub deduct_breaks: bool,
    pub minimum_overtime_minutes: i32,
    pub overtime_rounding_minutes: i32,
    pub maximum_overtime_minutes: i32,
    pub active: bool,
    pub version: i32,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LeavePolicyOverviewRecord {
    pub id: String,
    pub staff_id: String,
    pub staff_name: String,
    pub employee_code: Option<String>,
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
    pub pricing_level_price_paise: Option<i64>,
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

#[derive(Debug, Clone)]
pub struct StaffCategoryInput {
    pub id: String,
    pub code: String,
    pub name: String,
    pub designation: String,
    pub active: bool,
}

#[derive(Debug, Clone)]
pub struct StaffPricingLevelInput {
    pub id: String,
    pub code: String,
    pub name: String,
    pub rank: i32,
    pub active: bool,
}

#[derive(Debug, Clone)]
pub struct ShiftTemplateInput {
    pub id: String,
    pub code: String,
    pub name: String,
    pub shift1_start: NaiveTime,
    pub shift1_end: NaiveTime,
    pub shift2_start: Option<NaiveTime>,
    pub shift2_end: Option<NaiveTime>,
    pub break_minutes: i32,
    pub weekly_off_days: Vec<i16>,
    pub active: bool,
}

#[derive(Debug, Clone)]
pub struct AttendanceRuleInput {
    pub grace_minutes: i32,
    pub half_day_after_minutes: i32,
    pub absent_after_minutes: i32,
    pub overtime_after_minutes: i32,
    pub early_leave_grace_minutes: i32,
    pub deduct_breaks: bool,
    pub minimum_overtime_minutes: i32,
    pub overtime_rounding_minutes: i32,
    pub maximum_overtime_minutes: i32,
    pub active: bool,
}

pub struct ReplaceStaffMastersInput {
    pub categories: Vec<StaffCategoryInput>,
    pub pricing_levels: Vec<StaffPricingLevelInput>,
    pub shift_templates: Vec<ShiftTemplateInput>,
    pub attendance_rule: AttendanceRuleInput,
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
        WITH staff_pricing AS (
          SELECT pricing_level_id
          FROM staff_profiles
          WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
        ),
        catalog AS (
          SELECT 'service'::TEXT AS item_type, id, name, category, price_paise::BIGINT AS base_price_paise FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=true
          UNION ALL
          SELECT 'product', id, name, category, NULL::BIGINT FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND active=true
          UNION ALL
          SELECT 'membership', id, name, plan_type AS category, NULL::BIGINT FROM memberships WHERE tenant_id=$1 AND branch_id=$2 AND active=true
          UNION ALL
          SELECT 'package', id, name, '' AS category, NULL::BIGINT FROM packages WHERE tenant_id=$1 AND branch_id=$2 AND active=true
        )
        SELECT c.item_type, c.id, c.name, c.category,
               (a.item_id IS NOT NULL) AS assigned, a.commission_percent,
               c.base_price_paise, staff_pricing.pricing_level_id,
               level_price.price_paise::BIGINT AS pricing_level_price_paise
        FROM catalog c
        LEFT JOIN staff_pricing ON TRUE
        LEFT JOIN staff_catalog_assignments a
          ON a.staff_id=$3 AND a.item_type=c.item_type AND a.item_id=c.id
        LEFT JOIN service_pricing_level_prices level_price
          ON c.item_type='service'
         AND level_price.tenant_id=$1
         AND level_price.branch_id=$2
         AND level_price.service_id=c.id
         AND level_price.pricing_level_id=staff_pricing.pricing_level_id
         AND level_price.active=TRUE
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

pub async fn list_staff_categories(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<StaffCategoryRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,code,name,designation,active FROM staff_categories WHERE tenant_id=$1 AND branch_id=$2 ORDER BY active DESC,name,id",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn list_staff_pricing_levels(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<StaffPricingLevelRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,code,name,rank,active FROM staff_pricing_levels WHERE tenant_id=$1 AND branch_id=$2 ORDER BY active DESC,rank,name,id",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn list_shift_templates(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ShiftTemplateRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,code,name,shift1_start,shift1_end,shift2_start,shift2_end,break_minutes,weekly_off_days,active FROM staff_shift_templates WHERE tenant_id=$1 AND branch_id=$2 ORDER BY active DESC,name,id",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn get_attendance_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<AttendanceRuleRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT grace_minutes,half_day_after_minutes,absent_after_minutes,overtime_after_minutes,early_leave_grace_minutes,deduct_breaks,minimum_overtime_minutes,overtime_rounding_minutes,maximum_overtime_minutes,active,version FROM staff_attendance_rules WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn list_leave_policy_overview(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<LeavePolicyOverviewRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT p.id,p.staff_id,
               TRIM(CONCAT_WS(' ',s.first_name,NULLIF(s.last_name,''))) AS staff_name,
               s.employee_code,p.name,p.leave_type,p.annual_days,p.active
        FROM staff_leave_policies p
        JOIN staff s ON s.tenant_id=p.tenant_id AND s.branch_id=p.branch_id AND s.id=p.staff_id
        WHERE p.tenant_id=$1 AND p.branch_id=$2
        ORDER BY s.first_name,s.last_name,p.leave_type,p.name
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn master_id_belongs_to_scope(
    db: &PgPool,
    table: &str,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    let table = match table {
        "category" => "staff_categories",
        "shift" => "staff_shift_templates",
        "pricingLevel" => "staff_pricing_levels",
        _ => return Ok(false),
    };
    let sql = format!(
        "SELECT EXISTS(SELECT 1 FROM {table} WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=true)"
    );
    sqlx::query_scalar(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(id)
        .fetch_one(db)
        .await
}

pub async fn save_staff_masters(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: ReplaceStaffMastersInput,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    for category in input.categories {
        if category.id.is_empty() {
            sqlx::query(
                r#"
                INSERT INTO staff_categories(tenant_id,branch_id,code,name,designation,active)
                VALUES($1,$2,$3,$4,$5,$6)
                ON CONFLICT (tenant_id,branch_id,code)
                DO UPDATE SET name=EXCLUDED.name,designation=EXCLUDED.designation,
                              active=EXCLUDED.active,updated_at=NOW()
                "#,
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(category.code)
            .bind(category.name)
            .bind(category.designation)
            .bind(category.active)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                "UPDATE staff_categories SET code=$4,name=$5,designation=$6,active=$7,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
            )
            .bind(tenant_id).bind(branch_id).bind(category.id).bind(category.code)
            .bind(category.name).bind(category.designation).bind(category.active)
            .execute(&mut *tx).await?;
        }
    }
    for level in input.pricing_levels {
        if level.id.is_empty() {
            sqlx::query(
                r#"
                INSERT INTO staff_pricing_levels(tenant_id,branch_id,code,name,rank,active)
                VALUES($1,$2,$3,$4,$5,$6)
                ON CONFLICT (tenant_id,branch_id,code)
                DO UPDATE SET name=EXCLUDED.name,rank=EXCLUDED.rank,
                              active=EXCLUDED.active,updated_at=NOW()
                "#,
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(level.code)
            .bind(level.name)
            .bind(level.rank)
            .bind(level.active)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                "UPDATE staff_pricing_levels SET code=$4,name=$5,rank=$6,active=$7,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
            )
            .bind(tenant_id).bind(branch_id).bind(level.id).bind(level.code)
            .bind(level.name).bind(level.rank).bind(level.active)
            .execute(&mut *tx).await?;
        }
    }
    for shift in input.shift_templates {
        if shift.id.is_empty() {
            sqlx::query(
                r#"
                INSERT INTO staff_shift_templates(
                  tenant_id,branch_id,code,name,shift1_start,shift1_end,shift2_start,shift2_end,
                  break_minutes,weekly_off_days,active
                ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                ON CONFLICT (tenant_id,branch_id,code)
                DO UPDATE SET name=EXCLUDED.name,shift1_start=EXCLUDED.shift1_start,
                              shift1_end=EXCLUDED.shift1_end,shift2_start=EXCLUDED.shift2_start,
                              shift2_end=EXCLUDED.shift2_end,break_minutes=EXCLUDED.break_minutes,
                              weekly_off_days=EXCLUDED.weekly_off_days,active=EXCLUDED.active,updated_at=NOW()
                "#,
            )
            .bind(tenant_id).bind(branch_id).bind(shift.code).bind(shift.name)
            .bind(shift.shift1_start).bind(shift.shift1_end).bind(shift.shift2_start)
            .bind(shift.shift2_end).bind(shift.break_minutes).bind(shift.weekly_off_days)
            .bind(shift.active).execute(&mut *tx).await?;
        } else {
            sqlx::query(
                r#"
                UPDATE staff_shift_templates
                SET code=$4,name=$5,shift1_start=$6,shift1_end=$7,shift2_start=$8,shift2_end=$9,
                    break_minutes=$10,weekly_off_days=$11,active=$12,updated_at=NOW()
                WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
                "#,
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(shift.id)
            .bind(shift.code)
            .bind(shift.name)
            .bind(shift.shift1_start)
            .bind(shift.shift1_end)
            .bind(shift.shift2_start)
            .bind(shift.shift2_end)
            .bind(shift.break_minutes)
            .bind(shift.weekly_off_days)
            .bind(shift.active)
            .execute(&mut *tx)
            .await?;
        }
    }
    let rule = input.attendance_rule;
    sqlx::query(
        r#"
        INSERT INTO staff_attendance_rules(
          tenant_id,branch_id,grace_minutes,half_day_after_minutes,absent_after_minutes,
          overtime_after_minutes,early_leave_grace_minutes,deduct_breaks,minimum_overtime_minutes,
          overtime_rounding_minutes,maximum_overtime_minutes,active
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (tenant_id,branch_id)
        DO UPDATE SET grace_minutes=EXCLUDED.grace_minutes,
                      half_day_after_minutes=EXCLUDED.half_day_after_minutes,
                      absent_after_minutes=EXCLUDED.absent_after_minutes,
                      overtime_after_minutes=EXCLUDED.overtime_after_minutes,
                      early_leave_grace_minutes=EXCLUDED.early_leave_grace_minutes,
                      deduct_breaks=EXCLUDED.deduct_breaks,
                      minimum_overtime_minutes=EXCLUDED.minimum_overtime_minutes,
                      overtime_rounding_minutes=EXCLUDED.overtime_rounding_minutes,
                      maximum_overtime_minutes=EXCLUDED.maximum_overtime_minutes,
                      active=EXCLUDED.active,version=staff_attendance_rules.version+1,updated_at=NOW()
        "#,
    )
    .bind(tenant_id).bind(branch_id).bind(rule.grace_minutes)
    .bind(rule.half_day_after_minutes).bind(rule.absent_after_minutes)
    .bind(rule.overtime_after_minutes).bind(rule.early_leave_grace_minutes)
    .bind(rule.deduct_breaks).bind(rule.minimum_overtime_minutes)
    .bind(rule.overtime_rounding_minutes).bind(rule.maximum_overtime_minutes)
    .bind(rule.active).execute(&mut *tx).await?;
    tx.commit().await
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
    let pricing_level_id = sqlx::query_scalar::<_, String>(
        "SELECT pricing_level_id FROM staff_profiles WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND pricing_level_id IS NOT NULL",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .fetch_optional(&mut *tx)
    .await?;
    for item in input.catalog_assignments {
        if item.item_type == "service" {
            if let (Some(level_id), Some(price_paise)) =
                (pricing_level_id.as_deref(), item.pricing_level_price_paise)
            {
                sqlx::query(
                    r#"
                    INSERT INTO service_pricing_level_prices(
                      tenant_id,branch_id,service_id,pricing_level_id,price_paise,active
                    ) VALUES($1,$2,$3,$4,$5,TRUE)
                    ON CONFLICT (tenant_id,branch_id,service_id,pricing_level_id)
                    DO UPDATE SET price_paise=EXCLUDED.price_paise,active=TRUE,updated_at=NOW()
                    "#,
                )
                .bind(tenant_id)
                .bind(branch_id)
                .bind(&item.item_id)
                .bind(level_id)
                .bind(price_paise)
                .execute(&mut *tx)
                .await?;
            }
        }
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
