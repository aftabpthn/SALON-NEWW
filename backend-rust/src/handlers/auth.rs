use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct LoginPayload {
    pub email: String,
    pub password: String,
}

#[derive(Debug)]
#[allow(dead_code)]
pub struct LoginContext {
    pub tenant_id: String,
    pub branch_id: Option<String>,
}
