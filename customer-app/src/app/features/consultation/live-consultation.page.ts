import { Component, OnInit, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { IonButton, IonContent, IonIcon, IonTextarea } from "@ionic/angular/standalone";
import { firstValueFrom } from "rxjs";
import { addIcons } from "ionicons";
import {
  arrowBackOutline,
  cameraOutline,
  chatbubblesOutline,
  checkmarkCircleOutline,
  chevronForwardOutline,
  closeOutline,
  compassOutline,
  locationOutline,
  navigateOutline,
  searchOutline,
  shieldCheckmarkOutline,
  sparklesOutline
} from "ionicons/icons";
import { Business, LiveConsultationBusinessContext, LiveConsultationPhoto, LiveConsultationResponse } from "../../core/api.types";
import { CustomerApiService } from "../../core/customer-api.service";
import { MarketplaceService } from "../../core/marketplace.service";
import { BusinessCardComponent } from "../../shared/business-card.component";

interface ConsultationChatMessage {
  role: "customer" | "assistant";
  text: string;
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IonButton, IonContent, IonIcon, IonTextarea, BusinessCardComponent],
  template: `
    <ion-content>
      <main class="page consultation-page">
        <section class="consultation-hero">
          <button type="button" class="back-button" routerLink="/tabs/home" aria-label="Back to home">
            <ion-icon name="arrow-back-outline"></ion-icon>
          </button>
          <div class="hero-copy">
            <p class="eyebrow">Aura Shine live consultation</p>
            <h1 class="page-title">Chat, upload photos, and get the right salon plan</h1>
            <p class="muted">Groq-powered guidance now, Gemini-ready later. Aura uses your concern, photo context, goals, location and live marketplace data to suggest salons, services, prep and booking next steps.</p>
            <div class="hero-actions">
              <ion-button class="primary-gradient" (click)="focusComposer()">
                <ion-icon name="chatbubbles-outline" slot="start"></ion-icon>
                Start consult
              </ion-button>
              <ion-button fill="outline" class="secondary-button" (click)="useCurrentLocation()" [disabled]="locating()">
                <ion-icon name="navigate-outline" slot="start"></ion-icon>
                {{ locating() ? "Detecting" : "Use location" }}
              </ion-button>
            </div>
          </div>
          <aside class="hero-panel premium-card">
            <span><ion-icon name="sparkles-outline"></ion-icon> {{ providerLabel() }}</span>
            <strong>{{ matchedBusinesses().length }} salons in context</strong>
            <small>{{ areaLabel() }} · {{ consultationPhotos().length }} photo{{ consultationPhotos().length === 1 ? "" : "s" }} attached</small>
          </aside>
        </section>

        <section class="consultation-shell">
          <article class="consultation-workspace premium-card">
            <header class="panel-header">
              <div>
                <p class="eyebrow">Live chat</p>
                <h2>Tell Aura what you need</h2>
              </div>
              <button type="button" class="location-chip" (click)="useCurrentLocation()">
                <ion-icon name="location-outline"></ion-icon>
                {{ areaLabel() }}
              </button>
            </header>

            <div class="goal-grid" aria-label="Consultation goals">
              @for (goal of consultationGoals; track goal) {
                <button type="button" [class.active]="selectedConsultationGoals().includes(goal)" (click)="toggleGoal(goal)">
                  {{ goal }}
                </button>
              }
            </div>

            <div class="chat-thread" aria-live="polite">
              @for (message of consultationMessages(); track message.role + message.text) {
                <div class="chat-message" [class.customer]="message.role === 'customer'">
                  <strong>{{ message.role === "customer" ? "You" : "Aura AI" }}</strong>
                  <span>{{ message.text }}</span>
                </div>
              }
            </div>

            <label class="composer-label" id="consultation-composer">
              Consultation details
              <ion-textarea
                rows="6"
                autoGrow="true"
                [(ngModel)]="consultationText"
                placeholder="Example: I need hair color correction before a wedding next week. Budget INR 4000. Prefer nearby salons and safe patch-test advice.">
              </ion-textarea>
            </label>

            <div class="photo-uploader">
              <input #photoInput type="file" accept="image/*" multiple hidden (change)="addPhotos($event)" />
              <button type="button" class="upload-button" (click)="photoInput.click()">
                <ion-icon name="camera-outline"></ion-icon>
                Add photos
              </button>
              <span>Up to 5 images, 2 MB each</span>
            </div>

            @if (consultationPhotos().length) {
              <div class="photo-strip" aria-label="Attached consultation photos">
                @for (photo of consultationPhotos(); track photo.name) {
                  <button type="button" (click)="removePhoto(photo.name)" [attr.aria-label]="'Remove ' + photo.name">
                    <img [src]="photo.dataUrl" [alt]="photo.name" />
                    <ion-icon name="close-outline"></ion-icon>
                  </button>
                }
              </div>
            }

            @if (locationNotice()) {
              <p class="notice-text inline-notice">{{ locationNotice() }}</p>
            }
            @if (consultationError()) {
              <p class="error-text inline-notice">{{ consultationError() }}</p>
            }

            <footer class="workspace-actions">
              <ion-button class="primary-gradient" (click)="sendConsultation()" [disabled]="consultationLoading()">
                <ion-icon name="sparkles-outline" slot="start"></ion-icon>
                {{ consultationLoading() ? "Consulting" : "Get salon plan" }}
              </ion-button>
              <ion-button fill="outline" class="secondary-button" routerLink="/tabs/search">
                <ion-icon name="search-outline" slot="start"></ion-icon>
                Discover
              </ion-button>
            </footer>
          </article>

          <aside class="consultation-side">
            <section class="premium-card context-card">
              <p class="eyebrow">A to Z context</p>
              <h2>What Aura checks</h2>
              <div class="context-list">
                @for (item of contextItems; track item.title) {
                  <div>
                    <ion-icon [name]="item.icon"></ion-icon>
                    <span>
                      <strong>{{ item.title }}</strong>
                      <small>{{ item.copy }}</small>
                    </span>
                  </div>
                }
              </div>
            </section>

            <section class="premium-card context-card">
              <p class="eyebrow">Nearby salon context</p>
              <h2>{{ matchedBusinesses().length }} matched places</h2>
              <div class="mini-salon-list">
                @for (business of matchedBusinesses().slice(0, 4); track business.id) {
                  <button type="button" (click)="openBusiness(business.slug)">
                    <strong>{{ business.businessName }}</strong>
                    <small>{{ locationLine(business) }} · {{ money(business.startingPricePaise) }}</small>
                    <ion-icon name="chevron-forward-outline"></ion-icon>
                  </button>
                } @empty {
                  <p class="muted">Marketplace data is loading. Consultation still works with your message and photos.</p>
                }
              </div>
            </section>
          </aside>
        </section>

        @if (consultationResponse(); as response) {
          <section class="results-panel premium-card">
            <header class="panel-header">
              <div>
                <p class="eyebrow">{{ response.mode === "groq" ? "Groq AI result" : "Smart local result" }}</p>
                <h2>Your consultation plan</h2>
              </div>
              <span class="result-id">{{ response.consultationId }}</span>
            </header>
            @if (response.providerWarning) {
              <p class="notice-text inline-notice">{{ response.providerWarning }}</p>
            }
            <p class="answer-copy">{{ response.answer }}</p>
            <div class="result-grid">
              <section>
                <h3><ion-icon name="checkmark-circle-outline"></ion-icon> Action plan</h3>
                <ol>
                  @for (step of response.actionPlan; track step) {
                    <li>{{ step }}</li>
                  }
                </ol>
              </section>
              <section>
                <h3><ion-icon name="location-outline"></ion-icon> Location details</h3>
                <ul>
                  @for (item of response.locationInsights; track item) {
                    <li>{{ item }}</li>
                  }
                </ul>
              </section>
              <section>
                <h3><ion-icon name="chatbubbles-outline"></ion-icon> Follow-up questions</h3>
                <ul>
                  @for (question of response.followUpQuestions; track question) {
                    <li>{{ question }}</li>
                  }
                </ul>
              </section>
              <section>
                <h3><ion-icon name="shield-checkmark-outline"></ion-icon> Safety</h3>
                <p>{{ response.safetyNote }}</p>
              </section>
            </div>
          </section>

          <div class="section-heading">
            <div>
              <p class="eyebrow">Recommended salons</p>
              <h2 class="section-title">Best matches for this consult</h2>
            </div>
          </div>
          <div class="recommendation-grid">
            @for (salon of response.recommendedSalons; track salon.slug || salon.businessName) {
              <article class="recommendation-card premium-card">
                <span>{{ salon.openStatus || "Check slots" }}</span>
                <h3>{{ salon.businessName }}</h3>
                <p>{{ salon.reason }}</p>
                <small>{{ salon.location }}{{ salon.distanceKm ? " · " + salon.distanceKm + " km" : "" }}</small>
                <ion-button size="small" class="primary-gradient" (click)="openBusiness(salon.slug)">
                  View salon
                </ion-button>
              </article>
            }
          </div>

          <div class="section-heading">
            <div>
              <p class="eyebrow">Recommended services</p>
              <h2 class="section-title">Service plan</h2>
            </div>
          </div>
          <div class="service-grid">
            @for (service of response.recommendedServices; track service.name + service.businessName) {
              <article class="service-plan-card premium-card">
                <strong>{{ service.name }}</strong>
                <span>{{ service.businessName }}</span>
                <small>{{ service.priceLabel }} · {{ service.durationLabel }}</small>
                <p>{{ service.reason }}</p>
                <button type="button" (click)="openBusiness(service.slug)">
                  Check availability
                  <ion-icon name="chevron-forward-outline"></ion-icon>
                </button>
              </article>
            }
          </div>
        }

        @if (!consultationResponse()) {
          <div class="section-heading">
            <div>
              <p class="eyebrow">Live marketplace</p>
              <h2 class="section-title">Salons Aura can recommend</h2>
            </div>
          </div>
          <div class="business-grid recommended">
            @for (business of matchedBusinesses().slice(0, 6); track business.id) {
              <aura-business-card [business]="business" [userLocation]="currentLocation()"></aura-business-card>
            }
          </div>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .consultation-page {
      display: grid;
      gap: 22px;
    }

    .consultation-hero {
      position: relative;
      display: grid;
      gap: 22px;
      min-height: 430px;
      padding: 28px;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius-xl);
      background:
        radial-gradient(circle at 10% 14%, rgba(214, 169, 74, 0.26), transparent 32%),
        linear-gradient(135deg, rgba(255, 251, 241, 0.98), rgba(246, 228, 193, 0.94));
      box-shadow: 0 28px 74px rgba(92, 65, 28, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.78);
    }

    .back-button,
    .location-chip,
    .upload-button,
    .mini-salon-list button,
    .service-plan-card button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 1px solid rgba(214, 169, 74, 0.28);
      color: var(--text);
      background: rgba(255, 249, 236, 0.92);
      font-weight: 900;
    }

    .back-button {
      width: 46px;
      height: 46px;
      border-radius: 999px;
      font-size: 1.25rem;
    }

    .hero-copy {
      display: grid;
      align-content: center;
      gap: 16px;
      max-width: 780px;
    }

    .hero-copy .muted {
      max-width: 700px;
      margin: 0;
      color: #7E6E55;
      font-size: 1.06rem;
    }

    .hero-actions,
    .workspace-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .hero-panel {
      align-self: end;
      display: grid;
      gap: 8px;
      padding: 18px;
    }

    .hero-panel span {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--primary);
      font-weight: 900;
    }

    .hero-panel strong {
      font-size: 1.4rem;
    }

    .consultation-shell {
      display: grid;
      gap: 18px;
    }

    .consultation-workspace,
    .context-card,
    .results-panel {
      display: grid;
      gap: 16px;
      padding: 18px;
    }

    .panel-header {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 14px;
    }

    .panel-header h2,
    .context-card h2,
    .recommendation-card h3 {
      margin: 0;
      font-size: clamp(1.35rem, 2vw, 1.95rem);
      line-height: 1.08;
    }

    .location-chip {
      min-height: 42px;
      padding: 0 12px;
      border-radius: 999px;
      white-space: nowrap;
    }

    .goal-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .goal-grid button {
      min-height: 46px;
      padding: 10px 12px;
      border: 1px solid rgba(214, 169, 74, 0.22);
      border-radius: 16px;
      color: var(--text);
      background: rgba(255, 249, 236, 0.92);
      font-weight: 900;
      text-align: left;
    }

    .goal-grid button.active {
      color: #120D05;
      border-color: transparent;
      background: linear-gradient(135deg, #F4D58D, #D6A94A 58%, #9B6B22);
    }

    .chat-thread {
      display: grid;
      gap: 10px;
      max-height: 360px;
      overflow: auto;
      padding: 12px;
      border: 1px solid rgba(214, 169, 74, 0.18);
      border-radius: 22px;
      background: rgba(255, 249, 236, 0.72);
    }

    .chat-message {
      justify-self: start;
      display: grid;
      gap: 4px;
      max-width: min(92%, 680px);
      padding: 12px 14px;
      border: 1px solid rgba(214, 169, 74, 0.2);
      border-radius: 18px 18px 18px 6px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.82);
      font-weight: 800;
      line-height: 1.45;
    }

    .chat-message.customer {
      justify-self: end;
      border-radius: 18px 18px 6px 18px;
      color: #120D05;
      background: linear-gradient(135deg, rgba(244, 213, 141, 0.92), rgba(214, 169, 74, 0.7));
    }

    .chat-message strong {
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .composer-label {
      display: grid;
      gap: 8px;
      color: var(--text);
      font-weight: 900;
    }

    ion-textarea {
      --background: rgba(255, 249, 236, 0.94);
      --border-radius: 20px;
      --color: var(--text);
      --placeholder-color: rgba(126, 110, 85, 0.66);
      padding: 12px;
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 20px;
    }

    .photo-uploader {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
    }

    .upload-button {
      min-height: 46px;
      padding: 0 14px;
      border-radius: 999px;
    }

    .photo-uploader span,
    .hero-panel small,
    .result-id {
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 900;
    }

    .photo-strip {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: 92px;
      gap: 10px;
      overflow-x: auto;
    }

    .photo-strip button {
      position: relative;
      height: 92px;
      padding: 0;
      overflow: hidden;
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 18px;
      background: rgba(255, 249, 236, 0.92);
    }

    .photo-strip img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .photo-strip ion-icon {
      position: absolute;
      top: 6px;
      right: 6px;
      padding: 4px;
      border-radius: 999px;
      color: #120D05;
      background: rgba(255, 249, 236, 0.9);
    }

    .inline-notice {
      margin: 0;
      padding: 10px 12px;
      border: 1px solid;
      border-radius: 16px;
      font-weight: 800;
      line-height: 1.4;
    }

    .consultation-side {
      display: grid;
      gap: 14px;
      align-content: start;
    }

    .context-list,
    .mini-salon-list {
      display: grid;
      gap: 10px;
    }

    .context-list div {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      padding: 12px;
      border: 1px solid rgba(214, 169, 74, 0.18);
      border-radius: 18px;
      background: rgba(255, 249, 236, 0.72);
    }

    .context-list ion-icon {
      width: 38px;
      height: 38px;
      padding: 9px;
      border-radius: 14px;
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A);
    }

    .context-list small,
    .mini-salon-list small,
    .recommendation-card small,
    .service-plan-card small {
      display: block;
      color: var(--muted);
      font-weight: 800;
      line-height: 1.42;
    }

    .mini-salon-list button,
    .service-plan-card button {
      justify-content: space-between;
      width: 100%;
      min-height: 62px;
      padding: 12px;
      border-radius: 18px;
      text-align: left;
    }

    .answer-copy {
      margin: 0;
      color: var(--text);
      font-size: 1.03rem;
      font-weight: 800;
      line-height: 1.6;
    }

    .result-grid,
    .recommendation-grid,
    .service-grid {
      display: grid;
      gap: 12px;
    }

    .result-grid section {
      padding: 14px;
      border: 1px solid rgba(214, 169, 74, 0.18);
      border-radius: 20px;
      background: rgba(255, 249, 236, 0.72);
    }

    .result-grid h3 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 10px;
      font-size: 1rem;
    }

    .result-grid ol,
    .result-grid ul {
      margin: 0;
      padding-left: 20px;
      color: var(--muted);
      font-weight: 800;
      line-height: 1.5;
    }

    .result-grid p,
    .recommendation-card p,
    .service-plan-card p {
      margin: 0;
      color: var(--muted);
      font-weight: 800;
      line-height: 1.5;
    }

    .recommendation-card,
    .service-plan-card {
      display: grid;
      gap: 10px;
      padding: 16px;
    }

    .recommendation-card span,
    .service-plan-card span {
      width: fit-content;
      padding: 5px 9px;
      border-radius: 999px;
      color: #120D05;
      background: rgba(244, 213, 141, 0.78);
      font-size: 0.76rem;
      font-weight: 900;
    }

    .business-grid {
      display: grid;
      gap: 14px;
    }

    @media (min-width: 860px) {
      .consultation-hero {
        grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
      }

      .consultation-shell {
        grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
        align-items: start;
      }

      .goal-grid,
      .result-grid,
      .recommendation-grid,
      .service-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .business-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (min-width: 1280px) {
      .goal-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .recommendation-grid,
      .service-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 599px) {
      .consultation-hero,
      .consultation-workspace,
      .context-card,
      .results-panel {
        padding: 16px;
      }

      .panel-header {
        display: grid;
      }

      .goal-grid {
        grid-template-columns: 1fr;
      }

      .hero-actions ion-button,
      .workspace-actions ion-button {
        width: 100%;
      }
    }
  `]
})
export class LiveConsultationPage implements OnInit {
  readonly consultationGoals = ["Hair transformation", "Skin or facial", "Nails", "Spa wellness", "Barber grooming", "Bridal/event", "Budget plan", "Near me"];
  readonly contextItems = [
    { icon: "camera-outline", title: "Photos", copy: "Uploads are sent as consultation context for visible hair, skin, nail or style references." },
    { icon: "compass-outline", title: "Location", copy: "Area, distance, address, open status, slots, map/contact clues and travel fit." },
    { icon: "search-outline", title: "Services", copy: "Matching services, prices in paise-backed catalog data, duration and booking next step." },
    { icon: "shield-checkmark-outline", title: "Safety", copy: "Patch-test, sensitivity and medical escalation notes without diagnosis." }
  ];

