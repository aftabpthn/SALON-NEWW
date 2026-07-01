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
    if (!this.session.isAuthenticated()) return of(null);

    const priority = Number(route.data['preloadPriority'] ?? 5);
    const delayMs = Math.max(0, priority) * 350;
    return timer(delayMs).pipe(
      mergeMap(() => load()),
      catchError(() => of(null))
    );
  }
}
