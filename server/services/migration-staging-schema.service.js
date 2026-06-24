import { db } from "../db.js";

let ready = false;

export function ensureMigrationStagingSchema() {
  if (ready) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_large_jobs (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL DEFAULT '',
      sourceSoftware TEXT NOT NULL DEFAULT '',
      resource TEXT NOT NULL DEFAULT 'auto',
      fileName TEXT NOT NULL DEFAULT '',
      fileSizeBytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      workerId TEXT NOT NULL DEFAULT '',
      lockedAt TEXT NOT NULL DEFAULT '',
      heartbeatAt TEXT NOT NULL DEFAULT '',
      totalRows INTEGER NOT NULL DEFAULT 0,
      processedRows INTEGER NOT NULL DEFAULT 0,
      validRows INTEGER NOT NULL DEFAULT 0,
      warningRows INTEGER NOT NULL DEFAULT 0,
      errorRows INTEGER NOT NULL DEFAULT 0,
      importedRows INTEGER NOT NULL DEFAULT 0,
      skippedRows INTEGER NOT NULL DEFAULT 0,
      currentChunk INTEGER NOT NULL DEFAULT 0,
      chunkSize INTEGER NOT NULL DEFAULT 5000,
      mapping TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL DEFAULT '{}',
      summary TEXT NOT NULL DEFAULT '{}',
      resumeToken TEXT NOT NULL DEFAULT '',
      createdBy TEXT NOT NULL DEFAULT '',
      approvedBy TEXT NOT NULL DEFAULT '',
      approvedAt TEXT NOT NULL DEFAULT '',
      startedAt TEXT NOT NULL DEFAULT '',
      completedAt TEXT NOT NULL DEFAULT '',
      failedAt TEXT NOT NULL DEFAULT '',
      failureReason TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS migration_file_chunks (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      jobId TEXT NOT NULL,
      chunkNumber INTEGER NOT NULL,
      sourceSheet TEXT NOT NULL DEFAULT '',
      rowStart INTEGER NOT NULL DEFAULT 0,
      rowEnd INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      totalRows INTEGER NOT NULL DEFAULT 0,
      processedRows INTEGER NOT NULL DEFAULT 0,
      validRows INTEGER NOT NULL DEFAULT 0,
      warningRows INTEGER NOT NULL DEFAULT 0,
      errorRows INTEGER NOT NULL DEFAULT 0,
      importedRows INTEGER NOT NULL DEFAULT 0,
      skippedRows INTEGER NOT NULL DEFAULT 0,
      checksum TEXT NOT NULL DEFAULT '',
      payloadRef TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '{}',
      startedAt TEXT NOT NULL DEFAULT '',
      completedAt TEXT NOT NULL DEFAULT '',
      failedAt TEXT NOT NULL DEFAULT '',
      failureReason TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE (tenantId, jobId, chunkNumber)
    );

    CREATE TABLE IF NOT EXISTS migration_staging_rows (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      jobId TEXT NOT NULL,
      chunkId TEXT NOT NULL DEFAULT '',
      chunkNumber INTEGER NOT NULL DEFAULT 0,
      resource TEXT NOT NULL DEFAULT '',
      sourceSheet TEXT NOT NULL DEFAULT '',
      sourceRowNumber INTEGER NOT NULL DEFAULT 0,
      sourceExternalId TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      action TEXT NOT NULL DEFAULT '',
      targetId TEXT NOT NULL DEFAULT '',
      duplicateKey TEXT NOT NULL DEFAULT '',
      duplicateDecision TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      raw TEXT NOT NULL DEFAULT '{}',
      errors TEXT NOT NULL DEFAULT '[]',
      warnings TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS migration_id_map (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      jobId TEXT NOT NULL DEFAULT '',
      sourceSoftware TEXT NOT NULL DEFAULT '',
      resource TEXT NOT NULL DEFAULT '',
      sourceExternalId TEXT NOT NULL DEFAULT '',
      targetId TEXT NOT NULL DEFAULT '',
      targetTable TEXT NOT NULL DEFAULT '',
      branchId TEXT NOT NULL DEFAULT '',
      confidence INTEGER NOT NULL DEFAULT 100,
      linkType TEXT NOT NULL DEFAULT 'created',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE (tenantId, jobId, resource, sourceExternalId)
    );

    CREATE TABLE IF NOT EXISTS migration_reconciliation_snapshots (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      jobId TEXT NOT NULL,
      branchId TEXT NOT NULL DEFAULT '',
      snapshotType TEXT NOT NULL DEFAULT 'pre_import',
      expected TEXT NOT NULL DEFAULT '{}',
      actual TEXT NOT NULL DEFAULT '{}',
      differences TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_migration_large_jobs_scope
      ON migration_large_jobs (tenantId, status, createdAt);
    CREATE INDEX IF NOT EXISTS idx_migration_file_chunks_job
      ON migration_file_chunks (tenantId, jobId, chunkNumber);
    CREATE INDEX IF NOT EXISTS idx_migration_staging_rows_job
      ON migration_staging_rows (tenantId, jobId, chunkNumber, sourceRowNumber);
    CREATE INDEX IF NOT EXISTS idx_migration_id_map_lookup
      ON migration_id_map (tenantId, resource, sourceExternalId);
    CREATE INDEX IF NOT EXISTS idx_migration_recon_job
      ON migration_reconciliation_snapshots (tenantId, jobId, snapshotType);
  `);
  ensureMigrationLargeJobColumns();
  ready = true;
}

function ensureMigrationLargeJobColumns() {
  const columns = new Set(db.prepare("PRAGMA table_info(migration_large_jobs)").all().map((column) => column.name));
  const requiredColumns = [
    ["workerId", "TEXT NOT NULL DEFAULT ''"],
    ["lockedAt", "TEXT NOT NULL DEFAULT ''"],
    ["heartbeatAt", "TEXT NOT NULL DEFAULT ''"]
  ];
  for (const [name, definition] of requiredColumns) {
    if (!columns.has(name)) {
      db.prepare(`ALTER TABLE migration_large_jobs ADD COLUMN ${name} ${definition}`).run();
    }
  }
  db.prepare("CREATE INDEX IF NOT EXISTS idx_migration_large_jobs_worker ON migration_large_jobs (status, lockedAt)").run();
}

