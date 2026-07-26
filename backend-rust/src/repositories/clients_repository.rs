use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub code: Option<String>,
    pub first_name: String,
    pub last_name: String,
    pub phone: String,
    pub normalized_phone: String,
    pub email: String,
    pub wallet_balance_paise: i64,
    pub duplicate_count: i64,
    pub last_visit_at: Option<DateTime<Utc>>,
    pub membership_label: String,
    pub categories_json: String,
    pub birthday: Option<NaiveDate>,
    pub anniversary: Option<NaiveDate>,
    pub notes: String,
    pub active: bool,
    pub preferred_staff_id: Option<String>,
    pub preferred_staff_name: String,
    pub preferred_communication_channel: String,
    pub whatsapp_opt_in: Option<bool>,
    pub sms_opt_in: Option<bool>,
    pub email_opt_in: Option<bool>,
    pub merged_into_client_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientTimelineEventRecord {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub title: String,
    pub detail: String,
    pub occurred_at: DateTime<Utc>,
    pub amount_paise: Option<i64>,
    pub status: Option<String>,
    pub group_id: Option<String>,
    pub tip_paise: Option<i64>,
    pub balance_paise: Option<i64>,
    pub line_items: Value,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientSummaryRecord {
    pub total_visits: i64,
    pub open_appointments: i64,
    pub amount_due_paise: i64,
    pub reward_points_balance: i32,
    pub lifetime_value_paise: i64,
    pub average_spend_paise: i64,
    pub highest_bill_paise: i64,
    pub service_spend_paise: i64,
    pub product_spend_paise: i64,
    pub favourite_services: String,
    pub preferred_staff_name: String,
    pub visit_frequency_days: Option<f64>,
    pub inactive_days: i64,
    pub no_show_rate_bps: i32,
    pub cancellation_rate_bps: i32,
    pub churn_risk_score: i32,
    pub review_sentiment: String,
    pub next_best_action: String,
    pub next_best_action_reason: String,
    pub occasion_opportunity: String,
    pub rfm_segment: String,
    pub rfm_score: i32,
    pub intelligence_calculated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientAppointmentHistoryRecord {
    pub id: String,
    pub start_at: DateTime<Utc>,
    pub status: String,
    pub service_names: String,
    pub staff_name: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientInvoiceHistoryRecord {
    pub id: String,
    pub invoice_number: String,
    pub status: String,
    pub total_paise: i64,
    pub paid_paise: i64,
    pub service_names: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientServiceHistoryRecord {
    pub sale_id: String,
    pub invoice_number: String,
    pub service_id: String,
    pub service_name: String,
    pub quantity: i64,
    pub line_total_paise: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientNoteRecord {
    pub id: String,
    pub client_id: String,
    pub note_type: String,
    pub note: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientFormDefinitionRecord {
    pub id: String,
    pub form_key: String,
    pub name: String,
    pub form_type: String,
    pub version: i32,
    pub body: String,
    pub fields_json: Value,
    pub requires_signature: bool,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientClinicalProfileRecord {
    pub client_id: String,
    pub allergies: String,
    pub preferences: String,
    pub version: i32,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientFormSubmissionRecord {
    pub id: String,
    pub definition_id: String,
    pub form_key: String,
    pub form_name: String,
    pub form_type: String,
    pub form_version: i32,
    pub responses_json: Value,
    pub signature_name: String,
    pub signature_sha256: String,
    pub signed_at: Option<DateTime<Utc>>,
    pub submitted_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientTreatmentPhotoRecord {
    pub id: String,
    pub appointment_id: Option<String>,
    pub caption: String,
    pub file_name: String,
    pub content_type: String,
    pub byte_size: i32,
    pub sha256: String,
    pub photo_type: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientDuplicateRecord {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub phone: String,
    pub email: String,
    pub normalized_phone: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientConsentEventRecord {
    pub id: String,
    pub channel: String,
    pub opted_in: bool,
    pub source: String,
    pub reason: String,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientCommunicationRecord {
    pub id: String,
    pub channel: String,
    pub direction: String,
    pub status: String,
    pub subject: String,
    pub body: String,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientReviewRecord {
    pub id: String,
    pub platform: String,
    pub external_review_id: String,
    pub rating: Option<i16>,
    pub review_text: String,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientAuditRecord {
    pub id: String,
    pub event_type: String,
    pub actor_user_id: String,
    pub details_json: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientContactPreferencesRecord {
    pub preferred_staff_id: Option<String>,
    pub preferred_staff_name: String,
    pub preferred_communication_channel: String,
    pub whatsapp_opt_in: Option<bool>,
    pub sms_opt_in: Option<bool>,
    pub email_opt_in: Option<bool>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientRecommendationFeedbackRecord {
    pub id: String,
    pub recommendation: String,
    pub reason: String,
    pub decision: String,
    pub comment: String,
    pub actor_user_id: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientSegmentHistoryRecord {
    pub id: String,
    pub previous_segment: String,
    pub segment: String,
    pub rfm_score: i16,
    pub churn_risk_score: i16,
    pub source_snapshot_date: NaiveDate,
    pub changed_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct ClientAutomationCandidate {
    pub tenant_id: String,
    pub branch_id: String,
    pub source_type: String,
    pub source_id: String,
    pub client_id: String,
    pub phone: String,
    pub email: String,
    pub message: String,
    pub client_name: String,
}

#[derive(Debug, FromRow)]
pub struct ClientTreatmentPhotoFile {
    pub file_name: String,
    pub content_type: String,
    pub content: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientMasterRecord {
    pub id: String,
    pub kind: String,
    pub code: String,
    pub name: String,
    pub description: String,
    pub definition_json: Value,
    pub status: String,
    pub version: i32,
    pub created_by: String,
    pub updated_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientMasterAuditRecord {
    pub id: String,
    pub master_id: String,
    pub master_name: String,
    pub action: String,
    pub version: i32,
    pub before_json: Value,
    pub after_json: Value,
    pub actor_user_id: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientMasterSummaryRecord {
    pub kind: String,
    pub status: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientDiscountRuleRecord {
    pub id: String,
    pub name: String,
    pub segments: Vec<String>,
    pub service_categories: Vec<String>,
    pub min_lifetime_value_paise: i64,
    pub max_discount_bps: i32,
    pub clv_budget_bps: i32,
    pub approval_above_bps: i32,
    pub membership_eligible: bool,
    pub wallet_eligible: bool,
    pub active: bool,
    pub priority: i32,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientDiscountContext {
    pub client_id: String,
    pub segment: String,
    pub lifetime_value_paise: i64,
    pub rfm_score: i32,
    pub inactive_days: i32,
    pub churn_risk_score: i32,
    pub has_membership: bool,
    pub has_wallet_balance: bool,
    pub approved_discount_spend_paise: i64,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientDiscountDecisionRecord {
    pub id: String,
    pub rule_id: Option<String>,
    pub rule_name: String,
    pub service_category: String,
    pub segment: String,
    pub subtotal_paise: i64,
    pub lifetime_value_paise: i64,
    pub requested_discount_bps: i32,
    pub approved_discount_bps: i32,
    pub discount_paise: i64,
    pub remaining_clv_budget_paise: i64,
    pub has_membership: bool,
    pub has_wallet_balance: bool,
    pub status: String,
    pub reasons_json: Value,
    pub decided_by: String,
    pub approved_by: String,
    pub approved_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientWinBackOfferRecord {
    pub id: String,
    pub decision_id: Option<String>,
    pub offer_code: String,
    pub title: String,
    pub offered_discount_bps: i32,
    pub discount_cost_paise: i64,
    pub return_window_days: i32,
    pub status: String,
    pub issued_by: String,
    pub issued_at: DateTime<Utc>,
    pub redeemed_at: Option<DateTime<Utc>>,
    pub redeemed_sale_id: Option<String>,
    pub returned_at: Option<DateTime<Utc>>,
    pub return_sale_id: Option<String>,
    pub revenue_after_return_paise: i64,
    pub offer_roi_bps: i64,
    pub updated_at: DateTime<Utc>,
}

pub struct ClientMasterWrite<'a> {
    pub kind: &'a str,
    pub code: &'a str,
    pub name: &'a str,
    pub description: &'a str,
    pub definition: &'a Value,
    pub status: &'a str,
    pub actor: &'a str,
}

pub struct ClientDiscountRuleWrite<'a> {
    pub name: &'a str,
    pub segments: &'a [String],
    pub service_categories: &'a [String],
    pub min_lifetime_value_paise: i64,
    pub max_discount_bps: i32,
    pub clv_budget_bps: i32,
    pub approval_above_bps: i32,
    pub membership_eligible: bool,
    pub wallet_eligible: bool,
    pub active: bool,
    pub priority: i32,
    pub actor: &'a str,
}

pub struct ClientDiscountDecisionWrite<'a> {
    pub client_id: &'a str,
    pub rule_id: Option<&'a str>,
    pub service_category: &'a str,
    pub segment: &'a str,
    pub subtotal_paise: i64,
    pub lifetime_value_paise: i64,
    pub requested_discount_bps: i32,
    pub approved_discount_bps: i32,
    pub discount_paise: i64,
    pub remaining_clv_budget_paise: i64,
    pub has_membership: bool,
    pub has_wallet_balance: bool,
    pub status: &'a str,
    pub reasons: &'a Value,
    pub actor: &'a str,
}

pub struct ClientWinBackOfferWrite<'a> {
    pub client_id: &'a str,
    pub decision_id: Option<&'a str>,
    pub offer_code: &'a str,
    pub title: &'a str,
    pub offered_discount_bps: i32,
    pub discount_cost_paise: i64,
    pub return_window_days: i32,
    pub actor: &'a str,
}

pub struct ClientReportFilters<'a> {
    pub days: i32,
    pub limit: i64,
    pub min_lifetime_value_paise: i64,
    pub min_visits: i64,
    pub segment: &'a str,
    pub max_churn_risk_score: i32,
    pub include_unpaid: bool,
}

pub struct CreateClient<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub code: Option<&'a str>,
    pub first_name: &'a str,
    pub last_name: &'a str,
    pub phone: &'a str,
    pub normalized_phone: &'a str,
    pub email: &'a str,
    pub membership_label: &'a str,
    pub categories_json: &'a str,
    pub birthday: Option<NaiveDate>,
    pub anniversary: Option<NaiveDate>,
    pub notes: Option<&'a str>,
}

pub struct UpdateClient<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub code: Option<&'a str>,
    pub first_name: Option<&'a str>,
    pub last_name: Option<&'a str>,
    pub phone: Option<&'a str>,
    pub normalized_phone: Option<&'a str>,
    pub email: Option<&'a str>,
    pub membership_label: Option<&'a str>,
    pub categories_json: Option<&'a str>,
    pub birthday: Option<NaiveDate>,
    pub anniversary: Option<NaiveDate>,
    pub notes: Option<&'a str>,
    pub active: Option<bool>,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    q: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ClientRecord>, sqlx::Error> {
    let sql = select_sql(
        r#"
        WHERE tenant_id = $1
          AND branch_id = $2
          AND merged_into_client_id IS NULL
          AND (
            $3 = ''
            OR LOWER(
                 first_name || ' ' || last_name || ' ' || phone || ' ' ||
                 normalized_phone || ' ' || email || ' ' || COALESCE(code, '')
               ) LIKE '%' || LOWER($3) || '%'
            OR LOWER(
                 first_name || ' ' || last_name || ' ' || phone || ' ' ||
                 normalized_phone || ' ' || email || ' ' || COALESCE(code, '')
               ) LIKE '%' || LOWER(REGEXP_REPLACE($3, '[^0-9+]', '', 'g')) || '%'
          )
        ORDER BY created_at DESC
        LIMIT $4 OFFSET $5
        "#,
    );

    sqlx::query_as::<_, ClientRecord>(&sql)
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
) -> Result<Option<ClientRecord>, sqlx::Error> {
    let sql = select_sql(
        r#"
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        LIMIT 1
        "#,
    );

    sqlx::query_as::<_, ClientRecord>(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(id)
        .fetch_optional(db)
        .await
}

pub async fn summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<ClientSummaryRecord, sqlx::Error> {
    sqlx::query_as(
        r#"WITH scope_ids AS (
             SELECT $3::TEXT AS id UNION ALL
             SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3
           ), selected AS (
             SELECT client.* FROM clients client WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$3
           ), appointment_metrics AS (
             SELECT COUNT(*) FILTER (WHERE status IN ('completed','billed','paid'))::BIGINT AS total_visits,
                    COUNT(*) FILTER (WHERE start_at>=NOW() AND status NOT IN ('completed','billed','paid','cancelled','no-show'))::BIGINT AS open_appointments,
                    COUNT(*)::BIGINT AS appointment_count,
                    COUNT(*) FILTER (WHERE status='no-show')::BIGINT AS no_show_count,
                    COUNT(*) FILTER (WHERE status='cancelled')::BIGINT AS cancellation_count,
                    MIN(start_at) FILTER (WHERE status IN ('completed','billed','paid')) AS first_visit,
                    MAX(start_at) FILTER (WHERE status IN ('completed','billed','paid')) AS last_visit
               FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND client_id IN (SELECT id FROM scope_ids)
           ), sale_metrics AS (
             SELECT COALESCE(SUM(total_paise),0)::BIGINT AS lifetime_value_paise,
                    COALESCE(ROUND(AVG(total_paise)),0)::BIGINT AS average_spend_paise,
                    COALESCE(MAX(total_paise),0)::BIGINT AS highest_bill_paise,
                    COALESCE(SUM(GREATEST(total_paise-paid_paise,0)),0)::BIGINT AS amount_due_paise
               FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND client_id IN (SELECT id FROM scope_ids)
                AND status NOT IN ('draft','cancelled','voided','refunded')
           ), line_metrics AS (
             SELECT COALESCE(SUM(line.line_total_paise) FILTER (WHERE line.line_type='service'),0)::BIGINT AS service_spend_paise,
                    COALESCE(SUM(line.line_total_paise) FILTER (WHERE line.line_type='product'),0)::BIGINT AS product_spend_paise
               FROM pos_sales sale JOIN pos_sale_lines line ON line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id
              WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.client_id IN (SELECT id FROM scope_ids)
                AND sale.status NOT IN ('draft','cancelled','voided','refunded')
           ), favourite AS (
             SELECT COALESCE(STRING_AGG(service_name, ', ' ORDER BY uses DESC,service_name),'') AS favourite_services
               FROM (SELECT line.item_name AS service_name,SUM(line.quantity)::BIGINT AS uses
                       FROM pos_sales sale JOIN pos_sale_lines line ON line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id
                      WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.client_id IN (SELECT id FROM scope_ids)
                        AND sale.status NOT IN ('draft','cancelled','voided','refunded') AND line.line_type='service'
                      GROUP BY line.item_name ORDER BY uses DESC,line.item_name LIMIT 3) ranked_services
           ), preferred_staff AS (
             SELECT COALESCE(
               (SELECT COALESCE(NULLIF(staff.appointment_display_name,''),CONCAT_WS(' ',staff.first_name,staff.last_name)) FROM selected JOIN staff ON staff.id=selected.preferred_staff_id),
               (SELECT COALESCE(NULLIF(staff.appointment_display_name,''),CONCAT_WS(' ',staff.first_name,staff.last_name))
                  FROM appointments appointment JOIN staff ON staff.id=appointment.staff_id AND staff.tenant_id=appointment.tenant_id AND staff.branch_id=appointment.branch_id
                 WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.client_id IN (SELECT id FROM scope_ids)
                   AND appointment.status IN ('completed','billed','paid') GROUP BY staff.id ORDER BY COUNT(*) DESC,staff.id LIMIT 1),'') AS preferred_staff_name
           ), review_metrics AS (
             SELECT CASE WHEN COUNT(*)=0 THEN 'unknown' WHEN AVG(rating)>=4 THEN 'positive' WHEN AVG(rating)<=2 THEN 'negative' ELSE 'neutral' END AS review_sentiment
               FROM client_review_links WHERE tenant_id=$1 AND branch_id=$2 AND client_id IN (SELECT id FROM scope_ids) AND rating IS NOT NULL
           ), occasions AS (
             SELECT CASE
               WHEN birthday IS NOT NULL AND next_birthday BETWEEN CURRENT_DATE AND CURRENT_DATE+30 THEN 'Birthday · ' || TO_CHAR(next_birthday,'DD/MM/YYYY')
               WHEN anniversary IS NOT NULL AND next_anniversary BETWEEN CURRENT_DATE AND CURRENT_DATE+30 THEN 'Anniversary · ' || TO_CHAR(next_anniversary,'DD/MM/YYYY')
               ELSE '' END AS occasion_opportunity
             FROM (SELECT birthday,anniversary,
               CASE WHEN birthday_this_year<CURRENT_DATE THEN (birthday_this_year+INTERVAL '1 year')::DATE ELSE birthday_this_year END AS next_birthday,
               CASE WHEN anniversary_this_year<CURRENT_DATE THEN (anniversary_this_year+INTERVAL '1 year')::DATE ELSE anniversary_this_year END AS next_anniversary
               FROM (SELECT birthday,anniversary,
                 CASE WHEN birthday IS NULL THEN NULL ELSE (birthday+MAKE_INTERVAL(years=>EXTRACT(YEAR FROM CURRENT_DATE)::INT-EXTRACT(YEAR FROM birthday)::INT))::DATE END AS birthday_this_year,
                 CASE WHEN anniversary IS NULL THEN NULL ELSE (anniversary+MAKE_INTERVAL(years=>EXTRACT(YEAR FROM CURRENT_DATE)::INT-EXTRACT(YEAR FROM anniversary)::INT))::DATE END AS anniversary_this_year
                 FROM selected) current_year) upcoming
           ), latest_snapshot AS (
             SELECT snapshot_date,rfm_score,segment,churn_risk_score,calculated_at FROM client_intelligence_snapshots
              WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY snapshot_date DESC LIMIT 1
           ), metrics AS (
             SELECT appointment_metrics.*,sale_metrics.*,line_metrics.*,favourite.favourite_services,preferred_staff.preferred_staff_name,
                    review_metrics.review_sentiment,occasions.occasion_opportunity,
                    CASE WHEN appointment_metrics.total_visits>1 THEN EXTRACT(EPOCH FROM (appointment_metrics.last_visit-appointment_metrics.first_visit))/86400.0/(appointment_metrics.total_visits-1) ELSE NULL END::DOUBLE PRECISION AS visit_frequency_days,
                    GREATEST(CURRENT_DATE-COALESCE(appointment_metrics.last_visit::DATE,selected.created_at::DATE),0)::BIGINT AS inactive_days,
                    CASE WHEN appointment_metrics.appointment_count=0 THEN 0 ELSE ROUND(appointment_metrics.no_show_count*10000.0/appointment_metrics.appointment_count)::INTEGER END AS no_show_rate_bps,
                    CASE WHEN appointment_metrics.appointment_count=0 THEN 0 ELSE ROUND(appointment_metrics.cancellation_count*10000.0/appointment_metrics.appointment_count)::INTEGER END AS cancellation_rate_bps,
                    latest_snapshot.snapshot_date,latest_snapshot.rfm_score,latest_snapshot.segment,latest_snapshot.churn_risk_score AS snapshot_churn,latest_snapshot.calculated_at
               FROM selected CROSS JOIN appointment_metrics CROSS JOIN sale_metrics CROSS JOIN line_metrics CROSS JOIN favourite CROSS JOIN preferred_staff CROSS JOIN review_metrics CROSS JOIN occasions LEFT JOIN latest_snapshot ON TRUE
           ), scored AS (
             SELECT metrics.*,
               LEAST(100,LEAST(60,(inactive_days*60/180)::INTEGER)+LEAST(25,((no_show_rate_bps+cancellation_rate_bps)*25/10000)::INTEGER)+CASE WHEN total_visits<=1 THEN 15 ELSE 0 END)::INTEGER AS live_churn
             FROM metrics
           )
           SELECT total_visits,open_appointments,amount_due_paise,
             COALESCE((SELECT balance_after FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND client_id IN (SELECT id FROM scope_ids) ORDER BY created_at DESC,id DESC LIMIT 1),0)::INTEGER AS reward_points_balance,
             lifetime_value_paise,average_spend_paise,highest_bill_paise,service_spend_paise,product_spend_paise,favourite_services,preferred_staff_name,
             visit_frequency_days,inactive_days,no_show_rate_bps,cancellation_rate_bps,
             CASE WHEN snapshot_date=CURRENT_DATE THEN snapshot_churn ELSE live_churn END AS churn_risk_score,review_sentiment,
             CASE WHEN occasion_opportunity<>'' THEN 'Prepare occasion outreach' WHEN inactive_days>=90 THEN 'Start win-back outreach' WHEN live_churn>=70 THEN 'Start retention outreach' WHEN amount_due_paise>0 THEN 'Recover outstanding balance' WHEN open_appointments=0 THEN 'Book next appointment' ELSE 'Maintain relationship' END AS next_best_action,
             CASE WHEN occasion_opportunity<>'' THEN occasion_opportunity WHEN inactive_days>=90 THEN inactive_days || ' inactive days' WHEN live_churn>=70 THEN 'Churn risk score ' || live_churn WHEN amount_due_paise>0 THEN 'Outstanding balance is pending' WHEN open_appointments=0 THEN 'No upcoming appointment' ELSE 'Client is active with an upcoming appointment' END AS next_best_action_reason,
             occasion_opportunity,COALESCE(segment,'Not calculated') AS rfm_segment,COALESCE(rfm_score,0)::INTEGER AS rfm_score,calculated_at AS intelligence_calculated_at
           FROM scored"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_one(db)
    .await
}

const REFRESH_INTELLIGENCE_SQL: &str = r#"WITH appointment_data AS (
             SELECT client.tenant_id,client.branch_id,client.id AS client_id,
                    GREATEST(CURRENT_DATE-COALESCE(MAX(appointment.start_at) FILTER (WHERE appointment.status IN ('completed','billed','paid'))::DATE,client.created_at::DATE),0)::INTEGER AS recency_days,
                    COUNT(appointment.id) FILTER (WHERE appointment.status IN ('completed','billed','paid'))::BIGINT AS frequency_count,
                    COUNT(appointment.id)::BIGINT AS appointment_count,
                    COUNT(appointment.id) FILTER (WHERE appointment.status IN ('no-show','cancelled'))::BIGINT AS risk_count
               FROM clients client LEFT JOIN appointments appointment ON appointment.tenant_id=client.tenant_id AND appointment.branch_id=client.branch_id AND appointment.client_id=client.id
              WHERE client.active=TRUE AND client.merged_into_client_id IS NULL
                AND ($1='' OR client.tenant_id=$1) AND ($2='' OR client.branch_id=$2)
              GROUP BY client.tenant_id,client.branch_id,client.id,client.created_at
           ), base AS (
             SELECT appointment_data.*,
                    COALESCE(SUM(sale.total_paise) FILTER (WHERE sale.status NOT IN ('draft','cancelled','voided','refunded')),0)::BIGINT AS monetary_paise
               FROM appointment_data LEFT JOIN pos_sales sale ON sale.tenant_id=appointment_data.tenant_id AND sale.branch_id=appointment_data.branch_id AND sale.client_id=appointment_data.client_id
              GROUP BY appointment_data.tenant_id,appointment_data.branch_id,appointment_data.client_id,appointment_data.recency_days,appointment_data.frequency_count,appointment_data.appointment_count,appointment_data.risk_count
           ), ranked AS (
             SELECT base.*,
                    (6-NTILE(5) OVER (PARTITION BY tenant_id,branch_id ORDER BY recency_days ASC))::SMALLINT AS recency_score,
                    NTILE(5) OVER (PARTITION BY tenant_id,branch_id ORDER BY frequency_count)::SMALLINT AS frequency_score,
                    NTILE(5) OVER (PARTITION BY tenant_id,branch_id ORDER BY monetary_paise)::SMALLINT AS monetary_score
               FROM base
           ), scored AS (
             SELECT ranked.*,(recency_score+frequency_score+monetary_score)::SMALLINT AS rfm_score,
                    LEAST(100,LEAST(60,(recency_days*60/180)::INTEGER)+LEAST(25,CASE WHEN appointment_count=0 THEN 0 ELSE (risk_count*2500/appointment_count)::INTEGER END)+CASE WHEN frequency_count<=1 THEN 15 ELSE 0 END)::SMALLINT AS churn_risk_score
               FROM ranked
           )
           INSERT INTO client_intelligence_snapshots(tenant_id,branch_id,client_id,snapshot_date,recency_days,frequency_count,monetary_paise,recency_score,frequency_score,monetary_score,rfm_score,segment,churn_risk_score,calculated_at)
           SELECT tenant_id,branch_id,client_id,CURRENT_DATE,recency_days,frequency_count,monetary_paise,recency_score,frequency_score,monetary_score,rfm_score,
                  CASE WHEN monetary_score=5 AND frequency_score>=4 THEN 'VIP' WHEN recency_score>=4 AND frequency_score>=4 AND monetary_score>=4 THEN 'Champion' WHEN recency_days>=365 THEN 'Churned' WHEN recency_days>=180 THEN 'Lapsed' WHEN recency_days>=90 OR churn_risk_score>=70 THEN 'At risk' WHEN frequency_count<=1 AND recency_days<=60 THEN 'New client' WHEN frequency_score>=4 THEN 'Loyal' ELSE 'Potential loyalist' END,
                  churn_risk_score,NOW() FROM scored
           ON CONFLICT(tenant_id,branch_id,client_id,snapshot_date) DO UPDATE SET recency_days=EXCLUDED.recency_days,frequency_count=EXCLUDED.frequency_count,monetary_paise=EXCLUDED.monetary_paise,recency_score=EXCLUDED.recency_score,frequency_score=EXCLUDED.frequency_score,monetary_score=EXCLUDED.monetary_score,rfm_score=EXCLUDED.rfm_score,segment=EXCLUDED.segment,churn_risk_score=EXCLUDED.churn_risk_score,calculated_at=NOW()"#;

pub async fn refresh_intelligence_snapshots(db: &PgPool) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(REFRESH_INTELLIGENCE_SQL)
        .bind("")
        .bind("")
        .execute(db)
        .await?
        .rows_affected())
}

pub async fn rebuild_client_intelligence(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND merged_into_client_id IS NULL)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        return Ok(false);
    }

    let refreshed = sqlx::query(REFRESH_INTELLIGENCE_SQL)
        .bind(tenant_id)
        .bind(branch_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    record_audit_tx(
        &mut tx,
        tenant_id,
        branch_id,
        client_id,
        "client.memory_graph.rebuilt",
        actor,
        serde_json::json!({"refreshedClients": refreshed}),
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn client_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    report_type: &str,
    filters: ClientReportFilters<'_>,
) -> Result<Value, sqlx::Error> {
    let sql = match report_type {
        "best-clients" => {
            r#"WITH latest AS (
             SELECT DISTINCT ON (client_id) client_id,recency_days,frequency_count,monetary_paise,rfm_score,segment,churn_risk_score,calculated_at
               FROM client_intelligence_snapshots
              WHERE tenant_id=$1 AND branch_id=$2
              ORDER BY client_id,snapshot_date DESC
           ), visits AS (
             SELECT client_id,COUNT(*) FILTER (WHERE status IN ('completed','billed','paid'))::BIGINT AS total_visits,
                    MAX(start_at) FILTER (WHERE status IN ('completed','billed','paid')) AS last_visit_at
               FROM appointments
              WHERE tenant_id=$1 AND branch_id=$2
              GROUP BY client_id
           ), sales AS (
             SELECT client_id,COUNT(*)::BIGINT AS invoice_count,
                    COALESCE(SUM(total_paise),0)::BIGINT AS lifetime_value_paise,
                    COALESCE(ROUND(AVG(total_paise)),0)::BIGINT AS average_spend_paise,
                    COALESCE(MAX(total_paise),0)::BIGINT AS highest_bill_paise,
                    COALESCE(SUM(GREATEST(total_paise-paid_paise,0)),0)::BIGINT AS unpaid_paise,
                    MAX(created_at) AS last_sale_at
               FROM pos_sales
              WHERE tenant_id=$1 AND branch_id=$2 AND status NOT IN ('draft','cancelled','voided','refunded')
              GROUP BY client_id
           ), favourite AS (
             SELECT client_id,item_name AS favourite_service
               FROM (
                 SELECT sale.client_id,line.item_name,SUM(line.quantity)::BIGINT AS uses,
                        ROW_NUMBER() OVER (PARTITION BY sale.client_id ORDER BY SUM(line.quantity) DESC,line.item_name) AS row_number
                   FROM pos_sales sale
                   JOIN pos_sale_lines line ON line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id AND line.line_type='service'
                  WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.status NOT IN ('draft','cancelled','voided','refunded')
                  GROUP BY sale.client_id,line.item_name
               ) ranked WHERE row_number=1
           )
           SELECT COALESCE(JSONB_AGG(row_json),'[]'::JSONB)
             FROM (
               SELECT JSONB_BUILD_OBJECT(
                 'clientId',client.id,
                 'clientName',CONCAT_WS(' ',client.first_name,client.last_name),
                 'phone',client.phone,
                 'segment',COALESCE(latest.segment,'Not calculated'),
                 'rfmScore',COALESCE(latest.rfm_score,0),
                 'lifetimeValuePaise',COALESCE(sales.lifetime_value_paise,0),
                 'averageSpendPaise',COALESCE(sales.average_spend_paise,0),
                 'highestBillPaise',COALESCE(sales.highest_bill_paise,0),
                 'totalVisits',COALESCE(visits.total_visits,0),
                 'lastVisitAt',visits.last_visit_at,
                 'favouriteService',COALESCE(favourite.favourite_service,''),
                 'churnRiskScore',COALESCE(latest.churn_risk_score,0),
                 'unpaidPaise',COALESCE(sales.unpaid_paise,0),
                 'invoiceCount',COALESCE(sales.invoice_count,0),
                 'calculatedAt',latest.calculated_at
               ) AS row_json
               FROM clients client
               LEFT JOIN latest ON latest.client_id=client.id
               LEFT JOIN visits ON visits.client_id=client.id
               LEFT JOIN sales ON sales.client_id=client.id
               LEFT JOIN favourite ON favourite.client_id=client.id
              WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.active=TRUE AND client.merged_into_client_id IS NULL
                AND COALESCE(sales.lifetime_value_paise,0)>=$3
                AND COALESCE(visits.total_visits,0)>=$4
                AND ($5='' OR LOWER(COALESCE(latest.segment,'Not calculated'))=LOWER($5))
                AND COALESCE(latest.churn_risk_score,0)<=$6
                AND ($7 OR COALESCE(sales.unpaid_paise,0)=0)
                AND ($8<=0 OR COALESCE(visits.last_visit_at,sales.last_sale_at,client.created_at)>=CURRENT_DATE-($8::INT * INTERVAL '1 day'))
              ORDER BY COALESCE(latest.rfm_score,0) DESC,
                       COALESCE(sales.lifetime_value_paise,0) DESC,
                       COALESCE(visits.last_visit_at,sales.last_sale_at,client.created_at) DESC,
                       COALESCE(sales.unpaid_paise,0) ASC,
                       client.id
              LIMIT $9
             ) rows"#
        }
        "rfm" => {
            r#"WITH latest AS (SELECT DISTINCT ON (client_id) client_id,recency_days,frequency_count,monetary_paise,rfm_score,segment,churn_risk_score,calculated_at FROM client_intelligence_snapshots WHERE tenant_id=$1 AND branch_id=$2 ORDER BY client_id,snapshot_date DESC)
          SELECT COALESCE(JSONB_AGG(row_json),'[]'::JSONB) FROM (SELECT JSONB_BUILD_OBJECT('clientId',client.id,'clientName',CONCAT_WS(' ',client.first_name,client.last_name),'recencyDays',latest.recency_days,'frequency',latest.frequency_count,'monetaryPaise',latest.monetary_paise,'rfmScore',latest.rfm_score,'segment',latest.segment,'churnRiskScore',latest.churn_risk_score,'calculatedAt',latest.calculated_at) AS row_json FROM latest JOIN clients client ON client.tenant_id=$1 AND client.branch_id=$2 AND client.id=latest.client_id WHERE $3>=0 ORDER BY latest.rfm_score DESC,latest.monetary_paise DESC LIMIT $4) rows"#
        }
        "lapsed" => {
            r#"WITH latest AS (SELECT DISTINCT ON (client_id) client_id,recency_days,frequency_count,monetary_paise,segment,churn_risk_score FROM client_intelligence_snapshots WHERE tenant_id=$1 AND branch_id=$2 ORDER BY client_id,snapshot_date DESC)
          SELECT COALESCE(JSONB_AGG(row_json),'[]'::JSONB) FROM (SELECT JSONB_BUILD_OBJECT('clientId',client.id,'clientName',CONCAT_WS(' ',client.first_name,client.last_name),'phone',client.phone,'recencyDays',latest.recency_days,'lifetimeValuePaise',latest.monetary_paise,'segment',latest.segment,'churnRiskScore',latest.churn_risk_score) AS row_json FROM latest JOIN clients client ON client.tenant_id=$1 AND client.branch_id=$2 AND client.id=latest.client_id WHERE latest.recency_days>=$3 ORDER BY latest.recency_days DESC LIMIT $4) rows"#
        }
        "new-returning" => {
            r#"WITH period_visits AS (SELECT client_id,MIN(start_at) AS first_period_visit FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND start_at>=CURRENT_DATE-MAKE_INTERVAL(days=>$3) AND status IN ('completed','billed','paid') GROUP BY client_id), classified AS (SELECT period_visits.client_id,EXISTS(SELECT 1 FROM appointments previous WHERE previous.tenant_id=$1 AND previous.branch_id=$2 AND previous.client_id=period_visits.client_id AND previous.start_at<period_visits.first_period_visit AND previous.status IN ('completed','billed','paid')) AS is_returning FROM period_visits), totals AS (SELECT COUNT(*) FILTER (WHERE NOT is_returning)::BIGINT AS new_clients,COUNT(*) FILTER (WHERE is_returning)::BIGINT AS returning_clients FROM classified) SELECT JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('days',$3,'newClients',new_clients,'returningClients',returning_clients)) FROM totals WHERE $4>0"#
        }
        "occasions" => {
            r#"SELECT COALESCE(JSONB_AGG(row_json),'[]'::JSONB) FROM (SELECT JSONB_BUILD_OBJECT('clientId',client.id,'clientName',CONCAT_WS(' ',client.first_name,client.last_name),'phone',client.phone,'occasionType',occasion.occasion_type,'occasionDate',occasion.occasion_date) AS row_json FROM clients client CROSS JOIN LATERAL (SELECT 'Birthday'::TEXT AS occasion_type,CASE WHEN this_year<CURRENT_DATE THEN (this_year+INTERVAL '1 year')::DATE ELSE this_year END AS occasion_date FROM (SELECT (client.birthday+MAKE_INTERVAL(years=>EXTRACT(YEAR FROM CURRENT_DATE)::INT-EXTRACT(YEAR FROM client.birthday)::INT))::DATE AS this_year) date_value WHERE client.birthday IS NOT NULL UNION ALL SELECT 'Anniversary',CASE WHEN this_year<CURRENT_DATE THEN (this_year+INTERVAL '1 year')::DATE ELSE this_year END FROM (SELECT (client.anniversary+MAKE_INTERVAL(years=>EXTRACT(YEAR FROM CURRENT_DATE)::INT-EXTRACT(YEAR FROM client.anniversary)::INT))::DATE AS this_year) date_value WHERE client.anniversary IS NOT NULL) occasion WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.active=TRUE AND client.merged_into_client_id IS NULL AND occasion.occasion_date BETWEEN CURRENT_DATE AND CURRENT_DATE+MAKE_INTERVAL(days=>$3) ORDER BY occasion.occasion_date,client.id LIMIT $4) rows"#
        }
        "service-wise" => {
            r#"SELECT COALESCE(JSONB_AGG(row_json),'[]'::JSONB) FROM (SELECT JSONB_BUILD_OBJECT('serviceId',line.item_id,'serviceName',line.item_name,'clientCount',COUNT(DISTINCT sale.client_id),'visits',SUM(line.quantity),'revenuePaise',SUM(line.line_total_paise)) AS row_json FROM pos_sales sale JOIN pos_sale_lines line ON line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id AND line.line_type='service' WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.created_at>=CURRENT_DATE-MAKE_INTERVAL(days=>$3) AND sale.status NOT IN ('draft','cancelled','voided','refunded') GROUP BY line.item_id,line.item_name ORDER BY SUM(line.line_total_paise) DESC LIMIT $4) rows"#
        }
        "revenue" => {
            r#"SELECT COALESCE(JSONB_AGG(row_json),'[]'::JSONB) FROM (SELECT JSONB_BUILD_OBJECT('clientId',client.id,'clientName',CONCAT_WS(' ',client.first_name,client.last_name),'invoiceCount',COUNT(sale.id),'revenuePaise',COALESCE(SUM(sale.total_paise),0),'averageSpendPaise',COALESCE(ROUND(AVG(sale.total_paise)),0),'highestBillPaise',COALESCE(MAX(sale.total_paise),0)) AS row_json FROM clients client JOIN pos_sales sale ON sale.tenant_id=client.tenant_id AND sale.branch_id=client.branch_id AND sale.client_id=client.id WHERE client.tenant_id=$1 AND client.branch_id=$2 AND sale.created_at>=CURRENT_DATE-MAKE_INTERVAL(days=>$3) AND sale.status NOT IN ('draft','cancelled','voided','refunded') GROUP BY client.id ORDER BY SUM(sale.total_paise) DESC LIMIT $4) rows"#
        }
        _ => unreachable!("report type is validated by route"),
    };
    let mut query = sqlx::query_scalar(sql).bind(tenant_id).bind(branch_id);
    if report_type == "best-clients" {
        query = query
            .bind(filters.min_lifetime_value_paise)
            .bind(filters.min_visits)
            .bind(filters.segment)
            .bind(filters.max_churn_risk_score)
            .bind(filters.include_unpaid)
            .bind(filters.days)
            .bind(filters.limit);
    } else {
        query = query.bind(filters.days).bind(filters.limit);
    }
    query.fetch_one(db).await
}

const MASTER_COLUMNS: &str = "id,kind,code,name,description,definition_json,status,version,created_by,updated_by,created_at,updated_at";
const DISCOUNT_RULE_COLUMNS: &str = "id,name,segments,service_categories,min_lifetime_value_paise,max_discount_bps,clv_budget_bps,approval_above_bps,membership_eligible,wallet_eligible,active,priority,version,created_at,updated_at";
const DISCOUNT_DECISION_COLUMNS: &str = "decision.id,decision.rule_id,COALESCE(rule.name,'') AS rule_name,decision.service_category,decision.segment,decision.subtotal_paise,decision.lifetime_value_paise,decision.requested_discount_bps,decision.approved_discount_bps,decision.discount_paise,decision.remaining_clv_budget_paise,decision.has_membership,decision.has_wallet_balance,decision.status,decision.reasons_json,decision.decided_by,decision.approved_by,decision.approved_at,decision.created_at";
const WIN_BACK_COLUMNS: &str = "id,decision_id,offer_code,title,offered_discount_bps,discount_cost_paise,return_window_days,status,issued_by,issued_at,redeemed_at,redeemed_sale_id,returned_at,return_sale_id,revenue_after_return_paise,offer_roi_bps,updated_at";

pub async fn list_client_masters(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    kind: &str,
) -> Result<Vec<ClientMasterRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {MASTER_COLUMNS} FROM client_master_definitions WHERE tenant_id=$1 AND branch_id=$2 AND kind=$3 ORDER BY status='archived',name"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(kind)
    .fetch_all(db)
    .await
}

pub async fn create_client_master(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: ClientMasterWrite<'_>,
) -> Result<ClientMasterRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row: ClientMasterRecord = sqlx::query_as(&format!(
        "INSERT INTO client_master_definitions(tenant_id,branch_id,kind,code,name,description,definition_json,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING {MASTER_COLUMNS}"
    ))
    .bind(tenant_id).bind(branch_id).bind(input.kind).bind(input.code).bind(input.name)
    .bind(input.description).bind(input.definition).bind(input.status).bind(input.actor)
    .fetch_one(&mut *tx).await?;
    let after = serde_json::to_value(&row).unwrap_or(Value::Null);
    sqlx::query("INSERT INTO client_master_audit_events(tenant_id,branch_id,master_id,action,version,after_json,actor_user_id) VALUES($1,$2,$3,'created',$4,$5,$6)")
        .bind(tenant_id).bind(branch_id).bind(&row.id).bind(row.version).bind(after).bind(input.actor)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn update_client_master(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    expected_version: i32,
    input: ClientMasterWrite<'_>,
) -> Result<Option<ClientMasterRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let before: Option<Value> = sqlx::query_scalar("SELECT TO_JSONB(master) FROM client_master_definitions master WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND kind=$5 FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(id).bind(expected_version).bind(input.kind).fetch_optional(&mut *tx).await?;
    let Some(before) = before else {
        return Ok(None);
    };
    let row: ClientMasterRecord = sqlx::query_as(&format!(
        "UPDATE client_master_definitions SET kind=$5,code=$6,name=$7,description=$8,definition_json=$9,status=$10,version=version+1,updated_by=$11,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 RETURNING {MASTER_COLUMNS}"
    ))
    .bind(tenant_id).bind(branch_id).bind(id).bind(expected_version).bind(input.kind).bind(input.code)
    .bind(input.name).bind(input.description).bind(input.definition).bind(input.status).bind(input.actor)
    .fetch_one(&mut *tx).await?;
    let after = serde_json::to_value(&row).unwrap_or(Value::Null);
    sqlx::query("INSERT INTO client_master_audit_events(tenant_id,branch_id,master_id,action,version,before_json,after_json,actor_user_id) VALUES($1,$2,$3,'updated',$4,$5,$6,$7)")
        .bind(tenant_id).bind(branch_id).bind(id).bind(row.version).bind(before).bind(after).bind(input.actor)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Some(row))
}

pub async fn list_client_master_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    kind: &str,
) -> Result<Vec<ClientMasterAuditRecord>, sqlx::Error> {
    sqlx::query_as("SELECT audit.id,audit.master_id,master.name AS master_name,audit.action,audit.version,audit.before_json,audit.after_json,audit.actor_user_id,audit.created_at FROM client_master_audit_events audit JOIN client_master_definitions master ON master.id=audit.master_id AND master.tenant_id=audit.tenant_id AND master.branch_id=audit.branch_id WHERE audit.tenant_id=$1 AND audit.branch_id=$2 AND master.kind=$3 ORDER BY audit.created_at DESC LIMIT 100")
        .bind(tenant_id).bind(branch_id).bind(kind).fetch_all(db).await
}

pub async fn client_master_summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ClientMasterSummaryRecord>, sqlx::Error> {
    sqlx::query_as("SELECT kind,status,COUNT(*)::BIGINT AS count FROM client_master_definitions WHERE tenant_id=$1 AND branch_id=$2 GROUP BY kind,status ORDER BY kind,status")
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_all(db)
        .await
}

pub async fn get_client_custom_form_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT settings_json FROM client_custom_form_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn save_client_custom_form_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    settings: &Value,
    actor: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO client_custom_form_settings(tenant_id,branch_id,settings_json,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET settings_json=EXCLUDED.settings_json,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING settings_json")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(settings)
        .bind(actor)
        .fetch_one(db)
        .await
}

pub async fn list_discount_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    active_only: bool,
) -> Result<Vec<ClientDiscountRuleRecord>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {DISCOUNT_RULE_COLUMNS} FROM client_discount_rules WHERE tenant_id=$1 AND branch_id=$2 AND (NOT $3 OR active=TRUE) ORDER BY priority,created_at"))
        .bind(tenant_id).bind(branch_id).bind(active_only).fetch_all(db).await
}

pub async fn create_discount_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: ClientDiscountRuleWrite<'_>,
) -> Result<ClientDiscountRuleRecord, sqlx::Error> {
    sqlx::query_as(&format!("INSERT INTO client_discount_rules(tenant_id,branch_id,name,segments,service_categories,min_lifetime_value_paise,max_discount_bps,clv_budget_bps,approval_above_bps,membership_eligible,wallet_eligible,active,priority,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING {DISCOUNT_RULE_COLUMNS}"))
        .bind(tenant_id).bind(branch_id).bind(input.name).bind(input.segments).bind(input.service_categories)
        .bind(input.min_lifetime_value_paise).bind(input.max_discount_bps).bind(input.clv_budget_bps)
        .bind(input.approval_above_bps).bind(input.membership_eligible).bind(input.wallet_eligible)
        .bind(input.active).bind(input.priority).bind(input.actor).fetch_one(db).await
}

pub async fn update_discount_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    expected_version: i32,
    input: ClientDiscountRuleWrite<'_>,
) -> Result<Option<ClientDiscountRuleRecord>, sqlx::Error> {
    sqlx::query_as(&format!("UPDATE client_discount_rules SET name=$5,segments=$6,service_categories=$7,min_lifetime_value_paise=$8,max_discount_bps=$9,clv_budget_bps=$10,approval_above_bps=$11,membership_eligible=$12,wallet_eligible=$13,active=$14,priority=$15,version=version+1,updated_by=$16,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 RETURNING {DISCOUNT_RULE_COLUMNS}"))
        .bind(tenant_id).bind(branch_id).bind(id).bind(expected_version).bind(input.name)
        .bind(input.segments).bind(input.service_categories).bind(input.min_lifetime_value_paise)
        .bind(input.max_discount_bps).bind(input.clv_budget_bps).bind(input.approval_above_bps)
        .bind(input.membership_eligible).bind(input.wallet_eligible).bind(input.active).bind(input.priority)
        .bind(input.actor).fetch_optional(db).await
}

pub async fn discount_context(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Option<ClientDiscountContext>, sqlx::Error> {
    sqlx::query_as(r#"WITH latest AS (
          SELECT segment,monetary_paise,rfm_score,recency_days,churn_risk_score FROM client_intelligence_snapshots
           WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY snapshot_date DESC LIMIT 1
        )
        SELECT client.id AS client_id,COALESCE(latest.segment,'New client') AS segment,
               COALESCE(latest.monetary_paise,0)::BIGINT AS lifetime_value_paise,
               COALESCE(latest.rfm_score,0)::INTEGER AS rfm_score,
               COALESCE(latest.recency_days,0)::INTEGER AS inactive_days,
               COALESCE(latest.churn_risk_score,0)::INTEGER AS churn_risk_score,
               EXISTS(SELECT 1 FROM client_memberships membership WHERE membership.tenant_id=$1 AND membership.branch_id=$2 AND membership.client_id=client.id AND membership.active=TRUE AND (membership.expires_at IS NULL OR membership.expires_at>=NOW())) AS has_membership,
               client.wallet_balance_paise>0 AS has_wallet_balance,
               COALESCE((SELECT SUM(decision.discount_paise) FROM client_discount_decisions decision WHERE decision.tenant_id=$1 AND decision.branch_id=$2 AND decision.client_id=client.id AND decision.status='approved'),0)::BIGINT AS approved_discount_spend_paise
          FROM clients client LEFT JOIN latest ON TRUE
         WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$3 AND client.merged_into_client_id IS NULL"#)
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_optional(db).await
}

pub async fn create_discount_decision(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: ClientDiscountDecisionWrite<'_>,
) -> Result<ClientDiscountDecisionRecord, sqlx::Error> {
    sqlx::query_as(&format!("WITH inserted AS (INSERT INTO client_discount_decisions(tenant_id,branch_id,client_id,rule_id,service_category,segment,subtotal_paise,lifetime_value_paise,requested_discount_bps,approved_discount_bps,discount_paise,remaining_clv_budget_paise,has_membership,has_wallet_balance,status,reasons_json,decided_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *) SELECT {DISCOUNT_DECISION_COLUMNS} FROM inserted decision LEFT JOIN client_discount_rules rule ON rule.id=decision.rule_id"))
        .bind(tenant_id).bind(branch_id).bind(input.client_id).bind(input.rule_id).bind(input.service_category)
        .bind(input.segment).bind(input.subtotal_paise).bind(input.lifetime_value_paise)
        .bind(input.requested_discount_bps).bind(input.approved_discount_bps).bind(input.discount_paise)
        .bind(input.remaining_clv_budget_paise).bind(input.has_membership).bind(input.has_wallet_balance)
        .bind(input.status).bind(input.reasons).bind(input.actor).fetch_one(db).await
}

pub async fn list_discount_decisions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientDiscountDecisionRecord>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {DISCOUNT_DECISION_COLUMNS} FROM client_discount_decisions decision LEFT JOIN client_discount_rules rule ON rule.id=decision.rule_id WHERE decision.tenant_id=$1 AND decision.branch_id=$2 AND decision.client_id=$3 ORDER BY decision.created_at DESC LIMIT 100"))
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

pub async fn approve_discount_decision(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
) -> Result<Option<ClientDiscountDecisionRecord>, sqlx::Error> {
    sqlx::query_as(&format!("WITH changed AS (UPDATE client_discount_decisions SET status='approved',approved_by=$4,approved_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='approval_required' RETURNING *) SELECT {DISCOUNT_DECISION_COLUMNS} FROM changed decision LEFT JOIN client_discount_rules rule ON rule.id=decision.rule_id"))
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor).fetch_optional(db).await
}

pub async fn custom_segments(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    context: &ClientDiscountContext,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(r#"SELECT name FROM client_master_definitions
        WHERE tenant_id=$1 AND branch_id=$2 AND kind='custom-segments' AND status='active'
          AND (NOT (definition_json?'minLifetimeValuePaise') OR ((definition_json->>'minLifetimeValuePaise')~'^[0-9]+$' AND (definition_json->>'minLifetimeValuePaise')::BIGINT<=$3))
          AND (NOT (definition_json?'minRfmScore') OR ((definition_json->>'minRfmScore')~'^[0-9]+$' AND (definition_json->>'minRfmScore')::INTEGER<=$4))
          AND (NOT (definition_json?'maxInactiveDays') OR ((definition_json->>'maxInactiveDays')~'^[0-9]+$' AND (definition_json->>'maxInactiveDays')::INTEGER>=$5))
          AND (NOT (definition_json?'minChurnRiskScore') OR ((definition_json->>'minChurnRiskScore')~'^[0-9]+$' AND (definition_json->>'minChurnRiskScore')::INTEGER<=$6))
        ORDER BY name"#)
        .bind(tenant_id).bind(branch_id).bind(context.lifetime_value_paise).bind(context.rfm_score)
        .bind(context.inactive_days).bind(context.churn_risk_score).fetch_all(db).await
}

pub async fn create_win_back_offer(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: ClientWinBackOfferWrite<'_>,
) -> Result<Option<ClientWinBackOfferRecord>, sqlx::Error> {
    sqlx::query_as(&format!("INSERT INTO client_win_back_offers(tenant_id,branch_id,client_id,decision_id,offer_code,title,offered_discount_bps,discount_cost_paise,return_window_days,issued_by) SELECT $1,$2,client.id,$4,$5,$6,$7,$8,$9,$10 FROM clients client WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$3 AND client.merged_into_client_id IS NULL AND ($4 IS NULL OR EXISTS(SELECT 1 FROM client_discount_decisions decision WHERE decision.tenant_id=$1 AND decision.branch_id=$2 AND decision.client_id=client.id AND decision.id=$4)) RETURNING {WIN_BACK_COLUMNS}"))
        .bind(tenant_id).bind(branch_id).bind(input.client_id).bind(input.decision_id).bind(input.offer_code)
        .bind(input.title).bind(input.offered_discount_bps).bind(input.discount_cost_paise)
        .bind(input.return_window_days).bind(input.actor).fetch_optional(db).await
}

pub async fn redeem_win_back_offer(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    offer_id: &str,
    client_id: &str,
    sale_id: &str,
) -> Result<Option<ClientWinBackOfferRecord>, sqlx::Error> {
    sqlx::query_as(&format!(r#"UPDATE client_win_back_offers offer SET
          status=CASE WHEN $5='' THEN 'redeemed' ELSE 'returned' END,
          redeemed_at=NOW(),redeemed_sale_id=NULLIF($5,''),
          returned_at=CASE WHEN $5='' THEN NULL ELSE (SELECT sale.created_at FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.id=$5) END,
          return_sale_id=NULLIF($5,''),
          revenue_after_return_paise=CASE WHEN $5='' THEN 0 ELSE (SELECT sale.total_paise FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.id=$5) END,
          offer_roi_bps=CASE WHEN $5='' OR offer.discount_cost_paise=0 THEN 0 ELSE (((SELECT sale.total_paise FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.id=$5)-offer.discount_cost_paise)*10000/offer.discount_cost_paise) END,
          updated_at=NOW()
        WHERE offer.tenant_id=$1 AND offer.branch_id=$2 AND offer.id=$3 AND offer.client_id=$4 AND offer.status='issued'
          AND ($5='' OR EXISTS(SELECT 1 FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.id=$5 AND sale.client_id=offer.client_id AND sale.status NOT IN ('draft','cancelled','voided','refunded')))
        RETURNING {WIN_BACK_COLUMNS}"#))
        .bind(tenant_id).bind(branch_id).bind(offer_id).bind(client_id).bind(sale_id).fetch_optional(db).await
}

pub async fn list_win_back_offers(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientWinBackOfferRecord>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {WIN_BACK_COLUMNS} FROM client_win_back_offers WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY issued_at DESC LIMIT 100"))
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

pub async fn win_back_summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(r#"SELECT JSONB_BUILD_OBJECT(
          'issuedCount',COUNT(*),'redeemedCount',COUNT(*) FILTER(WHERE status IN ('redeemed','returned')),
          'returnedCount',COUNT(*) FILTER(WHERE status='returned'),
          'winBackSuccessRateBps',CASE WHEN COUNT(*)=0 THEN 0 ELSE COUNT(*) FILTER(WHERE status='returned')*10000/COUNT(*) END,
          'revenueAfterReturnPaise',COALESCE(SUM(revenue_after_return_paise),0),
          'discountCostPaise',COALESCE(SUM(discount_cost_paise),0),
          'offerRoiBps',CASE WHEN COALESCE(SUM(discount_cost_paise),0)=0 THEN 0 ELSE (SUM(revenue_after_return_paise)-SUM(discount_cost_paise))*10000/SUM(discount_cost_paise) END)
        FROM client_win_back_offers WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3"#)
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_one(db).await
}

pub async fn branch_return_tracker(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    view: &str,
    days: i32,
    status: &str,
    limit: i64,
    offset: i64,
) -> Result<Value, sqlx::Error> {
    let sql = match view {
        "summary" => {
            r#"SELECT JSONB_BUILD_OBJECT(
              'days',$3,
              'issuedCount',COUNT(*),
              'redeemedCount',COUNT(*) FILTER(WHERE offer.status IN ('redeemed','returned')),
              'returnedCount',COUNT(*) FILTER(WHERE offer.status='returned'),
              'winBackSuccessRateBps',CASE WHEN COUNT(*)=0 THEN 0 ELSE COUNT(*) FILTER(WHERE offer.status='returned')*10000/COUNT(*) END,
              'revenueAfterReturnPaise',COALESCE(SUM(offer.revenue_after_return_paise),0),
              'discountCostPaise',COALESCE(SUM(offer.discount_cost_paise),0),
              'offerRoiBps',CASE WHEN COALESCE(SUM(offer.discount_cost_paise),0)=0 THEN 0 ELSE (SUM(offer.revenue_after_return_paise)-SUM(offer.discount_cost_paise))*10000/SUM(offer.discount_cost_paise) END)
            FROM client_win_back_offers offer
           WHERE offer.tenant_id=$1 AND offer.branch_id=$2
             AND offer.issued_at>=NOW()-MAKE_INTERVAL(days=>$3)
             AND ($4='' OR offer.status=$4) AND $5>0 AND $6>=0"#
        }
        "clients" => {
            r#"SELECT COALESCE(JSONB_AGG(row_json),'[]'::JSONB) FROM (
            SELECT JSONB_BUILD_OBJECT(
              'clientId',client.id,'clientName',CONCAT_WS(' ',client.first_name,client.last_name),
              'offerCount',COUNT(*),'redeemedCount',COUNT(*) FILTER(WHERE offer.status IN ('redeemed','returned')),
              'returnedCount',COUNT(*) FILTER(WHERE offer.status='returned'),
              'revenueAfterReturnPaise',COALESCE(SUM(offer.revenue_after_return_paise),0),
              'discountCostPaise',COALESCE(SUM(offer.discount_cost_paise),0),
              'offerRoiBps',CASE WHEN COALESCE(SUM(offer.discount_cost_paise),0)=0 THEN 0 ELSE (SUM(offer.revenue_after_return_paise)-SUM(offer.discount_cost_paise))*10000/SUM(offer.discount_cost_paise) END
            ) AS row_json
              FROM client_win_back_offers offer
              JOIN clients client ON client.tenant_id=offer.tenant_id AND client.branch_id=offer.branch_id AND client.id=offer.client_id
             WHERE offer.tenant_id=$1 AND offer.branch_id=$2
               AND offer.issued_at>=NOW()-MAKE_INTERVAL(days=>$3)
               AND ($4='' OR offer.status=$4)
             GROUP BY client.id,client.first_name,client.last_name
             ORDER BY COUNT(*) FILTER(WHERE offer.status='returned') DESC,COALESCE(SUM(offer.revenue_after_return_paise),0) DESC,client.id
             LIMIT $5 OFFSET $6
          ) rows"#
        }
        "offers" => {
            r#"SELECT COALESCE(JSONB_AGG(row_json),'[]'::JSONB) FROM (
            SELECT JSONB_BUILD_OBJECT(
              'offerId',offer.id,'clientId',client.id,'clientName',CONCAT_WS(' ',client.first_name,client.last_name),
              'offerCode',offer.offer_code,'title',offer.title,'status',offer.status,
              'offeredDiscountBps',offer.offered_discount_bps,'discountCostPaise',offer.discount_cost_paise,
              'returnWindowDays',offer.return_window_days,'issuedAt',offer.issued_at,'redeemedAt',offer.redeemed_at,
              'returnedAt',offer.returned_at,'revenueAfterReturnPaise',offer.revenue_after_return_paise,'offerRoiBps',offer.offer_roi_bps
            ) AS row_json
              FROM client_win_back_offers offer
              JOIN clients client ON client.tenant_id=offer.tenant_id AND client.branch_id=offer.branch_id AND client.id=offer.client_id
             WHERE offer.tenant_id=$1 AND offer.branch_id=$2
               AND offer.issued_at>=NOW()-MAKE_INTERVAL(days=>$3)
               AND ($4='' OR offer.status=$4)
             ORDER BY offer.issued_at DESC,offer.id DESC LIMIT $5 OFFSET $6
          ) rows"#
        }
        "roi" => {
            r#"SELECT COALESCE(JSONB_AGG(row_json),'[]'::JSONB) FROM (
            SELECT JSONB_BUILD_OBJECT(
              'periodStart',DATE_TRUNC('month',offer.issued_at)::DATE,
              'issuedCount',COUNT(*),'returnedCount',COUNT(*) FILTER(WHERE offer.status='returned'),
              'revenueAfterReturnPaise',COALESCE(SUM(offer.revenue_after_return_paise),0),
              'discountCostPaise',COALESCE(SUM(offer.discount_cost_paise),0),
              'offerRoiBps',CASE WHEN COALESCE(SUM(offer.discount_cost_paise),0)=0 THEN 0 ELSE (SUM(offer.revenue_after_return_paise)-SUM(offer.discount_cost_paise))*10000/SUM(offer.discount_cost_paise) END
            ) AS row_json
              FROM client_win_back_offers offer
             WHERE offer.tenant_id=$1 AND offer.branch_id=$2
               AND offer.issued_at>=NOW()-MAKE_INTERVAL(days=>$3)
               AND ($4='' OR offer.status=$4)
             GROUP BY DATE_TRUNC('month',offer.issued_at)
             ORDER BY DATE_TRUNC('month',offer.issued_at) DESC LIMIT $5 OFFSET $6
          ) rows"#
        }
        _ => unreachable!("return tracker view is validated by route"),
    };
    sqlx::query_scalar(sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(days)
        .bind(status)
        .bind(limit)
        .bind(offset)
        .fetch_one(db)
        .await
}

pub async fn refresh_win_back_offers(db: &PgPool) -> Result<u64, sqlx::Error> {
    let returned = sqlx::query(r#"WITH first_return AS (
          SELECT offer.id,offer.tenant_id,offer.branch_id,offer.client_id,offer.issued_at,offer.return_window_days,offer.discount_cost_paise,sale.id AS sale_id,sale.created_at AS returned_at
            FROM client_win_back_offers offer
            JOIN LATERAL (SELECT id,created_at FROM pos_sales sale WHERE sale.tenant_id=offer.tenant_id AND sale.branch_id=offer.branch_id AND sale.client_id=offer.client_id AND sale.created_at>=offer.issued_at AND sale.created_at<=offer.issued_at+MAKE_INTERVAL(days=>offer.return_window_days) AND sale.status NOT IN ('draft','cancelled','voided','refunded') ORDER BY sale.created_at,sale.id LIMIT 1) sale ON TRUE
           WHERE offer.status IN ('issued','redeemed')
        ), totals AS (
          SELECT first_return.*,COALESCE(SUM(sale.total_paise),0)::BIGINT AS revenue
            FROM first_return LEFT JOIN pos_sales sale ON sale.tenant_id=first_return.tenant_id AND sale.branch_id=first_return.branch_id AND sale.client_id=first_return.client_id AND sale.created_at>=first_return.returned_at AND sale.created_at<=first_return.issued_at+MAKE_INTERVAL(days=>first_return.return_window_days) AND sale.status NOT IN ('draft','cancelled','voided','refunded')
           GROUP BY first_return.id,first_return.tenant_id,first_return.branch_id,first_return.client_id,first_return.issued_at,first_return.return_window_days,first_return.discount_cost_paise,first_return.sale_id,first_return.returned_at
        )
        UPDATE client_win_back_offers offer SET status='returned',returned_at=totals.returned_at,return_sale_id=totals.sale_id,revenue_after_return_paise=totals.revenue,offer_roi_bps=CASE WHEN totals.discount_cost_paise=0 THEN 0 ELSE (totals.revenue-totals.discount_cost_paise)*10000/totals.discount_cost_paise END,updated_at=NOW()
          FROM totals WHERE offer.id=totals.id"#).execute(db).await?.rows_affected();
    let expired = sqlx::query("UPDATE client_win_back_offers SET status='expired',updated_at=NOW() WHERE status IN ('issued','redeemed') AND issued_at+MAKE_INTERVAL(days=>return_window_days)<NOW()")
        .execute(db).await?.rows_affected();
    Ok(returned + expired)
}

pub async fn memory_relationships(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"WITH scope_ids AS (
             SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND (id=$3 OR merged_into_client_id=$3)
           ), selected AS (
             SELECT * FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND merged_into_client_id IS NULL
           )
           SELECT JSONB_BUILD_OBJECT(
             'products',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('productId',item_id,'name',item_name,'quantity',quantity,'spendPaise',spend)) FROM (SELECT line.item_id,line.item_name,SUM(line.quantity)::BIGINT quantity,SUM(line.line_total_paise)::BIGINT spend FROM pos_sales sale JOIN pos_sale_lines line ON line.sale_id=sale.id AND line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.client_id IN (SELECT id FROM scope_ids) AND line.line_type='product' AND sale.status NOT IN ('draft','cancelled','voided') GROUP BY line.item_id,line.item_name ORDER BY MAX(line.created_at) DESC LIMIT 100) product_rows),'[]'::JSONB),
             'staff',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('staffId',staff_id,'name',staff_name,'appointmentCount',appointment_count)) FROM (SELECT appointment.staff_id,COALESCE(NULLIF(staff.appointment_display_name,''),BTRIM(CONCAT_WS(' ',staff.first_name,staff.last_name))) staff_name,COUNT(*)::BIGINT appointment_count FROM appointments appointment LEFT JOIN staff ON staff.tenant_id=appointment.tenant_id AND staff.branch_id=appointment.branch_id AND staff.id=appointment.staff_id WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.client_id IN (SELECT id FROM scope_ids) AND appointment.staff_id<>'' GROUP BY appointment.staff_id,staff.appointment_display_name,staff.first_name,staff.last_name ORDER BY COUNT(*) DESC LIMIT 50) staff_rows),'[]'::JSONB),
             'memberships',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('clientMembershipId',cm.id,'membershipId',m.id,'name',m.name,'assignedAt',cm.assigned_at,'expiresAt',cm.expires_at,'active',cm.active) ORDER BY cm.assigned_at DESC) FROM client_memberships cm JOIN memberships m ON m.id=cm.membership_id AND m.tenant_id=cm.tenant_id AND m.branch_id=cm.branch_id WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.client_id IN (SELECT id FROM scope_ids)),'[]'::JSONB),
             'packages',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('packageId',package_id,'name',package_name,'remainingQuantity',remaining,'expiresAt',expires_at)) FROM (SELECT credit.package_id,MAX(credit.package_name) package_name,SUM(credit.remaining_qty)::BIGINT remaining,MAX(credit.expires_at) expires_at FROM client_package_credits credit WHERE credit.tenant_id=$1 AND credit.branch_id=$2 AND credit.client_id IN (SELECT id FROM scope_ids) GROUP BY credit.package_id ORDER BY MAX(credit.expires_at) DESC NULLS LAST LIMIT 100) package_rows),'[]'::JSONB),
             'complaints',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('id',note.id,'type',note.note_type,'text',note.note,'createdAt',note.created_at) ORDER BY note.created_at DESC) FROM (SELECT * FROM client_notes WHERE tenant_id=$1 AND branch_id=$2 AND client_id IN (SELECT id FROM scope_ids) AND LOWER(note_type) IN ('complaint','complaints','service-recovery') ORDER BY created_at DESC LIMIT 100) note),'[]'::JSONB),
             'preferences',JSONB_BUILD_OBJECT('preferredStaffId',selected.preferred_staff_id,'preferredChannel',selected.preferred_communication_channel,'whatsappOptIn',selected.whatsapp_opt_in,'smsOptIn',selected.sms_opt_in,'emailOptIn',selected.email_opt_in,'categories',selected.categories_json),
             'wallet',JSONB_BUILD_OBJECT('balancePaise',selected.wallet_balance_paise)
           ) FROM selected"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_optional(db)
    .await
}

