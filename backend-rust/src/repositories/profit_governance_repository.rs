use chrono::NaiveDate;
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool};

use crate::models::profit_governance::{
    GovernanceApproval, GovernanceAuditEvent, GovernanceDecision, GovernanceRule,
    GovernanceRuleSaveRequest, GovernanceSummary, ProfitAction, ProfitActionCreateRequest,
};

const RULE_COLUMNS: &str = "id, rule_type, title, description, enabled, min_margin_bps, max_discount_bps, max_impact_paise, approval_required, auto_execute_allowed, audit_required, severity, created_by_user_id, updated_by_user_id, created_at, updated_at";
const DECISION_COLUMNS: &str = "id, rule_id, decision_type, source_type, source_id, action_type, decision, status, gross_amount_paise, discount_paise, product_cost_paise, staff_cost_paise, membership_redemption_paise, estimated_profit_paise, margin_bps, discount_bps, impact_paise, reason_codes, message, requested_by_user_id, idempotency_key, created_at, updated_at";
const APPROVAL_COLUMNS: &str = "approval.id, approval.decision_id, decision.decision_type, decision.source_type, decision.source_id, decision.action_type, decision.decision, approval.status, decision.gross_amount_paise, decision.discount_paise, decision.estimated_profit_paise, decision.margin_bps, decision.discount_bps, decision.impact_paise, decision.reason_codes, decision.message, approval.requested_by_user_id, approval.reviewed_by_user_id, approval.review_note, approval.requested_at, approval.reviewed_at";
const ACTION_COLUMNS: &str = "action.id, action.governance_decision_id, approval.id AS approval_id, action.action_type, action.title, action.message, action.impact_paise, action.priority, action.status, action.source_type, action.source_id, action.action_key, action.period_start, action.period_end, action.rule_key, action.owner_user_id, COALESCE(NULLIF(owner.full_name,''), owner.email) AS owner_name, action.due_at, action.sla_minutes, action.notes, action.evidence_json, action.baseline_impact_paise, action.expected_impact_paise, action.realized_impact_paise, action.recurrence_key, action.occurrence_number, action.generated_by, action.last_observed_at, action.payload_json, action.created_by_user_id, action.reviewed_by_user_id, action.completed_by_user_id, action.created_at, action.updated_at, action.approved_at, action.completed_at, action.dismissed_at";

#[derive(FromRow)]
pub struct ProfitScanTarget {
    pub tenant_id: String,
    pub branch_id: String,
}

pub struct AutomatedActionObservation<'a> {
    pub governance_decision_id: &'a str,
    pub action_key: &'a str,
    pub recurrence_key: &'a str,
    pub rule_key: &'a str,
    pub action_type: &'a str,
    pub title: &'a str,
    pub message: &'a str,
    pub impact_paise: i64,
    pub priority: &'a str,
    pub source_type: &'a str,
    pub source_id: &'a str,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub owner_user_id: &'a str,
    pub sla_minutes: i32,
    pub evidence: Value,
}

pub struct NewGovernanceDecision<'a> {
    pub rule_id: Option<&'a str>,
    pub decision_type: &'a str,
    pub source_type: &'a str,
    pub source_id: &'a str,
    pub action_type: &'a str,
    pub decision: &'a str,
    pub status: &'a str,
    pub gross_amount_paise: i64,
    pub discount_paise: i64,
    pub product_cost_paise: i64,
    pub staff_cost_paise: i64,
    pub membership_redemption_paise: i64,
    pub estimated_profit_paise: i64,
    pub margin_bps: i64,
    pub discount_bps: i64,
    pub impact_paise: i64,
    pub reason_codes: Value,
    pub message: &'a str,
    pub requested_by_user_id: &'a str,
    pub idempotency_key: &'a str,
}

pub struct RecordedEvaluation {
    pub decision: GovernanceDecision,
    pub approval: Option<GovernanceApproval>,
    pub replayed: bool,
}

pub enum ReviewOutcome {
    NotFound,
    NotPending,
    SelfApproval,
    Reviewed(GovernanceApproval),
}

pub enum ActionTransitionOutcome {
    NotFound,
    InvalidStatus,
    SelfApproval,
    Updated(ProfitAction),
}

#[derive(FromRow)]
struct ApprovalLock {
    id: String,
    decision_id: String,
    status: String,
    requested_by_user_id: String,
    rule_id: Option<String>,
}

