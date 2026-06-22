import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../../core/api.service';

type RuleConflict = ApiRecord & {
  id: string;
  type: string;
  severity: string;
  ruleIds: Array<string | number>;
  ruleNames: string[];
  reason: string;
  recommendation: string;
  evidence?: ApiRecord;
};

@Component({
  selector: 'app-rule-conflict-detector',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './rule-conflict-detector.component.html',
  styleUrls: ['./rule-conflict-detector.component.css']
})
export class RuleConflictDetectorComponent implements OnInit {
  readonly loading = signal(false);
  readonly checking = signal(false);
  readonly error = signal('');
  readonly result = signal<ApiRecord | null>(null);
  readonly draftResult = signal<ApiRecord | null>(null);
  readonly expandedId = signal('');

  filters = {
    status: ''
  };

  draftRule: ApiRecord = {
    name: 'Sample slow-hour rule',
    priority: 100,
    stackable: false,
    status: 'draft',
    validFrom: this.today(),
    validTo: this.today(),
    conditionsText: JSON.stringify([{ field: 'dayOfWeek', operator: 'in', value: ['mon', 'tue'] }], null, 2),
    actionText: JSON.stringify({ type: 'percent', value: 15, maxDiscountPaise: 50000, applyTo: 'cart', targetIds: [] }, null, 2)
  };

  readonly statuses = ['', 'draft', 'pending_approval', 'active', 'paused', 'expired'];
  readonly severities = ['critical', 'high', 'medium', 'low'];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord>('discount-rules/conflicts', {
      status: this.filters.status
    }).subscribe({
      next: (result) => {
        this.result.set(result);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load rule conflicts'));
        this.loading.set(false);
      }
    });
  }

  checkDraft(): void {
    this.checking.set(true);
    this.error.set('');
    let conditions: unknown[] = [];
    let action: ApiRecord = {};
    try {
      conditions = JSON.parse(String(this.draftRule.conditionsText || '[]'));
      action = JSON.parse(String(this.draftRule.actionText || '{}'));
    } catch {
      this.error.set('Draft JSON invalid hai. Conditions/action JSON check karo.');
      this.checking.set(false);
      return;
    }
    this.api.post<ApiRecord>('discount-rules/conflicts/check', {
      name: this.draftRule.name,
      priority: Number(this.draftRule.priority || 100),
      stackable: Boolean(this.draftRule.stackable),
      status: this.draftRule.status || 'draft',
      validFrom: this.draftRule.validFrom || null,
      validTo: this.draftRule.validTo || null,
      conditions,
      action
    }).subscribe({
      next: (result) => {
        this.draftResult.set(result);
        this.checking.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to check draft rule'));
        this.checking.set(false);
      }
    });
  }

  conflicts(): RuleConflict[] {
    return this.result()?.conflicts || [];
  }

  draftConflicts(): RuleConflict[] {
    return this.draftResult()?.conflicts || [];
  }

  severityCount(value: string): number {
    return Number(this.result()?.severityCounts?.[value] || 0);
  }

  severityClass(value: string): string {
    return `severity ${String(value || 'low').toLowerCase()}`;
  }

  label(value: unknown): string {
    return String(value || '').replace(/_/g, ' ');
  }

  toggle(row: RuleConflict): void {
    this.expandedId.set(this.expandedId() === row.id ? '' : row.id);
  }

  evidenceText(row: RuleConflict): string {
    return JSON.stringify(row.evidence || {}, null, 2);
  }

  today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private errorText(error: unknown, fallback: string): string {
    return this.api.errorText(error, fallback);
  }
}