pub async fn recommendation_feedback(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientRecommendationFeedbackRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,recommendation,reason,decision,comment,actor_user_id,created_at FROM client_recommendation_feedback WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY created_at DESC LIMIT 100")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_recommendation_feedback(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    recommendation: &str,
    reason: &str,
    decision: &str,
    comment: &str,
    actor: &str,
) -> Result<Option<ClientRecommendationFeedbackRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, ClientRecommendationFeedbackRecord>("INSERT INTO client_recommendation_feedback(tenant_id,branch_id,client_id,recommendation,reason,decision,comment,actor_user_id) SELECT $1,$2,id,$4,$5,$6,$7,$8 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND merged_into_client_id IS NULL RETURNING id,recommendation,reason,decision,comment,actor_user_id,created_at")
        .bind(tenant_id).bind(branch_id).bind(client_id).bind(recommendation).bind(reason).bind(decision).bind(comment).bind(actor).fetch_optional(&mut *tx).await?;
    if let Some(feedback) = &row {
        record_audit_tx(&mut tx,tenant_id,branch_id,client_id,"client.recommendation.feedback",actor,serde_json::json!({"feedbackId":feedback.id,"decision":decision,"recommendation":recommendation})).await?;
    }
    tx.commit().await?;
    Ok(row)
}

