import { Component } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { StaffAppService } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="page">
      <article class="panel permission-panel">
        <p class="eyebrow">Permission denied</p>
        <h1>This workspace is restricted</h1>
        <p>{{ explanation() }}</p>
        <div class="list">
          <div class="row"><strong>Signed in as</strong><span>{{ staff.user()?.name || 'Staff' }}</span></div>
          <div class="row"><strong>Role</strong><span>{{ staff.user()?.role || '-' }}</span></div>
          <div class="row"><strong>Required</strong><span>{{ permissionLabel() }}</span></div>
          <div class="row"><strong>Decision</strong><span>{{ explicitlyDenied() ? 'Explicit deny overrides this role' : 'Permission is not granted to this role' }}</span></div>
        </div>
        <div class="row-actions permission-actions">
          <a class="button primary" routerLink="/staff/dashboard">Back to dashboard</a>
          <a class="button" routerLink="/staff/profile">Open profile</a>
        </div>
      </article>
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffPermissionDeniedPage {
  readonly required = this.route.snapshot.queryParamMap.get("required") || "";
  constructor(readonly staff: StaffAppService, private readonly route: ActivatedRoute) {}

  explicitlyDenied(): boolean {
    const denied = this.staff.user()?.deniedPermissions || [];
    return this.required.split(",").some((permission) => denied.includes(permission));
  }

  permissionLabel(): string {
    return this.required.split(",").filter(Boolean).map((permission) => permission
      .replace(/^staff\.app\./, "")
      .replaceAll(".", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
    ).join(", ") || "Additional access";
  }

  explanation(): string {
    return this.explicitlyDenied()
      ? "This permission is explicitly denied for your account, so broader role access cannot override it."
      : "Your current staff role has not been granted the access needed for this workspace.";
  }
}
