import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { AppStateService } from '../core/state/app-state.service';

type BranchOption = ApiRecord & { id: string; name?: string; slug?: string; city?: string; address?: string; onlineBookingEnabled?: number | boolean };
type TenantOption = ApiRecord & { id: string; name?: string; slug?: string };

@Component({
  selector: 'app-salon-3d-website',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <main class="booking-share-page">
      <section class="share-hero">
        <div class="share-copy">
          <h1>{{ activeBusinessName() }}</h1>
          <div class="outlet-meta">
            <span>{{ activeBranchCity() }}</span>
            <span>{{ activeBranchAddress() }}</span>
            <span [class.offline]="!isOnlineBookingEnabled()">{{ isOnlineBookingEnabled() ? 'Online booking enabled' : 'Online booking disabled' }}</span>
          </div>
        </div>
        <div class="share-actions">
          <a class="primary" [href]="businessProfileUrl()" target="_blank" rel="noopener">Open customer view</a>
          <a class="secondary" [href]="bookingFlowUrl()" target="_blank" rel="noopener">Open booking flow</a>
          <button class="secondary" type="button" (click)="copyLink(bookingFlowUrl())">{{ copied() ? 'Copied' : 'Copy booking link' }}</button>
        </div>
      </section>

      <section class="link-panel">
        <article>
          <strong>Public customer view</strong>
          <div class="link-row">
            <input [value]="businessProfileUrl()" readonly aria-label="Business profile link" />
            <button type="button" (click)="copyLink(businessProfileUrl())">Copy</button>
          </div>
        </article>
        <article>
          <strong>Send this to clients</strong>
          <div class="link-row">
            <input [value]="bookingFlowUrl()" readonly aria-label="Direct booking link" />
            <button type="button" (click)="copyLink(bookingFlowUrl())">Copy</button>
          </div>
        </article>
      </section>

      <section class="preview-section">
        <div class="preview-head">
          <div>
            <h2>Customer app page</h2>
          </div>
          <div class="preview-tools">
            <button type="button" (click)="reloadPreview()">Refresh preview</button>
            <a [href]="businessProfileUrl()" target="_blank" rel="noopener">Open full page</a>
          </div>
        </div>
        <div class="preview-frame">
          <iframe [src]="trustedPreviewUrl()" title="Customer app business page preview" loading="lazy"></iframe>
        </div>
      </section>

      <section class="ops-grid">
        <article>
          <span>Outlet</span>
          <strong>{{ activeBusinessName() }}</strong>
          <small>{{ activeBranchId() }}</small>
        </article>
        <article>
          <span>Client link</span>
          <strong>Ready</strong>
        </article>
        <article>
          <span>Customer app</span>
          <strong>{{ customerAppBaseUrl() }}</strong>
        </article>
        <article>
          <span>Admin shortcut</span>
          <strong>Calendar</strong>
          <small><a routerLink="/appointments">Open appointments</a></small>
        </article>
      </section>
    </main>
  `,
  styles: [`
    :host { display: block; }
    .booking-share-page { display: grid; gap: 18px; color: #172033; }
    .share-hero,
    .link-panel,
    .preview-section,
    .ops-grid article {
      border: 1px solid #d7e6e2;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 16px 40px rgba(15, 23, 42, .06);
    }
    .share-hero { min-height: 260px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 28px; align-items: center; padding: 32px; background: linear-gradient(135deg, #F8EEF4 0%, #ffffff 55%, #FAF8F6 100%); }
    .share-copy { display: grid; gap: 12px; max-width: 840px; }
    .eyebrow { color: #4B1238; font-size: 12px; font-weight: 900; letter-spacing: .04em; text-transform: uppercase; }
    h1, h2 { margin: 0; letter-spacing: 0; color: #111827; }
    h1 { font-size: 42px; line-height: 1.08; }
    h2 { font-size: 24px; }
    p { margin: 0; color: #64748b; font-size: 16px; line-height: 1.55; }
    .outlet-meta { display: flex; flex-wrap: wrap; gap: 8px; }
    .outlet-meta span { min-height: 28px; display: inline-flex; align-items: center; padding: 0 10px; border-radius: 999px; background: #e9f8f3; color: #4B1238; font-size: 12px; font-weight: 900; }
    .outlet-meta .offline { background: #fff1f2; color: #be123c; }
    .share-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; min-width: 360px; }
    a, button { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 0 16px; border-radius: 8px; border: 1px solid #cfe0dc; color: #172033; text-decoration: none; font: inherit; font-weight: 900; cursor: pointer; background: #ffffff; }
    .primary { background: #5A153F; border-color: #5A153F; color: #ffffff; }
    .secondary { background: #ffffff; }
    .link-panel { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; overflow: hidden; background: #d7e6e2; }
    .link-panel article { display: grid; gap: 10px; padding: 18px; background: #ffffff; }
    .link-panel strong { font-size: 18px; }
    .link-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
    input { width: 100%; min-height: 44px; border: 1px solid #d7e6e2; border-radius: 8px; padding: 0 12px; color: #334155; font: inherit; font-weight: 700; background: #f8fafc; }
    .preview-section { display: grid; gap: 16px; padding: 18px; }
    .preview-head { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
    .preview-tools { display: flex; flex-wrap: wrap; gap: 8px; }
    .preview-frame { height: min(720px, 72vh); border: 1px solid #d7e6e2; border-radius: 8px; overflow: hidden; background: #f8fafc; }
    iframe { display: block; width: 100%; height: 100%; border: 0; background: #ffffff; }
    .ops-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .ops-grid article { padding: 14px; display: grid; gap: 5px; }
    .ops-grid span { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .ops-grid strong { font-size: 20px; word-break: break-word; }
    .ops-grid small { color: #64748b; }
    @media (max-width: 1000px) {
      .share-hero, .link-panel, .ops-grid { grid-template-columns: 1fr; }
      .share-actions { min-width: 0; justify-content: flex-start; }
      h1 { font-size: 32px; }
    }
  `]
})
export class Salon3dWebsiteComponent implements OnInit {
  readonly branches = signal<BranchOption[]>([]);
  readonly tenants = signal<TenantOption[]>([]);
  readonly copied = signal(false);
  readonly previewNonce = signal(0);

  readonly activeBranch = computed(() => {
    const selected = this.state.selectedBranchId();
    return this.branches().find((branch) => branch.id === selected) || this.branches()[0] || null;
  });
  readonly activeTenant = computed(() => {
    const selected = this.state.selectedTenantId();
    return this.tenants().find((tenant) => tenant.id === selected) || null;
  });
  readonly activeTenantName = computed(() => this.activeTenant()?.name || this.state.selectedTenantId());
  readonly activeBranchCity = computed(() => this.activeBranch()?.city || 'Customer app');
  readonly activeBranchAddress = computed(() => this.activeBranch()?.address || this.activeTenantName());
  readonly activeBranchId = computed(() => this.activeBranch()?.id || 'No branch selected');
  readonly activeBusinessName = computed(() => {
    const branch = this.activeBranch();
    const tenantName = this.activeTenantName();
    if (!branch) return tenantName;
    return branch.name || tenantName;
  });
  readonly publicBusinessSlug = computed(() => {
    const branch = this.activeBranch();
    const tenant = this.activeTenant();
    return encodeURIComponent(String(branch?.slug || branch?.id || tenant?.slug || tenant?.id || this.state.selectedTenantId()));
  });
  readonly customerAppBaseUrl = computed(() => this.resolveCustomerAppBaseUrl());
  readonly businessProfileUrl = computed(() => `${this.customerAppBaseUrl()}/business/${this.publicBusinessSlug()}`);
  readonly bookingFlowUrl = computed(() => `${this.businessProfileUrl()}/book`);
  readonly previewUrl = computed(() => {
    const joiner = this.businessProfileUrl().includes('?') ? '&' : '?';
    return `${this.businessProfileUrl()}${joiner}preview=${this.previewNonce()}`;
  });
  readonly trustedPreviewUrl = computed<SafeResourceUrl>(() => this.sanitizer.bypassSecurityTrustResourceUrl(this.previewUrl()));
  readonly isOnlineBookingEnabled = computed(() => {
    const value = this.activeBranch()?.onlineBookingEnabled;
    return value === undefined || value === null || value === true || Number(value) === 1;
  });

  constructor(
    private readonly api: ApiService,
    private readonly sanitizer: DomSanitizer,
    private readonly state: AppStateService
  ) {}

  ngOnInit(): void {
    this.loadTenants();
    this.loadBranches();
  }

  copyLink(link: string): void {
    const markCopied = () => {
      this.copied.set(true);
      window.setTimeout(() => this.copied.set(false), 1800);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(markCopied).catch(() => this.fallbackCopy(link, markCopied));
      return;
    }
    this.fallbackCopy(link, markCopied);
  }

  reloadPreview(): void {
    this.previewNonce.update((value) => value + 1);
  }

  private loadBranches(): void {
    this.api.list<BranchOption[]>('branches').subscribe({
      next: (branches) => this.branches.set((branches || []).filter((branch) => branch?.id)),
      error: () => this.branches.set([])
    });
  }

  private loadTenants(): void {
    this.api.list<TenantOption[]>('tenants', { limit: 1000 }).subscribe({
      next: (tenants) => this.tenants.set((tenants || []).filter((tenant) => tenant?.id)),
      error: () => this.tenants.set([])
    });
  }

  private resolveCustomerAppBaseUrl(): string {
    const configured = localStorage.getItem('aura.customerAppBaseUrl')?.trim();
    if (configured) return configured.replace(/\/+$/, '');
    const { protocol, hostname, port, origin } = window.location;
    if ((hostname === '127.0.0.1' || hostname === 'localhost') && port === '4300') {
      return `${protocol}//${hostname}:4310`;
    }
    return origin;
  }

  private fallbackCopy(link: string, onCopied: () => void): void {
    const input = document.createElement('textarea');
    input.value = link;
    input.setAttribute('readonly', 'true');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    onCopied();
  }
}
