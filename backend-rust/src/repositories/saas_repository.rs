use chrono::{DateTime, Months, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct OnboardingWrite {
    pub idempotency_key: String,
    pub request_fingerprint: String,
    pub salon_name: String,
    pub salon_slug: String,
    pub plan_id: String,
    pub owner_full_name: String,
    pub owner_email: String,
    pub owner_password_hash: String,
    pub owner_permissions: Value,
    pub manager_permissions: Value,
    pub staff_permissions: Value,
    pub branch_name: String,
    pub branch_code: String,
    pub branch_address: String,
    pub domain: Option<String>,
    pub started_at: DateTime<Utc>,
    pub trial_ends_at: DateTime<Utc>,
    pub actor: String,
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingResult {
    pub tenant_id: String,
    pub branch_id: String,
    pub owner_user_id: String,
    pub subscription_id: String,
    pub trial_ends_at: DateTime<Utc>,
    pub domain_mapping_id: Option<String>,
    pub domain: Option<String>,
    pub domain_verified: Option<bool>,
    pub replayed: bool,
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantAdminRecord {
    pub id: String,
    pub full_name: String,
    pub login_id: String,
    pub email: String,
    pub active: bool,
    pub must_change_password: bool,
    pub branch_count: i64,
    pub created_at: DateTime<Utc>,
}

pub struct TenantAdminWrite<'a> {
    pub tenant_id: &'a str,
    pub default_branch_id: &'a str,
    pub full_name: &'a str,
    pub login_id: &'a str,
    pub email: &'a str,
    pub password_hash: &'a str,
    pub actor: &'a str,
}

#[derive(Debug)]
pub enum OnboardingError {
    Database(sqlx::Error),
    IdempotencyConflict,
    PlanUnavailable,
    TrialOutsideFirstPeriod,
}

impl From<sqlx::Error> for OnboardingError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

#[derive(Debug, Clone)]
pub struct SlaWrite {
    pub severity: String,
    pub first_response_minutes: i32,
    pub resolution_minutes: i32,
    pub business_hours_only: bool,
}

#[derive(Debug, Clone)]
pub struct PlanWrite {
    pub code: String,
    pub name: String,
    pub billing_interval: String,
    pub base_price_paise: i64,
    pub included_branches: i32,
    pub included_users: i32,
    pub included_appointments: i32,
    pub overage_branch_paise: i64,
    pub overage_user_paise: i64,
    pub overage_appointment_paise: i64,
    pub features: Value,
    pub active: bool,
    pub sla: Vec<SlaWrite>,
}

#[derive(Debug, Clone, FromRow)]
pub struct BillingContext {
    pub subscription_id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub status: String,
    pub trial_ends_at: Option<DateTime<Utc>>,
    pub billing_interval: String,
    pub base_price_paise: i64,
    pub included_branches: i32,
    pub included_users: i32,
    pub included_appointments: i32,
    pub overage_branch_paise: i64,
    pub overage_user_paise: i64,
    pub overage_appointment_paise: i64,
    pub current_period_start: DateTime<Utc>,
    pub current_period_end: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ProviderPlanContext {
    pub id: String,
    pub name: String,
    pub billing_interval: String,
    pub base_price_paise: i64,
    pub version: i32,
}

#[derive(Debug, Clone, FromRow)]
pub struct ProviderSubscriptionContext {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub plan_id: String,
    pub provider_subscription_ref: String,
    pub status: String,
}

pub struct ProviderEventWrite<'a> {
    pub provider_event_id: &'a str,
    pub event_type: &'a str,
    pub payload_sha256: &'a str,
    pub provider_created_at: Option<DateTime<Utc>>,
    pub provider_subscription_ref: &'a str,
    pub provider_status: &'a str,
    pub local_status: Option<&'a str>,
    pub provider_plan_ref: &'a str,
    pub period_start: Option<DateTime<Utc>>,
    pub period_end: Option<DateTime<Utc>>,
    pub payment_ref: &'a str,
    pub payment_amount_paise: i64,
    pub payment_currency: &'a str,
    pub payment_method: &'a str,
    pub payment_status: &'a str,
    pub dunning: bool,
}

#[derive(Debug, Clone, FromRow)]
pub struct RefundReservation {
    pub refund_id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub invoice_id: Option<String>,
    pub provider_payment_ref: String,
    pub replayed: bool,
    pub status: String,
    pub provider_refund_ref: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct TicketSlaContext {
    pub subscription_id: String,
    pub plan_id: String,
    pub first_response_minutes: i32,
    pub resolution_minutes: i32,
    pub business_hours_only: bool,
}

#[derive(Debug, Clone)]
pub struct SupportAttachmentWrite {
    pub file_name: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
    pub sha256: String,
}

pub struct SupportEmailWrite<'a> {
    pub provider_event_id: &'a str,
    pub ses_message_id: &'a str,
    pub payload_sha256: &'a str,
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub sender_email: &'a str,
    pub subject: &'a str,
    pub body: &'a str,
    pub email_message_id: &'a str,
    pub in_reply_to: &'a str,
    pub references: &'a [String],
    pub category: &'a str,
    pub severity: &'a str,
    pub priority: &'a str,
    pub queue_key: &'a str,
    pub ticket_number: &'a str,
    pub subscription_id: &'a str,
    pub plan_id: &'a str,
    pub first_response_due_at: DateTime<Utc>,
    pub resolution_due_at: DateTime<Utc>,
    pub attachments: &'a [SupportAttachmentWrite],
}

#[derive(Debug, FromRow)]
pub struct SupportAttachmentDownload {
    pub file_name: String,
    pub content_type: String,
    pub content: Vec<u8>,
}

#[derive(Debug, FromRow)]
pub struct SupportEmailDelivery {
    pub id: String,
    pub recipient: String,
    pub subject: String,
    pub body: String,
    pub outbound_message_id: String,
    pub in_reply_to: String,
    pub references_header: String,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub branch_count: i64,
    pub active_user_count: i64,
    pub appointment_count: i64,
    pub api_calls: i64,
    pub messages: i64,
    pub storage_mb: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct EntitlementContext {
    pub tenant_status: String,
    pub subscription_status: Option<String>,
    pub features_json: Option<Value>,
    pub included_branches: Option<i32>,
    pub overage_branch_paise: Option<i64>,
    pub active_branch_count: i64,
}

const ENTITLEMENT_CONTEXT_SQL: &str = r#"
    SELECT tenant.status AS tenant_status,
           subscription.status AS subscription_status,
           subscription.features_json,
           subscription.included_branches,
           subscription.overage_branch_paise,
           (SELECT COUNT(*) FROM branches branch
             WHERE branch.tenant_id=tenant.id AND branch.active=TRUE) AS active_branch_count
      FROM tenants tenant
      LEFT JOIN LATERAL (
        SELECT current.status,plan.features_json,plan.included_branches,plan.overage_branch_paise
          FROM saas_subscriptions current
          JOIN saas_plans plan ON plan.id=current.plan_id
         WHERE current.tenant_id=tenant.id::text
         ORDER BY CASE WHEN current.status IN ('trialing','active','past_due','paused')
                       THEN 0 ELSE 1 END,
                  current.created_at DESC
         LIMIT 1
      ) subscription ON TRUE
     WHERE tenant.id::text=$1
"#;

pub async fn entitlement_context(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Option<EntitlementContext>, sqlx::Error> {
    sqlx::query_as(ENTITLEMENT_CONTEXT_SQL)
        .bind(tenant_id)
        .fetch_optional(db)
        .await
}

pub async fn entitlement_context_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
) -> Result<Option<EntitlementContext>, sqlx::Error> {
    sqlx::query_as(ENTITLEMENT_CONTEXT_SQL)
        .bind(tenant_id)
        .fetch_optional(&mut **tx)
        .await
}

pub async fn onboard_salon(
    db: &PgPool,
    input: &OnboardingWrite,
) -> Result<OnboardingResult, OnboardingError> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(&input.idempotency_key)
        .execute(&mut *tx)
        .await?;

    if let Some(mut existing) = sqlx::query_as::<_, OnboardingResult>(
        r#"SELECT request.tenant_id,request.branch_id,request.owner_user_id,
                  request.subscription_id,subscription.trial_ends_at,
                  request.domain_mapping_id,domain.domain,domain.verified AS domain_verified,
                  TRUE AS replayed
             FROM saas_onboarding_requests request
             JOIN saas_subscriptions subscription ON subscription.id=request.subscription_id
             LEFT JOIN tenant_domain_mappings domain ON domain.id=request.domain_mapping_id
            WHERE request.idempotency_key=$1 AND request.request_fingerprint=$2"#,
    )
    .bind(&input.idempotency_key)
    .bind(&input.request_fingerprint)
    .fetch_optional(&mut *tx)
    .await?
    {
        existing.replayed = true;
        tx.commit().await?;
        return Ok(existing);
    }
    if sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM saas_onboarding_requests WHERE idempotency_key=$1)",
    )
    .bind(&input.idempotency_key)
    .fetch_one(&mut *tx)
    .await?
    {
        return Err(OnboardingError::IdempotencyConflict);
    }

    let billing_interval = sqlx::query_scalar::<_, String>(
        "SELECT billing_interval FROM saas_plans WHERE id=$1 AND active=TRUE FOR SHARE",
    )
    .bind(&input.plan_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(OnboardingError::PlanUnavailable)?;
    let period_end = input
        .started_at
        .checked_add_months(Months::new(if billing_interval == "yearly" {
            12
        } else {
            1
        }))
        .ok_or(OnboardingError::TrialOutsideFirstPeriod)?;
    if input.trial_ends_at <= input.started_at || input.trial_ends_at > period_end {
        return Err(OnboardingError::TrialOutsideFirstPeriod);
    }

    let tenant_id = Uuid::new_v4().to_string();
    let branch_id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO tenants(id,name,slug,status,scope_id) VALUES($1::uuid,$2,$3,'active',$1)",
    )
    .bind(&tenant_id)
    .bind(&input.salon_name)
    .bind(&input.salon_slug)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO branches(id,tenant_id,name,code,address,active,scope_id)
           VALUES($1::uuid,$2::uuid,$3,$4,$5,TRUE,$1)"#,
    )
    .bind(&branch_id)
    .bind(&tenant_id)
    .bind(&input.branch_name)
    .bind(&input.branch_code)
    .bind(&input.branch_address)
    .execute(&mut *tx)
    .await?;

    let owner_role_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO roles(tenant_id,name,permissions_json,is_system)
           VALUES($1,'Owner',$2,TRUE) RETURNING id"#,
    )
    .bind(&tenant_id)
    .bind(&input.owner_permissions)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO roles(tenant_id,name,permissions_json,is_system) VALUES
           ($1,'Admin',$2,TRUE),($1,'Manager',$3,TRUE),($1,'Staff',$4,TRUE)"#,
    )
    .bind(&tenant_id)
    .bind(&input.owner_permissions)
    .bind(&input.manager_permissions)
    .bind(&input.staff_permissions)
    .execute(&mut *tx)
    .await?;
    let owner_user_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO users(
             tenant_id,branch_id,role_id,role_name,login_id,email,password_hash,full_name,
             active,must_change_password,password_changed_at
           ) VALUES($1,$2,$3,'Owner',$4,$4,$5,$6,TRUE,TRUE,NULL) RETURNING id"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&owner_role_id)
    .bind(&input.owner_email)
    .bind(&input.owner_password_hash)
    .bind(&input.owner_full_name)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO user_branch_roles(
             tenant_id,user_id,branch_id,role_id,role_name,is_default,active
           ) VALUES($1,$2,$3,$4,'Owner',TRUE,TRUE)"#,
    )
    .bind(&tenant_id)
    .bind(&owner_user_id)
    .bind(&branch_id)
    .bind(&owner_role_id)
    .execute(&mut *tx)
    .await?;

    let subscription_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO saas_subscriptions(
             tenant_id,plan_id,status,current_period_start,current_period_end,trial_ends_at,
             provider,created_by,updated_by
           ) VALUES($1,$2,'trialing',$3,$4,$5,'manual',$6,$6) RETURNING id"#,
    )
    .bind(&tenant_id)
    .bind(&input.plan_id)
    .bind(input.started_at)
    .bind(period_end)
    .bind(input.trial_ends_at)
    .bind(&input.actor)
    .fetch_one(&mut *tx)
    .await?;

    let domain_mapping_id = if let Some(domain) = input.domain.as_deref() {
        Some(
            sqlx::query_scalar::<_, String>(
                r#"INSERT INTO tenant_domain_mappings(tenant_id,domain,created_by)
                   VALUES($1,$2,$3) RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(domain)
            .bind(&input.actor)
            .fetch_one(&mut *tx)
            .await?,
        )
    } else {
        None
    };

    sqlx::query(
        r#"INSERT INTO saas_onboarding_requests(
             idempotency_key,request_fingerprint,tenant_id,branch_id,owner_user_id,
             subscription_id,domain_mapping_id,created_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)"#,
    )
    .bind(&input.idempotency_key)
    .bind(&input.request_fingerprint)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&owner_user_id)
    .bind(&subscription_id)
    .bind(&domain_mapping_id)
    .bind(&input.actor)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO auth_audit_logs(
             tenant_id,user_id,branch_id,event_type,outcome,details_json
           ) VALUES($1,$2,$3,'saas.onboarding.completed','success',$4)"#,
    )
    .bind(&tenant_id)
    .bind(&input.actor)
    .bind(&branch_id)
    .bind(json!({
        "ownerUserId": owner_user_id,
        "subscriptionId": subscription_id,
        "domainMappingId": domain_mapping_id,
    }))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(OnboardingResult {
        tenant_id,
        branch_id,
        owner_user_id,
        subscription_id,
        trial_ends_at: input.trial_ends_at,
        domain_mapping_id,
        domain: input.domain.clone(),
        domain_verified: input.domain.as_ref().map(|_| false),
        replayed: false,
    })
}

