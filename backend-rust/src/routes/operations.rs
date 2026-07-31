use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, patch, post},
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::operations_repository,
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, operations_service, staff_enterprise_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/operations/outcall", get(outcall_summary))
        .route("/operations/outcall/zones", post(save_zone))
        .route("/operations/outcall/addresses", post(save_address))
        .route("/operations/outcall/jobs", post(create_job))
        .route("/operations/outcall/jobs/:id/assignment", patch(assign_job))
        .route("/operations/outcall/jobs/:id/status", patch(set_job_status))
        .route(
            "/operations/outcall/jobs/:id/tracking-link",
            post(create_tracking_link),
        )
        .route("/operations/outcall/jobs/:id/notify", post(notify_client))
        .route("/staff/self/field-jobs", get(self_field_jobs))
        .route(
            "/staff/self/field-jobs/:id/status",
            patch(self_set_job_status),
        )
        .route(
            "/staff/self/field-jobs/:id/location",
            post(self_job_location),
        )
        .route("/staff/self/field-jobs/:id/proof", post(self_job_proof))
        .route("/operations/marketplace", get(marketplace_summary))
        .route(
            "/operations/marketplace/connections",
            post(create_marketplace_connection),
        )
        .route(
            "/operations/marketplace/events/:id/retry",
            post(retry_marketplace_event),
        )
        .route("/operations/marketplace/listing", post(save_listing))
        .route(
            "/operations/marketplace/listing/:id/approval",
            patch(decide_listing),
        )
        .route(
            "/operations/marketplace/reviews/:id/moderation",
            patch(moderate_review),
        )
}

pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/operations/tracking/:token", get(public_tracking))
        .route(
            "/operations/marketplace/webhooks/:id",
            post(marketplace_webhook),
        )
        .route(
            "/operations/marketplace/connections/:id/availability",
            get(marketplace_availability),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JobStatusRequest {
    status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssignmentRequest {
    staff_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NotifyRequest {
    channel: String,
    tracking_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AvailabilityQuery {
    from: DateTime<Utc>,
    to: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListingRequest {
    listing_name: String,
    commission_bps: i32,
    ranking_score: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DecisionRequest {
    decision: String,
    note: Option<String>,
}

async fn outcall_summary(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        operations_service::summary(&state, &tenant_id, &branch_id).await?,
    )))
}

async fn save_zone(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(body): Json<operations_service::ZoneInput>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let id = operations_service::save_zone(&state.db, &tenant_id, &branch_id, &body).await?;
    operations_service::audit(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "operations.zone.saved",
        json!({"zoneId":id}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(json!({"id":id}))))
}

async fn save_address(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(body): Json<operations_service::AddressInput>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let id = operations_service::save_address(&state, &tenant, &branch, &claims.sub, &body).await?;
    operations_service::audit(
        &state,
        &tenant,
        &branch,
        &claims.sub,
        "operations.address.saved",
        json!({"addressId":id,"clientId":body.client_id}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(json!({"id":id}))))
}

async fn create_job(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(body): Json<operations_service::JobInput>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let id = operations_service::create_job(&state, &tenant_id, &branch_id, &body).await?;
    operations_service::audit(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "operations.field_job.created",
        json!({"fieldJobId":id,"appointmentId":body.appointment_id}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(json!({"id":id}))))
}

async fn set_job_status(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<JobStatusRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    operations_service::set_status(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        None,
        &body.status,
        &claims.sub,
    )
    .await?;
    operations_service::audit(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "operations.field_job.status_changed",
        json!({"fieldJobId":id,"status":body.status}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(json!({"id":id,"status":body.status}))))
}

async fn assign_job(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<AssignmentRequest>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    operations_service::assign_job(
        &state.db,
        &tenant,
        &branch,
        &id,
        &body.staff_id,
        &claims.sub,
    )
    .await?;
    operations_service::audit(
        &state,
        &tenant,
        &branch,
        &claims.sub,
        "operations.field_job.assigned",
        json!({"fieldJobId":id,"staffId":body.staff_id}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        json!({"id":id,"staffId":body.staff_id,"status":"assigned"}),
    )))
}

async fn create_tracking_link(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let url =
        operations_service::create_tracking(&state, &tenant, &branch, &id, &claims.sub).await?;
    operations_service::audit(
        &state,
        &tenant,
        &branch,
        &claims.sub,
        "operations.tracking_link.created",
        json!({"fieldJobId":id}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(json!({"trackingUrl":url}))))
}

async fn notify_client(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<NotifyRequest>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let url = match body.tracking_url.filter(|value| !value.trim().is_empty()) {
        Some(value) => value,
        None => {
            operations_service::create_tracking(&state, &tenant, &branch, &id, &claims.sub).await?
        }
    };
    let queued =
        operations_service::queue_eta(&state, &tenant, &branch, &id, body.channel.trim(), &url)
            .await?;
    operations_service::audit(
        &state,
        &tenant,
        &branch,
        &claims.sub,
        "operations.eta_notification.queued",
        json!({"fieldJobId":id,"channel":body.channel,"queued":queued}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        json!({"queued":queued,"trackingUrl":url}),
    )))
}

async fn self_field_jobs(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let staff =
        staff_enterprise_service::self_staff_id(&state.db, &tenant, &branch, &claims.sub).await?;
    let jobs = operations_repository::self_jobs(&state.db, &tenant, &branch, &staff)
        .await
        .map_err(|_| AppError::internal("failed to load staff field jobs"))?;
    Ok(Json(ApiResponse::ok(json!({"jobs":jobs}))))
}

async fn self_set_job_status(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<JobStatusRequest>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let staff =
        staff_enterprise_service::self_staff_id(&state.db, &tenant, &branch, &claims.sub).await?;
    operations_service::set_status(
        &state.db,
        &tenant,
        &branch,
        &id,
        Some(&staff),
        &body.status,
        &claims.sub,
    )
    .await?;
    operations_service::audit(
        &state,
        &tenant,
        &branch,
        &claims.sub,
        "operations.staff_field_job.status_changed",
        json!({"fieldJobId":id,"status":body.status}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(json!({"id":id,"status":body.status}))))
}

async fn self_job_location(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<operations_service::LocationInput>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let staff =
        staff_enterprise_service::self_staff_id(&state.db, &tenant, &branch, &claims.sub).await?;
    operations_service::record_location(&state.db, &tenant, &branch, &id, &staff, &body).await?;
    Ok(Json(ApiResponse::ok(json!({"saved":true}))))
}

async fn self_job_proof(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<operations_service::ProofInput>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let staff =
        staff_enterprise_service::self_staff_id(&state.db, &tenant, &branch, &claims.sub).await?;
    operations_service::save_proof(&state.db, &tenant, &branch, &id, &staff, &body).await?;
    operations_service::audit(
        &state,
        &tenant,
        &branch,
        &claims.sub,
        "operations.service_proof.saved",
        json!({"fieldJobId":id}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(json!({"saved":true}))))
}

async fn public_tracking(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        operations_service::public_tracking(&state.db, &token).await?,
    )))
}

