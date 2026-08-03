use qrcodegen::{QrCode, QrCodeEcc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    models::common::AppError, repositories::inventory_governance_repository as repo,
    services::invoice_delivery, state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PolicyWrite {
    pub negative_stock_rule: String,
    #[serde(default = "default_true")]
    pub auto_checkout_retail_sales: bool,
    #[serde(default = "default_true")]
    pub auto_checkout_service_consumption: bool,
    pub valuation_method: String,
    pub expiry_window_days: i32,
    pub count_variance_threshold_bps: i32,
    #[serde(default = "default_count_value_variance_threshold_paise")]
    pub count_value_variance_threshold_paise: i64,
    #[serde(default)]
    pub allow_zero_unaudited_audit: bool,
    #[serde(default = "default_reorder_history_days")]
    pub reorder_history_days: i32,
    #[serde(default = "default_reorder_coverage_days")]
    pub reorder_coverage_days: i32,
    #[serde(default = "default_partial_delivery_policy")]
    pub partial_delivery_policy: String,
    pub financial_lock_date: Option<String>,
    #[serde(default = "default_edit_lock_days")]
    pub edit_lock_days: i32,
    #[serde(default)]
    pub master_edit_lock: bool,
    #[serde(default = "default_excess_receiving_policy")]
    pub excess_receiving_policy: String,
    #[serde(default = "default_true")]
    pub price_difference_prompt: bool,
    #[serde(default)]
    pub price_difference_threshold_bps: i32,
    pub transfer_base_transport_cost_paise: Option<i64>,
    pub transfer_cost_per_km_paise: Option<i64>,
    pub transfer_handling_cost_per_unit_paise: Option<i64>,
    pub transfer_delay_cost_per_unit_day_paise: Option<i64>,
    pub transfer_expected_days: Option<i32>,
    pub approval_matrix: Value,
    #[serde(default = "default_stock_action_matrix")]
    pub stock_action_matrix: Value,
    #[serde(default = "default_purchase_order_settings")]
    pub purchase_order_settings: Value,
    #[serde(default = "default_label_settings")]
    pub label_settings: Value,
}
fn default_reorder_history_days() -> i32 {
    60
}
fn default_count_value_variance_threshold_paise() -> i64 {
    10_000
}
fn default_reorder_coverage_days() -> i32 {
    30
}
fn default_partial_delivery_policy() -> String {
    "allow".to_owned()
}
fn default_excess_receiving_policy() -> String {
    "permission_required".to_owned()
}
fn default_true() -> bool {
    true
}
fn default_edit_lock_days() -> i32 {
    90
}
fn default_stock_action_matrix() -> Value {
    json!({"receipt":true,"transfer":true,"adjustment":true,"audit":true,"consumption":true,"returns":true,"kit":true})
}
fn default_purchase_order_settings() -> Value {
    json!({"numberPrefix":"PO","approvalRequired":true,"approvalThresholdPaise":0,"bulkRaiseEnabled":true,"supplierElectronicDelivery":false})
}
fn default_label_settings() -> Value {
    json!({"priceCaption":"MRP","showName":true,"showPrice":true,"showSku":true,"showBatch":true,"showExpiry":true,"widthMm":76,"heightMm":32,"columns":5,"terms":{"product":"Product","retail":"Retail","consumable":"Consumable","stock":"Stock"}})
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PriceWrite {
    pub supplier_id: String,
    pub inventory_item_id: String,
    pub unit_cost_paise: i64,
    #[serde(default)]
    pub discount_bps: i32,
    #[serde(default)]
    pub gst_percent: i32,
    pub effective_from: String,
    pub effective_to: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommunicationWrite {
    pub supplier_id: String,
    pub purchase_order_id: Option<String>,
    pub channel: String,
    pub destination: String,
    #[serde(default)]
    pub subject: String,
    pub message: String,
    pub idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContainerWrite {
    pub inventory_item_id: String,
    pub barcode: String,
    pub batch_id: Option<String>,
    pub capacity_quantity: i32,
    pub unit: String,
    pub idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContainerAction {
    pub idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConsumeWrite {
    pub quantity: i32,
    pub idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverrideWrite {
    pub requested_remaining: i32,
    pub reason: String,
    pub idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverrideReview {
    pub decision: String,
    #[serde(default)]
    pub review_note: String,
    pub idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterValueWrite {
    pub kind: String,
    pub code: String,
    pub label: String,
    #[serde(default)]
    pub parent_code: String,
    #[serde(default = "default_true")]
    pub active: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FloorLocationWrite {
    pub code: String,
    pub name: String,
    pub location_type: String,
    #[serde(default = "default_true")]
    pub active: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContainerCustodyWrite {
    pub to_location_code: String,
    pub to_staff_id: Option<String>,
    pub reason: String,
    pub idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FloorClosingLineWrite {
    pub container_id: String,
    pub counted_remaining: i32,
    #[serde(default)]
    pub reason: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FloorClosingWrite {
    pub business_date: String,
    pub shift_label: String,
    pub lines: Vec<FloorClosingLineWrite>,
    pub idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FloorClosingReview {
    pub decision: String,
    #[serde(default)]
    pub review_note: String,
    pub idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckoutWrite {
    pub inventory_item_id: String,
    pub destination_bucket: String,
    pub quantity: i32,
    pub employee_id: String,
    #[serde(default)]
    pub comment: String,
    pub idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversionWrite {
    pub inventory_item_id: String,
    pub source_bucket: String,
    pub destination_bucket: String,
    pub quantity: i32,
    pub employee_id: String,
    #[serde(default)]
    pub comment: String,
    pub idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MovementReversalWrite {
    pub comment: String,
    pub idempotency_key: String,
}

fn db_error(error: sqlx::Error, message: &str) -> AppError {
    match error {
        sqlx::Error::RowNotFound => AppError::validation(message),
        sqlx::Error::Database(ref e) if e.is_unique_violation() => AppError::conflict(message),
        sqlx::Error::Database(ref e) if e.code().as_deref() == Some("23514") => {
            AppError::validation(message)
        }
        sqlx::Error::Protocol(ref value) if value.contains("maker cannot") => {
            AppError::forbidden(value.to_string())
        }
        sqlx::Error::Protocol(value) => AppError::validation(value.to_string()),
        _ => AppError::internal(message),
    }
}
fn text(value: &str, name: &str, max: usize) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(AppError::validation(format!("{name} is invalid")));
    }
    Ok(value.to_owned())
}

pub async fn policy(db: &PgPool, t: &str, b: &str) -> Result<Value, AppError> {
    Ok(repo::policy(db,t,b).await.map_err(|e|db_error(e,"failed to load inventory policy"))?.unwrap_or_else(||json!({"negativeStockRule":"block","autoCheckoutRetailSales":true,"autoCheckoutServiceConsumption":true,"valuationMethod":"weighted_average","expiryWindowDays":30,"countVarianceThresholdBps":500,"countValueVarianceThresholdPaise":10000,"allowZeroUnauditedAudit":false,"reorderHistoryDays":60,"reorderCoverageDays":30,"partialDeliveryPolicy":"allow","financialLockDate":null,"editLockDays":90,"masterEditLock":false,"excessReceivingPolicy":"permission_required","priceDifferencePrompt":true,"priceDifferenceThresholdBps":0,"transferBaseTransportCostPaise":null,"transferCostPerKmPaise":null,"transferHandlingCostPerUnitPaise":null,"transferDelayCostPerUnitDayPaise":null,"transferExpectedDays":null,"approvalMatrix":{"negativeStock":"owner","stockCount":"inventory_manager","backbarOverride":"owner"},"stockActionMatrix":default_stock_action_matrix(),"purchaseOrderSettings":default_purchase_order_settings(),"labelSettings":default_label_settings()})))
}
pub async fn save_policy(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    p: PolicyWrite,
) -> Result<Value, AppError> {
    if !matches!(
        p.negative_stock_rule.as_str(),
        "block" | "approval_required" | "allow_with_warning"
    ) {
        return Err(AppError::validation("negative stock rule is invalid"));
    }
    if !matches!(p.valuation_method.as_str(), "weighted_average" | "fifo") {
        return Err(AppError::validation("valuation method is invalid"));
    }
    if !matches!(p.partial_delivery_policy.as_str(), "allow" | "block")
        || !matches!(
            p.excess_receiving_policy.as_str(),
            "block" | "permission_required"
        )
        || !(0..=10_000).contains(&p.price_difference_threshold_bps)
        || !(0..=3650).contains(&p.edit_lock_days)
        || p.financial_lock_date
            .as_deref()
            .is_some_and(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_err())
    {
        return Err(AppError::validation("inventory lock policy is invalid"));
    }
    let transfer_cost_fields = [
        p.transfer_base_transport_cost_paise.is_some(),
        p.transfer_cost_per_km_paise.is_some(),
        p.transfer_handling_cost_per_unit_paise.is_some(),
        p.transfer_delay_cost_per_unit_day_paise.is_some(),
        p.transfer_expected_days.is_some(),
    ];
    if !(1..=3650).contains(&p.expiry_window_days)
        || !(0..=10000).contains(&p.count_variance_threshold_bps)
        || !(0..=1_000_000_000_000).contains(&p.count_value_variance_threshold_paise)
        || !(14..=365).contains(&p.reorder_history_days)
        || !(7..=180).contains(&p.reorder_coverage_days)
        || !p.approval_matrix.is_object()
        || !valid_stock_action_matrix(&p.stock_action_matrix)
        || !valid_purchase_order_settings(&p.purchase_order_settings)
        || !valid_label_settings(&p.label_settings)
        || (transfer_cost_fields.iter().any(|value| *value)
            && !transfer_cost_fields.iter().all(|value| *value))
        || p.transfer_base_transport_cost_paise
            .is_some_and(|value| !(0..=1_000_000_000).contains(&value))
        || p.transfer_cost_per_km_paise
            .is_some_and(|value| !(0..=1_000_000_000).contains(&value))
        || p.transfer_handling_cost_per_unit_paise
            .is_some_and(|value| !(0..=10_000_000).contains(&value))
        || p.transfer_delay_cost_per_unit_day_paise
            .is_some_and(|value| !(0..=10_000_000).contains(&value))
        || p.transfer_expected_days
            .is_some_and(|value| !(0..=365).contains(&value))
    {
        return Err(AppError::validation("inventory policy values are invalid"));
    }
    let existing = repo::policy(db, t, b)
        .await
        .map_err(|e| db_error(e, "failed to load inventory policy"))?;
    let saved_i64 = |key: &str| {
        existing
            .as_ref()
            .and_then(|value| value.get(key))
            .and_then(Value::as_i64)
    };
    let transfer_base_transport_cost_paise = p
        .transfer_base_transport_cost_paise
        .or_else(|| saved_i64("transferBaseTransportCostPaise"));
    let transfer_cost_per_km_paise = p
        .transfer_cost_per_km_paise
        .or_else(|| saved_i64("transferCostPerKmPaise"));
    let transfer_handling_cost_per_unit_paise = p
        .transfer_handling_cost_per_unit_paise
        .or_else(|| saved_i64("transferHandlingCostPerUnitPaise"));
    let transfer_delay_cost_per_unit_day_paise = p
        .transfer_delay_cost_per_unit_day_paise
        .or_else(|| saved_i64("transferDelayCostPerUnitDayPaise"));
    let transfer_expected_days = p
        .transfer_expected_days
        .or_else(|| saved_i64("transferExpectedDays").and_then(|value| i32::try_from(value).ok()));
    repo::save_policy(
        db,
        t,
        b,
        actor,
        &p.negative_stock_rule,
        p.auto_checkout_retail_sales,
        p.auto_checkout_service_consumption,
        &p.valuation_method,
        p.expiry_window_days,
        p.count_variance_threshold_bps,
        p.count_value_variance_threshold_paise,
        p.reorder_history_days,
        p.reorder_coverage_days,
        &p.partial_delivery_policy,
        p.financial_lock_date.as_deref(),
        p.edit_lock_days,
        p.master_edit_lock,
        &p.excess_receiving_policy,
        p.price_difference_prompt,
        p.price_difference_threshold_bps,
        transfer_base_transport_cost_paise,
        transfer_cost_per_km_paise,
        transfer_handling_cost_per_unit_paise,
        transfer_delay_cost_per_unit_day_paise,
        transfer_expected_days,
        &p.approval_matrix,
        p.allow_zero_unaudited_audit,
        &p.stock_action_matrix,
        &p.purchase_order_settings,
        &p.label_settings,
    )
    .await
    .map_err(|e| db_error(e, "failed to save inventory policy"))
}

fn valid_stock_action_matrix(value: &Value) -> bool {
    [
        "receipt",
        "transfer",
        "adjustment",
        "audit",
        "consumption",
        "returns",
        "kit",
    ]
    .into_iter()
    .all(|key| value.get(key).is_some_and(Value::is_boolean))
}

fn valid_purchase_order_settings(value: &Value) -> bool {
    let Some(prefix) = value.get("numberPrefix").and_then(Value::as_str) else {
        return false;
    };
    !prefix.is_empty()
        && prefix.len() <= 12
        && prefix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        && value.get("approvalRequired").is_some_and(Value::is_boolean)
        && value.get("bulkRaiseEnabled").is_some_and(Value::is_boolean)
        && value
            .get("supplierElectronicDelivery")
            .is_some_and(Value::is_boolean)
        && value
            .get("approvalThresholdPaise")
            .and_then(Value::as_i64)
            .is_some_and(|v| (0..=1_000_000_000_000).contains(&v))
}

fn valid_label_settings(value: &Value) -> bool {
    value
        .get("priceCaption")
        .and_then(Value::as_str)
        .is_some_and(|v| !v.trim().is_empty() && v.chars().count() <= 30)
        && [
            "showName",
            "showPrice",
            "showSku",
            "showBatch",
            "showExpiry",
        ]
        .into_iter()
        .all(|key| value.get(key).is_some_and(Value::is_boolean))
        && value
            .get("widthMm")
            .and_then(Value::as_i64)
            .is_some_and(|v| (20..=100).contains(&v))
        && value
            .get("heightMm")
            .and_then(Value::as_i64)
            .is_some_and(|v| (15..=80).contains(&v))
        && value
            .get("columns")
            .and_then(Value::as_i64)
            .is_some_and(|v| (1..=8).contains(&v))
        && ["product", "retail", "consumable", "stock"]
            .into_iter()
            .all(|key| {
                value
                    .get("terms")
                    .and_then(|terms| terms.get(key))
                    .and_then(Value::as_str)
                    .is_some_and(|term| !term.trim().is_empty() && term.chars().count() <= 30)
            })
}
pub async fn supplier_governance(
    db: &PgPool,
    t: &str,
    b: &str,
    s: Option<&str>,
) -> Result<Value, AppError> {
    repo::supplier_governance(db, t, b, s)
        .await
        .map_err(|e| db_error(e, "failed to load supplier governance"))
}
pub async fn save_price(
    db: &PgPool,
    t: &str,
    b: &str,
    a: &str,
    p: PriceWrite,
) -> Result<Value, AppError> {
    if p.unit_cost_paise < 0
        || !(0..=10_000).contains(&p.discount_bps)
        || !(0..=100).contains(&p.gst_percent)
        || chrono::NaiveDate::parse_from_str(&p.effective_from, "%Y-%m-%d").is_err()
        || p.effective_to
            .as_deref()
            .is_some_and(|v| chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d").is_err())
    {
        return Err(AppError::validation("supplier price values are invalid"));
    }
    repo::save_price(
        db,
        t,
        b,
        a,
        &text(&p.supplier_id, "supplierId", 100)?,
        &text(&p.inventory_item_id, "inventoryItemId", 100)?,
        p.unit_cost_paise,
        p.discount_bps,
        p.gst_percent,
        &p.effective_from,
        p.effective_to.as_deref(),
    )
    .await
    .map_err(|e| db_error(e, "supplier price could not be saved"))
}

pub async fn master_data(db: &PgPool, t: &str, b: &str) -> Result<Value, AppError> {
    repo::master_data(db, t, b)
        .await
        .map_err(|e| db_error(e, "failed to load inventory master data"))
}

pub async fn save_master_value(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    p: MasterValueWrite,
) -> Result<Value, AppError> {
    if !matches!(
        p.kind.as_str(),
        "category" | "subcategory" | "brand" | "adjustment_reason" | "action_label"
    ) {
        return Err(AppError::validation("inventory master kind is invalid"));
    }
    let code = text(&p.code, "code", 80)?.to_ascii_lowercase();
    if !code
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
    {
        return Err(AppError::validation("inventory master code is invalid"));
    }
    repo::save_master_value(
        db,
        t,
        b,
        actor,
        &p.kind,
        &code,
        &text(&p.label, "label", 120)?,
        p.parent_code.trim(),
        p.active,
    )
    .await
    .map_err(|e| db_error(e, "inventory master value could not be saved"))
}
pub async fn queue_communication(
    db: &PgPool,
    t: &str,
    b: &str,
    a: &str,
    p: CommunicationWrite,
) -> Result<Value, AppError> {
    if !matches!(p.channel.as_str(), "email" | "whatsapp") {
        return Err(AppError::validation(
            "supplier communication channel is invalid",
        ));
    }
    repo::queue_communication(
        db,
        t,
        b,
        a,
        &text(&p.supplier_id, "supplierId", 100)?,
        p.purchase_order_id.as_deref(),
        &p.channel,
        &text(&p.destination, "destination", 254)?,
        &p.subject.trim().chars().take(200).collect::<String>(),
        &text(&p.message, "message", 4000)?,
        &text(&p.idempotency_key, "idempotencyKey", 160)?,
    )
    .await
    .map_err(|e| db_error(e, "supplier communication could not be queued"))
}
pub async fn containers(db: &PgPool, t: &str, b: &str) -> Result<Vec<Value>, AppError> {
    repo::containers(db, t, b)
        .await
        .map_err(|e| db_error(e, "failed to load backbar containers"))
}

pub async fn container_label(db: &PgPool, t: &str, b: &str, id: &str) -> Result<Value, AppError> {
    let mut data = repo::container_label_data(db, t, b, id)
        .await
        .map_err(|e| db_error(e, "container was not found"))?;
    let barcode = data
        .get("barcode")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if barcode.is_empty() {
        return Err(AppError::validation(
            "container barcode is required for QR label",
        ));
    }
    data["qrSvg"] = Value::String(qr_svg(barcode)?);
    Ok(data)
}

fn qr_svg(value: &str) -> Result<String, AppError> {
    let code = QrCode::encode_text(value, QrCodeEcc::Medium)
        .map_err(|_| AppError::validation("container barcode is too long for QR label"))?;
    let border = 4;
    let size = code.size();
    let view = size + border * 2;
    let mut path = String::new();
    for y in 0..size {
        for x in 0..size {
            if code.get_module(x, y) {
                path.push_str(&format!("M{} {}h1v1h-1z", x + border, y + border));
            }
        }
    }
    Ok(format!("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {view} {view}\" role=\"img\" aria-label=\"Container QR code\"><rect width=\"100%\" height=\"100%\" fill=\"white\"/><path fill=\"#102a43\" d=\"{path}\"/></svg>"))
}
pub async fn create_container(
    db: &PgPool,
    t: &str,
    b: &str,
    a: &str,
    p: ContainerWrite,
) -> Result<Value, AppError> {
    if !(1..=10_000_000).contains(&p.capacity_quantity) {
        return Err(AppError::validation("container capacity is invalid"));
    }
    let inventory_item_id = text(&p.inventory_item_id, "inventoryItemId", 100)?;
    let unit = text(&p.unit, "unit", 24)?;
    let master = sqlx::query_as::<_, (String, i32)>("SELECT unit,units_per_package FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE")
        .bind(t).bind(b).bind(&inventory_item_id).fetch_optional(db).await
        .map_err(|_| AppError::internal("failed to validate container product master"))?
        .ok_or_else(|| AppError::validation("inventory product is not available"))?;
    if !master.0.eq_ignore_ascii_case(&unit) || master.1 != p.capacity_quantity {
        return Err(AppError::validation(
            "container unit and capacity must match the product master package size",
        ));
    }
    repo::create_container(
        db,
        t,
        b,
        a,
        &inventory_item_id,
        &text(&p.barcode, "barcode", 160)?,
        p.batch_id.as_deref(),
        p.capacity_quantity,
        &unit,
        &text(&p.idempotency_key, "idempotencyKey", 160)?,
    )
    .await
    .map_err(|e| {
        db_error(
            e,
            "no unreserved retail unit is available for this sealed container",
        )
    })
}
pub async fn open_container(
    db: &PgPool,
    t: &str,
    b: &str,
    a: &str,
    id: &str,
    p: ContainerAction,
) -> Result<Value, AppError> {
    let result = repo::open_container(
        db,
        t,
        b,
        a,
        id,
        &text(&p.idempotency_key, "idempotencyKey", 160)?,
    )
    .await
    .map_err(|e| db_error(e, "sealed container or available stock was not found"))?;
    if result.get("status").and_then(Value::as_str) == Some("blocked") {
        let remaining = result
            .get("activeRemainingQuantity")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        return Err(AppError::conflict(format!(
            "active tube still has {remaining} units; manager override approval is required before opening another tube"
        )));
    }
    Ok(result)
}
pub async fn consume_container(
    db: &PgPool,
    t: &str,
    b: &str,
    a: &str,
    id: &str,
    p: ConsumeWrite,
) -> Result<Value, AppError> {
    if p.quantity <= 0 {
        return Err(AppError::validation(
            "consumption quantity must be positive",
        ));
    }
    repo::consume_container(
        db,
        t,
        b,
        a,
        id,
        p.quantity,
        &text(&p.idempotency_key, "idempotencyKey", 160)?,
    )
    .await
    .map_err(|e| db_error(e, "container has insufficient remaining quantity"))
}
pub async fn request_override(
    db: &PgPool,
    t: &str,
    b: &str,
    a: &str,
    id: &str,
    p: OverrideWrite,
) -> Result<Value, AppError> {
    if p.requested_remaining < 0 {
        return Err(AppError::validation(
            "requested remaining quantity is invalid",
        ));
    }
    repo::request_override(
        db,
        t,
        b,
        a,
        id,
        p.requested_remaining,
        &text(&p.reason, "reason", 1000)?,
        &text(&p.idempotency_key, "idempotencyKey", 160)?,
    )
    .await
    .map_err(|e| db_error(e, "container override could not be requested"))
}
pub async fn review_override(
    db: &PgPool,
    t: &str,
    b: &str,
    a: &str,
    id: &str,
    p: OverrideReview,
) -> Result<Value, AppError> {
    if !matches!(p.decision.as_str(), "approve" | "reject") {
        return Err(AppError::validation("override decision is invalid"));
    }
    if p.decision == "reject" && p.review_note.trim().is_empty() {
        return Err(AppError::validation(
            "review note is required for rejection",
        ));
    }
    repo::review_override(
        db,
        t,
        b,
        a,
        id,
        p.decision == "approve",
        p.review_note.trim(),
        &text(&p.idempotency_key, "idempotencyKey", 160)?,
    )
    .await
    .map_err(|e| db_error(e, "container override could not be reviewed"))
}

pub async fn floor_control(db: &PgPool, t: &str, b: &str) -> Result<Value, AppError> {
    repo::floor_control(db, t, b)
        .await
        .map_err(|e| db_error(e, "failed to load floor inventory control"))
}

pub async fn checkout(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    p: CheckoutWrite,
) -> Result<Value, AppError> {
    if p.quantity <= 0
        || !matches!(
            p.destination_bucket.as_str(),
            "retail_available" | "consumable_available"
        )
    {
        return Err(AppError::validation(
            "checkout quantity or destination bucket is invalid",
        ));
    }
    let item = text(&p.inventory_item_id, "inventoryItemId", 100)?;
    let employee = text(&p.employee_id, "employeeId", 100)?;
    let key = text(&p.idempotency_key, "idempotencyKey", 160)?;
    repo::move_stock_bucket(
        db,
        t,
        b,
        actor,
        &item,
        "manual_checkout",
        "store_unopened",
        &p.destination_bucket,
        p.quantity,
        Some(&employee),
        checked_note(&p.comment, "comment", 500)?,
        &key,
    )
    .await
    .map_err(|e| db_error(e, "inventory checkout could not be posted"))
}

pub async fn convert(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    p: ConversionWrite,
) -> Result<Value, AppError> {
    if p.quantity <= 0 {
        return Err(AppError::validation("conversion quantity must be positive"));
    }
    let item = text(&p.inventory_item_id, "inventoryItemId", 100)?;
    let employee = text(&p.employee_id, "employeeId", 100)?;
    let key = text(&p.idempotency_key, "idempotencyKey", 160)?;
    repo::move_stock_bucket(
        db,
        t,
        b,
        actor,
        &item,
        "conversion",
        &p.source_bucket,
        &p.destination_bucket,
        p.quantity,
        Some(&employee),
        checked_note(&p.comment, "comment", 500)?,
        &key,
    )
    .await
    .map_err(|e| db_error(e, "inventory conversion could not be posted"))
}

pub async fn reverse_movement(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    id: &str,
    p: MovementReversalWrite,
) -> Result<Value, AppError> {
    let comment = text(&p.comment, "comment", 500)?;
    repo::reverse_operational_movement(
        db,
        t,
        b,
        actor,
        &text(id, "movementId", 100)?,
        &comment,
        &text(&p.idempotency_key, "idempotencyKey", 160)?,
    )
    .await
    .map_err(|e| db_error(e, "inventory movement could not be reversed"))
}

fn checked_note<'a>(value: &'a str, name: &str, max: usize) -> Result<&'a str, AppError> {
    let value = value.trim();
    if value.chars().count() > max {
        return Err(AppError::validation(format!("{name} is invalid")));
    }
    Ok(value)
}

pub async fn save_floor_location(
    db: &PgPool,
    t: &str,
    b: &str,
    a: &str,
    p: FloorLocationWrite,
) -> Result<Value, AppError> {
    let code = text(&p.code, "code", 60)?.to_uppercase().replace(' ', "_");
    if !matches!(
        p.location_type.as_str(),
        "store" | "backbar" | "station" | "trolley"
    ) {
        return Err(AppError::validation("locationType is invalid"));
    }
    repo::save_floor_location(
        db,
        t,
        b,
        a,
        &code,
        &text(&p.name, "name", 120)?,
        &p.location_type,
        p.active,
    )
    .await
    .map_err(|e| db_error(e, "floor location could not be saved"))
}

pub async fn transfer_container_custody(
    db: &PgPool,
    t: &str,
    b: &str,
    a: &str,
    id: &str,
    p: ContainerCustodyWrite,
) -> Result<Value, AppError> {
    let staff = p
        .to_staff_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    repo::transfer_container_custody(
        db,
        t,
        b,
        a,
        &text(id, "containerId", 100)?,
        &text(&p.to_location_code, "toLocationCode", 60)?.to_uppercase(),
        staff,
        &text(&p.reason, "reason", 500)?,
        &text(&p.idempotency_key, "idempotencyKey", 160)?,
    )
    .await
    .map_err(|e| db_error(e, "active location, staff, or container was not found"))
}

pub async fn create_floor_closing(
    db: &PgPool,
    t: &str,
    b: &str,
    a: &str,
    p: FloorClosingWrite,
) -> Result<Value, AppError> {
    if p.lines.len() > 500 {
        return Err(AppError::validation(
            "floor closing supports at most 500 open containers",
        ));
    }
    let mut ids = std::collections::HashSet::new();
    let mut lines = Vec::with_capacity(p.lines.len());
    for line in p.lines {
        let id = text(&line.container_id, "containerId", 100)?;
        if !ids.insert(id.clone()) || line.counted_remaining < 0 {
            return Err(AppError::validation(
                "floor closing container counts are invalid",
            ));
        }
        lines.push((id, line.counted_remaining, line.reason));
    }
    let date = chrono::NaiveDate::parse_from_str(p.business_date.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::validation("businessDate must use YYYY-MM-DD"))?;
    repo::create_floor_closing(
        db,
        t,
        b,
        a,
        date,
        &text(&p.shift_label, "shiftLabel", 80)?,
        &lines,
        &text(&p.idempotency_key, "idempotencyKey", 160)?,
    )
    .await
    .map_err(|e| db_error(e, "floor closing could not be recorded"))
}

pub async fn review_floor_closing(
    db: &PgPool,
    t: &str,
    b: &str,
    a: &str,
    id: &str,
    p: FloorClosingReview,
) -> Result<Value, AppError> {
    if !matches!(p.decision.as_str(), "approve" | "reject") {
        return Err(AppError::validation("floor closing decision is invalid"));
    }
    if p.decision == "reject" && p.review_note.trim().is_empty() {
        return Err(AppError::validation(
            "review note is required for rejection",
        ));
    }
    repo::review_floor_closing(
        db,
        t,
        b,
        a,
        &text(id, "closingId", 100)?,
        p.decision == "approve",
        p.review_note.trim(),
        &text(&p.idempotency_key, "idempotencyKey", 160)?,
    )
    .await
    .map_err(|e| db_error(e, "floor closing could not be reviewed"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NegativeStockWrite {
    pub inventory_item_id: String,
    pub requested_stock_quantity: i32,
    pub reason: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NegativeStockReview {
    pub decision: String,
    #[serde(default)]
    pub review_note: String,
}

pub async fn negative_stock_requests(
    db: &PgPool,
    t: &str,
    b: &str,
) -> Result<Vec<Value>, AppError> {
    repo::negative_stock_requests(db, t, b)
        .await
        .map_err(|e| db_error(e, "failed to load negative stock requests"))
}
pub async fn request_negative_stock(
    db: &PgPool,
    t: &str,
    b: &str,
    a: &str,
    p: NegativeStockWrite,
) -> Result<Value, AppError> {
    if p.requested_stock_quantity >= 0 {
        return Err(AppError::validation(
            "requested stock quantity must be negative",
        ));
    }
    repo::request_negative_stock(
        db,
        t,
        b,
        a,
        &text(&p.inventory_item_id, "inventoryItemId", 100)?,
        p.requested_stock_quantity,
        &text(&p.reason, "reason", 1000)?,
    )
    .await
    .map_err(|e| db_error(e, "negative stock approval could not be requested"))
}
pub async fn review_negative_stock(
    db: &PgPool,
    t: &str,
    b: &str,
    a: &str,
    id: &str,
    p: NegativeStockReview,
) -> Result<Value, AppError> {
    if !matches!(p.decision.as_str(), "approve" | "reject") {
        return Err(AppError::validation("negative stock decision is invalid"));
    }
    if p.decision == "reject" && p.review_note.trim().is_empty() {
        return Err(AppError::validation(
            "review note is required for rejection",
        ));
    }
    repo::review_negative_stock(
        db,
        t,
        b,
        a,
        id,
        p.decision == "approve",
        p.review_note.trim(),
    )
    .await
    .map_err(|e| db_error(e, "negative stock request could not be reviewed"))
}
pub async fn retry_communication(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Value, AppError> {
    repo::retry_communication(db, tenant, branch, id)
        .await
        .map_err(|error| db_error(error, "failed supplier communication was not found"))
}

pub async fn operations_health(db: &PgPool, tenant: &str, branch: &str) -> Result<Value, AppError> {
    repo::operations_health(db, tenant, branch)
        .await
        .map_err(|error| db_error(error, "inventory operations health could not be loaded"))
}

pub async fn process_due_communications(state: &AppState) -> Result<usize, AppError> {
    let rows = repo::claim_due_communications(&state.db, 50)
        .await
        .map_err(|error| db_error(error, "supplier communications could not be claimed"))?;
    let mut sent = 0usize;
    for row in rows {
        let payload = json!({
            "channel": row.channel,
            "recipient": row.destination,
            "subject": row.subject,
            "message": row.message,
            "templateKind": "conversation",
            "correlationId": row.correlation_id,
        });
        match invoice_delivery::deliver(&state.settings, &payload).await {
            Ok(provider_id) => {
                repo::mark_communication_sent(&state.db, &row.id, &provider_id)
                    .await
                    .map_err(|error| {
                        db_error(error, "supplier communication could not be completed")
                    })?;
                sent += 1;
                tracing::info!(job_id=%row.id, tenant_id=%row.tenant_id, branch_id=%row.branch_id, correlation_id=%row.correlation_id, attempts=row.attempts, "supplier communication sent");
            }
            Err(error) => {
                repo::mark_communication_failed(&state.db, &row, &format!("{error:?}"))
                    .await
                    .map_err(|db| {
                        db_error(db, "supplier communication could not be rescheduled")
                    })?;
                tracing::warn!(job_id=%row.id, tenant_id=%row.tenant_id, branch_id=%row.branch_id, correlation_id=%row.correlation_id, attempts=row.attempts, max_attempts=row.max_attempts, "supplier communication delivery failed");
            }
        }
    }
    Ok(sent)
}
