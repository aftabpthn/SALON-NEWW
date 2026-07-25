use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    Extension, Json, Router,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::json;
use std::io::{Cursor, Write};
use zip::{write::SimpleFileOptions, ZipWriter};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        auth_repository, auth_repository::AuthAuditInput, branch_repository::BranchRecord,
    },
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, branch_service, invoice_pdf},
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct BranchListQuery {
    pub q: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BranchPageQuery {
    pub q: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchBulkImportQuery {
    pub mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCreateRequest {
    pub name: String,
    pub code: String,
    #[serde(default)]
    pub region_name: String,
    #[serde(default)]
    pub zone_name: String,
    #[serde(default)]
    pub cluster_name: String,
    #[serde(default)]
    pub address: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    #[serde(default)]
    pub booking_deposit_percent: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchUpdateRequest {
    pub name: Option<String>,
    pub code: Option<String>,
    pub region_name: Option<String>,
    pub zone_name: Option<String>,
    pub cluster_name: Option<String>,
    pub address: Option<String>,
    pub latitude: Option<Option<f64>>,
    pub longitude: Option<Option<f64>>,
    pub booking_deposit_percent: Option<i32>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoyaltyRuleRequest {
    pub branch_id: String,
    pub royalty_bps: i32,
    pub minimum_paise: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FranchiseSaveRequest {
    pub central_branch_id: String,
    #[serde(default)]
    pub allowed_override_fields: Vec<String>,
    #[serde(default)]
    pub royalty_rules: Vec<RoyaltyRuleRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoyaltyGenerateRequest {
    pub period_start: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoyaltyPaymentRequest {
    pub payment_method: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiBranchApprovalRequest {
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiBranchDecisionRequest {
    pub decision: String,
    pub version: i32,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterBranchSettlementRequest {
    pub version: i32,
    pub payment_method: String,
    pub settlement_reference: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiBranchCommandCenterQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub region: Option<String>,
    pub zone: Option<String>,
    pub cluster: Option<String>,
    pub branch_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiBranchDrilldownQuery {
    pub kind: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub region: Option<String>,
    pub zone: Option<String>,
    pub cluster: Option<String>,
    pub branch_id: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/settings/branches", axum::routing::get(list).post(create))
        .route("/settings/branches/page", axum::routing::get(list_page))
        .route(
            "/settings/branches/import-template.csv",
            axum::routing::get(download_branch_import_template),
        )
        .route(
            "/settings/branches/imports/dry-run",
            axum::routing::post(preview_branch_import),
        )
        .route(
            "/settings/branches/imports/failure-report.csv",
            axum::routing::post(download_branch_failure_report),
        )
        .route(
            "/settings/branches/imports",
            axum::routing::post(import_branches),
        )
        .route("/settings/branches/:id", axum::routing::patch(update))
        .route(
            "/settings/franchise-controls",
            axum::routing::get(franchise_controls).put(save_franchise_controls),
        )
        .route(
            "/settings/franchise-controls/publish",
            axum::routing::post(publish_central_masters),
        )
        .route(
            "/settings/franchise-controls/royalties",
            axum::routing::post(generate_royalties),
        )
        .route(
            "/settings/franchise-controls/royalties/:id/pay",
            axum::routing::post(pay_royalty),
        )
        .route(
            "/settings/multi-branch/command-center",
            axum::routing::get(multi_branch_command_center),
        )
        .route(
            "/settings/multi-branch/drilldown",
            axum::routing::get(multi_branch_drilldown),
        )
        .route(
            "/settings/multi-branch/export.csv",
            axum::routing::get(export_multi_branch_csv),
        )
        .route(
            "/settings/multi-branch/export.xlsx",
            axum::routing::get(export_multi_branch_xlsx),
        )
        .route(
            "/settings/multi-branch/export.pdf",
            axum::routing::get(export_multi_branch_pdf),
        )
        .route(
            "/settings/multi-branch/settlements/:id/settle",
            axum::routing::post(settle_inter_branch_redemption),
        )
        .route(
            "/settings/multi-branch/approvals",
            axum::routing::post(request_multi_branch_approval),
        )
        .route(
            "/settings/multi-branch/approvals/:id",
            axum::routing::patch(decide_multi_branch_approval),
        )
}

async fn settle_inter_branch_redemption(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<InterBranchSettlementRequest>,
) -> ApiResult<crate::repositories::branch_repository::InterBranchSettlementRecord> {
    require_branch_access(&claims, true)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        branch_service::settle_inter_branch_redemption(
            &state.db,
            &tenant_id,
            &claims.sub,
            (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            has_unrestricted_org_scope(&claims),
            &id,
            payload.version,
            &payload.payment_method,
            &payload.settlement_reference,
        )
        .await?,
    )))
}

async fn multi_branch_drilldown(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<MultiBranchDrilldownQuery>,
) -> ApiResult<Vec<serde_json::Value>> {
    require_org_report_access(&claims)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        branch_service::multi_branch_drilldown(
            &state.db,
            &tenant_id,
            &claims.sub,
            has_unrestricted_org_scope(&claims),
            &query.kind,
            branch_service::MultiBranchFilterInput {
                start_date: query.start_date,
                end_date: query.end_date,
                region: query.region,
                zone: query.zone,
                cluster: query.cluster,
                branch_id: query.branch_id,
            },
        )
        .await?,
    )))
}

async fn export_multi_branch_csv(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<MultiBranchCommandCenterQuery>,
) -> Result<Response, AppError> {
    export_multi_branch(state, claims, headers, query, "csv").await
}

async fn export_multi_branch_xlsx(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<MultiBranchCommandCenterQuery>,
) -> Result<Response, AppError> {
    export_multi_branch(state, claims, headers, query, "xlsx").await
}

async fn export_multi_branch_pdf(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<MultiBranchCommandCenterQuery>,
) -> Result<Response, AppError> {
    export_multi_branch(state, claims, headers, query, "pdf").await
}

async fn export_multi_branch(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    query: MultiBranchCommandCenterQuery,
    format: &'static str,
) -> Result<Response, AppError> {
    require_org_report_access(&claims)?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let report = branch_service::multi_branch_command_center(
        &state.db,
        &tenant_id,
        &claims.sub,
        has_unrestricted_org_scope(&claims),
        branch_service::MultiBranchFilterInput {
            start_date: query.start_date,
            end_date: query.end_date,
            region: query.region,
            zone: query.zone,
            cluster: query.cluster,
            branch_id: query.branch_id,
        },
    )
    .await?;
    let (body, content_type) = match format {
        "xlsx" => (
            multi_branch_xlsx(&report)?,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
        "pdf" => {
            let mut lines = vec![
                format!("Date range: {} to {}", report.range_start, report.range_end),
                format!("Branches: {}", report.summary.branch_count),
                format!(
                    "Revenue: INR {:.2}",
                    report.summary.revenue_paise as f64 / 100.0
                ),
            ];
            lines.extend(report.comparisons.iter().map(|row| {
                format!(
                    "{} | {} / {} / {} | revenue {:.2} | refunds {:.2} | sales {} | appointments {} | utilization {:.2}% | variance {:.2}",
                    row.branch_name,
                    row.region_name,
                    row.zone_name,
                    row.cluster_name,
                    row.revenue_paise as f64 / 100.0,
                    row.refund_paise as f64 / 100.0,
                    row.sale_count,
                    row.appointment_count,
                    row.utilization_bps as f64 / 100.0,
                    row.cash_variance_paise as f64 / 100.0
                )
            }));
            (
                invoice_pdf::render_text_report("Multi-Branch Command Center", &lines),
                "application/pdf",
            )
        }
        _ => (
            multi_branch_csv(&report).into_bytes(),
            "text/csv; charset=utf-8",
        ),
    };
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&current_branch_id),
            identity: None,
            event_type: "multi_branch.report.exported",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({"format":format,"rangeStart":report.range_start,"rangeEnd":report.range_end}),
        },
    )
    .await;
    let mut response = body.into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!(
            "attachment; filename=multi-branch-report.{format}"
        ))
        .map_err(|_| AppError::internal("failed to set branch export filename"))?,
    );
    Ok(response)
}

fn multi_branch_csv(report: &branch_service::MultiBranchCommandCenter) -> String {
    let mut csv = String::from("branch_id,branch_name,region,zone,cluster,revenue_paise,refund_paise,tip_paise,sales,voids,appointments,lost_appointments,utilization_bps,cash_variance_paise,open_tills,transfers,shortages,inventory_value_paise,membership_liability_paise,membership_redeemed_paise,cross_location_redeemed_paise,gift_card_liability_paise,loyalty_points_balance,shared_customers,service_sync_gap,product_sync_gap\n");
    for row in &report.comparisons {
        let text = |value: &str| format!("\"{}\"", value.replace('"', "\"\""));
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}\n",
            text(&row.branch_id),
            text(&row.branch_name),
            text(&row.region_name),
            text(&row.zone_name),
            text(&row.cluster_name),
            row.revenue_paise,
            row.refund_paise,
            row.tip_paise,
            row.sale_count,
            row.void_count,
            row.appointment_count,
            row.lost_appointment_count,
            row.utilization_bps,
            row.cash_variance_paise,
            row.open_till_count,
            row.transfer_count,
            row.shortage_count,
            row.inventory_value_paise,
            row.membership_liability_paise,
            row.membership_redeemed_paise,
            row.cross_location_redeemed_paise,
            row.gift_card_liability_paise,
            row.loyalty_points_balance,
            row.shared_customer_count,
            row.service_sync_gap,
            row.product_sync_gap
        ));
    }
    csv
}

