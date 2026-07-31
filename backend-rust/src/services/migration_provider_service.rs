use axum::body::Bytes;
use chrono::{Duration as ChronoDuration, NaiveDate};
use futures_util::{stream, StreamExt};
use reqwest::{header, Response, StatusCode, Url};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    io::Write,
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, ZipWriter};

use crate::{
    config::Settings,
    models::{
        common::AppError,
        migration::{
            CreateLargeImportJobRequest, MigrationEntity, MigrationMode, MigrationProvider,
        },
        migration_file::{CompleteMigrationUploadRequest, CreateMigrationUploadRequest},
    },
    repositories::integration_repository::{self, ClaimedConnectorSyncJob},
    services::{
        integration_service::{ConnectorProvider, MigrationConnectorWrite},
        migration_file_service, migration_large_import_service, security_service,
    },
};

const MAX_PROVIDER_FILE_BYTES: u64 = 500 * 1024 * 1024;
const MAX_PROVIDER_REQUEST_ATTEMPTS: usize = 5;
const MAX_PROVIDER_RETRY_DELAY_SECONDS: u64 = 60;
const MAX_PROVIDER_CONCURRENCY: usize = 8;
const ZENOTI_PAGE_SIZE: usize = 100;
const MAX_ZENOTI_ROWS_PER_DATASET: usize = 1_000_000;

pub fn validated_config(
    provider: ConnectorProvider,
    request: &MigrationConnectorWrite,
) -> Result<Value, AppError> {
    let auth_scheme = request
        .auth_scheme
        .as_deref()
        .unwrap_or(if provider == ConnectorProvider::Zenoti {
            "api_key"
        } else {
            "bearer"
        })
        .trim()
        .to_ascii_lowercase();
    if !matches!(auth_scheme.as_str(), "api_key" | "bearer") {
        return Err(AppError::validation("authScheme must be api_key or bearer"));
    }
    let mode = request.mode.as_deref().unwrap_or("dry-run").trim();
    MigrationMode::try_from(mode).map_err(AppError::validation)?;
    let auto_queue = request.auto_queue.unwrap_or(true);
    match provider {
        ConnectorProvider::Zenoti => {
            let centers = request
                .center_ids
                .iter()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .collect::<BTreeSet<_>>();
            if centers.is_empty()
                || centers.len() > 100
                || centers.iter().any(|value| {
                    !(16..=64).contains(&value.len())
                        || !value
                            .chars()
                            .all(|character| character.is_ascii_alphanumeric() || character == '-')
                })
            {
                return Err(AppError::validation(
                    "one to 100 valid Zenoti center IDs are required",
                ));
            }
            let (start_date, end_date) =
                validated_date_range(request.start_date.as_deref(), request.end_date.as_deref())?;
            Ok(json!({
                "accountId": centers.iter().cloned().collect::<Vec<_>>().join(","),
                "authScheme": auth_scheme,
                "centerIds": centers,
                "startDate": start_date,
                "endDate": end_date,
                "autoQueue": auto_queue,
                "mode": mode
            }))
        }
        ConnectorProvider::Dingg => {
            let export_url = request
                .export_url
                .as_deref()
                .ok_or_else(|| AppError::validation("DINGG exportUrl is required"))?;
            validate_export_url(export_url)?;
            let file_name = request
                .source_file_name
                .as_deref()
                .unwrap_or("dingg-export.xlsx")
                .trim();
            validate_source_file_name(file_name)?;
            Ok(json!({
                "accountId": "dingg-export",
                "authScheme": auth_scheme,
                "exportUrl": export_url.trim(),
                "sourceFileName": file_name,
                "autoQueue": auto_queue,
                "mode": mode
            }))
        }
        _ => Err(AppError::validation(
            "provider does not support migration snapshots",
        )),
    }
}

pub async fn run(
    db: &PgPool,
    settings: &Settings,
    job: &ClaimedConnectorSyncJob,
) -> Result<(Value, String, String), AppError> {
    let provider = ConnectorProvider::parse(&job.provider)?;
    let credential = integration_repository::connector_credential(
        db,
        &job.tenant_id,
        &job.branch_id,
        provider.code(),
    )
    .await
    .map_err(|_| AppError::internal("failed to load migration connector"))?
    .ok_or_else(|| AppError::not_found("migration connector was not found"))?;
    let encryption_key = settings.security_encryption_key.as_deref().ok_or_else(|| {
        AppError::service_unavailable(
            "SECURITY_ENCRYPTION_NOT_CONFIGURED",
            "connector credential encryption is not configured",
        )
    })?;
    let token =
        security_service::decrypt_secret(encryption_key, &credential.access_token_ciphertext)?;
    let path = match provider {
        ConnectorProvider::Dingg => download_dingg(&credential.config_json, &token).await?,
        ConnectorProvider::Zenoti => snapshot_zenoti(&credential.config_json, &token).await?,
        _ => {
            return Err(AppError::validation(
                "provider is not a migration connector",
            ))
        }
    };
    let result = ingest_and_queue(db, job, provider, &credential.config_json, &path).await;
    let _ = tokio::fs::remove_file(&path).await;
    result
}

