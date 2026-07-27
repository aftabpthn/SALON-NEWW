//! Single authoritative permission engine.
//!
//! Every permission the backend enforces lives here with its module, action,
//! sensitivity, subscription feature key, allowed scope, and sample backend
//! routes. The tenant permission catalog served to UI checkboxes is derived
//! from this registry, and tests in this module fail the build whenever a
//! route enforces an unregistered permission or a registered permission loses
//! its route mapping.

/// What kind of operation a permission grants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionAction {
    Read,
    Write,
    Approve,
    Export,
}

impl PermissionAction {
    pub const fn as_str(self) -> &'static str {
        match self {
            PermissionAction::Read => "read",
            PermissionAction::Write => "write",
            PermissionAction::Approve => "approve",
            PermissionAction::Export => "export",
        }
    }
}

/// The widest scope a permission may be granted at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionScope {
    /// Only affects the signed-in user's own records.
    SelfOnly,
    /// Branch-scoped operational access.
    Branch,
    /// Tenant-wide configuration or governance access.
    Tenant,
    /// SaaS platform administration; never grantable to salon staff.
    Platform,
}

impl PermissionScope {
    pub const fn as_str(self) -> &'static str {
        match self {
            PermissionScope::SelfOnly => "self",
            PermissionScope::Branch => "branch",
            PermissionScope::Tenant => "tenant",
            PermissionScope::Platform => "platform",
        }
    }
}

/// One authoritative permission definition.
pub struct PermissionSpec {
    pub key: &'static str,
    pub label: &'static str,
    /// Display module; also the checkbox group shown in the UI.
    pub module: &'static str,
    pub action: PermissionAction,
    pub scope: PermissionScope,
    /// Sensitive permissions require a reason, an explicit confirmation, and
    /// an audit trail whenever they are granted.
    pub sensitive: bool,
    /// Subscription feature this permission belongs to.
    pub feature_key: &'static str,
    /// Sample `(METHOD, path)` routes that must resolve to this permission in
    /// `middleware::tenant::route_access`. Verified by tests.
    #[allow(dead_code)]
    pub routes: &'static [(&'static str, &'static str)],
}

macro_rules! spec {
    ($key:literal, $label:literal, $module:literal, $action:ident, $scope:ident,
     sensitive: $sensitive:literal, feature: $feature:literal, routes: [$(($method:literal, $path:literal)),* $(,)?]) => {
        PermissionSpec {
            key: $key,
            label: $label,
            module: $module,
            action: PermissionAction::$action,
            scope: PermissionScope::$scope,
            sensitive: $sensitive,
            feature_key: $feature,
            routes: &[$(($method, $path)),*],
        }
    };
}

