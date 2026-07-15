use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct HappyHourRuleAnalysisRecord {
    pub id: String,
    pub name: String,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
    pub weekdays: Vec<i16>,
    pub discount_bps: i32,
    pub eligible_line_types: Vec<String>,
    pub eligible_item_ids: Vec<String>,
    pub eligible_client_categories: Vec<String>,
    pub min_margin_bps: i32,
    pub block_on_unknown_cost: bool,
    pub active: bool,
}

#[derive(Debug, FromRow)]
pub struct HappyHourSimulationServiceRecord {
    pub id: String,
    pub name: String,
    pub price_paise: i64,
    pub known_products: i64,
    pub unit_cost_paise: i64,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HappyHourApprovalRecord {
    pub id: String,
    pub rule_id: String,
    pub rule_name: String,
    pub requested_by: String,
    pub requested_role: String,
    pub requested_discount_bps: i32,
    pub status: String,
    pub note: String,
    pub decision_note: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HappyHourAnomalyRecord {
    pub id: String,
    pub signature: String,
    pub anomaly_type: String,
    pub severity: String,
    pub status: String,
    pub title: String,
    pub description: String,
    pub evidence_json: Value,
    pub detected_at: DateTime<Utc>,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub review_note: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HappyHourBudgetRecord {
    pub id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub budget_paise: i64,
    pub spent_paise: i64,
    pub alert_threshold_bps: i32,
    pub approval_above_bps: i32,
    pub active: bool,
    pub updated_at: DateTime<Utc>,
}

pub struct NewHappyHourAnomaly<'a> {
    pub signature: &'a str,
    pub anomaly_type: &'a str,
    pub severity: &'a str,
    pub title: &'a str,
    pub description: &'a str,
    pub evidence: &'a Value,
}

#[derive(Debug, FromRow)]
pub struct HappyHourPerformanceRecord {
    pub rule_id: String,
    pub name: String,
    pub active: bool,
    pub applications: i64,
    pub active_applications: i64,
    pub sales_value_paise: i64,
    pub discount_paise: i64,
    pub reversed_discount_paise: i64,
    pub last_applied_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
pub struct NoShowRiskRecord {
    pub client_id: String,
    pub client_name: String,
    pub total_appointments: i64,
    pub no_show_count: i64,
    pub cancellation_count: i64,
    pub completed_count: i64,
}

#[derive(Debug, FromRow)]
pub struct CouponUsageRiskRecord {
    pub coupon_code: String,
    pub client_id: String,
    pub client_name: String,
    pub redemptions: i64,
    pub discount_paise: i64,
    pub last_used_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct CouponLimitRiskRecord {
    pub coupon_id: String,
    pub coupon_code: String,
    pub used_count: i64,
    pub usage_limit: i64,
}

#[derive(Debug, FromRow)]
pub struct InventoryOfferRecord {
    pub item_id: String,
    pub item_name: String,
    pub stock_quantity: i32,
    pub reorder_point: i32,
}

#[derive(Debug, FromRow)]
pub struct StaffOfferRecord {
    pub staff_id: String,
    pub staff_name: String,
    pub schedule_status: String,
    pub scheduled_minutes: i64,
    pub booked_minutes: i64,
    pub appointment_count: i64,
}

#[derive(Debug, FromRow)]
pub struct HappyHourAudienceRecord {
    pub id: String,
    pub audience_key: String,
    pub name: String,
    pub channel: String,
    pub criteria_json: Value,
    pub estimate_count: i64,
    pub previewed_at: Option<DateTime<Utc>>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct AudienceMatchRecord {
    pub client_id: String,
    pub client_name: String,
    pub visit_count: i64,
    pub total_spend_paise: i64,
    pub inactive_days: i32,
    pub total_count: i64,
}

pub struct AudienceCriteriaQuery<'a> {
    pub channel: &'a str,
    pub inactive_days_gte: Option<i32>,
    pub visit_count_gte: Option<i64>,
    pub total_spend_paise_gte: Option<i64>,
    pub birthday_month: Option<i32>,
    pub client_type: &'a str,
    pub sample_limit: i64,
}

pub struct UpsertAudience<'a> {
    pub audience_key: &'a str,
    pub name: &'a str,
    pub channel: &'a str,
    pub criteria_json: &'a Value,
    pub estimate_count: i64,
    pub status: &'a str,
}

#[derive(Debug, FromRow)]
pub struct CampaignLinkContextRecord {
    pub audience_status: String,
    pub audience_channel: String,
    pub rule_active: bool,
    pub coupon_active: Option<bool>,
}

#[derive(Debug, FromRow)]
pub struct HappyHourCampaignLinkRecord {
    pub id: String,
    pub audience_id: String,
    pub audience_name: String,
    pub rule_id: String,
    pub rule_name: String,
    pub coupon_id: Option<String>,
    pub coupon_code: Option<String>,
    pub channel: String,
    pub title: String,
    pub message: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct NewCampaignLink<'a> {
    pub audience_id: &'a str,
    pub rule_id: &'a str,
    pub coupon_id: Option<&'a str>,
    pub channel: &'a str,
    pub title: &'a str,
    pub message: &'a str,
    pub status: &'a str,
}

#[derive(Debug, FromRow)]
pub struct MarketPriceObservationRecord {
    pub id: String,
    pub service_category: String,
    pub competitor_name: String,
    pub observed_price_paise: i64,
    pub observed_on: NaiveDate,
    pub source_url: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

pub struct NewMarketPriceObservation<'a> {
    pub service_category: &'a str,
    pub competitor_name: &'a str,
    pub observed_price_paise: i64,
    pub observed_on: NaiveDate,
    pub source_url: &'a str,
}

#[derive(Debug, FromRow)]
pub struct MarketContextRecord {
    pub our_price_paise: i64,
    pub competitor_avg_paise: i64,
    pub competitor_min_paise: i64,
    pub competitor_max_paise: i64,
    pub competitor_count: i64,
    pub internal_avg_paise: i64,
    pub internal_min_paise: i64,
    pub internal_max_paise: i64,
    pub internal_branch_count: i64,
    pub scheduled_staff: i64,
    pub appointment_count: i64,
}

#[derive(Debug, FromRow)]
pub struct MarketSuggestionRecord {
    pub id: String,
    pub service_category: String,
    pub signal_date: NaiveDate,
    pub hour_slot: i16,
    pub our_price_paise: i64,
    pub base_discount_bps: i32,
    pub max_discount_bps: i32,
    pub benchmark_source: String,
    pub market_avg_paise: i64,
    pub market_min_paise: i64,
    pub market_max_paise: i64,
    pub observation_count: i64,
    pub scheduled_staff: i64,
    pub appointment_count: i64,
    pub occupancy_bps: i64,
    pub price_gap_bps: i64,
    pub market_position: String,
    pub campaign_angle: String,
    pub suggested_discount_bps: i32,
    pub status: String,
    pub reasons_json: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct NewMarketSuggestion<'a> {
    pub service_category: &'a str,
    pub signal_date: NaiveDate,
    pub hour_slot: i16,
    pub our_price_paise: i64,
    pub base_discount_bps: i32,
    pub max_discount_bps: i32,
    pub benchmark_source: &'a str,
    pub market_avg_paise: i64,
    pub market_min_paise: i64,
    pub market_max_paise: i64,
    pub observation_count: i64,
    pub scheduled_staff: i64,
    pub appointment_count: i64,
    pub occupancy_bps: i64,
    pub price_gap_bps: i64,
    pub market_position: &'a str,
    pub campaign_angle: &'a str,
    pub suggested_discount_bps: i32,
    pub reasons_json: &'a Value,
}

#[derive(Debug, FromRow)]
pub struct ContextOfferSignalRecord {
    pub service_price_paise: i64,
    pub scheduled_staff: i64,
    pub appointment_count: i64,
    pub package_count: i64,
    pub avg_package_price_paise: i64,
    pub avg_package_margin_bps: i64,
    pub channel_booking_count: i64,
    pub channel_sales_count: i64,
    pub channel_revenue_paise: i64,
    pub lead_booking_count: i64,
    pub avg_lead_minutes: i64,
    pub lead_no_show_count: i64,
    pub client_exists: bool,
    pub wallet_balance_paise: i64,
    pub wallet_activity_count: i64,
    pub active_membership_count: i64,
    pub membership_expiry_days: i64,
    pub membership_credits_remaining: i64,
    pub reward_points_balance: i64,
    pub visit_count: i64,
    pub total_spend_paise: i64,
}

#[derive(Debug, FromRow)]
pub struct ContextOfferSuggestionRecord {
    pub id: String,
    pub offer_type: String,
    pub service_category: String,
    pub signal_date: NaiveDate,
    pub hour_slot: i16,
    pub service_price_paise: i64,
    pub base_discount_bps: i32,
    pub suggested_discount_bps: i32,
    pub campaign_angle: String,
    pub context_json: Value,
    pub reasons_json: Value,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct NewContextOfferSuggestion<'a> {
    pub offer_type: &'a str,
    pub service_category: &'a str,
    pub signal_date: NaiveDate,
    pub hour_slot: i16,
    pub service_price_paise: i64,
    pub base_discount_bps: i32,
    pub suggested_discount_bps: i32,
    pub campaign_angle: &'a str,
    pub context_json: &'a Value,
    pub reasons_json: &'a Value,
}

#[derive(Debug, FromRow)]
pub struct AutoSunsetPolicyRecord {
    pub expire_past_end_date: bool,
    pub pause_coupons_at_usage_limit: bool,
    pub review_no_end_date_after_days: i32,
    pub auto_apply_expired: bool,
    pub auto_apply_usage_limit: bool,
    pub auto_apply_stale: bool,
    pub status: String,
    pub updated_at: DateTime<Utc>,
}

pub struct UpsertAutoSunsetPolicy<'a> {
    pub expire_past_end_date: bool,
    pub pause_coupons_at_usage_limit: bool,
    pub review_no_end_date_after_days: i32,
    pub auto_apply_expired: bool,
    pub auto_apply_usage_limit: bool,
    pub auto_apply_stale: bool,
    pub status: &'a str,
}

#[derive(Debug, FromRow)]
pub struct AutoSunsetOfferRecord {
    pub offer_type: String,
    pub offer_id: String,
    pub offer_name: String,
    pub ends_at: Option<DateTime<Utc>>,
    pub usage_limit: Option<i64>,
    pub used_count: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct AutoSunsetDecisionRecord {
    pub id: String,
    pub offer_type: String,
    pub offer_id: String,
    pub offer_name: String,
    pub action: String,
    pub reason: String,
    pub severity: String,
    pub status: String,
    pub evidence_json: Value,
    pub source: String,
    pub decided_at: DateTime<Utc>,
    pub applied_at: Option<DateTime<Utc>>,
}

pub struct NewAutoSunsetDecision<'a> {
    pub signature: &'a str,
    pub offer_type: &'a str,
    pub offer_id: &'a str,
    pub offer_name: &'a str,
    pub action: &'a str,
    pub reason: &'a str,
    pub severity: &'a str,
    pub evidence_json: &'a Value,
    pub source: &'a str,
}

#[derive(Debug, FromRow)]
pub struct AutoSunsetScopeRecord {
    pub tenant_id: String,
    pub branch_id: String,
}

#[derive(Debug, FromRow)]
pub struct BranchOfferPerformanceRecord {
    pub branch_id: String,
    pub branch_name: String,
    pub active_rules: i64,
    pub active_coupons: i64,
    pub applications: i64,
    pub unique_clients: i64,
    pub repeat_clients: i64,
    pub sales_value_paise: i64,
    pub discount_paise: i64,
    pub reversed_discount_paise: i64,
}

#[derive(Debug, FromRow)]
pub struct ClientReturnRecord {
    pub source_id: String,
    pub offer_type: String,
    pub offer_id: String,
    pub offer_title: String,
    pub client_id: String,
    pub client_name: String,
    pub used_at: DateTime<Utc>,
    pub amount_paise: i64,
    pub discount_paise: i64,
    pub return_at: Option<DateTime<Utc>>,
    pub return_amount_paise: i64,
}

#[derive(Debug, FromRow)]
pub struct ElasticityBandRecord {
    pub service_id: String,
    pub service_name: String,
    pub discount_bps: i64,
    pub minimum_margin_bps: i64,
    pub sample_count: i64,
    pub slot_count: i64,
    pub units: i64,
    pub revenue_paise: i64,
    pub discount_paise: i64,
    pub product_cost_paise: i64,
    pub staff_cost_paise: i64,
}

pub async fn performance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<HappyHourPerformanceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT rule.id AS rule_id,
               rule.name,
               rule.active,
               COUNT(lock.id)::BIGINT AS applications,
               COUNT(lock.id) FILTER (
                 WHERE GREATEST(lock.discount_paise - lock.reversed_paise, 0) > 0
               )::BIGINT AS active_applications,
               COALESCE(SUM(CASE
                 WHEN sale.status NOT IN ('draft', 'voided', 'cancelled') THEN sale.total_paise
                 ELSE 0
               END), 0)::BIGINT AS sales_value_paise,
               COALESCE(SUM(lock.discount_paise), 0)::BIGINT AS discount_paise,
               COALESCE(SUM(lock.reversed_paise), 0)::BIGINT AS reversed_discount_paise,
               MAX(lock.created_at) AS last_applied_at
          FROM pos_happy_hour_rules rule
          LEFT JOIN pos_happy_hour_locks lock
            ON lock.tenant_id = rule.tenant_id
           AND lock.branch_id = rule.branch_id
           AND lock.rule_id = rule.id
          LEFT JOIN pos_sales sale
            ON sale.tenant_id = lock.tenant_id
           AND sale.branch_id = lock.branch_id
           AND sale.id = lock.sale_id
         WHERE rule.tenant_id = $1 AND rule.branch_id = $2
         GROUP BY rule.id, rule.name, rule.active, rule.created_at
         ORDER BY rule.active DESC, applications DESC, rule.created_at DESC
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn no_show_risks(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<NoShowRiskRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT client.id AS client_id,
               TRIM(CONCAT_WS(' ', client.first_name, client.last_name)) AS client_name,
               COUNT(appointment.id)::BIGINT AS total_appointments,
               COUNT(appointment.id) FILTER (WHERE appointment.status = 'no-show')::BIGINT AS no_show_count,
               COUNT(appointment.id) FILTER (WHERE appointment.status = 'cancelled')::BIGINT AS cancellation_count,
               COUNT(appointment.id) FILTER (WHERE appointment.status IN ('completed', 'billed', 'paid'))::BIGINT AS completed_count
          FROM clients client
          JOIN appointments appointment
            ON appointment.tenant_id = client.tenant_id
           AND appointment.branch_id = client.branch_id
           AND appointment.client_id = client.id
           AND appointment.start_at < NOW()
           AND appointment.start_at >= NOW() - INTERVAL '180 days'
         WHERE client.tenant_id = $1 AND client.branch_id = $2 AND client.active = TRUE
         GROUP BY client.id, client.first_name, client.last_name
        HAVING COUNT(appointment.id) FILTER (WHERE appointment.status IN ('no-show', 'cancelled')) > 0
         ORDER BY no_show_count DESC, cancellation_count DESC, total_appointments DESC
         LIMIT 100
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn repeated_coupon_usage(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<CouponUsageRiskRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT sale.coupon_code,
               sale.client_id,
               COALESCE(NULLIF(TRIM(CONCAT_WS(' ', client.first_name, client.last_name)), ''), sale.client_id) AS client_name,
               COUNT(*)::BIGINT AS redemptions,
               COALESCE(SUM(sale.coupon_discount_paise), 0)::BIGINT AS discount_paise,
               MAX(sale.created_at) AS last_used_at
          FROM pos_sales sale
          LEFT JOIN clients client
            ON client.tenant_id = sale.tenant_id
           AND client.branch_id = sale.branch_id
           AND client.id = sale.client_id
         WHERE sale.tenant_id = $1 AND sale.branch_id = $2
           AND sale.coupon_code <> '' AND sale.client_id <> ''
           AND sale.created_at >= NOW() - INTERVAL '180 days'
           AND sale.status NOT IN ('draft', 'voided', 'cancelled', 'refunded')
         GROUP BY sale.coupon_code, sale.client_id, client.first_name, client.last_name
        HAVING COUNT(*) >= 2
         ORDER BY redemptions DESC, discount_paise DESC
         LIMIT 100
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn exhausted_coupons(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<CouponLimitRiskRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id AS coupon_id, code AS coupon_code, used_count, usage_limit FROM pos_coupons WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND usage_limit IS NOT NULL AND used_count>=usage_limit ORDER BY used_count DESC, code",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn inventory_offer_signals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<InventoryOfferRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id AS item_id, name AS item_name, stock_quantity, reorder_point
          FROM inventory_items
         WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
           AND (stock_quantity <= reorder_point OR (reorder_point > 0 AND stock_quantity >= reorder_point * 3))
         ORDER BY (stock_quantity <= reorder_point) DESC, name
         LIMIT 100
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn staff_offer_signals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<StaffOfferRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT staff.id AS staff_id,
               COALESCE(NULLIF(staff.appointment_display_name, ''), TRIM(CONCAT_WS(' ', staff.first_name, staff.last_name))) AS staff_name,
               COALESCE(schedule.status, 'not_set') AS schedule_status,
               COALESCE(ROUND(EXTRACT(EPOCH FROM (schedule.shift1_end - schedule.shift1_start)) / 60), 0)::BIGINT
                 + COALESCE(ROUND(EXTRACT(EPOCH FROM (schedule.shift2_end - schedule.shift2_start)) / 60), 0)::BIGINT AS scheduled_minutes,
               COALESCE((
                 SELECT ROUND(SUM(EXTRACT(EPOCH FROM (appointment.end_at - appointment.start_at)) / 60))::BIGINT
                   FROM appointments appointment
                  WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.staff_id=staff.id
                    AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE=(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE
                    AND appointment.status NOT IN ('cancelled', 'no-show')
               ), 0)::BIGINT AS booked_minutes,
               (SELECT COUNT(*) FROM appointments appointment
                 WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.staff_id=staff.id
                   AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE=(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE
                   AND appointment.status NOT IN ('cancelled', 'no-show'))::BIGINT AS appointment_count
          FROM staff
          LEFT JOIN staff_schedules schedule
            ON schedule.tenant_id=staff.tenant_id AND schedule.branch_id=staff.branch_id AND schedule.staff_id=staff.id
           AND schedule.schedule_date=(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE
         WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.active=TRUE
         ORDER BY staff_name
         LIMIT 100
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn preview_audience(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    criteria: AudienceCriteriaQuery<'_>,
) -> Result<Vec<AudienceMatchRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH appointment_metrics AS (
          SELECT client_id,
                 COUNT(*) FILTER (WHERE status IN ('completed', 'billed', 'paid'))::BIGINT AS visit_count,
                 MAX(start_at) FILTER (WHERE status IN ('completed', 'billed', 'paid')) AS last_visit_at
            FROM appointments
           WHERE tenant_id=$1 AND branch_id=$2
           GROUP BY client_id
        ), sale_metrics AS (
          SELECT client_id, COALESCE(SUM(total_paise), 0)::BIGINT AS total_spend_paise
            FROM pos_sales
           WHERE tenant_id=$1 AND branch_id=$2
             AND status NOT IN ('draft', 'voided', 'cancelled', 'refunded')
           GROUP BY client_id
        ), candidates AS (
          SELECT client.id AS client_id,
                 TRIM(CONCAT_WS(' ', client.first_name, client.last_name)) AS client_name,
                 COALESCE(appointment.visit_count, 0)::BIGINT AS visit_count,
                 COALESCE(sale.total_spend_paise, 0)::BIGINT AS total_spend_paise,
                 GREATEST(CURRENT_DATE - COALESCE(appointment.last_visit_at::DATE, client.last_visit_at::DATE, client.created_at::DATE), 0)::INTEGER AS inactive_days,
                 client.birthday
            FROM clients client
            LEFT JOIN appointment_metrics appointment ON appointment.client_id=client.id
            LEFT JOIN sale_metrics sale ON sale.client_id=client.id
           WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.active=TRUE
             AND client.merged_into_client_id IS NULL
             AND CASE $3
                   WHEN 'whatsapp' THEN client.whatsapp_opt_in IS TRUE AND client.phone<>''
                   WHEN 'sms' THEN client.sms_opt_in IS TRUE AND client.phone<>''
                   ELSE FALSE
                 END
        )
        SELECT client_id, client_name, visit_count, total_spend_paise, inactive_days,
               COUNT(*) OVER()::BIGINT AS total_count
          FROM candidates
         WHERE ($4::INTEGER IS NULL OR inactive_days >= $4)
           AND ($5::BIGINT IS NULL OR visit_count >= $5)
           AND ($6::BIGINT IS NULL OR total_spend_paise >= $6)
           AND ($7::INTEGER IS NULL OR EXTRACT(MONTH FROM birthday)::INTEGER = $7)
           AND ($8='' OR ($8='new' AND visit_count<=1) OR ($8='existing' AND visit_count>1))
         ORDER BY total_spend_paise DESC, client_id
         LIMIT $9
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(criteria.channel)
    .bind(criteria.inactive_days_gte)
    .bind(criteria.visit_count_gte)
    .bind(criteria.total_spend_paise_gte)
    .bind(criteria.birthday_month)
    .bind(criteria.client_type)
    .bind(criteria.sample_limit)
    .fetch_all(db)
    .await
}

pub async fn list_audiences(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<HappyHourAudienceRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,audience_key,name,channel,criteria_json,estimate_count,previewed_at,status,created_at,updated_at FROM pos_happy_hour_audiences WHERE tenant_id=$1 AND branch_id=$2 ORDER BY updated_at DESC,id")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn upsert_audience(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: UpsertAudience<'_>,
) -> Result<HappyHourAudienceRecord, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO pos_happy_hour_audiences
           (tenant_id,branch_id,audience_key,name,channel,criteria_json,estimate_count,previewed_at,status)
           VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),$8)
           ON CONFLICT(tenant_id,branch_id,audience_key) DO UPDATE SET
             name=EXCLUDED.name,channel=EXCLUDED.channel,criteria_json=EXCLUDED.criteria_json,
             estimate_count=EXCLUDED.estimate_count,previewed_at=NOW(),status=EXCLUDED.status,updated_at=NOW()
           RETURNING id,audience_key,name,channel,criteria_json,estimate_count,previewed_at,status,created_at,updated_at"#,
    )
    .bind(tenant_id).bind(branch_id).bind(input.audience_key).bind(input.name)
    .bind(input.channel).bind(input.criteria_json).bind(input.estimate_count).bind(input.status)
    .fetch_one(db).await
}

pub async fn update_audience_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
) -> Result<Option<HappyHourAudienceRecord>, sqlx::Error> {
    sqlx::query_as("UPDATE pos_happy_hour_audiences SET status=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,audience_key,name,channel,criteria_json,estimate_count,previewed_at,status,created_at,updated_at")
        .bind(tenant_id).bind(branch_id).bind(id).bind(status).fetch_optional(db).await
}

pub async fn campaign_link_context(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    audience_id: &str,
    rule_id: &str,
    coupon_id: Option<&str>,
) -> Result<Option<CampaignLinkContextRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT audience.status AS audience_status,audience.channel AS audience_channel,
                  rule.active AS rule_active,coupon.active AS coupon_active
             FROM pos_happy_hour_audiences audience
             JOIN pos_happy_hour_rules rule ON rule.tenant_id=audience.tenant_id AND rule.branch_id=audience.branch_id AND rule.id=$4
             LEFT JOIN pos_coupons coupon ON coupon.tenant_id=audience.tenant_id AND coupon.branch_id=audience.branch_id AND coupon.id=$5
            WHERE audience.tenant_id=$1 AND audience.branch_id=$2 AND audience.id=$3
              AND ($5::TEXT IS NULL OR coupon.id IS NOT NULL)"#,
    )
    .bind(tenant_id).bind(branch_id).bind(audience_id).bind(rule_id).bind(coupon_id)
    .fetch_optional(db).await
}

