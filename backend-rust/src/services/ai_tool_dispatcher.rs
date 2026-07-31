//! The single authorized entry point for running an AI copilot tool.
//!
//! Every AI surface — the header concierge, `/ai/copilot/ask` and the proactive
//! briefing — comes through here. The order is fixed and not negotiable per
//! caller: resolve the login's identity and tenant, resolve the branches the
//! grants actually allow, check the domain permission, and only then query.
//!
//! Nothing downstream re-decides access. `ai_copilot_tools::run` receives a
//! branch set that is already known-good, which is what keeps a second, weaker
//! access rule from growing next to this one.

use sqlx::PgPool;

use crate::{
    models::common::AppError,
    services::{
        ai_copilot_tools::{
            CopilotAnswer, CopilotTool, ToolActor, ToolMatch, ToolRefusal, ToolScope,
        },
        ai_scope_service::{self, AiDomain, ResolvedScope, ScopeRequest},
        auth_service::AuthClaims,
    },
};

/// The CRM domain a tool reads, and therefore the permission it needs.
///
/// Every tool must appear here: a tool with no domain has no permission to
/// check, so the match is exhaustive by design rather than defaulting to
/// something permissive.
pub fn tool_domain(tool: CopilotTool) -> AiDomain {
    match tool {
        CopilotTool::StaffPerformanceDecline => AiDomain::Staff,
        CopilotTool::ServiceDecline | CopilotTool::ServiceOffer => AiDomain::Services,
        CopilotTool::LapsedClients
        | CopilotTool::RegularClients
        | CopilotTool::ClientReturnForecast
        | CopilotTool::ClientFavouriteService => AiDomain::Clients,
        CopilotTool::ClientOffer => AiDomain::Marketing,
        CopilotTool::MembershipStatus | CopilotTool::MembershipRenewals => AiDomain::Memberships,
        CopilotTool::ProfitIntelligence => AiDomain::Finance,
        CopilotTool::OfferPerformance => AiDomain::Marketing,
        CopilotTool::InventoryRisk => AiDomain::Inventory,
        // Cross-module tools are gated on the strongest domain they read, so a
        // login that may not see money cannot reach one through a side door.
        CopilotTool::ServiceRevenueImpact | CopilotTool::BranchMarginOutlier => AiDomain::Finance,
        CopilotTool::ClientLapseRisk => AiDomain::Clients,
        CopilotTool::StaffDeclineCause => AiDomain::Staff,
        // A branch snapshot and the composite read across domains; each part
        // inside them is gated separately, so the entry check is the read
        // permission every signed-in CRM user needs.
        CopilotTool::BusinessOverview | CopilotTool::BusinessDiagnostic => AiDomain::GeoComparison,
        // Workflow help reads no CRM data at all.
        CopilotTool::BillingHowTo => AiDomain::Appointments,
    }
}

/// Resolve scope, enforce permissions, then run the tool.
///
/// Returns `Forbidden` when the login may not read the tool's domain, so the
/// caller can tell the user which capability is missing rather than returning
/// an empty answer that looks like "no data".
pub async fn dispatch(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    actor: &ToolActor,
    matched: &ToolMatch,
    scope_request: &ScopeRequest,
) -> Result<CopilotAnswer, ToolRefusal> {
    let scope = resolve(db, tenant_id, claims, scope_request)
        .await
        .map_err(|_| ToolRefusal::NoMatch)?;

    // Floor staff may ask about their own performance; the tool narrows to
    // their own record, so the domain gate below is the only access decision.
    let self_scoped_staff =
        matched.tool == CopilotTool::StaffPerformanceDecline && actor.restricted_to_self();
    let domain = tool_domain(matched.tool);
    if !self_scoped_staff && !ai_scope_service::domain_allowed(claims, domain) {
        return Err(ToolRefusal::Forbidden(matched.tool));
    }

    let tool_scope = tool_scope(&scope, claims);
    if tool_scope.branch_ids.is_empty() {
        return Err(ToolRefusal::Forbidden(matched.tool));
    }

    // The answer carries its own scope disclosure, stamped centrally in `run`.
    crate::services::ai_copilot_tools::run(db, tenant_id, &tool_scope, actor, matched).await
}

