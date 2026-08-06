import { LanguageService } from '../../../core/i18n/language.service';

import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { BackbarControlService } from '../../../features/inventory/backbar-control.service';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { ActionDialogService } from '../../../shared/services/action-dialog.service';

type RecipeLine = {
  productId?: string;
  itemId?: string;
  inventoryItemId?: string;
  productName?: string;
  unit?: string;
  minQty?: number;
  standardQty?: number;
  quantity?: number;
  qty?: number;
  maxQty?: number;
  wastePercent?: number;
  ownerApprovalPercent?: number;
  hitLimit?: number;
  usageProfile?: 'root_touch_up' | 'full_colour' | 'custom';
  trackAutomatically?: boolean;
  allowManualOverride?: boolean;
};
type RecipeDraftLine = { productId: string; productName: string; unit: string; usageProfile: 'root_touch_up' | 'full_colour' | 'custom'; minQty: number | null; standardQty: number | null; maxQty: number | null; wastePercent: number | null; ownerApprovalPercent: number | null; hitLimit: number | null; trackAutomatically: boolean; allowManualOverride: boolean };
type Service = { id: string; name: string; category: string; pricePaise: number; active: boolean; productConsumption: RecipeLine[] };
type Item = { id: string; name: string; sku: string; unit: string; unitCostPaise: number; active: boolean };
type Usage = { id: string; inventoryItemId: string; itemName: string; serviceId?: string; serviceName: string; staffName: string; expectedQuantity: number; actualQuantity: number; varianceQuantity: number; approvalThresholdPercent: number; status: string; unit: string; createdAt: string };
type Appointment = { serviceIds: string[]; startAt: string; status: string };
type DemandRow = { serviceName: string; appointmentCount: number; productName: string; requiredQuantity: number; unit: string };
type RecipeVersion = { id:string; versionNumber:number; recipe:RecipeLine[]; changedBy?:string; changeSource:string; createdAt:string };
type RecipeTab = 'recipes' | 'demand' | 'approvals' | 'variance';

