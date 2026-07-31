use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

#[derive(Debug)]
struct EndpointRequirement {
    group: &'static str,
    method: &'static str,
    path: &'static str,
}

const ENDPOINT_REQUIREMENTS: &[EndpointRequirement] = &[
    // Command
    EndpointRequirement {
        group: "command",
        method: "GET",
        path: "/staff-enterprise/command-center",
    },
    EndpointRequirement {
        group: "command",
        method: "GET",
        path: "/staff-enterprise/floor-control",
    },
    // Workforce
    EndpointRequirement {
        group: "workforce",
        method: "GET",
        path: "/staff/shift-swaps",
    },
    EndpointRequirement {
        group: "workforce",
        method: "GET",
        path: "/staff/branch-transfers",
    },
    EndpointRequirement {
        group: "workforce",
        method: "GET",
        path: "/staff/roster/coverage",
    },
    EndpointRequirement {
        group: "workforce",
        method: "GET",
        path: "/staff/manpower/forecast",
    },
    EndpointRequirement {
        group: "workforce",
        method: "GET",
        path: "/staff/intelligence/ai-analysis",
    },
    EndpointRequirement {
        group: "workforce",
        method: "POST",
        path: "/staff/shift-swaps",
    },
    EndpointRequirement {
        group: "workforce",
        method: "POST",
        path: "/staff/shift-swaps/:id/decision",
    },
    EndpointRequirement {
        group: "workforce",
        method: "POST",
        path: "/staff/branch-transfers",
    },
    EndpointRequirement {
        group: "workforce",
        method: "POST",
        path: "/staff/branch-transfers/:id/decision",
    },
    EndpointRequirement {
        group: "workforce",
        method: "POST",
        path: "/staff/roster/optimize",
    },
    EndpointRequirement {
        group: "workforce",
        method: "POST",
        path: "/staff/roster/drafts/:id/apply",
    },
    // Development
    EndpointRequirement {
        group: "development",
        method: "GET",
        path: "/staff-enterprise/skill-matrix",
    },
    EndpointRequirement {
        group: "development",
        method: "GET",
        path: "/staff/skill-licenses",
    },
    EndpointRequirement {
        group: "development",
        method: "GET",
        path: "/staff/performance-reviews",
    },
    EndpointRequirement {
        group: "development",
        method: "GET",
        path: "/staff/coach/goals",
    },
    EndpointRequirement {
        group: "development",
        method: "GET",
        path: "/staff-enterprise/training",
    },
    EndpointRequirement {
        group: "development",
        method: "POST",
        path: "/staff/skill-licenses",
    },
    EndpointRequirement {
        group: "development",
        method: "POST",
        path: "/staff/performance-reviews",
    },
    EndpointRequirement {
        group: "development",
        method: "POST",
        path: "/staff-enterprise/training/assign",
    },
    EndpointRequirement {
        group: "development",
        method: "PATCH",
        path: "/staff/tasks/:id",
    },
    EndpointRequirement {
        group: "development",
        method: "POST",
        path: "/staff/coach/actions/:id/complete",
    },
    // Systems
    EndpointRequirement {
        group: "systems",
        method: "GET",
        path: "/staff/biometric/devices",
    },
    EndpointRequirement {
        group: "systems",
        method: "GET",
        path: "/staff/biometric/gateways",
    },
    EndpointRequirement {
        group: "systems",
        method: "GET",
        path: "/staff/biometric/mappings",
    },
    EndpointRequirement {
        group: "systems",
        method: "GET",
        path: "/staff/biometric/consents",
    },
    EndpointRequirement {
        group: "systems",
        method: "GET",
        path: "/staff/biometric/exceptions",
    },
    EndpointRequirement {
        group: "systems",
        method: "GET",
        path: "/staff/mobile/conflicts",
    },
    EndpointRequirement {
        group: "systems",
        method: "GET",
        path: "/staff/self/dashboard",
    },
    EndpointRequirement {
        group: "systems",
        method: "POST",
        path: "/staff/biometric/devices",
    },
    EndpointRequirement {
        group: "systems",
        method: "POST",
        path: "/staff/biometric/gateways",
    },
    EndpointRequirement {
        group: "systems",
        method: "POST",
        path: "/staff/biometric/gateways/:id/heartbeat",
    },
    EndpointRequirement {
        group: "systems",
        method: "POST",
        path: "/staff/biometric/mappings",
    },
    EndpointRequirement {
        group: "systems",
        method: "POST",
        path: "/staff/biometric/mappings/:id/approve",
    },
    EndpointRequirement {
        group: "systems",
        method: "POST",
        path: "/staff/biometric/consents",
    },
    EndpointRequirement {
        group: "systems",
        method: "POST",
        path: "/staff/biometric/consents/:id/deletion-request",
    },
    EndpointRequirement {
        group: "systems",
        method: "POST",
        path: "/staff/mobile/devices",
    },
    EndpointRequirement {
        group: "systems",
        method: "POST",
        path: "/staff/mobile/sync",
    },
    EndpointRequirement {
        group: "systems",
        method: "POST",
        path: "/staff/mobile/conflicts/:id/resolve",
    },
    // Governance
    EndpointRequirement {
        group: "governance",
        method: "GET",
        path: "/staff/approvals",
    },
    EndpointRequirement {
        group: "governance",
        method: "GET",
        path: "/staff/feedback",
    },
    EndpointRequirement {
        group: "governance",
        method: "PATCH",
        path: "/staff/feedback/:id",
    },
    EndpointRequirement {
        group: "governance",
        method: "GET",
        path: "/staff/audit",
    },
    EndpointRequirement {
        group: "governance",
        method: "GET",
        path: "/staff/notifications",
    },
    EndpointRequirement {
        group: "governance",
        method: "GET",
        path: "/staff/notification-delivery-logs",
    },
    EndpointRequirement {
        group: "governance",
        method: "GET",
        path: "/staff/tips/summary",
    },
    EndpointRequirement {
        group: "governance",
        method: "GET",
        path: "/staff/payroll-compliance/summary",
    },
    EndpointRequirement {
        group: "governance",
        method: "POST",
        path: "/staff/approvals/:id/decision",
    },
    EndpointRequirement {
        group: "governance",
        method: "POST",
        path: "/staff/payroll-compliance/calculate",
    },
    EndpointRequirement {
        group: "governance",
        method: "POST",
        path: "/staff/payroll-compliance/export",
    },
    EndpointRequirement {
        group: "governance",
        method: "POST",
        path: "/staff/tips/payouts",
    },
    EndpointRequirement {
        group: "governance",
        method: "POST",
        path: "/staff/notification-templates",
    },
    EndpointRequirement {
        group: "governance",
        method: "PUT",
        path: "/staff/:staff_id/notification-preferences",
    },
    EndpointRequirement {
        group: "governance",
        method: "POST",
        path: "/staff/notifications/:id/approve",
    },
    EndpointRequirement {
        group: "governance",
        method: "POST",
        path: "/staff/notifications/:id/retry",
    },
    EndpointRequirement {
        group: "governance",
        method: "POST",
        path: "/staff/notifications/:id/delivery-result",
    },
    // Content
    EndpointRequirement {
        group: "content",
        method: "GET",
        path: "/staff/rules",
    },
    EndpointRequirement {
        group: "content",
        method: "POST",
        path: "/staff/rules",
    },
    EndpointRequirement {
        group: "content",
        method: "POST",
        path: "/staff/rules/:id/publish",
    },
    EndpointRequirement {
        group: "content",
        method: "POST",
        path: "/staff/rules/:id/unpublish",
    },
    EndpointRequirement {
        group: "content",
        method: "POST",
        path: "/staff/rules/violations",
    },
    EndpointRequirement {
        group: "content",
        method: "POST",
        path: "/staff/rules/violations/:id/resolve",
    },
    EndpointRequirement {
        group: "staff-app",
        method: "GET",
        path: "/staff-self/rules",
    },
    EndpointRequirement {
        group: "staff-app",
        method: "POST",
        path: "/staff-self/rules/:id/read",
    },
    EndpointRequirement {
        group: "staff-app",
        method: "POST",
        path: "/staff-self/rules/:id/acknowledge",
    },
    EndpointRequirement {
        group: "content",
        method: "GET",
        path: "/staff/tasks",
    },
    EndpointRequirement {
        group: "content",
        method: "POST",
        path: "/staff/tasks",
    },
    EndpointRequirement {
        group: "content",
        method: "GET",
        path: "/marketing/offers",
    },
    EndpointRequirement {
        group: "content",
        method: "POST",
        path: "/marketing/offers",
    },
    EndpointRequirement {
        group: "content",
        method: "GET",
        path: "/staff/payroll-adjustment-rules",
    },
    EndpointRequirement {
        group: "content",
        method: "POST",
        path: "/staff/payroll-adjustment-rules",
    },
];

