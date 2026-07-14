import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MfaApiService, MfaEnrolment, MfaSession, MfaStatus } from '../core/mfa-api.service';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

/**
 * MFA + session management page (ADD-ONLY feature, route: /mfa-security).
 * Self-contained; does not modify the existing login screen.
 */
@Component({
  standalone: true,
  selector: 'app-security-mfa',
  imports: [AuraDatePipe, CommonModule, FormsModule],
  template: `
    <div class="mfa-wrap">
      <header class="mfa-head">
        <div class="mfa-shield">🔐</div>
        <div>
          <h1>Two-Factor Authentication</h1>
          <p>Add a one-time passcode (TOTP) on top of your password for enterprise-grade login security.</p>
        </div>
        <span class="mfa-pill" [class.on]="status()?.enabled" [class.off]="!status()?.enabled">
          {{ status()?.enabled ? '● Active' : '○ Not enabled' }}
        </span>
      </header>

      <div class="mfa-error" *ngIf="error()">{{ error() }}</div>

      <!-- DISABLED: enrolment flow -->
      <section class="mfa-card" *ngIf="!loading() && !status()?.enabled">
        <ng-container *ngIf="!enrolment()">
          <h2>Step 1 · Start setup</h2>
          <p class="muted">We'll generate a secret for your authenticator app (Google Authenticator, Authy, Microsoft Authenticator).</p>
          <button class="btn primary" (click)="startSetup()" [disabled]="busy()">{{ busy() ? 'Generating…' : 'Enable 2FA' }}</button>
        </ng-container>

        <ng-container *ngIf="enrolment() as enr">
          <h2>Step 2 · Add to your authenticator</h2>
          <p class="muted">Open your authenticator app and add this key manually (we never send your secret to any third party).</p>
          <div class="secret-box">
            <code>{{ formatSecret(enr.secret) }}</code>
            <button class="btn ghost" (click)="copy(enr.secret)">{{ copied() ? 'Copied ✓' : 'Copy' }}</button>
          </div>
          <div class="meta-row">
            <span>Algorithm: {{ enr.algorithm }}</span><span>Digits: {{ enr.digits }}</span><span>Period: {{ enr.period }}s</span>
          </div>

          <h2 class="mt">Step 3 · Confirm code</h2>
          <p class="muted">Enter the current 6-digit code from your app to finish.</p>
          <div class="code-row">
            <input class="code-input" type="text" inputmode="numeric" maxlength="6" placeholder="000000"
                   [(ngModel)]="enableCode" (keyup.enter)="confirmEnable()" />
            <button class="btn primary" (click)="confirmEnable()" [disabled]="busy() || enableCode.length !== 6">Verify & activate</button>
          </div>
        </ng-container>
      </section>

      <!-- Recovery codes shown once after enabling -->
      <section class="mfa-card recovery" *ngIf="recoveryCodes().length">
        <h2>✅ 2FA enabled — save your recovery codes</h2>
        <p class="muted">Each code works once if you lose your device. Store them somewhere safe — they won't be shown again.</p>
        <div class="recovery-grid">
          <code *ngFor="let c of recoveryCodes()">{{ c }}</code>
        </div>
        <button class="btn ghost" (click)="copy(recoveryCodes().join('\n'))">{{ copied() ? 'Copied ✓' : 'Copy all' }}</button>
      </section>

      <!-- ENABLED: manage / disable -->
      <section class="mfa-card" *ngIf="!loading() && status()?.enabled && !recoveryCodes().length">
        <h2>2FA is protecting this account</h2>
        <p class="muted">Recovery codes remaining: <strong>{{ status()?.recoveryCodesRemaining ?? 0 }}</strong></p>
        <p class="muted">To turn off 2FA, confirm with a current code from your authenticator (or a recovery code).</p>
        <div class="code-row">
          <input class="code-input wide" type="text" maxlength="12" placeholder="123456 / recovery code" [(ngModel)]="disableCode" />
          <button class="btn danger" (click)="confirmDisable()" [disabled]="busy() || !disableCode">Disable 2FA</button>
        </div>
      </section>

      <!-- Sessions -->
      <section class="mfa-card">
        <div class="sess-head">
          <h2>Active sessions</h2>
          <button class="btn ghost" (click)="revokeOthers()" [disabled]="busy() || sessions().length < 2">Sign out other sessions</button>
        </div>
        <p class="muted" *ngIf="!sessions().length">No active sessions recorded.</p>
        <div class="sess-list">
          <div class="sess-row" *ngFor="let s of sessions()" [class.current]="s.current">
            <div class="sess-icon">🖥️</div>
            <div class="sess-info">
              <strong>{{ s.userAgent || 'Unknown device' }} <span class="now" *ngIf="s.current">· this device</span></strong>
              <small>{{ s.ipAddress || '—' }} · started {{ s.startedAt | auraDate:'date' }} · {{ s.status }}</small>
            </div>
            <button class="btn ghost sm" *ngIf="!s.current" (click)="revoke(s.id)" [disabled]="busy()">Revoke</button>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .mfa-wrap { padding: 20px; color: #e8ece9; display: grid; gap: 16px; }
    .mfa-head { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 16px; padding: 18px 20px; border-radius: 16px;
      background: linear-gradient(160deg, rgba(36,164,126,0.16), rgba(36,164,126,0.04)), #0f1716;
      box-shadow: 0 8px 28px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.07); }
    .mfa-shield { font-size: 34px; }
    .mfa-head h1 { margin: 0; font-size: 20px; font-weight: 850; }
    .mfa-head p { margin: 4px 0 0; color: #9fb0aa; font-size: 13px; }
    .mfa-pill { padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 800; white-space: nowrap; }
    .mfa-pill.on { color: #03110d; background: linear-gradient(160deg,#24a47e,#178066); box-shadow: 0 0 14px rgba(36,164,126,0.4); }
    .mfa-pill.off { color: #d6a336; background: rgba(214,163,54,0.14); box-shadow: inset 0 0 0 1px rgba(214,163,54,0.4); }
    .mfa-card { padding: 20px; border-radius: 16px; background: linear-gradient(160deg,#141b19,#0e1413);
      box-shadow: 0 6px 22px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05); display: grid; gap: 12px; }
    .mfa-card h2 { margin: 0; font-size: 15px; font-weight: 800; }
    .mfa-card h2.mt { margin-top: 8px; }
    .muted { margin: 0; color: #9fb0aa; font-size: 13px; line-height: 1.5; }
    .mfa-error { padding: 12px 16px; border-radius: 12px; background: rgba(230,103,79,0.14); color: #ffb4a3;
      box-shadow: inset 0 0 0 1px rgba(230,103,79,0.4); font-size: 13px; }
    .secret-box { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 12px; background: #0a0f0e;
      box-shadow: inset 0 2px 6px rgba(0,0,0,0.55); }
    .secret-box code { font-size: 18px; letter-spacing: 3px; font-weight: 800; color: #6ff0c4; flex: 1; word-break: break-all; }
    .meta-row { display: flex; gap: 18px; color: #8d9792; font-size: 12px; }
    .code-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .code-input { width: 160px; padding: 12px 14px; border: 0; border-radius: 12px; background: #0a0f0e; color: #fff;
      font-size: 22px; letter-spacing: 6px; text-align: center; box-shadow: inset 0 2px 6px rgba(0,0,0,0.55); outline: 0; }
    .code-input.wide { width: 220px; font-size: 16px; letter-spacing: 2px; }
    .btn { border: 0; border-radius: 11px; padding: 11px 18px; font-weight: 800; font-size: 13px; cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn.primary { color: #03110d; background: linear-gradient(160deg,#24a47e,#178066);
      box-shadow: 0 4px 14px rgba(36,164,126,0.35), inset 0 1px 0 rgba(255,255,255,0.2); }
    .btn.primary:not(:disabled):hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(36,164,126,0.5); }
    .btn.danger { color: #fff; background: linear-gradient(160deg,#e6674f,#b5402c); box-shadow: 0 4px 14px rgba(230,103,79,0.35); }
    .btn.ghost { color: #cfe9df; background: rgba(36,164,126,0.12); box-shadow: inset 0 0 0 1px rgba(36,164,126,0.3); }
    .btn.sm { padding: 7px 12px; font-size: 12px; }
    .recovery { background: linear-gradient(160deg, rgba(36,164,126,0.14), #0e1413); }
    .recovery-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .recovery-grid code { padding: 10px 12px; border-radius: 9px; background: #0a0f0e; color: #6ff0c4; font-size: 15px;
      letter-spacing: 2px; font-weight: 700; text-align: center; box-shadow: inset 0 1px 4px rgba(0,0,0,0.5); }
    .sess-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .sess-list { display: grid; gap: 8px; }
    .sess-row { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; padding: 12px 14px;
      border-radius: 12px; background: #0d1211; box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); }
    .sess-row.current { background: linear-gradient(160deg, rgba(36,164,126,0.16), #0d1211); box-shadow: inset 3px 0 0 #24a47e; }
    .sess-icon { font-size: 20px; }
    .sess-info strong { display: block; font-size: 13px; font-weight: 750; }
    .sess-info .now { color: #6ff0c4; font-weight: 800; }
    .sess-info small { color: #8d9792; font-size: 12px; }
    @media (max-width: 560px) { .recovery-grid { grid-template-columns: 1fr; } .mfa-head { grid-template-columns: auto 1fr; } .mfa-pill { grid-column: 2; justify-self: start; } }
  `]
})
export class SecurityMfaComponent implements OnInit {
  readonly status = signal<MfaStatus | null>(null);
  readonly enrolment = signal<MfaEnrolment | null>(null);
  readonly recoveryCodes = signal<string[]>([]);
  readonly sessions = signal<MfaSession[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly copied = signal(false);
  enableCode = '';
  disableCode = '';

  constructor(private readonly mfa: MfaApiService) {}

  ngOnInit(): void {
    this.refresh();
    this.loadSessions();
  }

  private refresh(): void {
    this.loading.set(true);
    this.mfa.status().subscribe({
      next: (s) => { this.status.set(s); this.loading.set(false); },
      error: (e) => { this.error.set(this.msg(e)); this.loading.set(false); }
    });
  }

  private loadSessions(): void {
    this.mfa.sessions().subscribe({ next: (s) => this.sessions.set(s), error: () => undefined });
  }

  startSetup(): void {
    this.busy.set(true); this.error.set('');
    this.mfa.setup().subscribe({
      next: (e) => { this.enrolment.set(e); this.busy.set(false); },
      error: (e) => { this.error.set(this.msg(e)); this.busy.set(false); }
    });
  }

  confirmEnable(): void {
    if (this.enableCode.length !== 6) return;
    this.busy.set(true); this.error.set('');
    this.mfa.enable(this.enableCode).subscribe({
      next: (r) => {
        this.recoveryCodes.set(r.recoveryCodes || []);
        this.enrolment.set(null);
        this.enableCode = '';
        this.busy.set(false);
        this.refresh();
      },
      error: (e) => { this.error.set(this.msg(e)); this.busy.set(false); }
    });
  }

  confirmDisable(): void {
    if (!this.disableCode) return;
    this.busy.set(true); this.error.set('');
    this.mfa.disable(this.disableCode).subscribe({
      next: () => { this.disableCode = ''; this.recoveryCodes.set([]); this.busy.set(false); this.refresh(); },
      error: (e) => { this.error.set(this.msg(e)); this.busy.set(false); }
    });
  }

  revoke(id: string): void {
    this.busy.set(true);
    this.mfa.revokeSession(id).subscribe({
      next: () => { this.busy.set(false); this.loadSessions(); },
      error: (e) => { this.error.set(this.msg(e)); this.busy.set(false); }
    });
  }

  revokeOthers(): void {
    this.busy.set(true);
    this.mfa.revokeOthers().subscribe({
      next: () => { this.busy.set(false); this.loadSessions(); },
      error: (e) => { this.error.set(this.msg(e)); this.busy.set(false); }
    });
  }

  copy(text: string): void {
    navigator.clipboard?.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1800);
    }).catch(() => undefined);
  }

  formatSecret(secret: string): string {
    return (secret.match(/.{1,4}/g) || [secret]).join(' ');
  }

  private msg(e: any): string {
    return e?.error?.error?.message || e?.error?.message || e?.message || 'Something went wrong';
  }
}
