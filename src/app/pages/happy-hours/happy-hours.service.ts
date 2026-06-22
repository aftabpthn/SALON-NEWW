import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthSessionService } from '../../core/auth-session.service';
import { AppStateService } from '../../core/state/app-state.service';

@Injectable({ providedIn: 'root' })
export class HappyHoursService {
  private base = '/api/happy-hours';

  constructor(
    private http: HttpClient,
    private appState: AppStateService,
    private authSession: AuthSessionService
  ) {}

  list(params: { status?: string; limit?: number; offset?: number } = {}): Observable<any> {
    let p = new HttpParams();
    if (params.status) p = p.set('status', params.status);
    if (params.limit) p = p.set('limit', params.limit.toString());
    if (params.offset) p = p.set('offset', params.offset.toString());
    return this.http.get(this.base, { headers: this.headers(), params: p });
  }

  getById(id: number): Observable<any> { return this.http.get(`${this.base}/${id}`, { headers: this.headers() }); }
  create(body: any): Observable<any> { return this.http.post(this.base, body, { headers: this.headers() }); }
  update(id: number, body: any): Observable<any> { return this.http.patch(`${this.base}/${id}`, body, { headers: this.headers() }); }
  toggle(id: number, status: string): Observable<any> {
    return this.http.patch(`${this.base}/${id}/toggle`, { status }, { headers: this.headers() });
  }
  remove(id: number): Observable<any> { return this.http.delete(`${this.base}/${id}`, { headers: this.headers() }); }
  getActiveNow(): Observable<any> { return this.http.get(`${this.base}/active-now`, { headers: this.headers() }); }
  listDurationTiers(id: number): Observable<any> {
    return this.http.get(`${this.base}/${id}/duration-tiers`, { headers: this.headers() });
  }
  addDurationTier(id: number, body: any): Observable<any> {
    return this.http.post(`${this.base}/${id}/duration-tiers`, body, { headers: this.headers() });
  }
  removeDurationTier(happyHourId: number, tierId: number): Observable<any> {
    return this.http.delete(`${this.base}/${happyHourId}/duration-tiers/${tierId}`, { headers: this.headers() });
  }
  listBundles(): Observable<any> { return this.http.get(`${this.base}/bundles`, { headers: this.headers() }); }
  createBundle(body: any): Observable<any> { return this.http.post(`${this.base}/bundles`, body, { headers: this.headers() }); }
  removeBundle(id: number): Observable<any> { return this.http.delete(`${this.base}/bundles/${id}`, { headers: this.headers() }); }

  private headers(): HttpHeaders {
    let headers = new HttpHeaders({
      'x-tenant-id': this.appState.selectedTenantId(),
      'x-branch-id': this.appState.selectedBranchId(),
      'x-user-role': this.appState.userRole()
    });
    const token = this.authSession.accessToken();
    if (token) headers = headers.set('authorization', `Bearer ${token}`);
    return headers;
  }
}