pub async fn segment_history(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientSegmentHistoryRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,previous_segment,segment,rfm_score,churn_risk_score,source_snapshot_date,changed_at FROM client_segment_history WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY changed_at DESC LIMIT 200")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

pub async fn automation_candidates(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ClientAutomationCandidate>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH active_clients AS (
             SELECT * FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND merged_into_client_id IS NULL AND ((whatsapp_opt_in IS TRUE AND phone<>'') OR (sms_opt_in IS TRUE AND phone<>'') OR (email_opt_in IS TRUE AND email<>''))
           ), latest AS (
             SELECT DISTINCT ON (client_id) client_id,recency_days FROM client_intelligence_snapshots WHERE tenant_id=$1 AND branch_id=$2 ORDER BY client_id,snapshot_date DESC
           )
           SELECT * FROM (
             SELECT client.tenant_id,client.branch_id,'occasion_campaign'::TEXT source_type,client.id||':'||TO_CHAR(day_value,'YYYY-MM-DD')||':'||occasion.kind source_id,client.id client_id,client.phone,client.email,
                    CASE occasion.kind WHEN 'birthday' THEN 'Birthday wishes from your salon. Reply to plan your next visit.' ELSE 'Anniversary wishes from your salon. Reply to plan your next visit.' END message,CONCAT_WS(' ',client.first_name,client.last_name) client_name
               FROM active_clients client CROSS JOIN LATERAL (VALUES ('birthday',client.birthday),('anniversary',client.anniversary)) occasion(kind,event_date)
               JOIN LATERAL GENERATE_SERIES(CURRENT_DATE,CURRENT_DATE+7,INTERVAL '1 day') day_value ON TO_CHAR(occasion.event_date,'MM-DD')=TO_CHAR(day_value,'MM-DD') WHERE occasion.event_date IS NOT NULL
             UNION ALL
             SELECT client.tenant_id,client.branch_id,'membership_renewal',membership.id,client.id,client.phone,client.email,'Your membership is due for renewal soon. Reply to review renewal options.',CONCAT_WS(' ',client.first_name,client.last_name)
               FROM active_clients client JOIN client_memberships membership ON membership.tenant_id=client.tenant_id AND membership.branch_id=client.branch_id AND membership.client_id=client.id AND membership.active=TRUE AND membership.expires_at BETWEEN NOW() AND NOW()+INTERVAL '30 days'
             UNION ALL
             SELECT client.tenant_id,client.branch_id,'wallet_reminder',client.id||':'||TO_CHAR(CURRENT_DATE,'YYYY-MM'),client.id,client.phone,client.email,'You have a wallet balance available for your next visit.',CONCAT_WS(' ',client.first_name,client.last_name)
               FROM active_clients client WHERE client.wallet_balance_paise>0 AND COALESCE(client.last_visit_at,client.created_at)<NOW()-INTERVAL '30 days'
             UNION ALL
             SELECT client.tenant_id,client.branch_id,'review_recovery',review.id,client.id,client.phone,client.email,'We are sorry your recent experience fell short. Reply so the team can help resolve it.',CONCAT_WS(' ',client.first_name,client.last_name)
               FROM active_clients client JOIN client_review_links review ON review.tenant_id=client.tenant_id AND review.branch_id=client.branch_id AND review.client_id=client.id AND review.rating<=2 AND COALESCE(review.reviewed_at,review.created_at)>=NOW()-INTERVAL '14 days'
             UNION ALL
             SELECT client.tenant_id,client.branch_id,'no_show_recovery',appointment.id,client.id,client.phone,client.email,'We missed you today. Reply to choose a new appointment time.',CONCAT_WS(' ',client.first_name,client.last_name)
               FROM active_clients client JOIN appointments appointment ON appointment.tenant_id=client.tenant_id AND appointment.branch_id=client.branch_id AND appointment.client_id=client.id AND appointment.status='no-show' AND appointment.updated_at>=NOW()-INTERVAL '24 hours'
               WHERE NOT EXISTS(SELECT 1 FROM appointments upcoming WHERE upcoming.tenant_id=client.tenant_id AND upcoming.branch_id=client.branch_id AND upcoming.client_id=client.id AND upcoming.start_at>NOW() AND upcoming.status NOT IN ('cancelled','no-show'))
             UNION ALL
             SELECT client.tenant_id,client.branch_id,'post_visit_thank_you',appointment.id,client.id,client.phone,client.email,'Thank you for visiting us.',CONCAT_WS(' ',client.first_name,client.last_name)
               FROM active_clients client JOIN appointments appointment ON appointment.tenant_id=client.tenant_id AND appointment.branch_id=client.branch_id AND appointment.client_id=client.id AND appointment.status IN ('completed','billed','paid') AND appointment.updated_at BETWEEN NOW()-INTERVAL '24 hours' AND NOW()-INTERVAL '30 minutes'
             UNION ALL
             SELECT client.tenant_id,client.branch_id,'new_client_second_visit',client.id||':'||TO_CHAR(CURRENT_DATE,'YYYY-MM'),client.id,client.phone,client.email,'We would love to welcome you for your next visit.',CONCAT_WS(' ',client.first_name,client.last_name)
               FROM active_clients client WHERE (SELECT COUNT(*) FROM appointments visit WHERE visit.tenant_id=client.tenant_id AND visit.branch_id=client.branch_id AND visit.client_id=client.id AND visit.status IN ('completed','billed','paid'))=1 AND NOT EXISTS(SELECT 1 FROM appointments upcoming WHERE upcoming.tenant_id=client.tenant_id AND upcoming.branch_id=client.branch_id AND upcoming.client_id=client.id AND upcoming.start_at>NOW() AND upcoming.status NOT IN ('cancelled','no-show'))
             UNION ALL
             SELECT client.tenant_id,client.branch_id,'loyal_client_reward',client.id||':'||TO_CHAR(CURRENT_DATE,'YYYY-MM'),client.id,client.phone,client.email,'Thank you for your loyalty.',CONCAT_WS(' ',client.first_name,client.last_name)
               FROM active_clients client WHERE COALESCE((SELECT balance_after FROM membership_reward_ledger reward WHERE reward.tenant_id=client.tenant_id AND reward.branch_id=client.branch_id AND reward.client_id=client.id ORDER BY reward.created_at DESC,reward.id DESC LIMIT 1),0)>=500
             UNION ALL
             SELECT client.tenant_id,client.branch_id,'service_rebooking',client.id||':'||TO_CHAR(CURRENT_DATE,'YYYY-MM'),client.id,client.phone,client.email,'It may be time to rebook your usual service.',CONCAT_WS(' ',client.first_name,client.last_name)
               FROM active_clients client JOIN latest ON latest.client_id=client.id AND latest.recency_days>=30 WHERE NOT EXISTS(SELECT 1 FROM appointments upcoming WHERE upcoming.tenant_id=client.tenant_id AND upcoming.branch_id=client.branch_id AND upcoming.client_id=client.id AND upcoming.start_at>NOW() AND upcoming.status NOT IN ('cancelled','no-show'))
             UNION ALL
             SELECT client.tenant_id,client.branch_id,'abandoned_booking',session.id,client.id,client.phone,client.email,'Complete your booking when you are ready.',CONCAT_WS(' ',client.first_name,client.last_name)
               FROM active_clients client JOIN public_booking_sessions session ON session.tenant_id=client.tenant_id AND session.branch_id=client.branch_id AND session.client_id=client.id AND session.status IN ('active','abandoned') AND COALESCE(session.abandoned_at,session.last_event_at) BETWEEN NOW()-INTERVAL '24 hours' AND NOW()-INTERVAL '30 minutes' WHERE session.appointment_id=''
             UNION ALL
             SELECT client.tenant_id,client.branch_id,'slow_day_campaign',client.id||':'||rule.id||':'||TO_CHAR(CURRENT_DATE,'YYYY-MM-DD'),client.id,client.phone,client.email,'Appointments are available during today''s quieter hours.',CONCAT_WS(' ',client.first_name,client.last_name)
               FROM active_clients client JOIN pos_happy_hour_rules rule ON rule.tenant_id=client.tenant_id AND rule.branch_id=client.branch_id AND rule.active=TRUE AND EXTRACT(ISODOW FROM CURRENT_DATE)::SMALLINT=ANY(rule.weekdays) AND CURRENT_TIME<=rule.end_time
               WHERE NOT EXISTS(SELECT 1 FROM appointments upcoming WHERE upcoming.tenant_id=client.tenant_id AND upcoming.branch_id=client.branch_id AND upcoming.client_id=client.id AND upcoming.start_at>=NOW() AND upcoming.start_at<CURRENT_DATE+INTERVAL '1 day' AND upcoming.status NOT IN ('cancelled','no-show'))
             UNION ALL
             SELECT client.tenant_id,client.branch_id,'win_back',client.id||':'||TO_CHAR(CURRENT_DATE,'YYYY-MM'),client.id,client.phone,client.email,'We have missed you. Reply to find a suitable time for your next appointment.',CONCAT_WS(' ',client.first_name,client.last_name)
               FROM active_clients client JOIN latest ON latest.client_id=client.id AND latest.recency_days>=30 WHERE NOT EXISTS(SELECT 1 FROM appointments appointment WHERE appointment.tenant_id=client.tenant_id AND appointment.branch_id=client.branch_id AND appointment.client_id=client.id AND appointment.start_at>NOW() AND appointment.status NOT IN ('cancelled','no-show'))
           ) candidates ORDER BY source_type,source_id LIMIT 1000"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn automation_history(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT JSONB_BUILD_OBJECT('id',id,'type',source_type,'sourceId',source_id,'channel',channel,'status',status,'attempts',attempts,'scheduledAt',created_at,'sentAt',sent_at,'lastError',last_error) FROM benefit_notification_outbox WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND source_type IN ('win_back','occasion_campaign','membership_renewal','wallet_reminder','review_recovery','review_request') ORDER BY created_at DESC LIMIT 200")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

pub async fn bulk_import(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    rows: &Value,
    actor: &str,
) -> Result<i64, sqlx::Error> {
    let mut tx = db.begin().await?;
    let imported = bulk_import_tx(&mut tx, tenant_id, branch_id, rows, actor, None).await?;
    tx.commit().await?;
    Ok(imported)
}

pub(crate) async fn bulk_import_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    rows: &Value,
    actor: &str,
    import_job_id: Option<&str>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        r#"WITH inserted AS (
             INSERT INTO clients(tenant_id,branch_id,code,first_name,last_name,phone,normalized_phone,email,membership_label,categories_json,birthday,anniversary,notes,active,import_job_id)
             SELECT $1,$2,row.code,row.first_name,row.last_name,row.phone,row.normalized_phone,row.email,row.membership_label,row.categories_json,row.birthday,row.anniversary,row.notes,row.active,$5
               FROM JSONB_TO_RECORDSET($3) AS row(code TEXT,first_name TEXT,last_name TEXT,phone TEXT,normalized_phone TEXT,email TEXT,membership_label TEXT,categories_json JSONB,birthday DATE,anniversary DATE,notes TEXT,active BOOLEAN)
             RETURNING id
           ), audited AS (
             INSERT INTO client_audit_events(tenant_id,branch_id,client_id,event_type,actor_user_id,details_json)
             SELECT $1,$2,id,'client.bulk_imported',$4,JSONB_BUILD_OBJECT('importJobId',$5::TEXT) FROM inserted RETURNING id
           ) SELECT COUNT(*)::BIGINT FROM audited"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(rows)
    .bind(actor)
    .bind(import_job_id)
    .fetch_one(&mut **tx)
    .await
}

