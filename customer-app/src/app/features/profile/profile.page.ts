import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { IonButton, IonCheckbox, IonContent, IonIcon, IonInput, IonItem, IonList } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { briefcaseOutline, cardOutline, chevronForwardOutline, colorPaletteOutline, createOutline, giftOutline, heartCircleOutline, heartOutline, helpCircleOutline, lockClosedOutline, logOutOutline, mailOutline, notificationsOutline, peopleOutline, personOutline, phonePortraitOutline, ribbonOutline, saveOutline, shareSocialOutline, shieldCheckmarkOutline, sparklesOutline, ticketOutline, trashOutline, walletOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { CustomerNotificationPreferences } from "../../core/api.types";

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IonButton, IonCheckbox, IonContent, IonIcon, IonInput, IonItem, IonList],
  template: `
    <ion-content>
      <main class="page-narrow profile-page">
        @if (marketplace.isAuthenticated()) {
          <section class="profile-card premium-card">
            <div class="avatar">{{ profileName().charAt(0) }}</div>
            <div>
              <h1>{{ profileName() || "Loading profile" }}</h1>
              <p class="muted">{{ marketplace.customer()?.email || "No email saved" }} · {{ marketplace.customer()?.phone || "No phone saved" }}</p>
            </div>
            <button type="button" class="edit-profile-button" routerLink="/tabs/profile/edit" aria-label="Edit profile">
              <ion-icon name="create-outline"></ion-icon>
              <span>Edit</span>
            </button>
          </section>
        } @else {
          <section class="profile-card premium-card">
            <div class="avatar">?</div>
            <div>
              <h1>Sign in to manage your account</h1>
              <ion-button class="primary-gradient" routerLink="/login">Login</ion-button>
            </div>
          </section>
        }

        @if (marketplace.loading()) {
          <section class="status-card premium-card"><strong>Loading profile</strong></section>
        }
        @if (marketplace.error()) {
          <section class="status-card premium-card error"><strong>Profile unavailable</strong><p>{{ marketplace.error() }}</p></section>
        }

        @if (marketplace.customer(); as customer) {
          <section class="pass-card">
            <div>
              <span>{{ customer.membershipLabel || "Customer account" }}</span>
              <h2>{{ customer.bookingCount || 0 }} bookings completed</h2>
              <p>Provider: {{ customer.authProvider || "customer" }} · Joined {{ joinedLabel(customer.createdAt) }}</p>
            </div>
            <ion-icon name="sparkles-outline"></ion-icon>
          </section>

          <section class="account-grid">
            <article class="summary-card premium-card">
              <ion-icon name="heart-outline"></ion-icon>
              <strong>{{ savedSalonsCount() }} saved salons</strong>
              <span>Favorite venues and inspirations</span>
            </article>
            <article class="summary-card premium-card">
              <ion-icon name="sparkles-outline"></ion-icon>
              <strong>{{ upcomingCount() }} upcoming</strong>
              <span>Confirmed and pending visits</span>
            </article>
            <article class="summary-card premium-card">
              <ion-icon name="ribbon-outline"></ion-icon>
              <strong>{{ customer.membershipLabel || "Starter" }}</strong>
              <span>Loyalty and rewards status</span>
            </article>
          </section>

          @if (editMode()) {
          <section class="profile-editor premium-card">
            <div class="section-heading">
              <div>
                <h2>Edit customer profile</h2>
              </div>
              <ion-button size="small" class="primary-gradient" (click)="saveProfile()" [disabled]="marketplace.loading()">
                <ion-icon name="save-outline" slot="start"></ion-icon>
                Save
              </ion-button>
            </div>
            <ion-list>
              <ion-item lines="none">
                <ion-icon name="person-outline" slot="start"></ion-icon>
                <ion-input label="Name" labelPlacement="stacked" [(ngModel)]="profileForm.name" name="profileName"></ion-input>
              </ion-item>
              <ion-item lines="none">
                <ion-icon name="mail-outline" slot="start"></ion-icon>
                <ion-input label="Email" labelPlacement="stacked" type="email" [(ngModel)]="profileForm.email" name="profileEmail"></ion-input>
              </ion-item>
              <ion-item lines="none">
                <ion-icon name="phone-portrait-outline" slot="start"></ion-icon>
                <ion-input label="Phone" labelPlacement="stacked" type="tel" [(ngModel)]="profileForm.phone" name="profilePhone"></ion-input>
              </ion-item>
            </ion-list>
            @if (emailChanged()) {
              <div class="verify-box">
                <div>
                  <strong>Email change requires verification</strong>
                  <span>We will send a 6-digit code to {{ profileForm.email || "the new email" }}.</span>
                </div>
                <ion-button fill="outline" class="secondary-button" size="small" (click)="requestEmailChange()" [disabled]="marketplace.loading()">Send code</ion-button>
                @if (emailVerification.sent) {
                  <ion-input label="Email code" labelPlacement="stacked" inputmode="numeric" maxlength="6" [(ngModel)]="emailVerification.code" name="emailVerificationCode"></ion-input>
                  <ion-button class="primary-gradient" size="small" (click)="verifyEmailChange()" [disabled]="marketplace.loading()">Verify email</ion-button>
                }
                @if (emailVerification.notice) { <p>{{ emailVerification.notice }}</p> }
              </div>
            }
            @if (phoneChanged()) {
              <div class="verify-box">
                <div>
                  <strong>Mobile number change requires OTP</strong>
                  <span>Send OTP to {{ profileForm.phone || "the new mobile number" }}.</span>
                </div>
                <div class="inline-actions">
                  <ion-button fill="outline" class="secondary-button" size="small" (click)="requestPhoneChange('sms')" [disabled]="marketplace.loading()">Send SMS OTP</ion-button>
                  <ion-button fill="outline" class="secondary-button" size="small" (click)="requestPhoneChange('whatsapp')" [disabled]="marketplace.loading()">Send WhatsApp OTP</ion-button>
                </div>
                @if (phoneVerification.sent) {
                  <ion-input label="Mobile OTP" labelPlacement="stacked" inputmode="numeric" maxlength="6" [(ngModel)]="phoneVerification.code" name="phoneVerificationCode"></ion-input>
                  <ion-button class="primary-gradient" size="small" (click)="verifyPhoneChange()" [disabled]="marketplace.loading()">Verify mobile</ion-button>
                }
                @if (phoneVerification.notice) { <p>{{ phoneVerification.notice }}</p> }
              </div>
            }
            @if (profileNotice) {
              <p class="notice-text">{{ profileNotice }}</p>
            }
          </section>
          }

          @if (editMode()) {
          <section class="profile-editor premium-card">
            <div class="section-heading">
              <div>
                <h2>Preferences</h2>
              </div>
            </div>
            <div class="toggle-list">
              <label><ion-checkbox [(ngModel)]="notifications.bookingReminders"></ion-checkbox><span>Booking reminders</span></label>
              <label><ion-checkbox [(ngModel)]="notifications.promotions"></ion-checkbox><span>Promotions</span></label>
              <label><ion-checkbox [(ngModel)]="notifications.loyalty"></ion-checkbox><span>Loyalty alerts</span></label>
              <label><ion-checkbox [(ngModel)]="notifications.membership"></ion-checkbox><span>Membership alerts</span></label>
            </div>
          </section>
          }

          @if (editMode()) {
          <section class="profile-editor premium-card">
            <div class="section-heading">
              <div>
                <h2>Change password</h2>
              </div>
            </div>
            <ion-list>
              <ion-item lines="none">
                <ion-icon name="lock-closed-outline" slot="start"></ion-icon>
                <ion-input label="Current password" labelPlacement="stacked" type="password" [(ngModel)]="passwordForm.current" name="currentPassword"></ion-input>
              </ion-item>
              <ion-item lines="none">
                <ion-icon name="lock-closed-outline" slot="start"></ion-icon>
                <ion-input label="New password" labelPlacement="stacked" type="password" [(ngModel)]="passwordForm.next" name="newPassword"></ion-input>
              </ion-item>
              <ion-item lines="none">
                <ion-icon name="lock-closed-outline" slot="start"></ion-icon>
                <ion-input label="Confirm new password" labelPlacement="stacked" type="password" [(ngModel)]="passwordForm.confirm" name="confirmNewPassword"></ion-input>
              </ion-item>
            </ion-list>
            <ion-button expand="block" fill="outline" class="secondary-button" (click)="changePassword()" [disabled]="marketplace.loading()">Update password</ion-button>
            @if (passwordNotice) {
              <p class="notice-text">{{ passwordNotice }}</p>
            }
          </section>
          }

          @if (editMode()) {
          <section class="profile-editor danger-card premium-card">
            <div class="section-heading">
              <div>
                <h2>Delete account</h2>
              </div>
            </div>
            <ion-list>
              <ion-item lines="none">
                <ion-icon name="trash-outline" slot="start"></ion-icon>
                <ion-input label="Type DELETE to confirm" labelPlacement="stacked" [(ngModel)]="deleteConfirm" name="deleteConfirm"></ion-input>
              </ion-item>
              <ion-item lines="none">
                <ion-icon name="lock-closed-outline" slot="start"></ion-icon>
                <ion-input label="Current password if email account" labelPlacement="stacked" type="password" [(ngModel)]="deletePassword" name="deletePassword"></ion-input>
              </ion-item>
            </ion-list>
            <ion-button expand="block" color="danger" (click)="deleteAccount()" [disabled]="deleteConfirm !== 'DELETE' || marketplace.loading()">
              <ion-icon name="trash-outline" slot="start"></ion-icon>
              Delete permanently
            </ion-button>
          </section>
          }
        }

        <nav class="menu premium-card" aria-label="Profile menu">
          <div class="menu-section-title">Hub</div>
          <a routerLink="/tabs/bookings"><ion-icon name="sparkles-outline"></ion-icon><span>My bookings</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/wishlist"><ion-icon name="heart-outline"></ion-icon><span>Wishlist and saved salons</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/wallet"><ion-icon name="wallet-outline"></ion-icon><span>Wallet and payments</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/rewards"><ion-icon name="ribbon-outline"></ion-icon><span>Loyalty rewards</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/memberships"><ion-icon name="heart-circle-outline"></ion-icon><span>Memberships</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/packages"><ion-icon name="ticket-outline"></ion-icon><span>Packages</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/gift-cards"><ion-icon name="gift-outline"></ion-icon><span>Gift cards</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/referrals"><ion-icon name="share-social-outline"></ion-icon><span>Referrals</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/family"><ion-icon name="people-outline"></ion-icon><span>Family profiles</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/corporate"><ion-icon name="briefcase-outline"></ion-icon><span>Corporate benefits</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/goals"><ion-icon name="color-palette-outline"></ion-icon><span>Beauty goals</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/notifications"><ion-icon name="notifications-outline"></ion-icon><span>Notifications</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/tabs/support"><ion-icon name="help-circle-outline"></ion-icon><span>Help, support and AI</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
          <a routerLink="/settings"><ion-icon name="shield-checkmark-outline"></ion-icon><span>Privacy and settings</span><ion-icon name="chevron-forward-outline"></ion-icon></a>
        </nav>

        @if (marketplace.isAuthenticated()) {
          <ion-button expand="block" fill="outline" class="secondary-button" (click)="logout()">
            <ion-icon name="log-out-outline" slot="start"></ion-icon>
            Logout
          </ion-button>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .profile-page {
      display: grid;
      gap: 16px;
    }

    .profile-card {
      position: relative;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 16px;
      align-items: center;
      padding: 22px;
    }

    .edit-profile-button {
      display: inline-flex;
      gap: 7px;
      align-items: center;
      justify-content: center;
      min-width: 86px;
      min-height: 42px;
      padding: 0 16px;
      border: 1px solid rgba(139, 92, 246, 0.24);
      border-radius: 999px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      box-shadow: 0 12px 24px rgba(139, 92, 246, 0.18);
      font: inherit;
      font-size: 0.8rem;
      font-weight: 900;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      cursor: pointer;
    }

    .edit-profile-button ion-icon {
      color: #ffffff;
      font-size: 1rem;
    }

    .edit-profile-button:hover,
    .edit-profile-button:focus-visible {
      outline: none;
      transform: translateY(-1px);
      box-shadow: 0 14px 28px rgba(139, 92, 246, 0.24);
    }

    .avatar {
      width: 88px;
      height: 88px;
      display: grid;
      place-items: center;
      border-radius: 30px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2), var(--accent));
      box-shadow: 0 16px 34px rgba(139, 92, 246, 0.22);
      font-size: 2rem;
      font-weight: 900;
    }

    h1 {
      margin: 0;
      font-size: 2rem;
      letter-spacing: -0.05em;
    }

    .pass-card {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      overflow: hidden;
      padding: 22px;
      border-radius: var(--radius-lg);
      color: #ffffff;
      border: 1px solid rgba(255, 244, 215, 0.42);
      background:
        radial-gradient(circle at 18% 0%, rgba(255, 255, 255, 0.38), transparent 34%),
        linear-gradient(135deg, #F7D982 0%, #D9A943 48%, #B87D1E 100%);
      box-shadow:
        0 28px 56px rgba(92, 65, 28, 0.22),
        0 10px 22px rgba(184, 125, 30, 0.22),
        inset 0 1px 0 rgba(255, 255, 255, 0.58),
        inset 0 -18px 34px rgba(109, 73, 21, 0.12);
      transform: perspective(1100px) translate3d(0, 0, 0);
      transform-style: preserve-3d;
      backface-visibility: hidden;
      animation: aura-pass-rise 520ms cubic-bezier(0.16, 1, 0.3, 1) both, aura-pass-float 6.8s ease-in-out infinite 560ms;
      transition:
        transform 280ms cubic-bezier(0.16, 1, 0.3, 1),
        box-shadow 280ms cubic-bezier(0.16, 1, 0.3, 1),
        filter 220ms ease;
    }

    .pass-card::before {
      position: absolute;
      inset: 0;
      content: "";
      pointer-events: none;
      background:
        linear-gradient(120deg, rgba(255, 255, 255, 0.42), transparent 24%, transparent 62%, rgba(92, 65, 28, 0.12)),
        radial-gradient(circle at 82% 20%, rgba(255, 255, 255, 0.3), transparent 20%);
      transform: translateZ(18px);
    }

    .pass-card::after {
      position: absolute;
      inset: -40% auto -40% -66%;
      width: 48%;
      content: "";
      pointer-events: none;
      background: linear-gradient(105deg, transparent, rgba(255, 255, 255, 0.36), transparent);
      transform: translateX(-120%) rotate(14deg);
      transition: transform 760ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .pass-card > * {
      position: relative;
      z-index: 1;
      transform: translateZ(26px);
    }

    .pass-card span {
      color: rgba(255, 255, 255, 0.74);
      font-size: 0.8rem;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .pass-card h2 {
      margin: 6px 0 8px;
      letter-spacing: -0.04em;
    }

    .pass-card p {
      margin: 0;
      color: rgba(255, 255, 255, 0.78);
      line-height: 1.5;
    }

    .pass-card ion-icon {
      flex: 0 0 auto;
      font-size: 2.4rem;
      filter: drop-shadow(0 10px 16px rgba(92, 65, 28, 0.24));
      transform: translateZ(42px);
    }

    @media (hover: hover) and (pointer: fine) {
      .pass-card:hover {
        transform: perspective(1100px) translate3d(0, -8px, 26px) rotateX(1.4deg) rotateY(-1.8deg) scale(1.01);
        box-shadow:
          0 38px 82px rgba(92, 65, 28, 0.25),
          0 16px 34px rgba(184, 125, 30, 0.24),
          inset 0 1px 0 rgba(255, 255, 255, 0.72),
          inset 0 -20px 38px rgba(109, 73, 21, 0.12);
        filter: saturate(1.06) brightness(1.03);
        animation-play-state: paused;
      }

      .pass-card:hover::after {
        transform: translateX(390%) rotate(14deg);
      }

      .pass-card:hover ion-icon {
        transform: translate3d(0, -2px, 48px) scale(1.08) rotate(-4deg);
      }
    }

    .pass-card:active {
      transform: perspective(1100px) translate3d(0, 2px, -8px) rotateX(-1deg) scale(0.985);
      filter: saturate(1.02) brightness(0.98);
    }

    .account-grid {
      display: grid;
      gap: 12px;
    }

    .summary-card {
      display: grid;
      gap: 7px;
      padding: 16px;
    }

    .summary-card ion-icon {
      width: 42px;
      height: 42px;
      padding: 10px;
      border-radius: 16px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
    }

    .summary-card span {
      color: var(--muted);
      font-weight: 800;
    }

    .profile-editor {
      display: grid;
      gap: 14px;
      padding: 18px;
    }

    .section-heading {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
    }

    .section-heading h2 {
      margin: 0;
      font-size: 1.25rem;
      letter-spacing: 0;
    }

    ion-list {
      margin: 0;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--surface-soft);
    }

    ion-item {
      --background: transparent;
      --padding-start: 14px;
      --inner-padding-end: 14px;
    }

    .toggle-list {
      display: grid;
      gap: 10px;
    }

    .toggle-list label {
      display: flex;
      gap: 12px;
      align-items: center;
      min-height: 46px;
      color: var(--text);
      font-weight: 900;
    }

    .notice-text {
      margin: 0;
      padding: 12px 14px;
      border-radius: 16px;
      color: #8B5CF6;
      background: var(--aura-gold-soft);
      font-weight: 800;
    }

    .verify-box {
      display: grid;
      gap: 10px;
      padding: 14px;
      border: 1px solid rgba(139, 92, 246, 0.18);
      border-radius: 18px;
      background: rgba(245, 243, 255, 0.72);
    }

    .verify-box strong,
    .verify-box span,
    .verify-box p {
      display: block;
    }

    .verify-box span,
    .verify-box p {
      color: var(--muted);
      font-weight: 800;
      line-height: 1.4;
    }

    .verify-box p {
      margin: 0;
    }

    .inline-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .danger-card {
      border-color: rgba(225, 29, 72, 0.24);
    }

    .menu {
      overflow: hidden;
    }

    .menu-section-title {
      padding: 14px 18px 8px;
      color: #8A5C12;
      background: rgba(244, 213, 141, 0.16);
      font-size: 0.76rem;
      font-weight: 950;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .menu a,
    .menu-item {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      min-height: 58px;
      padding: 0 18px;
      border-bottom: 1px solid var(--border);
      color: var(--text);
      font-weight: 900;
      text-decoration: none;
    }

    .menu a:last-child,
    .menu-item:last-child {
      border-bottom: 0;
    }

    .menu ion-icon {
      color: var(--primary-2);
      font-size: 1.2rem;
    }

    .menu a ion-icon:last-child {
      color: var(--muted);
    }

    .menu-item.disabled {
      color: rgba(16, 42, 67, 0.58);
      background: rgba(255, 255, 255, 0.72);
    }

    .menu-item.disabled ion-icon {
      color: rgba(139, 92, 246, 0.58);
    }

    .menu-item small {
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 900;
      text-align: right;
    }

    .status-card {
      padding: 16px;
    }

    .status-card p {
      margin: 6px 0 0;
    }

    .status-card.error p {
      color: #EF4444;
    }

    @media (max-width: 767px) {
      .profile-page {
        gap: 10px;
      }

      .profile-card {
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 10px;
        padding: 14px;
        border-radius: 20px;
      }

      .avatar {
        width: 50px;
        height: 50px;
        border-radius: 16px;
        font-size: 1.2rem;
      }

      h1 {
        font-size: 1.25rem;
        line-height: 1.05;
      }

      .profile-card .muted {
        max-width: 190px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.75rem;
      }

      .edit-profile-button {
        min-width: 38px;
        min-height: 38px;
        padding: 0;
      }

      .edit-profile-button span {
        display: none;
      }

      .pass-card {
        min-height: 62px;
        padding: 12px 14px;
        border-radius: 18px;
        animation: none;
      }

      .pass-card span {
        font-size: 0.66rem;
        letter-spacing: 0.08em;
      }

      .pass-card h2 {
        margin: 3px 0 0;
        font-size: 1rem;
        line-height: 1.1;
      }

      .pass-card p,
      .pass-card ion-icon,
      .summary-card span,
      .menu-section-title {
        display: none;
      }

      .account-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .summary-card {
        align-items: center;
        justify-items: center;
        min-height: 82px;
        gap: 6px;
        padding: 10px 8px;
        border-radius: 18px;
        text-align: center;
      }

      .summary-card ion-icon {
        width: 32px;
        height: 32px;
        padding: 7px;
        border-radius: 12px;
      }

      .summary-card strong {
        font-size: 0.72rem;
        line-height: 1.15;
      }

      .menu a,
      .menu-item {
        min-height: 48px;
        padding: 0 14px;
      }
    }

    @media (min-width: 1024px) {
      .profile-page {
        grid-template-columns: minmax(0, 0.95fr) minmax(360px, 0.65fr);
        align-items: start;
      }

      .profile-card,
      .status-card,
      .pass-card,
      .account-grid,
      .profile-editor {
        grid-column: 1;
      }

      .menu {
        grid-column: 2;
        grid-row: 1 / span 4;
        position: sticky;
        top: 118px;
      }

      .profile-page > ion-button {
        grid-column: 1;
        max-width: 280px;
      }
    }

    @keyframes aura-pass-rise {
      from {
        opacity: 0;
        transform: perspective(1100px) translate3d(0, 18px, -12px) rotateX(-2deg) scale(0.985);
      }
      to {
        opacity: 1;
        transform: perspective(1100px) translate3d(0, 0, 0) rotateX(0) scale(1);
      }
    }

    @keyframes aura-pass-float {
      0%,
      100% {
        transform: perspective(1100px) translate3d(0, 0, 0) rotateX(0deg) rotateY(0deg);
      }
      50% {
        transform: perspective(1100px) translate3d(0, -3px, 10px) rotateX(0.35deg) rotateY(-0.45deg);
      }
    }
  `]
})
export class ProfilePage implements OnInit {
  readonly savedSalonsCount = () => this.marketplace.favorites().length;
  readonly editMode = () => this.route.snapshot.routeConfig?.path === "profile/edit";
  profileForm = { name: "", email: "", phone: "" };
  notifications: CustomerNotificationPreferences = {
    bookingReminders: true,
    promotions: true,
    loyalty: true,
    membership: true
  };
  passwordForm = { current: "", next: "", confirm: "" };
  emailVerification = { sent: false, code: "", notice: "" };
  phoneVerification = { sent: false, code: "", notice: "", channel: "sms" as "sms" | "whatsapp" };
  deleteConfirm = "";
  deletePassword = "";
  profileNotice = "";
  passwordNotice = "";

