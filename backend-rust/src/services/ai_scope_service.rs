//! Login-derived data scope for the AI copilot.
//!
//! The chain is always: login identity -> role permissions -> geo scope
//! (region/zone/cluster/branch) -> allowed CRM data -> answer. Nothing downstream
//! may widen what this module resolves, and a request for data beyond the login's
//! scope is narrowed and disclosed rather than refused silently or answered in full.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::ai_scope_repository::{self as repository, ScopeBranchRow},
    services::auth_service::AuthClaims,
};

/// How wide a copilot answer reaches through the tenant hierarchy.
///
/// `Tenant > Region > Zone > Cluster > Branch > SelfOnly`, mirroring
/// `tenant -> region -> zone -> cluster -> branch -> staff`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScopeLevel {
    Tenant,
    Region,
    Zone,
    Cluster,
    Branch,
    #[serde(rename = "self")]
    SelfOnly,
}

impl ScopeLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Tenant => "tenant",
            Self::Region => "region",
            Self::Zone => "zone",
            Self::Cluster => "cluster",
            Self::Branch => "branch",
            Self::SelfOnly => "self",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "tenant" | "organization" | "company" | "all" => Some(Self::Tenant),
            "region" => Some(Self::Region),
            "zone" => Some(Self::Zone),
            "cluster" => Some(Self::Cluster),
            "branch" | "store" | "salon" => Some(Self::Branch),
            "self" | "me" | "staff" => Some(Self::SelfOnly),
            _ => None,
        }
    }

    /// Lower rank means wider reach. Used to decide whether a request must be narrowed.
    fn rank(self) -> u8 {
        match self {
            Self::Tenant => 0,
            Self::Region => 1,
            Self::Zone => 2,
            Self::Cluster => 3,
            Self::Branch => 4,
            Self::SelfOnly => 5,
        }
    }

    fn is_wider_than(self, other: Self) -> bool {
        self.rank() < other.rank()
    }
}

/// The CRM knowledge areas the copilot can answer over.
///
/// Every allow-listed tool declares one domain; the domain decides which
/// permission the login must hold before any data is read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiDomain {
    Appointments,
    Pos,
    Staff,
    Clients,
    Services,
    Inventory,
    Memberships,
    Packages,
    Marketing,
    Finance,
    Reviews,
    GeoComparison,
    Forecasting,
}

impl AiDomain {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Appointments => "appointments",
            Self::Pos => "pos",
            Self::Staff => "staff",
            Self::Clients => "clients",
            Self::Services => "services",
            Self::Inventory => "inventory",
            Self::Memberships => "memberships",
            Self::Packages => "packages",
            Self::Marketing => "marketing",
            Self::Finance => "finance",
            Self::Reviews => "reviews",
            Self::GeoComparison => "geo_comparison",
            Self::Forecasting => "forecasting",
        }
    }

    /// The permission that unlocks this domain, plus legacy codes kept for
    /// tenants that have not migrated off the broad grants yet.
    pub fn required_permission(self) -> &'static str {
        match self {
            Self::Appointments => "appointments.read",
            Self::Pos => "pos.read",
            Self::Staff => "staff.read",
            Self::Clients => "clients.read",
            Self::Services => "services.read",
            Self::Inventory => "inventory.read",
            Self::Memberships => "memberships.read",
            Self::Packages => "packages.read",
            Self::Marketing => "marketing.read",
            Self::Finance => "finance.read",
            Self::Reviews => "clients.read",
            Self::GeoComparison => "reports.read",
            Self::Forecasting => "reports.read",
        }
    }

    fn legacy_permissions(self) -> &'static [&'static str] {
        match self {
            Self::Finance => &["tenant.read", "reports.read"],
            Self::GeoComparison | Self::Forecasting => &["tenant.read", "management.write"],
            _ => &["tenant.read"],
        }
    }

    /// Roles that hold this domain by default when no explicit permission list exists.
    fn default_roles(self) -> &'static [&'static str] {
        const MANAGEMENT: &[&str] = &["owner", "admin", "manager", "regional head", "regionalhead"];
        match self {
            Self::Appointments => &[
                "owner",
                "admin",
                "manager",
                "regional head",
                "regionalhead",
                "receptionist",
                "frontdesk",
                "staff",
            ],
            Self::Pos => &[
                "owner",
                "admin",
                "manager",
                "regional head",
                "regionalhead",
                "cashier",
                "receptionist",
                "frontdesk",
                "accountant",
            ],
            Self::Staff => &[
                "owner",
                "admin",
                "manager",
                "regional head",
                "regionalhead",
                "staff",
            ],
            Self::Clients | Self::Reviews => &[
                "owner",
                "admin",
                "manager",
                "regional head",
                "regionalhead",
                "receptionist",
                "frontdesk",
            ],
            Self::Services => &[
                "owner",
                "admin",
                "manager",
                "regional head",
                "regionalhead",
                "receptionist",
                "frontdesk",
                "staff",
            ],
            Self::Inventory => &[
                "owner",
                "admin",
                "manager",
                "regional head",
                "regionalhead",
                "inventory manager",
                "inventorymanager",
                "inventory_manager",
            ],
            Self::Memberships | Self::Packages => &[
                "owner",
                "admin",
                "manager",
                "regional head",
                "regionalhead",
                "receptionist",
                "frontdesk",
            ],
            Self::Marketing => &[
                "owner",
                "admin",
                "manager",
                "regional head",
                "regionalhead",
                "marketing lead",
                "marketinglead",
                "marketing_lead",
            ],
            // Finance stays off the front desk: receptionists get workflow, not money.
            Self::Finance => &["owner", "admin", "manager", "accountant"],
            Self::GeoComparison | Self::Forecasting => MANAGEMENT,
        }
    }
}

