import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type Action = 'all' | 'added' | 'stopped' | 'edited' | 'saved' | 'submitted' | 'approved' | 'deactivated' | 'archived' | 'cancelled' | 'withdrawn' | 'revoked' | 'disconnected' | 'drafted' | 'rejected' | 'restored' | 'voided' | 'reversed' | 'deleted';
interface AuditEvent { id: string; actorName: string; identity?: string; eventType: string; outcome: string; ipAddress?: string; detailsJson: Record<string, unknown>; createdAt: string; }
interface RestoreTarget { path: string; body: Record<string, unknown>; permission: string; }

@Component({
  selector: 'app-activity-recovery-page',
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './activity-recovery-page.component.html',
  styleUrls: ['./activity-recovery-page.component.css'],
})
export class ActivityRecoveryPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly actions: Action[] = ['all', 'added', 'stopped', 'edited', 'saved', 'submitted', 'approved', 'deactivated', 'archived', 'cancelled', 'withdrawn', 'revoked', 'disconnected', 'drafted', 'rejected', 'restored', 'voided', 'reversed', 'deleted'];
  readonly tabs: { key: Action | 'restorable'; label: string }[] = [
    { key: 'all', label: 'All Activity' }, { key: 'restorable', label: 'Restorable' }, { key: 'archived', label: 'Archived' },
    { key: 'deactivated', label: 'Deactivated' }, { key: 'cancelled', label: 'Cancelled' }, { key: 'withdrawn', label: 'Withdrawn' },
    { key: 'revoked', label: 'Revoked' }, { key: 'disconnected', label: 'Disconnected' },
  ];
  events: AuditEvent[] = [];
  loading = true;
  error = '';
  notice = '';
  search = '';
  action: Action = 'all';
  module = 'all';
  status = 'all';
  fromDate = '';
  toDate = '';
  activeTab: Action | 'restorable' = 'all';
  selected?: AuditEvent;
  restoringId = '';
  visibleCount = 8;

  ngOnInit() { void this.reload(); }
  get modules() { return [...new Set(this.events.map((event) => this.moduleName(event)))].sort(); }
  get filteredEvents() {
    const query = this.search.trim().toLowerCase();
    return this.events.filter((event) => {
      const action = this.actionName(event);
      const module = this.moduleName(event);
      const created = event.createdAt.slice(0, 10);
      return (!query || [module, action, this.recordName(event), event.actorName, this.reason(event), event.eventType].some((value) => value.toLowerCase().includes(query)))
        && (this.action === 'all' || action === this.action) && (this.module === 'all' || module === this.module)
        && (this.status === 'all' || (this.status === 'success' ? event.outcome === 'success' : event.outcome !== 'success'))
        && (!this.fromDate || created >= this.fromDate) && (!this.toDate || created <= this.toDate)
      && (this.activeTab === 'all' || (this.activeTab === 'restorable' ? this.canRestore(event) : action === this.activeTab));
    });
  }
  get visibleEvents() { return this.filteredEvents.slice(0, this.visibleCount); }
  get relatedEvents() {
    if (!this.selected) return [];
    const key = this.recoveryKey(this.selected);
    return key ? this.events.filter((event) => this.recoveryKey(event) === key).reverse() : [this.selected];
  }

  async reload() {
    this.loading = true; this.error = '';
    try {
      const response = await firstValueFrom(this.api.get<ApiEnvelope<{ events: AuditEvent[] }>>(`/security/audit?q=${encodeURIComponent(this.search.trim())}`));
      this.events = response.data?.events ?? [];
    } catch (error) { this.error = this.message(error, 'Activity records could not be loaded.'); }
    finally { this.loading = false; }
  }
  setTab(tab: Action | 'restorable') { this.activeTab = tab; this.visibleCount = 8; }
  showMore() { this.visibleCount += 8; }
  showLess() { this.visibleCount = 8; }
  openDetails(event: AuditEvent) { this.selected = event; }
  closeDetails() { this.selected = undefined; }
  async restore(event: AuditEvent) {
    const target = this.restoreTarget(event);
    if (!target || !this.canRestore(event) || !confirm(`Restore ${this.recordName(event)}?`)) return;
    this.restoringId = event.id; this.error = ''; this.notice = '';
    try {
      await firstValueFrom(this.api.post<ApiEnvelope<unknown>>(target.path, target.body));
      this.notice = `${this.recordName(event)} restored.`; this.selected = undefined; await this.reload();
    } catch (error) { this.error = this.message(error, 'Record could not be restored. Refresh and try again.'); }
    finally { this.restoringId = ''; }
  }
  canRestore(event: AuditEvent) {
    const target = this.restoreTarget(event);
    return Boolean(target && event.outcome === 'success' && event.detailsJson['restorable'] === true && !this.wasRestored(event)
      && (this.auth.hasRole('owner', 'admin', 'manager') || this.auth.hasPermission(target.permission, 'management.write')));
  }
  actionName(event: AuditEvent): Action {
    const value = event.eventType.toLowerCase();
    const pairs: [RegExp, Action][] = [[/disconnect/, 'disconnected'], [/deactiv/, 'deactivated'], [/withdraw/, 'withdrawn'], [/archive/, 'archived'], [/cancel/, 'cancelled'], [/revoke/, 'revoked'], [/restore/, 'restored'], [/reject/, 'rejected'], [/approv/, 'approved'], [/submit/, 'submitted'], [/stop|pause/, 'stopped'], [/draft/, 'drafted'], [/edit|updated/, 'edited'], [/save/, 'saved'], [/add|created/, 'added'], [/void/, 'voided'], [/revers/, 'reversed'], [/delete/, 'deleted']];
    return pairs.find(([pattern]) => pattern.test(value))?.[1] ?? 'saved';
  }
  moduleName(event: AuditEvent) {
    const parts = event.eventType.replace(/^security\./, '').split(/[._-]+/).filter(Boolean);
    while (parts.length > 1 && /^(added|created|stopped|paused|edited|updated|saved|submitted|approved|deactivated|archived|cancelled|canceled|withdrawn|revoked|disconnected|drafted|draft|rejected|restored|voided|reversed|deleted)$/.test(parts.at(-1) ?? '')) parts.pop();
    return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || 'System';
  }
  recordName(event: AuditEvent) {
    for (const key of ['recordName', 'reportName', 'title', 'name', 'code']) { const value = event.detailsJson[key]; if (typeof value === 'string' && value.trim()) return value; }
    return this.recordId(event) || '—';
  }
  recordId(event: AuditEvent) {
    for (const key of ['packageId', 'membershipId', 'reportId', 'campaignPlanId', 'leaveRequestId', 'clientId', 'staffId', 'serviceId', 'appointmentId', 'invoiceId', 'paymentId', 'id']) { const value = event.detailsJson[key]; if (typeof value === 'string' && value) return value; }
    return '';
  }
  reason(event: AuditEvent) {
    for (const key of ['reason', 'reviewNote', 'comment', 'message']) { const value = event.detailsJson[key]; if (typeof value === 'string' && value.trim()) return value; }
    return '—';
  }
  formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(date); }
  private restoreTarget(event: AuditEvent): RestoreTarget | undefined {
    const id = this.recordId(event); const version = Number(event.detailsJson['version']); const type = event.eventType.toLowerCase();
    if (!id) return;
    if (type.includes('package.archived')) return { path: `/packages/${id}/restore`, body: {}, permission: 'packages.manage' };
    if (type.includes('membership.archived')) return { path: `/memberships/${id}/restore`, body: {}, permission: 'memberships.manage' };
    if (type.includes('custom-report.archived') && version > 0) return { path: `/reports/custom/${id}/lifecycle`, body: { action: 'restore', version }, permission: 'reports.manage' };
    if (type.includes('whatsapp.campaign.archived') && version > 0) return { path: `/whatsapp-campaign-planner/plans/${id}/restore`, body: { version }, permission: 'marketing.manage' };
    if (type.includes('staff.leave.withdrawn') && version > 0) return { path: `/staff-leave/requests/${id}/restore`, body: { version }, permission: 'staff.leave.manage' };
    return;
  }
  private recoveryKey(event: AuditEvent) { return `${this.moduleName(event)}:${this.recordId(event)}`; }
  private wasRestored(event: AuditEvent) { const key = this.recoveryKey(event); return this.events.some((candidate) => candidate.createdAt > event.createdAt && this.recoveryKey(candidate) === key && this.actionName(candidate) === 'restored'); }
  private message(error: unknown, fallback: string) { const value = error as { error?: { error?: { message?: string }; message?: string } }; return value?.error?.error?.message ?? value?.error?.message ?? fallback; }
}
