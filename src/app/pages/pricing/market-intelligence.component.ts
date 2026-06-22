import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../../core/api.service';

type Competitor = ApiRecord & {
  id: number;
  competitorName: string;
  distance?: number | null;
  source: string;
  priceCount?: number;
  lastObservedDate?: string | null;
};

type PriceObservation = ApiRecord & {
  id: number;
  competitorId: number;
  competitorName: string;
  serviceCategory: string;
  pricePaise: number;
  observedDate: string;
  source?: string;
};

type MarketPosition = ApiRecord & {
  serviceCategory: string;
  avgPaise: number;
  minPaise: number;
  maxPaise: number;
  competitorCount: number;
  observationCount: number;
  ourPricePaise: number;
  ourEffectivePricePaise: number;
  baseDiscountPercent: number;
  position: 'unknown' | 'above_market' | 'at_market' | 'below_market';
  priceGapPercent: number;
  recommendedDiscountPercent: number;
  note: string;
  observations: PriceObservation[];
};

type MarketRuleSuggestion = ApiRecord & {
  eligible: boolean;
  reason: string;
  serviceCategory: string;
  recommendedDiscountPercent: number;
  previewSentence: string;
  guardrails: string[];
  rulePayload: ApiRecord | null;
  marketPosition: MarketPosition;
};

type DraftRuleResult = ApiRecord & {
  suggestion: MarketRuleSuggestion;
  rule: ApiRecord & {
    id: number;
    name: string;
    status: string;
  };
};

@Component({
  selector: 'app-market-intelligence',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './market-intelligence.component.html',
  styleUrls: ['./market-intelligence.component.css']
})
export class MarketIntelligenceComponent implements OnInit {
  readonly competitors = signal<Competitor[]>([]);
  readonly prices = signal<PriceObservation[]>([]);
  readonly marketPosition = signal<MarketPosition | null>(null);
  readonly ruleSuggestion = signal<MarketRuleSuggestion | null>(null);
  readonly draftRule = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly suggesting = signal(false);
  readonly creatingDraft = signal(false);
  readonly error = signal('');

  competitorForm = {
    competitorName: '',
    distance: 1,
    source: 'manual'
  };

  priceForm = {
    competitorId: '',
    serviceCategory: 'haircut',
    priceRupees: 1000,
    observedDate: this.today()
  };

  positionForm = {
    serviceCategory: 'haircut',
    ourPriceRupees: 1200,
    baseDiscountPercent: 0
  };

  readonly sources = ['manual', 'google', 'aggregator'];
  readonly serviceCategories = ['haircut', 'color', 'spa', 'facial', 'manicure', 'package'];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loadCompetitors();
    this.loadPrices();
    this.loadPosition();
  }

  loadCompetitors(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<{ rows: Competitor[] }>('pricing/competitors').subscribe({
      next: (result) => {
        this.competitors.set(result.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load competitors'));
        this.loading.set(false);
      }
    });
  }

  loadPrices(): void {
    this.api.list<{ rows: PriceObservation[] }>('pricing/competitor-prices', {
      serviceCategory: this.positionForm.serviceCategory
    }).subscribe({
      next: (result) => this.prices.set(result.rows || []),
      error: (error) => this.error.set(this.errorText(error, 'Unable to load competitor prices'))
    });
  }

  loadPosition(): void {
    this.error.set('');
    this.api.list<MarketPosition>('pricing/market-position', {
      serviceCategory: this.positionForm.serviceCategory,
      ourPricePaise: this.rupeesToPaise(this.positionForm.ourPriceRupees),
      baseDiscountPercent: this.positionForm.baseDiscountPercent
    }).subscribe({
      next: (result) => {
        this.marketPosition.set(result);
        this.loadRuleSuggestion();
      },
      error: (error) => this.error.set(this.errorText(error, 'Unable to load market position'))
    });
  }

  loadRuleSuggestion(): void {
    this.suggesting.set(true);
    this.draftRule.set(null);
    this.api.post<MarketRuleSuggestion>('pricing/market-rule-suggestion', this.marketRulePayload()).subscribe({
      next: (result) => {
        this.ruleSuggestion.set(result);
        this.suggesting.set(false);
      },
      error: (error) => {
        this.ruleSuggestion.set(null);
        this.error.set(this.errorText(error, 'Unable to build market rule suggestion'));
        this.suggesting.set(false);
      }
    });
  }

  createDraftRule(): void {
    if (!this.ruleSuggestion()?.eligible) return;
    this.creatingDraft.set(true);
    this.error.set('');
    this.api.post<DraftRuleResult>('pricing/market-rule-suggestion/draft', this.marketRulePayload()).subscribe({
      next: (result) => {
        this.draftRule.set(result.rule);
        this.ruleSuggestion.set(result.suggestion);
        this.creatingDraft.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to create draft discount rule'));
        this.creatingDraft.set(false);
      }
    });
  }

  createCompetitor(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.create<Competitor>('pricing/competitors', this.competitorForm).subscribe({
      next: (competitor) => {
        this.competitorForm = { competitorName: '', distance: 1, source: 'manual' };
        this.priceForm.competitorId = String(competitor.id);
        this.saving.set(false);
        this.loadCompetitors();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to add competitor'));
        this.saving.set(false);
      }
    });
  }

  recordPrice(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.create<PriceObservation>('pricing/competitor-prices', {
      competitorId: Number(this.priceForm.competitorId),
      serviceCategory: this.priceForm.serviceCategory,
      pricePaise: this.rupeesToPaise(this.priceForm.priceRupees),
      observedDate: this.priceForm.observedDate
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.loadPrices();
        this.loadPosition();
        this.loadCompetitors();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to record competitor price'));
        this.saving.set(false);
      }
    });
  }

  syncServiceCategory(): void {
    this.priceForm.serviceCategory = this.positionForm.serviceCategory;
    this.ruleSuggestion.set(null);
    this.draftRule.set(null);
    this.loadPrices();
    this.loadPosition();
  }

  formatMoney(value: unknown): string {
    return `Rs ${(Math.round(Number(value || 0)) / 100).toLocaleString('en-IN')}`;
  }

  formatGap(value: unknown): string {
    const numeric = Number(value || 0);
    return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(1)}%`;
  }

  positionLabel(value: string): string {
    return value.replace(/_/g, ' ');
  }

  sourceLabel(value: string): string {
    return value.replace(/_/g, ' ');
  }

  private marketRulePayload(): ApiRecord {
    return {
      serviceCategory: this.positionForm.serviceCategory,
      ourPricePaise: this.rupeesToPaise(this.positionForm.ourPriceRupees),
      baseDiscountPercent: this.positionForm.baseDiscountPercent
    };
  }

  private rupeesToPaise(value: unknown): number {
    return Math.max(0, Math.round(Number(value || 0) * 100));
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