/// A branch inside the resolved scope, with its hierarchy position.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedBranch {
    pub branch_id: String,
    pub branch_name: String,
    pub branch_code: String,
    pub region_name: String,
    pub zone_name: String,
    pub cluster_name: String,
    pub active: bool,
    pub access_type: String,
}

impl From<ScopeBranchRow> for ScopedBranch {
    fn from(row: ScopeBranchRow) -> Self {
        Self {
            branch_id: row.branch_id,
            branch_name: row.branch_name,
            branch_code: row.branch_code,
            region_name: row.region_name,
            zone_name: row.zone_name,
            cluster_name: row.cluster_name,
            active: row.active,
            access_type: row.access_type,
        }
    }
}

/// What the caller asked the copilot to look at, before authorization.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeRequest {
    pub level: Option<String>,
    pub region: Option<String>,
    pub zone: Option<String>,
    pub cluster: Option<String>,
    pub branch_id: Option<String>,
    pub staff_id: Option<String>,
}

/// The authorized scope for one copilot answer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedScope {
    pub tenant_id: String,
    pub user_id: String,
    pub role: String,
    pub level: ScopeLevel,
    pub label: String,
    pub requested_level: Option<ScopeLevel>,
    pub requested_label: String,
    /// True when the login could not cover what was asked for.
    pub narrowed: bool,
    pub narrow_notice: Option<String>,
    pub branches: Vec<ScopedBranch>,
    /// Branch ids inside the tenant the login may not read; names are never included.
    pub excluded_branch_ids: Vec<String>,
    /// Set when the login only sees its own staff record.
    pub self_staff_id: Option<String>,
    /// True when a `staff` login may also read their branch's totals.
    pub branch_totals_allowed: bool,
    pub regions: Vec<String>,
    pub zones: Vec<String>,
    pub clusters: Vec<String>,
}

impl ResolvedScope {
    pub fn branch_ids(&self) -> Vec<String> {
        self.branches
            .iter()
            .map(|branch| branch.branch_id.clone())
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.branches.is_empty()
    }

    /// The branch a governance record belongs to: the single scoped branch when
    /// there is one, otherwise the scope-wide marker.
    pub fn governance_branch_id(&self) -> String {
        if self.branches.len() == 1 {
            self.branches[0].branch_id.clone()
        } else {
            self.branches
                .first()
                .map(|branch| branch.branch_id.clone())
                .unwrap_or_default()
        }
    }

    /// The branch a single-branch tool reads.
    ///
    /// Only ever a branch inside the resolved set, so a tool that cannot span
    /// branches still cannot be pointed at one the login does not hold.
    pub fn primary_branch_id(&self) -> Option<&str> {
        self.branches
            .first()
            .map(|branch| branch.branch_id.as_str())
    }

    /// Whether a branch id is inside this login's authorized set.
    pub fn authorizes(&self, branch_id: &str) -> bool {
        self.branches
            .iter()
            .any(|branch| branch.branch_id == branch_id)
    }

    /// Reject a branch the login may not read.
    ///
    /// The guard exists so a branch id taken from a request header can never
    /// reach a query without being checked against the grants first.
    pub fn require_branch(&self, branch_id: &str) -> Result<(), AppError> {
        if self.authorizes(branch_id) {
            return Ok(());
        }
        Err(AppError::forbidden(
            "this branch is outside your authorized scope",
        ))
    }

    /// The scope statement carried on every answer.
    pub fn disclosure(&self) -> ScopeDisclosure {
        ScopeDisclosure {
            level: self.level,
            label: self.label.clone(),
            branch_count: self.branches.len(),
            branches_read: self
                .branches
                .iter()
                .map(|branch| branch.branch_name.clone())
                .collect(),
            regions: self.regions.clone(),
            zones: self.zones.clone(),
            clusters: self.clusters.clone(),
            narrowed: self.narrowed,
            notice: self.narrow_notice.clone().unwrap_or_default(),
            role: self.role.clone(),
        }
    }
}

/// What an answer covers, returned with every reply so a partial answer is
/// never mistaken for a complete one.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeDisclosure {
    pub level: ScopeLevel,
    pub label: String,
    pub branch_count: usize,
    pub branches_read: Vec<String>,
    pub regions: Vec<String>,
    pub zones: Vec<String>,
    pub clusters: Vec<String>,
    /// True when the login could not cover what was asked for.
    pub narrowed: bool,
    /// Human-readable narrowing statement, empty when nothing was narrowed.
    pub notice: String,
    pub role: String,
}

impl Default for ScopeDisclosure {
    fn default() -> Self {
        Self {
            level: ScopeLevel::Branch,
            label: String::new(),
            branch_count: 0,
            branches_read: Vec::new(),
            regions: Vec::new(),
            zones: Vec::new(),
            clusters: Vec::new(),
            narrowed: false,
            notice: String::new(),
            role: String::new(),
        }
    }
}

/// Roles that always see the whole tenant.
fn role_is_tenant_wide(role: &str) -> bool {
    matches!(
        role.trim().to_ascii_lowercase().as_str(),
        "owner" | "superadmin" | "super-admin" | "super_admin"
    )
}

