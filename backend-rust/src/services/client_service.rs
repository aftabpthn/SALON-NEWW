use serde::Serialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::clients_repository::{
        self, ClientDiscountDecisionRecord, ClientDiscountDecisionWrite, ClientDiscountRuleRecord,
    },
};

pub struct DiscountRequest<'a> {
    pub client_id: &'a str,
    pub service_category: &'a str,
    pub subtotal_paise: i64,
    pub requested_discount_bps: i32,
    pub actor: &'a str,
}

struct DiscountTerms {
    approved_bps: i32,
    discount_paise: i64,
    remaining_budget_paise: i64,
    status: &'static str,
    capped: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RankedClientAction {
    rank: usize,
    priority: i32,
    category: &'static str,
    action: String,
    reason: String,
}

struct ActionSignals<'a> {
    primary_action: &'a str,
    primary_reason: &'a str,
    occasion: &'a str,
    inactive_days: i64,
    churn_risk_score: i32,
    amount_due_paise: i64,
    open_appointments: i64,
    review_sentiment: &'a str,
}

fn ranked_next_best_actions(signals: ActionSignals<'_>) -> Vec<RankedClientAction> {
    let mut candidates = vec![(
        100,
        "primary",
        signals.primary_action.to_owned(),
        signals.primary_reason.to_owned(),
    )];
    let mut add = |priority, category, action: &str, reason: String| {
        if !candidates.iter().any(|candidate| candidate.2 == action) {
            candidates.push((priority, category, action.to_owned(), reason));
        }
    };
    if !signals.occasion.is_empty() {
        add(
            95,
            "occasion",
            "Prepare occasion outreach",
            signals.occasion.to_owned(),
        );
    }
    if signals.inactive_days >= 90 {
        add(
            90,
            "win_back",
            "Start win-back outreach",
            format!("{} inactive days", signals.inactive_days),
        );
    }
    if signals.churn_risk_score >= 70 {
        add(
            85,
            "retention",
            "Start retention outreach",
            format!("Churn risk score {}", signals.churn_risk_score),
        );
    }
    if signals.amount_due_paise > 0 {
        add(
            80,
            "collections",
            "Recover outstanding balance",
            "Outstanding balance is pending".to_owned(),
        );
    }
    if signals.review_sentiment == "negative" {
        add(
            75,
            "reputation",
            "Start review recovery",
            "Recent review sentiment is negative".to_owned(),
        );
    }
    if signals.open_appointments == 0 {
        add(
            70,
            "booking",
            "Book next appointment",
            "No upcoming appointment".to_owned(),
        );
    }
    candidates.sort_by(|left, right| right.0.cmp(&left.0));
    candidates
        .into_iter()
        .take(5)
        .enumerate()
        .map(
            |(index, (priority, category, action, reason))| RankedClientAction {
                rank: index + 1,
                priority,
                category,
                action,
                reason,
            },
        )
        .collect()
}

pub fn normalize_phone(raw: &str) -> Result<String, AppError> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(String::new());
    }
    let digits = raw.chars().filter(char::is_ascii_digit).collect::<String>();
    let normalized = if let Some(rest) = digits.strip_prefix("00") {
        rest
    } else if digits.len() == 11 && digits.starts_with('0') {
        &digits[1..]
    } else {
        &digits
    };
    if !(7..=15).contains(&normalized.len()) {
        return Err(AppError::validation("invalid client phone"));
    }
    Ok(if normalized.len() == 10 && !raw.starts_with('+') {
        format!("+91{normalized}")
    } else {
        format!("+{normalized}")
    })
}

pub async fn communication_allowed(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    channel: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT CASE $4
             WHEN 'whatsapp' THEN COALESCE(whatsapp_opt_in,FALSE)
             WHEN 'sms' THEN COALESCE(sms_opt_in,FALSE)
             WHEN 'email' THEN COALESCE(email_opt_in,FALSE)
             ELSE FALSE
           END
           FROM clients
          WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND merged_into_client_id IS NULL"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(channel)
    .fetch_optional(db)
    .await
    .map(|allowed| allowed.unwrap_or(false))
}

pub async fn refresh_intelligence_snapshots(db: &PgPool) -> Result<u64, AppError> {
    let snapshots = clients_repository::refresh_intelligence_snapshots(db)
        .await
        .map_err(|_| AppError::internal("failed to refresh client intelligence snapshots"))?;
    let offers = clients_repository::refresh_win_back_offers(db)
        .await
        .map_err(|_| AppError::internal("failed to refresh client win-back offers"))?;
    Ok(snapshots + offers)
}

