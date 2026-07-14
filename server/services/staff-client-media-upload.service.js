import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access as fsAccess, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve } from "node:path";
import { dataDir, db } from "../db.js";
import { AppError, badRequest, forbidden, notFound } from "../utils/app-error.js";
import { validateStaffClientMediaFile } from "../utils/staff-client-media-file.util.js";
import { realtimeService } from "./realtime.service.js";
import { ensureStaffClientMediaSchema } from "./staff-client-media-schema.service.js";

const privilegedRoles = new Set(["superAdmin", "owner", "admin"]);
const allowedFields = new Set(["title", "type"]);

function isContained(parent, child) {
  const value = relative(parent, child);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function hasOwnershipBypass(access) {
  const grants = Array.isArray(access.permissions) ? access.permissions : [];
  return privilegedRoles.has(access.role) || grants.some((grant) => ["*", "update:*", "write:*", "admin:*"].includes(String(grant)));
}

function scopedClient(access, clientId) {
  if (!access?.tenantId || !access?.branchId) throw forbidden("Tenant and branch access are required");
  const client = db.prepare(`SELECT id FROM clients
    WHERE id = @clientId AND tenantId = @tenantId AND branchId = @branchId LIMIT 1`).get({
    clientId,
    tenantId: access.tenantId,
    branchId: access.branchId
  });
  if (!client) throw notFound("Client record not found");
  if (!hasOwnershipBypass(access)) {
    if (!access.staffId) throw forbidden("A staff identity is required for this client");
    const assignment = db.prepare(`SELECT id FROM appointments
      WHERE tenantId = @tenantId AND branchId = @branchId AND clientId = @clientId AND staffId = @staffId
      LIMIT 1`).get({ tenantId: access.tenantId, branchId: access.branchId, clientId, staffId: access.staffId });
    if (!assignment) throw forbidden("This client is not assigned to the authenticated staff member");
  }
}

function metadata(row) {
  return {
    id: row.mediaId,
    clientId: row.clientId,
    title: row.title,
    type: row.type,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    createdAt: row.createdAt,
    url: `/api/v1/staff-self/client-media/${encodeURIComponent(row.mediaId)}/content`
  };
}

async function mediaRoot() {
  const production = process.env.NODE_ENV === "production";
  const configured = String(process.env.AURA_MEDIA_DIR || "").trim();
  if (production && !configured) throw new AppError("AURA_MEDIA_DIR is required in production", 500);
  if (configured && !isAbsolute(configured)) throw new AppError("AURA_MEDIA_DIR must be an absolute path", 500);

  const requested = resolve(configured || join(dataDir, "private", "staff-client-media"));
  if (requested === parse(requested).root) throw new AppError("AURA_MEDIA_DIR cannot be a filesystem root", 500);
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const root = await realpath(requested);
  if (production) {
    const executableRoot = await realpath(process.cwd());
    if (isContained(executableRoot, root) || isContained(root, executableRoot)) {
      throw new AppError("AURA_MEDIA_DIR must be outside executable directories", 500);
    }
  }
  return root;
}

async function storageDirectory(root, access) {
  const scope = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
  const directory = resolve(root, scope(access.tenantId), scope(access.branchId));
  if (!isContained(root, directory)) throw new AppError("Unsafe media storage path", 500);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const resolvedDirectory = await realpath(directory);
  if (!isContained(root, resolvedDirectory)) throw new AppError("Unsafe media storage path", 500);
  return resolvedDirectory;
}

function findDuplicate(params) {
  return db.prepare(`SELECT * FROM staffClientMediaFiles
    WHERE tenantId = @tenantId AND branchId = @branchId AND clientId = @clientId
      AND sha256 = @sha256 AND title = @title AND type = @type LIMIT 1`).get(params);
}

export const staffClientMediaUploadService = {
  async create(clientId, fields, file, access) {
    ensureStaffClientMediaSchema();
    for (const key of Object.keys(fields || {})) {
      if (!allowedFields.has(key)) throw badRequest(`Multipart field '${key}' is not allowed`);
    }
    scopedClient(access, clientId);
    const { mimeType, extension } = validateStaffClientMediaFile(file);
    const title = String(fields?.title || "Client media").trim();
    const type = String(fields?.type || "photo").trim();
    if (!title || title.length > 120) throw badRequest("Media title must be between 1 and 120 characters");
    if (!type || type.length > 40) throw badRequest("Media type must be between 1 and 40 characters");

    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const identity = { tenantId: access.tenantId, branchId: access.branchId, clientId, sha256, title, type };
    const duplicate = findDuplicate(identity);
    if (duplicate) return metadata(duplicate);

    const root = await mediaRoot();
    const directory = await storageDirectory(root, access);
    const mediaId = `media_${randomUUID()}`;
    const storageName = `${randomUUID()}${extension}`;
    const finalPath = resolve(directory, storageName);
    const temporaryPath = resolve(directory, `.${randomUUID()}.tmp`);
    if (!isContained(directory, finalPath) || !isContained(directory, temporaryPath)) throw new AppError("Unsafe media storage path", 500);

    let persistedPath = "";
    try {
      await writeFile(temporaryPath, file.buffer, { flag: "wx", mode: 0o600 });
      await rename(temporaryPath, finalPath);
      persistedPath = finalPath;
      const createdAt = new Date().toISOString();
      const row = { ...identity, id: `media_file_${randomUUID()}`, mediaId, storageName, mimeType, byteSize: file.size, createdAt };
      const audit = {
        id: `audit_${randomUUID()}`,
        tenantId: access.tenantId,
        branchId: access.branchId,
        staffId: access.staffId || "",
        action: "staff.client_media_added",
        targetType: "staffClientMedia",
        targetId: mediaId,
        detailsJson: JSON.stringify({ clientId, title, type }),
        createdAt
      };
      db.transaction(() => {
        db.prepare(`INSERT INTO staffClientMedia (id, tenantId, branchId, clientId, title, type, url, createdAt)
          VALUES (@mediaId, @tenantId, @branchId, @clientId, @title, @type, @url, @createdAt)`).run({ ...row, url: `/api/v1/staff-self/client-media/${mediaId}/content` });
        db.prepare(`INSERT INTO staffClientMediaFiles
          (id, tenantId, branchId, mediaId, clientId, storageName, mimeType, byteSize, sha256, title, type, createdAt)
          VALUES (@id, @tenantId, @branchId, @mediaId, @clientId, @storageName, @mimeType, @byteSize, @sha256, @title, @type, @createdAt)`).run(row);
        db.prepare(`INSERT INTO staffSelfAudit
          (id, tenantId, branchId, staffId, action, targetType, targetId, detailsJson, createdAt)
          VALUES (@id, @tenantId, @branchId, @staffId, @action, @targetType, @targetId, @detailsJson, @createdAt)`).run(audit);
      })();
      const result = metadata(row);
      realtimeService.broadcast("staff-self.client_media_added", { media: result }, { tenantId: access.tenantId, branchId: access.branchId });
      return result;
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      if (persistedPath) await unlink(persistedPath).catch(() => {});
      if (error?.code === "SQLITE_CONSTRAINT_UNIQUE") {
        const existing = findDuplicate(identity);
        if (existing) return metadata(existing);
      }
      throw error;
    }
  },

  async content(mediaId, access) {
    ensureStaffClientMediaSchema();
    const row = db.prepare(`SELECT * FROM staffClientMediaFiles
      WHERE tenantId = @tenantId AND branchId = @branchId AND mediaId = @mediaId LIMIT 1`).get({
      tenantId: access?.tenantId || "",
      branchId: access?.branchId || "",
      mediaId
    });
    if (!row) throw notFound("Client media not found");
    scopedClient(access, row.clientId);
    const root = await mediaRoot();
    const directory = await storageDirectory(root, access);
    const filePath = resolve(directory, row.storageName);
    if (!isContained(directory, filePath)) throw new AppError("Unsafe media storage path", 500);
    await fsAccess(filePath, constants.R_OK).catch(() => { throw notFound("Client media content not found"); });
    return { buffer: await readFile(filePath), mimeType: row.mimeType };
  }
};
