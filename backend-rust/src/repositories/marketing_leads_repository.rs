use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::PgPool;

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketingLeadRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub client_id: Option<String>,
    pub first_name: String,
    pub last_name: String,
    pub phone: String,
    pub email: String,
    pub source: String,
    pub stage: String,
    pub qualification_status: String,
    pub score: i32,
    pub owner_user_id: String,
    pub next_follow_up_date: Option<NaiveDate>,
    pub converted_appointment_id: Option<String>,
    pub notes: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketingLeadActivity {
    pub id: String,
    pub lead_id: String,
    pub activity_type: String,
    pub body: String,
    pub next_follow_up_date: Option<NaiveDate>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketingLeadOwner {
    pub id: String,
    pub name: String,
    pub role_name: String,
}

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WinBackCandidate {
    pub client_id: String,
    pub client_name: String,
    pub last_visit_at: Option<DateTime<Utc>>,
    pub inactive_days: i64,
    pub last_service: String,
    pub visit_frequency_days: Option<f64>,
    pub ai_reason: String,
    pub recommended_offer: String,
    pub avoid_offer: String,
    pub preferred_channel: String,
    pub consented: bool,
}

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WinBackResults {
    pub sent: i64,
    pub booked: i64,
    pub revenue_paise: i64,
    pub opt_outs: i64,
}

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientIntelligenceRecord {
    pub client_id: String,
    pub client_name: String,
    pub last_visit_at: Option<DateTime<Utc>>,
    pub inactive_days: i64,
    pub visit_frequency_days: Option<f64>,
    pub last_service: String,
    pub favourite_services: String,
    pub average_spend_paise: i64,
    pub lifetime_value_paise: i64,
    pub no_show_rate_bps: i32,
    pub cancellation_rate_bps: i32,
    pub preferred_staff_name: String,
    pub preferred_channel: String,
    pub consent_status: String,
    pub upcoming_appointment_at: Option<DateTime<Utc>>,
    pub membership_status: String,
    pub loyalty_points: i32,
    pub previous_offer_count: i64,
    pub campaign_sent_count: i64,
    pub campaign_response_count: i64,
    pub churn_risk_score: i32,
    pub next_best_action: String,
    pub next_best_action_reason: String,
    pub segment_keys: Vec<String>,
}

pub async fn ensure_automation_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(r#"INSERT INTO whatsapp_automation_rules(tenant_id,branch_id,name,trigger_event,action_template,status,priority,config_json)
      SELECT $1,$2,item.name,item.trigger_event,item.action_template,'active',item.priority,item.config_json
      FROM (VALUES
       ('Appointment confirmation','appointment_confirmation','Your appointment is confirmed.',10,'{"conditions":["appointment booked"],"exclusions":["cancelled appointment"],"channels":["whatsapp","sms"],"sendTime":"immediate","frequencyCapDays":0,"approvalMode":"automatic"}'::JSONB),
       ('Appointment reminder','appointment_reminder','Reminder: your appointment is scheduled soon.',20,'{"conditions":["appointment in 24 hours"],"exclusions":["cancelled or completed"],"channels":["whatsapp","sms"],"sendTime":"24 hours before","frequencyCapDays":1,"approvalMode":"automatic"}'::JSONB),
       ('Reschedule or cancellation','reschedule_cancellation','Your appointment schedule has changed.',30,'{"conditions":["appointment rescheduled or cancelled"],"exclusions":[],"channels":["whatsapp","sms"],"sendTime":"immediate","frequencyCapDays":0,"approvalMode":"automatic"}'::JSONB),
       ('No-show recovery','no_show_recovery','We missed you today. Reply to choose a new appointment time.',40,'{"conditions":["appointment marked no-show"],"exclusions":["upcoming appointment exists"],"channels":["whatsapp","sms"],"sendTime":"2 hours after","frequencyCapDays":7,"approvalMode":"manual"}'::JSONB),
       ('Post-visit thank-you','post_visit_thank_you','Thank you for visiting us.',50,'{"conditions":["visit completed"],"exclusions":[],"channels":["whatsapp"],"sendTime":"2 hours after","frequencyCapDays":1,"approvalMode":"automatic"}'::JSONB),
       ('Review request','review_request','Thank you for visiting us. Please share your experience.',60,'{"conditions":["visit completed"],"exclusions":["review already submitted"],"channels":["whatsapp","sms","email"],"sendTime":"24 hours after","frequencyCapDays":30,"approvalMode":"automatic"}'::JSONB),
       ('Service-specific rebooking','service_rebooking','It may be time to rebook your usual service.',70,'{"conditions":["service due"],"exclusions":["upcoming appointment exists"],"channels":["whatsapp"],"sendTime":"09:00","frequencyCapDays":14,"approvalMode":"manual"}'::JSONB),
       ('Birthday or anniversary','occasion_campaign','Warm wishes from your salon.',80,'{"conditions":["occasion within 7 days"],"exclusions":[],"channels":["whatsapp","sms","email"],"sendTime":"09:00","frequencyCapDays":365,"approvalMode":"manual"}'::JSONB),
       ('New-client second visit','new_client_second_visit','We would love to welcome you for your next visit.',90,'{"conditions":["one completed visit","no upcoming appointment"],"exclusions":[],"channels":["whatsapp"],"sendTime":"09:00","frequencyCapDays":30,"approvalMode":"manual"}'::JSONB),
       ('30/60/90-day win-back','win_back','We have missed you. Reply to plan your next visit.',100,'{"conditions":["inactive 30, 60 or 90 days"],"exclusions":["upcoming appointment exists"],"channels":["whatsapp","sms","email"],"sendTime":"10:00","frequencyCapDays":30,"approvalMode":"manual"}'::JSONB),
       ('Loyal-client reward','loyal_client_reward','Thank you for your loyalty.',110,'{"conditions":["loyalty milestone reached"],"exclusions":[],"channels":["whatsapp","email"],"sendTime":"10:00","frequencyCapDays":90,"approvalMode":"manual"}'::JSONB),
       ('Membership or package renewal','membership_renewal','Your membership or package is due for renewal.',120,'{"conditions":["expires within 30 days"],"exclusions":["renewed already"],"channels":["whatsapp","sms","email"],"sendTime":"09:00","frequencyCapDays":7,"approvalMode":"manual"}'::JSONB),
       ('Wallet balance reminder','wallet_reminder','You have wallet balance available for your next visit.',130,'{"conditions":["unused wallet balance"],"exclusions":["upcoming appointment exists"],"channels":["whatsapp"],"sendTime":"10:00","frequencyCapDays":30,"approvalMode":"manual"}'::JSONB),
       ('Abandoned booking','abandoned_booking','Complete your booking when you are ready.',140,'{"conditions":["booking abandoned"],"exclusions":["booking converted"],"channels":["whatsapp","sms"],"sendTime":"30 minutes after","frequencyCapDays":1,"approvalMode":"automatic"}'::JSONB),
       ('Last-minute empty slot','last_minute_empty_slot','A last-minute appointment is available.',150,'{"conditions":["slot available today"],"exclusions":["upcoming appointment exists"],"channels":["whatsapp","sms"],"sendTime":"immediate","frequencyCapDays":1,"approvalMode":"manual"}'::JSONB),
       ('Negative review recovery','review_recovery','We are sorry your experience fell short. Please let us help.',160,'{"conditions":["rating 2 or below"],"exclusions":["recovery already sent"],"channels":["whatsapp"],"sendTime":"immediate","frequencyCapDays":14,"approvalMode":"manual"}'::JSONB),
       ('Slow-day campaign','slow_day_campaign','Appointments are available on our quieter day.',170,'{"conditions":["slow day detected"],"exclusions":["upcoming appointment exists"],"channels":["whatsapp","sms","email"],"sendTime":"10:00","frequencyCapDays":7,"approvalMode":"manual"}'::JSONB)
      ) AS item(name,trigger_event,action_template,priority,config_json)
      WHERE NOT EXISTS(SELECT 1 FROM whatsapp_automation_rules rule WHERE rule.tenant_id=$1 AND rule.branch_id=$2 AND rule.trigger_event=item.trigger_event)"#)
      .bind(tenant_id).bind(branch_id).execute(db).await?;
    Ok(())
}

pub async fn automation_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(r#"SELECT JSONB_BUILD_OBJECT('id',rule.id,'name',rule.name,'trigger',rule.trigger_event,'status',rule.status,'template',rule.action_template,'config',rule.config_json,
      'performance',JSONB_BUILD_OBJECT('sent',COUNT(outbox.id) FILTER(WHERE outbox.status='sent'),'failed',COUNT(outbox.id) FILTER(WHERE outbox.status='failed'),'blocked',COUNT(outbox.id) FILTER(WHERE outbox.status='blocked'))) FROM whatsapp_automation_rules rule
      LEFT JOIN benefit_notification_outbox outbox ON outbox.tenant_id=rule.tenant_id AND outbox.branch_id=rule.branch_id AND (outbox.source_type=rule.trigger_event OR (rule.trigger_event IN ('appointment_confirmation','reschedule_cancellation') AND outbox.source_type='appointment_notification') OR (rule.trigger_event='membership_renewal' AND outbox.source_type IN ('membership_reminder','package_alert')))
      WHERE rule.tenant_id=$1 AND rule.branch_id=$2 AND rule.status<>'archived' GROUP BY rule.id ORDER BY rule.priority,rule.created_at"#)
      .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn update_automation_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
    config: &Value,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar("UPDATE whatsapp_automation_rules SET status=$4,config_json=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status<>'archived' RETURNING JSONB_BUILD_OBJECT('id',id,'status',status,'config',config_json)")
      .bind(tenant_id).bind(branch_id).bind(id).bind(status).bind(config).fetch_optional(db).await
}

