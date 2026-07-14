import { ChangeDetectionStrategy, Component, computed, HostListener, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthSessionService } from '../../../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../../../core/permission.guard';
import { routePermissionForPath } from '../../../core/access-rules';
import { AppStateService } from '../../../core/state/app-state.service';
import { GeneralSettingsService } from '../../../core/general-settings.service';

export type CommandKind = 'action' | 'nav';

export interface CommandEntry {
  id: string;
  label: string;
  hint: string;
  icon: string;
  path: string;
  kind: CommandKind;
  keywords?: string;
}

/**
 * Universal command bar (⌘K / Ctrl+K).
 * Self-contained: registers its own global hotkey and navigates via the
 * existing router. Mount once in the shell; optionally trigger it from a
 * button by dispatching `window` event `aura:command-palette:open`.
 */
@Component({
  selector: 'aura-command-palette',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cmdk-root" *ngIf="open()" (click)="close()">
      <div class="cmdk-panel" role="dialog" aria-label="Command bar" (click)="$event.stopPropagation()">
        <div class="cmdk-search">
          <span class="cmdk-search-icon" aria-hidden="true">⌕</span>
          <input
            #search
            class="cmdk-input"
            type="text"
            placeholder="Search actions, pages, modules…"
            [value]="query()"
            (input)="onInput($event)"
            (keydown)="onKey($event)"
            autocomplete="off"
            spellcheck="false"
          />
          <kbd class="cmdk-esc">ESC</kbd>
        </div>

        <div class="cmdk-results" #results>
          <ng-container *ngIf="filtered().length; else noResults">
            <ng-container *ngFor="let group of grouped()">
              <div class="cmdk-group-label">{{ group.label }}</div>
              <button
                *ngFor="let item of group.items"
                type="button"
                class="cmdk-item"
                [class.active]="item.id === activeId()"
                [attr.data-id]="item.id"
                (mouseenter)="activeId.set(item.id)"
                (click)="run(item)"
              >
                <span class="cmdk-item-icon" [class.is-action]="item.kind === 'action'">{{ item.icon }}</span>
                <span class="cmdk-item-copy">
                  <strong>{{ item.label }}</strong>
                  <small>{{ item.hint }}</small>
                </span>
                <span class="cmdk-item-kind">{{ item.kind === 'action' ? 'Create' : 'Go to' }}</span>
              </button>
            </ng-container>
          </ng-container>
          <ng-template #noResults>
            <div class="cmdk-empty">
              <strong>No matches for “{{ query() }}”</strong>
              <span>Try a page name, or a verb like “new client”.</span>
            </div>
          </ng-template>
        </div>

        <div class="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 200; pointer-events: none; }
    .cmdk-root {
      position: fixed; inset: 0; pointer-events: auto;
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: 12vh;
      background: rgba(17, 19, 38, 0.42);
      backdrop-filter: blur(8px) saturate(1.1);
      animation: cmdk-fade 140ms ease;
    }
    .cmdk-panel {
      width: min(640px, calc(100vw - 32px));
      max-height: 70vh; display: flex; flex-direction: column;
      border-radius: 18px;
      border: 1px solid rgba(75, 18, 56, 0.16);
      background: rgba(255, 255, 255, 0.96);
      box-shadow: var(--elev-3, 0 30px 80px rgba(15, 23, 42, 0.28)), 0 0 0 1px rgba(255,255,255,0.6) inset;
      overflow: hidden;
      animation: cmdk-pop 160ms cubic-bezier(0.2, 0.9, 0.3, 1);
    }
    .cmdk-search {
      display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 10px;
      padding: 14px 16px; border-bottom: 1px solid rgba(15, 23, 42, 0.08);
    }
    .cmdk-search-icon { font-size: 1.05rem; color: var(--aura-primary, #4B1238); }
    .cmdk-input {
      border: 0; outline: 0; background: transparent;
      font-size: 1rem; font-weight: 600; color: #16203a;
    }
    .cmdk-input::placeholder { color: #97a0b5; font-weight: 500; }
    .cmdk-esc {
      font-size: 0.62rem; font-weight: 800; letter-spacing: 0.06em; color: #8a93a8;
      padding: 3px 7px; border-radius: 6px; background: #f0f1f7; border: 1px solid rgba(15,23,42,0.06);
    }
    .cmdk-results { overflow-y: auto; padding: 8px; }
    .cmdk-group-label {
      padding: 10px 10px 6px; font-size: 0.66rem; font-weight: 800;
      letter-spacing: 0.09em; text-transform: uppercase; color: #98a1b4;
    }
    .cmdk-item {
      width: 100%; display: grid; grid-template-columns: 34px 1fr auto; align-items: center; gap: 12px;
      padding: 9px 10px; border: 1px solid transparent; border-radius: 12px;
      background: transparent; text-align: left; cursor: pointer; color: #1d2740;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .cmdk-item.active {
      background: var(--gradient-brand-soft, rgba(75,18,56,0.1));
      border-color: rgba(75, 18, 56, 0.22);
    }
    .cmdk-item-icon {
      width: 34px; height: 34px; display: grid; place-items: center; border-radius: 9px;
      font-size: 0.72rem; font-weight: 800; color: var(--aura-primary, #4B1238);
      background: rgba(75, 18, 56, 0.12);
    }
    .cmdk-item-icon.is-action {
      color: #fff; background: var(--gradient-brand, linear-gradient(135deg,#4B1238,#7c3aed));
    }
    .cmdk-item-copy { min-width: 0; display: grid; gap: 1px; }
    .cmdk-item-copy strong { font-size: 0.9rem; font-weight: 700; }
    .cmdk-item-copy small { font-size: 0.74rem; color: #7a8398;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cmdk-item-kind {
      font-size: 0.66rem; font-weight: 700; color: #9aa3b7; opacity: 0;
      transition: opacity 120ms ease;
    }
    .cmdk-item.active .cmdk-item-kind { opacity: 1; }
    .cmdk-empty { padding: 30px 16px; text-align: center; display: grid; gap: 6px; }
    .cmdk-empty strong { font-size: 0.95rem; color: #1d2740; }
    .cmdk-empty span { font-size: 0.8rem; color: #8a93a8; }
    .cmdk-foot {
      display: flex; gap: 16px; padding: 10px 16px;
      border-top: 1px solid rgba(15, 23, 42, 0.07); background: #fafbff;
      font-size: 0.72rem; color: #8a93a8;
    }
    .cmdk-foot kbd {
      font-size: 0.66rem; font-weight: 800;
      padding: 2px 6px; margin-right: 3px; border-radius: 5px;
      background: #fff; border: 1px solid rgba(15,23,42,0.12); color: #56607a;
    }
    @keyframes cmdk-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes cmdk-pop { from { opacity: 0; transform: translateY(-8px) scale(0.985); } to { opacity: 1; transform: none; } }
  `]
})
export class CommandPaletteComponent {
  readonly open = signal(false);
  readonly query = signal('');
  readonly activeId = signal('');

  private readonly entries: CommandEntry[] = [
    // Quick-create actions
    { id: 'a-booking', kind: 'action', label: 'New Booking', hint: 'Open the calendar to schedule', icon: 'BK', path: '/appointments', keywords: 'appointment schedule slot calendar' },
    { id: 'a-client', kind: 'action', label: 'New Client', hint: 'Add a guest to the CRM', icon: 'CL', path: '/clients', keywords: 'customer guest crm contact add' },
    { id: 'a-invoice', kind: 'action', label: 'New Invoice', hint: 'Bill a client at POS', icon: 'IN', path: '/pos', keywords: 'bill checkout receipt sale invoice' },
    { id: 'a-sale', kind: 'action', label: 'New Sale', hint: 'Fast POS checkout', icon: 'SL', path: '/pos', keywords: 'pos sell retail product checkout' },
    { id: 'a-membership', kind: 'action', label: 'New Membership', hint: 'Sell a membership or package', icon: 'MB', path: '/memberships', keywords: 'membership package loyalty credits prepaid' },
    { id: 'a-product', kind: 'action', label: 'New Product', hint: 'Add stock to inventory', icon: 'PR', path: '/inventory', keywords: 'inventory stock product item add' },
    { id: 'a-campaign', kind: 'action', label: 'New Campaign', hint: 'Launch a marketing campaign', icon: 'CP', path: '/marketing', keywords: 'marketing campaign whatsapp email sms promo' },
    // Navigation
    { id: 'n-dashboard', kind: 'nav', label: 'Dashboard', hint: 'Mission control overview', icon: 'D', path: '/dashboard', keywords: 'home kpi overview command' },
    { id: 'n-apps', kind: 'nav', label: 'All Apps', hint: 'Full module launchpad', icon: 'AP', path: '/apps', keywords: 'launchpad modules suite' },
    { id: 'n-calendar', kind: 'nav', label: 'Calendar', hint: 'Appointments & scheduling', icon: 'C', path: '/appointments', keywords: 'booking schedule appointment' },
    { id: 'n-clients', kind: 'nav', label: 'Clients', hint: 'Client CRM directory', icon: 'CL', path: '/clients', keywords: 'crm guest customer' },
    { id: 'n-customer360', kind: 'nav', label: 'Customer 360', hint: 'Client intelligence', icon: '360', path: '/customer-360', keywords: 'intelligence ltv churn segment' },
    { id: 'n-pos', kind: 'nav', label: 'POS Billing', hint: 'Point of sale checkout', icon: 'P', path: '/pos', keywords: 'billing checkout cashier' },
    { id: 'n-invoices', kind: 'nav', label: 'Invoices', hint: 'POS invoices & dues', icon: 'IN', path: '/pos/invoices', keywords: 'invoice receipt paid due' },
    { id: 'n-memberships', kind: 'nav', label: 'Memberships', hint: 'Memberships & packages', icon: 'MB', path: '/memberships', keywords: 'loyalty package credits' },
    { id: 'n-inventory', kind: 'nav', label: 'Inventory', hint: 'Stock & products', icon: 'I', path: '/inventory', keywords: 'stock product warehouse' },
    { id: 'n-suppliers', kind: 'nav', label: 'Suppliers', hint: 'Vendors & purchasing', icon: 'SP', path: '/suppliers', keywords: 'vendor purchase gst' },
    { id: 'n-services', kind: 'nav', label: 'Services', hint: 'Service catalog', icon: 'S', path: '/services', keywords: 'menu catalog pricing' },
    { id: 'n-staff', kind: 'nav', label: 'Staff', hint: 'Team, payroll & commissions', icon: 'T', path: '/staff-os/staff-list', keywords: 'employee team payroll commission' },
    { id: 'n-reports', kind: 'nav', label: 'Reports', hint: 'Business reports', icon: 'R', path: '/reports', keywords: 'sales report analytics' },
    { id: 'n-analytics', kind: 'nav', label: 'Analytics', hint: 'Insights & metrics', icon: 'AN', path: '/analytics', keywords: 'metrics insight kpi' },
    { id: 'n-marketing', kind: 'nav', label: 'Marketing', hint: 'Campaigns & automation', icon: 'MK', path: '/marketing', keywords: 'campaign automation' },
    { id: 'n-whatsapp', kind: 'nav', label: 'WhatsApp', hint: 'WhatsApp campaigns', icon: 'WA', path: '/whatsapp', keywords: 'whatsapp chat campaign' },
    { id: 'n-reviews', kind: 'nav', label: 'Reviews', hint: 'Reputation management', icon: 'RV', path: '/reputation', keywords: 'review reputation google rating' },
    { id: 'n-ai', kind: 'nav', label: 'AI Assistant', hint: 'AI workspace', icon: 'AI', path: '/ai', keywords: 'assistant ai chat copilot' },
    { id: 'n-finance', kind: 'nav', label: 'Finance', hint: 'Cash, expenses & ledger', icon: 'FN', path: '/finance', keywords: 'cash expense ledger accounting' },
    { id: 'n-branches', kind: 'nav', label: 'Branches', hint: 'Multi-branch management', icon: 'B', path: '/branches', keywords: 'branch location multi outlet' },
    { id: 'n-settings', kind: 'nav', label: 'Settings', hint: 'Settings records', icon: 'G', path: '/settings', keywords: 'settings records config preferences' },
    { id: 'n-general-settings', kind: 'nav', label: 'General Settings', hint: 'Workspace defaults', icon: 'GS', path: '/settings/general', keywords: 'general settings workspace defaults preferences' }
  ];

  readonly filtered = computed(() => {
    const term = this.query().trim().toLowerCase();
    const base = term ? this.entries.filter((e) =>
      `${e.label} ${e.hint} ${e.keywords || ''} ${e.kind}`.toLowerCase().includes(term)
    ) : this.entries;
    return base.filter((e) => this.canAccessPath(e.path));
  });

  readonly grouped = computed(() => {
    const items = this.filtered();
    const actions = items.filter((i) => i.kind === 'action');
    const nav = items.filter((i) => i.kind === 'nav');
    const groups: { label: string; items: CommandEntry[] }[] = [];
    if (actions.length) groups.push({ label: 'Quick create', items: actions });
    if (nav.length) groups.push({ label: 'Go to', items: nav });
    return groups;
  });

  constructor(
    private readonly router: Router,
    private readonly state: AppStateService,
    private readonly session: AuthSessionService,
    private readonly generalSettings: GeneralSettingsService
  ) {}

  @HostListener('window:keydown', ['$event'])
  onGlobalKey(event: KeyboardEvent): void {
    if (!this.generalSettings.commandSearchEnabled()) return;
    if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault();
      this.toggle();
    }
  }

  @HostListener('window:aura:command-palette:open')
  onOpenEvent(): void {
    if (!this.generalSettings.commandSearchEnabled()) return;
    this.openPalette();
  }

  toggle(): void {
    this.open() ? this.close() : this.openPalette();
  }

  openPalette(): void {
    if (!this.generalSettings.commandSearchEnabled()) return;
    this.query.set('');
    this.open.set(true);
    this.syncActive();
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.cmdk-input');
      input?.focus();
    });
  }

  close(): void {
    this.open.set(false);
  }

  onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.syncActive();
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { this.close(); return; }
    const items = this.filtered();
    if (!items.length) return;
    const idx = Math.max(0, items.findIndex((i) => i.id === this.activeId()));
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeId.set(items[(idx + 1) % items.length].id);
      this.scrollActiveIntoView();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeId.set(items[(idx - 1 + items.length) % items.length].id);
      this.scrollActiveIntoView();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const current = items.find((i) => i.id === this.activeId()) || items[0];
      if (current) this.run(current);
    }
  }

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  run(item: CommandEntry): void {
    this.close();
    this.router.navigateByUrl(item.path);
  }

  private syncActive(): void {
    const items = this.filtered();
    if (!items.some((i) => i.id === this.activeId())) {
      this.activeId.set(items[0]?.id || '');
    }
  }

  private scrollActiveIntoView(): void {
    setTimeout(() => {
      document.querySelector(`.cmdk-item[data-id="${this.activeId()}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  }
}