pub async fn list_tenant_admins(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Vec<TenantAdminRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT u.id,u.full_name,COALESCE(u.login_id,'') AS login_id,u.email,u.active,
                  u.must_change_password,COUNT(DISTINCT ubr.branch_id) AS branch_count,u.created_at
             FROM users u
             LEFT JOIN user_branch_roles ubr ON ubr.tenant_id=u.tenant_id AND ubr.user_id=u.id AND ubr.active=TRUE
            WHERE u.tenant_id=$1
              AND REGEXP_REPLACE(LOWER(u.role_name),'[-_ ]','','g')='admin'
            GROUP BY u.id,u.full_name,u.login_id,u.email,u.active,u.must_change_password,u.created_at
            ORDER BY u.created_at DESC"#,
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
}

pub async fn create_tenant_admin(
    db: &PgPool,
    input: &TenantAdminWrite<'_>,
) -> Result<TenantAdminRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let role_id = sqlx::query_scalar::<_, String>(
        r#"SELECT id FROM roles WHERE tenant_id=$1 AND is_system=TRUE
             AND REGEXP_REPLACE(LOWER(name),'[-_ ]','','g')='admin' LIMIT 1 FOR SHARE"#,
    )
    .bind(input.tenant_id)
    .fetch_one(&mut *tx)
    .await?;
    let default_branch_exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(SELECT 1 FROM tenants t JOIN branches b ON b.tenant_id=t.id AND b.active=TRUE
            WHERE COALESCE(NULLIF(t.scope_id,''),t.id::text)=$1
              AND COALESCE(NULLIF(b.scope_id,''),b.id::text)=$2)"#,
    )
    .bind(input.tenant_id)
    .bind(input.default_branch_id)
    .fetch_one(&mut *tx)
    .await?;
    if !default_branch_exists {
        return Err(sqlx::Error::RowNotFound);
    }
    let user_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO users(tenant_id,branch_id,role_id,role_name,login_id,email,password_hash,
             full_name,active,must_change_password,password_changed_at)
           VALUES($1,$2,$3,'Admin',$4,$5,$6,$7,TRUE,TRUE,NULL) RETURNING id"#,
    )
    .bind(input.tenant_id)
    .bind(input.default_branch_id)
    .bind(&role_id)
    .bind(input.login_id)
    .bind(input.email)
    .bind(input.password_hash)
    .bind(input.full_name)
    .fetch_one(&mut *tx)
    .await?;
    let branch_count = sqlx::query(
        r#"INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_id,role_name,is_default,active)
           SELECT $1,$2,COALESCE(NULLIF(b.scope_id,''),b.id::text),$3,'Admin',
                  COALESCE(NULLIF(b.scope_id,''),b.id::text)=$4,TRUE
             FROM tenants t JOIN branches b ON b.tenant_id=t.id AND b.active=TRUE
            WHERE COALESCE(NULLIF(t.scope_id,''),t.id::text)=$1"#,
    )
    .bind(input.tenant_id)
    .bind(&user_id)
    .bind(&role_id)
    .bind(input.default_branch_id)
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;
    sqlx::query(
        r#"INSERT INTO auth_audit_logs(tenant_id,user_id,branch_id,event_type,outcome,details_json)
           VALUES($1,$2,$3,'tenant_admin.created','success',$4)"#,
    )
    .bind(input.tenant_id)
    .bind(input.actor)
    .bind(input.default_branch_id)
    .bind(json!({"createdUserId":user_id,"branchCount":branch_count}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(TenantAdminRecord {
        id: user_id,
        full_name: input.full_name.to_string(),
        login_id: input.login_id.to_string(),
        email: input.email.to_string(),
        active: true,
        must_change_password: true,
        branch_count,
        created_at: Utc::now(),
    })
}

pub async fn platform_overview(db: &PgPool) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'activePlans',(SELECT COUNT(*) FROM saas_plans WHERE tenant_id='platform' AND branch_id='global' AND active=TRUE),
          'activeSubscriptions',(SELECT COUNT(*) FROM saas_subscriptions WHERE status IN ('trialing','active')),
          'pastDueSubscriptions',(SELECT COUNT(*) FROM saas_subscriptions WHERE status='past_due'),
          'outstandingPaise',(SELECT COALESCE(SUM(total_paise-paid_paise),0) FROM saas_invoices WHERE status IN ('issued','partially_paid','overdue')),
          'openTickets',(SELECT COUNT(*) FROM saas_support_tickets WHERE status NOT IN ('resolved','closed')),
          'breachedTickets',(SELECT COUNT(*) FROM saas_support_tickets WHERE status NOT IN ('resolved','closed') AND resolution_due_at<NOW())
        )"#,
    )
    .fetch_one(db)
    .await
}

pub async fn platform_reports(db: &PgPool, days: i32) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar::<_, Value>(
        r#"WITH params AS (
          SELECT NOW() AS period_end, NOW()-make_interval(days=>$1) AS period_start
        ), recurring AS (
          SELECT COALESCE(ROUND(SUM(CASE WHEN p.billing_interval='yearly'
            THEN p.base_price_paise::NUMERIC/12 ELSE p.base_price_paise END)),0)::BIGINT AS mrr_paise
          FROM saas_subscriptions s JOIN saas_plans p ON p.id=s.plan_id
          WHERE s.status IN ('active','past_due')
        ), trial_cohort AS (
          SELECT s.id, (
            s.status IN ('active','past_due','paused')
            OR EXISTS(SELECT 1 FROM saas_provider_events e WHERE e.subscription_id=s.id
              AND e.received_at BETWEEN s.created_at AND p.period_end AND e.status='processed'
              AND e.event_type IN ('subscription.activated','subscription.charged','subscription.resumed','payment.captured'))
            OR EXISTS(SELECT 1 FROM auth_audit_logs a WHERE a.tenant_id='platform'
              AND a.created_at BETWEEN s.created_at AND p.period_end
              AND a.event_type='security.saas.subscription.updated'
              AND a.details_json->>'subscriptionId'=s.id AND a.details_json->>'status'='active')
          ) AS converted
          FROM saas_subscriptions s, params p
          WHERE s.trial_ends_at>=p.period_start AND s.trial_ends_at<=p.period_end
        ), trial_metrics AS (
          SELECT COUNT(*) AS eligible, COUNT(*) FILTER(WHERE converted) AS converted FROM trial_cohort
        ), churn_metrics AS (
          SELECT COUNT(*) FILTER(WHERE cancelled_at>=p.period_start AND cancelled_at<=p.period_end) AS churned,
            COUNT(*) FILTER(WHERE status IN ('active','past_due','paused'))+
            COUNT(*) FILTER(WHERE cancelled_at>=p.period_start AND cancelled_at<=p.period_end) AS base
          FROM saas_subscriptions, params p
        ), invoice_metrics AS (
          SELECT COUNT(*) FILTER(WHERE status<>'void' AND total_paise>paid_paise) AS outstanding_count,
            COALESCE(SUM(total_paise-paid_paise) FILTER(WHERE status<>'void' AND total_paise>paid_paise),0)::BIGINT AS outstanding_paise,
            COALESCE(SUM(usage_amount_paise) FILTER(WHERE status<>'void' AND issued_at>=p.period_start AND issued_at<=p.period_end),0)::BIGINT AS overage_paise
          FROM saas_invoices, params p
        ), support_scope AS (
          SELECT t.*,
            ((t.first_response_due_at IS NOT NULL AND COALESCE(t.first_responded_at,NOW())>t.first_response_due_at)
              OR (t.resolution_due_at IS NOT NULL AND COALESCE(t.resolved_at,NOW())>t.resolution_due_at)) AS sla_breached
          FROM saas_support_tickets t, params p
          WHERE t.created_at>=p.period_start AND t.created_at<=p.period_end AND t.merged_into_ticket_id IS NULL
        ), support_metrics AS (
          SELECT COUNT(*) AS tickets,
            COUNT(*) FILTER(WHERE sla_breached) AS breached,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (first_responded_at-created_at))/60) FILTER(WHERE first_responded_at IS NOT NULL),2),0) AS response_minutes,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at-created_at))/60) FILTER(WHERE resolved_at IS NOT NULL),2),0) AS resolution_minutes
          FROM support_scope
        ), invoice_balance AS (
          SELECT subscription_id, COALESCE(SUM(total_paise-paid_paise) FILTER(WHERE status<>'void' AND total_paise>paid_paise),0)::BIGINT AS outstanding_paise,
            BOOL_OR(status='overdue' AND total_paise>paid_paise) AS has_overdue
          FROM saas_invoices GROUP BY subscription_id
        ), renewal_risk AS (
          SELECT s.id,s.tenant_id,COALESCE((SELECT t.name FROM tenants t WHERE COALESCE(NULLIF(t.scope_id,''),t.id::TEXT)=s.tenant_id LIMIT 1),s.tenant_id) AS tenant_name,
            p.name AS plan_name,s.status,s.current_period_end,COALESCE(i.outstanding_paise,0) AS outstanding_paise,
            ROUND(CASE WHEN p.billing_interval='yearly' THEN p.base_price_paise::NUMERIC/12 ELSE p.base_price_paise END)::BIGINT AS mrr_paise,
            CASE WHEN s.cancel_at_period_end THEN 'Scheduled cancellation' WHEN s.status='past_due' THEN 'Payment past due'
              WHEN s.status='paused' THEN 'Subscription paused' ELSE 'Overdue invoice near renewal' END AS reason,
            CASE WHEN s.cancel_at_period_end OR s.status='past_due' THEN 2 ELSE 1 END AS risk_score
          FROM saas_subscriptions s JOIN saas_plans p ON p.id=s.plan_id
          LEFT JOIN invoice_balance i ON i.subscription_id=s.id
          WHERE s.status IN ('active','past_due','paused') AND (
            s.cancel_at_period_end OR s.status IN ('past_due','paused')
            OR (COALESCE(i.has_overdue,FALSE) AND s.current_period_end<=NOW()+INTERVAL '14 days'))
        ), agent_metrics AS (
          SELECT assigned_to AS agent_id,COUNT(*) AS assigned_tickets,
            COUNT(*) FILTER(WHERE resolved_at IS NOT NULL) AS resolved_tickets,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (first_responded_at-created_at))/60) FILTER(WHERE first_responded_at IS NOT NULL),2),0) AS response_minutes,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at-created_at))/60) FILTER(WHERE resolved_at IS NOT NULL),2),0) AS resolution_minutes,
            COALESCE(ROUND(100.0*COUNT(*) FILTER(WHERE sla_breached)/NULLIF(COUNT(*),0),2),0) AS breach_percent,
            COALESCE(ROUND(AVG(c.rating),2),0) AS csat
          FROM support_scope s LEFT JOIN saas_support_csat c ON c.ticket_id=s.id
          WHERE COALESCE(assigned_to,'')<>'' GROUP BY assigned_to
        )
        SELECT jsonb_build_object(
          'periodDays',$1,'periodStart',p.period_start,'periodEnd',p.period_end,
          'mrrPaise',r.mrr_paise,'arrPaise',r.mrr_paise*12,
          'trialEligible',tm.eligible,'trialConverted',tm.converted,
          'trialConversionPercent',COALESCE(ROUND(100.0*tm.converted/NULLIF(tm.eligible,0),2),0),
          'churnedSubscriptions',cm.churned,'churnRatePercent',COALESCE(ROUND(100.0*cm.churned/NULLIF(cm.base,0),2),0),
          'outstandingInvoiceCount',im.outstanding_count,'outstandingPaise',im.outstanding_paise,
          'usageOverageRevenuePaise',im.overage_paise,
          'supportTickets',sm.tickets,'averageFirstResponseMinutes',sm.response_minutes,
          'averageResolutionMinutes',sm.resolution_minutes,'slaBreachedTickets',sm.breached,
          'slaBreachPercent',COALESCE(ROUND(100.0*sm.breached/NULLIF(sm.tickets,0),2),0),
          'renewalRiskCount',(SELECT COUNT(*) FROM renewal_risk),
          'renewalRiskMrrPaise',COALESCE((SELECT SUM(mrr_paise) FROM renewal_risk),0),
          'renewalRisk',COALESCE((SELECT jsonb_agg(jsonb_build_object('subscriptionId',id,'tenantId',tenant_id,'tenantName',tenant_name,'planName',plan_name,'status',status,'periodEnd',current_period_end,'outstandingPaise',outstanding_paise,'mrrPaise',mrr_paise,'riskLevel',CASE WHEN risk_score=2 THEN 'high' ELSE 'medium' END,'reason',reason) ORDER BY risk_score DESC,current_period_end) FROM renewal_risk),'[]'::JSONB),
          'supportAgents',COALESCE((SELECT jsonb_agg(jsonb_build_object('agentId',agent_id,'assignedTickets',assigned_tickets,'resolvedTickets',resolved_tickets,'averageFirstResponseMinutes',response_minutes,'averageResolutionMinutes',resolution_minutes,'slaBreachPercent',breach_percent,'csatAverage',csat) ORDER BY resolved_tickets DESC,agent_id) FROM agent_metrics),'[]'::JSONB)
        ) FROM params p CROSS JOIN recurring r CROSS JOIN trial_metrics tm CROSS JOIN churn_metrics cm CROSS JOIN invoice_metrics im CROSS JOIN support_metrics sm"#,
    )
    .bind(days)
    .fetch_one(db)
    .await
}