#[derive(FromRow)]
struct ActionLock {
    id: String,
    status: String,
    created_by_user_id: String,
}

pub async fn list_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<GovernanceRule>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {RULE_COLUMNS} FROM profit_governance_rules WHERE tenant_id=$1 AND branch_id=$2 ORDER BY rule_type"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn save_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    payload: &GovernanceRuleSaveRequest,
) -> Result<GovernanceRule, sqlx::Error> {
    let mut tx = db.begin().await?;
    let rule: GovernanceRule = sqlx::query_as(&format!(
        r#"
        INSERT INTO profit_governance_rules (
          tenant_id, branch_id, rule_type, title, description, enabled,
          min_margin_bps, max_discount_bps, max_impact_paise,
          approval_required, auto_execute_allowed, audit_required, severity,
          created_by_user_id, updated_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
        ON CONFLICT (tenant_id, branch_id, rule_type) DO UPDATE SET
          title=EXCLUDED.title,
          description=EXCLUDED.description,
          enabled=EXCLUDED.enabled,
          min_margin_bps=EXCLUDED.min_margin_bps,
          max_discount_bps=EXCLUDED.max_discount_bps,
          max_impact_paise=EXCLUDED.max_impact_paise,
          approval_required=EXCLUDED.approval_required,
          auto_execute_allowed=EXCLUDED.auto_execute_allowed,
          audit_required=EXCLUDED.audit_required,
          severity=EXCLUDED.severity,
          updated_by_user_id=EXCLUDED.updated_by_user_id,
          updated_at=NOW()
        RETURNING {RULE_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&payload.rule_type)
    .bind(payload.title.trim())
    .bind(payload.description.as_deref().unwrap_or_default().trim())
    .bind(payload.enabled.unwrap_or(true))
    .bind(payload.min_margin_bps)
    .bind(payload.max_discount_bps)
    .bind(payload.max_impact_paise)
    .bind(payload.approval_required.unwrap_or(true))
    .bind(payload.auto_execute_allowed.unwrap_or(false))
    .bind(payload.audit_required.unwrap_or(true))
    .bind(&payload.severity)
    .bind(actor_user_id)
    .fetch_one(&mut *tx)
    .await?;

    insert_audit(
        &mut tx,
        tenant_id,
        branch_id,
        None,
        Some(&rule.id),
        "rule_saved",
        actor_user_id,
        json!({
            "ruleType": rule.rule_type,
            "enabled": rule.enabled,
            "minMarginBps": rule.min_margin_bps,
            "maxDiscountBps": rule.max_discount_bps,
            "maxImpactPaise": rule.max_impact_paise,
            "approvalRequired": rule.approval_required,
            "autoExecuteAllowed": rule.auto_execute_allowed,
            "auditRequired": rule.audit_required,
            "severity": rule.severity
        }),
    )
    .await?;
    tx.commit().await?;
    Ok(rule)
}

pub async fn record_evaluation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: NewGovernanceDecision<'_>,
) -> Result<RecordedEvaluation, sqlx::Error> {
    let mut tx = db.begin().await?;
    let inserted: Option<GovernanceDecision> = sqlx::query_as(&format!(
        r#"
        INSERT INTO profit_governance_decisions (
          tenant_id, branch_id, rule_id, decision_type, source_type, source_id,
          action_type, decision, status, gross_amount_paise, discount_paise,
          product_cost_paise, staff_cost_paise, membership_redemption_paise,
          estimated_profit_paise, margin_bps, discount_bps, impact_paise,
          reason_codes, message, requested_by_user_id, idempotency_key
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
        )
        ON CONFLICT (tenant_id, branch_id, idempotency_key) DO NOTHING
        RETURNING {DECISION_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(input.rule_id)
    .bind(input.decision_type)
    .bind(input.source_type)
    .bind(input.source_id)
    .bind(input.action_type)
    .bind(input.decision)
    .bind(input.status)
    .bind(input.gross_amount_paise)
    .bind(input.discount_paise)
    .bind(input.product_cost_paise)
    .bind(input.staff_cost_paise)
    .bind(input.membership_redemption_paise)
    .bind(input.estimated_profit_paise)
    .bind(input.margin_bps)
    .bind(input.discount_bps)
    .bind(input.impact_paise)
    .bind(&input.reason_codes)
    .bind(input.message)
    .bind(input.requested_by_user_id)
    .bind(input.idempotency_key)
    .fetch_optional(&mut *tx)
    .await?;

    let replayed = inserted.is_none();
    let decision: GovernanceDecision = match inserted {
        Some(decision) => decision,
        None => sqlx::query_as(&format!(
            "SELECT {DECISION_COLUMNS} FROM profit_governance_decisions WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3"
        ))
        .bind(tenant_id)
        .bind(branch_id)
        .bind(input.idempotency_key)
        .fetch_one(&mut *tx)
        .await?,
    };

    if !replayed {
        insert_audit(
            &mut tx,
            tenant_id,
            branch_id,
            Some(&decision.id),
            decision.rule_id.as_deref(),
            "evaluated",
            input.requested_by_user_id,
            json!({
                "decision": decision.decision,
                "status": decision.status,
                "decisionType": decision.decision_type,
                "sourceType": decision.source_type,
                "sourceId": decision.source_id,
                "actionType": decision.action_type,
                "reasonCodes": decision.reason_codes,
                "grossAmountPaise": decision.gross_amount_paise,
                "discountPaise": decision.discount_paise,
                "estimatedProfitPaise": decision.estimated_profit_paise,
                "marginBps": decision.margin_bps,
                "discountBps": decision.discount_bps,
                "impactPaise": decision.impact_paise
            }),
        )
        .await?;
        if decision.status == "pending_approval" {
            sqlx::query(
                "INSERT INTO profit_governance_approvals (tenant_id, branch_id, decision_id, requested_by_user_id) VALUES ($1,$2,$3,$4)",
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(&decision.id)
            .bind(input.requested_by_user_id)
            .execute(&mut *tx)
            .await?;
            insert_audit(
                &mut tx,
                tenant_id,
                branch_id,
                Some(&decision.id),
                decision.rule_id.as_deref(),
                "approval_requested",
                input.requested_by_user_id,
                json!({ "reasonCodes": decision.reason_codes }),
            )
            .await?;
        }
        if decision.decision_type == "action"
            || matches!(decision.status.as_str(), "pending_approval" | "blocked")
        {
            let action_type = if decision.action_type.is_empty() {
                "profit_governance_approval"
            } else {
                decision.action_type.as_str()
            };
            let title = if decision.decision_type == "discount" {
                "Review margin-safe discount"
            } else {
                "Review profit action"
            };
            let inserted_action_id = sqlx::query_scalar::<_, String>(
                r#"
                INSERT INTO profit_action_queue (
                  tenant_id, branch_id, governance_decision_id, action_type, title,
                  message, impact_paise, priority, source_type, source_id,
                  action_key, rule_key, owner_user_id, due_at, sla_minutes,
                  baseline_impact_paise, expected_impact_paise, recurrence_key,
                  generated_by, last_observed_at, payload_json, created_by_user_id,
                  status, approved_at
                ) VALUES (
                  $1,$2,$3,$4,$5,$6,$7,$8,'governance_decision',$3,
                  'governance:'||$3,'governance',$10,
                  NOW()+MAKE_INTERVAL(mins => CASE WHEN $8='high' THEN 1440 ELSE 4320 END),
                  CASE WHEN $8='high' THEN 1440 ELSE 4320 END,$7,$7,
                  'governance:'||$4,'governance',NOW(),
                  jsonb_build_object('decisionId',$3,'reasonCodes',$9::JSONB),$10,
                  CASE WHEN $11='allowed' THEN 'approved' ELSE 'pending' END,
                  CASE WHEN $11='allowed' THEN NOW() ELSE NULL END
                )
                ON CONFLICT DO NOTHING
                RETURNING id
                "#,
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(&decision.id)
            .bind(action_type)
            .bind(title)
            .bind(&decision.message)
            .bind(decision.impact_paise)
            .bind(if decision.status == "blocked" {
                "high"
            } else {
                "medium"
            })
            .bind(decision.reason_codes.to_string())
            .bind(input.requested_by_user_id)
            .bind(&decision.status)
            .fetch_optional(&mut *tx)
            .await?;
            if let Some(action_id) = inserted_action_id {
                insert_audit(
                    &mut tx,
                    tenant_id,
                    branch_id,
                    Some(&decision.id),
                    decision.rule_id.as_deref(),
                    "action_created",
                    input.requested_by_user_id,
                    json!({ "actionId": action_id, "priority": if decision.status == "blocked" { "high" } else { "medium" } }),
                )
                .await?;
            }
        }
    }

    let approval = approval_by_decision(&mut tx, tenant_id, branch_id, &decision.id).await?;
    tx.commit().await?;
    Ok(RecordedEvaluation {
        decision,
        approval,
        replayed,
    })
}

pub async fn list_approvals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
    limit: i64,
) -> Result<Vec<GovernanceApproval>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT {APPROVAL_COLUMNS}
        FROM profit_governance_approvals approval
        JOIN profit_governance_decisions decision ON decision.id=approval.decision_id
        WHERE approval.tenant_id=$1 AND approval.branch_id=$2
          AND ($3='' OR approval.status=$3)
        ORDER BY approval.requested_at DESC
        LIMIT $4
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn review_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    approval_id: &str,
    actor_user_id: &str,
    outcome: &str,
    note: &str,
) -> Result<ReviewOutcome, sqlx::Error> {
    let mut tx = db.begin().await?;
    let locked = sqlx::query_as::<_, ApprovalLock>(
        "SELECT approval.id, approval.decision_id, approval.status, approval.requested_by_user_id, decision.rule_id FROM profit_governance_approvals approval JOIN profit_governance_decisions decision ON decision.id=approval.decision_id WHERE approval.tenant_id=$1 AND approval.branch_id=$2 AND approval.id=$3 FOR UPDATE OF approval",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(approval_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(locked) = locked else {
        tx.rollback().await?;
        return Ok(ReviewOutcome::NotFound);
    };
    if locked.status != "pending" {
        tx.rollback().await?;
        return Ok(ReviewOutcome::NotPending);
    }
    if locked.requested_by_user_id == actor_user_id {
        tx.rollback().await?;
        return Ok(ReviewOutcome::SelfApproval);
    }

    sqlx::query(
        "UPDATE profit_governance_approvals SET status=$4, reviewed_by_user_id=$5, review_note=$6, reviewed_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&locked.id)
    .bind(outcome)
    .bind(actor_user_id)
    .bind(note)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE profit_governance_decisions SET status=$4, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&locked.decision_id)
    .bind(outcome)
    .execute(&mut *tx)
    .await?;
    let queue_status = if outcome == "approved" {
        "approved"
    } else {
        "dismissed"
    };
    let queue_event = if outcome == "approved" {
        "action_approved"
    } else {
        "action_dismissed"
    };
    if let Some(action_id) = sqlx::query_scalar::<_, String>(
        "UPDATE profit_action_queue SET status=$4, reviewed_by_user_id=$5, approved_at=CASE WHEN $4='approved' THEN NOW() ELSE approved_at END, dismissed_at=CASE WHEN $4='dismissed' THEN NOW() ELSE dismissed_at END, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND governance_decision_id=$3 AND status='pending' RETURNING id",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&locked.decision_id)
    .bind(queue_status)
    .bind(actor_user_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        insert_audit(
            &mut tx,
            tenant_id,
            branch_id,
            Some(&locked.decision_id),
            locked.rule_id.as_deref(),
            queue_event,
            actor_user_id,
            json!({ "actionId": action_id, "note": note }),
        )
        .await?;
    }
    insert_audit(
        &mut tx,
        tenant_id,
        branch_id,
        Some(&locked.decision_id),
        locked.rule_id.as_deref(),
        outcome,
        actor_user_id,
        json!({ "approvalId": locked.id, "note": note }),
    )
    .await?;
    let approval = approval_by_decision(&mut tx, tenant_id, branch_id, &locked.decision_id)
        .await?
        .expect("approval exists while locked");
    tx.commit().await?;
    Ok(ReviewOutcome::Reviewed(approval))
}

pub async fn list_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    event_type: &str,
    limit: i64,
) -> Result<Vec<GovernanceAuditEvent>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, decision_id, rule_id, event_type, actor_user_id, details_json, created_at
        FROM profit_governance_audit_events
        WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR event_type=$3)
        ORDER BY created_at DESC
        LIMIT $4
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(event_type)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<GovernanceSummary, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT
          (SELECT COUNT(*)::BIGINT FROM profit_governance_rules WHERE tenant_id=$1 AND branch_id=$2) AS configured_rules,
          (SELECT COUNT(*)::BIGINT FROM profit_governance_rules WHERE tenant_id=$1 AND branch_id=$2 AND enabled) AS enabled_rules,
          (SELECT COUNT(*)::BIGINT FROM profit_governance_decisions WHERE tenant_id=$1 AND branch_id=$2) AS total_evaluations,
          (SELECT COUNT(*)::BIGINT FROM profit_governance_approvals WHERE tenant_id=$1 AND branch_id=$2 AND status='pending') AS pending_approvals,
          (SELECT COUNT(*)::BIGINT FROM profit_governance_decisions WHERE tenant_id=$1 AND branch_id=$2 AND status='approved') AS approved,
          (SELECT COUNT(*)::BIGINT FROM profit_governance_decisions WHERE tenant_id=$1 AND branch_id=$2 AND status='rejected') AS rejected,
          (SELECT COUNT(*)::BIGINT FROM profit_governance_decisions WHERE tenant_id=$1 AND branch_id=$2 AND status='blocked') AS blocked
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(db)
    .await
}

pub async fn claim_profit_scan_targets(
    db: &PgPool,
    limit: i64,
) -> Result<Vec<ProfitScanTarget>, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO profit_action_scan_state (tenant_id, branch_id)
        SELECT tenant.id::TEXT, branch.id::TEXT
        FROM branches branch
        JOIN tenants tenant ON tenant.id=branch.tenant_id
        WHERE branch.active AND tenant.status='active'
        ON CONFLICT (tenant_id, branch_id) DO NOTHING
        "#,
    )
    .execute(&mut *tx)
    .await?;
    let targets = sqlx::query_as::<_, ProfitScanTarget>(
        r#"
        WITH due AS (
          SELECT tenant_id, branch_id
          FROM profit_action_scan_state
          WHERE next_scan_at<=NOW() AND (locked_until IS NULL OR locked_until<NOW())
          ORDER BY next_scan_at, tenant_id, branch_id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE profit_action_scan_state state
        SET locked_until=NOW()+INTERVAL '10 minutes', last_started_at=NOW(), last_error=''
        FROM due
        WHERE state.tenant_id=due.tenant_id AND state.branch_id=due.branch_id
        RETURNING state.tenant_id, state.branch_id
        "#,
    )
    .bind(limit)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(targets)
}

pub async fn finish_profit_scan(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
    action_count: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE profit_action_scan_state
        SET next_scan_at=NOW()+INTERVAL '15 minutes', locked_until=NULL,
            last_completed_at=NOW(), last_period_start=$3, last_period_end=$4,
            last_action_count=$5, last_error=''
        WHERE tenant_id=$1 AND branch_id=$2
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(period_start)
    .bind(period_end)
    .bind(action_count)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn fail_profit_scan(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    error: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE profit_action_scan_state
        SET next_scan_at=NOW()+INTERVAL '5 minutes', locked_until=NULL, last_error=$3
        WHERE tenant_id=$1 AND branch_id=$2
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(error.chars().take(1000).collect::<String>())
    .execute(db)
    .await?;
    Ok(())
}

pub async fn profit_action_owner(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT users.id
        FROM users
        LEFT JOIN roles ON roles.tenant_id=users.tenant_id AND roles.id=users.role_id
        WHERE users.tenant_id=$1 AND users.active
          AND (users.branch_id=$2 OR users.branch_id IS NULL)
        ORDER BY
          CASE REGEXP_REPLACE(LOWER(COALESCE(roles.name,users.role_name)), '[-_ ]', '', 'g')
            WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'analyst' THEN 3 ELSE 4 END,
          CASE WHEN users.branch_id=$2 THEN 0 ELSE 1 END,
          users.created_at, users.id
        LIMIT 1
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn user_can_own_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE tenant_id=$1 AND id=$3 AND active AND (branch_id=$2 OR branch_id IS NULL))",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .fetch_one(db)
    .await
}

pub async fn list_actions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
    priority: &str,
    limit: i64,
) -> Result<Vec<ProfitAction>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT {ACTION_COLUMNS}
        FROM profit_action_queue action
        LEFT JOIN profit_governance_approvals approval
          ON approval.decision_id=action.governance_decision_id
        LEFT JOIN users owner
          ON owner.tenant_id=action.tenant_id AND owner.id=action.owner_user_id
        WHERE action.tenant_id=$1 AND action.branch_id=$2
          AND ($3='all' OR ($3='active' AND action.status NOT IN ('completed','dismissed')) OR action.status=$3)
          AND ($4='' OR action.priority=$4)
        ORDER BY CASE action.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                 action.impact_paise DESC, action.updated_at DESC
        LIMIT $5
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .bind(priority)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn action_by_id(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action_id: &str,
) -> Result<Option<ProfitAction>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT {ACTION_COLUMNS}
        FROM profit_action_queue action
        LEFT JOIN profit_governance_approvals approval
          ON approval.decision_id=action.governance_decision_id
        LEFT JOIN users owner
          ON owner.tenant_id=action.tenant_id AND owner.id=action.owner_user_id
        WHERE action.tenant_id=$1 AND action.branch_id=$2 AND action.id=$3
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(action_id)
    .fetch_optional(db)
    .await
}

pub async fn action_by_key(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action_key: &str,
) -> Result<Option<ProfitAction>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT {ACTION_COLUMNS}
        FROM profit_action_queue action
        LEFT JOIN profit_governance_approvals approval
          ON approval.decision_id=action.governance_decision_id
        LEFT JOIN users owner
          ON owner.tenant_id=action.tenant_id AND owner.id=action.owner_user_id
        WHERE action.tenant_id=$1 AND action.branch_id=$2 AND action.action_key=$3
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(action_key)
    .fetch_optional(db)
    .await
}

