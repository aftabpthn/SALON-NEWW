use serde_json::Value;
use sqlx::PgPool;

pub async fn dashboard(db: &PgPool, tenant: &str, branch: &str) -> Result<Value, sqlx::Error> {
    let openings = sqlx::query_scalar::<_, Value>(r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('id',opening.id,'title',opening.title,'department',opening.department,'employmentType',opening.employment_type,'openingsCount',opening.openings_count,'description',opening.description,'status',opening.status,'applicationCount',(SELECT COUNT(*) FROM hr_job_applications application WHERE application.tenant_id=opening.tenant_id AND application.branch_id=opening.branch_id AND application.job_opening_id=opening.id),'version',opening.version,'createdAt',opening.created_at,'updatedAt',opening.updated_at) ORDER BY opening.created_at DESC),'[]'::JSONB) FROM hr_job_openings opening WHERE opening.tenant_id=$1 AND opening.branch_id=$2"#).bind(tenant).bind(branch).fetch_one(db);
    let applications = sqlx::query_scalar::<_, Value>(r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('id',application.id,'jobOpeningId',application.job_opening_id,'jobTitle',opening.title,'firstName',application.first_name,'lastName',application.last_name,'email',application.email,'phone',application.phone,'source',application.source,'resumeUrl',application.resume_url,'notes',application.notes,'stage',application.stage,'linkedStaffId',application.linked_staff_id,'version',application.version,'createdAt',application.created_at,'updatedAt',application.updated_at) ORDER BY application.created_at DESC),'[]'::JSONB) FROM hr_job_applications application JOIN hr_job_openings opening ON opening.id=application.job_opening_id AND opening.tenant_id=application.tenant_id AND opening.branch_id=application.branch_id WHERE application.tenant_id=$1 AND application.branch_id=$2"#).bind(tenant).bind(branch).fetch_one(db);
    let lifecycle = sqlx::query_scalar::<_, Value>(r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('id',lifecycle.id,'staffId',lifecycle.staff_id,'staffName',TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),'applicationId',lifecycle.application_id,'candidateName',TRIM(CONCAT_WS(' ',application.first_name,NULLIF(application.last_name,''))),'caseType',lifecycle.case_type,'effectiveDate',lifecycle.effective_date,'ownerUserId',lifecycle.owner_user_id,'tasks',lifecycle.tasks_json,'status',lifecycle.status,'settlementStatus',lifecycle.settlement_status,'finalSettlementReference',lifecycle.final_settlement_reference,'finalSettlementPayrollRunId',lifecycle.final_settlement_payroll_run_id,'settlementUpdatedAt',lifecycle.settlement_updated_at,'completedAt',lifecycle.completed_at,'version',lifecycle.version,'createdAt',lifecycle.created_at,'updatedAt',lifecycle.updated_at) ORDER BY lifecycle.created_at DESC),'[]'::JSONB) FROM staff_lifecycle_cases lifecycle LEFT JOIN staff ON staff.id=lifecycle.staff_id AND staff.tenant_id=lifecycle.tenant_id AND staff.branch_id=lifecycle.branch_id LEFT JOIN hr_job_applications application ON application.id=lifecycle.application_id AND application.tenant_id=lifecycle.tenant_id AND application.branch_id=lifecycle.branch_id WHERE lifecycle.tenant_id=$1 AND lifecycle.branch_id=$2"#).bind(tenant).bind(branch).fetch_one(db);
    let org_chart = sqlx::query_scalar::<_, Value>(r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('staffId',staff.id,'staffName',TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),'employeeCode',staff.employee_code,'jobTitle',staff.job_title,'department',profile.department,'reportingManagerId',profile.reporting_manager_id,'reportingManagerName',TRIM(CONCAT_WS(' ',manager.first_name,NULLIF(manager.last_name,''))),'employmentStatus',CASE WHEN staff.active THEN COALESCE(profile.employment_status,'confirmed') ELSE 'terminated' END,'probationEndDate',profile.probation_end_date,'confirmationDate',profile.confirmation_date,'noticePeriodStartDate',profile.notice_period_start_date,'lastWorkingDate',profile.last_working_date,'employmentVersion',COALESCE(profile.employment_version,1),'active',staff.active) ORDER BY COALESCE(profile.department,''),staff.first_name,staff.last_name),'[]'::JSONB) FROM staff LEFT JOIN staff_profiles profile ON profile.staff_id=staff.id AND profile.tenant_id=staff.tenant_id AND profile.branch_id=staff.branch_id LEFT JOIN staff manager ON manager.id=profile.reporting_manager_id AND manager.tenant_id=staff.tenant_id AND manager.branch_id=staff.branch_id WHERE staff.tenant_id=$1 AND staff.branch_id=$2"#).bind(tenant).bind(branch).fetch_one(db);
    let document_alerts = sqlx::query_scalar::<_, Value>(r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('id',document.id,'staffId',document.staff_id,'staffName',TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),'documentType',document.document_type,'documentName',document.document_name,'expiryDate',document.expiry_date,'state',CASE WHEN document.expiry_date<CURRENT_DATE THEN 'expired' ELSE 'expiring' END) ORDER BY document.expiry_date),'[]'::JSONB) FROM staff_documents document JOIN staff ON staff.id=document.staff_id AND staff.tenant_id=document.tenant_id AND staff.branch_id=document.branch_id WHERE document.tenant_id=$1 AND document.branch_id=$2 AND document.expiry_date<=CURRENT_DATE+30"#).bind(tenant).bind(branch).fetch_one(db);
    let cycles = sqlx::query_scalar::<_, Value>(r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('id',cycle.id,'name',cycle.name,'periodStart',cycle.period_start,'periodEnd',cycle.period_end,'status',cycle.status,'reviewCount',(SELECT COUNT(*) FROM staff_performance_reviews review WHERE review.tenant_id=cycle.tenant_id AND review.branch_id=cycle.branch_id AND review.appraisal_cycle_id=cycle.id),'acknowledgedCount',(SELECT COUNT(*) FROM staff_performance_reviews review WHERE review.tenant_id=cycle.tenant_id AND review.branch_id=cycle.branch_id AND review.appraisal_cycle_id=cycle.id AND review.status='acknowledged'),'version',cycle.version,'createdAt',cycle.created_at,'updatedAt',cycle.updated_at) ORDER BY cycle.period_end DESC,cycle.created_at DESC),'[]'::JSONB) FROM staff_appraisal_cycles cycle WHERE cycle.tenant_id=$1 AND cycle.branch_id=$2"#).bind(tenant).bind(branch).fetch_one(db);
    let goal_templates = sqlx::query_scalar::<_, Value>(r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('id',template.id,'name',template.name,'description',template.description,'keyResults',template.key_results_json,'active',template.active,'version',template.version,'createdAt',template.created_at,'updatedAt',template.updated_at) ORDER BY template.active DESC,template.name),'[]'::JSONB) FROM staff_goal_templates template WHERE template.tenant_id=$1 AND template.branch_id=$2"#).bind(tenant).bind(branch).fetch_one(db);
    let appraisal_reviews = sqlx::query_scalar::<_, Value>(r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('id',review.id,'cycleId',review.appraisal_cycle_id,'cycleName',cycle.name,'staffId',review.staff_id,'staffName',TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),'templateId',review.goal_template_id,'templateName',template.name,'keyResults',review.key_results_json,'selfScore',review.self_score,'selfComments',review.self_comments,'selfSubmittedAt',review.self_submitted_at,'managerScore',review.manager_score,'managerComments',review.manager_comments,'managerSubmittedAt',review.manager_submitted_at,'calibratedScore',review.calibrated_score,'calibrationComments',review.calibration_comments,'calibratedAt',review.calibrated_at,'finalScore',review.final_score,'finalRating',review.final_rating,'approvedAt',review.approved_at,'coachingGoalId',review.coaching_goal_id,'incentiveAmountPaise',review.incentive_amount_paise,'incentiveEvidence',review.incentive_evidence_json,'contributionProfitPaise',review.contribution_profit_paise,'profitabilityGuardPassed',review.profitability_guard_passed,'status',review.status,'version',review.version,'acknowledgedAt',review.acknowledged_at,'history',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('action',history.action,'actorUserId',history.actor_user_id,'createdAt',history.created_at) ORDER BY history.id) FROM staff_appraisal_history history WHERE history.tenant_id=review.tenant_id AND history.branch_id=review.branch_id AND history.appraisal_review_id=review.id),'[]'::JSONB)) ORDER BY cycle.period_end DESC,staff.first_name,staff.last_name),'[]'::JSONB) FROM staff_performance_reviews review JOIN staff_appraisal_cycles cycle ON cycle.id=review.appraisal_cycle_id AND cycle.tenant_id=review.tenant_id AND cycle.branch_id=review.branch_id JOIN staff ON staff.id=review.staff_id AND staff.tenant_id=review.tenant_id AND staff.branch_id=review.branch_id LEFT JOIN staff_goal_templates template ON template.id=review.goal_template_id AND template.tenant_id=review.tenant_id AND template.branch_id=review.branch_id WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.appraisal_cycle_id IS NOT NULL"#).bind(tenant).bind(branch).fetch_one(db);
    let learning = sqlx::query_scalar::<_, Value>(r#"SELECT JSONB_BUILD_OBJECT('trainingAssignments',(SELECT COUNT(*) FROM staff_tasks WHERE tenant_id=$1 AND branch_id=$2 AND task_type='training'),'trainingCompleted',(SELECT COUNT(*) FROM staff_tasks WHERE tenant_id=$1 AND branch_id=$2 AND task_type='training' AND status='completed'),'publishedCourses',(SELECT COUNT(*) FROM staff_rule_documents WHERE tenant_id=$1 AND branch_id=$2 AND status='published' AND training_attachment_url<>''),'certifications',(SELECT COUNT(*) FROM staff_skill_licenses WHERE tenant_id=$1 AND branch_id=$2),'expiringCertifications',(SELECT COUNT(*) FROM staff_skill_licenses WHERE tenant_id=$1 AND branch_id=$2 AND verification_status='verified' AND expires_on BETWEEN CURRENT_DATE AND CURRENT_DATE+30))"#).bind(tenant).bind(branch).fetch_one(db);
    let succession = sqlx::query_scalar::<_, Value>(r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('id',plan.id,'roleTitle',plan.role_title,'incumbentStaffId',plan.incumbent_staff_id,'incumbentStaffName',TRIM(CONCAT_WS(' ',incumbent.first_name,NULLIF(incumbent.last_name,''))),'targetDate',plan.target_date,'notes',plan.notes,'status',plan.status,'version',plan.version,'candidates',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('id',candidate.id,'staffId',candidate.staff_id,'staffName',TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),'readiness',candidate.readiness,'readinessScore',candidate.readiness_score,'evidence',candidate.evidence_json,'developmentActions',candidate.development_actions_json,'status',candidate.status,'version',candidate.version) ORDER BY candidate.readiness_score DESC) FROM staff_succession_candidates candidate JOIN staff ON staff.id=candidate.staff_id AND staff.tenant_id=candidate.tenant_id AND staff.branch_id=candidate.branch_id WHERE candidate.tenant_id=plan.tenant_id AND candidate.branch_id=plan.branch_id AND candidate.plan_id=plan.id),'[]'::JSONB),'createdAt',plan.created_at,'updatedAt',plan.updated_at) ORDER BY plan.created_at DESC),'[]'::JSONB) FROM staff_succession_plans plan LEFT JOIN staff incumbent ON incumbent.id=plan.incumbent_staff_id AND incumbent.tenant_id=plan.tenant_id AND incumbent.branch_id=plan.branch_id WHERE plan.tenant_id=$1 AND plan.branch_id=$2"#).bind(tenant).bind(branch).fetch_one(db);
    let promotion_readiness = promotion_readiness_report(db, tenant, branch);
    let (
        openings,
        applications,
        lifecycle,
        org_chart,
        document_alerts,
        cycles,
        goal_templates,
        appraisal_reviews,
        learning,
        succession,
        promotion_readiness,
    ) = tokio::try_join!(
        openings,
        applications,
        lifecycle,
        org_chart,
        document_alerts,
        cycles,
        goal_templates,
        appraisal_reviews,
        learning,
        succession,
        promotion_readiness
    )?;
    Ok(
        serde_json::json!({"jobOpenings":openings,"applications":applications,"lifecycleCases":lifecycle,"orgChart":org_chart,"documentAlerts":document_alerts,"appraisalCycles":cycles,"goalTemplates":goal_templates,"appraisalReviews":appraisal_reviews,"learning":learning,"successionPlans":succession,"promotionReadiness":promotion_readiness}),
    )
}

