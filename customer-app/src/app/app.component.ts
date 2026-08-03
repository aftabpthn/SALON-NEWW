import { NgZone, Component, signal } from "@angular/core";
import { Router } from "@angular/router";
import { App as CapacitorApp } from "@capacitor/app";
import { IonApp, IonRouterOutlet } from "@ionic/angular/standalone";

@Component({
  selector: "aura-root",
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
  template: `
    <ion-app>
      @if (!online()) { <div class="offline-banner" role="status">Offline. Online-only actions are paused.</div> }
      <ion-router-outlet></ion-router-outlet>
    </ion-app>
  `,
  styles: [`.offline-banner{position:fixed;z-index:10000;top:env(safe-area-inset-top);left:50%;transform:translateX(-50%);max-width:calc(100% - 24px);padding:8px 14px;border-radius:0 0 10px 10px;background:#9a3412;color:#fff;font:600 13px/1.3 var(--ion-font-family);text-align:center}`]
})
export class AppComponent {
  readonly online = signal(navigator.onLine);

  constructor(private readonly router: Router, private readonly zone: NgZone) {
    this.applyBranding();
    addEventListener("online", () => this.online.set(true));
    addEventListener("offline", () => this.online.set(false));
    void CapacitorApp.addListener("appUrlOpen", ({ url }) => this.zone.run(() => this.openDeepLink(url)));
    void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) dispatchEvent(new CustomEvent("aura:app-resumed"));
    });
  }

  private applyBranding() {
    const brand = (window as any).AURA_CUSTOMER_BRAND || {};
    if (brand.appName) document.title = String(brand.appName);
    if (/^#[0-9a-f]{6}$/i.test(brand.primaryColor || "")) document.documentElement.style.setProperty("--ion-color-primary", brand.primaryColor);
  }

  private openDeepLink(raw: string) {
    try {
      const url = new URL(raw);
      const path = url.protocol === "aurashine:" && url.host === "app" ? url.pathname : url.pathname;
      if (["/kiosk", "/tabs/home", "/tabs/bookings", "/notifications", "/business/"].some((allowed) => path === allowed || path.startsWith(allowed))) void this.router.navigateByUrl(`${path}${url.search}`);
    } catch { /* Invalid external links are ignored. */ }
  }
}
