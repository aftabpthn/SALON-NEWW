import { Component, ElementRef, QueryList, ViewChildren } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { IonButton, IonContent } from "@ionic/angular/standalone";
import { AuthService } from "../../core/auth.service";

@Component({
  standalone: true,
  imports: [IonButton, IonContent],
  template: `
    <ion-content>
      <main class="otp-shell">
        <form class="otp-card premium-card" (submit)="verify($event)">
          <h1>Confirm your OTP</h1>
          <p class="muted">{{ deliveryText() }}</p>
          @if (error || auth.error()) {
            <p class="error-text">{{ error || auth.error() }}</p>
          }
          <div class="otp-preview" aria-label="One-time password">
            @for (slot of slots; track slot) {
              <input
                #otpBox
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="1"
                pattern="[0-9]*"
                [attr.aria-label]="'OTP digit ' + (slot + 1)"
                [value]="digits[slot]"
                (input)="onDigitInput(slot, $event)"
                (keydown)="onDigitKeydown(slot, $event)"
                (paste)="onPaste($event)" />
            }
          </div>
          <ion-button type="submit" expand="block" size="large" class="primary-gradient" [disabled]="auth.loading()">Verify and continue</ion-button>
        </form>
      </main>
    </ion-content>
  `,
  styles: [`
    .otp-shell {
      min-height: 100%;
      display: grid;
      place-items: center;
      width: 100%;
      margin: 0 auto;
      padding: 24px 16px calc(96px + env(safe-area-inset-bottom));
      box-sizing: border-box;
    }

    .otp-card {
      width: 100%;
      max-width: 480px;
      padding: clamp(20px, 5vw, 28px);
      text-align: center;
      box-sizing: border-box;
    }

    h1 {
      margin: 0 0 10px;
      font-size: clamp(1.9rem, 7vw, 3rem);
      letter-spacing: 0;
    }

    .otp-preview {
      display: grid;
      grid-template-columns: repeat(6, 52px);
      justify-content: center;
      gap: 9px;
      margin: 24px 0 14px;
    }

    .otp-preview input {
      width: 52px;
      height: 56px;
      min-width: 0;
      min-height: 0;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--surface-soft);
      color: var(--text);
      font-size: 1.35rem;
      font-weight: 900;
      text-align: center;
      outline: none;
      transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
    }

    .otp-preview input:focus {
      border-color: rgba(139, 92, 246, 0.48);
      background: #ffffff;
      box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.14);
    }

    .error-text {
      margin: 14px 0 0;
      color: #EF4444;
      font-weight: 800;
      line-height: 1.45;
    }

    ion-button {
      width: 100%;
      margin-inline: 0;
    }

    @media (max-width: 599px) {
      .otp-preview {
        grid-template-columns: repeat(6, 44px);
        gap: 6px;
      }

      .otp-preview input {
        width: 44px;
        height: 50px;
        border-radius: 14px;
        font-size: 1.16rem;
      }
    }
  `]
})
export class VerifyOtpPage {
  readonly slots = [0, 1, 2, 3, 4, 5];
  digits = ["", "", "", "", "", ""];
  error = "";

  @ViewChildren("otpBox") private readonly otpBoxes!: QueryList<ElementRef<HTMLInputElement>>;

  constructor(readonly auth: AuthService, private readonly router: Router, private readonly route: ActivatedRoute) {}

  deliveryText(): string {
    const phone = this.auth.otpPhone() || "your phone";
    return `Enter the 6-digit code sent to ${phone}.`;
  }

  onDigitInput(index: number, event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/\D/g, "");
    if (value.length > 1) {
      this.fillFrom(value, index);
      return;
    }
    this.digits[index] = value;
    input.value = value;
    this.error = "";
    if (value && index < this.slots.length - 1) this.focus(index + 1);
  }

  onDigitKeydown(index: number, event: KeyboardEvent) {
    if (event.key === "Backspace" && !this.digits[index] && index > 0) {
      this.focus(index - 1);
    }
  }

  onPaste(event: ClipboardEvent) {
    event.preventDefault();
    this.fillFrom(event.clipboardData?.getData("text") || "", 0);
  }

  async verify(event?: Event) {
    event?.preventDefault();
    const otp = this.otpValue();
    this.error = "";
    if (!this.auth.otpPhone()) {
      this.error = "Request a new OTP before verifying.";
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      this.error = "Enter the 6-digit OTP.";
      return;
    }
    const verifier = this.auth.otpRequest()
      ? this.auth.verifyOtp(this.auth.otpPhone(), otp)
      : this.auth.verifyFirebasePhoneOtp(otp);
    await verifier
      .then(() => this.router.navigateByUrl(this.returnUrl()))
      .catch(() => undefined);
  }

  private fillFrom(value: string, startIndex: number) {
    const chars = value.replace(/\D/g, "").slice(0, this.slots.length - startIndex).split("");
    chars.forEach((char, offset) => {
      this.digits[startIndex + offset] = char;
    });
    this.otpBoxes.forEach((box, index) => {
      box.nativeElement.value = this.digits[index] || "";
    });
    this.error = "";
    this.focus(Math.min(startIndex + chars.length, this.slots.length - 1));
  }

  private focus(index: number) {
    this.otpBoxes.get(index)?.nativeElement.focus();
  }

  private otpValue(): string {
    return this.digits.join("");
  }

  private returnUrl(): string {
    return this.route.snapshot.queryParamMap.get("returnUrl") || "/tabs/home";
  }
}