pub(crate) async fn merge_import_row_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    target_client_id: &str,
    row: &Value,
    actor: &str,
    import_job_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let snapshot = sqlx::query_scalar::<_, Value>(
        "SELECT TO_JSONB(client) FROM clients client WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND merged_into_client_id IS NULL FOR UPDATE",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(target_client_id)
    .fetch_optional(&mut **tx)
    .await?;
    if snapshot.is_none() {
        return Ok(None);
    }
    sqlx::query(
        r#"UPDATE clients client SET
             code=COALESCE(NULLIF(client.code,''),NULLIF(source.code,'')),
             first_name=COALESCE(NULLIF(client.first_name,''),source.first_name),
             last_name=COALESCE(NULLIF(client.last_name,''),source.last_name),
             email=COALESCE(NULLIF(client.email,''),NULLIF(source.email,''),''),
             membership_label=COALESCE(NULLIF(client.membership_label,''),NULLIF(source.membership_label,''),''),
             categories_json=CASE WHEN client.categories_json='[]'::JSONB THEN COALESCE(source.categories_json,'[]'::JSONB) ELSE client.categories_json END,
             birthday=COALESCE(client.birthday,source.birthday),
             anniversary=COALESCE(client.anniversary,source.anniversary),
             notes=CASE WHEN client.notes='' THEN COALESCE(source.notes,'') ELSE client.notes END,
             updated_at=NOW()
           FROM JSONB_TO_RECORD($4) AS source(code TEXT,first_name TEXT,last_name TEXT,email TEXT,membership_label TEXT,categories_json JSONB,birthday DATE,anniversary DATE,notes TEXT)
           WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(target_client_id)
    .bind(row)
    .execute(&mut **tx)
    .await?;
    record_audit_tx(
        tx,
        tenant_id,
        branch_id,
        target_client_id,
        "client.migration_merged",
        actor,
        serde_json::json!({"importJobId":import_job_id}),
    )
    .await?;
    Ok(snapshot)
}

pub async fn appointment_history(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientAppointmentHistoryRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT appointment.id, appointment.start_at, appointment.status,
          COALESCE((SELECT STRING_AGG(service.name, ', ' ORDER BY service.name) FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND service.id IN (SELECT JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::JSONB))), '') AS service_names,
          COALESCE(NULLIF(staff.appointment_display_name,''), CONCAT_WS(' ',staff.first_name,staff.last_name), '') AS staff_name
        FROM appointments appointment
        LEFT JOIN staff ON staff.tenant_id=appointment.tenant_id AND staff.branch_id=appointment.branch_id AND staff.id=appointment.staff_id
        WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND (appointment.client_id=$3 OR appointment.client_id IN (SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3))
        ORDER BY appointment.start_at DESC LIMIT 100
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_all(db)
    .await
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientFamilyMemberRecord {
    pub link_id: String,
    pub member_id: String,
    pub first_name: String,
    pub last_name: String,
    pub phone: String,
    pub relationship_type: String,
    pub linked_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ClientSoapNoteRecord {
    pub id: String,
    pub client_id: String,
    pub appointment_id: Option<String>,
    pub subjective: String,
    pub objective: String,
    pub assessment: String,
    pub plan: String,
    pub status: String,
    pub version: i32,
    pub created_by: String,
    pub updated_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn client_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_one(db)
    .await
}

pub async fn timeline(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    cursor_at: Option<DateTime<Utc>>,
    cursor_id: &str,
    limit: i64,
) -> Result<Vec<ClientTimelineEventRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH scoped_clients AS MATERIALIZED (
          SELECT id FROM clients
           WHERE tenant_id=$1 AND branch_id=$2
             AND (id=$3 OR merged_into_client_id=$3)
        ), events AS (
          SELECT 'appointment:' || appointment.id AS id,
                 'Appointments'::TEXT AS event_type,
                 'Appointment ' || INITCAP(REPLACE(appointment.status, '_', ' ')) AS title,
                 COALESCE((SELECT STRING_AGG(service.name, ', ' ORDER BY service.name)
                             FROM services service
                            WHERE service.tenant_id=appointment.tenant_id
                             AND service.branch_id=appointment.branch_id
                              AND service.id IN (SELECT JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::JSONB))), '') AS detail,
                 appointment.start_at AS occurred_at,
                 NULL::BIGINT AS amount_paise,
                 appointment.status::TEXT AS status,
                 appointment.id AS group_id,
                 NULL::BIGINT AS tip_paise,
                 NULL::BIGINT AS balance_paise
            FROM appointments appointment
           WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2
             AND appointment.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'appointment-activity:' || activity.appointment_id || ':' || activity.id,
                 'Appointments',
                 'Appointment ' || INITCAP(REPLACE(LOWER(activity.action), '_', ' ')),
                 activity.reason,
                 activity.created_at,
                 NULL::BIGINT,
                 NULLIF(activity.new_status, ''),
                 activity.appointment_id,
                 NULL::BIGINT,
                 NULL::BIGINT
            FROM appointment_activity activity
            JOIN appointments appointment ON appointment.tenant_id=activity.tenant_id
             AND appointment.branch_id=activity.branch_id
             AND appointment.id=activity.appointment_id
           WHERE activity.tenant_id=$1 AND activity.branch_id=$2
             AND appointment.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'invoice:' || sale.id, 'Invoices',
                 CASE WHEN sale.invoice_number='' THEN 'Invoice' ELSE 'Invoice ' || sale.invoice_number END,
                 COALESCE((SELECT STRING_AGG(line.item_name, ', ' ORDER BY line.created_at,line.id)
                             FROM pos_sale_lines line
                            WHERE line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id
                              AND line.sale_id=sale.id AND line.line_type='service'), ''),
                 sale.created_at, sale.total_paise, sale.status,
                 CASE WHEN sale.source='appointment' THEN NULLIF(sale.reference_id, '') ELSE NULL END,
                 sale.tip_paise,
                 GREATEST(sale.total_paise - sale.paid_paise, 0)
            FROM pos_sales sale
           WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.status<>'draft'
             AND sale.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'payment:' || payment.id, 'Payments', 'Payment received',
                 CASE WHEN sale.invoice_number='' THEN payment.method ELSE sale.invoice_number END,
                 payment.created_at, payment.amount_paise, NULL::TEXT,
                 CASE WHEN sale.source='appointment' THEN NULLIF(sale.reference_id, '') ELSE NULL END,
                 NULL::BIGINT,
                 NULL::BIGINT
            FROM pos_payments payment
            JOIN pos_sales sale ON sale.tenant_id=payment.tenant_id AND sale.branch_id=payment.branch_id AND sale.id=payment.sale_id
           WHERE payment.tenant_id=$1 AND payment.branch_id=$2
             AND sale.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'service:' || line.id, 'Services', line.item_name,
                 CASE WHEN sale.invoice_number='' THEN '' ELSE 'Invoice ' || sale.invoice_number END,
                 line.created_at, line.line_total_paise, NULL::TEXT,
                 CASE WHEN sale.source='appointment' THEN NULLIF(sale.reference_id, '') ELSE NULL END,
                 NULL::BIGINT,
                 NULL::BIGINT
            FROM pos_sale_lines line
            JOIN pos_sales sale ON sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id AND sale.id=line.sale_id
           WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.line_type='service'
             AND sale.status NOT IN ('draft','cancelled','voided')
             AND sale.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'wallet:' || wallet.id, 'Wallet', INITCAP(REPLACE(wallet.transaction_type, '_', ' ')),
                 COALESCE(NULLIF(wallet.notes,''), wallet.reference_type), wallet.created_at,
                 wallet.delta_paise, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::BIGINT
            FROM wallet_transactions wallet
           WHERE wallet.tenant_id=$1 AND wallet.branch_id=$2
             AND wallet.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'loyalty:' || reward.id, 'Loyalty', INITCAP(REPLACE(reward.transaction_type, '_', ' ')),
                 reward.note, reward.created_at, NULL::BIGINT,
                 CONCAT(CASE WHEN reward.points>0 THEN '+' ELSE '' END, reward.points, ' points'),
                 NULL::TEXT, NULL::BIGINT, NULL::BIGINT
            FROM membership_reward_ledger reward
           WHERE reward.tenant_id=$1 AND reward.branch_id=$2
             AND reward.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'membership:' || ledger.id, 'Memberships',
                 membership.name || ' ' || INITCAP(REPLACE(ledger.event_type, '_', ' ')),
                 ledger.reason, ledger.created_at, NULL::BIGINT, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::BIGINT
            FROM membership_lifecycle_ledger ledger
            JOIN client_memberships assigned ON assigned.tenant_id=ledger.tenant_id AND assigned.branch_id=ledger.branch_id AND assigned.id=ledger.client_membership_id
            JOIN memberships membership ON membership.tenant_id=assigned.tenant_id AND membership.branch_id=assigned.branch_id AND membership.id=assigned.membership_id
           WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2
             AND assigned.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'package-credit:' || credit.id, 'Packages', credit.package_name,
                 CONCAT(credit.service_name, ' - ', credit.remaining_qty, '/', credit.total_qty, ' remaining'),
                 credit.created_at, NULL::BIGINT, CASE WHEN credit.active THEN 'active' ELSE 'inactive' END,
                 NULL::TEXT, NULL::BIGINT, NULL::BIGINT
            FROM client_package_credits credit
           WHERE credit.tenant_id=$1 AND credit.branch_id=$2
             AND credit.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'package-redemption:' || redemption.id, 'Packages', redemption.package_name || ' redeemed',
                 CONCAT(redemption.service_name, ' x', redemption.quantity), redemption.created_at,
                 NULL::BIGINT, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::BIGINT
            FROM pos_package_redemptions redemption
           WHERE redemption.tenant_id=$1 AND redemption.branch_id=$2
             AND redemption.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'note:' || note.id, 'Notes', INITCAP(REPLACE(note.note_type, '_', ' ')),
                 note.note, note.created_at, NULL::BIGINT, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::BIGINT
            FROM client_notes note
           WHERE note.tenant_id=$1 AND note.branch_id=$2
             AND note.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'client-note:' || client.id, 'Notes', 'Client note', client.notes,
                 COALESCE(client.updated_at, client.created_at), NULL::BIGINT, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::BIGINT
            FROM clients client
           WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$3
             AND BTRIM(client.notes)<>''
          UNION ALL
          SELECT 'form:' || submission.id,
                 CASE WHEN submission.form_type='consent' THEN 'Consent' ELSE 'Custom forms' END,
                 submission.form_name || ' v' || submission.form_version,
                 CASE WHEN submission.signature_name='' THEN '' ELSE 'Signed by ' || submission.signature_name END,
                 submission.submitted_at, NULL::BIGINT, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::BIGINT
            FROM client_form_submissions submission
           WHERE submission.tenant_id=$1 AND submission.branch_id=$2
             AND submission.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'photo:' || photo.id, 'Custom forms', 'Treatment photo',
                 COALESCE(NULLIF(photo.caption,''), photo.file_name), photo.created_at,
                 NULL::BIGINT, photo.photo_type, NULL::TEXT, NULL::BIGINT, NULL::BIGINT
            FROM client_treatment_photos photo
           WHERE photo.tenant_id=$1 AND photo.branch_id=$2
             AND photo.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'consent:' || consent.id, 'Consent',
                 INITCAP(consent.channel) || CASE WHEN consent.opted_in THEN ' opted in' ELSE ' opted out' END,
                 COALESCE(NULLIF(consent.reason,''), consent.source), consent.recorded_at,
                 NULL::BIGINT, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::BIGINT
            FROM client_consent_events consent
           WHERE consent.tenant_id=$1 AND consent.branch_id=$2
             AND consent.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'communication:' || communication.id,
                 CASE WHEN communication.channel='whatsapp' THEN 'WhatsApp' ELSE 'Audit activity' END,
                 COALESCE(NULLIF(communication.subject,''), INITCAP(communication.channel) || ' communication'),
                 communication.body, communication.occurred_at, NULL::BIGINT, communication.status,
                 NULL::TEXT, NULL::BIGINT, NULL::BIGINT
            FROM client_communications communication
           WHERE communication.tenant_id=$1 AND communication.branch_id=$2
             AND communication.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'review:' || review.id, 'Reviews',
                 INITCAP(review.platform) || ' review' || CASE WHEN review.rating IS NULL THEN '' ELSE ' - ' || review.rating || '/5' END,
                 COALESCE(NULLIF(review.review_text,''), review.external_review_id),
                 COALESCE(review.reviewed_at, review.created_at), NULL::BIGINT, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::BIGINT
            FROM client_review_links review
           WHERE review.tenant_id=$1 AND review.branch_id=$2
             AND review.client_id IN (SELECT id FROM scoped_clients)
          UNION ALL
          SELECT 'audit:' || audit.id, 'Audit activity', INITCAP(REPLACE(audit.event_type, '.', ' ')),
                 audit.actor_user_id, audit.created_at, NULL::BIGINT, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::BIGINT
            FROM client_audit_events audit
           WHERE audit.tenant_id=$1 AND audit.branch_id=$2
             AND audit.client_id IN (SELECT id FROM scoped_clients)
        )
        SELECT id,event_type,title,detail,occurred_at,amount_paise,status,group_id,tip_paise,balance_paise,
               CASE WHEN event_type='Invoices' THEN COALESCE((
                 SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
                          'lineType',line.line_type,
                          'itemName',line.item_name,
                          'quantity',line.quantity,
                          'lineTotalPaise',line.line_total_paise,
                          'staffName',COALESCE(
                            NULLIF((
                              SELECT STRING_AGG(COALESCE(
                                       NULLIF(TRIM(CONCAT_WS(' ',split_staff.first_name,NULLIF(split_staff.middle_name,''),NULLIF(split_staff.last_name,''))),''),
                                       NULLIF(split.value->>'staffName',''),
                                       'Unassigned'
                                     ),', ' ORDER BY split.ordinality)
                                FROM JSONB_ARRAY_ELEMENTS(COALESCE(line.staff_splits,'[]'::JSONB)) WITH ORDINALITY split(value,ordinality)
                                LEFT JOIN staff split_staff ON split_staff.tenant_id=line.tenant_id
                                 AND split_staff.branch_id=line.branch_id AND split_staff.id=split.value->>'staffId'
                            ),''),
                            NULLIF(TRIM(CONCAT_WS(' ',line_staff.first_name,NULLIF(line_staff.middle_name,''),NULLIF(line_staff.last_name,''))),''),
                            NULLIF(TRIM(CONCAT_WS(' ',sale_staff.first_name,NULLIF(sale_staff.middle_name,''),NULLIF(sale_staff.last_name,''))),''),
                            'Unassigned'
                          )
                        ) ORDER BY line.created_at,line.id)
                   FROM pos_sale_lines line
                   JOIN pos_sales item_sale ON item_sale.tenant_id=line.tenant_id
                    AND item_sale.branch_id=line.branch_id AND item_sale.id=line.sale_id
                   LEFT JOIN staff line_staff ON line_staff.tenant_id=line.tenant_id
                    AND line_staff.branch_id=line.branch_id AND line_staff.id=NULLIF(line.staff_id,'')
                   LEFT JOIN staff sale_staff ON sale_staff.tenant_id=item_sale.tenant_id
                    AND sale_staff.branch_id=item_sale.branch_id AND sale_staff.id=NULLIF(item_sale.staff_id,'')
                  WHERE line.tenant_id=$1 AND line.branch_id=$2
                    AND line.sale_id=SUBSTRING(events.id FROM 9)
                    AND line.line_type IN ('service','product')
               ),'[]'::JSONB) ELSE '[]'::JSONB END AS line_items
          FROM events
         WHERE $4::TIMESTAMPTZ IS NULL
            OR occurred_at < $4
            OR (occurred_at=$4 AND id<$5)
         ORDER BY occurred_at DESC,id DESC
         LIMIT $6
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(cursor_at)
    .bind(cursor_id)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn invoice_history(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientInvoiceHistoryRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT sale.id, sale.invoice_number, sale.status, sale.total_paise, sale.paid_paise,
          COALESCE((SELECT STRING_AGG(line.item_name, ', ' ORDER BY line.created_at,line.id) FROM pos_sale_lines line WHERE line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id AND line.line_type='service'), '') AS service_names,
          sale.created_at
        FROM pos_sales sale
        WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND (sale.client_id=$3 OR sale.client_id IN (SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3)) AND sale.status<>'draft'
        ORDER BY sale.created_at DESC LIMIT 100
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_all(db)
    .await
}

