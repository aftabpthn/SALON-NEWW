import "@angular/compiler";
import { HttpClient, HttpEventType, HttpHeaders, HttpResponse } from "@angular/common/http";
import { Subject, of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ionic/angular/standalone", () => ({ IonSpinner: class {} }));

import { StaffAppService, StaffClient360, StaffUser } from "./staff-app.service";
import { StaffClient360Page } from "../features/staff/staff-client360.page";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

const user: StaffUser = {
  id: "user-1", name: "Staff", loginId: "staff", email: "staff@example.test", role: "staff",
  staffId: "staff-1", branchId: "branch-1", branchIds: ["branch-1"]
};

describe("staff client media upload", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  });

  it("sends FormData with progress options and one supplied idempotency key", () => {
    const events = new Subject<unknown>();
    const request = vi.fn(() => events);
    const service = new StaffAppService({ request } as unknown as HttpClient);
    service.openSession({ accessToken: "access-token", user });
    const file = new File(["image"], "client.webp", { type: "image/webp" });
    const received: unknown[] = [];

    service.addClientMedia("client/1", file, { title: "After", type: "photo" }, "upload-key").subscribe((event) => received.push(event));

    expect(request).toHaveBeenCalledOnce();
    const [method, url, options] = request.mock.calls[0];
    expect(method).toBe("POST");
    expect(url).toContain("/staff-self/clients/client%2F1/media");
    expect(options.reportProgress).toBe(true);
    expect(options.observe).toBe("events");
    expect(options.withCredentials).toBe(true);
    expect((options.headers as HttpHeaders).get("Authorization")).toBe("Bearer access-token");
    expect((options.headers as HttpHeaders).get("Idempotency-Key")).toBe("upload-key");
    expect((options.headers as HttpHeaders).has("Content-Type")).toBe(false);
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.body as FormData).get("file")).toMatchObject({ name: "client.webp", type: "image/webp", size: file.size });
    expect((options.body as FormData).get("title")).toBe("After");
    expect((options.body as FormData).get("type")).toBe("photo");

    events.next({ type: HttpEventType.UploadProgress, loaded: 5, total: 10 });
    events.next(new HttpResponse({ body: { id: "media-1", title: "After", type: "photo", url: "/media/1", createdAt: "now" } }));
    expect(received).toEqual([
      { state: "progress", loaded: 5, total: 10, progress: 50 },
      { state: "completed", media: { id: "media-1", title: "After", type: "photo", url: "/media/1", createdAt: "now" } }
    ]);
  });

  it("cancels the active HTTP upload when unsubscribed", () => {
    const events = new Subject<unknown>();
    const service = new StaffAppService({ request: vi.fn(() => events) } as unknown as HttpClient);
    service.openSession({ accessToken: "access-token", user });

    const subscription = service.addClientMedia("client-1", new File(["x"], "x.png", { type: "image/png" }), { title: "X" }, "key").subscribe();
    expect(events.observed).toBe(true);

    subscription.unsubscribe();
    expect(events.observed).toBe(false);
  });

  it("revokes preview object URLs on replacement, route load, cancel, and destroy", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second").mockReturnValueOnce("blob:third");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const emptyClient = { profile: {}, membership: {}, wallet: {}, previousServices: [], productsBought: [], cancellationHistory: [], lifetimeSpend: 0, outstandingBalance: 0, visitFrequency: 0, lastVisit: "", retentionScore: 0, aiRecommendations: [], mediaPortfolio: [] } as unknown as StaffClient360;
    const staff = { client360: vi.fn(async () => emptyClient), dashboard: vi.fn(), error: () => "", clientMediaBlob: vi.fn(() => of(new Blob())) } as unknown as StaffAppService;
    const route = { snapshot: { paramMap: { get: () => "client-1" } }, paramMap: new Subject() };
    const page = new StaffClient360Page(staff, route as never);
    const eventFor = (file: File) => ({ target: { files: [file], value: "selected" } } as unknown as Event);

    page.onMediaFile(eventFor(new File(["one"], "one.jpg", { type: "image/jpeg" })));
    page.onMediaFile(eventFor(new File(["two"], "two.png", { type: "image/png" })));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");

    await page.load("client-2");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second");

    page.onMediaFile(eventFor(new File(["three"], "three.webp", { type: "image/webp" })));
    page.cancelMedia();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:third");
    page.ngOnDestroy();
    expect(createObjectURL).toHaveBeenCalledTimes(3);
  });
});
