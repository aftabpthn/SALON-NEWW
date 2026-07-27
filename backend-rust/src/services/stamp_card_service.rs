//! Loyalty Phase 1B: stamp card engine.
//!
//! Stamps are a second loyalty currency stored in `stamp_card_events`.
//! Programs are configured by the owner in `membership_settings.stampCards`.
//! A paid POS invoice earns at most one stamp per program; reaching
//! `stampsRequired` posts a completion event and, when configured, issues
//! reward points through the existing rewards ledger under a dedicated
//! idempotency key so it never collides with the invoice's own earned row.
//!
//! Every query is tenant and branch scoped, and the database unique indexes —
//! not application logic — are the duplicate guard, because the POS reward
//! hook can run several times for one sale.
//!
//! Phase 1B balances are strictly per branch: a card earned at one branch is
//! not spendable at another. There is deliberately no `scope` setting, because
//! exposing a tenant option that still resolved balances per branch would
//! mislead owners. Tenant-wide cards are Phase 1D.

use serde_json::Value;
use sqlx::{Postgres, Transaction};

use crate::models::common::AppError;

/// An owner-configured stamp card program, normalised from settings JSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StampProgram {
    pub code: String,
    pub name: String,
    pub stamps_required: i32,
    pub reward_points_on_completion: i32,
    pub minimum_bill_paise: i64,
    /// POS line types that make an invoice eligible, e.g. `service`.
    pub eligible_line_types: Vec<String>,
}

/// Reads the active, usable programs from membership settings. Blank template
/// rows (the settings default) and inactive programs are skipped so a tenant
/// that never configured a card never earns stamps.
pub fn active_programs(settings: &Value) -> Vec<StampProgram> {
    settings
        .get("stampCards")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let code = entry.get("code").and_then(Value::as_str).unwrap_or("").trim();
            let active = entry.get("active").and_then(Value::as_bool).unwrap_or(false);
            let stamps_required = entry
                .get("stampsRequired")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            if code.is_empty() || !active || stamps_required <= 0 {
                return None;
            }
            let earn_rule = entry.get("earnRule").cloned().unwrap_or(Value::Null);
            let eligible_line_types = earn_rule
                .get("eligibleLineTypes")
                .and_then(Value::as_object)
                .map(|types| {
                    types
                        .iter()
                        .filter(|(_, enabled)| enabled.as_bool().unwrap_or(false))
                        .map(|(line_type, _)| line_type.clone())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some(StampProgram {
                code: code.to_string(),
                name: entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(code)
                    .trim()
                    .to_string(),
                stamps_required: stamps_required.clamp(1, i64::from(i32::MAX)) as i32,
                reward_points_on_completion: entry
                    .get("rewardPointsOnCompletion")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    .clamp(0, i64::from(i32::MAX)) as i32,
                minimum_bill_paise: earn_rule
                    .get("minimumBillPaise")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    .max(0),
                eligible_line_types,
            })
        })
        .collect()
}

/// Whether an invoice earns a stamp: it must clear the minimum bill and, when
/// the program restricts line types, contain at least one eligible line.
pub fn invoice_earns_stamp(
    program: &StampProgram,
    total_paise: i64,
    sale_line_types: &[String],
) -> bool {
    if total_paise < program.minimum_bill_paise {
        return false;
    }
    if program.eligible_line_types.is_empty() {
        // No line-type restriction configured: any paid invoice qualifies.
        return true;
    }
    sale_line_types
        .iter()
        .any(|line_type| program.eligible_line_types.contains(line_type))
}

/// The stable key used for the reward points issued on card completion. Keyed
/// by sale and program so a replayed POS hook cannot double-issue, and
/// distinct from the invoice's own `earned` row, which is keyed by
/// `source_sale_id` in `membership_reward_ledger`.
pub fn completion_idempotency_key(sale_id: &str, program_code: &str) -> String {
    format!("stamp-completion:{sale_id}:{program_code}")
}

