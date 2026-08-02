use chrono::{FixedOffset, NaiveDate, TimeZone, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::{
        clients_repository, inventory_repository, services_repository, staff_repository,
        staff_schedule_repository,
    },
    services::{growth_intelligence_service, staff_advanced_service, staff_enterprise_service},
};

const PERFORMANCE_METRICS: &[&str] = &[
    "product_service_percent",
    "repeat_guests_retained",
    "new_guests_retained",
    "requested_count",
    "service_sales",
    "rebook_count",
    "rebook_rate",
    "new_service_guests",
    "service_invoices_with_product_percent",
    "average_feedback",
    "guest_count",
    "average_invoice_value",
    "service_revenue",
    "free_service_revenue",
    "product_revenue",
    "membership_revenue",
    "package_revenue",
    "utilization",
    "attendance",
    "tips",
    "commissions",
];

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
    let row = sqlx::query_as::<_, (String, String, String, String, String, bool, bool, bool)>(
        "SELECT workspace_name,timezone,locale,date_format,time_format,compact_mode,staff_hints,calendar_sync_enabled FROM staff_workspace_preferences WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff workspace preferences"))?;
    let (
        saved_name,
        timezone,
        locale,
        date_format,
        time_format,
        compact_mode,
        staff_hints,
        calendar_sync_enabled,
    ) = row.unwrap_or_else(|| {
        (
            "".to_string(),
            "Asia/Kolkata".to_string(),
            "en-IN".to_string(),
            "DD/MM/YYYY".to_string(),
            "HH:mm".to_string(),
            false,
            false,
            false,
        )
    });
    Ok(json!({
        "workspace":{"workspaceName": if saved_name.trim().is_empty() { workspace_name } else { saved_name }},
        "localization":{"timezone":timezone,"locale":locale},
        "dateTime":{"dateFormat":date_format,"timeFormat":time_format,"businessDayStartHour":0,"weekStartsOn":"monday"},
        "interface":{"compactMode":compact_mode},
        "defaults":{"staffHints":staff_hints,"calendarSyncEnabled":calendar_sync_enabled}
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
    pub calendar_sync_enabled: Option<bool>,
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
    if !matches!(locale.as_str(), "en-IN" | "en-US" | "hi-IN" | "hi-Latn-IN") {
        return Err(AppError::validation("unsupported Staff App locale"));
    }
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
    let calendar_sync_enabled = input.calendar_sync_enabled.unwrap_or_else(|| {
        current["defaults"]["calendarSyncEnabled"]
            .as_bool()
            .unwrap_or(false)
    });
    sqlx::query(
        r#"INSERT INTO staff_workspace_preferences(tenant_id,branch_id,staff_id,workspace_name,timezone,locale,date_format,time_format,compact_mode,staff_hints,calendar_sync_enabled)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT(tenant_id,branch_id,staff_id) DO UPDATE SET
             workspace_name=EXCLUDED.workspace_name,timezone=EXCLUDED.timezone,locale=EXCLUDED.locale,
             date_format=EXCLUDED.date_format,time_format=EXCLUDED.time_format,
             compact_mode=EXCLUDED.compact_mode,staff_hints=EXCLUDED.staff_hints,
             calendar_sync_enabled=EXCLUDED.calendar_sync_enabled,updated_at=NOW()"#,
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
    .bind(calendar_sync_enabled)
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

fn performance_points(row: &staff_advanced_service::StaffPerformanceRow) -> i64 {
    row.completed_appointments.saturating_mul(100)
        + row.present_days.saturating_mul(20)
        + row.repeat_clients.saturating_mul(50)
        + row.operation_task_completed.saturating_mul(25)
}

pub struct AppointmentHistoryQuery<'a> {
    pub staff_id: &'a str,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub page: i64,
    pub page_size: i64,
    pub query: &'a str,
    pub status: &'a str,
    pub service_id: &'a str,
    pub service: &'a str,
    pub department: &'a str,
    pub sort: &'a str,
    pub include_client_names: bool,
}

pub async fn appointment_history(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: AppointmentHistoryQuery<'_>,
) -> Result<Value, AppError> {
    if let (Some(from), Some(to)) = (input.from, input.to) {
        if to < from {
            return Err(AppError::validation(
                "history from date must be on or before to date",
            ));
        }
    }
    let page = input.page.max(1);
    let page_size = input.page_size.clamp(1, 100);
    let status = match input.status.trim().to_ascii_lowercase().as_str() {
        "" | "all" => String::new(),
        value
            if [
                "booked",
                "scheduled",
                "pending",
                "queued",
                "confirmed",
                "arrived",
                "checked-in",
                "checked_in",
                "in-service",
                "in service",
                "paused",
                "inprogress",
                "in progress",
                "started",
                "active",
                "running",
                "completed",
                "billed",
                "paid",
                "checked-out",
                "checked_out",
                "checkout",
                "done",
                "cancelled",
                "canceled",
                "voided",
                "no-show",
                "no show",
                "noshow",
            ]
            .contains(&value) =>
        {
            value.to_string()
        }
        _ => {
            return Err(AppError::validation(
                "unsupported appointment history status",
            ))
        }
    };
    let query = input.query.trim().to_ascii_lowercase();
    let service_id = input.service_id.trim();
    let service = input.service.trim().to_ascii_lowercase();
    let department = input.department.trim().to_ascii_lowercase();
    if query.chars().count() > 100
        || service.chars().count() > 100
        || department.chars().count() > 100
    {
        return Err(AppError::validation(
            "history filters must be 100 characters or less",
        ));
    }
    let descending = match input.sort.trim().to_ascii_lowercase().as_str() {
        "" | "desc" => true,
        "asc" => false,
        _ => return Err(AppError::validation("history sort must be asc or desc")),
    };
    let total_items = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM appointments appointment
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND ($3='' OR appointment.staff_id=$3)
              AND ($4::DATE IS NULL OR (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE >= $4)
              AND ($5::DATE IS NULL OR (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE <= $5)
              AND ($6='' OR LOWER(appointment.status)=$6)
              AND ($7='' OR LOWER(CONCAT_WS(' ',appointment.id,appointment.notes)) LIKE '%'||$7||'%'
                OR ($11 AND EXISTS(SELECT 1 FROM clients client WHERE client.tenant_id=appointment.tenant_id AND client.branch_id=appointment.branch_id AND client.id=appointment.client_id AND LOWER(CONCAT_WS(' ',client.first_name,client.last_name)) LIKE '%'||$7||'%'))
                OR EXISTS(SELECT 1 FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id
                  AND LOWER(CONCAT_WS(' ',service.name,service.category)) LIKE '%'||$7||'%'
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))))
              AND ($8='' OR $8 IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb)))
              AND ($9='' OR EXISTS(SELECT 1 FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND LOWER(service.name) LIKE '%'||$9||'%' AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))))
              AND ($10='' OR EXISTS(SELECT 1 FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND LOWER(service.category)=$10 AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))))"#,
    )
    .bind(tenant_id).bind(branch_id).bind(input.staff_id).bind(input.from).bind(input.to)
    .bind(&status).bind(&query).bind(service_id).bind(&service).bind(&department).bind(input.include_client_names)
    .fetch_one(db).await.map_err(|_| AppError::internal("failed to count appointment history"))?;
    let rows = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
              'id',appointment.id,'staffId',appointment.staff_id,'branchId',appointment.branch_id,
              'staffName',COALESCE(NULLIF(staff.appointment_display_name,''),TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),appointment.staff_id),
              'requestedStaffId',appointment.requested_staff_id,'staffPreference',appointment.staff_preference,
              'serviceIds',COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb,
              'serviceSelections',COALESCE(appointment.service_selections_json,'{}'::jsonb),
              'serviceNames',COALESCE((SELECT jsonb_agg(service.name ORDER BY service.name) FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))),'[]'::jsonb),
              'serviceDepartments',COALESCE((SELECT jsonb_agg(DISTINCT service.category) FILTER(WHERE service.category<>'') FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))),'[]'::jsonb),
              'durationMinutes',GREATEST(0,EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60),
              'value',COALESCE(NULLIF(appointment.booked_total_paise,0),(SELECT SUM(service.price_paise) FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))),0),
              'startAt',appointment.start_at,'endAt',appointment.end_at,'status',appointment.status,
              'chairRoomId',COALESCE(appointment.chair_room_id,''),'chair',COALESCE((SELECT resource.name FROM appointment_resources resource WHERE resource.tenant_id=appointment.tenant_id AND resource.branch_id=appointment.branch_id AND resource.id=appointment.chair_room_id),''),
              'source',appointment.source,'businessDate',(appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE,'state',appointment.status,
              'notes',appointment.notes,'bookingGroupId',COALESCE(appointment.booking_group_id,''),'version',appointment.version,
              'bookingType',appointment.booking_type,'dayPackageId',appointment.day_package_id,'hostClientId',appointment.host_client_id,
              'groupName',appointment.group_name,'groupNotes',appointment.group_notes,'surprise',appointment.is_surprise,
              'virtualMeetingUrl',appointment.virtual_meeting_url,'serviceMode',appointment.service_mode,
              'segmentLabel',appointment.segment_label,'sequenceNo',appointment.sequence_no,
              'executionStatus',appointment.execution_status,'serviceStartedAt',appointment.service_started_at,
              'servicePausedAt',appointment.service_paused_at,'pausedSeconds',appointment.paused_seconds,
              'serviceCompletedAt',appointment.service_completed_at,
              'clientId',appointment.client_id,
              'clientName',CASE WHEN $14 THEN COALESCE((SELECT TRIM(CONCAT_WS(' ',client.first_name,client.last_name)) FROM clients client WHERE client.tenant_id=appointment.tenant_id AND client.branch_id=appointment.branch_id AND client.id=appointment.client_id),'') ELSE '' END,
              'preferredClient',CASE WHEN $14 THEN COALESCE((SELECT client.preferred_staff_id=appointment.staff_id FROM clients client WHERE client.tenant_id=appointment.tenant_id AND client.branch_id=appointment.branch_id AND client.id=appointment.client_id),FALSE) ELSE FALSE END,
              'rescheduleTimeline',COALESCE((SELECT jsonb_agg(jsonb_build_object('action',activity.action,'changedAt',activity.created_at,'reason',activity.reason,'changedBy',activity.changed_by,'fromStartAt',activity.old_data->>'startAt','toStartAt',activity.new_data->>'startAt') ORDER BY activity.created_at) FROM appointment_activity activity WHERE activity.tenant_id=appointment.tenant_id AND (activity.branch_id=appointment.branch_id OR activity.branch_id='') AND activity.appointment_id=appointment.id AND activity.action IN ('BOOKING_RESCHEDULED','RESCHEDULE_APPROVED','CALENDAR_MOVED')),'[]'::jsonb),
              'rescheduleCount',(SELECT COUNT(*) FROM appointment_activity activity WHERE activity.tenant_id=appointment.tenant_id AND (activity.branch_id=appointment.branch_id OR activity.branch_id='') AND activity.appointment_id=appointment.id AND activity.action IN ('BOOKING_RESCHEDULED','RESCHEDULE_APPROVED','CALENDAR_MOVED')),
              'lastServiceAt',(SELECT previous.start_at FROM appointments previous WHERE previous.tenant_id=appointment.tenant_id AND previous.branch_id=appointment.branch_id AND previous.client_id=appointment.client_id AND previous.start_at<appointment.start_at AND LOWER(previous.status) IN ('completed','checked-out','billed','paid') ORDER BY previous.start_at DESC LIMIT 1),
              'lastServiceNames',COALESCE((SELECT jsonb_agg(service.name ORDER BY service.name) FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF((SELECT previous.service_ids_json FROM appointments previous WHERE previous.tenant_id=appointment.tenant_id AND previous.branch_id=appointment.branch_id AND previous.client_id=appointment.client_id AND previous.start_at<appointment.start_at AND LOWER(previous.status) IN ('completed','checked-out','billed','paid') ORDER BY previous.start_at DESC LIMIT 1),''),'[]')::jsonb))),'[]'::jsonb),
              'lastServiceDepartments',COALESCE((SELECT jsonb_agg(DISTINCT service.category) FILTER(WHERE service.category<>'') FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF((SELECT previous.service_ids_json FROM appointments previous WHERE previous.tenant_id=appointment.tenant_id AND previous.branch_id=appointment.branch_id AND previous.client_id=appointment.client_id AND previous.start_at<appointment.start_at AND LOWER(previous.status) IN ('completed','checked-out','billed','paid') ORDER BY previous.start_at DESC LIMIT 1),''),'[]')::jsonb))),'[]'::jsonb),
              'workedMinutes',CASE WHEN LOWER(appointment.status) IN ('completed','billed','paid','checked-out') THEN GREATEST(0,EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60) ELSE 0 END,
              'timer',jsonb_build_object('appointmentId',appointment.id,'status',appointment.status,'live',FALSE,'startedAt',NULL,'completedAt',NULL,'timeSource','estimated','elapsedMinutes',0,'totalMinutes',GREATEST(0,EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60),'remainingMinutes',0,'overrunMinutes',0,'progress',0),
              'billing',NULL,'attribution',NULL)
            FROM appointments appointment LEFT JOIN staff ON staff.tenant_id=appointment.tenant_id AND staff.branch_id=appointment.branch_id AND staff.id=appointment.staff_id
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND ($3='' OR appointment.staff_id=$3)
              AND ($4::DATE IS NULL OR (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE >= $4)
              AND ($5::DATE IS NULL OR (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE <= $5)
              AND ($6='' OR LOWER(appointment.status)=$6)
              AND ($7='' OR LOWER(CONCAT_WS(' ',appointment.id,appointment.notes)) LIKE '%'||$7||'%'
                OR ($14 AND EXISTS(SELECT 1 FROM clients client WHERE client.tenant_id=appointment.tenant_id AND client.branch_id=appointment.branch_id AND client.id=appointment.client_id AND LOWER(CONCAT_WS(' ',client.first_name,client.last_name)) LIKE '%'||$7||'%'))
                OR EXISTS(SELECT 1 FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND LOWER(CONCAT_WS(' ',service.name,service.category)) LIKE '%'||$7||'%' AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))))
              AND ($8='' OR $8 IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb)))
              AND ($9='' OR EXISTS(SELECT 1 FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND LOWER(service.name) LIKE '%'||$9||'%' AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))))
              AND ($10='' OR EXISTS(SELECT 1 FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND LOWER(service.category)=$10 AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))))
            ORDER BY CASE WHEN $11 THEN appointment.start_at END DESC,CASE WHEN NOT $11 THEN appointment.start_at END ASC
            OFFSET $12 LIMIT $13"#,
    )
    .bind(tenant_id).bind(branch_id).bind(input.staff_id).bind(input.from).bind(input.to)
    .bind(&status).bind(&query).bind(service_id).bind(&service).bind(&department).bind(descending)
    .bind((page - 1) * page_size).bind(page_size).bind(input.include_client_names)
    .fetch_all(db).await.map_err(|_| AppError::internal("failed to load appointment history"))?;
    let total_pages = (total_items + page_size - 1) / page_size;
    Ok(
        json!({"rows":rows,"page":page,"pageSize":page_size,"totalItems":total_items,"totalPages":total_pages,"hasMore":page<total_pages}),
    )
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
              'photoUrl',COALESCE((SELECT profile.photo_url FROM staff_profiles profile
                WHERE profile.tenant_id=staff.tenant_id AND profile.branch_id=staff.branch_id AND profile.staff_id=staff.id),''),
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
              'serviceDepartments',COALESCE((SELECT jsonb_agg(DISTINCT service.category) FILTER(WHERE service.category<>'') FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))),'[]'::jsonb),
              'durationMinutes',GREATEST(0,EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60),
              'value',COALESCE((SELECT SUM(service.price_paise) FROM services service
                WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))),0),
              'startAt',appointment.start_at,'endAt',appointment.end_at,'status',appointment.status,
              'chair',COALESCE((SELECT resource.name FROM appointment_resources resource WHERE resource.id=appointment.chair_room_id),''),
              'source',appointment.source,
              'clientId',appointment.client_id,
              'clientName',COALESCE((SELECT TRIM(CONCAT_WS(' ',client.first_name,client.last_name)) FROM clients client WHERE client.tenant_id=appointment.tenant_id AND client.branch_id=appointment.branch_id AND client.id=appointment.client_id),''),
              'preferredClient',COALESCE((SELECT client.preferred_staff_id=appointment.staff_id FROM clients client WHERE client.tenant_id=appointment.tenant_id AND client.branch_id=appointment.branch_id AND client.id=appointment.client_id),FALSE),
              'rescheduleTimeline',COALESCE((SELECT jsonb_agg(jsonb_build_object('action',activity.action,'changedAt',activity.created_at,'reason',activity.reason,'changedBy',activity.changed_by,'fromStartAt',activity.old_data->>'startAt','toStartAt',activity.new_data->>'startAt') ORDER BY activity.created_at) FROM appointment_activity activity WHERE activity.tenant_id=appointment.tenant_id AND (activity.branch_id=appointment.branch_id OR activity.branch_id='') AND activity.appointment_id=appointment.id AND activity.action IN ('BOOKING_RESCHEDULED','RESCHEDULE_APPROVED','CALENDAR_MOVED')),'[]'::jsonb),
              'rescheduleCount',(SELECT COUNT(*) FROM appointment_activity activity WHERE activity.tenant_id=appointment.tenant_id AND activity.branch_id=appointment.branch_id AND activity.appointment_id=appointment.id AND activity.action IN ('BOOKING_RESCHEDULED','RESCHEDULE_APPROVED')),
              'lastServiceAt',(SELECT previous.start_at FROM appointments previous WHERE previous.tenant_id=appointment.tenant_id AND previous.branch_id=appointment.branch_id AND previous.client_id=appointment.client_id AND previous.start_at<appointment.start_at AND LOWER(previous.status) IN ('completed','checked-out','billed','paid') ORDER BY previous.start_at DESC LIMIT 1),
              'lastServiceNames',COALESCE((SELECT jsonb_agg(service.name ORDER BY service.name) FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF((SELECT previous.service_ids_json FROM appointments previous WHERE previous.tenant_id=appointment.tenant_id AND previous.branch_id=appointment.branch_id AND previous.client_id=appointment.client_id AND previous.start_at<appointment.start_at AND LOWER(previous.status) IN ('completed','checked-out','billed','paid') ORDER BY previous.start_at DESC LIMIT 1),''),'[]')::jsonb))),'[]'::jsonb),
              'lastServiceDepartments',COALESCE((SELECT jsonb_agg(DISTINCT service.category) FILTER (WHERE service.category<>'') FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF((SELECT previous.service_ids_json FROM appointments previous WHERE previous.tenant_id=appointment.tenant_id AND previous.branch_id=appointment.branch_id AND previous.client_id=appointment.client_id AND previous.start_at<appointment.start_at AND LOWER(previous.status) IN ('completed','checked-out','billed','paid') ORDER BY previous.start_at DESC LIMIT 1),''),'[]')::jsonb))),'[]'::jsonb))
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
    let calendar = roster_for_staff(db, tenant_id, branch_id, &staff_id, from, to).await?;
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
            FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND archived_at IS NULL AND (user_id='' OR user_id=$3)
              AND COALESCE((SELECT preference.in_app_enabled FROM staff_notification_preferences preference
                WHERE preference.tenant_id=$1 AND preference.branch_id=$2 AND preference.staff_id=$4),TRUE)
              AND NOT ((CASE
                WHEN notification_type LIKE 'payroll%' THEN 'payroll'
                WHEN notification_type LIKE '%attendance%' OR notification_type LIKE '%clock%' THEN 'attendance'
                WHEN notification_type LIKE '%leave%' OR notification_type LIKE '%schedule%' THEN 'leave_schedule'
                WHEN notification_type LIKE '%tip%' THEN 'tips'
                WHEN notification_type LIKE '%service%' THEN 'service'
                WHEN notification_type LIKE '%checkout%' OR notification_type='guest_checkout' THEN 'checkout'
                WHEN notification_type LIKE 'daily_%' THEN 'daily_summary'
                WHEN notification_type LIKE '%task%' THEN 'tasks'
                WHEN notification_type LIKE '%stock%' OR notification_type LIKE '%inventory%' THEN 'stock'
                ELSE COALESCE(NULLIF(metadata_json->>'category',''),'appointments') END)=ANY(COALESCE((SELECT preference.muted_categories FROM staff_notification_preferences preference
                  WHERE preference.tenant_id=$1 AND preference.branch_id=$2 AND preference.staff_id=$4),'{}'::TEXT[])))
            ORDER BY created_at DESC LIMIT 50"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .bind(&staff_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff notifications"))?;
    let performance_rows =
        staff_advanced_service::performance(db, tenant_id, branch_id, from, to, "")
            .await?
            .rows;
    let performance = performance_rows
        .iter()
        .find(|row| row.staff_id == staff_id)
        .cloned()
        .ok_or_else(|| AppError::not_found("linked employee profile not found"))?;
    let revenue_opportunities = growth_intelligence_service::revenue_opportunities_for_staff(
        db, tenant_id, branch_id, &staff_id,
    )
    .await?;
    let equipment_intelligence = staff_enterprise_service::staff_equipment_intelligence(
        db, tenant_id, branch_id, from, to, &staff_id,
    )
    .await?;
    let mut ranked = performance_rows
        .iter()
        .filter(|row| row.score.is_some())
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| performance_points(right).cmp(&performance_points(left)))
            .then_with(|| right.revenue_paise.cmp(&left.revenue_paise))
            .then_with(|| left.staff_name.cmp(&right.staff_name))
            .then_with(|| left.staff_id.cmp(&right.staff_id))
    });
    let leaderboard = ranked
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let attendance_score = (row.present_days + row.absent_days > 0).then(|| {
                (100 - row.absent_days.saturating_mul(20) as i32
                    - ((row.late_minutes + row.early_leave_minutes) / 30).min(10) as i32 * 5)
                    .clamp(0, 100)
            });
            json!({
                "rank":index + 1,"staffId":row.staff_id,"staffName":row.staff_name,
                "revenue":row.revenue_paise,"score":row.score,"rating":row.rating,
                "points":performance_points(row),"days":row.present_days + row.absent_days,
                "isMe":row.staff_id == staff_id,
                "scoreComponents":[
                  {"key":"completion","weightPercent":25,"value":row.completion_percent,"source":"completed appointments / appointments"},
                  {"key":"attendance","weightPercent":25,"value":attendance_score,"source":"absence, late and early-departure records"},
                  {"key":"utilization","weightPercent":20,"value":row.utilization_percent,"source":"worked minutes / scheduled minutes"},
                  {"key":"repeat_clients","weightPercent":15,"value":row.repeat_client_percent,"source":"repeat clients / unique clients"},
                  {"key":"revenue_target","weightPercent":15,"value":row.revenue_target_percent,"source":"attributed revenue / configured target"}
                ],
                "scoreExplanation":"Weighted only across components with evidence; advisory and never an automatic disciplinary decision."
            })
        })
        .collect::<Vec<_>>();
    let points = performance_points(&performance);
    let badges = vec![
        json!({"label":"First Service","description":"Complete the first appointment","earned":performance.completed_appointments > 0}),
        json!({"label":"Service Pro","description":"Complete 10 appointments","earned":performance.completed_appointments >= 10}),
        json!({"label":"Attendance Star","description":"Attend 5 days without an attendance exception","earned":performance.present_days >= 5 && performance.absent_days == 0 && performance.late_minutes == 0 && performance.early_leave_minutes == 0}),
        json!({"label":"Client Favorite","description":"Reach a 40% repeat-client rate","earned":performance.repeat_client_percent.is_some_and(|value| value >= 40)}),
        json!({"label":"Target Champion","description":"Reach the assigned revenue target","earned":performance.revenue_target_percent.is_some_and(|value| value >= 100)}),
        json!({"label":"Operations Pro","description":"Complete 5 operation tasks without a miss","earned":performance.operation_task_completed >= 5 && performance.operation_task_missed == 0}),
    ];
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
                "minutesToStart":0,"durationMinutes":appointment["durationMinutes"],"chair":appointment["chair"],
                "clientName":appointment["clientName"],"preferredClient":appointment["preferredClient"],
                "rescheduleCount":appointment["rescheduleCount"],"lastServiceAt":appointment["lastServiceAt"],
                "rescheduleTimeline":appointment["rescheduleTimeline"],"serviceDepartments":appointment["serviceDepartments"],
                "lastServiceNames":appointment["lastServiceNames"],"lastServiceDepartments":appointment["lastServiceDepartments"]
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
        "performance":{"revenue":performance.revenue_paise,"completedServices":performance.completed_appointments,
          "avgUtilization":performance.utilization_percent,"avgRating":performance.rating,"productivityScore":performance.score,
          "strengths":performance.strengths,"opportunities":performance.opportunities,
          "appointmentsCount":performance.appointments_count,"completionPercent":performance.completion_percent,
          "targetRevenuePaise":performance.target_revenue_paise,"revenueTargetPercent":performance.revenue_target_percent,
          "uniqueClients":performance.unique_clients,"repeatClients":performance.repeat_clients,"repeatClientPercent":performance.repeat_client_percent,
          "presentDays":performance.present_days,"absentDays":performance.absent_days,"workedMinutes":performance.worked_minutes,
          "overtimeMinutes":performance.overtime_minutes,"lateMinutes":performance.late_minutes,"earlyLeaveMinutes":performance.early_leave_minutes,
          "operationTaskCompleted":performance.operation_task_completed,"operationTaskMissed":performance.operation_task_missed,
          "revenueOpportunities":revenue_opportunities,"equipmentIntelligence":equipment_intelligence},
        "leaderboard":leaderboard,
        "gamification":{"points":points,"level":if points > 0 { points / 500 + 1 } else { 0 },
          "stars":performance.score.map(|value| ((value + 19) / 20).clamp(1,5)).unwrap_or(0),
          "activeDays":performance.present_days,"dailyStreak":0,"monthlyStreak":0,"badges":badges,
          "sourceStatus":{"appointments":performance.appointments_count > 0,"attendance":performance.present_days + performance.absent_days > 0,
            "schedule":performance.utilization_percent.is_some(),"clients":performance.unique_clients > 0,
            "revenueTarget":performance.target_revenue_paise.is_some(),"sharedReview":performance.rating.is_some()}},
        "notifications":notifications,"tasks":tasks,"calendar":calendar,
        "reports":{"selected":{"days":days,"revenue":performance.revenue_paise,"services":performance.completed_appointments,
          "productivityScore":performance.score,"rating":performance.rating}},
        "generatedAt":now,"workedMinutes":performance.worked_minutes
    }))
}

