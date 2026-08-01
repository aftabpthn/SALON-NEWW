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
            AnalyzeMigrationRequest, ApproveMigrationMappingRequest, CreateImportJobRequest,
            CreateLargeImportJobRequest, CreateMigrationCutoverRequest,
            HistoricalPurchaseMappingDecision, HistoricalPurchaseMappingDecisionRequest,
            HistoricalPurchaseMappingKind, ImportJob, MigrationAlias, MigrationAnalysisReport,
            MigrationApprovalRequest, MigrationCutover, MigrationCutoverStatus,
            MigrationImportChunk, MigrationMapping, MigrationMappingApproval,
            MigrationMappingSuggestionRequest, MigrationMappingVersion, MigrationRecoveryReport,
            MigrationSelectiveRetryRequest, MigrationTemplate,
            OpeningPayableControlsApprovalRequest, SaveMigrationAliasRequest,
            SaveMigrationMappingRequest, TransitionMigrationCutoverRequest,
        },
        migration_file::{
            CompleteMigrationUploadRequest, CompleteMigrationUploadResponse,
            CreateMigrationUploadRequest, HistoricalEvidenceCorrectionRequest,
            HistoricalEvidenceCutoverApprovalRequest, HistoricalEvidenceGroupDecisionRequest,
            MigrationSourceFile, MigrationSourceProfile, MigrationUploadPartReceipt,
            MigrationUploadSession,
        },
    },
    routes::{
        context::tenant_branch,
        security::{require_security_manage, require_security_read},
    },
    services::{
        auth_service::AuthClaims,
        integration_service, migration_file_service, migration_large_import_service,
        migration_service,
        purchase_bill_drafts_service::{
            self as purchase_bill_drafts, HistoricalBulkArchiveInput, HistoricalBulkStartInput,
            HistoricalPilotDocumentInput,
        },
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
            "/settings/integrations/connectors/:provider/credentials",
            post(connect_migration_provider),
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
            "/settings/integrations/historical-purchase-bills",
            get(list_historical_purchase_bills),
        )
        .route(
            "/settings/integrations/historical-purchase-bills/:id",
            get(historical_purchase_bill_detail),
        )
        .route(
            "/settings/integrations/historical-purchase-evidence",
            get(historical_purchase_evidence_report),
        )
        .route(
            "/settings/integrations/historical-purchase-evidence/group-decisions",
            post(decide_historical_purchase_evidence_group),
        )
        .route(
            "/settings/integrations/historical-purchase-evidence/:source_file_id/corrections",
            post(correct_historical_purchase_evidence),
        )
        .route(
            "/settings/integrations/historical-purchase-evidence/cutover-approval",
            post(approve_historical_purchase_evidence_cutover),
        )
        .route(
            "/settings/integrations/historical-purchase-pilot",
            get(historical_purchase_pilot_report).post(start_historical_purchase_pilot),
        )
        .route(
            "/settings/integrations/historical-purchase-pilot/group-decisions",
            post(decide_historical_purchase_pilot_group),
        )
        .route(
            "/settings/integrations/historical-purchase-bulk",
            get(historical_purchase_bulk_report).post(start_historical_purchase_bulk),
        )
        .route(
            "/settings/integrations/historical-purchase-bulk/:id/archive",
            post(archive_historical_purchase_bulk),
        )
        .route(
            "/settings/integrations/historical-purchase-mapping-report",
            get(historical_purchase_mapping_report),
        )
        .route(
            "/settings/integrations/historical-purchase-mappings/:kind",
            get(list_historical_purchase_mappings),
        )
        .route(
            "/settings/integrations/historical-purchase-mappings/:kind/:source_key/decisions",
            post(decide_historical_purchase_mapping),
        )
        .route(
            "/settings/integrations/historical-purchase-mappings/:kind/:source_key/versions",
            get(list_historical_purchase_mapping_versions),
        )
        .route(
            "/settings/integrations/historical-purchase-mappings/:kind/:source_key/rollback/:version",
            post(rollback_historical_purchase_mapping),
        )
        .route(
            "/settings/integrations/migration-cutovers/active",
            get(active_migration_cutover),
        )
        .route(
            "/settings/integrations/migration-cutovers",
            post(save_migration_cutover),
        )
        .route(
            "/settings/integrations/migration-cutovers/:id/transition",
            post(transition_migration_cutover),
        )
        .route(
            "/settings/integrations/migration-cutovers/:id/proof-pack",
            get(download_cutover_proof_pack),
        )
        .route(
            "/settings/integrations/import-templates",
            get(import_templates),
        )
        .route(
            "/settings/integrations/import-adapters",
            get(import_adapters),
        )
        .route(
            "/settings/integrations/import-mappings",
            get(list_import_mappings).post(save_import_mapping),
        )
        .route(
            "/settings/integrations/import-mappings/:id/versions",
            get(list_import_mapping_versions),
        )
        .route(
            "/settings/integrations/import-mappings/:id/rollback/:version",
            post(rollback_import_mapping),
        )
        .route(
            "/settings/integrations/import-aliases",
            get(list_import_aliases).post(save_import_alias),
        )
        .route(
            "/settings/integrations/import-mapping-suggestions",
            post(import_mapping_suggestions),
        )
        .route(
            "/settings/integrations/import-mapping-approvals",
            post(approve_import_mapping),
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
            "/settings/integrations/import-jobs/:id/opening-payable-controls",
            post(approve_opening_payable_controls),
        )
        .route(
            "/settings/integrations/import-jobs/:id/opening-payable-branch-confirmation",
            post(confirm_opening_payable_branch),
        )
        .route(
            "/settings/integrations/import-jobs/:id/yellow-approval",
            post(approve_import_yellow_warnings),
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
            "/settings/integrations/import-jobs/:id/error-exports/:kind",
            get(download_import_error_export),
        )
        .route(
            "/settings/integrations/import-jobs/:id/quarantine/retry",
            post(retry_import_quarantine),
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
        .route(
            "/settings/integrations/import-source-files/:id/profile",
            get(profile_import_source),
        )
}

pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/openapi.json", get(openapi))
        .route("/integrations/v1/clients", get(api_clients))
        .route("/integrations/v1/appointments", get(api_appointments))
        .route("/integrations/v1/sales", get(api_sales))
        .route("/integrations/v1/staff", get(api_staff))
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
    #[serde(default)]
    ip_allowlist: Vec<String>,
    rate_limit_per_minute: Option<i32>,
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
struct HistoricalEvidenceQuery {
    cutover_id: String,
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
        json!({"provider":"auto","label":"Automatic detection","formats":["xlsx","csv","zip"],"status":"ready"}),
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
async fn connect_migration_provider(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(provider): Path<String>,
    Json(request): Json<integration_service::MigrationConnectorWrite>,
) -> ApiResult<crate::repositories::integration_repository::ConnectorSyncJob> {
    require_security_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    let provider = integration_service::ConnectorProvider::parse(&provider)?;
    Ok(Json(ApiResponse::ok(
        integration_service::connect_migration_provider(
            &s.db,
            &s.settings,
            &t,
            &b,
            &c.sub,
            provider,
            request,
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
            p.ip_allowlist,
            p.rate_limit_per_minute,
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
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<ImportJob>> {
    require_migration_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::list_jobs(&s.db, &t, &b).await?,
    )))
}
async fn list_historical_purchase_bills(
    State(s): State<AppState>,
    headers: HeaderMap,
    Extension(c): Extension<AuthClaims>,
) -> ApiResult<Vec<Value>> {
    require_historical_financial_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::historical_purchase_bills(&s.db, &t, &b).await?,
    )))
}

async fn historical_purchase_bill_detail(
    State(s): State<AppState>,
    headers: HeaderMap,
    Extension(c): Extension<AuthClaims>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_historical_financial_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::historical_purchase_bill(&s.db, &t, &b, &id).await?,
    )))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoricalMappingQuery {
    #[serde(default)]
    provider: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoricalPilotStartRequest {
    cutover_id: String,
    documents: Vec<HistoricalPilotDocumentInput>,
}

async fn historical_purchase_evidence_report(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<HistoricalEvidenceQuery>,
) -> ApiResult<Value> {
    require_migration_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_file_service::historical_evidence_report(&s.db, &t, &b, &query.cutover_id)
            .await?,
    )))
}

