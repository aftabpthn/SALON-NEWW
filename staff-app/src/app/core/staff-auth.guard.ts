import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { StaffAppService } from "./staff-app.service";

export const staffAuthGuard: CanActivateFn = () => {
  const staff = inject(StaffAppService);
  const router = inject(Router);
  return staff.isAuthenticated() || router.createUrlTree(["/staff/login"]);
};

export const staffPermissionGuard: CanActivateFn = (route) => {
  const staff = inject(StaffAppService);
  const router = inject(Router);
  if (!staff.isAuthenticated()) return router.createUrlTree(["/staff/login"]);
  const required = route.data?.["permissions"];
  const anyRequired = route.data?.["anyPermissions"];
  const permissions = Array.isArray(required) ? required : required ? [required] : [];
  const anyPermissions = Array.isArray(anyRequired) ? anyRequired : anyRequired ? [anyRequired] : [];
  const allowed = permissions.length ? staff.hasEveryPermission(permissions) : true;
  const anyAllowed = anyPermissions.length ? staff.hasAnyPermission(anyPermissions) : true;
  return allowed && anyAllowed ? true : router.createUrlTree(["/staff/permission-denied"], { queryParams: { required: [...permissions, ...anyPermissions].join(",") } });
};
