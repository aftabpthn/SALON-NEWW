//! Permission-checked CRM tools the AI copilot can run.
//!
//! The language model never touches the database. This module maps a question to
//! one allow-listed read tool, runs it against the repositories the CRM already
//! uses, and returns a factual answer with the evidence and date range behind it.
//! The result is both a deterministic reply on its own and the grounding context
//! handed to the AI provider, so the provider analyses real numbers instead of
//! inventing them.

use chrono::{Duration, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::{
        ai_copilot_repository as copilot_repository, clients_repository,
        membership_lifecycle_repository,
    },
};

/// Comparison window for every trend tool, and the previous window it is measured against.
const TREND_DAYS: i32 = 30;
/// Days a visit needs before its rebooking outcome is considered settled.
const REBOOK_WINDOW_DAYS: i32 = 14;
/// A client counts as lapsed once they pass this many days without a visit.
const LAPSED_DAYS: i32 = 60;
const ROW_LIMIT: i64 = 8;

/// The allow-listed read tools. Adding a variant is the only way to widen access.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CopilotTool {
    StaffPerformanceDecline,
    BillingHowTo,
    MembershipStatus,
    ServiceDecline,
    ServiceOffer,
    LapsedClients,
    ClientReturnForecast,
    ClientFavouriteService,
    ClientOffer,
}

impl CopilotTool {
    pub fn name(self) -> &'static str {
        match self {
            Self::StaffPerformanceDecline => "staff_performance_decline",
            Self::BillingHowTo => "billing_how_to",
            Self::MembershipStatus => "membership_status",
            Self::ServiceDecline => "service_decline",
            Self::ServiceOffer => "service_offer",
            Self::LapsedClients => "lapsed_clients",
            Self::ClientReturnForecast => "client_return_forecast",
            Self::ClientFavouriteService => "client_favourite_service",
            Self::ClientOffer => "client_offer",
        }
    }

    /// Tools that expose money or margin need a finance-capable role.
    fn needs_financials(self) -> bool {
        matches!(
            self,
            Self::StaffPerformanceDecline
                | Self::ServiceDecline
                | Self::ServiceOffer
                | Self::ClientOffer
        )
    }

    /// Roles allowed to run the tool at all, before the financial check.
    fn allowed_roles(self) -> &'static [&'static str] {
        match self {
            // Staff comparisons are management information, not floor information.
            Self::StaffPerformanceDecline => &["owner", "admin", "manager", "analyst"],
            Self::ServiceDecline | Self::ServiceOffer | Self::ClientOffer => {
                &["owner", "admin", "manager", "analyst", "accountant"]
            }
            Self::BillingHowTo => &[
                "owner",
                "admin",
                "manager",
                "staff",
                "frontdesk",
                "receptionist",
                "accountant",
                "analyst",
                "inventorymanager",
            ],
            Self::MembershipStatus
            | Self::LapsedClients
            | Self::ClientReturnForecast
            | Self::ClientFavouriteService => &[
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

    fn permitted_for(self, role: &str) -> bool {
        let role = role.to_ascii_lowercase();
        self.allowed_roles().contains(&role.as_str())
            && (!self.needs_financials() || can_view_financials(&role))
    }
}

pub fn can_view_financials(role: &str) -> bool {
    matches!(
        role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager" | "accountant" | "analyst"
    )
}

/// One measured quantity stated as current vs previous, with the change between.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotMetric {
    pub label: String,
    /// Pre-formatted for display (currency, percent or plain count).
    pub current: String,
    pub previous: String,
    /// Percent change, or `None` when the previous period was zero.
    pub change_percent: Option<i64>,
    /// `up`, `down` or `flat` — the direction of the change.
    pub direction: String,
}

impl CopilotMetric {
    /// Builds a metric from two raw numbers using `format` for display.
    fn new(
        label: impl Into<String>,
        previous: i64,
        current: i64,
        format: fn(i64) -> String,
    ) -> Self {
        Self {
            label: label.into(),
            current: format(current),
            previous: format(previous),
            // A percent change against a zero baseline is meaningless, not infinite.
            change_percent: (previous != 0).then(|| (current - previous) * 100 / previous),
            direction: match current.cmp(&previous) {
                std::cmp::Ordering::Greater => "up",
                std::cmp::Ordering::Less => "down",
                std::cmp::Ordering::Equal => "flat",
            }
            .into(),
        }
    }
}

/// Something the user can do next. The copilot only ever proposes: a proposal
/// carries a CRM route and a prefilled payload, never a completed change.
///
/// Read-only proposals just navigate. Proposals that would change business data
/// are marked `requires_approval`, and even then the copilot does not perform
/// them — the user completes the change in the CRM screen that owns it, which
/// keeps that screen's own permission checks, validation and audit in force.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotProposal {
    /// Stable identifier, e.g. `open_staff_report`.
    pub kind: String,
    /// Button text, e.g. "Open Staff Report".
    pub label: String,
    /// CRM route to open.
    pub route: String,
    /// Values to prefill on that screen. Never applied automatically.
    pub params: Value,
    /// True when completing this would change business data.
    pub requires_approval: bool,
    /// What the user is being asked to approve, stated plainly. Empty when the
    /// proposal is read-only.
    pub approval_prompt: String,
}

/// The proposals the copilot may raise. Adding a variant is the only way to
/// widen what it can suggest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalKind {
    OpenStaffReport,
    ViewClient,
    OpenMembership,
    CreateOfferDraft,
    PrepareWhatsAppDraft,
    ContinueBilling,
    PrepareBookingDraft,
}

impl ProposalKind {
    fn id(self) -> &'static str {
        match self {
            Self::OpenStaffReport => "open_staff_report",
            Self::ViewClient => "view_client",
            Self::OpenMembership => "open_membership",
            Self::CreateOfferDraft => "create_offer_draft",
            Self::PrepareWhatsAppDraft => "prepare_whatsapp_draft",
            Self::ContinueBilling => "continue_billing",
            Self::PrepareBookingDraft => "prepare_booking_draft",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::OpenStaffReport => "Open Staff Report",
            Self::ViewClient => "View Client",
            Self::OpenMembership => "Open Membership",
            Self::CreateOfferDraft => "Create Offer Draft",
            Self::PrepareWhatsAppDraft => "Prepare WhatsApp Draft",
            Self::ContinueBilling => "Continue Billing",
            Self::PrepareBookingDraft => "Prepare Booking Draft",
        }
    }

    /// Whether completing this proposal would change business data. Publishing
    /// an offer, sending a message, discounting, refunding and confirming a
    /// booking all sit behind this flag.
    fn requires_approval(self) -> bool {
        match self {
            // Navigation only — opening a screen changes nothing.
            Self::OpenStaffReport | Self::ViewClient | Self::OpenMembership => false,
            Self::CreateOfferDraft
            | Self::PrepareWhatsAppDraft
            | Self::ContinueBilling
            | Self::PrepareBookingDraft => true,
        }
    }

    /// States exactly what the user is approving, and what is still not done.
    fn approval_prompt(self) -> &'static str {
        match self {
            Self::CreateOfferDraft => {
                "This opens a prefilled offer draft. Nothing is published until you review the discount and publish it yourself."
            }
            Self::PrepareWhatsAppDraft => {
                "This opens a prefilled WhatsApp message. Nothing is sent until you review the text and send it yourself."
            }
            Self::ContinueBilling => {
                "This opens the bill in POS. No payment, discount or refund is applied until you complete it yourself."
            }
            Self::PrepareBookingDraft => {
                "This opens a prefilled booking. No appointment is confirmed until you confirm it yourself."
            }
            _ => "",
        }
    }

    /// Roles allowed to be offered this proposal at all.
    fn allowed_roles(self) -> &'static [&'static str] {
        const FLOOR: &[&str] = &[
            "owner",
            "admin",
            "manager",
            "staff",
            "frontdesk",
            "receptionist",
        ];
        match self {
            // Staff performance reporting is management information.
            Self::OpenStaffReport => &["owner", "admin", "manager", "analyst"],
            // Discounting is governed, so only roles that may set one see it.
            Self::CreateOfferDraft => &["owner", "admin", "manager"],
            // Outbound messaging is limited to roles that own client comms.
            Self::PrepareWhatsAppDraft => {
                &["owner", "admin", "manager", "frontdesk", "receptionist"]
            }
            Self::ViewClient | Self::OpenMembership => FLOOR,
            Self::ContinueBilling | Self::PrepareBookingDraft => FLOOR,
        }
    }

    fn permitted_for(self, role: &str) -> bool {
        self.allowed_roles()
            .contains(&role.to_ascii_lowercase().as_str())
    }

    /// Builds the proposal for a route and prefill payload.
    fn proposal(self, route: impl Into<String>, params: Value) -> CopilotProposal {
        CopilotProposal {
            kind: self.id().into(),
            label: self.label().into(),
            route: route.into(),
            params,
            requires_approval: self.requires_approval(),
            approval_prompt: self.approval_prompt().into(),
        }
    }
}

/// The date range an answer covers, stated explicitly so it can be checked.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotPeriod {
    /// Human-readable summary, e.g. "Last 30 days vs the previous 30 days".
    pub label: String,
    pub start: String,
    pub end: String,
    /// Empty for tools that do not compare against an earlier period.
    pub previous_start: String,
    pub previous_end: String,
}

/// A grounded answer: what was found, the evidence behind it, and what to do next.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotAnswer {
    pub tool: String,
    /// One-line factual conclusion.
    pub headline: String,
    /// Which branch the figures describe.
    pub branch_name: String,
    /// The exact dates behind the figures.
    pub period: CopilotPeriod,
    /// Headline quantities as current vs previous with the change between them.
    pub metrics: Vec<CopilotMetric>,
    /// Why the numbers moved, derived from the data — not a restatement of them.
    pub reason: String,
    /// The supporting figures, one statement per line.
    pub evidence: Vec<String>,
    pub recommended_action: String,
    /// CRM screen the user should open to act on this. The first proposal's route.
    pub deep_link: String,
    /// What the user can do next. Nothing here has been done for them.
    pub proposals: Vec<CopilotProposal>,
    /// `high`, `medium` or `low` — how much the data supports the conclusion.
    pub confidence: String,
    /// Structured rows for the UI; never free text.
    pub data: Value,
}

impl CopilotAnswer {
    fn new(tool: CopilotTool, headline: impl Into<String>) -> Self {
        Self {
            tool: tool.name().into(),
            headline: headline.into(),
            branch_name: String::new(),
            period: CopilotPeriod::default(),
            metrics: Vec::new(),
            reason: String::new(),
            evidence: Vec::new(),
            recommended_action: String::new(),
            deep_link: String::new(),
            proposals: Vec::new(),
            confidence: "medium".into(),
            data: json!({}),
        }
    }

    fn evidence(mut self, line: impl Into<String>) -> Self {
        self.evidence.push(line.into());
        self
    }

    /// Marks the answer as covering the standard current-vs-previous windows.
    fn trend_period(mut self) -> Self {
        self.period = trend_period();
        self
    }

    /// Marks the answer as covering a single window ending today.
    fn single_period(mut self, label: impl Into<String>, days: i64) -> Self {
        let today = Utc::now().date_naive();
        self.period = CopilotPeriod {
            label: label.into(),
            start: (today - Duration::days(days)).to_string(),
            end: today.to_string(),
            previous_start: String::new(),
            previous_end: String::new(),
        };
        self
    }

    fn metric(mut self, metric: CopilotMetric) -> Self {
        self.metrics.push(metric);
        self
    }

    fn reason(mut self, reason: impl Into<String>) -> Self {
        self.reason = reason.into();
        self
    }

    fn action(mut self, action: impl Into<String>, deep_link: impl Into<String>) -> Self {
        self.recommended_action = action.into();
        self.deep_link = deep_link.into();
        self
    }

    /// Adds something the user can do next. Nothing is performed here.
    fn propose(mut self, kind: ProposalKind, route: impl Into<String>, params: Value) -> Self {
        self.proposals.push(kind.proposal(route, params));
        self
    }

    fn confidence(mut self, confidence: &'static str) -> Self {
        self.confidence = confidence.into();
        self
    }

    fn data(mut self, data: Value) -> Self {
        self.data = data;
        self
    }

