use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::{
    repositories::booking_intelligence_repository::{self, BusyAppointment},
    services::booking_service,
};

#[derive(Debug, Clone)]
pub struct PreviewLine {
    pub id: String,
    pub service_id: String,
    pub staff_id: String,
    pub starts_at: DateTime<Utc>,
    pub parallel: bool,
}

pub async fn preview(
    db: &sqlx::PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    lines: &[PreviewLine],
) -> Result<Value, sqlx::Error> {
    let service_ids = lines
        .iter()
        .map(|line| line.service_id.clone())
        .collect::<Vec<_>>();
    let services =
        booking_intelligence_repository::service_timings(db, tenant_id, branch_id, &service_ids)
            .await?;
    let by_service = services
        .into_iter()
        .map(|service| (service.id.clone(), service))
        .collect::<HashMap<_, _>>();
    let from = lines
        .iter()
        .map(|line| line.starts_at)
        .min()
        .unwrap_or_else(Utc::now);
    let until = from + Duration::hours(16);
    let busy =
        booking_intelligence_repository::busy_appointments(db, tenant_id, branch_id, from, until)
            .await?;
    let signals = if client_id.trim().is_empty() {
        None
    } else {
        Some(
            booking_intelligence_repository::client_signals(db, tenant_id, branch_id, client_id)
                .await?,
        )
    };
    let total_paise = lines
        .iter()
        .filter_map(|line| by_service.get(&line.service_id))
        .map(|service| service.price_paise)
        .sum::<i64>();
    let deposit = booking_service::deposit_quote(db, tenant_id, branch_id, total_paise)
        .await?
        .as_json();
    let guards = booking_intelligence_repository::service_booking_guards(
        db,
        tenant_id,
        branch_id,
        &service_ids,
    )
    .await?;
    let guard_by_service = guards
        .into_iter()
        .map(|guard| (guard.service_id.clone(), guard))
        .collect::<HashMap<_, _>>();

    let mut cursor = from;
    let mut plan = Vec::new();
    let mut alternatives = Vec::new();
    for line in lines {
        let Some(service) = by_service.get(&line.service_id) else {
            continue;
        };
        let starts_at = if line.parallel {
            line.starts_at
        } else {
            line.starts_at.max(cursor)
        };
        let active_end = starts_at + Duration::minutes(i64::from(service.duration_minutes.max(0)));
        let busy_until = active_end
            + Duration::minutes(i64::from(
                (service.wait_time_minutes
                    + service.cleanup_time_minutes
                    + service.buffer_time_minutes)
                    .max(0),
            ));
        if !line.parallel {
            cursor = busy_until;
        }
        let candidates = booking_intelligence_repository::eligible_staff(
            db,
            tenant_id,
            branch_id,
            &line.service_id,
        )
        .await?;
        let guard = guard_by_service.get(&line.service_id);
        let guard_current = if let (Some(guard), false) = (guard, client_id.trim().is_empty()) {
            booking_intelligence_repository::client_has_current_guard_form(
                db,
                tenant_id,
                branch_id,
                client_id,
                &guard.consultation_form_definition_id,
                guard.patch_test_valid_days,
            )
            .await?
        } else {
            false
        };
        let candidate_rows = candidates.iter().map(|candidate| {
            let load = busy.iter().filter(|entry| entry.staff_id == candidate.id).map(|entry| overlap_minutes(entry, from, until)).sum::<i64>();
            json!({"staffId":candidate.id,"name":candidate.name,"gender":candidate.gender,"verifiedSkills":candidate.verified_skills,"bookedMinutes":load})
        }).collect::<Vec<_>>();
        let eligible_ids = candidates
            .iter()
            .map(|candidate| candidate.id.clone())
            .collect::<Vec<_>>();
        let preferred = (!line.staff_id.trim().is_empty() && eligible_ids.contains(&line.staff_id))
            .then_some(line.staff_id.clone());
        let slots = alternative_slots(
            &busy,
            &eligible_ids,
            preferred.as_deref(),
            starts_at,
            busy_until - starts_at,
        );
        plan.push(json!({
            "lineId":line.id,"serviceId":service.id,"serviceName":service.name,"startAt":starts_at,"activeEndsAt":active_end,"busyUntil":busy_until,
            "durationMinutes":service.duration_minutes,"processingMinutes":service.wait_time_minutes,"cleanupMinutes":service.cleanup_time_minutes,"bufferMinutes":service.buffer_time_minutes,
            "staff":candidate_rows,
            "consultation":guard.map(|value| json!({"required":value.requires_consultation,"patchTestRequired":value.requires_patch_test,"formDefinitionId":value.consultation_form_definition_id,"current":guard_current})).unwrap_or_else(|| json!({"required":false,"patchTestRequired":false,"current":true}))
        }));
        alternatives.push(json!({"lineId":line.id,"serviceId":service.id,"slots":slots}));
    }

    let risk = signals
        .as_ref()
        .map(|value| {
            if value.appointments == 0 {
                0
            } else {
                ((value.no_shows * 100 + value.cancellations * 35) / value.appointments)
                    .clamp(0, 100)
            }
        })
        .unwrap_or(0);
    Ok(json!({
        "plan":plan,"alternatives":alternatives,"deposit":deposit,
        "client":signals.map(|value| json!({"walletPaise":value.wallet_paise,"unpaidPaise":value.unpaid_paise,"activeMemberships":value.active_memberships,"packageCredits":value.package_credits,"noShows":value.no_shows,"cancellations":value.cancellations,"riskScore":risk,"riskLevel":if risk>=60{"high"}else if risk>=30{"medium"}else{"low"}})).unwrap_or_else(|| json!(null))
    }))
}

