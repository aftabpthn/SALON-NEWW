import { HttpClient, HttpHeaders } from "@angular/common/http";
import { Injectable, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { environment } from "../../environments/environment";

const STAFF_ACCESS_TOKEN_KEY = "auraStaffAccessToken";
const STAFF_REFRESH_TOKEN_KEY = "auraStaffRefreshToken";
const STAFF_SESSION_KEY = "auraStaffSession";

export type StaffUser = {
  id: string;
  name: string;
  loginId: string;
  email: string;
  role: string;
  staffId: string;
  branchId: string;
  branchIds: string[];
};

export type StaffAppointment = {
  id: string;
  clientName: string;
  clientPhone: string;
  staffId: string;
  branchId: string;
  serviceNames: string[];
  durationMinutes: number;
  value: number;
  startAt: string;
  endAt: string;
  status: string;
  chair: string;
  source: string;
  notes: string;
};

export type StaffDashboard = {
  staff: {
    id: string;
    fullName: string;
    firstName: string;
    lastName: string;
    mobile: string;
    email: string;
    roleId: string;
    department: string;
    designation: string;
    status: string;
  };
  summary: {
    appointments: number;
    todayAppointments: number;
    liveAppointments: number;
    completedAppointments: number;
    cancelledAppointments: number;
    salesCount: number;
    revenue: number;
    appointmentValue: number;
  };
  todayAppointments: StaffAppointment[];
  liveAppointments: StaffAppointment[];
  workReport: StaffAppointment[];
  appointments: StaffAppointment[];
  sales: Array<{ id: string; total: number; commissionTotal: number; status: string; createdAt: string }>;
};

type StaffLoginResponse = {
  accessToken: string;
  refreshToken: string;
  user: StaffUser;
};

@Injectable({ providedIn: "root" })
export class StaffAppService {
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/$/, "");
  readonly loading = signal(false);
  readonly error = signal("");
  readonly user = signal<StaffUser | null>(this.readSession());

  constructor(private readonly http: HttpClient) {}

  isAuthenticated(): boolean {
    return !!this.accessToken() && !!this.user()?.staffId;
  }

  async login(payload: { tenantId: string; loginId: string; password: string; branchId?: string }): Promise<StaffUser> {
    this.loading.set(true);
    this.error.set("");
    try {
      const session = await firstValueFrom(this.http.post<StaffLoginResponse>(`${this.baseUrl}/auth/login`, {
        tenantId: payload.tenantId.trim() || "tenant_aura",
        loginId: payload.loginId.trim(),
        password: payload.password,
        branchId: payload.branchId?.trim() || undefined,
        device: { type: "staff-app", name: "Aura Staff App" }
      }));
      if (!session.user?.staffId) throw new Error("This login is not linked with a staff profile.");
      if (!this.isStaffRole(session.user.role)) throw new Error("Use a staff login, not an owner/admin login.");
      this.saveSession(session);
      return session.user;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to login staff.";
      this.error.set(message);
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async dashboard(): Promise<StaffDashboard> {
    const token = this.accessToken();
    if (!token) throw new Error("Staff login required.");
    this.loading.set(true);
    this.error.set("");
    try {
      return await firstValueFrom(this.http.get<StaffDashboard>(`${this.baseUrl}/staff-self/dashboard`, {
        headers: new HttpHeaders({ Authorization: `Bearer ${token}` })
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load staff dashboard.";
      this.error.set(message);
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  logout() {
    localStorage.removeItem(STAFF_ACCESS_TOKEN_KEY);
    localStorage.removeItem(STAFF_REFRESH_TOKEN_KEY);
    localStorage.removeItem(STAFF_SESSION_KEY);
    this.user.set(null);
  }

  private accessToken(): string {
    return localStorage.getItem(STAFF_ACCESS_TOKEN_KEY) || "";
  }

  private saveSession(session: StaffLoginResponse) {
    localStorage.setItem(STAFF_ACCESS_TOKEN_KEY, session.accessToken);
    localStorage.setItem(STAFF_REFRESH_TOKEN_KEY, session.refreshToken || "");
    localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session.user));
    this.user.set(session.user);
  }

  private readSession(): StaffUser | null {
    try {
      const raw = localStorage.getItem(STAFF_SESSION_KEY);
      return raw ? JSON.parse(raw) as StaffUser : null;
    } catch {
      return null;
    }
  }

  private isStaffRole(role: string): boolean {
    return ["staff", "frontDesk", "cashier", "manager"].includes(String(role || ""));
  }
}