pub const PERMISSION_REGISTRY: &[PermissionSpec] = &[
    // Appointments
    spec!("appointments.read", "View appointments", "Appointments", Read, Branch,
        sensitive: false, feature: "appointments", routes: [("GET", "/appointments")]),
    spec!("appointments.manage", "Manage appointments", "Appointments", Write, Branch,
        sensitive: false, feature: "appointments", routes: [("POST", "/appointments")]),
    spec!("appointments.settings.manage", "Manage appointment settings", "Appointments", Write, Tenant,
        sensitive: false, feature: "appointments", routes: [("POST", "/appointment-settings")]),
    // Bookings
    spec!("bookings.read", "View booking operations", "Bookings", Read, Branch,
        sensitive: false, feature: "bookings", routes: [("GET", "/calendar")]),
    spec!("bookings.manage", "Manage booking operations", "Bookings", Write, Branch,
        sensitive: false, feature: "bookings", routes: [("POST", "/booking-wizard")]),
    // Clients
    spec!("clients.read", "View clients", "Clients", Read, Branch,
        sensitive: false, feature: "clients", routes: [("GET", "/clients")]),
    spec!("clients.manage", "Manage clients", "Clients", Write, Branch,
        sensitive: false, feature: "clients", routes: [("POST", "/clients")]),
    spec!("clients.consent.manage", "Manage client consent", "Clients", Write, Branch,
        sensitive: false, feature: "clients", routes: [("PATCH", "/clients/1/contact-preferences")]),
    spec!("clients.forms.manage", "Manage client forms", "Clients", Write, Branch,
        sensitive: false, feature: "clients", routes: [("POST", "/clients/forms")]),
    spec!("clients.merge", "Merge client profiles", "Clients", Write, Branch,
        sensitive: true, feature: "clients", routes: [("POST", "/clients/1/merge")]),
    spec!("clients.audit.read", "View client audit history", "Clients", Read, Branch,
        sensitive: false, feature: "clients", routes: [("GET", "/clients/1/audit")]),
    spec!("clients.reviews.link", "Link client reviews", "Clients", Write, Branch,
        sensitive: false, feature: "clients", routes: [("POST", "/clients/1/reviews")]),
    // POS
    spec!("pos.read", "View POS and invoices", "POS", Read, Branch,
        sensitive: false, feature: "pos", routes: [("GET", "/pos/invoices")]),
    spec!("pos.manage", "Manage POS and invoices", "POS", Write, Branch,
        sensitive: false, feature: "pos", routes: [("POST", "/pos/invoices")]),
    spec!("pos.void", "Void or credit invoices", "POS", Write, Branch,
        sensitive: true, feature: "pos", routes: [("POST", "/pos/invoices/1/void")]),
    spec!("pos.refund", "Refund invoices and payments", "POS", Write, Branch,
        sensitive: true, feature: "pos", routes: [("POST", "/pos/invoices/1/refund")]),
    // Services
    spec!("services.read", "View services", "Services", Read, Branch,
        sensitive: false, feature: "services", routes: [("GET", "/services")]),
    spec!("services.manage", "Manage services", "Services", Write, Tenant,
        sensitive: false, feature: "services", routes: [("POST", "/services")]),
    // Inventory
    spec!("inventory.read", "View inventory", "Inventory", Read, Branch,
        sensitive: false, feature: "inventory", routes: [("GET", "/inventory/products")]),
    spec!("inventory.manage", "Manage inventory", "Inventory", Write, Branch,
        sensitive: false, feature: "inventory", routes: [("POST", "/inventory/products")]),
    spec!("inventory.approve", "Approve inventory wastage", "Inventory", Approve, Tenant,
        sensitive: true, feature: "inventory", routes: [("PATCH", "/inventory/backbar-usage/1/review")]),
    spec!("purchases.read", "View purchases", "Inventory", Read, Branch,
        sensitive: false, feature: "purchases", routes: [("GET", "/purchases")]),
    spec!("purchases.manage", "Manage purchases", "Inventory", Write, Branch,
        sensitive: false, feature: "purchases", routes: [("POST", "/purchases")]),
    spec!("purchases.approve", "Approve purchase orders", "Inventory", Approve, Tenant,
        sensitive: true, feature: "purchases", routes: [("POST", "/purchases/1/approve")]),
    // Memberships & packages
    spec!("memberships.read", "View memberships", "Memberships", Read, Branch,
        sensitive: false, feature: "memberships", routes: [("GET", "/memberships")]),
    spec!("memberships.manage", "Manage memberships", "Memberships", Write, Branch,
        sensitive: false, feature: "memberships", routes: [("POST", "/memberships")]),
    spec!("packages.read", "View packages", "Packages", Read, Branch,
        sensitive: false, feature: "packages", routes: [("GET", "/packages")]),
    spec!("packages.manage", "Manage packages", "Packages", Write, Branch,
        sensitive: false, feature: "packages", routes: [("POST", "/packages")]),
    // Staff
    spec!("staff.read", "View staff", "Staff", Read, Branch,
        sensitive: false, feature: "staff.basic", routes: [("GET", "/staff")]),
    spec!("staff.manage", "Manage staff", "Staff", Write, Branch,
        sensitive: false, feature: "staff.basic", routes: [("POST", "/staff")]),
    spec!("staff.attendance.read", "View staff attendance", "Staff", Read, Branch,
        sensitive: false, feature: "staff.basic", routes: [("GET", "/staff-attendance")]),
    spec!("staff.attendance.manage", "Manage staff attendance", "Staff", Write, Branch,
        sensitive: false, feature: "staff.basic", routes: [("POST", "/staff-attendance/records")]),
    spec!("staff.leave.read", "View staff leave", "Staff", Read, Branch,
        sensitive: false, feature: "staff.basic", routes: [("GET", "/staff-leave")]),
    spec!("staff.leave.manage", "Manage staff leave", "Staff", Write, Branch,
        sensitive: false, feature: "staff.basic", routes: [("POST", "/staff-leave/approvals")]),
    spec!("staff.schedule.read", "View staff schedules", "Staff", Read, Branch,
        sensitive: false, feature: "staff.basic", routes: [("GET", "/staff-schedule")]),
    spec!("staff.schedule.manage", "Manage staff schedules", "Staff", Write, Branch,
        sensitive: false, feature: "staff.basic", routes: [("POST", "/staff-schedule")]),
    spec!("staff.payroll.read", "View staff payroll", "Staff", Read, Tenant,
        sensitive: false, feature: "staff.payroll", routes: [("GET", "/staff-payroll/runs")]),
    spec!("staff.payroll.manage", "Manage staff payroll", "Staff", Write, Tenant,
        sensitive: true, feature: "staff.payroll",
        routes: [("POST", "/staff-payroll/runs"), ("POST", "/staff/salary-revisions"), ("POST", "/staff/payroll-compliance/filings")]),
    spec!("staff.analytics.read", "View staff analytics", "Staff", Read, Branch,
        sensitive: false, feature: "staff.advanced", routes: [("GET", "/staff/performance")]),
    spec!("staff.self_manage", "Use staff self-service", "Staff", Write, SelfOnly,
        sensitive: false, feature: "staff.basic", routes: [("POST", "/staff-attendance/clock-in"), ("POST", "/staff/self/profile")]),
    // Finance & reports
    spec!("reports.read", "View reports", "Finance & reports", Read, Tenant,
        sensitive: false, feature: "reports", routes: [("GET", "/reports/sales")]),
    spec!("reports.export", "Export reports", "Finance & reports", Export, Tenant,
        sensitive: true, feature: "reports.export", routes: [("GET", "/reports/sales/export")]),
    spec!("finance.read", "View financial data", "Finance & reports", Read, Tenant,
        sensitive: false, feature: "finance", routes: [("GET", "/balance-sheet/live"), ("GET", "/finance/outgoing-funds")]),
    spec!("finance.write", "Manage finance and wallets", "Finance & reports", Write, Tenant,
        sensitive: true, feature: "finance", routes: [("POST", "/balance-sheet/journals"), ("POST", "/finance/outgoing-funds")]),
    // Notifications
    spec!("notifications.read", "View notifications", "Notifications", Read, Branch,
        sensitive: false, feature: "notifications", routes: [("GET", "/notifications")]),
    spec!("notifications.manage", "Manage notifications", "Notifications", Write, Branch,
        sensitive: false, feature: "notifications", routes: [("POST", "/notifications/templates")]),
    // Marketing
    spec!("marketing.read", "View marketing workflows", "Marketing", Read, Tenant,
        sensitive: false, feature: "marketing", routes: [("GET", "/marketing/campaigns")]),
    spec!("marketing.manage", "Manage marketing workflows", "Marketing", Write, Tenant,
        sensitive: false, feature: "marketing", routes: [("POST", "/marketing/campaigns")]),
    spec!("marketing.approve", "Approve marketing campaigns", "Marketing", Approve, Tenant,
        sensitive: false, feature: "marketing", routes: [("POST", "/marketing/campaigns/1/approve")]),
    spec!("marketing.send", "Send marketing campaigns", "Marketing", Write, Tenant,
        sensitive: false, feature: "marketing", routes: [("POST", "/marketing/campaigns/1/send")]),
    spec!("offers.approve", "Approve marketing offers", "Marketing", Approve, Tenant,
        sensitive: false, feature: "marketing", routes: [("POST", "/marketing/offers/1/approve")]),
    spec!("templates.manage", "Manage message templates", "Marketing", Write, Tenant,
        sensitive: false, feature: "marketing", routes: [("POST", "/marketing/templates")]),
    spec!("analytics.read", "View marketing analytics", "Marketing", Read, Tenant,
        sensitive: false, feature: "marketing", routes: [("GET", "/marketing/analytics")]),
    // AI
    spec!("ai.read", "View AI insights", "AI", Read, Branch,
        sensitive: false, feature: "staff.ai", routes: [("GET", "/ai/insights")]),
    spec!("ai.manage", "Manage AI workflows", "AI", Write, Tenant,
        sensitive: false, feature: "staff.ai", routes: [("POST", "/ai/concierge/sessions")]),
    // Settings
    spec!("settings.read", "View operational settings", "Settings", Read, Tenant,
        sensitive: false, feature: "settings", routes: [("GET", "/settings/general")]),
    spec!("settings.manage", "Manage operational settings", "Settings", Write, Tenant,
        sensitive: true, feature: "settings", routes: [("POST", "/settings/general")]),
    // Data migration
    spec!("data_migration.read", "View data migration jobs", "Data migration", Read, Tenant,
        sensitive: false, feature: "data_migration", routes: [("GET", "/settings/integrations/import-jobs")]),
    spec!("data_migration.manage", "Manage data migrations", "Data migration", Write, Tenant,
        sensitive: true, feature: "data_migration", routes: [("POST", "/settings/integrations/import-jobs")]),
    spec!("data_migration.export", "Export migration evidence", "Data migration", Export, Tenant,
        sensitive: true, feature: "data_migration", routes: [("GET", "/settings/integrations/import-jobs/job-1/proof-pack")]),
    // Security
    spec!("security.read", "View security controls and audit", "Security", Read, Tenant,
        sensitive: false, feature: "security", routes: [("GET", "/security/overview")]),
    spec!("security.manage", "Manage security controls and sessions", "Security", Write, Tenant,
        sensitive: true, feature: "security", routes: [("POST", "/security/policies")]),
    // Legacy compatibility
    spec!("tenant.read", "Legacy broad read access", "Compatibility", Read, Branch,
        sensitive: false, feature: "core", routes: [("GET", "/clients")]),
    spec!("front_desk.write", "Legacy front desk write access", "Compatibility", Write, Branch,
        sensitive: false, feature: "core", routes: [("POST", "/appointments")]),
    spec!("management.write", "Legacy management write access", "Compatibility", Write, Tenant,
        sensitive: true, feature: "core", routes: [("POST", "/staff")]),
    spec!("inventory.write", "Legacy inventory write access", "Compatibility", Write, Branch,
        sensitive: false, feature: "inventory", routes: [("POST", "/inventory/products")]),
    spec!("staff_self.write", "Legacy staff self-service access", "Compatibility", Write, SelfOnly,
        sensitive: false, feature: "staff.basic", routes: [("POST", "/staff/self/profile")]),
];