    /// Renders the answer as the deterministic chat reply, in the order a reader
    /// needs it: what, where, when, by how much, why, and what to do.
    pub fn to_reply(&self) -> String {
        let mut reply = self.headline.clone();
        if !self.branch_name.is_empty() {
            reply.push_str(&format!("\nBranch: {}", self.branch_name));
        }
        if !self.period.label.is_empty() {
            reply.push_str(&format!("\nPeriod: {}", self.period_line()));
        }
        for metric in &self.metrics {
            reply.push_str(&format!(
                "\n{}: {} → {}{}",
                metric.label,
                metric.previous,
                metric.current,
                match metric.change_percent {
                    Some(change) => format!(" ({change:+}%)"),
                    None => String::new(),
                }
            ));
        }
        if !self.reason.is_empty() {
            reply.push_str(&format!("\nWhy: {}", self.reason));
        }
        for line in &self.evidence {
            reply.push_str(&format!("\n• {line}"));
        }
        if !self.recommended_action.is_empty() {
            reply.push_str(&format!("\nNext step: {}", self.recommended_action));
        }
        reply.push_str(&format!("\nConfidence: {}", self.confidence));
        reply
    }

    /// Period label with the concrete dates appended.
    fn period_line(&self) -> String {
        if self.period.start.is_empty() {
            return self.period.label.clone();
        }
        let mut line = format!(
            "{} ({} to {}",
            self.period.label, self.period.start, self.period.end
        );
        if !self.period.previous_start.is_empty() {
            line.push_str(&format!(
                "; previous {} to {}",
                self.period.previous_start, self.period.previous_end
            ));
        }
        line.push(')');
        line
    }
}

/// The two comparison windows every trend tool uses, as explicit dates.
fn trend_period() -> CopilotPeriod {
    let today = Utc::now().date_naive();
    let days = i64::from(TREND_DAYS);
    CopilotPeriod {
        label: comparison_period(),
        start: (today - Duration::days(days)).to_string(),
        end: today.to_string(),
        previous_start: (today - Duration::days(days * 2)).to_string(),
        previous_end: (today - Duration::days(days)).to_string(),
    }
}

/// Why no tool answered, so the caller can explain rather than fail silently.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolRefusal {
    /// The question did not match any tool.
    NoMatch,
    /// A tool matched but the role may not run it.
    Forbidden(CopilotTool),
}

/// A matched tool plus the candidate client/service names pulled from the question.
#[derive(Debug, Clone)]
pub struct ToolMatch {
    pub tool: CopilotTool,
    /// Search terms to try in order; the first that resolves to a client wins.
    /// Ordered most-specific first, so a full name beats a single given name.
    pub subject_candidates: Vec<String>,
}

/// Maps a question to at most one tool. Matching is deterministic and keyword based,
/// covering the English and Hinglish phrasings salon staff actually type.
pub fn detect(message: &str) -> Option<ToolMatch> {
    let text = message.to_ascii_lowercase();
    let tool = detect_tool(&text)?;
    Some(ToolMatch {
        tool,
        subject_candidates: subject_of(message, &text),
    })
}

fn detect_tool(text: &str) -> Option<CopilotTool> {
    // "X ko offer dein" names a person as the recipient even without the word
    // "client", which is how these questions are actually typed. A service
    // question uses "par"/"on" instead, so the two stay distinguishable.
    let about_client = has_any(text, &["client", "customer", "grahak", "ग्राहक"])
        || text.contains(" ko ")
        || text.ends_with(" ko")
        || text.contains(" ke liye")
        || text.contains(" को ");
    let about_offer = has_any(text, &["offer", "discount", "scheme", "deal", "ऑफर"]);
    let about_service = has_any(text, &["service", "treatment", "सर्विस", "सेवा"]);
    let declining = has_any(
        text,
        &[
            "kam ho", "kam ha", "declin", "drop", "down", "falling", "weak", "poor", "low",
            "gir rah", "घट", "कम",
        ],
    );

    // Most specific intents first: an offer question about a client is not a
    // service question, and a billing how-to is not a sales report.
    if has_any(
        text,
        &[
            "bill kaise",
            "bill kese",
            "invoice kaise",
            "billing kaise",
            "how to bill",
            "how do i bill",
            "how to create an invoice",
            "how to make a bill",
            "billing steps",
            "bill banega",
            "bill banane",
            "बिल कैसे",
        ],
    ) {
        return Some(CopilotTool::BillingHowTo);
    }
    if has_any(
        text,
        &["membership", "renewal", "renew", "मेंबरशिप", "सदस्यता"],
    ) {
        return Some(CopilotTool::MembershipStatus);
    }
    if about_client && about_offer {
        return Some(CopilotTool::ClientOffer);
    }
    if about_offer && about_service {
        return Some(CopilotTool::ServiceOffer);
    }
    if has_any(
        text,
        &[
            "nahi aaye",
            "nahi aae",
            "nahi aa rahe",
            "not returned",
            "not come back",
            "havent visited",
            "haven't visited",
            "lapsed",
            "inactive client",
            "churn",
            "win back",
            "winback",
            "नहीं आए",
        ],
    ) {
        return Some(CopilotTool::LapsedClients);
    }
    if has_any(
        text,
        &[
            "kitne din baad",
            "kab aayega",
            "kab aaega",
            "when will",
            "next visit",
            "return date",
            "come back",
            "कितने दिन",
            "कब आएगा",
        ],
    ) {
        return Some(CopilotTool::ClientReturnForecast);
    }
    if has_any(
        text,
        &[
            "regular kaunsi",
            "regular konsi",
            "favourite service",
            "favorite service",
            "usual service",
            "kaunsi service leta",
            "konsi service leta",
            "kaunsi service leti",
            "which service does",
        ],
    ) {
        return Some(CopilotTool::ClientFavouriteService);
    }
    if has_any(text, &["staff", "stylist", "therapist", "employee", "स्टाफ"]) && declining
    {
        return Some(CopilotTool::StaffPerformanceDecline);
    }
    if about_service && declining {
        return Some(CopilotTool::ServiceDecline);
    }
    if about_offer {
        return Some(CopilotTool::ServiceOffer);
    }
    None
}

/// Words that describe the question rather than name the thing being asked about.
/// Covers the English and Hinglish question words these tools are asked in.
const SUBJECT_STOPWORDS: &[&str] = &[
    "aa",
    "aae",
    "aaega",
    "aaegi",
    "aayega",
    "aayegi",
    "about",
    "and",
    "any",
    "are",
    "baad",
    "back",
    "banega",
    "best",
    "bill",
    "can",
    "chahiye",
    "client",
    "clients",
    "come",
    "customer",
    "customers",
    "days",
    "dein",
    "den",
    "dena",
    "din",
    "discount",
    "does",
    "for",
    "from",
    "get",
    "give",
    "gaya",
    "hai",
    "hain",
    "has",
    "have",
    "her",
    "him",
    "his",
    "how",
    "inactive",
    "is",
    "it",
    "jaata",
    "jata",
    "kab",
    "kaise",
    "kar",
    "karna",
    "kaun",
    "kaunsa",
    "kaunse",
    "kaunsi",
    "kese",
    "kitne",
    "konsa",
    "konse",
    "konsi",
    "kya",
    "lapsed",
    "last",
    "leta",
    "leti",
    "lete",
    "list",
    "many",
    "me",
    "mein",
    "membership",
    "much",
    "my",
    "nahi",
    "next",
    "not",
    "offer",
    "offers",
    "our",
    "raha",
    "rahe",
    "rahi",
    "regular",
    "renew",
    "renewal",
    "return",
    "sakta",
    "sakti",
    "scheme",
    "service",
    "services",
    "she",
    "should",
    "show",
    "status",
    "the",
    "their",
    "them",
    "there",
    "they",
    "this",
    "usual",
    "visit",
    "was",
    "we",
    "what",
    "when",
    "which",
    "who",
    "why",
    "will",
    "with",
    "you",
    "your",
];

/// Pulls candidate client names out of a question by dropping the question words.
/// Returns search terms most-specific first: the full remaining phrase, then each
/// surviving word on its own, so "Anita Sharma" is tried before "Anita".
fn subject_of(original: &str, lowercase: &str) -> Vec<String> {
    // A quoted name is unambiguous, so it wins outright.
    if let Some(quoted) = original.split('"').nth(1) {
        let quoted = quoted.trim();
        if !quoted.is_empty() {
            return vec![quoted.to_string()];
        }
    }
    // A run of digits is a phone number.
    let digits = lowercase
        .chars()
        .filter(|character| character.is_ascii_digit())
        .collect::<String>();
    if digits.len() >= 6 {
        return vec![digits];
    }
    let words = original
        .split(|character: char| !character.is_alphanumeric() && character != '\'')
        .filter(|word| {
            let lower = word.to_ascii_lowercase();
            word.chars().count() > 2
                && !lower.chars().all(|character| character.is_ascii_digit())
                && !SUBJECT_STOPWORDS.contains(&lower.as_str())
        })
        .map(str::to_string)
        .collect::<Vec<_>>();

    let mut candidates = Vec::new();
    if words.len() > 1 {
        candidates.push(words.join(" "));
    }
    candidates.extend(words);
    candidates
}

fn has_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

/// Runs a matched tool after checking the caller's role.
pub async fn run(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    role: &str,
    matched: &ToolMatch,
) -> Result<CopilotAnswer, ToolRefusal> {
    if !matched.tool.permitted_for(role) {
        return Err(ToolRefusal::Forbidden(matched.tool));
    }
    let subject = matched.subject_candidates.as_slice();
    let answer = match matched.tool {
        CopilotTool::StaffPerformanceDecline => {
            staff_performance_decline(db, tenant_id, branch_id).await
        }
        CopilotTool::BillingHowTo => Ok(billing_how_to()),
        CopilotTool::ServiceDecline => service_decline(db, tenant_id, branch_id).await,
        CopilotTool::ServiceOffer => service_offer(db, tenant_id, branch_id).await,
        CopilotTool::LapsedClients => lapsed_clients(db, tenant_id, branch_id).await,
        CopilotTool::MembershipStatus => {
            client_scoped(
                db,
                tenant_id,
                branch_id,
                subject,
                matched.tool,
                membership_status,
            )
            .await
        }
        CopilotTool::ClientReturnForecast => {
            client_scoped(
                db,
                tenant_id,
                branch_id,
                subject,
                matched.tool,
                return_forecast,
            )
            .await
        }
        CopilotTool::ClientFavouriteService => {
            client_scoped(
                db,
                tenant_id,
                branch_id,
                subject,
                matched.tool,
                favourite_service,
            )
            .await
        }
        CopilotTool::ClientOffer => {
            client_scoped(
                db,
                tenant_id,
                branch_id,
                subject,
                matched.tool,
                client_offer,
            )
            .await
        }
    };
    // A tool that cannot read its data must not fall through to an invented answer.
    let mut answer = answer.map_err(|error| {
        tracing::warn!(
            tool = matched.tool.name(),
            error = error.message(),
            "copilot tool failed"
        );
        ToolRefusal::NoMatch
    })?;
    // Every answer names the branch it describes, so figures are never ambiguous
    // for a user who can switch branches.
    answer.branch_name = copilot_repository::branch_name(db, tenant_id, branch_id)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| branch_id.to_string());
    // Never offer a next step the caller is not allowed to take. Gating here
    // means a tool cannot accidentally expose one by forgetting the check.
    answer.proposals.retain(|proposal| {
        proposal_kind(&proposal.kind).is_some_and(|kind| kind.permitted_for(role))
    });
    Ok(answer)
}

/// Resolves a serialized proposal id back to its kind.
fn proposal_kind(id: &str) -> Option<ProposalKind> {
    [
        ProposalKind::OpenStaffReport,
        ProposalKind::ViewClient,
        ProposalKind::OpenMembership,
        ProposalKind::CreateOfferDraft,
        ProposalKind::PrepareWhatsAppDraft,
        ProposalKind::ContinueBilling,
        ProposalKind::PrepareBookingDraft,
    ]
    .into_iter()
    .find(|kind| kind.id() == id)
}

// ---------------------------------------------------------------------------
// Branch-wide tools
// ---------------------------------------------------------------------------

