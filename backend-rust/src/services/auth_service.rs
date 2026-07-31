use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub struct PermissionDefinition {
    pub code: &'static str,
    pub label: &'static str,
    pub group: &'static str,
}

impl PermissionDefinition {
    pub fn module(&self) -> &str {
        self.code.split('.').next().unwrap_or("unknown")
    }

    pub fn action(&self) -> &'static str {
        if self.code.ends_with(".read") {
            "read"
        } else if self.code.ends_with(".approve") {
            "approve"
        } else if self.code.ends_with(".export") {
            "export"
        } else {
            "write"
        }
    }

    pub fn scope(&self) -> &'static str {
        if self.code.starts_with("staff.app.")
            || self.code == "staff.self_manage"
            || self.code == "staff_self.write"
        {
            "self"
        } else if self.code.starts_with("settings.")
            || self.code.starts_with("security.")
            || self.code.starts_with("tenant.")
            || self.code.starts_with("data_migration.")
        {
            "tenant"
        } else {
            "branch"
        }
    }

    pub fn sensitive(&self) -> bool {
        self.action() == "approve"
            || self.action() == "export"
            || self.code.starts_with("finance.")
            || self.code.starts_with("security.")
            || self.code.contains("payroll")
            || self.code.contains("refund")
            || self.code.contains("void")
            || self.code == "clients.merge"
            || self.code == "data_migration.manage"
    }

    pub fn feature_key(&self) -> Option<&'static str> {
        if self.code == "reports.export" {
            Some("reports.export")
        } else if self.code.contains("payroll") {
            Some("staff.payroll")
        } else if self.code == "staff.analytics.read"
            || self.code.starts_with("staff.app.performance.")
            || self.code.starts_with("staff.app.leaderboard.")
            || self.code.starts_with("staff.app.reports.")
            || self.code.starts_with("staff.app.roster.")
        {
            Some("staff.advanced")
        } else if self.code.starts_with("staff.") || self.code == "staff_self.write" {
            Some("staff.basic")
        } else if self.code.starts_with("ai.") {
            Some("staff.ai")
        } else {
            None
        }
    }

    pub fn route_mapping(&self) -> &'static str {
        if self.group == "Compatibility" {
            "compatibility_alias"
        } else if matches!(
            self.code,
            "staff.app.business.client_name.read"
                | "staff.app.business.invoice_number.read"
                | "staff.app.business.discount.read"
                | "staff.app.business.tax.read"
                | "staff.app.business.service_amount.read"
                | "staff.app.business.commission.read"
        ) {
            "handler_field_policy"
        } else {
            "tenant_route_access"
        }
    }
}

pub fn permission_definition(code: &str) -> Option<&'static PermissionDefinition> {
    TENANT_PERMISSION_CATALOG
        .iter()
        .find(|permission| permission.code == code)
}

pub fn route_permissions_registered(permissions: &[&str]) -> bool {
    !permissions.is_empty()
        && permissions
            .iter()
            .all(|permission| permission_definition(permission).is_some())
}

pub fn feature_key_for_permissions(permissions: &[&str]) -> Option<&'static str> {
    permissions
        .iter()
        .find_map(|permission| permission_definition(permission)?.feature_key())
}

