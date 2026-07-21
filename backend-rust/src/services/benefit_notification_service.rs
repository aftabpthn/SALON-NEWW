use chrono::Utc;
use serde_json::json;
use std::collections::{HashMap, HashSet};

use crate::{
    models::common::AppError,
    repositories::{
        benefit_notification_repository::{self, NewBenefitDelivery},
        birthday_anniversary_repository, clients_repository, marketing_leads_repository,
    },
    services::{
        birthday_anniversary_service, client_service, invoice_delivery, package_service,
        sms_center_service,
    },
    state::{AppState, AppointmentEvent},
};

pub async fn schedule(state: &AppState) -> Result<usize, AppError> {
    if !state.settings.benefit_delivery_configured() {
        return Ok(0);
    }
    let scopes = benefit_notification_repository::scopes(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load benefit reminder scopes"))?;
    for (tenant_id, branch_id) in &scopes {
        benefit_notification_repository::ensure_marketing_governance(
            &state.db, tenant_id, branch_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to initialize marketing governance"))?;
        marketing_leads_repository::ensure_automation_rules(&state.db, tenant_id, branch_id)
            .await
            .map_err(|_| AppError::internal("failed to initialize marketing automation rules"))?;
    }
    let mut queued = 0usize;
    queued += schedule_marketing_campaigns(state).await?;
    queued += sms_center_service::schedule_due(&state.db).await?;
    queued += schedule_appointment_reminders(state).await?;
    queued += schedule_review_requests(state).await?;
    for (tenant_id, branch_id) in scopes {
        let active_triggers = marketing_leads_repository::active_automation_triggers(
            &state.db, &tenant_id, &branch_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to load active marketing automations"))?
        .into_iter()
        .collect::<HashSet<_>>();
        let automation_controls = marketing_leads_repository::active_automation_controls(
            &state.db, &tenant_id, &branch_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to load marketing automation controls"))?
        .into_iter()
        .collect::<HashMap<_, _>>();
        let birthday_settings =
            birthday_anniversary_repository::get_settings(&state.db, &tenant_id, &branch_id)
                .await
                .map_err(|_| AppError::internal("failed to load birthday automation mode"))?;
        let allow_legacy_occasions = legacy_occasion_automation_allowed(
            birthday_settings
                .as_ref()
                .map(|row| row.workflow_mode.as_str()),
        );
        if !allow_legacy_occasions && active_triggers.contains("occasion_campaign") {
            queued += birthday_anniversary_service::run_auto_send(
                state, &tenant_id, &branch_id, "system", 250,
            )
            .await?
            .queued;
        }
        let reminders = if active_triggers.contains("membership_renewal") {
            benefit_notification_repository::approved_membership_reminders(
                &state.db, &tenant_id, &branch_id,
            )
            .await
            .map_err(|_| AppError::internal("failed to load approved membership reminders"))?
        } else {
            Vec::new()
        };
        for (id, client_id, phone, email, message, client_name) in reminders {
            queued += enqueue_channels(
                state,
                &tenant_id,
                &branch_id,
                "membership_reminder",
                &id,
                &client_id,
                &phone,
                &email,
                &message,
                &client_name,
                None,
            )
            .await?;
        }
        for alert in if active_triggers.contains("membership_renewal") {
            package_service::alerts(&state.db, &tenant_id, &branch_id).await?
        } else {
            Vec::new()
        } {
            let message = format!(
                "{}: {} - {} ({} pending)",
                alert.package_name, alert.service_name, alert.alert_type, alert.pending_qty
            );
            let source_id = format!("{}:{}", alert.id, alert.alert_type);
            queued += enqueue_channels(
                state,
                &tenant_id,
                &branch_id,
                "package_alert",
                &source_id,
                &alert.client_id,
                &alert.phone,
                &alert.email,
                &message,
                &alert.client_name,
                None,
            )
            .await?;
        }
        for candidate in
            clients_repository::automation_candidates(&state.db, &tenant_id, &branch_id)
                .await
                .map_err(|_| AppError::internal("failed to load client automation candidates"))?
        {
            if !active_triggers.contains(&candidate.source_type) {
                continue;
            }
            let control = automation_controls.get(&candidate.source_type);
            let frequency_days = control
                .and_then(|value| value.get("frequencyCapDays"))
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0);
            if marketing_leads_repository::automation_frequency_reached(
                &state.db,
                &tenant_id,
                &branch_id,
                &candidate.client_id,
                &candidate.source_type,
                frequency_days,
            )
            .await
            .map_err(|_| AppError::internal("failed to enforce automation frequency cap"))?
            {
                continue;
            }
            let allowed_channels = control
                .and_then(|value| value.get("channels"))
                .and_then(serde_json::Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(serde_json::Value::as_str)
                        .map(str::to_string)
                        .collect::<HashSet<_>>()
                });
            if candidate.source_type == "occasion_campaign" && !allow_legacy_occasions {
                continue;
            }
            let added = enqueue_channels(
                state,
                &candidate.tenant_id,
                &candidate.branch_id,
                &candidate.source_type,
                &candidate.source_id,
                &candidate.client_id,
                &candidate.phone,
                &candidate.email,
                &candidate.message,
                &candidate.client_name,
                allowed_channels.as_ref(),
            )
            .await?;
            queued += added;
            if added > 0 {
                let _ = state.appointment_events.send(AppointmentEvent {
                    tenant_id: candidate.tenant_id,
                    branch_id: candidate.branch_id,
                    client_id: candidate.client_id,
                    entity_type: "automation".to_string(),
                    entity_id: candidate.source_id,
                    action: format!("{}.queued", candidate.source_type),
                });
            }
        }
    }
    Ok(queued)
}

fn legacy_occasion_automation_allowed(workflow_mode: Option<&str>) -> bool {
    workflow_mode != Some("managed")
}

async fn schedule_marketing_campaigns(state: &AppState) -> Result<usize, AppError> {
    let campaigns = benefit_notification_repository::due_marketing_campaigns(&state.db, 25)
        .await
        .map_err(|_| AppError::internal("failed to load scheduled marketing campaigns"))?;
    let mut queued = 0usize;
    for campaign in campaigns {
        let channels = campaign
            .metadata_json
            .get("channels")
            .and_then(serde_json::Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|| {
                campaign
                    .metadata_json
                    .get("channel")
                    .and_then(serde_json::Value::as_str)
                    .map(|channel| vec![channel])
                    .unwrap_or_default()
            });
        let delivery_mode = campaign
            .metadata_json
            .get("deliveryMode")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("or");
        let sms_fallback = campaign
            .metadata_json
            .get("smsFallback")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let segment_ids = if matches!(campaign.audience.as_str(), "all" | "active" | "at-risk")
            || campaign.audience.starts_with("win-back-")
        {
            None
        } else {
            Some(
                marketing_leads_repository::client_intelligence(
                    &state.db,
                    &campaign.tenant_id,
                    &campaign.branch_id,
                    "",
                    500,
                )
                .await
                .map_err(|_| AppError::internal("failed to load campaign segment"))?
                .into_iter()
                .filter(|client| {
                    client
                        .segment_keys
                        .iter()
                        .any(|key| key == &campaign.audience)
                })
                .map(|client| client.client_id)
                .collect::<HashSet<_>>(),
            )
        };
        let mut campaign_queued = 0usize;
        let mut selected_clients = HashSet::new();
        for channel in channels {
            let recipients = benefit_notification_repository::marketing_recipients(
                &state.db, &campaign, channel,
            )
            .await
            .map_err(|_| AppError::internal("failed to load campaign recipients"))?;
            for recipient in recipients {
                if segment_ids
                    .as_ref()
                    .is_some_and(|ids| !ids.contains(&recipient.client_id))
                    || (delivery_mode == "or" && selected_clients.contains(&recipient.client_id))
                {
                    continue;
                }
                let source_id = format!("{}:{}", campaign.id, recipient.client_id);
                let origin = state
                    .settings
                    .cors_allowed_origins
                    .first()
                    .map(String::as_str)
                    .unwrap_or("http://localhost:4200")
                    .trim_end_matches('/');
                let campaign_reference =
                    format!("marketing_campaign:{}:{}", campaign.id, recipient.client_id);
                let booking_link = format!(
                    "{origin}/book/{}?source={campaign_reference}",
                    campaign.tenant_slug
                );
                let message = if campaign.body.contains("{{booking_link}}") {
                    campaign.body.replace("{{booking_link}}", &booking_link)
                } else {
                    format!("{} {}", campaign.body, booking_link)
                };
                let payload = json!({"campaignId":campaign.id,"campaignReference":campaign_reference,"channel":channel,"recipient":recipient.recipient,"message":message,"bookingLink":booking_link,"subject":campaign.title,"clientName":recipient.client_name,"templateKind":"benefit","smsFallback":sms_fallback && channel == "whatsapp"});
                campaign_queued += benefit_notification_repository::enqueue(
                    &state.db,
                    NewBenefitDelivery {
                        tenant_id: &campaign.tenant_id,
                        branch_id: &campaign.branch_id,
                        source_type: "marketing_campaign",
                        source_id: &source_id,
                        client_id: &recipient.client_id,
                        channel,
                        recipient: payload["recipient"].as_str().unwrap_or_default(),
                        payload: &payload,
                    },
                )
                .await
                .map_err(|_| AppError::internal("failed to queue campaign delivery"))?
                    as usize;
                selected_clients.insert(recipient.client_id);
            }
        }
        benefit_notification_repository::mark_campaign_queued(
            &state.db,
            &campaign,
            selected_clients.len(),
        )
        .await
        .map_err(|_| AppError::internal("failed to update campaign status"))?;
        queued += campaign_queued;
        benefit_notification_repository::schedule_campaign_recurrence(&state.db, &campaign)
            .await
            .map_err(|_| AppError::internal("failed to schedule campaign recurrence"))?;
    }
    Ok(queued)
}

pub async fn queue_appointment_event(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    appointment_id: &str,
    client_id: &str,
    version: i32,
    event: &str,
) -> Result<usize, AppError> {
    let event = event.trim().to_ascii_uppercase();
    marketing_leads_repository::ensure_automation_rules(&state.db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to initialize appointment automation rules"))?;
    let trigger = if matches!(event.as_str(), "BOOKED" | "CONFIRMED") {
        "appointment_confirmation"
    } else if event == "WAITLIST_OFFER" {
        "last_minute_empty_slot"
    } else {
        "reschedule_cancellation"
    };
    if !marketing_leads_repository::active_automation_triggers(&state.db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load appointment automation rules"))?
        .iter()
        .any(|item| item == trigger)
    {
        return Ok(0);
    }
    let event_label = match event.as_str() {
        "BOOKED" | "CONFIRMED" => "confirmed",
        "RESCHEDULED" | "BOOKING_RESCHEDULED" | "RESCHEDULE_APPROVED" => "rescheduled",
        "CANCELLED" => "cancelled",
        "WAITLIST_OFFER" => "available from the waitlist. Confirm it within 10 minutes",
        _ => return Ok(0),
    };
    let settings = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT settings_json FROM appointment_branch_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load appointment notification settings"))?
    .unwrap_or_else(|| serde_json::json!({}));
    if !settings
        .get("rescheduleSmsAppNotification")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true)
        && matches!(
            event.as_str(),
            "RESCHEDULED" | "BOOKING_RESCHEDULED" | "RESCHEDULE_APPROVED"
        )
    {
        return Ok(0);
    }
    let row = sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),'Client'),COALESCE(client.phone,''),COALESCE(client.email,''),TO_CHAR(appointment.start_at,'DD/MM/YYYY HH24:MI') FROM appointments appointment JOIN clients client ON client.id=appointment.client_id AND client.tenant_id=appointment.tenant_id AND client.branch_id=appointment.branch_id WHERE appointment.id=$1 AND appointment.tenant_id=$2 AND appointment.branch_id=$3 AND appointment.client_id=$4 AND client.active=TRUE AND client.merged_into_client_id IS NULL",
    )
    .bind(appointment_id)
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load appointment notification recipient"))?;
    let Some((client_name, phone, email, start_at)) = row else {
        return Ok(0);
    };
    enqueue_channels(
        state,
        tenant_id,
        branch_id,
        "appointment_notification",
        &format!(
            "{}:{}:{}",
            appointment_id,
            event.to_ascii_lowercase(),
            version
        ),
        client_id,
        &phone,
        &email,
        &format!("Your appointment is {event_label}. {start_at}"),
        &client_name,
        None,
    )
    .await
}

