import { CanActivateFn, Router, UrlTree } from "@angular/router";
import { inject } from "@angular/core";
import { AuthService } from "./auth.service";

export const customerAuthGuard: CanActivateFn = (_route, state): boolean | UrlTree => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.biometricLocked()) return router.createUrlTree(["/tabs/home"], { queryParams: { returnUrl: state.url } });
  if (auth.isAuthenticated()) {
    const customer = auth.customer();
    if (customer && !auth.profileComplete(customer)) return router.createUrlTree(["/login"], { queryParams: { returnUrl: state.url, complete: "profile" } });
    return true;
  }
  return router.createUrlTree(["/login"], { queryParams: { returnUrl: state.url } });
};