async fn decide_historical_purchase_evidence_group(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<HistoricalEvidenceGroupDecisionRequest>,
) -> ApiResult<Value> {
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_file_service::decide_historical_evidence_group(&s.db, &t, &b, &c.sub, request)
            .await?,
    )))
}

async fn correct_historical_purchase_evidence(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(source_file_id): Path<String>,
    Json(request): Json<HistoricalEvidenceCorrectionRequest>,
) -> ApiResult<Value> {
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_file_service::correct_historical_evidence(
            &s.db,
            &t,
            &b,
            &c.sub,
            &source_file_id,
            request,
        )
        .await?,
    )))
}

async fn approve_historical_purchase_evidence_cutover(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<HistoricalEvidenceCutoverApprovalRequest>,
) -> ApiResult<Value> {
    require_migration_manage(&c)?;
    require_cutover_owner(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_file_service::approve_historical_evidence_cutover(
            &s.db,
            &t,
            &b,
            &c.sub,
            &c.role,
            &request.cutover_id,
        )
        .await?,
    )))
}

async fn historical_purchase_pilot_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<HistoricalEvidenceQuery>,
) -> ApiResult<Value> {
    require_migration_read(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        purchase_bill_drafts::historical_pilot_report(&state, &tenant, &branch, &query.cutover_id)
            .await?,
    )))
}

async fn start_historical_purchase_pilot(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<HistoricalPilotStartRequest>,
) -> ApiResult<Value> {
    require_migration_manage(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        purchase_bill_drafts::start_historical_pilot(
            &state,
            &tenant,
            &branch,
            &claims.sub,
            &request.cutover_id,
            request.documents,
        )
        .await?,
    )))
}

async fn decide_historical_purchase_pilot_group(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<HistoricalEvidenceGroupDecisionRequest>,
) -> ApiResult<Value> {
    require_migration_manage(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        purchase_bill_drafts::decide_historical_pilot_group(
            &state,
            &tenant,
            &branch,
            &claims.sub,
            request,
        )
        .await?,
    )))
}

async fn historical_purchase_bulk_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<HistoricalEvidenceQuery>,
) -> ApiResult<Value> {
    require_migration_read(&claims)?;
    require_historical_financial_read(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        purchase_bill_drafts::historical_bulk_report(&state, &tenant, &branch, &query.cutover_id)
            .await?,
    )))
}

async fn start_historical_purchase_bulk(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<HistoricalBulkStartInput>,
) -> ApiResult<Value> {
    require_migration_manage(&claims)?;
    require_historical_financial_read(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        purchase_bill_drafts::start_historical_bulk(&state, &tenant, &branch, &claims.sub, request)
            .await?,
    )))
}

async fn archive_historical_purchase_bulk(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<HistoricalBulkArchiveInput>,
) -> ApiResult<Value> {
    require_migration_manage(&claims)?;
    require_historical_financial_read(&claims)?;
    require_cutover_owner(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        purchase_bill_drafts::archive_historical_bulk(
            &state,
            &tenant,
            &branch,
            &claims.sub,
            &id,
            request,
        )
        .await?,
    )))
}

async fn list_historical_purchase_mappings(
    State(s): State<AppState>,
    headers: HeaderMap,
    Extension(c): Extension<AuthClaims>,
    Path(kind): Path<HistoricalPurchaseMappingKind>,
    Query(query): Query<HistoricalMappingQuery>,
) -> ApiResult<Vec<Value>> {
    require_historical_financial_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::historical_purchase_mapping_sources(
            &s.db,
            &t,
            &b,
            kind,
            &query.provider,
        )
        .await?,
    )))
}

async fn historical_purchase_mapping_report(
    State(s): State<AppState>,
    headers: HeaderMap,
    Extension(c): Extension<AuthClaims>,
) -> ApiResult<Value> {
    require_historical_financial_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::historical_purchase_mapping_report(&s.db, &t, &b).await?,
    )))
}

