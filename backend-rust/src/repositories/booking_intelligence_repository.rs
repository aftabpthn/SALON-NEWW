use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct ServiceTiming {
    pub id: String,
    pub name: String,
    pub duration_minutes: i32,
    pub price_paise: i64,
    pub wait_time_minutes: i32,
    pub cleanup_time_minutes: i32,
    pub buffer_time_minutes: i32,
}

#[derive(Debug, Clone, FromRow)]
pub struct EligibleStaff {
    pub id: String,
    pub name: String,
    pub gender: String,
    pub verified_skills: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct BusyAppointment {
    pub staff_id: String,
    pub start_at: DateTime<Utc>,
    pub end_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ClientBookingSignals {
    pub wallet_paise: i64,
    pub unpaid_paise: i64,
    pub no_shows: i64,
    pub cancellations: i64,
    pub appointments: i64,
    pub active_memberships: i64,
    pub package_credits: i64,
}

pub async fn service_timings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    service_ids: &[String],
) -> Result<Vec<ServiceTiming>, sqlx::Error> {
    sqlx::query_as("SELECT id,name,duration_minutes,price_paise,wait_time_minutes,cleanup_time_minutes,buffer_time_minutes FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND id=ANY($3)")
        .bind(tenant_id).bind(branch_id).bind(service_ids).fetch_all(db).await
}

pub async fn eligible_staff(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
) -> Result<Vec<EligibleStaff>, sqlx::Error> {
    sqlx::query_as("SELECT s.id,COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',s.first_name,s.middle_name,s.last_name)),''),'Staff') AS name,COALESCE(p.gender,'') AS gender,COUNT(sl.id) FILTER (WHERE sl.verification_status='verified' AND (sl.expires_on IS NULL OR sl.expires_on>=CURRENT_DATE))::BIGINT AS verified_skills FROM staff s LEFT JOIN staff_profiles p ON p.staff_id=s.id AND p.tenant_id=s.tenant_id AND p.branch_id=s.branch_id LEFT JOIN staff_skill_licenses sl ON sl.staff_id=s.id AND sl.tenant_id=s.tenant_id AND sl.branch_id=s.branch_id WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.active=TRUE AND (EXISTS(SELECT 1 FROM staff_service_assignments a WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.staff_id=s.id AND a.service_id=$3) OR EXISTS(SELECT 1 FROM staff_catalog_assignments a WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.staff_id=s.id AND a.item_type='service' AND a.item_id=$3)) GROUP BY s.id,s.first_name,s.middle_name,s.last_name,p.gender ORDER BY verified_skills DESC,name")
        .bind(tenant_id).bind(branch_id).bind(service_id).fetch_all(db).await
}

pub async fn busy_appointments(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<Vec<BusyAppointment>, sqlx::Error> {
    sqlx::query_as("SELECT staff_id,start_at,end_at FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND status NOT IN ('cancelled','no-show') AND start_at<$4 AND end_at>$3")
        .bind(tenant_id).bind(branch_id).bind(from).bind(until).fetch_all(db).await
}

pub async fn client_signals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<ClientBookingSignals, sqlx::Error> {
    sqlx::query_as("SELECT COALESCE((SELECT SUM(delta_paise) FROM wallet_transactions WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3),0)::BIGINT AS wallet_paise,COALESCE((SELECT SUM(GREATEST(total_paise-paid_paise,0)) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND status NOT IN ('draft','cancelled','voided')),0)::BIGINT AS unpaid_paise,COALESCE((SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND start_at>=NOW()-INTERVAL '365 days' AND status='no-show'),0)::BIGINT AS no_shows,COALESCE((SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND start_at>=NOW()-INTERVAL '365 days' AND status='cancelled'),0)::BIGINT AS cancellations,COALESCE((SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND start_at>=NOW()-INTERVAL '365 days'),0)::BIGINT AS appointments,COALESCE((SELECT COUNT(*) FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND active=TRUE AND frozen_at IS NULL AND (expires_at IS NULL OR expires_at>=NOW())),0)::BIGINT AS active_memberships,COALESCE((SELECT SUM(remaining_qty) FROM client_package_credits WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND active=TRUE AND remaining_qty>0 AND (expires_at IS NULL OR expires_at>=CURRENT_DATE)),0)::BIGINT AS package_credits")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_one(db).await
}
#[derive(Debug, Clone, FromRow)]
pub struct ServiceBookingGuard {
    pub service_id: String,
    pub requires_consultation: bool,
    pub requires_patch_test: bool,
    pub consultation_form_definition_id: String,
    pub patch_test_valid_days: i32,
}

pub async fn service_booking_guards(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    service_ids: &[String],
) -> Result<Vec<ServiceBookingGuard>, sqlx::Error> {
    sqlx::query_as("SELECT service_id,requires_consultation,requires_patch_test,COALESCE(consultation_form_definition_id,'') AS consultation_form_definition_id,patch_test_valid_days FROM service_booking_guards WHERE tenant_id=$1 AND branch_id=$2 AND service_id=ANY($3)")
        .bind(tenant_id).bind(branch_id).bind(service_ids).fetch_all(db).await
}

pub async fn upsert_service_booking_guard(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    guard: &ServiceBookingGuard,
) -> Result<ServiceBookingGuard, sqlx::Error> {
    sqlx::query_as("INSERT INTO service_booking_guards (tenant_id,branch_id,service_id,consultation_form_definition_id,requires_consultation,requires_patch_test,patch_test_valid_days) VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7) ON CONFLICT (tenant_id,branch_id,service_id) DO UPDATE SET consultation_form_definition_id=EXCLUDED.consultation_form_definition_id,requires_consultation=EXCLUDED.requires_consultation,requires_patch_test=EXCLUDED.requires_patch_test,patch_test_valid_days=EXCLUDED.patch_test_valid_days,updated_at=NOW() RETURNING service_id,requires_consultation,requires_patch_test,COALESCE(consultation_form_definition_id,'') AS consultation_form_definition_id,patch_test_valid_days")
        .bind(tenant_id).bind(branch_id).bind(&guard.service_id).bind(&guard.consultation_form_definition_id).bind(guard.requires_consultation).bind(guard.requires_patch_test).bind(guard.patch_test_valid_days).fetch_one(db).await
}

pub async fn client_has_current_guard_form(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    form_definition_id: &str,
    valid_days: i32,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM client_form_submissions WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND definition_id=$4 AND submitted_at>=NOW()-($5::TEXT || ' days')::INTERVAL)")
        .bind(tenant_id).bind(branch_id).bind(client_id).bind(form_definition_id).bind(valid_days.max(1)).fetch_one(db).await
}