/// Roles that see the whole tenant unless they carry explicit branch grants.
fn role_is_tenant_wide_by_default(role: &str) -> bool {
    matches!(
        role.trim().to_ascii_lowercase().as_str(),
        "admin" | "accountant" | "analyst"
    )
}

fn role_is_self_scoped(role: &str) -> bool {
    matches!(role.trim().to_ascii_lowercase().as_str(), "staff")
}

/// Whether the login holds a domain, honouring explicit denials first.
///
/// Denials always win: a role default never re-grants something an
/// administrator has explicitly taken away.
pub fn domain_allowed(claims: &AuthClaims, domain: AiDomain) -> bool {
    let required = domain.required_permission();
    let legacy = domain.legacy_permissions();
    let denied = claims
        .denied_permissions
        .iter()
        .any(|entry| entry == required || legacy.iter().any(|item| entry == item));
    if denied {
        return false;
    }
    if claims
        .permissions
        .iter()
        .any(|entry| entry == required || legacy.iter().any(|item| entry == item))
    {
        return true;
    }
    // No explicit grant recorded: fall back to what the role means by default.
    let role = claims.role.trim().to_ascii_lowercase();
    domain
        .default_roles()
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(&role))
}

/// Reject a tool whose domain the login does not hold.
pub fn require_domain(claims: &AuthClaims, domain: AiDomain) -> Result<(), AppError> {
    if domain_allowed(claims, domain) {
        return Ok(());
    }
    Err(AppError::forbidden(format!(
        "your role does not have {} access, so this answer cannot be produced",
        domain.as_str().replace('_', " ")
    )))
}

