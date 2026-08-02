import { CurrencyPipe, DatePipe } from "@angular/common";
import { Component, HostListener, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { StaffAppService, StaffNotificationCenter, StaffNotificationPreferences } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

type PreferenceDraft = Omit<StaffNotificationPreferences, "staffId">;

@Component({
  standalone: true,
  imports: [CurrencyPipe, DatePipe, FormsModule, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Notifications</p><h1>Notifications</h1></div></header>
      @if (!canReadNotifications()) { <section staffPageState class="notice">You do not have permission to view notifications.</section> }
      @if (loading() && !center()) {
        <section class="notifications-skeleton" aria-label="Loading notifications"><div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div><span class="skeleton notifications-list-skeleton"></span></section>
      }
      @if (loadError()) { <section staffPageState class="notice notifications-error"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" (click)="load()">Retry</button></section> }
      @if (localError()) { <section staffPageState class="notice">{{ localError() }}</section> }
      @if (message()) { <section staffPageState class="notice success" role="status">{{ message() }}</section> }

      @if (canReadNotifications() && center(); as data) {
        <section class="channel-grid" aria-label="Notification channel status">
          @for (channel of channelEntries(data); track channel.key) {
            <article class="metric-card"><span>{{ channel.label }}</span><strong>{{ channel.value.enabled ? 'On' : 'Muted' }}</strong><small>{{ channel.value.configured ? (channel.value.devices + ' devices') : 'Provider not configured' }}</small></article>
          }
        </section>

        <section class="panel preferences-panel">
          <div class="panel-title"><h2>Notification controls</h2><span>Version {{ draft.version }}</span></div>
          <form (ngSubmit)="savePreferences()">
            <div class="preference-grid">
              <label class="toggle"><input type="checkbox" [(ngModel)]="draft.workingDayOnly" name="workingDayOnly" /><span>Working days only</span></label>
              <label class="toggle"><input type="checkbox" [(ngModel)]="draft.inAppEnabled" name="inAppEnabled" /><span>In-app</span></label>
              <label class="toggle"><input type="checkbox" [(ngModel)]="draft.webPushEnabled" name="webPushEnabled" /><span>Web push</span></label>
              <label class="toggle"><input type="checkbox" [(ngModel)]="draft.fcmEnabled" name="fcmEnabled" /><span>FCM</span></label>
              <label class="toggle"><input type="checkbox" [(ngModel)]="draft.apnsEnabled" name="apnsEnabled" /><span>APNs</span></label>
              <label class="toggle"><input type="checkbox" [(ngModel)]="draft.dailyStartEnabled" name="dailyStartEnabled" /><span>Start-day summary</span></label>
              <label class="toggle"><input type="checkbox" [(ngModel)]="draft.dailyEndEnabled" name="dailyEndEnabled" /><span>End-day summary</span></label>
            </div>
            <div class="time-grid">
              <label><span>Quiet hours start</span><input type="time" [(ngModel)]="draft.quietHoursStart" name="quietHoursStart" /></label>
              <label><span>Quiet hours end</span><input type="time" [(ngModel)]="draft.quietHoursEnd" name="quietHoursEnd" /></label>
              <label><span>Start summary</span><input type="time" [(ngModel)]="draft.dailyStartTime" name="dailyStartTime" required /></label>
              <label><span>End summary</span><input type="time" [(ngModel)]="draft.dailyEndTime" name="dailyEndTime" required /></label>
            </div>
            <fieldset><legend>Muted categories</legend><div class="category-grid">@for (category of categories; track category.key) { <label class="toggle"><input type="checkbox" [checked]="draft.mutedCategories.includes(category.key)" (change)="toggleCategory(category.key, $any($event.target).checked)" /><span>{{ category.label }}</span></label> }</div></fieldset>
            <button class="button primary" type="submit" [disabled]="!canUpdateNotifications() || saving()">{{ saving() ? 'Saving...' : 'Save controls' }}</button>
          </form>
        </section>

        <section class="workflow-grid">
          <article class="panel workflow-card"><div class="panel-title"><h2>Start day</h2><span>{{ data.dailyWorkflow.businessDate }}</span></div><dl>
            <div><dt>Today’s guests</dt><dd>{{ data.dailyWorkflow.start.todayGuests }}</dd></div><div><dt>Specific requests</dt><dd>{{ data.dailyWorkflow.start.specificRequests }}</dd></div>
            <div><dt>New guests</dt><dd>{{ data.dailyWorkflow.start.newGuests }}</dd></div><div><dt>Schedule gaps</dt><dd>{{ data.dailyWorkflow.start.gapMinutes }} min</dd></div>
            <div><dt>Required forms</dt><dd>{{ data.dailyWorkflow.start.requiredForms }}</dd></div><div><dt>Stock / service alerts</dt><dd>{{ data.dailyWorkflow.start.stockAlerts + data.dailyWorkflow.start.serviceAlerts }}</dd></div>
            <div><dt>Pending tasks</dt><dd>{{ data.dailyWorkflow.start.pendingTasks }}</dd></div>
          </dl></article>
          <article class="panel workflow-card"><div class="panel-title"><h2>End day</h2><span>{{ data.dailyWorkflow.businessDate }}</span></div><dl>
            <div><dt>Completed services</dt><dd>{{ data.dailyWorkflow.end.completedServices }}</dd></div><div><dt>Sales</dt><dd>{{ data.dailyWorkflow.end.salesPaise / 100 | currency:'INR':'symbol':'1.2-2' }}</dd></div>
            <div><dt>Commission</dt><dd>{{ data.dailyWorkflow.end.commissionPaise / 100 | currency:'INR':'symbol':'1.2-2' }}</dd></div><div><dt>Tips</dt><dd>{{ data.dailyWorkflow.end.tipsPaise / 100 | currency:'INR':'symbol':'1.2-2' }}</dd></div>
            <div><dt>Missing checkout</dt><dd>{{ data.dailyWorkflow.end.missingCheckout }}</dd></div><div><dt>Missing forms</dt><dd>{{ data.dailyWorkflow.end.missingForms }}</dd></div>
            <div><dt>Missing consumables</dt><dd>{{ data.dailyWorkflow.end.missingConsumables }}</dd></div>
          </dl></article>
        </section>

        <section class="panel">
          <div class="panel-title"><h2>Inbox</h2><span>{{ loading() ? 'Refreshing...' : data.notifications.length }}</span></div>
          <div class="list">@for (note of data.notifications; track note.id) {
            <div class="row notification-row" [class.pending]="pendingNotificationId() === note.id"><div class="row-main"><strong>{{ note.title }}</strong><small>{{ note.body || 'No details' }} · {{ note.createdAt | date:'short' }}</small></div><div class="row-actions notification-actions"><span class="badge" [class.green]="note.status === 'read'">{{ note.status }}</span><button class="link-button" type="button" [disabled]="!canUpdateNotifications() || !!pendingNotificationId()" (click)="mark(note.id, note.status === 'read' ? 'unread' : 'read')">{{ note.status === 'read' ? 'Mark unread' : 'Mark read' }}</button><button class="link-button" type="button" [disabled]="!canUpdateNotifications() || !!pendingNotificationId()" (click)="mark(note.id, 'archived')">Archive</button></div></div>
          } @empty { <div class="notifications-empty"><p>No staff notifications yet.</p></div> }</div>
        </section>

        <section class="panel">
          <div class="panel-title"><h2>Delivery and retry log</h2><span>{{ data.deliveryLogs.length }}</span></div>
          <div class="list compact-log">@for (log of data.deliveryLogs; track log.id) { <div class="row"><div class="row-main"><strong>{{ log.channel }} · {{ log.status }}</strong><small>Attempt {{ log.attempt }} · {{ log.createdAt | date:'short' }}{{ log.error ? ' · ' + log.error : '' }}</small></div><span class="badge" [class.green]="log.status === 'sent'">{{ log.provider || 'in_app' }}</span></div> } @empty { <div class="notifications-empty"><p>No delivery attempts yet.</p></div> }</div>
        </section>
      }
    </section>`,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .notifications-skeleton{display:grid;gap:12px}.notifications-list-skeleton{min-height:260px}.notifications-error{justify-content:space-between}.notification-row.pending{opacity:.72}.notifications-empty{display:grid;justify-items:center;padding:20px 10px;color:var(--staff-text-secondary);font-weight:600;text-align:center}.notifications-empty p{margin:0}
    .channel-grid,.workflow-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.channel-grid{margin-bottom:12px}.metric-card{display:grid;gap:4px;padding:12px;border:1px solid var(--staff-border);border-radius:14px;background:var(--staff-surface)}.metric-card span,.metric-card small{color:var(--staff-text-secondary);font-weight:650}.metric-card strong{font-size:1.15rem}.preferences-panel form{display:grid;gap:14px}.preference-grid,.category-grid,.time-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.toggle{display:flex!important;align-items:center;gap:8px;min-height:44px}.toggle input{width:18px;height:18px}.time-grid label{display:grid;gap:5px}.time-grid span,fieldset legend{font-size:.76rem;font-weight:700;color:var(--staff-text-secondary)}.time-grid input{min-height:44px}fieldset{margin:0;padding:10px;border:1px solid var(--staff-border);border-radius:12px}.workflow-grid{grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:12px}.workflow-card{margin:0}.workflow-card dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0}.workflow-card dl div{display:flex;justify-content:space-between;gap:8px;padding:9px;border-radius:10px;background:var(--staff-surface-secondary)}.workflow-card dt{color:var(--staff-text-secondary);font-weight:650}.workflow-card dd{margin:0;font-weight:800}.compact-log{max-height:360px;overflow:auto}
    @media(max-width:900px){.channel-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.preference-grid,.category-grid,.time-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:700px){.workflow-grid,.preference-grid,.category-grid,.time-grid{grid-template-columns:1fr}.notifications-error,.notification-row,.notification-actions{align-items:stretch;flex-direction:column}.notification-actions .link-button{width:100%}.workflow-card dl{grid-template-columns:1fr}}
  `]
})
export class StaffNotificationsPage implements OnInit {
  readonly center = signal<StaffNotificationCenter | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal("");
  readonly localError = signal("");
  readonly pendingNotificationId = signal("");
  readonly message = signal("");
  readonly categories = [
    { key: "appointments", label: "Appointments" }, { key: "service", label: "Service" }, { key: "checkout", label: "Checkout" },
    { key: "tips", label: "Tips" }, { key: "attendance", label: "Attendance" }, { key: "leave_schedule", label: "Leave / schedule" },
    { key: "payroll", label: "Payroll" }, { key: "daily_summary", label: "Daily summaries" }, { key: "tasks", label: "Tasks" }, { key: "stock", label: "Stock" }
  ];
  draft: PreferenceDraft = this.emptyDraft();

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadNotifications()) void this.load(); }

  async load() {
    if (!this.canReadNotifications()) return;
    this.loading.set(true); this.loadError.set("");
    try {
      const center = await this.staff.notificationCenter();
      this.center.set(center);
      this.draft = this.toDraft(center.preferences);
    } catch { this.loadError.set(this.staff.error() || "Unable to load notifications."); }
    finally { this.loading.set(false); }
  }

  async savePreferences() {
    if (!this.canUpdateNotifications() || this.saving()) return;
    this.saving.set(true); this.localError.set(""); this.message.set("");
    try {
      await this.staff.saveNotificationPreferences({ ...this.draft, quietHoursStart: this.time(this.draft.quietHoursStart), quietHoursEnd: this.time(this.draft.quietHoursEnd), dailyStartTime: this.time(this.draft.dailyStartTime)!, dailyEndTime: this.time(this.draft.dailyEndTime)! });
      this.message.set("Notification controls saved.");
      await this.load();
    } catch { this.localError.set(this.staff.error() || "Unable to save notification controls."); }
    finally { this.saving.set(false); }
  }

  toggleCategory(category: string, muted: boolean) {
    this.draft.mutedCategories = muted ? [...new Set([...this.draft.mutedCategories, category])] : this.draft.mutedCategories.filter((value) => value !== category);
  }

  channelEntries(data: StaffNotificationCenter) {
    return [
      { key: "inApp", label: "In-app", value: data.channels.inApp }, { key: "webPush", label: "Web push", value: data.channels.webPush },
      { key: "fcm", label: "FCM", value: data.channels.fcm }, { key: "apns", label: "APNs", value: data.channels.apns }
    ];
  }

  async mark(id: string, status: "read" | "unread" | "archived") {
    if (!this.canUpdateNotifications() || this.pendingNotificationId()) return;
    this.pendingNotificationId.set(id); this.localError.set(""); this.message.set("");
    try { await this.staff.updateNotification(id, status); this.message.set(`Notification marked ${status}.`); await this.load(); }
    catch { this.localError.set(this.staff.error() || "Unable to update notification."); }
    finally { this.pendingNotificationId.set(""); }
  }

  @HostListener("window:aura:notifications-updated") onNotificationsUpdated() { if (this.canReadNotifications()) void this.load(); }
  canReadNotifications() { return this.staff.hasPermission("staff.app.notifications.read"); }
  canUpdateNotifications() { return this.staff.hasPermission("staff.app.notifications.manage"); }

  private toDraft(value: StaffNotificationPreferences): PreferenceDraft {
    const { staffId: _staffId, ...draft } = value;
    return { ...draft, mutedCategories: [...draft.mutedCategories], quietHoursStart: this.shortTime(draft.quietHoursStart), quietHoursEnd: this.shortTime(draft.quietHoursEnd), dailyStartTime: this.shortTime(draft.dailyStartTime) || "08:00", dailyEndTime: this.shortTime(draft.dailyEndTime) || "20:00" };
  }

  private emptyDraft(): PreferenceDraft { return { workingDayOnly: true, inAppEnabled: true, webPushEnabled: true, fcmEnabled: true, apnsEnabled: true, mutedCategories: [], quietHoursStart: null, quietHoursEnd: null, dailyStartEnabled: true, dailyEndEnabled: true, dailyStartTime: "08:00", dailyEndTime: "20:00", version: 0 }; }
  private shortTime(value: string | null) { return value ? value.slice(0, 5) : null; }
  private time(value: string | null) { return value ? (value.length === 5 ? `${value}:00` : value) : null; }
}
