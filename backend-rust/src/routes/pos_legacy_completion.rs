use axum::{
    body::{Body, Bytes},
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue},
    response::Response,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::pos_enterprise_repository::{self, CorporateMember, CorporateStatementRow},
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, invoice_delivery, pos_enterprise_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/pos/corporate-accounts/:id/members",
            get(list_corporate_members).post(add_corporate_member),
        )
        .route(
            "/pos/corporate-accounts/:id/statement",
            get(corporate_statement),
        )
        .route(
            "/pos/corporate-accounts/:id/payments",
            post(record_corporate_payment),
        )
        .route("/pos/corporate-outstanding", get(corporate_outstanding))
        .route(
            "/pos/invoices/:id/corporate-credit",
            post(convert_corporate_credit),
        )
        .route(
            "/invoice-notifications/contact-verifications/request",
            post(request_contact_verification),
        )
        .route(
            "/invoice-notifications/contact-verifications/verify",
            post(confirm_contact_verification),
        )
        .route(
            "/invoice-notifications/profile/media/:kind",
            get(get_notification_media).put(upload_notification_media),
        )
        .route("/invoice-notifications/queue", get(notification_queue))
        .route(
            "/invoice-notifications/queue/:id/retry",
            post(retry_notification_queue_item),
        )
        .route(
            "/invoice-notifications/daily-report/process",
            post(process_daily_report),
        )
        .route("/pos/fraud-summary", get(fraud_summary))
        .route(
            "/pos/day-close/:date/accounting-preview",
            get(accounting_preview),
        )
        .route("/pos/day-close/:date/tax-register", get(tax_register))
}

