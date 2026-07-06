import { Component, OnInit, signal } from "@angular/core";
import { DatePipe, CurrencyPipe } from "@angular/common";
import { Router } from "@angular/router";
import { IonButton, IonContent, IonSpinner } from "@ionic/angular/standalone";
import { StaffAppService, StaffDashboard } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [DatePipe, CurrencyPipe, IonButton, IonContent, IonSpinner],
  template: `
    <ion-content class="staff-shell">
      <main class="staff-wrap">
        <header class="hero">
          <div>
            <p class="eyebrow">Staff workspace</p>
            <h1>{{ data()?.staff?.fullName || staff.user()?.name || "My work" }}</h1>
            <p>{{ data()?.staff?.designation || staff.user()?.role }} · Only your connected SaaS data</p>
          </div>
          <ion-button fill="clear" (click)="logout()">Logout</ion-button>
        </header>

        @if (staff.loading() && !data()) {
          <section class="state"><ion-spinner name="crescent"></ion-spinner><span>Loading staff data...</span></section>
        } @else if (staff.error()) {
          <section class="notice">{{ staff.error() }}</section>
        }

        @if (data(); as dashboard) {
          <section class="metrics">
            <article><span>Today</span><strong>{{ dashboard.summary.todayAppointments }}</strong></article>
            <article><span>Live</span><strong>{{ dashboard.summary.liveAppointments }}</strong></article>
            <article><span>Completed</span><strong>{{ dashboard.summary.completedAppointments }}</strong></article>
            <article><span>Revenue</span><strong>{{ dashboard.summary.revenue | currency:'INR':'symbol':'1.0-0' }}</strong></article>
          </section>

          <section class="panel">
            <div class="panel-title"><h2>Today appointments</h2><span>{{ dashboard.todayAppointments.length }}</span></div>
            @for (item of dashboard.todayAppointments; track item.id) {
              <article class="appointment">
                <div>
                  <strong>{{ item.clientName }}</strong>
                  <p>{{ item.serviceNames.join(', ') || 'Service' }}</p>
                  <small>{{ item.startAt | date:'shortTime' }} · {{ item.durationMinutes || 0 }} min · {{ item.status }}</small>
                </div>
                <span>{{ item.value | currency:'INR':'symbol':'1.0-0' }}</span>
              </article>
            } @empty {
              <p class="empty">No appointments assigned to you today.</p>
            }
          </section>

          <section class="panel">
            <div class="panel-title"><h2>My work report</h2><span>{{ dashboard.workReport.length }}</span></div>
            @for (item of dashboard.workReport.slice(0, 8); track item.id) {
              <article class="appointment compact">
                <div>
                  <strong>{{ item.clientName }}</strong>
                  <p>{{ item.startAt | date:'mediumDate' }} · {{ item.serviceNames.join(', ') || 'Service' }}</p>
                </div>
                <span>{{ item.status }}</span>
              </article>
            } @empty {
              <p class="empty">No completed work found in this range.</p>
            }
          </section>

          <section class="panel profile">
            <div class="panel-title"><h2>My details</h2></div>
            <p><b>Mobile:</b> {{ dashboard.staff.mobile || '-' }}</p>
            <p><b>Email:</b> {{ dashboard.staff.email || '-' }}</p>
            <p><b>Department:</b> {{ dashboard.staff.department || '-' }}</p>
            <p><b>Status:</b> {{ dashboard.staff.status }}</p>
          </section>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .staff-shell { --background: #fff8ea; }
    .staff-wrap { width: min(980px, calc(100% - 24px)); margin: 0 auto; padding: 28px 0 80px; }
    .hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 26px; border-radius: 30px; color: #fff; background: linear-gradient(135deg, #271604, #8a5c12); box-shadow: 0 20px 54px rgba(63, 39, 7, .22); }
    .eyebrow { margin: 0 0 8px; color: #f7d98c; font-size: .75rem; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(2rem, 6vw, 3.8rem); line-height: .95; }
    .hero p { margin: 10px 0 0; color: #f8e7bd; font-weight: 800; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 18px 0; }
    .metrics article, .panel, .state, .notice { border: 1px solid #ead2a2; border-radius: 24px; background: rgba(255,255,255,.86); box-shadow: 0 16px 42px rgba(92, 65, 28, .11); }
    .metrics article { padding: 18px; }
    .metrics span { color: #8a611e; font-weight: 900; }
    .metrics strong { display: block; margin-top: 8px; color: #1d1307; font-size: 1.7rem; }
    .panel { margin-top: 14px; padding: 18px; }
    .panel-title { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .panel-title h2 { margin: 0; color: #1d1307; }
    .panel-title span { color: #8a611e; font-weight: 950; }
    .appointment { display: flex; justify-content: space-between; gap: 16px; padding: 14px 0; border-top: 1px solid #f0dfbf; }
    .appointment:first-of-type { border-top: 0; }
    .appointment strong { color: #1d1307; }
    .appointment p, .appointment small, .empty, .profile p { margin: 4px 0 0; color: #75552b; font-weight: 700; }
    .appointment > span { color: #6e4810; font-weight: 950; white-space: nowrap; }
    .compact > span { text-transform: capitalize; }
    .state, .notice { display: flex; gap: 10px; align-items: center; margin-top: 18px; padding: 18px; color: #6b4a18; font-weight: 900; }
    @media (max-width: 720px) { .hero { display: block; } .metrics { grid-template-columns: repeat(2, 1fr); } .appointment { align-items: flex-start; } }
  `]
})
export class StaffDashboardPage implements OnInit {
  readonly data = signal<StaffDashboard | null>(null);

  constructor(readonly staff: StaffAppService, private readonly router: Router) {}

  ngOnInit() {
    void this.staff.dashboard().then((dashboard) => this.data.set(dashboard)).catch(() => undefined);
  }

  logout() {
    this.staff.logout();
    void this.router.navigateByUrl("/staff/login");
  }
}
