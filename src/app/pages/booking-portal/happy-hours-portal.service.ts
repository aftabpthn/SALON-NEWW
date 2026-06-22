import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AppStateService } from '../../core/state/app-state.service';

@Injectable({ providedIn: 'root' })
export class HappyHoursPortalService {
  constructor(private http: HttpClient, private appState: AppStateService) {}

  getActiveNow(branchId = '', tenantId = ''): Observable<any> {
    return this.http.get('/api/happy-hours/active-now', { headers: this.headers(branchId, tenantId), params: this.params(branchId, tenantId) });
  }

  getUpcoming(branchId = '', tenantId = ''): Observable<any> {
    return this.http.get('/api/happy-hours/upcoming', { headers: this.headers(branchId, tenantId), params: this.params(branchId, tenantId) });
  }

  getServicesPricing(serviceIds: Array<string | number>, branchId = '', tenantId = ''): Observable<any> {
    return this.http.get('/api/happy-hours/services-pricing', {
      headers: this.headers(branchId, tenantId),
      params: this.params(branchId, tenantId).set('serviceIds', serviceIds.join(','))
    });
  }

  getPublicOffers(branchId = '', tenantId = '', context: Record<string, string | number | null | undefined> = {}): Observable<any> {
    let params = this.params(branchId, tenantId);
    Object.entries(context).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    });
    return this.http.get('/api/happy-hours-offers', { headers: this.headers(branchId, tenantId), params });
  }

  private headers(branchId = '', tenantId = ''): HttpHeaders {
    return new HttpHeaders({
      'x-tenant-id': tenantId || this.appState.selectedTenantId(),
      'x-branch-id': branchId || this.appState.selectedBranchId(),
      'x-user-role': this.appState.userRole()
    });
  }

  private params(branchId = '', tenantId = ''): HttpParams {
    let params = new HttpParams();
    const resolvedTenantId = tenantId || this.appState.selectedTenantId();
    const resolvedBranchId = branchId || this.appState.selectedBranchId();
    if (resolvedTenantId) params = params.set('tenantId', resolvedTenantId);
    if (resolvedBranchId) params = params.set('branchId', resolvedBranchId);
    return params;
  }
}
