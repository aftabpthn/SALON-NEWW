use std::collections::BTreeSet;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post, put},
    Extension, Json, Router,
};

use crate::{
    config::is_local_env,
    models::{
        balance_sheet::{
            AccountDefinition, AccountingActionResponse, AccountingPeriodResponse, AsOfQuery,
            BalanceSheetReport, CostCenterCreateRequest, CostCenterResponse,
            DeferredRecognitionRequest, DeferredRevenueScheduleResponse, DepreciationRequest,
            FinanceHardeningStatus, FixedAssetCreateRequest, FixedAssetResponse,
            JournalLineCostCenterRequest, JournalLineCostCenterResponse, LedgerPage, LedgerQuery,
            ManualJournalRequest, ManualJournalResponse, PeriodCloseRequest, PeriodReopenRequest,
            SnapshotRequest, SnapshotResponse, WorkingCapitalReport,
        },
        common::{ApiResponse, ApiResult, AppError},
    },
    repositories::auth_repository,
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, balance_sheet_service, branch_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/balance-sheet/accounts", get(accounts))
        .route("/balance-sheet/live", get(live))
        .route("/balance-sheet/working-capital", get(working_capital))
        .route("/balance-sheet/ledger", get(ledger))
        .route("/balance-sheet/journals", post(create_manual_journal))
        .route(
            "/balance-sheet/cost-centers",
            get(list_cost_centers).post(create_cost_center),
        )
        .route(
            "/balance-sheet/journal-lines/:line_id/cost-center",
            put(tag_journal_line),
        )
        .route(
            "/balance-sheet/fixed-assets",
            get(list_fixed_assets).post(create_fixed_asset),
        )
        .route(
            "/balance-sheet/fixed-assets/:asset_id/depreciation",
            post(depreciate_fixed_asset),
        )
        .route(
            "/balance-sheet/deferred-revenue",
            get(list_deferred_revenue),
        )
        .route(
            "/balance-sheet/deferred-revenue/:schedule_id/recognize",
            post(recognize_deferred_revenue),
        )
        .route("/balance-sheet/periods", get(list_accounting_periods))
        .route(
            "/balance-sheet/periods/close",
            post(close_accounting_period),
        )
        .route(
            "/balance-sheet/periods/:period/reopen",
            post(reopen_accounting_period),
        )
        .route("/balance-sheet/reconciliation", get(finance_reconciliation))
        .route(
            "/balance-sheet/hardening-status",
            get(finance_reconciliation),
        )
        .route("/balance-sheet/snapshots", post(create_snapshot))
}

async fn accounts(headers: HeaderMap) -> ApiResult<Vec<AccountDefinition>> {
    tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(balance_sheet_service::accounts())))
}

async fn live(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<AsOfQuery>,
) -> ApiResult<BalanceSheetReport> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let branch_ids = balance_scope_branch_ids(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        query.scope.as_deref().unwrap_or("branch"),
    )
    .await?;
    let report = balance_sheet_service::live_for_branches(
        &state.db,
        &tenant_id,
        &branch_ids,
        query.as_of_date.as_deref(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(report)))
}

async fn working_capital(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<AsOfQuery>,
) -> ApiResult<WorkingCapitalReport> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let branch_ids = balance_scope_branch_ids(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        query.scope.as_deref().unwrap_or("branch"),
    )
    .await?;
    let report = balance_sheet_service::working_capital_for_branches(
        &state.db,
        &tenant_id,
        &branch_ids,
        query.as_of_date.as_deref(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(report)))
}

async fn ledger(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<LedgerQuery>,
) -> ApiResult<LedgerPage> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = balance_sheet_service::ledger(&state.db, &tenant_id, &branch_id, query).await?;
    Ok(Json(ApiResponse::ok(page)))
}

