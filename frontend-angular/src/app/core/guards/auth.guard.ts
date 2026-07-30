import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { navigationAccessForUrl } from '../auth/navigation-access';

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.ensureSession().pipe(
    map((authenticated) => {
      if (!authenticated) {
        return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
      }
      if (auth.mustChangePassword) {
        return router.createUrlTree(['/login'], {
          queryParams: { returnUrl: state.url, passwordChange: 'required' },
        });
      }
      if (auth.mfaEnrollmentRequired && state.url.split('?')[0] !== '/security') {
        return router.createUrlTree(['/security'], { queryParams: { mfa: 'required' } });
      }
      const routeRoles = (route.data['roles'] as string[] | undefined) ?? [];
      const routePermissions = (route.data['permissions'] as string[] | undefined) ?? [];
      const fallbackAccess = routeRoles.length || routePermissions.length
        ? undefined
        : navigationAccessForUrl(state.url);
      const roles = routeRoles.length ? routeRoles : fallbackAccess?.roles ?? [];
      const permissions = routePermissions.length ? routePermissions : fallbackAccess?.permissions ?? [];
      if (!auth.hasAccess(roles, permissions)) {
        return router.parseUrl((route.data['deniedRedirect'] as string | undefined) ?? '/dashboard');
      }
      return true;
    }),
  );
};
