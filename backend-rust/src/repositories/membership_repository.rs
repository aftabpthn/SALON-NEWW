use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};

use super::business_code_repository::{next_branch_code, BusinessCodeKind};

#[derive(Debug, Clone, FromRow)]
pub struct MembershipRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub name: String,
    pub code: String,
    pub plan_type: String,
    pub price_paise: i64,
    pub points_required: i32,
    pub discount_percent: i32,
    pub validity_days: i32,
    pub notes: String,
    pub service_ids_json: String,
    pub benefit_rules_json: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

pub struct CreateMembership<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub name: &'a str,
    pub plan_type: &'a str,
    pub price_paise: i64,
    pub points_required: i32,
    pub discount_percent: i32,
    pub validity_days: i32,
    pub notes: &'a str,
    pub service_ids_json: &'a str,
    pub benefit_rules_json: &'a str,
}

pub struct UpdateMembership<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub name: Option<&'a str>,
    pub code: Option<&'a str>,
    pub plan_type: Option<&'a str>,
    pub price_paise: Option<i64>,
    pub points_required: Option<i32>,
    pub discount_percent: Option<i32>,
    pub validity_days: Option<i32>,
    pub notes: Option<&'a str>,
    pub service_ids_json: Option<&'a str>,
    pub benefit_rules_json: Option<&'a str>,
    pub active: Option<bool>,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    q: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<MembershipRecord>, sqlx::Error> {
    sqlx::query_as::<_, MembershipRecord>(&select_sql(
        r#"
        WHERE tenant_id = $1 AND branch_id = $2
          AND ($3 = '' OR name ILIKE '%' || $3 || '%' OR code ILIKE '%' || $3 || '%')
        ORDER BY created_at DESC LIMIT $4 OFFSET $5
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
) -> Result<Option<MembershipRecord>, sqlx::Error> {
    sqlx::query_as::<_, MembershipRecord>(&select_sql(
        "WHERE tenant_id = $1 AND branch_id = $2 AND id = $3 LIMIT 1",
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn create(
    db: &PgPool,
    input: CreateMembership<'_>,
) -> Result<MembershipRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let code = next_branch_code(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        BusinessCodeKind::Membership,
    )
    .await?;
    let row = sqlx::query_as::<_, MembershipRecord>(r#"
        INSERT INTO memberships (tenant_id, branch_id, name, code, plan_type, price_paise, points_required, discount_percent, validity_days, notes, service_ids_json, benefit_rules)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
        RETURNING id, tenant_id, branch_id, name, code, plan_type, price_paise::BIGINT AS price_paise, points_required, discount_percent, validity_days, notes, service_ids_json::TEXT AS service_ids_json, benefit_rules::TEXT AS benefit_rules_json, active, created_at, updated_at
    "#)
    .bind(input.tenant_id).bind(input.branch_id).bind(input.name).bind(code).bind(input.plan_type).bind(input.price_paise)
    .bind(input.points_required).bind(input.discount_percent).bind(input.validity_days).bind(input.notes).bind(input.service_ids_json).bind(input.benefit_rules_json)
    .fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn update(
    db: &PgPool,
    input: UpdateMembership<'_>,
) -> Result<Option<MembershipRecord>, sqlx::Error> {
    sqlx::query_as::<_, MembershipRecord>(r#"
        UPDATE memberships SET name = COALESCE($4, name), code = COALESCE($5, code), plan_type = COALESCE($6, plan_type), price_paise = COALESCE($7, price_paise), points_required = COALESCE($8, points_required), discount_percent = COALESCE($9, discount_percent), validity_days = COALESCE($10, validity_days), notes = COALESCE($11, notes), service_ids_json = COALESCE($12::jsonb, service_ids_json), benefit_rules = COALESCE($13::jsonb, benefit_rules), active = COALESCE($14, active), updated_at = NOW()
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        RETURNING id, tenant_id, branch_id, name, code, plan_type, price_paise::BIGINT AS price_paise, points_required, discount_percent, validity_days, notes, service_ids_json::TEXT AS service_ids_json, benefit_rules::TEXT AS benefit_rules_json, active, created_at, updated_at
    "#)
    .bind(input.tenant_id).bind(input.branch_id).bind(input.id).bind(input.name).bind(input.code).bind(input.plan_type).bind(input.price_paise)
    .bind(input.points_required).bind(input.discount_percent).bind(input.validity_days).bind(input.notes).bind(input.service_ids_json).bind(input.benefit_rules_json).bind(input.active)
    .fetch_optional(db).await
}

pub async fn delete(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(
        sqlx::query("DELETE FROM memberships WHERE tenant_id = $1 AND branch_id = $2 AND id = $3")
            .bind(tenant_id)
            .bind(branch_id)
            .bind(id)
            .execute(db)
            .await?
            .rows_affected()
            > 0,
    )
}

fn select_sql(where_clause: &str) -> String {
    format!(
        r#"
        SELECT id, tenant_id, branch_id, name, code, plan_type, price_paise::BIGINT AS price_paise, points_required, discount_percent, validity_days, notes, service_ids_json::TEXT AS service_ids_json, benefit_rules::TEXT AS benefit_rules_json, active, created_at, updated_at
        FROM memberships {where_clause}
    "#
    )
}
