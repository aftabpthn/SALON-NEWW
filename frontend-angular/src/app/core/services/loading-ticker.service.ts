import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoadingTickerService {
  private static readonly STORAGE_KEY = 'aurashine_loading_ticker_enabled';

  private readonly pendingRequests = signal(0);
  private readonly startedAt = signal<number | null>(null);
  private readonly tickAt = signal<number>(Date.now());
  private timer: number | undefined;

  readonly enabled = signal<boolean>(this.readStorageEnabled());
  readonly activeRequestCount = computed(() => this.pendingRequests());
  readonly isLoading = computed(() => this.activeRequestCount() > 0);

  readonly elapsedSeconds = computed(() => {
    const started = this.startedAt();
    if (!this.isLoading() || started === null) return 0;
    return Math.max(0, Math.floor((this.tickAt() - started) / 1000));
  });

  readonly elapsedLabel = computed(() => {
    const seconds = this.elapsedSeconds();
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, '0');
    const parts = String(minutes).padStart(1, '0');
    return `${parts}:${remainder}`;
  });

  readonly requestSummary = computed(() => {
    const count = this.activeRequestCount();
    return `${count} req${count === 1 ? '' : 's'}`;
  });

  beginRequest(): void {
    this.pendingRequests.set(this.pendingRequests() + 1);
    if (this.pendingRequests() === 1) {
      this.startedAt.set(Date.now());
      this.tickAt.set(this.startedAt() || Date.now());
      if (this.enabled()) this.startTimer();
    }
  }

  endRequest(): void {
    const next = this.pendingRequests() - 1;
    if (next <= 0) {
      this.pendingRequests.set(0);
      this.startedAt.set(null);
      this.stopTimer();
      this.tickAt.set(Date.now());
      return;
    }
    this.pendingRequests.set(next);
  }

  toggleEnabled(): void {
    this.setEnabled(!this.enabled());
  }

  setEnabled(nextEnabled: boolean): void {
    this.enabled.set(nextEnabled);
    this.writeStorageEnabled(nextEnabled);
    if (!nextEnabled) {
      this.stopTimer();
      return;
    }
    if (this.isLoading()) this.startTimer();
  }

  private startTimer(): void {
    if (this.timer !== undefined) return;
    this.timer = window.setInterval(() => {
      this.tickAt.set(Date.now());
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private readStorageEnabled(): boolean {
    try {
      const value = window.localStorage.getItem(LoadingTickerService.STORAGE_KEY);
      if (value === null) return true;
      return value === 'true';
    } catch {
      return true;
    }
  }

  private writeStorageEnabled(enabled: boolean): void {
    try {
      window.localStorage.setItem(LoadingTickerService.STORAGE_KEY, String(enabled));
    } catch {
      // ignore storage failures
    }
  }
}
