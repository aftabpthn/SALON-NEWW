import { Component, OnDestroy, OnInit, signal } from "@angular/core";
import { IonApp, IonRouterOutlet } from "@ionic/angular/standalone";
import { NavigationEnd, NavigationStart, Router } from "@angular/router";
import { filter, Subscription } from "rxjs";
import { SplashScreen } from "@capacitor/splash-screen";
import { CustomerPushNotificationService } from "./core/customer-push-notification.service";
import { MarketplaceService } from "./core/marketplace.service";

const ACCESS_TOKEN_KEY = "auraCustomerAccessToken";
const REFRESH_TOKEN_KEY = "auraCustomerRefreshToken";
const LAST_ROUTE_KEY = "auraCustomerLastRoute";

@Component({
  selector: "aura-root",
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
  template: `
    <ion-app>
      @if (launchVisible()) {
        <div class="app-launch-shell" [class.closing]="launchClosing()" aria-hidden="true">
          <div class="app-launch-shell__brand">
            <img src="assets/branding/aurashine-logo.png" alt="" />
            <div class="app-launch-shell__loader">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      }
      <ion-router-outlet></ion-router-outlet>
    </ion-app>
  `,
  styles: [`
    .app-launch-shell {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at top left, rgba(232, 167, 184, 0.18), transparent 280px),
        linear-gradient(180deg, #fffaf6 0%, #faf7f2 360px);
      transition: opacity 220ms ease, visibility 220ms ease;
    }

    .app-launch-shell.closing {
      opacity: 0;
      visibility: hidden;
    }

    .app-launch-shell__brand {
      display: grid;
      justify-items: center;
      gap: 16px;
      padding: 24px;
    }

    .app-launch-shell__brand img {
      width: min(180px, 46vw);
      height: auto;
      object-fit: contain;
    }

    .app-launch-shell__loader {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .app-launch-shell__loader span {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #4b1238;
      animation: launch-loader 0.9s ease-in-out infinite;
    }

    .app-launch-shell__loader span:nth-child(2) { animation-delay: 0.12s; }
    .app-launch-shell__loader span:nth-child(3) { animation-delay: 0.24s; }

    @keyframes launch-loader {
      0%, 80%, 100% { opacity: 0.28; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-3px); }
    }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  private navigationSubscription?: Subscription;
  private salonBoundarySubscription?: Subscription;
  private redirectingToSalon = false;
  readonly launchVisible = signal(true);
  readonly launchClosing = signal(false);
  private launchCompleted = false;

  constructor(private readonly router: Router, private readonly pushNotifications: CustomerPushNotificationService, private readonly marketplace: MarketplaceService) {}

  ngOnInit() {
    void this.pushNotifications.initialize();
    this.navigationSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.rememberRoute(event.urlAfterRedirects);
        this.finishLaunchShell();
      });
    this.salonBoundarySubscription = this.router.events
      .pipe(filter((event): event is NavigationStart => event instanceof NavigationStart))
      .subscribe((event) => this.enforceSalonBoundary(event.url));

    if (!this.hasStoredSession() || !this.isStartupRoute()) return;
    const route = this.readLastRoute();
    setTimeout(() => void this.router.navigateByUrl(route), 0);
    window.setTimeout(() => this.finishLaunchShell(), 1800);
  }

  ngOnDestroy() {
    this.navigationSubscription?.unsubscribe();
    this.salonBoundarySubscription?.unsubscribe();
  }

  private enforceSalonBoundary(url: string) {
    if (!this.marketplace.salonMode() || this.redirectingToSalon) return;
    const path = url.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
    if (path.startsWith("/my-salon/") || path === "/login") return;
    this.redirectingToSalon = true;
    setTimeout(() => {
      void this.router.navigateByUrl(this.marketplace.salonModeUrl(), { replaceUrl: true }).finally(() => {
        this.redirectingToSalon = false;
      });
    }, 0);
  }

  private hasStoredSession(): boolean {
    try {
      return Boolean(localStorage.getItem(ACCESS_TOKEN_KEY) || localStorage.getItem(REFRESH_TOKEN_KEY));
    } catch {
      return false;
    }
  }

  private isStartupRoute(): boolean {
    return ["/", "/onboarding"].includes(window.location.pathname);
  }

  private rememberRoute(url: string) {
    const normalized = url.split("#")[0];
    if (!this.isRestorableRoute(normalized)) return;
    try {
      localStorage.setItem(LAST_ROUTE_KEY, normalized);
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
  }

  private readLastRoute(): string {
    try {
      const route = localStorage.getItem(LAST_ROUTE_KEY) || "";
      return this.isRestorableRoute(route) ? route : "/tabs/home";
    } catch {
      return "/tabs/home";
    }
  }

  private isRestorableRoute(route: string): boolean {
    return /^(?:\/my-salon\/|\/tabs\/|\/business\/|\/booking\/|\/bookings\/|\/notifications(?:[/?]|$)|\/settings(?:[/?]|$)|\/help(?:[/?]|$)|\/search(?:[/?]|$))/.test(route);
  }

  private finishLaunchShell() {
    if (this.launchCompleted) return;
    this.launchCompleted = true;
    this.launchClosing.set(true);
    window.setTimeout(() => this.launchVisible.set(false), 220);
    SplashScreen.hide().catch(() => undefined);
  }
}
