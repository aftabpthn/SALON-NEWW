import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

type ScenarioKey =
  | 'serviceDiscount' | 'addSlots' | 'membershipPrice' | 'servicePriceChange'
  | 'staffScheduleAdjustment' | 'inventoryReorderQuantity' | 'clientRetentionOffer'
  | 'branchImprovementPlan';

/** One projected quantity. Every figure is a range — the service never returns a single number. */
type ImpactRange = { label: string; baseline: string; lower: string; upper: string; unit: string; direction: string };

type WhatIfResult = {
  scenario: string; headline: string;
  facts: string[]; assumptions: string[]; impacts: ImpactRange[];
  reason: string; confidence: string; warnings: string[];
  governanceDecision: string; governanceReasons: string[];
  readOnly: boolean; baselinePeriodDays: number; dataSufficient: boolean;
  nextStep: string; nextStepLink: string;
};

/** `required` mirrors the Rust variant: a field without `#[serde(default)]` must be sent. */
type Field = { key: string; label: string; hint?: string; type: 'number' | 'text'; value: string; required?: boolean };
type Scenario = { key: ScenarioKey; title: string; question: string; icon: string; fields: Field[] };

/**
 * Read-only what-if simulation.
 *
 * `ai_what_if_service` has been shipped and tested with no way to reach it —
 * 1,679 lines answering "what would happen if", behind an endpoint nothing
 * called.
 *
 * The layout follows the shape the service already argues for. It keeps facts,
 * assumptions and impacts in three separate blocks because the service returns
 * them separately and says why: a fact is read from the CRM, an assumption is
 * the part the reader is entitled to disagree with, and an impact is an
 * estimate. Flattening them into one list would lose the only thing that makes
 * a projection safe to act on.
 *
 * Every impact is a range. The service never returns a single number, because
 * a single number reads as a promise the data cannot support, and this page
 * never collapses one into an average for tidiness.
 */
@Component({
  selector: 'page-what-if',
  imports: [CommonModule, FormsModule],
  templateUrl: './what-if-page.component.html',
  styleUrls: ['./what-if-page.component.css'],
})
export class WhatIfPageComponent {
  private readonly api = inject(ApiService);

  /** The eight scenarios the service accepts, with the inputs each one takes. */
  readonly scenarios: Scenario[] = [
    {
      key: 'serviceDiscount', title: 'Service discount', icon: 'bi-tag',
      question: 'What would a discount do to profit?',
      fields: [
        { key: 'serviceId', label: 'Service id', hint: 'Leave empty for the whole branch', type: 'text', value: '' },
        { key: 'discountPercent', label: 'Discount %', type: 'number', value: '10' },
      ],
    },
    {
      key: 'servicePriceChange', title: 'Service price change', icon: 'bi-currency-rupee',
      question: 'What would raising or cutting this price do?',
      fields: [
        { key: 'serviceId', label: 'Service id', type: 'text', value: '', required: true },
        { key: 'changePercent', label: 'Change %', hint: 'Negative to cut the price', type: 'number', value: '5' },
      ],
    },
    {
      key: 'addSlots', title: 'Add slots', icon: 'bi-calendar-plus',
      question: 'What would more appointment slots do to utilization?',
      fields: [
        { key: 'addedSlots', label: 'Slots to add', type: 'number', value: '2' },
        { key: 'weekday', label: 'Weekday', hint: '1 = Monday, 0 spreads across the week', type: 'number', value: '0' },
        { key: 'slotMinutes', label: 'Minutes per slot', hint: '0 uses a standard appointment', type: 'number', value: '0' },
      ],
    },
    {
      key: 'membershipPrice', title: 'Membership price', icon: 'bi-gem',
      question: 'What would a price change do to renewals?',
      fields: [{ key: 'changePercent', label: 'Change %', hint: 'Negative to cut the price', type: 'number', value: '10' }],
    },
    {
      key: 'staffScheduleAdjustment', title: 'Roster hours', icon: 'bi-person-workspace',
      question: 'What would adding or removing rostered hours do to capacity?',
      fields: [
        { key: 'changeHours', label: 'Change in hours', hint: 'Negative removes hours', type: 'number', value: '8' },
        { key: 'staffId', label: 'Staff id', hint: 'Leave empty for the whole branch', type: 'text', value: '' },
      ],
    },
    {
      key: 'inventoryReorderQuantity', title: 'Reorder quantity', icon: 'bi-box-seam',
      question: 'What would ordering this quantity do to cover and cash?',
      fields: [
        { key: 'inventoryItemId', label: 'Inventory item id', type: 'text', value: '', required: true },
        { key: 'orderQuantity', label: 'Order quantity', type: 'number', value: '10' },
      ],
    },
    {
      key: 'clientRetentionOffer', title: 'Win-back offer', icon: 'bi-arrow-counterclockwise',
      question: 'What would a win-back offer to lapsing clients be worth?',
      fields: [
        { key: 'discountPercent', label: 'Discount %', type: 'number', value: '15' },
        { key: 'expectedUptakePercent', label: 'Expected uptake %', hint: 'Share of contacted clients expected to return', type: 'number', value: '20' },
      ],
    },
    {
      key: 'branchImprovementPlan', title: 'Branch improvement', icon: 'bi-graph-up-arrow',
      question: 'What would closing the gap to the best branch be worth?',
      fields: [{ key: 'targetGapClosedPercent', label: 'Gap to close %', type: 'number', value: '50' }],
    },
  ];

  selected: Scenario = this.scenarios[0];
  busy = false; error = ''; result?: WhatIfResult;

  /** Whether every field the service has no default for has been filled. */
  get ready() {
    return this.selected.fields.every((field) => !field.required || field.value.trim().length > 0);
  }

  select(scenario: Scenario) {
    if (this.selected.key === scenario.key) return;
    this.selected = scenario;
    // The previous result answered a different question; leaving it on screen
    // beside a new form invites reading it as this scenario's answer.
    this.result = undefined;
    this.error = '';
  }

  async run() {
    this.busy = true; this.error = '';
    const body: Record<string, unknown> = { scenario: this.selected.key };
    for (const field of this.selected.fields) {
      const raw = field.value.trim();
      body[field.key] = field.type === 'number' ? Number(raw || 0) : raw;
    }
    try {
      this.result = await this.post<WhatIfResult>('/ai/what-if', body);
    } catch (error) {
      this.result = undefined;
      this.error = this.errorMessage(error, 'The simulation could not be run');
    } finally { this.busy = false; }
  }

  label(value?: string) { return value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : '—'; }
  /** An arrow that matches the service's own `direction`, so nothing is inferred from the numbers here. */
  directionIcon(direction: string) {
    if (direction === 'up') return 'bi-arrow-up-right';
    if (direction === 'down') return 'bi-arrow-down-right';
    return 'bi-dash';
  }

  private async post<T>(path: string, body: unknown) {
    const response = await firstValueFrom(this.api.post<ApiEnvelope<T>>(path, body));
    if (response.data === undefined) throw new Error(response.error?.message || 'API response missing data');
    return response.data;
  }
  private errorMessage(error: unknown, fallback: string) {
    const body = (error as { error?: { error?: { message?: string } } })?.error?.error?.message;
    if (typeof body === 'string' && body.trim()) return body;
    return error instanceof Error && error.message ? error.message : fallback;
  }
}
