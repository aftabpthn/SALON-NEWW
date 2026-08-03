use chrono::{DateTime, NaiveTime, Utc};
use serde_json::json;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

use super::auth_repository::{self, AuthAuditInput};

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
    pub processing_time_minutes: i32,
    pub recovery_time_minutes: i32,
    pub other_fee_paise: i64,
    pub deposit_percent: i32,
    pub cancellation_cutoff_hours: i32,
    pub cancellation_fee_paise: i64,
    pub commission_bps: i32,
    pub revenue_allocation_json: String,
    pub channel_availability_json: String,
    pub product_consumption_json: String,
    pub staff_ids_json: String,
    pub variants_json: String,
    pub addons_json: String,
    pub staff_prices_json: String,
    pub price_rules_json: String,
    pub audience_prices_json: String,
    pub resource_requirements_json: String,
    pub central_master_service_id: Option<String>,
    pub franchise_override_fields: Vec<String>,
    pub active: bool,
    pub version: i32,
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
    pub channel: String,
    pub min_demand_percent: i32,
    pub active: bool,
}

#[derive(Debug, Clone)]
pub struct ServiceAudiencePriceInput {
    pub id: String,
    pub audience_type: String,
    pub audience_id: String,
    pub price_paise: i64,
    pub active: bool,
}

#[derive(Debug, Clone)]
pub struct ServiceResourceRequirementInput {
    pub id: String,
    pub resource_id: String,
    pub required: bool,
}

