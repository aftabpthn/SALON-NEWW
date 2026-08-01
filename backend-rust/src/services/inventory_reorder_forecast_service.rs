use crate::{
    models::common::AppError,
    repositories::inventory_reorder_forecast_repository as repo,
    services::purchase_service::{self, OrderInput, OrderLineInput},
    state::AppState,
};
use chrono::{Duration, Utc};
use serde::Serialize;
use serde_json::json;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastDetail {
    pub run: repo::ForecastRun,
    pub recommendations: Vec<repo::Recommendation>,
}

pub async fn run(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
) -> Result<ForecastDetail, AppError> {
    let config = repo::forecast_config(&state.db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load reorder forecast configuration"))?;
    let inputs = repo::demand_inputs(&state.db, tenant, branch, config.history_days)
        .await
        .map_err(|_| AppError::internal("failed to aggregate reorder demand"))?;
    let evidence = json!({"itemsEvaluated":inputs.len(),"historyDays":config.history_days,"coverageDays":config.coverage_days,"sources":["immutable stock ledger","service recipe sales consumption","backbar usage","open purchase orders","expiry batches","supplier delivery, fill, return and expiry evidence"]});
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start reorder forecast"))?;
    let run = repo::create_run(
        &mut tx,
        tenant,
        branch,
        actor,
        config.history_days,
        &evidence,
    )
    .await
    .map_err(|_| AppError::internal("failed to save reorder forecast"))?;
    for input in inputs {
        if let Some(row) = recommend(&input, config.history_days, config.coverage_days) {
            repo::insert_recommendation(&mut tx, tenant, branch, &run, &row)
                .await
                .map_err(|_| AppError::internal("failed to save reorder recommendation"))?;
        }
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit reorder forecast"))?;
    detail(state, tenant, branch, &run).await
}
pub async fn latest(
    state: &AppState,
    tenant: &str,
    branch: &str,
) -> Result<Option<ForecastDetail>, AppError> {
    match repo::latest_run(&state.db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load reorder forecast"))?
    {
        Some(run) => Ok(Some(ForecastDetail {
            recommendations: repo::recommendations(&state.db, tenant, branch, &run.id)
                .await
                .map_err(|_| AppError::internal("failed to load reorder recommendations"))?,
            run,
        })),
        None => Ok(None),
    }
}
pub async fn detail(
    state: &AppState,
    tenant: &str,
    branch: &str,
    run: &str,
) -> Result<ForecastDetail, AppError> {
    let current = repo::run_by_id(&state.db, tenant, branch, run)
        .await
        .map_err(|_| AppError::internal("failed to load reorder forecast"))?
        .ok_or_else(|| AppError::not_found("reorder forecast run was not found"))?;
    Ok(ForecastDetail {
        recommendations: repo::recommendations(&state.db, tenant, branch, run)
            .await
            .map_err(|_| AppError::internal("failed to load reorder recommendations"))?,
        run: current,
    })
}
pub async fn approve_to_po(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<purchase_service::OrderDetails, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to approve reorder recommendation"))?;
    let recommendation = repo::begin_conversion(&mut tx, tenant, branch, id, actor)
        .await
        .map_err(|_| AppError::internal("failed to lock reorder recommendation"))?
        .ok_or_else(|| {
            AppError::conflict("recommendation is already approved, converted, or unavailable")
        })?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to approve reorder recommendation"))?;
    let expected = (Utc::now().date_naive()
        + Duration::days(i64::from(
            recommendation.explanation["leadTimeDays"]
                .as_i64()
                .unwrap_or(0),
        )))
    .to_string();
    let gst = recommendation.explanation["gstPercent"]
        .as_i64()
        .unwrap_or(0)
        .clamp(0, 100) as i32;
    let order = purchase_service::create_order(
        state,
        tenant,
        branch,
        actor,
        OrderInput {
            supplier_id: recommendation.supplier_id.clone(),
            expected_date: Some(expected),
            notes: format!(
                "AI reorder forecast {} recommendation {}",
                recommendation.forecast_run_id, recommendation.id
            ),
            shipping_paise: 0,
            handling_paise: 0,
            lines: vec![OrderLineInput {
                inventory_item_id: recommendation.inventory_item_id.clone(),
                quantity: recommendation.suggested_quantity,
                retail_quantity: 0,
                consumable_quantity: 0,
                unit_cost_paise: recommendation.unit_cost_paise,
                discount_bps: 0,
                gst_percent: gst,
            }],
        },
    )
    .await?;
    if !repo::finish_conversion(&state.db, tenant, branch, id, &order.order.id)
        .await
        .map_err(|_| AppError::internal("failed to link reorder recommendation"))?
    {
        return Err(AppError::conflict(
            "purchase order was created but recommendation linkage needs review",
        ));
    }
    Ok(order)
}
pub async fn save_terms(
    state: &AppState,
    tenant: &str,
    branch: &str,
    supplier: &str,
    item: &str,
    lead: i32,
    moq: i32,
    pack: i32,
    safety: i32,
    vendor_part_number: &str,
    purchase_unit: &str,
    conversion_quantity: i32,
    center_available: bool,
) -> Result<(), AppError> {
    if !(0..=365).contains(&lead)
        || moq <= 0
        || pack <= 0
        || !(0..=90).contains(&safety)
        || vendor_part_number.chars().count() > 120
        || !matches!(
            purchase_unit,
            "box" | "jar" | "tube" | "pouch" | "pack" | "bottle" | "kit" | "pcs"
        )
        || conversion_quantity <= 0
    {
        return Err(AppError::validation("invalid supplier reorder terms"));
    }
    repo::upsert_terms(
        &state.db,
        tenant,
        branch,
        supplier,
        item,
        lead,
        moq,
        pack,
        safety,
        vendor_part_number.trim(),
        purchase_unit,
        conversion_quantity,
        center_available,
    )
    .await
    .map_err(|_| AppError::not_found("active supplier or inventory item was not found"))
}
fn recommend(
    input: &repo::DemandInput,
    history_days: i32,
    coverage_days: i32,
) -> Option<repo::RecommendationDraft> {
    let has_demand = input.demand_history > 0;
    if input.expiring_quantity > 0 || (has_demand && input.inactive_days >= 90) {
        return None;
    }
    let daily = if has_demand {
        input.demand_history as f64 / f64::from(history_days)
    } else {
        0.0
    };
    let recent = input.demand_7 as f64 / 7.0;
    let seasonality = if has_demand {
        (recent / daily).clamp(0.5, 2.0)
    } else {
        1.0
    };
    let safety = if has_demand {
        (daily * input.safety_stock_days as f64 * 1.25).ceil() as i64
    } else {
        0
    };
    let target = if has_demand {
        ((daily * (input.lead_time_days + coverage_days) as f64 * seasonality).ceil() as i64)
            + safety
    } else {
        i64::from(input.reorder_point)
    };
    let gap = target - i64::from(input.stock_quantity) - input.pending_quantity;
    if gap <= 0 {
        return None;
    };
    let base = gap.max(i64::from(input.minimum_order_quantity));
    let pack = i64::from(input.pack_size);
    let suggested = ((base + pack - 1) / pack * pack).min(i64::from(i32::MAX)) as i32;
    let confidence = if has_demand {
        (5000
            + (input.demand_history.min(i64::from(history_days) * 10) as i32 * 5)
            + (input.consumption_history.min(200) as i32 * 5))
            .min(9000)
    } else {
        4000
    };
    Some(repo::RecommendationDraft {
        inventory_item_id: input.inventory_item_id.clone(),
        supplier_id: input.supplier_id.clone(),
        suggested_quantity: suggested,
        unit_cost_paise: input.unit_cost_paise,
        confidence_bps: confidence,
        explanation: json!({"modelVersion":"seasonal-demand-v3","forecastBasis":if has_demand { "demand_history" } else { "reorder_level" },"historyDays":history_days,"coverageDays":coverage_days,"currentStock":input.stock_quantity,"reorderLevel":input.reorder_point,"dailyDemandHistory":daily,"dailyDemand7":recent,"seasonalityFactor":seasonality,"safetyStock":safety,"leadTimeDays":input.lead_time_days,"minimumOrderQuantity":input.minimum_order_quantity,"packSize":input.pack_size,"pendingPoQuantity":input.pending_quantity,"serviceAndBackbarConsumption":input.consumption_history,"gstPercent":input.gst_percent,"supplierScoreBps":input.supplier_score_bps,"onTimeRateBps":input.on_time_rate_bps,"fillRateBps":input.fill_rate_bps,"returnRateBps":input.return_rate_bps,"expiryRiskBps":input.expiry_risk_bps,"supplierSelection":"highest evidence-backed delivery, fill, return and expiry score; then lowest effective price and shortest lead time","formula":if has_demand { "ceil(max((daily demand * (lead + coverage) * seasonality + safety)-current stock-pending PO, MOQ)/pack size)*pack size" } else { "ceil(max(reorder level-current stock-pending PO, MOQ)/pack size)*pack size" }}),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reorder_level_covers_missing_history_but_expiry_blocks() {
        let mut row = repo::DemandInput {
            inventory_item_id: "i".into(),
            product_name: "i".into(),
            sku: "".into(),
            stock_quantity: 0,
            reorder_point: 0,
            unit_cost_paise: 1,
            gst_percent: 0,
            supplier_id: "s".into(),
            lead_time_days: 2,
            supplier_score_bps: None,
            on_time_rate_bps: None,
            fill_rate_bps: None,
            return_rate_bps: None,
            expiry_risk_bps: None,
            minimum_order_quantity: 1,
            pack_size: 1,
            safety_stock_days: 7,
            demand_history: 0,
            demand_7: 0,
            consumption_history: 0,
            pending_quantity: 0,
            expiring_quantity: 0,
            inactive_days: 0,
        };
        row.reorder_point = 3;
        assert_eq!(
            recommend(&row, 60, 30)
                .expect("reorder-level fallback")
                .suggested_quantity,
            3
        );
        row.expiring_quantity = 1;
        assert!(recommend(&row, 60, 30).is_none());
    }

    #[test]
    fn configurable_coverage_changes_reorder_quantity() {
        let row = repo::DemandInput {
            inventory_item_id: "i".into(),
            product_name: "i".into(),
            sku: "".into(),
            stock_quantity: 0,
            reorder_point: 0,
            unit_cost_paise: 100,
            gst_percent: 18,
            supplier_id: "s".into(),
            lead_time_days: 5,
            supplier_score_bps: Some(9000),
            on_time_rate_bps: Some(9000),
            fill_rate_bps: Some(9500),
            return_rate_bps: Some(100),
            expiry_risk_bps: Some(200),
            minimum_order_quantity: 1,
            pack_size: 1,
            safety_stock_days: 0,
            demand_history: 60,
            demand_7: 7,
            consumption_history: 60,
            pending_quantity: 0,
            expiring_quantity: 0,
            inactive_days: 0,
        };
        let short = recommend(&row, 60, 7).expect("short coverage recommendation");
        let long = recommend(&row, 60, 30).expect("long coverage recommendation");
        assert!(long.suggested_quantity > short.suggested_quantity);
    }
}
