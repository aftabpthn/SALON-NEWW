use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::language_settings_repository::{
        self as repository, TenantLanguageSettingsRecord, UserLanguagePreferenceRecord,
    },
};

const SUPPORTED_LANGUAGES: [&str; 25] = [
    "en-IN",
    "hi-IN",
    "hi-Latn-IN",
    "ar-SA",
    "pt-BR",
    "th-TH",
    "zh-CN",
    "ja-JP",
    "tr-TR",
    "es-ES",
    "fr-FR",
    "id-ID",
    "de-DE",
    "it-IT",
    "nl-NL",
    "ms-MY",
    "vi-VN",
    "ko-KR",
    "fil-PH",
    "ru-RU",
    "pl-PL",
    "sv-SE",
    "ur-PK",
    "pa-IN",
    "bn-BD",
];
const DATE_FORMATS: [&str; 3] = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantLanguageSettings {
    pub primary_language: String,
    pub secondary_language: Option<String>,
    pub display_mode: String,
    pub region: String,
    pub currency: String,
    pub time_zone: String,
    pub date_format: String,
    pub number_locale: String,
    pub allow_user_override: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserLanguagePreference {
    pub primary_language: String,
    pub secondary_language: Option<String>,
    pub display_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageSettingsView {
    pub tenant_default: TenantLanguageSettings,
    pub user_preference: Option<UserLanguagePreference>,
    pub effective: TenantLanguageSettings,
    pub source: &'static str,
    pub can_manage_tenant: bool,
}

pub async fn settings(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    can_manage_tenant: bool,
) -> Result<LanguageSettingsView, AppError> {
    let tenant_record = repository::tenant_settings(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load language settings"))?;
    let has_tenant_default = tenant_record.is_some();
    let tenant = tenant_record
        .map(TenantLanguageSettings::from)
        .unwrap_or_default();
    let user = repository::user_preference(db, tenant_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to load language preference"))?
        .map(UserLanguagePreference::from);
    let use_user = tenant.allow_user_override && user.is_some();
    let effective = if use_user {
        let preference = user.as_ref().expect("checked user preference");
        TenantLanguageSettings {
            primary_language: preference.primary_language.clone(),
            secondary_language: preference.secondary_language.clone(),
            display_mode: preference.display_mode.clone(),
            ..tenant.clone()
        }
    } else {
        tenant.clone()
    };
    Ok(LanguageSettingsView {
        tenant_default: tenant,
        user_preference: user,
        effective,
        source: if use_user {
            "user"
        } else if has_tenant_default {
            "tenant"
        } else {
            "english"
        },
        can_manage_tenant,
    })
}

pub async fn save_tenant_settings(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    settings: TenantLanguageSettings,
) -> Result<(), AppError> {
    let settings = validate_tenant(settings)?;
    repository::upsert_tenant_settings(
        db,
        tenant_id,
        user_id,
        &TenantLanguageSettingsRecord::from(settings),
    )
    .await
    .map_err(|_| AppError::internal("failed to save language settings"))
}

pub async fn save_user_preference(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    preference: UserLanguagePreference,
) -> Result<(), AppError> {
    let tenant = repository::tenant_settings(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load language settings"))?;
    if tenant.is_some_and(|settings| !settings.allow_user_override) {
        return Err(AppError::forbidden(
            "language override is disabled by the tenant",
        ));
    }
    let preference = validate_user(preference)?;
    repository::upsert_user_preference(
        db,
        tenant_id,
        user_id,
        &UserLanguagePreferenceRecord::from(preference),
    )
    .await
    .map_err(|_| AppError::internal("failed to save language preference"))
}

fn validate_tenant(
    mut settings: TenantLanguageSettings,
) -> Result<TenantLanguageSettings, AppError> {
    validate_language_choice(
        &settings.primary_language,
        settings.secondary_language.as_deref(),
        &settings.display_mode,
    )?;
    settings.region = uppercase_code(&settings.region, 2, "region")?;
    settings.currency = uppercase_code(&settings.currency, 3, "currency")?;
    settings.time_zone = clean_timezone(&settings.time_zone)?;
    if !DATE_FORMATS.contains(&settings.date_format.as_str()) {
        return Err(AppError::validation("unsupported date format"));
    }
    if !SUPPORTED_LANGUAGES.contains(&settings.number_locale.as_str()) {
        return Err(AppError::validation("unsupported number format"));
    }
    if settings.display_mode == "single" {
        settings.secondary_language = None;
    }
    Ok(settings)
}

fn validate_user(
    mut preference: UserLanguagePreference,
) -> Result<UserLanguagePreference, AppError> {
    validate_language_choice(
        &preference.primary_language,
        preference.secondary_language.as_deref(),
        &preference.display_mode,
    )?;
    if preference.display_mode == "single" {
        preference.secondary_language = None;
    }
    Ok(preference)
}

fn validate_language_choice(
    primary: &str,
    secondary: Option<&str>,
    mode: &str,
) -> Result<(), AppError> {
    if !SUPPORTED_LANGUAGES.contains(&primary) || !matches!(mode, "single" | "bilingual") {
        return Err(AppError::validation("unsupported language preference"));
    }
    if mode == "bilingual"
        && secondary
            .filter(|value| *value != primary && SUPPORTED_LANGUAGES.contains(value))
            .is_none()
    {
        return Err(AppError::validation(
            "bilingual mode requires a different supported secondary language",
        ));
    }
    Ok(())
}

fn uppercase_code(value: &str, length: usize, field: &str) -> Result<String, AppError> {
    let value = value.trim().to_uppercase();
    if value.len() != length || !value.bytes().all(|byte| byte.is_ascii_alphabetic()) {
        return Err(AppError::validation(format!("invalid {field}")));
    }
    Ok(value)
}

fn clean_timezone(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'_' | b'-' | b'+'))
    {
        return Err(AppError::validation("invalid timezone"));
    }
    Ok(value.to_owned())
}

impl Default for TenantLanguageSettings {
    fn default() -> Self {
        Self {
            primary_language: "en-IN".into(),
            secondary_language: None,
            display_mode: "single".into(),
            region: "IN".into(),
            currency: "INR".into(),
            time_zone: "Asia/Kolkata".into(),
            date_format: "DD/MM/YYYY".into(),
            number_locale: "en-IN".into(),
            allow_user_override: true,
        }
    }
}

impl From<TenantLanguageSettingsRecord> for TenantLanguageSettings {
    fn from(value: TenantLanguageSettingsRecord) -> Self {
        Self {
            primary_language: value.primary_language,
            secondary_language: value.secondary_language,
            display_mode: value.display_mode,
            region: value.region,
            currency: value.currency,
            time_zone: value.time_zone,
            date_format: value.date_format,
            number_locale: value.number_locale,
            allow_user_override: value.allow_user_override,
        }
    }
}

impl From<TenantLanguageSettings> for TenantLanguageSettingsRecord {
    fn from(value: TenantLanguageSettings) -> Self {
        Self {
            primary_language: value.primary_language,
            secondary_language: value.secondary_language,
            display_mode: value.display_mode,
            region: value.region,
            currency: value.currency,
            time_zone: value.time_zone,
            date_format: value.date_format,
            number_locale: value.number_locale,
            allow_user_override: value.allow_user_override,
        }
    }
}

impl From<UserLanguagePreferenceRecord> for UserLanguagePreference {
    fn from(value: UserLanguagePreferenceRecord) -> Self {
        Self {
            primary_language: value.primary_language,
            secondary_language: value.secondary_language,
            display_mode: value.display_mode,
        }
    }
}

impl From<UserLanguagePreference> for UserLanguagePreferenceRecord {
    fn from(value: UserLanguagePreference) -> Self {
        Self {
            primary_language: value.primary_language,
            secondary_language: value.secondary_language,
            display_mode: value.display_mode,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_single_and_bilingual_preferences() {
        assert!(validate_user(UserLanguagePreference {
            primary_language: "en-IN".into(),
            secondary_language: Some("fr-FR".into()),
            display_mode: "single".into()
        })
        .unwrap()
        .secondary_language
        .is_none());
        assert!(validate_user(UserLanguagePreference {
            primary_language: "en-IN".into(),
            secondary_language: Some("fr-FR".into()),
            display_mode: "bilingual".into()
        })
        .is_ok());
        assert!(validate_user(UserLanguagePreference {
            primary_language: "en-IN".into(),
            secondary_language: Some("en-IN".into()),
            display_mode: "bilingual".into()
        })
        .is_err());
    }
}
