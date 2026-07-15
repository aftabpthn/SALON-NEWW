use chrono::{DateTime, NaiveTime, Utc};
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, FromRow)]
pub struct ServiceRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub name: String,
    pub category: String,
    pub duration_minutes: i32,
    pub price_paise: i64,
    pub gst_percent: i32,
    pub sac_code: String,
    pub wait_time_minutes: i32,
    pub cleanup_time_minutes: i32,
    pub buffer_time_minutes: i32,
    pub product_consumption_json: String,
    pub staff_ids_json: String,
    pub variants_json: String,
    pub addons_json: String,
    pub staff_prices_json: String,
    pub price_rules_json: String,
    pub central_master_service_id: Option<String>,
    pub franchise_override_fields: Vec<String>,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct ServiceVariantInput {
    pub id: String,
    pub name: String,
    pub price_delta_paise: i64,
    pub duration_delta_minutes: i32,
    pub active: bool,
}

#[derive(Debug, Clone)]
pub struct ServiceAddonInput {
    pub id: String,
    pub name: String,
    pub price_paise: i64,
    pub duration_minutes: i32,
    pub active: bool,
}

#[derive(Debug, Clone)]
pub struct ServiceStaffPriceInput {
    pub id: String,
    pub staff_id: String,
    pub price_paise: i64,
    pub active: bool,
}

#[derive(Debug, Clone)]
pub struct ServicePriceRuleInput {
    pub id: String,
    pub name: String,
    pub days_of_week: Vec<i16>,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
    pub adjustment_bps: i32,
    pub priority: i32,
    pub active: bool,
}

#[derive(Debug, Clone, FromRow)]
pub struct ServicePricingSource {
    pub service_id: String,
    pub base_price_paise: i64,
    pub base_duration_minutes: i32,
    pub staff_price_paise: Option<i64>,
    pub variant_id: Option<String>,
    pub variant_price_delta_paise: i64,
    pub variant_duration_delta_minutes: i32,
    pub addon_price_paise: i64,
    pub addon_duration_minutes: i64,
    pub selected_addon_count: i64,
    pub rule_id: Option<String>,
    pub rule_name: Option<String>,
    pub adjustment_bps: i32,
}

pub struct CreateService<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub name: &'a str,
    pub category: &'a str,
    pub duration_minutes: i32,
    pub price_paise: i64,
    pub gst_percent: i32,
    pub sac_code: &'a str,
    pub wait_time_minutes: i32,
    pub cleanup_time_minutes: i32,
    pub buffer_time_minutes: i32,
    pub product_consumption_json: &'a str,
    pub staff_ids: &'a [String],
    pub variants: &'a [ServiceVariantInput],
    pub addons: &'a [ServiceAddonInput],
    pub staff_prices: &'a [ServiceStaffPriceInput],
    pub price_rules: &'a [ServicePriceRuleInput],
    pub active: bool,
}

