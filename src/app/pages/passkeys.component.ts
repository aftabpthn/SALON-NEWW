import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PasskeyInfo, WebauthnApiService } from '../core/webauthn-api.service';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

/** Passkey (WebAuthn) management page (ADD-ONLY, route: /passkeys). */
@Component({
  standalone: true,
  selector: 'app-passkeys',
  imports: [AuraDatePipe, CommonModule, FormsModule],
  template: `
    <div class="pk-wrap">
      <header class="pk-head">
        <div class="pk-ico">🔑</div>
        <div>
          <h1>Passkeys</h1>
          <p>Phishing-resistant sign-in with your device's biometrics or a hardware key.</p>
        </div>
      </header>

      <div class="pk-error" *ngIf="error()">{{ error() }}</div>
      <div class="pk-warn" *ngIf="!api.supported">This browser does not support WebAuthn/passkeys.</div>

      <section class="pk-card">
        <div class="pk-add">
          <input [(ngModel)]="label" placeholder="Passkey name (e.g. MacBook Touch ID)" />
          <button class="btn primary" (click)="register()" [disabled]="busy() || !api.supported">
            {{ busy() ? 'Waiting for device…' : '+ Add passkey' }}
          </button>
        </div>
      </section>

      <section class="pk-card">
        <h2>Your passkeys</h2>
        <p class="muted" *ngIf="!passkeys().length">No passkeys registered yet.</p>
        <div class="pk-row" *ngFor="let p of passkeys()">
          <div class="pk-row-ico">🔐</div>
          <div class="pk-info">
            <strong>{{ p.label }}</strong>
            <small>Added {{ p.createdAt | auraDate:'date' }}<span *ngIf="p.lastUsedAt"> · last used {{ p.lastUsedAt | auraDate:'date' }}</span></small>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .pk-wrap { padding: 20px; color: #e8ece9; display: grid; gap: 16px; }
    .pk-head { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 16px; padding: 18px 20px; border-radius: 16px;
      background: linear-gradient(160deg, rgba(36,164,126,0.16), rgba(36,164,126,0.04)), #0f1716; box-shadow: 0 8px 28px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.07); }
    .pk-ico { font-size: 32px; }
    .pk-head h1 { margin: 0; font-size: 20px; font-weight: 850; }
    .pk-head p { margin: 4px 0 0; color: #9fb0aa; font-size: 13px; }
    .pk-card { padding: 18px 20px; border-radius: 16px; background: linear-gradient(160deg,#141b19,#0e1413); box-shadow: 0 6px 22px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05); display: grid; gap: 12px; }
    .pk-card h2 { margin: 0; font-size: 15px; font-weight: 800; }
    .muted { margin: 0; color: #9fb0aa; font-size: 13px; }
    .pk-add { display: flex; gap: 10px; flex-wrap: wrap; }
    .pk-add input { flex: 1; min-width: 200px; padding: 11px 14px; border: 0; border-radius: 11px; background: #0a0f0e; color: #fff; box-shadow: inset 0 2px 6px rgba(0,0,0,0.55); outline: 0; }
    .btn { border: 0; border-radius: 11px; padding: 11px 18px; font-weight: 800; font-size: 13px; cursor: pointer; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn.primary { color: #03110d; background: linear-gradient(160deg,#24a47e,#178066); box-shadow: 0 4px 14px rgba(36,164,126,0.35), inset 0 1px 0 rgba(255,255,255,0.2); }
    .pk-row { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; background: #0d1211; box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); }
    .pk-row-ico { font-size: 18px; }
    .pk-info strong { display: block; font-size: 13px; }
    .pk-info small { color: #8d9792; font-size: 12px; }
    .pk-error { padding: 12px 16px; border-radius: 12px; background: rgba(230,103,79,0.14); color: #ffb4a3; box-shadow: inset 0 0 0 1px rgba(230,103,79,0.4); font-size: 13px; }
    .pk-warn { padding: 12px 16px; border-radius: 12px; background: rgba(214,163,54,0.14); color: #f0d28a; font-size: 13px; }
  `]
})
export class PasskeysComponent implements OnInit {
  readonly passkeys = signal<PasskeyInfo[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  label = '';

  constructor(readonly api: WebauthnApiService) {}

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.api.listCredentials().then((c) => this.passkeys.set(c)).catch(() => undefined);
  }

  async register(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.register(this.label || 'Passkey');
      this.label = '';
      this.load();
    } catch (e: any) {
      this.error.set(e?.message || 'Passkey registration failed or was cancelled');
    } finally {
      this.busy.set(false);
    }
  }
}
