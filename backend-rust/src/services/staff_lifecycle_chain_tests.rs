use chrono::NaiveDate;
use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

type TestResult = Result<(), Box<dyn std::error::Error + Send + Sync>>;

#[tokio::test]
async fn staff_lifecycle_chain_persists_and_stays_branch_scoped() -> TestResult {
    let Some(pool) = postgres_pool().await? else {
        eprintln!("skipped staff lifecycle chain test: DATABASE_URL is not configured");
        return Ok(());
    };
    sqlx::migrate!("./migrations").run(&pool).await?;

    let mut tx = pool.begin().await?;
    let suffix = Uuid::new_v4().simple().to_string();
    let tenant_id = Uuid::new_v4().to_string();
    let branch_id = Uuid::new_v4().to_string();
    let other_branch_id = Uuid::new_v4().to_string();
    let role_id = id("role", &suffix);
    let user_id = id("user", &suffix);
    let staff_id = id("staff", &suffix);
    let other_staff_id = id("staff-other", &suffix);
    let client_id = id("client", &suffix);
    let service_id = id("service", &suffix);
    let appointment_id = id("appt", &suffix);
    let sale_id = id("sale", &suffix);
    let sale_line_id = id("line", &suffix);
    let payroll_run_id = id("payroll-run", &suffix);
    let payroll_item_id = id("payroll-item", &suffix);
    let business_date = NaiveDate::from_ymd_opt(2026, 7, 14).unwrap();

    sqlx::query("INSERT INTO tenants(id,name,slug) VALUES($1::uuid,$2,$3)")
        .bind(&tenant_id)
        .bind("Staff Lifecycle Test")
        .bind(format!("staff-life-{suffix}"))
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO branches(id,tenant_id,name,code) VALUES($1::uuid,$2::uuid,$3,$4),($5::uuid,$2::uuid,$6,$7)")
        .bind(&branch_id)
        .bind(&tenant_id)
        .bind("Primary")
        .bind(format!("P{}", &suffix[..6]))
        .bind(&other_branch_id)
        .bind("Other")
        .bind(format!("O{}", &suffix[..6]))
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO roles(id,tenant_id,name,permissions_json) VALUES($1,$2,'manager','[]'::jsonb)",
    )
    .bind(&role_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO users(id,tenant_id,branch_id,role_id,role_name,email,password_hash,full_name,login_id) VALUES($1,$2,$3,$4,'manager',$5,'hash','Staff Manager',$6)")
        .bind(&user_id)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&role_id)
        .bind(format!("staff-life-{suffix}@example.test"))
        .bind(format!("staff-life-{suffix}"))
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_id,role_name,is_default,active) VALUES($1,$2,$3,$4,'manager',TRUE,TRUE)")
        .bind(&tenant_id)
        .bind(&user_id)
        .bind(&branch_id)
        .bind(&role_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO staff(id,tenant_id,branch_id,employee_code,first_name,last_name,email,job_title,user_id) VALUES($1,$2,$3,$4,'Chain','Staff',$5,'Therapist',$6),($7,$2,$8,$9,'Other','Staff',$10,'Therapist',NULL)")
        .bind(&staff_id)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(format!("EMP-{}", &suffix[..8]))
        .bind(format!("chain-{suffix}@example.test"))
        .bind(&user_id)
        .bind(&other_staff_id)
        .bind(&other_branch_id)
        .bind(format!("EMP-O-{}", &suffix[..8]))
        .bind(format!("other-{suffix}@example.test"))
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO clients(id,tenant_id,branch_id,first_name,phone) VALUES($1,$2,$3,'Client',$4)",
    )
    .bind(&client_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(format!("9{}", &suffix[..9]))
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO services(id,tenant_id,branch_id,name,category,duration_minutes,price_paise) VALUES($1,$2,$3,'Service','Hair',60,100000)")
        .bind(&service_id)
        .bind(&tenant_id)
        .bind(&branch_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO staff_service_assignments(tenant_id,branch_id,staff_id,service_id) VALUES($1,$2,$3,$4)")
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&staff_id)
        .bind(&service_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO staff_catalog_assignments(tenant_id,branch_id,staff_id,item_type,item_id,commission_percent) VALUES($1,$2,$3,'service',$4,10)")
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&staff_id)
        .bind(&service_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO staff_pay_rates(tenant_id,branch_id,staff_id,rate_type,amount_paise,effective_from) VALUES($1,$2,$3,'monthly',3000000,$4)")
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&staff_id)
        .bind(business_date)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO staff_schedules(tenant_id,branch_id,staff_id,schedule_date,shift1_start,shift1_end,status) VALUES($1,$2,$3,$4,'09:00','18:00','working')")
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&staff_id)
        .bind(business_date)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO appointments(id,tenant_id,branch_id,client_id,staff_id,service_ids_json,start_at,end_at,status) VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,'booked')")
        .bind(&appointment_id)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&client_id)
        .bind(&staff_id)
        .bind(format!("[\"{service_id}\"]"))
        .bind("2026-07-14T10:00:00+05:30")
        .bind("2026-07-14T11:00:00+05:30")
        .execute(&mut *tx)
        .await?;
    let eligible: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM staff_service_assignments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND service_id=$4)")
        .bind(&tenant_id).bind(&branch_id).bind(&staff_id).bind(&service_id).fetch_one(&mut *tx).await?;
    assert!(eligible);
    let conflicts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND status NOT IN ('cancelled','no_show') AND start_at < $4::timestamptz AND end_at > $5::timestamptz")
        .bind(&tenant_id).bind(&branch_id).bind(&staff_id).bind("2026-07-14T10:30:00+05:30").bind("2026-07-14T10:15:00+05:30").fetch_one(&mut *tx).await?;
    assert_eq!(conflicts, 1);

    let leave_id = id("leave", &suffix);
    sqlx::query("INSERT INTO staff_leave_requests(id,tenant_id,branch_id,staff_id,leave_type,start_date,end_date,days,status,requested_by,reviewed_by,reviewed_at) VALUES($1,$2,$3,$4,'annual',$5,$5,1,'approved',$6,$6,NOW())")
        .bind(&leave_id).bind(&tenant_id).bind(&branch_id).bind(&staff_id).bind(business_date).bind(&user_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE staff_schedules SET status='leave',notes=$5 WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND schedule_date=$4")
        .bind(&tenant_id).bind(&branch_id).bind(&staff_id).bind(business_date).bind(&leave_id).execute(&mut *tx).await?;
    let synced_leave: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND schedule_date=$4 AND status='leave')")
        .bind(&tenant_id).bind(&branch_id).bind(&staff_id).bind(business_date).fetch_one(&mut *tx).await?;
    assert!(synced_leave);

    let attendance_id = id("att", &suffix);
    sqlx::query("INSERT INTO staff_attendance_records(id,tenant_id,branch_id,staff_id,business_date,clock_in_at,clock_out_at,status,source,worked_minutes,overtime_minutes,late_minutes,break_minutes,manual_status,correction_reason,corrected_by,corrected_at) VALUES($1,$2,$3,$4,$5,'2026-07-14T09:10:00+05:30','2026-07-14T19:10:00+05:30','clocked_out','manager_correction',540,60,10,30,'present','Phase 6 correction',$6,NOW())")
        .bind(&attendance_id).bind(&tenant_id).bind(&branch_id).bind(&staff_id).bind(business_date).bind(&user_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO staff_attendance_breaks(tenant_id,branch_id,staff_id,attendance_id,started_at,ended_at,created_by) VALUES($1,$2,$3,$4,'2026-07-14T13:00:00+05:30','2026-07-14T13:30:00+05:30',$5)")
        .bind(&tenant_id).bind(&branch_id).bind(&staff_id).bind(&attendance_id).bind(&user_id).execute(&mut *tx).await?;

    sqlx::query("INSERT INTO pos_sales(id,tenant_id,branch_id,client_id,staff_id,invoice_number,subtotal_paise,total_paise,paid_paise,status,reference_id,business_date,finalized_at) VALUES($1,$2,$3,$4,$5,$6,100000,100000,100000,'paid',$7,$8,NOW())")
        .bind(&sale_id).bind(&tenant_id).bind(&branch_id).bind(&client_id).bind(&staff_id).bind(format!("INV-{}", &suffix[..10])).bind(&appointment_id).bind(business_date).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO pos_sale_lines(id,tenant_id,branch_id,sale_id,line_type,item_id,item_name,quantity,unit_price_paise,gross_paise,taxable_paise,line_total_paise,staff_id,staff_splits) VALUES($1,$2,$3,$4,'service',$5,'Service',1,100000,100000,100000,100000,$6,$7::jsonb)")
        .bind(&sale_line_id).bind(&tenant_id).bind(&branch_id).bind(&sale_id).bind(&service_id).bind(&staff_id)
        .bind(format!(r#"[{{"staffId":"{staff_id}","splitBps":10000}}]"#)).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO pos_staff_commission_snapshots(tenant_id,branch_id,sale_id,sale_line_id,staff_id,line_type,item_id,split_bps,base_paise,rate_percent,commission_paise,rule_source,business_date) VALUES($1,$2,$3,$4,$5,'service',$6,10000,100000,10,10000,'catalog',$7)")
        .bind(&tenant_id).bind(&branch_id).bind(&sale_id).bind(&sale_line_id).bind(&staff_id).bind(&service_id).bind(business_date).execute(&mut *tx).await?;
    let commission_paise: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(commission_paise),0)::BIGINT FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND sale_id=$4")
        .bind(&tenant_id).bind(&branch_id).bind(&staff_id).bind(&sale_id).fetch_one(&mut *tx).await?;
    assert_eq!(commission_paise, 10_000);

    sqlx::query("INSERT INTO staff_payroll_runs(id,tenant_id,branch_id,cycle,period_start,period_end,status,gross_paise,net_paise,staff_count,created_by,finalized_by,finalized_at) VALUES($1,$2,$3,'monthly',$4,$4,'finalized',1510000,1510000,1,$5,$5,NOW())")
        .bind(&payroll_run_id).bind(&tenant_id).bind(&branch_id).bind(business_date).bind(&user_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO staff_payroll_items(id,tenant_id,branch_id,payroll_run_id,staff_id,staff_name,employee_code,pay_rate_type,pay_rate_paise,attendance_days_x2,worked_minutes,overtime_minutes,earned_salary_paise,overtime_paise,commission_paise,gross_paise,net_paise,status) VALUES($1,$2,$3,$4,$5,'Chain Staff',$6,'monthly',3000000,2,540,60,1500000,0,10000,1510000,1510000,'finalized')")
        .bind(&payroll_item_id).bind(&tenant_id).bind(&branch_id).bind(&payroll_run_id).bind(&staff_id).bind(format!("EMP-{}", &suffix[..8])).execute(&mut *tx).await?;
    let payroll_ok: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM staff_payroll_items item JOIN staff_payroll_runs run ON run.id=item.payroll_run_id AND run.tenant_id=item.tenant_id AND run.branch_id=item.branch_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.staff_id=$3 AND item.commission_paise=10000 AND run.status='finalized')")
        .bind(&tenant_id).bind(&branch_id).bind(&staff_id).fetch_one(&mut *tx).await?;
    assert!(payroll_ok);

    sqlx::query("INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_id,role_name,access_type,valid_from,valid_until,active,is_default) VALUES($1,$2,$3,$4,'manager','deputation',$5,$5,TRUE,FALSE)")
        .bind(&tenant_id).bind(&user_id).bind(&other_branch_id).bind(&role_id).bind(business_date).execute(&mut *tx).await?;
    let branch_access_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_branch_roles WHERE tenant_id=$1 AND user_id=$2 AND active=TRUE",
    )
    .bind(&tenant_id)
    .bind(&user_id)
    .fetch_one(&mut *tx)
    .await?;
    assert_eq!(branch_access_count, 2);
    let isolated_other_branch_sales: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3",
    )
    .bind(&tenant_id)
    .bind(&other_branch_id)
    .bind(&staff_id)
    .fetch_one(&mut *tx)
    .await?;
    assert_eq!(isolated_other_branch_sales, 0);

    tx.rollback().await?;
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
