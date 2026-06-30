import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiRecord, ApiService } from './core/api.service';
import { AuthSessionService } from './core/auth-session.service';
import { I18nService, LocalePreference } from './core/i18n.service';
import { grantsAllow, staticGrantsForRole } from './core/permission.guard';
import { AppStateService, UserRole } from './core/state/app-state.service';
import { AutoNameCaseDirective } from './shared/directives/auto-name-case.directive';
import { CommandPaletteComponent } from './shared/ui/command-palette/command-palette.component';
import { HeaderActionsComponent } from './shared/ui/header-actions/header-actions.component';
import { WorkspaceSwitcherComponent } from './shared/ui/workspace-switcher/workspace-switcher.component';

type NavItem = {
  path: string;
  label: string;
  icon: string;
  keywords?: string;
  queryParams?: Record<string, string>;
  permission?: string | string[];
  children?: NavItem[];
};

type NavGroup = {
  id: string;
  label: string;
  icon: string;
  primaryPath: string;
  items: NavItem[];
};

type ActiveNavTabGroup = {
  groupLabel: string;
  path: string;
  label: string;
  icon: string;
  children: NavItem[];
};

type ActiveStaffLocalNav = {
  path: string;
  label: string;
  icon: string;
  children: NavItem[];
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink, RouterLinkActive, RouterOutlet, CommandPaletteComponent, HeaderActionsComponent, WorkspaceSwitcherComponent],
  hostDirectives: [AutoNameCaseDirective],
  template: `
    <ng-container *ngIf="!session.isAuthenticated() && !isPortal(); else authenticatedApp">
      <main class="auth-shell">
        <section class="auth-card" aria-label="Aura Salon OS secure login">
          <header class="auth-card-head">
            <div class="auth-brand-lockup">
              <span class="auth-brand-mark">Aura Shine</span>
              <span class="auth-brand-kicker">Enterprise Salon OS</span>
            </div>
            <div>
              <span class="eyebrow">Secure sign in</span>
              <h1>Aura Salon OS</h1>
              <p>Use your owner-created email or staff login ID to open the correct tenant and branch workspace.</p>
            </div>
          </header>

          <form [formGroup]="loginForm" (ngSubmit)="login()" class="auth-form-grid">
            <label class="field enterprise-field">
              <span>Tenant ID</span>
              <input formControlName="tenantId" autocomplete="organization" />
            </label>
            <label class="field enterprise-field">
              <span>Email or Login ID</span>
              <input formControlName="email" autocomplete="username" placeholder="owner@aurasalon.example" />
            </label>
            <label class="field enterprise-field">
              <span>Password</span>
              <div class="auth-input-action">
                <input
                  formControlName="password"
                  [type]="passwordVisible() ? 'text' : 'password'"
                  autocomplete="current-password"
                  (keyup)="captureCapsLock($event)"
                  (blur)="clearCapsLock()"
                />
                <button type="button" [attr.aria-pressed]="passwordVisible()" (click)="passwordVisible.set(!passwordVisible())">
                  {{ passwordVisible() ? 'Hide' : 'Show' }}
                </button>
              </div>
            </label>
            <label class="field enterprise-field">
              <span>Branch ID</span>
              <input formControlName="branchId" placeholder="Optional branch ID" />
            </label>
            <label class="field full enterprise-field" *ngIf="requiresTotp()">
              <span>Authenticator or recovery code</span>
              <input formControlName="totpToken" autocomplete="one-time-code" inputmode="numeric" placeholder="6-digit code or recovery code" />
            </label>

            <div class="auth-form-options full">
              <label class="auth-checkline">
                <input type="checkbox" [checked]="rememberLoginContext()" (change)="toggleRememberLoginContext($event)" />
                <span>Remember tenant and branch</span>
              </label>
            </div>

            <div class="state warning full" *ngIf="capsLockOn()">Caps Lock is on. Passwords are case-sensitive.</div>
            <div class="state error full" *ngIf="loginError()">{{ loginError() }}</div>

            <button class="primary-button auth-submit-button full" type="submit" [disabled]="loginForm.invalid || loginBusy()">
              {{ loginButtonLabel() }}
            </button>
          </form>
        </section>
      </main>
    </ng-container>

    <ng-template #authenticatedApp>
    <ng-container *ngIf="isPortal(); else adminShell">
      <div class="portal-shell">
        <button
          class="ghost-button portal-back-button"
          type="button"
          *ngIf="previousRoute()"
          (click)="goBack()"
          [attr.aria-label]="backButtonLabel()"
          [title]="backButtonLabel()"
        >
          <span aria-hidden="true">&larr;</span>
          <span>Back</span>
        </button>
        <router-outlet></router-outlet>
      </div>
    </ng-container>

    <ng-template #adminShell>
    <div class="app-shell" [class.sidebar-is-compact]="sidebarUiCompact()">
      <aside
        class="sidebar enterprise-sidebar inline-app-sidebar"
        [class.sidebar-compact]="sidebarUiCompact()"
        (mouseenter)="openSidebarPreview()"
        (mouseleave)="closeSidebarPreview()"
        (focusin)="openSidebarPreview()"
        (focusout)="closeSidebarPreview($event)"
      >
        <div class="sidebar-brand-row">
          <a class="brand" routerLink="/home" aria-label="Aura Shine home">
            <span class="brand-mark" aria-hidden="true">AS</span>
            <span>
              <strong>Aura Shine</strong>
              <small>Enterprise CRM / POS</small>
            </span>
          </a>
          <button class="sidebar-toggle" type="button" (click)="toggleSidebarCompact()" [attr.aria-pressed]="sidebarCompact()" [title]="sidebarCompact() ? 'Expand sidebar' : 'Collapse sidebar'">
            {{ sidebarCompact() ? '>>' : '<<' }}
          </button>
        </div>

        <label class="sidebar-search" *ngIf="!sidebarUiCompact()">
          <span>{{ i18n.t('shell.findModule', 'Find module') }}</span>
          <input [ngModel]="navQuery()" (ngModelChange)="navQuery.set($event)" [placeholder]="i18n.t('shell.searchPlaceholder', 'Search POS, staff, reports')" />
          <button class="sidebar-search-clear" type="button" *ngIf="navQuery()" (click)="navQuery.set('')">Clear</button>
        </label>

        <nav class="nav-list nav-accordion" aria-label="Primary navigation">
          <section class="nav-section" *ngFor="let group of visibleNavGroups()" [class.active-section]="isGroupActive(group)" [class.expanded]="isGroupExpanded(group)">
            <button class="nav-section-trigger" type="button" (click)="openNavGroup(group)" [attr.aria-expanded]="isGroupExpanded(group)" [title]="group.label">
              <span class="nav-icon" aria-hidden="true">{{ group.icon }}</span>
              <span class="nav-section-copy">
                <strong>{{ group.label }}</strong>
                <small>{{ navLeafCount(group.items) }} {{ i18n.t('shell.modules', 'modules') }}</small>
              </span>
              <span class="nav-count">{{ navLeafCount(group.items) }}</span>
            </button>
            <div class="nav-section-items" *ngIf="!sidebarUiCompact() && (navQuery() || isGroupExpanded(group))">
              <ng-container *ngFor="let item of group.items">
                <div class="nav-subgroup" *ngIf="item.children?.length; else singleNavItem">
                  <a
                    class="nav-subgroup-title"
                    [class.active]="isNavItemActive(item)"
                    [routerLink]="item.path"
                    routerLinkActive="active"
                    (click)="rememberNavGroup(group.id)"
                  >
                    <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
                    <span>{{ item.label }}</span>
                    <small>{{ item.children?.length }}</small>
                  </a>
                </div>
                <ng-template #singleNavItem>
                  <a
                    class="nav-subitem"
                    [class.active]="isNavItemActive(item)"
                    [routerLink]="item.path"
                    routerLinkActive="active"
                    [routerLinkActiveOptions]="{ exact: item.path === '/home' || item.path === '/dashboard' }"
                    (click)="rememberNavGroup(group.id)"
                  >
                    <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
                    <span>{{ item.label }}</span>
                  </a>
                </ng-template>
              </ng-container>
            </div>
          </section>
          <div class="nav-empty" *ngIf="!visibleNavGroups().length && !sidebarUiCompact()">
            <strong>{{ i18n.t('shell.noModule', 'No module found') }}</strong>
            <button class="ghost-button mini" type="button" (click)="navQuery.set('')">{{ i18n.t('shell.resetSearch', 'Reset search') }}</button>
          </div>
        </nav>

        <section class="sidebar-callout">
          <span class="eyebrow">{{ i18n.t('shell.sidebarTenant', 'SaaS tenant') }}</span>
          <strong>{{ state.tenantScopeLabel() }}</strong>
          <p>{{ i18n.t('shell.scopeCopy', 'Tenant, branch and role headers scope every API call.') }}</p>
        </section>
      </aside>

      <main class="workspace" id="main-content">
        <header class="topbar">
          <div class="topbar-brand-title">
            <h1>Aura Shine OS</h1>
          </div>
          <div class="topbar-actions">
            <aura-workspace-switcher
              [tenants]="tenants()"
              [branches]="branches()"
              (tenantChange)="selectTenant($event)"
              (branchChange)="selectBranch($event)"
              (roleChange)="selectRole($any($event))"
              (countryChange)="selectCountry($event)"
              (languageChange)="selectLanguage($event)">
            </aura-workspace-switcher>
            <a class="dark-button" routerLink="/pos">{{ i18n.t('shell.fastPos', 'Fast POS') }}</a>
            <span class="topbar-divider" aria-hidden="true"></span>
            <aura-header-actions></aura-header-actions>
          </div>
        </header>
        <div class="state error" *ngIf="globalError()">
          {{ globalError() }}
          <button class="ghost-button mini" type="button" (click)="globalError.set('')">{{ i18n.t('shell.dismiss', 'Dismiss') }}</button>
        </div>

        <section
          class="workspace-page-tabs"
          [class.workspace-page-tabs--dense]="tabs.groupLabel === 'Staff OS'"
          *ngIf="activePageTabs() as tabs"
          aria-label="Related pages"
        >
          <div class="workspace-page-tabs-head">
            <button
              class="ghost-button page-context-back-button"
              type="button"
              (click)="goBack()"
              [attr.aria-label]="backButtonLabel()"
              [title]="backButtonLabel()"
            >
              <span aria-hidden="true">&larr;</span>
              <span>Back</span>
            </button>
            <span class="nav-icon" aria-hidden="true">{{ tabs.icon }}</span>
            <div>
              <span class="eyebrow">{{ tabs.groupLabel }}</span>
              <strong>{{ tabs.label }}</strong>
            </div>
          </div>
          <nav class="workspace-page-tabs-nav" aria-label="Page sections">
            <a
              *ngFor="let tab of tabs.children"
              class="workspace-page-tab"
              [routerLink]="tab.path"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: tab.path === tabs.path || tab.path === '/home' || tab.path === '/dashboard' }"
            >
              <span class="nav-icon" aria-hidden="true">{{ tab.icon }}</span>
              <span>{{ tab.label }}</span>
            </a>
          </nav>
        </section>

        <section class="workspace-route-shell" [class.workspace-route-shell--staff]="activeStaffLocalNav() !== null">
          <aside class="staff-local-rail" *ngIf="activeStaffLocalNav() as staffNav" aria-label="Staff OS local navigation">
            <div class="staff-local-rail-head">
              <span class="nav-icon" aria-hidden="true">{{ staffNav.icon }}</span>
              <div>
                <span class="eyebrow">Staff OS</span>
                <strong>{{ staffNav.label }}</strong>
              </div>
            </div>
            <nav class="staff-local-nav" aria-label="Staff OS route group">
              <a
                *ngFor="let item of staffNav.children"
                [routerLink]="item.path"
                [queryParams]="item.queryParams || null"
                [class.active]="isStaffLocalNavItemActive(item)"
              >
                <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
                <span>{{ item.label }}</span>
              </a>
            </nav>
          </aside>
          <div class="workspace-route-content">
            <router-outlet></router-outlet>
          </div>
        </section>
      </main>
      <aura-command-palette></aura-command-palette>
      <a class="ai-fab" routerLink="/ai" aria-label="Ask Aura AI assistant" title="Ask Aura AI">
        <svg class="ai-fab-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d="M5 3h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H10l-4.6 3.45A1 1 0 0 1 4 19.6V17a3 3 0 0 1-1-2.24V6a3 3 0 0 1 3-3z"/>
          <circle cx="8.5" cy="10" r="1.25" fill="#7c3aed"/>
          <circle cx="12" cy="10" r="1.25" fill="#7c3aed"/>
          <circle cx="15.5" cy="10" r="1.25" fill="#7c3aed"/>
        </svg>
      </a>
    </div>
    </ng-template>
    </ng-template>
  `,
  styles: [`
    .workspace-route-shell {
      display: block;
      min-width: 0;
    }

    .workspace-route-shell--staff {
      display: grid;
      grid-template-columns: 204px minmax(0, 1fr);
      align-items: stretch;
      min-height: calc(100vh - 150px);
      border: 1px solid #d7e4ec;
      background: #fff;
    }

    .workspace-route-content {
      min-width: 0;
    }

    .staff-local-rail {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      background: linear-gradient(180deg, #ffffff 0%, #f8fbfa 100%);
      border-right: 1px solid #d7e4ec;
      min-width: 0;
    }

    .staff-local-rail-head {
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      padding: 8px 6px 10px;
      border-bottom: 1px solid #e4ecef;
    }

    .staff-local-rail-head strong {
      display: block;
      color: #123a36;
      font-size: 14px;
      line-height: 1.2;
    }

    .staff-local-nav {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .staff-local-nav a {
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr);
      align-items: center;
      gap: 9px;
      min-height: 38px;
      padding: 6px 8px;
      color: #1f2a3d;
      text-decoration: none;
      border: 1px solid transparent;
      border-radius: 8px;
      font-weight: 800;
      font-size: 13px;
      line-height: 1.2;
    }

    .staff-local-nav a.active,
    .staff-local-nav a:hover,
    .staff-local-nav a:focus-visible {
      background: #e8f7f4;
      color: #005f58;
      border-color: #a9d8d1;
      outline: none;
    }

    @media (max-width: 760px) {
      .workspace-route-shell--staff {
        grid-template-columns: 1fr;
      }

      .staff-local-rail {
        border-right: 0;
        border-bottom: 1px solid #d7e4ec;
      }

      .staff-local-nav {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      }
    }
  `]
})
export class AppComponent {
  private readonly fb = inject(FormBuilder);
  readonly branches = signal<ApiRecord[]>([]);
  readonly tenants = signal<ApiRecord[]>([]);
  readonly isPortal = signal(false);
  readonly globalError = signal('');
  readonly loginBusy = signal(false);
  readonly loginError = signal('');
  readonly requiresTotp = signal(false);
  readonly passwordVisible = signal(false);
  readonly capsLockOn = signal(false);
  readonly rememberLoginContext = signal(this.readRememberLoginContext());
  readonly loginForm = this.fb.group({
    tenantId: [this.savedLoginValue('tenantId', 'tenant_aura'), Validators.required],
    email: [this.savedLoginValue('email', 'owner@aurasalon.example'), Validators.required],
    password: ['', Validators.required],
    branchId: [this.savedLoginValue('branchId', '')],
    totpToken: ['']
  });

