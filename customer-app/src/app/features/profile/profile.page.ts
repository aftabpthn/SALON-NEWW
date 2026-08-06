import { Component, OnInit, computed } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { AlertController, IonButton, IonCheckbox, IonContent, IonIcon, IonInput, IonItem, IonList } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { briefcaseOutline, calendarOutline, chatbubblesOutline, chevronForwardOutline, colorPaletteOutline, createOutline, giftOutline, heartCircleOutline, heartOutline, helpCircleOutline, lockClosedOutline, logOutOutline, mailOutline, notificationsOutline, peopleOutline, personOutline, phonePortraitOutline, ribbonOutline, saveOutline, searchOutline, shareSocialOutline, shieldCheckmarkOutline, sparklesOutline, ticketOutline, trashOutline, walletOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { YourSalonsListComponent } from "../../shared/your-salons-list.component";
import { Booking, CustomerNotificationPreferences, CustomerProfile, CustomerSalonRelationship } from "../../core/api.types";

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IonButton, IonCheckbox, IonContent, IonIcon, IonInput, IonItem, IonList, YourSalonsListComponent],
  template: `
    <ion-content>
      <main class="page-narrow profile-page">
        @if (marketplace.isAuthenticated()) {
          <section class="profile-card premium-card">
            <div class="avatar">
              @if (profilePhotoUrl(); as photoUrl) {
                <img [src]="photoUrl" alt="" />
              } @else {
                <span>{{ profileName().charAt(0) }}</span>
              }
            </div>
            <div class="profile-identity">
              <h1>{{ profileName() || "Loading profile" }}</h1>
              <div class="profile-contact-list" aria-label="Profile contact details">
                <button type="button" (click)="showContactDetail('Email', marketplace.customer()?.email || 'No email saved')">
                  <ion-icon name="mail-outline" aria-hidden="true"></ion-icon>
                  <span>{{ marketplace.customer()?.email || "No email saved" }}</span>
                </button>
                <button type="button" (click)="showContactDetail('Phone', marketplace.customer()?.phone || 'No phone saved')">
                  <ion-icon name="phone-portrait-outline" aria-hidden="true"></ion-icon>
                  <span>{{ marketplace.customer()?.phone || "No phone saved" }}</span>
                </button>
              </div>
            </div>
            <button type="button" class="edit-profile-button" [routerLink]="profileRoute('profile/edit')" aria-label="Edit profile">
              <ion-icon name="create-outline" aria-hidden="true"></ion-icon>
              <span>Edit profile</span>
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

        @if (marketplace.loading() && marketplace.isAuthenticated() && !marketplace.customer()) {
          <section class="status-card premium-card"><strong>Loading profile</strong></section>
        }
        @if (marketplace.error()) {
          <section class="status-card premium-card error"><strong>Profile unavailable</strong><p>{{ marketplace.error() }}</p></section>
        }

        @if (marketplace.customer(); as customer) {
          <section class="pass-card">
            <div>
              <span>{{ customer.membershipLabel || "Customer account" }}</span>
              <h2>{{ summaryHeading(customer) }}</h2>
              <p>{{ summaryLine(customer) }}</p>
            </div>
            <ion-icon name="sparkles-outline" aria-hidden="true"></ion-icon>
          </section>

          <section class="account-grid" aria-label="Account summary">
            @if (favouriteCount() > 0) {
              <a class="summary-card premium-card" [routerLink]="profileRoute('wishlist')">
                <ion-icon name="heart-outline" aria-hidden="true"></ion-icon>
                <strong>{{ favouriteCount() }} favour{{ favouriteCount() === 1 ? "ite" : "ites" }}</strong>
                <span>Salons you saved</span>
              </a>
            }
            <a class="summary-card premium-card" [routerLink]="profileRoute('bookings')">
              <ion-icon name="sparkles-outline" aria-hidden="true"></ion-icon>
              <strong>{{ pastBookingCount() }} past</strong>
              <span>Completed and past visits</span>
            </a>
            <a class="summary-card premium-card" [routerLink]="profileRoute('rewards')">
              <ion-icon name="ribbon-outline" aria-hidden="true"></ion-icon>
              <strong>{{ customer.membershipLabel || "Starter" }}</strong>
              <span>{{ loyaltyProgressLine(customer) }}</span>
            </a>
          </section>

          @if (!marketplace.loading() && isNewUser()) {
            <section class="discover-card premium-card">
              <div>
                <strong>Ready for your first visit?</strong>
                <p>Explore salons near you and book your first appointment.</p>
              </div>
              <ion-button class="primary-gradient" [routerLink]="discoverLink()">
                <ion-icon name="search-outline" slot="start"></ion-icon>
                Discover salons
              </ion-button>
            </section>
          }

          <aura-your-salons-list
            [salons]="marketplace.mySalons()"
            [primarySalon]="marketplace.primarySalon()"
            [hasBookings]="hasBookings()"
            [bookingCount]="marketplace.bookings().length"
            [favouriteCount]="favouriteCount()"
            (setAsPrimary)="onSetPrimarySalon($event)"
            (removePrimary)="onRemovePrimarySalon()">
          </aura-your-salons-list>

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
          @for (group of menuGroups; track group.label) {
            <div class="menu-group">
              <h2 class="menu-group-title">{{ group.label }}</h2>
              @for (item of group.items; track item.route) {
                @if (showMenuItem(item.route)) {
                  <a [routerLink]="profileRoute(item.route)">
                    <ion-icon [name]="item.icon" aria-hidden="true"></ion-icon>
                    <span>{{ item.label }}</span>
                    <ion-icon class="menu-chevron" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                  </a>
                }
              }
            </div>
          }
        </nav>

        @if (marketplace.isAuthenticated()) {
          <ion-button expand="block" fill="outline" class="secondary-button logout-button" (click)="logout()">
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
      padding-top: calc(14px + env(safe-area-inset-top));
      padding-bottom: calc(96px + env(safe-area-inset-bottom));
    }

    .profile-card {
      position: relative;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 16px;
      align-items: start;
      padding: 18px;
    }

    .edit-profile-button {
      display: inline-flex;
      gap: 7px;
      align-items: center;
      justify-content: center;
      min-width: 0;
      min-height: 36px;
      padding: 0 12px;
      border: 1px solid rgba(99, 102, 241, 0.24);
      border-radius: 999px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      box-shadow: 0 12px 24px rgba(99, 102, 241, 0.18);
      font: inherit;
      font-size: 0.82rem;
      font-weight: 850;
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
      box-shadow: 0 14px 28px rgba(99, 102, 241, 0.22);
    }

    .avatar {
      width: 88px;
      height: 88px;
      display: grid;
      place-items: center;
      overflow: hidden;
      border-radius: 30px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2), var(--accent));
      box-shadow: 0 16px 34px rgba(99, 102, 241, 0.2);
      font-size: 2rem;
      font-weight: 900;
    }

    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .avatar span { display: block; line-height: 1; }

    .profile-identity { min-width: 0; display: grid; gap: 8px; padding-top: 2px; }

    .profile-contact-list { display: grid; gap: 6px; min-width: 0; }
    .profile-contact-list button {
      width: 100%;
      min-width: 0;
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr);
      align-items: center;
      gap: 7px;
      padding: 0;
      border: 0;
      color: var(--muted);
      background: transparent;
      font: inherit;
      font-size: 0.85rem;
      font-weight: 700;
      line-height: 1.35;
      text-align: left;
      cursor: pointer;
    }
    .profile-contact-list ion-icon { color: var(--primary); font-size: 0.95rem; }
    .profile-contact-list span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .profile-contact-list button:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; border-radius: 6px; }

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
      border: 1px solid rgba(255, 255, 255, 0.3);
      background:
        radial-gradient(circle at 18% 0%, rgba(255, 255, 255, 0.38), transparent 34%),
        linear-gradient(135deg, var(--brand-600) 0%, var(--primary) 48%, var(--brand-900) 100%);
      box-shadow:
        0 18px 38px rgba(28, 28, 28, 0.18),
        0 8px 18px rgba(99, 102, 241, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.58);
      transition: transform 260ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 260ms ease;
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
      color: #ffffff;
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
      filter: drop-shadow(0 10px 16px rgba(28, 28, 28, 0.24));
    }

    @media (hover: hover) and (pointer: fine) {
      .pass-card:hover {
        transform: translateY(-3px);
        box-shadow:
          0 22px 46px rgba(28, 28, 28, 0.2),
          0 12px 24px rgba(99, 102, 241, 0.24),
          inset 0 1px 0 rgba(255, 255, 255, 0.68);
      }
    }

    .account-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
      gap: 10px;
    }

    .summary-card {
      display: grid;
      gap: 5px;
      padding: 12px;
      color: inherit;
      text-decoration: none;
    }

    .summary-card ion-icon {
      width: 36px;
      height: 36px;
      padding: 8px;
      border-radius: 14px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
    }

    .summary-card strong { font-size: 0.95rem; line-height: 1.2; }

    .summary-card span {
      color: var(--muted);
      font-size: 0.8rem;
      font-weight: 800;
      line-height: 1.3;
    }

    .discover-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      padding: 18px;
    }

    .discover-card strong {
      display: block;
      font-size: 1.05rem;
      letter-spacing: -0.02em;
    }

    .discover-card p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 0.85rem;
      line-height: 1.45;
    }

    .discover-card ion-button {
      min-height: 44px;
      margin: 0;
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
      color: var(--primary);
      background: var(--aura-gold-soft);
      font-weight: 800;
    }

    .verify-box {
      display: grid;
      gap: 10px;
      padding: 14px;
      border: 1px solid rgba(99, 102, 241, 0.18);
      border-radius: 18px;
      background: var(--primary-soft);
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

    .menu-group + .menu-group {
      border-top: 1px solid var(--border);
    }

    .menu-group-title {
      margin: 0;
      padding: 16px 18px 6px;
      color: var(--muted);
      font-size: 0.80rem;
      font-weight: 950;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .menu a,
    .menu-item {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr) 20px;
      gap: 12px;
      align-items: center;
      min-height: 48px;
      padding: 0 18px;
      color: var(--text);
      font-weight: 900;
      text-decoration: none;
    }

    .menu a + a {
      border-top: 1px solid var(--border);
    }

    .menu ion-icon {
      color: var(--muted);
      width: 24px;
      height: 24px;
      font-size: 1.08rem;
    }

    .menu a .menu-chevron {
      width: 20px;
      height: 20px;
      justify-self: end;
      color: var(--muted);
      font-size: 0.95rem;
      opacity: 0.55;
    }

    .menu-item.disabled {
      color: var(--muted);
      background: var(--glass);
    }

    .menu-item.disabled ion-icon {
      color: var(--muted);
    }

    .menu-item small {
      color: var(--muted);
      font-size: 0.84rem;
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
        padding-top: calc(18px + env(safe-area-inset-top));
        padding-bottom: calc(116px + env(safe-area-inset-bottom));
      }

      .profile-card {
        grid-template-columns: auto minmax(0, 1fr);
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

      .edit-profile-button {
        grid-column: 2;
        justify-self: start;
        min-height: 34px;
        padding: 0 11px;
      }

      .edit-profile-button span {
        font-size: 0.80rem;
      }

      .pass-card {
        min-height: 62px;
        padding: 12px 14px;
        border-radius: 18px;
      }

      .pass-card span {
        font-size: 0.76rem;
        letter-spacing: 0.08em;
      }

      .pass-card h2 {
        margin: 3px 0 0;
        font-size: 1rem;
        line-height: 1.1;
      }

      .pass-card p {
        margin-top: 2px;
        font-size: 0.80rem;
      }

      .account-grid {
        gap: 8px;
      }

      .summary-card {
        gap: 5px;
        padding: 12px;
        border-radius: 14px;
      }

      .summary-card ion-icon {
        width: 30px;
        height: 30px;
        padding: 6px;
        border-radius: 11px;
      }

      .summary-card strong {
        font-size: 0.8rem;
        line-height: 1.15;
      }

      .discover-card {
        grid-template-columns: 1fr;
        text-align: center;
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
      .discover-card,
      .profile-editor {
        grid-column: 1;
      }

      .menu {
        grid-column: 2;
        grid-row: 1 / span 8;
        position: sticky;
        top: 118px;
      }

      .profile-page > ion-button {
        grid-column: 1;
        max-width: 280px;
      }
    }
  `]
})
export class ProfilePage implements OnInit {
  readonly favouriteCount = computed(() => {
    const seen = new Set<string>();
    let count = 0;
    for (const item of [...this.marketplace.favorites(), ...this.marketplace.savedSalons()]) {
      const key = item.businessId || item.business?.id || item.business?.slug || "";
      if (key && !seen.has(key)) {
        seen.add(key);
        count += 1;
      }
    }
    return count;
  });
  readonly menuGroups = [
    {
      label: "Activity",
      items: [
        { label: "My bookings", icon: "calendar-outline", route: "bookings" },
        { label: "Favourites", icon: "heart-outline", route: "wishlist" }
      ]
    },
    {
      label: "Payments and benefits",
      items: [
        { label: "Wallet and payments", icon: "wallet-outline", route: "wallet" },
        { label: "Loyalty rewards", icon: "ribbon-outline", route: "rewards" },
        { label: "Memberships", icon: "heart-circle-outline", route: "memberships" },
        { label: "Packages", icon: "ticket-outline", route: "packages" }
      ]
    },
    {
      label: "Account",
      items: [
        { label: "Family profiles", icon: "people-outline", route: "family" },
        { label: "Corporate benefits", icon: "briefcase-outline", route: "corporate" },
        { label: "Notifications", icon: "notifications-outline", route: "notifications" },
        { label: "Gift cards", icon: "gift-outline", route: "gift-cards" },
        { label: "Referrals", icon: "share-social-outline", route: "referrals" },
        { label: "Privacy and settings", icon: "shield-checkmark-outline", route: "settings" }
      ]
    },
    {
      label: "Personalization",
      items: [
        { label: "Beauty goals", icon: "color-palette-outline", route: "goals" }
      ]
    },
    {
      label: "Support",
      items: [
        { label: "Help centre", icon: "help-circle-outline", route: "help" },
        { label: "Contact support", icon: "chatbubbles-outline", route: "support" }
      ]
    }
  ] as const;
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