/// Every subscription feature key a plan may grant. Plans store granted
/// features in `saas_plans.features_json`; the entitlement engine matches
/// route requirements against them. `staff.biometric` and `staff.api` are
/// gated through `ROUTE_FEATURE_OVERRIDES` until they get dedicated
/// permission keys.
pub const ENTITLEMENT_FEATURE_KEYS: &[&str] = &[
    "staff.basic",
    "staff.advanced",
    "staff.payroll",
    "staff.biometric",
    "staff.ai",
    "staff.api",
    "reports.export",
    "appointments",
    "bookings",
    "clients",
    "pos",
    "services",
    "inventory",
    "purchases",
    "memberships",
    "packages",
    "reports",
    "finance",
    "notifications",
    "marketing",
    "settings",
    "data_migration",
    "security",
    "core",
];

/// Route prefixes whose subscription feature differs from (or refines) the
/// feature keys of the permissions guarding them. Longest prefix wins.
pub const ROUTE_FEATURE_OVERRIDES: &[(&str, &str)] = &[
    ("/staff/biometric", "staff.biometric"),
    ("/settings/integrations/api-keys", "staff.api"),
    ("/integrations", "staff.api"),
    ("/staff-enterprise", "staff.advanced"),
    ("/staff-os", "staff.advanced"),
    ("/staff/performance", "staff.advanced"),
    ("/staff/intelligence", "staff.advanced"),
    ("/staff/coach", "staff.advanced"),
];

