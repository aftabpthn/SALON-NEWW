use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::services_repository::{self, ServicePricingSource},
    services::service_settings_service,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServicePriceQuote {
    pub service_id: String,
    pub starts_at: DateTime<Utc>,
    pub base_price_paise: i64,
    pub staff_price_paise: Option<i64>,
    pub pricing_level_id: Option<String>,
    pub pricing_level_name: Option<String>,
    pub pricing_level_price_paise: Option<i64>,
    pub variant_id: Option<String>,
    pub variant_adjustment_paise: i64,
    pub addon_total_paise: i64,
    pub price_rule_id: Option<String>,
    pub price_rule_name: Option<String>,
    pub dynamic_adjustment_bps: i32,
    pub dynamic_adjustment_paise: i64,
    pub final_price_paise: i64,
    pub duration_minutes: i64,
}

pub async fn quote(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    staff_id: &str,
    variant_id: &str,
    addon_ids: &[String],
    starts_at: DateTime<Utc>,
) -> Result<ServicePriceQuote, AppError> {
    if !addon_ids.is_empty() {
        let settings = service_settings_service::settings(db, tenant_id, branch_id).await?;
        if !service_settings_service::addons_enabled(&settings) {
            return Err(AppError::validation("service add-ons are disabled"));
        }
    }
    let source = services_repository::pricing_source(
        db, tenant_id, branch_id, service_id, staff_id, variant_id, addon_ids, starts_at,
    )
    .await
    .map_err(|_| AppError::internal("failed to resolve service price"))?
    .ok_or_else(|| AppError::not_found("service was not found"))?;

    if !variant_id.is_empty() && source.variant_id.is_none() {
        return Err(AppError::validation(
            "variantId is invalid for this service",
        ));
    }
    if source.selected_addon_count != addon_ids.len() as i64 {
        return Err(AppError::validation(
            "addonIds are invalid for this service",
        ));
    }

    Ok(calculate_quote(source, starts_at))
}

fn calculate_quote(source: ServicePricingSource, starts_at: DateTime<Utc>) -> ServicePriceQuote {
    let effective_base = source
        .staff_price_paise
        .or(source.pricing_level_price_paise)
        .unwrap_or(source.base_price_paise);
    let variant_subtotal = effective_base
        .saturating_add(source.variant_price_delta_paise)
        .max(0);
    let dynamic_adjustment_paise = adjustment_amount(variant_subtotal, source.adjustment_bps);
    let final_price_paise = variant_subtotal
        .saturating_add(dynamic_adjustment_paise)
        .saturating_add(source.addon_price_paise)
        .max(0);
    let duration_minutes = i64::from(source.base_duration_minutes)
        .saturating_add(i64::from(source.variant_duration_delta_minutes))
        .saturating_add(source.addon_duration_minutes)
        .max(0);

    ServicePriceQuote {
        service_id: source.service_id,
        starts_at,
        base_price_paise: source.base_price_paise,
        staff_price_paise: source.staff_price_paise,
        pricing_level_id: source.pricing_level_id,
        pricing_level_name: source.pricing_level_name,
        pricing_level_price_paise: source.pricing_level_price_paise,
        variant_id: source.variant_id,
        variant_adjustment_paise: source.variant_price_delta_paise,
        addon_total_paise: source.addon_price_paise,
        price_rule_id: source.rule_id,
        price_rule_name: source.rule_name,
        dynamic_adjustment_bps: source.adjustment_bps,
        dynamic_adjustment_paise,
        final_price_paise,
        duration_minutes,
    }
}

fn adjustment_amount(amount_paise: i64, adjustment_bps: i32) -> i64 {
    let product = i128::from(amount_paise) * i128::from(adjustment_bps);
    let rounded = if product >= 0 {
        (product + 5_000) / 10_000
    } else {
        (product - 5_000) / 10_000
    };
    rounded.clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quote_layers_staff_variant_schedule_and_addons() {
        let quote = calculate_quote(
            ServicePricingSource {
                service_id: "service-1".into(),
                base_price_paise: 100_00,
                base_duration_minutes: 45,
                staff_price_paise: Some(120_00),
                pricing_level_id: Some("level-1".into()),
                pricing_level_name: Some("Senior Stylist".into()),
                pricing_level_price_paise: Some(130_00),
                variant_id: Some("variant-1".into()),
                variant_price_delta_paise: 20_00,
                variant_duration_delta_minutes: 15,
                addon_price_paise: 30_00,
                addon_duration_minutes: 10,
                selected_addon_count: 1,
                rule_id: Some("rule-1".into()),
                rule_name: Some("Peak".into()),
                adjustment_bps: 1_000,
            },
            Utc::now(),
        );

        assert_eq!(quote.dynamic_adjustment_paise, 14_00);
        assert_eq!(quote.final_price_paise, 184_00);
        assert_eq!(quote.duration_minutes, 70);
    }
}
