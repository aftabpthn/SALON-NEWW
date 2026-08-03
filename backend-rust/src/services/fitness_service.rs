use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{
    models::common::AppError,
    services::{benefit_notification_service, security_service},
    state::AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueueInput {
    pub client_id: String,
    pub service_ids: Vec<String>,
    pub requested_staff_id: Option<String>,
    pub priority: Option<i32>,
    pub notes: Option<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueueActionInput {
    pub status: String,
    pub assigned_staff_id: Option<String>,
    pub expected_version: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClassTemplateInput {
    pub name: String,
    pub service_id: String,
    pub duration_minutes: i32,
    pub capacity: i32,
    pub waitlist_capacity: Option<i32>,
    pub room_resource_id: Option<String>,
    pub late_booking_minutes: Option<i32>,
    pub late_cancel_minutes: Option<i32>,
    pub late_cancel_fee_paise: Option<i64>,
    pub no_show_fee_paise: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClassSessionInput {
    pub template_id: String,
    pub instructor_staff_id: String,
    pub room_resource_id: Option<String>,
    pub starts_at: DateTime<Utc>,
    pub frequency: Option<String>,
    pub count: Option<i32>,
    pub idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegistrationInput {
    pub client_id: String,
    pub client_membership_id: Option<String>,
    pub client_package_credit_id: Option<String>,
    pub notes: Option<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegistrationActionInput {
    pub status: String,
    pub expected_version: i32,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AmenityInput {
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LockerAssignmentInput {
    pub client_id: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChallengeInput {
    pub name: String,
    pub starts_on: NaiveDate,
    pub ends_on: NaiveDate,
    pub target_value: f64,
    pub metric: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChallengeParticipantInput {
    pub client_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KioskDeviceInput {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KioskCheckInInput {
    pub client_code_or_phone: String,
    pub session_id: String,
}

pub async fn summary(state: &AppState, tenant: &str, branch: &str) -> Result<Value, AppError> {
    sqlx::query_scalar(
        "SELECT jsonb_build_object(
          'queue',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id',q.id,'clientId',q.client_id,'clientName',BTRIM(CONCAT(c.first_name,' ',c.last_name)),
            'serviceIds',q.service_ids_json,'requestedStaffId',q.requested_staff_id,'assignedStaffId',q.assigned_staff_id,
            'priority',q.priority,'durationMinutes',q.duration_minutes,'status',q.status,
            'estimatedStartAt',q.estimated_start_at,'checkedInAt',q.checked_in_at,'notes',q.notes,'version',q.version
          ) ORDER BY q.priority DESC,q.checked_in_at,q.id) FROM walk_in_queue_entries q JOIN clients c ON c.id=q.client_id
            WHERE q.tenant_id=$1 AND q.branch_id=$2 AND q.status IN ('waiting','called','in_service')),'[]'::JSONB),
          'classTemplates',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id',t.id,'name',t.name,'serviceId',t.service_id,'durationMinutes',t.duration_minutes,
            'capacity',t.capacity,'waitlistCapacity',t.waitlist_capacity,'roomResourceId',t.room_resource_id,'active',t.active
          ) ORDER BY t.name) FROM fitness_class_templates t WHERE t.tenant_id=$1 AND t.branch_id=$2 AND t.active),'[]'::JSONB),
          'classSessions',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id',s.id,'templateId',s.template_id,'name',t.name,'instructorStaffId',s.instructor_staff_id,
            'instructorName',COALESCE(NULLIF(st.appointment_display_name,''),BTRIM(CONCAT(st.first_name,' ',st.last_name))),
            'roomResourceId',s.room_resource_id,'startsAt',s.starts_at,'endsAt',s.ends_at,'capacity',s.capacity,'status',s.status,
            'bookedCount',(SELECT COUNT(*) FROM fitness_class_registrations r WHERE r.session_id=s.id AND r.status IN ('booked','checked_in','attended')),
            'waitlistCount',(SELECT COUNT(*) FROM fitness_class_registrations r WHERE r.session_id=s.id AND r.status='waitlisted')
          ) ORDER BY s.starts_at) FROM fitness_class_sessions s JOIN fitness_class_templates t ON t.id=s.template_id
             JOIN staff st ON st.id=s.instructor_staff_id WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.starts_at>=NOW()-INTERVAL '1 day'),'[]'::JSONB),
          'amenities',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'kind',a.kind,'active',a.active) ORDER BY a.kind,a.name)
            FROM fitness_amenities a WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.active),'[]'::JSONB),
          'challenges',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ch.id,'name',ch.name,'startsOn',ch.starts_on,'endsOn',ch.ends_on,
            'targetValue',ch.target_value,'metric',ch.metric,'status',ch.status,'participants',(SELECT COUNT(*) FROM fitness_challenge_participants p WHERE p.challenge_id=ch.id)) ORDER BY ch.starts_on DESC)
            FROM fitness_challenges ch WHERE ch.tenant_id=$1 AND ch.branch_id=$2),'[]'::JSONB)
        )",
    )
    .bind(tenant)
    .bind(branch)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load queue and fitness workspace"))
}

