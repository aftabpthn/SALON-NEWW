import { inject } from "@angular/core";
import { CanActivateFn } from "@angular/router";
import { MarketplaceService } from "./marketplace.service";

export const mySalonContextGuard: CanActivateFn = (route) => {
  const tenantId = route.paramMap.get("tenantId");
  const branchId = route.paramMap.get("branchId");
  if (tenantId && branchId) {
    inject(MarketplaceService).syncSalonModeContext({ tenantId, branchId });
  }
  return true;
};
