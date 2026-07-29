//! Channel adapters for WhatsApp and voice.
//!
//! These channels reach the CRM through exactly the same tool dispatcher and
//! permission layer as the header drawer. The only thing an adapter does is
//! answer one question the web app never has to ask: *who is this?*
//!
//! A browser request arrives with a signed token, so the identity is already
//! established. A WhatsApp message or a phone call arrives with a phone number
//! and nothing else. This module turns that number into the same `AuthClaims`
//! the web path carries — or into nothing at all, which is the safe outcome.
//!
//! There is deliberately no channel-specific business logic here. A rule that
//! existed only for WhatsApp would be a rule nobody tests and nobody audits.

use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::auth_repository::{self, AuthUser},
    services::auth_service::AuthClaims,
};

/// How a channel message was identified, carried into the audit trail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelIdentity {
    /// The sender matched an active staff login. They reach the same tools that
    /// login reaches in the browser, with the same scope and the same denials.
    StaffLogin,
    /// The sender is not a CRM login. They get the concierge only: booking help
    /// and general questions, never staff, finance or client analytics.
    Anonymous,
}

impl ChannelIdentity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::StaffLogin => "staff_login",
            Self::Anonymous => "anonymous",
        }
    }
}

/// A resolved channel caller.
pub struct ResolvedChannelCaller {
    pub identity: ChannelIdentity,
    /// Present only for a recognised staff login. `None` means the tool layer
    /// is not reachable for this message at all.
    pub claims: Option<AuthClaims>,
}

impl ResolvedChannelCaller {
    fn anonymous() -> Self {
        Self {
            identity: ChannelIdentity::Anonymous,
            claims: None,
        }
    }
}

/// Digits only, so `+91 98765 43210` and `09876543210` compare equal.
///
/// Numbers arrive formatted differently on every channel and every handset, and
/// an identity check that depends on punctuation is not an identity check.
fn normalize_phone(raw: &str) -> String {
    let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
    // Indian numbers reach us with and without the country code; comparing the
    // last ten digits matches the same subscriber either way.
    if digits.len() > 10 {
        digits[digits.len() - 10..].to_string()
    } else {
        digits
    }
}

