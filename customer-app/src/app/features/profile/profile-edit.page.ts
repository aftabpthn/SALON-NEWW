import { Component, OnInit, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { IonBackButton, IonButton, IonButtons, IonCheckbox, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonList, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { chevronForwardOutline, lockClosedOutline, mailOutline, notificationsOutline, personOutline, phonePortraitOutline, saveOutline, shieldCheckmarkOutline, trashOutline } from "ionicons/icons";
import { CustomerNotificationPreferences } from "../../core/api.types";
import { MarketplaceService } from "../../core/marketplace.service";

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IonBackButton, IonButton, IonButtons, IonCheckbox, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonList, IonToolbar],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button [defaultHref]="backHref()"></ion-back-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <main class="page-narrow edit-profile-page">
        <section class="hero-card premium-card">
          <div>
            <h1>{{ pageTitle() }}</h1>
            <p class="muted">{{ pageSubtitle() }}</p>
          </div>
          @if (section() === "personal" || section() === "notifications") {
          <ion-button class="primary-gradient" (click)="saveProfile()" [disabled]="marketplace.loading()">
            <ion-icon name="save-outline" slot="start"></ion-icon>
            Save
          </ion-button>
          }
        </section>

        @if (marketplace.error()) {
          <p class="error-text">{{ marketplace.error() }}</p>
        }
        @if (profileNotice) {
          <p class="notice-text">{{ profileNotice }}</p>
        }

        @if (section() === "menu") {
          <section class="settings-menu premium-card">
            <a routerLink="/tabs/profile/edit/personal">
              <span class="section-icon"><ion-icon name="person-outline"></ion-icon></span>
            <span><strong>Personal information</strong></span>
              <ion-icon name="chevron-forward-outline"></ion-icon>
            </a>
            <a routerLink="/tabs/profile/edit/notifications">
              <span class="section-icon"><ion-icon name="notifications-outline"></ion-icon></span>
              <span><strong>Notifications</strong></span>
              <ion-icon name="chevron-forward-outline"></ion-icon>
            </a>
            <a routerLink="/tabs/profile/edit/password">
              <span class="section-icon"><ion-icon name="lock-closed-outline"></ion-icon></span>
              <span><strong>Change password</strong></span>
              <ion-icon name="chevron-forward-outline"></ion-icon>
            </a>
            <a routerLink="/tabs/profile/edit/delete" class="danger-link">
              <span class="section-icon danger"><ion-icon name="trash-outline"></ion-icon></span>
              <span><strong>Delete account</strong></span>
              <ion-icon name="chevron-forward-outline"></ion-icon>
            </a>
          </section>
        }

        @if (section() === "personal") {
        <section class="editor-card premium-card">
          <div class="section-heading">
            <span class="section-icon"><ion-icon name="person-outline"></ion-icon></span>
            <div>
              <h2>Personal information</h2>
            </div>
          </div>

          <ion-list>
            <ion-item lines="none">
              <ion-icon name="person-outline" slot="start"></ion-icon>
              <ion-input label="First name" labelPlacement="stacked" inputmode="text" autocomplete="given-name" maxlength="40" [(ngModel)]="profileForm.firstName" name="profileFirstName" (ionInput)="profileForm.firstName = lettersOnly($event.detail.value)"></ion-input>
            </ion-item>
            <ion-item lines="none">
              <ion-icon name="person-outline" slot="start"></ion-icon>
              <ion-input label="Last name" labelPlacement="stacked" inputmode="text" autocomplete="family-name" maxlength="40" [(ngModel)]="profileForm.lastName" name="profileLastName" (ionInput)="profileForm.lastName = lettersOnly($event.detail.value)"></ion-input>
            </ion-item>
            <ion-item lines="none">
              <ion-icon name="mail-outline" slot="start"></ion-icon>
              <ion-input label="Email" labelPlacement="stacked" type="email" [(ngModel)]="profileForm.email" name="profileEmail"></ion-input>
            </ion-item>
            <ion-item lines="none">
              <ion-icon name="phone-portrait-outline" slot="start"></ion-icon>
              <ion-input label="Mobile number" labelPlacement="stacked" type="tel" [(ngModel)]="profileForm.phone" name="profilePhone"></ion-input>
            </ion-item>
          </ion-list>

          @if (emailChanged()) {
            <div class="verify-box">
              <div>
                <strong>Verify new email</strong>
                <span>We will send a 6-digit code to {{ profileForm.email || "your new email" }}.</span>
              </div>
              <ion-button fill="outline" class="secondary-button" size="small" (click)="requestEmailChange()" [disabled]="marketplace.loading()">Send email code</ion-button>
              @if (emailVerification.sent) {
                <ion-input label="Email verification code" labelPlacement="stacked" inputmode="numeric" maxlength="6" [(ngModel)]="emailVerification.code" name="emailVerificationCode"></ion-input>
                <ion-button class="primary-gradient" size="small" (click)="verifyEmailChange()" [disabled]="marketplace.loading()">Verify email</ion-button>
              }
              @if (emailVerification.notice) {
                <p>{{ emailVerification.notice }}</p>
              }
            </div>
          }

          @if (phoneChanged()) {
            <div class="verify-box">
              <div>
                <strong>Verify new mobile number</strong>
                <span>Send OTP to {{ profileForm.phone || "your new mobile number" }} before this number is saved.</span>
              </div>
              <div class="inline-actions">
                <ion-button fill="outline" class="secondary-button" size="small" (click)="requestPhoneChange('sms')" [disabled]="marketplace.loading()">Send SMS OTP</ion-button>
                <ion-button fill="outline" class="secondary-button" size="small" (click)="requestPhoneChange('whatsapp')" [disabled]="marketplace.loading()">Send WhatsApp OTP</ion-button>
              </div>
              @if (phoneVerification.sent) {
                <ion-input label="Mobile OTP" labelPlacement="stacked" inputmode="numeric" maxlength="6" [(ngModel)]="phoneVerification.code" name="phoneVerificationCode"></ion-input>
                <ion-button class="primary-gradient" size="small" (click)="verifyPhoneChange()" [disabled]="marketplace.loading()">Verify mobile</ion-button>
              }
              @if (phoneVerification.notice) {
                <p>{{ phoneVerification.notice }}</p>
              }
            </div>
          }
        </section>
        }

        @if (section() === "notifications") {
        <section class="editor-card premium-card">
          <div class="section-heading">
            <span class="section-icon"><ion-icon name="shield-checkmark-outline"></ion-icon></span>
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

        @if (section() === "password") {
        <section class="editor-card premium-card">
          <div class="section-heading">
            <span class="section-icon"><ion-icon name="lock-closed-outline"></ion-icon></span>
            <div>
              <h2>Change password</h2>
            </div>
          </div>
          @if (!passwordOtpMode) {
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
            <ion-button expand="block" fill="clear" (click)="startPasswordOtpMode()">Forgot current password? Use mobile OTP</ion-button>
          } @else {
            <div class="verify-box">
              <div>
                <strong>Verify with mobile OTP</strong>
                <span>We will send an OTP to {{ maskedCustomerPhone() }} and then let you set a new password.</span>
              </div>
              <div class="inline-actions">
                <ion-button fill="outline" class="secondary-button" size="small" (click)="requestPasswordOtp('sms')" [disabled]="marketplace.loading()">Send SMS OTP</ion-button>
                <ion-button fill="outline" class="secondary-button" size="small" (click)="requestPasswordOtp('whatsapp')" [disabled]="marketplace.loading()">Send WhatsApp OTP</ion-button>
              </div>
              @if (passwordOtp.sent) {
                <ion-input label="Mobile OTP" labelPlacement="stacked" inputmode="numeric" maxlength="6" [(ngModel)]="passwordOtp.code" name="passwordOtpCode"></ion-input>
              }
              <ion-list>
                <ion-item lines="none">
                  <ion-icon name="lock-closed-outline" slot="start"></ion-icon>
                  <ion-input label="New password" labelPlacement="stacked" type="password" [(ngModel)]="passwordForm.next" name="otpNewPassword"></ion-input>
                </ion-item>
                <ion-item lines="none">
                  <ion-icon name="lock-closed-outline" slot="start"></ion-icon>
                  <ion-input label="Confirm new password" labelPlacement="stacked" type="password" [(ngModel)]="passwordForm.confirm" name="otpConfirmNewPassword"></ion-input>
                </ion-item>
              </ion-list>
              <ion-button expand="block" class="primary-gradient" (click)="changePasswordWithOtp()" [disabled]="marketplace.loading() || !passwordOtp.sent">Verify OTP and update password</ion-button>
              <ion-button expand="block" fill="clear" (click)="cancelPasswordOtpMode()">Use current password instead</ion-button>
              @if (passwordOtp.notice) {
                <p>{{ passwordOtp.notice }}</p>
              }
            </div>
          }
          @if (passwordNotice) {
            <p class="notice-text">{{ passwordNotice }}</p>
          }
        </section>
        }

        @if (section() === "delete") {
        <section class="editor-card danger-card premium-card">
          <div class="section-heading">
            <span class="section-icon danger"><ion-icon name="trash-outline"></ion-icon></span>
            <div>
              <h2>Delete account</h2>
            </div>
          </div>
          <ion-list class="delete-fields">
            <ion-item class="delete-input-row" lines="none">
              <ion-icon name="trash-outline" slot="start"></ion-icon>
              <ion-input
                #deleteConfirmInput
                label="Type DELETE to confirm"
                labelPlacement="stacked"
                placeholder="DELETE"
                autocomplete="off"
                autocapitalize="characters"
                enterkeyhint="done"
                [(ngModel)]="deleteConfirm"
                name="deleteConfirm">
              </ion-input>
            </ion-item>
            <ion-item class="delete-input-row" lines="none">
              <ion-icon name="lock-closed-outline" slot="start"></ion-icon>
              <ion-input
                label="Current password if email account"
                labelPlacement="stacked"
                placeholder="Optional for social login"
                type="password"
                [(ngModel)]="deletePassword"
                name="deletePassword">
              </ion-input>
            </ion-item>
          </ion-list>
          <ion-button expand="block" color="danger" (click)="deleteAccount()" [disabled]="deleteConfirm !== 'DELETE' || marketplace.loading()">
            <ion-icon name="trash-outline" slot="start"></ion-icon>
            Delete permanently
          </ion-button>
        </section>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .edit-profile-page {
      display: grid;
      gap: 16px;
      padding-bottom: 112px;
    }

    .hero-card,
    .editor-card {
      display: grid;
      gap: 16px;
      padding: 20px;
      animation-name: aura-card-in;
      animation-duration: var(--motion-slow);
      animation-iteration-count: 1;
      transform: none !important;
      transform-style: flat;
      transition: box-shadow 180ms ease, border-color 180ms ease, background 180ms ease;
    }

    .hero-card {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
    }

    .edit-profile-page .hero-card,
    .edit-profile-page .editor-card {
      box-shadow: 0 18px 42px rgba(92, 65, 28, 0.12) !important;
    }

    .edit-profile-page .hero-card *,
    .edit-profile-page .editor-card * {
      transform-style: flat;
    }

    @media (hover: hover) and (pointer: fine) {
      .edit-profile-page .hero-card:hover,
      .edit-profile-page .editor-card:hover {
        transform: none !important;
        filter: none !important;
        animation-play-state: running !important;
        box-shadow: 0 18px 42px rgba(92, 65, 28, 0.12) !important;
      }

      .edit-profile-page .hero-card:hover ion-icon,
      .edit-profile-page .editor-card:hover ion-icon,
      .edit-profile-page .hero-card:hover .section-icon,
      .edit-profile-page .editor-card:hover .section-icon {
        transform: none !important;
        animation: none !important;
      }
    }

    .edit-profile-page .hero-card:active,
    .edit-profile-page .editor-card:active {
      transform: none !important;
      filter: none !important;
    }

    h1,
    h2 {
      margin: 0;
      color: var(--text);
      letter-spacing: -0.04em;
    }

    h1 {
      font-size: clamp(2rem, 5vw, 3rem);
    }

    h2 {
      font-size: 1.2rem;
    }

    .section-heading {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .settings-menu {
      overflow: hidden;
    }

    .settings-menu a {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      min-height: 78px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--border);
      color: var(--text);
      text-decoration: none;
    }

    .settings-menu a:last-child {
      border-bottom: 0;
    }

    .settings-menu strong,
    .settings-menu small {
      display: block;
    }

    .settings-menu strong {
      font-size: 1rem;
      font-weight: 900;
    }

    .settings-menu small {
      margin-top: 4px;
      color: var(--muted);
      font-weight: 800;
      line-height: 1.35;
    }

    .settings-menu > a > ion-icon {
      color: var(--muted);
    }

    .settings-menu .danger-link strong {
      color: #EF4444;
    }

    .section-icon {
      flex: 0 0 auto;
      width: 46px;
      height: 46px;
      display: grid;
      place-items: center;
      border-radius: 16px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      font-size: 1.2rem;
      box-shadow: 0 14px 28px rgba(139, 92, 246, 0.18);
    }

    .section-icon.danger {
      background: linear-gradient(135deg, #EF4444, #EC4899);
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

    .notice-text,
    .error-text {
      margin: 0;
      padding: 12px 14px;
      border-radius: 16px;
      font-weight: 800;
      line-height: 1.45;
    }

    .notice-text {
      color: #7C3AED;
      background: var(--aura-gold-soft);
      border: 1px solid rgba(124, 58, 237, 0.18);
    }

    .error-text {
      color: #EF4444;
      background: #fff1f2;
      border: 1px solid rgba(239, 68, 68, 0.16);
    }

    .danger-card {
      border-color: rgba(239, 68, 68, 0.18);
      animation-name: aura-card-in;
      animation-duration: var(--motion-slow);
      animation-iteration-count: 1;
      transform: none !important;
    }

    .danger-card .muted {
      color: #7A6444 !important;
      font-weight: 700;
    }

    .delete-fields {
      display: grid;
      gap: 12px;
      overflow: visible;
      border: 0;
      border-radius: 0;
      background: transparent;
    }

    .delete-input-row {
      min-height: 72px;
      border: 1px solid rgba(214, 169, 74, 0.26);
      border-radius: 18px;
      background:
        linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(255, 249, 236, 0.94));
      box-shadow:
        0 14px 32px rgba(92, 65, 28, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.84);
      --background: transparent;
      --padding-start: 16px;
      --inner-padding-end: 16px;
      --min-height: 72px;
      transform: none !important;
      transition: border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
    }

    .delete-input-row ion-icon {
      color: #9B6B22;
      font-size: 1.25rem;
    }

    .delete-input-row ion-input {
      --color: var(--text);
      --placeholder-color: rgba(122, 100, 68, 0.45);
      --highlight-color-focused: #D6A94A;
      --highlight-color-valid: #D6A94A;
      --highlight-color-invalid: #EF4444;
      font-weight: 800;
    }

    .delete-input-row ion-input::part(label) {
      color: #7A5019 !important;
      font-weight: 900;
    }

    .delete-input-row ion-input.has-focus::part(label),
    .delete-input-row ion-input.ion-focused::part(label),
    .delete-input-row:focus-within ion-input::part(label) {
      color: #B87D1E !important;
    }

    .delete-input-row ion-input::part(native) {
      caret-color: #B87D1E;
    }

    .delete-input-row:focus-within {
      border-color: rgba(214, 169, 74, 0.58);
      box-shadow:
        0 14px 30px rgba(92, 65, 28, 0.12),
        0 0 0 4px rgba(214, 169, 74, 0.16),
        inset 0 1px 0 rgba(255, 255, 255, 0.9);
    }

    @media (hover: hover) and (pointer: fine) {
      .danger-card:hover,
      .delete-input-row:hover {
        transform: none !important;
        filter: none !important;
      }

      .danger-card:hover {
        box-shadow: var(--shadow-soft) !important;
      }
    }

    @media (max-width: 599px) {
      .hero-card {
        grid-template-columns: 1fr;
      }

      .hero-card ion-button {
        justify-self: start;
      }
    }
  `]
})
export class ProfileEditPage implements OnInit {
  @ViewChild("deleteConfirmInput") private deleteConfirmInput?: IonInput;
  private readonly namePartMaxLength = 40;

  profileForm = { firstName: "", lastName: "", email: "", phone: "" };
  notifications: CustomerNotificationPreferences = {
    bookingReminders: true,
    promotions: true,
    loyalty: true,
    membership: true
  };
  passwordForm = { current: "", next: "", confirm: "" };
  passwordOtpMode = false;
  passwordOtp = { sent: false, code: "", notice: "", channel: "sms" as "sms" | "whatsapp" };
  emailVerification = { sent: false, code: "", notice: "" };
  phoneVerification = { sent: false, code: "", notice: "", channel: "sms" as "sms" | "whatsapp" };
  deleteConfirm = "";
  deletePassword = "";
  profileNotice = "";
  passwordNotice = "";

  constructor(readonly marketplace: MarketplaceService, private readonly router: Router, private readonly route: ActivatedRoute) {
    addIcons({ chevronForwardOutline, lockClosedOutline, mailOutline, notificationsOutline, personOutline, phonePortraitOutline, saveOutline, shieldCheckmarkOutline, trashOutline });
  }

  async ngOnInit() {
    if (this.marketplace.isAuthenticated()) {
      await this.marketplace.loadCustomer().then(() => this.syncForm()).catch(() => undefined);
    }
    this.focusDeleteConfirmIfNeeded();
  }

  ionViewDidEnter() {
    this.focusDeleteConfirmIfNeeded();
  }

  async saveProfile() {
    this.profileNotice = "";
    const firstName = this.lettersOnly(this.profileForm.firstName).trim();
    const lastName = this.lettersOnly(this.profileForm.lastName).trim();
    if (!this.validNamePart(firstName)) {
      this.profileNotice = "First name can contain letters only.";
      return;
    }
    if (!this.validNamePart(lastName)) {
      this.profileNotice = "Last name can contain letters only.";
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.profileForm.email.trim().toLowerCase())) {
      this.profileNotice = "Valid email is required.";
      return;
    }
    if (this.profileForm.phone.replace(/\D/g, "").length < 8) {
      this.profileNotice = "Valid mobile number is required.";
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
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      email: this.profileForm.email.trim().toLowerCase(),
      phone: this.profileForm.phone.trim(),
      notificationPreferences: this.notifications
    }).then(() => {
      this.syncForm();
      this.profileNotice = "Profile saved.";
    }).catch(() => undefined);
  }

  section(): "menu" | "personal" | "notifications" | "password" | "delete" {
    const section = this.route.snapshot.data["section"];
    return section === "personal" || section === "notifications" || section === "password" || section === "delete" ? section : "menu";
  }

  pageTitle(): string {
    const titles = {
      menu: "Edit profile",
      personal: "Personal information",
      notifications: "Notifications",
      password: "Change password",
      delete: "Delete account"
    };
    return titles[this.section()];
  }

  pageSubtitle(): string {
    const subtitles = {
      menu: "Choose what you want to update.",
      personal: "Update first name, last name, email, and mobile number with verification.",
      notifications: "Choose which customer updates AuraSalon can send you.",
      password: "Change your email-login password securely.",
      delete: "Permanently delete and anonymize your customer profile."
    };
    return subtitles[this.section()];
  }

  backHref(): string {
    return this.section() === "menu" ? "/tabs/profile" : "/tabs/profile/edit";
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

  startPasswordOtpMode() {
    const phone = this.customerPhone();
    this.passwordNotice = "";
    if (!phone) {
      this.passwordNotice = "Add and verify your mobile number before using OTP password recovery.";
      return;
    }
    this.passwordOtpMode = true;
    this.passwordForm.current = "";
    this.passwordOtp = { sent: false, code: "", notice: "", channel: "sms" };
  }

  cancelPasswordOtpMode() {
    this.passwordOtpMode = false;
    this.passwordOtp = { sent: false, code: "", notice: "", channel: "sms" };
    this.passwordNotice = "";
  }

  async requestPasswordOtp(channel: "sms" | "whatsapp") {
    this.passwordNotice = "";
    this.passwordOtp.notice = "";
    const phone = this.customerPhone();
    if (!phone) {
      this.passwordNotice = "Add and verify your mobile number before using OTP password recovery.";
      return;
    }
    await this.marketplace.requestProfilePhoneOtp(phone, channel)
      .then((response) => {
        this.passwordOtp.sent = true;
        this.passwordOtp.code = "";
        this.passwordOtp.channel = channel;
        this.passwordOtp.notice = response.deliveryWarning || `OTP sent by ${response.deliveryChannel || channel}.`;
        if (response.devOtp) this.passwordOtp.notice += ` Development OTP: ${response.devOtp}`;
      })
      .catch(() => {
        this.passwordOtp.notice = this.marketplace.error() || "Could not send mobile OTP.";
      });
  }

  async changePasswordWithOtp() {
    this.passwordNotice = "";
    const phone = this.customerPhone();
    if (!phone) {
      this.passwordNotice = "Add and verify your mobile number before using OTP password recovery.";
      return;
    }
    if (!this.passwordOtp.sent) {
      this.passwordNotice = "Send mobile OTP before updating password.";
      return;
    }
    if (this.passwordForm.next.length < 8) {
      this.passwordNotice = "New password must be at least 8 characters.";
      return;
    }
    if (this.passwordForm.next !== this.passwordForm.confirm) {
      this.passwordNotice = "Confirm password must match.";
      return;
    }
    await this.marketplace.changePasswordWithPhoneOtp(phone, this.passwordOtp.code, this.passwordForm.next)
      .then(() => {
        this.passwordForm = { current: "", next: "", confirm: "" };
        this.passwordOtpMode = false;
        this.passwordOtp = { sent: false, code: "", notice: "", channel: "sms" };
        this.passwordNotice = "Password updated with mobile OTP.";
      })
      .catch(() => {
        this.passwordOtp.notice = this.marketplace.error() || "Could not update password with mobile OTP.";
      });
  }

  async deleteAccount() {
    if (this.deleteConfirm !== "DELETE") return;
    await this.marketplace.deleteAccount(this.deletePassword)
      .then(() => this.router.navigateByUrl("/tabs/home"))
      .catch(() => undefined);
  }

  lettersOnly(value: unknown): string {
    return String(value || "").replace(/[^\p{L}]/gu, "").slice(0, this.namePartMaxLength);
  }

  private syncForm() {
    const customer = this.marketplace.customer();
    if (!customer) return;
    const parsedName = this.nameParts(customer.name || "");
    this.profileForm = {
      firstName: this.validNamePart(customer.firstName || "") ? String(customer.firstName) : parsedName.firstName,
      lastName: this.validNamePart(customer.lastName || "") ? String(customer.lastName) : parsedName.lastName,
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

  private focusDeleteConfirmIfNeeded() {
    if (this.section() !== "delete") return;
    window.setTimeout(() => {
      void this.deleteConfirmInput?.setFocus();
    }, 180);
  }

  maskedCustomerPhone(): string {
    const phone = this.customerPhone();
    if (!phone) return "your verified mobile number";
    const digits = phone.replace(/\D/g, "");
    if (digits.length <= 4) return phone;
    return `${phone.slice(0, Math.max(0, phone.length - 4)).replace(/\d/g, "*")}${digits.slice(-4)}`;
  }

  private customerPhone(): string {
    return String(this.marketplace.customer()?.phone || "").trim();
  }

  private nameParts(value: string): { firstName: string; lastName: string } {
    const parts = String(value || "").trim().split(/\s+/).filter((part) => this.validNamePart(part));
    return {
      firstName: parts[0] || "",
      lastName: parts[1] || ""
    };
  }

  private validNamePart(value: string): boolean {
    const normalized = String(value || "").trim();
    return normalized.length <= this.namePartMaxLength && /^\p{L}{2,}$/u.test(normalized);
  }
}
