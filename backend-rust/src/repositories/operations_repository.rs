use serde_json::{json, Value};
use sqlx::{PgPool, Row};

pub async fn dispatch_summary(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Value, sqlx::Error> {
    let zones = sqlx::query("SELECT id,name,service_area,travel_minutes,max_distance_meters,base_surcharge_paise,per_km_surcharge_paise,staff_per_km_paise,sla_minutes,active FROM travel_zones WHERE tenant_id=$1 AND branch_id=$2 ORDER BY name")
        .bind(tenant).bind(branch).fetch_all(db).await?.into_iter().map(|r| json!({
            "id":r.get::<String,_>("id"),"name":r.get::<String,_>("name"),"serviceArea":r.get::<String,_>("service_area"),
            "travelMinutes":r.get::<i32,_>("travel_minutes"),"maxDistanceMeters":r.get::<Option<i32>,_>("max_distance_meters"),
            "baseSurchargePaise":r.get::<i64,_>("base_surcharge_paise"),"perKmSurchargePaise":r.get::<i64,_>("per_km_surcharge_paise"),
            "staffPerKmPaise":r.get::<i64,_>("staff_per_km_paise"),"slaMinutes":r.get::<i32,_>("sla_minutes"),"active":r.get::<bool,_>("active")
        })).collect::<Vec<_>>();
    let appointments = sqlx::query(r#"SELECT a.id,a.client_id,a.staff_id,a.start_at,a.service_ids_json,
        CONCAT_WS(' ',c.first_name,c.last_name) client_name,COALESCE(c.phone,'') phone,
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),''),'Unassigned') staff_name,
        COALESCE(addr.address,'') address,addr.id address_id,addr.latitude,addr.longitude,
        COALESCE((SELECT STRING_AGG(service.name,', ' ORDER BY service.name) FROM services service WHERE service.tenant_id=a.tenant_id AND service.branch_id=a.branch_id AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(a.service_ids_json,''),'[]')::jsonb))),'') service_names
      FROM appointments a JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id AND c.branch_id=a.branch_id
      LEFT JOIN staff s ON s.id=a.staff_id AND s.tenant_id=a.tenant_id AND s.branch_id=a.branch_id
      LEFT JOIN LATERAL (SELECT id,address,latitude,longitude FROM client_service_addresses WHERE tenant_id=a.tenant_id AND branch_id=a.branch_id AND client_id=a.client_id ORDER BY is_default DESC,updated_at DESC LIMIT 1) addr ON TRUE
      WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.start_at>=NOW()-INTERVAL '1 day' AND a.start_at<NOW()+INTERVAL '30 days'
        AND a.status NOT IN ('cancelled','no_show') AND NOT EXISTS(SELECT 1 FROM field_jobs j WHERE j.tenant_id=a.tenant_id AND j.branch_id=a.branch_id AND j.appointment_id=a.id AND j.status<>'cancelled')
      ORDER BY a.start_at LIMIT 200"#).bind(tenant).bind(branch).fetch_all(db).await?.into_iter().map(|r| json!({
        "id":r.get::<String,_>("id"),"clientId":r.get::<String,_>("client_id"),"clientName":r.get::<String,_>("client_name"),
        "phone":r.get::<String,_>("phone"),"staffId":r.get::<Option<String>,_>("staff_id"),"staffName":r.get::<String,_>("staff_name"),
        "startAt":r.get::<chrono::DateTime<chrono::Utc>,_>("start_at"),"serviceIds":r.get::<String,_>("service_ids_json"),
        "serviceNames":r.get::<String,_>("service_names"),"addressId":r.get::<Option<String>,_>("address_id"),"address":r.get::<String,_>("address"),"latitude":r.get::<Option<f64>,_>("latitude"),"longitude":r.get::<Option<f64>,_>("longitude")
    })).collect::<Vec<_>>();
    let staff = sqlx::query(r#"SELECT s.id,COALESCE(NULLIF(TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),''),s.id) name,
        COUNT(j.id) FILTER (WHERE j.status IN ('assigned','accepted','en_route','arrived'))::BIGINT active_jobs
      FROM staff s LEFT JOIN field_jobs j ON j.tenant_id=s.tenant_id AND j.branch_id=s.branch_id AND j.staff_id=s.id
      WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.active=TRUE GROUP BY s.id,s.first_name,s.last_name ORDER BY active_jobs,name"#)
        .bind(tenant).bind(branch).fetch_all(db).await?.into_iter().map(|r| json!({"id":r.get::<String,_>("id"),"name":r.get::<String,_>("name"),"activeJobs":r.get::<i64,_>("active_jobs")})).collect::<Vec<_>>();
    let jobs = sqlx::query(r#"SELECT j.id,j.appointment_id,j.client_id,j.staff_id,j.travel_zone_id,j.address,j.travel_minutes,j.status,j.source,j.scheduled_start_at,j.route_distance_meters,j.route_duration_seconds,j.remaining_eta_seconds,j.route_provider,j.distance_surcharge_paise,j.staff_travel_pay_paise,j.travel_cost_paise,j.marketplace_commission_paise,j.priority,j.sla_due_at,j.escalation_level,j.last_location_at,j.proof_submitted_at,j.created_at,
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),''),'Unassigned') staff_name,COALESCE(NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),'Client') client_name,
        COALESCE((SELECT SUM(p.total_paise) FROM pos_sales p WHERE p.tenant_id=j.tenant_id AND p.branch_id=j.branch_id AND p.source='appointment' AND p.reference_id=j.appointment_id AND p.status NOT IN ('void','cancelled')),0)::BIGINT billed_revenue_paise,
        COALESCE((SELECT SUM(cs.commission_paise) FROM pos_staff_commission_snapshots cs JOIN pos_sales p ON p.id=cs.sale_id AND p.tenant_id=cs.tenant_id AND p.branch_id=cs.branch_id WHERE p.tenant_id=j.tenant_id AND p.branch_id=j.branch_id AND p.source='appointment' AND p.reference_id=j.appointment_id),0)::BIGINT service_commission_paise,
        COALESCE((SELECT ml.commission_bps FROM marketplace_listings ml WHERE ml.tenant_id=j.tenant_id AND ml.branch_id=j.branch_id AND ml.status='approved' LIMIT 1),0)::INTEGER commission_bps
      FROM field_jobs j LEFT JOIN staff s ON s.id=j.staff_id AND s.tenant_id=j.tenant_id AND s.branch_id=j.branch_id LEFT JOIN clients c ON c.id=j.client_id AND c.tenant_id=j.tenant_id AND c.branch_id=j.branch_id
      WHERE j.tenant_id=$1 AND j.branch_id=$2 ORDER BY CASE WHEN j.status IN ('completed','cancelled') THEN 1 ELSE 0 END,j.priority,j.sla_due_at NULLS LAST,j.created_at DESC LIMIT 250"#)
        .bind(tenant).bind(branch).fetch_all(db).await?.into_iter().map(|r| {
            let revenue=r.get::<i64,_>("billed_revenue_paise"); let commission=r.get::<i64,_>("service_commission_paise"); let staff_travel=r.get::<i64,_>("staff_travel_pay_paise"); let travel=r.get::<i64,_>("travel_cost_paise"); let stored_marketplace=r.get::<i64,_>("marketplace_commission_paise"); let marketplace=if stored_marketplace>0{stored_marketplace}else{revenue*i64::from(r.get::<i32,_>("commission_bps"))/10_000};
            json!({"id":r.get::<String,_>("id"),"appointmentId":r.get::<Option<String>,_>("appointment_id"),"clientId":r.get::<Option<String>,_>("client_id"),"clientName":r.get::<String,_>("client_name"),"staffId":r.get::<Option<String>,_>("staff_id"),"staffName":r.get::<String,_>("staff_name"),"travelZoneId":r.get::<Option<String>,_>("travel_zone_id"),"address":r.get::<String,_>("address"),"travelMinutes":r.get::<i32,_>("travel_minutes"),"status":r.get::<String,_>("status"),"source":r.get::<String,_>("source"),"scheduledStartAt":r.get::<Option<chrono::DateTime<chrono::Utc>>,_>("scheduled_start_at"),"routeDistanceMeters":r.get::<Option<i32>,_>("route_distance_meters"),"routeDurationSeconds":r.get::<Option<i32>,_>("route_duration_seconds"),"remainingEtaSeconds":r.get::<Option<i32>,_>("remaining_eta_seconds"),"routeProvider":r.get::<Option<String>,_>("route_provider"),"distanceSurchargePaise":r.get::<i64,_>("distance_surcharge_paise"),"staffTravelPayPaise":staff_travel,"travelCostPaise":travel,"marketplaceCommissionPaise":marketplace,"billedRevenuePaise":revenue,"serviceCommissionPaise":commission,"profitPaise":revenue-commission-staff_travel-travel-marketplace,"priority":r.get::<i16,_>("priority"),"slaDueAt":r.get::<Option<chrono::DateTime<chrono::Utc>>,_>("sla_due_at"),"overdue":r.get::<Option<chrono::DateTime<chrono::Utc>>,_>("sla_due_at").is_some_and(|v| v<chrono::Utc::now()) && !matches!(r.get::<String,_>("status").as_str(),"completed"|"cancelled"),"escalationLevel":r.get::<i16,_>("escalation_level"),"lastLocationAt":r.get::<Option<chrono::DateTime<chrono::Utc>>,_>("last_location_at"),"proofSubmittedAt":r.get::<Option<chrono::DateTime<chrono::Utc>>,_>("proof_submitted_at"),"createdAt":r.get::<chrono::DateTime<chrono::Utc>,_>("created_at")})
        }).collect::<Vec<_>>();
    let demand = sqlx::query(r#"SELECT z.id,z.name,COUNT(j.id)::BIGINT jobs_90d,ROUND(COUNT(j.id)::NUMERIC/90*7,1)::DOUBLE PRECISION forecast_7d
      FROM travel_zones z LEFT JOIN field_jobs j ON j.travel_zone_id=z.id AND j.tenant_id=z.tenant_id AND j.branch_id=z.branch_id AND j.created_at>=NOW()-INTERVAL '90 days' AND j.status<>'cancelled'
      WHERE z.tenant_id=$1 AND z.branch_id=$2 GROUP BY z.id,z.name ORDER BY jobs_90d DESC,z.name"#)
        .bind(tenant).bind(branch).fetch_all(db).await?.into_iter().map(|r| json!({"zoneId":r.get::<String,_>("id"),"zoneName":r.get::<String,_>("name"),"jobs90d":r.get::<i64,_>("jobs_90d"),"forecast7d":r.get::<f64,_>("forecast_7d")})).collect::<Vec<_>>();
    Ok(
        json!({"zones":zones,"appointments":appointments,"staff":staff,"jobs":jobs,"zoneDemand":demand}),
    )
}

