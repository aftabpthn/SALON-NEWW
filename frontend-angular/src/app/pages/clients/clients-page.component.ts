import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

type ClientCredit = { id: string; membershipName?: string; packageName?: string; serviceName: string; pendingQty: number; totalQty: number; expiresAt?: string; unitValuePaise?: number };
type ClientMembership = { id: string; membershipName: string; assignedAt: string; expiresAt?: string; remainingCredits: number; status: string };

@Component({
  selector: 'page-clients',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './clients-page.component.html',
  styleUrls: ['./clients-page.component.css'],
})
export class ClientsPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  mode: 'list' | 'detail' | 'create' = 'list';
  activeTab = 'Overview';
  savingClient = false;
  clientError = '';
  tabs = ['Overview', 'Profile', 'Notes', 'Appointment', 'Form Records', 'Gallery', 'Products', 'Packages'];
  moreItems = [
    'Memberships',
    'Prepaid Cards',
    'Gift Cards',
    'Open invoices',
    'Opportunities',
    'Tasks',
    'Classes',
    'Referral History',
    'Wallet',
    'Issues',
    'Loyalty Points',
    'Coupons',
    'Payments',
    'Notifications',
    'Guest Pass',
    'Adjustments',
    'Campaigns',
    'Quotes',
    'Medical Record',
  ];

  clientRows: Array<{
    id: string;
    code: string;
    firstName: string;
    lastName: string;
    phone: string;
    lastVisit: string;
    membership: string;
    categories: string;
    center: string;
  }> = [];

  guest: {
    clientId: string;
    name: string;
    contact: string;
    email: string;
    badges: string[];
    points: number | null;
    totalVisits: number | null;
    openAppointments: number | null;
    amountDue: number | null;
    walletPaise: number;
    unpaidPaise: number;
    membershipName: string;
    membershipExpiresAt: string;
  } | null = null;

  packages: ClientCredit[] = [];
  memberships: ClientMembership[] = [];
  membershipCredits: ClientCredit[] = [];
  notes: unknown[] = [];
  appointments: unknown[] = [];
  entitlementLoading = false;
  entitlementError = '';

  createGuest = this.blankGuestForm();

  ngOnInit() {
    void this.loadClients();
  }

  showList() {
    this.mode = 'list';
  }

  showCreate() {
    this.createGuest = this.blankGuestForm();
    this.clientError = '';
    this.mode = 'create';
  }

  openGuest(client: { id: string; firstName: string; lastName: string; phone: string }) {
    this.guest = {
      clientId: client.id,
      name: `${client.firstName} ${client.lastName}`.trim(),
      contact: client.phone,
      email: '',
      badges: [],
      points: null,
      totalVisits: null,
      openAppointments: null,
      amountDue: null,
      walletPaise: 0,
      unpaidPaise: 0,
      membershipName: '',
      membershipExpiresAt: '',
    };
    this.packages = [];
    this.memberships = [];
    this.membershipCredits = [];
    this.entitlementError = '';
    this.activeTab = 'Overview';
    this.mode = 'detail';
    void this.loadClientEntitlements(client.id);
  }

  trackByIndex(index: number) {
    return index;
  }

  titleCase(value: string) {
    return value
      .split(' ')
      .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
      .join(' ');
  }

  formatDate(value?: string) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('en-GB').format(date);
  }

  money(value: number) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((value || 0) / 100);
  }

  async saveClient() {
    this.clientError = '';
    const firstName = this.createGuest.firstName.trim();
    if (!firstName) {
      this.clientError = 'First name required';
      return;
    }

    this.savingClient = true;
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<unknown>>('/clients', {
          code: this.createGuest.code.trim() || undefined,
          firstName,
          lastName: this.createGuest.lastName.trim(),
          phone: this.createGuest.phone.trim(),
          categories: this.createGuest.categories
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        }));
      if (!result.success) {
        throw new Error(result?.error?.message || result?.error || 'Client save failed');
      }

      await this.loadClients();
      this.showList();
    } catch (error) {
      this.clientError = error instanceof Error ? error.message : 'Client save failed';
    } finally {
      this.savingClient = false;
    }
  }

  private async loadClients() {
    try {
      const result = await firstValueFrom(this.api.get<ApiEnvelope<any[]>>('/clients'));
      if (!result.success || !Array.isArray(result.data)) {
        return;
      }

      this.clientRows = result.data.map((client: any) => ({
        id: client.id || '',
        code: client.code || '',
        firstName: client.firstName || '',
        lastName: client.lastName || '',
        phone: client.phone || '',
        lastVisit: client.lastVisitAt ? String(client.lastVisitAt).slice(0, 10) : '',
        membership: client.membershipLabel || '',
        categories: Array.isArray(client.categories) ? client.categories.join(', ') : '',
        center: client.branchId || '',
      }));
    } catch {
      this.clientRows = [];
    }
  }

  private async loadClientEntitlements(clientId: string) {
    this.entitlementLoading = true;
    const [kpiResult, membershipResult] = await Promise.allSettled([
      firstValueFrom(this.api.get<ApiEnvelope<any>>(`/pos/clients/${clientId}/kpi`)),
      firstValueFrom(this.api.get<ApiEnvelope<any>>(`/membership-enterprise/client/${clientId}/360`)),
    ]);
    if (kpiResult.status === 'fulfilled' && kpiResult.value.success && kpiResult.value.data) {
      const data = kpiResult.value.data;
      this.packages = Array.isArray(data.packageCredits) ? data.packageCredits : [];
      this.membershipCredits = Array.isArray(data.membershipCredits) ? data.membershipCredits : [];
      if (this.guest?.clientId === clientId) {
        this.guest.walletPaise = Number(data.walletPaise) || 0;
        this.guest.unpaidPaise = Number(data.unpaidPaise) || 0;
        this.guest.membershipName = String(data.membershipName || '');
        this.guest.membershipExpiresAt = String(data.membershipExpiresAt || '');
      }
    }
    if (membershipResult.status === 'fulfilled' && membershipResult.value.success && membershipResult.value.data) {
      const data = membershipResult.value.data;
      this.memberships = Array.isArray(data.memberships) ? data.memberships : [];
      if (this.guest?.clientId === clientId) {
        this.guest.email = String(data.client?.email || '');
        this.guest.walletPaise = Number(data.client?.walletBalancePaise) || this.guest.walletPaise;
      }
    }
    if (kpiResult.status === 'rejected' && membershipResult.status === 'rejected') this.entitlementError = 'Client benefits could not be loaded';
    this.entitlementLoading = false;
  }

  private blankGuestForm() {
    return {
      code: '',
      firstName: '',
      lastName: '',
      phone: '',
      lastVisit: '',
      categories: '',
      center: '',
    };
  }
}
