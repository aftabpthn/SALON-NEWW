import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

type Tab = 'queue' | 'classes' | 'amenities' | 'challenges' | 'utilization';

type QueueEntry = {
  id: string; clientId: string; clientName: string; serviceIds: string[];
  requestedStaffId?: string; assignedStaffId?: string; priority: number;
  durationMinutes: number; status: string; estimatedStartAt?: string;
  checkedInAt: string; notes?: string; version: number;
};
type ClassTemplate = {
  id: string; name: string; serviceId: string; durationMinutes: number;
  capacity: number; waitlistCapacity: number; roomResourceId?: string; active: boolean;
};
type ClassSession = {
  id: string; templateId: string; name: string; instructorStaffId: string; instructorName: string;
  roomResourceId?: string; startsAt: string; endsAt: string; capacity: number; status: string;
  bookedCount: number; waitlistCount: number;
};
type Amenity = { id: string; name: string; kind: string; active: boolean };
type Challenge = {
  id: string; name: string; startsOn: string; endsOn: string;
  targetValue: number; metric: string; status: string; participants: number;
};
type Summary = {
  queue: QueueEntry[]; classTemplates: ClassTemplate[]; classSessions: ClassSession[];
  amenities: Amenity[]; challenges: Challenge[];
};
type UtilizationClass = {
  id: string; name: string; starts_at: string; capacity: number;
  booked_count: number; attended_count: number; utilization_percent: number | null;
};
type Utilization = {
  queue: { total: number; completed: number; averageWaitMinutes: number };
  classes: UtilizationClass[]; from: string; to: string;
};

/**
 * The gym and studio workspace: walk-in queue, classes, amenities, lockers,
 * challenges and utilization.
 *
 * The backend for all of this has been live and tested with no way to reach it.
 * `/fitness/summary` returns the whole workspace in one read, so this page is
 * one load and one refresh after each change rather than a request per panel.
 *
 * Status buttons offer only the transitions the server accepts
 * (`queue_transition_allowed`, `registration_transition_allowed`). Offering a
 * move that will be refused teaches people to distrust the buttons.
 */
