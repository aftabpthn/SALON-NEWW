#[test]
fn subscription_features_are_enforced_on_protected_and_credential_routes() {
    let repository = include_str!("../src/repositories/saas_repository.rs");
    assert!(repository.contains("subscription.features_json"));

    let entitlement = include_str!("../src/services/entitlement_service.rs");
    assert!(entitlement.contains("past-due subscription is read-only"));
    assert!(entitlement.contains("subscription plan does not include this feature"));

    let tenant = include_str!("../src/middleware/tenant.rs");
    let auth = include_str!("../src/services/auth_service.rs");
    let routing = format!("{tenant}\n{auth}");
    for feature in [
        "staff.basic",
        "staff.payroll",
        "staff.biometric",
        "staff.ai",
        "staff.api",
    ] {
        assert!(
            routing.contains(feature),
            "missing route feature: {feature}"
        );
    }

    let integrations = include_str!("../src/services/integration_service.rs");
    assert!(integrations.contains("ensure_feature(db, &credential.tenant_id, \"staff.api\")"));
    let staff = include_str!("../src/services/staff_advanced_service.rs");
    assert!(staff.contains("ensure_write_feature(db, &gateway.tenant_id, \"staff.biometric\")"));
}
