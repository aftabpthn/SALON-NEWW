import { createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import readline from "node:readline";
import XLSX from "xlsx";
import { dataDir, db } from "../db.js";
import { badRequest } from "../utils/app-error.js";
import { extractZipEntries } from "../utils/zip-archive.js";
import { migrationUploadStore } from "./migration-upload-store.service.js";
import { migrationService } from "./migration.service.js";

const CHUNK_SIZE = 5000;
// Must match ANALYZER_FIX_VERSION in migration.service.js. Jobs whose stored
// summary doesn't carry this version were analyzed by the old code and are
// never reused — a re-upload re-analyzes fresh.
const CURRENT_ANALYZER_FIX_VERSION = "2026-06-large-xref-invoicekey-1";
const MAX_LARGE_FILE_BYTES = Number(process.env.MIGRATION_LARGE_UPLOAD_MAX_BYTES || 500 * 1024 * 1024);
const MAX_ZIP_ENTRIES = 300;
const MAX_ZIP_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".csv", ".xls", ".xlsx", ".zip"]);
const SOURCE_KEYS = new Set(["zenoti", "salonist", "dingg", "fresha", "tally", "busy", "marg", "excel", "csv", "manual"]);
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;

const ACCEPTED_CONTENT_TYPES = new Set([
  "text/csv", "application/csv",
  "application/zip", "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream"
]);

const ZIP_MAGIC = Buffer.from([0x50, 0x4b]);

function safeMigrationFileName(name) {
  if (!name || typeof name !== "string") return "untitled";
  let safe = String(name).replace(/\0/g, "");
  safe = safe.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  safe = safe.replace(/[/\\]+/g, "_");
  safe = safe.replace(/\.\.(?:_|\/|\\)/g, "");
  safe = safe.replace(/\.\./g, "");
  safe = safe.replace(/[<>:"|?*]/g, "_");
  safe = safe.replace(/^[.\s\-]+|[.\s\-]+$/g, "");
  return safe || "untitled";
}

function getFileMagic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return Buffer.alloc(0);
  return buffer.subarray(0, 4);
}

function isValidUtf8Text(buffer, sampleSize = 512) {
  const sample = buffer.subarray(0, Math.min(sampleSize, buffer.length));
  const binaryMagicPrefixes = [
    Buffer.from([0x50, 0x4b]),      // ZIP
    Buffer.from([0x89, 0x50]),      // PNG
    Buffer.from([0xff, 0xd8]),      // JPEG
    Buffer.from([0x47, 0x49]),      // GIF
    Buffer.from([0x25, 0x50]),      // PDF
    Buffer.from([0x7b, 0x5c]),      // RTF
    Buffer.from([0x42, 0x4d]),      // BMP
    Buffer.from([0x00, 0x00]),      // Various binary
    Buffer.from([0x1f, 0x8b]),      // GZIP
    Buffer.from([0x52, 0x61]),      // RAR
  ];
  for (const magic of binaryMagicPrefixes) {
    if (sample.length >= 2 && sample[0] === magic[0] && sample[1] === magic[1]) return false;
  }
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0x00 && (i === 0 || sample[i - 1] !== 0x0d)) return false;
  }
  return true;
}

function assertFileMagic(fileBuffer, ext) {
  const magic = getFileMagic(fileBuffer);
  if (ext === ".zip" || ext === ".xlsx" || ext === ".xls") {
    if (magic.length < 2 || magic[0] !== ZIP_MAGIC[0] || magic[1] !== ZIP_MAGIC[1]) {
      throw badRequest(`File content does not match expected format for ${ext.toUpperCase()} files.`);
    }
  }
  if (ext === ".csv") {
    if (!isValidUtf8Text(fileBuffer)) {
      throw badRequest("CSV file content is not valid text or appears to be a binary file.");
    }
  }
}

function isCsvFile(name) { return /\.csv$/i.test(name); }
function isSpreadsheetFile(name) { return /\.(xlsx|xls)$/i.test(name); }

function now() { return new Date().toISOString(); }