pub const TENANT_PERMISSION_CATALOG: &[PermissionDefinition] = &[
    PermissionDefinition {
        code: "appointments.read",
        label: "View appointments",
        group: "Appointments",
    },
    PermissionDefinition {
        code: "appointments.manage",
        label: "Manage appointments",
        group: "Appointments",
    },
    PermissionDefinition {
        code: "appointments.settings.manage",
        label: "Manage appointment settings",
        group: "Appointments",
    },
    PermissionDefinition {
        code: "bookings.read",
        label: "View booking operations",
        group: "Bookings",
    },
    PermissionDefinition {
        code: "bookings.manage",
        label: "Manage booking operations",
        group: "Bookings",
    },
    PermissionDefinition {
        code: "clients.read",
        label: "View clients",
        group: "Clients",
    },
    PermissionDefinition {
        code: "clients.manage",
        label: "Manage clients",
        group: "Clients",
    },
    PermissionDefinition {
        code: "clients.consent.manage",
        label: "Manage client consent",
        group: "Clients",
    },
    PermissionDefinition {
        code: "clients.forms.manage",
        label: "Manage client forms",
        group: "Clients",
    },
    PermissionDefinition {
        code: "clients.merge",
        label: "Merge client profiles",
        group: "Clients",
    },
    PermissionDefinition {
        code: "clients.audit.read",
        label: "View client audit history",
        group: "Clients",
    },
    PermissionDefinition {
        code: "clients.reviews.link",
        label: "Link client reviews",
        group: "Clients",
    },
    PermissionDefinition {
        code: "pos.read",
        label: "View POS and invoices",
        group: "POS",
    },
    PermissionDefinition {
        code: "pos.manage",
        label: "Manage POS and invoices",
        group: "POS",
    },
    PermissionDefinition {
        code: "pos.void",
        label: "Void or credit invoices",
        group: "POS",
    },
    PermissionDefinition {
        code: "pos.refund",
        label: "Refund invoices and payments",
        group: "POS",
    },
    PermissionDefinition {
        code: "services.read",
        label: "View services",
        group: "Services",
    },
    PermissionDefinition {
        code: "services.manage",
        label: "Manage services",
        group: "Services",
    },
    PermissionDefinition {
        code: "inventory.read",
        label: "View inventory",
        group: "Inventory",
    },
    PermissionDefinition {
        code: "inventory.manage",
        label: "Manage inventory",
        group: "Inventory",
    },
    PermissionDefinition {
        code: "inventory.approve",
        label: "Approve inventory wastage",
        group: "Inventory",
    },
    PermissionDefinition {
        code: "purchases.read",
        label: "View purchases",
        group: "Inventory",
    },
    PermissionDefinition {
        code: "purchases.manage",
        label: "Manage purchases",
        group: "Inventory",
    },
    PermissionDefinition {
        code: "purchases.approve",
        label: "Approve purchase orders",
        group: "Inventory",
    },
    PermissionDefinition {
        code: "memberships.read",
        label: "View memberships",
        group: "Memberships",
    },
    PermissionDefinition {
        code: "memberships.manage",
        label: "Manage memberships",
        group: "Memberships",
    },
    PermissionDefinition {
        code: "packages.read",
        label: "View packages",
        group: "Packages",
    },
    PermissionDefinition {
        code: "packages.manage",
        label: "Manage packages",
        group: "Packages",
    },
    PermissionDefinition {
        code: "staff.read",
        label: "View staff",
        group: "Staff",
    },
    PermissionDefinition {
        code: "staff.manage",
        label: "Manage staff",
        group: "Staff",
    },
    PermissionDefinition {
        code: "staff.attendance.read",
        label: "View staff attendance",
        group: "Staff",
    },
    PermissionDefinition {
        code: "staff.attendance.manage",
        label: "Manage staff attendance",
        group: "Staff",
    },
    PermissionDefinition {
        code: "staff.leave.read",
        label: "View staff leave",
        group: "Staff",
    },
    PermissionDefinition {
        code: "staff.leave.manage",
        label: "Manage staff leave",
        group: "Staff",
    },
    PermissionDefinition {
        code: "staff.schedule.read",
        label: "View staff schedules",
        group: "Staff",
    },
    PermissionDefinition {
        code: "staff.schedule.manage",
        label: "Manage staff schedules",
        group: "Staff",
    },
    PermissionDefinition {
        code: "staff.payroll.read",
        label: "View staff payroll",
        group: "Staff",
    },
    PermissionDefinition {
        code: "staff.payroll.manage",
        label: "Manage staff payroll",
        group: "Staff",
    },
    PermissionDefinition {
        code: "staff.analytics.read",
        label: "View staff analytics",
        group: "Staff",
    },
    PermissionDefinition {
        code: "staff.self_manage",
        label: "Use staff self-service",
        group: "Staff",
    },
    PermissionDefinition {
        code: "staff.app.dashboard.read",
        label: "Show Staff App dashboard",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.appointments.read",
        label: "Show Staff App appointments",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.appointments.manage",
        label: "Manage Staff App appointments",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.business.read",
        label: "Show Staff App business",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.business.client_name.read",
        label: "Show client names in Staff App business",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.business.invoice_number.read",
        label: "Show invoice numbers in Staff App business",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.business.discount.read",
        label: "Show discounts in Staff App business",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.business.tax.read",
        label: "Show GST in Staff App business",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.business.service_amount.read",
        label: "Show service amounts in Staff App business",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.business.commission.read",
        label: "Show commission in Staff App business",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.offers.read",
        label: "Show Staff App offers",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.queue.read",
        label: "Show Staff App queue",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.tasks.read",
        label: "Show Staff App tasks",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.rules.read",
        label: "Show Staff App rules and SOP",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.tasks.manage",
        label: "Update Staff App tasks",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.attendance.read",
        label: "Show Staff App attendance",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.attendance.manage",
        label: "Use Staff App attendance actions",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.roster.read",
        label: "Show Staff App roster",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.roster.manage",
        label: "Update Staff App roster",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.calendar.read",
        label: "Show Staff App calendar",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.calendar.manage",
        label: "Update Staff App calendar",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.performance.read",
        label: "Show Staff App performance",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.leaderboard.read",
        label: "Show Staff App leaderboard",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.notifications.read",
        label: "Show Staff App notifications",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.notifications.manage",
        label: "Update Staff App notifications",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.reports.read",
        label: "Show Staff App reports",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.chat.read",
        label: "Show Staff App chat",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.chat.manage",
        label: "Send Staff App chat messages",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.payroll.read",
        label: "Show Staff App payroll and payslips",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.leaves.read",
        label: "Show Staff App leaves",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.leaves.manage",
        label: "Request leave in Staff App",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.feedback.read",
        label: "Show Staff App feedback",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.feedback.manage",
        label: "Submit Staff App feedback",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.profile.read",
        label: "Show Staff App profile",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.settings.read",
        label: "Show Staff App settings",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "staff.app.settings.manage",
        label: "Manage Staff App settings",
        group: "Staff App",
    },
    PermissionDefinition {
        code: "reports.read",
        label: "View reports",
        group: "Finance & reports",
    },
    PermissionDefinition {
        code: "reports.export",
        label: "Export reports",
        group: "Finance & reports",
    },
    PermissionDefinition {
        code: "finance.read",
        label: "View financial data",
        group: "Finance & reports",
    },
    PermissionDefinition {
        code: "finance.write",
        label: "Manage finance and wallets",
        group: "Finance & reports",
    },
    PermissionDefinition {
        code: "notifications.read",
        label: "View notifications",
        group: "Notifications",
    },
    PermissionDefinition {
        code: "notifications.manage",
        label: "Manage notifications",
        group: "Notifications",
    },
    PermissionDefinition {
        code: "marketing.read",
        label: "View marketing workflows",
        group: "Marketing",
    },
    PermissionDefinition {
        code: "marketing.manage",
        label: "Manage marketing workflows",
        group: "Marketing",
    },
    PermissionDefinition {
        code: "marketing.approve",
        label: "Approve marketing campaigns",
        group: "Marketing",
    },
    PermissionDefinition {
        code: "marketing.send",
        label: "Send marketing campaigns",
        group: "Marketing",
    },
    PermissionDefinition {
        code: "ai.concierge.read",
        label: "Use AI concierge",
        group: "AI",
    },
    PermissionDefinition {
        code: "ai.concierge.manage",
        label: "Manage AI concierge governance",
        group: "AI",
    },
    PermissionDefinition {
        code: "offers.approve",
        label: "Approve marketing offers",
        group: "Marketing",
    },
    PermissionDefinition {
        code: "templates.manage",
        label: "Manage message templates",
        group: "Marketing",
    },
    PermissionDefinition {
        code: "analytics.read",
        label: "View marketing analytics",
        group: "Marketing",
    },
    PermissionDefinition {
        code: "ai.read",
        label: "View AI recommendations",
        group: "AI",
    },
    PermissionDefinition {
        code: "ai.manage",
        label: "Manage AI workflows",
        group: "AI",
    },
    PermissionDefinition {
        code: "settings.read",
        label: "View operational settings",
        group: "Settings",
    },
    PermissionDefinition {
        code: "settings.manage",
        label: "Manage operational settings",
        group: "Settings",
    },
    PermissionDefinition {
        code: "data_migration.read",
        label: "View data migration jobs",
        group: "Data migration",
    },
    PermissionDefinition {
        code: "data_migration.manage",
        label: "Manage data migrations",
        group: "Data migration",
    },
    PermissionDefinition {
        code: "data_migration.export",
        label: "Export migration evidence",
        group: "Data migration",
    },
    PermissionDefinition {
        code: "security.read",
        label: "View security controls and audit",
        group: "Security",
    },
    PermissionDefinition {
        code: "security.manage",
        label: "Manage security controls and sessions",
        group: "Security",
    },
    PermissionDefinition {
        code: "tenant.read",
        label: "Legacy broad read access",
        group: "Compatibility",
    },
    PermissionDefinition {
        code: "front_desk.write",
        label: "Legacy front desk write access",
        group: "Compatibility",
    },
    PermissionDefinition {
        code: "management.write",
        label: "Legacy management write access",
        group: "Compatibility",
    },
    PermissionDefinition {
        code: "inventory.write",
        label: "Legacy inventory write access",
        group: "Compatibility",
    },
    PermissionDefinition {
        code: "staff_self.write",
        label: "Legacy staff self-service access",
        group: "Compatibility",
    },
];