async fn ingest_and_queue(
    db: &PgPool,
    job: &ClaimedConnectorSyncJob,
    provider: ConnectorProvider,
    config: &Value,
    path: &Path,
) -> Result<(Value, String, String), AppError> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::internal("provider snapshot file name is invalid"))?;
    let size = tokio::fs::metadata(path)
        .await
        .map_err(|_| AppError::internal("provider snapshot is unavailable"))?
        .len();
    if size == 0 || size > MAX_PROVIDER_FILE_BYTES {
        return Err(AppError::validation(
            "provider snapshot must be between 1 byte and 500 MB",
        ));
    }
    let hash = file_sha256(path).await?;
    let total_parts = size.div_ceil(migration_file_service::MAX_PART_BYTES as u64) as i32;
    let upload = migration_file_service::create_upload(
        db,
        &job.tenant_id,
        &job.branch_id,
        &job.created_by,
        CreateMigrationUploadRequest {
            file_name: file_name.to_string(),
            provider: if provider == ConnectorProvider::Zenoti {
                MigrationProvider::Zenoti
            } else {
                MigrationProvider::Dingg
            },
            content_type: Some(content_type_for(file_name).into()),
            size_bytes: size as i64,
            total_parts,
            expected_sha256: Some(hash.clone()),
            retention_days: config
                .get("retentionDays")
                .and_then(Value::as_i64)
                .unwrap_or(90) as i32,
            evidence_kind: None,
            supplier_batch: None,
            cutover_id: None,
        },
    )
    .await?;
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| AppError::internal("provider snapshot is unavailable"))?;
    let mut buffer = vec![0_u8; migration_file_service::MAX_PART_BYTES];
    for part in 1..=total_parts {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|_| AppError::internal("failed to read provider snapshot"))?;
        if read == 0 {
            return Err(AppError::internal(
                "provider snapshot ended before its manifest",
            ));
        }
        migration_file_service::upload_part(
            db,
            &job.tenant_id,
            &job.branch_id,
            &upload.id,
            part,
            None,
            Bytes::copy_from_slice(&buffer[..read]),
        )
        .await?;
    }
    let completed = migration_file_service::complete_upload(
        db,
        &job.tenant_id,
        &job.branch_id,
        &job.created_by,
        &upload.id,
        CompleteMigrationUploadRequest {
            expected_sha256: Some(hash),
        },
    )
    .await?;
    let mut queued = Vec::new();
    let mut cutover_required = Vec::new();
    if config
        .get("autoQueue")
        .and_then(Value::as_bool)
        .unwrap_or(true)
    {
        let profile = migration_file_service::source_profile(
            db,
            &job.tenant_id,
            &job.branch_id,
            &job.created_by,
            &completed.source_file.id,
        )
        .await?;
        let mode = MigrationMode::try_from(
            config
                .get("mode")
                .and_then(Value::as_str)
                .unwrap_or("dry-run"),
        )
        .map_err(AppError::validation)?;
        let source_provider = if provider == ConnectorProvider::Zenoti {
            MigrationProvider::Zenoti
        } else {
            MigrationProvider::Dingg
        };
        let mut seen = HashSet::new();
        for sheet in profile.sheets.into_iter().filter(|sheet| sheet.importable) {
            for entity in sheet.targets {
                if !seen.insert((sheet.id.clone(), entity.as_str())) {
                    continue;
                }
                if matches!(
                    entity,
                    MigrationEntity::PurchaseBills | MigrationEntity::Inventory
                ) {
                    cutover_required.push(json!({"entity":entity.as_str(),"sheet":sheet.name}));
                    continue;
                }
                let import_mode = mode;
                let import = migration_large_import_service::create_job(
                    db,
                    &job.tenant_id,
                    &job.branch_id,
                    &job.created_by,
                    CreateLargeImportJobRequest {
                        source_file_id: completed.source_file.id.clone(),
                        entity,
                        mode: import_mode,
                        posting_mode: None,
                        cutover_id: None,
                        cutover_date: None,
                        mapping: BTreeMap::new(),
                        duplicate_decisions: BTreeMap::new(),
                        mapping_id: None,
                        owner_user_id: Some(job.created_by.clone()),
                        chunk_size: 5_000,
                        allow_partial_import: false,
                        source_provider,
                        source_sheet: sheet.id.clone(),
                        header_source_sheet: String::new(),
                    },
                )
                .await?;
                queued.push(json!({"jobId":import.id,"entity":entity.as_str(),"sheet":sheet.name,"mode":import_mode.as_str()}));
            }
        }
    }
    Ok((
        json!({
            "verified": true,
            "provider": provider.code(),
            "sourceFileId": completed.source_file.id,
            "sourceSha256": completed.source_file.sha256,
            "queuedImports": queued,
            "cutoverRequired": cutover_required
        }),
        config
            .get("accountId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        provider.label().to_string(),
    ))
}

async fn download_dingg(config: &Value, token: &str) -> Result<PathBuf, AppError> {
    let url = validate_export_url(
        config
            .get("exportUrl")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::validation("DINGG exportUrl is missing"))?,
    )?;
    let client = pinned_https_client(&url).await?;
    let authorization = provider_authorization(config, token)?;
    let response = provider_get(&client, url.as_str(), &authorization, "DINGG").await?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_PROVIDER_FILE_BYTES)
    {
        return Err(AppError::validation("DINGG export is larger than 500 MB"));
    }
    let name = config
        .get("sourceFileName")
        .and_then(Value::as_str)
        .unwrap_or("dingg-export.xlsx");
    let path = provider_temp_path(name)?;
    let mut file = tokio::fs::File::create(&path)
        .await
        .map_err(|_| AppError::internal("failed to create DINGG snapshot"))?;
    let mut response = response;
    let mut size = 0_u64;
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        AppError::service_unavailable("DINGG_UNAVAILABLE", "DINGG export download failed")
    })? {
        size = size.saturating_add(chunk.len() as u64);
        if size > MAX_PROVIDER_FILE_BYTES {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(AppError::validation("DINGG export is larger than 500 MB"));
        }
        file.write_all(&chunk)
            .await
            .map_err(|_| AppError::internal("failed to store DINGG snapshot"))?;
    }
    file.flush()
        .await
        .map_err(|_| AppError::internal("failed to finalize DINGG snapshot"))?;
    Ok(path)
}