  readonly loginButtonLabel = computed(() => this.loginBusy()
    ? 'Signing in...'
    : this.requiresTotp()
      ? 'Verify & sign in'
      : 'Sign in securely');

  readonly navQuery = signal('');
  readonly activeRoute = signal('');
  readonly previousRoute = signal('');
  readonly sidebarCompact = signal(this.readInitialSidebarCompact());
  readonly sidebarHoverExpanded = signal(false);
  readonly sidebarUiCompact = computed(() => this.sidebarCompact() && !this.sidebarHoverExpanded());
  readonly expandedGroupIds = signal<string[]>(this.readExpandedGroups());
  private loadedLocalizationTenantId = '';
  private readonly navPermissionRules: Array<{ pattern: RegExp; permission: string | string[] }> = [
    { pattern: /^\/(security|enterprise-security-shield|security-alerts|security-blocklist|security-policy-center|permissions|compliance|audit-compliance|two-factor)/, permission: ['read:security', 'write:security', 'admin:security'] },
    { pattern: /^\/(business-details|settings|branches|white-label|localization)/, permission: ['read:settings', 'write:settings', 'read:branches', 'write:branches'] },
    { pattern: /^\/(appointments|appointment-activity|scheduler|staff\/my-work)/, permission: 'read:appointments' },
    { pattern: /^\/appointment-deposits/, permission: 'read:appointment_deposits' },
    { pattern: /^\/(clients|client-masters|customer-360)/, permission: ['read:clients', 'read:customer-360'] },
    { pattern: /^\/(pos|cash-drawer|checkout|sales)/, permission: ['read:pos', 'read:sales', 'read:invoices'] },
    { pattern: /^\/(billing|invoices|payments)/, permission: ['read:invoices', 'read:payments', 'read:finance'] },
    { pattern: /^\/(inventory|products)/, permission: ['read:inventory', 'read:products'] },
    { pattern: /^\/suppliers/, permission: 'read:suppliers' },
    { pattern: /^\/(services|packages)/, permission: 'read:services' },
    { pattern: /^\/(memberships|gift-cards|loyalty)/, permission: ['read:memberships', 'read:services'] },
    { pattern: /^\/(staff|staff-os|staff-enterprise|payroll|commissions)/, permission: 'read:staff' },
    { pattern: /^\/(finance|account-master|balance-sheet|transactions)/, permission: 'read:finance' },
    { pattern: /^\/(reports|analytics|kpi-details|predictive-forecasting|data-warehouse|kpi-monitoring)/, permission: ['read:reports', 'read:analytics'] },
    { pattern: /^\/(marketing|growth-rank-bot|growth-advisor|discount-rules|reputation|coupons)/, permission: 'read:marketing' },
    { pattern: /^\/(whatsapp|message-logs)/, permission: 'read:whatsapp' },
    { pattern: /^\/(ai|command-center|image-analysis|recommendation-engine|knowledge-base|gamification|fraud-detection|appointment-optimization|dynamic-pricing|pricing)/, permission: 'read:ai' },
    { pattern: /^\/smart-booking/, permission: 'read:smart-booking' },
    { pattern: /^\/(book|online-booking)/, permission: 'read:booking-portal' },
    { pattern: /^\/offline/, permission: 'read:offline' },
    { pattern: /^\/workflows/, permission: 'read:workflows' },
    { pattern: /^\/quality/, permission: 'read:quality' },
    { pattern: /^\/deployment/, permission: 'read:deployment' },
    { pattern: /^\/data-migration/, permission: 'read:migration' },
    { pattern: /^\/(developer-api|webhooks|plugins|app-marketplace|marketplace-integrations)/, permission: ['read:developer-api', 'read:plugins', 'read:marketplace-integrations'] },
    { pattern: /^\/(franchise|training-academy)/, permission: 'read:franchise' }
  ];