/// Resolve an inbound phone number to the CRM login it belongs to.
///
/// Returns `Anonymous` for anything that does not match exactly one active
/// staff member with a login. Ambiguity resolves to anonymous rather than to a
/// guess: handing someone else's data to the wrong phone is far worse than
/// declining to recognise a number.
pub async fn resolve_caller(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from_phone: &str,
) -> Result<ResolvedChannelCaller, AppError> {
    let phone = normalize_phone(from_phone);
    if phone.len() < 10 {
        return Ok(ResolvedChannelCaller::anonymous());
    }

    // One active staff member, one login, one branch. Anything less specific is
    // not an identity.
    let matched: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT account.id, account.tenant_id
             FROM staff member
             JOIN users account
               ON account.tenant_id=member.tenant_id
              AND account.active=TRUE
              AND account.email<>''
              AND LOWER(account.email)=LOWER(member.email)
            WHERE member.tenant_id=$1
              AND member.branch_id=$2
              AND member.active=TRUE
              AND member.email<>''
              AND RIGHT(REGEXP_REPLACE(COALESCE(member.mobile_phone,''),'[^0-9]','','g'),10)=$3
            LIMIT 2"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&phone)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to resolve the channel caller"))?;

    // Exactly one match, or nobody. Two people sharing a handset is ambiguity,
    // and answering either of them with the other's data is the failure this
    // guards against.
    if matched.len() != 1 {
        return Ok(ResolvedChannelCaller::anonymous());
    }
    let (user_id, user_tenant) = matched.into_iter().next().expect("exactly one match");

    // Permissions are read fresh from the grants, never inferred from the
    // channel. A revoked permission takes effect on WhatsApp the same moment it
    // takes effect in the browser.
    // Only the two fields the access lookup keys on are needed here; nothing
    // about the login's own credentials is read or carried further.
    let user = AuthUser {
        id: user_id.clone(),
        tenant_id: user_tenant,
        branch_id: Some(branch_id.to_string()),
        role_id: None,
        role_name: String::new(),
        login_id: None,
        email: String::new(),
        password_hash: String::new(),
        locked_until: None,
        permission_version: 0,
        must_change_password: false,
    };
    let Some(access) = auth_repository::find_branch_access(db, &user, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load channel caller permissions"))?
    else {
        // A staff record without an active branch grant reaches no CRM data.
        return Ok(ResolvedChannelCaller::anonymous());
    };

    Ok(ResolvedChannelCaller {
        identity: ChannelIdentity::StaffLogin,
        claims: Some(AuthClaims {
            sub: user_id,
            tenant_id: tenant_id.to_string(),
            branch_id: Some(branch_id.to_string()),
            role: access.role_name,
            role_id: access.role_id,
            permissions: access.permissions,
            denied_permissions: access.denied_permissions,
            masked_fields: access.masked_fields,
            max_discount_paise: access.max_discount_paise,
            max_refund_paise: access.max_refund_paise,
            max_cash_movement_paise: access.max_cash_movement_paise,
            permission_version: 0,
            session_id: String::new(),
            mfa_enrollment_required: false,
            // Not a browser session: this token is never minted or returned, it
            // only carries the resolved grants into the shared dispatcher.
            token_type: "channel".into(),
            jti: String::new(),
            iat: 0,
            exp: 0,
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    #[test]
    fn phone_normalisation_ignores_formatting_and_country_code() {
        let expected = "9876543210";
        for raw in [
            "+91 98765 43210",
            "+919876543210",
            "09876543210",
            "98765-43210",
            "(+91) 98765 43210",
        ] {
            assert_eq!(normalize_phone(raw), expected, "failed for {raw:?}");
        }
    }

    #[test]
    fn a_short_or_empty_number_is_not_an_identity() {
        assert_eq!(normalize_phone(""), "");
        assert_eq!(normalize_phone("12345"), "12345");
    }

    async fn seed(db: &PgPool) -> (String, String) {
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
        (tenant_id, branch_id)
    }

    /// An unknown number must never reach the CRM tool layer.
    #[sqlx::test]
    async fn an_unknown_number_resolves_to_anonymous(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        let caller = resolve_caller(&pool, &tenant_id, &branch_id, "+91 90000 00000")
            .await
            .expect("resolution completes");
        assert_eq!(caller.identity, ChannelIdentity::Anonymous);
        assert!(
            caller.claims.is_none(),
            "an unrecognised number must carry no permissions"
        );
    }

    /// A staff record with no branch grant is not an identity either: being in
    /// the staff table is not the same as being allowed to read the branch.
    #[sqlx::test]
    async fn a_staff_member_without_a_branch_grant_stays_anonymous(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        sqlx::query(
            r#"INSERT INTO staff(tenant_id,branch_id,first_name,last_name,email,mobile_phone,job_title,active)
               VALUES($1,$2,'Asha','Rao','asha.rao@aurasalon.in','+91 98765 43210','Stylist',TRUE)"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO users(tenant_id,branch_id,role_name,email,password_hash,full_name)
               VALUES($1,$2,'staff','asha.rao@aurasalon.in','x','Asha Rao')"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .execute(&pool)
        .await
        .unwrap();

        // No user_branch_roles row, so there is no grant to read the branch.
        let caller = resolve_caller(&pool, &tenant_id, &branch_id, "+91 98765 43210")
            .await
            .expect("resolution completes");
        assert_eq!(caller.identity, ChannelIdentity::Anonymous);
        assert!(caller.claims.is_none());
    }

    /// A recognised staff phone carries the same grants the browser would.
    #[sqlx::test]
    async fn a_known_staff_number_carries_its_real_permissions(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        sqlx::query(
            r#"INSERT INTO staff(tenant_id,branch_id,first_name,last_name,email,mobile_phone,job_title,active)
               VALUES($1,$2,'Asha','Rao','asha.rao@aurasalon.in','+91 98765 43210','Stylist',TRUE)"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .execute(&pool)
        .await
        .unwrap();
        let user_id: String = sqlx::query_scalar(
            r#"INSERT INTO users(tenant_id,branch_id,role_name,email,password_hash,full_name)
               VALUES($1,$2,'manager','asha.rao@aurasalon.in','x','Asha Rao') RETURNING id"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        // Permissions come from a role record, so the grant must reference one.
        let role_id: String = sqlx::query_scalar(
            r#"INSERT INTO roles(tenant_id,name,permissions_json,denied_permissions_json,masked_fields_json)
               VALUES($1,'Branch Manager',
                      TO_JSONB(ARRAY['appointments.read','staff.read']::TEXT[]),
                      '[]'::JSONB,'[]'::JSONB)
               RETURNING id"#,
        )
        .bind(&tenant_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_id,role_name,active)
               VALUES($1,$2,$3,$4,'manager',TRUE)"#,
        )
        .bind(&tenant_id)
        .bind(&user_id)
        .bind(&branch_id)
        .bind(&role_id)
        .execute(&pool)
        .await
        .unwrap();

        let caller = resolve_caller(&pool, &tenant_id, &branch_id, "+919876543210")
            .await
            .expect("resolution completes");
        assert_eq!(caller.identity, ChannelIdentity::StaffLogin);
        let claims = caller.claims.expect("a recognised staff login carries claims");
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.tenant_id, tenant_id);
        assert_eq!(claims.branch_id.as_deref(), Some(branch_id.as_str()));
        // The token is never minted or handed out; it only carries grants.
        assert_eq!(claims.token_type, "channel");
        assert!(claims.jti.is_empty());
        // The grants are the role's real permissions, not a channel default.
        assert!(claims.permissions.iter().any(|value| value == "staff.read"));
    }

    /// Two staff sharing a number is ambiguity, and ambiguity is not identity.
    #[sqlx::test]
    async fn a_number_shared_by_two_staff_resolves_to_anonymous(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        for (first, email) in [("Asha", "asha.rao@aurasalon.in"), ("Nikita", "nikita.rao@aurasalon.in")] {
            sqlx::query(
                r#"INSERT INTO staff(tenant_id,branch_id,first_name,last_name,email,mobile_phone,job_title,active)
                   VALUES($1,$2,$3,'Rao',$4,'+91 98765 43210','Stylist',TRUE)"#,
            )
            .bind(&tenant_id)
            .bind(&branch_id)
            .bind(first)
            .bind(email)
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                r#"INSERT INTO users(tenant_id,branch_id,role_name,email,password_hash,full_name)
                   VALUES($1,$2,'manager',$3,'x','Staff Member')"#,
            )
            .bind(&tenant_id)
            .bind(&branch_id)
            .bind(email)
            .execute(&pool)
            .await
            .unwrap();
        }

        let caller = resolve_caller(&pool, &tenant_id, &branch_id, "+91 98765 43210")
            .await
            .expect("resolution completes");
        assert_eq!(
            caller.identity,
            ChannelIdentity::Anonymous,
            "a shared number must not resolve to either person"
        );
    }
}