  constructor(readonly marketplace: MarketplaceService, private readonly router: Router, private readonly route: ActivatedRoute, private readonly alerts: AlertController) {
    addIcons({ briefcaseOutline, calendarOutline, chatbubblesOutline, chevronForwardOutline, colorPaletteOutline, createOutline, giftOutline, heartCircleOutline, heartOutline, helpCircleOutline, lockClosedOutline, logOutOutline, mailOutline, notificationsOutline, peopleOutline, personOutline, phonePortraitOutline, ribbonOutline, saveOutline, searchOutline, shareSocialOutline, shieldCheckmarkOutline, sparklesOutline, ticketOutline, trashOutline, walletOutline });
  }

  async ngOnInit() {
    if (this.marketplace.isAuthenticated()) {
      await this.marketplace.loadCustomer().then(() => this.syncForm()).catch(() => undefined);
      await this.marketplace.loadBookings().catch(() => undefined);
      await this.marketplace.loadFavorites().catch(() => undefined);
      await this.marketplace.ensureSavedSalons().catch(() => undefined);
      await this.marketplace.loadMySalons().catch(() => undefined);
    }
  }

  profileName(): string {
    const customer = this.marketplace.customer();
    const fullName = [customer?.firstName, customer?.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
    const fallback = String(customer?.name || customer?.displayName || "").trim();
    return fullName || (/^\+?\d[\d\s-]{7,}$/.test(fallback) ? "" : fallback);
  }

  profilePhotoUrl(): string {
    const value = String(this.marketplace.customer()?.avatarUrl || "").trim();
    if (!value) return "";
    try {
      const url = new URL(value, window.location.origin);
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
    } catch {
      return "";
    }
  }

  async showContactDetail(label: string, value: string): Promise<void> {
    const alert = await this.alerts.create({
      header: label,
      message: value,
      buttons: ["OK"]
    });
    await alert.present();
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

  profileRoute(path: string): string {
    if (!this.marketplace.salonMode()) return path === "notifications" || path === "settings" || path === "help" ? `/${path}` : `/tabs/${path}`;
    return this.marketplace.salonModeUrl(...path.split("/"));
  }

  showMenuItem(route: string): boolean {
    return route !== "corporate" || this.hasCorporateEligibility();
  }

  private hasCorporateEligibility(): boolean {
    const customer = this.marketplace.customer() as (CustomerProfile & Record<string, unknown>) | null;
    if (!customer) return false;
    return Boolean(
      customer["corporateEligible"] ||
      customer["corporateBenefitsEnabled"] ||
      customer["corporatePartnerId"] ||
      customer["corporateAccountId"] ||
      customer["employerName"] ||
      customer["companyName"]
    );
  }

  summaryHeading(customer: CustomerProfile): string {
    const completed = Number(customer.bookingCount) || this.pastBookingCount();
    return completed > 0 ? `${completed} ${completed === 1 ? "booking" : "bookings"} completed` : "Welcome to Aura";
  }

  summaryLine(customer: CustomerProfile): string {
    const parts: string[] = [];
    const completed = Number(customer.bookingCount) || this.pastBookingCount();
    if (completed > 0) parts.push(`${completed} ${completed === 1 ? "visit" : "visits"}`);
    const upcoming = this.upcomingCount();
    if (upcoming > 0) parts.push(`${upcoming} upcoming`);
    if (parts.length) return parts.join(" · ");
    return customer.createdAt
      ? `Member since ${this.joinedLabel(customer.createdAt)}`
      : "Explore salons to plan your first visit";
  }

  pastBookingCount(): number {
    return this.marketplace.bookings().filter((booking) => this.isPastBooking(booking)).length;
  }

  loyaltyProgressLine(customer: CustomerProfile): string {
    const points = Number(customer.loyaltyPoints || 0);
    return points > 0 ? `${points} points earned` : "Loyalty and rewards status";
  }

  private isPastBooking(booking: Booking): boolean {
    const status = String(booking.status || "");
    if (status === "cancelled") return false;
    if (status === "completed" || status === "no_show") return true;
    const end = this.appointmentEndTime(booking);
    return end !== null && end <= Date.now();
  }

  private appointmentEndTime(booking: Booking): number | null {
    const explicitEnd = this.parseBookingTime(booking.endsAt || booking.endAt || "");
    if (explicitEnd) return explicitEnd.getTime();
    const start = this.parseBookingTime(booking.startsAt || booking.startAt || booking.displayStartAt || "");
    if (!start) return null;
    const duration = Number(booking.durationMinutes || booking.serviceDurationMinutes || 60);
    return start.getTime() + Math.max(1, Number.isFinite(duration) ? duration : 60) * 60 * 1000;
  }

  private parseBookingTime(value: string): Date | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  hasBookings(): boolean {
    return this.marketplace.bookings().length > 0;
  }

  isNewUser(): boolean {
    return this.marketplace.bookings().length === 0 && this.marketplace.mySalons().length === 0;
  }

  discoverLink(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/tabs/search";
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

  async onSetPrimarySalon(salon: CustomerSalonRelationship) {
    try {
      await this.marketplace.setPrimarySalon(salon.tenantId, salon.branchId, salon.businessId, salon.businessName);
    } catch {
      // error is handled by marketplace service
    }
  }

  async onRemovePrimarySalon() {
    try {
      await this.marketplace.removePrimarySalon();
    } catch {
      // error is handled by marketplace service
    }
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
