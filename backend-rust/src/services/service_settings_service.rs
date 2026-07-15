use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{models::common::AppError, repositories::services_repository};

pub struct ServiceRuleCandidate<'a> {
    pub name: &'a str,
    pub category: &'a str,
    pub duration_minutes: i32,
    pub price_paise: i64,
    pub staff_count: usize,
    pub addon_count: usize,
    pub has_recipe: bool,
}

pub async fn settings(db: &PgPool, tenant_id: &str, branch_id: &str) -> Result<Value, AppError> {
    let saved = services_repository::get_settings(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load service settings"))?
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| json!({}));
    Ok(merge_known_settings(&default_settings(), &saved))
}

pub async fn save_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: Value,
) -> Result<Value, AppError> {
    if !input.is_object() {
        return Err(AppError::validation("service settings must be an object"));
    }
    let settings = merge_known_settings(&default_settings(), &input);
    validate_settings(&settings)?;
    let raw = serde_json::to_string(&settings)
        .map_err(|_| AppError::validation("service settings must be valid"))?;
    let saved = services_repository::save_settings(db, tenant_id, branch_id, &raw)
        .await
        .map_err(|_| AppError::internal("failed to save service settings"))?;
    serde_json::from_str(&saved)
        .map_err(|_| AppError::internal("failed to read saved service settings"))
}

pub async fn enforce_write_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    exclude_id: &str,
    settings: &Value,
    candidate: ServiceRuleCandidate<'_>,
) -> Result<(), AppError> {
    enforce_static_rules(settings, &candidate)?;
    if bool_at(settings, "/serviceMasterRules/duplicateServiceNameBlock")
        && services_repository::service_name_exists(
            db,
            tenant_id,
            branch_id,
            candidate.name,
            exclude_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate service name"))?
    {
        return Err(AppError::validation(
            "service name already exists in this branch",
        ));
    }
    Ok(())
}

pub fn default_duration_minutes(settings: &Value) -> i32 {
    number_at(settings, "/pricingDuration/defaultDurationMinutes") as i32
}

pub fn default_gst_percent(settings: &Value) -> i32 {
    number_at(settings, "/defaults/defaultGstRate") as i32
}

pub fn default_active(settings: &Value) -> bool {
    text_at(settings, "/defaults/defaultStatus") != "inactive"
}

pub fn addons_enabled(settings: &Value) -> bool {
    bool_at(settings, "/serviceCatalog/serviceAddonsEnabled")
}

fn enforce_static_rules(
    settings: &Value,
    candidate: &ServiceRuleCandidate<'_>,
) -> Result<(), AppError> {
    if !addons_enabled(settings) && candidate.addon_count > 0 {
        return Err(AppError::validation("service add-ons are disabled"));
    }
    if bool_at(settings, "/serviceMasterRules/categoryRequired")
        && candidate.category.trim().is_empty()
    {
        return Err(AppError::validation(
            "category is required by service settings",
        ));
    }
    if bool_at(settings, "/serviceMasterRules/durationRequired") && candidate.duration_minutes <= 0
    {
        return Err(AppError::validation(
            "duration is required by service settings",
        ));
    }
    if bool_at(settings, "/staffAssignment/staffAssignmentRequired") && candidate.staff_count == 0 {
        return Err(AppError::validation("staff assignment is required"));
    }
    if !bool_at(settings, "/staffAssignment/allowMultiStaff") && candidate.staff_count > 1 {
        return Err(AppError::validation(
            "multiple staff assignments are disabled",
        ));
    }
    if bool_at(settings, "/recipeInventory/requireRecipeForService") && !candidate.has_recipe {
        return Err(AppError::validation("a product recipe is required"));
    }
    if bool_at(settings, "/pricingRules/minimumPriceRule") && candidate.price_paise <= 0 {
        return Err(AppError::validation(
            "service price must be greater than zero",
        ));
    }
    Ok(())
}

fn validate_settings(settings: &Value) -> Result<(), AppError> {
    if !(5..=480).contains(&number_at(
        settings,
        "/pricingDuration/defaultDurationMinutes",
    )) {
        return Err(AppError::validation(
            "defaultDurationMinutes must be between 5 and 480",
        ));
    }
    if !(0..=100).contains(&number_at(settings, "/defaults/defaultGstRate")) {
        return Err(AppError::validation(
            "defaultGstRate must be between 0 and 100",
        ));
    }
    if !matches!(
        text_at(settings, "/defaults/defaultStatus"),
        "active" | "inactive"
    ) {
        return Err(AppError::validation(
            "defaultStatus must be active or inactive",
        ));
    }
    Ok(())
}

fn default_settings() -> Value {
    json!({
        "serviceCatalog": { "serviceAddonsEnabled": true },
        "pricingDuration": { "defaultDurationMinutes": 30 },
        "staffAssignment": { "staffAssignmentRequired": false, "allowMultiStaff": true },
        "recipeInventory": { "requireRecipeForService": false },
        "defaults": { "defaultStatus": "active", "defaultGstRate": 18 },
        "serviceMasterRules": {
            "categoryRequired": false,
            "durationRequired": false,
            "duplicateServiceNameBlock": false
        },
        "pricingRules": { "minimumPriceRule": false }
    })
}

fn merge_known_settings(defaults: &Value, input: &Value) -> Value {
    match (defaults, input) {
        (Value::Object(defaults), Value::Object(input)) => Value::Object(
            defaults
                .iter()
                .map(|(key, default)| {
                    let value = input
                        .get(key)
                        .map(|candidate| merge_known_settings(default, candidate))
                        .unwrap_or_else(|| default.clone());
                    (key.clone(), value)
                })
                .collect(),
        ),
        (Value::Bool(_), Value::Bool(_))
        | (Value::String(_), Value::String(_))
        | (Value::Number(_), Value::Number(_)) => input.clone(),
        _ => defaults.clone(),
    }
}

fn bool_at(value: &Value, pointer: &str) -> bool {
    value
        .pointer(pointer)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn number_at(value: &Value, pointer: &str) -> i64 {
    value.pointer(pointer).and_then(Value::as_i64).unwrap_or(0)
}

fn text_at<'a>(value: &'a Value, pointer: &str) -> &'a str {
    value.pointer(pointer).and_then(Value::as_str).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_rules_block_disabled_addons_and_missing_required_staff() {
        let settings = merge_known_settings(
            &default_settings(),
            &json!({
                "serviceCatalog": { "serviceAddonsEnabled": false },
                "staffAssignment": { "staffAssignmentRequired": true }
            }),
        );
        let mut candidate = ServiceRuleCandidate {
            name: "Hair Cut",
            category: "Hair",
            duration_minutes: 30,
            price_paise: 50_000,
            staff_count: 0,
            addon_count: 1,
            has_recipe: false,
        };
        assert!(enforce_static_rules(&settings, &candidate).is_err());
        candidate.addon_count = 0;
        assert!(enforce_static_rules(&settings, &candidate).is_err());
    }
}
