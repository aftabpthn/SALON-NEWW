import { ChangeDetectionStrategy, Component, computed, HostListener, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthSessionService } from '../../../core/auth-session.service';
import { AppStateService } from '../../../core/state/app-state.service';
import { grantsAllow, staticGrantsForRole } from '../../../core/permission.guard';
import { routePermissionForPath } from '../../../core/access-rules';
import { SidebarStore } from '../../../shell/sidebar/sidebar.store';
import { GeneralSettingsService } from '../../../core/general-settings.service';
import { NotificationCenterService } from '../../../core/notification-center.service';

type PanelId = 'notifications' | 'profile' | null;

/**
 * Premium topbar action cluster: Notifications · AI Assistant · Profile menu.
 * Self-contained — manages its own open/close state and outside-click.
 */
@Component({
  selector: 'aura-header-actions',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hdr-actions">
      <!-- Notifications -->
      <div class="hdr-pop" *ngIf="notificationsVisible() && canAccessPath('/notification-center')">
        <button
          class="hdr-icon-btn"
          type="button"
          [class.is-open]="panel() === 'notifications'"
          (click)="toggle('notifications')"
          aria-label="Notifications"
          title="Notifications">
          <span aria-hidden="true">🔔</span>
          <span class="hdr-dot" *ngIf="notifications.unreadCount()" aria-hidden="true"></span>
        </button>
        <div class="hdr-menu hdr-menu-notif" *ngIf="panel() === 'notifications'">
          <div class="hdr-menu-head">
            <strong>Notifications</strong>
            <span class="hdr-pill">Live</span>
          </div>
          <div class="hdr-notif-list" *ngIf="notifications.recent().length; else notificationEmpty">
            <article *ngFor="let item of notifications.recent()">
              <strong>{{ item['title'] || item['type'] || 'Notification' }}</strong>
              <small>{{ item['message'] || item['body'] || item['status'] }}</small>
            </article>
          </div>
          <ng-template #notificationEmpty><div class="hdr-notif-empty">
            <span class="hdr-notif-emoji" aria-hidden="true">✓</span>
            <strong>{{ notifications.loading() ? 'Loading notifications...' : "You're all caught up" }}</strong>
          </div></ng-template>
          <a class="hdr-menu-foot" routerLink="/notification-center" (click)="closeAll()">
            Open Notification Center →
          </a>
        </div>
      </div>

      <!-- Profile -->
      <div class="hdr-pop">
        <button
          class="hdr-profile-btn"
          type="button"
          [class.is-open]="panel() === 'profile'"
          (click)="toggle('profile')"
          aria-label="Profile menu">
          <span class="hdr-avatar">{{ initials() }}</span>
        </button>
        <div class="hdr-menu hdr-menu-profile" *ngIf="panel() === 'profile'">
          <div class="hdr-profile-card">
            <span class="hdr-avatar lg">{{ initials() }}</span>
            <div class="hdr-profile-card-copy">
              <strong>{{ displayName() }}</strong>
              <small>{{ email() }}</small>
              <span class="hdr-role-chip">{{ roleLabel() }}</span>
            </div>
          </div>
          <div class="hdr-scope">
            <div><span>Workspace</span><strong>{{ state.tenantScopeLabel() }}</strong></div>
            <div><span>Branch</span><strong>{{ state.branchScopeLabel() }}</strong></div>
          </div>
          <button class="hdr-theme-toggle" type="button" (click)="toggleLightDarkMode()" [attr.aria-label]="themeButtonLabel()">
            <span class="hdr-theme-icon" aria-hidden="true">{{ themeIcon() }}</span>
            <span class="hdr-theme-copy">
              <strong>{{ themeButtonLabel() }}</strong>
              <small>{{ themeCaption() }}</small>
            </span>
          </button>
          <nav class="hdr-menu-links">
            <a routerLink="/settings/general" *ngIf="canAccessPath('/settings/general')" (click)="closeAll()"><span class="hdr-link-icon">⚙</span> Settings</a>
            <a routerLink="/two-factor" *ngIf="canAccessPath('/two-factor')" (click)="closeAll()"><span class="hdr-link-icon">🛡</span> Security &amp; 2FA</a>
            <a routerLink="/business-details" *ngIf="canAccessPath('/business-details')" (click)="closeAll()"><span class="hdr-link-icon">🏢</span> Business details</a>
          </nav>
          <button class="hdr-logout" type="button" (click)="logout()">Sign out</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .hdr-actions { display: inline-flex; align-items: center; gap: 8px; position: relative; z-index: 2200; }
    .hdr-pop { position: relative; isolation: isolate; }

    .hdr-icon-btn {
      position: relative; width: 42px; height: 42px;
      display: grid; place-items: center; border-radius: 12px;
      border: 1px solid rgba(79, 70, 229, 0.16);
      background: rgba(255, 255, 255, 0.9); color: #3a4660;
      font-size: 1.02rem; cursor: pointer; text-decoration: none;
      transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
    }
    .hdr-icon-btn:hover, .hdr-icon-btn.is-open {
      border-color: rgba(75, 18, 56, 0.42);
      box-shadow: 0 6px 18px rgba(79, 70, 229, 0.16);
      transform: translateY(-1px);
    }
    .hdr-ai {
      color: #fff;
      background: var(--gradient-brand, linear-gradient(135deg, #4B1238, #7c3aed));
      border-color: transparent;
    }
    .hdr-ai:hover { box-shadow: 0 8px 22px rgba(124, 58, 237, 0.34); }
    .hdr-dot {
      position: absolute; top: 9px; right: 10px; width: 8px; height: 8px;
      border-radius: 50%; background: #ef4444; border: 2px solid #fff;
    }

    .hdr-profile-btn {
      display: inline-grid; grid-template-columns: auto auto auto; align-items: center; gap: 9px;
      height: 42px; padding: 0 10px 0 6px; border-radius: 12px;
      border: 1px solid rgba(79, 70, 229, 0.16); background: rgba(255, 255, 255, 0.9);
      cursor: pointer; transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
    }
    .hdr-profile-btn:hover, .hdr-profile-btn.is-open {
      border-color: rgba(75, 18, 56, 0.42);
      box-shadow: 0 6px 18px rgba(79, 70, 229, 0.16);
      transform: translateY(-1px);
    }
    .hdr-avatar {
      width: 32px; height: 32px; display: grid; place-items: center; border-radius: 9px;
      color: #fff; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.02em;
      background: var(--gradient-brand, linear-gradient(135deg, #4B1238, #7c3aed));
      box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
    }
    .hdr-avatar.lg { width: 44px; height: 44px; font-size: 0.95rem; border-radius: 12px; }
    .hdr-profile-meta { display: grid; gap: 0; text-align: left; min-width: 0; }
    .hdr-profile-meta strong {
      font-size: 0.8rem; color: #1d2740; max-width: 130px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hdr-profile-meta small { font-size: 0.68rem; color: #8a93a8; }
    .hdr-chevron { font-size: 0.6rem; color: #98a1b4; }

    .hdr-menu {
      position: fixed; top: 64px; right: 16px; z-index: 2200;
      width: min(290px, calc(100vw - 24px)); padding: 8px; border-radius: 16px;
      border: 1px solid rgba(75, 18, 56, 0.14);
      background: rgba(255, 255, 255, 0.98);
      box-shadow: var(--elev-3, 0 24px 60px rgba(15, 23, 42, 0.2));
      animation: hdr-pop 150ms cubic-bezier(0.2, 0.9, 0.3, 1);
    }
    .hdr-menu-notif {
      right: 66px;
    }

    @media (max-width: 640px) {
      .hdr-menu,
      .hdr-menu-notif {
        left: 12px;
        right: 12px;
        top: 60px;
        width: auto;
      }
    }
    .hdr-menu-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 10px 10px;
    }
    .hdr-menu-head strong { font-size: 0.86rem; color: #1d2740; }
    .hdr-pill {
      font-size: 0.6rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--aura-primary, #4B1238); background: rgba(75, 18, 56, 0.12);
      padding: 3px 8px; border-radius: 999px;
    }
    .hdr-notif-empty {
      display: grid; justify-items: center; gap: 5px; text-align: center;
      padding: 26px 16px; border-radius: 12px; background: #f7f8fd;
    }
    .hdr-notif-emoji {
      width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%;
      background: rgba(38, 122, 69, 0.12); color: #267a45; font-size: 1rem; font-weight: 800;
    }
    .hdr-notif-empty strong { font-size: 0.85rem; color: #1d2740; }
    .hdr-notif-empty small { font-size: 0.74rem; color: #8a93a8; line-height: 1.4; }
    .hdr-notif-list { display: grid; gap: 5px; max-height: 320px; overflow: auto; }
    .hdr-notif-list article { display: grid; gap: 3px; padding: 10px; border-radius: 11px; background: #f7f8fd; }
    .hdr-notif-list strong { color: #1d2740; font-size: .82rem; }
    .hdr-notif-list small { color: #6f7a90; font-size: .72rem; }
    .hdr-menu-foot, .hdr-menu-links a {
      display: block; text-decoration: none; color: var(--aura-primary, #4B1238);
    }
    .hdr-menu-foot {
      margin-top: 6px; padding: 11px; text-align: center; border-radius: 11px;
      font-size: 0.8rem; font-weight: 700;
    }
    .hdr-menu-foot:hover { background: var(--gradient-brand-soft, rgba(75,18,56,0.1)); }

    .hdr-profile-card {
      display: grid; grid-template-columns: auto 1fr; gap: 11px; align-items: center;
      padding: 10px; border-radius: 12px; background: var(--gradient-brand-soft, rgba(75,18,56,0.08));
    }
    .hdr-profile-card-copy { min-width: 0; display: grid; gap: 2px; }
    .hdr-profile-card-copy strong { font-size: 0.88rem; color: #1d2740; }
    .hdr-profile-card-copy small {
      font-size: 0.72rem; color: #6f7a90;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hdr-role-chip {
      justify-self: start; margin-top: 3px; font-size: 0.62rem; font-weight: 800;
      letter-spacing: 0.04em; text-transform: uppercase; color: #fff;
      background: var(--gradient-brand, linear-gradient(135deg, #4B1238, #7c3aed));
      padding: 2px 8px; border-radius: 999px;
    }
    .hdr-scope {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 10px 6px;
    }
    .hdr-scope div { display: grid; gap: 1px; padding: 0 6px; }
    .hdr-scope span { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #98a1b4; }
    .hdr-scope strong {
      font-size: 0.78rem; color: #1d2740;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hdr-theme-toggle {
      width: calc(100% - 12px); margin: 0 6px 8px; padding: 9px 10px; border-radius: 12px;
      border: 1px solid rgba(75, 18, 56, 0.14); background: #f7f8fd; color: #1d2740;
      display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 10px; cursor: pointer;
      text-align: left; transition: background 130ms ease, border-color 130ms ease, transform 130ms ease;
    }
    .hdr-theme-toggle:hover { background: #eef1fb; border-color: rgba(75, 18, 56, 0.28); transform: translateY(-1px); }
    .hdr-theme-icon {
      width: 30px; height: 30px; display: grid; place-items: center; border-radius: 10px;
      color: #fff; background: var(--gradient-brand, linear-gradient(135deg, #4B1238, #7c3aed)); font-weight: 900;
    }
    .hdr-theme-copy { display: grid; gap: 1px; min-width: 0; }
    .hdr-theme-copy strong { font-size: 0.82rem; color: #1d2740; }
    .hdr-theme-copy small { font-size: 0.7rem; color: #6f7a90; }
    .hdr-menu-links { display: grid; gap: 2px; padding: 4px 0; border-top: 1px solid rgba(15,23,42,0.07); }
    .hdr-menu-links a {
      display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px;
      color: #2b3550; font-size: 0.82rem; font-weight: 600;
    }
    .hdr-menu-links a:hover { background: #f4f5fb; }
    .hdr-link-icon { width: 20px; text-align: center; opacity: 0.8; }
    .hdr-logout {
      width: 100%; margin-top: 4px; padding: 10px; border-radius: 11px; cursor: pointer;
      border: 1px solid rgba(239, 68, 68, 0.22); background: rgba(239, 68, 68, 0.06);
      color: #c0392b; font-size: 0.82rem; font-weight: 700;
      transition: background 130ms ease;
    }
    .hdr-logout:hover { background: rgba(239, 68, 68, 0.12); }
    @keyframes hdr-pop { from { opacity: 0; transform: translateY(-6px) scale(0.98); } to { opacity: 1; transform: none; } }
  `]
})
export class HeaderActionsComponent {
  readonly panel = signal<PanelId>(null);

  readonly displayName = computed(() => this.session.currentUser()?.name?.trim() || 'Aura User');
  readonly email = computed(() => this.session.currentUser()?.email || '');
  readonly roleLabel = computed(() => this.prettyRole(this.state.userRole()));
  readonly notificationsVisible = computed(() => !['owner', 'admin', 'superAdmin'].includes(this.state.userRole()) || this.generalSettings.ownerNotificationsEnabled());
  readonly initials = computed(() => {
    const name = this.displayName();
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (name.slice(0, 2) || 'AU').toUpperCase();
  });

  readonly themeButtonLabel = computed(() => this.sidebarStore.theme() === 'dark' ? 'Light mode' : 'Dark mode');
  readonly themeIcon = computed(() => this.sidebarStore.theme() === 'dark' ? '☀' : '◐');
  readonly themeCaption = computed(() => this.sidebarStore.theme() === 'dark' ? 'Switch to light interface' : 'Switch to dark interface');

  constructor(
    readonly state: AppStateService,
    readonly sidebarStore: SidebarStore,
    readonly generalSettings: GeneralSettingsService,
    readonly notifications: NotificationCenterService,
    private readonly session: AuthSessionService,
    private readonly router: Router
  ) {}

  toggle(id: Exclude<PanelId, null>): void {
    this.panel.set(this.panel() === id ? null : id);
  }

  closeAll(): void {
    this.panel.set(null);
  }

  toggleLightDarkMode(): void {
    this.sidebarStore.theme.set(this.sidebarStore.theme() === 'dark' ? 'light' : 'dark');
  }
  logout(): void {
    this.closeAll();
    this.session.logout();
  }

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  @HostListener('document:click', ['$event'])
  onDocClick(event: MouseEvent): void {
    if (this.panel() && !(event.target as HTMLElement).closest('aura-header-actions')) {
      this.closeAll();
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.closeAll();
  }

  private prettyRole(role: string): string {
    return role
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
  }
}
