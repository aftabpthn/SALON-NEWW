import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthSessionService } from '../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../core/permission.guard';
import { routePermissionForPath } from '../core/access-rules';
import { AppStateService } from '../core/state/app-state.service';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type ClientBeautyProfileForm = {
  allergiesText: string;
  allergySeverity: string;
  skinType: string;
  skinConcerns: string;
  hairType: string;
  scalpCondition: string;
  chemicalHistory: string;
  formulaNotes: string;
  nailShadePreference: string;
  nailShapePreference: string;
  preferredStylistId: string;
  preferredServiceNotes: string;
  staffConsultationNote: string;
  beforeAfterNotes: string;
  treatmentDate: string;
  treatmentStaffId: string;
  productsUsed: string;
  productsToAvoid: string;
  brandPreference: string;
  patchTestDate: string;
  patchTestResult: string;
  appointmentPreference: string;
  preferredChannel: string;
  preferredLanguage: string;
  comfortNotes: string;
  lifestyleNotes: string;
};

type ClientLedgerRow = {
  name: string;
  date: string;
  amount: number;
  status: string;
  meta: string;
};

type ClientPackageRedemption = {
  date: string;
  service: string;
  staff: string;
  amount: number;
  status: string;
};

type ClientPackageRow = {
  id: string;
  name: string;
  purchaseDate: string;
  expiryDate: string;
  totalSessions: number;
  usedSessions: number;
  balanceSessions: number;
  value: number;
  status: string;
  redemptions: ClientPackageRedemption[];
};

type ClientMembershipRow = {
  id: string;
  name: string;
  startDate: string;
  expiryDate: string;
  credits: number;
  creditsUsed: number;
  creditsBalance: number;
  saleAmount: number;
  status: string;
  redemptions: ClientPackageRedemption[];
};

type ClientWalletLedgerRow = {
  id: string;
  date: string;
  type: string;
  amount: number;
  balanceAfter: number;
  source: string;
  staff: string;
  notes: string;
};

type ClientNoteHistoryRow = {
  date: string;
  type: string;
  author: string;
  note: string;
};

type ClientConsultationHistoryRow = {
  treatmentDate: string;
  treatmentStaff: string;
  skinType: string;
  hairType: string;
  scalpCondition: string;
  allergy: string;
  patchTest: string;
  chemicalHistory: string;
  formulaNotes: string;
  productsUsed: string;
  productsToAvoid: string;
  staffConsultationNote: string;
  beforeAfterNotes: string;
};

type ClientPersonalDetailsForm = {
  name: string;
  phone: string;
  email: string;
  gender: string;
  birthday: string;
  anniversary: string;
  address: string;
  occupation: string;
  source: string;
  referral: string;
  tagsText: string;
  communicationPreference: string;
};

type ClientNoteFocus = 'frontDesk' | 'internal' | 'followUp';

