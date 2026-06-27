import { Injectable } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { ApiRecord, ApiService } from './api.service';
import { AppStateService } from './state/app-state.service';

export type PosPaymentMode = {
  id: string;
  label: string;
  shortcut: string;
  settlementType: 'cash' | 'digital' | 'wallet' | 'credit' | 'other';
  active: boolean;
  visibleOnInvoice: boolean;
  requiresReference: boolean;
  sortOrder: number;
  createdAt: string;
};

export type PosTipPreset = {
  id: string;
  label: string;
  amount: number;
  active: boolean;
};

export type PosMembershipPlan = {
  id: string;
  branchId?: string;
  code?: string;
  name: string;
  description?: string;
  price: number;
  discountPercent: number;
  productDiscountPercent?: number;
  planType?: 'discount' | 'prepaid_credit' | 'visit_pack' | 'service_credit' | 'combo' | 'unlimited' | 'family' | 'corporate' | 'tiered' | string;
  creditAmount?: number;
  bonusAmount?: number;
  creditUnit?: 'amount' | 'visit' | 'service' | string;
  benefitPercent?: number;
  perVisitLimitType?: 'none' | 'fixed' | 'bill_percent' | string;
  perVisitLimitValue?: number;
  serviceRestrictionType?: 'all' | 'category' | 'selected_services' | string;
  serviceRestrictionValue?: string;
  allowProductRedeem?: boolean;
  gstRate?: number;
  validityDays: number;
  includedServices?: unknown[];
  benefitRules?: Record<string, unknown>;
  status?: string;
  active: boolean;
  version?: number;
  createdAt: string;
};

export type PosHeldInvoiceDraft = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  branchId: string;
  branchName: string;
  staffId: string;
  staffName: string;
  appointmentId: string;
  invoiceDate?: string;
  items: unknown[];
  tips: unknown[];
  payments: Record<string, number>;
  bookingAdvanceAppliedAmount?: number;
  discount: number;
  discountMode?: 'amount' | 'percent';
  couponCode: string;
  creditsUsed: number;
  membershipId: string;
  benefitServiceMappings?: unknown[];
  subtotal: number;
  total: number;
  balanceDue: number;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type PosActiveBillingDraft = {
  version: 1;
  currentHoldId?: string;
  clientId: string;
  clientName: string;
  branchId: string;
  staffId: string;
  appointmentId: string;
  invoiceDate?: string;
  items: unknown[];
  tips: unknown[];
  payments: Record<string, number>;
  bookingAdvanceAppliedAmount?: number;
  discount: number;
  discountMode: 'amount' | 'percent';
  couponCode: string;
  couponResult: unknown | null;
  couponMessage: string;
  creditsUsed: number;
  membershipId: string;
  benefitServiceMappings?: unknown[];
  clientSearchText: string;
  serviceSearchText: string;
  productSearchText: string;
  selectedServiceId: string;
  selectedServiceIds: string[];
  selectedProductId: string;
  selectedProductIds: string[];
  tipDraft: { staffId: string; paymentMode: string; amount: number; note: string };
  unpaidReceiveAmount: number;
  unpaidReceiveMode: string;
  walletCreditRequested: boolean;
  updatedAt: string;
};

const DEFAULT_PAYMENT_MODES: PosPaymentMode[] = [
  { id: 'cash', label: 'Cash', shortcut: 'C', settlementType: 'cash', active: true, visibleOnInvoice: true, requiresReference: false, sortOrder: 10, createdAt: 'system' },
  { id: 'upi', label: 'UPI', shortcut: 'U', settlementType: 'digital', active: true, visibleOnInvoice: true, requiresReference: false, sortOrder: 20, createdAt: 'system' },
  { id: 'card', label: 'Card', shortcut: 'D', settlementType: 'digital', active: true, visibleOnInvoice: true, requiresReference: false, sortOrder: 30, createdAt: 'system' },
  { id: 'wallet', label: 'Wallet', shortcut: 'W', settlementType: 'wallet', active: true, visibleOnInvoice: true, requiresReference: false, sortOrder: 40, createdAt: 'system' }
];

const DEFAULT_TIP_PRESETS: PosTipPreset[] = [
  { id: 'tip_50', label: '₹50', amount: 50, active: true },
  { id: 'tip_100', label: '₹100', amount: 100, active: true },
  { id: 'tip_200', label: '₹200', amount: 200, active: true }
];

const DEFAULT_MEMBERSHIP_PLANS: PosMembershipPlan[] = [
  { id: 'membership_20', name: 'Aura Silver 20%', price: 1999, discountPercent: 20, validityDays: 365, active: true, createdAt: 'system' },
  { id: 'membership_30', name: 'Aura Gold 30%', price: 2999, discountPercent: 30, validityDays: 365, active: true, createdAt: 'system' },
  { id: 'membership_40', name: 'Aura Platinum 40%', price: 3999, discountPercent: 40, validityDays: 365, active: true, createdAt: 'system' }
];

@Injectable({ providedIn: 'root' })
export class PosSettingsService {
  constructor(private readonly state: AppStateService, private readonly api: ApiService) {}