async fn snapshot_zenoti(config: &Value, token: &str) -> Result<PathBuf, AppError> {
    let authorization = provider_authorization(config, token)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|_| AppError::internal("failed to initialize Zenoti client"))?;
    let centers = config
        .get("centerIds")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::validation("Zenoti center IDs are missing"))?;
    let mut datasets = BTreeMap::<String, Vec<Value>>::new();
    for center in centers.iter().filter_map(Value::as_str) {
        let guests_endpoint = format!("https://api.zenoti.com/v1/guests?center_id={center}");
        let mut guests =
            fetch_zenoti_pages(&client, &authorization, &guests_endpoint, "guests").await?;
        let guest_ids = guests
            .iter()
            .filter_map(|row| value_at(row, &["/id", "/guest_id"]))
            .map(str::to_string)
            .collect::<BTreeSet<_>>();
        canonicalize_zenoti_rows("clients.csv", &mut guests, center, None);
        datasets
            .entry("clients.csv".into())
            .or_default()
            .append(&mut guests);

        for (name, endpoint, key) in [
            (
                "staff.csv",
                format!("https://api.zenoti.com/v1/centers/{center}/employees"),
                "employees",
            ),
            (
                "services.csv",
                format!("https://api.zenoti.com/v1/Centers/{center}/services"),
                "services",
            ),
            (
                "products.csv",
                format!("https://api.zenoti.com/v1/centers/{center}/products"),
                "products",
            ),
            (
                "memberships.csv",
                format!(
                    "https://api.zenoti.com/v1/centers/{center}/memberships?show_in_catalog=true&expand=all"
                ),
                "memberships",
            ),
            (
                "client-memberships.csv",
                format!("https://api.zenoti.com/v1/centers/{center}/members?status=-1"),
                "members",
            ),
            (
                "packages.csv",
                format!("https://api.zenoti.com/v1/centers/{center}/packages"),
                "packages",
            ),
        ] {
            let mut rows = fetch_zenoti_pages(&client, &authorization, &endpoint, key).await?;
            canonicalize_zenoti_rows(name, &mut rows, center, None);
            datasets.entry(name.into()).or_default().append(&mut rows);
        }

        let child_results = stream::iter(guest_ids.into_iter().map(|guest_id| {
            let client = &client;
            let authorization = &authorization;
            async move {
                let gift_cards = fetch_zenoti_pages(
                    client,
                    authorization,
                    &format!("https://api.zenoti.com/v1/guests/{guest_id}/gift_cards"),
                    "gift_cards",
                )
                .await?;
                let loyalty = fetch_zenoti_loyalty(client, authorization, &guest_id).await?;
                Ok::<_, AppError>((guest_id, gift_cards, loyalty))
            }
        }))
        .buffer_unordered(MAX_PROVIDER_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;
        for result in child_results {
            let (guest_id, mut gift_cards, mut loyalty) = result?;
            canonicalize_zenoti_rows("gift-cards.csv", &mut gift_cards, center, Some(&guest_id));
            canonicalize_zenoti_rows("loyalty.csv", &mut loyalty, center, Some(&guest_id));
            datasets
                .entry("gift-cards.csv".into())
                .or_default()
                .append(&mut gift_cards);
            datasets
                .entry("loyalty.csv".into())
                .or_default()
                .append(&mut loyalty);
        }

        if let (Some(start), Some(end)) = (
            config
                .get("startDate")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty()),
            config
                .get("endDate")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty()),
        ) {
            let mut cursor = NaiveDate::parse_from_str(start, "%Y-%m-%d")
                .map_err(|_| AppError::validation("startDate must use YYYY-MM-DD"))?;
            let end = NaiveDate::parse_from_str(end, "%Y-%m-%d")
                .map_err(|_| AppError::validation("endDate must use YYYY-MM-DD"))?;
            let mut appointment_rows = Vec::new();
            while cursor < end {
                let window_end = (cursor + ChronoDuration::days(7)).min(end);
                let endpoint = format!(
                    "https://api.zenoti.com/v1/appointments?center_id={center}&start_date={cursor}&end_date={window_end}&include_no_show_cancel=true"
                );
                let rows =
                    fetch_zenoti_pages(&client, &authorization, &endpoint, "appointments").await?;
                appointment_rows.extend(expand_zenoti_appointments(rows));
                cursor = window_end;
            }
            let invoice_ids = appointment_rows
                .iter()
                .filter_map(|row| value_at(row, &["/invoice_id", "/invoice/id"]))
                .map(str::to_string)
                .collect::<BTreeSet<_>>();
            canonicalize_zenoti_rows("appointments.csv", &mut appointment_rows, center, None);
            datasets
                .entry("appointments.csv".into())
                .or_default()
                .append(&mut appointment_rows);

            let invoices = stream::iter(invoice_ids.into_iter().map(|invoice_id| {
                let client = &client;
                let authorization = &authorization;
                async move { fetch_zenoti_invoice(client, authorization, &invoice_id).await }
            }))
            .buffer_unordered(MAX_PROVIDER_CONCURRENCY)
            .collect::<Vec<_>>()
            .await;
            for invoice in invoices {
                append_zenoti_invoice(invoice?, center, &mut datasets)?;
            }
        }
    }
    let path = provider_temp_path("zenoti-snapshot.zip")?;
    tokio::task::spawn_blocking({
        let path = path.clone();
        move || -> Result<(), AppError> {
            let file = std::fs::File::create(&path)
                .map_err(|_| AppError::internal("failed to create Zenoti snapshot"))?;
            let mut zip = ZipWriter::new(file);
            for (name, rows) in datasets {
                zip.start_file(name, SimpleFileOptions::default())
                    .map_err(|_| AppError::internal("failed to write Zenoti snapshot"))?;
                zip.write_all(&rows_csv(&rows)?)
                    .map_err(|_| AppError::internal("failed to write Zenoti snapshot"))?;
            }
            zip.finish()
                .map_err(|_| AppError::internal("failed to finalize Zenoti snapshot"))?;
            Ok(())
        }
    })
    .await
    .map_err(|_| AppError::internal("Zenoti snapshot worker stopped"))??;
    Ok(path)
}