#[derive(Debug, Clone, FromRow)]
pub struct ServicePricingSource {
    pub service_id: String,
    pub base_price_paise: i64,
    pub base_duration_minutes: i32,
    pub processing_time_minutes: i32,
    pub recovery_time_minutes: i32,
    pub cleanup_time_minutes: i32,
    pub staff_price_paise: Option<i64>,
    pub pricing_level_id: Option<String>,
    pub pricing_level_name: Option<String>,
    pub pricing_level_price_paise: Option<i64>,
    pub variant_id: Option<String>,
    pub variant_price_delta_paise: i64,
    pub variant_duration_delta_minutes: i32,
    pub addon_price_paise: i64,
    pub addon_duration_minutes: i64,
    pub selected_addon_count: i64,
    pub rule_id: Option<String>,
    pub rule_name: Option<String>,
    pub adjustment_bps: i32,
    pub audience_type: Option<String>,
    pub audience_id: Option<String>,
    pub audience_price_paise: Option<i64>,
    pub other_fee_paise: i64,
    pub deposit_percent: i32,
    pub cancellation_cutoff_hours: i32,
    pub cancellation_fee_paise: i64,
    pub commission_bps: i32,
    pub demand_percent: i32,
    pub channel: String,
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
    pub processing_time_minutes: i32,
    pub recovery_time_minutes: i32,
    pub other_fee_paise: i64,
    pub deposit_percent: i32,
    pub cancellation_cutoff_hours: i32,
    pub cancellation_fee_paise: i64,
    pub commission_bps: i32,
    pub revenue_allocation_json: &'a str,
    pub channel_availability_json: &'a str,
    pub product_consumption_json: &'a str,
    pub staff_ids: &'a [String],
    pub variants: &'a [ServiceVariantInput],
    pub addons: &'a [ServiceAddonInput],
    pub staff_prices: &'a [ServiceStaffPriceInput],
    pub price_rules: &'a [ServicePriceRuleInput],
    pub audience_prices: &'a [ServiceAudiencePriceInput],
    pub resource_requirements: &'a [ServiceResourceRequirementInput],
    pub active: bool,
    pub actor_user_id: &'a str,
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
    pub processing_time_minutes: Option<i32>,
    pub recovery_time_minutes: Option<i32>,
    pub other_fee_paise: Option<i64>,
    pub deposit_percent: Option<i32>,
    pub cancellation_cutoff_hours: Option<i32>,
    pub cancellation_fee_paise: Option<i64>,
    pub commission_bps: Option<i32>,
    pub revenue_allocation_json: Option<&'a str>,
    pub channel_availability_json: Option<&'a str>,
    pub product_consumption_json: Option<&'a str>,
    pub staff_ids: Option<&'a [String]>,
    pub variants: Option<&'a [ServiceVariantInput]>,
    pub addons: Option<&'a [ServiceAddonInput]>,
    pub staff_prices: Option<&'a [ServiceStaffPriceInput]>,
    pub price_rules: Option<&'a [ServicePriceRuleInput]>,
    pub audience_prices: Option<&'a [ServiceAudiencePriceInput]>,
    pub resource_requirements: Option<&'a [ServiceResourceRequirementInput]>,
    pub active: Option<bool>,
    pub franchise_override_fields: &'a [String],
    pub actor_user_id: &'a str,
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
          processing_time_minutes,recovery_time_minutes,other_fee_paise,deposit_percent,
          cancellation_cutoff_hours,cancellation_fee_paise,commission_bps,
          revenue_allocation_json,channel_availability_json,product_consumption_json,active
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                $19::jsonb,$20::jsonb,$21::jsonb,$22)
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
    .bind(input.processing_time_minutes)
    .bind(input.recovery_time_minutes)
    .bind(input.other_fee_paise)
    .bind(input.deposit_percent)
    .bind(input.cancellation_cutoff_hours)
    .bind(input.cancellation_fee_paise)
    .bind(input.commission_bps)
    .bind(input.revenue_allocation_json)
    .bind(input.channel_availability_json)
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
    replace_audience_prices(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        &id,
        input.audience_prices,
    )
    .await?;
    replace_resource_requirements(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        &id,
        input.resource_requirements,
    )
    .await?;
    snapshot_and_audit(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        &id,
        input.actor_user_id,
        "service.catalog.created",
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
          processing_time_minutes = COALESCE($13, processing_time_minutes),
          recovery_time_minutes = COALESCE($14, recovery_time_minutes),
          other_fee_paise = COALESCE($15, other_fee_paise),
          deposit_percent = COALESCE($16, deposit_percent),
          cancellation_cutoff_hours = COALESCE($17, cancellation_cutoff_hours),
          cancellation_fee_paise = COALESCE($18, cancellation_fee_paise),
          commission_bps = COALESCE($19, commission_bps),
          revenue_allocation_json = COALESCE($20::jsonb, revenue_allocation_json),
          channel_availability_json = COALESCE($21::jsonb, channel_availability_json),
          product_consumption_json = COALESCE($22::jsonb, product_consumption_json),
          active = COALESCE($23, active),
          version = version + 1,
          franchise_override_fields = CASE
            WHEN central_master_service_id IS NULL THEN franchise_override_fields
            ELSE ARRAY(SELECT DISTINCT UNNEST(franchise_override_fields || $24::TEXT[]))
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
    .bind(input.processing_time_minutes)
    .bind(input.recovery_time_minutes)
    .bind(input.other_fee_paise)
    .bind(input.deposit_percent)
    .bind(input.cancellation_cutoff_hours)
    .bind(input.cancellation_fee_paise)
    .bind(input.commission_bps)
    .bind(input.revenue_allocation_json)
    .bind(input.channel_availability_json)
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
    if let Some(rows) = input.audience_prices {
        replace_audience_prices(&mut tx, input.tenant_id, input.branch_id, &id, rows).await?;
    }
    if let Some(rows) = input.resource_requirements {
        replace_resource_requirements(&mut tx, input.tenant_id, input.branch_id, &id, rows).await?;
    }
    snapshot_and_audit(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        &id,
        input.actor_user_id,
        "service.catalog.updated",
    )
    .await?;
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
    client_id: &str,
    channel: &str,
) -> Result<Option<ServicePricingSource>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT service.id AS service_id,
               service.price_paise::BIGINT AS base_price_paise,
               service.duration_minutes AS base_duration_minutes,
               service.processing_time_minutes,service.recovery_time_minutes,service.cleanup_time_minutes,
               staff_price.price_paise::BIGINT AS staff_price_paise,
               pricing_level.id AS pricing_level_id,
               pricing_level.name AS pricing_level_name,
               level_price.price_paise::BIGINT AS pricing_level_price_paise,
               variant.id AS variant_id,
               COALESCE(variant.price_delta_paise,0)::BIGINT AS variant_price_delta_paise,
               COALESCE(variant.duration_delta_minutes,0)::INTEGER AS variant_duration_delta_minutes,
               COALESCE(addons.price_paise,0)::BIGINT AS addon_price_paise,
               COALESCE(addons.duration_minutes,0)::BIGINT AS addon_duration_minutes,
               COALESCE(addons.selected_count,0)::BIGINT AS selected_addon_count,
               price_rule.id AS rule_id,
               price_rule.name AS rule_name,
               COALESCE(price_rule.adjustment_bps,0)::INTEGER AS adjustment_bps,
               audience.audience_type,audience.audience_id,audience.price_paise::BIGINT AS audience_price_paise,
               service.other_fee_paise::BIGINT AS other_fee_paise,service.deposit_percent,
               service.cancellation_cutoff_hours,service.cancellation_fee_paise::BIGINT AS cancellation_fee_paise,
               service.commission_bps,COALESCE(demand.percent,0)::INTEGER AS demand_percent,$9::TEXT AS channel
          FROM services service
          LEFT JOIN LATERAL (
            SELECT price.price_paise
              FROM service_staff_prices price
             WHERE price.tenant_id=service.tenant_id AND price.branch_id=service.branch_id
               AND price.service_id=service.id AND price.staff_id=NULLIF($4,'') AND price.active=TRUE
             LIMIT 1
          ) staff_price ON TRUE
          LEFT JOIN staff staff_member
            ON staff_member.tenant_id=service.tenant_id
           AND staff_member.branch_id=service.branch_id
           AND staff_member.id=NULLIF($4,'')
           AND staff_member.active=TRUE
          LEFT JOIN staff_profiles staff_profile
            ON staff_profile.tenant_id=service.tenant_id
           AND staff_profile.branch_id=service.branch_id
           AND staff_profile.staff_id=staff_member.id
          LEFT JOIN staff_pricing_levels pricing_level
            ON pricing_level.tenant_id=service.tenant_id
           AND pricing_level.branch_id=service.branch_id
           AND pricing_level.id=staff_profile.pricing_level_id
           AND pricing_level.active=TRUE
          LEFT JOIN LATERAL (
            SELECT price.price_paise
              FROM service_pricing_level_prices price
             WHERE price.tenant_id=service.tenant_id AND price.branch_id=service.branch_id
               AND price.service_id=service.id AND price.pricing_level_id=pricing_level.id AND price.active=TRUE
             LIMIT 1
          ) level_price ON TRUE
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
            SELECT price.audience_type,price.audience_id,price.price_paise
              FROM service_audience_prices price
             WHERE price.tenant_id=service.tenant_id AND price.branch_id=service.branch_id
               AND price.service_id=service.id AND price.active=TRUE AND NULLIF($8,'') IS NOT NULL
               AND (
                 (price.audience_type='guest' AND price.audience_id=$8)
                 OR (price.audience_type='membership' AND EXISTS(
                   SELECT 1 FROM client_memberships owned WHERE owned.tenant_id=service.tenant_id
                     AND owned.branch_id=service.branch_id AND owned.client_id=$8
                     AND owned.membership_id=price.audience_id AND owned.active=TRUE
                     AND (owned.expires_at IS NULL OR owned.expires_at>NOW())
                 ))
                 OR (price.audience_type='package' AND EXISTS(
                   SELECT 1 FROM client_package_credits owned WHERE owned.tenant_id=service.tenant_id
                     AND owned.branch_id=service.branch_id AND owned.client_id=$8
                     AND owned.package_id=price.audience_id AND owned.service_id=service.id
                     AND owned.active=TRUE AND owned.remaining_qty>0
                     AND (owned.expires_at IS NULL OR owned.expires_at>=CURRENT_DATE)
                 ))
               )
             ORDER BY CASE price.audience_type WHEN 'guest' THEN 3 WHEN 'package' THEN 2 ELSE 1 END DESC,
                      price.created_at,price.id LIMIT 1
          ) audience ON TRUE
          LEFT JOIN LATERAL (
            SELECT LEAST(100,ROUND(100.0*COUNT(DISTINCT appointment.staff_id)/GREATEST((
              SELECT COUNT(*) FROM staff active_staff WHERE active_staff.tenant_id=service.tenant_id
                AND active_staff.branch_id=service.branch_id AND active_staff.active=TRUE
            ),1)))::INTEGER AS percent
            FROM appointments appointment
            WHERE appointment.tenant_id=service.tenant_id AND appointment.branch_id=service.branch_id
              AND appointment.status NOT IN ('cancelled','no-show')
              AND appointment.start_at<($7+INTERVAL '1 minute') AND appointment.end_at>$7
          ) demand ON TRUE
          LEFT JOIN LATERAL (
            SELECT rule.id,rule.name,rule.adjustment_bps
              FROM service_price_rules rule
             WHERE rule.tenant_id=service.tenant_id AND rule.branch_id=service.branch_id
               AND rule.service_id=service.id AND rule.active=TRUE
               AND (rule.channel='all' OR rule.channel=$9)
               AND rule.min_demand_percent<=COALESCE(demand.percent,0)
               AND EXTRACT(DOW FROM $7 AT TIME ZONE COALESCE((SELECT branch.time_zone FROM branches branch WHERE branch.id::TEXT=service.branch_id LIMIT 1),'Asia/Kolkata'))::SMALLINT=ANY(rule.days_of_week)
               AND (
                 (rule.start_time < rule.end_time AND ($7 AT TIME ZONE COALESCE((SELECT branch.time_zone FROM branches branch WHERE branch.id::TEXT=service.branch_id LIMIT 1),'Asia/Kolkata'))::TIME >= rule.start_time AND ($7 AT TIME ZONE COALESCE((SELECT branch.time_zone FROM branches branch WHERE branch.id::TEXT=service.branch_id LIMIT 1),'Asia/Kolkata'))::TIME < rule.end_time)
                 OR (rule.start_time > rule.end_time AND (($7 AT TIME ZONE COALESCE((SELECT branch.time_zone FROM branches branch WHERE branch.id::TEXT=service.branch_id LIMIT 1),'Asia/Kolkata'))::TIME >= rule.start_time OR ($7 AT TIME ZONE COALESCE((SELECT branch.time_zone FROM branches branch WHERE branch.id::TEXT=service.branch_id LIMIT 1),'Asia/Kolkata'))::TIME < rule.end_time))
               )
             ORDER BY rule.priority DESC,rule.created_at,rule.id
             LIMIT 1
          ) price_rule ON TRUE
         WHERE service.tenant_id=$1 AND service.branch_id=$2 AND service.id=$3 AND service.active=TRUE
           AND COALESCE((service.channel_availability_json->>$9)::BOOLEAN,FALSE)=TRUE
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .bind(staff_id)
    .bind(variant_id)
    .bind(addon_ids)
    .bind(starts_at)
    .bind(client_id)
    .bind(channel)
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
        sqlx::query("INSERT INTO service_price_rules(id,tenant_id,branch_id,service_id,name,days_of_week,start_time,end_time,adjustment_bps,priority,channel,min_demand_percent,active) VALUES(COALESCE(NULLIF($4,''),gen_random_uuid()::TEXT),$1,$2,$3,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
            .bind(tenant_id).bind(branch_id).bind(service_id).bind(&row.id).bind(&row.name)
            .bind(&row.days_of_week).bind(row.start_time).bind(row.end_time).bind(row.adjustment_bps)
            .bind(row.priority).bind(&row.channel).bind(row.min_demand_percent).bind(row.active).execute(&mut **tx).await?;
    }
    Ok(())
}