pub async fn list_tenants(db: &PgPool) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar::<_, Value>(
        r#"WITH tenant_rows AS (
          SELECT t.*, COALESCE(NULLIF(t.scope_id,''),t.id::TEXT) AS tenant_scope_id
          FROM tenants t
          WHERE COALESCE(NULLIF(t.scope_id,''),t.id::TEXT)<>'platform'
        )
        SELECT jsonb_build_object(
          'id',t.tenant_scope_id,'name',t.name,'slug',COALESCE(t.slug,''),'status',t.status,
          'branchCount',(SELECT COUNT(*) FROM branches b WHERE b.tenant_id=t.id AND b.active=TRUE),
          'subBranchCount',(SELECT COUNT(*) FROM branches b LEFT JOIN franchise_policies fp ON fp.tenant_id=t.tenant_scope_id WHERE b.tenant_id=t.id AND b.active=TRUE AND fp.central_branch_id IS NOT NULL AND b.id::TEXT<>fp.central_branch_id),
          'centralBranchName',COALESCE((SELECT b.name FROM franchise_policies fp JOIN branches b ON b.tenant_id=t.id AND b.id::TEXT=fp.central_branch_id WHERE fp.tenant_id=t.tenant_scope_id LIMIT 1),''),
          'activeUserCount',(SELECT COUNT(*) FROM users u WHERE u.tenant_id=t.tenant_scope_id AND u.active=TRUE),
          'ownerCount',(SELECT COUNT(*) FROM users u WHERE u.tenant_id=t.tenant_scope_id AND u.active=TRUE AND REGEXP_REPLACE(LOWER(u.role_name), '[-_ ]', '', 'g')='owner'),
          'adminCount',(SELECT COUNT(*) FROM users u WHERE u.tenant_id=t.tenant_scope_id AND u.active=TRUE AND REGEXP_REPLACE(LOWER(u.role_name), '[-_ ]', '', 'g') IN ('admin','tenantadmin','salonadmin')),
          'branchAdminCount',(SELECT COUNT(DISTINCT ubr.user_id) FROM user_branch_roles ubr WHERE ubr.tenant_id=t.tenant_scope_id AND ubr.active=TRUE AND REGEXP_REPLACE(LOWER(ubr.role_name), '[-_ ]', '', 'g') IN ('branchadmin','manager')),
          'staffCount',(SELECT COUNT(*) FROM staff s WHERE s.tenant_id=t.tenant_scope_id AND s.active=TRUE),
          'subscriptionStatus',COALESCE((SELECT s.status FROM saas_subscriptions s WHERE s.tenant_id=t.tenant_scope_id ORDER BY s.created_at DESC LIMIT 1),'none'),
          'subscriptionPlan',COALESCE((SELECT p.name FROM saas_subscriptions s JOIN saas_plans p ON p.id=s.plan_id WHERE s.tenant_id=t.tenant_scope_id ORDER BY s.created_at DESC LIMIT 1),''),
          'subscriptionPeriodEnd',(SELECT s.current_period_end FROM saas_subscriptions s WHERE s.tenant_id=t.tenant_scope_id ORDER BY s.created_at DESC LIMIT 1)
        ) FROM tenant_rows t
        ORDER BY t.status='active' DESC,t.name LIMIT 1000"#,
    )
    .fetch_all(db)
    .await
}

pub async fn tenant_exists(db: &PgPool, tenant_id: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tenants WHERE COALESCE(NULLIF(scope_id,''),id::TEXT)=$1 AND status='active')")
        .bind(tenant_id).fetch_one(db).await
}

pub async fn list_plans(db: &PgPool, include_inactive: bool) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'id',p.id,'code',p.code,'name',p.name,'billingInterval',p.billing_interval,'basePricePaise',p.base_price_paise,
          'includedBranches',p.included_branches,'includedUsers',p.included_users,'includedAppointments',p.included_appointments,
          'overageBranchPaise',p.overage_branch_paise,'overageUserPaise',p.overage_user_paise,'overageAppointmentPaise',p.overage_appointment_paise,
          'features',p.features_json,'active',p.active,'version',p.version,
          'sla',COALESCE((SELECT jsonb_agg(jsonb_build_object('severity',s.severity,'firstResponseMinutes',s.first_response_minutes,'resolutionMinutes',s.resolution_minutes,'businessHoursOnly',s.business_hours_only) ORDER BY CASE s.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END) FROM saas_sla_policies s WHERE s.plan_id=p.id),'[]'::JSONB),
          'activeSubscriptions',(SELECT COUNT(*) FROM saas_subscriptions sub WHERE sub.plan_id=p.id AND sub.status IN ('trialing','active','past_due','paused')),
          'createdAt',p.created_at,'updatedAt',p.updated_at
        ) FROM saas_plans p WHERE p.tenant_id='platform' AND p.branch_id='global' AND ($1 OR p.active=TRUE) ORDER BY p.active DESC,p.base_price_paise,p.name"#,
    )
    .bind(include_inactive)
    .fetch_all(db)
    .await
}

pub async fn create_plan(
    db: &PgPool,
    actor: &str,
    plan: &PlanWrite,
) -> Result<String, sqlx::Error> {
    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar::<_, String>(
        "INSERT INTO saas_plans(code,name,billing_interval,base_price_paise,included_branches,included_users,included_appointments,overage_branch_paise,overage_user_paise,overage_appointment_paise,features_json,active,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING id",
    ).bind(&plan.code).bind(&plan.name).bind(&plan.billing_interval).bind(plan.base_price_paise)
      .bind(plan.included_branches).bind(plan.included_users).bind(plan.included_appointments)
      .bind(plan.overage_branch_paise).bind(plan.overage_user_paise).bind(plan.overage_appointment_paise)
      .bind(&plan.features).bind(plan.active).bind(actor).fetch_one(&mut *tx).await?;
    upsert_sla(&mut tx, &id, &plan.sla).await?;
    tx.commit().await?;
    Ok(id)
}

pub async fn update_plan(
    db: &PgPool,
    id: &str,
    actor: &str,
    version: i32,
    plan: &PlanWrite,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let changed = sqlx::query(
        "UPDATE saas_plans SET code=$4,name=$5,billing_interval=$6,base_price_paise=$7,included_branches=$8,included_users=$9,included_appointments=$10,overage_branch_paise=$11,overage_user_paise=$12,overage_appointment_paise=$13,features_json=$14,active=$15,updated_by=$3,updated_at=NOW(),version=version+1 WHERE tenant_id='platform' AND branch_id='global' AND id=$1 AND version=$2",
    ).bind(id).bind(version).bind(actor).bind(&plan.code).bind(&plan.name).bind(&plan.billing_interval)
      .bind(plan.base_price_paise).bind(plan.included_branches).bind(plan.included_users).bind(plan.included_appointments)
      .bind(plan.overage_branch_paise).bind(plan.overage_user_paise).bind(plan.overage_appointment_paise)
      .bind(&plan.features).bind(plan.active).execute(&mut *tx).await?.rows_affected();
    if changed == 0 {
        tx.rollback().await?;
        return Ok(false);
    }
    upsert_sla(&mut tx, id, &plan.sla).await?;
    tx.commit().await?;
    Ok(true)
}

async fn upsert_sla(
    tx: &mut Transaction<'_, Postgres>,
    plan_id: &str,
    policies: &[SlaWrite],
) -> Result<(), sqlx::Error> {
    for policy in policies {
        sqlx::query("INSERT INTO saas_sla_policies(plan_id,severity,first_response_minutes,resolution_minutes,business_hours_only) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,branch_id,plan_id,severity) DO UPDATE SET first_response_minutes=EXCLUDED.first_response_minutes,resolution_minutes=EXCLUDED.resolution_minutes,business_hours_only=EXCLUDED.business_hours_only,updated_at=NOW()")
            .bind(plan_id).bind(&policy.severity).bind(policy.first_response_minutes).bind(policy.resolution_minutes).bind(policy.business_hours_only).execute(&mut **tx).await?;
    }
    Ok(())
}

pub async fn list_subscriptions(
    db: &PgPool,
    tenant_filter: Option<&str>,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'id',s.id,'tenantId',s.tenant_id,'tenantName',COALESCE(t.name,s.tenant_id),'planId',s.plan_id,'planName',p.name,
          'status',s.status,'currentPeriodStart',s.current_period_start,'currentPeriodEnd',s.current_period_end,'trialEndsAt',s.trial_ends_at,
          'cancelAtPeriodEnd',s.cancel_at_period_end,'provider',s.provider,'providerCustomerRef',s.provider_customer_ref,
          'providerSubscriptionRef',s.provider_subscription_ref,'providerStatus',s.provider_status,
          'checkoutUrl',s.checkout_url,'pendingPlanId',s.pending_plan_id,'pendingPlanEffective',s.pending_plan_effective,
          'version',s.version,'createdAt',s.created_at,'updatedAt',s.updated_at
        ) FROM saas_subscriptions s JOIN saas_plans p ON p.id=s.plan_id
        LEFT JOIN tenants t ON COALESCE(NULLIF(t.scope_id,''),t.id::TEXT)=s.tenant_id
        WHERE ($1::TEXT IS NULL OR s.tenant_id=$1) ORDER BY s.created_at DESC LIMIT 1000"#,
    ).bind(tenant_filter).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_subscription(
    db: &PgPool,
    tenant_id: &str,
    plan_id: &str,
    status: &str,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    trial_ends_at: Option<DateTime<Utc>>,
    provider: &str,
    customer_ref: &str,
    subscription_ref: &str,
    actor: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar::<_, String>("INSERT INTO saas_subscriptions(tenant_id,plan_id,status,current_period_start,current_period_end,trial_ends_at,provider,provider_customer_ref,provider_subscription_ref,created_by,updated_by) SELECT $1,p.id,$3,$4,$5,$6,$7,$8,$9,$10,$10 FROM saas_plans p WHERE p.id=$2 AND p.active=TRUE RETURNING id")
        .bind(tenant_id).bind(plan_id).bind(status).bind(start).bind(end).bind(trial_ends_at).bind(provider).bind(customer_ref).bind(subscription_ref).bind(actor).fetch_one(db).await
}

pub async fn update_subscription(
    db: &PgPool,
    id: &str,
    plan_id: &str,
    status: &str,
    cancel_at_period_end: bool,
    actor: &str,
    version: i32,
) -> Result<bool, sqlx::Error> {
    let changed=sqlx::query("UPDATE saas_subscriptions s SET plan_id=p.id,status=$4,cancel_at_period_end=$5,cancelled_at=CASE WHEN $4='cancelled' THEN NOW() ELSE NULL END,updated_by=$6,updated_at=NOW(),version=s.version+1 FROM saas_plans p WHERE s.id=$1 AND s.version=$2 AND p.id=$3 AND (p.active=TRUE OR p.id=s.plan_id)")
        .bind(id).bind(version).bind(plan_id).bind(status).bind(cancel_at_period_end).bind(actor).execute(db).await?.rows_affected();
    Ok(changed > 0)
}

pub async fn provider_plan_context(
    db: &PgPool,
    plan_id: &str,
) -> Result<Option<ProviderPlanContext>, sqlx::Error> {
    sqlx::query_as("SELECT id,name,billing_interval,base_price_paise,version FROM saas_plans WHERE id=$1 AND active=TRUE")
        .bind(plan_id)
        .fetch_optional(db)
        .await
}

pub async fn provider_plan_ref(
    db: &PgPool,
    plan_id: &str,
    version: i32,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT provider_plan_ref FROM saas_provider_plans WHERE plan_id=$1 AND plan_version=$2 AND provider='razorpay'")
        .bind(plan_id)
        .bind(version)
        .fetch_optional(db)
        .await
}

