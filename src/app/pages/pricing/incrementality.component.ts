import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../../core/api.service';

type SegmentCount = {
  segment: string;
  count: number;
};

type AssignmentSummary = {
  assignment: string;
  totalAssigned: number;
  resolved: number;
  bookings: number;
  revenuePaise: number;
  discountSpentPaise: number;
};

type IncrementalityReport = ApiRecord & {
  offerType: string;
  treatment: AssignmentSummary;
  holdout: AssignmentSummary;
  treatmentBookingRate: number;
  holdoutBookingRate: number;
  incrementalLift: number;
  incrementalBookings: number;
  discountSpentPaise: number;
  trueIncrementalRevenuePaise: number;
  wastedDiscountPaise: number;
  trueROI: number | null;
  apparentROI: number | null;
  segments: SegmentCount[];
  readiness: {
    readyForUpliftModel: boolean;
    resolvedOutcomes: number;
    minimumTreatmentOutcomes: number;
    minimumHoldoutOutcomes: number;
    note: string;
  };
};

@Component({
  selector: 'app-pricing-incrementality',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './incrementality.component.html',
  styleUrls: ['./incrementality.component.css']
})
export class PricingIncrementalityComponent implements OnInit {
  readonly report = signal<IncrementalityReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  filters = {
    offerType: 'happy_hours',
    from: '',
    to: ''
  };

  readonly segmentLabels: Record<string, string> = {
    persuadable: 'Persuadable',
    sure_thing: 'Sure thing',
    lost_cause: 'Lost cause',
    sleeping_dog: 'Sleeping dog'
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<IncrementalityReport>('pricing/incrementality-report', this.filters).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load incrementality report'));
        this.loading.set(false);
      }
    });
  }

  formatMoney(value: unknown): string {
    return `Rs ${(Math.round(Number(value || 0)) / 100).toLocaleString('en-IN')}`;
  }

  formatPercent(value: unknown): string {
    return `${(Number(value || 0) * 100).toFixed(1)}%`;
  }

  formatRoi(value: unknown): string {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(2)}x` : 'Collecting';
  }

  segmentLabel(segment: string): string {
    return this.segmentLabels[segment] || segment.replace(/_/g, ' ');
  }

  segmentPercent(count: number): number {
    const total = this.segmentTotal();
    return total ? Math.round((Number(count || 0) / total) * 100) : 0;
  }

  segmentTotal(): number {
    return (this.report()?.segments || []).reduce((total, item) => total + Number(item.count || 0), 0);
  }

  recommendation(): string {
    const report = this.report();
    if (!report) return '';
    if (!report.treatment.resolved && !report.holdout.resolved) return 'Start treatment/holdout capture before uplift training.';
    if (!report.readiness.readyForUpliftModel) return 'Keep collecting resolved outcomes before enabling uplift model training.';
    if (report.incrementalLift <= 0) return 'Pause broad offers and target only clients with positive uplift.';
    return 'Offer is showing positive causal lift. Keep holdout active and watch margin.';
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
