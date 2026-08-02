use chrono::NaiveDate;
use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

#[path = "../src/repositories/staff_hrms_repository.rs"]
mod staff_hrms_repository;

async fn cleanup(db: &PgPool, tenant: &str) {
    for table in ["hr_job_applications", "hr_job_openings", "staff"] {
        sqlx::query(&format!("DELETE FROM {table} WHERE tenant_id=$1"))
            .bind(tenant)
            .execute(db)
            .await
            .expect("HRMS test cleanup");
    }
}

#[tokio::test]
async fn hrms_scope_constraints_and_optimistic_concurrency_hold() {
    dotenvy::dotenv().ok();
    let db = PgPoolOptions::new()
        .max_connections(4)
        .connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL is required"))
        .await
        .expect("PostgreSQL must be available");
    let suffix = Uuid::new_v4().simple().to_string();
    let tenant = format!("hrms-test-{suffix}");
    let branch_a = format!("a-{suffix}");
    let branch_b = format!("b-{suffix}");
    let staff_id = format!("staff-{suffix}");

    sqlx::query("INSERT INTO staff(id,tenant_id,branch_id,employee_code,first_name,job_title) VALUES($1,$2,$3,$4,'Evidence','Stylist')")
        .bind(&staff_id).bind(&tenant).bind(&branch_a).bind(format!("E-{}", &suffix[..8]))
        .execute(&db).await.expect("evidence-gated staff");

    let opening_a: String = sqlx::query_scalar("INSERT INTO hr_job_openings(tenant_id,branch_id,title,employment_type,status,created_by) VALUES($1,$2,'Stylist','full_time','open','test') RETURNING id")
        .bind(&tenant).bind(&branch_a).fetch_one(&db).await.expect("branch A opening");
    sqlx::query("INSERT INTO hr_job_openings(tenant_id,branch_id,title,employment_type,status,created_by) VALUES($1,$2,'Manager','full_time','open','test')")
        .bind(&tenant).bind(&branch_b).execute(&db).await.expect("branch B opening");
    sqlx::query("INSERT INTO hr_job_applications(tenant_id,branch_id,job_opening_id,first_name,email,created_by) VALUES($1,$2,$3,'Candidate','candidate@example.invalid','test')")
        .bind(&tenant).bind(&branch_a).bind(&opening_a).execute(&db).await.expect("scoped candidate");

    let branch_a_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM hr_job_applications WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant)
    .bind(&branch_a)
    .fetch_one(&db)
    .await
    .unwrap();
    let branch_b_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM hr_job_applications WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant)
    .bind(&branch_b)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!((branch_a_count, branch_b_count), (1, 0));

    let dashboard = staff_hrms_repository::dashboard(&db, &tenant, &branch_a)
        .await
        .expect("HRMS dashboard query");
    assert_eq!(dashboard["jobOpenings"].as_array().unwrap().len(), 1);
    assert_eq!(dashboard["applications"].as_array().unwrap().len(), 1);
    assert!(dashboard["orgChart"].is_array());
    assert!(dashboard["documentAlerts"].is_array());
    assert!(dashboard["learning"].is_object());

    let intelligence = staff_hrms_repository::operations_intelligence(
        &db,
        &tenant,
        &branch_a,
        NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
        NaiveDate::from_ymd_opt(2026, 7, 31).unwrap(),
    )
    .await
    .expect("HR operations intelligence query");
    assert!(intelligence["summary"]["hrHealthScore"].is_null());
    assert_eq!(intelligence["summary"]["evidenceCoveragePercent"], 0);
    assert_eq!(
        intelligence["summary"]["evidenceStatus"],
        "insufficient_evidence"
    );

    let update = "UPDATE hr_job_openings SET status=$4,version=version+1 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=1";
    let (first, second) = tokio::join!(
        sqlx::query(update)
            .bind(&tenant)
            .bind(&branch_a)
            .bind(&opening_a)
            .bind("paused")
            .execute(&db),
        sqlx::query(update)
            .bind(&tenant)
            .bind(&branch_a)
            .bind(&opening_a)
            .bind("closed")
            .execute(&db),
    );
    assert_eq!(
        first.unwrap().rows_affected() + second.unwrap().rows_affected(),
        1
    );

    let invalid = sqlx::query("INSERT INTO hr_job_openings(tenant_id,branch_id,title,employment_type,openings_count,created_by) VALUES($1,$2,'Invalid','full_time',0,'test')")
        .bind(&tenant).bind(&branch_a).execute(&db).await;
    assert!(invalid.is_err());
    cleanup(&db, &tenant).await;
}
