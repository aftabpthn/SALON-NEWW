import { LanguageService } from '../../core/i18n/language.service';

import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { isOpenOrderStatus, supplierCompleteness, supplierPaymentStatus, supplierPurchaseMetrics } from './supplier-metrics';

type Supplier = {
  id: string;
  code: string;
  name: string;
  gstin: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  paymentTermsDays: number;
  active: boolean;
};

type SupplierDraft = Omit<Supplier, 'id' | 'paymentTermsDays'> & {
  paymentTermsDays: number | null;
};

type PurchaseOrder = {
  id: string;
  supplierId: string;
  status: string;
  totalPaise: number;
};

type Payable = { supplierId: string; totalPaise: number; returnedPaise: number; paidPaise: number; balancePaise: number };
type SupplierPaymentMetric = { supplierId: string; paidPaise: number; unpaidPaise: number; extraPaidPaise: number };
type SupplierPaymentSummary = { paidPaise: number; unpaidPaise: number; extraPaidPaise: number; suppliers: SupplierPaymentMetric[] };
type View = 'register' | 'compliance' | 'price';
type QuickFilter = 'all' | 'gstin' | 'openPo';

@Component({
    selector: 'page-suppliers',
    imports: [FormsModule, TranslatePipe],
    templateUrl: './suppliers-page.component.html',
    styleUrls: ['./suppliers-page.component.css']
})
export class SuppliersPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  suppliers: Supplier[] = [];
  orders: PurchaseOrder[] = [];
  payables: Payable[] = [];
  paymentSummary: SupplierPaymentSummary = this.emptyPaymentSummary();
  ordersLoaded = false;
  view: View = 'register';
  quickFilter: QuickFilter = 'all';
  searchTerm = '';
  statusFilter: 'all' | 'active' | 'inactive' = 'all';
  loading = true;
  saving = false;
  error = '';
  notice = '';
  drawerOpen = false;
  editingSupplierId = '';
  draft = this.emptyDraft();

  ngOnInit() {
    void this.reload();
  }

  get filteredSuppliers() {
    const query = this.searchTerm.trim().toLowerCase();
    return this.suppliers.filter((supplier) => {
      const matchesStatus = this.statusFilter === 'all'
        || (this.statusFilter === 'active' ? supplier.active : !supplier.active);
      const matchesSearch = !query || [
        supplier.name,
        supplier.code,
        supplier.gstin,
        supplier.contactName,
        supplier.phone,
        supplier.email,
      ].some((value) => value.toLowerCase().includes(query));
      const metrics = this.metricsFor(supplier.id);
      const matchesQuickFilter = this.quickFilter === 'all'
        || (this.quickFilter === 'gstin' ? !supplier.gstin.trim() : metrics.openOrders > 0);
      return matchesStatus && matchesSearch && matchesQuickFilter;
    });
  }

  get activeCount() {
    return this.suppliers.filter((supplier) => supplier.active).length;
  }

  get atRiskCount() {
    return this.suppliers.filter((supplier) => supplier.active && this.score(supplier) < 75).length;
  }

  get openOrderCount() {
    return this.ordersLoaded ? this.orders.filter((order) => isOpenOrderStatus(order.status)).length : '—';
  }

  openOrdersFor(supplierId: string) {
    return this.ordersLoaded ? this.metricsFor(supplierId).openOrders : '—';
  }

  async reload() {
    this.loading = true;
    this.error = '';
    this.ordersLoaded = false;
    try {
      this.suppliers = await this.get<Supplier[]>('/purchases/suppliers');
      this.loading = false;
      void this.loadMetrics();
    } catch (error) {
      this.suppliers = [];
      this.orders = [];
      this.payables = [];
      this.paymentSummary = this.emptyPaymentSummary();
      this.ordersLoaded = false;
      this.error = this.message(error, this.language.text('inventory.message.b4783cda79'));
      this.loading = false;
    }
  }

  private async loadMetrics() {
    try {
      [this.orders, this.payables, this.paymentSummary] = await Promise.all([
        this.get<PurchaseOrder[]>('/purchases/orders'),
        this.get<Payable[]>('/purchases/payables'),
        this.get<SupplierPaymentSummary>('/purchases/payment-summary'),
      ]);
      this.ordersLoaded = true;
    } catch {
      this.orders = [];
      this.payables = [];
      this.paymentSummary = this.emptyPaymentSummary();
    }
  }

  openCreate() {
    this.editingSupplierId = '';
    this.draft = this.emptyDraft();
    this.clearFeedback();
    this.drawerOpen = true;
  }

  openEdit(supplier: Supplier) {
    this.editingSupplierId = supplier.id;
    this.draft = {
      code: supplier.code,
      name: supplier.name,
      gstin: supplier.gstin,
      contactName: supplier.contactName,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.address,
      paymentTermsDays: supplier.paymentTermsDays,
      active: supplier.active,
    };
    this.clearFeedback();
    this.drawerOpen = true;
  }

  closeDrawer() {
    if (!this.saving) this.drawerOpen = false;
  }

  selectView(view: View) {
    this.view = view;
    this.quickFilter = 'all';
  }

  setQuickFilter(filter: QuickFilter) {
    this.quickFilter = this.quickFilter === filter ? 'all' : filter;
  }

  score(supplier: Supplier) { return supplierCompleteness(supplier); }
  metricsFor(supplierId: string) { return supplierPurchaseMetrics(supplierId, this.orders, this.payables); }

  paymentMetricsFor(supplierId: string): SupplierPaymentMetric {
    return this.paymentSummary.suppliers.find((row) => row.supplierId === supplierId)
      ?? { supplierId, paidPaise: 0, unpaidPaise: 0, extraPaidPaise: 0 };
  }

  paymentStatus(supplierId: string) {
    return supplierPaymentStatus(this.paymentMetricsFor(supplierId));
  }

  openPayments(supplier: Supplier) {
    const metric = this.paymentMetricsFor(supplier.id);
    void this.router.navigate(['/finance/outgoing-funds'], {
      queryParams: {
        supplierPayment: metric.unpaidPaise > 0 ? 'pay' : 'view',
        supplierId: supplier.id,
      },
    });
  }
  compliance(supplier: Supplier) { const score = this.score(supplier); return score === 100 ? 'Complete' : score >= 75 ? 'Review' : 'At risk'; }
  money(paise: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((paise || 0) / 100); }

  async saveSupplier() {
    const code = this.draft.code.trim().toUpperCase();
    const name = this.titleCase(this.draft.name.trim());
    const gstin = this.draft.gstin.trim().toUpperCase();
    const paymentTermsDays = Number(this.draft.paymentTermsDays || 0);

    if ((!code && this.editingSupplierId) || !name) {
      this.error = this.language.text('inventory.message.95cc5800c3');
      return;
    }
    if (gstin && !/^[A-Z0-9]{15}$/.test(gstin)) {
      this.error = this.language.text('inventory.message.a505d1cc1c');
      return;
    }
    if (paymentTermsDays < 0 || paymentTermsDays > 3650) {
      this.error = this.language.text('inventory.message.23f19e5fba');
      return;
    }

    const payload = {
      code,
      name,
      gstin,
      contactName: this.titleCase(this.draft.contactName.trim()),
      phone: this.draft.phone.trim(),
      email: this.draft.email.trim(),
      address: this.draft.address.trim(),
      paymentTermsDays,
      active: this.draft.active,
    };

    this.saving = true;
    this.clearFeedback();
    try {
      const request = this.editingSupplierId
        ? this.api.patch<ApiEnvelope<Supplier>>(`/purchases/suppliers/${this.editingSupplierId}`, payload)
        : this.api.post<ApiEnvelope<Supplier>>('/purchases/suppliers', payload);
      const response = await firstValueFrom(request);
      if (!response.success || !response.data) {
        throw new Error(response.error?.message || 'Supplier could not be saved');
      }
      this.drawerOpen = false;
      await this.reload();
      this.notice = this.language.text('inventory.message.3c86510382');
    } catch (error) {
      this.error = this.message(error, this.language.text('inventory.message.ca25e4bd64'));
    } finally {
      this.saving = false;
    }
  }

  titleCase(value: string) {
    return value.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  }

  private async get<T>(path: string) {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path));
    if (!response.success || response.data === undefined) {
      throw new Error(response.error?.message || 'API response did not contain data');
    }
    return response.data;
  }

  private message(error: any, fallback: string) {
    return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback;
  }

  private clearFeedback() {
    this.error = '';
    this.notice = '';
  }

  private emptyDraft(): SupplierDraft {
    return {
      code: '',
      name: '',
      gstin: '',
      contactName: '',
      phone: '',
      email: '',
      address: '',
      paymentTermsDays: null,
      active: true,
    };
  }

  private emptyPaymentSummary(): SupplierPaymentSummary {
    return { paidPaise: 0, unpaidPaise: 0, extraPaidPaise: 0, suppliers: [] };
  }
}