pub async fn create_queue_entry(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    input: &QueueInput,
) -> Result<Value, AppError> {
    validate_key(&input.idempotency_key)?;
    if input.service_ids.is_empty() {
        return Err(AppError::validation("at least one service is required"));
    }
    let (service_count, duration): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*),COALESCE(SUM(duration_minutes),0) FROM services
          WHERE tenant_id=$1 AND branch_id=$2 AND active AND id=ANY($3)",
    )
    .bind(tenant)
    .bind(branch)
    .bind(&input.service_ids)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to validate queue services"))?;
    if service_count != input.service_ids.len() as i64 || duration < 5 {
        return Err(AppError::validation(
            "one or more queue services are unavailable",
        ));
    }
    let entry = sqlx::query_scalar::<_, Value>(
        "INSERT INTO walk_in_queue_entries(tenant_id,branch_id,client_id,service_ids_json,requested_staff_id,priority,duration_minutes,notes,idempotency_key,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(tenant_id,branch_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
         RETURNING jsonb_build_object('id',id,'clientId',client_id,'serviceIds',service_ids_json,'status',status,'version',version)",
    )
    .bind(tenant)
    .bind(branch)
    .bind(&input.client_id)
    .bind(json!(input.service_ids))
    .bind(input.requested_staff_id.as_deref())
    .bind(input.priority.unwrap_or(0))
    .bind(duration as i32)
    .bind(input.notes.as_deref().unwrap_or("").trim())
    .bind(&input.idempotency_key)
    .bind(actor)
    .fetch_one(&state.db)
    .await
    .map_err(|error| write_error(error, "failed to add walk-in queue entry"))?;
    recalculate_queue(&state.db, tenant, branch).await?;
    audit(
        state,
        tenant,
        branch,
        actor,
        "fitness.queue.created",
        &entry,
    )
    .await?;
    Ok(entry)
}

pub async fn update_queue_entry(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    input: &QueueActionInput,
) -> Result<Value, AppError> {
    let current = sqlx::query(
        "SELECT status FROM walk_in_queue_entries WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load queue entry"))?
    .ok_or_else(|| AppError::not_found("queue entry not found"))?;
    let old: String = current.try_get("status").unwrap_or_default();
    if !queue_transition_allowed(&old, &input.status) {
        return Err(AppError::conflict("invalid queue status transition"));
    }
    let entry = sqlx::query_scalar::<_, Value>(
        "UPDATE walk_in_queue_entries SET status=$4,assigned_staff_id=COALESCE($5,assigned_staff_id),
           called_at=CASE WHEN $4='called' THEN NOW() ELSE called_at END,
           started_at=CASE WHEN $4='in_service' THEN NOW() ELSE started_at END,
           completed_at=CASE WHEN $4='completed' THEN NOW() ELSE completed_at END,
           version=version+1,updated_at=NOW()
         WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$6
         RETURNING jsonb_build_object('id',id,'status',status,'assignedStaffId',assigned_staff_id,'version',version)",
    )
    .bind(tenant).bind(branch).bind(id).bind(&input.status).bind(input.assigned_staff_id.as_deref()).bind(input.expected_version)
    .fetch_optional(&state.db).await.map_err(|error| write_error(error, "failed to update queue entry"))?
    .ok_or_else(|| AppError::conflict("queue entry changed; reload and retry"))?;
    recalculate_queue(&state.db, tenant, branch).await?;
    audit(
        state,
        tenant,
        branch,
        actor,
        "fitness.queue.status_changed",
        &entry,
    )
    .await?;
    Ok(entry)
}

pub async fn create_class_template(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    input: &ClassTemplateInput,
) -> Result<Value, AppError> {
    if input.name.trim().is_empty()
        || !(10..=480).contains(&input.duration_minutes)
        || !(1..=1000).contains(&input.capacity)
    {
        return Err(AppError::validation(
            "class name, duration, or capacity is invalid",
        ));
    }
    let row = sqlx::query_scalar::<_, Value>(
        "INSERT INTO fitness_class_templates(tenant_id,branch_id,name,service_id,duration_minutes,capacity,waitlist_capacity,room_resource_id,late_booking_minutes,late_cancel_minutes,late_cancel_fee_paise,no_show_fee_paise,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING jsonb_build_object('id',id,'name',name,'serviceId',service_id,'durationMinutes',duration_minutes,'capacity',capacity,'waitlistCapacity',waitlist_capacity)",
    )
    .bind(tenant).bind(branch).bind(input.name.trim()).bind(&input.service_id).bind(input.duration_minutes).bind(input.capacity)
    .bind(input.waitlist_capacity.unwrap_or(input.capacity)).bind(input.room_resource_id.as_deref())
    .bind(input.late_booking_minutes.unwrap_or(0)).bind(input.late_cancel_minutes.unwrap_or(0))
    .bind(input.late_cancel_fee_paise.unwrap_or(0)).bind(input.no_show_fee_paise.unwrap_or(0)).bind(actor)
    .fetch_one(&state.db).await.map_err(|error| write_error(error, "failed to create class template"))?;
    audit(
        state,
        tenant,
        branch,
        actor,
        "fitness.class_template.created",
        &row,
    )
    .await?;
    Ok(row)
}

