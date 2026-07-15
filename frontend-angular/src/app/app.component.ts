import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AppHeaderComponent } from './layout/app-header.component';
import { AppSidebarComponent } from './layout/app-sidebar.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, AppHeaderComponent, AppSidebarComponent],
  template: `
    <router-outlet *ngIf="publicRoute" />
    <div class="app-shell" *ngIf="!publicRoute">
      <app-sidebar />
      <main class="main">
        <app-header />
        <section class="page-frame">
          <router-outlet />
        </section>
      </main>
    </div>
  `,
})
export class AppComponent {
  constructor(private readonly router: Router) {}

  get publicRoute(): boolean {
    const path = this.router.url.split('?')[0];
    return path === '/login' || path.startsWith('/membership-status/') || path.startsWith('/book/');
  }
}