pub async fn save_address(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    client: &str,
    label: &str,
    address: &str,
    actor: &str,
    latitude: Option<f64>,
    longitude: Option<f64>,
    provider: Option<&str>,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO client_service_addresses(tenant_id,branch_id,client_id,label,address,latitude,longitude,geocode_provider,verified_at,is_default,created_by) SELECT $1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $6 IS NULL THEN NULL ELSE NOW() END,TRUE,$9 FROM clients WHERE id=$3 AND tenant_id=$1 AND branch_id=$2 ON CONFLICT(tenant_id,branch_id,client_id) WHERE is_default DO UPDATE SET label=EXCLUDED.label,address=EXCLUDED.address,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,geocode_provider=EXCLUDED.geocode_provider,verified_at=EXCLUDED.verified_at,updated_at=NOW() RETURNING id")
        .bind(tenant).bind(branch).bind(client).bind(label).bind(address).bind(latitude).bind(longitude).bind(provider).bind(actor).fetch_one(db).await
}

pub async fn save_appointment_address(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    appointment: &str,
    address: &str,
    latitude: Option<f64>,
    longitude: Option<f64>,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("INSERT INTO client_service_addresses(tenant_id,branch_id,client_id,address,latitude,longitude,geocode_provider,verified_at,is_default,created_by) SELECT a.tenant_id,a.branch_id,a.client_id,$4,$5,$6,CASE WHEN $5 IS NULL THEN NULL ELSE 'verified_coordinates' END,CASE WHEN $5 IS NULL THEN NULL ELSE NOW() END,TRUE,$7 FROM appointments a WHERE a.id=$3 AND a.tenant_id=$1 AND a.branch_id=$2 ON CONFLICT(tenant_id,branch_id,client_id) WHERE is_default DO UPDATE SET address=EXCLUDED.address,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,geocode_provider=EXCLUDED.geocode_provider,verified_at=EXCLUDED.verified_at,updated_at=NOW()").bind(tenant).bind(branch).bind(appointment).bind(address).bind(latitude).bind(longitude).bind(actor).execute(db).await?.rows_affected()==1)
}