async fn replace_audience_prices(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    rows: &[ServiceAudiencePriceInput],
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM service_audience_prices WHERE tenant_id=$1 AND branch_id=$2 AND service_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .execute(&mut **tx)
    .await?;
    for row in rows {
        sqlx::query("INSERT INTO service_audience_prices(id,tenant_id,branch_id,service_id,audience_type,audience_id,price_paise,active) VALUES(COALESCE(NULLIF($4,''),gen_random_uuid()::TEXT),$1,$2,$3,$5,$6,$7,$8)")
            .bind(tenant_id).bind(branch_id).bind(service_id).bind(&row.id).bind(&row.audience_type)
            .bind(&row.audience_id).bind(row.price_paise).bind(row.active).execute(&mut **tx).await?;
    }
    Ok(())
}

async fn replace_resource_requirements(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    rows: &[ServiceResourceRequirementInput],
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM service_resource_requirements WHERE tenant_id=$1 AND branch_id=$2 AND service_id=$3")
        .bind(tenant_id).bind(branch_id).bind(service_id).execute(&mut **tx).await?;
    for row in rows {
        sqlx::query("INSERT INTO service_resource_requirements(id,tenant_id,branch_id,service_id,resource_id,required) SELECT COALESCE(NULLIF($4,''),gen_random_uuid()::TEXT),$1,$2,$3,resource.id,$5 FROM appointment_resources resource WHERE resource.id=$6 AND resource.tenant_id=$1 AND resource.branch_id=$2 AND resource.active=TRUE")
            .bind(tenant_id).bind(branch_id).bind(service_id).bind(&row.id).bind(row.required)
            .bind(&row.resource_id).execute(&mut **tx).await?;
    }
    Ok(())
}

