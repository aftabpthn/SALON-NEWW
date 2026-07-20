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
    let inputs = repo::demand_inputs(&state.db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to aggregate reorder demand"))?;
    let evidence = json!({"itemsEvaluated":inputs.len(),"historyDays":30,"sources":["immutable stock ledger","service recipe sales consumption","backbar usage","open purchase orders","expiry batches"]});
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start reorder forecast"))?;
    let run = repo::create_run(&mut tx, tenant, branch, actor, &evidence)
        .await
        .map_err(|_| AppError::internal("failed to save reorder forecast"))?;
    for input in inputs {
        if let Some(row) = recommend(&input) {
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
            lines: vec![OrderLineInput {
                inventory_item_id: recommendation.inventory_item_id.clone(),
                quantity: recommendation.suggested_quantity,
                unit_cost_paise: recommendation.unit_cost_paise,
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
) -> Result<(), AppError> {
    if !(0..=365).contains(&lead) || moq <= 0 || pack <= 0 || !(0..=90).contains(&safety) {
        return Err(AppError::validation("invalid supplier reorder terms"));
    }
    repo::upsert_terms(
        &state.db, tenant, branch, supplier, item, lead, moq, pack, safety,
    )
    .await
    .map_err(|_| AppError::not_found("active supplier or inventory item was not found"))
}
fn recommend(input: &repo::DemandInput) -> Option<repo::RecommendationDraft> {
    if input.demand_30 <= 0 || input.expiring_quantity > 0 || input.inactive_days >= 90 {
        return None;
    }
    let daily = input.demand_30 as f64 / 30.0;
    let recent = input.demand_7 as f64 / 7.0;
    let seasonality = (recent / daily).clamp(0.5, 2.0);
    let safety = (daily * input.safety_stock_days as f64 * 1.25).ceil() as i64;
    let target =
        ((daily * (input.lead_time_days + 14) as f64 * seasonality).ceil() as i64) + safety;
    let gap = target - i64::from(input.stock_quantity) - input.pending_quantity;
    if gap <= 0 {
        return None;
    };
    let base = gap.max(i64::from(input.minimum_order_quantity));
    let pack = i64::from(input.pack_size);
    let suggested = ((base + pack - 1) / pack * pack).min(i64::from(i32::MAX)) as i32;
    let confidence = (5000
        + (input.demand_30.min(300) as i32 * 10)
        + (input.consumption_30.min(100) as i32 * 5))
        .min(9000);
    Some(repo::RecommendationDraft {
        inventory_item_id: input.inventory_item_id.clone(),
        supplier_id: input.supplier_id.clone(),
        suggested_quantity: suggested,
        unit_cost_paise: input.unit_cost_paise,
        confidence_bps: confidence,
        explanation: json!({"modelVersion":"seasonal-demand-v1","currentStock":input.stock_quantity,"reorderLevel":input.reorder_point,"dailyDemand30":daily,"dailyDemand7":recent,"seasonalityFactor":seasonality,"safetyStock":safety,"leadTimeDays":input.lead_time_days,"minimumOrderQuantity":input.minimum_order_quantity,"packSize":input.pack_size,"pendingPoQuantity":input.pending_quantity,"serviceAndBackbarConsumption30":input.consumption_30,"gstPercent":input.gst_percent,"formula":"ceil(max(targetStock-currentStock-pendingPO, MOQ)/packSize)*packSize"}),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn no_demand_or_expiry_never_reorders() {
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
            minimum_order_quantity: 1,
            pack_size: 1,
            safety_stock_days: 7,
            demand_30: 0,
            demand_7: 0,
            consumption_30: 0,
            pending_quantity: 0,
            expiring_quantity: 0,
            inactive_days: 0,
        };
        assert!(recommend(&row).is_none());
        row.demand_30 = 30;
        row.expiring_quantity = 1;
        assert!(recommend(&row).is_none());
    }
}
