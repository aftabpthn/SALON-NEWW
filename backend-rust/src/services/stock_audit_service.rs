use std::collections::{HashMap, HashSet};

use chrono::{DateTime, FixedOffset, NaiveDate, TimeZone, Utc};
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
    pub events: Vec<repo::SessionEventRecord>,
    pub value_summary: ValueSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueSummary {
    pub expected_value_paise: Option<i64>,
    pub counted_value_paise: Option<i64>,
    pub net_variance_value_paise: Option<i64>,
    pub absolute_variance_value_paise: Option<i64>,
    pub approval_threshold_paise: i64,
    pub owner_approval_required: Option<bool>,
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
    pub expected_unit_cost_paise: Option<i64>,
    pub expected_value_paise: Option<i64>,
    pub expected_source_ledger_id: Option<String>,
    pub expected_ledger_movement_count: Option<i64>,
    pub expected_provenance_status: Option<String>,
    pub expected_movement_summary: Option<Value>,
    pub audit_source: String,
    pub included_in_reconciliation: bool,
    pub approved_quantity: Option<i32>,
    pub variance_quantity: Option<i32>,
    pub counted_value_paise: Option<i64>,
    pub variance_value_paise: Option<i64>,
    pub variance_cause_suggestion: Option<String>,
    pub variance_reason: String,
    pub reconciliation_notes: String,
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
    business_date: NaiveDate,
    audit_scope: &str,
    product_scope: &str,
    unaudited_policy: &str,
    item_ids: Vec<String>,
    can_backdate: bool,
    can_use_zero: bool,
) -> Result<SessionDetails, AppError> {
    let name = required_text(name, 160, "audit name")?;
    if !(1..=5).contains(&counters)
        || threshold < 0
        || !matches!(audit_scope, "full" | "cycle")
        || !matches!(product_scope, "all" | "retail" | "consumable")
        || !matches!(
            unaudited_policy,
            "require_count"
                | "counted_only"
                | "projected_floor_zero"
                | "projected_preserve_negative"
                | "zero"
        )
        || (audit_scope == "full" && !item_ids.is_empty())
        || (audit_scope == "cycle" && (item_ids.is_empty() || item_ids.len() > 500))
        || item_ids.iter().collect::<HashSet<_>>().len() != item_ids.len()
    {
        return Err(AppError::validation("invalid counter or recount threshold"));
    }
    let policy =
        crate::services::inventory_governance_service::policy(&state.db, tenant, branch).await?;
    let variance_threshold_bps = policy
        .get("countVarianceThresholdBps")
        .and_then(Value::as_i64)
        .unwrap_or(500) as i32;
    let value_variance_threshold_paise = policy
        .get("countValueVarianceThresholdPaise")
        .and_then(Value::as_i64)
        .unwrap_or(10_000);
    let allow_zero = policy
        .get("allowZeroUnauditedAudit")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let today = Utc::now()
        .with_timezone(&FixedOffset::east_opt(19_800).expect("IST offset"))
        .date_naive();
    if business_date > today {
        return Err(AppError::validation("businessDate cannot be in the future"));
    }
    if business_date < today && !can_backdate {
        return Err(AppError::forbidden(
            "backdated stock audits require inventory approval permission",
        ));
    }
    if unaudited_policy == "zero" && (!allow_zero || !can_use_zero) {
        return Err(AppError::forbidden(
            "setting unaudited stock to zero is disabled or requires inventory approval permission",
        ));
    }
    let cutoff_at = if business_date == today {
        Utc::now()
    } else {
        FixedOffset::east_opt(19_800)
            .expect("IST offset")
            .from_local_datetime(
                &business_date
                    .and_hms_opt(23, 59, 59)
                    .expect("valid audit cutoff"),
            )
            .single()
            .expect("fixed offset has one local time")
            .with_timezone(&Utc)
    };
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start stock audit"))?;
    inventory_adjustment_service::enforce_inventory_business_date(
        &mut tx,
        tenant,
        branch,
        business_date,
    )
    .await?;
    if repo::lock_snapshot_inventory(&mut tx, tenant, branch, product_scope, &item_ids)
        .await
        .map_err(|_| AppError::internal("failed to lock inventory for stock audit"))?
        == 0
    {
        return Err(AppError::validation(
            "no active inventory items are available to count",
        ));
    }
    let overlap = repo::open_scope_overlap_count(&mut tx, tenant, branch, product_scope, &item_ids)
        .await
        .map_err(|_| AppError::internal("failed to check overlapping stock audits"))?;
    if overlap > 0 {
        return Err(AppError::conflict(format!(
            "{overlap} selected product(s) already belong to an open stock audit"
        )));
    }
    let mismatch_count =
        repo::ledger_stock_mismatch_count(&mut tx, tenant, branch, product_scope, &item_ids)
            .await
            .map_err(|_| AppError::internal("failed to verify inventory ledger integrity"))?;
    if mismatch_count > 0 {
        return Err(AppError::conflict(format!(
            "{mismatch_count} active inventory item(s) do not match the stock ledger; resolve Operations Health exceptions before starting an audit"
        )));
    }
    let id = repo::create_session(
        &mut tx,
        tenant,
        branch,
        name,
        business_date,
        cutoff_at,
        audit_scope,
        product_scope,
        unaudited_policy,
        blind,
        counters,
        threshold,
        variance_threshold_bps,
        value_variance_threshold_paise,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to create stock audit"))?;
    if repo::snapshot_items(&mut tx, tenant, branch, &id, product_scope, &item_ids)
        .await
        .map_err(|_| AppError::internal("failed to snapshot stock"))?
        == 0
    {
        return Err(AppError::validation(
            "no active inventory items are available to count",
        ));
    }
    repo::add_session_event(&mut tx,tenant,branch,&id,"created",actor,"Stock audit snapshot created",&json!({"auditScope":audit_scope,"productScope":product_scope,"businessDate":business_date,"unauditedPolicy":unaudited_policy}))
        .await.map_err(|_|AppError::internal("failed to write stock audit history"))?;
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
    let (session, items, counts, findings, events) = tokio::try_join!(
        repo::get_session(&state.db, tenant, branch, id),
        repo::session_items(&state.db, tenant, branch, id),
        repo::count_lines(&state.db, tenant, branch, id),
        repo::findings(&state.db, tenant, branch, id),
        repo::session_events(&state.db, tenant, branch, id)
    )
    .map_err(|_| AppError::internal("failed to load stock audit"))?;
    let session =
        session.ok_or_else(|| AppError::not_found("stock audit session was not found"))?;
    let hide_expected = session.blind_counting
        && matches!(session.status.as_str(), "counting" | "recount_required");
    let value_summary = value_summary(&session, &items, hide_expected)?;
    Ok(SessionDetails {
        session,
        counts,
        findings,
        events,
        items: items
            .into_iter()
            .map(|item| {
                let expected_value =
                    stock_value_paise(item.expected_quantity, item.expected_unit_cost_paise)?;
                let counted_value = item
                    .approved_quantity
                    .map(|quantity| stock_value_paise(quantity, item.expected_unit_cost_paise))
                    .transpose()?;
                let variance_value = item
                    .variance_quantity
                    .map(|quantity| stock_value_paise(quantity, item.expected_unit_cost_paise))
                    .transpose()?;
                let variance_cause_suggestion = suggested_variance_cause(
                    item.variance_quantity,
                    &item.expected_movement_summary,
                )
                .map(str::to_owned);
                Ok(SessionItemView {
                    id: item.id,
                    inventory_item_id: item.inventory_item_id,
                    item_name: item.item_name,
                    sku: item.sku,
                    unit: item.unit,
                    expected_quantity: (!hide_expected).then_some(item.expected_quantity),
                    expected_unit_cost_paise: (!hide_expected)
                        .then_some(item.expected_unit_cost_paise),
                    expected_value_paise: (!hide_expected).then_some(expected_value),
                    expected_source_ledger_id: if hide_expected {
                        None
                    } else {
                        item.expected_source_ledger_id.clone()
                    },
                    expected_ledger_movement_count: (!hide_expected)
                        .then_some(item.expected_ledger_movement_count),
                    expected_provenance_status: (!hide_expected)
                        .then(|| item.expected_provenance_status.clone()),
                    expected_movement_summary: (!hide_expected)
                        .then(|| item.expected_movement_summary.clone()),
                    audit_source: item.audit_source,
                    included_in_reconciliation: item.included_in_reconciliation,
                    approved_quantity: item.approved_quantity,
                    variance_quantity: item.variance_quantity,
                    counted_value_paise: counted_value,
                    variance_value_paise: variance_value,
                    variance_cause_suggestion,
                    variance_reason: item.variance_reason,
                    reconciliation_notes: item.reconciliation_notes,
                    adjustment_ledger_id: item.adjustment_ledger_id,
                    posted_at: item.posted_at,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?,
        value_summary,
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
    let round = session.current_round;
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
    let round = session.current_round;
    let mut grouped: HashMap<&str, Vec<i32>> = HashMap::new();
    for line in lines.iter().filter(|line| line.round_number == round) {
        grouped
            .entry(&line.session_item_id)
            .or_default()
            .push(line.counted_quantity);
    }
    let manual_counted = grouped.values().filter(|values| !values.is_empty()).count();
    for item in &items {
        let count = grouped.get(item.id.as_str()).map_or(0, Vec::len);
        if count > 0 && count < session.required_counters as usize {
            return Err(AppError::validation(
                "each manually audited product needs all required counter counts",
            ));
        }
        if count == 0 && session.unaudited_policy == "require_count" {
            return Err(AppError::validation(
                "every snapshot item needs all required counter counts",
            ));
        }
    }
    if manual_counted == 0 {
        return Err(AppError::validation(
            "count at least one product before submitting the audit",
        ));
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
        if !repo::advance_to_recount(&mut tx, tenant, branch, session_id, &session.status)
            .await
            .map_err(|_| AppError::internal("failed to require recount"))?
        {
            return Err(AppError::conflict("stock audit state changed"));
        }
        repo::add_session_event(
            &mut tx,
            tenant,
            branch,
            session_id,
            "recount_required",
            actor,
            "Counter quantities exceeded the recount threshold",
            &json!({"completedRound":round,"nextRound":round+1}),
        )
        .await
        .map_err(|_| AppError::internal("failed to write stock audit history"))?;
    } else {
        for item in &items {
            let values = grouped.get(item.id.as_str());
            let (counted, source, included) = match values.filter(|values| !values.is_empty()) {
                Some(values) => (
                    (values.iter().sum::<i32>() + values.len() as i32 / 2) / values.len() as i32,
                    "manual",
                    true,
                ),
                None => unaudited_result(&session.unaudited_policy, item.expected_quantity)?,
            };
            repo::set_review_results(
                &mut tx,
                tenant,
                branch,
                &item.id,
                counted,
                counted - item.expected_quantity,
                source,
                included,
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
        repo::add_session_event(&mut tx,tenant,branch,session_id,"counting_closed",actor,"Stock count submitted for reconciliation",&json!({"round":round,"manuallyAudited":manual_counted,"totalProducts":items.len(),"unauditedPolicy":session.unaudited_policy}))
            .await.map_err(|_|AppError::internal("failed to write stock audit history"))?;
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
    actor: &str,
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
    ensure_reconciler(state, tenant, branch, &session, actor, session_id).await?;
    let item = repo::session_item(&state.db, tenant, branch, session_id, session_item_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit item"))?
        .ok_or_else(|| AppError::not_found("stock audit item was not found"))?;
    let reason = required_text(reason, 500, "variance reason")?;
    let quantity = item
        .approved_quantity
        .ok_or_else(|| AppError::conflict("stock audit item has no reconciled quantity"))?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to save variance reason"))?;
    if !repo::set_reconciliation(
        &mut tx,
        tenant,
        branch,
        session_id,
        session_item_id,
        quantity,
        reason,
        reason,
    )
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

pub async fn import_counts(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    session_id: &str,
    device: &str,
    batch_key: &str,
    rows: Vec<(String, i32)>,
) -> Result<SessionDetails, AppError> {
    let device = text(device, 120, "deviceId")?;
    let batch_key = required_text(batch_key, 100, "idempotencyKey")?;
    if rows.is_empty()
        || rows.len() > 500
        || rows.iter().any(|(_, quantity)| *quantity < 0)
        || rows
            .iter()
            .map(|(item, _)| item)
            .collect::<HashSet<_>>()
            .len()
            != rows.len()
    {
        return Err(AppError::validation(
            "CSV import must contain 1 to 500 unique products with non-negative whole quantities",
        ));
    }
    let session = repo::get_session(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit"))?
        .ok_or_else(|| AppError::not_found("stock audit session was not found"))?;
    if !matches!(session.status.as_str(), "counting" | "recount_required") {
        return Err(AppError::conflict("stock audit is not accepting counts"));
    }
    let items = repo::session_items(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit items"))?;
    let item_map: HashMap<&str, &repo::SessionItemRecord> = items
        .iter()
        .map(|item| (item.inventory_item_id.as_str(), item))
        .collect();
    if rows
        .iter()
        .any(|(item, _)| !item_map.contains_key(item.as_str()))
    {
        return Err(AppError::validation(
            "CSV contains a product outside this audit snapshot",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to import stock counts"))?;
    let mut inserted = 0_usize;
    for (index, (inventory_item_id, quantity)) in rows.iter().enumerate() {
        let item = item_map[inventory_item_id.as_str()];
        let key = format!("{batch_key}:{index}");
        if let Some(existing) = repo::count_by_key(&mut tx, tenant, branch, &key)
            .await
            .map_err(|_| AppError::internal("failed to check CSV replay"))?
        {
            if existing.session_item_id != item.id
                || existing.counter_user_id != actor
                || existing.counted_quantity != *quantity
            {
                return Err(AppError::conflict(
                    "CSV idempotencyKey is already used by different count data",
                ));
            }
            continue;
        }
        repo::insert_count(
            &mut tx,
            tenant,
            branch,
            &item.id,
            actor,
            session.current_round,
            *quantity,
            device,
            &key,
        )
        .await
        .map_err(|_| {
            AppError::conflict(
                "this counter already submitted one of the imported products for the current round",
            )
        })?;
        inserted += 1;
    }
    if inserted > 0 {
        repo::add_session_event(
            &mut tx,
            tenant,
            branch,
            session_id,
            "csv_imported",
            actor,
            "CSV stock counts imported",
            &json!({"batchKey":batch_key,"rows":rows.len()}),
        )
        .await
        .map_err(|_| AppError::internal("failed to write stock audit history"))?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit CSV stock counts"))?;
    details(state, tenant, branch, session_id).await
}

pub async fn save_reconciliation(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    session_id: &str,
    item_id: &str,
    quantity: i32,
    reason: &str,
    notes: &str,
) -> Result<SessionDetails, AppError> {
    if quantity < 0 {
        return Err(AppError::validation(
            "reconciled physical quantity cannot be negative",
        ));
    }
    let session = repo::get_session(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit"))?
        .ok_or_else(|| AppError::not_found("stock audit session was not found"))?;
    if session.status != "review" {
        return Err(AppError::conflict(
            "stock audit is not open for reconciliation",
        ));
    }
    ensure_reconciler(state, tenant, branch, &session, actor, session_id).await?;
    let item = repo::session_item(&state.db, tenant, branch, session_id, item_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit item"))?
        .ok_or_else(|| AppError::not_found("stock audit item was not found"))?;
    if !item.included_in_reconciliation {
        return Err(AppError::conflict("excluded products cannot be reconciled"));
    }
    let variance = quantity - item.expected_quantity;
    let reason = if variance == 0 {
        text(reason, 500, "variance reason")?
    } else {
        required_text(reason, 500, "variance reason")?
    };
    let notes = if variance == 0 {
        text(notes, 1000, "reconciliation notes")?
    } else {
        required_text(notes, 1000, "reconciliation notes")?
    };
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to save reconciliation"))?;
    if !repo::set_reconciliation(
        &mut tx, tenant, branch, session_id, item_id, quantity, reason, notes,
    )
    .await
    .map_err(|_| AppError::internal("failed to save reconciliation"))?
    {
        return Err(AppError::not_found("stock audit item was not found"));
    }
    repo::add_session_event(&mut tx,tenant,branch,session_id,"reconciliation_saved",actor,notes,&json!({"inventoryItemId":item_id,"reconciledQuantity":quantity,"varianceQuantity":variance,"reason":reason}))
        .await.map_err(|_|AppError::internal("failed to write stock audit history"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit reconciliation"))?;
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
    ensure_reconciler(state, tenant, branch, &session, actor, session_id).await?;
    let items = repo::session_items(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit items"))?;
    if items.iter().any(|item| {
        item.included_in_reconciliation
            && item.variance_quantity.unwrap_or_default() != 0
            && (item.variance_reason.trim().is_empty()
                || item.reconciliation_notes.trim().is_empty())
    }) {
        return Err(AppError::validation(
            "each stock variance needs a reason and reconciliation notes",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to submit stock audit"))?;
    if !repo::attach_floor_closing(
        &mut tx,
        tenant,
        branch,
        session_id,
        session.business_date,
        &session.product_scope,
    )
    .await
    .map_err(|_| AppError::internal("failed to validate open-container closing"))?
    {
        return Err(AppError::validation("approve the open-container physical closing for this business date before submitting the unopened-stock audit"));
    }
    repo::snapshot_reconciliation_state(&mut tx, tenant, branch, session_id, actor)
        .await
        .map_err(|_| AppError::internal("failed to lock reconciliation snapshot"))?;
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
    repo::add_session_event(&mut tx,tenant,branch,session_id,"submitted",actor,"Reconciliation submitted for approval",&json!({"includedProducts":items.iter().filter(|item|item.included_in_reconciliation).count()}))
        .await.map_err(|_|AppError::internal("failed to write stock audit history"))?;
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
    let exceeds_threshold = owner_approval_required(
        &items,
        session.count_variance_threshold_bps,
        session.count_value_variance_threshold_paise,
    )?;
    if exceeds_threshold && !matches!(actor_role, "owner" | "admin") {
        return Err(AppError::forbidden(
            "owner approval is required above the configured quantity or value variance threshold",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to approve stock audit"))?;
    inventory_adjustment_service::enforce_inventory_business_date(
        &mut tx,
        tenant,
        branch,
        session.business_date,
    )
    .await?;
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
        if !item.included_in_reconciliation {
            repo::mark_posted(&mut tx, tenant, branch, &item.id, None)
                .await
                .map_err(|_| AppError::internal("failed to mark excluded audit item"))?;
            continue;
        }
        let delta = item.variance_quantity.unwrap_or_default();
        let locked = repo::lock_inventory(&mut tx, tenant, branch, &item.inventory_item_id)
            .await
            .map_err(|_| AppError::internal("failed to lock inventory item"))?
            .ok_or_else(|| AppError::not_found("inventory item was not found"))?;
        let latest_ledger =
            repo::latest_ledger_id(&mut tx, tenant, branch, &item.inventory_item_id)
                .await
                .map_err(|_| AppError::internal("failed to verify reconciliation snapshot"))?;
        if item.reconciled_stock_quantity != Some(locked.stock_quantity)
            || item.reconciled_source_ledger_id != latest_ledger
        {
            return Err(AppError::conflict(
                "stock changed after reconciliation; reject and resubmit the audit before approval",
            ));
        }
        if delta == 0 {
            repo::mark_posted(&mut tx, tenant, branch, &item.id, None)
                .await
                .map_err(|_| AppError::internal("failed to mark stock audit item"))?;
            continue;
        }
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
            let business_date = session.business_date;
            let adjustment_request_id = inventory_repository::create_adjustment_request(
                &mut tx,
                tenant,
                branch,
                &item.inventory_item_id,
                business_date,
                "audit_reconciliation",
                "pending_approval",
                locked.stock_quantity,
                target,
                delta,
                locked.unit_cost_paise,
                i64::from(delta.saturating_abs()).saturating_mul(locked.unit_cost_paise),
                exceeds_threshold,
                &item.variance_reason,
                &format!("stock-audit:{session_id}:{}", item.id),
                actor,
                &key,
            )
            .await
            .map_err(|_| AppError::internal("failed to create audit reconciliation adjustment"))?;
            inventory_repository::add_adjustment_event(
                &mut tx,
                tenant,
                branch,
                &adjustment_request_id,
                "requested",
                actor,
                "Approved stock audit reconciliation",
            )
            .await
            .map_err(|_| AppError::internal("failed to write audit adjustment history"))?;
            inventory_repository::apply_adjusted_stock(
                &mut tx,
                tenant,
                branch,
                &item.inventory_item_id,
                target,
            )
            .await
            .map_err(|_| AppError::internal("failed to apply stock audit adjustment"))?;
            let unit_cost_paise = if delta < 0 {
                inventory_adjustment_service::outbound_unit_cost(
                    &mut tx,
                    tenant,
                    branch,
                    &item.inventory_item_id,
                    locked.batch_tracked,
                    locked.unit_cost_paise,
                    delta.saturating_abs(),
                )
                .await?
            } else {
                locked.unit_cost_paise
            };
            let ledger = inventory_repository::add_adjustment_ledger(
                &mut tx,
                tenant,
                branch,
                &item.inventory_item_id,
                delta,
                unit_cost_paise,
                target,
                &item.variance_reason,
                "audit_reconciliation",
                &format!("stock-audit:{session_id}"),
                Some(business_date),
                Some(&adjustment_request_id),
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
            accounting_service::post_inventory_adjustment(
                &mut tx,
                tenant,
                branch,
                "stock_count_adjustment",
                &item.id,
                business_date,
                actor,
                delta,
                unit_cost_paise,
                &item.variance_reason,
            )
            .await?;
            inventory_repository::finish_adjustment_request(
                &mut tx,
                tenant,
                branch,
                &adjustment_request_id,
                "pending_approval",
                "applied",
                Some(actor),
                "Approved through stock audit",
                Some(&ledger),
                Some(&format!("stock-audit-review:{session_id}:{}", item.id)),
            )
            .await
            .map_err(|_| AppError::internal("failed to finish audit adjustment history"))?;
            inventory_repository::add_adjustment_event(
                &mut tx,
                tenant,
                branch,
                &adjustment_request_id,
                "applied",
                actor,
                "Stock audit variance posted",
            )
            .await
            .map_err(|_| AppError::internal("failed to finish audit adjustment history"))?;
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
    repo::add_session_event(
        &mut tx,
        tenant,
        branch,
        session_id,
        "approved",
        actor,
        "Stock reconciliation approved",
        &json!({"thresholdExceeded":exceeds_threshold}),
    )
    .await
    .map_err(|_| AppError::internal("failed to write stock audit history"))?;
    repo::add_session_event(
        &mut tx,
        tenant,
        branch,
        session_id,
        "posted",
        actor,
        "Immutable inventory and GL adjustments posted",
        &json!({"businessDate":session.business_date}),
    )
    .await
    .map_err(|_| AppError::internal("failed to write stock audit history"))?;
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
    let session = repo::get_session(&state.db, tenant, branch, session_id)
        .await
        .map_err(|_| AppError::internal("failed to load stock audit"))?
        .ok_or_else(|| AppError::not_found("stock audit session was not found"))?;
    if session.created_by == actor
        || session.submitted_by.as_deref() == Some(actor)
        || repo::counters_for_session(&state.db, tenant, branch, session_id, actor)
            .await
            .map_err(|_| AppError::internal("failed to enforce approval separation"))?
    {
        return Err(AppError::forbidden(
            "an auditor or reconciler cannot reject this stock audit",
        ));
    }
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
    repo::add_session_event(
        &mut tx,
        tenant,
        branch,
        session_id,
        "rejected",
        actor,
        reason,
        &json!({}),
    )
    .await
    .map_err(|_| AppError::internal("failed to write stock audit history"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit stock audit rejection"))?;
    details(state, tenant, branch, session_id).await
}

pub async fn resubmit(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    session_id: &str,
) -> Result<SessionDetails, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to resubmit stock audit"))?;
    if !repo::resubmit_rejected(&mut tx, tenant, branch, session_id, actor)
        .await
        .map_err(|_| AppError::internal("failed to resubmit stock audit"))?
    {
        return Err(AppError::conflict("only the original auditor can resubmit a rejected audit with an available recount round"));
    }
    repo::add_session_event(
        &mut tx,
        tenant,
        branch,
        session_id,
        "resubmitted",
        actor,
        "Rejected audit reopened for recount",
        &json!({}),
    )
    .await
    .map_err(|_| AppError::internal("failed to write stock audit history"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit stock audit resubmission"))?;
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
    if session.status != "review" {
        return Err(AppError::conflict("findings can be recorded during review"));
    }
    ensure_reconciler(state, tenant, branch, &session, actor, session_id).await?;
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
    if !["lookup", "receive", "count", "waste", "transfer", "kit"].contains(&workflow) {
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

async fn ensure_reconciler(
    state: &AppState,
    tenant: &str,
    branch: &str,
    session: &repo::SessionRecord,
    actor: &str,
    session_id: &str,
) -> Result<(), AppError> {
    if session.created_by == actor
        || repo::counters_for_session(&state.db, tenant, branch, session_id, actor)
            .await
            .map_err(|_| AppError::internal("failed to enforce reconciler separation"))?
    {
        return Err(AppError::forbidden(
            "an auditor or counter cannot reconcile the same stock audit",
        ));
    }
    Ok(())
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

fn stock_value_paise(quantity: i32, unit_cost_paise: i64) -> Result<i64, AppError> {
    i64::from(quantity)
        .checked_mul(unit_cost_paise)
        .ok_or_else(|| AppError::internal("stock audit value exceeds supported range"))
}

fn unaudited_result(policy: &str, expected: i32) -> Result<(i32, &'static str, bool), AppError> {
    match policy {
        "counted_only" => Ok((expected, "excluded", false)),
        "projected_floor_zero" => Ok((expected.max(0), "projected", true)),
        "projected_preserve_negative" | "require_count" => Ok((expected, "projected", true)),
        "zero" => Ok((0, "zero", true)),
        _ => Err(AppError::validation("invalid unaudited product policy")),
    }
}

fn suggested_variance_cause(
    variance: Option<i32>,
    movement_summary: &Value,
) -> Option<&'static str> {
    match variance.unwrap_or_default() {
        value if value > 0 => Some("possible_missing_inbound"),
        value if value < 0 => {
            let sale = movement_summary
                .get("saleQuantity")
                .and_then(Value::as_i64)
                .unwrap_or_default();
            let consumption = movement_summary
                .get("consumptionQuantity")
                .and_then(Value::as_i64)
                .unwrap_or_default();
            if consumption < 0 && sale == 0 {
                Some("possible_unrecorded_consumption")
            } else if sale < 0 && consumption == 0 {
                Some("possible_missing_sale_or_checkout")
            } else {
                Some("unaccounted")
            }
        }
        _ => None,
    }
}

fn variance_value_totals(
    items: &[repo::SessionItemRecord],
) -> Result<Option<(i64, i64)>, AppError> {
    if items
        .iter()
        .any(|item| item.included_in_reconciliation && item.variance_quantity.is_none())
    {
        return Ok(None);
    }
    items
        .iter()
        .filter(|item| item.included_in_reconciliation)
        .try_fold(Some((0_i64, 0_i64)), |totals, item| {
            let (net, absolute) = totals.unwrap_or_default();
            let value = stock_value_paise(
                item.variance_quantity.unwrap_or_default(),
                item.expected_unit_cost_paise,
            )?;
            let net = net.checked_add(value).ok_or_else(|| {
                AppError::internal("stock audit net variance exceeds supported range")
            })?;
            let absolute = absolute.checked_add(value.abs()).ok_or_else(|| {
                AppError::internal("stock audit exposure exceeds supported range")
            })?;
            Ok(Some((net, absolute)))
        })
}

fn owner_approval_required(
    items: &[repo::SessionItemRecord],
    quantity_threshold_bps: i32,
    value_threshold_paise: i64,
) -> Result<bool, AppError> {
    let quantity_exceeded = items
        .iter()
        .filter(|item| item.included_in_reconciliation)
        .any(|item| {
            let variance = i64::from(item.variance_quantity.unwrap_or_default()).abs();
            let expected = i64::from(item.expected_quantity).abs();
            variance > 0
                && (expected == 0
                    || variance.saturating_mul(10_000) / expected.max(1)
                        > i64::from(quantity_threshold_bps))
        });
    let value_exceeded = variance_value_totals(items)?
        .is_some_and(|(_, absolute)| absolute > 0 && absolute >= value_threshold_paise);
    Ok(quantity_exceeded || value_exceeded)
}

fn value_summary(
    session: &repo::SessionRecord,
    items: &[repo::SessionItemRecord],
    hide_expected: bool,
) -> Result<ValueSummary, AppError> {
    let expected = items
        .iter()
        .filter(|item| item.included_in_reconciliation)
        .try_fold(0_i64, |total, item| {
            total
                .checked_add(stock_value_paise(
                    item.expected_quantity,
                    item.expected_unit_cost_paise,
                )?)
                .ok_or_else(|| {
                    AppError::internal("stock audit expected value exceeds supported range")
                })
        })?;
    let counted = if items
        .iter()
        .filter(|item| item.included_in_reconciliation)
        .all(|item| item.approved_quantity.is_some())
    {
        Some(
            items
                .iter()
                .filter(|item| item.included_in_reconciliation)
                .try_fold(0_i64, |total, item| {
                    total
                        .checked_add(stock_value_paise(
                            item.approved_quantity.unwrap_or_default(),
                            item.expected_unit_cost_paise,
                        )?)
                        .ok_or_else(|| {
                            AppError::internal("stock audit counted value exceeds supported range")
                        })
                })?,
        )
    } else {
        None
    };
    let variance = variance_value_totals(items)?;
    Ok(ValueSummary {
        expected_value_paise: (!hide_expected).then_some(expected),
        counted_value_paise: counted,
        net_variance_value_paise: variance.map(|value| value.0),
        absolute_variance_value_paise: variance.map(|value| value.1),
        approval_threshold_paise: session.count_value_variance_threshold_paise,
        owner_approval_required: variance
            .map(|_| {
                owner_approval_required(
                    items,
                    session.count_variance_threshold_bps,
                    session.count_value_variance_threshold_paise,
                )
            })
            .transpose()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiple_counter_average_rounds_half_up() {
        let values = [4_i32, 5, 5];
        assert_eq!(
            (values.iter().sum::<i32>() + values.len() as i32 / 2) / values.len() as i32,
            5
        );
    }

    #[test]
    fn value_threshold_counts_gains_and_losses_without_netting_risk() {
        assert_eq!(stock_value_paise(-2, 5_000).unwrap(), -10_000);
        let values = [10_000_i64, -10_000];
        let net = values.iter().sum::<i64>();
        let absolute = values.iter().map(|value| value.abs()).sum::<i64>();
        assert_eq!(net, 0);
        assert_eq!(absolute, 20_000);
        assert!(absolute >= 15_000);
    }

    #[test]
    fn variance_cause_is_neutral_and_uses_snapshot_movement_context() {
        assert_eq!(
            suggested_variance_cause(Some(2), &json!({})),
            Some("possible_missing_inbound")
        );
        assert_eq!(
            suggested_variance_cause(Some(-1), &json!({"consumptionQuantity": -4})),
            Some("possible_unrecorded_consumption")
        );
        assert_eq!(
            suggested_variance_cause(Some(-1), &json!({"saleQuantity": -4})),
            Some("possible_missing_sale_or_checkout")
        );
        assert_eq!(
            suggested_variance_cause(
                Some(-1),
                &json!({"saleQuantity": -2, "consumptionQuantity": -2})
            ),
            Some("unaccounted")
        );
    }

    #[test]
    fn unaudited_policies_handle_negative_projection_without_unsafe_guessing() {
        assert_eq!(
            unaudited_result("projected_floor_zero", -3).unwrap(),
            (0, "projected", true)
        );
        assert_eq!(
            unaudited_result("projected_preserve_negative", -3).unwrap(),
            (-3, "projected", true)
        );
        assert_eq!(
            unaudited_result("counted_only", 7).unwrap(),
            (7, "excluded", false)
        );
        assert_eq!(unaudited_result("zero", 7).unwrap(), (0, "zero", true));
    }
}
