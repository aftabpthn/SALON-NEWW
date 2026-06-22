import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  DiscountRule,
  DiscountRuleAction,
  DiscountRuleCondition,
  DiscountRuleEvaluation,
  DiscountRulePayload,
  DiscountRuleStatus,
  DiscountRulesService
} from './discount-rules.service';

type BuilderCondition = DiscountRuleCondition & {
  valueText?: string;
  valueRupees?: number | string;
  start?: string;
  end?: string;
  from?: string;
  to?: string;
  percent?: number | string;
};

interface ActionDraft {
  type: 'percent' | 'flat' | 'bundle_price';
  value: number | string;
  valueRupees: number | string;
  maxCapRupees: number | string;
  applyTo: string;
  targetIdsText: string;
}

interface RuleDraft {
  name: string;
  description: string;
  conditionLogic: 'AND' | 'OR';
  conditions: BuilderCondition[];
  action: ActionDraft;
  priority: number | string;
  stackable: boolean;
  validFrom: string;
  validTo: string;
}

interface SampleDraft {
  cartTotalRupees: number | string;
  serviceId: string;
  category: string;
  groupSize: number | string;
  occupancyPercent: number | string;
  clientSegment: string;
  weatherCondition: string;
  staffId: string;
}

@Component({
  selector: 'app-rule-builder',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './rule-builder.component.html',
  styleUrls: ['./rule-builder.component.css']
})
export class RuleBuilderComponent implements OnInit {
  readonly editingId = signal<number | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly testing = signal(false);
  readonly error = signal('');
  readonly testResult = signal<DiscountRuleEvaluation | null>(null);

  private loadedStatus: DiscountRuleStatus = 'draft';

  readonly conditionFields = [
    { value: 'dayOfWeek', label: 'Day of week' },
    { value: 'timeRange', label: 'Time range' },
    { value: 'occupancyRate', label: 'Occupancy rate' },
    { value: 'cartTotalPaise', label: 'Cart total' },
    { value: 'serviceCategory', label: 'Service category' },
    { value: 'clientSegment', label: 'Client segment' },
    { value: 'weatherCondition', label: 'Weather condition' },
    { value: 'groupSize', label: 'Group size' },
    { value: 'dateRange', label: 'Date range' },
    { value: 'staffId', label: 'Staff ID' }
  ];

  readonly operatorLabels: Record<string, string> = {
    eq: 'is',
    neq: 'is not',
    lt: 'less than',
    lte: 'less or equal',
    gt: 'greater than',
    gte: 'greater or equal',
    in: 'in list',
    between: 'between'
  };

  readonly dayOptions = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  readonly segmentOptions = ['new', 'regular', 'vip', 'lapsed', 'student', 'corporate'];
  readonly weatherOptions = ['clear', 'rain', 'heat', 'cold', 'festival'];

