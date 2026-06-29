import { Component, ElementRef, OnDestroy, OnInit, QueryList, ViewChildren } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { IonButton, IonContent, IonIcon, IonInput, IonItem, IonList } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { callOutline, closeOutline, logoApple, logoFacebook, logoGoogle, logoWhatsapp, mailOutline, personOutline, shieldCheckmarkOutline, sparklesOutline } from "ionicons/icons";
import { environment } from "../../../environments/environment";
import { AuthService } from "../../core/auth.service";
import { CustomerProfile } from "../../core/api.types";
import { APPLE_LOGIN_ENABLED } from "../../core/firebase-customer-auth.service";

type AuthStep = "choices" | "email" | "emailCode" | "completeProfile" | "mobile" | "mobileCode";

@Component({
  standalone: true,
  imports: [FormsModule, IonButton, IonContent, IonIcon, IonInput, IonItem, IonList],
  template: `
    <ion-content>
      <main class="auth-shell">
        <section class="auth-card">
          <div class="brand-mark"><ion-icon name="sparkles-outline"></ion-icon></div>
          <h1>AuraSalon for customers</h1>
          <p class="subtitle">Create an account or log in to book and manage your appointments</p>

          @if (notice) {
            <p class="notice-text">{{ notice }}</p>
          }
          @if (auth.error() && !mobileNotice) {
            <p class="error-text">{{ auth.error() }}</p>
          }

          @if (step === "choices") {
            <form (submit)="continueWithEmail($event)" class="auth-form choice-email-form">
              <label class="field-label" for="choiceEmail">Email</label>
              <ion-list>
                <ion-item lines="none">
                  <ion-input id="choiceEmail" type="email" inputmode="email" autocomplete="email" placeholder="" [(ngModel)]="email" name="choiceEmail"></ion-input>
                </ion-item>
              </ion-list>
              <p class="helper">We'll send you a verification code</p>
              <ion-button type="submit" expand="block" size="large" class="dark-continue-button" [disabled]="auth.loading()">Continue</ion-button>
            </form>
            <div class="divider"><span></span><strong>OR</strong><span></span></div>
            <div class="social-stack">
              <ion-button expand="block" fill="outline" class="choice-button" (click)="openMobileModal()" [disabled]="auth.loading()">
                <ion-icon name="call-outline" slot="start"></ion-icon>
                Continue with mobile
              </ion-button>
              <ion-button expand="block" fill="outline" class="choice-button" (click)="continueWithFacebook()" [disabled]="auth.loading() || !auth.firebaseConfigured() || mobileOtpCooldownCountdown > 0">
                <ion-icon name="logo-facebook" slot="start"></ion-icon>
                Continue with Facebook
              </ion-button>
              <ion-button expand="block" fill="outline" class="choice-button" (click)="continueWithGoogle()" [disabled]="auth.loading() || !auth.firebaseConfigured() || mobileOtpCooldownCountdown > 0">
                <ion-icon name="logo-google" slot="start"></ion-icon>
                Continue with Google
              </ion-button>
              <ion-button expand="block" fill="outline" class="choice-button" (click)="showWhatsApp()" [disabled]="auth.loading()">
                <ion-icon name="logo-whatsapp" slot="start"></ion-icon>
                Continue with WhatsApp
              </ion-button>
              <ion-button expand="block" fill="clear" class="guest-button" (click)="continueAsGuest()" [disabled]="auth.loading()">
                Continue as guest
              </ion-button>
              @if (appleLoginEnabled) {
                <ion-button expand="block" fill="outline" class="choice-button" (click)="continueWithApple()" [disabled]="auth.loading() || !auth.firebaseConfigured() || mobileOtpCooldownCountdown > 0">
                  <ion-icon name="logo-apple" slot="start"></ion-icon>
                  Continue with Apple
                </ion-button>
              }
            </div>
          }

          @if (step === "email") {
            <form (submit)="continueWithEmail($event)" class="auth-form">
              <label class="field-label" for="email">Email</label>
              <ion-list>
                <ion-item lines="none">
                  <ion-input id="email" type="email" inputmode="email" autocomplete="email" placeholder="" [(ngModel)]="email" name="email"></ion-input>
                </ion-item>
              </ion-list>
              <p class="helper">We'll send you a verification code</p>
              <ion-button type="submit" expand="block" size="large" class="primary-gradient" [disabled]="auth.loading()">Continue</ion-button>
              <ion-button type="button" expand="block" fill="clear" (click)="step = 'choices'">Back to login options</ion-button>
            </form>
          }

          @if (step === "emailCode") {
            <form (submit)="verifyEmailCode($event)" class="auth-form">
              <p class="step-copy">Enter the 6-digit verification code sent to <strong>{{ email }}</strong>.</p>
              <label class="field-label" for="emailCode">Verification code</label>
              <ion-list>
                <ion-item lines="none">
                  <ion-input id="emailCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" [(ngModel)]="code" name="emailCode"></ion-input>
                </ion-item>
              </ion-list>
              <ion-button type="submit" expand="block" size="large" class="primary-gradient" [disabled]="auth.loading()">Verify and continue</ion-button>
              <ion-button type="button" expand="block" fill="clear" (click)="step = 'email'">Use another email</ion-button>
            </form>
          }

          @if (step === "completeProfile") {
            <form (submit)="completeRequiredProfile($event)" class="auth-form">
              <p class="step-copy">Complete these details once. Mobile verification is required before your AuraSalon account opens.</p>
              <ion-list>
                <ion-item lines="none">
                  <ion-icon name="person-outline" slot="start"></ion-icon>
                  <ion-input label="First name" labelPlacement="stacked" type="text" inputmode="text" autocomplete="given-name" placeholder="First name" maxlength="40" [(ngModel)]="firstName" name="firstName" (ionInput)="firstName = lettersOnly($event.detail.value)"></ion-input>
                </ion-item>
                <ion-item lines="none">
                  <ion-icon name="person-outline" slot="start"></ion-icon>
                  <ion-input label="Last name" labelPlacement="stacked" type="text" inputmode="text" autocomplete="family-name" placeholder="Last name" maxlength="40" [(ngModel)]="lastName" name="lastName" (ionInput)="lastName = lettersOnly($event.detail.value)"></ion-input>
                </ion-item>
                <ion-item lines="none">
                  <ion-icon name="mail-outline" slot="start"></ion-icon>
                  <ion-input label="Email" labelPlacement="stacked" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" [(ngModel)]="completionEmail" name="completionEmail"></ion-input>
                </ion-item>
              </ion-list>
              <div class="phone-grid completion-phone-grid">
                <label>
                  <span class="field-label">Code</span>
                  <input class="plain-input" type="tel" inputmode="tel" autocomplete="tel-country-code" maxlength="4" [ngModel]="completionCountryCode" name="completionCountryCode" (ngModelChange)="onCompletionCountryCodeChange($event)" />
                </label>
                <label>
                  <span class="field-label">Mobile number</span>
                  <input class="plain-input" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="10" [ngModel]="completionPhone" name="completionPhone" (ngModelChange)="onCompletionPhoneChange($event)" />
                </label>
              </div>
              @if (completionPhoneVerified) {
                <p class="success-text">Mobile number verified.</p>
              } @else if (completionPhoneOtpSent) {
                <p class="helper">Enter the OTP sent to {{ completionFullPhone() }}.</p>
              } @else {
                <p class="helper">Submit once to send OTP. Verify the OTP to finish login.</p>
              }
              @if (completionPhoneOtpSent && !completionPhoneVerified) {
                <label class="field-label" for="completionPhoneOtp">Mobile OTP</label>
                <ion-list>
                  <ion-item lines="none">
                    <ion-input id="completionPhoneOtp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" [(ngModel)]="completionPhoneOtp" name="completionPhoneOtp"></ion-input>
                  </ion-item>
                </ion-list>
                <ion-button type="button" expand="block" size="large" class="primary-gradient" (click)="verifyCompletionPhoneOtp()" [disabled]="auth.loading()">Verify OTP</ion-button>
              }
              @if (!completionPhoneOtpSent || completionPhoneVerified) {
                <ion-button type="submit" expand="block" size="large" class="primary-gradient" [disabled]="auth.loading()">
                  {{ completionPhoneVerified ? "Continue" : "Send mobile OTP" }}
                </ion-button>
              } @else {
                <ion-button type="button" fill="clear" class="resend-otp-button" (click)="sendCompletionPhoneOtp()" [disabled]="auth.loading() || completionResendCountdown > 0">
                  {{ completionResendCountdown > 0 ? "Resend OTP in " + completionResendCountdown + "s" : "Resend OTP" }}
                </ion-button>
              }
            </form>
          }

          @if (step === "mobile") {
            <form (submit)="sendMobileOtp($event)" class="auth-form">
              <p class="step-copy">{{ otpChannel === "whatsapp" ? "Enter your WhatsApp number. We'll send your login OTP to this number." : "Enter your mobile number and we'll send an OTP by SMS." }}</p>
              <div class="phone-grid">
                <label>
                  <span class="field-label">Code</span>
                  <input class="plain-input" type="tel" inputmode="tel" [(ngModel)]="countryCode" name="countryCode" />
                </label>
                <label>
                  <span class="field-label">Mobile number</span>
                  <input class="plain-input" type="tel" inputmode="tel" autocomplete="tel" [(ngModel)]="phone" name="phone" />
                </label>
              </div>
              <p class="helper">{{ otpChannel === "whatsapp" ? "We'll send your login OTP on WhatsApp." : "We'll send your login OTP by SMS." }}</p>
              <ion-button type="submit" expand="block" size="large" class="primary-gradient" [disabled]="auth.loading()">Send OTP</ion-button>
              <ion-button type="button" expand="block" fill="clear" (click)="step = 'choices'">Back to login options</ion-button>
            </form>
          }

          @if (step === "mobileCode") {
            <form (submit)="verifyMobileOtp($event)" class="auth-form">
              <p class="step-copy">Enter the OTP sent to <strong>{{ fullPhone() }}</strong>.</p>
              <label class="field-label" for="mobileCode">OTP</label>
              <ion-list>
                <ion-item lines="none">
                  <ion-input id="mobileCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" [(ngModel)]="code" name="mobileCode"></ion-input>
                </ion-item>
              </ion-list>
              <ion-button type="submit" expand="block" size="large" class="primary-gradient" [disabled]="auth.loading()">Verify and continue</ion-button>
              @if (otpChannel === "whatsapp") {
                <ion-button type="button" expand="block" fill="outline" class="choice-button" (click)="resendOtp('whatsapp')" [disabled]="auth.loading()">Resend on WhatsApp</ion-button>
                <ion-button type="button" expand="block" fill="clear" (click)="resendOtp('sms')" [disabled]="auth.loading()">Send OTP by SMS</ion-button>
              }
              <ion-button type="button" expand="block" fill="clear" (click)="showMobile()">Use another number</ion-button>
            </form>
          }

          <p class="terms"><ion-icon name="shield-checkmark-outline"></ion-icon> By continuing, you agree to AuraSalon booking terms and privacy settings.</p>
        </section>

        <div id="customer-phone-recaptcha" class="recaptcha-host" aria-hidden="true"></div>

        @if (mobileModalOpen) {
          <div class="modal-backdrop" (click)="closeMobileModal()" aria-hidden="true"></div>
          <section class="mobile-modal" role="dialog" aria-modal="true" aria-labelledby="mobileLoginTitle">
            <div class="modal-head">
              <div>
                <p class="modal-eyebrow">Secure mobile login</p>
                <h2 id="mobileLoginTitle">Continue with mobile</h2>
              </div>
              <ion-button type="button" fill="clear" class="modal-close" aria-label="Close mobile login" (click)="closeMobileModal()">
                <ion-icon name="close-outline"></ion-icon>
              </ion-button>
            </div>

            @if (mobileNotice) {
              <p class="notice-text">{{ mobileNotice }}</p>
            }
            @if (auth.error() && !mobileNotice) {
              <p class="error-text">{{ auth.error() }}</p>
            }

            @if (mobileStage === "number") {
              <form class="auth-form" (submit)="sendMobileOtp($event)">
                <p class="step-copy">Enter your India mobile number. Firebase will send a real SMS OTP.</p>
                <div class="phone-grid modal-phone-grid">
                  <label>
                    <span class="field-label">Country</span>
                    <select class="plain-input country-select" [ngModel]="countryCode" name="modalCountryCode" (ngModelChange)="onCountryCodeChange($event)">
                      @for (option of countryOptions; track option.code) {
                        <option [value]="option.code">{{ option.label }}</option>
                      }
                    </select>
                  </label>
                  <label>
                    <span class="field-label">Mobile number</span>
                    <input class="plain-input" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="10" [ngModel]="phone" name="modalPhone" (ngModelChange)="onPhoneChange($event)" />
                  </label>
                </div>
                <ion-button id="customer-phone-sign-in-button" type="submit" expand="block" size="large" class="primary-gradient" [disabled]="auth.loading() || !auth.firebaseConfigured() || mobileOtpCooldownCountdown > 0">
                  {{ mobileOtpCooldownCountdown > 0 ? "Try again in " + mobileOtpCooldownCountdown + "s" : auth.loading() ? "Sending OTP..." : "Send OTP" }}
                </ion-button>
                @if (!auth.firebaseConfigured()) {
                  <p class="helper">Firebase is not configured for this deployment.</p>
                }
              </form>
            } @else {
              <form class="auth-form" (submit)="verifyMobileOtp($event)">
                <p class="step-copy">Enter the 6-digit OTP sent to <strong>{{ fullPhone() }}</strong>.</p>
                <div class="otp-preview" aria-label="One-time password">
                  @for (slot of otpSlots; track slot) {
                    <input
                      #mobileOtpBox
                      type="text"
                      inputmode="numeric"
                      autocomplete="one-time-code"
                      maxlength="1"
                      pattern="[0-9]*"
                      [attr.aria-label]="'OTP digit ' + (slot + 1)"
                      [value]="otpDigits[slot]"
                      (input)="onMobileOtpInput(slot, $event)"
                      (keydown)="onMobileOtpKeydown(slot, $event)"
                      (paste)="onMobileOtpPaste($event)" />
                  }
                </div>
                <ion-button type="submit" expand="block" size="large" class="primary-gradient" [disabled]="auth.loading()">
                  {{ auth.loading() ? "Verifying..." : "Verify and continue" }}
                </ion-button>
                <ion-button type="button" fill="clear" class="resend-otp-button" (click)="resendFirebaseOtp()" [disabled]="auth.loading() || mobileResendCountdown > 0">
                  {{ mobileResendCountdown > 0 ? "Resend OTP in " + mobileResendCountdown + "s" : "Resend OTP" }}
                </ion-button>
                <ion-button type="button" expand="block" fill="clear" (click)="mobileStage = 'number'">Use another number</ion-button>
              </form>
            }
          </section>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .auth-shell {
      min-height: 100%;
      display: grid;
      place-items: center;
      padding: 28px 16px;
      background:
        radial-gradient(circle at top left, rgba(214, 169, 74, 0.18), transparent 32%),
        radial-gradient(circle at bottom right, rgba(244, 213, 141, 0.2), transparent 34%),
        linear-gradient(180deg, #FFF9EC, #FBF1DE 58%, #F5E3C4);
    }

    .auth-card {
      width: min(100%, 690px);
      display: grid;
      gap: 18px;
      padding: clamp(24px, 6vw, 34px);
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 28px;
      background:
        linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(255, 249, 236, 0.96) 44%, rgba(246, 228, 193, 0.9)),
        #FFF9EC;
      box-shadow: 0 30px 80px rgba(92, 65, 28, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.8);
    }

    .brand-mark {
      width: 58px;
      height: 58px;
      display: grid;
      place-items: center;
      margin: 0 auto 4px;
      border-radius: 20px;
      color: var(--primary);
      background: rgba(214, 169, 74, 0.14);
      box-shadow: inset 0 0 0 1px rgba(214, 169, 74, 0.22), 0 18px 34px rgba(92, 65, 28, 0.12);
      font-size: 1.55rem;
    }

    h1 {
      margin: 0;
      color: var(--text);
      font-size: clamp(1.8rem, 8vw, 2.35rem);
      font-weight: 900;
      letter-spacing: 0;
      text-align: center;
    }

    .subtitle,
    .step-copy {
      margin: 0;
      color: var(--muted);
      line-height: 1.55;
      text-align: center;
      font-weight: 700;
    }

    .auth-form,
    .social-stack {
      display: grid;
      gap: 12px;
    }

    .choice-email-form {
      gap: 8px;
      margin-top: 2px;
    }

    .field-label {
      display: block;
      color: var(--text);
      font-size: 0.9rem;
      font-weight: 900;
    }

    .helper {
      margin: -2px 0 2px;
      color: var(--muted);
      font-size: 0.86rem;
      font-weight: 700;
    }

    ion-list {
      margin: 0;
      padding: 0;
      overflow: hidden;
      border: 1px solid rgba(126, 110, 85, 0.28);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.94);
    }

    ion-item {
      --background: transparent;
      --padding-start: 14px;
      --inner-padding-end: 14px;
      --highlight-color-focused: var(--primary);
      --highlight-color-valid: var(--primary);
      --highlight-color-invalid: #B45309;
      --color-focused: var(--primary-2);
    }

    ion-input {
      --highlight-color-focused: var(--primary);
      --highlight-color-valid: var(--primary);
      --highlight-color-invalid: #B45309;
      --color-focused: var(--primary-2);
      --caret-color: var(--primary-2);
    }

    ion-item.item-has-focus ion-icon,
    ion-item.item-has-focus ion-input,
    ion-item.item-has-focus ion-input::part(label) {
      color: var(--primary-2);
    }

    .plain-input {
      width: 100%;
      min-height: 54px;
      padding: 0 14px;
      border: 1px solid rgba(214, 169, 74, 0.24);
      border-radius: 18px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.88);
      font: inherit;
      font-weight: 800;
      outline: none;
    }

    .plain-input:focus {
      border-color: rgba(214, 169, 74, 0.52);
      box-shadow: 0 0 0 4px rgba(214, 169, 74, 0.14);
    }

    .phone-grid {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr);
      gap: 10px;
    }

    .choice-button {
      --border-color: rgba(126, 110, 85, 0.28);
      --border-radius: 999px;
      --color: var(--text);
      --color-activated: var(--text);
      --background: rgba(255, 255, 255, 0.94);
      --background-activated: rgba(214, 169, 74, 0.12);
      --background-hover: rgba(255, 249, 236, 0.98);
      min-height: 50px;
      font-weight: 900;
      letter-spacing: 0;
    }

    .choice-button ion-icon {
      font-size: 1.2rem;
    }

    .choice-button ion-icon[name="logo-facebook"] {
      color: #1877F2;
    }

    .choice-button ion-icon[name="logo-google"] {
      color: #EA4335;
    }

    .choice-button ion-icon[name="logo-whatsapp"] {
      color: #25D366;
    }

    .dark-continue-button {
      --background: #080806;
      --background-hover: #17130C;
      --background-activated: #000000;
      --border-radius: 999px;
      --box-shadow: 0 16px 34px rgba(35, 25, 13, 0.18);
      --color: #ffffff;
      min-height: 50px;
      margin-top: 12px;
      font-weight: 900;
      letter-spacing: 0;
    }

    .guest-button {
      --color: var(--primary);
      --color-activated: var(--primary-2);
      --background-activated: rgba(214, 169, 74, 0.1);
      margin-top: 2px;
      font-weight: 900;
    }

    .resend-otp-button {
      justify-self: center;
      width: auto;
      min-height: 34px;
      margin: -2px auto 0;
      --padding-start: 14px;
      --padding-end: 14px;
      --border-color: rgba(184, 123, 27, 0.42);
      --border-radius: 999px;
      --border-width: 1px;
      --border-style: solid;
      --color: #7A5019;
      --color-activated: var(--primary);
      --background: rgba(255, 249, 236, 0.94);
      --background-hover: rgba(214, 169, 74, 0.16);
      --background-activated: rgba(214, 169, 74, 0.22);
      --box-shadow: 0 8px 18px rgba(122, 80, 25, 0.08);
      font-size: 0.82rem;
      font-weight: 900;
      letter-spacing: 0;
    }

    .resend-otp-button::part(native) {
      padding-inline: 14px;
    }

    .resend-otp-button.button-disabled {
      opacity: 1;
      --color: rgba(122, 80, 25, 0.72);
      --background: rgba(214, 169, 74, 0.16);
    }

    .divider {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 14px;
      margin: 10px 0 2px;
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 900;
    }

    .divider span {
      height: 1px;
      background: rgba(126, 110, 85, 0.2);
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
      color: var(--primary-2);
      background: rgba(214, 169, 74, 0.12);
      border: 1px solid rgba(214, 169, 74, 0.26);
    }

    .success-text {
      margin: 0;
      padding: 11px 13px;
      border: 1px solid rgba(214, 169, 74, 0.28);
      border-radius: 14px;
      color: #7A5019;
      background: rgba(214, 169, 74, 0.12);
      font-size: 0.86rem;
      font-weight: 900;
    }

    .error-text {
      color: #FCA5A5;
      background: rgba(127, 29, 29, 0.2);
      border: 1px solid rgba(239, 68, 68, 0.32);
    }

    .terms {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 0.82rem;
      line-height: 1.45;
    }

    .terms ion-icon {
      flex: 0 0 auto;
      margin-top: 2px;
      color: #10B981;
    }

    .recaptcha-host {
      position: fixed;
      width: 1px;
      height: 1px;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
    }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 20;
      background: rgba(35, 25, 13, 0.42);
      backdrop-filter: blur(8px);
    }

    .mobile-modal {
      position: fixed;
      left: 50%;
      top: 50%;
      z-index: 21;
      width: min(calc(100vw - 28px), 470px);
      display: grid;
      gap: 16px;
      padding: 20px;
      border: 1px solid rgba(214, 169, 74, 0.28);
      border-radius: 24px;
      background: rgba(255, 252, 245, 0.98);
      box-shadow: 0 28px 80px rgba(35, 25, 13, 0.28);
      transform: translate(-50%, -50%);
    }

    .modal-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .modal-eyebrow {
      margin: 0 0 4px;
      color: var(--primary-2);
      font-size: 0.78rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .modal-head h2 {
      margin: 0;
      color: var(--text);
      font-size: 1.35rem;
      font-weight: 900;
      letter-spacing: 0;
    }

    .modal-close {
      --color: var(--text);
      --background-activated: rgba(214, 169, 74, 0.12);
      min-width: 42px;
      min-height: 42px;
      margin: -6px -8px 0 0;
      font-size: 1.15rem;
    }

    .modal-phone-grid {
      grid-template-columns: 132px minmax(0, 1fr);
    }

    .country-select {
      appearance: auto;
    }

    .otp-preview {
      display: grid;
      grid-template-columns: repeat(6, 48px);
      justify-content: center;
      gap: 8px;
      margin: 8px 0 4px;
    }

    .otp-preview input {
      width: 48px;
      height: 54px;
      min-width: 0;
      padding: 0;
      border: 1px solid rgba(126, 110, 85, 0.28);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.92);
      color: var(--text);
      font-size: 1.24rem;
      font-weight: 900;
      text-align: center;
      outline: none;
    }

    .otp-preview input:focus {
      border-color: rgba(214, 169, 74, 0.58);
      box-shadow: 0 0 0 4px rgba(214, 169, 74, 0.14);
    }

    @media (max-width: 599px) {
      .auth-card {
        width: 100%;
        border-radius: 24px;
      }

      .mobile-modal {
        top: auto;
        bottom: max(14px, env(safe-area-inset-bottom));
        transform: translateX(-50%);
        border-radius: 22px;
      }

      .modal-phone-grid {
        grid-template-columns: 1fr;
      }

      .otp-preview {
        grid-template-columns: repeat(6, minmax(0, 42px));
        gap: 6px;
      }

      .otp-preview input {
        width: 42px;
        height: 50px;
        border-radius: 12px;
        font-size: 1.1rem;
      }
    }
  `]
})
export class LoginPage implements OnInit, OnDestroy {
  readonly appleLoginEnabled = APPLE_LOGIN_ENABLED;
  readonly countryOptions = [
    { code: "+91", label: "India +91" }
  ];
  readonly otpSlots = [0, 1, 2, 3, 4, 5];
  private readonly namePartMaxLength = 40;
  step: AuthStep = "choices";
  email = "";
  code = "";
  firstName = "";
  lastName = "";
  completionEmail = "";
  completionCountryCode = "+91";
  completionPhone = "";
  completionPhoneOtp = "";
  completionPhoneOtpSent = false;
  completionPhoneVerified = false;
  completionResendCountdown = 0;
  countryCode = "+91";
  phone = "";
  notice = "";
  mobileNotice = "";
  mobileModalOpen = false;
  mobileStage: "number" | "otp" = "number";
  otpDigits = ["", "", "", "", "", ""];
  mobileResendCountdown = 0;
  mobileOtpCooldownCountdown = 0;
  otpChannel: "sms" | "whatsapp" = "sms";
  private completionResendTimer?: ReturnType<typeof setInterval>;
  private mobileResendTimer?: ReturnType<typeof setInterval>;
  private mobileOtpCooldownTimer?: ReturnType<typeof setInterval>;