  consultationText = "";
  readonly currentLocation = signal<{ lat: number; lng: number } | null>(this.savedLocation());
  readonly areaLabel = signal(localStorage.getItem("aura_customer_area_label") || "Near me");
  readonly locating = signal(false);
  readonly locationNotice = signal("");
  readonly selectedConsultationGoals = signal<string[]>(["Near me"]);
  readonly consultationPhotos = signal<LiveConsultationPhoto[]>([]);
  readonly consultationLoading = signal(false);
  readonly consultationError = signal("");
  readonly consultationResponse = signal<LiveConsultationResponse | null>(null);
  readonly consultationMessages = signal<ConsultationChatMessage[]>([
    {
      role: "assistant",
      text: "Tell me your goal, budget, timing, area and any sensitivity history. Add photos if visual review helps."
    }
  ]);
  readonly matchedBusinesses = computed(() => this.marketplace.businesses()
    .filter((business) => business.services?.length || business.popularService || business.category)
    .slice(0, 12));
  readonly providerLabel = computed(() => {
    const response = this.consultationResponse();
    if (response?.mode === "groq") return "Groq AI live";
    if (response?.mode === "gemini") return "Gemini AI live";
    return "AI consultation ready";
  });

  constructor(
    readonly marketplace: MarketplaceService,
    private readonly api: CustomerApiService,
    private readonly router: Router
  ) {
    addIcons({
      arrowBackOutline,
      cameraOutline,
      chatbubblesOutline,
      checkmarkCircleOutline,
      chevronForwardOutline,
      closeOutline,
      compassOutline,
      locationOutline,
      navigateOutline,
      searchOutline,
      shieldCheckmarkOutline,
      sparklesOutline
    });
  }

