import { Injectable, signal } from '@angular/core';

export type AppointmentCalendarLayout = 'grid' | 'compact-grid' | 'timeline' | 'list';
export const APPOINTMENT_SLOT_MINUTE_OPTIONS = [10, 15, 30, 60] as const;
export type AppointmentSlotMinutes = (typeof APPOINTMENT_SLOT_MINUTE_OPTIONS)[number];

const APPOINTMENT_SLOT_MINUTE_SET = new Set<number>(APPOINTMENT_SLOT_MINUTE_OPTIONS);

export function normalizeAppointmentSlotMinutes(value: string | number): AppointmentSlotMinutes {
  const minutes = Number(value);
  return (APPOINTMENT_SLOT_MINUTE_SET.has(minutes) ? minutes : 10) as AppointmentSlotMinutes;
}

@Injectable({ providedIn: 'root' })
export class AppointmentToolbarService {
  readonly visible = signal(false);
  readonly slotMinutes = signal<AppointmentSlotMinutes>(10);
  readonly calendarLayout = signal<AppointmentCalendarLayout>('grid');
  readonly scheduledStaffVisibleCount = signal(0);
  readonly staffPanelOpen = signal(false);
  readonly staffToggleRequests = signal(0);
  readonly safeSlotCount = signal(0);
  readonly waitlistCount = signal(0);
  readonly riskText = signal('');
  readonly safeSlotRequests = signal(0);
  readonly operationsRequests = signal(0);

  setSlotMinutes(value: string | number): void {
    this.slotMinutes.set(normalizeAppointmentSlotMinutes(value));
  }

  setCalendarLayout(value: string): void {
    const allowed = new Set(['grid', 'compact-grid', 'timeline', 'list']);
    this.calendarLayout.set((allowed.has(value) ? value : 'grid') as AppointmentCalendarLayout);
  }

  requestStaffPanelToggle(): void {
    this.staffToggleRequests.update((count) => count + 1);
  }

  requestSafeSlots(): void {
    this.safeSlotRequests.update((count) => count + 1);
  }

  requestOperations(): void {
    this.operationsRequests.update((count) => count + 1);
  }
}
