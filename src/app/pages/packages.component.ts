import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type PackageForm = {
  id: string;
  name: string;
  description: string;
  paidSessions: number;
  freeSessions: number;
  price: number;
  costPrice: number;
  validityDays: number;
  validityUnit: 'Days' | 'Month' | 'Year';
  status: string;
  showMobileApp: boolean;
  showOnlineBooking: boolean;
  serviceRows: PackageServiceRow[];
};

type PackageServiceRow = {
  serviceId: string;
  serviceName: string;
  quantity: number;
  unitPrice: number;
};

type RedemptionLine = {
  step: number;
  date: string;
  service: string;
  staff: string;
  balance: number;
  invoice: string;
};

@Component({
  selector: 'app-packages',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack packages-page inner-page-shell">
      <app-state [loading]="loading()" [error]="error()"></app-state>
      <p class="state success" *ngIf="message()">{{ message() }}</p>

      <section class="salonist-layout">
        <main class="packages-main">
          <button class="floating-add" type="button" (click)="toggleForm()" aria-label="Add package">+</button>
          <header class="packages-title inner-page-header">
            <h1>Packages</h1>
            <p>
              Boost revenue with treatment packages, turning clients into loyal regulars. Manage package history for seamless
              administration, increased profitability <a href="#" (click)="$event.preventDefault()">Learn more</a>
            </p>
            <a class="report-link" routerLink="/reports/pending-packages">Pending Packages Report</a>
          </header>

          <div class="list-controls inner-action-bar">
            <label class="show-control">
              <span>Show</span>
              <select [ngModel]="showLimit()" (ngModelChange)="showLimit.set(moneyValue($event))">
                <option [ngValue]="10">10</option>
                <option [ngValue]="25">25</option>
                <option [ngValue]="50">50</option>
              </select>
            </label>
            <label class="search-pill">
              <span class="sr-only">Search</span>
              <input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Search" />
            </label>
          </div>

          <div class="salonist-table-wrap inner-table-wrap">
            <table class="salonist-table">
              <thead>
                <tr>
                  <th class="check-col"><input type="checkbox" aria-label="Select all packages" /></th>
                  <th>Name</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th class="action-col">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let item of visiblePackages()">
                  <td class="check-col"><input type="checkbox" [attr.aria-label]="'Select ' + packageName(item)" /></td>
                  <td>
                    <div class="package-name-cell">
                      <span class="package-avatar">{{ packageInitial(item) }}</span>
                      <div>
                        <strong>{{ packageName(item) }}</strong>
                        <small>{{ packageRuleText(item) }}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div class="price-cell">
                      <del *ngIf="packageCostPrice(item) > packageSellingPrice(item)">
                        {{ packageCostPrice(item) | auraMoney:'1.0-0' }}
                      </del>
                      <strong>{{ packageSellingPrice(item) | auraMoney:'1.0-0' }}</strong>
                    </div>
                  </td>
                  <td><span class="status-pill">{{ item.status || 'Active' }}</span></td>
                  <td class="action-cell">
                    <button class="dots-button" type="button" (click)="toggleActionMenu(item, $event)" aria-label="Package actions">...</button>
                    <div class="action-menu" *ngIf="openActionId() === recordId(item)">
                      <button type="button" (click)="editPackage(item); openActionId.set('')">Edit</button>
                      <button type="button" (click)="archivePackage(item)">Delete</button>
                      <button type="button" (click)="markPackageInactive(item)">Inactive Status</button>
                      <button type="button" (click)="viewPackage(item)">View</button>
                    </div>
                  </td>
                </tr>
                <tr *ngIf="!visiblePackages().length">
                  <td colspan="5" class="empty-row">No package found. Plus button se naya 3+1 / 4+1 package banao.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <footer class="list-footer">
            <span>Showing 1 to {{ visiblePackages().length }} of {{ filteredPackages().length }} Entries</span>
            <div class="pager">
              <button type="button" disabled>Previous</button>
              <button class="active" type="button">1</button>
              <button type="button" disabled>Next</button>
            </div>
          </footer>
        </main>
      </section>

      <div class="package-drawer-shell" *ngIf="showForm()">
        <button class="drawer-scrim" type="button" (click)="resetForm()" aria-label="Close package drawer"></button>
        <aside class="package-drawer">
          <div class="drawer-title">
            <button class="icon-button" type="button" (click)="resetForm()">×</button>
            <h2>{{ form.id ? 'Update Package' : 'Add New Package' }}</h2>
          </div>

          <input class="drawer-input" [(ngModel)]="form.name" placeholder="Package Name" />
          <select class="drawer-input" [ngModel]="serviceToAdd" (ngModelChange)="addServiceLine($event)">
            <option value="">Select Service</option>
            <option *ngFor="let service of services()" [value]="recordId(service)">
              {{ serviceName(service) }} (Price: {{ servicePrice(service) | auraMoney:'1.0-0' }})
            </option>
          </select>

          <div class="package-service-table" *ngIf="form.serviceRows.length">
            <div class="service-table-head">
              <span>Service Name</span>
              <span>Qty</span>
              <span>Price</span>
              <span>Status</span>
              <span>Delete</span>
            </div>
            <div class="service-table-row" *ngFor="let row of form.serviceRows; let index = index">
              <strong>{{ row.serviceName }}</strong>
              <div class="qty-stepper">
                <button type="button" (click)="changeServiceQty(index, -1)">−</button>
                <input type="number" min="1" [(ngModel)]="row.quantity" (ngModelChange)="syncPackageTotals()" />
                <button type="button" (click)="changeServiceQty(index, 1)">+</button>
              </div>
              <label class="money-input"><span>₹</span><input type="number" min="0" [(ngModel)]="row.unitPrice" (ngModelChange)="syncPackageTotals()" /></label>
              <span class="badge">Active</span>
              <button class="delete-button" type="button" (click)="removeServiceLine(index)">Delete</button>
            </div>
          </div>

          <div class="drawer-grid">
            <label class="field">
              <span>Paid sessions</span>
              <input type="number" min="1" [(ngModel)]="form.paidSessions" (ngModelChange)="applyFormulaToRows()" />
            </label>
            <label class="field">
              <span>Free sessions</span>
              <input type="number" min="0" [(ngModel)]="form.freeSessions" (ngModelChange)="applyFormulaToRows()" />
            </label>
            <label class="field">
              <span>Cost Price (₹)</span>
              <input type="number" min="0" [(ngModel)]="form.costPrice" />
            </label>
            <label class="field">
              <span>Special Price (₹)</span>
              <input type="number" min="0" [(ngModel)]="form.price" />
            </label>
            <label class="field">
              <span>Number of days</span>
              <input type="number" min="1" [(ngModel)]="form.validityDays" />
            </label>
            <label class="field">
              <span>Validity</span>
              <select [(ngModel)]="form.validityUnit">
                <option value="Days">Days</option>
                <option value="Month">Month</option>
                <option value="Year">Year</option>
              </select>
            </label>
          </div>

          <div class="preset-row">
            <button class="ghost-button mini" type="button" (click)="applyPackageFormula(3, 1)">3+1</button>
            <button class="ghost-button mini" type="button" (click)="applyPackageFormula(4, 1)">4+1</button>
            <button class="ghost-button mini" type="button" (click)="applyPackageFormula(5, 2)">5+2</button>
            <span>{{ totalSessions() }} credit(s) per selected service</span>
          </div>

          <div class="show-box">
            <strong>Show in</strong>
            <label><span>Customize Mobile APP</span><input type="checkbox" [(ngModel)]="form.showMobileApp" /></label>
            <label><span>Online Booking Page</span><input type="checkbox" [(ngModel)]="form.showOnlineBooking" /></label>
          </div>

          <div class="form-actions">
            <button class="ghost-button" type="button" (click)="resetForm()">Cancel</button>
            <button class="primary-button" type="button" (click)="savePackage()" [disabled]="saving()">{{ saving() ? 'Saving...' : 'Save' }}</button>
          </div>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .packages-page {
      gap: 18px;
    }

    .salonist-layout {
      min-height: calc(100vh - 170px);
      padding: 18px 22px 28px;
      border-radius: 6px;
      background: #fff;
      box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
    }

    .packages-main {
      position: relative;
      min-width: 0;
      padding: 2px 24px 0 6px;
    }

    .packages-title h1 {
      margin: 0 0 8px;
      color: #111827;
      font-size: 28px;
      line-height: 1.15;
    }

    .packages-title p {
      max-width: 780px;
      margin: 0;
      color: #4b5563;
      font-size: 14px;
      line-height: 1.5;
    }

    .packages-title a {
      color: #4B1238;
      font-weight: 800;
      text-decoration: none;
    }

    .packages-title .report-link {
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      margin-top: 14px;
      padding: 0 16px;
      border: 1px solid #b7e5d8;
      border-radius: 6px;
      background: #F3EAF0;
      color: #075e4b;
      font-weight: 900;
    }

    .floating-add {
      position: absolute;
      top: 4px;
      right: 6px;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 50%;
      background: #24262b;
      color: #fff;
      font-size: 30px;
      line-height: 1;
      box-shadow: 0 14px 24px rgba(15, 23, 42, 0.2);
      cursor: pointer;
    }

    .list-controls,
    .list-footer,
    .pager,
    .package-name-cell,
    .action-cell {
      display: flex;
      align-items: center;
    }

    .list-controls {
      justify-content: space-between;
      gap: 16px;
      margin: 42px 0 18px;
    }

    .show-control {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #6b7280;
      font-size: 14px;
    }

    .show-control select {
      width: 72px;
      min-height: 36px;
      border-color: #d1d5db;
      border-radius: 4px;
      padding: 6px 28px 6px 10px;
    }

    .search-pill {
      width: min(100%, 250px);
    }

    .search-pill input {
      min-height: 38px;
      border-color: #d1d5db;
      border-radius: 999px;
      padding: 8px 34px 8px 14px;
      background: #fff;
    }

    .salonist-table-wrap {
      overflow: visible;
      border-top: 1px solid #e5e7eb;
    }

    .salonist-table {
      min-width: 720px;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .salonist-table th,
    .salonist-table td {
      border-bottom: 1px solid #e5e7eb;
      padding: 12px 14px;
      background: #fff;
      color: #111827;
      vertical-align: middle;
    }

    .salonist-table th {
      color: #111827;
      font-size: 13px;
      font-weight: 800;
      text-transform: none;
    }

    .salonist-table .check-col {
      width: 42px;
      text-align: center;
    }

    .salonist-table .action-col {
      width: 128px;
      text-align: right;
    }

    .salonist-table th:last-child,
    .salonist-table td:last-child {
      padding-right: 32px;
    }

    .salonist-table input[type="checkbox"] {
      width: 15px;
      min-height: 15px;
      padding: 0;
      border-radius: 2px;
    }

    .package-name-cell {
      gap: 12px;
      min-width: 0;
    }

    .package-avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      flex: 0 0 34px;
      border-radius: 50%;
      background: #111827;
      color: #fff;
      font-size: 14px;
      font-weight: 900;
    }

    .package-name-cell strong {
      display: block;
      color: #111827;
      font-size: 15px;
    }

    .package-name-cell small {
      max-width: 520px;
      color: #6b7280;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .price-cell {
      display: grid;
      gap: 2px;
    }

    .price-cell del {
      color: #9ca3af;
      font-size: 12px;
    }

    .price-cell strong {
      color: #111827;
      font-size: 14px;
    }

    .status-pill {
      display: inline-flex;
      min-width: 96px;
      justify-content: center;
      border-radius: 3px;
      background: #79cfad;
      color: #fff;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 800;
      text-transform: capitalize;
    }

    .action-cell {
      position: relative;
      justify-content: flex-end;
    }

    .dots-button {
      width: 34px;
      height: 30px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      background: #fff;
      color: #111827;
      font-size: 18px;
      font-weight: 900;
      line-height: 1;
      cursor: pointer;
    }

    .action-menu {
      position: absolute;
      top: 34px;
      right: 32px;
      z-index: 5;
      min-width: 150px;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      background: #fff;
      box-shadow: 0 16px 34px rgba(15, 23, 42, 0.18);
      padding: 4px 0;
    }

    .action-menu button {
      display: block;
      width: 100%;
      min-height: 34px;
      border: 0;
      background: #fff;
      color: #111827;
      font: inherit;
      font-size: 13px;
      text-align: left;
      padding: 8px 12px;
      cursor: pointer;
    }

    .action-menu button:hover {
      background: #f3f4f6;
    }

    .empty-row {
      text-align: center;
      color: #6b7280;
      height: 90px;
    }

    .list-footer {
      justify-content: space-between;
      gap: 14px;
      margin-top: 18px;
      color: #6b7280;
      font-size: 14px;
    }

    .pager {
      gap: 8px;
    }

    .pager button {
      min-width: 42px;
      min-height: 36px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      background: #fff;
      color: #6b7280;
      font: inherit;
    }

    .pager button.active {
      border-color: #111827;
      color: #111827;
      font-weight: 800;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
    }

    .package-hero {
      align-items: center;
      min-height: 180px;
    }

    .package-builder,
    .panel,
    .package-detail {
      border: 1px solid #cfe4df;
      border-radius: 8px;
      background: #fff;
      padding: 18px;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.06);
    }

    .package-drawer-shell {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      justify-content: flex-end;
    }

    .drawer-scrim {
      position: absolute;
      inset: 0;
      border: 0;
      background: rgba(15, 23, 42, 0.62);
    }

    .package-drawer {
      position: relative;
      z-index: 1;
      width: min(100%, 460px);
      min-height: 100vh;
      overflow: auto;
      padding: 18px;
      background: #fff;
      box-shadow: -24px 0 60px rgba(15, 23, 42, 0.22);
    }

    .drawer-title {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .drawer-title h2 {
      margin: 0;
      font-size: 22px;
    }

    .icon-button,
    .delete-button {
      border: 0;
      background: transparent;
      color: #111827;
      font: inherit;
      font-weight: 900;
      cursor: pointer;
    }

    .icon-button {
      font-size: 28px;
      line-height: 1;
    }

    .drawer-help {
      margin: 0 0 14px;
      padding: 12px;
      background: #f3f4f6;
      color: #374151;
      font-size: 13px;
      line-height: 1.5;
    }

    .drawer-input {
      margin-bottom: 10px;
    }

    .package-service-table {
      margin: 16px 0;
      border-top: 1px solid #e5e7eb;
      border-bottom: 1px solid #e5e7eb;
      padding: 12px 0;
    }

    .service-table-head,
    .service-table-row {
      display: grid;
      grid-template-columns: minmax(150px, 1fr) 76px 104px 72px 56px;
      gap: 10px;
      align-items: center;
    }

    .service-table-head {
      color: #111827;
      font-size: 12px;
      font-weight: 900;
      margin-bottom: 10px;
    }

    .service-table-row {
      padding: 10px 0;
      font-size: 13px;
    }

    .qty-stepper,
    .money-input {
      display: flex;
      align-items: center;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      overflow: hidden;
      min-height: 34px;
    }

    .qty-stepper button {
      width: 28px;
      height: 34px;
      border: 0;
      background: #1f2937;
      color: #fff;
      font-weight: 900;
    }

    .qty-stepper input,
    .money-input input {
      min-height: 34px;
      border: 0;
      border-radius: 0;
      padding: 6px;
      text-align: center;
    }

    .money-input span {
      padding: 0 8px;
      color: #64748b;
      border-right: 1px solid #d1d5db;
    }

    .drawer-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .preset-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin: 12px 0;
      color: #64748b;
      font-size: 13px;
      font-weight: 800;
    }

    .show-box {
      display: grid;
      gap: 10px;
      margin-top: 14px;
      padding: 12px;
      border: 1px solid #e5e7eb;
      background: #fff;
    }

    .show-box label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: #334155;
      font-weight: 800;
    }

    .show-box input {
      width: auto;
      min-height: auto;
    }

    .builder-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 14px;
    }

    .span-2 {
      grid-column: span 2;
    }

    .field,
    .search-field {
      display: grid;
      gap: 6px;
      color: #64748b;
      font-weight: 800;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    input,
    select {
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      min-height: 44px;
      padding: 10px 12px;
      font: inherit;
      color: #0f172a;
      background: #fff;
      text-transform: none;
      font-weight: 500;
    }

    .formula-preview,
    .package-metrics,
    .detail-summary,
    .mini-grid {
      display: grid;
      gap: 12px;
    }

    .formula-preview {
      grid-template-columns: repeat(4, minmax(150px, 1fr));
      margin-top: 14px;
    }

    .package-metrics {
      grid-template-columns: repeat(4, minmax(180px, 1fr));
    }

    .formula-preview article,
    .package-metrics article,
    .detail-summary article {
      border: 1px solid #d7ebe7;
      border-radius: 8px;
      padding: 14px;
      background: #f8fdfb;
    }

    .formula-preview span,
    .package-metrics span,
    .detail-summary span {
      display: block;
      color: #64748b;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .formula-preview strong,
    .package-metrics strong,
    .detail-summary strong {
      display: block;
      margin-top: 4px;
      color: #102033;
      font-size: 22px;
    }

    .form-actions,
    .table-toolbar,
    .client-package-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .form-actions {
      justify-content: flex-end;
      margin-top: 16px;
    }

    .table-toolbar {
      margin-bottom: 14px;
    }

    .search-field {
      min-width: min(100%, 480px);
    }

    .package-workspace {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(360px, 0.9fr);
      gap: 16px;
      align-items: start;
    }

    .table-wrap {
      overflow: auto;
      border: 1px solid #dbe8e5;
      border-radius: 8px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 900px;
    }

    th,
    td {
      padding: 12px;
      border-bottom: 1px solid #e5eeee;
      text-align: left;
      vertical-align: top;
    }

    th {
      background: #f6faf9;
      color: #475569;
      font-size: 12px;
      text-transform: uppercase;
    }

    tbody tr {
      cursor: pointer;
    }

    tbody tr:hover,
    tbody tr.active {
      background: #FBF0E8;
    }

    td small,
    .client-package-head small {
      display: block;
      margin-top: 3px;
      color: #64748b;
      font-size: 12px;
    }

    .detail-summary {
      grid-template-columns: repeat(3, 1fr);
      margin: 14px 0;
    }

    .detail-summary strong {
      font-size: 18px;
    }

    .client-package-card {
      border: 1px solid #dbe8e5;
      border-radius: 8px;
      padding: 14px;
      margin-top: 12px;
      background: #fbfefd;
    }

    .client-package-head a {
      color: #4B1238;
      font-weight: 900;
      text-decoration: none;
    }

    .mini-grid {
      grid-template-columns: repeat(4, 1fr);
      margin: 12px 0;
      color: #64748b;
      font-size: 13px;
    }

    .mini-grid strong {
      color: #0f172a;
    }

    .redeem-list {
      display: grid;
      gap: 8px;
    }

    .redeem-line {
      display: grid;
      grid-template-columns: minmax(160px, 1fr) auto;
      gap: 4px 10px;
      border-radius: 8px;
      background: #f1f5ff;
      padding: 10px;
    }

    .redeem-line span {
      color: #4B1238;
      font-weight: 900;
    }

    .redeem-line small {
      grid-column: 1 / -1;
      color: #64748b;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 6px 10px;
      background: #FBF0E8;
      color: #7A4A28;
      font-size: 12px;
      font-weight: 900;
      text-transform: capitalize;
    }

    .badge.warning {
      background: #fee2e2;
      color: #b91c1c;
    }

    .empty-note {
      margin: 10px 0 0;
      border-radius: 8px;
      background: #f8fafc;
      color: #64748b;
      padding: 12px;
    }

    @media (max-width: 1100px) {
      .floating-add {
        top: 0;
      }

      .builder-grid,
      .formula-preview,
      .package-metrics,
      .package-workspace {
        grid-template-columns: 1fr;
      }

      .span-2 {
        grid-column: auto;
      }
    }
  `]
})
export class PackagesComponent implements OnInit {
  readonly packages = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly clients = signal<ApiRecord[]>([]);
  readonly memberships = signal<ApiRecord[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly showForm = signal(false);
  readonly selectedPackageId = signal('');
  readonly query = signal('');
  readonly showLimit = signal(10);
  readonly openActionId = signal('');
  form: PackageForm = this.defaultForm();
  serviceToAdd = '';

  readonly filteredPackages = computed(() => {
    const term = this.query().trim().toLowerCase();
    const rows = [...this.packages()].sort((a, b) => this.packageName(a).localeCompare(this.packageName(b)));
    if (!term) return rows;
    return rows.filter((item) => [
      this.packageName(item),
      this.packageRuleText(item),
      String(item.description || ''),
      ...this.packageMembers(item).map((membership) => this.clientName(membership))
    ].join(' ').toLowerCase().includes(term));
  });
  readonly visiblePackages = computed(() => this.filteredPackages().slice(0, Math.max(1, this.showLimit())));

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      packages: this.api.list<ApiRecord[]>('packages', { limit: 1000, includeAllBranches: true }),
      services: this.api.list<ApiRecord[]>('services', { limit: 1000 }),
      clients: this.api.list<ApiRecord[]>('clients', { limit: 1000, compact: true }),
      memberships: this.api.list<ApiRecord[]>('memberships', { limit: 5000, includeAllBranches: true })
    }).subscribe({
      next: ({ packages, services, clients, memberships }) => {
        this.packages.set(Array.isArray(packages) ? packages : []);
        this.services.set(Array.isArray(services) ? services : []);
        this.clients.set(Array.isArray(clients) ? clients : []);
        this.memberships.set(Array.isArray(memberships) ? memberships : []);
        if (!this.selectedPackageId() && this.packages().length) this.selectedPackageId.set(this.recordId(this.packages()[0]));
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Packages load nahi ho paya.'));
        this.loading.set(false);
      }
    });
  }

  toggleForm(): void {
    if (this.showForm()) {
      this.resetForm();
      return;
    }
    this.form = this.defaultForm();
    this.serviceToAdd = '';
    this.showForm.set(true);
  }

  resetForm(): void {
    this.form = this.defaultForm();
    this.serviceToAdd = '';
    this.showForm.set(false);
    this.error.set('');
  }

  addServiceLine(serviceId: string): void {
    const service = this.serviceById(serviceId);
    this.serviceToAdd = '';
    if (!service) return;
    const existing = this.form.serviceRows.find((row) => row.serviceId === serviceId);
    if (existing) {
      existing.quantity = this.totalSessions() || existing.quantity || 1;
      this.syncPackageTotals();
      return;
    }
    this.form.serviceRows = [
      ...this.form.serviceRows,
      {
        serviceId,
        serviceName: this.serviceName(service),
        quantity: Math.max(1, this.totalSessions() || 1),
        unitPrice: this.servicePrice(service)
      }
    ];
    if (!this.form.name.trim()) this.form.name = `${this.serviceName(service)} ${this.form.paidSessions}+${this.form.freeSessions}`;
    this.syncPackageTotals();
  }

  changeServiceQty(index: number, delta: number): void {
    const row = this.form.serviceRows[index];
    if (!row) return;
    row.quantity = Math.max(1, Number(row.quantity || 1) + delta);
    this.syncPackageTotals();
  }

  removeServiceLine(index: number): void {
    this.form.serviceRows = this.form.serviceRows.filter((_, rowIndex) => rowIndex !== index);
    this.syncPackageTotals();
  }

  applyPackageFormula(paidSessions: number, freeSessions: number): void {
    this.form.paidSessions = paidSessions;
    this.form.freeSessions = freeSessions;
    this.applyFormulaToRows();
  }

  applyFormulaToRows(): void {
    const total = this.totalSessions();
    this.form.serviceRows = this.form.serviceRows.map((row) => ({ ...row, quantity: Math.max(1, total || row.quantity || 1) }));
    if (this.form.serviceRows.length === 1) {
      this.form.name = `${this.form.serviceRows[0].serviceName} ${this.form.paidSessions || 0}+${this.form.freeSessions || 0}`;
    }
    this.syncPackageTotals();
  }

  syncPackageTotals(): void {
    const paidSessions = Math.max(1, Number(this.form.paidSessions) || 1);
    const costPrice = this.form.serviceRows.reduce((sum, row) => sum + (Math.max(1, Number(row.quantity || 1)) * Math.max(0, Number(row.unitPrice || 0))), 0);
    const specialPrice = this.form.serviceRows.reduce((sum, row) => sum + (paidSessions * Math.max(0, Number(row.unitPrice || 0))), 0);
    this.form.costPrice = costPrice;
    this.form.price = specialPrice;
    this.form.description = this.form.serviceRows.length
      ? `Client pays ${paidSessions} session(s) and gets ${this.totalSessions()} credit(s) for ${this.form.serviceRows.map((row) => row.serviceName).join(', ')}.`
      : '';
  }

  savePackage(): void {
    if (!this.form.serviceRows.length) {
      this.error.set('Package banane ke liye service select karo.');
      return;
    }
    const paidSessions = Math.max(1, Number(this.form.paidSessions) || 1);
    const freeSessions = Math.max(0, Number(this.form.freeSessions) || 0);
    const totalSessions = paidSessions + freeSessions;
    const packageId = this.form.id || `pkg_${Date.now()}`;
    const serviceIds = this.form.serviceRows.map((row) => row.serviceId);
    const packageCredits = this.form.serviceRows.map((row) => ({
      packageId,
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      credits: Math.max(1, Number(row.quantity) || totalSessions),
      quantity: Math.max(1, Number(row.quantity) || totalSessions),
      remaining: Math.max(1, Number(row.quantity) || totalSessions),
      paidSessions,
      freeSessions,
      unitPrice: Math.max(0, Number(row.unitPrice) || 0),
      packagePrice: Math.max(0, Number(this.form.price) || 0)
    }));
    const payload: ApiRecord = {
      id: packageId,
      name: this.form.name.trim() || `${this.form.serviceRows[0].serviceName} ${paidSessions}+${freeSessions}`,
      description: this.form.description.trim() || `Pay ${paidSessions}, get ${totalSessions} credit(s).`,
      price: Math.max(0, Number(this.form.price) || 0),
      costPrice: Math.max(0, Number(this.form.costPrice) || 0),
      validityDays: this.normalizedValidityDays(),
      serviceIds,
      packageCredits,
      rules: {
        type: 'pay_x_get_y',
        serviceIds,
        serviceName: this.form.serviceRows.map((row) => row.serviceName).join(', '),
        paidSessions,
        freeSessions,
        totalSessions,
        validityUnit: this.form.validityUnit,
        showMobileApp: this.form.showMobileApp,
        showOnlineBooking: this.form.showOnlineBooking
      },
      status: this.form.status || 'active'
    };
    this.saving.set(true);
    this.error.set('');
    const request = this.form.id ? this.api.update<ApiRecord>('packages', packageId, payload) : this.api.create<ApiRecord>('packages', payload);
    request.subscribe({
      next: (created) => {
        this.message.set(`${this.packageName(created)} package save ho gaya. Ab POS me sell karke client ke naam active package banega.`);
        this.saving.set(false);
        this.showForm.set(false);
        this.form = this.defaultForm();
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Package save nahi ho paya.'));
        this.saving.set(false);
      }
    });
  }

  editPackage(item: ApiRecord): void {
    const credits = this.packageServiceCredits(item);
    const rules = this.objectValue(item.rules);
    const rows = credits.length ? credits.map((credit) => ({
      serviceId: String(credit.serviceId || ''),
      serviceName: String(credit.serviceName || this.serviceName(this.serviceById(String(credit.serviceId || ''))) || 'Package service'),
      quantity: this.moneyValue(credit.credits ?? credit.quantity ?? 1) || 1,
      unitPrice: this.moneyValue(credit.unitPrice ?? 0)
    })) : [];
    const paidSessions = this.moneyValue(rules.paidSessions ?? credits[0]?.paidSessions ?? 3) || 3;
    const freeSessions = this.moneyValue(rules.freeSessions ?? credits[0]?.freeSessions ?? 1);
    this.form = {
      id: this.recordId(item),
      name: this.packageName(item),
      description: String(item.description || ''),
      paidSessions,
      freeSessions,
      price: this.moneyValue(item.price || 0),
      costPrice: this.moneyValue(item.costPrice || item.cost_price || 0),
      validityDays: this.moneyValue(item.validityDays || 90),
      validityUnit: String(rules.validityUnit || 'Days') as PackageForm['validityUnit'],
      status: String(item.status || 'active'),
      showMobileApp: Boolean(rules.showMobileApp),
      showOnlineBooking: rules.showOnlineBooking !== false,
      serviceRows: rows
    };
    this.showForm.set(true);
  }

  selectPackage(item: ApiRecord): void {
    this.selectedPackageId.set(this.recordId(item));
  }

  selectedPackage(): ApiRecord | null {
    return this.packages().find((item) => this.recordId(item) === this.selectedPackageId()) || this.filteredPackages()[0] || null;
  }

  toggleActionMenu(item: ApiRecord, event: Event): void {
    event.stopPropagation();
    const id = this.recordId(item);
    this.openActionId.set(this.openActionId() === id ? '' : id);
  }

  viewPackage(item: ApiRecord): void {
    this.selectPackage(item);
    this.openActionId.set('');
    this.message.set(`${this.packageName(item)} selected. Is package ka client ledger POS sale ke baad live update hoga.`);
  }

  markPackageInactive(item: ApiRecord): void {
    const id = this.recordId(item);
    if (!id) return;
    this.openActionId.set('');
    this.api.update<ApiRecord>('packages', id, { status: 'inactive' }).subscribe({
      next: () => {
        this.message.set(`${this.packageName(item)} inactive ho gaya.`);
        this.load();
      },
      error: (error) => this.error.set(this.api.errorText(error, 'Package inactive nahi ho paya.'))
    });
  }

  archivePackage(item: ApiRecord): void {
    const id = this.recordId(item);
    if (!id) return;
    this.openActionId.set('');
    this.api.delete<ApiRecord>('packages', id).subscribe({
      next: () => {
        this.message.set(`${this.packageName(item)} delete ho gaya.`);
        this.load();
      },
      error: (error) => this.error.set(this.api.errorText(error, 'Package delete nahi ho paya.'))
    });
  }

  packageInitial(item: ApiRecord): string {
    return this.packageName(item).trim().charAt(0).toUpperCase() || 'P';
  }

  packageCostPrice(item: ApiRecord): number {
    const direct = this.moneyValue(item.costPrice ?? item.cost_price ?? 0);
    if (direct > 0) return direct;
    return this.packageServiceCredits(item).reduce((sum, credit) => {
      const qty = this.moneyValue(credit.credits ?? credit.quantity ?? 1) || 1;
      return sum + (qty * this.moneyValue(credit.unitPrice ?? 0));
    }, 0);
  }

  packageSellingPrice(item: ApiRecord): number {
    return this.moneyValue(item.price ?? item.sellingPrice ?? item.specialPrice ?? 0);
  }

  totalSessions(): number {
    return Math.max(0, Number(this.form.paidSessions) || 0) + Math.max(0, Number(this.form.freeSessions) || 0);
  }

  balancePreview(): string {
    const total = this.totalSessions();
    if (!total) return '0';
    return Array.from({ length: total }, (_, index) => `${total - index - 1}`).join(' / ');
  }

  selectedServicePrice(): number {
    return this.form.serviceRows[0]?.unitPrice || 0;
  }

  activePackageCount(): number {
    return this.packages().filter((item) => String(item.status || 'active').toLowerCase() === 'active').length;
  }

  packageSoldCount(): number {
    return this.packages().reduce((sum, item) => sum + this.packageMembers(item).length, 0);
  }

  activeClientCount(): number {
    const ids = new Set<string>();
    for (const item of this.packages()) {
      for (const membership of this.activeMembers(item)) ids.add(this.clientId(membership));
    }
    return ids.size;
  }

  redeemedCreditCount(): number {
    return this.memberships().reduce((sum, membership) => sum + (this.isPackageMembership(membership) ? this.membershipUsed(membership) : 0), 0);
  }

  activeMembers(pkg: ApiRecord): ApiRecord[] {
    return this.packageMembers(pkg).filter((membership) => this.membershipBalance(membership) > 0 && this.membershipStatus(membership) === 'Active');
  }

  packageMembers(pkg: ApiRecord): ApiRecord[] {
    return this.memberships()
      .filter((membership) => this.isPackageMembership(membership) && this.packageMatchesMembership(pkg, membership))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  packageRedeemedCredits(pkg: ApiRecord): number {
    return this.packageMembers(pkg).reduce((sum, membership) => sum + this.membershipUsed(membership), 0);
  }

  packageMatchesMembership(pkg: ApiRecord, membership: ApiRecord): boolean {
    const packageId = this.recordId(pkg);
    const packageName = this.packageName(pkg).toLowerCase();
    const memberName = String(membership.planName || membership.name || '').replace(/^Package:\s*/i, '').trim().toLowerCase();
    if (memberName && memberName === packageName) return true;
    if (String(membership.packageId || membership.package_id || '') === packageId) return true;
    if (this.readList(membership.redeemHistory || membership.redemptionHistory).some((entry) => String(entry.packageId || '') === packageId)) return true;
    return this.packageServiceCredits(membership).some((credit) => String(credit.packageId || '') === packageId);
  }

  packageRuleText(pkg: ApiRecord): string {
    const rules = this.objectValue(pkg.rules);
    const paid = this.moneyValue(rules.paidSessions ?? this.firstPackageCredit(pkg).paidSessions);
    const free = this.moneyValue(rules.freeSessions ?? this.firstPackageCredit(pkg).freeSessions);
    const total = this.packageTotalCredits(pkg);
    const serviceNames = this.packageServiceCredits(pkg).map((credit) => String(credit.serviceName || this.serviceName(this.serviceById(String(credit.serviceId || ''))) || '')).filter(Boolean);
    const serviceName = String(rules.serviceName || serviceNames.join(', ') || this.firstPackageCredit(pkg).serviceName || this.serviceName(this.serviceById(this.packageServiceIds(pkg)[0])) || 'service');
    if (paid || free) return `${serviceName}: pay ${paid}, get ${paid + free || total}`;
    return `${serviceName}: ${total || 0} credit(s)`;
  }

  packageTotalCredits(pkg: ApiRecord): number {
    const credits = this.packageServiceCredits(pkg);
    if (credits.length) return credits.reduce((sum, credit) => sum + this.moneyValue(credit.credits ?? credit.quantity ?? credit.total ?? 0), 0);
    const rules = this.objectValue(pkg.rules);
    return this.moneyValue(rules.totalSessions || rules.credits || 0);
  }

  membershipTotal(membership: ApiRecord): number {
    const direct = this.moneyValue(membership.planCredits || membership.totalCredits || membership.credits || 0);
    if (direct > 0) return direct;
    return this.packageServiceCredits(membership).reduce((sum, credit) => sum + this.moneyValue(credit.credits ?? credit.quantity ?? 0), 0);
  }

  membershipBalance(membership: ApiRecord): number {
    const direct = this.moneyValue(membership.creditsRemaining || membership.remainingCredits || membership.balanceCredits || 0);
    if (direct > 0) return direct;
    const total = this.membershipTotal(membership);
    return Math.max(0, total - this.membershipUsed(membership));
  }

  membershipUsed(membership: ApiRecord): number {
    const total = this.membershipTotal(membership);
    const balance = this.moneyValue(membership.creditsRemaining || membership.remainingCredits || 0);
    if (total > 0 && balance >= 0) return Math.max(0, total - balance);
    return this.redemptionEntries(membership).reduce((sum, entry) => sum + this.redemptionCreditCount(entry), 0);
  }

  membershipStatus(membership: ApiRecord): string {
    const status = String(membership.status || '').toLowerCase();
    const expiry = Date.parse(String(membership.validityDate || membership.expiryDate || ''));
    if (status === 'inactive' || status === 'expired') return 'Expired';
    if (Number.isFinite(expiry) && expiry < Date.now()) return 'Expired';
    if (this.membershipBalance(membership) <= 0 && this.membershipTotal(membership) > 0) return 'Fully used';
    return 'Active';
  }

  redemptionLines(membership: ApiRecord): RedemptionLine[] {
    const total = this.membershipTotal(membership);
    let used = 0;
    const lines: RedemptionLine[] = [];
    for (const entry of this.redemptionEntries(membership)) {
      const count = Math.max(1, Math.min(50, this.redemptionCreditCount(entry)));
      for (let index = 0; index < count; index += 1) {
        used += 1;
        lines.push({
          step: used,
          date: this.dateLabel(entry.date || entry.usedAt || entry.createdAt),
          service: this.redemptionServiceName(entry),
          staff: String(entry.staffName || entry.staff_name || entry.staffId || 'Staff not assigned'),
          balance: Math.max(0, total - used),
          invoice: String(entry.saleId || entry.invoiceId || entry.invoiceNumber || 'POS')
        });
      }
    }
    return lines;
  }

  redemptionEntries(membership: ApiRecord): ApiRecord[] {
    return this.readList(membership.redeemHistory || membership.redemptionHistory || membership.redemptions)
      .filter((entry) => {
        const type = String(entry.type || entry.status || '').toLowerCase();
        return !type.includes('package_sale') && !type.includes('membership_sale') && (type.includes('redeem') || entry.serviceId || entry.serviceName || entry.creditsUsed || entry.credits);
      })
      .sort((a, b) => String(a.date || a.usedAt || a.createdAt || '').localeCompare(String(b.date || b.usedAt || b.createdAt || '')));
  }

  redemptionServiceName(entry: ApiRecord): string {
    return String(entry.serviceName || entry.name || this.serviceName(this.serviceById(String(entry.serviceId || ''))) || 'Package service');
  }

  redemptionCreditCount(entry: ApiRecord): number {
    return Math.max(1, this.moneyValue(entry.creditsUsed ?? entry.usedCredits ?? entry.credits ?? entry.quantity ?? 1));
  }

  isPackageMembership(membership: ApiRecord): boolean {
    const planName = String(membership.planName || membership.name || '').trim().toLowerCase();
    if (planName.startsWith('package:')) return true;
    if (this.packageServiceCredits(membership).some((credit) => credit.packageId || credit.serviceId)) return true;
    return this.readList(membership.redeemHistory || membership.redemptionHistory).some((entry) => String(entry.type || '').includes('package') || entry.packageId);
  }

  packageServiceIds(pkg: ApiRecord): string[] {
    return [
      ...this.readArray(pkg.serviceIds || pkg.service_ids).map((item) => String(typeof item === 'object' && item ? (item as ApiRecord).id || (item as ApiRecord).serviceId : item)).filter(Boolean),
      ...this.packageServiceCredits(pkg).map((credit) => String(credit.serviceId || '')).filter(Boolean)
    ];
  }

  packageServiceCredits(item: ApiRecord): ApiRecord[] {
    return [
      ...this.readList(item.serviceCredits || item.service_credits),
      ...this.readList(item.packageCredits || item.package_credits)
    ];
  }

  firstPackageCredit(pkg: ApiRecord): ApiRecord {
    return this.packageServiceCredits(pkg)[0] || {};
  }

  clientId(membership: ApiRecord): string {
    return String(membership.clientId || membership.customerId || membership.client_id || '');
  }

  clientName(membership: ApiRecord): string {
    const client = this.clientById(this.clientId(membership));
    return String(client?.name || membership.clientName || membership.customerName || 'Client');
  }

  clientPhone(membership: ApiRecord): string {
    const client = this.clientById(this.clientId(membership));
    return String(client?.phone || client?.mobile || membership.phone || membership.mobile || '-');
  }

  clientById(id: string): ApiRecord | undefined {
    return this.clients().find((client) => this.recordId(client) === id);
  }

  serviceById(id: string): ApiRecord | undefined {
    return this.services().find((service) => this.recordId(service) === id);
  }

  serviceName(service: ApiRecord | undefined): string {
    return String(service?.name || service?.serviceName || service?.title || '');
  }

  servicePrice(service: ApiRecord | undefined): number {
    return this.moneyValue(service?.price ?? service?.salePrice ?? service?.basePrice ?? service?.amount ?? 0);
  }

  packageName(item: ApiRecord): string {
    return String(item.name || item.packageName || 'Package');
  }

  recordId(item: ApiRecord | undefined): string {
    return String(item?.id || item?.packageId || item?.serviceId || '');
  }

  moneyValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  dateLabel(value: unknown): string {
    if (!value) return '-';
    const date = new Date(String(value));
    if (!Number.isFinite(date.getTime())) return String(value);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  readList(value: unknown): ApiRecord[] {
    return this.readArray(value).map((item) => this.recordValue(item));
  }

  readArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  recordValue(value: unknown): ApiRecord {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as ApiRecord;
    return {};
  }

  objectValue(value: unknown): ApiRecord {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as ApiRecord;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ApiRecord : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  private normalizedValidityDays(): number {
    const value = Math.max(1, Number(this.form.validityDays) || 1);
    if (this.form.validityUnit === 'Year') return value * 365;
    if (this.form.validityUnit === 'Month') return value * 30;
    return value;
  }

  private defaultForm(): PackageForm {
    return {
      id: '',
      name: '',
      description: '',
      paidSessions: 3,
      freeSessions: 1,
      price: 0,
      costPrice: 0,
      validityDays: 90,
      validityUnit: 'Days',
      status: 'active',
      showMobileApp: false,
      showOnlineBooking: true,
      serviceRows: []
    };
  }
}