pub async fn service_history(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientServiceHistoryRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT sale.id AS sale_id, sale.invoice_number, line.item_id AS service_id, line.item_name AS service_name, line.quantity, line.line_total_paise, line.created_at
        FROM pos_sales sale
        JOIN pos_sale_lines line ON line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id AND line.line_type='service'
        WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND (sale.client_id=$3 OR sale.client_id IN (SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3)) AND sale.status NOT IN ('draft','cancelled','voided')
        ORDER BY line.created_at DESC,line.id DESC LIMIT 200
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_all(db)
    .await
}

pub async fn list_notes(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientNoteRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,client_id,note_type,note,created_by,created_at FROM client_notes WHERE tenant_id=$1 AND branch_id=$2 AND (client_id=$3 OR client_id IN (SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3)) ORDER BY created_at DESC,id DESC LIMIT 200")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

pub async fn create_note(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    note_type: &str,
    note: &str,
    created_by: &str,
) -> Result<Option<ClientNoteRecord>, sqlx::Error> {
    sqlx::query_as("INSERT INTO client_notes (tenant_id,branch_id,client_id,note_type,note,created_by) SELECT $1,$2,id,$4,$5,$6 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,client_id,note_type,note,created_by,created_at")
        .bind(tenant_id).bind(branch_id).bind(client_id).bind(note_type).bind(note).bind(created_by).fetch_optional(db).await
}

pub async fn list_family_members(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientFamilyMemberRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT link.id AS link_id,
                  CASE WHEN link.client_id=$3 THEN related.id ELSE source.id END AS member_id,
                  CASE WHEN link.client_id=$3 THEN related.first_name ELSE source.first_name END AS first_name,
                  CASE WHEN link.client_id=$3 THEN related.last_name ELSE source.last_name END AS last_name,
                  CASE WHEN link.client_id=$3 THEN related.phone ELSE source.phone END AS phone,
                  CASE WHEN link.client_id=$3 THEN link.relationship_type
                       WHEN link.relationship_type='parent' THEN 'child'
                       WHEN link.relationship_type='child' THEN 'parent'
                       WHEN link.relationship_type='guardian' THEN 'dependent'
                       WHEN link.relationship_type='dependent' THEN 'guardian'
                       ELSE link.relationship_type END AS relationship_type,
                  link.created_at AS linked_at
             FROM client_family_links link
             JOIN clients source ON source.id=link.client_id AND source.tenant_id=link.tenant_id AND source.branch_id=link.branch_id
             JOIN clients related ON related.id=link.related_client_id AND related.tenant_id=link.tenant_id AND related.branch_id=link.branch_id
            WHERE link.tenant_id=$1 AND link.branch_id=$2 AND (link.client_id=$3 OR link.related_client_id=$3)
            ORDER BY linked_at DESC,link.id DESC"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_all(db)
    .await
}

pub async fn link_family_member(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    related_client_id: &str,
    relationship_type: &str,
    reverse_relationship_type: &str,
    actor: &str,
) -> Result<Option<ClientFamilyMemberRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let inserted = sqlx::query(
        r#"INSERT INTO client_family_links(tenant_id,branch_id,client_id,related_client_id,relationship_type,created_by)
           SELECT $1,$2,source.id,related.id,$5,$7
             FROM clients source
             JOIN clients related ON related.tenant_id=source.tenant_id AND related.branch_id=source.branch_id AND related.id=$4 AND related.merged_into_client_id IS NULL
            WHERE source.tenant_id=$1 AND source.branch_id=$2 AND source.id=$3 AND source.merged_into_client_id IS NULL
           ON CONFLICT DO NOTHING"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(related_client_id)
    .bind(relationship_type)
    .bind(reverse_relationship_type)
    .bind(actor)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        let updated = sqlx::query(
            r#"UPDATE client_family_links
                  SET relationship_type=CASE WHEN client_id=$3 THEN $5 ELSE $6 END,
                      updated_at=NOW()
                WHERE tenant_id=$1 AND branch_id=$2
                  AND LEAST(client_id,related_client_id)=LEAST($3,$4)
                  AND GREATEST(client_id,related_client_id)=GREATEST($3,$4)"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .bind(related_client_id)
        .bind(relationship_type)
        .bind(reverse_relationship_type)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if updated == 0 {
            tx.rollback().await?;
            return Ok(None);
        }
    }
    let row = sqlx::query_as(
        r#"SELECT link.id AS link_id,member.id AS member_id,member.first_name,member.last_name,member.phone,
                  CASE WHEN link.client_id=$3 THEN link.relationship_type
                       WHEN link.relationship_type='parent' THEN 'child'
                       WHEN link.relationship_type='child' THEN 'parent'
                       WHEN link.relationship_type='guardian' THEN 'dependent'
                       WHEN link.relationship_type='dependent' THEN 'guardian'
                       ELSE link.relationship_type END AS relationship_type,
                  link.created_at AS linked_at
             FROM client_family_links link
             JOIN clients member ON member.tenant_id=link.tenant_id AND member.branch_id=link.branch_id
               AND member.id=CASE WHEN link.client_id=$3 THEN link.related_client_id ELSE link.client_id END
            WHERE link.tenant_id=$1 AND link.branch_id=$2
              AND LEAST(link.client_id,link.related_client_id)=LEAST($3,$4)
              AND GREATEST(link.client_id,link.related_client_id)=GREATEST($3,$4)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(related_client_id)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn unlink_family_member(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    related_client_id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query(
        r#"DELETE FROM client_family_links
            WHERE tenant_id=$1 AND branch_id=$2
              AND LEAST(client_id,related_client_id)=LEAST($3,$4)
              AND GREATEST(client_id,related_client_id)=GREATEST($3,$4)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(related_client_id)
    .execute(db)
    .await?
    .rows_affected()
        > 0)
}

pub async fn list_soap_notes(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientSoapNoteRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,client_id,appointment_id,subjective,objective,assessment,plan,status,version,created_by,updated_by,created_at,updated_at FROM client_soap_notes WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY created_at DESC,id DESC")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_soap_note(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    appointment_id: Option<&str>,
    subjective: &str,
    objective: &str,
    assessment: &str,
    plan: &str,
    status: &str,
    actor: &str,
) -> Result<Option<ClientSoapNoteRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO client_soap_notes(tenant_id,branch_id,client_id,appointment_id,subjective,objective,assessment,plan,status,created_by,updated_by)
           SELECT $1,$2,client.id,$4,$5,$6,$7,$8,$9,$10,$10
             FROM clients client
            WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$3
              AND ($4::TEXT IS NULL OR EXISTS(SELECT 1 FROM appointments appointment WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.id=$4 AND appointment.client_id=$3))
           RETURNING id,client_id,appointment_id,subjective,objective,assessment,plan,status,version,created_by,updated_by,created_at,updated_at"#,
    )
    .bind(tenant_id).bind(branch_id).bind(client_id).bind(appointment_id).bind(subjective).bind(objective).bind(assessment).bind(plan).bind(status).bind(actor)
    .fetch_optional(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn update_soap_note(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    note_id: &str,
    subjective: &str,
    objective: &str,
    assessment: &str,
    plan: &str,
    status: &str,
    expected_version: i32,
    actor: &str,
) -> Result<Option<ClientSoapNoteRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"UPDATE client_soap_notes SET subjective=$5,objective=$6,assessment=$7,plan=$8,status=$9,version=version+1,updated_by=$11,updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND id=$4 AND version=$10 AND status<>'final'
            RETURNING id,client_id,appointment_id,subjective,objective,assessment,plan,status,version,created_by,updated_by,created_at,updated_at"#,
    )
    .bind(tenant_id).bind(branch_id).bind(client_id).bind(note_id).bind(subjective).bind(objective).bind(assessment).bind(plan).bind(status).bind(expected_version).bind(actor)
    .fetch_optional(db).await
}

pub async fn list_form_definitions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ClientFormDefinitionRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT DISTINCT ON (form_key) id,form_key,name,form_type,version,body,fields_json,requires_signature,active,created_at FROM client_form_definitions WHERE tenant_id=$1 AND branch_id=$2 ORDER BY form_key,version DESC",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn get_form_definition(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<ClientFormDefinitionRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,form_key,name,form_type,version,body,fields_json,requires_signature,active,created_at FROM client_form_definitions WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_form_definition(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    form_key: &str,
    name: &str,
    form_type: &str,
    body: &str,
    fields_json: &Value,
    requires_signature: bool,
    created_by: &str,
) -> Result<ClientFormDefinitionRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("{tenant_id}:{branch_id}:{form_key}"))
        .execute(&mut *tx)
        .await?;
    let row = sqlx::query_as::<_, ClientFormDefinitionRecord>(
        r#"INSERT INTO client_form_definitions(tenant_id,branch_id,form_key,name,form_type,version,body,fields_json,requires_signature,created_by)
           VALUES($1,$2,$3,$4,$5,COALESCE((SELECT MAX(version)+1 FROM client_form_definitions WHERE tenant_id=$1 AND branch_id=$2 AND form_key=$3),1),$6,$7,$8,$9)
           RETURNING id,form_key,name,form_type,version,body,fields_json,requires_signature,active,created_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(form_key)
    .bind(name)
    .bind(form_type)
    .bind(body)
    .bind(fields_json)
    .bind(requires_signature)
    .bind(created_by)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn get_clinical_profile(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Option<ClientClinicalProfileRecord>, sqlx::Error> {
    sqlx::query_as("SELECT client_id,allergies,preferences,version,updated_at FROM client_clinical_profiles WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_optional(db).await
}

pub async fn save_clinical_profile(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    allergies: &str,
    preferences: &str,
    expected_version: i32,
    updated_by: &str,
) -> Result<Option<ClientClinicalProfileRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO client_clinical_profiles(tenant_id,branch_id,client_id,allergies,preferences,updated_by)
           SELECT $1,$2,id,$4,$5,$7 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND $6=0
           ON CONFLICT(tenant_id,branch_id,client_id) DO UPDATE SET allergies=EXCLUDED.allergies,preferences=EXCLUDED.preferences,version=client_clinical_profiles.version+1,updated_by=EXCLUDED.updated_by,updated_at=NOW()
           WHERE client_clinical_profiles.version=$6
           RETURNING client_id,allergies,preferences,version,updated_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(allergies)
    .bind(preferences)
    .bind(expected_version)
    .bind(updated_by)
    .fetch_optional(db)
    .await
}

pub async fn list_form_submissions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientFormSubmissionRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,definition_id,form_key,form_name,form_type,form_version,responses_json,signature_name,signature_sha256,signed_at,submitted_at FROM client_form_submissions WHERE tenant_id=$1 AND branch_id=$2 AND (client_id=$3 OR client_id IN (SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3)) ORDER BY submitted_at DESC,id DESC")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_form_submission(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    definition_id: &str,
    responses_json: &Value,
    signature_name: &str,
    signature_sha256: &str,
    submitted_by: &str,
) -> Result<Option<ClientFormSubmissionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO client_form_submissions(tenant_id,branch_id,client_id,definition_id,form_key,form_name,form_type,form_version,responses_json,signature_name,signature_sha256,signed_at,submitted_by)
           SELECT $1,$2,client.id,definition.id,definition.form_key,definition.name,definition.form_type,definition.version,$5,$6,$7,CASE WHEN $6='' THEN NULL ELSE NOW() END,$8
           FROM clients client JOIN client_form_definitions definition ON definition.tenant_id=client.tenant_id AND definition.branch_id=client.branch_id AND definition.id=$4 AND definition.active=TRUE
           WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$3
           RETURNING id,definition_id,form_key,form_name,form_type,form_version,responses_json,signature_name,signature_sha256,signed_at,submitted_at"#,
    )
    .bind(tenant_id).bind(branch_id).bind(client_id).bind(definition_id)
    .bind(responses_json).bind(signature_name).bind(signature_sha256).bind(submitted_by)
    .fetch_optional(db).await
}

