import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

type Tab = 'exceptions' | 'approvals' | 'locks' | 'expiry' | 'dead-stock' | 'policy' | 'operations';
type NegativeStockRequest = { id:string; productName:string; requestedStockQuantity:number; reason:string; status:string; requestedBy:string; requestedAt:string };
type InventoryPolicy = { negativeStockRule: 'block' | 'approval_required'; valuationMethod: 'weighted_average' | 'fifo'; expiryWindowDays: number; countVarianceThresholdBps: number; approvalMatrix: Record<string, string> };
type OperationsHealth = {
  queue: { queued:number; processing:number; retryScheduled:number; terminalFailed:number; oldestPendingAt?:string; lastSentAt?:string; lastFailure?:string };
  invariants: { ledgerStockMismatch:number; negativeStock:number };
  failedJobs: Array<{ id:string; channel:string; destination:string; attempts:number; maxAttempts:number; lastError:string; updatedAt:string }>;
  generatedAt?: string;
};type ControlException = { severity: string; control: string; title: string; valuePaise: number; evidence: string; owner: string; status: string; route: string };
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
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './advanced-controls-page.component.html',
  styleUrls: ['./advanced-controls-page.component.css'],
})
export class AdvancedControlsPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);

  readonly tabs: Array<{ id: Tab; label: string }> = [
    { id: 'exceptions', label: 'Exceptions' },
    { id: 'approvals', label: 'Approval Matrix' },
    { id: 'locks', label: 'Audit Locks' },
    { id: 'expiry', label: 'Expiry' },
    { id: 'dead-stock', label: 'Dead Stock' },
    { id: 'policy', label: 'Policy' },
    { id: 'operations', label: 'Operations' },
  ];
  activeTab: Tab = 'exceptions';
  severity = 'all';
  loading = true;
  error = '';
  controls: AdvancedControls = this.emptyControls();
  policy: InventoryPolicy = { negativeStockRule: 'block', valuationMethod: 'weighted_average', expiryWindowDays: 30, countVarianceThresholdBps: 500, approvalMatrix: { negativeStock: 'owner', stockCount: 'inventory_manager', backbarOverride: 'owner' } };
  savingPolicy = false;
  negativeStockRequests: NegativeStockRequest[] = [];
  notice = '';
  operations: OperationsHealth = this.emptyOperations();
  retryingJobId = '';

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
      const [response, policy, negativeRequests, operations] = await Promise.all([firstValueFrom(this.api.get<ApiEnvelope<AdvancedControls>>('/inventory/advanced-controls')), firstValueFrom(this.api.get<ApiEnvelope<InventoryPolicy>>('/inventory/policy')), firstValueFrom(this.api.get<ApiEnvelope<NegativeStockRequest[]>>('/inventory/negative-stock-requests')), firstValueFrom(this.api.get<ApiEnvelope<OperationsHealth>>('/inventory/operations-health'))]);
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Controls could not be loaded');
      this.controls = response.data;
      if (policy.data) this.policy = policy.data;
      this.negativeStockRequests = negativeRequests.data || [];
      this.operations = operations.data || this.emptyOperations();
    } catch (error: any) {
      this.controls = this.emptyControls();
      this.error = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Controls could not be loaded';
    } finally {
      this.loading = false;
    }
  }

  async savePolicy() {
    this.savingPolicy = true; this.error = ''; this.notice = '';
    try {
      const response = await firstValueFrom(this.api.put<ApiEnvelope<InventoryPolicy>>('/inventory/policy', this.policy));
      if (!response.data) throw new Error('Policy response was empty');
      this.policy = response.data; this.notice = this.language.text('inventory.message.b65d768d7a'); await this.reload();
    } catch (error: any) { this.error = error?.error?.error?.message ?? error?.message ?? 'Inventory policy could not be saved'; }
    finally { this.savingPolicy = false; }
  }

  async reviewNegativeStock(row: NegativeStockRequest, decision: 'approve' | 'reject') {
    const reviewNote = decision === 'reject' ? window.prompt('Rejection reason')?.trim() : '';
    if (decision === 'reject' && !reviewNote) return;
    this.savingPolicy = true; this.error = ''; try { await firstValueFrom(this.api.post(`/inventory/negative-stock-requests/${row.id}/review`, { decision, reviewNote: reviewNote || '' })); await this.reload(); this.notice = `Negative stock request ${decision}d`; } catch (error: any) { this.error = error?.error?.error?.message ?? error?.message ?? 'Request could not be reviewed'; } finally { this.savingPolicy = false; }
  }
  async retryCommunication(id: string) {
    this.retryingJobId = id; this.error = ''; this.notice = '';
    try {
      await firstValueFrom(this.api.post(`/inventory/supplier-governance/communications/${id}/retry`, {}));
      await this.reload();
      this.notice = this.language.text('inventory.message.f61da9fdc6');
    } catch (error: any) { this.error = error?.error?.error?.message ?? error?.message ?? 'Communication could not be retried'; }
    finally { this.retryingJobId = ''; }
  }
  exportEvidence() {
    const rows = [
      ['Severity', 'Control', 'Exception', 'Value Paise', 'Evidence', 'Owner', 'Status'].map((value) => this.language.textValue(value)),
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

  private emptyOperations(): OperationsHealth {
    return { queue: { queued:0, processing:0, retryScheduled:0, terminalFailed:0 }, invariants: { ledgerStockMismatch:0, negativeStock:0 }, failedJobs: [] };
  }
  private emptyControls(): AdvancedControls {
    return {
      summary: { critical: 0, warnings: 0, pendingApprovals: 0, expiryAlerts: null, deadStock: 0 },
      capabilities: { approvalMatrix: false, auditLocks: false, expiry: false, deadStock: false },
      exceptionRows: [], approvalMatrix: [], auditLocks: [], expiringRows: [], deadStockRows: [],
    };
  }
}