@Component({
  selector: 'page-fitness',
  imports: [CommonModule, FormsModule],
  templateUrl: './fitness-page.component.html',
  styleUrls: ['./fitness-page.component.css'],
})
export class FitnessPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly tabs: Array<{ key: Tab; label: string; icon: string }> = [
    { key: 'queue', label: 'Walk-in queue', icon: 'bi-people' },
    { key: 'classes', label: 'Classes', icon: 'bi-calendar-week' },
    { key: 'amenities', label: 'Amenities & lockers', icon: 'bi-door-closed' },
    { key: 'challenges', label: 'Challenges', icon: 'bi-trophy' },
    { key: 'utilization', label: 'Utilization', icon: 'bi-graph-up' },
  ];
  /** Only the moves the server will accept from each state. */
  readonly queueMoves: Record<string, string[]> = {
    waiting: ['called', 'cancelled'],
    called: ['in_service', 'no_show', 'cancelled'],
    in_service: ['completed'],
  };

  tab: Tab = 'queue';
  loading = true; busy = false; error = ''; message = '';
  summary: Summary = { queue: [], classTemplates: [], classSessions: [], amenities: [], challenges: [] };
  utilization?: Utilization;
  drawer: 'queue' | 'template' | 'session' | 'amenity' | 'challenge' | 'register' | '' = '';
  selectedSession?: ClassSession;

  queueDraft = { clientId: '', serviceIds: '', requestedStaffId: '', priority: '0', notes: '' };
  templateDraft = { name: '', serviceId: '', durationMinutes: '60', capacity: '12', waitlistCapacity: '4', roomResourceId: '' };
  sessionDraft = { templateId: '', instructorStaffId: '', roomResourceId: '', startsAt: '', frequency: 'none', count: '1' };
  amenityDraft = { name: '', kind: 'locker' };
  challengeDraft = { name: '', startsOn: '', endsOn: '', targetValue: '', metric: 'visits' };
  registerDraft = { clientId: '', notes: '' };
  reportRange = { from: '', to: '' };

  ngOnInit(): void {
    const today = new Date();
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    this.reportRange = { from: this.dateInput(monthAgo), to: this.dateInput(today) };
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    try {
      this.summary = await this.get<Summary>('/fitness/summary');
      this.error = '';
    } catch (error) {
      this.error = this.errorMessage(error, 'Fitness workspace could not be loaded');
    } finally {
      this.loading = false;
    }
  }

  // ---- walk-in queue ----
  openQueue() { this.queueDraft = { clientId: '', serviceIds: '', requestedStaffId: '', priority: '0', notes: '' }; this.drawer = 'queue'; }
  async addToQueue() {
    const serviceIds = this.queueDraft.serviceIds.split(',').map((v) => v.trim()).filter(Boolean);
    if (!this.queueDraft.clientId.trim() || !serviceIds.length) { this.error = 'A client and at least one service are required.'; return; }
    await this.mutate('/fitness/queue', {
      clientId: this.queueDraft.clientId.trim(), serviceIds,
      requestedStaffId: this.queueDraft.requestedStaffId.trim() || undefined,
      priority: Number(this.queueDraft.priority || 0),
      notes: this.queueDraft.notes.trim() || undefined,
      idempotencyKey: crypto.randomUUID(),
    }, 'Added to the queue');
  }
  async moveQueue(entry: QueueEntry, status: string) {
    await this.patch(`/fitness/queue/${entry.id}`, { status, expectedVersion: entry.version }, `Queue entry ${this.label(status)}`);
  }

  // ---- classes ----
  openTemplate() { this.templateDraft = { name: '', serviceId: '', durationMinutes: '60', capacity: '12', waitlistCapacity: '4', roomResourceId: '' }; this.drawer = 'template'; }
  async saveTemplate() {
    await this.mutate('/fitness/class-templates', {
      name: this.templateDraft.name.trim(), serviceId: this.templateDraft.serviceId.trim(),
      durationMinutes: Number(this.templateDraft.durationMinutes), capacity: Number(this.templateDraft.capacity),
      waitlistCapacity: Number(this.templateDraft.waitlistCapacity || 0),
      roomResourceId: this.templateDraft.roomResourceId.trim() || undefined,
    }, 'Class template created');
  }
  openSession() { this.sessionDraft = { templateId: '', instructorStaffId: '', roomResourceId: '', startsAt: '', frequency: 'none', count: '1' }; this.drawer = 'session'; }
  async saveSession() {
    if (!this.sessionDraft.startsAt) { this.error = 'A start time is required.'; return; }
    await this.mutate('/fitness/class-sessions', {
      templateId: this.sessionDraft.templateId, instructorStaffId: this.sessionDraft.instructorStaffId.trim(),
      roomResourceId: this.sessionDraft.roomResourceId.trim() || undefined,
      startsAt: new Date(this.sessionDraft.startsAt).toISOString(),
      frequency: this.sessionDraft.frequency === 'none' ? undefined : this.sessionDraft.frequency,
      count: Number(this.sessionDraft.count || 1),
      idempotencyKey: crypto.randomUUID(),
    }, 'Sessions scheduled');
  }
  openRegister(session: ClassSession) { this.selectedSession = session; this.registerDraft = { clientId: '', notes: '' }; this.drawer = 'register'; }
  async register() {
    if (!this.selectedSession) return;
    await this.mutate(`/fitness/class-sessions/${this.selectedSession.id}/registrations`, {
      clientId: this.registerDraft.clientId.trim(),
      notes: this.registerDraft.notes.trim() || undefined,
      idempotencyKey: crypto.randomUUID(),
    }, 'Client registered');
  }

  // ---- amenities and lockers ----
  openAmenity() { this.amenityDraft = { name: '', kind: 'locker' }; this.drawer = 'amenity'; }
  async saveAmenity() {
    await this.mutate('/fitness/amenities', { name: this.amenityDraft.name.trim(), kind: this.amenityDraft.kind }, 'Amenity created');
  }
  async assignLocker(amenity: Amenity) {
    const clientId = window.prompt(`Assign ${amenity.name} to which client id?`)?.trim();
    if (!clientId) return;
    await this.mutate(`/fitness/lockers/${amenity.id}/assign`, { clientId }, 'Locker assigned');
  }

  // ---- challenges ----
  openChallenge() { this.challengeDraft = { name: '', startsOn: '', endsOn: '', targetValue: '', metric: 'visits' }; this.drawer = 'challenge'; }
  async saveChallenge() {
    await this.mutate('/fitness/challenges', {
      name: this.challengeDraft.name.trim(), startsOn: this.challengeDraft.startsOn,
      endsOn: this.challengeDraft.endsOn, targetValue: Number(this.challengeDraft.targetValue || 0),
      metric: this.challengeDraft.metric,
    }, 'Challenge created');
  }
  async joinChallenge(challenge: Challenge) {
    const clientId = window.prompt(`Add which client id to ${challenge.name}?`)?.trim();
    if (!clientId) return;
    await this.mutate(`/fitness/challenges/${challenge.id}/participants`, { clientId }, 'Participant added');
  }

  // ---- utilization ----
  async loadUtilization() {
    if (!this.reportRange.from || !this.reportRange.to) { this.error = 'Choose both dates.'; return; }
    this.busy = true; this.error = '';
    try {
      const from = new Date(`${this.reportRange.from}T00:00:00`).toISOString();
      const to = new Date(`${this.reportRange.to}T23:59:59`).toISOString();
      this.utilization = await this.get<Utilization>(`/fitness/reports/utilization?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    } catch (error) {
      this.utilization = undefined;
      this.error = this.errorMessage(error, 'Utilization report could not be built');
    } finally { this.busy = false; }
  }

  // ---- helpers ----
  label(value?: string) { return value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : '—'; }
  date(value?: string) { return value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
  time(value?: string) { return value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }
  /** Booked against capacity, floored at nothing and capped at nothing — an over-booked class should read as over-booked. */
  fillPercent(session: ClassSession) { return session.capacity > 0 ? Math.round((session.bookedCount / session.capacity) * 100) : 0; }
  movesFor(status: string) { return this.queueMoves[status] ?? []; }
  closeDrawer() { this.drawer = ''; this.selectedSession = undefined; }

  private dateInput(value: Date) { return value.toISOString().slice(0, 10); }
  private async get<T>(path: string) {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path));
    if (response.data === undefined) throw new Error(response.error?.message || 'API response missing data');
    return response.data;
  }
  private async mutate(path: string, body: unknown, success: string) {
    this.busy = true; this.error = ''; this.message = '';
    try {
      await firstValueFrom(this.api.post<ApiEnvelope<unknown>>(path, body));
      this.message = success;
      this.closeDrawer();
      await this.reload();
    } catch (error) {
      this.error = this.errorMessage(error, 'The change could not be saved');
    } finally { this.busy = false; }
  }
  private async patch(path: string, body: unknown, success: string) {
    this.busy = true; this.error = ''; this.message = '';
    try {
      await firstValueFrom(this.api.patch<ApiEnvelope<unknown>>(path, body));
      this.message = success;
      await this.reload();
    } catch (error) {
      this.error = this.errorMessage(error, 'The change could not be saved');
    } finally { this.busy = false; }
  }
  private errorMessage(error: unknown, fallback: string) {
    const body = (error as { error?: { error?: { message?: string } } })?.error?.error?.message;
    if (typeof body === 'string' && body.trim()) return body;
    return error instanceof Error && error.message ? error.message : fallback;
  }
}