pub async fn refresh_automated_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action_key: &str,
    title: &str,
    message: &str,
    impact_paise: i64,
    evidence: Value,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query(
        r#"
        UPDATE profit_action_queue
        SET title=$4, message=$5, impact_paise=$6,
            realized_impact_paise=GREATEST(baseline_impact_paise-$6,0),
            evidence_json=evidence_json || $7, last_observed_at=NOW(), updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND action_key=$3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(action_key)
    .bind(title)
    .bind(message)
    .bind(impact_paise)
    .bind(evidence)
    .execute(db)
    .await?
    .rows_affected()
        == 1)
}

pub async fn enrich_automated_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    observation: AutomatedActionObservation<'_>,
) -> Result<Option<ProfitAction>, sqlx::Error> {
    let action_id = sqlx::query_scalar::<_, String>(
        r#"
        UPDATE profit_action_queue action
        SET action_type=$5, title=$6, message=$7, impact_paise=$8, priority=$9,
            source_type=$10, source_id=$11, action_key=$12, period_start=$13,
            period_end=$14, rule_key=$15, owner_user_id=$16,
            due_at=COALESCE(action.due_at,NOW()+MAKE_INTERVAL(mins => $17)),
            sla_minutes=$17, evidence_json=$18, baseline_impact_paise=$8,
            expected_impact_paise=$8, recurrence_key=$19,
            occurrence_number=1+COALESCE((
              SELECT MAX(previous.occurrence_number)
              FROM profit_action_queue previous
              WHERE previous.tenant_id=$1 AND previous.branch_id=$2
                AND previous.recurrence_key=$19 AND previous.id<>action.id
            ),0),
            generated_by='automated_scan', last_observed_at=NOW(), updated_at=NOW()
        WHERE action.tenant_id=$1 AND action.branch_id=$2
          AND action.governance_decision_id=$3 AND action.created_by_user_id=$4
        RETURNING action.id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(observation.governance_decision_id)
    .bind(actor_user_id)
    .bind(observation.action_type)
    .bind(observation.title)
    .bind(observation.message)
    .bind(observation.impact_paise)
    .bind(observation.priority)
    .bind(observation.source_type)
    .bind(observation.source_id)
    .bind(observation.action_key)
    .bind(observation.period_start)
    .bind(observation.period_end)
    .bind(observation.rule_key)
    .bind(observation.owner_user_id)
    .bind(observation.sla_minutes)
    .bind(&observation.evidence)
    .bind(observation.recurrence_key)
    .fetch_optional(db)
    .await?;
    match action_id {
        Some(id) => action_by_id(db, tenant_id, branch_id, &id).await,
        None => action_by_key(db, tenant_id, branch_id, observation.action_key).await,
    }
}

pub async fn create_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    payload: &ProfitActionCreateRequest,
) -> Result<Option<ProfitAction>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let action_id = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO profit_action_queue (
          tenant_id, branch_id, action_type, title, message, impact_paise,
          priority, source_type, source_id, action_key, period_start, period_end,
          rule_key, owner_user_id, due_at, sla_minutes, notes, evidence_json,
          baseline_impact_paise, expected_impact_paise, recurrence_key, generated_by,
          last_observed_at, payload_json, created_by_user_id
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
          COALESCE($15,NOW()+MAKE_INTERVAL(mins => $16)),$16,$17,$18,$19,$20,$21,$22,
          NOW(),$23,$24
        )
        ON CONFLICT (tenant_id, branch_id, action_key) DO NOTHING
        RETURNING id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&payload.action_type)
    .bind(payload.title.trim())
    .bind(payload.message.as_deref().unwrap_or_default().trim())
    .bind(payload.impact_paise.unwrap_or(0))
    .bind(payload.priority.as_deref().unwrap_or("medium"))
    .bind(&payload.source_type)
    .bind(&payload.source_id)
    .bind(payload.action_key.as_deref().unwrap_or_default())
    .bind(payload.period_start)
    .bind(payload.period_end)
    .bind(payload.rule_key.as_deref().unwrap_or("manual"))
    .bind(payload.owner_user_id.as_deref().unwrap_or(actor_user_id))
    .bind(payload.due_at)
    .bind(payload.sla_minutes.unwrap_or(4320))
    .bind(payload.notes.as_deref().unwrap_or_default().trim())
    .bind(payload.evidence.clone().unwrap_or_else(|| json!({})))
    .bind(
        payload
            .baseline_impact_paise
            .unwrap_or(payload.impact_paise.unwrap_or(0)),
    )
    .bind(
        payload
            .expected_impact_paise
            .unwrap_or(payload.impact_paise.unwrap_or(0)),
    )
    .bind(payload.recurrence_key.as_deref())
    .bind(payload.generated_by.as_deref().unwrap_or("manual"))
    .bind(payload.payload.clone().unwrap_or_else(|| json!({})))
    .bind(actor_user_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(action_id) = action_id else {
        tx.rollback().await?;
        return Ok(None);
    };
    insert_audit(
        &mut tx,
        tenant_id,
        branch_id,
        None,
        None,
        "action_created",
        actor_user_id,
        json!({ "actionId": action_id, "sourceType": payload.source_type, "sourceId": payload.source_id }),
    )
    .await?;
    tx.commit().await?;
    action_by_id(db, tenant_id, branch_id, &action_id).await
}

