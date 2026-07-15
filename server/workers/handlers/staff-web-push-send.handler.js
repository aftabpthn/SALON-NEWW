import { staffWebPushService } from "../../services/staff-web-push.service.js";

export async function run(job) {
  return staffWebPushService.deliver(job.payload?.pushNotificationId, job.tenantId);
}