  constructor(readonly marketplace: MarketplaceService, private readonly router: Router, private readonly route: ActivatedRoute) {
    addIcons({ briefcaseOutline, cardOutline, chevronForwardOutline, colorPaletteOutline, createOutline, giftOutline, heartCircleOutline, heartOutline, helpCircleOutline, lockClosedOutline, logOutOutline, mailOutline, notificationsOutline, peopleOutline, personOutline, phonePortraitOutline, ribbonOutline, saveOutline, shareSocialOutline, shieldCheckmarkOutline, sparklesOutline, ticketOutline, trashOutline, walletOutline });
  }

  async ngOnInit() {
    if (this.marketplace.isAuthenticated()) {
      await this.marketplace.loadCustomer().then(() => this.syncForm()).catch(() => undefined);
      await this.marketplace.loadBookings().catch(() => undefined);
      await this.marketplace.loadFavorites().catch(() => undefined);
    }
  }

  profileName(): string {
    const customer = this.marketplace.customer();
    const fullName = [customer?.firstName, customer?.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
    const fallback = String(customer?.name || customer?.displayName || "").trim();
    return fullName || (/^\+?\d[\d\s-]{7,}$/.test(fallback) ? "" : fallback);
  }

  upcomingCount(): number {
    return this.marketplace.bookings().filter((booking) => booking.status === "confirmed" || booking.status === "pending").length;
  }

  joinedLabel(value?: string): string {
    if (!value) return "recently";
    return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(new Date(value));
  }

  async saveProfile() {
    this.profileNotice = "";
    if (!this.profileForm.name.trim()) {
      this.profileNotice = "Name is required.";
      return;
    }
    if (this.emailChanged()) {
      this.profileNotice = "Verify the new email before saving profile changes.";
      return;
    }
    if (this.phoneChanged()) {
      this.profileNotice = "Verify the new mobile number before saving profile changes.";
      return;
    }
    await this.marketplace.updateCustomer({
      name: this.profileForm.name,
      notificationPreferences: this.notifications
    }).then(() => {
      this.syncForm();
      this.profileNotice = "Profile saved.";
    }).catch(() => undefined);
  }

  emailChanged(): boolean {
    const current = (this.marketplace.customer()?.email || "").trim().toLowerCase();
    return this.profileForm.email.trim().toLowerCase() !== current;
  }

  phoneChanged(): boolean {
    const current = (this.marketplace.customer()?.phone || "").trim();
    return this.profileForm.phone.trim() !== current;
  }

  async requestEmailChange() {
    this.emailVerification.notice = "";
    const email = this.profileForm.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.emailVerification.notice = "Enter a valid email address.";
      return;
    }
    await this.marketplace.requestProfileEmailCode(email)
      .then((response) => {
        this.emailVerification.sent = true;
        this.emailVerification.notice = response.deliveryWarning || "Verification code sent. Enter it below to update your email.";
        if (response.devOtp) this.emailVerification.notice += ` Development code: ${response.devOtp}`;
      })
      .catch(() => {
        this.emailVerification.notice = this.marketplace.error() || "Could not send email verification code.";
      });
  }

