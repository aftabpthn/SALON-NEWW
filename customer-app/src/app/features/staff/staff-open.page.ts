import { HttpClient } from "@angular/common/http";
import { Component, OnInit } from "@angular/core";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { environment } from "../../../environments/environment";
import { StaffAppService, StaffUser } from "../../core/staff-app.service";

type DemoStaffSession = {
  success?: boolean;
  data?: { accessToken: string; refreshToken?: string; user: StaffUser };
  accessToken?: string;
  refreshToken?: string;
  user?: StaffUser;
};

@Component({
  standalone: true,
  template: `<p style="font: 16px system-ui; padding: 16px;">Opening staff app...</p>`
})
export class StaffOpenPage implements OnInit {
  constructor(private readonly http: HttpClient, private readonly staff: StaffAppService, private readonly router: Router) {}

  async ngOnInit() {
    if (environment.production) {
      await this.router.navigateByUrl("/staff/login");
      return;
    }
    try {
      const baseUrl = environment.apiBaseUrl.replace(/\/$/, "");
      const response = await firstValueFrom(this.http.get<DemoStaffSession>(`${baseUrl}/auth/demo-staff-session`));
      const session = response.data || response;
      if (!session.accessToken || !session.user) throw new Error("Demo staff session was not issued.");
      this.staff.openSession({ accessToken: session.accessToken, refreshToken: session.refreshToken || "", user: session.user });
      await this.router.navigateByUrl("/staff/dashboard");
    } catch {
      await this.router.navigateByUrl("/staff/login");
    }
  }
}
