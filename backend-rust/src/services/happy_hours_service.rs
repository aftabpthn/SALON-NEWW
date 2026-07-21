use chrono::{DateTime, Duration, FixedOffset, NaiveDate, NaiveTime, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};

use crate::{
    models::common::AppError,
    repositories::happy_hours_repository::{
        self, AudienceCriteriaQuery, AutoSunsetDecisionRecord, AutoSunsetOfferRecord,
        AutoSunsetPolicyRecord, BranchOfferPerformanceRecord, ClientReturnRecord,
        ContextOfferSuggestionRecord, CouponAbuseAlertRecord, CouponAbuseCandidate,
        DailyDiscountRecord, DiscountApprovalRecord, ElasticityBandRecord, FraudCaseRecord,
        HappyHourAnomalyRecord, HappyHourApprovalRecord, HappyHourAudienceRecord,
        HappyHourBudgetRecord, HappyHourCampaignLinkRecord, HappyHourPerformanceRecord,
        HappyHourRuleAnalysisRecord, HappyHourSimulationServiceRecord, InventoryOfferRecord,
        MarketPriceObservationRecord, MarketSuggestionRecord, NewAutoSunsetDecision,
        NewCampaignLink, NewContextOfferSuggestion, NewFraudCase, NewHappyHourAnomaly,
        NewMarketPriceObservation, NewMarketSuggestion, NoShowRiskRecord, StaffOfferRecord,
        UpsertAudience, UpsertAutoSunsetPolicy,
    },
    services::security_service,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleConflictSummary {
    pub rules_checked: usize,
    pub conflict_count: usize,
    pub high_severity_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleConflict {
    pub rule_id: String,
    pub rule_name: String,
    pub conflicting_rule_id: String,
    pub conflicting_rule_name: String,
    pub severity: &'static str,
    pub conflict_type: &'static str,
    pub overlapping_weekdays: Vec<i16>,
    pub reasons: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleConflictResponse {
    pub summary: RuleConflictSummary,
    pub conflicts: Vec<RuleConflict>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HappyHourSimulationRequest {
    pub service_id: String,
    pub client_id: Option<String>,
    pub weekday: i16,
    pub time: NaiveTime,
    pub quantity: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HappyHourSimulationResponse {
    pub status: &'static str,
    pub reason: &'static str,
    pub rule_id: Option<String>,
    pub rule_name: Option<String>,
    pub service_id: String,
    pub service_name: String,
    pub quantity: i64,
    pub gross_paise: i64,
    pub discount_paise: i64,
    pub payable_paise: i64,
    pub cost_paise: Option<i64>,
    pub margin_bps: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovalRequest {
    pub rule_id: String,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovalDecisionRequest {
    pub decision: String,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscountApprovalRequest {
    pub invoice_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CouponAbuseScanResponse {
    pub detected: usize,
    pub alerts: Vec<CouponAbuseAlertRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CouponAbuseResolutionRequest {
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnomalyReviewRequest {
    pub status: String,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BudgetWriteRequest {
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub budget_paise: i64,
    pub alert_threshold_bps: i32,
    pub approval_above_bps: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetResponse {
    pub id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub budget_paise: i64,
    pub spent_paise: i64,
    pub remaining_paise: i64,
    pub used_bps: i64,
    pub alert_threshold_bps: i32,
    pub approval_above_bps: i32,
    pub threshold_reached: bool,
    pub exceeded: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnomalyScanResponse {
    pub detected: usize,
    pub anomalies: Vec<HappyHourAnomalyRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FraudCaseReviewRequest {
    pub status: String,
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FraudScanResponse {
    pub detected: usize,
    pub cases: Vec<FraudCaseRecord>,
}

#[derive(Debug)]
pub struct RuleApprovalAssessment {
    pub required: bool,
    pub role_limit_bps: i32,
    pub policy_limit_bps: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HappyHourControlTowerSummary {
    pub total_rules: usize,
    pub active_rules: usize,
    pub live_rules: usize,
    pub collecting_rules: usize,
    pub measured_offers: usize,
    pub applications: i64,
    pub sales_value_paise: i64,
    pub discount_paise: i64,
    pub reversed_discount_paise: i64,
    pub average_health_score: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HappyHourControlTowerOffer {
    pub rule_id: String,
    pub name: String,
    pub active: bool,
    pub lifecycle_stage: &'static str,
    pub roi_status: &'static str,
    pub health_status: &'static str,
    pub health_score: i32,
    pub applications: i64,
    pub active_applications: i64,
    pub sales_value_paise: i64,
    pub discount_paise: i64,
    pub reversed_discount_paise: i64,
    pub discount_rate_bps: i64,
    pub return_on_discount_bps: i64,
    pub last_applied_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HappyHourControlTowerResponse {
    pub summary: HappyHourControlTowerSummary,
    pub offers: Vec<HappyHourControlTowerOffer>,
    pub note: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HappyHourIntelligenceSummary {
    pub fraud_review_signals: usize,
    pub no_show_risks: usize,
    pub inventory_actions: usize,
    pub staff_actions: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FraudReviewSignal {
    pub signal_type: &'static str,
    pub subject_id: String,
    pub subject: String,
    pub severity: &'static str,
    pub occurrences: i64,
    pub amount_paise: i64,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoShowRiskSignal {
    pub client_id: String,
    pub client_name: String,
    pub total_appointments: i64,
    pub no_show_count: i64,
    pub cancellation_count: i64,
    pub completed_count: i64,
    pub risk_score: i32,
    pub risk_level: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryOfferSignal {
    pub item_id: String,
    pub item_name: String,
    pub stock_quantity: i32,
    pub reorder_point: i32,
    pub status: &'static str,
    pub recommendation: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffOfferSignal {
    pub staff_id: String,
    pub staff_name: String,
    pub schedule_status: String,
    pub scheduled_minutes: i64,
    pub booked_minutes: i64,
    pub appointment_count: i64,
    pub occupancy_bps: i64,
    pub recommendation: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HappyHourIntelligenceResponse {
    pub summary: HappyHourIntelligenceSummary,
    pub fraud_review: Vec<FraudReviewSignal>,
    pub no_show_risks: Vec<NoShowRiskSignal>,
    pub inventory_offers: Vec<InventoryOfferSignal>,
    pub staff_offers: Vec<StaffOfferSignal>,
    pub note: &'static str,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudienceCriteria {
    pub inactive_days_gte: Option<i32>,
    pub visit_count_gte: Option<i64>,
    pub total_spend_paise_gte: Option<i64>,
    pub birthday_month: Option<i32>,
    pub client_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudienceWriteRequest {
    pub audience_key: Option<String>,
    pub name: String,
    pub channel: String,
    pub criteria: AudienceCriteria,
    pub status: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudienceSample {
    pub client_id: String,
    pub client_name: String,
    pub visit_count: i64,
    pub total_spend_paise: i64,
    pub inactive_days: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudiencePreviewResponse {
    pub estimate_count: i64,
    pub sample: Vec<AudienceSample>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudienceResponse {
    pub id: String,
    pub audience_key: String,
    pub name: String,
    pub channel: String,
    pub criteria: AudienceCriteria,
    pub estimate_count: i64,
    pub previewed_at: Option<DateTime<Utc>>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatusRequest {
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CampaignLinkWriteRequest {
    pub audience_id: String,
    pub rule_id: String,
    pub coupon_id: Option<String>,
    pub title: String,
    pub message: String,
    pub status: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignLinkResponse {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketObservationWriteRequest {
    pub service_category: String,
    pub competitor_name: String,
    pub observed_price_paise: i64,
    pub observed_on: NaiveDate,
    pub source_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketObservationResponse {
    pub id: String,
    pub service_category: String,
    pub competitor_name: String,
    pub observed_price_paise: i64,
    pub observed_on: NaiveDate,
    pub source_url: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketEvaluationRequest {
    pub service_category: String,
    pub signal_date: Option<NaiveDate>,
    pub hour_slot: Option<i32>,
    pub our_price_paise: Option<i64>,
    pub base_discount_bps: Option<i32>,
    pub max_discount_bps: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketEvaluationResponse {
    pub status: &'static str,
    pub service_category: String,
    pub signal_date: NaiveDate,
    pub hour_slot: i16,
    pub our_price_paise: i64,
    pub base_discount_bps: i32,
    pub max_discount_bps: i32,
    pub benchmark_source: &'static str,
    pub market_avg_paise: i64,
    pub market_min_paise: i64,
    pub market_max_paise: i64,
    pub observation_count: i64,
    pub scheduled_staff: i64,
    pub appointment_count: i64,
    pub occupancy_bps: i64,
    pub price_gap_bps: i64,
    pub market_position: &'static str,
    pub campaign_angle: &'static str,
    pub suggested_discount_bps: i32,
    pub reasons: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketSuggestionResponse {
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
    pub reasons: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextOfferEvaluationRequest {
    pub offer_type: String,
    pub service_category: String,
    pub client_id: Option<String>,
    pub signal_date: Option<NaiveDate>,
    pub hour_slot: Option<i32>,
    pub service_price_paise: Option<i64>,
    pub base_discount_bps: Option<i32>,
    pub max_discount_bps: Option<i32>,
    pub selected_service_count: Option<i32>,
    pub cart_total_paise: Option<i64>,
    pub source_channel: Option<String>,
    pub channel_fee_bps: Option<i32>,
    pub booking_lead_minutes: Option<i64>,
    pub weather_condition: Option<String>,
    pub temperature_celsius: Option<i32>,
    pub rain_probability_percent: Option<i32>,
    pub event_type: Option<String>,
    pub event_name: Option<String>,
    pub expected_footfall: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextOfferEvaluationResponse {
    pub readiness: &'static str,
    pub offer_type: String,
    pub service_category: String,
    pub signal_date: NaiveDate,
    pub hour_slot: i16,
    pub service_price_paise: i64,
    pub base_discount_bps: i32,
    pub suggested_discount_bps: i32,
    pub campaign_angle: &'static str,
    pub context: Value,
    pub reasons: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextOfferSuggestionResponse {
    pub id: String,
    pub offer_type: String,
    pub service_category: String,
    pub signal_date: NaiveDate,
    pub hour_slot: i16,
    pub service_price_paise: i64,
    pub base_discount_bps: i32,
    pub suggested_discount_bps: i32,
    pub campaign_angle: String,
    pub context: Value,
    pub reasons: Vec<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoSunsetPolicyRequest {
    pub expire_past_end_date: bool,
    pub pause_coupons_at_usage_limit: bool,
    pub review_no_end_date_after_days: i32,
    pub auto_apply_expired: bool,
    pub auto_apply_usage_limit: bool,
    pub auto_apply_stale: bool,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSunsetPolicyResponse {
    pub expire_past_end_date: bool,
    pub pause_coupons_at_usage_limit: bool,
    pub review_no_end_date_after_days: i32,
    pub auto_apply_expired: bool,
    pub auto_apply_usage_limit: bool,
    pub auto_apply_stale: bool,
    pub status: String,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSunsetDecisionResponse {
    pub id: String,
    pub offer_type: String,
    pub offer_id: String,
    pub offer_name: String,
    pub action: String,
    pub reason: String,
    pub severity: String,
    pub status: String,
    pub evidence: Value,
    pub source: String,
    pub decided_at: DateTime<Utc>,
    pub applied_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSunsetScanResponse {
    pub policy: AutoSunsetPolicyResponse,
    pub decisions: Vec<AutoSunsetDecisionResponse>,
    pub applied: Vec<AutoSunsetDecisionResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchLeaderboardRow {
    pub rank: usize,
    pub branch_id: String,
    pub branch_name: String,
    pub active_offers: i64,
    pub applications: i64,
    pub unique_clients: i64,
    pub repeat_clients: i64,
    pub sales_value_paise: i64,
    pub net_discount_paise: i64,
    pub return_on_discount_bps: i64,
    pub repeat_rate_bps: i64,
    pub reversal_rate_bps: i64,
    pub leaderboard_score: i32,
    pub leaderboard_grade: &'static str,
    pub recommendation: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientReturnSummary {
    pub offer_uses: usize,
    pub returned_count: usize,
    pub pending_count: usize,
    pub at_risk_count: usize,
    pub unique_clients: usize,
    pub returned_clients: usize,
    pub return_rate_bps: i64,
    pub average_days_to_return: i64,
    pub discount_paise: i64,
    pub return_revenue_paise: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientReturnRow {
    pub source_id: String,
    pub offer_type: String,
    pub offer_id: String,
    pub offer_title: String,
    pub client_id: String,
    pub client_name: String,
    pub used_at: DateTime<Utc>,
    pub amount_paise: i64,
    pub discount_paise: i64,
    pub status: &'static str,
    pub return_at: Option<DateTime<Utc>>,
    pub return_amount_paise: i64,
    pub days_to_return: Option<i64>,
    pub recommendation: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferReturnRow {
    pub offer_type: String,
    pub offer_id: String,
    pub offer_title: String,
    pub offer_uses: usize,
    pub returned_count: usize,
    pub at_risk_count: usize,
    pub return_rate_bps: i64,
    pub return_revenue_paise: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientReturnTrackerResponse {
    pub summary: ClientReturnSummary,
    pub clients: Vec<ClientReturnRow>,
    pub offers: Vec<OfferReturnRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElasticityPricingRow {
    pub service_id: String,
    pub service_name: String,
    pub discount_bps: i64,
    pub sample_count: i64,
    pub average_units_per_slot: f64,
    pub demand_lift_bps: i64,
    pub elasticity: f64,
    pub revenue_paise: i64,
    pub discount_paise: i64,
    pub product_cost_paise: i64,
    pub staff_cost_paise: i64,
    pub net_profit_paise: i64,
    pub profit_per_slot_paise: i64,
    pub margin_bps: i64,
    pub minimum_margin_bps: i64,
    pub margin_safe: bool,
    pub recommended: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElasticityPricingResponse {
    pub status: &'static str,
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
    pub service_count: usize,
    pub ready_service_count: usize,
    pub band_count: usize,
    pub rows: Vec<ElasticityPricingRow>,
    pub source: &'static str,
}

pub async fn control_tower(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<HappyHourControlTowerResponse, AppError> {
    let rows = happy_hours_repository::performance(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load Happy Hours control tower"))?;
    let offers = rows.into_iter().map(to_offer).collect::<Vec<_>>();
    let measured = offers
        .iter()
        .filter(|offer| offer.roi_status == "measured")
        .collect::<Vec<_>>();
    let summary = HappyHourControlTowerSummary {
        total_rules: offers.len(),
        active_rules: offers.iter().filter(|offer| offer.active).count(),
        live_rules: offers
            .iter()
            .filter(|offer| offer.lifecycle_stage == "live")
            .count(),
        collecting_rules: offers
            .iter()
            .filter(|offer| offer.roi_status == "collecting")
            .count(),
        measured_offers: measured.len(),
        applications: offers.iter().map(|offer| offer.applications).sum(),
        sales_value_paise: offers.iter().map(|offer| offer.sales_value_paise).sum(),
        discount_paise: offers.iter().map(|offer| offer.discount_paise).sum(),
        reversed_discount_paise: offers
            .iter()
            .map(|offer| offer.reversed_discount_paise)
            .sum(),
        average_health_score: if measured.is_empty() {
            0
        } else {
            measured.iter().map(|offer| offer.health_score).sum::<i32>() / measured.len() as i32
        },
    };
    Ok(HappyHourControlTowerResponse {
        summary,
        offers,
        note: "ROI status reports observed sales-to-discount efficiency only; causal lift, margin and return behavior remain collecting until those outcomes are persisted.",
    })
}

pub async fn intelligence(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<HappyHourIntelligenceResponse, AppError> {
    let (
        performance,
        repeated_coupons,
        exhausted_coupons,
        no_show_rows,
        inventory_rows,
        staff_rows,
    ) = tokio::try_join!(
        happy_hours_repository::performance(db, tenant_id, branch_id),
        happy_hours_repository::repeated_coupon_usage(db, tenant_id, branch_id),
        happy_hours_repository::exhausted_coupons(db, tenant_id, branch_id),
        happy_hours_repository::no_show_risks(db, tenant_id, branch_id),
        happy_hours_repository::inventory_offer_signals(db, tenant_id, branch_id),
        happy_hours_repository::staff_offer_signals(db, tenant_id, branch_id),
    )
    .map_err(|_| AppError::internal("failed to load Happy Hours intelligence"))?;

    let mut fraud_review = repeated_coupons
        .into_iter()
        .map(|row| FraudReviewSignal {
            signal_type: "repeated_coupon_use",
            subject_id: row.client_id,
            subject: format!("{} · {}", row.client_name, row.coupon_code),
            severity: if row.redemptions >= 5 {
                "high"
            } else {
                "review"
            },
            occurrences: row.redemptions,
            amount_paise: row.discount_paise,
            reason: format!(
                "Coupon used {} times by this client in 180 days; last used {}.",
                row.redemptions,
                row.last_used_at.format("%d/%m/%Y")
            ),
        })
        .collect::<Vec<_>>();
    fraud_review.extend(exhausted_coupons.into_iter().map(|row| FraudReviewSignal {
        signal_type: "coupon_limit_reached",
        subject_id: row.coupon_id,
        subject: row.coupon_code,
        severity: "high",
        occurrences: row.used_count,
        amount_paise: 0,
        reason: format!(
            "Active coupon reached its usage limit of {}.",
            row.usage_limit
        ),
    }));
    fraud_review.extend(performance.into_iter().filter_map(|row| {
        let reversal_bps = ratio_bps(row.reversed_discount_paise, row.discount_paise);
        (row.applications > 0 && reversal_bps >= 2_000).then(|| FraudReviewSignal {
            signal_type: "discount_reversal_rate",
            subject_id: row.rule_id,
            subject: row.name,
            severity: if reversal_bps >= 5_000 {
                "high"
            } else {
                "review"
            },
            occurrences: row.applications,
            amount_paise: row.reversed_discount_paise,
            reason: format!(
                "{}% of applied discount value was reversed.",
                reversal_bps / 100
            ),
        })
    }));

    let no_show_risks = no_show_rows
        .into_iter()
        .map(no_show_signal)
        .collect::<Vec<_>>();
    let inventory_offers = inventory_rows
        .into_iter()
        .map(inventory_signal)
        .collect::<Vec<_>>();
    let staff_offers = staff_rows.into_iter().map(staff_signal).collect::<Vec<_>>();
    let summary = HappyHourIntelligenceSummary {
        fraud_review_signals: fraud_review.len(),
        no_show_risks: no_show_risks.len(),
        inventory_actions: inventory_offers.len(),
        staff_actions: staff_offers
            .iter()
            .filter(|row| row.recommendation != "collecting")
            .count(),
    };

    Ok(HappyHourIntelligenceResponse {
        summary,
        fraud_review,
        no_show_risks,
        inventory_offers,
        staff_offers,
        note: "Signals use observed 180-day appointment and coupon outcomes, current stock thresholds, and today's saved staff schedule. Review signals are not automatic fraud findings or causal forecasts.",
    })
}

pub async fn preview_audience(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: &AudienceWriteRequest,
) -> Result<AudiencePreviewResponse, AppError> {
    let channel = campaign_channel(&input.channel)?;
    validate_audience_criteria(&input.criteria)?;
    let client_type = input.criteria.client_type.as_deref().unwrap_or("");
    let rows = happy_hours_repository::preview_audience(
        db,
        tenant_id,
        branch_id,
        AudienceCriteriaQuery {
            channel,
            inactive_days_gte: input.criteria.inactive_days_gte,
            visit_count_gte: input.criteria.visit_count_gte,
            total_spend_paise_gte: input.criteria.total_spend_paise_gte,
            birthday_month: input.criteria.birthday_month,
            client_type,
            sample_limit: 20,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to preview campaign audience"))?;
    Ok(AudiencePreviewResponse {
        estimate_count: rows.first().map(|row| row.total_count).unwrap_or(0),
        sample: rows
            .into_iter()
            .map(|row| AudienceSample {
                client_id: row.client_id,
                client_name: row.client_name,
                visit_count: row.visit_count,
                total_spend_paise: row.total_spend_paise,
                inactive_days: row.inactive_days,
            })
            .collect(),
    })
}

pub async fn list_audiences(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<AudienceResponse>, AppError> {
    happy_hours_repository::list_audiences(db, tenant_id, branch_id)
        .await
        .map(|rows| rows.into_iter().map(audience_response).collect())
        .map_err(|_| AppError::internal("failed to load campaign audiences"))
}

pub async fn save_audience(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: AudienceWriteRequest,
) -> Result<AudienceResponse, AppError> {
    let name = required_campaign_text(&input.name, "audience name is required", 120)?;
    let channel = campaign_channel(&input.channel)?;
    let status = campaign_status(input.status.as_deref().unwrap_or("draft"))?;
    // ponytail: estimate is a save-time snapshot; recompute before a future send workflow.
    let preview = preview_audience(db, tenant_id, branch_id, &input).await?;
    let audience_key = audience_key(input.audience_key.as_deref().unwrap_or(&name));
    if audience_key.is_empty() {
        return Err(AppError::validation("audience key is invalid"));
    }
    let criteria_json = serde_json::to_value(&input.criteria)
        .map_err(|_| AppError::validation("audience criteria is invalid"))?;
    happy_hours_repository::upsert_audience(
        db,
        tenant_id,
        branch_id,
        UpsertAudience {
            audience_key: &audience_key,
            name: &name,
            channel,
            criteria_json: &criteria_json,
            estimate_count: preview.estimate_count,
            status,
        },
    )
    .await
    .map(audience_response)
    .map_err(|_| AppError::internal("failed to save campaign audience"))
}

pub async fn set_audience_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
) -> Result<AudienceResponse, AppError> {
    let status = campaign_status(status)?;
    happy_hours_repository::update_audience_status(db, tenant_id, branch_id, id, status)
        .await
        .map_err(|_| AppError::internal("failed to update campaign audience"))?
        .map(audience_response)
        .ok_or_else(|| AppError::not_found("campaign audience was not found"))
}

pub async fn list_campaign_links(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<CampaignLinkResponse>, AppError> {
    happy_hours_repository::list_campaign_links(db, tenant_id, branch_id)
        .await
        .map(|rows| rows.into_iter().map(campaign_link_response).collect())
        .map_err(|_| AppError::internal("failed to load campaign links"))
}

pub async fn save_campaign_link(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: CampaignLinkWriteRequest,
) -> Result<CampaignLinkResponse, AppError> {
    let audience_id = required_campaign_text(&input.audience_id, "audience is required", 100)?;
    let rule_id = required_campaign_text(&input.rule_id, "Happy Hour rule is required", 100)?;
    let coupon_id = input
        .coupon_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let title = required_campaign_text(&input.title, "campaign title is required", 180)?;
    let message = required_campaign_text(&input.message, "campaign message is required", 1200)?;
    let status = campaign_status(input.status.as_deref().unwrap_or("draft"))?;
    let context = happy_hours_repository::campaign_link_context(
        db,
        tenant_id,
        branch_id,
        &audience_id,
        &rule_id,
        coupon_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to validate campaign link"))?
    .ok_or_else(|| AppError::validation("audience, rule or coupon is invalid"))?;
    if context.audience_status != "ready" {
        return Err(AppError::validation("campaign audience must be ready"));
    }
    if !context.rule_active {
        return Err(AppError::validation("Happy Hour rule must be active"));
    }
    if coupon_id.is_some() && context.coupon_active != Some(true) {
        return Err(AppError::validation("coupon must be active"));
    }
    happy_hours_repository::create_campaign_link(
        db,
        tenant_id,
        branch_id,
        NewCampaignLink {
            audience_id: &audience_id,
            rule_id: &rule_id,
            coupon_id,
            channel: &context.audience_channel,
            title: &title,
            message: &message,
            status,
        },
    )
    .await
    .map(campaign_link_response)
    .map_err(|_| AppError::internal("failed to save campaign link"))
}

pub async fn set_campaign_link_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
) -> Result<CampaignLinkResponse, AppError> {
    let status = campaign_status(status)?;
    happy_hours_repository::update_campaign_link_status(db, tenant_id, branch_id, id, status)
        .await
        .map_err(|_| AppError::internal("failed to update campaign link"))?
        .map(campaign_link_response)
        .ok_or_else(|| AppError::not_found("campaign link was not found"))
}

pub async fn list_market_observations(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<MarketObservationResponse>, AppError> {
    happy_hours_repository::list_market_observations(db, tenant_id, branch_id)
        .await
        .map(|rows| rows.into_iter().map(market_observation_response).collect())
        .map_err(|_| AppError::internal("failed to load market observations"))
}

pub async fn save_market_observation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: MarketObservationWriteRequest,
) -> Result<MarketObservationResponse, AppError> {
    let service_category =
        required_market_text(&input.service_category, "service category is required", 120)?;
    let competitor_name =
        required_market_text(&input.competitor_name, "competitor name is required", 160)?;
    if input.observed_price_paise <= 0 {
        return Err(AppError::validation(
            "observed price must be greater than zero",
        ));
    }
    let source_url = input.source_url.unwrap_or_default().trim().to_string();
    if source_url.chars().count() > 500 {
        return Err(AppError::validation("source URL is too long"));
    }
    if !source_url.is_empty()
        && !source_url.starts_with("https://")
        && !source_url.starts_with("http://")
    {
        return Err(AppError::validation("source URL must use http or https"));
    }
    let local_today = (Utc::now() + Duration::minutes(330)).date_naive();
    if input.observed_on > local_today {
        return Err(AppError::validation(
            "observed date cannot be in the future",
        ));
    }
    happy_hours_repository::create_market_observation(
        db,
        tenant_id,
        branch_id,
        NewMarketPriceObservation {
            service_category: &service_category,
            competitor_name: &competitor_name,
            observed_price_paise: input.observed_price_paise,
            observed_on: input.observed_on,
            source_url: &source_url,
        },
    )
    .await
    .map(market_observation_response)
    .map_err(|_| AppError::internal("failed to save market observation"))
}

pub async fn evaluate_market_offer(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: MarketEvaluationRequest,
) -> Result<MarketEvaluationResponse, AppError> {
    let service_category =
        required_market_text(&input.service_category, "service category is required", 120)?;
    let local_now = Utc::now() + Duration::minutes(330);
    let signal_date = input.signal_date.unwrap_or_else(|| local_now.date_naive());
    let hour_slot = input.hour_slot.unwrap_or(local_now.hour() as i32);
    if !(0..=23).contains(&hour_slot) {
        return Err(AppError::validation("hour slot must be between 0 and 23"));
    }
    if input.our_price_paise.is_some_and(|value| value <= 0) {
        return Err(AppError::validation("our price must be greater than zero"));
    }
    let base_discount_bps = input.base_discount_bps.unwrap_or(0);
    let max_discount_bps = input.max_discount_bps.unwrap_or(2_000);
    if !(0..=4_000).contains(&base_discount_bps)
        || !(0..=4_000).contains(&max_discount_bps)
        || base_discount_bps > max_discount_bps
    {
        return Err(AppError::validation(
            "discount range must be between 0 and 40 percent",
        ));
    }
    let context = happy_hours_repository::market_context(
        db,
        tenant_id,
        branch_id,
        &service_category,
        signal_date,
        hour_slot,
    )
    .await
    .map_err(|_| AppError::internal("failed to evaluate market-aware offer"))?;
    let our_price_paise = input.our_price_paise.unwrap_or(context.our_price_paise);
    let (benchmark_source, market_avg_paise, market_min_paise, market_max_paise, observation_count) =
        if context.competitor_count > 0 {
            (
                "competitor",
                context.competitor_avg_paise,
                context.competitor_min_paise,
                context.competitor_max_paise,
                context.competitor_count,
            )
        } else if context.internal_branch_count > 0 {
            (
                "internal_branch",
                context.internal_avg_paise,
                context.internal_min_paise,
                context.internal_max_paise,
                context.internal_branch_count,
            )
        } else {
            ("collecting", 0, 0, 0, 0)
        };
    // ponytail: hourly occupancy is appointments per scheduled staff; use duration-weighted capacity when persisted.
    let occupancy_bps =
        ratio_bps(context.appointment_count, context.scheduled_staff).clamp(0, 10_000);
    let price_gap_bps = signed_ratio_bps(our_price_paise - market_avg_paise, market_avg_paise);
    let decision = market_decision(
        our_price_paise,
        market_avg_paise,
        price_gap_bps,
        occupancy_bps,
        context.scheduled_staff,
        base_discount_bps,
        max_discount_bps,
    );
    Ok(MarketEvaluationResponse {
        status: if our_price_paise > 0 && market_avg_paise > 0 {
            "ready"
        } else {
            "collecting"
        },
        service_category,
        signal_date,
        hour_slot: hour_slot as i16,
        our_price_paise,
        base_discount_bps,
        max_discount_bps,
        benchmark_source,
        market_avg_paise,
        market_min_paise,
        market_max_paise,
        observation_count,
        scheduled_staff: context.scheduled_staff,
        appointment_count: context.appointment_count,
        occupancy_bps,
        price_gap_bps,
        market_position: decision.position,
        campaign_angle: decision.angle,
        suggested_discount_bps: decision.discount_bps,
        reasons: decision.reasons,
    })
}

pub async fn list_market_suggestions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<MarketSuggestionResponse>, AppError> {
    happy_hours_repository::list_market_suggestions(db, tenant_id, branch_id)
        .await
        .map(|rows| rows.into_iter().map(market_suggestion_response).collect())
        .map_err(|_| AppError::internal("failed to load market-aware suggestions"))
}

pub async fn save_market_suggestion(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: MarketEvaluationRequest,
) -> Result<MarketSuggestionResponse, AppError> {
    let evaluation = evaluate_market_offer(db, tenant_id, branch_id, input).await?;
    if evaluation.status != "ready" {
        return Err(AppError::validation(
            "our price and a real market benchmark are required",
        ));
    }
    let reasons_json = serde_json::to_value(&evaluation.reasons)
        .map_err(|_| AppError::internal("failed to serialize market evaluation"))?;
    happy_hours_repository::create_market_suggestion(
        db,
        tenant_id,
        branch_id,
        NewMarketSuggestion {
            service_category: &evaluation.service_category,
            signal_date: evaluation.signal_date,
            hour_slot: evaluation.hour_slot,
            our_price_paise: evaluation.our_price_paise,
            base_discount_bps: evaluation.base_discount_bps,
            max_discount_bps: evaluation.max_discount_bps,
            benchmark_source: evaluation.benchmark_source,
            market_avg_paise: evaluation.market_avg_paise,
            market_min_paise: evaluation.market_min_paise,
            market_max_paise: evaluation.market_max_paise,
            observation_count: evaluation.observation_count,
            scheduled_staff: evaluation.scheduled_staff,
            appointment_count: evaluation.appointment_count,
            occupancy_bps: evaluation.occupancy_bps,
            price_gap_bps: evaluation.price_gap_bps,
            market_position: evaluation.market_position,
            campaign_angle: evaluation.campaign_angle,
            suggested_discount_bps: evaluation.suggested_discount_bps,
            reasons_json: &reasons_json,
        },
    )
    .await
    .map(market_suggestion_response)
    .map_err(|_| AppError::internal("failed to save market-aware suggestion"))
}

pub async fn set_market_suggestion_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
) -> Result<MarketSuggestionResponse, AppError> {
    let status = market_suggestion_status(status)?;
    happy_hours_repository::update_market_suggestion_status(db, tenant_id, branch_id, id, status)
        .await
        .map_err(|_| AppError::internal("failed to update market-aware suggestion"))?
        .map(market_suggestion_response)
        .ok_or_else(|| AppError::not_found("market-aware suggestion was not found"))
}

pub async fn evaluate_context_offer(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: ContextOfferEvaluationRequest,
) -> Result<ContextOfferEvaluationResponse, AppError> {
    let offer_type = context_offer_type(&input.offer_type)?;
    let service_category =
        required_market_text(&input.service_category, "service category is required", 120)?;
    let local_now = Utc::now() + Duration::minutes(330);
    let signal_date = input.signal_date.unwrap_or_else(|| local_now.date_naive());
    let hour_slot = input.hour_slot.unwrap_or(local_now.hour() as i32);
    if !(0..=23).contains(&hour_slot) {
        return Err(AppError::validation("hour slot must be between 0 and 23"));
    }
    if input.service_price_paise.is_some_and(|value| value <= 0) {
        return Err(AppError::validation(
            "service price must be greater than zero",
        ));
    }
    let base_discount_bps = input.base_discount_bps.unwrap_or(0);
    let max_discount_bps = input.max_discount_bps.unwrap_or(2_000);
    if !(0..=4_000).contains(&base_discount_bps)
        || !(0..=4_000).contains(&max_discount_bps)
        || base_discount_bps > max_discount_bps
    {
        return Err(AppError::validation(
            "discount range must be between 0 and 40 percent",
        ));
    }
    let selected_service_count = input.selected_service_count.unwrap_or(1);
    if !(1..=20).contains(&selected_service_count) {
        return Err(AppError::validation(
            "selected service count must be between 1 and 20",
        ));
    }
    if input.cart_total_paise.is_some_and(|value| value < 0)
        || input.expected_footfall.is_some_and(|value| value < 0)
    {
        return Err(AppError::validation("offer values cannot be negative"));
    }
    let channel_fee_bps = input.channel_fee_bps.unwrap_or(0);
    if !(0..=4_000).contains(&channel_fee_bps) {
        return Err(AppError::validation(
            "channel fee must be between 0 and 40 percent",
        ));
    }
    let source_channel =
        normalized_context_token(input.source_channel.as_deref().unwrap_or(""), 80)?;
    if offer_type == "channel" && source_channel.is_empty() {
        return Err(AppError::validation("source channel is required"));
    }
    let client_id = if offer_type == "member_wallet" {
        required_market_text(
            input.client_id.as_deref().unwrap_or(""),
            "client is required",
            100,
        )?
    } else {
        String::new()
    };
    let weather_condition = context_choice(
        input.weather_condition.as_deref().unwrap_or("normal"),
        &["normal", "rain", "storm", "heatwave", "cold", "pollution"],
        "weather condition is invalid",
    )?;
    let event_type = context_choice(
        input.event_type.as_deref().unwrap_or("none"),
        &[
            "none",
            "festival",
            "wedding",
            "payday",
            "month_end",
            "local_event",
            "school_holiday",
            "traffic",
            "strike",
        ],
        "event type is invalid",
    )?;
    let event_name = input.event_name.unwrap_or_default().trim().to_string();
    if event_name.chars().count() > 160 {
        return Err(AppError::validation("event name is too long"));
    }
    let temperature_celsius = input.temperature_celsius.unwrap_or(0);
    let rain_probability_percent = input.rain_probability_percent.unwrap_or(0);
    if !(-50..=60).contains(&temperature_celsius) || !(0..=100).contains(&rain_probability_percent)
    {
        return Err(AppError::validation("weather values are invalid"));
    }
    let lead_minutes = input.booking_lead_minutes.unwrap_or_else(|| {
        let target = signal_date.and_hms_opt(hour_slot as u32, 0, 0).unwrap();
        (target - local_now.naive_utc())
            .num_minutes()
            .clamp(0, 129_600)
    });
    if !(0..=129_600).contains(&lead_minutes) {
        return Err(AppError::validation(
            "booking lead time must be between 0 and 90 days",
        ));
    }
    let (lead_bucket, min_lead, max_lead) = lead_bucket(lead_minutes);
    let from_date = signal_date
        .checked_sub_signed(Duration::days(90))
        .unwrap_or(signal_date);
    let signal = happy_hours_repository::context_offer_signal(
        db,
        tenant_id,
        branch_id,
        &service_category,
        signal_date,
        hour_slot,
        &source_channel,
        from_date,
        min_lead,
        max_lead,
        &client_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to evaluate context-aware offer"))?;
    let service_price_paise = input
        .service_price_paise
        .unwrap_or(signal.service_price_paise);
    let occupancy_bps =
        ratio_bps(signal.appointment_count, signal.scheduled_staff).clamp(0, 10_000);
    let no_show_bps =
        ratio_bps(signal.lead_no_show_count, signal.lead_booking_count).clamp(0, 10_000);
    let cart_total_paise = input.cart_total_paise.unwrap_or(service_price_paise);
    let wallet_coverage_bps =
        ratio_bps(signal.wallet_balance_paise, cart_total_paise).clamp(0, 10_000);
    let expected_wallet_use_paise = signal.wallet_balance_paise.min(cart_total_paise).max(0);
    let decision = if offer_type == "member_wallet" {
        member_wallet_decision(
            signal.client_exists,
            signal.wallet_balance_paise,
            wallet_coverage_bps,
            signal.active_membership_count,
            signal.membership_expiry_days,
            signal.membership_credits_remaining,
            signal.reward_points_balance,
            signal.visit_count,
            signal.total_spend_paise,
            signal.scheduled_staff,
            occupancy_bps,
            base_discount_bps,
            max_discount_bps,
        )
    } else {
        context_offer_decision(
            offer_type,
            signal.package_count,
            signal.avg_package_margin_bps,
            selected_service_count,
            signal.channel_booking_count + signal.channel_sales_count,
            channel_fee_bps,
            lead_minutes,
            signal.lead_booking_count,
            no_show_bps,
            weather_condition,
            event_type,
            signal.scheduled_staff,
            signal.appointment_count,
            occupancy_bps,
            base_discount_bps,
            max_discount_bps,
        )
    };
    let ready = service_price_paise > 0 && decision.ready;
    let context = serde_json::json!({
        "selectedServiceCount": selected_service_count,
        "cartTotalPaise": cart_total_paise,
        "packageCount": signal.package_count,
        "averagePackagePricePaise": signal.avg_package_price_paise,
        "averagePackageMarginBps": signal.avg_package_margin_bps,
        "sourceChannel": source_channel,
        "channelFeeBps": channel_fee_bps,
        "channelBookingCount": signal.channel_booking_count,
        "channelSalesCount": signal.channel_sales_count,
        "channelRevenuePaise": signal.channel_revenue_paise,
        "bookingLeadMinutes": lead_minutes,
        "leadTimeBucket": lead_bucket,
        "historicalLeadBookingCount": signal.lead_booking_count,
        "averageHistoricalLeadMinutes": signal.avg_lead_minutes,
        "leadNoShowBps": no_show_bps,
        "weatherCondition": weather_condition,
        "temperatureCelsius": temperature_celsius,
        "rainProbabilityPercent": rain_probability_percent,
        "eventType": event_type,
        "eventName": event_name,
        "expectedFootfall": input.expected_footfall.unwrap_or(0),
        "scheduledStaff": signal.scheduled_staff,
        "appointmentCount": signal.appointment_count,
        "occupancyBps": occupancy_bps,
        "clientId": client_id,
        "walletBalancePaise": signal.wallet_balance_paise,
        "walletActivityCount": signal.wallet_activity_count,
        "walletCoverageBps": wallet_coverage_bps,
        "expectedWalletUsePaise": expected_wallet_use_paise,
        "activeMembershipCount": signal.active_membership_count,
        "membershipExpiryDays": signal.membership_expiry_days,
        "membershipCreditsRemaining": signal.membership_credits_remaining,
        "rewardPointsBalance": signal.reward_points_balance,
        "visitCount": signal.visit_count,
        "totalSpendPaise": signal.total_spend_paise
    });
    let mut reasons = decision.reasons;
    if service_price_paise <= 0 {
        reasons.push("A saved service price or explicit service price is required.".into());
    }
    Ok(ContextOfferEvaluationResponse {
        readiness: if ready { "ready" } else { "collecting" },
        offer_type: offer_type.into(),
        service_category,
        signal_date,
        hour_slot: hour_slot as i16,
        service_price_paise,
        base_discount_bps,
        suggested_discount_bps: if ready { decision.discount_bps } else { 0 },
        campaign_angle: decision.angle,
        context,
        reasons,
    })
}

pub async fn list_context_offer_suggestions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ContextOfferSuggestionResponse>, AppError> {
    happy_hours_repository::list_context_offer_suggestions(db, tenant_id, branch_id)
        .await
        .map(|rows| {
            rows.into_iter()
                .map(context_offer_suggestion_response)
                .collect()
        })
        .map_err(|_| AppError::internal("failed to load context-aware suggestions"))
}

pub async fn save_context_offer_suggestion(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: ContextOfferEvaluationRequest,
) -> Result<ContextOfferSuggestionResponse, AppError> {
    let evaluation = evaluate_context_offer(db, tenant_id, branch_id, input).await?;
    if evaluation.readiness != "ready" {
        return Err(AppError::validation(
            "real source data and a service price are required",
        ));
    }
    let reasons_json = serde_json::to_value(&evaluation.reasons)
        .map_err(|_| AppError::internal("failed to serialize context-aware evaluation"))?;
    happy_hours_repository::create_context_offer_suggestion(
        db,
        tenant_id,
        branch_id,
        NewContextOfferSuggestion {
            offer_type: &evaluation.offer_type,
            service_category: &evaluation.service_category,
            signal_date: evaluation.signal_date,
            hour_slot: evaluation.hour_slot,
            service_price_paise: evaluation.service_price_paise,
            base_discount_bps: evaluation.base_discount_bps,
            suggested_discount_bps: evaluation.suggested_discount_bps,
            campaign_angle: evaluation.campaign_angle,
            context_json: &evaluation.context,
            reasons_json: &reasons_json,
        },
    )
    .await
    .map(context_offer_suggestion_response)
    .map_err(|_| AppError::internal("failed to save context-aware suggestion"))
}

pub async fn set_context_offer_suggestion_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
) -> Result<ContextOfferSuggestionResponse, AppError> {
    let status = market_suggestion_status(status)?;
    happy_hours_repository::update_context_offer_suggestion_status(
        db, tenant_id, branch_id, id, status,
    )
    .await
    .map_err(|_| AppError::internal("failed to update context-aware suggestion"))?
    .map(context_offer_suggestion_response)
    .ok_or_else(|| AppError::not_found("context-aware suggestion was not found"))
}

pub async fn get_auto_sunset_policy(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<AutoSunsetPolicyResponse, AppError> {
    happy_hours_repository::get_auto_sunset_policy(db, tenant_id, branch_id)
        .await
        .map(|row| row.map(auto_sunset_policy_response).unwrap_or_default())
        .map_err(|_| AppError::internal("failed to load auto-sunset policy"))
}

pub async fn save_auto_sunset_policy(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: AutoSunsetPolicyRequest,
) -> Result<AutoSunsetPolicyResponse, AppError> {
    if !(1..=365).contains(&input.review_no_end_date_after_days) {
        return Err(AppError::validation(
            "review days must be between 1 and 365",
        ));
    }
    let status = match input.status.as_str() {
        "active" => "active",
        "paused" => "paused",
        _ => return Err(AppError::validation("policy status is invalid")),
    };
    happy_hours_repository::upsert_auto_sunset_policy(
        db,
        tenant_id,
        branch_id,
        UpsertAutoSunsetPolicy {
            expire_past_end_date: input.expire_past_end_date,
            pause_coupons_at_usage_limit: input.pause_coupons_at_usage_limit,
            review_no_end_date_after_days: input.review_no_end_date_after_days,
            auto_apply_expired: input.auto_apply_expired,
            auto_apply_usage_limit: input.auto_apply_usage_limit,
            auto_apply_stale: input.auto_apply_stale,
            status,
        },
    )
    .await
    .map(auto_sunset_policy_response)
    .map_err(|_| AppError::internal("failed to save auto-sunset policy"))
}

pub async fn list_auto_sunset_decisions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
    severity: &str,
) -> Result<Vec<AutoSunsetDecisionResponse>, AppError> {
    if !status.is_empty() && !matches!(status, "suggested" | "applied" | "skipped") {
        return Err(AppError::validation("decision status is invalid"));
    }
    if !severity.is_empty() && !matches!(severity, "medium" | "high" | "critical") {
        return Err(AppError::validation("decision severity is invalid"));
    }
    happy_hours_repository::list_auto_sunset_decisions(db, tenant_id, branch_id, status, severity)
        .await
        .map(|rows| {
            rows.into_iter()
                .map(auto_sunset_decision_response)
                .collect()
        })
        .map_err(|_| AppError::internal("failed to load auto-sunset decisions"))
}

pub async fn scan_auto_sunset(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    apply: bool,
    source: &str,
) -> Result<AutoSunsetScanResponse, AppError> {
    let policy = get_auto_sunset_policy(db, tenant_id, branch_id).await?;
    if policy.status == "paused" {
        return Ok(AutoSunsetScanResponse {
            policy,
            decisions: Vec::new(),
            applied: Vec::new(),
        });
    }
    let offers = happy_hours_repository::list_auto_sunset_offers(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to scan auto-sunset offers"))?;
    let candidates = auto_sunset_candidates(&policy, &offers, Utc::now());
    let mut decisions = Vec::with_capacity(candidates.len());
    let mut applied = Vec::new();
    for candidate in candidates {
        let signature = format!(
            "{}:{}:{}",
            candidate.action, candidate.offer_type, candidate.offer_id
        );
        let row = happy_hours_repository::upsert_auto_sunset_decision(
            db,
            tenant_id,
            branch_id,
            NewAutoSunsetDecision {
                signature: &signature,
                offer_type: &candidate.offer_type,
                offer_id: &candidate.offer_id,
                offer_name: &candidate.offer_name,
                action: candidate.action,
                reason: &candidate.reason,
                severity: candidate.severity,
                evidence_json: &candidate.evidence,
                source,
            },
        )
        .await
        .map_err(|_| AppError::internal("failed to save auto-sunset decision"))?;
        let should_apply =
            apply && row.status == "suggested" && auto_sunset_should_apply(&policy, &row.action);
        let decision_id = row.id.clone();
        decisions.push(auto_sunset_decision_response(row));
        if should_apply {
            if let Some(row) = happy_hours_repository::apply_auto_sunset_decision(
                db,
                tenant_id,
                branch_id,
                &decision_id,
            )
            .await
            .map_err(|_| AppError::internal("failed to apply auto-sunset decision"))?
            {
                applied.push(auto_sunset_decision_response(row));
            }
        }
    }
    Ok(AutoSunsetScanResponse {
        policy,
        decisions,
        applied,
    })
}

pub async fn apply_auto_sunset_decision(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<AutoSunsetDecisionResponse, AppError> {
    happy_hours_repository::apply_auto_sunset_decision(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to apply auto-sunset decision"))?
        .map(auto_sunset_decision_response)
        .ok_or_else(|| AppError::not_found("auto-sunset decision was not found"))
}

pub async fn run_auto_sunset_worker(db: &PgPool) -> Result<usize, AppError> {
    let scopes = happy_hours_repository::list_auto_sunset_scopes(db)
        .await
        .map_err(|_| AppError::internal("failed to load auto-sunset scopes"))?;
    let mut completed = 0;
    for scope in scopes {
        if scan_auto_sunset(db, &scope.tenant_id, &scope.branch_id, true, "job")
            .await
            .is_ok()
        {
            completed += 1;
        }
    }
    Ok(completed)
}

pub async fn branch_leaderboard(
    db: &PgPool,
    tenant_id: &str,
    current_branch_id: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    sort: &str,
    limit: usize,
) -> Result<Vec<BranchLeaderboardRow>, AppError> {
    if from.zip(to).is_some_and(|(from, to)| to < from) {
        return Err(AppError::validation(
            "to date must be on or after from date",
        ));
    }
    if !matches!(sort, "score" | "revenue" | "efficiency" | "repeat") {
        return Err(AppError::validation("leaderboard sort is invalid"));
    }
    let source = happy_hours_repository::branch_offer_performance(
        db,
        tenant_id,
        current_branch_id,
        from,
        to,
    )
    .await
    .map_err(|_| AppError::internal("failed to load branch offer leaderboard"))?;
    let top_revenue = source
        .iter()
        .map(|row| row.sales_value_paise)
        .max()
        .unwrap_or(0);
    let mut rows = source
        .into_iter()
        .map(|row| branch_leaderboard_row(row, top_revenue))
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| match sort {
        "revenue" => right.sales_value_paise.cmp(&left.sales_value_paise),
        "efficiency" => right
            .return_on_discount_bps
            .cmp(&left.return_on_discount_bps),
        "repeat" => right.repeat_rate_bps.cmp(&left.repeat_rate_bps),
        _ => right.leaderboard_score.cmp(&left.leaderboard_score),
    });
    rows.truncate(limit.clamp(1, 200));
    for (index, row) in rows.iter_mut().enumerate() {
        row.rank = index + 1;
    }
    Ok(rows)
}

fn branch_leaderboard_row(
    row: BranchOfferPerformanceRecord,
    top_revenue_paise: i64,
) -> BranchLeaderboardRow {
    let net_discount_paise = (row.discount_paise - row.reversed_discount_paise).max(0);
    let return_on_discount_bps = ratio_bps(row.sales_value_paise, net_discount_paise);
    let repeat_rate_bps = ratio_bps(row.repeat_clients, row.unique_clients).clamp(0, 10_000);
    let reversal_rate_bps =
        ratio_bps(row.reversed_discount_paise, row.discount_paise).clamp(0, 10_000);
    let leaderboard_score = branch_leaderboard_score(
        row.applications,
        row.sales_value_paise,
        top_revenue_paise,
        return_on_discount_bps,
        repeat_rate_bps,
        reversal_rate_bps,
    );
    let leaderboard_grade = branch_leaderboard_grade(leaderboard_score, row.applications);
    let recommendation = match leaderboard_grade {
        "excellent" => "Scale proven offers carefully.",
        "good" => "Reuse winning offer patterns.",
        "watch" => "Tune timing or targeting before more budget.",
        "poor" => "Review weak offers before scaling.",
        _ => "Collect applied-offer outcomes before comparing.",
    };
    BranchLeaderboardRow {
        rank: 0,
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        active_offers: row.active_rules + row.active_coupons,
        applications: row.applications,
        unique_clients: row.unique_clients,
        repeat_clients: row.repeat_clients,
        sales_value_paise: row.sales_value_paise,
        net_discount_paise,
        return_on_discount_bps,
        repeat_rate_bps,
        reversal_rate_bps,
        leaderboard_score,
        leaderboard_grade,
        recommendation,
    }
}

fn branch_leaderboard_score(
    applications: i64,
    revenue_paise: i64,
    top_revenue_paise: i64,
    return_on_discount_bps: i64,
    repeat_rate_bps: i64,
    reversal_rate_bps: i64,
) -> i32 {
    if applications <= 0 {
        return 0;
    }
    let revenue = ratio_bps(revenue_paise, top_revenue_paise).clamp(0, 10_000) * 40 / 10_000;
    let efficiency = return_on_discount_bps.clamp(0, 40_000) * 30 / 40_000;
    let repeat = repeat_rate_bps.clamp(0, 2_500) * 15 / 2_500;
    let quality = 15 - reversal_rate_bps.clamp(0, 10_000) * 15 / 10_000;
    (revenue + efficiency + repeat + quality).clamp(0, 100) as i32
}

fn branch_leaderboard_grade(score: i32, applications: i64) -> &'static str {
    if applications <= 0 {
        "no_data"
    } else if score >= 80 {
        "excellent"
    } else if score >= 60 {
        "good"
    } else if score >= 40 {
        "watch"
    } else {
        "poor"
    }
}

pub async fn client_return_tracker(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    return_window_days: i32,
    status: &str,
    offer_type: &str,
    limit: usize,
) -> Result<ClientReturnTrackerResponse, AppError> {
    if from.zip(to).is_some_and(|(from, to)| to < from) {
        return Err(AppError::validation(
            "to date must be on or after from date",
        ));
    }
    if !matches!(
        status,
        "" | "returned" | "pending" | "at_risk" | "unknown_client"
    ) {
        return Err(AppError::validation("client return status is invalid"));
    }
    if !matches!(offer_type, "" | "rule" | "coupon") {
        return Err(AppError::validation("client return offer type is invalid"));
    }
    let window = return_window_days.clamp(1, 180);
    let source = happy_hours_repository::client_returns(db, tenant_id, branch_id, from, to, window)
        .await
        .map_err(|_| AppError::internal("failed to load Happy Hours client returns"))?;
    Ok(build_client_return_tracker(
        source,
        Utc::now(),
        window,
        status,
        offer_type,
        limit.clamp(1, 500),
    ))
}

fn build_client_return_tracker(
    source: Vec<ClientReturnRecord>,
    now: DateTime<Utc>,
    return_window_days: i32,
    status_filter: &str,
    offer_type_filter: &str,
    limit: usize,
) -> ClientReturnTrackerResponse {
    let mut clients = source
        .into_iter()
        .map(|row| client_return_row(row, now, return_window_days))
        .filter(|row| status_filter.is_empty() || row.status == status_filter)
        .filter(|row| offer_type_filter.is_empty() || row.offer_type == offer_type_filter)
        .collect::<Vec<_>>();
    clients.sort_by(|left, right| {
        client_return_priority(left.status)
            .cmp(&client_return_priority(right.status))
            .then_with(|| right.used_at.cmp(&left.used_at))
    });

    let offer_uses = clients.len();
    let returned_count = clients
        .iter()
        .filter(|row| row.status == "returned")
        .count();
    let pending_count = clients.iter().filter(|row| row.status == "pending").count();
    let at_risk_count = clients.iter().filter(|row| row.status == "at_risk").count();
    let unique_clients = clients
        .iter()
        .filter(|row| !row.client_id.is_empty())
        .map(|row| row.client_id.as_str())
        .collect::<HashSet<_>>();
    let returned_clients = clients
        .iter()
        .filter(|row| row.status == "returned" && !row.client_id.is_empty())
        .map(|row| row.client_id.as_str())
        .collect::<HashSet<_>>();
    let returned_days = clients
        .iter()
        .filter_map(|row| row.days_to_return)
        .sum::<i64>();
    let summary = ClientReturnSummary {
        offer_uses,
        returned_count,
        pending_count,
        at_risk_count,
        unique_clients: unique_clients.len(),
        returned_clients: returned_clients.len(),
        return_rate_bps: ratio_bps(returned_count as i64, offer_uses as i64),
        average_days_to_return: if returned_count == 0 {
            0
        } else {
            returned_days / returned_count as i64
        },
        discount_paise: clients.iter().map(|row| row.discount_paise).sum(),
        return_revenue_paise: clients.iter().map(|row| row.return_amount_paise).sum(),
    };

    let mut by_offer = HashMap::<String, OfferReturnRow>::new();
    for row in &clients {
        let key = format!("{}:{}", row.offer_type, row.offer_id);
        let offer = by_offer.entry(key).or_insert_with(|| OfferReturnRow {
            offer_type: row.offer_type.clone(),
            offer_id: row.offer_id.clone(),
            offer_title: row.offer_title.clone(),
            offer_uses: 0,
            returned_count: 0,
            at_risk_count: 0,
            return_rate_bps: 0,
            return_revenue_paise: 0,
        });
        offer.offer_uses += 1;
        offer.returned_count += usize::from(row.status == "returned");
        offer.at_risk_count += usize::from(row.status == "at_risk");
        offer.return_revenue_paise += row.return_amount_paise;
    }
    let mut offers = by_offer.into_values().collect::<Vec<_>>();
    for offer in &mut offers {
        offer.return_rate_bps = ratio_bps(offer.returned_count as i64, offer.offer_uses as i64);
    }
    offers.sort_by(|left, right| {
        right
            .return_rate_bps
            .cmp(&left.return_rate_bps)
            .then_with(|| right.return_revenue_paise.cmp(&left.return_revenue_paise))
    });
    clients.truncate(limit);
    ClientReturnTrackerResponse {
        summary,
        clients,
        offers,
    }
}

fn client_return_row(
    row: ClientReturnRecord,
    now: DateTime<Utc>,
    return_window_days: i32,
) -> ClientReturnRow {
    let status = if row.client_id.is_empty() {
        "unknown_client"
    } else if row.return_at.is_some() {
        "returned"
    } else if now > row.used_at + Duration::days(i64::from(return_window_days)) {
        "at_risk"
    } else {
        "pending"
    };
    let days_to_return = row
        .return_at
        .map(|returned| ((returned - row.used_at).num_seconds().max(0) + 86_399) / 86_400);
    let recommendation = match status {
        "returned" => "Returned",
        "pending" => "Wait for return window",
        "at_risk" => "Follow up",
        _ => "Capture client",
    };
    ClientReturnRow {
        source_id: row.source_id,
        offer_type: row.offer_type,
        offer_id: row.offer_id,
        offer_title: row.offer_title,
        client_id: row.client_id,
        client_name: row.client_name,
        used_at: row.used_at,
        amount_paise: row.amount_paise,
        discount_paise: row.discount_paise,
        status,
        return_at: row.return_at,
        return_amount_paise: row.return_amount_paise,
        days_to_return,
        recommendation,
    }
}

fn client_return_priority(status: &str) -> u8 {
    match status {
        "at_risk" => 0,
        "pending" => 1,
        "returned" => 2,
        _ => 3,
    }
}

pub async fn elasticity_pricing(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    day_of_week: Option<i32>,
    hour_slot: Option<i32>,
    service_id: Option<&str>,
) -> Result<ElasticityPricingResponse, AppError> {
    if day_of_week.is_some_and(|value| !(0..=6).contains(&value)) {
        return Err(AppError::validation("dayOfWeek must be 0 to 6"));
    }
    if hour_slot.is_some_and(|value| !(0..=23).contains(&value)) {
        return Err(AppError::validation("hourSlot must be 0 to 23"));
    }
    let today = Utc::now()
        .with_timezone(&FixedOffset::east_opt(19_800).expect("IST offset is valid"))
        .date_naive();
    let from_date = from.unwrap_or(today - Duration::days(89));
    let to_date = to.unwrap_or(today);
    if from_date > to_date || (to_date - from_date).num_days() > 366 {
        return Err(AppError::validation(
            "elasticity date range must be 367 days or less",
        ));
    }
    let rows = happy_hours_repository::elasticity_bands(
        db,
        tenant_id,
        branch_id,
        from_date,
        to_date,
        day_of_week,
        hour_slot,
        service_id.filter(|value| !value.is_empty()),
    )
    .await
    .map_err(|_| AppError::internal("failed to load Happy Hours elasticity pricing"))?;
    Ok(build_elasticity_pricing(rows, from_date, to_date))
}

fn build_elasticity_pricing(
    rows: Vec<ElasticityBandRecord>,
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> ElasticityPricingResponse {
    let mut grouped = HashMap::<String, Vec<ElasticityBandRecord>>::new();
    for row in rows {
        grouped.entry(row.service_id.clone()).or_default().push(row);
    }
    let service_count = grouped.len();
    let mut ready_service_count = 0;
    let mut output = Vec::new();
    for mut bands in grouped.into_values() {
        bands.sort_by_key(|row| row.discount_bps);
        let has_baseline = bands.iter().any(|row| row.discount_bps == 0);
        let baseline = bands
            .iter()
            .find(|row| row.discount_bps == 0)
            .unwrap_or(&bands[0]);
        let baseline_discount_bps = baseline.discount_bps;
        let baseline_units_per_slot = units_per_slot(baseline.units, baseline.slot_count);
        let mut candidates = bands
            .into_iter()
            .map(|row| elasticity_pricing_row(row, baseline_discount_bps, baseline_units_per_slot))
            .collect::<Vec<_>>();
        let winner = (has_baseline && candidates.len() >= 2)
            .then(|| {
                candidates
                    .iter()
                    .enumerate()
                    .filter(|(_, row)| row.margin_safe)
                    .max_by(|(_, left), (_, right)| {
                        left.profit_per_slot_paise
                            .cmp(&right.profit_per_slot_paise)
                            .then_with(|| right.discount_bps.cmp(&left.discount_bps))
                    })
                    .map(|(index, _)| index)
            })
            .flatten();
        if let Some(index) = winner {
            candidates[index].recommended = true;
            ready_service_count += 1;
        }
        output.extend(candidates);
    }
    output.sort_by(|left, right| {
        left.service_name
            .cmp(&right.service_name)
            .then_with(|| left.discount_bps.cmp(&right.discount_bps))
    });
    ElasticityPricingResponse {
        status: if ready_service_count > 0 {
            "ready"
        } else {
            "collecting"
        },
        from_date,
        to_date,
        service_count,
        ready_service_count,
        band_count: output.len(),
        rows: output,
        source: "finalized POS service lines, Happy Hour locks, inventory ledger and staff commission snapshots",
    }
}

fn elasticity_pricing_row(
    row: ElasticityBandRecord,
    baseline_discount_bps: i64,
    baseline_units_per_slot: f64,
) -> ElasticityPricingRow {
    let average_units_per_slot = units_per_slot(row.units, row.slot_count);
    let demand_lift_bps = if baseline_units_per_slot > 0.0 {
        (((average_units_per_slot - baseline_units_per_slot) / baseline_units_per_slot) * 10_000.0)
            .round() as i64
    } else {
        0
    };
    let discount_delta = (row.discount_bps - baseline_discount_bps).abs();
    let elasticity = if discount_delta == 0 {
        0.0
    } else {
        (demand_lift_bps as f64 / discount_delta as f64 * 100.0).round() / 100.0
    };
    let net_profit_paise = row
        .revenue_paise
        .saturating_sub(row.product_cost_paise)
        .saturating_sub(row.staff_cost_paise);
    let margin_bps = ratio_bps(net_profit_paise, row.revenue_paise);
    ElasticityPricingRow {
        service_id: row.service_id,
        service_name: row.service_name,
        discount_bps: row.discount_bps,
        sample_count: row.sample_count,
        average_units_per_slot,
        demand_lift_bps,
        elasticity,
        revenue_paise: row.revenue_paise,
        discount_paise: row.discount_paise,
        product_cost_paise: row.product_cost_paise,
        staff_cost_paise: row.staff_cost_paise,
        net_profit_paise,
        profit_per_slot_paise: net_profit_paise / row.slot_count.max(1),
        margin_bps,
        minimum_margin_bps: row.minimum_margin_bps,
        margin_safe: net_profit_paise >= 0 && margin_bps >= row.minimum_margin_bps,
        recommended: false,
    }
}

fn units_per_slot(units: i64, slots: i64) -> f64 {
    if slots <= 0 {
        0.0
    } else {
        ((units as f64 / slots as f64) * 100.0).round() / 100.0
    }
}

pub async fn rule_conflicts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    active_only: bool,
) -> Result<RuleConflictResponse, AppError> {
    let rules = happy_hours_repository::rule_analysis_rows(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to analyze Happy Hour rules"))?
        .into_iter()
        .filter(|rule| !active_only || rule.active)
        .collect::<Vec<_>>();
    Ok(build_rule_conflicts(&rules))
}

pub async fn simulate_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: HappyHourSimulationRequest,
) -> Result<HappyHourSimulationResponse, AppError> {
    if !(0..=6).contains(&input.weekday) || !(1..=1_000).contains(&input.quantity) {
        return Err(AppError::validation(
            "weekday must be 0 to 6 and quantity must be 1 to 1000",
        ));
    }
    let service_id = input.service_id.trim();
    if service_id.is_empty() {
        return Err(AppError::validation("serviceId is required"));
    }
    let service = happy_hours_repository::simulation_service(db, tenant_id, branch_id, service_id)
        .await
        .map_err(|_| AppError::internal("failed to load simulation service"))?
        .ok_or_else(|| AppError::not_found("active service was not found"))?;
    let rules = happy_hours_repository::rule_analysis_rows(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load simulation rules"))?;
    let rule = rules.into_iter().find(|rule| {
        rule.active
            && rule.weekdays.contains(&input.weekday)
            && time_matches(input.time, rule.start_time, rule.end_time)
    });
    let Some(rule) = rule else {
        return Ok(simulation_result(
            &service,
            input.quantity,
            None,
            "not_applicable",
            "No active rule matches the selected day and time",
            0,
            None,
        ));
    };
    if !rule.eligible_client_categories.is_empty() {
        let client_id = input.client_id.as_deref().unwrap_or("").trim();
        if client_id.is_empty() {
            return Ok(simulation_result(
                &service,
                input.quantity,
                Some(&rule),
                "not_applicable",
                "The winning rule requires a client category",
                0,
                None,
            ));
        }
        let categories =
            happy_hours_repository::client_categories(db, tenant_id, branch_id, client_id)
                .await
                .map_err(|_| AppError::internal("failed to load simulation client categories"))?
                .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
                .unwrap_or_default();
        if !set_overlaps(&rule.eligible_client_categories, &categories) {
            return Ok(simulation_result(
                &service,
                input.quantity,
                Some(&rule),
                "not_applicable",
                "The winning rule does not match this client",
                0,
                None,
            ));
        }
    }
    if !wildcard_contains(&rule.eligible_line_types, "service")
        || !wildcard_contains(&rule.eligible_item_ids, service_id)
    {
        return Ok(simulation_result(
            &service,
            input.quantity,
            Some(&rule),
            "not_applicable",
            "The winning rule does not include this service",
            0,
            None,
        ));
    }
    let gross = service.price_paise.saturating_mul(input.quantity);
    let discount = gross.saturating_mul(i64::from(rule.discount_bps)) / 10_000;
    let payable = gross.saturating_sub(discount);
    let cost = (service.known_products > 0 && service.unit_cost_paise > 0)
        .then_some(service.unit_cost_paise.saturating_mul(input.quantity));
    if rule.min_margin_bps > 0 {
        if cost.is_none() && rule.block_on_unknown_cost {
            return Ok(simulation_result(
                &service,
                input.quantity,
                Some(&rule),
                "blocked",
                "Real service cost is required by the rule",
                discount,
                None,
            ));
        }
        if let Some(cost_paise) = cost {
            let margin_bps = ratio_bps(payable.saturating_sub(cost_paise), payable);
            if payable <= 0 || margin_bps < i64::from(rule.min_margin_bps) {
                return Ok(simulation_result(
                    &service,
                    input.quantity,
                    Some(&rule),
                    "blocked",
                    "The simulated discount breaches the minimum margin",
                    discount,
                    Some(cost_paise),
                ));
            }
        }
    }
    Ok(simulation_result(
        &service,
        input.quantity,
        Some(&rule),
        "applied",
        "Rule is eligible and margin-safe",
        discount,
        cost,
    ))
}

pub async fn list_approvals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<HappyHourApprovalRecord>, AppError> {
    if !matches!(
        status,
        "" | "pending" | "approved" | "rejected" | "superseded"
    ) {
        return Err(AppError::validation("approval status is invalid"));
    }
    happy_hours_repository::list_approvals(db, tenant_id, branch_id, status)
        .await
        .map_err(|_| AppError::internal("failed to load Happy Hour approvals"))
}

pub async fn request_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    role: &str,
    input: ApprovalRequest,
) -> Result<HappyHourApprovalRecord, AppError> {
    let rule_id = input.rule_id.trim();
    let note = clean_note(input.note.as_deref());
    let rule = happy_hours_repository::rule_analysis_rows(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load approval rule"))?
        .into_iter()
        .find(|row| row.id == rule_id)
        .ok_or_else(|| AppError::not_found("Happy Hour rule was not found"))?;
    if rule.active {
        return Err(AppError::conflict(
            "active rule does not require activation approval",
        ));
    }
    let approval_limit_bps = role_discount_limit_bps(role);
    let approval = happy_hours_repository::create_approval(
        db,
        tenant_id,
        branch_id,
        rule_id,
        actor,
        role,
        approval_limit_bps,
        &note,
    )
    .await
    .map_err(|_| AppError::internal("failed to request Happy Hour approval"))?
    .ok_or_else(|| AppError::not_found("Happy Hour rule was not found"))?;
    security_service::record_audit(
        db,
        tenant_id,
        branch_id,
        actor,
        "happy_hours.approval.requested",
        serde_json::json!({"approvalId":approval.id,"ruleId":approval.rule_id,"discountBps":approval.requested_discount_bps}),
    )
    .await?;
    Ok(approval)
}

pub async fn decide_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    role: &str,
    id: &str,
    input: ApprovalDecisionRequest,
) -> Result<HappyHourApprovalRecord, AppError> {
    let decision = input.decision.trim().to_ascii_lowercase();
    if !matches!(decision.as_str(), "approved" | "rejected") {
        return Err(AppError::validation(
            "decision must be approved or rejected",
        ));
    }
    let current = list_approvals(db, tenant_id, branch_id, "")
        .await?
        .into_iter()
        .find(|row| row.id == id)
        .ok_or_else(|| AppError::not_found("Happy Hour approval was not found"))?;
    if current.status != "pending" {
        return Err(AppError::conflict("approval has already been reviewed"));
    }
    if current.requested_by == actor {
        return Err(AppError::forbidden(
            "requester cannot approve their own discount",
        ));
    }
    if role_discount_limit_bps(role) < current.requested_discount_bps {
        return Err(AppError::forbidden(
            "approver discount limit is below the requested discount",
        ));
    }
    let approval = happy_hours_repository::decide_approval(
        db,
        tenant_id,
        branch_id,
        id,
        actor,
        &decision,
        &clean_note(input.note.as_deref()),
    )
    .await
    .map_err(|_| AppError::internal("failed to review Happy Hour approval"))?
    .ok_or_else(|| AppError::conflict("approval could not be reviewed"))?;
    security_service::record_audit(
        db,
        tenant_id,
        branch_id,
        actor,
        &format!("happy_hours.approval.{decision}"),
        serde_json::json!({"approvalId":approval.id,"ruleId":approval.rule_id}),
    )
    .await?;
    Ok(approval)
}

pub async fn list_discount_approvals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<DiscountApprovalRecord>, AppError> {
    if !matches!(
        status,
        "" | "pending" | "approved" | "rejected" | "expired" | "superseded"
    ) {
        return Err(AppError::validation("discount approval status is invalid"));
    }
    happy_hours_repository::expire_discount_approvals(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to expire discount approvals"))?;
    happy_hours_repository::list_discount_approvals(db, tenant_id, branch_id, status)
        .await
        .map_err(|_| AppError::internal("failed to load discount approvals"))
}

pub async fn request_discount_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    role: &str,
    input: DiscountApprovalRequest,
) -> Result<DiscountApprovalRecord, AppError> {
    let invoice_id = input.invoice_id.trim();
    if invoice_id.is_empty() {
        return Err(AppError::validation("invoiceId is required"));
    }
    let invoice =
        happy_hours_repository::discount_approval_invoice(db, tenant_id, branch_id, invoice_id)
            .await
            .map_err(|_| AppError::internal("failed to load discount invoice"))?
            .ok_or_else(|| AppError::not_found("invoice was not found"))?;
    if invoice.finalized_at.is_some() {
        return Err(AppError::conflict(
            "finalized invoice cannot receive a new discount approval",
        ));
    }
    if invoice.discount_paise <= 0 {
        return Err(AppError::validation("invoice has no discount to approve"));
    }
    let reason = clean_note(input.reason.as_deref());
    let reason = if reason.is_empty() {
        "Approval required"
    } else {
        reason.as_str()
    };
    let approval = happy_hours_repository::create_discount_approval(
        db, tenant_id, branch_id, invoice_id, actor, role, reason,
    )
    .await
    .map_err(|_| AppError::internal("failed to request discount approval"))?
    .ok_or_else(|| AppError::conflict("discount approval could not be created"))?;
    security_service::record_audit(
        db,
        tenant_id,
        branch_id,
        actor,
        "happy_hours.discount_approval.requested",
        serde_json::json!({"approvalId":approval.id,"invoiceId":approval.sale_id,"invoiceNumber":invoice.invoice_number,"discountPaise":approval.discount_amount_paise}),
    )
    .await?;
    Ok(approval)
}

pub async fn decide_discount_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    role: &str,
    id: &str,
    input: ApprovalDecisionRequest,
) -> Result<DiscountApprovalRecord, AppError> {
    if !matches!(role, "owner" | "admin" | "manager") {
        return Err(AppError::forbidden("manager approval is required"));
    }
    let decision = input.decision.trim().to_ascii_lowercase();
    if !matches!(decision.as_str(), "approved" | "rejected") {
        return Err(AppError::validation(
            "decision must be approved or rejected",
        ));
    }
    let current = list_discount_approvals(db, tenant_id, branch_id, "")
        .await?
        .into_iter()
        .find(|row| row.id == id)
        .ok_or_else(|| AppError::not_found("discount approval was not found"))?;
    if current.status != "pending" {
        return Err(AppError::conflict("discount approval is no longer pending"));
    }
    if current.requested_by == actor {
        return Err(AppError::forbidden(
            "requester cannot approve their own discount",
        ));
    }
    let approval = happy_hours_repository::decide_discount_approval(
        db,
        tenant_id,
        branch_id,
        id,
        actor,
        &decision,
        &clean_note(input.note.as_deref()),
    )
    .await
    .map_err(|_| AppError::internal("failed to review discount approval"))?
    .ok_or_else(|| AppError::conflict("discount approval could not be reviewed"))?;
    security_service::record_audit(
        db,
        tenant_id,
        branch_id,
        actor,
        &format!("happy_hours.discount_approval.{decision}"),
        serde_json::json!({"approvalId":approval.id,"invoiceId":approval.sale_id,"discountPaise":approval.discount_amount_paise}),
    )
    .await?;
    Ok(approval)
}

pub async fn ensure_discount_approval_for_finalize(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<(), AppError> {
    happy_hours_repository::expire_discount_approvals(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to verify discount approval"))?;
    let Some(gate) =
        happy_hours_repository::discount_approval_gate(db, tenant_id, branch_id, sale_id)
            .await
            .map_err(|_| AppError::internal("failed to verify discount approval"))?
    else {
        return Ok(());
    };
    if gate.status == "approved" {
        return Ok(());
    }
    Err(AppError::conflict(match gate.status.as_str() {
        "pending" => "discount approval is pending",
        "rejected" => "discount approval was rejected",
        "expired" => "discount approval expired",
        _ => "a new discount approval is required",
    }))
}

pub async fn list_coupon_abuse_alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<CouponAbuseAlertRecord>, AppError> {
    if !matches!(status, "" | "open" | "resolved") {
        return Err(AppError::validation("coupon abuse status is invalid"));
    }
    happy_hours_repository::list_coupon_abuse_alerts(db, tenant_id, branch_id, status)
        .await
        .map_err(|_| AppError::internal("failed to load coupon abuse alerts"))
}

pub async fn scan_coupon_abuse(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
) -> Result<CouponAbuseScanResponse, AppError> {
    let candidates = happy_hours_repository::coupon_abuse_candidates(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to scan coupon usage"))?;
    for candidate in &candidates {
        happy_hours_repository::upsert_coupon_abuse_alert(db, tenant_id, branch_id, candidate)
            .await
            .map_err(|_| AppError::internal("failed to persist coupon abuse alert"))?;
        persist_coupon_fraud_case(db, tenant_id, branch_id, candidate).await?;
    }
    security_service::record_audit(
        db,
        tenant_id,
        branch_id,
        actor,
        "happy_hours.coupon_abuse.scanned",
        serde_json::json!({"detected":candidates.len()}),
    )
    .await?;
    Ok(CouponAbuseScanResponse {
        detected: candidates.len(),
        alerts: list_coupon_abuse_alerts(db, tenant_id, branch_id, "open").await?,
    })
}

pub async fn scan_coupon_abuse_for_sale(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<bool, AppError> {
    let candidate =
        happy_hours_repository::coupon_abuse_candidate_for_sale(db, tenant_id, branch_id, sale_id)
            .await
            .map_err(|_| AppError::internal("failed to scan coupon usage"))?;
    let Some(candidate) = candidate else {
        return Ok(false);
    };
    happy_hours_repository::upsert_coupon_abuse_alert(db, tenant_id, branch_id, &candidate)
        .await
        .map_err(|_| AppError::internal("failed to persist coupon abuse alert"))?;
    persist_coupon_fraud_case(db, tenant_id, branch_id, &candidate).await?;
    Ok(true)
}

async fn persist_coupon_fraud_case(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    candidate: &CouponAbuseCandidate,
) -> Result<FraudCaseRecord, AppError> {
    let score = (45
        + candidate.usage_count.saturating_mul(10)
        + if candidate.total_discount_paise >= 10_000 {
            10
        } else {
            0
        })
    .clamp(0, 100) as i32;
    let (severity, decision) = fraud_outcome(score);
    let subject_id = format!("{}:{}", candidate.client_id, candidate.coupon_code);
    let signature = format!("coupon_reuse:{subject_id}");
    let evidence = serde_json::json!({
        "clientId": candidate.client_id,
        "couponCode": candidate.coupon_code,
        "usageCount": candidate.usage_count,
        "totalDiscountPaise": candidate.total_discount_paise,
        "latestSaleId": candidate.latest_sale_id,
    });
    happy_hours_repository::upsert_fraud_case(
        db,
        tenant_id,
        branch_id,
        NewFraudCase {
            signature: &signature,
            fraud_type: "coupon_reuse",
            subject_type: "client_coupon",
            subject_id: &subject_id,
            risk_score: score,
            severity,
            decision,
            title: "Repeated coupon usage",
            description: "Observed finalized sales require coupon usage review",
            evidence: &evidence,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to persist coupon fraud case"))
}

pub async fn resolve_coupon_abuse_alert(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    id: &str,
    input: CouponAbuseResolutionRequest,
) -> Result<CouponAbuseAlertRecord, AppError> {
    let alert = happy_hours_repository::resolve_coupon_abuse_alert(
        db,
        tenant_id,
        branch_id,
        id,
        actor,
        &clean_note(input.note.as_deref()),
    )
    .await
    .map_err(|_| AppError::internal("failed to resolve coupon abuse alert"))?
    .ok_or_else(|| AppError::not_found("coupon abuse alert was not found"))?;
    security_service::record_audit(
        db,
        tenant_id,
        branch_id,
        actor,
        "happy_hours.coupon_abuse.resolved",
        serde_json::json!({"alertId":alert.id,"clientId":alert.client_id,"couponCode":alert.coupon_code}),
    )
    .await?;
    Ok(alert)
}

pub async fn current_budget(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<BudgetResponse>, AppError> {
    let today = (Utc::now() + Duration::minutes(330)).date_naive();
    Ok(
        happy_hours_repository::current_budget(db, tenant_id, branch_id, today)
            .await
            .map_err(|_| AppError::internal("failed to load Happy Hour budget"))?
            .map(budget_response),
    )
}

pub async fn save_budget(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    input: BudgetWriteRequest,
) -> Result<BudgetResponse, AppError> {
    if input.period_end < input.period_start
        || input.budget_paise < 0
        || !(1..=10_000).contains(&input.alert_threshold_bps)
        || !(1..=10_000).contains(&input.approval_above_bps)
        || (input.period_end - input.period_start).num_days() > 366
    {
        return Err(AppError::validation("Happy Hour budget values are invalid"));
    }
    let budget = happy_hours_repository::upsert_budget(
        db,
        tenant_id,
        branch_id,
        input.period_start,
        input.period_end,
        input.budget_paise,
        input.alert_threshold_bps,
        input.approval_above_bps,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save Happy Hour budget"))?;
    security_service::record_audit(
        db,
        tenant_id,
        branch_id,
        actor,
        "happy_hours.budget.updated",
        serde_json::json!({"budgetId":budget.id,"periodStart":budget.period_start,"periodEnd":budget.period_end,"budgetPaise":budget.budget_paise}),
    )
    .await?;
    Ok(budget_response(budget))
}

pub async fn rule_approval_assessment(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    role: &str,
    discount_bps: i32,
) -> Result<RuleApprovalAssessment, AppError> {
    let role_limit_bps = role_discount_limit_bps(role);
    let policy_limit_bps = current_budget(db, tenant_id, branch_id)
        .await?
        .map(|budget| budget.approval_above_bps);
    Ok(RuleApprovalAssessment {
        required: discount_bps > role_limit_bps
            || policy_limit_bps.is_some_and(|limit| discount_bps > limit),
        role_limit_bps,
        policy_limit_bps,
    })
}

pub async fn list_anomalies(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<HappyHourAnomalyRecord>, AppError> {
    if !matches!(status, "" | "open" | "reviewed" | "dismissed") {
        return Err(AppError::validation("anomaly status is invalid"));
    }
    happy_hours_repository::list_anomalies(db, tenant_id, branch_id, status)
        .await
        .map_err(|_| AppError::internal("failed to load Happy Hour anomalies"))
}

pub async fn scan_anomalies(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
) -> Result<AnomalyScanResponse, AppError> {
    let rules = happy_hours_repository::rule_analysis_rows(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to scan Happy Hour rules"))?
        .into_iter()
        .filter(|rule| rule.active)
        .collect::<Vec<_>>();
    let mut candidates = build_rule_conflicts(&rules)
        .conflicts
        .into_iter()
        .map(|conflict| AnomalyCandidate {
            signature: format!("rule_conflict:{}:{}", conflict.rule_id, conflict.conflicting_rule_id),
            anomaly_type: "rule_conflict",
            severity: conflict.severity,
            title: format!("{} conflicts with {}", conflict.rule_name, conflict.conflicting_rule_name),
            description: conflict.reasons.join("; "),
            evidence: serde_json::json!({"ruleId":conflict.rule_id,"conflictingRuleId":conflict.conflicting_rule_id,"weekdays":conflict.overlapping_weekdays,"type":conflict.conflict_type}),
        })
        .collect::<Vec<_>>();
    let performance = happy_hours_repository::performance(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to scan Happy Hour outcomes"))?;
    for row in performance {
        let reversal_bps = ratio_bps(row.reversed_discount_paise, row.discount_paise);
        if row.discount_paise > 0 && reversal_bps >= 2_000 {
            candidates.push(AnomalyCandidate {
                signature: format!("discount_reversal:{}", row.rule_id),
                anomaly_type: "discount_reversal",
                severity: if reversal_bps >= 5_000 { "high" } else { "medium" },
                title: format!("High reversal rate: {}", row.name),
                description: format!("{}% of discount value was reversed", reversal_bps / 100),
                evidence: serde_json::json!({"ruleId":row.rule_id,"discountPaise":row.discount_paise,"reversedDiscountPaise":row.reversed_discount_paise,"reversalBps":reversal_bps}),
            });
        }
    }
    let daily_usage = happy_hours_repository::daily_discount_usage(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to scan statistical discount usage"))?;
    if let Some(candidate) = statistical_discount_anomaly(&daily_usage, Utc::now().date_naive()) {
        candidates.push(candidate);
    }
    let bypasses = happy_hours_repository::approval_bypass_candidates(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to scan approval bypasses"))?;
    for row in bypasses {
        let role_limit_bps = role_discount_limit_bps(&row.last_changed_by_role);
        if row.discount_bps > role_limit_bps && !row.has_matching_approval {
            candidates.push(AnomalyCandidate {
                signature: format!("approval_bypass:{}:{}", row.rule_id, row.discount_bps),
                anomaly_type: "approval_bypass",
                severity: "critical",
                title: format!("Approval bypass: {}", row.rule_name),
                description: format!(
                    "{}% discount is active above the {}% role limit without a matching approved snapshot",
                    row.discount_bps / 100,
                    role_limit_bps / 100
                ),
                evidence: serde_json::json!({"ruleId":row.rule_id,"discountBps":row.discount_bps,"role":row.last_changed_by_role,"roleLimitBps":role_limit_bps,"changedBy":row.last_changed_by}),
            });
        }
    }
    if let Some(budget) = current_budget(db, tenant_id, branch_id).await? {
        if budget.threshold_reached {
            candidates.push(AnomalyCandidate {
                signature: format!("budget_threshold:{}", budget.id),
                anomaly_type: "budget_threshold",
                severity: if budget.exceeded { "critical" } else { "high" },
                title: if budget.exceeded { "Happy Hour budget exceeded".into() } else { "Happy Hour budget threshold reached".into() },
                description: format!("{}% of the branch budget is used", budget.used_bps / 100),
                evidence: serde_json::json!({"budgetId":budget.id,"budgetPaise":budget.budget_paise,"spentPaise":budget.spent_paise,"usedBps":budget.used_bps}),
            });
        }
    }
    for candidate in &candidates {
        happy_hours_repository::upsert_anomaly(
            db,
            tenant_id,
            branch_id,
            NewHappyHourAnomaly {
                signature: &candidate.signature,
                anomaly_type: candidate.anomaly_type,
                severity: candidate.severity,
                title: &candidate.title,
                description: &candidate.description,
                evidence: &candidate.evidence,
            },
        )
        .await
        .map_err(|_| AppError::internal("failed to save Happy Hour anomaly"))?;
    }
    security_service::record_audit(
        db,
        tenant_id,
        branch_id,
        actor,
        "happy_hours.anomalies.scanned",
        serde_json::json!({"detected":candidates.len()}),
    )
    .await?;
    Ok(AnomalyScanResponse {
        detected: candidates.len(),
        anomalies: list_anomalies(db, tenant_id, branch_id, "open").await?,
    })
}

pub async fn list_fraud_cases(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<FraudCaseRecord>, AppError> {
    if !matches!(
        status,
        "" | "open" | "investigating" | "resolved" | "dismissed"
    ) {
        return Err(AppError::validation("fraud case status is invalid"));
    }
    happy_hours_repository::list_fraud_cases(db, tenant_id, branch_id, status)
        .await
        .map_err(|_| AppError::internal("failed to load fraud cases"))
}

pub async fn scan_fraud_cases(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
) -> Result<FraudScanResponse, AppError> {
    let coupon_candidates =
        happy_hours_repository::coupon_abuse_candidates(db, tenant_id, branch_id)
            .await
            .map_err(|_| AppError::internal("failed to scan coupon risk"))?;
    let mut cases = Vec::new();
    for candidate in coupon_candidates {
        cases.push(persist_coupon_fraud_case(db, tenant_id, branch_id, &candidate).await?);
    }
    for row in happy_hours_repository::approval_bypass_candidates(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to scan approval bypass risk"))?
    {
        let role_limit_bps = role_discount_limit_bps(&row.last_changed_by_role);
        if row.discount_bps <= role_limit_bps || row.has_matching_approval {
            continue;
        }
        let signature = format!("approval_bypass:{}:{}", row.rule_id, row.discount_bps);
        let evidence = serde_json::json!({"ruleId":row.rule_id,"discountBps":row.discount_bps,"role":row.last_changed_by_role,"roleLimitBps":role_limit_bps,"changedBy":row.last_changed_by});
        cases.push(happy_hours_repository::upsert_fraud_case(db, tenant_id, branch_id, NewFraudCase {
            signature: &signature, fraud_type: "approval_bypass", subject_type: "rule", subject_id: &row.rule_id,
            risk_score: 95, severity: "critical", decision: "block_until_review",
            title: "Rule activation approval bypass", description: "Active rule exceeds the actor role limit without an approved matching snapshot", evidence: &evidence,
        }).await.map_err(|_| AppError::internal("failed to save approval bypass case"))?);
    }
    if let Some(candidate) = statistical_discount_anomaly(
        &happy_hours_repository::daily_discount_usage(db, tenant_id, branch_id)
            .await
            .map_err(|_| AppError::internal("failed to scan statistical fraud risk"))?,
        Utc::now().date_naive(),
    ) {
        let evidence = candidate.evidence;
        cases.push(
            happy_hours_repository::upsert_fraud_case(
                db,
                tenant_id,
                branch_id,
                NewFraudCase {
                    signature: &candidate.signature,
                    fraud_type: "statistical_discount_spike",
                    subject_type: "branch",
                    subject_id: branch_id,
                    risk_score: 70,
                    severity: "high",
                    decision: "manager_review",
                    title: &candidate.title,
                    description: &candidate.description,
                    evidence: &evidence,
                },
            )
            .await
            .map_err(|_| AppError::internal("failed to save statistical fraud case"))?,
        );
    }
    security_service::record_audit(
        db,
        tenant_id,
        branch_id,
        actor,
        "happy_hours.fraud.scanned",
        serde_json::json!({"detected":cases.len()}),
    )
    .await?;
    Ok(FraudScanResponse {
        detected: cases.len(),
        cases: list_fraud_cases(db, tenant_id, branch_id, "open").await?,
    })
}

pub async fn review_fraud_case(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    id: &str,
    input: FraudCaseReviewRequest,
) -> Result<FraudCaseRecord, AppError> {
    let status = input.status.trim().to_ascii_lowercase();
    if !matches!(status.as_str(), "investigating" | "resolved" | "dismissed") {
        return Err(AppError::validation("fraud case status is invalid"));
    }
    let row = happy_hours_repository::review_fraud_case(
        db,
        tenant_id,
        branch_id,
        id,
        &status,
        actor,
        &clean_note(input.note.as_deref()),
    )
    .await
    .map_err(|_| AppError::internal("failed to review fraud case"))?
    .ok_or_else(|| AppError::not_found("fraud case was not found"))?;
    security_service::record_audit(
        db,
        tenant_id,
        branch_id,
        actor,
        "happy_hours.fraud.reviewed",
        serde_json::json!({"caseId":row.id,"status":row.status}),
    )
    .await?;
    Ok(row)
}

pub async fn review_anomaly(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    id: &str,
    input: AnomalyReviewRequest,
) -> Result<HappyHourAnomalyRecord, AppError> {
    let status = input.status.trim().to_ascii_lowercase();
    if !matches!(status.as_str(), "reviewed" | "dismissed") {
        return Err(AppError::validation(
            "anomaly status must be reviewed or dismissed",
        ));
    }
    let anomaly = happy_hours_repository::review_anomaly(
        db,
        tenant_id,
        branch_id,
        id,
        &status,
        actor,
        &clean_note(input.note.as_deref()),
    )
    .await
    .map_err(|_| AppError::internal("failed to review Happy Hour anomaly"))?
    .ok_or_else(|| AppError::not_found("Happy Hour anomaly was not found"))?;
    security_service::record_audit(
        db,
        tenant_id,
        branch_id,
        actor,
        "happy_hours.anomaly.reviewed",
        serde_json::json!({"anomalyId":anomaly.id,"status":anomaly.status}),
    )
    .await?;
    Ok(anomaly)
}

pub async fn audit_log(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<crate::repositories::security_repository::SecurityAuditRecord>, AppError> {
    security_service::list_audit(db, tenant_id, branch_id, "happy_hours.").await
}

fn budget_response(row: HappyHourBudgetRecord) -> BudgetResponse {
    let remaining_paise = row.budget_paise.saturating_sub(row.spent_paise).max(0);
    let used_bps = ratio_bps(row.spent_paise, row.budget_paise);
    BudgetResponse {
        id: row.id,
        period_start: row.period_start,
        period_end: row.period_end,
        budget_paise: row.budget_paise,
        spent_paise: row.spent_paise,
        remaining_paise,
        used_bps,
        alert_threshold_bps: row.alert_threshold_bps,
        approval_above_bps: row.approval_above_bps,
        threshold_reached: used_bps >= i64::from(row.alert_threshold_bps),
        exceeded: row.budget_paise > 0 && row.spent_paise >= row.budget_paise,
        updated_at: row.updated_at,
    }
}

pub fn role_discount_limit_bps(role: &str) -> i32 {
    let normalized = role
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    match normalized.as_str() {
        "cashier" | "receptionist" | "frontdesk" | "staff" => 1_000,
        "manager" | "branchmanager" => 2_500,
        "regionalhead" | "regionalmanager" => 4_000,
        "owner" | "admin" | "superadmin" => 10_000,
        _ => 1_000,
    }
}

fn fraud_outcome(score: i32) -> (&'static str, &'static str) {
    if score >= 85 {
        ("critical", "block_until_review")
    } else if score >= 60 {
        ("high", "manager_review")
    } else if score >= 30 {
        ("medium", "allow")
    } else {
        ("low", "allow")
    }
}

fn statistical_discount_anomaly(
    rows: &[DailyDiscountRecord],
    today: NaiveDate,
) -> Option<AnomalyCandidate> {
    let current = rows.iter().find(|row| row.business_date == today)?;
    let baseline = rows
        .iter()
        .filter(|row| row.business_date < today)
        .map(|row| row.discount_paise as f64)
        .collect::<Vec<_>>();
    if baseline.len() < 7 || current.discount_paise < 10_000 {
        return None;
    }
    let mean = baseline.iter().sum::<f64>() / baseline.len() as f64;
    let variance = baseline
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / baseline.len() as f64;
    let standard_deviation = variance.sqrt();
    let threshold = mean + 3.0 * standard_deviation.max(mean * 0.10);
    if current.discount_paise as f64 <= threshold || current.discount_paise as f64 <= mean * 2.0 {
        return None;
    }
    Some(AnomalyCandidate {
        signature: format!("statistical_discount_spike:{}", today),
        anomaly_type: "statistical_discount_spike",
        severity: "high",
        title: "Statistical discount spike".into(),
        description: "Today's finalized discount value is above the 30-day statistical baseline"
            .into(),
        evidence: serde_json::json!({
            "businessDate": today,
            "saleCount": current.sale_count,
            "discountPaise": current.discount_paise,
            "baselineDays": baseline.len(),
            "meanDiscountPaise": mean.round() as i64,
            "standardDeviationPaise": standard_deviation.round() as i64,
            "thresholdPaise": threshold.round() as i64,
        }),
    })
}

fn clean_note(value: Option<&str>) -> String {
    value.unwrap_or("").trim().chars().take(500).collect()
}

struct AnomalyCandidate {
    signature: String,
    anomaly_type: &'static str,
    severity: &'static str,
    title: String,
    description: String,
    evidence: Value,
}

fn build_rule_conflicts(rules: &[HappyHourRuleAnalysisRecord]) -> RuleConflictResponse {
    let mut conflicts = Vec::new();
    for (index, rule) in rules.iter().enumerate() {
        for other in &rules[index + 1..] {
            let mut weekdays = rule
                .weekdays
                .iter()
                .copied()
                .filter(|day| other.weekdays.contains(day))
                .collect::<Vec<_>>();
            weekdays.sort_unstable();
            weekdays.dedup();
            if weekdays.is_empty()
                || !time_ranges_overlap(
                    rule.start_time,
                    rule.end_time,
                    other.start_time,
                    other.end_time,
                )
                || !wildcard_sets_overlap(&rule.eligible_line_types, &other.eligible_line_types)
                || !wildcard_sets_overlap(&rule.eligible_item_ids, &other.eligible_item_ids)
                || !wildcard_sets_overlap(
                    &rule.eligible_client_categories,
                    &other.eligible_client_categories,
                )
            {
                continue;
            }
            let mut reasons = vec![if rule.discount_bps == other.discount_bps {
                "Equal discounts rely on creation order"
            } else {
                "Discount scopes overlap"
            }];
            if rule.min_margin_bps != other.min_margin_bps
                || rule.block_on_unknown_cost != other.block_on_unknown_cost
            {
                reasons.push("Margin guards differ");
            }
            conflicts.push(RuleConflict {
                rule_id: rule.id.clone(),
                rule_name: rule.name.clone(),
                conflicting_rule_id: other.id.clone(),
                conflicting_rule_name: other.name.clone(),
                severity: if rule.discount_bps == other.discount_bps {
                    "high"
                } else {
                    "medium"
                },
                conflict_type: if rule.discount_bps == other.discount_bps {
                    "precedence_tie"
                } else {
                    "discount_overlap"
                },
                overlapping_weekdays: weekdays,
                reasons,
            });
        }
    }
    RuleConflictResponse {
        summary: RuleConflictSummary {
            rules_checked: rules.len(),
            conflict_count: conflicts.len(),
            high_severity_count: conflicts
                .iter()
                .filter(|row| row.severity == "high")
                .count(),
        },
        conflicts,
    }
}

fn simulation_result(
    service: &HappyHourSimulationServiceRecord,
    quantity: i64,
    rule: Option<&HappyHourRuleAnalysisRecord>,
    status: &'static str,
    reason: &'static str,
    discount_paise: i64,
    cost_paise: Option<i64>,
) -> HappyHourSimulationResponse {
    let gross_paise = service.price_paise.saturating_mul(quantity);
    let payable_paise = gross_paise.saturating_sub(discount_paise);
    HappyHourSimulationResponse {
        status,
        reason,
        rule_id: rule.map(|value| value.id.clone()),
        rule_name: rule.map(|value| value.name.clone()),
        service_id: service.id.clone(),
        service_name: service.name.clone(),
        quantity,
        gross_paise,
        discount_paise,
        payable_paise,
        cost_paise,
        margin_bps: cost_paise
            .map(|cost| ratio_bps(payable_paise.saturating_sub(cost), payable_paise)),
    }
}

fn time_matches(time: NaiveTime, start: NaiveTime, end: NaiveTime) -> bool {
    if start <= end {
        time >= start && time <= end
    } else {
        time >= start || time <= end
    }
}

fn time_ranges_overlap(
    a_start: NaiveTime,
    a_end: NaiveTime,
    b_start: NaiveTime,
    b_end: NaiveTime,
) -> bool {
    split_time_range(a_start, a_end).iter().any(|left| {
        split_time_range(b_start, b_end)
            .iter()
            .any(|right| left.0 <= right.1 && right.0 <= left.1)
    })
}

fn split_time_range(start: NaiveTime, end: NaiveTime) -> Vec<(u32, u32)> {
    let start = start.num_seconds_from_midnight();
    let end = end.num_seconds_from_midnight();
    if start <= end {
        vec![(start, end)]
    } else {
        vec![(start, 86_399), (0, end)]
    }
}

fn wildcard_sets_overlap(left: &[String], right: &[String]) -> bool {
    left.is_empty() || right.is_empty() || set_overlaps(left, right)
}

fn wildcard_contains(values: &[String], target: &str) -> bool {
    values.is_empty()
        || values
            .iter()
            .any(|value| value.eq_ignore_ascii_case(target))
}

fn set_overlaps(left: &[String], right: &[String]) -> bool {
    left.iter()
        .any(|value| right.iter().any(|other| value.eq_ignore_ascii_case(other)))
}

struct AutoSunsetCandidate {
    offer_type: String,
    offer_id: String,
    offer_name: String,
    action: &'static str,
    reason: String,
    severity: &'static str,
    evidence: Value,
}

fn auto_sunset_candidates(
    policy: &AutoSunsetPolicyResponse,
    offers: &[AutoSunsetOfferRecord],
    now: DateTime<Utc>,
) -> Vec<AutoSunsetCandidate> {
    let mut rows = Vec::new();
    for offer in offers {
        let age_days = (now - offer.created_at).num_days().max(0);
        if offer.offer_type == "coupon"
            && policy.expire_past_end_date
            && offer.ends_at.is_some_and(|ends_at| ends_at < now)
        {
            rows.push(AutoSunsetCandidate {
                offer_type: offer.offer_type.clone(),
                offer_id: offer.offer_id.clone(),
                offer_name: offer.offer_name.clone(),
                action: "expire_coupon",
                reason: "Coupon end date has passed.".into(),
                severity: "high",
                evidence: serde_json::json!({ "endsAt": offer.ends_at, "checkedAt": now }),
            });
        }
        if offer.offer_type == "coupon"
            && policy.pause_coupons_at_usage_limit
            && offer
                .usage_limit
                .is_some_and(|limit| limit > 0 && offer.used_count >= limit)
        {
            rows.push(AutoSunsetCandidate {
                offer_type: offer.offer_type.clone(),
                offer_id: offer.offer_id.clone(),
                offer_name: offer.offer_name.clone(),
                action: "pause_coupon",
                reason: "Coupon usage limit has been reached.".into(),
                severity: "critical",
                evidence: serde_json::json!({ "usageLimit": offer.usage_limit, "usedCount": offer.used_count }),
            });
        }
        if offer.ends_at.is_none() && age_days >= i64::from(policy.review_no_end_date_after_days) {
            rows.push(AutoSunsetCandidate {
                offer_type: offer.offer_type.clone(),
                offer_id: offer.offer_id.clone(),
                offer_name: offer.offer_name.clone(),
                action: if offer.offer_type == "rule" {
                    "review_stale_rule"
                } else {
                    "review_stale_coupon"
                },
                reason: format!("Offer has no end date and is {age_days} days old."),
                severity: "medium",
                evidence: serde_json::json!({ "ageDays": age_days, "thresholdDays": policy.review_no_end_date_after_days }),
            });
        }
    }
    rows
}

fn auto_sunset_should_apply(policy: &AutoSunsetPolicyResponse, action: &str) -> bool {
    match action {
        "expire_coupon" => policy.auto_apply_expired,
        "pause_coupon" => policy.auto_apply_usage_limit,
        "review_stale_rule" | "review_stale_coupon" => policy.auto_apply_stale,
        _ => false,
    }
}

fn auto_sunset_policy_response(row: AutoSunsetPolicyRecord) -> AutoSunsetPolicyResponse {
    AutoSunsetPolicyResponse {
        expire_past_end_date: row.expire_past_end_date,
        pause_coupons_at_usage_limit: row.pause_coupons_at_usage_limit,
        review_no_end_date_after_days: row.review_no_end_date_after_days,
        auto_apply_expired: row.auto_apply_expired,
        auto_apply_usage_limit: row.auto_apply_usage_limit,
        auto_apply_stale: row.auto_apply_stale,
        status: row.status,
        updated_at: Some(row.updated_at),
    }
}

impl Default for AutoSunsetPolicyResponse {
    fn default() -> Self {
        Self {
            expire_past_end_date: true,
            pause_coupons_at_usage_limit: true,
            review_no_end_date_after_days: 30,
            auto_apply_expired: true,
            auto_apply_usage_limit: true,
            auto_apply_stale: false,
            status: "active".into(),
            updated_at: None,
        }
    }
}

fn auto_sunset_decision_response(row: AutoSunsetDecisionRecord) -> AutoSunsetDecisionResponse {
    AutoSunsetDecisionResponse {
        id: row.id,
        offer_type: row.offer_type,
        offer_id: row.offer_id,
        offer_name: row.offer_name,
        action: row.action,
        reason: row.reason,
        severity: row.severity,
        status: row.status,
        evidence: row.evidence_json,
        source: row.source,
        decided_at: row.decided_at,
        applied_at: row.applied_at,
    }
}

struct ContextOfferDecision {
    ready: bool,
    angle: &'static str,
    discount_bps: i32,
    reasons: Vec<String>,
}

#[allow(clippy::too_many_arguments)]
fn member_wallet_decision(
    client_exists: bool,
    wallet_balance_paise: i64,
    wallet_coverage_bps: i64,
    active_membership_count: i64,
    membership_expiry_days: i64,
    membership_credits_remaining: i64,
    reward_points_balance: i64,
    visit_count: i64,
    total_spend_paise: i64,
    scheduled_staff: i64,
    occupancy_bps: i64,
    base_discount_bps: i32,
    max_discount_bps: i32,
) -> ContextOfferDecision {
    if !client_exists {
        return ContextOfferDecision {
            ready: false,
            angle: "collect_member_wallet_data",
            discount_bps: 0,
            reasons: vec!["A real active client record is required.".into()],
        };
    }
    if scheduled_staff > 0 && occupancy_bps >= 8_000 {
        return ContextOfferDecision {
            ready: true,
            angle: "hold_capacity",
            discount_bps: 0,
            reasons: vec!["Booked capacity is high; additional discount is blocked.".into()],
        };
    }
    if active_membership_count > 0 && membership_credits_remaining > 0 {
        return ContextOfferDecision {
            ready: true,
            angle: "redeem_membership_credit",
            discount_bps: 0,
            reasons: vec![
                "Available membership credits should be used before a cash discount.".into(),
            ],
        };
    }
    if active_membership_count > 0 && membership_expiry_days <= 30 {
        return ContextOfferDecision {
            ready: true,
            angle: "membership_renewal_offer",
            discount_bps: (base_discount_bps + 500).min(1_800).min(max_discount_bps),
            reasons: vec!["The active membership is due to expire within 30 days.".into()],
        };
    }
    if wallet_balance_paise > 0 && wallet_coverage_bps >= 5_000 {
        return ContextOfferDecision {
            ready: true,
            angle: "wallet_redemption_offer",
            discount_bps: 0,
            reasons: vec!["The saved wallet balance can cover at least half of this cart.".into()],
        };
    }
    if active_membership_count <= 0 && (visit_count >= 3 || total_spend_paise >= 2_000_000) {
        return ContextOfferDecision {
            ready: true,
            angle: "convert_to_membership",
            discount_bps: (base_discount_bps + 800).min(2_200).min(max_discount_bps),
            reasons: vec![
                "Observed visits or spend support a controlled membership conversion offer.".into(),
            ],
        };
    }
    if reward_points_balance > 0 || wallet_balance_paise > 0 {
        return ContextOfferDecision {
            ready: true,
            angle: "loyalty_points_nudge",
            discount_bps: base_discount_bps.min(1_000).min(max_discount_bps),
            reasons: vec![
                "Saved reward or wallet activity supports a small retention nudge.".into(),
            ],
        };
    }
    if visit_count > 0 {
        return ContextOfferDecision {
            ready: true,
            angle: "member_retention_nudge",
            discount_bps: base_discount_bps.min(1_500).min(max_discount_bps),
            reasons: vec!["Observed completed visits support a controlled retention offer.".into()],
        };
    }
    ContextOfferDecision {
        ready: false,
        angle: "collect_member_wallet_data",
        discount_bps: 0,
        reasons: vec![
            "No membership, wallet, reward, visit or spend signal is available yet.".into(),
        ],
    }
}

#[allow(clippy::too_many_arguments)]
fn context_offer_decision(
    offer_type: &str,
    package_count: i64,
    package_margin_bps: i64,
    selected_service_count: i32,
    channel_history_count: i64,
    channel_fee_bps: i32,
    lead_minutes: i64,
    lead_history_count: i64,
    no_show_bps: i64,
    weather_condition: &str,
    event_type: &str,
    scheduled_staff: i64,
    appointment_count: i64,
    occupancy_bps: i64,
    base_discount_bps: i32,
    max_discount_bps: i32,
) -> ContextOfferDecision {
    if scheduled_staff > 0 && occupancy_bps >= 8_000 {
        return ContextOfferDecision {
            ready: true,
            angle: "hold_capacity",
            discount_bps: 0,
            reasons: vec!["Booked capacity is high; additional discount is blocked.".into()],
        };
    }
    match offer_type {
        "bundle" if package_count <= 0 => ContextOfferDecision {
            ready: false,
            angle: "collect_bundle_data",
            discount_bps: 0,
            reasons: vec!["No active package matches this service category.".into()],
        },
        "bundle" if package_margin_bps > 0 && package_margin_bps < 2_000 => ContextOfferDecision {
            ready: true,
            angle: "protect_bundle_margin",
            discount_bps: 0,
            reasons: vec!["Matched package margin is below 20 percent.".into()],
        },
        "bundle" if selected_service_count >= 3 => ContextOfferDecision {
            ready: true,
            angle: "protect_high_ticket_margin",
            discount_bps: 0,
            reasons: vec!["The cart is already bundled; extra discount is not required.".into()],
        },
        "bundle" => ContextOfferDecision {
            ready: true,
            angle: "upgrade_to_package",
            discount_bps: (base_discount_bps + 500).min(max_discount_bps),
            reasons: vec!["An active category package supports a controlled upgrade offer.".into()],
        },
        "channel" if channel_history_count <= 0 => ContextOfferDecision {
            ready: false,
            angle: "collect_channel_data",
            discount_bps: 0,
            reasons: vec!["No booking or sale history exists for this channel.".into()],
        },
        "channel" if channel_fee_bps >= 1_200 => ContextOfferDecision {
            ready: true,
            angle: "protect_channel_margin",
            discount_bps: base_discount_bps.min(800).min(max_discount_bps),
            reasons: vec!["High channel fees require a tight discount cap.".into()],
        },
        "channel" => ContextOfferDecision {
            ready: true,
            angle: "channel_conversion_offer",
            discount_bps: (base_discount_bps + 500).min(max_discount_bps),
            reasons: vec![
                "Observed channel history supports a controlled conversion offer.".into(),
            ],
        },
        "lead_time" if lead_history_count <= 0 && scheduled_staff <= 0 => ContextOfferDecision {
            ready: false,
            angle: "collect_lead_time_data",
            discount_bps: 0,
            reasons: vec!["Lead-time history and scheduled capacity are not available.".into()],
        },
        "lead_time" => {
            let (boost, cap, angle) = if lead_minutes <= 120 {
                (1_200, 3_200, "last_minute_slot_fill")
            } else if lead_minutes <= 480 {
                (800, 2_800, "same_day_booking_push")
            } else if lead_minutes <= 1_440 {
                (400, 2_200, "tomorrow_slot_nudge")
            } else if lead_minutes <= 4_320 {
                (0, 1_600, "short_notice_offer")
            } else if lead_minutes <= 10_080 {
                (0, 1_200, "standard_booking")
            } else {
                (-base_discount_bps, 800, "advance_booking_protect_margin")
            };
            let quiet_boost = if scheduled_staff > 0 && occupancy_bps < 4_000 {
                500
            } else {
                0
            };
            let risk_cut = if no_show_bps >= 2_500 { 300 } else { 0 };
            ContextOfferDecision {
                ready: true,
                angle,
                discount_bps: (base_discount_bps + boost + quiet_boost - risk_cut)
                    .clamp(0, cap.min(max_discount_bps)),
                reasons: vec![
                    "Lead-time bucket, observed outcomes and slot occupancy were applied.".into(),
                ],
            }
        }
        "weather_event" if weather_condition == "normal" && event_type == "none" => {
            ContextOfferDecision {
                ready: false,
                angle: "collect_weather_event_signal",
                discount_bps: 0,
                reasons: vec!["A real weather or local event signal is required.".into()],
            }
        }
        "weather_event" if scheduled_staff <= 0 && appointment_count <= 0 => ContextOfferDecision {
            ready: false,
            angle: "collect_capacity_data",
            discount_bps: 0,
            reasons: vec![
                "Saved staff capacity or appointments are required for this slot.".into(),
            ],
        },
        "weather_event" => {
            let weather_boost = match weather_condition {
                "storm" => 1_000,
                "rain" => 700,
                "heatwave" | "pollution" => 500,
                "cold" => 300,
                _ => 0,
            };
            let (event_boost, cap, angle) = match event_type {
                "festival" => (-200, 800, "festival_bundle"),
                "wedding" => (-300, 800, "bridal_upsell"),
                "payday" | "month_end" => (0, 1_200, "payday_upgrade"),
                "local_event" => (500, 1_500, "event_walkin_capture"),
                "school_holiday" => (600, 1_500, "family_booking_bundle"),
                "traffic" | "strike" => (700, 2_000, "same_day_recovery"),
                _ => (0, 2_000, "weather_recovery_offer"),
            };
            ContextOfferDecision {
                ready: true,
                angle,
                discount_bps: (base_discount_bps + weather_boost + event_boost)
                    .clamp(0, cap.min(max_discount_bps)),
                reasons: vec![
                    "Entered weather/event signal and real slot demand were applied.".into(),
                ],
            }
        }
        _ => unreachable!(),
    }
}

struct MarketDecision {
    position: &'static str,
    angle: &'static str,
    discount_bps: i32,
    reasons: Vec<String>,
}

fn market_decision(
    our_price_paise: i64,
    market_avg_paise: i64,
    price_gap_bps: i64,
    occupancy_bps: i64,
    scheduled_staff: i64,
    base_discount_bps: i32,
    max_discount_bps: i32,
) -> MarketDecision {
    if our_price_paise <= 0 || market_avg_paise <= 0 {
        return MarketDecision {
            position: "unknown",
            angle: "collect_market_data",
            discount_bps: 0,
            reasons: vec!["A saved service price and real market benchmark are required.".into()],
        };
    }
    if price_gap_bps > 500 {
        let mut discount = (price_gap_bps as i32).clamp(base_discount_bps, max_discount_bps);
        let mut reasons = vec!["Our category price is above the selected market benchmark.".into()];
        if scheduled_staff > 0 && occupancy_bps >= 8_000 {
            discount = discount.min(base_discount_bps.min(500));
            reasons.push("High booked capacity limits discount depth.".into());
        }
        MarketDecision {
            position: "above_market",
            angle: "price_match",
            discount_bps: discount,
            reasons,
        }
    } else if price_gap_bps < -500 {
        MarketDecision {
            position: "below_market",
            angle: "protect_price_advantage",
            discount_bps: 0,
            reasons: vec![
                "Our category price is already below the selected market benchmark.".into(),
            ],
        }
    } else {
        let low_demand = scheduled_staff > 0 && occupancy_bps < 4_000;
        MarketDecision {
            position: "at_market",
            angle: if low_demand {
                "fill_quiet_hour"
            } else {
                "hold_price"
            },
            discount_bps: if low_demand {
                base_discount_bps.max(500).min(max_discount_bps)
            } else {
                0
            },
            reasons: vec![if low_demand {
                "Market-aligned pricing and low observed occupancy support a controlled offer."
                    .into()
            } else {
                "Market-aligned pricing does not currently require an offer.".into()
            }],
        }
    }
}

fn market_observation_response(row: MarketPriceObservationRecord) -> MarketObservationResponse {
    MarketObservationResponse {
        id: row.id,
        service_category: row.service_category,
        competitor_name: row.competitor_name,
        observed_price_paise: row.observed_price_paise,
        observed_on: row.observed_on,
        source_url: row.source_url,
        active: row.active,
        created_at: row.created_at,
    }
}

fn context_offer_suggestion_response(
    row: ContextOfferSuggestionRecord,
) -> ContextOfferSuggestionResponse {
    ContextOfferSuggestionResponse {
        id: row.id,
        offer_type: row.offer_type,
        service_category: row.service_category,
        signal_date: row.signal_date,
        hour_slot: row.hour_slot,
        service_price_paise: row.service_price_paise,
        base_discount_bps: row.base_discount_bps,
        suggested_discount_bps: row.suggested_discount_bps,
        campaign_angle: row.campaign_angle,
        context: row.context_json,
        reasons: serde_json::from_value(row.reasons_json).unwrap_or_default(),
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn context_offer_type(value: &str) -> Result<&'static str, AppError> {
    match value.trim().to_ascii_lowercase().replace('-', "_").as_str() {
        "bundle" => Ok("bundle"),
        "channel" => Ok("channel"),
        "lead_time" => Ok("lead_time"),
        "weather_event" => Ok("weather_event"),
        "member_wallet" => Ok("member_wallet"),
        _ => Err(AppError::validation(
            "offer type must be bundle, channel, lead_time, weather_event or member_wallet",
        )),
    }
}

fn normalized_context_token(value: &str, max: usize) -> Result<String, AppError> {
    if value.chars().count() > max {
        return Err(AppError::validation("context field is too long"));
    }
    let mut token = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    while token.contains("__") {
        token = token.replace("__", "_");
    }
    Ok(token.trim_matches('_').to_string())
}

fn context_choice(
    value: &str,
    allowed: &'static [&'static str],
    message: &'static str,
) -> Result<&'static str, AppError> {
    let token = normalized_context_token(value, 80)?;
    allowed
        .iter()
        .copied()
        .find(|choice| *choice == token)
        .ok_or_else(|| AppError::validation(message))
}

fn lead_bucket(minutes: i64) -> (&'static str, i64, i64) {
    if minutes <= 120 {
        ("urgent_2h", 0, 121)
    } else if minutes <= 480 {
        ("same_day", 121, 481)
    } else if minutes <= 1_440 {
        ("next_day", 481, 1_441)
    } else if minutes <= 4_320 {
        ("short_notice", 1_441, 4_321)
    } else if minutes <= 10_080 {
        ("standard_week", 4_321, 10_081)
    } else {
        ("advance", 10_081, 129_601)
    }
}

fn market_suggestion_response(row: MarketSuggestionRecord) -> MarketSuggestionResponse {
    MarketSuggestionResponse {
        id: row.id,
        service_category: row.service_category,
        signal_date: row.signal_date,
        hour_slot: row.hour_slot,
        our_price_paise: row.our_price_paise,
        base_discount_bps: row.base_discount_bps,
        max_discount_bps: row.max_discount_bps,
        benchmark_source: row.benchmark_source,
        market_avg_paise: row.market_avg_paise,
        market_min_paise: row.market_min_paise,
        market_max_paise: row.market_max_paise,
        observation_count: row.observation_count,
        scheduled_staff: row.scheduled_staff,
        appointment_count: row.appointment_count,
        occupancy_bps: row.occupancy_bps,
        price_gap_bps: row.price_gap_bps,
        market_position: row.market_position,
        campaign_angle: row.campaign_angle,
        suggested_discount_bps: row.suggested_discount_bps,
        status: row.status,
        reasons: serde_json::from_value(row.reasons_json).unwrap_or_default(),
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn market_suggestion_status(value: &str) -> Result<&'static str, AppError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "suggested" => Ok("suggested"),
        "approved" => Ok("approved"),
        "paused" => Ok("paused"),
        "archived" => Ok("archived"),
        _ => Err(AppError::validation(
            "status must be suggested, approved, paused or archived",
        )),
    }
}

fn required_market_text(
    value: &str,
    message: &'static str,
    max: usize,
) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::validation(message));
    }
    if value.chars().count() > max {
        return Err(AppError::validation("market field is too long"));
    }
    Ok(value.to_string())
}

fn signed_ratio_bps(numerator: i64, denominator: i64) -> i64 {
    if denominator <= 0 {
        0
    } else {
        ((numerator as i128) * 10_000 / denominator as i128)
            .clamp(i64::MIN as i128, i64::MAX as i128) as i64
    }
}

fn audience_response(row: HappyHourAudienceRecord) -> AudienceResponse {
    AudienceResponse {
        id: row.id,
        audience_key: row.audience_key,
        name: row.name,
        channel: row.channel,
        criteria: serde_json::from_value(row.criteria_json).unwrap_or_default(),
        estimate_count: row.estimate_count,
        previewed_at: row.previewed_at,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn campaign_link_response(row: HappyHourCampaignLinkRecord) -> CampaignLinkResponse {
    CampaignLinkResponse {
        id: row.id,
        audience_id: row.audience_id,
        audience_name: row.audience_name,
        rule_id: row.rule_id,
        rule_name: row.rule_name,
        coupon_id: row.coupon_id,
        coupon_code: row.coupon_code,
        channel: row.channel,
        title: row.title,
        message: row.message,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn validate_audience_criteria(criteria: &AudienceCriteria) -> Result<(), AppError> {
    if criteria.inactive_days_gte.is_some_and(|value| value < 0)
        || criteria.visit_count_gte.is_some_and(|value| value < 0)
        || criteria
            .total_spend_paise_gte
            .is_some_and(|value| value < 0)
        || criteria
            .birthday_month
            .is_some_and(|value| !(1..=12).contains(&value))
        || criteria
            .client_type
            .as_deref()
            .is_some_and(|value| !matches!(value, "new" | "existing"))
    {
        return Err(AppError::validation("audience criteria is invalid"));
    }
    Ok(())
}

fn campaign_channel(value: &str) -> Result<&'static str, AppError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "whatsapp" => Ok("whatsapp"),
        "sms" => Ok("sms"),
        _ => Err(AppError::validation("channel must be whatsapp or sms")),
    }
}

fn campaign_status(value: &str) -> Result<&'static str, AppError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "draft" => Ok("draft"),
        "ready" => Ok("ready"),
        "archived" => Ok("archived"),
        _ => Err(AppError::validation(
            "status must be draft, ready or archived",
        )),
    }
}

fn required_campaign_text(
    value: &str,
    message: &'static str,
    max: usize,
) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::validation(message));
    }
    if value.chars().count() > max {
        return Err(AppError::validation("campaign text is too long"));
    }
    Ok(value.to_string())
}

fn audience_key(value: &str) -> String {
    let mut key = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    while key.contains("__") {
        key = key.replace("__", "_");
    }
    key.trim_matches('_').chars().take(80).collect()
}

fn no_show_signal(row: NoShowRiskRecord) -> NoShowRiskSignal {
    let weighted_failures = row
        .no_show_count
        .saturating_mul(100)
        .saturating_add(row.cancellation_count.saturating_mul(40));
    let risk_score = if row.total_appointments <= 0 {
        0
    } else {
        (weighted_failures / row.total_appointments).clamp(0, 100) as i32
    };
    NoShowRiskSignal {
        risk_level: if risk_score >= 60 {
            "high"
        } else if risk_score >= 30 {
            "medium"
        } else {
            "low"
        },
        client_id: row.client_id,
        client_name: row.client_name,
        total_appointments: row.total_appointments,
        no_show_count: row.no_show_count,
        cancellation_count: row.cancellation_count,
        completed_count: row.completed_count,
        risk_score,
    }
}

fn inventory_signal(row: InventoryOfferRecord) -> InventoryOfferSignal {
    let low_stock = row.stock_quantity <= row.reorder_point;
    InventoryOfferSignal {
        item_id: row.item_id,
        item_name: row.item_name,
        stock_quantity: row.stock_quantity,
        reorder_point: row.reorder_point,
        status: if low_stock { "low_stock" } else { "high_stock" },
        recommendation: if low_stock {
            "block_product_discount"
        } else {
            "controlled_product_offer"
        },
    }
}

fn staff_signal(row: StaffOfferRecord) -> StaffOfferSignal {
    let occupancy_bps = ratio_bps(row.booked_minutes, row.scheduled_minutes).clamp(0, 10_000);
    let recommendation = if row.schedule_status != "working" || row.scheduled_minutes <= 0 {
        "collecting"
    } else if occupancy_bps < 5_000 {
        "controlled_staff_offer"
    } else {
        "capacity_balanced"
    };
    StaffOfferSignal {
        staff_id: row.staff_id,
        staff_name: row.staff_name,
        schedule_status: row.schedule_status,
        scheduled_minutes: row.scheduled_minutes,
        booked_minutes: row.booked_minutes,
        appointment_count: row.appointment_count,
        occupancy_bps,
        recommendation,
    }
}

fn to_offer(row: HappyHourPerformanceRecord) -> HappyHourControlTowerOffer {
    let net_discount = row
        .discount_paise
        .saturating_sub(row.reversed_discount_paise)
        .max(0);
    let reversal_bps = ratio_bps(row.reversed_discount_paise, row.discount_paise);
    let (health_status, health_score) = health(row.applications, row.discount_paise, reversal_bps);
    HappyHourControlTowerOffer {
        lifecycle_stage: if !row.active {
            "paused"
        } else if row.applications > 0 {
            "live"
        } else {
            "ready"
        },
        roi_status: if row.applications == 0 {
            "collecting"
        } else if net_discount == 0 {
            "reversed"
        } else {
            "measured"
        },
        health_status,
        health_score,
        discount_rate_bps: ratio_bps(
            net_discount,
            row.sales_value_paise.saturating_add(net_discount),
        ),
        return_on_discount_bps: ratio_bps(row.sales_value_paise, net_discount),
        rule_id: row.rule_id,
        name: row.name,
        active: row.active,
        applications: row.applications,
        active_applications: row.active_applications,
        sales_value_paise: row.sales_value_paise,
        discount_paise: net_discount,
        reversed_discount_paise: row.reversed_discount_paise,
        last_applied_at: row.last_applied_at,
    }
}

fn health(applications: i64, discount_paise: i64, reversal_bps: i64) -> (&'static str, i32) {
    if applications == 0 || discount_paise == 0 {
        return ("collecting", 0);
    }
    // ponytail: reversal-only health is deliberate; add margin and return outcomes when persisted.
    let score = (100 - reversal_bps / 100).clamp(0, 100) as i32;
    let status = if reversal_bps >= 5_000 {
        "at_risk"
    } else if reversal_bps >= 2_000 {
        "monitor"
    } else {
        "healthy"
    };
    (status, score)
}

fn ratio_bps(numerator: i64, denominator: i64) -> i64 {
    if numerator <= 0 || denominator <= 0 {
        0
    } else {
        numerator.saturating_mul(10_000) / denominator
    }
}

#[cfg(test)]
mod tests {
    use super::{
        audience_key, auto_sunset_candidates, branch_leaderboard_grade, branch_leaderboard_score,
        budget_response, build_client_return_tracker, build_elasticity_pricing,
        build_rule_conflicts, context_offer_decision, fraud_outcome, health, market_decision,
        member_wallet_decision, no_show_signal, ratio_bps, role_discount_limit_bps,
        statistical_discount_anomaly, time_ranges_overlap, validate_audience_criteria,
        AudienceCriteria, AutoSunsetPolicyResponse,
    };
    use crate::repositories::happy_hours_repository::{
        AutoSunsetOfferRecord, ClientReturnRecord, DailyDiscountRecord, ElasticityBandRecord,
        HappyHourBudgetRecord, HappyHourRuleAnalysisRecord, NoShowRiskRecord,
    };
    use chrono::{Duration, NaiveTime, Utc};

    #[test]
    fn control_tower_health_uses_real_reversal_signal() {
        assert_eq!(health(0, 0, 0), ("collecting", 0));
        assert_eq!(health(4, 1_000, 1_000), ("healthy", 90));
        assert_eq!(health(4, 1_000, 2_500), ("monitor", 75));
        assert_eq!(health(4, 1_000, 6_000), ("at_risk", 40));
        assert_eq!(ratio_bps(500, 10_000), 500);
    }

    #[test]
    fn conflict_detector_handles_overnight_scope_and_precedence_ties() {
        let time = |hour, minute| NaiveTime::from_hms_opt(hour, minute, 0).unwrap();
        assert!(time_ranges_overlap(
            time(22, 0),
            time(2, 0),
            time(1, 0),
            time(3, 0)
        ));
        let rule = |id: &str, line_types: Vec<String>| HappyHourRuleAnalysisRecord {
            id: id.into(),
            name: id.into(),
            start_time: time(22, 0),
            end_time: time(2, 0),
            weekdays: vec![5],
            discount_bps: 1_000,
            eligible_line_types: line_types,
            eligible_item_ids: vec![],
            eligible_client_categories: vec![],
            min_margin_bps: 2_000,
            block_on_unknown_cost: true,
            active: true,
        };
        let conflicts = build_rule_conflicts(&[
            rule("first", vec!["service".into()]),
            rule("second", vec![]),
        ]);
        assert_eq!(conflicts.summary.conflict_count, 1);
        assert_eq!(conflicts.conflicts[0].conflict_type, "precedence_tie");
    }

    #[test]
    fn budget_uses_observed_discount_and_threshold() {
        let now = Utc::now();
        let budget = budget_response(HappyHourBudgetRecord {
            id: "budget-1".into(),
            period_start: now.date_naive(),
            period_end: now.date_naive(),
            budget_paise: 100_000,
            spent_paise: 85_000,
            alert_threshold_bps: 8_000,
            approval_above_bps: 1_500,
            active: true,
            updated_at: now,
        });
        assert_eq!(budget.remaining_paise, 15_000);
        assert_eq!(budget.used_bps, 8_500);
        assert!(budget.threshold_reached);
        assert!(!budget.exceeded);
    }

    #[test]
    fn role_limits_and_fraud_decisions_follow_governance_policy() {
        assert_eq!(role_discount_limit_bps("cashier"), 1_000);
        assert_eq!(role_discount_limit_bps("branch_manager"), 2_500);
        assert_eq!(role_discount_limit_bps("regional-head"), 4_000);
        assert_eq!(role_discount_limit_bps("owner"), 10_000);
        assert_eq!(fraud_outcome(59).1, "allow");
        assert_eq!(fraud_outcome(60).1, "manager_review");
        assert_eq!(fraud_outcome(85).1, "block_until_review");
    }

    #[test]
    fn statistical_anomaly_requires_a_real_baseline_and_material_spike() {
        let today = Utc::now().date_naive();
        let mut rows = (1..=8)
            .map(|days| DailyDiscountRecord {
                business_date: today - Duration::days(days),
                sale_count: 2,
                discount_paise: 1_000,
            })
            .collect::<Vec<_>>();
        rows.push(DailyDiscountRecord {
            business_date: today,
            sale_count: 4,
            discount_paise: 30_000,
        });
        assert_eq!(
            statistical_discount_anomaly(&rows, today)
                .expect("spike")
                .anomaly_type,
            "statistical_discount_spike"
        );
    }

    #[test]
    fn no_show_risk_uses_observed_outcomes() {
        let signal = no_show_signal(NoShowRiskRecord {
            client_id: "client-1".into(),
            client_name: "Client".into(),
            total_appointments: 10,
            no_show_count: 4,
            cancellation_count: 2,
            completed_count: 4,
        });
        assert_eq!(signal.risk_score, 48);
        assert_eq!(signal.risk_level, "medium");
    }

    #[test]
    fn audience_input_stays_bounded_and_keyed() {
        assert_eq!(audience_key("Inactive 60 Days"), "inactive_60_days");
        assert!(validate_audience_criteria(&AudienceCriteria {
            birthday_month: Some(13),
            ..Default::default()
        })
        .is_err());
    }

    #[test]
    fn market_offer_protects_price_and_capacity() {
        let quiet = market_decision(11_000, 10_000, 1_000, 2_000, 4, 500, 2_000);
        assert_eq!(quiet.position, "above_market");
        assert_eq!(quiet.discount_bps, 1_000);

        let busy = market_decision(11_000, 10_000, 1_000, 9_000, 4, 500, 2_000);
        assert_eq!(busy.discount_bps, 500);

        let advantage = market_decision(9_000, 10_000, -1_000, 2_000, 4, 500, 2_000);
        assert_eq!(advantage.discount_bps, 0);
    }

    #[test]
    fn context_offer_modes_keep_real_data_guards() {
        let bundle = context_offer_decision(
            "bundle", 1, 4_000, 1, 0, 0, 0, 0, 0, "normal", "none", 4, 1, 2_500, 500, 2_000,
        );
        assert!(bundle.ready);
        assert_eq!(bundle.discount_bps, 1_000);

        let channel = context_offer_decision(
            "channel", 0, 0, 1, 0, 0, 0, 0, 0, "normal", "none", 4, 1, 2_500, 500, 2_000,
        );
        assert!(!channel.ready);

        let lead = context_offer_decision(
            "lead_time",
            0,
            0,
            1,
            0,
            0,
            60,
            5,
            0,
            "normal",
            "none",
            4,
            1,
            2_500,
            500,
            3_000,
        );
        assert_eq!(lead.discount_bps, 2_200);

        let weather = context_offer_decision(
            "weather_event",
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            0,
            "storm",
            "none",
            4,
            1,
            2_500,
            500,
            2_000,
        );
        assert_eq!(weather.discount_bps, 1_500);

        let member_wallet = member_wallet_decision(
            true, 50_000, 5_000, 1, 120, 2, 0, 4, 2_500_000, 4, 2_500, 500, 2_000,
        );
        assert_eq!(member_wallet.angle, "redeem_membership_credit");
        assert_eq!(member_wallet.discount_bps, 0);

        let missing_client = member_wallet_decision(
            false, 50_000, 10_000, 0, 9_999, 0, 0, 0, 0, 0, 0, 500, 2_000,
        );
        assert!(!missing_client.ready);

        let wallet = member_wallet_decision(
            true, 50_000, 5_000, 0, 9_999, 0, 0, 1, 50_000, 4, 2_500, 500, 2_000,
        );
        assert_eq!(wallet.angle, "wallet_redemption_offer");
        assert_eq!(wallet.discount_bps, 0);
    }

    #[test]
    fn auto_sunset_uses_saved_expiry_usage_and_age() {
        let now = Utc::now();
        let offers = vec![
            AutoSunsetOfferRecord {
                offer_type: "coupon".into(),
                offer_id: "coupon-1".into(),
                offer_name: "REAL".into(),
                ends_at: Some(now - Duration::days(1)),
                usage_limit: Some(5),
                used_count: 5,
                created_at: now - Duration::days(10),
            },
            AutoSunsetOfferRecord {
                offer_type: "rule".into(),
                offer_id: "rule-1".into(),
                offer_name: "Saved rule".into(),
                ends_at: None,
                usage_limit: None,
                used_count: 0,
                created_at: now - Duration::days(31),
            },
        ];
        let rows = auto_sunset_candidates(&AutoSunsetPolicyResponse::default(), &offers, now);
        assert_eq!(rows.len(), 3);
        assert!(rows.iter().any(|row| row.action == "expire_coupon"));
        assert!(rows.iter().any(|row| row.action == "pause_coupon"));
        assert!(rows.iter().any(|row| row.action == "review_stale_rule"));
    }

    #[test]
    fn branch_leaderboard_scores_real_outcomes_and_keeps_no_data_zero() {
        assert_eq!(branch_leaderboard_score(0, 0, 100_000, 0, 0, 0), 0);
        assert_eq!(branch_leaderboard_grade(0, 0), "no_data");

        let score = branch_leaderboard_score(10, 100_000, 100_000, 40_000, 2_500, 0);
        assert_eq!(score, 100);
        assert_eq!(branch_leaderboard_grade(score, 10), "excellent");
    }

    #[test]
    fn client_return_tracker_classifies_real_repeat_sales() {
        let now = Utc::now();
        let rows = vec![
            ClientReturnRecord {
                source_id: "lock-1".into(),
                offer_type: "rule".into(),
                offer_id: "rule-1".into(),
                offer_title: "Quiet Hours".into(),
                client_id: "client-1".into(),
                client_name: "Client One".into(),
                used_at: now - Duration::days(10),
                amount_paise: 10_000,
                discount_paise: 1_000,
                return_at: Some(now - Duration::days(5)),
                return_amount_paise: 8_000,
            },
            ClientReturnRecord {
                source_id: "lock-2".into(),
                offer_type: "rule".into(),
                offer_id: "rule-1".into(),
                offer_title: "Quiet Hours".into(),
                client_id: "client-2".into(),
                client_name: "Client Two".into(),
                used_at: now - Duration::days(40),
                amount_paise: 12_000,
                discount_paise: 1_200,
                return_at: None,
                return_amount_paise: 0,
            },
        ];
        let result = build_client_return_tracker(rows, now, 30, "", "", 100);
        assert_eq!(result.summary.returned_count, 1);
        assert_eq!(result.summary.at_risk_count, 1);
        assert_eq!(result.summary.return_revenue_paise, 8_000);
        assert_eq!(result.offers[0].return_rate_bps, 5_000);
    }

    #[test]
    fn elasticity_pricing_selects_margin_safe_observed_profit() {
        let date = Utc::now().date_naive();
        let band = |discount_bps, units, revenue_paise, product_cost_paise| ElasticityBandRecord {
            service_id: "service-1".into(),
            service_name: "Hair Cut".into(),
            discount_bps,
            minimum_margin_bps: 2_000,
            sample_count: 5,
            slot_count: 5,
            units,
            revenue_paise,
            discount_paise: 0,
            product_cost_paise,
            staff_cost_paise: 0,
        };
        let result = build_elasticity_pricing(
            vec![
                band(0, 10, 100_000, 40_000),
                band(1_000, 15, 120_000, 50_000),
            ],
            date,
            date,
        );
        assert_eq!(result.ready_service_count, 1);
        assert_eq!(result.rows[1].demand_lift_bps, 5_000);
        assert!(result.rows[1].recommended);
    }
}