  readonly favoriteNavItems: NavItem[] = [
    { path: '/home', label: 'Home', icon: 'HM', keywords: 'home dashboard kpi overview' },
    { path: '/apps', label: 'All Apps', icon: 'AP', keywords: 'launchpad modules full suite apps' },
    { path: '/growth-rank-bot', label: 'AI Rank Bot', icon: 'RB', keywords: 'instagram facebook google rank local seo ai growth bot' },
    { path: '/appointments', label: 'Calendar', icon: 'C', keywords: 'booking appointment schedule enterprise scheduler staff calendar' },
    { path: '/appointment-activity', label: 'Appt Activity', icon: 'AA', keywords: 'appointment audit cancellation reschedule no show reliability' },
    { path: '/salon-3d', label: '3D Salon', icon: '3D', keywords: 'public salon website three dimensional booking' },
    { path: '/clients', label: 'Clients', icon: 'CL', keywords: 'crm guest customer' },
    { path: '/pos', label: 'POS', icon: 'P', keywords: 'billing checkout' },
    { path: '/pos/invoices', label: 'Invoices', icon: 'IN', keywords: 'invoice receipt due paid' },
    { path: '/reports/invoices', label: 'Invoice Reports', icon: 'IR', keywords: 'invoice reports gst staff discount product membership due wallet' },
    { path: '/memberships', label: 'Memberships', icon: 'MB', keywords: 'membership loyalty packages credits renewal' },
    { path: '/suppliers', label: 'Suppliers', icon: 'SP', keywords: 'vendor purchase gst' },
    { path: '/reports', label: 'Reports', icon: 'R', keywords: 'analytics sales report' },
    { path: '/staff-os/staff-list', label: 'Staff', icon: 'T', keywords: 'employee team payroll' },
    { path: '/staff/my-work', label: 'My Work', icon: 'MW', keywords: 'staff own report live appointments' }
  ];

