use serde_json::{json, Value};
use sqlx::PgPool;

use crate::repositories::booking_repository;

#[derive(Debug, Clone)]
pub struct DepositQuote {
    pub total_paise: i64,
    pub deposit_type: String,
    pub deposit_value: i64,
    pub deposit_paise: i64,
}

impl DepositQuote {
    pub fn required(&self) -> bool {
        self.deposit_paise > 0
    }

    pub fn as_json(&self) -> Value {
        let percent = (self.deposit_type == "percentage")
            .then_some(self.deposit_value)
            .unwrap_or(0);
        json!({
            "totalPaise": self.total_paise,
            "totalAmount": self.total_paise as f64 / 100.0,
            "depositType": self.deposit_type,
            "depositValue": self.deposit_value,
            "depositPercent": percent,
            "percent": percent,
            "depositPaise": self.deposit_paise,
            "amount": self.deposit_paise,
            "depositAmount": self.deposit_paise as f64 / 100.0,
            "required": self.required(),
            "reason": if self.required() { "booking_deposit_policy" } else { "deposit_not_required" },
            "currency": "INR"
        })
    }
}

pub async fn settings(db: &PgPool, tenant_id: &str, branch_id: &str) -> Result<Value, sqlx::Error> {
    let fallback_percent = booking_repository::branch_deposit_percent(db, tenant_id, branch_id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;
    let saved = booking_repository::booking_settings(db, tenant_id, branch_id).await?;
    Ok(effective_settings(saved.as_ref(), fallback_percent))
}

pub async fn save_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: &Value,
) -> Result<Value, BookingSettingsError> {
    let normalized = normalize_settings(input)?;
    let deposit_required = bool_at(&normalized, "/depositPayment/depositRequired");
    let deposit_type = text_at(&normalized, "/depositPayment/depositType");
    let deposit_value = number_at(&normalized, "/depositPayment/depositValue");
    let legacy_percent = if deposit_required && deposit_type == "percentage" {
        deposit_value.clamp(0, 100) as i32
    } else {
        0
    };
    booking_repository::save_booking_settings(
        db,
        tenant_id,
        branch_id,
        &normalized,
        legacy_percent,
    )
    .await
    .map_err(BookingSettingsError::Storage)?;
    Ok(normalized)
}

pub async fn deposit_quote(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    total_paise: i64,
) -> Result<DepositQuote, sqlx::Error> {
    let settings = settings(db, tenant_id, branch_id).await?;
    Ok(deposit_quote_from_settings(&settings, total_paise))
}

fn deposit_quote_from_settings(settings: &Value, total_paise: i64) -> DepositQuote {
    let required = bool_at(&settings, "/depositPayment/depositRequired");
    let deposit_type = text_at(&settings, "/depositPayment/depositType").to_string();
    let deposit_value = number_at(&settings, "/depositPayment/depositValue");
    let deposit_paise = if !required || total_paise <= 0 {
        0
    } else if deposit_type == "fixed" {
        total_paise.min(deposit_value.saturating_mul(100))
    } else {
        total_paise.saturating_mul(deposit_value.clamp(0, 100)) / 100
    };
    DepositQuote {
        total_paise,
        deposit_type,
        deposit_value,
        deposit_paise,
    }
}