pub async fn performance_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Value, AppError> {
    let row = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'visibleMetricKeys',visible_metric_keys,'customMetrics',custom_metrics,
          'version',version,'updatedAt',updated_at,'updatedBy',updated_by)
        FROM staff_performance_metric_settings WHERE tenant_id=$1 AND branch_id=$2"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to load performance metric settings"))?;
    Ok(row.unwrap_or_else(|| {
        json!({"visibleMetricKeys":PERFORMANCE_METRICS,"customMetrics":[],"version":0,"updatedAt":Value::Null,"updatedBy":""})
    }))
}

pub async fn save_performance_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    visible_metric_keys: Vec<String>,
    custom_metrics: Value,
    version: i32,
) -> Result<Value, AppError> {
    if visible_metric_keys.len() > PERFORMANCE_METRICS.len()
        || visible_metric_keys
            .iter()
            .any(|key| !PERFORMANCE_METRICS.contains(&key.as_str()))
    {
        return Err(AppError::validation(
            "performance metric selection is invalid",
        ));
    }
    let custom = custom_metrics
        .as_array()
        .ok_or_else(|| AppError::validation("custom metrics must be an array"))?;
    if custom.len() > 10
        || custom.iter().any(|item| {
            let key = item["key"].as_str().unwrap_or("");
            let label = item["label"].as_str().unwrap_or("");
            let source = item["sourceMetricKey"].as_str().unwrap_or("");
            key.is_empty()
                || key.len() > 64
                || !key
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
                || label.is_empty()
                || label.len() > 80
                || !PERFORMANCE_METRICS.contains(&source)
        })
    {
        return Err(AppError::validation(
            "custom metric configuration is invalid",
        ));
    }
    let visible = json!(visible_metric_keys);
    sqlx::query_scalar::<_, Value>(
        r#"INSERT INTO staff_performance_metric_settings(
          tenant_id,branch_id,visible_metric_keys,custom_metrics,updated_by)
        VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(tenant_id,branch_id) DO UPDATE SET
          visible_metric_keys=EXCLUDED.visible_metric_keys,custom_metrics=EXCLUDED.custom_metrics,
          updated_by=EXCLUDED.updated_by,version=staff_performance_metric_settings.version+1,updated_at=NOW()
        WHERE staff_performance_metric_settings.version=$6
        RETURNING jsonb_build_object(
          'visibleMetricKeys',visible_metric_keys,'customMetrics',custom_metrics,
          'version',version,'updatedAt',updated_at,'updatedBy',updated_by)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(visible)
    .bind(custom_metrics)
    .bind(actor)
    .bind(version)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to save performance metric settings"))?
    .ok_or_else(|| AppError::conflict("performance metric settings changed; reload and retry"))
}