pub async fn create_class_sessions(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    input: &ClassSessionInput,
) -> Result<Value, AppError> {
    validate_key(&input.idempotency_key)?;
    let count = input.count.unwrap_or(1);
    if !(1..=52).contains(&count) {
        return Err(AppError::validation(
            "recurrence count must be between 1 and 52",
        ));
    }
    let frequency = input.frequency.as_deref().unwrap_or("none");
    if !matches!(frequency, "none" | "daily" | "weekly") || (frequency == "none" && count != 1) {
        return Err(AppError::validation("class recurrence is invalid"));
    }
    let existing = sqlx::query_scalar::<_, Value>(
        "SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'startsAt',starts_at,'endsAt',ends_at,'status',status) ORDER BY starts_at),'[]'::JSONB)
           FROM fitness_class_sessions WHERE tenant_id=$1 AND branch_id=$2 AND recurrence_key LIKE $3",
    ).bind(tenant).bind(branch).bind(format!("{}:%", input.idempotency_key)).fetch_one(&state.db).await
      .map_err(|_| AppError::internal("failed to check class idempotency"))?;
    if existing.as_array().is_some_and(|rows| !rows.is_empty()) {
        return Ok(existing);
    }

    let template = sqlx::query("SELECT service_id,duration_minutes,capacity,room_resource_id FROM fitness_class_templates WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active")
        .bind(tenant).bind(branch).bind(&input.template_id).fetch_optional(&state.db).await
        .map_err(|_| AppError::internal("failed to load class template"))?
        .ok_or_else(|| AppError::not_found("active class template not found"))?;
    let service_id: String = template.try_get("service_id").unwrap_or_default();
    let duration_minutes: i32 = template.try_get("duration_minutes").unwrap_or(0);
    let capacity: i32 = template.try_get("capacity").unwrap_or(0);
    let default_room: Option<String> = template.try_get("room_resource_id").ok();
    let room = input.room_resource_id.clone().or(default_room);
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start class schedule"))?;
    let mut rows = Vec::new();
    for index in 0..count {
        let starts_at = input.starts_at
            + match frequency {
                "daily" => Duration::days(index.into()),
                "weekly" => Duration::weeks(index.into()),
                _ => Duration::zero(),
            };
        let ends_at = starts_at + Duration::minutes(duration_minutes.into());
        let appointment_id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO appointments(id,tenant_id,branch_id,client_id,staff_id,service_ids_json,start_at,end_at,status,notes,source_channel,source,chair_room_id,version)
                     VALUES($1,$2,$3,'',$4,$5,$6,$7,'class_session','Fitness class session','fitness','fitness',$8,1)")
            .bind(&appointment_id).bind(tenant).bind(branch).bind(&input.instructor_staff_id)
            .bind(json!([service_id]).to_string()).bind(starts_at).bind(ends_at).bind(room.as_deref())
            .execute(&mut *tx).await.map_err(|error| write_error(error, "class instructor or room is not available"))?;
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO fitness_class_sessions(id,tenant_id,branch_id,template_id,appointment_id,instructor_staff_id,room_resource_id,starts_at,ends_at,capacity,recurrence_key,created_by)
                     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
            .bind(&id).bind(tenant).bind(branch).bind(&input.template_id).bind(&appointment_id).bind(&input.instructor_staff_id)
            .bind(room.as_deref()).bind(starts_at).bind(ends_at).bind(capacity).bind(format!("{}:{}", input.idempotency_key,index)).bind(actor)
            .execute(&mut *tx).await.map_err(|error| write_error(error, "failed to create class session"))?;
        rows.push(json!({"id":id,"startsAt":starts_at,"endsAt":ends_at,"status":"scheduled"}));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit class schedule"))?;
    let result = Value::Array(rows);
    audit(
        state,
        tenant,
        branch,
        actor,
        "fitness.class_sessions.created",
        &result,
    )
    .await?;
    Ok(result)
}

pub async fn register_for_class(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    session_id: &str,
    input: &RegistrationInput,
) -> Result<Value, AppError> {
    validate_key(&input.idempotency_key)?;
    if input.client_membership_id.is_some() && input.client_package_credit_id.is_some() {
        return Err(AppError::validation(
            "select membership or package credit, not both",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start class registration"))?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended(CONCAT_WS(':','fitness-class-capacity',$1,$2,$3),0))")
        .bind(tenant).bind(branch).bind(session_id).execute(&mut *tx).await
        .map_err(|_| AppError::internal("failed to lock class capacity"))?;
    let session = sqlx::query("SELECT s.starts_at,s.ends_at,s.capacity,s.status,t.waitlist_capacity,t.late_booking_minutes,t.service_id
                                FROM fitness_class_sessions s JOIN fitness_class_templates t ON t.id=s.template_id
                               WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3 FOR UPDATE")
        .bind(tenant).bind(branch).bind(session_id).fetch_optional(&mut *tx).await
        .map_err(|_| AppError::internal("failed to load class session"))?
        .ok_or_else(|| AppError::not_found("class session not found"))?;
    let starts_at: DateTime<Utc> = session
        .try_get("starts_at")
        .map_err(|_| AppError::internal("invalid class start"))?;
    let ends_at: DateTime<Utc> = session
        .try_get("ends_at")
        .map_err(|_| AppError::internal("invalid class end"))?;
    let late_booking_minutes: i32 = session.try_get("late_booking_minutes").unwrap_or(0);
    if session.try_get::<String, _>("status").unwrap_or_default() != "scheduled"
        || Utc::now() > starts_at + Duration::minutes(late_booking_minutes.into())
        || Utc::now() >= ends_at
    {
        return Err(AppError::conflict("class is closed for booking"));
    }
    let service_id: String = session.try_get("service_id").unwrap_or_default();
    validate_entitlement(
        &mut tx,
        tenant,
        branch,
        &input.client_id,
        input.client_membership_id.as_deref(),
        input.client_package_credit_id.as_deref(),
        &service_id,
    )
    .await?;
    let booked: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fitness_class_registrations WHERE tenant_id=$1 AND branch_id=$2 AND session_id=$3 AND status IN ('booked','checked_in','attended')")
        .bind(tenant).bind(branch).bind(session_id).fetch_one(&mut *tx).await.map_err(|_| AppError::internal("failed to count class roster"))?;
    let capacity: i32 = session.try_get("capacity").unwrap_or(0);
    let waitlist_capacity: i32 = session.try_get("waitlist_capacity").unwrap_or(0);
    let (status, waitlist_position) = if booked < capacity as i64 {
        ("booked", None)
    } else {
        let waiting: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fitness_class_registrations WHERE tenant_id=$1 AND branch_id=$2 AND session_id=$3 AND status='waitlisted'")
            .bind(tenant).bind(branch).bind(session_id).fetch_one(&mut *tx).await.map_err(|_| AppError::internal("failed to count class waitlist"))?;
        if waiting >= waitlist_capacity as i64 {
            return Err(AppError::conflict("class and waitlist are full"));
        }
        ("waitlisted", Some(waiting as i32 + 1))
    };
    let row = sqlx::query_scalar::<_,Value>("INSERT INTO fitness_class_registrations(tenant_id,branch_id,session_id,client_id,status,waitlist_position,client_membership_id,client_package_credit_id,notes,idempotency_key,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(tenant_id,branch_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
        RETURNING jsonb_build_object('id',id,'sessionId',session_id,'clientId',client_id,'status',status,'waitlistPosition',waitlist_position,'version',version)")
        .bind(tenant).bind(branch).bind(session_id).bind(&input.client_id).bind(status).bind(waitlist_position)
        .bind(input.client_membership_id.as_deref()).bind(input.client_package_credit_id.as_deref()).bind(input.notes.as_deref().unwrap_or("").trim())
        .bind(&input.idempotency_key).bind(actor).fetch_one(&mut *tx).await.map_err(|error|write_error(error,"failed to register class guest"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit class registration"))?;
    audit(
        state,
        tenant,
        branch,
        actor,
        "fitness.class_registration.created",
        &row,
    )
    .await?;
    Ok(row)
}

pub async fn update_registration(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    input: &RegistrationActionInput,
) -> Result<Value, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start class action"))?;
    let current = sqlx::query("SELECT r.status,r.session_id,r.client_id,r.client_package_credit_id,r.credit_consumed_at,s.starts_at,s.ends_at,t.late_cancel_minutes,t.late_cancel_fee_paise,t.no_show_fee_paise,s.appointment_id
        FROM fitness_class_registrations r JOIN fitness_class_sessions s ON s.id=r.session_id JOIN fitness_class_templates t ON t.id=s.template_id
        WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.id=$3 FOR UPDATE")
        .bind(tenant).bind(branch).bind(id).fetch_optional(&mut *tx).await.map_err(|_|AppError::internal("failed to load class registration"))?
        .ok_or_else(||AppError::not_found("class registration not found"))?;
    let old: String = current.try_get("status").unwrap_or_default();
    let mut next = input.status.as_str();
    if next == "cancelled" && old != "waitlisted" {
        let starts: DateTime<Utc> = current
            .try_get("starts_at")
            .map_err(|_| AppError::internal("invalid class start"))?;
        let cutoff: i32 = current.try_get("late_cancel_minutes").unwrap_or(0);
        if cutoff > 0 && Utc::now() > starts - Duration::minutes(cutoff.into()) {
            next = "late_cancel";
        }
    }
    if !registration_transition_allowed(&old, next) {
        return Err(AppError::conflict("invalid class registration transition"));
    }
    if next == "attended" {
        if let Some(credit_id) = current
            .try_get::<Option<String>, _>("client_package_credit_id")
            .ok()
            .flatten()
        {
            if current
                .try_get::<Option<DateTime<Utc>>, _>("credit_consumed_at")
                .ok()
                .flatten()
                .is_none()
            {
                let consumed=sqlx::query("UPDATE client_package_credits SET remaining_qty=remaining_qty-1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND remaining_qty>0 AND active")
                    .bind(tenant).bind(branch).bind(&credit_id).execute(&mut *tx).await.map_err(|_|AppError::internal("failed to consume class credit"))?;
                if consumed.rows_affected() != 1 {
                    return Err(AppError::conflict("package credit is no longer available"));
                }
            }
        }
    }
    let row=sqlx::query_scalar::<_,Value>("UPDATE fitness_class_registrations SET status=$4,
        checked_in_at=CASE WHEN $4='checked_in' THEN NOW() ELSE checked_in_at END,
        attended_at=CASE WHEN $4='attended' THEN NOW() ELSE attended_at END,
        cancelled_at=CASE WHEN $4 IN ('cancelled','late_cancel','no_show') THEN NOW() ELSE cancelled_at END,
        credit_consumed_at=CASE WHEN $4='attended' AND client_package_credit_id IS NOT NULL THEN COALESCE(credit_consumed_at,NOW()) ELSE credit_consumed_at END,
        version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$5
        RETURNING jsonb_build_object('id',id,'sessionId',session_id,'clientId',client_id,'status',status,'version',version)")
        .bind(tenant).bind(branch).bind(id).bind(next).bind(input.expected_version).fetch_optional(&mut *tx).await
        .map_err(|error|write_error(error,"failed to update class registration"))?.ok_or_else(||AppError::conflict("class registration changed; reload and retry"))?;
    if matches!(next, "late_cancel" | "no_show") {
        let amount: i64 = if next == "late_cancel" {
            current.try_get("late_cancel_fee_paise").unwrap_or(0)
        } else {
            current.try_get("no_show_fee_paise").unwrap_or(0)
        };
        if amount > 0 {
            sqlx::query("INSERT INTO fitness_class_fee_events(tenant_id,branch_id,registration_id,fee_type,amount_paise,status,reason,actor_user_id,idempotency_key)
          VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8) ON CONFLICT(tenant_id,branch_id,registration_id,fee_type) DO NOTHING")
          .bind(tenant).bind(branch).bind(id).bind(next).bind(amount).bind(input.reason.as_deref().unwrap_or("").trim()).bind(actor).bind(format!("class-fee:{id}:{next}"))
          .execute(&mut *tx).await.map_err(|_|AppError::internal("failed to record class fee"))?;
        }
    }
    let session_id: String = current.try_get("session_id").unwrap_or_default();
    let promoted = if matches!(next, "cancelled" | "late_cancel") {
        promote_next_waitlisted(&mut tx, tenant, branch, &session_id).await?
    } else {
        None
    };
    if next == "attended" {
        update_challenge_progress(
            &mut tx,
            tenant,
            branch,
            current
                .try_get::<String, _>("client_id")
                .unwrap_or_default()
                .as_str(),
            &session_id,
        )
        .await?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit class action"))?;
    if let Some((registration_id, client_id)) = promoted {
        let appointment_id: String = current.try_get("appointment_id").unwrap_or_default();
        let _ = benefit_notification_service::queue_appointment_event(
            state,
            tenant,
            branch,
            &appointment_id,
            &client_id,
            1,
            "BOOKED",
        )
        .await;
        audit(
            state,
            tenant,
            branch,
            actor,
            "fitness.class_waitlist.promoted",
            &json!({"registrationId":registration_id,"sessionId":session_id}),
        )
        .await?;
    }
    audit(
        state,
        tenant,
        branch,
        actor,
        "fitness.class_registration.status_changed",
        &row,
    )
    .await?;
    Ok(row)
}

pub async fn set_fee_status(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    registration_id: &str,
    status: &str,
    reason: &str,
) -> Result<Value, AppError> {
    if reason.trim().is_empty() {
        return Err(AppError::validation("fee action reason is required"));
    }
    let allowed = match status {
        "waived" => "('pending','waived')",
        "reversed" => "('charged','reversed')",
        _ => return Err(AppError::validation("fee action is invalid")),
    };
    let sql=format!("UPDATE fitness_class_fee_events SET status=$4,reason=$5,actor_user_id=$6,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND registration_id=$3 AND status IN {allowed} RETURNING jsonb_build_object('id',id,'registrationId',registration_id,'feeType',fee_type,'amountPaise',amount_paise,'status',status,'reason',reason)");
    let row = sqlx::query_scalar::<_, Value>(&sql)
        .bind(tenant)
        .bind(branch)
        .bind(registration_id)
        .bind(status)
        .bind(reason.trim())
        .bind(actor)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to update class fee"))?
        .ok_or_else(|| AppError::conflict("class fee is not in a valid state for this action"))?;
    audit(
        state,
        tenant,
        branch,
        actor,
        "fitness.class_fee.status_changed",
        &row,
    )
    .await?;
    Ok(row)
}

pub async fn create_amenity(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    input: &AmenityInput,
) -> Result<Value, AppError> {
    if input.name.trim().is_empty() || !matches!(input.kind.as_str(), "amenity" | "locker") {
        return Err(AppError::validation("amenity name or kind is invalid"));
    }
    let row=sqlx::query_scalar::<_,Value>("INSERT INTO fitness_amenities(tenant_id,branch_id,name,kind) VALUES($1,$2,$3,$4) RETURNING jsonb_build_object('id',id,'name',name,'kind',kind,'active',active)")
      .bind(tenant).bind(branch).bind(input.name.trim()).bind(&input.kind).fetch_one(&state.db).await.map_err(|error|write_error(error,"failed to create amenity"))?;
    audit(
        state,
        tenant,
        branch,
        actor,
        "fitness.amenity.created",
        &row,
    )
    .await?;
    Ok(row)
}

pub async fn assign_locker(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    locker_id: &str,
    input: &LockerAssignmentInput,
) -> Result<Value, AppError> {
    let row=sqlx::query_scalar::<_,Value>("INSERT INTO fitness_locker_assignments(tenant_id,branch_id,locker_id,client_id,session_id,assigned_by)
      SELECT $1,$2,a.id,$4,$5,$6 FROM fitness_amenities a WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.id=$3 AND a.kind='locker' AND a.active
      RETURNING jsonb_build_object('id',id,'lockerId',locker_id,'clientId',client_id,'sessionId',session_id,'assignedAt',assigned_at)")
      .bind(tenant).bind(branch).bind(locker_id).bind(&input.client_id).bind(input.session_id.as_deref()).bind(actor)
      .fetch_optional(&state.db).await.map_err(|error|write_error(error,"locker is already assigned"))?.ok_or_else(||AppError::not_found("active locker not found"))?;
    audit(
        state,
        tenant,
        branch,
        actor,
        "fitness.locker.assigned",
        &row,
    )
    .await?;
    Ok(row)
}

pub async fn release_locker(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<Value, AppError> {
    let row=sqlx::query_scalar::<_,Value>("UPDATE fitness_locker_assignments SET released_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND released_at IS NULL RETURNING jsonb_build_object('id',id,'lockerId',locker_id,'releasedAt',released_at)")
      .bind(tenant).bind(branch).bind(id).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to release locker"))?.ok_or_else(||AppError::not_found("active locker assignment not found"))?;
    audit(
        state,
        tenant,
        branch,
        actor,
        "fitness.locker.released",
        &row,
    )
    .await?;
    Ok(row)
}

pub async fn create_challenge(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    input: &ChallengeInput,
) -> Result<Value, AppError> {
    if input.name.trim().is_empty()
        || input.ends_on < input.starts_on
        || input.target_value <= 0.0
        || !matches!(
            input.metric.as_str(),
            "classes" | "visits" | "minutes" | "custom"
        )
    {
        return Err(AppError::validation("challenge configuration is invalid"));
    }
    let row=sqlx::query_scalar::<_,Value>("INSERT INTO fitness_challenges(tenant_id,branch_id,name,starts_on,ends_on,target_value,metric,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8)
      RETURNING jsonb_build_object('id',id,'name',name,'startsOn',starts_on,'endsOn',ends_on,'targetValue',target_value,'metric',metric,'status',status)")
      .bind(tenant).bind(branch).bind(input.name.trim()).bind(input.starts_on).bind(input.ends_on).bind(input.target_value).bind(&input.metric).bind(actor)
      .fetch_one(&state.db).await.map_err(|error|write_error(error,"failed to create challenge"))?;
    audit(
        state,
        tenant,
        branch,
        actor,
        "fitness.challenge.created",
        &row,
    )
    .await?;
    Ok(row)
}

pub async fn join_challenge(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    challenge_id: &str,
    input: &ChallengeParticipantInput,
) -> Result<Value, AppError> {
    let row=sqlx::query_scalar::<_,Value>("INSERT INTO fitness_challenge_participants(tenant_id,branch_id,challenge_id,client_id) SELECT $1,$2,ch.id,$4 FROM fitness_challenges ch WHERE ch.tenant_id=$1 AND ch.branch_id=$2 AND ch.id=$3 AND ch.status='active'
      ON CONFLICT(tenant_id,branch_id,challenge_id,client_id) DO UPDATE SET client_id=EXCLUDED.client_id RETURNING jsonb_build_object('id',id,'challengeId',challenge_id,'clientId',client_id,'progressValue',progress_value)")
      .bind(tenant).bind(branch).bind(challenge_id).bind(&input.client_id).fetch_optional(&state.db).await.map_err(|error|write_error(error,"failed to join challenge"))?.ok_or_else(||AppError::not_found("active challenge not found"))?;
    audit(
        state,
        tenant,
        branch,
        actor,
        "fitness.challenge.joined",
        &row,
    )
    .await?;
    Ok(row)
}

pub async fn create_kiosk_device(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    input: &KioskDeviceInput,
) -> Result<Value, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::validation("kiosk name is required"));
    }
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let hash = token_hash(&token);
    let id:String=sqlx::query_scalar("INSERT INTO fitness_kiosk_devices(tenant_id,branch_id,name,token_hash,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id")
      .bind(tenant).bind(branch).bind(input.name.trim()).bind(hash).bind(actor).fetch_one(&state.db).await.map_err(|error|write_error(error,"failed to create kiosk device"))?;
    let row = json!({"id":id,"name":input.name.trim(),"token":token});
    audit(
        state,
        tenant,
        branch,
        actor,
        "fitness.kiosk_device.created",
        &json!({"id":id}),
    )
    .await?;
    Ok(row)
}

pub async fn kiosk_check_in(
    state: &AppState,
    token: &str,
    input: &KioskCheckInInput,
) -> Result<Value, AppError> {
    if token.trim().is_empty() || input.client_code_or_phone.trim().is_empty() {
        return Err(AppError::unauthenticated(
            "valid kiosk token and client code are required",
        ));
    }
    let device=sqlx::query("UPDATE fitness_kiosk_devices SET last_used_at=NOW() WHERE token_hash=$1 AND active AND revoked_at IS NULL RETURNING id,tenant_id,branch_id")
      .bind(token_hash(token)).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to validate kiosk"))?.ok_or_else(||AppError::unauthenticated("kiosk token is invalid or revoked"))?;
    let tenant: String = device.try_get("tenant_id").unwrap_or_default();
    let branch: String = device.try_get("branch_id").unwrap_or_default();
    let device_id: String = device.try_get("id").unwrap_or_default();
    let client_id:String=sqlx::query_scalar("SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND active AND (code=$3 OR phone=$3) LIMIT 1")
      .bind(&tenant).bind(&branch).bind(input.client_code_or_phone.trim()).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to identify kiosk guest"))?.ok_or_else(||AppError::not_found("guest not found"))?;
    let row=sqlx::query("SELECT r.id,r.version FROM fitness_class_registrations r JOIN fitness_class_sessions s ON s.id=r.session_id WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.session_id=$3 AND r.client_id=$4 AND r.status='booked' AND s.starts_at BETWEEN NOW()-INTERVAL '2 hours' AND NOW()+INTERVAL '12 hours'")
      .bind(&tenant).bind(&branch).bind(&input.session_id).bind(&client_id).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to load kiosk registration"))?.ok_or_else(||AppError::conflict("no eligible booked class registration was found"))?;
    let registration_id: String = row.try_get("id").unwrap_or_default();
    let version: i32 = row.try_get("version").unwrap_or(0);
    update_registration(
        state,
        &tenant,
        &branch,
        &format!("kiosk:{device_id}"),
        &registration_id,
        &RegistrationActionInput {
            status: "checked_in".into(),
            expected_version: version,
            reason: None,
        },
    )
    .await
}

pub async fn utilization_report(
    state: &AppState,
    tenant: &str,
    branch: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Value, AppError> {
    if to <= from || to - from > Duration::days(366) {
        return Err(AppError::validation(
            "report range must be between 1 minute and 366 days",
        ));
    }
    sqlx::query_scalar("SELECT jsonb_build_object(
      'queue',jsonb_build_object('total',COUNT(*) FILTER(WHERE q.id IS NOT NULL),'completed',COUNT(*) FILTER(WHERE q.status='completed'),'averageWaitMinutes',COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(q.started_at,q.called_at)-q.checked_in_at))/60) FILTER(WHERE q.called_at IS NOT NULL OR q.started_at IS NOT NULL),2),0)),
      'classes',COALESCE((SELECT jsonb_agg(row_to_json(report_row)) FROM (SELECT s.id,t.name,s.starts_at,s.capacity,COUNT(r.id) FILTER(WHERE r.status IN ('booked','checked_in','attended')) AS booked_count,COUNT(r.id) FILTER(WHERE r.status='attended') AS attended_count,ROUND(100.0*COUNT(r.id) FILTER(WHERE r.status IN ('booked','checked_in','attended'))/NULLIF(s.capacity,0),2) AS utilization_percent FROM fitness_class_sessions s JOIN fitness_class_templates t ON t.id=s.template_id LEFT JOIN fitness_class_registrations r ON r.session_id=s.id WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.starts_at>=$3 AND s.starts_at<$4 GROUP BY s.id,t.name,s.starts_at,s.capacity ORDER BY s.starts_at) report_row),'[]'::JSONB),
      'from',$3,'to',$4) FROM walk_in_queue_entries q WHERE q.tenant_id=$1 AND q.branch_id=$2 AND q.checked_in_at>=$3 AND q.checked_in_at<$4")
      .bind(tenant).bind(branch).bind(from).bind(to).fetch_one(&state.db).await.map_err(|_|AppError::internal("failed to build queue and class utilization report"))
}

async fn recalculate_queue(
    pool: &sqlx::PgPool,
    tenant: &str,
    branch: &str,
) -> Result<(), AppError> {
    sqlx::query("WITH ordered AS (SELECT id,SUM(duration_minutes) OVER(PARTITION BY COALESCE(assigned_staff_id,requested_staff_id,'any') ORDER BY priority DESC,checked_in_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS minutes_before FROM walk_in_queue_entries WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('waiting','called')) UPDATE walk_in_queue_entries q SET estimated_start_at=date_trunc('minute',NOW())+make_interval(mins=>COALESCE(ordered.minutes_before,0)::INT),updated_at=NOW() FROM ordered WHERE q.id=ordered.id")
      .bind(tenant).bind(branch).execute(pool).await.map_err(|_|AppError::internal("failed to recalculate walk-in queue"))?;
    Ok(())
}

async fn validate_entitlement(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    client: &str,
    membership: Option<&str>,
    credit: Option<&str>,
    service: &str,
) -> Result<(), AppError> {
    if let Some(id) = membership {
        let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND client_id=$4 AND active AND (expires_at IS NULL OR expires_at>NOW()))").bind(tenant).bind(branch).bind(id).bind(client).fetch_one(&mut **tx).await.map_err(|_|AppError::internal("failed to validate membership"))?;
        if !valid {
            return Err(AppError::conflict(
                "membership is not eligible for this class",
            ));
        }
    }
    if let Some(id) = credit {
        let remaining:i32=sqlx::query_scalar("SELECT remaining_qty FROM client_package_credits WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND client_id=$4 AND service_id=$5 AND active AND remaining_qty>0 AND (expires_at IS NULL OR expires_at>=CURRENT_DATE) FOR UPDATE")
            .bind(tenant).bind(branch).bind(id).bind(client).bind(service).fetch_optional(&mut **tx).await
            .map_err(|_|AppError::internal("failed to validate package credit"))?.unwrap_or(0);
        let reserved:i64=sqlx::query_scalar("SELECT COUNT(*) FROM fitness_class_registrations WHERE tenant_id=$1 AND branch_id=$2 AND client_package_credit_id=$3 AND status IN ('booked','checked_in') AND credit_consumed_at IS NULL")
            .bind(tenant).bind(branch).bind(id).fetch_one(&mut **tx).await.map_err(|_|AppError::internal("failed to count class credit reservations"))?;
        if remaining as i64 <= reserved {
            return Err(AppError::conflict(
                "package credit is not eligible or already reserved",
            ));
        }
    }
    Ok(())
}

async fn promote_next_waitlisted(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    session: &str,
) -> Result<Option<(String, String)>, AppError> {
    let row=sqlx::query("UPDATE fitness_class_registrations SET status='booked',waitlist_position=NULL,version=version+1,updated_at=NOW() WHERE id=(SELECT id FROM fitness_class_registrations WHERE tenant_id=$1 AND branch_id=$2 AND session_id=$3 AND status='waitlisted' ORDER BY waitlist_position,booked_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,client_id")
      .bind(tenant).bind(branch).bind(session).fetch_optional(&mut **tx).await.map_err(|error|write_error(error,"failed to promote class waitlist"))?;
    Ok(row.map(|row| {
        (
            row.try_get("id").unwrap_or_default(),
            row.try_get("client_id").unwrap_or_default(),
        )
    }))
}

async fn update_challenge_progress(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    client: &str,
    session: &str,
) -> Result<(), AppError> {
    sqlx::query("UPDATE fitness_challenge_participants p SET progress_value=progress_value+CASE ch.metric WHEN 'minutes' THEN EXTRACT(EPOCH FROM(s.ends_at-s.starts_at))/60 ELSE 1 END,completed_at=CASE WHEN progress_value+CASE ch.metric WHEN 'minutes' THEN EXTRACT(EPOCH FROM(s.ends_at-s.starts_at))/60 ELSE 1 END>=ch.target_value THEN COALESCE(completed_at,NOW()) ELSE completed_at END FROM fitness_challenges ch,fitness_class_sessions s WHERE p.challenge_id=ch.id AND s.id=$4 AND p.tenant_id=$1 AND p.branch_id=$2 AND p.client_id=$3 AND ch.status='active' AND CURRENT_DATE BETWEEN ch.starts_on AND ch.ends_on AND ch.metric<>'custom'")
      .bind(tenant).bind(branch).bind(client).bind(session).execute(&mut **tx).await.map_err(|_|AppError::internal("failed to update challenge progress"))?;
    Ok(())
}

async fn audit(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    action: &str,
    details: &Value,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO fitness_operation_events(tenant_id,branch_id,entity_type,entity_id,action,actor_user_id,details) VALUES($1,$2,$3,$4,$5,$6,$7)")
      .bind(tenant).bind(branch).bind(action.split('.').nth(1).unwrap_or("fitness")).bind(details.get("id").and_then(Value::as_str).unwrap_or("")).bind(action).bind(actor).bind(details)
      .execute(&state.db).await.map_err(|_|AppError::internal("failed to record fitness audit"))?;
    security_service::record_audit(&state.db, tenant, branch, actor, action, details.clone()).await
}

fn validate_key(key: &str) -> Result<(), AppError> {
    if key.len() < 8
        || key.len() > 120
        || !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'))
    {
        Err(AppError::validation("idempotency key is invalid"))
    } else {
        Ok(())
    }
}
fn token_hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn write_error(error: sqlx::Error, fallback: &'static str) -> AppError {
    if error
        .as_database_error()
        .and_then(|e| e.code())
        .is_some_and(|c| matches!(c.as_ref(), "23505" | "23514" | "23P01" | "23503"))
    {
        AppError::conflict(
            error
                .as_database_error()
                .map(|e| e.message())
                .unwrap_or(fallback),
        )
    } else {
        AppError::internal(fallback)
    }
}
fn queue_transition_allowed(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("waiting", "waiting")
            | ("waiting", "called")
            | ("waiting", "cancelled")
            | ("called", "called")
            | ("called", "in_service")
            | ("called", "cancelled")
            | ("called", "no_show")
            | ("in_service", "in_service")
            | ("in_service", "completed")
    )
}
fn registration_transition_allowed(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("waitlisted", "booked")
            | ("waitlisted", "cancelled")
            | ("booked", "checked_in")
            | ("booked", "cancelled")
            | ("booked", "late_cancel")
            | ("booked", "no_show")
            | ("checked_in", "attended")
            | ("checked_in", "cancelled")
            | ("checked_in", "late_cancel")
            | ("checked_in", "no_show")
    )
}

#[cfg(test)]
mod tests {
    use super::{queue_transition_allowed, registration_transition_allowed};
    #[test]
    fn lifecycle_guards_reject_backward_or_duplicate_terminal_moves() {
        assert!(queue_transition_allowed("waiting", "called"));
        assert!(!queue_transition_allowed("completed", "waiting"));
        assert!(registration_transition_allowed("booked", "checked_in"));
        assert!(!registration_transition_allowed("attended", "booked"));
    }
}
