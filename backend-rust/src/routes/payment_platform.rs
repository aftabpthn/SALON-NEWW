use axum::{
    body::Bytes,
    extract::{Extension, Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::{context::tenant_branch, pos::settle_deferred_customer_commerce_benefits},
    services::{
        accounting_service, auth_service::AuthClaims, payment_gateway_service,
        payment_platform_service as platform, security_service,
    },
    state::AppState,
};

type HmacSha256 = Hmac<Sha256>;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/pos/payment-platform/overview", get(overview))
        .route("/pos/payment-platform/onboarding", post(start_onboarding))
        .route(
            "/pos/payment-platform/accounts/:provider/refresh",
            post(refresh_account),
        )
        .route(
            "/pos/payment-platform/providers/:provider/status",
            post(set_provider_status),
        )
        .route("/pos/payment-platform/payments", post(create_payment))
        .route("/pos/payment-platform/setup-sessions", post(create_setup))
        .route(
            "/pos/payment-platform/terminal-sessions",
            post(create_terminal_session),
        )
        .route("/pos/payment-platform/payouts", post(create_payout))
        .route("/pos/payment-platform/settlements", get(list_settlements))
        .route("/pos/payment-platform/disputes", get(list_disputes))
        .route("/pos/payment-platform/webhooks", get(list_webhook_health))
}

pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/webhooks/stripe", post(receive_stripe_webhook))
        .route("/webhooks/adyen", post(receive_adyen_webhook))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OnboardingPayload {
    #[serde(flatten)]
    request: platform::OnboardingRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OperationPayload<T> {
    pub provider: String,
    pub idempotency_key: String,
    pub sale_id: Option<String>,
    pub client_id: Option<String>,
    pub mfa_code: Option<String>,
    pub request: T,
}

#[derive(Deserialize)]
struct ProviderStatusPayload {
    enabled: bool,
}

async fn overview(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let stripe_enabled = payment_gateway_service::provider_enabled_for_branch(
        &state.db,
        &state.settings,
        &tenant,
        &branch,
        "stripe",
    )
    .await?;
    let adyen_enabled = payment_gateway_service::provider_enabled_for_branch(
        &state.db,
        &state.settings,
        &tenant,
        &branch,
        "adyen",
    )
    .await?;
    let accounts = sqlx::query_scalar::<_, Value>(
        r#"SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id',id,'provider',provider,'providerAccountId',provider_account_id,
          'country',country,'currency',default_currency,'businessType',business_type,
          'status',status,'kycStatus',kyc_status,'chargesEnabled',charges_enabled,
          'payoutsEnabled',payouts_enabled,'detailsSubmitted',details_submitted,
          'capabilities',capabilities_json,'requirements',requirements_json,
          'pciStatus',pci_status,'pciAttestationDueAt',pci_attestation_due_at,
          'updatedAt',updated_at,'createdAt',created_at
        ) ORDER BY provider),'[]'::jsonb)
        FROM payment_merchant_accounts WHERE tenant_id=$1 AND branch_id=$2"#,
    )
    .bind(&tenant)
    .bind(&branch)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load payment merchant accounts"))?;
    let operations = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'pending',COUNT(*) FILTER (WHERE status IN ('pending','requires_action','processing')),
          'failed',COUNT(*) FILTER (WHERE status IN ('failed','canceled')),
          'payoutsPending',COUNT(*) FILTER (WHERE operation_type='payout' AND status IN ('pending','processing'))
        ) FROM payment_provider_operations WHERE tenant_id=$1 AND branch_id=$2"#,
    )
    .bind(&tenant)
    .bind(&branch)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load payment operation summary"))?;
    let disputes = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::BIGINT FROM payment_disputes WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('open','under_review')",
    )
    .bind(&tenant)
    .bind(&branch)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load payment dispute summary"))?;
    Ok(Json(ApiResponse::ok(json!({
        "accounts":accounts,
        "operations":operations,
        "openDisputes":disputes,
        "providers":{
            "stripe":{"configured":state.settings.payment_provider_enabled("stripe"),"enabled":stripe_enabled,"webhookConfigured":state.settings.payment_provider_webhook_configured("stripe")},
            "adyen":{"configured":state.settings.payment_provider_enabled("adyen"),"enabled":adyen_enabled,"webhookConfigured":state.settings.payment_provider_webhook_configured("adyen")}
        }
    }))))
}

