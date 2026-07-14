import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type ColumnDef = {
  key: string;
  label: string;
  group: string;
  visible: boolean;
  type?: 'currency' | 'date' | 'number';
};

@Component({
  selector: 'app-inward-revenue-report',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, StateComponent],
  template: `
    <section class="page-stack inward-revenue-page inner-page-shell">
      <div class="module-hero inner-page-header">
        <div>
          <h2>Inward Revenue Report</h2>
        </div>
        <div class="hero-actions inner-action-bar">
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
          <button class="primary-button" type="button" (click)="saveImport()" [disabled]="!selectedFileBase64 || importing()">
            {{ importing() ? 'Saving import...' : 'Save import' }}
          </button>
        </div>
      </div>

      <section class="panel import-panel">
        <div class="import-copy">
          <h3>FlexiSalonERP Inward Revenues</h3>
        </div>
        <label class="file-drop">
          <input type="file" accept=".xlsx,.xls" (change)="onFileSelected($event)" />
          <strong>{{ selectedFileName || 'Choose Excel file' }}</strong>
          <span>Adv. formatted or raw FlexiSalon export</span>
        </label>
        <button class="ghost-button" type="button" (click)="previewImport()" [disabled]="!selectedFileBase64 || previewing()">
          {{ previewing() ? 'Reading...' : 'Preview import' }}
        </button>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="panel preview-panel" *ngIf="preview() as previewData">
        <div class="section-title inner-action-bar">
          <div>
            <h3>{{ previewData.title || selectedFileName }}</h3>
          </div>
          <span class="badge">{{ previewData.invoiceCount || 0 }} invoices</span>
        </div>
        <div class="warning-list" *ngIf="previewData.warnings?.length">
          <strong *ngFor="let warning of previewData.warnings">{{ warning }}</strong>
        </div>
        <div class="metrics-grid compact-metrics inner-stats-grid">
          <article class="metric-card"><span>Lines</span><strong>{{ previewData.lineCount || 0 }}</strong><small>{{ previewData.rowCount || 0 }} source rows</small></article>
          <article class="metric-card"><span>Total</span><strong>{{ previewData.summary?.totalAmount || 0 | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Received</span><strong>{{ previewData.summary?.receivedAmount || 0 | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card"><span>Unpaid</span><strong>{{ previewData.summary?.unpaidAmount || 0 | auraMoney:'1.0-0' }}</strong></article>
        </div>
        <div class="table-wrap compact-table inner-table-wrap">
          <table>
            <thead><tr><th>Invoice</th><th>Date</th><th>Client</th><th>Service/Product</th><th>Operator</th><th class="right">Line amt</th><th class="right">Invoice total</th></tr></thead>
            <tbody>
              <tr *ngFor="let row of previewData.sampleRows || []">
                <td>{{ row.invoiceNo }}</td>
                <td>{{ row.docDate | auraDate:'date' }}</td>
                <td>{{ row.clientName }}</td>
                <td>{{ row.serviceProduct }}</td>
                <td>{{ row.operator || 'Unassigned' }}</td>
                <td class="right">{{ row.itemAmount | auraMoney:'1.0-0' }}</td>
                <td class="right">{{ row.invoiceTotal | auraMoney:'1.0-0' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel filters-panel">
        <label class="field">
          <span>Import batch</span>
          <select [(ngModel)]="filters.importId" (change)="load()">
            <option value="">All imports</option>
            <option *ngFor="let item of imports()" [value]="item.id">{{ item.fileName || item.id }} · {{ item.invoiceCount }} invoices</option>
          </select>
        </label>
        <label class="field">
          <span>From</span>
          <input type="date" [(ngModel)]="filters.from" />
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" [(ngModel)]="filters.to" />
        </label>
        <label class="field">
          <span>Doc type</span>
          <select [(ngModel)]="filters.docType">
            <option value="">All</option>
            <option *ngFor="let item of docTypes()" [value]="item.key">{{ item.key }}</option>
          </select>
        </label>
        <label class="field">
          <span>Payment mode</span>
          <select [(ngModel)]="filters.paymentMode">
            <option value="">All</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="online">Online/eWallet</option>
            <option value="cheque">Cheque</option>
          </select>
        </label>
        <label class="field">
          <span>Operator</span>
          <input [(ngModel)]="filters.operator" placeholder="AFTAB, YUNUS, ANU" />
        </label>
        <label class="field">
          <span>Service/Product</span>
          <input [(ngModel)]="filters.service" placeholder="Hair Cut, Pedicure" />
        </label>
        <label class="field search-wide">
          <span>Search</span>
          <input [(ngModel)]="filters.search" placeholder="Invoice, client, mobile" />
        </label>
        <label class="check-line">
          <input type="checkbox" [(ngModel)]="filters.unpaidOnly" />
          <span>Unpaid only</span>
        </label>
        <button class="primary-button" type="button" (click)="load()">Run report</button>
      </section>

      <ng-container *ngIf="report() as reportData">
        <div class="metrics-grid">
          <article class="metric-card teal"><span>Invoices</span><strong>{{ reportData.summary?.invoiceCount || 0 }}</strong></article>
          <article class="metric-card"><span>Total business</span><strong>{{ reportData.summary?.totalAmount || 0 | auraMoney:'1.0-0' }}</strong><small>No duplicate line totals</small></article>
          <article class="metric-card green"><span>Received</span><strong>{{ reportData.summary?.receivedAmount || 0 | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card red"><span>Unpaid</span><strong>{{ reportData.summary?.unpaidAmount || 0 | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card amber"><span>Balance paid</span><strong>{{ reportData.summary?.balancePaidAmount || 0 | auraMoney:'1.0-0' }}</strong></article>
          <article class="metric-card blue"><span>GST</span><strong>{{ reportData.summary?.totalGstAmount || 0 | auraMoney:'1.0-0' }}</strong></article>
        </div>

        <div class="dashboard-grid">
          <section class="panel">
            <div class="section-title inner-action-bar">
              <div>
                <h3>Cash, card, online and cheque</h3>
              </div>
            </div>
            <div class="summary-lines">
              <div><span>Cash</span><strong>{{ reportData.summary?.cashAmount || 0 | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Card</span><strong>{{ reportData.summary?.cardAmount || 0 | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Online/eWallet</span><strong>{{ reportData.summary?.onlineAmount || 0 | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Cheque</span><strong>{{ reportData.summary?.chequeAmount || 0 | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Tips</span><strong>{{ reportData.summary?.tipAmount || 0 | auraMoney:'1.0-0' }}</strong></div>
            </div>
          </section>

          <section class="panel column-panel">
            <div class="section-title inner-action-bar">
              <div>
                <h3>FlexiSalon-style chooser</h3>
              </div>
              <button class="ghost-button mini" type="button" (click)="resetColumns()">Reset</button>
            </div>
            <div class="column-chooser">
              <label *ngFor="let column of columns">
                <input type="checkbox" [(ngModel)]="column.visible" />
                <span>{{ column.label }}</span>
                <small>{{ column.group }}</small>
              </label>
            </div>
          </section>
        </div>

        <div class="dashboard-grid">
          <section class="panel">
            <div class="section-title inner-action-bar"><h3>Top operators</h3></div>
            <div class="rank-list">
              <article *ngFor="let item of reportData.topOperators || []">
                <strong>{{ item.key }}</strong>
                <span>{{ item.count }} lines</span>
                <b>{{ item.amount | auraMoney:'1.0-0' }}</b>
              </article>
            </div>
          </section>
          <section class="panel">
            <div class="section-title inner-action-bar"><h3>Top services/products</h3></div>
            <div class="rank-list">
              <article *ngFor="let item of reportData.topServices || []">
                <strong>{{ item.key }}</strong>
                <span>{{ item.count }} lines</span>
                <b>{{ item.amount | auraMoney:'1.0-0' }}</b>
              </article>
            </div>
          </section>
        </div>

        <section class="panel">
          <div class="section-title inner-action-bar">
            <div>
              <h3>Line-item revenue with invoice drill-down</h3>
            </div>
            <small>{{ reportData.rows?.length || 0 }} visible rows</small>
          </div>
          <div class="table-wrap revenue-table-wrap">
            <table>
              <thead>
                <tr>
                  <th *ngFor="let column of visibleColumns()" [class.right]="isNumeric(column)">{{ column.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of reportData.rows || []">
                  <td *ngFor="let column of visibleColumns()" [class.right]="isNumeric(column)">
                    <button *ngIf="column.key === 'invoiceNo'; else normalCell" class="table-link" type="button" (click)="openInvoice(row)">
                      {{ row.invoiceNo }}
                    </button>
                    <ng-template #normalCell>
                      <ng-container [ngSwitch]="column.type">
                        <span *ngSwitchCase="'currency'">{{ moneyCell(row, column.key) | auraMoney:'1.0-0' }}</span>
                        <span *ngSwitchCase="'date'">{{ dateCell(row, column.key) | auraDate:'date' }}</span>
                        <span *ngSwitchCase="'number'">{{ value(row, column.key) || 0 }}</span>
                        <span *ngSwitchDefault>{{ value(row, column.key) || '-' }}</span>
                      </ng-container>
                    </ng-template>
                  </td>
                </tr>
                <tr *ngIf="!(reportData.rows || []).length">
                  <td [attr.colspan]="visibleColumns().length">No imported inward revenue rows found for selected filters.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </ng-container>

      <div class="floating-detail-backdrop" *ngIf="selectedInvoice() as detail" (click)="closeInvoice()">
        <section class="panel floating-detail-card" (click)="$event.stopPropagation()">
          <div class="section-title inner-action-bar">
            <div>
              <h3>{{ detail.invoice.invoiceNo }}</h3>
              <small>{{ detail.invoice.clientName }} · {{ detail.invoice.docDate | auraDate:'date' }}</small>
            </div>
            <button class="ghost-button mini" type="button" (click)="closeInvoice()">Close</button>
          </div>
          <div class="info-grid compact-info">
            <div><span>Total</span><strong>{{ detail.invoice.totalAmount | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Received</span><strong>{{ detail.invoice.receivedAmount | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Unpaid</span><strong>{{ detail.invoice.unpaidAmount | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Balance paid</span><strong>{{ detail.invoice.balancePaidAmount | auraMoney:'1.0-0' }}</strong></div>
          </div>
          <div class="detail-list">
            <article *ngFor="let line of detail.lines">
              <div>
                <strong>{{ line.serviceProduct }}</strong>
                <span>{{ line.operator || 'Unassigned' }} · Qty {{ line.quantity || 1 }}</span>
              </div>
              <strong>{{ line.itemAmount | auraMoney:'1.0-0' }}</strong>
            </article>
          </div>
        </section>
      </div>
    </section>
  `,
  styles: [`
    .inward-revenue-page { display: grid; gap: 1rem; }
    .hero-actions, .import-panel, .filters-panel { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
    .hero-actions { justify-content: flex-end; }
    .import-panel { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(260px, 0.7fr) auto; align-items: center; }
    .import-copy h3, .section-title h3 { margin: 0.2rem 0 0; }
    .import-copy p { margin: 0.35rem 0 0; color: var(--muted); }
    .file-drop { min-height: 92px; display: grid; gap: 0.25rem; align-content: center; padding: 1rem; border: 1px dashed var(--teal); border-radius: 8px; background: #F7EEF4; cursor: pointer; }
    .file-drop input { display: none; }
    .file-drop span { color: var(--muted); font-size: 0.86rem; }
    .filters-panel { display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)); align-items: end; }
    .search-wide { grid-column: span 2; }
    .check-line { display: flex; align-items: center; gap: 0.5rem; min-height: 42px; font-weight: 900; }
    .compact-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .warning-list { display: grid; gap: 0.4rem; margin-bottom: 1rem; }
    .warning-list strong { padding: 0.65rem 0.8rem; border: 1px solid rgba(183, 121, 31, 0.24); border-radius: 8px; color: #8a4f00; background: #fff8e6; }
    .column-panel { align-self: start; }
    .column-chooser { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; max-height: 300px; overflow: auto; padding-right: 0.25rem; }
    .column-chooser label { display: grid; grid-template-columns: auto 1fr auto; gap: 0.45rem; align-items: center; padding: 0.5rem; border: 1px solid var(--line); border-radius: 8px; }
    .column-chooser small { color: var(--muted); font-size: 0.74rem; }
    .rank-list { display: grid; gap: 0.55rem; }
    .rank-list article { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 0.7rem; align-items: center; padding: 0.7rem; border: 1px solid var(--line); border-radius: 8px; background: #F7EEF4; }
    .rank-list span { color: var(--muted); }
    .revenue-table-wrap { max-height: 620px; overflow: auto; }
    th.right, td.right { text-align: right; }
    .table-link { border: 0; padding: 0; color: var(--teal); background: transparent; font-weight: 900; text-align: left; }
    .floating-detail-backdrop { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 1rem; background: rgba(15, 23, 42, 0.42); }
    .floating-detail-card { width: min(880px, 96vw); max-height: 88vh; overflow: auto; }
    .compact-info { margin-bottom: 1rem; }
    .detail-list { display: grid; gap: 0.65rem; }
    .detail-list article { display: flex; justify-content: space-between; gap: 1rem; padding: 0.8rem; border: 1px solid var(--line); border-radius: 8px; background: #F7EEF4; }
    .detail-list span { display: block; color: var(--muted); }
    @media (max-width: 980px) {
      .import-panel, .filters-panel, .compact-metrics { grid-template-columns: 1fr; }
      .search-wide { grid-column: auto; }
      .column-chooser { grid-template-columns: 1fr; }
    }
  `]
})
export class InwardRevenueReportComponent implements OnInit {
  readonly loading = signal(false);
  readonly previewing = signal(false);
  readonly importing = signal(false);
  readonly error = signal('');
  readonly preview = signal<ApiRecord | null>(null);
  readonly report = signal<ApiRecord | null>(null);
  readonly imports = signal<ApiRecord[]>([]);
  readonly selectedInvoice = signal<ApiRecord | null>(null);
  readonly docTypes = computed(() => (this.report()?.['docTypes'] as ApiRecord[] | undefined) || []);