async fn decide_historical_purchase_mapping(
    State(s): State<AppState>,
    headers: HeaderMap,
    Extension(c): Extension<AuthClaims>,
    Path((kind, source_key)): Path<(HistoricalPurchaseMappingKind, String)>,
    Query(query): Query<HistoricalMappingQuery>,
    Json(request): Json<HistoricalPurchaseMappingDecisionRequest>,
) -> ApiResult<Value> {
    require_migration_manage(&c)?;
    require_historical_financial_read(&c)?;
    if matches!(request.decision, HistoricalPurchaseMappingDecision::Create) {
        require_historical_catalog_create(&c, kind)?;
    }
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::decide_historical_purchase_mapping(
            &s.db,
            &t,
            &b,
            kind,
            &query.provider,
            &source_key,
            request,
            &c.sub,
        )
        .await?,
    )))
}

async fn rollback_historical_purchase_mapping(
    State(s): State<AppState>,
    headers: HeaderMap,
    Extension(c): Extension<AuthClaims>,
    Path((kind, source_key, version)): Path<(HistoricalPurchaseMappingKind, String, i32)>,
    Query(query): Query<HistoricalMappingQuery>,
) -> ApiResult<Value> {
    require_migration_manage(&c)?;
    require_historical_financial_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::rollback_historical_purchase_mapping(
            &s.db,
            &t,
            &b,
            kind,
            &query.provider,
            &source_key,
            version,
            &c.sub,
        )
        .await?,
    )))
}

async fn list_historical_purchase_mapping_versions(
    State(s): State<AppState>,
    headers: HeaderMap,
    Extension(c): Extension<AuthClaims>,
    Path((kind, source_key)): Path<(HistoricalPurchaseMappingKind, String)>,
    Query(query): Query<HistoricalMappingQuery>,
) -> ApiResult<Vec<Value>> {
    require_historical_financial_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::historical_purchase_mapping_versions(
            &s.db,
            &t,
            &b,
            kind,
            &query.provider,
            &source_key,
        )
        .await?,
    )))
}

async fn import_templates() -> ApiResult<Vec<MigrationTemplate>> {
    Ok(Json(ApiResponse::ok(migration_service::templates())))
}
async fn import_adapters() -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(vec![
        json!({"provider":"zenoti","label":"Zenoti","formats":["xlsx","csv","zip"],"status":"ready"}),
        json!({"provider":"dingg","label":"DINGG","formats":["xlsx","csv","zip"],"status":"ready"}),
        json!({"provider":"salonist","label":"Salonist","formats":["xlsx","csv","zip"],"status":"ready"}),
        json!({"provider":"fresha","label":"Fresha","formats":["xlsx","csv","zip"],"status":"ready"}),
        json!({"provider":"tally","label":"Tally","formats":["xlsx","csv","zip"],"status":"ready"}),
        json!({"provider":"busy","label":"BUSY","formats":["xlsx","csv","zip"],"status":"ready"}),
        json!({"provider":"marg","label":"Marg","formats":["xlsx","csv","zip"],"status":"ready"}),
        json!({"provider":"excel","label":"Excel","formats":["xlsx","zip"],"status":"ready"}),
        json!({"provider":"csv","label":"CSV","formats":["csv","zip"],"status":"ready"}),
        json!({"provider":"manual","label":"Manual mapping","formats":["xlsx","csv","zip"],"status":"ready"}),
    ])))
}
async fn list_import_mappings(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<MigrationMapping>> {
    require_migration_read(&c)?;
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
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::save_mapping(&s.db, &t, &b, &c.sub, request).await?,
    )))
}

async fn list_import_aliases(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<MigrationAlias>> {
    require_migration_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::list_aliases(&s.db, &t, &b).await?,
    )))
}

async fn save_import_alias(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<SaveMigrationAliasRequest>,
) -> ApiResult<MigrationAlias> {
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::save_alias(&s.db, &t, &b, &c.sub, request).await?,
    )))
}

async fn import_mapping_suggestions(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<MigrationMappingSuggestionRequest>,
) -> ApiResult<Value> {
    require_migration_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::mapping_suggestions(&s.db, &s.settings, &t, &b, &c.sub, request).await?,
    )))
}

async fn approve_import_mapping(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<ApproveMigrationMappingRequest>,
) -> ApiResult<MigrationMappingApproval> {
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::approve_mapping(&s.db, &t, &b, &c.sub, request).await?,
    )))
}

