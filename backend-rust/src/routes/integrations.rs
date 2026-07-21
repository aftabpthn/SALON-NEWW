use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue},
    response::{Redirect, Response},
    routing::{delete, get, post, put},
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    models::{
        common::{ApiResponse, ApiResult, AppError},
        migration::{
            AnalyzeMigrationRequest, CreateImportJobRequest, CreateLargeImportJobRequest,
            ImportJob, MigrationAnalysisReport, MigrationApprovalRequest, MigrationImportChunk,
            MigrationMapping, MigrationMappingSuggestionRequest, MigrationRecoveryReport,
            MigrationTemplate, SaveMigrationMappingRequest,
        },
        migration_file::{
            CompleteMigrationUploadRequest, CompleteMigrationUploadResponse,
            CreateMigrationUploadRequest, MigrationSourceFile, MigrationUploadPartReceipt,
            MigrationUploadSession,
        },
    },
    routes::{
        context::tenant_branch,
        security::{require_security_manage, require_security_read},
    },
    services::{
        auth_service::AuthClaims, integration_service, migration_file_service,
        migration_large_import_service, migration_service,
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    const IMPORT_JSON_BODY_LIMIT_BYTES: usize = 12 * 1024 * 1024;

    Router::new()
        .route(
            "/settings/integrations/api-keys",
            get(list_api_keys).post(create_api_key),
        )
        .route(
            "/settings/integrations/api-keys/:id/rotate",
            post(rotate_api_key),
        )
        .route(
            "/settings/integrations/api-keys/:id",
            delete(revoke_api_key),
        )
        .route(
            "/settings/integrations/delivery-providers",
            get(delivery_providers),
        )
        .route("/settings/integrations/connectors", get(list_connectors))
        .route(
            "/settings/integrations/connectors/:provider/start",
            post(start_connector),
        )
        .route(
            "/settings/integrations/connectors/:provider/sync",
            post(sync_connector),
        )
        .route(
            "/settings/integrations/connectors/:provider",
            delete(disconnect_connector),
        )
        .route(
            "/settings/integrations/connector-sync-jobs",
            get(connector_sync_jobs),
        )
        .route(
            "/settings/integrations/webhooks",
            get(list_webhooks).post(create_webhook),
        )
        .route(
            "/settings/integrations/webhooks/:id/rotate",
            post(rotate_webhook),
        )
        .route(
            "/settings/integrations/webhooks/:id/test",
            post(test_webhook),
        )
        .route(
            "/settings/integrations/webhooks/:id",
            delete(deactivate_webhook),
        )
        .route(
            "/settings/integrations/webhook-deliveries",
            get(webhook_logs),
        )
        .route(
            "/settings/integrations/import-jobs",
            get(list_import_jobs)
                .post(create_import_job)
                .layer(DefaultBodyLimit::max(IMPORT_JSON_BODY_LIMIT_BYTES)),
        )
        .route(
            "/settings/integrations/import-templates",
            get(import_templates),
        )
        .route(
            "/settings/integrations/import-mappings",
            get(list_import_mappings).post(save_import_mapping),
        )
        .route(
            "/settings/integrations/import-mapping-suggestions",
            post(import_mapping_suggestions),
        )
        .route(
            "/settings/integrations/import-jobs/analyze",
            post(analyze_import).layer(DefaultBodyLimit::max(IMPORT_JSON_BODY_LIMIT_BYTES)),
        )
        .route(
            "/settings/integrations/import-jobs/from-source",
            post(create_large_import_job),
        )
        .route(
            "/settings/integrations/import-jobs/:id/pause",
            post(pause_import_job),
        )
        .route(
            "/settings/integrations/import-jobs/:id/resume",
            post(resume_import_job),
        )
        .route(
            "/settings/integrations/import-jobs/:id/retry-failed",
            post(retry_failed_import_job),
        )
        .route(
            "/settings/integrations/import-jobs/:id/cancel",
            post(cancel_import_job),
        )
        .route(
            "/settings/integrations/import-jobs/:id/chunks",
            get(list_import_chunks),
        )
        .route(
            "/settings/integrations/import-jobs/:id/rollback",
            post(rollback_import_job),
        )
        .route(
            "/settings/integrations/import-jobs/:id/recovery",
            get(import_recovery_report),
        )
        .route(
            "/settings/integrations/import-jobs/:id/approval",
            post(decide_import_approval),
        )
        .route(
            "/settings/integrations/import-jobs/:id/governance",
            get(import_governance_report),
        )
        .route(
            "/settings/integrations/import-jobs/:id/failure-assistant",
            post(import_failure_assistant),
        )
        .route(
            "/settings/integrations/import-monitoring",
            get(import_monitoring),
        )
        .route(
            "/settings/integrations/import-jobs/:id/proof-pack",
            get(download_import_proof_pack),
        )
        .route(
            "/settings/integrations/import-jobs/:id/failed-rows",
            get(download_import_failed_rows),
        )
        .route(
            "/settings/integrations/import-jobs/:id/rollback-impact",
            get(import_rollback_impact),
        )
        .route(
            "/settings/integrations/import-uploads",
            post(create_import_upload),
        )
        .route(
            "/settings/integrations/import-uploads/:id",
            get(get_import_upload),
        )
        .route(
            "/settings/integrations/import-uploads/:id/parts/:part_number",
            put(upload_import_part).layer(DefaultBodyLimit::max(
                migration_file_service::MAX_PART_BYTES,
            )),
        )
        .route(
            "/settings/integrations/import-uploads/:id/complete",
            post(complete_import_upload),
        )
        .route(
            "/settings/integrations/import-source-files",
            get(list_import_source_files),
        )
        .route(
            "/settings/integrations/import-source-files/:id/evidence",
            get(download_import_source_evidence),
        )
}

pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/openapi.json", get(openapi))
        .route("/integrations/v1/clients", get(api_clients))
        .route("/integrations/v1/appointments", get(api_appointments))
        .route("/integrations/v1/sales", get(api_sales))
        .route(
            "/integrations/oauth/:provider/callback",
            get(connector_oauth_callback),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiKeyWrite {
    name: String,
    scopes: Vec<String>,
    expires_at: Option<DateTime<Utc>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebhookWrite {
    name: String,
    endpoint_url: String,
    events: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeliveryQuery {
    subscription_id: Option<String>,
}
#[derive(Deserialize)]
struct LimitQuery {
    limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorStartWrite {
    return_uri: String,
    account_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    realm_id: Option<String>,
    error: Option<String>,
}

async fn list_api_keys(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::integration_repository::ApiKeyRecord>> {
    require_security_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        integration_service::list_api_keys(&s.db, &t, &b).await?,
    )))
}
async fn delivery_providers(State(s): State<AppState>) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(vec![
        json!({"provider":"Booking OTP / SMS","enabled":s.settings.invoice_delivery_webhook_url.is_some(),"webhookConfigured":s.settings.invoice_delivery_webhook_url.is_some(),"environment":s.settings.app_env.clone()}),
        json!({"provider":"WhatsApp Cloud","enabled":s.settings.whatsapp_benefit_enabled(),"webhookConfigured":s.settings.whatsapp_cloud_webhook_configured(),"environment":s.settings.app_env.clone()}),
        json!({"provider":"Email delivery","enabled":s.settings.invoice_delivery_webhook_url.is_some(),"webhookConfigured":s.settings.invoice_delivery_webhook_url.is_some(),"environment":s.settings.app_env}),
    ])))
}
async fn list_connectors(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<integration_service::ConnectorView>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        integration_service::list_connectors(&s.db, &s.settings, &t, &b).await?,
    )))
}
async fn start_connector(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(provider): Path<String>,
    Json(p): Json<ConnectorStartWrite>,
) -> ApiResult<integration_service::ConnectorAuthorize> {
    let (t, b) = tenant_branch(&headers)?;
    let provider = integration_service::ConnectorProvider::parse(&provider)?;
    Ok(Json(ApiResponse::ok(
        integration_service::begin_connector_oauth(
            &s.db,
            &s.settings,
            &t,
            &b,
            &c.sub,
            provider,
            p.return_uri.trim(),
            p.account_id.as_deref(),
        )
        .await?,
    )))
}
async fn sync_connector(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(provider): Path<String>,
) -> ApiResult<crate::repositories::integration_repository::ConnectorSyncJob> {
    let (t, b) = tenant_branch(&headers)?;
    let provider = integration_service::ConnectorProvider::parse(&provider)?;
    Ok(Json(ApiResponse::ok(
        integration_service::queue_connector_sync(&s.db, &t, &b, &c.sub, provider).await?,
    )))
}
async fn disconnect_connector(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(provider): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    let provider = integration_service::ConnectorProvider::parse(&provider)?;
    integration_service::disconnect_connector(&s.db, &t, &b, &c.sub, provider).await?;
    Ok(Json(ApiResponse::ok(json!({"disconnected":true}))))
}
async fn connector_sync_jobs(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::integration_repository::ConnectorSyncJob>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        integration_service::list_connector_sync_jobs(&s.db, &t, &b).await?,
    )))
}
async fn connector_oauth_callback(
    State(s): State<AppState>,
    Path(provider): Path<String>,
    Query(q): Query<ConnectorCallbackQuery>,
) -> Result<Redirect, AppError> {
    if q.error.is_some() {
        return Err(AppError::unauthenticated(
            "connector authorization was cancelled or denied",
        ));
    }
    let provider = integration_service::ConnectorProvider::parse(&provider)?;
    let code = q
        .code
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("connector authorization code is required"))?;
    let state = q
        .state
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("connector state is required"))?;
    let return_url = integration_service::finish_connector_oauth(
        &s.db,
        &s.settings,
        provider,
        code,
        state,
        q.realm_id.as_deref(),
    )
    .await?;
    Ok(Redirect::temporary(&return_url))
}
async fn create_api_key(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(p): Json<ApiKeyWrite>,
) -> ApiResult<integration_service::ApiKeyCreated> {
    require_security_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        integration_service::create_api_key(
            &s.db,
            &t,
            &b,
            &c.sub,
            &p.name,
            p.scopes,
            p.expires_at,
            None,
        )
        .await?,
    )))
}
async fn rotate_api_key(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<integration_service::ApiKeyCreated> {
    require_security_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        integration_service::rotate_api_key(&s.db, &t, &b, &c.sub, &id).await?,
    )))
}
async fn revoke_api_key(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_security_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    integration_service::revoke_api_key(&s.db, &t, &b, &c.sub, &id).await?;
    Ok(Json(ApiResponse::ok(json!({"revoked":true}))))
}
async fn list_webhooks(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<integration_service::WebhookView>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        integration_service::list_webhooks(&s.db, &t, &b).await?,
    )))
}
async fn create_webhook(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(p): Json<WebhookWrite>,
) -> ApiResult<integration_service::WebhookCreated> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        integration_service::create_webhook(
            &s.db,
            &s.settings,
            &t,
            &b,
            &c.sub,
            &p.name,
            &p.endpoint_url,
            p.events,
        )
        .await?,
    )))
}
async fn rotate_webhook(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<integration_service::WebhookCreated> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        integration_service::rotate_webhook_secret(&s.db, &s.settings, &t, &b, &c.sub, &id).await?,
    )))
}
async fn deactivate_webhook(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    integration_service::deactivate_webhook(&s.db, &t, &b, &c.sub, &id).await?;
    Ok(Json(ApiResponse::ok(json!({"active":false}))))
}
async fn test_webhook(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    integration_service::test_webhook(&s.db, &t, &b, &id).await?;
    Ok(Json(ApiResponse::ok(json!({"queued":true}))))
}
async fn webhook_logs(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<DeliveryQuery>,
) -> ApiResult<Vec<crate::repositories::integration_repository::WebhookDeliveryLog>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        integration_service::webhook_logs(&s.db, &t, &b, q.subscription_id.as_deref()).await?,
    )))
}
async fn list_import_jobs(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<ImportJob>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::list_jobs(&s.db, &t, &b).await?,
    )))
}
async fn import_templates() -> ApiResult<Vec<MigrationTemplate>> {
    Ok(Json(ApiResponse::ok(migration_service::templates())))
}
async fn list_import_mappings(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<MigrationMapping>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::list_mappings(&s.db, &t, &b).await?,
    )))
}
async fn save_import_mapping(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<SaveMigrationMappingRequest>,
) -> ApiResult<MigrationMapping> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::save_mapping(&s.db, &t, &b, &c.sub, request).await?,
    )))
}