async fn start_onboarding(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OnboardingPayload>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    require_payment_manage(&claims)?;
    ensure_provider_ready(&state, &payload.request.provider)?;
    ensure_branch_provider_enabled(&state, &tenant, &branch, &payload.request.provider).await?;
    let existing = sqlx::query_as::<_, (String, String)>(
        "SELECT id,provider_account_id FROM payment_merchant_accounts WHERE tenant_id=$1 AND branch_id=$2 AND provider=$3",
    )
    .bind(&tenant)
    .bind(&branch)
    .bind(&payload.request.provider)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load payment merchant account"))?;
    let result = platform::create_onboarding(
        &state.settings,
        &payload.request,
        existing.as_ref().map(|row| row.1.as_str()),
    )
    .await?;
    let id = existing
        .map(|row| row.0)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    sqlx::query(
        r#"INSERT INTO payment_merchant_accounts (
          id,tenant_id,branch_id,provider,provider_account_id,legal_entity_id,country,
          default_currency,business_type,status,kyc_status,created_by_user_id,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending','in_progress',$10,NOW())
        ON CONFLICT (tenant_id,branch_id,provider) DO UPDATE SET
          provider_account_id=EXCLUDED.provider_account_id,legal_entity_id=EXCLUDED.legal_entity_id,
          country=EXCLUDED.country,default_currency=EXCLUDED.default_currency,
          business_type=EXCLUDED.business_type,kyc_status='in_progress',updated_at=NOW()"#,
    )
    .bind(&id)
    .bind(&tenant)
    .bind(&branch)
    .bind(&payload.request.provider)
    .bind(&result.provider_account_id)
    .bind(&result.legal_entity_id)
    .bind(payload.request.country.to_ascii_uppercase())
    .bind(payload.request.currency.to_ascii_uppercase())
    .bind(&payload.request.business_type)
    .bind(&claims.sub)
    .execute(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to save payment merchant account"))?;
    audit(
        &state,
        &tenant,
        &branch,
        &claims.sub,
        "payments.onboarding.started",
        json!({"provider":payload.request.provider,"merchantAccountId":id}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(json!({
        "merchantAccountId":id,
        "provider":payload.request.provider,
        "onboardingUrl":result.onboarding_url,
        "status":"in_progress"
    }))))
}

async fn refresh_account(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(provider): Path<String>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    require_payment_manage(&claims)?;
    ensure_branch_provider_enabled(&state, &tenant, &branch, &provider).await?;
    let (id, account_id) = merchant_account(&state, &tenant, &branch, &provider).await?;
    let payload = platform::retrieve_account(&state.settings, &provider, &account_id).await?;
    let (status, kyc, charges, payouts, submitted, capabilities, requirements) =
        account_state(&provider, &payload);
    sqlx::query("UPDATE payment_merchant_accounts SET status=$4,kyc_status=$5,charges_enabled=$6,payouts_enabled=$7,details_submitted=$8,capabilities_json=$9::jsonb,requirements_json=$10::jsonb,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&tenant).bind(&branch).bind(&id).bind(status).bind(kyc).bind(charges).bind(payouts).bind(submitted)
        .bind(capabilities.to_string()).bind(requirements.to_string()).execute(&state.db).await
        .map_err(|_|AppError::internal("failed to refresh payment merchant account"))?;
    audit(
        &state,
        &tenant,
        &branch,
        &claims.sub,
        "payments.account.refreshed",
        json!({"provider":provider,"merchantAccountId":id}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        json!({"id":id,"provider":provider,"status":status,"kycStatus":kyc,"chargesEnabled":charges,"payoutsEnabled":payouts,"detailsSubmitted":submitted,"capabilities":capabilities,"requirements":requirements}),
    )))
}

async fn set_provider_status(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(provider): Path<String>,
    Json(payload): Json<ProviderStatusPayload>,
) -> ApiResult<Value> {
    require_payment_manage(&claims)?;
    let provider = provider.trim().to_ascii_lowercase();
    let supported = crate::config::PAYMENT_PROVIDER_CATALOG
        .iter()
        .any(|entry| entry.provider == provider && entry.implemented);
    if !supported {
        return Err(AppError::validation("payment provider is not available"));
    }
    if payload.enabled && !state.settings.payment_provider_enabled(&provider) {
        return Err(AppError::conflict(
            "payment provider credentials are not configured",
        ));
    }
    let (tenant, branch) = tenant_branch(&headers)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to update payment provider status"))?;
    sqlx::query(
        r#"INSERT INTO payment_provider_branch_controls
           (tenant_id,branch_id,provider,enabled,updated_by_user_id)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id,branch_id,provider) DO UPDATE SET
             enabled=EXCLUDED.enabled,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW()"#,
    )
    .bind(&tenant)
    .bind(&branch)
    .bind(&provider)
    .bind(payload.enabled)
    .bind(&claims.sub)
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to update payment provider status"))?;
    sqlx::query(
        "UPDATE payment_merchant_accounts SET status=CASE WHEN $4 THEN CASE WHEN status='disabled' THEN 'pending' ELSE status END ELSE 'disabled' END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND provider=$3",
    )
    .bind(&tenant)
    .bind(&branch)
    .bind(&provider)
    .bind(payload.enabled)
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to update payment merchant account status"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to update payment provider status"))?;
    audit(
        &state,
        &tenant,
        &branch,
        &claims.sub,
        if payload.enabled {
            "payments.provider.enabled"
        } else {
            "payments.provider.disabled"
        },
        json!({"provider":provider,"enabled":payload.enabled}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(json!({
        "provider":provider,"enabled":payload.enabled
    }))))
}

pub(crate) async fn create_payment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OperationPayload<platform::PaymentRequest>>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    if payload.sale_id.as_deref().unwrap_or("").is_empty() {
        return Err(AppError::validation("saleId is required"));
    }
    let account =
        active_merchant_account(&state, &tenant, &branch, &payload.provider, true).await?;
    operation(
        &state,
        &claims,
        &tenant,
        &branch,
        &account,
        "payment",
        payload.idempotency_key,
        payload.sale_id.unwrap_or_default(),
        payload.client_id.unwrap_or_default(),
        payload.request.amount_paise,
        &payload.request.currency,
        |key| {
            platform::create_payment(
                &state.settings,
                &payload.provider,
                &account.1,
                &payload.request,
                key,
            )
        },
    )
    .await
}