pub fn staff_app_permission_allowed(
    claims: &AuthClaims,
    permission: &str,
    default_roles: &[&str],
    legacy_permissions: &[&str],
) -> bool {
    let denied = claims.denied_permissions.iter().any(|denied| {
        denied == permission || legacy_permissions.iter().any(|legacy| denied == legacy)
    });
    !denied
        && (default_roles
            .iter()
            .any(|role| role.eq_ignore_ascii_case(&claims.role))
            || claims.permissions.iter().any(|allowed| {
                allowed == permission || legacy_permissions.iter().any(|legacy| allowed == legacy)
            }))
}

#[allow(dead_code)]
pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)?
        .to_string())
}

pub fn verify_password(password: &str, password_hash: &str) -> bool {
    PasswordHash::new(password_hash)
        .ok()
        .and_then(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .ok()
        })
        .is_some()
}

pub fn password_meets_policy(password: &str) -> bool {
    (12..=128).contains(&password.chars().count())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthClaims {
    pub sub: String,
    pub tenant_id: String,
    pub branch_id: Option<String>,
    pub role: String,
    #[serde(default)]
    pub role_id: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub denied_permissions: Vec<String>,
    #[serde(default)]
    pub masked_fields: Vec<String>,
    #[serde(default)]
    pub max_discount_paise: Option<i64>,
    #[serde(default)]
    pub max_refund_paise: Option<i64>,
    #[serde(default)]
    pub max_cash_movement_paise: Option<i64>,
    #[serde(default)]
    pub permission_version: i64,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub mfa_enrollment_required: bool,
    pub token_type: String,
    pub jti: String,
    pub iat: usize,
    pub exp: usize,
}

#[derive(Debug, Serialize)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: &'static str,
    pub expires_in_seconds: u64,
    pub must_change_password: bool,
    pub mfa_enrollment_required: bool,
}