  @ViewChildren("mobileOtpBox") private readonly mobileOtpBoxes!: QueryList<ElementRef<HTMLInputElement>>;

  constructor(readonly auth: AuthService, private readonly router: Router, private readonly route: ActivatedRoute) {
    addIcons({ callOutline, closeOutline, logoApple, logoFacebook, logoGoogle, logoWhatsapp, mailOutline, personOutline, shieldCheckmarkOutline, sparklesOutline });
  }

  ngOnInit() {
    if (!environment.production && window.location.hostname === "127.0.0.1") {
      window.location.replace(`http://localhost:${window.location.port}${window.location.pathname}${window.location.search}${window.location.hash}`);
      return;
    }
    void this.resumeExistingSession();
    void this.handleFacebookRedirectResult();
  }

  private async handleFacebookRedirectResult() {
    if (this.auth.isAuthenticated()) return;
    try {
      const session = await this.auth.handleFacebookRedirect();
      if (session) this.afterProviderSignIn(session);
    } catch {
      /* error already set by auth service */
    }
  }

  ngOnDestroy() {
    this.clearCompletionResendTimer();
    this.clearMobileResendTimer();
    this.clearMobileOtpCooldown();
  }

  async continueWithEmail(event: Event) {
    event.preventDefault();
    const email = this.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.notice = "Enter a valid email address.";
      return;
    }
    this.notice = "";
    await this.auth.requestEmailCode(email)
      .then(() => {
        this.code = "";
        this.step = "emailCode";
        const response = this.auth.emailCodeRequest();
        this.notice = `Verification code sent.${response?.devOtp ? ` Development code: ${response.devOtp}` : ""}`;
      })
      .catch(() => undefined);
  }

  showEmail() {
    this.step = "email";
    this.notice = "";
    this.code = "";
  }

  async verifyEmailCode(event: Event) {
    event.preventDefault();
    this.notice = "";
    await this.auth.verifyEmailCode(this.email, this.code)
      .then((session) => {
        if (session.isNewCustomer || !this.auth.profileComplete(session.customer)) {
          this.prepareCompletion(session.customer);
          return;
        }
        this.openHome();
      })
      .catch(() => undefined);
  }

  openMobileModal() {
    this.mobileModalOpen = true;
    this.mobileStage = "number";
    this.mobileNotice = "";
    this.notice = "";
    this.auth.error.set("");
    this.code = "";
    this.otpDigits = ["", "", "", "", "", ""];
    this.otpChannel = "sms";
    this.countryCode = this.countryCode || "+91";
  }

  closeMobileModal() {
    this.mobileModalOpen = false;
    this.mobileStage = "number";
    this.mobileNotice = "";
    this.code = "";
    this.otpDigits = ["", "", "", "", "", ""];
    this.clearMobileResendTimer();
  }

  showMobile() {
    this.openMobileModal();
  }

  showWhatsApp() {
    this.notice = "WhatsApp login is coming soon. Use mobile SMS OTP, Google, Facebook, or email for now.";
    this.mobileModalOpen = false;
    this.code = "";
    this.otpChannel = "whatsapp";
  }

  async sendMobileOtp(event?: Event) {
    event?.preventDefault();
    this.phone = this.phoneDigits(this.phone);
    const phone = this.fullPhone();
    if (!/^\+91\d{10}$/.test(phone)) {
      this.mobileNotice = "Enter a valid 10-digit India mobile number.";
      return;
    }
    if (this.isLocalPhoneAuthHost()) {
      this.mobileNotice = "Firebase real SMS OTP cannot be sent from localhost. Open the customer app on an HTTPS domain added in Firebase Authentication authorized domains.";
      return;
    }
    if (this.mobileOtpCooldownCountdown > 0) {
      this.mobileNotice = `Firebase is rate-limiting OTP sends. Try again in ${this.mobileOtpCooldownCountdown}s.`;
      return;
    }
    this.mobileNotice = "";
    this.notice = "";
    await this.auth.requestFirebasePhoneOtp(phone, "customer-phone-recaptcha")
      .then(() => {
        this.code = "";
        this.otpDigits = ["", "", "", "", "", ""];
        this.clearMobileOtpCooldown();
        this.mobileStage = "otp";
        this.mobileNotice = "OTP sent by SMS.";
        this.startMobileResendCountdown();
        setTimeout(() => this.focusMobileOtp(0));
      })
      .catch(() => this.handleFirebaseOtpRequestFailure());
  }

  async resendFirebaseOtp() {
    if (this.mobileResendCountdown > 0 || this.mobileOtpCooldownCountdown > 0 || this.auth.loading()) return;
    await this.sendMobileOtp();
  }

  async resendOtp(channel: "sms" | "whatsapp") {
    this.otpChannel = channel;
    this.notice = "";
    await this.auth.requestOtp(this.fullPhone(), channel)
      .then((response) => {
        this.code = "";
        this.notice = this.otpNotice(response);
      })
      .catch((error) => this.handleOtpRequestError(error));
  }

  async verifyMobileOtp(event?: Event) {
    event?.preventDefault();
    this.mobileNotice = "";
    this.notice = "";
    const otp = this.mobileOtpValue() || this.code.trim();
    if (!/^\d{6}$/.test(otp)) {
      this.mobileNotice = "Enter the 6-digit OTP.";
      return;
    }
    await this.auth.verifyFirebasePhoneOtp(otp)
      .then((session) => {
        this.closeMobileModal();
        this.afterProviderSignIn(session);
      })
      .catch(() => undefined);
  }

  async completeRequiredProfile(event: Event) {
    event.preventDefault();
    this.notice = "";
    const firstName = this.lettersOnly(this.firstName).trim();
    const lastName = this.lettersOnly(this.lastName).trim();
    const email = this.completionEmail.trim().toLowerCase();
    this.completionPhone = this.phoneDigits(this.completionPhone);
    const phone = this.completionFullPhone();
    if (!this.validNamePart(firstName)) {
      this.notice = "First name can contain letters only.";
      return;
    }
    if (!this.validNamePart(lastName)) {
      this.notice = "Last name can contain letters only.";
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.notice = "Enter a valid email address.";
      return;
    }
    if (phone.replace(/\D/g, "").length < 8) {
      this.notice = "Enter a valid mobile number.";
      return;
    }
    if (!this.completionPhoneVerified) {
      await this.sendCompletionPhoneOtp();
      return;
    }
    await this.auth.updateMe({
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
      email,
      phone
    })
      .then(() => this.openHome())
      .catch(() => undefined);
  }

  async sendCompletionPhoneOtp() {
    this.notice = "";
    this.completionPhone = this.phoneDigits(this.completionPhone);
    if (!this.isValidFullPhone(this.completionFullPhone())) {
      this.notice = "Enter a valid mobile number.";
      return;
    }
    await this.auth.requestProfilePhoneOtp(this.completionFullPhone(), "sms")
      .then((response) => {
        this.completionPhoneOtp = "";
        this.completionPhoneOtpSent = true;
        this.startCompletionResendCountdown();
        this.notice = response.deliveryWarning || "Mobile OTP sent by SMS.";
        if (response.devOtp) this.notice += ` Development OTP: ${response.devOtp}`;
      })
      .catch(() => undefined);
  }

  async verifyCompletionPhoneOtp() {
    this.notice = "";
    this.completionPhone = this.phoneDigits(this.completionPhone);
    await this.auth.verifyProfilePhoneOtp(this.completionFullPhone(), this.completionPhoneOtp)
      .then((profile) => {
        this.completionPhoneVerified = true;
        this.completionPhoneOtpSent = false;
        this.clearCompletionResendTimer();
        this.prepareCompletion(profile);
        this.completionPhoneVerified = true;
        this.notice = "Mobile number verified. Continue to finish your account.";
      })
      .catch(() => undefined);
  }

  async continueWithGoogle() {
    this.notice = "";
    await this.auth.signInWithGoogle().then((session) => this.afterProviderSignIn(session)).catch(() => undefined);
  }

  async continueWithFacebook() {
    this.notice = "";
    await this.auth.signInWithFacebook().catch(() => undefined);
  }

  async continueWithApple() {
    this.notice = "";
    await this.auth.signInWithApple().then((session) => this.afterProviderSignIn(session)).catch(() => undefined);
  }

  continueAsGuest() {
    void this.router.navigateByUrl("/tabs/home");
  }

  fullPhone(): string {
    const code = this.countryCode.trim().startsWith("+") ? this.countryCode.trim() : "+" + this.countryCode.trim();
    return code + this.phoneDigits(this.phone);
  }

  completionFullPhone(): string {
    const codeDigits = String(this.completionCountryCode || "").replace(/\D/g, "").slice(0, 3) || "91";
    return `+${codeDigits}${this.phoneDigits(this.completionPhone)}`;
  }

  lettersOnly(value: unknown): string {
    return String(value || "").replace(/[^\p{L}]/gu, "").slice(0, this.namePartMaxLength);
  }

  onCountryCodeChange(value: unknown) {
    const codeDigits = String(value || "").replace(/\D/g, "").slice(0, 3) || "91";
    this.countryCode = `+${codeDigits}`;
  }

  onPhoneChange(value: unknown) {
    this.phone = this.phoneDigits(value);
  }

  onMobileOtpInput(index: number, event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/\D/g, "");
    if (value.length > 1) {
      this.fillMobileOtpFrom(value, index);
      return;
    }
    this.otpDigits[index] = value;
    input.value = value;
    this.mobileNotice = "";
    if (value && index < this.otpSlots.length - 1) this.focusMobileOtp(index + 1);
  }

  onMobileOtpKeydown(index: number, event: KeyboardEvent) {
    if (event.key === "Backspace" && !this.otpDigits[index] && index > 0) {
      this.focusMobileOtp(index - 1);
    }
  }

  onMobileOtpPaste(event: ClipboardEvent) {
    event.preventDefault();
    this.fillMobileOtpFrom(event.clipboardData?.getData("text") || "", 0);
  }

  onCompletionCountryCodeChange(value: unknown) {
    const codeDigits = String(value || "").replace(/\D/g, "").slice(0, 3) || "91";
    this.completionCountryCode = `+${codeDigits}`;
    this.resetCompletionPhoneVerification();
  }

  onCompletionPhoneChange(value: unknown) {
    this.completionPhone = this.phoneDigits(value);
    this.resetCompletionPhoneVerification();
  }

  private fillMobileOtpFrom(value: string, startIndex: number) {
    const chars = value.replace(/\D/g, "").slice(0, this.otpSlots.length - startIndex).split("");
    chars.forEach((char, offset) => {
      this.otpDigits[startIndex + offset] = char;
    });
    this.mobileOtpBoxes?.forEach((box, index) => {
      box.nativeElement.value = this.otpDigits[index] || "";
    });
    this.mobileNotice = "";
    this.focusMobileOtp(Math.min(startIndex + chars.length, this.otpSlots.length - 1));
  }

  private focusMobileOtp(index: number) {
    this.mobileOtpBoxes?.get(index)?.nativeElement.focus();
  }

  private mobileOtpValue(): string {
    return this.otpDigits.join("");
  }

  private startMobileResendCountdown() {
    this.clearMobileResendTimer();
    this.mobileResendCountdown = 30;
    this.mobileResendTimer = setInterval(() => {
      this.mobileResendCountdown = Math.max(0, this.mobileResendCountdown - 1);
      if (this.mobileResendCountdown === 0) this.clearMobileResendTimer();
    }, 1000);
  }

  private clearMobileResendTimer() {
    if (this.mobileResendTimer) {
      clearInterval(this.mobileResendTimer);
      this.mobileResendTimer = undefined;
    }
    this.mobileResendCountdown = 0;
  }

  private handleFirebaseOtpRequestFailure() {
    const message = this.auth.error().trim();
    if (this.isFirebaseOtpRateLimitMessage(message)) {
      this.auth.error.set("");
      this.mobileNotice = "Firebase has temporarily rate-limited OTP sends for this number or project. Wait before trying again.";
      this.startMobileOtpCooldown();
      return;
    }
    if (!message || message.toLowerCase() === "error" || message.toLowerCase() === "unable to send otp") {
      this.auth.error.set("");
      this.mobileNotice = "Firebase could not send OTP. Check Phone provider, India SMS region policy, billing/quota, and authorized domain, then try again.";
    }
  }

  private startMobileOtpCooldown(seconds = 60) {
    this.clearMobileOtpCooldown();
    this.mobileOtpCooldownCountdown = seconds;
    this.mobileOtpCooldownTimer = setInterval(() => {
      this.mobileOtpCooldownCountdown = Math.max(0, this.mobileOtpCooldownCountdown - 1);
      if (this.mobileOtpCooldownCountdown === 0) this.clearMobileOtpCooldown();
    }, 1000);
  }

  private clearMobileOtpCooldown() {
    if (this.mobileOtpCooldownTimer) {
      clearInterval(this.mobileOtpCooldownTimer);
      this.mobileOtpCooldownTimer = undefined;
    }
    this.mobileOtpCooldownCountdown = 0;
  }

  private isFirebaseOtpRateLimitMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes("too many otp attempts") || normalized.includes("quota exceeded") || normalized.includes("rate-limit");
  }

  private isLocalPhoneAuthHost(): boolean {
    if (typeof window === "undefined") return false;
    return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  }

  private afterProviderSignIn(session: { customer: CustomerProfile }) {
    this.auth.error.set("");
    const customer = this.auth.customer() || session.customer;
    if (!this.auth.profileComplete(customer)) {
      this.prepareCompletion(customer);
      return;
    }
    this.openHome();
  }

  private prepareCompletion(customer = this.auth.customer()) {
    const nameParts = this.nameParts(customer?.name || "");
    this.firstName = this.validNamePart(customer?.firstName || "")
      ? String(customer?.firstName)
      : nameParts.firstName || (this.validNamePart(this.firstName) ? this.lettersOnly(this.firstName) : "");
    this.lastName = this.validNamePart(customer?.lastName || "")
      ? String(customer?.lastName)
      : nameParts.lastName || (this.validNamePart(this.lastName) ? this.lettersOnly(this.lastName) : "");
    this.completionEmail = (customer?.email || this.email || this.completionEmail).trim().toLowerCase();
    const phone = this.firstValidPhone(
      customer?.phone,
      this.fullPhoneIfEntered(),
      this.completionFullPhone()
    );
    this.setCompletionPhone(phone);
    this.completionPhoneVerified = !!customer?.phoneVerifiedAt && this.completionFullPhone() === String(customer.phone || "").trim();
    this.completionPhoneOtpSent = false;
    this.completionPhoneOtp = "";
    this.clearCompletionResendTimer();
    this.step = "completeProfile";
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

  private fullPhoneIfEntered(): string {
    return this.phone.replace(/\D/g, "") ? this.fullPhone() : "";
  }

  private phoneDigits(value: unknown): string {
    return String(value || "").replace(/\D/g, "").slice(0, 10);
  }

  private isValidFullPhone(value: unknown): boolean {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15;
  }

  private firstValidPhone(...values: Array<unknown>): string {
    return values.find((value) => this.isValidFullPhone(value)) as string || "";
  }

  private setCompletionPhone(phone: string) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) {
      this.completionCountryCode = "+91";
      this.completionPhone = "";
      return;
    }
    if (digits.startsWith("91") && digits.length > 10) {
      this.completionCountryCode = "+91";
      this.completionPhone = digits.slice(2, 12);
      return;
    }
    this.completionCountryCode = "+91";
    this.completionPhone = digits.slice(-10);
  }

  private resetCompletionPhoneVerification() {
    this.completionPhoneVerified = false;
    this.completionPhoneOtpSent = false;
    this.completionPhoneOtp = "";
    this.clearCompletionResendTimer();
  }

  private startCompletionResendCountdown() {
    this.clearCompletionResendTimer();
    this.completionResendCountdown = 30;
    this.completionResendTimer = setInterval(() => {
      this.completionResendCountdown = Math.max(0, this.completionResendCountdown - 1);
      if (this.completionResendCountdown === 0) {
        this.clearCompletionResendTimer();
      }
    }, 1000);
  }

  private clearCompletionResendTimer() {
    if (this.completionResendTimer) {
      clearInterval(this.completionResendTimer);
      this.completionResendTimer = undefined;
    }
    this.completionResendCountdown = 0;
  }

  private openHome() {
    this.openReturnUrl();
  }

  private openReturnUrl() {
    const customer = this.auth.customer();
    if (this.auth.isAuthenticated() && customer && !this.auth.profileComplete(customer)) {
      this.prepareCompletion(customer);
      return;
    }
    const returnUrl = this.route.snapshot.queryParamMap.get("returnUrl");
    void this.router.navigateByUrl(returnUrl && returnUrl.startsWith("/") ? returnUrl : "/tabs/home");
  }

  private async resumeExistingSession() {
    if (!this.auth.isAuthenticated() || this.auth.biometricLocked()) return;
    let customer = this.auth.customer();
    if (!customer) {
      try {
        customer = await this.auth.loadMe();
      } catch {
        this.step = "choices";
        return;
      }
    }
    if (!this.auth.profileComplete(customer)) {
      this.prepareCompletion(customer);
      return;
    }
    this.openReturnUrl();
  }

  private showOtpFallback() {
    if (this.otpChannel !== "whatsapp") return;
    this.auth.error.set("");
    this.step = "mobileCode";
    this.notice = "WhatsApp OTP could not be sent. Resend on WhatsApp or send OTP by SMS.";
  }

  private handleOtpRequestError(error: unknown) {
    const message = this.extractErrorMessage(error) || this.auth.error();
    if (this.isOtpTemporarilyLocked(message)) {
      this.auth.error.set("");
      this.notice = "Too many OTP attempts. Please wait 15 minutes before requesting another code.";
      return;
    }
    this.showOtpFallback();
  }

  private isOtpTemporarilyLocked(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes("otp temporarily locked")
      || normalized.includes("try again after 15 minutes")
      || normalized.includes("too many otp")
      || normalized.includes("resend limit");
  }

  private extractErrorMessage(error: unknown): string {
    if (!error || typeof error !== "object") return "";
    const payload = error as { error?: unknown; message?: unknown };
    if (typeof payload.message === "string") return payload.message;
    if (payload.error && typeof payload.error === "object") {
      const apiError = payload.error as { error?: unknown; message?: unknown };
      if (typeof apiError.message === "string") return apiError.message;
      if (apiError.error && typeof apiError.error === "object") {
        const nested = apiError.error as { message?: unknown };
        if (typeof nested.message === "string") return nested.message;
      }
    }
    return "";
  }

  private otpNotice(response: { deliveryChannel?: string; requestedChannel?: string; deliveryWarning?: string; devOtp?: string }): string {
    const channel = response.deliveryChannel || response.requestedChannel || "";
    const suffix = response.devOtp ? ` Development OTP: ${response.devOtp}` : "";
    if (response.deliveryWarning) return `${response.deliveryWarning}${suffix}`;
    if (channel === "whatsapp") return `OTP sent on WhatsApp.${suffix}`;
    if (channel === "sms") return `OTP sent by SMS.${suffix}`;
    return `OTP sent. If delivery is unavailable, use the local verification code in development.${suffix}`;
  }
}