async fn create_setup(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OperationPayload<platform::SetupRequest>>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let account =
        active_merchant_account(&state, &tenant, &branch, &payload.provider, true).await?;
    operation(
        &state,
        &claims,
        &tenant,
        &branch,
        &account,
        "setup",
        payload.idempotency_key,
        payload.sale_id.unwrap_or_default(),
        payload.client_id.unwrap_or_default(),
        0,
        &payload.request.currency,
        |key| {
            platform::create_setup(
                &state.settings,
                &payload.provider,
                &account.1,
                &payload.request,
                key,
            )
        },
    )
    .await
}

async fn create_terminal_session(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OperationPayload<Value>>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let account =
        active_merchant_account(&state, &tenant, &branch, &payload.provider, true).await?;
    operation(
        &state,
        &claims,
        &tenant,
        &branch,
        &account,
        "terminal_session",
        payload.idempotency_key,
        String::new(),
        String::new(),
        0,
        "USD",
        |key| {
            platform::create_terminal_session(&state.settings, &payload.provider, &account.1, key)
        },
    )
    .await
}

async fn create_payout(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OperationPayload<platform::PayoutRequest>>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant,
        &branch,
        &claims.sub,
        &claims.session_id,
        payload.mfa_code.as_deref(),
        "payments.payout.create",
    )
    .await?;
    let account =
        active_merchant_account(&state, &tenant, &branch, &payload.provider, false).await?;
    operation(
        &state,
        &claims,
        &tenant,
        &branch,
        &account,
        "payout",
        payload.idempotency_key,
        String::new(),
        String::new(),
        payload.request.amount_paise,
        &payload.request.currency,
        |key| {
            platform::create_payout(
                &state.settings,
                &payload.provider,
                &account.1,
                &payload.request,
                key,
            )
        },
    )
    .await
}

async fn list_settlements(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    list_json(&state,&headers,"SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'provider',provider,'providerSettlementId',provider_settlement_id,'currency',currency,'grossPaise',gross_paise,'feePaise',fee_paise,'netPaise',net_paise,'status',status,'availableAt',available_at,'paidAt',paid_at,'createdAt',created_at) ORDER BY created_at DESC),'[]'::jsonb) FROM (SELECT * FROM payment_provider_settlements WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 200) rows","failed to load payment settlements").await
}

async fn list_disputes(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    list_json(&state,&headers,"SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'saleId',sale_id,'paymentId',payment_id,'provider',provider,'providerDisputeId',provider_dispute_id,'amountPaise',amount_paise,'currency',currency,'reason',reason,'status',status,'evidenceDueAt',evidence_due_at,'openedAt',opened_at,'resolvedAt',resolved_at) ORDER BY opened_at DESC),'[]'::jsonb) FROM (SELECT * FROM payment_disputes WHERE tenant_id=$1 AND branch_id=$2 ORDER BY opened_at DESC LIMIT 200) rows","failed to load payment disputes").await
}

async fn list_webhook_health(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let value=sqlx::query_scalar::<_,Value>("SELECT COALESCE(jsonb_agg(jsonb_build_object('provider',receipt.provider,'eventId',receipt.provider_event_id,'eventType',receipt.event_type,'signatureVerified',receipt.signature_verified,'status',receipt.status,'attempts',receipt.attempts,'lastError',receipt.last_error,'receivedAt',receipt.received_at,'processedAt',receipt.processed_at) ORDER BY receipt.received_at DESC),'[]'::jsonb) FROM payment_webhook_receipts receipt JOIN payment_merchant_accounts account ON account.id=receipt.merchant_account_id WHERE account.tenant_id=$1 AND account.branch_id=$2 LIMIT 200").bind(tenant).bind(branch).fetch_one(&state.db).await.map_err(|_|AppError::internal("failed to load payment webhook health"))?;
    Ok(Json(ApiResponse::ok(value)))
}

async fn list_json(
    state: &AppState,
    headers: &HeaderMap,
    query: &str,
    error: &str,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(headers)?;
    let value = sqlx::query_scalar::<_, Value>(query)
        .bind(tenant)
        .bind(branch)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::internal(error))?;
    Ok(Json(ApiResponse::ok(value)))
}

