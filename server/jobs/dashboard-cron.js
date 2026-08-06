import { dashboardAggregationService } from "../services/dashboard-aggregation.service.js";
import { anomalyDetectionService } from "../services/anomaly-detection.service.js";
import { db } from "../db.js";
import { logger } from "../utils/logger.js";
import { withRetry } from "../utils/db-retry.js";

let started = false;
let hourlyDailyRunning = false;

function activeTenants() {
  return withRetry(() => db
      .prepare("SELECT id FROM tenants WHERE COALESCE(status, 'active') NOT IN ('deleted', 'suspended')")
      .all()
      .map((row) => row.id), { maxAttempts: 5, delayMs: 250 });
}

function guarded(name, fn) {
  try {
    fn();
  } catch (error) {
    logger.error("dashboard_cron_failed", { job: name, error: error.message });
  }
}

function runHourlyAndDaily() {
  if (hourlyDailyRunning) return;
  hourlyDailyRunning = true;
  guarded("dashboard-hourly-daily", () => {
    for (const tenantId of activeTenants()) {
      withRetry(() => {
        dashboardAggregationService.refreshHourlySummary(tenantId);
        dashboardAggregationService.refreshDailySummary(tenantId);
      }, { maxAttempts: 5, delayMs: 250 });
    }
  });
  hourlyDailyRunning = false;
}

function runFullRefresh() {
  guarded("dashboard-full-refresh", () => {
    dashboardAggregationService.refreshAllTenants();
  });
}

function runAnomalies() {
  guarded("dashboard-anomalies", () => {
    for (const tenantId of activeTenants()) anomalyDetectionService.runAllChecks(tenantId);
  });
}

export function startDashboardCron() {
  if (started) return;
  started = true;

  setTimeout(runHourlyAndDaily, 1000).unref?.();
  setInterval(runHourlyAndDaily, 5 * 60 * 1000);
  setInterval(runFullRefresh, 60 * 60 * 1000);
  setInterval(runAnomalies, 60 * 60 * 1000);

  logger.info("dashboard_cron_started", {
    schedules: ["*/5 * * * * hourly/daily", "0 * * * * full/anomaly lightweight"]
  });
}