pub async fn active_automation_triggers(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT trigger_event FROM whatsapp_automation_rules WHERE tenant_id=$1 AND branch_id=$2 AND status='active'")
      .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn active_automation_controls(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<(String, Value)>, sqlx::Error> {
    sqlx::query_as("SELECT trigger_event,config_json FROM whatsapp_automation_rules WHERE tenant_id=$1 AND branch_id=$2 AND status='active'")
      .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn automation_frequency_reached(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    source_type: &str,
    days: i64,
) -> Result<bool, sqlx::Error> {
    if days <= 0 {
        return Ok(false);
    }
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM benefit_notification_outbox WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND source_type=$4 AND created_at>=NOW()-MAKE_INTERVAL(days=>$5::INTEGER) AND status IN ('queued','processing','sent'))")
      .bind(tenant_id).bind(branch_id).bind(client_id).bind(source_type).bind(days as i32).fetch_one(db).await
}

const LEAD_COLUMNS: &str = "id,tenant_id,branch_id,client_id,first_name,last_name,phone,email,source,stage,qualification_status,score,owner_user_id,next_follow_up_date,converted_appointment_id,notes,created_by,created_at,updated_at";

pub async fn campaign_attribution(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(r#"WITH campaign AS (
      SELECT id,title,metadata_json,created_at FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND notification_type='marketing_campaign'
    ), delivery AS (
      SELECT payload_json->>'campaignId' campaign_id,COUNT(DISTINCT client_id)::BIGINT audience,COUNT(*) FILTER(WHERE attempts>0)::BIGINT sent,COUNT(*) FILTER(WHERE status='sent')::BIGINT delivered,COUNT(*) FILTER(WHERE status='failed')::BIGINT failed FROM benefit_notification_outbox WHERE tenant_id=$1 AND branch_id=$2 AND source_type='marketing_campaign' GROUP BY payload_json->>'campaignId'
    ), event AS (
      SELECT campaign_id,COUNT(*) FILTER(WHERE event_type='opened')::BIGINT opened,COUNT(*) FILTER(WHERE event_type='clicked')::BIGINT clicked,COUNT(*) FILTER(WHERE event_type='opted_out')::BIGINT opt_outs FROM marketing_campaign_events WHERE tenant_id=$1 AND branch_id=$2 GROUP BY campaign_id
    ), booking AS (
      SELECT SPLIT_PART(source,':',2) campaign_id,COUNT(*)::BIGINT clicks FROM public_booking_sessions WHERE tenant_id=$1 AND branch_id=$2 AND source LIKE 'marketing_campaign:%' GROUP BY SPLIT_PART(source,':',2)
    ), appointment AS (
      SELECT SPLIT_PART(source,':',2) campaign_id,COUNT(*)::BIGINT bookings,COUNT(*) FILTER(WHERE status IN ('completed','billed','paid'))::BIGINT completed FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND source LIKE 'marketing_campaign:%' GROUP BY SPLIT_PART(source,':',2)
    ), sale AS (
      SELECT SPLIT_PART(appointment.source,':',2) campaign_id,COALESCE(SUM(pos.paid_paise),0)::BIGINT revenue_paise,COALESCE(SUM(pos.discount_paise),0)::BIGINT discount_cost_paise,COUNT(*) FILTER(WHERE pos.coupon_code<>'' AND pos.coupon_code=offer.code)::BIGINT offer_redemptions
      FROM appointments appointment JOIN pos_sales pos ON pos.tenant_id=appointment.tenant_id AND pos.branch_id=appointment.branch_id AND pos.source='appointment' AND pos.reference_id=appointment.id AND pos.status NOT IN ('draft','cancelled','voided','refunded') LEFT JOIN campaign ON campaign.id=SPLIT_PART(appointment.source,':',2) LEFT JOIN pos_coupons offer ON offer.tenant_id=$1 AND offer.branch_id=$2 AND offer.id=campaign.metadata_json->>'offerId' WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.source LIKE 'marketing_campaign:%' GROUP BY SPLIT_PART(appointment.source,':',2)
    ), rows AS (
      SELECT campaign.id,campaign.title,campaign.created_at,campaign.metadata_json->>'audience' audience_name,COALESCE(delivery.audience,0) audience,COALESCE(delivery.sent,0) sent,COALESCE(delivery.delivered,0) delivered,COALESCE(delivery.failed,0) failed,COALESCE(event.opened,0) opened,GREATEST(COALESCE(event.clicked,0),COALESCE(booking.clicks,0)) clicked,COALESCE(appointment.bookings,0) bookings,COALESCE(appointment.completed,0) completed_appointments,COALESCE(sale.revenue_paise,0) revenue_paise,COALESCE(sale.discount_cost_paise,0) discount_cost_paise,COALESCE(sale.revenue_paise,0)-COALESCE(sale.discount_cost_paise,0) net_incremental_revenue_paise,COALESCE(sale.offer_redemptions,0) offer_redemptions,COALESCE(event.opt_outs,0) opt_outs,
        CASE WHEN COALESCE(delivery.audience,0)=0 THEN 0 ELSE COALESCE(appointment.bookings,0)*10000/delivery.audience END conversion_rate_bps,CASE WHEN COALESCE(delivery.audience,0)=0 THEN 0 ELSE COALESCE(appointment.completed,0)*10000/delivery.audience END reactivation_rate_bps,CASE WHEN COALESCE(sale.discount_cost_paise,0)=0 THEN 0 ELSE (COALESCE(sale.revenue_paise,0)-COALESCE(sale.discount_cost_paise,0))*10000/sale.discount_cost_paise END roi_bps,
        COALESCE((SELECT line.item_name FROM appointments a JOIN pos_sales p ON p.tenant_id=a.tenant_id AND p.branch_id=a.branch_id AND p.source='appointment' AND p.reference_id=a.id JOIN pos_sale_lines line ON line.tenant_id=p.tenant_id AND line.branch_id=p.branch_id AND line.sale_id=p.id AND line.line_type='service' WHERE a.tenant_id=$1 AND a.branch_id=$2 AND SPLIT_PART(a.source,':',2)=campaign.id GROUP BY line.item_name ORDER BY SUM(line.line_total_paise) DESC LIMIT 1),'') best_service,
        COALESCE((SELECT channel FROM marketing_campaign_events e WHERE e.tenant_id=$1 AND e.branch_id=$2 AND e.campaign_id=campaign.id AND e.event_type='clicked' GROUP BY channel ORDER BY COUNT(*) DESC LIMIT 1),(campaign.metadata_json->'channels'->>0),campaign.metadata_json->>'channel','') best_channel,COALESCE(TO_CHAR(NULLIF(campaign.metadata_json->>'scheduledAt','')::TIMESTAMPTZ,'HH24:MI'),'') best_time
      FROM campaign LEFT JOIN delivery ON delivery.campaign_id=campaign.id LEFT JOIN event ON event.campaign_id=campaign.id LEFT JOIN booking ON booking.campaign_id=campaign.id LEFT JOIN appointment ON appointment.campaign_id=campaign.id LEFT JOIN sale ON sale.campaign_id=campaign.id
    ) SELECT JSONB_BUILD_OBJECT('campaigns',COALESCE(JSONB_AGG(TO_JSONB(rows) ORDER BY created_at DESC),'[]'::JSONB),'branchPerformance',JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('branchId',$2,'audience',COALESCE(SUM(audience),0),'bookings',COALESCE(SUM(bookings),0),'revenuePaise',COALESCE(SUM(revenue_paise),0),'roiBps',CASE WHEN COALESCE(SUM(discount_cost_paise),0)=0 THEN 0 ELSE (SUM(revenue_paise)-SUM(discount_cost_paise))*10000/SUM(discount_cost_paise) END))) FROM rows"#)
      .bind(tenant_id).bind(branch_id).fetch_one(db).await
}

pub async fn client_intelligence(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    query: &str,
    limit: i64,
) -> Result<Vec<ClientIntelligenceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH appointment_metrics AS (
             SELECT client.id AS client_id,
                    COUNT(appointment.id)::BIGINT AS appointment_count,
                    COUNT(*) FILTER (WHERE appointment.status IN ('completed','billed','paid'))::BIGINT AS completed_visits,
                    COUNT(*) FILTER (WHERE appointment.status='no-show')::BIGINT AS no_show_count,
                    COUNT(*) FILTER (WHERE appointment.status='cancelled')::BIGINT AS cancellation_count,
                    MIN(appointment.start_at) FILTER (WHERE appointment.status IN ('completed','billed','paid')) AS first_visit_at,
                    MAX(appointment.start_at) FILTER (WHERE appointment.status IN ('completed','billed','paid')) AS last_visit_at,
                    MIN(appointment.start_at) FILTER (WHERE appointment.start_at>=NOW() AND appointment.status NOT IN ('completed','billed','paid','cancelled','no-show')) AS upcoming_at
               FROM clients client LEFT JOIN appointments appointment ON appointment.tenant_id=client.tenant_id AND appointment.branch_id=client.branch_id AND appointment.client_id=client.id
              WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.active=TRUE AND client.merged_into_client_id IS NULL GROUP BY client.id
           ), sale_metrics AS (
             SELECT client.id AS client_id,COALESCE(ROUND(AVG(sale.total_paise)),0)::BIGINT AS average_spend_paise,
                    COALESCE(SUM(sale.total_paise),0)::BIGINT AS lifetime_value_paise
               FROM clients client LEFT JOIN pos_sales sale ON sale.tenant_id=client.tenant_id AND sale.branch_id=client.branch_id AND sale.client_id=client.id AND sale.status NOT IN ('draft','cancelled','voided','refunded')
              WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.active=TRUE AND client.merged_into_client_id IS NULL GROUP BY client.id
           ), service_usage AS (
             SELECT sale.client_id,line.item_name AS service_name,SUM(line.quantity)::BIGINT AS uses,MAX(sale.created_at) AS last_used_at
               FROM pos_sales sale JOIN pos_sale_lines line ON line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id
              WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.status NOT IN ('draft','cancelled','voided','refunded') AND line.line_type='service'
              GROUP BY sale.client_id,line.item_name
           ), service_metrics AS (
             SELECT client_id,(ARRAY_AGG(service_name ORDER BY last_used_at DESC,service_name))[1] AS last_service,
                    STRING_AGG(service_name,', ' ORDER BY uses DESC,service_name) AS favourite_services FROM service_usage GROUP BY client_id
           ), campaign_metrics AS (
             SELECT client_id,COUNT(*) FILTER (WHERE status='sent')::BIGINT AS sent_count,
                    COUNT(*) FILTER (WHERE status='sent' AND payload_json ? 'responseAt')::BIGINT AS response_count
               FROM benefit_notification_outbox WHERE tenant_id=$1 AND branch_id=$2 AND source_type='marketing_campaign' GROUP BY client_id
           ), offer_metrics AS (
             SELECT client_id,COUNT(*)::BIGINT AS offer_count FROM client_win_back_offers WHERE tenant_id=$1 AND branch_id=$2 GROUP BY client_id
           ), base AS (
             SELECT client.id AS client_id,CONCAT_WS(' ',client.first_name,client.last_name) AS client_name,appointment.last_visit_at,
                    GREATEST(CURRENT_DATE-COALESCE(appointment.last_visit_at::DATE,client.created_at::DATE),0)::BIGINT AS inactive_days,
                    CASE WHEN appointment.completed_visits>1 THEN EXTRACT(EPOCH FROM (appointment.last_visit_at-appointment.first_visit_at))/86400.0/(appointment.completed_visits-1) ELSE NULL END::DOUBLE PRECISION AS visit_frequency_days,
                    COALESCE(service.last_service,'') AS last_service,COALESCE(service.favourite_services,'') AS favourite_services,
                    sale.average_spend_paise,sale.lifetime_value_paise,
                    CASE WHEN appointment.appointment_count=0 THEN 0 ELSE ROUND(appointment.no_show_count*10000.0/appointment.appointment_count)::INTEGER END AS no_show_rate_bps,
                    CASE WHEN appointment.appointment_count=0 THEN 0 ELSE ROUND(appointment.cancellation_count*10000.0/appointment.appointment_count)::INTEGER END AS cancellation_rate_bps,
                    COALESCE((SELECT COALESCE(NULLIF(staff.appointment_display_name,''),CONCAT_WS(' ',staff.first_name,staff.last_name)) FROM staff WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.id=client.preferred_staff_id),'') AS preferred_staff_name,
                    CASE WHEN client.preferred_communication_channel IN ('whatsapp','sms','email') THEN client.preferred_communication_channel WHEN client.whatsapp_opt_in IS TRUE THEN 'whatsapp' WHEN client.sms_opt_in IS TRUE THEN 'sms' WHEN client.email_opt_in IS TRUE THEN 'email' ELSE '' END AS preferred_channel,
                    CONCAT_WS(', ',CASE WHEN client.whatsapp_opt_in IS TRUE THEN 'WhatsApp' END,CASE WHEN client.sms_opt_in IS TRUE THEN 'SMS' END,CASE WHEN client.email_opt_in IS TRUE THEN 'Email' END) AS consent_status,
                    appointment.upcoming_at AS upcoming_appointment_at,
                    COALESCE((SELECT membership.name FROM client_memberships assigned JOIN memberships membership ON membership.tenant_id=assigned.tenant_id AND membership.branch_id=assigned.branch_id AND membership.id=assigned.membership_id WHERE assigned.tenant_id=$1 AND assigned.branch_id=$2 AND assigned.client_id=client.id AND assigned.active=TRUE AND (assigned.expires_at IS NULL OR assigned.expires_at>=NOW()) ORDER BY assigned.assigned_at DESC LIMIT 1),'No active membership') AS membership_status,
                    (SELECT MIN(assigned.expires_at) FROM client_memberships assigned WHERE assigned.tenant_id=$1 AND assigned.branch_id=$2 AND assigned.client_id=client.id AND assigned.active=TRUE AND assigned.expires_at>=NOW()) AS membership_expires_at,
                    COALESCE((SELECT balance_after FROM membership_reward_ledger reward WHERE reward.tenant_id=$1 AND reward.branch_id=$2 AND reward.client_id=client.id ORDER BY reward.created_at DESC,reward.id DESC LIMIT 1),0)::INTEGER AS loyalty_points,
                    COALESCE(offer.offer_count,0)::BIGINT AS previous_offer_count,COALESCE(campaign.sent_count,0)::BIGINT AS campaign_sent_count,COALESCE(campaign.response_count,0)::BIGINT AS campaign_response_count,
                    appointment.completed_visits,appointment.appointment_count,client.wallet_balance_paise,client.birthday,client.anniversary,
                    EXISTS(SELECT 1 FROM client_package_credits credit WHERE credit.tenant_id=$1 AND credit.branch_id=$2 AND credit.client_id=client.id AND credit.active=TRUE AND credit.remaining_qty>0 AND (credit.expires_at IS NULL OR credit.expires_at>=CURRENT_DATE)) AS has_package_balance,
                    EXISTS(SELECT 1 FROM client_review_links review WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.client_id=client.id AND review.rating<=2 AND COALESCE(review.reviewed_at,review.created_at)>=NOW()-INTERVAL '180 days') AS has_negative_review
               FROM clients client JOIN appointment_metrics appointment ON appointment.client_id=client.id JOIN sale_metrics sale ON sale.client_id=client.id
               LEFT JOIN service_metrics service ON service.client_id=client.id LEFT JOIN campaign_metrics campaign ON campaign.client_id=client.id LEFT JOIN offer_metrics offer ON offer.client_id=client.id
              WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.active=TRUE AND client.merged_into_client_id IS NULL
                AND ($3='' OR LOWER(CONCAT_WS(' ',client.first_name,client.last_name,client.phone,client.email,COALESCE(service.favourite_services,''))) LIKE '%'||LOWER($3)||'%')
           ), scored AS (
             SELECT base.*,LEAST(100,LEAST(60,(inactive_days*60/180)::INTEGER)+LEAST(25,((no_show_rate_bps+cancellation_rate_bps)*25/10000)::INTEGER)+CASE WHEN completed_visits<=1 THEN 15 ELSE 0 END)::INTEGER AS churn_risk_score FROM base
           ), thresholds AS (
             SELECT COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY lifetime_value_paise),0)::BIGINT AS vip_lifetime_value_paise FROM scored WHERE lifetime_value_paise>0
           )
           SELECT client_id,client_name,last_visit_at,inactive_days,visit_frequency_days,last_service,favourite_services,average_spend_paise,lifetime_value_paise,no_show_rate_bps,cancellation_rate_bps,preferred_staff_name,preferred_channel,
                  CASE WHEN consent_status='' THEN 'No marketing consent' ELSE consent_status END AS consent_status,upcoming_appointment_at,membership_status,loyalty_points,previous_offer_count,campaign_sent_count,campaign_response_count,churn_risk_score,
                  CASE WHEN inactive_days>=90 THEN 'Start win-back outreach' WHEN churn_risk_score>=70 THEN 'Start retention outreach' WHEN upcoming_appointment_at IS NULL THEN 'Book next appointment' ELSE 'Maintain relationship' END AS next_best_action,
                  CASE WHEN inactive_days>=90 THEN inactive_days||' inactive days' WHEN churn_risk_score>=70 THEN 'Churn risk score '||churn_risk_score WHEN upcoming_appointment_at IS NULL THEN 'No upcoming appointment' ELSE 'Upcoming appointment is already booked' END AS next_best_action_reason,
                  ARRAY_REMOVE(ARRAY[
                    CASE WHEN inactive_days>=30 THEN 'inactive_30' END,CASE WHEN inactive_days>=60 THEN 'inactive_60' END,CASE WHEN inactive_days>=90 THEN 'inactive_90' END,
                    CASE WHEN visit_frequency_days IS NOT NULL AND inactive_days>=ROUND(visit_frequency_days) AND upcoming_appointment_at IS NULL THEN 'service_due' END,
                    CASE WHEN (last_service ILIKE '%color%' OR last_service ILIKE '%colour%' OR last_service ILIKE '%root%') AND inactive_days>=28 THEN 'hair_colour_due' END,
                    CASE WHEN upcoming_appointment_at IS NULL THEN 'no_upcoming' END,CASE WHEN completed_visits<2 THEN 'new_without_second_visit' END,
                    CASE WHEN lifetime_value_paise>0 AND lifetime_value_paise>=thresholds.vip_lifetime_value_paise THEN 'high_value_vip' END,
                    CASE WHEN inactive_days>=180 THEN 'lost_client' END,CASE WHEN appointment_count>=3 AND no_show_rate_bps+cancellation_rate_bps>=3000 THEN 'frequent_cancellation_no_show' END,
                    CASE WHEN membership_expires_at BETWEEN NOW() AND NOW()+INTERVAL '30 days' THEN 'membership_expiring' END,CASE WHEN has_package_balance THEN 'package_balance_pending' END,
                    CASE WHEN (birthday IS NOT NULL AND ((birthday+MAKE_INTERVAL(years=>EXTRACT(YEAR FROM CURRENT_DATE)::INT-EXTRACT(YEAR FROM birthday)::INT))::DATE BETWEEN CURRENT_DATE AND CURRENT_DATE+30 OR (birthday+MAKE_INTERVAL(years=>EXTRACT(YEAR FROM CURRENT_DATE)::INT-EXTRACT(YEAR FROM birthday)::INT+1))::DATE BETWEEN CURRENT_DATE AND CURRENT_DATE+30)) OR (anniversary IS NOT NULL AND ((anniversary+MAKE_INTERVAL(years=>EXTRACT(YEAR FROM CURRENT_DATE)::INT-EXTRACT(YEAR FROM anniversary)::INT))::DATE BETWEEN CURRENT_DATE AND CURRENT_DATE+30 OR (anniversary+MAKE_INTERVAL(years=>EXTRACT(YEAR FROM CURRENT_DATE)::INT-EXTRACT(YEAR FROM anniversary)::INT+1))::DATE BETWEEN CURRENT_DATE AND CURRENT_DATE+30)) THEN 'birthday_anniversary' END,
                    CASE WHEN loyalty_points>=500 AND MOD(loyalty_points,500)<100 THEN 'loyalty_milestone' END,CASE WHEN has_negative_review THEN 'negative_review_recovery' END,
                    CASE WHEN wallet_balance_paise>0 AND inactive_days>=30 THEN 'wallet_balance_unused' END,
                    CASE WHEN consent_status<>'' AND upcoming_appointment_at IS NULL AND completed_visits>0 THEN 'slow_day_eligible' END
                  ]::TEXT[],NULL) AS segment_keys
             FROM scored CROSS JOIN thresholds ORDER BY churn_risk_score DESC,inactive_days DESC,client_name LIMIT $4"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(query)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn win_back_candidates(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    inactive_days: i32,
    query: &str,
) -> Result<Vec<WinBackCandidate>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH visits AS (
             SELECT client.id,MAX(appointment.start_at) FILTER (WHERE appointment.status IN ('completed','billed','paid')) AS last_visit_at,
                    MIN(appointment.start_at) FILTER (WHERE appointment.status IN ('completed','billed','paid')) AS first_visit_at,
                    COUNT(*) FILTER (WHERE appointment.status IN ('completed','billed','paid'))::BIGINT AS visit_count,
                    COUNT(*) FILTER (WHERE appointment.status='no-show')::BIGINT AS no_show_count,
                    COUNT(*) FILTER (WHERE appointment.status='cancelled')::BIGINT AS cancelled_count
               FROM clients client LEFT JOIN appointments appointment ON appointment.tenant_id=client.tenant_id AND appointment.branch_id=client.branch_id AND appointment.client_id=client.id
              WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.active=TRUE AND client.merged_into_client_id IS NULL GROUP BY client.id
           ), last_service AS (
             SELECT DISTINCT ON (sale.client_id) sale.client_id,line.item_name AS service_name
               FROM pos_sales sale JOIN pos_sale_lines line ON line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id
              WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.status NOT IN ('draft','cancelled','voided','refunded') AND line.line_type='service'
              ORDER BY sale.client_id,sale.created_at DESC,line.id
           )
           SELECT client.id AS client_id,CONCAT_WS(' ',client.first_name,client.last_name) AS client_name,visits.last_visit_at,
                  GREATEST(CURRENT_DATE-COALESCE(visits.last_visit_at::DATE,client.created_at::DATE),0)::BIGINT AS inactive_days,
                  COALESCE(last_service.service_name,'') AS last_service,
                  CASE WHEN visits.visit_count>1 THEN EXTRACT(EPOCH FROM (visits.last_visit_at-visits.first_visit_at))/86400.0/(visits.visit_count-1) ELSE NULL END::DOUBLE PRECISION AS visit_frequency_days,
                  CASE WHEN visits.no_show_count>0 THEN 'Previous no-show may have interrupted the visit cycle'
                       WHEN visits.cancelled_count>0 THEN 'Previous cancellation was not rebooked'
                       WHEN visits.visit_count<=1 THEN 'No established repeat-visit pattern yet'
                       ELSE 'Client is overdue compared with their saved visit pattern' END AS ai_reason,
                  CASE WHEN COALESCE(last_service.service_name,'')='' THEN 'Priority return appointment'
                       ELSE 'Priority '||last_service.service_name||' rebooking' END AS recommended_offer,
                  CASE WHEN visits.visit_count<=1 THEN 'Avoid a high discount before preferences are known'
                       ELSE 'Avoid unrelated services not present in client history' END AS avoid_offer,
                  CASE WHEN client.preferred_communication_channel IN ('whatsapp','sms','email') THEN client.preferred_communication_channel
                       WHEN client.whatsapp_opt_in IS TRUE THEN 'whatsapp' WHEN client.sms_opt_in IS TRUE THEN 'sms'
                       WHEN client.email_opt_in IS TRUE THEN 'email' ELSE '' END AS preferred_channel,
                  (client.whatsapp_opt_in IS TRUE OR client.sms_opt_in IS TRUE OR client.email_opt_in IS TRUE) AS consented
             FROM clients client JOIN visits ON visits.id=client.id LEFT JOIN last_service ON last_service.client_id=client.id
            WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.active=TRUE AND client.merged_into_client_id IS NULL
              AND GREATEST(CURRENT_DATE-COALESCE(visits.last_visit_at::DATE,client.created_at::DATE),0)>=$3
              AND NOT EXISTS (SELECT 1 FROM appointments upcoming WHERE upcoming.tenant_id=$1 AND upcoming.branch_id=$2 AND upcoming.client_id=client.id AND upcoming.start_at>=NOW() AND upcoming.status NOT IN ('cancelled','no-show','completed','billed','paid'))
              AND ($4='' OR LOWER(CONCAT_WS(' ',client.first_name,client.last_name,client.phone,client.email,COALESCE(last_service.service_name,''))) LIKE '%'||LOWER($4)||'%')
            ORDER BY inactive_days DESC,client_name LIMIT 200"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(inactive_days)
    .bind(query)
    .fetch_all(db)
    .await
}

