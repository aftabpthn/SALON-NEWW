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
        <section class="concierge-shell" id="consultation-workspace" aria-labelledby="consultation-title">
          <header class="chat-bot-header">
            <button type="button" class="back-button" routerLink="/tabs/home" aria-label="Back to home">
              <ion-icon name="arrow-back-outline"></ion-icon>
            </button>
            <div class="header-identity">
              <div class="bot-mark" aria-hidden="true">
                <ion-icon name="sparkles-outline"></ion-icon>
              </div>
              <div class="chat-title">
                <h1 id="consultation-title">Aura Concierge</h1>
                <button type="button" class="header-location" (click)="useCurrentLocation()" [disabled]="locating()">
                  <span class="status-dot" aria-hidden="true"></span>
                  <ion-icon name="navigate-outline" aria-hidden="true"></ion-icon>
                  <span>{{ locating() ? "Detecting location" : areaLabel() }}</span>
                </button>
              </div>
            </div>
            <span class="context-count">{{ matchedBusinesses().length }} salon{{ matchedBusinesses().length === 1 ? "" : "s" }}</span>
          </header>

          <div class="goal-scroll-shell">
            <div class="goal-grid" aria-label="Quick consultation prompts">
              @for (goal of consultationGoals; track goal) {
                <button
                  type="button"
                  [class.active]="selectedConsultationGoals().includes(goal)"
                  [attr.aria-pressed]="selectedConsultationGoals().includes(goal)"
                  (click)="toggleGoal(goal)">
                  {{ goal }}
                </button>
              }
            </div>
          </div>

          <div class="conversation-scroll" [attr.aria-busy]="consultationLoading()">
            <section class="chat-thread intro-thread" aria-label="Aura Concierge welcome">
              @if (consultationMessages()[0]; as message) {
                <div class="chat-message">
                  <strong>{{ message.role === "customer" ? "You" : "Aura Concierge" }}</strong>
                  <span>{{ message.text }}</span>
                </div>
              }
            </section>

            <section class="consultation-composer" id="consultation-composer" aria-label="Message Aura Concierge">
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
                <summary>
                  <span>Add budget, timing &amp; sensitivities</span>
                  <small>Optional</small>
                </summary>
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
                <p class="notice-text inline-notice" role="status">{{ locationNotice() }}</p>
              }
              @if (consultationError()) {
                <p class="error-text inline-notice" role="alert">{{ consultationError() }}</p>
              }

              <footer class="workspace-actions">
                <ion-button class="primary-gradient" (click)="sendConsultation()" [disabled]="consultationLoading()">
                  <ion-icon name="sparkles-outline" slot="start"></ion-icon>
                  {{ consultationLoading() ? "Creating your plan…" : consultationResponse() ? "Send message" : "Ask Aura" }}
                </ion-button>
                <button type="button" class="upload-button" (click)="photoInput.click()">
                  <ion-icon name="camera-outline"></ion-icon>
                  Photos
                </button>
              </footer>
            </section>

            <section class="chat-thread continuation-thread" aria-label="Consultation conversation" aria-live="polite">
              @for (message of consultationMessages().slice(1); track message.role + message.text) {
                <div class="chat-message" [class.customer]="message.role === 'customer'">
                  <strong>{{ message.role === "customer" ? "You" : "Aura Concierge" }}</strong>
                  <span>{{ message.text }}</span>
                </div>
              }

            @if (!consultationResponse() && matchedBusinesses().length) {
              <details class="nearby-context">
                <summary>
                  <span><strong>Nearby context</strong><small>{{ matchedBusinesses().length }} salon{{ matchedBusinesses().length === 1 ? "" : "s" }} near {{ areaLabel() }}</small></span>
                </summary>
                <div class="compact-cards">
                  @for (business of matchedBusinesses().slice(0, 2); track business.id) {
                    <button type="button" (click)="openBusiness(business.slug)">
                      <b>{{ business.businessName }}</b>
                      <small class="business-meta">
                        @if (business.area || business.city || business.state || business.address) {
                          <span>{{ locationLine(business) }}</span>
                        }
                        @if (business.distanceKm != null) { <span>{{ business.distanceKm }} km</span> }
                        <span>{{ business.isOpen ? "Open" : "Closed" }}</span>
                        @if (business.ratingAverage > 0) { <span>{{ business.ratingAverage }} rating</span> }
                        @if (business.startingPricePaise > 0) { <span>{{ money(business.startingPricePaise) }}</span> }
                      </small>
                    </button>
                  }
                </div>
              </details>
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

              <a class="discover-link" routerLink="/tabs/search">
                <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
                Discover salons
              </a>
            </section>
          </div>
        </section>
      </main>
    </ion-content>
  `,
  styles: [`
    .consultation-page {
      width: min(100%, 980px);
      min-height: 100%;
      padding: 0 0 calc(112px + env(safe-area-inset-bottom));
      scroll-padding-bottom: calc(132px + env(safe-area-inset-bottom));
    }

    .concierge-shell {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      min-height: calc(100dvh - 60px);
      color: var(--text);
      background: var(--surface);
    }

    .chat-bot-header {
      position: sticky;
      top: 0;
      z-index: 4;
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 10px 16px 8px;
      border-bottom: 1px solid rgba(99, 102, 241, 0.12);
      background: var(--glass-strong);
      backdrop-filter: blur(16px);
    }

    .back-button,
    .header-location,
    .upload-button,
    .compact-cards button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      color: var(--text);
      background: transparent;
      font-weight: 800;
    }

    .back-button {
      width: 44px;
      height: 44px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      font-size: 1.2rem;
    }

    .back-button:hover,
    .back-button:focus-visible {
      background: var(--primary-soft);
    }

    .header-identity {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .bot-mark {
      width: 36px;
      height: 36px;
      flex: 0 0 36px;
      display: grid;
      place-items: center;
      border-radius: 12px;
      color: #FFFFFF;
      background: var(--brand-800);
    }

    .chat-title {
      min-width: 0;
      display: grid;
      gap: 3px;
    }

    .chat-title h1 {
      margin: 0;
      overflow: hidden;
      color: var(--text);
      font-size: clamp(1.08rem, 4.8vw, 1.35rem);
      line-height: 1.05;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .header-location {
      position: relative;
      justify-content: flex-start;
      min-width: 0;
      min-height: 36px;
      padding: 0;
      border: 0;
      overflow: hidden;
      color: var(--muted);
      font-size: 0.72rem;
      line-height: 1.2;
      text-align: left;
    }

    .header-location::after {
      content: "";
      position: absolute;
      inset: -4px 0;
    }

    .header-location:disabled {
      opacity: 0.65;
    }

    .header-location span:last-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .header-location ion-icon {
      flex: 0 0 auto;
    }

    .status-dot {
      width: 6px;
      height: 6px;
      flex: 0 0 6px;
      border-radius: 50%;
      background: #168A54;
      box-shadow: 0 0 0 3px rgba(22, 138, 84, 0.12);
    }

    .context-count {
      max-width: 74px;
      padding: 5px 8px;
      border-radius: 999px;
      color: var(--brand-700);
      background: var(--primary-soft);
      font-size: 0.68rem;
      font-weight: 850;
      line-height: 1.15;
      text-align: center;
    }

    .goal-scroll-shell {
      position: relative;
      min-width: 0;
      overflow: hidden;
      border-bottom: 1px solid rgba(99, 102, 241, 0.1);
      background: var(--surface);
    }

    .goal-scroll-shell::after {
      content: "";
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 2;
      width: 34px;
      background: linear-gradient(90deg, rgba(255, 255, 255, 0), #FFFFFF 82%);
      pointer-events: none;
    }

    .goal-grid {
      display: flex;
      gap: 8px;
      padding: 10px 38px 9px 16px;
      overflow-x: auto;
      overscroll-behavior-inline: contain;
      scroll-padding-inline: 16px;
      scrollbar-width: none;
    }

    .goal-grid::-webkit-scrollbar,
    .photo-strip::-webkit-scrollbar {
      display: none;
    }

    .goal-grid button,
    .suggested-replies button {
      flex: 0 0 auto;
      min-height: 44px;
      padding: 0 14px;
      border: 1px solid rgba(99, 102, 241, 0.2);
      border-radius: 999px;
      color: var(--brand-800);
      background: var(--surface);
      font-size: 0.8rem;
      font-weight: 800;
      white-space: nowrap;
      transition: color var(--motion-fast), background var(--motion-fast), border-color var(--motion-fast);
    }

    .goal-grid button.active,
    .goal-grid button[aria-pressed="true"] {
      color: #FFFFFF;
      border-color: var(--brand-800);
      background: var(--brand-800);
    }

    .conversation-scroll {
      min-height: 0;
      display: grid;
      align-content: start;
      overflow: visible;
      scroll-padding-block: 16px calc(132px + env(safe-area-inset-bottom));
      background: linear-gradient(180deg, #FFFFFF 0%, #F4F4F2 100%);
    }

    .suggested-replies button:hover,
    .suggested-replies button:focus-visible {
      color: #FFFFFF;
      border-color: var(--brand-700);
      background: var(--brand-700);
    }

    .chat-thread {
      display: grid;
      align-content: start;
      gap: 12px;
      min-height: 0;
      padding: 16px;
      scroll-behavior: smooth;
    }

    .intro-thread {
      padding-bottom: 8px;
    }

    .intro-thread .chat-message {
      max-width: min(100%, 640px);
      padding: 8px 0;
      border-radius: 0;
      background: transparent;
    }

    .continuation-thread {
      padding-top: 12px;
    }

    .chat-message {
      justify-self: start;
      display: grid;
      gap: 5px;
      width: fit-content;
      max-width: min(84%, 700px);
      padding: 10px 12px;
      border-radius: 14px 14px 14px 4px;
      color: var(--text);
      background: var(--surface-soft);
      font-size: 0.9rem;
      font-weight: 650;
      line-height: 1.48;
      overflow-wrap: anywhere;
    }

    .chat-message.customer {
      justify-self: end;
      border-radius: 14px 14px 4px 14px;
      color: #FFFFFF;
      background: var(--brand-800);
    }

    .chat-message > strong {
      color: inherit;
      font-size: 0.68rem;
      font-weight: 850;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }

    .system-message {
      width: min(100%, 760px);
      max-width: 100%;
      border-left: 3px solid var(--brand-600);
      border-radius: 0;
      background: transparent;
    }

    .plan-message {
      width: min(100%, 820px);
      max-width: 100%;
      padding: 16px;
      border: 1px solid rgba(99, 102, 241, 0.14);
      border-radius: 16px;
      background: var(--surface);
      box-shadow: 0 10px 28px rgba(28, 28, 28, 0.06);
    }

    .answer-copy,
    .result-grid p {
      margin: 0;
      color: var(--text);
      font-weight: 650;
      line-height: 1.55;
      white-space: pre-wrap;
    }

    .consultation-composer {
      display: grid;
      gap: 8px;
      margin-inline: 16px;
      padding: 10px 0 14px;
      border-block: 1px solid rgba(99, 102, 241, 0.12);
      background: var(--surface);
    }

    .composer-label {
      display: grid;
      gap: 6px;
      color: var(--text);
      font-size: 0.76rem;
      font-weight: 850;
    }

    ion-textarea {
      --background: var(--surface-soft);
      --border-radius: 14px;
      --color: var(--text);
      --padding-start: 0;
      --padding-end: 0;
      --padding-top: 0;
      --padding-bottom: 0;
      --placeholder-color: #53677A;
      width: 100%;
      min-height: 88px;
      overflow: visible;
      border: 1px solid transparent;
      border-radius: 14px;
      font-size: 0.92rem;
      line-height: 1.4;
    }

    ion-textarea::part(native) {
      min-height: 86px;
      padding: 12px;
      overflow: visible;
      line-height: 1.45;
      resize: vertical;
    }

    ion-textarea:focus-within,
    ion-textarea::part(native):focus {
      border-color: var(--focus);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.13);
      outline: none;
    }

    .workspace-actions,
    .suggested-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .workspace-actions .primary-gradient {
      flex: 1 1 150px;
      min-height: 44px;
      margin: 0;
    }

    .upload-button {
      min-height: 44px;
      padding: 0 13px;
      border: 1px solid rgba(99, 102, 241, 0.2);
      border-radius: 12px;
    }

    .discover-link {
      justify-self: start;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 44px;
      padding: 0 4px;
      color: var(--brand-700);
      font-size: 0.8rem;
      font-weight: 800;
      text-decoration: underline;
      text-decoration-color: rgba(99, 102, 241, 0.3);
      text-underline-offset: 3px;
    }

    .chat-options,
    .plan-details {
      padding-block: 2px;
      border: 0;
      background: transparent;
    }

    .chat-options summary,
    .plan-details summary,
    .nearby-context summary {
      min-height: 44px;
      display: list-item;
      box-sizing: border-box;
      padding-block: 12px;
      cursor: pointer;
      color: var(--brand-700);
      font-size: 0.8rem;
      font-weight: 800;
    }

    .chat-options summary::marker,
    .plan-details summary::marker,
    .nearby-context summary::marker {
      color: var(--brand-600);
    }

    .chat-options summary small {
      margin-left: 8px;
      padding: 3px 7px;
      border-radius: 999px;
      color: var(--muted);
      background: var(--surface-soft);
      font-size: 0.66rem;
      font-weight: 750;
    }

    .chat-options summary:focus-visible,
    .plan-details summary:focus-visible,
    .nearby-context summary:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
      border-radius: 6px;
    }

    .nearby-context {
      width: min(100%, 760px);
      padding-block: 2px;
      border-block: 1px solid rgba(99, 102, 241, 0.1);
    }

    .nearby-context summary {
      cursor: pointer;
      color: var(--text);
    }

    .nearby-context summary span {
      min-width: 0;
      max-width: calc(100% - 20px);
      display: inline-grid;
      gap: 2px;
      vertical-align: middle;
    }

    .nearby-context summary strong,
    .nearby-context summary small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .nearby-context summary small {
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 650;
    }

    .nearby-context .compact-cards {
      margin-bottom: 10px;
    }

    .problem-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 6px;
      padding-top: 12px;
      border-top: 1px solid rgba(99, 102, 241, 0.12);
    }

    .problem-grid label {
      min-width: 0;
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 0.7rem;
      font-weight: 800;
    }

    .problem-grid input {
      min-width: 0;
      min-height: 44px;
      padding: 0 11px;
      border: 1px solid var(--border);
      border-radius: 10px;
      outline: none;
      color: var(--text);
      background: var(--surface);
      font: inherit;
      font-size: 0.82rem;
    }

    .problem-grid input:focus-visible {
      border-color: var(--focus);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.13);
    }

    .photo-strip {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .photo-strip button {
      position: relative;
      width: 64px;
      height: 64px;
      flex: 0 0 auto;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
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
      padding: 4px;
      border-radius: 50%;
      color: var(--brand-950);
      background: var(--surface);
      box-shadow: 0 2px 8px rgba(28, 28, 28, 0.18);
    }

    .inline-notice,
    .notice-text {
      margin: 0;
      padding: 9px 10px;
      border-radius: 8px;
      color: #744B00;
      background: #FFF8E8;
      font-size: 0.8rem;
      font-weight: 700;
      line-height: 1.4;
    }

    .error-text.inline-notice {
      color: #991B1B;
      background: #FEF2F2;
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
      padding-block: 8px;
      border-block: 1px solid rgba(99, 102, 241, 0.1);
    }

    .consult-summary-grid article {
      min-width: 0;
      display: grid;
      align-content: start;
      gap: 3px;
      padding-inline: 8px;
      border-left: 1px solid rgba(99, 102, 241, 0.1);
    }

    .consult-summary-grid article:first-child {
      padding-left: 0;
      border-left: 0;
    }

    .consult-summary-grid span {
      color: var(--muted);
      font-size: 0.65rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .consult-summary-grid strong {
      overflow-wrap: anywhere;
      color: var(--text);
      font-size: 0.82rem;
      line-height: 1.35;
    }

    .result-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-top: 6px;
      border-top: 1px solid rgba(99, 102, 241, 0.1);
    }

    .result-grid section {
      display: grid;
      align-content: start;
      gap: 7px;
      padding: 12px 4px;
      border-bottom: 1px solid rgba(99, 102, 241, 0.1);
    }

    .result-grid h3 {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0;
      font-size: 0.88rem;
    }

    .result-grid ol,
    .result-grid ul {
      margin: 0;
      padding-left: 18px;
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 650;
      line-height: 1.5;
    }

    .compact-cards {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .compact-cards button {
      display: grid;
      justify-content: flex-start;
      gap: 3px;
      min-width: 0;
      min-height: 52px;
      padding: 9px 10px;
      border: 1px solid rgba(99, 102, 241, 0.14);
      border-radius: 10px;
      text-align: left;
    }

    .compact-cards .business-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 8px;
      overflow: visible;
      white-space: normal;
    }

    .business-meta span:not(:last-child)::after {
      content: "·";
      margin-left: 8px;
      color: var(--border-strong);
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
      font-size: 0.72rem;
      font-weight: 650;
      line-height: 1.35;
    }

    .compact-context {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-top: 10px;
    }

    .context-list div {
      min-width: 0;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      padding: 9px 0;
      border-bottom: 1px solid rgba(99, 102, 241, 0.1);
    }

    .context-list ion-icon {
      width: 28px;
      height: 28px;
      padding: 6px;
      border-radius: 9px;
      color: #FFFFFF;
      background: var(--brand-700);
    }

    .context-list strong {
      display: block;
      color: var(--text);
      font-size: 0.78rem;
    }

    @media (max-width: 599px) {
      .consultation-page {
        width: 100%;
        padding-bottom: calc(118px + env(safe-area-inset-bottom));
      }

      .concierge-shell {
        min-height: calc(100dvh - 78px);
      }

      .bot-mark {
        display: none;
      }

      .chat-message {
        max-width: 90%;
      }

      .system-message,
      .plan-message {
        max-width: 100%;
      }

      .compact-cards,
      .result-grid {
        grid-template-columns: 1fr;
      }

      .workspace-actions .primary-gradient {
        order: -1;
      }
    }

    @media (max-width: 374px) {
      .chat-bot-header,
      .chat-thread {
        padding-inline: 12px;
      }

      .goal-grid {
        padding-right: 34px;
        padding-left: 12px;
      }

      .consultation-composer {
        margin-inline: 12px;
      }

      .context-count {
        max-width: 58px;
        padding-inline: 6px;
      }

      .problem-grid,
      .compact-context,
      .consult-summary-grid {
        grid-template-columns: 1fr;
      }

      .consult-summary-grid article {
        padding: 7px 0;
        border-left: 0;
        border-bottom: 1px solid rgba(99, 102, 241, 0.1);
      }

      .workspace-actions .primary-gradient {
        flex-basis: 100%;
      }
    }

    @media (min-width: 600px) {
      .consultation-page {
        width: min(calc(100% - 32px), 980px);
        padding-top: 16px;
      }

      .concierge-shell {
        height: min(820px, calc(100dvh - 126px));
        min-height: 620px;
        overflow: hidden;
        border: 1px solid rgba(99, 102, 241, 0.12);
        border-radius: 20px;
        box-shadow: 0 18px 48px rgba(28, 28, 28, 0.09);
      }

      .conversation-scroll {
        overflow-y: auto;
        overscroll-behavior: contain;
      }

      .chat-bot-header {
        padding-inline: 20px;
      }

      .chat-thread {
        padding-inline: 20px;
      }

      .goal-grid {
        padding-right: 42px;
        padding-left: 20px;
      }

      .consultation-composer {
        margin-inline: 20px;
      }
    }

    @media (min-width: 600px) and (max-height: 699px) {
      .concierge-shell {
        height: auto;
        min-height: calc(100dvh - 80px);
        overflow: visible;
      }

      .conversation-scroll {
        overflow: visible;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .goal-grid button,
      .back-button {
        transition: none;
      }

      .chat-thread {
        scroll-behavior: auto;
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