/// The subscription feature required for a normalized route path, when route
/// metadata refines the permission-derived feature keys.
pub fn route_feature_override(path: &str) -> Option<&'static str> {
    ROUTE_FEATURE_OVERRIDES
        .iter()
        .filter(|(prefix, _)| {
            path == *prefix
                || (path.starts_with(prefix) && path.as_bytes().get(prefix.len()) == Some(&b'/'))
        })
        .max_by_key(|(prefix, _)| prefix.len())
        .map(|(_, feature)| *feature)
}

pub fn find(key: &str) -> Option<&'static PermissionSpec> {
    PERMISSION_REGISTRY.iter().find(|spec| spec.key == key)
}

#[allow(dead_code)]
pub fn is_registered(key: &str) -> bool {
    find(key).is_some()
}

pub fn is_sensitive(key: &str) -> bool {
    find(key).is_some_and(|spec| spec.sensitive)
}

/// The subset of `requested` permission keys that are flagged sensitive.
pub fn sensitive_subset<'a, I>(requested: I) -> Vec<String>
where
    I: IntoIterator<Item = &'a String>,
{
    requested
        .into_iter()
        .filter(|permission| is_sensitive(permission))
        .map(|permission| permission.to_string())
        .collect()
}

/// Permissions that a tenant role editor may assign. Platform-scoped
/// permissions are excluded by definition.
pub fn tenant_assignable() -> impl Iterator<Item = &'static PermissionSpec> {
    PERMISSION_REGISTRY
        .iter()
        .filter(|spec| spec.scope != PermissionScope::Platform)
}