async fn schedule_appointment_reminders(state: &AppState) -> Result<usize, AppError> {
    let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String, String)>(
        "SELECT appointment.tenant_id,appointment.branch_id,appointment.id,appointment.client_id,COALESCE(client.phone,''),COALESCE(client.email,''),COALESCE(NULLIF(TRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),'Client'),TO_CHAR(appointment.start_at,'DD/MM/YYYY HH24:MI') FROM appointments appointment JOIN clients client ON client.id=appointment.client_id AND client.tenant_id=appointment.tenant_id AND client.branch_id=appointment.branch_id WHERE appointment.status IN ('booked','confirmed','rescheduled') AND appointment.start_at>=NOW()+INTERVAL '23 hours' AND appointment.start_at<NOW()+INTERVAL '25 hours' AND client.active=TRUE AND client.merged_into_client_id IS NULL AND EXISTS(SELECT 1 FROM whatsapp_automation_rules rule WHERE rule.tenant_id=appointment.tenant_id AND rule.branch_id=appointment.branch_id AND rule.trigger_event='appointment_reminder' AND rule.status='active')",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load appointment reminders"))?;
    let mut queued = 0;
    for (tenant_id, branch_id, appointment_id, client_id, phone, email, client_name, start_at) in
        rows
    {
        queued += enqueue_channels(
            state,
            &tenant_id,
            &branch_id,
            "appointment_reminder",
            &format!("{}:{}", appointment_id, Utc::now().date_naive()),
            &client_id,
            &phone,
            &email,
            &format!("Reminder: your appointment is scheduled for {start_at}."),
            &client_name,
            None,
        )
        .await?;
    }
    Ok(queued)
}

