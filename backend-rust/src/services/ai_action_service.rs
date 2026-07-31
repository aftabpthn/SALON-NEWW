//! Approval-gated CRM actions.
//!
//! The copilot never performs a change on its own. It raises a *draft* saying
//! exactly what would happen; a person confirms it; only then does the CRM
//! screen open with those values prefilled.
//!
//! Two rules give that teeth:
//!
//! * **The allow-list is a schema constraint, not a convention.** Nothing that
//!   moves money, publishes an offer, sends a campaign, confirms a booking,
//!   cancels a membership or touches payroll is in it. Those operations are not
//!   gated here — they are absent, and a test asserts they stay absent.
//! * **Permission and state are re-checked at confirm time, not trusted from
//!   draft time.** A role can be revoked between the two, so the check that
//!   matters is the one at the moment of approval.
//!
//! Confirming twice is safe, and safe in three different ways because there are
//! three different ways it happens:
//!
//! * **The same key, sent again.** The idempotency key is unique per tenant and
//!   branch, so a replayed confirmation returns the first result and records a
//!   `replayed` audit entry instead of acting again.
//! * **Two people at once.** A confirmation claims the draft (`executing`)
//!   before anything is written, and only one caller can record the approval.
//! * **A crash mid-flight.** The CRM record carries the draft's id under a
//!   unique index, so the retry after a crash finds the record the dead run
//!   created rather than writing a second one.
//!
//! Cancellation only touches an unclaimed draft, so a confirmation that has
//! begun cannot be cancelled out from under itself: either the cancel lands
//! first and nothing is written, or the claim lands first and the cancel is
//! refused.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    models::common::AppError, repositories::ai_action_repository as action_repository,
    services::staff_advanced_service,
};

/// The actions the copilot may draft. Every one either creates a *draft* record
/// or opens a screen; none of them completes a business transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionKind {
    CreateOfferDraft,
    CreateCampaignDraft,
    CreateWhatsAppDraft,
    CreateFollowUpTask,
    PrepareBookingDraft,
    PrepareMembershipRenewal,
    OpenStaffReport,
    OpenClientProfile,
    OpenServiceReport,
    OpenMembership,
    ContinueBilling,
    /// A coaching task for a staff member, written to the CRM's own task list.
    CreateCoachingTask,
    /// A reorder proposal, prepared for the purchasing screen to complete.
    CreateReorderProposal,
    /// A membership follow-up task, written to the CRM's own task list.
    CreateMembershipFollowUp,
}

/// Operations that always stop at a person, whatever the draft says.
///
/// These move money, reach a client, or change a payslip. The copilot may
/// prepare and route to them, but the authoritative screen performs them — so
/// this list is about what the AI will never execute, not merely what needs a
/// click.
pub const ALWAYS_EXPLICIT_APPROVAL: &[&str] = &[
    "payment",
    "refund",
    "payroll_change",
    "booking_confirmation",
    "offer_publishing",
    "marketing_send",
    "membership_cancellation",
    "financial_adjustment",
];

impl ActionKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::CreateOfferDraft => "create_offer_draft",
            Self::CreateCampaignDraft => "create_campaign_draft",
            Self::CreateWhatsAppDraft => "create_whatsapp_draft",
            Self::CreateFollowUpTask => "create_follow_up_task",
            Self::PrepareBookingDraft => "prepare_booking_draft",
            Self::PrepareMembershipRenewal => "prepare_membership_renewal",
            Self::CreateCoachingTask => "create_coaching_task",
            Self::CreateReorderProposal => "create_reorder_proposal",
            Self::CreateMembershipFollowUp => "create_membership_follow_up",
            Self::OpenStaffReport => "open_staff_report",
            Self::OpenClientProfile => "open_client_profile",
            Self::OpenServiceReport => "open_service_report",
            Self::OpenMembership => "open_membership",
            Self::ContinueBilling => "continue_billing",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            // Copilot proposal ids stay backward compatible with the action
            // service's canonical stored names.
            "prepare_whatsapp_draft" => Some(Self::CreateWhatsAppDraft),
            _ => Self::all().into_iter().find(|kind| kind.name() == name),
        }
    }

    pub fn all() -> [Self; 14] {
        [
            Self::CreateOfferDraft,
            Self::CreateCampaignDraft,
            Self::CreateWhatsAppDraft,
            Self::CreateFollowUpTask,
            Self::PrepareBookingDraft,
            Self::PrepareMembershipRenewal,
            Self::OpenStaffReport,
            Self::OpenClientProfile,
            Self::OpenServiceReport,
            Self::OpenMembership,
            Self::CreateCoachingTask,
            Self::CreateReorderProposal,
            Self::CreateMembershipFollowUp,
            Self::ContinueBilling,
        ]
    }

    /// True when executing would create or change a record rather than just
    /// open a screen. Read-only navigation still needs a click, but not a
    /// confirmation step.
    pub fn requires_confirmation(self) -> bool {
        matches!(
            self,
            Self::CreateOfferDraft
                | Self::CreateCampaignDraft
                | Self::CreateWhatsAppDraft
                | Self::CreateFollowUpTask
                | Self::PrepareBookingDraft
                | Self::PrepareMembershipRenewal
                | Self::ContinueBilling
        )
    }

    /// Roles allowed to confirm this action.
    fn allowed_roles(self) -> &'static [&'static str] {
        match self {
            // A discount draft is a commercial decision even before publication.
            Self::CreateOfferDraft | Self::CreateCampaignDraft => &["owner", "admin", "manager"],
            Self::OpenStaffReport => &["owner", "admin", "manager", "analyst"],
            Self::PrepareMembershipRenewal | Self::OpenMembership => {
                &["owner", "admin", "manager", "frontdesk", "receptionist"]
            }
            Self::OpenServiceReport => &["owner", "admin", "manager", "analyst", "accountant"],
            _ => &[
                "owner",
                "admin",
                "manager",
                "staff",
                "frontdesk",
                "receptionist",
                "analyst",
            ],
        }
    }

    pub fn permitted_for(self, role: &str) -> bool {
        self.allowed_roles()
            .contains(&role.to_ascii_lowercase().as_str())
    }

    /// The CRM screen that owns this change. Executing a draft never bypasses
    /// it: the user still lands there, where its own validation and audit apply.
    /// Whether approving this kind may complete the write, or only hand off.
    ///
    /// Only task-shaped work qualifies: creating a to-do changes no money and
    /// reaches no client. Publishing, sending, confirming and billing stay with
    /// the screens that own them, so approving one here routes rather than acts.
    pub fn executes_on_approval(self) -> bool {
        matches!(
            self,
            Self::CreateFollowUpTask | Self::CreateCoachingTask | Self::CreateMembershipFollowUp
        )
    }

    fn route(self) -> &'static str {
        match self {
            Self::CreateOfferDraft => "/marketing/offers",
            Self::CreateCampaignDraft => "/marketing/campaigns",
            Self::CreateWhatsAppDraft => "/clients/messages",
            Self::CreateFollowUpTask => "/tasks",
            Self::PrepareBookingDraft => "/appointments",
            Self::PrepareMembershipRenewal | Self::OpenMembership => "/memberships",
            Self::OpenStaffReport => "/staff/reports",
            Self::OpenClientProfile => "/clients",
            Self::OpenServiceReport => "/reports/services",
            Self::ContinueBilling => "/pos",
            Self::CreateCoachingTask | Self::CreateMembershipFollowUp => "/staff/control-center",
            Self::CreateReorderProposal => "/purchase-orders",
        }
    }

    /// Screens whose data this action affects, so the UI knows what to reload.
    fn refresh_targets(self) -> &'static [&'static str] {
        match self {
            Self::CreateOfferDraft => &["marketing.offers"],
            Self::CreateCampaignDraft => &["marketing.campaigns"],
            Self::CreateWhatsAppDraft => &["clients.messages"],
            Self::CreateFollowUpTask => &["tasks"],
            Self::PrepareBookingDraft => &["appointments"],
            Self::PrepareMembershipRenewal => &["memberships"],
            Self::CreateCoachingTask | Self::CreateMembershipFollowUp => &["tasks"],
            Self::CreateReorderProposal => &["purchases.orders"],
            _ => &[],
        }
    }

    /// What the user is agreeing to, and what will still not have happened.
    fn confirmation_note(self) -> &'static str {
        match self {
            Self::CreateOfferDraft => {
                "Creates an unpublished offer draft. The offer is not live until you publish it."
            }
            Self::CreateCampaignDraft => {
                "Creates an unsent campaign draft. No message is sent until you send it."
            }
            Self::CreateWhatsAppDraft => {
                "Prepares a message draft. Nothing is sent until you send it."
            }
            Self::CreateFollowUpTask => "Creates a follow-up task assigned in the CRM.",
            Self::PrepareBookingDraft => {
                "Prepares an unconfirmed booking draft. No appointment exists until you confirm it."
            }
            Self::PrepareMembershipRenewal => {
                "Prepares a renewal for review. No payment is taken and nothing is charged."
            }
            _ => "Opens the CRM screen. Nothing is changed.",
        }
    }
}