fn multi_branch_xlsx(
    report: &branch_service::MultiBranchCommandCenter,
) -> Result<Vec<u8>, AppError> {
    const HEADERS: [&str; 26] = [
        "Branch ID",
        "Branch",
        "Region",
        "Zone",
        "Cluster",
        "Revenue Paise",
        "Refund Paise",
        "Tip Paise",
        "Sales",
        "Voids",
        "Appointments",
        "Lost Appointments",
        "Utilization BPS",
        "Cash Variance Paise",
        "Open Tills",
        "Transfers",
        "Shortages",
        "Inventory Value Paise",
        "Membership Liability Paise",
        "Membership Redeemed Paise",
        "Cross Location Redeemed Paise",
        "Gift Card Liability Paise",
        "Loyalty Points",
        "Shared Customers",
        "Service Sync Gap",
        "Product Sync Gap",
    ];
    let mut sheet = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#,
    );
    sheet.push_str("<row r=\"1\">");
    for (column, value) in HEADERS.iter().enumerate() {
        sheet.push_str(&xlsx_string_cell(column, 1, value));
    }
    sheet.push_str("</row>");
    for (offset, row) in report.comparisons.iter().enumerate() {
        let row_number = offset + 2;
        sheet.push_str(&format!("<row r=\"{row_number}\">"));
        for (column, value) in [
            row.branch_id.as_str(),
            row.branch_name.as_str(),
            row.region_name.as_str(),
            row.zone_name.as_str(),
            row.cluster_name.as_str(),
        ]
        .iter()
        .enumerate()
        {
            sheet.push_str(&xlsx_string_cell(column, row_number, value));
        }
        for (offset, value) in [
            row.revenue_paise,
            row.refund_paise,
            row.tip_paise,
            row.sale_count,
            row.void_count,
            row.appointment_count,
            row.lost_appointment_count,
            row.utilization_bps,
            row.cash_variance_paise,
            row.open_till_count,
            row.transfer_count,
            row.shortage_count,
            row.inventory_value_paise,
            row.membership_liability_paise,
            row.membership_redeemed_paise,
            row.cross_location_redeemed_paise,
            row.gift_card_liability_paise,
            row.loyalty_points_balance,
            row.shared_customer_count,
            row.service_sync_gap,
            row.product_sync_gap,
        ]
        .iter()
        .enumerate()
        {
            sheet.push_str(&format!(
                "<c r=\"{}{}\"><v>{}</v></c>",
                xlsx_column(offset + 5),
                row_number,
                value
            ));
        }
        sheet.push_str("</row>");
    }
    sheet.push_str("</sheetData></worksheet>");

    let cursor = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(cursor);
    let files = [
        (
            "[Content_Types].xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
        ),
        (
            "xl/workbook.xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Branches" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
        ),
        (
            "xl/_rels/workbook.xml.rels",
            r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
        ),
    ];
    for (name, content) in files {
        zip.start_file(name, SimpleFileOptions::default())
            .map_err(|_| AppError::internal("failed to create XLSX export"))?;
        zip.write_all(content.as_bytes())
            .map_err(|_| AppError::internal("failed to write XLSX export"))?;
    }
    zip.start_file("xl/worksheets/sheet1.xml", SimpleFileOptions::default())
        .map_err(|_| AppError::internal("failed to create XLSX worksheet"))?;
    zip.write_all(sheet.as_bytes())
        .map_err(|_| AppError::internal("failed to write XLSX worksheet"))?;
    Ok(zip
        .finish()
        .map_err(|_| AppError::internal("failed to finish XLSX export"))?
        .into_inner())
}

