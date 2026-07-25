use axum::http::HeaderMap;
use chrono::{DateTime, FixedOffset, NaiveDate, Utc};

use crate::models::common::AppError;

pub(crate) fn tenant_branch(headers: &HeaderMap) -> Result<(String, String), AppError> {
    let tenant_id = required_header(headers, "x-tenant-id")?;
    let branch_id = headers
        .get("x-branch-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            tenant_id
                .eq_ignore_ascii_case("platform")
                .then(|| "global".into())
        })
        .ok_or_else(|| AppError::validation("x-branch-id is required"))?;
    Ok((tenant_id, branch_id))
}

pub(crate) fn current_business_date() -> NaiveDate {
    business_date_at(Utc::now())
}

fn business_date_at(now: DateTime<Utc>) -> NaiveDate {
    now.with_timezone(&FixedOffset::east_opt(19_800).expect("IST offset is valid"))
        .date_naive()
}

fn required_header(headers: &HeaderMap, name: &'static str) -> Result<String, AppError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::validation(format!("{name} is required")))
}

#[cfg(test)]
mod tests {
    use super::business_date_at;
    use chrono::{TimeZone, Utc};

    #[test]
    fn business_date_uses_ist_day_boundary() {
        let before_ist_midnight = Utc.with_ymd_and_hms(2026, 7, 21, 18, 29, 59).unwrap();
        let after_ist_midnight = Utc.with_ymd_and_hms(2026, 7, 21, 18, 30, 0).unwrap();

        assert_eq!(
            business_date_at(before_ist_midnight).to_string(),
            "2026-07-21"
        );
        assert_eq!(
            business_date_at(after_ist_midnight).to_string(),
            "2026-07-22"
        );
    }
}