async fn import_mapping_suggestions(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<MigrationMappingSuggestionRequest>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::mapping_suggestions(&s.db, &s.settings, &t, &b, &c.sub, request).await?,
    )))
}
async fn analyze_import(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<AnalyzeMigrationRequest>,
) -> ApiResult<MigrationAnalysisReport> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::analyze(&s.db, &t, &b, request).await?,
    )))
}
async fn create_import_job(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<CreateImportJobRequest>,
) -> ApiResult<ImportJob> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::create_job(&s.db, &t, &b, &c.sub, request).await?,
    )))
}
async fn create_large_import_job(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<CreateLargeImportJobRequest>,
) -> ApiResult<ImportJob> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_large_import_service::create_job(&s.db, &t, &b, &c.sub, request).await?,
    )))
}
async fn pause_import_job(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    migration_large_import_service::pause(&s.db, &t, &b, &id, &c.sub).await?;
    Ok(Json(ApiResponse::ok(json!({"paused":true}))))
}
async fn resume_import_job(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    if migration_large_import_service::is_large_job(&s.db, &t, &b, &id).await? {
        migration_large_import_service::resume(&s.db, &t, &b, &id, &c.sub).await?;
    } else {
        migration_service::resume(&s.db, &t, &b, &id, &c.sub).await?;
    }
    Ok(Json(ApiResponse::ok(json!({"queued":true}))))
}
async fn retry_failed_import_job(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    migration_large_import_service::retry_failed(&s.db, &t, &b, &id, &c.sub).await?;
    Ok(Json(ApiResponse::ok(json!({"queued":true}))))
}
async fn cancel_import_job(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    migration_large_import_service::cancel(&s.db, &t, &b, &id, &c.sub).await?;
    Ok(Json(ApiResponse::ok(json!({"cancelled":true}))))
}
async fn list_import_chunks(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<MigrationImportChunk>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_large_import_service::list_chunks(&s.db, &t, &b, &id).await?,
    )))
}
async fn rollback_import_job(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    let report = migration_service::rollback(&s.db, &t, &b, &id, &c.sub).await?;
    Ok(Json(ApiResponse::ok(
        json!({"rolledBack":true,"deleted":report.deleted_rows,"report":report}),
    )))
}
async fn import_recovery_report(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<MigrationRecoveryReport> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::recovery_report(&s.db, &t, &b, &id).await?,
    )))
}