pub async fn branch_origin(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Option<(String, Option<f64>, Option<f64>)>, sqlx::Error> {
    sqlx::query_as("SELECT COALESCE(address,''),latitude,longitude FROM branches WHERE id::TEXT=$2 AND tenant_id::TEXT=$1").bind(tenant).bind(branch).fetch_optional(db).await
}

pub async fn job_contact(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    job: &str,
) -> Result<Option<(String, String, String)>, sqlx::Error> {
    sqlx::query_as("SELECT c.id,COALESCE(c.phone,''),j.status FROM field_jobs j JOIN clients c ON c.id=j.client_id AND c.tenant_id=j.tenant_id AND c.branch_id=j.branch_id WHERE j.id=$3 AND j.tenant_id=$1 AND j.branch_id=$2").bind(tenant).bind(branch).bind(job).fetch_optional(db).await
}

pub async fn create_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    appointment: &str,
    staff: Option<&str>,
    zone: &str,
    address: &str,
    travel_minutes: i32,
    route: Option<(f64, f64, i32, i32)>,
    priority: i16,
) -> Result<Option<String>, sqlx::Error> {
    let (lat, lng, distance, duration) = route
        .map(|v| (Some(v.0), Some(v.1), Some(v.2), Some(v.3)))
        .unwrap_or((None, None, None, None));
    sqlx::query_scalar(r#"INSERT INTO field_jobs(tenant_id,branch_id,appointment_id,client_id,staff_id,travel_zone_id,address,travel_minutes,status,source,service_ids_json,scheduled_start_at,destination_latitude,destination_longitude,route_distance_meters,route_duration_seconds,remaining_eta_seconds,route_provider,route_calculated_at,distance_surcharge_paise,staff_travel_pay_paise,priority,sla_due_at,assigned_at)
      SELECT $1,$2,a.id,a.client_id,$4,$5,$6,$7,CASE WHEN $4 IS NULL THEN 'created' ELSE 'assigned' END,'appointment',COALESCE(NULLIF(a.service_ids_json,''),'[]')::jsonb,a.start_at,$8,$9,$10,$11,$11,CASE WHEN $10 IS NULL THEN NULL ELSE 'google_routes' END,CASE WHEN $10 IS NULL THEN NULL ELSE NOW() END,
        z.base_surcharge_paise+CEIL(COALESCE($10,0)/1000.0)*z.per_km_surcharge_paise,CEIL(COALESCE($10,0)/1000.0)*z.staff_per_km_paise,$12,a.start_at+(z.sla_minutes||' minutes')::INTERVAL,CASE WHEN $4 IS NULL THEN NULL ELSE NOW() END
      FROM appointments a JOIN travel_zones z ON z.id=$5 AND z.tenant_id=a.tenant_id AND z.branch_id=a.branch_id AND z.active=TRUE
      WHERE a.id=$3 AND a.tenant_id=$1 AND a.branch_id=$2 AND ($4 IS NULL OR EXISTS(SELECT 1 FROM staff s WHERE s.id=$4 AND s.tenant_id=$1 AND s.branch_id=$2 AND s.active=TRUE)) RETURNING id"#)
        .bind(tenant).bind(branch).bind(appointment).bind(staff).bind(zone).bind(address).bind(travel_minutes).bind(lat).bind(lng).bind(distance).bind(duration).bind(priority).fetch_optional(db).await
}

pub async fn link_marketplace_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    job: &str,
    connection: &str,
    external_booking: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE field_jobs SET source='marketplace',marketplace_connection_id=$4,external_booking_id=$5,updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3").bind(job).bind(tenant).bind(branch).bind(connection).bind(external_booking).execute(db).await?;
    Ok(())
}

