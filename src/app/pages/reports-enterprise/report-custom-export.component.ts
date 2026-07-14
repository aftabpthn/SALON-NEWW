import { CommonModule } from '@angular/common';
import { Component, Input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReportsEnterpriseService, FilterState } from './reports-enterprise.service';

@Component({
  selector: 'app-report-custom-export',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="export-builder inner-page-shell">
      <section class="panel report-section inner-page-card">
        <div class="section-title inner-action-bar"><h3>Custom Export Builder</h3></div>
        <div class="export-form">
          <div class="form-row">
            <label class="field">
              <span>Date Range</span>
              <div class="date-range-inputs">
                <input type="date" [(ngModel)]="form.from" />
                <span>to</span>
                <input type="date" [(ngModel)]="form.to" />
              </div>
            </label>
            <label class="field">
              <span>Branch</span>
              <select [(ngModel)]="form.branchId">
                <option value="">All Branches</option>
                <option value="main">Main Branch</option>
                <option value="downtown">Downtown Studio</option>
                <option value="mall">Mall Express</option>
                <option value="luxury">Luxury Lounge</option>
              </select>
            </label>
          </div>
          <div class="form-row">
            <label class="field">
              <span>Staff</span>
              <select [(ngModel)]="form.staffId">
                <option value="">All Staff</option>
                <option *ngFor="let s of staffList" [value]="s">{{ s }}</option>
              </select>
            </label>
            <label class="field">
              <span>Service Category</span>
              <select [(ngModel)]="form.category">
                <option value="">All Categories</option>
                <option *ngFor="let c of categories" [value]="c">{{ c }}</option>
              </select>
            </label>
          </div>
          <div class="form-row">
            <label class="field">
              <span>Client Segment</span>
              <select [(ngModel)]="form.segment">
                <option value="">All Clients</option>
                <option value="vip">VIP</option>
                <option value="loyal">Loyal</option>
                <option value="new">New</option>
                <option value="at-risk">At-Risk</option>
                <option value="lost">Lost</option>
              </select>
            </label>
            <label class="field">
              <span>Report Type</span>
              <select [(ngModel)]="form.reportType">
                <option value="summary">Business Summary</option>
                <option value="revenue">Revenue Report</option>
                <option value="clients">Client Report</option>
                <option value="staff">Staff Report</option>
                <option value="services">Service Report</option>
                <option value="inventory">Inventory Report</option>
                <option value="marketing">Marketing Report</option>
              </select>
            </label>
          </div>
          <div class="form-row">
            <label class="field">
              <span>Export Format</span>
              <div class="format-options">
                <label class="format-option" [class.active]="form.format==='pdf'" (click)="form.format='pdf'">
                  <span class="format-icon">📄</span> PDF
                </label>
                <label class="format-option" [class.active]="form.format==='excel'" (click)="form.format='excel'">
                  <span class="format-icon">📊</span> Excel
                </label>
                <label class="format-option" [class.active]="form.format==='csv'" (click)="form.format='csv'">
                  <span class="format-icon">📋</span> CSV
                </label>
              </div>
            </label>
          </div>
          <div class="form-actions">
            <button class="primary-button" (click)="generateReport()" [disabled]="generating()">
              {{ generating() ? 'Generating...' : 'Generate Report' }}
            </button>
            <button class="ghost-button" (click)="downloadReport()" [disabled]="!generated()">
              📥 Download
            </button>
          </div>
        </div>
      </section>

      <section class="panel report-section inner-page-card" *ngIf="generated()">
        <div class="section-title inner-action-bar">
          <h3>Export Preview</h3>
          <span class="badge">Ready for download</span>
        </div>
        <div class="export-preview">
          <div class="preview-line" *ngFor="let line of previewLines()">{{ line }}</div>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .export-form { display: grid; gap: 16px; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .date-range-inputs { display: flex; align-items: center; gap: 8px; }
    .date-range-inputs input { flex: 1; min-height: 34px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; font-size: 13px; }
    .date-range-inputs span { color: var(--muted); font-size: 12px; }
    .format-options { display: flex; gap: 8px; }
    .format-option { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; transition: all 140ms ease; font-size: 13px; }
    .format-option:hover { border-color: #4B1238; }
    .format-option.active { border-color: #4B1238; background: #F8EEF4; color: #4B1238; font-weight: 700; }
    .format-icon { font-size: 16px; }
    .form-actions { display: flex; gap: 10px; padding-top: 8px; }
    .export-preview { margin-top: 12px; max-height: 200px; overflow: auto; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: #1a1f2e; color: #e2e8f0; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; line-height: 1.6; }
    .preview-line { white-space: pre; }
    @media (max-width: 760px) { .form-row { grid-template-columns: 1fr; } .format-options { flex-wrap: wrap; } }
  `]
})
export class ReportCustomExportComponent {
  @Input() filters!: FilterState;
  readonly generating = signal(false);
  readonly generated = signal(false);
  readonly previewLines = signal<string[]>([]);
  private downloadUrl = '';

  readonly staffList = ['Priya Sharma', 'Ananya Gupta', 'Rahul Verma', 'Sneha Patel', 'Vikram Singh'];
  readonly categories = ['Hair', 'Skin', 'Nails', 'Makeup', 'Massage'];

  form = {
    from: '',
    to: '',
    branchId: '',
    staffId: '',
    category: '',
    segment: '',
    reportType: 'summary',
    format: 'csv'
  };

  constructor(private service: ReportsEnterpriseService) {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = new Date(); monthStart.setDate(1);
    this.form.from = monthStart.toISOString().slice(0, 10);
    this.form.to = today;
  }

  generateReport(): void {
    this.generating.set(true);
    const lines = [
      `AuraSalon Enterprise Report`,
      `Generated: ${new Date().toISOString()}`,
      `Report Type: ${this.form.reportType}`,
      `Date Range: ${this.form.from} to ${this.form.to}`,
      `Branch: ${this.form.branchId || 'All'}`,
      `Staff: ${this.form.staffId || 'All'}`,
      `Category: ${this.form.category || 'All'}`,
      `Segment: ${this.form.segment || 'All'}`,
      `Format: ${this.form.format.toUpperCase()}`,
      ``,
      `--- Report Data ---`,
      `Revenue,Bookings,Clients,Conversion`,
      `₹5,42,000,384,218,68%`,
      `₹4,89,000,352,195,64%`,
      `₹5,12,000,398,207,66%`,
      ``,
      `© AuraSalon Enterprise — Confidential`
    ];
    this.previewLines.set(lines);
    const content = lines.join('\n');
    const mimeType = this.form.format === 'pdf' ? 'application/pdf' : this.form.format === 'excel' ? 'application/vnd.ms-excel' : 'text/csv';
    const blob = new Blob([content], { type: mimeType });
    this.downloadUrl = URL.createObjectURL(blob);
    this.generated.set(true);
    this.generating.set(false);
  }

  downloadReport(): void {
    if (!this.downloadUrl) return;
    const ext = this.form.format === 'pdf' ? 'pdf' : this.form.format === 'excel' ? 'csv' : 'csv';
    const a = document.createElement('a');
    a.href = this.downloadUrl;
    a.download = `aura-${this.form.reportType}-${this.form.from}.${ext}`;
    a.click();
  }
}