#[allow(clippy::too_many_arguments)]
pub async fn performance_dashboard(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    basis: &str,
    financial_visible: bool,
    earnings_visible: bool,
) -> Result<Value, AppError> {
    if to < from || (to - from).num_days() > 366 {
        return Err(AppError::validation(
            "performance period must be one year or less",
        ));
    }
    let basis = match basis {
        "" | "sale_date" => "sale_date",
        "close_date" => "close_date",
        _ => {
            return Err(AppError::validation(
                "performance basis must be sale_date or close_date",
            ))
        }
    };
    let staff_id =
        staff_enterprise_service::self_staff_id(db, tenant_id, branch_id, user_id).await?;
    let facts = sqlx::query_scalar::<_, Value>(
        r#"WITH valid_appointments AS (
          SELECT appointment.*,(appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE visit_date
          FROM appointments appointment
          WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.staff_id=$3
            AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5
            AND LOWER(appointment.status) NOT IN ('cancelled','canceled','void','voided','no-show','no_show','noshow')
        ), completed AS (
          SELECT * FROM valid_appointments
          WHERE LOWER(status) IN ('completed','billed','paid','closed','checked-out','checked_out','checkout','done')
        ), cohorts AS (
          SELECT DISTINCT ON (visit.client_id) visit.client_id,visit.visit_date,
            NOT EXISTS(SELECT 1 FROM appointments earlier WHERE earlier.tenant_id=visit.tenant_id
              AND earlier.branch_id=visit.branch_id AND earlier.client_id=visit.client_id
              AND earlier.start_at<visit.start_at
              AND LOWER(earlier.status) IN ('completed','billed','paid','closed','checked-out','checked_out','checkout','done')) new_guest,
            visit.visit_date<=CURRENT_DATE-90 eligible,
            EXISTS(SELECT 1 FROM appointments later WHERE later.tenant_id=visit.tenant_id
              AND later.branch_id=visit.branch_id AND later.client_id=visit.client_id
              AND later.start_at>visit.start_at AND later.start_at<=visit.start_at+INTERVAL '90 days'
              AND LOWER(later.status) IN ('completed','billed','paid','closed','checked-out','checked_out','checkout','done')) retained
          FROM completed visit WHERE visit.client_id<>'' ORDER BY visit.client_id,visit.start_at
        ), appointment_facts AS (
          SELECT COUNT(*)::BIGINT appointments_count,
            (SELECT COUNT(*) FROM valid_appointments
              WHERE requested_staff_id=$3 OR LOWER(staff_preference) IN ('specific','requested','preferred'))::BIGINT requested_count,
            COUNT(DISTINCT client_id) FILTER(WHERE client_id<>'')::BIGINT guest_count,
            COUNT(DISTINCT client_id) FILTER(WHERE client_id<>'' AND NOT EXISTS(
              SELECT 1 FROM appointments earlier WHERE earlier.tenant_id=completed.tenant_id
                AND earlier.branch_id=completed.branch_id AND earlier.client_id=completed.client_id
                AND earlier.start_at<completed.start_at
                AND LOWER(earlier.status) IN ('completed','billed','paid','closed','checked-out','checked_out','checkout','done')))::BIGINT new_service_guests,
            COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM appointments follow_up
              WHERE follow_up.tenant_id=completed.tenant_id AND follow_up.branch_id=completed.branch_id
                AND follow_up.client_id=completed.client_id AND follow_up.id<>completed.id
                AND follow_up.start_at>completed.start_at
                AND (follow_up.created_at AT TIME ZONE 'Asia/Kolkata')::DATE=completed.visit_date
                AND LOWER(follow_up.status) NOT IN ('cancelled','canceled','void','voided')))::BIGINT rebook_count,
            COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM(end_at-start_at))::BIGINT/60,0)),0)::BIGINT booked_minutes
          FROM completed
        ), retention AS (
          SELECT COUNT(*) FILTER(WHERE new_guest AND eligible)::BIGINT new_eligible,
            COUNT(*) FILTER(WHERE new_guest AND eligible AND retained)::BIGINT new_retained,
            COUNT(*) FILTER(WHERE NOT new_guest AND eligible)::BIGINT repeat_eligible,
            COUNT(*) FILTER(WHERE NOT new_guest AND eligible AND retained)::BIGINT repeat_retained
          FROM cohorts
        ), sale_lines AS (
          SELECT snapshot.sale_id,sale.client_id,line.line_type,snapshot.base_paise,snapshot.commission_paise,
            ((line.gross_paise*snapshot.split_bps+5000)/10000)::BIGINT gross_share_paise,
            CASE WHEN $6='close_date' THEN (sale.finalized_at AT TIME ZONE 'Asia/Kolkata')::DATE ELSE snapshot.business_date END metric_date
          FROM pos_staff_commission_snapshots snapshot
          JOIN pos_sales sale ON sale.id=snapshot.sale_id AND sale.tenant_id=snapshot.tenant_id AND sale.branch_id=snapshot.branch_id
          JOIN pos_sale_lines line ON line.id=snapshot.sale_line_id AND line.tenant_id=snapshot.tenant_id AND line.branch_id=snapshot.branch_id
          WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3
            AND LOWER(sale.status) NOT IN ('draft','cancelled','canceled','void','voided','refunded')
            AND ($6='sale_date' OR sale.finalized_at IS NOT NULL)
            AND (CASE WHEN $6='close_date' THEN (sale.finalized_at AT TIME ZONE 'Asia/Kolkata')::DATE ELSE snapshot.business_date END) BETWEEN $4 AND $5
        ), invoice_flags AS (
          SELECT sale_id,BOOL_OR(line_type IN ('service','package_redeem','membership_redeem')) has_service,
            BOOL_OR(line_type='product') has_product FROM sale_lines GROUP BY sale_id
        ), sale_facts AS (
          SELECT COALESCE(SUM(base_paise) FILTER(WHERE line_type IN ('service','package_redeem','membership_redeem')),0)::BIGINT service_paise,
            COALESCE(SUM(gross_share_paise) FILTER(WHERE line_type='service' AND base_paise=0),0)::BIGINT free_service_paise,
            COALESCE(SUM(base_paise) FILTER(WHERE line_type='product'),0)::BIGINT product_paise,
            COALESCE(SUM(base_paise) FILTER(WHERE line_type='membership'),0)::BIGINT membership_paise,
            COALESCE(SUM(base_paise) FILTER(WHERE line_type='package'),0)::BIGINT package_paise,
            COALESCE(SUM(base_paise),0)::BIGINT total_paise,COALESCE(SUM(commission_paise),0)::BIGINT commission_paise,
            COUNT(DISTINCT sale_id)::BIGINT invoice_count,COUNT(DISTINCT client_id) FILTER(WHERE client_id<>'')::BIGINT sale_guest_count
          FROM sale_lines
        ), invoice_facts AS (
          SELECT COUNT(*) FILTER(WHERE has_service)::BIGINT service_invoice_count,
            COUNT(*) FILTER(WHERE has_service AND has_product)::BIGINT service_product_invoice_count FROM invoice_flags
        ), schedule AS (
          SELECT COALESCE(SUM(CASE WHEN status='working' THEN
            COALESCE(EXTRACT(EPOCH FROM(shift1_end-shift1_start))::BIGINT/60,0)+
            COALESCE(EXTRACT(EPOCH FROM(shift2_end-shift2_start))::BIGINT/60,0) ELSE 0 END),0)::BIGINT scheduled_minutes
          FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND schedule_date BETWEEN $4 AND $5
        ), attendance AS (
          SELECT COUNT(*) FILTER(WHERE status IN ('clocked_in','clocked_out','present','half_day'))::BIGINT present_days,
            COUNT(*) FILTER(WHERE status='absent')::BIGINT absent_days,
            COALESCE(SUM(overtime_minutes),0)::BIGINT overtime_minutes
          FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5
        ), feedback AS (
          SELECT COUNT(*)::BIGINT feedback_count,COALESCE(SUM(review.rating),0)::BIGINT feedback_sum
          FROM customer_booking_reviews review JOIN appointments appointment ON appointment.id=review.appointment_id
            AND appointment.tenant_id=review.tenant_id AND appointment.branch_id=review.branch_id
          WHERE review.tenant_id=$1 AND review.branch_id=$2 AND appointment.staff_id=$3
            AND (review.created_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5
        ), tips AS (
          SELECT COALESCE(SUM(CASE WHEN JSONB_ARRAY_LENGTH(COALESCE(sale.tip_splits,'[]'::JSONB))>0 THEN
              COALESCE((SELECT SUM((split->>'amountPaise')::BIGINT) FROM JSONB_ARRAY_ELEMENTS(sale.tip_splits) split WHERE split->>'staffId'=$3),0)
            WHEN sale.staff_id=$3 THEN sale.tip_paise ELSE 0 END),0)::BIGINT tips_paise
          FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2
            AND LOWER(sale.status) NOT IN ('draft','cancelled','canceled','void','voided','refunded')
            AND ($6='sale_date' OR sale.finalized_at IS NOT NULL)
            AND (CASE WHEN $6='close_date' THEN (sale.finalized_at AT TIME ZONE 'Asia/Kolkata')::DATE ELSE sale.business_date END) BETWEEN $4 AND $5
        ), freshness AS (
          SELECT MAX(changed_at) fresh_at FROM (
            SELECT MAX(COALESCE(updated_at,created_at)) changed_at FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
            UNION ALL SELECT MAX(created_at) FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
            UNION ALL SELECT MAX(COALESCE(updated_at,created_at)) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
            UNION ALL SELECT MAX(review.created_at) FROM customer_booking_reviews review JOIN appointments appointment ON appointment.id=review.appointment_id WHERE review.tenant_id=$1 AND review.branch_id=$2 AND appointment.staff_id=$3
          ) source
        ) SELECT jsonb_build_object(
          'appointmentsCount',appointment_facts.appointments_count,'requestedCount',appointment_facts.requested_count,
          'guestCount',GREATEST(appointment_facts.guest_count,sale_facts.sale_guest_count),'newServiceGuests',appointment_facts.new_service_guests,
          'rebookCount',appointment_facts.rebook_count,'bookedMinutes',appointment_facts.booked_minutes,
          'newEligible',retention.new_eligible,'newRetained',retention.new_retained,
          'repeatEligible',retention.repeat_eligible,'repeatRetained',retention.repeat_retained,
          'servicePaise',sale_facts.service_paise,'freeServicePaise',sale_facts.free_service_paise,
          'productPaise',sale_facts.product_paise,'membershipPaise',sale_facts.membership_paise,
          'packagePaise',sale_facts.package_paise,'totalPaise',sale_facts.total_paise,
          'commissionPaise',sale_facts.commission_paise,'invoiceCount',sale_facts.invoice_count,
          'serviceInvoiceCount',invoice_facts.service_invoice_count,'serviceProductInvoiceCount',invoice_facts.service_product_invoice_count,
          'scheduledMinutes',schedule.scheduled_minutes,'presentDays',attendance.present_days,'absentDays',attendance.absent_days,
          'overtimeMinutes',attendance.overtime_minutes,'feedbackCount',feedback.feedback_count,'feedbackSum',feedback.feedback_sum,
          'tipsPaise',tips.tips_paise,'freshAt',freshness.fresh_at)
        FROM appointment_facts CROSS JOIN retention CROSS JOIN sale_facts CROSS JOIN invoice_facts
          CROSS JOIN schedule CROSS JOIN attendance CROSS JOIN feedback CROSS JOIN tips CROSS JOIN freshness"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .bind(from)
    .bind(to)
    .bind(basis)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff performance metrics"))?;

    let trends = sqlx::query_scalar::<_, Value>(
        r#"WITH days AS (
          SELECT GENERATE_SERIES($4::DATE,$5::DATE,INTERVAL '1 day')::DATE AS day
        ), appointment_daily AS (
          SELECT (start_at AT TIME ZONE 'Asia/Kolkata')::DATE AS day,COUNT(*)::BIGINT completed_services,
            COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM(end_at-start_at))::BIGINT/60,0)),0)::BIGINT booked_minutes
          FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
            AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5
            AND LOWER(status) IN ('completed','billed','paid','closed','checked-out','checked_out','checkout','done')
          GROUP BY 1
        ), schedule_daily AS (
          SELECT schedule_date AS day,COALESCE(SUM(CASE WHEN status='working' THEN
            COALESCE(EXTRACT(EPOCH FROM(shift1_end-shift1_start))::BIGINT/60,0)+
            COALESCE(EXTRACT(EPOCH FROM(shift2_end-shift2_start))::BIGINT/60,0) ELSE 0 END),0)::BIGINT scheduled_minutes
          FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
            AND schedule_date BETWEEN $4 AND $5 GROUP BY schedule_date
        ), sale_daily AS (
          SELECT CASE WHEN $6='close_date' THEN (sale.finalized_at AT TIME ZONE 'Asia/Kolkata')::DATE ELSE snapshot.business_date END AS day,
            COALESCE(SUM(snapshot.base_paise) FILTER(WHERE line.line_type IN ('service','package_redeem','membership_redeem')),0)::BIGINT service_revenue_paise,
            COALESCE(SUM(snapshot.base_paise) FILTER(WHERE line.line_type='product'),0)::BIGINT product_revenue_paise
          FROM pos_staff_commission_snapshots snapshot
          JOIN pos_sales sale ON sale.id=snapshot.sale_id AND sale.tenant_id=snapshot.tenant_id AND sale.branch_id=snapshot.branch_id
          JOIN pos_sale_lines line ON line.id=snapshot.sale_line_id AND line.tenant_id=snapshot.tenant_id AND line.branch_id=snapshot.branch_id
          WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3
            AND LOWER(sale.status) NOT IN ('draft','cancelled','canceled','void','voided','refunded')
            AND ($6='sale_date' OR sale.finalized_at IS NOT NULL)
            AND (CASE WHEN $6='close_date' THEN (sale.finalized_at AT TIME ZONE 'Asia/Kolkata')::DATE ELSE snapshot.business_date END) BETWEEN $4 AND $5
          GROUP BY 1
        ) SELECT jsonb_build_object('date',days.day,
          'completedServices',COALESCE(appointment_daily.completed_services,0),
          'utilizationPercent',CASE WHEN COALESCE(schedule_daily.scheduled_minutes,0)>0
            THEN ROUND(COALESCE(appointment_daily.booked_minutes,0)*100.0/schedule_daily.scheduled_minutes,2) END,
          'serviceRevenuePaise',CASE WHEN $7 THEN COALESCE(sale_daily.service_revenue_paise,0) END,
          'productRevenuePaise',CASE WHEN $7 THEN COALESCE(sale_daily.product_revenue_paise,0) END)
        FROM days LEFT JOIN appointment_daily USING(day) LEFT JOIN schedule_daily USING(day)
          LEFT JOIN sale_daily USING(day) ORDER BY days.day"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .bind(from)
    .bind(to)
    .bind(basis)
    .bind(financial_visible)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff performance trends"))?;

    let get = |key: &str| facts[key].as_i64().unwrap_or_default();
    let ratio = |left: i64, right: i64| (right > 0).then(|| (left * 10_000 / right) as f64 / 100.0);
    let metric = |key: &str,
                  label: &str,
                  value: Value,
                  unit: &str,
                  numerator: i64,
                  denominator: Option<i64>,
                  explanation: &str,
                  source: &str| {
        json!({"key":key,"label":label,"value":value,"unit":unit,"numerator":numerator,"denominator":denominator,
          "explanation":explanation,"source":source})
    };
    let service = get("servicePaise");
    let product = get("productPaise");
    let invoices = get("invoiceCount");
    let rebook_denominator = get("appointmentsCount");
    let scheduled = get("scheduledMinutes");
    let attendance_days = get("presentDays") + get("absentDays");
    let feedback_count = get("feedbackCount");
    let mut metrics = vec![
        metric(
            "product_service_percent",
            "Product / service %",
            json!(ratio(product, service)),
            "percent",
            product,
            Some(service),
            "Product attributed sales ÷ service attributed sales × 100.",
            "POS commission snapshots",
        ),
        metric(
            "repeat_guests_retained",
            "Repeat guests retained",
            json!(ratio(get("repeatRetained"), get("repeatEligible"))),
            "percent",
            get("repeatRetained"),
            Some(get("repeatEligible")),
            "Repeat-guest cohorts old enough for a 90-day outcome that returned within 90 days.",
            "Completed appointments",
        ),
        metric(
            "new_guests_retained",
            "New guests retained",
            json!(ratio(get("newRetained"), get("newEligible"))),
            "percent",
            get("newRetained"),
            Some(get("newEligible")),
            "First-visit cohorts old enough for a 90-day outcome that returned within 90 days.",
            "Completed appointments",
        ),
        metric(
            "requested_count",
            "Requested count",
            json!(get("requestedCount")),
            "count",
            get("requestedCount"),
            None,
            "Valid appointments where this provider was specifically requested.",
            "Appointment Book",
        ),
        metric(
            "service_sales",
            "Service sales",
            json!(service),
            "paise",
            service,
            None,
            "Attributed service sales for the selected sale/close-date basis.",
            "POS commission snapshots",
        ),
        metric(
            "rebook_count",
            "Rebook count",
            json!(get("rebookCount")),
            "count",
            get("rebookCount"),
            None,
            "Completed visits with a future appointment booked on the visit date.",
            "Appointments",
        ),
        metric(
            "rebook_rate",
            "Rebook rate",
            json!(ratio(get("rebookCount"), rebook_denominator)),
            "percent",
            get("rebookCount"),
            Some(rebook_denominator),
            "Same-day rebooks ÷ completed appointments × 100.",
            "Appointments",
        ),
        metric(
            "new_service_guests",
            "New service guests",
            json!(get("newServiceGuests")),
            "count",
            get("newServiceGuests"),
            None,
            "Unique completed-service guests with no earlier completed visit.",
            "Appointments",
        ),
        metric(
            "service_invoices_with_product_percent",
            "Invoices with product %",
            json!(ratio(
                get("serviceProductInvoiceCount"),
                get("serviceInvoiceCount")
            )),
            "percent",
            get("serviceProductInvoiceCount"),
            Some(get("serviceInvoiceCount")),
            "Service invoices containing product ÷ service invoices × 100.",
            "POS invoice lines",
        ),
        metric(
            "average_feedback",
            "Average feedback",
            json!((feedback_count > 0).then(|| get("feedbackSum") as f64 / feedback_count as f64)),
            "rating",
            get("feedbackSum"),
            Some(feedback_count),
            "Guest rating total ÷ submitted ratings.",
            "Customer booking reviews",
        ),
        metric(
            "guest_count",
            "Guest count",
            json!(get("guestCount")),
            "count",
            get("guestCount"),
            None,
            "Unique guests served or attributed in the selected period.",
            "Appointments and POS",
        ),
        metric(
            "average_invoice_value",
            "Average invoice value",
            json!((invoices > 0).then(|| get("totalPaise") / invoices)),
            "paise",
            get("totalPaise"),
            Some(invoices),
            "Total attributed sales ÷ attributed invoice count.",
            "POS commission snapshots",
        ),
        metric(
            "service_revenue",
            "Service revenue",
            json!(service),
            "paise",
            service,
            None,
            "Attributed service revenue on the selected basis.",
            "POS commission snapshots",
        ),
        metric(
            "free_service_revenue",
            "Free-service revenue",
            json!(get("freeServicePaise")),
            "paise",
            get("freeServicePaise"),
            None,
            "Attributed gross value of zero-net service lines.",
            "POS invoice lines",
        ),
        metric(
            "product_revenue",
            "Product revenue",
            json!(product),
            "paise",
            product,
            None,
            "Attributed product revenue on the selected basis.",
            "POS commission snapshots",
        ),
        metric(
            "membership_revenue",
            "Membership revenue",
            json!(get("membershipPaise")),
            "paise",
            get("membershipPaise"),
            None,
            "Attributed membership revenue on the selected basis.",
            "POS commission snapshots",
        ),
        metric(
            "package_revenue",
            "Package revenue",
            json!(get("packagePaise")),
            "paise",
            get("packagePaise"),
            None,
            "Attributed package revenue on the selected basis.",
            "POS commission snapshots",
        ),
        metric(
            "utilization",
            "Utilization",
            json!(ratio(get("bookedMinutes"), scheduled)),
            "percent",
            get("bookedMinutes"),
            Some(scheduled),
            "Completed service minutes ÷ published scheduled minutes × 100.",
            "Appointments and staff schedules",
        ),
        metric(
            "attendance",
            "Attendance",
            json!(ratio(get("presentDays"), attendance_days)),
            "percent",
            get("presentDays"),
            Some(attendance_days),
            "Present days ÷ recorded present and absent days × 100.",
            "Attendance records",
        ),
        metric(
            "tips",
            "Tips",
            json!(get("tipsPaise")),
            "paise",
            get("tipsPaise"),
            None,
            "Tips attributed directly or through persisted tip splits.",
            "POS sales",
        ),
        metric(
            "commissions",
            "Commissions",
            json!(get("commissionPaise")),
            "paise",
            get("commissionPaise"),
            None,
            "Persisted item-level commission snapshots.",
            "Commission snapshots",
        ),
    ];
    let settings = performance_settings(db, tenant_id, branch_id).await?;
    let visible_keys = settings["visibleMetricKeys"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    metrics.retain(|item| {
        let earnings_metric = matches!(item["key"].as_str(), Some("tips" | "commissions"));
        visible_keys
            .iter()
            .any(|key| key.as_str() == item["key"].as_str())
            && (financial_visible
                || earnings_metric
                || !matches!(item["unit"].as_str(), Some("paise")))
            && (earnings_visible || !earnings_metric)
    });
    let built_in = metrics.clone();
    for custom in settings["customMetrics"]
        .as_array()
        .cloned()
        .unwrap_or_default()
    {
        if let Some(source) = built_in
            .iter()
            .find(|item| item["key"] == custom["sourceMetricKey"])
        {
            let mut row = source.clone();
            row["key"] = custom["key"].clone();
            row["label"] = custom["label"].clone();
            row["custom"] = json!(true);
            metrics.push(row);
        }
    }
    let performance_rows =
        staff_advanced_service::performance(db, tenant_id, branch_id, from, to, "")
            .await?
            .rows;
    let own = performance_rows
        .iter()
        .find(|row| row.staff_id == staff_id)
        .cloned()
        .ok_or_else(|| AppError::not_found("linked employee profile not found"))?;
    let goals =
        staff_enterprise_service::list_coaching_goals(db, tenant_id, branch_id, &staff_id, "")
            .await?;
    let skills = staff_enterprise_service::staff_skill_matrix(db, tenant_id, branch_id)
        .await?
        .into_iter()
        .find(|row| row.staff_id == staff_id);
    let mut lms = staff_enterprise_service::lms_dashboard(db, tenant_id, branch_id).await?;
    for key in ["enrolments", "skillMatrix", "recommendations"] {
        if let Some(rows) = lms[key].as_array_mut() {
            rows.retain(|row| row["staffId"].as_str().is_none_or(|id| id == staff_id));
        }
    }
    lms["courses"] = json!([]);
    lms["requirements"] = json!([]);
    let pay_periods = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object('id',run.id,'label',run.cycle,'from',run.period_start,'to',run.period_end,'status',run.status)
        FROM staff_payroll_runs run JOIN staff_payroll_items item ON item.payroll_run_id=run.id
        WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.staff_id=$3
        ORDER BY run.period_end DESC LIMIT 12"#,
    ).bind(tenant_id).bind(branch_id).bind(&staff_id).fetch_all(db).await
      .map_err(|_| AppError::internal("failed to load performance pay periods"))?;
    let score = json!({
      "value":own.score,"grade":own.grade,"explanation":"Transparent weighted operational score; never used as an automatic disciplinary decision.",
      "components":[
        {"key":"completion","weightPercent":25,"value":own.completion_percent,"source":"completed appointments / appointments"},
        {"key":"attendance","weightPercent":25,"value":ratio(own.present_days,own.present_days+own.absent_days),"source":"attendance records"},
        {"key":"utilization","weightPercent":20,"value":own.utilization_percent,"source":"worked minutes / scheduled minutes"},
        {"key":"repeat_clients","weightPercent":15,"value":own.repeat_client_percent,"source":"repeat clients / unique clients"},
        {"key":"revenue_target","weightPercent":15,"value":own.revenue_target_percent,"source":"attributed revenue / configured target"}
      ]
    });
    let coaching = own.opportunities.iter().map(|item| json!({"title":item,"reason":item,"evidenceSource":"Persisted performance facts","punitive":false})).collect::<Vec<_>>();
    Ok(json!({
      "range":{"from":from,"to":to,"basis":basis,"timeZone":"Asia/Kolkata"},
      "generatedAt":Utc::now(),"dataFreshnessAt":facts["freshAt"],"settings":settings,
      "metrics":metrics,"trends":trends,"score":score,"goals":goals,"coaching":coaching,"skills":skills,
      "training":lms,"payPeriods":pay_periods,
      "safeguards":{"excludedFromScore":true,"burnout":own.burnout_risk,"retention":own.retention_risk,
        "explanation":"Wellbeing signals are advisory, visible with evidence, and excluded from ranking and automatic punitive actions."}
    }))
}