  readonly navGroups: NavGroup[] = [
    {
      id: 'command',
      label: 'Command',
      icon: 'CM',
      primaryPath: '/home',
      items: [
        {
          path: '/home',
          label: 'Home & Apps',
          icon: 'HA',
          keywords: 'home dashboard overview kpi owner launchpad apps modules suite',
          children: [
            { path: '/home', label: 'Home', icon: 'HM', keywords: 'home dashboard overview kpi owner' },
            { path: '/apps', label: 'All Apps', icon: 'AP', keywords: 'launchpad modules full suite salon apps' }
          ]
        },
        {
          path: '/command-center',
          label: 'Command Center',
          icon: 'CC',
          keywords: 'control tower enterprise ai workforce owner command approval data warehouse',
          children: [
            { path: '/command-center/ai-workforce-dashboard', label: 'AI Workforce', icon: 'AW', keywords: 'ai workforce dashboard' },
            { path: '/command-center/owner-command-center', label: 'Owner Command', icon: 'OC', keywords: 'owner command center' },
            { path: '/command-center/ai-ceo-daily-brief', label: 'CEO Brief', icon: 'CB', keywords: 'ceo daily brief ai' },
            { path: '/command-center/approval-hub', label: 'Approval Hub', icon: 'AH', keywords: 'approval hub command center' },
            { path: '/command-center/engagement', label: 'Engagement', icon: 'EC', keywords: 'hyperconnect unified inbox whatsapp client engagement' },
            { path: '/command-center/data-warehouse', label: 'Data Warehouse', icon: 'DW', keywords: 'data warehouse snapshots command center' }
          ]
        },
        {
          path: '/analytics',
          label: 'Insights & Reports',
          icon: 'IR',
          keywords: 'analytics reports invoice kpi monitor forecast prediction revenue',
          children: [
            { path: '/analytics', label: 'Analytics', icon: 'AN', keywords: 'metrics insight kpi' },
            { path: '/reports', label: 'Reports', icon: 'R', keywords: 'sales business reports' },
            { path: '/reports/invoices', label: 'Invoice Reports', icon: 'IR', keywords: 'invoice staff discount gst product membership wallet due audit reports' },
            { path: '/kpi-monitoring', label: 'KPI Monitor', icon: 'KM', keywords: 'monitor alerts targets' },
            { path: '/predictive-forecasting', label: 'Forecast AI', icon: 'PF', keywords: 'forecast prediction revenue' }
          ]
        }
      ]
    },
    {
      id: 'frontdesk',
      label: 'Front Desk',
      icon: 'FD',
      primaryPath: '/appointments',
      items: [
        {
          path: '/appointments',
          label: 'Appointments',
          icon: 'AP',
          keywords: 'appointments booking calendar schedule activity deposits smart booking queue walkin',
          children: [
            { path: '/appointments', label: 'Calendar', icon: 'C', keywords: 'appointments booking schedule enterprise scheduler zenoti dingg fresha boulevard staff multi service booking' },
            { path: '/appointment-activity', label: 'Activity Center', icon: 'AC', keywords: 'appointment audit cancellation reschedule no show reliability' },
            { path: '/appointment-deposits', label: 'Deposit Report', icon: 'DP', keywords: 'appointment advance payment deposit report no show cancellation' },
            { path: '/smart-booking', label: 'Smart Booking', icon: 'SB', keywords: 'ai booking slot' },
            { path: '/queue-system', label: 'Queue TV', icon: 'QT', keywords: 'walkin queue display' }
          ]
        },
        {
          path: '/salon-3d',
          label: 'Online Booking',
          icon: 'OB',
          keywords: 'public website online booking portal salon 3d customer booking',
          children: [
            { path: '/salon-3d', label: '3D Salon Website', icon: '3D', keywords: 'public website three dimensional salon landing booking' },
            { path: '/book', label: 'Booking Site', icon: 'OB', keywords: 'online booking portal' }
          ]
        },
        {
          path: '/customer-360',
          label: 'Clients',
          icon: 'CL',
          keywords: 'customer 360 client crm masters consultation feedback preferences',
          children: [
            { path: '/customer-360', label: 'Customer 360', icon: '360', keywords: 'customer intelligence guest' },
            { path: '/clients', label: 'Client CRM', icon: 'CL', keywords: 'client guest crm' },
            { path: '/client-masters', label: 'Client Masters', icon: 'CM', keywords: 'flexi client masters category source consultation feedback preferences' }
          ]
        }
      ]
    },
    {
      id: 'pos',
      label: 'POS',
      icon: 'POS',
      primaryPath: '/pos',
      items: [
        {
          path: '/pos',
          label: 'Checkout',
          icon: 'CK',
          keywords: 'pos checkout bill billing holds tips payment modes',
          children: [
            { path: '/pos', label: 'POS Billing', icon: 'P', keywords: 'checkout bill billing' },
            { path: '/pos/holds', label: 'Hold Invoices', icon: 'HI', keywords: 'hold pending invoice' },
            { path: '/pos/tips', label: 'Tip Register', icon: 'TP', keywords: 'tips staff tip' },
            { path: '/pos/payment-modes', label: 'Payment Modes', icon: 'PM', keywords: 'cash card upi payment' }
          ]
        },
        {
          path: '/pos/invoices',
          label: 'Invoices & Billing',
          icon: 'IN',
          keywords: 'invoice paid due received billing refunds reconciliation daily closing',
          children: [
            { path: '/pos/invoices', label: 'POS Invoices', icon: 'PI', keywords: 'invoice paid due received' },
            { path: '/billing', label: 'Enterprise Billing', icon: 'EB', keywords: 'billing refunds reconciliation daily closing enterprise' }
          ]
        },
        {
          path: '/memberships',
          label: 'Sales Catalog',
          icon: 'SC',
          keywords: 'membership sales packages prepaid credits bundle loyalty redemption',
          children: [
            { path: '/memberships', label: 'Membership Sales', icon: 'MS', keywords: 'membership sale pos loyalty credits redemption' },
            { path: '/packages', label: 'Packages', icon: 'PK', keywords: 'package prepaid credits bundle' }
          ]
        }
      ]
    },
    {
      id: 'inventory',
      label: 'Inventory',
      icon: 'INV',
      primaryPath: '/inventory',
      items: [
        {
          path: '/inventory',
          label: 'Stock Control',
          icon: 'SC',
          keywords: 'stock products inventory purchase reorder supplier audit barcode scanner',
          children: [
            { path: '/inventory', label: 'Inventory', icon: 'I', keywords: 'stock products inventory' },
            { path: '/inventory/purchase-bill-drafts', label: 'AI Bill Drafts', icon: 'AI', keywords: 'ai purchase bill scanner draft invoice receiving' },
            { path: '/inventory/purchase-orders', label: 'Purchase Orders', icon: 'PO', keywords: 'purchase order po vendor' },
            { path: '/inventory/reorder', label: 'AI Reorder', icon: 'AR', keywords: 'low stock reorder purchase prediction approval' },
            { path: '/suppliers', label: 'Suppliers', icon: 'SP', keywords: 'supplier vendor gst purchase' },
            { path: '/inventory/stock-audit', label: 'Stock Audit', icon: 'SA', keywords: 'audit count stock' },
            { path: '/inventory/scanner', label: 'Inventory Scanner', icon: 'QR', keywords: 'barcode scanner qr' }
          ]
        },
        {
          path: '/services',
          label: 'Catalog & Usage',
          icon: 'CU',
          keywords: 'services recipes fifo product consume cogs margin expiry inventory reports finance',
          children: [
            { path: '/services', label: 'Services', icon: 'S', keywords: 'service menu catalog' },
            { path: '/inventory/recipes', label: 'Service Recipes', icon: 'BOM', keywords: 'bom recipe service consumption' },
            { path: '/inventory/fifo', label: 'FIFO Batches', icon: 'FF', keywords: 'fifo batch expiry next stock consume' },
            { path: '/inventory/product-consume', label: 'Product Consume', icon: 'PC', keywords: 'invoice service recipe product consume stock deduction cogs' },
            { path: '/inventory/financial', label: 'Inventory Finance', icon: 'IF', keywords: 'cogs cash margin dead stock financial' },
            { path: '/inventory/reports', label: 'Inventory Reports', icon: 'IR', keywords: 'cogs margin expiry report' }
          ]
        }
      ]
    },
    {
      id: 'staff',
      label: 'Staff',
      icon: 'ST',
      primaryPath: '/staff-os/staff-list',
      items: [
        {
          path: '/staff-os/staff-list',
          label: 'Staff Setup',
          icon: 'SS',
          keywords: 'staff employee setup masters directory category profile bulk update service assignment connected modules',
          children: [
            { path: '/staff-os/workspace', label: 'Command Center', icon: 'CC', keywords: 'staff workspace command center' },
            { path: '/staff-os/employee-masters', label: 'Employee Masters', icon: 'EM', keywords: 'employee masters staff setup statutory profile category salary' },
            { path: '/staff-os/staff-list', label: 'Staff List', icon: 'SL', keywords: 'employee list staff directory active inactive' },
            { path: '/staff-os/staff-categories', label: 'Staff Categories', icon: 'SC', keywords: 'staff category designation role operator admin' },
            { path: '/staff-os/staff-profile', label: 'Staff Profile', icon: 'SP', keywords: 'staff profile documents skills login' },
            { path: '/staff-os/bulk-employee-update', label: 'Bulk Update', icon: 'BU', keywords: 'bulk master update employee pan aadhar statutory flexi' },
            { path: '/staff-os/service-assignment', label: 'Service Assignment', icon: 'SA', keywords: 'employee wise service assign operator admin flexi' },
            { path: '/staff/connected-modules', label: 'Connected Modules', icon: 'CM', keywords: 'staff connected modules employee payroll attendance services reports' }
          ]
        },
        {
          path: '/staff-os/attendance-dashboard',
          label: 'Attendance & Shifts',
          icon: 'AS',
          keywords: 'attendance roster shift face punch present absent late',
          children: [
            { path: '/staff-os/attendance-dashboard', label: 'Attendance', icon: 'AT', keywords: 'attendance dashboard biometric present absent late' },
            { path: '/staff-os/face-punch', label: 'Face Punch', icon: 'FP', keywords: 'face punch camera attendance check in checkout' },
            { path: '/staff-os/attendance-master', label: 'Attendance Master', icon: 'AM', keywords: 'attendance master absent present holiday day count paid unpaid' },
            { path: '/staff-os/attendance-category', label: 'Attendance Category', icon: 'AC', keywords: 'attendance category late mark overtime shift slabs' },
            { path: '/staff-os/shift-master', label: 'Shift Master', icon: 'SM', keywords: 'shift master start time end time weekly off holiday leave' },
            { path: '/staff-os/roster-calendar', label: 'Roster Calendar', icon: 'RC', keywords: 'roster schedule shift calendar availability' }
          ]
        },
        {
          path: '/staff-os/leave-management',
          label: 'Leave & Heatmaps',
          icon: 'LH',
          keywords: 'leave heatmap calendar roster attendance coverage demand',
          children: [
            { path: '/staff-os/leave-management', label: 'Leave Management', icon: 'LM', keywords: 'leave request approval balance calendar' },
            { path: '/staff-os/leave-master', label: 'Leave Master', icon: 'LV', keywords: 'leave master casual paid sick quota monthly yearly' },
            { path: '/staff-os/heatmaps/roster', label: 'Roster Heatmap', icon: 'RH', keywords: 'roster heatmap coverage demand' },
            { path: '/staff-os/heatmaps/attendance', label: 'Attendance Heatmap', icon: 'AH', keywords: 'attendance heatmap late absent present' },
            { path: '/staff-os/heatmaps/leave-calendar', label: 'Leave Calendar Heatmap', icon: 'LH', keywords: 'leave calendar heatmap coverage' }
          ]
        },
        {
          path: '/staff-os/payroll-dashboard',
          label: 'Payroll',
          icon: 'PY',
          keywords: 'payroll salary fines allowance deduction payout rules payroll cost heatmap',
          children: [
            { path: '/staff-os/payroll-dashboard', label: 'Payroll Dashboard', icon: 'PD', keywords: 'payroll export salary payout statutory' },
            { path: '/staff-os/payroll-rules', label: 'Payroll Rules', icon: 'PR', keywords: 'payroll rules overtime week off salary formula' },
            { path: '/staff-os/payroll-salary-structure', label: 'Salary Structure', icon: 'SS', keywords: 'payroll salary structure pf pt esic tds statutory flexi' },
            { path: '/staff-os/salary-generate', label: 'Salary Generate', icon: 'SG', keywords: 'generate salary payroll preview commission attendance leave' },
            { path: '/staff-os/salary-workspace', label: 'Salary Workspace', icon: 'SW', keywords: 'salary workspace staff salary setup' },
            { path: '/staff-os/fines-penalties', label: 'Fines / Penalty', icon: 'FN', keywords: 'fine penalty master payroll flexi' },
            { path: '/staff-os/allowance-deduction', label: 'Allowance / Deduction', icon: 'AD', keywords: 'allowance deduction payroll master flexi' },
            { path: '/staff-os/heatmaps/payroll-cost', label: 'Payroll Cost Heatmap', icon: 'PH', keywords: 'payroll cost heatmap salary overtime' }
          ]
        },
        {
          path: '/staff-os/commission-dashboard',
          label: 'Incentives',
          icon: 'IN',
          keywords: 'commission incentives target service product membership branch admin all transaction payout rules',
          children: [
            { path: '/staff-os/commission-dashboard', label: 'Commission Dashboard', icon: 'CD', keywords: 'commission rules payout incentive' },
            { path: '/commissions', label: 'Commission Rules', icon: 'CR', keywords: 'commission policies rules payroll calculations' },
            { path: '/staff-os/target-incentives/service', label: 'Service Incentives', icon: 'SI', keywords: 'service target incentive slabs flexi commission' },
            { path: '/staff-os/target-incentives/product', label: 'Product Incentives', icon: 'PI', keywords: 'product target incentive commission retail' },
            { path: '/staff-os/target-incentives/membership', label: 'Membership Incentives', icon: 'MI', keywords: 'membership target incentive sales' },
            { path: '/staff-os/target-incentives/branch-admin', label: 'Branch Incentives', icon: 'BI', keywords: 'branch admin target incentive' },
            { path: '/staff-os/target-incentives/admin', label: 'Admin Incentives', icon: 'AI', keywords: 'admin target incentive master' },
            { path: '/staff-os/target-incentives/all-transaction', label: 'All Transaction Incentives', icon: 'TI', keywords: 'all transaction target incentive' }
          ]
        },
        {
          path: '/staff-os/performance-dashboard',
          label: 'Performance & Reports',
          icon: 'PR',
          keywords: 'performance leaderboard training tasks mobile preview staff sales my work utilization reports',
          children: [
            { path: '/staff-os/performance-dashboard', label: 'Performance Dashboard', icon: 'PF', keywords: 'performance productivity staff ranking' },
            { path: '/staff-os/leaderboard', label: 'Leaderboard', icon: 'LB', keywords: 'leaderboard staff ranking gamification' },
            { path: '/staff-os/training-center', label: 'Training Center', icon: 'TC', keywords: 'training staff lessons certification' },
            { path: '/training-academy', label: 'Training Academy', icon: 'TA', keywords: 'training academy lessons quizzes certifications learning paths' },
            { path: '/staff-os/task-board', label: 'Task Board', icon: 'TB', keywords: 'staff task board task assignment followup' },
            { path: '/staff-os/mobile-preview', label: 'Mobile Preview', icon: 'MP', keywords: 'mobile staff dashboard preview app' },
            { path: '/staff-os/heatmaps/utilization', label: 'Utilization Heatmap', icon: 'UH', keywords: 'utilization heatmap performance productivity' },
            { path: '/reports/staff-sales', label: 'Staff Sales', icon: 'SR', keywords: 'staff sales report revenue services products tips performance' },
            { path: '/staff/my-work', label: 'My Work', icon: 'MW', keywords: 'staff login live appointments own work report' }
          ]
        }
      ]
    },
    {
      id: 'finance',
      label: 'Finance',
      icon: 'FN',
      primaryPath: '/finance',
      items: [
        {
          path: '/finance',
          label: 'Cash & Ledger',
          icon: 'CL',
          keywords: 'cash expense finance account master ledger outgoing funds payments',
          children: [
            { path: '/finance', label: 'Finance', icon: 'FN', keywords: 'cash expense finance' },
            { path: '/account-master', label: 'Account Master', icon: 'AM', keywords: 'ledger accounts chart' },
            { path: '/reports/account-ledger', label: 'Account Ledger', icon: 'AL', keywords: 'account ledger debit credit journal drilldown' },
            { path: '/transactions/outgoing-funds', label: 'Outgoing Fund', icon: 'OF', keywords: 'outgoing funds payments expense cash bank balance sheet' }
          ]
        },
        {
          path: '/balance-sheet',
          label: 'Controls & Compliance',
          icon: 'CC',
          keywords: 'balance sheet compliance statutory pf esi tax accounting controls',
          children: [
            { path: '/balance-sheet', label: 'Balance Sheet', icon: 'BS', keywords: 'balance sheet trial balance ledger working capital accounting' },
            { path: '/compliance', label: 'Compliance', icon: 'AC', keywords: 'statutory pf esi tax' }
          ]
        }
      ]
    },
    {
      id: 'marketing',
      label: 'Marketing & Growth',
      icon: 'MK',
      primaryPath: '/marketing',
      items: [
        {
          path: '/marketing',
          label: 'Growth Channels',
          icon: 'GC',
          keywords: 'campaign marketing engagement whatsapp messages reviews growth ai rank bot',
          children: [
            { path: '/marketing', label: 'Marketing', icon: 'W', keywords: 'campaign marketing automation' },
            { path: '/engagement', label: 'Engagement Center', icon: 'EC', keywords: 'unified inbox hyperconnect client engagement whatsapp email calls' },
            { path: '/whatsapp', label: 'WhatsApp', icon: 'WA', keywords: 'whatsapp campaign chat' },
            { path: '/message-logs', label: 'Messages', icon: 'ML', keywords: 'message logs communication' },
            { path: '/reputation', label: 'Reviews', icon: 'RV', keywords: 'reviews reputation google' },
            { path: '/growth-advisor', label: 'Growth AI', icon: 'GA', keywords: 'growth advisor ai' },
            { path: '/growth-rank-bot', label: 'AI Rank Bot', icon: 'RB', keywords: 'instagram facebook google rank local seo dhanda ai growth bot reviews' }
          ]
        },
        {
          path: '/discount-rules',
          label: 'Offers & Automation',
          icon: 'OA',
          keywords: 'discount rules happy hours coupon promotion calendar offers roi fraud approvals smart forms recommendations notifications',
          children: [
            { path: '/discount-rules', label: 'Happy Hours', icon: 'HH', keywords: 'happy hours discounts offers' },
            { path: '/discount-rules/rules', label: 'Discount Rules', icon: 'DR', keywords: 'discount rules list' },
            { path: '/discount-rules/new', label: 'Rule Builder', icon: 'RB', keywords: 'new edit discount rule builder' },
            { path: '/discount-rules/promotion-calendar', label: 'Promotion Calendar', icon: 'PC', keywords: 'promotion calendar offers' },
            { path: '/discount-rules/coupon-engine', label: 'Coupon Engine', icon: 'CE', keywords: 'coupon engine discounts' },
            { path: '/discount-rules/approvals', label: 'Approvals', icon: 'AP', keywords: 'discount rule approvals' },
            { path: '/discount-rules/control-tower', label: 'Control Tower', icon: 'CT', keywords: 'happy hours control tower' },
            { path: '/smart-forms', label: 'Smart Forms', icon: 'SF', keywords: 'forms consent smart' },
            { path: '/recommendation-engine', label: 'Recommend AI', icon: 'RE', keywords: 'recommendation upsell ai' },
            { path: '/notification-center', label: 'Notify Center', icon: 'NC', keywords: 'notifications alerts' }
          ]
        }
      ]
    },
    {
      id: 'admin',
      label: 'Admin',
      icon: 'AD',
      primaryPath: '/settings',
      items: [
        {
          path: '/settings',
          label: 'Tenant Setup',
          icon: 'TS',
          keywords: 'tenant admin saas branches settings permissions business white label quality',
          children: [
            { path: '/super-admin', label: 'Super Admin', icon: 'SA', keywords: 'tenant admin platform' },
            { path: '/saas', label: 'SaaS', icon: 'X', keywords: 'saas onboarding tenant' },
            { path: '/branches', label: 'Branches', icon: 'B', keywords: 'branch location' },
            { path: '/settings', label: 'Settings', icon: 'G', keywords: 'settings configuration' },
            { path: '/permissions', label: 'Permissions', icon: 'PM', keywords: 'role rbac permission' },
            { path: '/business-details', label: 'Business Details', icon: 'BD', keywords: 'business profile details' },
            { path: '/white-label', label: 'White Label', icon: 'WL', keywords: 'brand theme white label' },
            { path: '/quality', label: 'Quality', icon: 'QA', keywords: 'quality checks qa' }
          ]
        },
        {
          path: '/security',
          label: 'Security & Audit',
          icon: 'SA',
          keywords: 'security auth sessions shield alerts blocklist policy two factor audit compliance',
          children: [
            { path: '/security', label: 'Security', icon: 'SL', keywords: 'security auth sessions' },
            { path: '/enterprise-security-shield', label: 'Security Shield', icon: 'ES', keywords: 'enterprise security shield detect alert block audit recover' },
            { path: '/security-alerts', label: 'Security Alerts', icon: 'SA', keywords: 'security alerts intrusion threat critical warning' },
            { path: '/security-blocklist', label: 'Security Blocklist', icon: 'BL', keywords: 'security blocklist ip block active defense' },
            { path: '/security-policy-center', label: 'Policy Center', icon: 'PC', keywords: 'security policy center device trust pin export field audit' },
            { path: '/two-factor', label: 'Two-Factor Auth', icon: '2F', keywords: 'security 2fa totp authenticator recovery code' },
            { path: '/audit-logs', label: 'Audit Logs', icon: 'AL', keywords: 'audit logs activity' },
            { path: '/audit-compliance', label: 'Audit Compliance', icon: 'AC', keywords: 'audit compliance controls risk' }
          ]
        },
        {
          path: '/offline',
          label: 'Offline Ops',
          icon: 'OF',
          keywords: 'offline sync pos resilience command center',
          children: [
            { path: '/offline', label: 'Command Center', icon: 'OC', keywords: 'offline resilience command center overview' },
            { path: '/offline/readiness', label: 'Readiness Score', icon: 'RS', keywords: 'offline readiness score cache branch device risk' },
            { path: '/offline/devices', label: 'Device Health', icon: 'DH', keywords: 'offline device sync health terminal tablet' },
            { path: '/offline/sync-queue', label: 'Sync Queue', icon: 'SQ', keywords: 'offline smart sync queue retry force conflict' },
            { path: '/offline/conflicts', label: 'Conflict Center', icon: 'CR', keywords: 'offline conflict resolution server device merge' },
            { path: '/offline/billing', label: 'Offline Billing', icon: 'OB', keywords: 'offline billing protection invoice cash drawer duplicate' },
            { path: '/offline/appointments', label: 'Offline Appointments', icon: 'OA', keywords: 'offline appointment protection slot staff duplicate' },
            { path: '/offline/risk-alerts', label: 'Risk Alerts', icon: 'RA', keywords: 'offline risk alerts stale cache failed sync' }
          ]
        },
        {
          path: '/developer-api',
          label: 'Developer Platform',
          icon: 'DV',
          keywords: 'developer api webhooks plugins marketplace localization design system prd data migration deployment',
          children: [
            { path: '/developer-api', label: 'API Platform', icon: 'API', keywords: 'api platform developer' },
            { path: '/webhooks', label: 'Webhooks', icon: 'WH', keywords: 'webhooks api events' },
            { path: '/plugins', label: 'Plugins', icon: 'PL', keywords: 'plugins extension' },
            { path: '/app-marketplace', label: 'Marketplace', icon: 'AM', keywords: 'marketplace apps' },
            { path: '/localization', label: 'Countries', icon: 'LC', keywords: 'localization countries tax' },
            { path: '/design-system', label: 'Design System', icon: 'DS', keywords: 'design system ui' },
            { path: '/prd', label: 'PRD', icon: 'P', keywords: 'product requirements prd' },
            { path: '/data-migration', label: 'Data Migration', icon: 'DM', keywords: 'import migration data' },
            { path: '/deployment', label: 'Deployment', icon: 'DP', keywords: 'deployment release' }
          ]
        }
      ]
    },
    {
      id: 'ai-platform',
      label: 'AI & Automation',
      icon: 'AI',
      primaryPath: '/ai',
      items: [
        {
          path: '/ai',
          label: 'AI Tools',
          icon: 'AT',
          keywords: 'assistant ai workflows image gamification fraud appointment optimization knowledge',
          children: [
            { path: '/ai', label: 'AI Assistant', icon: 'A', keywords: 'assistant ai' },
            { path: '/workflows', label: 'Workflows', icon: 'WF', keywords: 'workflow automation' },
            { path: '/image-analysis', label: 'Image AI', icon: 'IA', keywords: 'image analysis ai' },
            { path: '/gamification', label: 'Gamification', icon: 'GM', keywords: 'points badges gamification' },
            { path: '/fraud-detection', label: 'Fraud AI', icon: 'FD', keywords: 'fraud detection risk' },
            { path: '/appointment-optimization', label: 'Appt Optimize', icon: 'AO', keywords: 'appointment optimization ai' },
            { path: '/knowledge-base', label: 'Knowledge', icon: 'KB', keywords: 'knowledge base ai' }
          ]
        },
        {
          path: '/future-features',
          label: 'AI Command Apps',
          icon: 'AC',
          keywords: 'future features ai voice franchise marketplace data warehouse financial brain inventory autopilot',
          children: [
            { path: '/future-features', label: 'Future AI', icon: 'F', keywords: 'future features ai' },
            { path: '/command-center/voice-ai-receptionist', label: 'Voice AI', icon: 'VR', keywords: 'voice receptionist ai command center' },
            { path: '/command-center/franchise-os', label: 'Franchise OS', icon: 'FR', keywords: 'franchise expansion command center' },
            { path: '/command-center/marketplace-platform', label: 'Marketplace Platform', icon: 'MP', keywords: 'marketplace integrations apps platform' },
            { path: '/command-center/financial-brain', label: 'Financial Brain', icon: 'FB', keywords: 'financial brain ai' },
            { path: '/command-center/inventory-autopilot', label: 'Inventory Autopilot', icon: 'IA', keywords: 'inventory autopilot ai' }
          ]
        },
        {
          path: '/dynamic-pricing',
          label: 'Pricing AI',
          icon: 'DP',
          keywords: 'dynamic pricing ai incrementality market intelligence level 6',
          children: [
            { path: '/dynamic-pricing', label: 'Dynamic Pricing', icon: 'DP', keywords: 'dynamic pricing ai' },
            { path: '/pricing/incrementality', label: 'Incrementality', icon: 'CI', keywords: 'causal incrementality pricing' },
            { path: '/pricing/market-intelligence', label: 'Market Intelligence', icon: 'MI', keywords: 'competitive price intelligence market' },
            { path: '/pricing/level6-readiness', label: 'Level 6 Readiness', icon: 'L6', keywords: 'pricing level 6 readiness center' }
          ]
        }
      ]
    }
  ];