fn require_migration_read(claims: &AuthClaims) -> Result<(), AppError> {
    if claims
        .denied_permissions
        .iter()
        .any(|item| item == "data_migration.read")
    {
        return Err(AppError::forbidden("data migration permission is required"));
    }
    let manage_granted = !claims
        .denied_permissions
        .iter()
        .any(|item| item == "data_migration.manage")
        && claims
            .permissions
            .iter()
            .any(|item| item == "data_migration.manage");
    let default_role = matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager" | "superadmin" | "super-admin"
    );
    if default_role
        || manage_granted
        || claims
            .permissions
            .iter()
            .any(|item| item == "data_migration.read")
    {
        Ok(())
    } else {
        Err(AppError::forbidden("data migration permission is required"))
    }
}

fn require_migration_manage(claims: &AuthClaims) -> Result<(), AppError> {
    require_migration_permission(claims, "data_migration.manage")
}

fn require_historical_catalog_create(
    claims: &AuthClaims,
    kind: HistoricalPurchaseMappingKind,
) -> Result<(), AppError> {
    let role = claims.role.to_ascii_lowercase();
    if matches!(
        role.as_str(),
        "owner" | "admin" | "superadmin" | "super-admin"
    ) {
        return Ok(());
    }
    let required = match kind {
        HistoricalPurchaseMappingKind::Product => ["inventory.manage", "inventory.write"],
        HistoricalPurchaseMappingKind::Vendor => ["purchases.manage", "inventory.manage"],
    };
    if required.iter().any(|permission| {
        !claims
            .denied_permissions
            .iter()
            .any(|denied| denied == permission)
            && claims
                .permissions
                .iter()
                .any(|granted| granted == permission)
    }) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "catalog create permission is required for this mapping decision",
        ))
    }
}

fn require_migration_export(claims: &AuthClaims) -> Result<(), AppError> {
    require_sensitive_migration_permission(claims, "data_migration.export")
}

fn require_historical_financial_read(claims: &AuthClaims) -> Result<(), AppError> {
    require_migration_read(claims)?;
    require_sensitive_migration_permission(claims, "data_migration.historical_financial")
}

fn require_sensitive_migration_permission(
    claims: &AuthClaims,
    permission: &str,
) -> Result<(), AppError> {
    let denied = claims
        .denied_permissions
        .iter()
        .any(|item| item == permission);
    let privileged_role = matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "superadmin" | "super-admin"
    );
    let granted = claims.permissions.iter().any(|item| item == permission);
    if !denied && (privileged_role || granted) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "sensitive data migration permission is required",
        ))
    }
}

fn require_cutover_owner(claims: &AuthClaims) -> Result<(), AppError> {
    if matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "superadmin" | "super-admin"
    ) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "Owner approval is required for freeze and go-live",
        ))
    }
}

fn require_opening_payable_finance(claims: &AuthClaims) -> Result<(), AppError> {
    require_migration_manage(claims)?;
    let denied = claims
        .denied_permissions
        .iter()
        .any(|item| item == "finance.write");
    let role_allowed = matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "superadmin" | "super-admin"
    );
    if !denied
        && (role_allowed
            || claims
                .permissions
                .iter()
                .any(|item| item == "finance.write"))
    {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "finance approval permission is required",
        ))
    }
}

fn require_opening_payable_branch_manager(claims: &AuthClaims) -> Result<(), AppError> {
    require_migration_manage(claims)?;
    if claims.role.eq_ignore_ascii_case("manager") {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "Branch Manager confirmation is required",
        ))
    }
}

fn require_migration_permission(claims: &AuthClaims, permission: &str) -> Result<(), AppError> {
    let denied = claims
        .denied_permissions
        .iter()
        .any(|item| item == permission);
    let default_role = matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager" | "superadmin" | "super-admin"
    );
    let granted = claims.permissions.iter().any(|item| item == permission);
    if !denied && (default_role || granted) {
        Ok(())
    } else {
        Err(AppError::forbidden("data migration permission is required"))
    }
}

async fn active_migration_cutover(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Option<MigrationCutover>> {
    require_migration_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::active_cutover(&s.db, &t, &b).await?,
    )))
}

async fn save_migration_cutover(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<CreateMigrationCutoverRequest>,
) -> ApiResult<MigrationCutover> {
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::save_cutover(&s.db, &t, &b, &c.sub, &c.role, request).await?,
    )))
}

