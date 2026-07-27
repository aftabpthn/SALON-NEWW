use std::collections::BTreeSet;

fn quoted_values(source: &str) -> Vec<&str> {
    source
        .split('"')
        .enumerate()
        .filter_map(|(index, value)| (index % 2 == 1).then_some(value))
        .collect()
}

#[test]
fn every_route_permission_exists_in_the_authoritative_catalog() {
    let auth_source = include_str!("../src/services/auth_service.rs");
    let catalog_codes = auth_source
        .lines()
        .filter_map(|line| line.trim().strip_prefix("code: \"")?.strip_suffix("\","))
        .collect::<Vec<_>>();
    let catalog = catalog_codes.iter().copied().collect::<BTreeSet<_>>();
    assert_eq!(
        catalog_codes.len(),
        catalog.len(),
        "permission codes must stay unique"
    );

    let tenant_source = include_str!("../src/middleware/tenant.rs");
    let route_source = tenant_source
        .split_once("fn route_access")
        .expect("route_access must exist")
        .1
        .split_once("const fn access")
        .expect("access constructor must follow route_access")
        .0;
    let route_permissions = quoted_values(route_source)
        .into_iter()
        .filter(|value| {
            value.contains('.')
                && !value.starts_with('/')
                && value.bytes().all(|byte| {
                    byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._".contains(&byte)
                })
        })
        .collect::<BTreeSet<_>>();

    let unknown = route_permissions
        .difference(&catalog)
        .copied()
        .collect::<Vec<_>>();
    assert!(unknown.is_empty(), "unknown route permissions: {unknown:?}");
}
