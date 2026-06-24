import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type PackageForm = {
  id: string;
  name: string;
  description: string;
  serviceId: string;
  paidSessions: number;
  freeSessions: number;
  price: number;
  validityDays: number;
  status: string;
};

type RedemptionLine = {
  step: number;
  date: string;
  service: string;
  staff: string;
  balance: number;
  invoice: string;
};

@Component({
  selector: 'app-packages',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CurrencyPipe, DatePipe, StateComponent],
  template: `
    <section class="page-stack packages-page">
      <div class="module-hero package-hero">
        <div>
          <span class="eyebrow">Module</span>
          <h2>Service Packages</h2>
          <p>Create 3 plus 1, prepaid service credits, client package tracking and redeem history.</p>
        </div>
        <button class="primary-button" type="button" (click)="toggleForm()">{{ showForm() ? 'Close' : 'Add package' }}</button>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <p class="state success" *ngIf="message()">{{ message() }}</p>

      <section class="package-builder" *ngIf="showForm()">
        <div class="section-title compact">
          <div>
            <span class="eyebrow">Package formula</span>
            <h3>Pay {{ form.paidSessions || 0 }}, get {{ totalSessions() }} service credit(s)</h3>
          </div>
          <span class="badge">{{ form.freeSessions || 0 }} free</span>
        </div>

        <div class="builder-grid">
          <label class="field">
            <span>Service</span>
            <select [(ngModel)]="form.serviceId" (ngModelChange)="onServiceChange($event)">
              <option value="">Choose service</option>
              <option *ngFor="let service of services()" [value]="recordId(service)">
                {{ serviceName(service) }} - {{ servicePrice(service) | currency: 'INR':'symbol':'1.0-0' }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>Package name</span>
            <input [(ngModel)]="form.name" placeholder="Root Touch Up 3+1" />
          </label>
          <label class="field">
            <span>Paid sessions</span>
            <input type="number" min="1" [(ngModel)]="form.paidSessions" (ngModelChange)="recalculatePrice()" />
          </label>
          <label class="field">
            <span>Free sessions</span>
            <input type="number" min="0" [(ngModel)]="form.freeSessions" (ngModelChange)="recalculatePrice()" />
          </label>
          <label class="field">
            <span>Total customer credits</span>
            <input [value]="totalSessions()" readonly />
          </label>
          <label class="field">
            <span>Package price</span>
            <input type="number" min="0" [(ngModel)]="form.price" />
          </label>
          <label class="field">
            <span>Validity days</span>
            <input type="number" min="1" [(ngModel)]="form.validityDays" />
          </label>
          <label class="field">
            <span>Status</span>
            <select [(ngModel)]="form.status">
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label class="field span-2">
            <span>Description</span>
            <input [(ngModel)]="form.description" placeholder="Client pays 3 Root Touch Up sessions and gets 4 credits." />
          </label>
        </div>

        <div class="formula-preview">
          <article>
            <span>Service price</span>
            <strong>{{ selectedServicePrice() | currency: 'INR':'symbol':'1.0-0' }}</strong>
          </article>
          <article>
            <span>Customer pays</span>
            <strong>{{ form.paidSessions || 0 }} session(s)</strong>
          </article>
          <article>
            <span>Customer gets</span>
            <strong>{{ totalSessions() }} redemption(s)</strong>
          </article>
          <article>
            <span>Balance flow</span>
            <strong>{{ balancePreview() }}</strong>
          </article>
        </div>

        <div class="form-actions">
          <button class="ghost-button" type="button" (click)="resetForm()">Cancel</button>
          <button class="primary-button" type="button" (click)="savePackage()" [disabled]="saving()">{{ saving() ? 'Saving...' : 'Save package' }}</button>
        </div>
      </section>

      <section class="package-metrics">
        <article>
          <span>Packages</span>
          <strong>{{ filteredPackages().length }}</strong>
          <small>{{ activePackageCount() }} active</small>
        </article>
        <article>
          <span>Clients sold</span>
          <strong>{{ packageSoldCount() }}</strong>
          <small>Live from POS sales</small>
        </article>
        <article>
          <span>Active clients</span>
          <strong>{{ activeClientCount() }}</strong>
          <small>Credits balance available</small>
        </article>
        <article>
          <span>Redeemed</span>
          <strong>{{ redeemedCreditCount() }}</strong>
          <small>Service credits used</small>
        </article>
      </section>

      <section class="panel">
        <div class="table-toolbar">
          <label class="search-field">
            <span>Search</span>
            <input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Search package, service, client" />
          </label>
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
        </div>

        <div class="package-workspace">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Service formula</th>
                  <th>Price</th>
                  <th>Validity</th>
                  <th>Sold</th>
                  <th>Active clients</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let item of filteredPackages()" (click)="selectPackage(item)" [class.active]="recordId(item) === selectedPackageId()">
                  <td>
                    <strong>{{ packageName(item) }}</strong>
                    <small>{{ item.description || packageRuleText(item) }}</small>
                  </td>
                  <td>{{ packageRuleText(item) }}</td>
                  <td>{{ moneyValue(item.price) | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ moneyValue(item.validityDays) || 90 }} days</td>
                  <td>{{ packageMembers(item).length }}</td>
                  <td>{{ activeMembers(item).length }}</td>
                  <td><span class="badge">{{ item.status || 'active' }}</span></td>
                </tr>
                <tr *ngIf="!filteredPackages().length">
                  <td colspan="7">No package found. Add Root Touch Up 3+1 package from the form above.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <aside class="package-detail" *ngIf="selectedPackage() as pkg">
            <div class="section-title compact">
              <div>
                <span class="eyebrow">Client package ledger</span>
                <h3>{{ packageName(pkg) }}</h3>
              </div>
              <span class="badge">{{ packageMembers(pkg).length }} client(s)</span>
            </div>

            <div class="detail-summary">
              <article>
                <span>Formula</span>
                <strong>{{ packageRuleText(pkg) }}</strong>
              </article>
              <article>
                <span>Credits</span>
                <strong>{{ packageTotalCredits(pkg) }}</strong>
              </article>
              <article>
                <span>Redeemed</span>
                <strong>{{ packageRedeemedCredits(pkg) }}</strong>
              </article>
            </div>

            <div class="client-package-card" *ngFor="let membership of packageMembers(pkg)">
              <div class="client-package-head">
                <div>
                  <a [routerLink]="['/clients', clientId(membership)]">{{ clientName(membership) }}</a>
                  <small>{{ clientPhone(membership) }} · Sold {{ dateLabel(membership.createdAt || membership.startDate) }}</small>
                </div>
                <span class="badge" [class.warning]="membershipBalance(membership) <= 0">{{ membershipStatus(membership) }}</span>
              </div>
              <div class="mini-grid">
                <span>Total <strong>{{ membershipTotal(membership) }}</strong></span>
                <span>Used <strong>{{ membershipUsed(membership) }}</strong></span>
                <span>Balance <strong>{{ membershipBalance(membership) }}</strong></span>
                <span>Expiry <strong>{{ dateLabel(membership.validityDate || membership.expiryDate) }}</strong></span>
              </div>

              <div class="redeem-list" *ngIf="redemptionLines(membership).length; else noRedeem">
                <div class="redeem-line" *ngFor="let row of redemptionLines(membership)">
                  <strong>{{ row.step }}. {{ row.service }}</strong>
                  <span>balance {{ row.balance }}</span>
                  <small>{{ row.date }} · {{ row.staff }} · {{ row.invoice }}</small>
                </div>
              </div>
              <ng-template #noRedeem>
                <p class="empty-note">No redemption yet. POS redeem hote hi date aur balance yahan aa jayega.</p>
              </ng-template>
            </div>

            <p class="empty-note" *ngIf="!packageMembers(pkg).length">
              Abhi kisi client ne ye package POS se purchase nahi kiya hai.
            </p>
          </aside>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .packages-page {
      gap: 18px;
    }

    .package-hero {
      align-items: center;
      min-height: 180px;
    }

    .package-builder,
    .panel,
    .package-detail {
      border: 1px solid #cfe4df;
      border-radius: 8px;
      background: #fff;
      padding: 18px;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.06);
    }

    .builder-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 14px;
    }

    .span-2 {
      grid-column: span 2;
    }

    .field,
    .search-field {
      display: grid;
      gap: 6px;
      color: #64748b;
      font-weight: 800;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    input,
    select {
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      min-height: 44px;
      padding: 10px 12px;
      font: inherit;
      color: #0f172a;
      background: #fff;
      text-transform: none;
      font-weight: 500;
    }

    .formula-preview,
    .package-metrics,
    .detail-summary,
    .mini-grid {
      display: grid;
      gap: 12px;
    }

    .formula-preview {
      grid-template-columns: repeat(4, minmax(150px, 1fr));
      margin-top: 14px;
    }

    .package-metrics {
      grid-template-columns: repeat(4, minmax(180px, 1fr));
    }

    .formula-preview article,
    .package-metrics article,
    .detail-summary article {
      border: 1px solid #d7ebe7;
      border-radius: 8px;
      padding: 14px;
      background: #f8fdfb;
    }

    .formula-preview span,
    .package-metrics span,
    .detail-summary span {
      display: block;
      color: #64748b;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .formula-preview strong,
    .package-metrics strong,
    .detail-summary strong {
      display: block;
      margin-top: 4px;
      color: #102033;
      font-size: 22px;
    }

    .form-actions,
    .table-toolbar,
    .client-package-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .form-actions {
      justify-content: flex-end;
      margin-top: 16px;
    }

    .table-toolbar {
      margin-bottom: 14px;
    }

    .search-field {
      min-width: min(100%, 480px);
    }

    .package-workspace {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(360px, 0.9fr);
      gap: 16px;
      align-items: start;
    }

    .table-wrap {
      overflow: auto;
      border: 1px solid #dbe8e5;
      border-radius: 8px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 900px;
    }

    th,
    td {
      padding: 12px;
      border-bottom: 1px solid #e5eeee;
      text-align: left;
      vertical-align: top;
    }

    th {
      background: #f6faf9;
      color: #475569;
      font-size: 12px;
      text-transform: uppercase;
    }

    tbody tr {
      cursor: pointer;
    }

    tbody tr:hover,
    tbody tr.active {
      background: #edfdf8;
    }

    td small,
    .client-package-head small {
      display: block;
      margin-top: 3px;
      color: #64748b;
      font-size: 12px;
    }

    .detail-summary {
      grid-template-columns: repeat(3, 1fr);
      margin: 14px 0;
    }

    .detail-summary strong {
      font-size: 18px;
    }

    .client-package-card {
      border: 1px solid #dbe8e5;
      border-radius: 8px;
      padding: 14px;
      margin-top: 12px;
      background: #fbfefd;
    }

    .client-package-head a {
      color: #0f766e;
      font-weight: 900;
      text-decoration: none;
    }

    .mini-grid {
      grid-template-columns: repeat(4, 1fr);
      margin: 12px 0;
      color: #64748b;
      font-size: 13px;
    }

    .mini-grid strong {
      color: #0f172a;
    }

    .redeem-list {
      display: grid;
      gap: 8px;
    }

    .redeem-line {
      display: grid;
      grid-template-columns: minmax(160px, 1fr) auto;
      gap: 4px 10px;
      border-radius: 8px;
      background: #f1f5ff;
      padding: 10px;
    }

    .redeem-line span {
      color: #0f766e;
      font-weight: 900;
    }

    .redeem-line small {
      grid-column: 1 / -1;
      color: #64748b;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 6px 10px;
      background: #dcfce7;
      color: #047857;
      font-size: 12px;
      font-weight: 900;
      text-transform: capitalize;
    }

    .badge.warning {
      background: #fee2e2;
      color: #b91c1c;
    }

    .empty-note {
      margin: 10px 0 0;
      border-radius: 8px;
      background: #f8fafc;
      color: #64748b;
      padding: 12px;
    }

    @media (max-width: 1100px) {
      .builder-grid,
      .formula-preview,
      .package-metrics,
      .package-workspace {
        grid-template-columns: 1fr;
      }

      .span-2 {
        grid-column: auto;
      }
    }
  `]
})
export class PackagesComponent implements OnInit {
  readonly packages = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly clients = signal<ApiRecord[]>([]);
  readonly memberships = signal<ApiRecord[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly showForm = signal(false);
  readonly selectedPackageId = signal('');
  readonly query = signal('');
  form: PackageForm = this.defaultForm();

  readonly filteredPackages = computed(() => {
    const term = this.query().trim().toLowerCase();
    const rows = [...this.packages()].sort((a, b) => this.packageName(a).localeCompare(this.packageName(b)));
    if (!term) return rows;
    return rows.filter((item) => [
      this.packageName(item),
      this.packageRuleText(item),
      String(item.description || ''),
      ...this.packageMembers(item).map((membership) => this.clientName(membership))
    ].join(' ').toLowerCase().includes(term));
  });

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      packages: this.api.list<ApiRecord[]>('packages', { limit: 1000, includeAllBranches: true }),
      services: this.api.list<ApiRecord[]>('services', { limit: 1000 }),
      clients: this.api.list<ApiRecord[]>('clients', { limit: 1000, compact: true }),
      memberships: this.api.list<ApiRecord[]>('memberships', { limit: 5000, includeAllBranches: true })
    }).subscribe({
      next: ({ packages, services, clients, memberships }) => {
        this.packages.set(Array.isArray(packages) ? packages : []);
        this.services.set(Array.isArray(services) ? services : []);
        this.clients.set(Array.isArray(clients) ? clients : []);
        this.memberships.set(Array.isArray(memberships) ? memberships : []);
        if (!this.selectedPackageId() && this.packages().length) this.selectedPackageId.set(this.recordId(this.packages()[0]));
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Packages load nahi ho paya.'));
        this.loading.set(false);
      }
    });
  }

  toggleForm(): void {
    this.showForm.update((value) => !value);
  }

  resetForm(): void {
    this.form = this.defaultForm();
    this.showForm.set(false);
    this.error.set('');
  }

  onServiceChange(serviceId: string): void {
    const service = this.serviceById(serviceId);
    if (!service) return;
    const name = this.serviceName(service);
    this.form.name = `${name} ${this.form.paidSessions}+${this.form.freeSessions}`;
    this.form.description = `Client pays ${this.form.paidSessions} ${name} session(s) and gets ${this.totalSessions()} credits.`;
    this.recalculatePrice();
  }

  recalculatePrice(): void {
    const price = this.selectedServicePrice();
    this.form.price = Math.max(0, price * Math.max(0, Number(this.form.paidSessions) || 0));
    const service = this.serviceById(this.form.serviceId);
    if (service) {
      const name = this.serviceName(service);
      this.form.name = `${name} ${this.form.paidSessions || 0}+${this.form.freeSessions || 0}`;
      this.form.description = `Client pays ${this.form.paidSessions || 0} ${name} session(s) and gets ${this.totalSessions()} credits.`;
    }
  }

  savePackage(): void {
    const service = this.serviceById(this.form.serviceId);
    if (!service) {
      this.error.set('Package banane ke liye service select karo.');
      return;
    }
    const paidSessions = Math.max(1, Number(this.form.paidSessions) || 1);
    const freeSessions = Math.max(0, Number(this.form.freeSessions) || 0);
    const totalSessions = paidSessions + freeSessions;
    const packageId = this.form.id || `pkg_${Date.now()}`;
    const serviceName = this.serviceName(service);
    const payload: ApiRecord = {
      id: packageId,
      name: this.form.name.trim() || `${serviceName} ${paidSessions}+${freeSessions}`,
      description: this.form.description.trim() || `Pay ${paidSessions}, get ${totalSessions} ${serviceName} credits.`,
      price: Math.max(0, Number(this.form.price) || 0),
      validityDays: Math.max(1, Number(this.form.validityDays) || 90),
      serviceIds: [this.recordId(service)],
      packageCredits: [{
        packageId,
        serviceId: this.recordId(service),
        serviceName,
        credits: totalSessions,
        quantity: totalSessions,
        remaining: totalSessions,
        paidSessions,
        freeSessions,
        unitPrice: this.servicePrice(service),
        packagePrice: Math.max(0, Number(this.form.price) || 0)
      }],
      rules: {
        type: 'pay_x_get_y',
        serviceId: this.recordId(service),
        serviceName,
        paidSessions,
        freeSessions,
        totalSessions
      },
      status: this.form.status || 'active'
    };
    this.saving.set(true);
    this.error.set('');
    this.api.create<ApiRecord>('packages', payload).subscribe({
      next: (created) => {
        this.message.set(`${this.packageName(created)} package save ho gaya. Ab POS me sell karke client ke naam active package banega.`);
        this.saving.set(false);
        this.showForm.set(false);
        this.form = this.defaultForm();
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Package save nahi ho paya.'));
        this.saving.set(false);
      }
    });
  }

  selectPackage(item: ApiRecord): void {
    this.selectedPackageId.set(this.recordId(item));
  }

  selectedPackage(): ApiRecord | null {
    return this.packages().find((item) => this.recordId(item) === this.selectedPackageId()) || this.filteredPackages()[0] || null;
  }

  totalSessions(): number {
    return Math.max(0, Number(this.form.paidSessions) || 0) + Math.max(0, Number(this.form.freeSessions) || 0);
  }

  balancePreview(): string {
    const total = this.totalSessions();
    if (!total) return '0';
    return Array.from({ length: total }, (_, index) => `${total - index - 1}`).join(' / ');
  }

  selectedServicePrice(): number {
    return this.servicePrice(this.serviceById(this.form.serviceId));
  }

  activePackageCount(): number {
    return this.packages().filter((item) => String(item.status || 'active').toLowerCase() === 'active').length;
  }

  packageSoldCount(): number {
    return this.packages().reduce((sum, item) => sum + this.packageMembers(item).length, 0);
  }

  activeClientCount(): number {
    const ids = new Set<string>();
    for (const item of this.packages()) {
      for (const membership of this.activeMembers(item)) ids.add(this.clientId(membership));
    }
    return ids.size;
  }

  redeemedCreditCount(): number {
    return this.memberships().reduce((sum, membership) => sum + (this.isPackageMembership(membership) ? this.membershipUsed(membership) : 0), 0);
  }

  activeMembers(pkg: ApiRecord): ApiRecord[] {
    return this.packageMembers(pkg).filter((membership) => this.membershipBalance(membership) > 0 && this.membershipStatus(membership) === 'Active');
  }

  packageMembers(pkg: ApiRecord): ApiRecord[] {
    return this.memberships()
      .filter((membership) => this.isPackageMembership(membership) && this.packageMatchesMembership(pkg, membership))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  packageRedeemedCredits(pkg: ApiRecord): number {
    return this.packageMembers(pkg).reduce((sum, membership) => sum + this.membershipUsed(membership), 0);
  }

  packageMatchesMembership(pkg: ApiRecord, membership: ApiRecord): boolean {
    const packageId = this.recordId(pkg);
    const packageName = this.packageName(pkg).toLowerCase();
    const memberName = String(membership.planName || membership.name || '').replace(/^Package:\s*/i, '').trim().toLowerCase();
    if (memberName && memberName === packageName) return true;
    if (String(membership.packageId || membership.package_id || '') === packageId) return true;
    if (this.readList(membership.redeemHistory || membership.redemptionHistory).some((entry) => String(entry.packageId || '') === packageId)) return true;
    return this.packageServiceCredits(membership).some((credit) => String(credit.packageId || '') === packageId);
  }

  packageRuleText(pkg: ApiRecord): string {
    const rules = this.objectValue(pkg.rules);
    const paid = this.moneyValue(rules.paidSessions ?? this.firstPackageCredit(pkg).paidSessions);
    const free = this.moneyValue(rules.freeSessions ?? this.firstPackageCredit(pkg).freeSessions);
    const total = this.packageTotalCredits(pkg);
    const serviceName = String(rules.serviceName || this.firstPackageCredit(pkg).serviceName || this.serviceName(this.serviceById(this.packageServiceIds(pkg)[0])) || 'service');
    if (paid || free) return `${serviceName}: pay ${paid}, get ${total}`;
    return `${serviceName}: ${total || 0} credit(s)`;
  }

  packageTotalCredits(pkg: ApiRecord): number {
    const credits = this.packageServiceCredits(pkg);
    if (credits.length) return credits.reduce((sum, credit) => sum + this.moneyValue(credit.credits ?? credit.quantity ?? credit.total ?? 0), 0);
    const rules = this.objectValue(pkg.rules);
    return this.moneyValue(rules.totalSessions || rules.credits || 0);
  }

  membershipTotal(membership: ApiRecord): number {
    const direct = this.moneyValue(membership.planCredits || membership.totalCredits || membership.credits || 0);
    if (direct > 0) return direct;
    return this.packageServiceCredits(membership).reduce((sum, credit) => sum + this.moneyValue(credit.credits ?? credit.quantity ?? 0), 0);
  }

  membershipBalance(membership: ApiRecord): number {
    const direct = this.moneyValue(membership.creditsRemaining || membership.remainingCredits || membership.balanceCredits || 0);
    if (direct > 0) return direct;
    const total = this.membershipTotal(membership);
    return Math.max(0, total - this.membershipUsed(membership));
  }

  membershipUsed(membership: ApiRecord): number {
    const total = this.membershipTotal(membership);
    const balance = this.moneyValue(membership.creditsRemaining || membership.remainingCredits || 0);
    if (total > 0 && balance >= 0) return Math.max(0, total - balance);
    return this.redemptionEntries(membership).reduce((sum, entry) => sum + this.redemptionCreditCount(entry), 0);
  }

  membershipStatus(membership: ApiRecord): string {
    const status = String(membership.status || '').toLowerCase();
    const expiry = Date.parse(String(membership.validityDate || membership.expiryDate || ''));
    if (status === 'inactive' || status === 'expired') return 'Expired';
    if (Number.isFinite(expiry) && expiry < Date.now()) return 'Expired';
    if (this.membershipBalance(membership) <= 0 && this.membershipTotal(membership) > 0) return 'Fully used';
    return 'Active';
  }

  redemptionLines(membership: ApiRecord): RedemptionLine[] {
    const total = this.membershipTotal(membership);
    let used = 0;
    const lines: RedemptionLine[] = [];
    for (const entry of this.redemptionEntries(membership)) {
      const count = Math.max(1, Math.min(50, this.redemptionCreditCount(entry)));
      for (let index = 0; index < count; index += 1) {
        used += 1;
        lines.push({
          step: used,
          date: this.dateLabel(entry.date || entry.usedAt || entry.createdAt),
          service: this.redemptionServiceName(entry),
          staff: String(entry.staffName || entry.staff_name || entry.staffId || 'Staff not assigned'),
          balance: Math.max(0, total - used),
          invoice: String(entry.saleId || entry.invoiceId || entry.invoiceNumber || 'POS')
        });
      }
    }
    return lines;
  }

  redemptionEntries(membership: ApiRecord): ApiRecord[] {
    return this.readList(membership.redeemHistory || membership.redemptionHistory || membership.redemptions)
      .filter((entry) => {
        const type = String(entry.type || entry.status || '').toLowerCase();
        return !type.includes('package_sale') && !type.includes('membership_sale') && (type.includes('redeem') || entry.serviceId || entry.serviceName || entry.creditsUsed || entry.credits);
      })
      .sort((a, b) => String(a.date || a.usedAt || a.createdAt || '').localeCompare(String(b.date || b.usedAt || b.createdAt || '')));
  }

  redemptionServiceName(entry: ApiRecord): string {
    return String(entry.serviceName || entry.name || this.serviceName(this.serviceById(String(entry.serviceId || ''))) || 'Package service');
  }

  redemptionCreditCount(entry: ApiRecord): number {
    return Math.max(1, this.moneyValue(entry.creditsUsed ?? entry.usedCredits ?? entry.credits ?? entry.quantity ?? 1));
  }

  isPackageMembership(membership: ApiRecord): boolean {
    const planName = String(membership.planName || membership.name || '').trim().toLowerCase();
    if (planName.startsWith('package:')) return true;
    if (this.packageServiceCredits(membership).some((credit) => credit.packageId || credit.serviceId)) return true;
    return this.readList(membership.redeemHistory || membership.redemptionHistory).some((entry) => String(entry.type || '').includes('package') || entry.packageId);
  }

  packageServiceIds(pkg: ApiRecord): string[] {
    return [
      ...this.readArray(pkg.serviceIds || pkg.service_ids).map((item) => String(typeof item === 'object' && item ? (item as ApiRecord).id || (item as ApiRecord).serviceId : item)).filter(Boolean),
      ...this.packageServiceCredits(pkg).map((credit) => String(credit.serviceId || '')).filter(Boolean)
    ];
  }

  packageServiceCredits(item: ApiRecord): ApiRecord[] {
    return [
      ...this.readList(item.serviceCredits || item.service_credits),
      ...this.readList(item.packageCredits || item.package_credits)
    ];
  }

  firstPackageCredit(pkg: ApiRecord): ApiRecord {
    return this.packageServiceCredits(pkg)[0] || {};
  }

  clientId(membership: ApiRecord): string {
    return String(membership.clientId || membership.customerId || membership.client_id || '');
  }

  clientName(membership: ApiRecord): string {
    const client = this.clientById(this.clientId(membership));
    return String(client?.name || membership.clientName || membership.customerName || 'Client');
  }

  clientPhone(membership: ApiRecord): string {
    const client = this.clientById(this.clientId(membership));
    return String(client?.phone || client?.mobile || membership.phone || membership.mobile || '-');
  }

  clientById(id: string): ApiRecord | undefined {
    return this.clients().find((client) => this.recordId(client) === id);
  }

  serviceById(id: string): ApiRecord | undefined {
    return this.services().find((service) => this.recordId(service) === id);
  }

  serviceName(service: ApiRecord | undefined): string {
    return String(service?.name || service?.serviceName || service?.title || '');
  }

  servicePrice(service: ApiRecord | undefined): number {
    return this.moneyValue(service?.price ?? service?.salePrice ?? service?.basePrice ?? service?.amount ?? 0);
  }

  packageName(item: ApiRecord): string {
    return String(item.name || item.packageName || 'Package');
  }

  recordId(item: ApiRecord | undefined): string {
    return String(item?.id || item?.packageId || item?.serviceId || '');
  }

  moneyValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  dateLabel(value: unknown): string {
    if (!value) return '-';
    const date = new Date(String(value));
    if (!Number.isFinite(date.getTime())) return String(value);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  readList(value: unknown): ApiRecord[] {
    return this.readArray(value).map((item) => this.recordValue(item));
  }

  readArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  recordValue(value: unknown): ApiRecord {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as ApiRecord;
    return {};
  }

  objectValue(value: unknown): ApiRecord {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as ApiRecord;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ApiRecord : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  private defaultForm(): PackageForm {
    return {
      id: '',
      name: '',
      description: '',
      serviceId: '',
      paidSessions: 3,
      freeSessions: 1,
      price: 0,
      validityDays: 90,
      status: 'active'
    };
  }
}