async fn schedule_review_requests(state: &AppState) -> Result<usize, AppError> {
    let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String)>(
        "SELECT appointment.tenant_id,appointment.branch_id,appointment.id,appointment.client_id,COALESCE(client.phone,''),COALESCE(client.email,''),COALESCE(NULLIF(TRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),'Client') FROM appointments appointment JOIN clients client ON client.id=appointment.client_id AND client.tenant_id=appointment.tenant_id AND client.branch_id=appointment.branch_id WHERE appointment.status IN ('completed','billed','paid') AND appointment.updated_at>=NOW()-INTERVAL '30 days' AND appointment.updated_at<NOW()-INTERVAL '30 minutes' AND client.active=TRUE AND client.merged_into_client_id IS NULL AND NOT EXISTS (SELECT 1 FROM customer_booking_reviews review WHERE review.tenant_id=appointment.tenant_id AND review.branch_id=appointment.branch_id AND review.appointment_id=appointment.id) AND EXISTS(SELECT 1 FROM whatsapp_automation_rules rule WHERE rule.tenant_id=appointment.tenant_id AND rule.branch_id=appointment.branch_id AND rule.trigger_event='review_request' AND rule.status='active')",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load completed visits for review requests"))?;

    let mut queued = 0usize;
    for (tenant_id, branch_id, appointment_id, client_id, phone, email, client_name) in rows {
        queued += enqueue_channels(
            state,
            &tenant_id,
            &branch_id,
            "review_request",
            &appointment_id,
            &client_id,
            &phone,
            &email,
            "Thank you for visiting us. Please share your verified experience from My Bookings.",
            &client_name,
            None,
        )
        .await?;
    }
    Ok(queued)
}