fn xlsx_string_cell(column: usize, row: usize, value: &str) -> String {
    format!(
        "<c r=\"{}{row}\" t=\"inlineStr\"><is><t>{}</t></is></c>",
        xlsx_column(column),
        xml_escape(value)
    )
}

fn xlsx_column(mut column: usize) -> String {
    let mut value = String::new();
    loop {
        value.insert(0, (b'A' + (column % 26) as u8) as char);
        if column < 26 {
            return value;
        }
        column = column / 26 - 1;
    }
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

async fn multi_branch_command_center(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<MultiBranchCommandCenterQuery>,
) -> ApiResult<branch_service::MultiBranchCommandCenter> {
    require_org_report_access(&claims)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        branch_service::multi_branch_command_center(
            &state.db,
            &tenant_id,
            &claims.sub,
            has_unrestricted_org_scope(&claims),
            branch_service::MultiBranchFilterInput {
                start_date: query.start_date,
                end_date: query.end_date,
                region: query.region,
                zone: query.zone,
                cluster: query.cluster,
                branch_id: query.branch_id,
            },
        )
        .await?,
    )))
}

async fn request_multi_branch_approval(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<MultiBranchApprovalRequest>,
) -> ApiResult<crate::repositories::branch_repository::MultiBranchApprovalRecord> {
    require_branch_access(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        branch_service::request_multi_branch_approval(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            &payload.note,
        )
        .await?,
    )))
}

