import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffDashboard } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";
import { StaffPermissionBadgesComponent } from "./staff-permission-badges.component";

@Component({
  standalone: true,
  imports: [StaffPageStateComponent, StaffPermissionBadgesComponent],
  template: `
    <section class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Profile</p>
          <h1>{{ staff.user()?.name || dashboard()?.staff?.fullName || 'My profile' }}</h1>
          <p>{{ dashboard()?.staff?.designation || staff.user()?.role || 'Staff' }} · {{ staff.user()?.branchId || 'branch scoped' }}</p>
        </div>
      </header>

      @if (!canReadProfile()) { <section staffPageState class="notice">You do not have permission to view your profile.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading profile...</section> }
      @if (loadError()) { <section staffPageState class="notice"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" (click)="load()">Retry</button></section> }

      @if (dashboard(); as data) {
        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Identity</h2><span>{{ data.staff.status }}</span></div>
            <div class="list">
              <div class="row"><strong>Staff ID</strong><span>{{ staff.user()?.staffId || data.staff.id }}</span></div>
              <div class="row"><strong>Login ID</strong><span>{{ staff.user()?.loginId || '-' }}</span></div>
              <div class="row"><strong>Role</strong><span>{{ staff.user()?.role || data.staff.roleId }}</span></div>
              <div class="row"><strong>Designation</strong><span>{{ data.staff.designation || '-' }}</span></div>
              <div class="row"><strong>Department</strong><span>{{ data.staff.department || '-' }}</span></div>
            </div>
          </article>

          <article class="panel">
            <div class="panel-title"><h2>Contact</h2><span>{{ contactCount(data) }}/2 configured</span></div>
            <div class="list">
              <div class="row"><strong>Mobile</strong><span>{{ data.staff.mobile || '-' }}</span></div>
              <div class="row"><strong>Email</strong><span>{{ data.staff.email || '-' }}</span></div>
              <div class="row"><strong>Branch</strong><span>{{ staff.user()?.branchId || '-' }}</span></div>
              <div class="row"><strong>Status</strong><span>{{ data.staff.status || '-' }}</span></div>
            </div>
          </article>
        </section>

        <section class="panel">
          <div class="panel-title"><h2>Connected permissions</h2><span>{{ visiblePermissions().length }}</span></div>
          <div staffPermissionBadges class="row-actions" [permissions]="visiblePermissions()"></div>
        </section>

        @if (sourceGaps(data).length) {
          <section class="panel">
            <div class="panel-title"><h2>CRM information pending</h2><span>{{ sourceGaps(data).length }}</span></div>
            <div class="list">@for (gap of sourceGaps(data); track gap) { <div class="row"><strong>{{ gap }}</strong><span>Add in CRM Staff</span></div> }</div>
          </section>
        }
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffProfilePage implements OnInit {
  readonly dashboard = signal<StaffDashboard | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal("");

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadProfile()) void this.load(); }

  async load() {
    if (!this.canReadProfile()) return;
    this.loading.set(true);
    this.loadError.set("");
    try {
      this.dashboard.set(await this.staff.dashboard());
    } catch {
      this.loadError.set(this.staff.error() || "Unable to load profile.");
    } finally {
      this.loading.set(false);
    }
  }

  canReadProfile(): boolean { return this.staff.hasPermission("staff.app.profile.read"); }

  contactCount(data: StaffDashboard): number { return Number(!!data.staff.mobile) + Number(!!data.staff.email); }

  sourceGaps(data: StaffDashboard): string[] {
    const gaps: string[] = [];
    if (!data.staff.designation || !data.staff.department) gaps.push("Designation or department");
    if (!data.staff.mobile || !data.staff.email) gaps.push("Mobile or email");
    if (!this.staff.user()?.loginId) gaps.push("Staff App login ID");
    return gaps;
  }

  visiblePermissions(): string[] {
    return (this.staff.user()?.permissions || []).slice(0, 36);
  }
}