fn expand_zenoti_appointments(rows: Vec<Value>) -> Vec<Value> {
    let mut expanded = Vec::new();
    for row in rows {
        let nested = row
            .get("appointments")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if nested.is_empty() {
            expanded.push(row);
            continue;
        }
        for mut appointment in nested {
            if let Some(object) = appointment.as_object_mut() {
                if let Some(guest_id) = value_at(&row, &["/guest/id", "/id"]) {
                    object.entry("guest_id").or_insert_with(|| json!(guest_id));
                }
                for field in ["first_name", "last_name", "mobile", "email"] {
                    if let Some(value) = row.get(field) {
                        object
                            .entry(format!("guest_{field}"))
                            .or_insert_with(|| value.clone());
                    }
                }
            }
            expanded.push(appointment);
        }
    }
    expanded
}

fn canonicalize_zenoti_rows(name: &str, rows: &mut [Value], center: &str, guest_id: Option<&str>) {
    for row in rows {
        let Some(object) = row.as_object_mut() else {
            continue;
        };
        object.entry("center_id").or_insert_with(|| json!(center));
        if let Some(guest_id) = guest_id {
            object.entry("guest_id").or_insert_with(|| json!(guest_id));
        }
        match name {
            "clients.csv" => {
                copy_canonical(object, "oldExternalId", &["/id", "/guest_id"]);
                copy_canonical(object, "code", &["/code"]);
                copy_canonical(object, "firstName", &["/first_name", "/firstName", "/name"]);
                copy_canonical(object, "lastName", &["/last_name", "/lastName"]);
                copy_canonical(
                    object,
                    "phone",
                    &["/mobile_phone", "/mobile/number", "/mobile", "/phone"],
                );
                copy_canonical(object, "email", &["/email"]);
                copy_canonical(object, "birthday", &["/date_of_birth", "/birth_date"]);
                copy_canonical(
                    object,
                    "anniversary",
                    &["/anniversary_date", "/anniversary"],
                );
            }
            "staff.csv" => {
                copy_canonical(object, "oldExternalId", &["/id", "/employee_id"]);
                copy_canonical(object, "employeeCode", &["/code", "/employee_code", "/id"]);
                copy_canonical(
                    object,
                    "firstName",
                    &["/first_name", "/display_name", "/name"],
                );
                copy_canonical(object, "lastName", &["/last_name"]);
                copy_canonical(object, "email", &["/email"]);
                copy_canonical(
                    object,
                    "mobilePhone",
                    &["/mobile_phone", "/mobile/number", "/phone"],
                );
                copy_canonical(
                    object,
                    "jobTitle",
                    &["/job_title", "/designation", "/title"],
                );
            }
            "services.csv" => {
                copy_canonical(object, "oldExternalId", &["/id", "/service_id"]);
                copy_canonical(object, "name", &["/name", "/display_name"]);
                copy_canonical(object, "category", &["/category/name", "/category"]);
                copy_canonical(
                    object,
                    "durationMinutes",
                    &["/duration", "/duration_in_minutes"],
                );
                copy_canonical(
                    object,
                    "pricePaise",
                    &["/price/final", "/price/sales", "/price"],
                );
                copy_canonical(object, "sacCode", &["/sac", "/sac_code"]);
            }
            "products.csv" => {
                copy_canonical(object, "oldExternalId", &["/id", "/product_id"]);
                copy_canonical(object, "sku", &["/code", "/sku", "/id"]);
                copy_canonical(object, "name", &["/name", "/display_name"]);
                copy_canonical(object, "category", &["/category/name", "/category"]);
                copy_canonical(object, "unit", &["/unit", "/measurement"]);
                copy_canonical(object, "unitCostPaise", &["/cost_price", "/purchase_price"]);
                copy_canonical(object, "hsnCode", &["/hsn", "/hsn_code"]);
                copy_canonical(object, "barcode", &["/barcode", "/code"]);
            }
            "memberships.csv" => {
                copy_canonical(object, "oldExternalId", &["/id", "/membership_id"]);
                copy_canonical(object, "code", &["/code", "/membership_code", "/id"]);
                copy_canonical(object, "name", &["/name", "/display_name"]);
                copy_canonical(object, "planType", &["/membership_type", "/type"]);
                copy_canonical(object, "pricePaise", &["/price"]);
                copy_canonical(object, "notes", &["/description"]);
                copy_canonical(object, "services", &["/services"]);
            }
            "client-memberships.csv" => {
                copy_canonical(
                    object,
                    "oldExternalId",
                    &["/id", "/user_membership_id", "/UserMembershipId"],
                );
                copy_canonical(object, "client", &["/guest/id", "/guest_id"]);
                copy_canonical(object, "clientName", &["/guest/name"]);
                copy_canonical(
                    object,
                    "membership",
                    &[
                        "/membership/id",
                        "/membership/name",
                        "/MembershipId",
                        "/Name",
                    ],
                );
                copy_canonical(
                    object,
                    "pricePaidPaise",
                    &["/membership_price", "/MembershipPrice"],
                );
                copy_canonical(
                    object,
                    "startDate",
                    &["/start_date", "/valid_from", "/ValidFrom"],
                );
                copy_canonical(
                    object,
                    "endDate",
                    &["/end_date", "/expiry_date", "/ExpiryDate"],
                );
                copy_canonical(
                    object,
                    "balancePaise",
                    &["/credit_amount/balance", "/ServiceCreditAmountBalance"],
                );
                copy_canonical(object, "staff", &["/sold_by_id", "/MembershipSoldBy"]);
                let active = object_value_at(
                    object,
                    &["/status", "/membership_status", "/MembershipStatus"],
                )
                .is_some_and(|status| status.eq_ignore_ascii_case("active") || status == "1");
                object.insert("active".into(), json!(active));
            }
            "packages.csv" => {
                copy_canonical(object, "oldExternalId", &["/id", "/package_id"]);
                copy_canonical(object, "name", &["/name", "/display_name"]);
                copy_canonical(object, "description", &["/description"]);
                copy_canonical(object, "pricePaise", &["/price/final", "/price"]);
                copy_canonical(object, "validityDays", &["/validity_days", "/validity"]);
                copy_canonical(object, "services", &["/services", "/service_ids"]);
            }
            "appointments.csv" => {
                copy_canonical(
                    object,
                    "oldExternalId",
                    &["/appointment_segment_id", "/appointment_id", "/id"],
                );
                copy_canonical(object, "client", &["/guest/id", "/guest_id"]);
                copy_canonical(
                    object,
                    "staff",
                    &["/therapist/id", "/therapist_id", "/employee/id"],
                );
                copy_canonical(
                    object,
                    "services",
                    &["/service/id", "/service_id", "/services"],
                );
                copy_canonical(
                    object,
                    "startAt",
                    &["/start_time_utc", "/start_time", "/selected_time"],
                );
                copy_canonical(
                    object,
                    "endAt",
                    &["/end_time_utc", "/end_time", "/actual_completed_time"],
                );
                copy_canonical(object, "notes", &["/notes"]);
            }
            "gift-cards.csv" => {
                copy_canonical(object, "oldExternalId", &["/id", "/code"]);
                copy_canonical(object, "code", &["/code"]);
                copy_canonical(object, "client", &["/guest_id"]);
                copy_canonical(object, "initialAmountPaise", &["/value", "/price"]);
                copy_canonical(object, "balancePaise", &["/balance"]);
                copy_canonical(object, "expiresAt", &["/expiry_date"]);
                copy_canonical(object, "occurredAt", &["/sale_date"]);
                let closed = object
                    .get("is_closed")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let balance = object
                    .get("balance")
                    .and_then(Value::as_f64)
                    .unwrap_or_default();
                object.insert(
                    "status".into(),
                    json!(if closed {
                        "voided"
                    } else if balance <= 0.0 {
                        "redeemed"
                    } else {
                        "active"
                    }),
                );
            }
            "loyalty.csv" => {
                copy_canonical(object, "client", &["/guest_id"]);
                copy_canonical(object, "balanceAfter", &["/balance"]);
                copy_canonical(object, "invoice", &["/invoice_id", "/invoice_no"]);
                copy_canonical(object, "occurredAt", &["/earned_on"]);
                let earned = object
                    .get("points_earned")
                    .and_then(Value::as_i64)
                    .unwrap_or_default();
                let redeemed = object
                    .get("points_redeemed")
                    .and_then(Value::as_i64)
                    .unwrap_or_default();
                let points = if earned != 0 { earned } else { -redeemed };
                object.insert("points".into(), json!(points));
                object.insert(
                    "transactionType".into(),
                    json!(if points < 0 { "redeemed" } else { "earned" }),
                );
                let id = format!(
                    "{}:{}:{}",
                    guest_id.unwrap_or("guest"),
                    object_value_at(object, &["/invoice_id", "/invoice_no"]).unwrap_or("points"),
                    object_value_at(object, &["/earned_on"]).unwrap_or("undated")
                );
                object.insert("oldExternalId".into(), json!(id));
            }
            _ => {}
        }
    }
}