async fn operation<F, Fut>(
    state: &AppState,
    claims: &AuthClaims,
    tenant: &str,
    branch: &str,
    account: &(String, String, String),
    operation_type: &str,
    idempotency_key: String,
    sale_id: String,
    client_id: String,
    amount_paise: i64,
    currency: &str,
    provider_call: F,
) -> ApiResult<Value>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<Value, AppError>>,
{
    validate_idempotency(&idempotency_key)?;
    if let Some(existing)=sqlx::query_scalar::<_,Value>("SELECT result_json FROM payment_provider_operations WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3 AND result_json<>'{}'::jsonb").bind(tenant).bind(branch).bind(&idempotency_key).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to read payment idempotency key"))?{
        return Ok(Json(ApiResponse::ok(existing)));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO payment_provider_operations (id,tenant_id,branch_id,merchant_account_id,provider,operation_type,sale_id,client_id,amount_paise,currency,status,idempotency_key,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12) ON CONFLICT (tenant_id,branch_id,idempotency_key) DO NOTHING")
        .bind(&id).bind(tenant).bind(branch).bind(&account.0).bind(&account.2).bind(operation_type).bind(&sale_id).bind(&client_id).bind(amount_paise).bind(currency.to_ascii_uppercase()).bind(&idempotency_key).bind(&claims.sub).execute(&state.db).await.map_err(|_|AppError::internal("failed to reserve payment operation"))?;
    let result = provider_call(idempotency_key.clone()).await;
    let result = match result {
        Ok(value) => value,
        Err(error) => {
            let _=sqlx::query("UPDATE payment_provider_operations SET status='failed',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3").bind(tenant).bind(branch).bind(&idempotency_key).execute(&state.db).await;
            return Err(error);
        }
    };
    let provider_object_id = result
        .get("id")
        .or_else(|| result.get("pspReference"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let status = result
        .get("status")
        .or_else(|| result.get("resultCode"))
        .and_then(Value::as_str)
        .unwrap_or("pending")
        .to_ascii_lowercase();
    sqlx::query("UPDATE payment_provider_operations SET provider_object_id=$4,status=$5,result_json=$6::jsonb,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
      .bind(tenant).bind(branch).bind(&idempotency_key).bind(provider_object_id).bind(&status).bind(result.to_string()).execute(&state.db).await.map_err(|_|AppError::internal("failed to save payment provider response"))?;
    audit(state,tenant,branch,&claims.sub,&format!("payments.{operation_type}.created"),json!({"provider":account.2,"providerObjectId":provider_object_id,"idempotencyKey":idempotency_key})).await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn merchant_account(
    state: &AppState,
    tenant: &str,
    branch: &str,
    provider: &str,
) -> Result<(String, String), AppError> {
    sqlx::query_as("SELECT id,provider_account_id FROM payment_merchant_accounts WHERE tenant_id=$1 AND branch_id=$2 AND provider=$3").bind(tenant).bind(branch).bind(provider).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to load merchant account"))?.ok_or_else(||AppError::not_found("payment merchant account was not found"))
}

async fn active_merchant_account(
    state: &AppState,
    tenant: &str,
    branch: &str,
    provider: &str,
    charges: bool,
) -> Result<(String, String, String), AppError> {
    ensure_provider_ready(state, provider)?;
    ensure_branch_provider_enabled(state, tenant, branch, provider).await?;
    let row=sqlx::query_as::<_,(String,String,String,bool,bool)>("SELECT id,provider_account_id,provider,charges_enabled,payouts_enabled FROM payment_merchant_accounts WHERE tenant_id=$1 AND branch_id=$2 AND provider=$3").bind(tenant).bind(branch).bind(provider).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to load active merchant account"))?.ok_or_else(||AppError::not_found("payment merchant account was not found"))?;
    if (charges && !row.3) || (!charges && !row.4) {
        return Err(AppError::conflict(if charges {
            "merchant account is not enabled for charges"
        } else {
            "merchant account is not enabled for payouts"
        }));
    }
    Ok((row.0, row.1, row.2))
}

async fn ensure_branch_provider_enabled(
    state: &AppState,
    tenant: &str,
    branch: &str,
    provider: &str,
) -> Result<(), AppError> {
    if !payment_gateway_service::provider_enabled_for_branch(
        &state.db,
        &state.settings,
        tenant,
        branch,
        provider,
    )
    .await?
    {
        return Err(AppError::conflict(
            "payment provider is disabled for this branch",
        ));
    }
    Ok(())
}

fn require_payment_manage(claims: &AuthClaims) -> Result<(), AppError> {
    let denied = claims
        .denied_permissions
        .iter()
        .any(|permission| permission == "pos.manage");
    if !denied
        && (claims.role.eq_ignore_ascii_case("owner")
            || claims.role.eq_ignore_ascii_case("admin")
            || claims
                .permissions
                .iter()
                .any(|permission| permission == "pos.manage"))
    {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "payment integration management permission is required",
        ))
    }
}

fn ensure_provider_ready(state: &AppState, provider: &str) -> Result<(), AppError> {
    if !matches!(provider, "stripe" | "adyen") {
        return Err(AppError::validation("provider must be stripe or adyen"));
    }
    if !state.settings.payment_provider_enabled(provider) {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_NOT_CONFIGURED",
            format!("{provider} credentials are not configured"),
        ));
    }
    Ok(())
}

fn validate_idempotency(value: &str) -> Result<(), AppError> {
    if !(10..=120).contains(&value.len())
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'))
    {
        return Err(AppError::validation(
            "idempotencyKey must be 10-120 letters, numbers, hyphens, underscores, or colons",
        ));
    }
    Ok(())
}