pub async fn save_provider_plan_ref(
    db: &PgPool,
    plan: &ProviderPlanContext,
    provider_plan_ref: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar(
        r#"INSERT INTO saas_provider_plans(plan_id,plan_version,provider,provider_plan_ref,amount_paise,billing_interval)
           VALUES($1,$2,'razorpay',$3,$4,$5)
           ON CONFLICT(plan_id,plan_version,provider) DO UPDATE
             SET provider_plan_ref=saas_provider_plans.provider_plan_ref
           RETURNING provider_plan_ref"#,
    )
    .bind(&plan.id)
    .bind(plan.version)
    .bind(provider_plan_ref)
    .bind(plan.base_price_paise)
    .bind(&plan.billing_interval)
    .fetch_one(db)
    .await
}

pub async fn checkout_request(
    db: &PgPool,
    tenant_id: &str,
    idempotency_key: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object('status',status,'subscriptionId',subscription_id,
              'providerSubscriptionId',provider_subscription_ref,'checkoutUrl',checkout_url)
           FROM saas_checkout_requests WHERE tenant_id=$1 AND idempotency_key=$2"#,
    )
    .bind(tenant_id)
    .bind(idempotency_key)
    .fetch_optional(db)
    .await
}

pub async fn reserve_checkout(
    db: &PgPool,
    tenant_id: &str,
    plan_id: &str,
    idempotency_key: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let changed = sqlx::query(
        r#"INSERT INTO saas_checkout_requests(tenant_id,plan_id,provider,idempotency_key,created_by)
           SELECT $1,p.id,'razorpay',$3,$4 FROM saas_plans p
           WHERE p.id=$2 AND p.active=TRUE
             AND NOT EXISTS(SELECT 1 FROM saas_subscriptions s WHERE s.tenant_id=$1 AND s.branch_id='global' AND s.status IN ('pending','trialing','active','past_due','paused'))
           ON CONFLICT(tenant_id,idempotency_key) DO NOTHING"#,
    )
    .bind(tenant_id)
    .bind(plan_id)
    .bind(idempotency_key)
    .bind(actor)
    .execute(db)
    .await?
    .rows_affected();
    Ok(changed > 0)
}

#[allow(clippy::too_many_arguments)]
pub async fn complete_checkout(
    db: &PgPool,
    tenant_id: &str,
    plan_id: &str,
    idempotency_key: &str,
    provider_subscription_ref: &str,
    provider_status: &str,
    checkout_url: &str,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    actor: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let subscription_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO saas_subscriptions(tenant_id,plan_id,status,current_period_start,current_period_end,
             provider,provider_subscription_ref,provider_status,checkout_url,created_by,updated_by)
           SELECT $1,p.id,'pending',$3,$4,'razorpay',$5,$6,$7,$8,$8
             FROM saas_plans p JOIN saas_checkout_requests r ON r.tenant_id=$1 AND r.idempotency_key=$2
            WHERE p.id=$9 AND p.active=TRUE AND r.status='creating'
           RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(idempotency_key)
    .bind(start)
    .bind(end)
    .bind(provider_subscription_ref)
    .bind(provider_status)
    .bind(checkout_url)
    .bind(actor)
    .bind(plan_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE saas_checkout_requests SET subscription_id=$3,provider_subscription_ref=$4,checkout_url=$5,status='ready',last_error='',updated_at=NOW() WHERE tenant_id=$1 AND idempotency_key=$2",
    )
    .bind(tenant_id)
    .bind(idempotency_key)
    .bind(&subscription_id)
    .bind(provider_subscription_ref)
    .bind(checkout_url)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(
        json!({"status":"ready","subscriptionId":subscription_id,"providerSubscriptionId":provider_subscription_ref,"checkoutUrl":checkout_url}),
    )
}

pub async fn fail_checkout(
    db: &PgPool,
    tenant_id: &str,
    idempotency_key: &str,
    error: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE saas_checkout_requests SET status='failed',last_error=$3,updated_at=NOW() WHERE tenant_id=$1 AND idempotency_key=$2 AND status='creating'")
        .bind(tenant_id)
        .bind(idempotency_key)
        .bind(error)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn provider_subscription_context(
    db: &PgPool,
    tenant_id: &str,
    subscription_id: &str,
) -> Result<Option<ProviderSubscriptionContext>, sqlx::Error> {
    sqlx::query_as("SELECT id,tenant_id,branch_id,plan_id,provider_subscription_ref,status FROM saas_subscriptions WHERE id=$1 AND tenant_id=$2 AND provider='razorpay'")
        .bind(subscription_id)
        .bind(tenant_id)
        .fetch_optional(db)
        .await
}

pub async fn record_provider_action(
    db: &PgPool,
    subscription_id: &str,
    action: &str,
    provider_status: &str,
    cancel_at_period_end: bool,
    actor: &str,
) -> Result<(), sqlx::Error> {
    let local_status = match action {
        "pause" => Some("paused"),
        "resume" => Some("active"),
        "cancel" if !cancel_at_period_end => Some("cancelled"),
        _ => None,
    };
    sqlx::query(
        r#"UPDATE saas_subscriptions SET provider_status=$2,
             status=COALESCE($3,status),cancel_at_period_end=$4,
             cancelled_at=CASE WHEN $3='cancelled' THEN NOW() ELSE cancelled_at END,
             updated_by=$5,updated_at=NOW(),version=version+1 WHERE id=$1"#,
    )
    .bind(subscription_id)
    .bind(provider_status)
    .bind(local_status)
    .bind(cancel_at_period_end)
    .bind(actor)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn record_plan_change(
    db: &PgPool,
    subscription_id: &str,
    plan_id: &str,
    effective: &str,
    provider_status: &str,
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE saas_subscriptions SET plan_id=CASE WHEN $3='now' THEN $2 ELSE plan_id END,
             pending_plan_id=CASE WHEN $3='cycle_end' THEN $2 ELSE NULL END,
             pending_plan_effective=CASE WHEN $3='cycle_end' THEN 'cycle_end' ELSE '' END,
             provider_status=$4,updated_by=$5,updated_at=NOW(),version=version+1 WHERE id=$1"#,
    )
    .bind(subscription_id)
    .bind(plan_id)
    .bind(effective)
    .bind(provider_status)
    .bind(actor)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn billing_context(
    db: &PgPool,
    subscription_id: &str,
) -> Result<Option<BillingContext>, sqlx::Error> {
    sqlx::query_as("SELECT s.id subscription_id,s.tenant_id,s.branch_id,s.status,s.trial_ends_at,p.billing_interval,p.base_price_paise,p.included_branches,p.included_users,p.included_appointments,p.overage_branch_paise,p.overage_user_paise,p.overage_appointment_paise,s.current_period_start,s.current_period_end FROM saas_subscriptions s JOIN saas_plans p ON p.id=s.plan_id WHERE s.id=$1")
        .bind(subscription_id).fetch_optional(db).await
}

pub async fn billable_contexts(db: &PgPool) -> Result<Vec<BillingContext>, sqlx::Error> {
    sqlx::query_as("SELECT s.id subscription_id,s.tenant_id,s.branch_id,s.status,s.trial_ends_at,p.billing_interval,p.base_price_paise,p.included_branches,p.included_users,p.included_appointments,p.overage_branch_paise,p.overage_user_paise,p.overage_appointment_paise,s.current_period_start,s.current_period_end FROM saas_subscriptions s JOIN saas_plans p ON p.id=s.plan_id WHERE s.status IN ('trialing','active','past_due') AND s.current_period_start<=NOW() AND (s.trial_ends_at IS NULL OR s.trial_ends_at<=NOW()) ORDER BY s.current_period_start,s.id")
        .fetch_all(db).await
}

pub async fn prepare_billing_run(db: &PgPool, actor: &str) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let cancelled = sqlx::query("UPDATE saas_subscriptions SET status='cancelled',cancelled_at=NOW(),updated_by=$1,updated_at=NOW(),version=version+1 WHERE cancel_at_period_end=TRUE AND status IN ('trialing','active','past_due','paused') AND current_period_start<=NOW()")
        .bind(actor).execute(&mut *tx).await?.rows_affected();
    let overdue = sqlx::query("UPDATE saas_invoices SET status='overdue',updated_at=NOW() WHERE status IN ('issued','partially_paid') AND due_at<NOW()")
        .execute(&mut *tx).await?.rows_affected();
    let past_due = sqlx::query("UPDATE saas_subscriptions s SET status='past_due',updated_by=$1,updated_at=NOW(),version=version+1 WHERE s.status IN ('trialing','active') AND EXISTS(SELECT 1 FROM saas_invoices i WHERE i.subscription_id=s.id AND i.status='overdue')")
        .bind(actor).execute(&mut *tx).await?.rows_affected();
    tx.commit().await?;
    Ok(json!({"cancelled":cancelled,"overdueInvoices":overdue,"pastDueSubscriptions":past_due}))
}

pub async fn usage_snapshot(
    db: &PgPool,
    context: &BillingContext,
) -> Result<UsageSnapshot, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT
          (SELECT COUNT(*) FROM branches b JOIN tenants t ON t.id=b.tenant_id WHERE COALESCE(NULLIF(t.scope_id,''),t.id::TEXT)=$1 AND b.active=TRUE) branch_count,
          (SELECT COUNT(*) FROM users u WHERE u.tenant_id=$1 AND u.active=TRUE) active_user_count,
          (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id=$1 AND a.start_at>=$3 AND a.start_at<$4 AND a.status<>'cancelled') appointment_count,
          COALESCE((SELECT SUM(e.quantity) FROM saas_usage_events e WHERE e.tenant_id=$1 AND e.subscription_id=$2 AND e.metric='api_calls' AND e.occurred_at>=$3 AND e.occurred_at<$4),0)::BIGINT api_calls,
          COALESCE((SELECT SUM(e.quantity) FROM saas_usage_events e WHERE e.tenant_id=$1 AND e.subscription_id=$2 AND e.metric='messages' AND e.occurred_at>=$3 AND e.occurred_at<$4),0)::BIGINT messages,
          COALESCE((SELECT SUM(e.quantity) FROM saas_usage_events e WHERE e.tenant_id=$1 AND e.subscription_id=$2 AND e.metric='storage_mb' AND e.occurred_at>=$3 AND e.occurred_at<$4),0)::BIGINT storage_mb"#,
    ).bind(&context.tenant_id).bind(&context.subscription_id).bind(context.current_period_start).bind(context.current_period_end).fetch_one(db).await
}

pub async fn record_usage(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    subscription_id: &str,
    metric: &str,
    quantity: i64,
    idempotency_key: &str,
    occurred_at: DateTime<Utc>,
    metadata: &Value,
) -> Result<bool, sqlx::Error> {
    let changed=sqlx::query("INSERT INTO saas_usage_events(tenant_id,branch_id,subscription_id,metric,quantity,idempotency_key,occurred_at,metadata_json) SELECT $1,$2,s.id,$4,$5,$6,$7,$8 FROM saas_subscriptions s WHERE s.id=$3 AND s.tenant_id=$1 AND s.status IN ('trialing','active','past_due') ON CONFLICT(tenant_id,idempotency_key) DO NOTHING")
        .bind(tenant_id).bind(branch_id).bind(subscription_id).bind(metric).bind(quantity).bind(idempotency_key).bind(occurred_at).bind(metadata).execute(db).await?.rows_affected();
    Ok(changed > 0)
}

pub async fn list_usage(
    db: &PgPool,
    tenant_filter: Option<&str>,
) -> Result<Vec<Value>, sqlx::Error> {
    let subscriptions = list_subscriptions(db, tenant_filter).await?;
    let mut rows = Vec::with_capacity(subscriptions.len());
    for subscription in subscriptions {
        let Some(id) = subscription.get("id").and_then(Value::as_str) else {
            continue;
        };
        if let Some(context) = billing_context(db, id).await? {
            let usage = usage_snapshot(db, &context).await?;
            rows.push(json!({"subscription":subscription,"usage":usage}));
        }
    }
    Ok(rows)
}

