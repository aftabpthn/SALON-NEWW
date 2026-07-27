//! Permission-checked CRM tools the AI copilot can run.
//!
//! The language model never touches the database. This module maps a question to
//! one allow-listed read tool, runs it against the repositories the CRM already
//! uses, and returns a factual answer with the evidence and date range behind it.
//! The result is both a deterministic reply on its own and the grounding context
//! handed to the AI provider, so the provider analyses real numbers instead of
//! inventing them.

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

/// A grounded answer: what was found, the evidence behind it, and what to do next.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotAnswer {
    pub tool: String,
    /// One-line factual conclusion.
    pub headline: String,
    /// The numbers the conclusion rests on, one statement per line.
    pub evidence: Vec<String>,
    /// Human-readable date range the numbers cover.
    pub period: String,
    pub recommended_action: String,
    /// CRM screen the user should open to act on this.
    pub deep_link: String,
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
            evidence: Vec::new(),
            period: String::new(),
            recommended_action: String::new(),
            deep_link: String::new(),
            confidence: "medium".into(),
            data: json!({}),
        }
    }

    fn evidence(mut self, line: impl Into<String>) -> Self {
        self.evidence.push(line.into());
        self
    }

    fn period(mut self, period: impl Into<String>) -> Self {
        self.period = period.into();
        self
    }

    fn action(mut self, action: impl Into<String>, deep_link: impl Into<String>) -> Self {
        self.recommended_action = action.into();
        self.deep_link = deep_link.into();
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

    /// Renders the answer as the deterministic chat reply.
    pub fn to_reply(&self) -> String {
        let mut reply = self.headline.clone();
        if !self.period.is_empty() {
            reply.push_str(&format!("\nPeriod: {}", self.period));
        }
        for line in &self.evidence {
            reply.push_str(&format!("\n• {line}"));
        }
        if !self.recommended_action.is_empty() {
            reply.push_str(&format!("\nNext step: {}", self.recommended_action));
        }
        if self.confidence != "high" {
            reply.push_str(&format!("\nConfidence: {}", self.confidence));
        }
        reply
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
    let about_client = has_any(text, &["client", "customer", "grahak", "ग्राहक"]);
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
    answer.map_err(|error| {
        tracing::warn!(
            tool = matched.tool.name(),
            error = error.message(),
            "copilot tool failed"
        );
        ToolRefusal::NoMatch
    })
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
    if declining.is_empty() {
        return Ok(CopilotAnswer::new(
            CopilotTool::StaffPerformanceDecline,
            "No staff member has lower service revenue than the previous 30 days.",
        )
        .period(comparison_period())
        .action("Keep the current roster and incentives.", "/staff")
        .confidence(if rows.is_empty() { "low" } else { "high" })
        .data(json!({ "staff": rows })));
    }

    let mut answer = CopilotAnswer::new(
        CopilotTool::StaffPerformanceDecline,
        format!(
            "{} staff member{} earned less service revenue than the previous 30 days.",
            declining.len(),
            if declining.len() == 1 { "" } else { "s" }
        ),
    )
    .period(comparison_period());

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

    let worst = declining[0];
    Ok(answer
        .action(
            format!(
                "Review {}'s roster, service mix and cancellations first — it is the largest drop.",
                worst.staff_name
            ),
            format!("/staff/{}", worst.staff_id),
        )
        .confidence(if worst.previous_completed >= 5 {
            "high"
        } else {
            "low"
        })
        .data(json!({ "staff": rows })))
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
    if declining.is_empty() {
        return Ok(CopilotAnswer::new(
            CopilotTool::ServiceDecline,
            "No service earned less than it did in the previous 30 days.",
        )
        .period(comparison_period())
        .action("No service needs recovery action right now.", "/services")
        .confidence(if rows.is_empty() { "low" } else { "high" })
        .data(json!({ "services": rows })));
    }

    let mut answer = CopilotAnswer::new(
        CopilotTool::ServiceDecline,
        format!(
            "{} service{} declined against the previous 30 days.",
            declining.len(),
            if declining.len() == 1 { "" } else { "s" }
        ),
    )
    .period(comparison_period());
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
    let worst = declining[0];
    Ok(answer
        .action(
            format!(
                "Check {} first: pricing, staff availability and slot coverage.",
                worst.service_name
            ),
            "/services",
        )
        .confidence(if worst.previous_bookings >= 5 {
            "high"
        } else {
            "low"
        })
        .data(json!({ "services": rows })))
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
        .period(comparison_period())
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
        .period(comparison_period())
        .evidence(format!(
            "{}: measured margin {}% after product cost of {}.",
            best.service_name,
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

    Ok(CopilotAnswer::new(
        CopilotTool::ServiceOffer,
        format!(
            "{} is the safest service to put an offer on.",
            best.service_name
        ),
    )
    .period(comparison_period())
    .evidence(format!(
        "Bookings {} → {} and revenue {} → {} ({}).",
        best.previous_bookings,
        best.current_bookings,
        rupees(best.previous_revenue_paise),
        rupees(best.current_revenue_paise),
        signed_change(best.previous_revenue_paise, best.current_revenue_paise)
    ))
    .evidence(format!(
        "Measured margin is {}% after product cost of {}, so up to {}% discount stays margin-safe.",
        margin_bps / 100,
        rupees(best.current_product_cost_paise),
        safe_discount_bps / 100
    ))
    .evidence(
        "Margin uses product cost from the stock ledger only; staff cost is not included."
            .to_string(),
    )
    .action(
        format!(
            "Run a time-boxed offer on {} up to {}% and re-check demand after 30 days.",
            best.service_name,
            safe_discount_bps / 100
        ),
        "/services",
    )
    .confidence(if best.current_product_cost_paise > 0 {
        "medium"
    } else {
        "low"
    })
    .data(json!({ "services": rows, "recommendedService": best, "safeDiscountBps": safe_discount_bps })))
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
        .period(format!("Inactive for {LAPSED_DAYS}+ days as of today"))
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
    .period(format!("Inactive for {LAPSED_DAYS}+ days as of today"))
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
    Ok(answer
        .action(
            "Start win-back outreach with the 90–179 day group; they are the most recoverable.",
            "/clients",
        )
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
    let renewal_due = active
        .expires_at
        .is_some_and(|expires_at| (expires_at - chrono::Utc::now()).num_days() <= 30);
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
            .period(format!(
                "Based on {} completed visits, last visit {elapsed} days ago",
                summary.total_visits
            ))
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
        .action(
            "Offer this service when booking their next visit.",
            format!("/clients/{}", client.client_id),
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
        .action(
            format!("Next best action on file: {}.", summary.next_best_action),
            format!("/clients/{}", client.client_id),
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
        assert_eq!(
            detect("which service should get an offer").unwrap().tool,
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
}