async fn transition_migration_cutover(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<TransitionMigrationCutoverRequest>,
) -> ApiResult<MigrationCutover> {
    require_migration_manage(&c)?;
    if matches!(
        request.target_status,
        MigrationCutoverStatus::InventoryFrozen
            | MigrationCutoverStatus::SnapshotApproved
            | MigrationCutoverStatus::Live
    ) {
        require_cutover_owner(&c)?;
    }
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::transition_cutover(&s.db, &t, &b, &id, &c.sub, &c.role, request).await?,
    )))
}

async fn download_cutover_proof_pack(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    require_migration_export(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    let pack = migration_service::cutover_proof_pack(&s.db, &s.settings, &t, &b, &id).await?;
    let content = serde_json::to_vec_pretty(&pack)
        .map_err(|_| AppError::internal("failed to serialize cutover proof pack"))?;
    attachment_response(
        content,
        "application/json",
        "migration-cutover-proof-pack.json",
    )
}

async fn analyze_import(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<AnalyzeMigrationRequest>,
) -> ApiResult<MigrationAnalysisReport> {
    if request.duplicate_decisions.is_empty() {
        require_migration_read(&c)?;
    } else {
        require_migration_manage(&c)?;
    }
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
    require_migration_manage(&c)?;
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
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_large_import_service::create_job(&s.db, &t, &b, &c.sub, request).await?,
    )))
}

async fn profile_import_source(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<MigrationSourceProfile> {
    require_migration_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_file_service::source_profile(&s.db, &t, &b, &c.sub, &id).await?,
    )))
}
async fn pause_import_job(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_migration_manage(&c)?;
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
    require_migration_manage(&c)?;
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
    require_migration_manage(&c)?;
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
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    migration_large_import_service::cancel(&s.db, &t, &b, &id, &c.sub).await?;
    Ok(Json(ApiResponse::ok(json!({"cancelled":true}))))
}
async fn list_import_chunks(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<MigrationImportChunk>> {
    require_migration_read(&c)?;
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
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    let report = migration_service::rollback(&s.db, &t, &b, &id, &c.sub).await?;
    Ok(Json(ApiResponse::ok(
        json!({"rolledBack":true,"deleted":report.deleted_rows,"report":report}),
    )))
}
async fn import_recovery_report(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<MigrationRecoveryReport> {
    require_migration_read(&c)?;
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
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    let approved = request.approved;
    let opening_payable = migration_service::governance_report(&s.db, &t, &b, &id)
        .await?
        .pointer("/job/entity")
        .and_then(Value::as_str)
        == Some("opening-payables");
    if opening_payable {
        require_cutover_owner(&c)?;
    }
    migration_service::decide_approval(&s.db, &t, &b, &id, &c.sub, request).await?;
    Ok(Json(ApiResponse::ok(json!({"approved":approved}))))
}

async fn approve_opening_payable_controls(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<OpeningPayableControlsApprovalRequest>,
) -> ApiResult<Value> {
    require_opening_payable_finance(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    migration_service::approve_opening_payable_controls(&s.db, &t, &b, &id, &c.sub, request)
        .await?;
    Ok(Json(ApiResponse::ok(json!({"approved":true}))))
}

async fn confirm_opening_payable_branch(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<MigrationApprovalRequest>,
) -> ApiResult<Value> {
    require_opening_payable_branch_manager(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    let confirmed = request.approved;
    migration_service::confirm_opening_payable_branch(&s.db, &t, &b, &id, &c.sub, request).await?;
    Ok(Json(ApiResponse::ok(json!({"confirmed":confirmed}))))
}

async fn list_import_mapping_versions(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<MigrationMappingVersion>> {
    require_migration_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::list_mapping_versions(&s.db, &t, &b, &id).await?,
    )))
}

async fn rollback_import_mapping(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, version)): Path<(String, i32)>,
) -> ApiResult<MigrationMapping> {
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::rollback_mapping(&s.db, &t, &b, &id, version, &c.sub).await?,
    )))
}

