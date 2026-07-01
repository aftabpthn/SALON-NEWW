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
import { Business, LiveConsultationBusinessContext, LiveConsultationPhoto, LiveConsultationProblemProfile, LiveConsultationResponse } from "../../core/api.types";
import { CustomerApiService } from "../../core/customer-api.service";
import { MarketplaceService } from "../../core/marketplace.service";

interface ConsultationChatMessage {
  role: "customer" | "assistant";
  text: string;
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IonButton, IonContent, IonIcon, IonTextarea],
  template: `
    <ion-content>
      <main class="page consultation-page chat-page">
        <section class="chat-bot-shell premium-card">
          <header class="chat-bot-header">
            <button type="button" class="back-button" routerLink="/tabs/home" aria-label="Back to home">
              <ion-icon name="arrow-back-outline"></ion-icon>
            </button>
            <div class="bot-mark" aria-hidden="true">
              <ion-icon name="sparkles-outline"></ion-icon>
            </div>
            <div class="chat-title">
              <h1>Aura Consult</h1>
              <span>{{ areaLabel() }} · {{ matchedBusinesses().length }} salons in context · {{ consultationPhotos().length }} photo{{ consultationPhotos().length === 1 ? "" : "s" }}</span>
            </div>
            <button type="button" class="location-chip" (click)="useCurrentLocation()" [disabled]="locating()">
              <ion-icon name="navigate-outline"></ion-icon>
              {{ locating() ? "Detecting" : areaLabel() }}
            </button>
          </header>

          <div class="goal-grid" aria-label="Quick consultation prompts">
            @for (goal of consultationGoals; track goal) {
              <button type="button" [class.active]="selectedConsultationGoals().includes(goal)" (click)="toggleGoal(goal)">
                {{ goal }}
              </button>
            }
          </div>

          <section class="chat-thread" aria-live="polite">
            @for (message of consultationMessages(); track message.role + message.text) {
              <div class="chat-message" [class.customer]="message.role === 'customer'">
                <strong>{{ message.role === "customer" ? "You" : "Aura AI" }}</strong>
                <span>{{ message.text }}</span>
              </div>
            }

            @if (!consultationResponse() && matchedBusinesses().length) {
              <div class="chat-message system-message">
                <strong>Nearby context</strong>
                <span>I can use {{ matchedBusinesses().length }} salon profiles near {{ areaLabel() }} while planning.</span>
                <div class="compact-cards">
                  @for (business of matchedBusinesses().slice(0, 3); track business.id) {
                    <button type="button" (click)="openBusiness(business.slug)">
                      <b>{{ business.businessName }}</b>
                      <small>{{ locationLine(business) }} · {{ money(business.startingPricePaise) }}</small>
                    </button>
                  }
                </div>
              </div>
            }

            @if (consultationResponse(); as response) {
              <div class="chat-message plan-message">
                <strong>Aura plan</strong>
                @if (response.providerWarning) {
                  <span class="notice-text">{{ response.providerWarning }}</span>
                }
                <span class="answer-copy">{{ response.answer }}</span>

                <div class="consult-summary-grid">
                  <article>
                    <span>Concern</span>
                    <strong>{{ response.concernSummary || consultationText || "Beauty consultation" }}</strong>
                  </article>
                  <article>
                    <span>Stage</span>
                    <strong>{{ response.consultationStage || "Planning" }}</strong>
                  </article>
                  <article>
                    <span>Confidence</span>
                    <strong>{{ response.confidence || "Needs confirmation" }}</strong>
                  </article>
                </div>

                @if (response.missingInfo?.length) {
                  <div class="suggested-replies" aria-label="Aura needs">
                    @for (item of response.missingInfo; track item) {
                      <button type="button" (click)="appendPrompt(item)">{{ item }}</button>
                    }
                  </div>
                }

                @if (response.suggestedReplies?.length) {
                  <div class="suggested-replies" aria-label="Suggested replies">
                    @for (reply of response.suggestedReplies; track reply) {
                      <button type="button" (click)="sendSuggestedReply(reply)">{{ reply }}</button>
                    }
                  </div>
                }

                <details class="plan-details">
                  <summary>View full plan</summary>
                  <div class="result-grid">
                    @if (response.visualAssessment?.length) {
                      <section>
                        <h3><ion-icon name="camera-outline"></ion-icon> Visual read</h3>
                        <ul>
                          @for (item of response.visualAssessment; track item) {
                            <li>{{ item }}</li>
                          }
                        </ul>
                      </section>
                    }
                    @if (response.hairPlan?.length) {
                      <section>
                        <h3><ion-icon name="sparkles-outline"></ion-icon> Service call</h3>
                        <ul>
                          @for (item of response.hairPlan; track item) {
                            <li>{{ item }}</li>
                          }
                        </ul>
                      </section>
                    }
                    <section>
                      <h3><ion-icon name="checkmark-circle-outline"></ion-icon> Action plan</h3>
                      <ol>
                        @for (step of response.actionPlan; track step) {
                          <li>{{ step }}</li>
                        }
                      </ol>
                    </section>
                    <section>
                      <h3><ion-icon name="location-outline"></ion-icon> Location</h3>
                      <ul>
                        @for (item of response.locationInsights; track item) {
                          <li>{{ item }}</li>
                        }
                      </ul>
                    </section>
                    @if (response.preparationChecklist?.length) {
                      <section>
                        <h3><ion-icon name="shield-checkmark-outline"></ion-icon> Before visit</h3>
                        <ul>
                          @for (item of response.preparationChecklist; track item) {
                            <li>{{ item }}</li>
                          }
                        </ul>
                      </section>
                    }
                    @if (response.afterCare?.length) {
                      <section>
                        <h3><ion-icon name="checkmark-circle-outline"></ion-icon> After-care</h3>
                        <ul>
                          @for (item of response.afterCare; track item) {
                            <li>{{ item }}</li>
                          }
                        </ul>
                      </section>
                    }
                    @if (response.budgetInsights?.length) {
                      <section>
                        <h3><ion-icon name="compass-outline"></ion-icon> Budget fit</h3>
                        <ul>
                          @for (item of response.budgetInsights; track item) {
                            <li>{{ item }}</li>
                          }
                        </ul>
                      </section>
                    }
                    <section>
                      <h3><ion-icon name="chatbubbles-outline"></ion-icon> Follow-up</h3>
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
                </details>

                @if (response.recommendedSalons.length) {
                  <div class="compact-cards">
                    @for (salon of response.recommendedSalons.slice(0, 3); track salon.slug || salon.businessName) {
                      <button type="button" (click)="openBusiness(salon.slug)">
                        <b>{{ salon.businessName }}</b>
                        <small>{{ salon.location }}{{ salon.distanceKm ? " · " + salon.distanceKm + " km" : "" }}</small>
                      </button>
                    }
                  </div>
                }

                @if (response.recommendedServices.length) {
                  <div class="compact-cards">
                    @for (service of response.recommendedServices.slice(0, 3); track service.name + service.businessName) {
                      <button type="button" (click)="openBusiness(service.slug)">
                        <b>{{ service.name }}</b>
                        <small>{{ service.businessName }} · {{ service.priceLabel }}</small>
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </section>

          <section class="composer-card" id="consultation-composer">
            <label class="composer-label">
              <span>Message Aura</span>
              <ion-textarea
                rows="3"
                autoGrow="true"
                [(ngModel)]="consultationText"
                placeholder="Ask about hair, skin, nails, spa, budget, timing, allergy, or upload a photo.">
              </ion-textarea>
            </label>

            <details class="chat-options">
              <summary>Details, budget and safety</summary>
              <section class="problem-grid" aria-label="Consultation problem details">
                <label>
                  <span>Time / event</span>
                  <input [(ngModel)]="problemProfile.timeframe" placeholder="Today, weekend, wedding" />
                </label>
                <label>
                  <span>Budget</span>
                  <input [(ngModel)]="problemProfile.budget" placeholder="Under INR 5000" />
                </label>
                <label>
                  <span>History</span>
                  <input [(ngModel)]="problemProfile.history" placeholder="Color, keratin, acne actives" />
                </label>
                <label>
                  <span>Sensitivity</span>
                  <input [(ngModel)]="problemProfile.sensitivities" placeholder="Allergy, itch, pregnancy, none" />
                </label>
              </section>
              <div class="context-list compact-context">
                @for (item of contextItems; track item.title) {
                  <div>
                    <ion-icon [name]="item.icon"></ion-icon>
                    <span><strong>{{ item.title }}</strong><small>{{ item.copy }}</small></span>
                  </div>
                }
              </div>
            </details>

            <input #photoInput type="file" accept="image/*" multiple hidden (change)="addPhotos($event)" />

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
                {{ consultationLoading() ? "Thinking" : consultationResponse() ? "Send" : "Ask Aura" }}
              </ion-button>
              <button type="button" class="upload-button" (click)="photoInput.click()">
                <ion-icon name="camera-outline"></ion-icon>
                Photos
              </button>
              <ion-button fill="outline" class="secondary-button" routerLink="/tabs/search">
                <ion-icon name="search-outline" slot="start"></ion-icon>
                Discover
              </ion-button>
            </footer>
          </section>
        </section>
      </main>
    </ion-content>
  `,
  styles: [`
    .consultation-page {
      max-width: 1040px;
      margin: 0 auto;
      padding-bottom: 96px;
    }

    .chat-bot-shell {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr) auto;
      gap: 12px;
      height: min(780px, calc(100vh - 142px));
      min-height: 620px;
      padding: 16px;
      overflow: hidden;
      border-radius: 28px;
      background: linear-gradient(180deg, rgba(255, 251, 241, 0.98), rgba(246, 228, 193, 0.92));
    }

    .chat-bot-header {
      display: grid;
      grid-template-columns: auto auto minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(214, 169, 74, 0.18);
    }

    .back-button,
    .location-chip,
    .upload-button,
    .compact-cards button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 1px solid rgba(214, 169, 74, 0.28);
      color: var(--text);
      background: rgba(255, 249, 236, 0.92);
      font-weight: 900;
    }

    .back-button,
    .bot-mark {
      width: 42px;
      height: 42px;
      border-radius: 999px;
    }

    .bot-mark {
      display: grid;
      place-items: center;
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A);
      box-shadow: 0 10px 24px rgba(214, 169, 74, 0.2);
    }

    .chat-title {
      min-width: 0;
    }

    .chat-title h1,
    .chat-title p,
    .chat-title span {
      margin: 0;
    }

    .chat-title h1 {
      color: var(--text);
      font-size: clamp(1.25rem, 2.2vw, 1.8rem);
      line-height: 1;
      letter-spacing: 0;
    }

    .chat-title span {
      display: block;
      max-width: 100%;
      overflow: hidden;
      color: var(--muted);
      font-size: 0.84rem;
      font-weight: 800;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .location-chip {
      min-height: 40px;
      max-width: 240px;
      padding: 0 12px;
      border-radius: 999px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .goal-grid {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 2px;
    }

    .goal-grid button,
    .suggested-replies button {
      flex: 0 0 auto;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid rgba(214, 169, 74, 0.28);
      border-radius: 999px;
      color: var(--text);
      background: rgba(255, 249, 236, 0.9);
      font-size: 0.82rem;
      font-weight: 900;
      white-space: nowrap;
    }

    .goal-grid button.active,
    .suggested-replies button:hover {
      color: #120D05;
      border-color: transparent;
      background: linear-gradient(135deg, #F4D58D, #D6A94A 58%, #9B6B22);
    }

    .chat-thread {
      display: grid;
      align-content: start;
      gap: 12px;
      min-height: 0;
      overflow-y: auto;
      padding: 14px;
      border: 1px solid rgba(214, 169, 74, 0.16);
      border-radius: 24px;
      background: rgba(255, 249, 236, 0.62);
      scroll-behavior: smooth;
    }

    .chat-message {
      justify-self: start;
      display: grid;
      gap: 8px;
      width: fit-content;
      max-width: min(76%, 720px);
      padding: 12px 14px;
      border: 1px solid rgba(214, 169, 74, 0.2);
      border-radius: 20px 20px 20px 8px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.9);
      box-shadow: 0 8px 22px rgba(92, 65, 28, 0.06);
      font-weight: 800;
      line-height: 1.5;
    }

    .chat-message.customer {
      justify-self: end;
      border-color: transparent;
      border-radius: 20px 20px 8px 20px;
      color: #120D05;
      background: linear-gradient(135deg, rgba(244, 213, 141, 0.96), rgba(214, 169, 74, 0.72));
    }

    .chat-message strong {
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .system-message,
    .plan-message {
      width: min(100%, 820px);
      max-width: min(92%, 820px);
    }

    .answer-copy,
    .result-grid p {
      margin: 0;
      color: var(--text);
      font-weight: 800;
      line-height: 1.55;
    }

    .composer-card {
      display: grid;
      gap: 10px;
      padding: 12px;
      border: 1px solid rgba(214, 169, 74, 0.18);
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.76);
      box-shadow: 0 -8px 28px rgba(92, 65, 28, 0.06);
    }

    .composer-label {
      display: grid;
      gap: 6px;
      color: var(--text);
      font-size: 0.84rem;
      font-weight: 900;
    }

    ion-textarea {
      --background: rgba(255, 249, 236, 0.94);
      --border-radius: 18px;
      --color: var(--text);
      --placeholder-color: rgba(126, 110, 85, 0.64);
      min-height: 82px;
      padding: 8px;
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 18px;
    }

    .workspace-actions,
    .photo-uploader,
    .suggested-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .workspace-actions ion-button,
    .workspace-actions button {
      min-height: 38px;
    }

    .upload-button {
      min-height: 38px;
      padding: 0 13px;
      border-radius: 999px;
    }

    .chat-options {
      border: 1px solid rgba(214, 169, 74, 0.18);
      border-radius: 18px;
      background: rgba(255, 249, 236, 0.54);
      padding: 8px 10px;
    }

    .chat-options summary,
    .plan-details summary {
      cursor: pointer;
      color: var(--text);
      font-size: 0.84rem;
      font-weight: 900;
    }

    .problem-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-top: 10px;
    }

    .problem-grid label {
      display: grid;
      gap: 5px;
      color: #6f614b;
      font-size: 0.68rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .problem-grid input {
      min-height: 38px;
      min-width: 0;
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 13px;
      background: rgba(255, 255, 255, 0.78);
      color: var(--text);
      padding: 0 10px;
      font-size: 0.82rem;
      font-weight: 800;
      outline: none;
      text-transform: none;
      letter-spacing: 0;
    }

    .photo-strip {
      display: flex;
      gap: 8px;
      overflow-x: auto;
    }

    .photo-strip button {
      position: relative;
      width: 64px;
      height: 64px;
      flex: 0 0 auto;
      padding: 0;
      overflow: hidden;
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 14px;
      background: rgba(255, 249, 236, 0.92);
    }

    .photo-strip img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .photo-strip ion-icon {
      position: absolute;
      top: 4px;
      right: 4px;
      padding: 3px;
      border-radius: 999px;
      color: #120D05;
      background: rgba(255, 249, 236, 0.9);
    }

    .inline-notice,
    .notice-text {
      margin: 0;
      padding: 8px 10px;
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 14px;
      color: #7E5F17;
      background: rgba(255, 242, 199, 0.72);
      font-size: 0.84rem;
      font-weight: 800;
      line-height: 1.35;
    }

    .consult-summary-grid,
    .result-grid,
    .compact-cards,
    .context-list {
      display: grid;
      gap: 8px;
    }

    .consult-summary-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .consult-summary-grid article,
    .result-grid section {
      display: grid;
      gap: 6px;
      padding: 10px;
      border: 1px solid rgba(214, 169, 74, 0.18);
      border-radius: 16px;
      background: rgba(255, 249, 236, 0.74);
    }

    .consult-summary-grid span {
      color: #7E6E55;
      font-size: 0.68rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .consult-summary-grid strong {
      color: var(--text);
      font-size: 0.86rem;
      line-height: 1.35;
    }

    .plan-details {
      display: grid;
      gap: 10px;
      padding: 10px;
      border: 1px solid rgba(214, 169, 74, 0.18);
      border-radius: 16px;
      background: rgba(255, 249, 236, 0.52);
    }

    .result-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-top: 10px;
    }

    .result-grid h3 {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0;
      font-size: 0.92rem;
    }

    .result-grid ol,
    .result-grid ul {
      margin: 0;
      padding-left: 18px;
      color: var(--muted);
      font-size: 0.86rem;
      font-weight: 800;
      line-height: 1.42;
    }

    .compact-cards {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .compact-cards button {
      justify-content: start;
      min-height: 56px;
      padding: 10px;
      border-radius: 16px;
      text-align: left;
    }

    .compact-cards b,
    .compact-cards small {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .compact-cards small,
    .context-list small {
      color: var(--muted);
      font-size: 0.76rem;
      font-weight: 800;
      line-height: 1.3;
    }

    .compact-context {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 10px;
    }

    .context-list div {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      padding: 9px;
      border: 1px solid rgba(214, 169, 74, 0.16);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.62);
    }

    .context-list ion-icon {
      width: 30px;
      height: 30px;
      padding: 7px;
      border-radius: 12px;
      color: #120D05;
      background: linear-gradient(135deg, #F4D58D, #D6A94A);
    }

    .context-list strong {
      display: block;
      color: var(--text);
      font-size: 0.82rem;
    }

    @media (max-width: 860px) {
      .consultation-page {
        padding: 0 12px 92px;
      }

      .chat-bot-shell {
        height: calc(100vh - 104px);
        min-height: 560px;
        border-radius: 22px;
        padding: 12px;
      }

      .chat-bot-header {
        grid-template-columns: auto minmax(0, 1fr) auto;
      }

      .bot-mark {
        display: none;
      }

      .location-chip {
        max-width: 150px;
      }

      .chat-message,
      .system-message,
      .plan-message {
        max-width: 94%;
      }

      .problem-grid,
      .compact-context,
      .consult-summary-grid,
      .result-grid,
      .compact-cards {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 599px) {
      .chat-bot-shell {
        height: calc(100vh - 92px);
        min-height: 520px;
      }

      .chat-title span,
      .location-chip {
        font-size: 0.76rem;
      }

      .workspace-actions ion-button,
      .workspace-actions button {
        flex: 1 1 auto;
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
  problemProfile: LiveConsultationProblemProfile = {};
  readonly currentLocation = signal<{ lat: number; lng: number } | null>(this.savedLocation());
  readonly areaLabel = signal(this.savedAreaLabel());
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
    if (response?.mode === "openai") return "Powered by AuraShine";
    if (response?.mode === "gemini") return "Powered by AuraShine";
    return "Powered by AuraShine";
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
    const customerTurn: ConsultationChatMessage = {
      role: "customer",
      text: message || `Need help with ${goals.join(", ")}`
    };
    const conversation = [...this.consultationMessages(), customerTurn].slice(-10);
    this.consultationMessages.set(conversation);
    try {
      const response = await firstValueFrom(this.api.createLiveConsultation({
        message,
        goals,
        location: this.currentLocation() ? { ...this.currentLocation(), label: this.areaLabel() } : { label: this.areaLabel() },
        photos: this.consultationPhotos(),
        businesses: this.consultationBusinessContext(),
        conversation,
        problemProfile: this.normalizedProblemProfile(message)
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


  appendPrompt(text: string) {
    const current = this.consultationText.trim();
    this.consultationText = current ? `${current}\n${text}: ` : `${text}: `;
    this.focusComposer();
  }

  async sendSuggestedReply(reply: string) {
    this.consultationText = reply;
    await this.sendConsultation();
  }

  private normalizedProblemProfile(message: string): LiveConsultationProblemProfile {
    return {
      ...this.problemProfile,
      concern: message || this.problemProfile.concern || this.selectedConsultationGoals().join(", "),
      desiredOutcome: this.selectedConsultationGoals().filter((goal) => goal !== "Near me").join(", ")
    };
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
        this.persistCustomerLocation(coordinates, label);
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

  private savedAreaLabel(): string {
    try {
      const label = (localStorage.getItem("aura_customer_area_label") || "").trim();
      if (label && !["near me", "detected area"].includes(label.toLowerCase())) return label;
    } catch {
      // Fall through to the current coordinate label.
    }
    const location = this.currentLocation();
    return location ? "Current location " + this.coordinateLabel(location) : "Current location";
  }

  private persistCustomerLocation(coordinates: { lat: number; lng: number }, label: string) {
    try {
      localStorage.setItem("aura_customer_area_label", label);
      localStorage.setItem("aura_customer_location", JSON.stringify(coordinates));
      window.dispatchEvent(new CustomEvent("aura:customer-location-updated", { detail: { label, location: coordinates } }));
    } catch {
      // Local storage can be unavailable in private or restricted browser modes.
    }
  }
  private async resolveAreaLabel(coordinates: { lat: number; lng: number }): Promise<string> {
    try {
      const response = await fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=" + encodeURIComponent(String(coordinates.lat)) + "&lon=" + encodeURIComponent(String(coordinates.lng)));
      if (!response.ok) throw new Error("reverse geocode failed");
      const data = await response.json() as { address?: Record<string, string>; display_name?: string };
      const address = data.address || {};
      const primary = address["suburb"] || address["neighbourhood"] || address["quarter"] || address["city_district"] || address["village"] || address["town"] || address["city"];
      const secondary = address["city"] || address["town"] || address["state_district"] || address["state"];
      const label = [primary, secondary].filter((part, index, parts) => !!part && parts.indexOf(part) === index).slice(0, 2).join(", ");
      if (label) return label;
      if (data.display_name) return data.display_name.split(",").slice(0, 2).join(",").trim();
    } catch {
      return "Current location " + this.coordinateLabel(coordinates);
    }
    return "Current location " + this.coordinateLabel(coordinates);
  }

  private coordinateLabel(coordinates: { lat: number; lng: number }): string {
    return "(" + coordinates.lat.toFixed(3) + ", " + coordinates.lng.toFixed(3) + ")";
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




