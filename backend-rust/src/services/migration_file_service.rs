use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
};

use axum::body::Bytes;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;
use zip::ZipArchive;

use crate::{
    models::{
        common::AppError,
        migration_file::{
            CompleteMigrationUploadRequest, CompleteMigrationUploadResponse,
            CreateMigrationUploadRequest, MigrationSourceArtifact, MigrationSourceFile,
            MigrationUploadPartReceipt, MigrationUploadSession,
        },
    },
    repositories::migration_file_repository::{self, NewSourceArtifact, NewSourceFile},
};

pub const MAX_PART_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILE_BYTES: i64 = 500 * 1024 * 1024;
const MAX_PARTS: i32 = 1000;
const MAX_ZIP_ENTRIES: usize = 300;
const MAX_ZIP_ENTRY_BYTES: u64 = 250 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 200;

struct PreparedArtifact {
    id: String,
    entry_name: String,
    format: String,
    content_type: String,
    size_bytes: i64,
    sha256: String,
    storage_key: String,
}

struct PreparedEvidence {
    source_id: String,
    storage_key: String,
    sha256: String,
    detected_content_type: String,
    manifest: Value,
    artifacts: Vec<PreparedArtifact>,
}

pub struct EvidenceDownload {
    pub file: tokio::fs::File,
    pub file_name: String,
    pub content_type: String,
    pub sha256: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone)]
pub struct WorkerSource {
    pub name: String,
    pub format: String,
    pub path: PathBuf,
}

pub async fn create_upload(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    request: CreateMigrationUploadRequest,
) -> Result<MigrationUploadSession, AppError> {
    let (file_name, extension) = validate_file_name(&request.file_name)?;
    if !(1..=MAX_FILE_BYTES).contains(&request.size_bytes) {
        return Err(AppError::validation(
            "file size must be between 1 byte and 500 MB",
        ));
    }
    if !(1..=MAX_PARTS).contains(&request.total_parts) {
        return Err(AppError::validation(
            "totalParts must be between 1 and 1000",
        ));
    }
    let minimum_parts = (request.size_bytes + MAX_PART_BYTES as i64 - 1) / MAX_PART_BYTES as i64;
    if request.total_parts < minimum_parts as i32 || request.total_parts as i64 > request.size_bytes
    {
        return Err(AppError::validation(
            "totalParts does not match the file size limits",
        ));
    }
    let content_type = normalize_content_type(request.content_type.as_deref());
    validate_declared_content_type(&extension, &content_type)?;
    let expected_sha256 = normalize_sha256(request.expected_sha256.as_deref())?;
    let row = migration_file_repository::create_session(
        db,
        tenant_id,
        branch_id,
        actor,
        &file_name,
        &extension,
        &content_type,
        request.size_bytes,
        request.total_parts,
        &expected_sha256,
    )
    .await
    .map_err(|_| AppError::internal("failed to create migration upload session"))?;
    Ok(session_model(row, Vec::new()))
}