fn copy_canonical(object: &mut serde_json::Map<String, Value>, target: &str, pointers: &[&str]) {
    if object.get(target).is_some_and(|value| !value.is_null()) {
        return;
    }
    if let Some(value) = pointers
        .iter()
        .find_map(|pointer| object_pointer(object, pointer))
        .filter(|value| !value.is_null())
        .cloned()
    {
        object.insert(target.to_string(), value);
    }
}

fn object_pointer<'a>(
    object: &'a serde_json::Map<String, Value>,
    pointer: &str,
) -> Option<&'a Value> {
    let mut parts = pointer.trim_start_matches('/').split('/');
    let mut value = object.get(parts.next()?)?;
    for part in parts {
        value = value.get(part)?;
    }
    Some(value)
}

fn object_value_at<'a>(
    object: &'a serde_json::Map<String, Value>,
    pointers: &[&str],
) -> Option<&'a str> {
    pointers
        .iter()
        .find_map(|pointer| object_pointer(object, pointer).and_then(Value::as_str))
        .filter(|value| !value.is_empty())
}

fn value_at<'a>(row: &'a Value, pointers: &[&str]) -> Option<&'a str> {
    pointers
        .iter()
        .find_map(|pointer| row.pointer(pointer).and_then(Value::as_str))
        .filter(|value| !value.is_empty())
}

