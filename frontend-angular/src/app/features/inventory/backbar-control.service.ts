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
  minQty?: number;
  maxQty?: number;
  usageProfile?: 'root_touch_up' | 'full_colour' | 'custom';
  trackAutomatically?: boolean;
  allowManualOverride?: boolean;
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
  brand: string;
  sku: string;
  unit: string;
  packageUnit: string;
  unitsPerPackage: number;
  stockQuantity: number;
  reorderPoint: number;
  unitCostPaise: number;
  dualUseStock: boolean;
  batchTracked: boolean;
  productUsage: 'retail' | 'consumable' | 'dual_use';
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
export type BackbarAppointment = { id:string; clientId:string; staffId:string; serviceIds:string[]; startAt:string; status:string; recipeSnapshots:Array<{serviceId:string;versionNumber:number;recipe:BackbarRecipeLine[]}> };

export type BackbarUsage = {
  id: string;
  inventoryItemId: string;
  itemName: string;
  itemBrand: string;
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
  sealedBackbarBalance: number;
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
  sealedBackbarBalance: number;
  openContainerBalance: number;
  locationCode: string;
  custodianStaffId?: string;
  custodianStaffName?: string;
  openedAt?: string;
  closedAt?: string;
  pendingOverrideId?: string;
  events: BackbarContainerEvent[];
};
export type BackbarContainerLabel={id:string;productName:string;barcode:string;capacityQuantity:number;unit:string;status:string;batchNumber:string;qrSvg:string};
export type BackbarBatch={id:string;inventoryItemId:string;batchNumber:string;expiryDate?:string;quantity:number};

export type ColorBowlLine = {
  usageId: string;
  componentType: 'base' | 'fashion' | 'developer' | 'other';
  inventoryItemId: string;
  itemName: string;
  itemBrand: string;
  usageProfile: 'root_touch_up' | 'full_colour' | 'custom';
  minQuantity: number;
  expectedQuantity: number;
  maxQuantity: number;
  actualQuantity: number;
  varianceQuantity: number;
  unit: string;
  unitCostPaise: number;
  containerId?: string;
  status: string;
  wasteReason: string;
  notes: string;
};

export type ColorBowl = {
  id: string;
  appointmentId: string;
  clientId: string;
  clientName: string;
  serviceId: string;
  serviceName: string;
  servicePricePaise?: number;
  staffId: string;
  staffName: string;
  notes: string;
  status: string;
  expectedQuantity: number;
  actualQuantity: number;
  expectedCostPaise: number;
  actualCostPaise: number;
  createdAt: string;
  lines: ColorBowlLine[];
};

export type ColorDailyVariance = {
  date: string;
  inventoryItemId: string;
  itemName: string;
  itemBrand: string;
  unit: string;
  expectedQuantity: number;
  actualQuantity: number;
  varianceQuantity: number;
  expectedCostPaise: number;
  actualCostPaise: number;
  varianceCostPaise: number;
  bowlCount: number;
};

export type ColorStaffShiftRow = {
  date: string;
  staffId: string;
  staffName: string;
  shiftStatus: string;
  shift1Start?: string;
  shift1End?: string;
  shift2Start?: string;
  shift2End?: string;
  attendanceStatus: string;
  clockInAt?: string;
  clockOutAt?: string;
  unit: string;
  bowlCount: number;
  clientCount: number;
  rootTouchUpCount: number;
  fullColourCount: number;
  expectedQuantity: number;
  actualQuantity: number;
  varianceQuantity: number;
  varianceCostPaise: number;
  excessLineCount: number;
  wasteLineCount: number;
  pendingApprovalCount: number;
};

export type FormulaRecommendation = {
  sourceBowlId: string;
  usedAt: string;
  lines: Array<{
    componentType: 'base' | 'fashion' | 'developer' | 'other';
    inventoryItemId: string;
    itemName: string;
    itemBrand: string;
    suggestedQuantity: number;
    unit: string;
    usageProfile: 'root_touch_up' | 'full_colour' | 'custom';
  }>;
};

