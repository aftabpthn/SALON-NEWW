import { DatePipe } from "@angular/common";
import { Component, HostListener, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffEnterpriseOs } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Notifications</p><h1>Notifications</h1><p>Staff alerts and connected system notices.</p></div></header>
      @if (!canReadNotifications()) { <section staffPageState class="notice">You do not have permission to view notifications.</section> }
      @if (loading() && !os()) {
        <section class="notifications-skeleton" aria-label="Loading notifications">
          <div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
          <span class="skeleton notifications-list-skeleton"></span>
        </section>
      }
      @if (loadError()) { <section staffPageState class="notice notifications-error"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" (click)="load()">Retry</button></section> }
      @if (staff.error() && !loadError() && !localError()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
      @if (localError()) { <section staffPageState class="notice">{{ localError() }}</section> }
      @if (message()) { <section staffPageState class="notice success" role="status">{{ message() }}</section> }
      @if (canReadNotifications() && os(); as data) {
        <section class="panel">
          <div class="panel-title"><h2>Inbox</h2><span>{{ loading() ? 'Refreshing...' : data.notifications.length }}</span></div>
          @if (!canUpdateNotifications()) { <p class="muted">Notifications are read-only for your role.</p> }
          <div class="list">
            @for (note of data.notifications; track note.id) {
              <div class="row notification-row" [class.pending]="pendingNotificationId() === note.id"><div class="row-main"><strong>{{ note.title }}</strong><small>{{ note.body || 'No details' }} · {{ note.createdAt ? (note.createdAt | date:'short') : 'Date unavailable' }}</small></div><div class="row-actions notification-actions"><span class="badge" [class.green]="note.status === 'read'">{{ note.status || 'unread' }}</span><button class="link-button" type="button" [disabled]="!canUpdateNotifications() || !!pendingNotificationId()" [attr.aria-busy]="pendingNotificationId() === note.id" (click)="mark(note.id, note.status === 'read' ? 'unread' : 'read')">{{ pendingNotificationId() === note.id ? 'Saving...' : (note.status === 'read' ? 'Mark unread' : 'Mark read') }}</button><button class="link-button" type="button" [disabled]="!canUpdateNotifications() || !!pendingNotificationId()" [attr.aria-busy]="pendingNotificationId() === note.id" (click)="mark(note.id, 'archived')">{{ pendingNotificationId() === note.id ? 'Saving...' : 'Archive' }}</button></div></div>
            } @empty { <div class="notifications-empty"><p>No staff notifications yet.</p><small>CRM alerts, appointment updates, and system notices will appear here.</small></div> }
          </div>
        </section>
      }
    </section>`,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .notifications-skeleton { display: grid; gap: 12px; }
    .notifications-list-skeleton { min-height: 260px; }
    .notifications-error { justify-content: space-between; }
    .notification-row.pending { opacity: .72; }
    .notifications-empty { display: grid; justify-items: center; gap: 5px; padding: 26px 10px; color: var(--staff-text-secondary); font-weight: 600; text-align: center; }
    .notifications-empty p { margin: 0; }
    .notifications-empty small { font-weight: 600; line-height: 1.4; }
    .notification-actions .link-button { min-width: 104px; }
    @media (max-width: 700px) {
      .notifications-error, .notification-row, .notification-actions { align-items: stretch; flex-direction: column; }
      .notifications-error button, .notification-actions .link-button { width: 100%; }
      .notification-actions .badge { width: fit-content; }
    }
  `]
})
export class StaffNotificationsPage implements OnInit {
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal("");
  readonly localError = signal("");
  readonly pendingNotificationId = signal("");
  readonly message = signal("");

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadNotifications()) void this.load(); }

  async load() {
    if (!this.canReadNotifications()) {
      this.os.set(null);
      return;
    }
    this.loading.set(true);
    this.loadError.set("");
    try {
      this.os.set(await this.staff.enterpriseOs());
    } catch {
      this.loadError.set(this.staff.error() || "Unable to load notifications.");
    } finally {
      this.loading.set(false);
    }
  }

  async mark(id: string, status: "read" | "unread" | "archived") {
    this.message.set("");
    this.localError.set("");
    if (!this.canUpdateNotifications()) {
      this.message.set("You do not have permission to update notifications.");
      return;
    }
    if (this.pendingNotificationId()) return;
    this.pendingNotificationId.set(id);
    try {
      await this.staff.updateNotification(id, status);
      this.message.set(`Notification marked ${status}.`);
      await this.load();
    } catch {
      this.localError.set(this.staff.error() || "Unable to update notification.");
    } finally {
      this.pendingNotificationId.set("");
    }
  }

  @HostListener("window:aura:notifications-updated")
  onNotificationsUpdated() { if (this.canReadNotifications()) void this.load(); }

  canReadNotifications(): boolean {
    return this.staff.hasPermission("staff.app.notifications.read");
  }

  canUpdateNotifications(): boolean {
    return this.staff.hasPermission("staff.app.notifications.manage");
  }
}
