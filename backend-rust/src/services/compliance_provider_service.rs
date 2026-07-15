use std::time::Duration;

use serde_json::{json, Value};

use crate::{
    config::Settings,
    models::common::AppError,
    repositories::compliance_repository::{self, ComplianceJob},
    state::AppState,
};

pub async fn process_due(state: &AppState) -> Result<usize, AppError> {
    if !state.settings.compliance_provider_enabled() {
        return Ok(0);
    }
    compliance_repository::recover_expired(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to recover compliance jobs"))?;

    let mut submitted = 0usize;
    for _ in 0..25 {
        let Some(job) = compliance_repository::claim_due(&state.db)
            .await
            .map_err(|_| AppError::internal("failed to claim compliance job"))?
        else {
            break;
        };
        if process_job(state, &job).await? {
            submitted += 1;
        }
    }
    Ok(submitted)
}

async fn process_job(state: &AppState, job: &ComplianceJob) -> Result<bool, AppError> {
    let Some(invoice) = compliance_repository::invoice_payload(&state.db, job)
        .await
        .map_err(|_| AppError::internal("failed to build compliance payload"))?
    else {
        compliance_repository::mark_failed(&state.db, job, "finalized invoice was not found")
            .await
            .map_err(|_| AppError::internal("failed to record compliance failure"))?;
        return Ok(false);
    };
    let idempotency_key = format!(
        "compliance:{}:{}:{}:{}",
        job.tenant_id, job.branch_id, job.sale_id, job.document_type
    );
    let payload = json!({
        "idempotencyKey": idempotency_key,
        "documentType": job.document_type,
        "tenantId": job.tenant_id,
        "branchId": job.branch_id,
        "saleId": job.sale_id,
        "invoice": invoice
    });
    compliance_repository::save_payload(&state.db, &job.id, &payload)
        .await
        .map_err(|_| AppError::internal("failed to save compliance payload"))?;

    match submit(&state.settings, &idempotency_key, &payload).await {
        Ok((reference, result)) => {
            compliance_repository::mark_submitted(&state.db, job, &reference, &result)
                .await
                .map_err(|_| AppError::internal("failed to complete compliance job"))?;
            Ok(true)
        }
        Err(_) => {
            compliance_repository::mark_failed(
                &state.db,
                job,
                "compliance provider submission failed",
            )
            .await
            .map_err(|_| AppError::internal("failed to reschedule compliance job"))?;
            Ok(false)
        }
    }
}

async fn submit(
    settings: &Settings,
    idempotency_key: &str,
    payload: &Value,
) -> Result<(String, Value), AppError> {
    let url = settings
        .compliance_provider_url
        .as_deref()
        .ok_or_else(provider_not_configured)?;
    let token = settings
        .compliance_provider_token
        .as_deref()
        .ok_or_else(provider_not_configured)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| provider_unavailable())?;
    let response = client
        .post(url)
        .bearer_auth(token)
        .header("Idempotency-Key", idempotency_key)
        .json(payload)
        .send()
        .await
        .map_err(|_| provider_unavailable())?;
    let status = response.status();
    let result = response
        .json::<Value>()
        .await
        .map_err(|_| provider_unavailable())?;
    if !status.is_success() {
        return Err(provider_unavailable());
    }
    let reference = provider_reference(&result).ok_or_else(provider_unavailable)?;
    Ok((reference, result))
}

fn provider_reference(result: &Value) -> Option<String> {
    [
        result.get("providerReference"),
        result.get("irn"),
        result.get("ewayBillNumber"),
        result.pointer("/data/providerReference"),
        result.pointer("/data/irn"),
        result.pointer("/data/ewayBillNumber"),
    ]
    .into_iter()
    .flatten()
    .find_map(Value::as_str)
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(ToString::to_string)
}

fn provider_not_configured() -> AppError {
    AppError::service_unavailable(
        "COMPLIANCE_PROVIDER_NOT_CONFIGURED",
        "compliance provider is not configured",
    )
}

fn provider_unavailable() -> AppError {
    AppError::service_unavailable(
        "COMPLIANCE_PROVIDER_UNAVAILABLE",
        "compliance provider is unavailable",
    )
}

#[cfg(test)]
mod tests {
    use super::provider_reference;
    use crate::repositories::compliance_repository::{self, ComplianceJob};
    use serde_json::json;
    use sqlx::PgPool;

    #[sqlx::test(migrations = false)]
    async fn compliance_job_success_retry_and_terminal_failure(pool: PgPool) {
        for statement in [
            "CREATE TABLE pos_compliance_jobs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, sale_id TEXT NOT NULL, document_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued' CONSTRAINT pos_compliance_jobs_status_check CHECK (status IN ('queued','submitted','failed','cancelled')), payload_json JSONB NOT NULL DEFAULT '{}'::jsonb, result_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE TABLE pos_invoice_compliance (tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, sale_id TEXT NOT NULL, e_invoice_status TEXT NOT NULL, e_way_bill_status TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (tenant_id,branch_id,sale_id))",
            "CREATE TABLE pos_invoice_events (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, sale_id TEXT NOT NULL, event_type TEXT NOT NULL, actor_user_id TEXT NOT NULL, payload_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        sqlx::raw_sql(include_str!(
            "../../migrations/0084_compliance_provider_worker.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO pos_invoice_compliance VALUES ('tenant-1','branch-1','sale-1','queued','queued',NOW()),('tenant-1','branch-1','sale-2','queued','queued',NOW())")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO pos_compliance_jobs (id,tenant_id,branch_id,sale_id,document_type,status,attempt_count) VALUES ('job-1','tenant-1','branch-1','sale-1','e_invoice','processing',1),('job-2','tenant-1','branch-1','sale-2','e_way_bill','processing',1)")
            .execute(&pool).await.unwrap();

        let retry_job = ComplianceJob {
            id: "job-1".into(),
            tenant_id: "tenant-1".into(),
            branch_id: "branch-1".into(),
            sale_id: "sale-1".into(),
            document_type: "e_invoice".into(),
            attempt_count: 1,
        };
        compliance_repository::mark_failed(&pool, &retry_job, "temporary provider error")
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT status FROM pos_compliance_jobs WHERE id='job-1'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "queued"
        );

        sqlx::query(
            "UPDATE pos_compliance_jobs SET status='processing',attempt_count=5 WHERE id='job-1'",
        )
        .execute(&pool)
        .await
        .unwrap();
        compliance_repository::mark_failed(
            &pool,
            &ComplianceJob {
                attempt_count: 5,
                ..retry_job
            },
            "provider rejected",
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT e_invoice_status FROM pos_invoice_compliance WHERE sale_id='sale-1'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "failed"
        );

        let success_job = ComplianceJob {
            id: "job-2".into(),
            tenant_id: "tenant-1".into(),
            branch_id: "branch-1".into(),
            sale_id: "sale-2".into(),
            document_type: "e_way_bill".into(),
            attempt_count: 1,
        };
        compliance_repository::mark_submitted(
            &pool,
            &success_job,
            "EWB-123",
            &json!({"ewayBillNumber":"EWB-123"}),
        )
        .await
        .unwrap();
        compliance_repository::mark_submitted(
            &pool,
            &success_job,
            "EWB-123",
            &json!({"ewayBillNumber":"EWB-123"}),
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT e_way_bill_status FROM pos_invoice_compliance WHERE sale_id='sale-2'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "submitted"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM pos_invoice_events WHERE sale_id='sale-2'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            provider_reference(&json!({"data":{"irn":"IRN-123"}})).as_deref(),
            Some("IRN-123")
        );
    }
}