async fn approve_import_yellow_warnings(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    migration_service::approve_yellow_warnings(&s.db, &t, &b, &id, &c.sub).await?;
    Ok(Json(ApiResponse::ok(json!({"approved":true}))))
}

async fn import_governance_report(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_migration_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::governance_report(&s.db, &t, &b, &id).await?,
    )))
}

async fn import_failure_assistant(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_migration_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::failure_assistant(&s.db, &s.settings, &t, &b, &id).await?,
    )))
}

async fn import_monitoring(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    require_migration_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::monitoring(&s.db, &t, &b).await?,
    )))
}

async fn import_rollback_impact(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_migration_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_service::rollback_impact(&s.db, &t, &b, &id).await?,
    )))
}

async fn download_import_proof_pack(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    require_migration_export(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    let pack = migration_service::proof_pack(&s.db, &s.settings, &t, &b, &id).await?;
    let content = serde_json::to_vec_pretty(&pack)
        .map_err(|_| AppError::internal("failed to serialize import proof pack"))?;
    attachment_response(content, "application/json", "migration-proof-pack.json")
}

async fn download_import_failed_rows(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    require_migration_export(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    let content = migration_service::failed_rows_csv(&s.db, &t, &b, &id).await?;
    attachment_response(
        content.into_bytes(),
        "text/csv; charset=utf-8",
        "migration-failed-rows.csv",
    )
}

async fn download_import_error_export(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, kind)): Path<(String, String)>,
) -> Result<Response, AppError> {
    require_migration_export(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    let content = migration_service::error_export_csv(&s.db, &t, &b, &id, &kind).await?;
    attachment_response(
        content.into_bytes(),
        "text/csv; charset=utf-8",
        &format!("migration-{kind}.csv"),
    )
}

async fn retry_import_quarantine(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<MigrationSelectiveRetryRequest>,
) -> ApiResult<Value> {
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_large_import_service::selective_retry(&s.db, &t, &b, &id, &c.sub, request)
            .await?,
    )))
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
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_file_service::create_upload(&s.db, &t, &b, &c.sub, request).await?,
    )))
}

async fn get_import_upload(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<MigrationUploadSession> {
    require_migration_read(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_file_service::get_upload(&s.db, &t, &b, &id).await?,
    )))
}

async fn upload_import_part(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, part_number)): Path<(String, i32)>,
    bytes: Bytes,
) -> ApiResult<MigrationUploadPartReceipt> {
    require_migration_manage(&c)?;
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
    require_migration_manage(&c)?;
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        migration_file_service::complete_upload(&s.db, &t, &b, &c.sub, &id, request).await?,
    )))
}

