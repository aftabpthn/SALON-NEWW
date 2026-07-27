use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{models::common::AppError, services::staff_enterprise_service};

#[derive(Clone, Copy)]
pub struct StaffBusinessVisibility {
    pub client_name: bool,
    pub invoice_number: bool,
    pub discount: bool,
    pub tax: bool,
    pub service_amount: bool,
    pub commission: bool,
}

impl StaffBusinessVisibility {
    pub fn financial(self) -> bool {
        self.discount || self.tax || self.service_amount
    }

    pub fn invoice_detail(self) -> bool {
        self.client_name || self.invoice_number || self.financial() || self.commission
    }
}

#[allow(clippy::too_many_arguments)]
async fn self_service_lines(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    invoice_id: &str,
    query: &str,
    descending: bool,
    offset: i64,
    limit: i64,
    visible: StaffBusinessVisibility,
) -> Result<Value, AppError> {
    sqlx::query_scalar::<_, Value>(
        r#"WITH service_base AS (
              SELECT sale.id sale_id,sale.invoice_number,sale.reference_id appointment_id,sale.status,
                     COALESCE(sale.business_date,COALESCE(sale.finalized_at,sale.created_at)::DATE) business_date,
                     sale.created_at,COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),'Walk-in client') client_name,
                     line.id line_id,line.item_name service_name,line.quantity,line.gross_paise,line.discount_paise,
                     line.taxable_paise,line.tax_percent,line.gst_paise,line.cgst_paise,line.sgst_paise,line.igst_paise,
                     line.line_total_paise,line.tax_inclusive,line.staff_id,line.staff_splits,
                     COALESCE((SELECT SUM(refund.amount_paise) FROM pos_invoice_refund_lines refund
                       WHERE refund.tenant_id=$1 AND refund.branch_id=$2 AND refund.sale_id=sale.id AND refund.sale_line_id=line.id),0)::BIGINT refund_paise
                FROM pos_sales sale
                JOIN pos_sale_lines line ON line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id
                LEFT JOIN clients client ON client.tenant_id=sale.tenant_id AND client.branch_id=sale.branch_id AND client.id=sale.client_id
               WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND line.line_type='service' AND sale.is_deleted=FALSE
                 AND LOWER(sale.status) NOT IN ('draft','cancelled','voided')
                 AND ($4::DATE IS NULL OR COALESCE(sale.business_date,COALESCE(sale.finalized_at,sale.created_at)::DATE)>=$4)
                 AND ($5::DATE IS NULL OR COALESCE(sale.business_date,COALESCE(sale.finalized_at,sale.created_at)::DATE)<=$5)
                 AND ($6='' OR sale.id=$6)
                 AND ($7='' OR line.item_name ILIKE '%'||$7||'%' OR sale.invoice_number ILIKE '%'||$7||'%'
                   OR ($11 AND BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)) ILIKE '%'||$7||'%'))
            ), attributed AS (
              SELECT base.*,
                     COALESCE(NULLIF(split.value->>'staffId',''),NULLIF(split.value->>'staff_id',''),base.staff_id,'') attributed_staff_id,
                     COALESCE(ROUND((NULLIF(split.value->>'percent',''))::NUMERIC)::BIGINT,100) split_percent
                FROM service_base base
                CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
                  CASE WHEN JSONB_ARRAY_LENGTH(COALESCE(base.staff_splits,'[]'::JSONB))>0 THEN base.staff_splits
                       ELSE JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('staffId',base.staff_id,'percent',100)) END
                ) split(value)
            ), valued AS (
              SELECT attributed.*,
                     ((gross_paise*split_percent+50)/100)::BIGINT staff_gross_paise,
                     ((discount_paise*split_percent+50)/100)::BIGINT staff_discount_paise,
                     ((taxable_paise*split_percent+50)/100)::BIGINT staff_taxable_paise,
                     ((gst_paise*split_percent+50)/100)::BIGINT staff_gst_paise,
                     ((cgst_paise*split_percent+50)/100)::BIGINT staff_cgst_paise,
                     ((sgst_paise*split_percent+50)/100)::BIGINT staff_sgst_paise,
                     ((igst_paise*split_percent+50)/100)::BIGINT staff_igst_paise,
                     ((line_total_paise*split_percent+50)/100)::BIGINT staff_total_paise,
                     ((refund_paise*split_percent+50)/100)::BIGINT staff_refund_paise,
                     COALESCE((SELECT SUM(snapshot.commission_paise) FROM pos_staff_commission_snapshots snapshot
                       WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.sale_id=attributed.sale_id
                         AND snapshot.sale_line_id=attributed.line_id AND snapshot.staff_id=$3),0)::BIGINT commission_paise
                FROM attributed WHERE attributed_staff_id=$3 AND split_percent>0
            ), paged AS (
              SELECT * FROM valued
               ORDER BY CASE WHEN $8 THEN created_at END DESC,CASE WHEN NOT $8 THEN created_at END ASC,line_id
               OFFSET $9 LIMIT $10
            )
            SELECT jsonb_build_object(
              'totalItems',(SELECT COUNT(*) FROM valued),
              'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id',line_id,'saleId',sale_id,'invoiceId',sale_id,'invoiceNumber',CASE WHEN $12 THEN invoice_number ELSE NULL END,
                'appointmentId',appointment_id,'businessDate',business_date,'createdAt',created_at,'status',status,
                'refundStatus',CASE WHEN staff_refund_paise>=staff_total_paise AND staff_total_paise>0 THEN 'refunded'
                  WHEN staff_refund_paise>0 THEN 'partially_refunded' ELSE status END,
                'clientName',CASE WHEN $11 THEN client_name ELSE NULL END,'serviceName',service_name,'quantity',quantity,
                'splitPercent',split_percent,'grossPaise',CASE WHEN $15 THEN staff_gross_paise ELSE NULL END,
                'discountPaise',CASE WHEN $13 THEN staff_discount_paise ELSE NULL END,
                'taxablePaise',CASE WHEN $15 THEN staff_taxable_paise ELSE NULL END,'gstPercent',CASE WHEN $14 THEN tax_percent ELSE NULL END,
                'gstPaise',CASE WHEN $14 THEN staff_gst_paise ELSE NULL END,'cgstPaise',CASE WHEN $14 THEN staff_cgst_paise ELSE NULL END,
                'sgstPaise',CASE WHEN $14 THEN staff_sgst_paise ELSE NULL END,'igstPaise',CASE WHEN $14 THEN staff_igst_paise ELSE NULL END,
                'totalPaise',CASE WHEN $15 THEN staff_total_paise ELSE NULL END,'refundedPaise',CASE WHEN $15 THEN LEAST(staff_refund_paise,staff_total_paise) ELSE NULL END,
                'netTotalPaise',CASE WHEN $15 THEN GREATEST(staff_total_paise-staff_refund_paise,0) ELSE NULL END,
                'taxInclusive',CASE WHEN $14 THEN tax_inclusive ELSE NULL END,
                'taxMode',CASE WHEN NOT $14 OR tax_inclusive IS NULL THEN NULL WHEN tax_inclusive THEN 'inclusive' ELSE 'exclusive' END,
                'commissionPaise',CASE WHEN $16 THEN commission_paise ELSE NULL END
              ) ORDER BY CASE WHEN $8 THEN created_at END DESC,CASE WHEN NOT $8 THEN created_at END ASC,line_id) FROM paged),'[]'::JSONB),
              'totals',jsonb_build_object(
                'bills',(SELECT COUNT(DISTINCT sale_id) FROM valued),
                'grossPaise',CASE WHEN $15 THEN COALESCE((SELECT SUM(staff_gross_paise) FROM valued),0) ELSE NULL END,
                'discountPaise',CASE WHEN $13 THEN COALESCE((SELECT SUM(staff_discount_paise) FROM valued),0) ELSE NULL END,
                'taxablePaise',CASE WHEN $15 THEN COALESCE((SELECT SUM(staff_taxable_paise) FROM valued),0) ELSE NULL END,
                'gstPaise',CASE WHEN $14 THEN COALESCE((SELECT SUM(staff_gst_paise) FROM valued),0) ELSE NULL END,
                'totalPaise',CASE WHEN $15 THEN COALESCE((SELECT SUM(staff_total_paise) FROM valued),0) ELSE NULL END,
                'refundedPaise',CASE WHEN $15 THEN COALESCE((SELECT SUM(LEAST(staff_refund_paise,staff_total_paise)) FROM valued),0) ELSE NULL END,
                'netTotalPaise',CASE WHEN $15 THEN COALESCE((SELECT SUM(GREATEST(staff_total_paise-staff_refund_paise,0)) FROM valued),0) ELSE NULL END,
                'commissionPaise',CASE WHEN $16 THEN COALESCE((SELECT SUM(commission_paise) FROM valued),0) ELSE NULL END))"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(from)
    .bind(to)
    .bind(invoice_id.trim())
    .bind(query.trim())
    .bind(descending)
    .bind(offset.max(0))
    .bind(limit.clamp(1, 500))
    .bind(visible.client_name)
    .bind(visible.invoice_number)
    .bind(visible.discount)
    .bind(visible.tax)
    .bind(visible.service_amount)
    .bind(visible.commission)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff service invoices"))
}

