import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

type Tab = 'summary' | 'exceptions' | 'audit';
type GlBranchRow = {
  branchId: string;
  branchName: string;
  productCount: number;
  inventoryValuePaise: number;
  glValuePaise: number;
  differencePaise: number;
  missingCostProducts: number;
  status: string;
};
type GlException = { severity: string; title: string; detail: string; amountPaise: number; route: string };
type GlAuditRow = { id: string; sourceType: string; sourceId: string; memo: string; amountPaise: number; createdAt: string };
type GlReconciliation = {
  asOfDate: string;
  accountCode: string;
  valuationMethod: string;
  summary: { inventoryValuePaise: number; glValuePaise: number; differencePaise: number; unreconciled: number };
  rows: GlBranchRow[];
  exceptionRows: GlException[];
  auditRows: GlAuditRow[];
};

@Component({
  selector: 'page-inventory-gl-reconciliation',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent, TranslatePipe],
  templateUrl: './gl-reconciliation-page.component.html',
  styleUrls: ['./gl-reconciliation-page.component.css'],
})
export class GlReconciliationPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);

  readonly tabs: Array<{ id: Tab; label: string }> = [
    { id: 'summary', label: 'Branch Summary' },
    { id: 'exceptions', label: 'Exceptions' },
    { id: 'audit', label: 'Audit Trail' },
  ];
  activeTab: Tab = 'summary';
  asOf = this.today();
  loading = true;
  error = '';
  result: GlReconciliation | null = null;

  ngOnInit() {
    void this.runReconciliation();
  }

  async runReconciliation() {
    if (!this.asOf) {
      this.error = this.language.text('inventory.message.106beebb44');
      return;
    }
    this.loading = true;
    this.error = '';
    try {
      const response = await firstValueFrom(
        this.api.get<ApiEnvelope<GlReconciliation>>(`/inventory/gl-reconciliation?asOf=${encodeURIComponent(this.asOf)}`),
      );
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Reconciliation could not be loaded');
      this.result = response.data;
    } catch (error: any) {
      this.result = null;
      this.error = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Reconciliation could not be loaded';
    } finally {
      this.loading = false;
    }
  }

  reviewExceptions() {
    this.activeTab = 'exceptions';
  }

  exportCsv() {
    if (!this.result) return;
    const rows = [
      ['As of', 'Branch', 'Products', 'Inventory value paise', 'GL stock value paise', 'Difference paise', 'Missing cost products', 'Status'].map((value) => this.language.textValue(value)),
      ...this.result.rows.map((row) => [
        this.result!.asOfDate,
        row.branchName,
        row.productCount,
        row.inventoryValuePaise,
        row.glValuePaise,
        row.differencePaise,
        row.missingCostProducts,
        row.status,
      ]),
    ];
    this.download(
      rows.map((row) => row.map((value) => this.csv(value)).join(',')).join('\r\n'),
      `inventory-gl-reconciliation-${this.result.asOfDate}.csv`,
      'text/csv;charset=utf-8',
    );
  }

  exportEvidence() {
    if (!this.result) return;
    this.download(
      JSON.stringify(this.result, null, 2),
      `inventory-gl-evidence-${this.result.asOfDate}.json`,
      'application/json;charset=utf-8',
    );
  }

  money(paise: number) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format((Number(paise) || 0) / 100);
  }

  dateTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date);
  }

  private today() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private csv(value: unknown) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private download(content: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