function existingLargeJobForUpload(upload, options = {}, access = {}) {
  const sourceSoftware = sourceKey(options.sourceSoftware);
  const resource = cleanText(options.resource) || "auto";
  const branchId = cleanText(options.branchId) || access.branchId || "";
  const job = db.prepare(`
    SELECT * FROM migration_large_jobs
     WHERE tenantId = @tenantId
       AND sourceSoftware = @sourceSoftware
       AND resource = @resource
       AND branchId = @branchId
       AND fileName = @fileName
       AND fileSizeBytes = @fileSizeBytes
       AND status NOT IN ('failed', 'cancelled', 'rolled_back')
     ORDER BY createdAt DESC
     LIMIT 1
  `).get({
    tenantId: access.tenantId,
    sourceSoftware,
    resource,
    branchId,
    fileName: upload.fileName,
    fileSizeBytes: upload.sizeBytes
  });
  if (!job) return null;
  // Never reuse a job analyzed by the old analyzer (no analyzerFixVersion in its
  // summary). Such jobs carry stale staged rows and must be re-analyzed fresh.
  let summary = {};
  try { summary = JSON.parse(job.summary || "{}") || {}; } catch { summary = {}; }
  if (cleanText(summary?.diagnostics?.analyzerFixVersion) !== CURRENT_ANALYZER_FIX_VERSION) return null;
  const stats = db.prepare(`
    SELECT COUNT(*) AS chunks, COALESCE(SUM(totalRows), 0) AS totalRows
      FROM migration_file_chunks
     WHERE tenantId = @tenantId AND jobId = @jobId
  `).get({ tenantId: access.tenantId, jobId: job.id }) || {};
  if (!Number(stats.chunks || 0)) return null;
  return {
    jobId: job.id,
    chunks: Number(stats.chunks || 0),
    totalRows: Number(stats.totalRows || job.totalRows || 0)
  };
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanKey(value) {
  return cleanText(value).toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
}

function sourceKey(value) {
  const cleaned = cleanKey(value || "excel").replace(/\s+/g, "-");
  return SOURCE_KEYS.has(cleaned) ? cleaned : "excel";
}

function detectResourceFromName(name) {
  const s = cleanText(name).toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  const rules = [
    ["clients", ["client", "customer"]],
    ["staff", ["staff", "employee", "stylist", "therapist", "team"]],
    ["services", ["service", "menu"]],
    ["products", ["product", "items", "stock item"]],
    ["inventory", ["inventory", "stock"]],
    ["vendors", ["vendor", "supplier"]],
    ["expenses", ["expense", "purchase expense"]],
    ["memberships", ["membership", "package"]],
    ["appointments", ["appointment", "booking", "calendar"]],
    ["sales", ["sale", "bill", "service history"]],
    ["invoices", ["invoice", "tax invoice"]],
    ["payments", ["payment", "receipt"]]
  ];
  for (const [resource, keywords] of rules) {
    if (keywords.some((kw) => s.includes(kw))) return resource;
  }
  return "";
}

function rmDirRecursive(dir) {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = lstatSync(full);
      if (stat.isDirectory()) rmDirRecursive(full);
      else unlinkSync(full);
    }
    rmdirSync(dir);
  } catch {}
}

function parseCsvLine(line) {
  const values = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') { quoted = true; }
    else if (ch === ",") { values.push(field); field = ""; }
    else field += ch;
  }
  values.push(field);
  return values;
}

function csvTextToRows(csvText) {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!lines.length) return [];
  const headerLine = lines.shift() || "";
  const headers = parseCsvLine(headerLine).map((h) => cleanText(h) || "");
  if (!headers.length) return [];
  const rows = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const values = parseCsvLine(trimmed);
    if (!values.some((v) => cleanText(v))) continue;
    const row = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = values[i] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

