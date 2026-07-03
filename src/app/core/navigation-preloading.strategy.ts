import { Injectable, inject } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, timer } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { AuthSessionService } from './auth-session.service';

@Injectable({ providedIn: 'root' })
export class NavigationPreloadingStrategy implements PreloadingStrategy {
  private readonly session = inject(AuthSessionService);

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (!route.data?.['preload']) return of(null);
    if (!this.session.isAuthenticated() || this.shouldDeferForConnection()) return of(null);

    const priority = Math.max(1, Number(route.data['preloadPriority'] ?? 5));
    const delayMs = 120 + (priority - 1) * 140;
    return timer(delayMs).pipe(
      mergeMap(() => load()),
      catchError(() => of(null))
    );
  }

  private shouldDeferForConnection(): boolean {
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    return Boolean(connection?.saveData || /2g/i.test(connection?.effectiveType || ''));
  }
}