pub async fn win_back_results(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<WinBackResults, sqlx::Error> {
    sqlx::query_as(
        r#"WITH sent AS (
             SELECT client_id,MIN(created_at) AS sent_at FROM benefit_notification_outbox
              WHERE tenant_id=$1 AND branch_id=$2 AND source_type='marketing_campaign' AND status='sent' AND created_at>=NOW()-INTERVAL '30 days'
              GROUP BY client_id
           ), booked AS (
             SELECT DISTINCT appointment.id,appointment.client_id,appointment.created_at FROM appointments appointment JOIN sent ON sent.client_id=appointment.client_id
              WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.created_at>=sent.sent_at AND appointment.status NOT IN ('cancelled','no-show')
           ), revenue AS (
             SELECT DISTINCT sale.id,sale.total_paise FROM pos_sales sale JOIN sent ON sent.client_id=sale.client_id
              WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.created_at>=sent.sent_at AND sale.status NOT IN ('draft','cancelled','voided','refunded')
           )
           SELECT (SELECT COUNT(*) FROM benefit_notification_outbox WHERE tenant_id=$1 AND branch_id=$2 AND source_type='marketing_campaign' AND status='sent' AND created_at>=NOW()-INTERVAL '30 days')::BIGINT AS sent,
                  (SELECT COUNT(*) FROM booked)::BIGINT AS booked,
                  COALESCE((SELECT SUM(total_paise) FROM revenue),0)::BIGINT AS revenue_paise,
                  (SELECT COUNT(*) FROM client_consent_events event JOIN sent ON sent.client_id=event.client_id WHERE event.tenant_id=$1 AND event.branch_id=$2 AND event.opted_in=FALSE AND event.recorded_at>=sent.sent_at)::BIGINT AS opt_outs"#,
    ).bind(tenant_id).bind(branch_id).fetch_one(db).await
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    stage: &str,
    owner_user_id: &str,
    query: &str,
    page: i64,
    page_size: i64,
) -> Result<Vec<MarketingLeadRecord>, sqlx::Error> {
    let offset = (page.saturating_sub(1)).saturating_mul(page_size);
    let sql = format!(
        "SELECT {LEAD_COLUMNS} FROM marketing_leads WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR stage=$3) AND ($4='' OR owner_user_id=$4) AND ($5='' OR LOWER(CONCAT_WS(' ',first_name,last_name,phone,email,source)) LIKE '%'||LOWER($5)||'%') ORDER BY CASE WHEN next_follow_up_date IS NULL THEN 1 ELSE 0 END,next_follow_up_date,updated_at DESC LIMIT $6 OFFSET $7"
    );
    sqlx::query_as::<_, MarketingLeadRecord>(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(stage)
        .bind(owner_user_id)
        .bind(query)
        .bind(page_size)
        .bind(offset)
        .fetch_all(db)
        .await
}

pub async fn lead_advice(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"WITH activity AS (
             SELECT lead_id,MAX(created_at) last_activity_at,COUNT(*)::INTEGER activity_count
               FROM marketing_lead_activities WHERE tenant_id=$1 AND branch_id=$2 GROUP BY lead_id
           )
           SELECT JSONB_BUILD_OBJECT(
             'leadId',lead.id,'leadName',CONCAT_WS(' ',lead.first_name,lead.last_name),'stage',lead.stage,
             'priorityScore',LEAST(100,lead.score+CASE WHEN lead.qualification_status='qualified' THEN 20 ELSE 0 END+CASE WHEN lead.next_follow_up_date<CURRENT_DATE THEN 20 WHEN lead.next_follow_up_date=CURRENT_DATE THEN 15 ELSE 0 END+CASE WHEN activity.last_activity_at IS NULL OR activity.last_activity_at<NOW()-INTERVAL '7 days' THEN 10 ELSE 0 END),
             'reason',CONCAT_WS(' · ',CASE WHEN lead.qualification_status='qualified' THEN 'Qualified lead' END,CASE WHEN lead.next_follow_up_date<CURRENT_DATE THEN 'Follow-up overdue' WHEN lead.next_follow_up_date=CURRENT_DATE THEN 'Follow-up due today' END,CASE WHEN activity.last_activity_at IS NULL THEN 'No activity recorded' WHEN activity.last_activity_at<NOW()-INTERVAL '7 days' THEN 'No recent activity' END,'Lead score '||lead.score),
             'bestChannel',CASE WHEN lead.phone<>'' THEN 'phone' WHEN lead.email<>'' THEN 'email' ELSE 'manual' END,
             'suggestedMessage','Hi '||lead.first_name||', following up on your enquiry. Please reply with a convenient time to discuss your appointment.',
             'nextFollowUpDate',(CURRENT_DATE+CASE WHEN lead.score>=70 OR lead.qualification_status='qualified' THEN 1 WHEN lead.score>=40 THEN 3 ELSE 7 END)::TEXT,
             'clientId',COALESCE(lead.client_id,''),'appointmentId',COALESCE(lead.converted_appointment_id,''),'activityCount',COALESCE(activity.activity_count,0),
             'source','crm_lead_priority_policy_v1')
             FROM marketing_leads lead LEFT JOIN activity ON activity.lead_id=lead.id
            WHERE lead.tenant_id=$1 AND lead.branch_id=$2 AND lead.stage NOT IN ('converted','lost')
            ORDER BY LEAST(100,lead.score+CASE WHEN lead.qualification_status='qualified' THEN 20 ELSE 0 END+CASE WHEN lead.next_follow_up_date<=CURRENT_DATE THEN 20 ELSE 0 END) DESC,lead.updated_at LIMIT 200"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn owners(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<MarketingLeadOwner>, sqlx::Error> {
    sqlx::query_as::<_, MarketingLeadOwner>(
        "SELECT id,full_name AS name,role_name FROM users WHERE tenant_id=$1 AND active=TRUE AND (branch_id IS NULL OR branch_id=$2) ORDER BY full_name,id",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn owner_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    owner_user_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND tenant_id=$2 AND active=TRUE AND (branch_id IS NULL OR branch_id=$3))",
    )
    .bind(owner_user_id)
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(db)
    .await
}