#[allow(clippy::too_many_arguments)]
pub async fn appointment_book(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    self_staff_id: &str,
    requested_staff_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    status: &str,
    client_query: &str,
    team_visible: bool,
    provider_catalog_visible: bool,
) -> Result<Value, AppError> {
    let staff_filter = if team_visible {
        requested_staff_id
    } else {
        self_staff_id
    };
    let history = appointment_history(
        db,
        tenant_id,
        branch_id,
        AppointmentHistoryQuery {
            staff_id: staff_filter,
            from: Some(from),
            to: Some(to),
            page: 1,
            page_size: 100,
            query: "",
            status,
            service_id: "",
            service: "",
            department: "",
            sort: "asc",
            include_client_names: true,
        },
    )
    .await?;
    let appointment_total = history["totalItems"].as_i64().unwrap_or_default();
    let mut appointments = history["rows"].as_array().cloned().unwrap_or_default();
    let mut page = 2;
    while appointments.len() < appointment_total.max(0) as usize {
        let next = appointment_history(
            db,
            tenant_id,
            branch_id,
            AppointmentHistoryQuery {
                staff_id: staff_filter,
                from: Some(from),
                to: Some(to),
                page,
                page_size: 100,
                query: "",
                status,
                service_id: "",
                service: "",
                department: "",
                sort: "asc",
                include_client_names: true,
            },
        )
        .await?;
        let rows = next["rows"].as_array().cloned().unwrap_or_default();
        if rows.is_empty() {
            break;
        }
        appointments.extend(rows);
        page += 1;
    }
    let staff = staff_repository::list_filtered(
        db,
        tenant_id,
        branch_id,
        &staff_repository::StaffListFilters {
            query: "",
            job: "",
            active: Some(true),
        },
        "first_name",
        "ASC",
        200,
        0,
    )
    .await
    .map_err(|_| AppError::internal("failed to load appointment providers"))?
    .into_iter()
    .filter(|row| team_visible || provider_catalog_visible || row.id == self_staff_id)
    .map(|row| json!({
        "id":row.id,
        "name":if row.appointment_display_name.trim().is_empty() { format!("{} {}",row.first_name,row.last_name).trim().to_string() } else { row.appointment_display_name },
        "jobTitle":row.job_title
    }))
    .collect::<Vec<_>>();
    let staff_ids = if team_visible {
        staff
            .iter()
            .filter_map(|row| row.get("id").and_then(Value::as_str).map(str::to_string))
            .collect::<Vec<_>>()
    } else {
        vec![self_staff_id.to_string()]
    };
    let schedules =
        staff_schedule_repository::list_entries(db, tenant_id, branch_id, from, to, &staff_ids)
            .await
            .map_err(|_| AppError::internal("failed to load provider schedules"))?;
    let india = FixedOffset::east_opt(19_800).expect("India offset is valid");
    let range_start = india
        .from_local_datetime(&from.and_hms_opt(0, 0, 0).expect("midnight is valid"))
        .single()
        .expect("India local date is unambiguous")
        .with_timezone(&Utc);
    let range_end = india
        .from_local_datetime(
            &to.succ_opt()
                .unwrap_or(to)
                .and_hms_opt(0, 0, 0)
                .expect("midnight is valid"),
        )
        .single()
        .expect("India local date is unambiguous")
        .with_timezone(&Utc);
    let blockouts = staff_schedule_repository::list_blockouts(
        db,
        tenant_id,
        branch_id,
        if team_visible { "" } else { self_staff_id },
        range_start,
        range_end,
    )
    .await
    .map_err(|_| AppError::internal("failed to load provider block-outs"))?;
    let services = services_repository::list(db, tenant_id, branch_id, "", 500, 0)
        .await
        .map_err(|_| AppError::internal("failed to load appointment services"))?
        .into_iter()
        .filter(|row| row.active)
        .map(|row| json!({
            "id":row.id,"name":row.name,"category":row.category,
            "durationMinutes":row.duration_minutes,"pricePaise":row.price_paise,
            "staffIds":serde_json::from_str::<Value>(&row.staff_ids_json).unwrap_or_else(|_| json!([])),
            "variants":serde_json::from_str::<Value>(&row.variants_json).unwrap_or_else(|_| json!([])),
            "addons":serde_json::from_str::<Value>(&row.addons_json).unwrap_or_else(|_| json!([])),
            "staffPrices":serde_json::from_str::<Value>(&row.staff_prices_json).unwrap_or_else(|_| json!([]))
        }))
        .collect::<Vec<_>>();
    let clients = clients_repository::list(db, tenant_id, branch_id, client_query.trim(), 20, 0)
        .await
        .map_err(|_| AppError::internal("failed to search appointment guests"))?
        .into_iter()
        .filter(|row| row.active)
        .map(|row| json!({
            "id":row.id,"code":row.code,"name":format!("{} {}",row.first_name,row.last_name).trim(),
            "phone":row.phone,"email":row.email,"preferredStaffId":row.preferred_staff_id
        }))
        .collect::<Vec<_>>();
    let resources = sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object('id',id,'name',name,'kind',kind,'department',department,'active',active) FROM appointment_resources WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY kind,name,id",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load appointment resources"))?;
    let packages = sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object('id',id,'name',name,'serviceIds',COALESCE(service_ids_json,'[]'::jsonb),'serviceRows',COALESCE(service_rows_json,'[]'::jsonb),'pricePaise',price_paise) FROM packages WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY name,id LIMIT 200",
    )
    .bind(tenant_id).bind(branch_id).fetch_all(db).await
    .map_err(|_| AppError::internal("failed to load day packages"))?;
    let waitlist = if provider_catalog_visible {
        sqlx::query_scalar::<_, Value>(
            "SELECT jsonb_build_object('id',waitlist.id,'clientId',waitlist.customer_id,'clientName',COALESCE(TRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),'serviceIds',COALESCE(NULLIF(waitlist.service_ids_json,''),'[]')::jsonb,'preferredStaffId',COALESCE(waitlist.preferred_staff_id,''),'preferredSlotAt',waitlist.preferred_slot_at,'notes',waitlist.notes,'status',waitlist.status) FROM appointment_waitlist waitlist LEFT JOIN clients client ON client.tenant_id=waitlist.tenant_id AND client.branch_id=waitlist.branch_id AND client.id=waitlist.customer_id WHERE waitlist.tenant_id=$1 AND waitlist.branch_id=$2 AND waitlist.status IN ('pending','offered') ORDER BY waitlist.preferred_slot_at,waitlist.created_at LIMIT 100",
        ).bind(tenant_id).bind(branch_id).fetch_all(db).await
        .map_err(|_| AppError::internal("failed to load appointment waitlist"))?
    } else {
        Vec::new()
    };
    let online_requests = if provider_catalog_visible {
        sqlx::query_scalar::<_, Value>(
            "SELECT jsonb_build_object('id',id,'requestType',request_type,'appointmentId',COALESCE(NULLIF(appointment_id,''),payload::jsonb->>'appointmentId'),'payload',payload::jsonb,'status',status,'createdAt',created_at) FROM smart_booking_requests WHERE tenant_id=$1 AND branch_id=$2 AND status='pending' AND (LOWER(request_type) LIKE '%resched%' OR LOWER(request_type) LIKE '%cancel%') ORDER BY created_at LIMIT 100",
        ).bind(tenant_id).bind(branch_id).fetch_all(db).await
        .map_err(|_| AppError::internal("failed to load online booking requests"))?
    } else {
        Vec::new()
    };
    Ok(json!({
        "selfStaffId":self_staff_id,"from":from,"to":to,
        "appointments":appointments,"appointmentTotal":appointment_total,
        "staff":staff,"services":services,"packages":packages,"resources":resources,"clients":clients,
        "schedules":schedules,"blockouts":blockouts,"waitlist":waitlist,"onlineRequests":online_requests
    }))
}

