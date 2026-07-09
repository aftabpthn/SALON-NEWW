import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';

type BookingSettingsState = {
  bookingControl: {
    onlineBooking: boolean;
    walkInBooking: boolean;
    allowClientStaffSelect: boolean;
    sameDayBooking: boolean;
    autoConfirmBooking: boolean;
    riskyBookingOwnerApproval: boolean;
  };
  slotRules: {
    slotDurationMinutes: number;
    minimumAdvanceHours: number;
    maximumFutureDays: number;
    bufferMinutes: number;
    allowOverlapBooking: boolean;
    previousTimeSlotVisibility: boolean;
  };
  cancellationReschedule: {
    allowCancellation: boolean;
    cancellationUntilHours: number;
    allowReschedule: boolean;
    rescheduleUntilHours: number;
    noShowAutoMark: boolean;
    lateChangeOwnerApproval: boolean;
  };
  depositPayment: {
    depositRequired: boolean;
    depositType: string;
    depositValue: number;
    payLaterAllowed: boolean;
    riskyClientOnlinePayment: boolean;
    depositRefundRule: string;
  };
  clientRules: {
    newClientBookingAllowed: boolean;
    blockedClientBookingBlocked: boolean;
    unpaidClientMode: string;
    memberPriorityBooking: boolean;
    packageClientPriorityBooking: boolean;
    duplicateBookingCheck: boolean;
  };
  staffResource: {
    staffAutoAssign: boolean;
    respectStaffWorkingHours: boolean;
    respectStaffBreaks: boolean;
    roomChairRequired: boolean;
    resourceConflictCheck: boolean;
  };
  notifications: {
    clientConfirmationSms: boolean;
    clientConfirmationWhatsapp: boolean;
    clientConfirmationEmail: boolean;
    reminderBeforeHours: number;
    staffNotification: boolean;
    ownerHighValueNotification: boolean;
    ownerRiskyBookingNotification: boolean;
  };
};

const DEFAULT_SETTINGS: BookingSettingsState = {
  bookingControl: {
    onlineBooking: true,
    walkInBooking: true,
    allowClientStaffSelect: true,
    sameDayBooking: true,
    autoConfirmBooking: false,
    riskyBookingOwnerApproval: true
  },
  slotRules: {
    slotDurationMinutes: 15,
    minimumAdvanceHours: 2,
    maximumFutureDays: 30,
    bufferMinutes: 0,
    allowOverlapBooking: false,
    previousTimeSlotVisibility: false
  },
  cancellationReschedule: {
    allowCancellation: true,
    cancellationUntilHours: 4,
    allowReschedule: true,
    rescheduleUntilHours: 4,
    noShowAutoMark: false,
    lateChangeOwnerApproval: true
  },
  depositPayment: {
    depositRequired: false,
    depositType: 'percentage',
    depositValue: 0,
    payLaterAllowed: true,
    riskyClientOnlinePayment: false,
    depositRefundRule: 'Refunds follow owner approval and salon policy.'
  },
  clientRules: {
    newClientBookingAllowed: true,
    blockedClientBookingBlocked: true,
    unpaidClientMode: 'warn',
    memberPriorityBooking: true,
    packageClientPriorityBooking: true,
    duplicateBookingCheck: true
  },
  staffResource: {
    staffAutoAssign: false,
    respectStaffWorkingHours: true,
    respectStaffBreaks: true,
    roomChairRequired: false,
    resourceConflictCheck: true
  },
  notifications: {
    clientConfirmationSms: true,
    clientConfirmationWhatsapp: true,
    clientConfirmationEmail: false,
    reminderBeforeHours: 24,
    staffNotification: true,
    ownerHighValueNotification: true,
    ownerRiskyBookingNotification: true
  }
};

const SLOT_DURATIONS = [5, 10, 15, 30, 45, 60];
const UNPAID_CLIENT_MODES = [
  { value: 'allow', label: 'Allow' },
  { value: 'warn', label: 'Warn' },
  { value: 'block', label: 'Block' }
];
const DEPOSIT_TYPES = [
  { value: 'percentage', label: 'Percentage' },
  { value: 'fixed', label: 'Fixed Amount' }
];

function cloneSettings(settings: BookingSettingsState): BookingSettingsState {
  return JSON.parse(JSON.stringify(settings)) as BookingSettingsState;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return String(value ?? fallback);
}

