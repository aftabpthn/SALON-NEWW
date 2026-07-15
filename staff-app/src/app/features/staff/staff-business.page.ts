import { DatePipe } from "@angular/common";
import { Component, computed, HostListener, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  StaffAppService,
  StaffBusiness,
  StaffBusinessAppointment,
  StaffBusinessInvoiceDetail,
  StaffBusinessQuery,
} from "../../core/staff-app.service";
import { businessDate } from "../../core/business-date";
import { formatPaiseInr } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

type BusinessPreset = "today" | "1m" | "3m" | "6m" | "1y" | "custom";
type SearchSuggestion = { type: "Service" | "Invoice"; value: string };

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head">
        <div><p class="eyebrow">My business</p><h1>Work & billing</h1><p>Appointments, service time and billing across any selected period.</p></div>
      </header>

      @if (!canReadBusiness()) { <section staffPageState class="notice">You do not have permission to read staff business data.</section> }
      @if (message()) { <section staffPageState class="notice">{{ message() }}</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading business report...</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

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
            <div class="search-field">
              <label for="business-search">Search</label>
              <div class="search-control">
                <input id="business-search" type="search" autocomplete="off" role="combobox" aria-controls="business-search-suggestions" [attr.aria-expanded]="showSearchSuggestions() && searchSuggestions().length > 0" [ngModel]="search()" (ngModelChange)="search.set($event)" (focus)="showSearchSuggestions.set(true)" (blur)="closeSearchSuggestions()" (keydown.enter)="apply()" placeholder="Service or invoice" />
                @if (showSearchSuggestions() && searchSuggestions().length) {
                  <div id="business-search-suggestions" class="search-suggestions" role="listbox">
                    @for (suggestion of searchSuggestions(); track suggestion.type + suggestion.value) {
                      <button type="button" role="option" (pointerdown)="$event.preventDefault()" (click)="selectSuggestion(suggestion)">
                        <span>{{ suggestion.value }}</span><small>{{ suggestion.type }}</small>
                      </button>
                    }
                  </div>
                }
              </div>
            </div>
            <label>Status
              <select [ngModel]="status()" (ngModelChange)="status.set($event)">
                <option value="all">All Statuses</option>
                <option value="booked">Booked</option>
                <option value="confirmed">Confirmed</option>
                <option value="arrived">Arrived</option>
                <option value="in-service">In Service</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="no-show">No-Show</option>
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
            <button class="button" type="button" [disabled]="!activeFilterCount()" (click)="clearFilters()">Clear filters</button>
            @if (activeFilterCount()) { <span class="badge">{{ activeFilterCount() }} active {{ activeFilterCount() === 1 ? 'filter' : 'filters' }}</span> }
          </div>
        </section>
      }

      @if (canReadBusiness() && business(); as data) {
        <section class="grid four business-kpi-grid">
          <article class="kpi"><span>Appointments</span><strong>{{ data.summary.appointments }}</strong></article>
          <article class="kpi"><span>Services</span><strong>{{ data.summary.completedServices }}</strong></article>
          @if (data.billingVisible) {
            <article class="kpi"><span>My revenue</span><strong>{{ formatMoney(data.performance.attributedAfterDiscountPaise) }}</strong></article>
            <article class="kpi"><span>Avg bill</span><strong>{{ formatMoney(data.performance.averageBillPaise) }}</strong></article>
          } @else {
            <article class="kpi"><span>Billing</span><strong>Restricted</strong></article>
            <article class="kpi"><span>Services</span><strong>{{ data.summary.completedServices }}</strong></article>
          }
        </section>

        <section class="grid four business-kpi-grid">
          <article class="kpi"><span>Worked</span><strong>{{ formatMinutes(data.summary.workedMinutes) }}</strong></article>
          <article class="kpi"><span>Scheduled</span><strong>{{ formatMinutes(data.summary.scheduledMinutes) }}</strong></article>
          <article class="kpi"><span>Duty</span><strong>{{ formatMinutes(data.performance.dutyMinutes) }}</strong></article>
          <article class="kpi"><span>Utilization</span><strong>{{ formatPercent(data.performance.utilizationPercent) }}</strong></article>
        </section>

        <details class="panel performance-chart-panel">
          <summary>Performance charts</summary>
          <div class="performance-chart-grid">
            <article class="chart-card">
              <h3>Status distribution</h3>
              @for (statusItem of statusMetrics(data); track statusItem.label) {
                <div class="chart-row">
                  <span>{{ statusItem.label }}</span>
                  <div class="chart-track"><i [style.width.%]="statusChartPercent(statusItem.value, data)"></i></div>
                  <strong>{{ statusItem.value }}</strong>
                </div>
              }
            </article>
            <article class="chart-card">
              <h3>Time comparison</h3>
              @for (timeItem of timeChart(data); track timeItem.label) {
                <div class="chart-row">
                  <span>{{ timeItem.label }}</span>
                  <div class="chart-track"><i [style.width.%]="timeItem.percent"></i></div>
                  <strong>{{ formatMinutes(timeItem.value) }}</strong>
                </div>
              }
            </article>
            <article class="chart-card utilization-chart">
              <h3>Utilization</h3>
              <strong>{{ formatPercent(data.performance.utilizationPercent) }}</strong>
              <div class="chart-track"><i [style.width.%]="capProgress(data.performance.utilizationPercent || 0)"></i></div>
              <small>Worked time compared with duty time</small>
            </article>
            @if (data.billingVisible) {
              <article class="chart-card">
                <h3>Revenue comparison</h3>
                @for (revenueItem of revenueChart(data); track revenueItem.label) {
                  <div class="chart-row">
                    <span>{{ revenueItem.label }}</span>
                    <div class="chart-track"><i [style.width.%]="revenueItem.percent"></i></div>
                    <strong>{{ formatMoney(revenueItem.value) }}</strong>
                  </div>
                }
              </article>
            }
          </div>
        </details>

        <details class="panel">
          <summary>Status mix · Filtered work</summary>
          <div class="grid four">
            @for (statusItem of statusMetrics(data); track statusItem.label) {
              <article class="kpi"><span>{{ statusItem.label }}</span><strong>{{ statusItem.value }}</strong></article>
            }
          </div>
        </details>

        @if (data.billingVisible) {
          <details class="panel">
            <summary>Connected invoice totals · {{ data.summary.bills }} bills</summary>
            <section class="grid four">
              <article class="kpi"><span>Bill amount</span><strong>{{ formatMoney(data.summary.subtotalPaise) }}</strong></article>
              <article class="kpi"><span>Manual discount</span><strong>{{ formatMoney(data.summary.discountPaise) }}</strong></article>
              <article class="kpi"><span>Coupon discount</span><strong>{{ formatMoney(data.summary.couponDiscountPaise) }}</strong></article>
              <article class="kpi"><span>After discount</span><strong>{{ formatMoney(data.summary.afterDiscountPaise) }}</strong></article>
              <article class="kpi"><span>GST</span><strong>{{ formatMoney(data.summary.gstPaise) }}</strong></article>
              <article class="kpi"><span>Grand total</span><strong>{{ formatMoney(data.summary.totalPaise) }}</strong></article>
              <article class="kpi"><span>Paid</span><strong>{{ formatMoney(data.summary.paidPaise) }}</strong></article>
              <article class="kpi"><span>Due</span><strong>{{ formatMoney(data.summary.duePaise) }}</strong></article>
            </section>
          </details>
        }

        @if (data.earnings; as earnings) {
          <details class="panel">
            <summary>Earnings & payroll</summary>
            <section class="grid four">
              <article class="kpi"><span>Calculated commission</span><strong>{{ formatMoney(earnings.calculatedCommissionPaise) }}</strong><small>{{ formatMoney(earnings.approvedCommissionPaise) }} approved</small></article>
              <article class="kpi"><span>Tips collected</span><strong>{{ formatMoney(earnings.tipsCollectedPaise) }}</strong><small>{{ formatMoney(earnings.tipsPendingPaise) }} pending payout</small></article>
              <article class="kpi"><span>Payroll net</span><strong>{{ formatMoney(earnings.payrollNetPaise) }}</strong><small>{{ formatMoney(earnings.payrollGrossPaise) }} gross</small></article>
              <article class="kpi"><span>Payroll paid</span><strong>{{ formatMoney(earnings.payrollPaidPaise) }}</strong><small>{{ formatMoney(earnings.payrollPendingPaise) }} pending</small></article>
            </section>
            @for (period of earnings.periods; track period.payrollRunId) {
              <p>{{ dateLabel(period.periodStart) }} – {{ dateLabel(period.periodEnd) }} · {{ period.status }} · Net {{ formatMoney(period.netPaise) }}</p>
            }
          </details>
        } @else if (!data.permissions.earnings) {
          <section staffPageState class="notice">Earnings and payroll are restricted for your role.</section>
        }

        @if (data.targets.length) {
          <section class="panel">
            <div class="panel-title"><h2>Overlapping targets</h2><span>Saved period values, not prorated</span></div>
            <div class="grid four">
              @for (target of data.targets; track target.id) {
                <article class="kpi">
                  <span>{{ target.type }}</span>
                  <strong>{{ formatTargetValue(target.achievedValue, target.unit) }} / {{ formatTargetValue(target.targetValue, target.unit) }}</strong>
                  <small>{{ target.progressPercent }}% · {{ dateLabel(target.periodStart) }}–{{ dateLabel(target.periodEnd) }}</small>
                  <div class="timer-track"><span [style.width.%]="capProgress(target.progressPercent)"></span></div>
                </article>
              }
            </div>
          </section>
        }

        <section class="panel">
          <div class="panel-title">
            <h2>Detailed work</h2>
            <span>Showing {{ data.appointments.length }} of {{ data.pagination.totalItems }}</span>
          </div>
        </section>

        @for (group of appointmentGroups(); track group.date) {
          <section class="panel business-day-panel">
            <div class="panel-title business-day-title">
              <h2>{{ dateLabel(group.date) }}</h2>
              <span>{{ group.summary.appointments }} {{ group.summary.appointments === 1 ? 'appointment' : 'appointments' }}</span>
            </div>
            <div class="list business-appointment-list">
              @for (item of group.appointments; track item.id) {
                <details class="business-appointment-row">
                  <summary>
                    <span class="appointment-summary">
                      <strong>{{ item.startAt | date:'shortTime':'+0530' }}–{{ item.endAt | date:'shortTime':'+0530' }}</strong>
                      <small>{{ item.serviceNames.join(', ') || 'Service not mapped' }}</small>
                    </span>
                    <span class="expand-indicator" aria-hidden="true"></span>
                  </summary>
                  <div class="appointment-expanded">
                    <div class="row-main">
                     <strong>Assigned appointment</strong>
                     <small>{{ item.chair || 'No chair' }}</small>
                    <small>{{ formatMinutes(liveElapsed(item)) }} worked · {{ formatMinutes(item.durationMinutes) }} scheduled · {{ item.timer.timeSource === 'actual' ? 'Actual' : 'Estimated' }}</small>
                    @if (item.timer.startedAt) { <small>Actual start {{ item.timer.startedAt | date:'shortTime':'+0530' }} @if (item.timer.completedAt) { · End {{ item.timer.completedAt | date:'shortTime':'+0530' }} }</small> }
                    @if (item.timer.live) {
                      <div class="timer-track"><span [style.width.%]="liveProgress(item)"></span></div>
                      <small>{{ liveElapsed(item) }} min elapsed · {{ liveRemaining(item) }} min remaining @if (liveOverrun(item)) { · {{ liveOverrun(item) }} min overrun }</small>
                    }
                    @if (!item.timer.live && item.timer.overrunMinutes) { <small>{{ item.timer.overrunMinutes }} min overrun</small> }
                    @if (data.billingVisible && item.attribution; as share) {
                      <p><strong>My attributed revenue {{ formatMoney(share.afterDiscountPaise) }}</strong></p>
                      <small>Gross {{ formatMoney(share.grossPaise) }} · Discount {{ formatMoney(share.discountPaise) }} · GST {{ formatMoney(share.gstPaise) }} · Paid {{ formatMoney(share.paidPaise) }} · Due {{ formatMoney(share.duePaise) }}</small>
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
                      <button class="link-button" type="button" (click)="openAppointment(item, $event)">Details</button>
                      @if (data.permissions.invoiceDetail && item.billing?.invoiceId) { <button class="link-button" type="button" (click)="openInvoice(item, $event)">Invoice</button> }
                    </div>
                  </div>
                </details>
              }
            </div>
            <details class="business-day-summary">
              <summary>Day summary</summary>
              <p>{{ group.summary.completedServices }} completed · {{ formatMinutes(group.summary.workedMinutes) }} worked · {{ formatPercent(group.summary.performance.utilizationPercent) }} utilized</p>
              @if (data.billingVisible) {
                <p>Bill {{ formatMoney(group.summary.subtotalPaise) }} · Discount {{ formatMoney(group.summary.discountPaise) }} · Coupon {{ formatMoney(group.summary.couponDiscountPaise) }} · Due {{ formatMoney(group.summary.duePaise) }}</p>
              }
            </details>
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

      @if (selectedAppointment(); as item) {
        <div class="drawer-backdrop" (click)="dismissBackdrop($event)">
          <aside id="business-appointment-drawer" class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="business-appointment-title" tabindex="-1">
            <div class="panel-title"><h2 id="business-appointment-title">Appointment detail</h2><button class="link-button" type="button" (click)="closeDrawers()">Close</button></div>
            <section class="grid two compact-grid">
              <article class="kpi"><span>Work item</span><strong>Assigned appointment</strong></article>
              <article class="kpi"><span>Status</span><strong>{{ item.status }}</strong></article>
              <article class="kpi"><span>Worked</span><strong>{{ formatMinutes(liveElapsed(item)) }}</strong><small>{{ item.timer.timeSource }}</small></article>
              <article class="kpi"><span>Scheduled</span><strong>{{ formatMinutes(item.durationMinutes) }}</strong><small>{{ item.timer.overrunMinutes }} min overrun</small></article>
            </section>
            <div class="list">
              <div class="row"><strong>Time</strong><span>{{ item.startAt | date:'short':'+0530' }} – {{ item.endAt | date:'shortTime':'+0530' }}</span></div>
              <div class="row"><strong>Services</strong><span>{{ item.serviceNames.join(', ') || '-' }}</span></div>
              <div class="row"><strong>Chair</strong><span>{{ item.chair || '-' }}</span></div>
            </div>
          </aside>
        </div>
      }

      @if (invoiceDrawerOpen()) {
        <div class="drawer-backdrop" (click)="dismissBackdrop($event)">
          <aside id="business-invoice-drawer" class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="business-invoice-title" tabindex="-1">
            <div class="panel-title"><h2 id="business-invoice-title">Invoice detail</h2><button class="link-button" type="button" (click)="closeDrawers()">Close</button></div>
            @if (invoiceLoading()) { <section staffPageState class="state" [loading]="true">Loading invoice...</section> }
            @if (invoiceError()) { <section staffPageState class="notice">{{ invoiceError() }}</section> }
            @if (invoiceDetail(); as invoice) {
              <section class="grid two compact-grid">
                <article class="kpi"><span>Invoice</span><strong>{{ invoice.invoiceNumber || invoice.id }}</strong><small>{{ invoice.status }}</small></article>
                <article class="kpi"><span>Total</span><strong>{{ formatMoney(invoice.totals.totalPaise) }}</strong><small>{{ formatMoney(invoice.totals.duePaise) }} due</small></article>
              </section>
              @if (invoice.clientName) { <div class="list"><div class="row"><strong>Client name</strong><span>{{ invoice.clientName }}</span></div></div> }
              <div class="list">
                @for (item of invoice.items; track item.id) {
                  <div class="row"><div><strong>{{ item.name }}</strong><small>{{ item.type }} · Qty {{ item.quantity }}</small></div><span>{{ formatMoney(item.amountPaise) }}</span></div>
                } @empty { <p class="empty">No invoice items available.</p> }
              </div>
              <h3>Payments</h3>
              <div class="list">
                @for (payment of invoice.payments; track payment.id) {
                  <div class="row"><div><strong>{{ payment.mode || 'Payment' }}</strong><small>{{ payment.createdAt | date:'short':'+0530' }}</small></div><span>{{ formatMoney(payment.amountPaise) }}</span></div>
                } @empty { <p class="empty">No payments recorded.</p> }
              </div>
            }
          </aside>
        </div>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .search-field { display: grid; gap: 7px; min-width: 0; color: var(--staff-text); font-size: .8rem; font-weight: 700; }
    .search-control { position: relative; }
    .search-control input { width: 100%; }
    .search-suggestions { position: absolute; z-index: 20; top: calc(100% + 5px); right: 0; left: 0; overflow: hidden; border: 1px solid var(--staff-border); border-radius: 16px; background: var(--staff-surface); box-shadow: var(--staff-shadow-elevated); }
    .search-suggestions button { display: flex; width: 100%; min-height: 48px; align-items: center; justify-content: space-between; gap: 10px; border: 0; border-bottom: 1px solid var(--staff-border); border-radius: 0; padding: 10px 12px; color: var(--staff-text); background: transparent; text-align: left; }
    .search-suggestions button:last-child { border-bottom: 0; }
    .search-suggestions button:hover, .search-suggestions button:focus-visible { background: var(--staff-primary-light); }
    .search-suggestions span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .search-suggestions small { flex: 0 0 auto; color: var(--staff-primary-hover); font-size: .62rem; font-weight: 750; text-transform: uppercase; }
    @media (max-width: 700px) {
      .grid.four.business-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .business-kpi-grid .kpi { min-height: 68px; padding: 9px 10px; }
      .business-kpi-grid .kpi span { font-size: .62rem; line-height: 1.2; }
      .business-kpi-grid .kpi strong { margin-top: 4px; font-size: 1.18rem; line-height: 1; }
    }
  `]
})
export class StaffBusinessPage implements OnInit, OnDestroy {
  private readonly todayDate = this.today();
  readonly business = signal<StaffBusiness | null>(null);
  readonly preset = signal<BusinessPreset>("1m");
  readonly fromDate = signal(this.monthsAgo(this.todayDate, 1));
  readonly toDate = signal(this.todayDate);
  readonly search = signal("");
  readonly showSearchSuggestions = signal(false);
  readonly status = signal("all");
  readonly sort = signal<"asc" | "desc">("desc");
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly message = signal("");
  readonly clock = signal(Date.now());
  readonly selectedAppointment = signal<StaffBusinessAppointment | null>(null);
  readonly invoiceDrawerOpen = signal(false);
  readonly invoiceDetail = signal<StaffBusinessInvoiceDetail | null>(null);
  readonly invoiceLoading = signal(false);
  readonly invoiceError = signal("");
  readonly activeFilterCount = computed(() =>
    Number(Boolean(this.search().trim())) + Number(this.status() !== "all") + Number(this.sort() !== "desc")
  );
  readonly searchSuggestions = computed<SearchSuggestion[]>(() => {
    const query = this.search().trim().toLocaleLowerCase();
    if (query.length < 2) return [];

    const suggestions: SearchSuggestion[] = [];
    const seen = new Set<string>();
    const add = (type: SearchSuggestion["type"], value: string | null | undefined) => {
      const cleanValue = value?.trim();
      const key = `${type}:${cleanValue?.toLocaleLowerCase()}`;
      if (!cleanValue || !cleanValue.toLocaleLowerCase().includes(query) || seen.has(key)) return;
      seen.add(key);
      suggestions.push({ type, value: cleanValue });
    };

    for (const appointment of this.business()?.appointments || []) {
      add("Invoice", appointment.billing?.invoiceNumber || appointment.billing?.saleId);
    }
    for (const service of this.business()?.services || []) add("Service", service.name);

    return suggestions
      .sort((a, b) => Number(!a.value.toLocaleLowerCase().startsWith(query)) - Number(!b.value.toLocaleLowerCase().startsWith(query)) || a.value.localeCompare(b.value))
      .slice(0, 6);
  });
  private clockTimer?: ReturnType<typeof setInterval>;
  private drawerTrigger: HTMLElement | null = null;
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
      summary: summaries.get(date)!
    }));
  });

  constructor(readonly staff: StaffAppService) {}
  private loadGeneration = 0;

  ngOnInit() {
    this.clockTimer = setInterval(() => this.clock.set(Date.now()), 60_000);
    if (this.canReadBusiness()) void this.load(true);
  }

  ngOnDestroy() {
    if (this.clockTimer) clearInterval(this.clockTimer);
  }

  async load(reset: boolean) {
    if (!this.validRange()) return;
    const generation = ++this.loadGeneration;
    const current = this.business();
    const page = reset ? 1 : Number(current?.pagination.page || 1) + 1;
    reset ? this.loading.set(true) : this.loadingMore.set(true);
    this.message.set("");
    try {
      const data = await this.staff.business(this.query(page));
      if (generation !== this.loadGeneration) return;
      if (reset || !current) {
        this.business.set(data);
      } else {
        const byId = new Map([...current.appointments, ...data.appointments].map((item) => [item.id, item]));
        this.business.set({ ...data, appointments: [...byId.values()] });
      }
    } catch {
      // StaffAppService exposes the API error message in its error signal.
    } finally {
      if (generation === this.loadGeneration) {
        this.loading.set(false);
        this.loadingMore.set(false);
      }
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

  apply() { this.showSearchSuggestions.set(false); void this.load(true); }
  loadMore() { if (this.business()?.pagination.hasMore) void this.load(false); }

  closeSearchSuggestions() { setTimeout(() => this.showSearchSuggestions.set(false)); }

  selectSuggestion(suggestion: SearchSuggestion) {
    this.search.set(suggestion.value);
    this.apply();
  }

  clearFilters() {
    this.search.set("");
    this.showSearchSuggestions.set(false);
    this.status.set("all");
    this.sort.set("desc");
    void this.load(true);
  }

  canReadBusiness(): boolean { return this.staff.hasPermission("read:appointments"); }
  formatMinutes(minutes: number): string { const safe = Math.max(0, Number(minutes || 0)); return `${Math.floor(safe / 60)}h ${safe % 60}m`; }
  formatMoney(paise: number | null): string { return formatPaiseInr(paise); }
  formatPercent(value: number | null): string { return value === null ? "—" : `${value}%`; }
  capProgress(value: number): number { return Math.max(0, Math.min(100, Number(value || 0))); }
  formatTargetValue(value: number, unit: "paise" | "count" | "percent"): string {
    if (unit === "paise") return this.formatMoney(value);
    return unit === "percent" ? `${value}%` : Number(value || 0).toLocaleString("en-IN");
  }
  statusMetrics(data: StaffBusiness) {
    const counts = data.performance.statusCounts;
    return [
      { label: "Booked", value: counts.booked },
      { label: "Confirmed", value: counts.confirmed },
      { label: "Arrived", value: counts.arrived },
      { label: "In service", value: counts.inService },
      { label: "Completed", value: counts.completed },
      { label: "Cancelled", value: counts.cancelled },
      { label: "No-show", value: counts.noShow },
      { label: "Other", value: counts.other }
    ];
  }
  statusChartPercent(value: number, data: StaffBusiness): number {
    return data.summary.appointments ? this.capProgress((value / data.summary.appointments) * 100) : 0;
  }
  timeChart(data: StaffBusiness) {
    const rows = [
      { label: "Worked", value: data.summary.workedMinutes },
      { label: "Scheduled", value: data.summary.scheduledMinutes },
      { label: "Duty", value: data.performance.dutyMinutes }
    ];
    const maximum = Math.max(1, ...rows.map((row) => row.value));
    return rows.map((row) => ({ ...row, percent: this.capProgress((row.value / maximum) * 100) }));
  }
  revenueChart(data: StaffBusiness) {
    const rows = [
      { label: "My revenue", value: Number(data.performance.attributedAfterDiscountPaise || 0) },
      { label: "Avg bill", value: Number(data.performance.averageBillPaise || 0) },
      { label: "Per hour", value: Number(data.performance.revenuePerWorkedHourPaise || 0) }
    ];
    const maximum = Math.max(1, ...rows.map((row) => row.value));
    return rows.map((row) => ({ ...row, percent: this.capProgress((row.value / maximum) * 100) }));
  }
  dateLabel(date: string): string { return new Date(`${date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }); }
  rangeLabel(): string { return `${this.dateLabel(this.fromDate())} – ${this.dateLabel(this.toDate())}`; }

  liveElapsed(item: StaffBusinessAppointment): number {
    this.clock();
    if (!item.timer.live || !item.timer.startedAt) return item.timer.elapsedMinutes;
    return Math.max(0, Math.round((Date.now() - new Date(item.timer.startedAt).getTime()) / 60_000));
  }

  liveRemaining(item: StaffBusinessAppointment): number {
    return Math.max(0, item.durationMinutes - this.liveElapsed(item));
  }

  liveOverrun(item: StaffBusinessAppointment): number {
    return Math.max(0, this.liveElapsed(item) - item.durationMinutes);
  }

  liveProgress(item: StaffBusinessAppointment): number {
    return item.durationMinutes ? this.capProgress((this.liveElapsed(item) / item.durationMinutes) * 100) : 0;
  }

  openAppointment(item: StaffBusinessAppointment, event: Event) {
    this.drawerTrigger = event.currentTarget as HTMLElement;
    this.invoiceDrawerOpen.set(false);
    this.invoiceDetail.set(null);
    this.selectedAppointment.set(item);
    setTimeout(() => document.getElementById("business-appointment-drawer")?.focus());
  }

  async openInvoice(item: StaffBusinessAppointment, event: Event) {
    const invoiceId = item.billing?.invoiceId;
    if (!invoiceId || !this.business()?.permissions.invoiceDetail) return;
    this.drawerTrigger = event.currentTarget as HTMLElement;
    this.selectedAppointment.set(null);
    this.invoiceDrawerOpen.set(true);
    this.invoiceDetail.set(null);
    this.invoiceError.set("");
    this.invoiceLoading.set(true);
    setTimeout(() => document.getElementById("business-invoice-drawer")?.focus());
    try {
      this.invoiceDetail.set(await this.staff.businessInvoice(invoiceId));
    } catch {
      this.invoiceError.set(this.staff.error() || "Unable to load invoice detail.");
    } finally {
      this.invoiceLoading.set(false);
    }
  }

  dismissBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) this.closeDrawers();
  }

  closeDrawers() {
    this.selectedAppointment.set(null);
    this.invoiceDrawerOpen.set(false);
    this.invoiceDetail.set(null);
    this.invoiceError.set("");
    const trigger = this.drawerTrigger;
    this.drawerTrigger = null;
    setTimeout(() => trigger?.focus());
  }

  @HostListener("document:keydown.escape")
  onEscape() {
    if (this.selectedAppointment() || this.invoiceDrawerOpen()) this.closeDrawers();
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

  private monthsAgo(date: string, months: number): string {
    const [year, month, day] = date.split("-").map(Number);
    const target = year * 12 + month - 1 - months;
    const targetYear = Math.floor(target / 12);
    const targetMonth = target - targetYear * 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  }

  private today(): string {
    return businessDate();
  }
}
