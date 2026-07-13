use axum::http::HeaderMap;

use crate::models::common::AppError;

pub(crate) fn tenant_branch(headers: &HeaderMap) -> Result<(String, String), AppError> {
    Ok((
        required_header(headers, "x-tenant-id")?,
        required_header(headers, "x-branch-id")?,
    ))
}

fn required_header(headers: &HeaderMap, name: &'static str) -> Result<String, AppError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::validation(format!("{name} is required")))
}
