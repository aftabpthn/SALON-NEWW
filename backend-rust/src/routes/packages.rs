use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    Extension, Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::packages_repository::{self, PackageRecord},
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        invoice_pdf,
        package_service::{self, PackageInput},
        security_service,
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/packages",
            axum::routing::get(list_packages).post(create_package),
        )
        .route(
            "/packages/:id",
            axum::routing::get(get_package)
                .patch(update_package)
                .delete(archive_package),
        )
        .route(
            "/packages/:id/restore",
            axum::routing::post(restore_package),
        )
        .route(
            "/package-enterprise/settings",
            axum::routing::get(get_package_settings).patch(save_package_settings),
        )
        .route(
            "/package-enterprise/reports",
            axum::routing::get(get_package_report),
        )
        .route(
            "/package-enterprise/reports/export",
            axum::routing::get(export_package_report),
        )
        .route(
            "/package-enterprise/alerts",
            axum::routing::get(get_package_alerts),
        )
        .route(
            "/package-enterprise/credits/:id/freeze",
            axum::routing::post(freeze_package_credit),
        )
        .route(
            "/package-enterprise/credits/:id/resume",
            axum::routing::post(resume_package_credit),
        )
        .route(
            "/package-enterprise/credits/:id/transfer",
            axum::routing::post(transfer_package_credit),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageListQuery {
    pub q: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageReportQuery {
    pub status: Option<String>,
    pub q: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub format: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageWriteRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub price_paise: Option<i64>,
    pub discount_percent: Option<i32>,
    pub validity_days: Option<i32>,
    pub service_ids: Option<Vec<String>>,
    pub service_rows: Option<Vec<Value>>,
    pub paid_sessions: Option<i32>,
    pub free_sessions: Option<i32>,
    pub cost_price_paise: Option<i64>,
    pub rules: Option<Value>,
    pub show_mobile_app: Option<bool>,
    pub show_online_booking: Option<bool>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageCreditLifecycleRequest {
    reason: String,
    idempotency_key: String,
    target_client_id: Option<String>,
    frozen_until: Option<NaiveDate>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageResponse {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub name: String,
    pub description: String,
    pub price_paise: i64,
    pub discount_percent: i32,
    pub validity_days: i32,
    pub service_ids: Value,
    pub service_rows: Value,
    pub paid_sessions: i32,
    pub free_sessions: i32,
    pub cost_price_paise: i64,
    pub rules: Value,
    pub show_mobile_app: bool,
    pub show_online_booking: bool,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

async fn list_packages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PackageListQuery>,
) -> ApiResult<Vec<PackageResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 100);
    let q = query.q.unwrap_or_default();

    let rows = packages_repository::list(
        &state.db,
        &tenant_id,
        &branch_id,
        &q,
        page_size,
        (page - 1) * page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to list packages"))?;

    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(PackageResponse::from).collect(),
    )))
}

async fn get_package(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<PackageResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = packages_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load package"))?
        .ok_or_else(|| AppError::not_found("package was not found"))?;

    Ok(Json(ApiResponse::ok(PackageResponse::from(row))))
}

async fn create_package(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PackageWriteRequest>,
) -> ApiResult<PackageResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = package_service::create(&state.db, &tenant_id, &branch_id, payload.into()).await?;

    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "package.added",
        serde_json::json!({"packageId":row.id,"recordName":row.name}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(PackageResponse::from(row))))
}

async fn update_package(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PackageWriteRequest>,
) -> ApiResult<PackageResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let previous = packages_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load package"))?
        .ok_or_else(|| AppError::not_found("package was not found"))?;
    let requested_active = payload.active;
    let row = package_service::update(&state.db, &tenant_id, &branch_id, &id, payload.into())
        .await?
        .ok_or_else(|| AppError::not_found("package was not found"))?;

    let (action, restorable) = match (previous.active, requested_active) {
        (true, Some(false)) => ("package.archived", true),
        (false, Some(true)) => ("package.restored", false),
        _ => ("package.edited", false),
    };

    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        action,
        serde_json::json!({"packageId":row.id,"recordName":row.name,"restorable":restorable}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(PackageResponse::from(row))))
}

