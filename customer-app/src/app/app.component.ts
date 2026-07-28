import { Component, OnDestroy, OnInit } from "@angular/core";
import { IonApp, IonRouterOutlet } from "@ionic/angular/standalone";
import { NavigationEnd, Router } from "@angular/router";
import { filter, Subscription } from "rxjs";

const ACCESS_TOKEN_KEY = "auraCustomerAccessToken";
const REFRESH_TOKEN_KEY = "auraCustomerRefreshToken";
const LAST_ROUTE_KEY = "auraCustomerLastRoute";

@Component({
  selector: "aura-root",
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
  template: `
    <ion-app>
      <ion-router-outlet></ion-router-outlet>
    </ion-app>
  `
})
export class AppComponent implements OnInit, OnDestroy {
  private navigationSubscription?: Subscription;

  constructor(private readonly router: Router) {}

  ngOnInit() {
    this.navigationSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.rememberRoute(event.urlAfterRedirects));

    if (!this.hasStoredSession() || !this.isStartupRoute()) return;
    const route = this.readLastRoute();
    setTimeout(() => void this.router.navigateByUrl(route), 0);
  }

  ngOnDestroy() {
    this.navigationSubscription?.unsubscribe();
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
    return /^(?:\/tabs\/|\/business\/|\/booking\/|\/bookings\/|\/notifications(?:[/?]|$)|\/settings(?:[/?]|$)|\/help(?:[/?]|$)|\/search(?:[/?]|$))/.test(route);
  }
}