async fn decide_multi_branch_approval(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<MultiBranchDecisionRequest>,
) -> ApiResult<branch_service::MultiBranchApprovalDecision> {
    require_branch_access(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        branch_service::decide_multi_branch_approval(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            &id,
            payload.version,
            &payload.decision,
            &payload.note,
        )
        .await?,
    )))
}

async fn franchise_controls(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<branch_service::FranchiseControls> {
    require_branch_access(&claims, false)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        branch_service::franchise_controls_scoped(
            &state.db,
            &tenant_id,
            &claims.sub,
            has_unrestricted_org_scope(&claims),
        )
        .await?,
    )))
}

async fn save_franchise_controls(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<FranchiseSaveRequest>,
) -> ApiResult<branch_service::FranchiseControls> {
    require_branch_access(&claims, true)?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let controls = branch_service::save_franchise_controls(
        &state.db,
        &tenant_id,
        &claims.sub,
        &payload.central_branch_id,
        payload.allowed_override_fields,
        payload
            .royalty_rules
            .into_iter()
            .map(
                |rule| crate::repositories::branch_repository::RoyaltyRuleInput {
                    branch_id: rule.branch_id,
                    royalty_bps: rule.royalty_bps,
                    minimum_paise: rule.minimum_paise,
                },
            )
            .collect(),
    )
    .await?;
    audit_franchise(
        &state,
        &claims,
        &current_branch_id,
        "franchise.controls.updated",
        json!({"centralBranchId": controls.central_branch_id}),
    )
    .await;
    Ok(Json(ApiResponse::ok(controls)))
}

async fn publish_central_masters(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<MultiBranchApprovalRequest>,
) -> ApiResult<serde_json::Value> {
    require_branch_access(&claims, true)?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let approval = branch_service::request_multi_branch_approval(
        &state.db,
        &tenant_id,
        &current_branch_id,
        &claims.sub,
        (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
        &payload.note,
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        json!({"status":"pending_approval","published":0,"approval":approval}),
    )))
}

async fn generate_royalties(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<RoyaltyGenerateRequest>,
) -> ApiResult<serde_json::Value> {
    require_branch_access(&claims, true)?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let period_start = NaiveDate::parse_from_str(payload.period_start.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::validation("royalty periodStart is invalid"))?;
    let generated =
        branch_service::generate_royalties(&state.db, &tenant_id, &claims.sub, period_start)
            .await?;
    audit_franchise(
        &state,
        &claims,
        &current_branch_id,
        "franchise.royalties.generated",
        json!({"periodStart": period_start, "generated": generated}),
    )
    .await;
    Ok(Json(ApiResponse::ok(json!({"generated": generated}))))
}