pub async fn list_campaign_links(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<HappyHourCampaignLinkRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT link.id,link.audience_id,audience.name AS audience_name,link.rule_id,rule.name AS rule_name,
                  link.coupon_id,coupon.code AS coupon_code,link.channel,link.title,link.message,link.status,link.created_at,link.updated_at
             FROM pos_happy_hour_campaign_links link
             JOIN pos_happy_hour_audiences audience ON audience.tenant_id=link.tenant_id AND audience.branch_id=link.branch_id AND audience.id=link.audience_id
             JOIN pos_happy_hour_rules rule ON rule.tenant_id=link.tenant_id AND rule.branch_id=link.branch_id AND rule.id=link.rule_id
             LEFT JOIN pos_coupons coupon ON coupon.tenant_id=link.tenant_id AND coupon.branch_id=link.branch_id AND coupon.id=link.coupon_id
            WHERE link.tenant_id=$1 AND link.branch_id=$2
            ORDER BY link.updated_at DESC,link.id"#,
    )
    .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn create_campaign_link(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: NewCampaignLink<'_>,
) -> Result<HappyHourCampaignLinkRecord, sqlx::Error> {
    sqlx::query_as(
        r#"WITH inserted AS (
             INSERT INTO pos_happy_hour_campaign_links
               (tenant_id,branch_id,audience_id,rule_id,coupon_id,channel,title,message,status)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING *
           )
           SELECT link.id,link.audience_id,audience.name AS audience_name,link.rule_id,rule.name AS rule_name,
                  link.coupon_id,coupon.code AS coupon_code,link.channel,link.title,link.message,link.status,link.created_at,link.updated_at
             FROM inserted link
             JOIN pos_happy_hour_audiences audience ON audience.tenant_id=link.tenant_id AND audience.branch_id=link.branch_id AND audience.id=link.audience_id
             JOIN pos_happy_hour_rules rule ON rule.tenant_id=link.tenant_id AND rule.branch_id=link.branch_id AND rule.id=link.rule_id
             LEFT JOIN pos_coupons coupon ON coupon.tenant_id=link.tenant_id AND coupon.branch_id=link.branch_id AND coupon.id=link.coupon_id"#,
    )
    .bind(tenant_id).bind(branch_id).bind(input.audience_id).bind(input.rule_id)
    .bind(input.coupon_id).bind(input.channel).bind(input.title).bind(input.message).bind(input.status)
    .fetch_one(db).await
}

