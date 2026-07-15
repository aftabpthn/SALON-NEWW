use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    models::common::AppError,
    repositories::laundry_repository::{self, LaundryItemInput},
    services::security_service,
};

const STATUSES: &[&str] = &[
    "received",
    "sorting",
    "washing",
    "drying",
    "finishing",
    "outsourced",
    "received_from_vendor",
    "quality_check",
    "rework",
    "ready",
    "returned",
    "cancelled",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateLaundryOrder {
    pub owner_type: String,
    pub client_id: Option<String>,
    pub supplier_id: Option<String>,
    pub priority: String,
    pub due_at: Option<DateTime<Utc>>,
    pub total_weight_grams: Option<i32>,
    pub estimated_cost_paise: Option<i64>,
    #[serde(default)]
    pub notes: String,
    pub items: Vec<CreateLaundryItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateLaundryItem {
    pub item_name: String,
    pub category: String,
    pub quantity: i32,
    #[serde(default)]
    pub barcode: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub material: String,
    #[serde(default)]
    pub condition_in: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaundryTransition {
    pub status: String,
    #[serde(default)]
    pub note: String,
    pub actual_cost_paise: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaundryIssueWrite {
    pub item_id: Option<String>,
    pub issue_type: String,
    pub severity: String,
    pub description: String,
    pub charge_paise: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaundryIssueResolution {
    pub status: String,
    pub resolution: String,
}

pub async fn summary(db: &PgPool, tenant: &str, branch: &str) -> Result<Value, AppError> {
    laundry_repository::summary(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load laundry summary"))
}

pub async fn list(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    status: Option<&str>,
    query: Option<&str>,
) -> Result<Vec<Value>, AppError> {
    if status.is_some_and(|value| !STATUSES.contains(&value)) {
        return Err(AppError::validation("laundry status filter is invalid"));
    }
    laundry_repository::list_orders(db, tenant, branch, status, query)
        .await
        .map_err(|_| AppError::internal("failed to list laundry orders"))
}

pub async fn detail(db: &PgPool, tenant: &str, branch: &str, id: &str) -> Result<Value, AppError> {
    laundry_repository::detail(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to load laundry order"))?
        .ok_or_else(|| AppError::not_found("laundry order was not found"))
}

pub async fn create(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    payload: CreateLaundryOrder,
) -> Result<Value, AppError> {
    let owner_type = payload.owner_type.trim().to_ascii_lowercase();
    if !matches!(owner_type.as_str(), "salon" | "client") {
        return Err(AppError::validation("laundry owner type is invalid"));
    }
    let client_id = payload
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if owner_type == "client" {
        let id = client_id
            .ok_or_else(|| AppError::validation("client is required for client laundry"))?;
        if !laundry_repository::client_exists(db, tenant, branch, id)
            .await
            .map_err(|_| AppError::internal("failed to validate laundry client"))?
        {
            return Err(AppError::validation("active branch client was not found"));
        }
    } else if client_id.is_some() {
        return Err(AppError::validation(
            "salon laundry cannot reference a client",
        ));
    }
    let supplier_id = payload
        .supplier_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(id) = supplier_id {
        if !laundry_repository::supplier_exists(db, tenant, branch, id)
            .await
            .map_err(|_| AppError::internal("failed to validate laundry supplier"))?
        {
            return Err(AppError::validation("active branch supplier was not found"));
        }
    }
    let priority = payload.priority.trim().to_ascii_lowercase();
    if !matches!(priority.as_str(), "normal" | "urgent") {
        return Err(AppError::validation("laundry priority is invalid"));
    }
    if payload.due_at.is_some_and(|value| value <= Utc::now()) {
        return Err(AppError::validation(
            "laundry due time must be in the future",
        ));
    }
    if payload
        .total_weight_grams
        .is_some_and(|value| value <= 0 || value > 1_000_000)
    {
        return Err(AppError::validation("laundry weight is invalid"));
    }
    let estimated_cost = payload.estimated_cost_paise.unwrap_or(0);
    if !(0..=100_000_000).contains(&estimated_cost) {
        return Err(AppError::validation("estimated laundry cost is invalid"));
    }
    if payload.notes.chars().count() > 2000 {
        return Err(AppError::validation("laundry notes are too long"));
    }
    if payload.items.is_empty() || payload.items.len() > 100 {
        return Err(AppError::validation(
            "laundry order must contain 1 to 100 item lines",
        ));
    }
    let mut barcodes = Vec::new();
    let mut items = Vec::with_capacity(payload.items.len());
    for (index, item) in payload.items.into_iter().enumerate() {
        let name = item.item_name.trim();
        let category = item.category.trim().to_ascii_lowercase();
        let barcode = item.barcode.trim();
        if name.is_empty()
            || name.chars().count() > 120
            || !matches!(
                category.as_str(),
                "towel" | "cape" | "sheet" | "uniform" | "garment" | "other"
            )
            || !(1..=1000).contains(&item.quantity)
        {
            return Err(AppError::validation(format!(
                "laundry item {} is invalid",
                index + 1
            )));
        }
        if barcode.len() > 120
            || (!barcode.is_empty() && barcodes.iter().any(|value| value == barcode))
        {
            return Err(AppError::validation(
                "laundry barcodes must be unique and valid",
            ));
        }
        if !barcode.is_empty() {
            barcodes.push(barcode.to_string());
        }
        for value in [&item.color, &item.material, &item.condition_in] {
            if value.chars().count() > 240 {
                return Err(AppError::validation("laundry item details are too long"));
            }
        }
        items.push(LaundryItemInput {
            item_code: format!("I{:03}", index + 1),
            item_name: name.to_string(),
            category,
            quantity: item.quantity,
            barcode: barcode.to_string(),
            color: item.color.trim().to_string(),
            material: item.material.trim().to_string(),
            condition_in: item.condition_in.trim().to_string(),
        });
    }
    let order_number = format!(
        "LND-{}-{}",
        Utc::now().format("%Y%m%d"),
        &Uuid::new_v4().simple().to_string()[..8].to_ascii_uppercase()
    );
    let id = laundry_repository::create_order(
        db,
        tenant,
        branch,
        actor,
        &order_number,
        &owner_type,
        client_id,
        supplier_id,
        &priority,
        payload.due_at,
        payload.total_weight_grams,
        estimated_cost,
        payload.notes.trim(),
        &items,
    )
    .await
    .map_err(|error| {
        if error.to_string().contains("idx_laundry_items_barcode") {
            AppError::conflict("laundry barcode already exists in this branch")
        } else {
            AppError::internal("failed to create laundry order")
        }
    })?;
    let _ = security_service::record_audit(
        db,
        tenant,
        branch,
        actor,
        "laundry.order.created",
        json!({"orderId":id,"orderNumber":order_number}),
    )
    .await;
    detail(db, tenant, branch, &id).await
}

pub async fn transition(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    payload: LaundryTransition,
) -> Result<Value, AppError> {
    let next = payload.status.trim().to_ascii_lowercase();
    let current = laundry_repository::current_status(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to load laundry status"))?
        .ok_or_else(|| AppError::not_found("laundry order was not found"))?;
    if !transition_allowed(&current, &next) {
        return Err(AppError::conflict(format!(
            "laundry status cannot move from {current} to {next}"
        )));
    }
    if payload.note.chars().count() > 1000 {
        return Err(AppError::validation("laundry transition note is too long"));
    }
    if payload
        .actual_cost_paise
        .is_some_and(|value| !(0..=100_000_000).contains(&value))
    {
        return Err(AppError::validation("actual laundry cost is invalid"));
    }
    if !laundry_repository::transition(
        db,
        tenant,
        branch,
        id,
        actor,
        &current,
        &next,
        payload.note.trim(),
        payload.actual_cost_paise,
    )
    .await
    .map_err(|_| AppError::internal("failed to update laundry status"))?
    {
        return Err(AppError::conflict(
            "laundry status changed; reload and try again",
        ));
    }
    let _ = security_service::record_audit(
        db,
        tenant,
        branch,
        actor,
        "laundry.status.changed",
        json!({"orderId":id,"from":current,"to":next}),
    )
    .await;
    detail(db, tenant, branch, id).await
}

pub async fn create_issue(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    order_id: &str,
    actor: &str,
    payload: LaundryIssueWrite,
) -> Result<Value, AppError> {
    let issue_type = payload.issue_type.trim().to_ascii_lowercase();
    let severity = payload.severity.trim().to_ascii_lowercase();
    let description = payload.description.trim();
    let charge = payload.charge_paise.unwrap_or(0);
    if !matches!(
        issue_type.as_str(),
        "stain" | "damage" | "lost" | "shortage" | "other"
    ) || !matches!(severity.as_str(), "low" | "medium" | "high")
        || description.is_empty()
        || description.chars().count() > 1000
        || !(0..=100_000_000).contains(&charge)
    {
        return Err(AppError::validation("laundry issue details are invalid"));
    }
    laundry_repository::create_issue(
        db,
        tenant,
        branch,
        order_id,
        payload.item_id.as_deref(),
        actor,
        &issue_type,
        &severity,
        description,
        charge,
    )
    .await
    .map_err(|_| AppError::internal("failed to report laundry issue"))?
    .ok_or_else(|| AppError::not_found("laundry order or item was not found"))?;
    detail(db, tenant, branch, order_id).await
}

pub async fn resolve_issue(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    issue_id: &str,
    actor: &str,
    payload: LaundryIssueResolution,
) -> Result<Value, AppError> {
    let status = payload.status.trim().to_ascii_lowercase();
    let resolution = payload.resolution.trim();
    if !matches!(status.as_str(), "resolved" | "waived")
        || resolution.is_empty()
        || resolution.chars().count() > 1000
    {
        return Err(AppError::validation("laundry issue resolution is invalid"));
    }
    if !laundry_repository::resolve_issue(db, tenant, branch, issue_id, actor, &status, resolution)
        .await
        .map_err(|_| AppError::internal("failed to resolve laundry issue"))?
    {
        return Err(AppError::not_found("open laundry issue was not found"));
    }
    Ok(json!({"resolved":true}))
}

pub async fn scan(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    barcode: &str,
) -> Result<Value, AppError> {
    let barcode = barcode.trim();
    if barcode.is_empty() || barcode.len() > 120 {
        return Err(AppError::validation("laundry barcode is invalid"));
    }
    laundry_repository::scan_barcode(db, tenant, branch, barcode)
        .await
        .map_err(|_| AppError::internal("failed to scan laundry barcode"))?
        .ok_or_else(|| AppError::not_found("laundry barcode was not found"))
}

fn transition_allowed(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("received", "sorting")
            | ("received", "cancelled")
            | ("sorting", "washing")
            | ("sorting", "outsourced")
            | ("washing", "drying")
            | ("drying", "finishing")
            | ("finishing", "quality_check")
            | ("outsourced", "received_from_vendor")
            | ("received_from_vendor", "quality_check")
            | ("quality_check", "ready")
            | ("quality_check", "rework")
            | ("rework", "washing")
            | ("rework", "outsourced")
            | ("ready", "returned")
    )
}

#[cfg(test)]
mod tests {
    use super::transition_allowed;
    #[test]
    fn laundry_workflow_blocks_skips_and_terminal_replay() {
        assert!(transition_allowed("received", "sorting"));
        assert!(transition_allowed("quality_check", "rework"));
        assert!(!transition_allowed("received", "ready"));
        assert!(!transition_allowed("returned", "washing"));
    }
}
