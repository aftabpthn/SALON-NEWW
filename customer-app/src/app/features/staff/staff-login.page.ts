import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { IonButton, IonContent, IonInput, IonSpinner } from "@ionic/angular/standalone";
import { StaffAppService } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IonButton, IonContent, IonInput, IonSpinner],
  template: `
    <ion-content class="staff-login-shell">
      <main class="staff-card">
        <p class="eyebrow">Aura Staff App</p>
        <h1>Login to your work desk</h1>
        <p class="subcopy">Only your appointments, work report, sales and profile details are shown.</p>

        @if (staff.error()) {
          <div class="notice">{{ staff.error() }}</div>
        }

        <form (ngSubmit)="login()" class="staff-form">
          <label>Tenant ID</label>
          <ion-input [(ngModel)]="tenantId" name="tenantId" placeholder="tenant_aura"></ion-input>

          <label>Staff login ID</label>
          <ion-input [(ngModel)]="loginId" name="loginId" placeholder="email, mobile or login ID"></ion-input>

          <label>Password</label>
          <ion-input [(ngModel)]="password" name="password" type="password" placeholder="Password"></ion-input>

          <ion-button type="submit" expand="block" [disabled]="staff.loading()">
            @if (staff.loading()) { <ion-spinner name="crescent"></ion-spinner> } @else { Login }
          </ion-button>
        </form>

        <a routerLink="/" class="customer-link">Open customer app</a>
      </main>
    </ion-content>
  `,
  styles: [`
    .staff-login-shell { --background: linear-gradient(145deg, #fff8ea, #f2dfbc); }
    .staff-card { width: min(560px, calc(100% - 28px)); margin: 8vh auto; padding: 32px; border: 1px solid rgba(178, 127, 39, .25); border-radius: 30px; background: rgba(255,255,255,.82); box-shadow: 0 24px 80px rgba(92, 65, 28, .16); }
    .eyebrow { margin: 0 0 8px; color: #8b5d15; font-size: .75rem; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; }
    h1 { margin: 0; color: #1d1307; font-size: clamp(2rem, 6vw, 3.2rem); line-height: .95; }
    .subcopy { color: #74522b; font-weight: 700; line-height: 1.5; }
    .notice { margin: 18px 0; padding: 14px 16px; border: 1px solid #eac36f; border-radius: 16px; color: #6b4a18; background: #fff4d8; font-weight: 800; }
    .staff-form { display: grid; gap: 10px; margin-top: 20px; }
    label { color: #3a2713; font-size: .85rem; font-weight: 900; }
    ion-input { --background: #fff; --border-radius: 16px; --padding-start: 14px; border: 1px solid #ead5aa; border-radius: 16px; }
    ion-button { margin-top: 14px; --background: linear-gradient(135deg, #f4d58d, #d6a94a); --color: #1b1207; font-weight: 950; min-height: 52px; }
    .customer-link { display: block; margin-top: 18px; color: #815712; font-weight: 900; text-align: center; text-decoration: none; }
  `]
})
export class StaffLoginPage {
  tenantId = "tenant_aura";
  loginId = "";
  password = "";

  constructor(readonly staff: StaffAppService, private readonly router: Router) {}

  async login() {
    await this.staff.login({ tenantId: this.tenantId, loginId: this.loginId, password: this.password })
      .then(() => this.router.navigateByUrl("/staff/dashboard"))
      .catch(() => undefined);
  }
}
