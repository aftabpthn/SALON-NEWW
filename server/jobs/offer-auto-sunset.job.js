import { happyHoursAutoSunsetRepo } from "../repositories/happy-hours-auto-sunset.repo.js";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function runOfferAutoSunsetJob() {
  try {
    for (const scope of happyHoursAutoSunsetRepo.listScopes()) {
      try {
        happyHoursAutoSunsetRepo.runAutoSunset({ ...scope, apply: true, source: "job" });
      } catch (error) {
        console.warn("[OfferAutoSunset] Branch skipped", scope.branchId, error.message);
      }
    }
  } catch (error) {
    console.warn("[OfferAutoSunset] Job skipped", error.message);
  }
}

if (!globalThis.__auraOfferAutoSunsetJobStarted) {
  globalThis.__auraOfferAutoSunsetJobStarted = true;
  const timer = setInterval(runOfferAutoSunsetJob, SIX_HOURS_MS);
  if (typeof timer.unref === "function") timer.unref();
  runOfferAutoSunsetJob();
}
