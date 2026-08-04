//! AI Dispute Manager: evidence preparation and a prioritised work queue.
//!
//! Chargebacks have been recorded since 0153 and the webhook path keeps
//! `payment_disputes` current, but answering one meant assembling the facts by
//! hand from half the schema while a deadline ran down. The workforce catalog
//! describes this agent as "payment risk rules and human review", and that is
//! what this is: it gathers the records that answer a dispute and rates how
//! defensible they look, then a person decides what to send.
//!
//! Nothing here contacts a provider or concedes a dispute. Representment rules
//! differ per provider and a wrong automatic submission cannot be taken back,
//! so the last step stays manual on purpose.

use serde::Serialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::models::common::AppError;

/// Bumped when the factors or their weights change, so a stored assessment
/// stays interpretable against the policy that produced it.
pub const MODEL_VERSION: &str = "dispute_strength_v1";

/// One contribution to how defensible a dispute looks, with its evidence.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StrengthFactor {
    pub key: &'static str,
    pub label: String,
    pub points: i32,
    pub detail: String,
}

/// The facts a chargebook response turns on, read from live records.
#[derive(Debug, Clone, Default)]
pub struct DisputeFacts {
    pub amount_paise: i64,
    pub sale_total_paise: i64,
    pub invoice_number: String,
    pub line_count: i64,
    pub payment_count: i64,
    /// A provider reference on the payment ties the charge to the gateway.
    pub has_payment_reference: bool,
    /// The guest turned up: an appointment for this client completed around the
    /// sale. This is the single strongest fact in a service-business dispute.
    pub appointment_completed: bool,
    pub appointment_count: i64,
    /// A form the guest signed — consent, intake or treatment.
    pub signed_form_count: i64,
    pub prior_visits: i64,
    pub client_age_days: f64,
    /// Chargebacks this guest raised before. A pattern is evidence about the
    /// guest, not about the salon.
    pub prior_disputes: i64,
    pub days_to_evidence_due: Option<f64>,
}

const MAX_DELIVERY_POINTS: f64 = 35.0;
const MAX_AUTHORISATION_POINTS: f64 = 25.0;
const MAX_RECORD_POINTS: f64 = 20.0;
const MAX_RELATIONSHIP_POINTS: f64 = 20.0;

fn round_points(value: f64) -> i32 {
    value.round() as i32
}

/// Rates how defensible a dispute looks and says why.
///
/// Pure, so the policy is testable without a database. The score is about the
/// strength of the *evidence*, not a prediction of the provider's ruling — no
/// deterministic rule can know that, and presenting a guess as a forecast would
/// invite someone to skip cases that were winnable.
pub fn assess(facts: &DisputeFacts) -> (i32, Vec<StrengthFactor>) {
    let mut factors = Vec::new();

    // Service delivery. In a salon dispute the question is almost always
    // "did they receive it", so attendance carries the most weight.
    let (delivery_points, delivery_detail) = if facts.appointment_completed {
        (
            MAX_DELIVERY_POINTS,
            "A completed appointment covers this sale".to_string(),
        )
    } else if facts.appointment_count > 0 {
        (
            MAX_DELIVERY_POINTS * 0.4,
            format!(
                "{} appointment(s) linked, none marked completed",
                facts.appointment_count
            ),
        )
    } else {
        (0.0, "No appointment record covers this sale".to_string())
    };
    factors.push(StrengthFactor {
        key: "service_delivery",
        label: "Service delivery".into(),
        points: round_points(delivery_points),
        detail: delivery_detail,
    });

    // Authorisation: something the guest signed, and a gateway reference tying
    // the charge to them.
    let mut authorisation = 0.0;
    if facts.signed_form_count > 0 {
        authorisation += MAX_AUTHORISATION_POINTS * 0.6;
    }
    if facts.has_payment_reference {
        authorisation += MAX_AUTHORISATION_POINTS * 0.4;
    }
    factors.push(StrengthFactor {
        key: "authorisation",
        label: "Authorisation".into(),
        points: round_points(authorisation),
        detail: match (facts.signed_form_count > 0, facts.has_payment_reference) {
            (true, true) => format!(
                "{} signed form(s) and a gateway payment reference",
                facts.signed_form_count
            ),
            (true, false) => format!(
                "{} signed form(s), no gateway reference",
                facts.signed_form_count
            ),
            (false, true) => "Gateway payment reference, nothing signed".into(),
            (false, false) => "No signed form and no gateway reference".into(),
        },
    });

    // Whether the sale itself is coherent: itemised, paid in full, receipted.
    let mut record = 0.0;
    if facts.line_count > 0 {
        record += MAX_RECORD_POINTS * 0.4;
    }
    if facts.payment_count > 0 {
        record += MAX_RECORD_POINTS * 0.3;
    }
    if facts.sale_total_paise > 0 && facts.amount_paise <= facts.sale_total_paise {
        record += MAX_RECORD_POINTS * 0.3;
    }
    factors.push(StrengthFactor {
        key: "sale_record",
        label: "Sale record".into(),
        points: round_points(record),
        detail: if facts.amount_paise > facts.sale_total_paise && facts.sale_total_paise > 0 {
            "The disputed amount is larger than the invoice total; check the match".into()
        } else {
            format!(
                "Invoice {} with {} line(s) and {} payment(s)",
                facts.invoice_number, facts.line_count, facts.payment_count
            )
        },
    });

    // The relationship. A long-standing guest with many visits disputing once
    // is a different case from a first visit, and a guest who disputes
    // repeatedly is evidence in the salon's favour.
    let mut relationship = 0.0;
    if facts.prior_visits >= 3 {
        relationship += MAX_RELATIONSHIP_POINTS * 0.5;
    } else if facts.prior_visits >= 1 {
        relationship += MAX_RELATIONSHIP_POINTS * 0.25;
    }
    if facts.client_age_days >= 180.0 {
        relationship += MAX_RELATIONSHIP_POINTS * 0.25;
    }
    if facts.prior_disputes >= 2 {
        relationship += MAX_RELATIONSHIP_POINTS * 0.25;
    }
    factors.push(StrengthFactor {
        key: "relationship",
        label: "Guest relationship".into(),
        points: round_points(relationship),
        detail: format!(
            "{} prior visit(s), customer for {:.0} days, {} prior dispute(s)",
            facts.prior_visits, facts.client_age_days, facts.prior_disputes
        ),
    });

    let total: i32 = factors.iter().map(|factor| factor.points).sum();
    (total.clamp(0, 100), factors)
}