pub async fn workspace_preferences(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
) -> Result<Value, AppError> {
    let staff_id =
        staff_enterprise_service::self_staff_id(db, tenant_id, branch_id, user_id).await?;
    let workspace_name = sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(NULLIF(name,''),'Staff workspace') FROM branches WHERE tenant_id::TEXT=$1 AND id::TEXT=$2 AND active=TRUE",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff workspace preferences"))?
    .ok_or_else(|| AppError::not_found("active staff branch was not found"))?;
    let row = sqlx::query_as::<_, (String, String, String, String, String, bool, bool)>(
        "SELECT workspace_name,timezone,locale,date_format,time_format,compact_mode,staff_hints FROM staff_workspace_preferences WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff workspace preferences"))?;
    let (saved_name, timezone, locale, date_format, time_format, compact_mode, staff_hints) = row
        .unwrap_or_else(|| {
            (
                "".to_string(),
                "Asia/Kolkata".to_string(),
                "en-IN".to_string(),
                "DD/MM/YYYY".to_string(),
                "HH:mm".to_string(),
                false,
                false,
            )
        });
    Ok(json!({
        "workspace":{"workspaceName": if saved_name.trim().is_empty() { workspace_name } else { saved_name }},
        "localization":{"timezone":timezone,"locale":locale},
        "dateTime":{"dateFormat":date_format,"timeFormat":time_format,"businessDayStartHour":0,"weekStartsOn":"monday"},
        "interface":{"compactMode":compact_mode},
        "defaults":{"staffHints":staff_hints}
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePreferenceRequest {
    pub workspace_name: Option<String>,
    pub timezone: Option<String>,
    pub locale: Option<String>,
    pub date_format: Option<String>,
    pub time_format: Option<String>,
    pub compact_mode: Option<bool>,
    pub staff_hints: Option<bool>,
}

pub async fn save_workspace_preferences(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    input: WorkspacePreferenceRequest,
) -> Result<Value, AppError> {
    let staff_id =
        staff_enterprise_service::self_staff_id(db, tenant_id, branch_id, user_id).await?;
    let current = workspace_preferences(db, tenant_id, branch_id, user_id).await?;
    let workspace_name = clean_pref(input.workspace_name, 80).unwrap_or_else(|| {
        current["workspace"]["workspaceName"]
            .as_str()
            .unwrap_or("Staff workspace")
            .to_string()
    });
    let timezone = clean_pref(input.timezone, 64).unwrap_or_else(|| {
        current["localization"]["timezone"]
            .as_str()
            .unwrap_or("Asia/Kolkata")
            .to_string()
    });
    let locale = clean_pref(input.locale, 20).unwrap_or_else(|| {
        current["localization"]["locale"]
            .as_str()
            .unwrap_or("en-IN")
            .to_string()
    });
    let date_format = clean_pref(input.date_format, 20).unwrap_or_else(|| {
        current["dateTime"]["dateFormat"]
            .as_str()
            .unwrap_or("DD/MM/YYYY")
            .to_string()
    });
    let time_format = clean_pref(input.time_format, 20).unwrap_or_else(|| {
        current["dateTime"]["timeFormat"]
            .as_str()
            .unwrap_or("HH:mm")
            .to_string()
    });
    let compact_mode = input.compact_mode.unwrap_or_else(|| {
        current["interface"]["compactMode"]
            .as_bool()
            .unwrap_or(false)
    });
    let staff_hints = input
        .staff_hints
        .unwrap_or_else(|| current["defaults"]["staffHints"].as_bool().unwrap_or(false));
    sqlx::query(
        r#"INSERT INTO staff_workspace_preferences(tenant_id,branch_id,staff_id,workspace_name,timezone,locale,date_format,time_format,compact_mode,staff_hints)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT(tenant_id,branch_id,staff_id) DO UPDATE SET
             workspace_name=EXCLUDED.workspace_name,timezone=EXCLUDED.timezone,locale=EXCLUDED.locale,
             date_format=EXCLUDED.date_format,time_format=EXCLUDED.time_format,
             compact_mode=EXCLUDED.compact_mode,staff_hints=EXCLUDED.staff_hints,updated_at=NOW()"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .bind(workspace_name)
    .bind(timezone)
    .bind(locale)
    .bind(date_format)
    .bind(time_format)
    .bind(compact_mode)
    .bind(staff_hints)
    .execute(db)
    .await
    .map_err(|_| AppError::internal("failed to save staff workspace preferences"))?;
    workspace_preferences(db, tenant_id, branch_id, user_id).await
}

fn clean_pref(value: Option<String>, max_len: usize) -> Option<String> {
    value
        .map(|raw| raw.trim().chars().take(max_len).collect::<String>())
        .filter(|value| !value.is_empty())
}

pub async fn enterprise_os(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Value, AppError> {
    if to < from || (to - from).num_days() > 62 {
        return Err(AppError::validation(
            "staff date range must be 63 days or less",
        ));
    }
    let staff_id =
        staff_enterprise_service::self_staff_id(db, tenant_id, branch_id, user_id).await?;
    let staff = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
              'id',staff.id,'fullName',COALESCE(NULLIF(staff.appointment_display_name,''),TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name))),
              'firstName',staff.first_name,'lastName',staff.last_name,'mobile',staff.mobile_phone,'email',staff.email,
              'roleId','','department',COALESCE((SELECT profile.department FROM staff_profiles profile
                WHERE profile.tenant_id=staff.tenant_id AND profile.branch_id=staff.branch_id AND profile.staff_id=staff.id),''),'designation',staff.job_title,
              'status',CASE WHEN staff.active THEN 'active' ELSE 'inactive' END)
            FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff profile"))?;
    let appointments = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
              'id',appointment.id,'staffId',appointment.staff_id,'branchId',appointment.branch_id,
              'serviceIds',COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb,
              'serviceNames',COALESCE((SELECT jsonb_agg(service.name ORDER BY service.name)
                FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))),'[]'::jsonb),
              'durationMinutes',GREATEST(0,EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60),
              'value',COALESCE((SELECT SUM(service.price_paise) FROM services service
                WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))),0),
              'startAt',appointment.start_at,'endAt',appointment.end_at,'status',appointment.status,
              'chair','','source',appointment.source)
            FROM appointments appointment
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.staff_id=$3
              AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5
            ORDER BY appointment.start_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff enterprise appointments"))?;
    let calendar = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
              'id',id,'date',schedule_date,'startTime',shift1_start,'endTime',shift1_end,
              'type','shift','status',status,'version',version)
            FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
              AND schedule_date BETWEEN $4 AND $5 ORDER BY schedule_date"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff calendar"))?;
    let tasks = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object('id',id,'title',title,'priority',priority,'status',status,
              'dueAt',due_at,'assignedBy',assigned_by,'checklist','[]'::jsonb)
            FROM staff_tasks WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
              AND status IN ('open','in_progress','blocked') ORDER BY due_at NULLS LAST,created_at LIMIT 100"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff tasks"))?;
    let notifications = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object('id',id,'title',title,'body',body,
              'status',CASE WHEN is_read THEN 'read' ELSE 'unread' END,'createdAt',created_at)
            FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND (user_id='' OR user_id=$3)
            ORDER BY created_at DESC LIMIT 50"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff notifications"))?;
    let (revenue, completed_services, worked_minutes, scheduled_minutes, rating) =
        sqlx::query_as::<_, (i64, i64, i64, i64, Option<f64>)>(
        r#"SELECT
              COALESCE((SELECT SUM(snapshot.base_paise) FROM pos_staff_commission_snapshots snapshot
                WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3
                  AND snapshot.business_date BETWEEN $4 AND $5),0)::BIGINT,
              COUNT(*) FILTER(WHERE LOWER(appointment.status) IN ('completed','billed','paid'))::BIGINT,
              COALESCE(SUM(EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60)
                FILTER(WHERE LOWER(appointment.status) IN ('completed','billed','paid')),0)::BIGINT,
              COALESCE(SUM(EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60),0)::BIGINT,
              (SELECT ROUND(AVG(review.score)::NUMERIC/20,1)::DOUBLE PRECISION
                 FROM staff_performance_reviews review
                WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.staff_id=$3
                  AND review.status IN ('shared','acknowledged','closed')
                  AND review.period_start<=$5 AND review.period_end>=$4)
            FROM appointments appointment WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2
              AND appointment.staff_id=$3 AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .bind(from)
    .bind(to)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff enterprise performance"))?;
    let utilization = if scheduled_minutes > 0 {
        Some(((worked_minutes * 100) / scheduled_minutes).clamp(0, 100))
    } else {
        None
    };
    let productivity_score = utilization;
    let target_progress = sqlx::query_scalar::<_, Value>(
        r#"WITH target AS (
             SELECT id,service_id,service_name,target_count,starts_on,ends_on,
                    COALESCE((
                      SELECT SUM(line.quantity)::BIGINT
                        FROM pos_sale_lines line
                        JOIN pos_sales sale ON sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id AND sale.id=line.sale_id
                       WHERE line.tenant_id=staff_service_targets.tenant_id AND line.branch_id=staff_service_targets.branch_id
                         AND line.line_type='service' AND line.item_id=staff_service_targets.service_id
                         AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN staff_service_targets.starts_on AND staff_service_targets.ends_on
                         AND sale.status NOT IN ('draft','cancelled','voided','refunded')
                         AND (line.staff_id=$3 OR EXISTS (
                           SELECT 1 FROM JSONB_ARRAY_ELEMENTS(COALESCE(line.staff_splits,'[]'::JSONB)) split(value)
                           WHERE split.value->>'staffId'=$3
                         ))
                    ),0)::BIGINT achieved_count
               FROM staff_service_targets
              WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND status='active'
                AND CURRENT_DATE BETWEEN starts_on AND ends_on
              ORDER BY ends_on,created_at LIMIT 1
           )
           SELECT jsonb_build_object(
             'label',target.service_name,'targetValue',target.target_count,'achievedValue',target.achieved_count,
             'percentage',LEAST(100,target.achieved_count*100/target.target_count),
             'remaining',GREATEST(target.target_count-target.achieved_count,0)
           )
           FROM target"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff target progress"))?
    .unwrap_or(Value::Null);
    let expected_revenue = appointments
        .iter()
        .filter(|row| {
            !matches!(
                row.get("status").and_then(Value::as_str),
                Some("cancelled" | "canceled" | "void")
            )
        })
        .filter_map(|row| row.get("value").and_then(Value::as_i64))
        .sum::<i64>();
    let now = Utc::now();
    let timeline = appointments
        .iter()
        .map(|appointment| {
            let start = appointment.get("startAt").cloned().unwrap_or(Value::Null);
            let end = appointment.get("endAt").cloned().unwrap_or(Value::Null);
            json!({
                "id":appointment["id"],"serviceNames":appointment["serviceNames"],
                "startAt":start,"endAt":end,"status":appointment["status"],"state":appointment["status"],
                "minutesToStart":0,"durationMinutes":appointment["durationMinutes"]
            })
        })
        .collect::<Vec<_>>();
    let days = (to - from).num_days() + 1;
    Ok(json!({
        "staff":staff,
        "home":{
            "greeting":"","todayAppointments":appointments.len(),"expectedRevenue":expected_revenue,
            "tasks":tasks.len(),"pendingPayments":0,"recentNotifications":notifications.iter().filter(|row|row["status"]=="unread").count(),
            "targetProgress":target_progress
        },
        "timeline":timeline,"serviceTimers":[],
        "performance":{"revenue":revenue,"completedServices":completed_services,"avgUtilization":utilization,"avgRating":rating,"productivityScore":productivity_score,"strengths":[],"opportunities":[]},
        "leaderboard":[],
        "gamification":{"points":0,"level":0,"stars":0,"dailyStreak":0,"monthlyStreak":0,"badges":[]},
        "notifications":notifications,"tasks":tasks,"calendar":calendar,
        "reports":{"selected":{"days":days,"revenue":revenue,"services":completed_services,"productivityScore":productivity_score,"rating":rating}},
        "generatedAt":now,"workedMinutes":worked_minutes
    }))
}

