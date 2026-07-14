import { Injectable, computed, effect, signal } from '@angular/core';
import { ApiRecord, ApiService } from './api.service';
import { AuthSessionService } from './auth-session.service';
import { GeneralSettingsService } from './general-settings.service';
import { AppStateService } from './state/app-state.service';
import { WebSocketService } from './websocket.service';

@Injectable({ providedIn: 'root' })
export class NotificationCenterService {
  readonly notifications = signal<ApiRecord[]>([]);
  readonly loading = signal(false);
  readonly unreadCount = computed(() => this.notifications().filter((item) => !['read', 'sent', 'completed'].includes(String(item['status'] || '').toLowerCase())).length);
  readonly recent = computed(() => this.notifications().slice(0, 5));

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthSessionService,
    private readonly state: AppStateService,
    private readonly settings: GeneralSettingsService,
    private readonly realtime: WebSocketService
  ) {
    effect(() => {
      const authenticated = this.auth.isAuthenticated();
      const role = this.state.userRole();
      const enabled = !['owner', 'admin', 'superAdmin'].includes(role) || this.settings.ownerNotificationsEnabled();
      this.state.selectedTenantId();
      this.state.selectedBranchId();
      this.realtime.events()[0]?.meta?.eventId;
      if (!authenticated || !enabled) {
        this.notifications.set([]);
        return;
      }
      queueMicrotask(() => this.refresh());
    });
  }

  refresh(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.api.list<ApiRecord[]>('notifications', { limit: 20, noCache: true }).subscribe({
      next: (rows) => {
        this.notifications.set(Array.isArray(rows) ? rows : []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }
}
