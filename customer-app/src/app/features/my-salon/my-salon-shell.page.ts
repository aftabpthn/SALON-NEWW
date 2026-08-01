import { Component, computed } from "@angular/core";
import { Router } from "@angular/router";
import { IonRouterOutlet } from "@ionic/angular/standalone";
import { MarketplaceService } from "../../core/marketplace.service";
import { MySalonHeaderComponent } from "./my-salon-header.component";

@Component({
  standalone: true,
  imports: [IonRouterOutlet, MySalonHeaderComponent],
  template: `
    <section
      class="my-salon-shell"
      [attr.aria-label]="salonLabel() + ' mini app'">
      <app-my-salon-header
        [salonName]="salonLabel()"
        [initials]="salonInitials()"
        [logoImage]="salonLogo()"
        [homeHref]="homeHref()"
        actionLabel="Exit"
        actionIcon="exit-outline"
        actionAriaLabel="Exit My Salon"
        (back)="back()"
        (home)="goHome($event)"
        (action)="exit()" />
      <ion-router-outlet></ion-router-outlet>
    </section>
  `,
  styles: [`
    :host { display: block; min-height: 100%; }
    .my-salon-shell { min-height: 100%; --ms-shell-accent: var(--primary, #6366F1); }
  `]
})
export class MySalonShellPage {
  readonly salonLabel = computed(() => this.marketplace.mySalonDashboard()?.salon?.name || this.marketplace.primarySalon()?.businessName || this.marketplace.salonModeContext()?.businessName || "Selected salon");
  readonly salonLogo = computed(() => this.marketplace.mySalonDashboard()?.salon?.logoImage || "");
  readonly salonInitials = computed(() => this.initials(this.salonLabel()));

  constructor(readonly marketplace: MarketplaceService, private readonly router: Router) {}

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

  private initials(value: string): string {
    return value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "MS";
  }
}