pub async fn transition_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action_id: &str,
    actor_user_id: &str,
    next_status: &str,
    note: &str,
    realized_impact_paise: Option<i64>,
    evidence: Option<Value>,
) -> Result<ActionTransitionOutcome, sqlx::Error> {
    let mut tx = db.begin().await?;
    let locked = sqlx::query_as::<_, ActionLock>(
        "SELECT id, status, created_by_user_id FROM profit_action_queue WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(action_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(locked) = locked else {
        tx.rollback().await?;
        return Ok(ActionTransitionOutcome::NotFound);
    };
    let valid = matches!(
        (locked.status.as_str(), next_status),
        ("pending", "approved")
            | ("pending", "dismissed")
            | ("approved", "completed")
            | ("approved", "dismissed")
    );
    if !valid {
        tx.rollback().await?;
        return Ok(ActionTransitionOutcome::InvalidStatus);
    }
    if next_status == "approved" && locked.created_by_user_id == actor_user_id {
        tx.rollback().await?;
        return Ok(ActionTransitionOutcome::SelfApproval);
    }
    sqlx::query(
        "UPDATE profit_action_queue SET status=$4, reviewed_by_user_id=CASE WHEN $4 IN ('approved','dismissed') THEN $5 ELSE reviewed_by_user_id END, completed_by_user_id=CASE WHEN $4='completed' THEN $5 ELSE completed_by_user_id END, approved_at=CASE WHEN $4='approved' THEN NOW() ELSE approved_at END, completed_at=CASE WHEN $4='completed' THEN NOW() ELSE completed_at END, dismissed_at=CASE WHEN $4='dismissed' THEN NOW() ELSE dismissed_at END, realized_impact_paise=CASE WHEN $4='completed' THEN COALESCE($6,realized_impact_paise) ELSE realized_impact_paise END, evidence_json=CASE WHEN $7::JSONB IS NULL THEN evidence_json ELSE evidence_json || $7::JSONB END, notes=CASE WHEN $8='' THEN notes WHEN notes='' THEN $8 ELSE notes || E'\n' || $8 END, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&locked.id)
    .bind(next_status)
    .bind(actor_user_id)
    .bind(realized_impact_paise)
    .bind(evidence)
    .bind(note)
    .execute(&mut *tx)
    .await?;
    insert_audit(
        &mut tx,
        tenant_id,
        branch_id,
        None,
        None,
        match next_status {
            "approved" => "action_approved",
            "completed" => "action_completed",
            _ => "action_dismissed",
        },
        actor_user_id,
        json!({ "actionId": locked.id, "note": note }),
    )
    .await?;
    tx.commit().await?;
    let action = action_by_id(db, tenant_id, branch_id, action_id)
        .await?
        .expect("action exists after scoped update");
    Ok(ActionTransitionOutcome::Updated(action))
}

pub async fn rollback_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action_id: &str,
    actor_user_id: &str,
    note: &str,
) -> Result<ActionTransitionOutcome, sqlx::Error> {
    let mut tx = db.begin().await?;
    let locked = sqlx::query_as::<_, (String, String, Option<String>, Option<String>)>(
        r#"SELECT action.id, action.status, action.governance_decision_id, approval.id
             FROM profit_action_queue action
             LEFT JOIN profit_governance_approvals approval
               ON approval.tenant_id=action.tenant_id
              AND approval.branch_id=action.branch_id
              AND approval.decision_id=action.governance_decision_id
            WHERE action.tenant_id=$1 AND action.branch_id=$2 AND action.id=$3
            FOR UPDATE OF action"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(action_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((id, previous_status, decision_id, approval_id)) = locked else {
        tx.rollback().await?;
        return Ok(ActionTransitionOutcome::NotFound);
    };
    if !matches!(
        previous_status.as_str(),
        "approved" | "completed" | "dismissed"
    ) {
        tx.rollback().await?;
        return Ok(ActionTransitionOutcome::InvalidStatus);
    }
    sqlx::query(
        r#"UPDATE profit_action_queue
              SET status='pending', reviewed_by_user_id=NULL, completed_by_user_id=NULL,
                  approved_at=NULL, completed_at=NULL, dismissed_at=NULL,
                  realized_impact_paise=0,
                  notes=CASE WHEN notes='' THEN $4 ELSE notes || E'\n' || $4 END,
                  updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&id)
    .bind(note)
    .execute(&mut *tx)
    .await?;
    if let Some(approval_id) = approval_id {
        sqlx::query(
            "UPDATE profit_governance_approvals SET status='pending', reviewed_by_user_id=NULL, review_note='', reviewed_at=NULL WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(approval_id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(decision_id) = decision_id {
        sqlx::query(
            "UPDATE profit_governance_decisions SET status='pending', updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(decision_id)
        .execute(&mut *tx)
        .await?;
    }
    insert_audit(
        &mut tx,
        tenant_id,
        branch_id,
        None,
        None,
        "action_rolled_back",
        actor_user_id,
        json!({ "actionId": id, "previousStatus": previous_status, "note": note }),
    )
    .await?;
    tx.commit().await?;
    Ok(ActionTransitionOutcome::Updated(
        action_by_id(db, tenant_id, branch_id, action_id)
            .await?
            .expect("action exists after scoped rollback"),
    ))
}

async fn approval_by_decision(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    branch_id: &str,
    decision_id: &str,
) -> Result<Option<GovernanceApproval>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT {APPROVAL_COLUMNS}
        FROM profit_governance_approvals approval
        JOIN profit_governance_decisions decision ON decision.id=approval.decision_id
        WHERE approval.tenant_id=$1 AND approval.branch_id=$2 AND approval.decision_id=$3
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(decision_id)
    .fetch_optional(&mut **tx)
    .await
}

async fn insert_audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    branch_id: &str,
    decision_id: Option<&str>,
    rule_id: Option<&str>,
    event_type: &str,
    actor_user_id: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO profit_governance_audit_events (tenant_id, branch_id, decision_id, rule_id, event_type, actor_user_id, details_json) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(decision_id)
    .bind(rule_id)
    .bind(event_type)
    .bind(actor_user_id)
    .bind(details)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