/// Resolve the login's scope for an AI request.
pub async fn resolve(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    scope_request: &ScopeRequest,
) -> Result<ResolvedScope, AppError> {
    let language = ai_scope_service::detect_language("", None);
    ai_scope_service::resolve_scope(db, tenant_id, claims, scope_request, language.language).await
}

/// Turn an authorized scope into the branch set a tool may query.
///
/// Financial visibility is decided here from `finance.read` rather than from
/// the role name, so an explicit denial removes money lines from every tool at
/// once — including for owner-like roles that would otherwise pass a role check.
pub fn tool_scope(scope: &ResolvedScope, claims: &AuthClaims) -> ToolScope {
    ToolScope {
        branch_ids: scope.branch_ids(),
        primary_branch_id: scope.primary_branch_id().unwrap_or_default().to_string(),
        label: scope.label.clone(),
        financials_visible: ai_scope_service::domain_allowed(claims, AiDomain::Finance),
        disclosure: scope.disclosure(),
    }
}

/// Claim builders shared with other modules' tests, so a permission expectation
/// is written the same way wherever it is asserted.
#[cfg(test)]
pub mod tests_support {
    use super::AuthClaims;

    pub fn claims(role: &str, permissions: &[&str], denied: &[&str]) -> AuthClaims {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::tests_support::claims as claims_with;

    const ALL_TOOLS: &[CopilotTool] = &[
        CopilotTool::BusinessDiagnostic,
        CopilotTool::BusinessOverview,
        CopilotTool::StaffPerformanceDecline,
        CopilotTool::BillingHowTo,
        CopilotTool::MembershipStatus,
        CopilotTool::ServiceDecline,
        CopilotTool::ServiceOffer,
        CopilotTool::LapsedClients,
        CopilotTool::ClientReturnForecast,
        CopilotTool::ClientFavouriteService,
        CopilotTool::ClientOffer,
        CopilotTool::ProfitIntelligence,
        CopilotTool::OfferPerformance,
        CopilotTool::InventoryRisk,
        CopilotTool::RegularClients,
        CopilotTool::MembershipRenewals,
        CopilotTool::ServiceRevenueImpact,
        CopilotTool::ClientLapseRisk,
        CopilotTool::StaffDeclineCause,
        CopilotTool::BranchMarginOutlier,
    ];

    #[test]
    fn every_tool_maps_to_a_permission_domain() {
        for tool in ALL_TOOLS {
            // Panics here would mean a tool can run without a permission check.
            let domain = tool_domain(*tool);
            assert!(
                !domain.required_permission().is_empty(),
                "tool {} resolved to a domain with no permission",
                tool.name()
            );
        }
    }

    #[test]
    fn denied_finance_permission_overrides_an_owner_role() {
        let owner = claims_with("owner", &[], &[]);
        assert!(ai_scope_service::domain_allowed(
            &owner,
            tool_domain(CopilotTool::ProfitIntelligence)
        ));

        // Same role, one explicit denial: the money tool is now out of reach.
        let denied_owner = claims_with("owner", &[], &["finance.read"]);
        assert!(!ai_scope_service::domain_allowed(
            &denied_owner,
            tool_domain(CopilotTool::ProfitIntelligence)
        ));
    }

    #[test]
    fn denied_finance_permission_hides_money_lines_for_an_owner() {
        let denied_owner = claims_with("owner", &[], &["finance.read"]);
        assert!(!ai_scope_service::domain_allowed(
            &denied_owner,
            AiDomain::Finance
        ));
    }

    #[test]
    fn inventory_manager_reaches_stock_but_not_margin() {
        let claims = claims_with("inventory manager", &[], &[]);
        assert!(ai_scope_service::domain_allowed(
            &claims,
            tool_domain(CopilotTool::InventoryRisk)
        ));
        assert!(!ai_scope_service::domain_allowed(
            &claims,
            tool_domain(CopilotTool::ProfitIntelligence)
        ));
    }

    #[test]
    fn receptionist_reaches_client_workflow_but_not_profit() {
        let claims = claims_with("receptionist", &[], &[]);
        assert!(ai_scope_service::domain_allowed(
            &claims,
            tool_domain(CopilotTool::MembershipRenewals)
        ));
        assert!(!ai_scope_service::domain_allowed(
            &claims,
            tool_domain(CopilotTool::ProfitIntelligence)
        ));
    }
}

#[cfg(test)]
mod scope_enforcement_tests {
    use super::tests_support::claims;
    use super::*;
    use crate::services::ai_copilot_tools::{CopilotTool, ToolActor, ToolMatch};
    use sqlx::PgPool;

