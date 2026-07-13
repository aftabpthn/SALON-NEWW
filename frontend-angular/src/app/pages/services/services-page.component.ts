import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

@Component({
  selector: 'page-services',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './services-page.component.html',
  styleUrls: ['./services-page.component.css'],
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
  consumptionLines: Array<{
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
  }> = [];
  readonly units = ['ml', 'gm', 'g', 'kg', 'l', 'pcs', 'tube', 'pack', 'box', 'nos'];
  services: Array<{
    id: string;
    name: string;
    category: string;
    pricePaise: number;
    durationMinutes: number;
    waitTimeMinutes: number;
    cleanupTimeMinutes: number;
    bufferTimeMinutes: number;
    gstPercent: number;
    status: string;
  }> = [];

  serviceForm = this.blankServiceForm();

  ngOnInit() {
    void this.loadServices();
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

  openAddService() {
    this.serviceForm = this.blankServiceForm();
    this.consumptionLines = [];
    this.productConsumptionOpen = false;
    this.serviceError = '';
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

  trackByIndex(index: number) {
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

      const result = await firstValueFrom(this.api.post<ApiEnvelope<unknown>>('/services', {
          name,
          category: this.serviceForm.category.trim(),
          durationMinutes: this.nonNegativeNumber(this.serviceForm.durationMinutes),
          pricePaise: Math.round(this.nonNegativeNumber(this.serviceForm.price) * 100),
          gstPercent: this.nonNegativeNumber(this.serviceForm.gstPercent),
          waitTimeMinutes: this.nonNegativeNumber(this.serviceForm.waitTimeMinutes),
          cleanupTimeMinutes: this.nonNegativeNumber(this.serviceForm.cleanupTimeMinutes),
          bufferTimeMinutes: this.nonNegativeNumber(this.serviceForm.bufferTimeMinutes),
          ...(lines.length ? { productConsumption: lines } : {}),
          active: this.serviceForm.status !== 'inactive',
        }));
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
        status: service.active === false ? 'inactive' : 'active',
      }));
    } catch {
      this.services = [];
    }
  }

  private blankServiceForm() {
    return {
      name: '',
      category: '',
      price: '',
      gstPercent: '',
      durationMinutes: '',
      bufferTimeMinutes: '',
      waitTimeMinutes: '',
      cleanupTimeMinutes: '',
      status: 'active',
    };
  }

  private nonNegativeNumber(value: string | number) {
    const next = Number(value);
    return Number.isFinite(next) && next > 0 ? next : 0;
  }
}
