import { Injectable, inject } from '@angular/core';
import { Route, Router } from '@angular/router';
import { AuthSessionService } from './auth-session.service';

type LazyRoute = Route & {
  loadComponent?: () => Promise<unknown> | unknown;
  loadChildren?: () => Promise<unknown> | unknown;
};

@Injectable({ providedIn: 'root' })
export class NavigationPrefetchService {
  private readonly router = inject(Router);
  private readonly session = inject(AuthSessionService);
  private readonly warmed = new Set<string>();
  private readonly inFlight = new Set<string>();

  prefetch(path: string | undefined | null): void {
    if (!path || !this.session.isAuthenticated() || this.shouldDeferForConnection()) return;
    const route = this.findLazyRoute(path);
    if (!route) return;

    const key = this.routeKey(route);
    if (this.warmed.has(key) || this.inFlight.has(key)) return;
    this.inFlight.add(key);

    this.schedule(() => {
      Promise.resolve()
        .then(() => (route.loadComponent ? route.loadComponent() : route.loadChildren?.()) as unknown)
        .then(() => this.warmed.add(key))
        .catch(() => undefined)
        .finally(() => this.inFlight.delete(key));
    });
  }

  warmHighUseRoutes(): void {
    if (!this.session.isAuthenticated()) return;
    ['/home', '/appointments', '/pos', '/clients', '/staff-os', '/inventory', '/reports', '/marketing']
      .forEach((path, index) => setTimeout(() => this.prefetch(path), 120 + index * 140));
  }

  private findLazyRoute(path: string): LazyRoute | null {
    const normalized = this.normalize(path);
    if (!normalized) return null;
    return this.findInRoutes(this.router.config, normalized);
  }

  private findInRoutes(routes: Route[], normalizedPath: string): LazyRoute | null {
    for (const route of routes as LazyRoute[]) {
      const routePath = this.cleanRoutePath(route.path || '');
      if (!routePath) {
        const childMatch = route.children ? this.findInRoutes(route.children, normalizedPath) : null;
        if (childMatch) return childMatch;
        continue;
      }

      if (this.matchesRoute(routePath, normalizedPath) && (route.loadComponent || route.loadChildren)) return route;
      if (route.children?.length) {
        const childMatch = this.findInRoutes(route.children, normalizedPath);
        if (childMatch) return childMatch;
      }
    }
    return null;
  }

  private matchesRoute(routePath: string, normalizedPath: string): boolean {
    const routeParts = routePath.split('/');
    const pathParts = normalizedPath.split('/');
    if (routeParts.length > pathParts.length) return false;
    return routeParts.every((part, index) => part.startsWith(':') || part === pathParts[index]);
  }

  private normalize(path: string): string {
    return path
      .replace(/^https?:\/\/[^/]+/i, '')
      .split(/[?#]/)[0]
      .replace(/^\/+|\/+$/g, '');
  }

  private cleanRoutePath(path: string): string {
    return path.replace(/^\/+|\/+$/g, '');
  }

  private shouldDeferForConnection(): boolean {
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    return Boolean(connection?.saveData || /2g/i.test(connection?.effectiveType || ''));
  }

  private routeKey(route: LazyRoute): string {
    return `${route.path || ''}:${route.loadComponent ? 'component' : 'children'}`;
  }

  private schedule(task: () => void): void {
    const idleCallback = (globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (idleCallback) {
      idleCallback(task, { timeout: 700 });
      return;
    }
    setTimeout(task, 0);
  }
}
