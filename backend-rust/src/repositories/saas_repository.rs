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
pub struct TicketSlaContext {
    pub subscription_id: String,
    pub plan_id: String,
    pub first_response_minutes: i32,
    pub resolution_minutes: i32,
    pub business_hours_only: bool,
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
    pub included_branches: Option<i32>,
    pub overage_branch_paise: Option<i64>,
    pub active_branch_count: i64,
    pub plan_features: Option<serde_json::Value>,
    pub grace_period_days: Option<i32>,
    pub suspension_policy: Option<String>,
    pub retention_window_days: Option<i32>,
    pub current_period_end: Option<chrono::DateTime<chrono::Utc>>,
    pub trial_ends_at: Option<chrono::DateTime<chrono::Utc>>,
    pub cancelled_at: Option<chrono::DateTime<chrono::Utc>>,
    pub override_status: Option<String>,
    pub override_expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

const ENTITLEMENT_CONTEXT_SQL: &str = r#"
    SELECT tenant.status AS tenant_status,
           subscription.status AS subscription_status,
           subscription.included_branches,
           subscription.overage_branch_paise,
           (SELECT COUNT(*) FROM branches branch
             WHERE branch.tenant_id=tenant.id AND branch.active=TRUE) AS active_branch_count,
           subscription.features_json AS plan_features,
           subscription.grace_period_days,
           subscription.suspension_policy,
           subscription.retention_window_days,
           subscription.current_period_end,
           subscription.trial_ends_at,
           subscription.cancelled_at,
           override.override_status,
           override.expires_at AS override_expires_at
      FROM tenants tenant
      LEFT JOIN LATERAL (
        SELECT current.id AS subscription_id,current.status,
               current.current_period_end,current.trial_ends_at,current.cancelled_at,
               plan.included_branches,plan.overage_branch_paise,plan.features_json,
               plan.grace_period_days,plan.suspension_policy,plan.retention_window_days
          FROM saas_subscriptions current
          JOIN saas_plans plan ON plan.id=current.plan_id
         WHERE current.tenant_id=tenant.id::text
         ORDER BY CASE WHEN current.status IN ('trialing','active','past_due','grace','paused','suspended')
                       THEN 0 ELSE 1 END,
                  current.created_at DESC
         LIMIT 1
      ) subscription ON TRUE
      LEFT JOIN LATERAL (
        SELECT active_override.override_status,active_override.expires_at
          FROM saas_subscription_overrides active_override
         WHERE active_override.subscription_id=subscription.subscription_id
           AND active_override.revoked_at IS NULL
           AND active_override.expires_at > NOW()
         ORDER BY active_override.created_at DESC
         LIMIT 1
      ) override ON TRUE
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
    let owner_user_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO users(
             tenant_id,branch_id,role_id,role_name,login_id,email,password_hash,full_name,
             active,must_change_password,password_changed_at
           ) VALUES($1,$2,$3,'Owner',$4,$4,$5,$6,TRUE,FALSE,NOW()) RETURNING id"#,
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

pub async fn list_tenants(db: &PgPool) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'id',COALESCE(NULLIF(t.scope_id,''),t.id::TEXT),'name',t.name,'slug',COALESCE(t.slug,''),'status',t.status,
          'branchCount',(SELECT COUNT(*) FROM branches b WHERE b.tenant_id=t.id AND b.active=TRUE),
          'subscriptionStatus',COALESCE((SELECT s.status FROM saas_subscriptions s WHERE s.tenant_id=COALESCE(NULLIF(t.scope_id,''),t.id::TEXT) ORDER BY s.created_at DESC LIMIT 1),'none')
        ) FROM tenants t
        WHERE COALESCE(NULLIF(t.scope_id,''),t.id::TEXT)<>'platform'
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
          'providerSubscriptionRef',s.provider_subscription_ref,'version',s.version,'createdAt',s.created_at,'updatedAt',s.updated_at
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

