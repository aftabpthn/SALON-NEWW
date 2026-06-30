import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

type CalendarColorSetting = {
  key: string;
  enabled: boolean;
  color: string;
  label: string;
};

type CalendarSettingsState = {
  overlapTimeSlot: boolean;
  previousTimeSlot: boolean;
  weekStartFrom: string;
  timeSlot: string;
  timeFormat: string;
  roomNumberOption: boolean;
  staffCalendar: boolean;
  appointmentStatus: string;
  colors: CalendarColorSetting[];
};

const STORAGE_KEY = 'aura.calendar.settings.v1';

const DEFAULT_COLORS: CalendarColorSetting[] = [
  { key: 'confirmed', enabled: true, color: '#84cfb1', label: 'Confirmed' },
  { key: 'arrived', enabled: true, color: '#9fd6fd', label: 'Arrived' },
  { key: 'start', enabled: true, color: '#ffa500', label: 'Start' },
  { key: 'completed', enabled: true, color: '#323ec7', label: 'Completed' },
  { key: 'cancel', enabled: true, color: '#fc8e8f', label: 'Cancel' },
  { key: 'notCame', enabled: true, color: '#23e830', label: 'Not Came' },
  { key: 'notConfirmed', enabled: true, color: '#8893d3', label: 'Not Confirmed' },
  { key: 'rescheduleBooking', enabled: true, color: '#2a2c32', label: 'Reschedule Booking' },
  { key: 'addPayment', enabled: true, color: '#bd60e8', label: 'Add Payment' },
  { key: 'delete', enabled: true, color: '#ff0000', label: 'Delete' }
];

const DEFAULT_SETTINGS: CalendarSettingsState = {
  overlapTimeSlot: true,
  previousTimeSlot: true,
  weekStartFrom: 'Sunday',
  timeSlot: '15 Mins',
  timeFormat: '12 Hours',
  roomNumberOption: false,
  staffCalendar: true,
  appointmentStatus: 'Confirmed',
  colors: DEFAULT_COLORS
};

