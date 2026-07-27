#[test]
fn role_authorization_changes_invalidate_sessions() {
    let migration = include_str!("../migrations/0272_role_authorization_session_invalidation.sql");
    for field in [
        "name",
        "permissions_json",
        "denied_permissions_json",
        "masked_fields_json",
        "max_discount_paise",
        "max_refund_paise",
        "max_cash_movement_paise",
    ] {
        assert!(migration.contains(field), "missing role field: {field}");
    }
    assert!(migration.contains("permission_version = permission_version + 1"));
    assert!(migration.contains("role_authorization_changed"));

    let auth = include_str!("../src/middleware/auth.rs");
    assert!(auth.contains("find_active_permission_version"));
    assert!(auth.contains("current_permission_version != cached.permission_version"));
}

#[test]
fn branch_access_changes_invalidate_sessions() {
    let migration = include_str!("../migrations/0065_advanced_branch_auth.sql");
    assert!(migration.contains("trg_user_branch_roles_permission_version"));
    assert!(migration.contains("permission_version = permission_version + 1"));

    let repository = include_str!("../src/repositories/staff_repository.rs");
    assert!(repository.contains("revoke_reason='branch_access_changed'"));
}