pub async fn update_campaign_link_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
) -> Result<Option<HappyHourCampaignLinkRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH updated AS (
             UPDATE pos_happy_hour_campaign_links SET status=$4,updated_at=NOW()
              WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING *
           )
           SELECT link.id,link.audience_id,audience.name AS audience_name,link.rule_id,rule.name AS rule_name,
                  link.coupon_id,coupon.code AS coupon_code,link.channel,link.title,link.message,link.status,link.created_at,link.updated_at
             FROM updated link
             JOIN pos_happy_hour_audiences audience ON audience.tenant_id=link.tenant_id AND audience.branch_id=link.branch_id AND audience.id=link.audience_id
             JOIN pos_happy_hour_rules rule ON rule.tenant_id=link.tenant_id AND rule.branch_id=link.branch_id AND rule.id=link.rule_id
             LEFT JOIN pos_coupons coupon ON coupon.tenant_id=link.tenant_id AND coupon.branch_id=link.branch_id AND coupon.id=link.coupon_id"#,
    )
    .bind(tenant_id).bind(branch_id).bind(id).bind(status).fetch_optional(db).await
}

pub async fn list_market_observations(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<MarketPriceObservationRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,service_category,competitor_name,observed_price_paise,observed_on,
                  source_url,active,created_at
             FROM pos_market_price_observations
            WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
            ORDER BY observed_on DESC,created_at DESC
            LIMIT 200"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn create_market_observation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: NewMarketPriceObservation<'_>,
) -> Result<MarketPriceObservationRecord, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO pos_market_price_observations
             (tenant_id,branch_id,service_category,competitor_name,observed_price_paise,observed_on,source_url)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           RETURNING id,service_category,competitor_name,observed_price_paise,observed_on,
                     source_url,active,created_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(input.service_category)
    .bind(input.competitor_name)
    .bind(input.observed_price_paise)
    .bind(input.observed_on)
    .bind(input.source_url)
    .fetch_one(db)
    .await
}

pub async fn market_context(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    service_category: &str,
    signal_date: NaiveDate,
    hour_slot: i32,
) -> Result<MarketContextRecord, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT
          COALESCE((SELECT ROUND(AVG(price_paise))::BIGINT
                      FROM services
                     WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND price_paise>0
                       AND LOWER(category)=LOWER($3)),0)::BIGINT AS our_price_paise,
          COALESCE((SELECT ROUND(AVG(observed_price_paise))::BIGINT
                      FROM pos_market_price_observations
                     WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
                       AND LOWER(service_category)=LOWER($3)
                       AND observed_on >= CURRENT_DATE - 90),0)::BIGINT AS competitor_avg_paise,
          COALESCE((SELECT MIN(observed_price_paise)
                      FROM pos_market_price_observations
                     WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
                       AND LOWER(service_category)=LOWER($3)
                       AND observed_on >= CURRENT_DATE - 90),0)::BIGINT AS competitor_min_paise,
          COALESCE((SELECT MAX(observed_price_paise)
                      FROM pos_market_price_observations
                     WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
                       AND LOWER(service_category)=LOWER($3)
                       AND observed_on >= CURRENT_DATE - 90),0)::BIGINT AS competitor_max_paise,
          (SELECT COUNT(*)::BIGINT
             FROM pos_market_price_observations
            WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
              AND LOWER(service_category)=LOWER($3)
              AND observed_on >= CURRENT_DATE - 90) AS competitor_count,
          COALESCE((SELECT ROUND(AVG(price_paise))::BIGINT
                      FROM services
                     WHERE tenant_id=$1 AND branch_id<>$2 AND active=TRUE AND price_paise>0
                       AND LOWER(category)=LOWER($3)),0)::BIGINT AS internal_avg_paise,
          COALESCE((SELECT MIN(price_paise)::BIGINT
                      FROM services
                     WHERE tenant_id=$1 AND branch_id<>$2 AND active=TRUE AND price_paise>0
                       AND LOWER(category)=LOWER($3)),0)::BIGINT AS internal_min_paise,
          COALESCE((SELECT MAX(price_paise)::BIGINT
                      FROM services
                     WHERE tenant_id=$1 AND branch_id<>$2 AND active=TRUE AND price_paise>0
                       AND LOWER(category)=LOWER($3)),0)::BIGINT AS internal_max_paise,
          (SELECT COUNT(DISTINCT branch_id)::BIGINT
             FROM services
            WHERE tenant_id=$1 AND branch_id<>$2 AND active=TRUE AND price_paise>0
              AND LOWER(category)=LOWER($3)) AS internal_branch_count,
          (SELECT COUNT(*)::BIGINT
             FROM staff_schedules
            WHERE tenant_id=$1 AND branch_id=$2 AND schedule_date=$4 AND status='working'
              AND ((shift1_start <= MAKE_TIME($5,0,0) AND shift1_end > MAKE_TIME($5,0,0))
                OR (shift2_start <= MAKE_TIME($5,0,0) AND shift2_end > MAKE_TIME($5,0,0)))) AS scheduled_staff,
          (SELECT COUNT(*)::BIGINT
             FROM appointments
            WHERE tenant_id=$1 AND branch_id=$2
              AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE=$4
              AND EXTRACT(HOUR FROM start_at AT TIME ZONE 'Asia/Kolkata')::INTEGER=$5
              AND LOWER(status) NOT IN ('cancelled','canceled','no_show','no-show')) AS appointment_count"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_category)
    .bind(signal_date)
    .bind(hour_slot)
    .fetch_one(db)
    .await
}

