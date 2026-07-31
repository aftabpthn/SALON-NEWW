import { DatePipe } from "@angular/common";
import { Component, OnDestroy, OnInit, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { IonButton, IonContent, IonHeader, IonSpinner, IonToolbar } from "@ionic/angular/standalone";
import { Subscription, switchMap, timer } from "rxjs";
import { FieldJobTracking } from "../../core/api.types";
import { CustomerApiService } from "../../core/customer-api.service";

@Component({
  standalone: true,
  imports: [DatePipe, RouterLink, IonButton, IonContent, IonHeader, IonSpinner, IonToolbar],
  templateUrl: "./field-job-tracking.page.html",
  styleUrls: ["./field-job-tracking.page.css"]
})
export class FieldJobTrackingPage implements OnInit, OnDestroy {
  readonly tracking = signal<FieldJobTracking | null>(null);
  readonly error = signal("");
  private subscription?: Subscription;

  constructor(private readonly route: ActivatedRoute, private readonly api: CustomerApiService) {}

  ngOnInit() {
    const token = this.route.snapshot.paramMap.get("token") || "";
    this.subscription = timer(0, 15_000).pipe(switchMap(() => this.api.getFieldJobTracking(token))).subscribe({
      next: (value) => { this.tracking.set(value); this.error.set(""); },
      error: () => this.error.set("Tracking link is invalid, expired, or temporarily unavailable.")
    });
  }

  ngOnDestroy() { this.subscription?.unsubscribe(); }
  etaMinutes(value?: number): number | null { return value == null ? null : Math.max(1, Math.ceil(value / 60)); }
  progress(status: string): number { return ({ created: 10, assigned: 25, accepted: 40, en_route: 65, arrived: 85, completed: 100, cancelled: 0 } as Record<string, number>)[status] ?? 0; }
}