/// A recommended system role shipped with the product.
#[allow(dead_code)]
pub struct SystemRoleTemplate {
    pub role_key: &'static str,
    pub name: &'static str,
    /// Widest scope this role operates at.
    pub scope: PermissionScope,
    /// Whether the Staff App role picker may offer this role for employee login.
    pub staff_app_selectable: bool,
    /// `None` means every tenant-assignable permission (owner/admin).
    pub permissions: Option<&'static [&'static str]>,
}

/// Recommended roles. Permission lists mirror the seeded system roles in
/// `migrations/0179_system_auth_role_templates.sql`; a drift between the two
/// is a bug.
#[allow(dead_code)]
pub const SYSTEM_ROLE_TEMPLATES: &[SystemRoleTemplate] = &[
    SystemRoleTemplate {
        role_key: "super_admin",
        name: "Super Admin",
        scope: PermissionScope::Platform,
        staff_app_selectable: false,
        // Platform administration is role-gated (PLATFORM_ROLES), not
        // tenant-permission-gated; a super admin never holds salon permissions.
        permissions: Some(&[]),
    },
    SystemRoleTemplate {
        role_key: "owner",
        name: "Owner",
        scope: PermissionScope::Tenant,
        staff_app_selectable: false,
        permissions: None,
    },
    SystemRoleTemplate {
        role_key: "admin",
        name: "Admin",
        scope: PermissionScope::Tenant,
        staff_app_selectable: false,
        permissions: None,
    },
    SystemRoleTemplate {
        role_key: "manager",
        name: "Manager",
        scope: PermissionScope::Branch,
        staff_app_selectable: true,
        permissions: Some(&[
            "appointments.read", "appointments.manage", "appointments.settings.manage",
            "bookings.read", "bookings.manage", "clients.read", "clients.manage",
            "clients.consent.manage", "clients.forms.manage", "clients.merge", "clients.audit.read",
            "pos.read", "pos.manage", "pos.void", "pos.refund", "services.read", "services.manage",
            "inventory.read", "inventory.manage", "inventory.approve", "purchases.read",
            "purchases.manage", "purchases.approve", "memberships.read", "memberships.manage",
            "packages.read", "packages.manage", "staff.read", "staff.manage",
            "staff.attendance.read", "staff.attendance.manage", "staff.leave.read",
            "staff.leave.manage", "staff.schedule.read", "staff.schedule.manage",
            "staff.payroll.read", "staff.analytics.read", "reports.read", "reports.export",
            "finance.read", "notifications.read", "notifications.manage", "marketing.read",
            "marketing.manage", "settings.read", "security.read", "tenant.read", "management.write",
        ]),
    },
    SystemRoleTemplate {
        role_key: "accountant",
        name: "Accountant",
        scope: PermissionScope::Tenant,
        staff_app_selectable: true,
        permissions: Some(&[
            "pos.read", "inventory.read", "purchases.read", "staff.payroll.read",
            "staff.payroll.manage", "reports.read", "reports.export", "finance.read", "finance.write",
        ]),
    },
    SystemRoleTemplate {
        role_key: "front_desk",
        name: "Front Desk",
        scope: PermissionScope::Branch,
        staff_app_selectable: true,
        permissions: Some(&[
            "appointments.read", "appointments.manage", "bookings.read", "bookings.manage",
            "clients.read", "clients.manage", "clients.consent.manage", "clients.forms.manage",
            "pos.read", "pos.manage", "services.read", "memberships.read", "packages.read",
            "notifications.read", "notifications.manage", "front_desk.write",
        ]),
    },
    SystemRoleTemplate {
        role_key: "cashier",
        name: "Cashier",
        scope: PermissionScope::Branch,
        staff_app_selectable: true,
        permissions: Some(&[
            "clients.read", "clients.manage", "pos.read", "pos.manage", "services.read",
            "memberships.read", "packages.read", "notifications.read",
        ]),
    },
    SystemRoleTemplate {
        role_key: "inventory_manager",
        name: "Inventory Manager",
        scope: PermissionScope::Branch,
        staff_app_selectable: true,
        permissions: Some(&[
            "services.read", "inventory.read", "inventory.manage", "inventory.approve",
            "purchases.read", "purchases.manage", "purchases.approve", "reports.read", "inventory.write",
        ]),
    },
    SystemRoleTemplate {
        role_key: "staff",
        name: "Staff",
        scope: PermissionScope::SelfOnly,
        staff_app_selectable: true,
        permissions: Some(&[
            "appointments.read", "clients.read", "services.read", "staff.attendance.read",
            "staff.leave.read", "staff.schedule.read", "staff.self_manage", "notifications.read",
            "staff_self.write",
        ]),
    },
];