async fn enqueue_channels(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    source_type: &str,
    source_id: &str,
    client_id: &str,
    phone: &str,
    email: &str,
    message: &str,
    client_name: &str,
    allowed_channels: Option<&HashSet<String>>,
) -> Result<usize, AppError> {
    let mut queued = 0usize;
    if allowed_channels.map_or(true, |channels| channels.contains("whatsapp"))
        && state.settings.whatsapp_benefit_enabled()
        && !phone.trim().is_empty()
        && client_service::communication_allowed(
            &state.db, tenant_id, branch_id, client_id, "whatsapp",
        )
        .await
        .map_err(|_| AppError::internal("failed to verify WhatsApp consent"))?
    {
        let payload = json!({"channel":"whatsapp","recipient":phone,"message":message,"clientName":client_name,"templateKind":"benefit"});
        queued += benefit_notification_repository::enqueue(
            &state.db,
            NewBenefitDelivery {
                tenant_id,
                branch_id,
                source_type,
                source_id,
                client_id,
                channel: "whatsapp",
                recipient: phone,
                payload: &payload,
            },
        )
        .await
        .map_err(|_| AppError::internal("failed to queue WhatsApp benefit reminder"))?
            as usize;
    }
    if allowed_channels.map_or(true, |channels| channels.contains("sms"))
        && state.settings.invoice_delivery_webhook_url.is_some()
        && !phone.trim().is_empty()
        && client_service::communication_allowed(&state.db, tenant_id, branch_id, client_id, "sms")
            .await
            .map_err(|_| AppError::internal("failed to verify SMS consent"))?
    {
        let payload = json!({"channel":"sms","recipient":phone,"message":message,"clientName":client_name,"subject":notification_subject(source_type),"templateKind":"benefit"});
        queued += benefit_notification_repository::enqueue(
            &state.db,
            NewBenefitDelivery {
                tenant_id,
                branch_id,
                source_type,
                source_id,
                client_id,
                channel: "sms",
                recipient: phone,
                payload: &payload,
            },
        )
        .await
        .map_err(|_| AppError::internal("failed to queue SMS benefit reminder"))?
            as usize;
    }
    if allowed_channels.map_or(true, |channels| channels.contains("email"))
        && state.settings.invoice_delivery_webhook_url.is_some()
        && !email.trim().is_empty()
        && client_service::communication_allowed(
            &state.db, tenant_id, branch_id, client_id, "email",
        )
        .await
        .map_err(|_| AppError::internal("failed to verify email consent"))?
    {
        let payload = json!({"channel":"email","recipient":email,"message":message,"clientName":client_name,"subject":notification_subject(source_type)});
        queued += benefit_notification_repository::enqueue(
            &state.db,
            NewBenefitDelivery {
                tenant_id,
                branch_id,
                source_type,
                source_id,
                client_id,
                channel: "email",
                recipient: email,
                payload: &payload,
            },
        )
        .await
        .map_err(|_| AppError::internal("failed to queue email benefit reminder"))?
            as usize;
    }
    Ok(queued)
}

