import { Injectable, signal } from "@angular/core";

/**
 * A single app-wide clock. Components that need to re-render on a wall-clock cadence
 * (e.g. "open now" / "closing soon" badges) read `now()` instead of each starting their
 * own setInterval — one timer for the whole app instead of one per business card.
 */
@Injectable({ providedIn: "root" })
export class ClockService {
  readonly now = signal(Date.now());

  constructor() {
    if (typeof window !== "undefined") {
      window.setInterval(() => this.now.set(Date.now()), 60000);
    }
  }
}