async fn pay_royalty(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<RoyaltyPaymentRequest>,
) -> ApiResult<crate::repositories::branch_repository::RoyaltyStatementRecord> {
    require_branch_access(&claims, true)?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let statement = branch_service::pay_royalty(
        &state.db,
        &tenant_id,
        &claims.sub,
        &id,
        &payload.payment_method,
    )
    .await?;
    audit_franchise(
        &state,
        &claims,
        &current_branch_id,
        "franchise.royalty.paid",
        json!({"statementId": statement.id, "branchId": statement.branch_id}),
    )
    .await;
    Ok(Json(ApiResponse::ok(statement)))
}

async fn list(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<BranchListQuery>,
) -> ApiResult<Vec<BranchRecord>> {
    require_branch_access(&claims, false)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    let branches = branch_service::list(&state.db, &tenant_id, query.q.as_deref()).await?;
    Ok(Json(ApiResponse::ok(branches)))
}

async fn list_page(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<BranchPageQuery>,
) -> ApiResult<branch_service::BranchPage> {
    require_branch_access(&claims, false)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        branch_service::list_page(
            &state.db,
            &tenant_id,
            query.q.as_deref(),
            query.cursor.as_deref(),
            query.limit,
        )
        .await?,
    )))
}

async fn download_branch_import_template(
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    require_branch_access(&claims, false)?;
    tenant_branch(&headers)?;
    csv_attachment(
        branch_service::branch_import_template().to_string(),
        "branch-import-template.csv",
    )
}

async fn preview_branch_import(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult<branch_service::BranchBulkPreview> {
    require_branch_access(&claims, true)?;
    require_csv_content_type(&headers)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        branch_service::preview_bulk(&state.db, &tenant_id, &bytes).await?,
    )))
}

async fn download_branch_failure_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, AppError> {
    require_branch_access(&claims, true)?;
    require_csv_content_type(&headers)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    let preview = branch_service::preview_bulk(&state.db, &tenant_id, &bytes).await?;
    csv_attachment(
        branch_service::branch_failure_report_csv(&preview.failures)?,
        "branch-import-failures.csv",
    )
}

async fn import_branches(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<BranchBulkImportQuery>,
    bytes: Bytes,
) -> ApiResult<branch_service::BranchBulkImportResult> {
    require_branch_access(&claims, true)?;
    require_csv_content_type(&headers)?;
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| AppError::validation("Idempotency-Key header is required"))?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let result = branch_service::import_bulk(
        &state.db,
        &tenant_id,
        &current_branch_id,
        &claims.sub,
        idempotency_key,
        branch_service::BranchBulkImportMode::parse(query.mode.as_deref())?,
        &bytes,
    )
    .await?;
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&current_branch_id),
            identity: None,
            event_type: "branch.bulk_imported",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({
                "importId": result.import_id,
                "createdCount": result.created_count,
                "replayed": result.replayed,
            }),
        },
    )
    .await;
    Ok(Json(ApiResponse::ok(result)))
}

async fn create(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BranchCreateRequest>,
) -> ApiResult<BranchRecord> {
    require_branch_access(&claims, true)?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let branch = branch_service::create(
        &state.db,
        &tenant_id,
        payload.name,
        payload.code,
        payload.region_name,
        payload.zone_name,
        payload.cluster_name,
        payload.address,
        payload.latitude,
        payload.longitude,
        payload.booking_deposit_percent,
    )
    .await?;
    audit(
        &state,
        &claims,
        &current_branch_id,
        "branch.created",
        &branch,
    )
    .await;
    Ok(Json(ApiResponse::ok(branch)))
}

async fn update(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<BranchUpdateRequest>,
) -> ApiResult<BranchRecord> {
    require_branch_access(&claims, true)?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let branch = branch_service::update(
        &state.db,
        &tenant_id,
        &current_branch_id,
        &id,
        branch_service::BranchUpdateInput {
            name: payload.name,
            code: payload.code,
            region_name: payload.region_name,
            zone_name: payload.zone_name,
            cluster_name: payload.cluster_name,
            address: payload.address,
            latitude: payload.latitude,
            longitude: payload.longitude,
            booking_deposit_percent: payload.booking_deposit_percent,
            active: payload.active,
        },
    )
    .await?;
    audit(
        &state,
        &claims,
        &current_branch_id,
        "branch.updated",
        &branch,
    )
    .await;
    Ok(Json(ApiResponse::ok(branch)))
}