pub async fn create(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    created_by: &str,
    first_name: &str,
    last_name: &str,
    phone: &str,
    email: &str,
    source: &str,
    stage: &str,
    qualification_status: &str,
    score: i32,
    owner_user_id: &str,
    next_follow_up_date: Option<NaiveDate>,
    notes: &str,
    client_id: Option<&str>,
) -> Result<MarketingLeadRecord, sqlx::Error> {
    let sql = format!("INSERT INTO marketing_leads(tenant_id,branch_id,client_id,first_name,last_name,phone,email,source,stage,qualification_status,score,owner_user_id,next_follow_up_date,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING {LEAD_COLUMNS}");
    sqlx::query_as::<_, MarketingLeadRecord>(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .bind(first_name)
        .bind(last_name)
        .bind(phone)
        .bind(email)
        .bind(source)
        .bind(stage)
        .bind(qualification_status)
        .bind(score)
        .bind(owner_user_id)
        .bind(next_follow_up_date)
        .bind(notes)
        .bind(created_by)
        .fetch_one(db)
        .await
}

pub async fn client_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM clients WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND active=TRUE)")
        .bind(client_id).bind(tenant_id).bind(branch_id).fetch_one(db).await
}

pub async fn appointment_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    appointment_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM appointments WHERE id=$1 AND tenant_id=$2 AND branch_id=$3)",
    )
    .bind(appointment_id)
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(db)
    .await
}