pub async fn list_market_suggestions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<MarketSuggestionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,service_category,signal_date,hour_slot,our_price_paise,base_discount_bps,
                  max_discount_bps,benchmark_source,market_avg_paise,market_min_paise,
                  market_max_paise,observation_count,scheduled_staff,appointment_count,
                  occupancy_bps,price_gap_bps,market_position,campaign_angle,
                  suggested_discount_bps,status,reasons_json,created_at,updated_at
             FROM pos_happy_hour_market_suggestions
            WHERE tenant_id=$1 AND branch_id=$2
            ORDER BY created_at DESC
            LIMIT 100"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn create_market_suggestion(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: NewMarketSuggestion<'_>,
) -> Result<MarketSuggestionRecord, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO pos_happy_hour_market_suggestions
             (tenant_id,branch_id,service_category,signal_date,hour_slot,our_price_paise,
              base_discount_bps,max_discount_bps,benchmark_source,market_avg_paise,
              market_min_paise,market_max_paise,observation_count,scheduled_staff,
              appointment_count,occupancy_bps,price_gap_bps,market_position,campaign_angle,
              suggested_discount_bps,reasons_json)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           RETURNING id,service_category,signal_date,hour_slot,our_price_paise,base_discount_bps,
                     max_discount_bps,benchmark_source,market_avg_paise,market_min_paise,
                     market_max_paise,observation_count,scheduled_staff,appointment_count,
                     occupancy_bps,price_gap_bps,market_position,campaign_angle,
                     suggested_discount_bps,status,reasons_json,created_at,updated_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(input.service_category)
    .bind(input.signal_date)
    .bind(input.hour_slot)
    .bind(input.our_price_paise)
    .bind(input.base_discount_bps)
    .bind(input.max_discount_bps)
    .bind(input.benchmark_source)
    .bind(input.market_avg_paise)
    .bind(input.market_min_paise)
    .bind(input.market_max_paise)
    .bind(input.observation_count)
    .bind(input.scheduled_staff)
    .bind(input.appointment_count)
    .bind(input.occupancy_bps)
    .bind(input.price_gap_bps)
    .bind(input.market_position)
    .bind(input.campaign_angle)
    .bind(input.suggested_discount_bps)
    .bind(input.reasons_json)
    .fetch_one(db)
    .await
}

pub async fn update_market_suggestion_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
) -> Result<Option<MarketSuggestionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"UPDATE pos_happy_hour_market_suggestions
              SET status=$4,updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
            RETURNING id,service_category,signal_date,hour_slot,our_price_paise,base_discount_bps,
                      max_discount_bps,benchmark_source,market_avg_paise,market_min_paise,
                      market_max_paise,observation_count,scheduled_staff,appointment_count,
                      occupancy_bps,price_gap_bps,market_position,campaign_angle,
                      suggested_discount_bps,status,reasons_json,created_at,updated_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(status)
    .fetch_optional(db)
    .await
}

pub async fn context_offer_signal(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    service_category: &str,
    signal_date: NaiveDate,
    hour_slot: i32,
    source_channel: &str,
    from_date: NaiveDate,
    min_lead_minutes: i64,
    max_lead_minutes: i64,
    client_id: &str,
) -> Result<ContextOfferSignalRecord, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT
          COALESCE((SELECT ROUND(AVG(price_paise))::BIGINT FROM services
                     WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND price_paise>0
                       AND LOWER(category)=LOWER($3)),0)::BIGINT AS service_price_paise,
          (SELECT COUNT(*)::BIGINT FROM staff_schedules
            WHERE tenant_id=$1 AND branch_id=$2 AND schedule_date=$4 AND status='working'
              AND ((shift1_start <= MAKE_TIME($5,0,0) AND shift1_end > MAKE_TIME($5,0,0))
                OR (shift2_start <= MAKE_TIME($5,0,0) AND shift2_end > MAKE_TIME($5,0,0)))) AS scheduled_staff,
          (SELECT COUNT(*)::BIGINT FROM appointments
            WHERE tenant_id=$1 AND branch_id=$2
              AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE=$4
              AND EXTRACT(HOUR FROM start_at AT TIME ZONE 'Asia/Kolkata')::INTEGER=$5
              AND LOWER(status) NOT IN ('cancelled','canceled','no_show','no-show')) AS appointment_count,
          (SELECT COUNT(*)::BIGINT FROM packages package
            WHERE package.tenant_id=$1 AND package.branch_id=$2 AND package.active=TRUE
              AND EXISTS (SELECT 1 FROM services service
                           WHERE service.tenant_id=$1 AND service.branch_id=$2 AND service.active=TRUE
                             AND LOWER(service.category)=LOWER($3)
                             AND package.service_ids_json ? service.id)) AS package_count,
          COALESCE((SELECT ROUND(AVG(package.price_paise))::BIGINT FROM packages package
            WHERE package.tenant_id=$1 AND package.branch_id=$2 AND package.active=TRUE
              AND EXISTS (SELECT 1 FROM services service
                           WHERE service.tenant_id=$1 AND service.branch_id=$2 AND service.active=TRUE
                             AND LOWER(service.category)=LOWER($3)
                             AND package.service_ids_json ? service.id)),0)::BIGINT AS avg_package_price_paise,
          COALESCE((SELECT ROUND(AVG(CASE WHEN package.price_paise>0
                                          THEN (package.price_paise-package.cost_price_paise)*10000.0/package.price_paise
                                          ELSE 0 END))::BIGINT FROM packages package
            WHERE package.tenant_id=$1 AND package.branch_id=$2 AND package.active=TRUE
              AND EXISTS (SELECT 1 FROM services service
                           WHERE service.tenant_id=$1 AND service.branch_id=$2 AND service.active=TRUE
                             AND LOWER(service.category)=LOWER($3)
                             AND package.service_ids_json ? service.id)),0)::BIGINT AS avg_package_margin_bps,
          (SELECT COUNT(*)::BIGINT FROM appointments
            WHERE tenant_id=$1 AND branch_id=$2 AND created_at::DATE >= $7
              AND LOWER(REPLACE(REPLACE(COALESCE(NULLIF(source_channel,''),source,''),'-','_'),' ','_'))=$6) AS channel_booking_count,
          (SELECT COUNT(*)::BIGINT FROM pos_sales
            WHERE tenant_id=$1 AND branch_id=$2 AND created_at::DATE >= $7
              AND LOWER(REPLACE(REPLACE(source,'-','_'),' ','_'))=$6
              AND LOWER(status) NOT IN ('void','refunded')) AS channel_sales_count,
          COALESCE((SELECT SUM(total_paise)::BIGINT FROM pos_sales
            WHERE tenant_id=$1 AND branch_id=$2 AND created_at::DATE >= $7
              AND LOWER(REPLACE(REPLACE(source,'-','_'),' ','_'))=$6
              AND LOWER(status) NOT IN ('void','refunded')),0)::BIGINT AS channel_revenue_paise,
          (SELECT COUNT(*)::BIGINT FROM appointments appointment
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2
              AND appointment.start_at::DATE >= $7
              AND EXTRACT(EPOCH FROM (appointment.start_at-appointment.created_at))/60 >= $8
              AND EXTRACT(EPOCH FROM (appointment.start_at-appointment.created_at))/60 < $9
              AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::JSONB) AS requested(service_id)
                           JOIN services service ON service.id=requested.service_id AND service.tenant_id=$1 AND service.branch_id=$2
                           WHERE LOWER(service.category)=LOWER($3))) AS lead_booking_count,
          COALESCE((SELECT ROUND(AVG(EXTRACT(EPOCH FROM (appointment.start_at-appointment.created_at))/60))::BIGINT
            FROM appointments appointment
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2
              AND appointment.start_at::DATE >= $7
              AND EXTRACT(EPOCH FROM (appointment.start_at-appointment.created_at))/60 >= $8
              AND EXTRACT(EPOCH FROM (appointment.start_at-appointment.created_at))/60 < $9),0)::BIGINT AS avg_lead_minutes,
          (SELECT COUNT(*)::BIGINT FROM appointments appointment
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2
              AND appointment.start_at::DATE >= $7
              AND EXTRACT(EPOCH FROM (appointment.start_at-appointment.created_at))/60 >= $8
              AND EXTRACT(EPOCH FROM (appointment.start_at-appointment.created_at))/60 < $9
              AND LOWER(appointment.status) IN ('cancelled','canceled','no_show','no-show')) AS lead_no_show_count,
          EXISTS(SELECT 1 FROM clients client
            WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$10
              AND client.active=TRUE AND client.merged_into_client_id IS NULL) AS client_exists,
          COALESCE((SELECT transaction.balance_after_paise FROM wallet_transactions transaction
            WHERE transaction.tenant_id=$1 AND transaction.branch_id=$2 AND transaction.client_id=$10
            ORDER BY transaction.created_at DESC,transaction.id DESC LIMIT 1),0)::BIGINT AS wallet_balance_paise,
          (SELECT COUNT(*)::BIGINT FROM wallet_transactions transaction
            WHERE transaction.tenant_id=$1 AND transaction.branch_id=$2 AND transaction.client_id=$10) AS wallet_activity_count,
          (SELECT COUNT(*)::BIGINT FROM client_memberships membership
            WHERE membership.tenant_id=$1 AND membership.branch_id=$2 AND membership.client_id=$10
              AND membership.active=TRUE AND (membership.expires_at IS NULL OR membership.expires_at>=NOW())) AS active_membership_count,
          COALESCE((SELECT FLOOR(EXTRACT(EPOCH FROM (MIN(membership.expires_at)-NOW()))/86400)::BIGINT
            FROM client_memberships membership
            WHERE membership.tenant_id=$1 AND membership.branch_id=$2 AND membership.client_id=$10
              AND membership.active=TRUE AND membership.expires_at>=NOW()),9999)::BIGINT AS membership_expiry_days,
          COALESCE((SELECT SUM(credit.remaining_qty)::BIGINT FROM client_membership_credits credit
            WHERE credit.tenant_id=$1 AND credit.branch_id=$2 AND credit.client_id=$10
              AND credit.active=TRUE AND credit.remaining_qty>0
              AND (credit.expires_at IS NULL OR credit.expires_at>=CURRENT_DATE)),0)::BIGINT AS membership_credits_remaining,
          COALESCE((SELECT reward.balance_after::BIGINT FROM membership_reward_ledger reward
            WHERE reward.tenant_id=$1 AND reward.branch_id=$2 AND reward.client_id=$10
            ORDER BY reward.created_at DESC,reward.id DESC LIMIT 1),0)::BIGINT AS reward_points_balance,
          (SELECT COUNT(*)::BIGINT FROM appointments appointment
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.client_id=$10
              AND LOWER(appointment.status) IN ('completed','billed','paid')) AS visit_count,
          COALESCE((SELECT SUM(sale.total_paise)::BIGINT FROM pos_sales sale
            WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.client_id=$10
              AND LOWER(sale.status) NOT IN ('draft','cancelled','canceled','void','voided','refunded')),0)::BIGINT AS total_spend_paise"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_category)
    .bind(signal_date)
    .bind(hour_slot)
    .bind(source_channel)
    .bind(from_date)
    .bind(min_lead_minutes)
    .bind(max_lead_minutes)
    .bind(client_id)
    .fetch_one(db)
    .await
}

