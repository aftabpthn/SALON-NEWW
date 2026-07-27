use chrono::{Datelike, Duration, NaiveDate};
use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

use crate::repositories::staff_payroll_repository as repository;
use crate::services::staff_payroll_service as service;

type TestResult = Result<(), Box<dyn std::error::Error + Send + Sync>>;

#[tokio::test]
async fn selected_staff_regeneration_updates_only_target_and_blocks_finalized_runs() -> TestResult {
    let Some(pool) = postgres_pool().await? else {
        eprintln!("skipped selected staff regeneration test: DATABASE_URL is not configured");
        return Ok(());
    };
    sqlx::migrate!("./migrations").run(&pool).await?;

    let suffix = Uuid::new_v4().simple().to_string();
    let tenant_id = format!("tenant-payroll-regen-{suffix}");
    let branch_id = format!("branch-payroll-regen-{suffix}");
    let target_staff_id = id("staff-target", &suffix);
    let other_staff_id = id("staff-other", &suffix);
    let actor = format!("tester-{suffix}");
    let period_start = NaiveDate::from_ymd_opt(2026, 6, 1).unwrap();
    let year = period_start.year();
    let month = period_start.month();

    sqlx::query(
        "INSERT INTO staff(id,tenant_id,branch_id,employee_code,first_name,last_name,active) \
         VALUES($1,$2,$3,$4,'Target','Staff',TRUE),($5,$2,$3,$6,'Other','Staff',TRUE)",
    )
    .bind(&target_staff_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(format!("EMP-T-{}", &suffix[..6]))
    .bind(&other_staff_id)
    .bind(format!("EMP-O-{}", &suffix[..6]))
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO staff_pay_rates(tenant_id,branch_id,staff_id,rate_type,amount_paise,effective_from,active) \
         VALUES($1,$2,$3,'monthly',3000000,$4,TRUE),($1,$2,$5,'monthly',2000000,$4,TRUE)",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&target_staff_id)
    .bind(period_start)
    .bind(&other_staff_id)
    .execute(&pool)
    .await?;

    sqlx::query(
        "INSERT INTO staff_attendance_records(tenant_id,branch_id,staff_id,business_date,status,worked_minutes,overtime_minutes) \
         VALUES($1,$2,$3,$4,'present',480,0),($1,$2,$5,$4,'present',480,0)",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&target_staff_id)
    .bind(period_start)
    .bind(&other_staff_id)
    .execute(&pool)
    .await?;

    // Whole-run generation (unchanged behavior): both staff calculated in one run.
    let initial = service::run_payroll(&pool, &tenant_id, &branch_id, &actor, year, month, "", "")
        .await
        .expect("initial whole-run payroll generation should succeed");
    assert_eq!(initial.items.len(), 2);
    let other_before_gross = initial
        .items
        .iter()
        .find(|item| item.staff_id == other_staff_id)
        .map(|item| item.gross_paise)
        .expect("other staff item present after initial generation");
    let other_before_net = initial
        .items
        .iter()
        .find(|item| item.staff_id == other_staff_id)
        .map(|item| item.net_paise)
        .unwrap();
    let other_before_id = initial
        .items
        .iter()
        .find(|item| item.staff_id == other_staff_id)
        .map(|item| item.id.clone())
        .unwrap();
    let target_before_worked = initial
        .items
        .iter()
        .find(|item| item.staff_id == target_staff_id)
        .map(|item| item.worked_minutes)
        .expect("target staff item present after initial generation");
    assert_eq!(target_before_worked, 480);

    // New attendance for the target staff only, so a fresh preview differs from the saved item.
    let second_date = period_start + Duration::days(1);
    sqlx::query(
        "INSERT INTO staff_attendance_records(tenant_id,branch_id,staff_id,business_date,status,worked_minutes,overtime_minutes) \
         VALUES($1,$2,$3,$4,'present',540,60)",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&target_staff_id)
    .bind(second_date)
    .execute(&pool)
    .await?;

    let reason = "Attendance correction after payroll draft";
    let regenerated = service::run_payroll(
        &pool,
        &tenant_id,
        &branch_id,
        &actor,
        year,
        month,
        &target_staff_id,
        reason,
    )
    .await
    .expect("selected staff regeneration should succeed on a calculated run");

    let target_after_worked = regenerated
        .items
        .iter()
        .find(|item| item.staff_id == target_staff_id)
        .map(|item| item.worked_minutes)
        .expect("target staff item present after regeneration");
    assert_eq!(target_after_worked, 480 + 540);

    // Other staff's saved item must be completely untouched by the selected-staff regeneration.
    let other_after = regenerated
        .items
        .iter()
        .find(|item| item.staff_id == other_staff_id)
        .expect("other staff item still present after regeneration");
    assert_eq!(other_after.id, other_before_id);
    assert_eq!(other_after.gross_paise, other_before_gross);
    assert_eq!(other_after.net_paise, other_before_net);

    // Audit event carries the reason and the before/after diff for the regenerated staff only.
    let events = repository::get_events(&pool, &tenant_id, &branch_id, &regenerated.run.id).await?;
    let event = events
        .iter()
        .find(|event| event.event_type == "payroll.selected_staff_regenerated")
        .expect("selected staff regeneration event recorded");
    assert_eq!(event.payload_json["reason"].as_str(), Some(reason));
    let changes = event.payload_json["changes"]
        .as_array()
        .expect("changes array present on regeneration event");
    assert_eq!(changes.len(), 1);
    let change = changes
        .iter()
        .find(|change| change["staffId"].as_str() == Some(target_staff_id.as_str()))
        .expect("regenerated staff change entry present");
    let before_minutes = change["before"]["workedMinutes"].as_i64().unwrap();
    let after_minutes = change["after"]["workedMinutes"].as_i64().unwrap();
    assert_eq!(before_minutes, 480);
    assert_eq!(after_minutes, 480 + 540);
    assert_ne!(before_minutes, after_minutes);

    // Finalized runs must reject further selected-staff regeneration.
    sqlx::query("UPDATE staff_payroll_runs SET status='finalized' WHERE id=$1")
        .bind(&regenerated.run.id)
        .execute(&pool)
        .await?;
    let blocked = service::run_payroll(
        &pool,
        &tenant_id,
        &branch_id,
        &actor,
        year,
        month,
        &target_staff_id,
        "second attempt after finalization",
    )
    .await;
    assert!(
        blocked.is_err(),
        "finalized payroll run must reject regeneration"
    );

    // Cleanup: deleting the run cascades payroll items/events; deleting staff cascades pay rates/attendance.
    sqlx::query("DELETE FROM staff_payroll_runs WHERE tenant_id=$1")
        .bind(&tenant_id)
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM staff WHERE tenant_id=$1")
        .bind(&tenant_id)
        .execute(&pool)
        .await?;

    Ok(())
}

async fn postgres_pool() -> Result<Option<PgPool>, sqlx::Error> {
    dotenvy::dotenv().ok();
    let Ok(url) = std::env::var("DATABASE_URL") else {
        return Ok(None);
    };
    PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map(Some)
}

fn id(prefix: &str, suffix: &str) -> String {
    format!("{prefix}-{suffix}")
}
