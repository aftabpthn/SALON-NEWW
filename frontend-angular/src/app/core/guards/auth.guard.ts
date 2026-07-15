import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';

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
      const roles = (route.data['roles'] as string[] | undefined) ?? [];
      const permissions = (route.data['permissions'] as string[] | undefined) ?? [];
      if ((roles.length || permissions.length)
        && !auth.hasRole(...roles)
        && !auth.hasPermission(...permissions)) {
        return router.parseUrl((route.data['deniedRedirect'] as string | undefined) ?? '/dashboard');
      }
      return true;
    }),
  );
};