pub struct UpdateService<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub name: Option<&'a str>,
    pub category: Option<&'a str>,
    pub duration_minutes: Option<i32>,
    pub price_paise: Option<i64>,
    pub gst_percent: Option<i32>,
    pub sac_code: Option<&'a str>,
    pub wait_time_minutes: Option<i32>,
    pub cleanup_time_minutes: Option<i32>,
    pub buffer_time_minutes: Option<i32>,
    pub product_consumption_json: Option<&'a str>,
    pub staff_ids: Option<&'a [String]>,
    pub variants: Option<&'a [ServiceVariantInput]>,
    pub addons: Option<&'a [ServiceAddonInput]>,
    pub staff_prices: Option<&'a [ServiceStaffPriceInput]>,
    pub price_rules: Option<&'a [ServicePriceRuleInput]>,
    pub active: Option<bool>,
    pub franchise_override_fields: &'a [String],
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    q: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ServiceRecord>, sqlx::Error> {
    sqlx::query_as::<_, ServiceRecord>(&select_sql(
        r#"
        WHERE service.tenant_id = $1
          AND service.branch_id = $2
          AND (
            $3 = ''
            OR service.name ILIKE '%' || $3 || '%'
            OR service.category ILIKE '%' || $3 || '%'
          )
        ORDER BY service.created_at DESC
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
) -> Result<Option<ServiceRecord>, sqlx::Error> {
    sqlx::query_as::<_, ServiceRecord>(&select_sql(
        r#"
        WHERE service.tenant_id = $1 AND service.branch_id = $2 AND service.id = $3
        LIMIT 1
        "#,
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn get_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT settings_json::TEXT FROM service_settings WHERE tenant_id=$1 AND branch_id=$2",
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
    sqlx::query_scalar(
        r#"
        INSERT INTO service_settings (tenant_id, branch_id, settings_json)
        VALUES ($1, $2, $3::JSONB)
        ON CONFLICT (tenant_id, branch_id) DO UPDATE
          SET settings_json=EXCLUDED.settings_json, updated_at=NOW()
        RETURNING settings_json::TEXT
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(settings_json)
    .fetch_one(db)
    .await
}

pub async fn service_name_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    name: &str,
    exclude_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM services WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(name)=LOWER($3) AND ($4='' OR id<>$4))",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(name)
    .bind(exclude_id)
    .fetch_one(db)
    .await
}

pub async fn create(db: &PgPool, input: CreateService<'_>) -> Result<ServiceRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO services (
          tenant_id, branch_id, name, category, duration_minutes, price_paise,
          gst_percent, sac_code, wait_time_minutes, cleanup_time_minutes, buffer_time_minutes,
          product_consumption_json, active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
        RETURNING id
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.name)
    .bind(input.category)
    .bind(input.duration_minutes)
    .bind(input.price_paise)
    .bind(input.gst_percent)
    .bind(input.sac_code)
    .bind(input.wait_time_minutes)
    .bind(input.cleanup_time_minutes)
    .bind(input.buffer_time_minutes)
    .bind(input.product_consumption_json)
    .bind(input.active)
    .fetch_one(&mut *tx)
    .await?;

    replace_staff_assignments(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        &id,
        input.staff_ids,
    )
    .await?;
    replace_variants(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        &id,
        input.variants,
    )
    .await?;
    replace_addons(&mut tx, input.tenant_id, input.branch_id, &id, input.addons).await?;
    replace_staff_prices(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        &id,
        input.staff_prices,
    )
    .await?;
    replace_price_rules(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        &id,
        input.price_rules,
    )
    .await?;
    let row = fetch_service(&mut tx, input.tenant_id, input.branch_id, &id).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn update(
    db: &PgPool,
    input: UpdateService<'_>,
) -> Result<Option<ServiceRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar::<_, String>(
        r#"
        UPDATE services
        SET
          name = COALESCE($4, name),
          category = COALESCE($5, category),
          duration_minutes = COALESCE($6, duration_minutes),
          price_paise = COALESCE($7, price_paise),
          gst_percent = COALESCE($8, gst_percent),
          sac_code = COALESCE($9, sac_code),
          wait_time_minutes = COALESCE($10, wait_time_minutes),
          cleanup_time_minutes = COALESCE($11, cleanup_time_minutes),
          buffer_time_minutes = COALESCE($12, buffer_time_minutes),
          product_consumption_json = COALESCE($13::jsonb, product_consumption_json),
          active = COALESCE($14, active),
          franchise_override_fields = CASE
            WHEN central_master_service_id IS NULL THEN franchise_override_fields
            ELSE ARRAY(SELECT DISTINCT UNNEST(franchise_override_fields || $15::TEXT[]))
          END,
          updated_at = NOW()
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        RETURNING id
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.id)
    .bind(input.name)
    .bind(input.category)
    .bind(input.duration_minutes)
    .bind(input.price_paise)
    .bind(input.gst_percent)
    .bind(input.sac_code)
    .bind(input.wait_time_minutes)
    .bind(input.cleanup_time_minutes)
    .bind(input.buffer_time_minutes)
    .bind(input.product_consumption_json)
    .bind(input.active)
    .bind(input.franchise_override_fields)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(id) = id else {
        return Ok(None);
    };
    if let Some(staff_ids) = input.staff_ids {
        replace_staff_assignments(&mut tx, input.tenant_id, input.branch_id, &id, staff_ids)
            .await?;
    }
    if let Some(variants) = input.variants {
        replace_variants(&mut tx, input.tenant_id, input.branch_id, &id, variants).await?;
    }
    if let Some(addons) = input.addons {
        replace_addons(&mut tx, input.tenant_id, input.branch_id, &id, addons).await?;
    }
    if let Some(staff_prices) = input.staff_prices {
        replace_staff_prices(&mut tx, input.tenant_id, input.branch_id, &id, staff_prices).await?;
    }
    if let Some(price_rules) = input.price_rules {
        replace_price_rules(&mut tx, input.tenant_id, input.branch_id, &id, price_rules).await?;
    }
    let row = fetch_service(&mut tx, input.tenant_id, input.branch_id, &id).await?;
    tx.commit().await?;
    Ok(Some(row))
}

pub async fn pricing_source(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    staff_id: &str,
    variant_id: &str,
    addon_ids: &[String],
    starts_at: DateTime<Utc>,
) -> Result<Option<ServicePricingSource>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT service.id AS service_id,
               service.price_paise::BIGINT AS base_price_paise,
               service.duration_minutes AS base_duration_minutes,
               staff_price.price_paise::BIGINT AS staff_price_paise,
               variant.id AS variant_id,
               COALESCE(variant.price_delta_paise,0)::BIGINT AS variant_price_delta_paise,
               COALESCE(variant.duration_delta_minutes,0)::INTEGER AS variant_duration_delta_minutes,
               COALESCE(addons.price_paise,0)::BIGINT AS addon_price_paise,
               COALESCE(addons.duration_minutes,0)::BIGINT AS addon_duration_minutes,
               COALESCE(addons.selected_count,0)::BIGINT AS selected_addon_count,
               price_rule.id AS rule_id,
               price_rule.name AS rule_name,
               COALESCE(price_rule.adjustment_bps,0)::INTEGER AS adjustment_bps
          FROM services service
          LEFT JOIN LATERAL (
            SELECT price.price_paise
              FROM service_staff_prices price
             WHERE price.tenant_id=service.tenant_id AND price.branch_id=service.branch_id
               AND price.service_id=service.id AND price.staff_id=NULLIF($4,'') AND price.active=TRUE
             LIMIT 1
          ) staff_price ON TRUE
          LEFT JOIN LATERAL (
            SELECT item.id,item.price_delta_paise,item.duration_delta_minutes
              FROM service_variants item
             WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id
               AND item.service_id=service.id AND item.id=NULLIF($5,'') AND item.active=TRUE
             LIMIT 1
          ) variant ON TRUE
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(item.price_paise),0)::BIGINT AS price_paise,
                   COALESCE(SUM(item.duration_minutes),0)::BIGINT AS duration_minutes,
                   COUNT(*)::BIGINT AS selected_count
              FROM service_addons item
             WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id
               AND item.service_id=service.id AND item.active=TRUE AND item.id=ANY($6)
          ) addons ON TRUE
          LEFT JOIN LATERAL (
            SELECT rule.id,rule.name,rule.adjustment_bps
              FROM service_price_rules rule
             WHERE rule.tenant_id=service.tenant_id AND rule.branch_id=service.branch_id
               AND rule.service_id=service.id AND rule.active=TRUE
               AND EXTRACT(DOW FROM $7 AT TIME ZONE 'Asia/Kolkata')::SMALLINT=ANY(rule.days_of_week)
               AND (
                 (rule.start_time < rule.end_time AND ($7 AT TIME ZONE 'Asia/Kolkata')::TIME >= rule.start_time AND ($7 AT TIME ZONE 'Asia/Kolkata')::TIME < rule.end_time)
                 OR
                 (rule.start_time > rule.end_time AND (($7 AT TIME ZONE 'Asia/Kolkata')::TIME >= rule.start_time OR ($7 AT TIME ZONE 'Asia/Kolkata')::TIME < rule.end_time))
               )
             ORDER BY rule.priority DESC,rule.created_at,rule.id
             LIMIT 1
          ) price_rule ON TRUE
         WHERE service.tenant_id=$1 AND service.branch_id=$2 AND service.id=$3 AND service.active=TRUE
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .bind(staff_id)
    .bind(variant_id)
    .bind(addon_ids)
    .bind(starts_at)
    .fetch_optional(db)
    .await
}

