import { Component } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IonButton, IonContent } from "@ionic/angular/standalone";

@Component({
  standalone: true,
  imports: [IonContent, IonButton, RouterLink],
  template: `
    <ion-content fullscreen>
      <main class="onboarding">
        <section class="hero glass-card">
          <div class="brand-lockup" aria-label="Aura Shine">
            <img src="assets/icons/icon.svg" alt="" aria-hidden="true" />
            <div>
              <strong>Aura Shine</strong>
              <span>Customer booking</span>
            </div>
          </div>
          <h1>Book your beauty day in a few easy taps.</h1>
          <ion-button expand="block" size="large" class="primary-gradient" routerLink="/login">Get started</ion-button>
          <ion-button expand="block" fill="clear" routerLink="/tabs/home">Explore as guest</ion-button>
        </section>
      </main>
    </ion-content>
  `,
  styles: [`
    .onboarding {
      min-height: 100%;
      display: grid;
      place-items: end center;
      position: relative;
      overflow: hidden;
      padding: 24px;
      background: linear-gradient(180deg, rgba(245, 243, 255, 0.38), rgba(255, 255, 255, 0.96));
    }

    .hero {
      width: min(520px, 100%);
      padding: 28px;
      margin-bottom: 20px;
      position: relative;
      z-index: 2;
    }

    .brand-lockup {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }

    .brand-lockup img {
      width: 64px;
      height: 64px;
      border-radius: 22px;
      box-shadow: 0 16px 34px rgba(139, 92, 246, 0.16);
    }

    .brand-lockup strong,
    .brand-lockup span {
      display: block;
    }

    .brand-lockup strong {
      color: var(--text);
      font-size: 1.18rem;
      font-weight: 900;
      letter-spacing: 0;
    }

    .brand-lockup span {
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 800;
    }

    h1 { margin: 18px 0 12px; color: var(--text); font-size: clamp(2rem, 11vw, 4.2rem); line-height: 0.98; letter-spacing: 0; }
    ion-button { margin-top: 14px; }
  `]
})
export class OnboardingPage {}