pub struct TokenScope<'a> {
    pub user_id: &'a str,
    pub tenant_id: &'a str,
    pub branch_id: Option<&'a str>,
    pub role_id: Option<&'a str>,
    pub role: &'a str,
    pub permissions: &'a [String],
    pub permission_version: i64,
    pub session_id: &'a str,
    pub must_change_password: bool,
    pub mfa_enrollment_required: bool,
}

pub fn issue_token_pair(
    user_id: &str,
    tenant_id: &str,
    branch_id: Option<String>,
    role: &str,
    access_secret: &str,
    refresh_secret: &str,
    access_ttl_minutes: u64,
    refresh_ttl_days: u64,
) -> Result<(TokenPair, chrono::DateTime<Utc>), jsonwebtoken::errors::Error> {
    let session_id = Uuid::new_v4().to_string();
    issue_scoped_token_pair(
        TokenScope {
            user_id,
            tenant_id,
            branch_id: branch_id.as_deref(),
            role_id: None,
            role,
            permissions: &[],
            permission_version: 1,
            session_id: &session_id,
            must_change_password: false,
            mfa_enrollment_required: false,
        },
        access_secret,
        refresh_secret,
        access_ttl_minutes,
        refresh_ttl_days,
    )
}

pub fn issue_scoped_token_pair(
    scope: TokenScope<'_>,
    access_secret: &str,
    refresh_secret: &str,
    access_ttl_minutes: u64,
    refresh_ttl_days: u64,
) -> Result<(TokenPair, chrono::DateTime<Utc>), jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let access_exp = now + Duration::minutes(access_ttl_minutes as i64);
    let refresh_exp = now + Duration::days(refresh_ttl_days as i64);

    let access_claims = claims(&scope, "access", now, access_exp);
    let refresh_claims = claims(&scope, "refresh", now, refresh_exp);

    let access_token = encode(
        &Header::default(),
        &access_claims,
        &EncodingKey::from_secret(access_secret.as_bytes()),
    )?;
    let refresh_token = encode(
        &Header::default(),
        &refresh_claims,
        &EncodingKey::from_secret(refresh_secret.as_bytes()),
    )?;

    Ok((
        TokenPair {
            access_token,
            refresh_token,
            token_type: "Bearer",
            expires_in_seconds: access_ttl_minutes * 60,
            must_change_password: scope.must_change_password,
            mfa_enrollment_required: scope.mfa_enrollment_required,
        },
        refresh_exp,
    ))
}