pub async fn staff_ids_belong_to_scope(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
) -> Result<bool, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(true);
    }
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT id) FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=ANY($3)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_ids)
    .fetch_one(db)
    .await?;
    Ok(count == staff_ids.len() as i64)
}

async fn replace_staff_assignments(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    staff_ids: &[String],
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM staff_service_assignments WHERE tenant_id=$1 AND branch_id=$2 AND service_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .execute(&mut **tx)
    .await?;
    if !staff_ids.is_empty() {
        sqlx::query(
            r#"
            INSERT INTO staff_service_assignments (tenant_id, branch_id, staff_id, service_id)
            SELECT $1, $2, assigned.staff_id, $3
            FROM UNNEST($4::TEXT[]) AS assigned(staff_id)
            "#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(service_id)
        .bind(staff_ids)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

async fn replace_variants(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    rows: &[ServiceVariantInput],
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM service_variants WHERE tenant_id=$1 AND branch_id=$2 AND service_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .execute(&mut **tx)
    .await?;
    for row in rows {
        sqlx::query("INSERT INTO service_variants(id,tenant_id,branch_id,service_id,name,price_delta_paise,duration_delta_minutes,active) VALUES(COALESCE(NULLIF($4,''),gen_random_uuid()::TEXT),$1,$2,$3,$5,$6,$7,$8)")
            .bind(tenant_id).bind(branch_id).bind(service_id).bind(&row.id).bind(&row.name)
            .bind(row.price_delta_paise).bind(row.duration_delta_minutes).bind(row.active)
            .execute(&mut **tx).await?;
    }
    Ok(())
}

async fn replace_addons(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    rows: &[ServiceAddonInput],
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM service_addons WHERE tenant_id=$1 AND branch_id=$2 AND service_id=$3")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(service_id)
        .execute(&mut **tx)
        .await?;
    for row in rows {
        sqlx::query("INSERT INTO service_addons(id,tenant_id,branch_id,service_id,name,price_paise,duration_minutes,active) VALUES(COALESCE(NULLIF($4,''),gen_random_uuid()::TEXT),$1,$2,$3,$5,$6,$7,$8)")
            .bind(tenant_id).bind(branch_id).bind(service_id).bind(&row.id).bind(&row.name)
            .bind(row.price_paise).bind(row.duration_minutes).bind(row.active)
            .execute(&mut **tx).await?;
    }
    Ok(())
}

async fn replace_staff_prices(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    rows: &[ServiceStaffPriceInput],
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM service_staff_prices WHERE tenant_id=$1 AND branch_id=$2 AND service_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .execute(&mut **tx)
    .await?;
    for row in rows {
        sqlx::query("INSERT INTO service_staff_prices(id,tenant_id,branch_id,service_id,staff_id,price_paise,active) VALUES(COALESCE(NULLIF($4,''),gen_random_uuid()::TEXT),$1,$2,$3,$5,$6,$7)")
            .bind(tenant_id).bind(branch_id).bind(service_id).bind(&row.id).bind(&row.staff_id)
            .bind(row.price_paise).bind(row.active).execute(&mut **tx).await?;
    }
    Ok(())
}

async fn replace_price_rules(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    rows: &[ServicePriceRuleInput],
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM service_price_rules WHERE tenant_id=$1 AND branch_id=$2 AND service_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .execute(&mut **tx)
    .await?;
    for row in rows {
        sqlx::query("INSERT INTO service_price_rules(id,tenant_id,branch_id,service_id,name,days_of_week,start_time,end_time,adjustment_bps,priority,active) VALUES(COALESCE(NULLIF($4,''),gen_random_uuid()::TEXT),$1,$2,$3,$5,$6,$7,$8,$9,$10,$11)")
            .bind(tenant_id).bind(branch_id).bind(service_id).bind(&row.id).bind(&row.name)
            .bind(&row.days_of_week).bind(row.start_time).bind(row.end_time).bind(row.adjustment_bps)
            .bind(row.priority).bind(row.active).execute(&mut **tx).await?;
    }
    Ok(())
}

async fn fetch_service(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<ServiceRecord, sqlx::Error> {
    sqlx::query_as::<_, ServiceRecord>(&select_sql(
        "WHERE service.tenant_id=$1 AND service.branch_id=$2 AND service.id=$3",
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_one(&mut **tx)
    .await
}

fn select_sql(where_clause: &str) -> String {
    format!(
        r#"
        SELECT
          service.id, service.tenant_id, service.branch_id, service.name, service.category,
          service.duration_minutes, service.price_paise::BIGINT AS price_paise,
          service.gst_percent, service.sac_code, service.wait_time_minutes,
          service.cleanup_time_minutes, service.buffer_time_minutes,
          service.product_consumption_json::TEXT AS product_consumption_json,
          COALESCE((
            SELECT JSONB_AGG(assignment.staff_id ORDER BY assignment.staff_id)
            FROM staff_service_assignments assignment
            WHERE assignment.tenant_id=service.tenant_id
              AND assignment.branch_id=service.branch_id
              AND assignment.service_id=service.id
          ), '[]'::JSONB)::TEXT AS staff_ids_json,
          COALESCE((
            SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
              'id',item.id,'name',item.name,'priceDeltaPaise',item.price_delta_paise,
              'durationDeltaMinutes',item.duration_delta_minutes,'active',item.active
            ) ORDER BY item.created_at,item.id)
            FROM service_variants item
            WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id
          ), '[]'::JSONB)::TEXT AS variants_json,
          COALESCE((
            SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
              'id',item.id,'name',item.name,'pricePaise',item.price_paise,
              'durationMinutes',item.duration_minutes,'active',item.active
            ) ORDER BY item.created_at,item.id)
            FROM service_addons item
            WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id
          ), '[]'::JSONB)::TEXT AS addons_json,
          COALESCE((
            SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
              'id',item.id,'staffId',item.staff_id,'pricePaise',item.price_paise,'active',item.active
            ) ORDER BY item.created_at,item.id)
            FROM service_staff_prices item
            WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id
          ), '[]'::JSONB)::TEXT AS staff_prices_json,
          COALESCE((
            SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
              'id',item.id,'name',item.name,'daysOfWeek',item.days_of_week,
              'startTime',TO_CHAR(item.start_time,'HH24:MI'),'endTime',TO_CHAR(item.end_time,'HH24:MI'),
              'adjustmentBps',item.adjustment_bps,'priority',item.priority,'active',item.active
            ) ORDER BY item.priority DESC,item.created_at,item.id)
            FROM service_price_rules item
            WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id
          ), '[]'::JSONB)::TEXT AS price_rules_json,
          service.central_master_service_id,service.franchise_override_fields,
          service.active, service.created_at, service.updated_at
        FROM services service
        {where_clause}
        "#
    )
}

pub async fn allowed_franchise_overrides(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
) -> Result<Option<Vec<String>>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT policy.allowed_override_fields
             FROM services service
             JOIN franchise_policies policy ON policy.tenant_id=service.tenant_id
            WHERE service.tenant_id=$1 AND service.branch_id=$2 AND service.id=$3
              AND service.central_master_service_id IS NOT NULL"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .fetch_optional(db)
    .await
}