export type ColorServiceMargin = {
  date: string;
  serviceId: string;
  serviceName: string;
  bowlCount: number;
  pricedBowlCount: number;
  revenuePaise: number;
  expectedCostPaise: number;
  actualCostPaise: number;
  marginPaise?: number;
  marginBps?: number;
};

export type ReorderForecast = {
  run: { id: string; modelVersion: string; createdAt: string };
  recommendations: Array<{
    id: string;
    inventoryItemId: string;
    productName: string;
    sku: string;
    currentStock: number;
    reorderLevel: number;
    suggestedQuantity: number;
    unitCostPaise: number;
    confidenceBps: number;
    status: string;
    explanation: Record<string, unknown>;
  }>;
};

export type InventoryAnomalySuggestion = {
  key: string;
  category: string;
  severity: string;
  title: string;
  explanation: string;
  recommendedAction: string;
  confidenceBps: number;
  route: string;
  approval: { required: boolean; status: string; mode: string };
};

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
  sealedBackbarBalance: number;
  openContainerBalance: number;
  physicalTotalQuantity: number;
  openContainerUnit?: string;
  kitComponents: Array<{ componentName?: string; quantity?: number }>;
};

export type FloorLocation = { code:string; name:string; locationType:'store'|'backbar'|'station'|'trolley'; active:boolean; updatedAt:string };
export type FloorBalance = { inventoryItemId:string; productName:string; productUsage:'retail'|'consumable'|'dual_use'; unit:string; unopenedQuantity:number; storeUnopened:number; sealedCount:number; sealedBalance:number; sealedBackbarReserve:number; retailAvailable:number; consumableAvailable:number; openBalance:number; openFloorBalance:number; damagedQuarantine:number; inTransit:number; unifiedOnHand:number; physicalTotal:number; actualConsumed:number };
export type FloorCustodyEvent = { id:string; containerId:string; barcode:string; productName:string; fromLocationCode:string; toLocationCode:string; fromStaffId?:string; toStaffId?:string; reason:string; actorUserId:string; createdAt:string };
export type FloorClosingLine = { containerId:string; barcode:string; productName:string; expectedRemaining:number; countedRemaining:number; varianceQuantity:number; reason:string; unit:string };
export type FloorClosing = { id:string; businessDate:string; shiftLabel:string; status:string; requestedBy:string; reviewedBy?:string; reviewedAt?:string; reviewNote:string; createdAt:string; lines:FloorClosingLine[] };
export type OperationalMovement = { id:string; inventoryItemId:string; productName:string; action:string; sourceBucket:string; destinationBucket:string; quantity:number; unit:string; unitCostPaise:number; stockValuePaise:number; employeeId?:string; employeeName:string; actorUserId:string; comment:string; referenceType:string; referenceId:string; warning:boolean; reversalOfId?:string; reversed:boolean; metadata:Record<string,unknown>; createdAt:string };
export type FloorControl = { locations:FloorLocation[]; balances:FloorBalance[]; custodyEvents:FloorCustodyEvent[]; closings:FloorClosing[]; operationalMovements:OperationalMovement[] };

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

  bowls(date = '', clientId = '', appointmentId = '') {
    const query = new URLSearchParams();
    if (date) query.set('date', date);
    if (clientId) query.set('clientId', clientId);
    if (appointmentId) query.set('appointmentId', appointmentId);
    return this.get<ColorBowl[]>(`/inventory/color-bowls?${query}`);
  }

  dailyColorVariance(date = '') {
    const query = new URLSearchParams();
    if (date) query.set('date', date);
    return this.get<ColorDailyVariance[]>(`/inventory/color-bowls/daily-variance?${query}`);
  }

  colorStaffShiftDashboard(date = '') {
    const query = new URLSearchParams();
    if (date) query.set('date', date);
    return this.get<ColorStaffShiftRow[]>(`/inventory/color-bowls/staff-shift-dashboard?${query}`);
  }

  formulaRecommendation(clientId: string, serviceId: string) {
    const query = new URLSearchParams({ clientId, serviceId });
    return this.get<FormulaRecommendation | null>(`/inventory/color-bowls/formula-recommendation?${query}`);
  }

  colorServiceMargins(date = '') {
    const query = new URLSearchParams();
    if (date) query.set('date', date);
    return this.get<ColorServiceMargin[]>(`/inventory/color-bowls/service-margins?${query}`);
  }

  reorderForecast() { return this.get<ReorderForecast | null>('/inventory/reorder-forecasts'); }
  runReorderForecast() { return firstValueFrom(this.api.post('/inventory/reorder-forecasts', {})); }

  async colorAnomalySuggestions() {
    const response = await this.get<{ recommendations: InventoryAnomalySuggestion[] }>('/inventory/command-center');
    return response.recommendations.filter((row) => ['consumption_variance', 'unusual_staff_product_usage', 'container_rule_violation', 'missing_recipe'].includes(row.category));
  }

  recordBowl(payload: Record<string, unknown>) {
    return firstValueFrom(this.api.post('/inventory/color-bowls', payload));
  }

  async appointments() {
    const rows = await firstValueFrom(this.api.get<any[]>('/appointments'));
    return (Array.isArray(rows) ? rows : []).map((row):BackbarAppointment=>({
      id:String(row.id??''),clientId:String(row.clientId??row.client_id??''),staffId:String(row.staffId??row.staff_id??''),
      serviceIds:Array.isArray(row.serviceIds)?row.serviceIds.map(String):Array.isArray(row.service_ids)?row.service_ids.map(String):[],
      startAt:String(row.startAt??row.start_at??''),status:String(row.status??''),
      recipeSnapshots:Array.isArray(row.inventoryRecipeSnapshots)?row.inventoryRecipeSnapshots:Array.isArray(row.inventory_recipe_snapshots)?row.inventory_recipe_snapshots:[],
    }));
  }

  containers() { return this.get<BackbarContainer[]>('/inventory/backbar-containers'); }
  batches() { return this.get<BackbarBatch[]>('/inventory/batches'); }
  containerLabel(id:string){return this.get<BackbarContainerLabel>(`/inventory/backbar-containers/${id}/label`);}
  product360(productId: string) { return this.get<BackbarProduct360>(`/inventory/${productId}/360`); }

  recordUsage(payload: Record<string, unknown>) {
    return firstValueFrom(this.api.post('/inventory/backbar-usage', payload));
  }

  reviewUsage(id: string, payload: Record<string, unknown>) {
    return firstValueFrom(this.api.patch(`/inventory/backbar-usage/${id}/review`, payload));
  }

  reverseUsage(id: string, reason: string) {
    return firstValueFrom(this.api.post(`/inventory/backbar-usage/${id}/reverse`, { reason, idempotencyKey: crypto.randomUUID() }));
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

  floorControl() { return this.get<FloorControl>('/inventory/floor-control'); }
  checkout(payload:Record<string,unknown>) { return firstValueFrom(this.api.post('/inventory/checkouts',payload)); }
  convert(payload:Record<string,unknown>) { return firstValueFrom(this.api.post('/inventory/conversions',payload)); }
  reverseMovement(id:string,comment:string) { return firstValueFrom(this.api.post(`/inventory/operational-movements/${id}/reverse`,{comment,idempotencyKey:crypto.randomUUID()})); }
  saveFloorLocation(payload:Record<string,unknown>) { return firstValueFrom(this.api.post('/inventory/floor-locations',payload)); }
  transferCustody(id:string,payload:Record<string,unknown>) { return firstValueFrom(this.api.post(`/inventory/backbar-containers/${id}/custody`,payload)); }
  createFloorClosing(payload:Record<string,unknown>) { return firstValueFrom(this.api.post('/inventory/floor-closings',payload)); }
  reviewFloorClosing(id:string,payload:Record<string,unknown>) { return firstValueFrom(this.api.post(`/inventory/floor-closings/${id}/review`,payload)); }

  private async get<T>(path: string) {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path));
    if (response.data === undefined) throw new Error('API response did not contain data');
    return response.data;
  }
}
