import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-laundry-report',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, RouterLink],
  template: `
    <section class="laundry-report-page inner-page-shell">
      <header class="titlebar inner-page-header">
        <div>
          <span class="eyebrow">Inventory Report</span>
          <h2>Laundry Entries Report</h2>
        </div>
        <div class="title-actions inner-action-bar">
          <button class="ghost-button" type="button" routerLink="/inventory/laundry-entry">New Entry</button>
          <button class="ghost-button" type="button" routerLink="/inventory">Exit</button>
        </div>
      </header>

      <section class="summary-row inner-stats-grid">
        <article>
          <span>Total entries</span>
          <strong>{{ entries().length }}</strong>
        </article>
        <article>
          <span>Regular In</span>
          <strong>{{ total('regularTotalIn') }}</strong>
        </article>
        <article>
          <span>Regular Out</span>
          <strong>{{ total('regularTotalOut') }}</strong>
        </article>
        <article>
          <span>Rewash In</span>
          <strong>{{ total('rewashTotalIn') }}</strong>
        </article>
        <article>
          <span>Total Amount</span>
          <strong>{{ total('totalAmount') | auraMoney:'1.0-0' }}</strong>
        </article>
      </section>

      <section class="report-panel inner-page-card">
        <div class="report-toolbar inner-action-bar">
          <label>
            <span>Search</span>
            <input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Doc no, account, product" />
          </label>
          <button class="ghost-button" type="button" (click)="printPage()">Print</button>
        </div>

        <div class="table-shell inner-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Doc No.</th>
                <th>Date</th>
                <th>Laundry A/c</th>
                <th>Regular In</th>
                <th>Regular Out</th>
                <th>Rewash In</th>
                <th>Rewash Out</th>
                <th>Amount</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let entry of filteredEntries()" [class.active]="selectedId() === entry.id">
                <td>{{ entry.docNo }}</td>
                <td>{{ entry.docDate | auraDate:'date' }}</td>
                <td>{{ entry.laundryAccountName }}</td>
                <td>{{ entry.regularTotalIn || 0 }}</td>
                <td>{{ entry.regularTotalOut || 0 }}</td>
                <td>{{ entry.rewashTotalIn || 0 }}</td>
                <td>{{ entry.rewashTotalOut || 0 }}</td>
                <td>{{ entry.totalAmount | auraMoney:'1.0-0' }}</td>
                <td>
                  <button type="button" routerLink="/inventory/laundry-entry" (click)="queueEdit(entry.id)">Edit</button>
                </td>
              </tr>
              <tr *ngIf="!filteredEntries().length">
                <td colspan="9" class="empty">Laundry saved entries nahi mile.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="detail-panel inner-page-card" *ngIf="selectedEntry() as entry">
        <h3>{{ entry.docNo }} - {{ entry.laundryAccountName }}</h3>
        <p>{{ entry.docDate | auraDate:'date' }} <span *ngIf="entry.remarks">- {{ entry.remarks }}</span></p>
        <div class="table-shell inner-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sr.No.</th>
                <th>Product</th>
                <th>Regular In</th>
                <th>Regular Out</th>
                <th>Rate</th>
                <th>Amount</th>
                <th>Rewash In</th>
                <th>Rewash Out</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let line of entry.lines || []; let index = index">
                <td>{{ index + 1 | number: '3.0-0' }}</td>
                <td>{{ line.productName }}</td>
                <td>{{ line.regularInQty || 0 }}</td>
                <td>{{ line.regularOutQty || 0 }}</td>
                <td>{{ line.rate || 0 }}</td>
                <td>{{ line.amount | auraMoney:'1.0-0' }}</td>
                <td>{{ line.rewashInQty || 0 }}</td>
                <td>{{ line.rewashOutQty || 0 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .laundry-report-page { display: grid; gap: 14px; padding: 18px; background: #eef8f5; color: #0f172a; }
    .titlebar, .report-panel, .detail-panel, .summary-row article { border: 1px solid #9eb2b7; background: #d8ebe7; box-shadow: inset 0 0 0 1px rgba(255,255,255,.6); }
    .titlebar { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #5b9998; color: #fff; }
    .titlebar h2 { margin: 0; letter-spacing: 0; }
    .title-actions { display: flex; gap: 8px; }
    .eyebrow { display: block; color: inherit; opacity: .78; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .ghost-button { border: 1px solid #8da1a7; background: #fff; color: #0f172a; border-radius: 2px; padding: 8px 13px; font-weight: 900; cursor: pointer; }
    .summary-row { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
    .summary-row article { padding: 12px; background: #fff; }
    .summary-row span { display: block; color: #526477; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .summary-row strong { display: block; margin-top: 5px; font-size: 22px; }
    .report-panel, .detail-panel { display: grid; gap: 10px; padding: 12px; }
    .report-toolbar { display: flex; justify-content: space-between; gap: 10px; align-items: end; }
    label { display: grid; gap: 4px; font-weight: 900; }
    input { min-height: 34px; border: 1px solid #8da1a7; background: #fff; padding: 6px 8px; font: inherit; min-width: 280px; }
    .table-shell { overflow: auto; background: #fff; border: 1px solid #9eb2b7; }
    table { width: 100%; min-width: 920px; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #c7d6d8; padding: 8px; text-align: left; }
    th { background: #edf3f2; font-weight: 950; }
    td button { border: 1px solid #8da1a7; background: #fff; font-weight: 900; cursor: pointer; }
    tr.active td { background: #ecfdf5; }
    .empty { padding: 24px; color: #64748b; text-align: center; }
    .detail-panel h3, .detail-panel p { margin: 0; }
    @media (max-width: 900px) {
      .summary-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .titlebar, .report-toolbar { align-items: stretch; flex-direction: column; }
      input { min-width: 0; }
    }
    @media print {
      .title-actions, .report-toolbar, td button { display: none !important; }
      .laundry-report-page { padding: 0; background: #fff; }
    }
  `]
})
export class LaundryReportComponent implements OnInit {
  readonly entries = signal<ApiRecord[]>([]);
  readonly query = signal('');
  readonly selectedId = signal('');

  readonly filteredEntries = computed(() => {
    const search = this.query().trim().toLowerCase();
    if (!search) return this.entries();
    return this.entries().filter((entry) => {
      const text = `${entry.docNo || ''} ${entry.laundryAccountName || ''} ${(entry.lines || []).map((line: ApiRecord) => line.productName).join(' ')}`.toLowerCase();
      return text.includes(search);
    });
  });

  readonly selectedEntry = computed(() => this.entries().find((entry) => entry.id === this.selectedId()) || this.entries()[0] || null);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    const entries = this.localEntries();
    this.entries.set(entries);
    this.selectedId.set(String(entries[0]?.id || ''));
  }

  total(key: string): number {
    return Math.round(this.filteredEntries().reduce((sum, entry) => sum + Number(entry[key] || 0), 0) * 100) / 100;
  }

  printPage(): void {
    window.print();
  }

  queueEdit(entryId: unknown): void {
    localStorage.setItem(this.editKey(), String(entryId || ''));
  }

  private localEntries(): ApiRecord[] {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey()) || '[]');
    } catch {
      return [];
    }
  }

  private storageKey(): string {
    return `aura_laundry_entries_${this.api.selectedBranchId() || 'all'}`;
  }

  private editKey(): string {
    return `aura_laundry_edit_${this.api.selectedBranchId() || 'all'}`;
  }
}
