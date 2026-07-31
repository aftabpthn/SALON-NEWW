import { Component, HostListener, OnInit, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { isQueuedMutation, StaffAppService, StaffLeave, StaffLeaveBalance } from "../../core/staff-app.service";
import { businessDate, displayBusinessDate, parseDisplayBusinessDate } from "../../core/business-date";
import { StaffDatePickerComponent } from "../../shared/staff-date-picker.component";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [FormsModule, StaffDatePickerComponent, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Leaves</p><h1>Leave management</h1><p>Balances, history and request form.</p></div></header>
      @if (!canReadLeaves()) { <section staffPageState class="notice">You do not have permission to view leave data.</section> }
      @if (loading() && !leaves().length && !balances().length) {
        <section class="leaves-skeleton" aria-label="Loading leaves">
          <div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
          <span class="skeleton leaves-list-skeleton"></span>
        </section>
      }
      @if (loadError()) { <section staffPageState class="notice leaves-error"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" [attr.aria-busy]="loading()" (click)="load()">Retry</button></section> }
      @if (message()) { <section staffPageState class="notice success" role="status">{{ message() }}</section> }
      @if (localError()) { <section staffPageState class="notice">{{ localError() }}</section> }

      @if (canReadLeaves()) {
        <section class="grid three leaves-kpis">
          <article class="kpi"><span>Balance</span><strong>{{ totalBalance() }}</strong><small>Days left</small></article>
          <article class="kpi"><span>Pending</span><strong>{{ pendingCount() }}</strong><small>{{ refreshing() ? 'Refreshing...' : 'Awaiting approval' }}</small></article>
          <article class="kpi"><span>Approved</span><strong>{{ approvedCount() }}</strong><small>This loaded period</small></article>
        </section>
        <section class="grid two leaves-layout">
          <article class="panel">
            <div class="panel-title"><h2>Leave balance</h2><span>{{ refreshing() ? 'Refreshing...' : balances().length }}</span></div>
            <div class="list">
              @for (balance of balances(); track balance.id) {
                <div class="row leave-balance-row">
                  <div class="row-main"><strong>{{ label(balance.leaveType) }}</strong><small>Used {{ balance.used || 0 }} · Opening {{ balance.openingBalance || 0 }}</small></div>
                  <span>{{ leaveBalanceValue(balance) }} left</span>
                </div>
              } @empty {
                @if (!loading() && balancesUnavailable()) { <div class="leaves-empty"><p>Leave balances unavailable.</p><small>Retry to load CRM leave policy balances.</small></div> }
                @else if (!loading()) { <div class="leaves-empty"><p>No leave balances configured.</p><small>CRM leave policies must be configured before balances appear.</small></div> }
              }
            </div>
          </article>
          <article class="panel">
            <div class="panel-title"><h2>Leave history</h2><span>{{ refreshing() ? 'Refreshing...' : leaves().length }}</span></div>
            <div class="list">
              @for (leave of leaves(); track leave.id) {
                <div class="row leave-row">
                  <div class="row-main">
                    <strong>{{ label(leave.leaveType) }} · {{ leave.days || 1 }}d</strong>
                    <small>{{ displayDate(leave.startDate) }} - {{ displayDate(leave.endDate) }}</small>
                    @if (leave.reason) { <p>{{ leave.reason }}</p> }
                  </div>
                  <div class="leave-row-actions"><span class="badge" [class.green]="leave.status === 'approved'" [class.red]="leave.status === 'rejected'">{{ leave.status || 'pending' }}</span>@if (leave.status === 'pending' && canRequestLeave()) {
                    <button class="link-button" type="button" [disabled]="withdrawingId() === leave.id" (click)="withdrawLeave(leave)">{{ withdrawingId() === leave.id ? 'Withdrawing...' : 'Withdraw' }}</button>
                  }</div>
                </div>
              } @empty {
                @if (!loading() && requestsUnavailable()) { <div class="leaves-empty"><p>Leave requests unavailable.</p><small>Retry to load this month's CRM leave requests.</small></div> }
                @else if (!loading()) { <div class="leaves-empty"><p>No leave requests this month.</p><small>Submitted CRM leave requests and approval status will appear here.</small></div> }
              }
            </div>
          </article>
        </section>
        <section class="panel leave-request-panel">
          <div class="panel-title"><h2>Request leave</h2><span>{{ submitting() ? 'Sending...' : (canRequestLeave() ? 'Enabled' : 'View only') }}</span></div>
          @if (!canRequestLeave()) { <p class="muted">You can view leave data, but your role cannot submit leave requests.</p> }
          <div class="form-grid">
            <label>Type<select [(ngModel)]="leaveType" [disabled]="submitting() || !canRequestLeave()">@for (item of availableLeaveTypes(); track item) { <option [value]="item">{{ label(item) }}</option> }</select></label>
            <label>From<aura-staff-date-picker [value]="leaveStart" ariaLabel="Leave from date" [disabled]="submitting() || !canRequestLeave()" (valueChange)="setLeaveStart($event)" /></label>
            <label>To<aura-staff-date-picker [value]="leaveEnd" [min]="leaveStartIso()" ariaLabel="Leave to date" [disabled]="submitting() || !canRequestLeave()" (valueChange)="leaveEnd = $event" /></label>
            <label>Reason<input [(ngModel)]="leaveReason" maxlength="500" placeholder="Reason" [disabled]="submitting() || !canRequestLeave()" /></label>
          </div>
          <div class="leave-form-footer">
            <small>{{ leaveReason.trim().length }}/500</small>
            <button class="link-button primary" type="button" [disabled]="!canRequestLeave() || submitting() || !canSubmitLeave()" [attr.aria-busy]="submitting()" (click)="requestLeave()">{{ submitting() ? 'Sending...' : 'Send request' }}</button>
          </div>
        </section>
      }
    </section>`,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .leaves-skeleton { display: grid; gap: 12px; }
    .leaves-list-skeleton { min-height: 260px; }
    .leaves-error { justify-content: space-between; }
    .leaves-kpis .kpi strong { font-size: clamp(1.25rem, 2.3vw, 1.75rem); }
    .leave-row, .leave-balance-row { align-items: flex-start; }
    .leave-row p { margin-top: 8px; white-space: pre-wrap; }
    .leave-row-actions { display: grid; justify-items: end; gap: 8px; }
    .leave-form-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 14px; }
    .leave-form-footer small { color: var(--staff-text-secondary); font-weight: 700; }
    .leave-form-footer .link-button { min-width: 132px; }
    .leaves-empty { display: grid; justify-items: center; gap: 5px; padding: 26px 10px; color: var(--staff-text-secondary); font-weight: 600; text-align: center; }
    .leaves-empty p { margin: 0; }
    .leaves-empty small { font-weight: 600; line-height: 1.4; }
    @media (max-width: 700px) {
      .leaves-error, .leave-form-footer { align-items: stretch; flex-direction: column; }
      .leaves-error button, .leave-form-footer .link-button { width: 100%; }
      .leaves-layout { gap: 14px; }
      .leave-row .badge { width: fit-content; }
      .leave-row-actions { width: 100%; justify-items: stretch; }
    }
  `]
})
export class StaffLeavesPage implements OnInit {
  readonly leaves = signal<StaffLeave[]>([]);
  readonly balances = signal<StaffLeaveBalance[]>([]);
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly submitting = signal(false);
  readonly withdrawingId = signal("");
  readonly message = signal("");
  readonly localError = signal("");
  readonly loadError = signal("");
  readonly requestsUnavailable = signal(false);
  readonly balancesUnavailable = signal(false);
  readonly availableLeaveTypes = computed(() => [...new Set([...this.balances().map((balance) => balance.leaveType), "unpaid"])]);
  readonly totalBalance = computed(() => this.balances().reduce((total, balance) => total + this.leaveBalanceValue(balance), 0));
  readonly pendingCount = computed(() => this.leaves().filter((leave) => leave.status === "pending").length);
  readonly approvedCount = computed(() => this.leaves().filter((leave) => leave.status === "approved").length);
  leaveType = "unpaid";
  leaveStart = displayBusinessDate(businessDate());
  leaveEnd = displayBusinessDate(businessDate());
  leaveReason = "";

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadLeaves()) void this.load(); }

  async load(silent = false) {
    if (!this.canReadLeaves()) {
      this.leaves.set([]);
      this.balances.set([]);
      return;
    }
    if (silent) this.refreshing.set(true); else this.loading.set(true);
    this.loadError.set("");
    this.requestsUnavailable.set(false);
    this.balancesUnavailable.set(false);
    try {
      const [requestsResult, balancesResult] = await Promise.allSettled([this.staff.leaves(), this.staff.leaveBalances()]);
      if (requestsResult.status === "fulfilled") this.leaves.set(requestsResult.value);
      else this.requestsUnavailable.set(true);
      if (balancesResult.status === "fulfilled") this.balances.set(balancesResult.value);
      else this.balancesUnavailable.set(true);
      if (this.requestsUnavailable() || this.balancesUnavailable()) {
        this.loadError.set(this.requestsUnavailable() && this.balancesUnavailable()
          ? "Unable to load leave requests and balances."
          : this.requestsUnavailable() ? "Leave requests could not be loaded." : "Leave balances could not be loaded.");
      }
      if (!this.availableLeaveTypes().includes(this.leaveType)) this.leaveType = this.availableLeaveTypes()[0] || "unpaid";
    } finally {
      this.loading.set(false);
      this.refreshing.set(false);
    }
  }

  @HostListener("window:aura:leaves-updated")
  onLeavesUpdated() { if (this.canReadLeaves()) void this.load(true); }

  leaveBalanceValue(balance: StaffLeaveBalance): number {
    return Number(balance.balance ?? (Number(balance.openingBalance || 0) + Number(balance.accrued || 0) - Number(balance.used || 0)));
  }

  canSubmitLeave(): boolean {
    const startDate = parseDisplayBusinessDate(this.leaveStart);
    const endDate = parseDisplayBusinessDate(this.leaveEnd);
    return !!this.leaveType.trim() && !!startDate && !!endDate && endDate >= startDate && this.leaveReason.trim().length <= 500;
  }

  label(value: string): string { return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  displayDate(value: string): string { return displayBusinessDate(value); }
  leaveStartIso(): string { return parseDisplayBusinessDate(this.leaveStart); }
  setLeaveStart(value: string) {
    this.leaveStart = value;
    if (parseDisplayBusinessDate(this.leaveEnd) < this.leaveStartIso()) this.leaveEnd = value;
  }

  async requestLeave() {
    if (this.submitting()) return;
    this.message.set("");
    this.localError.set("");
    if (!this.canRequestLeave()) {
      this.localError.set("You do not have permission to request leave.");
      return;
    }
    const startDate = parseDisplayBusinessDate(this.leaveStart);
    const endDate = parseDisplayBusinessDate(this.leaveEnd);
    if (!this.leaveType.trim() || !startDate || !endDate) {
      this.localError.set("Leave type and valid dates (DD/MM/YYYY) are required.");
      return;
    }
    if (endDate < startDate) {
      this.localError.set("Leave end date cannot be before start date.");
      return;
    }
    if (this.leaveReason.trim().length > 500) {
      this.localError.set("Leave reason cannot exceed 500 characters.");
      return;
    }
    this.submitting.set(true);
    try {
      const result = await this.staff.requestLeave({ leaveType: this.leaveType.trim(), startDate, endDate, reason: this.leaveReason.trim() });
      this.leaveReason = "";
      if (isQueuedMutation(result)) {
        this.message.set("You are offline. Leave request queued and will send after reconnecting.");
        return;
      }
      this.message.set("Leave request sent.");
      await this.load(true);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aura:leaves-updated"));
    } catch {
      this.localError.set(this.staff.error() || "Unable to request leave.");
    } finally {
      this.submitting.set(false);
    }
  }

  async withdrawLeave(leave: StaffLeave) {
    if (this.withdrawingId() || leave.status !== "pending" || !this.canRequestLeave()) return;
    if (!confirm(`Withdraw ${this.label(leave.leaveType)} leave request?`)) return;
    this.message.set("");
    this.localError.set("");
    this.withdrawingId.set(leave.id);
    try {
      await this.staff.withdrawLeave(leave.id, leave.version);
      this.message.set("Leave request withdrawn.");
      await this.load(true);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aura:leaves-updated"));
    } catch {
      this.localError.set(this.staff.error() || "Unable to withdraw leave request.");
    } finally {
      this.withdrawingId.set("");
    }
  }

  canReadLeaves(): boolean {
    return this.staff.hasPermission("staff.app.leaves.read");
  }

  canRequestLeave(): boolean {
    return this.staff.hasPermission("staff.app.leaves.manage");
  }
}