fn account_state(
    provider: &str,
    payload: &Value,
) -> (&'static str, &'static str, bool, bool, bool, Value, Value) {
    if provider == "stripe" {
        let charges = payload
            .get("charges_enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let payouts = payload
            .get("payouts_enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let submitted = payload
            .get("details_submitted")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let requirements = payload
            .get("requirements")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let due = requirements
            .get("currently_due")
            .and_then(Value::as_array)
            .is_some_and(|v| !v.is_empty());
        let status = if charges && payouts {
            "active"
        } else if due {
            "requirements_due"
        } else {
            "pending"
        };
        let kyc = if charges && payouts {
            "verified"
        } else if due {
            "requirements_due"
        } else {
            "in_progress"
        };
        (
            status,
            kyc,
            charges,
            payouts,
            submitted,
            payload
                .get("capabilities")
                .cloned()
                .unwrap_or_else(|| json!({})),
            requirements,
        )
    } else {
        let problems = payload
            .get("problems")
            .cloned()
            .unwrap_or_else(|| json!([]));
        let due = problems.as_array().is_some_and(|v| !v.is_empty());
        (
            if due { "requirements_due" } else { "pending" },
            if due {
                "requirements_due"
            } else {
                "in_progress"
            },
            false,
            false,
            false,
            json!({}),
            json!({"problems":problems}),
        )
    }
}

async fn audit(
    state: &AppState,
    tenant: &str,
    branch: &str,
    user: &str,
    action: &str,
    payload: Value,
) -> Result<(), AppError> {
    security_service::record_audit(&state.db, tenant, branch, user, action, payload).await
}

async fn receive_stripe_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let secret = state
        .settings
        .stripe_webhook_secret
        .as_deref()
        .ok_or_else(|| {
            AppError::service_unavailable(
                "PAYMENT_PROVIDER_NOT_CONFIGURED",
                "Stripe webhook is not configured",
            )
        })?;
    verify_stripe_signature(&headers, secret, &body)?;
    let payload: Value = serde_json::from_slice(&body)
        .map_err(|_| AppError::validation("invalid Stripe webhook payload"))?;
    let event_id = payload
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::validation("Stripe event id is required"))?;
    let event_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let object = payload
        .pointer("/data/object")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let account = payload
        .get("account")
        .and_then(Value::as_str)
        .or_else(|| object.get("account").and_then(Value::as_str))
        .unwrap_or("");
    let merchant_id = merchant_id_for_event(&state, "stripe", account, event_id).await?;
    if !record_webhook(&state, "stripe", event_id, event_type, &merchant_id, &body).await? {
        return Ok(Json(json!({"received":true,"duplicate":true})));
    }
    let result = process_provider_event(&state, "stripe", event_type, &object, &merchant_id).await;
    finish_webhook(
        &state,
        "stripe",
        event_id,
        event_type,
        result.as_ref().err().map(|e| format!("{e:?}")),
    )
    .await?;
    result?;
    Ok(Json(json!({"received":true})))
}

async fn receive_adyen_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let payload: Value = serde_json::from_slice(&body)
        .map_err(|_| AppError::validation("invalid Adyen webhook payload"))?;
    let items = payload
        .get("notificationItems")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::validation("Adyen notificationItems are required"))?;
    for wrapper in items {
        let item = wrapper
            .get("NotificationRequestItem")
            .ok_or_else(|| AppError::validation("invalid Adyen notification item"))?;
        verify_adyen_signature(&state, &headers, &body, item)?;
        let event_id = item
            .get("pspReference")
            .and_then(Value::as_str)
            .unwrap_or("");
        let event_type = item
            .get("eventCode")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let account = item
            .get("merchantAccountCode")
            .and_then(Value::as_str)
            .unwrap_or("");
        let merchant_id = merchant_id_for_event(&state, "adyen", account, event_id).await?;
        if record_webhook(&state, "adyen", event_id, event_type, &merchant_id, &body).await? {
            let result =
                process_provider_event(&state, "adyen", event_type, item, &merchant_id).await;
            finish_webhook(
                &state,
                "adyen",
                event_id,
                event_type,
                result.as_ref().err().map(|e| format!("{e:?}")),
            )
            .await?;
            result?;
        }
    }
    Ok(Json(json!({"notificationResponse":"[accepted]"})))
}

fn verify_stripe_signature(headers: &HeaderMap, secret: &str, body: &[u8]) -> Result<(), AppError> {
    let value = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::forbidden("Stripe signature is missing"))?;
    let mut timestamp = None;
    let mut signatures = Vec::new();
    for part in value.split(',') {
        let mut pair = part.splitn(2, '=');
        match (pair.next(), pair.next()) {
            (Some("t"), Some(v)) => timestamp = v.parse::<i64>().ok(),
            (Some("v1"), Some(v)) => signatures.push(v),
            _ => {}
        }
    }
    let timestamp =
        timestamp.ok_or_else(|| AppError::forbidden("Stripe signature timestamp is invalid"))?;
    if (Utc::now().timestamp() - timestamp).abs() > 300 {
        return Err(AppError::forbidden(
            "Stripe webhook timestamp is outside the allowed window",
        ));
    }
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| AppError::internal("invalid Stripe webhook secret"))?;
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(body);
    let expected = mac.finalize().into_bytes();
    if !signatures
        .iter()
        .filter_map(|v| hex_decode(v))
        .any(|v| constant_time_eq(&expected, &v))
    {
        return Err(AppError::forbidden(
            "Stripe webhook signature verification failed",
        ));
    }
    Ok(())
}