fn overlap_minutes(entry: &BusyAppointment, from: DateTime<Utc>, until: DateTime<Utc>) -> i64 {
    (entry.end_at.min(until) - entry.start_at.max(from))
        .num_minutes()
        .max(0)
}

fn alternative_slots(
    busy: &[BusyAppointment],
    eligible_ids: &[String],
    preferred_staff_id: Option<&str>,
    requested: DateTime<Utc>,
    duration: Duration,
) -> Vec<Value> {
    let mut ordered = eligible_ids.to_vec();
    if let Some(preferred) = preferred_staff_id {
        ordered.sort_by_key(|candidate| if candidate == preferred { 0 } else { 1 });
    }
    let mut result = Vec::new();
    for step in 0..=32 {
        let starts_at = requested + Duration::minutes(step * 15);
        let ends_at = starts_at + duration;
        for staff_id in &ordered {
            if busy.iter().all(|entry| {
                entry.staff_id != *staff_id
                    || starts_at >= entry.end_at
                    || ends_at <= entry.start_at
            }) {
                result.push(json!({"staffId":staff_id,"startAt":starts_at,"endAt":ends_at,"requestedStaff":preferred_staff_id==Some(staff_id.as_str())}));
                if result.len() == 3 {
                    return result;
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::alternative_slots;
    use chrono::{Duration, Utc};

    #[test]
    fn alternatives_keep_requested_staff_first_when_available() {
        let start = Utc::now();
        let slots = alternative_slots(
            &[],
            &["other".into(), "requested".into()],
            Some("requested"),
            start,
            Duration::minutes(30),
        );
        assert_eq!(slots[0]["staffId"], "requested");
    }
}
pub async fn unmet_consultation_guards(
    db: &sqlx::PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    service_ids: &[String],
) -> Result<Vec<String>, sqlx::Error> {
    if client_id.trim().is_empty() || service_ids.is_empty() {
        return Ok(Vec::new());
    }
    let guards = booking_intelligence_repository::service_booking_guards(
        db,
        tenant_id,
        branch_id,
        service_ids,
    )
    .await?;
    let mut unmet = Vec::new();
    for guard in guards
        .into_iter()
        .filter(|guard| guard.requires_consultation || guard.requires_patch_test)
    {
        let current = booking_intelligence_repository::client_has_current_guard_form(
            db,
            tenant_id,
            branch_id,
            client_id,
            &guard.consultation_form_definition_id,
            guard.patch_test_valid_days,
        )
        .await?;
        if !current {
            unmet.push(guard.service_id);
        }
    }
    Ok(unmet)
}
