import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';

type Branch = { id: string; name: string; bookingToken: string; address: string; latitude: number | null; longitude: number | null; bookingDepositPercent: number; distanceKm?: number };
type ServiceVariant = { id: string; name: string; priceDeltaPaise: number; durationDeltaMinutes: number };
type ServiceAddon = { id: string; name: string; pricePaise: number; durationMinutes: number };
type Service = { id: string; name: string; category: string; durationMinutes: number; pricePaise: number; variants: ServiceVariant[]; addons: ServiceAddon[] };
type ServiceSelection = { serviceId: string; variantId: string; addonIds: string[] };
type Staff = { id: string; name: string; jobTitle: string };
type Slot = { slotId?: string; startAt: string; endAt: string; availableStaffIds?: string[] };

@Component({
  selector: 'page-public-booking',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './public-booking-page.component.html',
  styleUrls: ['./public-booking-page.component.css'],
})
export class PublicBookingPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  readonly steps = ['Services', 'Staff', 'Date & time', 'Verify', 'Review', 'Confirm'];
  tenant = { id: '', name: '' };
  branches: Branch[] = [];
  services: Service[] = [];
  staff: Staff[] = [];
  slots: Slot[] = [];
  branchId = '';
  serviceSearch = '';
  selectedCategory = 'all';
  selectedServiceIds: string[] = [];
  staffMode: 'any' | 'specific' = 'any';
  staffId = '';
  bookingDate = this.today();
  selectedSlot: Slot | null = null;
  mobile = '';
  otp = '';
  otpVerified = false;
  step = 1;
  loading = true;
  busy = false;
  error = '';
  success = '';
  source = 'website';
  selections: Record<string, ServiceSelection> = {};
  quotedTotalPaise: number | null = null;
  depositPaise = 0;

  async ngOnInit() {
    const source = (this.route.snapshot.queryParamMap.get('source') || 'website').toLowerCase();
    this.source = ['website', 'instagram', 'facebook', 'google', 'whatsapp', 'voice'].includes(source) ? source : 'website';
    await this.loadPortal();
  }

  get selectedBranch() { return this.branches.find((branch) => branch.id === this.branchId); }
  get selectedServices() { return this.services.filter((service) => this.selectedServiceIds.includes(service.id)); }
  get selectedStaff() { return this.staff.find((person) => person.id === this.staffId); }
  get totalPaise() { return this.quotedTotalPaise ?? this.selectedServices.reduce((total, service) => total + this.servicePrice(service), 0); }
  get serviceSelections() { return this.selectedServiceIds.map((id) => this.selection(id)); }
  get serviceCategories() {
    return [...new Set(this.services.map((service) => service.category).filter(Boolean))].sort();
  }
  get filteredServices() {
    const search = this.serviceSearch.trim().toLowerCase();
    return this.services.filter((service) => {
      const categoryMatch = this.selectedCategory === 'all' || service.category === this.selectedCategory;
      const searchMatch = !search || `${service.name} ${service.category}`.toLowerCase().includes(search);
      return categoryMatch && searchMatch;
    });
  }
  get selectedStaffLabel() {
    if (this.staffMode === 'any') return this.selectedStaff?.name || 'Any available staff';
    return this.selectedStaff?.name || 'Select staff';
  }
  get canContinue() {
    if (this.busy || this.loading) return false;
    if (this.step === 1) return this.selectedServiceIds.length > 0;
    if (this.step === 2) return this.staffMode === 'any' || !!this.staffId;
    if (this.step === 3) return !!this.selectedSlot;
    if (this.step === 4) return this.otpVerified;
    return true;
  }

  async loadPortal() {
    this.loading = true;
    this.error = '';
    try {
      const slug = this.route.snapshot.paramMap.get('tenantSlug') || '';
      const result = await firstValueFrom(this.http.get<any>(this.url(`/booking-portal/v2/public/${encodeURIComponent(slug)}`)));
      this.tenant = result.tenant || this.tenant;
      this.branches = Array.isArray(result.branches) ? result.branches.map((branch: any) => ({
        id: String(branch.id || ''), name: String(branch.name || ''), bookingToken: String(branch.bookingToken || ''),
        address: String(branch.address || ''), latitude: branch.latitude == null ? null : Number(branch.latitude),
        longitude: branch.longitude == null ? null : Number(branch.longitude), bookingDepositPercent: Number(branch.bookingDepositPercent) || 0,
      })).filter((branch: Branch) => branch.id) : [];
      this.branchId = this.branches[0]?.id || '';
      await this.loadCatalog();
    } catch (error) {
      this.error = this.message(error, 'Booking portal could not be loaded');
    } finally { this.loading = false; }
  }

  async loadCatalog() {
    this.services = [];
    this.staff = [];
    this.selectedServiceIds = [];
    this.serviceSearch = '';
    this.selectedCategory = 'all';
    this.staffMode = 'any';
    this.staffId = '';
    this.selectedSlot = null;
    this.selections = {};
    this.quotedTotalPaise = null;
    this.depositPaise = 0;
    if (!this.branchId || !this.tenant.id) return;
    this.busy = true;
    this.error = '';
    const query = `tenantId=${encodeURIComponent(this.tenant.id)}&branchId=${encodeURIComponent(this.branchId)}`;
    try {
      const [services, staff] = await Promise.all([
        firstValueFrom(this.http.get<any>(this.url(`/booking-portal/v2/services?${query}`))),
        firstValueFrom(this.http.get<any>(this.url(`/booking-portal/v2/staff?${query}`))),
      ]);
      this.services = Array.isArray(services.services) ? services.services.map((service: any) => ({
        id: String(service.id || ''), name: String(service.name || ''), category: String(service.category || ''),
        durationMinutes: Number(service.durationMinutes) || 0, pricePaise: Number(service.pricePaise) || 0,
        variants: Array.isArray(service.variants) ? service.variants : [], addons: Array.isArray(service.addons) ? service.addons : [],
      })).filter((service: Service) => service.id) : [];
      const requestedServiceId = this.route.snapshot.queryParamMap.get('serviceId') || '';
      if (requestedServiceId && this.services.some((service) => service.id === requestedServiceId)) {
        this.selectedServiceIds = [requestedServiceId];
        this.selection(requestedServiceId);
      }
      this.staff = Array.isArray(staff.staff) ? staff.staff : [];
    } catch (error) { this.error = this.message(error, 'Booking options could not be loaded'); }
    finally { this.busy = false; }
  }

  toggleService(id: string) {
    this.selectedServiceIds = this.selectedServiceIds.includes(id)
      ? this.selectedServiceIds.filter((value) => value !== id)
      : [...this.selectedServiceIds, id];
    if (!this.selectedServiceIds.includes(id)) delete this.selections[id];
    else this.selection(id);
    this.clearQuote();
    this.selectedSlot = null;
    this.slots = [];
  }

  selection(serviceId: string) {
    return this.selections[serviceId] ||= { serviceId, variantId: '', addonIds: [] };
  }

  setVariant(serviceId: string, variantId: string) {
    this.selection(serviceId).variantId = variantId;
    this.clearQuote();
  }

  toggleAddon(serviceId: string, addonId: string) {
    const selection = this.selection(serviceId);
    selection.addonIds = selection.addonIds.includes(addonId)
      ? selection.addonIds.filter((id) => id !== addonId)
      : [...selection.addonIds, addonId];
    this.clearQuote();
  }

  async continue() {
    this.error = '';
    if (this.step === 1 && !this.selectedServiceIds.length) return;
    if (this.step === 2 && this.staffMode === 'specific' && !this.staffId) return;
    if (this.step === 2) { await this.loadSlots(); return; }
    if (this.step === 3 && !this.selectedSlot) { await this.loadSlots(); return; }
    if (this.step === 4 && !this.otpVerified) return;
    if (this.step === 5) { this.step = 6; await this.confirm(); return; }
    this.step = Math.min(6, this.step + 1);
  }

  back() { if (!this.busy && this.step > 1 && this.step < 6) this.step -= 1; }

  async loadSlots() {
    this.busy = true;
    try {
      const result = await firstValueFrom(this.http.post<any>(this.url('/booking-portal/v2/slots'), {
        branchId: this.branchId, serviceIds: this.selectedServiceIds, date: this.bookingDate, limit: 12,
      }));
      const slots: Slot[] = Array.isArray(result.slots) ? result.slots : [];
      this.slots = this.staffMode === 'specific'
        ? slots.filter((slot) => !slot.availableStaffIds?.length || slot.availableStaffIds.includes(this.staffId))
        : slots;
      this.step = 3;
    } catch (error) { this.error = this.message(error, 'Available times could not be loaded'); }
    finally { this.busy = false; }
  }

  async chooseSlot(slot: Slot) {
    this.selectedSlot = slot;
    if (this.staffMode === 'any') this.autoSelectStaff(slot);
    await this.loadQuote();
  }

  async loadQuote() {
    const branch = this.selectedBranch;
    if (!branch || !this.selectedSlot) return;
    if (!this.staffId) {
      this.error = 'Select staff before confirming this slot';
      return;
    }
    try {
      const headers = new HttpHeaders({ 'x-public-booking-token': branch.bookingToken });
      const quote = await firstValueFrom(this.http.post<any>(this.url('/booking-portal/v2/quote'), {
        branchId: branch.id, serviceIds: this.selectedServiceIds, serviceSelections: this.serviceSelections,
        staffId: this.staffId, startsAt: this.selectedSlot.startAt,
      }, { headers }));
      this.quotedTotalPaise = Number(quote.totalPaise) || 0;
      this.depositPaise = Number(quote.depositPaise) || 0;
    } catch (error) { this.error = this.message(error, 'Booking price could not be loaded'); }
  }

  async sendOtp() {
    if (!this.mobile.trim()) return;
    this.busy = true;
    this.error = '';
    try {
      const query = `mobile=${encodeURIComponent(this.mobile.trim())}&purpose=booking`;
      await firstValueFrom(this.http.post(this.url(`/booking-portal/v2/otps/send?${query}`), {}));
    } catch (error) { this.error = this.message(error, 'OTP could not be sent'); }
    finally { this.busy = false; }
  }

  async verifyOtp() {
    if (!this.mobile.trim() || !this.otp.trim()) return;
    this.busy = true;
    this.error = '';
    try {
      const result = await firstValueFrom(this.http.post<any>(this.url('/booking-portal/v2/otps/verify'), {
        mobile: this.mobile.trim(), otp: this.otp.trim(), purpose: 'booking',
      }));
      this.otpVerified = result.verified === true;
      if (!this.otpVerified) this.error = 'OTP is not valid';
    } catch (error) { this.error = this.message(error, 'OTP could not be verified'); }
    finally { this.busy = false; }
  }

  async confirm() {
    const branch = this.selectedBranch;
    if (!branch || !this.selectedSlot) return;
    if (!this.staffId) {
      this.error = 'Select staff before confirming this slot';
      return;
    }
    this.busy = true;
    this.error = '';
    try {
      const headers = new HttpHeaders({ 'x-public-booking-token': branch.bookingToken });
      const hold = await firstValueFrom(this.http.post<any>(this.url('/booking-portal/v2/holds'), {
        branchId: branch.id, serviceIds: this.selectedServiceIds, startAt: this.selectedSlot.startAt,
        endAt: this.selectedSlot.endAt, mobile: this.mobile.trim(),
      }, { headers }));
      const result = await firstValueFrom(this.http.post<any>(this.url('/booking-portal/v2/confirm'), {
        branchId: branch.id, serviceIds: this.selectedServiceIds, startAt: this.selectedSlot.startAt,
        endAt: this.selectedSlot.endAt, mobile: this.mobile.trim(), holdId: hold.holdId,
        clientId: `anon-${this.mobile.trim()}`, staffId: this.staffId,
        serviceSelections: this.serviceSelections, source: this.source,
      }, { headers }));
      const deposit = Number(result?.deposit?.amount) || 0;
      this.success = deposit > 0 ? `Appointment booked · Deposit ${this.money(deposit)} required` : 'Appointment booked';
    } catch (error) { this.error = this.message(error, 'Appointment could not be booked'); }
    finally { this.busy = false; }
  }

  money(paise: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((paise || 0) / 100); }
  time(value: string) { return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
  async useMyLocation() {
    if (!navigator.geolocation) return;
    this.busy = true;
    this.error = '';
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));
      const { latitude, longitude } = position.coords;
      this.branches = this.branches
        .map((branch) => ({ ...branch, distanceKm: branch.latitude == null || branch.longitude == null ? undefined : this.distanceKm(latitude, longitude, branch.latitude, branch.longitude) }))
        .sort((a, b) => (a.distanceKm ?? Number.MAX_VALUE) - (b.distanceKm ?? Number.MAX_VALUE));
      if (this.branches[0]?.distanceKm != null) {
        this.branchId = this.branches[0].id;
        await this.loadCatalog();
      }
    } catch { this.error = 'Location could not be read'; }
    finally { this.busy = false; }
  }
  servicePrice(service: Service) {
    const selection = this.selection(service.id);
    const variant = service.variants.find((item) => item.id === selection.variantId);
    const addons = service.addons.filter((item) => selection.addonIds.includes(item.id));
    return Math.max(0, service.pricePaise + (variant?.priceDeltaPaise || 0)) + addons.reduce((total, item) => total + item.pricePaise, 0);
  }
  private autoSelectStaff(slot: Slot) {
    const available = slot.availableStaffIds?.find((id) => this.staff.some((person) => person.id === id));
    this.staffId = available || this.staff[0]?.id || '';
  }
  clearQuote() { this.quotedTotalPaise = null; this.depositPaise = 0; }
  private distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
    const radians = (value: number) => value * Math.PI / 180;
    const dLat = radians(bLat - aLat); const dLng = radians(bLng - aLng);
    const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)) * 10) / 10;
  }
  private today() { return new Date().toISOString().slice(0, 10); }
  private url(path: string) { return `${environment.apiBaseUrl.replace(/\/+$/, '')}${path}`; }
  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.message || fallback; }
}