#[allow(clippy::too_many_arguments)]
pub async fn business(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    page: i64,
    page_size: i64,
    query: &str,
    status: &str,
    sort: &str,
    visible: StaffBusinessVisibility,
    earnings_visible: bool,
) -> Result<Value, AppError> {
    if to < from || (to - from).num_days() > 92 {
        return Err(AppError::validation(
            "staff business range must be 93 days or less",
        ));
    }
    let staff_id =
        staff_enterprise_service::self_staff_id(db, tenant_id, branch_id, user_id).await?;
    let page = page.max(1);
    let page_size = page_size.clamp(1, 100);
    let status = match status.trim().to_ascii_lowercase().as_str() {
        "all" => String::new(),
        value => value.to_string(),
    };
    let query = query.trim().to_ascii_lowercase();
    let descending = sort != "asc";
    let appointment_total = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM appointments appointment
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.staff_id=$3
              AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5
              AND ($6='' OR LOWER(appointment.status)=$6)
              AND ($7='' OR LOWER(appointment.id||' '||appointment.notes) LIKE '%'||$7||'%'
                OR EXISTS(SELECT 1 FROM services service WHERE service.tenant_id=appointment.tenant_id
                  AND service.branch_id=appointment.branch_id AND LOWER(service.name) LIKE '%'||$7||'%'
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))))"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to).bind(&status).bind(&query)
    .fetch_one(db).await.map_err(|_| AppError::internal("failed to count staff business appointments"))?;
    let appointments = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
              'id',appointment.id,'staffId',appointment.staff_id,'branchId',appointment.branch_id,
              'serviceIds',COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb,
              'serviceNames',COALESCE((SELECT jsonb_agg(service.name ORDER BY service.name) FROM services service
                WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))),'[]'::jsonb),
              'durationMinutes',GREATEST(0,EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60),
              'value',COALESCE((SELECT SUM(service.price_paise) FROM services service
                WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))),0),
              'startAt',appointment.start_at,'endAt',appointment.end_at,'status',appointment.status,'chair','',
              'source',appointment.source,'businessDate',(appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE,
              'state',appointment.status,
              'workedMinutes',CASE WHEN LOWER(appointment.status) IN ('completed','billed','paid')
                THEN GREATEST(0,EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60) ELSE 0 END,
              'timer',jsonb_build_object('appointmentId',appointment.id,'status',appointment.status,'live',FALSE,
                'startedAt',NULL,'completedAt',NULL,'timeSource','estimated','elapsedMinutes',0,
                'totalMinutes',GREATEST(0,EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60),
                'remainingMinutes',0,'overrunMinutes',0,'progress',0),
              'billing',NULL,
              'attribution',NULL)
            FROM appointments appointment
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.staff_id=$3
              AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5
              AND ($6='' OR LOWER(appointment.status)=$6)
              AND ($7='' OR LOWER(appointment.id||' '||appointment.notes) LIKE '%'||$7||'%'
                OR EXISTS(SELECT 1 FROM services service WHERE service.tenant_id=appointment.tenant_id
                  AND service.branch_id=appointment.branch_id AND LOWER(service.name) LIKE '%'||$7||'%'
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))))
            ORDER BY CASE WHEN $8 THEN appointment.start_at END DESC,CASE WHEN NOT $8 THEN appointment.start_at END ASC
            OFFSET $9 LIMIT $10"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to).bind(&status).bind(&query)
    .bind(descending).bind((page - 1) * page_size).bind(page_size)
    .fetch_all(db).await.map_err(|_| AppError::internal("failed to load staff business appointments"))?;
    let service_data = self_service_lines(
        db,
        tenant_id,
        branch_id,
        &staff_id,
        Some(from),
        Some(to),
        "",
        &query,
        descending,
        (page - 1) * page_size,
        page_size,
        visible,
    )
    .await?;
    let service_total = service_data["totalItems"].as_i64().unwrap_or_default();
    let staff = enterprise_os(db, tenant_id, branch_id, user_id, from, to).await?["staff"].clone();
    let mut summary = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
              'appointments',COUNT(*),'completedServices',COUNT(*) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),
              'scheduledMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60),0),
              'completedMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),0),
              'workedMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),0),
              'bills',COALESCE((SELECT COUNT(DISTINCT sale.id) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2
                AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'subtotalPaise',COALESCE((SELECT SUM(sale.subtotal_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'discountPaise',COALESCE((SELECT SUM(sale.discount_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'couponDiscountPaise',0,'afterDiscountPaise',0,
              'gstPaise',COALESCE((SELECT SUM(sale.tax_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'totalPaise',COALESCE((SELECT SUM(sale.total_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'paidPaise',COALESCE((SELECT SUM(sale.paid_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'duePaise',COALESCE((SELECT SUM(GREATEST(sale.total_paise-sale.paid_paise,0)) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0))
            FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
              AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to)
    .fetch_one(db).await.map_err(|_| AppError::internal("failed to load staff business summary"))?;
    let service_totals = &service_data["totals"];
    summary["bills"] = service_totals["bills"].clone();
    summary["subtotalPaise"] = service_totals["grossPaise"].clone();
    summary["discountPaise"] = service_totals["discountPaise"].clone();
    summary["couponDiscountPaise"] = Value::Null;
    summary["afterDiscountPaise"] = service_totals["taxablePaise"].clone();
    summary["gstPaise"] = service_totals["gstPaise"].clone();
    summary["totalPaise"] = service_totals["netTotalPaise"].clone();
    summary["paidPaise"] = Value::Null;
    summary["duePaise"] = Value::Null;
    let services = sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object('id',id,'name',name) FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY name,id",
    )
    .bind(tenant_id).bind(branch_id).fetch_all(db).await
    .map_err(|_| AppError::internal("failed to load staff business services"))?;
    let mut performance = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'statusCounts',(SELECT jsonb_build_object(
            'booked',COUNT(*) FILTER(WHERE LOWER(status) IN ('booked','scheduled','pending','queued')),
            'confirmed',COUNT(*) FILTER(WHERE LOWER(status)='confirmed'),
            'arrived',COUNT(*) FILTER(WHERE LOWER(status) IN ('arrived','checked-in','checked_in')),
            'inService',COUNT(*) FILTER(WHERE LOWER(status) IN ('in-service','in service','inprogress','in progress','started','active','running')),
            'completed',COUNT(*) FILTER(WHERE LOWER(status) IN ('completed','billed','paid','checked-out','checked_out','checkout','done')),
            'cancelled',COUNT(*) FILTER(WHERE LOWER(status) IN ('cancelled','canceled','voided')),
            'noShow',COUNT(*) FILTER(WHERE LOWER(status) IN ('no-show','no show','noshow')),
            'other',COUNT(*) FILTER(WHERE LOWER(status) NOT IN ('booked','scheduled','pending','queued','confirmed','arrived','checked-in','checked_in','in-service','in service','inprogress','in progress','started','active','running','completed','billed','paid','checked-out','checked_out','checkout','done','cancelled','canceled','voided','no-show','no show','noshow')))
            FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5),
          'invoiceCount',COALESCE((SELECT COUNT(*) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND COALESCE(business_date,created_at::DATE) BETWEEN $4 AND $5 AND status NOT IN ('draft','cancelled','voided')),0),
          'actualWorkedMinutes',COALESCE((SELECT SUM(worked_minutes) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0),
          'estimatedWorkedMinutes',$6::BIGINT,
          'attendanceMinutes',COALESCE((SELECT SUM(worked_minutes+break_minutes) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0),
          'breakMinutes',COALESCE((SELECT SUM(break_minutes) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0),
          'dutyMinutes',$7::BIGINT,
          'utilizationPercent',CASE WHEN $7::BIGINT>0 THEN ROUND(COALESCE((SELECT SUM(worked_minutes) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0)::NUMERIC*100/$7::BIGINT,1) ELSE NULL END,
          'attributedGrossPaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(base_paise) FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0) ELSE NULL END,
          'attributedDiscountPaise',CASE WHEN $8 THEN 0 ELSE NULL END,'attributedCouponDiscountPaise',CASE WHEN $8 THEN 0 ELSE NULL END,
          'attributedAfterDiscountPaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(base_paise) FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0) ELSE NULL END,
          'attributedGstPaise',CASE WHEN $8 THEN 0 ELSE NULL END,'attributedPaidPaise',CASE WHEN $8 THEN $9::BIGINT ELSE NULL END,
          'attributedDuePaise',CASE WHEN $8 THEN $10::BIGINT ELSE NULL END,
          'averageBillPaise',CASE WHEN $8 AND $11::BIGINT>0 THEN $12::BIGINT/$11::BIGINT ELSE NULL END,
          'revenuePerWorkedHourPaise',CASE WHEN $8 AND $6::BIGINT>0 THEN $12::BIGINT*60/$6::BIGINT ELSE NULL END,
          'serviceRevenuePaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(snapshot.base_paise) FROM pos_staff_commission_snapshots snapshot JOIN pos_sale_lines line ON line.id=snapshot.sale_line_id WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3 AND snapshot.business_date BETWEEN $4 AND $5 AND line.line_type='service'),0) ELSE NULL END,
          'productRevenuePaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(snapshot.base_paise) FROM pos_staff_commission_snapshots snapshot JOIN pos_sale_lines line ON line.id=snapshot.sale_line_id WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3 AND snapshot.business_date BETWEEN $4 AND $5 AND line.line_type='product'),0) ELSE NULL END,
          'membershipRevenuePaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(snapshot.base_paise) FROM pos_staff_commission_snapshots snapshot JOIN pos_sale_lines line ON line.id=snapshot.sale_line_id WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3 AND snapshot.business_date BETWEEN $4 AND $5 AND line.line_type='membership'),0) ELSE NULL END,
          'packageRevenuePaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(snapshot.base_paise) FROM pos_staff_commission_snapshots snapshot JOIN pos_sale_lines line ON line.id=snapshot.sale_line_id WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3 AND snapshot.business_date BETWEEN $4 AND $5 AND line.line_type='package'),0) ELSE NULL END,
          'giftCardRevenuePaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(snapshot.base_paise) FROM pos_staff_commission_snapshots snapshot JOIN pos_sale_lines line ON line.id=snapshot.sale_line_id WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3 AND snapshot.business_date BETWEEN $4 AND $5 AND line.line_type='gift_card'),0) ELSE NULL END)"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to)
    .bind(summary["workedMinutes"].as_i64().unwrap_or_default())
    .bind(summary["scheduledMinutes"].as_i64().unwrap_or_default()).bind(visible.service_amount)
    .bind(summary["paidPaise"].as_i64().unwrap_or_default()).bind(summary["duePaise"].as_i64().unwrap_or_default())
    .bind(summary["bills"].as_i64().unwrap_or_default()).bind(summary["totalPaise"].as_i64().unwrap_or_default())
    .fetch_one(db).await.map_err(|_| AppError::internal("failed to load staff business performance"))?;
    performance["invoiceCount"] = service_totals["bills"].clone();
    performance["attributedGrossPaise"] = service_totals["grossPaise"].clone();
    performance["attributedDiscountPaise"] = service_totals["discountPaise"].clone();
    performance["attributedCouponDiscountPaise"] = Value::Null;
    performance["attributedAfterDiscountPaise"] = service_totals["taxablePaise"].clone();
    performance["attributedGstPaise"] = service_totals["gstPaise"].clone();
    performance["attributedPaidPaise"] = Value::Null;
    performance["attributedDuePaise"] = Value::Null;
    performance["averageBillPaise"] =
        if visible.service_amount && summary["bills"].as_i64().unwrap_or_default() > 0 {
            json!(
                summary["totalPaise"].as_i64().unwrap_or_default()
                    / summary["bills"].as_i64().unwrap_or(1)
            )
        } else {
            Value::Null
        };
    let daily_breakdown = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object('date',(start_at AT TIME ZONE 'Asia/Kolkata')::DATE,
          'appointments',COUNT(*),'completedServices',COUNT(*) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),
          'scheduledMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60),0),
          'completedMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),0),
          'workedMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),0),
          'bills',0,'subtotalPaise',0,'discountPaise',0,'couponDiscountPaise',0,'afterDiscountPaise',0,'gstPaise',0,'totalPaise',0,'paidPaise',0,'duePaise',0,
          'performance',jsonb_build_object('statusCounts',jsonb_build_object(),'invoiceCount',0,'actualWorkedMinutes',0,
            'estimatedWorkedMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),0),
            'attendanceMinutes',0,'breakMinutes',0,'dutyMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60),0),'utilizationPercent',NULL))
          FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5
          GROUP BY (start_at AT TIME ZONE 'Asia/Kolkata')::DATE ORDER BY (start_at AT TIME ZONE 'Asia/Kolkata')::DATE DESC"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to)
    .fetch_all(db).await.map_err(|_| AppError::internal("failed to load staff daily business breakdown"))?;
    let earnings = if earnings_visible {
        Some(sqlx::query_scalar::<_, Value>(
            r#"SELECT jsonb_build_object(
              'calculatedCommissionPaise',COALESCE((SELECT SUM(commission_paise) FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0),
              'approvedCommissionPaise',COALESCE((SELECT SUM(commission_paise) FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0),
              'tipsCollectedPaise',COALESCE((SELECT SUM(tip_paise) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND COALESCE(business_date,created_at::DATE) BETWEEN $4 AND $5 AND status NOT IN ('draft','voided','cancelled','refunded')),0),
              'tipsPaidPaise',COALESCE((SELECT SUM(amount_paise) FROM staff_tip_payouts WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND period_start<=$5 AND period_end>=$4),0),
              'tipsPendingPaise',GREATEST(COALESCE((SELECT SUM(tip_paise) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND COALESCE(business_date,created_at::DATE) BETWEEN $4 AND $5 AND status NOT IN ('draft','voided','cancelled','refunded')),0)-COALESCE((SELECT SUM(amount_paise) FROM staff_tip_payouts WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND period_start<=$5 AND period_end>=$4),0),0),
              'payrollGrossPaise',COALESCE((SELECT SUM(item.gross_paise) FROM staff_payroll_items item JOIN staff_payroll_runs run ON run.id=item.payroll_run_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.staff_id=$3 AND run.period_start<=$5 AND run.period_end>=$4),0),
              'payrollNetPaise',COALESCE((SELECT SUM(item.net_paise) FROM staff_payroll_items item JOIN staff_payroll_runs run ON run.id=item.payroll_run_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.staff_id=$3 AND run.period_start<=$5 AND run.period_end>=$4),0),
              'payrollPaidPaise',COALESCE((SELECT SUM(item.net_paise) FROM staff_payroll_items item JOIN staff_payroll_runs run ON run.id=item.payroll_run_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.staff_id=$3 AND run.period_start<=$5 AND run.period_end>=$4 AND run.status='paid'),0),
              'payrollPendingPaise',COALESCE((SELECT SUM(item.net_paise) FROM staff_payroll_items item JOIN staff_payroll_runs run ON run.id=item.payroll_run_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.staff_id=$3 AND run.period_start<=$5 AND run.period_end>=$4 AND run.status<>'paid'),0),
              'periods',COALESCE((SELECT jsonb_agg(jsonb_build_object('payrollRunId',run.id,'periodStart',run.period_start,'periodEnd',run.period_end,'status',run.status,'grossPaise',item.gross_paise,'netPaise',item.net_paise) ORDER BY run.period_end DESC) FROM staff_payroll_items item JOIN staff_payroll_runs run ON run.id=item.payroll_run_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.staff_id=$3 AND run.period_start<=$5 AND run.period_end>=$4),'[]'::jsonb))"#,
        ).bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to)
        .fetch_one(db).await.map_err(|_| AppError::internal("failed to load staff business earnings"))?)
    } else {
        None
    };
    let total_items = appointment_total.max(service_total);
    let total_pages = (total_items + page_size - 1) / page_size;
    Ok(json!({
        "date":to,"range":{"from":from,"to":to,"timeZone":"Asia/Kolkata"},"staff":staff,
        "billingVisible":visible.financial(),"permissions":{"billing":visible.financial(),"earnings":earnings_visible,"targets":true,
          "invoiceDetail":visible.invoice_detail(),"clientName":visible.client_name,"invoiceNumber":visible.invoice_number,
          "discount":visible.discount,"tax":visible.tax,"serviceAmount":visible.service_amount,"commission":visible.commission},
        "summary":summary,
        "performance":performance,
        "earnings":earnings,"targets":[],"services":services,"dailyBreakdown":daily_breakdown,
        "pagination":{"page":page,"pageSize":page_size,"totalItems":total_items,"totalPages":total_pages,"hasMore":page<total_pages},
        "appointments":appointments,"serviceInvoices":service_data["rows"]
    }))
}

pub async fn business_invoice(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    invoice_id: &str,
    visible: StaffBusinessVisibility,
) -> Result<Value, AppError> {
    let staff_id =
        staff_enterprise_service::self_staff_id(db, tenant_id, branch_id, user_id).await?;
    let data = self_service_lines(
        db, tenant_id, branch_id, &staff_id, None, None, invoice_id, "", true, 0, 500, visible,
    )
    .await?;
    let items = data["rows"].as_array().cloned().unwrap_or_default();
    let first = items
        .first()
        .ok_or_else(|| AppError::not_found("staff invoice was not found"))?;
    let totals = &data["totals"];
    Ok(json!({
        "id":first["invoiceId"],"invoiceNumber":first["invoiceNumber"],"clientName":first["clientName"],
        "status":first["refundStatus"],"appointmentId":first["appointmentId"],"createdAt":first["createdAt"],
        "totals":{"saleId":first["saleId"],"invoiceId":first["invoiceId"],"invoiceNumber":first["invoiceNumber"],
          "invoiceStatus":first["refundStatus"],"subtotalPaise":totals["grossPaise"],"discountPaise":totals["discountPaise"],
          "couponDiscountPaise":Value::Null,"afterDiscountPaise":totals["taxablePaise"],"gstPaise":totals["gstPaise"],
          "totalPaise":totals["netTotalPaise"],"paidPaise":Value::Null,"duePaise":Value::Null},
        "items":items,"payments":[]
    }))
}