/// A draft as returned to the caller.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionDraft {
    pub id: String,
    pub action_type: String,
    pub status: String,
    /// Exactly what the user is being asked to agree to.
    pub summary: String,
    /// What will still not have happened after this runs.
    pub confirmation_note: String,
    pub requires_confirmation: bool,
    pub payload: Value,
    pub route: String,
    /// Screens the UI should reload after the user completes the change there.
    pub refresh_targets: Vec<String>,
    pub result: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDraftRequest {
    pub action_type: String,
    #[serde(default)]
    pub payload: Value,
    /// Optional caller-supplied description; a default is used when absent.
    #[serde(default)]
    pub summary: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmDraftRequest {
    /// Identifies this confirmation. Replaying it returns the first result.
    pub idempotency_key: String,
}

fn to_draft(record: action_repository::ActionDraftRecord) -> ActionDraft {
    let kind = ActionKind::from_name(&record.action_type);
    ActionDraft {
        id: record.id,
        status: record.status,
        summary: record.summary,
        confirmation_note: kind.map(ActionKind::confirmation_note).unwrap_or("").into(),
        requires_confirmation: record.requires_confirmation,
        payload: record.payload,
        route: kind.map(ActionKind::route).unwrap_or("").into(),
        refresh_targets: record
            .refresh_targets
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        result: record.result,
        action_type: record.action_type,
    }
}

/// Raises a draft. Creates no business record and changes nothing.
pub async fn create_draft(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    role: &str,
    user_id: &str,
    request: CreateDraftRequest,
) -> Result<ActionDraft, AppError> {
    let kind = ActionKind::from_name(&request.action_type)
        .ok_or_else(|| AppError::validation("that action is not available"))?;
    // Drafting is gated too. Offering a button the caller could never confirm
    // is a worse experience than not offering it.
    if !kind.permitted_for(role) {
        audit(
            db,
            tenant_id,
            branch_id,
            None,
            kind,
            "refused",
            user_id,
            role,
            "role may not draft this action",
        )
        .await;
        return Err(AppError::forbidden(
            "this action is not available for your role",
        ));
    }
    let summary = if request.summary.trim().is_empty() {
        format!("{} — {}", kind.name(), kind.confirmation_note())
    } else {
        request.summary.trim().chars().take(500).collect()
    };

    let record = action_repository::create_draft(
        db,
        tenant_id,
        branch_id,
        kind.name(),
        &summary,
        kind.requires_confirmation(),
        &request.payload,
        &json!(kind.refresh_targets()),
        user_id,
    )
    .await
    .map_err(|error| {
        tracing::error!(%error, action = kind.name(), "failed to store action draft");
        AppError::internal("failed to create the action draft")
    })?;
    audit(
        db,
        tenant_id,
        branch_id,
        Some(&record.id),
        kind,
        "drafted",
        user_id,
        role,
        "",
    )
    .await;
    Ok(to_draft(record))
}

/// Confirms a draft and records approval to open its owning CRM screen.
///
/// Permission and current state are re-checked here rather than trusted from
/// draft time: a role can be revoked, or the draft already actioned, in between.
pub async fn confirm_draft(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    role: &str,
    user_id: &str,
    draft_id: &str,
    request: ConfirmDraftRequest,
) -> Result<ActionDraft, AppError> {
    let idempotency_key = request.idempotency_key.trim();
    if idempotency_key.is_empty() || idempotency_key.chars().count() > 120 {
        return Err(AppError::validation("idempotencyKey is required"));
    }

    // A replay of the same draft and key returns the first approval. A key used
    // for another draft is a conflict instead of leaking or approving it.
    if let Some(existing) =
        action_repository::by_idempotency_key(db, tenant_id, branch_id, idempotency_key)
            .await
            .map_err(|_| AppError::internal("failed to check the idempotency key"))?
    {
        if existing.id != draft_id {
            return Err(AppError::conflict(
                "that idempotency key belongs to another action draft",
            ));
        }
        let kind = ActionKind::from_name(&existing.action_type)
            .ok_or_else(|| AppError::validation("that action is no longer available"))?;
        if !kind.permitted_for(role) {
            audit(
                db,
                tenant_id,
                branch_id,
                Some(&existing.id),
                kind,
                "refused",
                user_id,
                role,
                "role may not replay this approval",
            )
            .await;
            return Err(AppError::forbidden(
                "this action is not available for your role",
            ));
        }
        audit(
            db,
            tenant_id,
            branch_id,
            Some(&existing.id),
            kind,
            "replayed",
            user_id,
            role,
            "approval replayed with the same key",
        )
        .await;
        return Ok(to_draft(existing));
    }

    let record = action_repository::by_id(db, tenant_id, branch_id, draft_id)
        .await
        .map_err(|_| AppError::internal("failed to load the action draft"))?
        .ok_or_else(|| AppError::not_found("that action draft was not found"))?;
    let kind = ActionKind::from_name(&record.action_type)
        .ok_or_else(|| AppError::validation("that action is no longer available"))?;

    // Re-checked at the moment of approval, not taken from the draft.
    if !kind.permitted_for(role) {
        audit(
            db,
            tenant_id,
            branch_id,
            Some(&record.id),
            kind,
            "refused",
            user_id,
            role,
            "role may not confirm this action",
        )
        .await;
        return Err(AppError::forbidden(
            "this action is not available for your role",
        ));
    }
    // `executing` is undecided: a previous attempt claimed it and did not
    // finish, so this call is a retry rather than a second decision. It is safe
    // to proceed because the CRM write is keyed on the draft — the retry finds
    // the existing record instead of writing another.
    if !matches!(record.status.as_str(), "draft" | "executing") {
        audit(
            db,
            tenant_id,
            branch_id,
            Some(&record.id),
            kind,
            "refused",
            user_id,
            role,
            "draft was already decided",
        )
        .await;
        return Err(AppError::conflict("that action draft was already decided"));
    }

    // Claim the draft *before* touching the CRM. The claim is a single
    // conditional UPDATE off `status='draft'`, so of two concurrent
    // confirmations exactly one proceeds past this point and exactly one CRM
    // record is ever created. The loser is told the draft was already decided.
    let claimed =
        action_repository::claim_for_execution(db, tenant_id, branch_id, &record.id, user_id)
            .await
            .map_err(|error| {
                tracing::error!(%error, action = kind.name(), "failed to claim action draft");
                AppError::internal("failed to approve the action draft")
            })?
            .ok_or_else(|| AppError::conflict("that action draft was already decided"))?;

    // Task-shaped work is completed here through the CRM's own service. Anything
    // that moves money or reaches a client is handed to the screen that owns it.
    //
    // `executed` is only ever true once that authoritative write has returned
    // successfully — a failed write is reported as a failure, never as an
    // approval that quietly did nothing.
    let mut result = json!({
        "approved": true,
        "executed": false,
        "route": kind.route(),
        "note": kind.confirmation_note(),
    });
    if kind.executes_on_approval() {
        match execute_through_crm(
            db,
            tenant_id,
            branch_id,
            user_id,
            kind,
            &claimed.id,
            &claimed.payload,
        )
        .await
        {
            Ok(execution) => {
                result = json!({
                    "approved": true,
                    "executed": true,
                    "route": kind.route(),
                    "note": kind.confirmation_note(),
                    "execution": execution,
                });
            }
            Err(error) => {
                // The authoritative write did not happen, so the draft returns
                // to `draft` and stays confirmable rather than being stranded
                // in `executing`.
                if let Err(release) =
                    action_repository::release_claim(db, tenant_id, branch_id, &claimed.id).await
                {
                    tracing::error!(%release, action = kind.name(), "failed to release action claim");
                }
                audit(
                    db,
                    tenant_id,
                    branch_id,
                    Some(&claimed.id),
                    kind,
                    "failed",
                    user_id,
                    role,
                    error.message(),
                )
                .await;
                return Err(error);
            }
        }
    }
    let approved = action_repository::mark_approved(
        db,
        tenant_id,
        branch_id,
        &record.id,
        idempotency_key,
        &result,
        user_id,
    )
    .await
    .map_err(|error| {
        tracing::error!(%error, action = kind.name(), "failed to approve action draft");
        AppError::internal("failed to approve the action draft")
    })?
    // A concurrent confirmation won the race and moved it out of 'draft'.
    .ok_or_else(|| AppError::conflict("that action draft was already decided"))?;

    audit(
        db,
        tenant_id,
        branch_id,
        Some(&approved.id),
        kind,
        "approved",
        user_id,
        role,
        "",
    )
    .await;
    Ok(to_draft(approved))
}

/// Performs the approved change through the CRM service that owns it.
///
/// This function deliberately contains no SQL of its own: every write goes
/// through the same service the corresponding CRM screen calls, so the copilot
/// cannot end up with a second, divergent definition of what creating a task
/// means. Adding a kind here means finding its existing service, not writing a
/// new insert.
async fn execute_through_crm(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    kind: ActionKind,
    draft_id: &str,
    payload: &Value,
) -> Result<Value, AppError> {
    match kind {
        ActionKind::CreateFollowUpTask
        | ActionKind::CreateCoachingTask
        | ActionKind::CreateMembershipFollowUp => {
            let title = payload
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::validation("the draft has no task title"))?;
            // Stamped with the draft's identity, so this is at most once per
            // draft however many times it is retried.
            let record = staff_advanced_service::create_task_for_action(
                db,
                tenant_id,
                branch_id,
                user_id,
                staff_advanced_service::StaffTaskRequest {
                    staff_id: payload
                        .get("staffId")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .filter(|value| !value.is_empty()),
                    title: title.to_string(),
                    description: payload
                        .get("description")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    // The CRM's task list owns this vocabulary; the copilot maps
                    // onto it rather than inventing task types of its own.
                    task_type: Some(match kind {
                        ActionKind::CreateCoachingTask => "training".to_string(),
                        _ => "follow_up".to_string(),
                    }),
                    priority: payload
                        .get("priority")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    due_at: payload
                        .get("dueAt")
                        .and_then(Value::as_str)
                        .and_then(|value| value.parse().ok()),
                    status: None,
                    version: None,
                },
                draft_id,
            )
            .await?;
            Ok(json!({
                "service": "staff_advanced_service.create_task",
                "recordKind": "staff_task",
                "recordId": record.id,
                "title": record.title,
            }))
        }
        // Nothing else is completed here by design; the caller routes instead.
        // Naming the policy in the message keeps the refusal and the rule that
        // produced it in one place.
        _ => Err(AppError::validation(format!(
            "this action is completed on its own CRM screen, not by the copilot; {} always stay with a person",
            ALWAYS_EXPLICIT_APPROVAL.join(", ").replace('_', " ")
        ))),
    }
}

