import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { StaffAppService } from "./staff-app.service";

export const staffAuthGuard: CanActivateFn = () => {
  const staff = inject(StaffAppService);
  const router = inject(Router);
  return staff.isAuthenticated() || router.createUrlTree(["/staff/login"]);
};