async fn decide_import_approval(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<MigrationApprovalRequest>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    let approved = request.approved;
    migration_service::decide_approval(&s.db, &t, &b, &id, &c.sub, request).await?;
    Ok(Json(ApiResponse::ok(json!({"approved":approved}))))
}

async fn import_governance_report(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::governance_report(&s.db, &t, &b, &id).await?,
    )))
}

async fn import_failure_assistant(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::failure_assistant(&s.db, &s.settings, &t, &b, &id).await?,
    )))
}

async fn import_monitoring(State(s): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::monitoring(&s.db, &t, &b).await?,
    )))
}

async fn import_rollback_impact(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::rollback_impact(&s.db, &t, &b, &id).await?,
    )))
}

async fn download_import_proof_pack(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let (t, b) = tenant_branch(&headers)?;
    let pack = migration_service::proof_pack(&s.db, &t, &b, &id).await?;
    let content = serde_json::to_vec_pretty(&pack)
        .map_err(|_| AppError::internal("failed to serialize import proof pack"))?;
    attachment_response(content, "application/json", "migration-proof-pack.json")
}

async fn download_import_failed_rows(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let (t, b) = tenant_branch(&headers)?;
    let content = migration_service::failed_rows_csv(&s.db, &t, &b, &id).await?;
    attachment_response(
        content.into_bytes(),
        "text/csv; charset=utf-8",
        "migration-failed-rows.csv",
    )
}

