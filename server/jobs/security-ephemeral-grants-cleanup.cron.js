import { securityEphemeralGrantStore } from "../stores/security-ephemeral-grant.store.js";
import { logger } from "../utils/logger.js";

let started = false;

export function startSecurityEphemeralGrantsCleanupCron() {
  if (started) return;
  started = true;
  const timer = setInterval(() => {
    try {
      const count = securityEphemeralGrantStore.cleanup();
      if (count) logger.info("security_ephemeral_grants_cleanup", { count });
    } catch (error) {
      logger.error("security_ephemeral_grants_cleanup_failed", { error: error.message });
    }
  }, 15 * 60 * 1000);
  timer.unref?.();
}
