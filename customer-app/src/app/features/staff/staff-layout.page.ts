import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { StaffAppService, StaffEnterpriseOs } from "../../core/staff-app.service";

type StaffNavItem = { label: string; path: string; iconPath: string; group: string; permission?: string };
type StaffRecentItem = { label: string; path: string };

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <section class="staff-app-shell">
      <button type="button" class="drawer-backdrop" [class.open]="menuOpen()" (click)="closeMenu()" aria-label="Close menu"></button>
      <aside class="staff-sidebar" [class.open]="menuOpen()">
        <button type="button" class="drawer-close" (click)="closeMenu()" aria-label="Close menu">Close</button>
        <div class="brand-card">
          <span class="brand-kicker">Aura Shine</span>
          <strong>Staff Portal</strong>
          <small>{{ staff.user()?.role || 'staff' }} workspace</small>
        </div>
        <div class="user-card">
          <b>{{ initials() }}</b>
          <div><strong>{{ staff.user()?.name || 'Aura Staff' }}</strong><small>{{ staff.user()?.branchId || 'branch scoped' }}</small></div>
        </div>
        @if (recent().length) {
          <section class="recent-card">
            <span>Recent</span>
            @for (item of recent(); track item.path) { <a [routerLink]="item.path" (click)="activateRecent(item)">{{ item.label }}</a> }
          </section>
        }
        <nav>
          @for (group of navGroups(); track group) {
            <p class="nav-group">{{ group }}</p>
            @for (item of navByGroup(group); track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: item.path === '/staff/dashboard' }" (click)="activateNav(item)"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.iconPath"></path></svg></span>{{ item.label }}</a>
            }
          }
        </nav>
        <button type="button" class="nav-logout" (click)="logout()">Logout</button>
      </aside>

      <div class="staff-main-shell" #mainShell>
        <header class="staff-topbar">
          <button type="button" class="menu-button" (click)="openMenu()" aria-label="Open menu"><span></span><span></span><span></span></button>
          <div class="staff-identity"><span>Staff portal</span><strong>{{ staff.user()?.name || 'Aura Staff' }}</strong></div>
          <div class="topbar-actions">
            <button type="button" class="search-button" (click)="openCommand()">Search <small>Ctrl K</small></button>
            <button type="button" class="bell-button" [class.has-unread]="unreadCount() > 0" (click)="toggleNotifications()" aria-label="Open notifications">
              <svg class="bell-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 10.8c0-3.5-2.1-6.1-5-6.7V3a1 1 0 0 0-2 0v1.1c-2.9.6-5 3.2-5 6.7V15l-1.6 2.4A1 1 0 0 0 5.2 19h13.6a1 1 0 0 0 .8-1.6L18 15v-4.2zM9.7 20a2.4 2.4 0 0 0 4.6 0H9.7z"></path>
              </svg>
              <span class="bell-badge">{{ unreadCount() }}</span>
            </button>
            <span class="net-status network-status" [class.offline]="!online()" aria-live="polite">{{ online() ? 'Online' : 'Offline' }}</span>
            @if (offlinePending()) { <span class="queue-status">{{ offlinePending() }} queued</span> }
            <span>{{ staff.user()?.branchId || 'branch scoped' }}</span>
          </div>
        </header>
        <main class="staff-content"><router-outlet /></main>
      </div>

      <nav class="mobile-bottom-nav" aria-label="Primary staff navigation">
        <a routerLink="/staff/dashboard" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Dashboard')"></path></svg><span>Home</span></a>
        <a routerLink="/staff/appointments" routerLinkActive="active"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Appointments')"></path></svg><span>Bookings</span></a>
        <a routerLink="/staff/queue" routerLinkActive="active"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Today' + 's Queue')"></path></svg><span>Queue</span></a>
        <a routerLink="/staff/clients" routerLinkActive="active"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Clients')"></path></svg><span>Clients</span></a>
        <a routerLink="/staff/tasks" routerLinkActive="active"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Tasks')"></path></svg><span>Tasks</span></a>
      </nav>      <button type="button" class="scroll-top-button" (click)="scrollToTop()" aria-label="Go to top">Top</button>

      @if (commandOpen()) {
        <section class="command-backdrop" (click)="closeCommand()">
          <div class="command-palette" role="dialog" aria-modal="true" aria-labelledby="staff-command-title" tabindex="-1" #commandDialog (keydown)="trapFocus($event, commandDialog)" (click)="$event.stopPropagation()">
            <div class="command-head"><strong id="staff-command-title">Command palette</strong><button type="button" (click)="closeCommand()">Close</button></div>
            <input [(ngModel)]="query" placeholder="Search pages, appointments, AI notes..." #commandInput autofocus />
            <div class="command-list">
              @for (item of commandResults(); track item.path + item.label) {
                <button type="button" (click)="go(item)"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.iconPath"></path></svg></span><div><strong>{{ item.label }}</strong><small>{{ item.group }}</small></div></button>
              } @empty {
                <p>No matching staff command.</p>
              }
            </div>
          </div>
        </section>
      }

      <button type="button" class="drawer-backdrop" [class.open]="notificationsOpen()" (click)="closeNotifications()" aria-label="Close notifications"></button>
      <aside class="notification-drawer" [class.open]="notificationsOpen()" role="dialog" aria-modal="true" aria-labelledby="staff-notifications-title" tabindex="-1" #notificationDialog (keydown)="trapFocus($event, notificationDialog)">
        <div class="drawer-title"><strong id="staff-notifications-title">Notifications</strong><button type="button" (click)="closeNotifications()">Close</button></div>
        @if (os()?.aiCoach?.[0]; as card) { <p class="ai-brief"><b>{{ card.title }}</b><br />{{ card.body }}</p> }
        <div class="notice-list">
          @for (note of os()?.notifications || []; track note.id) {
            <article><strong>{{ note.title }}</strong><small>{{ note.body || note.status }}</small><span>{{ note.status }}</span><button type="button" (click)="markNotification(note.id, note.status === 'read' ? 'unread' : 'read')">{{ note.status === 'read' ? 'Mark unread' : 'Mark read' }}</button></article>
          } @empty {
            <p>No notifications yet.</p>
          }
        </div>
      </aside>

      @if (toastMessage()) { <section class="staff-toast" role="status">{{ toastMessage() }}</section> }
    </section>
  `,
  styles: [`
    .staff-app-shell { min-height: 100vh; display: grid; grid-template-columns: 272px minmax(0, 1fr); background: linear-gradient(145deg, #fffdf8 0%, #fff8ea 48%, #fff4dd 100%); }
    .staff-sidebar { position: sticky; top: 0; height: 100vh; overflow: auto; padding: 16px; border-right: 1px solid rgba(214,170,85,.26); background: rgba(255, 253, 248, .94); box-shadow: 14px 0 38px rgba(126,85,20,.08); backdrop-filter: blur(18px); }
    .brand-card { padding: 18px; border: 1px solid rgba(214,170,85,.24); border-radius: 24px; color: #241609; background: linear-gradient(145deg, #ffffff, #fff8ea); box-shadow: 0 14px 28px rgba(139,93,21,.07); }
    .brand-card span { display: block; color: #9b6b22; font-size: .74rem; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
    .brand-card strong { display: block; margin-top: 5px; font-size: 1.45rem; }
    .brand-card small { display: block; margin-top: 4px; color: #7b5b2a; font-weight: 850; text-transform: capitalize; }
    .drawer-backdrop, .menu-button, .drawer-close { display: none; }
    .menu-button span { display: block; width: 18px; height: 2px; border-radius: 999px; background: #5d3607; }
    .user-card { display: grid; grid-template-columns: 42px 1fr; gap: 10px; align-items: center; margin-top: 12px; padding: 10px; border: 1px solid rgba(214,170,85,.24); border-radius: 18px; background: rgba(255,255,255,.72); color: #241609; }
    .user-card b { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 15px; background: #f1c768; color: #3b2608; }
    .user-card strong, .user-card small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .user-card small { color: #7b5b2a; font-weight: 800; }
    .recent-card { display: grid; gap: 6px; margin-top: 12px; padding: 10px; border: 1px solid rgba(214,170,85,.18); border-radius: 18px; background: rgba(255,255,255,.56); }
    .recent-card span, .nav-group { margin: 12px 2px 4px; color: #9b6b22; font-size: .68rem; font-weight: 950; letter-spacing: .12em; text-transform: uppercase; }
    .recent-card a { color: #5d3607; font-size: .82rem; font-weight: 850; text-decoration: none; }
    nav { display: grid; gap: 5px; margin-top: 14px; }
    nav a { display: grid; grid-template-columns: 34px 1fr; gap: 10px; align-items: center; padding: 10px 12px; border: 1px solid transparent; border-radius: 16px; color: #4a2d08; font-weight: 900; text-decoration: none; }
    nav a span { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 12px; background: #fff2cf; color: #9b6b22; font-size: .7rem; font-weight: 950; }
    svg { width: 17px; height: 17px; fill: currentColor; }
    nav a.active, nav a:hover { border-color: rgba(214,170,85,.3); background: #fff7e4; color: #1d1307; box-shadow: 0 10px 24px rgba(139,93,21,.1); }
    nav a.active span { background: #f1c768; color: #3b2608; }
    .nav-logout { width: 100%; margin-top: 12px; padding: 11px 13px; border: 1px solid rgba(214,170,85,.34); border-radius: 16px; background: #fff8ea; color: #7a4510; font-weight: 950; text-align: left; }
    .staff-main-shell { min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100vh; overflow: hidden; }
    .staff-topbar { position: relative; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 9px 16px; border-bottom: 1px solid rgba(234,210,162,.58); background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(255,250,239,.94)); box-shadow: 0 8px 24px rgba(92,65,28,.07); backdrop-filter: blur(16px); }
    .staff-identity { display: flex; align-items: baseline; min-width: 0; gap: 7px; }
    .staff-identity span { overflow: hidden; color: #8a611e; font-size: .66rem; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; text-overflow: ellipsis; white-space: nowrap; }
    .staff-identity strong { overflow: hidden; color: #1d1307; font-size: .92rem; text-overflow: ellipsis; white-space: nowrap; }
    .staff-topbar strong { color: #1d1307; }
    .topbar-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0; flex-wrap: wrap; }
    .topbar-actions span { color: #75552b; font-weight: 900; }
    .search-button, .bell-button { border: 1px solid #d6aa55; border-radius: 999px; background: #fffdf7; color: #6e4810; font-weight: 950; padding: 8px 12px; box-shadow: 0 8px 20px rgba(139,93,21,.08); }
    .search-button:hover, .search-button:focus-visible, .bell-button:focus-visible, .menu-button:focus-visible, nav a:focus-visible, .nav-logout:focus-visible { outline: 3px solid rgba(214,169,74,.28); outline-offset: 2px; }
    .search-button small { margin-left: 6px; opacity: .72; }
    .bell-button { position: relative; overflow: visible; display: inline-grid; place-items: center; width: 42px; height: 42px; min-width: 42px; padding: 0; border-radius: 16px; background: linear-gradient(145deg, #ffffff, #fff4d8); }
    .bell-button:hover, .bell-button.has-unread { border-color: #c88d23; color: #3b2608; background: linear-gradient(145deg, #fffaf0, #f4cf73); }
    .bell-icon { width: 20px; height: 20px; fill: currentColor; }
    .bell-badge { position: absolute; right: -6px; top: -7px; display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border: 2px solid #fffdf8; border-radius: 999px; background: #b77916; color: #fffdf8 !important; font-size: .66rem; font-weight: 950; line-height: 1; box-shadow: 0 8px 16px rgba(183,121,22,.22); }
    .bell-button:not(.has-unread) .bell-badge { background: #ead5aa; color: #6e4810 !important; }
    .net-status, .queue-status { padding: 7px 10px; border-radius: 999px; background: #effbea; color: #1f6b2d !important; }
    .net-status.offline { background: #fff1ec; color: #9c2f21 !important; }
    .queue-status { background: #fff1cc; color: #7b4d0d !important; }
    .staff-content { min-width: 0; overflow: auto; padding: 20px; background: linear-gradient(160deg, rgba(255,255,255,.46), rgba(255,244,221,.72)); }
    .command-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: start center; padding-top: 8vh; background: rgba(20,12,5,.5); backdrop-filter: blur(3px); }
    .command-palette { width: min(720px, calc(100vw - 24px)); max-height: 78vh; overflow: auto; border: 1px solid rgba(234,210,162,.9); border-radius: 24px; background: #fff8ea; box-shadow: 0 30px 90px rgba(34,19,5,.35); }
    .command-head, .drawer-title { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px; border-bottom: 1px solid #ead5aa; }
    .command-head strong, .drawer-title strong { color: #1d1307; }
    .command-head button, .drawer-title button { border: 1px solid #d6aa55; border-radius: 999px; background: #fff; color: #6e4810; font-weight: 950; padding: 7px 10px; }
    .command-palette input { width: calc(100% - 28px); margin: 14px; min-height: 46px; border: 1px solid #d6aa55; border-radius: 16px; padding: 0 13px; color: #1d1307; }
    .command-list { display: grid; gap: 6px; padding: 0 14px 14px; }
    .command-list button { display: grid; grid-template-columns: 36px 1fr; gap: 10px; align-items: center; border: 1px solid #ead5aa; border-radius: 16px; padding: 10px; background: #fff; text-align: left; }
    .command-list button span { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 12px; background: #fff1cc; color: #7b4d0d; font-size: .72rem; font-weight: 950; }
    .command-list strong, .command-list small { display: block; color: #1d1307; }
    .command-list small { color: #75552b; }
    .notification-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 31; width: min(420px, 92vw); overflow: auto; padding: 14px; transform: translateX(105%); transition: transform .2s ease; background: #fff8ea; box-shadow: -24px 0 60px rgba(34,19,5,.28); }
    .notification-drawer.open { transform: translateX(0); }
    .ai-brief { margin: 12px 0; padding: 12px; border: 1px solid #ead5aa; border-radius: 16px; color: #5d3607; background: #fff; font-weight: 800; }
    .notice-list { display: grid; gap: 8px; }
    .notice-list article { padding: 12px; border: 1px solid #ead5aa; border-radius: 16px; background: #fff; }
    .notice-list strong, .notice-list small, .notice-list span { display: block; }
    .notice-list strong { color: #1d1307; }
    .notice-list small { margin-top: 4px; color: #75552b; font-weight: 800; }
    .notice-list span { margin-top: 6px; color: #8a611e; font-size: .76rem; font-weight: 950; text-transform: capitalize; }
    .notice-list button { margin-top: 8px; border: 1px solid #d6aa55; border-radius: 999px; background: #fff8ea; color: #6e4810; font-weight: 950; padding: 7px 10px; }
    .staff-toast { position: fixed; left: 50%; bottom: 18px; z-index: 80; transform: translateX(-50%); max-width: min(420px, calc(100vw - 24px)); padding: 11px 14px; border: 1px solid #d6aa55; border-radius: 999px; background: #1d1307; color: #fff8e8; font-weight: 950; box-shadow: 0 18px 44px rgba(34,19,5,.28); }
    .mobile-bottom-nav { display: none; }
    .scroll-top-button { display: none; }
    @media (max-width: 900px) {
      .staff-app-shell { display: block; min-height: 100dvh; padding-bottom: env(safe-area-inset-bottom); }
      .staff-main-shell { display: block; height: 100dvh; min-height: 100dvh; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; }
      .staff-topbar { position: sticky; top: 0; z-index: 20; min-height: 50px; padding: 0 8px 0 0; gap: 8px; box-shadow: 0 10px 28px rgba(92,65,28,.12); }
      .menu-button { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; flex: 0 0 auto; width: 44px; height: 44px; margin-left: 0; border: 1px solid #d6aa55; border-radius: 14px; background: #fff8ea; color: #5d3607; font-size: .78rem; font-weight: 950; }
      .staff-topbar > div:nth-child(2) { min-width: 0; flex: 1 1 auto; }
      .staff-identity { flex: 1 1 auto; gap: 5px; white-space: nowrap; }
      .staff-identity span { flex: 0 1 auto; max-width: 76px; font-size: .56rem; }
      .staff-identity strong { flex: 0 1 auto; max-width: 88px; font-size: .8rem; }
      .staff-topbar p { font-size: .66rem; }
      .topbar-actions { gap: 5px; flex: 0 0 auto; }
      .search-button small, .topbar-actions > span:not(.queue-status) { display: none; }
      .search-button { padding: 7px 9px; }
      .topbar-actions span { max-width: 132px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .82rem; }
      .topbar-actions button { padding: 7px 10px; }
      .topbar-actions .bell-button { width: 40px; height: 40px; min-width: 40px; padding: 0; border-radius: 15px; }
      .bell-icon { width: 19px; height: 19px; }
      .staff-content { overflow: visible; padding: 14px 12px calc(100px + env(safe-area-inset-bottom)); }
      .mobile-bottom-nav { position: fixed; left: 50%; bottom: calc(8px + env(safe-area-inset-bottom)); z-index: 27; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); width: min(calc(100vw - 18px), 430px); min-height: 68px; padding: 6px; gap: 3px; transform: translateX(-50%); border: 1px solid rgba(225,190,116,.52); border-radius: 22px; background: rgba(255,253,248,.96); box-shadow: 0 18px 42px rgba(73,35,58,.18); backdrop-filter: blur(18px); }
      .mobile-bottom-nav a { display: grid; grid-template-columns: 1fr; grid-template-rows: 23px auto; place-items: center; align-content: center; gap: 2px; min-width: 0; padding: 6px 3px; border: 0; border-radius: 16px; color: #76586b; font-size: .62rem; font-weight: 950; line-height: 1; text-decoration: none; } .mobile-bottom-nav a span, .mobile-bottom-nav a.active span { display: block; width: auto; height: auto; padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; font-size: inherit; font-weight: inherit; letter-spacing: 0; text-transform: none; }
      .mobile-bottom-nav a svg { display: block; width: 20px; height: 20px; margin: 0; fill: currentColor; }
      .mobile-bottom-nav a.active { color: #321827; background: linear-gradient(135deg, #f6c8bd, #f1d59f); box-shadow: 0 8px 18px rgba(160,91,108,.16); }
      .scroll-top-button { position: fixed; right: 14px; bottom: calc(88px + env(safe-area-inset-bottom)); z-index: 28; display: grid; place-items: center; width: 52px; height: 52px; border: 1px solid rgba(184,122,20,.46); border-radius: 999px; background: linear-gradient(145deg, #f7d77f, #c89024); color: #281806; font-weight: 950; box-shadow: 0 16px 34px rgba(139,93,21,.24); }
      .drawer-backdrop { display: block; position: fixed; inset: 0; z-index: 29; border: 0; opacity: 0; pointer-events: none; background: rgba(75,48,12,.28); backdrop-filter: blur(2px); transition: opacity .18s ease; }
      .drawer-backdrop.open { opacity: 1; pointer-events: auto; }
      .staff-sidebar { position: fixed; left: 0; top: 0; bottom: 0; z-index: 30; width: min(84vw, 318px); height: 100dvh; overflow: auto; padding: 14px; border-right: 1px solid rgba(214,170,85,.3); transform: translateX(-104%); transition: transform .2s ease; box-shadow: 24px 0 60px rgba(34,19,5,.18); }
      .staff-sidebar.open { transform: translateX(0); }
      .drawer-close { display: block; width: 100%; margin-bottom: 10px; padding: 9px 12px; border: 1px solid rgba(214,170,85,.3); border-radius: 16px; background: #fff8ea; color: #7a4510; font-weight: 950; text-align: left; }
      .brand-card { display: block; }
      nav { display: grid; gap: 6px; margin-top: 14px; overflow: visible; }
      nav a { min-width: 0; padding: 12px 13px; border-radius: 16px; text-align: left; font-size: .92rem; white-space: normal; background: transparent; }
      nav a.active { background: #fff8ea; color: #5d3607; border-color: rgba(255,255,255,.4); }
    }
    @media (max-width: 560px) {
      .staff-topbar { align-items: center; display: flex; }
      .staff-topbar strong { display: block; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .network-status { display: none; }

      nav a { padding: 12px 13px; }
    }
  `]
})
export class StaffLayoutPage implements OnInit, OnDestroy {
  @ViewChild("commandInput") private commandInput?: ElementRef<HTMLInputElement>;
  @ViewChild("mainShell") private mainShell?: ElementRef<HTMLElement>;
  readonly menuOpen = signal(false);
  readonly commandOpen = signal(false);
  readonly notificationsOpen = signal(false);
  readonly online = signal(typeof navigator === "undefined" ? true : navigator.onLine);
  readonly realtimeConnected = signal(false);
  readonly offlinePending = signal(0);
  readonly toastMessage = signal("");
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly recent = signal<StaffRecentItem[]>(this.readRecent());
  query = "";
  private pollTimer = 0;
  private reconnectTimer = 0;
  private toastTimer = 0;
  private socket: WebSocket | null = null;

  private readonly nav: StaffNavItem[] = [
    { label: "Dashboard", path: "/staff/dashboard", iconPath: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z", group: "Home" },
    { label: "Appointments", path: "/staff/appointments", iconPath: "M7 2v2H5a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 8H5V7h14v3z", group: "Work" },
    { label: "Today's Queue", path: "/staff/queue", iconPath: "M4 6h16v2H4V6zm0 5h12v2H4v-2zm0 5h8v2H4v-2z", group: "Work" },
    { label: "Tasks", path: "/staff/tasks", iconPath: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z", group: "Work", permission: "read:staff" },
    { label: "Attendance", path: "/staff/attendance", iconPath: "M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z", group: "Work" },
    { label: "Roster", path: "/staff/roster", iconPath: "M4 4h16v4H4V4zm0 6h7v10H4V10zm9 0h7v10h-7V10z", group: "Work", permission: "read:staff" },
    { label: "Calendar", path: "/staff/calendar", iconPath: "M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v16h18V5a2 2 0 0 0-2-2zm0 16H5V9h14v10z", group: "Work" },
    { label: "Clients", path: "/staff/clients", iconPath: "M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zM8 11c1.7 0 3-1.3 3-3S9.7 5 8 5 5 6.3 5 8s1.3 3 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.7 0-1.1.1 1.1.8 2.1 1.9 2.1 3.4V19h6v-2.5C23 14.2 18.3 13 16 13z", group: "Clients" },
    { label: "Client 360", path: "/staff/client-360", iconPath: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 17.9V17h-2v2.9A8 8 0 0 1 4.1 13H7v-2H4.1A8 8 0 0 1 11 4.1V7h2V4.1A8 8 0 0 1 19.9 11H17v2h2.9A8 8 0 0 1 13 19.9z", group: "Clients" },
    { label: "AI Coach", path: "/staff/ai-coach", iconPath: "M12 2 9.5 8H3l5.2 3.8L6 18l6-4 6 4-2.2-6.2L21 8h-6.5L12 2z", group: "Intelligence" },
    { label: "Performance", path: "/staff/performance", iconPath: "M3 17h3v4H3v-4zm5-6h3v10H8V11zm5 3h3v7h-3v-7zm5-9h3v16h-3V5z", group: "Intelligence" },
    { label: "Leaderboard", path: "/staff/leaderboard", iconPath: "M7 21h10v-2H7v2zM5 3h14v4a7 7 0 0 1-6 6.9V17h-2v-3.1A7 7 0 0 1 5 7V3zm2 2v2a5 5 0 0 0 10 0V5H7z", group: "Intelligence" },
    { label: "Reports", path: "/staff/reports", iconPath: "M5 3h11l3 3v15H5V3zm10 1.5V7h2.5L15 4.5zM8 11h8v2H8v-2zm0 4h8v2H8v-2z", group: "Intelligence" },
    { label: "Notifications", path: "/staff/notifications", iconPath: "M12 22a2.5 2.5 0 0 0 2.4-2h-4.8A2.5 2.5 0 0 0 12 22zm7-6v-5a7 7 0 0 0-14 0v5l-2 2v1h18v-1l-2-2z", group: "Comms" },
    { label: "Chat", path: "/staff/chat", iconPath: "M4 4h16v12H7l-3 3V4zm4 5h8V7H8v2zm0 4h6v-2H8v2z", group: "Comms" },
    { label: "Learning", path: "/staff/learning", iconPath: "M12 3 1 8l11 5 9-4.1V16h2V8L12 3zm-6 9v4c0 2 4 4 6 4s6-2 6-4v-4l-6 2.7L6 12z", group: "Growth" },
    { label: "Payroll", path: "/staff/payroll", iconPath: "M4 6h16v12H4V6zm2 2v8h12V8H6zm6 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", group: "Account", permission: "read:payroll" },
    { label: "Leaves", path: "/staff/leaves", iconPath: "M12 2C8 6 6 9 6 12a6 6 0 0 0 12 0c0-3-2-6-6-10z", group: "Account", permission: "read:staff" },
    { label: "Profile", path: "/staff/profile", iconPath: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-3.3 0-6 1.7-6 3.8V20h12v-2.2c0-2.1-2.7-3.8-6-3.8z", group: "Account" },
    { label: "Settings", path: "/staff/settings", iconPath: "M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A7 7 0 0 0 7 6L4.6 5l-2 3.5 2 1.5A8 8 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.5L7 17a7 7 0 0 0 2.6 1.5L10 21h4l.4-2.5A7 7 0 0 0 17 17l2.4 1 2-3.5-2-1.5zM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6z", group: "Account" }
  ];

  readonly commandResults = computed(() => {
    const text = this.query.trim().toLowerCase();
    const navItems = this.visibleNav().map((item) => ({ ...item }));
    const notices = (this.os()?.notifications || []).map((note) => ({ label: note.title, path: "/staff/notifications", iconPath: this.iconFor("Notifications"), group: note.body || "Notification" }));
    const coach = (this.os()?.aiCoach || []).map((card) => ({ label: card.title, path: "/staff/ai-coach", iconPath: this.iconFor("AI Coach"), group: card.body }));
    const queue = (this.os()?.timeline || []).map((item) => ({ label: item.clientName, path: "/staff/queue", iconPath: this.iconFor("Today's Queue"), group: item.serviceNames?.join(", ") || "Appointment" }));
    const all = [...navItems, ...notices, ...coach, ...queue];
    return (text ? all.filter((item) => `${item.label} ${item.group}`.toLowerCase().includes(text)) : all).slice(0, 12);
  });

  constructor(readonly staff: StaffAppService, private readonly router: Router) {}

  ngOnInit() {
    void this.loadShellData();
    void this.flushOfflineQueue();
    this.connectRealtime();
    this.pollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !this.realtimeConnected()) void this.loadShellData();
    }, 60000);
  }

  ngOnDestroy() {
    window.clearInterval(this.pollTimer);
    window.clearTimeout(this.reconnectTimer);
    window.clearTimeout(this.toastTimer);
    this.socket?.close();
  }

  @HostListener("window:online") onOnline() { this.online.set(true); void this.flushOfflineQueue(); this.connectRealtime(); }
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
  }

  @HostListener("window:touchend", ["$event"])
  onTouchEnd(event: TouchEvent) {
    const endX = event.changedTouches[0]?.clientX || 0;
    if (this.touchStartX < 24 && endX - this.touchStartX > 70) this.openMenu();
    if (this.menuOpen() && this.touchStartX - endX > 70) this.closeMenu();
  }

  private touchStartX = 0;

  visibleNav(): StaffNavItem[] {
    return this.nav.filter((item) => !item.permission || this.staff.hasPermission(item.permission) || item.permission === "read:payroll" && this.staff.hasPermission("read:finance"));
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

  activateNav(item: StaffNavItem) {
    this.remember(item);
    this.closeMenu();
  }

  activateRecent(item: StaffRecentItem) {
    this.remember(item);
    this.closeMenu();
  }

  openMenu() {
    this.menuOpen.set(true);
  }

  closeMenu() {
    this.menuOpen.set(false);
  }

  openCommand() {
    this.commandOpen.set(true);
    window.setTimeout(() => this.commandInput?.nativeElement.focus(), 0);
  }

  closeCommand() {
    this.commandOpen.set(false);
    this.query = "";
  }

  toggleNotifications() {
    this.notificationsOpen.update((open) => !open);
    window.setTimeout(() => document.querySelector<HTMLElement>(".notification-drawer.open button")?.focus(), 0);
  }

  closeNotifications() {
    this.notificationsOpen.set(false);
  }

  scrollToTop() {
    const shell = this.mainShell?.nativeElement;
    if (shell) shell.scrollTo({ top: 0, behavior: "smooth" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }

  go(item: StaffRecentItem) {
    this.remember(item);
    this.closeCommand();
    void this.router.navigateByUrl(item.path);
  }

  logout() {
    this.closeMenu();
    this.staff.logout();
    void this.router.navigateByUrl("/staff/login");
  }

  private async loadShellData() {
    try {
      this.os.set(await this.staff.enterpriseOs());
      this.offlinePending.set(this.staff.offlineQueueSize());
    } catch {
      this.os.set(null);
    }
  }

  private connectRealtime() {
    if (!this.online() || !this.staff.isAuthenticated()) return;
    if (this.socket && ([WebSocket.CONNECTING, WebSocket.OPEN] as number[]).includes(this.socket.readyState)) return;
    const url = this.staff.realtimeSocketUrl();
    if (!url) return;
    try {
      const socket = new WebSocket(url);
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
    this.reconnectTimer = window.setTimeout(() => this.connectRealtime(), 5000);
  }

  private handleRealtimeMessage(raw: unknown) {
    let frame: { type?: string } = {};
    try { frame = JSON.parse(String(raw)); } catch { return; }
    if (!frame.type || ["connection.ready", "pong", "subscription.updated"].includes(frame.type)) return;
    if (frame.type.startsWith("staff-self.") || ["dashboard.updated", "booking.updated", "queue.updated"].includes(frame.type)) {
      void this.loadShellData();
    }
  }

  private async flushOfflineQueue() {
    this.offlinePending.set(this.staff.offlineQueueSize());
    const flushed = await this.staff.flushOfflineActions();
    this.offlinePending.set(this.staff.offlineQueueSize());
    if (flushed) {
      this.showToast(`${flushed} queued staff action${flushed === 1 ? "" : "s"} synced.`);
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