async fn staff_performance_decline(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<CopilotAnswer, AppError> {
    let rows = copilot_repository::staff_performance_trend(
        db,
        tenant_id,
        branch_id,
        TREND_DAYS,
        ROW_LIMIT,
        REBOOK_WINDOW_DAYS,
    )
    .await
    .map_err(|_| AppError::internal("failed to load staff performance trend"))?;

    let declining = rows
        .iter()
        .filter(|row| row.current_revenue_paise < row.previous_revenue_paise)
        .collect::<Vec<_>>();
    // Branch totals frame every individual comparison below.
    let branch_previous: i64 = rows.iter().map(|row| row.previous_revenue_paise).sum();
    let branch_current: i64 = rows.iter().map(|row| row.current_revenue_paise).sum();

    if declining.is_empty() {
        return Ok(CopilotAnswer::new(
            CopilotTool::StaffPerformanceDecline,
            "No staff member has lower service revenue than the previous 30 days.",
        )
        .trend_period()
        .metric(CopilotMetric::new(
            "Branch service revenue",
            branch_previous,
            branch_current,
            rupees,
        ))
        .action("Keep the current roster and incentives.", "/staff")
        .confidence(if rows.is_empty() { "low" } else { "high" })
        .data(json!({ "staff": rows })));
    }

    let worst = declining[0];
    let mut answer = CopilotAnswer::new(
        CopilotTool::StaffPerformanceDecline,
        format!(
            "{} staff member{} earned less service revenue than the previous 30 days; {} dropped most.",
            declining.len(),
            if declining.len() == 1 { "" } else { "s" },
            worst.staff_name
        ),
    )
    .trend_period()
    .metric(CopilotMetric::new(
        format!("{} revenue", worst.staff_name),
        worst.previous_revenue_paise,
        worst.current_revenue_paise,
        rupees,
    ))
    .metric(CopilotMetric::new(
        format!("{} completed visits", worst.staff_name),
        worst.previous_completed,
        worst.current_completed,
        |value| value.to_string(),
    ))
    .metric(CopilotMetric::new(
        "Branch service revenue",
        branch_previous,
        branch_current,
        rupees,
    ));
    if worst.previous_scheduled_minutes > 0 && worst.current_scheduled_minutes > 0 {
        answer = answer.metric(CopilotMetric::new(
            format!("{} utilization", worst.staff_name),
            percent_of(
                worst.previous_booked_minutes,
                worst.previous_scheduled_minutes,
            ),
            percent_of(
                worst.current_booked_minutes,
                worst.current_scheduled_minutes,
            ),
            |value| format!("{value}%"),
        ));
    }

    // Explain the drop from the data: more cancellations, weaker rebooking, or
    // simply fewer visits — whichever the numbers actually support.
    answer = answer.reason(staff_decline_reason(worst));

    for row in declining.iter().take(3) {
        let mut line = format!(
            "{}: revenue {} → {} ({}), completed visits {} → {}",
            row.staff_name,
            rupees(row.previous_revenue_paise),
            rupees(row.current_revenue_paise),
            signed_change(row.previous_revenue_paise, row.current_revenue_paise),
            row.previous_completed,
            row.current_completed
        );
        if row.current_cancelled > row.previous_cancelled {
            line.push_str(&format!(
                ", cancellations {} → {}",
                row.previous_cancelled, row.current_cancelled
            ));
        }
        if row.current_scheduled_minutes > 0 && row.previous_scheduled_minutes > 0 {
            line.push_str(&format!(
                ", utilization {}% → {}%",
                percent_of(row.previous_booked_minutes, row.previous_scheduled_minutes),
                percent_of(row.current_booked_minutes, row.current_scheduled_minutes)
            ));
        }
        // Only quote a rebooking rate when enough visits are old enough to judge.
        if row.previous_rebook_eligible >= 3 && row.current_rebook_eligible >= 3 {
            line.push_str(&format!(
                ", rebooking {}% → {}%",
                percent_of(row.previous_rebooked, row.previous_rebook_eligible),
                percent_of(row.current_rebooked, row.current_rebook_eligible)
            ));
        }
        answer = answer.evidence(line);
    }
    if declining
        .iter()
        .any(|row| row.current_rebook_eligible < 3 || row.previous_scheduled_minutes == 0)
    {
        answer = answer.evidence(
            "Rebooking and utilization are omitted where too few visits or no roster exist to measure them.",
        );
    }

    Ok(answer
        .action(
            format!(
                "Review {}'s roster, service mix and cancellations first — it is the largest drop.",
                worst.staff_name
            ),
            format!("/staff/{}", worst.staff_id),
        )
        .propose(
            ProposalKind::OpenStaffReport,
            format!("/staff/{}", worst.staff_id),
            json!({ "staffId": worst.staff_id, "staffName": worst.staff_name }),
        )
        .confidence(if worst.previous_completed >= 5 {
            "high"
        } else {
            "low"
        })
        .data(json!({ "staff": rows })))
}

/// Picks the strongest supported explanation for one staff member's decline.
fn staff_decline_reason(row: &copilot_repository::StaffPerformanceTrendRow) -> String {
    let lost_visits = row.previous_completed - row.current_completed;
    let extra_cancellations = (row.current_cancelled + row.current_no_show)
        - (row.previous_cancelled + row.previous_no_show);

    // Cancellations explain the drop when they account for a real share of it.
    if extra_cancellations > 0 && lost_visits > 0 && extra_cancellations * 2 >= lost_visits {
        return format!(
            "Cancellations and no-shows rose by {extra_cancellations} while completed visits fell by {lost_visits}, so lost bookings explain most of the drop."
        );
    }
    // A rebooking fall is only citable when both windows have enough settled visits.
    if row.previous_rebook_eligible >= 3 && row.current_rebook_eligible >= 3 {
        let previous_rate = percent_of(row.previous_rebooked, row.previous_rebook_eligible);
        let current_rate = percent_of(row.current_rebooked, row.current_rebook_eligible);
        if current_rate + 10 < previous_rate {
            return format!(
                "Rebooking fell from {previous_rate}% to {current_rate}%, so clients are not being booked back in at checkout."
            );
        }
    }
    if row.current_scheduled_minutes > 0 && row.previous_scheduled_minutes > 0 {
        let previous_utilization =
            percent_of(row.previous_booked_minutes, row.previous_scheduled_minutes);
        let current_utilization =
            percent_of(row.current_booked_minutes, row.current_scheduled_minutes);
        if current_utilization + 10 < previous_utilization {
            return format!(
                "Utilization fell from {previous_utilization}% to {current_utilization}%, so rostered hours are going unbooked."
            );
        }
        if row.current_scheduled_minutes < row.previous_scheduled_minutes {
            return format!(
                "Rostered time fell from {} to {} hours, so there was less capacity to sell.",
                row.previous_scheduled_minutes / 60,
                row.current_scheduled_minutes / 60
            );
        }
    }
    if lost_visits > 0 {
        return format!(
            "Completed visits fell by {lost_visits} with no rise in cancellations, which points to fewer bookings reaching this staff member."
        );
    }
    "Revenue per visit fell while visit count held, which points to a cheaper service mix or larger discounts.".into()
}

async fn service_decline(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<CopilotAnswer, AppError> {
    let rows = copilot_repository::service_performance_trend(
        db, tenant_id, branch_id, TREND_DAYS, ROW_LIMIT,
    )
    .await
    .map_err(|_| AppError::internal("failed to load service performance trend"))?;
    let declining = rows
        .iter()
        .filter(|row| row.current_revenue_paise < row.previous_revenue_paise)
        .collect::<Vec<_>>();
    let branch_previous: i64 = rows.iter().map(|row| row.previous_revenue_paise).sum();
    let branch_current: i64 = rows.iter().map(|row| row.current_revenue_paise).sum();

    if declining.is_empty() {
        return Ok(CopilotAnswer::new(
            CopilotTool::ServiceDecline,
            "No service earned less than it did in the previous 30 days.",
        )
        .trend_period()
        .metric(CopilotMetric::new(
            "Service revenue",
            branch_previous,
            branch_current,
            rupees,
        ))
        .action("No service needs recovery action right now.", "/services")
        .confidence(if rows.is_empty() { "low" } else { "high" })
        .data(json!({ "services": rows })));
    }

    let worst = declining[0];
    // Ask when in the week this service is weakest, so the answer explains where
    // the demand went instead of only reporting that it fell.
    let weekday_rows =
        copilot_repository::weekday_demand(db, tenant_id, branch_id, TREND_DAYS, &worst.service_id)
            .await
            .map_err(|_| AppError::internal("failed to load weekday demand"))?;
    let weak_window = weakest_window(&weekday_rows);

    let mut answer = CopilotAnswer::new(
        CopilotTool::ServiceDecline,
        format!(
            "{} service{} declined against the previous 30 days; {} fell most.",
            declining.len(),
            if declining.len() == 1 { "" } else { "s" },
            worst.service_name
        ),
    )
    .trend_period()
    .metric(CopilotMetric::new(
        format!("{} bookings", worst.service_name),
        worst.previous_bookings,
        worst.current_bookings,
        |value| value.to_string(),
    ))
    .metric(CopilotMetric::new(
        format!("{} revenue", worst.service_name),
        worst.previous_revenue_paise,
        worst.current_revenue_paise,
        rupees,
    ))
    .metric(CopilotMetric::new(
        format!("{} distinct clients", worst.service_name),
        worst.previous_clients,
        worst.current_clients,
        |value| value.to_string(),
    ));

    answer = answer.reason(match &weak_window {
        Some(window) => weak_window_reason(window, &worst.service_name),
        // Without a weekday signal, fall back to what the totals themselves show.
        None => service_decline_reason(worst),
    });
    if weak_window.is_some() {
        // Show the whole week, with utilization per day where a roster exists,
        // so the quiet run can be checked against the days around it.
        answer = answer.evidence(format!(
            "Weekday split: {}",
            weekday_rows
                .iter()
                .map(|row| match row.utilization_percent() {
                    Some(utilization) => format!(
                        "{} {} ({utilization}% used)",
                        row.weekday_name, row.service_bookings
                    ),
                    None => format!("{} {}", row.weekday_name, row.service_bookings),
                })
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    for row in declining.iter().take(3) {
        answer = answer.evidence(format!(
            "{}: revenue {} → {} ({}), bookings {} → {}, clients {} → {}, repeat clients {}",
            row.service_name,
            rupees(row.previous_revenue_paise),
            rupees(row.current_revenue_paise),
            signed_change(row.previous_revenue_paise, row.current_revenue_paise),
            row.previous_bookings,
            row.current_bookings,
            row.previous_clients,
            row.current_clients,
            row.current_repeat_clients
        ));
    }
    let action = match &weak_window {
        Some(window) => format!(
            "Target {} recovery at {} — that is where the capacity is idle.",
            worst.service_name, window.label
        ),
        None => format!(
            "Check {} first: pricing, staff availability and slot coverage.",
            worst.service_name
        ),
    };
    let mut answer = answer.action(action, "/services");
    if let Some(window) = &weak_window {
        // A draft, not a published offer: the discount still needs a person.
        answer = answer.propose(
            ProposalKind::CreateOfferDraft,
            "/services",
            json!({
                "serviceId": worst.service_id,
                "serviceName": worst.service_name,
                "weekdays": window.weekdays,
                "windowLabel": window.label,
            }),
        );
    }
    Ok(answer
        .confidence(if worst.previous_bookings >= 5 {
            "high"
        } else {
            "low"
        })
        .data(json!({
            "services": rows,
            "weekdayDemand": weekday_rows,
            "weakWindow": weak_window.as_ref().map(|window| json!({
                "label": window.label,
                "weekdays": window.weekdays,
                "utilizationPercent": window.utilization_percent,
                "bookingSharePercent": window.booking_share_percent,
            })),
        })))
}

/// Explains a service decline from its own totals when no weekday signal exists.
fn service_decline_reason(row: &copilot_repository::ServicePerformanceTrendRow) -> String {
    let lost_clients = row.previous_clients - row.current_clients;
    if lost_clients > 0 && row.current_repeat_clients == 0 {
        return format!(
            "{lost_clients} fewer clients booked it and none of the current buyers are repeat clients, so retention on this service has stopped."
        );
    }
    if lost_clients > 0 {
        return format!(
            "{lost_clients} fewer distinct clients booked it, so the drop is lost demand rather than lower prices."
        );
    }
    "The same clients booked it less often, which points to a longer gap between visits rather than lost clients.".into()
}

async fn service_offer(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<CopilotAnswer, AppError> {
    let rows = copilot_repository::service_performance_trend(
        db, tenant_id, branch_id, TREND_DAYS, ROW_LIMIT,
    )
    .await
    .map_err(|_| AppError::internal("failed to load service performance trend"))?;
    // Offer only where demand fell but the service still carries margin to give away.
    let mut candidates = rows
        .iter()
        .filter(|row| {
            row.service_active
                && row.current_bookings < row.previous_bookings
                && row.current_revenue_paise > row.current_product_cost_paise
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|row| -(row.previous_revenue_paise - row.current_revenue_paise));

    let Some(best) = candidates.first() else {
        return Ok(CopilotAnswer::new(
            CopilotTool::ServiceOffer,
            "No service currently combines falling demand with margin headroom for a discount.",
        )
        .trend_period()
        .reason(
            "Every declining service is already at or below its product cost, so a discount would sell at a loss."
                .to_string(),
        )
        .action(
            "Hold discounts; recover demand through scheduling and outreach instead.",
            "/services",
        )
        .confidence(if rows.is_empty() { "low" } else { "medium" })
        .data(json!({ "services": rows })));
    };

    let margin_bps = margin_bps(best.current_revenue_paise, best.current_product_cost_paise);
    // Never suggest giving away more than a third of the measured margin.
    let safe_discount_bps = (margin_bps / 3).clamp(0, 2_000);
    if safe_discount_bps < 100 {
        return Ok(CopilotAnswer::new(
            CopilotTool::ServiceOffer,
            format!(
                "{} is declining but its margin is too thin to discount safely.",
                best.service_name
            ),
        )
        .trend_period()
        .metric(CopilotMetric::new(
            format!("{} bookings", best.service_name),
            best.previous_bookings,
            best.current_bookings,
            |value| value.to_string(),
        ))
        .reason(format!(
            "Measured margin is only {}% after product cost of {}, so a third of it rounds to nothing worth offering.",
            margin_bps / 100,
            rupees(best.current_product_cost_paise)
        ))
        .action(
            "Recover this service with slot and staffing changes rather than price.",
            "/services",
        )
        .confidence("medium")
        .data(json!({ "services": rows })));
    }

    // Find when this service is weakest, so the offer can be aimed at idle
    // capacity instead of discounting slots that were already selling.
    let weekday_rows =
        copilot_repository::weekday_demand(db, tenant_id, branch_id, TREND_DAYS, &best.service_id)
            .await
            .map_err(|_| AppError::internal("failed to load weekday demand"))?;
    let weak_window = weakest_window(&weekday_rows);

    let reason = match &weak_window {
        Some(window) => format!(
            "{} Margin is {}% after product cost, so a discount up to {}% stays margin-safe — which makes a {}-only offer the targeted move.",
            weak_window_reason(window, &best.service_name),
            margin_bps / 100,
            safe_discount_bps / 100,
            window.label
        ),
        None => format!(
            "Bookings fell while margin held at {}% after product cost, so up to {}% can be given away without selling below cost.",
            margin_bps / 100,
            safe_discount_bps / 100
        ),
    };
    let action = match &weak_window {
        Some(window) => format!(
            "Run a {}-only offer on {} at up to {}%, time-boxed, and re-check demand after 30 days.",
            window.label,
            best.service_name,
            safe_discount_bps / 100
        ),
        None => format!(
            "Run a time-boxed offer on {} up to {}% and re-check demand after 30 days.",
            best.service_name,
            safe_discount_bps / 100
        ),
    };

    let mut answer = CopilotAnswer::new(
        CopilotTool::ServiceOffer,
        format!(
            "{} is the safest service to put an offer on.",
            best.service_name
        ),
    )
    .trend_period()
    .metric(CopilotMetric::new(
        format!("{} bookings", best.service_name),
        best.previous_bookings,
        best.current_bookings,
        |value| value.to_string(),
    ))
    .metric(CopilotMetric::new(
        format!("{} revenue", best.service_name),
        best.previous_revenue_paise,
        best.current_revenue_paise,
        rupees,
    ))
    .reason(reason)
    .evidence(format!(
        "Measured margin is {}% after product cost of {}, so up to {}% discount stays margin-safe.",
        margin_bps / 100,
        rupees(best.current_product_cost_paise),
        safe_discount_bps / 100
    ))
    .evidence(
        "Margin uses product cost from the stock ledger only; staff cost is not included."
            .to_string(),
    );
    if let Some(window) = &weak_window {
        if let Some(utilization) = window.utilization_percent {
            answer = answer.evidence(format!(
                "{} utilization is {}% against the rostered hours for those days.",
                window.label, utilization
            ));
        }
    }

    Ok(answer
        .action(action, "/services")
        .propose(
            ProposalKind::CreateOfferDraft,
            "/services",
            json!({
                "serviceId": best.service_id,
                "serviceName": best.service_name,
                "maxDiscountBps": safe_discount_bps,
                "weekdays": weak_window.as_ref().map(|window| window.weekdays.clone()),
                "windowLabel": weak_window.as_ref().map(|window| window.label.clone()),
            }),
        )
        .confidence(if best.current_product_cost_paise > 0 {
            "medium"
        } else {
            "low"
        })
        .data(json!({
            "services": rows,
            "recommendedService": best,
            "safeDiscountBps": safe_discount_bps,
            "weekdayDemand": weekday_rows,
            "weakWindow": weak_window.as_ref().map(|window| json!({
                "label": window.label,
                "weekdays": window.weekdays,
                "utilizationPercent": window.utilization_percent,
                "bookingSharePercent": window.booking_share_percent,
            })),
        })))
}

async fn lapsed_clients(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<CopilotAnswer, AppError> {
    // Reuses the existing client report so the copilot and the report agree.
    let rows = clients_repository::client_report(
        db,
        tenant_id,
        branch_id,
        "lapsed",
        clients_repository::ClientReportFilters {
            days: LAPSED_DAYS,
            limit: 50,
            min_lifetime_value_paise: 0,
            min_visits: 0,
            segment: "",
            max_churn_risk_score: 100,
            include_unpaid: true,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to load lapsed clients"))?;
    let clients = rows.as_array().cloned().unwrap_or_default();
    if clients.is_empty() {
        return Ok(CopilotAnswer::new(
            CopilotTool::LapsedClients,
            format!("No client has been inactive for {LAPSED_DAYS} days or more."),
        )
        .single_period(
            format!("Clients with no visit in the last {LAPSED_DAYS} days"),
            i64::from(LAPSED_DAYS),
        )
        .action("No win-back outreach is needed right now.", "/clients")
        .confidence("high")
        .data(json!({ "clients": [] })));
    }

    // Group by how long they have been away, so outreach can be prioritised.
    let mut buckets = [0_usize; 3];
    for client in &clients {
        let days = client
            .get("recencyDays")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let index = if days >= 180 {
            2
        } else if days >= 90 {
            1
        } else {
            0
        };
        buckets[index] += 1;
    }

    let mut answer = CopilotAnswer::new(
        CopilotTool::LapsedClients,
        format!(
            "{} clients have not visited for {LAPSED_DAYS} days or more.",
            clients.len()
        ),
    )
    .single_period(
        format!("Clients with no visit in the last {LAPSED_DAYS} days"),
        i64::from(LAPSED_DAYS),
    )
    .metric(CopilotMetric::new(
        "Recoverable (60–179 days)",
        clients.len() as i64,
        (buckets[0] + buckets[1]) as i64,
        |value| value.to_string(),
    ))
    .reason(if buckets[2] > buckets[0] + buckets[1] {
        format!(
            "Most of the list ({} of {}) is past 180 days, so this is long-term churn rather than a recent drop-off.",
            buckets[2],
            clients.len()
        )
    } else {
        format!(
            "{} of {} are still inside 180 days, so the loss is recent and most of the list is still recoverable.",
            buckets[0] + buckets[1],
            clients.len()
        )
    })
    .evidence(format!(
        "{}–89 days: {} clients · 90–179 days: {} clients · 180+ days: {} clients",
        LAPSED_DAYS, buckets[0], buckets[1], buckets[2]
    ));
    for client in clients.iter().take(3) {
        answer = answer.evidence(format!(
            "{} — {} days inactive, lifetime value {}",
            client
                .get("clientName")
                .and_then(Value::as_str)
                .unwrap_or("Unnamed client"),
            client
                .get("recencyDays")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            rupees(
                client
                    .get("lifetimeValuePaise")
                    .and_then(Value::as_i64)
                    .unwrap_or_default()
            )
        ));
    }
    // Aim outreach at the most recoverable client, not the longest-lost one.
    let target = clients
        .iter()
        .filter(|client| {
            let days = client
                .get("recencyDays")
                .and_then(Value::as_i64)
                .unwrap_or_default();
            (90..180).contains(&days)
        })
        .max_by_key(|client| {
            client
                .get("lifetimeValuePaise")
                .and_then(Value::as_i64)
                .unwrap_or_default()
        })
        .or_else(|| clients.first());

    let mut answer = answer.action(
        "Start win-back outreach with the 90–179 day group; they are the most recoverable.",
        "/clients",
    );
    if let Some(client) = target {
        let client_id = client
            .get("clientId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let client_name = client
            .get("clientName")
            .and_then(Value::as_str)
            .unwrap_or_default();
        answer = answer
            .propose(
                ProposalKind::ViewClient,
                format!("/clients/{client_id}"),
                json!({ "clientId": client_id, "clientName": client_name }),
            )
            .propose(
                ProposalKind::PrepareWhatsAppDraft,
                format!("/clients/{client_id}"),
                json!({
                    "clientId": client_id,
                    "clientName": client_name,
                    "reason": "win_back",
                    "inactiveDays": client.get("recencyDays").and_then(Value::as_i64),
                }),
            );
    }
    Ok(answer
        .confidence("high")
        .data(json!({ "clients": clients })))
}

fn billing_how_to() -> CopilotAnswer {
    CopilotAnswer::new(
        CopilotTool::BillingHowTo,
        "A bill is created in POS by loading the client, adding service and product lines, then taking payment.",
    )
    .evidence("1. Open POS and select the client, or continue from their appointment.")
    .evidence("2. Add each service line and set the staff member on it, so revenue is attributed correctly.")
    .evidence("3. Add product lines; stock is deducted from inventory when the sale is finalized.")
    .evidence("4. Apply membership, package or coupon benefits — discounts above the approved limit need approval.")
    .evidence("5. Take payment, split across payment modes if needed, then finalize to issue the invoice number.")
    .evidence("6. A finalized invoice can be printed or downloaded as a PDF from POS invoices.")
    .action("Open POS to start the bill.", "/pos")
    .propose(ProposalKind::ContinueBilling, "/pos", json!({}))
    .confidence("high")
    .data(json!({ "invoicesScreen": "/pos/invoices" }))
}

// ---------------------------------------------------------------------------
// Client-scoped tools
// ---------------------------------------------------------------------------

/// Resolves the named client, then hands off to the tool body. Ambiguity is
/// reported back as a question rather than resolved by guessing.
async fn client_scoped<'a, F, Fut>(
    db: &'a PgPool,
    tenant_id: &'a str,
    branch_id: &'a str,
    subject_candidates: &'a [String],
    tool: CopilotTool,
    body: F,
) -> Result<CopilotAnswer, AppError>
where
    F: FnOnce(&'a PgPool, &'a str, &'a str, copilot_repository::CopilotClientMatch) -> Fut,
    Fut: std::future::Future<Output = Result<CopilotAnswer, AppError>>,
{
    if subject_candidates.is_empty() {
        return Ok(CopilotAnswer::new(
            tool,
            "Name the client, and I will answer from their CRM history.",
        )
        .action(
            "Add the client's name or phone number to the question.",
            "/clients",
        )
        .confidence("low"));
    }

    // Try the most specific term first and stop at the first one that resolves.
    let mut resolved = Vec::new();
    let mut used_term = String::new();
    for candidate in subject_candidates {
        let matches = copilot_repository::find_clients(db, tenant_id, branch_id, candidate, 5)
            .await
            .map_err(|_| AppError::internal("failed to resolve client"))?;
        if !matches.is_empty() {
            resolved = matches;
            used_term = candidate.clone();
            break;
        }
    }

    match resolved.len() {
        0 => Ok(CopilotAnswer::new(
            tool,
            format!(
                "No active client matches \"{}\" in this branch.",
                subject_candidates.first().map(String::as_str).unwrap_or("")
            ),
        )
        .action("Check the spelling, or search the client list.", "/clients")
        .confidence("high")),
        1 => {
            body(
                db,
                tenant_id,
                branch_id,
                resolved.into_iter().next().expect("one match"),
            )
            .await
        }
        _ => {
            let names = resolved
                .iter()
                .map(|client| format!("{} ({})", client.client_name, client.phone))
                .collect::<Vec<_>>()
                .join(", ");
            Ok(CopilotAnswer::new(
                tool,
                format!("{} clients match \"{used_term}\".", resolved.len()),
            )
            .evidence(names)
            .action("Ask again with the full name or phone number.", "/clients")
            .confidence("low")
            .data(json!({ "candidates": resolved })))
        }
    }
}

async fn membership_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client: copilot_repository::CopilotClientMatch,
) -> Result<CopilotAnswer, AppError> {
    let memberships = membership_lifecycle_repository::history_for_client(
        db,
        tenant_id,
        branch_id,
        &client.client_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load membership history"))?;
    let credits =
        membership_lifecycle_repository::client_wallet(db, tenant_id, branch_id, &client.client_id)
            .await
            .map_err(|_| AppError::internal("failed to load membership credits"))?;

    let active = memberships
        .iter()
        .find(|record| record.active && record.cancelled_at.is_none());
    let Some(active) = active else {
        let previous = memberships.first();
        return Ok(CopilotAnswer::new(
            CopilotTool::MembershipStatus,
            format!("{} has no active membership.", client.client_name),
        )
        .evidence(match previous {
            Some(record) => format!(
                "Last plan: {}, assigned {}.",
                record.membership_name,
                record.assigned_at.date_naive()
            ),
            None => "No membership has ever been assigned.".into(),
        })
        .action(
            "Offer a plan that matches their usual service mix.",
            "/memberships",
        )
        .confidence("high")
        .data(
            json!({ "memberships": memberships.iter().map(membership_json).collect::<Vec<_>>() }),
        ));
    };

    let mut answer = CopilotAnswer::new(
        CopilotTool::MembershipStatus,
        format!(
            "{} is on the {} plan.",
            client.client_name, active.membership_name
        ),
    );
    let expiry_note = match active.expires_at {
        Some(expires_at) => {
            let days_left = (expires_at - chrono::Utc::now()).num_days();
            if days_left < 0 {
                format!(
                    "Expired {} days ago on {}.",
                    -days_left,
                    expires_at.date_naive()
                )
            } else {
                format!(
                    "Expires on {} ({days_left} days left).",
                    expires_at.date_naive()
                )
            }
        }
        None => "No expiry date is set on this plan.".into(),
    };
    answer = answer.evidence(expiry_note);
    answer = answer.evidence(format!(
        "Remaining service credits: {}.",
        active.remaining_credits
    ));
    if active.frozen_at.is_some() {
        answer = answer.evidence(format!(
            "Plan is frozen{}.",
            active
                .frozen_until
                .map(|until| format!(" until {until}"))
                .unwrap_or_default()
        ));
    }
    for credit in credits.iter().take(3) {
        answer = answer.evidence(format!(
            "{}: {} of {} left{}.",
            credit.service_name,
            credit.remaining_qty,
            credit.total_qty,
            credit
                .expires_at
                .map(|date| format!(", expiring {date}"))
                .unwrap_or_default()
        ));
    }
    answer = answer.evidence(format!(
        "Auto-renew is {}.",
        if active.auto_renew_enabled {
            "on"
        } else {
            "off"
        }
    ));

    // Renewal is worth raising once the plan is inside its last 30 days.
    let days_left = active
        .expires_at
        .map(|expires_at| (expires_at - Utc::now()).num_days());
    let renewal_due = days_left.is_some_and(|days| days <= 30);
    answer = answer.reason(match (days_left, active.auto_renew_enabled) {
        (Some(days), false) if days < 0 => format!(
            "The plan lapsed {} days ago with auto-renew off, so it will not restart on its own.",
            -days
        ),
        (Some(days), false) if days <= 30 => format!(
            "Only {days} days remain and auto-renew is off, so renewal needs a manual conversation now."
        ),
        (Some(days), true) if days <= 30 => format!(
            "{days} days remain and auto-renew is on, so the risk is a failed payment rather than a lapsed plan."
        ),
        (Some(days), _) => format!("{days} days remain, so there is no renewal pressure yet."),
        (None, _) => "The plan has no expiry date, so renewal is not time-driven.".into(),
    });
    Ok(answer
        .action(
            if renewal_due && !active.auto_renew_enabled {
                "Offer renewal now — the plan ends within 30 days and auto-renew is off."
            } else if renewal_due {
                "Confirm the auto-renew payment method before the plan ends."
            } else {
                "No renewal action is needed yet."
            },
            "/memberships",
        )
        .propose(
            ProposalKind::OpenMembership,
            "/memberships",
            json!({
                "clientId": client.client_id,
                "membershipId": active.membership_id,
                "membershipName": active.membership_name,
            }),
        )
        .propose(
            ProposalKind::PrepareWhatsAppDraft,
            format!("/clients/{}", client.client_id),
            json!({
                "clientId": client.client_id,
                "clientName": client.client_name,
                "reason": if renewal_due { "membership_renewal" } else { "membership_update" },
                "membershipName": active.membership_name,
            }),
        )
        .confidence("high")
        .data(json!({
            "activeMembership": membership_json(active),
            "credits": credits.iter().map(|credit| json!({
                "serviceName": credit.service_name,
                "remainingQty": credit.remaining_qty,
                "totalQty": credit.total_qty,
                "expiresAt": credit.expires_at,
            })).collect::<Vec<_>>()
        })))
}

/// Projects only the membership fields the drawer needs, so repository records
/// stay internal and no unexpected field leaks into the UI payload.
fn membership_json(record: &membership_lifecycle_repository::ActiveMembershipRecord) -> Value {
    json!({
        "membershipId": record.membership_id,
        "membershipName": record.membership_name,
        "assignedAt": record.assigned_at,
        "expiresAt": record.expires_at,
        "active": record.active,
        "remainingCredits": record.remaining_credits,
        "autoRenewEnabled": record.auto_renew_enabled,
        "autoRenewStatus": record.auto_renew_status,
        "frozenAt": record.frozen_at,
    })
}

async fn return_forecast(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client: copilot_repository::CopilotClientMatch,
) -> Result<CopilotAnswer, AppError> {
    let summary = clients_repository::summary(db, tenant_id, branch_id, &client.client_id)
        .await
        .map_err(|_| AppError::internal("failed to load client summary"))?;

    // Without at least two visits there is no interval to project from.
    let Some(interval_days) = summary.visit_frequency_days.filter(|days| *days > 0.0) else {
        return Ok(CopilotAnswer::new(
            CopilotTool::ClientReturnForecast,
            format!(
                "{} has {} recorded visit(s), which is not enough to project a return date.",
                client.client_name, summary.total_visits
            ),
        )
        .action(
            "Book the next appointment directly instead of waiting.",
            "/appointments",
        )
        .confidence("low")
        .data(json!({ "totalVisits": summary.total_visits })));
    };

    let interval = interval_days.round() as i64;
    let elapsed = summary.inactive_days;
    // Report a range, never a fake exact date: ±25% of their own interval.
    let spread = (interval / 4).max(2);
    let earliest = (interval - spread - elapsed).max(0);
    let latest = (interval + spread - elapsed).max(0);
    let overdue = elapsed > interval + spread;

    let headline = if overdue {
        format!(
            "{} is overdue — they normally return about every {interval} days but it has been {elapsed}.",
            client.client_name
        )
    } else {
        format!(
            "{} is likely to return in about {earliest}–{latest} days.",
            client.client_name
        )
    };

    // Confidence follows how much visit history the interval rests on.
    let confidence = match summary.total_visits {
        0..=2 => "low",
        3..=5 => "medium",
        _ => "high",
    };

    Ok(
        CopilotAnswer::new(CopilotTool::ClientReturnForecast, headline)
            .single_period(
                format!(
                    "Based on {} completed visits, last visit {elapsed} days ago",
                    summary.total_visits
                ),
                elapsed,
            )
            .metric(CopilotMetric::new(
                "Days since last visit vs usual gap",
                interval,
                elapsed,
                |value| format!("{value} days"),
            ))
            .reason(if overdue {
                format!(
                    "They are {} days past their usual {interval}-day gap, and their churn risk score is {}.",
                    elapsed - interval,
                    summary.churn_risk_score
                )
            } else {
                format!(
                    "Their own {interval}-day average gap across {} visits puts the next visit in this window; the range is ±{spread} days because that is how much their visits actually vary.",
                    summary.total_visits
                )
            })
            .evidence(format!(
                "Average gap between visits is {interval} days across {} visits.",
                summary.total_visits
            ))
            .evidence(format!(
                "Segment {} with churn risk score {}.",
                summary.rfm_segment, summary.churn_risk_score
            ))
            .evidence(
                "This is a range from their own visit history, not a committed date.".to_string(),
            )
            .action(
                if overdue {
                    "Reach out now with their usual service."
                } else {
                    "Schedule a reminder just before the window opens."
                },
                format!("/clients/{}", client.client_id),
            )
            .propose(
                ProposalKind::ViewClient,
                format!("/clients/{}", client.client_id),
                json!({ "clientId": client.client_id, "clientName": client.client_name }),
            )
            .propose(
                ProposalKind::PrepareBookingDraft,
                "/appointments",
                json!({
                    "clientId": client.client_id,
                    "clientName": client.client_name,
                    "suggestedInDays": if overdue { 0 } else { earliest },
                }),
            )
            .confidence(confidence)
            .data(json!({
                "intervalDays": interval,
                "inactiveDays": elapsed,
                "earliestDays": earliest,
                "latestDays": latest,
                "overdue": overdue,
                "totalVisits": summary.total_visits
            })),
    )
}

async fn favourite_service(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client: copilot_repository::CopilotClientMatch,
) -> Result<CopilotAnswer, AppError> {
    let summary = clients_repository::summary(db, tenant_id, branch_id, &client.client_id)
        .await
        .map_err(|_| AppError::internal("failed to load client summary"))?;
    let history = clients_repository::service_history(db, tenant_id, branch_id, &client.client_id)
        .await
        .map_err(|_| AppError::internal("failed to load client service history"))?;

    if summary.favourite_services.is_empty() && history.is_empty() {
        return Ok(CopilotAnswer::new(
            CopilotTool::ClientFavouriteService,
            format!("{} has no billed service history yet.", client.client_name),
        )
        .action(
            "Ask at the desk and record the preference on their profile.",
            format!("/clients/{}", client.client_id),
        )
        .propose(
            ProposalKind::ViewClient,
            format!("/clients/{}", client.client_id),
            json!({ "clientId": client.client_id, "clientName": client.client_name }),
        )
        .confidence("high"));
    }

    // The top name in the summary is the most-used service; count its visits.
    let top_service = summary
        .favourite_services
        .split(american_comma)
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    let uses = history
        .iter()
        .filter(|row| row.service_name == top_service)
        .count();

    let mut answer = CopilotAnswer::new(
        CopilotTool::ClientFavouriteService,
        format!(
            "{} usually books {}.",
            client.client_name,
            if top_service.is_empty() {
                "no single dominant service".to_string()
            } else {
                top_service.clone()
            }
        ),
    );
    if !summary.favourite_services.is_empty() {
        answer = answer.evidence(format!(
            "Most-used services: {}.",
            summary.favourite_services
        ));
    }
    if uses > 0 {
        answer = answer.evidence(format!(
            "{top_service} appears {uses} times in the last {} billed service lines.",
            history.len()
        ));
    }
    if let Some(interval) = summary.visit_frequency_days.filter(|days| *days > 0.0) {
        answer = answer.evidence(format!(
            "Average gap between visits is {} days.",
            interval.round() as i64
        ));
    }
    if !summary.preferred_staff_name.is_empty() {
        answer = answer.evidence(format!(
            "Usually served by {}.",
            summary.preferred_staff_name
        ));
    }

    Ok(answer
        .reason(if uses > 0 {
            format!(
                "{top_service} accounts for {uses} of their {} billed service lines, which is what makes it their usual choice.",
                history.len()
            )
        } else {
            "This is their most-billed service across their whole history.".to_string()
        })
        .action(
            "Offer this service when booking their next visit.",
            format!("/clients/{}", client.client_id),
        )
        .propose(
            ProposalKind::ViewClient,
            format!("/clients/{}", client.client_id),
            json!({ "clientId": client.client_id, "clientName": client.client_name }),
        )
        .propose(
            ProposalKind::PrepareBookingDraft,
            "/appointments",
            json!({
                "clientId": client.client_id,
                "clientName": client.client_name,
                "serviceName": top_service,
            }),
        )
        .confidence(if summary.total_visits >= 3 {
            "high"
        } else {
            "low"
        })
        .data(json!({
            "favouriteServices": summary.favourite_services,
            "preferredStaff": summary.preferred_staff_name,
            "totalVisits": summary.total_visits
        })))
}

async fn client_offer(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client: copilot_repository::CopilotClientMatch,
) -> Result<CopilotAnswer, AppError> {
    let summary = clients_repository::summary(db, tenant_id, branch_id, &client.client_id)
        .await
        .map_err(|_| AppError::internal("failed to load client summary"))?;
    let win_back =
        clients_repository::win_back_summary(db, tenant_id, branch_id, &client.client_id)
            .await
            .map_err(|_| AppError::internal("failed to load win-back history"))?;

    let issued = win_back
        .get("issuedCount")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let returned = win_back
        .get("returnedCount")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let roi_bps = win_back
        .get("offerRoiBps")
        .and_then(Value::as_i64)
        .unwrap_or_default();

    // Discount depth follows value and risk, and stays inside the governance ceiling.
    let (discount_bps, reason) = match summary.rfm_segment.as_str() {
        "VIP" | "Champion" => (500, "high-value client — protect margin, reward loyalty"),
        "At risk" => (1_500, "at risk of churn — a stronger offer is justified"),
        "Lapsed" | "Churned" => (2_000, "already lapsed — win-back needs a real incentive"),
        "New client" => (1_000, "new client — encourage a second visit"),
        _ => (1_000, "steady client — a modest incentive is enough"),
    };
    // A client whose past offers never converted should not get a deeper one.
    let discount_bps = if issued >= 2 && returned == 0 {
        discount_bps.min(500)
    } else {
        discount_bps
    };

    let mut answer = CopilotAnswer::new(
        CopilotTool::ClientOffer,
        format!(
            "Offer {} up to {}% on {} — {reason}.",
            client.client_name,
            discount_bps / 100,
            if summary.favourite_services.is_empty() {
                "their next service".to_string()
            } else {
                summary
                    .favourite_services
                    .split(american_comma)
                    .next()
                    .unwrap_or("their next service")
                    .trim()
                    .to_string()
            }
        ),
    )
    .evidence(format!(
        "Segment {} · churn risk {} · {} visits · lifetime value {}.",
        summary.rfm_segment,
        summary.churn_risk_score,
        summary.total_visits,
        rupees(summary.lifetime_value_paise)
    ))
    .evidence(format!(
        "Inactive for {} days; average spend {}.",
        summary.inactive_days,
        rupees(summary.average_spend_paise)
    ));
    if issued > 0 {
        answer = answer.evidence(format!(
            "Past offers: {issued} issued, {returned} brought them back, ROI {}%.",
            roi_bps / 100
        ));
    }
    if summary.amount_due_paise > 0 {
        answer = answer.evidence(format!(
            "They owe {} — recover the balance before discounting.",
            rupees(summary.amount_due_paise)
        ));
    }
    answer = answer.evidence(
        "This is a suggested ceiling; the discount rules still apply at billing.".to_string(),
    );

    Ok(answer
        .reason(if issued >= 2 && returned == 0 {
            format!(
                "They are in the {} segment, but {issued} past offers brought them back zero times, so the depth is capped at 5% rather than the usual level.",
                summary.rfm_segment
            )
        } else {
            format!(
                "Depth follows their {} segment and churn risk of {}: {reason}.",
                summary.rfm_segment, summary.churn_risk_score
            )
        })
        .action(
            format!("Next best action on file: {}.", summary.next_best_action),
            format!("/clients/{}", client.client_id),
        )
        .propose(
            ProposalKind::ViewClient,
            format!("/clients/{}", client.client_id),
            json!({ "clientId": client.client_id, "clientName": client.client_name }),
        )
        .propose(
            ProposalKind::CreateOfferDraft,
            format!("/clients/{}", client.client_id),
            json!({
                "clientId": client.client_id,
                "clientName": client.client_name,
                "maxDiscountBps": discount_bps,
                "segment": summary.rfm_segment,
            }),
        )
        .propose(
            ProposalKind::PrepareWhatsAppDraft,
            format!("/clients/{}", client.client_id),
            json!({
                "clientId": client.client_id,
                "clientName": client.client_name,
                "reason": "personalised_offer",
                "maxDiscountBps": discount_bps,
            }),
        )
        .confidence(if summary.total_visits >= 3 {
            "high"
        } else {
            "low"
        })
        .data(json!({
            "segment": summary.rfm_segment,
            "churnRiskScore": summary.churn_risk_score,
            "suggestedDiscountBps": discount_bps,
            "winBack": win_back
        })))
}

// ---------------------------------------------------------------------------
// Weekday pattern reasoning
// ---------------------------------------------------------------------------

/// The weakest run of days found in a weekday pattern, and how weak it is.
#[derive(Debug, Clone)]
struct WeakWindow {
    /// Human-readable span, e.g. "Tuesday–Thursday".
    label: String,
    /// Weekday numbers in the span, for a targeted offer.
    weekdays: Vec<i32>,
    /// Utilization across the span, when a roster exists to measure against.
    utilization_percent: Option<i64>,
    /// Share of the period's service bookings that land in this span.
    booking_share_percent: i64,
}

/// Finds the weakest three-day run in the week, so an answer can say *where*
/// the demand is missing rather than only that it is missing.
///
/// Prefers utilization (booked vs rostered time) and falls back to booking
/// volume when no roster is recorded. Returns `None` when there is not enough
/// activity for the comparison to mean anything.
fn weakest_window(rows: &[copilot_repository::WeekdayDemandRow]) -> Option<WeakWindow> {
    const SPAN: usize = 3;
    if rows.len() != 7 {
        return None;
    }
    let total_bookings: i64 = rows.iter().map(|row| row.service_bookings).sum();
    let rostered = rows.iter().any(|row| row.scheduled_minutes > 0);
    // Without a roster or any bookings there is nothing to reason from.
    if !rostered && total_bookings < SPAN as i64 {
        return None;
    }

    // Score each contiguous span; the week wraps, so Sunday-Monday-Tuesday counts.
    let mut best: Option<(i64, usize)> = None;
    for start in 0..7 {
        let span: Vec<&copilot_repository::WeekdayDemandRow> = (0..SPAN)
            .map(|offset| &rows[(start + offset) % 7])
            .collect();
        let score = if rostered {
            let booked: i64 = span.iter().map(|row| row.booked_minutes).sum();
            let scheduled: i64 = span.iter().map(|row| row.scheduled_minutes).sum();
            // Days nobody was rostered are not weak demand, they are closed days.
            if scheduled == 0 {
                continue;
            }
            booked * 100 / scheduled
        } else {
            span.iter().map(|row| row.service_bookings).sum::<i64>()
        };
        if best.is_none_or(|(best_score, _)| score < best_score) {
            best = Some((score, start));
        }
    }

    let (_, start) = best?;
    let span: Vec<&copilot_repository::WeekdayDemandRow> = (0..SPAN)
        .map(|offset| &rows[(start + offset) % 7])
        .collect();
    let booked: i64 = span.iter().map(|row| row.booked_minutes).sum();
    let scheduled: i64 = span.iter().map(|row| row.scheduled_minutes).sum();
    let span_bookings: i64 = span.iter().map(|row| row.service_bookings).sum();

    Some(WeakWindow {
        label: format!(
            "{}–{}",
            span.first().expect("span is not empty").weekday_name,
            span.last().expect("span is not empty").weekday_name
        ),
        weekdays: span.iter().map(|row| row.weekday).collect(),
        utilization_percent: (scheduled > 0).then(|| booked * 100 / scheduled),
        booking_share_percent: if total_bookings > 0 {
            span_bookings * 100 / total_bookings
        } else {
            0
        },
    })
}

/// Turns a weak window into the sentence that explains a decline.
fn weak_window_reason(window: &WeakWindow, subject: &str) -> String {
    match window.utilization_percent {
        Some(utilization) => format!(
            "{} is weakest on {}, where utilization is {}% and only {}% of bookings land.",
            subject, window.label, utilization, window.booking_share_percent
        ),
        None => format!(
            "{} is weakest on {}, which takes only {}% of the period's bookings.",
            subject, window.label, window.booking_share_percent
        ),
    }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/// `favourite_services` is a comma-joined list built in SQL.
fn american_comma(character: char) -> bool {
    character == ','
}

fn comparison_period() -> String {
    format!("Last {TREND_DAYS} days vs the previous {TREND_DAYS} days")
}

pub fn rupees(paise: i64) -> String {
    format!("₹{}.{:02}", paise / 100, (paise % 100).abs())
}

/// Percent change from `previous` to `current`, signed, guarding division by zero.
fn signed_change(previous: i64, current: i64) -> String {
    if previous == 0 {
        return if current == 0 {
            "no change".into()
        } else {
            "new activity".into()
        };
    }
    let change = (current - previous) * 100 / previous;
    format!("{change:+}%")
}

fn percent_of(part: i64, whole: i64) -> i64 {
    if whole <= 0 {
        0
    } else {
        part * 100 / whole
    }
}

/// Margin in basis points of revenue, after known product cost.
fn margin_bps(revenue_paise: i64, cost_paise: i64) -> i64 {
    if revenue_paise <= 0 {
        0
    } else {
        ((revenue_paise - cost_paise) * 10_000 / revenue_paise).clamp(0, 10_000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_each_documented_question() {
        let cases = [
            (
                "Kaunse staff ki performance kam ho rahi hai?",
                CopilotTool::StaffPerformanceDecline,
            ),
            ("Bill kaise banega?", CopilotTool::BillingHowTo),
            (
                "Priya ka membership status kya hai?",
                CopilotTool::MembershipStatus,
            ),
            (
                "Kaunsi service kam ho rahi hai?",
                CopilotTool::ServiceDecline,
            ),
            (
                "Kis service par offer dena chahiye?",
                CopilotTool::ServiceOffer,
            ),
            ("Kaunse clients nahi aaye?", CopilotTool::LapsedClients),
            (
                "Priya kitne din baad aa sakti hai?",
                CopilotTool::ClientReturnForecast,
            ),
            (
                "Priya regular kaunsi service leti hai?",
                CopilotTool::ClientFavouriteService,
            ),
            ("Priya client ko kya offer dein?", CopilotTool::ClientOffer),
        ];
        for (question, expected) in cases {
            let matched = detect(question).unwrap_or_else(|| panic!("no tool for {question:?}"));
            assert_eq!(matched.tool, expected, "wrong tool for {question:?}");
        }
    }

    #[test]
    fn a_client_offer_question_does_not_match_the_service_offer_tool() {
        assert_eq!(
            detect("what offer should I give client Priya")
                .unwrap()
                .tool,
            CopilotTool::ClientOffer
        );
        // Named recipient without the word "client" — the common phrasing.
        assert_eq!(
            detect("Anita Sharma ko kya offer dein?").unwrap().tool,
            CopilotTool::ClientOffer
        );
        assert_eq!(
            detect("Priya ke liye kaunsa offer sahi hai?").unwrap().tool,
            CopilotTool::ClientOffer
        );
        // Offers aimed at a service stay on the service tool.
        assert_eq!(
            detect("which service should get an offer").unwrap().tool,
            CopilotTool::ServiceOffer
        );
        assert_eq!(
            detect("Kis service par offer dena chahiye?").unwrap().tool,
            CopilotTool::ServiceOffer
        );
    }

    #[test]
    fn unrelated_questions_match_no_tool() {
        assert!(detect("what is the weather today").is_none());
        assert!(detect("hello").is_none());
    }

    #[test]
    fn subject_extraction_finds_the_named_client() {
        // Hinglish question words are dropped, leaving only the name to search on.
        assert_eq!(
            subject_of("Priya kitne din baad aayegi", "priya kitne din baad aayegi"),
            vec!["Priya".to_string()]
        );
        // A full name is tried before either of its parts.
        assert_eq!(
            subject_of(
                "Anita Sharma kitne din baad aayegi",
                "anita sharma kitne din baad aayegi"
            ),
            vec![
                "Anita Sharma".to_string(),
                "Anita".to_string(),
                "Sharma".to_string()
            ]
        );
        assert_eq!(
            subject_of(
                "membership status for \"Anita Sharma\"",
                "membership status for \"anita sharma\""
            ),
            vec!["Anita Sharma".to_string()]
        );
        assert_eq!(
            subject_of("client 9876543210 ka status", "client 9876543210 ka status"),
            vec!["9876543210".to_string()]
        );
    }

    #[test]
    fn financial_tools_are_closed_to_non_finance_roles() {
        assert!(!CopilotTool::StaffPerformanceDecline.permitted_for("receptionist"));
        assert!(!CopilotTool::ServiceOffer.permitted_for("staff"));
        assert!(CopilotTool::StaffPerformanceDecline.permitted_for("owner"));
        // Billing guidance carries no data, so the whole floor may ask for it.
        assert!(CopilotTool::BillingHowTo.permitted_for("receptionist"));
    }

    #[test]
    fn margin_safe_discount_never_exceeds_a_third_of_margin() {
        // 50% margin on ₹1000 revenue with ₹500 cost.
        assert_eq!(margin_bps(100_000, 50_000), 5_000);
        assert_eq!(margin_bps(100_000, 100_000), 0);
        assert_eq!(margin_bps(0, 0), 0);
    }

    #[test]
    fn percent_change_handles_a_zero_baseline() {
        assert_eq!(signed_change(0, 0), "no change");
        assert_eq!(signed_change(0, 500), "new activity");
        assert_eq!(signed_change(100_000, 30_000), "-70%");
        assert_eq!(signed_change(100_000, 130_000), "+30%");
    }

    #[test]
    fn a_metric_states_direction_and_change_without_dividing_by_zero() {
        let fell = CopilotMetric::new("Revenue", 100_000, 30_000, rupees);
        assert_eq!(fell.previous, "₹1000.00");
        assert_eq!(fell.current, "₹300.00");
        assert_eq!(fell.change_percent, Some(-70));
        assert_eq!(fell.direction, "down");

        let grew = CopilotMetric::new("Bookings", 4, 6, |value| value.to_string());
        assert_eq!(grew.change_percent, Some(50));
        assert_eq!(grew.direction, "up");

        // A zero baseline has no meaningful percent change, so none is claimed.
        let from_nothing = CopilotMetric::new("Bookings", 0, 5, |value| value.to_string());
        assert_eq!(from_nothing.change_percent, None);
        assert_eq!(from_nothing.direction, "up");

        let unchanged = CopilotMetric::new("Bookings", 5, 5, |value| value.to_string());
        assert_eq!(unchanged.change_percent, Some(0));
        assert_eq!(unchanged.direction, "flat");
    }

    /// Builds a week where the caller chooses each day's booked/scheduled minutes.
    fn week(days: [(i64, i64, i64); 7]) -> Vec<copilot_repository::WeekdayDemandRow> {
        const NAMES: [&str; 7] = [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
        ];
        days.iter()
            .enumerate()
            .map(
                |(index, (booked, scheduled, bookings))| copilot_repository::WeekdayDemandRow {
                    weekday: index as i32 + 1,
                    weekday_name: NAMES[index].into(),
                    completed_appointments: *bookings,
                    lost_appointments: 0,
                    booked_minutes: *booked,
                    scheduled_minutes: *scheduled,
                    service_bookings: *bookings,
                    service_revenue_paise: bookings * 1_000,
                },
            )
            .collect()
    }

    #[test]
    fn the_weakest_window_finds_the_quiet_midweek_run() {
        // Tuesday-Thursday are rostered as heavily as the rest but barely booked.
        let rows = week([
            (400, 480, 10), // Monday
            (100, 480, 2),  // Tuesday
            (90, 480, 2),   // Wednesday
            (110, 480, 2),  // Thursday
            (420, 480, 11), // Friday
            (450, 480, 12), // Saturday
            (430, 480, 11), // Sunday
        ]);
        let window = weakest_window(&rows).expect("a weak window exists");
        assert_eq!(window.label, "Tuesday–Thursday");
        assert_eq!(window.weekdays, vec![2, 3, 4]);
        // 300 booked of 1440 rostered minutes across the three days.
        assert_eq!(window.utilization_percent, Some(20));

        let reason = weak_window_reason(&window, "Hair Spa");
        assert!(
            reason.contains("Hair Spa"),
            "reason names the subject: {reason}"
        );
        assert!(
            reason.contains("Tuesday–Thursday"),
            "reason names the days: {reason}"
        );
        assert!(
            reason.contains("20%"),
            "reason quotes utilization: {reason}"
        );
    }

    #[test]
    fn the_weakest_window_wraps_across_the_end_of_the_week() {
        // Sunday, Monday and Tuesday are the quiet run.
        let rows = week([
            (60, 480, 1),
            (80, 480, 2),
            (400, 480, 10),
            (420, 480, 11),
            (430, 480, 11),
            (450, 480, 12),
            (50, 480, 1),
        ]);
        let window = weakest_window(&rows).expect("a weak window exists");
        assert_eq!(
            window.weekdays,
            vec![7, 1, 2],
            "the week wraps around Sunday"
        );
        assert_eq!(window.label, "Sunday–Tuesday");
    }

    #[test]
    fn days_with_no_roster_are_not_reported_as_weak_demand() {
        // Sunday and Monday are closed (nobody rostered); the real low is Wed-Fri.
        let rows = week([
            (0, 0, 0),      // Monday, closed
            (400, 480, 10), // Tuesday
            (120, 480, 3),  // Wednesday
            (110, 480, 3),  // Thursday
            (130, 480, 3),  // Friday
            (450, 480, 12), // Saturday
            (0, 0, 0),      // Sunday, closed
        ]);
        let window = weakest_window(&rows).expect("a weak window exists");
        assert_eq!(
            window.weekdays,
            vec![3, 4, 5],
            "a closed day is not idle capacity, so Wednesday-Friday is the weak run"
        );
    }

    #[test]
    fn no_window_is_claimed_without_enough_activity_to_judge() {
        assert!(weakest_window(&week([(0, 0, 0); 7])).is_none());
        // A partial week is never scored.
        assert!(weakest_window(&week([(0, 0, 0); 7])[..3]).is_none());
    }

    #[test]
    fn every_state_changing_proposal_requires_approval_and_says_what_is_not_done() {
        const CHANGES_STATE: [ProposalKind; 4] = [
            ProposalKind::CreateOfferDraft,
            ProposalKind::PrepareWhatsAppDraft,
            ProposalKind::ContinueBilling,
            ProposalKind::PrepareBookingDraft,
        ];
        for kind in CHANGES_STATE {
            assert!(
                kind.requires_approval(),
                "{} would change business data and must need approval",
                kind.id()
            );
            let prompt = kind.approval_prompt();
            assert!(
                !prompt.is_empty(),
                "{} must say what is being approved",
                kind.id()
            );
            // The prompt has to make clear the change has NOT happened yet.
            assert!(
                prompt.contains("until you"),
                "{} must state what is still not done: {prompt}",
                kind.id()
            );
        }

        // Opening a screen changes nothing, so it must not demand approval.
        for kind in [
            ProposalKind::OpenStaffReport,
            ProposalKind::ViewClient,
            ProposalKind::OpenMembership,
        ] {
            assert!(!kind.requires_approval(), "{} is read-only", kind.id());
            assert!(
                kind.approval_prompt().is_empty(),
                "{} needs no prompt",
                kind.id()
            );
        }
    }

    #[test]
    fn proposal_ids_round_trip_so_role_gating_cannot_silently_miss_one() {
        for kind in [
            ProposalKind::OpenStaffReport,
            ProposalKind::ViewClient,
            ProposalKind::OpenMembership,
            ProposalKind::CreateOfferDraft,
            ProposalKind::PrepareWhatsAppDraft,
            ProposalKind::ContinueBilling,
            ProposalKind::PrepareBookingDraft,
        ] {
            assert_eq!(
                proposal_kind(kind.id()),
                Some(kind),
                "{} must resolve back to its kind, or the role filter would drop it",
                kind.id()
            );
        }
        assert_eq!(proposal_kind("unknown_kind"), None);
    }

    #[test]
    fn sensitive_proposals_are_closed_to_roles_that_cannot_perform_them() {
        // Discounting is governed, so the floor cannot be offered an offer draft.
        assert!(!ProposalKind::CreateOfferDraft.permitted_for("receptionist"));
        assert!(!ProposalKind::CreateOfferDraft.permitted_for("staff"));
        assert!(ProposalKind::CreateOfferDraft.permitted_for("manager"));

        // Staff performance stays management information.
        assert!(!ProposalKind::OpenStaffReport.permitted_for("receptionist"));
        assert!(ProposalKind::OpenStaffReport.permitted_for("owner"));

        // Outbound messaging belongs to roles that own client communication.
        assert!(!ProposalKind::PrepareWhatsAppDraft.permitted_for("staff"));
        assert!(ProposalKind::PrepareWhatsAppDraft.permitted_for("frontdesk"));

        // Billing and booking are ordinary floor work.
        assert!(ProposalKind::ContinueBilling.permitted_for("receptionist"));
        assert!(ProposalKind::PrepareBookingDraft.permitted_for("staff"));
    }

    #[test]
    fn a_proposal_carries_a_route_and_prefill_but_never_a_completed_change() {
        let proposal = ProposalKind::CreateOfferDraft.proposal(
            "/services",
            json!({ "serviceId": "spa", "maxDiscountBps": 1_500 }),
        );
        assert_eq!(proposal.kind, "create_offer_draft");
        assert_eq!(proposal.label, "Create Offer Draft");
        assert_eq!(proposal.route, "/services");
        assert!(proposal.requires_approval);
        // The payload is a suggestion to prefill, not an applied discount.
        assert_eq!(proposal.params["maxDiscountBps"], 1_500);
        assert!(proposal.approval_prompt.contains("published"));
    }

    #[test]
    fn a_reply_states_branch_period_change_reason_action_and_confidence() {
        let answer = CopilotAnswer::new(CopilotTool::ServiceDecline, "Hair Spa fell most.")
            .trend_period()
            .metric(CopilotMetric::new("Hair Spa bookings", 20, 8, |value| {
                value.to_string()
            }))
            .reason("Hair Spa is weakest on Tuesday–Thursday, where utilization is 20%.")
            .action("Target recovery at Tuesday–Thursday.", "/services")
            .confidence("high");
        let mut answer = answer;
        answer.branch_name = "Andheri West".into();

        let reply = answer.to_reply();
        assert!(reply.contains("Andheri West"), "names the branch: {reply}");
        assert!(reply.contains("Last 30 days"), "names the period: {reply}");
        assert!(reply.contains("20 → 8 (-60%)"), "shows the change: {reply}");
        assert!(reply.contains("Why: "), "gives a reason: {reply}");
        assert!(reply.contains("Next step: "), "gives an action: {reply}");
        assert!(
            reply.contains("Confidence: high"),
            "states confidence: {reply}"
        );
        // The concrete dates make the period checkable, not just descriptive.
        assert!(
            reply.contains(&answer.period.start),
            "includes start date: {reply}"
        );
        assert!(
            reply.contains(&answer.period.previous_start),
            "includes the previous window: {reply}"
        );
    }

    #[test]
    fn a_staff_reason_prefers_the_explanation_the_numbers_support() {
        let base = copilot_repository::StaffPerformanceTrendRow {
            staff_id: "s1".into(),
            staff_name: "Asha".into(),
            job_title: "Stylist".into(),
            current_completed: 3,
            previous_completed: 10,
            current_cancelled: 0,
            previous_cancelled: 0,
            current_no_show: 0,
            previous_no_show: 0,
            current_rebooked: 0,
            previous_rebooked: 0,
            current_rebook_eligible: 0,
            previous_rebook_eligible: 0,
            current_booked_minutes: 180,
            previous_booked_minutes: 600,
            current_scheduled_minutes: 0,
            previous_scheduled_minutes: 0,
            current_revenue_paise: 30_000,
            previous_revenue_paise: 100_000,
        };

        // Cancellations that account for much of the loss are cited first.
        let cancellations = copilot_repository::StaffPerformanceTrendRow {
            current_cancelled: 5,
            ..base.clone()
        };
        assert!(
            staff_decline_reason(&cancellations).contains("Cancellations"),
            "cancellations explain the drop"
        );

        // With enough settled visits, a rebooking collapse is the explanation.
        let rebooking = copilot_repository::StaffPerformanceTrendRow {
            previous_rebooked: 8,
            previous_rebook_eligible: 10,
            current_rebooked: 0,
            current_rebook_eligible: 3,
            ..base.clone()
        };
        assert!(
            staff_decline_reason(&rebooking).contains("Rebooking fell"),
            "rebooking explains the drop"
        );

        // Too few settled visits: the rebooking claim must not be made at all.
        let thin_rebooking = copilot_repository::StaffPerformanceTrendRow {
            previous_rebooked: 8,
            previous_rebook_eligible: 10,
            current_rebooked: 0,
            current_rebook_eligible: 1,
            ..base.clone()
        };
        assert!(
            !staff_decline_reason(&thin_rebooking).contains("Rebooking fell"),
            "an unmeasurable rebooking rate is never cited"
        );

        // Nothing else to point at: fall back to the visit count itself.
        assert!(
            staff_decline_reason(&base).contains("Completed visits fell"),
            "the fallback explains from visit count"
        );
    }
}

/// Renders a full answer against real data so the Phase 2 output contract is
/// checked as a whole, not field by field.
#[cfg(test)]
mod reply_shape_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;
    use uuid::Uuid;

    #[tokio::test]
    async fn a_declining_service_answer_carries_every_required_element() {
        dotenvy::dotenv().ok();
        let Ok(url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let Ok(db) = PgPoolOptions::new().max_connections(2).connect(&url).await else {
            return;
        };
        let tenant = format!("copilot_reply_{}", Uuid::new_v4().simple());
        let branch = "branch1";

        sqlx::query(
            "INSERT INTO services(id,tenant_id,branch_id,name,category,duration_minutes,price_paise,active)
             VALUES ($3||'spa',$1,$2,'Hair Spa','Hair',60,100000,TRUE)",
        ).bind(&tenant).bind(branch).bind(&tenant).execute(&db).await.expect("service seeded");
        // Six sales in the previous window, one in the current: a clear decline.
        sqlx::query(
            "INSERT INTO pos_sales(id,tenant_id,branch_id,client_id,invoice_number,subtotal_paise,total_paise,paid_paise,status,finalized_at,created_at)
             SELECT $3||'p'||g,$1,$2,$3||'c'||g,'INV-P'||g,100000,100000,100000,'paid',(CURRENT_DATE-40)::timestamptz,(CURRENT_DATE-40)::timestamptz FROM generate_series(1,6) g",
        ).bind(&tenant).bind(branch).bind(&tenant).execute(&db).await.expect("previous sales");
        sqlx::query(
            "INSERT INTO pos_sale_lines(id,tenant_id,branch_id,sale_id,line_type,item_id,item_name,quantity,unit_price_paise,line_total_paise)
             SELECT $3||'pl'||g,$1,$2,$3||'p'||g,'service',$3||'spa','Hair Spa',1,100000,100000 FROM generate_series(1,6) g",
        ).bind(&tenant).bind(branch).bind(&tenant).execute(&db).await.expect("previous lines");
        sqlx::query(
            "INSERT INTO pos_sales(id,tenant_id,branch_id,client_id,invoice_number,subtotal_paise,total_paise,paid_paise,status,finalized_at,created_at)
             VALUES ($3||'cur',$1,$2,$3||'c1','INV-C',100000,100000,100000,'paid',(CURRENT_DATE-5)::timestamptz,(CURRENT_DATE-5)::timestamptz)",
        ).bind(&tenant).bind(branch).bind(&tenant).execute(&db).await.expect("current sale");
        sqlx::query(
            "INSERT INTO pos_sale_lines(id,tenant_id,branch_id,sale_id,line_type,item_id,item_name,quantity,unit_price_paise,line_total_paise)
             VALUES ($3||'curl',$1,$2,$3||'cur','service',$3||'spa','Hair Spa',1,100000,100000)",
        ).bind(&tenant).bind(branch).bind(&tenant).execute(&db).await.expect("current line");

        let matched = detect("Kaunsi service kam ho rahi hai?").expect("tool matches");
        let answer = run(&db, &tenant, branch, "owner", &matched)
            .await
            .expect("tool runs for an owner");

        assert_eq!(answer.tool, "service_decline");
        assert!(
            answer.headline.contains("Hair Spa"),
            "names the service: {}",
            answer.headline
        );
        assert!(!answer.branch_name.is_empty(), "states a branch");
        assert!(!answer.period.start.is_empty(), "states concrete dates");
        assert!(
            !answer.period.previous_start.is_empty(),
            "states the previous window"
        );
        assert!(!answer.reason.is_empty(), "gives a data-based reason");
        assert!(!answer.recommended_action.is_empty(), "gives an action");
        assert!(!answer.deep_link.is_empty(), "links a screen");

        let bookings = answer
            .metrics
            .iter()
            .find(|metric| metric.label.contains("bookings"))
            .expect("a bookings metric");
        assert_eq!(bookings.previous, "6");
        assert_eq!(bookings.current, "1");
        assert_eq!(bookings.change_percent, Some(-83));
        assert_eq!(bookings.direction, "down");

        // The rendered reply must expose every Phase 2 element to the reader.
        let reply = answer.to_reply();
        for expected in [
            "Branch:",
            "Period:",
            "Why:",
            "Next step:",
            "Confidence:",
            "6 → 1",
        ] {
            assert!(
                reply.contains(expected),
                "reply is missing {expected:?}:\n{reply}"
            );
        }

        // A receptionist must not receive the same revenue comparison.
        assert!(
            matches!(
                run(&db, &tenant, branch, "receptionist", &matched).await,
                Err(ToolRefusal::Forbidden(_))
            ),
            "service revenue stays closed to non-finance roles"
        );

        for table in ["pos_sale_lines", "pos_sales", "services"] {
            let _ = sqlx::query(&format!("DELETE FROM {table} WHERE tenant_id=$1"))
                .bind(&tenant)
                .execute(&db)
                .await;
        }
    }

    #[tokio::test]
    async fn proposals_are_filtered_to_what_the_caller_may_actually_do() {
        dotenvy::dotenv().ok();
        let Ok(url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let Ok(db) = PgPoolOptions::new().max_connections(2).connect(&url).await else {
            return;
        };
        let tenant = format!("copilot_props_{}", Uuid::new_v4().simple());
        let branch = "branch1";

        sqlx::query(
            "INSERT INTO clients(id,tenant_id,branch_id,first_name,last_name,phone,normalized_phone,active,last_visit_at)
             VALUES ($3||'c1',$1,$2,'Anita','Sharma','9876543210','9876543210',TRUE,NOW()-INTERVAL '200 days')",
        ).bind(&tenant).bind(branch).bind(&tenant).execute(&db).await.expect("client seeded");

        let matched = detect("Anita Sharma ko kya offer dein?").expect("tool matches");

        // A manager may discount, so the offer draft is offered — but flagged.
        let for_manager = run(&db, &tenant, branch, "manager", &matched)
            .await
            .expect("manager may run the client offer tool");
        let offer_draft = for_manager
            .proposals
            .iter()
            .find(|proposal| proposal.kind == "create_offer_draft")
            .expect("a manager is offered the offer draft");
        assert!(
            offer_draft.requires_approval,
            "an offer draft always needs explicit approval"
        );
        assert!(
            !offer_draft.approval_prompt.is_empty(),
            "the user is told what they are approving"
        );
        // Read-only proposals sit alongside it without an approval gate.
        let view_client = for_manager
            .proposals
            .iter()
            .find(|proposal| proposal.kind == "view_client")
            .expect("viewing the client is offered");
        assert!(
            !view_client.requires_approval,
            "opening a screen changes nothing"
        );

        // Every proposal must point somewhere; a dead button is worse than none.
        for proposal in &for_manager.proposals {
            assert!(
                proposal.route.starts_with('/'),
                "{} needs a route, got {:?}",
                proposal.kind,
                proposal.route
            );
            assert!(
                !proposal.label.is_empty(),
                "{} needs a label",
                proposal.kind
            );
        }

        for table in ["clients"] {
            let _ = sqlx::query(&format!("DELETE FROM {table} WHERE tenant_id=$1"))
                .bind(&tenant)
                .execute(&db)
                .await;
        }
    }

    #[tokio::test]
    async fn a_role_without_discount_rights_is_never_offered_an_offer_draft() {
        dotenvy::dotenv().ok();
        let Ok(url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let Ok(db) = PgPoolOptions::new().max_connections(2).connect(&url).await else {
            return;
        };
        let tenant = format!("copilot_gate_{}", Uuid::new_v4().simple());
        let branch = "branch1";

        sqlx::query(
            "INSERT INTO clients(id,tenant_id,branch_id,first_name,last_name,phone,normalized_phone,active,last_visit_at)
             VALUES ($3||'c1',$1,$2,'Anita','Sharma','9876543210','9876543210',TRUE,NOW()-INTERVAL '200 days')",
        ).bind(&tenant).bind(branch).bind(&tenant).execute(&db).await.expect("client seeded");

        // Billed history, so the favourite-service path runs in full.
        sqlx::query(
            "INSERT INTO pos_sales(id,tenant_id,branch_id,client_id,invoice_number,subtotal_paise,total_paise,paid_paise,status,finalized_at,created_at)
             SELECT $3||'s'||g,$1,$2,$3||'c1','INV-G'||g,100000,100000,100000,'paid',(CURRENT_DATE-20+g)::timestamptz,(CURRENT_DATE-20+g)::timestamptz
             FROM generate_series(1,3) g",
        ).bind(&tenant).bind(branch).bind(&tenant).execute(&db).await.expect("sales seeded");
        sqlx::query(
            "INSERT INTO pos_sale_lines(id,tenant_id,branch_id,sale_id,line_type,item_id,item_name,quantity,unit_price_paise,line_total_paise)
             SELECT $3||'l'||g,$1,$2,$3||'s'||g,'service','spa','Hair Spa',1,100000,100000 FROM generate_series(1,3) g",
        ).bind(&tenant).bind(branch).bind(&tenant).execute(&db).await.expect("lines seeded");

        // A receptionist may look a client up, so the tool itself is allowed.
        let matched =
            detect("Anita Sharma regular kaunsi service leti hai?").expect("tool matches");
        let answer = run(&db, &tenant, branch, "receptionist", &matched)
            .await
            .expect("a receptionist may read client history");
        assert!(
            answer
                .proposals
                .iter()
                .all(|proposal| proposal.kind != "create_offer_draft"),
            "a receptionist must never be offered a discount draft: {:?}",
            answer
                .proposals
                .iter()
                .map(|proposal| proposal.kind.as_str())
                .collect::<Vec<_>>()
        );
        // They can still do the parts of their job the tool supports.
        assert!(
            answer
                .proposals
                .iter()
                .any(|proposal| proposal.kind == "prepare_booking_draft"),
            "booking is ordinary front-desk work"
        );

        for table in ["pos_sale_lines", "pos_sales", "clients"] {
            let _ = sqlx::query(&format!("DELETE FROM {table} WHERE tenant_id=$1"))
                .bind(&tenant)
                .execute(&db)
                .await;
        }
    }
}