fn attachment_response(
    content: Vec<u8>,
    content_type: &str,
    file_name: &str,
) -> Result<Response, AppError> {
    let mut response = Response::new(Body::from(content));
    for (name, value) in [
        (header::CONTENT_TYPE, content_type.to_string()),
        (
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{file_name}\""),
        ),
        (header::CACHE_CONTROL, "private, no-store".to_string()),
    ] {
        response.headers_mut().insert(
            name,
            HeaderValue::from_str(&value)
                .map_err(|_| AppError::internal("invalid migration download header"))?,
        );
    }
    Ok(response)
}

async fn create_import_upload(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<CreateMigrationUploadRequest>,
) -> ApiResult<MigrationUploadSession> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_file_service::create_upload(&s.db, &t, &b, &c.sub, request).await?,
    )))
}

async fn get_import_upload(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<MigrationUploadSession> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_file_service::get_upload(&s.db, &t, &b, &id).await?,
    )))
}

async fn upload_import_part(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path((id, part_number)): Path<(String, i32)>,
    bytes: Bytes,
) -> ApiResult<MigrationUploadPartReceipt> {
    let (t, b) = tenant_branch(&headers)?;
    let expected = headers
        .get("x-part-sha256")
        .and_then(|value| value.to_str().ok());
    Ok(Json(ApiResponse::ok(
        migration_file_service::upload_part(&s.db, &t, &b, &id, part_number, expected, bytes)
            .await?,
    )))
}

async fn complete_import_upload(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<CompleteMigrationUploadRequest>,
) -> ApiResult<CompleteMigrationUploadResponse> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_file_service::complete_upload(&s.db, &t, &b, &c.sub, &id, request).await?,
    )))
}

async fn list_import_source_files(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<MigrationSourceFile>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_file_service::list_source_files(&s.db, &t, &b).await?,
    )))
}

async fn download_import_source_evidence(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    use tokio::io::AsyncReadExt;
    let (t, b) = tenant_branch(&headers)?;
    let evidence = migration_file_service::open_evidence(&s.db, &t, &b, &c.sub, &id).await?;
    let stream = futures_util::stream::try_unfold(evidence.file, |mut file| async move {
        let mut buffer = vec![0_u8; 64 * 1024];
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            Ok::<_, std::io::Error>(None)
        } else {
            buffer.truncate(read);
            Ok(Some((Bytes::from(buffer), file)))
        }
    });
    let mut response = Response::new(Body::from_stream(stream));
    let values = [
        (header::CONTENT_TYPE, evidence.content_type),
        (header::CONTENT_LENGTH, evidence.size_bytes.to_string()),
        (
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", evidence.file_name),
        ),
        (
            header::HeaderName::from_static("x-content-sha256"),
            evidence.sha256,
        ),
        (header::CACHE_CONTROL, "private, no-store".to_string()),
    ];
    for (name, value) in values {
        response.headers_mut().insert(
            name,
            HeaderValue::from_str(&value)
                .map_err(|_| AppError::internal("invalid migration evidence response header"))?,
        );
    }
    Ok(response)
}
async fn api_clients(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<LimitQuery>,
) -> ApiResult<Vec<Value>> {
    let key = headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if key.is_empty() {
        return Err(AppError::unauthenticated("x-api-key is required"));
    }
    let credential = integration_service::authenticate_api_key(&s.db, key, "clients.read").await?;
    Ok(Json(ApiResponse::ok(
        integration_service::api_clients(&s.db, &credential, q.limit.unwrap_or(100)).await?,
    )))
}
async fn api_appointments(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<LimitQuery>,
) -> ApiResult<Vec<Value>> {
    let key = api_key_header(&headers)?;
    let credential =
        integration_service::authenticate_api_key(&s.db, key, "appointments.read").await?;
    Ok(Json(ApiResponse::ok(
        integration_service::api_appointments(&s.db, &credential, q.limit.unwrap_or(100)).await?,
    )))
}
async fn api_sales(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<LimitQuery>,
) -> ApiResult<Vec<Value>> {
    let key = api_key_header(&headers)?;
    let credential = integration_service::authenticate_api_key(&s.db, key, "sales.read").await?;
    Ok(Json(ApiResponse::ok(
        integration_service::api_sales(&s.db, &credential, q.limit.unwrap_or(100)).await?,
    )))
}
fn api_key_header(headers: &HeaderMap) -> Result<&str, AppError> {
    headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::unauthenticated("x-api-key is required"))
}