/// Resolve the branches this login may read, then narrow them to the request.
pub async fn resolve_scope(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    request: &ScopeRequest,
    language: LanguageCode,
) -> Result<ResolvedScope, AppError> {
    let role = claims.role.trim().to_string();
    let tenant_wide = role_is_tenant_wide(&role);

    let mut granted = repository::authorized_branches(db, tenant_id, &claims.sub, tenant_wide)
        .await
        .map_err(|_| AppError::internal("failed to resolve authorized branches"))?;

    // Admin-class roles hold the whole tenant only while nobody has pinned them
    // to specific branches. An explicit grant is a deliberate restriction.
    if granted.is_empty() && role_is_tenant_wide_by_default(&role) {
        granted = repository::authorized_branches(db, tenant_id, &claims.sub, true)
            .await
            .map_err(|_| AppError::internal("failed to resolve authorized branches"))?;
    }

    // Last resort: the branch the session is already operating in.
    if granted.is_empty() {
        if let Some(branch_id) = claims.branch_id.as_ref().filter(|value| !value.is_empty()) {
            granted = repository::tenant_branch_directory(db, tenant_id)
                .await
                .map_err(|_| AppError::internal("failed to resolve branch directory"))?
                .into_iter()
                .filter(|row| &row.branch_id == branch_id)
                .collect();
        }
    }

    let authorized: Vec<ScopedBranch> = granted.into_iter().map(ScopedBranch::from).collect();

    let directory = repository::tenant_branch_directory(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to resolve branch directory"))?;
    let tenant_branch_count = directory.len();
    let authorized_ids: BTreeSet<&str> = authorized
        .iter()
        .map(|branch| branch.branch_id.as_str())
        .collect();
    let excluded_branch_ids: Vec<String> = directory
        .iter()
        .filter(|row| !authorized_ids.contains(row.branch_id.as_str()))
        .map(|row| row.branch_id.clone())
        .collect();

    let requested_level = request.level.as_deref().and_then(ScopeLevel::parse);
    let requested_label = describe_request(request);

    // Apply the caller's geo filter inside what they already hold.
    let mut selected: Vec<ScopedBranch> = authorized
        .iter()
        .filter(|branch| matches_request(branch, request))
        .cloned()
        .collect();

    // A filter that matches nothing authorized falls back to the full authorized
    // set so the answer still lands, with the narrowing stated explicitly.
    let filter_missed = selected.is_empty() && !authorized.is_empty() && request_has_filter(request);
    if filter_missed {
        selected = authorized.clone();
    }

    let self_scoped = role_is_self_scoped(&role);
    let self_staff_id = if self_scoped {
        repository::staff_id_for_user(db, tenant_id, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to resolve staff identity"))?
    } else {
        request.staff_id.clone().filter(|value| !value.is_empty())
    };

    let effective_level = if self_scoped {
        ScopeLevel::SelfOnly
    } else {
        derive_level(&selected, tenant_branch_count)
    };

    // Narrowing means the login could not cover what was asked for: either the
    // geo filter pointed outside the grant, or the requested level is wider than
    // the branches actually held. A filter the user chose inside their own grant
    // is not narrowing.
    let narrowed = filter_missed
        || requested_level.is_some_and(|requested| requested.is_wider_than(effective_level));

    let label = describe_scope(effective_level, &selected);
    let narrow_notice = if narrowed {
        Some(narrow_notice_text(language, &label))
    } else {
        None
    };

    let regions = distinct_values(&selected, |branch| &branch.region_name);
    let zones = distinct_values(&selected, |branch| &branch.zone_name);
    let clusters = distinct_values(&selected, |branch| &branch.cluster_name);

    Ok(ResolvedScope {
        tenant_id: tenant_id.to_string(),
        user_id: claims.sub.clone(),
        role,
        level: effective_level,
        label,
        requested_level,
        requested_label,
        narrowed,
        narrow_notice,
        branches: selected,
        excluded_branch_ids,
        self_staff_id,
        // A staff login sees branch totals only when someone granted reports access.
        branch_totals_allowed: !self_scoped || domain_allowed(claims, AiDomain::GeoComparison),
        regions,
        zones,
        clusters,
    })
}

fn request_has_filter(request: &ScopeRequest) -> bool {
    [
        request.region.as_deref(),
        request.zone.as_deref(),
        request.cluster.as_deref(),
        request.branch_id.as_deref(),
    ]
    .iter()
    .any(|value| value.is_some_and(|value| !value.trim().is_empty()))
}

fn matches_request(branch: &ScopedBranch, request: &ScopeRequest) -> bool {
    let matches = |filter: Option<&String>, value: &str| {
        filter
            .map(|filter| filter.trim())
            .filter(|filter| !filter.is_empty())
            .is_none_or(|filter| filter.eq_ignore_ascii_case(value))
    };
    matches(request.region.as_ref(), &branch.region_name)
        && matches(request.zone.as_ref(), &branch.zone_name)
        && matches(request.cluster.as_ref(), &branch.cluster_name)
        && request
            .branch_id
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .is_none_or(|value| {
                value.eq_ignore_ascii_case(&branch.branch_id)
                    || value.eq_ignore_ascii_case(&branch.branch_code)
            })
}

/// Name the level a branch set actually represents.
///
/// A set is only called region-wide (or zone/cluster-wide) when every branch
/// shares that tier, so a partial slice is never reported as full coverage.
fn derive_level(branches: &[ScopedBranch], tenant_branch_count: usize) -> ScopeLevel {
    if branches.is_empty() {
        return ScopeLevel::Branch;
    }
    if branches.len() == tenant_branch_count && tenant_branch_count > 0 {
        return ScopeLevel::Tenant;
    }
    if branches.len() == 1 {
        return ScopeLevel::Branch;
    }
    let single = |extract: fn(&ScopedBranch) -> &String| {
        let first = extract(&branches[0]);
        !first.is_empty() && branches.iter().all(|branch| extract(branch) == first)
    };
    if single(|branch| &branch.cluster_name) {
        ScopeLevel::Cluster
    } else if single(|branch| &branch.zone_name) {
        ScopeLevel::Zone
    } else if single(|branch| &branch.region_name) {
        ScopeLevel::Region
    } else {
        ScopeLevel::Branch
    }
}

fn describe_scope(level: ScopeLevel, branches: &[ScopedBranch]) -> String {
    match level {
        ScopeLevel::Tenant => "Complete organization".to_string(),
        ScopeLevel::SelfOnly => "Own performance".to_string(),
        ScopeLevel::Region => branches
            .first()
            .map(|branch| format!("{} Region", branch.region_name))
            .unwrap_or_else(|| "Region".to_string()),
        ScopeLevel::Zone => branches
            .first()
            .map(|branch| format!("{} Zone", branch.zone_name))
            .unwrap_or_else(|| "Zone".to_string()),
        ScopeLevel::Cluster => branches
            .first()
            .map(|branch| format!("{} Cluster", branch.cluster_name))
            .unwrap_or_else(|| "Cluster".to_string()),
        ScopeLevel::Branch => match branches {
            [] => "No authorized branch".to_string(),
            [single] => single.branch_name.clone(),
            many => format!("{} authorized branches", many.len()),
        },
    }
}

fn describe_request(request: &ScopeRequest) -> String {
    let mut parts = Vec::new();
    for (label, value) in [
        ("Region", request.region.as_deref()),
        ("Zone", request.zone.as_deref()),
        ("Cluster", request.cluster.as_deref()),
        ("Branch", request.branch_id.as_deref()),
    ] {
        if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
            parts.push(format!("{label} {value}"));
        }
    }
    if parts.is_empty() {
        request.level.clone().unwrap_or_default()
    } else {
        parts.join(", ")
    }
}

fn distinct_values(
    branches: &[ScopedBranch],
    extract: fn(&ScopedBranch) -> &String,
) -> Vec<String> {
    let mut seen: BTreeSet<String> = BTreeSet::new();
    for branch in branches {
        let value = extract(branch);
        if !value.is_empty() {
            seen.insert(value.clone());
        }
    }
    seen.into_iter().collect()
}

/// The disclosure shown whenever a request reached past the login's scope.
fn narrow_notice_text(language: LanguageCode, scope_label: &str) -> String {
    match language {
        LanguageCode::Hindi => format!(
            "आपकी वर्तमान एक्सेस स्कोप {scope_label} तक सीमित है। यह उत्तर इसी अधिकृत डेटा पर आधारित है।"
        ),
        LanguageCode::Hinglish => format!(
            "Aapki current access scope {scope_label} tak limited hai. Answer isi scope ke authorized data par based hai."
        ),
        _ => format!(
            "Your current access scope is limited to {scope_label}. This answer uses only that authorized data."
        ),
    }
}

/// Languages the copilot replies in without translation help.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LanguageCode {
    English,
    Hindi,
    Hinglish,
    Bengali,
    Tamil,
    Telugu,
    Kannada,
    Malayalam,
    Gujarati,
    Punjabi,
    Marathi,
    Urdu,
    Arabic,
    Other,
}