  ngOnInit() {
    void Promise.all([
      this.marketplace.loadPublicBusinesses(),
      this.marketplace.loadCategories()
    ]).catch(() => undefined);
  }

  focusComposer() {
    document.getElementById("consultation-composer")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  toggleGoal(goal: string) {
    const current = new Set(this.selectedConsultationGoals());
    current.has(goal) ? current.delete(goal) : current.add(goal);
    this.selectedConsultationGoals.set([...current]);
  }

  async addPhotos(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length) return;
    this.consultationError.set("");
    const existing = this.consultationPhotos();
    const accepted: LiveConsultationPhoto[] = [];
    for (const file of files.slice(0, Math.max(0, 5 - existing.length))) {
      if (!file.type.startsWith("image/")) {
        this.consultationError.set("Only image files are allowed.");
        continue;
      }
      const totalSize = [...existing, ...accepted].reduce((sum, photo) => sum + photo.sizeBytes, 0) + file.size;
      if (file.size > 2 * 1024 * 1024) {
        this.consultationError.set("Each photo must be under 2 MB.");
        continue;
      }
      if (totalSize > 5 * 1024 * 1024) {
        this.consultationError.set("All consultation photos together must stay under 5 MB.");
        continue;
      }
      accepted.push({
        name: `${Date.now()}-${file.name}`,
        type: file.type || "image/jpeg",
        sizeBytes: file.size,
        dataUrl: await this.readPhotoDataUrl(file)
      });
    }
    if (existing.length + accepted.length > 5) {
      this.consultationError.set("Maximum 5 photos allowed in one consultation.");
    }
    this.consultationPhotos.set([...existing, ...accepted].slice(0, 5));
  }