@Component({
    selector: 'page-service-recipes',
    imports: [FormsModule, TranslatePipe],
    templateUrl: './service-recipes-page.component.html',
    styleUrls: ['./service-recipes-page.component.css']
})
export class ServiceRecipesPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly auth = inject(AuthService);
  private readonly backbar = inject(BackbarControlService);
  private readonly api = inject(ApiService);
  private readonly dialogs = inject(ActionDialogService);
  services: Service[] = [];
  items: Item[] = [];
  usage: Usage[] = [];
  appointments: Appointment[] = [];
  recipeVersions: RecipeVersion[] = [];
  activeTab: RecipeTab = 'recipes';
  selectedServiceId = '';
  lines: RecipeDraftLine[] = [];
  search = '';
  status = '';
  loading = true;
  saving = false;
  error = '';
  notice = '';
  private originalLineCount = 0;

  ngOnInit() { void this.load(); }

  get filteredServices() {
    const query = this.search.trim().toLowerCase();
    return this.services.filter((service) => (!query || `${service.name} ${service.category}`.toLowerCase().includes(query))
      && (!this.status || (this.status === 'with' ? service.productConsumption.length > 0 : service.productConsumption.length === 0)));
  }
  get withRecipeCount() { return this.services.filter((service) => service.productConsumption.length > 0).length; }
  get selectedService() { return this.services.find((service) => service.id === this.selectedServiceId); }
  get varianceRows() { return this.usage.filter((row) => row.varianceQuantity !== 0); }
  get approvalRows() { return this.usage.filter((row) => row.status === 'pending_approval'); }
  get canReview() { return this.auth.hasRole('owner') || this.auth.hasPermission('inventory.approve'); }
  get demandRows(): DemandRow[] {
    const now = Date.now();
    const horizon = now + 15 * 24 * 60 * 60 * 1000;
    const booked = this.appointments.filter((row) => {
      const at = new Date(row.startAt).getTime();
      return Number.isFinite(at) && at >= now && at <= horizon && !['cancelled', 'canceled', 'no_show'].includes(row.status.toLowerCase());
    });
    return this.services.flatMap((service) => {
      const appointmentCount = booked.filter((row) => row.serviceIds.includes(service.id)).length;
      return service.productConsumption.map((line) => {
        const productId = String(line.productId ?? line.itemId ?? line.inventoryItemId ?? '');
        const item = this.items.find((row) => row.id === productId);
        const quantity = Number(line.standardQty ?? line.quantity ?? line.qty ?? 0);
        return { serviceName: service.name, appointmentCount, productName: String(line.productName ?? item?.name ?? ''), requiredQuantity: appointmentCount * quantity, unit: String(line.unit ?? item?.unit ?? '') };
      });
    }).filter((row) => row.appointmentCount > 0 && row.productName);
  }
  get missingRecipeAlerts() {
    const now=Date.now(),horizon=now+15*24*60*60*1000;
    return this.services.filter((service)=>service.active && service.productConsumption.length===0).map((service)=>({
      serviceId:service.id,serviceName:service.name,appointmentCount:this.appointments.filter((row)=>{
        const at=new Date(row.startAt).getTime(); return row.serviceIds.includes(service.id) && Number.isFinite(at) && at>=now && at<=horizon && !['cancelled','canceled','no_show'].includes(row.status.toLowerCase());
      }).length,
    })).filter((row)=>row.appointmentCount>0);
  }

  async load() {
    this.loading = true; this.error = '';
    try {
      const services = await this.get<any[]>('/services?pageSize=100');
      this.services = services.map((service) => ({
        id: String(service.id ?? ''), name: String(service.name ?? ''), category: String(service.category ?? ''),
        pricePaise: Number(service.pricePaise ?? 0), active: service.active !== false,
        productConsumption: Array.isArray(service.productConsumption) ? service.productConsumption : [],
      }));
      this.loading = false;
      void this.loadSupportingData();
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.e1cd5dcf1e')); }
    finally { this.loading = false; }
  }

  private async loadSupportingData() {
    try {
      const [items, usage, appointments] = await Promise.all([
        this.get<Item[]>('/inventory?page=1&pageSize=50&withCount=false'),
        this.get<Usage[]>('/inventory/backbar-usage?limit=500'),
        this.optional<any[]>('/appointments'),
      ]);
      this.items = items.filter((item) => item.active); this.usage = usage;
      this.appointments = appointments.map((row) => ({ serviceIds: Array.isArray(row.serviceIds) ? row.serviceIds.map(String) : Array.isArray(row.service_ids) ? row.service_ids.map(String) : [], startAt: String(row.startAt ?? row.start_at ?? ''), status: String(row.status ?? '') }));
      const selected = this.selectedService; if (selected) this.editRecipe(selected, false);
    } catch (error) { this.error ||= this.message(error, this.language.text('inventory.message.e1cd5dcf1e')); }
  }

  newRecipe() { this.selectedServiceId = ''; this.lines = []; this.recipeVersions=[]; this.originalLineCount = 0; this.clearFeedback(); }
  selectService() {
    const service = this.selectedService;
    if (service) this.editRecipe(service); else this.newRecipe();
  }
  editRecipe(service: Service, clear = true) {
    this.selectedServiceId = service.id;
    this.lines = service.productConsumption.map((line) => {
      const productId = String(line.productId ?? line.itemId ?? line.inventoryItemId ?? '');
      const item = this.items.find((row) => row.id === productId);
      return {
        productId, productName: String(line.productName ?? item?.name ?? ''), unit: String(line.unit ?? item?.unit ?? 'pcs'),
        usageProfile: line.usageProfile ?? 'custom',
        minQty: this.savedNumber(line.minQty), standardQty: this.savedNumber(line.standardQty ?? line.quantity ?? line.qty),
        maxQty: this.savedNumber(line.maxQty), wastePercent: this.savedNumber(line.wastePercent),
        ownerApprovalPercent: this.savedNumber(line.ownerApprovalPercent), hitLimit: this.savedNumber(line.hitLimit),
        trackAutomatically: line.trackAutomatically !== false,
        allowManualOverride: line.allowManualOverride !== false,
      };
    });
    this.originalLineCount = this.lines.length;
    void this.loadRecipeVersions(service.id);
    if (clear) this.clearFeedback();
  }
  addLine() { if (this.selectedServiceId) this.lines.push({ productId: '', productName: '', unit: '', usageProfile: 'custom', minQty: null, standardQty: null, maxQty: null, wastePercent: null, ownerApprovalPercent: null, hitLimit: null, trackAutomatically: true, allowManualOverride: true }); }
  removeLine(index: number) { this.lines.splice(index, 1); }
  selectItem(line: RecipeDraftLine) {
    const item = this.items.find((row) => row.id === line.productId);
    line.productName = item?.name ?? ''; line.unit = item?.unit ?? '';
  }
  recipeCost(service: Service) {
    return service.productConsumption.reduce((sum, line) => {
      const itemId = String(line.productId ?? line.itemId ?? line.inventoryItemId ?? '');
      const item = this.items.find((row) => row.id === itemId);
      return sum + (item?.unitCostPaise ?? 0) * Number(line.standardQty ?? line.quantity ?? line.qty ?? 0);
    }, 0);
  }
  money(paise: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((paise || 0) / 100); }
  date(value: string) { return new Intl.DateTimeFormat('en-GB').format(new Date(value)); }
  quantity(value: number, unit = '') { return `${Number(value || 0).toLocaleString('en-IN')} ${unit}`.trim(); }
  variancePercent(row: Usage) { return row.expectedQuantity > 0 ? Math.max(0, row.varianceQuantity / row.expectedQuantity * 100) : (row.varianceQuantity > 0 ? 100 : 0); }
  approvalThreshold(row: Usage) { return Number(row.approvalThresholdPercent || 0); }

  async review(row: Usage, decision: 'approve' | 'reject') {
    const reviewNote = decision === 'reject' ? await this.dialogs.prompt('Rejection reason', { required:true, multiline:true }) : '';
    if (decision === 'reject' && !reviewNote) return;
    this.saving = true; this.clearFeedback();
    try {
      await this.backbar.reviewUsage(row.id, { decision, reviewNote: reviewNote || '' });
      this.usage = await this.get<Usage[]>('/inventory/backbar-usage?limit=500');
      this.notice = decision === 'approve' ? 'Usage approved and stock updated' : 'Usage rejected';
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.b646c3516a')); }
    finally { this.saving = false; }
  }

  async saveRecipe() {
    const service = this.selectedService;
    if (!service) { this.error = this.language.text('inventory.message.c950ccc9e2'); return; }
    const productIds = this.lines.map((line) => line.productId);
    if (this.lines.some((line) => !line.productId || !Number.isInteger(Number(line.standardQty)) || Number(line.standardQty) <= 0)) { this.error = this.language.text('inventory.message.4ac5f19264'); return; }
    if (this.lines.some((line) => this.number(line.minQty) > Number(line.standardQty) || (this.number(line.maxQty) > 0 && Number(line.standardQty) > this.number(line.maxQty)))) { this.error = 'Usage range must follow minimum ≤ target ≤ maximum'; return; }
    if (new Set(productIds).size !== productIds.length) { this.error = this.language.text('inventory.message.387a7a34b0'); return; }
    if (!this.lines.length && this.originalLineCount && !await this.dialogs.confirm(this.language.text('inventory.message.34da7a31a7'))) return;
    const payload = this.lines.map((line) => ({
      productId: line.productId, productName: line.productName, unit: line.unit,
      usageProfile: line.usageProfile,
      minQty: this.number(line.minQty), standardQty: this.number(line.standardQty), maxQty: this.number(line.maxQty),
      wastePercent: this.number(line.wastePercent), ownerApprovalPercent: this.number(line.ownerApprovalPercent), hitLimit: Math.trunc(this.number(line.hitLimit)),
      trackAutomatically: line.trackAutomatically,
      allowManualOverride: line.allowManualOverride,
    }));
    this.saving = true; this.clearFeedback();
    try {
      await firstValueFrom(this.api.patch(`/services/${service.id}`, { productConsumption: payload }));
      this.notice = this.language.text('inventory.message.2daa18be1f'); await this.load(); this.notice = this.language.text('inventory.message.2daa18be1f');
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.09c3f615f7')); }
    finally { this.saving = false; }
  }

  private async loadRecipeVersions(serviceId:string) {
    try { this.recipeVersions=await this.get<RecipeVersion[]>(`/inventory/service-recipes/${serviceId}/versions`); }
    catch { this.recipeVersions=[]; }
  }

  private number(value: number | null) { const next = Number(value); return Number.isFinite(next) && next > 0 ? next : 0; }
  private savedNumber(value: unknown) { const next = Number(value); return Number.isFinite(next) ? next : null; }
  private async get<T>(path: string) { const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path)); if (response.data === undefined) throw new Error('API response did not contain data'); return response.data; }
  private async optional<T>(path: string) {
    try {
      const response = await firstValueFrom(this.api.get<ApiEnvelope<T> | T>(path));
      return (response as ApiEnvelope<T>).data ?? response as T;
    } catch { return [] as T; }
  }
  private message(error: any, fallback: string) { return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback; }
  private clearFeedback() { this.error = ''; this.notice = ''; }
}