  loadPaymentModes(): PosPaymentMode[] {
    const stored = this.read<PosPaymentMode[]>('paymentModes', []);
    return this.mergePaymentModes(stored);
  }

  savePaymentModes(modes: PosPaymentMode[]): void {
    this.write('paymentModes', modes);
  }

  loadPaymentModesRemote(): Observable<PosPaymentMode[]> {
    return this.api.list<ApiRecord>('pos/settings/payment-modes').pipe(
      map((response) => this.mergePaymentModes(response?.['paymentModes'] as PosPaymentMode[] | undefined)),
      tap((modes) => this.savePaymentModes(modes)),
      catchError(() => of(this.loadPaymentModes()))
    );
  }

  savePaymentModesRemote(modes: PosPaymentMode[]): Observable<PosPaymentMode[]> {
    const paymentModes = this.mergePaymentModes(modes);
    this.savePaymentModes(paymentModes);
    return this.api.put<ApiRecord>('pos/settings/payment-modes', { paymentModes }).pipe(
      map((response) => this.mergePaymentModes(response?.['paymentModes'] as PosPaymentMode[] | undefined)),
      tap((savedModes) => this.savePaymentModes(savedModes)),
      catchError(() => of(paymentModes))
    );
  }

  loadTipPresets(): PosTipPreset[] {
    const stored = this.read<PosTipPreset[]>('tipPresets', []);
    const merged = [...DEFAULT_TIP_PRESETS];
    for (const preset of stored) {
      const existing = merged.find((item) => item.id === preset.id);
      if (existing) Object.assign(existing, preset);
      else merged.push(preset);
    }
    return merged.filter((preset) => Number(preset.amount || 0) > 0);
  }

  saveTipPresets(presets: PosTipPreset[]): void {
    this.write('tipPresets', presets);
  }

  loadMembershipPlans(): PosMembershipPlan[] {
    const stored = this.read<PosMembershipPlan[]>('membershipPlans', []);
    const merged = [...DEFAULT_MEMBERSHIP_PLANS];
    for (const plan of stored) {
      const existing = merged.find((item) => item.id === plan.id);
      if (existing) Object.assign(existing, plan);
      else merged.push(plan);
    }
    return merged.filter((plan) => Number(plan.price || 0) >= 0 && Number(plan.discountPercent || 0) >= 0);
  }

  saveMembershipPlans(plans: PosMembershipPlan[]): void {
    this.write('membershipPlans', plans);
  }

  loadHeldInvoices(): PosHeldInvoiceDraft[] {
    return this.read<PosHeldInvoiceDraft[]>('heldInvoices', [])
      .filter((draft) => draft?.id)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  getHeldInvoice(id: string): PosHeldInvoiceDraft | undefined {
    return this.loadHeldInvoices().find((draft) => draft.id === id);
  }

  upsertHeldInvoice(draft: PosHeldInvoiceDraft): void {
    const drafts = this.loadHeldInvoices();
    const next = [draft, ...drafts.filter((item) => item.id !== draft.id)].slice(0, 100);
    this.write('heldInvoices', next);
  }

  deleteHeldInvoice(id: string): void {
    this.write('heldInvoices', this.loadHeldInvoices().filter((draft) => draft.id !== id));
  }

  clearHeldInvoices(): void {
    this.write('heldInvoices', []);
  }

  loadActiveBillingDraft(): PosActiveBillingDraft | null {
    const draft = this.read<PosActiveBillingDraft | null>('activeBillingDraft', null);
    return draft?.version === 1 ? draft : null;
  }

  saveActiveBillingDraft(draft: PosActiveBillingDraft): void {
    this.write('activeBillingDraft', draft);
  }

  clearActiveBillingDraft(): void {
    try {
      globalThis.localStorage?.removeItem(this.storageKey('activeBillingDraft'));
    } catch {
      // Local draft persistence should never block POS billing.
    }
  }

  modeId(label: string): string {
    const slug = String(label || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return slug || `mode_${Date.now()}`;
  }

  private storageKey(kind: string): string {
    const tenantId = this.state.selectedTenantId() || 'tenant_aura';
    const branchId = this.state.selectedBranchId() || 'all';
    return `aura.pos.${kind}.${tenantId}.${branchId}`;
  }

  private mergePaymentModes(stored: PosPaymentMode[] | undefined): PosPaymentMode[] {
    const merged = [...DEFAULT_PAYMENT_MODES];
    for (const mode of stored || []) {
      const existing = merged.find((item) => item.id === mode.id);
      if (existing) Object.assign(existing, mode);
      else merged.push(mode);
    }
    return merged.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }

  private read<T>(kind: string, fallback: T): T {
    try {
      const raw = globalThis.localStorage?.getItem(this.storageKey(kind));
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private write(kind: string, value: unknown): void {
    try {
      globalThis.localStorage?.setItem(this.storageKey(kind), JSON.stringify(value));
    } catch {
      // Local settings are a convenience layer; checkout still works with defaults.
    }
  }
}
