use serde_json::json;

use crate::{
    models::common::AppError, repositories::membership_lifecycle_repository, routes::pos,
    services::razorpay_payment_service, state::AppState,
};

pub async fn process_due(state: &AppState) -> Result<usize, AppError> {
    if !state.settings.razorpay_payment_links_enabled() {
        return Ok(0);
    }
    let due = membership_lifecycle_repository::claim_due_auto_renewals(&state.db, 25)
        .await
        .map_err(|_| AppError::internal("failed to claim due membership auto-renewals"))?;
    let mut completed = 0usize;
    for context in due {
        let remote = match razorpay_payment_service::fetch_subscription(
            &state.settings,
            &context.payment_reference,
        )
        .await
        {
            Ok(remote) => remote,
            Err(error) => {
                membership_lifecycle_repository::record_auto_renew_failure(
                    &state.db,
                    &context,
                    &format!("{error:?}"),
                    &json!({}),
                )
                .await
                .map_err(|_| AppError::internal("failed to record auto-renew provider failure"))?;
                continue;
            }
        };
        if !subscription_cycle_settled(
            &remote.status,
            remote.paid_count,
            remote.current_end,
            context.provider_cycle_end,
        ) {
            let message = format!(
                "Razorpay subscription is {} without a new settled cycle",
                remote.status
            );
            membership_lifecycle_repository::record_auto_renew_failure(
                &state.db,
                &context,
                &message,
                &remote.payload,
            )
            .await
            .map_err(|_| AppError::internal("failed to schedule auto-renew retry"))?;
            continue;
        }
        let provider_reference = format!("{}:{}", remote.id, remote.current_end);
        match pos::create_auto_renew_sale(
            state,
            &context.tenant_id,
            &context.branch_id,
            &context.client_id,
            &context.membership_id,
            &context.membership_name,
            context.price_paise,
            &context.attempt_id,
            &provider_reference,
        )
        .await
        {
            Ok(sale_id) => {
                membership_lifecycle_repository::record_auto_renew_cycle(
                    &state.db,
                    &context.tenant_id,
                    &context.branch_id,
                    &sale_id,
                    remote.current_end,
                    &remote.payload,
                )
                .await
                .map_err(|_| AppError::internal("failed to record settled auto-renew cycle"))?;
                completed += 1;
            }
            Err(error) => {
                membership_lifecycle_repository::record_auto_renew_failure(
                    &state.db,
                    &context,
                    &format!("{error:?}"),
                    &remote.payload,
                )
                .await
                .map_err(|_| AppError::internal("failed to record auto-renew checkout failure"))?;
            }
        }
    }
    Ok(completed)
}

fn subscription_cycle_settled(
    status: &str,
    paid_count: i64,
    current_end: i64,
    previous_cycle_end: i64,
) -> bool {
    status == "active" && paid_count > 0 && current_end > previous_cycle_end
}

#[cfg(test)]
mod tests {
    use super::subscription_cycle_settled;

    #[test]
    fn accepts_only_a_new_paid_active_subscription_cycle() {
        assert!(subscription_cycle_settled("active", 1, 200, 100));
        assert!(!subscription_cycle_settled("pending", 1, 200, 100));
        assert!(!subscription_cycle_settled("active", 0, 200, 100));
        assert!(!subscription_cycle_settled("active", 1, 100, 100));
    }
}
