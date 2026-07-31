import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { StaffAppService, StaffEnterpriseOs, StaffWorkspacePreferences } from "../../core/staff-app.service";
import { StaffPushService } from "../../core/staff-push.service";
import { resolveStaffIdentity } from "./staff-role-label";

type StaffNavItem = { label: string; path: string; iconPath: string; group: string; permission?: string; anyPermissions?: readonly string[] };
type StaffRecentItem = { label: string; path: string };

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <section class="staff-app-shell" [class.staff-compact]="preferences().interface.compactMode">
      <button type="button" class="drawer-backdrop" [class.open]="menuOpen()" (click)="closeMenu()" aria-label="Close menu"></button>
      <aside class="staff-sidebar" [class.open]="menuOpen()" [attr.role]="menuOpen() ? 'dialog' : null" [attr.aria-modal]="menuOpen() ? 'true' : null" [attr.aria-label]="menuOpen() ? 'Staff navigation' : null" [attr.inert]="notificationsOpen() || commandOpen() ? '' : null" tabindex="-1" #menuDialog (keydown)="menuOpen() && trapFocus($event, menuDialog)">
        <button type="button" class="drawer-close" (click)="closeMenu()" aria-label="Close menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5z"></path></svg></button>
        <a class="user-card" routerLink="/staff/profile" (click)="closeMenu()" aria-label="Open my profile">
          <b>{{ initials() }}</b>
          <div><strong>{{ staff.user()?.name || 'Aura Staff' }}</strong><small [title]="identitySubtitle()" [attr.aria-label]="identitySubtitle()">{{ identitySubtitle() }}</small></div>
        </a>
        <nav>
          @for (group of navGroups(); track group) {
            <p class="nav-group">{{ group }}</p>
            @for (item of navByGroup(group); track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: item.path === '/staff/dashboard' }" (click)="activateNav(item)"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.iconPath"></path></svg></span>{{ item.label }}</a>
            }
          }
        </nav>
        <button type="button" class="nav-logout" (click)="logout()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3zm5.6 4.4L14.2 8.8l2.2 2.2H9v2h7.4l-2.2 2.2 1.4 1.4 4.6-4.6-4.6-4.6z"></path></svg><span>Logout</span></button>
      </aside>

       <div class="staff-main-shell" [attr.inert]="menuOpen() || notificationsOpen() || commandOpen() ? '' : null">
        <header class="staff-topbar">
           <button type="button" class="menu-button" (click)="openMenu()" aria-label="Open menu" [attr.aria-expanded]="menuOpen()" #menuButton><span></span><span></span><span></span></button>
           <a class="staff-identity" routerLink="/staff/profile" [attr.aria-label]="'Open my profile — ' + identitySubtitle()"><b class="profile-avatar">{{ initials() }}</b><div><span>{{ greetingLabel() }}</span><strong>{{ staff.user()?.name || 'Aura Staff' }}</strong><small [title]="identitySubtitle()" [attr.aria-label]="identitySubtitle()">{{ identitySubtitle() }}</small></div></a>
          <div class="topbar-actions">
             @if (visibleNav().length) { <button type="button" class="search-button" (click)="openCommand()" aria-label="Search permitted staff tools" [attr.aria-expanded]="commandOpen()" #commandButton><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 19.6-5.1-5.1a7 7 0 1 0-1.4 1.4l5.1 5.1 1.4-1.4zM5 10a5 5 0 1 1 10 0A5 5 0 0 1 5 10z"></path></svg><span>Search workspace</span><kbd>Ctrl K</kbd></button> }
             @if (staff.hasPermission('staff.app.chat.read')) { <a class="chat-button" routerLink="/staff/chat" routerLinkActive="active" aria-label="Open chat" title="Chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v10h2v1.8L8.3 16H20V6H4zm3 3h10v2H7V9zm0 4h7v2H7v-2z"></path></svg></a> }
             @if (staff.hasPermission('staff.app.notifications.read')) { <button type="button" class="bell-button" [class.has-unread]="unreadCount() > 0" (click)="toggleNotifications()" aria-label="Open notifications" [attr.aria-expanded]="notificationsOpen()" #notificationButton>
              <svg class="bell-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 10.8c0-3.5-2.1-6.1-5-6.7V3a1 1 0 0 0-2 0v1.1c-2.9.6-5 3.2-5 6.7V15l-1.6 2.4A1 1 0 0 0 5.2 19h13.6a1 1 0 0 0 .8-1.6L18 15v-4.2zM9.7 20a2.4 2.4 0 0 0 4.6 0H9.7z"></path>
              </svg>
              @if (unreadCount() > 0) { <span class="bell-badge">{{ unreadCount() }}</span> }
             </button> }
            <span class="net-status network-status" [class.offline]="!online()" aria-live="polite">{{ online() ? 'Online' : 'Offline' }}</span>
            @if (offlinePending()) { <span class="queue-status">{{ offlinePending() }} queued</span> }
          </div>
        </header>
         <main class="staff-content">
          <router-outlet />
        </main>
      </div>

       <nav class="mobile-bottom-nav" aria-label="Primary staff navigation" [attr.inert]="menuOpen() || notificationsOpen() || commandOpen() ? '' : null">
         <a routerLink="/staff/dashboard" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Dashboard')"></path></svg><span>Home</span></a>
         @if (staff.hasPermission('staff.app.appointments.read')) { <a routerLink="/staff/appointments" routerLinkActive="active"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Appointments')"></path></svg><span>Appointments</span></a> }
         @if (staff.hasPermission('staff.app.tasks.read')) { <a routerLink="/staff/tasks" routerLinkActive="active"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Tasks')"></path></svg><span>Tasks</span></a> }
         @if (staff.hasPermission('staff.app.attendance.read')) { <a routerLink="/staff/attendance" routerLinkActive="active"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Attendance')"></path></svg><span>Attendance</span></a> }
         <button type="button" [class.active]="isMoreActive()" (click)="openMenu()" aria-label="Open more staff tools" [attr.aria-expanded]="menuOpen()" #moreButton><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z"></path></svg><span>More</span></button>
      </nav>

      @if (commandOpen()) {
        <section class="command-backdrop" (click)="closeCommand()">
          <div class="command-palette" role="dialog" aria-modal="true" aria-labelledby="staff-command-title" tabindex="-1" #commandDialog (keydown)="trapFocus($event, commandDialog)" (click)="$event.stopPropagation()">
            <div class="command-head"><strong id="staff-command-title">Command palette</strong><button type="button" (click)="closeCommand()">Close</button></div>
            <input [ngModel]="query()" (ngModelChange)="query.set($event)" (keydown)="onCommandKeydown($event)" aria-label="Search staff pages and business" placeholder="Search staff pages and business..." #commandInput autofocus />
            @if (query().trim()) { <small class="search-hint">{{ commandResults().length }} matches · Press Enter to open the first result</small> }
            <div class="command-list">
              @for (item of commandResults(); track $index) {
                <button type="button" (click)="go(item)"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.iconPath"></path></svg></span><div><strong>{{ item.label }}</strong><small>{{ item.group }}</small></div></button>
              } @empty {
                <p>No matching staff command.</p>
              }
            </div>
          </div>
        </section>
      }

      @if (notificationsOpen() && staff.hasPermission('staff.app.notifications.read')) {
        <button type="button" class="drawer-backdrop open" (click)="closeNotifications()" aria-label="Close notifications"></button>
        <aside class="notification-drawer open" role="dialog" aria-modal="true" aria-labelledby="staff-notifications-title" tabindex="-1" #notificationDialog (keydown)="trapFocus($event, notificationDialog)">
          <div class="drawer-title"><strong id="staff-notifications-title">Notifications</strong><button type="button" (click)="closeNotifications()">Close</button></div>
          <section class="push-permission-card" [attr.data-state]="push.state()">
            <div><strong>Mobile notifications</strong><small>{{ push.label() }}</small></div>
            @if (push.state() === 'available' || push.state() === 'unconfigured') {
              <button type="button" [disabled]="push.busy()" (click)="enableMobileNotifications()">{{ push.busy() ? 'Enabling...' : 'Enable' }}</button>
            }
            @if (push.state() === 'enabled') { <span>On</span> }
          </section>
          @if (push.message()) { <p class="push-message" role="status">{{ push.message() }}</p> }
          <div class="notice-list">
            @for (note of os()?.notifications || []; track note.id) {
              <article><strong>{{ note.title }}</strong><small>{{ note.body || note.status }}</small><span>{{ note.status }}</span><button type="button" (click)="markNotification(note.id, note.status === 'read' ? 'unread' : 'read')">{{ note.status === 'read' ? 'Mark unread' : 'Mark read' }}</button></article>
            } @empty {
              <p>No notifications yet.</p>
            }
          </div>
        </aside>
      }

      @if (toastMessage()) { <section class="staff-toast" role="status">{{ toastMessage() }}</section> }
    </section>
  `,
  styles: [`
    .staff-app-shell { min-height: 100vh; display: grid; grid-template-columns: 248px minmax(0, 1fr); background: var(--staff-background); color: var(--staff-text); }
    .staff-sidebar { position: sticky; top: 0; display:flex; flex-direction:column; height: 100vh; overflow: hidden; padding: 10px 8px; border-right: 1px solid var(--staff-border); background: var(--staff-primary-hover); color: var(--staff-on-primary); }
    .menu-button, .drawer-close { display: none; }
    .drawer-backdrop { display: block; position: fixed; inset: 0; z-index: 29; border: 0; opacity: 0; pointer-events: none; background: var(--staff-overlay); backdrop-filter: blur(2px); transition: opacity .18s ease; }
    .drawer-backdrop.open { opacity: 1; pointer-events: auto; }
    .menu-button span { display: block; width: 18px; height: 2px; border-radius: 999px; background: var(--staff-text); }
    .user-card { display: grid; grid-template-columns: 36px 1fr; gap: 10px; align-items: center; margin: 4px 0 6px; padding: 8px; border: 1px solid rgba(255,255,255,.16); border-radius: 6px; background: rgba(255,255,255,.08); color: var(--staff-on-primary); text-decoration: none; cursor: pointer; }
    .user-card:hover, .user-card:focus-visible { border-color: rgba(255,255,255,.35); background: rgba(255,255,255,.14); }
    .user-card b { display:grid; place-items:center; width:36px; height:36px; border-radius:6px; background:var(--staff-on-primary); color:var(--staff-primary-hover); }
    .profile-avatar { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 15px; background: var(--staff-primary); color: var(--staff-on-primary); }
    .user-card strong, .user-card small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .user-card small { color: rgba(255,255,255,.72); font-weight: 600; }
    .recent-card { display: grid; gap: 6px; margin-top: 12px; padding: 10px; border: 1px solid var(--staff-border); border-radius: 18px; background: var(--staff-surface-secondary); }
    .recent-card span, .nav-group { margin: 12px 8px 4px; color: rgba(255,255,255,.62); font-size: .64rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .recent-card a { display:block;min-height:44px;padding:12px 4px;color:var(--staff-text);font-size:.82rem;font-weight:650;text-decoration:none; }
    .staff-sidebar nav { display: grid; flex:1; align-content:start; gap: 3px; min-height:0; margin-top: 0; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; }
    .staff-sidebar nav a { display: grid; grid-template-columns: 34px 1fr; gap: 9px; align-items: center; min-height:44px;padding: 4px 8px; border: 1px solid transparent; border-radius: 6px; color: rgba(255,255,255,.82); font-size:.82rem; font-weight: 600; text-decoration: none; }
    .staff-sidebar nav a span { display: grid; place-items: center; width: 34px; height: 34px; color: inherit; }
    svg { width: 17px; height: 17px; fill: currentColor; }
    .staff-sidebar nav a.active, .staff-sidebar nav a:hover { border-color: var(--staff-border-accent); background: var(--staff-primary-light); color: var(--staff-primary-hover); }
    .nav-logout { display:flex; align-items:center; gap:9px; width:100%; min-height:44px; margin-top:6px; padding:4px 12px; border:1px solid rgba(255,255,255,.18); border-radius:6px; background:transparent; color:rgba(255,255,255,.86); font-weight:600; text-align:left; }
    .nav-logout:hover { border-color:rgba(255,255,255,.35); background:rgba(255,255,255,.12); color:var(--staff-on-primary); }
    .nav-logout svg { width:18px; height:18px; }
    .staff-main-shell { min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100vh; overflow: hidden; }
    .staff-topbar { position: relative; display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height:var(--staff-header-height);padding: 3px 16px; border-bottom: 1px solid var(--staff-border); background: var(--staff-surface-glass); backdrop-filter: blur(16px); }
    .staff-identity { display: flex; align-items:center; min-width: 0; max-width:min(420px,48vw); gap: 10px; color:inherit; text-decoration:none; }
    .staff-identity>div { display:grid;gap:1px;min-width:0; }
    .staff-identity span { overflow: hidden; color: var(--staff-text-secondary); font-size: .72rem; font-weight: 650; letter-spacing: 0; text-overflow: ellipsis; white-space: nowrap; }
    .staff-identity strong { overflow: hidden; color: var(--staff-text); font-size: .92rem; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
    .staff-identity small { overflow:hidden;color:var(--staff-text-secondary);font-size:.72rem;font-weight:650;text-overflow:ellipsis;white-space:nowrap; }
    .staff-topbar strong { color: var(--staff-text); }
    .topbar-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0; flex-wrap: wrap; }
    .topbar-actions span { color: var(--staff-text-secondary); font-weight: 650; }
    .search-button, .chat-button, .bell-button { border: 1px solid var(--staff-border); background:var(--staff-surface-secondary);color:var(--staff-text-secondary);font-weight:700;box-shadow:none; }
    .search-button { display: grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;width:min(330px,28vw);height:44px;padding:0 12px;border-radius:16px;text-align:left; }
    .search-button span { overflow:hidden;font-size:.78rem;text-overflow:ellipsis;white-space:nowrap; }
    .search-button kbd { padding:3px 6px;border:1px solid var(--staff-border);border-radius:7px;background:var(--staff-surface);color:var(--staff-text-secondary);font-size:.64rem; }
    .search-button svg { width: 18px; height: 18px; fill: currentColor; }
    .theme-button { display:flex;align-items:center;justify-content:flex-start;gap:10px;width:100%;min-height:46px;margin-top:12px;padding:0 13px;border:1px solid var(--staff-border);border-radius:16px;background:var(--staff-surface-secondary);color:var(--staff-text);font-weight:700;text-align:left; }
    .theme-button svg { width:18px;height:18px;fill:currentColor; }
    .theme-button span { font-size:.76rem; }
    .search-button:hover, .search-button:focus-visible, .chat-button:focus-visible, .theme-button:focus-visible, .bell-button:focus-visible, .menu-button:focus-visible, .staff-sidebar nav a:focus-visible, .nav-logout:focus-visible { outline: 3px solid var(--staff-focus-ring); outline-offset: 2px; }
    .search-button small { margin-left: 6px; opacity: .72; }
    .bell-button { position: relative; overflow: visible; display: inline-grid; place-items: center; width: 44px; height: 44px; min-width: 44px; padding: 0; border-radius: 16px; }
    .chat-button { display:inline-grid;place-items:center;width:44px;height:44px;min-width:44px;border-radius:16px;text-decoration:none; }
    .chat-button svg { width:20px;height:20px; }
    .chat-button:hover, .chat-button.active, .bell-button:hover, .bell-button.has-unread, .theme-button:hover { border-color: var(--staff-border-accent); color: var(--staff-primary-hover); background:var(--staff-primary-light); }
    .bell-icon { width: 20px; height: 20px; fill: currentColor; }
    .bell-badge { position: absolute; right: -6px; top: -7px; display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border: 2px solid var(--staff-surface); border-radius: 999px; background: var(--staff-primary); color: var(--staff-on-primary) !important; font-size: .66rem; font-weight: 800; line-height: 1; }
    .bell-button:not(.has-unread) .bell-badge { background: var(--staff-disabled); color: var(--staff-text-inverse) !important; }
    .net-status, .queue-status { padding: 7px 10px; border-radius: 999px; background: var(--staff-success-surface); color: var(--staff-success-text) !important; }
    .net-status.offline { background: var(--staff-error-surface); color: var(--staff-error-text) !important; }
    .queue-status { background: var(--staff-primary-light); color: var(--staff-primary-hover) !important; }
    .staff-content { min-width: 0; overflow: auto; padding: 24px; background: var(--staff-background); }
    .staff-policy-hint { margin: 0 0 12px; padding: 9px 12px; border: 1px solid var(--staff-border-accent); border-radius: 12px; background: var(--staff-primary-light); color: var(--staff-primary-hover); font-size: .8rem; font-weight: 650; }
    .staff-app-shell.staff-compact .staff-content { padding: 12px; }
    .staff-app-shell.staff-compact :is(article, .settings-card, .metric-card) { padding: 10px; }
    .staff-app-shell.staff-compact button { min-height: 44px; }
    .staff-app-shell.staff-compact :is(input, select, textarea) { min-height: var(--staff-input-height); }
    .command-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: start center; padding-top: 8vh; background: var(--staff-overlay); backdrop-filter: blur(4px); }
    .command-palette { width: min(720px, calc(100vw - 24px)); max-height: 78vh; overflow: auto; border: 1px solid var(--staff-border); border-radius: 24px; background: var(--staff-surface); box-shadow: var(--staff-shadow-elevated); }
    .command-head, .drawer-title { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px; border-bottom: 1px solid var(--staff-border); }
    .command-head strong, .drawer-title strong { color: var(--staff-text); }
    .command-head button, .drawer-title button { min-height:44px;border:1px solid var(--staff-border-accent);border-radius:14px;background:var(--staff-surface);color:var(--staff-primary-hover);font-weight:750;padding:7px 12px; }
    .command-palette input { width: calc(100% - 28px); min-height: var(--staff-input-height); margin: 14px 14px 8px; border: 1px solid var(--staff-input-border); border-radius: var(--staff-input-radius); padding: 14px 18px; color: var(--staff-input-text); background: var(--staff-input-background); font-size: 16px; font-weight: 500; caret-color: var(--staff-input-focus); transition: border-color 180ms ease, box-shadow 180ms ease, background-color 180ms ease, transform 180ms ease; }
    .command-palette input::placeholder { color: var(--staff-input-placeholder); font-size: 15px; font-weight: 400; opacity: 1; }
    .command-palette input:hover { border-color: #b9d5c2; }
    .command-palette input:focus { border: 2px solid var(--staff-input-focus); outline: 0; box-shadow: 0 0 0 4px var(--staff-input-focus-ring); background: #fff; }
    .command-palette input:active { transform: scale(.995); }
    .search-hint { display: block; margin: 0 16px 8px; color: var(--staff-text-secondary); font-size: .72rem; font-weight: 650; }
    .command-list { display: grid; gap: 6px; padding: 0 14px 14px; }
    .command-list button { display: grid; grid-template-columns: 36px 1fr; gap: 10px; align-items: center; min-height:56px;border:1px solid transparent;border-radius:16px;padding:10px;background:var(--staff-surface);text-align:left; }
    .command-list button span { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 12px; background: var(--staff-primary-light); color: var(--staff-primary-hover); font-size: .72rem; font-weight: 800; }
    .command-list strong, .command-list small { display: block; color: var(--staff-text); }
    .command-list small { color: var(--staff-text-secondary); }
     .notification-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 31; width: min(420px, 92vw); box-sizing: border-box; overflow: auto; padding: 14px; background: var(--staff-background); box-shadow: var(--staff-shadow-elevated); overscroll-behavior: contain; animation: shell-drawer-enter var(--staff-motion-standard) var(--staff-motion-ease) both; }
    .push-permission-card { display:flex;align-items:center;gap:12px;margin:10px 0;padding:13px;border:1px solid var(--staff-border);border-radius:14px;background:var(--staff-surface-secondary); }
    .push-permission-card div { min-width:0;flex:1; }
    .push-permission-card strong,.push-permission-card small { display:block; }
    .push-permission-card small { margin-top:4px;color:var(--staff-text-secondary);line-height:1.35; }
    .push-permission-card button { min-height:38px;padding:8px 12px;border:0;border-radius:10px;color:var(--staff-text-inverse);background:var(--staff-primary);font-weight:800; }
    .push-permission-card span { padding:6px 9px;border-radius:999px;color:var(--staff-primary-hover);background:var(--staff-primary-light);font-size:12px;font-weight:800; }
    .push-message { margin:8px 2px;color:var(--staff-text-secondary);font-size:12px; }
    .notice-list { display: grid; gap: 8px; }
    .notice-list article { padding: 12px; border: 1px solid var(--staff-border); border-radius: 16px; background: var(--staff-surface); }
    .notice-list strong, .notice-list small, .notice-list span { display: block; }
    .notice-list strong { color: var(--staff-text); }
    .notice-list small { margin-top: 4px; color: var(--staff-text-secondary); font-weight: 600; }
    .notice-list span { margin-top: 6px; color: var(--staff-primary-hover); font-size: .76rem; font-weight: 750; text-transform: capitalize; }
    .notice-list button { min-height:44px;margin-top:8px;border:1px solid var(--staff-border-accent);border-radius:14px;background:var(--staff-surface);color:var(--staff-primary-hover);font-weight:750;padding:7px 10px; }
     .staff-toast { position: fixed; left: 50%; bottom: 18px; z-index: 80; transform: translateX(-50%); max-width: min(420px, calc(100vw - 24px)); padding: 11px 14px; border-radius: 16px; background: var(--staff-text); color: var(--staff-text-inverse); font-weight: 750; box-shadow: var(--staff-shadow-elevated); animation: shell-toast-enter var(--staff-motion-fast) var(--staff-motion-ease) both; }
     .command-backdrop { animation: shell-fade-in var(--staff-motion-fast) var(--staff-motion-ease) both; }
     .command-palette { animation: shell-dialog-enter var(--staff-motion-standard) var(--staff-motion-ease) both; overscroll-behavior: contain; }
     @keyframes shell-fade-in { from { opacity: 0; } }
     @keyframes shell-dialog-enter { from { opacity: 0; transform: translateY(10px) scale(.985); } }
     @keyframes shell-drawer-enter { from { opacity: 0; transform: translateX(20px); } }
     @keyframes shell-toast-enter { from { opacity: 0; transform: translate(-50%, 8px); } }
    .mobile-bottom-nav { display: none; }
     @media (max-width: 900px) {
       .staff-app-shell { --staff-header-height: calc(54px + env(safe-area-inset-top)); display: block; min-height: 100dvh; padding-bottom: env(safe-area-inset-bottom); }
       .staff-main-shell { display: block; height: 100dvh; min-height: 100dvh; overflow-y: auto; overflow-x: hidden; scroll-padding-top: var(--staff-header-height); -webkit-overflow-scrolling: touch; }
        .staff-topbar { position: sticky; top: 0; z-index: 20; min-height: var(--staff-header-height); padding: calc(3px + env(safe-area-inset-top)) 2px 3px 12px; gap: 2px; }
      .menu-button { display: none; }
      .staff-topbar > div:nth-child(2) { min-width: 0; flex: 1 1 auto; }
       .staff-identity { flex: 1 1 auto; width:0; max-width:none; gap: 10px; overflow: hidden; }
      .profile-avatar { width: 38px; height: 38px; background: color-mix(in srgb, var(--staff-primary) 76%, transparent); }
        .staff-identity span { max-width: 100%; font-size: .7rem; }
        .staff-identity strong { max-width: 100%; font-size: .88rem; }
        .staff-identity small { max-width:100%;font-size:.7rem; }
      .staff-topbar p { font-size: .66rem; }
       .topbar-actions { gap: 0; flex: 0 0 auto; flex-wrap: nowrap; margin-left: auto; justify-content: flex-end; }
      .search-button span,.search-button kbd,.topbar-actions > span:not(.queue-status) { display: none; }
      .search-button { display:inline-grid;grid-template-columns:1fr;place-items:center;width:32px;height:44px;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none; }
       .topbar-actions span { max-width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .68rem; }
      .topbar-actions button { padding:0; }
       .topbar-actions :is(.chat-button,.bell-button) { width:32px;height:44px;min-width:32px;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none; }
       .topbar-actions :is(.search-button,.chat-button,.bell-button):hover { border:0;background:transparent; }
      .bell-icon { width: 19px; height: 19px; }
       .staff-content { overflow: visible; padding: 14px 0 var(--staff-bottom-clearance); }
      .notification-drawer { top: 0; right: 0; bottom: 0; left: auto; width: 72vw; min-width: 0; max-width: 360px; height: 100dvh; padding: calc(14px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right)) calc(14px + env(safe-area-inset-bottom)) calc(14px + env(safe-area-inset-left)); border-left: 1px solid var(--staff-border); border-radius: 22px 0 0 22px; box-shadow: -18px 0 40px rgba(31, 41, 55, .14); }
      .notification-drawer .drawer-title { position: sticky; top: 0; z-index: 2; border: 1px solid var(--staff-border); border-radius: 16px; background: var(--staff-surface-secondary); box-shadow: 0 6px 16px rgba(31, 41, 55, .08); }
       .mobile-bottom-nav { position: fixed; left: 50%; bottom: calc(var(--staff-mobile-nav-offset) + env(safe-area-inset-bottom)); z-index: 27; display: grid; grid-template-columns: repeat(auto-fit, minmax(56px, 1fr)); width: min(calc(100vw - 20px), 430px); min-height: var(--staff-mobile-nav-height); padding: 6px; gap: 3px; transform: translateX(-50%); border: 1px solid var(--staff-border); border-radius: 22px; background: var(--staff-surface-glass); box-shadow: var(--staff-shadow-elevated); backdrop-filter: blur(18px); }
       .mobile-bottom-nav :is(a,button) { position:relative;display: grid; grid-template-columns: 1fr; grid-template-rows: 23px auto; place-items: center; align-content: center; gap: 2px; min-width: 0; min-height:44px; padding: 6px 3px; border: 0; border-radius: 16px; background:transparent; color: var(--staff-text-secondary); font:inherit; font-size: .62rem; font-weight: 700; line-height: 1; text-decoration: none; transition:transform var(--staff-motion-fast) var(--staff-motion-ease),opacity var(--staff-motion-fast) var(--staff-motion-ease); } .mobile-bottom-nav :is(a,button) span, .mobile-bottom-nav :is(a,button).active span { display: block; width: auto; height: auto; padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; font-size: inherit; font-weight: inherit; letter-spacing: 0; text-transform: none; }
       .mobile-bottom-nav :is(a,button).active::after { position:absolute;top:2px;width:16px;height:2px;border-radius:999px;background:var(--staff-primary);content:""; }
      .mobile-bottom-nav :is(a,button) svg { display: block; width: 20px; height: 20px; margin: 0; fill: currentColor; }
       .mobile-bottom-nav :is(a,button).active { color: var(--staff-primary-hover); background: var(--staff-primary-light); }
      .drawer-backdrop { display: block; position: fixed; inset: 0; z-index: 29; border: 0; opacity: 0; pointer-events: none; background: rgba(31,41,55,.28); backdrop-filter: blur(2px); transition: opacity .18s ease; }
      .drawer-backdrop.open { opacity: 1; pointer-events: auto; }
      .staff-sidebar { position: fixed; left: 0; top: 0; bottom: 0; z-index: 30; width: 55vw; min-width: 0; box-sizing: border-box; height: 100dvh; padding: calc(10px + env(safe-area-inset-top)) calc(8px + env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) calc(8px + env(safe-area-inset-left)); border-right: 1px solid var(--staff-border); border-radius: 0; transform: translateX(-104%); transition: transform .2s ease; box-shadow: 18px 0 36px rgba(15,35,64,.22); }
      .staff-sidebar.open { transform: translateX(0); }
      .drawer-close { position: absolute; top: calc(14px + env(safe-area-inset-top)); right: 8px; z-index: 3; display: grid; place-items:center; width: 44px; min-height: 44px; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--staff-on-primary); box-shadow:none; }
      .drawer-close svg { width: 20px; height: 20px; fill: currentColor; }
      .user-card { margin-top:4px; padding-right:52px; }
      .staff-sidebar nav { margin-top:4px; }
      .staff-sidebar nav a { min-width: 0; min-height:44px; padding: 4px 8px; border-radius:6px; text-align: left; font-size: .86rem; white-space: normal; }
    }
     @media (max-width: 560px) {
      .staff-topbar { align-items: center; display: flex; }
      .staff-topbar strong { display: block; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .network-status { display: none; }

      .staff-sidebar nav a { padding: 4px 8px; }
     }
      @media (max-width: 380px) {
        .profile-avatar { display:none; }
        .staff-identity { gap:4px; }
        .staff-identity small { max-width:100%; }
      }
     @media (max-width: 900px) and (any-pointer: coarse) {
        @supports selector(.staff-app-shell:has(input:focus)) {
          .staff-app-shell:has(input:focus,textarea:focus,select:focus) .mobile-bottom-nav { opacity:0;pointer-events:none;transform:translate(-50%,calc(100% + var(--staff-mobile-nav-offset) + env(safe-area-inset-bottom))); }
        }
      }
     @media (prefers-reduced-motion: reduce) { .notification-drawer, .command-backdrop, .command-palette, .staff-toast { animation: none; } }
     .staff-app-shell { grid-template-columns: 232px minmax(0, 1fr); font-size: 14px; }
     .staff-sidebar { padding: 8px; }
     .user-card { grid-template-columns: 34px 1fr; gap: 9px; padding: 7px; }
     .user-card b { width:34px; height:34px; }
     .staff-sidebar nav a { grid-template-columns: 30px 1fr; gap: 8px; min-height: 40px; padding: 3px 8px; font-size: .8rem; }
     .staff-sidebar nav a span { width:30px; height:30px; }
     .nav-group { margin: 10px 8px 3px; font-size: .6rem; letter-spacing: .08em; }
     .nav-logout { min-height: 40px; font-size: .86rem; }
     .staff-topbar { min-height: 52px; padding: 4px 14px; }
     .profile-avatar { width: 38px; height: 38px; border-radius: 12px; }
     .staff-identity span,.staff-identity small { font-size: .66rem; }
     .staff-identity strong { font-size: .86rem; }
     .search-button { height: 40px; border-radius: 13px; }
     .chat-button,.bell-button { width:40px; height:40px; min-width:40px; border-radius:13px; }
     .net-status,.queue-status { padding: 6px 9px; font-size: .78rem; }
     .staff-content { padding: 18px; }
     @media (max-width: 900px) {
       .staff-app-shell { font-size: 13px; }
       .staff-topbar { min-height: var(--staff-header-height); padding: calc(4px + env(safe-area-inset-top)) 4px 4px 10px; }
       .staff-content { padding: 10px 0 var(--staff-bottom-clearance); }
       .staff-sidebar { width: min(78vw, 300px); }
       .mobile-bottom-nav { width: min(calc(100vw - 16px), 420px); min-height: 56px; padding: 5px; border-radius: 18px; }
       .mobile-bottom-nav :is(a,button) { min-height: 42px; border-radius: 13px; font-size: .58rem; }
       .mobile-bottom-nav :is(a,button) svg { width: 18px; height: 18px; }
       .search-button,.topbar-actions :is(.chat-button,.bell-button) { width: 34px; height: 42px; min-width: 34px; }
     }
     @media (max-width: 380px) {
       .staff-identity strong { max-width: 138px; font-size: .8rem; }
       .staff-identity span,.staff-identity small { font-size: .62rem; }
       .mobile-bottom-nav :is(a,button) { font-size: .54rem; }
     }
     .staff-sidebar {
       gap: 8px;
       padding: 10px;
       background: #0c477d;
     }
     .user-card {
       flex: 0 0 auto;
       margin: 0;
       padding: 9px;
       border-color: rgba(255,255,255,.16);
       border-radius: 8px;
       background: rgba(255,255,255,.09);
     }
     .user-card b {
       border-radius: 8px;
       font-size: .82rem;
     }
     .user-card strong {
       font-size: .92rem;
       line-height: 1.15;
     }
     .user-card small {
       margin-top: 2px;
       font-size: .7rem;
       line-height: 1.2;
     }
     .staff-sidebar nav {
       gap: 2px;
       padding: 2px 2px 8px;
       scrollbar-color: rgba(255,255,255,.48) transparent;
     }
     .staff-sidebar nav::-webkit-scrollbar {
       width: 5px;
     }
     .staff-sidebar nav::-webkit-scrollbar-thumb {
       border-radius: 999px;
       background: rgba(255,255,255,.45);
     }
     .nav-group {
       margin: 12px 6px 5px;
       color: rgba(255,255,255,.7);
       font-size: .62rem;
       letter-spacing: .07em;
     }
     .staff-sidebar nav a {
       grid-template-columns: 34px minmax(0,1fr);
       min-height: 42px;
       padding: 4px 8px;
       border-radius: 8px;
       color: rgba(255,255,255,.86);
       font-size: .84rem;
       line-height: 1.1;
     }
     .staff-sidebar nav a span {
       width: 34px;
       height: 34px;
       border-radius: 8px;
     }
     .staff-sidebar nav a.active {
       border-color: rgba(255,255,255,.86);
       background: #e8f1ff;
       color: #0c477d;
       font-weight: 750;
     }
     .staff-sidebar nav a:hover:not(.active) {
       border-color: rgba(255,255,255,.16);
       background: rgba(255,255,255,.1);
       color: #fff;
     }
     .nav-logout {
       flex: 0 0 auto;
       margin: 0;
       min-height: 44px;
       border-radius: 8px;
       background: rgba(255,255,255,.06);
       font-size: .92rem;
     }
      @media (max-width: 900px) {
        .staff-sidebar {
          width: clamp(220px, 62vw, 260px);
          padding: calc(10px + env(safe-area-inset-top)) 10px calc(10px + env(safe-area-inset-bottom));
        }
       .user-card {
         padding-right: 50px;
       }
       .staff-sidebar nav a {
         min-height: 44px;
         font-size: .86rem;
       }
     }
  `]
})
export class StaffLayoutPage implements OnInit, OnDestroy {
  @ViewChild("commandInput") private commandInput?: ElementRef<HTMLInputElement>;
  @ViewChild("menuDialog") private menuDialog?: ElementRef<HTMLElement>;
  @ViewChild("menuButton") private menuButton?: ElementRef<HTMLButtonElement>;
  @ViewChild("moreButton") private moreButton?: ElementRef<HTMLButtonElement>;
  @ViewChild("commandButton") private commandButton?: ElementRef<HTMLButtonElement>;
  @ViewChild("notificationButton") private notificationButton?: ElementRef<HTMLButtonElement>;
  readonly menuOpen = signal(false);
  readonly commandOpen = signal(false);
  readonly notificationsOpen = signal(false);
  readonly online = signal(typeof navigator === "undefined" ? true : navigator.onLine);
  readonly realtimeConnected = signal(false);
  readonly offlinePending = signal(0);
  readonly toastMessage = signal("");
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly preferences = signal<StaffWorkspacePreferences>({
    workspace: { workspaceName: "Aura Shine Staff Portal" },
    localization: { timezone: "Asia/Kolkata", locale: "en-IN" },
    dateTime: { dateFormat: "DD/MM/YYYY", timeFormat: "12h", businessDayStartHour: 0, weekStartsOn: "Monday" },
    interface: { compactMode: false },
    defaults: { staffHints: true }
  });
  readonly recent = signal<StaffRecentItem[]>(this.readRecent());
  readonly query = signal("");
  readonly theme = signal<"light" | "dark">("light");
  private pollTimer = 0;
  private reconnectTimer = 0;
  private posReconnectTimer = 0;
  private toastTimer = 0;
  private socket: WebSocket | null = null;
  private posSocket: WebSocket | null = null;

  private readonly nav: StaffNavItem[] = [
    { label: "Dashboard", path: "/staff/dashboard", iconPath: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z", group: "Home", permission: "staff.app.dashboard.read" },
    { label: "Appointments", path: "/staff/appointments", iconPath: "M7 2v2H5a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 8H5V7h14v3z", group: "Work", permission: "staff.app.appointments.read" },
    { label: "Business", path: "/staff/business", iconPath: "M3 21V3h8v4h10v14H3zm3-3h2v-3H6v3zm0-6h2V9H6v3zm7 6h2v-3h-2v3zm0-6h2V9h-2v3zm5 6h1v-3h-1v3zm0-6h1V9h-1v3z", group: "Work", permission: "staff.app.business.read" },
    { label: "Offers", path: "/staff/offers", iconPath: "M20 12v8H4v-8h16zM7 4a3 3 0 0 1 5 2.2A3 3 0 1 1 17 4c0 1.1-.6 2-1.4 2.5H20v4H4v-4h4.4A3 3 0 0 1 7 4zm2 0a1 1 0 1 0 1 1H9V4zm5 1h-1a1 1 0 1 0 1-1v1z", group: "Work", permission: "staff.app.offers.read" },
    { label: "Tasks", path: "/staff/tasks", iconPath: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z", group: "Work", permission: "staff.app.tasks.read" },
    { label: "Rules & SOP", path: "/staff/rules", iconPath: "M5 3h14a2 2 0 0 1 2 2v16l-4-2-5 2-5-2-4 2V5a2 2 0 0 1 2-2zm2 4v2h10V7H7zm0 4v2h10v-2H7zm0 4v2h7v-2H7z", group: "Work", permission: "staff.app.rules.read" },
    { label: "Attendance", path: "/staff/attendance", iconPath: "M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z", group: "Work", permission: "staff.app.attendance.read" },
    { label: "Roster", path: "/staff/roster", iconPath: "M4 4h16v4H4V4zm0 6h7v10H4V10zm9 0h7v10h-7V10z", group: "Work", permission: "staff.app.roster.read" },
    { label: "Calendar", path: "/staff/calendar", iconPath: "M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v16h18V5a2 2 0 0 0-2-2zm0 16H5V9h14v10z", group: "Work", permission: "staff.app.calendar.read" },
    { label: "Performance", path: "/staff/performance", iconPath: "M3 17h3v4H3v-4zm5-6h3v10H8V11zm5 3h3v7h-3v-7zm5-9h3v16h-3V5z", group: "Intelligence", permission: "staff.app.performance.read" },
    { label: "Leaderboard", path: "/staff/leaderboard", iconPath: "M7 21h10v-2H7v2zM5 3h14v4a7 7 0 0 1-6 6.9V17h-2v-3.1A7 7 0 0 1 5 7V3zm2 2v2a5 5 0 0 0 10 0V5H7z", group: "Intelligence", permission: "staff.app.leaderboard.read" },
    { label: "Reports", path: "/staff/reports", iconPath: "M5 3h11l3 3v15H5V3zm10 1.5V7h2.5L15 4.5zM8 11h8v2H8v-2zm0 4h8v2H8v-2z", group: "Intelligence", permission: "staff.app.reports.read" },
    { label: "Chat", path: "/staff/chat", iconPath: "M4 4h16v12H7l-3 3V4zm4 5h8V7H8v2zm0 4h6v-2H8v2z", group: "Comms", permission: "staff.app.chat.read" },
    { label: "Payroll", path: "/staff/payroll", iconPath: "M4 6h16v12H4V6zm2 2v8h12V8H6zm6 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", group: "Account", permission: "staff.app.payroll.read" },
    { label: "Leaves", path: "/staff/leaves", iconPath: "M12 2C8 6 6 9 6 12a6 6 0 0 0 12 0c0-3-2-6-6-10z", group: "Account", permission: "staff.app.leaves.read" },
    { label: "Feedback", path: "/staff/feedback", iconPath: "M4 4h16v11H8l-4 4V4zm4 4v2h8V8H8zm0 4v2h5v-2H8z", group: "Account", permission: "staff.app.feedback.read" },
    { label: "Profile", path: "/staff/profile", iconPath: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-3.3 0-6 1.7-6 3.8V20h12v-2.2c0-2.1-2.7-3.8-6-3.8z", group: "Account", permission: "staff.app.profile.read" },
    { label: "Settings", path: "/staff/settings", iconPath: "M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A7 7 0 0 0 7 6L4.6 5l-2 3.5 2 1.5A8 8 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.5L7 17a7 7 0 0 0 2.6 1.5L10 21h4l.4-2.5A7 7 0 0 0 17 17l2.4 1 2-3.5-2-1.5zM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6z", group: "Account", permission: "staff.app.settings.read" }
  ];

  readonly commandResults = computed(() => {
    const text = this.query().trim().toLowerCase();
    const navItems = this.visibleNav().map((item) => ({ ...item }));
    const notices = this.staff.hasPermission("staff.app.notifications.read") ? (this.os()?.notifications || []).map((note) => ({ label: note.title, path: "/staff/notifications", iconPath: this.iconFor("Notifications"), group: note.body || "Notification" })) : [];
    const business = this.staff.hasPermission("staff.app.business.read") ? (this.os()?.timeline || []).map((item) => ({ label: item.serviceNames?.join(", ") || "Appointment", path: "/staff/business", iconPath: this.iconFor("Business"), group: "Scheduled work" })) : [];
    const all = [...navItems, ...notices, ...business];
    if (!text) return all.slice(0, 12);
    return all
      .map((item) => ({ item, score: this.searchScore(item.label, item.group, text) }))
      .filter((match) => match.score >= 0)
      .sort((left, right) => right.score - left.score)
      .map((match) => match.item)
      .slice(0, 12);
  });

  constructor(readonly staff: StaffAppService, readonly push: StaffPushService, private readonly router: Router) {}

  ngOnInit() {
    this.applyLightTheme();
    void this.loadShellData();
    void this.flushOfflineQueue();
    void this.connectRealtime();
    void this.connectPosRealtime();
    void this.push.refreshStatus();
    this.pollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !this.realtimeConnected()) void this.loadShellData();
    }, 60000);
  }

  ngOnDestroy() {
    window.clearInterval(this.pollTimer);
    window.clearTimeout(this.reconnectTimer);
    window.clearTimeout(this.posReconnectTimer);
    window.clearTimeout(this.toastTimer);
    this.socket?.close();
    this.posSocket?.close();
    this.setOverlayLock(false);
  }

  @HostListener("window:online") onOnline() { this.online.set(true); void this.flushOfflineQueue(); void this.connectRealtime(); void this.connectPosRealtime(); }
  @HostListener("window:offline") onOffline() { this.online.set(false); this.realtimeConnected.set(false); }
  @HostListener("window:keydown", ["$event"])
  onKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.openCommand();
    }
    if (event.key === "Escape") {
      this.closeCommand();
      this.closeMenu();
      this.closeNotifications();
    }
  }

  @HostListener("window:touchstart", ["$event"])
  onTouchStart(event: TouchEvent) {
    this.touchStartX = event.touches[0]?.clientX || 0;
    this.touchStartY = event.touches[0]?.clientY || 0;
  }

  @HostListener("window:touchend", ["$event"])
  onTouchEnd(event: TouchEvent) {
    const touch = event.changedTouches[0];
    const endX = touch?.clientX || 0;
    const deltaX = endX - this.touchStartX;
    const deltaY = Math.abs((touch?.clientY || 0) - this.touchStartY);
    const target = event.target as HTMLElement | null;
    if (target?.closest("input,textarea,button,a,[role=dialog]")) return;
    const wasMenuOpen = this.menuOpen();
    if (this.touchStartX < 24 && deltaX > 70) this.openMenu();
    if (wasMenuOpen && deltaX < -70) { this.closeMenu(); return; }
    if (window.matchMedia("(max-width: 900px)").matches && !this.menuOpen() && !this.notificationsOpen() && Math.abs(deltaX) > 70 && Math.abs(deltaX) > deltaY) this.navigateMobileSwipe(deltaX < 0 ? 1 : -1);
  }

  private touchStartX = 0;
  private touchStartY = 0;
  private readonly mobileSwipeRoutes = ["/staff/dashboard", "/staff/appointments", "/staff/tasks", "/staff/attendance"];

  private navigateMobileSwipe(direction: number) {
    const current = this.router.url.split("?")[0];
    const index = this.mobileSwipeRoutes.indexOf(current);
    const next = this.mobileSwipeRoutes[index + direction];
    if (index >= 0 && next) void this.router.navigateByUrl(next);
  }
  visibleNav(): StaffNavItem[] {
    return this.nav.filter((item) => (!item.permission || this.staff.hasPermission(item.permission)) && (!item.anyPermissions?.length || this.staff.hasAnyPermission([...item.anyPermissions])));
  }

  navGroups(): string[] {
    return [...new Set(this.visibleNav().map((item) => item.group))];
  }

  navByGroup(group: string): StaffNavItem[] {
    return this.visibleNav().filter((item) => item.group === group);
  }

  initials(): string {
    return String(this.staff.user()?.name || "Staff").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "S";
  }

  greetingLabel(): string {
    const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date()));
    return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  }

  roleLabel(): string { return this.identity().role; }

  branchLabel(): string { return this.identity().branch; }

  identitySubtitle(): string { return this.identity().subtitle; }

  private identity() {
    return resolveStaffIdentity({
      roleDisplayName: this.staff.profile()?.designation || this.os()?.staff.designation || this.staff.user()?.roleDisplayName,
      customRoleName: this.staff.user()?.customRoleName,
      systemRole: this.staff.user()?.role,
      branchName: this.staff.user()?.branchName
    });
  }

  isDashboard(): boolean { return this.router.url.split("?")[0] === "/staff/dashboard"; }

  isMoreActive(): boolean { return !this.mobileSwipeRoutes.includes(this.router.url.split("?")[0]); }

  toggleTheme() {
    this.applyLightTheme();
  }

  private applyLightTheme() {
    this.theme.set("light");
    document.documentElement.dataset["staffTheme"] = "light";
    document.documentElement.style.colorScheme = "light";
    localStorage.setItem("auraStaffTheme", "light");
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", "#1677FF");
  }

  unreadCount(): number {
    return (this.os()?.notifications || []).filter((note) => String(note.status || "unread") !== "read").length;
  }

  iconFor(label: string): string {
    return this.nav.find((item) => item.label === label)?.iconPath || this.nav[0].iconPath;
  }

  async markNotification(id: string, status: "read" | "unread" | "archived") {
    await this.staff.updateNotification(id, status);
    await this.loadShellData();
  }

  async enableMobileNotifications() {
    await this.push.enable();
  }

  activateNav(item: StaffNavItem) {
    this.remember(item);
    this.closeMenu();
  }

  activateRecent(item: StaffRecentItem) {
    this.remember(item);
    this.closeMenu();
  }

  openMenu() {
    this.closeCommand(false);
    this.closeNotifications(false);
    this.menuOpen.set(true);
    this.setOverlayLock(true);
    window.setTimeout(() => this.menuDialog?.nativeElement.querySelector<HTMLElement>(".drawer-close")?.focus(), 0);
  }

  closeMenu(restoreFocus = true) {
    const wasOpen = this.menuOpen();
    this.menuOpen.set(false);
    this.syncOverlayLock();
    if (wasOpen && restoreFocus) window.setTimeout(() => (this.moreButton || this.menuButton)?.nativeElement.focus(), 0);
  }

  private searchScore(label: string, group: string, query: string): number {
    const candidates = [label, group].map((value) => String(value || '').toLowerCase());
    let best = -1;
    for (const candidate of candidates) {
      if (!candidate) continue;
      const exactIndex = candidate.indexOf(query);
      if (exactIndex >= 0) best = Math.max(best, 1000 - exactIndex);
      let cursor = 0;
      let matched = 0;
      for (const character of query) {
        const index = candidate.indexOf(character, cursor);
        if (index < 0) { matched = -1; break; }
        matched += index === cursor ? 3 : 1;
        cursor = index + 1;
      }
      if (matched >= 0) best = Math.max(best, matched + (candidate === candidates[0] ? 100 : 0));
    }
    return best;
  }
  onCommandKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    const first = this.commandResults()[0];
    if (!first) return;
    event.preventDefault();
    this.go(first);
  }

  openCommand() {
    this.closeMenu(false);
    this.closeNotifications(false);
    this.commandOpen.set(true);
    this.setOverlayLock(true);
    window.setTimeout(() => this.commandInput?.nativeElement.focus(), 0);
  }

  closeCommand(restoreFocus = true) {
    const wasOpen = this.commandOpen();
    this.commandOpen.set(false);
    this.query.set("");
    this.syncOverlayLock();
    if (wasOpen && restoreFocus) window.setTimeout(() => this.commandButton?.nativeElement.focus(), 0);
  }

  toggleNotifications() {
    if (this.notificationsOpen()) { this.closeNotifications(); return; }
    this.closeMenu(false);
    this.closeCommand(false);
    this.notificationsOpen.set(true);
    this.setOverlayLock(true);
    window.setTimeout(() => document.querySelector<HTMLElement>(".notification-drawer.open button")?.focus(), 0);
  }

  closeNotifications(restoreFocus = true) {
    const wasOpen = this.notificationsOpen();
    this.notificationsOpen.set(false);
    this.syncOverlayLock();
    if (wasOpen && restoreFocus) window.setTimeout(() => this.notificationButton?.nativeElement.focus(), 0);
  }

  go(item: StaffRecentItem) {
    this.remember(item);
    this.closeCommand();
    void this.router.navigateByUrl(item.path);
  }

  async logout() {
    this.closeMenu();
    await this.staff.logout();
    await this.router.navigateByUrl("/staff/login");
  }

  private async loadShellData() {
    try {
      const [os, preferences] = await Promise.all([
        this.staff.enterpriseOs({}, false),
        this.staff.workspacePreferences().catch(() => this.preferences())
      ]);
      this.os.set(os);
      this.preferences.set(preferences);
      document.documentElement.dataset["staffCompactMode"] = preferences.interface.compactMode ? "true" : "false";
      document.documentElement.lang = preferences.localization.locale.split("-")[0] || "en";
      document.title = `${preferences.workspace.workspaceName} | Staff`;
      this.offlinePending.set(this.staff.offlineQueueSize());
    } catch {
      this.os.set(null);
    }
  }

  private async connectRealtime() {
    if (!this.online() || !this.staff.isAuthenticated()) return;
    if (this.socket && ([WebSocket.CONNECTING, WebSocket.OPEN] as number[]).includes(this.socket.readyState)) return;
    let url = "";
    try { url = this.staff.appointmentRealtimeSocketUrl(); } catch { this.scheduleRealtimeReconnect(); return; }
    if (!this.online() || !this.staff.isAuthenticated()) return;
    if (!url) return;
    try {
      const socket = new WebSocket(url, this.staff.realtimeSocketProtocols());
      this.socket = socket;
      socket.onopen = () => {
        this.realtimeConnected.set(true);
        socket.send(JSON.stringify({ type: "ping" }));
      };
      socket.onmessage = (event) => this.handleRealtimeMessage(event.data);
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        this.realtimeConnected.set(false);
        if (this.online() && this.staff.isAuthenticated()) this.scheduleRealtimeReconnect();
      };
    } catch {
      this.scheduleRealtimeReconnect();
    }
  }

  private scheduleRealtimeReconnect() {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => void this.connectRealtime(), 5000);
  }

  private connectPosRealtime() {
    if (!this.online() || !this.staff.isAuthenticated()) return;
    if (this.posSocket && ([WebSocket.CONNECTING, WebSocket.OPEN] as number[]).includes(this.posSocket.readyState)) return;
    let url = "";
    try { url = this.staff.posRealtimeSocketUrl(); } catch { this.schedulePosRealtimeReconnect(); return; }
    if (!url) return;
    try {
      const socket = new WebSocket(url, this.staff.realtimeSocketProtocols());
      this.posSocket = socket;
      socket.onopen = () => {
        this.staff.invalidateCachedReads();
        window.dispatchEvent(new CustomEvent("aura:offers-updated"));
      };
      socket.onmessage = (event) => {
        let frame: { type?: string; entityType?: string } = {};
        try { frame = JSON.parse(String(event.data)); } catch { return; }
        if (frame.type !== "pos.updated") return;
        this.staff.invalidateCachedReads();
        if (frame.entityType === "offer") {
          window.dispatchEvent(new CustomEvent("aura:offers-updated"));
          return;
        }
        window.dispatchEvent(new CustomEvent("aura:business-updated"));
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (this.online() && this.staff.isAuthenticated()) this.schedulePosRealtimeReconnect();
      };
    } catch {
      this.schedulePosRealtimeReconnect();
    }
  }

  private schedulePosRealtimeReconnect() {
    window.clearTimeout(this.posReconnectTimer);
    this.posReconnectTimer = window.setTimeout(() => this.connectPosRealtime(), 5000);
  }

  private handleRealtimeMessage(raw: unknown) {
    let frame: { type?: string } = {};
    try { frame = JSON.parse(String(raw)); } catch { return; }
    if (!frame.type || ["connection.ready", "pong", "subscription.updated"].includes(frame.type)) return;
    if (["staff:clocked_in", "staff:clocked_out", "staff:break_started", "staff:break_ended"].includes(frame.type)) {
      window.dispatchEvent(new CustomEvent("aura:attendance-updated"));
    }
    if (frame.type === "appointment.updated") {
      this.staff.invalidateCachedReads();
      window.dispatchEvent(new CustomEvent("aura:appointments-updated"));
    }
    if (frame.type.startsWith("staff-self.") || ["appointment.updated", "dashboard.updated", "booking.updated", "queue.updated"].includes(frame.type)) {
      void this.loadShellData();
    }
  }

  private async flushOfflineQueue() {
    this.offlinePending.set(this.staff.offlineQueueSize());
    const flushed = await this.staff.flushOfflineActions();
    this.offlinePending.set(this.staff.offlineQueueSize());
    if (flushed) {
      this.showToast(`${flushed} queued staff action${flushed === 1 ? "" : "s"} synced.`);
      window.dispatchEvent(new CustomEvent("aura:attendance-updated"));
      void this.loadShellData();
    }
  }

  private showToast(message: string) {
    this.toastMessage.set(message);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastMessage.set(""), 3600);
  }

  trapFocus(event: KeyboardEvent, root: HTMLElement) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  private syncOverlayLock() {
    this.setOverlayLock(this.menuOpen() || this.commandOpen() || this.notificationsOpen());
  }

  private setOverlayLock(locked: boolean) {
    document.documentElement.classList.toggle("staff-overlay-open", locked);
  }

  private remember(item: StaffRecentItem) {
    const next = [{ label: item.label, path: item.path }, ...this.recent().filter((entry) => entry.path !== item.path)].slice(0, 4);
    this.recent.set(next);
    localStorage.setItem("auraStaffRecent", JSON.stringify(next));
  }

  private readRecent(): StaffRecentItem[] {
    try {
      const parsed = JSON.parse(localStorage.getItem("auraStaffRecent") || "[]");
      return Array.isArray(parsed) ? parsed.slice(0, 4) : [];
    } catch {
      return [];
    }
  }
}
