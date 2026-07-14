import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type SupplierFilter =
  | 'all'
  | 'active'
  | 'risk'
  | 'pending-po'
  | 'missing-gstin'
  | 'missing-contact'
  | 'no-purchase'
  | 'blocked'
  | 'price-rise'
  | 'cheaper-available';

interface SupplierCommandRow {
  supplier: ApiRecord;
  status: string;
  score: number;
  purchaseValue: number;
  openPoCount: number;
  openPoValue: number;
  qualityRisk: number;
  expiringBatchCount: number;
  suppliedProducts: number;
  lastPurchaseAt: string;
  topProductName: string;
  missingContact: boolean;
  missingGstin: boolean;
  draftItems: string;
  statusReason: string;
  statusHistoryCount: number;
  complianceIssues: string[];
  priceChangePct: number;
  cheaperAlternative: string;
  cheaperSavingPct: number;
  trendBars: number[];
  suggestedPurchase: ApiRecord | null;
  reliabilityScore: number;
  onTimePct: number;
  damagePct: number;
  returnPct: number;
  invoiceMismatchPct: number;
  paymentTerms: string;
  outstandingValue: number;
  lastPaymentAt: string;
  creditDaysOverdue: number;
  poDraftItems: ApiRecord[];
  poDraftTotal: number;
  expectedDeliveryLabel: string;
  whatsappLogCount: number;
  mappingWarnings: string[];
}