#[test]
fn staff_control_center_parity_matrix_is_routed() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let route_source_paths = [
        manifest_dir.join("src/routes/staff_enterprise.rs"),
        manifest_dir.join("src/routes/staff_operations.rs"),
        manifest_dir.join("src/routes/staff_advanced.rs"),
        manifest_dir.join("src/routes/marketing_leads.rs"),
    ];

    let mut route_map: HashMap<String, HashSet<String>> = HashMap::new();
    for path in &route_source_paths {
        let source = fs::read_to_string(path)
            .unwrap_or_else(|err| panic!("failed to read {}: {}", path.display(), err));
        for (route_path, method) in parse_routes(&source) {
            let normalized = normalize_path(&route_path);
            route_map.entry(normalized).or_default().insert(method);
        }
    }

    let mut missing: Vec<String> = Vec::new();
    for check in ENDPOINT_REQUIREMENTS {
        let available = route_map
            .get(&normalize_path(check.path))
            .cloned()
            .unwrap_or_else(HashSet::new);
        if !available.contains(check.method) {
            let methods: Vec<_> = available.iter().map(String::as_str).collect();
            missing.push(format!(
                "[{}] {} {} is missing (available: {:?})",
                check.group, check.method, check.path, methods,
            ));
        }
    }

    assert!(
        missing.is_empty(),
        "Staff control-center API contract check failed:\n{}",
        missing.join("\n")
    );
}

