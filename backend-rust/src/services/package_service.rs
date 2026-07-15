use chrono::NaiveDate;
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool};

use crate::{
    models::common::AppError,
    repositories::packages_repository::{self, CreatePackage, PackageRecord, UpdatePackage},
};

pub struct PackageInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub price_paise: Option<i64>,
    pub discount_percent: Option<i32>,
    pub validity_days: Option<i32>,
    pub service_ids: Option<Vec<String>>,
    pub service_rows: Option<Vec<Value>>,
    pub paid_sessions: Option<i32>,
    pub free_sessions: Option<i32>,
    pub cost_price_paise: Option<i64>,
    pub rules: Option<Value>,
    pub show_mobile_app: Option<bool>,
    pub show_online_booking: Option<bool>,
    pub active: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageReport {
    pub status: String,
    pub summary: packages_repository::PackageReportSummary,
    pub rows: Vec<packages_repository::PackageReportRow>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PackageAlert {
    pub id: String,
    pub client_id: String,
    pub alert_type: String,
    pub severity: String,
    pub client_name: String,
    pub contact: String,
    pub phone: String,
    pub email: String,
    pub package_name: String,
    pub service_name: String,
    pub pending_qty: i32,
    pub pending_value_paise: i64,
    pub expires_at: Option<NaiveDate>,
}

pub async fn create(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: PackageInput,
) -> Result<PackageRecord, AppError> {
    let name = required_text(input.name.as_deref(), "name is required")?;
    let package_settings = settings(db, tenant_id, branch_id).await?;
    let paid_sessions = positive(input.paid_sessions.unwrap_or(1), "paidSessions")?;
    let free_sessions = non_negative(input.free_sessions.unwrap_or(0), "freeSessions")?;
    let rows = normalize_service_rows(input.service_rows, input.service_ids.as_deref())?;
    validate_paid_addons(&rows, &package_settings)?;
    if rows.is_empty() {
        return Err(AppError::validation(
            "at least one package service is required",
        ));
    }
    let service_ids = service_ids(&rows);
    let derived_cost = service_cost_paise(&rows);
    let cost_price_paise = non_negative_i64(
        input.cost_price_paise.unwrap_or(derived_cost),
        "costPricePaise",
    )?;
    let price_paise = non_negative_i64(
        input
            .price_paise
            .unwrap_or_else(|| package_price_paise(paid_sessions, &rows)),
        "pricePaise",
    )?;
    let service_ids_json = json_text(&json!(service_ids));
    let service_rows_json = json_text(&Value::Array(rows));
    let rules_json = json_text(&normalize_package_rules(input.rules, &package_settings)?);
    let default_validity = setting_i64(
        &package_settings,
        &["expiryRenewal", "defaultExpiryDays"],
        0,
    )
    .clamp(0, i64::from(i32::MAX)) as i32;
    let default_active =
        setting_text(&package_settings, &["defaults", "defaultStatus"], "active") == "active";
    packages_repository::create(
        db,
        CreatePackage {
            tenant_id,
            branch_id,
            name,
            description: input.description.as_deref().unwrap_or(""),
            price_paise,
            discount_percent: percentage(input.discount_percent.unwrap_or(0))?,
            validity_days: non_negative(
                input.validity_days.unwrap_or(default_validity),
                "validityDays",
            )?,
            service_ids_json: &service_ids_json,
            paid_sessions,
            free_sessions,
            cost_price_paise,
            service_rows_json: &service_rows_json,
            rules_json: &rules_json,
            show_mobile_app: input.show_mobile_app.unwrap_or(false),
            show_online_booking: input.show_online_booking.unwrap_or(true),
            active: input.active.unwrap_or(default_active),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to create package"))
}

pub async fn update(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    input: PackageInput,
) -> Result<Option<PackageRecord>, AppError> {
    let package_settings = settings(db, tenant_id, branch_id).await?;
    let rows = input
        .service_rows
        .map(|rows| normalize_service_rows(Some(rows), None))
        .transpose()?;
    if let Some(rows) = rows.as_ref() {
        validate_paid_addons(rows, &package_settings)?;
    }
    let service_rows_json = rows
        .as_ref()
        .map(|rows| json_text(&Value::Array(rows.clone())));
    let service_ids_json = if let Some(rows) = &rows {
        Some(json_text(&json!(service_ids(rows))))
    } else {
        input.service_ids.as_ref().map(|ids| json_text(&json!(ids)))
    };
    let rules = input
        .rules
        .map(|value| normalize_package_rules(Some(value), &package_settings))
        .transpose()?;
    let rules_json = rules.as_ref().map(json_text);
    packages_repository::update(
        db,
        UpdatePackage {
            tenant_id,
            branch_id,
            id,
            name: input.name.as_deref().map(str::trim),
            description: input.description.as_deref(),
            price_paise: input.price_paise.map(|value| value.max(0)),
            discount_percent: input.discount_percent.map(|value| value.clamp(0, 100)),
            validity_days: input.validity_days.map(|value| value.max(0)),
            service_ids_json: service_ids_json.as_deref(),
            paid_sessions: input.paid_sessions.map(|value| value.max(1)),
            free_sessions: input.free_sessions.map(|value| value.max(0)),
            cost_price_paise: input.cost_price_paise.map(|value| value.max(0)),
            service_rows_json: service_rows_json.as_deref(),
            rules_json: rules_json.as_deref(),
            show_mobile_app: input.show_mobile_app,
            show_online_booking: input.show_online_booking,
            active: input.active,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to update package"))
}

pub async fn settings(db: &PgPool, tenant_id: &str, branch_id: &str) -> Result<Value, AppError> {
    let saved = packages_repository::get_settings(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load package settings"))?;
    let saved = saved
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| json!({}));
    Ok(merge_known_settings(&default_settings(), &saved))
}

pub async fn save_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    value: Value,
) -> Result<Value, AppError> {
    if !value.is_object() {
        return Err(AppError::validation("package settings must be an object"));
    }
    let raw = json_text(&merge_known_settings(&default_settings(), &value));
    let saved = packages_repository::save_settings(db, tenant_id, branch_id, &raw)
        .await
        .map_err(|_| AppError::internal("failed to save package settings"))?;
    serde_json::from_str(&saved)
        .map_err(|_| AppError::internal("failed to read saved package settings"))
}

pub async fn report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
    search: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    limit: i64,
    offset: i64,
) -> Result<PackageReport, AppError> {
    let status = report_status(status)?;
    let (rows, summary) = tokio::try_join!(
        packages_repository::package_report(
            db,
            tenant_id,
            branch_id,
            status,
            search.trim(),
            from,
            to,
            limit,
            offset
        ),
        packages_repository::package_report_summary(
            db,
            tenant_id,
            branch_id,
            status,
            search.trim(),
            from,
            to
        ),
    )
    .map_err(|_| AppError::internal("failed to load package report"))?;
    Ok(PackageReport {
        status: status.to_string(),
        total: summary.total_rows,
        summary,
        rows,
        limit,
        offset,
    })
}

pub async fn alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<PackageAlert>, AppError> {
    let settings = settings(db, tenant_id, branch_id).await?;
    let pending_enabled = settings["remindersRisk"]["pendingCreditReminder"]
        .as_bool()
        .unwrap_or(true);
    let expiry_enabled = settings["remindersRisk"]["expiryReminder"]
        .as_bool()
        .unwrap_or(true);
    let high_enabled = settings["remindersRisk"]["ownerHighPendingAlert"]
        .as_bool()
        .unwrap_or(true);
    let reminder_days = settings["expiryRenewal"]["renewalReminderDays"]
        .as_i64()
        .unwrap_or(15)
        .clamp(0, 3650) as i32;
    let threshold = settings["remindersRisk"]["highPendingThresholdPaise"]
        .as_i64()
        .unwrap_or(1_000_000)
        .max(0);
    if !pending_enabled && !expiry_enabled && !high_enabled {
        return Ok(Vec::new());
    }
    sqlx::query_as::<_, PackageAlert>(
        r#"
        WITH credits AS (
          SELECT pc.id,pc.client_id, CONCAT_WS(' ',c.first_name,c.last_name) AS client_name,
                 COALESCE(NULLIF(c.phone,''),c.email,'') AS contact,COALESCE(c.phone,'') AS phone,COALESCE(c.email,'') AS email, pc.package_name,
                 pc.service_name, pc.remaining_qty AS pending_qty,
                 (pc.remaining_qty::BIGINT*pc.unit_value_paise) AS pending_value_paise, pc.expires_at
            FROM client_package_credits pc
            JOIN clients c ON c.id=pc.client_id AND c.tenant_id=pc.tenant_id AND c.branch_id=pc.branch_id
           WHERE pc.tenant_id=$1 AND pc.branch_id=$2 AND pc.active=TRUE AND pc.remaining_qty>0
        ), totals AS (
          SELECT client_id,SUM(pending_value_paise)::BIGINT AS client_pending_value FROM credits GROUP BY client_id
        )
        SELECT CASE
                 WHEN $4 AND cr.expires_at IS NOT NULL AND cr.expires_at<=CURRENT_DATE+$7::INT THEN 'expiry'
                 WHEN $5 AND t.client_pending_value >= $6 THEN 'high_pending'
                 ELSE 'pending_credit'
               END AS alert_type,
               CASE
                 WHEN cr.expires_at IS NOT NULL AND cr.expires_at<CURRENT_DATE THEN 'critical'
                 WHEN $4 AND cr.expires_at IS NOT NULL AND cr.expires_at<=CURRENT_DATE+$7::INT THEN 'high'
                 WHEN $5 AND t.client_pending_value >= $6 THEN 'medium'
                 ELSE 'low'
               END AS severity,
               cr.id,cr.client_id,cr.client_name,cr.contact,cr.phone,cr.email,cr.package_name,cr.service_name,cr.pending_qty,
               cr.pending_value_paise,cr.expires_at
          FROM credits cr JOIN totals t ON t.client_id=cr.client_id
         WHERE $3 OR ($4 AND cr.expires_at IS NOT NULL AND cr.expires_at<=CURRENT_DATE+$7::INT)
                   OR ($5 AND t.client_pending_value >= $6)
         ORDER BY CASE WHEN cr.expires_at<CURRENT_DATE THEN 0 WHEN cr.expires_at IS NULL THEN 2 ELSE 1 END,
                  cr.expires_at NULLS LAST,cr.client_name
         LIMIT 250
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(pending_enabled)
    .bind(expiry_enabled)
    .bind(high_enabled)
    .bind(threshold)
    .bind(reminder_days)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load package alerts"))
}

fn normalize_service_rows(
    rows: Option<Vec<Value>>,
    fallback_ids: Option<&[String]>,
) -> Result<Vec<Value>, AppError> {
    let source = rows.unwrap_or_else(|| {
        fallback_ids
            .unwrap_or(&[])
            .iter()
            .map(|id| json!({ "serviceId": id, "quantity": 1, "unitPricePaise": 0 }))
            .collect()
    });
    let mut normalized = Vec::with_capacity(source.len());
    for row in source {
        let service_id = row
            .get("serviceId")
            .or_else(|| row.get("service_id"))
            .or_else(|| row.get("id"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if service_id.is_empty() {
            return Err(AppError::validation("serviceId is required"));
        }
        if normalized
            .iter()
            .any(|item: &Value| item["serviceId"] == service_id)
        {
            return Err(AppError::validation("duplicate package service"));
        }
        let quantity = row
            .get("quantity")
            .or_else(|| row.get("credits"))
            .and_then(Value::as_i64)
            .unwrap_or(1);
        let unit_price = row
            .get("unitPricePaise")
            .or_else(|| row.get("unit_price_paise"))
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let addon_price = row
            .get("addonPricePaise")
            .or_else(|| row.get("addon_price_paise"))
            .and_then(Value::as_i64)
            .unwrap_or(0);
        if quantity <= 0 || quantity > i32::MAX as i64 {
            return Err(AppError::validation(
                "service quantity must be greater than zero",
            ));
        }
        if unit_price < 0 {
            return Err(AppError::validation(
                "service unitPricePaise must be 0 or greater",
            ));
        }
        if addon_price < 0 {
            return Err(AppError::validation(
                "service addonPricePaise must be 0 or greater",
            ));
        }
        normalized.push(json!({ "serviceId": service_id, "serviceName": row.get("serviceName").and_then(Value::as_str).unwrap_or(""), "quantity": quantity, "unitPricePaise": unit_price, "addonPricePaise": addon_price }));
    }
    Ok(normalized)
}

fn normalize_package_rules(input: Option<Value>, settings: &Value) -> Result<Value, AppError> {
    let mut rules = input.unwrap_or_else(|| json!({}));
    let object = rules
        .as_object_mut()
        .ok_or_else(|| AppError::validation("package rules must be an object"))?;
    object.entry("type").or_insert_with(|| json!("pay_x_get_y"));
    let package_type = object
        .get("packageType")
        .and_then(Value::as_str)
        .unwrap_or_else(|| setting_text(settings, &["defaults", "defaultPackageType"], "paid"))
        .trim()
        .to_ascii_lowercase();
    if !matches!(package_type.as_str(), "paid" | "free" | "combo") {
        return Err(AppError::validation(
            "packageType must be paid, free, or combo",
        ));
    }
    object.insert("packageType".into(), json!(package_type));
    let group_name = object
        .get("groupName")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if !group_name.is_empty()
        && !setting_bool(settings, &["packageCatalog", "packageGroupsEnabled"], true)
    {
        return Err(AppError::validation("package groups are disabled"));
    }
    object.insert("groupName".into(), json!(group_name));
    Ok(rules)
}

fn validate_paid_addons(rows: &[Value], settings: &Value) -> Result<(), AppError> {
    if setting_bool(
        settings,
        &["packageCatalog", "paidPackageAddonEnabled"],
        true,
    ) {
        return Ok(());
    }
    if rows
        .iter()
        .any(|row| row["addonPricePaise"].as_i64().unwrap_or(0) > 0)
    {
        return Err(AppError::validation("paid package add-ons are disabled"));
    }
    Ok(())
}

fn setting_bool(value: &Value, path: &[&str], fallback: bool) -> bool {
    path.iter()
        .try_fold(value, |current, key| current.get(*key))
        .and_then(Value::as_bool)
        .unwrap_or(fallback)
}

fn setting_i64(value: &Value, path: &[&str], fallback: i64) -> i64 {
    path.iter()
        .try_fold(value, |current, key| current.get(*key))
        .and_then(Value::as_i64)
        .unwrap_or(fallback)
}

fn setting_text<'a>(value: &'a Value, path: &[&str], fallback: &'a str) -> &'a str {
    path.iter()
        .try_fold(value, |current, key| current.get(*key))
        .and_then(Value::as_str)
        .unwrap_or(fallback)
}

fn service_ids(rows: &[Value]) -> Vec<String> {
    rows.iter()
        .filter_map(|row| row["serviceId"].as_str().map(ToString::to_string))
        .collect()
}
fn service_cost_paise(rows: &[Value]) -> i64 {
    rows.iter()
        .map(|row| {
            row["quantity"]
                .as_i64()
                .unwrap_or(0)
                .saturating_mul(row["unitPricePaise"].as_i64().unwrap_or(0))
        })
        .sum()
}
fn package_price_paise(paid_sessions: i32, rows: &[Value]) -> i64 {
    i64::from(paid_sessions).saturating_mul(
        rows.iter()
            .map(|row| row["unitPricePaise"].as_i64().unwrap_or(0))
            .sum(),
    )
}
fn json_text(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}
fn required_text<'a>(value: Option<&'a str>, message: &'static str) -> Result<&'a str, AppError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation(message))
}
fn positive(value: i32, field: &'static str) -> Result<i32, AppError> {
    (value > 0)
        .then_some(value)
        .ok_or_else(|| AppError::validation(format!("{field} must be greater than zero")))
}
fn non_negative(value: i32, field: &'static str) -> Result<i32, AppError> {
    (value >= 0)
        .then_some(value)
        .ok_or_else(|| AppError::validation(format!("{field} must be 0 or greater")))
}
fn non_negative_i64(value: i64, field: &'static str) -> Result<i64, AppError> {
    (value >= 0)
        .then_some(value)
        .ok_or_else(|| AppError::validation(format!("{field} must be 0 or greater")))
}
fn percentage(value: i32) -> Result<i32, AppError> {
    (0..=100)
        .contains(&value)
        .then_some(value)
        .ok_or_else(|| AppError::validation("discountPercent must be between 0 and 100"))
}
fn report_status(value: &str) -> Result<&str, AppError> {
    matches!(value, "pending" | "expired" | "completed")
        .then_some(value)
        .ok_or_else(|| AppError::validation("status must be pending, expired, or completed"))
}
fn default_settings() -> Value {
    json!({
        "packageCatalog": { "salesEnabled": true, "visibleInPos": true, "packageGroupsEnabled": true, "paidPackageAddonEnabled": true },
        "creditsRedemption": { "allowPartial": true, "blockWhenExpired": true, "allowCrossService": false, "requireStaffConfirmation": true },
        "expiryRenewal": { "defaultExpiryDays": 90, "expiredPendingAction": "block", "renewalReminderDays": 15 },
        "pricingPayment": { "allowDiscount": true, "taxApplicable": true, "taxInclusive": false, "allowDue": true },
        "onlineBooking": { "showPackages": false, "allowClientPurchase": false, "allowPackageServiceBooking": true },
        "remindersRisk": { "pendingCreditReminder": true, "ownerHighPendingAlert": true, "expiryReminder": true, "highPendingThresholdPaise": 1000000 },
        "defaults": { "defaultStatus": "active", "defaultPackageType": "paid" }
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
        (Value::Bool(_), Value::Bool(_)) | (Value::String(_), Value::String(_)) => input.clone(),
        (Value::Number(_), Value::Number(number))
            if number.as_i64().is_some_and(|value| value >= 0) =>
        {
            input.clone()
        }
        _ => defaults.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        default_settings, merge_known_settings, normalize_package_rules, normalize_service_rows,
        package_price_paise, report_status, service_cost_paise, validate_paid_addons,
    };
    use serde_json::json;

    #[test]
    fn calculates_package_prices_from_service_rows() {
        let rows = normalize_service_rows(
            Some(vec![
                json!({ "serviceId": "svc", "quantity": 4, "unitPricePaise": 2500 }),
            ]),
            None,
        )
        .unwrap();
        assert_eq!(service_cost_paise(&rows), 10_000);
        assert_eq!(package_price_paise(3, &rows), 7_500);
    }

    #[test]
    fn accepts_only_supported_report_statuses() {
        assert_eq!(report_status("pending").unwrap(), "pending");
        assert!(report_status("all").is_err());
    }

    #[test]
    fn package_settings_keep_known_typed_values_only() {
        let merged = merge_known_settings(
            &default_settings(),
            &json!({ "creditsRedemption": { "allowCrossService": true }, "unknown": true }),
        );
        assert_eq!(merged["creditsRedemption"]["allowCrossService"], true);
        assert!(merged.get("unknown").is_none());
    }

    #[test]
    fn package_catalog_rules_enforce_groups_addons_and_defaults() {
        let settings = merge_known_settings(
            &default_settings(),
            &json!({
                "packageCatalog": { "packageGroupsEnabled": false, "paidPackageAddonEnabled": false },
                "defaults": { "defaultPackageType": "combo" }
            }),
        );
        let rules = normalize_package_rules(None, &settings).unwrap();
        assert_eq!(rules["packageType"], "combo");
        assert!(
            normalize_package_rules(Some(json!({ "groupName": "Premium" })), &settings).is_err()
        );
        assert!(validate_paid_addons(
            &[json!({ "serviceId": "svc", "quantity": 1, "unitPricePaise": 100, "addonPricePaise": 50 })],
            &settings,
        )
        .is_err());
    }
}
