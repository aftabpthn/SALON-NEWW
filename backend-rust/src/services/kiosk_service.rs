use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::{FromRow, Row};
use uuid::Uuid;

use crate::{
    models::common::AppError,
    routes::appointments,
    services::{auth_service, security_service},
    state::AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceInput {
    pub name: String,
    pub admin_pin: String,
    #[serde(default)]
    pub allowed_branch_ids: Vec<String>,
    pub branding: Option<Value>,
    pub config: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceUpdateInput {
    pub name: Option<String>,
    pub selected_branch_id: Option<String>,
    pub allowed_branch_ids: Option<Vec<String>>,
    pub branding: Option<Value>,
    pub config: Option<Value>,
    pub admin_pin: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentifyInput {
    pub appointment_id: String,
    pub phone: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckInInput {
    pub idempotency_key: String,
    #[serde(default)]
    pub apply_group: bool,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub accuracy_meters: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileInput {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddOnRequestInput {
    pub add_on_id: String,
    pub idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnlockInput {
    pub pin: String,
}

#[derive(Debug, FromRow)]
struct Device {
    id: String,
    tenant_id: String,
    branch_id: String,
    selected_branch_id: String,
    allowed_branch_ids: Value,
    branding_json: Value,
    config_json: Value,
    admin_pin_hash: Option<String>,
}

#[derive(Debug, FromRow)]
struct GuestSession {
    id: String,
    tenant_id: String,
    branch_id: String,
    appointment_id: String,
    client_id: String,
}

#[derive(Debug, FromRow)]
struct BookingIdentity {
    appointment_id: String,
    client_id: String,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
    status: String,
    booking_group_id: String,
    service_ids_json: String,
    first_name_missing: bool,
    last_name_missing: bool,
    email_missing: bool,
}

pub async fn list_devices(state: &AppState, tenant: &str) -> Result<Vec<Value>, AppError> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'branchId',branch_id,'name',name,'active',active,'selectedBranchId',COALESCE(NULLIF(selected_branch_id,''),branch_id),'allowedBranchIds',allowed_branch_ids,'branding',branding_json,'config',config_json,'activatedAt',activated_at,'lastUsedAt',last_used_at,'revokedAt',revoked_at,'version',version,'createdAt',created_at,'updatedAt',updated_at) FROM fitness_kiosk_devices WHERE tenant_id=$1 ORDER BY created_at DESC")
        .bind(tenant)
        .fetch_all(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load kiosk devices"))
}

pub async fn create_device(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    input: &DeviceInput,
) -> Result<Value, AppError> {
    let name = required_text(&input.name, 120, "name")?;
    validate_pin(&input.admin_pin)?;
    let allowed = if input.allowed_branch_ids.is_empty() {
        vec![branch.to_string()]
    } else {
        unique_nonempty(&input.allowed_branch_ids)
    };
    validate_branches(state, tenant, &allowed).await?;
    if !allowed.iter().any(|value| value == branch) {
        return Err(AppError::validation("current branch must be allowed"));
    }
    let activation_code = Uuid::new_v4().simple().to_string()[..8].to_ascii_uppercase();
    let admin_pin_hash = auth_service::hash_password(input.admin_pin.trim())
        .map_err(|_| AppError::internal("failed to secure kiosk admin PIN"))?;
    let branding = normalize_branding(input.branding.as_ref())?;
    let config = normalize_config(input.config.as_ref())?;
    let id: String = sqlx::query_scalar("INSERT INTO fitness_kiosk_devices(tenant_id,branch_id,name,token_hash,activation_code_hash,activation_expires_at,admin_pin_hash,allowed_branch_ids,selected_branch_id,branding_json,config_json,created_by) VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '24 hours',$6,$7,$2,$8,$9,$10) RETURNING id")
        .bind(tenant).bind(branch).bind(&name)
        .bind(auth_service::token_hash(&Uuid::new_v4().to_string()))
        .bind(auth_service::token_hash(&activation_code)).bind(admin_pin_hash)
        .bind(json!(allowed)).bind(&branding).bind(&config).bind(actor)
        .fetch_one(&state.db).await.map_err(write_error)?;
    security_service::record_audit(
        &state.db,
        tenant,
        branch,
        actor,
        "kiosk.device.created",
        json!({"id":id}),
    )
    .await?;
    Ok(
        json!({"id":id,"name":name,"activationCode":activation_code,"activationExpiresInHours":24,"selectedBranchId":branch,"allowedBranchIds":allowed,"branding":branding,"config":config}),
    )
}

pub async fn update_device(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    input: &DeviceUpdateInput,
) -> Result<Value, AppError> {
    let existing = sqlx::query("SELECT name,selected_branch_id,allowed_branch_ids,branding_json,config_json,admin_pin_hash FROM fitness_kiosk_devices WHERE tenant_id=$1 AND id=$2 AND revoked_at IS NULL")
        .bind(tenant).bind(id).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to load kiosk device"))?
        .ok_or_else(||AppError::not_found("kiosk device was not found"))?;
    let name = match input.name.as_deref() {
        Some(value) => required_text(value, 120, "name")?,
        None => existing.try_get("name").unwrap_or_default(),
    };
    let allowed = match input.allowed_branch_ids.as_ref() {
        Some(value) => unique_nonempty(value),
        None => serde_json::from_value(
            existing
                .try_get("allowed_branch_ids")
                .unwrap_or_else(|_| json!([])),
        )
        .unwrap_or_default(),
    };
    if allowed.is_empty() {
        return Err(AppError::validation(
            "at least one allowed branch is required",
        ));
    }
    validate_branches(state, tenant, &allowed).await?;
    let existing_selected: String = existing.try_get("selected_branch_id").unwrap_or_default();
    let selected = input
        .selected_branch_id
        .as_deref()
        .unwrap_or(&existing_selected)
        .trim()
        .to_string();
    if !allowed.iter().any(|value| value == &selected) {
        return Err(AppError::validation("selected branch must be allowed"));
    }
    let branding = match input.branding.as_ref() {
        Some(value) => normalize_branding(Some(value))?,
        None => existing
            .try_get("branding_json")
            .unwrap_or_else(|_| json!({})),
    };
    let config = match input.config.as_ref() {
        Some(value) => normalize_config(Some(value))?,
        None => existing
            .try_get("config_json")
            .unwrap_or_else(|_| normalize_config(None).expect("default kiosk config is valid")),
    };
    let pin_hash = match input.admin_pin.as_deref() {
        Some(pin) => {
            validate_pin(pin)?;
            Some(
                auth_service::hash_password(pin.trim())
                    .map_err(|_| AppError::internal("failed to secure kiosk admin PIN"))?,
            )
        }
        None => existing.try_get("admin_pin_hash").ok(),
    };
    let value: Value = sqlx::query_scalar("UPDATE fitness_kiosk_devices SET name=$3,selected_branch_id=$4,allowed_branch_ids=$5,branding_json=$6,config_json=$7,admin_pin_hash=$8,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING jsonb_build_object('id',id,'name',name,'selectedBranchId',selected_branch_id,'allowedBranchIds',allowed_branch_ids,'branding',branding_json,'config',config_json,'active',active,'version',version,'updatedAt',updated_at)")
        .bind(tenant).bind(id).bind(name).bind(selected).bind(json!(allowed)).bind(branding).bind(config).bind(pin_hash)
        .fetch_one(&state.db).await.map_err(write_error)?;
    security_service::record_audit(
        &state.db,
        tenant,
        branch,
        actor,
        "kiosk.device.updated",
        json!({"id":id}),
    )
    .await?;
    Ok(value)
}

pub async fn revoke_device(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<Value, AppError> {
    let revoked=sqlx::query("UPDATE fitness_kiosk_devices SET active=FALSE,revoked_at=NOW(),activation_code_hash=NULL,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND revoked_at IS NULL").bind(tenant).bind(id).execute(&state.db).await.map_err(|_|AppError::internal("failed to revoke kiosk device"))?.rows_affected()==1;
    if !revoked {
        return Err(AppError::not_found("kiosk device was not found"));
    }
    security_service::record_audit(
        &state.db,
        tenant,
        branch,
        actor,
        "kiosk.device.revoked",
        json!({"id":id}),
    )
    .await?;
    Ok(json!({"id":id,"revoked":true}))
}

pub async fn activate(state: &AppState, code: &str) -> Result<(String, Value), AppError> {
    let code = required_text(code, 32, "activationCode")?;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let value:Value=sqlx::query_scalar("UPDATE fitness_kiosk_devices SET token_hash=$2,activation_code_hash=NULL,activation_expires_at=NULL,activated_at=COALESCE(activated_at,NOW()),last_used_at=NOW(),updated_at=NOW() WHERE activation_code_hash=$1 AND activation_expires_at>NOW() AND active AND revoked_at IS NULL RETURNING jsonb_build_object('deviceId',id,'activated',true)")
      .bind(auth_service::token_hash(&code.to_ascii_uppercase())).bind(auth_service::token_hash(&token)).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to activate kiosk"))?.ok_or_else(||AppError::unauthenticated("activation code is invalid or expired"))?;
    Ok((token, value))
}

pub async fn context(state: &AppState, token: &str) -> Result<Value, AppError> {
    let device = device(state, token).await?;
    let allowed = device_branch_ids(&device);
    let branches:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id::TEXT,'name',name,'address',COALESCE(address,'')) FROM branches WHERE tenant_id::TEXT=$1 AND id::TEXT=ANY($2) AND active ORDER BY name")
      .bind(&device.tenant_id).bind(&allowed).fetch_all(&state.db).await.map_err(|_|AppError::internal("failed to load kiosk branches"))?;
    let branch:Value=sqlx::query_scalar("SELECT jsonb_build_object('id',id::TEXT,'name',name,'address',COALESCE(address,''),'latitude',latitude,'longitude',longitude,'geofenceMode',customer_check_in_geofence_mode,'geofenceRadiusMeters',customer_check_in_radius_meters) FROM branches WHERE tenant_id::TEXT=$1 AND id::TEXT=$2 AND active")
      .bind(&device.tenant_id).bind(&device.selected_branch_id).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to load kiosk branch"))?.ok_or_else(||AppError::forbidden("selected kiosk branch is unavailable"))?;
    Ok(
        json!({"deviceId":device.id,"branch":branch,"branches":branches,"branding":device.branding_json,"config":device.config_json,"onlineBookingPath":format!("/business/{}/book?source=kiosk",device.selected_branch_id)}),
    )
}

pub async fn switch_branch(
    state: &AppState,
    token: &str,
    branch_id: &str,
) -> Result<Value, AppError> {
    let device = device(state, token).await?;
    if !device_branch_ids(&device)
        .iter()
        .any(|value| value == branch_id)
    {
        return Err(AppError::forbidden(
            "branch is not authorized for this kiosk",
        ));
    }
    let changed=sqlx::query("UPDATE fitness_kiosk_devices SET selected_branch_id=$2,version=version+1,updated_at=NOW() WHERE id=$1 AND active AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM branches WHERE tenant_id::TEXT=$3 AND id::TEXT=$2 AND active)")
      .bind(&device.id).bind(branch_id).bind(&device.tenant_id).execute(&state.db).await.map_err(|_|AppError::internal("failed to switch kiosk branch"))?.rows_affected()==1;
    if !changed {
        return Err(AppError::not_found("branch was not found"));
    }
    expire_device_sessions(state, &device.id).await?;
    context(state, token).await
}

pub async fn identify(
    state: &AppState,
    token: &str,
    input: &IdentifyInput,
) -> Result<(String, Value), AppError> {
    let device = device(state, token).await?;
    let appointment_id = required_text(&input.appointment_id, 120, "appointmentId")?;
    let phone = phone_digits(&input.phone);
    if phone.len() < 7 {
        return Err(AppError::validation(
            "a valid full phone number is required",
        ));
    }
    let row:BookingIdentity=sqlx::query_as("SELECT a.id appointment_id,a.client_id,a.start_at,a.end_at,a.status,COALESCE(a.booking_group_id,'') booking_group_id,COALESCE(a.service_ids_json,'[]') service_ids_json,BTRIM(c.first_name)='' first_name_missing,BTRIM(c.last_name)='' last_name_missing,BTRIM(c.email)='' email_missing FROM appointments a JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id AND c.branch_id=a.branch_id WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.id=$3 AND REGEXP_REPLACE(c.phone,'[^0-9]','','g')=$4 AND a.start_at BETWEEN NOW()-INTERVAL '6 hours' AND NOW()+INTERVAL '24 hours' AND a.status NOT IN ('cancelled','completed','paid','no-show')")
      .bind(&device.tenant_id).bind(&device.selected_branch_id).bind(&appointment_id).bind(phone).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to identify kiosk booking"))?.ok_or_else(||AppError::not_found("eligible booking was not found"))?;
    expire_device_sessions(state, &device.id).await?;
    let guest_token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let session_id:String=sqlx::query_scalar("INSERT INTO kiosk_guest_sessions(tenant_id,branch_id,device_id,appointment_id,client_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '10 minutes') RETURNING id")
      .bind(&device.tenant_id).bind(&device.selected_branch_id).bind(&device.id).bind(&row.appointment_id).bind(&row.client_id).bind(auth_service::token_hash(&guest_token)).fetch_one(&state.db).await.map_err(|_|AppError::internal("failed to start kiosk guest session"))?;
    let data = session_payload(state, &device, &row, &session_id).await?;
    Ok((guest_token, data))
}

pub async fn session(state: &AppState, token: &str, guest_token: &str) -> Result<Value, AppError> {
    let device = device(state, token).await?;
    let guest = guest_session(state, &device, guest_token).await?;
    let row = booking_identity(state, &guest).await?;
    session_payload(state, &device, &row, &guest.id).await
}

pub async fn form_token(
    state: &AppState,
    token: &str,
    guest_token: &str,
    definition_id: &str,
) -> Result<Value, AppError> {
    let device = device(state, token).await?;
    let guest = guest_session(state, &device, guest_token).await?;
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM client_form_definitions d WHERE d.tenant_id=$1 AND d.branch_id=$2 AND d.id=$3 AND d.active AND NOT EXISTS(SELECT 1 FROM client_form_submissions s WHERE s.client_id=$4 AND s.form_key=d.form_key AND s.form_version>=d.version))")
      .bind(&guest.tenant_id).bind(&guest.branch_id).bind(definition_id).bind(&guest.client_id).fetch_one(&state.db).await.map_err(|_|AppError::internal("failed to validate kiosk form"))?;
    if !exists {
        return Err(AppError::not_found("pending form was not found"));
    }
    let form_token = appointments::issue_public_booking_token(
        state,
        &guest.tenant_id,
        &guest.branch_id,
        None,
        Some(&guest.client_id),
        &format!("client-form-kiosk:{definition_id}"),
        10,
    )
    .map_err(|_| AppError::internal("failed to issue kiosk form access"))?;
    Ok(
        json!({"token":form_token,"definitionId":definition_id,"endpoint":format!("/api/v1/public/client-forms/{definition_id}"),"expiresInMinutes":10}),
    )
}

pub async fn check_in(
    state: &AppState,
    token: &str,
    guest_token: &str,
    input: &CheckInInput,
) -> Result<Value, AppError> {
    validate_key(&input.idempotency_key)?;
    let device = device(state, token).await?;
    let guest = guest_session(state, &device, guest_token).await?;
    if let Some(saved)=sqlx::query_scalar::<_,Value>("SELECT details FROM kiosk_action_events WHERE device_id=$1 AND action='check_in' AND idempotency_key=$2")
      .bind(&device.id).bind(&input.idempotency_key).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to replay kiosk check-in"))?{return Ok(saved);}
    let (distance, required) = validate_geofence(
        state,
        &device,
        input.latitude,
        input.longitude,
        input.accuracy_meters,
    )
    .await?;
    if required && distance.is_none() {
        return Err(AppError::validation(
            "current location is required for kiosk check-in",
        ));
    }
    let allow_group = device
        .config_json
        .get("allowGroupCheckIn")
        .and_then(Value::as_bool)
        .unwrap_or(true)
        && input.apply_group;
    let row = booking_identity(state, &guest).await?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start kiosk check-in"))?;
    let candidates=sqlx::query("SELECT id,status,staff_id FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND (id=$3 OR ($4 AND $5<>'' AND booking_group_id=$5)) AND status NOT IN ('cancelled','completed','paid','no-show') FOR UPDATE")
      .bind(&guest.tenant_id).bind(&guest.branch_id).bind(&guest.appointment_id).bind(allow_group).bind(&row.booking_group_id).fetch_all(&mut *tx).await.map_err(|_|AppError::internal("failed to lock kiosk booking"))?;
    if candidates.is_empty() {
        return Err(AppError::conflict(
            "booking is no longer eligible for check-in",
        ));
    }
    let ids: Vec<String> = candidates
        .iter()
        .filter_map(|value| value.try_get("id").ok())
        .collect();
    sqlx::query("UPDATE appointments SET status='arrived',version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=ANY($3) AND status<>'arrived'")
      .bind(&guest.tenant_id).bind(&guest.branch_id).bind(&ids).execute(&mut *tx).await.map_err(|_|AppError::internal("failed to check in kiosk booking"))?;
    for candidate in &candidates {
        let appointment_id: String = candidate.try_get("id").unwrap_or_default();
        let old: String = candidate.try_get("status").unwrap_or_default();
        if old != "arrived" {
            sqlx::query("INSERT INTO appointment_activity(id,tenant_id,appointment_id,action,old_status,new_status,reason) VALUES(gen_random_uuid()::TEXT,$1,$2,'checked_in',$3,'arrived','kiosk')").bind(&guest.tenant_id).bind(appointment_id).bind(old).execute(&mut *tx).await.map_err(|_|AppError::internal("failed to record kiosk appointment activity"))?;
        }
    }
    sqlx::query("INSERT INTO appointment_arrival_updates(tenant_id,branch_id,appointment_id,client_id,eta_minutes,status,source,device_id,distance_meters,idempotency_key) VALUES($1,$2,$3,$4,0,'arrived','kiosk',$5,$6,$7)")
      .bind(&guest.tenant_id).bind(&guest.branch_id).bind(&guest.appointment_id).bind(&guest.client_id).bind(&device.id).bind(distance.map(|v|v.round() as i32)).bind(&input.idempotency_key).execute(&mut *tx).await.map_err(write_error)?;
    let result = json!({"appointmentId":guest.appointment_id,"status":"arrived","checkedInCount":ids.len(),"groupApplied":allow_group && ids.len()>1,"distanceMeters":distance.map(|value|value.round() as i64)});
    sqlx::query("INSERT INTO kiosk_action_events(tenant_id,branch_id,device_id,guest_session_id,appointment_id,client_id,action,idempotency_key,details) VALUES($1,$2,$3,$4,$5,$6,'check_in',$7,$8)")
      .bind(&guest.tenant_id).bind(&guest.branch_id).bind(&device.id).bind(&guest.id).bind(&guest.appointment_id).bind(&guest.client_id).bind(&input.idempotency_key).bind(&result).execute(&mut *tx).await.map_err(write_error)?;
    security_service::record_audit_tx(
        &mut tx,
        &guest.tenant_id,
        &guest.branch_id,
        &format!("kiosk:{}", device.id),
        "kiosk.booking.checked_in",
        json!({"appointmentId":guest.appointment_id,"count":ids.len(),"distanceMeters":distance}),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit kiosk check-in"))?;
    Ok(result)
}

pub async fn fill_missing_profile(
    state: &AppState,
    token: &str,
    guest_token: &str,
    input: &ProfileInput,
) -> Result<Value, AppError> {
    let device = device(state, token).await?;
    let guest = guest_session(state, &device, guest_token).await?;
    let first = clean_optional(input.first_name.as_deref(), 120, "firstName")?;
    let last = clean_optional(input.last_name.as_deref(), 120, "lastName")?;
    let email = clean_optional(input.email.as_deref(), 254, "email")?;
    if let Some(value) = email.as_deref() {
        if !value.contains('@') {
            return Err(AppError::validation("email is invalid"));
        }
    }
    let value:Value=sqlx::query_scalar("UPDATE clients SET first_name=CASE WHEN BTRIM(first_name)='' THEN COALESCE($4,first_name) ELSE first_name END,last_name=CASE WHEN BTRIM(last_name)='' THEN COALESCE($5,last_name) ELSE last_name END,email=CASE WHEN BTRIM(email)='' THEN COALESCE($6,email) ELSE email END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING jsonb_build_object('firstNameMissing',BTRIM(first_name)='','lastNameMissing',BTRIM(last_name)='','emailMissing',BTRIM(email)='')")
      .bind(&guest.tenant_id).bind(&guest.branch_id).bind(&guest.client_id).bind(first).bind(last).bind(email).fetch_one(&state.db).await.map_err(|_|AppError::internal("failed to complete guest profile"))?;
    record_action(state, &device, &guest, "profile_completed", None, json!({})).await?;
    Ok(value)
}

pub async fn request_add_on(
    state: &AppState,
    token: &str,
    guest_token: &str,
    input: &AddOnRequestInput,
) -> Result<Value, AppError> {
    validate_key(&input.idempotency_key)?;
    let device = device(state, token).await?;
    let guest = guest_session(state, &device, guest_token).await?;
    let row = booking_identity(state, &guest).await?;
    let add_on:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',a.id,'name',a.name,'pricePaise',a.price_paise,'durationMinutes',a.duration_minutes) FROM service_addons a WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.id=$3 AND a.active AND a.service_id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF($4,''),'[]')::JSONB))")
      .bind(&guest.tenant_id).bind(&guest.branch_id).bind(&input.add_on_id).bind(&row.service_ids_json).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to validate add-on"))?;
    let add_on = add_on.ok_or_else(|| AppError::not_found("eligible add-on was not found"))?;
    let result = json!({"appointmentId":guest.appointment_id,"addOn":add_on,"status":"requested","priceChanged":false});
    record_action(
        state,
        &device,
        &guest,
        "add_on_requested",
        Some(&input.idempotency_key),
        result.clone(),
    )
    .await?;
    Ok(result)
}

pub async fn checkout_context(
    state: &AppState,
    token: &str,
    guest_token: &str,
) -> Result<Value, AppError> {
    let device = device(state, token).await?;
    let guest = guest_session(state, &device, guest_token).await?;
    let sale:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('invoiceId',id,'invoiceNumber',invoice_number,'totalPaise',total_paise,'paidPaise',paid_paise,'balancePaise',GREATEST(total_paise-paid_paise,0),'status',status) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND appointment_reference=$4 AND status NOT IN ('voided','cancelled') ORDER BY created_at DESC LIMIT 1")
      .bind(&guest.tenant_id).bind(&guest.branch_id).bind(&guest.client_id).bind(&guest.appointment_id).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to load kiosk checkout"))?;
    let register:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'businessDate',business_date,'status',status) FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND status='open' ORDER BY opened_at DESC LIMIT 1")
      .bind(&guest.tenant_id).bind(&guest.branch_id).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to load kiosk register"))?;
    Ok(
        json!({"mode":device.config_json.get("checkoutMode").and_then(Value::as_str).unwrap_or("mirror"),"invoice":sale,"register":register,"paymentMutated":false}),
    )
}

pub async fn unlock(state: &AppState, token: &str, pin: &str) -> Result<(), AppError> {
    let device = device(state, token).await?;
    validate_pin(pin)?;
    let hash = device
        .admin_pin_hash
        .ok_or_else(|| AppError::forbidden("kiosk admin PIN is not configured"))?;
    if !auth_service::verify_password(pin.trim(), &hash) {
        return Err(AppError::unauthenticated("kiosk admin PIN is invalid"));
    }
    Ok(())
}
pub async fn reset(state: &AppState, token: &str, guest_token: &str) -> Result<Value, AppError> {
    let device = device(state, token).await?;
    let guest = guest_session(state, &device, guest_token).await?;
    sqlx::query("UPDATE kiosk_guest_sessions SET status='completed',completed_at=NOW(),updated_at=NOW() WHERE id=$1").bind(&guest.id).execute(&state.db).await.map_err(|_|AppError::internal("failed to reset kiosk session"))?;
    Ok(json!({"reset":true}))
}
pub async fn deactivate(state: &AppState, token: &str) -> Result<Value, AppError> {
    let device = device(state, token).await?;
    sqlx::query("UPDATE fitness_kiosk_devices SET token_hash=$2,activated_at=NULL,version=version+1,updated_at=NOW() WHERE id=$1").bind(&device.id).bind(auth_service::token_hash(&Uuid::new_v4().to_string())).execute(&state.db).await.map_err(|_|AppError::internal("failed to deactivate kiosk"))?;
    expire_device_sessions(state, &device.id).await?;
    Ok(json!({"deactivated":true}))
}

async fn device(state: &AppState, token: &str) -> Result<Device, AppError> {
    if token.trim().is_empty() {
        return Err(AppError::unauthenticated("kiosk device is not activated"));
    }
    sqlx::query_as("UPDATE fitness_kiosk_devices SET last_used_at=NOW() WHERE token_hash=$1 AND active AND revoked_at IS NULL AND activated_at IS NOT NULL RETURNING id,tenant_id,branch_id,COALESCE(NULLIF(selected_branch_id,''),branch_id) selected_branch_id,allowed_branch_ids,branding_json,config_json,admin_pin_hash").bind(auth_service::token_hash(token)).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to validate kiosk device"))?.ok_or_else(||AppError::unauthenticated("kiosk device is invalid or revoked"))
}
async fn guest_session(
    state: &AppState,
    device: &Device,
    token: &str,
) -> Result<GuestSession, AppError> {
    if token.trim().is_empty() {
        return Err(AppError::unauthenticated("guest session is required"));
    }
    sqlx::query_as("UPDATE kiosk_guest_sessions SET updated_at=NOW() WHERE token_hash=$1 AND device_id=$2 AND status='active' AND expires_at>NOW() RETURNING id,tenant_id,branch_id,appointment_id,client_id").bind(auth_service::token_hash(token)).bind(&device.id).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to validate kiosk guest session"))?.ok_or_else(||AppError::unauthenticated("guest session is invalid or expired"))
}
async fn booking_identity(
    state: &AppState,
    guest: &GuestSession,
) -> Result<BookingIdentity, AppError> {
    sqlx::query_as("SELECT a.id appointment_id,a.client_id,a.start_at,a.end_at,a.status,COALESCE(a.booking_group_id,'') booking_group_id,COALESCE(a.service_ids_json,'[]') service_ids_json,BTRIM(c.first_name)='' first_name_missing,BTRIM(c.last_name)='' last_name_missing,BTRIM(c.email)='' email_missing FROM appointments a JOIN clients c ON c.id=a.client_id WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.id=$3 AND a.client_id=$4").bind(&guest.tenant_id).bind(&guest.branch_id).bind(&guest.appointment_id).bind(&guest.client_id).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to load kiosk booking"))?.ok_or_else(||AppError::not_found("booking was not found"))
}
async fn session_payload(
    state: &AppState,
    device: &Device,
    row: &BookingIdentity,
    session_id: &str,
) -> Result<Value, AppError> {
    let services:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'durationMinutes',duration_minutes) FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF($3,''),'[]')::JSONB)) ORDER BY name").bind(&device.tenant_id).bind(&device.selected_branch_id).bind(&row.service_ids_json).fetch_all(&state.db).await.map_err(|_|AppError::internal("failed to load kiosk booking services"))?;
    let add_ons:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'pricePaise',price_paise,'durationMinutes',duration_minutes) FROM service_addons WHERE tenant_id=$1 AND branch_id=$2 AND active AND service_id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF($3,''),'[]')::JSONB)) ORDER BY name").bind(&device.tenant_id).bind(&device.selected_branch_id).bind(&row.service_ids_json).fetch_all(&state.db).await.map_err(|_|AppError::internal("failed to load kiosk add-ons"))?;
    let forms:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',d.id,'name',d.name,'formType',d.form_type,'version',d.version,'requiresSignature',d.requires_signature) FROM client_form_definitions d WHERE d.tenant_id=$1 AND d.branch_id=$2 AND d.active AND NOT EXISTS(SELECT 1 FROM client_form_submissions s WHERE s.client_id=$3 AND s.form_key=d.form_key AND s.form_version>=d.version) ORDER BY d.form_type,d.name").bind(&device.tenant_id).bind(&device.selected_branch_id).bind(&row.client_id).fetch_all(&state.db).await.map_err(|_|AppError::internal("failed to load pending kiosk forms"))?;
    let group_count: i64 = if row.booking_group_id.is_empty() {
        1
    } else {
        sqlx::query_scalar("SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND booking_group_id=$3 AND status NOT IN ('cancelled','no-show')").bind(&device.tenant_id).bind(&device.selected_branch_id).bind(&row.booking_group_id).fetch_one(&state.db).await.unwrap_or(1)
    };
    let queue:Value=sqlx::query_scalar("WITH mine AS (SELECT created_at,status FROM appointment_arrival_updates WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=$3 ORDER BY created_at DESC LIMIT 1), ahead AS (SELECT COUNT(DISTINCT q.appointment_id) count FROM appointment_arrival_updates q JOIN appointments a ON a.id=q.appointment_id AND a.tenant_id=q.tenant_id AND a.branch_id=q.branch_id WHERE q.tenant_id=$1 AND q.branch_id=$2 AND q.status='arrived' AND a.status='arrived' AND q.created_at<(SELECT created_at FROM mine)) SELECT jsonb_build_object('status',COALESCE((SELECT status FROM mine),''),'position',CASE WHEN EXISTS(SELECT 1 FROM mine WHERE status='arrived') THEN 1+(SELECT count FROM ahead) ELSE NULL END,'estimatedWaitMinutes',CASE WHEN EXISTS(SELECT 1 FROM mine WHERE status='arrived') THEN 10*(SELECT count FROM ahead) ELSE NULL END)").bind(&device.tenant_id).bind(&device.selected_branch_id).bind(&row.appointment_id).fetch_one(&state.db).await.map_err(|_|AppError::internal("failed to load kiosk queue position"))?;
    Ok(
        json!({"sessionId":session_id,"appointmentId":row.appointment_id,"startAt":row.start_at,"endAt":row.end_at,"status":row.status,"services":services,"eligibleAddOns":add_ons,"groupCount":group_count,"pendingForms":forms,"missingProfile":{"firstName":row.first_name_missing,"lastName":row.last_name_missing,"email":row.email_missing},"queue":queue,"expiresInMinutes":10}),
    )
}
async fn validate_geofence(
    state: &AppState,
    device: &Device,
    lat: Option<f64>,
    lon: Option<f64>,
    accuracy: Option<f64>,
) -> Result<(Option<f64>, bool), AppError> {
    let row=sqlx::query("SELECT latitude,longitude,customer_check_in_geofence_mode,customer_check_in_radius_meters FROM branches WHERE tenant_id::TEXT=$1 AND id::TEXT=$2").bind(&device.tenant_id).bind(&device.selected_branch_id).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to load kiosk geofence"))?.ok_or_else(||AppError::not_found("kiosk branch was not found"))?;
    let required = device
        .config_json
        .get("requireGeofence")
        .and_then(Value::as_bool)
        .unwrap_or(true)
        || row
            .try_get::<String, _>("customer_check_in_geofence_mode")
            .unwrap_or_default()
            == "required";
    let (Some(lat), Some(lon)) = (lat, lon) else {
        return Ok((None, required));
    };
    if !(-90.0..=90.0).contains(&lat)
        || !(-180.0..=180.0).contains(&lon)
        || accuracy.is_some_and(|v| !v.is_finite() || v < 0.0 || v > 5000.0)
    {
        return Err(AppError::validation("location coordinates are invalid"));
    }
    let branch_lat: Option<f64> = row.try_get("latitude").ok();
    let branch_lon: Option<f64> = row.try_get("longitude").ok();
    let (Some(branch_lat), Some(branch_lon)) = (branch_lat, branch_lon) else {
        if required {
            return Err(AppError::service_unavailable(
                "KIOSK_GEOFENCE_NOT_CONFIGURED",
                "branch geofence coordinates are not configured",
            ));
        } else {
            return Ok((None, false));
        }
    };
    let distance = haversine_meters(lat, lon, branch_lat, branch_lon);
    let radius = device
        .config_json
        .get("geofenceRadiusMeters")
        .and_then(Value::as_i64)
        .unwrap_or_else(|| {
            row.try_get::<i32, _>("customer_check_in_radius_meters")
                .unwrap_or(300) as i64
        }) as f64;
    if distance + accuracy.unwrap_or(0.0) > radius {
        return Err(AppError::forbidden(format!(
            "kiosk is outside the {} metre check-in area",
            radius.round()
        )));
    }
    Ok((Some(distance), required))
}
async fn validate_branches(state: &AppState, tenant: &str, ids: &[String]) -> Result<(), AppError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM branches WHERE tenant_id::TEXT=$1 AND id::TEXT=ANY($2) AND active",
    )
    .bind(tenant)
    .bind(ids)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to validate kiosk branches"))?;
    if count != ids.len() as i64 {
        return Err(AppError::validation(
            "one or more kiosk branches are unavailable",
        ));
    }
    Ok(())
}
async fn expire_device_sessions(state: &AppState, device_id: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE kiosk_guest_sessions SET status='expired',updated_at=NOW() WHERE device_id=$1 AND status='active'").bind(device_id).execute(&state.db).await.map_err(|_|AppError::internal("failed to expire kiosk guest session"))?;
    Ok(())
}
async fn record_action(
    state: &AppState,
    device: &Device,
    guest: &GuestSession,
    action: &str,
    key: Option<&str>,
    details: Value,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO kiosk_action_events(tenant_id,branch_id,device_id,guest_session_id,appointment_id,client_id,action,idempotency_key,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (device_id,action,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING").bind(&guest.tenant_id).bind(&guest.branch_id).bind(&device.id).bind(&guest.id).bind(&guest.appointment_id).bind(&guest.client_id).bind(action).bind(key).bind(details).execute(&state.db).await.map_err(write_error)?;
    Ok(())
}
fn device_branch_ids(device: &Device) -> Vec<String> {
    let mut values: Vec<String> =
        serde_json::from_value(device.allowed_branch_ids.clone()).unwrap_or_default();
    if values.is_empty() {
        values.push(device.branch_id.clone());
    }
    values
}
fn validate_pin(pin: &str) -> Result<(), AppError> {
    let pin = pin.trim();
    if !(4..=8).contains(&pin.len()) || !pin.bytes().all(|value| value.is_ascii_digit()) {
        return Err(AppError::validation("admin PIN must contain 4 to 8 digits"));
    }
    Ok(())
}
fn validate_key(key: &str) -> Result<(), AppError> {
    if !(8..=120).contains(&key.len())
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':'))
    {
        return Err(AppError::validation("idempotencyKey is invalid"));
    }
    Ok(())
}
fn required_text(value: &str, max: usize, name: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(AppError::validation(format!(
            "{name} is required and must be at most {max} characters"
        )));
    }
    Ok(value.to_string())
}
fn clean_optional(value: Option<&str>, max: usize, name: &str) -> Result<Option<String>, AppError> {
    match value.map(str::trim).filter(|v| !v.is_empty()) {
        Some(value) if value.chars().count() > max => Err(AppError::validation(format!(
            "{name} must be at most {max} characters"
        ))),
        Some(value) => Ok(Some(value.to_string())),
        None => Ok(None),
    }
}
fn unique_nonempty(values: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    for value in values.iter().map(|v| v.trim()).filter(|v| !v.is_empty()) {
        if !result.iter().any(|current| current == value) {
            result.push(value.to_string());
        }
    }
    result
}
fn phone_digits(value: &str) -> String {
    value.chars().filter(char::is_ascii_digit).collect()
}
fn normalize_branding(value: Option<&Value>) -> Result<Value, AppError> {
    let source = value.and_then(Value::as_object);
    let mut out = Map::new();
    for (key, max) in [
        ("appName", 80),
        ("logoUrl", 500),
        ("primaryColor", 16),
        ("accentColor", 16),
    ] {
        if let Some(text) = source
            .and_then(|v| v.get(key))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            if text.chars().count() > max {
                return Err(AppError::validation(format!("branding.{key} is too long")));
            }
            if key.ends_with("Color")
                && !(text.len() == 7
                    && text.starts_with('#')
                    && text[1..].bytes().all(|v| v.is_ascii_hexdigit()))
            {
                return Err(AppError::validation(format!(
                    "branding.{key} must be a hex color"
                )));
            }
            out.insert(key.into(), json!(text));
        }
    }
    Ok(Value::Object(out))
}
fn normalize_config(value: Option<&Value>) -> Result<Value, AppError> {
    let source = value.and_then(Value::as_object);
    let checkout = source
        .and_then(|v| v.get("checkoutMode"))
        .and_then(Value::as_str)
        .unwrap_or("mirror");
    if !matches!(checkout, "mirror" | "self_pay") {
        return Err(AppError::validation(
            "config.checkoutMode must be mirror or self_pay",
        ));
    }
    let radius = source
        .and_then(|v| v.get("geofenceRadiusMeters"))
        .and_then(Value::as_i64)
        .unwrap_or(300);
    if !(25..=5000).contains(&radius) {
        return Err(AppError::validation(
            "config.geofenceRadiusMeters must be between 25 and 5000",
        ));
    }
    Ok(
        json!({"allowGroupCheckIn":source.and_then(|v|v.get("allowGroupCheckIn")).and_then(Value::as_bool).unwrap_or(true),"allowSameDayBooking":source.and_then(|v|v.get("allowSameDayBooking")).and_then(Value::as_bool).unwrap_or(true),"allowAddOnRequest":source.and_then(|v|v.get("allowAddOnRequest")).and_then(Value::as_bool).unwrap_or(true),"checkoutMode":checkout,"requireGeofence":source.and_then(|v|v.get("requireGeofence")).and_then(Value::as_bool).unwrap_or(true),"geofenceRadiusMeters":radius}),
    )
}
fn write_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .and_then(|e| e.code())
        .is_some_and(|c| matches!(c.as_ref(), "23505" | "23514" | "23503"))
    {
        AppError::conflict(
            error
                .as_database_error()
                .map(|e| e.message())
                .unwrap_or("kiosk change conflicts with current state"),
        )
    } else {
        AppError::internal("failed to persist kiosk change")
    }
}
fn haversine_meters(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let radius = 6_371_000.0;
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    radius * 2.0 * a.sqrt().atan2((1.0 - a).sqrt())
}