async fn fetch_zenoti_loyalty(
    client: &reqwest::Client,
    authorization: &str,
    guest_id: &str,
) -> Result<Vec<Value>, AppError> {
    let mut rows = Vec::new();
    for page in 1..=10_000_usize {
        let endpoint = format!(
            "https://api.zenoti.com/v1/guests/{guest_id}/points?page_num={page}&num_records={ZENOTI_PAGE_SIZE}&expand[0]=get_points_history"
        );
        let payload = fetch_zenoti_json(client, authorization, &endpoint).await?;
        let details = payload
            .pointer("/guest_points/guest_points_details")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let count = details.len();
        rows.extend(details);
        if rows.len() > MAX_ZENOTI_ROWS_PER_DATASET {
            return Err(AppError::validation(
                "Zenoti loyalty history exceeds the one-million-row safety limit",
            ));
        }
        if count < ZENOTI_PAGE_SIZE {
            break;
        }
    }
    Ok(rows)
}

async fn fetch_zenoti_invoice(
    client: &reqwest::Client,
    authorization: &str,
    invoice_id: &str,
) -> Result<Value, AppError> {
    let endpoint = format!(
        "https://api.zenoti.com/v1/invoices/{invoice_id}?expand=InvoiceItems&expand=Transactions&expand=Appointments"
    );
    fetch_zenoti_json(client, authorization, &endpoint).await
}

async fn fetch_zenoti_json(
    client: &reqwest::Client,
    authorization: &str,
    endpoint: &str,
) -> Result<Value, AppError> {
    let response = provider_get(client, endpoint, authorization, "ZENOTI").await?;
    response
        .json()
        .await
        .map_err(|_| AppError::internal("Zenoti returned an invalid response"))
}

fn append_zenoti_invoice(
    payload: Value,
    center: &str,
    datasets: &mut BTreeMap<String, Vec<Value>>,
) -> Result<(), AppError> {
    let invoice = payload.get("invoice").cloned().unwrap_or(payload);
    let id = value_at(&invoice, &["/id"])
        .ok_or_else(|| AppError::internal("Zenoti invoice ID is missing"))?;
    let invoice_number = value_at(&invoice, &["/invoice_number", "/receipt_number"]).unwrap_or(id);
    let paid = invoice
        .pointer("/invoice_dues/paid")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    let balance = invoice
        .pointer("/invoice_dues/balance")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    let item_names = invoice
        .get("invoice_items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| value_at(item, &["/name"]))
        .collect::<Vec<_>>()
        .join(", ");
    let discount = invoice
        .get("invoice_items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.pointer("/price/discount").and_then(Value::as_f64))
        .sum::<f64>();
    datasets.entry("invoices.csv".into()).or_default().push(json!({
        "oldExternalId": id,
        "client": value_at(&invoice, &["/guest/id"]).unwrap_or(""),
        "invoiceNumber": invoice_number,
        "itemName": item_names,
        "subtotalPaise": invoice.pointer("/total_price/net_price").cloned().unwrap_or(json!(0)),
        "discountPaise": discount,
        "taxPaise": invoice.pointer("/total_price/tax").cloned().unwrap_or(json!(0)),
        "totalPaise": invoice.pointer("/total_price/sum_total").cloned().unwrap_or(json!(0)),
        "status": if balance <= 0.0 && paid > 0.0 { "paid" } else if paid > 0.0 { "partially_paid" } else { "open" },
        "businessDate": value_at(&invoice, &["/invoice_date"]).unwrap_or(""),
        "center_id": center
    }));
    for (index, transaction) in invoice
        .get("transactions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let amount = transaction.get("amount_paid").cloned().unwrap_or(json!(0));
        if amount.as_f64().unwrap_or_default() <= 0.0 {
            continue;
        }
        let transaction_id = value_at(transaction, &["/transaction_id"])
            .map(str::to_string)
            .unwrap_or_else(|| format!("{id}:{index}"));
        datasets.entry("payments.csv".into()).or_default().push(json!({
            "oldExternalId": transaction_id,
            "invoice": id,
            "method": zenoti_payment_method(transaction),
            "amountPaise": amount,
            "reference": value_at(transaction, &["/transaction_id"]).unwrap_or(""),
            "paidAt": value_at(transaction, &["/payment_date"]).unwrap_or_else(|| value_at(&invoice, &["/invoice_date"]).unwrap_or("")),
            "center_id": center
        }));
    }
    Ok(())
}

fn zenoti_payment_method(transaction: &Value) -> &'static str {
    let raw = value_at(
        transaction,
        &[
            "/payment_option/name",
            "/payment_option/type",
            "/payment_option/payment_mode",
        ],
    )
    .unwrap_or("")
    .to_ascii_lowercase();
    if raw.contains("cash") {
        "cash"
    } else if raw.contains("gift") {
        "gift_card"
    } else if raw.contains("loyalty")
        || raw.contains("prepaid")
        || raw.contains("membership")
        || raw.contains("package")
    {
        "wallet"
    } else if raw.contains("card") {
        "card"
    } else if raw.contains("cheque") || raw.contains("bank") {
        "bank_transfer"
    } else {
        "other"
    }
}

async fn fetch_zenoti_pages(
    client: &reqwest::Client,
    authorization: &str,
    endpoint: &str,
    list_key: &str,
) -> Result<Vec<Value>, AppError> {
    let mut rows = Vec::new();
    for page in 1..=10_000_usize {
        let mut url =
            Url::parse(endpoint).map_err(|_| AppError::internal("invalid Zenoti endpoint"))?;
        url.query_pairs_mut()
            .append_pair("page", &page.to_string())
            .append_pair("size", &ZENOTI_PAGE_SIZE.to_string());
        let response = provider_get(client, url.as_str(), authorization, "ZENOTI").await?;
        let payload: Value = response
            .json()
            .await
            .map_err(|_| AppError::internal("Zenoti returned an invalid response"))?;
        let page_rows = payload
            .get(list_key)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let count = page_rows.len();
        rows.extend(page_rows);
        if rows.len() > MAX_ZENOTI_ROWS_PER_DATASET {
            return Err(AppError::validation(
                "Zenoti dataset exceeds the one-million-row safety limit",
            ));
        }
        let total = payload.pointer("/page_info/total").and_then(Value::as_u64);
        if count < ZENOTI_PAGE_SIZE || total.is_some_and(|total| rows.len() as u64 >= total) {
            break;
        }
    }
    Ok(rows)
}

async fn provider_get(
    client: &reqwest::Client,
    endpoint: &str,
    authorization: &str,
    provider: &'static str,
) -> Result<Response, AppError> {
    for attempt in 0..MAX_PROVIDER_REQUEST_ATTEMPTS {
        match client
            .get(endpoint)
            .header(header::AUTHORIZATION, authorization)
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => return Ok(response),
            Ok(response)
                if attempt + 1 < MAX_PROVIDER_REQUEST_ATTEMPTS
                    && (response.status() == StatusCode::TOO_MANY_REQUESTS
                        || response.status().is_server_error()) =>
            {
                tokio::time::sleep(provider_retry_delay(response.headers(), attempt)).await;
            }
            Ok(response) => return Err(provider_status_error(provider, response.status())),
            Err(_error) if attempt + 1 < MAX_PROVIDER_REQUEST_ATTEMPTS => {
                tokio::time::sleep(provider_retry_delay(&header::HeaderMap::new(), attempt)).await;
            }
            Err(_) => return Err(provider_unavailable(provider)),
        }
    }
    Err(provider_unavailable(provider))
}