/// Cancels a draft. Nothing runs.
pub async fn cancel_draft(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    role: &str,
    user_id: &str,
    draft_id: &str,
) -> Result<ActionDraft, AppError> {
    let record = action_repository::cancel(db, tenant_id, branch_id, draft_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to cancel the action draft"))?
        .ok_or_else(|| AppError::not_found("that action draft was not found"))?;
    if let Some(kind) = ActionKind::from_name(&record.action_type) {
        audit(
            db,
            tenant_id,
            branch_id,
            Some(&record.id),
            kind,
            "cancelled",
            user_id,
            role,
            "",
        )
        .await;
    }
    Ok(to_draft(record))
}

/// Writes an audit entry. A failure here is logged loudly but never blocks or
/// reverses the action the user is entitled to.
#[allow(clippy::too_many_arguments)]
async fn audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    draft_id: Option<&str>,
    kind: ActionKind,
    event: &str,
    actor_id: &str,
    actor_role: &str,
    detail: &str,
) {
    if let Err(error) = action_repository::record_audit(
        db,
        tenant_id,
        branch_id,
        draft_id,
        kind.name(),
        event,
        actor_id,
        actor_role,
        detail,
    )
    .await
    {
        tracing::error!(%error, action = kind.name(), event, "failed to write action audit");
    }
}

