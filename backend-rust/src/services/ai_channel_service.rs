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

/// Reduces an Indian mobile number to its ten national digits, or rejects it.
///
/// Numbers arrive formatted differently on every channel and every handset, so
/// punctuation is discarded. What is *not* discarded is the country code:
/// taking the last ten digits of any string would let `+1 415 987 6543210`
/// impersonate the Indian subscriber `9876543210`. Only the shapes this CRM
/// actually issues numbers in are accepted:
///
/// * `9876543210` — ten national digits, leading digit 6-9
/// * `09876543210` — the same with the trunk prefix
/// * `919876543210` — the same with the country code
/// * `+919876543210` / `00919876543210` — the same, stated internationally
///
/// Anything else — another country code, a landline, a wrong length — returns
/// `None` and is treated as unidentifiable rather than guessed at.
fn normalize_phone(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let digits: String = trimmed.chars().filter(char::is_ascii_digit).collect();

    // A `+` or a `00` prefix *names* the country, so it has to name India.
    // Without one, a bare ten-digit number is read as national — which is what
    // every Indian handset sends.
    let (stated_internationally, digits) = match digits.strip_prefix("00") {
        Some(rest) => (true, rest.to_string()),
        None => (trimmed.starts_with('+'), digits),
    };

    let national = if stated_internationally {
        digits
            .strip_prefix("91")
            .filter(|national| national.len() == 10)?
    } else {
        match digits.len() {
            10 => digits.as_str(),
            11 if digits.starts_with('0') => &digits[1..],
            12 if digits.starts_with("91") => &digits[2..],
            _ => return None,
        }
    };

    // Indian mobile numbers begin 6-9. A number outside that range is a
    // landline, a service code, or a foreign number that happens to be ten
    // digits long — none of which identify a staff handset.
    if !matches!(national.as_bytes()[0], b'6'..=b'9') {
        return None;
    }
    Some(national.to_string())
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
    let Some(phone) = normalize_phone(from_phone) else {
        return Ok(ResolvedChannelCaller::anonymous());
    };

    // One active staff member, one login, one branch. Anything less specific is
    // not an identity.
    //
    // The staff record is joined to its login through `staff.user_id`, the
    // explicit link the CRM maintains. Matching on email would authenticate a
    // channel caller through a field any staff editor can change, so an email
    // edit would silently become an identity change.
    //
    // The stored number is validated to the same Indian shapes the inbound one
    // is, so a staff record holding a foreign number cannot be matched by its
    // trailing ten digits.
    let matched: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT account.id, account.tenant_id
             FROM staff member
             JOIN users account
               ON account.id=member.user_id
              AND account.tenant_id=member.tenant_id
              AND account.active=TRUE
             CROSS JOIN LATERAL (
               SELECT REGEXP_REPLACE(COALESCE(member.mobile_phone,''),'[^0-9]','','g') AS d
             ) stored
            WHERE member.tenant_id=$1
              AND member.branch_id=$2
              AND member.active=TRUE
              AND member.user_id IS NOT NULL
              AND member.user_id<>''
              AND (
                    (LENGTH(stored.d)=10 AND stored.d=$3)
                 OR (LENGTH(stored.d)=11 AND LEFT(stored.d,1)='0'  AND RIGHT(stored.d,10)=$3)
                 OR (LENGTH(stored.d)=12 AND LEFT(stored.d,2)='91' AND RIGHT(stored.d,10)=$3)
                 OR (LENGTH(stored.d)=14 AND LEFT(stored.d,4)='0091' AND RIGHT(stored.d,10)=$3)
              )
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
    use crate::services::ai_scope_service::{self, AiDomain};
    use sqlx::PgPool;

    #[test]
    fn every_indian_form_of_one_number_normalises_to_the_same_ten_digits() {
        let expected = Some("9876543210".to_string());
        for raw in [
            "9876543210",
            "98765-43210",
            "09876543210",
            "919876543210",
            "+91 98765 43210",
            "(+91) 98765 43210",
            "0091 98765 43210",
        ] {
            assert_eq!(normalize_phone(raw), expected, "failed for {raw:?}");
        }
    }

    /// The point of the strict form: a foreign number must not be reduced to an
    /// Indian one by dropping whatever does not fit into ten digits.
    #[test]
    fn a_number_that_is_not_indian_is_rejected_rather_than_truncated() {
        for raw in [
            // US number whose last ten digits are a valid Indian mobile.
            "+1 987 654 3210",
            // UK, Singapore, UAE.
            "+44 7911 123456",
            "+65 8123 4567",
            "+971 50 123 4567",
            // Right length, wrong leading digit: not a mobile.
            "2226543210",
            "0226543210",
            // Wrong lengths.
            "",
            "12345",
            "98765432101234",
        ] {
            assert_eq!(normalize_phone(raw), None, "should reject {raw:?}");
        }
    }

    async fn seed(db: &PgPool) -> (String, String) {
        let tenant_id: String = sqlx::query_scalar(
            "INSERT INTO tenants(name,scope_id) VALUES('Aura Salon Group','') RETURNING scope_id",
        )
        .fetch_one(db)
        .await
        .unwrap();
        let branch_id = seed_branch(db, &tenant_id, "Banjara Hills").await;
        (tenant_id, branch_id)
    }

    async fn seed_branch(db: &PgPool, tenant_id: &str, name: &str) -> String {
        sqlx::query_scalar(
            r#"INSERT INTO branches(tenant_id,name,scope_id,region_name,zone_name,cluster_name,active)
               VALUES((SELECT id FROM tenants WHERE scope_id=$1),$2,'','South','Hyderabad','Central',TRUE)
               RETURNING scope_id"#,
        )
        .bind(tenant_id)
        .bind(name)
        .fetch_one(db)
        .await
        .unwrap()
    }

    /// A login and the staff record that points at it, linked the way the CRM
    /// links them: `staff.user_id -> users.id`.
    async fn seed_staff_with_login(
        db: &PgPool,
        tenant_id: &str,
        branch_id: &str,
        first_name: &str,
        phone: &str,
        staff_active: bool,
        user_active: bool,
    ) -> String {
        let user_id: String = sqlx::query_scalar(
            r#"INSERT INTO users(tenant_id,branch_id,role_name,email,password_hash,full_name,active)
               VALUES($1,$2,'manager',$3,'x',$4,$5) RETURNING id"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(format!("{}@aurasalon.in", first_name.to_ascii_lowercase()))
        .bind(first_name)
        .bind(user_active)
        .fetch_one(db)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO staff(tenant_id,branch_id,user_id,first_name,last_name,email,mobile_phone,job_title,active)
               VALUES($1,$2,$3,$4,'Rao',$5,$6,'Stylist',$7)"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&user_id)
        .bind(first_name)
        .bind(format!("{}@aurasalon.in", first_name.to_ascii_lowercase()))
        .bind(phone)
        .bind(staff_active)
        .execute(db)
        .await
        .unwrap();
        user_id
    }

    async fn seed_role(db: &PgPool, tenant_id: &str, granted: &[&str], denied: &[&str]) -> String {
        sqlx::query_scalar(
            r#"INSERT INTO roles(tenant_id,name,permissions_json,denied_permissions_json,masked_fields_json)
               VALUES($1,'Branch Manager',TO_JSONB($2::TEXT[]),TO_JSONB($3::TEXT[]),'[]'::JSONB)
               RETURNING id"#,
        )
        .bind(tenant_id)
        .bind(granted)
        .bind(denied)
        .fetch_one(db)
        .await
        .unwrap()
    }

    /// A permanent grant, the ordinary case.
    async fn grant(db: &PgPool, tenant_id: &str, user_id: &str, branch_id: &str, role_id: &str) {
        sqlx::query(
            r#"INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_id,role_name,active,access_type)
               VALUES($1,$2,$3,$4,'manager',TRUE,'permanent')"#,
        )
        .bind(tenant_id)
        .bind(user_id)
        .bind(branch_id)
        .bind(role_id)
        .execute(db)
        .await
        .unwrap();
    }

    /// A deputation grant with an explicit validity window, in days relative to
    /// today. A lapsed window is how a temporary posting ends.
    async fn grant_deputation(
        db: &PgPool,
        tenant_id: &str,
        user_id: &str,
        branch_id: &str,
        role_id: &str,
        from_days: i32,
        until_days: i32,
    ) {
        sqlx::query(
            r#"INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_id,role_name,active,access_type,valid_from,valid_until)
               VALUES($1,$2,$3,$4,'manager',TRUE,'deputation',
                      ((NOW() AT TIME ZONE 'Asia/Kolkata')::DATE + ($5 || ' days')::INTERVAL)::DATE,
                      ((NOW() AT TIME ZONE 'Asia/Kolkata')::DATE + ($6 || ' days')::INTERVAL)::DATE)"#,
        )
        .bind(tenant_id)
        .bind(user_id)
        .bind(branch_id)
        .bind(role_id)
        .bind(from_days.to_string())
        .bind(until_days.to_string())
        .execute(db)
        .await
        .unwrap();
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
        seed_staff_with_login(
            &pool, &tenant_id, &branch_id, "Asha", "+91 98765 43210", true, true,
        )
        .await;

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
        let user_id = seed_staff_with_login(
            &pool, &tenant_id, &branch_id, "Asha", "+91 98765 43210", true, true,
        )
        .await;
        let role_id = seed_role(&pool, &tenant_id, &["appointments.read", "staff.read"], &[]).await;
        grant(&pool, &tenant_id, &user_id, &branch_id, &role_id).await;

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
        let role_id = seed_role(&pool, &tenant_id, &["staff.read"], &[]).await;
        for name in ["Asha", "Nikita"] {
            let user_id = seed_staff_with_login(
                &pool, &tenant_id, &branch_id, name, "+91 98765 43210", true, true,
            )
            .await;
            grant(&pool, &tenant_id, &user_id, &branch_id, &role_id).await;
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

    /// A staff member who has left keeps their handset. Deactivating the staff
    /// record has to end their access on WhatsApp too, not only in the browser.
    #[sqlx::test]
    async fn an_inactive_staff_record_stops_answering(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        let user_id = seed_staff_with_login(
            &pool, &tenant_id, &branch_id, "Asha", "+91 98765 43210", false, true,
        )
        .await;
        let role_id = seed_role(&pool, &tenant_id, &["staff.read"], &[]).await;
        grant(&pool, &tenant_id, &user_id, &branch_id, &role_id).await;

        let caller = resolve_caller(&pool, &tenant_id, &branch_id, "+91 98765 43210")
            .await
            .expect("resolution completes");
        assert_eq!(caller.identity, ChannelIdentity::Anonymous);
        assert!(caller.claims.is_none());
    }

    /// Disabling the login is the other half of the same door. A staff record
    /// that is still active but whose login is disabled must not resolve.
    #[sqlx::test]
    async fn a_disabled_login_stops_answering(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        let user_id = seed_staff_with_login(
            &pool, &tenant_id, &branch_id, "Asha", "+91 98765 43210", true, false,
        )
        .await;
        let role_id = seed_role(&pool, &tenant_id, &["staff.read"], &[]).await;
        grant(&pool, &tenant_id, &user_id, &branch_id, &role_id).await;

        let caller = resolve_caller(&pool, &tenant_id, &branch_id, "+91 98765 43210")
            .await
            .expect("resolution completes");
        assert_eq!(caller.identity, ChannelIdentity::Anonymous);
        assert!(caller.claims.is_none());
    }

    /// A live deputation is a real posting: it answers for the branch it covers.
    #[sqlx::test]
    async fn a_live_deputation_answers_for_the_covered_branch(pool: PgPool) {
        let (tenant_id, home_branch) = seed(&pool).await;
        let covered_branch = seed_branch(&pool, &tenant_id, "Jubilee Hills").await;
        let user_id = seed_staff_with_login(
            &pool, &tenant_id, &home_branch, "Asha", "+91 98765 43210", true, true,
        )
        .await;
        // The same person also holds a staff record at the covered branch.
        sqlx::query(
            r#"INSERT INTO staff(tenant_id,branch_id,user_id,first_name,last_name,email,mobile_phone,job_title,active)
               VALUES($1,$2,$3,'Asha','Rao','asha.deputed@aurasalon.in','+91 98765 43210','Stylist',TRUE)"#,
        )
        .bind(&tenant_id)
        .bind(&covered_branch)
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();
        let role_id = seed_role(&pool, &tenant_id, &["staff.read"], &[]).await;
        grant_deputation(
            &pool, &tenant_id, &user_id, &covered_branch, &role_id, -3, 10,
        )
        .await;

        let caller = resolve_caller(&pool, &tenant_id, &covered_branch, "+91 98765 43210")
            .await
            .expect("resolution completes");
        assert_eq!(caller.identity, ChannelIdentity::StaffLogin);
        let claims = caller.claims.expect("a live deputation carries claims");
        assert_eq!(claims.branch_id.as_deref(), Some(covered_branch.as_str()));
    }

    /// The day the deputation ends, the access ends. A window that has closed
    /// is not a grant, and the channel must not keep honouring it.
    #[sqlx::test]
    async fn a_lapsed_deputation_no_longer_answers(pool: PgPool) {
        let (tenant_id, home_branch) = seed(&pool).await;
        let covered_branch = seed_branch(&pool, &tenant_id, "Jubilee Hills").await;
        let user_id = seed_staff_with_login(
            &pool, &tenant_id, &home_branch, "Asha", "+91 98765 43210", true, true,
        )
        .await;
        sqlx::query(
            r#"INSERT INTO staff(tenant_id,branch_id,user_id,first_name,last_name,email,mobile_phone,job_title,active)
               VALUES($1,$2,$3,'Asha','Rao','asha.deputed@aurasalon.in','+91 98765 43210','Stylist',TRUE)"#,
        )
        .bind(&tenant_id)
        .bind(&covered_branch)
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();
        let role_id = seed_role(&pool, &tenant_id, &["staff.read"], &[]).await;
        // Ended yesterday.
        grant_deputation(
            &pool, &tenant_id, &user_id, &covered_branch, &role_id, -30, -1,
        )
        .await;

        let caller = resolve_caller(&pool, &tenant_id, &covered_branch, "+91 98765 43210")
            .await
            .expect("resolution completes");
        assert_eq!(
            caller.identity,
            ChannelIdentity::Anonymous,
            "a deputation that has ended must not still answer"
        );
    }

    /// An explicit denial beats the role's own grant, on this channel as
    /// everywhere else. The denial is carried into the claims and the domain
    /// gate reads it.
    #[sqlx::test]
    async fn an_explicit_denial_overrides_the_role_grant(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        let user_id = seed_staff_with_login(
            &pool, &tenant_id, &branch_id, "Asha", "+91 98765 43210", true, true,
        )
        .await;
        // The role grants finance and is then explicitly denied it.
        let role_id = seed_role(
            &pool,
            &tenant_id,
            &["staff.read", "finance.read"],
            &["finance.read"],
        )
        .await;
        grant(&pool, &tenant_id, &user_id, &branch_id, &role_id).await;

        let caller = resolve_caller(&pool, &tenant_id, &branch_id, "+91 98765 43210")
            .await
            .expect("resolution completes");
        let claims = caller.claims.expect("the staff login resolves");
        assert!(
            claims
                .denied_permissions
                .iter()
                .any(|value| value == "finance.read"),
            "the denial must survive into the channel claims"
        );
        assert!(
            !ai_scope_service::domain_allowed(&claims, AiDomain::Finance),
            "a denied domain must stay closed even though the role grants it"
        );
        assert!(
            ai_scope_service::domain_allowed(&claims, AiDomain::Staff),
            "the undenied domain is unaffected"
        );
    }

    /// A staff member of one branch messaging about another branch is not that
    /// branch's staff. Resolution is per branch, so the wrong branch resolves
    /// to nobody rather than to them.
    #[sqlx::test]
    async fn a_staff_number_does_not_resolve_at_another_branch(pool: PgPool) {
        let (tenant_id, home_branch) = seed(&pool).await;
        let other_branch = seed_branch(&pool, &tenant_id, "Gachibowli").await;
        let user_id = seed_staff_with_login(
            &pool, &tenant_id, &home_branch, "Asha", "+91 98765 43210", true, true,
        )
        .await;
        let role_id = seed_role(&pool, &tenant_id, &["staff.read"], &[]).await;
        grant(&pool, &tenant_id, &user_id, &home_branch, &role_id).await;

        let home = resolve_caller(&pool, &tenant_id, &home_branch, "+91 98765 43210")
            .await
            .expect("resolution completes");
        assert_eq!(home.identity, ChannelIdentity::StaffLogin);

        let elsewhere = resolve_caller(&pool, &tenant_id, &other_branch, "+91 98765 43210")
            .await
            .expect("resolution completes");
        assert_eq!(
            elsewhere.identity,
            ChannelIdentity::Anonymous,
            "a branch the sender has no staff record at must not resolve them"
        );
    }

    /// Permissions are read per message, never cached on the conversation. A
    /// revocation therefore lands on the very next message rather than at the
    /// end of some session.
    #[sqlx::test]
    async fn a_revoked_permission_applies_to_the_next_message(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        let user_id = seed_staff_with_login(
            &pool, &tenant_id, &branch_id, "Asha", "+91 98765 43210", true, true,
        )
        .await;
        let role_id = seed_role(&pool, &tenant_id, &["staff.read", "finance.read"], &[]).await;
        grant(&pool, &tenant_id, &user_id, &branch_id, &role_id).await;

        let before = resolve_caller(&pool, &tenant_id, &branch_id, "+91 98765 43210")
            .await
            .expect("resolution completes")
            .claims
            .expect("the staff login resolves");
        assert!(ai_scope_service::domain_allowed(&before, AiDomain::Finance));

        // The administrator revokes finance between the two messages.
        sqlx::query("UPDATE roles SET permissions_json=TO_JSONB(ARRAY['staff.read']::TEXT[]) WHERE id=$1")
            .bind(&role_id)
            .execute(&pool)
            .await
            .unwrap();

        let after = resolve_caller(&pool, &tenant_id, &branch_id, "+91 98765 43210")
            .await
            .expect("resolution completes")
            .claims
            .expect("the staff login still resolves");
        assert!(
            !after.permissions.iter().any(|value| value == "finance.read"),
            "the revoked permission must be gone from the very next message"
        );
        assert!(!ai_scope_service::domain_allowed(&after, AiDomain::Finance));
        assert!(ai_scope_service::domain_allowed(&after, AiDomain::Staff));
    }

    /// The collision the strict normaliser exists to prevent: a foreign number
    /// whose last ten digits match a staff member's Indian number.
    #[sqlx::test]
    async fn an_international_number_cannot_impersonate_a_staff_number(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        let user_id = seed_staff_with_login(
            &pool, &tenant_id, &branch_id, "Asha", "+91 98765 43210", true, true,
        )
        .await;
        let role_id = seed_role(&pool, &tenant_id, &["staff.read"], &[]).await;
        grant(&pool, &tenant_id, &user_id, &branch_id, &role_id).await;

        // Same trailing ten digits, different country.
        let caller = resolve_caller(&pool, &tenant_id, &branch_id, "+1 987 654 3210")
            .await
            .expect("resolution completes");
        assert_eq!(
            caller.identity,
            ChannelIdentity::Anonymous,
            "a foreign number must not be truncated into an Indian identity"
        );

        // And the reverse: a staff record holding a foreign number is not
        // reachable by the Indian number that shares its last ten digits.
        let (other_tenant, other_branch) = seed(&pool).await;
        let foreign_user = seed_staff_with_login(
            &pool,
            &other_tenant,
            &other_branch,
            "Ravi",
            "+1 987 654 3210",
            true,
            true,
        )
        .await;
        let other_role = seed_role(&pool, &other_tenant, &["staff.read"], &[]).await;
        grant(
            &pool,
            &other_tenant,
            &foreign_user,
            &other_branch,
            &other_role,
        )
        .await;
        let reverse = resolve_caller(&pool, &other_tenant, &other_branch, "+91 98765 43210")
            .await
            .expect("resolution completes");
        assert_eq!(reverse.identity, ChannelIdentity::Anonymous);
    }

    /// The case WhatsApp routing previously could not express at all: a staff
    /// member who is not a client of the branch. They have no `clients` row, so
    /// the old sender-anchored routing had no tenant for them — yet they are
    /// exactly who the copilot exists for.
    #[sqlx::test]
    async fn a_staff_sender_who_is_not_a_client_still_resolves(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        let user_id = seed_staff_with_login(
            &pool, &tenant_id, &branch_id, "Asha", "+91 98765 43210", true, true,
        )
        .await;
        let role_id = seed_role(&pool, &tenant_id, &["staff.read"], &[]).await;
        grant(&pool, &tenant_id, &user_id, &branch_id, &role_id).await;

        let clients: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM clients WHERE REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g') LIKE '%9876543210'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(clients, 0, "the fixture must have no client on this number");

        let caller = resolve_caller(&pool, &tenant_id, &branch_id, "+91 98765 43210")
            .await
            .expect("resolution completes");
        assert_eq!(
            caller.identity,
            ChannelIdentity::StaffLogin,
            "staff identity must not depend on also being a client"
        );
        assert_eq!(caller.claims.expect("claims").sub, user_id);
    }

    /// Email is editable, so it must not be what authenticates a channel
    /// caller. A staff row whose email matches a login it is not linked to
    /// resolves to nobody.
    #[sqlx::test]
    async fn a_matching_email_without_the_user_link_is_not_an_identity(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        let user_id: String = sqlx::query_scalar(
            r#"INSERT INTO users(tenant_id,branch_id,role_name,email,password_hash,full_name,active)
               VALUES($1,$2,'manager','asha@aurasalon.in','x','Asha',TRUE) RETURNING id"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        // Same email, but no user_id link.
        sqlx::query(
            r#"INSERT INTO staff(tenant_id,branch_id,first_name,last_name,email,mobile_phone,job_title,active)
               VALUES($1,$2,'Asha','Rao','asha@aurasalon.in','+91 98765 43210','Stylist',TRUE)"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .execute(&pool)
        .await
        .unwrap();
        let role_id = seed_role(&pool, &tenant_id, &["staff.read"], &[]).await;
        grant(&pool, &tenant_id, &user_id, &branch_id, &role_id).await;

        let caller = resolve_caller(&pool, &tenant_id, &branch_id, "+91 98765 43210")
            .await
            .expect("resolution completes");
        assert_eq!(
            caller.identity,
            ChannelIdentity::Anonymous,
            "a shared email is not the link between a staff record and a login"
        );
    }
}