pub async fn update_job_status(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    staff: Option<&str>,
    current: &str,
    next: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let updated=sqlx::query("UPDATE field_jobs SET status=$6,accepted_at=CASE WHEN $6='accepted' THEN NOW() ELSE accepted_at END,en_route_at=CASE WHEN $6='en_route' THEN NOW() ELSE en_route_at END,arrival_at=CASE WHEN $6='arrived' THEN NOW() ELSE arrival_at END,completed_at=CASE WHEN $6='completed' THEN NOW() ELSE completed_at END,updated_at=NOW(),version=version+1 WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status=$5 AND ($4 IS NULL OR staff_id=$4)")
        .bind(id).bind(tenant).bind(branch).bind(staff).bind(current).bind(next).execute(&mut *tx).await?.rows_affected()==1;
    if updated {
        sqlx::query("INSERT INTO field_job_events(tenant_id,branch_id,field_job_id,event_type,actor_id,details_json) VALUES($1,$2,$3,$4,$5,$6)").bind(tenant).bind(branch).bind(id).bind(format!("status.{next}")).bind(actor).bind(json!({"from":current,"to":next})).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(updated)
}

pub async fn assign_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    staff: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let ok=sqlx::query("UPDATE field_jobs SET staff_id=$4,status='assigned',assigned_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='created' AND EXISTS(SELECT 1 FROM staff s WHERE s.id=$4 AND s.tenant_id=$2 AND s.branch_id=$3 AND s.active=TRUE)").bind(id).bind(tenant).bind(branch).bind(staff).execute(&mut *tx).await?.rows_affected()==1;
    if ok {
        sqlx::query("INSERT INTO field_job_events(tenant_id,branch_id,field_job_id,event_type,actor_id,details_json) VALUES($1,$2,$3,'assignment.created',$4,$5)").bind(tenant).bind(branch).bind(id).bind(actor).bind(json!({"staffId":staff})).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(ok)
}

pub async fn current_job_status(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    staff: Option<&str>,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT status FROM field_jobs WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND ($4 IS NULL OR staff_id=$4)").bind(id).bind(tenant).bind(branch).bind(staff).fetch_optional(db).await
}

pub async fn self_jobs(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    Ok(sqlx::query("SELECT j.id,j.address,j.status,j.scheduled_start_at,j.travel_minutes,j.route_distance_meters,j.remaining_eta_seconds,j.priority,j.sla_due_at,j.proof_submitted_at,COALESCE(CONCAT_WS(' ',c.first_name,c.last_name),'Client') client_name,COALESCE((SELECT STRING_AGG(s.name,', ') FROM services s WHERE s.tenant_id=j.tenant_id AND s.branch_id=j.branch_id AND s.id IN (SELECT jsonb_array_elements_text(j.service_ids_json))),'') service_names FROM field_jobs j LEFT JOIN clients c ON c.id=j.client_id AND c.tenant_id=j.tenant_id AND c.branch_id=j.branch_id WHERE j.tenant_id=$1 AND j.branch_id=$2 AND j.staff_id=$3 AND j.status NOT IN ('completed','cancelled') ORDER BY j.priority,j.scheduled_start_at NULLS LAST")
      .bind(tenant).bind(branch).bind(staff).fetch_all(db).await?.into_iter().map(|r|json!({"id":r.get::<String,_>("id"),"address":r.get::<String,_>("address"),"status":r.get::<String,_>("status"),"scheduledStartAt":r.get::<Option<chrono::DateTime<chrono::Utc>>,_>("scheduled_start_at"),"travelMinutes":r.get::<i32,_>("travel_minutes"),"routeDistanceMeters":r.get::<Option<i32>,_>("route_distance_meters"),"remainingEtaSeconds":r.get::<Option<i32>,_>("remaining_eta_seconds"),"priority":r.get::<i16,_>("priority"),"slaDueAt":r.get::<Option<chrono::DateTime<chrono::Utc>>,_>("sla_due_at"),"proofSubmittedAt":r.get::<Option<chrono::DateTime<chrono::Utc>>,_>("proof_submitted_at"),"clientName":r.get::<String,_>("client_name"),"serviceNames":r.get::<String,_>("service_names")})).collect())
}

pub async fn record_location(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    staff: &str,
    lat: f64,
    lng: f64,
    accuracy: Option<f64>,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let ok=sqlx::query("UPDATE field_jobs SET last_location_latitude=$5,last_location_longitude=$6,last_location_accuracy_meters=$7,last_location_at=NOW(),updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND staff_id=$4 AND status IN ('accepted','en_route','arrived')")
      .bind(id).bind(tenant).bind(branch).bind(staff).bind(lat).bind(lng).bind(accuracy).execute(&mut *tx).await?.rows_affected()==1;
    if ok {
        sqlx::query("INSERT INTO field_job_location_events(tenant_id,branch_id,field_job_id,staff_id,latitude,longitude,accuracy_meters) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(tenant).bind(branch).bind(id).bind(staff).bind(lat).bind(lng).bind(accuracy).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(ok)
}

pub async fn job_destination(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    staff: &str,
) -> Result<Option<(Option<f64>, Option<f64>)>, sqlx::Error> {
    sqlx::query_as("SELECT destination_latitude,destination_longitude FROM field_jobs WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND staff_id=$4").bind(id).bind(tenant).bind(branch).bind(staff).fetch_optional(db).await
}

pub async fn update_remaining_eta(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    staff: &str,
    seconds: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE field_jobs SET remaining_eta_seconds=$5,route_calculated_at=NOW(),updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND staff_id=$4").bind(id).bind(tenant).bind(branch).bind(staff).bind(seconds).execute(db).await?;
    Ok(())
}

pub async fn save_proof(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    staff: &str,
    proof: &Value,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE field_jobs SET proof_json=$5,proof_submitted_at=NOW(),updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND staff_id=$4 AND status='arrived'").bind(id).bind(tenant).bind(branch).bind(staff).bind(proof).execute(db).await?.rows_affected()==1)
}

pub async fn insert_tracking_link(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    job: &str,
    token_hash: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("INSERT INTO field_job_tracking_links(tenant_id,branch_id,field_job_id,token_hash,expires_at,created_by) SELECT $1,$2,id,$4,COALESCE(scheduled_start_at,NOW())+INTERVAL '24 hours',$5 FROM field_jobs WHERE id=$3 AND tenant_id=$1 AND branch_id=$2 AND client_id IS NOT NULL").bind(tenant).bind(branch).bind(job).bind(token_hash).bind(actor).execute(db).await?.rows_affected()==1)
}

pub async fn public_tracking(db: &PgPool, token_hash: &str) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"SELECT jsonb_build_object('appointmentId',j.appointment_id,'status',j.status,'scheduledStartAt',j.scheduled_start_at,'travelMinutes',j.travel_minutes,'remainingEtaSeconds',j.remaining_eta_seconds,'lastLocationAt',j.last_location_at,'completedAt',j.completed_at,'staffName',COALESCE(NULLIF(TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),''),'Assigned professional')) FROM field_job_tracking_links l JOIN field_jobs j ON j.id=l.field_job_id AND j.tenant_id=l.tenant_id AND j.branch_id=l.branch_id LEFT JOIN staff s ON s.id=j.staff_id AND s.tenant_id=j.tenant_id AND s.branch_id=j.branch_id WHERE l.token_hash=$1 AND l.revoked_at IS NULL AND l.expires_at>NOW()"#).bind(token_hash).fetch_optional(db).await
}

pub async fn marketplace_summary(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    Ok(sqlx::query("SELECT c.id,c.provider,c.display_name,c.external_account_id,c.status,c.secret_last_four,c.last_success_at,c.last_error,c.created_at,COUNT(e.id) FILTER(WHERE e.status='failed')::BIGINT failed_events FROM marketplace_connections c LEFT JOIN marketplace_webhook_events e ON e.connection_id=c.id WHERE c.tenant_id=$1 AND c.branch_id=$2 GROUP BY c.id ORDER BY c.created_at DESC").bind(tenant).bind(branch).fetch_all(db).await?.into_iter().map(|r|json!({"id":r.get::<String,_>("id"),"provider":r.get::<String,_>("provider"),"displayName":r.get::<String,_>("display_name"),"externalAccountId":r.get::<String,_>("external_account_id"),"status":r.get::<String,_>("status"),"secretLastFour":r.get::<String,_>("secret_last_four"),"lastSuccessAt":r.get::<Option<chrono::DateTime<chrono::Utc>>,_>("last_success_at"),"lastError":r.get::<Option<String>,_>("last_error"),"failedEvents":r.get::<i64,_>("failed_events"),"createdAt":r.get::<chrono::DateTime<chrono::Utc>,_>("created_at")})).collect())
}

pub async fn failed_marketplace_events(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    Ok(sqlx::query("SELECT id,connection_id,provider_event_id,event_type,attempts,max_attempts,last_error,next_attempt_at,received_at FROM marketplace_webhook_events WHERE tenant_id=$1 AND branch_id=$2 AND status='failed' ORDER BY next_attempt_at,received_at LIMIT 100").bind(tenant).bind(branch).fetch_all(db).await?.into_iter().map(|r|json!({"id":r.get::<String,_>("id"),"connectionId":r.get::<String,_>("connection_id"),"providerEventId":r.get::<String,_>("provider_event_id"),"eventType":r.get::<String,_>("event_type"),"attempts":r.get::<i32,_>("attempts"),"maxAttempts":r.get::<i32,_>("max_attempts"),"lastError":r.get::<Option<String>,_>("last_error"),"nextAttemptAt":r.get::<chrono::DateTime<chrono::Utc>,_>("next_attempt_at"),"receivedAt":r.get::<chrono::DateTime<chrono::Utc>,_>("received_at")})).collect())
}

pub async fn insert_connection(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    provider: &str,
    name: &str,
    account: &str,
    ciphertext: &str,
    last_four: &str,
    actor: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO marketplace_connections(tenant_id,branch_id,provider,display_name,external_account_id,secret_ciphertext,secret_last_four,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id").bind(tenant).bind(branch).bind(provider).bind(name).bind(account).bind(ciphertext).bind(last_four).bind(actor).fetch_one(db).await
}

pub async fn connection_secret(
    db: &PgPool,
    id: &str,
) -> Result<Option<(String, String, String, String)>, sqlx::Error> {
    sqlx::query_as("SELECT tenant_id,branch_id,secret_ciphertext,status FROM marketplace_connections WHERE id=$1").bind(id).fetch_optional(db).await
}

pub async fn record_marketplace_event(
    db: &PgPool,
    connection: &str,
    tenant: &str,
    branch: &str,
    event_id: &str,
    event_type: &str,
    payload: &Value,
) -> Result<(String, bool), sqlx::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    let row=sqlx::query("INSERT INTO marketplace_webhook_events(id,connection_id,tenant_id,branch_id,provider_event_id,event_type,payload_json) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(connection_id,provider_event_id) DO NOTHING RETURNING id").bind(&id).bind(connection).bind(tenant).bind(branch).bind(event_id).bind(event_type).bind(payload).fetch_optional(db).await?;
    let inserted = row.is_some();
    let resolved=match row{Some(row)=>row.get::<String,_>("id"),None=>sqlx::query_scalar("SELECT id FROM marketplace_webhook_events WHERE connection_id=$1 AND provider_event_id=$2").bind(connection).bind(event_id).fetch_one(db).await?};
    Ok((resolved, inserted))
}

pub async fn marketplace_event_status(
    db: &PgPool,
    id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT status FROM marketplace_webhook_events WHERE id=$1")
        .bind(id)
        .fetch_optional(db)
        .await
}

pub async fn marketplace_event_for_retry(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<(String, Value, i32, i32)>, sqlx::Error> {
    sqlx::query_as("SELECT connection_id,payload_json,attempts,max_attempts FROM marketplace_webhook_events WHERE id=$3 AND tenant_id=$1 AND branch_id=$2 AND status='failed'").bind(tenant).bind(branch).bind(id).fetch_optional(db).await
}

pub async fn due_marketplace_retries(
    db: &PgPool,
    limit: i64,
) -> Result<Vec<(String, String, String)>, sqlx::Error> {
    sqlx::query_as("SELECT id,tenant_id,branch_id FROM marketplace_webhook_events WHERE status='failed' AND attempts<max_attempts AND next_attempt_at<=NOW() ORDER BY next_attempt_at LIMIT $1").bind(limit).fetch_all(db).await
}

pub async fn field_job_for_appointment(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    appointment: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT id FROM field_jobs WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=$3 AND status<>'cancelled' ORDER BY created_at LIMIT 1").bind(tenant).bind(branch).bind(appointment).fetch_optional(db).await
}

pub async fn mark_marketplace_event(
    db: &PgPool,
    id: &str,
    status: &str,
    error: Option<&str>,
    appointment: Option<&str>,
    job: Option<&str>,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let connection:Option<String>=sqlx::query_scalar("UPDATE marketplace_webhook_events SET status=$2,attempts=attempts+1,last_error=$3,appointment_id=COALESCE($4,appointment_id),field_job_id=COALESCE($5,field_job_id),processed_at=CASE WHEN $2 IN ('completed','duplicate') THEN NOW() ELSE processed_at END,next_attempt_at=NOW()+LEAST(POWER(2,attempts),60)*INTERVAL '1 minute' WHERE id=$1 RETURNING connection_id").bind(id).bind(status).bind(error).bind(appointment).bind(job).fetch_optional(&mut *tx).await?;
    if let Some(connection) = connection {
        sqlx::query("UPDATE marketplace_connections SET last_success_at=CASE WHEN $2 IN ('completed','duplicate') THEN NOW() ELSE last_success_at END,last_error=CASE WHEN $2 IN ('completed','duplicate') THEN NULL ELSE $3 END,updated_at=NOW() WHERE id=$1").bind(connection).bind(status).bind(error).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn marketplace_existing_appointment(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    booking: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT id FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND source='marketplace' AND booking_group_id=$3 ORDER BY created_at LIMIT 1").bind(tenant).bind(branch).bind(booking).fetch_optional(db).await
}

pub async fn availability(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    from: chrono::DateTime<chrono::Utc>,
    to: chrono::DateTime<chrono::Utc>,
) -> Result<Value, sqlx::Error> {
    let services=sqlx::query("SELECT id,name,duration_minutes,price_paise FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY name").bind(tenant).bind(branch).fetch_all(db).await?.into_iter().map(|r|json!({"id":r.get::<String,_>("id"),"name":r.get::<String,_>("name"),"durationMinutes":r.get::<i32,_>("duration_minutes"),"pricePaise":r.get::<i64,_>("price_paise")})).collect::<Vec<_>>();
    let staff=sqlx::query("SELECT id,CONCAT_WS(' ',first_name,last_name) name FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY first_name,last_name").bind(tenant).bind(branch).fetch_all(db).await?.into_iter().map(|r|json!({"id":r.get::<String,_>("id"),"name":r.get::<String,_>("name")})).collect::<Vec<_>>();
    let busy=sqlx::query("SELECT id,staff_id,start_at,end_at,status FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND start_at<$4 AND end_at>$3 AND status NOT IN ('cancelled','no_show') ORDER BY start_at").bind(tenant).bind(branch).bind(from).bind(to).fetch_all(db).await?.into_iter().map(|r|json!({"appointmentId":r.get::<String,_>("id"),"staffId":r.get::<Option<String>,_>("staff_id"),"startAt":r.get::<chrono::DateTime<chrono::Utc>,_>("start_at"),"endAt":r.get::<chrono::DateTime<chrono::Utc>,_>("end_at"),"status":r.get::<String,_>("status")})).collect::<Vec<_>>();
    Ok(json!({"from":from,"to":to,"services":services,"staff":staff,"busy":busy}))
}

pub async fn escalate_overdue(db: &PgPool) -> Result<u64, sqlx::Error> {
    let mut tx = db.begin().await?;
    let rows=sqlx::query("UPDATE field_jobs SET escalation_level=LEAST(escalation_level+1,5),escalated_at=NOW(),updated_at=NOW() WHERE status NOT IN ('completed','cancelled') AND sla_due_at<NOW() AND (escalated_at IS NULL OR escalated_at<NOW()-INTERVAL '30 minutes') RETURNING id,tenant_id,branch_id,priority,sla_due_at,escalation_level").fetch_all(&mut *tx).await?;
    for r in &rows {
        let id = r.get::<String, _>("id");
        sqlx::query("INSERT INTO notifications(tenant_id,branch_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json) VALUES($1,$2,'system','operations_sla','Field job overdue','A field job exceeded its SLA.','field_job',$3,$4)").bind(r.get::<String,_>("tenant_id")).bind(r.get::<String,_>("branch_id")).bind(&id).bind(json!({"route":"/operations","jobId":id,"priority":r.get::<i16,_>("priority"),"slaDueAt":r.get::<chrono::DateTime<chrono::Utc>,_>("sla_due_at"),"escalationLevel":r.get::<i16,_>("escalation_level")})).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(rows.len() as u64)
}