pub async fn create_job_opening(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    title: &str,
    department: &str,
    employment_type: &str,
    openings_count: i32,
    description: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(r#"INSERT INTO hr_job_openings(tenant_id,branch_id,title,department,employment_type,openings_count,description,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING JSONB_BUILD_OBJECT('id',id,'title',title,'department',department,'employmentType',employment_type,'openingsCount',openings_count,'description',description,'status',status,'version',version,'createdAt',created_at)"#).bind(tenant).bind(branch).bind(title).bind(department).bind(employment_type).bind(openings_count).bind(description).bind(actor).fetch_one(db).await
}

pub async fn update_job_opening_status(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    status: &str,
    version: i32,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"UPDATE hr_job_openings SET status=$4,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$5 AND ((status='draft' AND $4 IN ('open','closed')) OR (status='open' AND $4 IN ('paused','closed')) OR (status='paused' AND $4 IN ('open','closed'))) RETURNING JSONB_BUILD_OBJECT('id',id,'status',status,'version',version,'updatedAt',updated_at)"#).bind(tenant).bind(branch).bind(id).bind(status).bind(version).fetch_optional(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_application(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    opening: &str,
    first: &str,
    last: &str,
    email: &str,
    phone: &str,
    source: &str,
    resume_url: &str,
    notes: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"INSERT INTO hr_job_applications(tenant_id,branch_id,job_opening_id,first_name,last_name,email,phone,source,resume_url,notes,created_by) SELECT $1,$2,opening.id,$4,$5,$6,$7,$8,$9,$10,$11 FROM hr_job_openings opening WHERE opening.tenant_id=$1 AND opening.branch_id=$2 AND opening.id=$3 AND opening.status='open' RETURNING JSONB_BUILD_OBJECT('id',id,'jobOpeningId',job_opening_id,'firstName',first_name,'lastName',last_name,'email',email,'phone',phone,'stage',stage,'version',version,'createdAt',created_at)"#).bind(tenant).bind(branch).bind(opening).bind(first).bind(last).bind(email).bind(phone).bind(source).bind(resume_url).bind(notes).bind(actor).fetch_optional(db).await
}

pub async fn update_application_stage(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    stage: &str,
    linked_staff_id: Option<&str>,
    probation_end_date: Option<chrono::NaiveDate>,
    version: i32,
) -> Result<Option<Value>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row: Option<Value> = sqlx::query_scalar(r#"UPDATE hr_job_applications application SET stage=$4,linked_staff_id=CASE WHEN $4='hired' THEN $5 ELSE linked_staff_id END,version=version+1,updated_at=NOW() WHERE application.tenant_id=$1 AND application.branch_id=$2 AND application.id=$3 AND application.version=$6 AND ($4<>'hired' OR EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$5 AND active=TRUE)) AND ((application.stage='applied' AND $4 IN ('screening','rejected','withdrawn')) OR (application.stage='screening' AND $4 IN ('interview','rejected','withdrawn')) OR (application.stage='interview' AND $4 IN ('offer','rejected')) OR (application.stage='offer' AND $4 IN ('hired','rejected','withdrawn'))) RETURNING JSONB_BUILD_OBJECT('id',id,'staffId',linked_staff_id,'applicationId',id,'stage',stage,'linkedStaffId',linked_staff_id,'version',version,'updatedAt',updated_at)"#).bind(tenant).bind(branch).bind(id).bind(stage).bind(linked_staff_id).bind(version).fetch_optional(&mut *tx).await?;
    if row.is_some() && stage == "hired" {
        sqlx::query("INSERT INTO staff_profiles(staff_id,tenant_id,branch_id,employment_status,probation_end_date) VALUES($1,$2,$3,'probation',$4) ON CONFLICT(staff_id) DO UPDATE SET employment_status='probation',probation_end_date=EXCLUDED.probation_end_date,confirmation_date=NULL,employment_version=staff_profiles.employment_version+1,updated_at=NOW()")
            .bind(linked_staff_id).bind(tenant).bind(branch).bind(probation_end_date).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(row)
}

pub async fn create_lifecycle_case(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    staff_id: Option<&str>,
    application_id: Option<&str>,
    case_type: &str,
    effective_date: chrono::NaiveDate,
    tasks: &Value,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"INSERT INTO staff_lifecycle_cases(tenant_id,branch_id,staff_id,application_id,case_type,effective_date,owner_user_id,tasks_json,status,settlement_status) SELECT $1,$2,NULLIF($4,''),NULLIF($5,''),$6,$7,$3,$8,CASE WHEN $7>CURRENT_DATE THEN 'planned' ELSE 'in_progress' END,CASE WHEN $6='offboarding' THEN 'pending' ELSE 'not_required' END WHERE (NULLIF($4,'') IS NULL OR EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$4)) AND (NULLIF($5,'') IS NULL OR EXISTS(SELECT 1 FROM hr_job_applications WHERE tenant_id=$1 AND branch_id=$2 AND id=$5)) RETURNING JSONB_BUILD_OBJECT('id',id,'staffId',staff_id,'applicationId',application_id,'caseType',case_type,'effectiveDate',effective_date,'tasks',tasks_json,'status',status,'settlementStatus',settlement_status,'version',version,'createdAt',created_at)"#).bind(tenant).bind(branch).bind(actor).bind(staff_id.unwrap_or("")).bind(application_id.unwrap_or("")).bind(case_type).bind(effective_date).bind(tasks).fetch_optional(db).await
}

pub async fn update_lifecycle_task(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    task_id: &str,
    completed: bool,
    version: i32,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"WITH changed AS (SELECT lifecycle.id,COALESCE(JSONB_AGG(CASE WHEN task->>'id'=$4 THEN task || JSONB_BUILD_OBJECT('completed',$5,'completedAt',CASE WHEN $5 THEN TO_JSONB(NOW()) ELSE 'null'::JSONB END) ELSE task END ORDER BY position),'[]'::JSONB) tasks FROM staff_lifecycle_cases lifecycle CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(lifecycle.tasks_json) WITH ORDINALITY item(task,position) WHERE lifecycle.tenant_id=$1 AND lifecycle.branch_id=$2 AND lifecycle.id=$3 AND lifecycle.version=$6 AND lifecycle.status IN ('planned','in_progress') GROUP BY lifecycle.id HAVING BOOL_OR(task->>'id'=$4)) UPDATE staff_lifecycle_cases lifecycle SET tasks_json=changed.tasks,status=CASE WHEN NOT EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(changed.tasks) task WHERE COALESCE((task->>'completed')::BOOLEAN,FALSE)=FALSE) THEN 'completed' ELSE 'in_progress' END,settlement_status=CASE WHEN lifecycle.case_type='offboarding' AND NOT EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(changed.tasks) task WHERE COALESCE((task->>'completed')::BOOLEAN,FALSE)=FALSE) THEN 'ready' ELSE lifecycle.settlement_status END,completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(changed.tasks) task WHERE COALESCE((task->>'completed')::BOOLEAN,FALSE)=FALSE) THEN NOW() ELSE NULL END,version=lifecycle.version+1,updated_at=NOW() FROM changed WHERE lifecycle.id=changed.id RETURNING JSONB_BUILD_OBJECT('id',lifecycle.id,'staffId',lifecycle.staff_id,'applicationId',lifecycle.application_id,'tasks',lifecycle.tasks_json,'status',lifecycle.status,'settlementStatus',lifecycle.settlement_status,'completedAt',lifecycle.completed_at,'version',lifecycle.version,'updatedAt',lifecycle.updated_at)"#).bind(tenant).bind(branch).bind(id).bind(task_id).bind(completed).bind(version).fetch_optional(db).await
}

pub async fn complete_settlement(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    reference: &str,
    payroll_run_id: &str,
    version: i32,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"UPDATE staff_lifecycle_cases lifecycle SET settlement_status='completed',final_settlement_reference=$4,final_settlement_payroll_run_id=NULLIF($5,''),settlement_updated_at=NOW(),version=version+1,updated_at=NOW() WHERE lifecycle.tenant_id=$1 AND lifecycle.branch_id=$2 AND lifecycle.id=$3 AND lifecycle.case_type='offboarding' AND lifecycle.status='completed' AND lifecycle.settlement_status='ready' AND lifecycle.version=$6 AND (NULLIF($5,'') IS NULL OR EXISTS(SELECT 1 FROM staff_payroll_runs run JOIN staff_payroll_payout_states payout ON payout.tenant_id=run.tenant_id AND payout.branch_id=run.branch_id AND payout.payroll_run_id=run.id AND payout.staff_id=lifecycle.staff_id AND payout.status='paid' WHERE run.tenant_id=$1 AND run.branch_id=$2 AND run.id=$5 AND run.status IN ('partially_paid','paid'))) RETURNING JSONB_BUILD_OBJECT('id',lifecycle.id,'staffId',lifecycle.staff_id,'applicationId',lifecycle.application_id,'status',lifecycle.status,'settlementStatus',lifecycle.settlement_status,'finalSettlementReference',lifecycle.final_settlement_reference,'finalSettlementPayrollRunId',lifecycle.final_settlement_payroll_run_id,'settlementUpdatedAt',lifecycle.settlement_updated_at,'version',lifecycle.version)"#).bind(tenant).bind(branch).bind(id).bind(reference).bind(payroll_run_id).bind(version).fetch_optional(db).await
}

pub async fn update_employment_status(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff_id: &str,
    status: &str,
    effective_date: chrono::NaiveDate,
    version: i32,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"UPDATE staff_profiles SET employment_status=$4,confirmation_date=CASE WHEN $4='confirmed' THEN $5 ELSE confirmation_date END,notice_period_start_date=CASE WHEN $4='notice_period' THEN $5 ELSE notice_period_start_date END,employment_version=employment_version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND employment_version=$6 AND ((employment_status='probation' AND $4 IN ('confirmed','notice_period')) OR (employment_status='confirmed' AND $4='notice_period')) RETURNING JSONB_BUILD_OBJECT('id',staff_id,'staffId',staff_id,'status',employment_status,'effectiveDate',$5,'employmentVersion',employment_version)"#).bind(tenant).bind(branch).bind(staff_id).bind(status).bind(effective_date).bind(version).fetch_optional(db).await
}

pub async fn create_appraisal_cycle(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    name: &str,
    start: chrono::NaiveDate,
    end: chrono::NaiveDate,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(r#"INSERT INTO staff_appraisal_cycles(tenant_id,branch_id,name,period_start,period_end,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING JSONB_BUILD_OBJECT('id',id,'name',name,'periodStart',period_start,'periodEnd',period_end,'status',status,'version',version,'createdAt',created_at)"#).bind(tenant).bind(branch).bind(name).bind(start).bind(end).bind(actor).fetch_one(db).await
}

pub async fn update_appraisal_cycle_status(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    status: &str,
    version: i32,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"UPDATE staff_appraisal_cycles cycle SET status=$4,version=version+1,updated_at=NOW() WHERE cycle.tenant_id=$1 AND cycle.branch_id=$2 AND cycle.id=$3 AND cycle.version=$5 AND EXISTS(SELECT 1 FROM staff_performance_reviews review WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.appraisal_cycle_id=cycle.id) AND ((cycle.status='draft' AND $4='active') OR (cycle.status='active' AND $4='review' AND NOT EXISTS(SELECT 1 FROM staff_performance_reviews review WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.appraisal_cycle_id=cycle.id AND review.status='self_review_pending')) OR (cycle.status='review' AND $4='calibration' AND NOT EXISTS(SELECT 1 FROM staff_performance_reviews review WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.appraisal_cycle_id=cycle.id AND review.status='manager_review_pending')) OR (cycle.status='calibration' AND $4='closed' AND NOT EXISTS(SELECT 1 FROM staff_performance_reviews review WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.appraisal_cycle_id=cycle.id AND review.status<>'acknowledged'))) RETURNING JSONB_BUILD_OBJECT('id',id,'status',status,'version',version,'updatedAt',updated_at)"#).bind(tenant).bind(branch).bind(id).bind(status).bind(version).fetch_optional(db).await
}

pub async fn create_goal_template(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    name: &str,
    description: &str,
    key_results: &Value,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(r#"INSERT INTO staff_goal_templates(tenant_id,branch_id,name,description,key_results_json,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING JSONB_BUILD_OBJECT('id',id,'name',name,'description',description,'keyResults',key_results_json,'active',active,'version',version,'createdAt',created_at)"#)
        .bind(tenant).bind(branch).bind(name).bind(description).bind(key_results).bind(actor).fetch_one(db).await
}

pub async fn populate_appraisal_cycle(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    cycle_id: &str,
    template_id: &str,
    staff_ids: &[String],
    actor: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(r#"WITH cycle AS (SELECT * FROM staff_appraisal_cycles WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='draft'), template AS (SELECT * FROM staff_goal_templates WHERE tenant_id=$1 AND branch_id=$2 AND id=$4 AND active=TRUE), inserted AS (INSERT INTO staff_performance_reviews(tenant_id,branch_id,staff_id,reviewer_user_id,period_start,period_end,status,appraisal_cycle_id,goal_template_id,key_results_json,last_actor_user_id) SELECT $1,$2,staff.id,$6,cycle.period_start,cycle.period_end,'self_review_pending',cycle.id,template.id,template.key_results_json,$6 FROM cycle CROSS JOIN template JOIN staff ON staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.active=TRUE AND staff.id=ANY($5::TEXT[]) ON CONFLICT(tenant_id,branch_id,appraisal_cycle_id,staff_id) WHERE appraisal_cycle_id IS NOT NULL DO NOTHING RETURNING id) SELECT JSONB_BUILD_OBJECT('id',$3,'insertedCount',COUNT(*)) FROM inserted"#)
        .bind(tenant).bind(branch).bind(cycle_id).bind(template_id).bind(staff_ids).bind(actor).fetch_one(db).await
}

pub async fn self_appraisals(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    user_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"SELECT JSONB_BUILD_OBJECT('id',review.id,'cycleId',cycle.id,'cycleName',cycle.name,'periodStart',review.period_start,'periodEnd',review.period_end,'templateName',template.name,'keyResults',review.key_results_json,'selfScore',review.self_score,'selfComments',review.self_comments,'managerScore',CASE WHEN review.status IN ('approved','acknowledged') THEN review.manager_score ELSE NULL END,'managerComments',CASE WHEN review.status IN ('approved','acknowledged') THEN review.manager_comments ELSE '' END,'finalScore',review.final_score,'finalRating',review.final_rating,'status',review.status,'version',review.version,'approvedAt',review.approved_at,'acknowledgedAt',review.acknowledged_at) FROM staff_performance_reviews review JOIN staff ON staff.tenant_id=review.tenant_id AND staff.branch_id=review.branch_id AND staff.id=review.staff_id JOIN staff_appraisal_cycles cycle ON cycle.tenant_id=review.tenant_id AND cycle.branch_id=review.branch_id AND cycle.id=review.appraisal_cycle_id LEFT JOIN staff_goal_templates template ON template.tenant_id=review.tenant_id AND template.branch_id=review.branch_id AND template.id=review.goal_template_id WHERE review.tenant_id=$1 AND review.branch_id=$2 AND staff.user_id=$3 ORDER BY review.period_end DESC"#)
        .bind(tenant).bind(branch).bind(user_id).fetch_all(db).await
}

pub async fn self_review_key_results(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    user_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT review.key_results_json FROM staff_performance_reviews review JOIN staff ON staff.tenant_id=review.tenant_id AND staff.branch_id=review.branch_id AND staff.id=review.staff_id WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.id=$3 AND staff.user_id=$4 AND review.status='self_review_pending'")
        .bind(tenant).bind(branch).bind(id).bind(user_id).fetch_optional(db).await
}

pub async fn submit_self_review(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    user_id: &str,
    key_results: &Value,
    score: i32,
    comments: &str,
    version: i32,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"UPDATE staff_performance_reviews review SET key_results_json=$5,self_score=$6,self_comments=$7,self_submitted_at=NOW(),status='manager_review_pending',last_actor_user_id=$4,version=version+1,updated_at=NOW() WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.id=$3 AND review.version=$8 AND review.status='self_review_pending' AND EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=review.staff_id AND user_id=$4) AND EXISTS(SELECT 1 FROM staff_appraisal_cycles cycle WHERE cycle.tenant_id=$1 AND cycle.branch_id=$2 AND cycle.id=review.appraisal_cycle_id AND cycle.status='active') RETURNING JSONB_BUILD_OBJECT('id',id,'staffId',staff_id,'status',status,'selfScore',self_score,'version',version,'updatedAt',updated_at)"#)
        .bind(tenant).bind(branch).bind(id).bind(user_id).bind(key_results).bind(score).bind(comments).bind(version).fetch_optional(db).await
}

pub async fn contribution_profit(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    review_id: &str,
) -> Result<Option<(i64, i64, i64)>, sqlx::Error> {
    sqlx::query_as(r#"SELECT COUNT(rollup.sale_line_id)::BIGINT,COALESCE(SUM(rollup.recognized_revenue_paise-rollup.product_cost_paise-rollup.staff_cost_paise-rollup.staff_time_cost_paise-rollup.gateway_fee_paise-rollup.refund_fee_paise),0)::BIGINT,(SELECT COUNT(*) FROM micro_profit_rollup_dirty_days dirty WHERE dirty.tenant_id=review.tenant_id AND dirty.branch_id=review.branch_id AND dirty.business_date BETWEEN review.period_start AND review.period_end)::BIGINT FROM staff_performance_reviews review LEFT JOIN micro_profit_daily_rollup rollup ON rollup.tenant_id=review.tenant_id AND rollup.branch_id=review.branch_id AND rollup.staff_id=review.staff_id AND rollup.business_date BETWEEN review.period_start AND review.period_end WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.id=$3 GROUP BY review.id"#)
        .bind(tenant).bind(branch).bind(review_id).fetch_optional(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn submit_manager_review(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    manager_score: i32,
    strengths: &str,
    improvement: &str,
    goals: &str,
    comments: &str,
    coaching_goal_id: &str,
    incentive_amount_paise: i64,
    incentive_evidence: &Value,
    contribution_profit_paise: i64,
    version: i32,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"UPDATE staff_performance_reviews review SET manager_score=$6,score=$6,strengths=$7,improvement_areas=$8,goals=$9,manager_comments=$10,manager_submitted_at=NOW(),coaching_goal_id=NULLIF($11,''),incentive_amount_paise=$12,incentive_evidence_json=$13,contribution_profit_paise=$14,profitability_guard_passed=($12=0 OR $12<=$14),status='calibration',last_actor_user_id=$5,version=version+1,updated_at=NOW() WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.id=$3 AND review.version=$4 AND review.status='manager_review_pending' AND EXISTS(SELECT 1 FROM staff_appraisal_cycles cycle WHERE cycle.tenant_id=$1 AND cycle.branch_id=$2 AND cycle.id=review.appraisal_cycle_id AND cycle.status='review') AND (NULLIF($11,'') IS NULL OR EXISTS(SELECT 1 FROM staff_coaching_goals goal WHERE goal.tenant_id=$1 AND goal.branch_id=$2 AND goal.id=$11 AND goal.staff_id=review.staff_id)) RETURNING JSONB_BUILD_OBJECT('id',id,'staffId',staff_id,'status',status,'managerScore',manager_score,'contributionProfitPaise',contribution_profit_paise,'profitabilityGuardPassed',profitability_guard_passed,'version',version,'updatedAt',updated_at)"#)
        .bind(tenant).bind(branch).bind(id).bind(version).bind(actor).bind(manager_score).bind(strengths).bind(improvement).bind(goals).bind(comments).bind(coaching_goal_id).bind(incentive_amount_paise).bind(incentive_evidence).bind(contribution_profit_paise).fetch_optional(db).await
}

pub async fn calibrate_appraisal(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    score: i32,
    comments: &str,
    version: i32,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"UPDATE staff_performance_reviews review SET calibrated_score=$6,calibration_comments=$7,calibrated_by=$5,calibrated_at=NOW(),status='approval_pending',last_actor_user_id=$5,version=version+1,updated_at=NOW() WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.id=$3 AND review.version=$4 AND review.status='calibration' AND EXISTS(SELECT 1 FROM staff_appraisal_cycles cycle WHERE cycle.tenant_id=$1 AND cycle.branch_id=$2 AND cycle.id=review.appraisal_cycle_id AND cycle.status='calibration') RETURNING JSONB_BUILD_OBJECT('id',id,'staffId',staff_id,'status',status,'calibratedScore',calibrated_score,'version',version,'updatedAt',updated_at)"#)
        .bind(tenant).bind(branch).bind(id).bind(version).bind(actor).bind(score).bind(comments).fetch_optional(db).await
}

pub async fn approve_appraisal(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    rating: &str,
    version: i32,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"UPDATE staff_performance_reviews review SET final_score=calibrated_score,final_rating=$6,approved_by=$5,approved_at=NOW(),status='approved',shared_at=NOW(),last_actor_user_id=$5,version=version+1,updated_at=NOW() WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.id=$3 AND review.version=$4 AND review.status='approval_pending' AND review.calibrated_score IS NOT NULL AND review.profitability_guard_passed=TRUE AND EXISTS(SELECT 1 FROM staff_appraisal_cycles cycle WHERE cycle.tenant_id=$1 AND cycle.branch_id=$2 AND cycle.id=review.appraisal_cycle_id AND cycle.status='calibration') RETURNING JSONB_BUILD_OBJECT('id',id,'staffId',staff_id,'status',status,'finalScore',final_score,'finalRating',final_rating,'version',version,'updatedAt',updated_at)"#)
        .bind(tenant).bind(branch).bind(id).bind(version).bind(actor).bind(rating).fetch_optional(db).await
}

pub async fn appraisal_calibrated_score(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<i32>, sqlx::Error> {
    sqlx::query_scalar::<_, i32>("SELECT calibrated_score FROM staff_performance_reviews WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='approval_pending' AND calibrated_score IS NOT NULL AND profitability_guard_passed=TRUE")
        .bind(tenant).bind(branch).bind(id).fetch_optional(db).await
}

pub async fn acknowledge_appraisal(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    user_id: &str,
    version: i32,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"UPDATE staff_performance_reviews review SET status='acknowledged',employee_comments=CASE WHEN employee_comments='' THEN self_comments ELSE employee_comments END,acknowledged_at=NOW(),last_actor_user_id=$4,version=version+1,updated_at=NOW() WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.id=$3 AND review.version=$5 AND review.status='approved' AND EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=review.staff_id AND user_id=$4) RETURNING JSONB_BUILD_OBJECT('id',id,'staffId',staff_id,'status',status,'acknowledgedAt',acknowledged_at,'version',version,'updatedAt',updated_at)"#)
        .bind(tenant).bind(branch).bind(id).bind(user_id).bind(version).fetch_optional(db).await
}

pub async fn promotion_readiness_report(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
          'generatedAt',NOW(),'humanApprovalRequired',TRUE,'transactionalWritesPerformed',FALSE,
          'thresholds',JSONB_BUILD_OBJECT('promotionReadyScore',85,'minimumEvidenceCoverage',75),
          'items',COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
            'planId',plan.id,'roleTitle',plan.role_title,'targetRoleId',plan.target_role_id,'targetRoleName',role.name,
            'criticalRole',plan.critical_role,'planStatus',plan.status,'candidateId',candidate.id,
            'staffId',candidate.staff_id,'staffName',TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),
            'readiness',candidate.readiness,'readinessScore',candidate.readiness_score,
            'evidenceCoveragePercent',candidate.evidence_coverage_percent,'signals',candidate.signal_snapshot_json,
            'evidence',candidate.evidence_json,'developmentActions',candidate.development_actions_json,
            'nominationStatus',candidate.status,'nominatedBy',candidate.nominated_by,'approvedBy',candidate.approved_by,
            'approvedAt',candidate.approved_at,'decisionNote',candidate.decision_note,
            'promotionReady',(candidate.status='approved' AND candidate.readiness_score>=85 AND candidate.evidence_coverage_percent>=75),
            'requiresSeparatePromotionApproval',TRUE,'version',candidate.version,'calculatedAt',candidate.calculated_at,
            'history',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('action',history.action,'actorUserId',history.actor_user_id,
              'createdAt',history.created_at) ORDER BY history.id) FROM staff_succession_history history
              WHERE history.tenant_id=candidate.tenant_id AND history.branch_id=candidate.branch_id
                AND history.candidate_id=candidate.id),'[]'::JSONB)
          ) ORDER BY plan.critical_role DESC,plan.role_title,candidate.readiness_score DESC),'[]'::JSONB)
        ) FROM staff_succession_candidates candidate
        JOIN staff_succession_plans plan ON plan.tenant_id=candidate.tenant_id AND plan.branch_id=candidate.branch_id AND plan.id=candidate.plan_id
        JOIN staff ON staff.tenant_id=candidate.tenant_id AND staff.branch_id=candidate.branch_id AND staff.id=candidate.staff_id
        LEFT JOIN roles role ON role.tenant_id=plan.tenant_id AND role.id=plan.target_role_id
        WHERE candidate.tenant_id=$1 AND candidate.branch_id=$2"#,
    )
    .bind(tenant)
    .bind(branch)
    .fetch_one(db)
    .await
}

