import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IonSpinner } from "@ionic/angular/standalone";
import { StaffAppService, StaffBusiness } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, IonSpinner],
  template: `
    <section class="page">
      <header class="page-head">
        <div><p class="eyebrow">My business</p><h1>Work & billing</h1><p>Daily services, worked time and connected bill details.</p></div>
        <label><span>Business date</span><input type="date" [ngModel]="date()" (ngModelChange)="changeDate($event)" /></label>
      </header>

      @if (!canReadBusiness()) { <section class="notice">You do not have permission to read staff business data.</section> }
      @if (message()) { <section class="notice success">{{ message() }}</section> }
      @if (loading()) { <section class="state"><ion-spinner name="crescent" /> Loading business details...</section> }
      @if (staff.error()) { <section class="notice">{{ staff.error() }}</section> }

      @if (canReadBusiness() && business(); as data) {
        <section class="grid four">
          <article class="kpi"><span>Appointments</span><strong>{{ data.summary.appointments }}</strong><small>{{ data.summary.completedServices }} completed</small></article>
          <article class="kpi"><span>Worked time</span><strong>{{ formatMinutes(data.summary.workedMinutes) }}</strong><small>{{ formatMinutes(data.summary.completedMinutes) }} completed · {{ formatMinutes(data.summary.scheduledMinutes) }} scheduled</small></article>
          @if (data.billingVisible) {
            <article class="kpi"><span>Bill amount</span><strong>{{ formatMoney(data.summary.subtotalPaise) }}</strong><small>{{ data.summary.bills }} connected bills</small></article>
            <article class="kpi"><span>After discount</span><strong>{{ formatMoney(data.summary.afterDiscountPaise) }}</strong><small>{{ formatMoney(data.summary.discountPaise) }} discount · {{ formatMoney(data.summary.couponDiscountPaise) }} coupon</small></article>
          } @else {
            <article class="kpi"><span>Billing</span><strong>Restricted</strong><small>Finance permission required</small></article>
            <article class="kpi"><span>Services</span><strong>{{ data.summary.completedServices }}</strong><small>completed today</small></article>
          }
        </section>

        @if (data.billingVisible) {
          <section class="grid four">
            <article class="kpi"><span>GST</span><strong>{{ formatMoney(data.summary.gstPaise) }}</strong></article>
            <article class="kpi"><span>Grand total</span><strong>{{ formatMoney(data.summary.totalPaise) }}</strong></article>
            <article class="kpi"><span>Paid</span><strong>{{ formatMoney(data.summary.paidPaise) }}</strong></article>
            <article class="kpi"><span>Due</span><strong>{{ formatMoney(data.summary.duePaise) }}</strong></article>
          </section>
        }

        <section class="panel">
          <div class="panel-title"><h2>Detailed work</h2><span>{{ data.date | date:'mediumDate' }}</span></div>
          <div class="list">
            @for (item of data.appointments; track item.id) {
              <article class="row">
                <div class="row-main">
                  <strong>{{ item.startAt | date:'shortTime' }}–{{ item.endAt | date:'shortTime' }} · {{ item.clientName }}</strong>
                  <small>{{ item.serviceNames.join(', ') || 'Service not mapped' }} · {{ item.chair || 'No chair' }}</small>
                  <small>{{ formatMinutes(item.workedMinutes) }} worked · {{ formatMinutes(item.durationMinutes) }} scheduled</small>
                  <div class="timer-track"><span [style.width.%]="item.timer.progress"></span></div>
                  <small>{{ item.timer.elapsedMinutes }} min elapsed · {{ item.timer.remainingMinutes }} min remaining</small>
                  @if (data.billingVisible && item.billing; as bill) {
                    <p>Bill {{ bill.invoiceNumber || bill.saleId }} · {{ bill.invoiceStatus || 'pending' }}</p>
                    <small>Amount {{ formatMoney(bill.subtotalPaise) }} · Discount {{ formatMoney(bill.discountPaise) }} · Coupon {{ formatMoney(bill.couponDiscountPaise) }}</small>
                    <small>After discount {{ formatMoney(bill.afterDiscountPaise) }} · GST {{ formatMoney(bill.gstPaise) }} · Total {{ formatMoney(bill.totalPaise) }}</small>
                    <small>Paid {{ formatMoney(bill.paidPaise) }} · Due {{ formatMoney(bill.duePaise) }}</small>
                  } @else if (data.billingVisible) {
                    <p>Bill not generated for this appointment.</p>
                  } @else {
                    <p>Billing details are restricted for your role.</p>
                  }
                </div>
                <div class="row-actions">
                  <span class="badge" [class.red]="item.state === 'late'" [class.green]="item.state === 'active'">{{ item.status }}</span>
                  @if (canUpdateBusiness() && canStartService(item.timer.status)) { <button class="link-button" type="button" (click)="startService(item.id)">Start</button> }
                  @if (canUpdateBusiness() && canCompleteService(item.timer.status)) { <button class="link-button" type="button" (click)="completeService(item.id)">Complete</button> }
                </div>
              </article>
            } @empty {
              <p class="empty">No staff work found for this date.</p>
            }
          </div>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffBusinessPage implements OnInit {
  readonly business = signal<StaffBusiness | null>(null);
  readonly date = signal(this.today());
  readonly loading = signal(false);
  readonly message = signal("");

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadBusiness()) void this.load(); }

  async load() {
    this.loading.set(true);
    try { this.business.set(await this.staff.business(this.date())); }
    finally { this.loading.set(false); }
  }

  changeDate(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return;
    this.message.set("");
    this.date.set(date);
    void this.load();
  }

  canReadBusiness(): boolean { return this.staff.hasPermission("read:staff"); }
  canUpdateBusiness(): boolean { return this.staff.hasAnyPermission(["write:staff", "update:staff", "write:appointments", "update:appointments"]); }
  formatMinutes(minutes: number): string { const safe = Math.max(0, Number(minutes || 0)); return `${Math.floor(safe / 60)}h ${safe % 60}m`; }
  formatMoney(paise: number): string { return (Number(paise || 0) / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  canStartService(status: string) { return ["queued", "pending", "scheduled", "booked", "confirmed", "arrived"].includes(String(status || "").toLowerCase()); }
  canCompleteService(status: string) { return ["in-service", "in service", "inprogress", "in progress", "running", "active", "started", "scheduled", "pending", "arrived", "confirmed", "booked"].includes(String(status || "").toLowerCase()); }

  async startService(appointmentId: string) {
    try { await this.staff.startService(appointmentId); await this.load(); this.message.set("Service started."); }
    catch { this.message.set(this.staff.error() || "Unable to start service."); }
  }

  async completeService(appointmentId: string) {
    try { await this.staff.completeService(appointmentId); await this.load(); this.message.set("Service completed."); }
    catch { this.message.set(this.staff.error() || "Unable to complete service."); }
  }

  private today(): string {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value["year"]}-${value["month"]}-${value["day"]}`;
  }
}
