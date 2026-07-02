import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-offline-appointment-protection',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Offline Appointment Protection</h2>
        </div>
        <button class="ghost-button" type="button" (click)="loadLists()">Refresh lists</button>
      </div>
      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="dashboard-grid">
        <section class="form-panel">
          <h3>Create protected offline appointment</h3>
          <form [formGroup]="appointmentForm" (ngSubmit)="offlineAppointment()">
            <label class="field"><span>Client</span><select formControlName="clientId"><option *ngFor="let client of clients()" [value]="client.id">{{ client.name }}</option></select></label>
            <label class="field"><span>Service</span><select formControlName="serviceId"><option *ngFor="let service of services()" [value]="service.id">{{ service.name }}</option></select></label>
            <label class="field"><span>Branch</span><select formControlName="branchId"><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select></label>
            <label class="field"><span>Start</span><input type="datetime-local" formControlName="startAt" /></label>
            <div class="form-actions"><button class="primary-button" type="submit" [disabled]="appointmentForm.invalid">Queue protected appointment</button></div>
          </form>
        </section>
        <section class="panel">
          <div class="section-title"><h2>Protection checks</h2></div>
          <div class="quick-grid">
            <article class="action-card aura-card aura-card--type-action" *ngFor="let check of checks"><strong>{{ check }}</strong><span>Shown before final sync to reduce conflict risk.</span></article>
          </div>
        </section>
      </div>
      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `
})
export class OfflineAppointmentProtectionComponent implements OnInit {
  readonly branches = signal<ApiRecord[]>([]);
  readonly clients = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly checks = ['Slot hold simulation', 'Conflict warning before sync', 'Staff availability cache', 'Service duration validation', 'Duplicate client booking warning'];
  readonly appointmentForm = this.fb.group({ clientId: ['', Validators.required], serviceId: ['', Validators.required], branchId: ['', Validators.required], startAt: [this.defaultLocalTime(), Validators.required] });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}
  ngOnInit(): void { this.loadLists(); }

  loadLists(): void {
    this.loading.set(true);
    this.api.list<ApiRecord[]>('branches').subscribe((rows) => { this.branches.set(rows); if (rows[0]) this.appointmentForm.patchValue({ branchId: rows[0].id }); });
    this.api.list<ApiRecord[]>('clients').subscribe((rows) => { this.clients.set(rows); if (rows[0]) this.appointmentForm.patchValue({ clientId: rows[0].id }); });
    this.api.list<ApiRecord[]>('services').subscribe({
      next: (rows) => { this.services.set(rows); if (rows[0]) this.appointmentForm.patchValue({ serviceId: rows[0].id }); this.loading.set(false); },
      error: (error) => { this.error.set(this.api.errorText(error)); this.loading.set(false); }
    });
  }

  offlineAppointment(): void {
    const value = this.appointmentForm.value;
    this.api.post<ApiRecord>('offline/appointments', {
      ...value,
      serviceIds: [value.serviceId],
      startAt: new Date(value.startAt).toISOString()
    }).subscribe({
      next: (response) => this.result.set(response),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  defaultLocalTime(): string {
    const date = new Date(Date.now() + 3 * 60 * 60 * 1000);
    date.setMinutes(0, 0, 0);
    return date.toISOString().slice(0, 16);
  }
}