  removePhoto(name: string) {
    this.consultationPhotos.set(this.consultationPhotos().filter((photo) => photo.name !== name));
  }

  async sendConsultation() {
    const message = this.consultationText.trim();
    const goals = this.selectedConsultationGoals();
    if (!message && !goals.length && !this.consultationPhotos().length) {
      this.consultationError.set("Write a question, choose a goal, or add a photo.");
      return;
    }
    this.consultationLoading.set(true);
    this.consultationError.set("");
    this.consultationMessages.update((items) => [...items, {
      role: "customer",
      text: message || `Need help with ${goals.join(", ")}`
    }]);
    try {
      const response = await firstValueFrom(this.api.createLiveConsultation({
        message,
        goals,
        location: this.currentLocation() ? { ...this.currentLocation(), label: this.areaLabel() } : { label: this.areaLabel() },
        photos: this.consultationPhotos(),
        businesses: this.consultationBusinessContext()
      }));
      this.consultationResponse.set(response);
      this.consultationMessages.update((items) => [...items, { role: "assistant", text: response.answer }]);
      this.consultationText = "";
    } catch (error) {
      this.consultationError.set(error instanceof Error ? error.message : "Unable to start live consultation.");
    } finally {
      this.consultationLoading.set(false);
    }
  }

  useCurrentLocation() {
    if (!navigator.geolocation) {
      this.locationNotice.set("Location is not supported in this browser.");
      return;
    }
    this.locating.set(true);
    this.locationNotice.set("Allow location access to improve salon matching.");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
        const label = await this.resolveAreaLabel(coordinates);
        this.currentLocation.set(coordinates);
        this.areaLabel.set(label);
        localStorage.setItem("aura_customer_area_label", label);
        localStorage.setItem("aura_customer_location", JSON.stringify(coordinates));
        this.locating.set(false);
        this.locationNotice.set(`Using ${label} for salon, service and travel suggestions.`);
      },
      (error) => {
        this.locating.set(false);
        this.locationNotice.set(error.code === 1
          ? "Location permission is blocked. You can still consult by typing your area."
          : "Could not detect your area. Please try again.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }

  openBusiness(slug: string) {
    if (!slug) return;
    void this.router.navigate(["/business", slug]);
  }

  money(pricePaise: number): string {
    return this.marketplace.formatMoney(pricePaise);
  }

  locationLine(business: Business): string {
    return [business.area, business.city, business.state].filter(Boolean).join(", ") || business.address || "Location updating";
  }

  private consultationBusinessContext(): LiveConsultationBusinessContext[] {
    return this.matchedBusinesses().slice(0, 12).map((business) => ({
      id: business.id,
      slug: business.slug,
      businessName: business.businessName,
      category: business.category,
      description: business.description,
      address: business.address,
      area: business.area,
      city: business.city,
      state: business.state,
      country: business.country,
      phone: business.phone || business.mobileNumber || business.appointmentNumber,
      mapsUrl: business.mapsUrl,
      ratingAverage: business.ratingAverage,
      ratingCount: business.ratingCount,
      distanceKm: business.distanceKm,
      isOpen: business.isOpen,
      hoursLabel: business.hoursLabel,
      nextAvailableSlot: business.nextAvailableSlot,
      startingPricePaise: business.startingPricePaise,
      popularService: business.popularService,
      services: business.services.slice(0, 8).map((service) => ({
        id: service.id,
        name: service.name,
        category: service.category,
        description: service.description,
        pricePaise: service.pricePaise,
        durationMinutes: service.durationMinutes
      }))
    }));
  }

  private readPhotoDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Unable to read photo"));
      reader.readAsDataURL(file);
    });
  }

  private savedLocation(): { lat: number; lng: number } | null {
    try {
      const parsed = JSON.parse(localStorage.getItem("aura_customer_location") || "null") as { lat?: number; lng?: number } | null;
      const lat = Number(parsed?.lat);
      const lng = Number(parsed?.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    } catch {
      return null;
    }
  }

  private async resolveAreaLabel(coordinates: { lat: number; lng: number }): Promise<string> {
    const nearest = this.nearestBusiness(coordinates);
    if (nearest) return nearest.area || nearest.city || nearest.businessName;
    return "Detected area";
  }

  private nearestBusiness(coordinates: { lat: number; lng: number }): Business | null {
    return this.marketplace.businesses()
      .map((business) => {
        const lat = Number(business.latitude);
        const lng = Number(business.longitude);
        return {
          business,
          distance: Number.isFinite(lat) && Number.isFinite(lng)
            ? this.distanceKm(coordinates, { lat, lng })
            : Number.MAX_SAFE_INTEGER
        };
      })
      .filter((item) => item.distance !== Number.MAX_SAFE_INTEGER)
      .sort((left, right) => left.distance - right.distance)[0]?.business ?? null;
  }

  private distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
    const toRadians = (value: number) => value * Math.PI / 180;
    const dLat = toRadians(to.lat - from.lat);
    const dLng = toRadians(to.lng - from.lng);
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
  }
}