  selectedFileName = '';
  selectedFileBase64 = '';
  filters = {
    importId: '',
    from: '',
    to: '',
    docType: '',
    paymentMode: '',
    operator: '',
    service: '',
    search: '',
    unpaidOnly: false
  };

  columns: ColumnDef[] = [
    { key: 'invoiceNo', label: 'Invoice', group: 'Document', visible: true },
    { key: 'docDate', label: 'Date', group: 'Document', visible: true, type: 'date' },
    { key: 'docType', label: 'Doc Type', group: 'Document', visible: true },
    { key: 'clientName', label: 'Client', group: 'Client', visible: true },
    { key: 'mobileNo', label: 'Mobile', group: 'Client', visible: true },
    { key: 'serviceProduct', label: 'Service/Product', group: 'Service/Product', visible: true },
    { key: 'operator', label: 'Operator', group: 'Service/Product', visible: true },
    { key: 'assistantOperator', label: 'Ass. Operator', group: 'Service/Product', visible: false },
    { key: 'quantity', label: 'Qty', group: 'Service/Product', visible: true, type: 'number' },
    { key: 'itemAmount', label: 'Line Amt', group: 'Invoice', visible: true, type: 'currency' },
    { key: 'invoiceAmount', label: 'Invoice Amount', group: 'Invoice', visible: false, type: 'currency' },
    { key: 'discountAmount', label: 'Disc. Amt', group: 'Deduction', visible: true, type: 'currency' },
    { key: 'taxableAmount', label: 'Taxable', group: 'GST', visible: true, type: 'currency' },
    { key: 'totalGstAmount', label: 'GST', group: 'GST', visible: true, type: 'currency' },
    { key: 'totalAmount', label: 'Total', group: 'Invoice', visible: true, type: 'currency' },
    { key: 'receivedAmount', label: 'Received', group: 'Payment', visible: true, type: 'currency' },
    { key: 'unpaidAmount', label: 'Unpaid', group: 'Payment', visible: true, type: 'currency' },
    { key: 'balancePaidAmount', label: 'Bal. Paid', group: 'Payment', visible: true, type: 'currency' }
  ];