#[derive(Debug)]
pub enum BookingSettingsError {
    Validation(&'static str),
    Storage(sqlx::Error),
}

fn effective_settings(saved: Option<&Value>, fallback_percent: i32) -> Value {
    let mut settings = saved
        .and_then(|value| normalize_settings(value).ok())
        .unwrap_or_else(default_settings);
    if saved.is_none() && fallback_percent > 0 {
        settings["depositPayment"]["depositRequired"] = json!(true);
        settings["depositPayment"]["depositType"] = json!("percentage");
        settings["depositPayment"]["depositValue"] = json!(fallback_percent.clamp(0, 100));
    }
    settings
}

fn normalize_settings(input: &Value) -> Result<Value, BookingSettingsError> {
    if !input.is_object() {
        return Err(BookingSettingsError::Validation(
            "booking settings must be an object",
        ));
    }
    let source = input
        .get("settings")
        .filter(|value| value.is_object())
        .unwrap_or(input);
    let defaults = default_settings();
    let deposit_type = one_of_text(
        source,
        "/depositPayment/depositType",
        &["percentage", "fixed"],
        "percentage",
    );
    let deposit_max = if deposit_type == "percentage" {
        100
    } else {
        1_000_000
    };
    Ok(json!({
        "bookingControl": {
            "onlineBooking": bool_value(source,"/bookingControl/onlineBooking",bool_at(&defaults,"/bookingControl/onlineBooking")),
            "walkInBooking": bool_value(source,"/bookingControl/walkInBooking",bool_at(&defaults,"/bookingControl/walkInBooking")),
            "allowClientStaffSelect": bool_value(source,"/bookingControl/allowClientStaffSelect",bool_at(&defaults,"/bookingControl/allowClientStaffSelect")),
            "sameDayBooking": bool_value(source,"/bookingControl/sameDayBooking",bool_at(&defaults,"/bookingControl/sameDayBooking")),
            "autoConfirmBooking": bool_value(source,"/bookingControl/autoConfirmBooking",bool_at(&defaults,"/bookingControl/autoConfirmBooking")),
            "riskyBookingOwnerApproval": bool_value(source,"/bookingControl/riskyBookingOwnerApproval",bool_at(&defaults,"/bookingControl/riskyBookingOwnerApproval"))
        },
        "slotRules": {
            "slotDurationMinutes": one_of_number(source,"/slotRules/slotDurationMinutes",&[5,10,15,30,45,60],15),
            "minimumAdvanceHours": number_value(source,"/slotRules/minimumAdvanceHours",2,0,168),
            "maximumFutureDays": number_value(source,"/slotRules/maximumFutureDays",30,1,365),
            "bufferMinutes": number_value(source,"/slotRules/bufferMinutes",0,0,240),
            "allowOverlapBooking": bool_value(source,"/slotRules/allowOverlapBooking",false),
            "previousTimeSlotVisibility": bool_value(source,"/slotRules/previousTimeSlotVisibility",false)
        },
        "cancellationReschedule": {
            "allowCancellation": bool_value(source,"/cancellationReschedule/allowCancellation",true),
            "cancellationUntilHours": number_value(source,"/cancellationReschedule/cancellationUntilHours",4,0,168),
            "allowReschedule": bool_value(source,"/cancellationReschedule/allowReschedule",true),
            "rescheduleUntilHours": number_value(source,"/cancellationReschedule/rescheduleUntilHours",4,0,168),
            "noShowAutoMark": bool_value(source,"/cancellationReschedule/noShowAutoMark",false),
            "lateChangeOwnerApproval": bool_value(source,"/cancellationReschedule/lateChangeOwnerApproval",true)
        },
        "depositPayment": {
            "depositRequired": bool_value(source,"/depositPayment/depositRequired",false),
            "depositType": deposit_type,
            "depositValue": number_value(source,"/depositPayment/depositValue",0,0,deposit_max),
            "payLaterAllowed": bool_value(source,"/depositPayment/payLaterAllowed",true),
            "riskyClientOnlinePayment": bool_value(source,"/depositPayment/riskyClientOnlinePayment",false),
            "depositRefundRule": text_value(source,"/depositPayment/depositRefundRule","Refunds follow owner approval and salon policy.",1000)
        },
        "clientRules": {
            "newClientBookingAllowed": bool_value(source,"/clientRules/newClientBookingAllowed",true),
            "blockedClientBookingBlocked": bool_value(source,"/clientRules/blockedClientBookingBlocked",true),
            "unpaidClientMode": one_of_text(source,"/clientRules/unpaidClientMode",&["allow","warn","block"],"warn"),
            "memberPriorityBooking": bool_value(source,"/clientRules/memberPriorityBooking",true),
            "packageClientPriorityBooking": bool_value(source,"/clientRules/packageClientPriorityBooking",true),
            "duplicateBookingCheck": bool_value(source,"/clientRules/duplicateBookingCheck",true)
        },
        "staffResource": {
            "staffAutoAssign": bool_value(source,"/staffResource/staffAutoAssign",false),
            "respectStaffWorkingHours": bool_value(source,"/staffResource/respectStaffWorkingHours",true),
            "respectStaffBreaks": bool_value(source,"/staffResource/respectStaffBreaks",true),
            "roomChairRequired": bool_value(source,"/staffResource/roomChairRequired",false),
            "resourceConflictCheck": bool_value(source,"/staffResource/resourceConflictCheck",true)
        },
        "notifications": {
            "clientConfirmationSms": bool_value(source,"/notifications/clientConfirmationSms",true),
            "clientConfirmationWhatsapp": bool_value(source,"/notifications/clientConfirmationWhatsapp",true),
            "clientConfirmationEmail": bool_value(source,"/notifications/clientConfirmationEmail",false),
            "reminderBeforeHours": number_value(source,"/notifications/reminderBeforeHours",24,0,168),
            "staffNotification": bool_value(source,"/notifications/staffNotification",true),
            "ownerHighValueNotification": bool_value(source,"/notifications/ownerHighValueNotification",true),
            "ownerRiskyBookingNotification": bool_value(source,"/notifications/ownerRiskyBookingNotification",true)
        }
    }))
}

fn default_settings() -> Value {
    json!({
        "bookingControl":{"onlineBooking":true,"walkInBooking":true,"allowClientStaffSelect":true,"sameDayBooking":true,"autoConfirmBooking":false,"riskyBookingOwnerApproval":true},
        "slotRules":{"slotDurationMinutes":15,"minimumAdvanceHours":2,"maximumFutureDays":30,"bufferMinutes":0,"allowOverlapBooking":false,"previousTimeSlotVisibility":false},
        "cancellationReschedule":{"allowCancellation":true,"cancellationUntilHours":4,"allowReschedule":true,"rescheduleUntilHours":4,"noShowAutoMark":false,"lateChangeOwnerApproval":true},
        "depositPayment":{"depositRequired":false,"depositType":"percentage","depositValue":0,"payLaterAllowed":true,"riskyClientOnlinePayment":false,"depositRefundRule":"Refunds follow owner approval and salon policy."},
        "clientRules":{"newClientBookingAllowed":true,"blockedClientBookingBlocked":true,"unpaidClientMode":"warn","memberPriorityBooking":true,"packageClientPriorityBooking":true,"duplicateBookingCheck":true},
        "staffResource":{"staffAutoAssign":false,"respectStaffWorkingHours":true,"respectStaffBreaks":true,"roomChairRequired":false,"resourceConflictCheck":true},
        "notifications":{"clientConfirmationSms":true,"clientConfirmationWhatsapp":true,"clientConfirmationEmail":false,"reminderBeforeHours":24,"staffNotification":true,"ownerHighValueNotification":true,"ownerRiskyBookingNotification":true}
    })
}

fn bool_value(value: &Value, pointer: &str, fallback: bool) -> bool {
    value
        .pointer(pointer)
        .and_then(Value::as_bool)
        .unwrap_or(fallback)
}

fn number_value(value: &Value, pointer: &str, fallback: i64, min: i64, max: i64) -> i64 {
    value
        .pointer(pointer)
        .and_then(|candidate| {
            candidate
                .as_i64()
                .or_else(|| candidate.as_f64().map(|number| number.round() as i64))
        })
        .unwrap_or(fallback)
        .clamp(min, max)
}

fn one_of_number(value: &Value, pointer: &str, allowed: &[i64], fallback: i64) -> i64 {
    let candidate = number_value(value, pointer, fallback, i64::MIN, i64::MAX);
    allowed
        .contains(&candidate)
        .then_some(candidate)
        .unwrap_or(fallback)
}

fn one_of_text(value: &Value, pointer: &str, allowed: &[&str], fallback: &str) -> String {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .filter(|candidate| allowed.contains(candidate))
        .unwrap_or(fallback)
        .to_string()
}

fn text_value(value: &Value, pointer: &str, fallback: &str, max_length: usize) -> String {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .trim()
        .chars()
        .take(max_length)
        .collect()
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
    fn normalizes_booking_policy_and_caps_percentage_deposit() {
        let settings = normalize_settings(&json!({
            "slotRules":{"slotDurationMinutes":17,"maximumFutureDays":900},
            "depositPayment":{"depositRequired":true,"depositType":"percentage","depositValue":250}
        }))
        .expect("settings should normalize");
        assert_eq!(
            settings.pointer("/slotRules/slotDurationMinutes"),
            Some(&json!(15))
        );
        assert_eq!(
            settings.pointer("/slotRules/maximumFutureDays"),
            Some(&json!(365))
        );
        assert_eq!(
            settings.pointer("/depositPayment/depositValue"),
            Some(&json!(100))
        );
    }

    #[test]
    fn fixed_deposit_never_exceeds_booking_total() {
        let settings = normalize_settings(&json!({
            "depositPayment":{"depositRequired":true,"depositType":"fixed","depositValue":1000}
        }))
        .expect("settings should normalize");
        let quote = deposit_quote_from_settings(&settings, 50_000);
        assert!(quote.required());
        assert_eq!(quote.as_json()["depositAmount"], json!(500.0));
    }
}
