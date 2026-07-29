import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

export type BackbarRecipeLine = {
  productId?: string;
  itemId?: string;
  inventoryItemId?: string;
  standardQty?: number;
  quantity?: number;
  qty?: number;
};

export type BackbarService = {
  id: string;
  name: string;
  active: boolean;
  productConsumption: BackbarRecipeLine[];
};

export type BackbarItem = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  stockQuantity: number;
  reorderPoint: number;
  unitCostPaise: number;
  dualUseStock: boolean;
  active: boolean;
};

export type BackbarStaff = {
  id: string;
  firstName: string;
  lastName: string;
  appointmentDisplayName: string;
  active: boolean;
};

export type BackbarClient = { id:string; firstName:string; lastName:string; phone?:string; active:boolean };
export type BackbarAppointment = { id:string; clientId:string; staffId:string; serviceIds:string[]; startAt:string; status:string };

export type BackbarUsage = {
  id: string;
  inventoryItemId: string;
  itemName: string;
  serviceId?: string;
  serviceName: string;
  staffId?: string;
  staffName: string;
  clientId?: string;
  clientName: string;
  appointmentId?: string;
  source: string;
  expectedQuantity: number;
  actualQuantity: number;
  varianceQuantity: number;
  maxQuantity: number;
  wastagePercent: number;
  approvalThresholdPercent: number;
  unit: string;
  status: string;
  dualUseStock: boolean;
  retailShelfQuantity: number;
  sealedBackbarQuantity: number;
  openContainerBalance: number;
  notes: string;
  reviewNote: string;
  createdAt: string;
};

export type BackbarContainerEvent = {
  id: string;
  eventType: string;
  quantityDelta: number;
  remainingAfter: number;
  actorUserId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type BackbarContainer = {
  id: string;
  inventoryItemId: string;
  productName: string;
  barcode: string;
  batchId?: string;
  capacityQuantity: number;
  remainingQuantity: number;
  unit: string;
  status: string;
  dualUseStock: boolean;
  retailShelfQuantity: number;
  sealedBackbarQuantity: number;
  openContainerBalance: number;
  openedAt?: string;
  closedAt?: string;
  pendingOverrideId?: string;
  events: BackbarContainerEvent[];
};
export type BackbarContainerLabel={id:string;productName:string;barcode:string;capacityQuantity:number;unit:string;status:string;batchNumber:string;qrSvg:string};

export type BackbarProduct360 = {
  product: BackbarItem & { category?: string; barcode?: string; batchTracked?: boolean };
  stockInQuantity: number;
  stockOutQuantity: number;
  lastMovementAt?: string;
  lastReceiptDate?: string;
  lastSupplier?: string;
  recipeCount: number;
  consumedQuantity: number;
  retailShelfQuantity: number;
  sealedBackbarQuantity: number;
  openContainerBalance: number;
  openContainerUnit?: string;
  kitComponents: Array<{ componentName?: string; quantity?: number }>;
};

@Injectable({ providedIn: 'root' })
export class BackbarControlService {
  private readonly api = inject(ApiService);

  async items() {
    const query = new URLSearchParams({
      page: '1',
      pageSize: '50',
      withCount: 'false',
    });
    return (await this.get<BackbarItem[]>(`/inventory?${query}`)).filter((row) => row.active);
  }

  async services() {
    const rows = await this.get<any[]>('/services?pageSize=100');
    return rows.filter((row) => row.active !== false).map((row): BackbarService => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? ''),
      active: true,
      productConsumption: Array.isArray(row.productConsumption) ? row.productConsumption : [],
    }));
  }
  async staff() {
    return (await this.get<BackbarStaff[]>('/staff?pageSize=100')).filter((row) => row.active);
  }

  async clients() {
    return (await this.get<BackbarClient[]>('/clients?pageSize=200')).filter((row) => row.active !== false);
  }

  usage(date = '', staffId = '', clientId = '', appointmentId = '') {
    const query = new URLSearchParams();
    if (date) query.set('date', date);
    if (staffId) query.set('staffId', staffId);
    if (clientId) query.set('clientId', clientId);
    if (appointmentId) query.set('appointmentId', appointmentId);
    return this.get<BackbarUsage[]>(`/inventory/backbar-usage?${query}`);
  }

  async appointments() {
    const rows = await firstValueFrom(this.api.get<BackbarAppointment[]>('/appointments'));
    return Array.isArray(rows) ? rows : [];
  }

  containers() { return this.get<BackbarContainer[]>('/inventory/backbar-containers'); }
  containerLabel(id:string){return this.get<BackbarContainerLabel>(`/inventory/backbar-containers/${id}/label`);}
  product360(productId: string) { return this.get<BackbarProduct360>(`/inventory/${productId}/360`); }

  recordUsage(payload: Record<string, unknown>) {
    return firstValueFrom(this.api.post('/inventory/backbar-usage', payload));
  }

  reviewUsage(id: string, payload: Record<string, unknown>) {
    return firstValueFrom(this.api.patch(`/inventory/backbar-usage/${id}/review`, payload));
  }

  createContainer(payload: Record<string, unknown>) {
    return firstValueFrom(this.api.post('/inventory/backbar-containers', payload));
  }

  openContainer(id: string) {
    return firstValueFrom(this.api.post(`/inventory/backbar-containers/${id}/open`, { idempotencyKey: crypto.randomUUID() }));
  }

  consumeContainer(id: string, quantity: number) {
    return firstValueFrom(this.api.post(`/inventory/backbar-containers/${id}/consume`, { quantity, idempotencyKey: crypto.randomUUID() }));
  }

  requestOverride(id: string, requestedRemaining: number, reason: string) {
    return firstValueFrom(this.api.post(`/inventory/backbar-containers/${id}/overrides`, { requestedRemaining, reason, idempotencyKey: crypto.randomUUID() }));
  }

  reviewOverride(id: string, decision: 'approve' | 'reject', reviewNote: string) {
    return firstValueFrom(this.api.post(`/inventory/backbar-overrides/${id}/review`, { decision, reviewNote, idempotencyKey: crypto.randomUUID() }));
  }

  private async get<T>(path: string) {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path));
    if (response.data === undefined) throw new Error('API response did not contain data');
    return response.data;
  }
}
