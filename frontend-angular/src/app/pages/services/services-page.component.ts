
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

type ConsumptionLine = {
  id: number;
  productId: string;
  productName: string;
  unit: string;
  minQty: number;
  standardQty: number;
  maxQty: number;
  wastePercent: number;
  ownerApprovalPercent: number;
  hitLimit: number;
};

type StaffOption = {
  id: string;
  name: string;
  jobTitle: string;
  active: boolean;
};

type VariantRow = { id: string; name: string; priceDelta: string; durationDelta: string; active: boolean };
type AddonRow = { id: string; name: string; price: string; durationMinutes: string; active: boolean };
type StaffPriceRow = { id: string; staffId: string; price: string; active: boolean };
type PriceRuleRow = { id: string; name: string; daysOfWeek: string; startTime: string; endTime: string; adjustmentPercent: string; priority: string; active: boolean };

type ServiceRow = {
  id: string;
  name: string;
  category: string;
  pricePaise: number;
  durationMinutes: number;
  waitTimeMinutes: number;
  cleanupTimeMinutes: number;
  bufferTimeMinutes: number;
  gstPercent: number;
  sacCode: string;
  productConsumption: Omit<ConsumptionLine, 'id'>[];
  staffIds: string[];
  variants: Array<{ id: string; name: string; priceDeltaPaise: number; durationDeltaMinutes: number; active: boolean }>;
  addons: Array<{ id: string; name: string; pricePaise: number; durationMinutes: number; active: boolean }>;
  staffPrices: Array<{ id: string; staffId: string; pricePaise: number; active: boolean }>;
  priceRules: Array<{ id: string; name: string; daysOfWeek: number[]; startTime: string; endTime: string; adjustmentBps: number; priority: number; active: boolean }>;
  status: string;
};