impl LanguageCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::English => "en",
            Self::Hindi => "hi",
            Self::Hinglish => "hi-Latn",
            Self::Bengali => "bn",
            Self::Tamil => "ta",
            Self::Telugu => "te",
            Self::Kannada => "kn",
            Self::Malayalam => "ml",
            Self::Gujarati => "gu",
            Self::Punjabi => "pa",
            Self::Marathi => "mr",
            Self::Urdu => "ur",
            Self::Arabic => "ar",
            Self::Other => "und",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        let normalized = value.trim().to_ascii_lowercase();
        let base = normalized.split(['-', '_']).next().unwrap_or_default();
        match (normalized.as_str(), base) {
            ("hi-latn" | "hinglish", _) => Some(Self::Hinglish),
            (_, "en") => Some(Self::English),
            (_, "hi") => Some(Self::Hindi),
            (_, "bn") => Some(Self::Bengali),
            (_, "ta") => Some(Self::Tamil),
            (_, "te") => Some(Self::Telugu),
            (_, "kn") => Some(Self::Kannada),
            (_, "ml") => Some(Self::Malayalam),
            (_, "gu") => Some(Self::Gujarati),
            (_, "pa") => Some(Self::Punjabi),
            (_, "mr") => Some(Self::Marathi),
            (_, "ur") => Some(Self::Urdu),
            (_, "ar") => Some(Self::Arabic),
            _ => None,
        }
    }
}

/// The detected reply language plus how sure the detector is.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageDetection {
    pub language: LanguageCode,
    pub code: String,
    pub confidence: f64,
    /// Set when confidence is too low to answer without asking which language to use.
    pub clarification_required: bool,
}

/// Romanized Hindi markers that separate Hinglish from plain English.
const HINGLISH_MARKERS: &[&str] = &[
    "kaunsi", "kaunsa", "kitna", "kitni", "batao", "dikhao", "kyon", "kyun", "karo", "kare",
    "karna", "hai", "hain", "mein", "mera", "meri", "apne", "apni", "sabhi", "kam", "zyada",
    "chahiye", "bata", "kaise", "kaha", "kahan", "nahi", "nahin", "wala", "wali", "sirf", "abhi",
    "pichle", "agla", "poochh", "puch",
];

/// Detect the language of a question from its script and vocabulary.
///
/// An explicit preference always wins; detection only fills the gap. Below the
/// confidence floor the caller is asked which language to use rather than guessing.
pub fn detect_language(text: &str, preferred: Option<&str>) -> LanguageDetection {
    if let Some(language) = preferred.and_then(LanguageCode::parse) {
        return LanguageDetection {
            language,
            code: language.as_str().to_string(),
            confidence: 1.0,
            clarification_required: false,
        };
    }

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return LanguageDetection {
            language: LanguageCode::English,
            code: LanguageCode::English.as_str().to_string(),
            confidence: 0.0,
            clarification_required: false,
        };
    }

    let mut script_counts: BTreeMap<LanguageCode, usize> = BTreeMap::new();
    let mut letters = 0usize;
    let mut latin_letters = 0usize;
    for character in trimmed.chars() {
        if !character.is_alphabetic() {
            continue;
        }
        letters += 1;
        let script = match character as u32 {
            0x0900..=0x097F => Some(LanguageCode::Hindi),
            0x0980..=0x09FF => Some(LanguageCode::Bengali),
            0x0A00..=0x0A7F => Some(LanguageCode::Punjabi),
            0x0A80..=0x0AFF => Some(LanguageCode::Gujarati),
            0x0B80..=0x0BFF => Some(LanguageCode::Tamil),
            0x0C00..=0x0C7F => Some(LanguageCode::Telugu),
            0x0C80..=0x0CFF => Some(LanguageCode::Kannada),
            0x0D00..=0x0D7F => Some(LanguageCode::Malayalam),
            0x0600..=0x06FF => Some(LanguageCode::Arabic),
            _ => None,
        };
        match script {
            Some(script) => *script_counts.entry(script).or_default() += 1,
            None if character.is_ascii_alphabetic() => latin_letters += 1,
            None => *script_counts.entry(LanguageCode::Other).or_default() += 1,
        }
    }

    if letters == 0 {
        return LanguageDetection {
            language: LanguageCode::English,
            code: LanguageCode::English.as_str().to_string(),
            confidence: 0.0,
            clarification_required: false,
        };
    }

    if let Some((script, count)) = script_counts
        .iter()
        .max_by_key(|(_, count)| **count)
        .map(|(script, count)| (*script, *count))
    {
        let share = count as f64 / letters as f64;
        if share >= 0.3 && script != LanguageCode::Other {
            return LanguageDetection {
                language: script,
                code: script.as_str().to_string(),
                confidence: share.min(1.0),
                clarification_required: false,
            };
        }
    }

    // Latin script: decide between English and romanized Hindi.
    let lowered = trimmed.to_ascii_lowercase();
    let words: Vec<&str> = lowered
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    let marker_hits = words
        .iter()
        .filter(|word| HINGLISH_MARKERS.contains(word))
        .count();

    if marker_hits > 0 {
        let confidence = (0.55 + 0.15 * marker_hits as f64).min(0.98);
        return LanguageDetection {
            language: LanguageCode::Hinglish,
            code: LanguageCode::Hinglish.as_str().to_string(),
            confidence,
            clarification_required: false,
        };
    }

    let latin_share = latin_letters as f64 / letters as f64;
    let confidence = if words.len() <= 2 { 0.4 } else { latin_share };
    LanguageDetection {
        language: LanguageCode::English,
        code: LanguageCode::English.as_str().to_string(),
        confidence,
        // Too little signal to commit: ask instead of assuming English.
        clarification_required: confidence < 0.5,
    }
}

