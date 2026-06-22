import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../../core/api.service';
import { AppStateService } from '../../core/state/app-state.service';

type RuleApproval = ApiRecord & {
  id: number;
  ruleId: number;
  requestedRole: string;
  requestedPercent: number;
  roleLimitPercent: number;
  note?: string;
  createdAt?: number;
  ruleSnapshot?: ApiRecord;
};

@Component({
  selector: 'app-discount-rule-approvals',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './approvals.component.html',
  styleUrls: ['./approvals.component.css']
})
export class DiscountRuleApprovalsComponent implements OnInit {
  readonly approvals = signal<RuleApproval[]>([]);
  readonly loading = signal(false);
  readonly actionId = signal<number | null>(null);
  readonly error = signal('');
  readonly success = signal('');

  notes: Record<number, string> = {};

  constructor(
    private readonly api: ApiService,
    readonly state: AppStateService
  ) {}

  ngOnInit(): void {
    if (this.canApprove()) this.load();
  }

  canApprove(): boolean {
    return ['regional_head', 'regionalHead', 'admin', 'owner', 'superAdmin'].includes(String(this.state.userRole()));
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<{ rows: RuleApproval[] }>('discount-rules/approvals/pending').subscribe({
      next: (result) => {
        this.approvals.set(result.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load pending approvals'));
        this.loading.set(false);
      }
    });
  }

  approve(approval: RuleApproval): void {
    this.decide(approval, 'approve');
  }

  reject(approval: RuleApproval): void {
    this.decide(approval, 'reject');
  }

  ruleName(approval: RuleApproval): string {
    return String(approval.ruleSnapshot?.name || `Rule #${approval.ruleId}`);
  }

  actionSummary(approval: RuleApproval): string {
    const action = this.ruleAction(approval);
    const value = Number(action.value || 0);
    if (action.type === 'percent') return `${value}% discount`;
    if (action.type === 'flat') return `Flat Rs ${Math.round(value) / 100} discount`;
    if (action.type === 'bundle_price') return `Bundle price Rs ${Math.round(value) / 100}`;
    return 'Discount action';
  }

  createdLabel(approval: RuleApproval): string {
    const timestamp = Number(approval.createdAt || 0);
    return timestamp ? new Date(timestamp * 1000).toLocaleString() : '-';
  }

  private decide(approval: RuleApproval, decision: 'approve' | 'reject'): void {
    this.actionId.set(approval.id);
    this.error.set('');
    this.success.set('');
    this.api.post<ApiRecord>(`discount-rules/approvals/${approval.id}/${decision}`, {
      note: this.notes[approval.id] || ''
    }).subscribe({
      next: () => {
        this.success.set(decision === 'approve' ? 'Rule approved and activated.' : 'Rule rejected and moved to draft.');
        this.actionId.set(null);
        this.notes[approval.id] = '';
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, `Unable to ${decision} rule`));
        this.actionId.set(null);
      }
    });
  }

  private ruleAction(approval: RuleApproval): ApiRecord {
    const snapshot = approval.ruleSnapshot || {};
    if (snapshot.actionJson && typeof snapshot.actionJson === 'object') return snapshot.actionJson;
    if (snapshot.action && typeof snapshot.action === 'object') return snapshot.action;
    if (typeof snapshot.action === 'string') {
      try {
        return JSON.parse(snapshot.action) as ApiRecord;
      } catch {
        return {};
      }
    }
    return {};
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