pub fn issue_branch_selection_token(
    user_id: &str,
    tenant_id: &str,
    permission_version: i64,
    secret: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let claims = AuthClaims {
        sub: user_id.to_string(),
        tenant_id: tenant_id.to_string(),
        branch_id: None,
        role: String::new(),
        role_id: None,
        permissions: Vec::new(),
        denied_permissions: Vec::new(),
        masked_fields: Vec::new(),
        max_discount_paise: None,
        max_refund_paise: None,
        max_cash_movement_paise: None,
        permission_version,
        session_id: String::new(),
        mfa_enrollment_required: false,
        token_type: "branch_selection".to_string(),
        jti: Uuid::new_v4().to_string(),
        iat: now.timestamp() as usize,
        exp: (now + Duration::minutes(5)).timestamp() as usize,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn decode_access_token(
    token: &str,
    secret: &str,
) -> Result<AuthClaims, jsonwebtoken::errors::Error> {
    decode::<AuthClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)
}

pub fn decode_refresh_token(
    token: &str,
    secret: &str,
) -> Result<AuthClaims, jsonwebtoken::errors::Error> {
    decode::<AuthClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)
}

pub fn token_hash(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn claims(
    scope: &TokenScope<'_>,
    token_type: &str,
    issued_at: chrono::DateTime<Utc>,
    expires_at: chrono::DateTime<Utc>,
) -> AuthClaims {
    AuthClaims {
        sub: scope.user_id.to_string(),
        tenant_id: scope.tenant_id.to_string(),
        branch_id: scope.branch_id.map(str::to_string),
        role: scope.role.to_string(),
        role_id: scope.role_id.map(str::to_string),
        permissions: scope.permissions.to_vec(),
        denied_permissions: Vec::new(),
        masked_fields: Vec::new(),
        max_discount_paise: None,
        max_refund_paise: None,
        max_cash_movement_paise: None,
        permission_version: scope.permission_version,
        session_id: scope.session_id.to_string(),
        mfa_enrollment_required: scope.mfa_enrollment_required,
        token_type: token_type.to_string(),
        jti: Uuid::new_v4().to_string(),
        iat: issued_at.timestamp() as usize,
        exp: expires_at.timestamp() as usize,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decode_access_token, issue_scoped_token_pair, password_meets_policy, permission_definition,
        staff_app_permission_allowed, TokenScope,
    };

    #[test]
    fn scoped_token_round_trip_preserves_branch_role_and_permissions() {
        let permissions = vec!["read:appointments".to_string()];
        let (tokens, _) = issue_scoped_token_pair(
            TokenScope {
                user_id: "user-1",
                tenant_id: "tenant-1",
                branch_id: Some("branch-2"),
                role_id: Some("role-manager"),
                role: "manager",
                permissions: &permissions,
                permission_version: 4,
                session_id: "session-1",
                must_change_password: false,
                mfa_enrollment_required: true,
            },
            "access-secret-with-enough-entropy",
            "refresh-secret-with-enough-entropy",
            15,
            30,
        )
        .expect("token pair");

        let mut claims =
            decode_access_token(&tokens.access_token, "access-secret-with-enough-entropy")
                .expect("access claims");
        assert_eq!(claims.branch_id.as_deref(), Some("branch-2"));
        assert_eq!(claims.role, "manager");
        assert_eq!(claims.permissions, permissions);
        assert_eq!(claims.permission_version, 4);
        assert_eq!(claims.session_id, "session-1");
        assert!(claims.mfa_enrollment_required);
        assert!(staff_app_permission_allowed(
            &claims,
            "staff.app.appointments.read",
            &["staff"],
            &["read:appointments"],
        ));
        claims.denied_permissions = vec!["staff.app.appointments.read".into()];
        assert!(!staff_app_permission_allowed(
            &claims,
            "staff.app.appointments.read",
            &["staff"],
            &["read:appointments"],
        ));
    }

    #[test]
    fn password_policy_accepts_only_bounded_passwords() {
        assert!(!password_meets_policy("short"));
        assert!(password_meets_policy("twelve-chars"));
        assert!(!password_meets_policy(&"x".repeat(129)));
    }

    #[test]
    fn rules_permission_is_registered_for_custom_roles() {
        let permission = permission_definition("staff.app.rules.read")
            .expect("rules permission should be configurable");

        assert_eq!(permission.group, "Staff App");
        assert_eq!(permission.action(), "read");
        assert_eq!(permission.scope(), "self");
    }
}