pub async fn list_context_offer_suggestions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ContextOfferSuggestionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,offer_type,service_category,signal_date,hour_slot,service_price_paise,
                  base_discount_bps,suggested_discount_bps,campaign_angle,context_json,
                  reasons_json,status,created_at,updated_at
             FROM pos_happy_hour_context_suggestions
            WHERE tenant_id=$1 AND branch_id=$2
            ORDER BY created_at DESC LIMIT 100"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn create_context_offer_suggestion(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: NewContextOfferSuggestion<'_>,
) -> Result<ContextOfferSuggestionRecord, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO pos_happy_hour_context_suggestions
             (tenant_id,branch_id,offer_type,service_category,signal_date,hour_slot,
              service_price_paise,base_discount_bps,suggested_discount_bps,campaign_angle,
              context_json,reasons_json)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING id,offer_type,service_category,signal_date,hour_slot,service_price_paise,
                     base_discount_bps,suggested_discount_bps,campaign_angle,context_json,
                     reasons_json,status,created_at,updated_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(input.offer_type)
    .bind(input.service_category)
    .bind(input.signal_date)
    .bind(input.hour_slot)
    .bind(input.service_price_paise)
    .bind(input.base_discount_bps)
    .bind(input.suggested_discount_bps)
    .bind(input.campaign_angle)
    .bind(input.context_json)
    .bind(input.reasons_json)
    .fetch_one(db)
    .await
}

pub async fn update_context_offer_suggestion_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
) -> Result<Option<ContextOfferSuggestionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"UPDATE pos_happy_hour_context_suggestions SET status=$4,updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
            RETURNING id,offer_type,service_category,signal_date,hour_slot,service_price_paise,
                      base_discount_bps,suggested_discount_bps,campaign_angle,context_json,
                      reasons_json,status,created_at,updated_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(status)
    .fetch_optional(db)
    .await
}

pub async fn get_auto_sunset_policy(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<AutoSunsetPolicyRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT expire_past_end_date,pause_coupons_at_usage_limit,
                  review_no_end_date_after_days,auto_apply_expired,
                  auto_apply_usage_limit,auto_apply_stale,status,updated_at
             FROM pos_happy_hour_auto_sunset_policies
            WHERE tenant_id=$1 AND branch_id=$2"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn upsert_auto_sunset_policy(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: UpsertAutoSunsetPolicy<'_>,
) -> Result<AutoSunsetPolicyRecord, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO pos_happy_hour_auto_sunset_policies
             (tenant_id,branch_id,expire_past_end_date,pause_coupons_at_usage_limit,
              review_no_end_date_after_days,auto_apply_expired,auto_apply_usage_limit,
              auto_apply_stale,status)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT(tenant_id,branch_id) DO UPDATE SET
             expire_past_end_date=EXCLUDED.expire_past_end_date,
             pause_coupons_at_usage_limit=EXCLUDED.pause_coupons_at_usage_limit,
             review_no_end_date_after_days=EXCLUDED.review_no_end_date_after_days,
             auto_apply_expired=EXCLUDED.auto_apply_expired,
             auto_apply_usage_limit=EXCLUDED.auto_apply_usage_limit,
             auto_apply_stale=EXCLUDED.auto_apply_stale,
             status=EXCLUDED.status,updated_at=NOW()
           RETURNING expire_past_end_date,pause_coupons_at_usage_limit,
                     review_no_end_date_after_days,auto_apply_expired,
                     auto_apply_usage_limit,auto_apply_stale,status,updated_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(input.expire_past_end_date)
    .bind(input.pause_coupons_at_usage_limit)
    .bind(input.review_no_end_date_after_days)
    .bind(input.auto_apply_expired)
    .bind(input.auto_apply_usage_limit)
    .bind(input.auto_apply_stale)
    .bind(input.status)
    .fetch_one(db)
    .await
}

pub async fn list_auto_sunset_offers(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<AutoSunsetOfferRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT 'rule'::TEXT AS offer_type,id AS offer_id,name AS offer_name,
                  NULL::TIMESTAMPTZ AS ends_at,NULL::BIGINT AS usage_limit,
                  0::BIGINT AS used_count,created_at
             FROM pos_happy_hour_rules
            WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
           UNION ALL
           SELECT 'coupon'::TEXT,id,code,ends_at,usage_limit,used_count,created_at
             FROM pos_coupons
            WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn upsert_auto_sunset_decision(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: NewAutoSunsetDecision<'_>,
) -> Result<AutoSunsetDecisionRecord, sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO pos_happy_hour_auto_sunset_decisions
             (tenant_id,branch_id,signature,offer_type,offer_id,offer_name,action,
              reason,severity,evidence_json,source)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT(tenant_id,branch_id,signature) DO UPDATE SET
             offer_name=EXCLUDED.offer_name,reason=EXCLUDED.reason,severity=EXCLUDED.severity,
             evidence_json=EXCLUDED.evidence_json,source=EXCLUDED.source,decided_at=NOW()
           WHERE pos_happy_hour_auto_sunset_decisions.status<>'applied'"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(input.signature)
    .bind(input.offer_type)
    .bind(input.offer_id)
    .bind(input.offer_name)
    .bind(input.action)
    .bind(input.reason)
    .bind(input.severity)
    .bind(input.evidence_json)
    .bind(input.source)
    .execute(db)
    .await?;
    sqlx::query_as(
        r#"SELECT id,offer_type,offer_id,offer_name,action,reason,severity,status,
                  evidence_json,source,decided_at,applied_at
             FROM pos_happy_hour_auto_sunset_decisions
            WHERE tenant_id=$1 AND branch_id=$2 AND signature=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(input.signature)
    .fetch_one(db)
    .await
}

pub async fn list_auto_sunset_decisions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
    severity: &str,
) -> Result<Vec<AutoSunsetDecisionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,offer_type,offer_id,offer_name,action,reason,severity,status,
                  evidence_json,source,decided_at,applied_at
             FROM pos_happy_hour_auto_sunset_decisions
            WHERE tenant_id=$1 AND branch_id=$2
              AND ($3='' OR status=$3) AND ($4='' OR severity=$4)
            ORDER BY CASE status WHEN 'suggested' THEN 0 WHEN 'skipped' THEN 1 ELSE 2 END,
                     decided_at DESC,id DESC LIMIT 200"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .bind(severity)
    .fetch_all(db)
    .await
}

