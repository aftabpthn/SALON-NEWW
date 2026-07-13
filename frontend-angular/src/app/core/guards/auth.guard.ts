import { CanActivateFn } from '@angular/router';

export const authGuard: CanActivateFn = () => {
  const token = localStorage.getItem('aurashine_access_token');
  const tenantId = localStorage.getItem('aurashine_tenant_id');
  const branchId = localStorage.getItem('aurashine_branch_id');

  if (!token || !tenantId || !branchId || isExpired(token)) {
    clearAuth();
    return false;
  }

  return true;
};

function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? ''));
    const exp = Number(payload?.exp ?? 0);
    return !exp || exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

function clearAuth(): void {
  localStorage.removeItem('aurashine_access_token');
  localStorage.removeItem('aurashine_refresh_token');
  localStorage.removeItem('aurashine_tenant_id');
  localStorage.removeItem('aurashine_branch_id');
}