pub async fn validate_customer_geofence(
    state: &AppState,
    tenant: &str,
    branch: &str,
    eta_minutes: i32,
    lat: Option<f64>,
    lon: Option<f64>,
    accuracy: Option<f64>,
) -> Result<Option<f64>, AppError> {
    if eta_minutes != 0 {
        return Ok(None);
    }
    let row=sqlx::query("SELECT latitude,longitude,customer_check_in_geofence_mode,customer_check_in_radius_meters FROM branches WHERE tenant_id::TEXT=$1 AND id::TEXT=$2").bind(tenant).bind(branch).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to load customer check-in geofence"))?.ok_or_else(||AppError::not_found("booking branch was not found"))?;
    let mode: String = row
        .try_get("customer_check_in_geofence_mode")
        .unwrap_or_else(|_| "optional".into());
    if mode == "disabled" {
        return Ok(None);
    }
    let (Some(lat), Some(lon)) = (lat, lon) else {
        return if mode == "required" {
            Err(AppError::validation(
                "current location is required to check in",
            ))
        } else {
            Ok(None)
        };
    };
    if !(-90.0..=90.0).contains(&lat)
        || !(-180.0..=180.0).contains(&lon)
        || accuracy.is_some_and(|value| !value.is_finite() || value < 0.0 || value > 5000.0)
    {
        return Err(AppError::validation("location coordinates are invalid"));
    }
    let branch_lat: Option<f64> = row.try_get("latitude").ok();
    let branch_lon: Option<f64> = row.try_get("longitude").ok();
    let (Some(branch_lat), Some(branch_lon)) = (branch_lat, branch_lon) else {
        return if mode == "required" {
            Err(AppError::service_unavailable(
                "CUSTOMER_GEOFENCE_NOT_CONFIGURED",
                "branch check-in coordinates are not configured",
            ))
        } else {
            Ok(None)
        };
    };
    let distance = haversine_meters(lat, lon, branch_lat, branch_lon);
    let radius = row
        .try_get::<i32, _>("customer_check_in_radius_meters")
        .unwrap_or(300) as f64;
    if distance + accuracy.unwrap_or(0.0) > radius {
        return Err(AppError::forbidden(format!(
            "you are outside the {} metre check-in area",
            radius.round()
        )));
    }
    Ok(Some(distance))
}

#[cfg(test)]
mod tests {
    use super::haversine_meters;
    #[test]
    fn geofence_distance_is_stable() {
        assert!(haversine_meters(28.6139, 77.2090, 28.6139, 77.2090) < 0.1);
        assert!((haversine_meters(28.6139, 77.2090, 28.6148, 77.2090) - 100.0).abs() < 2.0);
    }
}
