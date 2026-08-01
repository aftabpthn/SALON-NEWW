import { Component, Input } from "@angular/core";
import { IonBackButton, IonButtons, IonHeader, IonTitle, IonToolbar } from "@ionic/angular/standalone";

@Component({
  selector: "aura-customer-mobile-header",
  standalone: true,
  imports: [IonBackButton, IonButtons, IonHeader, IonTitle, IonToolbar],
  template: `
    <ion-header class="ion-no-border customer-mobile-header">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button text="" [defaultHref]="backHref" aria-label="Back"></ion-back-button>
        </ion-buttons>
        <ion-title>
          <span class="header-title">{{ title }}</span>
          @if (subtitle) {
            <small>{{ subtitle }}</small>
          }
        </ion-title>
      </ion-toolbar>
    </ion-header>
  `,
  styles: [`
    .customer-mobile-header ion-toolbar {
      --min-height: 56px;
      --padding-start: 4px;
      --padding-end: 12px;
      --background: rgba(255, 255, 255, 0.96);
      --border-width: 0;
      color: var(--text, #101828);
    }
    .customer-mobile-header ion-back-button {
      width: 44px;
      height: 44px;
      --icon-font-size: 24px;
      --color: var(--text, #101828);
      --padding-start: 0;
      --padding-end: 0;
      --border-radius: 14px;
    }
    .customer-mobile-header ion-title {
      padding-inline: 0 8px;
      text-align: left;
    }
    .header-title, small {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .header-title {
      color: var(--text, #101828);
      font-size: 1rem;
      font-weight: 900;
      letter-spacing: -0.02em;
      line-height: 1.18;
    }
    small {
      margin-top: 2px;
      color: var(--muted, #667085);
      font-size: 0.74rem;
      font-weight: 750;
      line-height: 1.2;
    }
  `]
})
export class CustomerMobileHeaderComponent {
  @Input() title = "";
  @Input() subtitle = "";
  @Input() backHref = "/tabs/home";
}
