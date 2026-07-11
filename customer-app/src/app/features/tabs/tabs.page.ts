import { Component, HostListener, signal } from "@angular/core";
import { Router, RouterLink, RouterLinkActive } from "@angular/router";
import { IonButton, IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, chevronForwardOutline, closeOutline, fingerPrintOutline, giftOutline, homeOutline, locationOutline, lockClosedOutline, logInOutline, logOutOutline, menuOutline, notificationsOutline, personCircleOutline, personOutline, pricetagOutline, ribbonOutline, searchOutline, settingsOutline, sparklesOutline } from "ionicons/icons";
import { AuthService } from "../../core/auth.service";

@Component({
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IonButton, IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel],
  template: `
    @if (auth.biometricLocked()) {
      <section class="biometric-gate" aria-label="Biometric verification required">
        <div class="biometric-panel">
          <span class="gate-icon"><ion-icon name="finger-print-outline"></ion-icon></span>
          <h1>Verify to open Aura Shine</h1>
          @if (auth.error()) {
            <p class="gate-error">{{ auth.error() }}</p>
          }
          <ion-button expand="block" class="primary-gradient" (click)="unlock()" [disabled]="auth.loading()">
            <ion-icon name="lock-closed-outline" slot="start"></ion-icon>
            Verify with biometric
          </ion-button>
          <ion-button expand="block" fill="clear" (click)="logout()" [disabled]="auth.loading()">Use another account</ion-button>
        </div>
      </section>
    }
    <header class="mobile-topbar" aria-label="Customer app quick header">
      <a class="mobile-brand" routerLink="/tabs/home" (click)="closeMenu()">
        <img class="brand-mark" src="assets/icons/icon.svg" alt="" aria-hidden="true" />
        <span>
          <strong>Aura Shine</strong>
          <small>{{ locationLabel() }}</small>
        </span>
      </a>
      <div class="mobile-topbar-actions">
        <a class="mobile-icon-link" routerLink="/notifications" aria-label="Open notifications">
          <ion-icon name="notifications-outline"></ion-icon>
        </a>
        <button type="button" class="mobile-icon-link" aria-label="Open menu" (click)="toggleMenu()">
          <ion-icon [name]="menuOpen() ? 'close-outline' : 'menu-outline'"></ion-icon>
        </button>
      </div>
    </header>
    @if (menuOpen()) {
      <button type="button" class="mobile-menu-backdrop" aria-label="Close menu" (click)="closeMenu()"></button>
      <section class="mobile-menu-sheet" aria-label="Customer app menu">
        <div class="menu-sheet-head">
          <div>
            <p class="menu-kicker">Aura customer app</p>
            <h2>{{ auth.isAuthenticated() ? 'Your account' : 'Welcome back' }}</h2>
          </div>
          @if (auth.isAuthenticated()) {
            <button type="button" class="menu-auth-button" (click)="logoutAndClose()">
              <ion-icon name="log-out-outline"></ion-icon>
              Logout
            </button>
          } @else {
            <a class="menu-auth-button" routerLink="/login" (click)="closeMenu()">
              <ion-icon name="log-in-outline"></ion-icon>
              Login
            </a>
          }
        </div>
        @if (auth.isAuthenticated()) {
          <article class="menu-profile-card">
            <span class="menu-avatar">{{ customerInitial() }}</span>
            <div>
              <strong>{{ customerName() }}</strong>
              <small>{{ customerTierLabel() }} · {{ customerPointsLabel() }}</small>
            </div>
            <a routerLink="/tabs/profile" (click)="closeMenu()">Open</a>
          </article>
        }
        <div class="menu-highlight-grid">
          <a routerLink="/tabs/search" [queryParams]="{ nearMe: true }" (click)="closeMenu()"><ion-icon name="location-outline"></ion-icon><span>Near me</span></a>
          <a routerLink="/tabs/offers" (click)="closeMenu()"><ion-icon name="pricetag-outline"></ion-icon><span>Offers</span></a>
          <a routerLink="/tabs/rewards" (click)="closeMenu()"><ion-icon name="gift-outline"></ion-icon><span>Rewards</span></a>
          <a routerLink="/tabs/profile" (click)="closeMenu()"><ion-icon name="settings-outline"></ion-icon><span>Profile</span></a>
        </div>
        <div class="menu-insight-strip">
          <article><span>Mode</span><strong>{{ auth.isAuthenticated() ? 'Member' : 'Guest' }}</strong></article>
          <article><span>Explore</span><strong>Salons</strong></article>
          <article><span>Fast path</span><strong>Bookings</strong></article>
        </div>
        <nav class="mobile-menu-list">
          <a routerLink="/tabs/home" (click)="closeMenu()"><span>Home</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/search" (click)="closeMenu()"><span>Discover salons</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/consultation" (click)="closeMenu()"><span>Live consultation</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/bookings" (click)="closeMenu()"><span>My bookings</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/profile" (click)="closeMenu()"><span>Account and settings</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
        </nav>
      </section>
    }
    <nav class="web-nav" aria-label="Customer app navigation">
      <a class="brand" routerLink="/tabs/home">
        <img class="brand-mark" src="assets/icons/icon.svg" alt="" aria-hidden="true" />
        <span class="brand-copy">
          <strong>Aura Shine</strong>
        </span>
      </a>
      <div class="nav-links">
        <a routerLink="/tabs/home" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Home</a>
        <a routerLink="/tabs/search" routerLinkActive="active">Discover</a>
        <a routerLink="/tabs/consultation" routerLinkActive="active">Consult</a>
        <a routerLink="/tabs/offers" routerLinkActive="active">Offers</a>
        <a routerLink="/tabs/bookings" routerLinkActive="active">Bookings</a>
        <a routerLink="/tabs/rewards" routerLinkActive="active">Hub</a>
        <a routerLink="/tabs/profile" routerLinkActive="active">Profile</a>
      </div>
      <div class="nav-actions" aria-label="Customer quick actions">
        <a class="location-chip" routerLink="/tabs/search" [queryParams]="{ nearMe: true, map: true, filter: 'nearest', sort: 'distance' }">
          <ion-icon name="location-outline"></ion-icon>
          {{ locationLabel() }}
        </a>
        @if (auth.isAuthenticated()) {
          <button type="button" class="location-chip" (click)="logout()">
            <ion-icon name="log-out-outline"></ion-icon>
            Logout
          </button>
        } @else {
          <a class="location-chip" routerLink="/login">
            <ion-icon name="log-in-outline"></ion-icon>
            Login
          </a>
        }
        <a class="icon-link" routerLink="/notifications" aria-label="Open notifications">
          <ion-icon name="notifications-outline"></ion-icon>
          <span class="nav-badge" aria-hidden="true"></span>
        </a>
        <a class="icon-link" routerLink="/tabs/profile" aria-label="Open profile">
          <ion-icon name="person-circle-outline"></ion-icon>
        </a>
      </div>
    </nav>
    <ion-tabs>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="home" href="/tabs/home">
          <ion-icon name="home-outline"></ion-icon>
          <ion-label>Home</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="search" href="/tabs/search">
          <ion-icon name="search-outline"></ion-icon>
          <ion-label>Book</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="bookings" href="/tabs/bookings">
          <ion-icon name="calendar-outline"></ion-icon>
          <ion-label>Bookings</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="profile" href="/tabs/profile">
          <ion-icon name="person-outline"></ion-icon>
          <ion-label>Profile</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: [`
    .mobile-topbar,
    .mobile-brand,
    .mobile-topbar-actions,
    .mobile-menu-backdrop,
    .mobile-menu-sheet,
    .menu-sheet-head,
    .menu-profile-card,
    .menu-highlight-grid,
    .menu-insight-strip,
    .menu-highlight-grid a,
    .mobile-menu-list a,
    .menu-auth-button {
      display: flex;
      align-items: center;
    }

    .mobile-topbar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 40;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px 8px;
      background: linear-gradient(180deg, rgba(255, 249, 236, 0.98), rgba(255, 249, 236, 0.88));
      border-bottom: 1px solid rgba(214, 169, 74, 0.14);
      backdrop-filter: blur(18px);
    }

    ion-tabs {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      padding-top: 60px;
      box-sizing: border-box;
    }

    ion-tabs ion-router-outlet {
      flex: 1 1 auto;
    }

    @media (max-width: 599px) {
      ion-tabs {
        touch-action: pan-y;
      }
    }

    ion-tab-bar {
      --background: rgba(255, 253, 248, 0.96);
      --border: 1px solid rgba(214, 169, 74, 0.18);
      min-height: calc(62px + env(safe-area-inset-bottom));
      padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
      box-shadow: 0 -12px 32px rgba(92, 65, 28, 0.12);
      backdrop-filter: blur(18px);
    }

    ion-tab-button {
      --color: #7e6e55;
      --color-selected: #201307;
      --ripple-color: rgba(214, 169, 74, 0.18);
      min-width: 0;
      border-radius: 16px;
      font-size: 0.68rem;
      font-weight: 900;
    }

    ion-tab-button.tab-selected {
      background: linear-gradient(135deg, rgba(246, 200, 189, 0.88), rgba(241, 213, 159, 0.92));
    }

    ion-tab-button ion-icon {
      font-size: 1.18rem;
    }

    @media (max-width: 1023px) {
      .mobile-topbar {
        display: none !important;
      }

      ion-tabs {
        padding-top: 0;
      }
    }

    @media (min-width: 1024px) {
      .mobile-topbar,
      .mobile-menu-backdrop,
      .mobile-menu-sheet {
        display: none !important;
      }

      ion-tabs {
        padding-top: 0;
      }
    }

    .mobile-brand {
      gap: 10px;
      min-width: 0;
      color: var(--text);
      text-decoration: none;
    }

    .mobile-brand span {
      min-width: 0;
      display: grid;
      gap: 1px;
    }

    .mobile-brand strong {
      color: #1d1307;
      font-size: 0.92rem;
      line-height: 1.1;
    }

    .mobile-brand small {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 800;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mobile-topbar-actions {
      gap: 8px;
    }

    .mobile-icon-link {
      width: 40px;
      height: 40px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(17, 24, 39, 0.1);
      border-radius: 999px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.82);
      box-shadow: 0 8px 18px rgba(92, 65, 28, 0.08);
    }

    .mobile-menu-backdrop {
      position: fixed;
      inset: 0;
      z-index: 38;
      border: 0;
      background: rgba(20, 12, 5, 0.34);
      backdrop-filter: blur(4px);
    }

    .mobile-menu-sheet {
      position: fixed;
      top: 56px;
      left: 12px;
      right: 12px;
      bottom: calc(82px + env(safe-area-inset-bottom));
      z-index: 39;
      display: grid;
      align-content: start;
      gap: 14px;
      padding: 16px;
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 28px;
      overflow: auto;
      background:
        radial-gradient(circle at top right, rgba(255,255,255,0.52), transparent 22%),
        linear-gradient(180deg, rgba(255,255,255,0.99), rgba(255,249,236,0.96));
      box-shadow: 0 24px 54px rgba(92, 65, 28, 0.18);
    }

    .menu-sheet-head {
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
    }

    .menu-kicker {
      margin: 0 0 4px;
      color: #a36d16;
      font-size: 0.68rem;
      font-weight: 950;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .menu-sheet-head h2 {
      margin: 0;
      color: #1d1307;
      font-size: 1.15rem;
      letter-spacing: -0.03em;
    }

    .menu-auth-button {
      gap: 6px;
      min-height: 38px;
      padding: 0 12px;
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 999px;
      color: #6e4810;
      background: rgba(255,255,255,0.86);
      font-weight: 900;
      text-decoration: none;
    }

    .menu-highlight-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .menu-insight-strip {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .menu-insight-strip article {
      display: grid;
      gap: 3px;
      padding: 12px;
      border: 1px solid rgba(214, 169, 74, 0.16);
      border-radius: 16px;
      background: rgba(255,255,255,0.76);
    }

    .menu-insight-strip span {
      color: #a36d16;
      font-size: 0.66rem;
      font-weight: 950;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .menu-insight-strip strong {
      color: #1d1307;
      font-size: 0.9rem;
      line-height: 1.1;
    }

    .menu-profile-card {
      gap: 12px;
      justify-content: space-between;
      padding: 12px;
      border: 1px solid rgba(214, 169, 74, 0.2);
      border-radius: 18px;
      background: radial-gradient(circle at 0 0, rgba(255,255,255,0.7), transparent 38%), rgba(255,255,255,0.86);
      box-shadow: 0 10px 24px rgba(92, 65, 28, 0.08);
    }

    .menu-avatar {
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      border-radius: 14px;
      color: #6e4810;
      background: linear-gradient(145deg, #f7d77f, #d6a94a);
      font-weight: 1000;
      flex: 0 0 auto;
    }

    .menu-profile-card div {
      min-width: 0;
      display: grid;
      gap: 2px;
      flex: 1 1 auto;
    }

    .menu-profile-card strong,
    .menu-profile-card small,
    .menu-profile-card a {
      color: #1d1307;
    }

    .menu-profile-card small {
      color: var(--muted);
      font-weight: 800;
    }

    .menu-profile-card a {
      text-decoration: none;
      font-weight: 900;
    }

    .menu-highlight-grid a {
      gap: 8px;
      min-height: 52px;
      padding: 0 12px;
      border: 1px solid rgba(214, 169, 74, 0.18);
      border-radius: 18px;
      color: #1d1307;
      background: rgba(255,255,255,0.8);
      text-decoration: none;
      font-weight: 900;
    }

    .mobile-menu-list {
      display: grid;
      border-top: 1px solid rgba(214, 169, 74, 0.16);
    }

    .mobile-menu-list a {
      justify-content: space-between;
      gap: 10px;
      min-height: 48px;
      border-bottom: 1px solid rgba(214, 169, 74, 0.12);
      color: #3a2713;
      text-decoration: none;
      font-weight: 850;
    }

    .web-nav {
      display: none;
    }

    .biometric-gate {
      position: fixed;
      inset: 0;
      z-index: 4000;
      display: grid;
      place-items: center;
      padding: 24px;
      background: linear-gradient(180deg, rgba(245, 243, 255, 0.94), rgba(255, 255, 255, 0.98));
      animation: aura-gate-fade 280ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }

    .biometric-panel {
      width: min(100%, 420px);
      display: grid;
      gap: 14px;
      padding: 24px;
      border: 1px solid rgba(17, 24, 39, 0.16);
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: var(--shadow-card);
      backdrop-filter: blur(18px);
      animation: aura-gate-panel 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .gate-icon {
      width: 58px;
      height: 58px;
      display: grid;
      place-items: center;
      border-radius: 20px;
      color: var(--primary-2);
      background: var(--aura-gold-soft);
      font-size: 1.7rem;
    }

    .biometric-panel h1 {
      margin: 0;
      font-size: 1.85rem;
      letter-spacing: 0;
    }

    .biometric-panel p {
      margin: 0;
      color: var(--muted);
      line-height: 1.5;
      font-weight: 800;
    }

    .gate-error {
      padding: 12px 14px;
      border: 1px solid rgba(225, 29, 72, 0.16);
      border-radius: 16px;
      color: #EF4444 !important;
      background: #fff1f2;
    }

    @media (min-width: 1024px) {
      .mobile-topbar,
      .mobile-menu-sheet {
        display: none;
      }

      ion-tabs {
        padding-top: 0;
      }

      .web-nav {
        position: fixed;
        top: 18px;
        left: 50%;
        z-index: 1000;
        width: min(100% - 64px, 1360px);
        min-height: 72px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        padding: 10px 12px 10px 18px;
        border: 1px solid rgba(17, 24, 39, 0.14);
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(255, 249, 236, 0.82));
        box-shadow: 0 18px 42px rgba(92, 65, 28, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.72);
        backdrop-filter: blur(24px);
        transform: translateX(-50%);
        animation: aura-web-nav-in 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      .brand,
      .brand-copy,
      .nav-links,
      .nav-links a,
      .nav-actions,
      .location-chip,
      .icon-link {
        display: flex;
        align-items: center;
      }

      .brand {
        gap: 10px;
        color: var(--text);
        text-decoration: none;
      }

      .brand-mark {
        width: 44px;
        height: 44px;
        border-radius: 15px;
        box-shadow: 0 10px 24px rgba(139, 92, 246, 0.13);
        transition: transform var(--motion-medium), box-shadow var(--motion-medium);
      }

      .brand-copy {
        align-items: flex-start;
        flex-direction: column;
        gap: 1px;
      }

      .brand-copy strong {
        font-size: 1.02rem;
        letter-spacing: 0;
      }

      .brand-copy small {
        color: var(--muted);
        font-size: 0.74rem;
        font-weight: 800;
      }

      .nav-links {
        gap: 4px;
        padding: 6px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: rgba(255, 249, 236, 0.72);
      }

      .nav-links a {
        min-height: 44px;
        padding: 0 18px;
        border-radius: 999px;
        color: var(--muted);
        font-weight: 900;
        text-decoration: none;
        transition: color var(--motion-fast), background var(--motion-fast), transform var(--motion-fast);
      }

      .nav-links a:hover {
        color: var(--text);
        background: #ffffff;
        transform: translateY(-1px);
      }

      .nav-links a.active {
        color: #120D05;
        background: linear-gradient(135deg, rgba(244, 213, 141, 0.96), rgba(214, 169, 74, 0.82));
        box-shadow: 0 12px 26px rgba(214, 169, 74, 0.18);
      }

      .nav-actions {
        gap: 8px;
      }

      .location-chip,
      .icon-link {
        min-height: 44px;
        border: 1px solid var(--border);
        color: var(--text);
        background: rgba(255, 255, 255, 0.72);
        text-decoration: none;
        transition: color var(--motion-fast), border-color var(--motion-fast), background var(--motion-fast), transform var(--motion-fast), box-shadow var(--motion-fast);
      }

      .location-chip {
        gap: 7px;
        padding: 0 14px;
        border-radius: 999px;
        font-size: 0.88rem;
        font-weight: 900;
      }

      .icon-link {
        position: relative;
        width: 44px;
        justify-content: center;
        border-radius: 999px;
        font-size: 1.18rem;
      }

      .nav-badge {
        position: absolute;
        top: 9px;
        right: 9px;
        width: 8px;
        height: 8px;
        border: 1px solid rgba(255, 249, 236, 0.92);
        border-radius: 999px;
        background: #D6A94A;
      }

      .location-chip:hover,
      .icon-link:hover {
        border-color: rgba(214, 169, 74, 0.32);
        color: #7A5019;
        background: #ffffff;
        transform: translateY(-2px);
        box-shadow: 0 12px 24px rgba(92, 65, 28, 0.1);
      }

      .brand:hover .brand-mark {
        transform: rotate(-3deg) scale(1.04);
        box-shadow: 0 14px 30px rgba(92, 65, 28, 0.18);
      }
    }

    @keyframes aura-web-nav-in {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(-14px) scale(0.985);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0) scale(1);
      }
    }

    @keyframes aura-gate-fade {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes aura-gate-panel {
      from {
        opacity: 0;
        transform: translateY(16px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `]
})
export class TabsPage {
  readonly locationLabel = signal(this.readLocationLabel());
  readonly menuOpen = signal(false);
  private readonly mobileSwipeRoutes = ["/tabs/home", "/tabs/search", "/tabs/bookings", "/tabs/profile"];
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeStartRoute = "";
  private swipeTracking = false;

  constructor(readonly auth: AuthService, private readonly router: Router) {
    addIcons({ homeOutline, searchOutline, sparklesOutline, calendarOutline, ribbonOutline, personOutline, locationOutline, notificationsOutline, personCircleOutline, fingerPrintOutline, lockClosedOutline, pricetagOutline, menuOutline, closeOutline, logOutOutline, logInOutline, settingsOutline, giftOutline, chevronForwardOutline });
  }

  @HostListener("window:storage")
  @HostListener("window:focus")
  @HostListener("window:aura:customer-location-updated")
  refreshLocationLabel() {
    this.locationLabel.set(this.readLocationLabel());
  }

  @HostListener("window:touchstart", ["$event"])
  startSwipe(event: TouchEvent) {
    if (!window.matchMedia("(max-width: 599px)").matches || event.touches.length !== 1) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("ion-tab-bar, button, a, input, textarea, select")) return;
    this.swipeStartX = event.touches[0].clientX;
    this.swipeStartY = event.touches[0].clientY;
    this.swipeStartRoute = this.normalizeSwipeRoute(this.router.url);
    this.swipeTracking = true;
  }

  @HostListener("window:touchmove", ["$event"])
  moveSwipe(event: TouchEvent) {
    if (!this.swipeTracking || event.touches.length !== 1) return;
    const deltaX = event.touches[0].clientX - this.swipeStartX;
    const deltaY = event.touches[0].clientY - this.swipeStartY;
    if (Math.abs(deltaX) <= Math.abs(deltaY) || Math.abs(deltaX) < 8) return;
    const index = this.mobileSwipeRoutes.indexOf(this.swipeStartRoute);
    if (index < 0 || !this.mobileSwipeRoutes[index + (deltaX < 0 ? 1 : -1)]) return;
    event.preventDefault();
  }

  @HostListener("window:touchend", ["$event"])
  @HostListener("window:touchcancel", ["$event"])
  finishSwipe(event: TouchEvent) {
    if (!this.swipeTracking) return;
    const deltaX = event.changedTouches[0]?.clientX - this.swipeStartX;
    const deltaY = event.changedTouches[0]?.clientY - this.swipeStartY;
    const startRoute = this.swipeStartRoute;
    this.swipeTracking = false;
    this.swipeStartX = 0;
    this.swipeStartY = 0;
    this.swipeStartRoute = "";
    if (!deltaX || Math.abs(deltaX) < 64 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    const index = this.mobileSwipeRoutes.indexOf(startRoute);
    const nextRoute = this.mobileSwipeRoutes[index + (deltaX < 0 ? 1 : -1)];
    if (nextRoute) void this.router.navigateByUrl(nextRoute);
  }

  private normalizeSwipeRoute(url: string): string {
    return url.split(/[?#]/)[0].replace(/\/+$/, "");
  }

  unlock() {
    void this.auth.verifyBiometricUnlock().catch(() => undefined);
  }

  logout() {
    void this.auth.logout().catch(() => undefined);
  }

  toggleMenu() {
    this.menuOpen.update((open) => !open);
  }

  closeMenu() {
    this.menuOpen.set(false);
  }

  logoutAndClose() {
    this.closeMenu();
    this.logout();
  }

  customerName(): string {
    const customer = this.auth.customer();
    return customer?.firstName || customer?.name || customer?.email || "Aura member";
  }

  customerInitial(): string {
    return this.customerName().trim().charAt(0).toUpperCase() || "A";
  }

  customerTierLabel(): string {
    const customer = this.auth.customer();
    return String(customer?.membershipLabel || "Member");
  }

  customerPointsLabel(): string {
    return `${Number(this.auth.customer()?.loyaltyPoints || 0)} pts`;
  }

  private readLocationLabel(): string {
    try {
      const label = (localStorage.getItem("aura_customer_area_label") || "").trim();
      return label && label.toLowerCase() !== "near me" ? label : "Current location";
    } catch {
      return "Current location";
    }
  }
}

