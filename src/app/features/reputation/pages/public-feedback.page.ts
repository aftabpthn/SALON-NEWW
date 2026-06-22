import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { environment } from '../../../../environments/environment';

type PublicReviewRequest = {
  id: string;
  branchName: string;
  customerName: string;
  appointmentStartAt: string;
  submitted: boolean;
  submittedReviewId: string;
};

@Component({
  selector: 'app-public-feedback',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <main class="feedback-page">
      <section class="panel">
        <p class="eyebrow">Aura Salon Feedback</p>
        <h1>{{ request()?.submitted ? 'Feedback received' : 'How was your visit?' }}</h1>
        <p class="lead" *ngIf="request() as item">
          {{ item.customerName || 'Guest' }} · {{ item.branchName || 'Aura Salon' }}
        </p>

        <div class="state error" *ngIf="error()">{{ error() }}</div>
        <div class="state" *ngIf="loading()">Loading feedback link...</div>
        <div class="state success" *ngIf="message()">{{ message() }}</div>

        <form *ngIf="request() && !request()?.submitted && !message()" [formGroup]="form" (ngSubmit)="submit()">
          <label class="field">
            <span>Rating</span>
            <select formControlName="rating">
              <option [ngValue]="5">5 - Excellent</option>
              <option [ngValue]="4">4 - Good</option>
              <option [ngValue]="3">3 - Okay</option>
              <option [ngValue]="2">2 - Not good</option>
              <option [ngValue]="1">1 - Bad experience</option>
            </select>
          </label>

          <label class="field">
            <span>Your name</span>
            <input formControlName="reviewerName" />
          </label>

          <label class="field">
            <span>Feedback</span>
            <textarea rows="5" formControlName="feedback" placeholder="Tell us what went well or what we should fix"></textarea>
          </label>

          <button class="primary" type="submit" [disabled]="saving() || form.invalid">
            {{ saving() ? 'Submitting...' : 'Submit feedback' }}
          </button>
        </form>

        <div class="state success" *ngIf="request()?.submitted && !message()">
          Feedback has already been submitted for this link. Thank you.
        </div>
      </section>
    </main>
  `,
  styles: [`
    .feedback-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f4f7f8; color: #101827; }
    .panel { width: min(560px, 100%); background: #fff; border: 1px solid #d9e2e7; border-radius: 8px; padding: 24px; box-shadow: 0 18px 45px rgba(15,23,42,.08); }
    .eyebrow { color: #0f766e; font-size: 12px; font-weight: 900; letter-spacing: .08em; margin: 0 0 8px; text-transform: uppercase; }
    h1 { font-size: 28px; line-height: 1.15; margin: 0 0 8px; }
    .lead { color: #475569; margin: 0 0 20px; }
    form { display: grid; gap: 14px; }
    .field { display: grid; gap: 7px; font-weight: 800; }
    input, select, textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; color: #111827; font: inherit; padding: 11px 12px; }
    textarea { resize: vertical; }
    .primary { border: 0; border-radius: 8px; background: #0f766e; color: #fff; cursor: pointer; font-weight: 900; min-height: 44px; padding: 0 16px; }
    .primary:disabled { cursor: not-allowed; opacity: .65; }
    .state { border-radius: 8px; margin: 12px 0; padding: 12px; background: #eef4f4; color: #334155; }
    .state.success { background: #ecfdf5; color: #166534; }
    .state.error { background: #fef2f2; color: #991b1b; }
  `]
})
export class PublicFeedbackPage implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly request = signal<PublicReviewRequest | null>(null);
  readonly error = signal('');
  readonly message = signal('');

  readonly form = this.fb.group({
    rating: [5, [Validators.required, Validators.min(1), Validators.max(5)]],
    reviewerName: [''],
    feedback: ['', [Validators.maxLength(1200)]]
  });

  private requestId = '';
  private invoiceId = '';

  constructor(
    private readonly fb: FormBuilder,
    private readonly http: HttpClient,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.requestId = this.route.snapshot.queryParamMap.get('requestId') || '';
    this.invoiceId = this.route.snapshot.queryParamMap.get('invoiceId') || '';
    if (!this.requestId) {
      this.error.set('Feedback link is invalid.');
      return;
    }
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.http.get<PublicReviewRequest>(`${environment.apiBaseUrl}/reputation/public/requests/${encodeURIComponent(this.requestId)}`).subscribe({
      next: (value) => {
        this.request.set(value);
        this.form.patchValue({ reviewerName: value.customerName || '' });
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Feedback link has expired or is invalid.');
        this.loading.set(false);
      }
    });
  }

  submit(): void {
    if (this.form.invalid || !this.requestId) return;
    this.saving.set(true);
    this.error.set('');
    this.http.post(`${environment.apiBaseUrl}/reputation/public/requests/${encodeURIComponent(this.requestId)}/feedback`, {
      ...this.form.value,
      invoiceId: this.invoiceId
    }).subscribe({
      next: () => {
        this.message.set('Thank you. Your feedback has been sent to the salon team.');
        this.saving.set(false);
      },
      error: () => {
        this.error.set('Unable to submit feedback. Please retry.');
        this.saving.set(false);
      }
    });
  }
}