async fn archive_package(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let record = packages_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load package"))?
        .ok_or_else(|| AppError::not_found("package was not found"))?;
    let archived = packages_repository::archive(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to archive package"))?;

    if !archived {
        return Err(AppError::conflict("package is already archived"));
    }

    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "package.archived",
        serde_json::json!({"packageId":id,"recordName":record.name,"restorable":true}),
    )
    .await?;

    Ok(Json(ApiResponse::ok(
        serde_json::json!({ "deleted": false, "archived": true, "id": id }),
    )))
}

async fn restore_package(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let name = packages_repository::restore(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to restore package"))?
        .ok_or_else(|| AppError::conflict("package is not archived"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "package.restored",
        serde_json::json!({"packageId":id,"recordName":name,"restored":true}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"restored":true,"id":id}),
    )))
}

async fn get_package_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        package_service::settings(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn save_package_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let saved = package_service::save_settings(&state.db, &tenant_id, &branch_id, payload).await?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "package.settings.updated",
        serde_json::json!({}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(saved)))
}

async fn freeze_package_credit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PackageCreditLifecycleRequest>,
) -> ApiResult<Value> {
    change_package_credit(&state, &claims, &headers, &id, "freeze", payload).await
}

async fn resume_package_credit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PackageCreditLifecycleRequest>,
) -> ApiResult<Value> {
    change_package_credit(&state, &claims, &headers, &id, "resume", payload).await
}

async fn transfer_package_credit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PackageCreditLifecycleRequest>,
) -> ApiResult<Value> {
    change_package_credit(&state, &claims, &headers, &id, "transfer", payload).await
}

async fn change_package_credit(
    state: &AppState,
    claims: &AuthClaims,
    headers: &HeaderMap,
    id: &str,
    action: &str,
    payload: PackageCreditLifecycleRequest,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(headers)?;
    let result = package_service::change_credit_state(
        &state.db,
        &tenant_id,
        &branch_id,
        id,
        action,
        payload.target_client_id.as_deref(),
        payload.frozen_until,
        &payload.reason,
        &payload.idempotency_key,
        &claims.sub,
    )
    .await?;
    security_service::record_audit(
        &state.db, &tenant_id, &branch_id, &claims.sub, &format!("package.credit.{action}"),
        serde_json::json!({"creditId":id,"reason":payload.reason,"targetClientId":payload.target_client_id}),
    ).await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn get_package_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PackageReportQuery>,
) -> ApiResult<package_service::PackageReport> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        package_service::report(
            &state.db,
            &tenant_id,
            &branch_id,
            query.status.as_deref().unwrap_or("pending"),
            query.q.as_deref().unwrap_or(""),
            query.from,
            query.to,
            query.limit.unwrap_or(50).clamp(1, 500),
            query.offset.unwrap_or(0).max(0),
        )
        .await?,
    )))
}

async fn get_package_alerts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<package_service::PackageAlert>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        package_service::alerts(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn export_package_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PackageReportQuery>,
) -> Result<Response, AppError> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let report = package_service::report(
        &state.db,
        &tenant_id,
        &branch_id,
        query.status.as_deref().unwrap_or("pending"),
        query.q.as_deref().unwrap_or(""),
        query.from,
        query.to,
        query.limit.unwrap_or(10_000).clamp(1, 10_000),
        0,
    )
    .await?;
    let status = report.status.clone();
    let format = query.format.as_deref().unwrap_or("csv");
    let (body, content_type, extension) = if format.eq_ignore_ascii_case("pdf") {
        let mut lines = vec![
            format!("Rows: {}", report.summary.total_rows),
            format!("Total credits: {}", report.summary.total_qty),
            format!("Redeemed credits: {}", report.summary.redeemed_qty),
            format!("Pending credits: {}", report.summary.pending_qty),
            format!(
                "Pending value: {}",
                report_money(report.summary.pending_value_paise)
            ),
        ];
        lines.extend(report.rows.iter().map(|row| {
            format!(
                "{} | {} | {} | total {} | redeemed {} | pending {} | {}",
                row.client_name,
                row.package_name,
                row.service_name,
                row.total_qty,
                row.redeemed_qty,
                row.pending_qty,
                report_money(row.pending_value_paise)
            )
        }));
        (
            invoice_pdf::render_text_report(
                &format!("{} Packages Report", title_case(&status)),
                &lines,
            ),
            "application/pdf",
            "pdf",
        )
    } else {
        (
            package_report_csv(&report).into_bytes(),
            "text/csv; charset=utf-8",
            "csv",
        )
    };
    let mut response = body.into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!(
            "attachment; filename=\"{status}-packages-report.{extension}\""
        ))
        .map_err(|_| AppError::internal("failed to build export header"))?,
    );
    Ok(response)
}