pub async fn list_invoices(
    db: &PgPool,
    tenant_filter: Option<&str>,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object('id',i.id,'tenantId',i.tenant_id,'tenantName',COALESCE(t.name,i.tenant_id),'subscriptionId',i.subscription_id,
          'planName',p.name,'invoiceNumber',i.invoice_number,'periodStart',i.period_start,'periodEnd',i.period_end,
          'baseAmountPaise',i.base_amount_paise,'usageAmountPaise',i.usage_amount_paise,'taxAmountPaise',i.tax_amount_paise,
          'totalPaise',i.total_paise,'paidPaise',i.paid_paise,'status',CASE WHEN i.status IN ('issued','partially_paid') AND i.due_at<NOW() THEN 'overdue' ELSE i.status END,
          'dueAt',i.due_at,'issuedAt',i.issued_at,'paidAt',i.paid_at,
          'providerPayments',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id',pp.id,'provider',pp.provider,'providerPaymentRef',pp.provider_payment_ref,
            'amountPaise',pp.amount_paise,'status',pp.status,'reconciliationStatus',pp.reconciliation_status,
            'refundedPaise',COALESCE((SELECT SUM(r.amount_paise) FROM saas_refunds r WHERE r.provider_payment_id=pp.id AND r.status IN ('pending','processed')),0)
          ) ORDER BY pp.occurred_at DESC) FROM saas_provider_payments pp WHERE pp.invoice_id=i.id),'[]'::jsonb),
          'creditNotes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',cn.id,'creditNoteNumber',cn.credit_note_number,'amountPaise',cn.amount_paise,'reason',cn.reason,'issuedAt',cn.issued_at) ORDER BY cn.issued_at DESC) FROM saas_credit_notes cn WHERE cn.invoice_id=i.id),'[]'::jsonb))
        FROM saas_invoices i JOIN saas_subscriptions s ON s.id=i.subscription_id JOIN saas_plans p ON p.id=s.plan_id
        LEFT JOIN tenants t ON COALESCE(NULLIF(t.scope_id,''),t.id::TEXT)=i.tenant_id
        WHERE ($1::TEXT IS NULL OR i.tenant_id=$1) ORDER BY i.issued_at DESC LIMIT 1000"#,
    ).bind(tenant_filter).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn issue_invoice(
    db: &PgPool,
    context: &BillingContext,
    invoice_number: &str,
    usage_amount_paise: i64,
    tax_amount_paise: i64,
    due_at: DateTime<Utc>,
    idempotency_key: &str,
    next_period_end: DateTime<Utc>,
    actor: &str,
) -> Result<String, sqlx::Error> {
    let mut tx = db.begin().await?;
    if let Some(existing) = sqlx::query_scalar::<_, String>(
        "SELECT id FROM saas_invoices WHERE tenant_id=$1 AND idempotency_key=$2",
    )
    .bind(&context.tenant_id)
    .bind(idempotency_key)
    .fetch_optional(&mut *tx)
    .await?
    {
        tx.rollback().await?;
        return Ok(existing);
    }
    let total = context.base_price_paise + usage_amount_paise + tax_amount_paise;
    let id=sqlx::query_scalar::<_,String>("INSERT INTO saas_invoices(tenant_id,branch_id,subscription_id,invoice_number,period_start,period_end,base_amount_paise,usage_amount_paise,tax_amount_paise,total_paise,due_at,idempotency_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id")
        .bind(&context.tenant_id).bind(&context.branch_id).bind(&context.subscription_id).bind(invoice_number).bind(context.current_period_start).bind(context.current_period_end).bind(context.base_price_paise).bind(usage_amount_paise).bind(tax_amount_paise).bind(total).bind(due_at).bind(idempotency_key).bind(actor).fetch_one(&mut *tx).await?;
    let changed=sqlx::query("UPDATE saas_subscriptions SET current_period_start=$2,current_period_end=$3,updated_by=$4,updated_at=NOW(),version=version+1 WHERE id=$1 AND current_period_start=$5 AND current_period_end=$2")
        .bind(&context.subscription_id).bind(context.current_period_end).bind(next_period_end).bind(actor).bind(context.current_period_start).execute(&mut *tx).await?.rows_affected();
    if changed == 0 {
        tx.rollback().await?;
        return Err(sqlx::Error::RowNotFound);
    }
    tx.commit().await?;
    Ok(id)
}

