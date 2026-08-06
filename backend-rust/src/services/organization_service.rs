use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::PgPool;
use std::collections::BTreeSet;
use uuid::Uuid;

use crate::{
    models::common::AppError,
    repositories::organization_repository::{self, HolidayWrite, OperatingHourWrite},
};

const BUSINESS_TYPES: &[&str] = &[
    "salon",
    "spa",
    "medspa",
    "fitness",
    "barbershop",
    "wellness",
    "multi_vertical",
];
const VERTICAL_PACKS: &[&str] = &["salon", "spa", "medspa", "fitness", "barbershop"];
const TERMINOLOGY_KEYS: &[&str] = &[
    "guest",
    "staff",
    "appointment",
    "location",
    "class",
    "queue",
];
const UNIT_KINDS: &[&str] = &["business_unit", "revenue_center"];
const USAGE_METRICS: &[&str] = &[
    "api_calls",
    "messages",
    "storage_mb",
    "provider_units",
    "sms",
    "whatsapp",
    "email",
    "ai_tokens",
    "custom",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizationProfileInput {
    pub business_type: String,
    pub expected_version: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrandInput {
    pub code: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub active: bool,
    pub expected_version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DepartmentInput {
    pub branch_id: String,
    pub brand_id: Option<String>,
    pub code: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub active: bool,
    pub expected_version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizationUnitInput {
    pub branch_id: Option<String>,
    pub kind: String,
    pub code: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub active: bool,
    pub expected_version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperatingHourInput {
    pub weekday: i16,
    pub opens_at: Option<String>,
    pub closes_at: Option<String>,
    #[serde(default)]
    pub closed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocationOperationsInput {
    pub brand_id: Option<String>,
    pub time_zone: String,
    pub currency_code: String,
    pub operating_hours: Vec<OperatingHourInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HolidayInput {
    pub holiday_date: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub closed: bool,
    pub opens_at: Option<String>,
    pub closes_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigInput {
    pub value: Value,
    pub expected_version: i32,
    #[serde(default)]
    pub allow_location_override: bool,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RollbackInput {
    pub expected_version: i32,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebsiteDraftInput {
    pub draft: Value,
    pub expected_version: i32,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebsitePublishInput {
    pub expected_version: i32,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TenantLifecycleInput {
    pub status: String,
    pub grace_period_ends_at: Option<DateTime<Utc>>,
    pub reason: String,
    pub expected_version: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeatureOverrideInput {
    pub enabled: bool,
    pub expires_at: Option<DateTime<Utc>>,
    pub reason: String,
    pub expected_version: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UsageQuotaInput {
    pub subscription_id: String,
    pub metric: String,
    pub included_quantity: i64,
    pub hard_limit_quantity: Option<i64>,
    pub overage_unit_paise: i64,
    pub expected_version: i32,
}

fn default_true() -> bool {
    true
}

pub async fn snapshot(db: &PgPool, tenant_id: &str, branch_id: &str) -> Result<Value, AppError> {
    require_uuid(branch_id, "branchId")?;
    organization_repository::snapshot(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load organization control plane"))?
        .ok_or_else(|| AppError::not_found("organization was not found"))
}

pub async fn platform_snapshot(
    db: &PgPool,
    tenant_id: &str,
    branch_id: Option<&str>,
) -> Result<Value, AppError> {
    require_uuid(tenant_id, "tenantId")?;
    optional_uuid(branch_id, "branchId")?;
    let branch_id = match branch_id.filter(|value| !value.trim().is_empty()) {
        Some(value) => value.to_string(),
        None => organization_repository::first_branch_id(db, tenant_id)
            .await
            .map_err(|_| AppError::internal("failed to resolve tenant location"))?
            .ok_or_else(|| AppError::not_found("tenant has no location"))?,
    };
    snapshot(db, tenant_id, &branch_id).await
}

pub async fn update_profile(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    payload: OrganizationProfileInput,
) -> Result<Value, AppError> {
    let business_type = payload.business_type.trim().to_ascii_lowercase();
    if !BUSINESS_TYPES.contains(&business_type.as_str()) || payload.expected_version < 1 {
        return Err(AppError::validation("organization profile is invalid"));
    }
    if !organization_repository::update_profile(
        db,
        tenant_id,
        &business_type,
        payload.expected_version,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to update organization profile"))?
    {
        return Err(AppError::conflict(
            "organization profile changed; reload and try again",
        ));
    }
    snapshot(db, tenant_id, branch_id).await
}

pub async fn save_brand(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    id: Option<&str>,
    payload: BrandInput,
) -> Result<Value, AppError> {
    validate_optional_id(id, payload.expected_version)?;
    let (code, name) = identity(&payload.code, &payload.name)?;
    organization_repository::save_brand(
        db,
        tenant_id,
        id,
        &code,
        &name,
        payload.active,
        payload.expected_version,
        actor,
    )
    .await
    .map_err(map_write_error)?
    .ok_or_else(|| AppError::conflict("brand changed; reload and try again"))?;
    snapshot(db, tenant_id, branch_id).await
}

pub async fn save_department(
    db: &PgPool,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    id: Option<&str>,
    payload: DepartmentInput,
) -> Result<Value, AppError> {
    validate_optional_id(id, payload.expected_version)?;
    require_uuid(&payload.branch_id, "branchId")?;
    optional_uuid(payload.brand_id.as_deref(), "brandId")?;
    let (code, name) = identity(&payload.code, &payload.name)?;
    organization_repository::save_department(
        db,
        tenant_id,
        id,
        &payload.branch_id,
        payload.brand_id.as_deref(),
        &code,
        &name,
        payload.active,
        payload.expected_version,
        actor,
    )
    .await
    .map_err(map_write_error)?
    .ok_or_else(|| AppError::conflict("department changed or location is outside this tenant"))?;
    snapshot(db, tenant_id, current_branch_id).await
}

pub async fn save_unit(
    db: &PgPool,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    id: Option<&str>,
    payload: OrganizationUnitInput,
) -> Result<Value, AppError> {
    validate_optional_id(id, payload.expected_version)?;
    optional_uuid(payload.branch_id.as_deref(), "branchId")?;
    let kind = payload.kind.trim().to_ascii_lowercase();
    if !UNIT_KINDS.contains(&kind.as_str()) {
        return Err(AppError::validation("organization unit kind is invalid"));
    }
    let (code, name) = identity(&payload.code, &payload.name)?;
    organization_repository::save_unit(
        db,
        tenant_id,
        id,
        payload.branch_id.as_deref(),
        &kind,
        &code,
        &name,
        payload.active,
        payload.expected_version,
        actor,
    )
    .await
    .map_err(map_write_error)?
    .ok_or_else(|| {
        AppError::conflict("organization unit changed or location is outside this tenant")
    })?;
    snapshot(db, tenant_id, current_branch_id).await
}

pub async fn save_location_operations(
    db: &PgPool,
    tenant_id: &str,
    _current_branch_id: &str,
    actor: &str,
    location_id: &str,
    payload: LocationOperationsInput,
) -> Result<Value, AppError> {
    require_uuid(location_id, "locationId")?;
    optional_uuid(payload.brand_id.as_deref(), "brandId")?;
    let timezone = payload.time_zone.trim();
    if timezone.is_empty()
        || timezone.len() > 64
        || !organization_repository::timezone_exists(db, timezone)
            .await
            .map_err(|_| AppError::internal("failed to validate location timezone"))?
    {
        return Err(AppError::validation("location timezone is invalid"));
    }
    let currency = payload.currency_code.trim().to_ascii_uppercase();
    if currency.len() != 3 || !currency.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return Err(AppError::validation("location currency code is invalid"));
    }
    let hours = operating_hours(payload.operating_hours)?;
    if !organization_repository::save_location_operations(
        db,
        tenant_id,
        location_id,
        payload.brand_id.as_deref(),
        timezone,
        &currency,
        &hours,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save location operations"))?
    {
        return Err(AppError::not_found(
            "location or brand was not found in this tenant",
        ));
    }
    snapshot(db, tenant_id, location_id).await
}

pub async fn save_holiday(
    db: &PgPool,
    tenant_id: &str,
    _current_branch_id: &str,
    actor: &str,
    location_id: &str,
    payload: HolidayInput,
) -> Result<Value, AppError> {
    require_uuid(location_id, "locationId")?;
    let name = normalized_name(&payload.name)?;
    let date = NaiveDate::parse_from_str(payload.holiday_date.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::validation("holidayDate is invalid"))?;
    let (opens_at, closes_at) = hours_pair(payload.closed, payload.opens_at, payload.closes_at)?;
    let holiday = HolidayWrite {
        holiday_date: date,
        name,
        closed: payload.closed,
        opens_at,
        closes_at,
    };
    if !organization_repository::save_holiday(db, tenant_id, location_id, &holiday, actor)
        .await
        .map_err(map_write_error)?
    {
        return Err(AppError::not_found("location was not found in this tenant"));
    }
    snapshot(db, tenant_id, location_id).await
}

#[allow(clippy::too_many_arguments)]
pub async fn save_config(
    db: &PgPool,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    location_id: Option<&str>,
    key: &str,
    payload: ConfigInput,
) -> Result<Value, AppError> {
    validate_config(
        location_id,
        key,
        &payload.value,
        payload.expected_version,
        &payload.reason,
    )?;
    organization_repository::save_config(
        db,
        tenant_id,
        location_id,
        key,
        &payload.value,
        payload.expected_version,
        location_id.is_none() && payload.allow_location_override,
        payload.reason.trim(),
        actor,
        None,
    )
    .await
    .map_err(map_write_error)?
    .ok_or_else(|| {
        AppError::conflict("configuration changed or location override is not allowed")
    })?;
    snapshot(db, tenant_id, location_id.unwrap_or(current_branch_id)).await
}

#[allow(clippy::too_many_arguments)]
pub async fn rollback_config(
    db: &PgPool,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    location_id: Option<&str>,
    key: &str,
    source_version: i32,
    payload: RollbackInput,
) -> Result<Value, AppError> {
    validate_config_key(location_id, key)?;
    validate_reason(&payload.reason)?;
    if source_version < 1 || payload.expected_version < 1 {
        return Err(AppError::validation("configuration version is invalid"));
    }
    let (value, allow_override) =
        organization_repository::config_version(db, tenant_id, location_id, key, source_version)
            .await
            .map_err(|_| AppError::internal("failed to load configuration history"))?
            .ok_or_else(|| AppError::not_found("configuration version was not found"))?;
    organization_repository::save_config(
        db,
        tenant_id,
        location_id,
        key,
        &value,
        payload.expected_version,
        location_id.is_none() && allow_override,
        payload.reason.trim(),
        actor,
        Some(source_version),
    )
    .await
    .map_err(map_write_error)?
    .ok_or_else(|| AppError::conflict("configuration changed; reload and try again"))?;
    snapshot(db, tenant_id, location_id.unwrap_or(current_branch_id)).await
}

pub async fn save_website_draft(
    db: &PgPool,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    payload: WebsiteDraftInput,
) -> Result<Value, AppError> {
    validate_reason(&payload.reason)?;
    validate_website_document(&payload.draft)?;
    let published = organization_repository::active_config(db, tenant_id, None, "website")
        .await
        .map_err(|_| AppError::internal("failed to load website configuration"))?
        .map(|(value, _)| value["published"].clone())
        .unwrap_or(Value::Null);
    let value = json!({"draft": payload.draft, "published": published});
    organization_repository::save_config(
        db,
        tenant_id,
        None,
        "website",
        &value,
        payload.expected_version,
        false,
        payload.reason.trim(),
        actor,
        None,
    )
    .await
    .map_err(map_write_error)?
    .ok_or_else(|| AppError::conflict("website draft changed; reload and try again"))?;
    snapshot(db, tenant_id, current_branch_id).await
}

pub async fn publish_website(
    db: &PgPool,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    payload: WebsitePublishInput,
) -> Result<Value, AppError> {
    validate_reason(&payload.reason)?;
    let (current, _) = organization_repository::active_config(db, tenant_id, None, "website")
        .await
        .map_err(|_| AppError::internal("failed to load website configuration"))?
        .ok_or_else(|| AppError::validation("save a website draft before publishing"))?;
    let draft = current.get("draft").cloned().unwrap_or(Value::Null);
    validate_website_document(&draft)?;
    let revision = current["published"]["revision"].as_i64().unwrap_or(0) + 1;
    let mut published = draft.clone();
    let object = published
        .as_object_mut()
        .ok_or_else(|| AppError::validation("website draft is invalid"))?;
    object.insert("revision".into(), revision.into());
    object.insert("publishedAt".into(), Utc::now().to_rfc3339().into());
    let value = json!({"draft": draft, "published": published});
    organization_repository::save_config(
        db,
        tenant_id,
        None,
        "website",
        &value,
        payload.expected_version,
        false,
        payload.reason.trim(),
        actor,
        None,
    )
    .await
    .map_err(map_write_error)?
    .ok_or_else(|| AppError::conflict("website changed; reload and try again"))?;
    snapshot(db, tenant_id, current_branch_id).await
}

pub async fn public_website(db: &PgPool, tenant_id: &str) -> Result<Value, AppError> {
    let published = organization_repository::active_config(db, tenant_id, None, "website")
        .await
        .map_err(|_| AppError::internal("failed to load published website"))?
        .map(|(value, _)| value["published"].clone())
        .filter(Value::is_object)
        .unwrap_or(Value::Null);
    Ok(published)
}

pub async fn update_lifecycle(
    db: &PgPool,
    tenant_id: &str,
    actor: &str,
    payload: TenantLifecycleInput,
) -> Result<(), AppError> {
    require_uuid(tenant_id, "tenantId")?;
    let status = payload.status.trim().to_ascii_lowercase();
    if !matches!(status.as_str(), "active" | "grace" | "suspended") || payload.expected_version < 1
    {
        return Err(AppError::validation("tenant lifecycle state is invalid"));
    }
    if status == "grace"
        && !payload
            .grace_period_ends_at
            .is_some_and(|end| end > Utc::now())
    {
        return Err(AppError::validation("grace period must end in the future"));
    }
    validate_reason(&payload.reason)?;
    if !organization_repository::update_lifecycle(
        db,
        tenant_id,
        &status,
        (status == "grace")
            .then_some(payload.grace_period_ends_at)
            .flatten(),
        payload.reason.trim(),
        payload.expected_version,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to update tenant lifecycle"))?
    {
        return Err(AppError::conflict(
            "tenant lifecycle changed; reload and try again",
        ));
    }
    Ok(())
}

pub async fn save_feature_override(
    db: &PgPool,
    tenant_id: &str,
    feature_key: &str,
    actor: &str,
    payload: FeatureOverrideInput,
) -> Result<(), AppError> {
    require_uuid(tenant_id, "tenantId")?;
    validate_key(feature_key, "featureKey")?;
    validate_reason(&payload.reason)?;
    if payload.expected_version < 0
        || payload
            .expires_at
            .is_some_and(|expires| expires <= Utc::now())
    {
        return Err(AppError::validation("feature override is invalid"));
    }
    if !organization_repository::save_feature_override(
        db,
        tenant_id,
        feature_key,
        payload.enabled,
        payload.expires_at,
        payload.reason.trim(),
        payload.expected_version,
        actor,
    )
    .await
    .map_err(map_write_error)?
    {
        return Err(AppError::conflict(
            "feature override changed; reload and try again",
        ));
    }
    Ok(())
}

pub async fn save_usage_quota(
    db: &PgPool,
    tenant_id: &str,
    actor: &str,
    payload: UsageQuotaInput,
) -> Result<(), AppError> {
    require_uuid(tenant_id, "tenantId")?;
    require_uuid(&payload.subscription_id, "subscriptionId")?;
    let metric = payload.metric.trim().to_ascii_lowercase();
    if !USAGE_METRICS.contains(&metric.as_str())
        || payload.included_quantity < 0
        || payload.overage_unit_paise < 0
        || payload.expected_version < 0
        || payload
            .hard_limit_quantity
            .is_some_and(|limit| limit < payload.included_quantity)
    {
        return Err(AppError::validation("usage quota is invalid"));
    }
    if !organization_repository::save_usage_quota(
        db,
        tenant_id,
        &payload.subscription_id,
        &metric,
        payload.included_quantity,
        payload.hard_limit_quantity,
        payload.overage_unit_paise,
        payload.expected_version,
        actor,
    )
    .await
    .map_err(map_write_error)?
    {
        return Err(AppError::conflict(
            "usage quota changed; reload and try again",
        ));
    }
    Ok(())
}

fn identity(code: &str, name: &str) -> Result<(String, String), AppError> {
    let code = code.trim().to_ascii_uppercase();
    if !(2..=40).contains(&code.len())
        || !code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(AppError::validation("organization code is invalid"));
    }
    Ok((code, normalized_name(name)?))
}

fn normalized_name(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if !(2..=120).contains(&value.chars().count()) {
        return Err(AppError::validation("organization name is invalid"));
    }
    Ok(value.to_string())
}

fn operating_hours(input: Vec<OperatingHourInput>) -> Result<Vec<OperatingHourWrite>, AppError> {
    if input.len() != 7 {
        return Err(AppError::validation(
            "operating hours require all seven weekdays",
        ));
    }
    let mut weekdays = BTreeSet::new();
    input
        .into_iter()
        .map(|hour| {
            if !(0..=6).contains(&hour.weekday) || !weekdays.insert(hour.weekday) {
                return Err(AppError::validation(
                    "operating weekday is invalid or duplicated",
                ));
            }
            let (opens_at, closes_at) = hours_pair(hour.closed, hour.opens_at, hour.closes_at)?;
            Ok(OperatingHourWrite {
                weekday: hour.weekday,
                opens_at,
                closes_at,
                closed: hour.closed,
            })
        })
        .collect()
}

fn hours_pair(
    closed: bool,
    opens_at: Option<String>,
    closes_at: Option<String>,
) -> Result<(Option<NaiveTime>, Option<NaiveTime>), AppError> {
    if closed {
        if opens_at
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            || closes_at
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        {
            return Err(AppError::validation(
                "closed day cannot include opening hours",
            ));
        }
        return Ok((None, None));
    }
    let parse = |value: Option<String>| {
        NaiveTime::parse_from_str(value.as_deref().unwrap_or("").trim(), "%H:%M")
            .map_err(|_| AppError::validation("opening hours must use HH:MM"))
    };
    let opens = parse(opens_at)?;
    let closes = parse(closes_at)?;
    if opens >= closes {
        return Err(AppError::validation(
            "opening time must be before closing time",
        ));
    }
    Ok((Some(opens), Some(closes)))
}

fn validate_config(
    location_id: Option<&str>,
    key: &str,
    value: &Value,
    expected_version: i32,
    reason: &str,
) -> Result<(), AppError> {
    validate_config_key(location_id, key)?;
    validate_reason(reason)?;
    if expected_version < 0 || !value.is_object() || value.to_string().len() > 65_536 {
        return Err(AppError::validation("configuration payload is invalid"));
    }
    if key == "enterprise_verticals" {
        validate_enterprise_verticals(value)?;
    } else if key == "website" {
        let draft = value.get("draft").unwrap_or(&Value::Null);
        validate_website_document(draft)?;
    }
    Ok(())
}

fn validate_website_document(value: &Value) -> Result<(), AppError> {
    let object = website_object(value, "website draft")?;
    allowed_fields(object, &["template", "siteName", "pages"], "website draft")?;
    let template = required_text(object, "template", 3, 24)?;
    if !matches!(template, "classic" | "minimal" | "editorial") {
        return Err(AppError::validation("website template is invalid"));
    }
    required_text(object, "siteName", 1, 120)?;
    let pages = object
        .get("pages")
        .and_then(Value::as_array)
        .filter(|pages| (1..=20).contains(&pages.len()))
        .ok_or_else(|| AppError::validation("website pages must contain 1 to 20 pages"))?;
    let mut slugs = BTreeSet::new();
    let mut page_ids = BTreeSet::new();
    for page in pages {
        let page = website_object(page, "website page")?;
        allowed_fields(
            page,
            &[
                "id",
                "slug",
                "title",
                "navigationLabel",
                "seoTitle",
                "seoDescription",
                "visible",
                "showInNavigation",
                "sections",
            ],
            "website page",
        )?;
        let id = required_key(page, "id", 64)?;
        let slug = required_key(page, "slug", 60)?;
        if !page_ids.insert(id) || !slugs.insert(slug) {
            return Err(AppError::validation(
                "website page ids and slugs must be unique",
            ));
        }
        required_text(page, "title", 1, 120)?;
        optional_text(page, "navigationLabel", 40)?;
        required_text(page, "seoTitle", 1, 70)?;
        optional_text(page, "seoDescription", 160)?;
        required_bool(page, "visible")?;
        required_bool(page, "showInNavigation")?;
        let sections = page
            .get("sections")
            .and_then(Value::as_array)
            .filter(|sections| (1..=30).contains(&sections.len()))
            .ok_or_else(|| {
                AppError::validation("website page sections must contain 1 to 30 sections")
            })?;
        let mut section_ids = BTreeSet::new();
        for section in sections {
            let section = website_object(section, "website section")?;
            allowed_fields(
                section,
                &[
                    "id",
                    "type",
                    "heading",
                    "body",
                    "imageUrl",
                    "buttonLabel",
                    "buttonUrl",
                    "visible",
                ],
                "website section",
            )?;
            let section_id = required_key(section, "id", 64)?;
            if !section_ids.insert(section_id) {
                return Err(AppError::validation(
                    "website section ids must be unique within a page",
                ));
            }
            let kind = required_text(section, "type", 3, 20)?;
            if !matches!(kind, "hero" | "text" | "services" | "booking" | "contact") {
                return Err(AppError::validation("website section type is invalid"));
            }
            optional_text(section, "heading", 120)?;
            optional_text(section, "body", 4_000)?;
            safe_url(section, "imageUrl", false)?;
            optional_text(section, "buttonLabel", 40)?;
            safe_url(section, "buttonUrl", true)?;
            required_bool(section, "visible")?;
        }
    }
    if !slugs.contains("home") {
        return Err(AppError::validation("website requires a home page"));
    }
    Ok(())
}

fn website_object<'a>(value: &'a Value, field: &str) -> Result<&'a Map<String, Value>, AppError> {
    value
        .as_object()
        .ok_or_else(|| AppError::validation(format!("{field} is invalid")))
}

fn allowed_fields(
    object: &Map<String, Value>,
    fields: &[&str],
    label: &str,
) -> Result<(), AppError> {
    if object.keys().any(|key| !fields.contains(&key.as_str())) {
        return Err(AppError::validation(format!("{label} has unknown fields")));
    }
    Ok(())
}

fn required_text<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    min: usize,
    max: usize,
) -> Result<&'a str, AppError> {
    let value = object.get(key).and_then(Value::as_str).unwrap_or("").trim();
    if !(min..=max).contains(&value.chars().count()) {
        return Err(AppError::validation(format!("{key} is invalid")));
    }
    Ok(value)
}

fn optional_text(object: &Map<String, Value>, key: &str, max: usize) -> Result<(), AppError> {
    if object
        .get(key)
        .is_some_and(|value| value.as_str().is_none_or(|text| text.chars().count() > max))
    {
        return Err(AppError::validation(format!("{key} is invalid")));
    }
    Ok(())
}

fn required_key<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    max: usize,
) -> Result<&'a str, AppError> {
    let value = required_text(object, key, 1, max)?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        || value.starts_with('-')
        || value.ends_with('-')
    {
        return Err(AppError::validation(format!("{key} is invalid")));
    }
    Ok(value)
}

fn required_bool(object: &Map<String, Value>, key: &str) -> Result<(), AppError> {
    if object.get(key).and_then(Value::as_bool).is_none() {
        return Err(AppError::validation(format!("{key} is invalid")));
    }
    Ok(())
}

fn safe_url(object: &Map<String, Value>, key: &str, allow_relative: bool) -> Result<(), AppError> {
    let value = object.get(key).and_then(Value::as_str).unwrap_or("").trim();
    if value.is_empty()
        || value.starts_with("https://")
        || (allow_relative
            && ((value.starts_with('/') && !value.starts_with("//"))
                || (value.starts_with('#') && value.len() > 1)))
    {
        return Ok(());
    }
    Err(AppError::validation(format!(
        "{key} must be empty, HTTPS or an internal path"
    )))
}

fn validate_enterprise_verticals(value: &Value) -> Result<(), AppError> {
    let object = value
        .as_object()
        .ok_or_else(|| AppError::validation("enterprise vertical policy is invalid"))?;
    if object.keys().any(|key| {
        !matches!(
            key.as_str(),
            "enabledVerticals" | "taxJurisdiction" | "dataResidencyRegion" | "terminology"
        )
    }) {
        return Err(AppError::validation(
            "enterprise vertical policy has unknown fields",
        ));
    }

    let verticals = object
        .get("enabledVerticals")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::validation("enabledVerticals is required"))?;
    let mut unique = BTreeSet::new();
    if verticals.is_empty()
        || verticals.len() > VERTICAL_PACKS.len()
        || verticals.iter().any(|value| {
            value
                .as_str()
                .filter(|vertical| VERTICAL_PACKS.contains(vertical) && unique.insert(*vertical))
                .is_none()
        })
    {
        return Err(AppError::validation("enabledVerticals is invalid"));
    }

    validate_policy_code(object, "taxJurisdiction", 2, 32, true)?;
    validate_policy_code(object, "dataResidencyRegion", 2, 64, false)?;

    let terminology = object
        .get("terminology")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::validation("terminology is required"))?;
    if terminology.is_empty()
        || terminology.len() > TERMINOLOGY_KEYS.len()
        || terminology.iter().any(|(key, value)| {
            !TERMINOLOGY_KEYS.contains(&key.as_str())
                || value
                    .as_str()
                    .is_none_or(|term| !(1..=40).contains(&term.trim().chars().count()))
        })
    {
        return Err(AppError::validation("terminology is invalid"));
    }
    Ok(())
}

fn validate_policy_code(
    object: &serde_json::Map<String, Value>,
    key: &str,
    min: usize,
    max: usize,
    uppercase: bool,
) -> Result<(), AppError> {
    let value = object.get(key).and_then(Value::as_str).unwrap_or("").trim();
    let valid_chars = value.bytes().all(|byte| {
        byte.is_ascii_digit()
            || byte == b'-'
            || byte == b'_'
            || if uppercase {
                byte.is_ascii_uppercase()
            } else {
                byte.is_ascii_lowercase()
            }
    });
    if !(min..=max).contains(&value.len()) || !valid_chars {
        return Err(AppError::validation(format!("{key} is invalid")));
    }
    Ok(())
}

fn validate_config_key(location_id: Option<&str>, key: &str) -> Result<(), AppError> {
    optional_uuid(location_id, "locationId")?;
    validate_key(key, "configKey")
}

fn validate_key(value: &str, field: &str) -> Result<(), AppError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 100
        || !value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
    {
        return Err(AppError::validation(format!("{field} is invalid")));
    }
    Ok(())
}

fn validate_reason(reason: &str) -> Result<(), AppError> {
    if !(3..=500).contains(&reason.trim().chars().count()) {
        return Err(AppError::validation(
            "change reason must be 3 to 500 characters",
        ));
    }
    Ok(())
}

fn validate_optional_id(id: Option<&str>, version: Option<i32>) -> Result<(), AppError> {
    if let Some(id) = id {
        require_uuid(id, "id")?;
        if version.unwrap_or(0) < 1 {
            return Err(AppError::validation(
                "expectedVersion is required for updates",
            ));
        }
    } else if version.is_some() {
        return Err(AppError::validation(
            "expectedVersion is not allowed when creating",
        ));
    }
    Ok(())
}

fn optional_uuid(value: Option<&str>, field: &str) -> Result<(), AppError> {
    if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
        require_uuid(value, field)?;
    }
    Ok(())
}

fn require_uuid(value: &str, field: &str) -> Result<(), AppError> {
    Uuid::parse_str(value.trim())
        .map(|_| ())
        .map_err(|_| AppError::validation(format!("{field} is invalid")))
}

fn map_write_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .and_then(|database| database.code())
        .as_deref()
        == Some("23505")
    {
        AppError::conflict("organization code or date already exists")
    } else {
        AppError::internal("failed to save organization control")
    }
}

#[cfg(test)]
mod tests {
    use super::{
        hours_pair, operating_hours, validate_config, validate_website_document, OperatingHourInput,
    };
    use serde_json::json;

    #[test]
    fn organization_hours_require_one_valid_row_per_weekday() {
        let rows = (0..7)
            .map(|weekday| OperatingHourInput {
                weekday,
                opens_at: Some("09:00".into()),
                closes_at: Some("18:00".into()),
                closed: false,
            })
            .collect();
        assert_eq!(operating_hours(rows).unwrap().len(), 7);
        assert!(hours_pair(false, Some("18:00".into()), Some("09:00".into())).is_err());
        assert!(hours_pair(true, Some("09:00".into()), None).is_err());
    }

    #[test]
    fn enterprise_vertical_policy_rejects_unknown_or_duplicate_packs() {
        let valid = json!({
            "enabledVerticals": ["salon", "medspa", "fitness"],
            "taxJurisdiction": "IN-GST",
            "dataResidencyRegion": "ap-south-1",
            "terminology": {"guest": "Guest", "staff": "Provider", "appointment": "Visit", "location": "Center"}
        });
        assert!(validate_config(None, "enterprise_verticals", &valid, 0, "Initial policy").is_ok());

        let duplicate = json!({"enabledVerticals": ["salon", "salon"], "taxJurisdiction": "IN-GST", "dataResidencyRegion": "ap-south-1", "terminology": {"guest": "Guest"}});
        assert!(validate_config(
            None,
            "enterprise_verticals",
            &duplicate,
            0,
            "Duplicate pack"
        )
        .is_err());

        let academy = json!({"enabledVerticals": ["academy"], "taxJurisdiction": "IN-GST", "dataResidencyRegion": "ap-south-1", "terminology": {"guest": "Student"}});
        assert!(
            validate_config(None, "enterprise_verticals", &academy, 0, "Unproven pack").is_err()
        );
    }

    #[test]
    fn website_requires_safe_unique_pages_and_sections() {
        let valid = json!({
            "template": "classic", "siteName": "Aura Salon", "pages": [{
                "id": "home", "slug": "home", "title": "Home", "navigationLabel": "Home",
                "seoTitle": "Aura Salon", "seoDescription": "Book salon services online.",
                "visible": true, "showInNavigation": true,
                "sections": [{"id": "hero", "type": "hero", "heading": "Welcome", "body": "", "imageUrl": "https://cdn.example.com/hero.jpg", "buttonLabel": "Book", "buttonUrl": "/book", "visible": true}]
            }]
        });
        assert!(validate_website_document(&valid).is_ok());
        let mut duplicate = valid.clone();
        duplicate["pages"]
            .as_array_mut()
            .unwrap()
            .push(valid["pages"][0].clone());
        assert!(validate_website_document(&duplicate).is_err());
        let mut unsafe_url = valid;
        unsafe_url["pages"][0]["sections"][0]["imageUrl"] = "javascript:alert(1)".into();
        assert!(validate_website_document(&unsafe_url).is_err());
    }
}
