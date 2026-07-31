import { DatePipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../shared/services/api.service';

type Tab = 'outcall' | 'marketplace';
type Zone = { id: string; name: string; serviceArea: string; travelMinutes: number; maxDistanceMeters?: number; baseSurchargePaise: number; perKmSurchargePaise: number; staffPerKmPaise: number; slaMinutes: number };
type Appointment = { id: string; clientId: string; clientName: string; staffId?: string; staffName: string; startAt: string; serviceNames: string; address: string; latitude?: number; longitude?: number };
type Staff = { id: string; name: string; activeJobs: number };
type Job = { id: string; appointmentId?: string; clientName: string; address: string; staffId?: string; staffName: string; travelMinutes: number; status: string; priority: number; overdue: boolean; slaDueAt?: string; routeDistanceMeters?: number; remainingEtaSeconds?: number; escalationLevel: number; distanceSurchargePaise: number; billedRevenuePaise: number; profitPaise: number; proofSubmittedAt?: string };
type Demand = { zoneId: string; zoneName: string; jobs90d: number; forecast7d: number };
type Listing = { id: string; listingName: string; status: string; commissionBps: number; rankingScore: number; approvalNote: string };
type Review = { id: string; platform: string; rating?: number; reviewText: string; reviewedAt: string; decision?: string };
type Connection = { id: string; provider: string; displayName: string; externalAccountId: string; status: string; secretLastFour: string; lastSuccessAt?: string; lastError?: string; failedEvents: number };
type FailedEvent = { id: string; providerEventId: string; eventType: string; attempts: number; maxAttempts: number; lastError?: string; nextAttemptAt: string };

@Component({ selector: 'page-operations', imports: [DatePipe, FormsModule], templateUrl: './operations-page.component.html', styleUrls: ['./operations-page.component.css'] })
export class OperationsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  tab: Tab = 'outcall'; loading = false; error = ''; message = ''; saving = false; connectorSecret = '';
  zones: Zone[] = []; appointments: Appointment[] = []; staff: Staff[] = []; jobs: Job[] = []; demand: Demand[] = [];
  listings: Listing[] = []; reviews: Review[] = []; connections: Connection[] = []; failedEvents: FailedEvent[] = [];
  mapsProvider = { configured: false, live: false, reason: '' }; messagingProviders = { whatsapp: false, sms: false };
  zone = { name: '', serviceArea: '', travelMinutes: null as number | null, maxDistanceMeters: null as number | null, baseSurchargePaise: null as number | null, perKmSurchargePaise: null as number | null, staffPerKmPaise: null as number | null, slaMinutes: null as number | null };
  job = { appointmentId: '', address: '', staffId: '', travelZoneId: '', travelMinutes: null as number | null, priority: 3, destinationLatitude: null as number | null, destinationLongitude: null as number | null };
  listing = { listingName: '', commissionBps: null as number | null, rankingScore: null as number | null };
  connection = { provider: '', displayName: '', externalAccountId: '' };

  ngOnInit() { void this.reload(); }
  async reload() {
    this.loading = true; this.error = '';
    const [outcall, marketplace] = await Promise.allSettled([
      firstValueFrom(this.api.get<any>('/operations/outcall')),
      firstValueFrom(this.api.get<any>('/operations/marketplace')),
    ]);
    if (outcall.status === 'fulfilled') {
      const data = outcall.value.data ?? outcall.value;
      this.zones = data.zones ?? []; this.appointments = data.appointments ?? []; this.staff = data.staff ?? []; this.jobs = data.jobs ?? []; this.demand = data.zoneDemand ?? [];
      this.mapsProvider = data.mapsProvider ?? this.mapsProvider; this.messagingProviders = data.messagingProviders ?? this.messagingProviders;
    }
    if (marketplace.status === 'fulfilled') {
      const data = marketplace.value.data ?? marketplace.value;
      this.listings = data.listings ?? []; this.reviews = data.reviews ?? []; this.connections = data.connections ?? []; this.failedEvents = data.failedEvents ?? [];
      const active = this.listings[0]; if (active) this.listing = { listingName: active.listingName, commissionBps: active.commissionBps, rankingScore: active.rankingScore };
    }
    const failures = [outcall, marketplace].filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
    this.error = failures.map(({ reason }) => this.apiError(reason, 'Operations data could not be loaded')).join(' · '); this.loading = false;
  }
  selectAppointment() {
    const appointment = this.appointments.find((row) => row.id === this.job.appointmentId); if (!appointment) return;
    this.job.address = appointment.address; this.job.staffId = appointment.staffId || this.recommendedStaffId(); this.job.destinationLatitude = appointment.latitude ?? null; this.job.destinationLongitude = appointment.longitude ?? null;
  }
  recommendedStaffId(): string { return [...this.staff].sort((left, right) => left.activeJobs - right.activeJobs || left.name.localeCompare(right.name))[0]?.id ?? ''; }
  recommendedStaffName(): string { return this.staff.find((row) => row.id === this.recommendedStaffId())?.name ?? 'No staff available'; }
  prioritizedJobs(): Job[] { return [...this.jobs].filter((row) => !['completed', 'cancelled'].includes(row.status)).sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.priority - b.priority || (a.slaDueAt || '').localeCompare(b.slaDueAt || '')); }
  riskReason(job: Job): string { if (job.overdue) return `SLA overdue · escalation ${job.escalationLevel}`; if (job.priority <= 2) return 'High priority'; if (!job.proofSubmittedAt && job.status === 'arrived') return 'Service proof pending'; return 'On plan'; }
  async saveZone() { await this.run('/operations/outcall/zones', this.zone, () => this.zone = { name: '', serviceArea: '', travelMinutes: null, maxDistanceMeters: null, baseSurchargePaise: null, perKmSurchargePaise: null, staffPerKmPaise: null, slaMinutes: null }); }
  async createJob() { await this.run('/operations/outcall/jobs', { ...this.job, staffId: this.job.staffId || null }, () => this.job = { appointmentId: '', address: '', staffId: '', travelZoneId: '', travelMinutes: null, priority: 3, destinationLatitude: null, destinationLongitude: null }); }
  async updateJob(job: Job, status: string) { await this.run(`/operations/outcall/jobs/${job.id}/status`, { status }, undefined, 'patch'); }
  async assignJob(job: Job) { await this.run(`/operations/outcall/jobs/${job.id}/assignment`, { staffId: job.staffId }, undefined, 'patch'); }
  async notify(job: Job, channel: 'whatsapp' | 'sms') { await this.run(`/operations/outcall/jobs/${job.id}/notify`, { channel }); }
  async saveListing() { await this.run('/operations/marketplace/listing', this.listing); }
  async decideListing(row: Listing, decision: string) { await this.run(`/operations/marketplace/listing/${row.id}/approval`, { decision, note: '' }, undefined, 'patch'); }
  async moderateReview(row: Review, decision: string) { await this.run(`/operations/marketplace/reviews/${row.id}/moderation`, { decision, note: '' }, undefined, 'patch'); }
  async createConnection() {
    this.connectorSecret = '';
    await this.run('/operations/marketplace/connections', this.connection, () => this.connection = { provider: '', displayName: '', externalAccountId: '' }, 'post', (data) => this.connectorSecret = data.webhookSecret ?? '');
  }
  async retryEvent(row: FailedEvent) { await this.run(`/operations/marketplace/events/${row.id}/retry`, {}); }
  money(paise: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((paise || 0) / 100); }
  distance(metres?: number): string { return metres == null ? 'Route pending' : `${(metres / 1000).toFixed(1)} km`; }
  private async run(path: string, body: unknown, done?: () => void, method: 'post' | 'patch' = 'post', capture?: (data: any) => void) {
    this.saving = true; this.error = ''; this.message = '';
    try { const response: any = await firstValueFrom(method === 'patch' ? this.api.patch(path, body) : this.api.post(path, body)); capture?.(response.data ?? response); done?.(); this.message = 'Saved'; await this.reload(); }
    catch (error: any) { this.error = this.apiError(error, 'Action could not be saved'); }
    finally { this.saving = false; }
  }
  private apiError(error: any, fallback: string): string { return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback; }
}
