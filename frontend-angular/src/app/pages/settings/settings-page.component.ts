import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../shared/services/api.service';

type SettingsSection = {
  code: string;
  title: string;
  route?: string;
  panel?: 'appointments';
};

type AppointmentColorSetting = {
  status: string;
  enabled: boolean;
  color: string;
  label: string;
};

type AppointmentSettings = {
  startTime: string;
  endTime: string;
  overlapTimeSlot: boolean;
  previousTimeSlot: boolean;
  weekStartFrom: string;
  slotMinutes: number;
  timeFormat: string;
  roomNumberOption: boolean;
  staffCalendar: boolean;
  defaultStatus: string;
  colors: AppointmentColorSetting[];
};

type ChairRoomOption = { id: string; name: string; kind: string };

@Component({
  selector: 'page-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './settings-page.component.html',
  styleUrls: ['./settings-page.component.css'],
})
export class SettingsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly appointmentSettingsKey = 'aurashine.appointment.settings';
  search = '';
  activePanel: 'appointments' | '' = '';
  saveStatus = '';
  saveError = '';
  saving = false;
  chairRooms: ChairRoomOption[] = [];
  chairRoomName = '';
  chairRoomKind: 'chair' | 'room' = 'chair';
  chairRoomError = '';
  chairRoomSaving = false;
  appointmentSettings = this.loadAppointmentSettings();

  readonly weekStartOptions = ['Sunday', 'Monday'];
  readonly slotOptions = [10, 15, 30, 60];
  readonly timeFormatOptions = ['12 Hours', '24 Hours'];

  readonly sections: SettingsSection[] = [
    { code: 'BR', title: 'Branches' },
    { code: 'ST', title: 'Staff', route: '/staff' },
    { code: 'SV', title: 'Services', route: '/services' },
    { code: 'CL', title: 'Clients', route: '/clients' },
    { code: 'AP', title: 'Appointments', panel: 'appointments' },
    { code: 'POS', title: 'POS', route: '/pos' },
    { code: 'INV', title: 'Invoice settings', route: '/settings/invoice' },
    { code: 'IN', title: 'Inventory', route: '/inventory' },
    { code: 'MB', title: 'Memberships', route: '/memberships' },
    { code: 'PK', title: 'Packages', route: '/packages' },
    { code: 'RP', title: 'Reports', route: '/reports' },
    { code: 'NT', title: 'Notifications', route: '/notifications' },
    { code: 'SEC', title: 'Security' },
    { code: 'TAX', title: 'Taxes' },
    { code: 'PAY', title: 'Payments' },
    { code: 'INT', title: 'Integrations' },
    { code: 'DATA', title: 'Data' },
  ];

  async ngOnInit() {
    try {
      const result = await firstValueFrom(this.api.get<any>('/api/v1/appointment-settings'));
      const body = result?.data ?? result;
      this.appointmentSettings = this.mergeAppointmentSettings({
        ...(body?.settings && typeof body.settings === 'object' ? body.settings : {}),
        overlapTimeSlot: Boolean(body?.allowOverlap ?? body?.allow_overlap),
      });
    } catch {
      // Keep the saved local calendar preference while the backend is unavailable.
    }
    await this.loadChairRooms();
  }

  get filteredSections() {
    const query = this.search.trim().toLowerCase();
    if (!query) return this.sections;
    return this.sections.filter((item) => `${item.code} ${item.title}`.toLowerCase().includes(query));
  }

  get appointmentStatusOptions() {
    const seen = new Set<string>();
    return this.appointmentSettings.colors
      .map((item) => item.label.trim())
      .filter((value) => {
        if (!value || seen.has(value.toLowerCase())) return false;
        seen.add(value.toLowerCase());
        return true;
      });
  }

  trackByCode(_: number, item: SettingsSection) {
    return item.code;
  }

  trackByChairRoom(_: number, item: ChairRoomOption) {
    return item.id;
  }

  trackByStatus(_: number, item: AppointmentColorSetting) {
    return item.status;
  }

  toggleAppointmentButton(item: AppointmentColorSetting) {
    item.enabled = !item.enabled;
  }

  isOpenPanel(panel: 'appointments') {
    return this.activePanel === panel;
  }

  openPanel(panel: 'appointments') {
    this.activePanel = panel;
    this.saveStatus = '';
    this.saveError = '';
  }

  closePanel() {
    this.activePanel = '';
    this.saveStatus = '';
    this.saveError = '';
  }

  resetAppointmentSettings() {
    this.appointmentSettings = this.defaultAppointmentSettings();
    this.saveStatus = '';
    this.saveError = '';
  }

  async saveAppointmentSettings() {
    if (this.saving) return;
    this.saveError = '';

    if (!this.validateAppointmentSettings()) {
      return;
    }

    this.saving = true;
    const cleaned = this.cleanAppointmentSettings(this.appointmentSettings);
    this.appointmentSettings = cleaned;
    try {
      await firstValueFrom(this.api.patch('/api/v1/appointment-settings', {
        allow_overlap: cleaned.overlapTimeSlot,
        settings: cleaned,
      }));
      localStorage.setItem(this.appointmentSettingsKey, JSON.stringify(cleaned));
      window.dispatchEvent(new Event('aurashine:appointment-settings-updated'));
      this.saveStatus = 'Saved';
    } catch (error: any) {
      this.saveError = error?.error?.error || error?.error?.message || error?.message || 'Unable to save appointment settings';
    } finally {
      this.saving = false;
    }
  }

  async addChairRoom() {
    const name = this.chairRoomName.trim();
    if (!name || this.chairRoomSaving) return;

    this.chairRoomError = '';
    this.chairRoomSaving = true;
    try {
      await firstValueFrom(this.api.post('/api/v1/appointment-resources', {
        name,
        kind: this.chairRoomKind,
      }));
      this.chairRoomName = '';
      await this.loadChairRooms();
    } catch {
      this.chairRoomError = 'Unable to add chair or room';
    } finally {
      this.chairRoomSaving = false;
    }
  }

  private async loadChairRooms() {
    try {
      const result = await firstValueFrom(this.api.get<any>('/api/v1/appointment-resources'));
      const body = result?.data ?? result;
      this.chairRooms = (Array.isArray(body) ? body : [])
        .map((item) => ({
          id: String(item?.id || ''),
          name: String(item?.name || ''),
          kind: String(item?.kind || 'chair'),
        }))
        .filter((item) => item.id && item.name);
    } catch {
      this.chairRooms = [];
    }
  }

  private loadAppointmentSettings(): AppointmentSettings {
    try {
      const saved = JSON.parse(localStorage.getItem(this.appointmentSettingsKey) || '{}');
      return this.mergeAppointmentSettings(saved);
    } catch {
      return this.defaultAppointmentSettings();
    }
  }

  private mergeAppointmentSettings(source: Partial<AppointmentSettings>): AppointmentSettings {
    const defaults = this.defaultAppointmentSettings();
    const merged: AppointmentSettings = { ...defaults, ...source };
    merged.startTime = String(source?.startTime || defaults.startTime);
    merged.endTime = String(source?.endTime || defaults.endTime);
    merged.overlapTimeSlot = Boolean(source?.overlapTimeSlot ?? defaults.overlapTimeSlot);
    merged.previousTimeSlot = Boolean(source?.previousTimeSlot ?? defaults.previousTimeSlot);
    merged.weekStartFrom = this.weekStartOptions.includes(source?.weekStartFrom || '')
      ? String(source?.weekStartFrom || defaults.weekStartFrom)
      : defaults.weekStartFrom;
    merged.slotMinutes = this.slotOptions.includes(Number(source?.slotMinutes) || 0)
      ? Number(source?.slotMinutes || defaults.slotMinutes)
      : defaults.slotMinutes;
    merged.timeFormat = this.timeFormatOptions.includes(source?.timeFormat || '')
      ? String(source?.timeFormat || defaults.timeFormat)
      : defaults.timeFormat;
    merged.roomNumberOption = Boolean(source?.roomNumberOption ?? defaults.roomNumberOption);
    merged.staffCalendar = Boolean(source?.staffCalendar ?? defaults.staffCalendar);
    merged.defaultStatus = String(source?.defaultStatus || defaults.defaultStatus);
    merged.colors = defaults.colors.map((item) => {
      const found = source?.colors?.find((entry) => entry?.status === item.status);
      return found
        ? {
            ...item,
            ...found,
            status: String(found.status || item.status),
            color: String(found.color || item.color || '').trim() || item.color,
            label: String(found.label || item.label || '').trim() || item.label,
            enabled: typeof found.enabled === 'boolean' ? found.enabled : item.enabled,
          }
        : item;
    });

    const normalized = this.cleanAppointmentSettings(merged);
    if (!normalized.colors.some((entry) => entry.enabled)) {
      normalized.colors[0].enabled = true;
    }

    return normalized;
  }

  private defaultAppointmentSettings(): AppointmentSettings {
    return {
      startTime: '08:00',
      endTime: '20:00',
      overlapTimeSlot: false,
      previousTimeSlot: true,
      weekStartFrom: 'Sunday',
      slotMinutes: 15,
      timeFormat: '12 Hours',
      roomNumberOption: false,
      staffCalendar: true,
      defaultStatus: 'Confirmed',
      colors: this.defaultColorSettings(),
    };
  }

  private defaultColorSettings(): AppointmentColorSetting[] {
    return [
      { status: 'booked', enabled: true, color: '#84cfb1', label: 'Confirmed' },
      { status: 'arrived', enabled: true, color: '#9fd6fd', label: 'Arrived' },
      { status: 'in-service', enabled: true, color: '#ffa500', label: 'Start' },
      { status: 'completed', enabled: true, color: '#323ec7', label: 'Completed' },
      { status: 'cancelled', enabled: true, color: '#fc8e8f', label: 'Cancel' },
      { status: 'no-show', enabled: true, color: '#23e830', label: 'Not Came' },
      { status: 'not-confirmed', enabled: true, color: '#8893d3', label: 'Not Confirmed' },
      { status: 'rescheduled', enabled: true, color: '#2a2c32', label: 'Reschedule Booking' },
      { status: 'payment', enabled: true, color: '#bd60e8', label: 'Add Payment' },
      { status: 'deleted', enabled: true, color: '#ff0000', label: 'Delete' },
    ];
  }

  private cleanAppointmentSettings(value: AppointmentSettings) {
    const result: AppointmentSettings = {
      ...value,
      startTime: this.clampTime(value.startTime || '08:00'),
      endTime: this.clampTime(value.endTime || '20:00'),
      slotMinutes: this.slotOptions.includes(value.slotMinutes) ? value.slotMinutes : 15,
      timeFormat: this.timeFormatOptions.includes(value.timeFormat) ? value.timeFormat : '12 Hours',
      weekStartFrom: this.weekStartOptions.includes(value.weekStartFrom) ? value.weekStartFrom : 'Sunday',
      colors: value.colors.map((entry) => ({
        ...entry,
        status: String(entry.status || ''),
        label: String(entry.label || '').trim() || 'Status',
        color: String(entry.color || '').trim() || '#999',
        enabled: !!entry.enabled,
      })),
    };

    if (!result.colors.some((entry) => entry.enabled)) {
      if (result.colors[0]) {
        result.colors[0].enabled = true;
      }
    }

    const validStatusOptions = Array.from(new Set(result.colors.map((item) => item.label.trim()).filter(Boolean)));
    if (!validStatusOptions.length) {
      result.defaultStatus = 'Confirmed';
    } else if (!validStatusOptions.includes(result.defaultStatus)) {
      result.defaultStatus = validStatusOptions[0];
    }

    return result;
  }

  private clampTime(value: string) {
    const [hours = 0, minutes = 0] = String(value).split(':').map((part) => Number(part) || 0);
    return `${String(Math.max(0, Math.min(23, hours)).toString()).padStart(2, '0')}:${String(Math.max(0, Math.min(59, minutes))).padStart(2, '0')}`;
  }

  private validateAppointmentSettings() {
    const startParts = String(this.appointmentSettings.startTime).split(':').map((value) => Number(value) || 0);
    const endParts = String(this.appointmentSettings.endTime).split(':').map((value) => Number(value) || 0);
    const start = (startParts[0] || 0) * 60 + (startParts[1] || 0);
    const end = (endParts[0] || 0) * 60 + (endParts[1] || 0);

    if (start >= end) {
      this.saveError = 'Start time must be earlier than end time.';
      return false;
    }

    if (!this.slotOptions.includes(this.appointmentSettings.slotMinutes)) {
      this.saveError = 'Invalid slot duration selected.';
      return false;
    }

    if (!this.weekStartOptions.includes(this.appointmentSettings.weekStartFrom)) {
      this.saveError = 'Invalid week start selected.';
      return false;
    }

    if (!this.timeFormatOptions.includes(this.appointmentSettings.timeFormat)) {
      this.saveError = 'Invalid time format selected.';
      return false;
    }

    return true;
  }
}