  readonly visibleNavGroups = computed(() => {
    const term = this.navQuery().trim().toLowerCase();
    return this.navGroups
      .map((group) => {
        const groupMatches = `${group.label} ${group.id}`.toLowerCase().includes(term);
        const items = group.items
          .map((item) => this.filterNavItem(item, group, term, groupMatches))
          .filter((item): item is NavItem => Boolean(item));
        return { ...group, items };
      })
      .filter((group) => group.items.length);
  });
  readonly activePageLabel = computed(() => {
    return this.pageLabelForUrl(this.activeRoute()) || 'Command workspace';
  });
  readonly activeStaffLocalNav = computed<ActiveStaffLocalNav | null>(() => {
    const branch = this.navBranchForUrl(this.activeRoute());
    if (branch?.group.id !== 'staff' || !branch.item.children?.length) return null;

    const children = this.staffLocalChildren(branch.item).filter((item) => this.canAccessNavItem(item));
    if (!children.length) return null;

    return {
      path: branch.item.path,
      label: branch.item.label,
      icon: branch.item.icon,
      children
    };
  });
  readonly activePageTabs = computed<ActiveNavTabGroup | null>(() => {
    const route = this.routePath(this.activeRoute());
    if (this.activeStaffLocalNav()) return null;
    const branch = this.navBranchForUrl(route);
    if (!branch?.item.children?.length) return null;
    return {
      groupLabel: branch.group.label,
      path: branch.item.path,
      label: branch.item.label,
      icon: branch.item.icon,
      children: branch.item.children
    };
  });
  readonly backButtonLabel = computed(() => {
    const previous = this.previousRoute();
    if (previous && previous !== this.activeRoute()) {
      return `Back to ${this.pageLabelForUrl(previous) || 'previous page'}`;
    }
    return 'Back to Home';
  });