async fn openapi() -> Json<Value> {
    Json(json!({
      "openapi":"3.1.0","info":{"title":"AuraShine CRM API","version":"v1"},
      "servers":[{"url":"/api/v1"}],
      "components":{"securitySchemes":{"bearerAuth":{"type":"http","scheme":"bearer","bearerFormat":"JWT"},"apiKey":{"type":"apiKey","in":"header","name":"x-api-key"}},"parameters":{"tenant":{"name":"x-tenant-id","in":"header","required":true,"schema":{"type":"string"}},"branch":{"name":"x-branch-id","in":"header","required":true,"schema":{"type":"string"}}}},
      "paths":{
        "/integrations/v1/clients":{"get":{"security":[{"apiKey":[]}],"summary":"List clients using clients.read scope","parameters":[{"name":"limit","in":"query","schema":{"type":"integer","minimum":1,"maximum":500}}],"responses":{"200":{"description":"Client list"}}}},
        "/integrations/v1/appointments":{"get":{"security":[{"apiKey":[]}],"summary":"List appointments using appointments.read scope","responses":{"200":{"description":"Appointment list"}}}},
        "/integrations/v1/sales":{"get":{"security":[{"apiKey":[]}],"summary":"List sales using sales.read scope","responses":{"200":{"description":"Sale list"}}}},
        "/settings/integrations/api-keys":{"get":{"security":[{"bearerAuth":[]}],"summary":"List scoped API keys","responses":{"200":{"description":"API key list"}}},"post":{"security":[{"bearerAuth":[]}],"summary":"Create scoped API key","responses":{"200":{"description":"Secret returned once"}}}},
        "/settings/integrations/webhooks":{"get":{"security":[{"bearerAuth":[]}],"summary":"List webhook subscriptions","responses":{"200":{"description":"Webhook list"}}},"post":{"security":[{"bearerAuth":[]}],"summary":"Create signed webhook subscription","responses":{"200":{"description":"Signing secret returned once"}}}},
        "/settings/integrations/connectors":{"get":{"security":[{"bearerAuth":[]}],"summary":"List accounting and automation connector status","responses":{"200":{"description":"Connector list without secret material"}}}},
        "/settings/integrations/connectors/{provider}/start":{"post":{"security":[{"bearerAuth":[]}],"summary":"Start OAuth 2.0 PKCE connector authorization","responses":{"200":{"description":"Provider authorization URL"}}}},
        "/settings/integrations/connectors/{provider}/sync":{"post":{"security":[{"bearerAuth":[]}],"summary":"Queue a durable connector verification job","responses":{"200":{"description":"Queued sync job"}}}},
        "/pos/z-reports/{date}/export":{"get":{"security":[{"bearerAuth":[]}],"summary":"Export accounting data as JSON, CSV, or Tally XML","parameters":[{"name":"date","in":"path","required":true,"schema":{"type":"string","format":"date"}},{"name":"format","in":"query","schema":{"type":"string","enum":["json","csv","tally"]}}],"responses":{"200":{"description":"Accounting export"}}}}
      }
    }))
}
