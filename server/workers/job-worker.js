import { jobQueueService } from "../services/job-queue.service.js";
import { logger } from "../utils/logger.js";
import { run as abandonedRecovery } from "./handlers/abandoned-recovery.handler.js";
import { run as auditWrite } from "./handlers/audit-write.handler.js";
import { run as calendarSync } from "./handlers/calendar-sync.handler.js";
import { run as emailSend } from "./handlers/email-send.handler.js";
import { run as inventoryDeduct } from "./handlers/inventory-deduct.handler.js";
import { run as loyaltyCredit } from "./handlers/loyalty-credit.handler.js";
import { run as summaryRefresh } from "./handlers/summary-refresh.handler.js";
import { run as staffWebPushSend } from "./handlers/staff-web-push-send.handler.js";
import { run as whatsappSend } from "./handlers/whatsapp-send.handler.js";

const handlers = {
  whatsapp_send: whatsappSend,
  "whatsapp-send": whatsappSend,
  email_send: emailSend,
  "email-send": emailSend,
  calendar_sync: calendarSync,
  "calendar-sync": calendarSync,
  loyalty_credit: loyaltyCredit,
  "loyalty-credit": loyaltyCredit,
  inventory_deduct: inventoryDeduct,
  "inventory-deduct": inventoryDeduct,
  abandoned_recovery: abandonedRecovery,
  "abandoned-recovery": abandonedRecovery,
  summary_refresh: summaryRefresh,
  "summary-refresh": summaryRefresh,
  audit_write: auditWrite,
  "audit-write": auditWrite,
  staff_web_push_send: staffWebPushSend,
  "staff-web-push-send": staffWebPushSend
};

let timer = null;
let running = false;

export function startJobWorker() {
  if (timer) return timer;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    processJobs().finally(() => {
      running = false;
    });
  }, 2000);
  timer.unref?.();
  return timer;
}

async function processJobs() {
  const jobs = jobQueueService.nextPending(10);
  for (const job of jobs) {
    jobQueueService.markRunning(job.id);
    try {
      const handler = handlers[job.jobType] || (async () => ({ success: true, mode: "no-op" }));
      const result = await handler(job);
      if (result?.success === false) throw new Error(result.error || "Job handler failed");
      jobQueueService.markCompleted(job.id);
    } catch (error) {
      logger.warn("job_worker_failed", { jobId: job.id, jobType: job.jobType, error: error.message });
      jobQueueService.markFailed(job.id, error);
    }
  }
}
