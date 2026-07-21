use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/operations/outcall", get(outcall_summary))
        .route("/operations/outcall/zones", post(save_zone))
        .route("/operations/outcall/jobs", post(create_job))
        .route("/operations/outcall/jobs/:id/status", patch(set_job_status))
        .route("/operations/marketplace", get(marketplace_summary))
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ZoneRequest {
    name: String,
    service_area: String,
    travel_minutes: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobRequest {
    appointment_id: Option<String>,
    client_id: Option<String>,
    staff_id: Option<String>,
    travel_zone_id: Option<String>,
    address: String,
    travel_minutes: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobStatusRequest {
    status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListingRequest {
    listing_name: String,
    commission_bps: i32,
    ranking_score: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecisionRequest {
    decision: String,
    note: Option<String>,
}

async fn outcall_summary(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let zones = sqlx::query("SELECT id,name,service_area,travel_minutes,active FROM travel_zones WHERE tenant_id=$1 AND branch_id=$2 ORDER BY name")
        .bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await
        .map_err(|_| AppError::internal("failed to load travel zones"))?
        .into_iter().map(|row| json!({"id":row.get::<String,_>("id"),"name":row.get::<String,_>("name"),"serviceArea":row.get::<String,_>("service_area"),"travelMinutes":row.get::<i32,_>("travel_minutes"),"active":row.get::<bool,_>("active")})).collect::<Vec<_>>();
    let jobs = sqlx::query("SELECT j.id,j.appointment_id,j.client_id,j.staff_id,j.travel_zone_id,j.address,j.travel_minutes,j.status,j.arrival_at,j.completed_at,j.created_at,COALESCE(NULLIF(TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),''),'Unassigned') staff_name FROM field_jobs j LEFT JOIN staff s ON s.id=j.staff_id AND s.tenant_id=j.tenant_id AND s.branch_id=j.branch_id WHERE j.tenant_id=$1 AND j.branch_id=$2 ORDER BY j.created_at DESC LIMIT 200")
        .bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await
        .map_err(|_| AppError::internal("failed to load field jobs"))?
        .into_iter().map(|row| json!({"id":row.get::<String,_>("id"),"appointmentId":row.get::<Option<String>,_>("appointment_id"),"clientId":row.get::<Option<String>,_>("client_id"),"staffId":row.get::<Option<String>,_>("staff_id"),"staffName":row.get::<String,_>("staff_name"),"travelZoneId":row.get::<Option<String>,_>("travel_zone_id"),"address":row.get::<String,_>("address"),"travelMinutes":row.get::<i32,_>("travel_minutes"),"status":row.get::<String,_>("status"),"arrivalAt":row.get::<Option<chrono::DateTime<chrono::Utc>>,_>("arrival_at"),"completedAt":row.get::<Option<chrono::DateTime<chrono::Utc>>,_>("completed_at"),"createdAt":row.get::<chrono::DateTime<chrono::Utc>,_>("created_at")})).collect::<Vec<_>>();
    Ok(Json(ApiResponse::ok(json!({"zones":zones,"jobs":jobs}))))
}

async fn save_zone(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ZoneRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if body.name.trim().is_empty() || body.travel_minutes < 0 || body.travel_minutes > 1440 {
        return Err(AppError::validation(
            "travel zone name and minutes are invalid",
        ));
    }
    let id: String = sqlx::query_scalar("INSERT INTO travel_zones(tenant_id,branch_id,name,service_area,travel_minutes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,branch_id,name) DO UPDATE SET service_area=EXCLUDED.service_area,travel_minutes=EXCLUDED.travel_minutes,active=TRUE,updated_at=NOW() RETURNING id")
        .bind(&tenant_id).bind(&branch_id).bind(body.name.trim()).bind(body.service_area.trim()).bind(body.travel_minutes).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to save travel zone"))?;
    Ok(Json(ApiResponse::ok(json!({"id":id}))))
}

async fn create_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<JobRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if body.address.trim().is_empty() || body.travel_minutes < 0 || body.travel_minutes > 1440 {
        return Err(AppError::validation(
            "address and travel minutes are required",
        ));
    }
    let id: String = sqlx::query_scalar("INSERT INTO field_jobs(tenant_id,branch_id,appointment_id,client_id,staff_id,travel_zone_id,address,travel_minutes,status) VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),$7,$8,CASE WHEN NULLIF($5,'') IS NULL THEN 'created' ELSE 'assigned' END) RETURNING id")
        .bind(&tenant_id).bind(&branch_id).bind(body.appointment_id.unwrap_or_default()).bind(body.client_id.unwrap_or_default()).bind(body.staff_id.unwrap_or_default()).bind(body.travel_zone_id.unwrap_or_default()).bind(body.address.trim()).bind(body.travel_minutes).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to create field job"))?;
    Ok(Json(ApiResponse::ok(json!({"id":id}))))
}

async fn set_job_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<JobStatusRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !matches!(
        body.status.as_str(),
        "assigned" | "en_route" | "arrived" | "completed" | "cancelled"
    ) {
        return Err(AppError::validation("invalid field job status"));
    }
    let updated = sqlx::query("UPDATE field_jobs SET status=$4,arrival_at=CASE WHEN $4='arrived' THEN NOW() ELSE arrival_at END,completed_at=CASE WHEN $4='completed' THEN NOW() ELSE completed_at END,updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3")
        .bind(&id).bind(&tenant_id).bind(&branch_id).bind(&body.status).execute(&state.db).await
        .map_err(|_| AppError::internal("failed to update field job"))?.rows_affected();
    if updated == 0 {
        return Err(AppError::not_found("field job was not found"));
    }
    Ok(Json(ApiResponse::ok(json!({"id":id,"status":body.status}))))
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
    Ok(Json(ApiResponse::ok(
        json!({"listings":listings,"reviews":reviews}),
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
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<DecisionRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let actor = headers
        .get("x-user-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("system");
    if !matches!(
        body.decision.as_str(),
        "approved" | "rejected" | "suspended"
    ) {
        return Err(AppError::validation("invalid listing decision"));
    }
    let count = sqlx::query("UPDATE marketplace_listings SET status=$4,approval_note=$5,approved_by=CASE WHEN $4='approved' THEN $6 ELSE approved_by END,approved_at=CASE WHEN $4='approved' THEN NOW() ELSE approved_at END,updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3")
        .bind(&id).bind(&tenant_id).bind(&branch_id).bind(&body.decision).bind(body.note.unwrap_or_default()).bind(actor).execute(&state.db).await.map_err(|_| AppError::internal("failed to decide marketplace listing"))?.rows_affected();
    if count == 0 {
        return Err(AppError::not_found("marketplace listing was not found"));
    }
    Ok(Json(ApiResponse::ok(
        json!({"id":id,"status":body.decision}),
    )))
}

async fn moderate_review(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<DecisionRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let actor = headers
        .get("x-user-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("system");
    if !matches!(
        body.decision.as_str(),
        "approved" | "rejected" | "escalated"
    ) {
        return Err(AppError::validation("invalid review decision"));
    }
    sqlx::query("INSERT INTO marketplace_review_moderation(tenant_id,branch_id,review_id,decision,note,decided_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,branch_id,review_id) DO UPDATE SET decision=EXCLUDED.decision,note=EXCLUDED.note,decided_by=EXCLUDED.decided_by,decided_at=NOW()")
        .bind(&tenant_id).bind(&branch_id).bind(&id).bind(&body.decision).bind(body.note.unwrap_or_default()).bind(actor).execute(&state.db).await.map_err(|_| AppError::internal("failed to moderate marketplace review"))?;
    Ok(Json(ApiResponse::ok(
        json!({"id":id,"decision":body.decision}),
    )))
}