#[cfg(test)]
mod phase5_action_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;
    use uuid::Uuid;

    /// Operations that must never be reachable as a copilot action at all.
    /// Gating them would not be enough; they are simply not in the allow-list.
    const FORBIDDEN_SUBSTRINGS: &[&str] = &[
        "payment",
        "refund",
        "void",
        "confirm_booking",
        "publish",
        "send_campaign",
        "send_marketing",
        "cancel_membership",
        "payroll",
        "salary",
    ];

    #[test]
    fn no_dangerous_operation_is_reachable_as_an_action() {
        for kind in ActionKind::all() {
            let name = kind.name();
            for forbidden in FORBIDDEN_SUBSTRINGS {
                assert!(
                    !name.contains(forbidden),
                    "{name} looks like a {forbidden} operation, which must not be a copilot action"
                );
            }
        }
        // The ones that would change data all say so.
        for kind in ActionKind::all() {
            if kind.requires_confirmation() {
                assert!(
                    !kind.confirmation_note().is_empty(),
                    "{} must say what is still not done",
                    kind.name()
                );
            }
        }
    }

    #[test]
    fn drafting_actions_state_what_will_not_happen() {
        // Each drafting action must promise the irreversible half has not run.
        for (kind, expected) in [
            (ActionKind::CreateOfferDraft, "not live"),
            (ActionKind::CreateCampaignDraft, "No message is sent"),
            (ActionKind::CreateWhatsAppDraft, "Nothing is sent"),
            (ActionKind::PrepareBookingDraft, "No appointment exists"),
            (ActionKind::PrepareMembershipRenewal, "No payment is taken"),
        ] {
            assert!(
                kind.confirmation_note().contains(expected),
                "{} must state {expected:?}, got {:?}",
                kind.name(),
                kind.confirmation_note()
            );
        }
    }

    #[test]
    fn every_kind_round_trips_and_navigation_needs_no_confirmation() {
        for kind in ActionKind::all() {
            assert_eq!(ActionKind::from_name(kind.name()), Some(kind));
            assert!(!kind.route().is_empty());
        }
        assert!(ActionKind::from_name("delete_all_clients").is_none());
        assert_eq!(
            ActionKind::from_name("prepare_whatsapp_draft"),
            Some(ActionKind::CreateWhatsAppDraft)
        );
        // Opening a screen changes nothing, so it is not a confirmation step.
        assert!(!ActionKind::OpenClientProfile.requires_confirmation());
        assert!(!ActionKind::OpenStaffReport.requires_confirmation());
        assert!(ActionKind::ContinueBilling.requires_confirmation());
        // Commercial drafts are restricted even before publication.
        assert!(!ActionKind::CreateOfferDraft.permitted_for("receptionist"));
        assert!(ActionKind::CreateOfferDraft.permitted_for("manager"));
    }

    async fn connect() -> Option<PgPool> {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").ok()?;
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .ok()
    }

    async fn cleanup(db: &PgPool, tenant: &str) {
        for table in ["ai_action_audit", "ai_action_drafts"] {
            let _ = sqlx::query(&format!("DELETE FROM {table} WHERE tenant_id=$1"))
                .bind(tenant)
                .execute(db)
                .await;
        }
    }

    /// Drafting and approval are separate, and confirming twice approves once.
    #[tokio::test]
    async fn a_draft_is_approved_once_however_many_times_it_is_confirmed() {
        let Some(db) = connect().await else { return };
        let tenant = format!("phase5_{}", Uuid::new_v4().simple());
        let branch = "branch1";

        let draft = create_draft(
            &db,
            &tenant,
            branch,
            "manager",
            "user1",
            CreateDraftRequest {
                action_type: "create_offer_draft".into(),
                payload: json!({"serviceId": "svc-1", "discountPercent": 10}),
                summary: "Create a 10% offer draft on Hair Spa".into(),
            },
        )
        .await
        .expect("draft is created");

        // Creating a draft changes nothing yet.
        assert_eq!(draft.status, "draft");
        assert!(draft.requires_confirmation);
        assert!(draft.confirmation_note.contains("not live"));

        let key = format!("confirm_{}", Uuid::new_v4().simple());
        let first = confirm_draft(
            &db,
            &tenant,
            branch,
            "manager",
            "user1",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: key.clone(),
            },
        )
        .await
        .expect("first confirmation approves");
        assert_eq!(first.status, "approved");
        assert_eq!(first.result["approved"], true);
        assert_eq!(first.result["executed"], false);
        assert!(
            first
                .refresh_targets
                .contains(&"marketing.offers".to_string()),
            "the UI must be told what to reload"
        );

        // The same key again returns the first result rather than acting twice.
        let replay = confirm_draft(
            &db,
            &tenant,
            branch,
            "manager",
            "user1",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: key.clone(),
            },
        )
        .await
        .expect("a replayed confirmation is safe");
        assert_eq!(replay.id, first.id);
        assert_eq!(replay.status, "approved");

        let approved: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::BIGINT FROM ai_action_drafts WHERE tenant_id=$1 AND status='approved'",
        )
        .bind(&tenant)
        .fetch_one(&db)
        .await
        .expect("count runs");
        assert_eq!(
            approved, 1,
            "a replayed confirmation must not approve twice"
        );

        // A different key on an already-decided draft is a conflict, not a
        // second approval.
        let again = confirm_draft(
            &db,
            &tenant,
            branch,
            "manager",
            "user1",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: format!("other_{}", Uuid::new_v4().simple()),
            },
        )
        .await;
        assert!(
            again.is_err(),
            "an already-decided draft must not approve again"
        );

        cleanup(&db, &tenant).await;
    }

    /// An unauthorized confirmation is refused and the attempt is recorded.
    #[tokio::test]
    async fn an_unauthorized_confirmation_is_refused_and_audited() {
        let Some(db) = connect().await else { return };
        let tenant = format!("phase5_deny_{}", Uuid::new_v4().simple());
        let branch = "branch1";

        // Drafted by a manager, who may.
        let draft = create_draft(
            &db,
            &tenant,
            branch,
            "manager",
            "user1",
            CreateDraftRequest {
                action_type: "create_campaign_draft".into(),
                payload: json!({}),
                summary: String::new(),
            },
        )
        .await
        .expect("draft is created");

        // Confirmed by a receptionist, who may not. The permission that counts
        // is the one at confirm time.
        let refused = confirm_draft(
            &db,
            &tenant,
            branch,
            "receptionist",
            "user2",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: format!("k_{}", Uuid::new_v4().simple()),
            },
        )
        .await;
        assert!(
            refused.is_err(),
            "an unauthorized confirmation must be refused"
        );

        // The draft is untouched.
        let still: String = sqlx::query_scalar("SELECT status FROM ai_action_drafts WHERE id=$1")
            .bind(&draft.id)
            .fetch_one(&db)
            .await
            .expect("draft reloads");
        assert_eq!(still, "draft");

        // The refusal is on the record.
        let refusals: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::BIGINT FROM ai_action_audit WHERE tenant_id=$1 AND event='refused'",
        )
        .bind(&tenant)
        .fetch_one(&db)
        .await
        .expect("count runs");
        assert!(refusals > 0, "a refused attempt must be auditable");

        cleanup(&db, &tenant).await;
    }

    /// Every transition leaves an audit entry, and one tenant cannot act on
    /// another's draft.
    #[tokio::test]
    async fn actions_are_auditable_and_tenant_scoped() {
        let Some(db) = connect().await else { return };
        let tenant = format!("phase5_audit_{}", Uuid::new_v4().simple());
        let other = format!("phase5_intruder_{}", Uuid::new_v4().simple());
        let branch = "branch1";

        let draft = create_draft(
            &db,
            &tenant,
            branch,
            "manager",
            "user1",
            CreateDraftRequest {
                action_type: "create_follow_up_task".into(),
                payload: json!({"clientId": "c1"}),
                summary: "Follow up with Priya".into(),
            },
        )
        .await
        .expect("draft is created");

        // Another tenant must not be able to confirm it.
        let intruder = confirm_draft(
            &db,
            &other,
            branch,
            "owner",
            "user9",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: format!("k_{}", Uuid::new_v4().simple()),
            },
        )
        .await;
        assert!(
            intruder.is_err(),
            "a draft must not be confirmable from another tenant"
        );

        cancel_draft(&db, &tenant, branch, "manager", "user1", &draft.id)
            .await
            .expect("cancel succeeds");

        let events: Vec<String> = sqlx::query_scalar(
            "SELECT event FROM ai_action_audit WHERE tenant_id=$1 ORDER BY created_at",
        )
        .bind(&tenant)
        .fetch_all(&db)
        .await
        .expect("audit loads");
        assert!(events.contains(&"drafted".to_string()));
        assert!(events.contains(&"cancelled".to_string()));

        // A cancelled draft cannot then be approved.
        let after_cancel = confirm_draft(
            &db,
            &tenant,
            branch,
            "manager",
            "user1",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: format!("k_{}", Uuid::new_v4().simple()),
            },
        )
        .await;
        assert!(after_cancel.is_err(), "a cancelled draft must not execute");

        cleanup(&db, &tenant).await;
        cleanup(&db, &other).await;
    }
}