#[test]
fn staff_decision_payload_uses_comments_alias() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let service_file = manifest_dir.join("src/services/staff_enterprise_service.rs");
    let source = fs::read_to_string(service_file)
        .unwrap_or_else(|err| panic!("failed to read staff_enterprise_service.rs: {}", err));

    assert!(
        source.contains("pub struct DecisionRequest")
            && source.contains("#[serde(alias = \"notes\")]"),
        "DecisionRequest no longer includes serde alias comments/notes compatibility"
    );
}

fn parse_routes(source: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut cursor = 0;

    while let Some(route_pos) = source[cursor..].find(".route(") {
        let start = cursor + route_pos;
        let args_start = start + 7; // index of first char after ".route"
        let mut depth = 1usize;
        let body_start = args_start;
        let mut body_end = 0usize;

        for (offset, ch) in source[args_start..].char_indices() {
            if ch == '(' {
                depth += 1;
            } else if ch == ')' {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    body_end = args_start + offset;
                    break;
                }
            }
        }

        if body_end == 0 {
            break;
        }

        let body = &source[body_start..body_end];
        if let Some((path_expr, handlers_expr)) = split_route_args(body) {
            let Some(path) = extract_string(path_expr) else {
                cursor = body_end;
                continue;
            };

            for method in detect_methods(handlers_expr) {
                out.push((path.clone(), method));
            }
        }

        cursor = body_end + 1;
    }

    out
}

fn split_route_args(body: &str) -> Option<(&str, &str)> {
    let mut depth = 0usize;
    for (offset, ch) in body.char_indices() {
        if ch == '(' {
            depth += 1;
        } else if ch == ')' {
            if depth > 0 {
                depth -= 1;
            }
        } else if ch == ',' && depth == 0 {
            return Some((body[..offset].trim(), body[offset + 1..].trim()));
        }
    }
    None
}

fn extract_string(value: &str) -> Option<String> {
    let value = value.trim();
    if !(value.starts_with('"') || value.starts_with('\'')) {
        return None;
    }

    let quote = value.chars().next()?;
    let end = value[1..].find(quote)?;
    Some(value[1..1 + end].to_string())
}

fn detect_methods(handlers: &str) -> Vec<String> {
    let mut methods = Vec::new();
    for method in ["GET", "POST", "PUT", "PATCH", "DELETE"] {
        let token = method.to_ascii_lowercase();
        let token_full = format!("{}(", token);
        let token_routing = format!("axum::routing::{}(", token);
        if handlers.contains(&token_full) || handlers.contains(&token_routing) {
            methods.push(method.to_string());
        }
    }
    methods
}

fn normalize_path(value: &str) -> String {
    let value = value.trim().to_ascii_lowercase();
    let without_query = value
        .split_once('?')
        .map_or(value.as_str(), |(path, _)| path);
    let mut normalized = without_query.trim_end_matches('/').to_string();
    if normalized.is_empty() {
        normalized.push('/');
    }
    normalized
}