pub async fn self_roster(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<Value>, AppError> {
    if to < from || (to - from).num_days() > 62 {
        return Err(AppError::validation(
            "staff date range must be 63 days or less",
        ));
    }
    let staff_id =
        staff_enterprise_service::self_staff_id(db, tenant_id, branch_id, user_id).await?;
    roster_for_staff(db, tenant_id, branch_id, &staff_id, from, to).await
}

async fn roster_for_staff(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<Value>, AppError> {
    sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
              'id',id,'date',schedule_date,'startTime',shift1_start,'endTime',shift1_end,
              'type','shift','status',status,'version',version)
            FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
              AND schedule_date BETWEEN $4 AND $5 ORDER BY schedule_date"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff roster"))
}

#[allow(clippy::too_many_arguments)]
pub async fn business(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    mut from: NaiveDate,
    mut to: NaiveDate,
    page: i64,
    page_size: i64,
    query: &str,
    status: &str,
    sort: &str,
    all_history: bool,
    service_id: &str,
    service: &str,
    department: &str,
    visible: StaffBusinessVisibility,
    earnings_visible: bool,
) -> Result<Value, AppError> {
    let staff_id =
        staff_enterprise_service::self_staff_id(db, tenant_id, branch_id, user_id).await?;
    if all_history {
        let bounds = sqlx::query_as::<_, (Option<NaiveDate>, Option<NaiveDate>)>(
            "SELECT MIN((start_at AT TIME ZONE 'Asia/Kolkata')::DATE),MAX((start_at AT TIME ZONE 'Asia/Kolkata')::DATE) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3",
        )
        .bind(tenant_id).bind(branch_id).bind(&staff_id).fetch_one(db).await
        .map_err(|_| AppError::internal("failed to load appointment history range"))?;
        if let (Some(first), Some(last)) = bounds {
            from = first;
            to = last;
        }
    } else if to < from || (to - from).num_days() > 366 {
        return Err(AppError::validation(
            "staff business range must be one year or less",
        ));
    }
    let page = page.max(1);
    let page_size = page_size.clamp(1, 100);
    let query = query.trim().to_ascii_lowercase();
    let descending = sort != "asc";
    let history = appointment_history(
        db,
        tenant_id,
        branch_id,
        AppointmentHistoryQuery {
            staff_id: &staff_id,
            from: Some(from),
            to: Some(to),
            page,
            page_size,
            query: &query,
            status,
            service_id,
            service,
            department,
            sort,
            include_client_names: visible.client_name,
        },
    )
    .await?;
    let appointment_total = history["totalItems"].as_i64().unwrap_or_default();
    let appointments = history["rows"].clone();
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
                AND sale.staff_id=$3 AND COALESCE(sale.business_date,(sale.created_at AT TIME ZONE 'Asia/Kolkata')::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'subtotalPaise',COALESCE((SELECT SUM(sale.subtotal_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,(sale.created_at AT TIME ZONE 'Asia/Kolkata')::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'discountPaise',COALESCE((SELECT SUM(sale.discount_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,(sale.created_at AT TIME ZONE 'Asia/Kolkata')::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'couponDiscountPaise',0,'afterDiscountPaise',0,
              'gstPaise',COALESCE((SELECT SUM(sale.tax_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,(sale.created_at AT TIME ZONE 'Asia/Kolkata')::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'totalPaise',COALESCE((SELECT SUM(sale.total_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,(sale.created_at AT TIME ZONE 'Asia/Kolkata')::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'paidPaise',COALESCE((SELECT SUM(sale.paid_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,(sale.created_at AT TIME ZONE 'Asia/Kolkata')::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'duePaise',COALESCE((SELECT SUM(GREATEST(sale.total_paise-sale.paid_paise,0)) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,(sale.created_at AT TIME ZONE 'Asia/Kolkata')::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0))
            FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
              AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to)
    .fetch_one(db).await.map_err(|_| AppError::internal("failed to load staff business summary"))?;
    summary["appointmentValuePaise"] = json!(sqlx::query_scalar::<_, i64>(
        r#"SELECT COALESCE(SUM(service.price_paise),0)::BIGINT
            FROM appointments appointment
            JOIN LATERAL jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb) selected(id) ON TRUE
            JOIN services service ON service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND service.id=selected.id
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.staff_id=$3
              AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to)
    .fetch_one(db).await.map_err(|_| AppError::internal("failed to load staff appointment value"))?);
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
    let estimated_worked_minutes = summary["workedMinutes"].as_i64().unwrap_or_default();
    let (actual_worked_minutes, duty_minutes) = sqlx::query_as::<_, (i64, i64)>(
        r#"SELECT
              COALESCE((SELECT SUM(worked_minutes) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0)::BIGINT,
              COALESCE((SELECT SUM(COALESCE(EXTRACT(EPOCH FROM (shift1_end-shift1_start))/60,0)+COALESCE(EXTRACT(EPOCH FROM (shift2_end-shift2_start))/60,0)) FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND schedule_date BETWEEN $4 AND $5 AND status='working'),0)::BIGINT"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to)
    .fetch_one(db).await.map_err(|_| AppError::internal("failed to load staff work minutes"))?;
    let worked_minutes = if actual_worked_minutes > 0 {
        actual_worked_minutes
    } else {
        estimated_worked_minutes
    };
    summary["workedMinutes"] = json!(worked_minutes);
    let services = sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object('id',id,'name',name,'category',category,'productConsumption',COALESCE(product_consumption_json,'[]'::JSONB)) FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY name,id",
    )
    .bind(tenant_id).bind(branch_id).fetch_all(db).await
    .map_err(|_| AppError::internal("failed to load staff business services"))?;
    let products = sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object('id',id,'name',name,'brand',brand,'unit',unit,'stockQuantity',stock_quantity,'reorderPoint',reorder_point,'dualUseStock',dual_use_stock) FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY name,id",
    )
    .bind(tenant_id).bind(branch_id).fetch_all(db).await
    .map_err(|_| AppError::internal("failed to load staff product usage items"))?;
    let mut product_usage_history = inventory_repository::list_backbar_usage(
        db, tenant_id, branch_id, None, &staff_id, "", "", 50,
    )
    .await
    .map_err(|_| AppError::internal("failed to load staff product usage history"))?;
    if !visible.client_name {
        product_usage_history
            .iter_mut()
            .for_each(|row| row.client_name.clear());
    }
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
          'invoiceCount',COALESCE((SELECT COUNT(*) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND COALESCE(business_date,(created_at AT TIME ZONE 'Asia/Kolkata')::DATE) BETWEEN $4 AND $5 AND status NOT IN ('draft','cancelled','voided')),0),
          'actualWorkedMinutes',COALESCE((SELECT SUM(worked_minutes) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0),
          'estimatedWorkedMinutes',$6::BIGINT,
          'attendanceMinutes',COALESCE((SELECT SUM(worked_minutes+break_minutes) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0),
          'breakMinutes',COALESCE((SELECT SUM(break_minutes) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0),
          'dutyMinutes',$7::BIGINT,
          'utilizationPercent',CASE WHEN $7::BIGINT>0 THEN ROUND($6::NUMERIC*100/$7::BIGINT,1) ELSE NULL END,
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
    .bind(worked_minutes)
    .bind(duty_minutes).bind(visible.service_amount)
    .bind(summary["paidPaise"].as_i64().unwrap_or_default()).bind(summary["duePaise"].as_i64().unwrap_or_default())
    .bind(summary["bills"].as_i64().unwrap_or_default()).bind(summary["totalPaise"].as_i64().unwrap_or_default())
    .fetch_one(db).await.map_err(|_| AppError::internal("failed to load staff business performance"))?;
    performance["actualWorkedMinutes"] = json!(actual_worked_minutes);
    performance["estimatedWorkedMinutes"] = json!(estimated_worked_minutes);
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
    let (product_invoices, attributed_invoices) = sqlx::query_as::<_, (i64, i64)>(
        r#"SELECT COUNT(DISTINCT snapshot.sale_id) FILTER(WHERE line.line_type='product')::BIGINT,
                  COUNT(DISTINCT snapshot.sale_id)::BIGINT
           FROM pos_staff_commission_snapshots snapshot
           JOIN pos_sale_lines line ON line.tenant_id=snapshot.tenant_id AND line.branch_id=snapshot.branch_id AND line.id=snapshot.sale_line_id
           WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3 AND snapshot.business_date BETWEEN $4 AND $5"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to)
    .fetch_one(db).await.map_err(|_| AppError::internal("failed to load staff retail conversion"))?;
    performance["productInvoiceCount"] = if visible.service_amount {
        json!(product_invoices)
    } else {
        Value::Null
    };
    performance["retailConversionPercent"] = if visible.service_amount {
        json!(if attributed_invoices > 0 {
            (product_invoices * 100 / attributed_invoices).clamp(0, 100)
        } else {
            0
        })
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
    let appointment_pages = (appointment_total + page_size - 1) / page_size;
    Ok(json!({
        "date":to,"range":{"from":from,"to":to,"timeZone":"Asia/Kolkata"},"staff":staff,
        "billingVisible":visible.financial(),"permissions":{"billing":visible.financial(),"earnings":earnings_visible,"targets":true,
          "invoiceDetail":visible.invoice_detail(),"clientName":visible.client_name,"invoiceNumber":visible.invoice_number,
          "discount":visible.discount,"tax":visible.tax,"serviceAmount":visible.service_amount,"commission":visible.commission},
        "summary":summary,
        "performance":performance,
        "earnings":earnings,"targets":[],"services":services,"products":products,
        "productUsageHistory":product_usage_history,"dailyBreakdown":daily_breakdown,
        "pagination":{"page":page,"pageSize":page_size,"totalItems":total_items,"totalPages":total_pages,"hasMore":page<total_pages,
          "appointmentTotal":appointment_total,"appointmentPages":appointment_pages,"appointmentHasMore":page<appointment_pages,"serviceTotal":service_total},
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