#[allow(dead_code)]
pub fn role_template(role_key: &str) -> Option<&'static SystemRoleTemplate> {
    SYSTEM_ROLE_TEMPLATES
        .iter()
        .find(|template| template.role_key == role_key)
}

fn normalize_role_name(name: &str) -> String {
    name.chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

/// Roles that must never be assigned as a Staff App employee login:
/// `super_admin`, `owner`, and `admin` (matched by normalized name, so
/// "Super Admin", "super-admin", and "superadmin" are all covered).
pub fn is_privileged_role_name(name: &str) -> bool {
    let normalized = normalize_role_name(name);
    SYSTEM_ROLE_TEMPLATES
        .iter()
        .filter(|template| !template.staff_app_selectable)
        .any(|template| normalize_role_name(template.name) == normalized)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use axum::http::Method;

    use super::*;
    use crate::middleware::tenant::{
        normalize_route_path, role_or_permissions_allowed, route_access,
    };
    use crate::services::auth_service::AuthClaims;

    fn method(name: &str) -> Method {
        name.parse().expect("valid http method")
    }

    /// Paths beyond the per-permission samples so every branch of
    /// `route_access` is swept for unregistered permission keys.
    const EXTRA_ROUTE_SWEEP: &[(&str, &str)] = &[
        ("GET", "/api/v1/retention/overview"),
        ("POST", "/api/v1/retention/campaigns"),
        ("GET", "/api/v1/birthday-anniversary/overview"),
        ("POST", "/api/v1/birthday-anniversary/reminders/1/approve"),
        ("POST", "/api/v1/birthday-campaign/send-bulk"),
        ("GET", "/api/v1/saas/context"),
        ("POST", "/api/v1/saas/tickets"),
        ("GET", "/api/v1/jobs"),
        ("POST", "/api/v1/jobs"),
        ("GET", "/api/v1/whatsapp/templates"),
        ("POST", "/api/v1/whatsapp/templates"),
        ("GET", "/api/v1/team-chat/threads"),
        ("POST", "/api/v1/team-chat/threads"),
        ("GET", "/api/v1/settings/invoice"),
        ("POST", "/api/v1/settings/invoice"),
        ("POST", "/api/v1/settings/payment-methods"),
        ("GET", "/api/v1/settings/branches"),
        ("POST", "/api/v1/settings/branches"),
        ("POST", "/api/v1/settings/franchise-controls"),
        ("POST", "/api/v1/settings/booking"),
        ("GET", "/api/v1/settings/integrations/import-source-files/file-1/evidence"),
        ("GET", "/api/v1/finance/outgoing-funds/export"),
        ("POST", "/api/v1/pos/cash-drawer/open"),
        ("GET", "/api/v1/pos/z-reports/1/export"),
        ("POST", "/api/v1/pos/provider-reconciliations"),
        ("POST", "/api/v1/pos/invoices/1/credit-note"),
        ("POST", "/api/v1/appointment-deposits"),
        ("GET", "/api/v1/billing/plans"),
        ("POST", "/api/v1/booking-payments"),
        ("GET", "/api/v1/customers"),
        ("GET", "/api/v1/appointment-activity"),
        ("GET", "/api/v1/availability"),
        ("POST", "/api/v1/blackouts"),
        ("GET", "/api/v1/smart-booking/suggestions"),
        ("POST", "/api/v1/booking-groups"),
        ("POST", "/api/v1/membership-enterprise/rules"),
        ("POST", "/api/v1/package-enterprise/rules"),
        ("POST", "/api/v1/inventory/transfer-optimizer"),
        ("POST", "/api/v1/inventory/negative-stock-requests/1/review"),
        ("POST", "/api/v1/inventory/autonomous-operations/actions/1/review"),
        ("POST", "/api/v1/inventory/supplier-governance/communications/1/retry"),
        ("GET", "/api/v1/staff-enterprise/insights"),
        ("POST", "/api/v1/staff-enterprise/goals"),
        ("GET", "/api/v1/staff-os/dashboard"),
        ("GET", "/api/v1/profit-intelligence/advanced"),
        ("POST", "/api/v1/profit-intelligence/allocation-rules"),
        ("GET", "/api/v1/staff/tips/payouts"),
        ("POST", "/api/v1/staff/tips/payouts"),
        ("POST", "/api/v1/staff-attendance/clock-out"),
        ("POST", "/api/v1/staff-leave/requests"),
        ("POST", "/api/v1/staff/approvals/1"),
        ("GET", "/api/v1/staff/mobile/home"),
        ("GET", "/api/v1/security/audit"),
        ("POST", "/api/v1/security/sessions/revoke"),
        ("GET", "/api/v1/reports/custom/preview"),
        ("POST", "/api/v1/reports/custom/1/run"),
        ("GET", "/api/v1/booking-analytics/summary"),
        ("GET", "/api/v1/appointment-reports/summary"),
    ];

    #[test]
    fn registry_keys_are_unique_and_route_mapped() {
        let mut seen = BTreeSet::new();
        for spec in PERMISSION_REGISTRY {
            assert!(seen.insert(spec.key), "duplicate permission key {}", spec.key);
            assert!(
                !spec.routes.is_empty(),
                "permission {} has no backend route mapping",
                spec.key
            );
            assert!(!spec.label.is_empty() && !spec.module.is_empty());
            assert!(!spec.feature_key.is_empty());
        }
    }

    #[test]
    fn every_registry_permission_is_enforced_on_its_mapped_routes() {
        for spec in PERMISSION_REGISTRY {
            for (route_method, route_path) in spec.routes {
                let access = route_access(normalize_route_path(route_path), &method(route_method))
                    .unwrap_or_else(|| {
                        panic!(
                            "permission {} maps to unprotected route {} {}",
                            spec.key, route_method, route_path
                        )
                    });
                assert!(
                    access.permission_keys().contains(&spec.key),
                    "route {} {} does not enforce permission {}",
                    route_method,
                    route_path,
                    spec.key
                );
            }
        }
    }

    #[test]
    fn every_enforced_permission_is_registered() {
        let mut sweep: Vec<(String, String)> = EXTRA_ROUTE_SWEEP
            .iter()
            .map(|(route_method, route_path)| (route_method.to_string(), route_path.to_string()))
            .collect();
        for spec in PERMISSION_REGISTRY {
            for (route_method, route_path) in spec.routes {
                sweep.push((route_method.to_string(), route_path.to_string()));
            }
        }
        for (route_method, route_path) in sweep {
            let access = route_access(normalize_route_path(&route_path), &method(&route_method))
                .unwrap_or_else(|| {
                    panic!("{route_method} {route_path} has no permission mapping")
                });
            for permission in access.permission_keys() {
                assert!(
                    is_registered(permission),
                    "route {route_method} {route_path} enforces unregistered permission {permission}"
                );
            }
        }
    }

    #[test]
    fn role_templates_only_grant_registered_tenant_permissions() {
        let assignable: BTreeSet<&str> = tenant_assignable().map(|spec| spec.key).collect();
        for template in SYSTEM_ROLE_TEMPLATES {
            let Some(permissions) = template.permissions else {
                continue;
            };
            for permission in permissions {
                assert!(
                    assignable.contains(permission),
                    "role {} grants unknown or platform permission {}",
                    template.role_key,
                    permission
                );
            }
        }
    }

    #[test]
    fn super_admin_is_platform_only_and_never_a_salon_role() {
        let super_admin = role_template("super_admin").expect("super_admin template");
        assert_eq!(super_admin.scope, PermissionScope::Platform);
        assert!(!super_admin.staff_app_selectable);
        assert_eq!(super_admin.permissions, Some(&[] as &[&str]));
        for role_key in ["owner", "admin"] {
            let template = role_template(role_key).expect("template");
            assert!(
                !template.staff_app_selectable,
                "{role_key} must not be selectable as a Staff App employee login"
            );
        }
    }

    #[test]
    fn manager_defaults_exclude_payroll_security_and_statutory_rights() {
        let manager = role_template("manager").expect("manager template");
        let permissions: BTreeSet<&str> =
            manager.permissions.expect("manager permissions").iter().copied().collect();
        for excluded in [
            "staff.payroll.manage", // payroll modification + salary revisions + statutory filings
            "security.manage",      // API keys, biometric administration, audit administration
            "finance.write",
            "data_migration.manage",
            "data_migration.export",
            "settings.manage",
        ] {
            assert!(
                !permissions.contains(excluded),
                "manager default must not include {excluded}"
            );
        }
        assert!(permissions.contains("staff.payroll.read"));

        // Route-level proof: a manager with the default template cannot run
        // payroll, revise salaries, or administer security.
        let claims = AuthClaims {
            sub: "user-1".into(),
            tenant_id: "tenant-1".into(),
            branch_id: Some("branch-1".into()),
            role: "manager".into(),
            role_id: None,
            permissions: permissions.iter().map(|value| value.to_string()).collect(),
            denied_permissions: Vec::new(),
            masked_fields: Vec::new(),
            max_discount_paise: None,
            max_refund_paise: None,
            max_cash_movement_paise: None,
            permission_version: 1,
            mfa_enrollment_required: false,
            session_id: "session-1".into(),
            token_type: "access".into(),
            jti: "token-1".into(),
            iat: 1,
            exp: usize::MAX,
        };
        for (route_method, route_path) in [
            ("POST", "/api/v1/staff-payroll/runs"),
            ("POST", "/api/v1/staff/salary-revisions"),
            ("POST", "/api/v1/staff/payroll-compliance/filings"),
            ("POST", "/api/v1/security/policies"),
        ] {
            let access = route_access(normalize_route_path(route_path), &method(route_method))
                .expect("sensitive route is mapped");
            assert!(
                !role_or_permissions_allowed(&claims, access.role_keys(), access.permission_keys()),
                "manager default template must not pass {route_method} {route_path}"
            );
        }
    }

    #[test]
    fn staff_role_is_strictly_self_scoped_for_writes() {
        let staff = role_template("staff").expect("staff template");
        assert_eq!(staff.scope, PermissionScope::SelfOnly);
        for permission in staff.permissions.expect("staff permissions") {
            let spec = find(permission).expect("registered permission");
            if spec.action != PermissionAction::Read {
                assert_eq!(
                    spec.scope,
                    PermissionScope::SelfOnly,
                    "staff role may only write self-scoped data, found {permission}"
                );
            }
        }
    }

    #[test]
    fn sensitive_flags_cover_high_risk_permissions() {
        for key in [
            "pos.void",
            "pos.refund",
            "clients.merge",
            "staff.payroll.manage",
            "finance.write",
            "security.manage",
            "settings.manage",
            "data_migration.manage",
            "data_migration.export",
            "reports.export",
            "inventory.approve",
            "purchases.approve",
            "management.write",
        ] {
            assert!(is_sensitive(key), "{key} must be flagged sensitive");
        }
        assert_eq!(
            sensitive_subset(&["pos.refund".to_string(), "clients.read".to_string()]),
            vec!["pos.refund".to_string()]
        );
    }

    #[test]
    fn registry_feature_keys_belong_to_the_entitlement_catalog() {
        for spec in PERMISSION_REGISTRY {
            assert!(
                ENTITLEMENT_FEATURE_KEYS.contains(&spec.feature_key),
                "permission {} uses unknown feature key {}",
                spec.key,
                spec.feature_key
            );
        }
        for (prefix, feature) in ROUTE_FEATURE_OVERRIDES {
            assert!(
                ENTITLEMENT_FEATURE_KEYS.contains(feature),
                "route override {prefix} uses unknown feature key {feature}"
            );
        }
        assert_eq!(
            route_feature_override("/staff/biometric/devices"),
            Some("staff.biometric")
        );
        assert_eq!(
            route_feature_override("/settings/integrations/api-keys/1/rotate"),
            Some("staff.api")
        );
        assert_eq!(route_feature_override("/appointments"), None);
    }

    #[test]
    fn privileged_roles_are_blocked_for_employee_logins() {
        for name in [
            "owner", "Owner", "OWNER", "admin", "Admin", "super_admin", "Super Admin",
            "super-admin", "superadmin",
        ] {
            assert!(
                is_privileged_role_name(name),
                "{name} must be blocked for Staff App employee logins"
            );
        }
        for name in ["manager", "Front Desk", "cashier", "staff", "accountant", "Senior Stylist"] {
            assert!(
                !is_privileged_role_name(name),
                "{name} must stay assignable to employee logins"
            );
        }
    }

    #[test]
    fn unprotected_paths_are_denied_by_default() {
        assert!(
            route_access(normalize_route_path("/api/v1/not-a-real-module"), &Method::GET).is_none(),
            "unmapped routes must fall through to the default deny in require_route_role"
        );
    }
}