  private readonly defaultVisibility = this.columns.map((column) => column.visible);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord>('reports/inward-revenue', this.reportParams()).subscribe({
      next: (report) => {
        this.report.set(report);
        this.imports.set((report['imports'] as ApiRecord[] | undefined) || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load inward revenue report'));
        this.loading.set(false);
      }
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.selectedFileName = file.name;
    this.preview.set(null);
    this.error.set('');
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      this.selectedFileBase64 = result.includes(',') ? result.split(',').pop() || '' : result;
    };
    reader.onerror = () => this.error.set('Unable to read selected Excel file');
    reader.readAsDataURL(file);
  }

  previewImport(): void {
    if (!this.selectedFileBase64) return;
    this.previewing.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('reports/inward-revenue/preview', this.filePayload()).subscribe({
      next: (preview) => {
        this.preview.set(preview);
        this.previewing.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to preview import'));
        this.previewing.set(false);
      }
    });
  }

  saveImport(): void {
    if (!this.selectedFileBase64) return;
    this.importing.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('reports/inward-revenue/import', this.filePayload()).subscribe({
      next: (response) => {
        const importId = String(response?.['import']?.id || '');
        if (importId) this.filters.importId = importId;
        this.importing.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save import'));
        this.importing.set(false);
      }
    });
  }

  openInvoice(row: ApiRecord): void {
    const invoiceId = String(row['invoiceId'] || '').trim();
    if (!invoiceId) return;
    this.api.get<ApiRecord>('reports/inward-revenue/invoice', invoiceId).subscribe({
      next: (detail) => this.selectedInvoice.set(detail),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to open legacy invoice'))
    });
  }

  closeInvoice(): void {
    this.selectedInvoice.set(null);
  }

  visibleColumns(): ColumnDef[] {
    return this.columns.filter((column) => column.visible);
  }

  resetColumns(): void {
    this.columns.forEach((column, index) => column.visible = this.defaultVisibility[index]);
  }

  isNumeric(column: ColumnDef): boolean {
    return column.type === 'currency' || column.type === 'number';
  }

  value(row: ApiRecord, key: string): string | number | Date | null | undefined {
    return row[key];
  }

  moneyCell(row: ApiRecord, key: string): number {
    const value = Number(String(row[key] ?? 0).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(value) ? value : 0;
  }

  dateCell(row: ApiRecord, key: string): string | number | Date | null {
    const value = row[key];
    return value === undefined ? null : value;
  }

  private reportParams(): ApiRecord {
    return {
      importId: this.filters.importId,
      from: this.filters.from,
      to: this.filters.to,
      docType: this.filters.docType,
      paymentMode: this.filters.paymentMode,
      operator: this.filters.operator,
      service: this.filters.service,
      search: this.filters.search,
      unpaidOnly: this.filters.unpaidOnly ? 'true' : ''
    };
  }

  private filePayload(): ApiRecord {
    return {
      fileName: this.selectedFileName,
      base64: this.selectedFileBase64
    };
  }
}