pub async fn apply_auto_sunset_decision(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<AutoSunsetDecisionRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let decision = sqlx::query_as::<_, AutoSunsetDecisionRecord>(
        r#"SELECT id,offer_type,offer_id,offer_name,action,reason,severity,status,
                  evidence_json,source,decided_at,applied_at
             FROM pos_happy_hour_auto_sunset_decisions
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(decision) = decision else {
        return Ok(None);
    };
    if decision.status == "applied" {
        tx.commit().await?;
        return Ok(Some(decision));
    }
    let changes = match decision.action.as_str() {
        "expire_coupon" | "pause_coupon" | "review_stale_coupon" => sqlx::query(
            "UPDATE pos_coupons SET active=FALSE,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&decision.offer_id)
        .execute(&mut *tx)
        .await?
        .rows_affected(),
        "review_stale_rule" => sqlx::query(
            "UPDATE pos_happy_hour_rules SET active=FALSE,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&decision.offer_id)
        .execute(&mut *tx)
        .await?
        .rows_affected(),
        _ => 0,
    };
    let row = sqlx::query_as::<_, AutoSunsetDecisionRecord>(
        r#"UPDATE pos_happy_hour_auto_sunset_decisions
              SET status=$4,applied_at=CASE WHEN $4='applied' THEN NOW() ELSE applied_at END
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
            RETURNING id,offer_type,offer_id,offer_name,action,reason,severity,status,
                      evidence_json,source,decided_at,applied_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(if changes > 0 { "applied" } else { "skipped" })
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(row))
}

pub async fn list_auto_sunset_scopes(
    db: &PgPool,
) -> Result<Vec<AutoSunsetScopeRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT tenant_id,branch_id FROM (
             SELECT tenant_id,branch_id FROM pos_happy_hour_rules
             UNION SELECT tenant_id,branch_id FROM pos_coupons
           ) scopes WHERE tenant_id<>'' AND branch_id<>''
           ORDER BY tenant_id,branch_id"#,
    )
    .fetch_all(db)
    .await
}

pub async fn branch_offer_performance(
    db: &PgPool,
    tenant_id: &str,
    current_branch_id: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
) -> Result<Vec<BranchOfferPerformanceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH branch_ids AS (
             SELECT id::TEXT AS branch_id FROM branches WHERE tenant_id::TEXT=$1
             UNION SELECT branch_id FROM pos_happy_hour_rules WHERE tenant_id=$1
             UNION SELECT branch_id FROM pos_coupons WHERE tenant_id=$1
             UNION SELECT branch_id FROM pos_happy_hour_locks WHERE tenant_id=$1
             UNION SELECT $2::TEXT
           ), branch_scope AS (
             SELECT branch_ids.branch_id,COALESCE(branch.name,branch_ids.branch_id) AS branch_name
             FROM branch_ids LEFT JOIN branches branch ON branch.id::TEXT=branch_ids.branch_id AND branch.tenant_id::TEXT=$1
           ), rule_counts AS (
             SELECT branch_id,COUNT(*)::BIGINT AS active_rules FROM pos_happy_hour_rules
             WHERE tenant_id=$1 AND active=TRUE GROUP BY branch_id
           ), coupon_counts AS (
             SELECT branch_id,COUNT(*)::BIGINT AS active_coupons FROM pos_coupons
             WHERE tenant_id=$1 AND active=TRUE GROUP BY branch_id
           ), outcomes AS (
             SELECT lock.branch_id,COUNT(lock.id)::BIGINT AS applications,
                    COUNT(DISTINCT NULLIF(sale.client_id,''))::BIGINT AS unique_clients,
                    COALESCE(SUM(CASE WHEN sale.status NOT IN ('draft','voided','cancelled') THEN sale.total_paise ELSE 0 END),0)::BIGINT AS sales_value_paise,
                    COALESCE(SUM(lock.discount_paise),0)::BIGINT AS discount_paise,
                    COALESCE(SUM(lock.reversed_paise),0)::BIGINT AS reversed_discount_paise
             FROM pos_happy_hour_locks lock
             LEFT JOIN pos_sales sale ON sale.tenant_id=lock.tenant_id AND sale.branch_id=lock.branch_id AND sale.id=lock.sale_id
             WHERE lock.tenant_id=$1 AND ($3::DATE IS NULL OR lock.created_at::DATE >= $3)
               AND ($4::DATE IS NULL OR lock.created_at::DATE <= $4)
             GROUP BY lock.branch_id
           ), client_applications AS (
             SELECT lock.branch_id,sale.client_id,COUNT(*)::BIGINT AS applications
             FROM pos_happy_hour_locks lock JOIN pos_sales sale
               ON sale.tenant_id=lock.tenant_id AND sale.branch_id=lock.branch_id AND sale.id=lock.sale_id
             WHERE lock.tenant_id=$1 AND NULLIF(sale.client_id,'') IS NOT NULL
               AND ($3::DATE IS NULL OR lock.created_at::DATE >= $3)
               AND ($4::DATE IS NULL OR lock.created_at::DATE <= $4)
             GROUP BY lock.branch_id,sale.client_id
           ), repeats AS (
             SELECT branch_id,COUNT(*) FILTER (WHERE applications>1)::BIGINT AS repeat_clients
             FROM client_applications GROUP BY branch_id
           )
           SELECT scope.branch_id,scope.branch_name,
                  COALESCE(rule_counts.active_rules,0)::BIGINT AS active_rules,
                  COALESCE(coupon_counts.active_coupons,0)::BIGINT AS active_coupons,
                  COALESCE(outcomes.applications,0)::BIGINT AS applications,
                  COALESCE(outcomes.unique_clients,0)::BIGINT AS unique_clients,
                  COALESCE(repeats.repeat_clients,0)::BIGINT AS repeat_clients,
                  COALESCE(outcomes.sales_value_paise,0)::BIGINT AS sales_value_paise,
                  COALESCE(outcomes.discount_paise,0)::BIGINT AS discount_paise,
                  COALESCE(outcomes.reversed_discount_paise,0)::BIGINT AS reversed_discount_paise
             FROM branch_scope scope
             LEFT JOIN rule_counts ON rule_counts.branch_id=scope.branch_id
             LEFT JOIN coupon_counts ON coupon_counts.branch_id=scope.branch_id
             LEFT JOIN outcomes ON outcomes.branch_id=scope.branch_id
             LEFT JOIN repeats ON repeats.branch_id=scope.branch_id
            ORDER BY scope.branch_name,scope.branch_id"#,
    )
    .bind(tenant_id)
    .bind(current_branch_id)
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
}

pub async fn client_returns(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    return_window_days: i32,
) -> Result<Vec<ClientReturnRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH offer_events AS (
             SELECT lock.id AS source_id,'rule'::TEXT AS offer_type,rule.id AS offer_id,
                    rule.name AS offer_title,sale.client_id,lock.created_at AS used_at,
                    sale.total_paise AS amount_paise,
                    GREATEST(lock.discount_paise-lock.reversed_paise,0)::BIGINT AS discount_paise,
                    sale.id AS sale_id
               FROM pos_happy_hour_locks lock
               JOIN pos_happy_hour_rules rule
                 ON rule.tenant_id=lock.tenant_id AND rule.branch_id=lock.branch_id AND rule.id=lock.rule_id
               JOIN pos_sales sale
                 ON sale.tenant_id=lock.tenant_id AND sale.branch_id=lock.branch_id AND sale.id=lock.sale_id
              WHERE lock.tenant_id=$1 AND lock.branch_id=$2
                AND sale.status NOT IN ('draft','voided','cancelled')
                AND GREATEST(lock.discount_paise-lock.reversed_paise,0)>0
             UNION ALL
             SELECT sale.id AS source_id,'coupon'::TEXT AS offer_type,coupon.id AS offer_id,
                    CONCAT('Coupon ',sale.coupon_code) AS offer_title,sale.client_id,sale.created_at AS used_at,
                    sale.total_paise AS amount_paise,sale.coupon_discount_paise AS discount_paise,
                    sale.id AS sale_id
               FROM pos_sales sale
               JOIN pos_coupons coupon
                 ON coupon.tenant_id=sale.tenant_id AND coupon.branch_id=sale.branch_id AND coupon.code=sale.coupon_code
              WHERE sale.tenant_id=$1 AND sale.branch_id=$2
                AND sale.status NOT IN ('draft','voided','cancelled')
                AND sale.coupon_code<>'' AND sale.coupon_discount_paise>0
           )
           SELECT event.source_id,event.offer_type,event.offer_id,event.offer_title,event.client_id,
                  COALESCE(NULLIF(TRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),event.client_id) AS client_name,
                  event.used_at,event.amount_paise,event.discount_paise,
                  returned.created_at AS return_at,COALESCE(returned.total_paise,0)::BIGINT AS return_amount_paise
             FROM offer_events event
             LEFT JOIN clients client
               ON client.tenant_id=$1 AND client.branch_id=$2 AND client.id=event.client_id
             LEFT JOIN LATERAL (
               SELECT repeat_sale.created_at,repeat_sale.total_paise
                 FROM pos_sales repeat_sale
                WHERE repeat_sale.tenant_id=$1 AND repeat_sale.branch_id=$2
                  AND repeat_sale.client_id=event.client_id AND NULLIF(event.client_id,'') IS NOT NULL
                  AND repeat_sale.id<>event.sale_id
                  AND repeat_sale.status NOT IN ('draft','voided','cancelled')
                  AND repeat_sale.created_at>event.used_at
                  AND repeat_sale.created_at<=event.used_at+MAKE_INTERVAL(days=>$5)
                ORDER BY repeat_sale.created_at,repeat_sale.id LIMIT 1
             ) returned ON TRUE
            WHERE ($3::DATE IS NULL OR event.used_at::DATE >= $3)
              AND ($4::DATE IS NULL OR event.used_at::DATE <= $4)
            ORDER BY event.used_at DESC,event.source_id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from)
    .bind(to)
    .bind(return_window_days)
    .fetch_all(db)
    .await
}

pub async fn elasticity_bands(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    day_of_week: Option<i32>,
    hour_slot: Option<i32>,
    service_id: Option<&str>,
) -> Result<Vec<ElasticityBandRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH cogs AS (
             SELECT sale_line_id,COALESCE(SUM(CASE
               WHEN movement_type='sale' THEN ABS(quantity_delta)::BIGINT*unit_cost_paise
               WHEN movement_type='return' THEN -ABS(quantity_delta)::BIGINT*unit_cost_paise
               ELSE 0 END),0)::BIGINT AS product_cost_paise
               FROM inventory_stock_ledger
              WHERE tenant_id=$1 AND branch_id=$2 GROUP BY sale_line_id
           ), commission AS (
             SELECT sale_line_id,COALESCE(SUM(commission_paise),0)::BIGINT AS staff_cost_paise
               FROM pos_staff_commission_snapshots
              WHERE tenant_id=$1 AND branch_id=$2 GROUP BY sale_line_id
           ), observations AS (
             SELECT line.id,line.sale_id,line.item_id,
                    COALESCE(service.name,line.item_name) AS service_name,line.quantity,
                    COALESCE(rule.discount_bps,0)::BIGINT AS discount_bps,
                    COALESCE(rule.min_margin_bps,0)::BIGINT AS minimum_margin_bps,
                    CASE WHEN line.gross_paise>0 OR line.taxable_paise>0
                      THEN line.taxable_paise
                      ELSE GREATEST(line.line_total_paise-line.gst_paise,0) END::BIGINT AS revenue_paise,
                    line.discount_paise,COALESCE(cogs.product_cost_paise,0)::BIGINT AS product_cost_paise,
                    COALESCE(commission.staff_cost_paise,0)::BIGINT AS staff_cost_paise,
                    COALESCE(sale.finalized_at,sale.created_at) AS sold_at
               FROM pos_sale_lines line
               JOIN pos_sales sale ON sale.id=line.sale_id
                AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id
               LEFT JOIN pos_happy_hour_locks lock ON lock.tenant_id=line.tenant_id
                AND lock.branch_id=line.branch_id AND lock.sale_id=line.sale_id
               LEFT JOIN pos_happy_hour_rules rule ON rule.tenant_id=lock.tenant_id
                AND rule.branch_id=lock.branch_id AND rule.id=lock.rule_id
               LEFT JOIN services service ON service.tenant_id=line.tenant_id
                AND service.branch_id=line.branch_id AND service.id=line.item_id
               LEFT JOIN cogs ON cogs.sale_line_id=line.id
               LEFT JOIN commission ON commission.sale_line_id=line.id
              WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.line_type='service'
                AND sale.status NOT IN ('draft','open','voided','cancelled','refunded')
                AND (lock.id IS NOT NULL OR sale.discount_paise=0)
                AND (COALESCE(sale.finalized_at,sale.created_at) AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $3 AND $4
                AND ($5::INT IS NULL OR EXTRACT(DOW FROM COALESCE(sale.finalized_at,sale.created_at) AT TIME ZONE 'Asia/Kolkata')::INT=$5)
                AND ($6::INT IS NULL OR EXTRACT(HOUR FROM COALESCE(sale.finalized_at,sale.created_at) AT TIME ZONE 'Asia/Kolkata')::INT=$6)
                AND ($7::TEXT IS NULL OR line.item_id=$7)
           )
           SELECT item_id AS service_id,service_name,discount_bps,
                  MAX(minimum_margin_bps)::BIGINT AS minimum_margin_bps,
                  COUNT(DISTINCT sale_id)::BIGINT AS sample_count,
                  COUNT(DISTINCT DATE_TRUNC('hour',sold_at AT TIME ZONE 'Asia/Kolkata'))::BIGINT AS slot_count,
                  COALESCE(SUM(quantity),0)::BIGINT AS units,
                  COALESCE(SUM(revenue_paise),0)::BIGINT AS revenue_paise,
                  COALESCE(SUM(discount_paise),0)::BIGINT AS discount_paise,
                  COALESCE(SUM(product_cost_paise),0)::BIGINT AS product_cost_paise,
                  COALESCE(SUM(staff_cost_paise),0)::BIGINT AS staff_cost_paise
             FROM observations
            GROUP BY item_id,service_name,discount_bps
            ORDER BY service_name,item_id,discount_bps"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from)
    .bind(to)
    .bind(day_of_week)
    .bind(hour_slot)
    .bind(service_id)
    .fetch_all(db)
    .await
}