pub async fn create_subscription_override(
    db: &PgPool,
    subscription_id: &str,
    override_status: &str,
    reason: &str,
    expires_at: DateTime<Utc>,
    actor: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar::<_, Value>(
        r#"
        INSERT INTO saas_subscription_overrides (
          tenant_id, subscription_id, override_status, reason, expires_at, created_by
        )
        SELECT s.tenant_id, s.id, $2, $3, $4, $5
          FROM saas_subscriptions s
         WHERE s.id=$1
        RETURNING jsonb_build_object(
          'id', id, 'tenantId', tenant_id, 'subscriptionId', subscription_id,
          'overrideStatus', override_status, 'reason', reason,
          'expiresAt', expires_at, 'createdBy', created_by, 'createdAt', created_at
        )
        "#,
    )
    .bind(subscription_id)
    .bind(override_status)
    .bind(reason)
    .bind(expires_at)
    .bind(actor)
    .fetch_optional(db)
    .await
}

pub async fn list_subscription_overrides(
    db: &PgPool,
    subscription_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar::<_, Value>(
        r#"
        SELECT jsonb_build_object(
          'id', id, 'tenantId', tenant_id, 'subscriptionId', subscription_id,
          'overrideStatus', override_status, 'reason', reason,
          'expiresAt', expires_at, 'createdBy', created_by, 'createdAt', created_at,
          'revokedAt', revoked_at, 'revokedBy', revoked_by,
          'active', revoked_at IS NULL AND expires_at > NOW()
        )
        FROM saas_subscription_overrides
        WHERE subscription_id=$1
        ORDER BY created_at DESC
        LIMIT 200
        "#,
    )
    .bind(subscription_id)
    .fetch_all(db)
    .await
}

