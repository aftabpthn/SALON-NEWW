
import { Component } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AppHeaderComponent } from './layout/app-header.component';
import { AppSidebarComponent } from './layout/app-sidebar.component';
import { SubscriptionBannerComponent } from './layout/subscription-banner.component';
import { TitleCaseInputsDirective } from './shared/directives/title-case-inputs.directive';
import { TranslatePipe } from './shared/pipes/translate.pipe';

@Component({
    selector: 'app-root',
    hostDirectives: [TitleCaseInputsDirective],
    imports: [RouterOutlet, AppHeaderComponent, AppSidebarComponent, SubscriptionBannerComponent, TranslatePipe],
    template: `
    @if (publicRoute) {
      <router-outlet />
    }
    @if (!publicRoute) {
      <div class="app-shell" [class.mobile-nav-open]="mobileNavOpen">
        <app-sidebar [mobileOpen]="mobileNavOpen" (navigationClosed)="mobileNavOpen = false" />
        <button
          class="mobile-nav-backdrop"
          type="button"
          [attr.aria-label]="('common.close' | translate) + ' ' + ('shell.primaryNavigation' | translate)"
          (click)="mobileNavOpen = false"
        ></button>
        <main class="main">
          <app-header [mobileNavOpen]="mobileNavOpen" (mobileNavToggle)="mobileNavOpen = !mobileNavOpen" />
          <app-subscription-banner />
          <section class="page-frame">
            <router-outlet />
          </section>
        </main>
      </div>
    }
    `
})
export class AppComponent {
  mobileNavOpen = false;

  constructor(private readonly router: Router) {}

  get publicRoute(): boolean {
    const path = this.router.url.split('?')[0];
    return path === '/login' || path.startsWith('/membership-status/') || path.startsWith('/book/');
  }
}