fn require_branch_access(claims: &AuthClaims, write: bool) -> Result<(), AppError> {
    if branch_access_allowed(&claims.role, &claims.permissions, write) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "branch management permission is required",
        ))
    }
}

fn require_csv_content_type(headers: &HeaderMap) -> Result<(), AppError> {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("")
        .trim();
    matches!(
        content_type,
        "text/csv" | "application/csv" | "application/vnd.ms-excel"
    )
    .then_some(())
    .ok_or_else(|| AppError::validation("Content-Type must be text/csv"))
}

fn csv_attachment(content: String, file_name: &str) -> Result<Response, AppError> {
    let mut response = content.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/csv; charset=utf-8"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename={file_name}"))
            .map_err(|_| AppError::internal("failed to set branch CSV filename"))?,
    );
    Ok(response)
}

fn require_org_report_access(claims: &AuthClaims) -> Result<(), AppError> {
    if claims.role.eq_ignore_ascii_case("owner")
        || claims.role.eq_ignore_ascii_case("admin")
        || claims.role.eq_ignore_ascii_case("super-admin")
        || claims.role.eq_ignore_ascii_case("superadmin")
        || claims
            .permissions
            .iter()
            .any(|permission| matches!(permission.as_str(), "tenant.read" | "settings.manage"))
    {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "organization reporting permission is required",
        ))
    }
}

fn has_unrestricted_org_scope(claims: &AuthClaims) -> bool {
    matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "super-admin" | "superadmin"
    )
}

fn branch_access_allowed(role: &str, permissions: &[String], write: bool) -> bool {
    role.eq_ignore_ascii_case("owner")
        || permissions.iter().any(|permission| {
            if write {
                matches!(permission.as_str(), "settings.manage" | "management.write")
            } else {
                matches!(
                    permission.as_str(),
                    "settings.read" | "settings.manage" | "tenant.read"
                )
            }
        })
}

async fn audit(
    state: &AppState,
    claims: &AuthClaims,
    current_branch_id: &str,
    event_type: &'static str,
    branch: &BranchRecord,
) {
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &claims.tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(current_branch_id),
            identity: None,
            event_type,
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({
                "managedBranchId": branch.id,
                "code": branch.code,
                "regionName": branch.region_name,
                "zoneName": branch.zone_name,
                "clusterName": branch.cluster_name,
                "bookingDepositPercent": branch.booking_deposit_percent,
                "active": branch.active,
            }),
        },
    )
    .await;
}

async fn audit_franchise(
    state: &AppState,
    claims: &AuthClaims,
    current_branch_id: &str,
    event_type: &'static str,
    details: serde_json::Value,
) {
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &claims.tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(current_branch_id),
            identity: None,
            event_type,
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details,
        },
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::{branch_access_allowed, require_org_report_access};
    use crate::services::auth_service::AuthClaims;

    #[test]
    fn branch_access_matches_route_permission_mapping() {
        assert!(branch_access_allowed("Owner", &[], true));
        assert!(branch_access_allowed(
            "Regional Lead",
            &["settings.read".into()],
            false
        ));
        assert!(!branch_access_allowed(
            "Regional Lead",
            &["settings.read".into()],
            true
        ));
        assert!(branch_access_allowed(
            "Regional Lead",
            &["settings.manage".into()],
            true
        ));
    }

    #[test]
    fn command_center_requires_organization_scope() {
        let claims = |role: &str, permissions: Vec<String>| AuthClaims {
            sub: "user-1".into(),
            tenant_id: "tenant-1".into(),
            branch_id: Some("branch-1".into()),
            role: role.into(),
            role_id: None,
            permissions,
            denied_permissions: vec![],
            masked_fields: vec![],
            max_discount_paise: None,
            max_refund_paise: None,
            max_cash_movement_paise: None,
            permission_version: 1,
            session_id: String::new(),
            mfa_enrollment_required: false,
            token_type: "access".into(),
            jti: "jti-1".into(),
            iat: 0,
            exp: usize::MAX,
        };
        assert!(require_org_report_access(&claims("Owner", vec![])).is_ok());
        assert!(require_org_report_access(&claims("Analyst", vec!["tenant.read".into()])).is_ok());
        assert!(
            require_org_report_access(&claims("Manager", vec!["settings.read".into()])).is_err()
        );
    }
}