#[cfg(test)]
mod controlled_action_tests {
    use super::*;
    use sqlx::PgPool;

    /// Every draft kind the phase asks the copilot to prepare.
    const REQUIRED_DRAFT_KINDS: &[ActionKind] = &[
        ActionKind::CreateCoachingTask,
        ActionKind::CreateFollowUpTask,
        ActionKind::CreateOfferDraft,
        ActionKind::CreateCampaignDraft,
        ActionKind::PrepareBookingDraft,
        ActionKind::CreateReorderProposal,
        ActionKind::CreateMembershipFollowUp,
    ];

    async fn seed(db: &PgPool) -> (String, String, String) {
        let tenant_id: String = sqlx::query_scalar(
            "INSERT INTO tenants(name,scope_id) VALUES('Aura Salon Group','') RETURNING scope_id",
        )
        .fetch_one(db)
        .await
        .unwrap();
        let branch_id: String = sqlx::query_scalar(
            r#"INSERT INTO branches(tenant_id,name,scope_id,region_name,zone_name,cluster_name,active)
               VALUES((SELECT id FROM tenants WHERE scope_id=$1),'Banjara Hills','','South','Hyderabad','Central',TRUE)
               RETURNING scope_id"#,
        )
        .bind(&tenant_id)
        .fetch_one(db)
        .await
        .unwrap();
        let staff_id: String = sqlx::query_scalar(
            r#"INSERT INTO staff(tenant_id,branch_id,first_name,last_name,email,job_title,active)
               VALUES($1,$2,'Asha','Rao','asha.rao@aurasalon.in','Stylist',TRUE) RETURNING id"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .fetch_one(db)
        .await
        .unwrap();
        (tenant_id, branch_id, staff_id)
    }

    #[test]
    fn every_required_draft_kind_exists() {
        for kind in REQUIRED_DRAFT_KINDS {
            assert!(
                ActionKind::from_name(kind.name()).is_some(),
                "missing draft kind {}",
                kind.name()
            );
        }
    }

    /// The AI must never complete an operation that moves money, reaches a
    /// client, or changes a payslip — approval routes to the owning screen.
    #[test]
    fn dangerous_operations_are_never_executed_by_the_copilot() {
        for kind in [
            ActionKind::ContinueBilling,
            ActionKind::CreateOfferDraft,
            ActionKind::CreateCampaignDraft,
            ActionKind::CreateWhatsAppDraft,
            ActionKind::PrepareBookingDraft,
            ActionKind::PrepareMembershipRenewal,
        ] {
            assert!(
                !kind.executes_on_approval(),
                "{} must hand off, never execute",
                kind.name()
            );
        }
        // The named always-explicit list is stated and complete.
        for operation in [
            "payment",
            "refund",
            "payroll_change",
            "booking_confirmation",
            "offer_publishing",
            "marketing_send",
            "membership_cancellation",
            "financial_adjustment",
        ] {
            assert!(
                ALWAYS_EXPLICIT_APPROVAL.contains(&operation),
                "{operation} must be on the always-explicit list"
            );
        }
    }

    #[test]
    fn only_task_shaped_work_is_executed() {
        for kind in [
            ActionKind::CreateFollowUpTask,
            ActionKind::CreateCoachingTask,
            ActionKind::CreateMembershipFollowUp,
        ] {
            assert!(
                kind.executes_on_approval(),
                "{} should complete",
                kind.name()
            );
        }
    }

    /// Approval must produce the real CRM record, and only then say `executed`.
    #[sqlx::test]
    async fn approving_a_coaching_task_writes_it_through_the_crm_service(pool: PgPool) {
        let (tenant_id, branch_id, staff_id) = seed(&pool).await;
        let draft = create_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "user-1",
            CreateDraftRequest {
                action_type: "create_coaching_task".into(),
                payload: json!({
                    "staffId": staff_id,
                    "title": "Coach on add-on selling",
                    "description": "Utilization is high but average bill is falling.",
                }),
                summary: String::new(),
            },
        )
        .await
        .expect("the draft is created");
        assert_eq!(draft.status, "draft");

        // Nothing exists yet: a draft is not a task.
        let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM staff_tasks WHERE tenant_id=$1")
            .bind(&tenant_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(before, 0, "drafting must not write the task");

        let approved = confirm_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "approver-1",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: "confirm-key-1".into(),
            },
        )
        .await
        .expect("the approval completes");

