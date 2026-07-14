import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiRecord, ApiService } from './core/api.service';
import { APPOINTMENT_SLOT_MINUTE_OPTIONS, AppointmentToolbarService } from './core/appointment-toolbar.service';
import { routePermissionForPath } from './core/access-rules';
import { AuthSessionService } from './core/auth-session.service';
import { I18nService, LocalePreference } from './core/i18n.service';
import { GeneralSettingsService } from './core/general-settings.service';
import { NavigationPrefetchService } from './core/navigation-prefetch.service';
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

type ActiveLocalNav = {
  groupId: string;
  groupLabel: string;
  path: string;
  label: string;
  icon: string;
  children: NavItem[];
};


type ActiveModuleTabs = {
  groupId: string;
  label: string;
  items: NavItem[];
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
              <h1>Aura Salon OS</h1>
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
    <div class="app-shell" [class.sidebar-is-compact]="sidebarUiCompact()" [class.interface-is-compact]="generalSettings.compactMode()">
      <aside
        class="sidebar enterprise-sidebar inline-app-sidebar"
        [class.sidebar-compact]="sidebarUiCompact()"
      >
        <div class="sidebar-brand-row">
          <a class="brand" routerLink="/home" aria-label="Aura Shine home" data-label="Aura Shine home" (mouseenter)="prefetchNavPath('/home')" (focus)="prefetchNavPath('/home')">
            <span class="brand-mark" aria-hidden="true">AS</span>
            <span>
              <strong>Aura Shine</strong>
            </span>
          </a>

        </div>
        <div class="sidebar-search-slot" *ngIf="generalSettings.commandSearchEnabled()" [class.open]="sidebarSearchOpen() || navSearchDraft()">
          <button
            class="sidebar-search-icon-button"
            type="button"
            (click)="toggleSidebarSearch()"
            aria-label="Search modules and pages"
            [attr.aria-expanded]="sidebarSearchOpen()"
            data-label="Search"
          >
            <svg class="sidebar-search-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M10.5 5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z M15 15l4 4"></path>
            </svg>
          </button>

          <section class="sidebar-search-flyout" *ngIf="sidebarSearchOpen() || navSearchDraft()" aria-label="Search navigation">
            <label class="sidebar-search">
              <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M10.5 5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z M15 15l4 4"></path>
              </svg>
              <input
                #sidebarSearchInput
                [ngModel]="navSearchDraft()"
                (ngModelChange)="setNavSearchDraft($event)"
                (keydown.escape)="closeSidebarSearch(true)"
                aria-label="Search modules and pages"
                placeholder="Search modules, pages"
              />
              <button class="sidebar-search-clear" type="button" *ngIf="navSearchDraft()" (click)="clearNavSearch()">Clear</button>
            </label>

            <div class="sidebar-search-results" *ngIf="navQuery().trim(); else sidebarSearchHint">
              <section class="sidebar-search-group" *ngFor="let group of visibleNavGroups(); trackBy: trackNavGroup">
                <span class="sidebar-search-group-label">{{ group.label }}</span>
                <a
                  class="sidebar-search-result"
                  *ngFor="let item of visibleSidebarItems(group); trackBy: trackNavItem"
                  [class.active]="isSidebarNavItemActive(item)"
                  [routerLink]="item.path"
                  [queryParams]="item.queryParams || null"
                  routerLinkActive="active"
                  [routerLinkActiveOptions]="{ exact: item.path === '/home' || item.path === '/dashboard' }"
                  (mouseenter)="prefetchNavItem(item)"
                  (focus)="prefetchNavItem(item)"
                  (click)="rememberNavGroup(group.id); closeSidebarSearch(true)"
                >
                  <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
                  <span>{{ item.label }}</span>
                </a>
              </section>
              <div class="nav-empty" *ngIf="!visibleNavGroups().length">
                <strong>{{ i18n.t('shell.noModule', 'No module found') }}</strong>
                <button class="ghost-button mini" type="button" (click)="clearNavSearch()">Reset search</button>
              </div>
            </div>

            <ng-template #sidebarSearchHint>
            </ng-template>
          </section>
        </div>

        <nav class="nav-list nav-accordion" aria-label="Primary navigation">
          <section class="nav-section" *ngFor="let group of visibleNavGroups(); trackBy: trackNavGroup" [class.active-section]="isGroupActive(group)">
            <button class="nav-section-trigger" type="button" (mouseenter)="prefetchNavGroup(group)" (focus)="prefetchNavGroup(group)" (click)="openNavGroup(group)" [attr.aria-label]="group.label" [attr.data-label]="group.label">
              <span class="nav-icon nav-icon--module" aria-hidden="true">
                <svg class="nav-icon-svg" viewBox="0 0 24 24" focusable="false">
                  <path [attr.d]="navGroupIconPath(group.id)"></path>
                </svg>
              </span>
              <span class="nav-section-copy">
                <strong>{{ group.label }}</strong>
                <small>{{ navLeafCount(group.items) }} {{ i18n.t('shell.modules', 'modules') }}</small>
              </span>
              <span class="nav-count" *ngIf="generalSettings.showModuleBadges()">{{ navLeafCount(group.items) }}</span>
            </button>
            <ng-container *ngIf="visibleSidebarItems(group) as sidebarItems">
              <div class="nav-section-items" *ngIf="!sidebarUiCompact() && (navQuery() || isGroupExpanded(group)) && sidebarItems.length">
                <ng-container *ngFor="let item of sidebarItems; trackBy: trackNavItem">
                  <div class="nav-subgroup" *ngIf="item.children?.length; else singleNavItem">
                    <a
                      class="nav-subgroup-title"
                      [class.active]="isSidebarNavItemActive(item)"
                      [routerLink]="item.path"
                      [queryParams]="item.queryParams || null"
                      routerLinkActive="active"
                      (mouseenter)="prefetchNavItem(item)"
                      (focus)="prefetchNavItem(item)"
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
                      [class.active]="isSidebarNavItemActive(item)"
                      [routerLink]="item.path"
                      [queryParams]="item.queryParams || null"
                      routerLinkActive="active"
                      [routerLinkActiveOptions]="{ exact: item.path === '/home' || item.path === '/dashboard' }"
                      (mouseenter)="prefetchNavItem(item)"
                      (focus)="prefetchNavItem(item)"
                      (click)="rememberNavGroup(group.id)"
                    >
                      <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
                      <span>{{ item.label }}</span>
                    </a>
                  </ng-template>
                </ng-container>
              </div>
            </ng-container>
          </section>
          <div class="nav-empty" *ngIf="!visibleNavGroups().length && !sidebarUiCompact()">
            <strong>{{ i18n.t('shell.noModule', 'No module found') }}</strong>
            <button class="ghost-button mini" type="button" (click)="navQuery.set('')">{{ i18n.t('shell.resetSearch', 'Reset search') }}</button>
          </div>
        </nav>

        <a
          class="sidebar-care-ai-action"
          routerLink="/customer-care-ai"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
          (mouseenter)="prefetchNavPath('/customer-care-ai')"
          (focus)="prefetchNavPath('/customer-care-ai')"
          aria-label="Customer Care AI"
          data-label="Customer Care AI"
        >
          <svg class="sidebar-care-ai-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 13a8 8 0 0 1 16 0v4a2 2 0 0 1-2 2h-2"></path>
            <path d="M7 12h2v5H7a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2z"></path>
            <path d="M17 12h-2v5h2a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2z"></path>
            <path d="M12 19h4"></path>
            <path d="M12 6.5l.48 1.02 1.02.48-1.02.48L12 9.5l-.48-1.02L10.5 8l1.02-.48L12 6.5z"></path>
          </svg>
        </a>

        <section class="sidebar-callout">
          <span class="eyebrow">{{ i18n.t('shell.sidebarTenant', 'SaaS tenant') }}</span>
          <strong>{{ state.tenantScopeLabel() }}</strong>
        </section>
      </aside>

      <main class="workspace" id="main-content">
        <header class="topbar">
          <div class="topbar-brand-title">
            <button
              class="ghost-button topbar-back-button"
              type="button"
              *ngIf="activeLocalNav()"
              (click)="goBack()"
              [attr.aria-label]="backButtonLabel()"
              [title]="backButtonLabel()"
            >
              <span aria-hidden="true">&larr;</span>
            </button>
            <h1>{{ generalSettings.workspaceName() }}</h1>
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
            <a class="dark-button" routerLink="/pos" *ngIf="generalSettings.fastPosEnabled() && canAccessPath('/pos')" (mouseenter)="prefetchNavPath('/pos')" (focus)="prefetchNavPath('/pos')">{{ i18n.t('shell.fastPos', 'Fast POS') }}</a>
            <span class="topbar-divider" aria-hidden="true"></span>
            <aura-header-actions></aura-header-actions>
          </div>
        </header>
        <div class="state error" *ngIf="globalError()">
          {{ globalError() }}
          <button class="ghost-button mini" type="button" (click)="globalError.set('')">{{ i18n.t('shell.dismiss', 'Dismiss') }}</button>
        </div>
        <div class="state info" *ngIf="generalSettings.staffHintsEnabled() && state.userRole() === 'staff'">
          Tip: use command search to quickly open permitted clients, appointments and reports.
        </div>


        <section
            class="workspace-route-shell"
            [class.workspace-route-shell--with-local-nav]="activeLocalNav() !== null"
            [class.workspace-route-shell--local-rail-collapsed]="activeLocalNav() !== null"
          >
          <aside
            class="workspace-local-rail"
            *ngIf="activeLocalNav() as localNav"
            [attr.aria-label]="localNav.groupLabel + ' local navigation'"
            (mouseenter)="openLocalRailPreview()"
            (mouseleave)="closeLocalRailPreview()"
            (focusin)="openLocalRailPreview()"
            (focusout)="closeLocalRailPreview($event)"
          >
            <div class="workspace-local-rail-head">
              <div>
                <span class="eyebrow">{{ localNav.groupLabel }}</span>
                <strong>{{ localNav.label }}</strong>
              </div>
            </div>
            <nav class="workspace-local-nav" [attr.aria-label]="localNav.label + ' pages'">
              <a
                *ngFor="let item of localNav.children; trackBy: trackNavItem"
                [routerLink]="item.path"
                [queryParams]="item.queryParams || null"
                [class.active]="isLocalNavItemActive(item)"
                [attr.aria-current]="isLocalNavItemActive(item) ? 'page' : null"
                [attr.aria-label]="item.label"
                [attr.data-label]="item.label"
                (mouseenter)="prefetchNavItem(item)"
                (focus)="prefetchNavItem(item)"
                (click)="rememberNavGroup(localNav.groupId)"
              >
                <span class="workspace-local-nav-icon" aria-hidden="true">{{ navItemInitials(item) }}</span>
                <span class="workspace-local-nav-label">{{ item.label }}</span>
              </a>
            </nav>
          </aside>
          <div class="workspace-route-content">
            <section class="workspace-module-tabs" *ngIf="activeModuleTabs() as moduleTabs" [attr.aria-label]="moduleTabs.label + ' modules'">
              <nav class="workspace-module-tabs-nav" [attr.aria-label]="moduleTabs.label + ' module groups'">
                <a
                  *ngFor="let tab of moduleTabs.items; trackBy: trackNavItem"
                  class="workspace-module-tab"
                  [routerLink]="tab.path"
                  [class.active]="isModuleTabActive(tab, moduleTabs.items)"
                  [attr.aria-current]="isModuleTabActive(tab, moduleTabs.items) ? 'page' : null"
                  (mouseenter)="prefetchNavItem(tab)"
                  (focus)="prefetchNavItem(tab)"
                  (click)="rememberNavGroup(moduleTabs.groupId)"
                >
                  <span class="nav-icon" aria-hidden="true">{{ tab.icon }}</span>
                  <span>{{ tab.label }}</span>
                </a>
              </nav>
              <div class="appointment-tab-controls" *ngIf="appointmentToolbar.visible()" aria-label="Calendar slot and view controls">
                <button class="appointment-tab-chip" type="button" (click)="appointmentToolbar.requestSafeSlots()">
                  <span>Safe slots</span>
                  <strong>{{ appointmentToolbar.safeSlotCount() }}</strong>
                </button>
                <button class="appointment-tab-chip" type="button" (click)="appointmentToolbar.requestOperations()">
                  <span>Demand</span>
                  <strong>{{ appointmentToolbar.waitlistCount() }}</strong>
                </button>
                <label>
                  <span>Slot</span>
                  <select [value]="appointmentToolbar.slotMinutes()" (change)="appointmentToolbar.setSlotMinutes($any($event.target).value)">
                    <option *ngFor="let minutes of slotMinuteOptions" [value]="minutes">{{ minutes === 60 ? '1 hour' : minutes + ' mins' }}</option>
                  </select>
                </label>
                <label class="appointment-tab-view-field">
                  <span>View</span>
                  <select [value]="appointmentToolbar.calendarLayout()" (change)="appointmentToolbar.setCalendarLayout($any($event.target).value)">
                    <option value="grid">Staff Grid</option>
                    <option value="compact-grid">Compact Grid</option>
                    <option value="timeline">Timeline</option>
                    <option value="list">List</option>
                  </select>
                </label>
                <button
                  class="appointment-tab-staff-button"
                  type="button"
                  title="Scheduled staff"
                  aria-label="Scheduled staff"
                  [class.active]="appointmentToolbar.staffPanelOpen()"
                  (click)="appointmentToolbar.requestStaffPanelToggle()"
                >
                  <span aria-hidden="true">☷</span>
                  <small>{{ appointmentToolbar.scheduledStaffVisibleCount() }}</small>
                </button>
              </div>
            </section>
            <router-outlet></router-outlet>
          </div>
        </section>
      </main>
      <aura-command-palette *ngIf="generalSettings.commandSearchEnabled()"></aura-command-palette>
      <a class="ai-fab" routerLink="/ai" aria-label="Ask Aura AI assistant" title="Ask Aura AI" (mouseenter)="prefetchNavPath('/ai')" (focus)="prefetchNavPath('/ai')">
        <svg class="ai-fab-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d="M5 3h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H10l-4.6 3.45A1 1 0 0 1 4 19.6V17a3 3 0 0 1-1-2.24V6a3 3 0 0 1 3-3z"/>
          <circle cx="8.5" cy="10" r="1.25" fill="#7c3aed"/>
          <circle cx="12" cy="10" r="1.25" fill="#7c3aed"/>
          <circle cx="15.5" cy="10" r="1.25" fill="#7c3aed"/>
        </svg>
      </a>
      <section class="required-branch-backdrop" *ngIf="branchSelectionRequired()" role="dialog" aria-modal="true" aria-labelledby="required-branch-title">
        <div class="required-branch-dialog">
          <span class="eyebrow">Workspace setup</span>
          <h2 id="required-branch-title">Select a branch to continue</h2>
          <p>This workspace requires an active branch before operational pages can load.</p>
          <div class="required-branch-list">
            <button type="button" *ngFor="let branch of branches()" (click)="selectRequiredBranch(branch.id)">
              <strong>{{ branch.name || branch.id }}</strong>
              <small>{{ branch.id }}</small>
            </button>
          </div>
        </div>
      </section>
    </div>
    </ng-template>
    </ng-template>
  `,
  styles: [`
    .workspace-route-shell {
      display: block;
      min-width: 0;
    }

    .topbar {
      margin-bottom: 0;
    }

    .interface-is-compact .workspace-route-content { font-size: 0.94rem; }
    .required-branch-backdrop { position: fixed; inset: 0; z-index: 5000; display: grid; place-items: center; padding: 20px; background: rgba(18, 12, 22, .62); backdrop-filter: blur(8px); }
    .required-branch-dialog { width: min(520px, 100%); max-height: min(680px, 90vh); overflow: auto; padding: 26px; border: 1px solid rgba(75,18,56,.18); border-radius: 22px; background: #fff; box-shadow: 0 30px 90px rgba(15,23,42,.3); }
    .required-branch-dialog h2 { margin: 8px 0; color: #21151c; }
    .required-branch-dialog p { color: #667085; }
    .required-branch-list { display: grid; gap: 8px; margin-top: 18px; }
    .required-branch-list button { display: grid; gap: 3px; width: 100%; padding: 13px 15px; border: 1px solid #e4d7df; border-radius: 14px; background: #fff8fc; color: #321827; text-align: left; cursor: pointer; }
    .required-branch-list button:hover, .required-branch-list button:focus-visible { border-color: #6f1d51; background: #fcecf4; outline: none; }
    .required-branch-list small { color: #7c6a75; }

    .topbar-actions {
      margin-right: -8px;
    }

    .topbar-brand-title {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .workspace-route-shell--with-local-nav {
      display: grid;
      grid-template-columns: 204px minmax(0, 1fr);
      align-items: stretch;
      border: 1px solid #E7DDD6;
      background: #fff;
    }

    @media (min-width: 761px) {
      .workspace-route-shell--with-local-nav {
        transition: grid-template-columns 180ms ease;
      }

      .workspace-route-shell--local-rail-collapsed {
        grid-template-columns: 58px minmax(0, 1fr);
      }

      .workspace-route-shell--local-rail-collapsed .workspace-local-rail {
        padding: 10px 6px;
        overflow: hidden;
      }

      .workspace-route-shell--local-rail-collapsed .workspace-local-rail-head {
        display: none;
      }

      .workspace-route-shell--local-rail-collapsed .workspace-local-nav {
        align-items: center;
      }

      .workspace-route-shell--local-rail-collapsed .workspace-local-nav a {
        width: 40px;
        min-width: 40px;
        height: 40px;
        min-height: 40px;
        place-items: center;
        padding: 0;
      }

      .workspace-route-shell--local-rail-collapsed .workspace-local-nav a span {
        display: block;
        width: 1ch;
        overflow: hidden;
        white-space: nowrap;
        text-align: center;
      }
    }
    .workspace-route-content {
      min-width: 0;
      background: #FAF8F6;
    }

    .workspace-route-shell--with-local-nav .workspace-route-content {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-content: start;
      padding: 0 16px 20px 12px;
    }

    .workspace-route-content > .workspace-module-tabs {
      position: sticky;
      top: 64px;
      z-index: 18;
      margin: 0;
      border-top: 0;
      border-right: 0;
      border-left: 0;
      border-radius: 0;
      box-shadow: none;
    }

    .workspace-route-shell--with-local-nav .workspace-route-content > .workspace-module-tabs {
      min-height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 0;
      background: #FAF8F6;
    }

    .appointment-tab-controls {
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      gap: 6px;
      margin-left: auto;
      padding-right: 6px;
    }

    .appointment-tab-chip {
      width: 92px;
      height: 44px;
      min-height: 44px;
      border: 1px solid #eadde6;
      border-radius: 10px;
      padding: 5px 10px;
      background: #fff;
      color: #2c1525;
      display: grid;
      gap: 1px;
      text-align: left;
      cursor: pointer;
      box-shadow: 0 8px 16px rgba(75, 18, 56, .06);
    }

    .appointment-tab-chip span {
      color: #6f5f6c;
      font-size: 9px;
      font-weight: 900;
      letter-spacing: .05em;
      line-height: 1;
      text-transform: uppercase;
    }

    .appointment-tab-chip strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      line-height: 1.15;
      font-weight: 900;
    }

    .appointment-tab-chip--risk { width: 92px; max-width: 92px; }

    .appointment-tab-chip:hover { border-color: #4B1238; }

    .appointment-tab-controls label {
      display: grid;
      gap: 1px;
      color: #6f5f6c;
      font-size: 9px;
      font-weight: 900;
      letter-spacing: .05em;
      line-height: 1;
      text-transform: uppercase;
      min-height: 44px;
      height: 44px;
      width: 92px;
      border: 1px solid #eadde6;
      border-radius: 10px;
      padding: 5px 10px;
      background: #fff;
      box-shadow: 0 8px 16px rgba(75, 18, 56, .06);
      box-sizing: border-box;
    }

    .appointment-tab-controls select {
      width: 72px;
      min-width: 72px;
      min-height: 16px;
      border: 0;
      border-radius: 0;
      padding: 0 20px 0 0;
      background: transparent;
      color: #2c1525;
      font: inherit;
      font-size: 12px;
      font-weight: 850;
      letter-spacing: 0;
      outline: none;
    }

    .appointment-tab-controls .appointment-tab-view-field { width: 128px; min-width: 128px; }
    .appointment-tab-controls .appointment-tab-view-field select { width: 100%; min-width: 0; }

    .appointment-tab-staff-button {
      position: relative;
      width: 38px;
      height: 44px;
      min-height: 44px;
      border: 1px solid #eadde6;
      border-radius: 10px;
      background: #fff;
      color: #4B1238;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: 900;
      box-shadow: 0 10px 20px rgba(75, 18, 56, .08);
      cursor: pointer;
    }

    .appointment-tab-staff-button.active,
    .appointment-tab-staff-button:hover { background: #4B1238; color: #fff; border-color: #4B1238; }

    .appointment-tab-staff-button small {
      position: absolute;
      right: -6px;
      top: -8px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      background: #E8A7B8;
      color: #4B1238;
      border: 2px solid #fff;
      font-size: 10px;
      line-height: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .workspace-local-rail {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      background: #f8f5f2;
      border-right: 1px solid #E7DDD6;
      min-width: 0;
    }

    .workspace-local-rail-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      padding: 8px 6px 10px;
      border-bottom: 1px solid #ede8e3;
    }

    .topbar-back-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      min-width: 38px;
      height: 38px;
      min-height: 38px;
      padding: 0;
      border: 1px solid #E7DDD6;
      border-radius: 999px;
      color: #4B1238;
      background: #fff;
      box-shadow: 0 2px 8px rgba(75,18,56,0.06);
      font-size: 20px;
      font-weight: 700;
      line-height: 1;
    }

    .workspace-local-rail-head strong {
      display: block;
      color: #2c1525;
      font-size: 14px;
      line-height: 1.2;
    }

    .workspace-local-nav {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .workspace-local-nav a {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-items: center;
      gap: 9px;
      min-height: 38px;
      padding: 6px 8px;
      color: #2b2220;
      text-decoration: none;
      border: 1px solid transparent;
      border-radius: 8px;
      font-weight: 800;
      font-size: 13px;
      line-height: 1.2;
    }

    .workspace-local-nav a.active,
    .workspace-local-nav a:hover,
    .workspace-local-nav a:focus-visible {
      background: #4B1238;
      color: #fff;
      border-color: #4B1238;
      outline: none;
    }

    @media (max-width: 760px) {
      .workspace-route-shell--with-local-nav {
        grid-template-columns: 1fr;
      }

      .workspace-local-rail {
        border-right: 0;
        border-bottom: 1px solid #E7DDD6;
      }

      .workspace-route-content > .workspace-module-tabs {
        position: static;
        border-top: 1px solid #E7DDD6;
      }

      .appointment-tab-controls {
        width: 100%;
        justify-content: flex-start;
        flex-wrap: wrap;
        padding: 8px 0 0;
      }

      .workspace-local-nav {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      }

      .workspace-route-shell--with-local-nav .workspace-route-content {
        padding: 0 12px 18px;
      }
    }

    .nav-icon--module {
      color: #4B1238;
    }

    .nav-icon--module .nav-icon-svg {
      width: 16px;
      height: 16px;
      display: block;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `]
})
export class AppComponent implements OnDestroy {
  private readonly fb = inject(FormBuilder);
  readonly slotMinuteOptions = APPOINTMENT_SLOT_MINUTE_OPTIONS;
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
  readonly branchSelectionRequired = computed(() => this.session.isAuthenticated()
    && this.generalSettings.loaded()
    && this.generalSettings.requireBranchSelection()
    && !this.state.selectedBranchId()
    && this.branches().length > 0);

  readonly navSearchDraft = signal('');
  readonly navQuery = signal('');
  readonly sidebarSearchOpen = signal(false);
  readonly activeRoute = signal('');
  readonly previousRoute = signal('');
  readonly routeHistory = signal<string[]>([]);
  readonly sidebarCompact = signal(true);
  readonly sidebarHoverExpanded = signal(false);
  readonly sidebarUiCompact = computed(() => true);
  readonly localRailHoverExpanded = signal(false);
  readonly localRailExpanded = computed(() => this.localRailHoverExpanded());
  readonly expandedGroupIds = signal<string[]>(this.readExpandedGroups());
  private readonly maxBackHistory = 10;
  private readonly emptyNavItems: NavItem[] = [];
  private readonly maxSidebarSearchResultsPerGroup = 8;
  private navSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private isBackNavigation = false;
  private readonly navGroupIconFallback = 'M4 5h7v7H4z M13 5h7v7h-7z M4 14h7v5H4z M13 14h7v5h-7z';
  private readonly navGroupIconPaths: Record<string, string> = {
    command: 'M4 5h7v7H4z M13 5h7v7h-7z M4 14h7v5H4z M13 14h7v5h-7z',
    frontdesk: 'M4 18h16 M7 18v-2a5 5 0 0 1 10 0v2 M12 8v3 M9 8h6 M6 21h12',
    pos: 'M5 5h14v14l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z M8 9h8 M8 13h6',
    inventory: 'M3 8l9-4 9 4-9 4z M3 8v8l9 4 9-4V8 M12 12v8',
    staff: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20v-1a5 5 0 0 1 5-5h1 M21 20v-1a5 5 0 0 0-5-5h-1 M9 20v-1a4 4 0 0 1 6 0v1',
    clients: 'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M3 21v-1a5 5 0 0 1 5-5h2 M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M13 21v-1a5 5 0 0 1 5-5h1',
    finance: 'M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4z M4 7V5h12 M15 13h5 M8 10h5 M8 14h4',
    marketing: 'M4 11h3l9-4v10l-9-4H4z M7 13l2 6 M18 9l2-2 M18 15l2 2',
    admin: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z M12 9v5 M9.5 11.5h5',
    settings: 'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z M19.4 15a7.8 7.8 0 0 0 .1-1l2-1.2-2-3.5-2.3.9a7 7 0 0 0-1.7-1L15.2 6h-4l-.4 3.2a7 7 0 0 0-1.7 1l-2.3-.9-2 3.5 2 1.2a7.8 7.8 0 0 0 0 2l-2 1.2 2 3.5 2.3-.9a7 7 0 0 0 1.7 1l.4 3.2h4l.4-3.2a7 7 0 0 0 1.7-1l2.3.9 2-3.5z',
    'ai-platform': 'M12 3l1.2 3.4L16 8l-2.8 1.6L12 13l-1.2-3.4L8 8l2.8-1.6z M5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8z M18 13l.7 1.8 2.3.7-2.3.7L18 18l-.7-1.8-2.3-.7 2.3-.7z'
  };
  private loadedLocalizationTenantId = '';

  @ViewChild('sidebarSearchInput') private sidebarSearchInput?: ElementRef<HTMLInputElement>;
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
            { path: '/command-center/oversight', label: 'Oversight', icon: 'OV', keywords: 'scrutiny oversight fraud audit verify staff risk reconciliation siem' },
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
        }]
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
            { path: '/pos/payment-modes', label: 'Payment Modes', icon: 'PM', keywords: 'cash card upi payment' },
            { path: '/pos/payment-mode-report', label: 'Payment Mode Report', icon: 'PR', keywords: 'payment mode report cash card upi settlement' },
            { path: '/pos/cash-drawer-eod', label: 'Cash Drawer Tally', icon: 'CD', keywords: 'cash drawer tally day close settlement eod register close' }
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
            { path: '/inventory/purchase-bill-entry', label: 'Purchase Bill Entry', icon: 'PB', keywords: 'purchase bill vendor paid unpaid record payment' },
            { path: '/inventory/purchase-bill-register', label: 'Purchase Bill Register', icon: 'BR', keywords: 'saved purchase bill find vendor payment unpaid paid' },
            { path: '/inventory/purchase-bill-drafts', label: 'AI Bill Drafts', icon: 'AI', keywords: 'ai purchase bill scanner draft invoice receiving' },
            { path: '/inventory/purchase-orders', label: 'Purchase Orders', icon: 'PO', keywords: 'purchase order po vendor' },
            { path: '/inventory/reorder', label: 'AI Reorder', icon: 'AR', keywords: 'low stock reorder purchase prediction approval' },
            { path: '/inventory/laundry-entry', label: 'Laundry Entry', icon: 'LE', keywords: 'laundry inward outward towel linen' },
            { path: '/inventory/laundry-report', label: 'Laundry Report', icon: 'LR', keywords: 'laundry report inward outward saved entries' },
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
      id: 'clients',
      label: 'Clients',
      icon: 'CL',
      primaryPath: '/customer-360',
      items: [
        { path: '/customer-360', label: 'Customer 360', icon: '360', keywords: 'customer intelligence guest duplicate merge ltv risk timeline' },
        { path: '/client-masters', label: 'Client Masters', icon: 'CM', keywords: 'flexi client masters category source consultation feedback preferences' },
        { path: '/clients', label: 'Client CRM', icon: 'CL', keywords: 'client guest crm duplicate merge saved clients profile' }
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
            { path: '/transactions/outgoing-funds', label: 'Outgoing Fund', icon: 'OF', keywords: 'outgoing funds payments expense cash bank balance sheet' },
            { path: '/transactions/petty-cash', label: 'Petty Cash Entry', icon: 'PC', keywords: 'petty cash in out debit credit expense' },
            { path: '/transactions/petty-cash-report', label: 'Petty Cash Report', icon: 'PR', keywords: 'petty cash report ledger debit credit balance' }
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
            { path: '/sales-tools', label: 'Sales Tools', icon: 'ST', keywords: 'sales tools referral gift card campaigns coupons rewards marketplace deals boost automation' },
            { path: '/marketing/birthdays', label: 'Birthdays', icon: 'BD', keywords: 'birthday campaign ai whatsapp sms offers clients' },
            { path: '/leads', label: 'Lead Management', icon: 'LM', keywords: 'leads pipeline follow up kanban sales crm prospect enquiry' },
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
      primaryPath: '/settings/general',
      items: [
        {
          path: '/settings/general',
          label: 'Tenant Setup',
          icon: 'TS',
          keywords: 'tenant admin saas branches settings permissions business white label quality',
          children: [
            { path: '/super-admin', label: 'Super Admin', icon: 'SA', keywords: 'tenant admin platform' },
            { path: '/saas', label: 'SaaS', icon: 'X', keywords: 'saas onboarding tenant' },
            { path: '/branches', label: 'Branches', icon: 'B', keywords: 'branch location' },
            { path: '/settings', label: 'Settings', icon: 'G', keywords: 'settings records configuration raw' },
            { path: '/settings/general', label: 'General Settings', icon: 'GS', keywords: 'general settings tenant defaults workspace' },
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
            { path: '/mfa-security', label: 'MFA Security', icon: 'MF', keywords: 'security mfa totp sessions recovery step up' },
            { path: '/passkeys', label: 'Passkeys', icon: 'PK', keywords: 'security passkey webauthn biometric phishing resistant' },
            { path: '/audit-logs', label: 'Audit Logs', icon: 'AL', keywords: 'audit logs activity' },
            { path: '/site-logs', label: 'Site Logs', icon: 'SL', keywords: 'site logs activity audit security ip risk' },
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
      id: 'settings',
      label: 'Settings',
      icon: 'SE',
      primaryPath: '/settings/general',
      items: [
        {
          path: '/settings/general',
          label: 'Business Settings',
          icon: 'BS',
          keywords: 'settings business configuration calendar tax marketplace client custom form',
          children: [
            { path: '/settings', label: 'Settings', icon: 'G', keywords: 'settings records configuration raw' },
            { path: '/settings/general', label: 'General Settings', icon: 'GS', keywords: 'general settings tenant defaults workspace' },
            { path: '/settings/products', label: 'Products Settings', icon: 'PS', keywords: 'product settings sku retail inventory' },
            { path: '/settings/supplier', label: 'Supplier Settings', icon: 'SS', keywords: 'supplier settings vendor purchase gst' },
            { path: '/settings/inventory', label: 'Inventory Settings', icon: 'IS', keywords: 'inventory settings stock reorder barcode' },
            { path: '/settings/sms-template', label: 'SMS Template Settings', icon: 'ST', keywords: 'sms template message settings' },
            { path: '/settings/services', label: 'Services Settings', icon: 'SV', keywords: 'services settings catalog pricing duration online booking commission recipe' },
            { path: '/settings/packages', label: 'Packages Settings', icon: 'PK', keywords: 'packages settings credits redemption expiry renewal package sale' },
            { path: '/settings/membership', label: 'Membership Settings', icon: 'MS', keywords: 'membership settings loyalty renewal credits benefits redemption' },
            { path: '/settings/custom-fields', label: 'Custom Fields', icon: 'CF', keywords: 'custom fields settings clients appointments invoice service staff' },
            { path: '/settings/consent-forms', label: 'Consent Forms', icon: 'CN', keywords: 'consent form settings intake client service' },
            { path: '/settings/booking', label: 'Booking Settings', icon: 'BK', keywords: 'booking settings appointment online rules' },
            { path: '/settings/multiple-location', label: 'Multiple Location', icon: 'ML', keywords: 'multiple location branch settings' },
            { path: '/settings/calendar', label: 'Calendar Settings', icon: 'CS', keywords: 'calendar booking slot appointment settings' },
            { path: '/settings/taxes', label: 'Tax Settings', icon: 'TX', keywords: 'gst tax invoice settings' },
            { path: '/settings/clients/custom-form', label: 'Client Form', icon: 'CF', keywords: 'client custom form settings' },
            { path: '/settings/marketplace', label: 'Marketplace', icon: 'MP', keywords: 'marketplace integration settings' },
            { path: '/settings/others', label: 'Other Settings', icon: 'OS', keywords: 'other settings salon policies' },
            { path: '/settings/bill-setting', label: 'Bill Settings', icon: 'BS', keywords: 'bill invoice print terms dual language feedback settings' },
            { path: '/settings/business-details', label: 'Business Details Settings', icon: 'BD', keywords: 'business details settings profile invoice' },
            { path: '/settings/payment-methods', label: 'Payment Methods', icon: 'PM', keywords: 'payment methods split partial due refund settlement upi card cash' },
            { path: '/settings/message-history', label: 'Message History', icon: 'MH', keywords: 'message history settings sms whatsapp email' },
            { path: '/settings/security', label: 'Security Settings', icon: 'SC', keywords: 'security settings password session audit' }
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

  readonly sidebarSearchResultsByGroup = computed(() => {
    const term = this.navQuery().trim().toLowerCase();
    if (!term) return new Map<string, NavItem[]>();

    const results = new Map<string, NavItem[]>();
    for (const group of this.navGroups) {
      const items = this.sidebarSearchItemsForGroup(group, term);
      if (items.length) results.set(group.id, items);
    }
    return results;
  });

  readonly visibleNavGroups = computed(() => {
    const term = this.navQuery().trim().toLowerCase();
    const searchResults = this.sidebarSearchResultsByGroup();
    return this.navGroups
      .map((group) => {
        const items = group.items.filter((item) => this.hasAccessibleNavItem(item));
        const groupMatches = term && `${group.label} ${group.id}`.toLowerCase().includes(term);
        if (!term || groupMatches || searchResults.has(group.id)) return { ...group, items };
        return { ...group, items: [] };
      })
      .filter((group) => group.items.length);
  });
  readonly activePageLabel = computed(() => {
    return this.pageLabelForUrl(this.activeRoute()) || 'Command workspace';
  });
  readonly activeLocalNav = computed<ActiveLocalNav | null>(() => {
    const branch = this.navBranchForUrl(this.activeRoute());
    if (!branch) return null;

    if (branch.group.id === 'clients') {
      const children = branch.group.items.filter((item) => this.canAccessNavItem(item));
      if (!children.length) return null;

      return {
        groupId: branch.group.id,
        groupLabel: branch.group.label,
        path: branch.group.primaryPath,
        label: branch.group.label,
        icon: branch.group.icon,
        children
      };
    }

    if (!branch.item.children?.length) return null;

    const children = this.localNavChildren(branch.group.id, branch.item).filter((item) => this.canAccessNavItem(item));
    if (!children.length) return null;

    return {
      groupId: branch.group.id,
      groupLabel: branch.group.label,
      path: branch.item.path,
      label: branch.item.label,
      icon: branch.item.icon,
      children
    };
  });
  readonly activeModuleTabs = computed<ActiveModuleTabs | null>(() => {
    const branch = this.navBranchForUrl(this.activeRoute());
    if (!branch) return null;
    if (branch.group.id === 'clients') return null;

    const items = branch.group.items.filter((item) => this.canAccessNavItem(item));
    if (!items.length) return null;

    return {
      groupId: branch.group.id,
      label: branch.group.label,
      items
    };
  });
  readonly backButtonLabel = computed(() => {
    const previous = this.previousRoute();
    if (previous && previous !== this.activeRoute()) {
      return `Back to ${this.pageLabelForUrl(previous) || 'previous page'}`;
    }
    const fallback = this.backFallbackRoute(this.activeRoute());
    if (fallback && this.routePath(this.activeRoute()).startsWith('/billing')) return 'Back to invoices';
    if (fallback) return 'Back to ' + (this.pageLabelForUrl(fallback) || 'previous page');
    return 'Back to Home';
  });

  constructor(
    readonly api: ApiService,
    readonly state: AppStateService,
    readonly session: AuthSessionService,
    readonly i18n: I18nService,
    readonly generalSettings: GeneralSettingsService,
    readonly appointmentToolbar: AppointmentToolbarService,
    private readonly router: Router,
    private readonly prefetcher: NavigationPrefetchService
  ) {
    this.isPortal.set(this.isPortalUrl(this.router.url));
    this.activeRoute.set(this.router.url);
    this.ensureActiveGroupExpanded(this.router.url);
    this.enforceRoutePermission(this.router.url);
    window.addEventListener('aura:app-error', (event) => {
      this.globalError.set(this.readGlobalError((event as CustomEvent<{ message: unknown }>).detail?.message));
    });
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
      const url = (event as NavigationEnd).urlAfterRedirects;
      const current = this.activeRoute();
      if (url !== current) {
        if (this.isBackNavigation) {
          this.isBackNavigation = false;
        } else {
          this.recordBackHistory(current, url);
        }
      }
      this.isPortal.set(this.isPortalUrl(url));
      this.activeRoute.set(url);
      this.enforceRoutePermission(url);
      this.syncPreviousRouteFromHistory();
      this.ensureActiveGroupExpanded(url);
    });
    effect(() => {
      this.state.selectedTenantId();
      this.state.selectedBranchId();
      this.session.session();
      if (this.session.isAuthenticated()) {
        this.enforceRoutePermission(this.activeRoute());
        this.loadTenants();
        this.loadBranches();
        this.loadLocalizationPreference(this.state.selectedTenantId());
        this.generalSettings.ensureLoaded().subscribe({
          next: () => {
            this.loadBranches();
            this.applyDefaultLandingPage();
          },
          error: () => undefined
        });
        this.prefetcher.warmHighUseRoutes();
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
        this.prefetcher.warmHighUseRoutes();
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
    const previous = this.popBackRoute(current);
    if (previous) {
      this.navigateBackTo(previous, current);
      return;
    }
    const fallback = this.backFallbackRoute(current);
    if (fallback) {
      this.navigateBackTo(fallback, current);
      return;
    }
    if (!this.isHomePath(this.routePath(current))) {
      this.navigateBackTo('/home', current);
    }
  }

  loadBranches(): void {
    if (!this.canAccessPath('/branches')) {
      this.branches.set(this.currentBranchOption());
      return;
    }
    this.api.list<ApiRecord[]>('branches').subscribe({
      next: (branches) => {
        const rows = (branches || []).filter((branch) => branch && branch.id);
        const user = this.session.currentUser();
        const role = this.state.userRole();
        const adminScope = ['superAdmin', 'owner', 'admin'].includes(role);
        const allowedBranchIds = new Set(user?.branchIds || []);
        const scopedRows = adminScope || !allowedBranchIds.size ? rows : rows.filter((branch) => allowedBranchIds.has(String(branch.id)));
        this.branches.set(scopedRows);
        const selectedBranchId = this.state.selectedBranchId();
        const selectedExists = scopedRows.some((branch) => branch.id === selectedBranchId);
        if (scopedRows.length && (!selectedBranchId || !selectedExists)) {
          const policy = this.generalSettings.settings().branchBehavior;
          if (policy.requireBranchSelection && policy.allowBranchSwitch) {
            if (selectedBranchId) this.state.setBranch('', policy.rememberLastBranch);
          } else {
            this.state.setBranch(scopedRows[0].id, policy.rememberLastBranch);
          }
        }
      },
      error: () => this.branches.set([])
    });
  }

  loadTenants(): void {
    if (!this.canAccessPath('/settings')) {
      this.tenants.set(this.currentTenantOption());
      return;
    }
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
    if (!this.generalSettings.allowBranchSwitch()) return;
    if (branchId === this.state.selectedBranchId()) return;
    this.state.setBranch(branchId, this.generalSettings.settings().branchBehavior.rememberLastBranch);
    window.location.reload();
  }

  selectRequiredBranch(branchId: string): void {
    if (!branchId) return;
    this.state.setBranch(branchId, this.generalSettings.settings().branchBehavior.rememberLastBranch);
    window.location.reload();
  }

  private applyDefaultLandingPage(): void {
    const currentPath = this.routePath(this.router.url);
    if (currentPath !== '/home' && currentPath !== '/') return;
    const routes: Record<string, string> = {
      dashboard: '/dashboard',
      pos: '/pos',
      appointments: '/appointments',
      clients: '/clients',
      reports: '/reports'
    };
    const target = routes[this.generalSettings.settings().workspace.defaultLandingPage] || '/dashboard';
    if (target !== currentPath && this.canAccessPath(target)) this.router.navigateByUrl(target);
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
    if (!this.canAccessPath('/localization')) return;
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

  prefetchNavPath(path: string): void {
    this.prefetcher.prefetch(path);
  }

  prefetchNavItem(item: NavItem): void {
    this.prefetchNavPath(item.path);
  }

  prefetchNavGroup(group: NavGroup): void {
    this.prefetchNavPath(group.primaryPath);
  }
  navGroupIconPath(groupId: string): string {
    return this.navGroupIconPaths[groupId] || this.navGroupIconFallback;
  }

  openNavGroup(group: NavGroup): void {
    this.router.navigateByUrl(group.primaryPath);
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

  openLocalRailPreview(): void {
    this.localRailHoverExpanded.set(true);
  }

  closeLocalRailPreview(event?: FocusEvent): void {
    const currentTarget = event?.currentTarget;
    const nextTarget = event?.relatedTarget;
    if (currentTarget instanceof HTMLElement && nextTarget instanceof Node && currentTarget.contains(nextTarget)) return;
    this.localRailHoverExpanded.set(false);
  }
  ngOnDestroy(): void {
    if (this.navSearchTimer) clearTimeout(this.navSearchTimer);
  }

  setNavSearchDraft(value: string): void {
    this.navSearchDraft.set(value);
    if (this.navSearchTimer) clearTimeout(this.navSearchTimer);
    this.navSearchTimer = setTimeout(() => {
      this.navQuery.set(value);
      this.navSearchTimer = null;
    }, 120);
  }

  clearNavSearch(): void {
    if (this.navSearchTimer) clearTimeout(this.navSearchTimer);
    this.navSearchTimer = null;
    this.navSearchDraft.set('');
    this.navQuery.set('');
  }

  toggleSidebarSearch(): void {
    if (this.sidebarSearchOpen() && !this.navSearchDraft()) {
      this.closeSidebarSearch();
      return;
    }
    this.openSidebarSearch();
  }

  openSidebarSearch(): void {
    this.sidebarSearchOpen.set(true);
    setTimeout(() => this.sidebarSearchInput?.nativeElement.focus(), 0);
  }

  closeSidebarSearch(clear = false): void {
    this.sidebarSearchOpen.set(false);
    if (clear) this.clearNavSearch();
  }

  readonly trackNavGroup = (_: number, group: NavGroup): string => group.id;

  readonly trackNavItem = (_: number, item: NavItem): string => this.navItemRouteKey(item);

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

  isModuleTabActive(item: NavItem, siblings: NavItem[]): boolean {
    const currentPath = this.routePath(this.activeRoute());
    const exactMatch = siblings.find((candidate) => this.moduleTabPaths(candidate).some((path) => currentPath === path));
    if (exactMatch) return exactMatch === item;

    const prefixMatches = siblings
      .map((candidate) => ({
        candidate,
        score: Math.max(...this.moduleTabPaths(candidate).map((path) => this.routePrefixScore(currentPath, path)))
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);

    return prefixMatches[0]?.candidate === item;
  }

  isLocalNavItemActive(item: NavItem): boolean {
    const currentUrl = this.activeRoute();
    const currentPath = this.routePath(currentUrl);
    const targetPath = this.routePath(item.path);
    if (currentPath !== targetPath) return false;

    const queryEntries = Object.entries(item.queryParams || {});
    const currentQuery = this.router.parseUrl(currentUrl).queryParams;
    if (queryEntries.length) {
      return queryEntries.every(([key, value]) => String(currentQuery[key] ?? '') === value);
    }

    const querySpecificSiblingActive = this.activeLocalNav()?.children.some((candidate) => {
      if (candidate === item || this.routePath(candidate.path) !== targetPath || !candidate.queryParams) return false;
      return Object.entries(candidate.queryParams).every(([key, value]) => String(currentQuery[key] ?? '') === value);
    });

    return !querySpecificSiblingActive;
  }

  isSidebarNavItemActive(item: NavItem): boolean {
    const currentUrl = this.activeRoute();
    const currentPath = this.routePath(currentUrl);
    const targetPath = this.routePath(item.path);
    const currentQuery = this.router.parseUrl(currentUrl).queryParams;
    const queryEntries = Object.entries(item.queryParams || {});
    if (queryEntries.length) {
      return currentPath === targetPath && queryEntries.every(([key, value]) => String(currentQuery[key] ?? '') === value);
    }

    const querySpecificSiblingActive = this.activeLocalNav()?.children.some((candidate) => {
      if (this.routePath(candidate.path) !== targetPath || !candidate.queryParams) return false;
      return Object.entries(candidate.queryParams).every(([key, value]) => String(currentQuery[key] ?? '') === value);
    });
    if (currentPath === targetPath && querySpecificSiblingActive) return false;

    return this.isNavItemActive(item);
  }

  private ensureActiveGroupExpanded(url: string): void {
    const group = this.navGroups.find((item) => this.navLeaves(item.items).some((navItem) => this.isRouteActive(url, navItem.path)));
    if (!group || this.expandedGroupIds().includes(group.id)) return;
    const next = [...this.expandedGroupIds(), group.id];
    this.expandedGroupIds.set(next);
    localStorage.setItem('aura.expandedNavGroups', JSON.stringify(next));
  }

  private navItemText(item: NavItem, group: NavGroup): string {
    const childText = this.localNavChildren(group.id, item).map((child) => this.navSearchText(child, group)).join(' ');
    return `${this.navSearchText(item, group)} ${childText}`.toLowerCase();
  }

  navLeafCount(items: NavItem[]): number {
    return items.length;
  }

  visibleSidebarItems(group: NavGroup): NavItem[] {
    if (!this.navQuery().trim()) return this.emptyNavItems;
    return this.sidebarSearchResultsByGroup().get(group.id) || this.emptyNavItems;
  }

  private sidebarSearchItemsForGroup(group: NavGroup, term: string): NavItem[] {
    const groupMatches = `${group.label} ${group.id}`.toLowerCase().includes(term);
    const ranked = new Map<string, { item: NavItem; score: number; index: number }>();
    let index = 0;

    for (const parent of group.items) {
      for (const candidate of [parent, ...this.localNavChildren(group.id, parent)]) {
        const candidateIndex = index++;
        if (!this.canAccessNavItem(candidate)) continue;
        if (!groupMatches && !this.navSearchText(candidate, group).includes(term)) continue;

        const item = this.sidebarSearchItem(candidate);
        const key = this.navItemRouteKey(item);
        const score = this.navItemSearchScore(item, group, term);
        const existing = ranked.get(key);
        if (!existing) {
          ranked.set(key, { item, score, index: candidateIndex });
        } else if (score > existing.score) {
          ranked.set(key, { item, score, index: existing.index });
        }
      }
    }

    return [...ranked.values()]
      .sort((left, right) => left.index - right.index)
      .slice(0, this.maxSidebarSearchResultsPerGroup)
      .map((entry) => entry.item);
  }

  private sidebarSearchItem(item: NavItem): NavItem {
    const result: NavItem = { path: item.path, label: item.label, icon: item.icon };
    if (item.keywords) result.keywords = item.keywords;
    if (item.queryParams) result.queryParams = item.queryParams;
    if (item.permission) result.permission = item.permission;
    return result;
  }

  navItemInitials(item: NavItem): string {
    const explicit = (item.icon || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    if (explicit.length >= 2) return explicit.slice(0, 3);

    const tokens = (item.label || '')
      .replace(/&/g, ' ')
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter(Boolean);

    let initials = '';
    if (tokens.length >= 2) {
      initials = `${tokens[0][0] || ''}${tokens[1][0] || ''}`;
    } else if (tokens.length === 1) {
      initials = tokens[0].slice(0, Math.max(2, Math.min(3, tokens[0].length)));
    } else if (explicit.length === 1) {
      initials = explicit + explicit;
    }

    return (initials || 'NA').slice(0, 3).toUpperCase();
  }
  private navSearchText(item: NavItem, group: NavGroup): string {
    return `${item.label} ${item.path} ${item.icon} ${item.keywords || ''} ${group.label} ${group.id}`.toLowerCase();
  }

  private navItemRouteKey(item: NavItem): string {
    const query = Object.entries(item.queryParams || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    return `${this.routePath(item.path)}?${query}`;
  }

  private moduleTabPaths(item: NavItem): string[] {
    return [item.path, ...(item.children || []).map((child) => child.path)].map((path) => this.routePath(path));
  }

  private routePrefixScore(currentPath: string, targetPath: string): number {
    if (!targetPath || targetPath === '/') return currentPath === targetPath ? 1 : 0;
    if (currentPath === targetPath) return targetPath.length;
    return currentPath.startsWith(`${targetPath}/`) ? targetPath.length : 0;
  }

  private navItemSearchScore(item: NavItem, group: NavGroup, term: string): number {
    const label = item.label.toLowerCase();
    const keywords = (item.keywords || '').toLowerCase();
    const path = item.path.toLowerCase();
    const icon = item.icon.toLowerCase();
    const groupText = `${group.label} ${group.id}`.toLowerCase();
    if (label === term) return 100;
    if (label.startsWith(term)) return 90;
    if (label.includes(term)) return 80;
    if (keywords.includes(term)) return 60;
    if (path.includes(term)) return 50;
    if (icon.includes(term)) return 40;
    if (groupText.includes(term)) return 20;
    return 0;
  }

  private localNavChildren(groupId: string, item: NavItem): NavItem[] {
    const children = [...(item.children || [])];
    if (groupId === 'staff' && item.path === '/staff-os/staff-list') {
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
        if (item.children.some((child) => cleanUrl === child.path || cleanUrl.startsWith(`${child.path}/`))) {
          return { group, item };
        }
      }
    }
    for (const group of this.navGroups) {
      for (const item of group.items) {
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

  private hasAccessibleNavItem(item: NavItem): boolean {
    return this.canAccessNavItem(item) || (item.children || []).some((child) => this.hasAccessibleNavItem(child));
  }

  private canAccessNavItem(item: NavItem): boolean {
    if (item.path === '/notification-center' && this.ownerNotificationPolicyBlocks()) return false;
    return this.canAccessPermission(item.permission || this.navPermissionForPath(item.path));
  }

  private navPermissionForPath(path: string): string | string[] {
    return routePermissionForPath(path);
  }

  canAccessPath(path: string): boolean {
    if (this.routePath(path) === '/notification-center' && this.ownerNotificationPolicyBlocks()) return false;
    return this.canAccessPermission(this.navPermissionForPath(path));
  }

  private ownerNotificationPolicyBlocks(): boolean {
    return ['owner', 'admin', 'superAdmin'].includes(this.state.userRole()) && !this.generalSettings.ownerNotificationsEnabled();
  }

  private canAccessPermission(permission?: string | string[]): boolean {
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamicGrants]));
    if (!grants.length) return false;
    return permissions.some((item) => grantsAllow(grants, item));
  }

  private enforceRoutePermission(url: string): void {
    if (!this.session.isAuthenticated()) return;
    if (this.routePath(url) === '/notification-center' && this.ownerNotificationPolicyBlocks()) {
      void this.router.navigateByUrl('/dashboard');
      return;
    }
    const permission = this.navPermissionForPath(url);
    if (!this.canAccessPermission(permission)) {
      void this.router.navigateByUrl('/dashboard');
    }
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

  private currentTenantOption(): ApiRecord[] {
    const tenantId = this.state.selectedTenantId() || this.session.currentUser()?.branchId || 'tenant_aura';
    return tenantId ? [{ id: tenantId, name: tenantId }] : [];
  }

  private currentBranchOption(): ApiRecord[] {
    const branchId = this.state.selectedBranchId() || this.session.currentUser()?.branchId || '';
    return branchId ? [{ id: branchId, name: branchId }] : [];
  }

  private isBackHistoryCandidate(url: string): boolean {
    const path = this.routePath(url);
    return Boolean(path && path !== '/' && !this.isPortalUrl(path) && !path.startsWith('/auth'));
  }

  private recordBackHistory(currentUrl: string, nextUrl: string): void {
    if (!currentUrl || currentUrl === nextUrl || !this.isBackHistoryCandidate(currentUrl)) {
      this.syncPreviousRouteFromHistory();
      return;
    }
    const currentHistory = this.routeHistory();
    const latest = currentHistory[currentHistory.length - 1];
    if (latest === currentUrl) {
      this.syncPreviousRouteFromHistory();
      return;
    }
    this.routeHistory.set([...currentHistory, currentUrl].slice(-this.maxBackHistory));
    this.syncPreviousRouteFromHistory();
  }

  private popBackRoute(currentUrl: string): string {
    const nextHistory = [...this.routeHistory()];
    while (nextHistory.length) {
      const candidate = nextHistory.pop() || '';
      if (candidate && candidate !== currentUrl && this.isBackHistoryCandidate(candidate)) {
        this.routeHistory.set(nextHistory);
        this.syncPreviousRouteFromHistory();
        return candidate;
      }
    }
    this.routeHistory.set([]);
    this.syncPreviousRouteFromHistory();
    return '';
  }

  private navigateBackTo(url: string, currentUrl: string): void {
    this.isBackNavigation = true;
    void this.router.navigateByUrl(url).finally(() => {
      if (this.activeRoute() === currentUrl) {
        this.isBackNavigation = false;
      }
    });
  }

  private backFallbackRoute(url: string): string {
    const path = this.routePath(url);
    if (path.startsWith('/billing')) return '/pos/invoices';
    return '';
  }

  private syncPreviousRouteFromHistory(): void {
    const history = this.routeHistory();
    this.previousRoute.set(history[history.length - 1] || '');
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