pub async fn create_succession_plan(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    role_title: &str,
    target_role_id: Option<&str>,
    critical_role: bool,
    incumbent_staff_id: Option<&str>,
    target_date: Option<chrono::NaiveDate>,
    notes: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row: Option<Value> = sqlx::query_scalar(r#"INSERT INTO staff_succession_plans(tenant_id,branch_id,role_title,target_role_id,critical_role,incumbent_staff_id,target_date,notes,created_by)
      SELECT $1,$2,$4,NULLIF($5,''),$6,NULLIF($7,''),$8,$9,$3
      WHERE (NULLIF($5,'') IS NULL OR EXISTS(SELECT 1 FROM roles WHERE tenant_id=$1 AND id=$5))
        AND (NULLIF($7,'') IS NULL OR EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$7))
      RETURNING JSONB_BUILD_OBJECT('id',id,'roleTitle',role_title,'targetRoleId',target_role_id,'criticalRole',critical_role,
        'incumbentStaffId',incumbent_staff_id,'targetDate',target_date,'notes',notes,'status',status,'version',version,'createdAt',created_at)"#)
        .bind(tenant).bind(branch).bind(actor).bind(role_title).bind(target_role_id.unwrap_or(""))
        .bind(critical_role).bind(incumbent_staff_id.unwrap_or("")).bind(target_date).bind(notes)
        .fetch_optional(&mut *tx).await?;
    if let Some(ref snapshot) = row {
        sqlx::query("INSERT INTO staff_succession_history(tenant_id,branch_id,plan_id,action,actor_user_id,snapshot_json) VALUES($1,$2,$3,'plan_created',$4,$5)")
            .bind(tenant).bind(branch).bind(snapshot["id"].as_str().unwrap_or("")).bind(actor).bind(snapshot).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(row)
}

pub async fn close_succession_plan(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    version: i32,
    closure_note: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row: Option<Value> = sqlx::query_scalar(r#"UPDATE staff_succession_plans plan SET status='closed',closed_by=$5,closed_at=NOW(),closure_note=$6,version=version+1,updated_at=NOW()
      WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='active' AND version=$4
        AND EXISTS(SELECT 1 FROM staff_succession_candidates candidate WHERE candidate.tenant_id=$1 AND candidate.branch_id=$2 AND candidate.plan_id=plan.id AND candidate.status='approved')
        AND NOT EXISTS(SELECT 1 FROM staff_succession_candidates candidate WHERE candidate.tenant_id=$1 AND candidate.branch_id=$2 AND candidate.plan_id=plan.id AND candidate.status='proposed')
      RETURNING JSONB_BUILD_OBJECT('id',id,'status',status,'closedBy',closed_by,'closedAt',closed_at,'closureNote',closure_note,'version',version,'updatedAt',updated_at)"#)
        .bind(tenant).bind(branch).bind(id).bind(version).bind(actor).bind(closure_note).fetch_optional(&mut *tx).await?;
    if let Some(ref snapshot) = row {
        sqlx::query("INSERT INTO staff_succession_history(tenant_id,branch_id,plan_id,action,actor_user_id,snapshot_json) VALUES($1,$2,$3,'plan_closed',$4,$5)")
            .bind(tenant).bind(branch).bind(id).bind(actor).bind(snapshot).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(row)
}

pub async fn create_succession_candidate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    plan_id: &str,
    staff_id: &str,
    evidence: &Value,
    actions: &Value,
) -> Result<Option<Value>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row: Option<Value> = sqlx::query_scalar(r#"WITH eligible AS (
      SELECT plan.id plan_id,staff.id staff_id,staff_succession_signal_snapshot($1,$2,$4,$5) signals
      FROM staff_succession_plans plan JOIN staff ON staff.tenant_id=plan.tenant_id AND staff.branch_id=plan.branch_id
        AND staff.id=$5 AND staff.active=TRUE
      WHERE plan.tenant_id=$1 AND plan.branch_id=$2 AND plan.id=$4 AND plan.status='active'
    ) INSERT INTO staff_succession_candidates(tenant_id,branch_id,plan_id,staff_id,readiness,readiness_score,
        evidence_json,development_actions_json,signal_snapshot_json,evidence_coverage_percent,calculated_at,created_by,nominated_by)
      SELECT $1,$2,plan_id,staff_id,signals->>'readiness',(signals->>'score')::INTEGER,$6,$7,signals,
        (signals->>'coveragePercent')::INTEGER,NOW(),$3,$3 FROM eligible
      RETURNING JSONB_BUILD_OBJECT('id',id,'planId',plan_id,'staffId',staff_id,'readiness',readiness,
        'readinessScore',readiness_score,'evidenceCoveragePercent',evidence_coverage_percent,'signals',signal_snapshot_json,
        'evidence',evidence_json,'developmentActions',development_actions_json,'status',status,'nominatedBy',nominated_by,
        'version',version,'createdAt',created_at)"#)
        .bind(tenant).bind(branch).bind(actor).bind(plan_id).bind(staff_id).bind(evidence).bind(actions)
        .fetch_optional(&mut *tx).await?;
    if let Some(ref snapshot) = row {
        sqlx::query("INSERT INTO staff_succession_history(tenant_id,branch_id,plan_id,candidate_id,action,actor_user_id,snapshot_json) VALUES($1,$2,$3,$4,'candidate_nominated',$5,$6)")
            .bind(tenant).bind(branch).bind(plan_id).bind(snapshot["id"].as_str().unwrap_or(""))
            .bind(actor).bind(snapshot).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(row)
}

pub async fn update_succession_candidate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    status: &str,
    evidence: &Value,
    actions: &Value,
    version: i32,
) -> Result<Option<Value>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row: Option<Value> = sqlx::query_scalar(r#"WITH current AS (
      SELECT candidate.*,staff_succession_signal_snapshot($1,$2,candidate.plan_id,candidate.staff_id) signals
      FROM staff_succession_candidates candidate
      WHERE candidate.tenant_id=$1 AND candidate.branch_id=$2 AND candidate.id=$3 AND candidate.version=$7 AND candidate.status='proposed'
    ) UPDATE staff_succession_candidates candidate SET status=$4,readiness=current.signals->>'readiness',
      readiness_score=(current.signals->>'score')::INTEGER,evidence_json=$5,development_actions_json=$6,
      signal_snapshot_json=current.signals,evidence_coverage_percent=(current.signals->>'coveragePercent')::INTEGER,
      calculated_at=NOW(),version=candidate.version+1,updated_at=NOW()
      FROM current WHERE candidate.id=current.id
      RETURNING JSONB_BUILD_OBJECT('id',candidate.id,'planId',candidate.plan_id,'staffId',candidate.staff_id,
        'status',candidate.status,'readiness',candidate.readiness,'readinessScore',candidate.readiness_score,
        'evidenceCoveragePercent',candidate.evidence_coverage_percent,'signals',candidate.signal_snapshot_json,
        'evidence',candidate.evidence_json,'developmentActions',candidate.development_actions_json,
        'version',candidate.version,'updatedAt',candidate.updated_at)"#)
        .bind(tenant).bind(branch).bind(id).bind(status).bind(evidence).bind(actions).bind(version)
        .fetch_optional(&mut *tx).await?;
    if let Some(ref snapshot) = row {
        sqlx::query("INSERT INTO staff_succession_history(tenant_id,branch_id,plan_id,candidate_id,action,actor_user_id,snapshot_json) VALUES($1,$2,$3,$4,$5,$6,$7)")
            .bind(tenant).bind(branch).bind(snapshot["planId"].as_str().unwrap_or(""))
            .bind(id).bind(if status=="removed" {"candidate_removed"} else {"candidate_refreshed"})
            .bind(actor).bind(snapshot).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(row)
}

pub async fn decide_succession_candidate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    decision: &str,
    note: &str,
    version: i32,
) -> Result<Option<Value>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row: Option<Value> = sqlx::query_scalar(r#"UPDATE staff_succession_candidates candidate SET status=$5,
      approved_by=CASE WHEN $5='approved' THEN $4 ELSE NULL END,approved_at=CASE WHEN $5='approved' THEN NOW() ELSE NULL END,
      decision_note=$6,version=version+1,updated_at=NOW()
      WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$7 AND status='proposed'
        AND nominated_by<>$4 AND ($5<>'approved' OR evidence_coverage_percent>=50)
      RETURNING JSONB_BUILD_OBJECT('id',id,'planId',plan_id,'staffId',staff_id,'status',status,
        'readiness',readiness,'readinessScore',readiness_score,'evidenceCoveragePercent',evidence_coverage_percent,
        'signals',signal_snapshot_json,'approvedBy',approved_by,'approvedAt',approved_at,'decisionNote',decision_note,
        'version',version,'updatedAt',updated_at)"#)
        .bind(tenant).bind(branch).bind(id).bind(actor).bind(decision).bind(note).bind(version)
        .fetch_optional(&mut *tx).await?;
    if let Some(ref snapshot) = row {
        sqlx::query("INSERT INTO staff_succession_history(tenant_id,branch_id,plan_id,candidate_id,action,actor_user_id,snapshot_json) VALUES($1,$2,$3,$4,$5,$6,$7)")
            .bind(tenant).bind(branch).bind(snapshot["planId"].as_str().unwrap_or(""))
            .bind(id).bind(if decision=="approved" {"candidate_approved"} else {"candidate_rejected"})
            .bind(actor).bind(snapshot).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(row)
}