fn verify_adyen_signature(
    state: &AppState,
    headers: &HeaderMap,
    body: &[u8],
    item: &Value,
) -> Result<(), AppError> {
    let key = state.settings.adyen_hmac_key.as_deref().ok_or_else(|| {
        AppError::service_unavailable(
            "PAYMENT_PROVIDER_NOT_CONFIGURED",
            "Adyen webhook HMAC is not configured",
        )
    })?;
    let key =
        hex_decode(key).ok_or_else(|| AppError::internal("Adyen HMAC key must be hex encoded"))?;
    if let Some(signature) = headers
        .get("hmacsignature")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| BASE64.decode(v).ok())
    {
        let mut mac = HmacSha256::new_from_slice(&key)
            .map_err(|_| AppError::internal("invalid Adyen HMAC key"))?;
        mac.update(body);
        return mac
            .verify_slice(&signature)
            .map_err(|_| AppError::forbidden("Adyen webhook signature verification failed"));
    }
    let signature = item
        .pointer("/additionalData/hmacSignature")
        .and_then(Value::as_str)
        .and_then(|v| BASE64.decode(v).ok())
        .ok_or_else(|| AppError::forbidden("Adyen HMAC signature is missing"))?;
    let signed = format!(
        "{}:{}:{}:{}:{}:{}:{}:{}",
        text_at(item, "/pspReference"),
        text_at(item, "/originalReference"),
        text_at(item, "/merchantAccountCode"),
        text_at(item, "/merchantReference"),
        item.pointer("/amount/value")
            .and_then(Value::as_i64)
            .unwrap_or(0),
        text_at(item, "/amount/currency"),
        text_at(item, "/eventCode"),
        text_at(item, "/success")
    );
    let mut mac = HmacSha256::new_from_slice(&key)
        .map_err(|_| AppError::internal("invalid Adyen HMAC key"))?;
    mac.update(signed.as_bytes());
    mac.verify_slice(&signature)
        .map_err(|_| AppError::forbidden("Adyen webhook signature verification failed"))
}

async fn merchant_id_for_event(
    state: &AppState,
    provider: &str,
    account: &str,
    provider_object_id: &str,
) -> Result<String, AppError> {
    sqlx::query_scalar("SELECT id FROM payment_merchant_accounts WHERE provider=$1 AND (provider_account_id=$2 OR legal_entity_id=$2) UNION ALL SELECT merchant_account_id FROM payment_provider_operations WHERE provider=$1 AND provider_object_id=$3 LIMIT 1").bind(provider).bind(account).bind(provider_object_id).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to match webhook merchant account")).map(|value|value.unwrap_or_default())
}

async fn record_webhook(
    state: &AppState,
    provider: &str,
    event_id: &str,
    event_type: &str,
    merchant_id: &str,
    body: &[u8],
) -> Result<bool, AppError> {
    if event_id.is_empty() {
        return Err(AppError::validation("provider event id is required"));
    }
    let hash = format!("{:x}", Sha256::digest(body));
    sqlx::query_scalar::<_,bool>("INSERT INTO payment_webhook_receipts (provider,provider_event_id,event_type,merchant_account_id,signature_verified,payload_sha256) VALUES ($1,$2,$3,$4,TRUE,$5) ON CONFLICT (provider,provider_event_id,event_type) DO UPDATE SET attempts=payment_webhook_receipts.attempts+1,status=CASE WHEN payment_webhook_receipts.status='failed' THEN 'received' ELSE payment_webhook_receipts.status END,last_error=CASE WHEN payment_webhook_receipts.status='failed' THEN '' ELSE payment_webhook_receipts.last_error END RETURNING status='received'").bind(provider).bind(event_id).bind(event_type).bind(merchant_id).bind(hash).fetch_one(&state.db).await.map_err(|_|AppError::internal("failed to record payment webhook"))
}

async fn finish_webhook(
    state: &AppState,
    provider: &str,
    event_id: &str,
    event_type: &str,
    error: Option<String>,
) -> Result<(), AppError> {
    let (status, message) = if let Some(v) = error {
        ("failed", v)
    } else {
        ("processed", String::new())
    };
    sqlx::query("UPDATE payment_webhook_receipts SET status=$4,last_error=$5,processed_at=NOW() WHERE provider=$1 AND provider_event_id=$2 AND event_type=$3").bind(provider).bind(event_id).bind(event_type).bind(status).bind(message).execute(&state.db).await.map_err(|_|AppError::internal("failed to update payment webhook health"))?;
    Ok(())
}

async fn process_provider_event(
    state: &AppState,
    provider: &str,
    event_type: &str,
    object: &Value,
    merchant_id: &str,
) -> Result<(), AppError> {
    let object_id = if provider == "stripe" {
        text_at(object, "/id")
    } else {
        text_at(object, "/pspReference")
    };
    let status = if provider == "stripe" {
        text_at(object, "/status")
    } else if text_at(object, "/success") == "true" {
        "succeeded".into()
    } else {
        "failed".into()
    };
    let security = if provider == "stripe" {
        object
            .pointer("/charges/data/0/outcome")
            .cloned()
            .unwrap_or_else(|| json!({}))
    } else {
        json!({"avsResult":object.pointer("/additionalData/avsResult"),"cvcResult":object.pointer("/additionalData/cvcResult")})
    };
    sqlx::query("UPDATE payment_provider_operations SET status=$3,security_json=$4::jsonb,result_json=result_json||$5::jsonb,updated_at=NOW() WHERE provider=$1 AND provider_object_id=$2").bind(provider).bind(&object_id).bind(&status).bind(security.to_string()).bind(json!({"webhookEventType":event_type}).to_string()).execute(&state.db).await.map_err(|_|AppError::internal("failed to update payment operation from webhook"))?;
    if (provider == "stripe" && event_type == "payment_intent.succeeded")
        || (provider == "adyen" && event_type == "AUTHORISATION" && status == "succeeded")
    {
        settle_payment_operation(state, provider, &object_id).await?;
    }
    if provider == "stripe" && event_type.starts_with("payout.") {
        upsert_stripe_settlement(state, object, merchant_id).await?;
    }
    if (provider == "stripe" && event_type.starts_with("charge.dispute."))
        || (provider == "adyen"
            && matches!(
                event_type,
                "NOTIFICATION_OF_CHARGEBACK" | "CHARGEBACK" | "CHARGEBACK_REVERSED"
            ))
    {
        upsert_payment_dispute(state, provider, event_type, object).await?;
    }
    Ok(())
}

