import { DatePipe } from "@angular/common";
import { Component, computed, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IonSpinner } from "@ionic/angular/standalone";
import {
  StaffAppService,
  StaffBusiness,
  StaffBusinessAppointment,
  StaffBusinessQuery,
  StaffBusinessSummary
} from "../../core/staff-app.service";

type BusinessPreset = "today" | "1m" | "3m" | "6m" | "1y" | "custom";

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, IonSpinner],
  template: `
    <section class="page">
      <header class="page-head">
        <div><p class="eyebrow">My business</p><h1>Work & billing</h1><p>Appointments, service time and billing across any selected period.</p></div>
      </header>

      @if (!canReadBusiness()) { <section class="notice">You do not have permission to read staff business data.</section> }
      @if (message()) { <section class="notice">{{ message() }}</section> }
      @if (loading()) { <section class="state"><ion-spinner name="crescent" /> Loading business report...</section> }
      @if (staff.error()) { <section class="notice">{{ staff.error() }}</section> }

      @if (canReadBusiness()) {
        <section class="panel">
          <div class="panel-title"><h2>Report period</h2><span>{{ rangeLabel() }}</span></div>
          <div class="form-grid compact-grid">
            <label>Period
              <select [ngModel]="preset()" (ngModelChange)="changePreset($event)">
                <option value="today">Today</option>
                <option value="1m">1 Month</option>
                <option value="3m">3 Months</option>
                <option value="6m">6 Months</option>
                <option value="1y">1 Year</option>
                <option value="custom">Custom Range</option>
              </select>
            </label>
            @if (preset() === 'custom') {
              <label>From<input type="date" [ngModel]="fromDate()" (ngModelChange)="fromDate.set($event)" /></label>
              <label>To<input type="date" [ngModel]="toDate()" (ngModelChange)="toDate.set($event)" /></label>
            }
            <label>Search<input type="search" [ngModel]="search()" (ngModelChange)="search.set($event)" (keydown.enter)="apply()" placeholder="Client, service or invoice" /></label>
            <label>Status
              <select [ngModel]="status()" (ngModelChange)="status.set($event)">
                <option value="all">All statuses</option>
                <option value="booked">Booked</option>
                <option value="confirmed">Confirmed</option>
                <option value="arrived">Arrived</option>
                <option value="in-service">In service</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="no-show">No-show</option>
              </select>
            </label>
            <label>Sort
              <select [ngModel]="sort()" (ngModelChange)="sort.set($event)">
                <option value="desc">Newest dates first</option>
                <option value="asc">Oldest dates first</option>
              </select>
            </label>
          </div>
          <div class="row-actions permission-actions">
            <button class="button primary" type="button" (click)="apply()">Apply</button>
            <button class="button" type="button" [disabled]="exporting()" (click)="exportCsv()">{{ exporting() ? 'Exporting…' : 'Export CSV' }}</button>
          </div>
        </section>
      }

      @if (canReadBusiness() && business(); as data) {
        <section class="grid four">
          <article class="kpi"><span>Appointments</span><strong>{{ data.summary.appointments }}</strong><small>{{ data.summary.completedServices }} completed services</small></article>
          <article class="kpi"><span>Worked time</span><strong>{{ formatMinutes(data.summary.workedMinutes) }}</strong><small>{{ formatMinutes(data.summary.completedMinutes) }} completed · {{ formatMinutes(data.summary.scheduledMinutes) }} scheduled</small></article>
          @if (data.billingVisible) {
            <article class="kpi"><span>Bill amount</span><strong>{{ formatMoney(data.summary.subtotalPaise) }}</strong><small>{{ data.summary.bills }} connected bills</small></article>
            <article class="kpi"><span>After discount</span><strong>{{ formatMoney(data.summary.afterDiscountPaise) }}</strong><small>{{ formatMoney(data.summary.discountPaise) }} discount · {{ formatMoney(data.summary.couponDiscountPaise) }} coupon</small></article>
          } @else {
            <article class="kpi"><span>Billing</span><strong>Restricted</strong><small>Finance permission required</small></article>
            <article class="kpi"><span>Services</span><strong>{{ data.summary.completedServices }}</strong><small>completed in selected range</small></article>
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
          <div class="panel-title">
            <h2>Detailed work</h2>
            <span>Showing {{ data.appointments.length }} of {{ data.pagination.totalItems }}</span>
          </div>
        </section>

        @for (group of appointmentGroups(); track group.date) {
          <section class="panel">
            <div class="panel-title">
              <h2>{{ dateLabel(group.date) }}</h2>
              <span>{{ group.summary.appointments }} appointments · {{ group.summary.completedServices }} completed · {{ formatMinutes(group.summary.workedMinutes) }} worked</span>
            </div>
            @if (data.billingVisible) {
              <p>Bill {{ formatMoney(group.summary.subtotalPaise) }} · Discount {{ formatMoney(group.summary.discountPaise) }} · Coupon {{ formatMoney(group.summary.couponDiscountPaise) }} · Due {{ formatMoney(group.summary.duePaise) }}</p>
            }
            <div class="list">
              @for (item of group.appointments; track item.id) {
                <article class="row">
                  <div class="row-main">
                    <strong>{{ item.startAt | date:'shortTime':'+0530' }}–{{ item.endAt | date:'shortTime':'+0530' }} · {{ item.clientName }}</strong>
                    <small>{{ item.serviceNames.join(', ') || 'Service not mapped' }} · {{ item.chair || 'No chair' }}</small>
                    <small>{{ formatMinutes(item.workedMinutes) }} worked · {{ formatMinutes(item.durationMinutes) }} scheduled</small>
                    @if (item.timer.live) {
                      <div class="timer-track"><span [style.width.%]="item.timer.progress"></span></div>
                      <small>{{ item.timer.elapsedMinutes }} min elapsed · {{ item.timer.remainingMinutes }} min remaining</small>
                    }
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
                    @if (canUpdateBusiness() && isToday(item) && canStartService(item.timer.status)) { <button class="link-button" type="button" (click)="startService(item.id)">Start</button> }
                    @if (canUpdateBusiness() && isToday(item) && canCompleteService(item.timer.status)) { <button class="link-button" type="button" (click)="completeService(item.id)">Complete</button> }
                  </div>
                </article>
              }
            </div>
          </section>
        } @empty {
          <section class="panel"><p class="empty">No staff work found for this range and filters.</p></section>
        }

        @if (data.pagination.hasMore) {
          <div class="row-actions permission-actions">
            <button class="button" type="button" [disabled]="loadingMore()" (click)="loadMore()">{{ loadingMore() ? 'Loading…' : 'Load More' }}</button>
          </div>
        }
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffBusinessPage implements OnInit {
  private readonly todayDate = this.today();
  readonly business = signal<StaffBusiness | null>(null);
  readonly preset = signal<BusinessPreset>("1m");
  readonly fromDate = signal(this.monthsAgo(this.todayDate, 1));
  readonly toDate = signal(this.todayDate);
  readonly search = signal("");
  readonly status = signal("all");
  readonly sort = signal<"asc" | "desc">("desc");
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly exporting = signal(false);
  readonly message = signal("");
  readonly appointmentGroups = computed(() => {
    const data = this.business();
    if (!data) return [];
    const summaries = new Map(data.dailyBreakdown.map((day) => [day.date, day]));
    const groups = new Map<string, StaffBusinessAppointment[]>();
    for (const item of data.appointments) {
      if (!groups.has(item.businessDate)) groups.set(item.businessDate, []);
      groups.get(item.businessDate)!.push(item);
    }
    return [...groups.entries()].map(([date, appointments]) => ({
      date,
      appointments,
      summary: summaries.get(date) as StaffBusinessSummary
    }));
  });

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadBusiness()) void this.load(true); }

  async load(reset: boolean) {
    if (!this.validRange()) return;
    const current = this.business();
    const page = reset ? 1 : Number(current?.pagination.page || 1) + 1;
    reset ? this.loading.set(true) : this.loadingMore.set(true);
    this.message.set("");
    try {
      const data = await this.staff.business(this.query(page));
      if (reset || !current) {
        this.business.set(data);
      } else {
        const byId = new Map([...current.appointments, ...data.appointments].map((item) => [item.id, item]));
        this.business.set({ ...data, appointments: [...byId.values()] });
      }
    } catch {
      // StaffAppService exposes the API error message in its error signal.
    } finally {
      this.loading.set(false);
      this.loadingMore.set(false);
    }
  }

  changePreset(preset: BusinessPreset) {
    this.preset.set(preset);
    this.message.set("");
    if (preset === "custom") return;
    this.toDate.set(this.todayDate);
    this.fromDate.set(preset === "today" ? this.todayDate : this.monthsAgo(this.todayDate, preset === "1y" ? 12 : Number(preset.slice(0, -1))));
    void this.load(true);
  }

  apply() { void this.load(true); }
  loadMore() { if (this.business()?.pagination.hasMore) void this.load(false); }

  canReadBusiness(): boolean { return this.staff.hasAnyPermission(["read:appointments", "read:staff"]); }
  canUpdateBusiness(): boolean { return this.staff.hasAnyPermission(["write:staff", "update:staff", "write:appointments", "update:appointments"]); }
  formatMinutes(minutes: number): string { const safe = Math.max(0, Number(minutes || 0)); return `${Math.floor(safe / 60)}h ${safe % 60}m`; }
  formatMoney(paise: number): string { return (Number(paise || 0) / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  dateLabel(date: string): string { return new Date(`${date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }); }
  rangeLabel(): string { return `${this.dateLabel(this.fromDate())} – ${this.dateLabel(this.toDate())}`; }
  isToday(item: StaffBusinessAppointment): boolean { return item.businessDate === this.todayDate; }
  canStartService(status: string) { return ["queued", "pending", "scheduled", "booked", "confirmed", "arrived"].includes(String(status || "").toLowerCase()); }
  canCompleteService(status: string) { return ["in-service", "in service", "inprogress", "in progress", "running", "active", "started", "scheduled", "pending", "arrived", "confirmed", "booked"].includes(String(status || "").toLowerCase()); }

  async exportCsv() {
    if (!this.validRange()) return;
    this.exporting.set(true);
    try {
      const blob = await this.staff.businessCsv(this.query());
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `staff-business-${this.fromDate()}-to-${this.toDate()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      this.message.set("Business report exported.");
    } catch {
      this.message.set(this.staff.error() || "Unable to export business report.");
    } finally {
      this.exporting.set(false);
    }
  }

  async startService(appointmentId: string) {
    try { await this.staff.startService(appointmentId); await this.reloadLoadedPages(); this.message.set("Service started."); }
    catch { this.message.set(this.staff.error() || "Unable to start service."); }
  }

  async completeService(appointmentId: string) {
    try { await this.staff.completeService(appointmentId); await this.reloadLoadedPages(); this.message.set("Service completed."); }
    catch { this.message.set(this.staff.error() || "Unable to complete service."); }
  }

  private query(page = 1): StaffBusinessQuery {
    return {
      from: this.fromDate(),
      to: this.toDate(),
      page,
      pageSize: 50,
      q: this.search().trim(),
      status: this.status(),
      sort: this.sort()
    };
  }

  private validRange(): boolean {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(this.fromDate()) && /^\d{4}-\d{2}-\d{2}$/.test(this.toDate()) && this.fromDate() <= this.toDate();
    if (!valid) this.message.set("Choose a valid From date on or before the To date.");
    return valid;
  }

  private async reloadLoadedPages() {
    const pages = Math.max(1, this.business()?.pagination.page || 1);
    await this.load(true);
    for (let page = 1; page < pages && this.business()?.pagination.hasMore; page += 1) await this.load(false);
  }

  private monthsAgo(date: string, months: number): string {
    const [year, month, day] = date.split("-").map(Number);
    const target = year * 12 + month - 1 - months;
    const targetYear = Math.floor(target / 12);
    const targetMonth = target - targetYear * 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  }

  private today(): string {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value["year"]}-${value["month"]}-${value["day"]}`;
  }
}
