import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AppHeaderComponent } from './layout/app-header.component';
import { AppSidebarComponent } from './layout/app-sidebar.component';
import { environment } from '../environments/environment';
import { readDevSessionResponse } from './core/services/dev-session-response';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, AppHeaderComponent, AppSidebarComponent],
  template: `
    <div class="app-shell">
      <app-sidebar />
      <main class="main">
        <app-header />
        <section class="page-frame">
          <ng-container *ngIf="authReady">
            <router-outlet />
          </ng-container>
        </section>
      </main>
    </div>
  `,
})
export class AppComponent implements OnInit {
  authReady = false;

  constructor(private readonly router: Router) {}

  async ngOnInit() {
    try {
      await this.ensureLocalDevSession();
    } finally {
      this.authReady = true;
      if (this.hasSession()) {
        const requestedUrl = `${location.pathname}${location.search}${location.hash}`;
        await this.router.navigateByUrl(requestedUrl === '/' ? '/dashboard' : requestedUrl, { replaceUrl: true });
      }
    }
  }

  private async ensureLocalDevSession() {
    if (environment.production || !environment.enableLocalDevSession || !['127.0.0.1', 'localhost'].includes(location.hostname)) return;

    const devSecret = environment.localDevSessionSecret || localStorage.getItem('aurashine_dev_session_secret');
    if (!devSecret) return;

    const response = await fetch('/api/v1/auth/dev-session', {
      method: 'POST',
      headers: { 'x-dev-session-secret': devSecret }
    }).catch(() => null);
    if (!response) return;

    const result = await readDevSessionResponse(response);
    if (!response.ok || !result?.success || !result.data?.access_token) return;
    const claims = this.tokenClaims(result.data.access_token);
    if (!claims?.tenant_id || !claims?.branch_id) return;

    localStorage.setItem('aurashine_access_token', result.data.access_token);
    localStorage.setItem('aurashine_refresh_token', result.data.refresh_token || '');
    localStorage.setItem('aurashine_tenant_id', claims.tenant_id);
    localStorage.setItem('aurashine_branch_id', claims.branch_id);
  }

  private hasSession(): boolean {
    return Boolean(
      localStorage.getItem('aurashine_access_token')
      && localStorage.getItem('aurashine_tenant_id')
      && localStorage.getItem('aurashine_branch_id')
    );
  }

  private tokenClaims(token: string): any | null {
    try {
      return JSON.parse(atob(token.split('.')[1] ?? ''));
    } catch {
      return null;
    }
  }
}