@Component({
  selector: 'app-client-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack inner-page-shell">
      <div class="client360-toolbar inner-action-bar">
        <a class="ghost-button fit" routerLink="/clients">Back to clients</a>
        <div class="client360-toolbar-copy">
          <strong>Enterprise 360 workspace</strong>
        </div>
      </div>
      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="client() as client">
        <section class="profile-header client360-profile-header">
          <div class="client360-header-body">
            <span class="avatar large">{{ initials(client.name) }}</span>
            <div class="client360-header-main">
              <h2>{{ client.name || 'Walk-in client' }}</h2>
              <p>{{ client.phone || client.mobile || 'No mobile' }} Â· {{ client.email || 'No email' }}</p>
              <div class="chip-row client360-status-row">
                <span class="badge">{{ clientTypeLabel(client) }}</span>
                <span class="badge">{{ membershipStatusLabel(client) }}</span>
                <span class="badge">{{ clientRiskLevel() }}</span>
                <span class="badge" *ngFor="let tag of clientTags(client); trackBy: trackValue">{{ tag }}</span>
              </div>
              <div class="client360-header-actions">
                <button class="ghost-button mini" type="button" *ngIf="!profileDetailsEditing()" (click)="startProfileDetailsEdit(client)">Edit details</button>
                <ng-container *ngIf="profileDetailsEditing()">
                  <button class="primary-button mini" type="button" (click)="savePersonalDetails()" [disabled]="personalSaving()">
                    {{ personalSaving() ? 'Saving...' : 'Save details' }}
                  </button>
                  <button class="ghost-button mini" type="button" (click)="cancelProfileDetailsEdit(client)" [disabled]="personalSaving()">Cancel</button>
                </ng-container>
              </div>
              <div class="client360-header-facts" *ngIf="!profileDetailsEditing(); else profileHeaderEdit">
                <div><span>Mobile</span><strong>{{ client.phone || client.mobile || '-' }}</strong></div>
                <div><span>Email</span><strong>{{ client.email || 'No email' }}</strong></div>
                <div><span>Gender</span><strong>{{ client.gender || '-' }}</strong></div>
                <div><span>Birthday</span><strong>{{ client.birthday || 'Not set' }}</strong></div>
                <div><span>Anniversary</span><strong>{{ client.anniversary || 'Not set' }}</strong></div>
                <div><span>Membership</span><strong>{{ membershipStatusLabel(client) }}</strong></div>
                <div><span>First visit</span><strong>{{ firstVisitLabel(client) }}</strong></div>
                <div><span>Last visit</span><strong>{{ lastVisitLabel() }}</strong></div>
                <div><span>Source</span><strong>{{ clientSourceLabel(client) }}</strong></div>
              </div>
              <ng-template #profileHeaderEdit>
                <div class="client360-inline-edit-grid">
                  <label class="field"><span>Name</span><input [(ngModel)]="personalDetails.name" placeholder="Client name" /></label>
                  <label class="field"><span>Mobile</span><input [(ngModel)]="personalDetails.phone" placeholder="Mobile number" /></label>
                  <label class="field"><span>Email</span><input type="email" [(ngModel)]="personalDetails.email" placeholder="Email address" /></label>
                  <label class="field">
                    <span>Gender</span>
                    <select [(ngModel)]="personalDetails.gender">
                      <option value="">Not set</option>
                      <option>Female</option>
                      <option>Male</option>
                      <option>Non-binary</option>
                      <option>Prefer not to say</option>
                    </select>
                  </label>
                  <label class="field"><span>Birthday</span><input type="date" [(ngModel)]="personalDetails.birthday" /></label>
                  <label class="field"><span>Anniversary</span><input type="date" [(ngModel)]="personalDetails.anniversary" /></label>
                  <label class="field"><span>Source</span><input [(ngModel)]="personalDetails.source" placeholder="Walk-in, Instagram, referral" /></label>
                </div>
              </ng-template>
            </div>
          </div>
          <div class="profile-stats client360-health-card">
            <div class="client360-score-ring">
              <strong>{{ clientHealthScore() }}/100</strong>
              <span>Health score</span>
            </div>
            <div class="client360-health-stat">
              <span>Total spend</span>
              <strong>{{ totalBilled() | auraMoney:'1.0-0' }}</strong>
            </div>
            <div class="client360-health-stat">
              <span>Loyalty</span>
              <strong>{{ loyaltyPoints(client) }} pts</strong>
            </div>
          </div>
        </section>

        <section class="client-live-metrics">
          <article class="metric-card teal">
            <span>Wallet balance</span>
            <strong>{{ walletBalance(client) | auraMoney:'1.0-0' }}</strong>
          </article>
          <article class="metric-card red">
            <span>Unpaid balance</span>
            <strong>{{ totalDue() | auraMoney:'1.0-0' }}</strong>
            <small>{{ dueInvoices().length }} open invoice(s)</small>
          </article>
          <article class="metric-card amber">
            <span>Average bill</span>
            <strong>{{ averageBill() | auraMoney:'1.0-0' }}</strong>
            <small>{{ clientInvoices().length }} saved invoice(s)</small>
          </article>
          <article class="metric-card blue">
            <span>Last visit</span>
            <strong>{{ lastVisitLabel() }}</strong>
            <small>{{ visitFrequencyLabel() }}</small>
          </article>
        </section>

        <section class="client360-command-grid">
          <aside class="panel client360-summary-panel">
            <div class="section-title">
              <div>
                <h2>Quick history</h2>
              </div>
              <span class="badge">{{ clientTypeLabel(client) }}</span>
            </div>
            <div class="client360-summary-cards">
              <div><span>Visits</span><strong>{{ totalVisits() }}</strong></div>
              <div><span>Service sale</span><strong>{{ serviceSalesTotal() | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Product sale</span><strong>{{ productSalesTotal() | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Package sale</span><strong>{{ packageSalesTotal() | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Membership sale</span><strong>{{ membershipSalesTotal() | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Wallet</span><strong>{{ walletBalance(client) | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Booked</span><strong>{{ bookedAppointments() }}</strong></div>
              <div><span>Completed</span><strong>{{ completedAppointments() }}</strong></div>
              <div><span>Cancelled</span><strong>{{ cancelledAppointments() }}</strong></div>
              <div><span>Rescheduled</span><strong>{{ rescheduledAppointments() }}</strong></div>
              <div><span>No-show</span><strong>{{ noShowAppointments() }}</strong></div>
              <div><span>Due</span><strong>{{ totalDue() | auraMoney:'1.0-0' }}</strong></div>
              <div><span>Average bill</span><strong>{{ averageBill() | auraMoney:'1.0-0' }}</strong></div>
              <div><span>First visit</span><strong>{{ firstVisitLabel(client) }}</strong></div>
              <div><span>Last visit</span><strong>{{ lastVisitLabel() }}</strong></div>
              <div><span>Last service</span><strong>{{ topServiceLabel() }}</strong></div>
              <div><span>Preferred staff</span><strong>{{ preferredStaffLabel() }}</strong></div>
            </div>
          </aside>

          <aside class="panel client360-actions-panel">
            <div class="section-title">
              <div>
                <h2>Client shortcuts</h2>
              </div>
              <span class="badge">{{ totalDue() > 0 ? 'Due pending' : 'Ready' }}</span>
            </div>
            <div class="smart-action-context">
              <span>Due {{ totalDue() | auraMoney:'1.0-0' }}</span>
              <span>Wallet {{ walletBalance(client) | auraMoney:'1.0-0' }}</span>
              <span>{{ latestInvoiceLabel() }}</span>
            </div>
            <div class="client360-action-buttons">
              <a class="primary-button smart-action-primary" [routerLink]="['/appointments']" [queryParams]="{ clientId: client.id }">Book Again</a>
              <a class="ghost-button" [routerLink]="['/pos']" [queryParams]="{ clientId: client.id }" *ngIf="canAccessPath('/pos')">Create Invoice</a>
              <a class="ghost-button" [routerLink]="['/pos/invoices']" [queryParams]="{ clientId: client.id, due: 1 }" *ngIf="canAccessPath('/pos/invoices')">Receive Due</a>
              <button class="ghost-button" type="button" (click)="selectHistoryTab('notes', 'frontDesk')">Add Note</button>
              <button class="ghost-button" type="button" (click)="selectHistoryTab('treatments')">Add Consultation</button>
              <a class="ghost-button" [href]="whatsAppLink(client)" target="_blank" rel="noopener">WhatsApp Client</a>
              <button class="ghost-button" type="button" (click)="printHistory()">Print Client History</button>
              <button class="ghost-button" type="button" (click)="openLatestInvoice()" [disabled]="!clientInvoices().length">View Last Bill</button>
            </div>
          </aside>
        </section>

        <section class="client-history-tabs" aria-label="Client history sections">
          <button
            type="button"
            *ngFor="let tab of historyTabs"
            [class.active]="activeHistoryTab() === tab.id"
            (click)="selectHistoryTab(tab.id)">
            {{ tab.label }}
          </button>
        </section>

        <section class="tab-state-strip" [class.error]="error()" [class.loading]="loading()">
          <div>
            <span class="eyebrow">{{ activeHistoryTabLabel() }}</span>
            <strong>{{ loading() ? 'Loading client history...' : error() ? 'Unable to load this view' : activeTabStateTitle() }}</strong>
            <small>{{ loading() ? 'Fetching the latest linked client records.' : error() || activeTabNextAction() }}</small>
          </div>
          <button class="ghost-button fit" type="button" *ngIf="error()" (click)="load()">Retry</button>
        </section>

            <div class="overview-tab-stack" [hidden]="activeHistoryTab() !== 'overview'">
              <section class="overview-snapshot-grid" aria-label="Client overview snapshot">
                <article>
                  <span>Health score</span>
                  <strong>{{ clientHealthScore() }}/100</strong>
                  <small>{{ clientRiskLevel() }}</small>
                </article>
                <article>
                  <span>Last visit</span>
                  <strong>{{ lastVisitLabel() }}</strong>
                  <small>{{ visitFrequencyLabel() }}</small>
                </article>
                <article>
                  <span>Top service</span>
                  <strong>{{ topServiceLabel() }}</strong>
                </article>
                <article>
                  <span>Preferred staff</span>
                  <strong>{{ preferredStaffLabel() }}</strong>
                </article>
              </section>

            <div class="dashboard-grid client-intelligence-grid">
              <section class="panel">
                <div class="section-title">
                  <div>
                    <h2>Next best action</h2>
                  </div>
                  <span class="badge">{{ clientRiskLevel() }}</span>
                </div>
                <div class="client-action-card">
                  <strong>{{ nextBestAction() }}</strong>
                  <span>{{ nextBestReason() }}</span>
                  <div class="client-action-list">
                    <span>Health score: {{ clientHealthScore() }}/100</span>
                    <span>Last visit: {{ lastVisitLabel() }}</span>
                    <span>Top service: {{ topServiceLabel() }}</span>
                    <span>Preferred staff: {{ preferredStaffLabel() }}</span>
                  </div>
                </div>
              </section>

              <section class="panel">
                <div class="section-title">
                  <div>
                    <h2>Warnings</h2>
                  </div>
                </div>
                <div class="activity-list compact-history">
                  <article [class.danger-text]="totalDue() > 0">
                    <strong>Due warning</strong>
                    <span>{{ dueWarningLabel() }} Â· {{ totalDue() | auraMoney:'1.0-0' }}</span>
                  </article>
                  <article>
                    <strong>Inactive / reactivation</strong>
                    <span>{{ reactivationWarningLabel() }} Â· Last visit {{ lastVisitLabel() }}</span>
                  </article>
                  <article [class.danger-text]="allergyPatchWarningLabel(client) !== 'Safety profile captured'">
                    <strong>Allergy / patch-test</strong>
                    <span>{{ allergyPatchWarningLabel(client) }} Â· Allergy {{ profileSummary(client, 'allergies') }} Â· Patch {{ profileSummary(client, 'patchTest') }}</span>
                  </article>
                </div>
              </section>

              <section class="panel">
                <div class="section-title">
                  <div>
                    <h2>Recent invoices</h2>
                  </div>
                </div>
                <div class="activity-list compact-history">
                  <article *ngFor="let invoice of clientInvoices().slice(0, 4); trackBy: trackApiRecord">
                    <strong>{{ invoice.invoiceNumber || invoice.invoice_no || invoice.id }}</strong>
                    <span>{{ dateLabel(invoice.createdAt || invoice.created_at || invoice.date) }} Â· {{ saleSummary(invoice.saleId || invoice.sale_id || invoice.id) }} Â· {{ invoiceTotal(invoice) | auraMoney:'1.0-0' }} Â· Due {{ invoiceBalance(invoice) | auraMoney:'1.0-0' }}</span>
                  </article>
                  <article *ngIf="!clientInvoices().length">
                    <strong>No invoices yet</strong>
                    <span>Create the first bill from POS.</span>
                  </article>
                </div>
              </section>

              <section class="panel">
                <div class="section-title">
                  <div>
                    <h2>Recent appointments</h2>
                  </div>
                </div>
                <div class="activity-list compact-history">
                  <article *ngFor="let appointment of clientAppointments().slice(0, 4); trackBy: trackApiRecord">
                    <strong>{{ appointment.serviceName || appointment.service || appointment.title || 'Appointment' }}</strong>
                    <span>{{ dateLabel(appointment.startTime || appointment.start_time || appointment.date || appointment.createdAt) }} Â· {{ staffName(appointment.staffId || appointment.staff_id || appointment.employeeId || '') }} Â· {{ appointment.status || 'booked' }}</span>
                  </article>
                  <article *ngIf="!clientAppointments().length">
                    <strong>No appointments yet</strong>
                    <span>Book a visit to start this client's timeline.</span>
                  </article>
                </div>
              </section>

              <section class="panel">
                <div class="section-title">
                  <div>
                    <h2>Recent wallet activity</h2>
                  </div>
                </div>
                <div class="activity-list compact-history">
                  <article *ngFor="let item of clientWalletTransactions().slice(0, 4); trackBy: trackApiRecord">
                    <strong>{{ item.type || item.reason || 'Wallet entry' }}</strong>
                    <span>{{ dateLabel(item.createdAt || item.created_at || item.date) }} Â· {{ moneyValue(item.amount) | auraMoney:'1.0-0' }} Â· Balance {{ walletEntryBalance(item) | auraMoney:'1.0-0' }}</span>
                  </article>
                  <article *ngIf="!clientWalletTransactions().length">
                    <strong>No wallet activity</strong>
                    <span>Wallet credits and redemptions will appear here.</span>
                  </article>
                </div>
              </section>
            </div>
            </div>

        <div class="dashboard-grid client-beauty-layout" [hidden]="activeHistoryTab() !== 'treatments'">
          <section class="panel">
            <div class="section-title">
              <div>
                <h2>Client preferences for faster service</h2>
              </div>
              <button class="primary-button" type="button" (click)="saveBeautyProfile()" [disabled]="profileSaving()">
                {{ profileSaving() ? 'Saving...' : 'Save profile' }}
              </button>
            </div>
            <div class="state success" *ngIf="profileMessage()">{{ profileMessage() }}</div>
            <div class="form-grid beauty-profile-grid">
              <label class="field full">
                <span>Allergies / sensitivity</span>
                <input [(ngModel)]="beautyProfile.allergiesText" placeholder="Hair color, bleach, wax, fragrance, product ingredient" />
              </label>
              <label class="field">
                <span>Allergy risk</span>
                <select [(ngModel)]="beautyProfile.allergySeverity">
                  <option value="">Not checked</option>
                  <option value="clear">Clear</option>
                  <option value="mild">Mild sensitivity</option>
                  <option value="high">High risk</option>
                  <option value="medical">Medical caution</option>
                </select>
              </label>
              <label class="field">
                <span>Patch test date</span>
                <input type="date" [(ngModel)]="beautyProfile.patchTestDate" />
              </label>
              <label class="field">
                <span>Patch test result</span>
                <select [(ngModel)]="beautyProfile.patchTestResult">
                  <option value="">Not tested</option>
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                  <option value="retest_required">Retest required</option>
                </select>
              </label>
              <label class="field">
                <span>Skin type</span>
                <select [(ngModel)]="beautyProfile.skinType">
                  <option value="">Select skin type</option>
                  <option>Normal</option>
                  <option>Dry</option>
                  <option>Oily</option>
                  <option>Combination</option>
                  <option>Sensitive</option>
                  <option>Acne-prone</option>
                  <option>Pigmented</option>
                  <option>Mature</option>
                </select>
              </label>
              <label class="field">
                <span>Skin concerns</span>
                <input [(ngModel)]="beautyProfile.skinConcerns" placeholder="Acne, pigmentation, tan, dryness, sensitivity" />
              </label>
              <label class="field">
                <span>Hair type</span>
                <select [(ngModel)]="beautyProfile.hairType">
                  <option value="">Select hair type</option>
                  <option>Straight</option>
                  <option>Wavy</option>
                  <option>Curly</option>
                  <option>Coily</option>
                  <option>Fine</option>
                  <option>Thick</option>
                  <option>Chemically treated</option>
                  <option>Color treated</option>
                </select>
              </label>
              <label class="field">
                <span>Scalp condition</span>
                <select [(ngModel)]="beautyProfile.scalpCondition">
                  <option value="">Select scalp condition</option>
                  <option>Normal</option>
                  <option>Dry</option>
                  <option>Oily</option>
                  <option>Dandruff</option>
                  <option>Sensitive</option>
                  <option>Hair fall concern</option>
                </select>
              </label>
              <label class="field full">
                <span>Chemical / color history</span>
                <input [(ngModel)]="beautyProfile.chemicalHistory" placeholder="Last color, keratin, smoothening, bleach, formula notes" />
              </label>
              <label class="field full">
                <span>Formula notes</span>
                <textarea [(ngModel)]="beautyProfile.formulaNotes" placeholder="Color formula, developer strength, timing, toner, facial actives, treatment mix"></textarea>
              </label>
              <label class="field">
                <span>Nail shade preference</span>
                <input [(ngModel)]="beautyProfile.nailShadePreference" placeholder="Nude, french, red, chrome, shade code" />
              </label>
              <label class="field">
                <span>Nail shape preference</span>
                <select [(ngModel)]="beautyProfile.nailShapePreference">
                  <option value="">Select nail shape</option>
                  <option>Round</option>
                  <option>Square</option>
                  <option>Squoval</option>
                  <option>Almond</option>
                  <option>Coffin</option>
                  <option>Stiletto</option>
                </select>
              </label>
              <label class="field">
                <span>Preferred stylist</span>
                <select [(ngModel)]="beautyProfile.preferredStylistId">
                  <option value="">Auto from history</option>
                  <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }} Â· {{ person.role || 'staff' }}</option>
                </select>
              </label>
              <label class="field">
                <span>Appointment preference</span>
                <input [(ngModel)]="beautyProfile.appointmentPreference" placeholder="Morning, evening, quiet room, female staff" />
              </label>
              <label class="field full">
                <span>Products used in salon</span>
                <textarea [(ngModel)]="beautyProfile.productsUsed" placeholder="Color formula, shampoo, conditioner, facial kit, nail shade, retail products"></textarea>
              </label>
              <label class="field">
                <span>Products to avoid</span>
                <input [(ngModel)]="beautyProfile.productsToAvoid" placeholder="Ammonia, strong fragrance, bleach, wax brand" />
              </label>
              <label class="field">
                <span>Brand preference</span>
                <input [(ngModel)]="beautyProfile.brandPreference" placeholder="L'Oreal, Schwarzkopf, Morfose, Dermalogica" />
              </label>
              <label class="field">
                <span>Preferred channel</span>
                <select [(ngModel)]="beautyProfile.preferredChannel">
                  <option value="">Default</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="call">Call</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="dnd">DND / only essential</option>
                </select>
              </label>
              <label class="field">
                <span>Preferred language</span>
                <select [(ngModel)]="beautyProfile.preferredLanguage">
                  <option value="">Default</option>
                  <option value="en-IN">English</option>
                  <option value="hi-IN">Hindi</option>
                  <option value="ur-IN">Urdu/Hindi</option>
                  <option value="te-IN">Telugu</option>
                </select>
              </label>
              <label class="field full">
                <span>Comfort notes</span>
                <textarea [(ngModel)]="beautyProfile.comfortNotes" placeholder="Tea/coffee, water temperature, massage pressure, privacy, music, room preference"></textarea>
              </label>
              <label class="field full">
                <span>Front desk / consultation notes</span>
                <textarea [(ngModel)]="beautyProfile.preferredServiceNotes" placeholder="How to greet, what to ask before service, upsell do/don't, consultation rules"></textarea>
              </label>
              <label class="field full">
                <span>Staff consultation note</span>
                <textarea [(ngModel)]="beautyProfile.staffConsultationNote" placeholder="Professional observation, contraindications, recommended plan, home care advice"></textarea>
              </label>
              <label class="field full">
                <span>Before / after notes</span>
                <textarea [(ngModel)]="beautyProfile.beforeAfterNotes" placeholder="Before condition, after result, client reaction, maintenance instruction"></textarea>
              </label>
              <label class="field">
                <span>Treatment date</span>
                <input type="date" [(ngModel)]="beautyProfile.treatmentDate" />
              </label>
              <label class="field">
                <span>Treatment staff</span>
                <select [(ngModel)]="beautyProfile.treatmentStaffId">
                  <option value="">Auto / not assigned</option>
                  <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }} Â· {{ person.role || 'staff' }}</option>
                </select>
              </label>
              <label class="field full">
                <span>Lifestyle context</span>
                <textarea [(ngModel)]="beautyProfile.lifestyleNotes" placeholder="Bride, corporate, travel, gym/swim, sun exposure, maintenance level"></textarea>
              </label>
            </div>
          </section>

          <section class="panel consultation-history-panel">
            <div class="section-title">
              <div>
                <h2>Salon consultation history</h2>
              </div>
              <span class="badge">{{ clientConsultationHistory(client).length }} record(s)</span>
            </div>
            <div class="consultation-history-list">
              <article class="consultation-history-card" *ngFor="let item of clientConsultationHistory(client); trackBy: trackHistoryRow">
                <div class="consultation-history-head">
                  <div>
                    <h3>{{ item.treatmentDate }}</h3>
                  </div>
                  <span class="badge">{{ item.treatmentStaff }}</span>
                </div>
                <div class="info-grid consultation-metrics">
                  <div><span>Skin type</span><strong>{{ item.skinType }}</strong></div>
                  <div><span>Hair type</span><strong>{{ item.hairType }}</strong></div>
                  <div><span>Scalp condition</span><strong>{{ item.scalpCondition }}</strong></div>
                  <div><span>Allergy</span><strong>{{ item.allergy }}</strong></div>
                  <div><span>Patch test</span><strong>{{ item.patchTest }}</strong></div>
                  <div><span>Chemical history</span><strong>{{ item.chemicalHistory }}</strong></div>
                  <div><span>Formula notes</span><strong>{{ item.formulaNotes }}</strong></div>
                  <div><span>Products used</span><strong>{{ item.productsUsed }}</strong></div>
                  <div><span>Products to avoid</span><strong>{{ item.productsToAvoid }}</strong></div>
                  <div><span>Staff note</span><strong>{{ item.staffConsultationNote }}</strong></div>
                  <div><span>Before / after</span><strong>{{ item.beforeAfterNotes }}</strong></div>
                </div>
              </article>
              <article class="empty-state" *ngIf="!clientConsultationHistory(client).length">
                <strong>No consultation history yet</strong>
                <span>Save the current beauty profile to create the first salon consultation snapshot.</span>
              </article>
            </div>
          </section>

          <section class="panel">
            <div class="section-title">
              <div>
                <h2>Profile completeness</h2>
              </div>
            </div>
            <div class="activity-list compact-history">
              <article *ngFor="let item of clientCaptureSuggestions(); trackBy: trackHistoryRow">
                <strong>{{ item.title }}</strong>
                <span>{{ item.reason }}</span>
              </article>
            </div>
            <div class="info-grid pos-linked-facts">
              <div><span>Allergy safety</span><strong>{{ profileSummary(client, 'allergies') }}</strong></div>
              <div><span>Patch test</span><strong>{{ profileSummary(client, 'patchTest') }}</strong></div>
              <div><span>Product memory</span><strong>{{ profileSummary(client, 'productsUsed') }}</strong></div>
              <div><span>Communication</span><strong>{{ profileSummary(client, 'preferredChannel') }}</strong></div>
            </div>
          </section>
        </div>

        <div class="client-ledger-layout" [hidden]="activeHistoryTab() !== 'sales' && activeHistoryTab() !== 'products' && activeHistoryTab() !== 'wallet'">
          <section class="panel" [hidden]="activeHistoryTab() !== 'sales'">
            <div class="section-title">
              <div>
                <h2>Sales / Bills</h2>
              </div>
              <span class="badge">{{ filteredClientInvoices().length }} shown</span>
            </div>
            <div class="state success" *ngIf="invoiceMessage()">{{ invoiceMessage() }}</div>
            <div class="history-filter-grid">
              <label class="field">
                <span>From</span>
                <input type="date" [(ngModel)]="salesDateFrom" />
              </label>
              <label class="field">
                <span>To</span>
                <input type="date" [(ngModel)]="salesDateTo" />
              </label>
              <label class="field">
                <span>Staff</span>
                <select [(ngModel)]="salesStaffFilter">
                  <option value="">All staff</option>
                  <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
                </select>
              </label>
              <label class="field">
                <span>Status</span>
                <select [(ngModel)]="salesStatusFilter">
                  <option value="">All status</option>
                  <option *ngFor="let status of invoiceStatusOptions(); trackBy: trackValue" [value]="status">{{ titleText(status) }}</option>
                </select>
              </label>
              <label class="field">
                <span>Service / Product</span>
                <select [(ngModel)]="salesItemFilter">
                  <option value="">All items</option>
                  <option *ngFor="let item of invoiceItemOptions(); trackBy: trackValue" [value]="item">{{ item }}</option>
                </select>
              </label>
              <label class="field">
                <span>Branch</span>
                <select [(ngModel)]="salesBranchFilter">
                  <option value="">All branches</option>
                  <option *ngFor="let branch of invoiceBranchOptions(); trackBy: trackApiRecord" [value]="branch.id">{{ branch.name }}</option>
                </select>
              </label>
            </div>
            <div class="client-invoice-table-wrap" *ngIf="filteredClientInvoices().length; else noInvoices">
              <div class="client-invoice-table" role="table" aria-label="Client invoice history">
                <div class="client-invoice-row header" role="row">
                  <span role="columnheader">Invoice #</span>
                  <span role="columnheader">Date / Time</span>
                  <span role="columnheader">Service / Product</span>
                  <span role="columnheader">Staff</span>
                  <span role="columnheader">Total</span>
                  <span role="columnheader">Paid</span>
                  <span role="columnheader">Due</span>
                  <span role="columnheader">Payment</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Actions</span>
                </div>
                <div class="client-invoice-row" role="row" *ngFor="let invoice of filteredClientInvoices(); trackBy: trackApiRecord">
                  <button class="table-link invoice-link-button" type="button" (click)="openInvoice(invoice)" role="cell">
                    <strong>{{ invoiceNumber(invoice) }}</strong>
                  </button>
                  <span role="cell">{{ dateTimeLabel(invoice.createdAt || invoice.created_at || invoice.date) }}</span>
                  <span role="cell">{{ invoiceSummary(invoice) }}</span>
                  <span role="cell">{{ invoiceStaffLabel(invoice) }}</span>
                  <span role="cell">{{ invoiceTotal(invoice) | auraMoney:'1.0-0' }}</span>
                  <span role="cell">{{ invoicePaid(invoice) | auraMoney:'1.0-0' }}</span>
                  <span role="cell" [class.danger-text]="invoiceBalance(invoice) > 0">{{ invoiceBalance(invoice) | auraMoney:'1.0-0' }}</span>
                  <span role="cell">{{ invoicePaymentMode(invoice) }}</span>
                  <span role="cell"><span class="badge">{{ invoiceStatusLabel(invoice) }}</span></span>
                  <span class="row-actions invoice-row-actions" role="cell">
                    <button class="ghost-button mini" type="button" (click)="openInvoice(invoice)">View Bill</button>
                    <button class="ghost-button mini" type="button" (click)="sendInvoicePdfWhatsapp(invoice)">WhatsApp PDF</button>
                    <button class="ghost-button mini" type="button" [disabled]="invoiceBalance(invoice) <= 0" (click)="receiveDue(invoice)">Receive Due</button>
                    <button class="ghost-button mini" type="button" (click)="printInvoice(invoice)">Print</button>
                  </span>
                </div>
              </div>
            </div>
            <ng-template #noInvoices>
              <div class="empty-state">
                <strong>No invoices yet</strong>
                <span>Invoices saved from POS will appear here automatically.</span>
              </div>
            </ng-template>
          </section>

          <section class="panel" [hidden]="activeHistoryTab() !== 'products'">
            <div class="section-title">
              <div>
                <h2>Product purchase profile</h2>
              </div>
              <span class="badge">{{ clientProductRows().length }} product(s)</span>
            </div>
            <div class="product-profile-grid" *ngIf="clientProductRows().length; else noClientProducts">
              <article class="product-profile-card" *ngFor="let product of clientProductRows(); trackBy: trackHistoryRow">
                <div>
                  <h3>{{ product.name }}</h3>
                  <p>{{ product.invoice }} Â· {{ product.lastBought }}</p>
                </div>
                <div class="product-profile-metrics">
                  <div><span>Qty</span><strong>{{ product.qty }}</strong></div>
                  <div><span>Gross</span><strong>{{ product.gross | auraMoney:'1.0-0' }}</strong></div>
                  <div><span>Discount</span><strong>{{ product.discount | auraMoney:'1.0-0' }}</strong></div>
                  <div><span>Net</span><strong>{{ product.total | auraMoney:'1.0-0' }}</strong></div>
                  <div><span>Staff</span><strong>{{ product.staff }}</strong></div>
                  <div><span>SKU</span><strong>{{ product.sku }}</strong></div>
                </div>
              </article>
            </div>
            <ng-template #noClientProducts>
              <div class="empty-state">
                <strong>No product purchases yet</strong>
                <span>Retail product bills from POS will appear here automatically.</span>
                <a class="primary-button fit" routerLink="/pos" [queryParams]="{ clientId: client.id }" *ngIf="canAccessPath('/pos')">Open POS</a>
              </div>
            </ng-template>
          </section>

          <section class="panel" [hidden]="activeHistoryTab() !== 'wallet'">
            <div class="section-title">
              <div>
                <h2>Wallet ledger</h2>
              </div>
              <span class="badge">{{ filteredClientWalletLedgerRows().length }} shown</span>
            </div>
            <div class="history-filter-grid wallet-filter-grid">
              <label class="field">
                <span>From</span>
                <input type="date" [(ngModel)]="walletDateFrom" />
              </label>
              <label class="field">
                <span>To</span>
                <input type="date" [(ngModel)]="walletDateTo" />
              </label>
              <label class="field">
                <span>Type / status</span>
                <select [(ngModel)]="walletTypeFilter">
                  <option value="">All types</option>
                  <option *ngFor="let type of walletTypeOptions(); trackBy: trackValue" [value]="type">{{ type }}</option>
                </select>
              </label>
              <label class="field">
                <span>Staff / user</span>
                <select [(ngModel)]="walletStaffFilter">
                  <option value="">All staff</option>
                  <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
                </select>
              </label>
            </div>
            <div class="wallet-ledger-table-wrap" *ngIf="filteredClientWalletLedgerRows().length; else noWalletLedger">
              <div class="wallet-ledger-table" role="table" aria-label="Client wallet ledger">
                <div class="wallet-ledger-row header" role="row">
                  <span role="columnheader">Date</span>
                  <span role="columnheader">Type</span>
                  <span role="columnheader">Amount</span>
                  <span role="columnheader">Balance after</span>
                  <span role="columnheader">Source</span>
                  <span role="columnheader">Staff / User</span>
                  <span role="columnheader">Notes</span>
                </div>
                <div class="wallet-ledger-row" role="row" *ngFor="let row of filteredClientWalletLedgerRows(); trackBy: trackHistoryRow">
                  <span role="cell">{{ row.date }}</span>
                  <span role="cell"><span class="badge">{{ row.type }}</span></span>
                  <strong role="cell" [class.danger-text]="row.amount < 0">{{ row.amount | auraMoney:'1.0-0' }}</strong>
                  <span role="cell">{{ row.balanceAfter | auraMoney:'1.0-0' }}</span>
                  <span role="cell">{{ row.source }}</span>
                  <span role="cell">{{ row.staff }}</span>
                  <span role="cell">{{ row.notes }}</span>
                </div>
              </div>
            </div>
            <ng-template #noWalletLedger>
              <div class="empty-state wallet-empty-state">
                <strong>No wallet ledger yet</strong>
                <span>Wallet credit, debit, refund, advance and due-received entries will appear here once posted.</span>
                <a class="primary-button fit" routerLink="/pos" [queryParams]="{ clientId: client.id }" *ngIf="canAccessPath('/pos')">Open POS</a>
              </div>
            </ng-template>
          </section>
        </div>

        <section class="panel" [hidden]="activeHistoryTab() !== 'family'">
          <div class="section-title">
            <div>
              <h2>Linked members and communication rules</h2>
            </div>
            <button class="ghost-button" type="button" (click)="loadFamily(client.id)">Refresh family</button>
          </div>
          <div class="form-grid compact-family">
            <label class="field">
              <span>Add existing client</span>
              <select [(ngModel)]="familyMemberId">
                <option value="">Select member</option>
                <option *ngFor="let item of clients()" [value]="item.id" [disabled]="item.id === client.id">{{ item.name }} Â· {{ item.phone }}</option>
              </select>
            </label>
            <label class="field">
              <span>Relationship</span>
              <select [(ngModel)]="familyRelationship">
                <option value="child">Child</option>
                <option value="spouse">Spouse</option>
                <option value="parent">Parent</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label class="field check-line">
              <input type="checkbox" [(ngModel)]="familyConsolidate" />
              <span>Consolidate WhatsApp/SMS to primary account</span>
            </label>
            <div class="form-actions">
              <button class="primary-button" type="button" (click)="linkFamilyMember(client.id)" [disabled]="!familyMemberId">Link member</button>
            </div>
          </div>
          <div class="family-account-layout" *ngIf="family() as tree; else noFamilyTree">
            <article class="family-primary-card">
              <div>
                <h3>{{ familyPrimary(tree, client).name }}</h3>
                <p>{{ familyPrimary(tree, client).phone || 'No phone' }} Â· {{ familyMembers(tree).length }} linked member(s)</p>
              </div>
              <span class="badge">{{ sharedWalletLabel(familyPrimary(tree, client)) }}</span>
            </article>
            <div class="family-member-table-wrap" *ngIf="familyMembers(tree).length; else noFamilyMembers">
              <div class="family-member-table" role="table" aria-label="Linked family members">
                <div class="family-member-row header" role="row">
                  <span role="columnheader">Member</span>
                  <span role="columnheader">Relation</span>
                  <span role="columnheader">Phone</span>
                  <span role="columnheader">Shared wallet</span>
                  <span role="columnheader">Communication</span>
                  <span role="columnheader">Action</span>
                </div>
                <div class="family-member-row" role="row" *ngFor="let member of familyMembers(tree); trackBy: trackApiRecord">
                  <strong role="cell">{{ member.name || 'Family member' }}</strong>
                  <span role="cell">{{ familyRelationLabel(member) }}</span>
                  <span role="cell">{{ member.phone || member.mobile || '-' }}</span>
                  <span role="cell">{{ sharedWalletLabel(member) }}</span>
                  <span role="cell">{{ familyCommunicationLabel(member) }}</span>
                  <span role="cell">
                    <button class="ghost-button mini" type="button" (click)="unlinkFamilyMember(client.id, member.id)">Unlink</button>
                  </span>
                </div>
              </div>
            </div>
            <ng-template #noFamilyMembers>
              <div class="empty-state family-empty-state">
                <strong>No linked family members</strong>
                <span>Select an existing client above to link them to this primary account.</span>
              </div>
            </ng-template>
          </div>
          <ng-template #noFamilyTree>
            <div class="empty-state family-empty-state">
              <strong>No family account loaded</strong>
              <span>Use refresh or link an existing client to create the family account view.</span>
            </div>
          </ng-template>
        </section>

        <section class="panel" [hidden]="activeHistoryTab() !== 'personal'">
          <div class="section-title">
            <div>
              <h2>Profile, preferences and client identity</h2>
            </div>
            <button class="primary-button" type="button" (click)="savePersonalDetails()" [disabled]="personalSaving()">
              {{ personalSaving() ? 'Saving...' : 'Save details' }}
            </button>
          </div>
          <div class="state success" *ngIf="personalMessage()">{{ personalMessage() }}</div>
          <div class="form-grid personal-details-grid">
            <label class="field">
              <span>Name</span>
              <input [(ngModel)]="personalDetails.name" placeholder="Client name" />
            </label>
            <label class="field">
              <span>Phone</span>
              <input [(ngModel)]="personalDetails.phone" placeholder="Mobile number" />
            </label>
            <label class="field">
              <span>Email</span>
              <input type="email" [(ngModel)]="personalDetails.email" placeholder="Email address" />
            </label>
            <label class="field">
              <span>Gender</span>
              <select [(ngModel)]="personalDetails.gender">
                <option value="">Not set</option>
                <option>Female</option>
                <option>Male</option>
                <option>Non-binary</option>
                <option>Prefer not to say</option>
              </select>
            </label>
            <label class="field">
              <span>Birthday</span>
              <input type="date" [(ngModel)]="personalDetails.birthday" />
            </label>
            <label class="field">
              <span>Anniversary</span>
              <input type="date" [(ngModel)]="personalDetails.anniversary" />
            </label>
            <label class="field full">
              <span>Address</span>
              <textarea [(ngModel)]="personalDetails.address" placeholder="Home address, area, city, notes"></textarea>
            </label>
            <label class="field">
              <span>Occupation</span>
              <input [(ngModel)]="personalDetails.occupation" placeholder="Occupation" />
            </label>
            <label class="field">
              <span>Source / referral</span>
              <input [(ngModel)]="personalDetails.source" placeholder="Walk-in, Instagram, referral, marketplace" />
            </label>
            <label class="field">
              <span>Referral name</span>
              <input [(ngModel)]="personalDetails.referral" placeholder="Referral person or campaign" />
            </label>
            <label class="field">
              <span>Communication preference</span>
              <select [(ngModel)]="personalDetails.communicationPreference">
                <option value="">Default</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="call">Call</option>
                <option value="sms">SMS</option>
                <option value="email">Email</option>
                <option value="dnd">DND / only essential</option>
              </select>
            </label>
            <label class="field full">
              <span>Tags</span>
              <input [(ngModel)]="personalDetails.tagsText" placeholder="VIP, inactive, bridal, due, sensitive skin" />
            </label>
          </div>
        </section>

        <section class="panel" [hidden]="activeHistoryTab() !== 'packages'">
          <div class="section-title">
            <div>
              <h2>Package history</h2>
            </div>
            <span class="badge">{{ clientPackageHistoryRows().length }} package(s)</span>
          </div>
          <div class="package-history-list" *ngIf="clientPackageHistoryRows().length; else noPackages">
            <article class="package-history-card" *ngFor="let row of clientPackageHistoryRows(); trackBy: trackHistoryRow">
              <div class="package-history-head">
                <div>
                  <span class="eyebrow">{{ packageHistoryEyebrow(row) }}</span>
                  <h3>{{ row.name }}</h3>
                </div>
                <div class="package-history-actions">
                  <span class="badge">{{ row.status }}</span>
                  <ng-container *ngIf="canAccessPath('/pos')">
                    <a
                      class="ghost-button fit"
                      *ngIf="row.status === 'Active'"
                      routerLink="/pos"
                      [queryParams]="{ clientId: client.id }"
                    >
                      Redeem package
                    </a>
                  </ng-container>
                </div>
              </div>
              <div class="info-grid package-metrics">
                <div><span>Purchase date</span><strong>{{ row.purchaseDate }}</strong></div>
                <div><span>Expiry date</span><strong>{{ row.expiryDate }}</strong></div>
                <div><span>Total sessions</span><strong>{{ row.totalSessions }}</strong></div>
                <div><span>Used sessions</span><strong>{{ row.usedSessions }}</strong></div>
                <div><span>Balance sessions</span><strong>{{ row.balanceSessions }}</strong></div>
                <div><span>Package value</span><strong>{{ row.value | auraMoney:'1.0-0' }}</strong></div>
              </div>
              <div class="activity-list package-redemptions">
                <article *ngFor="let redemption of row.redemptions; trackBy: trackHistoryRow">
                  <strong>{{ redemption.service }}</strong>
                  <span>{{ redemption.date }} Â· {{ redemption.staff }} Â· {{ redemption.amount | auraMoney:'1.0-0' }} Â· {{ redemption.status }}</span>
                </article>
                <article *ngIf="!row.redemptions.length">
                  <strong>No redemptions yet</strong>
                  <span>Balance sessions are available for upcoming package visits.</span>
                </article>
              </div>
            </article>
          </div>
          <ng-template #noPackages>
            <div class="empty-state package-empty-state">
              <strong>No package purchased yet</strong>
              <span>Sell a prepaid salon package from POS to track sessions, expiry, value and redemptions here.</span>
              <a class="primary-button fit" routerLink="/pos" [queryParams]="{ clientId: client.id }" *ngIf="canAccessPath('/pos')">Sell package</a>
            </div>
          </ng-template>
        </section>

        <section class="panel" [hidden]="activeHistoryTab() !== 'memberships'">
          <div class="section-title">
            <div>
              <h2>Membership history</h2>
            </div>
            <span class="badge">{{ clientMembershipHistoryRows().length || membershipStatusLabel(client) }}</span>
          </div>
          <div class="membership-history-list" *ngIf="clientMembershipHistoryRows().length; else noMembershipRows">
            <article class="membership-history-card" *ngFor="let row of clientMembershipHistoryRows(); trackBy: trackHistoryRow">
              <div class="membership-history-head">
                <div>
                  <span class="eyebrow">Membership ID {{ row.id }}</span>
                  <h3>{{ row.name }}</h3>
                </div>
                <span class="badge">{{ row.status }}</span>
              </div>
              <div class="info-grid membership-metrics">
                <div><span>Start date</span><strong>{{ row.startDate }}</strong></div>
                <div><span>Expiry date</span><strong>{{ row.expiryDate }}</strong></div>
                <div><span>Credits</span><strong>{{ row.credits }}</strong></div>
                <div><span>Credits used</span><strong>{{ row.creditsUsed }}</strong></div>
                <div><span>Credits balance</span><strong>{{ row.creditsBalance }}</strong></div>
                <div><span>Sale amount</span><strong>{{ row.saleAmount | auraMoney:'1.0-0' }}</strong></div>
              </div>
              <div class="activity-list membership-redemptions">
                <article *ngFor="let redemption of row.redemptions; trackBy: trackHistoryRow">
                  <strong>{{ redemption.service }}</strong>
                  <span>{{ redemption.date }} Â· {{ redemption.staff }} Â· {{ redemption.amount | auraMoney:'1.0-0' }} Â· {{ redemption.status }}</span>
                </article>
                <article *ngIf="!row.redemptions.length">
                  <strong>No redemptions yet</strong>
                  <span>Membership credits and benefits are ready for future visits.</span>
                </article>
              </div>
            </article>
          </div>
          <ng-template #noMembershipRows>
            <div class="empty-state membership-empty-state">
              <strong>No membership purchased yet</strong>
              <span>Sell or assign a salon membership to track credits, expiry, sale value and redemptions here.</span>
              <a class="primary-button fit" routerLink="/pos" [queryParams]="{ clientId: client.id }" *ngIf="canAccessPath('/pos')">Sell membership</a>
            </div>
          </ng-template>
        </section>

        <section class="panel" [hidden]="activeHistoryTab() !== 'feedback'">
          <div class="section-title">
            <div>
              <h2>Ratings and service feedback</h2>
            </div>
            <span class="badge">{{ feedbackHistory(client).length }} review(s)</span>
          </div>
          <div class="feedback-table-wrap" *ngIf="feedbackHistory(client).length; else noFeedback">
            <div class="feedback-table" role="table" aria-label="Client feedback history">
              <div class="feedback-row header" role="row">
                <span role="columnheader">Rating</span>
                <span role="columnheader">Feedback</span>
                <span role="columnheader">Source</span>
                <span role="columnheader">Date</span>
                <span role="columnheader">Staff / Service</span>
                <span role="columnheader">Reply / Action</span>
              </div>
              <div class="feedback-row" role="row" *ngFor="let item of feedbackHistory(client); trackBy: trackHistoryRow">
                <strong role="cell">{{ feedbackRating(item) }}</strong>
                <span role="cell">{{ feedbackText(item) }}</span>
                <span role="cell">{{ feedbackSource(item) }}</span>
                <span role="cell">{{ feedbackDate(item) }}</span>
                <span role="cell">{{ feedbackLinkedContext(item) }}</span>
                <span class="row-actions feedback-row-actions" role="cell">
                  <a class="ghost-button mini" *ngIf="feedbackActionUrl(item); else noFeedbackAction" [href]="feedbackActionUrl(item)" target="_blank" rel="noopener">{{ feedbackActionLabel(item) }}</a>
                  <ng-template #noFeedbackAction><button class="ghost-button mini" type="button" disabled>{{ feedbackActionLabel(item) }}</button></ng-template>
                </span>
              </div>
            </div>
          </div>
          <ng-template #noFeedback>
            <div class="empty-state feedback-empty-state">
              <strong>No feedback captured yet</strong>
              <span>Ratings, client complaints and service feedback will appear here when linked to this client.</span>
            </div>
          </ng-template>
        </section>

        <section class="panel notes-page-panel" #notesPanel [hidden]="activeHistoryTab() !== 'notes'">
          <div class="section-title">
            <div>
              <h2>Notes and follow-up</h2>
            </div>
            <button class="primary-button" type="button" (click)="saveNotes()" [disabled]="notesSaving()">Save note</button>
          </div>
          <div class="notes-page-actions" aria-label="Note sections">
            <button type="button" (click)="focusNoteField('frontDesk')">Front desk notes</button>
            <button type="button" (click)="focusNoteField('internal')">Internal notes</button>
            <button type="button" (click)="focusNoteField('followUp')">Follow-up notes</button>
          </div>
          <div class="state success" *ngIf="notesMessage()">{{ notesMessage() }}</div>
          <div class="notes-tab-layout">
            <div class="notes-editor-grid">
              <label class="note-field">
                <span>Front desk notes</span>
                <textarea #frontDeskNotesBox class="notes-box" [(ngModel)]="frontDeskNotes" placeholder="Arrival preference, billing reminders, comfort cues"></textarea>
              </label>
              <label class="note-field">
                <span>Internal notes</span>
                <textarea #internalNotesBox class="notes-box" [(ngModel)]="internalNotes" placeholder="Staff-only service context, risk flags, operational notes"></textarea>
              </label>
              <label class="note-field">
                <span>Follow-up notes</span>
                <textarea #followUpNotesBox class="notes-box" [(ngModel)]="followUpNotes" placeholder="Next call, reactivation, due reminder, product follow-up"></textarea>
              </label>
            </div>

            <aside class="whatsapp-summary-card">
              <div class="section-title">
                <div>
                  <h2>Summary</h2>
                </div>
                <a class="ghost-button fit" [href]="whatsAppFollowUpLink(client)" target="_blank" rel="noopener">Open WhatsApp</a>
              </div>
              <p>{{ whatsAppFollowUpSummary(client) }}</p>
              <div class="info-grid pos-linked-facts">
                <div><span>Last visit</span><strong>{{ lastVisitLabel() }}</strong></div>
                <div><span>Due</span><strong>{{ totalDue() | auraMoney:'1.0-0' }}</strong></div>
                <div><span>Wallet</span><strong>{{ walletBalance(client) | auraMoney:'1.0-0' }}</strong></div>
                <div><span>Preferred staff</span><strong>{{ preferredStaffLabel() }}</strong></div>
              </div>
            </aside>
          </div>

          <div class="note-history-panel">
            <div class="section-title">
              <div>
                <h2>Note history</h2>
              </div>
              <span class="badge">{{ clientNoteHistory(client).length }} item(s)</span>
            </div>
            <div class="activity-list note-history-list">
              <article *ngFor="let item of clientNoteHistory(client); trackBy: trackHistoryRow">
                <strong>{{ item.type }} Â· {{ item.date }}</strong>
                <span>{{ item.note }}</span>
                <small>{{ item.author }}</small>
              </article>
              <article *ngIf="!clientNoteHistory(client).length">
                <strong>No note history yet</strong>
                <span>Saved notes and follow-up interactions will appear here when available.</span>
              </article>
            </div>
          </div>
        </section>

        <section class="panel" [hidden]="activeHistoryTab() !== 'documents'">
          <div class="section-title">
            <div>
              <h2>Signed consent forms</h2>
            </div>
            <span class="badge">{{ consentHistory(client).length }} form(s)</span>
          </div>
          <div class="document-consent-table-wrap" *ngIf="consentHistory(client).length; else noConsentForms">
            <div class="document-consent-table" role="table" aria-label="Signed consent forms">
              <div class="document-consent-row header" role="row">
                <span role="columnheader">Document name</span>
                <span role="columnheader">Signed date</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Actions</span>
              </div>
              <div class="document-consent-row" role="row" *ngFor="let form of consentHistory(client); trackBy: trackHistoryRow">
                <strong role="cell">{{ consentDocumentName(form) }}</strong>
                <span role="cell">{{ consentSignedDate(form) }}</span>
                <span role="cell"><span class="badge">{{ consentStatus(form) }}</span></span>
                <span class="row-actions document-row-actions" role="cell">
                  <a class="ghost-button mini" *ngIf="consentDocumentUrl(form); else noViewDocument" [href]="consentDocumentUrl(form)" target="_blank" rel="noopener">View</a>
                  <ng-template #noViewDocument><button class="ghost-button mini" type="button" disabled>View</button></ng-template>
                  <a class="ghost-button mini" *ngIf="consentDownloadUrl(form); else noDownloadDocument" [href]="consentDownloadUrl(form)" target="_blank" rel="noopener" download>Download</a>
                  <ng-template #noDownloadDocument><button class="ghost-button mini" type="button" disabled>Download</button></ng-template>
                </span>
              </div>
            </div>
          </div>
          <ng-template #noConsentForms>
            <div class="empty-state document-empty-state">
              <strong>No forms signed</strong>
              <span>Signed consent forms and client documents will appear here when linked to this profile.</span>
            </div>
          </ng-template>
        </section>

        <div class="appointment-history-layout" [hidden]="activeHistoryTab() !== 'appointments'">
          <section class="panel appointment-history-panel">
            <div class="section-title">
              <div>
                <h2>Bookings and visits</h2>
              </div>
              <span class="badge">{{ filteredClientAppointments().length }} shown</span>
            </div>

            <div class="appointment-filter-grid">
              <label class="field">
                <span>From date</span>
                <input type="date" [(ngModel)]="appointmentDateFrom" />
              </label>
              <label class="field">
                <span>To date</span>
                <input type="date" [(ngModel)]="appointmentDateTo" />
              </label>
              <label class="field">
                <span>Staff</span>
                <select [(ngModel)]="appointmentStaffFilter">
                  <option value="">All staff</option>
                  <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
                </select>
              </label>
              <label class="field">
                <span>Status</span>
                <select [(ngModel)]="appointmentStatusFilter">
                  <option value="">All status</option>
                  <option *ngFor="let status of appointmentStatusOptions" [value]="status">{{ titleText(status) }}</option>
                </select>
              </label>
              <label class="field">
                <span>Branch</span>
                <select [(ngModel)]="appointmentBranchFilter">
                  <option value="">All branches</option>
                  <option *ngFor="let branch of appointmentBranchOptions(); trackBy: trackApiRecord" [value]="branch.id">{{ branch.name }}</option>
                </select>
              </label>
            </div>

            <div class="client-appointment-table-wrap" *ngIf="filteredClientAppointments().length; else noAppointments">
              <div class="client-appointment-table" role="table" aria-label="Client appointment history">
                <div class="client-appointment-row header" role="row">
                  <span role="columnheader">Date / Time</span>
                  <span role="columnheader">Service</span>
                  <span role="columnheader">Staff</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Source</span>
                  <span role="columnheader">Amount</span>
                  <span role="columnheader">Action</span>
                </div>
                <div class="client-appointment-row" role="row" *ngFor="let appointment of filteredClientAppointments(); trackBy: trackApiRecord">
                  <span role="cell">{{ dateTimeLabel(appointment.startTime || appointment.start_time || appointment.date || appointment.createdAt) }}</span>
                  <strong role="cell">{{ appointmentServiceLabel(appointment) }}</strong>
                  <span role="cell">{{ appointmentStaffLabel(appointment) }}</span>
                  <span role="cell"><span class="badge">{{ appointmentStatusLabel(appointment) }}</span></span>
                  <span role="cell">{{ appointmentSourceLabel(appointment) }}</span>
                  <span role="cell">{{ appointmentAmount(appointment) | auraMoney:'1.0-0' }}</span>
                  <span role="cell">
                    <button class="ghost-button mini" type="button" (click)="bookAgain(appointment)">Book Again</button>
                  </span>
                </div>
              </div>
            </div>
            <ng-template #noAppointments>
              <div class="empty-state">
                <strong>No appointments found</strong>
                <span>Change filters or book a new visit for this client.</span>
              </div>
            </ng-template>
          </section>

          <section class="panel">
            <div class="section-title"><h2>Visit history</h2></div>
            <div class="activity-list">
              <article *ngFor="let visit of liveVisitHistory(client).slice(0, 8); trackBy: trackHistoryRow">
                <strong>{{ visit.date }}</strong>
                <span>{{ visit.services || visit.saleId }}</span>
              </article>
              <article *ngIf="!liveVisitHistory(client).length">
                <strong>No visits yet</strong>
                <span>Completed appointments and POS sales will create visits here.</span>
              </article>
            </div>
          </section>

          <section class="panel">
            <div class="section-title"><h2>Purchase history</h2></div>
            <div class="activity-list">
              <article *ngFor="let purchase of livePurchaseHistory(client).slice(0, 8); trackBy: trackHistoryRow">
                <strong>{{ purchase.invoice }}</strong>
                <span>{{ purchase.amount | auraMoney:'1.0-0' }}</span>
              </article>
              <article *ngIf="!livePurchaseHistory(client).length">
                <strong>No purchases yet</strong>
                <span>Saved invoices will update this section.</span>
              </article>
            </div>
          </section>

          <section class="panel">
            <div class="section-title"><h2>WhatsApp follow-ups</h2></div>
            <div class="activity-list">
              <article *ngFor="let item of client.whatsappHistory">
                <strong>{{ item.status }}</strong>
                <span>{{ item.message }} Â· {{ item.date }}</span>
              </article>
            </div>
          </section>
        </div>
      </ng-container>
    </section>
  `
  ,
  styles: [`
    :host {
      display: block;
    }

    .client360-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      border: 1px solid #dbe5ee;
      border-radius: 8px;
      background: #fff;
      padding: 10px 12px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
    }

    .client360-toolbar-copy {
      display: grid;
      gap: 2px;
      text-align: right;
      color: #0f172a;
    }

    .client360-toolbar-copy strong {
      font-size: 0.92rem;
      font-weight: 900;
    }

    .client-history-tabs {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 10px;
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.78);
      -webkit-overflow-scrolling: touch;
      scroll-snap-type: x proximity;
    }

    .client-history-tabs button {
      flex: 0 0 auto;
      border: 1px solid #cfe4de;
      border-radius: 8px;
      background: #fff;
      color: #334155;
      font-weight: 800;
      padding: 10px 14px;
      cursor: pointer;
      scroll-snap-align: start;
      white-space: nowrap;
    }

    .client-history-tabs button.active {
      background: #102018;
      border-color: #102018;
      color: #fff;
    }

    .tab-state-strip {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: #f8fcfb;
      padding: 12px 14px;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
    }

    .tab-state-strip strong,
    .tab-state-strip small {
      display: block;
      overflow-wrap: anywhere;
    }

    .tab-state-strip small {
      color: #64748b;
      margin-top: 3px;
    }

    .tab-state-strip.loading {
      background: #fffaf0;
      border-color: #fde68a;
    }

    .tab-state-strip.error {
      background: #fff5f5;
      border-color: #fecaca;
    }

    .client-invoice-table-wrap {
      overflow-x: auto;
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: #fff;
    }

    .client-invoice-table {
      min-width: 1180px;
      display: grid;
    }

    .client-invoice-row {
      display: grid;
      grid-template-columns: 120px 150px minmax(180px, 1.5fr) 140px 96px 96px 96px 120px 110px minmax(260px, 1.4fr);
      gap: 10px;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid #e7f2ef;
    }

    .client-invoice-row:last-child {
      border-bottom: 0;
    }

    .client-invoice-row.header {
      background: #f6fbf9;
      color: #64748b;
      font-size: 0.74rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .client-invoice-row span,
    .client-invoice-row button {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .invoice-row-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-start;
      gap: 6px;
    }

    .wallet-ledger-table-wrap {
      overflow-x: auto;
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: #fff;
    }

    .wallet-ledger-table {
      min-width: 1040px;
      display: grid;
    }

    .wallet-ledger-row {
      display: grid;
      grid-template-columns: 150px 120px 110px 130px 170px 150px minmax(180px, 1fr);
      gap: 10px;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid #e7f2ef;
    }

    .wallet-ledger-row:last-child {
      border-bottom: 0;
    }

    .wallet-ledger-row.header {
      background: #f6fbf9;
      color: #64748b;
      font-size: 0.74rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .wallet-ledger-row span,
    .wallet-ledger-row strong {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .wallet-empty-state {
      align-items: flex-start;
      text-align: left;
    }

    .notes-tab-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
      gap: 14px;
      align-items: stretch;
    }

    .notes-editor-grid {
      display: grid;
      gap: 12px;
    }

    .notes-page-panel {
      scroll-margin-top: 90px;
    }

    .notes-page-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 14px;
    }

    .notes-page-actions button {
      border: 1px solid #cfe0dc;
      border-radius: 999px;
      background: #f8fffd;
      color: #4B1238;
      cursor: pointer;
      font-weight: 900;
      min-height: 36px;
      padding: 8px 12px;
    }

    .notes-page-actions button:hover,
    .notes-page-actions button:focus-visible {
      background: #4B1238;
      color: #fff;
      outline: none;
    }

    .note-field {
      display: grid;
      gap: 6px;
      color: #102018;
      font-weight: 800;
    }

    .note-field span {
      color: #64748b;
      font-size: 0.78rem;
      text-transform: uppercase;
    }

    .notes-box {
      min-height: 110px;
      resize: vertical;
    }

    .whatsapp-summary-card,
    .note-history-panel {
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: #fff;
      padding: 14px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }

    .whatsapp-summary-card p {
      margin: 0 0 12px;
      color: #334155;
      line-height: 1.55;
    }

    .note-history-panel {
      margin-top: 14px;
    }

    .note-history-list small {
      color: #64748b;
      font-weight: 700;
    }

    .document-consent-table-wrap {
      overflow-x: auto;
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: #fff;
    }

    .document-consent-table {
      min-width: 780px;
      display: grid;
    }

    .document-consent-row {
      display: grid;
      grid-template-columns: minmax(220px, 1.5fr) 150px 120px minmax(180px, 0.8fr);
      gap: 10px;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid #e7f2ef;
    }

    .document-consent-row:last-child {
      border-bottom: 0;
    }

    .document-consent-row.header {
      background: #f6fbf9;
      color: #64748b;
      font-size: 0.74rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .document-consent-row span,
    .document-consent-row strong {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .document-row-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .document-empty-state {
      align-items: flex-start;
      text-align: left;
    }

    .feedback-table-wrap {
      overflow-x: auto;
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: #fff;
    }

    .feedback-table {
      min-width: 980px;
      display: grid;
    }

    .feedback-row {
      display: grid;
      grid-template-columns: 90px minmax(220px, 1.4fr) 120px 150px minmax(180px, 1fr) 130px;
      gap: 10px;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid #e7f2ef;
    }

    .feedback-row:last-child {
      border-bottom: 0;
    }

    .feedback-row.header {
      background: #f6fbf9;
      color: #64748b;
      font-size: 0.74rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .feedback-row span,
    .feedback-row strong {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .feedback-row-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .feedback-empty-state {
      align-items: flex-start;
      text-align: left;
    }

    .family-account-layout {
      display: grid;
      gap: 14px;
      margin-top: 14px;
    }

    .family-primary-card {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: #fff;
      padding: 14px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }

    .family-primary-card h3 {
      margin: 3px 0;
      color: #102018;
      font-size: 1.05rem;
    }

    .family-primary-card p {
      margin: 0;
      color: #64748b;
      font-weight: 700;
    }

    .family-member-table-wrap {
      overflow-x: auto;
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: #fff;
    }

    .family-member-table {
      min-width: 880px;
      display: grid;
    }

    .family-member-row {
      display: grid;
      grid-template-columns: minmax(160px, 1.2fr) 110px 130px 130px minmax(180px, 1fr) 110px;
      gap: 10px;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid #e7f2ef;
    }

    .family-member-row:last-child {
      border-bottom: 0;
    }

    .family-member-row.header {
      background: #f6fbf9;
      color: #64748b;
      font-size: 0.74rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .family-member-row span,
    .family-member-row strong {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .family-empty-state {
      align-items: flex-start;
      text-align: left;
    }

    .personal-details-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .consultation-history-panel {
      min-width: 0;
    }

    .consultation-history-list {
      display: grid;
      gap: 12px;
    }

    .consultation-history-card {
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: #fff;
      padding: 14px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }

    .consultation-history-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .consultation-history-head h3 {
      margin: 3px 0 0;
      color: #102018;
      font-size: 1.05rem;
    }

    .consultation-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .appointment-history-layout {
      display: grid;
      gap: 14px;
    }

    .appointment-filter-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }

    .history-filter-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }

    .wallet-filter-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .client-appointment-table-wrap {
      overflow-x: auto;
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: #fff;
    }

    .client-appointment-table {
      min-width: 980px;
      display: grid;
    }

    .client-appointment-row {
      display: grid;
      grid-template-columns: 160px minmax(180px, 1.4fr) 140px 118px 116px 100px 120px;
      gap: 10px;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid #e7f2ef;
    }

    .client-appointment-row:last-child {
      border-bottom: 0;
    }

    .client-appointment-row.header {
      background: #f6fbf9;
      color: #64748b;
      font-size: 0.74rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .client-appointment-row span,
    .client-appointment-row strong {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    [hidden] {
      display: none !important;
    }

    .overview-tab-stack {
      display: grid;
      gap: 14px;
    }

    .overview-snapshot-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .overview-snapshot-grid article {
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: #fff;
      padding: 14px;
      min-width: 0;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }

    .overview-snapshot-grid span,
    .overview-snapshot-grid small {
      display: block;
      color: #64748b;
      font-size: 0.78rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .overview-snapshot-grid strong {
      display: block;
      margin: 6px 0 4px;
      color: #102018;
      font-size: 1.05rem;
      overflow-wrap: anywhere;
    }

    .client360-profile-header {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
      gap: 22px;
      align-items: stretch;
      overflow: hidden;
      border: 1px solid #d9e3ec;
      border-radius: 8px;
      background:
        linear-gradient(135deg, rgba(75,18,56,0.03), transparent 34%),
        linear-gradient(90deg, #ffffff 0%, #ffffff 66%, #f8fbff 100%);
      padding: 28px;
      box-shadow: 0 22px 48px rgba(15, 23, 42, 0.10);
    }

    .client360-profile-header::before {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 5px;
      content: '';
      background: linear-gradient(90deg, #4B1238, #63214D, #4B1238);
    }

    .client360-header-body {
      display: flex;
      gap: 18px;
      min-width: 0;
      align-items: flex-start;
    }

    .client360-header-body .avatar.large {
      width: 76px;
      height: 76px;
      flex: 0 0 76px;
      border: 1px solid #c7d2fe;
      background: #F5EEF2;
      color: #083344;
      box-shadow: 0 14px 28px rgba(15, 23, 42, 0.12);
    }

    .client360-header-main {
      display: grid;
      gap: 10px;
      min-width: 0;
    }

    .client360-header-main h2 {
      margin: 0;
      color: #0f172a;
      font-size: 2.45rem;
      line-height: 1;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }

    .client360-header-main p {
      margin: 0;
      color: #475569;
      font-weight: 700;
    }

    .client360-status-row {
      margin-top: 0;
    }

    .client360-header-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .client360-header-actions .mini {
      padding: 8px 11px;
      min-height: 36px;
      font-size: 0.8rem;
    }

    .client360-header-facts {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 2px;
    }

    .client360-header-facts div,
    .client360-summary-cards div {
      border: 1px solid #d9e3ec;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.88);
      padding: 12px;
      min-width: 0;
    }

    .client360-header-facts span,
    .client360-summary-cards span {
      display: block;
      color: #64748b;
      font-size: 0.76rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .client360-header-facts strong,
    .client360-summary-cards strong {
      display: block;
      margin-top: 4px;
      color: #0f172a;
      overflow-wrap: anywhere;
    }

    .client360-inline-edit-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 2px;
    }

    .client360-inline-edit-grid .field {
      margin: 0;
      display: grid;
      gap: 5px;
      color: #64748b;
      font-size: 0.76rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .client360-inline-edit-grid input,
    .client360-inline-edit-grid select {
      width: 100%;
      min-height: 44px;
      border: 1px solid #d9e3ec;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.94);
      padding: 10px 12px;
      color: #0f172a;
      font: inherit;
      text-transform: none;
    }

    .client360-health-card {
      display: grid;
      gap: 12px;
      align-content: stretch;
      border: 1px solid #d9e3ec;
      border-radius: 8px;
      background: #0f172a;
      color: #fff;
      padding: 16px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }

    .client360-score-ring,
    .client360-health-stat {
      min-width: 0;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.07);
      padding: 14px;
    }

    .client360-score-ring strong {
      display: block;
      color: #fff;
      font-size: 2.1rem;
      line-height: 1;
    }

    .client360-health-card span {
      display: block;
      margin-top: 6px;
      color: #cbd5e1;
      font-size: 0.78rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .client360-health-stat strong {
      display: block;
      margin-top: 6px;
      color: #fff;
      font-size: 1.22rem;
    }

    .client-live-metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
    }

    .client-live-metrics .metric-card {
      min-height: 124px;
      border: 1px solid #d9e3ec;
      border-top-width: 4px;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.08);
    }

    .client-live-metrics .metric-card span {
      color: #64748b;
    }

    .client-live-metrics .metric-card strong {
      color: #0f172a;
      font-size: 1.85rem;
      line-height: 1.05;
    }

    .client360-summary-cards {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .client360-command-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(340px, 400px);
      gap: 18px;
      align-items: start;
    }

    .client360-summary-panel,
    .client360-actions-panel {
      border: 1px solid #d9e3ec;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.08);
    }

    .client360-actions-panel {
      position: sticky;
      top: 12px;
    }

    .smart-action-context {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 14px;
    }

    .smart-action-context span {
      border: 1px solid #d9e3ec;
      border-radius: 8px;
      background: #f8fafc;
      color: #334155;
      font-size: 0.78rem;
      font-weight: 800;
      padding: 8px 10px;
      overflow-wrap: anywhere;
    }

    .client360-action-buttons {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .client360-action-buttons a,
    .client360-action-buttons button {
      justify-content: center;
      width: 100%;
      text-align: center;
    }

    .smart-action-primary {
      min-height: 42px;
      grid-column: 1 / -1;
    }

    .product-profile-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .product-profile-card {
      display: grid;
      gap: 14px;
      min-width: 0;
      border: 1px solid #d9e3ec;
      border-radius: 8px;
      background: #fff;
      padding: 16px;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.07);
    }

    .product-profile-card h3 {
      margin: 4px 0;
      color: #0f172a;
      font-size: 1.08rem;
      overflow-wrap: anywhere;
    }

    .product-profile-card p {
      margin: 0;
      color: #64748b;
      font-size: 0.86rem;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .product-profile-metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }

    .product-profile-metrics div {
      min-width: 0;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
      padding: 10px;
    }

    .product-profile-metrics span {
      display: block;
      color: #64748b;
      font-size: 0.72rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .product-profile-metrics strong {
      display: block;
      margin-top: 4px;
      color: #0f172a;
      overflow-wrap: anywhere;
    }

    .package-history-list {
      display: grid;
      gap: 14px;
    }

    .package-history-card {
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: #fff;
      padding: 16px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }

    .package-history-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .package-history-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .package-history-head h3 {
      margin: 3px 0 0;
      color: #102018;
      font-size: 1.05rem;
    }

    .package-metrics {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin-bottom: 12px;
    }

    .package-redemptions {
      border-top: 1px solid #e7f2ef;
      padding-top: 12px;
    }

    .package-redemptions article {
      background: #f8fcfb;
    }

    .package-empty-state {
      align-items: flex-start;
      text-align: left;
    }

    .membership-history-list {
      display: grid;
      gap: 14px;
    }

    .membership-history-card {
      border: 1px solid #d9ebe7;
      border-radius: 8px;
      background: #fff;
      padding: 16px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }

    .membership-history-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .membership-history-head h3 {
      margin: 3px 0 0;
      color: #102018;
      font-size: 1.05rem;
    }

    .membership-metrics {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin-bottom: 12px;
    }

    .membership-redemptions {
      border-top: 1px solid #e7f2ef;
      padding-top: 12px;
    }

    .membership-redemptions article {
      background: #f8fcfb;
    }

    .membership-empty-state {
      align-items: flex-start;
      text-align: left;
    }

    @media (max-width: 760px) {
      .page-stack {
        gap: 12px;
      }

      .client-live-metrics,
      .client-intelligence-grid,
      .client-beauty-layout,
      .client-ledger-layout,
      .three-grid,
      .dashboard-grid,
      .client360-command-grid,
      .client360-profile-header {
        grid-template-columns: 1fr;
      }

      .notes-tab-layout {
        grid-template-columns: 1fr;
      }

      .profile-header,
      .client360-header-body {
        align-items: flex-start;
        flex-direction: column;
      }

      .client360-header-main,
      .client360-header-main h2,
      .client360-header-main p {
        width: 100%;
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .client360-header-main h2 {
        font-size: 1.85rem;
      }

      .profile-stats {
        width: 100%;
      }

      .client360-actions-panel {
        position: static;
      }

      .client360-header-facts,
      .overview-snapshot-grid,
      .package-metrics,
      .membership-metrics,
      .consultation-metrics,
      .history-filter-grid,
      .wallet-filter-grid,
      .appointment-filter-grid {
        grid-template-columns: 1fr;
      }

      .client360-summary-cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .smart-action-context {
        grid-template-columns: 1fr;
      }

      .product-profile-grid,
      .product-profile-metrics {
        grid-template-columns: 1fr;
      }

      .client-history-tabs {
        margin-inline: -4px;
        padding: 8px;
        border-radius: 8px;
      }

      .client-history-tabs button {
        padding: 9px 12px;
        font-size: 0.82rem;
      }

      .tab-state-strip {
        align-items: flex-start;
        flex-direction: column;
      }

      .client360-action-buttons {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .client360-action-buttons .smart-action-primary {
        grid-column: 1 / -1;
      }

      .client360-action-buttons a,
      .client360-action-buttons button {
        min-height: 40px;
        padding-inline: 8px;
      }

      .personal-details-grid {
        grid-template-columns: 1fr;
      }

      .package-history-head,
      .membership-history-head,
      .consultation-history-head {
        flex-direction: column;
      }

      .client-invoice-table {
        min-width: 0;
      }

      .client-invoice-row,
      .client-invoice-row.header {
        grid-template-columns: 1fr;
      }

      .client-invoice-row,
      .wallet-ledger-row,
      .document-consent-row,
      .feedback-row,
      .family-member-row,
      .client-appointment-row {
        gap: 8px;
        margin: 10px;
        border: 1px solid #d9ebe7;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
      }

      .client-invoice-row span,
      .client-invoice-row button,
      .wallet-ledger-row span,
      .wallet-ledger-row strong,
      .document-consent-row span,
      .document-consent-row strong,
      .feedback-row span,
      .feedback-row strong,
      .family-member-row span,
      .family-member-row strong,
      .client-appointment-row span,
      .client-appointment-row strong {
        display: grid;
        gap: 3px;
      }

      .client-invoice-row span::before,
      .client-invoice-row button::before,
      .wallet-ledger-row span::before,
      .wallet-ledger-row strong::before,
      .document-consent-row span::before,
      .document-consent-row strong::before,
      .feedback-row span::before,
      .feedback-row strong::before,
      .family-member-row span::before,
      .family-member-row strong::before,
      .client-appointment-row span::before,
      .client-appointment-row strong::before {
        color: #64748b;
        font-size: 0.68rem;
        font-weight: 900;
        text-transform: uppercase;
      }

      .client-invoice-row > :nth-child(1)::before { content: 'Invoice #'; }
      .client-invoice-row > :nth-child(2)::before { content: 'Date / Time'; }
      .client-invoice-row > :nth-child(3)::before { content: 'Service / Product'; }
      .client-invoice-row > :nth-child(4)::before { content: 'Staff'; }
      .client-invoice-row > :nth-child(5)::before { content: 'Total'; }
      .client-invoice-row > :nth-child(6)::before { content: 'Paid'; }
      .client-invoice-row > :nth-child(7)::before { content: 'Due'; }
      .client-invoice-row > :nth-child(8)::before { content: 'Payment'; }
      .client-invoice-row > :nth-child(9)::before { content: 'Status'; }
      .client-invoice-row > :nth-child(10)::before { content: 'Actions'; }

      .client-invoice-row .row-actions,
      .document-consent-row .row-actions,
      .feedback-row .row-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .client-invoice-row .row-actions::before,
      .document-consent-row .row-actions::before,
      .feedback-row .row-actions::before {
        flex: 0 0 100%;
      }

      .client-invoice-row.header {
        display: none;
      }

      .wallet-ledger-table {
        min-width: 0;
      }

      .wallet-ledger-row,
      .wallet-ledger-row.header {
        grid-template-columns: 1fr;
      }

      .wallet-ledger-row > :nth-child(1)::before { content: 'Date'; }
      .wallet-ledger-row > :nth-child(2)::before { content: 'Type'; }
      .wallet-ledger-row > :nth-child(3)::before { content: 'Amount'; }
      .wallet-ledger-row > :nth-child(4)::before { content: 'Balance after'; }
      .wallet-ledger-row > :nth-child(5)::before { content: 'Source'; }
      .wallet-ledger-row > :nth-child(6)::before { content: 'Staff / User'; }
      .wallet-ledger-row > :nth-child(7)::before { content: 'Notes'; }

      .wallet-ledger-row.header {
        display: none;
      }

      .document-consent-table {
        min-width: 0;
      }

      .document-consent-row,
      .document-consent-row.header {
        grid-template-columns: 1fr;
      }

      .document-consent-row > :nth-child(1)::before { content: 'Document name'; }
      .document-consent-row > :nth-child(2)::before { content: 'Signed date'; }
      .document-consent-row > :nth-child(3)::before { content: 'Status'; }
      .document-consent-row > :nth-child(4)::before { content: 'Actions'; }

      .document-consent-row.header {
        display: none;
      }

      .feedback-table {
        min-width: 0;
      }

      .feedback-row,
      .feedback-row.header {
        grid-template-columns: 1fr;
      }

      .feedback-row > :nth-child(1)::before { content: 'Rating'; }
      .feedback-row > :nth-child(2)::before { content: 'Feedback'; }
      .feedback-row > :nth-child(3)::before { content: 'Source'; }
      .feedback-row > :nth-child(4)::before { content: 'Date'; }
      .feedback-row > :nth-child(5)::before { content: 'Staff / Service'; }
      .feedback-row > :nth-child(6)::before { content: 'Reply / Action'; }

      .feedback-row.header {
        display: none;
      }

      .family-primary-card {
        flex-direction: column;
      }

      .family-member-table {
        min-width: 0;
      }

      .family-member-row,
      .family-member-row.header {
        grid-template-columns: 1fr;
      }

      .family-member-row > :nth-child(1)::before { content: 'Member'; }
      .family-member-row > :nth-child(2)::before { content: 'Relation'; }
      .family-member-row > :nth-child(3)::before { content: 'Phone'; }
      .family-member-row > :nth-child(4)::before { content: 'Shared wallet'; }
      .family-member-row > :nth-child(5)::before { content: 'Communication'; }
      .family-member-row > :nth-child(6)::before { content: 'Action'; }

      .family-member-row.header {
        display: none;
      }

      .client-appointment-table {
        min-width: 0;
      }

      .client-appointment-row,
      .client-appointment-row.header {
        grid-template-columns: 1fr;
      }

      .client-appointment-row > :nth-child(1)::before { content: 'Date / Time'; }
      .client-appointment-row > :nth-child(2)::before { content: 'Service'; }
      .client-appointment-row > :nth-child(3)::before { content: 'Staff'; }
      .client-appointment-row > :nth-child(4)::before { content: 'Status'; }
      .client-appointment-row > :nth-child(5)::before { content: 'Source'; }
      .client-appointment-row > :nth-child(6)::before { content: 'Amount'; }
      .client-appointment-row > :nth-child(7)::before { content: 'Action'; }

      .client-appointment-row.header {
        display: none;
      }
    }
  `]
})
export class ClientDetailComponent implements OnInit {
  readonly client = signal<ApiRecord | null>(null);
  readonly clients = signal<ApiRecord[]>([]);
  readonly family = signal<ApiRecord | null>(null);
  readonly invoices = signal<ApiRecord[]>([]);
  readonly sales = signal<ApiRecord[]>([]);
  readonly payments = signal<ApiRecord[]>([]);
  readonly appointments = signal<ApiRecord[]>([]);
  readonly walletTransactions = signal<ApiRecord[]>([]);
  readonly packages = signal<ApiRecord[]>([]);
  readonly memberships = signal<ApiRecord[]>([]);
  readonly staff = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly profileSaving = signal(false);
  readonly profileMessage = signal('');
  readonly invoiceMessage = signal('');
  readonly notesSaving = signal(false);
  readonly notesMessage = signal('');
  readonly personalSaving = signal(false);
  readonly personalMessage = signal('');
  readonly profileDetailsEditing = signal(false);
  readonly activeHistoryTab = signal('overview');
  @ViewChild('notesPanel') private notesPanel?: ElementRef<HTMLElement>;
  @ViewChild('frontDeskNotesBox') private frontDeskNotesBox?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('internalNotesBox') private internalNotesBox?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('followUpNotesBox') private followUpNotesBox?: ElementRef<HTMLTextAreaElement>;
  readonly appointmentStatusOptions = ['booked', 'completed', 'cancelled', 'rescheduled', 'no-show'];
  readonly historyTabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'sales', label: 'Sales / Bills' },
    { id: 'products', label: 'Products' },
    { id: 'appointments', label: 'Appointments' },
    { id: 'packages', label: 'Packages' },
    { id: 'memberships', label: 'Memberships' },
    { id: 'wallet', label: 'Wallet / E-wallet' },
    { id: 'notes', label: 'Notes' },
    { id: 'treatments', label: 'Treatments / Consultation' },
    { id: 'documents', label: 'Documents / Consent' },
    { id: 'feedback', label: 'Feedback' },
    { id: 'family', label: 'Family' },
    { id: 'personal', label: 'Personal Details' }
  ];
  notes = '';
  frontDeskNotes = '';
  internalNotes = '';
  followUpNotes = '';
  personalDetails: ClientPersonalDetailsForm = this.emptyPersonalDetailsForm();
  salesDateFrom = '';
  salesDateTo = '';
  salesStaffFilter = '';
  salesStatusFilter = '';
  salesItemFilter = '';
  salesBranchFilter = '';
  walletDateFrom = '';
  walletDateTo = '';
  walletTypeFilter = '';
  walletStaffFilter = '';
  appointmentDateFrom = '';
  appointmentDateTo = '';
  appointmentStaffFilter = '';
  appointmentStatusFilter = '';
  appointmentBranchFilter = '';
  beautyProfile: ClientBeautyProfileForm = this.emptyBeautyProfile();
  familyMemberId = '';
  familyRelationship = 'child';
  familyConsolidate = true;

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly state: AppStateService,
    private readonly session: AuthSessionService
  ) {}

  ngOnInit(): void {
    const requestedTab = this.route.snapshot.queryParamMap.get('tab') || '';
    if (this.isHistoryTab(requestedTab)) this.activeHistoryTab.set(requestedTab);
    this.load();
  }

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  selectHistoryTab(tabId: string, noteFocus?: ClientNoteFocus): void {
    if (!this.isHistoryTab(tabId)) return;
    this.activeHistoryTab.set(tabId);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tabId === 'overview' ? null : tabId },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    if (tabId === 'notes') this.openNotesPage(noteFocus);
  }

  focusNoteField(target: ClientNoteFocus): void {
    this.selectHistoryTab('notes', target);
  }

  startProfileDetailsEdit(client: ApiRecord): void {
    this.personalDetails = this.personalDetailsFormFromClient(client);
    this.profileDetailsEditing.set(true);
  }

  cancelProfileDetailsEdit(client: ApiRecord): void {
    this.personalDetails = this.personalDetailsFormFromClient(client);
    this.profileDetailsEditing.set(false);
  }

  activeHistoryTabLabel(): string {
    return this.historyTabs.find((tab) => tab.id === this.activeHistoryTab())?.label || 'Client History';
  }

  activeTabStateTitle(): string {
    if (this.activeTabHasData()) return 'History ready';
    return 'No data yet';
  }

  activeTabNextAction(): string {
    const actions: Record<string, string> = {
      overview: 'Review next best action, health score, warnings and recent activity.',
      sales: 'Create an invoice or receive pending due from the Smart Actions panel.',
      products: 'Review product purchase memory and open POS for product refill or follow-up.',
      appointments: 'Book Again to create the next visit for this client.',
      packages: 'Sell a prepaid package from POS to begin tracking sessions and redemptions.',
      memberships: 'Sell or assign a membership to track credits, expiry and benefits.',
      wallet: 'Open POS to add wallet credit, advance, refund or due received entries.',
      notes: 'Add front desk, internal or follow-up notes and save them to the client profile.',
      treatments: 'Update the beauty profile and save consultation details before the next service.',
      documents: 'Attach or collect signed consent forms before chemical or high-risk services.',
      feedback: 'Request feedback after the next completed service and link it to staff/service.',
      family: 'Link an existing client as a family member to share communication rules.',
      personal: 'Keep profile identity, tags and communication preference current.'
    };
    return actions[this.activeHistoryTab()] || 'Use Smart Actions to continue client care.';
  }

  private activeTabHasData(): boolean {
    const client = this.client();
    switch (this.activeHistoryTab()) {
      case 'overview':
        return !!client;
      case 'sales':
        return this.filteredClientInvoices().length > 0;
      case 'products':
        return this.clientProductRows().length > 0;
      case 'appointments':
        return this.filteredClientAppointments().length > 0;
      case 'packages':
        return this.clientPackageHistoryRows().length > 0;
      case 'memberships':
        return this.clientMembershipHistoryRows().length > 0;
      case 'wallet':
        return this.filteredClientWalletLedgerRows().length > 0;
      case 'notes':
        return !!(this.frontDeskNotes || this.internalNotes || this.followUpNotes || this.clientAppointmentNoteHistory().length || (client && this.clientNoteHistory(client).length));
      case 'treatments':
        return !!(client && this.clientConsultationHistory(client).length);
      case 'documents':
        return !!(client && this.consentHistory(client).length);
      case 'feedback':
        return !!(client && this.feedbackHistory(client).length);
      case 'family': {
        const tree = this.family();
        return !!(tree && this.familyMembers(tree).length);
      }
      case 'personal':
        return !!client;
      default:
        return false;
    }
  }

  load(): void {
    this.loading.set(true);
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.error.set('');
    forkJoin({
      client: this.api.get<ApiRecord>('clients', id),
      clients: this.safeList('clients', { limit: 1000 }),
      invoices: this.safeList('invoices', { limit: 1000 }),
      sales: this.safeList('sales', { limit: 1000 }),
      payments: this.safeList('payments', { limit: 1000 }),
      appointments: this.safeList('appointments', { limit: 1000 }),
      walletTransactions: this.safeList('walletTransactions', { limit: 1000 }),
      packages: this.safeList('packages', { limit: 1000 }),
      memberships: this.safeList('memberships', { limit: 1000 }),
      staff: this.safeList('staff', { limit: 1000 })
    }).subscribe({
      next: ({ client, clients, invoices, sales, payments, appointments, walletTransactions, packages, memberships, staff }) => {
        this.client.set(client);
        this.clients.set(clients || []);
        this.invoices.set(invoices || []);
        this.sales.set(sales || []);
        this.payments.set(payments || []);
        this.appointments.set(appointments || []);
        this.walletTransactions.set(walletTransactions || []);
        this.packages.set(packages || []);
        this.memberships.set(memberships || []);
        this.staff.set(staff || []);
        const noteForm = this.noteFormFromClient(client);
        this.notes = noteForm.notes;
        this.frontDeskNotes = noteForm.frontDeskNotes;
        this.internalNotes = noteForm.internalNotes;
        this.followUpNotes = noteForm.followUpNotes;
        this.beautyProfile = this.profileFormFromClient(client);
        this.personalDetails = this.personalDetailsFormFromClient(client);
        this.profileMessage.set('');
        this.notesMessage.set('');
        this.personalMessage.set('');
        this.loadFamily(client.id);
        this.loading.set(false);
        if (this.activeHistoryTab() === 'notes') this.openNotesPage();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load client profile');
        this.loading.set(false);
      }
    });
  }

  private safeList(resource: string, params: ApiRecord = {}) {
    return this.api.list<ApiRecord[]>(resource, params).pipe(catchError(() => of([] as ApiRecord[])));
  }

  private isHistoryTab(tabId: string): boolean {
    return this.historyTabs.some((tab) => tab.id === tabId);
  }

  private openNotesPage(noteFocus: ClientNoteFocus = 'frontDesk'): void {
    window.setTimeout(() => {
      this.notesPanel?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.noteFieldElement(noteFocus)?.focus();
    });
  }

  private noteFieldElement(noteFocus: ClientNoteFocus): HTMLTextAreaElement | undefined {
    const fields: Record<ClientNoteFocus, ElementRef<HTMLTextAreaElement> | undefined> = {
      frontDesk: this.frontDeskNotesBox,
      internal: this.internalNotesBox,
      followUp: this.followUpNotesBox
    };
    return fields[noteFocus]?.nativeElement;
  }

  trackApiRecord(_: number, item: ApiRecord): string {
    return String(item.id || item._id || item.uuid || item.invoiceNumber || item.invoice_no || item.clientId || item.name || _);
  }

  trackValue(_: number, value: unknown): string {
    return String(value ?? _);
  }

  trackHistoryRow(index: number, item: ApiRecord | ClientPackageRow | ClientMembershipRow | ClientWalletLedgerRow | ClientPackageRedemption | ClientNoteHistoryRow | ClientConsultationHistoryRow): string {
    const row = item as ApiRecord;
    return String(row.id || row.invoiceNumber || row.date || row.purchaseDate || row.startDate || row.treatmentDate || row.name || row.service || row.note || index);
  }

  saveNotes(): void {
    const client = this.client();
    if (!client) return;
    this.notesSaving.set(true);
    this.notesMessage.set('');
    const notes = this.combinedClientNotes();
    this.api.update<ApiRecord>('clients', client.id, { notes }).subscribe({
      next: (updated) => {
        this.notes = notes;
        this.client.set(updated);
        this.notesMessage.set('Notes saved.');
        this.notesSaving.set(false);
      },
      error: (error) => {
        this.notesSaving.set(false);
        this.error.set(error?.error?.error || 'Unable to save notes');
      }
    });
  }

  saveBeautyProfile(): void {
    const client = this.client();
    if (!client) return;
    const existingPreferences = this.readJson(client.preferences);
    const existingSafetyFlags = this.readJson(client.safetyFlags);
    const existingCommunication = this.readJson(client.communicationPreferences);
    const profile = this.beautyProfile;
    const preferences = {
      ...existingPreferences,
      skinType: profile.skinType,
      skinConcerns: profile.skinConcerns,
      hairType: profile.hairType,
      scalpCondition: profile.scalpCondition,
      chemicalHistory: profile.chemicalHistory,
      formulaNotes: profile.formulaNotes,
      nailShadePreference: profile.nailShadePreference,
      nailShapePreference: profile.nailShapePreference,
      preferredStylistId: profile.preferredStylistId,
      preferredServiceNotes: profile.preferredServiceNotes,
      staffConsultationNote: profile.staffConsultationNote,
      beforeAfterNotes: profile.beforeAfterNotes,
      treatmentDate: profile.treatmentDate,
      treatmentStaffId: profile.treatmentStaffId,
      productsUsed: profile.productsUsed,
      productsToAvoid: profile.productsToAvoid,
      brandPreference: profile.brandPreference,
      appointmentPreference: profile.appointmentPreference,
      comfortNotes: profile.comfortNotes,
      lifestyleNotes: profile.lifestyleNotes,
      lastProfileReviewAt: new Date().toISOString()
    };
    const safetyFlags = {
      ...existingSafetyFlags,
      allergySeverity: profile.allergySeverity,
      patchTestDate: profile.patchTestDate,
      patchTestResult: profile.patchTestResult,
      productsToAvoid: profile.productsToAvoid
    };
    const communicationPreferences = {
      ...existingCommunication,
      preferredChannel: profile.preferredChannel,
      preferredLanguage: profile.preferredLanguage,
      appointmentPreference: profile.appointmentPreference
    };

    this.profileSaving.set(true);
    this.error.set('');
    this.profileMessage.set('');
    this.api.update<ApiRecord>('clients', client.id, {
      allergies: this.toList(profile.allergiesText),
      preferences,
      safetyFlags,
      communicationPreferences
    }).subscribe({
      next: (updated) => {
        this.client.set(updated);
        this.beautyProfile = this.profileFormFromClient(updated);
        this.profileSaving.set(false);
        this.error.set('');
        this.profileMessage.set('Client beauty profile saved. POS, booking and AI recommendations can now use these details.');
      },
      error: (error) => {
        this.profileSaving.set(false);
        this.error.set(this.api.errorText(error, 'Unable to save client beauty profile'));
      }
    });
  }

  savePersonalDetails(): void {
    const client = this.client();
    if (!client) return;
    const communicationPreferences = {
      ...this.readJson(client.communicationPreferences),
      preferredChannel: this.personalDetails.communicationPreference
    };
    const payload: ApiRecord = {
      name: this.personalDetails.name,
      phone: this.personalDetails.phone,
      mobile: this.personalDetails.phone,
      email: this.personalDetails.email,
      gender: this.personalDetails.gender,
      birthday: this.personalDetails.birthday,
      anniversary: this.personalDetails.anniversary,
      address: this.personalDetails.address,
      occupation: this.personalDetails.occupation,
      source: this.personalDetails.source,
      referral: this.personalDetails.referral,
      referralSource: this.personalDetails.source,
      tags: this.toList(this.personalDetails.tagsText),
      communicationPreferences
    };
    this.personalSaving.set(true);
    this.personalMessage.set('');
    this.error.set('');
    this.api.update<ApiRecord>('clients', client.id, payload).subscribe({
      next: (updated) => {
        this.client.set(updated);
        this.personalDetails = this.personalDetailsFormFromClient(updated);
        this.personalSaving.set(false);
        this.profileDetailsEditing.set(false);
        this.personalMessage.set('Personal details saved.');
      },
      error: (error) => {
        this.personalSaving.set(false);
        this.error.set(this.api.errorText(error, 'Unable to save personal details'));
      }
    });
  }

  loadClients(): void {
    this.api.list<ApiRecord[]>('clients', { limit: 1000 }).subscribe({
      next: (clients) => this.clients.set(clients || []),
      error: () => undefined
    });
  }

  loadFamily(clientId: string): void {
    this.api.list<ApiRecord>(`clients/${clientId}/family-members`).subscribe({
      next: (family) => this.family.set(family),
      error: () => this.family.set(null)
    });
  }

  linkFamilyMember(clientId: string): void {
    if (!this.familyMemberId) return;
    this.api.post<ApiRecord>(`clients/${clientId}/link-member`, {
      memberCustomerId: this.familyMemberId,
      relationship: this.familyRelationship,
      consolidateCommunications: this.familyConsolidate ? 1 : 0
    }).subscribe({
      next: () => {
        this.familyMemberId = '';
        this.loadFamily(clientId);
      },
      error: (error) => this.error.set(error?.error?.error || 'Unable to link family member')
    });
  }

  unlinkFamilyMember(clientId: string, memberId: string): void {
    this.api.delete<ApiRecord>(`clients/${clientId}/link-member`, memberId).subscribe({
      next: () => this.loadFamily(clientId),
      error: (error) => this.error.set(error?.error?.error || 'Unable to unlink family member')
    });
  }

  familyPrimary(tree: ApiRecord, client: ApiRecord): ApiRecord {
    const primary = tree.primary ? this.readJson(tree.primary) : {};
    return Object.keys(primary).length ? primary : client;
  }

  familyMembers(tree: ApiRecord): ApiRecord[] {
    const members = tree.members || tree.familyMembers || tree.linkedMembers;
    return Array.isArray(members) ? members : [];
  }

  familyRelationLabel(member: ApiRecord): string {
    return this.titleText(member.relationship || member.relation || member.familyRelation || 'Member');
  }

  sharedWalletLabel(member: ApiRecord): string {
    const value = member.sharedWallet ?? member.shareWallet ?? member.walletShared ?? member.consolidateWallet;
    if (value === true || value === 1 || value === '1' || value === 'true') return 'Shared wallet';
    return 'Separate wallet';
  }

  familyCommunicationLabel(member: ApiRecord): string {
    const consolidated = member.consolidateCommunications ?? member.communicationConsolidated ?? member.sharedCommunication;
    if (consolidated === true || consolidated === 1 || consolidated === '1' || consolidated === 'true') return 'Consolidated to primary';
    return 'Direct communication';
  }

  initials(name: string): string {
    return String(name || '?').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  }

  clientTags(client: ApiRecord): string[] {
    if (Array.isArray(client.tags)) return client.tags.filter(Boolean);
    if (typeof client.tags === 'string') {
      return client.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
    }
    return [];
  }

  profileSummary(client: ApiRecord, key: string): string {
    const preferences = this.readJson(client.preferences);
    const safetyFlags = this.readJson(client.safetyFlags);
    const communication = this.readJson(client.communicationPreferences);
    if (key === 'allergies') {
      const allergies = this.readList(client.allergies);
      return allergies.length ? allergies.slice(0, 3).join(', ') : 'None captured';
    }
    if (key === 'patchTest') {
      const result = String(safetyFlags.patchTestResult || '').replace(/_/g, ' ');
      const date = safetyFlags.patchTestDate ? this.dateLabel(safetyFlags.patchTestDate) : '';
      return result || date ? [result || 'Recorded', date].filter(Boolean).join(' Â· ') : 'Not tested';
    }
    if (key === 'preferredChannel') {
      return this.titleText(communication.preferredChannel || 'Default');
    }
    const value = preferences[key];
    return value ? this.shortValue(value) : 'Not set';
  }

  preferredStylistName(client: ApiRecord): string {
    const preferredStylistId = String(this.readJson(client.preferences).preferredStylistId || '');
    if (preferredStylistId) return this.staffName(preferredStylistId);
    return this.preferredStaffLabel();
  }

  clientCaptureSuggestions(): Array<{ title: string; reason: string }> {
    const client = this.client();
    if (!client) return [];
    const preferences = this.readJson(client.preferences);
    const safetyFlags = this.readJson(client.safetyFlags);
    const communication = this.readJson(client.communicationPreferences);
    const suggestions = [
      {
        done: this.readList(client.allergies).length > 0,
        title: 'Capture allergies before chemical services',
        reason: 'Hair color, bleach, wax, peel and facial services need allergy safety context.'
      },
      {
        done: !!preferences.skinType,
        title: 'Add skin type and concerns',
        reason: 'Facial recommendations, retail upsell and consent warnings become more accurate.'
      },
      {
        done: !!preferences.hairType && !!preferences.chemicalHistory,
        title: 'Record hair type and chemical history',
        reason: 'Staff can avoid repeat consultation and choose safer color/keratin formulas.'
      },
      {
        done: !!preferences.productsUsed,
        title: 'Save product and formula memory',
        reason: 'Next visit can repeat exact shade, shampoo, facial kit or nail color faster.'
      },
      {
        done: !!preferences.preferredStylistId,
        title: 'Set preferred stylist',
        reason: 'Booking and POS can guide assignment to the right staff member.'
      },
      {
        done: !!safetyFlags.patchTestDate || safetyFlags.patchTestResult === 'passed',
        title: 'Update patch test status',
        reason: 'Front desk can check safety before color, bleach and other sensitive services.'
      },
      {
        done: !!communication.preferredChannel,
        title: 'Choose communication channel',
        reason: 'WhatsApp, call, SMS, language and DND preferences reduce friction.'
      }
    ];
    const open = suggestions.filter((item) => !item.done);
    return (open.length ? open : suggestions).slice(0, 5);
  }

  loyaltyPoints(client: ApiRecord): number {
    return this.moneyValue(client.loyaltyPoints || client.loyalty || 0);
  }

  walletBalance(client: ApiRecord): number {
    const entries = this.clientWalletTransactions();
    const latest = entries[0];
    const live = latest ? this.walletEntryBalance(latest) : undefined;
    return this.moneyValue(live ?? client.walletBalance ?? client.wallet ?? 0);
  }

  clientSales(): ApiRecord[] {
    const id = this.client()?.id;
    if (!id) return [];
    return this.sales().filter((sale) => String(sale.clientId || sale.client_id || sale.customerId || sale.customer_id || '') === String(id));
  }

  clientInvoices(): ApiRecord[] {
    const id = this.client()?.id;
    if (!id) return [];
    const saleIds = new Set(this.clientSales().map((sale) => String(sale.id)));
    return this.invoices()
      .filter((invoice) => String(invoice.clientId || invoice.client_id || invoice.customerId || invoice.customer_id || '') === String(id) || saleIds.has(String(invoice.saleId || invoice.sale_id || '')))
      .sort((a, b) => this.dateMs(b.createdAt || b.date) - this.dateMs(a.createdAt || a.date));
  }

  filteredClientInvoices(): ApiRecord[] {
    const from = this.salesDateFrom ? this.dateMs(this.salesDateFrom) : 0;
    const to = this.salesDateTo ? this.dateMs(`${this.salesDateTo}T23:59:59`) : Number.POSITIVE_INFINITY;
    return this.clientInvoices().filter((invoice) => {
      const invoiceTime = this.dateMs(invoice.createdAt || invoice.created_at || invoice.date);
      const staffId = this.invoiceStaffId(invoice);
      const status = this.invoiceStatusLabel(invoice).toLowerCase();
      const itemText = this.invoiceSummary(invoice).toLowerCase();
      const branchId = this.invoiceBranchKey(invoice);
      return invoiceTime >= from
        && invoiceTime <= to
        && (!this.salesStaffFilter || staffId === this.salesStaffFilter)
        && (!this.salesStatusFilter || status === this.salesStatusFilter)
        && (!this.salesItemFilter || itemText.includes(this.salesItemFilter.toLowerCase()))
        && (!this.salesBranchFilter || branchId === this.salesBranchFilter);
    });
  }

  invoiceStatusOptions(): string[] {
    return [...new Set(this.clientInvoices().map((invoice) => this.invoiceStatusLabel(invoice).toLowerCase()).filter(Boolean))];
  }

  invoiceItemOptions(): string[] {
    const options = new Set<string>();
    for (const invoice of this.clientInvoices()) {
      this.invoiceItemNames(invoice).forEach((item) => options.add(item));
    }
    return [...options].sort((a, b) => a.localeCompare(b));
  }

  invoiceBranchOptions(): Array<{ id: string; name: string }> {
    const options = new Map<string, string>();
    for (const invoice of this.clientInvoices()) {
      const id = this.invoiceBranchKey(invoice);
      if (!id) continue;
      options.set(id, String(invoice.branchName || invoice.branch_name || id));
    }
    return [...options.entries()].map(([id, name]) => ({ id, name }));
  }

  clientPayments(): ApiRecord[] {
    const invoiceIds = new Set(this.clientInvoices().map((invoice) => String(invoice.id)));
    return this.payments().filter((payment) => invoiceIds.has(String(payment.invoiceId || '')));
  }

  invoiceNumber(invoice: ApiRecord): string {
    return String(invoice.invoiceNumber || invoice.invoice_no || invoice.number || invoice.id || 'Invoice');
  }

  invoiceSummary(invoice: ApiRecord): string {
    const sale = this.saleForInvoice(invoice);
    const summary = this.saleSummary(sale?.id || invoice.saleId || invoice.sale_id || invoice.id);
    if (summary !== 'POS sale') return summary;
    const direct = invoice.items || invoice.lineItems;
    const items = Array.isArray(direct) ? direct : this.readJson(direct).items;
    if (Array.isArray(items) && items.length) {
      const names = items
        .map((item: ApiRecord) => item.name || item.serviceName || item.productName || item.packageName || item.membershipName)
        .filter(Boolean);
      return names.length ? names.slice(0, 3).join(', ') : summary;
    }
    return String(invoice.description || invoice.summary || summary);
  }

  invoiceStaffLabel(invoice: ApiRecord): string {
    const sale = this.saleForInvoice(invoice);
    const staffId = this.invoiceStaffId(invoice);
    return String(invoice.staffName || invoice.staff_name || sale?.staffName || sale?.staff_name || this.staffName(staffId));
  }

  invoicePaymentMode(invoice: ApiRecord): string {
    const direct = invoice.paymentMode || invoice.payment_mode || invoice.mode || invoice.tenderMode;
    if (direct) return this.titleText(direct);
    const modes = this.payments()
      .filter((payment) => String(payment.invoiceId || '') === String(invoice.id))
      .map((payment) => payment.mode || payment.paymentMode || payment.payment_mode || payment.method)
      .filter(Boolean);
    return modes.length ? [...new Set(modes.map((mode) => this.titleText(mode)))].join(', ') : '-';
  }

  invoiceStatusLabel(invoice: ApiRecord): string {
    const explicit = invoice.status || invoice.invoiceStatus || invoice.state;
    if (explicit) return this.titleText(explicit);
    if (this.invoiceBalance(invoice) > 0 && this.invoicePaid(invoice) > 0) return 'Part paid';
    if (this.invoiceBalance(invoice) > 0) return 'Due';
    return 'Paid';
  }

  openInvoice(invoice: ApiRecord): void {
    const invoiceId = String(invoice.id || '').trim();
    if (!invoiceId) return;
    this.router.navigate(['/pos/invoices'], { queryParams: { invoice: invoiceId } });
  }

  receiveDue(invoice: ApiRecord): void {
    const client = this.client();
    this.router.navigate(['/pos'], {
      queryParams: {
        clientId: client?.id || invoice.clientId || invoice.customerId || undefined,
        q: client?.phone || client?.mobile || client?.name || undefined,
        receiveDue: this.invoiceBalance(invoice) || undefined,
        invoiceId: invoice.id || undefined
      }
    });
  }

  printInvoice(invoice: ApiRecord): void {
    const invoiceId = String(invoice.id || '').trim();
    if (!invoiceId) return;
    this.router.navigate(['/pos/invoices'], { queryParams: { invoice: invoiceId, print: 1 } })
      .then(() => setTimeout(() => window.print(), 400));
  }

  sendInvoicePdfWhatsapp(invoice: ApiRecord): void {
    const client = this.client();
    const phone = String(invoice.clientPhone || invoice.phone || client?.phone || client?.mobile || '').replace(/\D/g, '');
    if (!invoice.id || !phone) {
      this.invoiceMessage.set('');
      this.error.set(`Client WhatsApp number missing for ${this.invoiceNumber(invoice)}.`);
      return;
    }
    this.invoiceMessage.set('');
    this.api.post<ApiRecord>(`billing/invoices/${invoice.id}/send-whatsapp`, {
      phone,
      source: 'client-360',
      invoiceKind: this.invoiceKindLabel(invoice),
      paymentStatus: this.invoiceBalance(invoice) > 0 ? 'unpaid' : 'paid',
      walletPaid: this.moneyValue(invoice.walletPaid || invoice.walletPaidAmount || 0)
    }).subscribe({
      next: () => {
        this.error.set('');
        this.invoiceMessage.set(`WhatsApp PDF queued for ${this.invoiceNumber(invoice)}.`);
      },
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to queue WhatsApp PDF'))
    });
  }

  openLatestInvoice(): void {
    const invoice = this.clientInvoices()[0];
    if (invoice) this.openInvoice(invoice);
  }

  printHistory(): void {
    window.print();
  }

  whatsAppLink(client: ApiRecord): string {
    const digits = String(client.phone || client.mobile || '').replace(/\D/g, '');
    const phone = digits.length === 10 ? `91${digits}` : digits;
    return phone ? `https://wa.me/${phone}` : 'https://wa.me/';
  }

  clientWalletTransactions(): ApiRecord[] {
    const id = this.client()?.id;
    if (!id) return [];
    return this.walletTransactions()
      .filter((item) => String(item.clientId || item.customerId || '') === String(id))
      .sort((a, b) => this.dateMs(b.createdAt || b.date) - this.dateMs(a.createdAt || a.date));
  }

  clientWalletLedgerRows(): ClientWalletLedgerRow[] {
    return this.clientWalletTransactions().map((item, index) => ({
      id: String(item.id || item.transactionId || `wallet-${index}`),
      date: this.dateTimeLabel(item.createdAt || item.created_at || item.date || item.postedAt),
      type: this.walletLedgerType(item),
      amount: this.walletLedgerAmount(item),
      balanceAfter: this.walletEntryBalance(item),
      source: this.walletLedgerSource(item),
      staff: this.walletLedgerStaff(item),
      notes: this.walletLedgerNotes(item)
    }));
  }

  filteredClientWalletLedgerRows(): ClientWalletLedgerRow[] {
    const from = this.walletDateFrom ? this.dateMs(this.walletDateFrom) : 0;
    const to = this.walletDateTo ? this.dateMs(`${this.walletDateTo}T23:59:59`) : Number.POSITIVE_INFINITY;
    return this.clientWalletTransactions()
      .filter((item) => {
        const time = this.dateMs(item.createdAt || item.created_at || item.date || item.postedAt);
        const type = this.walletLedgerType(item);
        const staffId = String(item.staffId || item.staff_id || item.userId || item.user_id || item.createdBy || '');
        return time >= from
          && time <= to
          && (!this.walletTypeFilter || type === this.walletTypeFilter)
          && (!this.walletStaffFilter || staffId === this.walletStaffFilter);
      })
      .map((item, index) => ({
        id: String(item.id || item.transactionId || `wallet-${index}`),
        date: this.dateTimeLabel(item.createdAt || item.created_at || item.date || item.postedAt),
        type: this.walletLedgerType(item),
        amount: this.walletLedgerAmount(item),
        balanceAfter: this.walletEntryBalance(item),
        source: this.walletLedgerSource(item),
        staff: this.walletLedgerStaff(item),
        notes: this.walletLedgerNotes(item)
      }));
  }

  walletTypeOptions(): string[] {
    return [...new Set(this.clientWalletTransactions().map((item) => this.walletLedgerType(item)).filter(Boolean))];
  }

  walletLedgerType(item: ApiRecord): string {
    const raw = String(item.type || item.entryType || item.transactionType || item.reason || item.category || '').toLowerCase();
    if (raw.includes('due')) return 'Due received';
    if (raw.includes('refund')) return 'Refund';
    if (raw.includes('advance')) return 'Advance';
    if (raw.includes('debit') || raw.includes('redeem') || raw.includes('used') || raw.includes('payment')) return 'Debit';
    if (raw.includes('credit') || raw.includes('top') || raw.includes('load') || raw.includes('add')) return 'Credit';
    return this.walletLedgerAmount(item) < 0 ? 'Debit' : 'Credit';
  }

  walletLedgerAmount(item: ApiRecord): number {
    const value = this.moneyValue(item.amount ?? item.value ?? item.walletAmount ?? item.credit ?? item.debit ?? 0);
    const type = String(item.type || item.entryType || item.transactionType || '').toLowerCase();
    if (type.includes('debit') || type.includes('redeem') || type.includes('used')) return -Math.abs(value);
    return value;
  }

  walletLedgerSource(item: ApiRecord): string {
    const invoiceId = item.invoiceId || item.invoice_id || item.sourceInvoiceId || item.billId || '';
    const paymentId = item.paymentId || item.payment_id || item.sourcePaymentId || '';
    const invoice = this.clientInvoices().find((entry) => String(entry.id) === String(invoiceId) || String(entry.invoiceNumber) === String(invoiceId));
    if (invoice) return `Invoice ${this.invoiceNumber(invoice)}`;
    if (invoiceId) return `Invoice ${invoiceId}`;
    if (paymentId) return `Payment ${paymentId}`;
    return String(item.source || item.reference || item.referenceNo || item.refNo || item.reason || 'Wallet');
  }

  walletLedgerStaff(item: ApiRecord): string {
    const staffId = item.staffId || item.staff_id || item.userId || item.user_id || item.createdBy || '';
    return String(item.staffName || item.staff_name || item.userName || item.user_name || item.createdByName || this.staffName(staffId));
  }

  walletLedgerNotes(item: ApiRecord): string {
    return String(item.notes || item.note || item.description || item.remarks || item.memo || '-');
  }

  clientAppointments(): ApiRecord[] {
    const id = this.client()?.id;
    if (!id) return [];
    return this.appointments()
      .filter((appointment) => String(appointment.clientId || appointment.customerId || '') === String(id))
      .sort((a, b) => this.dateMs(b.startTime || b.date || b.createdAt) - this.dateMs(a.startTime || a.date || a.createdAt));
  }

  filteredClientAppointments(): ApiRecord[] {
    const from = this.appointmentDateFrom ? this.dateMs(this.appointmentDateFrom) : 0;
    const to = this.appointmentDateTo ? this.dateMs(`${this.appointmentDateTo}T23:59:59`) : Number.POSITIVE_INFINITY;
    return this.clientAppointments().filter((appointment) => {
      const appointmentTime = this.dateMs(appointment.startTime || appointment.start_time || appointment.date || appointment.createdAt);
      const staffId = String(appointment.staffId || appointment.staff_id || appointment.employeeId || '');
      const status = this.appointmentStatusKey(appointment);
      const branchId = this.appointmentBranchKey(appointment);
      return appointmentTime >= from
        && appointmentTime <= to
        && (!this.appointmentStaffFilter || staffId === this.appointmentStaffFilter)
        && (!this.appointmentStatusFilter || status === this.appointmentStatusFilter)
        && (!this.appointmentBranchFilter || branchId === this.appointmentBranchFilter);
    });
  }

  appointmentBranchOptions(): Array<{ id: string; name: string }> {
    const options = new Map<string, string>();
    for (const appointment of this.clientAppointments()) {
      const id = this.appointmentBranchKey(appointment);
      if (!id) continue;
      options.set(id, String(appointment.branchName || appointment.branch_name || id));
    }
    return [...options.entries()].map(([id, name]) => ({ id, name }));
  }

  appointmentServiceLabel(appointment: ApiRecord): string {
    return String(appointment.serviceName || appointment.service_name || appointment.service || appointment.title || appointment.reason || 'Appointment');
  }

  appointmentStaffLabel(appointment: ApiRecord): string {
    const staffId = appointment.staffId || appointment.staff_id || appointment.employeeId || '';
    return String(appointment.staffName || appointment.staff_name || appointment.employeeName || this.staffName(staffId));
  }

  appointmentStatusLabel(appointment: ApiRecord): string {
    return this.titleText(this.appointmentStatusKey(appointment) || 'booked');
  }

  appointmentSourceLabel(appointment: ApiRecord): string {
    const source = String(appointment.source || appointment.bookingSource || appointment.booking_source || appointment.channel || '').toLowerCase();
    if (source.includes('walk')) return 'Walk-in';
    if (source.includes('phone') || source.includes('call')) return 'Phone';
    if (source.includes('market')) return 'Marketplace';
    if (source.includes('whatsapp') || source.includes('wa')) return 'WhatsApp';
    if (source.includes('online') || source.includes('web') || source.includes('app')) return 'Online';
    return source ? this.titleText(source) : 'Walk-in';
  }

  appointmentAmount(appointment: ApiRecord): number {
    return this.moneyValue(appointment.amount ?? appointment.total ?? appointment.totalAmount ?? appointment.price ?? appointment.serviceAmount ?? 0);
  }

  bookAgain(appointment: ApiRecord): void {
    const client = this.client();
    this.router.navigate(['/appointments'], {
      queryParams: {
        clientId: client?.id || appointment.clientId || appointment.customerId || undefined,
        staffId: appointment.staffId || appointment.staff_id || appointment.employeeId || undefined,
        serviceId: appointment.serviceId || appointment.service_id || undefined,
        source: 'client-360'
      }
    });
  }

  clientTips(): ApiRecord[] {
    return this.clientSales().flatMap((sale) => {
      const redeem = this.readJson(sale.membershipRedeem);
      const tips = Array.isArray(redeem?.tips) ? redeem.tips : [];
      return tips.map((tip: ApiRecord) => ({ ...tip, saleId: sale.id }));
    });
  }

  clientPackageRows(): ClientLedgerRow[] {
    const saleRows = this.clientSales().flatMap((sale) => this.saleItems(sale)
      .filter((item) => this.itemKind(item) === 'package')
      .map((item) => ({
        name: String(item.packageName || item.name || item.serviceName || 'Package sale'),
        date: this.dateLabel(sale.createdAt || sale.date),
        amount: this.itemAmount(item),
        status: String(sale.status || item.status || 'Sold'),
        meta: `Invoice ${sale.invoiceNumber || sale.invoiceId || sale.id || 'POS'}`
      })));
    const knownPackageIds = new Set(saleRows.map((row) => row.name.toLowerCase()));
    const definitionRows = this.packages()
      .filter((item) => this.packageBelongsToClient(item))
      .map((item) => ({
        name: String(item.name || item.packageName || 'Package'),
        date: this.dateLabel(item.createdAt || item.startDate || item.purchaseDate || item.date),
        amount: this.moneyValue(item.price ?? item.amount ?? item.saleAmount ?? 0),
        status: String(item.status || 'Linked'),
        meta: `${item.validityDays || item.remainingSessions || item.balanceSessions || '-'} ${item.remainingSessions || item.balanceSessions ? 'session(s)' : 'validity days'}`
      }))
      .filter((row) => !knownPackageIds.has(row.name.toLowerCase()));
    return [...saleRows, ...definitionRows];
  }

  clientPackageHistoryRows(): ClientPackageRow[] {
    const membershipRows = this.memberships()
      .filter((item) => this.membershipBelongsToClient(item) && this.membershipBenefitType(item) === 'package')
      .map((item, index) => this.packageHistoryRow(item, undefined, `membership-package-${item.id || index}`));
    const membershipKnown = new Set(membershipRows.map((row) => this.packageHistoryKey(row)));
    const saleRows = this.clientSales().flatMap((sale) => this.saleItems(sale)
      .filter((item) => this.itemKind(item) === 'package')
      .map((item, index) => this.packageHistoryRow(item, sale, `sale-${sale.id || sale.invoiceId || index}-${index}`)))
      .filter((row) => !membershipKnown.has(this.packageHistoryKey(row)));
    const known = new Set([...membershipRows, ...saleRows].map((row) => this.packageHistoryKey(row)));
    const linkedRows = this.packages()
      .filter((item) => this.packageBelongsToClient(item))
      .map((item, index) => this.packageHistoryRow(item, undefined, `package-${item.id || index}`))
      .filter((row) => !known.has(this.packageHistoryKey(row)));
    return [...membershipRows, ...saleRows, ...linkedRows];
  }

  private packageHistoryRow(item: ApiRecord, sale: ApiRecord | undefined, fallbackId: string): ClientPackageRow {
    const totalSessions = this.packageTotalSessions(item);
    const usedSessions = this.packageUsedSessions(item, totalSessions);
    const balanceSessions = this.packageBalanceSessions(item, totalSessions, usedSessions);
    const purchaseDate = this.dateLabel(sale?.createdAt || sale?.date || item.purchaseDate || item.startDate || item.createdAt || item.date);
    const expiryDate = this.dateLabel(item.expiryDate || item.expiresAt || item.validTill || item.validityDate || sale?.expiryDate);
    return {
      id: String(item.id || item.packageId || sale?.id || fallbackId),
      name: String(item.packageName || item.name || item.serviceName || 'Package sale'),
      purchaseDate,
      expiryDate,
      totalSessions,
      usedSessions,
      balanceSessions,
      value: this.itemAmount(item) || this.moneyValue(item.price ?? item.amount ?? item.saleAmount ?? sale?.total ?? 0),
      status: this.packageStatusLabel(item, balanceSessions, expiryDate, sale),
      redemptions: this.packageRedemptionHistory(item, sale)
    };
  }

  packageHistoryEyebrow(row: ClientPackageRow): string {
    if (row.status === 'Active') return 'Active package';
    if (row.status === 'Expired') return 'Expired package';
    if (row.status === 'Fully Used') return 'Package fully used';
    return 'Package purchased';
  }

  private packageHistoryKey(row: ClientPackageRow): string {
    return `${row.name.toLowerCase()}|${row.purchaseDate}|${row.expiryDate}|${row.totalSessions}|${row.balanceSessions}`;
  }

  private packageTotalSessions(item: ApiRecord): number {
    const direct = this.packageSessionValue(item, ['totalSessions', 'sessionCount', 'sessions', 'credits', 'planCredits', 'plan_credits', 'quantity', 'qty']);
    if (direct > 0) return direct;
    const credits = this.packageServiceCredits(item);
    return credits.reduce((sum, credit) => sum + this.moneyValue(credit.credits ?? credit.quantity ?? credit.total ?? credit.remaining ?? credit.creditsRemaining ?? 0), 0);
  }

  private packageUsedSessions(item: ApiRecord, totalSessions: number): number {
    const direct = this.packageSessionValue(item, ['usedSessions', 'redeemedSessions', 'consumedSessions', 'used']);
    if (direct > 0) return direct;
    const balance = this.packageBalanceSessions(item, totalSessions, 0);
    return Math.max(0, totalSessions - balance);
  }

  private packageSessionValue(item: ApiRecord, keys: string[]): number {
    for (const key of keys) {
      const value = Number(item[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return 0;
  }

  private packageBalanceSessions(item: ApiRecord, totalSessions: number, usedSessions: number): number {
    const direct = this.packageSessionValue(item, ['balanceSessions', 'remainingSessions', 'remaining', 'balance', 'creditsRemaining', 'credits_remaining']);
    if (direct > 0) return direct;
    const credits = this.packageServiceCredits(item);
    if (credits.length) {
      return credits.reduce((sum, credit) => sum + this.moneyValue(credit.remaining ?? credit.creditsRemaining ?? credit.credits_remaining ?? credit.credits ?? credit.quantity ?? 0), 0);
    }
    return Math.max(totalSessions - usedSessions, 0);
  }

  private packageStatusLabel(item: ApiRecord, balanceSessions: number, expiryDate: string, sale?: ApiRecord): string {
    const explicit = String(item.status || item.packageStatus || '').trim().toLowerCase();
    if (['expired', 'cancelled', 'inactive'].includes(explicit)) return 'Expired';
    const expiry = Date.parse(expiryDate);
    if (Number.isFinite(expiry) && expiry < Date.now()) return 'Expired';
    if (balanceSessions > 0) return 'Active';
    if (balanceSessions === 0 && this.packageTotalSessions(item) > 0) return 'Fully Used';
    if (explicit && !['completed', 'paid', 'sold'].includes(explicit)) return this.titleText(explicit);
    return 'Active';
  }

  private packageServiceCredits(item: ApiRecord): ApiRecord[] {
    return [
      ...this.readRecordList(item.serviceCredits || item.service_credits),
      ...this.readRecordList(item.packageCredits || item.package_credits)
    ];
  }

  private membershipBenefitType(item: ApiRecord): 'membership' | 'package' {
    const history = this.readRecordList(item.redeemHistory || item.redemptionHistory);
    if (history.some((entry) => String(entry.type || '').includes('package') || entry.packageId)) return 'package';
    if (String(item.planName || item.name || '').trim().toLowerCase().startsWith('package:')) return 'package';
    if (this.packageServiceCredits(item).some((credit) => credit.packageId || credit.package_id)) return 'package';
    return 'membership';
  }

  private packageRedemptionHistory(item: ApiRecord, sale?: ApiRecord): ClientPackageRedemption[] {
    const raw = [
      ...this.readRecordList(item.redemptions || item.redeemHistory || item.redemptionHistory || item.usageHistory),
      ...this.readRecordList(sale?.packageRedemptions || sale?.redemptions)
    ];
    return raw.map((entry, index) => {
      const redemption = typeof entry === 'object' && entry ? entry : { name: entry };
      const staffId = redemption.staffId || redemption.staff_id || redemption.employeeId || '';
      return {
        date: this.dateLabel(redemption.date || redemption.usedAt || redemption.createdAt || sale?.createdAt),
        service: String(redemption.serviceName || redemption.name || redemption.packageName || `Redemption ${index + 1}`),
        staff: String(redemption.staffName || redemption.staff_name || this.staffName(staffId) || 'Staff not assigned'),
        amount: this.moneyValue(redemption.amount ?? redemption.value ?? redemption.saleAmount ?? 0),
        status: this.titleText(redemption.status || redemption.state || 'Redeemed')
      };
    });
  }

  clientMembershipRows(): ClientLedgerRow[] {
    const id = String(this.client()?.id || '');
    const linked = this.memberships()
      .filter((item) => String(item.clientId || item.customerId || '') === id || String(item.id || '') === String(this.client()?.membershipId || this.client()?.membership_id || ''))
      .map((item) => ({
        name: String(item.planName || item.membershipName || item.name || 'Membership'),
        date: this.dateLabel(item.startDate || item.createdAt || item.purchaseDate || item.date),
        amount: this.moneyValue(item.price ?? item.amount ?? item.saleAmount ?? item.paidAmount ?? 0),
        status: String(item.status || item.membershipStatus || 'Active'),
        meta: `Valid till ${this.dateLabel(item.endDate || item.validityDate || item.expiresAt || item.expiryDate)}`
      }));
    const sales = this.clientSales().flatMap((sale) => this.saleItems(sale)
      .filter((item) => this.itemKind(item) === 'membership')
      .map((item) => ({
        name: String(item.membershipName || item.name || 'Membership sale'),
        date: this.dateLabel(sale.createdAt || sale.date),
        amount: this.itemAmount(item),
        status: String(sale.status || item.status || 'Sold'),
        meta: `Invoice ${sale.invoiceNumber || sale.invoiceId || sale.id || 'POS'}`
      })));
    return [...linked, ...sales];
  }

  clientMembershipHistoryRows(): ClientMembershipRow[] {
    const client = this.client();
    const linkedRows = this.memberships()
      .filter((item) => this.membershipBelongsToClient(item))
      .map((item, index) => this.membershipHistoryRow(item, undefined, `membership-${item.id || index}`));
    const saleRows = this.clientSales().flatMap((sale) => this.saleItems(sale)
      .filter((item) => this.itemKind(item) === 'membership')
      .map((item, index) => this.membershipHistoryRow(item, sale, `sale-membership-${sale.id || sale.invoiceId || index}-${index}`)));
    const profileRow = client && (client.membershipId || client.membership_id || client.membershipName || client.membershipStatus)
      ? [this.membershipHistoryRow(client, undefined, `profile-membership-${client.membershipId || client.membership_id || client.id || 'active'}`)]
      : [];
    const rows = [...linkedRows, ...saleRows, ...profileRow];
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = `${row.id}-${row.name}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private membershipHistoryRow(item: ApiRecord, sale: ApiRecord | undefined, fallbackId: string): ClientMembershipRow {
    const credits = this.membershipCreditValue(item, ['credits', 'membershipCredits', 'totalCredits', 'creditLimit', 'sessions', 'visits', 'benefitCredits']);
    const creditsUsed = this.membershipCreditValue(item, ['creditsUsed', 'membershipCreditsUsed', 'usedCredits', 'redeemedCredits', 'consumedCredits', 'used']);
    const creditsBalance = this.membershipBalanceCredits(item, credits, creditsUsed);
    const expiryDate = this.dateLabel(item.membershipExpiryDate || item.membershipExpiresAt || item.endDate || item.expiryDate || item.expiresAt || item.validTill || item.validityDate || sale?.expiryDate);
    return {
      id: String(item.membershipId || item.membership_id || item.id || sale?.membershipId || fallbackId),
      name: String(item.membershipName || item.planName || item.name || item.title || 'Membership'),
      startDate: this.dateLabel(sale?.createdAt || sale?.date || item.membershipStartDate || item.startDate || item.purchaseDate || item.createdAt || item.date),
      expiryDate,
      credits,
      creditsUsed,
      creditsBalance,
      saleAmount: this.itemAmount(item) || this.moneyValue(item.price ?? item.amount ?? item.saleAmount ?? item.paidAmount ?? sale?.total ?? 0),
      status: this.membershipStatusBadge(item, creditsBalance, expiryDate, sale),
      redemptions: this.membershipRedemptionHistory(item, sale)
    };
  }

  private membershipCreditValue(item: ApiRecord, keys: string[]): number {
    for (const key of keys) {
      const value = Number(item[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return 0;
  }

  private membershipBalanceCredits(item: ApiRecord, credits: number, creditsUsed: number): number {
    const direct = this.membershipCreditValue(item, ['creditsBalance', 'balanceCredits', 'remainingCredits', 'remaining', 'balance']);
    if (direct > 0) return direct;
    return Math.max(credits - creditsUsed, 0);
  }

  private membershipStatusBadge(item: ApiRecord, creditsBalance: number, expiryDate: string, sale?: ApiRecord): string {
    const explicit = String(item.membershipStatus || item.status || sale?.status || '').trim();
    if (explicit) return this.titleText(explicit);
    const expiry = Date.parse(expiryDate);
    if (Number.isFinite(expiry) && expiry < Date.now()) return 'Expired';
    if (creditsBalance === 0 && this.membershipCreditValue(item, ['credits', 'totalCredits', 'creditLimit']) > 0) return 'Fully Used';
    return 'Active';
  }

  private membershipRedemptionHistory(item: ApiRecord, sale?: ApiRecord): ClientPackageRedemption[] {
    const redeem = this.readJson(sale?.membershipRedeem);
    const raw = [
      ...this.readRecordList(item.redemptions || item.redemptionHistory || item.usageHistory || item.benefitHistory),
      ...this.readRecordList(sale?.membershipRedemptions || sale?.redemptions),
      ...this.readRecordList(redeem.items || redeem.services || redeem.benefits)
    ];
    return raw.map((entry, index) => {
      const staffId = entry.staffId || entry.staff_id || entry.employeeId || '';
      return {
        date: this.dateLabel(entry.date || entry.usedAt || entry.createdAt || sale?.createdAt),
        service: String(entry.serviceName || entry.benefitName || entry.name || entry.membershipName || `Redemption ${index + 1}`),
        staff: String(entry.staffName || entry.staff_name || this.staffName(staffId) || 'Staff not assigned'),
        amount: this.moneyValue(entry.amount ?? entry.value ?? entry.discountAmount ?? entry.saleAmount ?? 0),
        status: this.titleText(entry.status || entry.state || 'Redeemed')
      };
    });
  }

  dueInvoices(): ApiRecord[] {
    return this.clientInvoices().filter((invoice) => this.invoiceBalance(invoice) > 0);
  }

  totalBilled(): number {
    return this.clientInvoices().reduce((sum, invoice) => sum + this.invoiceTotal(invoice), 0);
  }

  totalPaid(): number {
    return this.clientInvoices().reduce((sum, invoice) => sum + this.invoicePaid(invoice), 0);
  }

  totalTips(): number {
    return this.clientTips().reduce((sum, tip) => sum + this.moneyValue(tip.amount), 0);
  }

  totalDue(): number {
    return this.clientInvoices().reduce((sum, invoice) => sum + this.invoiceBalance(invoice), 0);
  }

  latestInvoiceLabel(): string {
    const invoice = this.clientInvoices()[0];
    if (!invoice) return 'No POS invoice';
    return String(invoice.invoiceNumber || invoice.id || 'POS invoice');
  }

  averageBill(): number {
    const invoices = this.clientInvoices();
    if (!invoices.length) return 0;
    return this.totalBilled() / invoices.length;
  }

  totalVisits(): number {
    return Math.max(this.clientAppointments().length, this.clientInvoices().length);
  }

  serviceSalesTotal(): number {
    return this.clientSales().reduce((sum, sale) => {
      return sum + this.saleItems(sale)
        .filter((item) => this.itemKind(item) === 'service')
        .reduce((itemSum, item) => itemSum + this.itemAmount(item), 0);
    }, 0);
  }

  productSalesTotal(): number {
    return this.clientProductRows().reduce((sum, row) => sum + this.moneyValue(row['total']), 0);
  }

  clientProductRows(): ApiRecord[] {
    const rows = new Map<string, ApiRecord>();
    for (const entry of this.clientProductLineItems()) {
      for (const item of [entry['item'] as ApiRecord].filter((record) => this.itemKind(record) === 'product')) {
        const name = String(item.productName || item.name || item.itemName || 'Product').trim();
        const sku = String(item.sku || item.barcode || item.productCode || item.code || '-');
        const key = `${name}|${sku}`;
        const existing = rows.get(key);
        const quantity = this.moneyValue(item.quantity ?? item.qty ?? 1) || 1;
        const gross = this.moneyValue(entry['gross'] || this.itemGross(item));
        const discount = this.moneyValue(entry['discount']);
        const total = Math.max(0, this.moneyValue(gross - discount));
        const current = existing || {
          id: key,
          name,
          sku,
          qty: 0,
          gross: 0,
          discount: 0,
          total: 0,
          lastBought: '-',
          lastBoughtMs: 0,
          invoice: 'POS sale',
          staff: 'Unassigned'
        };
        current['qty'] = this.moneyValue(current['qty']) + quantity;
        current['gross'] = this.moneyValue(current['gross']) + gross;
        current['discount'] = this.moneyValue(current['discount']) + discount;
        current['total'] = this.moneyValue(current['total']) + total;
        const time = this.dateMs(entry['date']);
        if (time >= Number(current['lastBoughtMs'] || 0)) {
          current['lastBoughtMs'] = time;
          current['lastBought'] = this.dateLabel(entry['date']);
          current['invoice'] = entry['invoice'];
          current['staff'] = entry['staff'];
        }
        rows.set(key, current);
      }
    }
    return [...rows.values()]
      .map((row): ApiRecord => ({
        ...row,
        qty: this.moneyValue(row['qty']),
        gross: this.moneyValue(row['gross']),
        discount: this.moneyValue(row['discount']),
        total: this.moneyValue(row['total'])
      }))
      .sort((a, b) => Number(b['lastBoughtMs'] || 0) - Number(a['lastBoughtMs'] || 0));
  }

  packageSalesTotal(): number {
    return this.clientSales().reduce((sum, sale) => {
      return sum + this.saleItems(sale)
        .filter((item) => this.itemKind(item) === 'package')
        .reduce((itemSum, item) => itemSum + this.itemAmount(item), 0);
    }, 0);
  }

  membershipSalesTotal(): number {
    return this.clientSales().reduce((sum, sale) => {
      return sum + this.saleItems(sale)
        .filter((item) => this.itemKind(item) === 'membership')
        .reduce((itemSum, item) => itemSum + this.itemAmount(item), 0);
    }, 0);
  }

  bookedAppointments(): number {
    return this.clientAppointments().filter((appointment) => {
      const status = this.appointmentStatus(appointment);
      return !status || status.includes('book') || status.includes('schedule');
    }).length;
  }

  completedAppointments(): number {
    return this.clientAppointments().filter((appointment) => {
      const status = this.appointmentStatus(appointment);
      return status.includes('complete') || status.includes('paid') || status.includes('checkout');
    }).length;
  }

  cancelledAppointments(): number {
    return this.clientAppointments().filter((appointment) => this.appointmentStatus(appointment).includes('cancel')).length;
  }

  rescheduledAppointments(): number {
    return this.clientAppointments().filter((appointment) => {
      const status = this.appointmentStatus(appointment);
      return status.includes('reschedule') || status.includes('moved');
    }).length;
  }

  noShowAppointments(): number {
    return this.clientAppointments().filter((appointment) => {
      const status = this.appointmentStatus(appointment);
      return status.includes('no-show') || status.includes('noshow') || status.includes('no show');
    }).length;
  }

  clientTypeLabel(client: ApiRecord): string {
    if (this.totalDue() > 0) return 'Due pending';
    if (this.clientHealthScore() >= 85) return 'VIP / healthy';
    if (this.daysSinceLastVisit() > 60) return 'Inactive';
    if (client.membershipId || client.membership_id) return 'Member';
    return 'Regular';
  }

  membershipStatusLabel(client: ApiRecord): string {
    return String(
      client.membershipStatus ||
      client.membershipName ||
      client.membershipId ||
      client.membership_id ||
      'No membership'
    );
  }

  clientSourceLabel(client: ApiRecord): string {
    return String(
      client.source ||
      client.referralSource ||
      client.referral ||
      client.createdFrom ||
      client.leadSource ||
      'Not captured'
    );
  }

  feedbackHistory(client: ApiRecord): ApiRecord[] {
    const direct = client.feedback || client.feedbackHistory || client.reviews || client.reviewHistory;
    if (Array.isArray(direct)) return direct;
    const parsed = this.readJson(direct);
    return Array.isArray(parsed.items) ? parsed.items : [];
  }

  feedbackRating(item: ApiRecord): string {
    const rating = item.rating ?? item.score ?? item.stars ?? item.nps;
    if (rating === undefined || rating === null || rating === '') return 'Feedback';
    return `${rating}/5`;
  }

  feedbackText(item: ApiRecord): string {
    return String(item.comment || item.message || item.note || item.feedbackText || item.review || 'No feedback text');
  }

  feedbackSource(item: ApiRecord): string {
    return this.titleText(item.source || item.reviewSource || item.channel || item.platform || 'Salon');
  }

  feedbackDate(item: ApiRecord): string {
    return this.dateTimeLabel(item.date || item.createdAt || item.created_at || item.submittedAt || item.reviewedAt);
  }

  feedbackLinkedContext(item: ApiRecord): string {
    const staffId = item.staffId || item.staff_id || item.employeeId || '';
    const staff = item.staffName || item.staff_name || this.staffName(staffId);
    const service = item.serviceName || item.service || item.appointmentService || item.invoiceService || '';
    if (service && staff && staff !== 'Unassigned') return `${service} Â· ${staff}`;
    if (service) return String(service);
    if (staff && staff !== 'Unassigned') return String(staff);
    return 'Not linked';
  }

  feedbackActionLabel(item: ApiRecord): string {
    return String(item.reply || item.response || item.actionLabel || item.action || '').trim() ? 'View reply' : 'Reply';
  }

  feedbackActionUrl(item: ApiRecord): string {
    return String(item.replyUrl || item.actionUrl || item.reviewUrl || item.url || '').trim();
  }

  consentHistory(client: ApiRecord): ApiRecord[] {
    const direct = client.consentForms || client.consents || client.documents || client.forms;
    if (Array.isArray(direct)) return direct;
    const parsed = this.readJson(direct);
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed.items) ? parsed.items : [];
  }

  consentDocumentName(form: ApiRecord): string {
    return String(form.name || form.title || form.formName || form.documentName || form.fileName || 'Consent form');
  }

  consentSignedDate(form: ApiRecord): string {
    return this.dateTimeLabel(form.signedAt || form.signed_at || form.createdAt || form.created_at || form.date);
  }

  consentStatus(form: ApiRecord): string {
    return this.titleText(form.status || form.formStatus || form.signatureStatus || 'Signed');
  }

  consentDocumentUrl(form: ApiRecord): string {
    return String(form.viewUrl || form.url || form.documentUrl || form.fileUrl || form.publicUrl || '').trim();
  }

  consentDownloadUrl(form: ApiRecord): string {
    return String(form.downloadUrl || form.pdfUrl || form.documentUrl || form.fileUrl || form.url || '').trim();
  }

  invoiceTotal(invoice: ApiRecord): number {
    return this.moneyValue(invoice.total ?? invoice.grandTotal ?? invoice.grand_total ?? invoice.amount ?? 0);
  }

  invoicePaid(invoice: ApiRecord): number {
    const direct = invoice.paid ?? invoice.paidAmount ?? invoice.paid_amount ?? invoice.collected;
    if (direct !== undefined && direct !== null) return this.moneyValue(direct);
    return this.payments()
      .filter((payment) => String(payment.invoiceId || '') === String(invoice.id))
      .reduce((sum, payment) => sum + this.moneyValue(payment.amount), 0);
  }

  invoiceBalance(invoice: ApiRecord): number {
    const direct = invoice.balance ?? invoice.due ?? invoice.due_amount ?? invoice.balanceDue;
    if (direct !== undefined && direct !== null) return Math.max(0, this.moneyValue(direct));
    return Math.max(0, this.invoiceTotal(invoice) - this.invoicePaid(invoice));
  }

  clientHealthScore(): number {
    let score = 100;
    if (this.totalDue() > 0) score -= 25;
    if (this.daysSinceLastVisit() > 60) score -= 20;
    if (this.clientTags(this.client() || {}).some((tag) => tag.toLowerCase().includes('dnd'))) score -= 10;
    if (!this.readList(this.client()?.allergies).length) score -= 5;
    if (!this.readJson(this.client()?.preferences).skinType && !this.readJson(this.client()?.preferences).hairType) score -= 5;
    if (!this.clientAppointments().length && !this.clientInvoices().length) score -= 10;
    return Math.max(0, Math.min(100, score));
  }

  clientRiskLevel(): string {
    if (this.totalDue() > 0) return 'Payment follow-up';
    if (this.daysSinceLastVisit() > 60) return 'Reactivation';
    if (this.clientTags(this.client() || {}).some((tag) => tag.toLowerCase().includes('dnd'))) return 'DND careful';
    return 'Healthy';
  }

  nextBestAction(): string {
    if (this.totalDue() > 0) return 'Collect or settle pending balance';
    if (!this.readList(this.client()?.allergies).length) return 'Capture allergy and patch-test safety';
    if (!this.readJson(this.client()?.preferences).skinType && !this.readJson(this.client()?.preferences).hairType) return 'Complete beauty profile';
    if (this.walletBalance(this.client() || {}) > 0) return 'Offer wallet redemption on next invoice';
    if (this.daysSinceLastVisit() > 60) return 'Send reactivation follow-up';
    if (!this.client()?.membershipId) return 'Offer membership during checkout';
    return 'Book the next appointment';
  }

  nextBestReason(): string {
    if (this.totalDue() > 0) return 'Client has unpaid invoice balance, so front desk should resolve dues before new credit.';
    if (!this.readList(this.client()?.allergies).length) return 'Allergy and patch-test details reduce risk before color, wax, bleach, peel and facial services.';
    if (!this.readJson(this.client()?.preferences).skinType && !this.readJson(this.client()?.preferences).hairType) return 'Skin, hair and product preferences help staff prepare before the service starts.';
    if (this.walletBalance(this.client() || {}) > 0) return 'Client has wallet credit available and can redeem it in POS.';
    if (this.daysSinceLastVisit() > 60) return 'Client has not visited recently based on saved invoice and appointment dates.';
    if (!this.client()?.membershipId) return 'Client does not have an active membership recorded on profile.';
    return 'Client is active, so the safest growth action is a confirmed next visit.';
  }

  dueWarningLabel(): string {
    const due = this.totalDue();
    if (due <= 0) return 'No due pending';
    return `${this.dueInvoices().length} invoice(s) pending`;
  }

  reactivationWarningLabel(): string {
    const days = this.daysSinceLastVisit();
    if (days > 180) return 'High reactivation risk';
    if (days > 60) return 'Inactive - follow-up needed';
    if (days > 30) return 'Cooling down';
    return 'Active recently';
  }

  allergyPatchWarningLabel(client: ApiRecord): string {
    const allergies = this.profileSummary(client, 'allergies');
    const patch = this.profileSummary(client, 'patchTest');
    if (allergies === 'None captured' && patch === 'Not tested') return 'Allergy and patch test missing';
    if (allergies === 'None captured') return 'Allergy details missing';
    if (patch === 'Not tested') return 'Patch test missing';
    return 'Safety profile captured';
  }

  preferredStaffLabel(): string {
    const preferredStylistId = String(this.readJson(this.client()?.preferences).preferredStylistId || '');
    if (preferredStylistId) return this.staffName(preferredStylistId);
    const counts = new Map<string, number>();
    for (const sale of this.clientSales()) {
      const staffId = String(sale.staffId || '');
      if (!staffId) continue;
      counts.set(staffId, (counts.get(staffId) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? this.staffName(best[0]) : 'Not enough history';
  }

  topServiceLabel(): string {
    const counts = new Map<string, number>();
    for (const sale of this.clientSales()) {
      for (const item of this.saleItems(sale)) {
        const name = String(item.name || item.serviceName || item.productName || item.type || '').trim();
        if (!name) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Not enough history';
  }

  firstVisitLabel(client: ApiRecord): string {
    const dates = [
      client.firstVisit,
      client.firstVisitDate,
      ...this.clientInvoices().map((invoice) => invoice.createdAt || invoice.date),
      ...this.clientAppointments().map((appointment) => appointment.startTime || appointment.date || appointment.createdAt)
    ].filter(Boolean);
    const oldest = dates.sort((a, b) => this.dateMs(a) - this.dateMs(b))[0];
    return oldest ? this.dateLabel(oldest) : '-';
  }

  lastVisitLabel(): string {
    const dates = [
      ...this.clientInvoices().map((invoice) => invoice.createdAt || invoice.date),
      ...this.clientAppointments().map((appointment) => appointment.startTime || appointment.date || appointment.createdAt)
    ].filter(Boolean);
    const latest = dates.sort((a, b) => this.dateMs(b) - this.dateMs(a))[0];
    return latest ? this.dateLabel(latest) : 'New';
  }

  visitFrequencyLabel(): string {
    const count = Math.max(this.clientAppointments().length, this.clientInvoices().length);
    if (!count) return 'No visit rhythm yet';
    if (count === 1) return 'One recorded visit';
    return `${count} recorded touchpoints`;
  }

  liveVisitHistory(client: ApiRecord): ApiRecord[] {
    const invoiceVisits = this.clientInvoices().map((invoice) => ({
      date: this.dateLabel(invoice.createdAt || invoice.date),
      saleId: invoice.invoiceNumber || invoice.id,
      services: this.saleSummary(invoice.saleId)
    }));
    return [...invoiceVisits, ...(client.visitHistory || [])];
  }

  livePurchaseHistory(client: ApiRecord): ApiRecord[] {
    const purchases = this.clientInvoices().map((invoice) => ({
      invoice: invoice.invoiceNumber || invoice.id,
      amount: this.invoiceTotal(invoice)
    }));
    return [...purchases, ...(client.purchaseHistory || [])];
  }

  clientNoteHistory(client: ApiRecord): ClientNoteHistoryRow[] {
    const appointmentNotes = this.clientAppointmentNoteHistory();
    const history = this.readRecordList(client.noteHistory || client.notesHistory || client.notesLog || client.interactions)
      .map((item) => ({
        date: this.dateTimeLabel(item.date || item.createdAt || item.created_at || item.updatedAt),
        type: this.titleText(item.type || item.category || item.kind || 'Note'),
        author: String(item.author || item.userName || item.createdByName || item.staffName || 'AuraShine OS'),
        note: String(item.note || item.notes || item.message || item.text || item.comment || '-')
      }));
    const current = this.combinedClientNotes().trim() || String(client.notes || '').trim();
    const currentRow = current ? [{
      date: this.dateTimeLabel(client.updatedAt || client.updated_at || client.createdAt),
      type: 'Current Notes',
      author: 'Client profile',
      note: current
    }] : [];
    return [...appointmentNotes, ...history, ...currentRow];
  }

  private clientAppointmentNoteHistory(): ClientNoteHistoryRow[] {
    return this.clientAppointments()
      .filter((appointment) => String(appointment.notes || appointment.note || '').trim())
      .map((appointment) => ({
        date: this.dateTimeLabel(appointment.startAt || appointment.startTime || appointment.start_time || appointment.date || appointment.createdAt),
        type: 'Appointment Note',
        author: this.appointmentStaffLabel(appointment),
        note: String(appointment.notes || appointment.note || '').trim()
      }));
  }

  clientConsultationHistory(client: ApiRecord): ClientConsultationHistoryRow[] {
    const preferences = this.readJson(client.preferences);
    const safetyFlags = this.readJson(client.safetyFlags);
    const history = this.readRecordList(client.consultationHistory || client.treatmentHistory || client.beautyProfileHistory || preferences.consultationHistory)
      .map((item) => this.consultationHistoryRow(item, preferences, safetyFlags));
    if (history.length) return history;
    const hasCurrentProfile = [
      preferences.skinType,
      preferences.hairType,
      preferences.scalpCondition,
      preferences.chemicalHistory,
      preferences.formulaNotes,
      preferences.productsUsed,
      safetyFlags.patchTestDate,
      this.readList(client.allergies).join(', ')
    ].some(Boolean);
    return hasCurrentProfile ? [this.consultationHistoryRow({
      treatmentDate: preferences.treatmentDate || preferences.lastProfileReviewAt || client.updatedAt || client.createdAt,
      treatmentStaffId: preferences.treatmentStaffId || preferences.preferredStylistId,
      skinType: preferences.skinType,
      hairType: preferences.hairType,
      scalpCondition: preferences.scalpCondition,
      allergy: this.readList(client.allergies).join(', '),
      patchTestDate: safetyFlags.patchTestDate,
      patchTestResult: safetyFlags.patchTestResult,
      chemicalHistory: preferences.chemicalHistory,
      formulaNotes: preferences.formulaNotes,
      productsUsed: preferences.productsUsed,
      productsToAvoid: preferences.productsToAvoid || safetyFlags.productsToAvoid,
      staffConsultationNote: preferences.staffConsultationNote || preferences.preferredServiceNotes,
      beforeAfterNotes: preferences.beforeAfterNotes
    }, preferences, safetyFlags)] : [];
  }

  private consultationHistoryRow(item: ApiRecord, preferences: ApiRecord, safetyFlags: ApiRecord): ClientConsultationHistoryRow {
    const staffId = item.treatmentStaffId || item.staffId || item.staff_id || item.employeeId || preferences.treatmentStaffId || '';
    const patchDate = item.patchTestDate || safetyFlags.patchTestDate;
    const patchResult = item.patchTestResult || safetyFlags.patchTestResult;
    return {
      treatmentDate: this.dateLabel(item.treatmentDate || item.date || item.createdAt || item.created_at || preferences.treatmentDate),
      treatmentStaff: String(item.treatmentStaff || item.staffName || item.staff_name || this.staffName(staffId)),
      skinType: String(item.skinType || preferences.skinType || '-'),
      hairType: String(item.hairType || preferences.hairType || '-'),
      scalpCondition: String(item.scalpCondition || preferences.scalpCondition || '-'),
      allergy: String(item.allergy || item.allergies || '-'),
      patchTest: `${patchDate ? this.dateLabel(patchDate) : '-'}${patchResult ? ` Â· ${this.titleText(patchResult)}` : ''}`,
      chemicalHistory: String(item.chemicalHistory || preferences.chemicalHistory || '-'),
      formulaNotes: String(item.formulaNotes || preferences.formulaNotes || '-'),
      productsUsed: String(item.productsUsed || preferences.productsUsed || '-'),
      productsToAvoid: String(item.productsToAvoid || preferences.productsToAvoid || safetyFlags.productsToAvoid || '-'),
      staffConsultationNote: String(item.staffConsultationNote || item.consultationNote || preferences.staffConsultationNote || preferences.preferredServiceNotes || '-'),
      beforeAfterNotes: String(item.beforeAfterNotes || item.beforeAfter || preferences.beforeAfterNotes || '-')
    };
  }

  whatsAppFollowUpSummary(client: ApiRecord): string {
    const pieces = [
      `Hi ${client.name || 'there'}, this is AuraShine.`,
      `Last visit: ${this.lastVisitLabel()}.`,
      this.totalDue() > 0 ? `Pending due: ${this.totalDue()}.` : '',
      this.walletBalance(client) > 0 ? `Wallet balance available: ${this.walletBalance(client)}.` : '',
      this.followUpNotes.trim() ? `Follow-up: ${this.followUpNotes.trim()}` : `Recommended next service: ${this.topServiceLabel()}.`
    ].filter(Boolean);
    return pieces.join(' ');
  }

  whatsAppFollowUpLink(client: ApiRecord): string {
    const base = this.whatsAppLink(client);
    return `${base}?text=${encodeURIComponent(this.whatsAppFollowUpSummary(client))}`;
  }

  private noteFormFromClient(client: ApiRecord): { notes: string; frontDeskNotes: string; internalNotes: string; followUpNotes: string } {
    const notes = String(client.notes || '');
    const frontDeskNotes = this.sectionFromNotes(notes, 'Front desk notes') || notes;
    return {
      notes,
      frontDeskNotes,
      internalNotes: this.sectionFromNotes(notes, 'Internal notes'),
      followUpNotes: this.sectionFromNotes(notes, 'Follow-up notes')
    };
  }

  private combinedClientNotes(): string {
    return [
      ['Front desk notes', this.frontDeskNotes],
      ['Internal notes', this.internalNotes],
      ['Follow-up notes', this.followUpNotes]
    ]
      .filter(([, value]) => String(value || '').trim())
      .map(([label, value]) => `${label}:\n${String(value).trim()}`)
      .join('\n\n');
  }

  private sectionFromNotes(notes: string, label: string): string {
    const pattern = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n\\n(?:Front desk notes|Internal notes|Follow-up notes):|$)`, 'i');
    return notes.match(pattern)?.[1]?.trim() || '';
  }

  staffName(id: unknown): string {
    return this.staff().find((staff) => String(staff.id) === String(id))?.name || 'Unassigned';
  }

  walletEntryBalance(item: ApiRecord): number {
    return this.moneyValue(item.balanceAfter ?? item.balance ?? item.walletBalance ?? item.amount ?? 0);
  }

  moneyValue(value: unknown): number {
    const parsed = Number(String(value ?? 0).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  dateLabel(value: unknown): string {
    if (!value) return '-';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  dateInputValue(value: unknown): string {
    if (!value) return '';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return date.toISOString().slice(0, 10);
  }

  dateTimeLabel(value: unknown): string {
    if (!value) return '-';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private daysSinceLastVisit(): number {
    const dates = [
      ...this.clientInvoices().map((invoice) => invoice.createdAt || invoice.date),
      ...this.clientAppointments().map((appointment) => appointment.startTime || appointment.date || appointment.createdAt)
    ].filter(Boolean);
    const latest = dates.sort((a, b) => this.dateMs(b) - this.dateMs(a))[0];
    if (!latest) return 999;
    return Math.floor((Date.now() - this.dateMs(latest)) / 86400000);
  }

  private dateMs(value: unknown): number {
    const time = new Date(String(value || '')).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  private readJson(value: unknown): ApiRecord {
    if (!value) return {};
    if (typeof value === 'object') return value as ApiRecord;
    try {
      return JSON.parse(String(value));
    } catch {
      return {};
    }
  }

  private readList(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean);
      } catch {
        // Plain comma/newline text is also accepted.
      }
      return this.toList(value);
    }
    return [];
  }

  private readRecordList(value: unknown): ApiRecord[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((item) => typeof item === 'object' && item ? item as ApiRecord : { name: item });
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return this.readRecordList(parsed);
      } catch {
        return this.toList(value).map((name) => ({ name }));
      }
    }
    return [];
  }

  private toList(value: unknown): string[] {
    return String(value || '')
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private emptyBeautyProfile(): ClientBeautyProfileForm {
    return {
      allergiesText: '',
      allergySeverity: '',
      skinType: '',
      skinConcerns: '',
      hairType: '',
      scalpCondition: '',
      chemicalHistory: '',
      formulaNotes: '',
      nailShadePreference: '',
      nailShapePreference: '',
      preferredStylistId: '',
      preferredServiceNotes: '',
      staffConsultationNote: '',
      beforeAfterNotes: '',
      treatmentDate: '',
      treatmentStaffId: '',
      productsUsed: '',
      productsToAvoid: '',
      brandPreference: '',
      patchTestDate: '',
      patchTestResult: '',
      appointmentPreference: '',
      preferredChannel: '',
      preferredLanguage: '',
      comfortNotes: '',
      lifestyleNotes: ''
    };
  }

  private profileFormFromClient(client: ApiRecord): ClientBeautyProfileForm {
    const preferences = this.readJson(client.preferences);
    const safetyFlags = this.readJson(client.safetyFlags);
    const communication = this.readJson(client.communicationPreferences);
    return {
      allergiesText: this.readList(client.allergies).join(', '),
      allergySeverity: String(safetyFlags.allergySeverity || ''),
      skinType: String(preferences.skinType || ''),
      skinConcerns: String(preferences.skinConcerns || ''),
      hairType: String(preferences.hairType || ''),
      scalpCondition: String(preferences.scalpCondition || ''),
      chemicalHistory: String(preferences.chemicalHistory || ''),
      formulaNotes: String(preferences.formulaNotes || ''),
      nailShadePreference: String(preferences.nailShadePreference || ''),
      nailShapePreference: String(preferences.nailShapePreference || ''),
      preferredStylistId: String(preferences.preferredStylistId || ''),
      preferredServiceNotes: String(preferences.preferredServiceNotes || ''),
      staffConsultationNote: String(preferences.staffConsultationNote || ''),
      beforeAfterNotes: String(preferences.beforeAfterNotes || ''),
      treatmentDate: String(preferences.treatmentDate || ''),
      treatmentStaffId: String(preferences.treatmentStaffId || ''),
      productsUsed: String(preferences.productsUsed || ''),
      productsToAvoid: String(preferences.productsToAvoid || safetyFlags.productsToAvoid || ''),
      brandPreference: String(preferences.brandPreference || ''),
      patchTestDate: String(safetyFlags.patchTestDate || ''),
      patchTestResult: String(safetyFlags.patchTestResult || ''),
      appointmentPreference: String(preferences.appointmentPreference || communication.appointmentPreference || ''),
      preferredChannel: String(communication.preferredChannel || ''),
      preferredLanguage: String(communication.preferredLanguage || ''),
      comfortNotes: String(preferences.comfortNotes || ''),
      lifestyleNotes: String(preferences.lifestyleNotes || '')
    };
  }

  private emptyPersonalDetailsForm(): ClientPersonalDetailsForm {
    return {
      name: '',
      phone: '',
      email: '',
      gender: '',
      birthday: '',
      anniversary: '',
      address: '',
      occupation: '',
      source: '',
      referral: '',
      tagsText: '',
      communicationPreference: ''
    };
  }

  private personalDetailsFormFromClient(client: ApiRecord): ClientPersonalDetailsForm {
    const communication = this.readJson(client.communicationPreferences);
    return {
      name: String(client.name || ''),
      phone: String(client.phone || client.mobile || ''),
      email: String(client.email || ''),
      gender: String(client.gender || ''),
      birthday: this.dateInputValue(client.birthday),
      anniversary: this.dateInputValue(client.anniversary),
      address: String(client.address || client.fullAddress || ''),
      occupation: String(client.occupation || client.profession || ''),
      source: String(client.source || client.referralSource || client.leadSource || ''),
      referral: String(client.referral || client.referredBy || client.referrerName || ''),
      tagsText: this.clientTags(client).join(', '),
      communicationPreference: String(communication.preferredChannel || client.communicationPreference || '')
    };
  }

  private shortValue(value: unknown): string {
    const text = String(value || '').trim();
    return text.length > 36 ? `${text.slice(0, 34)}...` : text;
  }

  titleText(value: unknown): string {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private saleItems(sale: ApiRecord): ApiRecord[] {
    const items = sale.items;
    if (Array.isArray(items)) return items;
    if (typeof items === 'string') {
      try {
        const parsed = JSON.parse(items);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private clientProductLineItems(): ApiRecord[] {
    const rows: ApiRecord[] = [];
    const invoicesWithSaleItems = new Set<string>();
    for (const sale of this.clientSales()) {
      const invoice = this.invoiceForSale(sale);
      const saleItems = this.saleItems(sale);
      const productItems = saleItems.filter((item) => this.itemKind(item) === 'product');
      const grossTotal = this.itemGrossTotal(saleItems);
      const discountTotal = this.recordDiscount(sale);
      if (invoice && productItems.length) invoicesWithSaleItems.add(String(invoice.id || ''));
      for (const item of productItems) {
        const gross = this.itemGross(item);
        rows.push({
          item,
          gross,
          discount: this.itemDiscount(item, gross, grossTotal, discountTotal),
          date: sale.createdAt || sale.created_at || sale.date || sale.updatedAt,
          invoice: invoice ? this.invoiceNumber(invoice) : String(sale.invoiceNumber || sale.invoice_no || sale.id || 'POS sale'),
          staff: String(item.staffName || item.staff_name || sale.staffName || sale.staff_name || this.staffName(item.staffId || item.staff_id || sale.staffId || sale.staff_id || ''))
        });
      }
    }
    for (const invoice of this.clientInvoices()) {
      if (invoicesWithSaleItems.has(String(invoice.id || ''))) continue;
      const invoiceItems = this.invoiceItems(invoice);
      const grossTotal = this.itemGrossTotal(invoiceItems);
      const discountTotal = this.recordDiscount(invoice);
      for (const item of invoiceItems.filter((entry) => this.itemKind(entry) === 'product')) {
        const gross = this.itemGross(item);
        rows.push({
          item,
          gross,
          discount: this.itemDiscount(item, gross, grossTotal, discountTotal),
          date: invoice.createdAt || invoice.created_at || invoice.date || invoice.updatedAt,
          invoice: this.invoiceNumber(invoice),
          staff: String(item.staffName || item.staff_name || invoice.staffName || invoice.staff_name || this.staffName(item.staffId || item.staff_id || this.invoiceStaffId(invoice)))
        });
      }
    }
    return rows;
  }

  saleSummary(saleId: unknown): string {
    const sale = this.sales().find((item) => String(item.id) === String(saleId));
    if (!sale) return 'POS sale';
    const names = this.saleItems(sale).map((item) => item.name || item.serviceName || item.productName).filter(Boolean);
    return names.length ? names.slice(0, 3).join(', ') : 'POS sale';
  }

  private saleForInvoice(invoice: ApiRecord): ApiRecord | undefined {
    const saleId = String(invoice.saleId || invoice.sale_id || '');
    if (saleId) return this.sales().find((sale) => String(sale.id) === saleId);
    return this.sales().find((sale) => String(sale.invoiceId || sale.invoice_id || sale.invoiceNumber || '') === String(invoice.id || invoice.invoiceNumber || ''));
  }

  private invoiceForSale(sale: ApiRecord): ApiRecord | undefined {
    const saleId = String(sale.id || '');
    return this.clientInvoices().find((invoice) => String(invoice.saleId || invoice.sale_id || '') === saleId ||
      String(invoice.id || '') === String(sale.invoiceId || sale.invoice_id || '') ||
      String(invoice.invoiceNumber || invoice.invoice_no || '') === String(sale.invoiceNumber || sale.invoice_no || ''));
  }

  private invoiceItemNames(invoice: ApiRecord): string[] {
    const sale = this.saleForInvoice(invoice);
    const saleItems = sale ? this.saleItems(sale) : [];
    const items = saleItems.length ? saleItems : this.invoiceItems(invoice);
    const names = items
      .map((item: ApiRecord) => item.name || item.serviceName || item.productName || item.packageName || item.membershipName)
      .filter(Boolean)
      .map((item: unknown) => String(item));
    return names.length ? names : [this.invoiceSummary(invoice)].filter((item) => item && item !== 'POS sale');
  }

  private invoiceItems(invoice: ApiRecord): ApiRecord[] {
    const direct = invoice.items || invoice.lineItems || invoice.line_items || invoice.itemLines || invoice.item_lines;
    if (Array.isArray(direct)) return direct as ApiRecord[];
    if (typeof direct === 'string') {
      try {
        const parsed = JSON.parse(direct);
        if (Array.isArray(parsed)) return parsed as ApiRecord[];
        if (parsed && typeof parsed === 'object') {
          return this.readRecordList((parsed as ApiRecord)['items'] || (parsed as ApiRecord)['lineItems'] || (parsed as ApiRecord)['line_items']);
        }
      } catch {
        return [];
      }
    }
    if (direct && typeof direct === 'object') {
      const record = direct as ApiRecord;
      return this.readRecordList(record['items'] || record['lineItems'] || record['line_items']);
    }
    return [];
  }

  private invoiceStaffId(invoice: ApiRecord): string {
    const sale = this.saleForInvoice(invoice);
    return String(invoice.staffId || invoice.staff_id || invoice.employeeId || sale?.staffId || sale?.staff_id || '');
  }

  private invoiceBranchKey(invoice: ApiRecord): string {
    const sale = this.saleForInvoice(invoice);
    return String(invoice.branchId || invoice.branch_id || sale?.branchId || sale?.branch_id || '');
  }

  private invoiceKindLabel(invoice: ApiRecord): string {
    const sale = this.saleForInvoice(invoice);
    const items = sale ? this.saleItems(sale) : [];
    if (items.some((item) => this.itemKind(item) === 'product')) return 'product';
    if (this.moneyValue(invoice.walletPaid || invoice.walletPaidAmount || 0) > 0) return 'wallet';
    return 'service';
  }

  private appointmentStatus(appointment: ApiRecord): string {
    return String(appointment.status || appointment.appointmentStatus || appointment.state || '').toLowerCase();
  }

  private appointmentStatusKey(appointment: ApiRecord): string {
    const status = this.appointmentStatus(appointment);
    if (status.includes('complete') || status.includes('paid') || status.includes('checkout')) return 'completed';
    if (status.includes('cancel')) return 'cancelled';
    if (status.includes('reschedule') || status.includes('moved')) return 'rescheduled';
    if (status.includes('no-show') || status.includes('noshow') || status.includes('no show')) return 'no-show';
    return 'booked';
  }

  private appointmentBranchKey(appointment: ApiRecord): string {
    return String(appointment.branchId || appointment.branch_id || appointment.locationId || appointment.location_id || '');
  }

  private itemKind(item: ApiRecord): string {
    const raw = String(item.type || item.itemType || item.kind || item.category || '').toLowerCase();
    const name = String(item.name || item.serviceName || item.productName || item.packageName || item.membershipName || '').toLowerCase();
    if (raw.includes('package') || name.includes('package') || item.packageId) return 'package';
    if (raw.includes('membership') || name.includes('membership') || item.membershipId) return 'membership';
    if (raw.includes('product') || item.productId || item.productName || item.sku) return 'product';
    return 'service';
  }

  private itemAmount(item: ApiRecord): number {
    const direct = item.total ?? item.lineTotal ?? item.line_total ?? item.finalAmount ?? item.final_amount ?? item.amount ?? item.netAmount ?? item.net_amount ?? item.subtotal;
    if (direct !== undefined && direct !== null && direct !== '') return this.moneyValue(direct);
    const unit = this.moneyValue(item.price ?? item.rate ?? item.unitPrice ?? item.unit_price ?? item.sellingPrice ?? item.selling_price ?? 0);
    const qty = this.moneyValue(item.quantity ?? item.qty ?? 1) || 1;
    return this.moneyValue(unit * qty);
  }

  private itemGross(item: ApiRecord): number {
    const direct = item.gross ?? item.grossAmount ?? item.gross_amount ?? item.subtotal ?? item.lineSubtotal ?? item.line_subtotal;
    if (direct !== undefined && direct !== null && direct !== '') return this.moneyValue(direct);
    const unit = this.moneyValue(item.price ?? item.rate ?? item.unitPrice ?? item.unit_price ?? item.sellingPrice ?? item.selling_price ?? item.mrp ?? 0);
    const qty = this.moneyValue(item.quantity ?? item.qty ?? 1) || 1;
    return this.moneyValue(unit * qty);
  }

  private itemGrossTotal(items: ApiRecord[]): number {
    return this.moneyValue(items.reduce((sum, item) => sum + this.itemGross(item), 0));
  }

  private itemDiscount(item: ApiRecord, gross: number, sourceGross: number, sourceDiscount: number): number {
    const direct = item.discount ?? item.discountAmount ?? item.discount_amount ?? item.manualDiscount ?? item.manual_discount ?? item.lineDiscount ?? item.line_discount;
    if (direct !== undefined && direct !== null && direct !== '') return this.moneyValue(direct);
    if (sourceDiscount <= 0 || sourceGross <= 0 || gross <= 0) return 0;
    return this.moneyValue((gross / sourceGross) * sourceDiscount);
  }

  private recordDiscount(record: ApiRecord): number {
    return this.moneyValue(record.discount ?? record.discountAmount ?? record.discount_amount ?? record.discountTotal ?? record.discount_total ?? record.totalDiscount ?? record.total_discount ?? record.manualDiscount ?? record.manual_discount ?? 0);
  }

  private packageBelongsToClient(item: ApiRecord): boolean {
    const id = String(this.client()?.id || '');
    if (!id) return false;
    return String(item.clientId || item.customerId || '') === id || this.readList(item.clientIds || item.customerIds).includes(id);
  }

  private membershipBelongsToClient(item: ApiRecord): boolean {
    const client = this.client();
    const id = String(client?.id || '');
    if (!id) return false;
    return String(item.clientId || item.customerId || '') === id ||
      String(item.id || '') === String(client?.membershipId || client?.membership_id || '') ||
      this.readList(item.clientIds || item.customerIds).includes(id);
  }
}
