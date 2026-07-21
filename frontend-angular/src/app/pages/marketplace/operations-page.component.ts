import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../shared/services/api.service';

type Tab = 'outcall' | 'marketplace';
type Zone = { id: string; name: string; serviceArea: string; travelMinutes: number };
type Job = { id: string; address: string; staffName: string; travelMinutes: number; status: string; createdAt: string };
type Listing = { id: string; listingName: string; status: string; commissionBps: number; rankingScore: number; approvalNote: string };
type Review = { id: string; platform: string; rating?: number; reviewText: string; reviewedAt: string; decision?: string };

@Component({
  selector: 'page-operations', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './operations-page.component.html', styleUrls: ['./operations-page.component.css'],
})
export class OperationsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  tab: Tab = 'outcall'; loading = false; error = ''; saving = false;
  zones: Zone[] = []; jobs: Job[] = []; listings: Listing[] = []; reviews: Review[] = [];
  zone = { name: '', serviceArea: '', travelMinutes: null as number | null };
  job = { address: '', travelMinutes: null as number | null, staffId: '', travelZoneId: '' };
  listing = { listingName: '', commissionBps: null as number | null, rankingScore: null as number | null };

  ngOnInit() { void this.reload(); }
  async reload() {
    this.loading = true; this.error = '';
    try {
      const [outcall, marketplace] = await Promise.all([
        firstValueFrom(this.api.get<any>('/operations/outcall')),
        firstValueFrom(this.api.get<any>('/operations/marketplace')),
      ]);
      this.zones = outcall.data?.zones ?? outcall.zones ?? []; this.jobs = outcall.data?.jobs ?? outcall.jobs ?? [];
      this.listings = marketplace.data?.listings ?? marketplace.listings ?? []; this.reviews = marketplace.data?.reviews ?? marketplace.reviews ?? [];
      const active = this.listings[0];
      if (active) this.listing = { listingName: active.listingName, commissionBps: active.commissionBps, rankingScore: active.rankingScore };
    } catch { this.error = 'Operations data could not be loaded'; } finally { this.loading = false; }
  }
  async saveZone() { await this.run('/operations/outcall/zones', this.zone, () => this.zone = { name: '', serviceArea: '', travelMinutes: null }); }
  async createJob() { await this.run('/operations/outcall/jobs', this.job, () => this.job = { address: '', travelMinutes: null, staffId: '', travelZoneId: '' }); }
  async updateJob(job: Job, status: string) { await this.run(`/operations/outcall/jobs/${job.id}/status`, { status }); }
  async saveListing() { await this.run('/operations/marketplace/listing', this.listing); }
  async decideListing(row: Listing, decision: string) { await this.run(`/operations/marketplace/listing/${row.id}/approval`, { decision, note: '' }, undefined, 'patch'); }
  async moderateReview(row: Review, decision: string) { await this.run(`/operations/marketplace/reviews/${row.id}/moderation`, { decision, note: '' }, undefined, 'patch'); }
  private async run(path: string, body: unknown, done?: () => void, method: 'post' | 'patch' = 'post') {
    this.saving = true; this.error = '';
    try { await firstValueFrom(method === 'patch' ? this.api.patch(path, body) : this.api.post(path, body)); done?.(); await this.reload(); }
    catch (error: any) { this.error = error?.error?.error ?? 'Action could not be saved'; }
    finally { this.saving = false; }
  }
}
