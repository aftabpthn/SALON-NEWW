import { Injectable, computed, signal } from '@angular/core';

/** What the backend said about the salon's subscription on the last refusal. */
export type BillingBlock = {
  /** The subscription status the API reported, e.g. `past_due`. */
  status: string;
  /** True when the salon may read but not write. */
  readOnly: boolean;
  /** The message the API sent, shown as-is rather than reworded. */
  message: string;
};

/**
 * Holds the subscription state the API reports when it refuses a request.
 *
 * The backend already enforces this: `ensure_can_write` turns a past-due
 * subscription read-only and every mutating request is checked against it. What
 * was missing was any way for the person at the screen to find that out — the
 * refusals arrived as bare 403s, so a save would simply fail with nothing to
 * act on and no route to paying.
 *
 * This service is only a place to put what the API said. It decides nothing:
 * clearing it does not restore write access, and never having seen a refusal is
 * not evidence the subscription is healthy.
 */
@Injectable({ providedIn: 'root' })
export class BillingStateService {
  private readonly blocked = signal<BillingBlock | null>(null);

  readonly block = computed(() => this.blocked());
  readonly isReadOnly = computed(() => this.blocked()?.readOnly === true);
  readonly status = computed(() => this.blocked()?.status ?? '');

  /** Records a refusal the API attributed to the subscription. */
  report(block: BillingBlock): void {
    const current = this.blocked();
    // Re-reporting the same state on every blocked save would restart the
    // banner's animation on each keystroke-driven request.
    if (current && current.status === block.status && current.readOnly === block.readOnly) return;
    this.blocked.set(block);
  }

  /**
   * Forgets the last refusal.
   *
   * Called once a write succeeds, which is the only honest signal that the
   * block is gone — payment happens on the provider's site, so the app never
   * observes it directly.
   */
  clear(): void {
    if (this.blocked() !== null) this.blocked.set(null);
  }
}
