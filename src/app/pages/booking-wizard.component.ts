import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type WizardStep = 1 | 2 | 3 | 4 | 5;

@Component({
  selector: 'app-booking-wizard',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, ReactiveFormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack compact-wizard inner-page-shell">
      <div class="module-hero compact-hero inner-page-header">
        <div>
          <h2>Service → Staff → Slot → Customer → Confirm</h2>
        </div>
        <div class="hero-actions inner-page-header-actions">
          <a class="ghost-button" routerLink="/book">Classic booking</a>
          <a class="ghost-button" routerLink="/appointments">Calendar</a>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="panel">
        <div class="wizard-steps">
          <button type="button" *ngFor="let item of stepList" [class.active]="step() === item.id" [class.done]="step() > item.id" (click)="goTo(item.id)">
            <span>{{ item.id }}</span>
            {{ item.label }}
          </button>
          <strong *ngIf="holdCountdown()" class="hold-timer">Slot held: {{ holdCountdown() }}</strong>
        </div>

        <form [formGroup]="wizardForm" class="wizard-form">
          <ng-container [ngSwitch]="step()">
            <div *ngSwitchCase="1" class="wizard-grid">
              <label class="field">
                <span>Branch</span>
                <select formControlName="branchId" (change)="queueStateSave()">
                  <option value="">Select branch</option>
                  <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
                </select>
              </label>
              <label class="field">
                <span>Service</span>
                <select formControlName="serviceId" (change)="resolveChain()">
                  <option value="">Select service</option>
                  <option *ngFor="let service of services()" [value]="service.id">{{ service.name }} · {{ service.price | auraMoney:'1.0-0' }}</option>
                </select>
              </label>
              <div class="summary-card aura-card" *ngIf="resolvedServices().length">
                <strong>{{ resolvedServices().length }} service item(s)</strong>
                <small *ngFor="let item of resolvedServices()">{{ serviceName(item.serviceId) }} {{ item.isAuto ? '· auto' : '' }}</small>
              </div>
            </div>

            <div *ngSwitchCase="2" class="wizard-grid">
              <label class="field">
                <span>Preferred staff</span>
                <select formControlName="staffId" (change)="queueStateSave()">
                  <option value="">Any eligible staff</option>
                  <option *ngFor="let person of staffForBranch()" [value]="person.id">{{ person.name }} · {{ person.role || 'Staff' }}</option>
                </select>
              </label>
              <label class="field">
                <span>Date</span>
                <input type="date" formControlName="date" (change)="queueStateSave()" />
              </label>
              <div class="summary-card aura-card">
                <strong>{{ staffForBranch().length }} eligible team members</strong>
              </div>
            </div>

            <div *ngSwitchCase="3">
              <div class="table-toolbar">
                <button class="primary-button" type="button" (click)="findSlots()" [disabled]="wizardForm.invalid">Find smart slots</button>
                <button class="ghost-button" type="button" (click)="releaseHold()" [disabled]="!holdId()">Release hold</button>
              </div>
              <div class="quick-grid">
                <button class="action-card command-card" type="button" *ngFor="let slot of slots()" [class.active]="selectedSlot()?.startAt === slot.startAt" (click)="selectSlot(slot)">
                  <strong>{{ slot.startAt | auraDate:'dateTime' }}</strong>
                  <span>{{ slot.staffName }} · {{ slot.chair }} · Score {{ slot.score }}</span>
                  <small>Estimated revenue {{ slot.estimatedRevenue | auraMoney:'1.0-0' }}</small>
                </button>
              </div>
              <div class="empty-state" *ngIf="!slots().length && !loading()">
                <strong>No slots loaded</strong>
                <span>Click Find smart slots to generate available times.</span>
              </div>
            </div>

            <div *ngSwitchCase="4" class="wizard-grid">
              <label class="field"><span>Client name</span><input formControlName="clientName" (input)="queueStateSave()" /></label>
              <label class="field"><span>Phone</span><input formControlName="phone" (input)="queueStateSave()" /></label>
              <label class="field"><span>Email</span><input formControlName="email" (input)="queueStateSave()" /></label>
              <label class="field">
                <span>Language</span>
                <select formControlName="preferredLanguage" (change)="queueStateSave()">
                  <option value="en">English</option>
                  <option value="hi-en">Hinglish</option>
                  <option value="hi">Hindi</option>
                  <option value="mr">Marathi</option>
                  <option value="gu">Gujarati</option>
                </select>
              </label>
            </div>

            <div *ngSwitchCase="5" class="confirm-grid">
              <article class="summary-card aura-card">
                <strong>{{ serviceName(wizardForm.value.serviceId) }}</strong>
                <small>{{ selectedSlot()?.startAt | auraDate:'date' }} with {{ selectedSlot()?.staffName || 'auto staff' }}</small>
                <small>{{ wizardForm.value.clientName }} · {{ wizardForm.value.phone }}</small>
              </article>
              <article class="summary-card aura-card">
                <strong>{{ holdId() ? 'Slot hold active' : 'No active hold' }}</strong>
              </article>
              <article class="summary-card aura-card" *ngIf="createdAppointment() as appointment">
                <strong>{{ appointment.id }}</strong>
                <small>{{ appointment.status }} · {{ appointment.startAt | auraDate:'date' }}</small>
              </article>
            </div>
          </ng-container>
        </form>

        <div class="wizard-footer">
          <button class="ghost-button" type="button" (click)="goTo(step() - 1)" [disabled]="step() === 1">Back</button>
          <button class="primary-button" type="button" *ngIf="step() < 5" (click)="goTo(step() + 1)" [disabled]="!canContinue()">Continue</button>
          <button class="primary-button" type="button" *ngIf="step() === 5" (click)="confirm()" [disabled]="!selectedSlot() || !holdId() || saving()">Confirm booking</button>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .compact-wizard { gap: 12px; }
    .compact-hero { padding: 14px 18px; }
    .hero-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .wizard-steps { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
    .wizard-steps button { border: 1px solid var(--border); background: #fff; border-radius: 999px; padding: 8px 12px; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
    .wizard-steps button span { width: 22px; height: 22px; border-radius: 999px; background: #eef5f4; display: grid; place-items: center; font-weight: 800; }
    .wizard-steps button.active { border-color: var(--teal); color: var(--teal); box-shadow: inset 0 -2px 0 var(--teal); }
    .wizard-steps button.done span { background: var(--teal); color: white; }
    .hold-timer { margin-left: auto; background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; border-radius: 999px; padding: 8px 12px; }
    .wizard-form { padding-top: 14px; }
    .wizard-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .confirm-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .summary-card { border: 1px solid var(--border); border-radius: 12px; padding: 14px; display: grid; gap: 6px; background: #fff; }
    .summary-card small { color: var(--muted); }
    .command-card.active { border-color: var(--teal); background: #F1E8EE; }
    .wizard-footer { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--border); margin-top: 14px; padding-top: 12px; }
    @media (max-width: 800px) {
      .wizard-grid, .confirm-grid { grid-template-columns: 1fr; }
      .hold-timer { margin-left: 0; }
    }
  `]
})
export class BookingWizardComponent implements OnInit, OnDestroy {
  readonly stepList: { id: WizardStep; label: string }[] = [
    { id: 1, label: 'Service' },
    { id: 2, label: 'Staff' },
    { id: 3, label: 'Slot' },
    { id: 4, label: 'Customer' },
    { id: 5, label: 'Confirm' }
  ];

  readonly context = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly step = signal<WizardStep>(1);
  readonly slots = signal<ApiRecord[]>([]);
  readonly selectedSlot = signal<ApiRecord | null>(null);
  readonly resolvedServices = signal<ApiRecord[]>([]);
  readonly holdId = signal('');
  readonly holdUntil = signal('');
  readonly holdCountdown = signal('');
  readonly createdAppointment = signal<ApiRecord | null>(null);

  readonly sessionId = this.route.snapshot.queryParamMap.get('resume') || this.newId('wiz');
  private stateTimer: number | undefined;
  private countdownTimer: number | undefined;

  readonly wizardForm = this.fb.group({
    branchId: ['', Validators.required],
    serviceId: ['', Validators.required],
    staffId: [''],
    date: [new Date().toISOString().slice(0, 10), Validators.required],
    clientName: ['', Validators.required],
    phone: ['', Validators.required],
    email: [''],
    preferredLanguage: ['hi-en']
  });

  constructor(
    private readonly api: ApiService,
    private readonly fb: UntypedFormBuilder,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.load();
    this.countdownTimer = window.setInterval(() => this.updateCountdown(), 1000);
  }

  ngOnDestroy(): void {
    if (this.stateTimer) window.clearTimeout(this.stateTimer);
    if (this.countdownTimer) window.clearInterval(this.countdownTimer);
  }

  branches(): ApiRecord[] {
    return this.context()?.branches || [];
  }

  services(): ApiRecord[] {
    return this.context()?.services || [];
  }

  staffForBranch(): ApiRecord[] {
    return (this.context()?.staff || []).filter((person: ApiRecord) => !this.wizardForm.value.branchId || person.branchId === this.wizardForm.value.branchId);
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('booking-portal/context').subscribe({
      next: (context) => {
        this.context.set(context);
        this.wizardForm.patchValue({
          branchId: context.branches?.[0]?.id || '',
          serviceId: context.services?.[0]?.id || ''
        });
        this.resolveChain();
        if (this.route.snapshot.queryParamMap.get('resume')) this.loadSavedState();
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load booking wizard');
        this.loading.set(false);
      }
    });
  }

  loadSavedState(): void {
    this.api.get<ApiRecord>('booking-wizard/state', this.sessionId).subscribe({
      next: (state) => {
        const saved = state?.state || state?.stateJson || {};
        this.step.set(Number(saved.step || state.step || 1) as WizardStep);
        this.wizardForm.patchValue(saved.form || {});
        this.selectedSlot.set(saved.selectedSlot || null);
        this.holdId.set(saved.holdId || '');
        this.holdUntil.set(saved.holdUntil || '');
      },
      error: () => undefined
    });
  }

  resolveChain(): void {
    const serviceId = this.wizardForm.value.serviceId;
    if (!serviceId) return;
    this.api.post<ApiRecord>('services/resolve-chain', { serviceIds: [serviceId] }).subscribe({
      next: (response) => {
        this.resolvedServices.set(response.services || []);
        this.queueStateSave();
      },
      error: () => this.resolvedServices.set([{ serviceId, isAuto: false }])
    });
  }

  goTo(next: number): void {
    const safeStep = Math.min(5, Math.max(1, next)) as WizardStep;
    if (safeStep > this.step() && !this.canContinue()) return;
    this.step.set(safeStep);
    this.queueStateSave();
  }

  canContinue(): boolean {
    if (this.step() === 1) return Boolean(this.wizardForm.value.branchId && this.wizardForm.value.serviceId);
    if (this.step() === 2) return Boolean(this.wizardForm.value.date);
    if (this.step() === 3) return Boolean(this.selectedSlot() && this.holdId());
    if (this.step() === 4) return Boolean(this.wizardForm.value.clientName && this.wizardForm.value.phone);
    return true;
  }

  findSlots(): void {
    this.loading.set(true);
    this.api.post<ApiRecord>('booking-portal/slots', {
      branchId: this.wizardForm.value.branchId,
      serviceId: this.wizardForm.value.serviceId,
      staffId: this.wizardForm.value.staffId,
      date: this.wizardForm.value.date
    }).subscribe({
      next: (response) => {
        this.slots.set(response.recommendations || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to find slots');
        this.loading.set(false);
      }
    });
  }

  selectSlot(slot: ApiRecord): void {
    this.selectedSlot.set(slot);
    this.api.postWithHeaders<ApiRecord>('slot-holds', {
      branchId: slot.branchId || this.wizardForm.value.branchId,
      staffId: slot.staffId || this.wizardForm.value.staffId,
      chairId: slot.chair || '',
      startTime: slot.startAt,
      endTime: slot.endAt,
      sessionId: this.sessionId
    }, { 'Idempotency-Key': this.newId('holdkey') }).subscribe({
      next: (hold) => {
        this.holdId.set(hold.holdId || hold.id || '');
        this.holdUntil.set(hold.reservedUntil || '');
        this.updateCountdown();
        this.queueStateSave();
      },
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to hold selected slot')
    });
  }

  releaseHold(): void {
    const id = this.holdId();
    if (!id) return;
    this.api.delete('slot-holds', id).subscribe({
      next: () => {
        this.holdId.set('');
        this.holdUntil.set('');
        this.holdCountdown.set('');
        this.queueStateSave();
      },
      error: (error) => this.error.set(error?.error?.error || error?.message || 'Unable to release hold')
    });
  }

  confirm(): void {
    const slot = this.selectedSlot();
    if (!slot || !this.holdId() || this.saving()) return;
    this.saving.set(true);
    this.api.create<ApiRecord>('clients', {
      name: this.wizardForm.value.clientName,
      phone: this.wizardForm.value.phone,
      email: this.wizardForm.value.email,
      branchId: this.wizardForm.value.branchId,
      preferredLanguage: this.wizardForm.value.preferredLanguage,
      preferredChannel: 'whatsapp'
    }).subscribe({
      next: (client) => this.createAppointment(client, slot),
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to create client');
        this.saving.set(false);
      }
    });
  }

  createAppointment(client: ApiRecord, slot: ApiRecord): void {
    this.api.postWithHeaders<ApiRecord>('appointments', {
      clientId: client.id,
      branchId: this.wizardForm.value.branchId,
      staffId: slot.staffId || this.wizardForm.value.staffId,
      serviceIds: this.resolvedServices().map((item) => item.serviceId || item.id).filter(Boolean),
      startAt: slot.startAt,
      endAt: slot.endAt,
      chair: slot.chair || '',
      status: 'booked',
      source: 'online-wizard',
      sourceChannel: 'portal',
      reservedFromSlotId: this.holdId()
    }, { 'Idempotency-Key': this.newId('apptkey') }).subscribe({
      next: (appointment) => {
        this.createdAppointment.set(appointment);
        this.saving.set(false);
        this.api.delete('booking-wizard/state', this.sessionId).subscribe({ next: () => undefined, error: () => undefined });
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to confirm booking');
        this.saving.set(false);
      }
    });
  }

  queueStateSave(): void {
    if (this.stateTimer) window.clearTimeout(this.stateTimer);
    this.stateTimer = window.setTimeout(() => this.saveState(), 500);
  }

  saveState(): void {
    this.api.put('booking-wizard/state', {
      sessionId: this.sessionId,
      step: this.step(),
      stateJson: {
        step: this.step(),
        form: this.wizardForm.value,
        selectedSlot: this.selectedSlot(),
        holdId: this.holdId(),
        holdUntil: this.holdUntil()
      }
    }).subscribe({ next: () => undefined, error: () => undefined });
  }

  updateCountdown(): void {
    const until = this.holdUntil();
    if (!until) return;
    const ms = new Date(until).getTime() - Date.now();
    if (ms <= 0) {
      this.holdCountdown.set('expired');
      return;
    }
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    this.holdCountdown.set(`${minutes}:${seconds}`);
  }

  serviceName(id: string): string {
    return this.services().find((service) => service.id === id)?.name || id || 'Service';
  }

  private newId(prefix: string): string {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return `${prefix}_${random.slice(0, 12)}`;
  }
}