  async verifyEmailChange() {
    const email = this.profileForm.email.trim().toLowerCase();
    await this.marketplace.verifyProfileEmailCode(email, this.emailVerification.code)
      .then(() => {
        this.syncForm();
        this.emailVerification = { sent: false, code: "", notice: "Email verified and updated." };
      })
      .catch(() => {
        this.emailVerification.notice = this.marketplace.error() || "Could not verify email code.";
      });
  }

  async requestPhoneChange(channel: "sms" | "whatsapp") {
    this.phoneVerification.notice = "";
    const phone = this.profileForm.phone.trim();
    if (phone.replace(/\D/g, "").length < 8) {
      this.phoneVerification.notice = "Enter a valid mobile number.";
      return;
    }
    await this.marketplace.requestProfilePhoneOtp(phone, channel)
      .then((response) => {
        this.phoneVerification.sent = true;
        this.phoneVerification.channel = channel;
        this.phoneVerification.notice = response.deliveryWarning || `OTP sent by ${response.deliveryChannel || channel}.`;
        if (response.devOtp) this.phoneVerification.notice += ` Development OTP: ${response.devOtp}`;
      })
      .catch(() => {
        this.phoneVerification.notice = this.marketplace.error() || "Could not send mobile OTP.";
      });
  }

  async verifyPhoneChange() {
    const phone = this.profileForm.phone.trim();
    await this.marketplace.verifyProfilePhoneOtp(phone, this.phoneVerification.code)
      .then(() => {
        this.syncForm();
        this.phoneVerification = { sent: false, code: "", notice: "Mobile number verified and updated.", channel: "sms" };
      })
      .catch(() => {
        this.phoneVerification.notice = this.marketplace.error() || "Could not verify mobile OTP.";
      });
  }

