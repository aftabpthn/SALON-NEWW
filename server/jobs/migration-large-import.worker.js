import { migrationService } from "../services/migration.service.js";

const MIGRATION_WORKER_INTERVAL_MS = 15 * 1000;
const MIGRATION_WORKER_ID = `migration-worker-${process.pid || "local"}`;

export function runLargeMigrationWorkerTick() {
  try {
    migrationService.processQueuedLargeJobs({ maxJobs: 2, maxChunks: 5, workerId: MIGRATION_WORKER_ID });
  } catch (error) {
    console.warn("[MigrationLargeImport] Worker tick skipped", error.message);
  }
}

if (!globalThis.__auraLargeMigrationWorkerStarted) {
  globalThis.__auraLargeMigrationWorkerStarted = true;
  const timer = setInterval(runLargeMigrationWorkerTick, MIGRATION_WORKER_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