pub async fn list_treatment_photos(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientTreatmentPhotoRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,appointment_id,caption,file_name,content_type,byte_size,sha256,photo_type,created_at FROM client_treatment_photos WHERE tenant_id=$1 AND branch_id=$2 AND (client_id=$3 OR client_id IN (SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3)) ORDER BY created_at DESC,id DESC")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn save_treatment_photo(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    appointment_id: Option<&str>,
    caption: &str,
    file_name: &str,
    content_type: &str,
    sha256: &str,
    photo_type: &str,
    content: Vec<u8>,
    uploaded_by: &str,
) -> Result<Option<ClientTreatmentPhotoRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO client_treatment_photos(tenant_id,branch_id,client_id,appointment_id,caption,file_name,content_type,byte_size,sha256,photo_type,content,uploaded_by)
           SELECT $1,$2,client.id,$4,$5,$6,$7,$8,$9,$10,$11,$12 FROM clients client
           WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$3
             AND ($4::TEXT IS NULL OR EXISTS(SELECT 1 FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND id=$4))
           RETURNING id,appointment_id,caption,file_name,content_type,byte_size,sha256,photo_type,created_at"#,
    )
    .bind(tenant_id).bind(branch_id).bind(client_id).bind(appointment_id).bind(caption)
    .bind(file_name).bind(content_type).bind(content.len() as i32).bind(sha256).bind(photo_type).bind(content).bind(uploaded_by)
    .fetch_optional(db).await
}

