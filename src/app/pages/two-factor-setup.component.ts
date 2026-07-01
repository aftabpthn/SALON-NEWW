import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthSessionService, TwoFactorStatus } from '../core/auth-session.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-two-factor-setup',
  standalone: true,
  imports: [CommonModule, FormsModule, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Two-Factor Authentication</h2>
        </div>
        <button class="ghost-button" type="button" (click)="load()">Refresh</button>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="panel">
        <div class="section-title">
          <h2>Status</h2>
          <span class="badge">{{ status()?.enabled ? 'Enabled' : 'Not enabled' }}</span>
        </div>
        <div class="quick-grid">
          <article class="action-card">
            <strong>{{ status()?.enabled ? '2FA active' : '2FA inactive' }}</strong>
            <span>{{ status()?.verifiedAt || 'No verified authenticator yet' }}</span>
          </article>
          <article class="action-card">
            <strong>{{ status()?.pendingSetup ? 'Setup pending' : 'No pending setup' }}</strong>
            <span>Pending secrets become active only after code verification.</span>
          </article>
        </div>
      </section>

      <section class="panel" *ngIf="!status()?.enabled">
        <div class="section-title">
          <h2>Enable 2FA</h2>
          <button class="primary-button" type="button" (click)="startSetup()">Generate setup key</button>
        </div>
        <div class="form-panel" *ngIf="provisioningUri()">
          <label class="field full">
            <span>Authenticator setup URI</span>
            <textarea rows="4" [ngModel]="provisioningUri()" readonly></textarea>
          </label>
          <label class="field">
            <span>6-digit code</span>
            <input [(ngModel)]="enableToken" autocomplete="one-time-code" inputmode="numeric" />
          </label>
          <div class="form-actions">
            <button class="ghost-button" type="button" (click)="copy(provisioningUri())">Copy URI</button>
            <button class="primary-button" type="button" (click)="enable()">Enable</button>
          </div>
        </div>
      </section>

      <section class="panel" *ngIf="recoveryCodes().length">
        <div class="section-title"><h2>Recovery codes</h2></div>
        <div class="quick-grid">
          <article class="action-card" *ngFor="let code of recoveryCodes()"><strong>{{ code }}</strong><span>Use once if authenticator is unavailable</span></article>
        </div>
        <label class="inline-check"><input type="checkbox" [(ngModel)]="savedCodes" /> I saved these codes securely</label>
        <div class="form-actions"><button class="primary-button" type="button" [disabled]="!savedCodes" (click)="recoveryCodes.set([])">Done</button></div>
      </section>

      <section class="panel" *ngIf="status()?.enabled">
        <div class="section-title"><h2>Disable 2FA</h2></div>
        <label class="field">
          <span>Authenticator or recovery code</span>
          <input [(ngModel)]="disableToken" autocomplete="one-time-code" />
        </label>
        <div class="form-actions"><button class="danger-button" type="button" (click)="disable()">Disable 2FA</button></div>
      </section>
    </section>
  `
})
export class TwoFactorSetupComponent implements OnInit {
  readonly status = signal<TwoFactorStatus | null>(null);
  readonly provisioningUri = signal('');
  readonly recoveryCodes = signal<string[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  enableToken = '';
  disableToken = '';
  savedCodes = false;

  constructor(private readonly auth: AuthSessionService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.auth.twoFactorStatus().subscribe({
      next: (status) => { this.status.set(status); this.loading.set(false); },
      error: (error) => { this.error.set(this.errorText(error)); this.loading.set(false); }
    });
  }

  startSetup(): void {
    this.auth.twoFactorSetup().subscribe({
      next: (setup) => this.provisioningUri.set(setup.provisioningUri),
      error: (error) => this.error.set(this.errorText(error))
    });
  }

  enable(): void {
    this.auth.twoFactorEnable(this.enableToken).subscribe({
      next: (result) => {
        this.recoveryCodes.set(result.recoveryCodes || []);
        this.provisioningUri.set('');
        this.enableToken = '';
        this.savedCodes = false;
        this.load();
      },
      error: (error) => this.error.set(this.errorText(error))
    });
  }

  disable(): void {
    this.auth.twoFactorDisable(this.disableToken).subscribe({
      next: () => { this.disableToken = ''; this.load(); },
      error: (error) => this.error.set(this.errorText(error))
    });
  }

  copy(value: string): void {
    navigator.clipboard?.writeText(value);
  }

  private errorText(error: unknown): string {
    const err = error as { error?: { error?: { message?: string } }; message?: string };
    return err?.error?.error?.message || err?.message || 'Request failed';
  }
}
