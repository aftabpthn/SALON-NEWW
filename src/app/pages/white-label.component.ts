import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';

@Component({
  selector: 'app-white-label',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Custom branding, theme system, custom logo, custom domain and branch-specific branding</h2>
        </div>
        <button class="ghost-button" type="button" (click)="load()">Refresh</button>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metrics-grid" *ngIf="summary()?.metrics as metrics">
        <aura-kpi-card tone="teal" target="/kpi-details/white-label/profiles"><span>Profiles</span><strong>{{ metrics.profiles }}</strong></aura-kpi-card>
        <aura-kpi-card tone="blue" target="/kpi-details/white-label/custom-domains"><span>Custom domains</span><strong>{{ metrics.customDomains }}</strong></aura-kpi-card>
        <aura-kpi-card tone="green" target="/kpi-details/white-label/branded-branches"><span>Branded branches</span><strong>{{ metrics.brandedBranches }}</strong></aura-kpi-card>
        <aura-kpi-card tone="amber" target="/kpi-details/white-label/default-profiles"><span>Default profiles</span><strong>{{ metrics.defaultProfiles }}</strong></aura-kpi-card>
      </div>

      <div class="dashboard-grid">
        <section class="form-panel">
          <h3>Brand profile</h3>
          <form [formGroup]="profileForm" (ngSubmit)="saveProfile()">
            <label class="field"><span>Brand name</span><input formControlName="brandName" /></label>
            <label class="field"><span>Custom domain</span><input formControlName="domain" /></label>
            <label class="field full"><span>Logo URL</span><input formControlName="logoUrl" /></label>
            <label class="field"><span>Primary color</span><input formControlName="primary" /></label>
            <label class="field"><span>Accent color</span><input formControlName="accent" /></label>
            <label class="check-line full"><input type="checkbox" formControlName="isDefault" /><span>Use as default brand</span></label>
            <div class="form-actions"><button class="primary-button" type="submit">Save profile</button></div>
          </form>
        </section>

        <section class="panel">
          <div class="section-title"><h2>Resolved runtime brand</h2></div>
          <div class="profile-header" *ngIf="summary()?.resolved as resolved">
            <span class="avatar large">{{ (resolved.brandName || 'A').slice(0, 1) }}</span>
            <div>
              <h2>{{ resolved.brandName }}</h2>
              <p>{{ resolved.logoUrl || 'No logo URL configured' }}</p>
              <div class="chip-row">
                <span class="badge" *ngFor="let token of tokenEntries(resolved.theme)" [style.background]="token[1]" [style.color]="contrast(token[1])">{{ token[0] }}</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="dashboard-grid">
        <section class="form-panel">
          <h3>Branch-specific branding</h3>
          <form [formGroup]="branchForm" (ngSubmit)="saveBranchBranding()">
            <label class="field"><span>Branch</span><select formControlName="branchId"><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select></label>
            <label class="field"><span>Branch brand name</span><input formControlName="brandName" /></label>
            <label class="field"><span>Primary</span><input formControlName="primary" /></label>
            <label class="field"><span>Accent</span><input formControlName="accent" /></label>
            <div class="form-actions"><button class="primary-button" type="submit">Save branch brand</button></div>
          </form>
        </section>

        <section class="form-panel">
          <h3>Domain mapping</h3>
          <form [formGroup]="domainForm" (ngSubmit)="mapDomain()">
            <label class="field"><span>Domain</span><input formControlName="domain" /></label>
            <label class="field"><span>Status</span><select formControlName="status"><option value="pending">Pending</option><option value="verified">Verified</option></select></label>
            <div class="form-actions"><button class="primary-button" type="submit">Map domain</button></div>
          </form>
        </section>
      </div>

      <section class="panel">
        <div class="section-title"><h2>Brand profiles</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Brand</th><th>Domain</th><th>Logo</th><th>Status</th><th>Default</th></tr></thead>
            <tbody>
              <tr *ngFor="let profile of profiles()">
                <td>{{ profile.brandName }}</td>
                <td>{{ profile.domain || '-' }}</td>
                <td>{{ profile.logoUrl || '-' }}</td>
                <td><span class="badge">{{ profile.status }}</span></td>
                <td>{{ profile.isDefault ? 'Yes' : 'No' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="section-title"><h2>Branch branding</h2></div>
        <div class="quick-grid">
          <article class="action-card" *ngFor="let brand of branchBranding()">
            <strong>{{ brand.brandName }}</strong>
            <span>{{ brand.branchId }} · {{ brand.status }}</span>
          </article>
        </div>
      </section>

      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `
})
export class WhiteLabelComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly branches = signal<ApiRecord[]>([]);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly profiles = computed(() => this.summary()?.profiles || []);
  readonly branchBranding = computed(() => this.summary()?.branchBranding || []);
  private tokenEntriesCacheKey = '';
  private tokenEntriesCache: [string, string][] = [];

  readonly profileForm = this.fb.group({
    brandName: ['Aura Salon Pro', Validators.required],
    domain: ['booking.aurasalon.example'],
    logoUrl: ['/assets/aura-logo.svg'],
    primary: ['#0f766e'],
    accent: ['#2f5fbd'],
    isDefault: [false]
  });
  readonly branchForm = this.fb.group({ branchId: ['', Validators.required], brandName: ['Aura Signature Branch'], primary: ['#2f5fbd'], accent: ['#0f766e'] });
  readonly domainForm = this.fb.group({ domain: ['booking.aurasalon.example', Validators.required], status: ['pending'] });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.api.list<ApiRecord[]>('branches').subscribe((rows) => {
      this.branches.set(rows);
      if (rows[0]) this.branchForm.patchValue({ branchId: rows[0].id, brandName: rows[0].name });
    });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('white-label/summary').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load white-label settings');
        this.loading.set(false);
      }
    });
  }

  saveProfile(): void {
    const value = this.profileForm.value;
    this.api.post<ApiRecord>('white-label/profiles', {
      name: value.brandName,
      brandName: value.brandName,
      domain: value.domain,
      logoUrl: value.logoUrl,
      theme: { primary: value.primary, accent: value.accent },
      isDefault: value.isDefault
    }).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  saveBranchBranding(): void {
    const value = this.branchForm.value;
    this.api.post<ApiRecord>('white-label/branch-branding', {
      branchId: value.branchId,
      brandName: value.brandName,
      theme: { primary: value.primary, accent: value.accent }
    }).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  mapDomain(): void {
    this.api.post<ApiRecord>('white-label/domains', this.domainForm.value).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  tokenEntries(theme: ApiRecord = {}): [string, string][] {
    const cacheKey = JSON.stringify(theme || {});
    if (cacheKey !== this.tokenEntriesCacheKey) {
      this.tokenEntriesCacheKey = cacheKey;
      this.tokenEntriesCache = Object.entries(theme).filter(([, value]) => String(value).startsWith('#')) as [string, string][];
    }
    return this.tokenEntriesCache;
  }

  contrast(color: string): string {
    return ['#ffffff', '#fff', '#f5f7f8'].includes(String(color).toLowerCase()) ? '#17202d' : '#ffffff';
  }
}