@Component({
  selector: 'app-calendar-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="calendar-settings-page">
      <aside class="settings-nav" aria-label="Settings sections">
        <a routerLink="/settings">General Settings</a>
        <a class="active" routerLink="/setting/calendar">Calendar Settings</a>
        <a routerLink="/settings/clients/custom-form">Clients - Custom Form</a>
        <a routerLink="/settings/taxes">Tax Settings</a>
        <a routerLink="/settings/marketplace">Marketplace Settings</a>
        <a routerLink="/business-details">Business Details</a>
        <a routerLink="/pos/payment-modes">Payment Methods</a>
        <a routerLink="/message-logs">Message History</a>
        <a routerLink="/security">Security</a>
      </aside>

      <main class="settings-content">
        <header class="settings-hero">
          <div>
            <span class="eyebrow">Setup / Calendar</span>
            <h1>Calendar settings</h1>
            <p>Easily adjust the time, color, and appointment settings on your calendar.</p>
          </div>
          <button class="primary-button" type="button" (click)="save()">Save</button>
        </header>

        <p class="state success" *ngIf="message()">{{ message() }}</p>

        <section class="settings-section time-section">
          <div class="section-intro">
            <h2>Calendar Time settings</h2>
            <p>Specify time specific settings for your business.</p>
          </div>

          <div class="time-controls">
            <label class="switch-card">
              <span>
                <strong>Overlap Time Slot</strong>
                <small>Allow appointments to overlap in the same time slot</small>
              </span>
              <input type="checkbox" [(ngModel)]="settings.overlapTimeSlot" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-card">
              <span>
                <strong>Previous Time Slot</strong>
                <small>Show past time slots on the calendar view</small>
              </span>
              <input type="checkbox" [(ngModel)]="settings.previousTimeSlot" />
              <i aria-hidden="true"></i>
            </label>
            <div class="select-grid">
              <label class="field">
                <span>Week Start From</span>
                <select [(ngModel)]="settings.weekStartFrom">
                  <option *ngFor="let day of weekDays" [value]="day">{{ day }}</option>
                </select>
              </label>
              <label class="field">
                <span>Time Slot</span>
                <select [(ngModel)]="settings.timeSlot">
                  <option *ngFor="let slot of timeSlots" [value]="slot">{{ slot }}</option>
                </select>
              </label>
              <label class="field">
                <span>Time Format</span>
                <select [(ngModel)]="settings.timeFormat">
                  <option>12 Hours</option>
                  <option>24 Hours</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section class="settings-section">
          <div class="section-intro">
            <h2>Calendar Color settings</h2>
            <p>Specify color specific settings for your business.</p>
          </div>

          <div class="color-table-wrap">
            <table class="color-table">
              <thead>
                <tr>
                  <th>Enable/Disable</th>
                  <th>Select Color</th>
                  <th>Enter Button Text</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of settings.colors; trackBy: trackColor">
                  <td>
                    <label class="toggle-row">
                      <input type="checkbox" [(ngModel)]="row.enabled" />
                      <i aria-hidden="true"></i>
                      <strong>{{ row.label }}</strong>
                    </label>
                  </td>
                  <td>
                    <div class="color-control">
                      <input type="text" [(ngModel)]="row.color" />
                      <input class="color-picker" type="color" [(ngModel)]="row.color" [attr.aria-label]="row.label + ' color'" />
                    </div>
                  </td>
                  <td><input class="text-input" type="text" [(ngModel)]="row.label" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="settings-section appointment-section">
          <div class="section-intro">
            <h2>Appointment settings</h2>
            <p>Appointment settings for your business.</p>
          </div>

          <div class="appointment-grid">
            <label class="switch-card compact">
              <span>
                <strong>Room Number Option</strong>
                <small>Show room numbers on appointments</small>
              </span>
              <input type="checkbox" [(ngModel)]="settings.roomNumberOption" />
              <i aria-hidden="true"></i>
            </label>
            <label class="switch-card compact">
              <span>
                <strong>Staff Calendar</strong>
                <small>Show the staff calendar view</small>
              </span>
              <input type="checkbox" [(ngModel)]="settings.staffCalendar" />
              <i aria-hidden="true"></i>
            </label>
            <label class="field status-field">
              <span>Appointment status</span>
              <select [(ngModel)]="settings.appointmentStatus">
                <option *ngFor="let status of appointmentStatuses" [value]="status">{{ status }}</option>
              </select>
            </label>
          </div>
        </section>
      </main>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      overflow-x: hidden;
    }

    .calendar-settings-page {
      display: grid;
      grid-template-columns: minmax(180px, 230px) minmax(0, 1fr);
      gap: 18px;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
    }

    .settings-nav {
      position: sticky;
      top: 14px;
      align-self: start;
      display: grid;
      gap: 6px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .settings-nav a {
      padding: 10px 12px;
      border-radius: 6px;
      color: var(--ink);
      font-weight: 850;
      text-decoration: none;
    }

    .settings-nav a.active,
    .settings-nav a:hover {
      background: #eefbf6;
      color: #08745f;
    }

    .settings-content {
      display: grid;
      min-width: 0;
      gap: 18px;
    }

    .settings-hero,
    .settings-section {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      box-shadow: var(--shadow-soft);
    }

    .settings-hero {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: center;
      padding: 22px 24px;
    }

    .settings-hero h1,
    .section-intro h2 {
      margin: 0;
      color: var(--ink);
      letter-spacing: 0;
    }

    .settings-hero h1 {
      font-size: 30px;
      line-height: 1.12;
    }

    .settings-hero p,
    .section-intro p,
    .switch-card small {
      margin: 6px 0 0;
      color: var(--muted);
      font-weight: 650;
    }

    .settings-section {
      padding: 22px;
    }

    .time-section {
      display: grid;
      grid-template-columns: minmax(210px, 0.36fr) minmax(0, 1fr);
      gap: 24px;
    }

    .time-controls {
      display: grid;
      gap: 12px;
      min-width: 0;
    }

    .switch-card {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      min-height: 78px;
      padding: 14px 18px;
      border: 1px solid #111827;
      border-radius: 8px;
      background: #fff;
    }

    .switch-card.compact {
      min-height: 74px;
    }

    .switch-card input,
    .toggle-row input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .switch-card i,
    .toggle-row i {
      position: relative;
      flex: 0 0 auto;
      width: 48px;
      height: 24px;
      border-radius: 999px;
      background: #d1d5db;
      transition: background 0.16s ease;
    }

    .switch-card i::after,
    .toggle-row i::after {
      content: '';
      position: absolute;
      top: 4px;
      left: 4px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.16s ease;
    }

    .switch-card input:checked + i,
    .toggle-row input:checked + i {
      background: #1f1f1f;
    }

    .switch-card input:checked + i::after,
    .toggle-row input:checked + i::after {
      transform: translateX(24px);
    }

    .select-grid,
    .appointment-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .field {
      display: grid;
      gap: 8px;
      min-width: 0;
      font-weight: 850;
    }

    .field select,
    .field input,
    .text-input,
    .color-control input[type='text'] {
      min-width: 0;
      width: 100%;
      height: 42px;
      box-sizing: border-box;
      border: 1px solid #cfd8dc;
      border-radius: 6px;
      background: #f8fafc;
      color: var(--ink);
      padding: 0 12px;
      font: inherit;
    }

    .color-table-wrap {
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
    }

    .color-table {
      width: 100%;
      min-width: 940px;
      border-collapse: collapse;
    }

    .color-table th,
    .color-table td {
      border-bottom: 1px solid var(--line);
      padding: 14px 16px;
      text-align: left;
      vertical-align: middle;
    }

    .color-table th {
      background: #f8fafc;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }

    .toggle-row,
    .color-control {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .toggle-row {
      position: relative;
      min-width: 210px;
    }

    .color-control input[type='text'] {
      flex: 1 1 auto;
    }

    .color-picker {
      flex: 0 0 44px;
      width: 44px;
      height: 40px;
      padding: 0;
      border: 0;
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
    }

    .appointment-grid {
      align-items: end;
    }

    .status-field {
      align-self: center;
    }

    @media (max-width: 980px) {
      .calendar-settings-page,
      .time-section {
        grid-template-columns: 1fr;
      }

      .settings-nav {
        position: static;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      }

      .select-grid,
      .appointment-grid {
        grid-template-columns: 1fr;
      }

      .settings-hero {
        align-items: stretch;
        flex-direction: column;
      }
    }
  `]
})
export class CalendarSettingsComponent implements OnInit {
  readonly message = signal('');
  readonly weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  readonly timeSlots = ['5 Mins', '10 Mins', '15 Mins', '20 Mins', '30 Mins', '45 Mins', '60 Mins'];
  readonly appointmentStatuses = DEFAULT_COLORS.map((item) => item.label);

  settings: CalendarSettingsState = this.clone(DEFAULT_SETTINGS);

  ngOnInit(): void {
    this.settings = this.loadSettings();
  }

  save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    this.message.set('Calendar settings saved.');
    window.setTimeout(() => this.message.set(''), 2500);
  }

  trackColor(_index: number, row: CalendarColorSetting): string {
    return row.key;
  }

  private loadSettings(): CalendarSettingsState {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<CalendarSettingsState> | null;
      if (!saved) return this.clone(DEFAULT_SETTINGS);
      const savedColors = Array.isArray(saved.colors) ? saved.colors : [];
      return {
        ...this.clone(DEFAULT_SETTINGS),
        ...saved,
        colors: DEFAULT_COLORS.map((item) => ({ ...item, ...(savedColors.find((row) => row.key === item.key) || {}) }))
      };
    } catch {
      return this.clone(DEFAULT_SETTINGS);
    }
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
