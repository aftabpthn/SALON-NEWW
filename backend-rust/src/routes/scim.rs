use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    repositories::sso_repository::{self, ScimUser},
    services::{auth_service, sso_service},
    state::AppState,
};

const SCIM_TYPE: &str = "application/scim+json";
const USER_SCHEMA: &str = "urn:ietf:params:scim:schemas:core:2.0:User";

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/scim/v2/ServiceProviderConfig",
            get(service_provider_config),
        )
        .route("/scim/v2/ResourceTypes", get(resource_types))
        .route("/scim/v2/Schemas", get(schemas))
        .route("/scim/v2/Users", get(list_users).post(create_user))
        .route(
            "/scim/v2/Users/:user_id",
            get(get_user)
                .put(replace_user)
                .patch(patch_user)
                .delete(delete_user),
        )
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    filter: Option<String>,
    start_index: Option<usize>,
    count: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserPayload {
    user_name: String,
    #[serde(default)]
    external_id: Option<String>,
    #[serde(default)]
    active: Option<bool>,
    #[serde(default)]
    name: ScimName,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScimName {
    #[serde(default)]
    given_name: String,
    #[serde(default)]
    family_name: String,
    #[serde(default)]
    formatted: String,
}

async fn service_provider_config(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ScimError> {
    authorize(&state, &headers).await?;
    Ok(scim(
        StatusCode::OK,
        json!({
            "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
            "patch": {"supported": true}, "bulk": {"supported": false},
            "filter": {"supported": true, "maxResults": 200},
            "changePassword": {"supported": false}, "sort": {"supported": false},
            "etag": {"supported": false}, "authenticationSchemes": [{
                "type": "oauthbearertoken", "name": "Bearer Token", "description": "Tenant-scoped SCIM bearer token", "primary": true
            }]
        }),
    ))
}

async fn resource_types(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ScimError> {
    authorize(&state, &headers).await?;
    Ok(scim(
        StatusCode::OK,
        json!({"Resources": [{
        "id": "User", "name": "User", "endpoint": "/Users", "schema": USER_SCHEMA,
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"]
    }], "totalResults": 1, "itemsPerPage": 1, "startIndex": 1,
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"]}),
    ))
}

async fn schemas(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, ScimError> {
    authorize(&state, &headers).await?;
    Ok(scim(
        StatusCode::OK,
        json!({"Resources": [{
        "id": USER_SCHEMA, "name": "User", "description": "AuraShine user",
        "attributes": [
          {"name":"userName","type":"string","multiValued":false,"required":true,"uniqueness":"server"},
          {"name":"name","type":"complex","multiValued":false,"subAttributes":[
            {"name":"formatted","type":"string","multiValued":false},
            {"name":"givenName","type":"string","multiValued":false},
            {"name":"familyName","type":"string","multiValued":false}
          ]},
          {"name":"active","type":"boolean","multiValued":false}
        ], "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Schema"]
    }], "totalResults":1,"itemsPerPage":1,"startIndex":1,
    "schemas":["urn:ietf:params:scim:api:messages:2.0:ListResponse"]}),
    ))
}

async fn list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> Result<Response, ScimError> {
    let tenant_id = authorize(&state, &headers).await?;
    let mut users = sso_repository::list_scim_users(&state.db, &tenant_id)
        .await
        .map_err(ScimError::db)?;
    if let Some(filter) = query.filter.as_deref().and_then(user_name_filter) {
        users.retain(|user| user.user_name.eq_ignore_ascii_case(filter));
    }
    let total = users.len();
    let start = query.start_index.unwrap_or(1).max(1);
    let count = query.count.unwrap_or(100).min(200);
    let resources: Vec<Value> = users
        .into_iter()
        .skip(start - 1)
        .take(count)
        .map(scim_user)
        .collect();
    Ok(scim(
        StatusCode::OK,
        json!({
            "schemas":["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
            "totalResults":total,"startIndex":start,"itemsPerPage":resources.len(),"Resources":resources
        }),
    ))
}

async fn get_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Response, ScimError> {
    let tenant_id = authorize(&state, &headers).await?;
    let user = sso_repository::get_scim_user(&state.db, &tenant_id, &user_id)
        .await
        .map_err(ScimError::db)?
        .ok_or_else(ScimError::not_found)?;
    Ok(scim(StatusCode::OK, scim_user(user)))
}

async fn create_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<UserPayload>,
) -> Result<Response, ScimError> {
    let tenant_id = authorize(&state, &headers).await?;
    let email = valid_email(&payload.user_name)?;
    let password_hash = auth_service::hash_password(&sso_service::random_token(48))
        .map_err(|_| ScimError::server())?;
    let user = sso_repository::create_scim_user(
        &state.db,
        &tenant_id,
        clean(payload.external_id.as_deref()),
        email,
        &full_name(&payload.name),
        &password_hash,
        payload.active.unwrap_or(true),
    )
    .await
    .map_err(|error| {
        if error.to_string().contains("unique") {
            ScimError::conflict("userName or externalId already exists")
        } else {
            ScimError::db(error)
        }
    })?;
    Ok(scim(StatusCode::CREATED, scim_user(user)))
}

async fn replace_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(payload): Json<UserPayload>,
) -> Result<Response, ScimError> {
    let tenant_id = authorize(&state, &headers).await?;
    let email = valid_email(&payload.user_name)?;
    let user = sso_repository::update_scim_user(
        &state.db,
        &tenant_id,
        &user_id,
        clean(payload.external_id.as_deref()),
        email,
        &full_name(&payload.name),
        payload.active.unwrap_or(true),
    )
    .await
    .map_err(ScimError::db)?
    .ok_or_else(ScimError::not_found)?;
    Ok(scim(StatusCode::OK, scim_user(user)))
}

async fn patch_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Response, ScimError> {
    let tenant_id = authorize(&state, &headers).await?;
    let current = sso_repository::get_scim_user(&state.db, &tenant_id, &user_id)
        .await
        .map_err(ScimError::db)?
        .ok_or_else(ScimError::not_found)?;
    let mut email = current.user_name.clone();
    let mut name = current.full_name.clone();
    let mut active = current.active;
    for operation in payload
        .get("Operations")
        .and_then(Value::as_array)
        .ok_or_else(|| ScimError::invalid("Operations is required"))?
    {
        if !matches!(
            operation
                .get("op")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str(),
            "add" | "replace"
        ) {
            continue;
        }
        let path = operation
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_lowercase();
        let value = operation.get("value").unwrap_or(&Value::Null);
        match path.as_str() {
            "active" => {
                active = value
                    .as_bool()
                    .ok_or_else(|| ScimError::invalid("active must be boolean"))?
            }
            "username" => email = valid_email(value.as_str().unwrap_or(""))?.to_string(),
            "name.formatted" => name = value.as_str().unwrap_or("").trim().to_string(),
            "" => {
                if let Some(next) = value.get("active").and_then(Value::as_bool) {
                    active = next;
                }
                if let Some(next) = value.get("userName").and_then(Value::as_str) {
                    email = valid_email(next)?.to_string();
                }
                if let Some(next) = value
                    .get("name")
                    .and_then(|item| item.get("formatted"))
                    .and_then(Value::as_str)
                {
                    name = next.trim().to_string();
                }
            }
            _ => {}
        }
    }
    let user = sso_repository::update_scim_user(
        &state.db,
        &tenant_id,
        &user_id,
        current.external_id.as_deref(),
        &email,
        &name,
        active,
    )
    .await
    .map_err(ScimError::db)?
    .ok_or_else(ScimError::not_found)?;
    Ok(scim(StatusCode::OK, scim_user(user)))
}

async fn delete_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Response, ScimError> {
    let tenant_id = authorize(&state, &headers).await?;
    if !sso_repository::deactivate_scim_user(&state.db, &tenant_id, &user_id)
        .await
        .map_err(ScimError::db)?
    {
        return Err(ScimError::not_found());
    }
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn authorize(state: &AppState, headers: &HeaderMap) -> Result<String, ScimError> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(ScimError::unauthorized)?;
    sso_repository::tenant_for_scim_token(&state.db, &sso_service::token_hash(token))
        .await
        .map_err(ScimError::db)?
        .ok_or_else(ScimError::unauthorized)
}

fn scim_user(user: ScimUser) -> Value {
    json!({"schemas":[USER_SCHEMA],"id":user.id,"externalId":user.external_id,"userName":user.user_name,
        "name":{"formatted":user.full_name},"active":user.active,
        "meta":{"resourceType":"User","created":user.created_at,"lastModified":user.updated_at.unwrap_or(user.created_at),"location":format!("/api/v1/scim/v2/Users/{}",user.id)}})
}

fn scim(status: StatusCode, body: Value) -> Response {
    let mut response = (status, Json(body)).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(SCIM_TYPE));
    response
}

fn valid_email(value: &str) -> Result<&str, ScimError> {
    let value = value.trim();
    if value.len() > 254 || !value.contains('@') {
        Err(ScimError::invalid("userName must be a valid email"))
    } else {
        Ok(value)
    }
}

fn clean(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}
fn full_name(name: &ScimName) -> String {
    if !name.formatted.trim().is_empty() {
        return name.formatted.trim().to_string();
    }
    format!("{} {}", name.given_name.trim(), name.family_name.trim())
        .trim()
        .to_string()
}
fn user_name_filter(filter: &str) -> Option<&str> {
    let (field, value) = filter.split_once(" eq ")?;
    (field.eq_ignore_ascii_case("userName")).then(|| value.trim().trim_matches('"'))
}

struct ScimError {
    status: StatusCode,
    detail: &'static str,
    scim_type: Option<&'static str>,
}
impl ScimError {
    fn invalid(detail: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            detail,
            scim_type: Some("invalidValue"),
        }
    }
    fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            detail: "invalid SCIM bearer token",
            scim_type: None,
        }
    }
    fn not_found() -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            detail: "SCIM resource was not found",
            scim_type: None,
        }
    }
    fn conflict(detail: &'static str) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            detail,
            scim_type: Some("uniqueness"),
        }
    }
    fn server() -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            detail: "SCIM request failed",
            scim_type: None,
        }
    }
    fn db(_: sqlx::Error) -> Self {
        Self::server()
    }
}
impl IntoResponse for ScimError {
    fn into_response(self) -> Response {
        scim(
            self.status,
            json!({"schemas":["urn:ietf:params:scim:api:messages:2.0:Error"],
            "status":self.status.as_u16().to_string(),"scimType":self.scim_type,"detail":self.detail}),
        )
    }
}
