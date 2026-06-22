import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../../core/api.service';

type DiscountAuditRow = ApiRecord & {
  id: number;
  ruleId?: number | null;
  eventType: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  amountPaise: number;
  discountPaise: number;
  gstImpactPaise: number;
  note?: string;
  createdAt: number;
  metadata?: ApiRecord;
};

@Component({
  selector: 'app-discount-audit-log',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './audit-log.component.html',
  styleUrls: ['./audit-log.component.css']
})
export class DiscountAuditLogComponent implements OnInit {
  readonly rows = signal<DiscountAuditRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly expandedRuleId = signal<number | null>(null);
  readonly historyLoadingRuleId = signal<number | null>(null);

  histories: Record<number, DiscountAuditRow[]> = {};
  filters = {
    from: '',
    to: '',
    eventType: ''
  };

  readonly eventTypes = [
    '',
    'rule_created',
    'rule_updated',
    'rule_paused',
    'rule_deleted',
    'rule_approved',
    'rule_rejected',
    'discount_applied',
    'budget_exceeded',
    'margin_blocked'
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<{ rows: DiscountAuditRow[] }>('discount-audit/log', this.filters).subscribe({
      next: (result) => {
        this.rows.set(result.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load discount audit log'));
        this.loading.set(false);
      }
    });
  }

  toggleHistory(row: DiscountAuditRow): void {
    const ruleId = Number(row.ruleId || 0);
    if (!ruleId) return;
    if (this.expandedRuleId() === ruleId) {
      this.expandedRuleId.set(null);
      return;
    }
    this.expandedRuleId.set(ruleId);
    if (this.histories[ruleId]) return;
    this.historyLoadingRuleId.set(ruleId);
    this.api.list<{ rows: DiscountAuditRow[] }>(`discount-audit/rule/${ruleId}/history`).subscribe({
      next: (result) => {
        this.histories[ruleId] = result.rows || [];
        this.historyLoadingRuleId.set(null);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load rule history'));
        this.historyLoadingRuleId.set(null);
      }
    });
  }

  exportCsv(): void {
    const headers = ['id', 'createdAt', 'eventType', 'ruleId', 'actorRole', 'amountPaise', 'discountPaise', 'gstImpactPaise', 'note'];
    const lines = [
      headers.join(','),
      ...this.rows().map((row) => headers.map((key) => this.csvCell(this.csvValue(row, key))).join(','))
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'discount-audit-log.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  formatMoney(value: unknown): string {
    return `Rs ${Math.round(Number(value || 0)) / 100}`;
  }

  formatDate(timestamp: unknown): string {
    const seconds = Number(timestamp || 0);
    return seconds ? new Date(seconds * 1000).toLocaleString() : '-';
  }

  eventLabel(eventType: string): string {
    return eventType.replace(/_/g, ' ');
  }

  historyFor(ruleId: unknown): DiscountAuditRow[] {
    return this.histories[Number(ruleId || 0)] || [];
  }

  metadataSummary(row: DiscountAuditRow): string {
    const note = row.metadata?.gstImpactNote || row.note || '';
    return String(note || 'GST delta unavailable; stored as 0.');
  }

  private csvValue(row: DiscountAuditRow, key: string): string {
    if (key === 'createdAt') return this.formatDate(row.createdAt);
    return String(row[key] ?? '');
  }

  private csvCell(value: string): string {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