/// Whether a completion event may follow this earn. Completion is allowed only
/// when the stamp row was actually written: a replayed POS hook conflicts on
/// the sale unique index and inserts nothing, and must not complete the card a
/// second time for the same invoice.
pub fn completion_follows_new_stamp(
    stamp_inserted: bool,
    balance_after: i32,
    stamps_required: i32,
) -> bool {
    stamp_inserted && stamps_required > 0 && balance_after >= stamps_required
}

/// Balance after a reversal, floored at zero. A stamp already consumed by a
/// completed card must never drive the balance negative.
pub fn reversed_balance(current_balance: i32, stamps: i32) -> i32 {
    current_balance.saturating_sub(stamps.max(0)).max(0)
}

/// Whether a refund reverses the stamp. Phase 1B reverses only a full refund;
/// a partial refund keeps the stamp.
pub fn refund_reverses_stamp(refunded_paise: i64, sale_total_paise: i64) -> bool {
    sale_total_paise > 0 && refunded_paise >= sale_total_paise
}

/// Current stamp balance for a client on one program, tenant/branch scoped.
pub async fn current_balance(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    program_code: &str,
) -> Result<i32, AppError> {
    sqlx::query_scalar::<_, i32>(
        "SELECT balance_after FROM stamp_card_events \
         WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND program_code=$4 \
         ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(program_code)
    .fetch_optional(&mut **tx)
    .await
    .map(|value| value.unwrap_or(0))
    .map_err(|_| AppError::internal("failed to load stamp balance"))
}

/// Distinct POS line types on a sale, used for the eligibility check.
pub async fn sale_line_types(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<Vec<String>, AppError> {
    sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT line_type FROM pos_sale_lines \
         WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load sale line types"))
}

/// Inserts a stamp event. Returns true when a row was written; a conflict on
/// either unique index means the event already exists and is a no-op replay.
#[allow(clippy::too_many_arguments)]
pub async fn insert_event(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    program_code: &str,
    event: StampEvent<'_>,
) -> Result<bool, AppError> {
    let inserted = sqlx::query_scalar::<_, String>(
        "INSERT INTO stamp_card_events \
         (tenant_id,branch_id,client_id,program_code,source_sale_id,source_refund_id,\
          event_type,stamps,balance_after,staff_id,note,idempotency_key) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) \
         ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(program_code)
    .bind(event.source_sale_id)
    .bind(event.source_refund_id)
    .bind(event.event_type)
    .bind(event.stamps)
    .bind(event.balance_after)
    .bind(event.staff_id)
    .bind(event.note)
    .bind(event.idempotency_key)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to post stamp card event"))?;
    Ok(inserted.is_some())
}

pub struct StampEvent<'a> {
    pub source_sale_id: &'a str,
    pub source_refund_id: &'a str,
    pub event_type: &'a str,
    pub stamps: i32,
    pub balance_after: i32,
    pub staff_id: &'a str,
    pub note: &'a str,
    pub idempotency_key: &'a str,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn settings_with(programs: Value) -> Value {
        json!({ "stampCards": programs })
    }

    fn program() -> StampProgram {
        StampProgram {
            code: "coffee".into(),
            name: "Coffee card".into(),
            stamps_required: 5,
            reward_points_on_completion: 50,
            minimum_bill_paise: 50_000,
            eligible_line_types: vec!["service".into()],
        }
    }

    #[test]
    fn only_configured_active_programs_earn() {
        // The settings default is a blank inactive template and must never earn.
        let blank = settings_with(json!([{
            "code": "", "name": "", "active": false, "stampsRequired": 10,
            "rewardPointsOnCompletion": 0,
            "earnRule": { "minimumBillPaise": 0, "eligibleLineTypes": { "service": true } },
        }]));
        assert!(active_programs(&blank).is_empty());

        // Inactive, blank-coded, and zero-stamp programs are all skipped.
        let unusable = settings_with(json!([
            { "code": "a", "active": false, "stampsRequired": 5 },
            { "code": "", "active": true, "stampsRequired": 5 },
            { "code": "c", "active": true, "stampsRequired": 0 }
        ]));
        assert!(active_programs(&unusable).is_empty());

        // A real program is read with its rules.
        let configured = settings_with(json!([{
            "code": "coffee", "name": "Coffee card", "active": true,
            "stampsRequired": 5, "rewardPointsOnCompletion": 50,
            "earnRule": {
                "minimumBillPaise": 50_000,
                "eligibleLineTypes": { "service": true, "product": false }
            }
        }]));
        assert_eq!(active_programs(&configured), vec![program()]);

        // No configuration at all earns nothing — no demo programs.
        assert!(active_programs(&json!({})).is_empty());
    }

    #[test]
    fn minimum_bill_and_line_types_gate_earning() {
        let program = program();
        let services = vec!["service".to_string()];
        let products = vec!["product".to_string()];

        // Below the minimum bill: no stamp.
        assert!(!invoice_earns_stamp(&program, 49_999, &services));
        // At or above the minimum with an eligible line: earns.
        assert!(invoice_earns_stamp(&program, 50_000, &services));
        assert!(invoice_earns_stamp(&program, 120_000, &services));
        // Eligible amount but no eligible line type: no stamp.
        assert!(!invoice_earns_stamp(&program, 120_000, &products));
        // Mixed basket containing an eligible line: earns.
        assert!(invoice_earns_stamp(
            &program,
            120_000,
            &["product".to_string(), "service".to_string()]
        ));

        // No line-type restriction configured: any qualifying invoice earns.
        let unrestricted = StampProgram {
            eligible_line_types: Vec::new(),
            ..program
        };
        assert!(invoice_earns_stamp(&unrestricted, 50_000, &products));
        assert!(!invoice_earns_stamp(&unrestricted, 1, &products));
    }

    #[test]
    fn completion_points_do_not_collide_with_invoice_points() {
        // The invoice's own reward row is keyed by source_sale_id; completion
        // points use a distinct idempotency key, so both can exist for one sale.
        let key = completion_idempotency_key("sale-1", "coffee");
        assert_eq!(key, "stamp-completion:sale-1:coffee");

        // Stable across replays of the same sale and program.
        assert_eq!(key, completion_idempotency_key("sale-1", "coffee"));
        // Distinct per program, so two completed cards on one sale both issue.
        assert_ne!(key, completion_idempotency_key("sale-1", "spa"));
        // Distinct per sale.
        assert_ne!(key, completion_idempotency_key("sale-2", "coffee"));
    }

    #[test]
    fn one_stamp_per_invoice_replay_cannot_complete_twice() {
        let required = 5;
        // A freshly written stamp that fills the card completes it.
        assert!(completion_follows_new_stamp(true, 5, required));
        assert!(completion_follows_new_stamp(true, 6, required));

        // A replayed POS hook conflicts on the sale unique index and inserts
        // nothing, so the card must not complete again for the same invoice.
        assert!(!completion_follows_new_stamp(false, 5, required));
        assert!(!completion_follows_new_stamp(false, 50, required));

        // A written stamp below the threshold does not complete.
        assert!(!completion_follows_new_stamp(true, 4, required));

        // A misconfigured zero-stamp program never completes.
        assert!(!completion_follows_new_stamp(true, 3, 0));
    }

    #[test]
    fn full_refund_reverses_stamp_partial_does_not() {
        // Phase 1B: only a full refund reverses.
        assert!(refund_reverses_stamp(120_000, 120_000));
        assert!(refund_reverses_stamp(130_000, 120_000));
        assert!(!refund_reverses_stamp(60_000, 120_000));
        assert!(!refund_reverses_stamp(0, 120_000));
        // A zero-total sale cannot be "fully" refunded into a reversal.
        assert!(!refund_reverses_stamp(0, 0));

        // Reversal never drives the balance below zero, even when the stamp
        // was already consumed by a completed card.
        assert_eq!(reversed_balance(3, 1), 2);
        assert_eq!(reversed_balance(0, 1), 0);
        assert_eq!(reversed_balance(1, 5), 0);
        assert_eq!(reversed_balance(2, -1), 2);
    }
}