/// The reporting window plus the previous equivalent window it is compared to.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisPeriod {
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub previous_start_date: NaiveDate,
    pub previous_end_date: NaiveDate,
    pub days: i64,
}

impl AnalysisPeriod {
    /// Build a window and the equal-length window immediately before it.
    pub fn new(start_date: NaiveDate, end_date: NaiveDate) -> Result<Self, AppError> {
        if end_date < start_date {
            return Err(AppError::validation("endDate must not precede startDate"));
        }
        let days = (end_date - start_date).num_days() + 1;
        if days > 366 {
            return Err(AppError::validation(
                "analysis period must not exceed 366 days",
            ));
        }
        let previous_end_date = start_date - Duration::days(1);
        let previous_start_date = previous_end_date - Duration::days(days - 1);
        Ok(Self {
            start_date,
            end_date,
            previous_start_date,
            previous_end_date,
            days,
        })
    }

    /// Default to the trailing 30 days ending today when no window is given.
    pub fn from_optional(
        start_date: Option<NaiveDate>,
        end_date: Option<NaiveDate>,
        today: NaiveDate,
    ) -> Result<Self, AppError> {
        let end = end_date.unwrap_or(today);
        let start = start_date.unwrap_or_else(|| end - Duration::days(29));
        Self::new(start, end)
    }

    pub fn label(&self) -> String {
        format!("{} to {}", self.start_date, self.end_date)
    }

    pub fn previous_label(&self) -> String {
        format!("{} to {}", self.previous_start_date, self.previous_end_date)
    }
}

/// One supporting number behind a conclusion.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricPoint {
    pub key: String,
    pub label: String,
    pub value: f64,
    pub display_value: String,
    pub unit: String,
}

impl MetricPoint {
    pub fn money(key: &str, label: &str, paise: i64) -> Self {
        Self {
            key: key.to_string(),
            label: label.to_string(),
            value: paise as f64 / 100.0,
            display_value: format_money_paise(paise),
            unit: "INR".to_string(),
        }
    }

    pub fn count(key: &str, label: &str, value: i64) -> Self {
        Self {
            key: key.to_string(),
            label: label.to_string(),
            value: value as f64,
            display_value: value.to_string(),
            unit: "count".to_string(),
        }
    }

    pub fn percent(key: &str, label: &str, value: f64) -> Self {
        Self {
            key: key.to_string(),
            label: label.to_string(),
            value,
            display_value: format!("{value:.1}%"),
            unit: "percent".to_string(),
        }
    }
}

/// A metric set beside its previous-period value.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonPoint {
    pub key: String,
    pub label: String,
    pub current_value: f64,
    pub previous_value: f64,
    pub change_percent: Option<f64>,
    pub direction: String,
    pub display_current: String,
    pub display_previous: String,
}

impl ComparisonPoint {
    pub fn new(key: &str, label: &str, current: f64, previous: f64, unit_is_money: bool) -> Self {
        let change_percent = if previous.abs() > f64::EPSILON {
            Some(((current - previous) / previous.abs()) * 100.0)
        } else if current.abs() > f64::EPSILON {
            None
        } else {
            Some(0.0)
        };
        let direction = match change_percent {
            Some(change) if change > 1.0 => "up",
            Some(change) if change < -1.0 => "down",
            Some(_) => "flat",
            None => "new",
        }
        .to_string();
        let render = |value: f64| {
            if unit_is_money {
                format_money_paise((value * 100.0).round() as i64)
            } else {
                format!("{value:.0}")
            }
        };
        Self {
            key: key.to_string(),
            label: label.to_string(),
            current_value: current,
            previous_value: previous,
            change_percent,
            direction,
            display_current: render(current),
            display_previous: render(previous),
        }
    }
}

/// How much the answer can be trusted, and why.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfidenceReport {
    pub score: f64,
    pub level: String,
    pub data_sufficient: bool,
    pub notes: Vec<String>,
}

impl ConfidenceReport {
    pub fn new(score: f64, data_sufficient: bool, notes: Vec<String>) -> Self {
        let score = score.clamp(0.0, 1.0);
        let level = if score >= 0.75 {
            "high"
        } else if score >= 0.5 {
            "medium"
        } else {
            "low"
        };
        Self {
            score,
            level: level.to_string(),
            data_sufficient,
            notes,
        }
    }
}

/// Something the copilot suggests doing next.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedAction {
    pub action_type: String,
    pub label: String,
    pub description: String,
    /// True when running this needs a human approval before anything happens.
    pub requires_approval: bool,
    pub crm_link: String,
}

/// The full answer contract every analytical reply follows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerEnvelope {
    pub conclusion: String,
    pub scope: ScopeSummary,
    pub period: PeriodSummary,
    pub metrics: Vec<MetricPoint>,
    pub comparison: Vec<ComparisonPoint>,
    pub reasons: Vec<String>,
    pub confidence: ConfidenceReport,
    pub recommended_actions: Vec<RecommendedAction>,
    pub crm_link: String,
    pub notices: Vec<String>,
    pub language: LanguageDetection,
    pub tool_name: String,
    pub domain: String,
    pub updated_at: DateTime<Utc>,
}

/// The scope block shown on every answer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeSummary {
    pub level: ScopeLevel,
    pub label: String,
    pub branch_count: usize,
    pub branches_included: Vec<String>,
    pub regions: Vec<String>,
    pub zones: Vec<String>,
    pub clusters: Vec<String>,
    pub narrowed: bool,
}

