import { Component, EventEmitter, Input, Output } from "@angular/core";
import { IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { chevronBackOutline, exitOutline } from "ionicons/icons";

@Component({
  selector: "app-my-salon-header",
  standalone: true,
  imports: [IonIcon],
  template: `
    <header class="my-salon-header" role="navigation" aria-label="My Salon controls">
      <button type="button" class="header-back" aria-label="Back" (click)="back.emit()">
        <ion-icon name="chevron-back-outline" aria-hidden="true"></ion-icon>
      </button>

      <a class="header-brand" [href]="homeHref" (click)="home.emit($event)">
        <span class="header-logo" aria-hidden="true">
          @if (logoImage) {
            <img [src]="logoImage" [alt]="salonName" />
          } @else {
            <span>{{ initials }}</span>
          }
        </span>
        <span class="header-copy">
          <strong>{{ salonName }}</strong>
          <small>My Salon</small>
        </span>
      </a>

      <button type="button" class="header-action" [attr.aria-label]="actionAriaLabel" (click)="action.emit()">
        <ion-icon [name]="actionIcon" aria-hidden="true"></ion-icon>
        <span>{{ actionLabel }}</span>
      </button>
    </header>
  `,
  styles: [`
    :host { display: block; }
    .my-salon-header {
      position: fixed;
      z-index: 1000;
      top: calc(10px + env(safe-area-inset-top));
      left: 50%;
      width: min(640px, calc(100% - 24px));
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 8px 7px 10px;
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: 999px;
      background: color-mix(in srgb, var(--ms-shell-accent, var(--primary, #6366F1)) 13%, rgba(255, 255, 255, 0.94));
      box-shadow: 0 18px 46px rgba(16, 24, 40, 0.18);
      backdrop-filter: blur(18px);
      transform: translateX(-50%);
    }
    .header-back, .header-brand, .header-action { display: inline-flex; align-items: center; }
    .header-back {
      flex: 0 0 auto;
      width: 34px;
      height: 34px;
      justify-content: center;
      padding: 0;
      border: 1px solid rgba(99, 102, 241, 0.16);
      border-radius: 999px;
      color: var(--primary, #6366F1);
      background: rgba(255, 255, 255, 0.78);
      font-size: 1rem;
    }
    .header-brand {
      flex: 1 1 auto;
      min-width: 0;
      gap: 8px;
      color: var(--text, #101828);
      text-decoration: none;
    }
    .header-logo {
      width: 32px;
      height: 32px;
      display: grid;
      flex: 0 0 auto;
      place-items: center;
      overflow: hidden;
      border-radius: 999px;
      color: #fff;
      background: var(--ms-shell-accent, var(--primary, #6366F1));
      box-shadow: 0 10px 22px color-mix(in srgb, var(--ms-shell-accent, var(--primary, #6366F1)) 30%, transparent);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: -0.03em;
    }
    .header-logo img { width: 100%; height: 100%; object-fit: cover; }
    .header-copy { display: grid; min-width: 0; line-height: 1.05; }
    .header-copy strong { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.86rem; letter-spacing: -0.025em; }
    .header-copy small { color: var(--muted, #667085); font-size: 0.67rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; }
    .header-action {
      flex: 0 0 auto;
      gap: 5px;
      min-height: 34px;
      padding: 0 10px;
      border: 1px solid rgba(159, 18, 57, 0.2);
      border-radius: 999px;
      color: #9F1239;
      background: rgba(255, 255, 255, 0.78);
      font-size: 0.76rem;
      font-weight: 950;
    }
    @media (max-width: 430px) {
      .header-copy strong { max-width: 150px; }
      .header-action span { display: none; }
      .header-action { width: 34px; justify-content: center; padding: 0; }
    }
  `]
})
export class MySalonHeaderComponent {
  @Input() salonName = "Selected salon";
  @Input() initials = "MS";
  @Input() logoImage = "";
  @Input() homeHref = "#";
  @Input() actionLabel = "Exit";
  @Input() actionIcon = "exit-outline";
  @Input() actionAriaLabel = "Exit My Salon";
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly home = new EventEmitter<Event>();
  @Output() readonly action = new EventEmitter<void>();

  constructor() {
    addIcons({ chevronBackOutline, exitOutline });
  }
}
