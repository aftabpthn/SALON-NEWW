import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

type LifecycleRow = ApiRecord & {
  id: number;
  title: string;
  objective: string;
  stage: string;
  ruleId?: number | null;
  couponId?: number | null;
  budgetPaise: number;
  targetRevenuePaise: number;
  targetApplications: number;
  validFrom?: string | null;
  validTo?: string | null;
  roiScore: ApiRecord;
};

@Component({
  selector: 'app-offer-lifecycle',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './offer-lifecycle.component.html',
  styleUrls: ['./offer-lifecycle.component.css']
})
export class OfferLifecycleComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly summary = signal<ApiRecord | null>(null);
  readonly lifecycles = signal<LifecycleRow[]>([]);
  readonly roiScores = signal<ApiRecord[]>([]);

  readonly stages = ['idea', 'draft', 'pending_approval', 'approved', 'live', 'paused', 'completed', 'archived'];
  filters = {
    from: '',
    to: '',
    stage: ''
  };
  lifecycleForm: ApiRecord = {
    title: 'Weekday slow hour lifecycle',
    objective: 'Increase off-peak bookings without hurting margin',
    stage: 'idea',
    ruleId: '',
    couponId: '',
    budgetPaise: 500000,
    targetRevenuePaise: 2500000,
    targetApplications: 25,
    validFrom: this.today(),
    validTo: this.today(),
    ownerRole: 'manager'
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const params = this.params();
    forkJoin({
      summary: this.api.list<ApiRecord>('happy-hours-lifecycle/summary', params),
      lifecycles: this.api.list<{ rows: LifecycleRow[] }>('happy-hours-lifecycle', params),
      roiScores: this.api.list<{ rows: ApiRecord[] }>('happy-hours-lifecycle/roi-scores', params)
    }).subscribe({
      next: (result) => {
        this.summary.set(result.summary);
        this.lifecycles.set(result.lifecycles.rows || []);
        this.roiScores.set(result.roiScores.rows || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load offer lifecycle'));
        this.loading.set(false);
      }
    });
  }

  createLifecycle(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<LifecycleRow>('happy-hours-lifecycle', this.cleanPayload(this.lifecycleForm)).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to create lifecycle'));
        this.saving.set(false);
      }
    });
  }

  move(row: LifecycleRow, stage: string): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<LifecycleRow>(`happy-hours-lifecycle/${row.id}/transition`, {
      stage,
      stageReason: `Moved from ${row.stage} to ${stage}`
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to move lifecycle stage'));
        this.saving.set(false);
      }
    });
  }

  nextStage(row: LifecycleRow): string {
    const index = this.stages.indexOf(row.stage);
    return this.stages[Math.min(this.stages.length - 1, Math.max(0, index) + 1)] || row.stage;
  }

  previousStage(row: LifecycleRow): string {
    const index = this.stages.indexOf(row.stage);
    return this.stages[Math.max(0, index - 1)] || row.stage;
  }

  stageRows(stage: string): LifecycleRow[] {
    return this.lifecycles().filter((row) => row.stage === stage);
  }

  formatMoney(value: unknown): string {
    return `Rs ${(Math.round(Number(value || 0)) / 100).toLocaleString('en-IN')}`;
  }

  pct(value: unknown): string {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  stageLabel(value: string): string {
    return value.replace(/_/g, ' ');
  }

  scoreClass(score: unknown): string {
    const value = Number(score || 0);
    if (value >= 80) return 'score-excellent';
    if (value >= 60) return 'score-good';
    if (value >= 40) return 'score-watch';
    return 'score-poor';
  }

  private params(): ApiRecord {
    return {
      from: this.filters.from,
      to: this.filters.to,
      stage: this.filters.stage
    };
  }

  private cleanPayload(value: ApiRecord): ApiRecord {
    return {
      ...value,
      ruleId: value.ruleId || null,
      couponId: value.couponId || null,
      budgetPaise: Math.max(0, Math.round(Number(value.budgetPaise || 0))),
      targetRevenuePaise: Math.max(0, Math.round(Number(value.targetRevenuePaise || 0))),
      targetApplications: Math.max(0, Math.round(Number(value.targetApplications || 0)))
    };
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