/// How urgently a dispute needs work: deadline first, then money.
///
/// A deadline that has passed still ranks at the top rather than dropping off,
/// because a missed one is the thing a manager most needs to see.
pub fn urgency(facts: &DisputeFacts) -> i32 {
    let deadline = match facts.days_to_evidence_due {
        Some(days) if days <= 0.0 => 100.0,
        Some(days) if days <= 2.0 => 90.0,
        Some(days) if days <= 5.0 => 70.0,
        Some(days) if days <= 10.0 => 45.0,
        Some(_) => 25.0,
        // No deadline from the provider yet; still work it, just not first.
        None => 20.0,
    };
    // Money nudges ordering inside a deadline band rather than overriding it:
    // a large dispute due next month must not outrank a small one due tomorrow.
    let money = ((facts.amount_paise as f64) / 5_000_00.0).clamp(0.0, 1.0) * 15.0;
    ((deadline + money).round() as i32).clamp(0, 100)
}

/// Reads the facts behind one dispute.
async fn facts_for(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    dispute_id: &str,
) -> Result<(DisputeFacts, Value), AppError> {
    let row = sqlx::query_as::<_, (i64, String, String, String, Option<f64>, i64, String, i64, i64, bool, i64, i64, i64, i64, i64, Option<f64>)>(
        r#"SELECT dispute.amount_paise,
                  dispute.reason,
                  dispute.status,
                  dispute.provider,
                  EXTRACT(EPOCH FROM (dispute.evidence_due_at - NOW())) / 86400.0,
                  COALESCE(sale.total_paise, 0),
                  COALESCE(sale.invoice_number, ''),
                  (SELECT COUNT(*) FROM pos_sale_lines line
                    WHERE line.tenant_id = dispute.tenant_id AND line.sale_id = dispute.sale_id)::BIGINT,
                  (SELECT COUNT(*) FROM pos_payments payment
                    WHERE payment.tenant_id = dispute.tenant_id AND payment.sale_id = dispute.sale_id)::BIGINT,
                  COALESCE((SELECT payment.method_reference <> '' FROM pos_payments payment
                             WHERE payment.tenant_id = dispute.tenant_id AND payment.id = dispute.payment_id), FALSE),
                  (SELECT COUNT(*) FROM appointments appointment
                    WHERE appointment.tenant_id = dispute.tenant_id AND appointment.branch_id = dispute.branch_id
                      AND appointment.client_id = sale.client_id
                      AND appointment.start_at BETWEEN sale.created_at - INTERVAL '1 day'
                                                   AND sale.created_at + INTERVAL '1 day')::BIGINT,
                  (SELECT COUNT(*) FROM appointments appointment
                    WHERE appointment.tenant_id = dispute.tenant_id AND appointment.branch_id = dispute.branch_id
                      AND appointment.client_id = sale.client_id
                      AND appointment.status IN ('completed', 'paid')
                      AND appointment.start_at BETWEEN sale.created_at - INTERVAL '1 day'
                                                   AND sale.created_at + INTERVAL '1 day')::BIGINT,
                  (SELECT COUNT(*) FROM client_form_submissions form
                    WHERE form.tenant_id = dispute.tenant_id AND form.branch_id = dispute.branch_id
                      AND form.client_id = sale.client_id AND form.signed_at IS NOT NULL)::BIGINT,
                  (SELECT COUNT(*) FROM pos_sales prior
                    WHERE prior.tenant_id = dispute.tenant_id AND prior.branch_id = dispute.branch_id
                      AND prior.client_id = sale.client_id AND prior.created_at < sale.created_at)::BIGINT,
                  (SELECT COUNT(*) FROM payment_disputes other
                    WHERE other.tenant_id = dispute.tenant_id AND other.client_id = dispute.client_id
                      AND other.id <> dispute.id)::BIGINT,
                  (SELECT EXTRACT(EPOCH FROM (NOW() - client.created_at)) / 86400.0 FROM clients client
                    WHERE client.id = sale.client_id)
             FROM payment_disputes dispute
             LEFT JOIN pos_sales sale
                    ON sale.id = dispute.sale_id AND sale.tenant_id = dispute.tenant_id
            WHERE dispute.tenant_id = $1 AND dispute.branch_id = $2 AND dispute.id = $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(dispute_id)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to load dispute evidence"))?
    .ok_or_else(|| AppError::not_found("dispute was not found"))?;

    let facts = DisputeFacts {
        amount_paise: row.0,
        sale_total_paise: row.5,
        invoice_number: row.6,
        line_count: row.7,
        payment_count: row.8,
        has_payment_reference: row.9,
        appointment_count: row.10,
        appointment_completed: row.11 > 0,
        signed_form_count: row.12,
        prior_visits: row.13,
        prior_disputes: row.14,
        client_age_days: row.15.unwrap_or(0.0).max(0.0),
        days_to_evidence_due: row.4,
    };
    let header = json!({
        "disputeId": dispute_id,
        "provider": row.3,
        "reason": row.1,
        "status": row.2,
        "amountPaise": row.0,
        "daysToEvidenceDue": row.4,
    });
    Ok((facts, header))
}

/// Assembles the evidence pack for one dispute from live records.
///
/// The pack is deliberately built on read rather than cached: until it is
/// submitted, the most useful version is the current one.
pub async fn evidence_pack(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    dispute_id: &str,
) -> Result<Value, AppError> {
    let (facts, header) = facts_for(db, tenant_id, branch_id, dispute_id).await?;
    let (strength, strength_factors) = assess(&facts);

    let lines: Vec<Value> = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
                    'itemName', line.item_name, 'quantity', line.quantity,
                    'lineTotalPaise', line.line_total_paise, 'lineType', line.line_type)
             FROM pos_sale_lines line
             JOIN payment_disputes dispute ON dispute.sale_id = line.sale_id
            WHERE dispute.tenant_id = $1 AND dispute.branch_id = $2 AND dispute.id = $3
              AND line.tenant_id = $1
            ORDER BY line.created_at, line.id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(dispute_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load disputed invoice lines"))?;

    let payments: Vec<Value> = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
                    'method', payment.method, 'amountPaise', payment.amount_paise,
                    'reference', payment.method_reference, 'takenAt', payment.created_at)
             FROM pos_payments payment
             JOIN payment_disputes dispute ON dispute.sale_id = payment.sale_id
            WHERE dispute.tenant_id = $1 AND dispute.branch_id = $2 AND dispute.id = $3
              AND payment.tenant_id = $1
            ORDER BY payment.created_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(dispute_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load disputed payments"))?;

    // What is missing is as useful as what is present: it tells a manager what
    // to go and find before the deadline.
    let mut gaps = Vec::new();
    if !facts.appointment_completed {
        gaps.push("No completed appointment covers this sale");
    }
    if facts.signed_form_count == 0 {
        gaps.push("No signed form is on file for this guest");
    }
    if !facts.has_payment_reference {
        gaps.push("The payment has no gateway reference recorded");
    }
    if facts.line_count == 0 {
        gaps.push("The invoice has no line items");
    }

    // How the guest interacted with the payment link. A hosted checkout cannot
    // otherwise show that the guest themselves authorised the charge, so an
    // open from their device and a confirmed phone is the strongest
    // authorisation evidence available for a link-paid invoice.
    let link_activity: Vec<Value> = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
                    'eventType', event.event_type, 'sourceIp', event.source_ip,
                    'createdAt', event.created_at, 'details', event.details_json)
             FROM pos_payment_link_events event
             JOIN pos_payment_links link ON link.id = event.link_id
             JOIN payment_disputes dispute ON dispute.sale_id = link.sale_id
            WHERE dispute.tenant_id = $1 AND dispute.branch_id = $2 AND dispute.id = $3
              AND event.tenant_id = $1
            ORDER BY event.created_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(dispute_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load payment link activity"))?;

    Ok(json!({
        "dispute": header,
        "paymentLinkActivity": link_activity,
        "invoice": {
            "invoiceNumber": facts.invoice_number,
            "totalPaise": facts.sale_total_paise,
            "lines": lines,
        },
        "payments": payments,
        "serviceDelivery": {
            "appointmentsAroundSale": facts.appointment_count,
            "completedAppointment": facts.appointment_completed,
        },
        "authorisation": {
            "signedFormCount": facts.signed_form_count,
            "hasPaymentReference": facts.has_payment_reference,
        },
        "relationship": {
            "priorVisits": facts.prior_visits,
            "customerForDays": facts.client_age_days.round(),
            "priorDisputes": facts.prior_disputes,
        },
        "strengthScore": strength,
        "strengthFactors": strength_factors,
        "urgency": urgency(&facts),
        "gaps": gaps,
        "modelVersion": MODEL_VERSION,
        "submissionNote": "Review and send this through the provider's own dispute console; AuraShine does not submit representments.",
    }))
}

/// Stores the pack as prepared, so what was sent survives later edits to the
/// records it was drawn from.
pub async fn record_prepared_evidence(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    dispute_id: &str,
    actor_user_id: &str,
) -> Result<Value, AppError> {
    let pack = evidence_pack(db, tenant_id, branch_id, dispute_id).await?;
    let strength = pack
        .get("strengthScore")
        .and_then(Value::as_i64)
        .unwrap_or_default() as i32;
    let factors = pack
        .get("strengthFactors")
        .cloned()
        .unwrap_or_else(|| json!([]));

    let updated = sqlx::query(
        r#"UPDATE payment_disputes
              SET evidence_pack_json = $4,
                  evidence_prepared_at = NOW(),
                  evidence_prepared_by = $5,
                  strength_score = $6,
                  strength_factors_json = $7,
                  status = CASE WHEN status = 'open' THEN 'under_review' ELSE status END,
                  updated_at = NOW()
            WHERE tenant_id = $1 AND branch_id = $2 AND id = $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(dispute_id)
    .bind(&pack)
    .bind(actor_user_id)
    .bind(strength)
    .bind(&factors)
    .execute(db)
    .await
    .map_err(|_| AppError::internal("failed to store the prepared evidence"))?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::not_found("dispute was not found"));
    }
    Ok(pack)
}