    struct Fixture {
        tenant_id: String,
        granted_branch_id: String,
        other_branch_id: String,
        granted_branch_name: String,
        user_id: String,
    }

    /// Two branches with activity in both, and a user granted only the first.
    async fn seed(db: &PgPool) -> Fixture {
        let tenant_id: String = sqlx::query_scalar(
            "INSERT INTO tenants(name,scope_id) VALUES('Aura Salon Group','') RETURNING scope_id",
        )
        .fetch_one(db)
        .await
        .unwrap();

        let mut branches = Vec::new();
        for (name, region, zone, cluster) in [
            ("Banjara Hills", "South", "Hyderabad", "Central"),
            ("Andheri West", "West", "Mumbai", "North"),
        ] {
            let id: String = sqlx::query_scalar(
                r#"INSERT INTO branches(tenant_id,name,scope_id,region_name,zone_name,cluster_name,active)
                   VALUES((SELECT id FROM tenants WHERE scope_id=$1),$2,'',$3,$4,$5,TRUE)
                   RETURNING scope_id"#,
            )
            .bind(&tenant_id)
            .bind(name)
            .bind(region)
            .bind(zone)
            .bind(cluster)
            .fetch_one(db)
            .await
            .unwrap();
            branches.push((id, name.to_string()));
        }

        let user_id: String = sqlx::query_scalar(
            r#"INSERT INTO users(tenant_id,branch_id,role_name,email,password_hash,full_name)
               VALUES($1,$2,'manager','asha.rao@aurasalon.in','x','Asha Rao') RETURNING id"#,
        )
        .bind(&tenant_id)
        .bind(&branches[0].0)
        .fetch_one(db)
        .await
        .unwrap();

        sqlx::query(
            r#"INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_name,active)
               VALUES($1,$2,$3,'manager',TRUE)"#,
        )
        .bind(&tenant_id)
        .bind(&user_id)
        .bind(&branches[0].0)
        .execute(db)
        .await
        .unwrap();

        // Real activity in both branches, so a leak would be visible as data.
        for (branch_id, _) in &branches {
            let client_id: String = sqlx::query_scalar(
                r#"INSERT INTO clients(tenant_id,branch_id,first_name,last_name,active)
                   VALUES($1,$2,'Priya','Menon',TRUE) RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .fetch_one(db)
            .await
            .unwrap();
            let service_id: String = sqlx::query_scalar(
                r#"INSERT INTO services(tenant_id,branch_id,name,category,duration_minutes,price_paise,active)
                   VALUES($1,$2,'Hair Colour','Hair',60,250000,TRUE) RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .fetch_one(db)
            .await
            .unwrap();
            let sale_id: String = sqlx::query_scalar(
                r#"INSERT INTO pos_sales(tenant_id,branch_id,client_id,invoice_number,
                     subtotal_paise,total_paise,paid_paise,status,finalized_at)
                   VALUES($1,$2,$3,$4,250000,250000,250000,'paid',NOW()-INTERVAL '2 days')
                   RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(&client_id)
            .bind(format!("INV-{branch_id}"))
            .fetch_one(db)
            .await
            .unwrap();
            sqlx::query(
                r#"INSERT INTO pos_sale_lines(tenant_id,branch_id,sale_id,line_type,item_id,
                     item_name,quantity,unit_price_paise,line_total_paise)
                   VALUES($1,$2,$3,'service',$4,'Hair Colour',1,250000,250000)"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(&sale_id)
            .bind(&service_id)
            .execute(db)
            .await
            .unwrap();
        }

        Fixture {
            tenant_id,
            granted_branch_id: branches[0].0.clone(),
            other_branch_id: branches[1].0.clone(),
            granted_branch_name: branches[0].1.clone(),
            user_id,
        }
    }

    fn manager_claims(fixture: &Fixture) -> AuthClaims {
        let mut value = claims("manager", &[], &[]);
        value.sub = fixture.user_id.clone();
        value.tenant_id = fixture.tenant_id.clone();
        value.branch_id = Some(fixture.granted_branch_id.clone());
        value
    }

    #[sqlx::test]
    async fn a_branch_user_cannot_read_another_branch(pool: PgPool) {
        let fixture = seed(&pool).await;
        let scope = resolve(
            &pool,
            &fixture.tenant_id,
            &manager_claims(&fixture),
            &ScopeRequest::default(),
        )
        .await
        .expect("scope resolves");

        assert_eq!(scope.branch_ids(), vec![fixture.granted_branch_id.clone()]);
        assert!(scope.authorizes(&fixture.granted_branch_id));
        assert!(
            !scope.authorizes(&fixture.other_branch_id),
            "an ungranted branch must never appear in the scope"
        );
        // A branch id arriving from a request header is rejected, not trusted.
        assert!(scope.require_branch(&fixture.other_branch_id).is_err());

        // And the tool actually queries only the granted branch.
        let tool_scope = tool_scope(&scope, &manager_claims(&fixture));
        assert_eq!(tool_scope.branch_ids, vec![fixture.granted_branch_id]);
        assert!(!tool_scope.branch_ids.contains(&fixture.other_branch_id));
    }

    #[sqlx::test]
    async fn asking_for_the_whole_tenant_is_narrowed_and_disclosed(pool: PgPool) {
        let fixture = seed(&pool).await;
        let request = ScopeRequest {
            level: Some("tenant".into()),
            ..ScopeRequest::default()
        };
        let scope = resolve(
            &pool,
            &fixture.tenant_id,
            &manager_claims(&fixture),
            &request,
        )
        .await
        .expect("scope resolves");

        assert_eq!(scope.branch_ids().len(), 1);
        assert!(
            scope.narrowed,
            "a tenant-wide ask on a one-branch grant is narrowed"
        );
        let disclosure = scope.disclosure();
        assert!(disclosure.narrowed);
        assert!(
            !disclosure.notice.is_empty(),
            "narrowing must be stated back to the user"
        );
        assert_eq!(disclosure.branches_read, vec![fixture.granted_branch_name]);
    }

    #[sqlx::test]
    async fn a_lapsed_deputation_does_not_widen_access(pool: PgPool) {
        let fixture = seed(&pool).await;
        sqlx::query(
            r#"INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_name,active,
                 access_type,valid_from,valid_until)
               VALUES($1,$2,$3,'manager',TRUE,'deputation',CURRENT_DATE-40,CURRENT_DATE-10)"#,
        )
        .bind(&fixture.tenant_id)
        .bind(&fixture.user_id)
        .bind(&fixture.other_branch_id)
        .execute(&pool)
        .await
        .unwrap();

        let scope = resolve(
            &pool,
            &fixture.tenant_id,
            &manager_claims(&fixture),
            &ScopeRequest::default(),
        )
        .await
        .expect("scope resolves");

        assert_eq!(
            scope.branch_ids(),
            vec![fixture.granted_branch_id],
            "an expired deputation must not add a branch"
        );
        assert!(!scope.authorizes(&fixture.other_branch_id));
    }

    #[sqlx::test]
    async fn an_active_deputation_widens_access_for_its_window(pool: PgPool) {
        let fixture = seed(&pool).await;
        sqlx::query(
            r#"INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_name,active,
                 access_type,valid_from,valid_until)
               VALUES($1,$2,$3,'manager',TRUE,'deputation',CURRENT_DATE-5,CURRENT_DATE+5)"#,
        )
        .bind(&fixture.tenant_id)
        .bind(&fixture.user_id)
        .bind(&fixture.other_branch_id)
        .execute(&pool)
        .await
        .unwrap();

        let scope = resolve(
            &pool,
            &fixture.tenant_id,
            &manager_claims(&fixture),
            &ScopeRequest::default(),
        )
        .await
        .expect("scope resolves");
        assert_eq!(scope.branch_ids().len(), 2);
    }

