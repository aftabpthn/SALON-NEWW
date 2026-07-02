import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-offline-billing-protection',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Offline Billing Protection</h2>
        </div>
        <button class="ghost-button" type="button" (click)="loadLists()">Refresh lists</button>
      </div>
      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="dashboard-grid">
        <section class="form-panel">
          <h3>Create protected offline bill</h3>
          <form [formGroup]="billingForm" (ngSubmit)="offlineBilling()">
            <label class="field"><span>Client</span><select formControlName="clientId"><option *ngFor="let client of clients()" [value]="client.id">{{ client.name }}</option></select></label>
            <label class="field"><span>Service</span><select formControlName="serviceId"><option *ngFor="let service of services()" [value]="service.id">{{ service.name }}</option></select></label>
            <label class="field"><span>Branch</span><select formControlName="branchId"><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select></label>
            <label class="field"><span>Payment mode</span><select formControlName="mode"><option value="upi">UPI</option><option value="cash">Cash</option><option value="card">Card</option></select></label>
            <div class="form-actions"><button class="primary-button" type="submit" [disabled]="billingForm.invalid">Queue protected bill</button></div>
          </form>
        </section>
        <section class="panel">
          <div class="section-title"><h2>Protection checks</h2></div>
          <div class="quick-grid">
            <article class="action-card aura-card aura-card--type-action" *ngFor="let check of checks"><strong>{{ check }}</strong><span>Checked during offline billing workflow.</span></article>
          </div>
        </section>
      </div>
      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `
})
export class OfflineBillingProtectionComponent implements OnInit {
  readonly branches = signal<ApiRecord[]>([]);
  readonly clients = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly checks = ['Offline invoice number reserve', 'Duplicate invoice detection', 'Payment mode risk flag', 'Cash drawer offline session', 'Inventory deduction pending marker', 'Final invoice lock after sync'];
  readonly billingForm = this.fb.group({ clientId: ['', Validators.required], serviceId: ['', Validators.required], branchId: ['', Validators.required], mode: ['upi'] });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}
  ngOnInit(): void { this.loadLists(); }

  loadLists(): void {
    this.loading.set(true);
    this.api.list<ApiRecord[]>('branches').subscribe((rows) => { this.branches.set(rows); if (rows[0]) this.billingForm.patchValue({ branchId: rows[0].id }); });
    this.api.list<ApiRecord[]>('clients').subscribe((rows) => { this.clients.set(rows); if (rows[0]) this.billingForm.patchValue({ clientId: rows[0].id }); });
    this.api.list<ApiRecord[]>('services').subscribe({
      next: (rows) => { this.services.set(rows); if (rows[0]) this.billingForm.patchValue({ serviceId: rows[0].id }); this.loading.set(false); },
      error: (error) => { this.error.set(this.api.errorText(error)); this.loading.set(false); }
    });
  }

  offlineBilling(): void {
    const service = this.services().find((item) => item.id === this.billingForm.value.serviceId);
    this.api.post<ApiRecord>('offline/billing', {
      clientId: this.billingForm.value.clientId,
      branchId: this.billingForm.value.branchId,
      items: [{ type: 'service', id: service?.id, quantity: 1, price: service?.price }],
      payments: [{ mode: this.billingForm.value.mode, amount: service?.price || 0 }]
    }).subscribe({
      next: (response) => this.result.set(response),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }
}