/// Open disputes ordered by what needs work first.
pub async fn work_queue(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<Value>, AppError> {
    let ids: Vec<(String,)> = sqlx::query_as(
        r#"SELECT id FROM payment_disputes
            WHERE tenant_id = $1 AND branch_id = $2 AND status IN ('open', 'under_review')
            ORDER BY evidence_due_at NULLS LAST, opened_at
            LIMIT 100"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load the dispute queue"))?;

    let mut queue = Vec::with_capacity(ids.len());
    for (dispute_id,) in ids {
        let (facts, header) = facts_for(db, tenant_id, branch_id, &dispute_id).await?;
        let (strength, factors) = assess(&facts);
        queue.push(json!({
            "dispute": header,
            "invoiceNumber": facts.invoice_number,
            "strengthScore": strength,
            "strengthFactors": factors,
            "urgency": urgency(&facts),
        }));
    }
    // Deadline first, then how defensible it looks: a strong case still has to
    // be sent before it expires.
    queue.sort_by(|left, right| {
        let urgency_of = |value: &Value| value.get("urgency").and_then(Value::as_i64).unwrap_or(0);
        let strength_of = |value: &Value| {
            value
                .get("strengthScore")
                .and_then(Value::as_i64)
                .unwrap_or(0)
        };
        urgency_of(right)
            .cmp(&urgency_of(left))
            .then(strength_of(right).cmp(&strength_of(left)))
    });
    Ok(queue)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> DisputeFacts {
        DisputeFacts {
            amount_paise: 250_000,
            sale_total_paise: 250_000,
            invoice_number: "INV-1".into(),
            line_count: 2,
            payment_count: 1,
            has_payment_reference: true,
            appointment_completed: false,
            appointment_count: 0,
            signed_form_count: 0,
            prior_visits: 0,
            client_age_days: 10.0,
            prior_disputes: 0,
            days_to_evidence_due: Some(7.0),
        }
    }

    fn points(factors: &[StrengthFactor], key: &str) -> i32 {
        factors
            .iter()
            .find(|factor| factor.key == key)
            .map_or(0, |factor| factor.points)
    }

    #[test]
    fn a_completed_appointment_is_the_strongest_single_fact() {
        let mut attended = base();
        attended.appointment_completed = true;
        attended.appointment_count = 1;
        let (attended_score, attended_factors) = assess(&attended);
        let (absent_score, _) = assess(&base());
        assert!(attended_score > absent_score);
        assert_eq!(points(&attended_factors, "service_delivery"), 35);
    }

    #[test]
    fn a_booked_but_uncompleted_appointment_counts_for_less_than_a_completed_one() {
        let mut booked = base();
        booked.appointment_count = 1;
        let mut completed = base();
        completed.appointment_count = 1;
        completed.appointment_completed = true;
        assert!(
            points(&assess(&booked).1, "service_delivery")
                < points(&assess(&completed).1, "service_delivery")
        );
    }

    #[test]
    fn a_repeat_disputer_strengthens_the_salons_case() {
        let mut repeat = base();
        repeat.prior_disputes = 3;
        assert!(
            points(&assess(&repeat).1, "relationship") > points(&assess(&base()).1, "relationship")
        );
    }

    #[test]
    fn an_amount_larger_than_the_invoice_is_called_out() {
        let mut mismatched = base();
        mismatched.amount_paise = 500_000;
        let (_, factors) = assess(&mismatched);
        let record = factors
            .iter()
            .find(|factor| factor.key == "sale_record")
            .unwrap();
        assert!(
            record.detail.contains("larger than the invoice total"),
            "{}",
            record.detail
        );
    }

    #[test]
    fn a_passed_deadline_stays_at_the_top_of_the_queue() {
        let mut overdue = base();
        overdue.days_to_evidence_due = Some(-3.0);
        let mut comfortable = base();
        comfortable.days_to_evidence_due = Some(30.0);
        assert!(urgency(&overdue) > urgency(&comfortable));
        // A missed deadline is what a manager most needs to see, so it must not
        // sink below anything.
        assert_eq!(urgency(&overdue), 100);
    }

    #[test]
    fn money_orders_within_a_deadline_band_without_overriding_it() {
        let mut large_far = base();
        large_far.amount_paise = 50_000_00;
        large_far.days_to_evidence_due = Some(30.0);
        let mut small_soon = base();
        small_soon.amount_paise = 1_000_00;
        small_soon.days_to_evidence_due = Some(1.0);
        assert!(
            urgency(&small_soon) > urgency(&large_far),
            "a small dispute due tomorrow must outrank a large one due next month"
        );
    }

    #[test]
    fn scores_stay_inside_the_column_constraint() {
        let mut best = base();
        best.appointment_completed = true;
        best.appointment_count = 2;
        best.signed_form_count = 4;
        best.prior_visits = 20;
        best.client_age_days = 900.0;
        best.prior_disputes = 5;
        let mut worst = DisputeFacts {
            invoice_number: String::new(),
            ..Default::default()
        };
        worst.amount_paise = 100;
        // payment_disputes.strength_score is CHECK (BETWEEN 0 AND 100).
        assert!((0..=100).contains(&assess(&best).0));
        assert!((0..=100).contains(&assess(&worst).0));
        assert!(assess(&best).0 > assess(&worst).0);
    }

    #[test]
    fn every_factor_explains_itself() {
        let (_, factors) = assess(&base());
        assert!(!factors.is_empty());
        for factor in &factors {
            assert!(!factor.label.is_empty(), "{} has no label", factor.key);
            assert!(!factor.detail.is_empty(), "{} has no detail", factor.key);
        }
    }
}