pub async fn get_upload(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<MigrationUploadSession, AppError> {
    let row = migration_file_repository::get_session(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration upload session"))?
        .ok_or_else(|| AppError::not_found("migration upload session was not found"))?;
    let parts = migration_file_repository::list_parts(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration upload parts"))?;
    Ok(session_model(row, parts))
}

pub async fn upload_part(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    part_number: i32,
    expected_part_sha256: Option<&str>,
    bytes: Bytes,
) -> Result<MigrationUploadPartReceipt, AppError> {
    let session = migration_file_repository::get_session(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration upload session"))?
        .ok_or_else(|| AppError::not_found("migration upload session was not found"))?;
    if session.status != "open" || session.expires_at <= chrono::Utc::now() {
        return Err(AppError::conflict("migration upload session is not open"));
    }
    if part_number < 1 || part_number > session.total_parts {
        return Err(AppError::validation(
            "part number is outside the upload manifest",
        ));
    }
    if bytes.is_empty() || bytes.len() > MAX_PART_BYTES {
        return Err(AppError::validation(
            "upload part must be between 1 byte and 8 MB",
        ));
    }
    let sha256 = sha256_hex(&bytes);
    let expected = normalize_sha256(expected_part_sha256)?;
    if !expected.is_empty() && expected != sha256 {
        return Err(AppError::validation("upload part SHA-256 does not match"));
    }
    if let Some(existing) =
        migration_file_repository::get_part(db, tenant_id, branch_id, id, part_number)
            .await
            .map_err(|_| AppError::internal("failed to check migration upload part"))?
    {
        if existing.sha256 != sha256 || existing.size_bytes != bytes.len() as i64 {
            return Err(AppError::conflict(
                "this upload part already exists with different content",
            ));
        }
        let session = get_upload(db, tenant_id, branch_id, id).await?;
        return Ok(MigrationUploadPartReceipt {
            session,
            part_number,
            part_size_bytes: existing.size_bytes,
            part_sha256: existing.sha256,
            replayed: true,
        });
    }

    let key = part_storage_key(tenant_id, branch_id, id, part_number)?;
    let path = storage_path(&key, false)?;
    atomic_write(&path, &bytes).await?;
    let inserted = migration_file_repository::insert_part(
        db,
        tenant_id,
        branch_id,
        id,
        part_number,
        bytes.len() as i64,
        &sha256,
        &key,
    )
    .await
    .map_err(|_| AppError::internal("failed to record migration upload part"))?;
    if !inserted {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(AppError::conflict(
            "upload part exceeds the session manifest or the session changed",
        ));
    }
    let session = get_upload(db, tenant_id, branch_id, id).await?;
    Ok(MigrationUploadPartReceipt {
        session,
        part_number,
        part_size_bytes: bytes.len() as i64,
        part_sha256: sha256,
        replayed: false,
    })
}

pub async fn complete_upload(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    id: &str,
    request: CompleteMigrationUploadRequest,
) -> Result<CompleteMigrationUploadResponse, AppError> {
    if let Some(done) = migration_file_repository::get_session(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration upload session"))?
        .filter(|row| row.status == "completed")
    {
        let source_id = done
            .source_file_id
            .ok_or_else(|| AppError::internal("completed upload has no source evidence"))?;
        return Ok(CompleteMigrationUploadResponse {
            session: get_upload(db, tenant_id, branch_id, id).await?,
            source_file: get_source_file(db, tenant_id, branch_id, &source_id).await?,
        });
    }
    let session = migration_file_repository::claim_completion(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to claim migration upload session"))?
        .ok_or_else(|| AppError::conflict("migration upload session cannot be completed"))?;
    let parts = migration_file_repository::list_parts(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration upload parts"))?;
    let request_hash = normalize_sha256(request.expected_sha256.as_deref())?;
    let expected_hash = if request_hash.is_empty() {
        session.expected_sha256.clone()
    } else {
        request_hash
    };
    let root = storage_root()?;
    let tenant = tenant_id.to_string();
    let branch = branch_id.to_string();
    let blocking_session = session.clone();
    let prepared = tokio::task::spawn_blocking(move || {
        prepare_evidence(
            &root,
            &tenant,
            &branch,
            &blocking_session,
            &parts,
            &expected_hash,
        )
    })
    .await
    .map_err(|_| AppError::internal("migration evidence worker stopped"))?;
    let prepared = match prepared {
        Ok(value) => value,
        Err(message) => {
            let _ = migration_file_repository::release_completion(
                db, tenant_id, branch_id, id, &message,
            )
            .await;
            return Err(AppError::validation(message));
        }
    };
    let source = NewSourceFile {
        id: &prepared.source_id,
        original_file_name: &session.original_file_name,
        file_extension: &session.file_extension,
        declared_content_type: &session.declared_content_type,
        detected_content_type: &prepared.detected_content_type,
        file_format: &session.file_extension,
        size_bytes: session.expected_size_bytes,
        sha256: &prepared.sha256,
        storage_key: &prepared.storage_key,
        manifest_json: &prepared.manifest,
    };
    let artifacts = prepared
        .artifacts
        .iter()
        .map(|item| NewSourceArtifact {
            id: &item.id,
            entry_name: &item.entry_name,
            file_format: &item.format,
            detected_content_type: &item.content_type,
            size_bytes: item.size_bytes,
            sha256: &item.sha256,
            storage_key: &item.storage_key,
        })
        .collect::<Vec<_>>();
    if migration_file_repository::complete_session(
        db, tenant_id, branch_id, actor, id, &source, &artifacts,
    )
    .await
    .is_err()
    {
        cleanup_prepared(&prepared);
        let _ = migration_file_repository::release_completion(
            db,
            tenant_id,
            branch_id,
            id,
            "failed to persist source evidence",
        )
        .await;
        return Err(AppError::internal(
            "failed to persist migration source evidence",
        ));
    }
    remove_session_parts(tenant_id, branch_id, id).await;
    Ok(CompleteMigrationUploadResponse {
        session: get_upload(db, tenant_id, branch_id, id).await?,
        source_file: get_source_file(db, tenant_id, branch_id, &prepared.source_id).await?,
    })
}

pub async fn list_source_files(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<MigrationSourceFile>, AppError> {
    let rows = migration_file_repository::list_source_files(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list migration source evidence"))?;
    let artifacts = migration_file_repository::list_scope_artifacts(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list migration source artifacts"))?;
    let mut grouped = HashMap::<String, Vec<_>>::new();
    for artifact in artifacts {
        grouped
            .entry(artifact.source_file_id.clone())
            .or_default()
            .push(artifact);
    }
    Ok(rows
        .into_iter()
        .map(|row| {
            let row_artifacts = grouped.remove(&row.id).unwrap_or_default();
            source_model(row, row_artifacts)
        })
        .collect())
}

pub async fn get_source_file(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<MigrationSourceFile, AppError> {
    let row = migration_file_repository::get_source_file(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration source evidence"))?
        .ok_or_else(|| AppError::not_found("migration source evidence was not found"))?;
    let artifacts = migration_file_repository::list_artifacts(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration source artifacts"))?;
    Ok(source_model(row, artifacts))
}

pub async fn open_evidence(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    id: &str,
) -> Result<EvidenceDownload, AppError> {
    let row = migration_file_repository::get_source_file(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration source evidence"))?
        .ok_or_else(|| AppError::not_found("migration source evidence was not found"))?;
    let path = storage_path(&row.storage_key, true)?;
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| AppError::not_found("migration source evidence file is unavailable"))?;
    migration_file_repository::audit_evidence_read(db, tenant_id, branch_id, actor, id)
        .await
        .map_err(|_| AppError::internal("failed to audit migration evidence access"))?;
    Ok(EvidenceDownload {
        file,
        file_name: row.original_file_name,
        content_type: row.detected_content_type,
        sha256: row.sha256,
        size_bytes: row.size_bytes,
    })
}

pub async fn worker_sources(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<(String, String, Vec<WorkerSource>), AppError> {
    let row = migration_file_repository::get_source_file(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration source evidence"))?
        .ok_or_else(|| AppError::not_found("migration source evidence was not found"))?;
    if row.evidence_status != "verified" || !row.read_only {
        return Err(AppError::conflict(
            "migration source evidence is not verified",
        ));
    }
    let sources = if row.file_format == "zip" {
        migration_file_repository::list_artifacts(db, tenant_id, branch_id, id)
            .await
            .map_err(|_| AppError::internal("failed to load migration source artifacts"))?
            .into_iter()
            .map(|item| {
                Ok(WorkerSource {
                    name: item.entry_name,
                    format: item.file_format,
                    path: storage_path(&item.storage_key, true)?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?
    } else {
        vec![WorkerSource {
            name: row.original_file_name.clone(),
            format: row.file_format.clone(),
            path: storage_path(&row.storage_key, true)?,
        }]
    };
    if sources.is_empty() {
        return Err(AppError::validation(
            "migration source contains no importable files",
        ));
    }
    Ok((row.original_file_name, row.sha256, sources))
}

fn session_model(
    row: migration_file_repository::UploadSessionRow,
    parts: Vec<migration_file_repository::UploadPartRow>,
) -> MigrationUploadSession {
    let received = parts
        .iter()
        .map(|part| part.part_number)
        .collect::<HashSet<_>>();
    let missing_parts = (1..=row.total_parts)
        .filter(|part| !received.contains(part))
        .collect::<Vec<_>>();
    let resume_available =
        row.status == "open" && !missing_parts.is_empty() && row.expires_at > chrono::Utc::now();
    MigrationUploadSession {
        id: row.id,
        file_name: row.original_file_name,
        extension: row.file_extension,
        declared_content_type: row.declared_content_type,
        expected_size_bytes: row.expected_size_bytes,
        expected_sha256: row.expected_sha256,
        total_parts: row.total_parts,
        received_parts: row.received_parts,
        received_bytes: row.received_bytes,
        missing_parts,
        status: row.status,
        source_file_id: row.source_file_id,
        last_error: row.last_error,
        resume_available,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        completed_at: row.completed_at,
    }
}

fn source_model(
    row: migration_file_repository::SourceFileRow,
    artifacts: Vec<migration_file_repository::SourceArtifactRow>,
) -> MigrationSourceFile {
    MigrationSourceFile {
        id: row.id,
        upload_session_id: row.upload_session_id,
        original_file_name: row.original_file_name,
        extension: row.file_extension,
        declared_content_type: row.declared_content_type,
        detected_content_type: row.detected_content_type,
        format: row.file_format,
        size_bytes: row.size_bytes,
        sha256: row.sha256,
        evidence_status: row.evidence_status,
        read_only: row.read_only,
        manifest: row.manifest_json,
        artifacts: artifacts
            .into_iter()
            .map(|item| MigrationSourceArtifact {
                id: item.id,
                entry_name: item.entry_name,
                format: item.file_format,
                detected_content_type: item.detected_content_type,
                size_bytes: item.size_bytes,
                sha256: item.sha256,
            })
            .collect(),
        created_at: row.created_at,
    }
}

fn validate_file_name(value: &str) -> Result<(String, String), AppError> {
    let name = value.trim();
    if name.is_empty()
        || !name.is_ascii()
        || name.chars().count() > 180
        || name.chars().any(char::is_control)
        || name.contains(['/', '\\', '<', '>', ':', '"', '|', '?', '*'])
        || name.starts_with(['.', ' '])
        || name.ends_with(['.', ' '])
        || Path::new(name).file_name().and_then(|part| part.to_str()) != Some(name)
    {
        return Err(AppError::validation("invalid migration source filename"));
    }
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "csv" | "xlsx" | "zip") {
        return Err(AppError::validation(
            "only CSV, XLSX and ZIP files are supported",
        ));
    }
    let stem = Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim_end_matches(['.', ' '])
        .to_ascii_uppercase();
    let reserved = matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if reserved {
        return Err(AppError::validation("reserved filenames are not allowed"));
    }
    Ok((name.to_string(), extension))
}

fn normalize_content_type(value: Option<&str>) -> String {
    value
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

fn validate_declared_content_type(extension: &str, content_type: &str) -> Result<(), AppError> {
    let valid = match extension {
        "csv" => matches!(
            content_type,
            "text/csv" | "application/csv" | "text/plain" | "application/octet-stream"
        ),
        "xlsx" => matches!(
            content_type,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                | "application/octet-stream"
        ),
        "zip" => matches!(
            content_type,
            "application/zip" | "application/x-zip-compressed" | "application/octet-stream"
        ),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(AppError::validation(
            "declared content type does not match the file extension",
        ))
    }
}

fn normalize_sha256(value: Option<&str>) -> Result<String, AppError> {
    let value = value.unwrap_or("").trim().to_ascii_lowercase();
    if value.is_empty() || (value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        Ok(value)
    } else {
        Err(AppError::validation(
            "SHA-256 must be 64 hexadecimal characters",
        ))
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn scope_key(tenant_id: &str, branch_id: &str) -> String {
    sha256_hex(format!("{tenant_id}\0{branch_id}").as_bytes())[..32].to_string()
}

fn safe_id(value: &str) -> Result<&str, AppError> {
    if !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        Ok(value)
    } else {
        Err(AppError::validation("invalid migration storage identifier"))
    }
}

fn part_storage_key(
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    part_number: i32,
) -> Result<String, AppError> {
    Ok(format!(
        "{}/sessions/{}/part-{part_number:06}.bin",
        scope_key(tenant_id, branch_id),
        safe_id(id)?
    ))
}

fn storage_root() -> Result<PathBuf, AppError> {
    let root = std::env::var_os("MIGRATION_FILE_STORAGE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("data")
                .join("migration-files")
        });
    fs::create_dir_all(&root)
        .map_err(|_| AppError::internal("migration file storage is unavailable"))?;
    root.canonicalize()
        .map_err(|_| AppError::internal("migration file storage path is invalid"))
}

fn storage_path(key: &str, must_exist: bool) -> Result<PathBuf, AppError> {
    if key.is_empty()
        || Path::new(key).is_absolute()
        || Path::new(key)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(AppError::validation("invalid migration storage path"));
    }
    let root = storage_root()?;
    let path = root.join(key);
    if must_exist {
        let canonical = path
            .canonicalize()
            .map_err(|_| AppError::not_found("migration evidence file is unavailable"))?;
        if !canonical.starts_with(&root) {
            return Err(AppError::forbidden(
                "migration evidence path is outside storage",
            ));
        }
        Ok(canonical)
    } else {
        let parent = path
            .parent()
            .ok_or_else(|| AppError::validation("invalid migration storage path"))?;
        fs::create_dir_all(parent)
            .map_err(|_| AppError::internal("migration storage directory could not be created"))?;
        let parent = parent
            .canonicalize()
            .map_err(|_| AppError::internal("migration storage directory is invalid"))?;
        if !parent.starts_with(&root) {
            return Err(AppError::forbidden(
                "migration storage path is outside storage",
            ));
        }
        Ok(path)
    }
}

async fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let temp = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    let mut file = tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp)
        .await
        .map_err(|_| AppError::internal("migration upload part could not be created"))?;
    if file.write_all(bytes).await.is_err() || file.sync_all().await.is_err() {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(AppError::internal(
            "migration upload part could not be stored",
        ));
    }
    drop(file);
    if tokio::fs::hard_link(&temp, path).await.is_err() {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(AppError::conflict(
            "migration upload part is already being stored",
        ));
    }
    let _ = tokio::fs::remove_file(&temp).await;
    Ok(())
}

fn prepare_evidence(
    root: &Path,
    tenant_id: &str,
    branch_id: &str,
    session: &migration_file_repository::UploadSessionRow,
    parts: &[migration_file_repository::UploadPartRow],
    expected_sha256: &str,
) -> Result<PreparedEvidence, String> {
    if parts.len() != session.total_parts as usize {
        return Err("migration upload is missing parts".into());
    }
    let source_id = Uuid::new_v4().to_string();
    let scope = scope_key(tenant_id, branch_id);
    let evidence_dir = root.join(&scope).join("evidence");
    let artifact_dir = root.join(&scope).join("artifacts").join(&source_id);
    fs::create_dir_all(&evidence_dir)
        .map_err(|_| "source evidence directory could not be created")?;
    let temp_path = evidence_dir.join(format!(".{source_id}.assembling"));
    let final_path = evidence_dir.join(format!("{source_id}.{}", session.file_extension));
    let result = (|| {
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .map_err(|_| "source evidence could not be assembled")?;
        let mut full_hash = Sha256::new();
        let mut total = 0_i64;
        for (index, part) in parts.iter().enumerate() {
            if part.part_number != index as i32 + 1 {
                return Err("migration upload parts must be contiguous".into());
            }
            let path = confined_existing_path(root, &part.storage_key)?;
            let mut input = File::open(path).map_err(|_| "migration upload part is unavailable")?;
            let mut part_hash = Sha256::new();
            let mut part_size = 0_i64;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let read = input
                    .read(&mut buffer)
                    .map_err(|_| "migration upload part could not be read")?;
                if read == 0 {
                    break;
                }
                part_size += read as i64;
                total += read as i64;
                if total > session.expected_size_bytes {
                    return Err("assembled file exceeds the upload manifest".into());
                }
                part_hash.update(&buffer[..read]);
                full_hash.update(&buffer[..read]);
                output
                    .write_all(&buffer[..read])
                    .map_err(|_| "source evidence could not be assembled")?;
            }
            if part_size != part.size_bytes || format!("{:x}", part_hash.finalize()) != part.sha256
            {
                return Err("migration upload part integrity check failed".into());
            }
        }
        output
            .sync_all()
            .map_err(|_| "source evidence could not be synced")?;
        drop(output);
        if total != session.expected_size_bytes {
            return Err("assembled file size does not match the upload manifest".into());
        }
        let sha256 = format!("{:x}", full_hash.finalize());
        if !expected_sha256.is_empty() && sha256 != expected_sha256 {
            return Err("source file SHA-256 does not match the upload manifest".into());
        }
        let (detected_content_type, manifest, artifacts) = inspect_source(
            &temp_path,
            &session.file_extension,
            &artifact_dir,
            &format!("{scope}/artifacts/{source_id}"),
        )?;
        fs::rename(&temp_path, &final_path)
            .map_err(|_| "source evidence could not be finalized")?;
        set_read_only(&final_path)?;
        Ok(PreparedEvidence {
            storage_key: format!("{scope}/evidence/{source_id}.{}", session.file_extension),
            source_id,
            sha256,
            detected_content_type,
            manifest,
            artifacts,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
        remove_read_only_dir(&artifact_dir);
    }
    result
}

fn inspect_source(
    path: &Path,
    extension: &str,
    artifact_dir: &Path,
    artifact_key: &str,
) -> Result<(String, Value, Vec<PreparedArtifact>), String> {
    if extension == "zip" {
        validate_zip_magic(path)?;
    }
    match extension {
        "csv" => {
            validate_csv(path)?;
            Ok((
                "text/csv".into(),
                json!({"format":"csv","zipEntryCount":0,"extractedBytes":0}),
                Vec::new(),
            ))
        }
        "xlsx" => {
            let summary = validate_xlsx(path)?;
            Ok((
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into(),
                json!({"format":"xlsx","workbookEntries":summary.0,"workbookUncompressedBytes":summary.1}),
                Vec::new(),
            ))
        }
        "zip" => {
            let artifacts = extract_zip(path, artifact_dir, artifact_key)?;
            let extracted_bytes: i64 = artifacts.iter().map(|item| item.size_bytes).sum();
            Ok((
                "application/zip".into(),
                json!({"format":"zip","zipEntryCount":artifacts.len(),"extractedBytes":extracted_bytes,"limits":{"maxEntries":MAX_ZIP_ENTRIES,"maxEntryBytes":MAX_ZIP_ENTRY_BYTES,"maxTotalBytes":MAX_ZIP_TOTAL_BYTES,"maxCompressionRatio":MAX_COMPRESSION_RATIO}}),
                artifacts,
            ))
        }
        _ => Err("unsupported migration source format".into()),
    }
}

fn validate_csv(path: &Path) -> Result<(), String> {
    let mut file = File::open(path).map_err(|_| "CSV source could not be opened")?;
    let mut carry = Vec::new();
    let mut saw_content = false;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "CSV source could not be read")?;
        if read == 0 {
            break;
        }
        if !saw_content && has_binary_magic(&buffer[..read]) {
            return Err("CSV content has a binary file signature".into());
        }
        if buffer[..read].contains(&0) {
            return Err("CSV content contains binary NUL bytes".into());
        }
        saw_content |= buffer[..read]
            .iter()
            .any(|byte| !byte.is_ascii_whitespace());
        carry.extend_from_slice(&buffer[..read]);
        match std::str::from_utf8(&carry) {
            Ok(_) => carry.clear(),
            Err(error) if error.error_len().is_none() => {
                let suffix = carry.split_off(error.valid_up_to());
                carry = suffix;
                if carry.len() > 3 {
                    return Err("CSV content is not valid UTF-8".into());
                }
            }
            Err(_) => return Err("CSV content is not valid UTF-8".into()),
        }
    }
    if !carry.is_empty() || !saw_content {
        return Err("CSV content is empty or not valid UTF-8".into());
    }
    Ok(())
}

fn validate_zip_magic(path: &Path) -> Result<(), String> {
    let mut file = File::open(path).map_err(|_| "archive source could not be opened")?;
    let mut magic = [0_u8; 4];
    file.read_exact(&mut magic)
        .map_err(|_| "archive source is missing its ZIP signature")?;
    if matches!(
        magic,
        [0x50, 0x4b, 0x03, 0x04] | [0x50, 0x4b, 0x05, 0x06] | [0x50, 0x4b, 0x07, 0x08]
    ) {
        Ok(())
    } else {
        Err("archive content does not have a ZIP magic signature".into())
    }
}

fn has_binary_magic(bytes: &[u8]) -> bool {
    [
        &[0x50, 0x4b][..],
        &[0x25, 0x50, 0x44, 0x46],
        &[0x89, 0x50, 0x4e, 0x47],
        &[0xff, 0xd8, 0xff],
        &[0x47, 0x49, 0x46, 0x38],
        &[0x1f, 0x8b],
        &[0x52, 0x61, 0x72, 0x21],
        &[0x42, 0x4d],
    ]
    .iter()
    .any(|magic| bytes.starts_with(magic))
}

fn validate_xlsx(path: &Path) -> Result<(usize, u64), String> {
    validate_zip_magic(path)?;
    let file = File::open(path).map_err(|_| "XLSX source could not be opened")?;
    let mut archive =
        ZipArchive::new(file).map_err(|_| "XLSX content is not a valid OOXML ZIP archive")?;
    if archive.len() > 10_000 {
        return Err("XLSX archive has too many entries".into());
    }
    let mut names = HashSet::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| "XLSX archive entry could not be read")?;
        let name = entry
            .enclosed_name()
            .ok_or("XLSX archive contains an unsafe path")?
            .to_string_lossy()
            .replace('\\', "/");
        total = total
            .checked_add(entry.size())
            .ok_or("XLSX archive size overflow")?;
        if total > MAX_ZIP_TOTAL_BYTES {
            return Err("XLSX uncompressed size exceeds the limit".into());
        }
        assert_safe_ratio(entry.size(), entry.compressed_size())?;
        names.insert(name);
    }
    if !names.contains("[Content_Types].xml")
        || !names.contains("_rels/.rels")
        || !names.contains("xl/workbook.xml")
    {
        return Err("XLSX content is missing required workbook records".into());
    }
    Ok((archive.len(), total))
}

fn extract_zip(
    path: &Path,
    artifact_dir: &Path,
    artifact_key: &str,
) -> Result<Vec<PreparedArtifact>, String> {
    let file = File::open(path).map_err(|_| "ZIP source could not be opened")?;
    let mut archive = ZipArchive::new(file).map_err(|_| "ZIP content is not a valid archive")?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err("ZIP archive exceeds the 300-entry limit".into());
    }
    fs::create_dir_all(artifact_dir)
        .map_err(|_| "ZIP extraction directory could not be created")?;
    let mut total = 0_u64;
    let mut names = HashSet::new();
    let mut artifacts = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| "ZIP entry could not be read")?;
        if entry.is_dir() {
            continue;
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or("ZIP archive contains an unsafe path")?;
        let entry_name = enclosed.to_string_lossy().replace('\\', "/");
        if !names.insert(entry_name.clone()) {
            return Err("ZIP archive contains duplicate entry names".into());
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("ZIP symbolic links are not allowed".into());
        }
        let extension = enclosed
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(extension.as_str(), "csv" | "xlsx") {
            return Err(format!("unsupported ZIP entry: {entry_name}"));
        }
        let declared_size = entry.size();
        if declared_size == 0 || declared_size > MAX_ZIP_ENTRY_BYTES {
            return Err(format!("ZIP entry exceeds the size limit: {entry_name}"));
        }
        assert_safe_ratio(declared_size, entry.compressed_size())?;
        total = total
            .checked_add(declared_size)
            .ok_or("ZIP extracted size overflow")?;
        if total > MAX_ZIP_TOTAL_BYTES {
            return Err("ZIP extracted size exceeds the 1 GB limit".into());
        }
        let id = Uuid::new_v4().to_string();
        let output_path = artifact_dir.join(format!("{id}.{extension}"));
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&output_path)
            .map_err(|_| "ZIP entry could not be extracted")?;
        let copied = io::copy(
            &mut entry.by_ref().take(MAX_ZIP_ENTRY_BYTES + 1),
            &mut output,
        )
        .map_err(|_| "ZIP entry extraction failed")?;
        output
            .sync_all()
            .map_err(|_| "ZIP entry could not be synced")?;
        drop(output);
        if copied != declared_size {
            return Err("ZIP entry size does not match its manifest".into());
        }
        let (content_type, format) = if extension == "csv" {
            validate_csv(&output_path)?;
            ("text/csv", "csv")
        } else {
            validate_xlsx(&output_path)?;
            (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "xlsx",
            )
        };
        let sha256 = hash_file(&output_path)?;
        set_read_only(&output_path)?;
        artifacts.push(PreparedArtifact {
            id: id.clone(),
            entry_name,
            format: format.into(),
            content_type: content_type.into(),
            size_bytes: copied as i64,
            sha256,
            storage_key: format!("{artifact_key}/{id}.{extension}"),
        });
    }
    if artifacts.is_empty() {
        return Err("ZIP archive contains no CSV or XLSX source files".into());
    }
    Ok(artifacts)
}

fn assert_safe_ratio(size: u64, compressed: u64) -> Result<(), String> {
    if size > 0 && (compressed == 0 || size / compressed.max(1) > MAX_COMPRESSION_RATIO) {
        Err("archive compression ratio exceeds the safety limit".into())
    } else {
        Ok(())
    }
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "evidence artifact could not be opened")?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "evidence artifact could not be read")?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn set_read_only(path: &Path) -> Result<(), String> {
    let mut permissions = fs::metadata(path)
        .map_err(|_| "evidence permissions could not be read".to_string())?
        .permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions)
        .map_err(|_| "evidence could not be made read-only".to_string())
}

fn confined_existing_path(root: &Path, key: &str) -> Result<PathBuf, String> {
    if key.is_empty()
        || Path::new(key).is_absolute()
        || Path::new(key)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("invalid stored upload path".into());
    }
    let path = root
        .join(key)
        .canonicalize()
        .map_err(|_| "stored upload part is unavailable")?;
    if !path.starts_with(root) {
        return Err("stored upload path escaped the migration root".into());
    }
    Ok(path)
}

fn cleanup_prepared(prepared: &PreparedEvidence) {
    if let Ok(path) = storage_path(&prepared.storage_key, true) {
        remove_read_only_file(&path);
    }
    for artifact in &prepared.artifacts {
        if let Ok(path) = storage_path(&artifact.storage_key, true) {
            remove_read_only_file(&path);
            if let Some(parent) = path.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
    }
}

fn remove_read_only_file(path: &Path) {
    if let Ok(metadata) = fs::metadata(path) {
        let mut permissions = metadata.permissions();
        permissions.set_readonly(false);
        let _ = fs::set_permissions(path, permissions);
    }
    let _ = fs::remove_file(path);
}

fn remove_read_only_dir(path: &Path) {
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            remove_read_only_file(&entry.path());
        }
    }
    let _ = fs::remove_dir(path);
}

async fn remove_session_parts(tenant_id: &str, branch_id: &str, id: &str) {
    let key = format!("{}/sessions/{}", scope_key(tenant_id, branch_id), id);
    if let Ok(path) = storage_path(&key, false) {
        let _ = tokio::fs::remove_dir_all(path).await;
    }
}

#[cfg(test)]
mod tests {
    use super::{assert_safe_ratio, has_binary_magic, normalize_sha256, validate_file_name};

    #[test]
    fn file_intake_rejects_traversal_reserved_names_bad_hashes_and_zip_bombs() {
        assert!(validate_file_name("clients.csv").is_ok());
        assert!(validate_file_name("../clients.csv").is_err());
        assert!(validate_file_name("CON.csv").is_err());
        assert!(validate_file_name("clients.exe").is_err());
        assert!(normalize_sha256(Some(&"a".repeat(64))).is_ok());
        assert!(normalize_sha256(Some("not-a-hash")).is_err());
        assert!(assert_safe_ratio(200, 1).is_ok());
        assert!(assert_safe_ratio(201, 1).is_err());
        assert!(has_binary_magic(b"%PDF-1.7"));
        assert!(!has_binary_magic(b"name,email\r\n"));
    }
}
