import { demandSignalsRepo } from "../repositories/demand-signals.repo.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

export function captureAllBranches() {
  try {
    for (const scope of demandSignalsRepo.listCaptureScopes()) {
      try {
        demandSignalsRepo.captureSnapshot(scope);
      } catch (error) {
        console.warn("[DemandSignals] Branch snapshot skipped", scope.branchId, error.message);
      }
    }
  } catch (error) {
    console.warn("[DemandSignals] Snapshot job skipped", error.message);
  }
}

if (!globalThis.__auraDemandSnapshotJobStarted) {
  globalThis.__auraDemandSnapshotJobStarted = true;
  const timer = setInterval(captureAllBranches, ONE_HOUR_MS);
  if (typeof timer.unref === "function") timer.unref();
  captureAllBranches();
}