pub async fn update(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    stage: Option<&str>,
    qualification_status: Option<&str>,
    score: Option<i32>,
    owner_user_id: Option<&str>,
    next_follow_up_date: Option<NaiveDate>,
    notes: Option<&str>,
) -> Result<Option<MarketingLeadRecord>, sqlx::Error> {
    let sql = format!("UPDATE marketing_leads SET stage=COALESCE($4,stage),qualification_status=COALESCE($5,qualification_status),score=COALESCE($6,score),owner_user_id=COALESCE($7,owner_user_id),next_follow_up_date=COALESCE($8,next_follow_up_date),notes=COALESCE($9,notes),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING {LEAD_COLUMNS}");
    sqlx::query_as::<_, MarketingLeadRecord>(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(id)
        .bind(stage)
        .bind(qualification_status)
        .bind(score)
        .bind(owner_user_id)
        .bind(next_follow_up_date)
        .bind(notes)
        .fetch_optional(db)
        .await
}

pub async fn activities(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    lead_id: &str,
) -> Result<Vec<MarketingLeadActivity>, sqlx::Error> {
    sqlx::query_as::<_, MarketingLeadActivity>(
        "SELECT id,lead_id,activity_type,body,next_follow_up_date,created_by,created_at FROM marketing_lead_activities WHERE tenant_id=$1 AND branch_id=$2 AND lead_id=$3 ORDER BY created_at DESC LIMIT 200",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(lead_id)
    .fetch_all(db)
    .await
}

pub async fn add_activity(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    lead_id: &str,
    created_by: &str,
    activity_type: &str,
    body: &str,
    next_follow_up_date: Option<NaiveDate>,
) -> Result<Option<MarketingLeadActivity>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM marketing_leads WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(lead_id)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        return Ok(None);
    }
    let activity = sqlx::query_as::<_, MarketingLeadActivity>(
        "INSERT INTO marketing_lead_activities(tenant_id,branch_id,lead_id,activity_type,body,next_follow_up_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,lead_id,activity_type,body,next_follow_up_date,created_by,created_at",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(lead_id)
    .bind(activity_type)
    .bind(body)
    .bind(next_follow_up_date)
    .bind(created_by)
    .fetch_one(&mut *tx)
    .await?;
    if next_follow_up_date.is_some() {
        sqlx::query("UPDATE marketing_leads SET next_follow_up_date=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(tenant_id).bind(branch_id).bind(lead_id).bind(next_follow_up_date)
            .execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE marketing_leads SET updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(tenant_id).bind(branch_id).bind(lead_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Some(activity))
}

pub async fn convert(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    lead_id: &str,
    created_by: &str,
    client_id: Option<&str>,
    appointment_id: Option<&str>,
) -> Result<Option<MarketingLeadRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let sql = format!("UPDATE marketing_leads SET stage='converted',qualification_status='qualified',client_id=COALESCE($4,client_id),converted_appointment_id=COALESCE($5,converted_appointment_id),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING {LEAD_COLUMNS}");
    let lead = sqlx::query_as::<_, MarketingLeadRecord>(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(lead_id)
        .bind(client_id)
        .bind(appointment_id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some(lead) = lead else {
        return Ok(None);
    };
    sqlx::query("INSERT INTO marketing_lead_activities(tenant_id,branch_id,lead_id,activity_type,body,created_by) VALUES($1,$2,$3,'conversion',$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(lead_id).bind("Lead converted to an appointment or client").bind(created_by)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Some(lead))
}
