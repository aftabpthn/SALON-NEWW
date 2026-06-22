import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  DiscountRule,
  DiscountRuleAction,
  DiscountRuleCondition,
  DiscountRuleStatus,
  DiscountRulesService
} from './discount-rules.service';

@Component({
  selector: 'app-rule-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './rule-list.component.html',
  styleUrls: ['./rule-list.component.css']
})
export class RuleListComponent implements OnInit {
  readonly rules = signal<DiscountRule[]>([]);
  readonly activeNowIds = signal<Set<number>>(new Set());
  readonly loading = signal(false);
  readonly activeChecking = signal(false);
  readonly error = signal('');

  statusFilter = '';

  readonly statuses: Array<{ value: string; label: string }> = [
    { value: '', label: 'All statuses' },
    { value: 'draft', label: 'Draft' },
    { value: 'pending_approval', label: 'Pending approval' },
    { value: 'active', label: 'Active' },
    { value: 'paused', label: 'Paused' },
    { value: 'expired', label: 'Expired' }
  ];

  constructor(private readonly service: DiscountRulesService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const params = this.statusFilter ? { status: this.statusFilter } : {};
    this.service.list(params).subscribe({
      next: (result) => {
        this.rules.set(result.rows || []);
        this.loading.set(false);
        this.refreshActiveNow();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load discount rules'));
        this.loading.set(false);
        this.activeNowIds.set(new Set());
      }
    });
  }

  refreshActiveNow(): void {
    this.activeChecking.set(true);
    this.service.evaluate(this.sampleContext()).subscribe({
      next: (result) => {
        this.activeNowIds.set(new Set((result.appliedRules || []).map((id) => Number(id))));
        this.activeChecking.set(false);
      },
      error: () => {
        this.activeNowIds.set(new Set());
        this.activeChecking.set(false);
      }
    });
  }

  toggle(rule: DiscountRule): void {
    const nextStatus: DiscountRuleStatus = rule.status === 'active' ? 'paused' : 'active';
    this.service.status(rule.id, nextStatus).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(this.errorText(error, 'Unable to update rule status'))
    });
  }

  duplicate(rule: DiscountRule): void {
    this.service.create({
      name: `${rule.name || 'Rule'} Copy`,
      description: rule.description || '',
      conditions: this.conditions(rule),
      conditionLogic: rule.conditionLogic === 'OR' ? 'OR' : 'AND',
      action: this.action(rule),
      priority: Number(rule.priority || 100),
      stackable: Boolean(rule.stackable),
      status: 'draft',
      validFrom: rule.validFrom || null,
      validTo: rule.validTo || null
    }).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(this.errorText(error, 'Unable to duplicate rule'))
    });
  }

  remove(rule: DiscountRule): void {
    if (!confirm(`Delete ${rule.name}?`)) return;
    this.service.delete(rule.id).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(this.errorText(error, 'Unable to delete rule'))
    });
  }

  isActiveNow(rule: DiscountRule): boolean {
    return this.activeNowIds().has(Number(rule.id));
  }

  toggleLabel(rule: DiscountRule): string {
    return rule.status === 'active' ? 'Pause' : 'Resume';
  }

  statusLabel(status = 'draft'): string {
    return status.replace(/_/g, ' ');
  }

  statusClass(status = 'draft'): string {
    return `status-${status}`;
  }

  conditionsSummary(rule: DiscountRule): string {
    const conditions = this.conditions(rule);
    if (!conditions.length) return 'Always applies';
    const logic = rule.conditionLogic === 'OR' ? ' OR ' : ' AND ';
    const labels = conditions.slice(0, 3).map((condition) => this.conditionLabel(condition));
    const suffix = conditions.length > 3 ? ` +${conditions.length - 3} more` : '';
    return `${labels.join(logic)}${suffix}`;
  }

  actionSummary(rule: DiscountRule): string {
    const action = this.action(rule);
    const applyTo = action.applyTo === 'service' ? 'selected services' : action.applyTo === 'category' ? 'selected categories' : 'cart';
    if (action.type === 'percent') return `${Number(action.value || 0)}% off ${applyTo}`;
    if (action.type === 'flat') return `${this.moneyLabel(action.value)} off ${applyTo}`;
    if (action.type === 'bundle_price') return `Bundle price ${this.moneyLabel(action.value)} on ${applyTo}`;
    return 'Custom discount action';
  }

  conditions(rule: DiscountRule): DiscountRuleCondition[] {
    if (Array.isArray(rule.conditionsJson)) return rule.conditionsJson;
    if (Array.isArray(rule.conditions)) return rule.conditions;
    return this.parseJson<DiscountRuleCondition[]>(rule.conditions, []);
  }

  action(rule: DiscountRule): DiscountRuleAction {
    if (rule.actionJson && typeof rule.actionJson === 'object') return rule.actionJson;
    if (rule.action && typeof rule.action === 'object') return rule.action;
    return this.parseJson<DiscountRuleAction>(rule.action, { type: 'percent', value: 0, applyTo: 'cart', targetIds: [] });
  }

  private conditionLabel(condition: DiscountRuleCondition): string {
    const field = this.fieldLabel(condition.field);
    const operator = this.operatorLabel(condition.operator);
    return `${field} ${operator} ${this.valueLabel(condition.field, condition.value)}`;
  }

  private fieldLabel(field: string): string {
    const labels: Record<string, string> = {
      dayOfWeek: 'Day',
      timeRange: 'Time',
      occupancyRate: 'Occupancy',
      cartTotalPaise: 'Cart',
      serviceCategory: 'Category',
      clientSegment: 'Segment',
      weatherCondition: 'Weather',
      groupSize: 'Group size',
      dateRange: 'Date',
      staffId: 'Staff'
    };
    return labels[field] || field;
  }

  private operatorLabel(operator: string): string {
    const labels: Record<string, string> = {
      eq: 'is',
      neq: 'is not',
      lt: '<',
      lte: '<=',
      gt: '>',
      gte: '>=',
      in: 'in',
      between: 'between'
    };
    return labels[operator] || operator;
  }

  private valueLabel(field: string, value: unknown): string {
    if (field === 'cartTotalPaise') return this.moneyLabel(Number(value || 0));
    if (field === 'occupancyRate') return `${Math.round(Number(value || 0) * 100)}%`;
    if (field === 'timeRange' && value && typeof value === 'object') {
      const range = value as { start?: string; end?: string };
      return `${range.start || '00:00'}-${range.end || '23:59'}`;
    }
    if (field === 'dateRange' && value && typeof value === 'object') {
      const range = value as { from?: string; to?: string };
      return `${range.from || 'start'} to ${range.to || 'end'}`;
    }
    return Array.isArray(value) ? value.join(', ') : String(value ?? '-');
  }

  private moneyLabel(valuePaise: unknown): string {
    return `Rs ${Math.round(Number(valuePaise || 0)) / 100}`;
  }

  private sampleContext(): Record<string, unknown> {
    return {
      groupSize: 2,
      occupancyRate: 0.45,
      clientSegment: 'regular',
      weatherCondition: 'clear',
      staffId: 'sample-staff',
      cartItems: [
        { serviceId: 'svc_haircut', category: 'hair', pricePaise: 120000, qty: 1 },
        { serviceId: 'svc_spa', category: 'spa', pricePaise: 180000, qty: 1 }
      ]
    };
  }

  private parseJson<T>(value: unknown, fallback: T): T {
    if (Array.isArray(value) || (value && typeof value === 'object')) return value as T;
    if (!value || typeof value !== 'string') return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
