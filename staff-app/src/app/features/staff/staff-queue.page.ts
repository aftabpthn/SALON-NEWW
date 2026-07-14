import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { IonSpinner } from "@ionic/angular/standalone";
import { isQueuedMutation, StaffAppService, StaffEnterpriseOs } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [DatePipe, IonSpinner],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Today's queue</p><h1>Live queue</h1><p>Timeline and service timers for today.</p></div></header>
      @if (!canReadQueue()) { <section class="notice">You do not have permission to read queue data.</section> }
      @if (message()) { <section class="notice success">{{ message() }}</section> }
      @if (loading()) { <section class="state"><ion-spinner name="crescent" /> Loading queue...</section> }
      @if (staff.error()) { <section class="notice">{{ staff.error() }}</section> }
      @if (canReadQueue() && os(); as data) {
        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Appointment timeline</h2><span>{{ data.timeline.length }}</span></div>
            <div class="list">
              @for (item of data.timeline; track item.id) {
                <div class="row"><div class="row-main"><strong>{{ item.startAt | date:'shortTime' }} · Assigned appointment</strong><small>{{ item.serviceNames.join(', ') || 'Service' }} · {{ item.state }}</small></div><span class="badge" [class.red]="item.state === 'late'" [class.green]="item.state === 'active'">{{ item.status }}</span></div>
              } @empty { <p class="empty">No queue items for today.</p> }
            </div>
          </article>
          <article class="panel">
            <div class="panel-title"><h2>Service timers</h2><span>auto</span></div>
            <div class="list">
              @for (timer of data.serviceTimers; track timer.appointmentId) {
                <div class="row">
                  <div class="row-main">
                    <strong>Active service</strong>
                    <small>{{ formatMinutes(timer.remainingMinutes) }} remaining · {{ timer.status }}</small>
                    <div class="timer-track"><span [style.width.%]="timer.progress"></span></div>
                  </div>
                  <span class="badge">{{ timer.progress }}%</span>
                  @if (canUpdateQueue()) {
                    <div class="row-actions">
                      @if (canStartService(timer)) { <button class="link-button" type="button" (click)="startService(timer.appointmentId)">Start</button> }
                      @if (canCompleteService(timer)) { <button class="link-button" type="button" (click)="completeService(timer.appointmentId)">Complete</button> }
                    </div>
                  }
                </div>
              } @empty { <p class="empty">No service timers available.</p> }
            </div>
          </article>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffQueuePage implements OnInit {
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly loading = signal(false);
  readonly message = signal("");
  constructor(readonly staff: StaffAppService) {}
  ngOnInit() { if (this.canReadQueue()) void this.load(); }
  async load() {
    this.loading.set(true);
    this.message.set("");
    try {
      this.os.set(await this.staff.enterpriseOs());
    } finally {
      this.loading.set(false);
    }
  }

  canReadQueue(): boolean {
    return this.staff.hasPermission("read:staff");
  }

  canUpdateQueue(): boolean {
    return this.staff.hasAnyPermission(["write:staff", "update:staff", "write:appointments", "update:appointments"]);
  }

  formatMinutes(minutes: number): string { const safe = Math.max(0, Number(minutes || 0)); return `${Math.floor(safe / 60)}h ${safe % 60}m`; }
  canStartService(timer: { status: string }) {
    return this.staff.canStartServiceStatus(timer.status);
  }

  canCompleteService(timer: { status: string }) {
    return this.staff.canCompleteServiceStatus(timer.status);
  }

  async startService(appointmentId: string) {
    this.message.set("");
    try {
      const result = await this.staff.startService(appointmentId);
      if (isQueuedMutation(result)) { this.message.set(`Service start queued for sync (${result.queueId}).`); return; }
      this.message.set("Service started.");
      await this.load();
    } catch {
      this.message.set(this.staff.error() || "Unable to start service.");
    }
  }

  async completeService(appointmentId: string) {
    this.message.set("");
    try {
      const result = await this.staff.completeService(appointmentId);
      if (isQueuedMutation(result)) { this.message.set(`Service completion queued for sync (${result.queueId}).`); return; }
      this.message.set("Service completed.");
      await this.load();
    } catch {
      this.message.set(this.staff.error() || "Unable to complete service.");
    }
  }
}
