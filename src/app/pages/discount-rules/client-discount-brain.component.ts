import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

@Component({
  selector: 'app-client-discount-brain',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './client-discount-brain.component.html',
  styleUrls: ['./client-discount-brain.component.css']
})
export class ClientDiscountBrainComponent implements OnInit {
  readonly loading = signal(false);
  readonly recording = signal(false);
  readonly error = signal('');
  readonly decision = signal<ApiRecord | null>(null);
  readonly topClients = signal<ApiRecord[]>([]);
  readonly atRiskClients = signal<ApiRecord[]>([]);
  readonly history = signal<ApiRecord[]>([]);

  form = {
    clientId: 1,
    serviceCategory: 'default',
    cartTotalPaise: 250000,
    baseDiscountPercent: 10
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.loadLists();
    this.evaluate();
  }

  evaluate(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord>('happy-hours-client-brain/evaluate', this.form).subscribe({
      next: (decision) => {
        this.decision.set(decision);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to evaluate client discount'));
        this.loading.set(false);
      }
    });
  }

  recordDecision(): void {
    this.recording.set(true);
    this.error.set('');
    this.api.post<{ decision: ApiRecord }>('happy-hours-client-brain/decisions', this.form).subscribe({
      next: (result) => {
        this.decision.set(result.decision);
        this.recording.set(false);
        this.loadLists();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to record decision'));
        this.recording.set(false);
      }
    });
  }

  useClient(client: ApiRecord): void {
    this.form.clientId = Number(client.clientId || 0);
    this.evaluate();
  }

  formatMoney(value: unknown): string {
    return `Rs ${(Math.round(Number(value || 0)) / 100).toLocaleString('en-IN')}`;
  }

  pct(value: unknown): string {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  label(value: unknown): string {
    return String(value || '').replace(/_/g, ' ');
  }

  private loadLists(): void {
    forkJoin({
      top: this.api.list<{ rows: ApiRecord[] }>('happy-hours-client-brain/top-clv', { limit: 8 }),
      risk: this.api.list<{ rows: ApiRecord[] }>('happy-hours-client-brain/at-risk', { limit: 8 }),
      history: this.api.list<{ rows: ApiRecord[] }>('happy-hours-client-brain/decisions', { limit: 8 })
    }).subscribe({
      next: (result) => {
        this.topClients.set(result.top.rows || []);
        this.atRiskClients.set(result.risk.rows || []);
        this.history.set(result.history.rows || []);
      },
      error: () => undefined
    });
  }
}
