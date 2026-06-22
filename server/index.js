import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { startAbandonmentDetectorCron } from "./jobs/abandonment-detector.cron.js";
import { startDashboardCron } from "./jobs/dashboard-cron.js";
import { startIdempotencyCleanupCron } from "./jobs/idempotency-cleanup.cron.js";
import { startReconciliationCron } from "./jobs/reconciliation-cron.js";
import { startSlotCleanupCron } from "./jobs/slot-cleanup.cron.js";
import { startWizardCleanupCron } from "./jobs/wizard-cleanup.cron.js";
import { realtimeService } from "./services/realtime.service.js";
import { logger } from "./utils/logger.js";
import { startJobWorker } from "./workers/job-worker.js";

const app = createApp();

const server = app.listen(env.port, env.host, () => {
  logger.info("api_started", {
    url: `http://${env.host}:${env.port}`,
    environment: env.nodeEnv
  });
});

realtimeService.attach(server);
startDashboardCron();
startAbandonmentDetectorCron();
startSlotCleanupCron();
startIdempotencyCleanupCron();
startWizardCleanupCron();
startJobWorker();
startReconciliationCron();