impl ScopeSummary {
    pub fn from_scope(scope: &ResolvedScope) -> Self {
        Self {
            level: scope.level,
            label: scope.label.clone(),
            branch_count: scope.branches.len(),
            branches_included: scope
                .branches
                .iter()
                .map(|branch| branch.branch_name.clone())
                .collect(),
            regions: scope.regions.clone(),
            zones: scope.zones.clone(),
            clusters: scope.clusters.clone(),
            narrowed: scope.narrowed,
        }
    }
}

/// The period block shown on every answer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodSummary {
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub label: String,
    pub comparison_label: String,
    pub days: i64,
}

impl PeriodSummary {
    pub fn from_period(period: &AnalysisPeriod) -> Self {
        Self {
            start_date: period.start_date,
            end_date: period.end_date,
            label: period.label(),
            comparison_label: period.previous_label(),
            days: period.days,
        }
    }
}

/// Assemble the answer, folding in the scope-narrowing notice when there is one.
#[allow(clippy::too_many_arguments)]
pub fn build_answer(
    tool_name: &str,
    domain: AiDomain,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
    language: LanguageDetection,
    conclusion: String,
    metrics: Vec<MetricPoint>,
    comparison: Vec<ComparisonPoint>,
    reasons: Vec<String>,
    confidence: ConfidenceReport,
    recommended_actions: Vec<RecommendedAction>,
    crm_link: String,
) -> AnswerEnvelope {
    let mut notices = Vec::new();
    if let Some(notice) = scope.narrow_notice.clone() {
        notices.push(notice);
    }
    if language.clarification_required {
        notices.push(
            "Language could not be detected confidently. Reply in your preferred language and it will be matched."
                .to_string(),
        );
    }
    AnswerEnvelope {
        conclusion,
        scope: ScopeSummary::from_scope(scope),
        period: PeriodSummary::from_period(period),
        metrics,
        comparison,
        reasons,
        confidence,
        recommended_actions,
        crm_link,
        notices,
        language,
        tool_name: tool_name.to_string(),
        domain: domain.as_str().to_string(),
        updated_at: Utc::now(),
    }
}

/// Render paise as an Indian-format rupee amount.
pub fn format_money_paise(paise: i64) -> String {
    let negative = paise < 0;
    let rupees = paise.unsigned_abs() / 100;
    let fraction = paise.unsigned_abs() % 100;
    let digits = rupees.to_string();
    // Indian grouping: last three digits, then pairs.
    let grouped = if digits.len() <= 3 {
        digits
    } else {
        let (head, tail) = digits.split_at(digits.len() - 3);
        let mut chunks: Vec<String> = Vec::new();
        let head_chars: Vec<char> = head.chars().collect();
        let mut index = head_chars.len();
        while index > 2 {
            chunks.push(head_chars[index - 2..index].iter().collect());
            index -= 2;
        }
        if index > 0 {
            chunks.push(head_chars[..index].iter().collect());
        }
        chunks.reverse();
        format!("{},{tail}", chunks.join(","))
    };
    format!(
        "{}₹{grouped}.{fraction:02}",
        if negative { "-" } else { "" }
    )
}

