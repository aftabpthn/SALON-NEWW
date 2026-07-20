use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};

use crate::{
    models::common::AppError,
    repositories::{inventory_repository, stock_audit_repository as repo},
    services::{accounting_service, inventory_adjustment_service},
    state::AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetails {
    pub session: repo::SessionRecord,
    pub items: Vec<SessionItemView>,
    pub counts: Vec<repo::CountLineRecord>,
    pub findings: Vec<repo::FindingRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionItemView {
    pub id: String,
    pub inventory_item_id: String,
    pub item_name: String,
    pub sku: String,
    pub unit: String,
    pub expected_quantity: Option<i32>,
    pub approved_quantity: Option<i32>,
    pub variance_quantity: Option<i32>,
    pub variance_reason: String,
    pub adjustment_ledger_id: Option<String>,
    pub posted_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub event: repo::ScannerEventRecord,
    pub alias_type: String,
    pub target_id: String,
}

pub async fn list(
    state: &AppState,
    tenant: &str,
    branch: &str,
) -> Result<Vec<repo::SessionRecord>, AppError> {
    repo::list_sessions(&state.db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load stock audits"))
}

pub async fn create(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    name: &str,
    blind: bool,
    counters: i32,
    threshold: i32,
) -> Result<SessionDetails, AppError> {
    let name = required_text(name, 160, "audit name")?;
    if !(1..=5).contains(&counters) || threshold < 0 {
        return Err(AppError::validation("invalid counter or recount threshold"));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start stock audit"))?;
    let id = repo::create_session(
        &mut tx, tenant, branch, name, blind, counters, threshold, actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to create stock audit"))?;
    if repo::snapshot_items(&mut tx, tenant, branch, &id)
        .await
        .map_err(|_| AppError::internal("failed to snapshot stock"))?
        == 0
    {
        return Err(AppError::validation(
            "no active inventory items are available to count",
        ));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit stock audit"))?;
    details(state, tenant, branch, &id).await
}

pub async fn details(
    state: &AppState,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<SessionDetails, AppError> {
    let (session, items, counts, findings) = tokio::try_join!(
        repo::get_session(&state.db, tenant, branch, id),
        repo::session_items(&state.db, tenant, branch, id),
        repo::count_lines(&state.db, tenant, branch, id),
        repo::findings(&state.db, tenant, branch, id)
    )
    .map_err(|_| AppError::internal("failed to load stock audit"))?;
    let session =
        session.ok_or_else(|| AppError::not_found("stock audit session was not found"))?;
    let hide_expected = session.blind_counting
        && matches!(session.status.as_str(), "counting" | "recount_required");
    Ok(SessionDetails {
        session,
        counts,
        findings,
        items: items
            .into_iter()
            .map(|item| SessionItemView {
                id: item.id,
                inventory_item_id: item.inventory_item_id,
                item_name: item.item_name,
                sku: item.sku,
                unit: item.unit,
                expected_quantity: (!hide_expected).then_some(item.expected_quantity),
                approved_quantity: item.approved_quantity,
                variance_quantity: item.variance_quantity,
                variance_reason: item.variance_reason,
                adjustment_ledger_id: item.adjustment_ledger_id,
                posted_at: item.posted_at,
            })
            .collect(),
    })
}

pub async fn record_count(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    session_id: &str,
    item_id: &str,
    quantity: i32,
    device: &str,
    key: &str,
) -> Result<SessionDetails, AppError> {
    if quantity < 0 {
        return Err(AppError::validation("counted quantity cannot be negative"));
    }
    let key = required_text(key, 120, "idempotencyKey")?;
    let device = text(device, 120, "deviceId")?;
    let session = repo::get_session(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit"))?
        .ok_or_else(|| AppError::not_found("stock audit session was not found"))?;
    if !matches!(session.status.as_str(), "counting" | "recount_required") {
        return Err(AppError::conflict("stock audit is not accepting counts"));
    }
    let item = repo::session_item(&state.db, tenant, branch, session_id, item_id)
        .await
        .map_err(|_| AppError::internal("failed to validate stock audit item"))?
        .ok_or_else(|| AppError::not_found("inventory item is not in this stock audit"))?;
    let round = if session.status == "recount_required" {
        2
    } else {
        1
    };
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start stock count"))?;
    if let Some(existing) = repo::count_by_key(&mut tx, tenant, branch, key)
        .await
        .map_err(|_| AppError::internal("failed to check count replay"))?
    {
        if existing.session_item_id != item.id
            || existing.counter_user_id != actor
            || existing.counted_quantity != quantity
        {
            return Err(AppError::conflict(
                "idempotencyKey is already used by a different count",
            ));
        }
    } else {
        repo::insert_count(
            &mut tx, tenant, branch, &item.id, actor, round, quantity, device, key,
        )
        .await
        .map_err(|_| {
            AppError::conflict("this counter already submitted this item for the current round")
        })?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit stock count"))?;
    details(state, tenant, branch, session_id).await
}

pub async fn close_counting(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    session_id: &str,
) -> Result<SessionDetails, AppError> {
    let session = repo::get_session(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit"))?
        .ok_or_else(|| AppError::not_found("stock audit session was not found"))?;
    if !matches!(session.status.as_str(), "counting" | "recount_required") {
        return Err(AppError::conflict("stock audit cannot be closed"));
    }
    let items = repo::session_items(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit items"))?;
    let lines = repo::count_lines(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock count lines"))?;
    let round = if session.status == "recount_required" {
        2
    } else {
        1
    };
    let mut grouped: HashMap<&str, Vec<i32>> = HashMap::new();
    for line in lines.iter().filter(|line| line.round_number == round) {
        grouped
            .entry(&line.session_item_id)
            .or_default()
            .push(line.counted_quantity);
    }
    for item in &items {
        if grouped.get(item.id.as_str()).map_or(0, Vec::len) < session.required_counters as usize {
            return Err(AppError::validation(
                "every snapshot item needs all required counter counts",
            ));
        }
    }
    let needs_recount = grouped.values().any(|values| {
        values.iter().max().unwrap_or(&0) - values.iter().min().unwrap_or(&0)
            > session.recount_threshold
    });
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to close stock audit"))?;
    if needs_recount {
        if !repo::set_status(
            &mut tx,
            tenant,
            branch,
            session_id,
            &session.status,
            "recount_required",
            actor,
            "",
        )
        .await
        .map_err(|_| AppError::internal("failed to require recount"))?
        {
            return Err(AppError::conflict("stock audit state changed"));
        }
    } else {
        for item in &items {
            let values = &grouped[item.id.as_str()];
            let counted =
                (values.iter().sum::<i32>() + values.len() as i32 / 2) / values.len() as i32;
            repo::set_review_results(
                &mut tx,
                tenant,
                branch,
                &item.id,
                counted,
                counted - item.expected_quantity,
            )
            .await
            .map_err(|_| AppError::internal("failed to calculate stock variance"))?;
        }
        if !repo::set_status(
            &mut tx,
            tenant,
            branch,
            session_id,
            &session.status,
            "review",
            actor,
            "",
        )
        .await
        .map_err(|_| AppError::internal("failed to open stock review"))?
        {
            return Err(AppError::conflict("stock audit state changed"));
        }
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit stock audit review"))?;
    details(state, tenant, branch, session_id).await
}

pub async fn set_variance_reason(
    state: &AppState,
    tenant: &str,
    branch: &str,
    session_id: &str,
    session_item_id: &str,
    reason: &str,
) -> Result<SessionDetails, AppError> {
    let session = repo::get_session(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit"))?
        .ok_or_else(|| AppError::not_found("stock audit session was not found"))?;
    if session.status != "review" {
        return Err(AppError::conflict(
            "variance reasons can be set during review",
        ));
    }
    let reason = required_text(reason, 500, "variance reason")?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to save variance reason"))?;
    if !repo::set_reason(&mut tx, tenant, branch, session_item_id, reason)
        .await
        .map_err(|_| AppError::internal("failed to save variance reason"))?
    {
        return Err(AppError::not_found("stock audit item was not found"));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit variance reason"))?;
    details(state, tenant, branch, session_id).await
}

pub async fn submit_for_approval(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    session_id: &str,
) -> Result<SessionDetails, AppError> {
    let session = repo::get_session(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit"))?
        .ok_or_else(|| AppError::not_found("stock audit session was not found"))?;
    if session.status != "review" {
        return Err(AppError::conflict("stock audit is not ready for approval"));
    }
    let items = repo::session_items(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit items"))?;
    if items.iter().any(|item| {
        item.variance_quantity.unwrap_or_default() != 0 && item.variance_reason.trim().is_empty()
    }) {
        return Err(AppError::validation("each stock variance needs a reason"));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to submit stock audit"))?;
    if !repo::set_status(
        &mut tx,
        tenant,
        branch,
        session_id,
        "review",
        "pending_approval",
        actor,
        "",
    )
    .await
    .map_err(|_| AppError::internal("failed to submit stock audit"))?
    {
        return Err(AppError::conflict("stock audit state changed"));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit stock audit submission"))?;
    details(state, tenant, branch, session_id).await
}

pub async fn approve(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    actor_role: &str,
    session_id: &str,
) -> Result<SessionDetails, AppError> {
    let session = repo::get_session(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit"))?
        .ok_or_else(|| AppError::not_found("stock audit session was not found"))?;
    if session.status != "pending_approval" {
        return Err(AppError::conflict("stock audit is not pending approval"));
    }
    if session.created_by == actor
        || session.submitted_by.as_deref() == Some(actor)
        || repo::counters_for_session(&state.db, tenant, branch, session_id, actor)
            .await
            .map_err(|_| AppError::internal("failed to enforce approval separation"))?
    {
        return Err(AppError::forbidden(
            "a session creator, submitter, or counter cannot approve this stock audit",
        ));
    }
    let items = repo::session_items(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit items"))?;
    let policy =
        crate::services::inventory_governance_service::policy(&state.db, tenant, branch).await?;
    let threshold_bps = policy
        .get("countVarianceThresholdBps")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(500);
    let exceeds_threshold = items.iter().any(|item| {
        let variance = i64::from(item.variance_quantity.unwrap_or_default()).abs();
        let expected = i64::from(item.expected_quantity).abs();
        variance > 0
            && (expected == 0 || variance.saturating_mul(10_000) / expected.max(1) > threshold_bps)
    });
    if exceeds_threshold && !matches!(actor_role, "owner" | "admin") {
        return Err(AppError::forbidden(
            "owner approval is required above the configured count variance threshold",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to approve stock audit"))?;
    if !repo::set_status(
        &mut tx,
        tenant,
        branch,
        session_id,
        "pending_approval",
        "approved",
        actor,
        "",
    )
    .await
    .map_err(|_| AppError::internal("failed to approve stock audit"))?
    {
        return Err(AppError::conflict("stock audit state changed"));
    }
    for item in &items {
        let delta = item.variance_quantity.unwrap_or_default();
        if delta == 0 {
            repo::mark_posted(&mut tx, tenant, branch, &item.id, None)
                .await
                .map_err(|_| AppError::internal("failed to mark stock audit item"))?;
            continue;
        }
        let locked = repo::lock_inventory(&mut tx, tenant, branch, &item.inventory_item_id)
            .await
            .map_err(|_| AppError::internal("failed to lock inventory item"))?
            .ok_or_else(|| AppError::not_found("inventory item was not found"))?;
        let target = locked.stock_quantity.checked_add(delta).ok_or_else(|| {
            AppError::validation("stock audit adjustment exceeds supported range")
        })?;
        if target < 0 {
            return Err(AppError::conflict(
                "stock movement after cutoff makes the approved count invalid",
            ));
        }
        let key = format!("stock-audit:{session_id}:{}", item.id);
        let ledger = if let Some((_, _)) =
            inventory_repository::adjustment_replay(&mut tx, tenant, branch, &key)
                .await
                .map_err(|_| AppError::internal("failed to check stock audit replay"))?
        {
            None
        } else {
            inventory_repository::apply_adjusted_stock(
                &mut tx,
                tenant,
                branch,
                &item.inventory_item_id,
                target,
            )
            .await
            .map_err(|_| AppError::internal("failed to apply stock audit adjustment"))?;
            let ledger = inventory_repository::add_adjustment_ledger(
                &mut tx,
                tenant,
                branch,
                &item.inventory_item_id,
                delta,
                locked.unit_cost_paise,
                target,
                &item.variance_reason,
                &key,
            )
            .await
            .map_err(|_| AppError::internal("failed to write stock audit ledger"))?;
            if delta < 0 {
                inventory_adjustment_service::allocate_fefo_quantity(
                    &mut tx,
                    tenant,
                    branch,
                    &item.inventory_item_id,
                    locked.batch_tracked,
                    &ledger,
                    delta.saturating_abs(),
                )
                .await?;
            }
            let amount = i64::from(delta.saturating_abs()) * locked.unit_cost_paise;
            let lines = if delta > 0 {
                vec![
                    accounting_service::ManualJournalLine {
                        account_code: accounting_service::INVENTORY_ASSET_ACCOUNT.into(),
                        debit_paise: amount,
                        credit_paise: 0,
                    },
                    accounting_service::ManualJournalLine {
                        account_code: "STOCK_VARIANCE_GAIN".into(),
                        debit_paise: 0,
                        credit_paise: amount,
                    },
                ]
            } else {
                vec![
                    accounting_service::ManualJournalLine {
                        account_code: if item.variance_reason.to_lowercase().contains("theft") {
                            "INVENTORY_SHRINKAGE_EXPENSE".into()
                        } else {
                            "STOCK_VARIANCE_LOSS".into()
                        },
                        debit_paise: amount,
                        credit_paise: 0,
                    },
                    accounting_service::ManualJournalLine {
                        account_code: accounting_service::INVENTORY_ASSET_ACCOUNT.into(),
                        debit_paise: 0,
                        credit_paise: amount,
                    },
                ]
            };
            accounting_service::post_control_journal(
                &mut tx,
                tenant,
                branch,
                "stock_count_adjustment",
                &item.id,
                Utc::now().date_naive(),
                "Approved stock audit variance",
                actor,
                &lines,
            )
            .await?;
            Some(ledger)
        };
        repo::mark_posted(&mut tx, tenant, branch, &item.id, ledger.as_deref())
            .await
            .map_err(|_| AppError::internal("failed to mark stock audit posting"))?;
    }
    if !repo::set_status(
        &mut tx, tenant, branch, session_id, "approved", "posted", actor, "",
    )
    .await
    .map_err(|_| AppError::internal("failed to post stock audit"))?
    {
        return Err(AppError::conflict("stock audit state changed"));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit stock audit posting"))?;
    details(state, tenant, branch, session_id).await
}

pub async fn reject(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    session_id: &str,
    reason: &str,
) -> Result<SessionDetails, AppError> {
    let reason = required_text(reason, 500, "rejection reason")?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to reject stock audit"))?;
    if !repo::set_status(
        &mut tx,
        tenant,
        branch,
        session_id,
        "pending_approval",
        "rejected",
        actor,
        reason,
    )
    .await
    .map_err(|_| AppError::internal("failed to reject stock audit"))?
    {
        return Err(AppError::conflict("stock audit is not pending approval"));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit stock audit rejection"))?;
    details(state, tenant, branch, session_id).await
}

pub async fn add_finding(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    session_id: &str,
    item_id: &str,
    kind: &str,
    notes: &str,
    evidence: Value,
) -> Result<SessionDetails, AppError> {
    if !["variance", "leakage", "theft"].contains(&kind) {
        return Err(AppError::validation("invalid finding type"));
    }
    if matches!(kind, "leakage" | "theft") && evidence.as_array().is_none_or(Vec::is_empty) {
        return Err(AppError::validation(
            "leakage and theft findings require evidence",
        ));
    }
    let session = repo::get_session(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit"))?
        .ok_or_else(|| AppError::not_found("stock audit session was not found"))?;
    if !matches!(session.status.as_str(), "review" | "pending_approval") {
        return Err(AppError::conflict("findings can be recorded during review"));
    }
    if repo::session_item(&state.db, tenant, branch, session_id, item_id)
        .await
        .map_err(|_| AppError::internal("failed to validate stock audit item"))?
        .is_none()
    {
        return Err(AppError::not_found(
            "inventory item is not in this stock audit",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to save finding"))?;
    repo::add_finding(
        &mut tx,
        tenant,
        branch,
        item_id,
        kind,
        text(notes, 1000, "finding notes")?,
        &evidence,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save finding"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit finding"))?;
    details(state, tenant, branch, session_id).await
}

pub async fn scan(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    device: &str,
    workflow: &str,
    code: &str,
    client_event: &str,
    captured_at: DateTime<Utc>,
) -> Result<ScanResult, AppError> {
    if !["lookup", "receive", "count", "waste", "transfer"].contains(&workflow) {
        return Err(AppError::validation("invalid scanner workflow"));
    }
    let code = required_text(code, 160, "code")?;
    let device = text(device, 120, "deviceId")?;
    let client_event = required_text(client_event, 120, "clientEventId")?;
    let resolved = repo::resolve_code(&state.db, tenant, branch, code)
        .await
        .map_err(|_| AppError::internal("failed to resolve barcode"))?;
    let (item, alias, target, result) = match resolved {
        Some((item, kind, target)) => (item, kind, target, "matched"),
        None => (None, String::new(), String::new(), "unmatched"),
    };
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to record scanner event"))?;
    let event = repo::scanner_event(
        &mut tx,
        tenant,
        branch,
        actor,
        device,
        workflow,
        code,
        result,
        item.as_deref(),
        client_event,
        captured_at,
        &json!({"aliasType":alias,"targetId":target}),
    )
    .await
    .map_err(|_| AppError::internal("failed to record scanner event"))?;
    if event.user_id != actor
        || event.device_id != device
        || event.workflow != workflow
        || event.code != code
    {
        return Err(AppError::conflict(
            "clientEventId is already used by a different scan",
        ));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit scanner event"))?;
    Ok(ScanResult {
        event,
        alias_type: alias.into(),
        target_id: target.into(),
    })
}

pub async fn scanner_events(
    state: &AppState,
    tenant: &str,
    branch: &str,
) -> Result<Vec<repo::ScannerEventRecord>, AppError> {
    repo::list_scanner_events(&state.db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load scanner events"))
}
pub async fn save_alias(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    code: &str,
    kind: &str,
    target: &str,
    item: Option<&str>,
    active: bool,
) -> Result<repo::BarcodeAliasRecord, AppError> {
    if !["product", "batch", "package", "location"].contains(&kind) {
        return Err(AppError::validation("invalid barcode alias type"));
    }
    let code = required_text(code, 160, "barcode alias")?;
    let target = required_text(target, 120, "alias target")?;
    if kind == "product" {
        let item =
            item.ok_or_else(|| AppError::validation("product alias requires inventoryItemId"))?;
        if crate::repositories::inventory_repository::get(&state.db, tenant, branch, item)
            .await
            .map_err(|_| AppError::internal("failed to validate product alias"))?
            .is_none()
        {
            return Err(AppError::not_found("inventory item was not found"));
        }
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to save barcode alias"))?;
    let row = repo::upsert_alias(
        &mut tx, tenant, branch, code, kind, target, item, active, actor,
    )
    .await
    .map_err(|_| AppError::conflict("barcode alias conflicts with an existing alias"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit barcode alias"))?;
    Ok(row)
}
pub async fn aliases(
    state: &AppState,
    tenant: &str,
    branch: &str,
) -> Result<Vec<repo::BarcodeAliasRecord>, AppError> {
    repo::list_aliases(&state.db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load barcode aliases"))
}

fn required_text<'a>(value: &'a str, max: usize, name: &str) -> Result<&'a str, AppError> {
    let value = text(value, max, name)?;
    if value.is_empty() {
        return Err(AppError::validation(format!("{name} is required")));
    }
    Ok(value)
}
fn text<'a>(value: &'a str, max: usize, name: &str) -> Result<&'a str, AppError> {
    let value = value.trim();
    if value.chars().count() > max {
        return Err(AppError::validation(format!("{name} is too long")));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    #[test]
    fn multiple_counter_average_rounds_half_up() {
        let values = [4_i32, 5, 5];
        assert_eq!(
            (values.iter().sum::<i32>() + values.len() as i32 / 2) / values.len() as i32,
            5
        );
    }
}
