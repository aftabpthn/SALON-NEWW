import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type Tab = 'exceptions' | 'approvals' | 'locks' | 'expiry' | 'dead-stock';
type ControlException = { severity: string; control: string; title: string; valuePaise: number; evidence: string; owner: string; status: string; route: string };
type ApprovalControl = { control: string; requiredRole: string; pending: number; gate: string; route: string };
type AuditLock = { lock: string; locked: number; reason: string; route: string };
type ExpiryRow = { productId: string; productName: string; batchNumber: string; expiryDate: string; daysToExpiry: number };
type DeadStockRow = { productId: string; productName: string; sku: string; stockQuantity: number; inactiveDays: number; valuePaise: number; lastOutboundAt?: string };
type AdvancedControls = {
  summary: { critical: number; warnings: number; pendingApprovals: number; expiryAlerts: number | null; deadStock: number };
  capabilities: { approvalMatrix: boolean; auditLocks: boolean; expiry: boolean; deadStock: boolean };
  exceptionRows: ControlException[];
  approvalMatrix: ApprovalControl[];
  auditLocks: AuditLock[];
  expiringRows: ExpiryRow[];
  deadStockRows: DeadStockRow[];
};

@Component({
  selector: 'page-inventory-advanced-controls',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './advanced-controls-page.component.html',
  styleUrls: ['./advanced-controls-page.component.css'],
})
export class AdvancedControlsPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly tabs: Array<{ id: Tab; label: string }> = [
    { id: 'exceptions', label: 'Exceptions' },
    { id: 'approvals', label: 'Approval Matrix' },
    { id: 'locks', label: 'Audit Locks' },
    { id: 'expiry', label: 'Expiry' },
    { id: 'dead-stock', label: 'Dead Stock' },
  ];
  activeTab: Tab = 'exceptions';
  severity = 'all';
  loading = true;
  error = '';
  controls: AdvancedControls = this.emptyControls();

  ngOnInit() {
    void this.reload();
  }

  get filteredExceptions() {
    return this.severity === 'all'
      ? this.controls.exceptionRows
      : this.controls.exceptionRows.filter((row) => row.severity === this.severity);
  }

  async reload() {
    this.loading = true;
    this.error = '';
    try {
      const response = await firstValueFrom(this.api.get<ApiEnvelope<AdvancedControls>>('/inventory/advanced-controls'));
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Controls could not be loaded');
      this.controls = response.data;
    } catch (error: any) {
      this.controls = this.emptyControls();
      this.error = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Controls could not be loaded';
    } finally {
      this.loading = false;
    }
  }

  exportEvidence() {
    const rows = [
      ['Severity', 'Control', 'Exception', 'Value Paise', 'Evidence', 'Owner', 'Status'],
      ...this.filteredExceptions.map((row) => [row.severity, row.control, row.title, row.valuePaise, row.evidence, row.owner, row.status]),
    ];
    const csv = rows.map((row) => row.map((value) => this.csv(value)).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'inventory-control-evidence.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  money(paise: number) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((Number(paise) || 0) / 100);
  }

  date(value?: string) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB').format(date);
  }

  private csv(value: unknown) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private emptyControls(): AdvancedControls {
    return {
      summary: { critical: 0, warnings: 0, pendingApprovals: 0, expiryAlerts: null, deadStock: 0 },
      capabilities: { approvalMatrix: false, auditLocks: false, expiry: false, deadStock: false },
      exceptionRows: [], approvalMatrix: [], auditLocks: [], expiringRows: [], deadStockRows: [],
    };
  }
}