        assert_eq!(approved.status, "approved");
        assert_eq!(
            approved.result["executed"], true,
            "an executed action must say so"
        );
        assert_eq!(
            approved.result["execution"]["service"], "staff_advanced_service.create_task",
            "the write must go through the CRM's own service"
        );

        // The authoritative record actually exists.
        let after: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM staff_tasks WHERE tenant_id=$1 AND task_type='training'",
        )
        .bind(&tenant_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(after, 1, "approval must create the real CRM task");
    }

    /// A failing authoritative write must surface as a failure, never as an
    /// approval that silently did nothing.
    #[sqlx::test]
    async fn a_failed_write_is_not_reported_as_executed(pool: PgPool) {
        let (tenant_id, branch_id, _) = seed(&pool).await;
        let draft = create_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "user-1",
            CreateDraftRequest {
                // No title, so the CRM service will reject it.
                action_type: "create_follow_up_task".into(),
                payload: json!({ "description": "no title supplied" }),
                summary: String::new(),
            },
        )
        .await
        .expect("the draft is created");

        let error = confirm_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "approver-1",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: "confirm-key-2".into(),
            },
        )
        .await
        .expect_err("a rejected write must fail the approval");
        assert!(format!("{error:?}").to_lowercase().contains("title"));

        // The draft must not be left looking approved.
        let status: String = sqlx::query_scalar("SELECT status FROM ai_action_drafts WHERE id=$1")
            .bind(&draft.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            status, "draft",
            "a failed write must leave the draft undecided, not approved"
        );

        // And the failure is on the audit trail.
        let failures: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM ai_action_audit WHERE tenant_id=$1 AND event='failed'",
        )
        .bind(&tenant_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(failures, 1, "a failed execution must be audited");
    }

    /// Replaying the same key returns the first approval instead of writing
    /// the task a second time.
    #[sqlx::test]
    async fn a_replayed_key_does_not_execute_twice(pool: PgPool) {
        let (tenant_id, branch_id, staff_id) = seed(&pool).await;
        let draft = create_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "user-1",
            CreateDraftRequest {
                action_type: "create_coaching_task".into(),
                payload: json!({ "staffId": staff_id, "title": "Coach on rebooking" }),
                summary: String::new(),
            },
        )
        .await
        .expect("the draft is created");

        let key = ConfirmDraftRequest {
            idempotency_key: "confirm-key-3".into(),
        };
        confirm_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "approver-1",
            &draft.id,
            key.clone(),
        )
        .await
        .expect("first approval");
        confirm_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "approver-1",
            &draft.id,
            key,
        )
        .await
        .expect("the replay returns the first approval");

        let tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM staff_tasks WHERE tenant_id=$1")
            .bind(&tenant_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(tasks, 1, "a replayed approval must not write twice");
    }

    /// The idempotency key is scoped to a branch, so the same key in another
    /// branch is a different approval rather than a collision.
    #[sqlx::test]
    async fn idempotency_keys_are_scoped_to_a_branch(pool: PgPool) {
        let (tenant_id, branch_id, staff_id) = seed(&pool).await;
        let other_branch: String = sqlx::query_scalar(
            r#"INSERT INTO branches(tenant_id,name,scope_id,region_name,zone_name,cluster_name,active)
               VALUES((SELECT id FROM tenants WHERE scope_id=$1),'Andheri West','','West','Mumbai','North',TRUE)
               RETURNING scope_id"#,
        )
        .bind(&tenant_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        let make = |branch: String, staff: Option<String>| {
            let tenant = tenant_id.clone();
            let pool = pool.clone();
            async move {
                create_draft(
                    &pool,
                    &tenant,
                    &branch,
                    "manager",
                    "user-1",
                    CreateDraftRequest {
                        action_type: "create_coaching_task".into(),
                        payload: json!({ "staffId": staff, "title": "Coach on add-ons" }),
                        summary: String::new(),
                    },
                )
                .await
                .expect("draft")
            }
        };

        let first = make(branch_id.clone(), Some(staff_id)).await;
        let second = make(other_branch.clone(), None).await;

        let key = "shared-key";
        confirm_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "approver-1",
            &first.id,
            ConfirmDraftRequest {
                idempotency_key: key.into(),
            },
        )
        .await
        .expect("first branch approves");
        confirm_draft(
            &pool,
            &tenant_id,
            &other_branch,
            "manager",
            "approver-1",
            &second.id,
            ConfirmDraftRequest {
                idempotency_key: key.into(),
            },
        )
        .await
        .expect("the same key in another branch is a separate approval");
    }

    /// A permission revoked between drafting and approval must stop the write.
    #[sqlx::test]
    async fn permission_is_rechecked_at_approval_not_at_draft_time(pool: PgPool) {
        let (tenant_id, branch_id, staff_id) = seed(&pool).await;
        let draft = create_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "user-1",
            CreateDraftRequest {
                action_type: "create_offer_draft".into(),
                payload: json!({ "staffId": staff_id, "discountPercent": 10 }),
                summary: String::new(),
            },
        )
        .await
        .expect("a manager may draft an offer");

        // The same draft, approved by a role that may not confirm it.
        let error = confirm_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "receptionist",
            "approver-2",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: "confirm-key-4".into(),
            },
        )
        .await
        .expect_err("a role without the right must not confirm");
        assert!(format!("{error:?}")
            .to_lowercase()
            .contains("not available"));
    }

    /// Two confirmations arriving at once must produce one CRM task, not two.
    ///
    /// This is the defect the `executing` claim exists for: the CRM write used
    /// to happen before the draft transition was won, so both callers could
    /// pass the "still a draft?" check, both create a real task, and only then
    /// race for the single approval row — leaving an orphaned task behind.
    #[sqlx::test]
    async fn concurrent_confirmations_create_exactly_one_crm_task(pool: PgPool) {
        let (tenant_id, branch_id, staff_id) = seed(&pool).await;
        let draft = create_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "user-1",
            CreateDraftRequest {
                action_type: "create_coaching_task".into(),
                payload: json!({
                    "staffId": staff_id,
                    "title": "Coach on add-on selling",
                    "description": "Two approvers pressed confirm at the same moment.",
                }),
                summary: String::new(),
            },
        )
        .await
        .expect("the draft is created");

        // Distinct keys, so the idempotency replay path cannot be what saves
        // us — the claim has to.
        let first = confirm_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "approver-1",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: "race-key-a".into(),
            },
        );
        let second = confirm_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "approver-2",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: "race-key-b".into(),
            },
        );
        let (left, right) = tokio::join!(first, second);

        let winners = usize::from(left.is_ok()) + usize::from(right.is_ok());
        assert_eq!(winners, 1, "exactly one confirmation may succeed");
        let loser = left.err().or(right.err()).expect("one confirmation loses");
        assert!(
            format!("{loser:?}")
                .to_lowercase()
                .contains("already decided"),
            "the loser must be told the draft was already decided, got {loser:?}"
        );

        let tasks: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM staff_tasks WHERE tenant_id=$1 AND task_type='training'",
        )
        .bind(&tenant_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            tasks, 1,
            "a raced confirmation must not duplicate the CRM task"
        );

        let status: String = sqlx::query_scalar("SELECT status FROM ai_action_drafts WHERE id=$1")
            .bind(&draft.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "approved", "the winner's approval must be recorded");
    }

    /// A failed write releases the claim, so the draft is retryable rather than
    /// stranded in `executing` forever.
    #[sqlx::test]
    async fn a_failed_write_releases_the_claim(pool: PgPool) {
        let (tenant_id, branch_id, _) = seed(&pool).await;
        let draft = create_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "user-1",
            CreateDraftRequest {
                action_type: "create_follow_up_task".into(),
                payload: json!({ "description": "no title supplied" }),
                summary: String::new(),
            },
        )
        .await
        .expect("the draft is created");

        confirm_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "approver-1",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: "release-key-1".into(),
            },
        )
        .await
        .expect_err("the CRM write fails");

        let status: String = sqlx::query_scalar("SELECT status FROM ai_action_drafts WHERE id=$1")
            .bind(&draft.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            status, "draft",
            "a failed write must leave the draft confirmable, not stuck executing"
        );
    }

    /// Cancelling and confirming at the same moment must land on one of two
    /// consistent outcomes, never in between.
    ///
    /// The failure this guards against is a real CRM task existing behind an
    /// action record that says `cancelled` — a task nobody approved, attached
    /// to a decision that was withdrawn. Cancellation only touches an unclaimed
    /// draft, so once a confirmation has claimed it the cancel is refused.
    #[sqlx::test]
    async fn a_cancel_racing_a_confirm_never_leaves_a_task_behind_a_cancelled_draft(pool: PgPool) {
        let (tenant_id, branch_id, staff_id) = seed(&pool).await;
        let draft = create_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "user-1",
            CreateDraftRequest {
                action_type: "create_coaching_task".into(),
                payload: json!({
                    "staffId": staff_id,
                    "title": "Coach on add-on selling",
                    "description": "One approver confirms while another cancels.",
                }),
                summary: String::new(),
            },
        )
        .await
        .expect("the draft is created");

        let confirming = confirm_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "approver-1",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: "cancel-race-key".into(),
            },
        );
        let cancelling = cancel_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "canceller-1",
            &draft.id,
        );
        let (confirmed, cancelled) = tokio::join!(confirming, cancelling);

        let tasks: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM staff_tasks WHERE tenant_id=$1 AND origin_action_draft_id=$2",
        )
        .bind(&tenant_id)
        .bind(&draft.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let status: String = sqlx::query_scalar("SELECT status FROM ai_action_drafts WHERE id=$1")
            .bind(&draft.id)
            .fetch_one(&pool)
            .await
            .unwrap();

        // Exactly one of the two decides the draft; both succeeding would mean
        // the draft was decided twice.
        assert!(
            confirmed.is_ok() != cancelled.is_ok(),
            "exactly one of confirm/cancel may win, got confirm={:?} cancel={:?}",
            confirmed.as_ref().map(|draft| draft.status.clone()),
            cancelled.as_ref().map(|draft| draft.status.clone()),
        );

        if cancelled.is_ok() {
            // (a) Cancellation won, before anything was written.
            assert_eq!(status, "cancelled");
            assert_eq!(tasks, 0, "a cancelled draft must leave no CRM task");
        } else {
            // (b) Execution won: one task, and an approved record behind it.
            assert_eq!(status, "approved");
            assert_eq!(tasks, 1, "an approved draft owns exactly one CRM task");
            let approved = confirmed.expect("the confirmation won");
            assert_eq!(approved.result["executed"], true);
        }

        // The invariant, stated whichever branch was taken: a task may only
        // exist behind an approved record.
        assert!(
            tasks == 0 || status == "approved",
            "a CRM task must never sit behind a {status} action record"
        );
    }

    /// Crash recovery: the CRM write succeeded, the approval never landed.
    ///
    /// This is the state a process leaves behind if it dies between the two —
    /// the claim alone cannot distinguish it from "not written yet". The
    /// draft's identity on the task is what makes the retry safe: it finds the
    /// existing record and finalises against it.
    #[sqlx::test]
    async fn a_retry_after_a_crash_finds_the_existing_task_instead_of_creating_another(
        pool: PgPool,
    ) {
        let (tenant_id, branch_id, staff_id) = seed(&pool).await;
        let draft = create_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "user-1",
            CreateDraftRequest {
                action_type: "create_coaching_task".into(),
                payload: json!({
                    "staffId": staff_id,
                    "title": "Coach on add-on selling",
                    "description": "The first attempt died before it could record the approval.",
                }),
                summary: String::new(),
            },
        )
        .await
        .expect("the draft is created");

        // Reproduce the post-crash state exactly: claimed, executed, unapproved.
        let claimed = action_repository::claim_for_execution(
            &pool,
            &tenant_id,
            &branch_id,
            &draft.id,
            "approver-1",
        )
        .await
        .expect("the claim query runs")
        .expect("the draft is claimable");
        let crashed_task = execute_through_crm(
            &pool,
            &tenant_id,
            &branch_id,
            "approver-1",
            ActionKind::CreateCoachingTask,
            &claimed.id,
            &claimed.payload,
        )
        .await
        .expect("the CRM write succeeds");
        let crashed_task_id = crashed_task["recordId"]
            .as_str()
            .expect("the write returns a record id")
            .to_string();

        let stuck: String = sqlx::query_scalar("SELECT status FROM ai_action_drafts WHERE id=$1")
            .bind(&draft.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            stuck, "executing",
            "the fixture must reproduce a stuck claim"
        );

        // The retry.
        let recovered = confirm_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "approver-1",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: "recovery-key-1".into(),
            },
        )
        .await
        .expect("the retry completes rather than stalling on the stuck claim");

        assert_eq!(recovered.status, "approved");
        assert_eq!(recovered.result["executed"], true);
        assert_eq!(
            recovered.result["execution"]["recordId"], crashed_task_id,
            "the retry must adopt the task the crashed run created"
        );

        let tasks: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM staff_tasks WHERE tenant_id=$1 AND origin_action_draft_id=$2",
        )
        .bind(&tenant_id)
        .bind(&draft.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(tasks, 1, "recovery must not write a second CRM task");
    }

    /// The uniqueness is enforced by the database, not only by the read-first
    /// check — otherwise two runs interleaving between the read and the insert
    /// would still duplicate.
    #[sqlx::test]
    async fn the_crm_task_carries_a_unique_identity_from_its_draft(pool: PgPool) {
        let (tenant_id, branch_id, staff_id) = seed(&pool).await;
        sqlx::query(
            r#"INSERT INTO staff_tasks(tenant_id,branch_id,staff_id,title,task_type,assigned_by,origin_action_draft_id)
               VALUES($1,$2,$3,'First','training','user-1','draft-xyz')"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&staff_id)
        .execute(&pool)
        .await
        .expect("the first task is written");

        let duplicate = sqlx::query(
            r#"INSERT INTO staff_tasks(tenant_id,branch_id,staff_id,title,task_type,assigned_by,origin_action_draft_id)
               VALUES($1,$2,$3,'Second','training','user-1','draft-xyz')"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&staff_id)
        .execute(&pool)
        .await;
        assert!(
            duplicate.is_err(),
            "the database must refuse a second task for the same action draft"
        );

        // Tasks with no draft behind them are unaffected by the constraint.
        for title in ["Manual one", "Manual two"] {
            sqlx::query(
                r#"INSERT INTO staff_tasks(tenant_id,branch_id,staff_id,title,task_type,assigned_by)
                   VALUES($1,$2,$3,$4,'general','user-1')"#,
            )
            .bind(&tenant_id)
            .bind(&branch_id)
            .bind(&staff_id)
            .bind(title)
            .execute(&pool)
            .await
            .expect("staff-screen tasks are not constrained");
        }
    }

    /// The cancel-versus-execute rule, stated without relying on scheduling.
    ///
    /// Once a confirmation has claimed the draft, cancellation is refused —
    /// otherwise the cancel would land on a draft whose CRM write is already
    /// under way, and the task would end up behind a `cancelled` record.
    #[sqlx::test]
    async fn a_claimed_draft_cannot_be_cancelled(pool: PgPool) {
        let (tenant_id, branch_id, staff_id) = seed(&pool).await;
        let draft = create_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "user-1",
            CreateDraftRequest {
                action_type: "create_coaching_task".into(),
                payload: json!({
                    "staffId": staff_id,
                    "title": "Coach on add-on selling",
                }),
                summary: String::new(),
            },
        )
        .await
        .expect("the draft is created");

        action_repository::claim_for_execution(
            &pool,
            &tenant_id,
            &branch_id,
            &draft.id,
            "approver-1",
        )
        .await
        .expect("the claim query runs")
        .expect("an unclaimed draft is claimable");

        let refused = cancel_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "canceller-1",
            &draft.id,
        )
        .await
        .expect_err("a claimed draft must not be cancellable");
        assert!(
            format!("{refused:?}").to_lowercase().contains("not found"),
            "got {refused:?}"
        );

        let status: String = sqlx::query_scalar("SELECT status FROM ai_action_drafts WHERE id=$1")
            .bind(&draft.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            status, "executing",
            "the refused cancel must not have moved the draft"
        );

        // And the confirmation it was competing with still completes.
        let approved = confirm_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "approver-1",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: "claimed-cancel-key".into(),
            },
        )
        .await
        .expect("the claimed confirmation finishes");
        assert_eq!(approved.status, "approved");

        let tasks: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM staff_tasks WHERE tenant_id=$1 AND origin_action_draft_id=$2",
        )
        .bind(&tenant_id)
        .bind(&draft.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(tasks, 1);
    }

    /// The other order, equally deterministic: cancellation lands first, so the
    /// confirmation finds nothing to claim and nothing is ever written.
    #[sqlx::test]
    async fn a_cancelled_draft_can_no_longer_execute(pool: PgPool) {
        let (tenant_id, branch_id, staff_id) = seed(&pool).await;
        let draft = create_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "user-1",
            CreateDraftRequest {
                action_type: "create_coaching_task".into(),
                payload: json!({
                    "staffId": staff_id,
                    "title": "Coach on add-on selling",
                }),
                summary: String::new(),
            },
        )
        .await
        .expect("the draft is created");

        cancel_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "canceller-1",
            &draft.id,
        )
        .await
        .expect("an unclaimed draft cancels");

        let refused = confirm_draft(
            &pool,
            &tenant_id,
            &branch_id,
            "manager",
            "approver-1",
            &draft.id,
            ConfirmDraftRequest {
                idempotency_key: "cancelled-confirm-key".into(),
            },
        )
        .await
        .expect_err("a cancelled draft must not execute");
        assert!(
            format!("{refused:?}")
                .to_lowercase()
                .contains("already decided"),
            "got {refused:?}"
        );

        let tasks: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM staff_tasks WHERE tenant_id=$1 AND origin_action_draft_id=$2",
        )
        .bind(&tenant_id)
        .bind(&draft.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(tasks, 0, "a cancelled draft must leave no CRM task");
    }
}