export const largeFileUploadService = {

  async handleStoredUpload(payload = {}, access = {}) {
    const upload = migrationUploadStore.read(payload.fileRef, access);
    return this._createJobFromUpload(upload, {
      sourceSoftware: payload.sourceSoftware,
      resource: payload.resource,
      branchId: payload.branchId,
      forceFresh: payload.forceFresh === true || String(payload.forceFresh).toLowerCase() === "true"
    }, access);
  },

  async handleUpload(buffer, headers = {}, access = {}) {
    const rawFileName = String(headers["x-file-name"] || "");
    const fileName = safeMigrationFileName(rawFileName) || "large-migration.zip";
    const ext = extname(fileName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw badRequest("Unsupported file type. Only CSV, XLSX, and ZIP files are supported.");
    }
    const rawMimeType = String(headers["content-type"] || "application/octet-stream");
    const mimeTypeLower = rawMimeType.toLowerCase();
    const ACCEPTED_CONTENT_TYPES_LOWER = new Set([...ACCEPTED_CONTENT_TYPES].map((t) => t.toLowerCase()));
    if (!ACCEPTED_CONTENT_TYPES_LOWER.has(mimeTypeLower)) {
      throw badRequest(`Unsupported content type "${rawMimeType}". Accepted types: CSV, Excel, ZIP.`);
    }
    if (mimeTypeLower === "application/octet-stream" && ext !== ".zip" && ext !== ".csv") {
      throw badRequest("Generic binary upload requires a .zip or .csv file extension.");
    }
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      throw badRequest("Uploaded file is empty.");
    }
    if (buffer.length > MAX_LARGE_FILE_BYTES) {
      throw badRequest(`File too large. Maximum allowed size is ${Math.round(MAX_LARGE_FILE_BYTES / 1024 / 1024)}MB.`);
    }
    assertFileMagic(buffer, ext);
    if (ext === ".zip") {
      const entries = extractZipEntries(buffer, { maxEntries: MAX_ZIP_ENTRIES, maxUncompressedBytes: MAX_ZIP_UNCOMPRESSED_BYTES, maxEntryUncompressedBytes: MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES });
      let totalValid = 0;
      for (const entry of entries) {
        const name = cleanText(entry.name);
        if (isCsvFile(name) || isSpreadsheetFile(name)) totalValid++;
        else throw badRequest(`Unsupported ZIP entry: ${name}. Only CSV, XLSX, and XLS files are allowed.`);
      }
      if (!totalValid) throw badRequest("No valid CSV or XLSX files found in ZIP archive.");
    }
    const upload = migrationUploadStore.storeBuffer({ fileName, mimeType: rawMimeType, buffer, purpose: "large-import" }, access);
    return this._createJobFromUpload(upload, {
      sourceSoftware: headers["x-source-software"],
      resource: headers["x-resource"],
      branchId: headers["x-branch-id"],
      forceFresh: String(headers["x-force-fresh"] || "").toLowerCase() === "true"
    }, access);
  },

  async _createJobFromUpload(upload, options = {}, access = {}) {
    const sourceSoftware = sourceKey(options.sourceSoftware);
    const resource = cleanText(options.resource) || "auto";
    const branchId = cleanText(options.branchId) || access.branchId || "";
    const forceFresh = options.forceFresh === true;
    const existing = forceFresh ? null : existingLargeJobForUpload(upload, { sourceSoftware, resource, branchId }, access);
    if (existing) {
      const job = migrationService.largeJob(existing.jobId, access);
      return {
        job,
        fileRef: upload.fileRef,
        chunks: existing.chunks,
        totalRows: existing.totalRows,
        message: `Existing large import job reused. ${existing.chunks} chunk(s), ${existing.totalRows} rows already staged.`
      };
    }
    const job = migrationService.createLargeJob({
      sourceSoftware, resource, branchId,
      fileName: upload.fileName,
      fileSizeBytes: upload.sizeBytes,
      sourceFileHash: cleanText(upload.sha256) || "",
      chunkSize: CHUNK_SIZE,
      id: `mlg_${randomUUID().slice(0, 12)}`
    }, access);
    const chunkResult = await this.convertFileToChunks(upload, job, access);
    migrationService.queueLargeJob(job.id, {}, access);
    const fullJob = migrationService.largeJob(job.id, access);
    return {
      job: fullJob,
      fileRef: upload.fileRef,
      chunks: chunkResult.chunks,
      totalRows: chunkResult.totalRows,
      message: `File uploaded and split into ${chunkResult.chunks} chunk(s) with ${chunkResult.totalRows} total rows. Job queued for processing.`
    };
  },

  convertFileToChunks(upload, job, access) {
    const ext = upload.extension;
    if (ext === "csv") return this._convertCsv(upload, job, access);
    if (ext === "xlsx" || ext === "xls") return this._convertXlsx(upload, job, access);
    if (ext === "zip") return this._convertZip(upload, job, access);
    throw badRequest("Unsupported file type for chunk conversion.");
  },

  _resolvePath(upload) {
    const row = db.prepare("SELECT storagePath FROM migration_uploads WHERE id = @id").get({ id: upload.fileRef });
    if (!row) throw badRequest("Upload record not found.");
    const resolved = resolve(row.storagePath);
    if (!existsSync(resolved)) throw badRequest("Upload file not found on disk.");
    return resolved;
  },

  _processChunk(jobId, chunkNumber, rows, sourceSheet, access) {
    const sheetName = cleanText(sourceSheet) || "sheet";
    const resource = detectResourceFromName(sheetName) || "clients";
    const checksum = createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
    migrationService.registerLargeJobChunk(jobId, {
      chunkNumber,
      totalRows: rows.length,
      rowStart: 0,
      rowEnd: rows.length - 1,
      sourceSheet: sheetName,
      checksum
    }, access);
    return migrationService.analyzeChunkRows(jobId, chunkNumber, {
      rows,
      sourceSheet: sheetName,
      checksum,
      resource,
      skipApprovalGate: true
    }, access);
  },

  async _convertCsv(upload, job, access) {
    const storagePath = this._resolvePath(upload);
    const sheetName = (upload.fileName || "csv").replace(/\.csv$/i, "") || "csv";
    let chunkNumber = 0;
    let totalChunks = 0;
    let totalRows = 0;
    const results = [];
    let batch = [];
    let headers = [];
    let headerDone = false;
    let errored = false;

    await new Promise((resolve, reject) => {
      const readStream = createReadStream(storagePath, { encoding: "utf8", highWaterMark: 65536 });
      const rl = readline.createInterface({ input: readStream, crlfDelay: Infinity });
      let bomSkipped = false;

      rl.on("line", (line) => {
        if (errored) return;
        try {
          if (!bomSkipped && line.length && line.charCodeAt(0) === 0xFEFF) {
            line = line.slice(1);
            bomSkipped = true;
          }
          if (!headerDone) {
            headerDone = true;
            headers = parseCsvLine(line).map((h) => cleanText(h) || "");
            if (!headers.length) throw badRequest("CSV file has no header row.");
            return;
          }
          const trimmed = line.trim();
          if (!trimmed) return;
          const values = parseCsvLine(trimmed);
          if (!values.some((v) => cleanText(v))) return;
          const row = {};
          for (let h = 0; h < headers.length; h++) {
            row[headers[h]] = values[h] ?? "";
          }
          batch.push(row);
          if (batch.length >= CHUNK_SIZE) {
            chunkNumber++;
            results.push(this._processChunk(job.id, chunkNumber, batch, sheetName, access));
            totalRows += batch.length;
            totalChunks++;
            batch = [];
          }
        } catch (err) {
          errored = true;
          rl.close();
          readStream.destroy();
          reject(err);
        }
      });

      rl.on("close", () => {
        if (errored) return;
        try {
          if (!headerDone) throw badRequest("CSV file has no data rows (header only or empty).");
          if (batch.length) {
            chunkNumber++;
            results.push(this._processChunk(job.id, chunkNumber, batch, sheetName, access));
            totalRows += batch.length;
            totalChunks++;
          }
          if (!totalChunks) throw badRequest("No valid rows found in CSV file.");
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      rl.on("error", (err) => { errored = true; reject(err); });
    });

    return { chunks: totalChunks, totalRows, results };
  },

  _convertXlsx(upload, job, access) {
    const storagePath = this._resolvePath(upload);
    const workbook = XLSX.readFile(storagePath, { cellDates: true, raw: false });
    if (!workbook.SheetNames.length) throw badRequest("Excel file has no sheets.");
    let chunkNumber = 0;
    let totalChunks = 0;
    let totalRows = 0;
    const results = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
      if (!rows.length) continue;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        chunkNumber++;
        const batch = rows.slice(i, i + CHUNK_SIZE);
        results.push(this._processChunk(job.id, chunkNumber, batch, sheetName, access));
        totalRows += batch.length;
        totalChunks++;
      }
    }
    if (!totalChunks) throw badRequest("No valid rows found in XLSX file.");
    return { chunks: totalChunks, totalRows, results };
  },

  _convertZip(upload, job, access) {
    const storagePath = this._resolvePath(upload);
    const buffer = readFileSync(storagePath);
    const entries = extractZipEntries(buffer, { maxEntries: MAX_ZIP_ENTRIES, maxUncompressedBytes: MAX_ZIP_UNCOMPRESSED_BYTES, maxEntryUncompressedBytes: MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES });
    let chunkNumber = 0;
    let totalChunks = 0;
    let totalRows = 0;
    const results = [];
    const tempDir = resolve(tmpdir(), `aura-large-zip-${randomUUID().slice(0, 8)}`);
    mkdirSync(tempDir, { recursive: true });
    try {
      for (const entry of entries) {
        const name = cleanText(entry.name);
        if (!name) continue;
        if (isCsvFile(name)) {
          const csvText = entry.data.toString("utf8");
          const rows = csvTextToRows(csvText);
          if (!rows.length) continue;
          for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            chunkNumber++;
            const batch = rows.slice(i, i + CHUNK_SIZE);
            results.push(this._processChunk(job.id, chunkNumber, batch, name, access));
            totalRows += batch.length;
            totalChunks++;
          }
        } else if (isSpreadsheetFile(name)) {
          const tmpPath = join(tempDir, name.replace(/[^a-zA-Z0-9._-]/g, "_"));
          writeFileSync(tmpPath, entry.data);
          const workbook = XLSX.readFile(tmpPath, { cellDates: true, raw: false });
          try { unlinkSync(tmpPath); } catch {}
          if (!workbook.SheetNames.length) continue;
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
            if (!rows.length) continue;
            for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
              chunkNumber++;
              const batch = rows.slice(i, i + CHUNK_SIZE);
              results.push(this._processChunk(job.id, chunkNumber, batch, `${name}/${sheetName}`, access));
              totalRows += batch.length;
              totalChunks++;
            }
          }
        }
      }
    } finally {
      try { rmDirRecursive(tempDir); } catch {}
    }
    if (!totalChunks) throw badRequest("No valid rows found in ZIP archive.");
    return { chunks: totalChunks, totalRows, results };
  }
};