  draft: RuleDraft = this.emptyDraft();
  sample: SampleDraft = {
    cartTotalRupees: 3000,
    serviceId: 'svc_haircut',
    category: 'hair',
    groupSize: 2,
    occupancyPercent: 45,
    clientSegment: 'regular',
    weatherCondition: 'clear',
    staffId: 'sample-staff'
  };

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly service: DiscountRulesService
  ) {}

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id') || 0);
    if (id > 0) this.loadRule(id);
  }

  loadRule(id: number): void {
    this.loading.set(true);
    this.error.set('');
    this.service.get(id).subscribe({
      next: (rule) => {
        this.editingId.set(id);
        this.loadedStatus = rule.status || 'draft';
        this.draft = this.fromRule(rule);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load discount rule'));
        this.loading.set(false);
      }
    });
  }

  addCondition(field = 'dayOfWeek'): void {
    this.draft.conditions = [...this.draft.conditions, this.emptyCondition(field)];
  }

  removeCondition(index: number): void {
    this.draft.conditions = this.draft.conditions.filter((_, currentIndex) => currentIndex !== index);
    if (!this.draft.conditions.length) this.addCondition();
  }

  setConditionField(condition: BuilderCondition, field: string): void {
    Object.assign(condition, this.emptyCondition(field));
  }

  operatorsFor(field: string): string[] {
    if (field === 'timeRange' || field === 'dateRange') return ['between'];
    if (field === 'dayOfWeek' || field === 'serviceCategory' || field === 'clientSegment' || field === 'weatherCondition' || field === 'staffId') {
      return ['in', 'eq', 'neq'];
    }
    return ['lt', 'lte', 'gt', 'gte', 'eq', 'between'];
  }

  fieldLabel(field: string): string {
    return this.conditionFields.find((item) => item.value === field)?.label || field;
  }

  actionValueLabel(): string {
    if (this.draft.action.type === 'percent') return 'Percent value';
    if (this.draft.action.type === 'bundle_price') return 'Bundle price Rs';
    return 'Flat amount Rs';
  }

  previewSentence(): string {
    const conditions = this.draft.conditions.map((condition) => this.builderConditionLabel(condition)).join(` ${this.draft.conditionLogic} `);
    const action = this.actionLabel(this.actionPayload());
    const stack = this.draft.stackable ? 'can stack with other offers' : 'stops after this offer';
    return `IF ${conditions || 'no condition'} THEN ${action}; ${stack}. Save default: draft.`;
  }

  testWithSampleCart(): void {
    this.testing.set(true);
    this.error.set('');
    this.service.evaluate(this.sampleContext()).subscribe({
      next: (result) => {
        this.testResult.set(result);
        this.testing.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to evaluate sample cart'));
        this.testing.set(false);
      }
    });
  }

  save(): void {
    if (!this.draft.name.trim()) {
      this.error.set('Rule name is required');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    const payload = this.toPayload();
    const id = this.editingId();
    const request = id ? this.service.update(id, payload) : this.service.create(payload);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.router.navigate(['/discount-rules']);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to save rule'));
        this.saving.set(false);
      }
    });
  }

  resultDiscountLabel(): string {
    return this.moneyLabel(this.testResult()?.totalDiscountPaise || 0);
  }

  appliedRuleLabel(): string {
    const ids = this.testResult()?.appliedRules || [];
    return ids.length ? ids.join(', ') : 'none';
  }

  isTextListField(condition: BuilderCondition): boolean {
    return ['dayOfWeek', 'serviceCategory', 'staffId'].includes(condition.field);
  }

  isChoiceField(condition: BuilderCondition): boolean {
    return condition.field === 'clientSegment' || condition.field === 'weatherCondition';
  }

  private emptyDraft(): RuleDraft {
    return {
      name: '',
      description: '',
      conditionLogic: 'AND',
      conditions: [this.emptyCondition('dayOfWeek')],
      action: {
        type: 'percent',
        value: 10,
        valueRupees: 500,
        maxCapRupees: '',
        applyTo: 'cart',
        targetIdsText: ''
      },
      priority: 100,
      stackable: false,
      validFrom: '',
      validTo: ''
    };
  }

  private emptyCondition(field: string): BuilderCondition {
    if (field === 'timeRange') return { field, operator: 'between', value: {}, start: '10:00', end: '16:00' };
    if (field === 'dateRange') return { field, operator: 'between', value: {}, from: '', to: '' };
    if (field === 'occupancyRate') return { field, operator: 'lt', value: 0.5, percent: 50 };
    if (field === 'cartTotalPaise') return { field, operator: 'gte', value: 100000, valueRupees: 1000 };
    if (field === 'groupSize') return { field, operator: 'gte', value: 2 };
    if (field === 'clientSegment') return { field, operator: 'in', value: ['regular'], valueText: 'regular' };
    if (field === 'weatherCondition') return { field, operator: 'in', value: ['clear'], valueText: 'clear' };
    if (field === 'staffId') return { field, operator: 'in', value: [], valueText: '' };
    if (field === 'serviceCategory') return { field, operator: 'in', value: ['hair'], valueText: 'hair' };
    return { field: 'dayOfWeek', operator: 'in', value: ['mon'], valueText: 'mon' };
  }

  private fromRule(rule: DiscountRule): RuleDraft {
    const conditions = this.ruleConditions(rule).map((condition) => this.hydrateCondition(condition));
    return {
      name: rule.name || '',
      description: rule.description || '',
      conditionLogic: rule.conditionLogic === 'OR' ? 'OR' : 'AND',
      conditions: conditions.length ? conditions : [this.emptyCondition('dayOfWeek')],
      action: this.hydrateAction(this.ruleAction(rule)),
      priority: Number(rule.priority || 100),
      stackable: Boolean(rule.stackable),
      validFrom: rule.validFrom || '',
      validTo: rule.validTo || ''
    };
  }

  private hydrateCondition(condition: DiscountRuleCondition): BuilderCondition {
    const row = this.emptyCondition(condition.field || 'dayOfWeek');
    row.operator = condition.operator || row.operator;
    const value = condition.value;
    if (row.field === 'timeRange' && value && typeof value === 'object') {
      const range = value as { start?: string; end?: string };
      row.start = range.start || row.start;
      row.end = range.end || row.end;
    } else if (row.field === 'dateRange' && value && typeof value === 'object') {
      const range = value as { from?: string; to?: string };
      row.from = range.from || '';
      row.to = range.to || '';
    } else if (row.field === 'occupancyRate') {
      row.percent = Math.round(Number(value || 0) * 100);
    } else if (row.field === 'cartTotalPaise') {
      row.valueRupees = this.paiseToRupees(Number(value || 0));
    } else if (Array.isArray(value)) {
      row.valueText = value.join(',');
    } else {
      row.value = value;
      row.valueText = String(value ?? '');
    }
    return row;
  }

  private hydrateAction(action: DiscountRuleAction): ActionDraft {
    const type = action.type === 'flat' || action.type === 'bundle_price' ? action.type : 'percent';
    return {
      type,
      value: type === 'percent' ? Number(action.value || 0) : Number(action.value || 0),
      valueRupees: type === 'percent' ? 500 : this.paiseToRupees(Number(action.value || 0)),
      maxCapRupees: action.maxDiscountPaise ? this.paiseToRupees(action.maxDiscountPaise) : '',
      applyTo: action.applyTo || 'cart',
      targetIdsText: Array.isArray(action.targetIds) ? action.targetIds.join(',') : ''
    };
  }

  private toPayload(): DiscountRulePayload {
    return {
      name: this.draft.name.trim(),
      description: this.draft.description.trim(),
      conditions: this.draft.conditions.map((condition) => this.conditionPayload(condition)),
      conditionLogic: this.draft.conditionLogic,
      action: this.actionPayload(),
      priority: Number(this.draft.priority || 100),
      stackable: Boolean(this.draft.stackable),
      status: this.editingId() ? this.loadedStatus : 'draft',
      validFrom: this.draft.validFrom || null,
      validTo: this.draft.validTo || null
    };
  }

  private conditionPayload(condition: BuilderCondition): DiscountRuleCondition {
    const field = condition.field;
    const operator = condition.operator || this.operatorsFor(field)[0];
    let value: unknown = condition.value;

    if (field === 'timeRange') value = { start: condition.start || '00:00', end: condition.end || '23:59' };
    else if (field === 'dateRange') value = { from: condition.from || '', to: condition.to || '' };
    else if (field === 'occupancyRate') value = Math.max(0, Number(condition.percent || 0)) / 100;
    else if (field === 'cartTotalPaise') value = this.rupeesToPaise(condition.valueRupees);
    else if (field === 'groupSize') value = Number(condition.value || 0);
    else if (field === 'clientSegment' || field === 'weatherCondition') value = this.textOrList(condition.valueText || String(condition.value || ''), operator);
    else if (field === 'dayOfWeek' || field === 'serviceCategory' || field === 'staffId') value = this.textOrList(condition.valueText || '', operator);

    return { field, operator, value };
  }

  private actionPayload(): DiscountRuleAction {
    const action = this.draft.action;
    const value = action.type === 'percent' ? Number(action.value || 0) : this.rupeesToPaise(action.valueRupees);
    return {
      type: action.type,
      value,
      maxDiscountPaise: this.rupeesToPaise(action.maxCapRupees),
      applyTo: action.applyTo,
      targetIds: this.csv(action.targetIdsText)
    };
  }

  private builderConditionLabel(condition: BuilderCondition): string {
    const payload = this.conditionPayload(condition);
    const operator = this.operatorLabels[payload.operator] || payload.operator;
    return `${this.fieldLabel(payload.field)} ${operator} ${this.conditionValueLabel(payload.field, payload.value)}`;
  }

  private actionLabel(action: DiscountRuleAction): string {
    const target = action.applyTo === 'service' ? 'selected services' : action.applyTo === 'category' ? 'selected categories' : 'cart';
    if (action.type === 'percent') return `${Number(action.value || 0)}% off ${target}`;
    if (action.type === 'flat') return `${this.moneyLabel(action.value)} off ${target}`;
    return `${target} bundle price ${this.moneyLabel(action.value)}`;
  }

  private conditionValueLabel(field: string, value: unknown): string {
    if (field === 'occupancyRate') return `${Math.round(Number(value || 0) * 100)}%`;
    if (field === 'cartTotalPaise') return this.moneyLabel(value);
    if ((field === 'timeRange' || field === 'dateRange') && value && typeof value === 'object') {
      const range = value as { start?: string; end?: string; from?: string; to?: string };
      return field === 'timeRange' ? `${range.start}-${range.end}` : `${range.from || 'start'} to ${range.to || 'end'}`;
    }
    return Array.isArray(value) ? value.join(', ') : String(value ?? '-');
  }

  private sampleContext(): Record<string, unknown> {
    return {
      groupSize: Number(this.sample.groupSize || 1),
      occupancyRate: Math.max(0, Number(this.sample.occupancyPercent || 0)) / 100,
      clientSegment: this.sample.clientSegment,
      weatherCondition: this.sample.weatherCondition,
      staffId: this.sample.staffId,
      cartItems: [
        {
          serviceId: this.sample.serviceId,
          category: this.sample.category,
          pricePaise: this.rupeesToPaise(this.sample.cartTotalRupees),
          qty: 1
        }
      ]
    };
  }

  private ruleConditions(rule: DiscountRule): DiscountRuleCondition[] {
    if (Array.isArray(rule.conditionsJson)) return rule.conditionsJson;
    if (Array.isArray(rule.conditions)) return rule.conditions;
    return this.parseJson<DiscountRuleCondition[]>(rule.conditions, []);
  }

  private ruleAction(rule: DiscountRule): DiscountRuleAction {
    if (rule.actionJson && typeof rule.actionJson === 'object') return rule.actionJson;
    if (rule.action && typeof rule.action === 'object') return rule.action;
    return this.parseJson<DiscountRuleAction>(rule.action, { type: 'percent', value: 10, applyTo: 'cart', targetIds: [] });
  }

  private textOrList(text: string, operator: string): string | string[] {
    const values = this.csv(text);
    return operator === 'in' ? values : values[0] || '';
  }

  private csv(text: string): string[] {
    return String(text || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private rupeesToPaise(value: unknown): number {
    return Math.max(0, Math.round(Number(value || 0) * 100));
  }

  private paiseToRupees(value: number): number {
    return Math.round(Number(value || 0)) / 100;
  }

  private moneyLabel(valuePaise: unknown): string {
    return `Rs ${this.paiseToRupees(Number(valuePaise || 0))}`;
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
