use axum::http::HeaderMap;

use crate::models::common::AppError;

pub(crate) fn tenant_branch(headers: &HeaderMap) -> Result<(String, String), AppError> {
    let tenant_id = required_header(headers, "x-tenant-id")?;
    let branch_id = headers
        .get("x-branch-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            tenant_id
                .eq_ignore_ascii_case("platform")
                .then(|| "global".into())
        })
        .ok_or_else(|| AppError::validation("x-branch-id is required"))?;
    Ok((tenant_id, branch_id))
}

fn required_header(headers: &HeaderMap, name: &'static str) -> Result<String, AppError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::validation(format!("{name} is required")))
}
