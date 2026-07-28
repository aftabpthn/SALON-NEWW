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
//! Confirming twice is safe. The idempotency key is unique per tenant and
//! branch, so a replayed confirmation returns the first result and records a
//! `replayed` audit entry instead of acting again.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{models::common::AppError, repositories::ai_action_repository as action_repository};

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
}

impl ActionKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::CreateOfferDraft => "create_offer_draft",
            Self::CreateCampaignDraft => "create_campaign_draft",
            Self::CreateWhatsAppDraft => "create_whatsapp_draft",
            Self::CreateFollowUpTask => "create_follow_up_task",
            Self::PrepareBookingDraft => "prepare_booking_draft",
            Self::PrepareMembershipRenewal => "prepare_membership_renewal",
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

    pub fn all() -> [Self; 11] {
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
            Self::CreateOfferDraft | Self::CreateCampaignDraft => {
                &["owner", "admin", "manager"]
            }
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

#[derive(Debug, Deserialize)]
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
        audit(db, tenant_id, branch_id, None, kind, "refused", user_id, role,
            "role may not draft this action").await;
        return Err(AppError::forbidden("this action is not available for your role"));
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
    audit(db, tenant_id, branch_id, Some(&record.id), kind, "drafted", user_id, role, "").await;
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
    if let Some(existing) = action_repository::by_idempotency_key(
        db,
        tenant_id,
        branch_id,
        idempotency_key,
    )
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
            audit(db, tenant_id, branch_id, Some(&existing.id), kind, "refused", user_id, role,
                "role may not replay this approval").await;
            return Err(AppError::forbidden("this action is not available for your role"));
        }
        audit(db, tenant_id, branch_id, Some(&existing.id), kind, "replayed", user_id, role,
            "approval replayed with the same key").await;
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
        audit(db, tenant_id, branch_id, Some(&record.id), kind, "refused", user_id, role,
            "role may not confirm this action").await;
        return Err(AppError::forbidden("this action is not available for your role"));
    }
    if record.status != "draft" {
        audit(db, tenant_id, branch_id, Some(&record.id), kind, "refused", user_id, role,
            "draft was already decided").await;
        return Err(AppError::conflict("that action draft was already decided"));
    }

    // Approval records the decision and hands the user to the screen that owns
    // the change. Nothing is published, sent, charged or confirmed here.
    let result = json!({
        "approved": true,
        "executed": false,
        "route": kind.route(),
        "note": kind.confirmation_note(),
    });
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

    audit(db, tenant_id, branch_id, Some(&approved.id), kind, "approved", user_id, role, "").await;
    Ok(to_draft(approved))
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
        audit(db, tenant_id, branch_id, Some(&record.id), kind, "cancelled", user_id, role, "")
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
        db, tenant_id, branch_id, draft_id, kind.name(), event, actor_id, actor_role, detail,
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
            first.refresh_targets.contains(&"marketing.offers".to_string()),
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
        assert_eq!(approved, 1, "a replayed confirmation must not approve twice");

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
        assert!(again.is_err(), "an already-decided draft must not approve again");

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
        assert!(refused.is_err(), "an unauthorized confirmation must be refused");

        // The draft is untouched.
        let still: String =
            sqlx::query_scalar("SELECT status FROM ai_action_drafts WHERE id=$1")
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
