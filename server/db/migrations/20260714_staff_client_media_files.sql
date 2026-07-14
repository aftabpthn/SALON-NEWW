CREATE TABLE IF NOT EXISTS staffClientMedia (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  clientId TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'photo',
  url TEXT DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staffClientMediaFiles (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  mediaId TEXT NOT NULL,
  clientId TEXT NOT NULL,
  storageName TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  byteSize INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  UNIQUE(tenantId, branchId, clientId, sha256, title, type),
  UNIQUE(tenantId, branchId, storageName),
  FOREIGN KEY(mediaId) REFERENCES staffClientMedia(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS staffSelfAudit (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  staffId TEXT NOT NULL,
  action TEXT NOT NULL,
  targetType TEXT DEFAULT '',
  targetId TEXT DEFAULT '',
  detailsJson TEXT DEFAULT '{}',
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staffClientMediaFiles_media
  ON staffClientMediaFiles(tenantId, branchId, mediaId);