pub async fn rule_analysis_rows(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<HappyHourRuleAnalysisRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,name,start_time,end_time,weekdays,discount_bps,eligible_line_types,
                  eligible_item_ids,eligible_client_categories,min_margin_bps,
                  block_on_unknown_cost,active
             FROM pos_happy_hour_rules
            WHERE tenant_id=$1 AND branch_id=$2
            ORDER BY discount_bps DESC,created_at,id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn simulation_service(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
) -> Result<Option<HappyHourSimulationServiceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT service.id,service.name,service.price_paise::BIGINT,
                  COUNT(item.id)::BIGINT AS known_products,
                  COALESCE(SUM(item.unit_cost_paise * COALESCE(
                    NULLIF(entry->>'quantity','')::BIGINT,
                    NULLIF(entry->>'qty','')::BIGINT,0)),0)::BIGINT AS unit_cost_paise
             FROM services service
             LEFT JOIN LATERAL jsonb_array_elements(service.product_consumption_json) entry ON TRUE
             LEFT JOIN inventory_items item
               ON item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id
              AND item.id=COALESCE(entry->>'itemId',entry->>'productId',entry->>'inventoryItemId')
              AND item.active=TRUE
            WHERE service.tenant_id=$1 AND service.branch_id=$2 AND service.id=$3
              AND service.active=TRUE
            GROUP BY service.id,service.name,service.price_paise"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .fetch_optional(db)
    .await
}

pub async fn client_categories(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT categories_json FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_optional(db)
    .await
}

const APPROVAL_COLUMNS: &str = "approval.id,approval.rule_id,rule.name AS rule_name,approval.requested_by,approval.requested_role,approval.requested_discount_bps,approval.status,approval.note,approval.decision_note,approval.decided_by,approval.decided_at,approval.created_at,approval.updated_at";

pub async fn list_approvals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<HappyHourApprovalRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {APPROVAL_COLUMNS} FROM pos_happy_hour_approval_requests approval JOIN pos_happy_hour_rules rule ON rule.tenant_id=approval.tenant_id AND rule.branch_id=approval.branch_id AND rule.id=approval.rule_id WHERE approval.tenant_id=$1 AND approval.branch_id=$2 AND ($3='' OR approval.status=$3) ORDER BY approval.created_at DESC LIMIT 200"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn create_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    rule_id: &str,
    actor: &str,
    role: &str,
    note: &str,
) -> Result<Option<HappyHourApprovalRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE pos_happy_hour_approval_requests SET status='superseded',decision_note='Superseded by a newer request',decided_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND rule_id=$3 AND status='pending'")
        .bind(tenant_id).bind(branch_id).bind(rule_id).execute(&mut *tx).await?;
    let row = sqlx::query_as(&format!(
        "WITH inserted AS (INSERT INTO pos_happy_hour_approval_requests(tenant_id,branch_id,rule_id,requested_by,requested_role,requested_discount_bps,note) SELECT rule.tenant_id,rule.branch_id,rule.id,$4,$5,rule.discount_bps,$6 FROM pos_happy_hour_rules rule WHERE rule.tenant_id=$1 AND rule.branch_id=$2 AND rule.id=$3 RETURNING *) SELECT {APPROVAL_COLUMNS} FROM inserted approval JOIN pos_happy_hour_rules rule ON rule.tenant_id=$1 AND rule.branch_id=$2 AND rule.id=approval.rule_id"
    ))
    .bind(tenant_id).bind(branch_id).bind(rule_id).bind(actor).bind(role).bind(note)
    .fetch_optional(&mut *tx).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn decide_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    status: &str,
    note: &str,
) -> Result<Option<HappyHourApprovalRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "WITH decided AS (UPDATE pos_happy_hour_approval_requests SET status=$5,decision_note=$6,decided_by=$4,decided_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending' AND requested_by<>$4 RETURNING *), activated AS (UPDATE pos_happy_hour_rules rule SET active=TRUE,updated_at=NOW() FROM decided WHERE $5='approved' AND rule.tenant_id=$1 AND rule.branch_id=$2 AND rule.id=decided.rule_id RETURNING rule.id) SELECT {APPROVAL_COLUMNS} FROM decided approval JOIN pos_happy_hour_rules rule ON rule.tenant_id=$1 AND rule.branch_id=$2 AND rule.id=approval.rule_id"
    ))
    .bind(tenant_id).bind(branch_id).bind(id).bind(actor).bind(status).bind(note)
    .fetch_optional(db).await
}

pub async fn upsert_anomaly(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: NewHappyHourAnomaly<'_>,
) -> Result<HappyHourAnomalyRecord, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO pos_happy_hour_anomalies
             (tenant_id,branch_id,signature,anomaly_type,severity,title,description,evidence_json)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT(tenant_id,branch_id,signature) DO UPDATE SET
             anomaly_type=EXCLUDED.anomaly_type,severity=EXCLUDED.severity,title=EXCLUDED.title,
             description=EXCLUDED.description,evidence_json=EXCLUDED.evidence_json,
             detected_at=NOW(),status=CASE WHEN pos_happy_hour_anomalies.status='dismissed' THEN 'dismissed' ELSE 'open' END,
             updated_at=NOW()
           RETURNING id,signature,anomaly_type,severity,status,title,description,evidence_json,
                     detected_at,reviewed_by,reviewed_at,review_note"#,
    )
    .bind(tenant_id).bind(branch_id).bind(input.signature).bind(input.anomaly_type)
    .bind(input.severity).bind(input.title).bind(input.description).bind(input.evidence)
    .fetch_one(db).await
}

pub async fn list_anomalies(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<HappyHourAnomalyRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,signature,anomaly_type,severity,status,title,description,evidence_json,detected_at,reviewed_by,reviewed_at,review_note FROM pos_happy_hour_anomalies WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR status=$3) ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,detected_at DESC LIMIT 200")
        .bind(tenant_id).bind(branch_id).bind(status).fetch_all(db).await
}

pub async fn review_anomaly(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
    actor: &str,
    note: &str,
) -> Result<Option<HappyHourAnomalyRecord>, sqlx::Error> {
    sqlx::query_as("UPDATE pos_happy_hour_anomalies SET status=$4,reviewed_by=$5,reviewed_at=NOW(),review_note=$6,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,signature,anomaly_type,severity,status,title,description,evidence_json,detected_at,reviewed_by,reviewed_at,review_note")
        .bind(tenant_id).bind(branch_id).bind(id).bind(status).bind(actor).bind(note)
        .fetch_optional(db).await
}

pub async fn current_budget(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    on_date: NaiveDate,
) -> Result<Option<HappyHourBudgetRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT budget.id,budget.period_start,budget.period_end,budget.budget_paise,
                  COALESCE(SUM(GREATEST(lock.discount_paise-lock.reversed_paise,0)),0)::BIGINT AS spent_paise,
                  budget.alert_threshold_bps,budget.approval_above_bps,budget.active,budget.updated_at
             FROM pos_happy_hour_budgets budget
             LEFT JOIN pos_happy_hour_locks lock ON lock.tenant_id=budget.tenant_id
              AND lock.branch_id=budget.branch_id AND lock.created_at::DATE BETWEEN budget.period_start AND budget.period_end
            WHERE budget.tenant_id=$1 AND budget.branch_id=$2 AND budget.active=TRUE
              AND $3 BETWEEN budget.period_start AND budget.period_end
            GROUP BY budget.id
            ORDER BY budget.period_start DESC LIMIT 1"#,
    )
    .bind(tenant_id).bind(branch_id).bind(on_date).fetch_optional(db).await
}