async fn create_marketplace_connection(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(body): Json<operations_service::ConnectionInput>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let result =
        operations_service::create_connection(&state, &tenant, &branch, &claims.sub, &body).await?;
    operations_service::audit(
        &state,
        &tenant,
        &branch,
        &claims.sub,
        "operations.marketplace_connection.created",
        json!({"connectionId":result["id"],"provider":body.provider}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn retry_marketplace_event(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let result = operations_service::retry_marketplace_event(&state, &tenant, &branch, &id).await?;
    operations_service::audit(
        &state,
        &tenant,
        &branch,
        &claims.sub,
        "operations.marketplace_event.retried",
        json!({"eventId":id}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn marketplace_webhook(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Value> {
    let timestamp = headers
        .get("x-aurashine-timestamp")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let signature = headers
        .get("x-aurashine-signature")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let (tenant, branch) =
        operations_service::verify_connection(&state, &id, timestamp, signature, &body).await?;
    Ok(Json(ApiResponse::ok(
        operations_service::accept_marketplace_booking(&state, &id, &tenant, &branch, &body)
            .await?,
    )))
}

async fn marketplace_availability(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<AvailabilityQuery>,
) -> ApiResult<Value> {
    let timestamp = headers
        .get("x-aurashine-timestamp")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let signature = headers
        .get("x-aurashine-signature")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    Ok(Json(ApiResponse::ok(
        operations_service::availability(&state, &id, timestamp, signature, query.from, query.to)
            .await?,
    )))
}

async fn marketplace_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let listings = sqlx::query("SELECT id,listing_name,status,commission_bps,ranking_score,approval_note,approved_at,created_at FROM marketplace_listings WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC")
        .bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await.map_err(|_| AppError::internal("failed to load marketplace listings"))?
        .into_iter().map(|row| json!({"id":row.get::<String,_>("id"),"listingName":row.get::<String,_>("listing_name"),"status":row.get::<String,_>("status"),"commissionBps":row.get::<i32,_>("commission_bps"),"rankingScore":row.get::<i32,_>("ranking_score"),"approvalNote":row.get::<String,_>("approval_note"),"approvedAt":row.get::<Option<chrono::DateTime<chrono::Utc>>,_>("approved_at"),"createdAt":row.get::<chrono::DateTime<chrono::Utc>,_>("created_at")})).collect::<Vec<_>>();
    let reviews = sqlx::query("SELECT r.id,r.platform,r.rating,r.review_text,COALESCE(r.reviewed_at,r.created_at) reviewed_at,m.decision,m.note FROM client_review_links r LEFT JOIN marketplace_review_moderation m ON m.tenant_id=r.tenant_id AND m.branch_id=r.branch_id AND m.review_id=r.id WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.rating IS NOT NULL ORDER BY reviewed_at DESC LIMIT 100")
        .bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await.map_err(|_| AppError::internal("failed to load marketplace reviews"))?
        .into_iter().map(|row| json!({"id":row.get::<String,_>("id"),"platform":row.get::<String,_>("platform"),"rating":row.get::<Option<i16>,_>("rating"),"reviewText":row.get::<String,_>("review_text"),"reviewedAt":row.get::<chrono::DateTime<chrono::Utc>,_>("reviewed_at"),"decision":row.get::<Option<String>,_>("decision"),"note":row.get::<Option<String>,_>("note")})).collect::<Vec<_>>();
    let connections = operations_repository::marketplace_summary(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load marketplace connections"))?;
    let failed_events =
        operations_repository::failed_marketplace_events(&state.db, &tenant_id, &branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load marketplace retries"))?;
    Ok(Json(ApiResponse::ok(
        json!({"listings":listings,"reviews":reviews,"connections":connections,"failedEvents":failed_events}),
    )))
}

async fn save_listing(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ListingRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if body.listing_name.trim().is_empty() || !(0..=10000).contains(&body.commission_bps) {
        return Err(AppError::validation(
            "listing name or commission is invalid",
        ));
    }
    let id: String = sqlx::query_scalar("INSERT INTO marketplace_listings(tenant_id,branch_id,listing_name,commission_bps,ranking_score) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET listing_name=EXCLUDED.listing_name,commission_bps=EXCLUDED.commission_bps,ranking_score=EXCLUDED.ranking_score,updated_at=NOW() RETURNING id")
        .bind(&tenant_id).bind(&branch_id).bind(body.listing_name.trim()).bind(body.commission_bps).bind(body.ranking_score).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to save marketplace listing"))?;
    Ok(Json(ApiResponse::ok(json!({"id":id}))))
}

async fn decide_listing(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<DecisionRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !matches!(
        body.decision.as_str(),
        "approved" | "rejected" | "suspended"
    ) {
        return Err(AppError::validation("invalid listing decision"));
    }
    let count = sqlx::query("UPDATE marketplace_listings SET status=$4,approval_note=$5,approved_by=CASE WHEN $4='approved' THEN $6 ELSE approved_by END,approved_at=CASE WHEN $4='approved' THEN NOW() ELSE approved_at END,updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3")
        .bind(&id).bind(&tenant_id).bind(&branch_id).bind(&body.decision).bind(body.note.unwrap_or_default()).bind(&claims.sub).execute(&state.db).await.map_err(|_| AppError::internal("failed to decide marketplace listing"))?.rows_affected();
    if count == 0 {
        return Err(AppError::not_found("marketplace listing was not found"));
    }
    Ok(Json(ApiResponse::ok(
        json!({"id":id,"status":body.decision}),
    )))
}

async fn moderate_review(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<DecisionRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !matches!(
        body.decision.as_str(),
        "approved" | "rejected" | "escalated"
    ) {
        return Err(AppError::validation("invalid review decision"));
    }
    let updated = sqlx::query("INSERT INTO marketplace_review_moderation(tenant_id,branch_id,review_id,decision,note,decided_by) SELECT $1,$2,$3,$4,$5,$6 FROM client_review_links WHERE id=$3 AND tenant_id=$1 AND branch_id=$2 ON CONFLICT(tenant_id,branch_id,review_id) DO UPDATE SET decision=EXCLUDED.decision,note=EXCLUDED.note,decided_by=EXCLUDED.decided_by,decided_at=NOW()")
        .bind(&tenant_id).bind(&branch_id).bind(&id).bind(&body.decision).bind(body.note.unwrap_or_default()).bind(&claims.sub).execute(&state.db).await.map_err(|_| AppError::internal("failed to moderate marketplace review"))?.rows_affected();
    if updated == 0 {
        return Err(AppError::not_found("marketplace review was not found"));
    }
    Ok(Json(ApiResponse::ok(
        json!({"id":id,"decision":body.decision}),
    )))
}

#[cfg(test)]
mod tests {
    use crate::services::operations_service::valid_transition;

    #[test]
    fn field_job_statuses_move_forward_only() {
        assert!(valid_transition("created", "assigned"));
        assert!(valid_transition("assigned", "accepted"));
        assert!(valid_transition("en_route", "arrived"));
        assert!(valid_transition("arrived", "completed"));
        assert!(!valid_transition("completed", "arrived"));
        assert!(!valid_transition("created", "completed"));
    }
}