fn package_report_csv(report: &package_service::PackageReport) -> String {
    let mut lines = vec!["Client,Contact,Package,Service,Invoice,Unit Value Paise,Issued Value Paise,Redeemed Value Paise,Pending Value Paise,Total Qty,Redeemed Qty,Pending Qty,Sold At,Expires At,Status".to_string()];
    lines.extend(report.rows.iter().map(|row| {
        [
            row.client_name.clone(),
            row.contact.clone(),
            row.package_name.clone(),
            row.service_name.clone(),
            row.invoice_number.clone(),
            row.unit_value_paise.to_string(),
            row.issued_value_paise.to_string(),
            row.redeemed_value_paise.to_string(),
            row.pending_value_paise.to_string(),
            row.total_qty.to_string(),
            row.redeemed_qty.to_string(),
            row.pending_qty.to_string(),
            row.sold_at.to_rfc3339(),
            row.expires_at
                .map(|date| date.to_string())
                .unwrap_or_default(),
            row.status.clone(),
        ]
        .into_iter()
        .map(|value| csv_field(&value))
        .collect::<Vec<_>>()
        .join(",")
    }));
    lines.join("\n") + "\n"
}

fn csv_field(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn report_money(paise: i64) -> String {
    format!("INR {}.{:02}", paise / 100, paise.unsigned_abs() % 100)
}
fn title_case(value: &str) -> String {
    let mut chars = value.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
        .unwrap_or_default()
}

impl From<PackageWriteRequest> for PackageInput {
    fn from(value: PackageWriteRequest) -> Self {
        Self {
            name: value.name,
            description: value.description,
            price_paise: value.price_paise,
            discount_percent: value.discount_percent,
            validity_days: value.validity_days,
            service_ids: value.service_ids,
            service_rows: value.service_rows,
            paid_sessions: value.paid_sessions,
            free_sessions: value.free_sessions,
            cost_price_paise: value.cost_price_paise,
            rules: value.rules,
            show_mobile_app: value.show_mobile_app,
            show_online_booking: value.show_online_booking,
            active: value.active,
        }
    }
}

impl From<PackageRecord> for PackageResponse {
    fn from(record: PackageRecord) -> Self {
        Self {
            id: record.id,
            tenant_id: record.tenant_id,
            branch_id: record.branch_id,
            name: record.name,
            description: record.description,
            price_paise: record.price_paise,
            discount_percent: record.discount_percent,
            validity_days: record.validity_days,
            service_ids: serde_json::from_str(&record.service_ids_json)
                .unwrap_or(Value::Array(vec![])),
            service_rows: serde_json::from_str(&record.service_rows_json)
                .unwrap_or(Value::Array(vec![])),
            paid_sessions: record.paid_sessions,
            free_sessions: record.free_sessions,
            cost_price_paise: record.cost_price_paise,
            rules: serde_json::from_str(&record.rules_json)
                .unwrap_or(Value::Object(Default::default())),
            show_mobile_app: record.show_mobile_app,
            show_online_booking: record.show_online_booking,
            active: record.active,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}