  constructor(
    readonly api: ApiService,
    readonly state: AppStateService,
    readonly session: AuthSessionService,
    readonly i18n: I18nService,
    private readonly router: Router
  ) {
    delete document.documentElement.dataset.theme;
    this.isPortal.set(this.isPortalUrl(this.router.url));
    this.activeRoute.set(this.router.url);
    this.ensureActiveGroupExpanded(this.router.url);
    window.addEventListener('aura:app-error', (event) => {
      this.globalError.set(this.readGlobalError((event as CustomEvent<{ message: unknown }>).detail?.message));
    });
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
      const url = (event as NavigationEnd).urlAfterRedirects;
      const current = this.activeRoute();
      if (url !== current && this.isBackHistoryCandidate(current)) {
        this.previousRoute.set(current);
      }
      this.isPortal.set(this.isPortalUrl(url));
      this.activeRoute.set(url);
      this.ensureActiveGroupExpanded(url);
    });
    effect(() => {
      this.state.selectedTenantId();
      this.session.session();
      if (this.session.isAuthenticated()) {
        this.loadTenants();
        this.loadBranches();
        this.loadLocalizationPreference(this.state.selectedTenantId());
      }
    });
  }

  login(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.loginBusy.set(true);
    this.loginError.set('');
    this.saveLoginContextPreference();
    const raw = this.loginForm.getRawValue() as { tenantId: string; email: string; password: string; branchId?: string; totpToken?: string };
    const identity = String(raw.email || '').trim();
    const isEmailIdentity = identity.includes('@');
    const payload = {
      tenantId: String(raw.tenantId || '').trim(),
      email: isEmailIdentity ? identity : undefined,
      loginId: isEmailIdentity ? undefined : identity,
      password: raw.password,
      branchId: String(raw.branchId || '').trim() || undefined,
      totpToken: (raw.totpToken || '').trim() || undefined
    };
    this.session.login(payload).subscribe({
      next: (session) => {
        this.state.setTenant(session.tenant.id);
        this.state.setRole(session.user.role as UserRole);
        this.state.setBranch(session.user.branchId || '');
        this.loginBusy.set(false);
        this.requiresTotp.set(false);
        this.loginForm.controls.totpToken.setValue('');
        this.loadTenants();
        this.loadBranches();
      },
      error: (error) => {
        if (AuthSessionService.requiresTotp(error)) {
          this.requiresTotp.set(true);
          this.loginError.set(this.loginForm.value.totpToken ? 'Invalid authenticator or recovery code. Try again.' : 'Enter your authenticator or recovery code.');
          this.loginBusy.set(false);
          return;
        }
        this.loginError.set(error?.error?.error?.message || error?.error?.error || error?.message || 'Unable to sign in');
        this.loginBusy.set(false);
      }
    });
  }

  captureCapsLock(event: KeyboardEvent): void {
    this.capsLockOn.set(Boolean(event.getModifierState?.('CapsLock')));
  }

  clearCapsLock(): void {
    this.capsLockOn.set(false);
  }

  toggleRememberLoginContext(event: Event): void {
    const checked = Boolean((event.target as HTMLInputElement | null)?.checked);
    this.rememberLoginContext.set(checked);
    if (checked) {
      this.saveLoginContextPreference();
      return;
    }
    this.clearSavedLoginContext();
  }

  logout(): void {
    this.session.logout();
  }

  openCommandBar(): void {
    window.dispatchEvent(new Event('aura:command-palette:open'));
  }

  goBack(): void {
    const current = this.activeRoute();
    const previous = this.previousRoute();
    if (previous && previous !== current) {
      this.router.navigateByUrl(previous);
      return;
    }
    if (!this.isHomePath(this.routePath(current))) {
      this.router.navigateByUrl('/home');
    }
  }

  loadBranches(): void {
    this.api.list<ApiRecord[]>('branches').subscribe({
      next: (branches) => {
        const rows = (branches || []).filter((branch) => branch && branch.id);
        this.branches.set(rows);
        const selectedBranchId = this.state.selectedBranchId();
        const selectedExists = rows.some((branch) => branch.id === selectedBranchId);
        if (rows.length && (!selectedBranchId || !selectedExists)) {
          this.state.setBranch(rows[0].id);
        }
      },
      error: () => this.branches.set([])
    });
  }

  loadTenants(): void {
    this.api.list<ApiRecord[]>('tenants', { limit: 1000 }).subscribe({
      next: (tenants) => {
        const safeTenants = (tenants || []).filter((tenant) => tenant && tenant.id);
        const businessTenants = safeTenants.filter((tenant) => !this.isGeneratedTestTenant(tenant.id));
        const tenantOptions = businessTenants.length ? businessTenants : safeTenants;
        const orderedTenants = [...tenantOptions].sort((left, right) => {
          if (left.id === 'tenant_aura') return -1;
          if (right.id === 'tenant_aura') return 1;
          return String(left.name || left.id).localeCompare(String(right.name || right.id));
        });
        this.tenants.set(orderedTenants);
        const selectedTenant = this.state.selectedTenantId();
        if (orderedTenants.length && !orderedTenants.some((tenant) => tenant.id === selectedTenant)) {
          this.state.setTenant(orderedTenants.find((tenant) => tenant.id === 'tenant_aura')?.id || orderedTenants[0].id);
          this.loadBranches();
        }
      },
      error: () => this.tenants.set([])
    });
  }

  selectTenant(tenantId: string): void {
    this.state.setTenant(tenantId);
  }

  selectBranch(branchId: string): void {
    this.state.setBranch(branchId);
  }

  selectRole(role: UserRole): void {
    this.state.setRole(role);
  }

  selectCountry(countryCode: string): void {
    this.i18n.setCountry(countryCode);
    this.saveLocalizationPreference();
  }

  selectLanguage(languageCode: string): void {
    this.i18n.setLanguage(languageCode);
    this.saveLocalizationPreference();
  }

  private loadLocalizationPreference(tenantId: string): void {
    if (!tenantId || this.loadedLocalizationTenantId === tenantId) return;
    this.loadedLocalizationTenantId = tenantId;
    this.api.list<{ preference?: LocalePreference }>('localization/preference', { includeAllBranches: true }).subscribe({
      next: (result) => {
        if (result?.preference) this.i18n.setPreference(result.preference);
      },
      error: () => {
        this.loadedLocalizationTenantId = '';
      }
    });
  }

  private saveLocalizationPreference(): void {
    if (!this.session.isAuthenticated()) return;
    this.api.put<{ preference?: LocalePreference }>('localization/preference', this.i18n.preference()).subscribe({
      next: (result) => {
        if (result?.preference) this.i18n.setPreference(result.preference);
      },
      error: (error) => {
        const message = this.api.errorText(error, 'Unable to save language preference');
        if (error?.status === 404 || /Route not found/i.test(message)) return;
        this.globalError.set(message);
      }
    });
  }

  openNavGroup(group: NavGroup): void {
    if (this.sidebarUiCompact()) {
      this.router.navigateByUrl(group.primaryPath);
      return;
    }
    const current = new Set(this.expandedGroupIds());
    if (current.has(group.id)) current.delete(group.id);
    else current.add(group.id);
    this.expandedGroupIds.set([...current]);
    localStorage.setItem('aura.expandedNavGroups', JSON.stringify([...current]));
  }

  rememberNavGroup(groupId: string): void {
    const current = new Set(this.expandedGroupIds());
    current.add(groupId);
    this.expandedGroupIds.set([...current]);
    localStorage.setItem('aura.expandedNavGroups', JSON.stringify([...current]));
  }

  toggleSidebarCompact(): void {
    const next = !this.sidebarCompact();
    this.sidebarHoverExpanded.set(false);
    this.sidebarCompact.set(next);
    localStorage.setItem('aura.sidebarCompact', next ? '1' : '0');
  }

  openSidebarPreview(): void {
    if (this.sidebarCompact()) this.sidebarHoverExpanded.set(true);
  }

  closeSidebarPreview(event?: FocusEvent): void {
    if (!this.sidebarCompact()) return;
    const currentTarget = event?.currentTarget;
    const nextTarget = event?.relatedTarget;
    if (currentTarget instanceof HTMLElement && nextTarget instanceof Node && currentTarget.contains(nextTarget)) return;
    this.sidebarHoverExpanded.set(false);
  }

  isGroupExpanded(group: NavGroup): boolean {
    return Boolean(this.navQuery()) || this.expandedGroupIds().includes(group.id);
  }

  isGroupActive(group: NavGroup): boolean {
    const url = this.activeRoute();
    return this.navLeaves(group.items).some((item) => this.isRouteActive(url, item.path));
  }

  isNavItemActive(item: NavItem): boolean {
    const url = this.activeRoute();
    return this.isRouteActive(url, item.path) || (item.children || []).some((child) => this.isRouteActive(url, child.path));
  }

  isStaffLocalNavItemActive(item: NavItem): boolean {
    const currentUrl = this.activeRoute();
    const currentPath = this.routePath(currentUrl);
    const targetPath = this.routePath(item.path);
    if (currentPath !== targetPath) return false;

    const queryEntries = Object.entries(item.queryParams || {});
    const currentQuery = this.router.parseUrl(currentUrl).queryParams;
    if (queryEntries.length) {
      return queryEntries.every(([key, value]) => String(currentQuery[key] ?? '') === value);
    }

    const querySpecificSiblingActive = this.activeStaffLocalNav()?.children.some((candidate) => {
      if (candidate === item || this.routePath(candidate.path) !== targetPath || !candidate.queryParams) return false;
      return Object.entries(candidate.queryParams).every(([key, value]) => String(currentQuery[key] ?? '') === value);
    });

    return !querySpecificSiblingActive;
  }

  private ensureActiveGroupExpanded(url: string): void {
    const group = this.navGroups.find((item) => this.navLeaves(item.items).some((navItem) => this.isRouteActive(url, navItem.path)));
    if (!group || this.expandedGroupIds().includes(group.id)) return;
    const next = [...this.expandedGroupIds(), group.id];
    this.expandedGroupIds.set(next);
    localStorage.setItem('aura.expandedNavGroups', JSON.stringify(next));
  }

  private navItemText(item: NavItem, group: NavGroup): string {
    const childText = (item.children || []).map((child) => `${child.label} ${child.path} ${child.icon} ${child.keywords || ''}`).join(' ');
    return `${item.label} ${item.path} ${item.icon} ${item.keywords || ''} ${childText} ${group.label}`.toLowerCase();
  }

  navLeafCount(items: NavItem[]): number {
    return items.length;
  }

  private staffLocalChildren(item: NavItem): NavItem[] {
    const children = [...(item.children || [])];
    if (item.path === '/staff-os/staff-list') {
      children.push({
        path: '/staff-os/staff-list',
        label: 'Inactive Staff',
        icon: 'IS',
        keywords: 'inactive archived staff',
        queryParams: { status: 'inactive' }
      });
    }
    return children;
  }

  private navLeaves(items: NavItem[]): NavItem[] {
    return items.flatMap((item) => item.children?.length ? item.children : [item]);
  }

  private isStaffOsRoute(path: string): boolean {
    return path === '/staff-os' || path.startsWith('/staff-os/');
  }
  private navBranchForUrl(url: string): { group: NavGroup; item: NavItem } | null {
    const cleanUrl = this.routePath(url);
    for (const group of this.navGroups) {
      for (const item of group.items) {
        if (!item.children?.length) continue;
        if (item.children.some((child) => cleanUrl === child.path)) {
          return { group, item };
        }
      }
    }
    for (const group of this.navGroups) {
      for (const item of group.items) {
        if (!item.children?.length) continue;
        if (cleanUrl === item.path || cleanUrl.startsWith(`${item.path}/`)) {
          return { group, item };
        }
      }
    }
    return null;
  }

  private filterNavItem(item: NavItem, group: NavGroup, term: string, groupMatches = false): NavItem | null {
    const textMatches = !term || groupMatches || this.navItemText(item, group).includes(term);
    if (!item.children?.length) return textMatches && this.canAccessNavItem(item) ? item : null;
    const children = item.children
      .map((child) => this.filterNavItem(child, group, term, groupMatches))
      .filter((child): child is NavItem => Boolean(child));
    if (children.length) return { ...item, children };
    return textMatches && this.canAccessNavItem(item) ? { ...item, children: [] } : null;
  }

  private canAccessNavItem(item: NavItem): boolean {
    return this.canAccessPermission(item.permission || this.navPermissionForPath(item.path));
  }

  private navPermissionForPath(path: string): string | string[] {
    const cleanPath = this.routePath(path);
    if (!cleanPath || cleanPath === '/' || this.isHomePath(cleanPath) || cleanPath === '/apps') return '';
    return this.navPermissionRules.find((rule) => rule.pattern.test(cleanPath))?.permission || '';
  }

  private canAccessPermission(permission?: string | string[]): boolean {
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = dynamicGrants.length ? dynamicGrants : staticGrantsForRole(this.state.userRole());
    if (!grants.length) return false;
    return permissions.some((item) => grantsAllow(grants, item));
  }

  private isRouteActive(url: string, path: string): boolean {
    const cleanUrl = this.routePath(url);
    const cleanPath = this.routePath(path);
    if (this.isHomePath(cleanUrl) && this.isHomePath(cleanPath)) return true;
    return cleanUrl === cleanPath || cleanUrl.startsWith(`${cleanPath}/`);
  }

  private isHomePath(path: string): boolean {
    return path === '/home' || path === '/dashboard';
  }

  private pageLabelForUrl(url: string): string {
    return this.navGroups
      .flatMap((group) => this.navLeaves(group.items))
      .find((item) => this.isRouteActive(url, item.path))?.label || '';
  }

  private routePath(url: string): string {
    return (url || '/').split(/[?#]/)[0] || '/';
  }

  private isBackHistoryCandidate(url: string): boolean {
    const path = this.routePath(url);
    return Boolean(path && path !== '/' && !this.isPortalUrl(path) && !path.startsWith('/auth'));
  }

  private isPortalUrl(url: string): boolean {
    const path = this.routePath(url);
    return path.startsWith('/book') || path.startsWith('/salon-3d') || path.startsWith('/cash-drawer-approval');
  }

  private isGeneratedTestTenant(tenantId: unknown): boolean {
    return /^tenant_(ai|import)_/i.test(String(tenantId || ''));
  }

  private readExpandedGroups(): string[] {
    try {
      const parsed = JSON.parse(localStorage.getItem('aura.expandedNavGroups') || '[]');
      const groups = Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : ['frontdesk', 'pos', 'inventory'];
      return groups.includes('command') ? groups : ['command', ...groups];
    } catch {
      return ['command', 'frontdesk', 'pos', 'inventory'];
    }
  }

  private readInitialSidebarCompact(): boolean {
    try {
      const restoreKey = 'aura.sidebarMorningRestore.v1';
      if (localStorage.getItem(restoreKey) !== '1') {
        localStorage.setItem(restoreKey, '1');
        localStorage.setItem('aura.sidebarCompact', '1');
        return true;
      }
      return localStorage.getItem('aura.sidebarCompact') !== '0';
    } catch {
      return true;
    }
  }

  private readRememberLoginContext(): boolean {
    try {
      return localStorage.getItem('auraRememberLoginContext') === 'true';
    } catch {
      return false;
    }
  }

  private savedLoginValue(key: 'tenantId' | 'email' | 'branchId', fallback: string): string {
    try {
      if (localStorage.getItem('auraRememberLoginContext') !== 'true') return fallback;
      const parsed = JSON.parse(localStorage.getItem('auraLoginContext') || '{}') as Partial<Record<'tenantId' | 'email' | 'branchId', string>>;
      return String(parsed[key] || fallback);
    } catch {
      return fallback;
    }
  }

  private saveLoginContextPreference(): void {
    try {
      if (!this.rememberLoginContext()) return;
      const raw = this.loginForm.getRawValue() as { tenantId?: string; email?: string; branchId?: string };
      localStorage.setItem('auraRememberLoginContext', 'true');
      localStorage.setItem('auraLoginContext', JSON.stringify({
        tenantId: String(raw.tenantId || '').trim(),
        email: String(raw.email || '').trim(),
        branchId: String(raw.branchId || '').trim()
      }));
    } catch {
      return;
    }
  }

  private clearSavedLoginContext(): void {
    try {
      localStorage.removeItem('auraRememberLoginContext');
      localStorage.removeItem('auraLoginContext');
    } catch {
      return;
    }
  }

  private readGlobalError(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message && typeof message === 'object') {
      const value = message as { message?: unknown; code?: unknown };
      if (typeof value.message === 'string') return value.message;
      if (typeof value.code === 'string') return value.code;
    }
    return 'Unexpected application error';
  }
}