pub async fn record_payment(
    db: &PgPool,
    invoice_id: &str,
    amount_paise: i64,
    method: &str,
    reference: &str,
    idempotency_key: &str,
    actor: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let mut tx = db.begin().await?;
    if let Some(existing)=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('invoiceId',invoice_id,'paymentId',id,'replayed',TRUE) FROM saas_invoice_payments WHERE invoice_id=$1 AND idempotency_key=$2").bind(invoice_id).bind(idempotency_key).fetch_optional(&mut *tx).await? { tx.rollback().await?; return Ok(Some(existing)); }
    let Some((tenant_id,branch_id,total,paid))=sqlx::query_as::<_,(String,String,i64,i64)>("SELECT tenant_id,branch_id,total_paise,paid_paise FROM saas_invoices WHERE id=$1 AND status NOT IN ('void','paid') FOR UPDATE").bind(invoice_id).fetch_optional(&mut *tx).await? else { tx.rollback().await?; return Ok(None); };
    if paid + amount_paise > total {
        tx.rollback().await?;
        return Err(sqlx::Error::Protocol(
            "payment exceeds invoice balance".into(),
        ));
    }
    let payment_id=sqlx::query_scalar::<_,String>("INSERT INTO saas_invoice_payments(tenant_id,branch_id,invoice_id,amount_paise,payment_method,reference,idempotency_key,received_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id")
        .bind(&tenant_id).bind(&branch_id).bind(invoice_id).bind(amount_paise).bind(method).bind(reference).bind(idempotency_key).bind(actor).fetch_one(&mut *tx).await?;
    let new_paid = paid + amount_paise;
    sqlx::query("UPDATE saas_invoices SET paid_paise=$2,status=CASE WHEN $2=total_paise THEN 'paid' ELSE 'partially_paid' END,paid_at=CASE WHEN $2=total_paise THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$1")
        .bind(invoice_id).bind(new_paid).execute(&mut *tx).await?;
    if new_paid == total {
        sqlx::query("UPDATE saas_subscriptions s SET status='active',updated_at=NOW(),version=version+1 FROM saas_invoices i WHERE i.id=$1 AND s.id=i.subscription_id AND s.status='past_due'").bind(invoice_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Some(
        json!({"invoiceId":invoice_id,"paymentId":payment_id,"paidPaise":new_paid,"replayed":false}),
    ))
}

pub async fn reconcile_provider_event(
    db: &PgPool,
    event: &ProviderEventWrite<'_>,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let event_row = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO saas_provider_events(provider,provider_event_id,event_type,provider_subscription_ref,
             payload_sha256,provider_created_at)
           VALUES('razorpay',$1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id"#,
    )
    .bind(event.provider_event_id)
    .bind(event.event_type)
    .bind(event.provider_subscription_ref)
    .bind(event.payload_sha256)
    .bind(event.provider_created_at)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(event_id) = event_row else {
        tx.rollback().await?;
        return Ok(json!({"received":true,"duplicate":true}));
    };
    let subscription = sqlx::query_as::<_, (String, String, String, Option<DateTime<Utc>>)>(
        "SELECT id,tenant_id,branch_id,last_provider_event_at FROM saas_subscriptions WHERE provider='razorpay' AND provider_subscription_ref=$1 FOR UPDATE",
    )
    .bind(event.provider_subscription_ref)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((subscription_id, tenant_id, branch_id, last_event_at)) = subscription else {
        sqlx::query("UPDATE saas_provider_events SET status='ignored',processed_at=NOW(),error_message='subscription not found' WHERE id=$1")
            .bind(&event_id).execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(json!({"received":true,"matched":false}));
    };
    let event_at = event.provider_created_at.unwrap_or_else(Utc::now);
    if last_event_at.is_some_and(|last| last > event_at) {
        sqlx::query("UPDATE saas_provider_events SET subscription_id=$2,status='ignored',processed_at=NOW(),error_message='stale event' WHERE id=$1")
            .bind(&event_id).bind(&subscription_id).execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(json!({"received":true,"stale":true}));
    }
    let mapped_plan = if event.provider_plan_ref.is_empty() {
        None
    } else {
        sqlx::query_scalar::<_, String>("SELECT plan_id FROM saas_provider_plans WHERE provider='razorpay' AND provider_plan_ref=$1")
            .bind(event.provider_plan_ref).fetch_optional(&mut *tx).await?
    };
    let valid_period = event
        .period_start
        .zip(event.period_end)
        .filter(|(start, end)| end > start);
    let (period_start, period_end) =
        valid_period.map_or((None, None), |(start, end)| (Some(start), Some(end)));
    sqlx::query(
        r#"UPDATE saas_subscriptions SET provider_status=COALESCE(NULLIF($2,''),provider_status),status=COALESCE($3,status),
             plan_id=CASE WHEN $4 IS NOT NULL AND (pending_plan_effective<>'cycle_end' OR current_period_end<=$7) THEN $4 ELSE plan_id END,
             pending_plan_id=CASE WHEN $4 IS NOT NULL AND (pending_plan_effective<>'cycle_end' OR current_period_end<=$7) THEN NULL ELSE pending_plan_id END,
             pending_plan_effective=CASE WHEN $4 IS NOT NULL AND (pending_plan_effective<>'cycle_end' OR current_period_end<=$7) THEN '' ELSE pending_plan_effective END,
             current_period_start=COALESCE($5,current_period_start),current_period_end=COALESCE($6,current_period_end),
             cancel_at_period_end=CASE WHEN $3='cancelled' THEN FALSE ELSE cancel_at_period_end END,
             cancelled_at=CASE WHEN $3='cancelled' THEN COALESCE(cancelled_at,NOW()) ELSE cancelled_at END,
             last_provider_event_at=$7,updated_by='razorpay-webhook',updated_at=NOW(),version=version+1 WHERE id=$1"#,
    )
    .bind(&subscription_id)
    .bind(event.provider_status)
    .bind(event.local_status)
    .bind(mapped_plan.as_deref())
    .bind(period_start)
    .bind(period_end)
    .bind(event_at)
    .execute(&mut *tx)
    .await?;

    let mut reconciliation = "none";
    if !event.payment_ref.is_empty()
        && event.payment_amount_paise > 0
        && event.payment_status == "captured"
    {
        let invoice = sqlx::query_as::<_, (String, i64, i64)>(
            r#"SELECT id,total_paise,paid_paise FROM saas_invoices
               WHERE subscription_id=$1 AND status IN ('issued','partially_paid','overdue')
                 AND total_paise-paid_paise=$2 ORDER BY issued_at,id FOR UPDATE SKIP LOCKED LIMIT 1"#,
        )
        .bind(&subscription_id)
        .bind(event.payment_amount_paise)
        .fetch_optional(&mut *tx)
        .await?;
        let invoice_id = invoice.as_ref().map(|row| row.0.as_str());
        let inserted = sqlx::query_scalar::<_, String>(
            r#"INSERT INTO saas_provider_payments(tenant_id,branch_id,subscription_id,invoice_id,provider,
                 provider_payment_ref,amount_paise,currency,method,status,reconciliation_status,occurred_at)
               VALUES($1,$2,$3,$4,'razorpay',$5,$6,$7,$8,'captured',$9,$10)
               ON CONFLICT(provider,provider_payment_ref) DO NOTHING RETURNING id"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&subscription_id)
        .bind(invoice_id)
        .bind(event.payment_ref)
        .bind(event.payment_amount_paise)
        .bind(event.payment_currency)
        .bind(event.payment_method)
        .bind(if invoice.is_some() { "matched" } else { "unmatched" })
        .bind(event_at)
        .fetch_optional(&mut *tx)
        .await?;
        if inserted.is_some() {
            if let Some((invoice_id, total, paid)) = invoice {
                let new_paid = paid + event.payment_amount_paise;
                sqlx::query("INSERT INTO saas_invoice_payments(tenant_id,branch_id,invoice_id,amount_paise,payment_method,reference,idempotency_key,received_by) VALUES($1,$2,$3,$4,'provider',$5,$6,'razorpay-webhook') ON CONFLICT(tenant_id,idempotency_key) DO NOTHING")
                    .bind(&tenant_id).bind(&branch_id).bind(&invoice_id).bind(event.payment_amount_paise)
                    .bind(event.payment_ref).bind(format!("razorpay:{}",event.payment_ref)).execute(&mut *tx).await?;
                sqlx::query("UPDATE saas_invoices SET paid_paise=$2,status=CASE WHEN $2=$3 THEN 'paid' ELSE 'partially_paid' END,paid_at=CASE WHEN $2=$3 THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$1")
                    .bind(&invoice_id).bind(new_paid).bind(total).execute(&mut *tx).await?;
                reconciliation = "matched";
            } else {
                reconciliation = "unmatched";
            }
        } else {
            reconciliation = "duplicate_payment";
        }
    }
    if event.dunning {
        sqlx::query(
            r#"INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json)
               SELECT $1,COALESCE(NULLIF(u.branch_id,''),$2),u.id,'razorpay-webhook','saas_payment_due',
                      'Subscription payment failed','Razorpay will retry the subscription payment. Update the payment method if required.',
                      'saas_subscription',$3,jsonb_build_object('providerEventId',$4,'eventType',$5)
                 FROM users u WHERE u.tenant_id=$1 AND u.active=TRUE
                  AND REGEXP_REPLACE(LOWER(u.role_name),'[-_ ]','','g') IN ('owner','admin','tenantadmin','salonadmin')"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&subscription_id)
        .bind(event.provider_event_id)
        .bind(event.event_type)
        .execute(&mut *tx)
        .await?;
    }
    if matches!(event.local_status, Some("active" | "cancelled")) {
        sqlx::query("UPDATE saas_checkout_requests SET status='completed',updated_at=NOW() WHERE subscription_id=$1 AND status='ready'")
            .bind(&subscription_id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE saas_provider_events SET subscription_id=$2,status='processed',processed_at=NOW() WHERE id=$1")
        .bind(&event_id).bind(&subscription_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(
        json!({"received":true,"processed":true,"subscriptionId":subscription_id,"reconciliation":reconciliation}),
    )
}

pub async fn reserve_refund(
    db: &PgPool,
    provider_payment_id: &str,
    amount_paise: i64,
    reason: &str,
    idempotency_key: &str,
    actor: &str,
) -> Result<RefundReservation, sqlx::Error> {
    let mut tx = db.begin().await?;
    if let Some(existing) = sqlx::query_as::<_, (String,String,String,Option<String>,String,String,String)>(
        r#"SELECT r.id,r.tenant_id,r.branch_id,p.invoice_id,p.provider_payment_ref,r.status,r.provider_refund_ref
           FROM saas_refunds r JOIN saas_provider_payments p ON p.id=r.provider_payment_id
           WHERE r.idempotency_key=$1 AND r.provider_payment_id=$2 AND r.tenant_id=p.tenant_id"#,
    ).bind(idempotency_key).bind(provider_payment_id).fetch_optional(&mut *tx).await? {
        if existing.5 != "failed" {
            tx.rollback().await?;
            return Ok(RefundReservation { refund_id:existing.0,tenant_id:existing.1,branch_id:existing.2,invoice_id:existing.3,provider_payment_ref:existing.4,replayed:true,status:existing.5,provider_refund_ref:existing.6 });
        }
    }
    let payment = sqlx::query_as::<_, (String,String,Option<String>,String,i64)>(
        "SELECT tenant_id,branch_id,invoice_id,provider_payment_ref,amount_paise FROM saas_provider_payments WHERE id=$1 AND provider='razorpay' AND status='captured' FOR UPDATE",
    ).bind(provider_payment_id).fetch_one(&mut *tx).await?;
    let reserved = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(amount_paise),0)::BIGINT FROM saas_refunds WHERE provider_payment_id=$1 AND status IN ('requested','pending','processed')")
        .bind(provider_payment_id).fetch_one(&mut *tx).await?;
    if amount_paise <= 0 || reserved.saturating_add(amount_paise) > payment.4 {
        tx.rollback().await?;
        return Err(sqlx::Error::Protocol(
            "refund exceeds provider payment balance".into(),
        ));
    }
    let refund_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO saas_refunds(tenant_id,branch_id,provider_payment_id,provider,amount_paise,reason,status,idempotency_key,created_by)
           VALUES($1,$2,$3,'razorpay',$4,$5,'requested',$6,$7)
           ON CONFLICT(tenant_id,idempotency_key) DO UPDATE SET status='requested',last_error='',updated_at=NOW()
           RETURNING id"#,
    ).bind(&payment.0).bind(&payment.1).bind(provider_payment_id).bind(amount_paise).bind(reason).bind(idempotency_key).bind(actor).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(RefundReservation {
        refund_id,
        tenant_id: payment.0,
        branch_id: payment.1,
        invoice_id: payment.2,
        provider_payment_ref: payment.3,
        replayed: false,
        status: "requested".into(),
        provider_refund_ref: String::new(),
    })
}

pub async fn complete_refund(
    db: &PgPool,
    refund_id: &str,
    provider_refund_ref: &str,
    provider_status: &str,
    credit_note_number: &str,
    actor: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let status = if provider_status == "processed" {
        "processed"
    } else {
        "pending"
    };
    let row = sqlx::query_as::<_, (String,String,Option<String>,i64,String,String)>(
        r#"UPDATE saas_refunds SET provider_refund_ref=$2,status=$3,updated_at=NOW()
           WHERE id=$1 AND status='requested'
           RETURNING tenant_id,branch_id,(SELECT invoice_id FROM saas_provider_payments WHERE id=saas_refunds.provider_payment_id),amount_paise,reason,provider_payment_id"#,
    ).bind(refund_id).bind(provider_refund_ref).bind(status).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO saas_credit_notes(tenant_id,branch_id,invoice_id,refund_id,credit_note_number,amount_paise,reason,issued_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(refund_id) DO NOTHING")
        .bind(&row.0).bind(&row.1).bind(row.2.as_deref()).bind(refund_id).bind(credit_note_number).bind(row.3).bind(&row.4).bind(actor).execute(&mut *tx).await?;
    if status == "processed" {
        sqlx::query("UPDATE saas_provider_payments p SET status='refunded' WHERE p.id=$1 AND p.amount_paise<=(SELECT COALESCE(SUM(amount_paise),0) FROM saas_refunds WHERE provider_payment_id=p.id AND status='processed')")
            .bind(&row.5).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(
        json!({"refundId":refund_id,"providerRefundId":provider_refund_ref,"status":status,"creditNoteNumber":credit_note_number}),
    )
}

pub async fn fail_refund(db: &PgPool, refund_id: &str, error: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE saas_refunds SET status='failed',last_error=$2,updated_at=NOW() WHERE id=$1 AND status='requested'")
        .bind(refund_id).bind(error).execute(db).await?;
    Ok(())
}

pub async fn reconcile_provider_refund(
    db: &PgPool,
    provider_event_id: &str,
    event_type: &str,
    payload_sha256: &str,
    provider_refund_ref: &str,
    status: &str,
    provider_created_at: Option<DateTime<Utc>>,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let inserted = sqlx::query_scalar::<_, String>("INSERT INTO saas_provider_events(provider,provider_event_id,event_type,payload_sha256,provider_created_at) VALUES('razorpay',$1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id")
        .bind(provider_event_id).bind(event_type).bind(payload_sha256).bind(provider_created_at).fetch_optional(&mut *tx).await?;
    let Some(event_id) = inserted else {
        tx.rollback().await?;
        return Ok(json!({"received":true,"duplicate":true}));
    };
    let updated = sqlx::query("UPDATE saas_refunds SET status=$2,updated_at=NOW(),last_error=CASE WHEN $2='failed' THEN 'provider refund failed' ELSE last_error END WHERE provider='razorpay' AND provider_refund_ref=$1")
        .bind(provider_refund_ref).bind(status).execute(&mut *tx).await?.rows_affected();
    if status == "processed" {
        sqlx::query("UPDATE saas_provider_payments p SET status='refunded' WHERE p.id IN (SELECT provider_payment_id FROM saas_refunds WHERE provider_refund_ref=$1) AND p.amount_paise<=(SELECT COALESCE(SUM(r.amount_paise),0) FROM saas_refunds r WHERE r.provider_payment_id=p.id AND r.status='processed')")
            .bind(provider_refund_ref).execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE saas_provider_events SET status=$2,processed_at=NOW(),error_message=CASE WHEN $2='ignored' THEN 'refund not found' ELSE '' END WHERE id=$1")
        .bind(&event_id).bind(if updated>0 {"processed"} else {"ignored"}).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(json!({"received":true,"processed":updated>0}))
}

pub async fn current_subscription(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    list_subscriptions(db, Some(tenant_id))
        .await
        .map(|rows| rows.into_iter().next())
}

pub async fn create_ticket(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    ticket_number: &str,
    subject: &str,
    category: &str,
    severity: &str,
    priority: &str,
    body: &str,
    subscription_id: &str,
    plan_id: &str,
    first_response_due_at: DateTime<Utc>,
    resolution_due_at: DateTime<Utc>,
    attachments: &[SupportAttachmentWrite],
) -> Result<String, sqlx::Error> {
    let mut tx = db.begin().await?;
    let id=sqlx::query_scalar::<_,String>("INSERT INTO saas_support_tickets(tenant_id,branch_id,subscription_id,plan_id,ticket_number,subject,category,severity,priority,first_response_due_at,resolution_due_at,created_by,updated_by) VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(subscription_id).bind(plan_id).bind(ticket_number).bind(subject).bind(category).bind(severity).bind(priority).bind(first_response_due_at).bind(resolution_due_at).bind(actor).fetch_one(&mut *tx).await?;
    let message_id = insert_message(
        &mut tx, tenant_id, branch_id, &id, actor, "customer", "customer", body, "portal", None,
        None, None, "",
    )
    .await?;
    insert_attachments(
        &mut tx,
        tenant_id,
        branch_id,
        &id,
        &message_id,
        "customer",
        attachments,
    )
    .await?;
    sqlx::query("UPDATE saas_support_tickets SET queue_key=CASE WHEN category='other' THEN 'general' ELSE category END,last_customer_message_at=NOW() WHERE id=$1")
        .bind(&id).execute(&mut *tx).await?;
    insert_ticket_event(
        &mut tx,
        tenant_id,
        branch_id,
        &id,
        "ticket.created",
        "",
        "open",
        actor,
        json!({"severity":severity}),
    )
    .await?;
    tx.commit().await?;
    Ok(id)
}

pub async fn ticket_sla_context(
    db: &PgPool,
    tenant_id: &str,
    severity: &str,
) -> Result<Option<TicketSlaContext>, sqlx::Error> {
    sqlx::query_as("SELECT s.id subscription_id,p.id plan_id,sl.first_response_minutes,sl.resolution_minutes,sl.business_hours_only FROM saas_subscriptions s JOIN saas_plans p ON p.id=s.plan_id JOIN saas_sla_policies sl ON sl.plan_id=p.id AND sl.severity=$2 WHERE s.tenant_id=$1 AND s.status IN ('trialing','active','past_due','paused') ORDER BY s.created_at DESC LIMIT 1")
        .bind(tenant_id).bind(severity).fetch_optional(db).await
}

pub async fn list_tickets(
    db: &PgPool,
    tenant_filter: Option<&str>,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar::<_,Value>(r#"SELECT jsonb_build_object('id',t.id,'tenantId',t.tenant_id,'tenantName',COALESCE(tenant.name,t.tenant_id),'branchId',t.branch_id,'ticketNumber',t.ticket_number,'subject',t.subject,'category',t.category,'severity',t.severity,'priority',t.priority,'status',t.status,'source',t.source,'requesterEmail',t.requester_email,'queueKey',t.queue_key,'escalationLevel',t.escalation_level,'escalatedAt',t.escalated_at,'mergedIntoTicketId',t.merged_into_ticket_id,'duplicateOfTicketId',t.duplicate_of_ticket_id,'reopenedCount',t.reopened_count,'csatRequestedAt',t.csat_requested_at,'firstResponseDueAt',t.first_response_due_at,'resolutionDueAt',t.resolution_due_at,'firstRespondedAt',t.first_responded_at,'resolvedAt',t.resolved_at,'assignedTo',t.assigned_to,'responseBreached',t.first_responded_at IS NULL AND t.first_response_due_at<NOW(),'resolutionBreached',t.resolved_at IS NULL AND t.resolution_due_at<NOW(),'createdAt',t.created_at,'updatedAt',t.updated_at) FROM saas_support_tickets t LEFT JOIN tenants tenant ON COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=t.tenant_id WHERE ($1::TEXT IS NULL OR t.tenant_id=$1) AND t.merged_into_ticket_id IS NULL ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'waiting_customer' THEN 2 ELSE 3 END,t.escalation_level DESC,CASE t.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,t.created_at DESC LIMIT 1000"#)
        .bind(tenant_filter).fetch_all(db).await
}

pub async fn ticket_detail(
    db: &PgPool,
    id: &str,
    tenant_filter: Option<&str>,
    include_internal: bool,
) -> Result<Option<Value>, sqlx::Error> {
    let ticket=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',t.id,'tenantId',t.tenant_id,'branchId',t.branch_id,'ticketNumber',t.ticket_number,'subject',t.subject,'category',t.category,'severity',t.severity,'priority',t.priority,'status',t.status,'source',t.source,'requesterEmail',t.requester_email,'queueKey',t.queue_key,'escalationLevel',t.escalation_level,'escalatedAt',t.escalated_at,'mergedIntoTicketId',t.merged_into_ticket_id,'duplicateOfTicketId',t.duplicate_of_ticket_id,'reopenedCount',t.reopened_count,'csatRequestedAt',t.csat_requested_at,'firstResponseDueAt',t.first_response_due_at,'resolutionDueAt',t.resolution_due_at,'firstRespondedAt',t.first_responded_at,'resolvedAt',t.resolved_at,'assignedTo',t.assigned_to,'csat',(SELECT jsonb_build_object('rating',c.rating,'comment',c.comment,'submittedAt',c.submitted_at) FROM saas_support_csat c WHERE c.ticket_id=t.id),'createdAt',t.created_at,'updatedAt',t.updated_at) FROM saas_support_tickets t WHERE t.id=$1 AND ($2::TEXT IS NULL OR t.tenant_id=$2)")
        .bind(id).bind(tenant_filter).fetch_optional(db).await?;
    let Some(ticket) = ticket else {
        return Ok(None);
    };
    let messages=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',m.id,'authorId',m.author_id,'authorType',m.author_type,'visibility',m.visibility,'body',m.body,'source',m.source,'senderEmail',m.sender_email,'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'fileName',a.file_name,'contentType',a.content_type,'sizeBytes',a.size_bytes) ORDER BY a.created_at) FROM saas_support_attachments a WHERE a.message_id=m.id AND ($2 OR a.visibility='customer')),'[]'::jsonb),'createdAt',m.created_at) FROM saas_support_messages m WHERE m.ticket_id=$1 AND ($2 OR m.visibility='customer') ORDER BY m.created_at")
        .bind(id).bind(include_internal).fetch_all(db).await?;
    let events=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',id,'eventType',event_type,'fromStatus',from_status,'toStatus',to_status,'actorId',actor_id,'details',details_json,'createdAt',created_at) FROM saas_support_events WHERE ticket_id=$1 ORDER BY created_at DESC LIMIT 200")
        .bind(id).fetch_all(db).await?;
    Ok(Some(
        json!({"ticket":ticket,"messages":messages,"events":events}),
    ))
}

pub async fn add_ticket_message(
    db: &PgPool,
    ticket_id: &str,
    tenant_filter: Option<&str>,
    actor: &str,
    author_type: &str,
    visibility: &str,
    body: &str,
    attachments: &[SupportAttachmentWrite],
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row=sqlx::query_as::<_,(String,String,String,String,String,String,String)>("SELECT t.tenant_id,t.branch_id,t.status,t.requester_email,t.ticket_number,t.subject,COALESCE((SELECT m.email_message_id FROM saas_support_messages m WHERE m.ticket_id=t.id AND m.source='email' AND COALESCE(m.email_message_id,'')<>'' ORDER BY m.created_at DESC LIMIT 1),'') FROM saas_support_tickets t WHERE t.id=$1 AND ($2::TEXT IS NULL OR t.tenant_id=$2) FOR UPDATE").bind(ticket_id).bind(tenant_filter).fetch_optional(&mut *tx).await?;
    let Some((tenant_id, branch_id, status, requester_email, ticket_number, subject, reply_to)) =
        row
    else {
        tx.rollback().await?;
        return Ok(false);
    };
    let message_id = insert_message(
        &mut tx,
        &tenant_id,
        &branch_id,
        ticket_id,
        actor,
        author_type,
        visibility,
        body,
        "portal",
        None,
        None,
        None,
        "",
    )
    .await?;
    insert_attachments(
        &mut tx,
        &tenant_id,
        &branch_id,
        ticket_id,
        &message_id,
        visibility,
        attachments,
    )
    .await?;
    if author_type == "support" {
        sqlx::query("UPDATE saas_support_tickets SET first_responded_at=COALESCE(first_responded_at,NOW()),last_support_message_at=NOW(),status=CASE WHEN status='open' THEN 'in_progress' ELSE status END,updated_by=$2,updated_at=NOW() WHERE id=$1").bind(ticket_id).bind(actor).execute(&mut *tx).await?;
        if visibility == "customer" {
            if !requester_email.is_empty() {
                let outbound_message_id = format!("<{message_id}@support.aurashine>");
                sqlx::query("UPDATE saas_support_messages SET email_message_id=$2 WHERE id=$1")
                    .bind(&message_id)
                    .bind(&outbound_message_id)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query("INSERT INTO saas_support_email_outbox(tenant_id,branch_id,ticket_id,message_id,recipient,subject,body,outbound_message_id,in_reply_to,references_header) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)")
                    .bind(&tenant_id).bind(&branch_id).bind(ticket_id).bind(&message_id).bind(&requester_email)
                    .bind(format!("Re: [{ticket_number}] {subject}")).bind(body).bind(&outbound_message_id).bind(&reply_to)
                    .execute(&mut *tx).await?;
            }
            notify_tenant_owners(
                &mut tx,
                &tenant_id,
                &branch_id,
                ticket_id,
                "Support replied to your ticket",
                body,
                "saas_ticket_reply",
            )
            .await?;
        }
    } else {
        sqlx::query("UPDATE saas_support_tickets SET last_customer_message_at=NOW(),status=CASE WHEN status='waiting_customer' THEN 'in_progress' WHEN status IN ('resolved','closed') THEN 'open' ELSE status END,reopened_count=reopened_count+CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END,updated_by=$2,updated_at=NOW() WHERE id=$1").bind(ticket_id).bind(actor).execute(&mut *tx).await?;
        notify_platform_support(
            &mut tx,
            ticket_id,
            "Customer replied to support ticket",
            body,
            "saas_ticket_reply",
        )
        .await?;
    }
    insert_ticket_event(
        &mut tx,
        &tenant_id,
        &branch_id,
        ticket_id,
        "message.added",
        &status,
        &status,
        actor,
        json!({"visibility":visibility,"authorType":author_type}),
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn update_ticket(
    db: &PgPool,
    id: &str,
    actor: &str,
    status: &str,
    assigned_to: Option<&str>,
    priority: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let current = sqlx::query_as::<_, (String, String, String)>(
        "SELECT tenant_id,branch_id,status FROM saas_support_tickets WHERE id=$1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((tenant_id, branch_id, old_status)) = current else {
        tx.rollback().await?;
        return Ok(false);
    };
    sqlx::query("UPDATE saas_support_tickets SET status=$3,assigned_to=$4,priority=$5,resolved_at=CASE WHEN $3='resolved' THEN COALESCE(resolved_at,NOW()) WHEN $3 IN ('open','in_progress','waiting_customer') THEN NULL ELSE resolved_at END,closed_at=CASE WHEN $3='closed' THEN NOW() WHEN $3 IN ('open','in_progress','waiting_customer') THEN NULL ELSE closed_at END,reopened_count=reopened_count+CASE WHEN status IN ('resolved','closed') AND $3 IN ('open','in_progress') THEN 1 ELSE 0 END,csat_requested_at=CASE WHEN $3='resolved' THEN COALESCE(csat_requested_at,NOW()) WHEN $3 IN ('open','in_progress') THEN NULL ELSE csat_requested_at END,updated_by=$2,updated_at=NOW() WHERE id=$1").bind(id).bind(actor).bind(status).bind(assigned_to).bind(priority).execute(&mut *tx).await?;
    insert_ticket_event(
        &mut tx,
        &tenant_id,
        &branch_id,
        id,
        "ticket.updated",
        &old_status,
        status,
        actor,
        json!({"assignedTo":assigned_to,"priority":priority}),
    )
    .await?;
    if old_status != status {
        notify_tenant_owners(
            &mut tx,
            &tenant_id,
            &branch_id,
            id,
            if status == "resolved" {
                "Support ticket resolved"
            } else {
                "Support ticket updated"
            },
            &format!("Ticket status changed from {old_status} to {status}."),
            if status == "resolved" {
                "saas_ticket_csat"
            } else {
                "saas_ticket_status"
            },
        )
        .await?;
    }
    tx.commit().await?;
    Ok(true)
}

pub async fn submit_ticket_csat(
    db: &PgPool,
    ticket_id: &str,
    tenant_id: &str,
    actor: &str,
    rating: i16,
    comment: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let scope = sqlx::query_as::<_, (String, String)>(
        "SELECT tenant_id,branch_id FROM saas_support_tickets WHERE id=$1 AND tenant_id=$2 AND status IN ('resolved','closed')",
    ).bind(ticket_id).bind(tenant_id).fetch_optional(&mut *tx).await?;
    let Some((tenant, branch)) = scope else {
        tx.rollback().await?;
        return Ok(false);
    };
    sqlx::query("INSERT INTO saas_support_csat(tenant_id,branch_id,ticket_id,rating,comment,submitted_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(ticket_id) DO UPDATE SET rating=EXCLUDED.rating,comment=EXCLUDED.comment,submitted_by=EXCLUDED.submitted_by,submitted_at=NOW()")
        .bind(&tenant).bind(&branch).bind(ticket_id).bind(rating).bind(comment).bind(actor).execute(&mut *tx).await?;
    insert_ticket_event(
        &mut tx,
        &tenant,
        &branch,
        ticket_id,
        "ticket.csat",
        "",
        "",
        actor,
        json!({"rating":rating}),
    )
    .await?;
    notify_platform_support(
        &mut tx,
        ticket_id,
        "Ticket CSAT received",
        &format!("Customer submitted a {rating}/5 rating."),
        "saas_ticket_csat",
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn merge_ticket(
    db: &PgPool,
    source_id: &str,
    target_id: &str,
    actor: &str,
    duplicate: bool,
    reason: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let rows = sqlx::query_as::<_, (String, String, String)>(
        "SELECT id,tenant_id,branch_id FROM saas_support_tickets WHERE id=ANY($1) AND merged_into_ticket_id IS NULL ORDER BY id FOR UPDATE",
    ).bind(vec![source_id, target_id]).fetch_all(&mut *tx).await?;
    if source_id == target_id || rows.len() != 2 || rows[0].1 != rows[1].1 {
        tx.rollback().await?;
        return Ok(false);
    }
    let source = rows
        .iter()
        .find(|row| row.0 == source_id)
        .expect("locked source ticket");
    let tenant = source.1.clone();
    let branch = source.2.clone();
    sqlx::query("UPDATE saas_support_messages SET ticket_id=$2 WHERE ticket_id=$1")
        .bind(source_id)
        .bind(target_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE saas_support_attachments SET ticket_id=$2 WHERE ticket_id=$1")
        .bind(source_id)
        .bind(target_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE saas_support_tickets SET status='closed',closed_at=NOW(),merged_into_ticket_id=$2,duplicate_of_ticket_id=CASE WHEN $3 THEN $2 ELSE NULL END,updated_by=$4,updated_at=NOW() WHERE id=$1")
        .bind(source_id).bind(target_id).bind(duplicate).bind(actor).execute(&mut *tx).await?;
    insert_ticket_event(
        &mut tx,
        &tenant,
        &branch,
        source_id,
        if duplicate {
            "ticket.duplicate"
        } else {
            "ticket.merged"
        },
        "",
        "closed",
        actor,
        json!({"targetTicketId":target_id,"reason":reason}),
    )
    .await?;
    insert_ticket_event(
        &mut tx,
        &tenant,
        &branch,
        target_id,
        "ticket.merge.received",
        "",
        "",
        actor,
        json!({"sourceTicketId":source_id,"duplicate":duplicate,"reason":reason}),
    )
    .await?;
    notify_tenant_owners(
        &mut tx,
        &tenant,
        &branch,
        target_id,
        "Support tickets consolidated",
        "Related support conversations were combined into one ticket.",
        "saas_ticket_status",
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn ticket_attachment(
    db: &PgPool,
    ticket_id: &str,
    attachment_id: &str,
    tenant_filter: Option<&str>,
    include_internal: bool,
) -> Result<Option<SupportAttachmentDownload>, sqlx::Error> {
    sqlx::query_as("SELECT a.file_name,a.content_type,a.content FROM saas_support_attachments a JOIN saas_support_tickets t ON t.id=a.ticket_id AND t.tenant_id=a.tenant_id WHERE a.id=$1 AND a.ticket_id=$2 AND ($3::TEXT IS NULL OR t.tenant_id=$3) AND ($4 OR a.visibility='customer')")
        .bind(attachment_id).bind(ticket_id).bind(tenant_filter).bind(include_internal).fetch_optional(db).await
}

pub async fn escalate_due_tickets(db: &PgPool) -> Result<u64, sqlx::Error> {
    let mut tx = db.begin().await?;
    let rows = sqlx::query_as::<_, (String, String, String, String, i16)>(
        r#"UPDATE saas_support_tickets
              SET escalation_level=CASE WHEN resolution_due_at<NOW() THEN 2 ELSE 1 END,
                  escalated_at=NOW(),priority='urgent',updated_by='sla-worker',updated_at=NOW()
            WHERE status IN ('open','in_progress','waiting_customer') AND merged_into_ticket_id IS NULL
              AND ((first_responded_at IS NULL AND first_response_due_at<NOW() AND escalation_level<1)
                OR (resolved_at IS NULL AND resolution_due_at<NOW() AND escalation_level<2))
        RETURNING id,tenant_id,branch_id,ticket_number,escalation_level"#,
    ).fetch_all(&mut *tx).await?;
    for (ticket, tenant, branch, number, level) in &rows {
        insert_ticket_event(
            &mut tx,
            tenant,
            branch,
            ticket,
            "ticket.sla_escalated",
            "",
            "",
            "sla-worker",
            json!({"level":level}),
        )
        .await?;
        notify_platform_support(
            &mut tx,
            ticket,
            "Support SLA escalated",
            &format!("Ticket {number} reached escalation level {level}."),
            "saas_ticket_sla",
        )
        .await?;
    }
    tx.commit().await?;
    Ok(rows.len() as u64)
}

pub async fn reserve_support_email_delivery(
    db: &PgPool,
) -> Result<Option<SupportEmailDelivery>, sqlx::Error> {
    sqlx::query_as(
        r#"UPDATE saas_support_email_outbox SET status='sending',attempts=attempts+1,updated_at=NOW()
             WHERE id=(SELECT id FROM saas_support_email_outbox
                        WHERE status IN ('queued','failed') AND attempts<5 AND next_attempt_at<=NOW()
                        ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1)
         RETURNING id,recipient,subject,body,outbound_message_id,in_reply_to,references_header"#,
    ).fetch_optional(db).await
}

pub async fn complete_support_email_delivery(
    db: &PgPool,
    id: &str,
    provider_message_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE saas_support_email_outbox SET status='sent',provider_message_id=$2,last_error='',sent_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='sending'")
        .bind(id).bind(provider_message_id).execute(db).await?;
    Ok(())
}

pub async fn fail_support_email_delivery(
    db: &PgPool,
    id: &str,
    error: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE saas_support_email_outbox SET status='failed',last_error=$2,next_attempt_at=NOW()+(LEAST(attempts,5)*INTERVAL '5 minutes'),updated_at=NOW() WHERE id=$1 AND status='sending'")
        .bind(id).bind(error).execute(db).await?;
    Ok(())
}

pub async fn ingest_support_email(
    db: &PgPool,
    input: &SupportEmailWrite<'_>,
) -> Result<(String, bool), sqlx::Error> {
    let mut tx = db.begin().await?;
    let event_id = sqlx::query_scalar::<_, String>("INSERT INTO saas_support_email_events(provider_event_id,ses_message_id,payload_sha256) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id")
        .bind(input.provider_event_id).bind(input.ses_message_id).bind(input.payload_sha256).fetch_optional(&mut *tx).await?;
    if event_id.is_none() {
        let existing = sqlx::query_scalar::<_, Option<String>>("SELECT ticket_id FROM saas_support_email_events WHERE provider='ses' AND (provider_event_id=$1 OR ses_message_id=$2) ORDER BY received_at LIMIT 1")
            .bind(input.provider_event_id).bind(input.ses_message_id).fetch_one(&mut *tx).await?;
        tx.rollback().await?;
        return Ok((existing.unwrap_or_default(), true));
    }
    let mut references = input.references.to_vec();
    if !input.in_reply_to.is_empty() && !references.iter().any(|value| value == input.in_reply_to) {
        references.push(input.in_reply_to.to_string());
    }
    let existing = sqlx::query_scalar::<_, String>(
        r#"SELECT t.id FROM saas_support_tickets t
            WHERE t.tenant_id=$1 AND t.merged_into_ticket_id IS NULL AND (
              t.ticket_number=SUBSTRING($2 FROM '(SUP-[0-9]{8}-[A-Z0-9]{8})')
              OR EXISTS (SELECT 1 FROM saas_support_messages m WHERE m.ticket_id=t.id AND m.email_message_id=ANY($3))
            ) ORDER BY t.updated_at DESC LIMIT 1 FOR UPDATE"#,
    ).bind(input.tenant_id).bind(input.subject).bind(&references).fetch_optional(&mut *tx).await?;
    let (ticket_id, message_id) = if let Some(ticket_id) = existing {
        let message_id = insert_message(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            &ticket_id,
            input.sender_email,
            "customer",
            "customer",
            input.body,
            "email",
            Some(input.provider_event_id),
            Some(input.email_message_id),
            Some(input.in_reply_to),
            input.sender_email,
        )
        .await?;
        insert_attachments(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            &ticket_id,
            &message_id,
            "customer",
            input.attachments,
        )
        .await?;
        sqlx::query("UPDATE saas_support_tickets SET status=CASE WHEN status IN ('resolved','closed') THEN 'open' WHEN status='waiting_customer' THEN 'in_progress' ELSE status END,reopened_count=reopened_count+CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END,last_customer_message_at=NOW(),updated_by=$2,updated_at=NOW() WHERE id=$1")
            .bind(&ticket_id).bind(input.sender_email).execute(&mut *tx).await?;
        insert_ticket_event(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            &ticket_id,
            "email.reply_received",
            "",
            "",
            input.sender_email,
            json!({"sesMessageId":input.ses_message_id}),
        )
        .await?;
        (ticket_id, message_id)
    } else {
        let ticket_id = sqlx::query_scalar::<_, String>("INSERT INTO saas_support_tickets(tenant_id,branch_id,subscription_id,plan_id,ticket_number,subject,category,severity,priority,source,requester_email,queue_key,first_response_due_at,resolution_due_at,last_customer_message_at,created_by,updated_by) VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6,$7,$8,$9,'email',$10,$11,$12,$13,NOW(),$10,$10) RETURNING id")
            .bind(input.tenant_id).bind(input.branch_id).bind(input.subscription_id).bind(input.plan_id).bind(input.ticket_number).bind(input.subject).bind(input.category).bind(input.severity).bind(input.priority).bind(input.sender_email).bind(input.queue_key).bind(input.first_response_due_at).bind(input.resolution_due_at).fetch_one(&mut *tx).await?;
        let message_id = insert_message(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            &ticket_id,
            input.sender_email,
            "customer",
            "customer",
            input.body,
            "email",
            Some(input.provider_event_id),
            Some(input.email_message_id),
            Some(input.in_reply_to),
            input.sender_email,
        )
        .await?;
        insert_attachments(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            &ticket_id,
            &message_id,
            "customer",
            input.attachments,
        )
        .await?;
        insert_ticket_event(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            &ticket_id,
            "ticket.created_from_email",
            "",
            "open",
            input.sender_email,
            json!({"sesMessageId":input.ses_message_id}),
        )
        .await?;
        (ticket_id, message_id)
    };
    notify_platform_support(
        &mut tx,
        &ticket_id,
        "Support email received",
        input.subject,
        "saas_ticket_email",
    )
    .await?;
    sqlx::query("UPDATE saas_support_email_events SET ticket_id=$2,message_id=$3,status='processed',processed_at=NOW() WHERE id=$1")
        .bind(event_id.expect("reserved support email event")).bind(&ticket_id).bind(&message_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((ticket_id, false))
}

async fn notify_tenant_owners(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    ticket: &str,
    title: &str,
    body: &str,
    notification_type: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id) SELECT $1,COALESCE(NULLIF(u.branch_id,''),$2),u.id,'saas-support',$6,$4,$5,'saas_support_ticket',$3 FROM users u WHERE u.tenant_id=$1 AND u.active=TRUE AND REGEXP_REPLACE(LOWER(u.role_name),'[-_ ]','','g') IN ('owner','admin','tenantadmin','salonadmin')")
        .bind(tenant).bind(branch).bind(ticket).bind(title).bind(body).bind(notification_type).execute(&mut **tx).await?;
    Ok(())
}

async fn notify_platform_support(
    tx: &mut Transaction<'_, Postgres>,
    ticket: &str,
    title: &str,
    body: &str,
    notification_type: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id) SELECT u.tenant_id,COALESCE(NULLIF(u.branch_id,''),'global'),u.id,'saas-support',$4,$2,$3,'saas_support_ticket',$1 FROM users u WHERE u.active=TRUE AND (u.tenant_id='platform' OR REGEXP_REPLACE(LOWER(u.role_name),'[-_ ]','','g') IN ('superadmin','platformowner'))")
        .bind(ticket).bind(title).bind(body).bind(notification_type).execute(&mut **tx).await?;
    Ok(())
}

async fn insert_message(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    ticket: &str,
    actor: &str,
    author_type: &str,
    visibility: &str,
    body: &str,
    source: &str,
    external_event_id: Option<&str>,
    email_message_id: Option<&str>,
    in_reply_to: Option<&str>,
    sender_email: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO saas_support_messages(tenant_id,branch_id,ticket_id,author_id,author_type,visibility,body,source,external_event_id,email_message_id,in_reply_to,sender_email) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id")
        .bind(tenant).bind(branch).bind(ticket).bind(actor).bind(author_type).bind(visibility).bind(body).bind(source).bind(external_event_id).bind(email_message_id).bind(in_reply_to).bind(sender_email).fetch_one(&mut **tx).await
}

pub async fn tenant_branch_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM tenants t JOIN branches b ON b.tenant_id=t.id AND b.active=TRUE
            WHERE COALESCE(NULLIF(t.scope_id,''),t.id::text)=$1
              AND COALESCE(NULLIF(b.scope_id,''),b.id::text)=$2)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(db)
    .await
}

async fn insert_attachments(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    ticket: &str,
    message: &str,
    visibility: &str,
    attachments: &[SupportAttachmentWrite],
) -> Result<(), sqlx::Error> {
    for attachment in attachments {
        sqlx::query("INSERT INTO saas_support_attachments(tenant_id,branch_id,ticket_id,message_id,file_name,content_type,size_bytes,sha256,content,visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(tenant).bind(branch).bind(ticket).bind(message).bind(&attachment.file_name)
            .bind(&attachment.content_type).bind(attachment.bytes.len() as i64).bind(&attachment.sha256)
            .bind(&attachment.bytes).bind(visibility).execute(&mut **tx).await?;
    }
    Ok(())
}

async fn insert_ticket_event(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    ticket: &str,
    event_type: &str,
    from_status: &str,
    to_status: &str,
    actor: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO saas_support_events(tenant_id,branch_id,ticket_id,event_type,from_status,to_status,actor_id,details_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(tenant).bind(branch).bind(ticket).bind(event_type).bind(from_status).bind(to_status).bind(actor).bind(details).execute(&mut **tx).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        create_tenant_admin, onboard_salon, OnboardingError, OnboardingWrite, TenantAdminWrite,
    };
    use chrono::{Duration, Utc};
    use serde_json::json;
    use sqlx::PgPool;

    #[sqlx::test]
    async fn onboarding_is_atomic_and_idempotent(pool: PgPool) {
        let plan_id = sqlx::query_scalar::<_, String>(
            r#"INSERT INTO saas_plans(
                 code,name,billing_interval,base_price_paise,created_by,updated_by
               ) VALUES('ONBOARD-TEST','Onboarding Test','monthly',0,'test','test')
               RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let started_at = Utc::now();
        let input = OnboardingWrite {
            idempotency_key: "onboarding-test-1".into(),
            request_fingerprint: "fingerprint-1".into(),
            salon_name: "Atomic Salon".into(),
            salon_slug: "atomic-salon".into(),
            plan_id,
            owner_full_name: "Salon Owner".into(),
            owner_email: "owner@atomic-salon.test".into(),
            owner_password_hash: "argon-hash".into(),
            owner_permissions: json!(["tenant.read", "management.write"]),
            manager_permissions: json!(["tenant.read", "staff.read", "staff.manage"]),
            staff_permissions: json!(["tenant.read", "staff.self_manage"]),
            branch_name: "Main Branch".into(),
            branch_code: "MAIN".into(),
            branch_address: "".into(),
            domain: Some("atomic-salon.example.com".into()),
            started_at,
            trial_ends_at: started_at + Duration::days(14),
            actor: "platform-user".into(),
        };

        let created = onboard_salon(&pool, &input).await.unwrap();
        let replayed = onboard_salon(&pool, &input).await.unwrap();
        assert_eq!(created.tenant_id, replayed.tenant_id);
        assert!(replayed.replayed);
        let owner_security = sqlx::query_as::<_, (bool, bool, bool, bool, bool)>(
            r#"SELECT u.must_change_password,u.password_changed_at IS NULL,
                      EXISTS(SELECT 1 FROM roles r WHERE r.tenant_id=u.tenant_id
                        AND r.is_system=TRUE AND LOWER(r.name)='admin'),
                      EXISTS(SELECT 1 FROM roles r WHERE r.tenant_id=u.tenant_id
                        AND r.is_system=TRUE AND LOWER(r.name)='manager'
                        AND r.permissions_json ? 'staff.manage'),
                      EXISTS(SELECT 1 FROM roles r WHERE r.tenant_id=u.tenant_id
                        AND r.is_system=TRUE AND LOWER(r.name)='staff'
                        AND r.permissions_json ? 'staff.self_manage')
                 FROM users u WHERE u.id=$1"#,
        )
        .bind(&created.owner_user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(owner_security, (true, true, true, true, true));

        let admin = create_tenant_admin(
            &pool,
            &TenantAdminWrite {
                tenant_id: &created.tenant_id,
                default_branch_id: &created.branch_id,
                full_name: "Tenant Admin",
                login_id: "tenant.admin",
                email: "admin@atomic-salon.test",
                password_hash: "argon-hash",
                actor: &created.owner_user_id,
            },
        )
        .await
        .unwrap();
        assert!(admin.must_change_password);
        assert_eq!(admin.branch_count, 1);

        let mut changed_request = input.clone();
        changed_request.request_fingerprint = "different-fingerprint".into();
        assert!(matches!(
            onboard_salon(&pool, &changed_request).await,
            Err(OnboardingError::IdempotencyConflict)
        ));

        let mut domain_conflict = input.clone();
        domain_conflict.idempotency_key = "onboarding-test-2".into();
        domain_conflict.request_fingerprint = "fingerprint-2".into();
        domain_conflict.salon_name = "Rolled Back Salon".into();
        domain_conflict.salon_slug = "rolled-back-salon".into();
        domain_conflict.owner_email = "owner@rolled-back.test".into();
        assert!(matches!(
            onboard_salon(&pool, &domain_conflict).await,
            Err(OnboardingError::Database(_))
        ));
        let partial_tenant_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM tenants WHERE slug='rolled-back-salon')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(!partial_tenant_exists);
    }
}