pub(crate) async fn process_due_daily_reports_worker(state: &AppState) -> Result<u64, AppError> {
    let india_offset = chrono::FixedOffset::east_opt(19_800)
        .ok_or_else(|| AppError::internal("failed to calculate report timezone"))?;
    let india = Utc::now().with_timezone(&india_offset);
    let date = india.date_naive();
    let due: Vec<(String, String, String)> = sqlx::query_as("SELECT tenant_id,branch_id,reporting_email FROM invoice_notification_profiles WHERE daily_report_enabled=TRUE AND reporting_email_verified=TRUE AND reporting_email<>'' AND daily_report_time<=$1 AND last_daily_report_date IS DISTINCT FROM $2")
        .bind(india.time()).bind(date).fetch_all(&state.db).await
        .map_err(|_| AppError::internal("failed to load due daily reports"))?;
    let mut sent = 0_u64;
    for (tenant, branch, recipient) in due {
        let sales: (i64, i64, i64, i64) = sqlx::query_as("SELECT COUNT(*)::BIGINT,COALESCE(SUM(total_paise),0)::BIGINT,COALESCE(SUM(paid_paise),0)::BIGINT,COALESCE(SUM(total_paise-paid_paise),0)::BIGINT FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status NOT IN ('voided','cancelled')")
            .bind(&tenant).bind(&branch).bind(date).fetch_one(&state.db).await
            .map_err(|_| AppError::internal("failed to build scheduled daily report"))?;
        let payments: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('method',p.method,'amountPaise',SUM(p.amount_paise)) FROM pos_payments p JOIN pos_sales s ON s.tenant_id=p.tenant_id AND s.branch_id=p.branch_id AND s.id=p.sale_id WHERE p.tenant_id=$1 AND p.branch_id=$2 AND s.business_date=$3 GROUP BY p.method ORDER BY p.method")
            .bind(&tenant).bind(&branch).bind(date).fetch_all(&state.db).await
            .map_err(|_| AppError::internal("failed to build scheduled payment report"))?;
        let claimed = sqlx::query("UPDATE invoice_notification_profiles SET last_daily_report_date=$3,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND daily_report_enabled=TRUE AND reporting_email_verified=TRUE AND last_daily_report_date IS DISTINCT FROM $3")
            .bind(&tenant).bind(&branch).bind(date).execute(&state.db).await
            .map_err(|_| AppError::internal("failed to claim scheduled daily report"))?.rows_affected();
        if claimed != 1 {
            continue;
        }
        let payload = json!({"channel":"email","recipient":recipient,"purpose":"pos_daily_report","businessDate":date,"summary":{"invoiceCount":sales.0,"salesPaise":sales.1,"paidPaise":sales.2,"duePaise":sales.3,"payments":payments}});
        if invoice_delivery::deliver(&state.settings, &payload)
            .await
            .is_err()
        {
            sqlx::query("UPDATE invoice_notification_profiles SET last_daily_report_date=NULL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND last_daily_report_date=$3")
                .bind(&tenant).bind(&branch).bind(date).execute(&state.db).await.ok();
            continue;
        }
        sent += 1;
    }
    Ok(sent)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorporateMemberRequest {
    client_id: String,
    employee_code: Option<String>,
    department: Option<String>,
    spending_limit_paise: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorporateSaleRequest {
    account_id: String,
    reference: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorporatePaymentRequest {
    amount_paise: i64,
    payment_method: String,
    payment_reference: String,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContactVerificationRequest {
    contact_kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmVerificationRequest {
    verification_id: String,
    otp: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaUploadQuery {
    file_name: String,
}

#[derive(Deserialize)]
struct StatusQuery {
    status: Option<String>,
}

#[derive(Deserialize)]
struct FraudSummaryQuery {
    from: String,
    to: String,
}

async fn list_corporate_members(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<CorporateMember>> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let rows = sqlx::query_as("SELECT m.id,m.corporate_account_id,m.client_id,TRIM(CONCAT_WS(' ',c.first_name,c.last_name)) client_name,c.phone client_phone,m.employee_code,m.department,m.spending_limit_paise,m.status,m.created_at FROM corporate_account_members m JOIN clients c ON c.tenant_id=m.tenant_id AND c.branch_id=m.branch_id AND c.id=m.client_id WHERE m.tenant_id=$1 AND m.branch_id=$2 AND m.corporate_account_id=$3 ORDER BY client_name")
        .bind(&tenant).bind(&branch).bind(&id).fetch_all(&state.db).await
        .map_err(|_| AppError::internal("failed to load corporate members"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn add_corporate_member(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<CorporateMemberRequest>,
) -> ApiResult<CorporateMember> {
    require_manager(&claims)?;
    if payload.client_id.trim().is_empty() {
        return Err(AppError::validation("clientId is required"));
    }
    let (tenant, branch) = tenant_branch(&headers)?;
    let row = pos_enterprise_service::add_corporate_member(
        &state.db,
        &tenant,
        &branch,
        &claims.sub,
        &id,
        payload.client_id.trim(),
        payload.employee_code.as_deref().unwrap_or_default().trim(),
        payload.department.as_deref().unwrap_or_default().trim(),
        payload.spending_limit_paise,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn convert_corporate_credit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<CorporateSaleRequest>,
) -> ApiResult<Value> {
    require_manager(&claims)?;
    if payload.account_id.trim().is_empty() || payload.reference.trim().is_empty() {
        return Err(AppError::validation("accountId and reference are required"));
    }
    let (tenant, branch) = tenant_branch(&headers)?;
    let row = pos_enterprise_service::convert_invoice_to_corporate_credit(
        &state.db,
        &tenant,
        &branch,
        &claims.sub,
        &id,
        payload.account_id.trim(),
        payload.reference.trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn record_corporate_payment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<CorporatePaymentRequest>,
) -> ApiResult<Value> {
    require_manager(&claims)?;
    let method = allowed_value(
        &payload.payment_method,
        &["bank_transfer", "upi", "card", "cheque"],
    )?;
    let (tenant, branch) = tenant_branch(&headers)?;
    let row = pos_enterprise_service::record_corporate_payment(
        &state.db,
        &tenant,
        &branch,
        &claims.sub,
        &id,
        payload.amount_paise,
        method,
        payload.payment_reference.trim(),
        payload.idempotency_key.trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn corporate_statement(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let rows: Vec<CorporateStatementRow> = sqlx::query_as("SELECT ci.id,ci.sale_id,s.invoice_number,ci.due_date,ci.original_amount_paise,ci.paid_paise,ci.outstanding_paise,ci.status,ci.created_at FROM corporate_credit_invoices ci JOIN pos_sales s ON s.tenant_id=ci.tenant_id AND s.branch_id=ci.branch_id AND s.id=ci.sale_id WHERE ci.tenant_id=$1 AND ci.branch_id=$2 AND ci.corporate_account_id=$3 ORDER BY ci.due_date,ci.created_at")
        .bind(&tenant).bind(&branch).bind(&id).fetch_all(&state.db).await
        .map_err(|_| AppError::internal("failed to load corporate statement"))?;
    let payments: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('paymentId',p.id,'receivedAt',p.received_at,'amountPaise',p.amount_paise,'paymentMethod',p.payment_method,'paymentReference',p.payment_reference,'allocations',COALESCE((SELECT jsonb_agg(jsonb_build_object('saleId',a.sale_id,'amountPaise',a.amount_paise)) FROM corporate_credit_payment_allocations a WHERE a.tenant_id=p.tenant_id AND a.branch_id=p.branch_id AND a.payment_id=p.id),'[]'::jsonb)) FROM corporate_credit_payments p WHERE p.tenant_id=$1 AND p.branch_id=$2 AND p.corporate_account_id=$3 ORDER BY p.received_at DESC")
        .bind(&tenant).bind(&branch).bind(&id).fetch_all(&state.db).await
        .map_err(|_| AppError::internal("failed to load corporate payments"))?;
    let aging: (i64, i64, i64, i64, i64) = sqlx::query_as("SELECT COALESCE(SUM(outstanding_paise) FILTER (WHERE due_date>=CURRENT_DATE),0)::BIGINT,COALESCE(SUM(outstanding_paise) FILTER (WHERE due_date<CURRENT_DATE AND due_date>=CURRENT_DATE-30),0)::BIGINT,COALESCE(SUM(outstanding_paise) FILTER (WHERE due_date<CURRENT_DATE-30 AND due_date>=CURRENT_DATE-60),0)::BIGINT,COALESCE(SUM(outstanding_paise) FILTER (WHERE due_date<CURRENT_DATE-60 AND due_date>=CURRENT_DATE-90),0)::BIGINT,COALESCE(SUM(outstanding_paise) FILTER (WHERE due_date<CURRENT_DATE-90),0)::BIGINT FROM corporate_credit_invoices WHERE tenant_id=$1 AND branch_id=$2 AND corporate_account_id=$3 AND status IN ('open','partially_paid')")
        .bind(&tenant).bind(&branch).bind(&id).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to build corporate aging"))?;
    Ok(Json(ApiResponse::ok(
        json!({"invoices":rows,"payments":payments,"aging":{"currentPaise":aging.0,"days1To30Paise":aging.1,"days31To60Paise":aging.2,"days61To90Paise":aging.3,"days90PlusPaise":aging.4}}),
    )))
}

async fn corporate_outstanding(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('accountId',a.id,'accountCode',a.account_code,'accountName',a.account_name,'billingEmail',a.billing_email,'phone',a.phone,'gstin',a.gstin,'outstandingPaise',COALESCE(SUM(ci.outstanding_paise) FILTER (WHERE ci.status IN ('open','partially_paid')),0),'overduePaise',COALESCE(SUM(ci.outstanding_paise) FILTER (WHERE ci.status IN ('open','partially_paid') AND ci.due_date<CURRENT_DATE),0),'currentPaise',COALESCE(SUM(ci.outstanding_paise) FILTER (WHERE ci.status IN ('open','partially_paid') AND ci.due_date>=CURRENT_DATE),0),'days1To30Paise',COALESCE(SUM(ci.outstanding_paise) FILTER (WHERE ci.status IN ('open','partially_paid') AND ci.due_date<CURRENT_DATE AND ci.due_date>=CURRENT_DATE-30),0),'days31To60Paise',COALESCE(SUM(ci.outstanding_paise) FILTER (WHERE ci.status IN ('open','partially_paid') AND ci.due_date<CURRENT_DATE-30 AND ci.due_date>=CURRENT_DATE-60),0),'days61To90Paise',COALESCE(SUM(ci.outstanding_paise) FILTER (WHERE ci.status IN ('open','partially_paid') AND ci.due_date<CURRENT_DATE-60 AND ci.due_date>=CURRENT_DATE-90),0),'days90PlusPaise',COALESCE(SUM(ci.outstanding_paise) FILTER (WHERE ci.status IN ('open','partially_paid') AND ci.due_date<CURRENT_DATE-90),0)) FROM corporate_billing_accounts a LEFT JOIN corporate_credit_invoices ci ON ci.tenant_id=a.tenant_id AND ci.branch_id=a.branch_id AND ci.corporate_account_id=a.id WHERE a.tenant_id=$1 AND a.branch_id=$2 GROUP BY a.id ORDER BY a.account_name")
        .bind(&tenant).bind(&branch).fetch_all(&state.db).await
        .map_err(|_| AppError::internal("failed to load corporate outstanding"))?;
    let total = rows
        .iter()
        .filter_map(|row| row.get("outstandingPaise").and_then(Value::as_i64))
        .sum::<i64>();
    let overdue = rows
        .iter()
        .filter_map(|row| row.get("overduePaise").and_then(Value::as_i64))
        .sum::<i64>();
    Ok(Json(ApiResponse::ok(
        json!({"accounts":rows,"totalOutstandingPaise":total,"overduePaise":overdue}),
    )))
}

async fn request_contact_verification(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ContactVerificationRequest>,
) -> ApiResult<Value> {
    require_manager(&claims)?;
    let kind = allowed_value(
        &payload.contact_kind,
        &[
            "sender_email",
            "sender_phone",
            "owner_email",
            "owner_phone",
            "reporting_email",
        ],
    )?;
    let (tenant, branch) = tenant_branch(&headers)?;
    let profile = pos_enterprise_repository::get_notification_profile(&state.db, &tenant, &branch)
        .await
        .map_err(|_| AppError::internal("failed to load notification profile"))?
        .ok_or_else(|| AppError::not_found("notification profile was not found"))?;
    let contact = notification_contact(&profile, kind).trim().to_string();
    if contact.is_empty() {
        return Err(AppError::validation("selected contact is empty"));
    }
    let recently_sent: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM invoice_notification_contact_verifications WHERE tenant_id=$1 AND branch_id=$2 AND contact_kind=$3 AND created_at>NOW()-INTERVAL '60 seconds')")
        .bind(&tenant).bind(&branch).bind(kind).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to check verification throttle"))?;
    if recently_sent {
        return Err(AppError::conflict(
            "wait 60 seconds before requesting another code",
        ));
    }
    let verification_id = Uuid::new_v4().to_string();
    let otp = format!("{:06}", Uuid::new_v4().as_u128() % 1_000_000);
    let otp_hash = hash_verification(&state.settings.jwt_access_secret, &verification_id, &otp);
    let channel = if kind.ends_with("email") {
        "email"
    } else {
        "phone"
    };
    invoice_delivery::deliver(
        &state.settings,
        &json!({"channel":channel,"recipient":contact,"purpose":"invoice_notification_contact_verification","verificationCode":otp,"expiresInMinutes":10}),
    )
    .await?;
    sqlx::query("INSERT INTO invoice_notification_contact_verifications (id,tenant_id,branch_id,contact_kind,contact_value,otp_hash,expires_at,requested_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '10 minutes',$7)")
        .bind(&verification_id).bind(&tenant).bind(&branch).bind(kind).bind(&contact).bind(otp_hash).bind(&claims.sub)
        .execute(&state.db).await.map_err(|_| AppError::internal("failed to store verification request"))?;
    Ok(Json(ApiResponse::ok(
        json!({"verificationId":verification_id,"contactKind":kind,"expiresInSeconds":600}),
    )))
}

async fn confirm_contact_verification(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ConfirmVerificationRequest>,
) -> ApiResult<pos_enterprise_repository::NotificationProfile> {
    require_manager(&claims)?;
    if payload.otp.len() != 6 || !payload.otp.chars().all(|value| value.is_ascii_digit()) {
        return Err(AppError::validation("otp must contain 6 digits"));
    }
    let (tenant, branch) = tenant_branch(&headers)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start contact verification"))?;
    let row: Option<(String, String, String, i32, chrono::DateTime<Utc>)> = sqlx::query_as("SELECT contact_kind,contact_value,otp_hash,attempts,expires_at FROM invoice_notification_contact_verifications WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending' FOR UPDATE")
        .bind(&tenant).bind(&branch).bind(payload.verification_id.trim()).fetch_optional(&mut *tx).await
        .map_err(|_| AppError::internal("failed to load verification request"))?;
    let (kind, contact, expected_hash, attempts, expires_at) =
        row.ok_or_else(|| AppError::conflict("verification request is unavailable"))?;
    if expires_at <= Utc::now() {
        sqlx::query(
            "UPDATE invoice_notification_contact_verifications SET status='expired' WHERE id=$1",
        )
        .bind(payload.verification_id.trim())
        .execute(&mut *tx)
        .await
        .ok();
        tx.commit().await.ok();
        return Err(AppError::conflict("verification code has expired"));
    }
    let profile = pos_enterprise_repository::get_notification_profile(&state.db, &tenant, &branch)
        .await
        .map_err(|_| AppError::internal("failed to load notification profile"))?
        .ok_or_else(|| AppError::not_found("notification profile was not found"))?;
    if notification_contact(&profile, &kind) != contact {
        return Err(AppError::conflict(
            "contact changed after this code was requested",
        ));
    }
    let actual_hash = hash_verification(
        &state.settings.jwt_access_secret,
        payload.verification_id.trim(),
        payload.otp.trim(),
    );
    if actual_hash != expected_hash {
        let locked = attempts + 1 >= 5;
        sqlx::query("UPDATE invoice_notification_contact_verifications SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'locked' ELSE status END WHERE id=$1")
            .bind(payload.verification_id.trim()).execute(&mut *tx).await
            .map_err(|_| AppError::internal("failed to record verification attempt"))?;
        tx.commit().await.ok();
        return Err(AppError::validation(if locked {
            "verification request is locked"
        } else {
            "verification code is invalid"
        }));
    }
    sqlx::query("UPDATE invoice_notification_contact_verifications SET status='verified',verified_at=NOW() WHERE id=$1")
        .bind(payload.verification_id.trim()).execute(&mut *tx).await
        .map_err(|_| AppError::internal("failed to confirm verification"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit verification"))?;
    let profile =
        pos_enterprise_repository::verify_notification_contact(&state.db, &tenant, &branch, &kind)
            .await
            .map_err(|_| AppError::internal("failed to update verified contact"))?
            .ok_or_else(|| AppError::not_found("notification profile was not found"))?;
    Ok(Json(ApiResponse::ok(profile)))
}

async fn upload_notification_media(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(kind): Path<String>,
    Query(query): Query<MediaUploadQuery>,
    bytes: Bytes,
) -> ApiResult<Value> {
    require_manager(&claims)?;
    let kind = allowed_value(&kind, &["logo", "signature"])?;
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if query.file_name.trim().is_empty()
        || bytes.is_empty()
        || bytes.len() > 2 * 1024 * 1024
        || !media_content_matches_type(&bytes, &content_type)
    {
        return Err(AppError::validation(
            "logo/signature must be a PNG, JPEG or WebP file up to 2 MB",
        ));
    }
    let (tenant, branch) = tenant_branch(&headers)?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let id: String = sqlx::query_scalar("INSERT INTO invoice_notification_profile_media (tenant_id,branch_id,media_kind,file_name,content_type,content_sha256,content_bytes,uploaded_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id,branch_id,media_kind) DO UPDATE SET file_name=EXCLUDED.file_name,content_type=EXCLUDED.content_type,content_sha256=EXCLUDED.content_sha256,content_bytes=EXCLUDED.content_bytes,uploaded_by_user_id=EXCLUDED.uploaded_by_user_id,updated_at=NOW() RETURNING id")
        .bind(&tenant).bind(&branch).bind(kind).bind(query.file_name.trim()).bind(&content_type).bind(&digest).bind(bytes.to_vec()).bind(&claims.sub).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to store notification media"))?;
    Ok(Json(ApiResponse::ok(
        json!({"id":id,"kind":kind,"fileName":query.file_name,"contentType":content_type,"sha256":digest,"contentPath":format!("/api/v1/invoice-notifications/profile/media/{kind}")}),
    )))
}

async fn get_notification_media(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(kind): Path<String>,
) -> Result<Response<Body>, AppError> {
    let kind = allowed_value(&kind, &["logo", "signature"])?;
    let (tenant, branch) = tenant_branch(&headers)?;
    let row: Option<(String, String, Vec<u8>)> = sqlx::query_as("SELECT file_name,content_type,content_bytes FROM invoice_notification_profile_media WHERE tenant_id=$1 AND branch_id=$2 AND media_kind=$3")
        .bind(&tenant).bind(&branch).bind(kind).fetch_optional(&state.db).await
        .map_err(|_| AppError::internal("failed to load notification media"))?;
    let (name, content_type, content) =
        row.ok_or_else(|| AppError::not_found("notification media was not found"))?;
    let safe_name = name
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-') {
                value
            } else {
                '_'
            }
        })
        .collect::<String>();
    Response::builder()
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&content_type)
                .map_err(|_| AppError::internal("invalid stored media type"))?,
        )
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(
            header::CONTENT_DISPOSITION,
            format!("inline; filename=\"{safe_name}\""),
        )
        .body(Body::from(content))
        .map_err(|_| AppError::internal("failed to stream notification media"))
}

async fn notification_queue(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<StatusQuery>,
) -> ApiResult<Vec<Value>> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let status = query.status.unwrap_or_default();
    let rows = sqlx::query_scalar("SELECT jsonb_build_object('id',o.id,'saleId',o.sale_id,'invoiceNumber',s.invoice_number,'channel',o.channel,'recipient',o.recipient,'status',o.status,'attempts',o.attempts,'lastError',o.last_error,'scheduledFor',o.scheduled_for,'createdAt',o.created_at) FROM pos_invoice_outbox o JOIN pos_sales s ON s.tenant_id=o.tenant_id AND s.branch_id=o.branch_id AND s.id=o.sale_id WHERE o.tenant_id=$1 AND o.branch_id=$2 AND ($3='' OR o.status=$3) ORDER BY o.created_at DESC LIMIT 200")
        .bind(&tenant).bind(&branch).bind(status.trim()).fetch_all(&state.db).await
        .map_err(|_| AppError::internal("failed to load notification queue"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn retry_notification_queue_item(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_manager(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    let changed = sqlx::query("UPDATE pos_invoice_outbox SET status='queued',attempts=0,last_error='',next_attempt_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('failed','blocked')")
        .bind(&tenant).bind(&branch).bind(&id).execute(&state.db).await
        .map_err(|_| AppError::internal("failed to retry notification"))?.rows_affected();
    if changed != 1 {
        return Err(AppError::conflict(
            "only failed or blocked notifications can be retried",
        ));
    }
    Ok(Json(ApiResponse::ok(json!({"id":id,"status":"queued"}))))
}

async fn process_daily_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    require_manager(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    let profile = pos_enterprise_repository::get_notification_profile(&state.db, &tenant, &branch)
        .await
        .map_err(|_| AppError::internal("failed to load notification profile"))?
        .ok_or_else(|| AppError::not_found("notification profile was not found"))?;
    if !profile.daily_report_enabled
        || !profile.reporting_email_verified
        || profile.reporting_email.trim().is_empty()
    {
        return Err(AppError::conflict(
            "daily report and a verified reporting email are required",
        ));
    }
    let india_offset = chrono::FixedOffset::east_opt(19_800)
        .ok_or_else(|| AppError::internal("failed to calculate report timezone"))?;
    let india = Utc::now().with_timezone(&india_offset);
    let date = india.date_naive();
    if india.time() < profile.daily_report_time {
        return Err(AppError::conflict("daily report time has not been reached"));
    }
    if profile.last_daily_report_date == Some(date) {
        return Ok(Json(ApiResponse::ok(
            json!({"businessDate":date,"status":"already_sent"}),
        )));
    }
    let sales: (i64, i64, i64, i64) = sqlx::query_as("SELECT COUNT(*)::BIGINT,COALESCE(SUM(total_paise),0)::BIGINT,COALESCE(SUM(paid_paise),0)::BIGINT,COALESCE(SUM(total_paise-paid_paise),0)::BIGINT FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status NOT IN ('voided','cancelled')")
        .bind(&tenant).bind(&branch).bind(date).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to build daily report"))?;
    let payments: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('method',p.method,'amountPaise',SUM(p.amount_paise)) FROM pos_payments p JOIN pos_sales s ON s.tenant_id=p.tenant_id AND s.branch_id=p.branch_id AND s.id=p.sale_id WHERE p.tenant_id=$1 AND p.branch_id=$2 AND s.business_date=$3 GROUP BY p.method ORDER BY p.method")
        .bind(&tenant).bind(&branch).bind(date).fetch_all(&state.db).await
        .map_err(|_| AppError::internal("failed to build payment report"))?;
    let claimed = sqlx::query("UPDATE invoice_notification_profiles SET last_daily_report_date=$3,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND last_daily_report_date IS DISTINCT FROM $3")
        .bind(&tenant).bind(&branch).bind(date).execute(&state.db).await
        .map_err(|_| AppError::internal("failed to claim daily report"))?.rows_affected();
    if claimed != 1 {
        return Ok(Json(ApiResponse::ok(
            json!({"businessDate":date,"status":"already_sent"}),
        )));
    }
    if let Err(error) = invoice_delivery::deliver(&state.settings,&json!({"channel":"email","recipient":profile.reporting_email,"purpose":"pos_daily_report","businessDate":date,"summary":{"invoiceCount":sales.0,"salesPaise":sales.1,"paidPaise":sales.2,"duePaise":sales.3,"payments":payments}})).await {
        sqlx::query("UPDATE invoice_notification_profiles SET last_daily_report_date=NULL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND last_daily_report_date=$3").bind(&tenant).bind(&branch).bind(date).execute(&state.db).await.ok();
        return Err(error);
    }
    Ok(Json(ApiResponse::ok(
        json!({"businessDate":date,"status":"sent","recipient":profile.reporting_email}),
    )))
}

async fn fraud_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<FraudSummaryQuery>,
) -> ApiResult<Value> {
    let from = parse_date(&query.from)?;
    let to = parse_date(&query.to)?;
    if from > to || to.signed_duration_since(from).num_days() > 366 {
        return Err(AppError::validation("date range must be at most 366 days"));
    }
    let (tenant, branch) = tenant_branch(&headers)?;
    let totals: (i64, i64, i64, i64) = sqlx::query_as("SELECT COUNT(*)::BIGINT,COUNT(*) FILTER (WHERE severity IN ('high','critical'))::BIGINT,COALESCE(SUM(amount_at_risk_paise),0)::BIGINT,COUNT(*) FILTER (WHERE status='open')::BIGINT FROM pos_financial_risk_cases WHERE tenant_id=$1 AND branch_id=$2 AND business_date BETWEEN $3 AND $4")
        .bind(&tenant).bind(&branch).bind(from).bind(to).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to load fraud summary"))?;
    let by_code: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('riskCode',risk_code,'caseCount',COUNT(*),'amountAtRiskPaise',SUM(amount_at_risk_paise)) FROM pos_financial_risk_cases WHERE tenant_id=$1 AND branch_id=$2 AND business_date BETWEEN $3 AND $4 GROUP BY risk_code ORDER BY SUM(amount_at_risk_paise) DESC,COUNT(*) DESC")
        .bind(&tenant).bind(&branch).bind(from).bind(to).fetch_all(&state.db).await
        .map_err(|_| AppError::internal("failed to aggregate fraud cases"))?;
    Ok(Json(ApiResponse::ok(
        json!({"from":from,"to":to,"caseCount":totals.0,"highRiskCount":totals.1,"amountAtRiskPaise":totals.2,"openCount":totals.3,"byCode":by_code}),
    )))
}

async fn accounting_preview(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(date): Path<String>,
) -> ApiResult<Value> {
    let date = parse_date(&date)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    let sales: (i64, i64, i64, i64, i64) = sqlx::query_as("SELECT COUNT(*)::BIGINT,COALESCE(SUM(subtotal_paise-discount_paise),0)::BIGINT,COALESCE(SUM(tax_paise),0)::BIGINT,COALESCE(SUM(total_paise),0)::BIGINT,COALESCE(SUM(total_paise-paid_paise),0)::BIGINT FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status NOT IN ('voided','cancelled')")
        .bind(&tenant).bind(&branch).bind(date).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to build accounting preview"))?;
    let postings: (i64, i64) = sqlx::query_as("SELECT COUNT(*)::BIGINT,COALESCE(SUM(CASE WHEN status='posted' THEN 1 ELSE 0 END),0)::BIGINT FROM pos_eod_accounting_batches WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3")
        .bind(&tenant).bind(&branch).bind(date).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to load accounting batches"))?;
    Ok(Json(ApiResponse::ok(
        json!({"businessDate":date,"invoiceCount":sales.0,"netSalesPaise":sales.1,"outputTaxPaise":sales.2,"grossSalesPaise":sales.3,"receivablePaise":sales.4,"accountingBatchCount":postings.0,"postedBatchCount":postings.1}),
    )))
}

async fn tax_register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(date): Path<String>,
) -> ApiResult<Value> {
    let date = parse_date(&date)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('hsnSacCode',COALESCE(NULLIF(l.hsn_sac_code,''),'UNCLASSIFIED'),'taxPercent',l.tax_percent,'taxablePaise',SUM(l.line_total_paise-l.cgst_paise-l.sgst_paise-l.igst_paise),'cgstPaise',SUM(l.cgst_paise),'sgstPaise',SUM(l.sgst_paise),'igstPaise',SUM(l.igst_paise)) FROM pos_sale_lines l JOIN pos_sales s ON s.tenant_id=l.tenant_id AND s.branch_id=l.branch_id AND s.id=l.sale_id WHERE l.tenant_id=$1 AND l.branch_id=$2 AND s.business_date=$3 AND s.status NOT IN ('voided','cancelled') GROUP BY COALESCE(NULLIF(l.hsn_sac_code,''),'UNCLASSIFIED'),l.tax_percent ORDER BY 1")
        .bind(&tenant).bind(&branch).bind(date).fetch_all(&state.db).await
        .map_err(|_| AppError::internal("failed to build tax register"))?;
    let total_tax = rows
        .iter()
        .map(|row| {
            ["cgstPaise", "sgstPaise", "igstPaise"]
                .iter()
                .filter_map(|key| row.get(*key).and_then(Value::as_i64))
                .sum::<i64>()
        })
        .sum::<i64>();
    Ok(Json(ApiResponse::ok(
        json!({"businessDate":date,"rows":rows,"totalTaxPaise":total_tax}),
    )))
}

fn require_manager(claims: &AuthClaims) -> Result<(), AppError> {
    if ["owner", "admin", "manager"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(claims.role.trim()))
    {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "owner, admin, or manager access is required",
        ))
    }
}

fn allowed_value<'a>(value: &'a str, allowed: &[&'a str]) -> Result<&'a str, AppError> {
    let value = value.trim();
    allowed
        .iter()
        .copied()
        .find(|item| item.eq_ignore_ascii_case(value))
        .ok_or_else(|| {
            AppError::validation(format!("value must be one of: {}", allowed.join(", ")))
        })
}

fn parse_date(value: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::validation("date must use YYYY-MM-DD"))
}

fn hash_verification(secret: &str, id: &str, otp: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{secret}:{id}:{otp}").as_bytes())
    )
}

fn notification_contact<'a>(
    profile: &'a pos_enterprise_repository::NotificationProfile,
    kind: &str,
) -> &'a str {
    match kind {
        "sender_email" => &profile.sender_email,
        "sender_phone" => &profile.sender_phone,
        "owner_email" => &profile.owner_email,
        "owner_phone" => &profile.owner_phone,
        _ => &profile.reporting_email,
    }
}

fn media_content_matches_type(bytes: &[u8], content_type: &str) -> bool {
    match content_type {
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    }
}
