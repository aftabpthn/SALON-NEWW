use chrono::{Duration, NaiveDate, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::{
    models::common::AppError,
    repositories::{
        inventory_governance_repository,
        inventory_repository::{self, InventoryAdjustmentRecord, InventoryRecord, UpdateInventory},
        purchase_repository,
    },
    services::accounting_service,
    state::AppState,
};

pub struct InventoryUpdateInput<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub sku: Option<&'a str>,
    pub name: Option<&'a str>,
    pub category: Option<&'a str>,
    pub subcategory: Option<&'a str>,
    pub brand: Option<&'a str>,
    pub product_usage: Option<&'a str>,
    pub unit: Option<&'a str>,
    pub package_unit: Option<&'a str>,
    pub units_per_package: Option<i32>,
    pub stock_quantity: Option<i32>,
    pub reorder_point: Option<i32>,
    pub alert_level: Option<i32>,
    pub desired_level: Option<i32>,
    pub order_level: Option<i32>,
    pub safety_stock_level: Option<i32>,
    pub unit_cost_paise: Option<i64>,
    pub retail_price_paise: Option<i64>,
    pub hsn_code: Option<&'a str>,
    pub gst_percent: Option<i32>,
    pub barcode: Option<&'a str>,
    pub barcodes: Option<&'a [String]>,
    pub batch_tracked: Option<bool>,
    pub dual_use_stock: Option<bool>,
    pub center_available: Option<bool>,
    pub online_sale_enabled: Option<bool>,
    pub active: Option<bool>,
    pub adjustment_reason: Option<&'a str>,
    pub adjustment_evidence_reference: Option<&'a str>,
    pub adjustment_business_date: Option<&'a str>,
    pub idempotency_key: Option<&'a str>,
    pub actor_user_id: &'a str,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdjustmentWrite {
    pub inventory_item_id: String,
    pub requested_stock_quantity: i32,
    pub business_date: String,
    pub reason: String,
    pub evidence_reference: String,
    pub idempotency_key: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdjustmentReviewWrite {
    pub decision: String,
    pub review_note: String,
    pub idempotency_key: String,
}

pub struct BackbarUsageInput<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub inventory_item_id: &'a str,
    pub service_id: Option<&'a str>,
    pub staff_id: Option<&'a str>,
    pub client_id: Option<&'a str>,
    pub appointment_id: Option<&'a str>,
    pub actual_quantity: i32,
    pub wasted_quantity: i32,
    pub selected_batch_id: Option<&'a str>,
    pub waste_reason: &'a str,
    pub notes: &'a str,
    pub actor_user_id: &'a str,
    pub idempotency_key: &'a str,
    pub override_authorized: bool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorBowlLineInput {
    pub component_type: String,
    pub inventory_item_id: String,
    pub actual_quantity: i32,
    pub waste_reason: String,
    pub notes: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorBowlInput<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub appointment_id: &'a str,
    pub client_id: &'a str,
    pub service_id: &'a str,
    pub staff_id: &'a str,
    pub notes: &'a str,
    pub actor_user_id: &'a str,
    pub idempotency_key: &'a str,
    pub override_authorized: bool,
    pub lines: Vec<ColorBowlLineInput>,
}

pub struct BackbarReviewInput<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub usage_id: &'a str,
    pub decision: &'a str,
    pub review_note: &'a str,
    pub actor_user_id: &'a str,
}

pub struct KitComponentInput {
    pub inventory_item_id: String,
    pub quantity: i32,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitAssemblyResult {
    pub id: String,
    pub kit_inventory_item_id: String,
    pub quantity: i32,
    pub stock_quantity: i32,
}

pub struct KitOperationInput<'a> {
    pub quantity: i32,
    pub idempotency_key: &'a str,
    pub actor_user_id: &'a str,
    pub comments: &'a str,
}

#[derive(Debug, PartialEq)]
struct RecipeUsagePolicy {
    min_quantity: i32,
    expected_quantity: i32,
    max_quantity: i32,
    usage_profile: String,
    wastage_percent: f64,
    approval_threshold_percent: f64,
    approval_required: bool,
    track_automatically: bool,
    allow_manual_override: bool,
}

pub struct BackbarReversalInput<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub usage_id: &'a str,
    pub reason: &'a str,
    pub actor_user_id: &'a str,
    pub idempotency_key: &'a str,
}

#[derive(Debug, Clone, Copy)]
struct PosRecipeUsage {
    quantity: i64,
    track_automatically: bool,
}

pub async fn record_backbar_usage(
    state: &AppState,
    input: BackbarUsageInput<'_>,
) -> Result<inventory_repository::BackbarUsageRecord, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start backbar usage"))?;
    let saved = record_backbar_usage_in_tx(&mut tx, input, None, 0, "other").await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit backbar usage"))?;
    Ok(saved)
}