@Component({
  selector: 'app-suppliers',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack suppliers-page inner-page-shell">
      <section class="zenoti-supplier-header inner-page-header">
        <div class="zenoti-heading">
          <div>
            <h1>Supplier command register</h1>
          </div>
          <button class="primary-button" type="button" (click)="showForm.set(true)">Add supplier</button>
        </div>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="zenoti-supplier-workspace">
        <div class="zenoti-result-bar inner-stats-grid">
          <div>
            <strong>{{ filteredSupplierRows().length }}</strong><span>Results</span>
            <small class="status-chip">Status: supplier control active in this center</small>
          </div>
          <div class="zenoti-totals">
            <span>Total <strong>{{ suppliers().length }}</strong></span>
            <span>Spend <strong>{{ totalSupplierSpend() | auraMoney:'1.0-0' }}</strong></span>
            <span>Open PO <strong>{{ openPoValue() | auraMoney:'1.0-0' }}</strong></span>
            <span>Risk <strong>{{ qualityRiskSuppliers().length }}</strong></span>
            <span>WhatsApp <strong>{{ pendingWhatsappDrafts() }}</strong></span>
            <span>Payable <strong>{{ supplierOutstandingTotal() | auraMoney:'1.0-0' }}</strong></span>
          </div>
        </div>
        <div class="supplier-filter-row inner-action-bar">
          <label class="search-field">
            <span>Search supplier</span>
            <input [(ngModel)]="query" placeholder="Name, phone, GSTIN, contact, status" />
          </label>
          <div class="filter-chip-row" role="group" aria-label="Supplier filters">
            <button type="button" class="filter-chip" [class.active]="activeFilter() === 'all'" (click)="setFilter('all')">All <strong>{{ supplierRows().length }}</strong></button>
            <button type="button" class="filter-chip" [class.active]="activeFilter() === 'active'" (click)="setFilter('active')">Active <strong>{{ filterCount('active') }}</strong></button>
            <button type="button" class="filter-chip" [class.active]="activeFilter() === 'risk'" (click)="setFilter('risk')">Risk <strong>{{ filterCount('risk') }}</strong></button>
            <button type="button" class="filter-chip" [class.active]="activeFilter() === 'pending-po'" (click)="setFilter('pending-po')">Pending PO <strong>{{ filterCount('pending-po') }}</strong></button>
            <button type="button" class="filter-chip" [class.active]="activeFilter() === 'missing-gstin'" (click)="setFilter('missing-gstin')">GSTIN missing <strong>{{ filterCount('missing-gstin') }}</strong></button>
            <button type="button" class="filter-chip" [class.active]="activeFilter() === 'missing-contact'" (click)="setFilter('missing-contact')">Contact missing <strong>{{ filterCount('missing-contact') }}</strong></button>
            <button type="button" class="filter-chip" [class.active]="activeFilter() === 'no-purchase'" (click)="setFilter('no-purchase')">No purchase <strong>{{ filterCount('no-purchase') }}</strong></button>
            <button type="button" class="filter-chip" [class.active]="activeFilter() === 'blocked'" (click)="setFilter('blocked')">Paused/blocked <strong>{{ filterCount('blocked') }}</strong></button>
            <button type="button" class="filter-chip" [class.active]="activeFilter() === 'price-rise'" (click)="setFilter('price-rise')">Price rise <strong>{{ filterCount('price-rise') }}</strong></button>
            <button type="button" class="filter-chip" [class.active]="activeFilter() === 'cheaper-available'" (click)="setFilter('cheaper-available')">Cheaper supplier <strong>{{ filterCount('cheaper-available') }}</strong></button>
          </div>
        </div>

        <div class="state success" *ngIf="success()">{{ success() }}</div>

        <div class="supplier-scroll-rail" #supplierScrollRail (scroll)="syncSupplierTableScroll('rail')" aria-label="Supplier table side scroll">
          <div [style.width.px]="supplierScrollWidth()"></div>
        </div>

        <div class="table-wrap zenoti-table-wrap inner-table-wrap" #supplierTableWrap (scroll)="syncSupplierTableScroll('table')">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Score</th>
                <th>Spend</th>
                <th>Open PO</th>
                <th>GRN reliability</th>
                <th>Compliance</th>
                <th>Price intel</th>
                <th>Auto PO</th>
                <th>Payment</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of filteredSupplierRows()">
                <td>
                  <a class="supplier-link" [routerLink]="['/suppliers', row.supplier.id]">
                    <strong>{{ supplierDisplayName(row.supplier) }}</strong>
                  </a>
                  <small>{{ row.topProductName }} · {{ row.suppliedProducts }} linked products</small>
                </td>
                <td>
                  <span class="score-pill" [class.score-good]="row.score >= 85" [class.score-warn]="row.score < 85 && row.score >= 70" [class.score-danger]="row.score < 70">{{ row.score | number: '1.0-0' }}</span>
                  <small>{{ row.status }} · reliability {{ row.reliabilityScore | number: '1.0-0' }}</small>
                </td>
                <td>
                  <strong>{{ row.purchaseValue | auraMoney:'1.0-0' }}</strong>
                  <small>{{ row.purchaseValue ? 'Live purchases' : 'No purchase yet' }}</small>
                </td>
                <td>
                  <strong>{{ row.openPoValue | auraMoney:'1.0-0' }}</strong>
                  <small>{{ row.openPoCount }} open PO · {{ row.poDraftItems.length }} draft items</small>
                </td>
                <td>
                  <span class="badge" [class.warn]="row.qualityRisk > 0">{{ row.qualityRisk ? row.qualityRisk + ' signals' : 'clear' }}</span>
                  <small>On-time {{ row.onTimePct | number: '1.0-0' }}% · damage {{ row.damagePct | number: '1.0-0' }}% · mismatch {{ row.invoiceMismatchPct | number: '1.0-0' }}%</small>
                </td>
                <td>
                  <div class="compliance-stack">
                    <span class="mini-status" [class.ok]="!row.missingGstin" [class.warn]="row.missingGstin">{{ row.missingGstin ? 'GSTIN missing' : 'GSTIN ready' }}</span>
                    <span class="mini-status" [class.ok]="!row.missingContact" [class.warn]="row.missingContact">{{ row.missingContact ? 'Contact missing' : 'Contact ready' }}</span>
                    <span class="mini-status" [class.ok]="!row.mappingWarnings.length" [class.warn]="row.mappingWarnings.length">{{ row.mappingWarnings.length ? 'Mapping risk' : 'Products mapped' }}</span>
                    <span class="mini-status" [class.ok]="row.paymentTerms !== 'Payment terms missing'" [class.warn]="row.paymentTerms === 'Payment terms missing'">{{ row.paymentTerms }}</span>
                    <span class="mini-status warn" *ngIf="row.statusReason">{{ row.statusReason }}</span>
                    <span class="mini-status" *ngIf="row.statusHistoryCount">{{ row.statusHistoryCount }} status events</span>
                  </div>
                </td>
                <td>
                  <strong *ngIf="row.priceChangePct > 0">+{{ row.priceChangePct | number: '1.0-1' }}%</strong>
                  <strong *ngIf="row.priceChangePct <= 0">Stable</strong>
                  <small>{{ row.cheaperAlternative || 'No cheaper match' }}</small>
                </td>
                <td>
                  <strong>{{ row.poDraftItems.length }} item(s)</strong>
                  <small>{{ row.poDraftTotal | auraMoney:'1.0-0' }} · {{ row.expectedDeliveryLabel }}</small>
                </td>
                <td>{{ row.lastPurchaseAt ? (row.lastPurchaseAt | auraDate:'date') : 'No purchase' }}<small>{{ row.outstandingValue | auraMoney:'1.0-0' }} payable · {{ row.paymentTerms }}</small></td>
                <td class="supplier-actions">
                  <a class="ghost-button mini" [routerLink]="['/suppliers', row.supplier.id]">360</a>
                  <button class="ghost-button mini" type="button" (click)="createPoForSupplier(row)" [disabled]="saving()">Create PO</button>
                  <button class="ghost-button mini" type="button" (click)="buildWhatsAppDraft(row)">Draft</button>
                  <button class="ghost-button mini danger" type="button" *ngIf="row.status === 'active'" (click)="markSupplierStatus(row, 'blocked')" [disabled]="saving()">Block</button>
                  <button class="ghost-button mini" type="button" *ngIf="row.status !== 'active'" (click)="markSupplierStatus(row, 'active')" [disabled]="saving()">Reactivate</button>
                  <button class="ghost-button mini" type="button" (click)="editSupplier(row.supplier)">Edit</button>
                </td>
              </tr>
              <tr *ngIf="!filteredSupplierRows().length && !loading()">
                <td colspan="9">
                  <div class="empty-state">
                    <strong>No suppliers match this view</strong>
                    <span>Change filter or add your product distributors, brand vendors and purchase contacts here.</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="zenoti-footer">
          <span>1 to {{ filteredSupplierRows().length }} of {{ filteredSupplierRows().length }}</span>
        </div>
      </section>

      <section class="panel supplier-draft-panel" *ngIf="whatsappDraft()">
        <div class="section-title">
          <div><h2>Approval-safe message</h2></div>
          <button class="ghost-button" type="button" (click)="whatsappDraft.set('')">Clear draft</button>
        </div>
        <div class="draft-box">{{ whatsappDraft() }}</div>
      </section>

      <section class="panel" *ngIf="showForm()">
        <div class="section-title">
          <div>
            <span class="eyebrow">{{ editingId() ? 'Edit supplier' : 'Create supplier' }}</span>
            <h2>{{ editingId() ? 'Update vendor record' : 'New supplier' }}</h2>
          </div>
          <button class="ghost-button" type="button" (click)="resetForm()">Close form</button>
        </div>

        <form [formGroup]="supplierForm" (ngSubmit)="saveSupplier()" class="supplier-form">
          <div class="validation-stack full" *ngIf="formWarnings().length">
            <strong>Supplier validation</strong>
            <span *ngFor="let warning of formWarnings()">{{ warning }}</span>
          </div>
          <label class="field"><span>Supplier name</span><input formControlName="name" placeholder="Vendor / distributor name" /></label>
          <label class="field"><span>Contact person</span><input formControlName="contactName" placeholder="Owner or sales person" /></label>
          <label class="field"><span>Phone</span><input formControlName="phone" placeholder="+91 mobile / landline" /></label>
          <label class="field"><span>Email</span><input type="email" formControlName="email" placeholder="supplier@example.com" /></label>
          <label class="field"><span>GSTIN</span><input formControlName="gstin" placeholder="GST number" /></label>
          <label class="field"><span>Payment terms</span><input formControlName="preferredPaymentTerms" placeholder="Net 7, COD, advance" /></label>
          <label class="field"><span>Lead time days</span><input type="number" formControlName="leadTimeDays" min="0" /></label>
          <label class="field">
            <span>Status</span>
            <select formControlName="status">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
          <label class="field"><span>Status reason</span><input formControlName="statusReason" placeholder="Reason for pause/block/reactivation" /></label>
          <label class="field full"><span>Address</span><textarea formControlName="address" placeholder="Billing address, delivery terms or warehouse note"></textarea></label>
          <div class="form-actions full">
            <button class="ghost-button" type="button" (click)="resetForm()">Cancel</button>
            <button class="primary-button" type="submit" [disabled]="supplierForm.invalid || saving()">
              {{ saving() ? 'Saving...' : editingId() ? 'Update supplier' : 'Save supplier' }}
            </button>
          </div>
        </form>
      </section>
    </section>
  `,
  styles: [`
    .suppliers-page {
      gap: 8px;
      padding: 8px;
      background: #f0f2f5;
    }

    .zenoti-supplier-header,
    .zenoti-supplier-workspace {
      background: #fff;
      border: 1px solid #d8e1ea;
      color: #1d2733;
    }

    .zenoti-supplier-header {
      border-bottom: 0;
      display: grid;
      gap: 10px;
      padding: 14px 16px 12px;
    }

    .zenoti-topline,
    .zenoti-heading,
    .zenoti-actions,
    .zenoti-result-bar,
    .zenoti-totals,
    .zenoti-footer {
      align-items: center;
      display: flex;
      gap: 8px;
    }

    .zenoti-topline,
    .zenoti-heading,
    .zenoti-result-bar {
      justify-content: space-between;
    }

    .zenoti-topline strong {
      font-size: 15px;
      font-weight: 900;
    }

    .zenoti-actions {
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .zenoti-actions a,
    .zenoti-actions button {
      background: #fff;
      border: 1px solid #b9d0e7;
      border-radius: 3px;
      color: #075f9e;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 900;
      line-height: 1;
      padding: 8px 12px;
      text-decoration: none;
    }

    .zenoti-command {
      border: 1px solid #b9cce1;
      border-radius: 3px;
      font-weight: 900;
      justify-self: end;
      min-height: 36px;
      padding: 6px 10px;
      width: min(100%, 620px);
    }

    .zenoti-heading {
      border-top: 1px solid #d8e1ea;
      padding-top: 12px;
    }

    .zenoti-heading h1 {
      font-size: 22px;
      line-height: 1.15;
      margin: 0;
    }

    .zenoti-heading p {
      color: #38516e;
      font-size: 13px;
      margin: 6px 0 0;
    }

    .zenoti-supplier-workspace {
      display: grid;
      overflow: hidden;
    }

    .zenoti-result-bar,
    .zenoti-footer {
      border-top: 1px solid #d8e1ea;
      padding: 10px 16px;
    }

    .zenoti-result-bar {
      border: 1px solid #d8e1ea;
    }

    .zenoti-result-bar > div,
    .zenoti-totals {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .zenoti-result-bar strong {
      color: #152033;
      font-size: 14px;
      font-weight: 900;
    }

    .zenoti-result-bar span,
    .zenoti-footer {
      color: #50637d;
      font-size: 12px;
      font-weight: 800;
    }

    .status-chip {
      background: #eaf6ff;
      border: 1px solid #b9d0e7;
      border-radius: 999px;
      color: #173f62;
      display: inline-flex;
      font-size: 12px;
      font-weight: 900;
      line-height: 1;
      padding: 6px 10px;
      white-space: nowrap;
    }

    .supplier-scroll-rail {
      position: sticky;
      top: 0;
      z-index: 6;
      height: 18px;
      overflow-x: auto;
      overflow-y: hidden;
      border: 1px solid #d8e1ea;
      background: #fff;
    }

    .supplier-scroll-rail > div {
      height: 1px;
    }

    .zenoti-table-wrap {
      scrollbar-gutter: stable;
    }

    .zenoti-table-wrap table {
      border-collapse: collapse;
      min-width: 1420px;
      width: 100%;
    }

    .zenoti-table-wrap th,
    .zenoti-table-wrap td {
      border-bottom: 1px solid #dfe6ee;
      color: #243142;
      font-size: 13px;
      padding: 11px 14px;
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }

    .zenoti-table-wrap th {
      background: #f5f8fb;
      color: #5d6e84;
      font-size: 12px;
      font-weight: 900;
    }

    .zenoti-table-wrap td strong {
      color: #075f9e;
      font-size: 14px;
      font-weight: 900;
    }

    .zenoti-footer {
      justify-content: flex-end;
    }

    .compact-hero {
      align-items: center;
      min-height: auto;
      padding: 16px 20px;
    }

    .compact-hero h2 {
      font-size: 1.25rem;
      line-height: 1.2;
    }

    .hero-actions,
    .toolbar-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .supplier-kpis {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .supplier-intelligence-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
      gap: 12px;
      align-items: start;
    }

    .supplier-workbench-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      align-items: start;
    }

    .supplier-command-panel,
    .supplier-draft-panel {
      overflow: hidden;
    }

    .supplier-filter-row {
      display: grid;
      grid-template-columns: minmax(280px, 0.46fr) minmax(0, 1fr);
      gap: 12px;
      align-items: end;
      padding: 12px 16px;
      border-bottom: 1px solid #d8e1ea;
    }

    .filter-chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .filter-chip {
      min-height: 30px;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 0 10px;
      border: 1px solid #b9d0e7;
      border-radius: 999px;
      background: #fff;
      color: #173f62;
      font-size: 12px;
      font-weight: 900;
      cursor: pointer;
    }

    .filter-chip strong {
      min-width: 22px;
      min-height: 22px;
      display: inline-grid;
      place-items: center;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--color-surface-sunken);
      color: var(--muted);
      font-size: 0.74rem;
    }

    .filter-chip.active {
      border-color: rgba(75, 18, 56, 0.34);
      background: var(--color-primary-soft);
      color: var(--teal);
    }

    .filter-chip.active strong {
      background: #fff;
      color: var(--teal);
    }

    .trend-list,
    .alert-list.compact,
    .recommendation-list,
    .reliability-list,
    .watch-list {
      display: grid;
      gap: 9px;
    }

    .trend-list article,
    .alert-list.compact article,
    .recommendation-list article,
    .reliability-list article,
    .watch-list article {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(120px, 0.5fr);
      gap: 12px;
      align-items: center;
      padding: 11px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .alert-list.compact article {
      grid-template-columns: 1fr;
    }

    .watch-list article {
      grid-template-columns: 1fr;
    }

    .trend-list span,
    .alert-list.compact span,
    .alert-list.compact small,
    .recommendation-list span,
    .watch-list span,
    .watch-list small,
    .reliability-list span {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 0.82rem;
    }

    .row-actions,
    .metric-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      justify-content: flex-end;
    }

    .metric-strip span {
      min-height: 28px;
      display: inline-flex;
      align-items: center;
      padding: 0 9px;
      border-radius: 999px;
      background: #eef2f7;
      color: #475569;
      font-weight: 800;
    }

    .mini-report-table table {
      min-width: 720px;
    }

    .trend-bars {
      height: 48px;
      display: flex;
      align-items: end;
      gap: 5px;
      justify-content: flex-end;
    }

    .trend-bars span {
      width: 14px;
      min-height: 8px;
      border-radius: 6px 6px 2px 2px;
      background: linear-gradient(180deg, #4B1238, #6ee7b7);
    }

    .supplier-form {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .supplier-form .full {
      grid-column: 1 / -1;
    }

    .validation-stack {
      display: grid;
      gap: 4px;
      padding: 11px 12px;
      border: 1px solid #f7d48a;
      border-radius: 8px;
      background: #fff8e6;
      color: #7c4d00;
    }

    .validation-stack strong,
    .validation-stack span {
      display: block;
    }

    .validation-stack span {
      font-size: 0.84rem;
    }

    .supplier-form textarea {
      min-height: 88px;
      resize: vertical;
    }

    .table-wrap {
      overflow: auto;
    }

    table {
      min-width: 1160px;
    }

    td strong,
    td small {
      display: block;
    }

    td small {
      margin-top: 3px;
      color: var(--muted);
      font-size: 0.78rem;
      max-width: 360px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .supplier-link {
      color: var(--ink);
      text-decoration: none;
    }

    .supplier-link:hover {
      color: var(--teal);
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    .score-pill {
      min-width: 54px;
      display: inline-grid;
      place-items: center;
      padding: 5px 10px;
      border-radius: 999px;
      background: #eef2f7;
      color: #475569;
      font-weight: 900;
    }

    .score-pill.score-good {
      background: #daf5ef;
      color: #075e53;
    }

    .score-pill.score-warn {
      background: #fff3d8;
      color: #7c4d00;
    }

    .score-pill.score-danger {
      background: #fde7e4;
      color: #9f2418;
    }

    .badge.warn,
    .mini-status.warn {
      background: #fff3d8;
      color: #7c4d00;
    }

    .compliance-stack {
      display: grid;
      gap: 5px;
      min-width: 132px;
    }

    .mini-status {
      width: fit-content;
      display: inline-flex;
      align-items: center;
      min-height: 25px;
      padding: 0 9px;
      border-radius: 999px;
      background: #eef2f7;
      color: #475569;
      font-size: 0.74rem;
      font-weight: 800;
    }

    .mini-status.ok {
      background: #daf5ef;
      color: #075e53;
    }

    .supplier-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      min-width: 330px;
    }

    .ghost-button.danger {
      color: #b42318;
      border-color: rgba(180, 35, 24, 0.28);
      background: #fff;
    }

    .draft-box {
      border: 1px solid rgba(75, 18, 56, 0.28);
      border-radius: 12px;
      padding: 14px;
      background: #FBF0E8;
      white-space: pre-wrap;
      line-height: 1.5;
    }

    .empty-state {
      display: grid;
      gap: 4px;
      padding: 24px;
      text-align: center;
      color: var(--muted);
    }

    .empty-state strong {
      color: var(--ink);
    }

    .empty-state.compact {
      padding: 18px;
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: #fff;
    }

    @media (max-width: 1180px) {
      .supplier-kpis,
      .supplier-intelligence-grid,
      .supplier-workbench-grid,
      .supplier-form,
      .supplier-filter-row {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .compact-hero {
        align-items: stretch;
      }

      .supplier-kpis,
      .supplier-intelligence-grid,
      .supplier-workbench-grid,
      .supplier-form,
      .supplier-filter-row {
        grid-template-columns: 1fr;
      }

      .filter-chip-row {
        justify-content: flex-start;
      }
    }
  `]
})
export class SuppliersComponent implements OnInit, AfterViewInit {
  @ViewChild('supplierTableWrap') private supplierTableWrap?: ElementRef<HTMLDivElement>;
  @ViewChild('supplierScrollRail') private supplierScrollRail?: ElementRef<HTMLDivElement>;

  readonly suppliers = signal<ApiRecord[]>([]);
  readonly products = signal<ApiRecord[]>([]);
  readonly batches = signal<ApiRecord[]>([]);
  readonly transactions = signal<ApiRecord[]>([]);
  readonly purchaseOrders = signal<ApiRecord[]>([]);
  readonly whatsappQueue = signal<ApiRecord[]>([]);
  readonly intelligence = signal<ApiRecord | null>(null);
  readonly inventoryReport = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly showForm = signal(false);
  readonly editingId = signal('');
  readonly activeFilter = signal<SupplierFilter>('all');
  readonly whatsappDraft = signal('');
  readonly supplierScrollWidth = signal(1420);
  private syncingSupplierScroll = false;
  query = '';

  readonly activeSuppliers = computed(() => this.suppliers().filter((supplier) => this.supplierStatus(supplier) === 'active'));
  readonly suppliersWithGstin = computed(() => this.suppliers().filter((supplier) => Boolean(String(supplier.gstin || '').trim())));
  readonly suppliersMissingContact = computed(() =>
    this.suppliers().filter((supplier) => !String(supplier.phone || '').trim() && !String(supplier.email || '').trim())
  );
  readonly supplierRows = computed(() => this.buildSupplierRows());
  readonly filteredSupplierRows = computed(() => this.supplierRows().filter((row) => this.matchesFilter(row) && this.matchesQuery(row)));
  readonly openPoValue = computed(() => this.supplierRows().reduce((total, row) => total + row.openPoValue, 0));
  readonly openPoSuppliers = computed(() => this.supplierRows().filter((row) => row.openPoCount > 0));
  readonly qualityRiskSuppliers = computed(() => this.supplierRows().filter((row) => row.qualityRisk > 0 || row.score < 70));
  readonly pendingWhatsappDrafts = computed(() => this.whatsappQueue().filter((row) => !['sent', 'cancelled'].includes(String(row.status || '').toLowerCase())).length);
  readonly totalSupplierSpend = computed(() => this.supplierRows().reduce((total, row) => total + row.purchaseValue, 0));
  readonly priceRiseSuppliers = computed(() => this.supplierRows().filter((row) => row.priceChangePct > 0));
  readonly topSpendRows = computed(() => this.supplierRows().filter((row) => row.purchaseValue > 0).slice(0, 6));
  readonly purchaseIntelligenceRows = computed(() =>
    this.supplierRows().filter((row) => row.priceChangePct > 0 || row.cheaperAlternative).slice(0, 6)
  );
  readonly priceComparisonRows = computed(() => this.buildPriceComparisonRows().slice(0, 10));
  readonly autoPoDraftRows = computed(() => this.supplierRows().filter((row) => row.poDraftItems.length > 0).sort((a, b) => b.poDraftTotal - a.poDraftTotal).slice(0, 8));
  readonly autoPoDraftTotal = computed(() => this.autoPoDraftRows().reduce((total, row) => total + row.poDraftTotal, 0));
  readonly reliabilityRows = computed(() =>
    this.supplierRows().filter((row) => row.purchaseValue > 0 || row.openPoCount > 0 || row.qualityRisk > 0).sort((a, b) => a.reliabilityScore - b.reliabilityScore).slice(0, 8)
  );
  readonly supplierOutstandingTotal = computed(() => this.supplierRows().reduce((total, row) => total + row.outstandingValue, 0));
  readonly complianceWatchRows = computed(() =>
    this.supplierRows()
      .filter((row) => row.complianceIssues.length || row.mappingWarnings.length || row.status !== 'active' || row.creditDaysOverdue > 0 || row.outstandingValue > 0)
      .slice(0, 10)
  );

  readonly supplierForm = this.fb.group({
    name: ['', Validators.required],
    contactName: [''],
    phone: [''],
    email: [''],
    gstin: [''],
    address: [''],
    status: ['active'],
    statusReason: [''],
    preferredPaymentTerms: [''],
    leadTimeDays: [0]
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  ngAfterViewInit(): void {
    this.refreshSupplierScrollWidth();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const branchId = this.api.selectedBranchId();
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('suppliers', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('products', { limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventoryBatches', { limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory', { limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/purchase-orders', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/supplier-whatsapp-queue', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord>('inventory-intelligence/summary', { branchId })),
      firstValueFrom(this.api.list<ApiRecord>('inventory-intelligence/reports', { branchId }))
    ]).then(([suppliers, products, batches, transactions, purchaseOrders, whatsappQueue, intelligence, inventoryReport]) => {
      this.suppliers.set(this.normalizedSuppliers(suppliers));
      this.products.set(products || []);
      this.batches.set(batches || []);
      this.transactions.set(transactions || []);
      this.purchaseOrders.set(purchaseOrders || []);
      this.whatsappQueue.set(whatsappQueue || []);
      this.intelligence.set(intelligence || null);
      this.inventoryReport.set(inventoryReport || null);
      this.loading.set(false);
      this.refreshSupplierScrollWidth();
    }).catch((error) => {
      this.error.set(error?.error?.error || error?.message || 'Unable to load suppliers');
      this.loading.set(false);
    });
  }

  saveSupplier(): void {
    if (this.supplierForm.invalid) {
      this.supplierForm.markAllAsTouched();
      return;
    }
    const blockingWarnings = this.formWarnings().filter((warning) => warning.includes('Invalid GSTIN') || warning.includes('Duplicate'));
    if (blockingWarnings.length) {
      this.error.set(blockingWarnings[0]);
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    const existing = this.suppliers().find((supplier) => supplier.id === this.editingId());
    const raw = this.supplierForm.getRawValue();
    const payload = this.withStatusHistory(raw, existing);
    const request = this.editingId()
      ? this.api.update('suppliers', this.editingId(), payload)
      : this.api.create('suppliers', payload);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.success.set(this.editingId() ? 'Supplier updated.' : 'Supplier saved in register.');
        this.resetForm(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to save supplier');
        this.saving.set(false);
      }
    });
  }

  editSupplier(supplier: ApiRecord): void {
    this.editingId.set(String(supplier.id || ''));
    this.showForm.set(true);
    this.supplierForm.reset({
      name: this.supplierDisplayName(supplier),
      contactName: supplier.contactName || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      gstin: supplier.gstin || '',
      address: supplier.address || '',
      status: supplier.status || 'active',
      statusReason: supplier.statusReason || '',
      preferredPaymentTerms: supplier.preferredPaymentTerms || '',
      leadTimeDays: Number(supplier.leadTimeDays || 0)
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  resetForm(clearMessage = true): void {
    this.editingId.set('');
    this.showForm.set(false);
    if (clearMessage) this.success.set('');
    this.supplierForm.reset({
      name: '',
      contactName: '',
      phone: '',
      email: '',
      gstin: '',
      address: '',
      status: 'active',
      statusReason: '',
      preferredPaymentTerms: '',
      leadTimeDays: 0
    });
  }

  setFilter(filter: SupplierFilter): void {
    this.activeFilter.set(filter);
  }

  filterCount(filter: SupplierFilter): number {
    return this.supplierRows().filter((row) => this.matchesFilter(row, filter)).length;
  }

  syncSupplierTableScroll(source: 'rail' | 'table'): void {
    if (this.syncingSupplierScroll) return;
    const tableWrap = this.supplierTableWrap?.nativeElement;
    const rail = this.supplierScrollRail?.nativeElement;
    if (!tableWrap || !rail) return;
    this.syncingSupplierScroll = true;
    if (source === 'rail') {
      tableWrap.scrollLeft = rail.scrollLeft;
    } else {
      rail.scrollLeft = tableWrap.scrollLeft;
    }
    requestAnimationFrame(() => {
      this.syncingSupplierScroll = false;
    });
  }

  private refreshSupplierScrollWidth(): void {
    setTimeout(() => {
      const tableWrap = this.supplierTableWrap?.nativeElement;
      const rail = this.supplierScrollRail?.nativeElement;
      if (!tableWrap) return;
      this.supplierScrollWidth.set(Math.max(tableWrap.scrollWidth, tableWrap.clientWidth, 1420));
      if (rail) rail.scrollLeft = tableWrap.scrollLeft;
    });
  }

  buildWhatsAppDraft(row: SupplierCommandRow): void {
    const vendor = row.supplier;
    const contact = vendor.phone || vendor.email || 'supplier contact';
    const items = row.poDraftItems.length
      ? row.poDraftItems.map((item, index) => `${index + 1}. ${item['productName']} - Qty ${item['quantity']} - ${this.currencyText(Number(item['totalCost'] || 0))}`).join('\n')
      : row.draftItems || 'Please share latest rate card, delivery availability and GST invoice terms.';
    this.whatsappDraft.set(`Draft to ${this.supplierDisplayName(vendor)} (${contact})\nPO items:\n${items}\nExpected delivery: ${row.expectedDeliveryLabel}\nTotal draft value: ${this.currencyText(row.poDraftTotal || row.openPoValue)}\nGST invoice: required with batch/expiry if applicable\nPayment terms: ${row.paymentTerms}\nOpen PO value: ${this.currencyText(row.openPoValue)}\nNote: Send only after owner approval.`);
    this.success.set('Supplier WhatsApp draft prepared.');
  }

  createPoForSupplier(row: SupplierCommandRow): void {
    const draftItems = row.poDraftItems.length ? row.poDraftItems : (row.suggestedPurchase ? [row.suggestedPurchase] : []);
    if (!draftItems.length || !draftItems[0]?.['branchId']) {
      this.error.set('No linked product or branch found for this supplier. Link a product/batch first.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('inventory-intelligence/purchase-orders', {
      branchId: draftItems[0]['branchId'],
      supplierId: row.supplier.id,
      sourceType: 'supplier_command',
      notes: `Supplier command draft for ${this.supplierDisplayName(row.supplier)}. ${row.poDraftItems.length} recommended item(s). ${draftItems[0]['reason'] || 'Replenishment required.'}`,
      items: draftItems.map((item) => ({
        productId: item['productId'],
        quantity: Number(item['quantity'] || 1),
        unitCost: Number(item['unitCost'] || 0)
      }))
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.success.set(`PO draft created for ${this.supplierDisplayName(row.supplier)}.`);
        this.load();
      },
      error: (error) => {
        this.saving.set(false);
        this.error.set(error?.error?.error || error?.message || 'Unable to create supplier PO draft');
      }
    });
  }

  markSupplierStatus(row: SupplierCommandRow, status: 'active' | 'blocked'): void {
    const reason = status === 'blocked' ? 'Blocked from supplier command register' : 'Reactivated from supplier command register';
    this.saving.set(true);
    this.error.set('');
    this.api.update('suppliers', row.supplier.id, this.withStatusHistory({
      ...row.supplier,
      status,
      statusReason: reason
    }, row.supplier)).subscribe({
      next: () => {
        this.saving.set(false);
        this.success.set(`${this.supplierDisplayName(row.supplier)} ${status === 'blocked' ? 'blocked' : 'reactivated'}.`);
        this.load();
      },
      error: (error) => {
        this.saving.set(false);
        this.error.set(error?.error?.error || error?.message || 'Unable to update supplier status');
      }
    });
  }

  formWarnings(): string[] {
    const raw = this.supplierForm.getRawValue();
    const warnings: string[] = [];
    const gstin = String(raw.gstin || '').trim().toUpperCase();
    if (gstin && !this.isValidGstin(gstin)) warnings.push('Invalid GSTIN format. Use 15-character Indian GSTIN.');
    if (!String(raw.phone || '').trim() && !String(raw.email || '').trim()) warnings.push('Phone or email is required for supplier ordering.');
    if (!String(raw.address || '').trim()) warnings.push('Billing address is missing.');
    for (const duplicate of this.duplicateWarnings(raw)) warnings.push(duplicate);
    return warnings;
  }

  rowAlertSummary(row: SupplierCommandRow): string {
    const parts = [
      ...row.complianceIssues,
      ...row.mappingWarnings,
      row.creditDaysOverdue > 0 ? `${row.creditDaysOverdue} credit day(s) overdue` : '',
      row.outstandingValue > 0 ? `${this.currencyText(row.outstandingValue)} payable` : ''
    ].filter(Boolean);
    return parts.slice(0, 4).join(' · ') || 'Ready';
  }

  private withStatusHistory(raw: ApiRecord, existing?: ApiRecord): ApiRecord {
    const nextStatus = String(raw.status || 'active');
    const previousStatus = String(existing?.['status'] || '');
    const history = this.statusHistory(existing || {});
    const statusChanged = !existing || (previousStatus && previousStatus !== nextStatus);
    if (statusChanged) {
      history.unshift({
        status: nextStatus,
        reason: raw.statusReason || (existing ? 'Status changed from supplier command register' : 'Supplier created'),
        at: new Date().toISOString()
      });
    }
    return {
      ...raw,
      gstin: String(raw.gstin || '').trim().toUpperCase(),
      leadTimeDays: Number(raw.leadTimeDays || 0),
      statusHistory: JSON.stringify(history.slice(0, 20)),
      statusChangedAt: statusChanged ? new Date().toISOString() : existing?.['statusChangedAt'] || ''
    };
  }

  private buildSupplierRows(): SupplierCommandRow[] {
    const scorecards = ((this.intelligence()?.['supplierScorecards'] || []) as ApiRecord[]);
    const supplierSpend = ((this.inventoryReport()?.['supplierSpend'] || []) as ApiRecord[]);
    const suggestions = ((this.intelligence()?.['suggestions'] || []) as ApiRecord[]);
    return this.suppliers()
      .map((supplier) => {
        const supplierId = String(supplier.id || '');
        const supplierName = this.supplierDisplayName(supplier).toLowerCase();
        const scorecard = scorecards.find((row) => row.id === supplierId);
        const spendRow = supplierSpend.find((row) => row.supplierId === supplierId || row.supplier_id === supplierId);
        const supplierBatches = this.batches().filter((batch) => this.recordSupplierId(batch) === supplierId);
        const batchProductIds = new Set(supplierBatches.map((batch) => String(batch.productId || batch.product_id || '')).filter(Boolean));
        const suppliedProducts = this.products().filter((product) => batchProductIds.has(String(product.id || '')) || String(product.supplier || '').toLowerCase() === supplierName);
        const suppliedProductIds = new Set(suppliedProducts.map((product) => String(product.id || '')));
        const purchaseTransactions = this.transactions()
          .filter((row) => this.recordSupplierId(row) === supplierId && String(row.type || '').includes('purchase'))
          .slice()
          .sort((a, b) => String(b.createdAt || b.created_at || '').localeCompare(String(a.createdAt || a.created_at || '')));
        const allPoRows = this.purchaseOrders().filter((row) => this.recordSupplierId(row) === supplierId);
        const openPoRows = allPoRows.filter((row) => !['received', 'closed', 'cancelled', 'rejected'].includes(String(row.status || 'draft').toLowerCase()));
        const openPoValue = this.money(openPoRows.reduce((total, row) => total + this.poValue(row), 0));
        const expiringBatchCount = supplierBatches.filter((batch) => Number(batch.quantityAvailable ?? batch.quantity_available ?? 0) > 0 && this.daysUntil(String(batch.expiryDate || batch.expiry_date || '')) <= 60).length;
        const lowStockCount = suppliedProducts.filter((product) => Number(product.stock || 0) <= Number(product.lowStockThreshold || product.low_stock_threshold || 0)).length;
        const wasteCount = this.transactions().filter((row) => suppliedProductIds.has(String(row.productId || row.product_id || '')) && /waste|expiry|damage/i.test(`${row.type || ''} ${row.reason || ''}`)).length;
        const qualityRisk = expiringBatchCount + lowStockCount + wasteCount;
        const purchaseValue = this.money(Math.max(
          Number(scorecard?.['purchaseValue'] || 0),
          Number(spendRow?.['spend'] || 0),
          Math.abs(purchaseTransactions.reduce((total, row) => total + Number(row.totalCost || row.total_cost || 0), 0))
        ));
        const supplierSuggestions = suggestions.filter((row) =>
          this.recordSupplierId(row) === supplierId
          || String(row.supplier || '').toLowerCase() === supplierName
          || suppliedProductIds.has(String(row.productId || row.product_id || ''))
        );
        const priceSignal = this.priceSignalForSupplier(supplierId, suppliedProductIds);
        const cheaperSignal = this.cheaperSupplierSignal(supplierId, suppliedProductIds);
        const poDraftItems = this.poDraftItemsForSupplier(supplier, suppliedProducts, supplierSuggestions);
        const suggestedPurchase = poDraftItems[0] || null;
        const reliability = this.reliabilityMetricsFor(supplierId, suppliedProductIds, allPoRows);
        const payment = this.paymentSnapshotFor(supplier, purchaseTransactions, openPoRows);
        const fallbackScore = Math.max(55, reliability.score - qualityRisk * 2);
        const score = Number(scorecard?.['reliabilityScore'] ?? scorecard?.['score'] ?? fallbackScore);
        const topProductName = suppliedProducts[0]?.['name'] || supplierSuggestions[0]?.['name'] || 'No product linked';
        const draftItems = poDraftItems
          .slice(0, 6)
          .map((row) => `${row['productName']} - ${row['quantity']} units`)
          .join(', ');
        const poDraftTotal = this.money(poDraftItems.reduce((total, item) => total + Number(item['totalCost'] || 0), 0));
        return {
          supplier,
          status: this.supplierStatus(supplier),
          score: this.money(score),
          purchaseValue,
          openPoCount: openPoRows.length,
          openPoValue,
          qualityRisk,
          expiringBatchCount,
          suppliedProducts: suppliedProducts.length,
          lastPurchaseAt: String(purchaseTransactions[0]?.['createdAt'] || purchaseTransactions[0]?.['created_at'] || ''),
          topProductName,
          missingContact: !String(supplier.phone || '').trim() && !String(supplier.email || '').trim(),
          missingGstin: !String(supplier.gstin || '').trim(),
          draftItems,
          statusReason: String(supplier.statusReason || ''),
          statusHistoryCount: this.statusHistory(supplier).length,
          complianceIssues: this.complianceIssues(supplier),
          priceChangePct: priceSignal.priceChangePct,
          cheaperAlternative: cheaperSignal.supplierName,
          cheaperSavingPct: cheaperSignal.savingPct,
          trendBars: this.trendBarsFor(purchaseTransactions),
          suggestedPurchase,
          reliabilityScore: reliability.score,
          onTimePct: reliability.onTimePct,
          damagePct: reliability.damagePct,
          returnPct: reliability.returnPct,
          invoiceMismatchPct: reliability.invoiceMismatchPct,
          paymentTerms: payment.terms,
          outstandingValue: payment.outstandingValue,
          lastPaymentAt: payment.lastPaymentAt,
          creditDaysOverdue: payment.creditDaysOverdue,
          poDraftItems,
          poDraftTotal,
          expectedDeliveryLabel: this.expectedDeliveryLabel(supplier),
          whatsappLogCount: this.whatsappLogCountFor(supplierId),
          mappingWarnings: this.mappingWarningsFor(suppliedProducts)
        };
      })
      .sort((a, b) => b.qualityRisk - a.qualityRisk || b.openPoValue - a.openPoValue || b.purchaseValue - a.purchaseValue || this.supplierDisplayName(a.supplier).localeCompare(this.supplierDisplayName(b.supplier)));
  }

  private matchesFilter(row: SupplierCommandRow, override?: SupplierFilter): boolean {
    const filter = override || this.activeFilter();
    if (filter === 'active') return row.status === 'active';
    if (filter === 'risk') return row.qualityRisk > 0 || row.score < 70;
    if (filter === 'pending-po') return row.openPoCount > 0;
    if (filter === 'missing-gstin') return row.missingGstin;
    if (filter === 'missing-contact') return row.missingContact;
    if (filter === 'no-purchase') return row.purchaseValue <= 0;
    if (filter === 'blocked') return row.status !== 'active';
    if (filter === 'price-rise') return row.priceChangePct > 0;
    if (filter === 'cheaper-available') return Boolean(row.cheaperAlternative);
    return true;
  }

  private matchesQuery(row: SupplierCommandRow): boolean {
    const term = this.query.trim().toLowerCase();
    if (!term) return true;
    return [
      this.supplierDisplayName(row.supplier),
      row.supplier.contactName,
      row.supplier.phone,
      row.supplier.email,
      row.supplier.gstin,
      row.supplier.address,
      row.status,
      row.topProductName
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(term);
  }

  private buildPriceComparisonRows(): ApiRecord[] {
    const byProduct = new Map<string, ApiRecord[]>();
    for (const row of this.transactions()) {
      const productId = String(row.productId || row.product_id || '');
      const supplierId = this.recordSupplierId(row);
      const unitCost = Number(row.unitCost || row.unit_cost || 0);
      if (!productId || !supplierId || unitCost <= 0) continue;
      const list = byProduct.get(productId) || [];
      list.push(row);
      byProduct.set(productId, list);
    }
    const rows: ApiRecord[] = [];
    for (const [productId, history] of byProduct.entries()) {
      const latestBySupplier = new Map<string, ApiRecord>();
      for (const item of history.slice().sort((a, b) => String(b.createdAt || b.created_at || '').localeCompare(String(a.createdAt || a.created_at || '')))) {
        const supplierId = this.recordSupplierId(item);
        if (supplierId && !latestBySupplier.has(supplierId)) latestBySupplier.set(supplierId, item);
      }
      const priced = Array.from(latestBySupplier.entries())
        .map(([supplierId, item]) => ({
          supplierId,
          supplierName: this.supplierDisplayName(this.suppliers().find((supplier) => String(supplier.id || '') === supplierId) || {}),
          cost: Number(item.unitCost || item.unit_cost || 0)
        }))
        .filter((item) => item.cost > 0)
        .sort((a, b) => a.cost - b.cost);
      if (priced.length < 2) continue;
      const best = priced[0];
      const highest = priced[priced.length - 1];
      const savingPct = highest.cost > best.cost ? ((highest.cost - best.cost) / highest.cost) * 100 : 0;
      rows.push({
        productId,
        productName: this.productName(productId),
        priceLine: priced.slice(0, 4).map((item) => `${item.supplierName} ${this.currencyText(item.cost)}`).join(', '),
        bestSupplierName: best.supplierName,
        bestCost: best.cost,
        savingPct: this.money(savingPct)
      });
    }
    return rows.sort((a, b) => Number(b.savingPct || 0) - Number(a.savingPct || 0));
  }

  private duplicateWarnings(raw: ApiRecord): string[] {
    const currentId = this.editingId();
    const normalizedPhone = this.digits(raw.phone);
    const normalizedEmail = String(raw.email || '').trim().toLowerCase();
    const normalizedGstin = String(raw.gstin || '').trim().toUpperCase();
    const warnings: string[] = [];
    const duplicatePhone = normalizedPhone && this.suppliers().find((supplier) => supplier.id !== currentId && this.digits(supplier.phone) === normalizedPhone);
    const duplicateEmail = normalizedEmail && this.suppliers().find((supplier) => supplier.id !== currentId && String(supplier.email || '').trim().toLowerCase() === normalizedEmail);
    const duplicateGstin = normalizedGstin && this.suppliers().find((supplier) => supplier.id !== currentId && String(supplier.gstin || '').trim().toUpperCase() === normalizedGstin);
    if (duplicatePhone) warnings.push(`Duplicate phone already used by ${this.supplierDisplayName(duplicatePhone)}.`);
    if (duplicateEmail) warnings.push(`Duplicate email already used by ${this.supplierDisplayName(duplicateEmail)}.`);
    if (duplicateGstin) warnings.push(`Duplicate GSTIN already used by ${this.supplierDisplayName(duplicateGstin)}.`);
    return warnings;
  }

  private complianceIssues(supplier: ApiRecord): string[] {
    const issues: string[] = [];
    const gstin = String(supplier.gstin || '').trim();
    if (!gstin) issues.push('GSTIN missing');
    else if (!this.isValidGstin(gstin)) issues.push('GSTIN invalid');
    if (!String(supplier.phone || '').trim() && !String(supplier.email || '').trim()) issues.push('Contact missing');
    if (!String(supplier.address || '').trim()) issues.push('Billing address missing');
    if (!this.paymentTermsFor(supplier)) issues.push('Payment terms missing');
    if (!String(supplier.invoiceFormat || supplier.preferredInvoiceFormat || supplier.invoice_format || '').trim()) issues.push('Invoice format missing');
    if (this.supplierStatus(supplier) !== 'active') issues.push(`${this.supplierStatus(supplier)} status`);
    return issues;
  }

  private isValidGstin(value: string): boolean {
    return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(value || '').trim().toUpperCase());
  }

  private statusHistory(supplier: ApiRecord): ApiRecord[] {
    const raw = supplier?.['statusHistory'];
    if (Array.isArray(raw)) return raw;
    try {
      const parsed = JSON.parse(String(raw || '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private poDraftItemsForSupplier(supplier: ApiRecord, suppliedProducts: ApiRecord[], suggestions: ApiRecord[]): ApiRecord[] {
    const byProduct = new Map<string, ApiRecord>();
    for (const suggested of suggestions.filter((row) => row.productId || row.product_id)) {
      const productId = String(suggested.productId || suggested.product_id || '');
      if (!productId || byProduct.has(productId)) continue;
      const product = this.products().find((item) => String(item.id || '') === productId);
      const quantity = Number(suggested.recommendedQty || suggested.recommended_qty || suggested.quantity || 1);
      const unitCost = Number(product?.['unitCost'] || product?.['unit_cost'] || suggested['unitCost'] || suggested['unit_cost'] || 0);
      byProduct.set(productId, {
        productId,
        productName: product?.['name'] || suggested['name'] || this.productName(productId),
        branchId: suggested.branchId || suggested.branch_id || product?.['branchId'] || product?.['branch_id'] || this.api.selectedBranchId(),
        quantity,
        unitCost,
        totalCost: this.money(quantity * unitCost),
        reason: suggested.reason || 'AI reorder suggestion'
      });
    }
    for (const product of suppliedProducts) {
      const productId = String(product.id || '');
      if (!productId || byProduct.has(productId)) continue;
      const threshold = Number(product.lowStockThreshold || product.low_stock_threshold || 0);
      const stock = Number(product.stock || 0);
      if (threshold > 0 && stock > threshold) continue;
      const quantity = Math.max(1, threshold > 0 ? threshold * 2 - stock : 1);
      const unitCost = Number(product.unitCost || product.unit_cost || product.cost || 0);
      byProduct.set(productId, {
        productId,
        productName: product.name || productId,
        branchId: product.branchId || product.branch_id || this.api.selectedBranchId(),
        quantity,
        unitCost,
        totalCost: this.money(quantity * unitCost),
        reason: stock <= threshold ? 'Low stock supplier-linked product' : `Manual supplier replenishment for ${this.supplierDisplayName(supplier)}`
      });
      if (byProduct.size >= 12) break;
    }
    return Array.from(byProduct.values()).slice(0, 12);
  }

  private trendBarsFor(rows: ApiRecord[]): number[] {
    const values = rows
      .slice()
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
      .slice(-6)
      .map((row) => Math.abs(Number(row.totalCost || row.total_cost || 0)));
    const max = Math.max(...values, 1);
    const bars = values.map((value) => Math.max(8, Math.round((value / max) * 100)));
    while (bars.length < 6) bars.unshift(8);
    return bars;
  }

  private priceSignalForSupplier(supplierId: string, productIds: Set<string>): { priceChangePct: number } {
    let maxChange = 0;
    for (const productId of productIds) {
      const rows = this.transactions()
        .filter((row) => this.recordSupplierId(row) === supplierId && String(row.productId || row.product_id || '') === productId && Number(row.unitCost || row.unit_cost || 0) > 0)
        .slice()
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      if (rows.length < 2) continue;
      const first = Number(rows[0].unitCost || rows[0].unit_cost || 0);
      const last = Number(rows[rows.length - 1].unitCost || rows[rows.length - 1].unit_cost || 0);
      if (first > 0 && last > first) maxChange = Math.max(maxChange, ((last - first) / first) * 100);
    }
    return { priceChangePct: this.money(maxChange) };
  }

  private cheaperSupplierSignal(supplierId: string, productIds: Set<string>): { supplierName: string; savingPct: number } {
    let best = { supplierName: '', savingPct: 0 };
    for (const productId of productIds) {
      const rows = this.transactions()
        .filter((row) => String(row.productId || row.product_id || '') === productId && Number(row.unitCost || row.unit_cost || 0) > 0)
        .slice()
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const current = rows.find((row) => this.recordSupplierId(row) === supplierId);
      if (!current) continue;
      const currentCost = Number(current.unitCost || current.unit_cost || 0);
      const alternate = rows
        .filter((row) => this.recordSupplierId(row) && this.recordSupplierId(row) !== supplierId)
        .sort((a, b) => Number(a.unitCost || a.unit_cost || 0) - Number(b.unitCost || b.unit_cost || 0))[0];
      if (!alternate) continue;
      const alternateCost = Number(alternate.unitCost || alternate.unit_cost || 0);
      if (alternateCost <= 0 || alternateCost >= currentCost) continue;
      const savingPct = ((currentCost - alternateCost) / currentCost) * 100;
      if (savingPct > best.savingPct) {
        best = {
          supplierName: this.supplierDisplayName(this.suppliers().find((supplier) => String(supplier.id || '') === this.recordSupplierId(alternate)) || {}),
          savingPct: this.money(savingPct)
        };
      }
    }
    return best;
  }

  private reliabilityMetricsFor(supplierId: string, productIds: Set<string>, poRows: ApiRecord[]): { score: number; onTimePct: number; damagePct: number; returnPct: number; invoiceMismatchPct: number } {
    const supplierPurchases = this.transactions().filter((row) => this.recordSupplierId(row) === supplierId || productIds.has(String(row.productId || row.product_id || '')));
    const expectedRows = poRows.filter((row) => this.poExpectedDate(row));
    const lateRows = expectedRows.filter((row) => this.isPoLate(row));
    const onTimePct = expectedRows.length ? this.percent(expectedRows.length - lateRows.length, expectedRows.length) : Math.max(60, 100 - this.openOldPoCount(poRows) * 12);
    const damageRows = supplierPurchases.filter((row) => /damage|damaged|short|waste|expiry|leak/i.test(`${row.type || ''} ${row.reason || ''} ${row.status || ''}`));
    const returnRows = supplierPurchases.filter((row) => /return|replacement|refund/i.test(`${row.type || ''} ${row.reason || ''} ${row.status || ''}`));
    const invoiceMismatchRows = poRows.filter((row) => this.poVarianceCount(row) > 0 || /invoice|gst|rate|mismatch|short|damage/i.test(`${row.status || ''} ${row.notes || ''} ${row.receiveNote || row.receive_note || ''}`));
    const denominator = Math.max(1, poRows.length || supplierPurchases.length);
    const damagePct = this.percent(damageRows.length, denominator);
    const returnPct = this.percent(returnRows.length, denominator);
    const invoiceMismatchPct = this.percent(invoiceMismatchRows.length, denominator);
    const score = Math.max(40, Math.min(100, Math.round(100 - ((100 - onTimePct) * 0.35) - damagePct * 0.25 - returnPct * 0.15 - invoiceMismatchPct * 0.25)));
    return { score, onTimePct, damagePct, returnPct, invoiceMismatchPct };
  }

  private paymentSnapshotFor(supplier: ApiRecord, purchaseTransactions: ApiRecord[], openPoRows: ApiRecord[]): { terms: string; outstandingValue: number; lastPaymentAt: string; creditDaysOverdue: number } {
    const terms = this.paymentTermsFor(supplier) || 'Payment terms missing';
    const openPoValue = openPoRows.reduce((total, row) => total + this.poValue(row), 0);
    const unpaidPurchaseValue = purchaseTransactions.reduce((total, row) => total + Number(row.outstandingAmount || row.outstanding_amount || row.balanceDue || row.balance_due || row.payableAmount || row.payable_amount || 0), 0);
    const outstandingValue = this.money(openPoValue + unpaidPurchaseValue);
    const lastPaymentAt = String(supplier.lastPaymentAt || supplier.last_payment_at || purchaseTransactions.find((row) => row.paymentDate || row.payment_date || row.paidAt || row.paid_at)?.['paymentDate'] || '');
    const creditDays = this.creditDaysFor(terms);
    const lastPurchaseAt = String(purchaseTransactions[0]?.['createdAt'] || purchaseTransactions[0]?.['created_at'] || '');
    const creditDaysOverdue = outstandingValue > 0 && creditDays > 0 && lastPurchaseAt ? Math.max(0, this.daysSince(lastPurchaseAt) - creditDays) : 0;
    return { terms, outstandingValue, lastPaymentAt, creditDaysOverdue };
  }

  private paymentTermsFor(supplier: ApiRecord): string {
    return String(supplier.preferredPaymentTerms || supplier.paymentTerms || supplier.payment_terms || '').trim();
  }

  private creditDaysFor(terms: string): number {
    const normalized = String(terms || '').toLowerCase();
    if (!normalized || /cash|cod|advance/.test(normalized)) return 0;
    const match = normalized.match(/net\s*(\d+)|(\d+)\s*days?|credit\s*(\d+)/);
    return match ? Number(match[1] || match[2] || match[3] || 0) : 0;
  }

  private expectedDeliveryLabel(supplier: ApiRecord): string {
    const leadDays = Number(supplier.leadTimeDays || supplier.lead_time_days || 0);
    if (!leadDays) return 'Delivery date not set';
    const date = new Date(Date.now() + leadDays * 86400000);
    return `${leadDays} day(s) · ${date.toLocaleDateString('en-IN')}`;
  }

  private whatsappLogCountFor(supplierId: string): number {
    return this.whatsappQueue().filter((row) => this.recordSupplierId(row) === supplierId || String(row.supplierId || row.supplier_id || '') === supplierId).length;
  }

  private mappingWarningsFor(suppliedProducts: ApiRecord[]): string[] {
    const warnings: string[] = [];
    if (!suppliedProducts.length) return ['No product linked'];
    const missingSku = suppliedProducts.filter((product) => !String(product.sku || product.code || product.productCode || product.product_code || '').trim()).length;
    const missingAlias = suppliedProducts.filter((product) => !String(product.supplierSku || product.supplier_sku || product.vendorSku || product.vendor_sku || product.supplierAlias || '').trim()).length;
    if (missingSku) warnings.push(`${missingSku} SKU missing`);
    if (missingAlias) warnings.push(`${missingAlias} supplier alias missing`);
    return warnings;
  }

  private poVarianceCount(row: ApiRecord): number {
    return this.asArray(row.variances).length + this.asArray(row.warnings).length;
  }

  private poExpectedDate(row: ApiRecord): string {
    return String(row.expectedDeliveryDate || row.expected_delivery_date || row.deliveryDate || row.delivery_date || '');
  }

  private poReceivedDate(row: ApiRecord): string {
    return String(row.grnDate || row.grn_date || row.closedAt || row.closed_at || row.receivedAt || row.received_at || row.updatedAt || row.updated_at || '');
  }

  private isPoLate(row: ApiRecord): boolean {
    const expected = this.poExpectedDate(row);
    if (!expected) return false;
    const expectedTime = new Date(expected).getTime();
    if (Number.isNaN(expectedTime)) return false;
    const received = this.poReceivedDate(row);
    const actualTime = received ? new Date(received).getTime() : Date.now();
    return !Number.isNaN(actualTime) && actualTime > expectedTime;
  }

  private openOldPoCount(rows: ApiRecord[]): number {
    return rows.filter((row) => !['received', 'closed', 'cancelled', 'rejected'].includes(String(row.status || 'draft').toLowerCase()) && this.daysSince(row.createdAt || row.created_at) > 14).length;
  }

  private asArray(value: unknown): ApiRecord[] {
    if (Array.isArray(value)) return value as ApiRecord[];
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private percent(part: number, total: number): number {
    return this.money(total > 0 ? (part / total) * 100 : 0);
  }

  private daysSince(value: unknown): number {
    const time = new Date(String(value || '')).getTime();
    if (!value || Number.isNaN(time)) return 0;
    return Math.max(0, Math.round((Date.now() - time) / 86400000));
  }

  private currencyText(value: number): string {
    return `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
  }

  private digits(value: unknown): string {
    return String(value || '').replace(/\D/g, '');
  }

  private recordSupplierId(row: ApiRecord): string {
    return String(row.supplierId || row.supplier_id || '');
  }

  private supplierStatus(supplier: ApiRecord): string {
    return String(supplier.status || 'active').toLowerCase();
  }

  private productName(id: unknown): string {
    const productId = String(id || '');
    return this.products().find((product) => String(product.id || '') === productId)?.name || productId || 'Product';
  }

  supplierDisplayName(supplier: ApiRecord | null | undefined): string {
    return String(supplier?.['name'] || supplier?.['supplierName'] || supplier?.['vendorName'] || supplier?.['id'] || 'Unnamed supplier').trim();
  }

  private normalizedSuppliers(rows: ApiRecord[] | null | undefined): ApiRecord[] {
    return (rows || [])
      .filter((row): row is ApiRecord => Boolean(row && typeof row === 'object'))
      .map((row, index) => ({
        ...row,
        name: this.supplierDisplayName(row) || `Supplier ${index + 1}`
      }));
  }

  private poValue(row: ApiRecord): number {
    if (row.totalEstimatedCost || row.total_estimated_cost || row.grandTotal || row.grand_total) return Number(row.grandTotal || row.grand_total || row.totalEstimatedCost || row.total_estimated_cost || 0);
    return this.asArray(row.items).reduce((total, item) => total + Number(item.estimatedTotal || item.estimated_total || item.lineTotal || item.line_total || 0), 0);
  }

  private daysUntil(value: string): number {
    if (!value) return 9999;
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return 9999;
    return Math.round((time - Date.now()) / 86400000);
  }

  private money(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }
}