    #[sqlx::test]
    async fn a_denied_finance_permission_overrides_an_owner_role(pool: PgPool) {
        let fixture = seed(&pool).await;
        let matched = ToolMatch {
            tool: CopilotTool::ProfitIntelligence,
            subject_candidates: Vec::new(),
        };

        // An owner with finance denied: the tool must refuse before querying.
        let mut denied = claims("owner", &[], &["finance.read"]);
        denied.sub = fixture.user_id.clone();
        denied.tenant_id = fixture.tenant_id.clone();
        denied.branch_id = Some(fixture.granted_branch_id.clone());

        let refusal = dispatch(
            &pool,
            &fixture.tenant_id,
            &denied,
            &ToolActor::new(&fixture.user_id, "owner"),
            &matched,
            &ScopeRequest::default(),
        )
        .await
        .expect_err("a denied finance permission must refuse an owner");
        assert!(matches!(
            refusal,
            ToolRefusal::Forbidden(CopilotTool::ProfitIntelligence)
        ));

        // Money lines are stripped for that same login everywhere else too.
        let scope = resolve(&pool, &fixture.tenant_id, &denied, &ScopeRequest::default())
            .await
            .expect("scope resolves");
        assert!(!tool_scope(&scope, &denied).financials_visible);

        // The identical role without the denial does reach the tool.
        let mut allowed = claims("owner", &[], &[]);
        allowed.sub = fixture.user_id.clone();
        allowed.tenant_id = fixture.tenant_id.clone();
        allowed.branch_id = Some(fixture.granted_branch_id.clone());
        assert!(
            tool_scope(
                &resolve(
                    &pool,
                    &fixture.tenant_id,
                    &allowed,
                    &ScopeRequest::default()
                )
                .await
                .expect("scope resolves"),
                &allowed
            )
            .financials_visible
        );
    }

    #[sqlx::test]
    async fn a_dispatched_answer_carries_its_scope_disclosure(pool: PgPool) {
        let fixture = seed(&pool).await;
        let claims = manager_claims(&fixture);
        let matched = ToolMatch {
            tool: CopilotTool::ServiceDecline,
            subject_candidates: Vec::new(),
        };
        let answer = dispatch(
            &pool,
            &fixture.tenant_id,
            &claims,
            &ToolActor::new(&fixture.user_id, "manager"),
            &matched,
            &ScopeRequest::default(),
        )
        .await
        .expect("a manager may read service trends");

        assert_eq!(answer.branch_id, fixture.granted_branch_id);
        assert_eq!(
            answer.scope.branches_read,
            vec![fixture.granted_branch_name]
        );
        assert_eq!(answer.scope.branch_count, 1);
    }
}
