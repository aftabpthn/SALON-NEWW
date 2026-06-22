import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../../core/api.service';

type ReadinessStatus = 'ready' | 'collecting' | 'blocked' | 'premature';

type ReadinessModule = ApiRecord & {
  code: string;
  name: string;
  score: number;
  status: ReadinessStatus;
  gate: string;
  evidence: string;
  nextAction: string;
  advancedOption: string;
  route?: string | null;
};

type RoadmapChoice = {
  code?: string;
  title: string;
  reason: string;
  trigger?: string;
  status?: ReadinessStatus;
  route?: string | null;
  priority?: number;
};

type TenantSample = ApiRecord & {
  tenantId: string;
  tenantName: string;
  status: string;
  subscriptionStatus: string;
  invoices: number;
  appointments: number;
  demandSignals: number;
  branches: number;
  activeSubscription: boolean;
  payingSignal: boolean;
};

type ReadinessReport = ApiRecord & {
  generatedAt: string;
  readinessScore: number;
  counts: Record<string, number>;
  nextBest: RoadmapChoice;
  roadmap: RoadmapChoice[];
  advancedBest: RoadmapChoice;
  modules: ReadinessModule[];
  platform: ApiRecord;
  tenantSamples: TenantSample[];
  source: ApiRecord;
};

@Component({
  selector: 'app-level6-readiness',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './level6-readiness.component.html',
  styleUrls: ['./level6-readiness.component.css']
})
export class Level6ReadinessComponent implements OnInit {
  readonly report = signal<ReadinessReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ReadinessReport>('pricing/level6-readiness').subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load Level 6 readiness'));
        this.loading.set(false);
      }
    });
  }

  countFor(status: ReadinessStatus): number {
    return Number(this.report()?.counts?.[status] || 0);
  }

  statusLabel(status: ReadinessStatus): string {
    return status.replace(/_/g, ' ');
  }

  moduleClass(item: ReadinessModule): string {
    return `module-card ${item.status}`;
  }

  statusClass(status: string | undefined): string {
    return `status-pill ${status || 'blocked'}`;
  }

  scoreWidth(score: unknown): number {
    return Math.max(0, Math.min(100, Math.round(Number(score || 0))));
  }

  generatedAt(): string {
    const value = this.report()?.generatedAt;
    return value ? new Date(value).toLocaleString() : '-';
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
