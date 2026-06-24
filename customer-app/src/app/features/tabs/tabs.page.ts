import { Component } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";
import { IonButton, IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, fingerPrintOutline, homeOutline, locationOutline, lockClosedOutline, notificationsOutline, personCircleOutline, personOutline, pricetagOutline, ribbonOutline, searchOutline, sparklesOutline } from "ionicons/icons";
import { AuthService } from "../../core/auth.service";

@Component({
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IonButton, IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel],
  template: `
    @if (auth.biometricLocked()) {
      <section class="biometric-gate" aria-label="Biometric verification required">
        <div class="biometric-panel">
          <span class="gate-icon"><ion-icon name="finger-print-outline"></ion-icon></span>
          <p class="eyebrow">Device security</p>
          <h1>Verify to open Aura Shine</h1>
          <p>Your account is still signed in. Biometric Login is enabled for this device, so verify once to continue.</p>
          @if (auth.error()) {
            <p class="gate-error">{{ auth.error() }}</p>
          }
          <ion-button expand="block" class="primary-gradient" (click)="unlock()" [disabled]="auth.loading()">
            <ion-icon name="lock-closed-outline" slot="start"></ion-icon>
            Verify with biometric
          </ion-button>
          <ion-button expand="block" fill="clear" (click)="logout()" [disabled]="auth.loading()">Use another account</ion-button>
        </div>
      </section>
    }
    <nav class="web-nav" aria-label="Customer app navigation">
      <a class="brand" routerLink="/tabs/home">
        <img class="brand-mark" src="assets/icons/icon.svg" alt="" aria-hidden="true" />
        <span class="brand-copy">
          <strong>Aura Shine</strong>
          <small>Customer booking</small>
        </span>
      </a>
      <div class="nav-links">
        <a routerLink="/tabs/home" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Home</a>
        <a routerLink="/tabs/search" routerLinkActive="active">Discover</a>
        <a routerLink="/tabs/consultation" routerLinkActive="active">Consult</a>
        <a routerLink="/tabs/offers" routerLinkActive="active">Offers</a>
        <a routerLink="/tabs/bookings" routerLinkActive="active">Bookings</a>
        <a routerLink="/tabs/rewards" routerLinkActive="active">Hub</a>
        <a routerLink="/tabs/profile" routerLinkActive="active">Profile</a>
      </div>
      <div class="nav-actions" aria-label="Customer quick actions">
        <a class="location-chip" routerLink="/tabs/search">
          <ion-icon name="location-outline"></ion-icon>
          Near me
        </a>
        <a class="icon-link" routerLink="/notifications" aria-label="Open notifications">
          <ion-icon name="notifications-outline"></ion-icon>
          <span class="nav-badge" aria-hidden="true"></span>
        </a>
        <a class="icon-link" routerLink="/tabs/profile" aria-label="Open profile">
          <ion-icon name="person-circle-outline"></ion-icon>
        </a>
      </div>
    </nav>
    <ion-tabs>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="home" href="/tabs/home">
          <ion-icon name="home-outline"></ion-icon>
          <ion-label>Home</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="search" href="/tabs/search">
          <ion-icon name="search-outline"></ion-icon>
          <ion-label>Discover</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="consultation" href="/tabs/consultation">
          <ion-icon name="sparkles-outline"></ion-icon>
          <ion-label>Consult</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="bookings" href="/tabs/bookings">
          <ion-icon name="calendar-outline"></ion-icon>
          <ion-label>Bookings</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="rewards" href="/tabs/rewards">
          <ion-icon name="ribbon-outline"></ion-icon>
          <ion-label>Hub</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="profile" href="/tabs/profile">
          <ion-icon name="person-outline"></ion-icon>
          <ion-label>Profile</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: [`
    .web-nav {
      display: none;
    }

    .biometric-gate {
      position: fixed;
      inset: 0;
      z-index: 4000;
      display: grid;
      place-items: center;
      padding: 24px;
      background: linear-gradient(180deg, rgba(245, 243, 255, 0.94), rgba(255, 255, 255, 0.98));
      animation: aura-gate-fade 280ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }

    .biometric-panel {
      width: min(100%, 420px);
      display: grid;
      gap: 14px;
      padding: 24px;
      border: 1px solid rgba(17, 24, 39, 0.16);
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: var(--shadow-card);
      backdrop-filter: blur(18px);
      animation: aura-gate-panel 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .gate-icon {
      width: 58px;
      height: 58px;
      display: grid;
      place-items: center;
      border-radius: 20px;
      color: var(--primary-2);
      background: var(--aura-gold-soft);
      font-size: 1.7rem;
    }

    .biometric-panel h1 {
      margin: 0;
      font-size: 1.85rem;
      letter-spacing: 0;
    }

    .biometric-panel p {
      margin: 0;
      color: var(--muted);
      line-height: 1.5;
      font-weight: 800;
    }

    .gate-error {
      padding: 12px 14px;
      border: 1px solid rgba(225, 29, 72, 0.16);
      border-radius: 16px;
      color: #EF4444 !important;
      background: #fff1f2;
    }

    @media (min-width: 1024px) {
      .web-nav {
        position: fixed;
        top: 18px;
        left: 50%;
        z-index: 1000;
        width: min(100% - 64px, 1360px);
        min-height: 72px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        padding: 10px 12px 10px 18px;
        border: 1px solid rgba(17, 24, 39, 0.14);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.86);
        box-shadow: 0 18px 42px rgba(139, 92, 246, 0.14);
        backdrop-filter: blur(24px);
        transform: translateX(-50%);
        animation: aura-web-nav-in 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      .brand,
      .brand-copy,
      .nav-links,
      .nav-links a,
      .nav-actions,
      .location-chip,
      .icon-link {
        display: flex;
        align-items: center;
      }

      .brand {
        gap: 10px;
        color: var(--text);
        text-decoration: none;
      }

      .brand-mark {
        width: 44px;
        height: 44px;
        border-radius: 15px;
        box-shadow: 0 10px 24px rgba(139, 92, 246, 0.13);
        transition: transform var(--motion-medium), box-shadow var(--motion-medium);
      }

      .brand-copy {
        align-items: flex-start;
        flex-direction: column;
        gap: 1px;
      }

      .brand-copy strong {
        font-size: 1.02rem;
        letter-spacing: 0;
      }

      .brand-copy small {
        color: var(--muted);
        font-size: 0.74rem;
        font-weight: 800;
      }

      .nav-links {
        gap: 4px;
        padding: 6px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.82);
      }

      .nav-links a {
        min-height: 44px;
        padding: 0 18px;
        border-radius: 999px;
        color: var(--muted);
        font-weight: 900;
        text-decoration: none;
        transition: color var(--motion-fast), background var(--motion-fast), transform var(--motion-fast);
      }

      .nav-links a:hover {
        color: var(--text);
        background: #ffffff;
        transform: translateY(-1px);
      }

      .nav-links a.active {
        color: #120D05;
        background: linear-gradient(135deg, rgba(244, 213, 141, 0.96), rgba(214, 169, 74, 0.82));
        box-shadow: 0 12px 26px rgba(214, 169, 74, 0.18);
      }

      .nav-actions {
        gap: 8px;
      }

      .location-chip,
      .icon-link {
        min-height: 44px;
        border: 1px solid var(--border);
        color: var(--text);
        background: rgba(255, 255, 255, 0.72);
        text-decoration: none;
        transition: color var(--motion-fast), border-color var(--motion-fast), background var(--motion-fast), transform var(--motion-fast), box-shadow var(--motion-fast);
      }

      .location-chip {
        gap: 7px;
        padding: 0 14px;
        border-radius: 999px;
        font-size: 0.88rem;
        font-weight: 900;
      }

      .icon-link {
        position: relative;
        width: 44px;
        justify-content: center;
        border-radius: 999px;
        font-size: 1.18rem;
      }

      .nav-badge {
        position: absolute;
        top: 9px;
        right: 9px;
        width: 8px;
        height: 8px;
        border: 1px solid rgba(255, 249, 236, 0.92);
        border-radius: 999px;
        background: #D6A94A;
      }

      .location-chip:hover,
      .icon-link:hover {
        border-color: rgba(139, 92, 246, 0.26);
        color: var(--primary-2);
        background: #ffffff;
        transform: translateY(-2px);
        box-shadow: 0 12px 24px rgba(139, 92, 246, 0.1);
      }

      .brand:hover .brand-mark {
        transform: rotate(-3deg) scale(1.04);
        box-shadow: 0 14px 30px rgba(139, 92, 246, 0.18);
      }
    }

    @keyframes aura-web-nav-in {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(-14px) scale(0.985);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0) scale(1);
      }
    }

    @keyframes aura-gate-fade {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes aura-gate-panel {
      from {
        opacity: 0;
        transform: translateY(16px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `]
})
export class TabsPage {
  constructor(readonly auth: AuthService) {
    addIcons({ homeOutline, searchOutline, sparklesOutline, calendarOutline, ribbonOutline, personOutline, locationOutline, notificationsOutline, personCircleOutline, fingerPrintOutline, lockClosedOutline, pricetagOutline });
  }

  unlock() {
    void this.auth.verifyBiometricUnlock().catch(() => undefined);
  }

  logout() {
    void this.auth.logout().catch(() => undefined);
  }
}
