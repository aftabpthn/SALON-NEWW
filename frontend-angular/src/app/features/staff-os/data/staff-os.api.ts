import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

@Injectable({ providedIn: 'root' })
export class StaffOsApi {
  private readonly api = inject(ApiService);

  async get<T>(path: string): Promise<T> {
    return this.unwrap(await firstValueFrom(this.api.get<ApiEnvelope<T>>(path)));
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.unwrap(await firstValueFrom(this.api.post<ApiEnvelope<T>>(path, body)));
  }

  private unwrap<T>(response: ApiEnvelope<T>): T {
    if (!response.success || response.data === undefined) throw new Error(response.error?.message || 'Staff OS request failed');
    return response.data;
  }
}
