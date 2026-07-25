use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Money is stored as integer paise in DB and APIs to keep precision.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct MoneyPaise(pub i64);

pub type ApiResult<T> = Result<Json<ApiResponse<T>>, AppError>;

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ApiErrorBody>,
    pub meta: ApiMeta,
}

#[derive(Debug, Serialize)]
pub struct ApiMeta {
    pub request_id: String,
    pub version: &'static str,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<i64>,
    #[serde(rename = "pageSize", skip_serializing_if = "Option::is_none")]
    pub page_size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ApiErrorBody {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl<T> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
            meta: ApiMeta::new(),
        }
    }

    pub fn paged(data: T, page: i64, page_size: i64, total: i64) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
            meta: ApiMeta::paged(page, page_size, total),
        }
    }
}

impl ApiResponse<()> {
    pub fn error(error: ApiErrorBody) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error),
            meta: ApiMeta::new(),
        }
    }
}

impl ApiMeta {
    fn new() -> Self {
        Self {
            request_id: Uuid::new_v4().to_string(),
            version: "v1",
            timestamp: Utc::now().to_rfc3339(),
            page: None,
            page_size: None,
            total: None,
        }
    }

    fn paged(page: i64, page_size: i64, total: i64) -> Self {
        Self {
            page: Some(page),
            page_size: Some(page_size),
            total: Some(total),
            ..Self::new()
        }
    }
}

#[derive(Debug)]
pub struct AppError {
    status: StatusCode,
    code: &'static str,
    message: String,
    details: Option<Value>,
}

impl AppError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "VALIDATION_FAILED", message)
    }

    pub fn unauthenticated(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "UNAUTHENTICATED", message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "FORBIDDEN", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "NOT_FOUND", message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, "CONFLICT", message)
    }

    pub fn rate_limited(message: impl Into<String>) -> Self {
        Self::new(StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", message)
    }

    #[allow(dead_code)]
    pub fn not_implemented(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_IMPLEMENTED, code, message)
    }

    pub fn service_unavailable(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, code, message)
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn status_code(&self) -> StatusCode {
        self.status
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            details: None,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let body = ApiResponse::error(ApiErrorBody {
            code: self.code,
            message: self.message,
            details: self.details,
        });

        (self.status, Json(body)).into_response()
    }
}