fn provider_retry_delay(headers: &header::HeaderMap, attempt: usize) -> std::time::Duration {
    let seconds = headers
        .get(header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(1_u64 << attempt.min(5))
        .clamp(1, MAX_PROVIDER_RETRY_DELAY_SECONDS);
    std::time::Duration::from_secs(seconds)
}

fn provider_status_error(provider: &'static str, status: StatusCode) -> AppError {
    let suffix = if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        "CREDENTIAL_EXPIRED"
    } else if status == StatusCode::TOO_MANY_REQUESTS {
        "RATE_LIMITED"
    } else if status.is_server_error() {
        "UNAVAILABLE"
    } else {
        "REJECTED"
    };
    AppError::service_unavailable(
        provider_error_code(provider, suffix),
        match suffix {
            "CREDENTIAL_EXPIRED" => format!("{provider} credential is expired or unauthorized"),
            "RATE_LIMITED" => format!("{provider} rate limit remained active after retries"),
            "UNAVAILABLE" => format!("{provider} service is unavailable after retries"),
            _ => format!("{provider} request was rejected"),
        },
    )
}

fn provider_unavailable(provider: &'static str) -> AppError {
    AppError::service_unavailable(
        provider_error_code(provider, "UNAVAILABLE"),
        format!("{provider} service is unavailable after retries"),
    )
}

fn provider_error_code(provider: &str, suffix: &str) -> &'static str {
    match (provider, suffix) {
        ("ZENOTI", "CREDENTIAL_EXPIRED") => "ZENOTI_CREDENTIAL_EXPIRED",
        ("ZENOTI", "RATE_LIMITED") => "ZENOTI_RATE_LIMITED",
        ("ZENOTI", "REJECTED") => "ZENOTI_REJECTED",
        ("DINGG", "CREDENTIAL_EXPIRED") => "DINGG_CREDENTIAL_EXPIRED",
        ("DINGG", "RATE_LIMITED") => "DINGG_RATE_LIMITED",
        ("DINGG", "REJECTED") => "DINGG_REJECTED",
        ("DINGG", _) => "DINGG_UNAVAILABLE",
        _ => "ZENOTI_UNAVAILABLE",
    }
}

fn rows_csv(rows: &[Value]) -> Result<Vec<u8>, AppError> {
    let flattened = rows.iter().map(flatten_record).collect::<Vec<_>>();
    let headers = flattened
        .iter()
        .flat_map(|row| row.keys().cloned())
        .collect::<BTreeSet<_>>();
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(headers.iter())
        .map_err(|_| AppError::internal("failed to write provider CSV"))?;
    for row in flattened {
        writer
            .write_record(
                headers
                    .iter()
                    .map(|header| row.get(header).map(String::as_str).unwrap_or("")),
            )
            .map_err(|_| AppError::internal("failed to write provider CSV"))?;
    }
    writer
        .into_inner()
        .map_err(|_| AppError::internal("failed to finalize provider CSV"))
}

fn flatten_record(value: &Value) -> BTreeMap<String, String> {
    let mut result = BTreeMap::new();
    flatten_value("", value, &mut result);
    result
}

fn flatten_value(prefix: &str, value: &Value, output: &mut BTreeMap<String, String>) {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten_value(&path, child, output);
            }
        }
        Value::Array(items) => {
            output.insert(prefix.to_string(), value.to_string());
            if let Some(first) = items.first().filter(|item| item.is_object()) {
                flatten_value(prefix, first, output);
            }
        }
        Value::Null => {
            output.insert(prefix.to_string(), String::new());
        }
        _ => {
            let text = value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string());
            output.insert(prefix.to_string(), text.clone());
            if let Some(leaf) = prefix.rsplit('.').next().filter(|leaf| *leaf != prefix) {
                output.entry(leaf.to_string()).or_insert(text);
            }
        }
    }
}

fn provider_authorization(config: &Value, token: &str) -> Result<String, AppError> {
    match config
        .get("authScheme")
        .and_then(Value::as_str)
        .unwrap_or("bearer")
    {
        "api_key" => Ok(format!("apikey {token}")),
        "bearer" => Ok(format!("bearer {token}")),
        _ => Err(AppError::validation("provider authScheme is invalid")),
    }
}