pub async fn upsert_budget(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
    budget_paise: i64,
    alert_threshold_bps: i32,
    approval_above_bps: i32,
    actor: &str,
) -> Result<HappyHourBudgetRecord, sqlx::Error> {
    sqlx::query_as(
        r#"WITH saved AS (
             INSERT INTO pos_happy_hour_budgets(tenant_id,branch_id,period_start,period_end,budget_paise,alert_threshold_bps,approval_above_bps,created_by,updated_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)
             ON CONFLICT(tenant_id,branch_id,period_start,period_end) DO UPDATE SET
               budget_paise=EXCLUDED.budget_paise,alert_threshold_bps=EXCLUDED.alert_threshold_bps,
               approval_above_bps=EXCLUDED.approval_above_bps,active=TRUE,updated_by=EXCLUDED.updated_by,updated_at=NOW()
             RETURNING *
           )
           SELECT saved.id,saved.period_start,saved.period_end,saved.budget_paise,
                  COALESCE(SUM(GREATEST(lock.discount_paise-lock.reversed_paise,0)),0)::BIGINT AS spent_paise,
                  saved.alert_threshold_bps,saved.approval_above_bps,saved.active,saved.updated_at
             FROM saved LEFT JOIN pos_happy_hour_locks lock ON lock.tenant_id=saved.tenant_id
              AND lock.branch_id=saved.branch_id AND lock.created_at::DATE BETWEEN saved.period_start AND saved.period_end
            GROUP BY saved.id,saved.period_start,saved.period_end,saved.budget_paise,saved.alert_threshold_bps,saved.approval_above_bps,saved.active,saved.updated_at"#,
    )
    .bind(tenant_id).bind(branch_id).bind(period_start).bind(period_end).bind(budget_paise)
    .bind(alert_threshold_bps).bind(approval_above_bps).bind(actor).fetch_one(db).await
}

#[derive(Debug, FromRow)]
pub struct DiscountApprovalInvoiceRecord {
    pub invoice_number: String,
    pub discount_paise: i64,
    pub finalized_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DiscountApprovalRecord {
    pub id: String,
    pub sale_id: String,
    pub invoice_number: String,
    pub requested_by: String,
    pub requested_role: String,
    pub discount_type: String,
    pub discount_amount_paise: i64,
    pub reason: String,
    pub status: String,
    pub decision_note: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct DiscountApprovalGateRecord {
    pub status: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct CouponAbuseCandidate {
    pub client_id: String,
    pub coupon_code: String,
    pub usage_count: i64,
    pub total_discount_paise: i64,
    pub latest_sale_id: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CouponAbuseAlertRecord {
    pub id: String,
    pub client_id: String,
    pub client_name: String,
    pub coupon_code: String,
    pub alert_type: String,
    pub severity: String,
    pub evidence_json: Value,
    pub status: String,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub resolution_note: String,
    pub detected_at: DateTime<Utc>,
}

const DISCOUNT_APPROVAL_COLUMNS: &str = "approval.id,approval.sale_id,sale.invoice_number,approval.requested_by,approval.requested_role,approval.discount_type,approval.discount_amount_paise,approval.reason,approval.status,approval.decision_note,approval.decided_by,approval.decided_at,approval.expires_at,approval.created_at,approval.updated_at";

pub async fn discount_approval_invoice(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<Option<DiscountApprovalInvoiceRecord>, sqlx::Error> {
    sqlx::query_as("SELECT invoice_number,discount_paise,finalized_at FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(sale_id).fetch_optional(db).await
}

pub async fn expire_discount_approvals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("UPDATE pos_discount_approval_requests SET status='expired',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND status='pending' AND expires_at<=NOW()")
        .bind(tenant_id).bind(branch_id).execute(db).await?.rows_affected())
}

pub async fn list_discount_approvals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<DiscountApprovalRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {DISCOUNT_APPROVAL_COLUMNS} FROM pos_discount_approval_requests approval JOIN pos_sales sale ON sale.tenant_id=approval.tenant_id AND sale.branch_id=approval.branch_id AND sale.id=approval.sale_id WHERE approval.tenant_id=$1 AND approval.branch_id=$2 AND ($3='' OR approval.status=$3) ORDER BY approval.created_at DESC LIMIT 200"
    )).bind(tenant_id).bind(branch_id).bind(status).fetch_all(db).await
}

pub async fn create_discount_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    actor: &str,
    role: &str,
    reason: &str,
) -> Result<Option<DiscountApprovalRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE pos_discount_approval_requests SET status='superseded',decision_note='Superseded by a newer request',decided_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND status='pending'")
        .bind(tenant_id).bind(branch_id).bind(sale_id).execute(&mut *tx).await?;
    let row = sqlx::query_as(&format!(
        "WITH inserted AS (INSERT INTO pos_discount_approval_requests(tenant_id,branch_id,sale_id,requested_by,requested_role,discount_type,discount_amount_paise,reason) SELECT sale.tenant_id,sale.branch_id,sale.id,$4,$5,CASE WHEN sale.coupon_discount_paise=sale.discount_paise THEN 'coupon' WHEN sale.bill_discount_paise=sale.discount_paise THEN 'bill' WHEN sale.bill_discount_paise=0 AND sale.coupon_discount_paise=0 THEN 'line' ELSE 'combined' END,sale.discount_paise,$6 FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.id=$3 AND sale.finalized_at IS NULL AND sale.discount_paise>0 RETURNING *) SELECT {DISCOUNT_APPROVAL_COLUMNS} FROM inserted approval JOIN pos_sales sale ON sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.id=approval.sale_id"
    )).bind(tenant_id).bind(branch_id).bind(sale_id).bind(actor).bind(role).bind(reason)
        .fetch_optional(&mut *tx).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn decide_discount_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    status: &str,
    note: &str,
) -> Result<Option<DiscountApprovalRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "WITH decided AS (UPDATE pos_discount_approval_requests SET status=$5,decision_note=$6,decided_by=$4,decided_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending' AND expires_at>NOW() AND requested_by<>$4 RETURNING *) SELECT {DISCOUNT_APPROVAL_COLUMNS} FROM decided approval JOIN pos_sales sale ON sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.id=approval.sale_id"
    )).bind(tenant_id).bind(branch_id).bind(id).bind(actor).bind(status).bind(note)
        .fetch_optional(db).await
}

pub async fn discount_approval_gate(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<Option<DiscountApprovalGateRecord>, sqlx::Error> {
    sqlx::query_as("SELECT status FROM pos_discount_approval_requests WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 ORDER BY created_at DESC LIMIT 1")
        .bind(tenant_id).bind(branch_id).bind(sale_id).fetch_optional(db).await
}

pub async fn coupon_abuse_candidates(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<CouponAbuseCandidate>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT client_id,coupon_code,COUNT(*)::BIGINT AS usage_count,
                  COALESCE(SUM(coupon_discount_paise),0)::BIGINT AS total_discount_paise,
                  (ARRAY_AGG(id ORDER BY finalized_at DESC,id DESC))[1] AS latest_sale_id
             FROM pos_sales
            WHERE tenant_id=$1 AND branch_id=$2 AND finalized_at IS NOT NULL
              AND client_id<>'' AND coupon_code<>''
            GROUP BY client_id,coupon_code HAVING COUNT(*)>=3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn coupon_abuse_candidate_for_sale(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<Option<CouponAbuseCandidate>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH target AS (
             SELECT client_id,coupon_code FROM pos_sales
              WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND finalized_at IS NOT NULL
                AND client_id<>'' AND coupon_code<>''
           )
           SELECT sale.client_id,sale.coupon_code,COUNT(*)::BIGINT AS usage_count,
                  COALESCE(SUM(sale.coupon_discount_paise),0)::BIGINT AS total_discount_paise,
                  (ARRAY_AGG(sale.id ORDER BY sale.finalized_at DESC,sale.id DESC))[1] AS latest_sale_id
             FROM pos_sales sale JOIN target ON target.client_id=sale.client_id AND target.coupon_code=sale.coupon_code
            WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.finalized_at IS NOT NULL
            GROUP BY sale.client_id,sale.coupon_code HAVING COUNT(*)>=3"#,
    ).bind(tenant_id).bind(branch_id).bind(sale_id).fetch_optional(db).await
}

pub async fn upsert_coupon_abuse_alert(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    candidate: &CouponAbuseCandidate,
) -> Result<CouponAbuseAlertRecord, sqlx::Error> {
    let signature = format!(
        "coupon_reuse:{}:{}",
        candidate.coupon_code, candidate.client_id
    );
    let evidence = serde_json::json!({
        "usageCount": candidate.usage_count,
        "totalDiscountPaise": candidate.total_discount_paise,
        "latestSaleId": candidate.latest_sale_id,
    });
    sqlx::query_as(
        r#"INSERT INTO pos_coupon_abuse_alerts(tenant_id,branch_id,signature,client_id,coupon_code,evidence_json)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(tenant_id,branch_id,signature) DO UPDATE SET
             evidence_json=EXCLUDED.evidence_json,detected_at=NOW(),
             status=CASE WHEN pos_coupon_abuse_alerts.status='resolved' THEN 'resolved' ELSE 'open' END,
             updated_at=NOW()
           RETURNING id,client_id,
             COALESCE((SELECT CONCAT_WS(' ',first_name,last_name) FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=pos_coupon_abuse_alerts.client_id),'') AS client_name,
             coupon_code,alert_type,severity,evidence_json,status,resolved_by,resolved_at,resolution_note,detected_at"#,
    ).bind(tenant_id).bind(branch_id).bind(signature).bind(&candidate.client_id)
        .bind(&candidate.coupon_code).bind(evidence).fetch_one(db).await
}

pub async fn list_coupon_abuse_alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<CouponAbuseAlertRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT alert.id,alert.client_id,COALESCE(CONCAT_WS(' ',client.first_name,client.last_name),'') AS client_name,alert.coupon_code,alert.alert_type,alert.severity,alert.evidence_json,alert.status,alert.resolved_by,alert.resolved_at,alert.resolution_note,alert.detected_at FROM pos_coupon_abuse_alerts alert LEFT JOIN clients client ON client.tenant_id=alert.tenant_id AND client.branch_id=alert.branch_id AND client.id=alert.client_id WHERE alert.tenant_id=$1 AND alert.branch_id=$2 AND ($3='' OR alert.status=$3) ORDER BY CASE alert.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,alert.detected_at DESC LIMIT 200"
    ).bind(tenant_id).bind(branch_id).bind(status).fetch_all(db).await
}

pub async fn resolve_coupon_abuse_alert(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    note: &str,
) -> Result<Option<CouponAbuseAlertRecord>, sqlx::Error> {
    sqlx::query_as(
        "UPDATE pos_coupon_abuse_alerts alert SET status='resolved',resolved_by=$4,resolved_at=NOW(),resolution_note=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,client_id,COALESCE((SELECT CONCAT_WS(' ',first_name,last_name) FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=alert.client_id),'') AS client_name,coupon_code,alert_type,severity,evidence_json,status,resolved_by,resolved_at,resolution_note,detected_at"
    ).bind(tenant_id).bind(branch_id).bind(id).bind(actor).bind(note).fetch_optional(db).await
}