@Component({
  selector: 'app-booking-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="booking-settings-page inner-page-shell">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings/general">General Settings</a>
        <a routerLink="/settings/products">Products Settings</a>
        <a routerLink="/settings/supplier">Supplier Settings</a>
        <a routerLink="/settings/inventory">Inventory Settings</a>
        <a routerLink="/settings/services">Services Settings</a>
        <a routerLink="/settings/packages">Packages Settings</a>
        <a routerLink="/settings/membership">Membership Settings</a>
        <a routerLink="/settings/custom-fields">Custom Fields</a>
        <a routerLink="/settings/consent-forms">Consent Forms</a>
        <a routerLink="/setting/calendar">Calendar Settings</a>
        <a class="active" routerLink="/settings/booking">Booking Settings</a>
        <a routerLink="/settings/multiple-location">Multiple Location</a>
        <a routerLink="/settings/clients/custom-form">Clients - Custom Form</a>
        <a routerLink="/settings/taxes">Tax Settings</a>
        <a routerLink="/settings/marketplace">Marketplace Settings</a>
        <a routerLink="/settings/others">Other Settings</a>
        <a routerLink="/settings/bill-setting">Bill Settings</a>
        <a routerLink="/settings/business-details">Business Details</a>
      <a routerLink="/settings/payment-methods">Payment Methods</a>
      <a routerLink="/settings/message-history">Message History</a>
      <a routerLink="/settings/sms-template">SMS Template</a>
      <a routerLink="/settings/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero inner-page-header">
          <div>
            <span class="eyebrow">Setup / Booking</span>
            <h1>Booking Settings Control</h1>
            <p>Manage online booking, appointment slot rules, deposits, client rules, staff resources and booking notifications.</p>
          </div>
          <div class="hero-actions inner-action-bar">
            <button class="ghost-button" type="button" (click)="load()">Refresh</button>
            <button class="primary-button" type="button" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </header>

        <p class="state success" *ngIf="message()">{{ message() }}</p>
        <p class="state danger" *ngIf="error()">{{ error() }}</p>
        <p class="phase-note">This setting affects Calendar, Online Booking, Appointment creation and POS appointment flow in the next phase.</p>

        <section class="settings-grid inner-form-grid">
          <article class="settings-card inner-page-card">
            <h2>Booking Control</h2>
            <label class="switch-row">
              <span><strong>Online Booking</strong><small>Allow customers to book online.</small></span>
              <input type="checkbox" [(ngModel)]="settings.bookingControl.onlineBooking" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Walk-in Booking</strong><small>Allow front desk walk-in appointment creation.</small></span>
              <input type="checkbox" [(ngModel)]="settings.bookingControl.walkInBooking" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Allow Client to Select Staff</strong><small>Show staff choice on booking surfaces.</small></span>
              <input type="checkbox" [(ngModel)]="settings.bookingControl.allowClientStaffSelect" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Same-day Booking Allow</strong><small>Permit bookings for the current business date.</small></span>
              <input type="checkbox" [(ngModel)]="settings.bookingControl.sameDayBooking" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Auto Confirm Booking</strong><small>Mark eligible bookings confirmed automatically.</small></span>
              <input type="checkbox" [(ngModel)]="settings.bookingControl.autoConfirmBooking" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Require Owner Approval for Risky Booking</strong><small>Keep risky appointments in an approval flow.</small></span>
              <input type="checkbox" [(ngModel)]="settings.bookingControl.riskyBookingOwnerApproval" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Slot Rules</h2>
            <label class="field-row">
              <span>Booking Slot Duration</span>
              <select [(ngModel)]="settings.slotRules.slotDurationMinutes">
                <option *ngFor="let duration of slotDurations" [ngValue]="duration">{{ duration }} min</option>
              </select>
            </label>
            <label class="field-row">
              <span>Minimum Advance Booking Time</span>
              <input type="number" min="0" [(ngModel)]="settings.slotRules.minimumAdvanceHours" />
              <small>Hours before appointment start.</small>
            </label>
            <label class="field-row">
              <span>Maximum Future Booking Days</span>
              <input type="number" min="1" [(ngModel)]="settings.slotRules.maximumFutureDays" />
            </label>
            <label class="field-row">
              <span>Buffer Time Between Appointments</span>
              <input type="number" min="0" [(ngModel)]="settings.slotRules.bufferMinutes" />
              <small>Minutes after each appointment.</small>
            </label>
            <label class="switch-row compact">
              <span><strong>Allow Overlap Booking</strong><small>Allow same staff/resource overlap.</small></span>
              <input type="checkbox" [(ngModel)]="settings.slotRules.allowOverlapBooking" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row compact">
              <span><strong>Previous Time Slot Visibility</strong><small>Show past time slots on booking calendar.</small></span>
              <input type="checkbox" [(ngModel)]="settings.slotRules.previousTimeSlotVisibility" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Cancellation / Reschedule</h2>
            <label class="switch-row">
              <span><strong>Allow Cancellation</strong><small>Permit customer/front desk cancellation.</small></span>
              <input type="checkbox" [(ngModel)]="settings.cancellationReschedule.allowCancellation" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>Cancellation Allowed Until X Hours Before</span>
              <input type="number" min="0" [(ngModel)]="settings.cancellationReschedule.cancellationUntilHours" />
            </label>
            <label class="switch-row">
              <span><strong>Allow Reschedule</strong><small>Permit appointment date/time changes.</small></span>
              <input type="checkbox" [(ngModel)]="settings.cancellationReschedule.allowReschedule" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>Reschedule Allowed Until X Hours Before</span>
              <input type="number" min="0" [(ngModel)]="settings.cancellationReschedule.rescheduleUntilHours" />
            </label>
            <label class="switch-row compact">
              <span><strong>No-show Auto Mark Rule</strong><small>Auto mark missed bookings in next phase.</small></span>
              <input type="checkbox" [(ngModel)]="settings.cancellationReschedule.noShowAutoMark" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row compact">
              <span><strong>Late Cancel / Reschedule Requires Owner Approval</strong><small>Escalate late changes.</small></span>
              <input type="checkbox" [(ngModel)]="settings.cancellationReschedule.lateChangeOwnerApproval" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Deposit / Payment</h2>
            <label class="switch-row">
              <span><strong>Deposit Required</strong><small>Require payment before booking confirmation.</small></span>
              <input type="checkbox" [(ngModel)]="settings.depositPayment.depositRequired" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>Deposit Type</span>
              <select [(ngModel)]="settings.depositPayment.depositType">
                <option *ngFor="let type of depositTypes" [value]="type.value">{{ type.label }}</option>
              </select>
            </label>
            <label class="field-row">
              <span>Deposit Value</span>
              <input type="number" min="0" [(ngModel)]="settings.depositPayment.depositValue" />
            </label>
            <label class="switch-row compact">
              <span><strong>Pay Later Allow/Block</strong><small>Allow pay later for eligible bookings.</small></span>
              <input type="checkbox" [(ngModel)]="settings.depositPayment.payLaterAllowed" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row compact">
              <span><strong>Online Payment Required for Risky Clients</strong><small>Force payment for risk cases in next phase.</small></span>
              <input type="checkbox" [(ngModel)]="settings.depositPayment.riskyClientOnlinePayment" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row span-all">
              <span>Deposit Refund Rule text</span>
              <textarea rows="3" [(ngModel)]="settings.depositPayment.depositRefundRule"></textarea>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Client Rules</h2>
            <label class="switch-row">
              <span><strong>New Client Booking Allow</strong><small>Allow first-time clients to book.</small></span>
              <input type="checkbox" [(ngModel)]="settings.clientRules.newClientBookingAllowed" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Blocked Client Booking Block</strong><small>Stop blocked clients from booking.</small></span>
              <input type="checkbox" [(ngModel)]="settings.clientRules.blockedClientBookingBlocked" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field-row">
              <span>Unpaid Client Booking</span>
              <select [(ngModel)]="settings.clientRules.unpaidClientMode">
                <option *ngFor="let mode of unpaidClientModes" [value]="mode.value">{{ mode.label }}</option>
              </select>
            </label>
            <label class="switch-row compact">
              <span><strong>Member Priority Booking</strong><small>Prioritize membership clients.</small></span>
              <input type="checkbox" [(ngModel)]="settings.clientRules.memberPriorityBooking" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row compact">
              <span><strong>Package Client Priority Booking</strong><small>Prioritize package balance clients.</small></span>
              <input type="checkbox" [(ngModel)]="settings.clientRules.packageClientPriorityBooking" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row compact">
              <span><strong>Duplicate Booking Check</strong><small>Warn/block duplicate appointment attempts.</small></span>
              <input type="checkbox" [(ngModel)]="settings.clientRules.duplicateBookingCheck" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Staff & Resource</h2>
            <label class="switch-row">
              <span><strong>Staff Auto Assign</strong><small>Let the system pick available staff.</small></span>
              <input type="checkbox" [(ngModel)]="settings.staffResource.staffAutoAssign" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Respect Staff Working Hours</strong><small>Prevent booking outside shifts.</small></span>
              <input type="checkbox" [(ngModel)]="settings.staffResource.respectStaffWorkingHours" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Respect Staff Breaks</strong><small>Prevent booking during breaks.</small></span>
              <input type="checkbox" [(ngModel)]="settings.staffResource.respectStaffBreaks" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Room/Chair Required</strong><small>Require resource selection for booking.</small></span>
              <input type="checkbox" [(ngModel)]="settings.staffResource.roomChairRequired" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row">
              <span><strong>Resource Conflict Check</strong><small>Prevent double booking rooms/chairs.</small></span>
              <input type="checkbox" [(ngModel)]="settings.staffResource.resourceConflictCheck" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card inner-page-card">
            <h2>Notifications</h2>
            <div class="channel-row">
              <label><input type="checkbox" [(ngModel)]="settings.notifications.clientConfirmationSms" /> SMS</label>
              <label><input type="checkbox" [(ngModel)]="settings.notifications.clientConfirmationWhatsapp" /> WhatsApp</label>
              <label><input type="checkbox" [(ngModel)]="settings.notifications.clientConfirmationEmail" /> Email</label>
            </div>
            <label class="field-row">
              <span>Reminder Before X Hours</span>
              <input type="number" min="0" [(ngModel)]="settings.notifications.reminderBeforeHours" />
            </label>
            <label class="switch-row compact">
              <span><strong>Staff Notification</strong><small>Notify assigned staff for booking changes.</small></span>
              <input type="checkbox" [(ngModel)]="settings.notifications.staffNotification" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row compact">
              <span><strong>Owner Notification for High-value Booking</strong><small>Alert owner for important bookings.</small></span>
              <input type="checkbox" [(ngModel)]="settings.notifications.ownerHighValueNotification" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-row compact">
              <span><strong>Owner Notification for Risky Booking</strong><small>Alert owner for risky booking cases.</small></span>
              <input type="checkbox" [(ngModel)]="settings.notifications.ownerRiskyBookingNotification" />
              <i aria-hidden="true"></i>
            </label>
          </article>

          <article class="settings-card preview-card">
            <h2>Policy Preview</h2>
            <div class="preview-list">
              <p><strong>Booking:</strong> {{ settings.bookingControl.onlineBooking ? 'Online booking ON' : 'Online booking OFF' }}; {{ settings.bookingControl.walkInBooking ? 'walk-in allowed' : 'walk-in blocked' }}.</p>
              <p><strong>Slots:</strong> {{ settings.slotRules.slotDurationMinutes }} min slots, {{ settings.slotRules.minimumAdvanceHours }} hour advance, {{ settings.slotRules.maximumFutureDays }} day future window.</p>
              <p><strong>Cancellation:</strong> {{ settings.cancellationReschedule.allowCancellation ? 'Allowed' : 'Blocked' }} until {{ settings.cancellationReschedule.cancellationUntilHours }} hours before.</p>
              <p><strong>Reschedule:</strong> {{ settings.cancellationReschedule.allowReschedule ? 'Allowed' : 'Blocked' }} until {{ settings.cancellationReschedule.rescheduleUntilHours }} hours before.</p>
              <p><strong>Deposit:</strong> {{ settings.depositPayment.depositRequired ? (settings.depositPayment.depositType + ' ' + settings.depositPayment.depositValue) : 'Not required' }}.</p>
              <p><strong>Unpaid Client:</strong> {{ settings.clientRules.unpaidClientMode | titlecase }}.</p>
              <p><strong>Notifications:</strong> {{ notificationSummary() }}.</p>
            </div>
          </article>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; color: #0f2235; }
    .booking-settings-page {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 18px;
      padding: 20px;
      background: #f3f7f5;
      min-height: calc(100vh - 88px);
      overflow-x: hidden;
    }
    .settings-nav {
      align-self: start;
      position: sticky;
      top: 16px;
      display: grid;
      gap: 6px;
      padding: 18px 14px;
      background: #fff;
      border: 1px solid #d8e6df;
      border-radius: 14px;
      box-shadow: 0 20px 42px rgba(0, 27, 58, 0.06);
    }
    .settings-nav a {
      color: #0f2235;
      text-decoration: none;
      font-weight: 800;
      padding: 12px 14px;
      border-radius: 10px;
    }
    .settings-nav a.active,
    .settings-nav a:hover {
      color: #007b61;
      background: #e6f8f1;
    }
    .settings-content {
      display: grid;
      gap: 16px;
      min-width: 0;
    }
    .settings-hero,
    .settings-card {
      background: #fff;
      border: 1px solid #d8e6df;
      border-radius: 16px;
      box-shadow: 0 22px 48px rgba(0, 27, 58, 0.07);
      min-width: 0;
    }
    .settings-hero {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: center;
      padding: 28px;
    }
    .eyebrow {
      display: block;
      color: #5a6a66;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    h1, h2, p { margin: 0; }
    h1 {
      font-size: 40px;
      line-height: 1.1;
      letter-spacing: 0;
      margin-bottom: 10px;
    }
    h2 {
      font-size: 16px;
      padding: 18px 20px;
      border-bottom: 1px solid #e2ebe7;
    }
    .settings-hero p,
    .phase-note {
      color: #52655f;
      font-size: 15px;
      line-height: 1.5;
    }
    .hero-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    button {
      border: 0;
      cursor: pointer;
      font: inherit;
      font-weight: 900;
    }
    .primary-button,
    .ghost-button {
      min-height: 46px;
      border-radius: 10px;
      padding: 0 18px;
    }
    .primary-button {
      color: #fff;
      background: #07966f;
      box-shadow: 0 16px 32px rgba(7, 150, 111, 0.18);
    }
    .primary-button:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    .ghost-button {
      color: #0f2235;
      background: #fff;
      border: 1px solid #d8e6df;
    }
    .state,
    .phase-note {
      padding: 12px 14px;
      border-radius: 10px;
      font-weight: 800;
    }
    .state.success {
      color: #006344;
      background: #e4fff2;
      border: 1px solid #9de8c4;
    }
    .state.danger {
      color: #b42318;
      background: #fff0ee;
      border: 1px solid #ffcdc7;
    }
    .phase-note {
      color: #8a5a00;
      background: #fff8e7;
      border: 1px solid #ffd275;
    }
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(280px, 1fr));
      gap: 16px;
      min-width: 0;
    }
    .switch-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 14px;
      min-height: 70px;
      padding: 12px 16px;
      border-bottom: 1px solid #e6eeeb;
    }
    .switch-row.compact {
      min-height: 62px;
    }
    .switch-row:last-child,
    .field-row:last-child {
      border-bottom: 0;
    }
    .switch-row span {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .switch-row small,
    .field-row small {
      color: #60736d;
      font-size: 13px;
      line-height: 1.35;
    }
    .switch-row input[type="checkbox"] {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .switch-row i {
      position: relative;
      width: 58px;
      height: 30px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: #c6cbd0;
      transition: background 0.16s ease;
    }
    .switch-row i::after {
      content: '';
      position: absolute;
      top: 5px;
      left: 6px;
      width: 20px;
      height: 20px;
      border-radius: 999px;
      background: #fff;
      transition: transform 0.16s ease;
    }
    .switch-row input:checked + i {
      background: #20242b;
    }
    .switch-row input:checked + i::after {
      transform: translateX(26px);
    }
    .field-row {
      display: grid;
      gap: 8px;
      min-width: 0;
      padding: 14px 16px;
      border-bottom: 1px solid #edf2f0;
      font-weight: 800;
    }
    input[type="number"],
    select,
    textarea {
      width: 100%;
      min-width: 0;
      border: 1px solid #d4dfda;
      border-radius: 9px;
      background: #f7f8f8;
      color: #0f2235;
      font: inherit;
      padding: 12px 14px;
      box-sizing: border-box;
    }
    textarea {
      resize: vertical;
    }
    .span-all {
      grid-column: 1 / -1;
    }
    .channel-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      padding: 16px;
      border-bottom: 1px solid #edf2f0;
    }
    .channel-row label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border: 1px solid #d8e6df;
      border-radius: 999px;
      font-weight: 900;
      background: #f7fbfa;
    }
    .preview-card {
      grid-column: 1 / -1;
    }
    .preview-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(240px, 1fr));
      gap: 12px;
      padding: 18px;
    }
    .preview-list p {
      padding: 14px;
      border: 1px solid #d8e6df;
      border-radius: 12px;
      background: #f7fbfa;
      color: #263a4d;
      line-height: 1.45;
    }
    @media (max-width: 1100px) {
      .booking-settings-page {
        grid-template-columns: 1fr;
      }
      .settings-nav {
        position: static;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      }
    }
    @media (max-width: 800px) {
      .settings-grid,
      .preview-list {
        grid-template-columns: 1fr;
      }
      .settings-hero {
        align-items: stretch;
        flex-direction: column;
        padding: 20px;
      }
      h1 {
        font-size: 32px;
      }
    }
  `]
})
export class BookingSettingsComponent implements OnInit {
  readonly slotDurations = SLOT_DURATIONS;
  readonly unpaidClientModes = UNPAID_CLIENT_MODES;
  readonly depositTypes = DEPOSIT_TYPES;

  saving = signal(false);
  message = signal('');
  error = signal('');
  settings = cloneSettings(DEFAULT_SETTINGS);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.message.set('');
    this.api.list<{ settings?: ApiRecord }>('settings/booking').subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to load booking settings');
        this.settings = cloneSettings(DEFAULT_SETTINGS);
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const settings = this.normalize(this.settings);
    this.api.put<{ settings?: ApiRecord }>('settings/booking', { settings }).subscribe({
      next: (result) => {
        this.settings = this.normalize(result.settings || settings);
        this.message.set('Booking settings saved');
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || err?.message || 'Unable to save booking settings');
        this.saving.set(false);
      }
    });
  }

  notificationSummary(): string {
    const channels = [
      this.settings.notifications.clientConfirmationSms ? 'SMS' : '',
      this.settings.notifications.clientConfirmationWhatsapp ? 'WhatsApp' : '',
      this.settings.notifications.clientConfirmationEmail ? 'Email' : ''
    ].filter(Boolean);
    return `${channels.length ? channels.join(', ') : 'No client channels'}; reminder ${this.settings.notifications.reminderBeforeHours} hours before`;
  }

  private normalize(input: unknown): BookingSettingsState {
    const source = (input || {}) as BookingSettingsState;
    const defaults = DEFAULT_SETTINGS;
    const bookingControl = source.bookingControl || defaults.bookingControl;
    const slotRules = source.slotRules || defaults.slotRules;
    const cancellationReschedule = source.cancellationReschedule || defaults.cancellationReschedule;
    const depositPayment = source.depositPayment || defaults.depositPayment;
    const clientRules = source.clientRules || defaults.clientRules;
    const staffResource = source.staffResource || defaults.staffResource;
    const notifications = source.notifications || defaults.notifications;
    return {
      bookingControl: {
        onlineBooking: boolValue(bookingControl.onlineBooking, defaults.bookingControl.onlineBooking),
        walkInBooking: boolValue(bookingControl.walkInBooking, defaults.bookingControl.walkInBooking),
        allowClientStaffSelect: boolValue(bookingControl.allowClientStaffSelect, defaults.bookingControl.allowClientStaffSelect),
        sameDayBooking: boolValue(bookingControl.sameDayBooking, defaults.bookingControl.sameDayBooking),
        autoConfirmBooking: boolValue(bookingControl.autoConfirmBooking, defaults.bookingControl.autoConfirmBooking),
        riskyBookingOwnerApproval: boolValue(bookingControl.riskyBookingOwnerApproval, defaults.bookingControl.riskyBookingOwnerApproval)
      },
      slotRules: {
        slotDurationMinutes: SLOT_DURATIONS.includes(numberValue(slotRules.slotDurationMinutes, defaults.slotRules.slotDurationMinutes))
          ? numberValue(slotRules.slotDurationMinutes, defaults.slotRules.slotDurationMinutes)
          : defaults.slotRules.slotDurationMinutes,
        minimumAdvanceHours: numberValue(slotRules.minimumAdvanceHours, defaults.slotRules.minimumAdvanceHours),
        maximumFutureDays: numberValue(slotRules.maximumFutureDays, defaults.slotRules.maximumFutureDays),
        bufferMinutes: numberValue(slotRules.bufferMinutes, defaults.slotRules.bufferMinutes),
        allowOverlapBooking: boolValue(slotRules.allowOverlapBooking, defaults.slotRules.allowOverlapBooking),
        previousTimeSlotVisibility: boolValue(slotRules.previousTimeSlotVisibility, defaults.slotRules.previousTimeSlotVisibility)
      },
      cancellationReschedule: {
        allowCancellation: boolValue(cancellationReschedule.allowCancellation, defaults.cancellationReschedule.allowCancellation),
        cancellationUntilHours: numberValue(cancellationReschedule.cancellationUntilHours, defaults.cancellationReschedule.cancellationUntilHours),
        allowReschedule: boolValue(cancellationReschedule.allowReschedule, defaults.cancellationReschedule.allowReschedule),
        rescheduleUntilHours: numberValue(cancellationReschedule.rescheduleUntilHours, defaults.cancellationReschedule.rescheduleUntilHours),
        noShowAutoMark: boolValue(cancellationReschedule.noShowAutoMark, defaults.cancellationReschedule.noShowAutoMark),
        lateChangeOwnerApproval: boolValue(cancellationReschedule.lateChangeOwnerApproval, defaults.cancellationReschedule.lateChangeOwnerApproval)
      },
      depositPayment: {
        depositRequired: boolValue(depositPayment.depositRequired, defaults.depositPayment.depositRequired),
        depositType: ['percentage', 'fixed'].includes(depositPayment.depositType) ? depositPayment.depositType : defaults.depositPayment.depositType,
        depositValue: numberValue(depositPayment.depositValue, defaults.depositPayment.depositValue),
        payLaterAllowed: boolValue(depositPayment.payLaterAllowed, defaults.depositPayment.payLaterAllowed),
        riskyClientOnlinePayment: boolValue(depositPayment.riskyClientOnlinePayment, defaults.depositPayment.riskyClientOnlinePayment),
        depositRefundRule: stringValue(depositPayment.depositRefundRule, defaults.depositPayment.depositRefundRule)
      },
      clientRules: {
        newClientBookingAllowed: boolValue(clientRules.newClientBookingAllowed, defaults.clientRules.newClientBookingAllowed),
        blockedClientBookingBlocked: boolValue(clientRules.blockedClientBookingBlocked, defaults.clientRules.blockedClientBookingBlocked),
        unpaidClientMode: ['allow', 'warn', 'block'].includes(clientRules.unpaidClientMode) ? clientRules.unpaidClientMode : defaults.clientRules.unpaidClientMode,
        memberPriorityBooking: boolValue(clientRules.memberPriorityBooking, defaults.clientRules.memberPriorityBooking),
        packageClientPriorityBooking: boolValue(clientRules.packageClientPriorityBooking, defaults.clientRules.packageClientPriorityBooking),
        duplicateBookingCheck: boolValue(clientRules.duplicateBookingCheck, defaults.clientRules.duplicateBookingCheck)
      },
      staffResource: {
        staffAutoAssign: boolValue(staffResource.staffAutoAssign, defaults.staffResource.staffAutoAssign),
        respectStaffWorkingHours: boolValue(staffResource.respectStaffWorkingHours, defaults.staffResource.respectStaffWorkingHours),
        respectStaffBreaks: boolValue(staffResource.respectStaffBreaks, defaults.staffResource.respectStaffBreaks),
        roomChairRequired: boolValue(staffResource.roomChairRequired, defaults.staffResource.roomChairRequired),
        resourceConflictCheck: boolValue(staffResource.resourceConflictCheck, defaults.staffResource.resourceConflictCheck)
      },
      notifications: {
        clientConfirmationSms: boolValue(notifications.clientConfirmationSms, defaults.notifications.clientConfirmationSms),
        clientConfirmationWhatsapp: boolValue(notifications.clientConfirmationWhatsapp, defaults.notifications.clientConfirmationWhatsapp),
        clientConfirmationEmail: boolValue(notifications.clientConfirmationEmail, defaults.notifications.clientConfirmationEmail),
        reminderBeforeHours: numberValue(notifications.reminderBeforeHours, defaults.notifications.reminderBeforeHours),
        staffNotification: boolValue(notifications.staffNotification, defaults.notifications.staffNotification),
        ownerHighValueNotification: boolValue(notifications.ownerHighValueNotification, defaults.notifications.ownerHighValueNotification),
        ownerRiskyBookingNotification: boolValue(notifications.ownerRiskyBookingNotification, defaults.notifications.ownerRiskyBookingNotification)
      }
    };
  }
}
