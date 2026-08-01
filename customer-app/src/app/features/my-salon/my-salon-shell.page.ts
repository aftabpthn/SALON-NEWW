import { Component, computed } from "@angular/core";
import { Router } from "@angular/router";
import { IonIcon, IonRouterOutlet } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { chevronBackOutline, exitOutline, sparklesOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";

@Component({
  standalone: true,
  imports: [IonRouterOutlet, IonIcon],
  template: `
    <section
      class="my-salon-shell"
      [style.--ms-shell-accent]="accent()"
      [style.--primary]="accent()"
      [style.--brand-600]="accent()"
      [style.--brand-700]="accentStrong()"
      [style.--primary-soft]="accentSoft()"
      [attr.aria-label]="salonLabel() + ' mini app'">
      <div class="my-salon-shell-bar" role="navigation" aria-label="My Salon controls">
        <button type="button" class="shell-back" aria-label="Back" (click)="back()">
          <ion-icon name="chevron-back-outline" aria-hidden="true"></ion-icon>
        </button>
        <a class="shell-brand" [href]="homeHref()" (click)="goHome($event)">
          <span class="shell-brand-mark" aria-hidden="true"><ion-icon name="sparkles-outline"></ion-icon></span>
          <span><strong>{{ salonLabel() }}</strong><small>My Salon</small></span>
        </a>
        <div class="shell-actions">
          <button type="button" class="exit" (click)="exit()"><ion-icon name="exit-outline" aria-hidden="true"></ion-icon><span>Exit</span></button>
        </div>
      </div>
      <ion-router-outlet></ion-router-outlet>
    </section>
  `,
  styles: [`
    :host { display: block; min-height: 100%; }
    .my-salon-shell { min-height: 100%; --ms-shell-accent: var(--primary, #0B4678); }
    .my-salon-shell-bar {
      position: fixed;
      z-index: 1000;
      top: calc(10px + env(safe-area-inset-top));
      left: 50%;
      width: min(640px, calc(100% - 24px));
      min-height: 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 8px 7px 10px;
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: 999px;
      background: color-mix(in srgb, var(--ms-shell-accent) 13%, rgba(255, 255, 255, 0.94));
      box-shadow: 0 18px 46px rgba(6, 23, 43, 0.18);
      backdrop-filter: blur(18px);
      transform: translateX(-50%);
    }
    .shell-brand, .shell-actions, .shell-actions button, .shell-back { display: inline-flex; align-items: center; }
    .shell-back { flex: 0 0 auto; width: 34px; height: 34px; justify-content: center; padding: 0; border: 1px solid rgba(11, 70, 120, 0.16); border-radius: 999px; color: var(--primary, #0B4678); background: rgba(255, 255, 255, 0.78); font-size: 1rem; }
    .shell-brand { flex: 1 1 auto; min-width: 0; gap: 8px; color: var(--text, #07192b); text-decoration: none; }
    .shell-brand-mark { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 999px; color: #fff; background: var(--ms-shell-accent); box-shadow: 0 10px 22px color-mix(in srgb, var(--ms-shell-accent) 30%, transparent); }
    .shell-brand span:last-child { display: grid; min-width: 0; line-height: 1.05; }
    .shell-brand strong { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.86rem; letter-spacing: -0.025em; }
    .shell-brand small { color: var(--muted, #526579); font-size: 0.67rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; }
    .shell-actions { flex: 0 0 auto; gap: 6px; }
    .shell-actions button { gap: 5px; min-height: 34px; padding: 0 10px; border: 1px solid rgba(11, 70, 120, 0.16); border-radius: 999px; color: var(--primary, #0B4678); background: rgba(255, 255, 255, 0.78); font-size: 0.76rem; font-weight: 950; }
    .shell-actions .exit { color: #9F1239; border-color: rgba(159, 18, 57, 0.2); }
    @media (max-width: 430px) { .shell-brand strong { max-width: 150px; } .shell-actions button span { display: none; } .shell-actions button { width: 34px; justify-content: center; padding: 0; } }
  `]
})
export class MySalonShellPage {
  readonly salonLabel = computed(() => this.marketplace.mySalonDashboard()?.salon?.name || this.marketplace.primarySalon()?.businessName || this.marketplace.salonModeContext()?.businessName || "Selected salon");
  readonly accent = computed(() => this.colorFromText(this.salonLabel()));
  readonly accentStrong = computed(() => this.mixColor(this.accent(), -18));
  readonly accentSoft = computed(() => `${this.accent()}1A`);

  constructor(readonly marketplace: MarketplaceService, private readonly router: Router) {
    addIcons({ chevronBackOutline, exitOutline, sparklesOutline });
  }

  homeHref(): string {
    return this.marketplace.salonModeUrl();
  }

  goHome(event: Event): void {
    event.preventDefault();
    void this.router.navigateByUrl(this.homeHref());
  }

  back(): void {
    const currentPath = this.router.url.split(/[?#]/)[0].replace(/\/+$/, "");
    const homePath = this.homeHref().replace(/\/+$/, "");
    if (!currentPath || currentPath === homePath) return;
    window.history.length > 1 ? window.history.back() : void this.router.navigateByUrl(this.homeHref());
  }

  exit(): void {
    this.marketplace.exitSalonMode();
    void this.router.navigateByUrl("/tabs/home");
  }

  private colorFromText(value: string): string {
    const colors = ["#0B4678", "#7C3AED", "#047857", "#BE185D", "#B45309", "#0F766E"];
    const index = Array.from(value || "Salon").reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length;
    return colors[index];
  }

  private mixColor(hex: string, amount: number): string {
    const normalized = hex.replace("#", "");
    const num = parseInt(normalized, 16);
    const clamp = (value: number) => Math.max(0, Math.min(255, value));
    const r = clamp((num >> 16) + amount);
    const g = clamp(((num >> 8) & 255) + amount);
    const b = clamp((num & 255) + amount);
    return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
}