async fn upsert_payment_dispute(
    state: &AppState,
    provider: &str,
    event_type: &str,
    object: &Value,
) -> Result<(), AppError> {
    let (dispute_id, payment_reference, amount, currency, reason, raw_status, due_at) =
        if provider == "stripe" {
            (
                text_at(object, "/id"),
                text_at(object, "/payment_intent"),
                object.get("amount").and_then(Value::as_i64).unwrap_or(0),
                text_at(object, "/currency").to_ascii_uppercase(),
                text_at(object, "/reason"),
                text_at(object, "/status"),
                object
                    .pointer("/evidence_details/due_by")
                    .and_then(Value::as_i64)
                    .and_then(|value| chrono::DateTime::<Utc>::from_timestamp(value, 0)),
            )
        } else {
            (
                text_at(object, "/pspReference"),
                text_at(object, "/originalReference"),
                object
                    .pointer("/amount/value")
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
                text_at(object, "/amount/currency").to_ascii_uppercase(),
                text_at(object, "/reason"),
                event_type.to_ascii_lowercase(),
                None,
            )
        };
    if dispute_id.is_empty() || payment_reference.is_empty() {
        return Ok(());
    }
    let payment=sqlx::query_as::<_,(String,String,String,String,String)>("SELECT payment.id,payment.tenant_id,payment.branch_id,payment.sale_id,sale.client_id FROM pos_payments payment JOIN pos_sales sale ON sale.id=payment.sale_id AND sale.tenant_id=payment.tenant_id AND sale.branch_id=payment.branch_id WHERE payment.method_reference=$1 ORDER BY payment.created_at DESC LIMIT 1").bind(&payment_reference).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to match disputed provider payment"))?;
    let Some((payment_id, tenant, branch, sale_id, client_id)) = payment else {
        return Ok(());
    };
    let status = if event_type == "CHARGEBACK_REVERSED"
        || matches!(raw_status.as_str(), "won" | "warning_closed")
    {
        "won"
    } else if matches!(raw_status.as_str(), "lost" | "charge_refunded") {
        "lost"
    } else if matches!(raw_status.as_str(), "under_review" | "warning_under_review") {
        "under_review"
    } else {
        "open"
    };
    let resolved = matches!(status, "won" | "lost" | "closed");
    let currency = if currency.is_empty() {
        "USD"
    } else {
        &currency
    };
    sqlx::query("INSERT INTO payment_disputes (tenant_id,branch_id,sale_id,payment_id,client_id,provider,provider_dispute_id,provider_payment_id,amount_paise,currency,reason,status,evidence_due_at,payload_json,opened_at,resolved_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW(),CASE WHEN $15 THEN NOW() ELSE NULL END,NOW()) ON CONFLICT (tenant_id,provider,provider_dispute_id) DO UPDATE SET status=EXCLUDED.status,amount_paise=EXCLUDED.amount_paise,currency=EXCLUDED.currency,reason=EXCLUDED.reason,evidence_due_at=EXCLUDED.evidence_due_at,payload_json=EXCLUDED.payload_json,resolved_at=CASE WHEN $15 THEN COALESCE(payment_disputes.resolved_at,NOW()) ELSE NULL END,updated_at=NOW()")
        .bind(tenant).bind(branch).bind(sale_id).bind(payment_id).bind(client_id).bind(provider).bind(dispute_id).bind(payment_reference).bind(amount.max(0)).bind(currency).bind(reason).bind(status).bind(due_at).bind(object.to_string()).bind(resolved).execute(&state.db).await.map_err(|_|AppError::internal("failed to save payment dispute"))?;
    Ok(())
}

