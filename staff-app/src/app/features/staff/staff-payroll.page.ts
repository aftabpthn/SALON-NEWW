import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffPayrollItem } from "../../core/staff-app.service";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({ standalone: true, imports: [PaiseInrPipe, DatePipe, StaffPageStateComponent], template: `
  <section class="page"><header class="page-head"><div><p class="eyebrow">Payroll</p><h1>Payroll</h1><p>Dedicated payroll page with permission gate.</p></div></header>
  @if (!canSeePayroll()) { <section staffPageState class="notice">You do not have permission to view payroll.</section> }
  @if (loading()) { <section staffPageState class="state" [loading]="true">Loading payroll...</section> } @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
  @if (canSeePayroll()) { <section class="panel"><div class="panel-title"><h2>Payroll entries</h2><span>{{ payroll().length }}</span></div><div class="list">@for (item of payroll(); track item.id) { <div class="row"><div class="row-main"><strong>{{ payrollAmount(item) | paiseInr }}</strong><small>{{ item.periodStart | date:'mediumDate' }} - {{ item.periodEnd | date:'mediumDate' }}</small></div><span class="badge">{{ item.status }}</span></div> } @empty { <p class="empty">No payroll entries yet.</p> }</div></section> }
  </section>`, styleUrls: ["./staff-app.styles.css"] })
export class StaffPayrollPage implements OnInit { readonly payroll = signal<StaffPayrollItem[]>([]); readonly loading = signal(false); constructor(readonly staff: StaffAppService) {} ngOnInit() { if (this.canSeePayroll()) void this.load(); } async load() { this.loading.set(true); try { this.payroll.set(await this.staff.payroll()); } finally { this.loading.set(false); } } canSeePayroll(): boolean { return this.staff.hasAnyPermission(["read:payroll", "read:finance"]); } payrollAmount(item: StaffPayrollItem): number { return Number(item.netPay || item.grossPay || 0); } }