async fn record_backbar_usage_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    input: BackbarUsageInput<'_>,
    bowl_id: Option<&str>,
    bowl_line_no: i32,
    component_type: &str,
) -> Result<inventory_repository::BackbarUsageRecord, AppError> {
    validate_backbar(&input)?;
    if let Some(existing) = inventory_repository::backbar_usage_by_key(
        tx,
        input.tenant_id,
        input.branch_id,
        input.idempotency_key,
    )
    .await
    .map_err(|_| AppError::internal("failed to read backbar usage replay"))?
    {
        if existing.inventory_item_id != input.inventory_item_id
            || existing.service_id.as_deref() != input.service_id
            || existing.staff_id.as_deref() != input.staff_id
            || existing.client_id.as_deref() != input.client_id
            || existing.appointment_id.as_deref() != input.appointment_id
            || existing.actual_quantity != i64::from(input.actual_quantity)
            || existing.wasted_quantity != i64::from(input.wasted_quantity)
            || existing.selected_batch_id.as_deref()
                != input
                    .selected_batch_id
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
        {
            return Err(AppError::conflict(
                "idempotencyKey is already used by different backbar usage",
            ));
        }
        return Ok(existing);
    }
    let item = inventory_repository::lock_for_adjustment(
        tx,
        input.tenant_id,
        input.branch_id,
        input.inventory_item_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock inventory item"))?
    .filter(|item| item.active)
    .ok_or_else(|| AppError::validation("inventory item is not available"))?;
    let mut open_container = inventory_repository::lock_open_backbar_container(
        tx,
        input.tenant_id,
        input.branch_id,
        input.inventory_item_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock open backbar container"))?;
    let container_required = item.dual_use_stock
        || inventory_repository::has_backbar_containers(
            tx,
            input.tenant_id,
            input.branch_id,
            input.inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate container tracking"))?;
    if container_required && open_container.is_none() {
        open_container = inventory_governance_repository::auto_open_service_container(
            tx,
            input.tenant_id,
            input.branch_id,
            input.inventory_item_id,
            item.stock_quantity,
            item.unit_cost_paise,
            item.batch_tracked,
            input.actor_user_id,
            &format!("auto-open:{}", input.idempotency_key),
        )
        .await
        .map_err(|error| match error {
            sqlx::Error::Protocol(message) => AppError::validation(message.to_string()),
            _ => AppError::internal("failed to auto-open service container"),
        })?
        .map(|row| inventory_repository::OpenBackbarContainer {
            id: row.0,
            remaining_quantity: row.1,
            unit_cost_paise: row.2,
        });
        if open_container.is_none() {
            return Err(AppError::validation(
                "open the sealed tube before recording usage",
            ));
        }
    }
    if open_container
        .as_ref()
        .is_some_and(|container| container.remaining_quantity < input.actual_quantity)
    {
        return Err(AppError::validation(
            "open tube has insufficient remaining quantity",
        ));
    }
    let selected_batch_id = input
        .selected_batch_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(selected_batch_id) = selected_batch_id {
        if !item.batch_tracked || open_container.is_some() {
            return Err(AppError::validation(
                "batch selection is available only for sealed batch-tracked stock",
            ));
        }
        enforce_selected_fefo_batch(
            tx,
            input.tenant_id,
            input.branch_id,
            input.inventory_item_id,
            selected_batch_id,
        )
        .await?;
    }
    let checkout_policy=sqlx::query_as::<_,(String,bool)>("SELECT COALESCE((SELECT negative_stock_rule FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),'block'),COALESCE((SELECT auto_checkout_service_consumption FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),TRUE)")
        .bind(input.tenant_id).bind(input.branch_id).fetch_one(&mut **tx).await
        .map_err(|_|AppError::internal("failed to load service checkout policy"))?;
    let stock_warning = open_container.is_none() && item.stock_quantity < input.actual_quantity;
    if input.service_id.is_some()
        && open_container.is_none()
        && !checkout_policy.1
        && inventory_governance_repository::operational_bucket_balance(
            tx,
            input.tenant_id,
            input.branch_id,
            input.inventory_item_id,
            "consumable_available",
        )
        .await
        .map_err(|_| AppError::internal("failed to load consumable floor balance"))?
            < i64::from(input.actual_quantity)
    {
        return Err(AppError::validation(
            "checkout consumable stock to the floor before recording service usage",
        ));
    }
    if stock_warning && checkout_policy.0 != "allow_with_warning" {
        return Err(AppError::validation(
            "insufficient inventory for backbar usage",
        ));
    }
    if let Some(staff_id) = input.staff_id {
        let exists = inventory_repository::active_staff_exists(
            tx,
            input.tenant_id,
            input.branch_id,
            staff_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate staff"))?;
        if !exists {
            return Err(AppError::validation("staff is not available"));
        }
    }
    if input.appointment_id.is_some() && input.client_id.is_none() {
        return Err(AppError::validation(
            "clientId is required with appointmentId",
        ));
    }
    if input.appointment_id.is_some() && (input.service_id.is_none() || input.staff_id.is_none()) {
        return Err(AppError::validation(
            "serviceId and staffId are required with appointmentId",
        ));
    }
    if let Some(client_id) = input.client_id {
        let exists = inventory_repository::client_attribution_exists(
            tx,
            input.tenant_id,
            input.branch_id,
            client_id,
            input.appointment_id,
            input.service_id,
            input.staff_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate client attribution"))?;
        if !exists {
            return Err(AppError::validation(
                "client or appointment is not available",
            ));
        }
    }
    let policy = if let Some(service_id) = input.service_id {
        let recipe = inventory_repository::service_recipe(
            tx,
            input.tenant_id,
            input.branch_id,
            service_id,
            input.appointment_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to load service recipe"))?
        .ok_or_else(|| AppError::validation("service is not available"))?;
        recipe_usage_policy(&recipe, input.inventory_item_id, input.actual_quantity)?
    } else {
        RecipeUsagePolicy {
            min_quantity: 0,
            expected_quantity: 0,
            max_quantity: 0,
            usage_profile: "custom".into(),
            wastage_percent: 0.0,
            approval_threshold_percent: 0.0,
            approval_required: false,
            track_automatically: false,
            allow_manual_override: true,
        }
    };
    if policy.track_automatically && !policy.allow_manual_override && !input.override_authorized {
        return Err(AppError::forbidden(
            "manager approval is required to override automatic service consumption",
        ));
    }
    let waste_reason = input.waste_reason.trim();
    if !waste_reason.is_empty() && !valid_waste_reason(waste_reason) {
        return Err(AppError::validation("wasteReason is invalid"));
    }
    if (input.wasted_quantity > 0 || policy.wastage_percent > 0.0) && waste_reason.is_empty() {
        return Err(AppError::validation(
            "wastage reason is required for wasted quantity or abnormal usage",
        ));
    }
    if waste_reason == "other" && input.notes.trim().is_empty() {
        return Err(AppError::validation(
            "wastage details are required for other",
        ));
    }
    let stock_after = if open_container.is_some() {
        item.stock_quantity
    } else {
        item.stock_quantity - input.actual_quantity
    };
    let usage_unit_cost_paise = if let Some(container) = open_container.as_ref() {
        container.unit_cost_paise
    } else if policy.approval_required {
        item.unit_cost_paise
    } else {
        outbound_unit_cost(
            tx,
            input.tenant_id,
            input.branch_id,
            input.inventory_item_id,
            item.batch_tracked,
            item.unit_cost_paise,
            input.actual_quantity,
        )
        .await?
    };
    let usage_id = Uuid::new_v4().to_string();
    let status = if policy.approval_required {
        "pending_approval"
    } else {
        "recorded"
    };
    inventory_repository::insert_backbar_usage(
        tx,
        input.tenant_id,
        input.branch_id,
        &usage_id,
        input.inventory_item_id,
        input.service_id,
        input.staff_id,
        input.client_id,
        input.appointment_id,
        &item.unit,
        policy.min_quantity,
        policy.expected_quantity,
        input.actual_quantity,
        input.wasted_quantity,
        selected_batch_id,
        policy.max_quantity,
        &policy.usage_profile,
        waste_reason,
        policy.wastage_percent,
        policy.approval_threshold_percent,
        status,
        input.notes.trim(),
        input.actor_user_id,
        input.idempotency_key,
        bowl_id,
        bowl_line_no,
        component_type,
        open_container
            .as_ref()
            .map(|container| container.id.as_str()),
        usage_unit_cost_paise,
    )
    .await
    .map_err(map_backbar_error)?;
    if !policy.approval_required {
        if let Some(container) = open_container {
            inventory_repository::consume_open_backbar_container(
                tx,
                input.tenant_id,
                input.branch_id,
                &container.id,
                input.actual_quantity,
                input.actor_user_id,
                input.idempotency_key,
                &usage_id,
            )
            .await
            .map_err(|_| AppError::validation("open tube has insufficient remaining quantity"))?;
            inventory_governance_repository::record_operational_movement(
                tx,
                input.tenant_id,
                input.branch_id,
                input.inventory_item_id,
                if input.service_id.is_some() {
                    "auto_service_checkout"
                } else {
                    "manual_consumption"
                },
                "open_floor_balance",
                "consumed",
                input.actual_quantity,
                usage_unit_cost_paise,
                input.staff_id,
                input.actor_user_id,
                input.notes.trim(),
                "backbar_usage",
                &usage_id,
                &format!("usage-op:{}", input.idempotency_key),
                false,
                &serde_json::json!({"bowlId":bowl_id}),
            )
            .await
            .map_err(|_| AppError::internal("failed to write floor consumption history"))?;
        } else {
            inventory_repository::apply_adjusted_stock(
                tx,
                input.tenant_id,
                input.branch_id,
                input.inventory_item_id,
                stock_after,
            )
            .await
            .map_err(|_| AppError::internal("failed to update backbar stock"))?;
            let ledger_id = inventory_repository::add_backbar_ledger(
                tx,
                input.tenant_id,
                input.branch_id,
                input.inventory_item_id,
                &usage_id,
                input.actual_quantity,
                usage_unit_cost_paise,
                stock_after,
            )
            .await
            .map_err(|_| AppError::internal("failed to write backbar ledger"))?;
            inventory_governance_repository::record_automatic_stock_out(
                tx,
                input.tenant_id,
                input.branch_id,
                input.inventory_item_id,
                if input.service_id.is_some() {
                    "auto_service_checkout"
                } else {
                    "manual_consumption"
                },
                "consumable_available",
                input.actual_quantity,
                usage_unit_cost_paise,
                input.staff_id,
                input.actor_user_id,
                "backbar_usage",
                &usage_id,
                &format!("usage-op:{}", input.idempotency_key),
                stock_warning,
            )
            .await
            .map_err(|_| AppError::internal("failed to write floor consumption history"))?;
            allocate_fefo_batches(
                tx,
                input.tenant_id,
                input.branch_id,
                &item,
                &ledger_id,
                input.actual_quantity,
            )
            .await?;
        }
    }
    let saved = inventory_repository::backbar_usage_by_key(
        tx,
        input.tenant_id,
        input.branch_id,
        input.idempotency_key,
    )
    .await
    .map_err(|_| AppError::internal("failed to load saved backbar usage"))?
    .ok_or_else(|| AppError::internal("saved backbar usage was not found"))?;
    Ok(saved)
}

pub async fn record_color_bowl(
    state: &AppState,
    input: ColorBowlInput<'_>,
) -> Result<Value, AppError> {
    if [
        input.appointment_id,
        input.client_id,
        input.service_id,
        input.staff_id,
    ]
    .iter()
    .any(|value| value.trim().is_empty())
        || input.lines.is_empty()
        || input.lines.len() > 12
    {
        return Err(AppError::validation(
            "appointment, client, service, stylist and 1 to 12 bowl lines are required",
        ));
    }
    if input.notes.trim().len() > 500
        || input.idempotency_key.trim().is_empty()
        || input.idempotency_key.len() > 120
    {
        return Err(AppError::validation("notes must be at most 500 characters and idempotencyKey must contain 1 to 120 characters"));
    }
    let request_hash = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&input)
                .map_err(|_| AppError::internal("failed to encode bowl request"))?
        )
    );
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start colour bowl"))?;
    if let Some((id, saved_hash)) = inventory_repository::color_bowl_identity_by_key(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        input.idempotency_key,
    )
    .await
    .map_err(|_| AppError::internal("failed to read colour bowl replay"))?
    {
        if saved_hash != request_hash {
            return Err(AppError::conflict(
                "idempotencyKey is already used by a different colour bowl",
            ));
        }
        tx.rollback().await.ok();
        return inventory_repository::color_bowl_by_id(
            &state.db,
            input.tenant_id,
            input.branch_id,
            &id,
        )
        .await
        .map_err(|_| AppError::internal("failed to load colour bowl"))?
        .ok_or_else(|| AppError::internal("saved colour bowl was not found"));
    }
    let mut seen = HashSet::new();
    for line in &input.lines {
        if !matches!(
            line.component_type.as_str(),
            "base" | "fashion" | "developer" | "other"
        ) || !seen.insert(line.inventory_item_id.trim())
        {
            return Err(AppError::validation(
                "bowl lines require a valid componentType and unique inventoryItemId",
            ));
        }
    }
    let bowl_id = Uuid::new_v4().to_string();
    inventory_repository::insert_color_bowl(
        &mut tx,
        &bowl_id,
        input.tenant_id,
        input.branch_id,
        input.appointment_id,
        input.client_id,
        input.service_id,
        input.staff_id,
        input.notes.trim(),
        input.actor_user_id,
        input.idempotency_key,
        &request_hash,
    )
    .await
    .map_err(map_backbar_error)?;
    let mut lines: Vec<_> = input.lines.iter().enumerate().collect();
    lines.sort_by(|left, right| left.1.inventory_item_id.cmp(&right.1.inventory_item_id));
    for (position, line) in lines {
        let line_key = format!("{}:{}", bowl_id, position + 1);
        record_backbar_usage_in_tx(
            &mut tx,
            BackbarUsageInput {
                tenant_id: input.tenant_id,
                branch_id: input.branch_id,
                inventory_item_id: line.inventory_item_id.trim(),
                service_id: Some(input.service_id),
                staff_id: Some(input.staff_id),
                client_id: Some(input.client_id),
                appointment_id: Some(input.appointment_id),
                actual_quantity: line.actual_quantity,
                wasted_quantity: 0,
                selected_batch_id: None,
                waste_reason: line.waste_reason.trim(),
                notes: line.notes.trim(),
                actor_user_id: input.actor_user_id,
                idempotency_key: &line_key,
                override_authorized: input.override_authorized,
            },
            Some(&bowl_id),
            (position + 1) as i32,
            &line.component_type,
        )
        .await?;
    }
    sqlx::query("UPDATE inventory_backbar_usage SET reconciliation_source='bowl_slip' WHERE tenant_id=$1 AND branch_id=$2 AND bowl_id=$3")
        .bind(input.tenant_id).bind(input.branch_id).bind(&bowl_id)
        .execute(&mut *tx).await
        .map_err(|_|AppError::internal("failed to tag Bowl Slip reconciliation"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit colour bowl"))?;
    inventory_repository::color_bowl_by_id(&state.db, input.tenant_id, input.branch_id, &bowl_id)
        .await
        .map_err(|_| AppError::internal("failed to load saved colour bowl"))?
        .ok_or_else(|| AppError::internal("saved colour bowl was not found"))
}

pub async fn review_backbar_usage(
    state: &AppState,
    input: BackbarReviewInput<'_>,
) -> Result<inventory_repository::BackbarUsageRecord, AppError> {
    if !matches!(input.decision, "approve" | "reject") {
        return Err(AppError::validation("decision must be approve or reject"));
    }
    if input.review_note.trim().len() > 500
        || (input.decision == "reject" && input.review_note.trim().is_empty())
    {
        return Err(AppError::validation(
            "a rejection reason is required and reviewNote must be at most 500 characters",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start backbar review"))?;
    let usage = inventory_repository::lock_backbar_usage_for_review(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        input.usage_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock backbar usage"))?
    .ok_or_else(|| AppError::not_found("backbar usage was not found"))?;
    if (usage.status == "recorded" && input.decision == "approve")
        || (usage.status == "rejected" && input.decision == "reject")
    {
        let saved = inventory_repository::backbar_usage_by_id(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            input.usage_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to load reviewed backbar usage"))?
        .ok_or_else(|| AppError::internal("reviewed backbar usage was not found"))?;
        tx.rollback().await.ok();
        return Ok(saved);
    }
    if usage.status != "pending_approval" {
        return Err(AppError::conflict("backbar usage is not pending approval"));
    }
    enforce_distinct_backbar_reviewer(&usage.actor_user_id, input.actor_user_id)?;
    let mut approved_unit_cost_paise = None;
    let status = if input.decision == "approve" {
        let item = inventory_repository::lock_for_adjustment(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            &usage.inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to lock inventory item"))?
        .filter(|item| item.active)
        .ok_or_else(|| AppError::validation("inventory item is not available"))?;
        if let Some(container_id) = usage.container_id.as_deref() {
            approved_unit_cost_paise = Some(usage.unit_cost_paise);
            inventory_repository::consume_open_backbar_container(
                &mut tx,
                input.tenant_id,
                input.branch_id,
                container_id,
                usage.actual_quantity,
                input.actor_user_id,
                &format!("review:{}", usage.id),
                &usage.id,
            )
            .await
            .map_err(|_| AppError::validation("open tube has insufficient remaining quantity"))?;
            inventory_governance_repository::record_operational_movement(
                &mut tx,
                input.tenant_id,
                input.branch_id,
                &usage.inventory_item_id,
                "auto_service_checkout",
                "open_floor_balance",
                "consumed",
                usage.actual_quantity,
                usage.unit_cost_paise,
                usage.staff_id.as_deref(),
                input.actor_user_id,
                input.review_note.trim(),
                "backbar_usage",
                &usage.id,
                &format!("review-op:{}", usage.id),
                false,
                &serde_json::json!({"approved":true}),
            )
            .await
            .map_err(|_| {
                AppError::internal("failed to write approved floor consumption history")
            })?;
        } else {
            if item.dual_use_stock {
                return Err(AppError::validation(
                    "open tube is required for approved backbar usage",
                ));
            }
            let negative_rule=sqlx::query_scalar::<_,String>("SELECT COALESCE((SELECT negative_stock_rule FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),'block')")
                .bind(input.tenant_id).bind(input.branch_id).fetch_one(&mut *tx).await
                .map_err(|_|AppError::internal("failed to load approved usage stock policy"))?;
            let warning = item.stock_quantity < usage.actual_quantity;
            if warning && negative_rule != "allow_with_warning" {
                return Err(AppError::validation(
                    "insufficient inventory for approved backbar usage",
                ));
            }
            let stock_after = item.stock_quantity - usage.actual_quantity;
            let unit_cost_paise = outbound_unit_cost(
                &mut tx,
                input.tenant_id,
                input.branch_id,
                &usage.inventory_item_id,
                item.batch_tracked,
                item.unit_cost_paise,
                usage.actual_quantity,
            )
            .await?;
            if let Some(selected_batch_id) = usage.selected_batch_id.as_deref() {
                enforce_selected_fefo_batch(
                    &mut tx,
                    input.tenant_id,
                    input.branch_id,
                    &usage.inventory_item_id,
                    selected_batch_id,
                )
                .await?;
            }
            approved_unit_cost_paise = Some(unit_cost_paise);
            inventory_repository::apply_adjusted_stock(
                &mut tx,
                input.tenant_id,
                input.branch_id,
                &usage.inventory_item_id,
                stock_after,
            )
            .await
            .map_err(|_| AppError::internal("failed to update approved backbar stock"))?;
            let ledger_id = inventory_repository::add_backbar_ledger(
                &mut tx,
                input.tenant_id,
                input.branch_id,
                &usage.inventory_item_id,
                &usage.id,
                usage.actual_quantity,
                unit_cost_paise,
                stock_after,
            )
            .await
            .map_err(|_| AppError::internal("failed to write approved backbar ledger"))?;
            inventory_governance_repository::record_automatic_stock_out(
                &mut tx,
                input.tenant_id,
                input.branch_id,
                &usage.inventory_item_id,
                "auto_service_checkout",
                "consumable_available",
                usage.actual_quantity,
                unit_cost_paise,
                usage.staff_id.as_deref(),
                input.actor_user_id,
                "backbar_usage",
                &usage.id,
                &format!("review-op:{}", usage.id),
                warning,
            )
            .await
            .map_err(|_| {
                AppError::internal("failed to write approved floor consumption history")
            })?;
            allocate_fefo_batches(
                &mut tx,
                input.tenant_id,
                input.branch_id,
                &item,
                &ledger_id,
                usage.actual_quantity,
            )
            .await?;
        }
        "recorded"
    } else {
        "rejected"
    };
    if !inventory_repository::review_backbar_usage(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        input.usage_id,
        status,
        input.actor_user_id,
        input.review_note.trim(),
        approved_unit_cost_paise,
    )
    .await
    .map_err(|_| AppError::internal("failed to save backbar review"))?
    {
        return Err(AppError::conflict(
            "backbar usage is no longer pending approval",
        ));
    }
    let saved = inventory_repository::backbar_usage_by_id(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        input.usage_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load reviewed backbar usage"))?
    .ok_or_else(|| AppError::internal("reviewed backbar usage was not found"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit backbar review"))?;
    Ok(saved)
}

pub async fn reverse_backbar_usage(
    state: &AppState,
    input: BackbarReversalInput<'_>,
) -> Result<inventory_repository::BackbarUsageRecord, AppError> {
    let reason = input.reason.trim();
    if reason.is_empty() || reason.chars().count() > 500 {
        return Err(AppError::validation("reversal reason is required"));
    }
    let key = input.idempotency_key.trim();
    if key.is_empty() || key.len() > 160 {
        return Err(AppError::validation("idempotencyKey is required"));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start usage reversal"))?;
    let usage = sqlx::query_as::<_, (String, String, i32, String, Option<String>, Option<String>, String)>(
        "SELECT id,inventory_item_id,actual_quantity,status,container_id,sale_id,reversal_idempotency_key FROM inventory_backbar_usage WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(input.tenant_id).bind(input.branch_id).bind(input.usage_id)
    .fetch_optional(&mut *tx).await
    .map_err(|_| AppError::internal("failed to lock backbar usage"))?
    .ok_or_else(|| AppError::not_found("backbar usage was not found"))?;
    if usage.3 == "reversed" {
        if usage.6 != key {
            return Err(AppError::conflict("backbar usage is already reversed"));
        }
        let saved = inventory_repository::backbar_usage_by_id(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            input.usage_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to load reversed usage"))?
        .ok_or_else(|| AppError::internal("reversed usage was not found"))?;
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish usage replay"))?;
        return Ok(saved);
    }
    if usage.3 != "recorded" {
        return Err(AppError::conflict("only recorded usage can be reversed"));
    }
    if usage.5.is_some() {
        return Err(AppError::conflict(
            "invoiced service consumption is retained on refund; correct it through a new governed inventory adjustment",
        ));
    }
    if let Some(container_id) = usage.4.as_deref() {
        sqlx::query("UPDATE inventory_backbar_containers SET remaining_quantity=remaining_quantity+$4,status='open',closed_by=NULL,closed_at=NULL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('open','empty') AND remaining_quantity+$4<=capacity_quantity")
            .bind(input.tenant_id).bind(input.branch_id).bind(container_id).bind(usage.2)
            .execute(&mut *tx).await
            .map_err(|_|AppError::conflict("container cannot be reopened while another tube is open"))
            .and_then(|result| (result.rows_affected()==1).then_some(()).ok_or_else(||AppError::conflict("container balance cannot accept this reversal")))?;
        let remaining=sqlx::query_scalar::<_,i32>("SELECT remaining_quantity FROM inventory_backbar_containers WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(input.tenant_id).bind(input.branch_id).bind(container_id).fetch_one(&mut *tx).await
            .map_err(|_|AppError::internal("failed to load reversed container balance"))?;
        sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,quantity_delta,remaining_after,actor_user_id,idempotency_key,metadata) VALUES($1,$2,$3,'usage_reversed',$4,$5,$6,$7,jsonb_build_object('usageId',$8,'reason',$9))")
            .bind(input.tenant_id).bind(input.branch_id).bind(container_id).bind(usage.2).bind(remaining)
            .bind(input.actor_user_id).bind(format!("usage-reversal:{key}")).bind(input.usage_id).bind(reason)
            .execute(&mut *tx).await.map_err(|_|AppError::internal("failed to write container reversal"))?;
    } else {
        let ledger_id=sqlx::query_scalar::<_,String>("SELECT id FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND backbar_usage_id=$3 AND movement_type='consumption'")
            .bind(input.tenant_id).bind(input.branch_id).bind(input.usage_id).fetch_one(&mut *tx).await
            .map_err(|_|AppError::conflict("usage stock movement was not found"))?;
        let allocations = inventory_repository::stock_ledger_batch_allocations(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            &ledger_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to load usage batch allocation"))?;
        let reversal_id = sqlx::query_scalar::<_, String>(
            "SELECT reverse_inventory_stock_ledger($1,$2,$3,$4,$5)",
        )
        .bind(input.tenant_id)
        .bind(input.branch_id)
        .bind(&ledger_id)
        .bind(input.actor_user_id)
        .bind(reason)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to reverse usage stock"))?;
        for allocation in allocations {
            inventory_repository::add_to_batch_quantity(
                &mut tx,
                input.tenant_id,
                input.branch_id,
                &allocation.batch_id,
                allocation.quantity,
            )
            .await
            .map_err(|_| AppError::internal("failed to restore usage batch"))?;
            inventory_repository::add_batch_movement(
                &mut tx,
                input.tenant_id,
                input.branch_id,
                &allocation.batch_id,
                &reversal_id,
                allocation.quantity,
            )
            .await
            .map_err(|_| AppError::internal("failed to write usage batch reversal"))?;
        }
    }
    if let Some(original)=sqlx::query_as::<_,(String,String,String,i32,i64,Option<String>)>("SELECT id,source_bucket,destination_bucket,quantity,unit_cost_paise,employee_id FROM inventory_operational_movements WHERE tenant_id=$1 AND branch_id=$2 AND reference_type='backbar_usage' AND reference_id=$3 AND action IN ('auto_service_checkout','manual_consumption') ORDER BY created_at DESC LIMIT 1")
        .bind(input.tenant_id).bind(input.branch_id).bind(input.usage_id).fetch_optional(&mut *tx).await
        .map_err(|_|AppError::internal("failed to load usage operational movement"))? {
        inventory_governance_repository::record_operational_movement(
            &mut tx,input.tenant_id,input.branch_id,&usage.1,"reversal",&original.2,&original.1,
            original.3,original.4,original.5.as_deref(),input.actor_user_id,reason,"backbar_usage",input.usage_id,
            &format!("usage-reversal-op:{key}"),false,&serde_json::json!({"reversalOf":original.0}),
        ).await.map_err(|_|AppError::internal("failed to write usage operational reversal"))?;
    }
    sqlx::query("UPDATE inventory_backbar_usage SET status='reversed',reversed_at=NOW(),reversed_by_user_id=$4,reversal_reason=$5,reversal_idempotency_key=$6 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(input.tenant_id).bind(input.branch_id).bind(input.usage_id).bind(input.actor_user_id).bind(reason).bind(key)
        .execute(&mut *tx).await.map_err(|_|AppError::internal("failed to mark usage reversed"))?;
    let saved = inventory_repository::backbar_usage_by_id(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        input.usage_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load reversed usage"))?
    .ok_or_else(|| AppError::internal("reversed usage was not found"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit usage reversal"))?;
    Ok(saved)
}

fn recipe_usage_policy(
    recipe: &str,
    inventory_item_id: &str,
    actual_quantity: i32,
) -> Result<RecipeUsagePolicy, AppError> {
    let entries = serde_json::from_str::<Value>(recipe)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let entry = entries
        .iter()
        .find(|entry| {
            ["itemId", "productId", "inventoryItemId"]
                .iter()
                .find_map(|key| entry.get(*key).and_then(Value::as_str))
                .is_some_and(|id| id.trim() == inventory_item_id)
        })
        .ok_or_else(|| {
            AppError::validation("selected product is not part of the service recipe")
        })?;
    let expected: i32 = ["standardQty", "quantity", "qty"]
        .iter()
        .find_map(|key| entry.get(*key))
        .and_then(recipe_quantity)
        .ok_or_else(|| AppError::validation("service inventory recipe contains an invalid item"))?
        .try_into()
        .map_err(|_| AppError::validation("recipe quantity is too large"))?;
    let waste_allowance = recipe_number(entry.get("wastePercent"))
        .unwrap_or(0.0)
        .clamp(0.0, 100.0);
    let configured_max = entry
        .get("maxQty")
        .and_then(recipe_nonnegative_quantity)
        .unwrap_or(0);
    let max_quantity = if configured_max > 0 {
        configured_max
            .try_into()
            .map_err(|_| AppError::validation("recipe maximum is too large"))?
    } else {
        (f64::from(expected) * (1.0 + waste_allowance / 100.0)).ceil() as i32
    };
    let min_quantity = entry
        .get("minQty")
        .and_then(recipe_nonnegative_quantity)
        .unwrap_or(0)
        .try_into()
        .map_err(|_| AppError::validation("recipe minimum is too large"))?;
    let usage_profile = entry
        .get("usageProfile")
        .and_then(Value::as_str)
        .unwrap_or("custom");
    if !matches!(usage_profile, "root_touch_up" | "full_colour" | "custom") {
        return Err(AppError::validation(
            "service recipe usageProfile is invalid",
        ));
    }
    let wastage_percent = if actual_quantity > max_quantity && max_quantity > 0 {
        (f64::from(actual_quantity - max_quantity) / f64::from(max_quantity)) * 100.0
    } else {
        0.0
    };
    let approval_threshold_percent = recipe_number(entry.get("ownerApprovalPercent"))
        .unwrap_or(25.0)
        .clamp(0.0, 100.0);
    let variance_percent = if actual_quantity > expected && expected > 0 {
        (f64::from(actual_quantity - expected) / f64::from(expected)) * 100.0
    } else {
        0.0
    };
    Ok(RecipeUsagePolicy {
        min_quantity,
        expected_quantity: expected,
        max_quantity,
        usage_profile: usage_profile.to_string(),
        wastage_percent,
        approval_threshold_percent,
        approval_required: actual_quantity > max_quantity
            || variance_percent > approval_threshold_percent,
        track_automatically: entry
            .get("trackAutomatically")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        allow_manual_override: entry
            .get("allowManualOverride")
            .and_then(Value::as_bool)
            .unwrap_or(true),
    })
}

fn valid_waste_reason(value: &str) -> bool {
    matches!(
        value,
        "long_hair"
            | "thick_hair"
            | "colour_correction"
            | "spillage"
            | "overmix"
            | "client_change"
            | "tube_residue"
            | "other"
    )
}

fn enforce_distinct_backbar_reviewer(
    requested_by: &str,
    reviewed_by: &str,
) -> Result<(), AppError> {
    if requested_by == reviewed_by {
        return Err(AppError::forbidden(
            "backbar usage requester cannot approve their own variance",
        ));
    }
    Ok(())
}

fn recipe_number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        })
        .filter(|number| number.is_finite() && *number >= 0.0)
}

fn recipe_nonnegative_quantity(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| {
            value
                .as_f64()
                .filter(|number| number.fract() == 0.0)
                .map(|number| number as i64)
        })
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        .filter(|quantity| *quantity >= 0)
}

pub fn recipe_quantities(recipe: &str) -> Result<HashMap<String, i64>, AppError> {
    let entries = serde_json::from_str::<Value>(recipe)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let mut quantities = HashMap::new();
    for entry in entries {
        let item_id = ["itemId", "productId", "inventoryItemId"]
            .iter()
            .find_map(|key| entry.get(*key).and_then(Value::as_str))
            .unwrap_or("")
            .trim();
        let quantity = ["quantity", "qty", "standardQty"]
            .iter()
            .find_map(|key| entry.get(*key))
            .and_then(recipe_quantity)
            .unwrap_or(0);
        if item_id.is_empty() || quantity <= 0 {
            return Err(AppError::validation(
                "service inventory recipe contains an invalid item",
            ));
        }
        quantities
            .entry(item_id.to_string())
            .and_modify(|current: &mut i64| *current = current.saturating_add(quantity))
            .or_insert(quantity);
    }
    Ok(quantities)
}

fn recipe_consumption_lines(recipe: &str) -> Result<HashMap<String, PosRecipeUsage>, AppError> {
    let entries = serde_json::from_str::<Value>(recipe)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let mut lines = HashMap::new();
    for entry in entries {
        let item_id = ["itemId", "productId", "inventoryItemId"]
            .iter()
            .find_map(|key| entry.get(*key).and_then(Value::as_str))
            .unwrap_or("")
            .trim();
        let quantity = ["quantity", "qty", "standardQty"]
            .iter()
            .find_map(|key| entry.get(*key))
            .and_then(recipe_quantity)
            .unwrap_or(0);
        if item_id.is_empty() || quantity <= 0 {
            return Err(AppError::validation(
                "service inventory recipe contains an invalid item",
            ));
        }
        let automatically = entry
            .get("trackAutomatically")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        lines
            .entry(item_id.to_string())
            .and_modify(|current: &mut PosRecipeUsage| {
                current.quantity = current.quantity.saturating_add(quantity);
                current.track_automatically &= automatically;
            })
            .or_insert(PosRecipeUsage {
                quantity,
                track_automatically: automatically,
            });
    }
    Ok(lines)
}

pub async fn consume_pos_sale(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<i64, AppError> {
    let sale_source = sqlx::query_as::<_, (String, String)>(
        "SELECT source,reference_id FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load sale source for inventory"))?;
    let appointment_id = (sale_source.0 == "appointment" && !sale_source.1.trim().is_empty())
        .then_some(sale_source.1.as_str());
    let lines = sqlx::query_as::<_, (String, String, String, i64, Option<String>)>(
        "SELECT id,line_type,item_id,quantity,NULLIF(staff_id,'') FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load sale lines for inventory"))?;
    let recipe_required = sqlx::query_scalar::<_, bool>(
        "SELECT COALESCE(settings_json #> '{recipeInventory,requireRecipeForService}','false'::JSONB)='true'::JSONB FROM service_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load POS recipe policy"))?
    .unwrap_or(false);
    let mut moved = 0;
    for (line_id, line_type, item_id, line_quantity, employee_id) in lines {
        let service_id = (line_type == "service").then_some(item_id.clone());
        let quantities = match line_type.as_str() {
            "product" => {
                if item_id.trim().is_empty() {
                    return Err(AppError::validation(
                        "product sale line requires an inventory item id",
                    ));
                }
                HashMap::from([(
                    item_id,
                    PosRecipeUsage {
                        quantity: line_quantity,
                        track_automatically: true,
                    },
                )])
            }
            "service" if !item_id.trim().is_empty() => {
                pos_service_recipe(
                    tx,
                    tenant_id,
                    branch_id,
                    &item_id,
                    appointment_id,
                    line_quantity,
                    recipe_required,
                )
                .await?
            }
            "service" if recipe_required => {
                return Err(AppError::validation(
                    "service sale line requires a service id when recipes are required",
                ));
            }
            _ => HashMap::new(),
        };
        for (inventory_item_id, recipe_usage) in quantities {
            let quantity = i32::try_from(recipe_usage.quantity)
                .ok()
                .filter(|quantity| *quantity > 0)
                .ok_or_else(|| AppError::validation("inventory consumption quantity is invalid"))?;
            if let (Some(appointment_id), Some(service_id)) =
                (appointment_id, service_id.as_deref())
            {
                if reconcile_appointment_backbar_usage(
                    tx,
                    tenant_id,
                    branch_id,
                    sale_id,
                    &line_id,
                    appointment_id,
                    service_id,
                    &inventory_item_id,
                )
                .await?
                {
                    moved += 1;
                    continue;
                }
            }
            if service_id.is_some() && !recipe_usage.track_automatically {
                return Err(AppError::validation(
                    "record mandatory appointment product usage before POS checkout",
                ));
            }
            if let Some(consumed) = consume_pos_open_container(
                tx,
                tenant_id,
                branch_id,
                sale_id,
                &line_id,
                service_id.as_deref(),
                appointment_id,
                &inventory_item_id,
                quantity,
                employee_id.as_deref(),
            )
            .await?
            {
                if consumed {
                    moved += 1;
                }
                continue;
            }
            if deduct_pos_inventory_item(
                tx,
                tenant_id,
                branch_id,
                sale_id,
                &line_id,
                &inventory_item_id,
                quantity,
                employee_id.as_deref(),
                service_id.is_some(),
            )
            .await?
            {
                moved += 1;
            }
        }
    }
    Ok(moved)
}

#[allow(clippy::too_many_arguments)]
async fn reconcile_appointment_backbar_usage(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    sale_line_id: &str,
    appointment_id: &str,
    service_id: &str,
    inventory_item_id: &str,
) -> Result<bool, AppError> {
    let rows = sqlx::query_as::<_, (String, String, Option<String>, Option<String>)>(
        "SELECT id,status,sale_id,sale_line_id FROM inventory_backbar_usage WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=$3 AND service_id=$4 AND inventory_item_id=$5 AND status IN ('recorded','pending_approval') FOR UPDATE",
    )
    .bind(tenant_id).bind(branch_id).bind(appointment_id).bind(service_id).bind(inventory_item_id)
    .fetch_all(&mut **tx).await
    .map_err(|_|AppError::internal("failed to reconcile appointment product usage"))?;
    if rows.iter().any(|row| row.1 == "pending_approval") {
        return Err(AppError::validation(
            "approve pending Bowl Slip usage before POS checkout",
        ));
    }
    let recorded = rows
        .into_iter()
        .filter(|row| row.1 == "recorded")
        .collect::<Vec<_>>();
    if recorded.is_empty() {
        return Ok(false);
    }
    if recorded.iter().any(|row| {
        row.2.as_deref().is_some_and(|id| id != sale_id)
            || row.3.as_deref().is_some_and(|id| id != sale_line_id)
    }) {
        return Err(AppError::conflict(
            "appointment usage is already linked to another invoice",
        ));
    }
    let ids = recorded.iter().map(|row| row.0.clone()).collect::<Vec<_>>();
    sqlx::query("UPDATE inventory_backbar_usage SET sale_id=$4,sale_line_id=$5,reconciliation_source=CASE WHEN bowl_id IS NULL THEN 'manual' ELSE 'bowl_slip' END WHERE tenant_id=$1 AND branch_id=$2 AND id=ANY($3)")
        .bind(tenant_id).bind(branch_id).bind(&ids).bind(sale_id).bind(sale_line_id)
        .execute(&mut **tx).await
        .map_err(|_|AppError::internal("failed to link Bowl Slip usage to invoice"))?;
    sqlx::query("UPDATE inventory_stock_ledger SET sale_id=$4,sale_line_id=$5 WHERE tenant_id=$1 AND branch_id=$2 AND backbar_usage_id=ANY($3)")
        .bind(tenant_id).bind(branch_id).bind(&ids).bind(sale_id).bind(sale_line_id)
        .execute(&mut **tx).await
        .map_err(|_|AppError::internal("failed to link usage ledger to invoice"))?;
    Ok(true)
}

#[allow(clippy::too_many_arguments)]
async fn consume_pos_open_container(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    sale_line_id: &str,
    service_id: Option<&str>,
    appointment_id: Option<&str>,
    inventory_item_id: &str,
    quantity: i32,
    employee_id: Option<&str>,
) -> Result<Option<bool>, AppError> {
    if service_id.is_none() {
        return Ok(None);
    }
    let item =
        inventory_repository::lock_for_adjustment(tx, tenant_id, branch_id, inventory_item_id)
            .await
            .map_err(|_| AppError::internal("failed to lock POS recipe item"))?
            .filter(|item| item.active)
            .ok_or_else(|| {
                AppError::validation("inventory item is not available for POS consumption")
            })?;
    let mut open = inventory_repository::lock_open_backbar_container(
        tx,
        tenant_id,
        branch_id,
        inventory_item_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock POS recipe container"))?;
    let tracked = item.dual_use_stock
        || inventory_repository::has_backbar_containers(
            tx,
            tenant_id,
            branch_id,
            inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate POS container tracking"))?;
    if !tracked {
        return Ok(None);
    }
    if open.is_none() {
        open = inventory_governance_repository::auto_open_service_container(
            tx,
            tenant_id,
            branch_id,
            inventory_item_id,
            item.stock_quantity,
            item.unit_cost_paise,
            item.batch_tracked,
            "system:pos",
            &format!("pos-auto-open:{sale_line_id}:{inventory_item_id}"),
        )
        .await
        .map_err(|error| match error {
            sqlx::Error::Protocol(message) => AppError::validation(message.to_string()),
            _ => AppError::internal("failed to auto-open POS service container"),
        })?
        .map(|row| inventory_repository::OpenBackbarContainer {
            id: row.0,
            remaining_quantity: row.1,
            unit_cost_paise: row.2,
        });
    }
    let container =
        open.ok_or_else(|| AppError::validation("open the floor container before POS checkout"))?;
    if container.remaining_quantity < quantity {
        return Err(AppError::validation(
            "open floor container has insufficient remaining quantity",
        ));
    }
    let key = format!("pos-recipe:{sale_line_id}:{inventory_item_id}");
    let replay=sqlx::query_scalar::<_,String>("SELECT id FROM inventory_backbar_container_events WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant_id).bind(branch_id).bind(&key).fetch_optional(&mut **tx).await
        .map_err(|_|AppError::internal("failed to read POS container replay"))?;
    if replay.is_some() {
        return Ok(Some(false));
    }
    let remaining=sqlx::query_scalar::<_,i32>("UPDATE inventory_backbar_containers SET remaining_quantity=remaining_quantity-$4,status=CASE WHEN remaining_quantity-$4=0 THEN 'empty' ELSE status END,closed_by=CASE WHEN remaining_quantity-$4=0 THEN 'system:pos' ELSE closed_by END,closed_at=CASE WHEN remaining_quantity-$4=0 THEN NOW() ELSE closed_at END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='open' AND remaining_quantity >= $4 RETURNING remaining_quantity")
        .bind(tenant_id).bind(branch_id).bind(&container.id).bind(quantity).fetch_one(&mut **tx).await
        .map_err(|_|AppError::validation("open floor container has insufficient remaining quantity"))?;
    sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,quantity_delta,remaining_after,actor_user_id,idempotency_key,metadata) VALUES($1,$2,$3,'consumed',$4,$5,'system:pos',$6,jsonb_build_object('source','pos_recipe','saleId',$7,'saleLineId',$8,'serviceId',$9,'appointmentId',$10,'unitCostPaise',$11))")
        .bind(tenant_id).bind(branch_id).bind(&container.id).bind(-quantity).bind(remaining).bind(&key).bind(sale_id).bind(sale_line_id).bind(service_id).bind(appointment_id).bind(container.unit_cost_paise)
        .execute(&mut **tx).await
        .map_err(|_|AppError::internal("failed to write POS container consumption"))?;
    inventory_governance_repository::record_operational_movement(
        tx,tenant_id,branch_id,inventory_item_id,"auto_service_checkout","open_floor_balance","consumed",
        quantity,container.unit_cost_paise,employee_id,"system:pos","","pos_sale_line",sale_line_id,
        &format!("pos-service-op:{sale_line_id}:{inventory_item_id}"),false,
        &serde_json::json!({"saleId":sale_id,"serviceId":service_id,"appointmentId":appointment_id}),
    ).await.map_err(|_|AppError::internal("failed to write POS floor consumption history"))?;
    Ok(Some(true))
}

#[allow(clippy::too_many_arguments)]
pub async fn restock_pos_product_return(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    refund_id: &str,
    sale_line_id: &str,
    line_type: &str,
    inventory_item_id: &str,
    quantity: i64,
    actor_user_id: &str,
) -> Result<(), AppError> {
    let quantity = i32::try_from(quantity)
        .ok()
        .filter(|quantity| *quantity > 0)
        .filter(|_| line_type == "product" && !inventory_item_id.trim().is_empty())
        .ok_or_else(|| AppError::validation("only valid product return lines can be restocked"))?;
    let sale_movement = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT id,inventory_item_id,unit_cost_paise FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND sale_line_id=$4 AND movement_type='sale'",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .bind(sale_line_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to validate product inventory movement"))?
    .ok_or_else(|| {
        AppError::validation("product line was not deducted from inventory and cannot be restocked")
    })?;
    if sale_movement.1 != inventory_item_id {
        return Err(AppError::internal(
            "product return inventory reference mismatch",
        ));
    }
    let item =
        inventory_repository::lock_for_adjustment(tx, tenant_id, branch_id, inventory_item_id)
            .await
            .map_err(|_| AppError::internal("failed to lock returned inventory item"))?
            .ok_or_else(|| AppError::not_found("returned inventory item was not found"))?;
    let stock_after = item
        .stock_quantity
        .checked_add(quantity)
        .ok_or_else(|| AppError::validation("returned inventory quantity is too large"))?;
    let created = sqlx::query_scalar::<_, String>(
        "INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,sale_id,sale_line_id,refund_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity) VALUES($1,$2,$3,$4,$5,$6,'return',$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(inventory_item_id)
    .bind(sale_id)
    .bind(sale_line_id)
    .bind(refund_id)
    .bind(quantity)
    .bind(sale_movement.2)
    .bind(stock_after)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to write inventory return ledger"))?;
    if let Some(return_ledger_id) = created {
        sqlx::query("UPDATE inventory_items SET stock_quantity=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(tenant_id)
            .bind(branch_id)
            .bind(inventory_item_id)
            .bind(stock_after)
            .execute(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to restock returned product"))?;
        if item.batch_tracked {
            restore_sale_batches(
                tx,
                tenant_id,
                branch_id,
                &sale_movement.0,
                &return_ledger_id,
                quantity,
            )
            .await?;
        }
        inventory_governance_repository::record_operational_movement(
            tx,
            tenant_id,
            branch_id,
            inventory_item_id,
            "customer_return_restock",
            "customer_return",
            "retail_available",
            quantity,
            sale_movement.2,
            None,
            actor_user_id,
            "Customer return restocked",
            "pos_refund",
            refund_id,
            &format!("pos-return-restock:{refund_id}:{sale_line_id}"),
            false,
            &serde_json::json!({"saleId":sale_id,"stockLedgerId":return_ledger_id}),
        )
        .await
        .map_err(|_| AppError::internal("failed to record returned product floor stock"))?;
        let amount = i64::from(quantity).saturating_mul(sale_movement.2);
        accounting_service::post_control_journal(
            tx,
            tenant_id,
            branch_id,
            "customer_return_restock",
            &format!("{refund_id}:{sale_line_id}"),
            Utc::now().date_naive(),
            "Customer return restocked",
            actor_user_id,
            &[
                accounting_service::ManualJournalLine {
                    account_code: accounting_service::INVENTORY_ASSET_ACCOUNT.into(),
                    debit_paise: amount,
                    credit_paise: 0,
                },
                accounting_service::ManualJournalLine {
                    account_code: "COST_OF_GOODS_SOLD".into(),
                    debit_paise: 0,
                    credit_paise: amount,
                },
            ],
        )
        .await?;
    }
    Ok(())
}

async fn pos_service_recipe(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    appointment_id: Option<&str>,
    service_quantity: i64,
    recipe_required: bool,
) -> Result<HashMap<String, PosRecipeUsage>, AppError> {
    let recipe = if let Some(appointment_id) = appointment_id {
        sqlx::query_scalar::<_, String>("SELECT snapshot.recipe_json::TEXT FROM appointment_service_recipe_snapshots snapshot WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.service_id=$3 AND snapshot.appointment_id=$4")
            .bind(tenant_id).bind(branch_id).bind(service_id).bind(appointment_id)
            .fetch_optional(&mut **tx).await
    } else {
        sqlx::query_scalar::<_, String>("SELECT product_consumption_json::TEXT FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(tenant_id).bind(branch_id).bind(service_id)
            .fetch_optional(&mut **tx).await
    }.map_err(|_| AppError::internal("failed to load service inventory recipe"))?;
    let quantities = recipe
        .as_deref()
        .map(recipe_consumption_lines)
        .transpose()?
        .unwrap_or_default();
    enforce_pos_recipe(recipe_required, &quantities)?;
    Ok(quantities
        .into_iter()
        .map(|(item_id, usage)| {
            (
                item_id,
                PosRecipeUsage {
                    quantity: service_quantity.saturating_mul(usage.quantity),
                    track_automatically: usage.track_automatically,
                },
            )
        })
        .collect())
}

fn enforce_pos_recipe(
    recipe_required: bool,
    quantities: &HashMap<String, PosRecipeUsage>,
) -> Result<(), AppError> {
    if recipe_required && quantities.is_empty() {
        return Err(AppError::validation(
            "service recipe is required by Service Settings before POS checkout",
        ));
    }
    Ok(())
}

async fn deduct_pos_inventory_item(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    sale_line_id: &str,
    inventory_item_id: &str,
    quantity: i32,
    employee_id: Option<&str>,
    service_consumption: bool,
) -> Result<bool, AppError> {
    let existing = sqlx::query_scalar::<_, String>(
        "SELECT id FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND sale_line_id=$4 AND movement_type='sale'",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(inventory_item_id)
    .bind(sale_line_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to read inventory ledger"))?;
    if existing.is_some() {
        return Ok(false);
    }
    let item =
        inventory_repository::lock_for_adjustment(tx, tenant_id, branch_id, inventory_item_id)
            .await
            .map_err(|_| AppError::internal("failed to lock inventory item"))?
            .filter(|item| item.active)
            .ok_or_else(|| {
                AppError::validation("inventory item is not available for POS consumption")
            })?;
    let already_posted = sqlx::query_scalar::<_, String>(
        "SELECT id FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND sale_line_id=$4 AND movement_type='sale'",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(inventory_item_id)
    .bind(sale_line_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to recheck inventory ledger"))?;
    if already_posted.is_some() {
        return Ok(false);
    }
    let policy=sqlx::query_as::<_,(String,bool,bool)>("SELECT COALESCE((SELECT negative_stock_rule FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),'block'),COALESCE((SELECT auto_checkout_retail_sales FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),TRUE),COALESCE((SELECT auto_checkout_service_consumption FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),TRUE)")
        .bind(tenant_id).bind(branch_id).fetch_one(&mut **tx).await
        .map_err(|_|AppError::internal("failed to load inventory checkout policy"))?;
    let preferred = if service_consumption {
        "consumable_available"
    } else {
        "retail_available"
    };
    let floor_available = inventory_governance_repository::operational_bucket_balance(
        tx,
        tenant_id,
        branch_id,
        inventory_item_id,
        preferred,
    )
    .await
    .map_err(|_| AppError::internal("failed to load floor stock balance"))?;
    let auto_checkout = if service_consumption {
        policy.2
    } else {
        policy.1
    };
    if !auto_checkout && floor_available < i64::from(quantity) {
        return Err(AppError::validation(if service_consumption {
            "checkout consumable stock to the floor before service completion"
        } else {
            "checkout retail stock to the floor before sale"
        }));
    }
    let warning = item.stock_quantity < quantity;
    if warning && policy.0 != "allow_with_warning" {
        return Err(AppError::validation(
            "insufficient inventory for POS checkout",
        ));
    }
    let unit_cost_paise = outbound_unit_cost(
        tx,
        tenant_id,
        branch_id,
        inventory_item_id,
        item.batch_tracked,
        item.unit_cost_paise,
        quantity,
    )
    .await?;
    let stock_after = item.stock_quantity - quantity;
    let ledger_id = sqlx::query_scalar::<_, String>(
        "INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,sale_id,sale_line_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity) VALUES($1,$2,$3,$4,$5,'sale',$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(inventory_item_id)
    .bind(sale_id)
    .bind(sale_line_id)
    .bind(-quantity)
    .bind(unit_cost_paise)
    .bind(stock_after)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to write inventory ledger"))?;
    let Some(ledger_id) = ledger_id else {
        return Ok(false);
    };
    inventory_governance_repository::record_automatic_stock_out(
        tx,
        tenant_id,
        branch_id,
        inventory_item_id,
        if service_consumption {
            "auto_service_checkout"
        } else {
            "auto_retail_sale"
        },
        preferred,
        quantity,
        unit_cost_paise,
        employee_id,
        "system:pos",
        "pos_sale_line",
        sale_line_id,
        &format!("pos-op:{sale_line_id}:{inventory_item_id}"),
        warning,
    )
    .await
    .map_err(|_| AppError::internal("failed to write automatic checkout history"))?;
    allocate_fefo_batches(tx, tenant_id, branch_id, &item, &ledger_id, quantity).await?;
    sqlx::query("UPDATE inventory_items SET stock_quantity=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(inventory_item_id)
        .bind(stock_after)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to deduct inventory"))?;
    Ok(true)
}

fn recipe_quantity(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| {
            value.as_f64().and_then(|number| {
                (number.is_finite()
                    && number.fract() == 0.0
                    && number > 0.0
                    && number <= i64::MAX as f64)
                    .then_some(number as i64)
            })
        })
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        .filter(|quantity| *quantity > 0)
}

fn validate_backbar(input: &BackbarUsageInput<'_>) -> Result<(), AppError> {
    if input.inventory_item_id.trim().is_empty() || input.actual_quantity <= 0 {
        return Err(AppError::validation(
            "inventoryItemId and positive actualQuantity are required",
        ));
    }
    if input.wasted_quantity < 0 || input.wasted_quantity > input.actual_quantity {
        return Err(AppError::validation(
            "wastedQuantity must be between 0 and actualQuantity",
        ));
    }
    if input
        .service_id
        .is_some_and(|value| value.trim().is_empty())
        || input.staff_id.is_some_and(|value| value.trim().is_empty())
    {
        return Err(AppError::validation(
            "serviceId and staffId cannot be blank",
        ));
    }
    if input.notes.trim().len() > 500 {
        return Err(AppError::validation("notes must be at most 500 characters"));
    }
    if input.idempotency_key.trim().is_empty() || input.idempotency_key.trim().len() > 120 {
        return Err(AppError::validation(
            "idempotencyKey must contain 1 to 120 characters",
        ));
    }
    Ok(())
}

async fn enforce_selected_fefo_batch(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    selected_batch_id: &str,
) -> Result<(), AppError> {
    let batches =
        inventory_repository::lock_fefo_batches(tx, tenant_id, branch_id, inventory_item_id)
            .await
            .map_err(|_| AppError::internal("failed to validate selected inventory batch"))?;
    if batches.first().map(|batch| batch.batch_id.as_str()) != Some(selected_batch_id) {
        return Err(AppError::conflict(
            "selected batch is no longer the next non-expired FEFO batch",
        ));
    }
    Ok(())
}

fn map_backbar_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .and_then(|value| value.code())
        .is_some_and(|code| code == "23505")
    {
        AppError::conflict("idempotencyKey is already used by another backbar usage")
    } else {
        AppError::internal("failed to save backbar usage")
    }
}

#[cfg(test)]
mod recipe_tests {
    use super::{
        enforce_distinct_backbar_reviewer, enforce_pos_recipe, kit_component_allowed,
        kit_unbundle_batch_number, recipe_consumption_lines, recipe_quantities,
        recipe_usage_policy, validate_backbar, weighted_average_cost, BackbarUsageInput,
        PosRecipeUsage,
    };
    use std::collections::HashMap;

    #[test]
    fn reads_saved_standard_quantity_and_legacy_aliases() {
        let rows =
            recipe_quantities(r#"[{"productId":"a","standardQty":2.0},{"itemId":"b","qty":"3"}]"#)
                .expect("recipe should parse");
        assert_eq!(rows.get("a"), Some(&2));
        assert_eq!(rows.get("b"), Some(&3));
        assert!(recipe_quantities(r#"[{"productId":"a","standardQty":1.5}]"#).is_err());
    }

    #[test]
    fn routes_excess_wastage_to_owner_approval() {
        let recipe = r#"[{"productId":"a","usageProfile":"root_touch_up","minQty":8,"standardQty":10,"maxQty":12,"wastePercent":5,"ownerApprovalPercent":20}]"#;
        let within_limit = recipe_usage_policy(recipe, "a", 12).expect("policy should parse");
        assert!(!within_limit.approval_required);
        assert_eq!(within_limit.min_quantity, 8);
        assert_eq!(within_limit.usage_profile, "root_touch_up");
        assert_eq!(within_limit.wastage_percent, 0.0);

        let excessive = recipe_usage_policy(recipe, "a", 15).expect("policy should parse");
        assert!(excessive.approval_required);
        assert_eq!(excessive.max_quantity, 12);
        assert_eq!(excessive.wastage_percent, 25.0);
    }

    #[test]
    fn approval_uses_expected_variance_and_enforces_maker_checker() {
        let recipe =
            r#"[{"productId":"a","standardQty":10,"maxQty":12,"ownerApprovalPercent":20}]"#;
        assert!(
            recipe_usage_policy(recipe, "a", 13)
                .expect("policy should parse")
                .approval_required
        );
        assert!(enforce_distinct_backbar_reviewer("stylist-1", "stylist-1").is_err());
        assert!(enforce_distinct_backbar_reviewer("stylist-1", "manager-1").is_ok());
    }

    #[test]
    fn pos_blocks_only_when_saved_settings_require_a_recipe() {
        let empty = HashMap::new();
        assert!(enforce_pos_recipe(false, &empty).is_ok());
        assert!(enforce_pos_recipe(true, &empty).is_err());
        assert!(enforce_pos_recipe(
            true,
            &HashMap::from([(
                "item".into(),
                PosRecipeUsage {
                    quantity: 1,
                    track_automatically: true
                }
            )])
        )
        .is_ok());
    }

    #[test]
    fn preserves_manual_recipe_lines_for_pos_blocking() {
        let rows=recipe_consumption_lines(r#"[{"productId":"auto","standardQty":2,"trackAutomatically":true},{"productId":"manual","standardQty":3,"trackAutomatically":false}]"#)
            .expect("recipe should parse");
        assert!(rows["auto"].track_automatically);
        assert!(!rows["manual"].track_automatically);
        assert_eq!(rows["manual"].quantity, 3);
    }

    #[test]
    fn kit_type_and_weighted_value_rules_are_stable() {
        assert!(kit_component_allowed("retail", "retail"));
        assert!(kit_component_allowed("retail", "dual_use"));
        assert!(kit_component_allowed("consumable", "dual_use"));
        assert!(!kit_component_allowed("retail", "consumable"));
        assert!(!kit_component_allowed("dual_use", "retail"));
        assert_eq!(weighted_average_cost(2, 100, 1, 400).unwrap(), 200);
        assert_eq!(kit_unbundle_batch_number(false, "operation"), "");
        assert_eq!(
            kit_unbundle_batch_number(true, "operation"),
            "KIT-operation"
        );
    }

    #[test]
    fn rejects_waste_above_actual_usage() {
        let input = BackbarUsageInput {
            tenant_id: "tenant",
            branch_id: "branch",
            inventory_item_id: "item",
            service_id: Some("service"),
            staff_id: Some("staff"),
            client_id: Some("client"),
            appointment_id: Some("appointment"),
            actual_quantity: 2,
            wasted_quantity: 3,
            selected_batch_id: None,
            waste_reason: "damage",
            notes: "",
            actor_user_id: "actor",
            idempotency_key: "usage-key",
            override_authorized: false,
        };
        assert!(validate_backbar(&input).is_err());
    }
}

pub async fn update(
    state: &AppState,
    input: InventoryUpdateInput<'_>,
) -> Result<Option<InventoryRecord>, AppError> {
    validate(&input)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start inventory adjustment"))?;
    let result = update_in_tx(&mut tx, &input).await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit inventory adjustment"))?;
    Ok(result)
}

pub async fn list_adjustments(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
) -> Result<Vec<InventoryAdjustmentRecord>, AppError> {
    inventory_repository::list_adjustment_requests(
        &state.db,
        tenant_id,
        branch_id,
        inventory_item_id.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to load inventory adjustments"))
}

pub async fn request_adjustment(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    input: AdjustmentWrite,
) -> Result<InventoryAdjustmentRecord, AppError> {
    let item_id = required_adjustment_text(&input.inventory_item_id, "inventoryItemId")?;
    let reason = required_adjustment_text(&input.reason, "reason")?;
    let evidence = required_adjustment_text(&input.evidence_reference, "evidenceReference")?;
    let key = required_adjustment_text(&input.idempotency_key, "idempotencyKey")?;
    if input.requested_stock_quantity < 0 {
        return Err(AppError::validation(
            "requestedStockQuantity must be 0 or greater",
        ));
    }
    let business_date = NaiveDate::parse_from_str(input.business_date.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::validation("businessDate must use YYYY-MM-DD"))?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start inventory adjustment"))?;
    if let Some(existing) =
        inventory_repository::adjustment_request_replay(&mut tx, tenant_id, branch_id, key)
            .await
            .map_err(|_| AppError::internal("failed to read inventory adjustment retry"))?
    {
        if existing.inventory_item_id != item_id
            || existing.requested_stock_quantity != input.requested_stock_quantity
        {
            return Err(AppError::conflict(
                "idempotencyKey is already used by another adjustment",
            ));
        }
        return Ok(existing);
    }
    enforce_inventory_business_date(&mut tx, tenant_id, branch_id, business_date).await?;
    let item = inventory_repository::lock_for_adjustment(&mut tx, tenant_id, branch_id, item_id)
        .await
        .map_err(|_| AppError::internal("failed to lock inventory item"))?
        .ok_or_else(|| AppError::not_found("inventory item was not found"))?;
    let delta = input
        .requested_stock_quantity
        .checked_sub(item.stock_quantity)
        .ok_or_else(|| AppError::validation("inventory adjustment exceeds supported range"))?;
    if delta == 0 {
        return Err(AppError::validation("requested stock equals current stock"));
    }
    if item.batch_tracked && delta > 0 {
        return Err(AppError::conflict(
            "batch-tracked stock must be received or released from quarantine",
        ));
    }
    let value = i64::from(delta.saturating_abs()).saturating_mul(item.unit_cost_paise);
    let threshold = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE((SELECT count_value_variance_threshold_paise FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),50000)",
    ).bind(tenant_id).bind(branch_id).fetch_one(&mut *tx).await
        .map_err(|_| AppError::internal("failed to load adjustment approval threshold"))?;
    let material = value > threshold;
    let request_id = inventory_repository::create_adjustment_request(
        &mut tx,
        tenant_id,
        branch_id,
        item_id,
        business_date,
        "manual",
        "pending_approval",
        item.stock_quantity,
        input.requested_stock_quantity,
        delta,
        item.unit_cost_paise,
        value,
        material,
        reason,
        evidence,
        actor,
        key,
    )
    .await
    .map_err(map_adjustment_request_error)?;
    inventory_repository::add_adjustment_event(
        &mut tx,
        tenant_id,
        branch_id,
        &request_id,
        "requested",
        actor,
        reason,
    )
    .await
    .map_err(|_| AppError::internal("failed to write adjustment history"))?;
    if !material {
        let ledger = apply_governed_adjustment(
            &mut tx,
            tenant_id,
            branch_id,
            &request_id,
            &item,
            input.requested_stock_quantity,
            delta,
            business_date,
            reason,
            evidence,
            actor,
            key,
        )
        .await?;
        inventory_repository::finish_adjustment_request(
            &mut tx,
            tenant_id,
            branch_id,
            &request_id,
            "pending_approval",
            "applied",
            None,
            "Automatically applied below approval threshold",
            Some(&ledger),
            None,
        )
        .await
        .map_err(|_| AppError::internal("failed to complete inventory adjustment"))?;
        inventory_repository::add_adjustment_event(
            &mut tx,
            tenant_id,
            branch_id,
            &request_id,
            "applied",
            actor,
            "Below approval threshold",
        )
        .await
        .map_err(|_| AppError::internal("failed to write adjustment history"))?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit inventory adjustment"))?;
    inventory_repository::list_adjustment_requests(&state.db, tenant_id, branch_id, item_id)
        .await
        .map_err(|_| AppError::internal("failed to reload inventory adjustment"))?
        .into_iter()
        .find(|row| row.id == request_id)
        .ok_or_else(|| AppError::internal("saved inventory adjustment was not found"))
}

pub async fn review_adjustment(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    id: &str,
    input: AdjustmentReviewWrite,
) -> Result<InventoryAdjustmentRecord, AppError> {
    let decision = input.decision.trim().to_lowercase();
    if !matches!(decision.as_str(), "approve" | "reject") {
        return Err(AppError::validation("decision must be approve or reject"));
    }
    let key = required_adjustment_text(&input.idempotency_key, "idempotencyKey")?;
    let note = input.review_note.trim();
    if decision == "reject" && note.is_empty() {
        return Err(AppError::validation(
            "reviewNote is required when rejecting",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start adjustment review"))?;
    let request =
        inventory_repository::adjustment_request_for_update(&mut tx, tenant_id, branch_id, id)
            .await
            .map_err(|_| AppError::internal("failed to lock adjustment request"))?
            .ok_or_else(|| AppError::not_found("adjustment request was not found"))?;
    if request.status != "pending_approval" {
        if request.review_idempotency_key.as_deref() == Some(key) {
            return Ok(request);
        }
        return Err(AppError::conflict("adjustment request is already reviewed"));
    }
    if request.requested_by_user_id == actor {
        return Err(AppError::forbidden(
            "requester cannot approve or reject the same material adjustment",
        ));
    }
    if decision == "reject" {
        inventory_repository::finish_adjustment_request(
            &mut tx,
            tenant_id,
            branch_id,
            id,
            "pending_approval",
            "rejected",
            Some(actor),
            note,
            None,
            Some(key),
        )
        .await
        .map_err(map_adjustment_request_error)?;
        inventory_repository::add_adjustment_event(
            &mut tx, tenant_id, branch_id, id, "rejected", actor, note,
        )
        .await
        .map_err(|_| AppError::internal("failed to write adjustment review history"))?;
    } else {
        enforce_inventory_business_date(&mut tx, tenant_id, branch_id, request.business_date)
            .await?;
        let item = inventory_repository::lock_for_adjustment(
            &mut tx,
            tenant_id,
            branch_id,
            &request.inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to lock inventory item"))?
        .ok_or_else(|| AppError::not_found("inventory item was not found"))?;
        if item.stock_quantity != request.stock_before_quantity {
            return Err(AppError::conflict(
                "stock changed after request; reject it and create a fresh adjustment",
            ));
        }
        let ledger = apply_governed_adjustment(
            &mut tx,
            tenant_id,
            branch_id,
            id,
            &item,
            request.requested_stock_quantity,
            request.quantity_delta,
            request.business_date,
            &request.reason,
            &request.evidence_reference,
            actor,
            &format!("adjustment-review:{id}"),
        )
        .await?;
        inventory_repository::finish_adjustment_request(
            &mut tx,
            tenant_id,
            branch_id,
            id,
            "pending_approval",
            "applied",
            Some(actor),
            note,
            Some(&ledger),
            Some(key),
        )
        .await
        .map_err(map_adjustment_request_error)?;
        inventory_repository::add_adjustment_event(
            &mut tx, tenant_id, branch_id, id, "approved", actor, note,
        )
        .await
        .map_err(|_| AppError::internal("failed to write adjustment review history"))?;
        inventory_repository::add_adjustment_event(
            &mut tx,
            tenant_id,
            branch_id,
            id,
            "applied",
            actor,
            "Approved adjustment posted",
        )
        .await
        .map_err(|_| AppError::internal("failed to write adjustment history"))?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit adjustment review"))?;
    inventory_repository::list_adjustment_requests(
        &state.db,
        tenant_id,
        branch_id,
        &request.inventory_item_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to reload adjustment request"))?
    .into_iter()
    .find(|row| row.id == id)
    .ok_or_else(|| AppError::internal("reviewed adjustment was not found"))
}

#[allow(clippy::too_many_arguments)]
async fn apply_governed_adjustment(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
    item: &InventoryRecord,
    target: i32,
    delta: i32,
    business_date: NaiveDate,
    reason: &str,
    evidence: &str,
    actor: &str,
    key: &str,
) -> Result<String, AppError> {
    let unit_cost_paise = if delta < 0 {
        outbound_unit_cost(
            tx,
            tenant_id,
            branch_id,
            &item.id,
            item.batch_tracked,
            item.unit_cost_paise,
            delta.saturating_abs(),
        )
        .await?
    } else {
        item.unit_cost_paise
    };
    inventory_repository::apply_adjusted_stock(tx, tenant_id, branch_id, &item.id, target)
        .await
        .map_err(|_| AppError::internal("failed to apply inventory adjustment"))?;
    let ledger = inventory_repository::add_adjustment_ledger(
        tx,
        tenant_id,
        branch_id,
        &item.id,
        delta,
        unit_cost_paise,
        target,
        reason,
        "manual",
        evidence,
        Some(business_date),
        Some(request_id),
        key,
    )
    .await
    .map_err(map_ledger_error)?;
    if delta < 0 {
        allocate_fefo_quantity(
            tx,
            tenant_id,
            branch_id,
            &item.id,
            item.batch_tracked,
            &ledger,
            delta.saturating_abs(),
        )
        .await?;
    }
    accounting_service::post_inventory_adjustment(
        tx,
        tenant_id,
        branch_id,
        "inventory_adjustment",
        request_id,
        business_date,
        actor,
        delta,
        unit_cost_paise,
        reason,
    )
    .await?;
    Ok(ledger)
}

pub(crate) async fn enforce_inventory_business_date(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    date: NaiveDate,
) -> Result<(), AppError> {
    let today = Utc::now().date_naive();
    if date > today {
        return Err(AppError::validation("businessDate cannot be in the future"));
    }
    let policy = purchase_repository::inventory_receipt_policy(tx, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load inventory lock policy"))?;
    if policy.financial_lock_date.is_some_and(|lock| date <= lock) {
        return Err(AppError::conflict(
            "inventory date is inside the financial lock period",
        ));
    }
    if policy.edit_lock_days > 0 && date < today - Duration::days(i64::from(policy.edit_lock_days))
    {
        return Err(AppError::conflict(
            "inventory date is older than the edit-lock window",
        ));
    }
    Ok(())
}

fn required_adjustment_text<'a>(value: &'a str, field: &str) -> Result<&'a str, AppError> {
    let value = value.trim();
    if value.is_empty() {
        Err(AppError::validation(format!("{field} is required")))
    } else {
        Ok(value)
    }
}

fn map_adjustment_request_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .and_then(|value| value.code())
        .is_some_and(|code| code == "23505")
    {
        AppError::conflict("idempotencyKey is already used by another adjustment action")
    } else {
        AppError::internal("failed to save inventory adjustment request")
    }
}

async fn update_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    input: &InventoryUpdateInput<'_>,
) -> Result<Option<InventoryRecord>, AppError> {
    let current =
        inventory_repository::lock_for_adjustment(tx, input.tenant_id, input.branch_id, input.id)
            .await
            .map_err(|_| AppError::internal("failed to lock inventory item"))?;
    let Some(current) = current else {
        return Ok(None);
    };
    if input
        .online_sale_enabled
        .unwrap_or(current.online_sale_enabled)
        && input.product_usage.unwrap_or(&current.product_usage) == "consumable"
    {
        return Err(AppError::validation(
            "only retail or dual-use products can be sold in Webstore",
        ));
    }
    let master_change_requested = input.sku.is_some()
        || input.name.is_some()
        || input.category.is_some()
        || input.subcategory.is_some()
        || input.brand.is_some()
        || input.product_usage.is_some()
        || input.unit.is_some()
        || input.package_unit.is_some()
        || input.units_per_package.is_some()
        || input.reorder_point.is_some()
        || input.alert_level.is_some()
        || input.desired_level.is_some()
        || input.order_level.is_some()
        || input.safety_stock_level.is_some()
        || input.unit_cost_paise.is_some()
        || input.hsn_code.is_some()
        || input.gst_percent.is_some()
        || input.barcode.is_some()
        || input.barcodes.is_some()
        || input.batch_tracked.is_some()
        || input.dual_use_stock.is_some()
        || input.center_available.is_some()
        || input.online_sale_enabled.is_some()
        || input.active.is_some();
    if master_change_requested
        && inventory_repository::master_edit_locked(tx, input.tenant_id, input.branch_id)
            .await
            .map_err(|_| AppError::internal("failed to read inventory edit lock"))?
    {
        return Err(AppError::conflict(
            "inventory master editing is locked by policy",
        ));
    }

    let override_context = inventory_repository::franchise_override_context(
        tx,
        input.tenant_id,
        input.branch_id,
        input.id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load product override policy"))?;
    let mut changed_master_fields = Vec::new();
    if let Some((Some(_), _, allowed_fields)) = &override_context {
        let candidates = [
            (
                "sku",
                input.sku.is_some_and(|value| value != current.sku.as_str()),
            ),
            (
                "name",
                input
                    .name
                    .is_some_and(|value| value != current.name.as_str()),
            ),
            (
                "category",
                input
                    .category
                    .is_some_and(|value| value != current.category.as_str()),
            ),
            (
                "subcategory",
                input
                    .subcategory
                    .is_some_and(|value| value != current.subcategory.as_str()),
            ),
            (
                "brand",
                input
                    .brand
                    .is_some_and(|value| value != current.brand.as_str()),
            ),
            (
                "productUsage",
                input
                    .product_usage
                    .is_some_and(|value| value != current.product_usage.as_str()),
            ),
            (
                "unit",
                input
                    .unit
                    .is_some_and(|value| value != current.unit.as_str()),
            ),
            (
                "packageUnit",
                input
                    .package_unit
                    .is_some_and(|value| value != current.package_unit.as_str()),
            ),
            (
                "unitsPerPackage",
                input
                    .units_per_package
                    .is_some_and(|value| value != current.units_per_package),
            ),
            (
                "hsnCode",
                input
                    .hsn_code
                    .is_some_and(|value| value != current.hsn_code.as_str()),
            ),
            (
                "retailPricePaise",
                input
                    .retail_price_paise
                    .is_some_and(|value| value != current.retail_price_paise),
            ),
            (
                "gstPercent",
                input
                    .gst_percent
                    .is_some_and(|value| value != current.gst_percent),
            ),
            (
                "barcode",
                input
                    .barcode
                    .is_some_and(|value| value != current.barcode.as_str()),
            ),
            (
                "batchTracked",
                input
                    .batch_tracked
                    .is_some_and(|value| value != current.batch_tracked),
            ),
            (
                "active",
                input.active.is_some_and(|value| value != current.active),
            ),
            (
                "centerAvailable",
                input
                    .center_available
                    .is_some_and(|value| value != current.center_available),
            ),
            (
                "onlineSaleEnabled",
                input
                    .online_sale_enabled
                    .is_some_and(|value| value != current.online_sale_enabled),
            ),
        ];
        for (field, changed) in candidates {
            if !changed {
                continue;
            }
            if !allowed_fields.iter().any(|allowed| allowed == field) {
                return Err(AppError::forbidden(format!(
                    "{field} is controlled by the central product master"
                )));
            }
            changed_master_fields.push(field.to_string());
        }
    }

    if input.unit.is_some_and(|value| value != current.unit) && current.stock_quantity != 0 {
        return Err(AppError::conflict(
            "stock unit can change only when stock is zero",
        ));
    }

    if input.batch_tracked != Some(current.batch_tracked) {
        if current.stock_quantity != 0 {
            return Err(AppError::conflict(
                "batch tracking can change only when stock is zero",
            ));
        }
        if input.batch_tracked == Some(true)
            && inventory_repository::has_kit_components(
                tx,
                input.tenant_id,
                input.branch_id,
                input.id,
            )
            .await
            .map_err(|_| AppError::internal("failed to validate kit tracking"))?
        {
            return Err(AppError::conflict(
                "assembled kits cannot use batch tracking",
            ));
        }
    }
    if (input.active == Some(false) || input.center_available == Some(false))
        && inventory_repository::has_open_product_operations(
            tx,
            input.tenant_id,
            input.branch_id,
            input.id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate open product operations"))?
    {
        return Err(AppError::conflict(
            "product cannot be made inactive while a purchase order or stock audit is open",
        ));
    }

    let idempotency_key = input.idempotency_key.unwrap_or_default().trim();
    if let Some(target) = input.stock_quantity {
        if !idempotency_key.is_empty() {
            if let Some((item_id, stock_after)) = inventory_repository::adjustment_replay(
                tx,
                input.tenant_id,
                input.branch_id,
                idempotency_key,
            )
            .await
            .map_err(|_| AppError::internal("failed to read inventory adjustment replay"))?
            {
                if item_id != input.id || stock_after != target {
                    return Err(AppError::conflict(
                        "idempotencyKey is already used by a different inventory adjustment",
                    ));
                }
                return Ok(Some(current));
            }
        }

        if current.stock_quantity != target {
            let quantity_delta = target.checked_sub(current.stock_quantity).ok_or_else(|| {
                AppError::validation("inventory adjustment exceeds supported range")
            })?;
            if current.batch_tracked && quantity_delta > 0 {
                return Err(AppError::conflict(
                    "batch-tracked stock must be received through a GRN",
                ));
            }
            inventory_repository::apply_adjusted_stock(
                tx,
                input.tenant_id,
                input.branch_id,
                input.id,
                target,
            )
            .await
            .map_err(|_| AppError::internal("failed to apply inventory adjustment"))?;
            let reason = input
                .adjustment_reason
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::validation("adjustmentReason is required"))?;
            let evidence = input
                .adjustment_evidence_reference
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::validation("adjustmentEvidenceReference is required"))?;
            let business_date = NaiveDate::parse_from_str(
                input.adjustment_business_date.unwrap_or_default().trim(),
                "%Y-%m-%d",
            )
            .map_err(|_| AppError::validation("adjustmentBusinessDate must use YYYY-MM-DD"))?;
            enforce_inventory_business_date(tx, input.tenant_id, input.branch_id, business_date)
                .await?;
            let value = i64::from(quantity_delta.saturating_abs())
                .saturating_mul(input.unit_cost_paise.unwrap_or(current.unit_cost_paise));
            let threshold = sqlx::query_scalar::<_, i64>(
                "SELECT COALESCE((SELECT count_value_variance_threshold_paise FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),50000)",
            ).bind(input.tenant_id).bind(input.branch_id).fetch_one(&mut **tx).await
                .map_err(|_| AppError::internal("failed to load adjustment approval threshold"))?;
            if value > threshold {
                return Err(AppError::conflict(
                    "material stock adjustment must use the approval workflow",
                ));
            }
            inventory_repository::upsert_product_master_value(
                tx,
                input.tenant_id,
                input.branch_id,
                "adjustment_reason",
                reason,
                "",
                input.actor_user_id,
            )
            .await
            .map_err(|_| AppError::internal("failed to save adjustment reason master"))?;
            let adjustment_unit_cost_paise = if quantity_delta < 0 {
                outbound_unit_cost(
                    tx,
                    input.tenant_id,
                    input.branch_id,
                    input.id,
                    current.batch_tracked,
                    input.unit_cost_paise.unwrap_or(current.unit_cost_paise),
                    quantity_delta.saturating_abs(),
                )
                .await?
            } else {
                input.unit_cost_paise.unwrap_or(current.unit_cost_paise)
            };
            let ledger_id = inventory_repository::add_adjustment_ledger(
                tx,
                input.tenant_id,
                input.branch_id,
                input.id,
                quantity_delta,
                adjustment_unit_cost_paise,
                target,
                reason,
                "manual_direct",
                evidence,
                Some(business_date),
                None,
                idempotency_key,
            )
            .await
            .map_err(map_ledger_error)?;
            if quantity_delta < 0 {
                allocate_fefo_batches(
                    tx,
                    input.tenant_id,
                    input.branch_id,
                    &current,
                    &ledger_id,
                    quantity_delta.saturating_abs(),
                )
                .await?;
            }
            accounting_service::post_inventory_adjustment(
                tx,
                input.tenant_id,
                input.branch_id,
                "inventory_adjustment_direct",
                &ledger_id,
                business_date,
                input.actor_user_id,
                quantity_delta,
                adjustment_unit_cost_paise,
                reason,
            )
            .await?;
        }
    }

    let mut updated = inventory_repository::update(
        tx,
        UpdateInventory {
            tenant_id: input.tenant_id,
            branch_id: input.branch_id,
            id: input.id,
            sku: input.sku,
            name: input.name,
            category: input.category,
            subcategory: input.subcategory,
            brand: input.brand,
            product_usage: input.product_usage,
            unit: input.unit,
            package_unit: input.package_unit,
            units_per_package: input.units_per_package,
            reorder_point: input.reorder_point,
            alert_level: input.alert_level,
            desired_level: input.desired_level,
            order_level: input.order_level,
            safety_stock_level: input.safety_stock_level,
            unit_cost_paise: input.unit_cost_paise,
            retail_price_paise: input.retail_price_paise,
            hsn_code: input.hsn_code,
            gst_percent: input.gst_percent,
            barcode: input.barcode,
            batch_tracked: input.batch_tracked,
            dual_use_stock: input.dual_use_stock,
            center_available: input.center_available,
            online_sale_enabled: input.online_sale_enabled,
            active: input.active,
        },
    )
    .await
    .map_err(|error| match error {
        sqlx::Error::Database(ref database) if database.code().as_deref() == Some("23514") => {
            AppError::validation("retail stock cannot be lower than sealed backbar stock")
        }
        _ => AppError::internal("failed to update inventory item"),
    })?;
    if let (Some(saved), Some(barcodes)) = (updated.as_mut(), input.barcodes) {
        inventory_repository::replace_barcodes(
            tx,
            input.tenant_id,
            input.branch_id,
            input.id,
            barcodes,
        )
        .await
        .map_err(|_| AppError::conflict("one or more barcodes already exist in this branch"))?;
        saved.barcodes = barcodes.to_vec();
    }
    let category = input.category.unwrap_or(current.category.as_str());
    inventory_repository::upsert_product_master_value(
        tx,
        input.tenant_id,
        input.branch_id,
        "category",
        category,
        "",
        input.actor_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to save product category master"))?;
    let category_code = category
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    inventory_repository::upsert_product_master_value(
        tx,
        input.tenant_id,
        input.branch_id,
        "subcategory",
        input.subcategory.unwrap_or(current.subcategory.as_str()),
        category_code.trim_matches('-'),
        input.actor_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to save product subcategory master"))?;
    inventory_repository::upsert_product_master_value(
        tx,
        input.tenant_id,
        input.branch_id,
        "brand",
        input.brand.unwrap_or(current.brand.as_str()),
        "",
        input.actor_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to save product brand master"))?;
    inventory_repository::record_franchise_overrides(
        tx,
        input.tenant_id,
        input.branch_id,
        input.id,
        &changed_master_fields,
    )
    .await
    .map_err(|_| AppError::internal("failed to record product override"))?;
    Ok(updated)
}

pub async fn record_batch_receipt(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    batch_tracked: bool,
    batch_number: &str,
    barcode: &str,
    expiry_date: Option<chrono::NaiveDate>,
    received_date: chrono::NaiveDate,
    quantity: i32,
    unit_cost_paise: i64,
    stock_ledger_id: &str,
) -> Result<(), AppError> {
    if !batch_tracked {
        if !batch_number.trim().is_empty() || expiry_date.is_some() {
            return Err(AppError::validation(
                "enable batch tracking before adding batch details",
            ));
        }
        return Ok(());
    }
    let batch_number = batch_number.trim();
    if batch_number.is_empty() || batch_number.len() > 120 {
        return Err(AppError::validation(
            "batchNumber is required and must be at most 120 characters",
        ));
    }
    if expiry_date.is_some_and(|date| date < received_date) {
        return Err(AppError::validation(
            "expiryDate cannot be before receivedDate",
        ));
    }
    let batch_id = inventory_repository::upsert_batch(
        tx,
        tenant_id,
        branch_id,
        inventory_item_id,
        batch_number,
        barcode.trim(),
        expiry_date,
        received_date,
        quantity,
        unit_cost_paise,
    )
    .await
    .map_err(|_| AppError::conflict("batch number or barcode conflicts with existing stock"))?;
    inventory_repository::add_batch_movement(
        tx,
        tenant_id,
        branch_id,
        &batch_id,
        stock_ledger_id,
        quantity,
    )
    .await
    .map_err(|_| AppError::internal("failed to write batch movement"))
}

pub async fn allocate_fefo_batches(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item: &InventoryRecord,
    stock_ledger_id: &str,
    quantity: i32,
) -> Result<(), AppError> {
    allocate_fefo_quantity(
        tx,
        tenant_id,
        branch_id,
        &item.id,
        item.batch_tracked,
        stock_ledger_id,
        quantity,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn outbound_unit_cost(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    batch_tracked: bool,
    fallback_unit_cost_paise: i64,
    quantity: i32,
) -> Result<i64, AppError> {
    if !batch_tracked || quantity <= 0 {
        return Ok(fallback_unit_cost_paise);
    }
    let valuation_method = sqlx::query_scalar::<_, String>(
        "SELECT COALESCE((SELECT valuation_method FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),'weighted_average')",
    )
    .bind(tenant_id).bind(branch_id).fetch_one(&mut **tx).await
    .map_err(|_| AppError::internal("failed to load inventory valuation policy"))?;
    if valuation_method != "fifo" {
        return Ok(fallback_unit_cost_paise);
    }
    let batches =
        inventory_repository::lock_fefo_batches(tx, tenant_id, branch_id, inventory_item_id)
            .await
            .map_err(|_| AppError::internal("failed to lock FIFO inventory batches"))?;
    fifo_planned_unit_cost(
        &batches
            .iter()
            .map(|batch| (batch.quantity, batch.unit_cost_paise))
            .collect::<Vec<_>>(),
        quantity,
    )
    .ok_or_else(|| AppError::conflict("non-expired batch stock is insufficient"))
}

pub async fn allocate_fefo_quantity(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    batch_tracked: bool,
    stock_ledger_id: &str,
    quantity: i32,
) -> Result<(), AppError> {
    if !batch_tracked {
        return Ok(());
    }
    let batches =
        inventory_repository::lock_fefo_batches(tx, tenant_id, branch_id, inventory_item_id)
            .await
            .map_err(|_| AppError::internal("failed to lock inventory batches"))?;
    let plan = fefo_plan(
        &batches
            .iter()
            .map(|batch| batch.quantity)
            .collect::<Vec<_>>(),
        quantity,
    )
    .ok_or_else(|| AppError::conflict("non-expired batch stock is insufficient"))?;
    for (batch, used) in batches.iter().zip(plan).filter(|(_, used)| *used > 0) {
        inventory_repository::set_batch_quantity(
            tx,
            tenant_id,
            branch_id,
            &batch.batch_id,
            batch.quantity - used,
        )
        .await
        .map_err(|_| AppError::internal("failed to update inventory batch"))?;
        inventory_repository::add_batch_movement(
            tx,
            tenant_id,
            branch_id,
            &batch.batch_id,
            stock_ledger_id,
            -used,
        )
        .await
        .map_err(|_| AppError::internal("failed to write FEFO batch allocation"))?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn receive_transfer_batches(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    source_branch_id: &str,
    destination_branch_id: &str,
    source_item_id: &str,
    destination_item_id: &str,
    transfer_line_id: &str,
    destination_stock_ledger_id: &str,
) -> Result<(), AppError> {
    let source_ledger_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND inventory_transfer_line_id=$4 AND movement_type='transfer_out'",
    )
    .bind(tenant_id).bind(source_branch_id).bind(source_item_id).bind(transfer_line_id)
    .fetch_optional(&mut **tx).await
    .map_err(|_| AppError::internal("failed to load transfer batch allocation"))?;
    let Some(source_ledger_id) = source_ledger_id else {
        return Ok(());
    };
    let batches = inventory_repository::stock_ledger_batch_allocations(
        tx,
        tenant_id,
        source_branch_id,
        &source_ledger_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load transfer batches"))?;
    for batch in batches {
        let batch_id = inventory_repository::upsert_batch(
            tx,
            tenant_id,
            destination_branch_id,
            destination_item_id,
            &batch.batch_number,
            &batch.barcode,
            batch.expiry_date,
            batch.received_date,
            batch.quantity,
            batch.unit_cost_paise,
        )
        .await
        .map_err(|_| AppError::conflict("destination batch conflicts with transferred stock"))?;
        inventory_repository::add_batch_movement(
            tx,
            tenant_id,
            destination_branch_id,
            &batch_id,
            destination_stock_ledger_id,
            batch.quantity,
        )
        .await
        .map_err(|_| AppError::internal("failed to write transferred batch movement"))?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn receive_transfer_batches_from_ledger(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    source_branch_id: &str,
    destination_branch_id: &str,
    destination_item_id: &str,
    source_stock_ledger_id: &str,
    destination_stock_ledger_id: &str,
    quantity: i32,
) -> Result<Vec<(Option<String>, i32)>, AppError> {
    let batches = inventory_repository::stock_ledger_batch_allocations(
        tx,
        tenant_id,
        source_branch_id,
        source_stock_ledger_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load transfer batches"))?;
    let mut remaining = quantity;
    let mut received = Vec::new();
    for batch in batches {
        if remaining == 0 {
            break;
        }
        let used = batch.quantity.min(remaining);
        let batch_id = inventory_repository::upsert_batch(
            tx,
            tenant_id,
            destination_branch_id,
            destination_item_id,
            &batch.batch_number,
            &batch.barcode,
            batch.expiry_date,
            batch.received_date,
            used,
            batch.unit_cost_paise,
        )
        .await
        .map_err(|_| AppError::conflict("destination batch conflicts with transferred stock"))?;
        inventory_repository::add_batch_movement(
            tx,
            tenant_id,
            destination_branch_id,
            &batch_id,
            destination_stock_ledger_id,
            used,
        )
        .await
        .map_err(|_| AppError::internal("failed to write transferred batch movement"))?;
        received.push((Some(batch_id), used));
        remaining -= used;
    }
    if remaining != 0 {
        return Err(AppError::conflict(
            "accepted batch quantity exceeds dispatched FEFO allocation",
        ));
    }
    Ok(received)
}

pub async fn restore_transfer_batches(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    source_stock_ledger_id: &str,
    reversal_stock_ledger_id: &str,
) -> Result<(), AppError> {
    let batches = inventory_repository::stock_ledger_batch_allocations(
        tx,
        tenant_id,
        branch_id,
        source_stock_ledger_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load cancelled transfer batches"))?;
    for batch in batches {
        inventory_repository::add_to_batch_quantity(
            tx,
            tenant_id,
            branch_id,
            &batch.batch_id,
            batch.quantity,
        )
        .await
        .map_err(|_| AppError::internal("failed to restore cancelled transfer batch"))?;
        inventory_repository::add_batch_movement(
            tx,
            tenant_id,
            branch_id,
            &batch.batch_id,
            reversal_stock_ledger_id,
            batch.quantity,
        )
        .await
        .map_err(|_| AppError::internal("failed to write cancelled transfer batch movement"))?;
    }
    Ok(())
}

pub async fn allocate_named_batch(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    batch_number: &str,
    stock_ledger_id: &str,
    quantity: i32,
) -> Result<(), AppError> {
    let batch = inventory_repository::lock_batch_by_number(
        tx,
        tenant_id,
        branch_id,
        inventory_item_id,
        batch_number,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock inventory batch"))?
    .ok_or_else(|| AppError::conflict("receipt batch is unavailable"))?;
    if batch.quantity < quantity {
        return Err(AppError::conflict(
            "receipt batch stock is insufficient for return",
        ));
    }
    inventory_repository::set_batch_quantity(
        tx,
        tenant_id,
        branch_id,
        &batch.batch_id,
        batch.quantity - quantity,
    )
    .await
    .map_err(|_| AppError::internal("failed to update inventory batch"))?;
    inventory_repository::add_batch_movement(
        tx,
        tenant_id,
        branch_id,
        &batch.batch_id,
        stock_ledger_id,
        -quantity,
    )
    .await
    .map_err(|_| AppError::internal("failed to write batch return movement"))
}

pub async fn restore_sale_batches(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_stock_ledger_id: &str,
    return_stock_ledger_id: &str,
    quantity: i32,
) -> Result<(), AppError> {
    let rows = inventory_repository::sale_batch_allocations_for_return(
        tx,
        tenant_id,
        branch_id,
        sale_stock_ledger_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load sale batch allocation"))?;
    if rows.is_empty() {
        return Ok(());
    }
    let mut remaining = i64::from(quantity);
    for row in rows {
        let available = row.allocated_quantity.saturating_sub(row.restored_quantity);
        let restored = available.min(remaining).max(0);
        if restored == 0 {
            continue;
        }
        let restored = i32::try_from(restored)
            .map_err(|_| AppError::validation("batch return quantity exceeds supported range"))?;
        inventory_repository::add_to_batch_quantity(
            tx,
            tenant_id,
            branch_id,
            &row.batch_id,
            restored,
        )
        .await
        .map_err(|_| AppError::internal("failed to restore returned batch"))?;
        inventory_repository::add_batch_movement(
            tx,
            tenant_id,
            branch_id,
            &row.batch_id,
            return_stock_ledger_id,
            restored,
        )
        .await
        .map_err(|_| AppError::internal("failed to write returned batch movement"))?;
        remaining -= i64::from(restored);
        if remaining == 0 {
            break;
        }
    }
    if remaining == 0 {
        Ok(())
    } else {
        Err(AppError::conflict(
            "returned quantity exceeds the original batch allocation",
        ))
    }
}

fn fefo_plan(available: &[i32], requested: i32) -> Option<Vec<i32>> {
    let mut remaining = requested;
    let plan = available
        .iter()
        .map(|quantity| {
            let used = remaining.min(*quantity).max(0);
            remaining -= used;
            used
        })
        .collect::<Vec<_>>();
    (remaining == 0).then_some(plan)
}

fn fifo_planned_unit_cost(layers: &[(i32, i64)], requested: i32) -> Option<i64> {
    if requested <= 0 {
        return None;
    }
    let plan = fefo_plan(
        &layers.iter().map(|layer| layer.0).collect::<Vec<_>>(),
        requested,
    )?;
    let total = layers
        .iter()
        .zip(plan)
        .try_fold(0_i64, |total, (layer, used)| {
            i64::from(used)
                .checked_mul(layer.1)
                .and_then(|value| total.checked_add(value))
        })?;
    Some((total + i64::from(requested) / 2) / i64::from(requested))
}

fn kit_component_allowed(kit_usage: &str, component_usage: &str) -> bool {
    matches!(kit_usage, "retail" | "consumable")
        && (component_usage == kit_usage || component_usage == "dual_use")
}

fn kit_unbundle_batch_number(batch_tracked: bool, operation_id: &str) -> String {
    batch_tracked
        .then(|| format!("KIT-{operation_id}"))
        .unwrap_or_default()
}

pub(crate) fn weighted_average_cost(
    current_quantity: i32,
    current_cost: i64,
    incoming_quantity: i32,
    incoming_cost: i64,
) -> Result<i64, AppError> {
    let total_quantity = current_quantity
        .checked_add(incoming_quantity)
        .ok_or_else(|| AppError::validation("stock quantity exceeds supported range"))?;
    let value = i128::from(current_quantity)
        .checked_mul(i128::from(current_cost))
        .and_then(|amount| {
            amount.checked_add(i128::from(incoming_quantity) * i128::from(incoming_cost))
        })
        .ok_or_else(|| AppError::validation("inventory valuation exceeds supported range"))?;
    i64::try_from((value + i128::from(total_quantity / 2)) / i128::from(total_quantity))
        .map_err(|_| AppError::validation("inventory unit cost exceeds supported range"))
}

pub async fn save_kit_components(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
    components: Vec<KitComponentInput>,
    auto_unbundle_on_receive: Option<bool>,
    actor_user_id: &str,
) -> Result<Vec<inventory_repository::InventoryKitComponentRecord>, AppError> {
    if components.is_empty() || components.len() > 100 {
        return Err(AppError::validation("kit must contain 1 to 100 components"));
    }
    let mut normalized = Vec::with_capacity(components.len());
    let mut ids = HashSet::new();
    for component in components {
        let id = component.inventory_item_id.trim().to_string();
        if id.is_empty()
            || id == kit_inventory_item_id
            || component.quantity <= 0
            || !ids.insert(id.clone())
        {
            return Err(AppError::validation(
                "kit components must be unique active items with positive quantity",
            ));
        }
        normalized.push((id, component.quantity));
    }
    normalized.sort_by(|left, right| left.0.cmp(&right.0));
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start kit update"))?;
    let kit = inventory_repository::lock_for_adjustment(
        &mut tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock kit item"))?
    .filter(|item| item.active)
    .ok_or_else(|| AppError::not_found("kit item was not found"))?;
    if kit.batch_tracked {
        return Err(AppError::conflict(
            "batch-tracked products cannot be assembled kits",
        ));
    }
    if !matches!(kit.product_usage.as_str(), "retail" | "consumable") {
        return Err(AppError::validation(
            "a kit must be either retail or consumable, not dual-use",
        ));
    }
    if inventory_repository::is_kit_component(&mut tx, tenant_id, branch_id, kit_inventory_item_id)
        .await
        .map_err(|_| AppError::internal("failed to validate nested kit"))?
    {
        return Err(AppError::validation(
            "a component of another kit cannot become a nested kit",
        ));
    }
    let existing = inventory_repository::kit_components_for_update(
        &mut tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load existing kit components"))?;
    let existing_definition = existing
        .iter()
        .map(|row| (row.component_inventory_item_id.clone(), row.quantity))
        .collect::<Vec<_>>();
    if kit.stock_quantity > 0 && existing_definition != normalized {
        return Err(AppError::conflict(
            "unbundle existing kit stock before changing its components",
        ));
    }
    for (component_id, _) in &normalized {
        let component =
            inventory_repository::lock_for_adjustment(&mut tx, tenant_id, branch_id, component_id)
                .await
                .map_err(|_| AppError::internal("failed to validate kit component"))?
                .filter(|item| item.active && item.center_available)
                .ok_or_else(|| AppError::validation("kit component is unavailable"))?;
        if !kit_component_allowed(&kit.product_usage, &component.product_usage) {
            return Err(AppError::validation(
                "retail kits can contain only retail or dual-use products; consumable kits can contain only consumable or dual-use products",
            ));
        }
        if inventory_repository::has_kit_components(&mut tx, tenant_id, branch_id, &component.id)
            .await
            .map_err(|_| AppError::internal("failed to validate nested kit"))?
        {
            return Err(AppError::validation("nested kits are not supported"));
        }
    }
    inventory_repository::replace_kit_components(
        &mut tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
        &normalized,
    )
    .await
    .map_err(|_| AppError::internal("failed to save kit components"))?;
    if let Some(enabled) = auto_unbundle_on_receive {
        inventory_repository::save_kit_auto_unbundle(
            &mut tx,
            tenant_id,
            branch_id,
            kit_inventory_item_id,
            enabled,
            actor_user_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to save kit receiving setting"))?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit kit components"))?;
    inventory_repository::kit_components(&state.db, tenant_id, branch_id, kit_inventory_item_id)
        .await
        .map_err(|_| AppError::internal("failed to load kit components"))
}

pub async fn assemble_kit(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
    quantity: i32,
    idempotency_key: &str,
    actor_user_id: &str,
    comments: &str,
) -> Result<KitAssemblyResult, AppError> {
    if quantity <= 0
        || idempotency_key.trim().is_empty()
        || idempotency_key.len() > 120
        || comments.chars().count() > 500
    {
        return Err(AppError::validation(
            "positive quantity, a valid idempotencyKey and comments up to 500 characters are required",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start kit assembly"))?;
    let kit = inventory_repository::lock_for_adjustment(
        &mut tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock kit inventory"))?
    .filter(|item| item.active && item.center_available)
    .ok_or_else(|| AppError::not_found("kit item was not found"))?;
    if let Some(operation) = inventory_repository::kit_operation_by_key(
        &mut tx,
        tenant_id,
        branch_id,
        idempotency_key.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to read kit assembly replay"))?
    {
        tx.rollback().await.ok();
        if operation.kit_inventory_item_id != kit.id
            || operation.operation_type != "bundle"
            || operation.quantity != quantity
        {
            return Err(AppError::conflict(
                "idempotencyKey is already used by a different kit operation",
            ));
        }
        return Ok(KitAssemblyResult {
            id: operation.id,
            kit_inventory_item_id: kit.id,
            quantity,
            stock_quantity: operation.stock_after_quantity,
        });
    }
    if kit.batch_tracked {
        return Err(AppError::conflict(
            "batch-tracked products cannot be assembled kits",
        ));
    }
    if !matches!(kit.product_usage.as_str(), "retail" | "consumable") {
        return Err(AppError::validation(
            "a kit must be either retail or consumable, not dual-use",
        ));
    }
    let components = inventory_repository::kit_components_for_update(
        &mut tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load kit components"))?;
    if components.is_empty() {
        return Err(AppError::validation("kit has no components"));
    }
    let assembly_id = inventory_repository::create_kit_operation(
        &mut tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
        "bundle",
        quantity,
        idempotency_key.trim(),
        actor_user_id,
        comments.trim(),
        None,
        None,
    )
    .await
    .map_err(|_| AppError::conflict("kit assembly idempotency key already exists"))?;
    let mut kit_cost = 0i64;
    for component in components {
        let item = inventory_repository::lock_for_adjustment(
            &mut tx,
            tenant_id,
            branch_id,
            &component.component_inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to lock kit component"))?
        .filter(|item| item.active && item.center_available)
        .ok_or_else(|| AppError::validation("kit component is unavailable"))?;
        if !kit_component_allowed(&kit.product_usage, &item.product_usage) {
            return Err(AppError::validation(
                "kit component type no longer matches the kit",
            ));
        }
        let required = component
            .quantity
            .checked_mul(quantity)
            .ok_or_else(|| AppError::validation("kit quantity exceeds supported range"))?;
        if item.stock_quantity < required {
            return Err(AppError::conflict(format!(
                "insufficient stock for {}",
                component.component_name
            )));
        }
        let stock_after = item.stock_quantity - required;
        let component_unit_cost_paise = outbound_unit_cost(
            &mut tx,
            tenant_id,
            branch_id,
            &item.id,
            item.batch_tracked,
            item.unit_cost_paise,
            required,
        )
        .await?;
        inventory_repository::apply_adjusted_stock(
            &mut tx,
            tenant_id,
            branch_id,
            &item.id,
            stock_after,
        )
        .await
        .map_err(|_| AppError::internal("failed to consume kit component"))?;
        let ledger_id = inventory_repository::add_kit_ledger(
            &mut tx,
            tenant_id,
            branch_id,
            &item.id,
            &assembly_id,
            "kit_component_out",
            -required,
            component_unit_cost_paise,
            stock_after,
        )
        .await
        .map_err(|_| AppError::internal("failed to write kit component ledger"))?;
        allocate_fefo_batches(&mut tx, tenant_id, branch_id, &item, &ledger_id, required).await?;
        kit_cost = kit_cost
            .checked_add(
                i64::from(component.quantity)
                    .checked_mul(component_unit_cost_paise)
                    .ok_or_else(|| AppError::validation("kit valuation exceeds supported range"))?,
            )
            .ok_or_else(|| AppError::validation("kit valuation exceeds supported range"))?;
    }
    let stock_after = kit
        .stock_quantity
        .checked_add(quantity)
        .ok_or_else(|| AppError::validation("kit stock exceeds supported range"))?;
    let weighted_cost =
        weighted_average_cost(kit.stock_quantity, kit.unit_cost_paise, quantity, kit_cost)?;
    inventory_repository::apply_stock_and_cost(
        &mut tx,
        tenant_id,
        branch_id,
        &kit.id,
        stock_after,
        weighted_cost,
    )
    .await
    .map_err(|_| AppError::internal("failed to receive assembled kit"))?;
    inventory_repository::add_kit_ledger(
        &mut tx,
        tenant_id,
        branch_id,
        &kit.id,
        &assembly_id,
        "kit_assembly_in",
        quantity,
        kit_cost,
        stock_after,
    )
    .await
    .map_err(|_| AppError::internal("failed to write kit assembly ledger"))?;
    inventory_repository::finish_kit_operation(
        &mut tx,
        tenant_id,
        branch_id,
        &assembly_id,
        kit_cost,
        stock_after,
    )
    .await
    .map_err(|_| AppError::internal("failed to finish kit assembly history"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit kit assembly"))?;
    Ok(KitAssemblyResult {
        id: assembly_id,
        kit_inventory_item_id: kit.id,
        quantity,
        stock_quantity: stock_after,
    })
}

pub async fn unbundle_kit(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
    input: KitOperationInput<'_>,
) -> Result<KitAssemblyResult, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start kit unbundle"))?;
    let result = unbundle_kit_in_tx(
        &mut tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
        input.quantity,
        input.idempotency_key,
        input.actor_user_id,
        input.comments,
        "unbundle",
        None,
        None,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit kit unbundle"))?;
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
pub async fn unbundle_kit_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
    quantity: i32,
    idempotency_key: &str,
    actor_user_id: &str,
    comments: &str,
    operation_type: &str,
    source_receipt_id: Option<&str>,
    source_receipt_line_id: Option<&str>,
) -> Result<KitAssemblyResult, AppError> {
    if quantity <= 0
        || idempotency_key.trim().is_empty()
        || idempotency_key.len() > 120
        || comments.chars().count() > 500
        || !matches!(operation_type, "unbundle" | "receipt_unbundle")
    {
        return Err(AppError::validation("kit unbundle input is invalid"));
    }
    let kit =
        inventory_repository::lock_for_adjustment(tx, tenant_id, branch_id, kit_inventory_item_id)
            .await
            .map_err(|_| AppError::internal("failed to lock kit inventory"))?
            .filter(|item| item.active && item.center_available)
            .ok_or_else(|| AppError::not_found("kit item was not found"))?;
    if let Some(operation) =
        inventory_repository::kit_operation_by_key(tx, tenant_id, branch_id, idempotency_key.trim())
            .await
            .map_err(|_| AppError::internal("failed to read kit unbundle replay"))?
    {
        if operation.kit_inventory_item_id != kit.id
            || operation.operation_type != operation_type
            || operation.quantity != quantity
        {
            return Err(AppError::conflict(
                "idempotencyKey is already used by a different kit operation",
            ));
        }
        return Ok(KitAssemblyResult {
            id: operation.id,
            kit_inventory_item_id: kit.id,
            quantity,
            stock_quantity: operation.stock_after_quantity,
        });
    }
    if kit.batch_tracked || !matches!(kit.product_usage.as_str(), "retail" | "consumable") {
        return Err(AppError::validation(
            "only non-batch retail or consumable kits can be unbundled",
        ));
    }
    if kit.stock_quantity < quantity {
        return Err(AppError::conflict(
            "insufficient finished kit stock to unbundle",
        ));
    }
    let components = inventory_repository::kit_components_for_update(
        tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load kit components"))?;
    if components.is_empty() {
        return Err(AppError::validation("kit has no components"));
    }
    let mut locked = Vec::with_capacity(components.len());
    let mut component_cost = 0i128;
    let mut component_units = 0i64;
    for component in components {
        let item = inventory_repository::lock_for_adjustment(
            tx,
            tenant_id,
            branch_id,
            &component.component_inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to lock kit component"))?
        .filter(|item| item.active && item.center_available)
        .ok_or_else(|| AppError::validation("kit component is unavailable"))?;
        if !kit_component_allowed(&kit.product_usage, &item.product_usage) {
            return Err(AppError::validation(
                "kit component type no longer matches the kit",
            ));
        }
        component_cost += i128::from(component.quantity) * i128::from(item.unit_cost_paise);
        component_units += i64::from(component.quantity);
        locked.push((component, item));
    }
    let operation_id = inventory_repository::create_kit_operation(
        tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
        operation_type,
        quantity,
        idempotency_key.trim(),
        actor_user_id,
        comments.trim(),
        source_receipt_id,
        source_receipt_line_id,
    )
    .await
    .map_err(|_| AppError::conflict("kit operation idempotency key already exists"))?;
    for (component, item) in locked {
        let incoming_quantity = component
            .quantity
            .checked_mul(quantity)
            .ok_or_else(|| AppError::validation("kit quantity exceeds supported range"))?;
        let incoming_cost = if component_cost > 0 {
            i64::try_from(
                (i128::from(kit.unit_cost_paise) * i128::from(item.unit_cost_paise)
                    + component_cost / 2)
                    / component_cost,
            )
            .map_err(|_| AppError::validation("component valuation exceeds supported range"))?
        } else {
            (kit.unit_cost_paise + component_units / 2) / component_units
        };
        let stock_after = item
            .stock_quantity
            .checked_add(incoming_quantity)
            .ok_or_else(|| AppError::validation("component stock exceeds supported range"))?;
        let next_cost = weighted_average_cost(
            item.stock_quantity,
            item.unit_cost_paise,
            incoming_quantity,
            incoming_cost,
        )?;
        inventory_repository::apply_stock_and_cost(
            tx,
            tenant_id,
            branch_id,
            &item.id,
            stock_after,
            next_cost,
        )
        .await
        .map_err(|_| AppError::internal("failed to restore kit component"))?;
        let ledger_id = inventory_repository::add_kit_ledger(
            tx,
            tenant_id,
            branch_id,
            &item.id,
            &operation_id,
            "kit_component_in",
            incoming_quantity,
            incoming_cost,
            stock_after,
        )
        .await
        .map_err(|_| AppError::internal("failed to write kit component-in ledger"))?;
        let unbundle_batch = kit_unbundle_batch_number(item.batch_tracked, &operation_id);
        record_batch_receipt(
            tx,
            tenant_id,
            branch_id,
            &item.id,
            item.batch_tracked,
            &unbundle_batch,
            "",
            None,
            chrono::Utc::now().date_naive(),
            incoming_quantity,
            incoming_cost,
            &ledger_id,
        )
        .await?;
    }
    let stock_after = kit.stock_quantity - quantity;
    inventory_repository::apply_adjusted_stock(tx, tenant_id, branch_id, &kit.id, stock_after)
        .await
        .map_err(|_| AppError::internal("failed to consume finished kit"))?;
    inventory_repository::add_kit_ledger(
        tx,
        tenant_id,
        branch_id,
        &kit.id,
        &operation_id,
        "kit_unbundle_out",
        -quantity,
        kit.unit_cost_paise,
        stock_after,
    )
    .await
    .map_err(|_| AppError::internal("failed to write kit unbundle ledger"))?;
    inventory_repository::finish_kit_operation(
        tx,
        tenant_id,
        branch_id,
        &operation_id,
        kit.unit_cost_paise,
        stock_after,
    )
    .await
    .map_err(|_| AppError::internal("failed to finish kit unbundle history"))?;
    Ok(KitAssemblyResult {
        id: operation_id,
        kit_inventory_item_id: kit.id,
        quantity,
        stock_quantity: stock_after,
    })
}

fn validate(input: &InventoryUpdateInput<'_>) -> Result<(), AppError> {
    if input.stock_quantity.is_some_and(|value| value < 0) {
        return Err(AppError::validation("stockQuantity must be 0 or greater"));
    }
    if input.barcode.is_some_and(|value| value.trim().len() > 120) {
        return Err(AppError::validation(
            "barcode must be at most 120 characters",
        ));
    }
    if input.barcodes.is_some_and(|values| values.len() > 10)
        || [
            input.reorder_point,
            input.alert_level,
            input.desired_level,
            input.order_level,
            input.safety_stock_level,
        ]
        .into_iter()
        .flatten()
        .any(|value| value < 0)
    {
        return Err(AppError::validation(
            "stock levels must be non-negative and a product can have at most 10 barcodes",
        ));
    }
    if input
        .adjustment_reason
        .is_some_and(|value| value.trim().len() > 500)
    {
        return Err(AppError::validation(
            "adjustmentReason must be at most 500 characters",
        ));
    }
    if input
        .adjustment_evidence_reference
        .is_some_and(|value| value.trim().len() > 500)
    {
        return Err(AppError::validation(
            "adjustmentEvidenceReference must be at most 500 characters",
        ));
    }
    if input
        .idempotency_key
        .is_some_and(|value| value.trim().len() > 120)
    {
        return Err(AppError::validation(
            "idempotencyKey must be at most 120 characters",
        ));
    }
    Ok(())
}

fn map_ledger_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .and_then(|value| value.code())
        .is_some_and(|code| code == "23505")
    {
        AppError::conflict("idempotencyKey is already used by another inventory adjustment")
    } else {
        AppError::internal("failed to write inventory adjustment ledger")
    }
}

#[cfg(test)]
mod tests {
    use super::{fefo_plan, fifo_planned_unit_cost, update_in_tx, validate, InventoryUpdateInput};
    use sqlx::PgPool;

    fn input<'a>(
        tenant_id: &'a str,
        branch_id: &'a str,
        target: i32,
        key: &'a str,
    ) -> InventoryUpdateInput<'a> {
        InventoryUpdateInput {
            tenant_id,
            branch_id,
            id: "item-1",
            sku: None,
            name: None,
            category: None,
            subcategory: None,
            brand: None,
            product_usage: None,
            unit: None,
            package_unit: None,
            units_per_package: None,
            stock_quantity: Some(target),
            reorder_point: None,
            alert_level: None,
            desired_level: None,
            order_level: None,
            safety_stock_level: None,
            unit_cost_paise: None,
            retail_price_paise: None,
            hsn_code: None,
            gst_percent: None,
            barcode: None,
            barcodes: None,
            batch_tracked: None,
            dual_use_stock: None,
            center_available: None,
            online_sale_enabled: None,
            active: None,
            adjustment_reason: Some("Cycle count correction"),
            adjustment_evidence_reference: Some("count-sheet-1"),
            adjustment_business_date: Some("2026-08-01"),
            idempotency_key: Some(key),
            actor_user_id: "user-1",
        }
    }

    #[sqlx::test(migrations = false)]
    async fn adjustment_is_scoped_idempotent_and_atomic(pool: PgPool) {
        for statement in [
            r#"
            CREATE TABLE inventory_items (
              id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
              sku TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
              unit TEXT NOT NULL DEFAULT 'pcs', package_unit TEXT NOT NULL DEFAULT 'pcs',
              units_per_package INTEGER NOT NULL DEFAULT 1, stock_quantity INTEGER NOT NULL DEFAULT 0,
              reorder_point INTEGER NOT NULL DEFAULT 0, unit_cost_paise BIGINT NOT NULL DEFAULT 0,
              hsn_code TEXT NOT NULL DEFAULT '', gst_percent INTEGER NOT NULL DEFAULT 0,
              barcode TEXT NOT NULL DEFAULT '', batch_tracked BOOLEAN NOT NULL DEFAULT FALSE,
              dual_use_stock BOOLEAN NOT NULL DEFAULT FALSE, active BOOLEAN NOT NULL DEFAULT TRUE, central_master_item_id TEXT,
              franchise_override_fields TEXT[] NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ
            )
            "#,
            r#"CREATE TABLE franchise_policies (
              tenant_id TEXT PRIMARY KEY, central_branch_id TEXT NOT NULL,
              allowed_override_fields TEXT[] NOT NULL DEFAULT '{}'
            )"#,
            r#"
            CREATE TABLE inventory_stock_ledger (
              id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT, tenant_id TEXT NOT NULL,
              branch_id TEXT NOT NULL, inventory_item_id TEXT NOT NULL, sale_id TEXT, sale_line_id TEXT,
              movement_type TEXT NOT NULL CONSTRAINT inventory_stock_ledger_movement_type_check
                CHECK (movement_type IN ('sale', 'return', 'purchase', 'transfer_out', 'transfer_in', 'transfer_reversal')),
              quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
              unit_cost_paise BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            "#,
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("inventory adjustment schema should be created");
        }
        sqlx::raw_sql(include_str!(
            "../../migrations/0081_inventory_adjustment_ledger.sql"
        ))
        .execute(&pool)
        .await
        .expect("inventory adjustment migration should apply");
        sqlx::query("INSERT INTO inventory_items (id,tenant_id,branch_id,name,stock_quantity,unit_cost_paise) VALUES ('item-1','tenant-1','branch-1','Shampoo',10,2500)")
            .execute(&pool).await.expect("inventory fixture should be created");

        let mut success = pool
            .begin()
            .await
            .expect("success transaction should start");
        let updated = update_in_tx(&mut success, &input("tenant-1", "branch-1", 7, "count-1"))
            .await
            .expect("adjustment should succeed")
            .expect("item should exist");
        success
            .commit()
            .await
            .expect("success transaction should commit");
        assert_eq!(updated.stock_quantity, 7);

        let mut retry = pool.begin().await.expect("retry transaction should start");
        update_in_tx(&mut retry, &input("tenant-1", "branch-1", 7, "count-1"))
            .await
            .expect("retry should return existing adjustment");
        retry
            .commit()
            .await
            .expect("retry transaction should commit");
        let ledger_count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM inventory_stock_ledger")
                .fetch_one(&pool)
                .await
                .expect("ledger count should load");
        assert_eq!(ledger_count, 1);

        let mut wrong_branch = pool.begin().await.expect("scope transaction should start");
        let scoped = update_in_tx(
            &mut wrong_branch,
            &input("tenant-1", "branch-2", 5, "count-2"),
        )
        .await
        .expect("scope check should not fail");
        wrong_branch
            .rollback()
            .await
            .expect("scope transaction should roll back");
        assert!(scoped.is_none());

        let mut rollback = pool
            .begin()
            .await
            .expect("rollback transaction should start");
        update_in_tx(
            &mut rollback,
            &input("tenant-1", "branch-1", 3, "count-rollback"),
        )
        .await
        .expect("rollback adjustment should stage");
        rollback
            .rollback()
            .await
            .expect("rollback transaction should roll back");
        let persisted_stock = sqlx::query_scalar::<_, i32>(
            "SELECT stock_quantity FROM inventory_items WHERE id='item-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("stock should load");
        let persisted_ledger =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM inventory_stock_ledger")
                .fetch_one(&pool)
                .await
                .expect("ledger count should load");
        assert_eq!(persisted_stock, 7);
        assert_eq!(persisted_ledger, 1);

        sqlx::query(
            "UPDATE inventory_items SET central_master_item_id='central-item' WHERE id='item-1'",
        )
        .execute(&pool)
        .await
        .expect("linked product should be configured");
        sqlx::query("INSERT INTO franchise_policies(tenant_id,central_branch_id,allowed_override_fields) VALUES('tenant-1','central',ARRAY['active'])")
            .execute(&pool).await.expect("override policy should be configured");
        let mut blocked_input = input("tenant-1", "branch-1", 7, "");
        blocked_input.stock_quantity = None;
        blocked_input.name = Some("Local Shampoo");
        let mut blocked = pool
            .begin()
            .await
            .expect("blocked transaction should start");
        assert!(update_in_tx(&mut blocked, &blocked_input).await.is_err());
        blocked
            .rollback()
            .await
            .expect("blocked transaction should roll back");

        sqlx::query("UPDATE franchise_policies SET allowed_override_fields=ARRAY['name'] WHERE tenant_id='tenant-1'")
            .execute(&pool).await.expect("override policy should update");
        let mut allowed = pool
            .begin()
            .await
            .expect("allowed transaction should start");
        update_in_tx(&mut allowed, &blocked_input)
            .await
            .expect("allowed override should save");
        allowed
            .commit()
            .await
            .expect("allowed override should commit");
        let overrides: Vec<String> = sqlx::query_scalar(
            "SELECT franchise_override_fields FROM inventory_items WHERE id='item-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("override fields should load");
        assert_eq!(overrides, vec!["name"]);

        assert!(validate(&input("tenant-1", "branch-1", -1, "negative-1")).is_err());
    }

    #[test]
    fn fefo_uses_earliest_available_batches_and_rejects_shortage() {
        assert_eq!(fefo_plan(&[2, 5, 9], 6), Some(vec![2, 4, 0]));
        assert_eq!(fefo_plan(&[2, 1], 4), None);
        assert_eq!(fifo_planned_unit_cost(&[(2, 100), (5, 130)], 4), Some(115));
    }
}
