use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct TenantLanguageSettingsRecord {
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

#[derive(Debug, Clone, FromRow)]
pub struct UserLanguagePreferenceRecord {
    pub primary_language: String,
    pub secondary_language: Option<String>,
    pub display_mode: String,
}

pub async fn tenant_settings(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Option<TenantLanguageSettingsRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT primary_language,secondary_language,display_mode,region,currency,time_zone,date_format,number_locale,allow_user_override FROM tenant_language_settings WHERE tenant_id=$1 AND branch_id='*'",
    )
    .bind(tenant_id)
    .fetch_optional(db)
    .await
}

pub async fn user_preference(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
) -> Result<Option<UserLanguagePreferenceRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT primary_language,secondary_language,display_mode FROM user_language_preferences WHERE tenant_id=$1 AND branch_id='*' AND user_id=$2",
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
}

pub async fn upsert_tenant_settings(
    db: &PgPool,
    tenant_id: &str,
    actor_id: &str,
    settings: &TenantLanguageSettingsRecord,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO tenant_language_settings(tenant_id,branch_id,primary_language,secondary_language,display_mode,region,currency,time_zone,date_format,number_locale,allow_user_override,updated_by) VALUES($1,'*',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(tenant_id) DO UPDATE SET primary_language=EXCLUDED.primary_language,secondary_language=EXCLUDED.secondary_language,display_mode=EXCLUDED.display_mode,region=EXCLUDED.region,currency=EXCLUDED.currency,time_zone=EXCLUDED.time_zone,date_format=EXCLUDED.date_format,number_locale=EXCLUDED.number_locale,allow_user_override=EXCLUDED.allow_user_override,updated_by=EXCLUDED.updated_by,updated_at=NOW()",
    )
    .bind(tenant_id)
    .bind(&settings.primary_language)
    .bind(&settings.secondary_language)
    .bind(&settings.display_mode)
    .bind(&settings.region)
    .bind(&settings.currency)
    .bind(&settings.time_zone)
    .bind(&settings.date_format)
    .bind(&settings.number_locale)
    .bind(settings.allow_user_override)
    .bind(actor_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn upsert_user_preference(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    preference: &UserLanguagePreferenceRecord,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO user_language_preferences(tenant_id,branch_id,user_id,primary_language,secondary_language,display_mode) VALUES($1,'*',$2,$3,$4,$5) ON CONFLICT(tenant_id,user_id) DO UPDATE SET primary_language=EXCLUDED.primary_language,secondary_language=EXCLUDED.secondary_language,display_mode=EXCLUDED.display_mode,updated_at=NOW()",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(&preference.primary_language)
    .bind(&preference.secondary_language)
    .bind(&preference.display_mode)
    .execute(db)
    .await?;
    Ok(())
}