  async changePassword() {
    this.passwordNotice = "";
    if (this.passwordForm.next.length < 8) {
      this.passwordNotice = "New password must be at least 8 characters.";
      return;
    }
    if (this.passwordForm.next !== this.passwordForm.confirm) {
      this.passwordNotice = "Confirm password must match.";
      return;
    }
    await this.marketplace.changePassword(this.passwordForm.current, this.passwordForm.next)
      .then(() => {
        this.passwordForm = { current: "", next: "", confirm: "" };
        this.passwordNotice = "Password updated.";
      })
      .catch(() => undefined);
  }

  async deleteAccount() {
    if (this.deleteConfirm !== "DELETE") return;
    await this.marketplace.deleteAccount(this.deletePassword)
      .then(() => this.router.navigateByUrl("/tabs/home"))
      .catch(() => undefined);
  }

  logout() {
    void this.marketplace.logout()
      .finally(() => this.router.navigateByUrl("/login"));
  }

  private syncForm() {
    const customer = this.marketplace.customer();
    if (!customer) return;
    this.profileForm = {
      name: customer.name || "",
      email: customer.email || "",
      phone: customer.phone || ""
    };
    this.notifications = {
      ...this.notifications,
      ...(customer.notificationPreferences || {})
    };
    this.emailVerification = { sent: false, code: "", notice: "" };
    this.phoneVerification = { sent: false, code: "", notice: "", channel: "sms" };
  }
}