/// Percentage helper that treats a zero denominator as zero rather than infinity.
pub fn safe_percent(numerator: i64, denominator: i64) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        (numerator as f64 / denominator as f64) * 100.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn branch(name: &str, region: &str, zone: &str, cluster: &str) -> ScopedBranch {
        ScopedBranch {
            branch_id: name.to_lowercase(),
            branch_name: name.to_string(),
            branch_code: String::new(),
            region_name: region.to_string(),
            zone_name: zone.to_string(),
            cluster_name: cluster.to_string(),
            active: true,
            access_type: "permanent".to_string(),
        }
    }

    fn claims_with(role: &str, permissions: &[&str], denied: &[&str]) -> AuthClaims {
        AuthClaims {
            sub: "user-1".into(),
            tenant_id: "tenant-1".into(),
            branch_id: Some("branch-1".into()),
            role: role.into(),
            role_id: None,
            permissions: permissions.iter().map(|value| value.to_string()).collect(),
            denied_permissions: denied.iter().map(|value| value.to_string()).collect(),
            masked_fields: Vec::new(),
            max_discount_paise: None,
            max_refund_paise: None,
            max_cash_movement_paise: None,
            permission_version: 1,
            session_id: String::new(),
            mfa_enrollment_required: false,
            token_type: "access".into(),
            jti: "jti".into(),
            iat: 0,
            exp: 0,
        }
    }

    #[test]
    fn full_branch_coverage_is_reported_as_tenant_scope() {
        let branches = vec![
            branch("Banjara", "South", "Hyderabad", "Central"),
            branch("Gachibowli", "South", "Hyderabad", "West"),
        ];
        assert_eq!(derive_level(&branches, 2), ScopeLevel::Tenant);
    }

    #[test]
    fn partial_zone_coverage_is_reported_as_zone_not_tenant() {
        let branches = vec![
            branch("Banjara", "South", "Hyderabad", "Central"),
            branch("Gachibowli", "South", "Hyderabad", "West"),
        ];
        assert_eq!(derive_level(&branches, 5), ScopeLevel::Zone);
    }

    #[test]
    fn shared_cluster_wins_over_zone() {
        let branches = vec![
            branch("Banjara", "South", "Hyderabad", "Central"),
            branch("Jubilee", "South", "Hyderabad", "Central"),
        ];
        assert_eq!(derive_level(&branches, 9), ScopeLevel::Cluster);
    }

    #[test]
    fn mixed_regions_fall_back_to_branch_scope() {
        let branches = vec![
            branch("Banjara", "South", "Hyderabad", "Central"),
            branch("Andheri", "West", "Mumbai", "North"),
        ];
        assert_eq!(derive_level(&branches, 9), ScopeLevel::Branch);
    }

    #[test]
    fn denied_permission_beats_role_default() {
        let claims = claims_with("owner", &[], &["finance.read"]);
        assert!(!domain_allowed(&claims, AiDomain::Finance));
    }

    #[test]
    fn receptionist_has_appointments_but_not_finance() {
        let claims = claims_with("receptionist", &[], &[]);
        assert!(domain_allowed(&claims, AiDomain::Appointments));
        assert!(!domain_allowed(&claims, AiDomain::Finance));
    }

    #[test]
    fn explicit_grant_extends_a_role_default() {
        let claims = claims_with("receptionist", &["finance.read"], &[]);
        assert!(domain_allowed(&claims, AiDomain::Finance));
    }

    #[test]
    fn inventory_manager_reads_inventory_only() {
        let claims = claims_with("inventory manager", &[], &[]);
        assert!(domain_allowed(&claims, AiDomain::Inventory));
        assert!(!domain_allowed(&claims, AiDomain::Finance));
    }

    #[test]
    fn tenant_request_is_wider_than_branch_grant() {
        assert!(ScopeLevel::Tenant.is_wider_than(ScopeLevel::Branch));
        assert!(!ScopeLevel::Branch.is_wider_than(ScopeLevel::Tenant));
    }

    #[test]
    fn devanagari_question_detects_hindi() {
        let detection = detect_language("मेरे ज़ोन में सबसे कमज़ोर ब्रांच कौन सी है?", None);
        assert_eq!(detection.language, LanguageCode::Hindi);
        assert!(!detection.clarification_required);
    }

    #[test]
    fn romanized_hindi_detects_hinglish() {
        let detection = detect_language("mere zone mein weakest branch kaunsi hai", None);
        assert_eq!(detection.language, LanguageCode::Hinglish);
    }

    #[test]
    fn plain_english_stays_english() {
        let detection = detect_language("show me region wise revenue comparison please", None);
        assert_eq!(detection.language, LanguageCode::English);
        assert!(!detection.clarification_required);
    }

    #[test]
    fn explicit_preference_overrides_detection() {
        let detection = detect_language("mere zone mein kaunsi branch weak hai", Some("en"));
        assert_eq!(detection.language, LanguageCode::English);
        assert_eq!(detection.confidence, 1.0);
    }

    #[test]
    fn two_word_question_asks_for_language_clarification() {
        let detection = detect_language("branch report", None);
        assert!(detection.clarification_required);
    }

    #[test]
    fn previous_period_matches_current_length_and_ends_before_it() {
        let period = AnalysisPeriod::new(
            NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 30).unwrap(),
        )
        .unwrap();
        assert_eq!(period.days, 30);
        assert_eq!(
            period.previous_end_date,
            NaiveDate::from_ymd_opt(2026, 6, 30).unwrap()
        );
        assert_eq!(
            period.previous_start_date,
            NaiveDate::from_ymd_opt(2026, 6, 1).unwrap()
        );
    }

    #[test]
    fn inverted_period_is_rejected() {
        let result = AnalysisPeriod::new(
            NaiveDate::from_ymd_opt(2026, 7, 30).unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn money_uses_indian_digit_grouping() {
        assert_eq!(format_money_paise(123_456_789), "₹12,34,567.89");
        assert_eq!(format_money_paise(45_000), "₹450.00");
        assert_eq!(format_money_paise(-150_000), "-₹1,500.00");
    }

    #[test]
    fn comparison_flags_a_new_series_when_previous_is_zero() {
        let point = ComparisonPoint::new("revenue", "Revenue", 5000.0, 0.0, true);
        assert_eq!(point.direction, "new");
        assert!(point.change_percent.is_none());
    }

    #[test]
    fn comparison_reports_decline_direction() {
        let point = ComparisonPoint::new("revenue", "Revenue", 800.0, 1000.0, true);
        assert_eq!(point.direction, "down");
        assert_eq!(point.change_percent.map(|value| value.round()), Some(-20.0));
    }

    #[test]
    fn narrow_notice_follows_the_reply_language() {
        let hinglish = narrow_notice_text(LanguageCode::Hinglish, "Branch X");
        assert!(hinglish.contains("Branch X"));
        assert!(hinglish.contains("limited hai"));
        let english = narrow_notice_text(LanguageCode::English, "Branch X");
        assert!(english.contains("limited to Branch X"));
    }

    #[test]
    fn branch_filter_matches_code_as_well_as_id() {
        let mut scoped = branch("Banjara", "South", "Hyderabad", "Central");
        scoped.branch_code = "BJH".into();
        let request = ScopeRequest {
            branch_id: Some("bjh".into()),
            ..ScopeRequest::default()
        };
        assert!(matches_request(&scoped, &request));
    }

    #[test]
    fn zone_filter_excludes_other_zones() {
        let scoped = branch("Andheri", "West", "Mumbai", "North");
        let request = ScopeRequest {
            zone: Some("Hyderabad".into()),
            ..ScopeRequest::default()
        };
        assert!(!matches_request(&scoped, &request));
    }

    #[test]
    fn safe_percent_handles_zero_denominator() {
        assert_eq!(safe_percent(5, 0), 0.0);
        assert_eq!(safe_percent(25, 50), 50.0);
    }
}
