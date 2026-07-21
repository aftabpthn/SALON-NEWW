import { Component } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IonButton, IonContent } from "@ionic/angular/standalone";
import { environment } from "../../../environments/environment";

@Component({
  standalone: true,
  imports: [IonContent, IonButton, RouterLink],
  template: `
    <ion-content fullscreen>
      <main class="onboarding">
        <div class="ambient ambient-one" aria-hidden="true"></div>
        <div class="ambient ambient-two" aria-hidden="true"></div>
        <section class="hero glass-card">
          <div class="brand-lockup" aria-label="Aura Shine">
            <img src="assets/icons/icon.svg" alt="" aria-hidden="true" />
            <div>
              <strong>Aura Shine</strong>
              <span>Premium customer app</span>
            </div>
          </div>
          <p class="eyebrow">Salon discovery · AI consult · booking</p>
          <h1>Your beauty day, made simple.</h1>
          <p class="hero-copy">Find salons, compare services, and book in one place.</p>
          <div class="feature-grid" aria-label="Customer app highlights">
            <span><strong>Slots</strong><small>Live availability</small></span>
            <span><strong>AI guide</strong><small>Photo consult</small></span>
            <span><strong>Rewards</strong><small>Offers</small></span>
          </div>
          <ion-button expand="block" size="large" class="primary-gradient" routerLink="/login">Get started</ion-button>
          <ion-button expand="block" fill="clear" routerLink="/tabs/home">Explore as guest</ion-button>
          <a class="staff-switch" [href]="staffAppUrl">Staff? Open staff login</a>
        </section>
      </main>
    </ion-content>
  `,
  styles: [`
    .onboarding {
      min-height: 100%;
      display: grid;
      place-items: center;
      position: relative;
      overflow: hidden;
      padding: 24px;
      background:
        linear-gradient(135deg, rgba(35, 25, 13, 0.08), transparent 42%),
        radial-gradient(circle at 16% 18%, rgba(214, 169, 74, 0.28), transparent 32%),
        radial-gradient(circle at 84% 8%, rgba(244, 213, 141, 0.24), transparent 34%),
        linear-gradient(180deg, #fff8e8 0%, #f8e6c7 100%);
    }

    .onboarding::before {
      content: "";
      position: absolute;
      inset: 18px;
      border: 1px solid rgba(125, 89, 32, 0.12);
      border-radius: 34px;
      pointer-events: none;
    }

    .ambient {
      position: absolute;
      border-radius: 999px;
      filter: blur(4px);
      opacity: 0.72;
      pointer-events: none;
    }

    .ambient-one {
      width: 220px;
      height: 220px;
      left: -70px;
      bottom: 12%;
      background: rgba(214, 169, 74, 0.22);
    }

    .ambient-two {
      width: 280px;
      height: 280px;
      right: -120px;
      top: 8%;
      background: rgba(35, 25, 13, 0.08);
    }

    .hero {
      width: min(620px, 100%);
      padding: clamp(26px, 6vw, 46px);
      margin-bottom: 0;
      position: relative;
      z-index: 2;
      overflow: hidden;
    }

    .hero::after {
      content: "";
      position: absolute;
      inset: auto -18% -34% 24%;
      height: 220px;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(244, 213, 141, 0.42), transparent 68%);
      pointer-events: none;
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
      border-radius: 16px;
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

    .eyebrow {
      margin: 18px 0 8px;
      color: #9b6b22;
      font-size: 0.78rem;
      font-weight: 950;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    h1 { margin: 0 0 14px; color: var(--text); font-size: clamp(2.35rem, 11vw, 5rem); line-height: 0.92; letter-spacing: -0.06em; }

    .hero-copy {
      max-width: 520px;
      margin: 0;
      color: var(--muted);
      font-size: 1rem;
      font-weight: 750;
      line-height: 1.6;
    }

    .feature-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin: 22px 0 18px;
    }

    .feature-grid span {
      min-height: 64px;
      display: grid;
      align-content: center;
      gap: 4px;
      padding: 9px 6px;
      border: 1px solid rgba(125, 89, 32, 0.14);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.58);
    }

    .feature-grid strong,
    .feature-grid small {
      display: block;
    }

    .feature-grid strong {
      color: var(--text);
      font-size: 0.94rem;
      font-weight: 950;
    }

    .feature-grid small {
      color: var(--muted);
      font-size: 0.76rem;
      font-weight: 800;
    }

    ion-button { margin-top: 14px; }

    .staff-switch {
      display: grid;
      place-items: center;
      min-height: 44px;
      margin-top: 10px;
      border: 1px solid rgba(125, 89, 32, 0.16);
      border-radius: 999px;
      color: #6e4810;
      background: rgba(255, 255, 255, 0.64);
      font-weight: 950;
      text-decoration: none;
    }

    @media (max-width: 520px) {
      .onboarding {
        place-items: end center;
        padding: 18px;
      }

      .onboarding::before {
        inset: 10px;
        border-radius: 28px;
      }

      .feature-grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }
  `]
})
export class OnboardingPage {
  readonly staffAppUrl = environment.staffAppUrl;
}