async fn settle_payment_operation(
    state: &AppState,
    provider: &str,
    object_id: &str,
) -> Result<(), AppError> {
    let operation=sqlx::query_as::<_,(String,String,String,String,i64,String)>("SELECT tenant_id,branch_id,sale_id,id,amount_paise,currency FROM payment_provider_operations WHERE provider=$1 AND provider_object_id=$2 AND operation_type='payment'").bind(provider).bind(object_id).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to match provider payment operation"))?;
    let Some((tenant, branch, sale_id, operation_id, amount, _currency)) = operation else {
        return Ok(());
    };
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start provider payment settlement"))?;
    let sale=sqlx::query_as::<_,(String,i64,i64,String,Option<chrono::DateTime<Utc>>)>("SELECT client_id,total_paise,paid_paise,status,finalized_at FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE").bind(&tenant).bind(&branch).bind(&sale_id).fetch_optional(&mut *tx).await.map_err(|_|AppError::internal("failed to load provider payment invoice"))?.ok_or_else(||AppError::not_found("provider payment invoice was not found"))?;
    let key = format!("{provider}:{object_id}");
    let duplicate:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND idempotency_key=$4)").bind(&tenant).bind(&branch).bind(&sale_id).bind(&key).fetch_one(&mut *tx).await.map_err(|_|AppError::internal("failed to verify provider payment idempotency"))?;
    if duplicate {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish duplicate provider payment"))?;
        return Ok(());
    }
    if sale.4.is_none()
        || matches!(sale.3.as_str(), "draft" | "paid" | "voided" | "cancelled")
        || sale.2.saturating_add(amount) > sale.1
    {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to reject provider payment"))?;
        return Err(AppError::conflict(
            "provider payment does not match a collectable invoice",
        ));
    }
    let payment_id = Uuid::new_v4().to_string();
    let paid = sale.2 + amount;
    let sale_status = if paid >= sale.1 { "paid" } else { "partial" };
    sqlx::query("INSERT INTO pos_payments (id,tenant_id,branch_id,sale_id,method,amount_paise,method_reference,label,notes,idempotency_key,paid_at,created_at) VALUES ($1,$2,$3,$4,'card',$5,$6,$7,$8,$9,NOW(),NOW())").bind(&payment_id).bind(&tenant).bind(&branch).bind(&sale_id).bind(amount).bind(object_id).bind(if provider=="stripe"{"Stripe"}else{"Adyen"}).bind("Verified provider webhook payment").bind(&key).execute(&mut *tx).await.map_err(|_|AppError::internal("failed to record provider POS payment"))?;
    sqlx::query("UPDATE pos_sales SET paid_paise=$4,status=$5,locked_at=CASE WHEN $5='paid' THEN COALESCE(locked_at,NOW()) ELSE locked_at END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(&tenant).bind(&branch).bind(&sale_id).bind(paid).bind(sale_status).execute(&mut *tx).await.map_err(|_|AppError::internal("failed to update provider invoice"))?;
    accounting_service::post_payment(&mut tx, &tenant, &branch, &payment_id, "card", amount)
        .await?;
    if sale_status == "paid" {
        settle_deferred_customer_commerce_benefits(&mut tx, &tenant, &branch, &sale_id).await?;
    }
    sqlx::query(
        "UPDATE payment_provider_operations SET status='succeeded',updated_at=NOW() WHERE id=$1",
    )
    .bind(operation_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to finish payment operation"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit provider payment"))?;
    state.publish_pos_event(
        &tenant,
        &branch,
        "invoice",
        &sale_id,
        "payment.gateway_settled",
    );
    Ok(())
}

async fn upsert_stripe_settlement(
    state: &AppState,
    object: &Value,
    merchant_id: &str,
) -> Result<(), AppError> {
    if merchant_id.is_empty() {
        return Ok(());
    }
    let account = sqlx::query_as::<_, (String, String)>(
        "SELECT tenant_id,branch_id FROM payment_merchant_accounts WHERE id=$1",
    )
    .bind(merchant_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load settlement account"))?;
    let Some((tenant, branch)) = account else {
        return Ok(());
    };
    let id = text_at(object, "/id");
    let amount = object.get("amount").and_then(Value::as_i64).unwrap_or(0);
    let currency = text_at(object, "/currency").to_ascii_uppercase();
    let status = text_at(object, "/status");
    let paid_at = object
        .get("arrival_date")
        .and_then(Value::as_i64)
        .and_then(|v| chrono::DateTime::<Utc>::from_timestamp(v, 0));
    sqlx::query("INSERT INTO payment_provider_settlements (tenant_id,branch_id,merchant_account_id,provider,provider_settlement_id,currency,gross_paise,net_paise,status,paid_at,payload_json,updated_at) VALUES ($1,$2,$3,'stripe',$4,$5,$6,$6,$7,$8,$9::jsonb,NOW()) ON CONFLICT (tenant_id,provider,provider_settlement_id) DO UPDATE SET status=EXCLUDED.status,paid_at=EXCLUDED.paid_at,payload_json=EXCLUDED.payload_json,updated_at=NOW()") .bind(tenant).bind(branch).bind(merchant_id).bind(id).bind(currency).bind(amount).bind(status).bind(paid_at).bind(object.to_string()).execute(&state.db).await.map_err(|_|AppError::internal("failed to save provider settlement"))?;
    Ok(())
}

fn text_at(value: &Value, path: &str) -> String {
    value
        .pointer(path)
        .map(|v| {
            v.as_str()
                .map(ToString::to_string)
                .unwrap_or_else(|| v.to_string().trim_matches('"').to_string())
        })
        .unwrap_or_default()
}
fn hex_decode(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 {
        return None;
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok())
        .collect()
}
fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |diff, (a, b)| diff | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::{constant_time_eq, validate_idempotency};
    #[test]
    fn payment_idempotency_contract_is_strict() {
        assert!(validate_idempotency("payment:123456").is_ok());
        assert!(validate_idempotency("short").is_err());
        assert!(!constant_time_eq(b"abc", b"abd"));
    }
}
