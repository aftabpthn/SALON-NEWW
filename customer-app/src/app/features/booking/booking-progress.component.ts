import { Component, EventEmitter, Input, Output } from "@angular/core";
import { IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { checkmarkOutline } from "ionicons/icons";

export type BookingProgressStepId = 1 | 2 | 3 | 4;
type BookingProgressStatus = "completed" | "current" | "inactive";

type BookingProgressStep = {
  id: BookingProgressStepId;
  label: string;
};

const BOOKING_PROGRESS_STEPS: BookingProgressStep[] = [
  { id: 1, label: "Services" },
  { id: 2, label: "Staff" },
  { id: 3, label: "Time" },
  { id: 4, label: "Review" }
];

@Component({
  selector: "app-booking-progress",
  standalone: true,
  imports: [IonIcon],
  template: `
    <nav class="booking-progress" aria-label="Booking progress">
      @for (item of progressSteps; track item.id) {
        <button
          type="button"
          class="booking-progress-step"
          [class.completed]="statusFor(item.id) === 'completed'"
          [class.current]="statusFor(item.id) === 'current'"
          [class.inactive]="statusFor(item.id) === 'inactive'"
          [disabled]="!canSelect(item.id)"
          [attr.aria-current]="statusFor(item.id) === 'current' ? 'step' : null"
          (click)="selectStep(item.id)">
          <span class="progress-marker" aria-hidden="true">
            @if (statusFor(item.id) === 'completed') {
              <ion-icon name="checkmark-outline"></ion-icon>
            } @else {
              <span>{{ item.id }}</span>
            }
          </span>
          <span class="progress-label">{{ item.label }}</span>
        </button>
      }
    </nav>
  `,
  styles: [`
    :host { display: block; position: sticky; top: 0; z-index: 20; }
    .booking-progress { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; padding: 10px 0 8px; background: var(--app-bg); }
    .booking-progress-step { min-width: 0; min-height: 56px; display: grid; justify-items: center; align-content: center; gap: 6px; padding: 8px 6px; border: 1px solid var(--border); border-radius: 16px; color: var(--muted); background: var(--surface); font: inherit; font-weight: 900; text-align: center; }
    .booking-progress-step.completed { color: var(--primary); border-color: rgba(99, 102, 241, 0.34); background: var(--primary-soft); }
    .booking-progress-step.completed .progress-marker { background: var(--primary); }
    .booking-progress-step.completed .progress-marker ion-icon { color: #FFFFFF; }
    .booking-progress-step.current { color: #FFFFFF; border-color: transparent; background: var(--primary); box-shadow: 0 12px 24px rgba(99, 102, 241, 0.18); }
    .booking-progress-step.current .progress-marker { background: rgba(255, 255, 255, 0.22); }
    .booking-progress-step.inactive { cursor: default; opacity: 1; background: var(--surface); }
    .booking-progress-step.inactive .progress-marker { color: var(--muted); background: rgba(102, 112, 133, 0.14); border: 1px solid rgba(102, 112, 133, 0.3); }
    .booking-progress-step:disabled { pointer-events: none; }
    .progress-marker { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 999px; background: rgba(102, 112, 133, 0.12); font-size: 0.8rem; font-weight: 950; line-height: 1; }
    .progress-marker ion-icon { font-size: 1.05rem; }
    .progress-label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85rem; }
    @media (max-width: 430px) {
      .booking-progress { gap: 6px; padding: 8px 0 6px; }
      .booking-progress-step { min-height: 54px; padding: 7px 3px; border-radius: 14px; }
      .progress-marker { width: 22px; height: 22px; font-size: 0.74rem; }
      .progress-marker ion-icon { font-size: 0.95rem; }
      .progress-label { font-size: 0.78rem; }
    }
    @media (max-width: 340px) {
      .booking-progress { gap: 4px; }
      .progress-label { font-size: 0.72rem; }
    }
  `]
})
export class BookingProgressComponent {
  @Input({ required: true }) currentStep: BookingProgressStepId = 1;
  @Output() readonly stepSelect = new EventEmitter<BookingProgressStepId>();

  readonly progressSteps = BOOKING_PROGRESS_STEPS;

  constructor() {
    addIcons({ checkmarkOutline });
  }

  statusFor(stepId: BookingProgressStepId): BookingProgressStatus {
    if (stepId < this.currentStep) return "completed";
    if (stepId === this.currentStep) return "current";
    return "inactive";
  }

  canSelect(stepId: BookingProgressStepId): boolean {
    return stepId <= this.currentStep;
  }

  selectStep(stepId: BookingProgressStepId): void {
    if (this.canSelect(stepId)) this.stepSelect.emit(stepId);
  }
}
