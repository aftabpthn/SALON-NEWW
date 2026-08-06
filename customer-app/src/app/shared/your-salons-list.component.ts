import { Component, EventEmitter, Input, Output } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IonButton, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { checkmarkOutline, starOutline, swapHorizontalOutline, timeOutline } from "ionicons/icons";
import { CustomerPrimarySalon, CustomerSalonRelationship } from "../core/api.types";

@Component({
  selector: "aura-your-salons-list",
  standalone: true,
  imports: [RouterLink, IonButton, IonIcon],
  template: `
    <section class="salons-section" aria-label="Your salons">
      <div class="salons-header">
        <h3>Your salons</h3>
        @if (salons.length > 0) {
          <span class="count">{{ salons.length }} visited or chosen</span>
        }
      </div>

      @if (salons.length === 0) {
        <div class="empty-state">
          @if (hasBookings) {
            <p>Your salons shows visited salons or the salon you choose as primary. Booked salons appear here after a visit or when you choose one.</p>
            <div class="empty-state-facts" aria-label="Salon account summary">
              <span>{{ bookingCount }} booked</span>
              <span>{{ favouriteCount }} favourite{{ favouriteCount === 1 ? '' : 's' }}</span>
              <span>0 visited</span>
            </div>
            <div class="empty-actions">
              <a class="empty-link" routerLink="/tabs/my-salon">Choose My Salon</a>
              <a class="empty-link secondary" routerLink="/tabs/search">Explore salons</a>
            </div>
          } @else {
            <p>You haven't visited or chosen a salon yet. Favourites and booked salons are tracked separately.</p>
            <ion-button class="primary-gradient" routerLink="/tabs/search">Explore salons</ion-button>
          }
        </div>
      } @else {
        <ul class="salon-list" role="list">
          @for (salon of salons; track salon.id) {
            <li
              class="salon-row"
              [class.is-primary]="primarySalon?.tenantId === salon.tenantId && primarySalon?.branchId === salon.branchId"
              role="listitem">
              <div class="salon-initials" [class.primary-badge]="isPrimary(salon)">
                {{ salonInitials(salon.businessName) }}
              </div>
              <div class="salon-details">
                <div class="salon-name-row">
                  <span class="salon-name">{{ salon.businessName }}</span>
                  @if (isPrimary(salon)) {
                    <span class="primary-tag">Primary</span>
                  }
                </div>
                <div class="salon-meta">
                  <span class="meta-pill">
                    <ion-icon name="time-outline"></ion-icon>
                    {{ salon.visitCount }} visit{{ salon.visitCount !== 1 ? 's' : '' }}
                  </span>
                  <span class="meta-pill relationship" [attr.data-type]="salon.relationshipType">
                    {{ formatRelationshipType(salon.relationshipType) }}
                  </span>
                  @if (salon.lastVisitAt) {
                    <span class="meta-pill">Last: {{ formatTimeAgo(salon.lastVisitAt) }}</span>
                  }
                </div>
              </div>
              <div class="salon-actions">
                @if (!isPrimary(salon)) {
                  <button
                    type="button"
                    class="set-primary-btn"
                    [attr.aria-label]="'Set ' + salon.businessName + ' as primary salon'"
                    (click)="setAsPrimary.emit(salon)">
                    <ion-icon name="star-outline"></ion-icon>
                  </button>
                }
                @if (isPrimary(salon)) {
                  <button
                    type="button"
                    class="remove-primary-btn"
                    [attr.aria-label]="'Remove ' + salon.businessName + ' as primary salon'"
                    (click)="removePrimary.emit()">
                    <ion-icon name="swap-horizontal-outline"></ion-icon>
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    .salons-section {
      display: grid;
      gap: 6px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(246, 249, 252, 0.96));
    }

    .salons-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    .salons-header h3 {
      margin: 0;
      color: var(--text);
      font-size: 1.05rem;
      font-weight: 950;
    }

    .count {
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 800;
    }

    .empty-state {
      display: grid;
      gap: 8px;
      padding: 4px 0;
      text-align: center;
    }

    .empty-state-facts,
    .empty-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
    }

    .empty-state-facts span {
      padding: 4px 9px;
      border-radius: 999px;
      color: var(--muted);
      background: var(--surface-soft);
      font-size: 0.76rem;
      font-weight: 850;
    }

    .empty-state ion-button {
      min-height: 44px;
      margin: 0;
    }

    .empty-link {
      justify-self: center;
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 18px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--primary);
      background: var(--surface);
      font-size: 0.85rem;
      font-weight: 900;
      text-decoration: none;
    }

    .empty-link.secondary {
      color: var(--text);
    }

    .empty-state p {
      margin: 0;
      color: var(--muted);
      font-size: 0.88rem;
    }

    .salon-list {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .salon-row {
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 10px 8px;
      border-radius: 14px;
      transition: background 160ms ease;
    }

    .salon-row.is-primary {
      background: rgba(99, 102, 241, 0.08);
      border: 1px solid rgba(99, 102, 241, 0.18);
    }

    @media (hover: hover) and (pointer: fine) {
      .salon-row:hover {
        background: rgba(99, 102, 241, 0.06);
      }
    }

    .salon-initials {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      color: var(--text);
      background: linear-gradient(135deg, var(--surface-soft), var(--surface-elevated));
      font-size: 0.82rem;
      font-weight: 1000;
    }

    .salon-initials.primary-badge {
      color: #FFFFFF;
      background: linear-gradient(135deg, var(--brand-600), var(--primary));
    }

    .salon-details {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    .salon-name-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .salon-name {
      min-width: 0;
      color: var(--text);
      font-weight: 900;
      font-size: 0.92rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .primary-tag {
      flex-shrink: 0;
      padding: 2px 8px;
      border-radius: 999px;
      color: #FFFFFF;
      background: linear-gradient(135deg, var(--brand-600), var(--primary));
      font-size: 0.64rem;
      font-weight: 1000;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .salon-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .meta-pill {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 7px;
      border-radius: 999px;
      color: var(--muted);
      background: rgba(99, 102, 241, 0.08);
      font-size: 0.72rem;
      font-weight: 800;
    }

    .meta-pill ion-icon {
      width: 11px;
      height: 11px;
    }

    .meta-pill.relationship[data-type="loyal"] {
      color: #6366F1;
      background: rgba(15, 118, 110, 0.1);
    }

    .meta-pill.relationship[data-type="regular"] {
      color: var(--primary);
      background: var(--primary-soft);
    }

    .salon-actions {
      display: flex;
      gap: 4px;
    }

    .set-primary-btn,
    .remove-primary-btn {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      border: 1px solid rgba(99, 102, 241, 0.2);
      background: var(--glass);
      color: var(--text);
      display: grid;
      place-items: center;
      cursor: pointer;
      transition: transform 140ms ease;
    }

    .remove-primary-btn {
      color: var(--primary);
      border-color: rgba(99, 102, 241, 0.34);
    }

    @media (hover: hover) and (pointer: fine) {
      .set-primary-btn:hover,
      .remove-primary-btn:hover {
        transform: scale(1.08);
      }
    }
  `]
})
export class YourSalonsListComponent {
  @Input() salons: CustomerSalonRelationship[] = [];
  @Input() primarySalon: CustomerPrimarySalon | null = null;
  @Input() hasBookings = false;
  @Input() bookingCount = 0;
  @Input() favouriteCount = 0;
  @Output() setAsPrimary = new EventEmitter<CustomerSalonRelationship>();
  @Output() removePrimary = new EventEmitter<void>();

  constructor() {
    addIcons({ checkmarkOutline, starOutline, swapHorizontalOutline, timeOutline });
  }

  isPrimary(salon: CustomerSalonRelationship): boolean {
    const primary = this.primarySalon;
    return !!primary && primary.tenantId === salon.tenantId && primary.branchId === salon.branchId;
  }

  salonInitials(name: string): string {
    if (!name) return "S";
    const words = name.trim().split(/\s+/);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  formatRelationshipType(type: string): string {
    const map: Record<string, string> = { guest: "New", returning: "Returning", regular: "Regular", loyal: "Loyal" };
    return map[type] || type;
  }

  formatTimeAgo(iso: string): string {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }
}
