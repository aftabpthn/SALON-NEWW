use serde_json::json;

use crate::{
    models::common::AppError,
    repositories::{
        benefit_notification_repository::{self, NewBenefitDelivery},
        birthday_anniversary_repository, clients_repository,
    },
    services::{birthday_anniversary_service, client_service, invoice_delivery, package_service},
    state::{AppState, AppointmentEvent},
};

pub async fn schedule(state: &AppState) -> Result<usize, AppError> {
    if !state.settings.benefit_delivery_configured() {
        return Ok(0);
    }
    let scopes = benefit_notification_repository::scopes(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load benefit reminder scopes"))?;
    let mut queued = 0usize;
    queued += schedule_marketing_campaigns(state).await?;
    for (tenant_id, branch_id) in scopes {
        let birthday_settings =
            birthday_anniversary_repository::get_settings(&state.db, &tenant_id, &branch_id)
                .await
                .map_err(|_| AppError::internal("failed to load birthday automation mode"))?;
        let allow_legacy_occasions = legacy_occasion_automation_allowed(
            birthday_settings
                .as_ref()
                .map(|row| row.workflow_mode.as_str()),
        );
        if !allow_legacy_occasions {
            queued += birthday_anniversary_service::run_auto_send(
                state, &tenant_id, &branch_id, "system", 250,
            )
            .await?
            .queued;
        }
        let reminders = benefit_notification_repository::approved_membership_reminders(
            &state.db, &tenant_id, &branch_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to load approved membership reminders"))?;
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
            )
            .await?;
        }
        for alert in package_service::alerts(&state.db, &tenant_id, &branch_id).await? {
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
            )
            .await?;
        }
        for candidate in
            clients_repository::automation_candidates(&state.db, &tenant_id, &branch_id)
                .await
                .map_err(|_| AppError::internal("failed to load client automation candidates"))?
        {
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
        let recipients =
            benefit_notification_repository::marketing_recipients(&state.db, &campaign)
                .await
                .map_err(|_| AppError::internal("failed to load campaign recipients"))?;
        let recipient_count = recipients.len();
        let mut campaign_queued = 0usize;
        for recipient in recipients {
            let source_id = format!("{}:{}", campaign.id, recipient.client_id);
            let payload = json!({
                "campaignId": campaign.id,
                "channel": campaign.channel,
                "recipient": recipient.recipient,
                "message": campaign.body,
                "subject": campaign.title,
                "clientName": recipient.client_name,
                "templateKind": "benefit"
            });
            campaign_queued += benefit_notification_repository::enqueue(
                &state.db,
                NewBenefitDelivery {
                    tenant_id: &campaign.tenant_id,
                    branch_id: &campaign.branch_id,
                    source_type: "marketing_campaign",
                    source_id: &source_id,
                    client_id: &recipient.client_id,
                    channel: &campaign.channel,
                    recipient: payload["recipient"].as_str().unwrap_or_default(),
                    payload: &payload,
                },
            )
            .await
            .map_err(|_| AppError::internal("failed to queue campaign delivery"))?
                as usize;
        }
        benefit_notification_repository::mark_campaign_queued(
            &state.db,
            &campaign,
            recipient_count,
        )
        .await
        .map_err(|_| AppError::internal("failed to update campaign status"))?;
        queued += campaign_queued;
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
) -> Result<usize, AppError> {
    let mut queued = 0usize;
    if state.settings.whatsapp_benefit_enabled()
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
    if state.settings.invoice_delivery_webhook_url.is_some()
        && !email.trim().is_empty()
        && client_service::communication_allowed(
            &state.db, tenant_id, branch_id, client_id, "email",
        )
        .await
        .map_err(|_| AppError::internal("failed to verify email consent"))?
    {
        let payload = json!({"channel":"email","recipient":email,"message":message,"clientName":client_name,"subject":"Membership and package reminder"});
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
            }
        }
        refresh_occasion_delivery(state, &row).await?;
    }
    benefit_notification_repository::refresh_marketing_campaign_statuses(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to refresh campaign delivery status"))?;
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
    use super::legacy_occasion_automation_allowed;

    #[test]
    fn managed_mode_disables_legacy_occasion_automation() {
        assert!(legacy_occasion_automation_allowed(None));
        assert!(legacy_occasion_automation_allowed(Some("legacy_auto")));
        assert!(!legacy_occasion_automation_allowed(Some("managed")));
    }
}
