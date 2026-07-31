import { DatePipe } from "@angular/common";
import { Component, computed, HostListener, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  StaffAppService,
  StaffBusiness,
  StaffBusinessAppointment,
  StaffBusinessInvoiceDetail,
  StaffBusinessQuery,
  StaffBusinessServiceInvoice,
} from "../../core/staff-app.service";
import { businessDate, displayBusinessDate, parseDisplayBusinessDate } from "../../core/business-date";
import { formatPaiseInr } from "../../core/paise-inr.pipe";
import { StaffDatePickerComponent } from "../../shared/staff-date-picker.component";
import { StaffPageStateComponent } from "./staff-page-state.component";

type BusinessPreset = "today" | "1m" | "3m" | "6m" | "1y" | "custom";
type SearchSuggestion = { type: "Service" | "Invoice"; value: string };

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, StaffDatePickerComponent, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head">
        <div><p class="eyebrow">My business</p><h1>Work & billing</h1><p>Appointments, service time and billing across any selected period.</p></div>
      </header>

      @if (!canReadBusiness()) { <section staffPageState class="notice">You do not have permission to read staff business data.</section> }
      @if (message()) { <section staffPageState class="notice">{{ message() }}</section> }
      @if (loading() && !business()) {
        <section class="business-skeleton" aria-label="Loading business report">
          <div class="skeleton business-filter-skeleton"></div>
          <div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
          <span class="skeleton business-list-skeleton"></span>
        </section>
      }
      @if (loadError()) { <section staffPageState class="notice business-error"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" (click)="load(true)">Retry</button></section> }
      @if (staff.error() && !loadError()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

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
              <label>From<aura-staff-date-picker [value]="displayDate(fromDate())" ariaLabel="Business report from date" (valueChange)="fromDate.set(parseDate($event))" /></label>
              <label>To<aura-staff-date-picker [value]="displayDate(toDate())" ariaLabel="Business report to date" (valueChange)="toDate.set(parseDate($event))" /></label>
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
            <button class="button primary" type="button" [disabled]="loading()" [attr.aria-busy]="loading()" (click)="apply()">{{ loading() ? 'Applying...' : 'Apply' }}</button>
            <button class="button" type="button" [disabled]="!activeFilterCount() || loading()" (click)="clearFilters()">Clear filters</button>
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
            <summary>My service totals · {{ data.summary.bills }} invoices</summary>
            <section class="grid four">
              @if (data.permissions.serviceAmount) {
                <article class="kpi"><span>Original amount</span><strong>{{ formatMoney(data.summary.subtotalPaise) }}</strong></article>
                <article class="kpi"><span>Taxable amount</span><strong>{{ formatMoney(data.summary.afterDiscountPaise) }}</strong></article>
                <article class="kpi"><span>Final service total</span><strong>{{ formatMoney(data.summary.totalPaise) }}</strong></article>
              }
              @if (data.permissions.discount) { <article class="kpi"><span>Discount</span><strong>{{ formatMoney(data.summary.discountPaise) }}</strong></article> }
              @if (data.permissions.tax) { <article class="kpi"><span>GST</span><strong>{{ formatMoney(data.summary.gstPaise) }}</strong></article> }
            </section>
          </details>

          @if (data.permissions.serviceAmount) {
            <details class="panel">
              <summary>Revenue attribution</summary>
              <section class="grid four">
                <article class="kpi"><span>Service</span><strong>{{ formatMoney(data.performance.serviceRevenuePaise) }}</strong></article>
                <article class="kpi"><span>Product</span><strong>{{ formatMoney(data.performance.productRevenuePaise) }}</strong></article>
                <article class="kpi"><span>Membership</span><strong>{{ formatMoney(data.performance.membershipRevenuePaise) }}</strong></article>
                <article class="kpi"><span>Package</span><strong>{{ formatMoney(data.performance.packageRevenuePaise) }}</strong></article>
                <article class="kpi"><span>Gift card</span><strong>{{ formatMoney(data.performance.giftCardRevenuePaise) }}</strong></article>
              </section>
            </details>
          }
        }

        <section class="panel product-usage-panel">
          <div class="panel-title"><h2>Service product usage</h2><span>{{ (data.productUsageHistory || []).length }} recorded</span></div>
          <div class="usage-insights"><span>Product sales<strong>{{ formatMoney(data.performance.productRevenuePaise) }}</strong></span><span>Retail conversion<strong>{{ formatPercent(data.performance.retailConversionPercent) }}</strong></span><span>Product invoices<strong>{{ data.performance.productInvoiceCount ?? '—' }}</strong></span><span>Usage variance<strong>{{ usageVarianceTotal(data) }}</strong></span></div>
          @if (canRecordProductUsage()) {
            @if (productNotice()) { <section staffPageState class="notice">{{ productNotice() }}</section> }
            @if (productError()) { <section staffPageState class="notice business-error">{{ productError() }}</section> }
            <div class="form-grid usage-form">
              <label>Appointment
                <select [(ngModel)]="usageDraft.appointmentId" (ngModelChange)="usageAppointmentChanged()">
                  <option value="">Select appointment</option>
                  @for (item of usageAppointments(data); track item.id) { <option [value]="item.id">{{ usageAppointmentLabel(item) }}</option> }
                </select>
              </label>
              <label>Service
                <select [(ngModel)]="usageDraft.serviceId" (ngModelChange)="usageServiceChanged()">
                  <option value="">Select service</option>
                  @for (service of usageServices(data); track service.id) { <option [value]="service.id">{{ service.name }}</option> }
                </select>
              </label>
              <label>Product / brand
                <select [(ngModel)]="usageDraft.inventoryItemId">
                  <option value="">Select recipe product</option>
                  @for (product of usageProducts(data); track product.id) { <option [value]="product.id">{{ product.name }}{{ product.brand ? ' · ' + product.brand : '' }}</option> }
                </select>
              </label>
              <label>Expected<input [value]="expectedUsage(data)" readonly /></label>
              <label>Actual quantity<input type="number" min="1" step="1" [(ngModel)]="usageDraft.actualQuantity" /></label>
              <label>Variance / wastage reason<textarea maxlength="500" [(ngModel)]="usageDraft.notes"></textarea></label>
            </div>
            <div class="row-actions"><button class="button primary" type="button" [disabled]="productSaving()" (click)="submitProductUsage(data)">{{ productSaving() ? 'Submitting...' : 'Submit usage' }}</button></div>
          }
          <div class="list usage-history">
            @for (row of (data.productUsageHistory || []).slice(0, 10); track row.id) {
              <div class="row"><div class="row-main"><strong>{{ row.itemName }}{{ row.itemBrand ? ' · ' + row.itemBrand : '' }}</strong><small>{{ row.serviceName || 'Service' }} · Expected {{ row.expectedQuantity }} {{ row.unit }} · Actual {{ row.actualQuantity }} {{ row.unit }} · Variance {{ row.varianceQuantity }} {{ row.unit }}</small><small>{{ row.createdAt | date:'dd/MM/yyyy, h:mm a':'+0530' }}{{ row.notes ? ' · ' + row.notes : '' }}</small></div><span class="badge">{{ row.status }}</span></div>
            } @empty { <div class="business-empty"><p>No product usage recorded.</p></div> }
          </div>
        </section>

        <section class="panel">
          <div class="panel-title"><h2>My service invoices</h2><span>{{ loading() ? 'Refreshing...' : ((data.serviceInvoices || []).length + ' shown') }}</span></div>
          <div class="list">
            @for (line of (data.serviceInvoices || []); track line.saleId + ':' + line.id) {
              <div class="row service-invoice-row">
                <div class="row-main">
                  <strong>{{ line.serviceName }}</strong>
                  <small>{{ dateLabel(line.businessDate) }} · {{ line.refundStatus }} @if (line.splitPercent < 100) { · {{ line.splitPercent }}% share }</small>
                  @if (line.clientName) { <small>Client: {{ line.clientName }}</small> }
                  @if (line.invoiceNumber) { <small>Invoice: {{ line.invoiceNumber }}</small> }
                  @if (data.permissions.serviceAmount) { <small>Original {{ formatMoney(line.grossPaise) }} · Taxable {{ formatMoney(line.taxablePaise) }} · Final {{ formatMoney(line.totalPaise) }}</small> }
                  @if (data.permissions.discount) { <small>Discount {{ formatMoney(line.discountPaise) }}</small> }
                  @if (data.permissions.tax) { <small>GST {{ line.gstPercent ?? 0 }}% · {{ formatMoney(line.gstPaise) }} · CGST {{ formatMoney(line.cgstPaise) }} · SGST {{ formatMoney(line.sgstPaise) }} · IGST {{ formatMoney(line.igstPaise) }} · {{ line.taxMode || 'mode not recorded' }}</small> }
                  @if (data.permissions.serviceAmount && line.refundedPaise) { <small>Refund {{ formatMoney(line.refundedPaise) }} · Net {{ formatMoney(line.netTotalPaise) }}</small> }
                  @if (data.permissions.commission) { <small>Commission {{ formatMoney(line.commissionPaise) }}</small> }
                </div>
                @if (data.permissions.invoiceDetail) { <button class="link-button" type="button" [disabled]="invoiceLoading()" [attr.aria-busy]="invoiceLoading()" (click)="openInvoice(line, $event)">Invoice</button> }
              </div>
            } @empty { <div class="business-empty"><p>No service invoices found.</p><small>CRM invoices matching this staff scope and filter will appear here.</small></div> }
          </div>
        </section>

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
            <span>{{ loading() ? 'Refreshing...' : ('Showing ' + data.appointments.length + ' of ' + data.pagination.totalItems) }}</span>
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
                    </div>
                    <div class="row-actions">
                      <span class="badge" [class.red]="item.state === 'late'" [class.green]="item.state === 'active'">{{ item.status }}</span>
                      <button class="link-button" type="button" (click)="openAppointment(item, $event)">Details</button>
                    </div>
                  </div>
                </details>
              }
            </div>
            <details class="business-day-summary">
              <summary>Day summary</summary>
              <p>{{ group.summary.completedServices }} completed · {{ formatMinutes(group.summary.workedMinutes) }} worked · {{ formatPercent(group.summary.performance.utilizationPercent) }} utilized</p>
            </details>
          </section>
        } @empty {
          <section class="panel"><div class="business-empty"><p>No staff work found for this range and filters.</p><small>Try a wider date range or clear filters. Empty means no matching CRM records were returned.</small></div></section>
        }

        @if (data.pagination.hasMore) {
          <div class="row-actions permission-actions">
            <button class="button" type="button" [disabled]="loadingMore() || loading()" [attr.aria-busy]="loadingMore()" (click)="loadMore()">{{ loadingMore() ? 'Loading...' : 'Load More' }}</button>
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
            @if (invoiceError()) { <section staffPageState class="notice business-error"><span>{{ invoiceError() }}</span><button class="link-button" type="button" [disabled]="invoiceLoading()" (click)="retryInvoice()">Retry</button></section> }
            @if (invoiceDetail(); as invoice) {
              <section class="grid two compact-grid">
                @if (invoice.invoiceNumber) { <article class="kpi"><span>Invoice</span><strong>{{ invoice.invoiceNumber }}</strong><small>{{ invoice.status }}</small></article> }
                @if (business()?.permissions?.serviceAmount) { <article class="kpi"><span>My service total</span><strong>{{ formatMoney(invoice.totals.totalPaise) }}</strong></article> }
              </section>
              @if (invoice.clientName) { <div class="list"><div class="row"><strong>Client name</strong><span>{{ invoice.clientName }}</span></div></div> }
              <div class="list">
                @for (item of invoice.items; track item.id) {
                  <div class="row service-invoice-row"><div class="row-main"><strong>{{ item.serviceName }}</strong><small>Qty {{ item.quantity }} @if (item.splitPercent < 100) { · {{ item.splitPercent }}% share }</small>
                    @if (business()?.permissions?.serviceAmount) { <small>Original {{ formatMoney(item.grossPaise) }} · Taxable {{ formatMoney(item.taxablePaise) }} · Final {{ formatMoney(item.totalPaise) }}</small> }
                    @if (business()?.permissions?.discount) { <small>Discount {{ formatMoney(item.discountPaise) }}</small> }
                    @if (business()?.permissions?.tax) { <small>GST {{ item.gstPercent ?? 0 }}% · {{ formatMoney(item.gstPaise) }} · CGST {{ formatMoney(item.cgstPaise) }} · SGST {{ formatMoney(item.sgstPaise) }} · IGST {{ formatMoney(item.igstPaise) }} · {{ item.taxMode || 'mode not recorded' }}</small> }
                    @if (business()?.permissions?.serviceAmount && item.refundedPaise) { <small>Refund {{ formatMoney(item.refundedPaise) }} · Net {{ formatMoney(item.netTotalPaise) }}</small> }
                    @if (business()?.permissions?.commission) { <small>Commission {{ formatMoney(item.commissionPaise) }}</small> }
                  </div></div>
                } @empty { <p class="empty">No service lines available.</p> }
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
    .business-skeleton { display: grid; gap: 12px; }
    .business-filter-skeleton { min-height: 148px; }
    .business-list-skeleton { min-height: 280px; }
    .business-error { justify-content: space-between; }
    .business-empty { display: grid; justify-items: center; gap: 5px; padding: 24px 10px; color: var(--staff-text-secondary); font-weight: 600; text-align: center; }
    .business-empty p { margin: 0; }
    .business-empty small { font-weight: 600; line-height: 1.4; }
    .service-invoice-row .link-button { min-width: 112px; }
    .product-usage-panel, .usage-history { gap: 12px; }
    .usage-form { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .usage-form textarea { min-height: 46px; resize: vertical; }
    .usage-insights { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .usage-insights span { display: grid; gap: 4px; padding: 10px 12px; border: 1px solid var(--staff-border); border-radius: 14px; color: var(--staff-text-secondary); font-size: .72rem; font-weight: 700; }
    .usage-insights strong { color: var(--staff-text); font-size: 1rem; }
    @media (max-width: 700px) {
      .grid.four.business-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .business-kpi-grid .kpi { min-height: 68px; padding: 9px 10px; }
      .business-kpi-grid .kpi span { font-size: .62rem; line-height: 1.2; }
      .business-kpi-grid .kpi strong { margin-top: 4px; font-size: 1.18rem; line-height: 1; }
      .business-error, .service-invoice-row, .service-invoice-row .row-actions { align-items: stretch; flex-direction: column; }
      .business-error button, .service-invoice-row .link-button, .permission-actions .button { width: 100%; }
      .permission-actions { align-items: stretch; }
      .usage-form { grid-template-columns: 1fr; }
      .usage-insights { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .product-usage-panel .row-actions .button { width: 100%; }
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
  readonly loadError = signal("");
  readonly message = signal("");
  readonly clock = signal(Date.now());
  readonly selectedAppointment = signal<StaffBusinessAppointment | null>(null);
  readonly invoiceDrawerOpen = signal(false);
  readonly invoiceDetail = signal<StaffBusinessInvoiceDetail | null>(null);
  readonly invoiceLoading = signal(false);
  readonly invoiceError = signal("");
  readonly lastInvoiceLine = signal<StaffBusinessServiceInvoice | null>(null);
  readonly productSaving = signal(false);
  readonly productNotice = signal("");
  readonly productError = signal("");
  usageDraft = { appointmentId: "", serviceId: "", inventoryItemId: "", actualQuantity: null as number | null, notes: "" };
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

    for (const invoice of this.business()?.serviceInvoices || []) add("Invoice", invoice.invoiceNumber);
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
    this.loadError.set("");
    try {
      const data = await this.staff.business(this.query(page));
      if (generation !== this.loadGeneration) return;
      if (reset || !current) {
        this.business.set(data);
      } else {
        const byId = new Map([...current.appointments, ...data.appointments].map((item) => [item.id, item]));
        const serviceInvoices = new Map([...(current.serviceInvoices || []), ...(data.serviceInvoices || [])].map((item) => [`${item.saleId}:${item.id}`, item]));
        this.business.set({ ...data, appointments: [...byId.values()], serviceInvoices: [...serviceInvoices.values()] });
      }
    } catch {
      if (generation === this.loadGeneration) this.loadError.set(this.staff.error() || "Unable to load business report.");
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

  canReadBusiness(): boolean { return this.staff.hasPermission("staff.app.business.read"); }
  canRecordProductUsage(): boolean { return this.staff.hasAnyPermission(["staff.self_manage", "staff_self.write"]); }
  usageAppointments(data: StaffBusiness) { return data.appointments.filter((item) => item.clientId && !/cancel|no.?show|void/i.test(item.status)); }
  usageServices(data: StaffBusiness) {
    const appointment = data.appointments.find((item) => item.id === this.usageDraft.appointmentId);
    return appointment ? data.services.filter((service) => appointment.serviceIds.includes(service.id) && (service.productConsumption || []).length > 0) : [];
  }
  usageProducts(data: StaffBusiness) {
    const service = data.services.find((item) => item.id === this.usageDraft.serviceId);
    const ids = new Set((service?.productConsumption || []).map((line) => String(line.productId ?? line.itemId ?? line.inventoryItemId ?? "")));
    return (data.products || []).filter((product) => ids.has(product.id) && !product.dualUseStock);
  }
  expectedUsage(data: StaffBusiness): string {
    const line = data.services.find((item) => item.id === this.usageDraft.serviceId)?.productConsumption.find((item) => String(item.productId ?? item.itemId ?? item.inventoryItemId ?? "") === this.usageDraft.inventoryItemId);
    const product = (data.products || []).find((item) => item.id === this.usageDraft.inventoryItemId);
    const quantity = Number(line?.standardQty ?? line?.quantity ?? line?.qty ?? 0);
    return quantity > 0 ? `${quantity} ${product?.unit || ""}`.trim() : "—";
  }
  usageVarianceTotal(data: StaffBusiness): number { return (data.productUsageHistory || []).reduce((sum, row) => sum + Number(row.varianceQuantity || 0), 0); }
  usageAppointmentLabel(item: StaffBusinessAppointment): string { return `${this.dateLabel(item.businessDate)} · ${item.serviceNames.join(", ") || "Service"}`; }
  usageAppointmentChanged() {
    this.usageDraft.serviceId = ""; this.usageDraft.inventoryItemId = "";
    const services = this.business() ? this.usageServices(this.business()!) : [];
    if (services.length === 1) { this.usageDraft.serviceId = services[0].id; this.usageServiceChanged(); }
  }
  usageServiceChanged() { this.usageDraft.inventoryItemId = ""; }
  async submitProductUsage(data: StaffBusiness) {
    if (!this.canRecordProductUsage()) return;
    const appointment = data.appointments.find((item) => item.id === this.usageDraft.appointmentId);
    const actual = Number(this.usageDraft.actualQuantity);
    this.productNotice.set(""); this.productError.set("");
    if (!appointment?.clientId || !this.usageDraft.serviceId || !this.usageDraft.inventoryItemId || !Number.isInteger(actual) || actual <= 0) { this.productError.set("Select an appointment, service, recipe product and valid actual quantity."); return; }
    this.productSaving.set(true);
    try {
      const saved = await this.staff.recordProductUsage({ ...this.usageDraft, clientId: appointment.clientId, actualQuantity: actual, notes: this.usageDraft.notes.trim(), idempotencyKey: crypto.randomUUID() });
      this.usageDraft = { appointmentId: "", serviceId: "", inventoryItemId: "", actualQuantity: null, notes: "" };
      await this.load(true);
      this.productNotice.set(saved.status === "pending_approval" ? "Usage sent for manager approval." : "Product usage recorded and stock updated.");
    } catch { this.productError.set(this.staff.error() || "Unable to submit product usage."); }
    finally { this.productSaving.set(false); }
  }
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
  displayDate(date: string): string { return displayBusinessDate(date); }
  parseDate(date: string): string { return parseDisplayBusinessDate(date); }
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
    this.lastInvoiceLine.set(null);
    this.selectedAppointment.set(item);
    setTimeout(() => document.getElementById("business-appointment-drawer")?.focus());
  }

  async openInvoice(item: StaffBusinessServiceInvoice, event: Event) {
    const invoiceId = item.invoiceId;
    if (!invoiceId || !this.business()?.permissions.invoiceDetail) return;
    this.drawerTrigger = event.currentTarget as HTMLElement;
    this.selectedAppointment.set(null);
    this.invoiceDrawerOpen.set(true);
    this.lastInvoiceLine.set(item);
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


  retryInvoice() {
    const item = this.lastInvoiceLine();
    if (!item) return;
    void this.openInvoice(item, { currentTarget: this.drawerTrigger } as unknown as Event);
  }
  dismissBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) this.closeDrawers();
  }

  closeDrawers() {
    this.selectedAppointment.set(null);
    this.invoiceDrawerOpen.set(false);
    this.invoiceDetail.set(null);
    this.lastInvoiceLine.set(null);
    this.invoiceError.set("");
    const trigger = this.drawerTrigger;
    this.drawerTrigger = null;
    setTimeout(() => trigger?.focus());
  }

  @HostListener("document:keydown.escape")
  onEscape() {
    if (this.selectedAppointment() || this.invoiceDrawerOpen()) this.closeDrawers();
  }

  @HostListener("window:aura:business-updated")
  onBusinessUpdated() {
    if (this.canReadBusiness()) void this.load(true);
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