async fn list_import_source_files(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<MigrationSourceFile>> {
    require_migration_read(&c)?;
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
    require_migration_export(&c)?;
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
    let credential = authenticate_api_request(&s, &headers, "clients.read").await?;
    Ok(Json(ApiResponse::ok(
        integration_service::api_clients(&s.db, &credential, q.limit.unwrap_or(100)).await?,
    )))
}
async fn api_appointments(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<LimitQuery>,
) -> ApiResult<Vec<Value>> {
    let credential = authenticate_api_request(&s, &headers, "appointments.read").await?;
    Ok(Json(ApiResponse::ok(
        integration_service::api_appointments(&s.db, &credential, q.limit.unwrap_or(100)).await?,
    )))
}
async fn api_sales(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<LimitQuery>,
) -> ApiResult<Vec<Value>> {
    let credential = authenticate_api_request(&s, &headers, "sales.read").await?;
    Ok(Json(ApiResponse::ok(
        integration_service::api_sales(&s.db, &credential, q.limit.unwrap_or(100)).await?,
    )))
}
async fn api_staff(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<LimitQuery>,
) -> ApiResult<Vec<Value>> {
    let credential = authenticate_api_request(&s, &headers, "staff.read").await?;
    Ok(Json(ApiResponse::ok(
        integration_service::api_staff(&s.db, &credential, q.limit.unwrap_or(100)).await?,
    )))
}
async fn authenticate_api_request(
    state: &AppState,
    headers: &HeaderMap,
    scope: &str,
) -> Result<crate::repositories::integration_repository::ApiKeyCredential, AppError> {
    integration_service::authenticate_api_key(
        &state.db,
        &state.redis,
        api_key_header(headers)?,
        scope,
        headers
            .get("x-aurashine-source-ip")
            .and_then(|value| value.to_str().ok()),
    )
    .await
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
        "/integrations/v1/staff":{"get":{"security":[{"apiKey":[]}],"summary":"List staff directory using staff.read scope","responses":{"200":{"description":"Staff list"}}}},
        "/settings/integrations/api-keys":{"get":{"security":[{"bearerAuth":[]}],"summary":"List scoped API keys","responses":{"200":{"description":"API key list"}}},"post":{"security":[{"bearerAuth":[]}],"summary":"Create scoped API key","responses":{"200":{"description":"Secret returned once"}}}},
        "/settings/integrations/webhooks":{"get":{"security":[{"bearerAuth":[]}],"summary":"List webhook subscriptions","responses":{"200":{"description":"Webhook list"}}},"post":{"security":[{"bearerAuth":[]}],"summary":"Create signed webhook subscription","responses":{"200":{"description":"Signing secret returned once"}}}},
        "/settings/integrations/connectors":{"get":{"security":[{"bearerAuth":[]}],"summary":"List accounting and automation connector status","responses":{"200":{"description":"Connector list without secret material"}}}},
        "/settings/integrations/connectors/{provider}/start":{"post":{"security":[{"bearerAuth":[]}],"summary":"Start OAuth 2.0 PKCE connector authorization","responses":{"200":{"description":"Provider authorization URL"}}}},
        "/settings/integrations/connectors/{provider}/sync":{"post":{"security":[{"bearerAuth":[]}],"summary":"Queue a durable connector verification job","responses":{"200":{"description":"Queued sync job"}}}},
        "/settings/integrations/import-aliases":{"get":{"security":[{"bearerAuth":[]}],"summary":"List tenant-approved migration aliases","responses":{"200":{"description":"Scoped alias list"}}},"post":{"security":[{"bearerAuth":[]}],"summary":"Approve a tenant migration alias","responses":{"200":{"description":"Approved alias"}}}},
        "/pos/z-reports/{date}/export":{"get":{"security":[{"bearerAuth":[]}],"summary":"Export accounting data as JSON, CSV, or Tally XML","parameters":[{"name":"date","in":"path","required":true,"schema":{"type":"string","format":"date"}},{"name":"format","in":"query","schema":{"type":"string","enum":["json","csv","tally"]}}],"responses":{"200":{"description":"Accounting export"}}}}
      }
    }))
}

#[cfg(test)]
mod migration_permission_tests {
    use super::*;

    fn claims(role: &str, permissions: &[&str], denied: &[&str]) -> AuthClaims {
        AuthClaims {
            sub: "user".into(),
            tenant_id: "tenant".into(),
            branch_id: Some("branch".into()),
            role: role.into(),
            role_id: None,
            permissions: permissions.iter().map(|value| (*value).into()).collect(),
            denied_permissions: denied.iter().map(|value| (*value).into()).collect(),
            masked_fields: Vec::new(),
            max_discount_paise: None,
            max_refund_paise: None,
            max_cash_movement_paise: None,
            permission_version: 1,
            session_id: "session".into(),
            mfa_enrollment_required: false,
            token_type: "access".into(),
            jti: "jti".into(),
            iat: 0,
            exp: usize::MAX,
        }
    }

    #[test]
    fn sensitive_migration_access_requires_privileged_role_or_explicit_permission() {
        assert!(require_migration_export(&claims("owner", &[], &[])).is_ok());
        assert!(require_migration_export(&claims("manager", &[], &[])).is_err());
        assert!(
            require_migration_export(&claims("staff", &["data_migration.export"], &[])).is_ok()
        );
        assert!(
            require_migration_export(&claims("owner", &[], &["data_migration.export"])).is_err()
        );
    }

    #[test]
    fn opening_payable_branch_confirmation_requires_manager_role() {
        assert!(require_opening_payable_branch_manager(&claims("manager", &[], &[])).is_ok());
        assert!(require_opening_payable_branch_manager(&claims("owner", &[], &[])).is_err());
        assert!(require_opening_payable_branch_manager(&claims(
            "manager",
            &[],
            &["data_migration.manage"]
        ))
        .is_err());
    }
}
