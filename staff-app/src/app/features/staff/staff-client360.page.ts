import { DatePipe } from "@angular/common";
import { Component, OnDestroy, OnInit, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { IonSpinner } from "@ionic/angular/standalone";
import { Subscription } from "rxjs";
import { StaffAppService, StaffClient360, StaffDashboard } from "../../core/staff-app.service";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";

@Component({
  standalone: true,
  imports: [PaiseInrPipe, DatePipe, FormsModule, RouterLink, IonSpinner],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Client 360</p><h1>{{ client()?.profile?.name || 'Client 360' }}</h1><p>Separate client workspace, not embedded in dashboard.</p></div></header>
      @if (loading()) { <section class="state"><ion-spinner name="crescent" /> Loading Client 360...</section> }
      @if (message()) { <section class="notice success">{{ message() }}</section> }
      @if (localError()) { <section class="notice">{{ localError() }}</section> }
      @if (staff.error() && !localError()) { <section class="notice">{{ staff.error() }}</section> }

      @if (!clientId()) {
        <section class="panel">
          <div class="panel-title"><h2>Select a client</h2><span>{{ clients().length }}</span></div>
          <div class="list">
            @for (item of clients(); track item.id) { <div class="row"><div class="row-main"><strong>{{ item.name }}</strong><small>{{ item.phone || 'No phone on file' }}</small></div><a class="button" [routerLink]="['/staff/client-360', item.id]">Open</a></div> } @empty { <p class="empty">No assigned clients available for Client 360.</p> }
          </div>
        </section>
      }

      @if (client(); as data) {
        <section class="grid four">
          <article class="kpi"><span>Retention</span><strong>{{ data.retentionScore }}%</strong></article>
          <article class="kpi"><span>Visits</span><strong>{{ data.visitFrequency }}</strong></article>
          <article class="kpi"><span>Lifetime</span><strong>{{ data.lifetimeSpend | paiseInr }}</strong></article>
          <article class="kpi"><span>Outstanding</span><strong>{{ data.outstandingBalance | paiseInr }}</strong></article>
        </section>
        <section class="grid two">
          <article class="panel"><div class="panel-title"><h2>Profile</h2><span>{{ data.membership.status || 'standard' }}</span></div><div class="list"><div class="row"><strong>Phone</strong><span>{{ data.profile.phone || '-' }}</span></div><div class="row"><strong>Email</strong><span>{{ data.profile.email || '-' }}</span></div><div class="row"><strong>Birthday</strong><span>{{ data.profile.birthday || '-' }}</span></div><div class="row"><strong>Preferred</strong><span>{{ data.profile.preferredStylist || '-' }}</span></div></div></article>
          <article class="panel"><div class="panel-title"><h2>AI recommendations</h2><span>{{ data.aiRecommendations.length }}</span></div>@for (tip of data.aiRecommendations; track tip) { <p class="insight">{{ tip }}</p> } @empty { <p class="empty">No recommendations yet.</p> }</article>
        </section>
        <section class="grid two">
          <article class="panel"><div class="panel-title"><h2>Preferences</h2><span>{{ data.preferences?.tags?.length || 0 }} tags</span></div><div class="list"><div class="row"><strong>Notes</strong><span>{{ data.preferences?.notes || '-' }}</span></div><div class="row"><strong>Allergies</strong><span>{{ data.preferences?.allergies || '-' }}</span></div><div class="row"><strong>Preferred</strong><span>{{ data.preferences?.preferredStylist || '-' }}</span></div></div></article>
          <article class="panel"><div class="panel-title"><h2>Media portfolio</h2><span>{{ data.mediaPortfolio?.length || 0 }}</span></div><div class="form-grid compact-grid"><label>Title<input [(ngModel)]="mediaTitle" [disabled]="mediaPending()" /></label><label>Type<input [(ngModel)]="mediaType" [disabled]="mediaPending()" /></label><label>Upload<input type="file" accept="image/jpeg,image/png,image/webp" [disabled]="mediaPending()" (change)="onMediaFile($event)" /></label></div>@if (mediaFileName()) { <p class="insight">Ready to upload: {{ mediaFileName() }}</p> }@if (mediaPreviewUrl()) { <div class="media-thumb"><img [src]="mediaPreviewUrl()" [alt]="mediaFileName()" /></div> }@if (mediaPending()) { <p class="insight">{{ mediaProgress() === null ? 'Uploading...' : 'Uploading ' + mediaProgress() + '%' }}</p> }<button class="link-button" type="button" [disabled]="mediaPending() || !mediaFileName()" (click)="addMedia()">{{ mediaPending() ? 'Adding...' : 'Add media' }}</button>@if (mediaFileName()) { <button class="link-button" type="button" (click)="cancelMedia()">Cancel</button> }<div class="media-grid">@for (media of data.mediaPortfolio || []; track media.id) { <article><div class="media-thumb">@if (mediaObjectUrls()[media.id]; as mediaSrc) { <img [src]="mediaSrc" [alt]="media.title" /> } @else { {{ media.type }} } </div><strong>{{ media.title }}</strong><small>{{ media.createdAt || 'ready for upload' }}</small></article> } @empty { <p class="empty">No media attached yet.</p> }</div></article>
        </section>
        <section class="panel"><div class="panel-title"><h2>Previous services</h2><span>{{ data.previousServices.length }}</span></div><div class="list">@for (item of data.previousServices; track item.id) { <div class="row"><div class="row-main"><strong>{{ item.startAt | date:'mediumDate' }}</strong><small>{{ item.serviceIds.join(', ') || 'Service' }}</small></div><span class="badge">{{ item.status }}</span></div> } @empty { <p class="empty">No previous services found.</p> }</div></section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffClient360Page implements OnInit, OnDestroy {
  readonly client = signal<StaffClient360 | null>(null);
  readonly dashboard = signal<StaffDashboard | null>(null);
  readonly loading = signal(false);
  readonly clientId = signal("");
  mediaTitle = "Before/after photo";
  mediaType = "photo";
  readonly mediaFileName = signal("");
  readonly mediaPreviewUrl = signal("");
  readonly mediaProgress = signal<number | null>(null);
  readonly mediaObjectUrls = signal<Record<string, string>>({});
  readonly mediaPending = signal(false);
  readonly message = signal("");
  readonly localError = signal("");
  readonly clients = computed(() => {
    const map = new Map<string, { id: string; name: string; phone: string }>();
    for (const item of this.dashboard()?.todayAppointments || []) if (item.clientId) map.set(item.clientId, { id: item.clientId, name: item.clientName || item.clientId, phone: item.clientPhone || "" });
    return [...map.values()];
  });
  constructor(readonly staff: StaffAppService, private readonly route: ActivatedRoute) {}
  private routeSubscription?: Subscription;
  private mediaUploadSubscription?: Subscription;
  private mediaLoadSubscriptions = new Subscription();
  private mediaFile?: File;
  private mediaIdempotencyKey = "";
  private loadGeneration = 0;
  ngOnInit() { this.routeSubscription = this.route.paramMap.subscribe((params) => void this.load(params.get("id") || "")); }
  ngOnDestroy() { this.routeSubscription?.unsubscribe(); this.cancelMedia(); this.revokeMediaObjectUrls(); }
  async load(id = this.route.snapshot.paramMap.get("id") || "") {
    const generation = ++this.loadGeneration;
    this.client.set(null);
    this.dashboard.set(null);
    this.cancelMedia();
    this.revokeMediaObjectUrls();
    this.message.set("");
    this.localError.set("");
    this.clientId.set(id);
    this.loading.set(true);
    try {
      if (id) { const client = await this.staff.client360(id); if (generation === this.loadGeneration) { this.client.set(client); this.loadMediaObjectUrls(client, generation); } }
      else { const dashboard = await this.staff.dashboard(); if (generation === this.loadGeneration) this.dashboard.set(dashboard); }
    } catch { if (generation === this.loadGeneration) this.localError.set(this.staff.error() || "Unable to load Client 360."); }
    finally { if (generation === this.loadGeneration) this.loading.set(false); }
  }

  addMedia() {
    const id = this.clientId();
    const file = this.mediaFile;
    if (!id || !file || !this.mediaTitle.trim() || !this.mediaIdempotencyKey || this.mediaPending()) return;
    this.mediaPending.set(true);
    this.mediaProgress.set(0);
    this.message.set("");
    this.localError.set("");
    this.mediaUploadSubscription = this.staff.addClientMedia(id, file, { title: this.mediaTitle.trim(), type: this.mediaType.trim() || "photo" }, this.mediaIdempotencyKey).subscribe({
      next: (event) => {
        if (event.state === "progress") { this.mediaProgress.set(event.progress); return; }
        const current = this.client();
        this.clearMediaSelection();
        this.mediaPending.set(false);
        this.message.set("Media added.");
        if (current && id === this.clientId()) {
          const client = { ...current, mediaPortfolio: [event.media, ...(current.mediaPortfolio || []).filter((media) => media.id !== event.media.id)] };
          this.client.set(client);
          this.loadMediaObjectUrls(client, this.loadGeneration);
        }
      },
      error: () => { this.mediaPending.set(false); this.localError.set(this.staff.error() || "Unable to add client media."); }
    });
  }

  onMediaFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.localError.set("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { this.localError.set("Choose a JPEG, PNG, or WebP image."); input.value = ""; this.clearMediaSelection(); return; }
    if (file.size > 5 * 1024 * 1024) { this.localError.set("Image must be 5 MB or smaller."); input.value = ""; this.clearMediaSelection(); return; }
    this.clearMediaSelection();
    this.mediaFile = file;
    this.mediaIdempotencyKey = crypto.randomUUID();
    this.mediaFileName.set(file.name);
    this.mediaPreviewUrl.set(URL.createObjectURL(file));
  }

  cancelMedia() {
    this.mediaUploadSubscription?.unsubscribe();
    this.mediaUploadSubscription = undefined;
    this.mediaPending.set(false);
    this.clearMediaSelection();
  }

  private clearMediaSelection() {
    if (this.mediaPreviewUrl()) URL.revokeObjectURL(this.mediaPreviewUrl());
    this.mediaFile = undefined;
    this.mediaIdempotencyKey = "";
    this.mediaFileName.set("");
    this.mediaPreviewUrl.set("");
    this.mediaProgress.set(null);
  }

  private loadMediaObjectUrls(client: StaffClient360, generation: number) {
    this.revokeMediaObjectUrls();
    for (const media of client.mediaPortfolio || []) {
      if (!media.url) continue;
      try {
        this.mediaLoadSubscriptions.add(this.staff.clientMediaBlob(media.url).subscribe({
          next: (blob) => {
            if (generation !== this.loadGeneration) return;
            const objectUrl = URL.createObjectURL(blob);
            const previous = this.mediaObjectUrls()[media.id];
            if (previous) URL.revokeObjectURL(previous);
            this.mediaObjectUrls.update((urls) => ({ ...urls, [media.id]: objectUrl }));
          },
          error: () => {}
        }));
      } catch {
        // Historical external URLs stay hidden instead of blocking the portfolio.
      }
    }
  }

  private revokeMediaObjectUrls() {
    this.mediaLoadSubscriptions.unsubscribe();
    this.mediaLoadSubscriptions = new Subscription();
    for (const url of Object.values(this.mediaObjectUrls())) URL.revokeObjectURL(url);
    this.mediaObjectUrls.set({});
  }
}
