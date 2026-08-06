import { Component, HostListener, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import {
  briefcaseOutline,
  calendarOutline,
  closeOutline,
  downloadOutline,
  ellipsisHorizontal,
  fingerPrintOutline,
  globeOutline,
  helpCircleOutline,
  homeOutline,
  lockClosedOutline,
  logInOutline,
  logOutOutline,
  personOutline,
  phonePortraitOutline,
  searchOutline
} from "ionicons/icons";
import { environment } from "../../../environments/environment";
import { AuthService } from "../../core/auth.service";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

@Component({
  standalone: true,
  imports: [RouterLink, IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel],
  template: `
    @if (auth.biometricLocked()) {
      <section class="biometric-gate" aria-label="Biometric verification required">
        <div class="biometric-panel">
          <span class="gate-icon"><ion-icon name="finger-print-outline"></ion-icon></span>
          <h1>Verify to open Aura Shine</h1>
          @if (auth.error()) { <p class="gate-error">{{ auth.error() }}</p> }
          <button type="button" class="primary-action" (click)="unlock()" [disabled]="auth.loading()">
            <ion-icon name="lock-closed-outline"></ion-icon>
            Verify with biometric
          </button>
          <button type="button" class="text-action" (click)="logout()" [disabled]="auth.loading()">Use another account</button>
        </div>
      </section>
    }

    <header class="customer-header">
      <div class="header-inner">
        <a class="brand" routerLink="/tabs/home" (click)="closeMenu()" aria-label="Aura Shine home">Aura Shine</a>
        <div class="header-actions">
          @if (auth.isAuthenticated()) {
            <a class="account-link" routerLink="/tabs/profile" (click)="closeMenu()" aria-label="Open customer account">
              <span>{{ customerInitial() }}</span>
              <strong>{{ customerName() }}</strong>
            </a>
          } @else {
            <a class="login-link" routerLink="/login" (click)="closeMenu()">Log in</a>
          }
          <a class="business-link" [href]="businessAppUrl">List your business</a>
          <button
            type="button"
            class="menu-trigger"
            [attr.aria-expanded]="menuOpen()"
            aria-controls="customer-public-menu"
            aria-label="Open menu"
            (click)="toggleMenu()">
            <ion-icon [name]="menuOpen() ? 'close-outline' : 'ellipsis-horizontal'"></ion-icon>
          </button>
        </div>
      </div>

      @if (menuOpen()) {
        <button type="button" class="menu-backdrop" aria-label="Close menu" (click)="closeMenu()"></button>
        <nav id="customer-public-menu" class="public-menu" aria-label="Customer menu">
          <button type="button" (click)="installApp()">
            <ion-icon name="download-outline"></ion-icon><span>Download app</span>
          </button>
          @if (auth.isAuthenticated()) {
            <a routerLink="/tabs/profile" (click)="closeMenu()"><ion-icon name="person-outline"></ion-icon><span>My account</span></a>
            <button type="button" (click)="logoutAndClose()"><ion-icon name="log-out-outline"></ion-icon><span>Log out</span></button>
          } @else {
            <a routerLink="/login" (click)="closeMenu()"><ion-icon name="log-in-outline"></ion-icon><span>Log in / Sign up</span></a>
          }
          <a routerLink="/help" (click)="closeMenu()"><ion-icon name="help-circle-outline"></ion-icon><span>Help</span></a>
          <a routerLink="/tabs/home" (click)="closeMenu()"><ion-icon name="phone-portrait-outline"></ion-icon><span>Customer app</span></a>
          <button type="button" (click)="toggleLanguage()"><ion-icon name="globe-outline"></ion-icon><span>{{ languageLabel() }}</span></button>
          <a [href]="businessAppUrl"><ion-icon name="briefcase-outline"></ion-icon><span>For business</span></a>
          @if (installMessage()) { <p role="status">{{ installMessage() }}</p> }
        </nav>
      }
    </header>

    <ion-tabs>
      <ion-tab-bar slot="bottom" aria-label="Customer navigation">
        <ion-tab-button tab="home" href="/tabs/home"><ion-icon name="home-outline"></ion-icon><ion-label>Home</ion-label></ion-tab-button>
        <ion-tab-button tab="search" href="/tabs/search"><ion-icon name="search-outline"></ion-icon><ion-label>Book</ion-label></ion-tab-button>
        <ion-tab-button tab="bookings" href="/tabs/bookings"><ion-icon name="calendar-outline"></ion-icon><ion-label>Bookings</ion-label></ion-tab-button>
        <ion-tab-button tab="profile" href="/tabs/profile"><ion-icon name="person-outline"></ion-icon><ion-label>Profile</ion-label></ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: [`
    :host {
      --shell-ink: #071832;
      --shell-muted: #5d6b82;
      --shell-line: #d8e0ea;
      display: block;
      color: var(--shell-ink);
    }

    .customer-header {
      position: sticky;
      top: 0;
      z-index: 1000;
      border-bottom: 1px solid var(--shell-line);
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
    }

    .header-inner {
      width: min(calc(100% - 32px), 1504px);
      min-height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin: 0 auto;
    }

    .brand,
    .login-link,
    .business-link,
    .account-link,
    .public-menu a {
      color: inherit;
      text-decoration: none;
    }

    .brand {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.03em;
    }

    .header-actions,
    .account-link,
    .public-menu a,
    .public-menu button,
    .primary-action {
      display: flex;
      align-items: center;
    }

    .header-actions { gap: 10px; }

    .login-link,
    .business-link,
    .menu-trigger,
    .account-link {
      min-height: 38px;
      border: 1px solid transparent;
      border-radius: 8px;
      font-weight: 600;
    }

    .login-link { padding: 0 10px; }

    .business-link {
      display: inline-flex;
      align-items: center;
      padding: 0 14px;
      border-color: #c9d5e5;
      background: #fff;
    }

    .account-link { gap: 8px; padding: 0 8px; }
    .account-link span {
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      color: #fff;
      background: var(--shell-ink);
      font-size: 12px;
      font-weight: 700;
    }
    .account-link strong { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .menu-trigger {
      width: 38px;
      min-width: 38px;
      display: grid;
      place-items: center;
      padding: 0;
      border-color: #c9d5e5;
      color: var(--shell-ink);
      background: #fff;
      font-size: 20px;
      cursor: pointer;
    }

    .login-link:hover,
    .business-link:hover,
    .account-link:hover,
    .menu-trigger:hover,
    .menu-trigger:focus-visible {
      border-color: #2563eb;
      background: #f3f8ff;
    }

    .menu-backdrop {
      position: fixed;
      inset: 64px 0 0;
      z-index: 998;
      border: 0;
      background: rgba(7, 24, 50, 0.18);
    }

    .public-menu {
      position: absolute;
      top: 56px;
      right: max(16px, calc((100% - 1504px) / 2));
      z-index: 999;
      width: min(280px, calc(100vw - 24px));
      display: grid;
      overflow: hidden;
      border: 1px solid var(--shell-line);
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 22px 52px rgba(15, 23, 42, 0.18);
    }

    .public-menu a,
    .public-menu button {
      gap: 12px;
      min-height: 46px;
      padding: 0 14px;
      border: 0;
      border-bottom: 1px solid #e8edf4;
      color: var(--shell-ink);
      background: #fff;
      font: inherit;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }

    .public-menu a:hover,
    .public-menu button:hover,
    .public-menu a:focus-visible,
    .public-menu button:focus-visible {
      outline: 0;
      background: #eaf2ff;
      color: #174ea6;
    }

    .public-menu ion-icon { flex: 0 0 auto; font-size: 19px; }
    .public-menu p { margin: 0; padding: 10px 14px; color: var(--shell-muted); font-size: 12px; }

    ion-tabs {
      --page-top: 24px;
      display: flex;
      min-height: calc(100vh - 65px);
    }

    ion-tab-bar {
      --background: rgba(255, 255, 255, 0.98);
      --border: 1px solid var(--shell-line);
    }

    .biometric-gate {
      position: fixed;
      inset: 0;
      z-index: 4000;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #f3f6fa;
    }

    .biometric-panel {
      width: min(100%, 420px);
      display: grid;
      gap: 14px;
      padding: 24px;
      border: 1px solid var(--shell-line);
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 20px 48px rgba(15, 23, 42, 0.14);
    }

    .gate-icon {
      width: 48px;
      height: 48px;
      display: grid;
      place-items: center;
      border-radius: 10px;
      color: #174ea6;
      background: #eaf2ff;
      font-size: 22px;
    }
    .biometric-panel h1, .biometric-panel p { margin: 0; }
    .gate-error { color: #b42318; }
    .primary-action, .text-action {
      min-height: 40px;
      justify-content: center;
      gap: 8px;
      border: 1px solid #071832;
      border-radius: 8px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .primary-action { color: #fff; background: #071832; }
    .text-action { color: #071832; background: #fff; }

    @media (min-width: 768px) {
      ion-tab-bar { display: none; }
    }

    @media (max-width: 767px) {
      .header-inner { width: calc(100% - 24px); min-height: 58px; }
      .brand { font-size: 19px; }
      .business-link { display: none; }
      .account-link strong { display: none; }
      .menu-backdrop { inset-block-start: 58px; }
      .public-menu { top: 50px; right: 12px; }
      ion-tabs { --page-top: 16px; min-height: calc(100vh - 59px); }
    }
  `]
})
export class TabsPage {
  readonly businessAppUrl = environment.businessAppUrl;
  readonly language = signal(this.readLanguage());
  readonly menuOpen = signal(false);
  readonly installMessage = signal("");
  private installPrompt: InstallPromptEvent | null = null;
  private readonly mobileSwipeRoutes = ["/tabs/home", "/tabs/search", "/tabs/bookings", "/tabs/profile"];
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeStartRoute = "";
  private swipeTracking = false;

  constructor(readonly auth: AuthService, private readonly router: Router) {
    addIcons({ briefcaseOutline, calendarOutline, closeOutline, downloadOutline, ellipsisHorizontal, fingerPrintOutline, globeOutline, helpCircleOutline, homeOutline, lockClosedOutline, logInOutline, logOutOutline, personOutline, phonePortraitOutline, searchOutline });
    addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.installPrompt = event as InstallPromptEvent;
    });
  }

  @HostListener("window:storage")
  @HostListener("window:focus")
  refreshLanguage() { this.language.set(this.readLanguage()); }

  @HostListener("window:touchstart", ["$event"])
  startSwipe(event: TouchEvent) {
    if (!matchMedia("(max-width: 599px)").matches || event.touches.length !== 1) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("ion-tab-bar, button, a, input, textarea, select")) return;
    this.swipeStartX = event.touches[0].clientX;
    this.swipeStartY = event.touches[0].clientY;
    this.swipeStartRoute = this.normalizeRoute(this.router.url);
    this.swipeTracking = true;
  }

  @HostListener("window:touchend", ["$event"])
  @HostListener("window:touchcancel", ["$event"])
  finishSwipe(event: TouchEvent) {
    if (!this.swipeTracking) return;
    const deltaX = event.changedTouches[0]?.clientX - this.swipeStartX;
    const deltaY = event.changedTouches[0]?.clientY - this.swipeStartY;
    const index = this.mobileSwipeRoutes.indexOf(this.swipeStartRoute);
    this.swipeTracking = false;
    if (!deltaX || Math.abs(deltaX) < 64 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    const next = this.mobileSwipeRoutes[index + (deltaX < 0 ? 1 : -1)];
    if (next) void this.router.navigateByUrl(next);
  }

  toggleMenu() { this.menuOpen.update((open) => !open); }
  closeMenu() { this.menuOpen.set(false); this.installMessage.set(""); }

  async installApp() {
    if (!this.installPrompt) {
      this.installMessage.set("Use your browser menu and choose Add to Home screen.");
      return;
    }
    await this.installPrompt.prompt();
    await this.installPrompt.userChoice;
    this.installPrompt = null;
    this.closeMenu();
  }

  toggleLanguage() {
    const next = this.language() === "hi-IN" ? "en-IN" : "hi-IN";
    localStorage.setItem("aura_customer_language", next);
    this.language.set(next);
    dispatchEvent(new CustomEvent("aura:customer-language-updated"));
  }

  languageLabel() { return this.language() === "hi-IN" ? "हिन्दी" : "English (IN)"; }
  unlock() { void this.auth.verifyBiometricUnlock().catch(() => undefined); }
  logout() { void this.auth.logout().catch(() => undefined); }
  logoutAndClose() { this.closeMenu(); this.logout(); }

  customerName() {
    const customer = this.auth.customer();
    return customer?.firstName || customer?.name || customer?.email || "Customer";
  }

  customerInitial() { return this.customerName().trim().charAt(0).toUpperCase() || "A"; }

  private readLanguage(): "en-IN" | "hi-IN" {
    try {
      return localStorage.getItem("aura_customer_language") === "hi-IN" ? "hi-IN" : "en-IN";
    } catch {
      return "en-IN";
    }
  }

  private normalizeRoute(url: string) { return url.split(/[?#]/)[0].replace(/\/+$/, ""); }
}