@Component({
    selector: 'page-services',
    imports: [FormsModule],
    templateUrl: './services-page.component.html',
    styleUrls: ['./services-page.component.css']
})
export class ServicesPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  addServiceOpen = false;
  actionsOpen = false;
  productConsumptionOpen = false;
  savingService = false;
  serviceError = '';
  serviceSearch = '';
  categoryFilter = '';
  gstFilter = '';
  gstInput = '';
  staffSearch = '';
  consumptionLines: ConsumptionLine[] = [];
  staffOptions: StaffOption[] = [];
  serviceAddonsEnabled = true;
  readonly units = ['ml', 'gm', 'g', 'kg', 'l', 'pcs', 'tube', 'pack', 'box', 'nos'];
  services: ServiceRow[] = [];

  serviceForm = this.blankServiceForm();

  ngOnInit() {
    void Promise.all([this.loadServices(), this.loadStaff(), this.loadServiceSettings()]);
  }

  get categoryCount() {
    return new Set(this.services.map((service) => service.category).filter(Boolean)).size;
  }

  get categories() {
    return Array.from(new Set(this.services.map((service) => service.category).filter(Boolean))).sort();
  }

  get gstRates() {
    return Array.from(new Set(this.services.map((service) => service.gstPercent))).sort((a, b) => a - b);
  }

  get filteredServices() {
    const search = this.serviceSearch.trim().toLowerCase();
    return this.services.filter((service) => {
      const matchesSearch = !search || `${service.name} ${service.category}`.toLowerCase().includes(search);
      const matchesCategory = !this.categoryFilter || service.category === this.categoryFilter;
      const matchesGst = !this.gstFilter || String(service.gstPercent) === String(this.gstFilter);
      return matchesSearch && matchesCategory && matchesGst;
    });
  }

  get filteredStaffOptions() {
    const search = this.staffSearch.trim().toLowerCase();
    return this.staffOptions.filter((staff) => !search || `${staff.name} ${staff.jobTitle}`.toLowerCase().includes(search));
  }

  openAddService() {
    this.serviceForm = this.blankServiceForm();
    this.consumptionLines = [];
    this.productConsumptionOpen = false;
    this.serviceError = '';
    this.staffSearch = '';
    this.addServiceOpen = true;
  }

  openEditService(service: ServiceRow) {
    this.serviceForm = {
      id: service.id,
      name: service.name,
      category: service.category,
      price: String(service.pricePaise / 100),
      gstPercent: String(service.gstPercent),
      sacCode: service.sacCode,
      durationMinutes: String(service.durationMinutes),
      bufferTimeMinutes: String(service.bufferTimeMinutes),
      waitTimeMinutes: String(service.waitTimeMinutes),
      cleanupTimeMinutes: String(service.cleanupTimeMinutes),
      staffIds: [...service.staffIds],
      variants: service.variants.map((row) => ({ id: row.id, name: row.name, priceDelta: String(row.priceDeltaPaise / 100), durationDelta: String(row.durationDeltaMinutes), active: row.active })),
      addons: service.addons.map((row) => ({ id: row.id, name: row.name, price: String(row.pricePaise / 100), durationMinutes: String(row.durationMinutes), active: row.active })),
      staffPrices: service.staffPrices.map((row) => ({ id: row.id, staffId: row.staffId, price: String(row.pricePaise / 100), active: row.active })),
      priceRules: service.priceRules.map((row) => ({ id: row.id, name: row.name, daysOfWeek: row.daysOfWeek.join(','), startTime: row.startTime, endTime: row.endTime, adjustmentPercent: String(row.adjustmentBps / 100), priority: String(row.priority), active: row.active })),
      status: service.status,
    };
    this.consumptionLines = service.productConsumption.map((line, index) => ({
      ...line,
      id: Date.now() + index,
    }));
    this.productConsumptionOpen = this.consumptionLines.length > 0;
    this.serviceError = '';
    this.staffSearch = '';
    this.addServiceOpen = true;
  }

  closeAddService() {
    this.addServiceOpen = false;
  }

  openProductConsumption() {
    this.productConsumptionOpen = true;
    if (this.consumptionLines.length === 0) {
      this.addProductLine();
    }
  }

  addProductLine() {
    this.consumptionLines = [
      ...this.consumptionLines,
      {
        id: Date.now(),
        productId: '',
        productName: '',
        unit: 'ml',
        minQty: 0,
        standardQty: 1,
        maxQty: 0,
        wastePercent: 0,
        ownerApprovalPercent: 25,
        hitLimit: 3,
      },
    ];
  }

  removeProductLine(index: number) {
    this.consumptionLines = this.consumptionLines.filter((_, itemIndex) => itemIndex !== index);
  }

  isStaffAssigned(staffId: string) {
    return this.serviceForm.staffIds.includes(staffId);
  }

  setStaffAssigned(staffId: string, assigned: boolean) {
    this.serviceForm.staffIds = assigned
      ? Array.from(new Set([...this.serviceForm.staffIds, staffId]))
      : this.serviceForm.staffIds.filter((id) => id !== staffId);
  }

  addVariant() { this.serviceForm.variants.push({ id: '', name: '', priceDelta: '', durationDelta: '', active: true }); }
  removeVariant(index: number) { this.serviceForm.variants.splice(index, 1); }
  addAddon() {
    if (this.serviceAddonsEnabled) this.serviceForm.addons.push({ id: '', name: '', price: '', durationMinutes: '', active: true });
  }
  removeAddon(index: number) { this.serviceForm.addons.splice(index, 1); }
  addStaffPrice() { this.serviceForm.staffPrices.push({ id: '', staffId: '', price: '', active: true }); }
  removeStaffPrice(index: number) { this.serviceForm.staffPrices.splice(index, 1); }
  addPriceRule() { this.serviceForm.priceRules.push({ id: '', name: '', daysOfWeek: '0,1,2,3,4,5,6', startTime: '09:00', endTime: '18:00', adjustmentPercent: '', priority: '', active: true }); }
  removePriceRule(index: number) { this.serviceForm.priceRules.splice(index, 1); }

  formatTitleCase(event: Event) {
    const input = event.target as HTMLInputElement;
    input.value = input.value
      .split(' ')
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
      .join(' ');
  }

  titleCase(value: string) {
    return value
      .split(' ')
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
      .join(' ');
  }

  toggleActions() {
    this.actionsOpen = !this.actionsOpen;
  }

  trackByIndex(index: number, _item?: unknown) {
    return index;
  }

  rupees(pricePaise: number) {
    return `₹${(Number(pricePaise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  async saveService() {
    this.serviceError = '';
    const name = this.serviceForm.name.trim();
    if (!name) {
      this.serviceError = 'Service name required';
      return;
    }

    this.savingService = true;
    try {
      const lines = this.consumptionLines
        .filter((line) => line.productId || line.productName)
        .map((line) => ({
          productId: line.productId || undefined,
          productName: line.productName || undefined,
          unit: line.unit,
          minQty: this.nonNegativeNumber(line.minQty),
          standardQty: this.nonNegativeNumber(line.standardQty),
          maxQty: this.nonNegativeNumber(line.maxQty),
          wastePercent: this.nonNegativeNumber(line.wastePercent),
          ownerApprovalPercent: this.nonNegativeNumber(line.ownerApprovalPercent),
          hitLimit: this.nonNegativeNumber(line.hitLimit),
        }));

      const payload = {
          name,
          category: this.serviceForm.category.trim(),
          durationMinutes: this.nonNegativeNumber(this.serviceForm.durationMinutes),
          pricePaise: Math.round(this.nonNegativeNumber(this.serviceForm.price) * 100),
          gstPercent: this.nonNegativeNumber(this.serviceForm.gstPercent),
          sacCode: this.serviceForm.sacCode.trim(),
          waitTimeMinutes: this.nonNegativeNumber(this.serviceForm.waitTimeMinutes),
          cleanupTimeMinutes: this.nonNegativeNumber(this.serviceForm.cleanupTimeMinutes),
          bufferTimeMinutes: this.nonNegativeNumber(this.serviceForm.bufferTimeMinutes),
          productConsumption: lines,
          staffIds: this.serviceForm.staffIds,
          variants: this.serviceForm.variants.filter((row) => row.name.trim()).map((row) => ({
            id: row.id, name: this.titleCase(row.name), priceDeltaPaise: Math.round(this.numberOrZero(row.priceDelta) * 100),
            durationDeltaMinutes: Math.trunc(this.numberOrZero(row.durationDelta)), active: row.active,
          })),
          addons: this.serviceForm.addons.filter((row) => row.name.trim()).map((row) => ({
            id: row.id, name: this.titleCase(row.name), pricePaise: Math.round(this.nonNegativeNumber(row.price) * 100),
            durationMinutes: Math.trunc(this.nonNegativeNumber(row.durationMinutes)), active: row.active,
          })),
          staffPrices: this.serviceForm.staffPrices.filter((row) => row.staffId).map((row) => ({
            id: row.id, staffId: row.staffId, pricePaise: Math.round(this.nonNegativeNumber(row.price) * 100), active: row.active,
          })),
          priceRules: this.serviceForm.priceRules.filter((row) => row.name.trim()).map((row) => ({
            id: row.id, name: this.titleCase(row.name), daysOfWeek: this.parseDays(row.daysOfWeek),
            startTime: row.startTime, endTime: row.endTime,
            adjustmentBps: Math.round(this.numberOrZero(row.adjustmentPercent) * 100),
            priority: Math.trunc(this.nonNegativeNumber(row.priority)), active: row.active,
          })),
          active: this.serviceForm.status !== 'inactive',
        };
      const request = this.serviceForm.id
        ? this.api.patch<ApiEnvelope<unknown>>(`/services/${encodeURIComponent(this.serviceForm.id)}`, payload)
        : this.api.post<ApiEnvelope<unknown>>('/services', payload);
      const result = await firstValueFrom(request);
      if (!result.success) {
        throw new Error(result?.error?.message || result?.error || 'Service save failed');
      }

      await this.loadServices();
      this.closeAddService();
    } catch (error) {
      this.serviceError = error instanceof Error ? error.message : 'Service save failed';
    } finally {
      this.savingService = false;
    }
  }

  async loadServices() {
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<any[]>>('/services'));
      if (!result.success || !Array.isArray(result.data)) {
        return;
      }

      this.services = result.data.map((service: any) => ({
        id: service.id || '',
        name: service.name || '',
        category: service.category || '',
        pricePaise: Number(service.pricePaise || 0),
        durationMinutes: Number(service.durationMinutes || 0),
        waitTimeMinutes: Number(service.waitTimeMinutes || 0),
        cleanupTimeMinutes: Number(service.cleanupTimeMinutes || 0),
        bufferTimeMinutes: Number(service.bufferTimeMinutes || 0),
        gstPercent: Number(service.gstPercent || 0),
        sacCode: service.sacCode || '',
        productConsumption: Array.isArray(service.productConsumption) ? service.productConsumption : [],
        staffIds: Array.isArray(service.staffIds) ? service.staffIds : [],
        variants: Array.isArray(service.variants) ? service.variants : [],
        addons: Array.isArray(service.addons) ? service.addons : [],
        staffPrices: Array.isArray(service.staffPrices) ? service.staffPrices : [],
        priceRules: Array.isArray(service.priceRules) ? service.priceRules : [],
        status: service.active === false ? 'inactive' : 'active',
      }));
    } catch {
      this.services = [];
    }
  }

  async loadStaff() {
    try {
      // ponytail: first 100 branch staff; add server-side search when a branch exceeds this.
      const result = await firstValueFrom(this.api.get<ApiEnvelope<any[]>>('/staff?pageSize=100'));
      this.staffOptions = Array.isArray(result.data)
        ? result.data.map((staff: any) => ({
            id: staff.id || '',
            name: staff.appointmentDisplayName || [staff.firstName, staff.middleName, staff.lastName].filter(Boolean).join(' ') || staff.email || 'Staff',
            jobTitle: staff.jobTitle || '',
            active: staff.active !== false,
          })).filter((staff) => staff.id).sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name))
        : [];
    } catch {
      this.staffOptions = [];
    }
  }

  async loadServiceSettings() {
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<any>>('/services/settings'));
      this.serviceAddonsEnabled = result.data?.serviceCatalog?.serviceAddonsEnabled !== false;
    } catch {
      this.serviceAddonsEnabled = true;
    }
  }

  private blankServiceForm() {
    return {
      id: '',
      name: '',
      category: '',
      price: '',
      gstPercent: '',
      sacCode: '',
      durationMinutes: '',
      bufferTimeMinutes: '',
      waitTimeMinutes: '',
      cleanupTimeMinutes: '',
      staffIds: [] as string[],
      variants: [] as VariantRow[],
      addons: [] as AddonRow[],
      staffPrices: [] as StaffPriceRow[],
      priceRules: [] as PriceRuleRow[],
      status: 'active',
    };
  }

  private nonNegativeNumber(value: string | number) {
    const next = Number(value);
    return Number.isFinite(next) && next > 0 ? next : 0;
  }

  private numberOrZero(value: string | number) {
    const next = Number(value);
    return Number.isFinite(next) ? next : 0;
  }

  private parseDays(value: string) {
    return [...new Set(value.split(',').map((day) => Number(day.trim())).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
  }
}
