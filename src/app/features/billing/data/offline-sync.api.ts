import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiRecord, ApiService } from '../../../core/api.service';

export type OfflineOperationType = 'create_invoice_draft' | 'cash_payment' | string;
export type OfflineEntityType = 'invoice' | 'payment' | string;

export interface OfflineOperation {
  id: string;
  branch_id: string;
  entity_type: OfflineEntityType;
  operation: OfflineOperationType;
  payload: ApiRecord;
  local_created_at: string;
  client_version: number;
  terminal_id?: string;
  device_id?: string;
  entity_id?: string;
}

@Injectable({ providedIn: 'root' })
export class OfflineSyncApi {
  constructor(private readonly api: ApiService) {}

  push(operations: OfflineOperation[]): Observable<ApiRecord[]> {
    return this.api.post<ApiRecord[]>('offline-sync/push', { operations });
  }

  conflicts(): Observable<ApiRecord[]> {
    return this.api.list<ApiRecord[]>('offline-sync/conflicts');
  }
}
