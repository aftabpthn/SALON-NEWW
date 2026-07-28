import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../shared/services/api.service';
import { PosRealtimeService } from '../../core/services/pos-realtime.service';
import { printInvoiceDocument } from '../../shared/utils/safe-invoice-print';
import { Subscription } from 'rxjs';

type LineType = 'service' | 'product' | 'membership' | 'package' | 'gift_card' | 'custom';
type CatalogLineType = 'service' | 'product';
type AddonSaleType = 'membership' | 'package' | 'gift_card';
type DiscountType = 'amount' | 'percent';
type SaleStatus = 'draft' | 'finalized';
type BalanceSettlement = 'unpaid' | 'round_off';

interface SettlementDiscountPlan {
  allocations: Map<string, number>;
  discountPaise: number;
  totalPaise: number;
  error: string;
}

interface PosLine {
  id: string;
  lineType: LineType;
  itemId: string | number | null;
  itemName: string;
  itemSearchText: string;
  staffSearchText: string;
  customName: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  discountType: DiscountType;
  discountSource: string;
  taxPercent: string;
  staffId: string | number | null;
  staffSplits: StaffSplit[];
}

interface StaffSplit { staffId: string | number | null; staffName: string; percent: string; }
interface ClientKpi {
  walletPaise: number;
  unpaidPaise: number;
  membershipAssignDate: string | null;
  membershipExpireDate: string | null;
  hasActiveMembership: boolean;
  membershipDiscountPercent: number;
  membershipServiceIds: string[];
  rewardPointsBalance: number;
  membershipCredits: MembershipRedeemRow[];
  packageCredits: PackageRedeemRow[];
}

interface MembershipRedeemRow {
  id: string;
  membershipId: string;
  membershipName: string;
  serviceId: string;
  serviceName: string;
  pendingQty: number;
  redeemQty: string;
  staffId: string | number | null;
  staffName: string;
  expiresAt: string | null;
}

interface PackageRedeemRow {
  id: string;
  packageId: string;
  packageName: string;
  serviceId: string;
  serviceName: string;
  pendingQty: number;
  redeemQty: string;
  staffId: string | number | null;
  staffName: string;
  expiresAt: string | null;
}

interface PaymentMode { code: string; label: string; balancePaise?: number; referenceRequired: boolean; }
interface GiftCardLookup {
  id: string;
  code: string;
  clientId: string;
  clientName: string;
  initialAmountPaise: number;
  balancePaise: number;
  status: string;
  expiresAt: string | null;
}
interface CouponPreview { code: string; discountPaise: number; taxPaise: number; totalPaise: number; key: string; }
interface QuickClient { name: string; phone: string; email: string; birthday: string; anniversary: string; tags: string; notes: string; }
interface OfflineCheckout {
  operationId: string;
  checkout: any;
  createdAt: string;
  status: 'pending' | 'conflict';
  lastError: string;
}
interface PosPackageSettings { pricingPayment: { taxApplicable: boolean; taxInclusive: boolean }; packageCatalog: { salesEnabled: boolean; visibleInPos: boolean }; }
interface PosMembershipSettings {
  membershipCatalog: { membershipSalesEnabled: boolean; visibleInPos: boolean; freeMembershipEnabled: boolean; paidMembershipEnabled: boolean };
  creditsBenefits: { rewardPointsEnabled: boolean; rewardPointValuePaise: number; discountBenefitsEnabled: boolean; allowBenefitStacking: boolean };
  paymentBilling: { allowDueOnMembershipSale: boolean; membershipTaxApplicable: boolean; taxInclusiveMembershipPrice: boolean };
  redemptionRules: { blockRedemptionWhenExpired: boolean; requireStaffConfirmation: boolean; allowPartialCredits: boolean; allowFamilySharing: boolean };
  renewalExpiry: { expiredBenefitAction: string };
}

@Component({
    selector: 'app-pos-page',
    imports: [CommonModule, FormsModule, RouterLink],
    templateUrl: './pos-page.component.html',
    styleUrls: ['./pos-page.component.css']
})
export class PosPageComponent implements OnInit, OnDestroy {
  clients: any[] = [];
  staff: any[] = [];
  services: any[] = [];
  products: any[] = [];
  memberships: any[] = [];
  packages: any[] = [];
  membershipSettings: PosMembershipSettings = {
    membershipCatalog: { membershipSalesEnabled: true, visibleInPos: true, freeMembershipEnabled: true, paidMembershipEnabled: true },
    creditsBenefits: { rewardPointsEnabled: true, rewardPointValuePaise: 100, discountBenefitsEnabled: true, allowBenefitStacking: false },
    paymentBilling: { allowDueOnMembershipSale: true, membershipTaxApplicable: true, taxInclusiveMembershipPrice: false },
    redemptionRules: { blockRedemptionWhenExpired: true, requireStaffConfirmation: true, allowPartialCredits: true, allowFamilySharing: true },
    renewalExpiry: { expiredBenefitAction: 'block' },
  };
  packageSettings: PosPackageSettings = { pricingPayment: { taxApplicable: true, taxInclusive: false }, packageCatalog: { salesEnabled: true, visibleInPos: true } };
  appointments: any[] = [];
  paymentMethods: PaymentMode[] = [];
  paymentInputs: Record<string, string> = {};
  cashTills: Array<{ id: string; tillName: string; tillCode: string; status: string }> = [];
  selectedCashTillId = '';
  terminals: Array<{ id: string; terminalName: string; terminalCode: string; status: string; activeSessionId: string | null }> = [];
  selectedTerminalId = '';

  selectedClientId: string | number | null = null;
  selectedStaffId: string | number | null = null;
  clientSearchText = '';
  staffSearchText = '';
  clientSearchActive = false;
  staffSearchActive = false;
  activeLineItemId: string | null = null;
  activeLineStaffId: string | null = null;
  quickClient: QuickClient = this.emptyQuickClient();
  quickClientOpen = false;
  quickClientSaving = false;
  quickClientError = '';
  quickServiceSearch = '';
  quickProductSearch = '';
  quickServiceActive = false;
  quickProductActive = false;
  quickServiceSelections: any[] = [];
  quickProductSelections: any[] = [];
  catalogPickerType: CatalogLineType | null = null;
  catalogPickerSearch = '';
  selectedMembershipId = '';
  selectedPackageId = '';
  giftCardAmount = '';
  giftCardPaymentCode = '';
  verifiedGiftCard: GiftCardLookup | null = null;
  giftCardLookupLoading = false;
  giftCardLookupError = '';
  activeAddonSale: AddonSaleType | null = null;
  private readonly catalogPickerSelection = new Set<string>();

  branchName = this.readStoredBranchName();
  invoiceDate = this.toDisplayDate(new Date());
  source = 'Counter';
  reference = '';
  billDiscount = '';
  billDiscountType: DiscountType = 'amount';
  couponCode = '';
  couponPreview: CouponPreview | null = null;
  couponApplying = false;
  couponError = '';
  tipAmount = '';
  walletCreditAmount = '';
  unpaidReceiveAmount = '';
  unpaidReceiveMethod = '';
  unpaidReceiveReference = '';
  unpaidReceiveLoading = false;
  unpaidReceiveMessage = '';
  private unpaidReceiveIdempotencyKey = '';
  bookingAdvancePaise = 0;
  rewardPointsToRedeem = '';
  roundTotal = false;
  balanceSettlement: BalanceSettlement = 'unpaid';