fn validated_date_range(
    start: Option<&str>,
    end: Option<&str>,
) -> Result<(String, String), AppError> {
    match (
        start.map(str::trim).filter(|v| !v.is_empty()),
        end.map(str::trim).filter(|v| !v.is_empty()),
    ) {
        (None, None) => Ok((String::new(), String::new())),
        (Some(start), Some(end)) => {
            let start_date = NaiveDate::parse_from_str(start, "%Y-%m-%d")
                .map_err(|_| AppError::validation("startDate must use YYYY-MM-DD"))?;
            let end_date = NaiveDate::parse_from_str(end, "%Y-%m-%d")
                .map_err(|_| AppError::validation("endDate must use YYYY-MM-DD"))?;
            if end_date <= start_date {
                return Err(AppError::validation("endDate must be after startDate"));
            }
            Ok((start.into(), end.into()))
        }
        _ => Err(AppError::validation(
            "startDate and endDate must be supplied together",
        )),
    }
}

fn validate_export_url(value: &str) -> Result<Url, AppError> {
    let url =
        Url::parse(value.trim()).map_err(|_| AppError::validation("invalid DINGG exportUrl"))?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
        || url.fragment().is_some()
    {
        return Err(AppError::validation(
            "DINGG exportUrl must be a public HTTPS URL",
        ));
    }
    if matches!(url.host_str(), Some("localhost"))
        || url.host_str().is_some_and(|host| host.ends_with(".local"))
    {
        return Err(AppError::validation(
            "DINGG exportUrl must be a public HTTPS URL",
        ));
    }
    if url
        .host_str()
        .and_then(|host| host.parse::<IpAddr>().ok())
        .is_some_and(|ip| !is_public_ip(ip))
    {
        return Err(AppError::validation(
            "DINGG exportUrl must be a public HTTPS URL",
        ));
    }
    Ok(url)
}

async fn pinned_https_client(url: &Url) -> Result<reqwest::Client, AppError> {
    let host = url
        .host_str()
        .ok_or_else(|| AppError::validation("DINGG export host is missing"))?;
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "DINGG_DNS_FAILED",
                "DINGG export host could not be resolved",
            )
        })?
        .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err(AppError::validation(
            "DINGG exportUrl resolved to a non-public address",
        ));
    }
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(600))
        .resolve(host, SocketAddr::new(addresses[0].ip(), port))
        .build()
        .map_err(|_| AppError::internal("failed to initialize DINGG export client"))
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.is_unspecified()
                || ip.is_multicast())
        }
        IpAddr::V6(ip) => {
            let first = ip.segments()[0];
            !(ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
                || (first == 0x2001 && ip.segments()[1] == 0x0db8))
        }
    }
}

fn validate_source_file_name(value: &str) -> Result<(), AppError> {
    let path = Path::new(value);
    let valid_name = path.file_name().and_then(|name| name.to_str()) == Some(value);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !valid_name || !matches!(extension.as_str(), "xlsx" | "csv" | "zip") {
        return Err(AppError::validation(
            "sourceFileName must be a CSV, XLSX, or ZIP file name",
        ));
    }
    Ok(())
}

fn provider_temp_path(file_name: &str) -> Result<PathBuf, AppError> {
    validate_source_file_name(file_name)?;
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("bin");
    Ok(std::env::temp_dir().join(format!(
        "aurashine-migration-{}.{}",
        Uuid::new_v4(),
        extension
    )))
}

fn content_type_for(file_name: &str) -> &'static str {
    match Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "csv" => "text/csv",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "application/zip",
    }
}

async fn file_sha256(path: &Path) -> Result<String, AppError> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| AppError::internal("provider snapshot is unavailable"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; migration_file_service::MAX_PART_BYTES];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|_| AppError::internal("failed to hash provider snapshot"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_private_exports_and_flattens_nested_rows() {
        assert!(validate_export_url("https://127.0.0.1/export.xlsx").is_err());
        assert!(validate_export_url("https://exports.example.com/export.xlsx").is_ok());
        assert_eq!(
            provider_error_code("ZENOTI", "CREDENTIAL_EXPIRED"),
            "ZENOTI_CREDENTIAL_EXPIRED"
        );
        assert_eq!(
            provider_error_code("DINGG", "RATE_LIMITED"),
            "DINGG_RATE_LIMITED"
        );
        let mut headers = header::HeaderMap::new();
        headers.insert(header::RETRY_AFTER, header::HeaderValue::from_static("999"));
        assert_eq!(
            provider_retry_delay(&headers, 0),
            std::time::Duration::from_secs(MAX_PROVIDER_RETRY_DELAY_SECONDS)
        );
        let row = flatten_record(&json!({"personal_info":{"first_name":"Aftab"}}));
        assert_eq!(row.get("first_name").map(String::as_str), Some("Aftab"));
    }

    #[test]
    fn canonicalizes_zenoti_financial_rows_without_losing_source_fields() {
        let mut cards = vec![json!({
            "id":"card-1","code":"GC1","value":500.0,"balance":125.0,
            "sale_date":"2026-07-01","is_closed":false
        })];
        canonicalize_zenoti_rows("gift-cards.csv", &mut cards, "center-1", Some("guest-1"));
        assert_eq!(cards[0]["oldExternalId"], "card-1");
        assert_eq!(cards[0]["client"], "guest-1");
        assert_eq!(cards[0]["status"], "active");
        assert_eq!(cards[0]["value"], 500.0);

        let expanded = expand_zenoti_appointments(vec![json!({
            "id":"guest-1",
            "appointments":[{"appointment_segment_id":"appointment-1"}]
        })]);
        assert_eq!(expanded[0]["guest_id"], "guest-1");
        assert_eq!(expanded[0]["appointment_segment_id"], "appointment-1");
    }
}