pub async fn evaluate_discount(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request: DiscountRequest<'_>,
) -> Result<ClientDiscountDecisionRecord, AppError> {
    let context = clients_repository::discount_context(db, tenant_id, branch_id, request.client_id)
        .await
        .map_err(|_| AppError::internal("failed to load client discount context"))?
        .ok_or_else(|| AppError::not_found("client was not found"))?;
    let rules = clients_repository::list_discount_rules(db, tenant_id, branch_id, true)
        .await
        .map_err(|_| AppError::internal("failed to load client discount rules"))?;
    let rule = rules.iter().find(|rule| {
        rule_matches(
            rule,
            &context.segment,
            request.service_category,
            context.lifetime_value_paise,
            context.has_membership,
            context.has_wallet_balance,
        )
    });

    let (rule_id, terms, reasons) = if let Some(rule) = rule {
        let terms = discount_terms(
            request.subtotal_paise,
            request.requested_discount_bps,
            context.lifetime_value_paise,
            context.approved_discount_spend_paise,
            rule,
        );
        let mut reasons = vec![format!(
            "Rule '{}' matched {} segment and {} service category.",
            rule.name, context.segment, request.service_category
        )];
        if terms.capped {
            reasons.push("Discount was capped by the rule or remaining CLV budget.".to_string());
        }
        if terms.status == "approval_required" {
            reasons
                .push("Manager approval is required above the configured threshold.".to_string());
        } else if terms.status == "rejected" {
            reasons.push("No CLV discount budget remains for this request.".to_string());
        } else {
            reasons.push("Decision is within the configured approval threshold.".to_string());
        }
        (Some(rule.id.as_str()), terms, reasons)
    } else {
        (
            None,
            DiscountTerms {
                approved_bps: 0,
                discount_paise: 0,
                remaining_budget_paise: 0,
                status: "rejected",
                capped: true,
            },
            vec![format!(
                "No active rule matched segment '{}', category '{}', CLV, membership and wallet eligibility.",
                context.segment, request.service_category
            )],
        )
    };
    let reasons = json!(reasons);
    clients_repository::create_discount_decision(
        db,
        tenant_id,
        branch_id,
        ClientDiscountDecisionWrite {
            client_id: request.client_id,
            rule_id,
            service_category: request.service_category,
            segment: &context.segment,
            subtotal_paise: request.subtotal_paise,
            lifetime_value_paise: context.lifetime_value_paise,
            requested_discount_bps: request.requested_discount_bps,
            approved_discount_bps: terms.approved_bps,
            discount_paise: terms.discount_paise,
            remaining_clv_budget_paise: terms.remaining_budget_paise,
            has_membership: context.has_membership,
            has_wallet_balance: context.has_wallet_balance,
            status: terms.status,
            reasons: &reasons,
            actor: request.actor,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to record client discount decision"))
}

pub async fn client_growth(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Value, AppError> {
    let context = clients_repository::discount_context(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load client growth context"))?
        .ok_or_else(|| AppError::not_found("client was not found"))?;
    let custom_segments = clients_repository::custom_segments(db, tenant_id, branch_id, &context)
        .await
        .map_err(|_| AppError::internal("failed to load custom client segments"))?;
    let decisions =
        clients_repository::list_discount_decisions(db, tenant_id, branch_id, client_id)
            .await
            .map_err(|_| AppError::internal("failed to load discount decisions"))?;
    let offers = clients_repository::list_win_back_offers(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load win-back offers"))?;
    let win_back = clients_repository::win_back_summary(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load win-back summary"))?;
    Ok(json!({
        "context": context,
        "customSegments": custom_segments,
        "discountDecisions": decisions,
        "winBack": win_back,
        "offers": offers,
    }))
}

pub async fn memory_graph(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Value, AppError> {
    let client = clients_repository::get(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load client memory root"))?
        .ok_or_else(|| AppError::not_found("client was not found"))?;
    let (
        summary,
        appointments,
        invoices,
        services,
        notes,
        messages,
        reviews,
        extra,
        feedback,
        segments,
    ) = tokio::try_join!(
        clients_repository::summary(db, tenant_id, branch_id, client_id),
        clients_repository::appointment_history(db, tenant_id, branch_id, client_id),
        clients_repository::invoice_history(db, tenant_id, branch_id, client_id),
        clients_repository::service_history(db, tenant_id, branch_id, client_id),
        clients_repository::list_notes(db, tenant_id, branch_id, client_id),
        clients_repository::list_communications(db, tenant_id, branch_id, client_id),
        clients_repository::list_reviews(db, tenant_id, branch_id, client_id),
        clients_repository::memory_relationships(db, tenant_id, branch_id, client_id),
        clients_repository::recommendation_feedback(db, tenant_id, branch_id, client_id),
        clients_repository::segment_history(db, tenant_id, branch_id, client_id),
    )
    .map_err(|_| AppError::internal("failed to build client memory graph"))?;
    let extra = extra.ok_or_else(|| AppError::not_found("client was not found"))?;
    let growth = client_growth(db, tenant_id, branch_id, client_id).await?;
    let ranked_actions = ranked_next_best_actions(ActionSignals {
        primary_action: &summary.next_best_action,
        primary_reason: &summary.next_best_action_reason,
        occasion: &summary.occasion_opportunity,
        inactive_days: summary.inactive_days,
        churn_risk_score: summary.churn_risk_score,
        amount_due_paise: summary.amount_due_paise,
        open_appointments: summary.open_appointments,
        review_sentiment: &summary.review_sentiment,
    });
    Ok(json!({
        "client":client,
        "recommendation":{"action":summary.next_best_action,"reason":summary.next_best_action_reason,"rankedActions":ranked_actions,"feedback":feedback},
        "segment":{"current":summary.rfm_segment,"rfmScore":summary.rfm_score,"churnRiskScore":summary.churn_risk_score,"history":segments},
        "relationships":{
            "appointments":appointments,"services":services,"staff":extra["staff"],"products":extra["products"],
            "invoices":invoices,"memberships":extra["memberships"],"packages":extra["packages"],"reviews":reviews,
            "messages":messages,"offers":growth["offers"],"complaints":extra["complaints"],"preferences":extra["preferences"],"wallet":extra["wallet"],"notes":notes
        },
        "calculatedSnapshot":{"calculatedAt":summary.intelligence_calculated_at}
    }))
}

pub async fn rebuild_memory_graph(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    actor: &str,
) -> Result<Value, AppError> {
    let rebuilt =
        clients_repository::rebuild_client_intelligence(db, tenant_id, branch_id, client_id, actor)
            .await
            .map_err(|_| AppError::internal("failed to rebuild client intelligence"))?;
    if !rebuilt {
        return Err(AppError::not_found("client was not found"));
    }
    memory_graph(db, tenant_id, branch_id, client_id).await
}

#[allow(clippy::too_many_arguments)]
pub async fn record_recommendation_feedback(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    recommendation: &str,
    decision: &str,
    comment: &str,
    actor: &str,
) -> Result<clients_repository::ClientRecommendationFeedbackRecord, AppError> {
    if !matches!(decision, "accepted" | "rejected") || comment.chars().count() > 1_000 {
        return Err(AppError::validation("invalid recommendation feedback"));
    }
    let summary = clients_repository::summary(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to validate client recommendation"))?;
    if recommendation.trim() != summary.next_best_action {
        return Err(AppError::conflict(
            "recommendation changed; reload client intelligence",
        ));
    }
    clients_repository::create_recommendation_feedback(
        db,
        tenant_id,
        branch_id,
        client_id,
        &summary.next_best_action,
        &summary.next_best_action_reason,
        decision,
        comment.trim(),
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to record recommendation feedback"))?
    .ok_or_else(|| AppError::not_found("client was not found"))
}

fn rule_matches(
    rule: &ClientDiscountRuleRecord,
    segment: &str,
    service_category: &str,
    lifetime_value_paise: i64,
    has_membership: bool,
    has_wallet_balance: bool,
) -> bool {
    (rule.segments.is_empty()
        || rule
            .segments
            .iter()
            .any(|value| value.eq_ignore_ascii_case(segment)))
        && (rule.service_categories.is_empty()
            || rule
                .service_categories
                .iter()
                .any(|value| value == "*" || value.eq_ignore_ascii_case(service_category)))
        && lifetime_value_paise >= rule.min_lifetime_value_paise
        && (!has_membership || rule.membership_eligible)
        && (!has_wallet_balance || rule.wallet_eligible)
}

fn discount_terms(
    subtotal_paise: i64,
    requested_bps: i32,
    lifetime_value_paise: i64,
    spent_paise: i64,
    rule: &ClientDiscountRuleRecord,
) -> DiscountTerms {
    let remaining = if rule.clv_budget_bps == 0 {
        0
    } else {
        lifetime_value_paise
            .saturating_mul(rule.clv_budget_bps as i64)
            .saturating_div(10_000)
            .saturating_sub(spent_paise)
            .max(0)
    };
    let budget_bps = if rule.clv_budget_bps == 0 {
        10_000
    } else {
        remaining
            .saturating_mul(10_000)
            .saturating_div(subtotal_paise)
            .clamp(0, 10_000) as i32
    };
    let approved_bps = requested_bps.min(rule.max_discount_bps).min(budget_bps);
    let discount_paise = subtotal_paise.saturating_mul(approved_bps as i64) / 10_000;
    DiscountTerms {
        approved_bps,
        discount_paise,
        remaining_budget_paise: if rule.clv_budget_bps == 0 {
            0
        } else {
            remaining.saturating_sub(discount_paise)
        },
        status: if approved_bps == 0 {
            "rejected"
        } else if rule.approval_above_bps > 0 && approved_bps > rule.approval_above_bps {
            "approval_required"
        } else {
            "approved"
        },
        capped: approved_bps < requested_bps,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        communication_allowed, discount_terms, normalize_phone, ranked_next_best_actions,
        ActionSignals,
    };
    use crate::repositories::clients_repository::ClientDiscountRuleRecord;
    use chrono::Utc;
    use sqlx::PgPool;

    #[sqlx::test(migrations = false)]
    async fn outbound_communication_requires_current_channel_consent(pool: PgPool) {
        sqlx::query(
            "CREATE TABLE clients(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,merged_into_client_id TEXT,whatsapp_opt_in BOOLEAN,sms_opt_in BOOLEAN,email_opt_in BOOLEAN)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO clients VALUES('client-1','tenant-1','branch-1',NULL,FALSE,FALSE,TRUE)",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert!(
            !communication_allowed(&pool, "tenant-1", "branch-1", "client-1", "whatsapp")
                .await
                .unwrap()
        );
        assert!(
            communication_allowed(&pool, "tenant-1", "branch-1", "client-1", "email")
                .await
                .unwrap()
        );
        assert!(
            !communication_allowed(&pool, "tenant-1", "branch-2", "client-1", "email")
                .await
                .unwrap()
        );

        sqlx::query("UPDATE clients SET email_opt_in=FALSE WHERE id='client-1'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            !communication_allowed(&pool, "tenant-1", "branch-1", "client-1", "email")
                .await
                .unwrap()
        );
    }

    #[test]
    fn phone_normalization_is_stable_for_indian_and_international_numbers() {
        assert_eq!(normalize_phone("09876 543210").unwrap(), "+919876543210");
        assert_eq!(
            normalize_phone("+44 20 7946 0958").unwrap(),
            "+442079460958"
        );
        assert!(normalize_phone("123").is_err());
    }

    #[test]
    fn discount_terms_enforce_clv_cap_and_approval_threshold() {
        let rule = ClientDiscountRuleRecord {
            id: "rule".into(),
            name: "Retention".into(),
            segments: vec![],
            service_categories: vec![],
            min_lifetime_value_paise: 0,
            max_discount_bps: 2_000,
            clv_budget_bps: 500,
            approval_above_bps: 1_000,
            membership_eligible: true,
            wallet_eligible: true,
            active: true,
            priority: 1,
            version: 1,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let terms = discount_terms(100_000, 2_500, 2_000_000, 0, &rule);
        assert_eq!(terms.approved_bps, 2_000);
        assert_eq!(terms.discount_paise, 20_000);
        assert_eq!(terms.status, "approval_required");
        assert!(terms.capped);
    }

    #[test]
    fn ranked_actions_keep_primary_first_and_add_explainable_alternatives() {
        let actions = ranked_next_best_actions(ActionSignals {
            primary_action: "Start win-back outreach",
            primary_reason: "120 inactive days",
            occasion: "",
            inactive_days: 120,
            churn_risk_score: 82,
            amount_due_paise: 5_000,
            open_appointments: 0,
            review_sentiment: "negative",
        });
        assert_eq!(actions[0].action, "Start win-back outreach");
        assert_eq!(actions[0].rank, 1);
        assert!(actions.iter().any(|action| {
            action.action == "Start retention outreach" && action.reason == "Churn risk score 82"
        }));
        assert_eq!(
            actions
                .iter()
                .filter(|action| action.action == "Start win-back outreach")
                .count(),
            1
        );
    }
}