pub async fn get_treatment_photo(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    photo_id: &str,
) -> Result<Option<ClientTreatmentPhotoFile>, sqlx::Error> {
    sqlx::query_as("SELECT file_name,content_type,content FROM client_treatment_photos WHERE tenant_id=$1 AND branch_id=$2 AND (client_id=$3 OR client_id IN (SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3)) AND id=$4")
        .bind(tenant_id).bind(branch_id).bind(client_id).bind(photo_id).fetch_optional(db).await
}

pub async fn update_treatment_photo(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    photo_id: &str,
    caption: Option<&str>,
    photo_type: Option<&str>,
) -> Result<Option<ClientTreatmentPhotoRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"UPDATE client_treatment_photos SET caption=COALESCE($5,caption),photo_type=COALESCE($6,photo_type)
           WHERE tenant_id=$1 AND branch_id=$2 AND id=$4
             AND (client_id=$3 OR client_id IN (SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3))
           RETURNING id,appointment_id,caption,file_name,content_type,byte_size,sha256,photo_type,created_at"#,
    )
    .bind(tenant_id).bind(branch_id).bind(client_id).bind(photo_id).bind(caption).bind(photo_type)
    .fetch_optional(db).await
}

pub async fn delete_treatment_photo(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    photo_id: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let deleted: Option<(String, String, String)> = sqlx::query_as(
        r#"DELETE FROM client_treatment_photos
           WHERE tenant_id=$1 AND branch_id=$2 AND id=$4
             AND (client_id=$3 OR client_id IN (SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3))
           RETURNING file_name,photo_type,caption"#,
    )
    .bind(tenant_id).bind(branch_id).bind(client_id).bind(photo_id)
    .fetch_optional(&mut *tx).await?;
    if let Some((file_name, photo_type, caption)) = &deleted {
        record_audit_tx(
            &mut tx,
            tenant_id,
            branch_id,
            client_id,
            "client.photo.deleted",
            actor,
            serde_json::json!({"photoId": photo_id, "fileName": file_name, "photoType": photo_type, "caption": caption}),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(deleted.is_some())
}

pub async fn list_duplicates(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientDuplicateRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT duplicate.id,duplicate.first_name,duplicate.last_name,duplicate.phone,duplicate.email,duplicate.normalized_phone,duplicate.created_at
             FROM clients selected
             JOIN clients duplicate
               ON duplicate.tenant_id=selected.tenant_id
              AND duplicate.branch_id=selected.branch_id
              AND duplicate.normalized_phone=selected.normalized_phone
              AND duplicate.id<>selected.id
            WHERE selected.tenant_id=$1 AND selected.branch_id=$2 AND selected.id=$3
              AND selected.normalized_phone<>'' AND duplicate.active=TRUE
              AND duplicate.merged_into_client_id IS NULL
            ORDER BY duplicate.created_at,duplicate.id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_all(db)
    .await
}

pub async fn list_consent_events(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientConsentEventRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,channel,opted_in,source,reason,recorded_by,recorded_at FROM client_consent_events WHERE tenant_id=$1 AND branch_id=$2 AND (client_id=$3 OR client_id IN (SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3)) ORDER BY recorded_at DESC,id DESC LIMIT 200")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

pub async fn list_communications(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientCommunicationRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,channel,direction,status,subject,body,occurred_at
             FROM client_communications
            WHERE tenant_id=$1 AND branch_id=$2
              AND (client_id=$3 OR client_id IN (
                    SELECT id FROM clients
                     WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3
                  ))
            ORDER BY occurred_at DESC,id DESC LIMIT 300"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_all(db)
    .await
}

pub async fn list_reviews(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientReviewRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,platform,external_review_id,rating,review_text,reviewed_at,created_at FROM client_review_links WHERE tenant_id=$1 AND branch_id=$2 AND (client_id=$3 OR client_id IN (SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3)) ORDER BY reviewed_at DESC NULLS LAST,created_at DESC,id DESC")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_review_link(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    platform: &str,
    external_review_id: &str,
    rating: Option<i16>,
    review_text: &str,
    reviewed_at: Option<DateTime<Utc>>,
    actor: &str,
) -> Result<Option<ClientReviewRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, ClientReviewRecord>(
        r#"INSERT INTO client_review_links(tenant_id,branch_id,client_id,platform,external_review_id,rating,review_text,reviewed_at,linked_by)
           SELECT $1,$2,id,$4,$5,$6,$7,$8,$9 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND merged_into_client_id IS NULL
           RETURNING id,platform,external_review_id,rating,review_text,reviewed_at,created_at"#,
    )
    .bind(tenant_id).bind(branch_id).bind(client_id).bind(platform).bind(external_review_id)
    .bind(rating).bind(review_text).bind(reviewed_at).bind(actor)
    .fetch_optional(&mut *tx).await?;
    if let Some(review) = &row {
        record_audit_tx(
            &mut tx,
            tenant_id,
            branch_id,
            client_id,
            "client.review.linked",
            actor,
            serde_json::json!({"reviewId":review.id,"platform":platform}),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(row)
}

pub async fn list_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ClientAuditRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,event_type,actor_user_id,details_json,created_at FROM client_audit_events WHERE tenant_id=$1 AND branch_id=$2 AND (client_id=$3 OR client_id IN (SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id=$3)) ORDER BY created_at DESC,id DESC LIMIT 300")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn save_contact_preferences(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    preferred_staff_id: Option<&str>,
    preferred_channel: &str,
    whatsapp_opt_in: Option<bool>,
    sms_opt_in: Option<bool>,
    email_opt_in: Option<bool>,
    reason: &str,
    actor: &str,
) -> Result<Option<ClientContactPreferencesRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let previous = sqlx::query_as::<_, (Option<bool>, Option<bool>, Option<bool>)>(
        "SELECT whatsapp_opt_in,sms_opt_in,email_opt_in FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    ).bind(tenant_id).bind(branch_id).bind(client_id).fetch_optional(&mut *tx).await?;
    let Some(previous) = previous else {
        tx.rollback().await?;
        return Ok(None);
    };
    let row = sqlx::query_as(
        r#"UPDATE clients client SET preferred_staff_id=$4,preferred_communication_channel=$5,
             whatsapp_opt_in=$6,sms_opt_in=$7,email_opt_in=$8,updated_at=NOW()
           WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$3 AND client.merged_into_client_id IS NULL
             AND ($4::TEXT IS NULL OR EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$4 AND active=TRUE))
           RETURNING client.preferred_staff_id,
             COALESCE((SELECT COALESCE(NULLIF(staff.appointment_display_name,''),CONCAT_WS(' ',staff.first_name,staff.last_name)) FROM staff WHERE staff.id=client.preferred_staff_id),'') AS preferred_staff_name,
             client.preferred_communication_channel,client.whatsapp_opt_in,client.sms_opt_in,client.email_opt_in,client.updated_at"#,
    ).bind(tenant_id).bind(branch_id).bind(client_id).bind(preferred_staff_id).bind(preferred_channel)
      .bind(whatsapp_opt_in).bind(sms_opt_in).bind(email_opt_in).fetch_optional(&mut *tx).await?;
    if row.is_none() {
        tx.rollback().await?;
        return Ok(None);
    }
    for (channel, before, after) in [
        ("whatsapp", previous.0, whatsapp_opt_in),
        ("sms", previous.1, sms_opt_in),
        ("email", previous.2, email_opt_in),
    ] {
        if before != after {
            if let Some(opted_in) = after {
                sqlx::query("INSERT INTO client_consent_events(tenant_id,branch_id,client_id,channel,opted_in,source,reason,recorded_by) VALUES($1,$2,$3,$4,$5,'staff',$6,$7)")
                    .bind(tenant_id).bind(branch_id).bind(client_id).bind(channel).bind(opted_in).bind(reason).bind(actor).execute(&mut *tx).await?;
            }
        }
    }
    record_audit_tx(&mut tx, tenant_id, branch_id, client_id, "client.communication_preferences.updated", actor, serde_json::json!({"preferredStaffId":preferred_staff_id,"preferredChannel":preferred_channel})).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn merge_clients(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    source_client_id: &str,
    target_client_id: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let locked = sqlx::query_scalar::<_, String>(
        "SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id IN ($3,$4) ORDER BY id FOR UPDATE",
    ).bind(tenant_id).bind(branch_id).bind(source_client_id).bind(target_client_id).fetch_all(&mut *tx).await?;
    if locked.len() != 2 {
        tx.rollback().await?;
        return Ok(false);
    }
    let snapshot = sqlx::query_scalar::<_, Value>(
        "SELECT TO_JSONB(client) FROM clients client WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND merged_into_client_id IS NULL",
    ).bind(tenant_id).bind(branch_id).bind(source_client_id).fetch_optional(&mut *tx).await?;
    let target_ready = sqlx::query_scalar::<_, bool>(
        "SELECT active AND merged_into_client_id IS NULL FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    ).bind(tenant_id).bind(branch_id).bind(target_client_id).fetch_one(&mut *tx).await?;
    let Some(snapshot) = snapshot else {
        tx.rollback().await?;
        return Ok(false);
    };
    if !target_ready {
        tx.rollback().await?;
        return Ok(false);
    }
    sqlx::query("UPDATE clients SET active=FALSE,merged_into_client_id=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(source_client_id).bind(target_client_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO client_merge_history(tenant_id,branch_id,source_client_id,target_client_id,source_snapshot,merged_by) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(tenant_id).bind(branch_id).bind(source_client_id).bind(target_client_id).bind(snapshot).bind(actor).execute(&mut *tx).await?;
    record_audit_tx(
        &mut tx,
        tenant_id,
        branch_id,
        target_client_id,
        "client.merged",
        actor,
        serde_json::json!({"sourceClientId":source_client_id}),
    )
    .await?;
    record_audit_tx(
        &mut tx,
        tenant_id,
        branch_id,
        source_client_id,
        "client.merged_into",
        actor,
        serde_json::json!({"targetClientId":target_client_id}),
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

async fn record_audit_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    event_type: &str,
    actor: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO client_audit_events(tenant_id,branch_id,client_id,event_type,actor_user_id,details_json) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(tenant_id).bind(branch_id).bind(client_id).bind(event_type).bind(actor).bind(details).execute(&mut **tx).await?;
    Ok(())
}

pub async fn create(db: &PgPool, input: CreateClient<'_>) -> Result<ClientRecord, sqlx::Error> {
    sqlx::query_as::<_, ClientRecord>(
        r#"
        INSERT INTO clients (
          tenant_id, branch_id, code, first_name, last_name, phone, normalized_phone, email,
          membership_label, categories_json, birthday, anniversary, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, COALESCE($13, ''))
        RETURNING
          id,
          tenant_id,
          branch_id,
          code,
          first_name,
          last_name,
          phone,
          normalized_phone,
          email,
          wallet_balance_paise,
          0::BIGINT AS duplicate_count,
          last_visit_at,
          membership_label,
          categories_json::TEXT AS categories_json,
          birthday,
          anniversary,
          notes,
          active,
          preferred_staff_id,
          ''::TEXT AS preferred_staff_name,
          preferred_communication_channel,
          whatsapp_opt_in,
          sms_opt_in,
          email_opt_in,
          merged_into_client_id,
          created_at,
          updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.code)
    .bind(input.first_name)
    .bind(input.last_name)
    .bind(input.phone)
    .bind(input.normalized_phone)
    .bind(input.email)
    .bind(input.membership_label)
    .bind(input.categories_json)
    .bind(input.birthday)
    .bind(input.anniversary)
    .bind(input.notes)
    .fetch_one(db)
    .await
}

pub async fn update(
    db: &PgPool,
    input: UpdateClient<'_>,
) -> Result<Option<ClientRecord>, sqlx::Error> {
    sqlx::query_as::<_, ClientRecord>(
        r#"
        UPDATE clients
        SET
          code = COALESCE($4, code),
          first_name = COALESCE($5, first_name),
          last_name = COALESCE($6, last_name),
          phone = COALESCE($7, phone),
          normalized_phone = COALESCE($8, normalized_phone),
          email = COALESCE($9, email),
          membership_label = COALESCE($10, membership_label),
          categories_json = COALESCE($11::jsonb, categories_json),
          active = COALESCE($12, active),
          birthday = COALESCE($13, birthday),
          anniversary = COALESCE($14, anniversary),
          notes = COALESCE($15, notes),
          updated_at = NOW()
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        RETURNING
          id,
          tenant_id,
          branch_id,
          code,
          first_name,
          last_name,
          phone,
          normalized_phone,
          email,
          wallet_balance_paise,
          0::BIGINT AS duplicate_count,
          last_visit_at,
          membership_label,
          categories_json::TEXT AS categories_json,
          birthday,
          anniversary,
          notes,
          active,
          preferred_staff_id,
          COALESCE((SELECT COALESCE(NULLIF(staff.appointment_display_name,''),CONCAT_WS(' ',staff.first_name,staff.last_name)) FROM staff WHERE staff.id=clients.preferred_staff_id),'') AS preferred_staff_name,
          preferred_communication_channel,
          whatsapp_opt_in,
          sms_opt_in,
          email_opt_in,
          merged_into_client_id,
          created_at,
          updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.id)
    .bind(input.code)
    .bind(input.first_name)
    .bind(input.last_name)
    .bind(input.phone)
    .bind(input.normalized_phone)
    .bind(input.email)
    .bind(input.membership_label)
    .bind(input.categories_json)
    .bind(input.active)
    .bind(input.birthday)
    .bind(input.anniversary)
    .bind(input.notes)
    .fetch_optional(db)
    .await
}

pub async fn set_client_active(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    active: bool,
    actor: &str,
    event_type: &str,
) -> Result<Option<ClientRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, ClientRecord>(
        r#"
        UPDATE clients
        SET active = $4, updated_at = NOW()
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3 AND merged_into_client_id IS NULL
        RETURNING
          id,
          tenant_id,
          branch_id,
          code,
          first_name,
          last_name,
          phone,
          normalized_phone,
          email,
          wallet_balance_paise,
          0::BIGINT AS duplicate_count,
          last_visit_at,
          membership_label,
          categories_json::TEXT AS categories_json,
          birthday,
          anniversary,
          notes,
          active,
          preferred_staff_id,
          COALESCE((SELECT COALESCE(NULLIF(staff.appointment_display_name,''),CONCAT_WS(' ',staff.first_name,staff.last_name)) FROM staff WHERE staff.id=clients.preferred_staff_id),'') AS preferred_staff_name,
          preferred_communication_channel,
          whatsapp_opt_in,
          sms_opt_in,
          email_opt_in,
          merged_into_client_id,
          created_at,
          updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(active)
    .fetch_optional(&mut *tx)
    .await?;
    if row.is_some() {
        record_audit_tx(
            &mut tx,
            tenant_id,
            branch_id,
            id,
            event_type,
            actor,
            serde_json::json!({ "active": active }),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(row)
}

fn select_sql(where_clause: &str) -> String {
    format!(
        r#"
        SELECT
          id,
          tenant_id,
          branch_id,
          code,
          first_name,
          last_name,
          phone,
          normalized_phone,
          email,
          wallet_balance_paise,
          CASE WHEN normalized_phone = '' THEN 0 ELSE (
            SELECT COUNT(*) - 1
              FROM clients duplicate_client
             WHERE duplicate_client.tenant_id = clients.tenant_id
               AND duplicate_client.branch_id = clients.branch_id
               AND duplicate_client.normalized_phone = clients.normalized_phone
               AND duplicate_client.active = TRUE
               AND duplicate_client.merged_into_client_id IS NULL
          ) END::BIGINT AS duplicate_count,
          last_visit_at,
          COALESCE((
            SELECT membership.name
              FROM client_memberships client_membership
              JOIN memberships membership
                ON membership.id = client_membership.membership_id
               AND membership.tenant_id = client_membership.tenant_id
               AND membership.branch_id = client_membership.branch_id
             WHERE client_membership.tenant_id = clients.tenant_id
               AND client_membership.branch_id = clients.branch_id
               AND (
                 client_membership.client_id = clients.id
                 OR EXISTS (
                   SELECT 1 FROM membership_family_members family
                    WHERE family.tenant_id = clients.tenant_id
                      AND family.branch_id = clients.branch_id
                      AND family.client_membership_id = client_membership.id
                      AND family.member_client_id = clients.id
                      AND family.active = TRUE
                 )
               )
               AND client_membership.active = TRUE
               AND (client_membership.expires_at IS NULL OR client_membership.expires_at >= NOW())
             ORDER BY client_membership.assigned_at DESC
             LIMIT 1
          ), membership_label) AS membership_label,
          categories_json::TEXT AS categories_json,
          birthday,
          anniversary,
          notes,
          active,
          preferred_staff_id,
          COALESCE((SELECT COALESCE(NULLIF(staff.appointment_display_name,''),CONCAT_WS(' ',staff.first_name,staff.last_name)) FROM staff WHERE staff.id=clients.preferred_staff_id),'') AS preferred_staff_name,
          preferred_communication_channel,
          whatsapp_opt_in,
          sms_opt_in,
          email_opt_in,
          merged_into_client_id,
          created_at,
          updated_at
        FROM clients
        {where_clause}
        "#
    )
}

#[cfg(test)]
mod tests {
    use super::{
        automation_candidates, branch_return_tracker, bulk_import, create_form_definition,
        create_form_submission, create_note, delete_treatment_photo, get_clinical_profile,
        get_treatment_photo, list_communications, list_form_definitions, list_notes,
        memory_relationships, save_clinical_profile, save_treatment_photo,
        update_treatment_photo,
    };
    use chrono::{DateTime, Utc};
    use serde_json::json;
    use sqlx::PgPool;
    use std::time::{Duration, Instant};

    #[sqlx::test(migrations = false)]
    async fn memory_graph_is_bounded_with_large_client_scope(pool: PgPool) {
        for statement in [
            "CREATE TABLE clients(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,merged_into_client_id TEXT,preferred_staff_id TEXT,preferred_communication_channel TEXT NOT NULL DEFAULT 'none',whatsapp_opt_in BOOLEAN,sms_opt_in BOOLEAN,email_opt_in BOOLEAN,categories_json JSONB NOT NULL DEFAULT '[]',wallet_balance_paise BIGINT NOT NULL DEFAULT 0)",
            "CREATE INDEX clients_scope ON clients(tenant_id,branch_id,id)",
            "CREATE TABLE pos_sales(id TEXT PRIMARY KEY,tenant_id TEXT,branch_id TEXT,client_id TEXT,status TEXT,created_at TIMESTAMPTZ DEFAULT NOW())",
            "CREATE TABLE pos_sale_lines(id TEXT PRIMARY KEY,tenant_id TEXT,branch_id TEXT,sale_id TEXT,line_type TEXT,item_id TEXT,item_name TEXT,quantity BIGINT,line_total_paise BIGINT,created_at TIMESTAMPTZ DEFAULT NOW())",
            "CREATE TABLE staff(id TEXT PRIMARY KEY,tenant_id TEXT,branch_id TEXT,appointment_display_name TEXT,first_name TEXT,last_name TEXT)",
            "CREATE TABLE appointments(id TEXT PRIMARY KEY,tenant_id TEXT,branch_id TEXT,client_id TEXT,staff_id TEXT,start_at TIMESTAMPTZ)",
            "CREATE TABLE memberships(id TEXT PRIMARY KEY,tenant_id TEXT,branch_id TEXT,name TEXT)",
            "CREATE TABLE client_memberships(id TEXT PRIMARY KEY,tenant_id TEXT,branch_id TEXT,client_id TEXT,membership_id TEXT,assigned_at TIMESTAMPTZ,expires_at TIMESTAMPTZ,active BOOLEAN)",
            "CREATE TABLE client_package_credits(id TEXT PRIMARY KEY,tenant_id TEXT,branch_id TEXT,client_id TEXT,package_id TEXT,package_name TEXT,remaining_qty INTEGER,expires_at DATE)",
            "CREATE TABLE client_notes(id TEXT PRIMARY KEY,tenant_id TEXT,branch_id TEXT,client_id TEXT,note_type TEXT,note TEXT,created_at TIMESTAMPTZ)",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO clients(id,tenant_id,branch_id) SELECT 'client-'||value,'tenant-1','branch-1' FROM GENERATE_SERIES(1,10000) value")
            .execute(&pool).await.unwrap();

        let started = Instant::now();
        let graph = memory_relationships(&pool, "tenant-1", "branch-1", "client-10000")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(graph["products"], json!([]));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[sqlx::test(migrations = false)]
    async fn automation_candidates_use_real_opted_in_client_state(pool: PgPool) {
        for statement in [
            "CREATE TABLE clients(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT NOT NULL,active BOOLEAN NOT NULL,merged_into_client_id TEXT,whatsapp_opt_in BOOLEAN,email_opt_in BOOLEAN,birthday DATE,anniversary DATE,wallet_balance_paise BIGINT NOT NULL,last_visit_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE TABLE client_intelligence_snapshots(client_id TEXT NOT NULL,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,recency_days INTEGER NOT NULL,snapshot_date DATE NOT NULL)",
            "CREATE TABLE client_memberships(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT NOT NULL,active BOOLEAN NOT NULL,expires_at TIMESTAMPTZ)",
            "CREATE TABLE client_review_links(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT NOT NULL,rating SMALLINT,reviewed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE TABLE appointments(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT NOT NULL,start_at TIMESTAMPTZ NOT NULL,status TEXT NOT NULL)",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO clients(id,tenant_id,branch_id,first_name,last_name,phone,email,active,whatsapp_opt_in,email_opt_in,wallet_balance_paise,last_visit_at) VALUES('client-1','tenant-1','branch-1','Real','Client','+919999999999','',TRUE,TRUE,FALSE,5000,NOW()-INTERVAL '60 days')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO client_intelligence_snapshots VALUES('client-1','tenant-1','branch-1',100,CURRENT_DATE)")
            .execute(&pool).await.unwrap();

        let candidates = automation_candidates(&pool, "tenant-1", "branch-1")
            .await
            .unwrap();

        assert!(candidates
            .iter()
            .any(|item| item.source_type == "wallet_reminder"));
        assert!(candidates.iter().any(|item| item.source_type == "win_back"));
    }

    #[sqlx::test(migrations = false)]
    async fn delivery_status_is_persisted_in_client_communications(pool: PgPool) {
        for statement in [
            "CREATE TABLE clients(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,merged_into_client_id TEXT)",
            "CREATE TABLE client_audit_events(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT NOT NULL,event_type TEXT NOT NULL,actor_user_id TEXT NOT NULL,details_json JSONB NOT NULL)",
            "CREATE TABLE pos_sales(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT,invoice_number TEXT NOT NULL)",
            "CREATE TABLE pos_invoice_outbox(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,sale_id TEXT NOT NULL,channel TEXT NOT NULL,recipient TEXT NOT NULL,payload_json JSONB NOT NULL,status TEXT NOT NULL,external_message_id TEXT NOT NULL DEFAULT '',last_error TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE TABLE benefit_notification_outbox(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT,source_type TEXT NOT NULL,channel TEXT NOT NULL,recipient TEXT NOT NULL,payload_json JSONB NOT NULL,status TEXT NOT NULL,provider_message_id TEXT NOT NULL DEFAULT '',last_error TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ)",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        sqlx::raw_sql(include_str!(
            "../../migrations/0117_client_communications_parity.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO clients VALUES('client-1','tenant-1','branch-1',NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO benefit_notification_outbox(id,tenant_id,branch_id,client_id,source_type,channel,recipient,payload_json,status) VALUES('message-1','tenant-1','branch-1','client-1','win_back','whatsapp','+919999999999','{\"message\":\"Return outreach\"}','queued')")
            .execute(&pool).await.unwrap();
        sqlx::query("UPDATE benefit_notification_outbox SET status='sent',provider_message_id='provider-1',updated_at=NOW() WHERE id='message-1'")
            .execute(&pool).await.unwrap();

        let history = list_communications(&pool, "tenant-1", "branch-1", "client-1")
            .await
            .unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].status, "sent");
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM client_audit_events WHERE tenant_id='tenant-1' AND branch_id='branch-1' AND client_id='client-1'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            2
        );
        assert!(
            list_communications(&pool, "tenant-1", "branch-2", "client-1")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[sqlx::test(migrations = false)]
    async fn return_tracker_is_branch_scoped_and_reports_roi(pool: PgPool) {
        for statement in [
            "CREATE TABLE clients(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL)",
            "CREATE TABLE client_win_back_offers(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT NOT NULL,offer_code TEXT NOT NULL,title TEXT NOT NULL,offered_discount_bps INTEGER NOT NULL,discount_cost_paise BIGINT NOT NULL,return_window_days INTEGER NOT NULL,status TEXT NOT NULL,issued_at TIMESTAMPTZ NOT NULL,redeemed_at TIMESTAMPTZ,returned_at TIMESTAMPTZ,revenue_after_return_paise BIGINT NOT NULL,offer_roi_bps INTEGER NOT NULL)",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO clients VALUES('client-1','tenant-1','branch-1','Real','Client'),('client-2','tenant-1','branch-2','Other','Branch')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO client_win_back_offers VALUES('offer-1','tenant-1','branch-1','client-1','RETURN','Return','1000',1000,30,'returned',NOW(),NOW(),NOW(),5000,40000),('offer-2','tenant-1','branch-2','client-2','OTHER','Other','1000',9000,30,'returned',NOW(),NOW(),NOW(),1000,-8889)")
            .execute(&pool).await.unwrap();

        let summary =
            branch_return_tracker(&pool, "tenant-1", "branch-1", "summary", 365, "", 100, 0)
                .await
                .unwrap();
        assert_eq!(summary["returnedCount"], 1);
        assert_eq!(summary["revenueAfterReturnPaise"], 5000);
        assert_eq!(summary["offerRoiBps"].as_f64(), Some(40_000.0));
        assert_eq!(
            branch_return_tracker(&pool, "tenant-1", "branch-1", "roi", 365, "", 100, 0)
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[sqlx::test(migrations = false)]
    async fn bulk_import_is_atomic_and_audited(pool: PgPool) {
        for statement in [
            "CREATE TABLE clients(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,code TEXT,first_name TEXT NOT NULL,last_name TEXT NOT NULL,phone TEXT NOT NULL,normalized_phone TEXT NOT NULL,email TEXT NOT NULL,membership_label TEXT NOT NULL,categories_json JSONB NOT NULL,birthday DATE,anniversary DATE,notes TEXT NOT NULL,active BOOLEAN NOT NULL,import_job_id TEXT)",
            "CREATE UNIQUE INDEX clients_phone_scope ON clients(tenant_id,branch_id,normalized_phone) WHERE normalized_phone<>''",
            "CREATE TABLE client_audit_events(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT NOT NULL,event_type TEXT NOT NULL,actor_user_id TEXT NOT NULL,details_json JSONB NOT NULL)",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        let rows = json!([
            {"code":"C1","first_name":"First","last_name":"Client","phone":"+919000000001","normalized_phone":"+919000000001","email":"","membership_label":"","categories_json":[],"birthday":null,"anniversary":null,"notes":"","active":true},
            {"code":"C2","first_name":"Second","last_name":"Client","phone":"+919000000002","normalized_phone":"+919000000002","email":"","membership_label":"","categories_json":[],"birthday":null,"anniversary":null,"notes":"","active":false}
        ]);
        assert_eq!(
            bulk_import(&pool, "tenant-1", "branch-1", &rows, "owner-1")
                .await
                .unwrap(),
            2
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM client_audit_events")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2
        );

        let duplicate_rows = json!([
            {"code":"C3","first_name":"Third","last_name":"Client","phone":"+919000000003","normalized_phone":"+919000000003","email":"","membership_label":"","categories_json":[],"birthday":null,"anniversary":null,"notes":"","active":true},
            {"code":"C4","first_name":"Fourth","last_name":"Client","phone":"+919000000003","normalized_phone":"+919000000003","email":"","membership_label":"","categories_json":[],"birthday":null,"anniversary":null,"notes":"","active":true}
        ]);
        assert!(
            bulk_import(&pool, "tenant-1", "branch-1", &duplicate_rows, "owner-1")
                .await
                .is_err()
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM clients")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2
        );
    }

    #[sqlx::test(migrations = false)]
    async fn client_note_scope_and_last_visit_trigger_are_real(pool: PgPool) {
        for statement in [
            "CREATE TABLE clients (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,merged_into_client_id TEXT,last_visit_at TIMESTAMPTZ,updated_at TIMESTAMPTZ)",
            "CREATE TABLE appointments (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT NOT NULL,start_at TIMESTAMPTZ NOT NULL,status TEXT NOT NULL)",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        sqlx::raw_sql(include_str!("../../migrations/0102_client_360_phase1.sql"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO clients (id,tenant_id,branch_id) VALUES ('client-1','tenant-1','branch-1')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO appointments VALUES ('appointment-1','tenant-1','branch-1','client-1','2020-07-14T09:00:00Z','completed')")
            .execute(&pool).await.unwrap();

        assert_eq!(
            sqlx::query_scalar::<_, DateTime<Utc>>(
                "SELECT last_visit_at FROM clients WHERE id='client-1'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "2020-07-14T09:00:00Z".parse::<DateTime<Utc>>().unwrap()
        );
        create_note(
            &pool,
            "tenant-1",
            "branch-1",
            "client-1",
            "preference",
            "Prefers quiet appointments",
            "owner-1",
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            list_notes(&pool, "tenant-1", "branch-1", "client-1")
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(list_notes(&pool, "tenant-1", "branch-2", "client-1")
            .await
            .unwrap()
            .is_empty());
    }

    #[sqlx::test(migrations = false)]
    async fn client_forms_consent_version_and_media_scope_are_real(pool: PgPool) {
        for statement in [
            "CREATE TABLE clients (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,merged_into_client_id TEXT)",
            "CREATE TABLE appointments (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT NOT NULL)",
            "CREATE TABLE client_audit_events(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT NOT NULL,event_type TEXT NOT NULL,actor_user_id TEXT NOT NULL,details_json JSONB NOT NULL)",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        sqlx::raw_sql(include_str!(
            "../../migrations/0103_client_forms_consent.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("ALTER TABLE client_treatment_photos ADD COLUMN photo_type TEXT NOT NULL DEFAULT 'other'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO clients VALUES ('client-1','tenant-1','branch-1')")
            .execute(&pool)
            .await
            .unwrap();

        let fields =
            json!([{"key":"all_clear","label":"All clear","type":"boolean","required":true}]);
        let first = create_form_definition(
            &pool,
            "tenant-1",
            "branch-1",
            "service-consent",
            "Service consent",
            "consent",
            "",
            &fields,
            true,
            "owner-1",
        )
        .await
        .unwrap();
        let second = create_form_definition(
            &pool,
            "tenant-1",
            "branch-1",
            "service-consent",
            "Service consent",
            "consent",
            "Updated terms",
            &fields,
            true,
            "owner-1",
        )
        .await
        .unwrap();
        assert_eq!((first.version, second.version), (1, 2));
        assert_eq!(
            list_form_definitions(&pool, "tenant-1", "branch-1")
                .await
                .unwrap()[0]
                .version,
            2
        );

        let profile = save_clinical_profile(
            &pool,
            "tenant-1",
            "branch-1",
            "client-1",
            "Latex",
            "Quiet room",
            0,
            "owner-1",
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(profile.version, 1);
        assert!(
            get_clinical_profile(&pool, "tenant-1", "branch-2", "client-1")
                .await
                .unwrap()
                .is_none()
        );

        let submission = create_form_submission(
            &pool,
            "tenant-1",
            "branch-1",
            "client-1",
            &second.id,
            &json!({"all_clear":true}),
            "Client One",
            "signature-hash",
            "owner-1",
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(submission.form_version, 2);

        let photo = save_treatment_photo(
            &pool,
            "tenant-1",
            "branch-1",
            "client-1",
            None,
            "Before service",
            "before.png",
            "image/png",
            "photo-hash",
            "before",
            vec![1, 2, 3],
            "owner-1",
        )
        .await
        .unwrap()
        .unwrap();
        assert!(
            get_treatment_photo(&pool, "tenant-1", "branch-2", "client-1", &photo.id)
                .await
                .unwrap()
                .is_none()
        );

        assert!(update_treatment_photo(
            &pool,
            "tenant-1",
            "branch-2",
            "client-1",
            &photo.id,
            Some("Should not apply"),
            Some("after"),
        )
        .await
        .unwrap()
        .is_none());
        let updated = update_treatment_photo(
            &pool,
            "tenant-1",
            "branch-1",
            "client-1",
            &photo.id,
            Some("After service"),
            Some("after"),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(updated.caption, "After service");
        assert_eq!(updated.photo_type, "after");

        // Partial update omitting photoType must preserve the existing value, not reset it.
        let caption_only = update_treatment_photo(
            &pool,
            "tenant-1",
            "branch-1",
            "client-1",
            &photo.id,
            Some("After service, redone"),
            None,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(caption_only.caption, "After service, redone");
        assert_eq!(caption_only.photo_type, "after");

        // Partial update omitting caption must preserve the existing value, not blank it.
        let type_only = update_treatment_photo(
            &pool,
            "tenant-1",
            "branch-1",
            "client-1",
            &photo.id,
            None,
            Some("other"),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(type_only.caption, "After service, redone");
        assert_eq!(type_only.photo_type, "other");

        assert!(
            !delete_treatment_photo(&pool, "tenant-1", "branch-2", "client-1", &photo.id, "owner-1")
                .await
                .unwrap()
        );
        assert!(
            delete_treatment_photo(&pool, "tenant-1", "branch-1", "client-1", &photo.id, "owner-1")
                .await
                .unwrap()
        );
        assert!(
            get_treatment_photo(&pool, "tenant-1", "branch-1", "client-1", &photo.id)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM client_audit_events WHERE event_type='client.photo.deleted' AND client_id='client-1'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
    }
}