async fn create_manual_journal(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ManualJournalRequest>,
) -> ApiResult<ManualJournalResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = balance_sheet_service::create_manual_journal(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn list_cost_centers(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<CostCenterResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = balance_sheet_service::list_cost_centers(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_cost_center(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<CostCenterCreateRequest>,
) -> ApiResult<CostCenterResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = balance_sheet_service::create_cost_center(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn tag_journal_line(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(line_id): Path<String>,
    Json(payload): Json<JournalLineCostCenterRequest>,
) -> ApiResult<JournalLineCostCenterResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = balance_sheet_service::tag_journal_line(
        &state.db,
        &tenant_id,
        &branch_id,
        &line_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn create_snapshot(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<SnapshotRequest>,
) -> ApiResult<SnapshotResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = balance_sheet_service::create_snapshot(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload.as_of_date.as_deref(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn list_fixed_assets(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<FixedAssetResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = balance_sheet_service::list_fixed_assets(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_fixed_asset(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<FixedAssetCreateRequest>,
) -> ApiResult<FixedAssetResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = balance_sheet_service::create_fixed_asset(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn depreciate_fixed_asset(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(asset_id): Path<String>,
    Json(payload): Json<DepreciationRequest>,
) -> ApiResult<AccountingActionResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = balance_sheet_service::depreciate_fixed_asset(
        &state.db,
        &tenant_id,
        &branch_id,
        &asset_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn list_deferred_revenue(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<DeferredRevenueScheduleResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        balance_sheet_service::list_deferred_revenue_schedules(&state.db, &tenant_id, &branch_id)
            .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn recognize_deferred_revenue(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(schedule_id): Path<String>,
    Json(payload): Json<DeferredRecognitionRequest>,
) -> ApiResult<AccountingActionResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = balance_sheet_service::recognize_deferred_revenue(
        &state.db,
        &tenant_id,
        &branch_id,
        &schedule_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn list_accounting_periods(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<AccountingPeriodResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        balance_sheet_service::list_accounting_periods(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn close_accounting_period(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PeriodCloseRequest>,
) -> ApiResult<AccountingPeriodResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = balance_sheet_service::close_accounting_period(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn reopen_accounting_period(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(period): Path<String>,
    Json(payload): Json<PeriodReopenRequest>,
) -> ApiResult<AccountingPeriodResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = balance_sheet_service::reopen_accounting_period(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &period,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn finance_reconciliation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AsOfQuery>,
) -> ApiResult<FinanceHardeningStatus> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = balance_sheet_service::finance_hardening_status(
        &state.db,
        &tenant_id,
        &branch_id,
        query.as_of_date.as_deref(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn balance_scope_branch_ids(
    state: &AppState,
    claims: &AuthClaims,
    tenant_id: &str,
    selected_branch_id: &str,
    scope: &str,
) -> Result<Vec<String>, AppError> {
    if scope == "branch" {
        return Ok(vec![selected_branch_id.to_string()]);
    }
    if scope != "tenant" {
        return Err(AppError::validation("scope must be branch or tenant"));
    }
    if !["owner", "admin", "manager", "analyst"]
        .iter()
        .any(|role| claims.role.eq_ignore_ascii_case(role))
    {
        return Err(AppError::forbidden(
            "multi-branch Balance Sheet access requires owner, admin, manager, or analyst role",
        ));
    }
    let branch_ids = if is_local_env(&state.settings.app_env)
        && state.settings.enable_dev_session
        && claims.sub == "dev-admin"
    {
        branch_service::list(&state.db, tenant_id, None)
            .await?
            .into_iter()
            .filter(|branch| branch.active)
            .map(|branch| branch.id)
            .collect::<Vec<_>>()
    } else {
        let user = auth_repository::find_user_by_id(&state.db, tenant_id, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load Balance Sheet branch access"))?
            .ok_or_else(|| AppError::unauthenticated("user is not active"))?;
        auth_repository::list_branch_access(&state.db, &user)
            .await
            .map_err(|_| AppError::internal("failed to load Balance Sheet branch access"))?
            .into_iter()
            .map(|access| access.branch_id)
            .collect::<Vec<_>>()
    };
    let branch_ids = branch_ids
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if branch_ids.is_empty() {
        return Err(AppError::forbidden("no authorized branches are available"));
    }
    Ok(branch_ids)
}
