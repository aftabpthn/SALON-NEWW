use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::membership_repository::{
        self, CreateMembership, MembershipRecord, UpdateMembership,
    },
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, security_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/memberships",
            axum::routing::get(list_memberships).post(create_membership),
        )
        .route(
            "/memberships/:id/restore",
            axum::routing::post(restore_membership),
        )
        .route(
            "/memberships/:id",
            axum::routing::get(get_membership)
                .patch(update_membership)
                .delete(archive_membership),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipListQuery {
    pub q: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipWriteRequest {
    pub name: Option<String>,
    pub code: Option<String>,
    pub plan_type: Option<String>,
    pub price_paise: Option<i64>,
    pub points_required: Option<i32>,
    pub discount_percent: Option<i32>,
    pub validity_days: Option<i32>,
    pub notes: Option<String>,
    pub service_ids: Option<Vec<String>>,
    pub benefit_rules: Option<Value>,
    pub active: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipResponse {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub name: String,
    pub code: String,
    pub plan_type: String,
    pub price_paise: i64,
    pub points_required: i32,
    pub discount_percent: i32,
    pub validity_days: i32,
    pub notes: String,
    pub service_ids: Value,
    pub benefit_rules: Value,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

async fn list_memberships(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MembershipListQuery>,
) -> ApiResult<Vec<MembershipResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 100);
    let q = query.q.unwrap_or_default();

    let rows = membership_repository::list(
        &state.db,
        &tenant_id,
        &branch_id,
        &q,
        page_size,
        (page - 1) * page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to list memberships"))?;

    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(MembershipResponse::from).collect(),
    )))
}

async fn get_membership(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<MembershipResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = membership_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load membership"))?
        .ok_or_else(|| AppError::not_found("membership was not found"))?;

    Ok(Json(ApiResponse::ok(MembershipResponse::from(row))))
}

async fn create_membership(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<MembershipWriteRequest>,
) -> ApiResult<MembershipResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let name = required_text(payload.name.as_deref(), "name is required")?;
    let points_required = non_negative_i32(payload.points_required, "pointsRequired")?;
    let discount_percent = non_negative_i32(payload.discount_percent, "discountPercent")?;
    let validity_days = non_negative_i32(payload.validity_days, "validityDays")?;
    let notes = payload.notes.unwrap_or_default();
    let service_ids_json = serde_json::to_string(&payload.service_ids.unwrap_or_default())
        .unwrap_or_else(|_| "[]".to_string());
    let benefit_rules_json = serde_json::to_string(
        &payload
            .benefit_rules
            .unwrap_or(Value::Object(Default::default())),
    )
    .unwrap_or_else(|_| "{}".to_string());

    let row = membership_repository::create(
        &state.db,
        CreateMembership {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            name,
            plan_type: payload.plan_type.as_deref().unwrap_or("discount").trim(),
            price_paise: non_negative_i64(payload.price_paise, "pricePaise")?,
            points_required,
            discount_percent,
            validity_days,
            notes: &notes,
            service_ids_json: &service_ids_json,
            benefit_rules_json: &benefit_rules_json,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to create membership"))?;

    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "membership.added",
        serde_json::json!({"membershipId":row.id,"recordName":row.name}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(MembershipResponse::from(row))))
}

async fn update_membership(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<MembershipWriteRequest>,
) -> ApiResult<MembershipResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let previous = membership_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load membership"))?
        .ok_or_else(|| AppError::not_found("membership was not found"))?;
    let requested_active = payload.active;
    let notes = payload.notes.as_deref();
    let service_ids_json = payload
        .service_ids
        .as_ref()
        .map(|service_ids| serde_json::to_string(service_ids).unwrap_or_else(|_| "[]".to_string()));
    let benefit_rules_json = payload
        .benefit_rules
        .as_ref()
        .map(|rules| serde_json::to_string(rules).unwrap_or_else(|_| "{}".to_string()));

    let row = membership_repository::update(
        &state.db,
        UpdateMembership {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            id: &id,
            name: payload.name.as_deref(),
            code: payload.code.as_deref(),
            plan_type: payload.plan_type.as_deref(),
            price_paise: payload.price_paise.map(|value| value.max(0)),
            points_required: payload.points_required,
            discount_percent: payload.discount_percent,
            validity_days: payload.validity_days,
            notes,
            service_ids_json: service_ids_json.as_deref(),
            benefit_rules_json: benefit_rules_json.as_deref(),
            active: payload.active,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to update membership"))?
    .ok_or_else(|| AppError::not_found("membership was not found"))?;

    let (action, restorable) = match (previous.active, requested_active) {
        (true, Some(false)) => ("membership.archived", true),
        (false, Some(true)) => ("membership.restored", false),
        _ => ("membership.edited", false),
    };

    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        action,
        serde_json::json!({"membershipId":row.id,"recordName":row.name,"restorable":restorable}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(MembershipResponse::from(row))))
}

async fn archive_membership(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let record = membership_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load membership"))?
        .ok_or_else(|| AppError::not_found("membership was not found"))?;
    let archived = membership_repository::archive(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to archive membership"))?;

    if !archived {
        return Err(AppError::conflict("membership is already archived"));
    }

    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "membership.archived",
        serde_json::json!({"membershipId":id,"recordName":record.name,"restorable":true}),
    )
    .await?;

    Ok(Json(ApiResponse::ok(
        serde_json::json!({ "deleted": false, "archived": true, "id": id }),
    )))
}

async fn restore_membership(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let name = membership_repository::restore(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to restore membership"))?
        .ok_or_else(|| AppError::conflict("membership is not archived"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "membership.restored",
        serde_json::json!({"membershipId":id,"recordName":name,"restored":true}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"restored":true,"id":id}),
    )))
}

fn required_text<'a>(value: Option<&'a str>, message: &'static str) -> Result<&'a str, AppError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation(message))
}

fn non_negative_i32(value: Option<i32>, field: &'static str) -> Result<i32, AppError> {
    value
        .unwrap_or(0)
        .ge(&0)
        .then_some(value.unwrap_or(0))
        .ok_or_else(|| AppError::validation(format!("{field} must be 0 or greater")))
}

fn non_negative_i64(value: Option<i64>, field: &'static str) -> Result<i64, AppError> {
    value
        .unwrap_or(0)
        .ge(&0)
        .then_some(value.unwrap_or(0))
        .ok_or_else(|| AppError::validation(format!("{field} must be 0 or greater")))
}

impl From<MembershipRecord> for MembershipResponse {
    fn from(record: MembershipRecord) -> Self {
        Self {
            id: record.id,
            tenant_id: record.tenant_id,
            branch_id: record.branch_id,
            name: record.name,
            code: record.code,
            plan_type: record.plan_type,
            price_paise: record.price_paise,
            points_required: record.points_required,
            discount_percent: record.discount_percent,
            validity_days: record.validity_days,
            notes: record.notes,
            service_ids: serde_json::from_str(&record.service_ids_json)
                .unwrap_or(Value::Array(vec![])),
            benefit_rules: serde_json::from_str(&record.benefit_rules_json)
                .unwrap_or(Value::Object(Default::default())),
            active: record.active,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}