  saleLines: PosLine[] = [];
  clientKpi: ClientKpi = this.emptyKpi();
  membershipRedeemRows: MembershipRedeemRow[] = [];
  packageRedeemRows: PackageRedeemRow[] = [];
  selectedSale: any | null = null;
  draftId: string | null = null;
  message = '';
  error = '';
  saving = false;
  isOnline = navigator.onLine;
  offlineCheckouts: OfflineCheckout[] = [];
  syncingOffline = false;
  private lineSeed = 1;
  private clientSearchRequest = 0;
  private appointmentIdFromRoute = '';
  private membershipPrefillApplied = false;
  private membershipSettingsLoaded = false;
  private workingDraftCommitted = false;
  private liveUpdates?: Subscription;
  private heartbeatTimer = 0;

  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute, private readonly router: Router, private readonly realtime: PosRealtimeService, private readonly auth: AuthService) {}

  ngOnInit(): void {
    this.refreshBranchName();
    this.loadOfflineCheckouts();
    this.syncOfflineCheckouts();
    const draftId = this.route.snapshot.queryParamMap.get('draft');
    const appointmentDraftId = this.route.snapshot.queryParamMap.get('appointmentDraftId');
    const autoHoldWorkingDraft = !!appointmentDraftId && this.takePendingPosAutoHold();
    this.appointmentIdFromRoute = appointmentDraftId ? '' : this.route.snapshot.queryParamMap.get('appointmentId') || '';
    if (!draftId && !this.appointmentIdFromRoute && !appointmentDraftId) this.restoreWorkingDraft();
    this.reference = this.route.snapshot.queryParamMap.get('reference') || this.reference;
    this.loadClients();
    this.loadStaff();
    this.loadServices();
    this.loadProducts();
    this.loadMembershipSettings();
    this.loadMemberships();
    this.loadPackages();
    this.loadPackageSettings();
    this.loadAppointments();
    this.loadPaymentMethods();
    this.loadCashTills();
    this.loadTerminals();
    if (draftId) this.restoreHeldInvoice(draftId);
    if (appointmentDraftId) {
      if (autoHoldWorkingDraft && this.restoreWorkingDraft()) {
        if (this.canSave) this.holdInvoice(() => {
          this.draftId = null;
          this.restoreAppointmentDraft(appointmentDraftId);
        });
        else this.error = 'Current POS bill could not be held automatically';
      } else {
        this.restoreAppointmentDraft(appointmentDraftId);
      }
    }
    this.liveUpdates = this.realtime.events().subscribe((event) => {
      if (event.entityType === 'terminal') this.loadTerminals();
      if (event.entityType === 'invoice' && event.entityId === this.draftId && !this.saving) this.restoreHeldInvoice(event.entityId);
    });
    this.heartbeatTimer = window.setInterval(() => this.sendTerminalHeartbeat(), 30_000);
  }

  ngOnDestroy(): void {
    this.persistWorkingDraft();
    this.liveUpdates?.unsubscribe();
    window.clearInterval(this.heartbeatTimer);
  }

  @HostListener('window:beforeunload')
  persistWorkingDraftBeforeUnload(): void { this.persistWorkingDraft(); }

  @HostListener('window:storage', ['$event'])
  handleStorageEvent(event: StorageEvent): void {
    if (event.key !== this.posAutoHoldStorageKey() || !event.newValue || !this.canSave || this.draftId) return;
    this.holdInvoice();
  }

  @HostListener('window:online')
  handleOnline(): void { this.isOnline = true; this.syncOfflineCheckouts(); }

  @HostListener('window:offline')
  handleOffline(): void { this.isOnline = false; }

  get selectedClient(): any | null { return this.clients.find((c) => String(c.id) === String(this.selectedClientId)) ?? null; }
  get subtotalPaise(): number { return this.saleLines.reduce((s, l) => s + this.lineSubtotalPaise(l), 0); }
  get lineDiscountPaise(): number { return this.saleLines.reduce((s, line) => s + this.lineDiscountPaiseValue(line), 0); }
  get manualBillDiscountPaise(): number {
    const base = Math.max(0, this.subtotalPaise - this.lineDiscountPaise);
    const value = this.num(this.billDiscount);
    if (!value) return 0;
    return this.billDiscountType === 'percent' ? Math.min(base, Math.round((base * value) / 100)) : Math.min(base, this.toPaise(value));
  }
  get rewardDiscountPaise(): number {
    const requested = Math.floor(this.num(this.rewardPointsToRedeem)) * Math.max(0, this.num(this.membershipSettings.creditsBenefits.rewardPointValuePaise));
    return Math.min(Math.max(0, this.subtotalPaise - this.lineDiscountPaise - this.manualBillDiscountPaise), requested);
  }
  get billDiscountPaise(): number { return this.manualBillDiscountPaise + this.rewardDiscountPaise; }
  get gstPaise(): number { return this.activeCouponPreview()?.taxPaise ?? this.saleLines.reduce((s, l) => s + this.lineGstPaise(l), 0); }
  get tipPaise(): number { return this.toPaise(this.num(this.tipAmount)); }
  get totalBeforeRoundPaise(): number { return Math.max(0, this.subtotalPaise - this.lineDiscountPaise - this.billDiscountPaise + this.gstPaise + this.tipPaise); }
  get totalPaise(): number { return this.activeCouponPreview()?.totalPaise ?? (this.roundTotal ? Math.round(this.totalBeforeRoundPaise / 100) * 100 : this.totalBeforeRoundPaise); }
  get couponDiscountPaise(): number { return this.activeCouponPreview()?.discountPaise ?? 0; }
  get paidNowPaise(): number { return this.paymentMethods.reduce((s, m) => s + this.toPaise(this.num(this.paymentInputs[m.code])), 0); }
  get invoicePaidPaise(): number { return Math.min(this.totalPaise, this.bookingAdvanceAppliedPaise + this.paidNowPaise); }
  get balanceDuePaise(): number { return Math.max(0, this.totalPaise - this.invoicePaidPaise); }
  get partialBalancePaise(): number { const baseTotal = this.baseTotalPaise(); return Math.max(0, baseTotal - this.bookingAdvanceAppliedPaise - Math.min(baseTotal, this.paidNowPaise)); }
  get roundOffDiscountPaise(): number { return this.activeSettlementPlan().discountPaise; }
  get roundOffError(): string { return this.balanceSettlement === 'round_off' ? this.activeSettlementPlan().error : ''; }
  get bookingAdvanceAppliedPaise(): number { return Math.min(this.totalPaise, Math.max(0, this.bookingAdvancePaise)); }
  get walletCreditPaise(): number {
    return this.toPaise(this.num(this.walletCreditAmount));
  }
  get unappliedOverpayPaise(): number { return Math.max(0, this.paidNowPaise - Math.max(0, this.totalPaise - this.bookingAdvanceAppliedPaise) - this.walletCreditPaise); }
  get advanceAdjustedPaise(): number { return this.bookingAdvanceAppliedPaise; }
  get canSave(): boolean { return !this.saving && (this.saleLines.some((line) => this.isLineReady(line)) || this.membershipRedeemCount() > 0 || this.packageRedeemCount() > 0) && !this.roundOffError && !this.hasInvalidStaffSplit() && !this.hasInvalidMembershipRedemption() && !this.hasInvalidPackageRedemption() && !this.hasInvalidRewardRedemption() && !this.couponApplicationError() && !this.walletRedemptionError() && !this.giftCardRedemptionError() && !this.paymentAllocationError(); }
  get itemCount(): number { return this.saleLines.filter((line) => this.isLineReady(line)).length; }
  get offlineConflictCount(): number { return this.offlineCheckouts.filter((item) => item.status === 'conflict').length; }
  get offlineConflictMessage(): string { return this.offlineCheckouts.find((item) => item.status === 'conflict')?.lastError || ''; }
  get membershipSalesVisible(): boolean { return this.membershipSettingsLoaded && this.membershipSettings.membershipCatalog.membershipSalesEnabled && this.membershipSettings.membershipCatalog.visibleInPos; }
  get posMemberships(): any[] { return this.memberships.filter((plan) => this.membershipPlanAllowed(plan)); }
  get giftCardPaymentPaise(): number { return this.toPaise(this.num(this.paymentInputs['gift_card'])); }

  incrementLineQty(line: PosLine): void {
    line.quantity = String(Math.max(1, this.num(line.quantity) + 1));
  }

  decrementLineQty(line: PosLine): void {
    line.quantity = String(Math.max(1, this.num(line.quantity) - 1));
  }

  clearSaleLines(): void {
    this.saleLines = [];
    this.balanceSettlement = 'unpaid';
    this.clearWorkingDraft();
  }

  loadClients(): void { this.loadList('/api/v1/clients', (rows) => { this.clients = rows; const routeClientId = this.route.snapshot.queryParamMap.get('clientId'); if (routeClientId && !this.selectedClientId) this.onClientChange(routeClientId); const client = rows.find((item) => String(item.id) === String(this.selectedClientId)); if (client) this.clientSearchText = this.recordName(client); this.applyMembershipFromRoute(); this.applyAppointmentFromRoute(); }); }
  loadServices(): void { this.loadList('/api/v1/services', (rows) => { this.services = rows; this.applyAppointmentFromRoute(); }); }
  loadProducts(): void { this.loadList('/api/v1/products', (rows) => (this.products = rows)); }
  loadMemberships(): void { this.loadList('/api/v1/memberships', (rows) => { this.memberships = rows.filter((item) => item.active !== false); this.applyMembershipFromRoute(); }); }
  loadMembershipSettings(): void {
    this.api.get<any>('/membership-enterprise/settings').subscribe({
      next: (response) => {
        const value = response?.data ?? response;
        this.membershipSettings = {
          membershipCatalog: { ...this.membershipSettings.membershipCatalog, ...(value?.membershipCatalog ?? {}) },
          creditsBenefits: { ...this.membershipSettings.creditsBenefits, ...(value?.creditsBenefits ?? {}) },
          paymentBilling: { ...this.membershipSettings.paymentBilling, ...(value?.paymentBilling ?? {}) },
          redemptionRules: { ...this.membershipSettings.redemptionRules, ...(value?.redemptionRules ?? {}) },
          renewalExpiry: { ...this.membershipSettings.renewalExpiry, ...(value?.renewalExpiry ?? {}) },
        };
        this.membershipSettingsLoaded = true;
        if (!this.membershipSalesVisible || !this.posMemberships.some((plan) => String(plan.id) === String(this.selectedMembershipId))) this.selectedMembershipId = '';
        this.applyMembershipFromRoute();
      },
      error: () => {
        this.membershipSettingsLoaded = true;
        this.applyMembershipFromRoute();
      },
    });
  }
  loadPackages(): void { this.loadList('/api/v1/packages', (rows) => (this.packages = this.packageSettings.packageCatalog.salesEnabled && this.packageSettings.packageCatalog.visibleInPos ? rows.filter((item) => item.active !== false) : [])); }
  loadPackageSettings(): void {
    this.api.get<any>('/package-enterprise/settings').subscribe({
      next: (response) => {
        const value = response?.data ?? response;
        this.packageSettings = {
          pricingPayment: { ...this.packageSettings.pricingPayment, ...(value?.pricingPayment ?? {}) },
          packageCatalog: { ...this.packageSettings.packageCatalog, ...(value?.packageCatalog ?? {}) },
        };
        if (!this.packageSettings.packageCatalog.salesEnabled || !this.packageSettings.packageCatalog.visibleInPos) this.packages = [];
      },
    });
  }
  loadAppointments(): void { this.loadList('/api/v1/appointments', (rows) => { this.appointments = rows; this.applyAppointmentFromRoute(); }); }
  loadStaff(): void {
    this.loadList('/api/v1/staff', (rows) => {
      this.staff = rows;
      if (!this.selectedStaffId && rows.length) {
        this.selectedStaffId = rows[0].id;
        this.staffSearchText = this.recordName(rows[0]);
        this.saleLines.forEach((line) => {
          line.staffId = this.selectedStaffId;
          line.staffSearchText = this.staffSearchText;
        });
      }
      this.applyAppointmentFromRoute();
    });
  }

  loadPaymentMethods(): void {
    this.api.get<any>('/pos/payment-methods').subscribe({
      next: (res: any) => {
        const modes = this.list(res).map((m) => this.paymentMode(m)).filter(Boolean) as PaymentMode[];
        this.paymentMethods = modes;
        if (!this.paymentMethods.some((mode) => mode.code === this.unpaidReceiveMethod)) this.unpaidReceiveMethod = this.paymentMethods[0]?.code ?? '';
        this.ensurePaymentInputs();
      },
      error: () => { this.paymentMethods = []; this.ensurePaymentInputs(); },
    });
  }

  loadCashTills(): void {
    this.api.get<any>('/api/v1/pos/cash-drawer/current').subscribe({
      next: (response) => {
        const session = response?.data ?? response;
        if (!session?.id || session.status !== 'open') { this.cashTills = []; this.selectedCashTillId = ''; return; }
        this.api.get<any>(`/api/v1/pos/cash-drawer/${session.id}/tills`).subscribe({
          next: (result) => {
            const rows = result?.data ?? result;
            this.cashTills = (Array.isArray(rows) ? rows : []).filter((row) => row.status === 'open');
            if (!this.cashTills.some((row) => row.id === this.selectedCashTillId)) this.selectedCashTillId = this.cashTills.length === 1 ? this.cashTills[0].id : '';
          },
          error: () => { this.cashTills = []; this.selectedCashTillId = ''; },
        });
      },
      error: () => { this.cashTills = []; this.selectedCashTillId = ''; },
    });
  }

  loadTerminals(): void {
    this.api.get<any>('/api/v1/pos/terminals').subscribe({
      next: (response) => {
        const rows = response?.data ?? response;
        this.terminals = (Array.isArray(rows) ? rows : []).filter((row) => row.status === 'active');
        if (!this.terminals.some((row) => row.id === this.selectedTerminalId)) {
          const active = this.terminals.filter((row) => !!row.activeSessionId);
          this.selectedTerminalId = active.length === 1 ? active[0].id : this.terminals.length === 1 ? this.terminals[0].id : '';
        }
      },
      error: () => { this.terminals = []; this.selectedTerminalId = ''; },
    });
  }

  private sendTerminalHeartbeat(): void {
    if (!this.isOnline || !this.selectedTerminalId) return;
    this.api.post(`/api/v1/pos/terminals/${this.selectedTerminalId}/heartbeat`, {}).subscribe({ error: () => undefined });
  }

  setClientSearch(value: string): void {
    this.clientSearchText = value;
    this.clientSearchActive = true;
    this.quickClientOpen = false;
    const query = value.trim();
    if (!query) {
      this.onClientChange(null);
      return;
    }
    if (query.length < 3) return;

    const request = ++this.clientSearchRequest;
    this.api.get<any>(`/api/v1/clients?q=${encodeURIComponent(query)}&pageSize=25`).subscribe({
      next: (res: any) => {
        if (request === this.clientSearchRequest) this.clients = this.list(res).filter((item) => item?.id != null);
      },
      error: () => undefined,
    });
  }

  selectClient(client: any): void {
    this.clientSearchText = this.recordName(client);
    this.clientSearchActive = false;
    this.onClientChange(client.id);
  }

  setHeaderStaffSearch(value: string): void {
    this.staffSearchText = value;
    this.staffSearchActive = true;
    if (!value.trim()) this.selectedStaffId = null;
  }

  selectHeaderStaff(person: any): void {
    this.selectedStaffId = person.id;
    this.staffSearchText = this.recordName(person);
    this.staffSearchActive = false;
  }

  setCompletedAppointment(appointmentId: string): void {
    this.source = appointmentId ? 'appointment' : 'Counter';
    this.reference = appointmentId;
    this.bookingAdvancePaise = 0;
    if (appointmentId) this.loadBookingAdvance(appointmentId);
    const appointment = this.appointments.find((item) => String(item.id) === String(appointmentId));
    if (!appointment) return;
    const clientId = appointment.clientId ?? appointment.client_id ?? appointment.customerId ?? appointment.customer_id ?? null;
    const staffId = appointment.staffId ?? appointment.staff_id ?? null;
    const client = this.clients.find((item) => String(item.id) === String(clientId));
    const person = this.staff.find((item) => String(item.id) === String(staffId));
    if (client) this.selectClient(client);
    else if (clientId) this.onClientChange(clientId);
    if (person) this.selectHeaderStaff(person);
    else if (staffId) this.selectedStaffId = staffId;

    const bookingGroupId = String(appointment.bookingGroupId ?? appointment.booking_group_id ?? '');
    const groupAppointments = bookingGroupId
      ? this.appointments.filter((item) =>
          String(item.bookingGroupId ?? item.booking_group_id ?? '') === bookingGroupId
          && !['cancelled', 'canceled', 'no-show'].includes(String(item.status ?? '').toLowerCase()),
        )
      : [appointment];
    const bookedLines = groupAppointments.flatMap((item) => {
      const itemStaffId = item.staffId ?? item.staff_id ?? null;
      const serviceIds = Array.isArray(item.serviceIds) ? item.serviceIds : Array.isArray(item.service_ids) ? item.service_ids : [];
      return serviceIds.map((serviceId: string | number) => ({ serviceId, staffId: itemStaffId }));
    });
    if (bookedLines.length) {
      this.saleLines = bookedLines.map(({ serviceId, staffId: lineStaffId }) => {
        const line = this.newSaleLine('service');
        const service = this.services.find((item) => String(item.id) === String(serviceId));
        const lineStaff = this.staff.find((item) => String(item.id) === String(lineStaffId));
        if (service) this.selectLineItem(line, service);
        line.staffId = lineStaffId;
        line.staffSearchText = lineStaff ? this.recordName(lineStaff) : '';
        return line;
      });
    }
  }

  private loadBookingAdvance(appointmentId: string): void {
    this.api.get<any>(`/api/v1/pos/appointments/${appointmentId}/deposit`).subscribe({
      next: (response) => {
        const data = response?.data ?? response;
        if (this.source === 'appointment' && this.reference === appointmentId) this.bookingAdvancePaise = this.firstMoney(data, ['availablePaise', 'available_paise']);
      },
      error: () => { if (this.reference === appointmentId) this.bookingAdvancePaise = 0; },
    });
  }

  private applyAppointmentFromRoute(): void {
    if (!this.appointmentIdFromRoute || !this.appointments.length || !this.clients.length || !this.staff.length || !this.services.length) return;
    this.setCompletedAppointment(this.appointmentIdFromRoute);
    this.appointmentIdFromRoute = '';
  }

  setLineItemSearch(line: PosLine, value: string): void {
    line.itemSearchText = value;
    line.itemId = null;
    line.itemName = value.trim();
    if (line.lineType === 'custom') line.customName = value;
    this.activeLineItemId = line.id;
  }

  selectLineItem(line: PosLine, item: any): void {
    line.itemId = item.id;
    line.itemName = this.recordName(item);
    line.itemSearchText = line.itemName;
    line.unitPrice = this.paiseToInput(this.pricePaise(item));
    const tax = this.firstNumber(item, ['taxPercent', 'gstPercent', 'tax_percent', 'gst_percent']);
    line.taxPercent = tax > 0 ? String(tax) : '';
    this.activeLineItemId = null;
  }

  openCatalogPicker(type: CatalogLineType): void {
    this.catalogPickerType = type;
    this.catalogPickerSearch = '';
    this.catalogPickerSelection.clear();
  }

  closeCatalogPicker(): void { this.catalogPickerType = null; this.catalogPickerSelection.clear(); }

  catalogPickerItems(): any[] {
    const rows = this.catalogPickerType === 'product' ? this.products : this.services;
    return this.ranked(rows, this.catalogPickerSearch, (item) => [this.recordName(item), item.category, item.sku, item.barcode, item.code, item.id]);
  }

  catalogPickerSelected(item: any): boolean { return this.catalogPickerSelection.has(String(item.id)); }
  catalogPickerSelectedCount(): number { return this.catalogPickerSelection.size; }

  toggleCatalogPickerItem(item: any): void {
    const id = String(item.id);
    if (this.catalogPickerSelection.has(id)) this.catalogPickerSelection.delete(id);
    else this.catalogPickerSelection.add(id);
  }

  addCatalogPickerItems(): void {
    const type = this.catalogPickerType;
    if (!type) return;
    const rows = type === 'product' ? this.products : this.services;
    const items = rows.filter((item) => this.catalogPickerSelection.has(String(item.id)));
    for (const item of items) {
      const line = this.saleLines.find((candidate) => candidate.lineType === type && !candidate.itemId && !candidate.itemSearchText) ?? this.newSaleLine(type);
      if (!this.saleLines.includes(line)) this.saleLines.push(line);
      this.selectLineItem(line, item);
    }
    this.closeCatalogPicker();
  }

  addQuickService(item?: any): void {
    if (item) { this.toggleQuickService(item); return; }
    const services = this.quickServiceSelections.length ? this.quickServiceSelections : this.filteredQuickServices().slice(0, 1);
    if (!services.length) return;
    services.forEach((service) => this.addCatalogItem('service', service));
    this.quickServiceSelections = [];
    this.quickServiceSearch = '';
    this.quickServiceActive = false;
  }

  toggleQuickService(item: any): void {
    const id = String(item?.id ?? '');
    if (!id) return;
    this.quickServiceSelections = this.isQuickServiceSelected(item)
      ? this.quickServiceSelections.filter((service) => String(service?.id) !== id)
      : [...this.quickServiceSelections, item];
  }

  isQuickServiceSelected(item: any): boolean {
    return this.quickServiceSelections.some((service) => String(service?.id) === String(item?.id));
  }

  quickServiceAddLabel(): string {
    const count = this.quickServiceSelections.length;
    return count ? `Add ${count}` : 'Add';
  }

  addQuickProduct(item?: any): void {
    if (item) { this.toggleQuickProduct(item); return; }
    const products = this.quickProductSelections.length ? this.quickProductSelections : this.filteredQuickProducts().slice(0, 1);
    if (!products.length) return;
    products.forEach((product) => this.addCatalogItem('product', product));
    this.quickProductSelections = [];
    this.quickProductSearch = '';
    this.quickProductActive = false;
  }

  toggleQuickProduct(item: any): void {
    const id = String(item?.id ?? '');
    if (!id) return;
    this.quickProductSelections = this.isQuickProductSelected(item)
      ? this.quickProductSelections.filter((product) => String(product?.id) !== id)
      : [...this.quickProductSelections, item];
  }

  isQuickProductSelected(item: any): boolean {
    return this.quickProductSelections.some((product) => String(product?.id) === String(item?.id));
  }

  quickProductAddLabel(): string {
    const count = this.quickProductSelections.length;
    return count ? `Add ${count}` : 'Add';
  }

  toggleAddonSale(type: AddonSaleType): void {
    this.activeAddonSale = this.activeAddonSale === type ? null : type;
  }

  addMembershipSale(): void {
    if (!this.membershipSalesVisible) return;
    const plan = this.posMemberships.find((item) => String(item.id) === String(this.selectedMembershipId));
    if (!plan) return;
    const displayPrice = this.membershipDisplayPrice(plan);
    const taxPercent = this.membershipTaxPercent(plan);
    this.addAddonLine('membership', plan, this.priceBeforeMembershipTax(displayPrice, taxPercent), taxPercent);
    this.selectedMembershipId = '';
    this.activeAddonSale = null;
  }

  addPackageSale(): void {
    const itemPackage = this.packages.find((item) => String(item.id) === String(this.selectedPackageId));
    if (!itemPackage) return;
    const configuredTax = this.packageSettings.pricingPayment.taxApplicable ? (this.firstNumber(itemPackage, ['gstPercent', 'taxPercent', 'gst_percent', 'tax_percent']) || 18) : 0;
    const catalogPrice = this.pricePaise(itemPackage);
    const unitPrice = this.packageSettings.pricingPayment.taxInclusive && configuredTax > 0
      ? Math.round((catalogPrice * 100) / (100 + configuredTax))
      : catalogPrice;
    this.addAddonLine('package', itemPackage, unitPrice, configuredTax);
    this.selectedPackageId = '';
    this.activeAddonSale = null;
  }

  addGiftCardSale(): void {
    if (!this.selectedClientId) { this.error = 'Select a client before selling a gift card'; return; }
    const amountPaise = this.toPaise(this.num(this.giftCardAmount));
    if (amountPaise <= 0) return;
    const code = `GC-${globalThis.crypto?.randomUUID?.().slice(0, 8).toUpperCase() || Date.now().toString().slice(-8)}`;
    this.addAddonLine('gift_card', { id: code, name: `Gift Card ${code}` }, amountPaise, 0);
    this.giftCardAmount = '';
    this.activeAddonSale = null;
  }

  setLineStaffSearch(line: PosLine, value: string): void {
    line.staffSearchText = value;
    line.staffId = null;
    this.activeLineStaffId = line.id;
  }

  selectLineStaff(line: PosLine, person: any): void {
    line.staffId = person.id;
    line.staffSearchText = this.recordName(person);
    if (line.staffSplits.length) line.staffSplits[0] = { staffId: person.id, staffName: this.recordName(person), percent: line.staffSplits[0].percent || '100' };
    this.activeLineStaffId = null;
  }

  addStaffSplit(line: PosLine): void {
    if (line.staffSplits.length) {
      line.staffSplits.push({ staffId: null, staffName: '', percent: '' });
      return;
    }
    const person = this.staff.find((item) => item.id === line.staffId);
    line.staffSplits = [
      { staffId: line.staffId, staffName: person ? this.recordName(person) : '', percent: '50' },
      { staffId: null, staffName: '', percent: '50' },
    ];
  }

  removeStaffSplit(line: PosLine, index: number): void {
    line.staffSplits = line.staffSplits.filter((_, splitIndex) => splitIndex !== index);
    if (line.staffSplits.length < 2) line.staffSplits = [];
  }

  setLineSplitStaff(line: PosLine, index: number, staffId: string): void {
    const person = this.staff.find((item) => String(item.id) === String(staffId));
    const split = line.staffSplits[index];
    if (!split) return;
    split.staffId = staffId || null;
    split.staffName = person ? this.recordName(person) : '';
    if (index === 0) {
      line.staffId = split.staffId;
      line.staffSearchText = split.staffName;
    }
  }

  setLineSplitPercent(line: PosLine, index: number, value: string): void {
    const split = line.staffSplits[index];
    if (!split) return;
    split.percent = String(Math.max(0, Math.min(100, this.num(value))));
  }

  splitPercentTotal(line: PosLine): number {
    return Math.round(line.staffSplits.reduce((sum, split) => sum + this.num(split.percent), 0));
  }

  filteredClients(): any[] {
    const phone = this.phoneDigits(this.clientSearchText);
    if (phone) {
      return this.clients
        .filter((client) => this.clientPhone(client).includes(phone))
        .sort((a, b) => Number(!this.clientPhone(a).startsWith(phone)) - Number(!this.clientPhone(b).startsWith(phone)))
        .slice(0, 8);
    }
    return this.ranked(this.clients, this.clientSearchText, (c) => [this.recordName(c), c.phone, c.mobile, c.whatsapp, c.email, c.code, c.customerCode, c.clientCode, c.id]);
  }

  filteredHeaderStaff(): any[] { return this.filteredStaff(this.staffSearchText); }
  filteredLineStaff(line: PosLine): any[] { return this.filteredStaff(line.staffSearchText); }
  filteredQuickServices(): any[] { return this.ranked(this.services, this.quickServiceSearch, (item) => [this.recordName(item), item.category, item.code, item.id]); }
  filteredQuickProducts(): any[] { return this.ranked(this.products, this.quickProductSearch, (item) => [this.recordName(item), item.category, item.brand, item.sku, item.barcode, item.code, item.id]); }

  filteredLineItems(line: PosLine): any[] {
    if (!this.isCatalogLine(line.lineType)) return [];
    const rows = line.lineType === 'service' ? this.services : this.products;
    return this.ranked(rows, line.itemSearchText, (item) => [this.recordName(item), item.category, item.sku, item.barcode, item.code, item.id]);
  }

  showClientResults(): boolean { return this.clientSearchActive && this.filteredClients().length > 0; }
  showAddClient(): boolean { return this.clientSearchActive && this.phoneDigits(this.clientSearchText).length >= 3 && !this.filteredClients().length; }
  showHeaderStaffResults(): boolean { return this.staffSearchActive && this.filteredHeaderStaff().length > 0; }
  showQuickServiceResults(): boolean { return this.quickServiceActive && this.quickServiceSearch.trim().length > 0 && this.filteredQuickServices().length > 0; }
  showQuickProductResults(): boolean { return this.quickProductActive && this.quickProductSearch.trim().length > 0 && this.filteredQuickProducts().length > 0; }
  showLineItemResults(line: PosLine): boolean { return this.activeLineItemId === line.id && this.filteredLineItems(line).length > 0; }
  showLineStaffResults(line: PosLine): boolean { return this.activeLineStaffId === line.id && this.filteredLineStaff(line).length > 0; }
  clientSearchHeading(): string { return this.normalizeSearch(this.clientSearchText).length >= 3 ? 'Matching contacts' : 'Recent contacts'; }
  closeClientSearchSoon(): void { setTimeout(() => (this.clientSearchActive = false), 120); }
  closeHeaderStaffSearchSoon(): void { setTimeout(() => (this.staffSearchActive = false), 120); }
  closeQuickServiceSearchSoon(): void { setTimeout(() => (this.quickServiceActive = false), 120); }
  closeQuickProductSearchSoon(): void { setTimeout(() => (this.quickProductActive = false), 120); }
  closeLineItemSearchSoon(line: PosLine): void { setTimeout(() => { if (this.activeLineItemId === line.id) this.activeLineItemId = null; }, 120); }
  closeLineStaffSearchSoon(line: PosLine): void { setTimeout(() => { if (this.activeLineStaffId === line.id) this.activeLineStaffId = null; }, 120); }

  onClientChange(clientId: string | number | null): void {
    const clientChanged = String(this.selectedClientId ?? '') !== String(clientId ?? '');
    if (clientChanged && (this.paidNowPaise > 0 || this.walletCreditPaise > 0)) {
      this.clearPayments();
      this.message = 'Payment selection cleared because the client changed the invoice total';
    }
    this.selectedClientId = clientId;
    this.selectedSale = null;
    this.rewardPointsToRedeem = '';
    this.unpaidReceiveAmount = '';
    this.unpaidReceiveReference = '';
    this.unpaidReceiveMessage = '';
    this.unpaidReceiveIdempotencyKey = '';
    this.refreshClientKpi(clientId);
  }

  fillClientUnpaid(): void {
    const available = this.unpaidReceiveMethod === 'wallet'
      ? Math.min(this.clientKpi.unpaidPaise, this.clientKpi.walletPaise)
      : this.clientKpi.unpaidPaise;
    this.unpaidReceiveAmount = this.paiseToInput(available);
    this.unpaidReceiveMessage = '';
    this.unpaidReceiveIdempotencyKey = '';
  }

  onUnpaidReceiveEdit(): void {
    this.unpaidReceiveMessage = '';
    this.unpaidReceiveIdempotencyKey = '';
  }

  receiveClientUnpaid(): void {
    if (!this.selectedClientId || this.unpaidReceiveLoading) return;
    const amountPaise = this.toPaise(this.num(this.unpaidReceiveAmount));
    const method = this.paymentMethods.find((mode) => mode.code === this.unpaidReceiveMethod);
    if (!method) { this.error = 'Select a payment mode'; return; }
    if (amountPaise <= 0) { this.error = 'Receive amount must be greater than zero'; return; }
    if (amountPaise > this.clientKpi.unpaidPaise) { this.error = 'Receive amount cannot exceed client unpaid balance'; return; }
    if (method.code === 'wallet' && amountPaise > this.clientKpi.walletPaise) { this.error = 'Wallet balance cannot cover this payment'; return; }
    if (method.referenceRequired && !this.unpaidReceiveReference.trim()) { this.error = `${method.label} reference is required`; return; }
    this.error = '';
    this.message = '';
    this.unpaidReceiveMessage = '';
    this.unpaidReceiveLoading = true;
    this.unpaidReceiveIdempotencyKey ||= crypto.randomUUID();
    this.api.post<any>(`/api/v1/pos/clients/${this.selectedClientId}/unpaid-payments`, {
      method: method.code,
      amountPaise,
      methodReference: this.unpaidReceiveReference.trim(),
      notes: 'Old unpaid balance received from POS',
      idempotencyKey: this.unpaidReceiveIdempotencyKey,
      cashDrawerTillId: this.selectedCashTillId || null,
    }).subscribe({
      next: (response: any) => {
        const receipt = response?.data ?? response;
        const receivedPaise = this.firstMoney(receipt, ['receivedPaise', 'received_paise']);
        const remainingPaise = this.firstMoney(receipt, ['unpaidAfterPaise', 'unpaid_after_paise']);
        const allocations = Array.isArray(receipt?.allocations) ? receipt.allocations.length : 0;
        this.unpaidReceiveMessage = `₹${this.paiseToInput(receivedPaise)} received across ${allocations} oldest invoice${allocations === 1 ? '' : 's'}. Remaining ₹${this.paiseToInput(remainingPaise)}.`;
        this.unpaidReceiveAmount = '';
        this.unpaidReceiveReference = '';
        this.unpaidReceiveIdempotencyKey = '';
        this.unpaidReceiveLoading = false;
        this.refreshClientKpi(this.selectedClientId);
      },
      error: (err: any) => {
        this.error = this.errorText(err, 'Unable to receive unpaid amount');
        this.unpaidReceiveLoading = false;
      },
    });
  }

  refreshClientKpi(clientId: string | number | null): void {
    if (!clientId) { this.clientKpi = this.emptyKpi(); this.membershipRedeemRows = []; this.packageRedeemRows = []; return; }
    if (this.selectedClient) this.clientKpi = this.kpiFrom(this.selectedClient);
    this.api.get<any>(`/api/v1/pos/clients/${clientId}/kpi`).subscribe({
      next: (res: any) => {
        const totalBeforeBenefits = this.totalPaise;
        const kpi = res?.data?.kpi ?? res?.data ?? res?.kpi ?? res;
        this.clientKpi = this.kpiFrom(kpi);
        this.membershipRedeemRows = this.clientKpi.membershipCredits;
        this.packageRedeemRows = this.clientKpi.packageCredits;
        if (this.paidNowPaise > 0 && this.totalPaise !== totalBeforeBenefits) {
          this.clearPayments();
          this.message = 'Payment selection cleared because client benefits changed the invoice total';
        }
      },
      error: () => undefined,
    });
  }

  walkInClient(): void { this.clientSearchText = 'Walk-in client'; this.clientSearchActive = false; this.onClientChange(null); }

  openQuickClient(): void {
    this.quickClient = { ...this.emptyQuickClient(), phone: this.phoneDigits(this.clientSearchText) };
    this.quickClientError = '';
    this.quickClientOpen = true;
    this.clientSearchActive = false;
  }

  closeQuickClient(): void { this.quickClientOpen = false; this.quickClientError = ''; }
  setQuickClientName(value: string): void { this.quickClient.name = this.titleCase(value); }

  saveQuickClient(): void {
    const name = this.quickClient.name.trim();
    const phone = this.phoneDigits(this.quickClient.phone);
    if (!name || !phone) { this.quickClientError = 'Name and mobile number required'; return; }
    this.quickClientSaving = true;
    this.quickClientError = '';
    this.api.post<any>('/api/v1/clients', {
      firstName: name,
      phone,
      email: this.quickClient.email.trim(),
      birthday: this.optionalDisplayDateToIso(this.quickClient.birthday),
      anniversary: this.optionalDisplayDateToIso(this.quickClient.anniversary),
      categories: this.quickClient.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      notes: this.quickClient.notes.trim(),
    }).subscribe({
      next: () => {
        this.loadList('/api/v1/clients', (rows) => {
          this.clients = rows;
          const client = rows.find((item) => this.clientPhone(item) === phone);
          if (client) this.selectClient(client);
        });
        this.quickClientOpen = false;
        this.quickClientSaving = false;
        this.message = 'Client added';
      },
      error: (err: any) => { this.quickClientError = err?.error?.message ?? err?.message ?? 'Client save failed'; this.quickClientSaving = false; },
    });
  }

  scrollToTipRegister(): void {
    document.getElementById('tip-register')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  addSaleLine(lineType: LineType = 'service'): void {
    this.saleLines.push(this.newSaleLine(lineType));
  }

  removeSaleLine(line: PosLine): void {
    this.saleLines = this.saleLines.filter((item) => item.id !== line.id);
  }

  packageRedeemCount(): number { return this.packageRedeemRows.reduce((sum, row) => sum + Math.max(0, this.num(row.redeemQty)), 0); }
  membershipRedeemCount(): number { return this.membershipRedeemRows.reduce((sum, row) => sum + Math.max(0, this.num(row.redeemQty)), 0); }

  setMembershipRedeemQty(row: MembershipRedeemRow, value: string): void {
    const requested = Math.max(0, Math.min(row.pendingQty, this.num(value)));
    row.redeemQty = String(!this.membershipSettings.redemptionRules.allowPartialCredits && requested > 0 ? row.pendingQty : requested);
  }

  setMembershipRedeemStaff(row: MembershipRedeemRow, staffId: string): void {
    const person = this.staff.find((item) => String(item.id) === String(staffId));
    row.staffId = staffId || null;
    row.staffName = person ? this.recordName(person) : '';
  }

  redeemMembershipRow(row: MembershipRedeemRow): void {
    if (this.num(row.redeemQty) <= 0 && row.pendingQty > 0) {
      row.redeemQty = String(this.membershipSettings.redemptionRules.allowPartialCredits ? 1 : row.pendingQty);
    }
  }

  setPackageRedeemQty(row: PackageRedeemRow, value: string): void {
    row.redeemQty = String(Math.max(0, Math.min(row.pendingQty, this.num(value))));
  }

  setPackageRedeemStaff(row: PackageRedeemRow, staffId: string): void {
    const person = this.staff.find((item) => String(item.id) === String(staffId));
    row.staffId = staffId || null;
    row.staffName = person ? this.recordName(person) : '';
  }

  redeemPackageRow(row: PackageRedeemRow): void {
    if (this.num(row.redeemQty) <= 0 && row.pendingQty > 0) row.redeemQty = '1';
  }

  onGiftCardCodeInput(value: string): void {
    this.giftCardPaymentCode = value.toUpperCase().replace(/\s+/g, '');
    this.verifiedGiftCard = null;
    this.giftCardLookupError = '';
  }

  onCouponCodeInput(value: string): void {
    this.couponCode = value.toUpperCase().replace(/\s+/g, '');
    this.couponPreview = null;
    this.couponError = '';
  }

  applyCoupon(): void {
    const code = this.couponCode.trim().toUpperCase();
    this.couponCode = code;
    this.couponPreview = null;
    this.couponError = '';
    if (!code) { this.couponError = 'Enter coupon code'; return; }
    if (!this.saleLines.some((line) => this.isLineReady(line))) { this.couponError = 'Add at least one item'; return; }
    const key = this.couponRequestKey();
    const payload = { ...this.salePayload('draft'), payments: [], paymentSplit: [], payment_split: [], walletCreditPaise: 0 };
    this.couponApplying = true;
    this.api.post<any>('/api/v1/pos/coupons/preview', payload).subscribe({
      next: (response: any) => {
        const data = response?.data ?? response;
        this.couponPreview = {
          code: String(data.code ?? code),
          discountPaise: this.firstMoney(data, ['discountPaise', 'discount_paise']),
          taxPaise: this.firstMoney(data, ['taxPaise', 'tax_paise']),
          totalPaise: this.firstMoney(data, ['totalPaise', 'total_paise']),
          key,
        };
        this.couponApplying = false;
      },
      error: (err: any) => {
        this.couponError = this.errorText(err, 'Coupon could not be applied');
        this.couponApplying = false;
      },
    });
  }

  verifyGiftCard(): void {
    const code = this.giftCardPaymentCode.trim().toUpperCase();
    this.giftCardPaymentCode = code;
    this.verifiedGiftCard = null;
    this.giftCardLookupError = '';
    if (!code) { this.giftCardLookupError = 'Enter gift card code'; return; }
    this.giftCardLookupLoading = true;
    this.api.get<any>(`/retention/gift-cards?code=${encodeURIComponent(code)}&clientId=${encodeURIComponent(this.selectedClientId || '')}`).subscribe({
      next: (response: any) => {
        const card = this.list(response).find((item) => String(item?.code ?? '').trim().toUpperCase() === code);
        if (!card) { this.giftCardLookupError = 'Gift card not found'; this.giftCardLookupLoading = false; return; }
        const normalized: GiftCardLookup = {
          id: String(card.id ?? ''),
          code: String(card.code ?? '').toUpperCase(),
          clientId: String(card.clientId ?? card.client_id ?? ''),
          clientName: String(card.clientName ?? card.client_name ?? ''),
          initialAmountPaise: this.firstMoney(card, ['initialAmountPaise', 'initial_amount_paise']),
          balancePaise: this.firstMoney(card, ['balancePaise', 'balance_paise']),
          status: String(card.status ?? ''),
          expiresAt: card.expiresAt ?? card.expires_at ?? null,
        };
        if (normalized.status !== 'active') { this.giftCardLookupError = `Gift card is ${normalized.status || 'not active'}`; this.giftCardLookupLoading = false; return; }
        if (normalized.expiresAt && String(normalized.expiresAt).slice(0, 10) < new Date().toISOString().slice(0, 10)) { this.giftCardLookupError = 'Gift card is expired'; this.giftCardLookupLoading = false; return; }
        if (normalized.balancePaise <= 0) { this.giftCardLookupError = 'Gift card has no available balance'; this.giftCardLookupLoading = false; return; }
        this.verifiedGiftCard = normalized;
        this.giftCardLookupLoading = false;
      },
      error: (err: any) => { this.giftCardLookupError = this.errorText(err, 'Gift card could not be verified'); this.giftCardLookupLoading = false; },
    });
  }

  paymentFillPaise(method: PaymentMode): number {
    const paidByOtherModes = this.paymentMethods
      .filter((item) => item.code !== method.code)
      .reduce((total, item) => total + this.toPaise(this.num(this.paymentInputs[item.code])), 0);
    const remainingPaise = Math.max(0, this.totalPaise - this.bookingAdvanceAppliedPaise - paidByOtherModes);
    if (method.code === 'wallet') return Math.min(remainingPaise, this.clientKpi.walletPaise);
    if (method.code === 'gift_card') return Math.min(remainingPaise, this.verifiedGiftCard?.balancePaise ?? remainingPaise);
    return remainingPaise;
  }
  fillPayment(method: PaymentMode): void {
    if (method.code === 'wallet' && !this.selectedClientId) { this.error = 'Select a client before using wallet'; return; }
    const amountPaise = this.paymentFillPaise(method);
    if (method.code === 'wallet' && amountPaise <= 0) { this.error = 'Wallet has no available balance'; return; }
    if (amountPaise > 0) {
      this.paymentInputs[method.code] = this.paiseToInput(amountPaise);
      this.error = '';
    }
  }
  applyOverpayToWallet(): void { if (this.unappliedOverpayPaise > 0) this.walletCreditAmount = this.paiseToInput(this.walletCreditPaise + this.unappliedOverpayPaise); }
  applyOverpayToTip(): void { if (this.unappliedOverpayPaise > 0) this.tipAmount = this.paiseToInput(this.tipPaise + this.unappliedOverpayPaise); }
  clearPayments(): void {
    this.paymentInputs = {};
    this.walletCreditAmount = '';
    this.giftCardPaymentCode = '';
    this.verifiedGiftCard = null;
    this.giftCardLookupError = '';
    this.ensurePaymentInputs();
  }
  holdInvoice(afterHold?: () => void): void { this.saveSale('draft', {}, afterHold); }
  finalizeSale(): void {
    if (this.paidNowPaise === 0) {
      if (!window.confirm('No payment collected. Save invoice as unpaid?')) return;
      this.finalizeUnpaidSale();
      return;
    }
    this.saveSale('finalized');
  }
  saveAsUnpaid(): void {
    if (!window.confirm('Clear the payment selection and save this invoice as unpaid?')) return;
    this.finalizeUnpaidSale();
  }

  syncOfflineCheckouts(): void {
    const queued = this.offlineCheckouts.find((item) => item.status === 'pending');
    if (!this.isOnline || this.syncingOffline || !queued) return;
    this.syncingOffline = true;
    this.api.post<any>('/api/v1/pos/offline-checkout', { operationId: queued.operationId, checkout: queued.checkout }).subscribe({
      next: () => {
        this.offlineCheckouts = this.offlineCheckouts.filter((item) => item.operationId !== queued.operationId);
        this.persistOfflineCheckouts();
        this.syncingOffline = false;
        this.message = 'Offline checkout synced';
        this.syncOfflineCheckouts();
      },
      error: (err: any) => {
        queued.lastError = this.errorText(err, 'Offline checkout sync failed');
        if (err?.status >= 400 && err?.status < 500) queued.status = 'conflict';
        this.persistOfflineCheckouts();
        this.syncingOffline = false;
        this.error = queued.status === 'conflict' ? 'Offline checkout needs review' : queued.lastError;
      },
    });
  }

  discardOfflineConflicts(): void {
    if (!this.offlineConflictCount || !confirm('Discard failed offline checkouts from this device?')) return;
    this.offlineCheckouts = this.offlineCheckouts.filter((item) => item.status !== 'conflict');
    this.persistOfflineCheckouts();
  }

  printSelectedSale(): void {
    const id = this.selectedSale?.id ?? this.selectedSale?.saleId ?? this.selectedSale?.sale_id;
    if (!id) return;
    this.api.get<any>(`/api/v1/pos/invoices/${id}/print`).subscribe({ next: (res: any) => { if (!printInvoiceDocument(res?.data ?? res)) this.error = 'Print not available'; }, error: () => (this.error = 'Print not available') });
  }

  lineSubtotalPaise(line: PosLine): number { return this.toPaise(this.num(line.unitPrice)) * Math.max(0, this.num(line.quantity)); }
  setLineDiscount(line: PosLine, value: string): void { line.discount = value; line.discountSource = ''; }
  setLineDiscountType(line: PosLine, value: DiscountType): void { line.discountType = value; line.discountSource = ''; }
  lineDiscountPaiseValue(line: PosLine): number {
    return Math.min(this.lineSubtotalPaise(line), this.baseLineDiscountPaise(line) + this.settlementDiscountForLine(line));
  }
  settlementDiscountForLine(line: PosLine): number { return this.activeSettlementPlan().allocations.get(line.id) ?? 0; }
  selectBalanceSettlement(value: BalanceSettlement): void {
    if (value === 'round_off') {
      const plan = this.buildSettlementDiscountPlan();
      if (plan.error) { this.error = plan.error; return; }
    }
    this.error = '';
    this.balanceSettlement = value;
  }
  private baseLineDiscountPaise(line: PosLine): number {
    return Math.min(this.lineSubtotalPaise(line), this.manualLineDiscountPaise(line) + this.membershipLineDiscountPaise(line));
  }
  private manualLineDiscountPaise(line: PosLine): number {
    const subtotal = this.lineSubtotalPaise(line);
    const value = this.num(line.discount);
    return line.discountType === 'percent'
      ? Math.round(subtotal * Math.min(100, Math.max(0, value)) / 100)
      : Math.min(subtotal, this.toPaise(value));
  }
  private membershipLineDiscountPaise(line: PosLine): number {
    const benefits = this.membershipSettings.creditsBenefits;
    if (line.discountSource || line.lineType !== 'service' || !line.itemId || !this.clientKpi.hasActiveMembership || !benefits.discountBenefitsEnabled || this.clientKpi.membershipDiscountPercent <= 0) return 0;
    if (this.clientKpi.membershipServiceIds.length && !this.clientKpi.membershipServiceIds.includes(String(line.itemId))) return 0;
    if (!benefits.allowBenefitStacking && (this.hasManualDiscount() || this.num(this.rewardPointsToRedeem) > 0)) return 0;
    return Math.round(this.lineSubtotalPaise(line) * Math.min(100, this.clientKpi.membershipDiscountPercent) / 100);
  }
  private baseTotalPaise(): number { return this.totalWithSettlementDiscounts(new Map()).totalPaise; }
  private activeSettlementPlan(): SettlementDiscountPlan {
    return this.balanceSettlement === 'round_off'
      ? this.buildSettlementDiscountPlan()
      : { allocations: new Map(), discountPaise: 0, totalPaise: this.baseTotalPaise(), error: '' };
  }
  private buildSettlementDiscountPlan(): SettlementDiscountPlan {
    const empty = new Map<string, number>();
    const baseTotal = this.totalWithSettlementDiscounts(empty).totalPaise;
    if (this.paidNowPaise <= 0 || this.paidNowPaise >= baseTotal) {
      return { allocations: empty, discountPaise: 0, totalPaise: baseTotal, error: '' };
    }

    const targetTotal = this.paidNowPaise;
    const allocations = new Map<string, number>();
    const services = this.saleLines.filter((line) => line.lineType === 'service' && this.isLineReady(line));
    if (!services.length) {
      return { allocations, discountPaise: 0, totalPaise: baseTotal, error: 'Round off needs at least one service line' };
    }

    for (const line of services) {
      const available = Math.max(0, this.lineSubtotalPaise(line) - this.baseLineDiscountPaise(line));
      if (!available) continue;
      const before = this.totalWithSettlementDiscounts(allocations).totalPaise;
      if (before === targetTotal) break;
      allocations.set(line.id, available);
      const afterFull = this.totalWithSettlementDiscounts(allocations).totalPaise;
      if (afterFull > targetTotal) continue;

      let low = 0;
      let high = available;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        allocations.set(line.id, middle);
        const candidate = this.totalWithSettlementDiscounts(allocations).totalPaise;
        if (candidate > targetTotal) low = middle + 1;
        else high = middle;
      }
      for (const candidateDiscount of [low, Math.max(0, low - 1)]) {
        allocations.set(line.id, candidateDiscount);
        if (this.totalWithSettlementDiscounts(allocations).totalPaise === targetTotal) {
          const discountPaise = [...allocations.values()].reduce((sum, value) => sum + value, 0);
          return { allocations, discountPaise, totalPaise: targetTotal, error: '' };
        }
      }
      allocations.set(line.id, Math.max(0, low - 1));
    }

    const finalTotal = this.totalWithSettlementDiscounts(allocations).totalPaise;
    if (finalTotal !== targetTotal) {
      return { allocations: new Map(), discountPaise: 0, totalPaise: baseTotal, error: 'The unpaid balance cannot be allocated exactly to service discount' };
    }
    const discountPaise = [...allocations.values()].reduce((sum, value) => sum + value, 0);
    return { allocations, discountPaise, totalPaise: finalTotal, error: '' };
  }
  private totalWithSettlementDiscounts(additional: Map<string, number>): { totalPaise: number } {
    const lineDiscount = this.saleLines.reduce((sum, line) => sum + Math.min(this.lineSubtotalPaise(line), this.baseLineDiscountPaise(line) + (additional.get(line.id) ?? 0)), 0);
    const discountBase = Math.max(0, this.subtotalPaise - lineDiscount);
    const manualValue = this.num(this.billDiscount);
    const manualBillDiscount = this.billDiscountType === 'percent'
      ? Math.min(discountBase, Math.round(discountBase * Math.min(100, Math.max(0, manualValue)) / 100))
      : Math.min(discountBase, this.toPaise(manualValue));
    const rewardRequested = Math.floor(this.num(this.rewardPointsToRedeem)) * Math.max(0, this.num(this.membershipSettings.creditsBenefits.rewardPointValuePaise));
    const billDiscount = manualBillDiscount + Math.min(Math.max(0, discountBase - manualBillDiscount), rewardRequested);
    const gst = this.saleLines.reduce((sum, line) => {
      const taxable = Math.max(0, this.lineSubtotalPaise(line) - Math.min(this.lineSubtotalPaise(line), this.baseLineDiscountPaise(line) + (additional.get(line.id) ?? 0)));
      return sum + Math.round(taxable * Math.max(0, this.num(line.taxPercent)) / 100);
    }, 0);
    const beforeRound = Math.max(0, this.subtotalPaise - lineDiscount - billDiscount + gst + this.tipPaise);
    return { totalPaise: this.roundTotal ? Math.round(beforeRound / 100) * 100 : beforeRound };
  }
  private hasManualDiscount(): boolean {
    return this.saleLines.some((line) => this.manualLineDiscountPaise(line) > 0) || this.num(this.billDiscount) > 0 || !!this.couponCode.trim();
  }
  lineGstPaise(line: PosLine): number { return Math.round((Math.max(0, this.lineSubtotalPaise(line) - this.lineDiscountPaiseValue(line)) * Math.max(0, this.num(line.taxPercent))) / 100); }
  lineTotalPaise(line: PosLine): number { return Math.max(0, this.lineSubtotalPaise(line) - this.lineDiscountPaiseValue(line) + this.lineGstPaise(line)); }

  recordName(record: any): string {
    const joinedName = [record?.firstName ?? record?.first_name, record?.lastName ?? record?.last_name].filter(Boolean).join(' ');
    return String(record?.name ?? record?.fullName ?? record?.displayName ?? record?.staffName ?? record?.serviceName ?? record?.productName ?? joinedName ?? `#${record?.id ?? ''}`).trim();
  }
  resultMeta(record: any): string { return [record?.phone ?? record?.mobile, record?.category, record?.sku, record?.barcode, record?.role ?? record?.designation].filter(Boolean).join(' · '); }
  clientWalletPaise(client: any): number { return this.firstNumber(client, ['walletBalancePaise', 'wallet_balance_paise']); }
  clientHasDuplicates(client: any): boolean { return this.firstNumber(client, ['duplicateCount', 'duplicate_count']) > 0; }
  whatsappUrl(client: any): string { const phone = this.phoneDigits(this.clientPhone(client)); return phone ? `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}` : ''; }
  callUrl(client: any): string { const phone = this.phoneDigits(this.clientPhone(client)); return phone ? `tel:${phone}` : ''; }
  staffResultMeta(person: any): string { return [person?.employeeCode ?? person?.employee_code, person?.jobTitle ?? person?.job_title ?? person?.role, person?.mobilePhone ?? person?.mobile_phone ?? person?.phone, person?.branchName ?? person?.branch_name ?? this.branchName].filter(Boolean).join(' · '); }
  typeLabel(type: LineType): string {
    return ({ service: 'Service', product: 'Product', membership: 'Membership', package: 'Package', gift_card: 'Gift card', custom: 'Custom' })[type];
  }
  addonLabel(item: any): string {
    const price = this.pricePaise(item);
    return price ? `${this.recordName(item)} - ${this.paiseToInput(price)}` : this.recordName(item);
  }
  clientInitial(): string { return (this.selectedClient ? this.recordName(this.selectedClient) : 'Walk-in client').trim().charAt(0).toUpperCase() || 'W'; }
  formatDate(value: string | null | undefined): string { const v = String(value ?? '').slice(0, 10); const p = v.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : '-'; }
  trackByLine(_: number, line: PosLine): string { return line.id; }
  trackById(_: number, item: any): string | number { return item.id; }
  trackByPayment(_: number, item: PaymentMode): string { return item.code; }
  trackBySplit(index: number): number { return index; }
  appointmentOptionLabel(item: any): string {
    const clientId = item?.clientId ?? item?.client_id ?? item?.customerId ?? item?.customer_id ?? '';
    const client = item?.clientName ?? item?.client_name ?? item?.customerName ?? item?.customer_name ?? this.clients.find((row) => String(row.id) === String(clientId));
    const name = typeof client === 'string' ? client : client ? this.recordName(client) : 'Appointment';
    const time = this.appointmentTimeLabel(item);
    return [name, time].filter(Boolean).join(' · ');
  }

  private filteredStaff(query: string): any[] { return this.ranked(this.staff, query, (p) => [this.recordName(p), p.phone, p.mobile, p.mobilePhone, p.mobile_phone, p.role, p.designation, p.jobTitle, p.job_title, p.employeeCode, p.employee_code, p.staffCode, p.code, p.branchId, p.branch_id, p.id]); }
  private addCatalogItem(type: CatalogLineType, item: any): void {
    const line = this.saleLines.find((candidate) => candidate.lineType === type && !candidate.itemId && !candidate.itemSearchText) ?? this.newSaleLine(type);
    if (!this.saleLines.includes(line)) this.saleLines.push(line);
    this.selectLineItem(line, item);
  }

  private newSaleLine(lineType: LineType): PosLine {
    return {
      id: `line-${this.lineSeed++}`,
      lineType,
      itemId: null,
      itemName: '',
      itemSearchText: '',
      staffSearchText: this.staffSearchText,
      customName: '',
      quantity: '1',
      unitPrice: '',
      discount: '',
      discountType: 'amount',
      discountSource: '',
      taxPercent: '',
      staffId: this.selectedStaffId,
      staffSplits: [],
    };
  }

  private addAddonLine(lineType: Extract<LineType, 'membership' | 'package' | 'gift_card'>, item: any, unitPricePaise: number, taxPercent: number): void {
    this.saleLines.push({
      ...this.newSaleLine(lineType),
      itemId: item.id ?? null,
      itemName: this.recordName(item),
      itemSearchText: this.recordName(item),
      unitPrice: this.paiseToInput(unitPricePaise),
      taxPercent: taxPercent > 0 ? String(taxPercent) : '',
    });
  }

  private applyMembershipFromRoute(): void {
    if (this.membershipPrefillApplied || !this.membershipSalesVisible || !this.clients.length || !this.memberships.length) return;
    const membershipId = this.route.snapshot.queryParamMap.get('membershipId');
    if (!membershipId) return;
    const plan = this.posMemberships.find((item) => String(item.id) === membershipId);
    if (!plan) return;
    const displayPrice = this.membershipDisplayPrice(plan);
    const taxPercent = this.membershipTaxPercent(plan);
    this.addAddonLine('membership', plan, this.priceBeforeMembershipTax(displayPrice, taxPercent), taxPercent);
    this.membershipPrefillApplied = true;
  }

  private ranked(rows: any[], query: string, fieldsFor: (row: any) => unknown[]): any[] {
    const q = this.normalizeSearch(query);
    return rows
      .map((row, index) => ({ row, score: q ? this.searchScore(fieldsFor(row), q) : Math.max(1, 20 - index) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item) => item.row);
  }

  private searchScore(fields: unknown[], query: string): number {
    const compactQuery = this.compactSearch(query);
    let best = 0;
    for (const raw of fields) {
      const value = this.normalizeSearch(raw);
      if (!value) continue;
      const compact = this.compactSearch(value);
      if (value === query || compact === compactQuery) best = Math.max(best, 120);
      else if (value.startsWith(query) || compact.startsWith(compactQuery)) best = Math.max(best, 95);
      else if (value.includes(query) || compact.includes(compactQuery)) best = Math.max(best, 70);
      else if (this.searchLettersExistInName(value, query)) best = Math.max(best, 35);
    }
    return best;
  }

  private searchLettersExistInName(value: string, query: string): boolean {
    let at = 0;
    for (const letter of query.replace(/\s+/g, '')) {
      at = value.indexOf(letter, at);
      if (at < 0) return false;
      at += 1;
    }
    return true;
  }

  private saveSale(status: SaleStatus, options: { forceUnpaid?: boolean } = {}, afterSave?: () => void): void {
    this.error = '';
    this.message = '';
    if (this.hasInvalidStaffSplit()) { this.error = 'Staff split total must be 100%'; return; }
    if (this.hasMissingMembershipRedeemStaff()) { this.error = 'Select staff for membership redemption'; return; }
    if (this.hasInvalidMembershipRedemption()) { this.error = 'Membership redeem qty is not available'; return; }
    if (this.hasInvalidPackageRedemption()) { this.error = 'Package redeem qty is not available'; return; }
    const couponError = this.couponApplicationError();
    if (couponError) { this.error = couponError; return; }
    const walletError = this.walletRedemptionError();
    if (walletError) { this.error = walletError; return; }
    const giftCardError = this.giftCardRedemptionError();
    if (giftCardError) { this.error = giftCardError; return; }
    const rewardError = this.rewardRedemptionError();
    if (rewardError) { this.error = rewardError; return; }
    const paymentError = options.forceUnpaid ? '' : this.paymentAllocationError();
    if (paymentError) { this.error = paymentError; return; }
    if (this.roundOffError) { this.error = this.roundOffError; return; }
    if (status === 'draft' && this.walletCreditPaise > 0) { this.error = 'Client advance can only be applied when finalizing the invoice'; return; }
    if (!this.canSave) { this.error = 'Add at least one item'; return; }
    if (status !== 'draft' && this.hasMembershipSaleLine() && !this.membershipSettings.paymentBilling.allowDueOnMembershipSale && this.paidNowPaise < this.totalPaise) {
      this.error = 'Full payment is required for membership sales';
      return;
    }
    if (!this.isOnline) {
      if (this.giftCardPaymentPaise > 0) { this.error = 'Gift card redemption requires an internet connection'; return; }
      if (status === 'draft' || this.draftId) { this.error = 'Held invoices require an internet connection'; return; }
      this.queueOfflineCheckout(options);
      return;
    }
    this.saving = true;
    if (this.draftId) {
      this.api.put<any>(`/api/v1/pos/invoices/${this.draftId}`, this.salePayload('draft')).subscribe({
        next: (res: any) => status === 'draft' ? this.completeSave(res, 'draft', afterSave) : this.finalizeHeldInvoice(afterSave),
        error: (err: any) => this.saveError(err),
      });
      return;
    }
    const path = status === 'draft' ? '/api/v1/pos/invoices/draft' : '/api/v1/pos/sales';
    this.api.post<any>(path, this.salePayload(status, options)).subscribe({ next: (res: any) => this.completeSave(res, status, afterSave), error: (err: any) => this.saveError(err) });
  }

  private finalizeUnpaidSale(): void {
    this.clearPayments();
    this.balanceSettlement = 'unpaid';
    this.saveSale('finalized', { forceUnpaid: true });
  }

  private finalizeHeldInvoice(afterSave?: () => void): void {
    this.api.post<any>(`/api/v1/pos/invoices/${this.draftId}/finalize`, { cashDrawerTillId: this.selectedCashTillId || null }).subscribe({ next: (res: any) => this.completeSave(res, 'finalized', afterSave), error: (err: any) => this.saveError(err) });
  }

  private completeSave(res: any, status: SaleStatus, afterSave?: () => void): void {
    const data = res?.data ?? res;
    this.selectedSale = data?.sale ?? data?.invoice ?? data;
    this.draftId = status === 'draft' ? String(this.selectedSale?.id ?? this.draftId) : null;
    this.message = status === 'draft' ? 'Invoice held' : 'Invoice saved';
    this.workingDraftCommitted = true;
    this.clearWorkingDraft();
    this.saving = false;
    this.loadPaymentMethods();
    if (this.selectedClientId) this.refreshClientKpi(this.selectedClientId);
    afterSave?.();
    if (status === 'finalized') void this.router.navigate(['/pos/invoices']);
  }

  private saveError(err: any): void {
    this.error = this.errorText(err, 'Unable to save invoice');
    this.saving = false;
  }

  private queueOfflineCheckout(options: { forceUnpaid?: boolean } = {}): void {
    const tenantId = localStorage.getItem('aurashine_tenant_id') || '';
    const branchId = localStorage.getItem('aurashine_branch_id') || '';
    if (!tenantId || !branchId) { this.error = 'Tenant or branch session is missing'; return; }
    const queued: OfflineCheckout = {
      operationId: crypto.randomUUID(),
      checkout: this.salePayload('finalized', options),
      createdAt: new Date().toISOString(),
      status: 'pending',
      lastError: '',
    };
    this.offlineCheckouts = [...this.offlineCheckouts, queued];
    if (!this.persistOfflineCheckouts()) {
      this.offlineCheckouts = this.offlineCheckouts.filter((item) => item.operationId !== queued.operationId);
      this.error = 'Offline checkout could not be saved on this device';
      return;
    }
    this.resetAfterOfflineCheckout();
    this.message = 'Offline checkout saved';
  }

  private resetAfterOfflineCheckout(): void {
    this.saleLines = [];
    this.selectedSale = null;
    this.selectedClientId = null;
    this.clientSearchText = '';
    this.clientKpi = this.emptyKpi();
    this.membershipRedeemRows = [];
    this.packageRedeemRows = [];
    this.source = 'Counter';
    this.reference = '';
    this.billDiscount = '';
    this.rewardPointsToRedeem = '';
    this.couponCode = '';
    this.tipAmount = '';
    this.walletCreditAmount = '';
    this.bookingAdvancePaise = 0;
    this.roundTotal = false;
    this.balanceSettlement = 'unpaid';
    this.clearPayments();
    this.clearWorkingDraft();
  }

  private persistWorkingDraft(): void {
    if (this.workingDraftCommitted || this.draftId || !this.saleLines.length) { this.clearWorkingDraft(); return; }
    try {
      sessionStorage.setItem(this.workingDraftStorageKey(), JSON.stringify({
        version: 1,
        selectedClientId: this.selectedClientId,
        selectedStaffId: this.selectedStaffId,
        clientSearchText: this.clientSearchText,
        staffSearchText: this.staffSearchText,
        branchName: this.branchName,
        invoiceDate: this.invoiceDate,
        source: this.source,
        reference: this.reference,
        selectedCashTillId: this.selectedCashTillId,
        selectedTerminalId: this.selectedTerminalId,
        selectedMembershipId: this.selectedMembershipId,
        selectedPackageId: this.selectedPackageId,
        giftCardAmount: this.giftCardAmount,
        giftCardPaymentCode: this.giftCardPaymentCode,
        verifiedGiftCard: this.verifiedGiftCard,
        activeAddonSale: this.activeAddonSale,
        billDiscount: this.billDiscount,
        billDiscountType: this.billDiscountType,
        couponCode: this.couponCode,
        couponPreview: this.couponPreview,
        tipAmount: this.tipAmount,
        walletCreditAmount: this.walletCreditAmount,
        bookingAdvancePaise: this.bookingAdvancePaise,
        rewardPointsToRedeem: this.rewardPointsToRedeem,
        rounding: this.roundTotal,
        balanceSettlement: this.balanceSettlement,
        saleLines: this.saleLines,
        clientKpi: this.clientKpi,
        membershipRedeemRows: this.membershipRedeemRows,
        packageRedeemRows: this.packageRedeemRows,
        paymentInputs: this.paymentInputs,
      }));
    } catch { /* session storage unavailable */ }
  }

  private restoreWorkingDraft(): boolean {
    try {
      const saved = JSON.parse(sessionStorage.getItem(this.workingDraftStorageKey()) || 'null');
      if (!saved || saved.version !== 1 || !Array.isArray(saved.saleLines) || !saved.saleLines.length) return false;
      this.selectedClientId = saved.selectedClientId ?? null;
      this.selectedStaffId = saved.selectedStaffId ?? null;
      this.clientSearchText = String(saved.clientSearchText ?? '');
      this.staffSearchText = String(saved.staffSearchText ?? '');
      this.branchName = String(saved.branchName ?? this.branchName);
      this.invoiceDate = String(saved.invoiceDate ?? this.invoiceDate);
      this.source = String(saved.source ?? 'Counter');
      this.reference = String(saved.reference ?? '');
      this.selectedCashTillId = String(saved.selectedCashTillId ?? '');
      this.selectedTerminalId = String(saved.selectedTerminalId ?? '');
      this.selectedMembershipId = String(saved.selectedMembershipId ?? '');
      this.selectedPackageId = String(saved.selectedPackageId ?? '');
      this.giftCardAmount = String(saved.giftCardAmount ?? '');
      this.giftCardPaymentCode = String(saved.giftCardPaymentCode ?? '');
      this.verifiedGiftCard = saved.verifiedGiftCard?.code ? saved.verifiedGiftCard as GiftCardLookup : null;
      this.activeAddonSale = ['membership', 'package', 'gift_card'].includes(saved.activeAddonSale) ? saved.activeAddonSale : null;
      this.billDiscount = String(saved.billDiscount ?? '');
      this.billDiscountType = saved.billDiscountType === 'percent' ? 'percent' : 'amount';
      this.couponCode = String(saved.couponCode ?? '');
      this.couponPreview = saved.couponPreview?.key ? saved.couponPreview as CouponPreview : null;
      this.tipAmount = String(saved.tipAmount ?? '');
      this.walletCreditAmount = String(saved.walletCreditAmount ?? '');
      this.bookingAdvancePaise = Math.max(0, this.num(saved.bookingAdvancePaise));
      this.rewardPointsToRedeem = String(saved.rewardPointsToRedeem ?? '');
      this.roundTotal = saved.rounding === true;
      this.balanceSettlement = saved.balanceSettlement === 'round_off' ? 'round_off' : 'unpaid';
      const lineTypes: LineType[] = ['service', 'product', 'membership', 'package', 'gift_card', 'custom'];
      this.saleLines = saved.saleLines.slice(0, 100).map((raw: any) => {
        const lineType: LineType = lineTypes.includes(raw?.lineType) ? raw.lineType : 'custom';
        const line = this.newSaleLine(lineType);
        return {
          ...line,
          id: String(raw?.id ?? line.id), itemId: raw?.itemId ?? null,
          itemName: String(raw?.itemName ?? ''), itemSearchText: String(raw?.itemSearchText ?? ''), staffSearchText: String(raw?.staffSearchText ?? ''), customName: String(raw?.customName ?? ''),
          quantity: String(raw?.quantity ?? '1'), unitPrice: String(raw?.unitPrice ?? ''), discount: String(raw?.discount ?? ''), discountType: raw?.discountType === 'percent' ? 'percent' : 'amount',
          discountSource: String(raw?.discountSource ?? ''), taxPercent: String(raw?.taxPercent ?? ''), staffId: raw?.staffId ?? null, staffSplits: this.parseStaffSplits(raw?.staffSplits),
        };
      });
      this.clientKpi = saved.clientKpi ? this.kpiFrom(saved.clientKpi) : this.emptyKpi();
      this.membershipRedeemRows = Array.isArray(saved.membershipRedeemRows) ? saved.membershipRedeemRows : [];
      this.packageRedeemRows = Array.isArray(saved.packageRedeemRows) ? saved.packageRedeemRows : [];
      this.paymentInputs = saved.paymentInputs && typeof saved.paymentInputs === 'object'
        ? Object.fromEntries(Object.entries(saved.paymentInputs).map(([key, value]) => [key, String(value ?? '')]))
        : {};
      this.message = 'Unsaved bill restored';
      return true;
    } catch { this.clearWorkingDraft(); return false; }
  }

  private clearWorkingDraft(): void {
    try { sessionStorage.removeItem(this.workingDraftStorageKey()); } catch { /* session storage unavailable */ }
  }

  private workingDraftStorageKey(): string {
    const tenantId = localStorage.getItem('aurashine_tenant_id') || 'unknown';
    const branchId = localStorage.getItem('aurashine_branch_id') || 'unknown';
    return `aurashine_pos_working_draft:${tenantId}:${branchId}`;
  }

  private posAutoHoldStorageKey(): string {
    const tenantId = localStorage.getItem('aurashine_tenant_id') || 'unknown';
    const branchId = localStorage.getItem('aurashine_branch_id') || 'unknown';
    return `aurashine_pos_auto_hold:${tenantId}:${branchId}`;
  }

  private takePendingPosAutoHold(): boolean {
    try {
      const key = this.posAutoHoldPendingStorageKey();
      const pending = !!sessionStorage.getItem(key);
      if (pending) sessionStorage.removeItem(key);
      return pending;
    } catch { return false; }
  }

  private posAutoHoldPendingStorageKey(): string {
    const tenantId = localStorage.getItem('aurashine_tenant_id') || 'unknown';
    const branchId = localStorage.getItem('aurashine_branch_id') || 'unknown';
    return `aurashine_pos_auto_hold_pending:${tenantId}:${branchId}`;
  }

  private loadOfflineCheckouts(): void {
    try {
      const rows = JSON.parse(localStorage.getItem(this.offlineStorageKey()) || '[]');
      this.offlineCheckouts = Array.isArray(rows)
        ? rows.filter((item) => item?.operationId && item?.checkout && ['pending', 'conflict'].includes(item?.status))
        : [];
    } catch {
      this.offlineCheckouts = [];
      this.error = 'Offline checkout queue could not be read';
    }
  }

  private persistOfflineCheckouts(): boolean {
    try { localStorage.setItem(this.offlineStorageKey(), JSON.stringify(this.offlineCheckouts)); return true; }
    catch { return false; }
  }

  private offlineStorageKey(): string {
    const tenantId = localStorage.getItem('aurashine_tenant_id') || 'unknown';
    const branchId = localStorage.getItem('aurashine_branch_id') || 'unknown';
    return `aurashine_pos_offline:${tenantId}:${branchId}`;
  }

  private errorText(err: any, fallback: string): string {
    const body = err?.error;
    return typeof body === 'string' ? body : body?.error?.message ?? body?.message ?? body?.error ?? err?.message ?? fallback;
  }

  private restoreHeldInvoice(id: string): void {
    this.api.get<any>(`/api/v1/pos/invoices/${id}`).subscribe({
      next: (res: any) => {
        const details = res?.sale ? res : res?.data ?? res;
        const sale = details.sale ?? details.invoice ?? details;
        if (sale.status !== 'draft') { this.error = 'Only held invoices can be resumed'; return; }
        this.restoreDraftSale(id, details, sale);
        this.message = 'Held invoice restored';
      },
      error: (err: any) => this.error = err?.error?.message ?? err?.message ?? 'Unable to restore held invoice',
    });
  }

  private restoreAppointmentDraft(id: string): void {
    this.api.get<any>(`/api/v1/pos/invoices/${id}`).subscribe({
      next: (res: any) => {
        const details = res?.sale ? res : res?.data ?? res;
        const sale = details.sale ?? details.invoice ?? details;
        if (sale.status !== 'draft') { this.error = 'Only draft appointment invoices can be opened'; return; }
        const source = String(sale.source ?? '').toLowerCase();
        const reference = String(sale.referenceId ?? sale.reference_id ?? '');
        if (source !== 'appointment' || !reference) {
          this.error = 'Appointment POS can only open appointment-linked draft invoices';
          return;
        }
        this.restoreDraftSale(id, details, sale);
        this.message = 'Appointment invoice opened';
      },
      error: (err: any) => this.error = err?.error?.message ?? err?.message ?? 'Unable to open appointment invoice',
    });
  }

  private restoreDraftSale(id: string, details: any, sale: any): void {
    this.draftId = id;
    this.selectedSale = sale;
    this.selectedClientId = (sale.clientId ?? sale.client_id ?? null) as any;
    const restoredClient = this.selectedClient;
    this.clientSearchText = restoredClient
      ? this.recordName(restoredClient)
      : String(details.clientKpi?.clientName ?? details.client_kpi?.client_name ?? sale.clientName ?? sale.client_name ?? 'Walk-in client');
    this.selectedStaffId = (sale.staffId ?? sale.staff_id ?? null) as any;
    this.source = sale.source ?? 'Counter';
    this.reference = sale.referenceId ?? sale.reference_id ?? '';
    this.invoiceDate = this.formatDate(sale.businessDate ?? sale.business_date ?? sale.createdAt ?? sale.created_at);
    const restoredLines = Array.isArray(details.lines) ? details.lines : [];
    const rewardLine = restoredLines.find((line: any) => String(line.lineType ?? line.line_type) === 'redemption' && String(line.itemId ?? line.item_id) === 'reward_points');
    const rewardPoints = Math.max(0, this.firstNumber(rewardLine, ['quantity', 'qty']));
    this.rewardPointsToRedeem = rewardPoints ? String(rewardPoints) : '';
    const storedBillDiscount = this.firstMoney(sale, ['billDiscountPaise', 'bill_discount_paise']);
    this.billDiscount = this.paiseToInput(Math.max(0, storedBillDiscount - rewardPoints * this.num(this.membershipSettings.creditsBenefits.rewardPointValuePaise)));
    this.couponCode = sale.couponCode ?? sale.coupon_code ?? '';
    this.tipAmount = this.paiseToInput(this.firstMoney(sale, ['tipPaise', 'tip_paise']));
    this.saleLines = restoredLines.filter((line: any) => line !== rewardLine).map((line: any) => this.restoreLine(line));
    this.paymentInputs = {};
    this.giftCardPaymentCode = '';
    this.verifiedGiftCard = null;
    (details.payments ?? []).forEach((payment: any) => {
      const method = String(payment.method ?? payment.code);
      this.paymentInputs[method] = this.paiseToInput(this.firstMoney(payment, ['amountPaise', 'amount_paise']));
      if (method === 'gift_card') this.giftCardPaymentCode = String(payment.methodReference ?? payment.method_reference ?? payment.reference ?? '').toUpperCase();
    });
    this.ensurePaymentInputs();
    if (this.giftCardPaymentCode) this.verifyGiftCard();
    this.refreshClientKpi(this.selectedClientId);
    if (String(sale.source ?? '').toLowerCase() === 'appointment' && this.reference) this.loadBookingAdvance(this.reference);
  }
  private restoreLine(line: any): PosLine {
    const type = String(line.lineType ?? line.line_type ?? 'custom') as LineType;
    const rawDiscountType = String(line.discountType ?? line.discount_type ?? 'amount');
    const amountType = rawDiscountType === 'percent' ? 'percent' : 'amount';
    const discount = amountType === 'percent' ? String((this.firstMoney(line, ['discountBps', 'discount_bps']) || 0) / 100) : this.paiseToInput(this.firstMoney(line, ['discountValuePaise', 'discount_value_paise', 'discountPaise', 'discount_paise']));
    const itemName = String(line.itemName ?? line.item_name ?? '');
    return { id: `line-${this.lineSeed++}`, lineType: type, itemId: (line.itemId ?? line.item_id ?? null) as any, itemName, itemSearchText: itemName, staffSearchText: '', customName: type === 'custom' ? itemName : '', quantity: String(line.quantity ?? 1), unitPrice: this.paiseToInput(this.firstMoney(line, ['unitPricePaise', 'unit_price_paise'])), discount, discountType: amountType, discountSource: rawDiscountType.startsWith('membership') ? rawDiscountType : '', taxPercent: String(line.taxPercent ?? line.tax_percent ?? line.gstPercent ?? line.gst_percent ?? ''), staffId: (line.staffId ?? line.staff_id ?? null) as any, staffSplits: this.parseStaffSplits(line.staffSplits ?? line.staff_splits) };
  }

  private salePayload(status: SaleStatus, options: { forceUnpaid?: boolean } = {}): any {
    const clientId = this.idPayload(this.selectedClientId);
    const staffId = this.idPayload(this.selectedStaffId);
    const lines: any[] = this.saleLines.filter((line) => this.isLineReady(line)).map((line) => {
      const itemName = line.lineType === 'custom' ? line.customName.trim() : line.itemName;
      const itemId = line.lineType === 'custom' || line.itemId == null ? null : String(line.itemId);
      const lineStaffId = this.idPayload(line.staffId);
      const staffSplits = this.payloadStaffSplits(line);
      const manualDiscountPaise = this.manualLineDiscountPaise(line);
      const membershipDiscountPaise = this.membershipLineDiscountPaise(line);
      const settlementDiscountPaise = this.settlementDiscountForLine(line);
      const discountSource = settlementDiscountPaise > 0 ? 'amount' : line.discountSource || (membershipDiscountPaise > 0 ? (manualDiscountPaise > 0 ? 'membership_stacked' : 'membership') : line.discountType);
      const fixedDiscountPaise = settlementDiscountPaise > 0
        ? manualDiscountPaise + membershipDiscountPaise + settlementDiscountPaise
        : discountSource.startsWith('membership') ? manualDiscountPaise + membershipDiscountPaise : line.discountType === 'amount' ? manualDiscountPaise : null;
      return {
        lineType: line.lineType,
        line_type: line.lineType,
        itemId,
        item_id: itemId,
        itemName,
        item_name: itemName,
        serviceId: line.lineType === 'service' ? itemId : null,
        service_id: line.lineType === 'service' ? itemId : null,
        productId: line.lineType === 'product' ? itemId : null,
        product_id: line.lineType === 'product' ? itemId : null,
        membershipId: line.lineType === 'membership' ? itemId : null,
        membership_id: line.lineType === 'membership' ? itemId : null,
        packageId: line.lineType === 'package' ? itemId : null,
        package_id: line.lineType === 'package' ? itemId : null,
        giftCardCode: line.lineType === 'gift_card' ? itemId : null,
        gift_card_code: line.lineType === 'gift_card' ? itemId : null,
        staffId: lineStaffId,
        staff_id: lineStaffId,
        assignedStaffId: lineStaffId,
        assigned_staff_id: lineStaffId,
        staffSplits,
        qty: this.num(line.quantity),
        quantity: this.num(line.quantity),
        unitPricePaise: this.toPaise(this.num(line.unitPrice)),
        unit_price_paise: this.toPaise(this.num(line.unitPrice)),
        discountType: discountSource,
        discount_type: discountSource,
        discountValue: discountSource.startsWith('membership') ? 0 : this.num(line.discount),
        discount_value: discountSource.startsWith('membership') ? 0 : this.num(line.discount),
        discountPaise: fixedDiscountPaise,
        discount_paise: fixedDiscountPaise,
        gstPercent: this.num(line.taxPercent),
        gst_percent: this.num(line.taxPercent),
        taxPercent: this.num(line.taxPercent),
        tax_percent: this.num(line.taxPercent),
      };
    });
    lines.push(...this.membershipRedeemRows
      .map((row) => ({ row, quantity: Math.floor(this.num(row.redeemQty)) }))
      .filter((item) => item.quantity > 0)
      .map(({ row, quantity }) => ({
        lineType: 'membership_redeem', line_type: 'membership_redeem',
        itemId: row.id, item_id: row.id, itemName: `${row.membershipName} · ${row.serviceName}`, item_name: `${row.membershipName} · ${row.serviceName}`,
        membershipId: row.membershipId, membership_id: row.membershipId,
        serviceId: row.serviceId, service_id: row.serviceId,
        staffId: row.staffId ? String(row.staffId) : '', staff_id: row.staffId ? String(row.staffId) : '',
        qty: quantity, quantity, unitPricePaise: 0, unit_price_paise: 0, discountType: 'amount', discount_type: 'amount', discountValue: 0, discount_value: 0, gstPercent: 0, gst_percent: 0,
      })));
    const rewardPoints = Math.floor(this.num(this.rewardPointsToRedeem));
    if (rewardPoints > 0) {
      lines.push({
        lineType: 'redemption', line_type: 'redemption', itemId: 'reward_points', item_id: 'reward_points',
        itemName: 'Reward points', item_name: 'Reward points', qty: rewardPoints, quantity: rewardPoints,
        unitPricePaise: 0, unit_price_paise: 0, discountType: 'amount', discount_type: 'amount',
        discountValue: 0, discount_value: 0, gstPercent: 0, gst_percent: 0,
      });
    }
    const paymentSplit = options.forceUnpaid ? [] : this.cappedPaymentSplit();
    const packageRedemptions = this.packageRedemptionPayload();
    const branchName = this.resolvedBranchName();
    lines.push(...packageRedemptions.map((row) => ({
      lineType: 'package_redeem', line_type: 'package_redeem', itemId: row.clientPackageCreditId, item_id: row.clientPackageCreditId,
      itemName: `${row.packageName} · ${row.serviceName}`, item_name: `${row.packageName} · ${row.serviceName}`,
      staffId: row.staffId, staff_id: row.staffId, qty: row.quantity, quantity: row.quantity,
      unitPricePaise: 0, unit_price_paise: 0, discountType: 'amount', discount_type: 'amount', discountValue: 0, discount_value: 0, gstPercent: 0, gst_percent: 0,
    })));
    return {
      status,
      clientId,
      client_id: clientId,
      staffId,
      staff_id: staffId,
      branchName: branchName || null,
      branch_name: branchName || null,
      businessDate: this.displayDateToIso(this.invoiceDate),
      business_date: this.displayDateToIso(this.invoiceDate),
      source: this.source.trim() || 'Counter',
      reference: this.reference.trim() || null,
      referenceId: this.reference.trim() || null,
      reference_id: this.reference.trim() || null,
      lines,
      billDiscountPaise: this.billDiscountPaise,
      bill_discount_paise: this.billDiscountPaise,
      rewardDiscountPaise: this.rewardDiscountPaise,
      reward_discount_paise: this.rewardDiscountPaise,
      billDiscountType: this.billDiscountType,
      bill_discount_type: this.billDiscountType,
      couponCode: this.couponCode.trim() || null,
      coupon_code: this.couponCode.trim() || null,
      tipPaise: this.tipPaise,
      tip_paise: this.tipPaise,
      forceUnpaid: options.forceUnpaid === true,
      walletCreditPaise: options.forceUnpaid ? 0 : paymentSplit.length ? this.walletCreditPaise : 0,
      roundToNearestRupee: this.roundTotal,
      paymentSplit,
      payment_split: paymentSplit,
      payments: paymentSplit,
      cashDrawerTillId: this.selectedCashTillId || null,
      terminalId: this.selectedTerminalId || null,
      packageRedemptions,
      subtotalPaise: this.subtotalPaise,
      gstPaise: this.gstPaise,
      totalPaise: this.totalPaise,
    };
  }

  private isLineReady(line: PosLine): boolean {
    if (this.num(line.quantity) <= 0 || this.num(line.unitPrice) < 0) return false;
    return line.lineType === 'custom' ? !!line.customName.trim() : !!line.itemId && !!line.itemName;
  }

  private isCatalogLine(type: LineType): type is CatalogLineType { return type === 'service' || type === 'product'; }
  private hasInvalidStaffSplit(): boolean { return this.saleLines.some((line) => line.staffSplits.length > 0 && this.splitPercentTotal(line) !== 100); }
  private hasMissingMembershipRedeemStaff(): boolean { return this.membershipSettings.redemptionRules.requireStaffConfirmation && this.membershipRedeemRows.some((row) => this.num(row.redeemQty) > 0 && !row.staffId); }
  private hasInvalidMembershipRedemption(): boolean {
    return this.hasMissingMembershipRedeemStaff() || this.membershipRedeemRows.some((row) => {
      const quantity = this.num(row.redeemQty);
      return quantity < 0 || quantity > row.pendingQty || (!this.membershipSettings.redemptionRules.allowPartialCredits && quantity > 0 && quantity !== row.pendingQty);
    });
  }
  private hasInvalidPackageRedemption(): boolean { return this.packageRedeemRows.some((row) => this.num(row.redeemQty) < 0 || this.num(row.redeemQty) > row.pendingQty); }
  private giftCardRedemptionError(): string {
    if (this.giftCardPaymentPaise <= 0) return '';
    const code = this.giftCardPaymentCode.trim().toUpperCase();
    if (!code) return 'Enter gift card code';
    if (!this.verifiedGiftCard || this.verifiedGiftCard.code !== code) return 'Verify gift card before payment';
    if (this.verifiedGiftCard.status !== 'active') return 'Gift card is not active';
    if (this.giftCardPaymentPaise > this.verifiedGiftCard.balancePaise) return 'Gift card balance cannot cover this payment';
    return '';
  }
  walletRedemptionError(): string {
    const amountPaise = this.toPaise(this.num(this.paymentInputs['wallet']));
    if (amountPaise <= 0) return '';
    if (!this.selectedClientId) return 'Select a client before using wallet';
    if (amountPaise > this.clientKpi.walletPaise) return 'Wallet balance cannot cover this payment';
    return '';
  }
  private activeCouponPreview(): CouponPreview | null {
    return this.couponPreview?.key === this.couponRequestKey() ? this.couponPreview : null;
  }
  private couponApplicationError(): string {
    return this.couponCode.trim() && !this.activeCouponPreview() ? (this.couponError || 'Apply coupon before saving') : '';
  }
  private couponRequestKey(): string {
    return JSON.stringify({
      clientId: this.selectedClientId,
      couponCode: this.couponCode.trim().toUpperCase(),
      billDiscount: this.billDiscount,
      billDiscountType: this.billDiscountType,
      rewardPoints: this.rewardPointsToRedeem,
      tip: this.tipAmount,
      rounding: this.roundTotal,
      lines: this.saleLines.map((line) => [line.lineType, line.itemId, line.quantity, line.unitPrice, line.discount, line.discountType, line.taxPercent, line.staffId]),
      membershipRedemptions: this.membershipRedeemRows.map((row) => [row.id, row.redeemQty, row.staffId]),
      packageRedemptions: this.packageRedeemRows.map((row) => [row.id, row.redeemQty, row.staffId]),
    });
  }
  private paymentAllocationError(): string {
    const overpayPaise = Math.max(0, this.paidNowPaise - Math.max(0, this.totalPaise - this.bookingAdvanceAppliedPaise));
    if (this.walletCreditPaise > 0 && !this.selectedClientId) return 'Select a client before adding advance to wallet';
    if (this.walletCreditPaise > overpayPaise) return 'Wallet credit cannot exceed the extra payment';
    if (this.walletCreditPaise < overpayPaise) return 'Apply the extra payment to client wallet or staff tip';
    return '';
  }
  private hasMembershipSaleLine(): boolean { return this.saleLines.some((line) => line.lineType === 'membership' && this.isLineReady(line)); }
  private membershipPlanAllowed(plan: any): boolean {
    const paid = this.pricePaise(plan) > 0;
    return paid ? this.membershipSettings.membershipCatalog.paidMembershipEnabled : this.membershipSettings.membershipCatalog.freeMembershipEnabled;
  }
  private membershipTaxPercent(plan: any): number { return this.membershipSettings.paymentBilling.membershipTaxApplicable ? (this.firstNumber(plan, ['gstPercent', 'taxPercent', 'gst_percent', 'tax_percent']) || 18) : 0; }
  private membershipDisplayPrice(plan: any): number {
    const rawPrice = this.route.snapshot.queryParamMap.get('unitPricePaise');
    const routePrice = rawPrice === null || rawPrice.trim() === '' ? Number.NaN : Number(rawPrice);
    return Number.isFinite(routePrice) && routePrice >= 0 ? routePrice : this.pricePaise(plan);
  }
  private priceBeforeMembershipTax(displayPricePaise: number, taxPercent: number): number {
    return this.membershipSettings.paymentBilling.taxInclusiveMembershipPrice && taxPercent > 0
      ? Math.round((displayPricePaise * 100) / (100 + taxPercent))
      : displayPricePaise;
  }
  private hasInvalidRewardRedemption(): boolean {
    return !!this.rewardRedemptionError();
  }
  private rewardRedemptionError(): string {
    const points = this.num(this.rewardPointsToRedeem);
    if (!points) return '';
    if (points < 0 || !Number.isInteger(points)) return 'Reward points must be a whole positive number';
    if (!this.selectedClientId || !this.clientKpi.hasActiveMembership) return 'Active membership is required for reward redemption';
    if (!this.membershipSettings.creditsBenefits.rewardPointsEnabled) return 'Reward redemption is disabled';
    if (points > this.clientKpi.rewardPointsBalance) return 'Reward points balance is insufficient';
    if (this.num(this.membershipSettings.creditsBenefits.rewardPointValuePaise) <= 0) return 'Reward point value must be greater than zero';
    if (!this.membershipSettings.creditsBenefits.allowBenefitStacking && this.hasManualDiscount()) return 'Reward points cannot be combined with other discounts';
    if (points * this.num(this.membershipSettings.creditsBenefits.rewardPointValuePaise) > Math.max(0, this.subtotalPaise - this.lineDiscountPaise - this.manualBillDiscountPaise)) return 'Reward points exceed bill amount';
    return '';
  }
  private packageRedemptionPayload(): any[] {
    return this.packageRedeemRows
      .map((row) => ({ row, quantity: Math.floor(this.num(row.redeemQty)) }))
      .filter((item) => item.quantity > 0)
      .map(({ row, quantity }) => ({
        clientPackageCreditId: row.id,
        client_package_credit_id: row.id,
        packageId: row.packageId,
        package_id: row.packageId,
        packageName: row.packageName,
        package_name: row.packageName,
        serviceId: row.serviceId,
        service_id: row.serviceId,
        serviceName: row.serviceName,
        service_name: row.serviceName,
        staffId: row.staffId ? String(row.staffId) : '',
        staff_id: row.staffId ? String(row.staffId) : '',
        quantity,
      }));
  }
  private payloadStaffSplits(line: PosLine): any[] {
    if (!line.staffSplits.length) return [];
    return line.staffSplits.map((split) => ({
      staffId: this.idPayload(split.staffId) || '',
      staffName: split.staffName,
      percent: this.num(split.percent),
    }));
  }
  private cappedPaymentSplit(): any[] {
    let remainingPaise = Math.max(0, this.totalPaise - this.bookingAdvanceAppliedPaise) + this.walletCreditPaise;
    const payments: any[] = [];

    for (const method of this.paymentMethods) {
      if (remainingPaise <= 0) break;
      const typedPaise = this.toPaise(this.num(this.paymentInputs[method.code]));
      const amountPaise = Math.min(typedPaise, remainingPaise);
      if (amountPaise > 0) {
        const methodReference = method.code === 'gift_card' ? this.giftCardPaymentCode.trim().toUpperCase() : '';
        payments.push({ method: method.code, code: method.code, amountPaise, amount_paise: amountPaise, methodReference, method_reference: methodReference, reference: methodReference });
        remainingPaise -= amountPaise;
      }
    }

    return payments;
  }
  private idPayload(value: string | number | null | undefined): string | null {
    const text = value == null ? '' : String(value).trim();
    return text || null;
  }
  private parseStaffSplits(raw: any): StaffSplit[] {
    const rows = Array.isArray(raw) ? raw : [];
    return rows.map((split) => ({
      staffId: split?.staffId || split?.staff_id ? String(split?.staffId ?? split?.staff_id) : null,
      staffName: String(split?.staffName ?? split?.staff_name ?? ''),
      percent: String(split?.percent ?? ''),
    })).filter((split) => split.staffId || this.num(split.percent) > 0);
  }

  private loadList(path: string, assign: (rows: any[]) => void): void { this.api.get<any>(path).subscribe({ next: (res: any) => assign(this.list(res).filter((x) => x?.id != null)), error: () => assign([]) }); }
  private list(res: any): any[] { if (Array.isArray(res)) return res; for (const key of ['rows', 'items', 'data', 'clients', 'staff', 'services', 'products', 'appointments', 'paymentMethods', 'payment_methods']) if (Array.isArray(res?.[key])) return res[key]; return []; }
  private paymentMode(mode: any): PaymentMode | null { const raw = String(mode?.code ?? mode?.method ?? mode?.key ?? mode?.name ?? '').trim(); if (!raw) return null; const code = raw.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/\s+/g, '_'); return { code, label: String(mode?.label ?? mode?.name ?? this.labelFor(code)), balancePaise: this.firstMoney(mode, ['balancePaise', 'balance_paise']), referenceRequired: mode?.referenceRequired === true || mode?.reference_required === true }; }
  private ensurePaymentInputs(): void { const next: Record<string, string> = {}; this.paymentMethods.forEach((m) => (next[m.code] = this.paymentInputs[m.code] ?? '')); this.paymentInputs = next; }
  private kpiFrom(data: any): ClientKpi {
    return {
      walletPaise: this.firstMoney(data, ['walletPaise', 'wallet_balance_paise', 'walletBalance', 'wallet_balance']),
      unpaidPaise: this.firstMoney(data, ['unpaidPaise', 'unpaid_paise', 'unpaidAmountPaise', 'unpaid_amount_paise']),
      membershipAssignDate: data?.membershipAssignDate ?? data?.membership_assign_date ?? data?.membershipAssignedAt ?? data?.membership_assigned_at ?? null,
      membershipExpireDate: data?.membershipExpireDate ?? data?.membership_expire_date ?? data?.membershipExpiresAt ?? data?.membership_expires_at ?? null,
      hasActiveMembership: Boolean(data?.hasActiveMembership ?? data?.has_active_membership),
      membershipDiscountPercent: this.firstNumber(data, ['membershipDiscountPercent', 'membership_discount_percent']),
      membershipServiceIds: Array.isArray(data?.membershipServiceIds ?? data?.membership_service_ids) ? (data?.membershipServiceIds ?? data?.membership_service_ids).map(String) : [],
      rewardPointsBalance: this.firstNumber(data, ['rewardPointsBalance', 'reward_points_balance']),
      membershipCredits: this.membershipCreditsFrom(data?.membershipCredits ?? data?.membership_credits),
      packageCredits: this.packageCreditsFrom(data?.packageCredits ?? data?.package_credits ?? data?.packageRedemptions ?? data?.package_redemptions),
    };
  }
  private emptyKpi(): ClientKpi { return { walletPaise: 0, unpaidPaise: 0, membershipAssignDate: null, membershipExpireDate: null, hasActiveMembership: false, membershipDiscountPercent: 0, membershipServiceIds: [], rewardPointsBalance: 0, membershipCredits: [], packageCredits: [] }; }
  private membershipCreditsFrom(raw: any): MembershipRedeemRow[] {
    const rows = Array.isArray(raw) ? raw : [];
    return rows.map((row) => {
      const staffId = row?.staffId ?? row?.staff_id ?? this.selectedStaffId ?? null;
      const person = this.staff.find((item) => String(item.id) === String(staffId));
      return {
        id: String(row?.clientMembershipCreditId ?? row?.client_membership_credit_id ?? row?.id ?? ''),
        membershipId: String(row?.membershipId ?? row?.membership_id ?? ''), membershipName: String(row?.membershipName ?? row?.membership_name ?? ''),
        serviceId: String(row?.serviceId ?? row?.service_id ?? ''), serviceName: String(row?.serviceName ?? row?.service_name ?? ''),
        pendingQty: Math.max(0, this.firstNumber(row, ['pendingQty', 'pending_qty', 'remainingQty', 'remaining_qty'])), redeemQty: '',
        staffId, staffName: person ? this.recordName(person) : '', expiresAt: row?.expiresAt ?? row?.expires_at ?? null,
      };
    }).filter((row) => row.id && row.membershipId && row.serviceId && row.pendingQty > 0);
  }
  private packageCreditsFrom(raw: any): PackageRedeemRow[] {
    const rows = Array.isArray(raw) ? raw : [];
    return rows.map((row) => {
      const id = String(row?.clientPackageCreditId ?? row?.client_package_credit_id ?? row?.id ?? '');
      const staffId = row?.staffId ?? row?.staff_id ?? this.selectedStaffId ?? null;
      const staff = this.staff.find((person) => String(person.id) === String(staffId));
      const serviceId = String(row?.serviceId ?? row?.service_id ?? '');
      const serviceName = String(row?.serviceName ?? row?.service_name ?? serviceId);
      return {
        id,
        packageId: String(row?.packageId ?? row?.package_id ?? ''),
        packageName: String(row?.packageName ?? row?.package_name ?? ''),
        serviceId,
        serviceName,
        pendingQty: Math.max(0, this.firstNumber(row, ['pendingQty', 'pending_qty', 'remainingQty', 'remaining_qty'])),
        redeemQty: '',
        staffId,
        staffName: staff ? this.recordName(staff) : '',
        expiresAt: row?.expiresAt ?? row?.expires_at ?? null,
      };
    }).filter((row) => row.id && row.packageId && row.serviceId && row.pendingQty > 0);
  }
  private pricePaise(item: any): number { return this.firstMoney(item, ['pricePaise', 'unitPricePaise', 'defaultPricePaise', 'price_paise', 'unit_price_paise']) || this.toPaise(this.firstNumber(item, ['price', 'unitPrice', 'sellingPrice', 'mrp', 'rate'])); }
  private firstMoney(obj: any, keys: string[]): number { for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== '') return Math.round(Number(obj[k]) || 0); return 0; }
  private firstNumber(obj: any, keys: string[]): number { for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== '') return Number(obj[k]) || 0; return 0; }
  private clientPhone(client: any): string { return this.phoneDigits(client?.phone ?? client?.mobile ?? client?.whatsapp); }
  private phoneDigits(value: unknown): string { return String(value ?? '').replace(/\D/g, ''); }
  private titleCase(value: string): string { return value.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()); }
  private emptyQuickClient(): QuickClient { return { name: '', phone: '', email: '', birthday: '', anniversary: '', tags: '', notes: '' }; }
  private normalizeSearch(value: unknown): string { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' '); }
  private compactSearch(value: unknown): string { return this.normalizeSearch(value).replace(/\s+/g, ''); }
  num(value: unknown): number { return value === null || value === undefined || value === '' ? 0 : Number(value) || 0; }
  private toPaise(value: number): number { return Math.round((Number(value) || 0) * 100); }
  private paiseToInput(value: number): string { return value ? (value / 100).toFixed(2).replace(/\.00$/, '') : ''; }
  private labelFor(code: string): string { return code.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' '); }
  private appointmentTimeLabel(item: any): string {
    const value = item?.startAt ?? item?.start_at ?? item?.startsAt ?? item?.starts_at ?? '';
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${this.formatDate(value)} ${date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
  }
  private displayDateToIso(value: string): string { const p = value.trim().split('/'); return p.length === 3 ? `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` : new Date().toISOString().slice(0, 10); }
  private optionalDisplayDateToIso(value: string): string | null { const p = value.trim().split('/'); return p.length === 3 && p.every((part) => /^\d+$/.test(part)) && p[2].length === 4 ? `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` : null; }
  private toDisplayDate(date: Date): string { return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`; }
  private refreshBranchName(): void { this.branchName = this.resolvedBranchName(); }
  private resolvedBranchName(): string {
    const branchId = localStorage.getItem('aurashine_branch_id');
    return this.auth.branchNameFor(branchId)
      || this.readStoredBranchName()
      || branchId
      || '';
  }
  private readStoredBranchName(): string { return localStorage.getItem('aurashine_branch_name') ?? localStorage.getItem('selectedBranchName') ?? localStorage.getItem('branchName') ?? ''; }
}
