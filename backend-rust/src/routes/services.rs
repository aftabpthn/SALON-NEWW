use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::services_repository::{
        self, CreateService, ServiceAddonInput, ServicePriceRuleInput, ServiceRecord,
        ServiceStaffPriceInput, ServiceVariantInput, UpdateService,
    },
    routes::context::tenant_branch,
    services::{
        service_pricing_service::{self, ServicePriceQuote},
        service_settings_service::{self, ServiceRuleCandidate},
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/services", get(list_services).post(create_service))
        .route(
            "/services/settings",
            get(get_service_settings).put(save_service_settings),
        )
        .route("/services/:id/quote", get(get_service_quote))
        .route("/services/:id", get(get_service).patch(update_service))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceListQuery {
    pub q: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceQuoteQuery {
    pub staff_id: Option<String>,
    pub variant_id: Option<String>,
    pub addon_ids: Option<String>,
    pub starts_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductConsumptionLine {
    pub product_id: Option<String>,
    pub product_name: Option<String>,
    pub unit: String,
    pub min_qty: f64,
    pub standard_qty: f64,
    pub max_qty: f64,
    pub waste_percent: f64,
    pub owner_approval_percent: f64,
    pub hit_limit: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceVariantRequest {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub price_delta_paise: i64,
    #[serde(default)]
    pub duration_delta_minutes: i32,
    #[serde(default = "default_true")]
    pub active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceAddonRequest {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub price_paise: i64,
    #[serde(default)]
    pub duration_minutes: i32,
    #[serde(default = "default_true")]
    pub active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStaffPriceRequest {
    #[serde(default)]
    pub id: String,
    pub staff_id: String,
    pub price_paise: i64,
    #[serde(default = "default_true")]
    pub active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServicePriceRuleRequest {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub days_of_week: Vec<i16>,
    pub start_time: String,
    pub end_time: String,
    pub adjustment_bps: i32,
    #[serde(default)]
    pub priority: i32,
    #[serde(default = "default_true")]
    pub active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceWriteRequest {
    pub name: Option<String>,
    pub category: Option<String>,
    pub duration_minutes: Option<i32>,
    pub price_paise: Option<i64>,
    pub gst_percent: Option<i32>,
    pub sac_code: Option<String>,
    pub wait_time_minutes: Option<i32>,
    pub cleanup_time_minutes: Option<i32>,
    pub buffer_time_minutes: Option<i32>,
    pub product_consumption: Option<Vec<ProductConsumptionLine>>,
    pub staff_ids: Option<Vec<String>>,
    pub variants: Option<Vec<ServiceVariantRequest>>,
    pub addons: Option<Vec<ServiceAddonRequest>>,
    pub staff_prices: Option<Vec<ServiceStaffPriceRequest>>,
    pub price_rules: Option<Vec<ServicePriceRuleRequest>>,
    pub active: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceResponse {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub name: String,
    pub category: String,
    pub duration_minutes: i32,
    pub price_paise: i64,
    pub gst_percent: i32,
    pub sac_code: String,
    pub wait_time_minutes: i32,
    pub cleanup_time_minutes: i32,
    pub buffer_time_minutes: i32,
    pub product_consumption: Value,
    pub staff_ids: Value,
    pub variants: Value,
    pub addons: Value,
    pub staff_prices: Value,
    pub price_rules: Value,
    pub central_master_service_id: Option<String>,
    pub franchise_override_fields: Vec<String>,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

async fn list_services(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ServiceListQuery>,
) -> ApiResult<Vec<ServiceResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 100);
    let q = query.q.unwrap_or_default();

    let rows = services_repository::list(
        &state.db,
        &tenant_id,
        &branch_id,
        &q,
        page_size,
        (page - 1) * page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to list services"))?;

    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(ServiceResponse::from).collect(),
    )))
}

async fn get_service_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service_settings_service::settings(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn save_service_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service_settings_service::save_settings(&state.db, &tenant_id, &branch_id, payload).await?,
    )))
}

async fn get_service(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<ServiceResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = services_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load service"))?
        .ok_or_else(|| AppError::not_found("service was not found"))?;

    Ok(Json(ApiResponse::ok(ServiceResponse::from(row))))
}

async fn get_service_quote(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<ServiceQuoteQuery>,
) -> ApiResult<ServicePriceQuote> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = query.staff_id.unwrap_or_default().trim().to_string();
    let variant_id = query.variant_id.unwrap_or_default().trim().to_string();
    let addon_ids = normalized_ids(
        &query
            .addon_ids
            .unwrap_or_default()
            .split(',')
            .map(str::to_string)
            .collect::<Vec<_>>(),
        "addonIds",
        50,
    )?;
    let quote = service_pricing_service::quote(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &staff_id,
        &variant_id,
        &addon_ids,
        query.starts_at.unwrap_or_else(Utc::now),
    )
    .await?;
    Ok(Json(ApiResponse::ok(quote)))
}

async fn create_service(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ServiceWriteRequest>,
) -> ApiResult<ServiceResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let settings = service_settings_service::settings(&state.db, &tenant_id, &branch_id).await?;
    let name = required_text(payload.name.as_deref(), "name is required")?;
    let category = payload.category.as_deref().unwrap_or("").trim();
    let duration_minutes = non_negative_i32(
        Some(
            payload
                .duration_minutes
                .unwrap_or_else(|| service_settings_service::default_duration_minutes(&settings)),
        ),
        "durationMinutes",
    )?;
    let price_paise = non_negative_i64(payload.price_paise, "pricePaise")?;
    let gst_percent = percentage_i32(
        Some(
            payload
                .gst_percent
                .unwrap_or_else(|| service_settings_service::default_gst_percent(&settings)),
        ),
        "gstPercent",
    )?;
    let product_consumption_json = product_consumption_json(payload.product_consumption.as_ref())?;
    let sac_code = tax_code(payload.sac_code.as_deref(), "sacCode")?;
    let staff_ids = normalized_staff_ids(payload.staff_ids.as_deref().unwrap_or(&[]))?;
    ensure_staff_scope(&state.db, &tenant_id, &branch_id, &staff_ids).await?;
    let variants = normalized_variants(payload.variants.as_deref().unwrap_or(&[]))?;
    let addons = normalized_addons(payload.addons.as_deref().unwrap_or(&[]))?;
    let staff_prices = normalized_staff_prices(payload.staff_prices.as_deref().unwrap_or(&[]))?;
    let price_rules = normalized_price_rules(payload.price_rules.as_deref().unwrap_or(&[]))?;
    ensure_staff_scope(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_prices
            .iter()
            .map(|row| row.staff_id.clone())
            .collect::<Vec<_>>(),
    )
    .await?;
    service_settings_service::enforce_write_rules(
        &state.db,
        &tenant_id,
        &branch_id,
        "",
        &settings,
        ServiceRuleCandidate {
            name,
            category,
            duration_minutes,
            price_paise,
            staff_count: staff_ids.len(),
            addon_count: addons.len(),
            has_recipe: payload
                .product_consumption
                .as_ref()
                .is_some_and(|rows| !rows.is_empty()),
        },
    )
    .await?;

    let row = services_repository::create(
        &state.db,
        CreateService {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            name,
            category,
            duration_minutes,
            price_paise,
            gst_percent,
            sac_code: &sac_code,
            wait_time_minutes: non_negative_i32(payload.wait_time_minutes, "waitTimeMinutes")?,
            cleanup_time_minutes: non_negative_i32(
                payload.cleanup_time_minutes,
                "cleanupTimeMinutes",
            )?,
            buffer_time_minutes: non_negative_i32(
                payload.buffer_time_minutes,
                "bufferTimeMinutes",
            )?,
            product_consumption_json: &product_consumption_json,
            staff_ids: &staff_ids,
            variants: &variants,
            addons: &addons,
            staff_prices: &staff_prices,
            price_rules: &price_rules,
            active: payload
                .active
                .unwrap_or_else(|| service_settings_service::default_active(&settings)),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to create service"))?;

    Ok(Json(ApiResponse::ok(ServiceResponse::from(row))))
}

async fn update_service(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ServiceWriteRequest>,
) -> ApiResult<ServiceResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let existing = services_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load service"))?
        .ok_or_else(|| AppError::not_found("service was not found"))?;
    let franchise_override_fields = requested_franchise_override_fields(&payload, &existing);
    if existing.central_master_service_id.is_some() {
        let allowed = services_repository::allowed_franchise_overrides(
            &state.db, &tenant_id, &branch_id, &id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate franchise overrides"))?
        .unwrap_or_default();
        let blocked = franchise_override_fields
            .iter()
            .filter(|field| !allowed.contains(field))
            .cloned()
            .collect::<Vec<_>>();
        if !blocked.is_empty() {
            return Err(AppError::conflict(format!(
                "central master locks: {}",
                blocked.join(", ")
            )));
        }
    }
    let settings = service_settings_service::settings(&state.db, &tenant_id, &branch_id).await?;
    let product_consumption_json = payload
        .product_consumption
        .as_ref()
        .map(|lines| product_consumption_json(Some(lines)))
        .transpose()?;
    let sac_code = payload
        .sac_code
        .as_deref()
        .map(|value| tax_code(Some(value), "sacCode"))
        .transpose()?;
    let name = payload
        .name
        .as_deref()
        .map(|value| required_text(Some(value), "name is required"))
        .transpose()?;
    let category = payload.category.as_deref().map(str::trim);
    let duration_minutes = payload
        .duration_minutes
        .map(|value| non_negative_i32(Some(value), "durationMinutes"))
        .transpose()?;
    let price_paise = payload
        .price_paise
        .map(|value| non_negative_i64(Some(value), "pricePaise"))
        .transpose()?;
    let gst_percent = payload
        .gst_percent
        .map(|value| percentage_i32(Some(value), "gstPercent"))
        .transpose()?;
    let staff_ids = payload
        .staff_ids
        .as_deref()
        .map(normalized_staff_ids)
        .transpose()?;
    let variants = payload
        .variants
        .as_deref()
        .map(normalized_variants)
        .transpose()?;
    let addons = payload
        .addons
        .as_deref()
        .map(normalized_addons)
        .transpose()?;
    let staff_prices = payload
        .staff_prices
        .as_deref()
        .map(normalized_staff_prices)
        .transpose()?;
    let price_rules = payload
        .price_rules
        .as_deref()
        .map(normalized_price_rules)
        .transpose()?;
    if let Some(staff_ids) = staff_ids.as_deref() {
        ensure_staff_scope(&state.db, &tenant_id, &branch_id, staff_ids).await?;
    }
    if let Some(staff_prices) = staff_prices.as_deref() {
        ensure_staff_scope(
            &state.db,
            &tenant_id,
            &branch_id,
            &staff_prices
                .iter()
                .map(|row| row.staff_id.clone())
                .collect::<Vec<_>>(),
        )
        .await?;
    }
    service_settings_service::enforce_write_rules(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &settings,
        ServiceRuleCandidate {
            name: name.unwrap_or(&existing.name),
            category: category.unwrap_or(&existing.category),
            duration_minutes: duration_minutes.unwrap_or(existing.duration_minutes),
            price_paise: price_paise.unwrap_or(existing.price_paise),
            staff_count: staff_ids
                .as_ref()
                .map_or_else(|| json_array_len(&existing.staff_ids_json), Vec::len),
            addon_count: addons
                .as_ref()
                .map_or_else(|| json_array_len(&existing.addons_json), Vec::len),
            has_recipe: payload.product_consumption.as_ref().map_or_else(
                || json_array_len(&existing.product_consumption_json) > 0,
                |rows| !rows.is_empty(),
            ),
        },
    )
    .await?;

    let row = services_repository::update(
        &state.db,
        UpdateService {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            id: &id,
            name,
            category,
            duration_minutes,
            price_paise,
            gst_percent,
            sac_code: sac_code.as_deref(),
            wait_time_minutes: payload.wait_time_minutes.map(|value| value.max(0)),
            cleanup_time_minutes: payload.cleanup_time_minutes.map(|value| value.max(0)),
            buffer_time_minutes: payload.buffer_time_minutes.map(|value| value.max(0)),
            product_consumption_json: product_consumption_json.as_deref(),
            staff_ids: staff_ids.as_deref(),
            variants: variants.as_deref(),
            addons: addons.as_deref(),
            staff_prices: staff_prices.as_deref(),
            price_rules: price_rules.as_deref(),
            active: payload.active,
            franchise_override_fields: &franchise_override_fields,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to update service"))?
    .ok_or_else(|| AppError::not_found("service was not found"))?;

    Ok(Json(ApiResponse::ok(ServiceResponse::from(row))))
}

fn requested_franchise_override_fields(
    payload: &ServiceWriteRequest,
    existing: &ServiceRecord,
) -> Vec<String> {
    [
        (
            payload
                .name
                .as_deref()
                .is_some_and(|value| value.trim() != existing.name),
            "name",
        ),
        (
            payload
                .category
                .as_deref()
                .is_some_and(|value| value.trim() != existing.category),
            "category",
        ),
        (
            payload
                .duration_minutes
                .is_some_and(|value| value != existing.duration_minutes),
            "durationMinutes",
        ),
        (
            payload
                .price_paise
                .is_some_and(|value| value != existing.price_paise),
            "pricePaise",
        ),
        (
            payload
                .gst_percent
                .is_some_and(|value| value != existing.gst_percent),
            "gstPercent",
        ),
        (
            payload
                .sac_code
                .as_deref()
                .is_some_and(|value| value.trim() != existing.sac_code),
            "sacCode",
        ),
        (
            payload
                .wait_time_minutes
                .is_some_and(|value| value.max(0) != existing.wait_time_minutes),
            "waitTimeMinutes",
        ),
        (
            payload
                .cleanup_time_minutes
                .is_some_and(|value| value.max(0) != existing.cleanup_time_minutes),
            "cleanupTimeMinutes",
        ),
        (
            payload
                .buffer_time_minutes
                .is_some_and(|value| value.max(0) != existing.buffer_time_minutes),
            "bufferTimeMinutes",
        ),
        (
            payload.active.is_some_and(|value| value != existing.active),
            "active",
        ),
    ]
    .into_iter()
    .filter_map(|(requested, field)| requested.then_some(field.to_string()))
    .collect()
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

fn percentage_i32(value: Option<i32>, field: &'static str) -> Result<i32, AppError> {
    let value = value.unwrap_or(0);
    (0..=100)
        .contains(&value)
        .then_some(value)
        .ok_or_else(|| AppError::validation(format!("{field} must be between 0 and 100")))
}

fn tax_code(value: Option<&str>, field: &'static str) -> Result<String, AppError> {
    let code = value.unwrap_or_default().trim().to_string();
    if !code.is_empty()
        && (!code.chars().all(|ch| ch.is_ascii_digit()) || !(4..=8).contains(&code.len()))
    {
        return Err(AppError::validation(format!(
            "{field} must contain 4 to 8 digits"
        )));
    }
    Ok(code)
}

fn product_consumption_json(
    lines: Option<&Vec<ProductConsumptionLine>>,
) -> Result<String, AppError> {
    let empty = Vec::new();
    let lines = lines.unwrap_or(&empty);
    if lines.len() > 100 {
        return Err(AppError::validation(
            "productConsumption cannot contain more than 100 lines",
        ));
    }
    for line in lines {
        if line
            .product_id
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
            && line
                .product_name
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
        {
            return Err(AppError::validation(
                "each productConsumption line requires productId or productName",
            ));
        }
        if line.unit.trim().is_empty()
            || [line.min_qty, line.standard_qty, line.max_qty]
                .iter()
                .any(|value| !value.is_finite() || *value < 0.0)
            || line.hit_limit < 0
        {
            return Err(AppError::validation(
                "productConsumption quantities, unit and hitLimit are invalid",
            ));
        }
        if line.min_qty > line.standard_qty
            || (line.max_qty > 0.0 && line.standard_qty > line.max_qty)
        {
            return Err(AppError::validation(
                "productConsumption quantity must follow minQty <= standardQty <= maxQty",
            ));
        }
        if [line.waste_percent, line.owner_approval_percent]
            .iter()
            .any(|value| !value.is_finite() || !(0.0..=100.0).contains(value))
        {
            return Err(AppError::validation(
                "productConsumption percentages must be between 0 and 100",
            ));
        }
    }
    serde_json::to_string(lines)
        .map_err(|_| AppError::validation("productConsumption must be valid"))
}

fn normalized_staff_ids(values: &[String]) -> Result<Vec<String>, AppError> {
    if values.iter().any(|value| value.trim().is_empty()) {
        return Err(AppError::validation("staffIds cannot contain empty values"));
    }
    normalized_ids(values, "staffIds", 100)
}

fn json_array_len(raw: &str) -> usize {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|value| value.as_array().map(Vec::len))
        .unwrap_or(0)
}

fn normalized_ids(values: &[String], field: &str, limit: usize) -> Result<Vec<String>, AppError> {
    if values.len() > limit {
        return Err(AppError::validation(format!(
            "{field} cannot contain more than {limit} values"
        )));
    }
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    for value in values {
        let id = value.trim();
        if id.is_empty() {
            continue;
        }
        if seen.insert(id.to_string()) {
            ids.push(id.to_string());
        }
    }
    Ok(ids)
}

fn normalized_variants(
    rows: &[ServiceVariantRequest],
) -> Result<Vec<ServiceVariantInput>, AppError> {
    if rows.len() > 50 {
        return Err(AppError::validation(
            "variants cannot contain more than 50 rows",
        ));
    }
    let mut names = HashSet::new();
    rows.iter()
        .map(|row| {
            let name = catalog_name(&row.name, "variant name")?;
            if !names.insert(name.to_lowercase()) {
                return Err(AppError::validation("variant names must be unique"));
            }
            if !(-100_000_000..=100_000_000).contains(&row.price_delta_paise)
                || !(-1_440..=1_440).contains(&row.duration_delta_minutes)
            {
                return Err(AppError::validation(
                    "variant price or duration adjustment is invalid",
                ));
            }
            Ok(ServiceVariantInput {
                id: row.id.trim().to_string(),
                name,
                price_delta_paise: row.price_delta_paise,
                duration_delta_minutes: row.duration_delta_minutes,
                active: row.active,
            })
        })
        .collect()
}

fn normalized_addons(rows: &[ServiceAddonRequest]) -> Result<Vec<ServiceAddonInput>, AppError> {
    if rows.len() > 50 {
        return Err(AppError::validation(
            "addons cannot contain more than 50 rows",
        ));
    }
    let mut names = HashSet::new();
    rows.iter()
        .map(|row| {
            let name = catalog_name(&row.name, "add-on name")?;
            if !names.insert(name.to_lowercase()) {
                return Err(AppError::validation("add-on names must be unique"));
            }
            if row.price_paise < 0 || !(0..=1_440).contains(&row.duration_minutes) {
                return Err(AppError::validation("add-on price or duration is invalid"));
            }
            Ok(ServiceAddonInput {
                id: row.id.trim().to_string(),
                name,
                price_paise: row.price_paise,
                duration_minutes: row.duration_minutes,
                active: row.active,
            })
        })
        .collect()
}

fn normalized_staff_prices(
    rows: &[ServiceStaffPriceRequest],
) -> Result<Vec<ServiceStaffPriceInput>, AppError> {
    if rows.len() > 100 {
        return Err(AppError::validation(
            "staffPrices cannot contain more than 100 rows",
        ));
    }
    let mut staff = HashSet::new();
    rows.iter()
        .map(|row| {
            let staff_id = row.staff_id.trim().to_string();
            if staff_id.is_empty() || !staff.insert(staff_id.clone()) || row.price_paise < 0 {
                return Err(AppError::validation(
                    "staff prices require unique staff and a valid price",
                ));
            }
            Ok(ServiceStaffPriceInput {
                id: row.id.trim().to_string(),
                staff_id,
                price_paise: row.price_paise,
                active: row.active,
            })
        })
        .collect()
}

fn normalized_price_rules(
    rows: &[ServicePriceRuleRequest],
) -> Result<Vec<ServicePriceRuleInput>, AppError> {
    if rows.len() > 50 {
        return Err(AppError::validation(
            "priceRules cannot contain more than 50 rows",
        ));
    }
    let mut names = HashSet::new();
    rows.iter()
        .map(|row| {
            let name = catalog_name(&row.name, "price rule name")?;
            if !names.insert(name.to_lowercase()) {
                return Err(AppError::validation("price rule names must be unique"));
            }
            let days_of_week = if row.days_of_week.is_empty() {
                vec![0, 1, 2, 3, 4, 5, 6]
            } else {
                row.days_of_week.clone()
            };
            if days_of_week.iter().any(|day| !(0..=6).contains(day))
                || days_of_week.iter().collect::<HashSet<_>>().len() != days_of_week.len()
                || !(-5_000..=10_000).contains(&row.adjustment_bps)
                || !(0..=1_000).contains(&row.priority)
            {
                return Err(AppError::validation(
                    "price rule days, adjustment or priority is invalid",
                ));
            }
            let start_time = NaiveTime::parse_from_str(row.start_time.trim(), "%H:%M")
                .map_err(|_| AppError::validation("price rule startTime must be HH:MM"))?;
            let end_time = NaiveTime::parse_from_str(row.end_time.trim(), "%H:%M")
                .map_err(|_| AppError::validation("price rule endTime must be HH:MM"))?;
            if start_time == end_time {
                return Err(AppError::validation(
                    "price rule startTime and endTime must differ",
                ));
            }
            Ok(ServicePriceRuleInput {
                id: row.id.trim().to_string(),
                name,
                days_of_week,
                start_time,
                end_time,
                adjustment_bps: row.adjustment_bps,
                priority: row.priority,
                active: row.active,
            })
        })
        .collect()
}

fn catalog_name(value: &str, field: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 160 {
        return Err(AppError::validation(format!(
            "{field} is required and must be 160 characters or fewer"
        )));
    }
    Ok(value.to_string())
}

fn default_true() -> bool {
    true
}

async fn ensure_staff_scope(
    db: &sqlx::PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
) -> Result<(), AppError> {
    if !services_repository::staff_ids_belong_to_scope(db, tenant_id, branch_id, staff_ids)
        .await
        .map_err(|_| AppError::internal("failed to validate assigned staff"))?
    {
        return Err(AppError::validation(
            "staffIds must belong to the current branch",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recipe_line() -> ProductConsumptionLine {
        ProductConsumptionLine {
            product_id: Some("product-1".into()),
            product_name: None,
            unit: "ml".into(),
            min_qty: 1.0,
            standard_qty: 2.0,
            max_qty: 3.0,
            waste_percent: 5.0,
            owner_approval_percent: 20.0,
            hit_limit: 3,
        }
    }

    #[test]
    fn service_recipe_rejects_invalid_limits() {
        let mut line = recipe_line();
        line.standard_qty = 4.0;
        assert!(product_consumption_json(Some(&vec![line])).is_err());

        let mut line = recipe_line();
        line.waste_percent = 101.0;
        assert!(product_consumption_json(Some(&vec![line])).is_err());
    }

    #[test]
    fn staff_assignment_ids_are_trimmed_and_deduplicated() {
        let ids = normalized_staff_ids(&[" staff-1 ".into(), "staff-1".into(), "staff-2".into()])
            .expect("valid staff IDs");
        assert_eq!(ids, vec!["staff-1", "staff-2"]);
        assert!(normalized_staff_ids(&["".into()]).is_err());
    }
}

impl From<ServiceRecord> for ServiceResponse {
    fn from(record: ServiceRecord) -> Self {
        Self {
            id: record.id,
            tenant_id: record.tenant_id,
            branch_id: record.branch_id,
            name: record.name,
            category: record.category,
            duration_minutes: record.duration_minutes,
            price_paise: record.price_paise,
            gst_percent: record.gst_percent,
            sac_code: record.sac_code,
            wait_time_minutes: record.wait_time_minutes,
            cleanup_time_minutes: record.cleanup_time_minutes,
            buffer_time_minutes: record.buffer_time_minutes,
            product_consumption: serde_json::from_str(&record.product_consumption_json)
                .unwrap_or(Value::Array(vec![])),
            staff_ids: serde_json::from_str(&record.staff_ids_json).unwrap_or(Value::Array(vec![])),
            variants: serde_json::from_str(&record.variants_json).unwrap_or(Value::Array(vec![])),
            addons: serde_json::from_str(&record.addons_json).unwrap_or(Value::Array(vec![])),
            staff_prices: serde_json::from_str(&record.staff_prices_json)
                .unwrap_or(Value::Array(vec![])),
            price_rules: serde_json::from_str(&record.price_rules_json)
                .unwrap_or(Value::Array(vec![])),
            central_master_service_id: record.central_master_service_id,
            franchise_override_fields: record.franchise_override_fields,
            active: record.active,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}