async fn snapshot_and_audit(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    actor_user_id: &str,
    event_type: &str,
) -> Result<(), sqlx::Error> {
    let version = sqlx::query_scalar::<_, i32>(
        r#"INSERT INTO service_catalog_versions(tenant_id,branch_id,service_id,version,snapshot_json,actor_user_id)
           SELECT service.tenant_id,service.branch_id,service.id,service.version,
             to_jsonb(service) || jsonb_build_object(
               'staffIds',COALESCE((SELECT jsonb_agg(item.staff_id ORDER BY item.staff_id) FROM staff_service_assignments item WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id),'[]'::jsonb),
               'variants',COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.created_at,item.id) FROM service_variants item WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id),'[]'::jsonb),
               'addons',COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.created_at,item.id) FROM service_addons item WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id),'[]'::jsonb),
               'staffPrices',COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.created_at,item.id) FROM service_staff_prices item WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id),'[]'::jsonb),
               'priceRules',COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.priority DESC,item.created_at,item.id) FROM service_price_rules item WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id),'[]'::jsonb),
               'pricingLevelPrices',COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.created_at,item.id) FROM service_pricing_level_prices item WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id),'[]'::jsonb),
               'audiencePrices',COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.created_at,item.id) FROM service_audience_prices item WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id),'[]'::jsonb),
               'resourceRequirements',COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.created_at,item.id) FROM service_resource_requirements item WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id),'[]'::jsonb)
             ),$4
           FROM services service WHERE service.tenant_id=$1 AND service.branch_id=$2 AND service.id=$3
           ON CONFLICT(tenant_id,branch_id,service_id,version) DO UPDATE SET snapshot_json=EXCLUDED.snapshot_json,actor_user_id=EXCLUDED.actor_user_id
           RETURNING version"#,
    ).bind(tenant_id).bind(branch_id).bind(service_id).bind(actor_user_id).fetch_one(&mut **tx).await?;
    auth_repository::audit_tx(
        tx,
        AuthAuditInput {
            tenant_id,
            user_id: (!actor_user_id.is_empty()).then_some(actor_user_id),
            session_id: None,
            branch_id: Some(branch_id),
            identity: None,
            event_type,
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({"serviceId":service_id,"version":version}),
        },
    )
    .await
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
          service.processing_time_minutes,service.recovery_time_minutes,
          service.other_fee_paise::BIGINT AS other_fee_paise,service.deposit_percent,
          service.cancellation_cutoff_hours,service.cancellation_fee_paise::BIGINT AS cancellation_fee_paise,
          service.commission_bps,service.revenue_allocation_json::TEXT AS revenue_allocation_json,
          service.channel_availability_json::TEXT AS channel_availability_json,
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
              'adjustmentBps',item.adjustment_bps,'priority',item.priority,'channel',item.channel,
              'minDemandPercent',item.min_demand_percent,'active',item.active
            ) ORDER BY item.priority DESC,item.created_at,item.id)
            FROM service_price_rules item
            WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id
          ), '[]'::JSONB)::TEXT AS price_rules_json,
          COALESCE((
            SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
              'id',item.id,'audienceType',item.audience_type,'audienceId',item.audience_id,
              'pricePaise',item.price_paise,'active',item.active
            ) ORDER BY item.created_at,item.id)
            FROM service_audience_prices item
            WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id
          ), '[]'::JSONB)::TEXT AS audience_prices_json,
          COALESCE((
            SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
              'id',item.id,'resourceId',item.resource_id,'required',item.required
            ) ORDER BY item.created_at,item.id)
            FROM service_resource_requirements item
            WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id
          ), '[]'::JSONB)::TEXT AS resource_requirements_json,
          service.central_master_service_id,service.franchise_override_fields,
          service.active,service.version,service.created_at,service.updated_at
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