pub async fn revoke_subscription_override(
    db: &PgPool,
    override_id: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let changed = sqlx::query(
        "UPDATE saas_subscription_overrides SET revoked_at=NOW(), revoked_by=$2 WHERE id=$1 AND revoked_at IS NULL",
    )
    .bind(override_id)
    .bind(actor)
    .execute(db)
    .await?
    .rows_affected();
    Ok(changed > 0)
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
          COALESCE((SELECT SUM(e.quantity) FROM saas_usage_events e WHERE e.tenant_id=$1 AND e.subscription_id=$2 AND e.metric='api_calls' AND e.occurred_at>=$3 AND e.occurred_at<$4),0) api_calls,
          COALESCE((SELECT SUM(e.quantity) FROM saas_usage_events e WHERE e.tenant_id=$1 AND e.subscription_id=$2 AND e.metric='messages' AND e.occurred_at>=$3 AND e.occurred_at<$4),0) messages,
          COALESCE((SELECT SUM(e.quantity) FROM saas_usage_events e WHERE e.tenant_id=$1 AND e.subscription_id=$2 AND e.metric='storage_mb' AND e.occurred_at>=$3 AND e.occurred_at<$4),0) storage_mb"#,
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
          'dueAt',i.due_at,'issuedAt',i.issued_at,'paidAt',i.paid_at)
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
) -> Result<String, sqlx::Error> {
    let mut tx = db.begin().await?;
    let id=sqlx::query_scalar::<_,String>("INSERT INTO saas_support_tickets(tenant_id,branch_id,subscription_id,plan_id,ticket_number,subject,category,severity,priority,first_response_due_at,resolution_due_at,created_by,updated_by) VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(subscription_id).bind(plan_id).bind(ticket_number).bind(subject).bind(category).bind(severity).bind(priority).bind(first_response_due_at).bind(resolution_due_at).bind(actor).fetch_one(&mut *tx).await?;
    insert_message(
        &mut tx, tenant_id, branch_id, &id, actor, "customer", "customer", body,
    )
    .await?;
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
    sqlx::query_scalar::<_,Value>(r#"SELECT jsonb_build_object('id',t.id,'tenantId',t.tenant_id,'tenantName',COALESCE(tenant.name,t.tenant_id),'branchId',t.branch_id,'ticketNumber',t.ticket_number,'subject',t.subject,'category',t.category,'severity',t.severity,'priority',t.priority,'status',t.status,'firstResponseDueAt',t.first_response_due_at,'resolutionDueAt',t.resolution_due_at,'firstRespondedAt',t.first_responded_at,'resolvedAt',t.resolved_at,'assignedTo',t.assigned_to,'responseBreached',t.first_responded_at IS NULL AND t.first_response_due_at<NOW(),'resolutionBreached',t.resolved_at IS NULL AND t.resolution_due_at<NOW(),'createdAt',t.created_at,'updatedAt',t.updated_at) FROM saas_support_tickets t LEFT JOIN tenants tenant ON COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=t.tenant_id WHERE ($1::TEXT IS NULL OR t.tenant_id=$1) ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'waiting_customer' THEN 2 ELSE 3 END,CASE t.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,t.created_at DESC LIMIT 1000"#)
        .bind(tenant_filter).fetch_all(db).await
}

pub async fn ticket_detail(
    db: &PgPool,
    id: &str,
    tenant_filter: Option<&str>,
    include_internal: bool,
) -> Result<Option<Value>, sqlx::Error> {
    let ticket=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',id,'tenantId',tenant_id,'branchId',branch_id,'ticketNumber',ticket_number,'subject',subject,'category',category,'severity',severity,'priority',priority,'status',status,'firstResponseDueAt',first_response_due_at,'resolutionDueAt',resolution_due_at,'firstRespondedAt',first_responded_at,'resolvedAt',resolved_at,'assignedTo',assigned_to,'createdAt',created_at,'updatedAt',updated_at) FROM saas_support_tickets WHERE id=$1 AND ($2::TEXT IS NULL OR tenant_id=$2)")
        .bind(id).bind(tenant_filter).fetch_optional(db).await?;
    let Some(ticket) = ticket else {
        return Ok(None);
    };
    let messages=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',id,'authorId',author_id,'authorType',author_type,'visibility',visibility,'body',body,'createdAt',created_at) FROM saas_support_messages WHERE ticket_id=$1 AND ($2 OR visibility='customer') ORDER BY created_at")
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
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row=sqlx::query_as::<_,(String,String,String)>("SELECT tenant_id,branch_id,status FROM saas_support_tickets WHERE id=$1 AND ($2::TEXT IS NULL OR tenant_id=$2) FOR UPDATE").bind(ticket_id).bind(tenant_filter).fetch_optional(&mut *tx).await?;
    let Some((tenant_id, branch_id, status)) = row else {
        tx.rollback().await?;
        return Ok(false);
    };
    insert_message(
        &mut tx,
        &tenant_id,
        &branch_id,
        ticket_id,
        actor,
        author_type,
        visibility,
        body,
    )
    .await?;
    if author_type == "support" {
        sqlx::query("UPDATE saas_support_tickets SET first_responded_at=COALESCE(first_responded_at,NOW()),status=CASE WHEN status='open' THEN 'in_progress' ELSE status END,updated_by=$2,updated_at=NOW() WHERE id=$1").bind(ticket_id).bind(actor).execute(&mut *tx).await?;
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
    sqlx::query("UPDATE saas_support_tickets SET status=$3,assigned_to=$4,priority=$5,resolved_at=CASE WHEN $3='resolved' THEN COALESCE(resolved_at,NOW()) WHEN $3 IN ('open','in_progress','waiting_customer') THEN NULL ELSE resolved_at END,closed_at=CASE WHEN $3='closed' THEN NOW() ELSE NULL END,updated_by=$2,updated_at=NOW() WHERE id=$1").bind(id).bind(actor).bind(status).bind(assigned_to).bind(priority).execute(&mut *tx).await?;
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
    tx.commit().await?;
    Ok(true)
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
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO saas_support_messages(tenant_id,branch_id,ticket_id,author_id,author_type,visibility,body) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(tenant).bind(branch).bind(ticket).bind(actor).bind(author_type).bind(visibility).bind(body).execute(&mut **tx).await?;
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
    use super::{onboard_salon, OnboardingError, OnboardingWrite};
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