fn notification_subject(source_type: &str) -> &'static str {
    match source_type {
        "appointment_notification" | "appointment_reminder" => "Appointment update",
        "wallet_reminder" => "Wallet balance update",
        "membership_reminder" | "membership_renewal" => "Membership renewal",
        "package_alert" => "Package update",
        "review_request" => "How was your visit?",
        "review_recovery" => "Client follow-up",
        _ => "Client update",
    }
}

pub async fn process_due(state: &AppState) -> Result<usize, AppError> {
    let rows = benefit_notification_repository::claim_due(&state.db, 50)
        .await
        .map_err(|_| AppError::internal("failed to claim benefit reminders"))?;
    let mut sent = 0usize;
    for row in rows {
        let allowed = if let Some(client_id) = row.client_id.as_deref() {
            client_service::communication_allowed(
                &state.db,
                &row.tenant_id,
                &row.branch_id,
                client_id,
                &row.channel,
            )
            .await
            .map_err(|_| AppError::internal("failed to recheck client consent"))?
        } else if row.source_type == "sms_center_staff" {
            sms_center_service::staff_delivery_allowed(&state.db, &row).await?
        } else {
            false
        };
        if !allowed {
            benefit_notification_repository::mark_blocked(&state.db, &row.id)
                .await
                .map_err(|_| AppError::internal("failed to block benefit reminder"))?;
            refresh_occasion_delivery(state, &row).await?;
            continue;
        }
        match invoice_delivery::deliver(&state.settings, &row.payload_json).await {
            Ok(provider_id) => {
                benefit_notification_repository::mark_sent(&state.db, &row, &provider_id)
                    .await
                    .map_err(|_| AppError::internal("failed to complete benefit reminder"))?;
                sent += 1;
            }
            Err(error) => {
                benefit_notification_repository::mark_failed(
                    &state.db,
                    &row,
                    &format!("{error:?}"),
                )
                .await
                .map_err(|_| AppError::internal("failed to reschedule benefit reminder"))?;
                if row.channel == "whatsapp"
                    && row.attempts >= row.max_attempts
                    && row
                        .payload_json
                        .get("smsFallback")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false)
                {
                    let mut payload = row.payload_json.clone();
                    payload["channel"] = json!("sms");
                    payload["smsFallback"] = json!(false);
                    let fallback_source_id = format!("{}:sms-fallback", row.source_id);
                    benefit_notification_repository::enqueue(
                        &state.db,
                        NewBenefitDelivery {
                            tenant_id: &row.tenant_id,
                            branch_id: &row.branch_id,
                            source_type: &row.source_type,
                            source_id: &fallback_source_id,
                            client_id: row.client_id.as_deref().unwrap_or_default(),
                            channel: "sms",
                            recipient: payload["recipient"].as_str().unwrap_or_default(),
                            payload: &payload,
                        },
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to queue SMS fallback"))?;
                }
            }
        }
        refresh_occasion_delivery(state, &row).await?;
    }
    benefit_notification_repository::refresh_marketing_campaign_statuses(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to refresh campaign delivery status"))?;
    sms_center_service::refresh_campaign_statuses(&state.db).await?;
    Ok(sent)
}

async fn refresh_occasion_delivery(
    state: &AppState,
    row: &benefit_notification_repository::BenefitDeliveryRecord,
) -> Result<(), AppError> {
    if row.source_type != "occasion_campaign" {
        return Ok(());
    }
    birthday_anniversary_repository::refresh_delivery_state(
        &state.db,
        &row.tenant_id,
        &row.branch_id,
        &row.source_id,
        "delivery-worker",
    )
    .await
    .map_err(|_| AppError::internal("failed to refresh birthday reminder delivery"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{legacy_occasion_automation_allowed, notification_subject};

    #[test]
    fn managed_mode_disables_legacy_occasion_automation() {
        assert!(legacy_occasion_automation_allowed(None));
        assert!(legacy_occasion_automation_allowed(Some("legacy_auto")));
        assert!(!legacy_occasion_automation_allowed(Some("managed")));
    }

    #[test]
    fn appointment_delivery_uses_an_appointment_subject() {
        assert_eq!(
            notification_subject("appointment_notification"),
            "Appointment update"
        );
        assert_eq!(
            notification_subject("appointment_reminder"),
            "Appointment update"
        );
    }
}
