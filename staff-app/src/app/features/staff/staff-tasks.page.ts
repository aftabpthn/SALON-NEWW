import { DatePipe } from "@angular/common";
import { Component, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { isQueuedMutation, MutationResult, StaffAppService, StaffFieldJob, StaffServiceTarget, StaffTask } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, PaiseInrPipe, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Tasks</p><h1>Tasks</h1></div></header>
      @if (!canReadTasks()) { <section staffPageState class="notice">You do not have permission to read staff tasks.</section> }
      @if (loading() && !tasks()) {
        <section class="tasks-skeleton" aria-label="Loading tasks">
          <div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
          <div class="tasks-skeleton-board"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
        </section>
      }
      @if (loadError()) { <section staffPageState class="notice tasks-error"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" (click)="load()">Retry</button></section> }
      @if (targetLoadError() && tasks()) { <section class="optional-warning" role="status"><span aria-hidden="true">!</span><div><p>Service targets could not refresh.</p><small>Your assigned tasks remain available.</small></div><button type="button" class="text-control" [disabled]="loading()" (click)="load()">Retry</button></section> }
      @if (message()) { <section staffPageState class="notice success" role="status">{{ message() }}</section> }
      @if (localError()) { <section staffPageState class="notice">{{ localError() }}</section> }
      @if (canReadTasks() && tasks(); as data) {
        <section class="panel field-jobs">
          <div class="panel-title"><h2>Field jobs</h2><span>{{ fieldJobs().length }}</span></div>
          <div class="list">
            @for (job of fieldJobs(); track job.id) {
              <article class="kanban-card field-job-card"><div class="task-heading"><strong>{{ job.clientName }}</strong><span class="badge">{{ job.status }}</span></div><p>{{ job.serviceNames }} · {{ job.address }}</p><small>{{ job.scheduledStartAt ? (job.scheduledStartAt | date:'dd/MM/yyyy, HH:mm') : 'Schedule pending' }} · {{ job.travelMinutes }} min · priority {{ job.priority }}</small>
                <div class="row-actions task-actions">
                  @if (job.status === 'assigned') { <button type="button" class="button" [disabled]="!!pendingFieldJobId()" (click)="moveFieldJob(job, 'accepted')">Accept</button> }
                  @if (job.status === 'accepted') { <button type="button" class="button" [disabled]="!!pendingFieldJobId()" (click)="moveFieldJob(job, 'en_route')">En route</button> }
                  @if (job.status === 'en_route') { <button type="button" class="button" [disabled]="!!pendingFieldJobId()" (click)="moveFieldJob(job, 'arrived')">Arrived</button> }
                  @if (job.status === 'accepted' || job.status === 'en_route' || job.status === 'arrived') { <button type="button" class="link-button" (click)="toggleGps(job)">{{ gpsJobId() === job.id ? 'Stop GPS' : 'Share GPS' }}</button> }
                  @if (job.status === 'arrived') { <button type="button" class="link-button" (click)="proofJobId.set(job.id)">Service proof</button> }
                  @if (job.status === 'arrived' && job.proofSubmittedAt) { <button type="button" class="button" [disabled]="!!pendingFieldJobId()" (click)="moveFieldJob(job, 'completed')">Complete</button> }
                </div>
                @if (proofJobId() === job.id) { <form class="proof-form" (submit)="$event.preventDefault(); submitProof(job)"><input name="customerName" [(ngModel)]="proofCustomerName" placeholder="Customer name" required><textarea name="completionNote" [(ngModel)]="proofCompletionNote" maxlength="1000" placeholder="Completion note"></textarea><button type="submit" class="button" [disabled]="!proofCustomerName.trim() || !!pendingFieldJobId()">Confirm service</button></form> }
              </article>
            } @empty { <div class="tasks-empty"><p>No field jobs assigned.</p></div> }
          </div>
        </section>
        @if (serviceTargets().length) {
          <section class="panel target-panel">
            <div class="panel-title"><h2>Service targets</h2><span>{{ loading() ? 'Refreshing...' : serviceTargets().length }}</span></div>
            <div class="target-grid">
              @for (target of serviceTargets(); track target.id) {
                <article class="target-card">
                  <div class="target-card-head"><div><strong>{{ target.serviceName }}</strong><small>{{ target.startsOn | date:'dd/MM/yyyy' }} - {{ target.endsOn | date:'dd/MM/yyyy' }}</small></div><span class="badge" [class.green]="target.progressStatus === 'completed'">{{ target.progressStatus }}</span></div>
                  <div class="target-score"><strong>{{ target.achievedCount }}/{{ target.targetCount }}</strong><span>{{ target.progressPercent }}%</span></div>
                  <div class="target-progress" role="progressbar" [attr.aria-valuenow]="target.progressPercent" aria-valuemin="0" aria-valuemax="100"><i [style.width.%]="target.progressPercent"></i></div>
                  <div class="target-ticks" [attr.aria-label]="target.achievedCount + ' of ' + target.targetCount + ' completed'">
                    @for (tick of targetTicks(target); track $index) { <span [class.done]="$index < target.achievedCount">{{ $index < target.achievedCount ? '✓' : '' }}</span> }
                  </div>
                  @if (target.rewardType !== 'none') { <p class="target-reward"><b>Reward:</b> {{ target.rewardType === 'bonus' ? (target.rewardAmountPaise | paiseInr) : target.rewardDescription }}</p> }
                </article>
              }
            </div>
          </section>
        }
        <section class="grid four"><article class="kpi"><span>Assigned</span><strong>{{ data.length }}</strong></article><article class="kpi"><span>Open</span><strong>{{ taskCount('open') }}</strong></article><article class="kpi"><span>Blocked</span><strong>{{ taskCount('blocked') }}</strong></article><article class="kpi"><span>Done</span><strong>{{ taskCount('completed') }}</strong></article></section>
        <section class="kanban-board">
          @for (column of columns; track column.status) {
            <article class="panel kanban-column" (dragover)="$event.preventDefault()" (drop)="dropTask(column.status)">
              <div class="panel-title"><h2>{{ column.label }}</h2><span>{{ loading() ? 'Refreshing...' : taskCount(column.status) }}</span></div>
              <div class="list">
                @for (task of tasksByStatus(column.status); track task.id) {
                   <div class="kanban-card task-card" draggable="true" (dragstart)="dragTask(task.id, task.version)" [class.pending]="pendingTaskId() === task.id"><div class="task-heading"><strong>{{ task.title }}</strong>@if (task.taskType === 'training' || task.taskType === 'compliance') { <span class="pill">{{ task.taskType === 'training' ? 'SOP' : 'Rule' }}</span> }</div>@if (task.description) { <p>{{ task.description }}</p> }<small>{{ task.priority || 'medium' }} · {{ task.dueAt ? (task.dueAt | date:'short') : 'no due date' }}@if (task.clientId) { · Guest linked }@if (task.appointmentId) { · Appointment linked }</small><div class="row-actions task-actions"><span class="badge">{{ task.status || 'open' }}</span>@if (canUpdateTasks() && (!task.status || task.status === 'open')) { <button type="button" class="link-button" [disabled]="!!pendingTaskId()" [attr.aria-busy]="pendingTaskId() === task.id" (click)="moveTask(task.id, task.version, 'in_progress')">{{ pendingTaskId() === task.id ? 'Saving...' : 'Start' }}</button> } @if (canUpdateTasks() && task.status === 'blocked') { <button type="button" class="link-button" [disabled]="!!pendingTaskId()" [attr.aria-busy]="pendingTaskId() === task.id" (click)="moveTask(task.id, task.version, 'in_progress')">{{ pendingTaskId() === task.id ? 'Saving...' : 'Resume' }}</button> } @if (canUpdateTasks() && task.status === 'in_progress') { <button type="button" class="button" [disabled]="!!pendingTaskId()" [attr.aria-busy]="pendingTaskId() === task.id" (click)="completeTask(task.id, task.version)">{{ pendingTaskId() === task.id ? 'Saving...' : 'Done' }}</button> } @if (canUpdateTasks() && task.status === 'completed') { <button type="button" class="link-button" [disabled]="!!pendingTaskId()" [attr.aria-busy]="pendingTaskId() === task.id" (click)="moveTask(task.id, task.version, 'open')">{{ pendingTaskId() === task.id ? 'Saving...' : 'Reopen' }}</button> }</div></div>
                } @empty { <div class="tasks-empty"><p>No {{ column.label.toLowerCase() }} tasks.</p><small>{{ column.status === 'open' ? 'Assigned CRM tasks will appear here.' : 'Move tasks here when status changes.' }}</small></div> }
              </div>
            </article>
          }
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .tasks-skeleton { display: grid; gap: 12px; }
    .tasks-skeleton-board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .kanban-board { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .tasks-skeleton-board .skeleton { min-height: 280px; }
    .tasks-error { justify-content: space-between; }
    .task-card.pending { opacity: .72; }
    .task-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .task-card p { margin: 7px 0; color: var(--staff-text-secondary); font-size: .78rem; line-height: 1.45; white-space: pre-wrap; }
    .tasks-empty { display: grid; justify-items: center; gap: 4px; min-height: 96px; padding: 22px 8px; color: var(--staff-text-secondary); font-weight: 600; text-align: center; }
    .tasks-empty p { margin: 0; }
    .tasks-empty small { font-weight: 600; }
    .task-actions .button, .task-actions .link-button { min-width: 88px; }
    .field-jobs { margin-bottom: 14px; }
    .field-job-card { margin-bottom: 8px; }
    .proof-form { display: grid; gap: 8px; margin-top: 8px; }
    .proof-form input, .proof-form textarea { min-height: 42px; border: 1px solid var(--staff-border); border-radius: 8px; padding: 9px; font: inherit; }
    @media (max-width: 700px) {
      .tasks-skeleton-board { grid-template-columns: 1fr; }
      .tasks-error, .task-actions { align-items: stretch; flex-direction: column; }
      .tasks-error button, .task-actions .button, .task-actions .link-button { width: 100%; }
      .task-actions .badge { width: fit-content; }
    }
    @media (min-width: 701px) and (max-width: 1100px) { .kanban-board { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `]
})
export class StaffTasksPage implements OnInit, OnDestroy {
  readonly tasks = signal<StaffTask[] | null>(null);
  readonly fieldJobs = signal<StaffFieldJob[]>([]);
  readonly serviceTargets = signal<StaffServiceTarget[]>([]);
  readonly loading = signal(false);
  readonly message = signal("");
  readonly localError = signal("");
  readonly loadError = signal("");
  readonly targetLoadError = signal("");
  readonly pendingTaskId = signal("");
  readonly draggedTask = signal<{ id: string; version: number } | null>(null);
  readonly pendingFieldJobId = signal("");
  readonly gpsJobId = signal("");
  readonly proofJobId = signal("");
  proofCustomerName = "";
  proofCompletionNote = "";
  private gpsWatchId: number | null = null;
  private lastGpsSentAt = 0;
  private socket: WebSocket | null = null;
  private pollTimer = 0;
  private reconnectTimer = 0;
  private destroyed = false;
  readonly columns = [{ label: "Open", status: "open" }, { label: "In Progress", status: "in_progress" }, { label: "Blocked", status: "blocked" }, { label: "Done", status: "completed" }];
  constructor(readonly staff: StaffAppService) {}
  ngOnInit() { if (this.canReadTasks()) { void this.load(); void this.connectRealtime(); this.pollTimer = window.setInterval(() => { if (navigator.onLine && document.visibilityState === "visible") void this.load(); }, 15000); } }
  ngOnDestroy() { this.destroyed = true; this.stopGps(); window.clearInterval(this.pollTimer); window.clearTimeout(this.reconnectTimer); this.socket?.close(); }
  async load() {
    this.loading.set(true); this.loadError.set(""); this.targetLoadError.set("");
    try { this.tasks.set(await this.staff.tasks()); }
    catch { this.loadError.set(this.staff.error() || "Unable to load tasks."); this.loading.set(false); return; }
    try { this.fieldJobs.set(await this.staff.fieldJobs()); }
    catch { this.localError.set("Field jobs could not refresh."); }
    try { this.serviceTargets.set(await this.staff.serviceTargets()); }
    catch { this.targetLoadError.set("Unable to load service targets."); }
    finally { this.loading.set(false); }
  }
  canReadTasks(): boolean { return this.staff.hasPermission("staff.app.tasks.read"); }
  canUpdateTasks(): boolean { return this.staff.hasPermission("staff.app.tasks.manage"); }
  taskCount(status: string): number { return this.tasksByStatus(status).length; }
  tasksByStatus(status: string) { return (this.tasks() || []).filter((task) => status === "open" ? !task.status || task.status === "open" : task.status === status); }
  targetTicks(target: StaffServiceTarget): number[] { return Array.from({ length: Math.min(target.targetCount, 30) }); }
  dragTask(id: string, version: number) { this.draggedTask.set({ id, version }); }
  async dropTask(status: string) { const task = this.draggedTask(); if (!task || !this.canUpdateTasks()) return; await this.mutateTask(task.id, () => this.staff.moveTask(task.id, task.version, status), `Task moved to ${status.replace(/_/g, " ")}.`); this.draggedTask.set(null); }
  async moveTask(taskId: string, version: number, status: string) { await this.mutateTask(taskId, () => this.staff.moveTask(taskId, version, status), `Task moved to ${status.replace(/_/g, " ")}.`); }
  async completeTask(taskId: string, version: number) { await this.mutateTask(taskId, () => this.staff.completeTask(taskId, version), "Task completed."); }
  async moveFieldJob(job: StaffFieldJob, status: string) {
    if (this.pendingFieldJobId()) return; this.pendingFieldJobId.set(job.id); this.localError.set("");
    try { await this.staff.updateFieldJobStatus(job.id, status); if (status === "completed" || status === "arrived") this.stopGps(); this.message.set(`Field job ${status.replace(/_/g, " ")}.`); this.fieldJobs.set(await this.staff.fieldJobs()); }
    catch { this.localError.set(this.staff.error() || "Unable to update field job."); }
    finally { this.pendingFieldJobId.set(""); }
  }
  toggleGps(job: StaffFieldJob) {
    if (this.gpsJobId() === job.id) { this.stopGps(); return; }
    this.stopGps();
    if (typeof navigator === "undefined" || !navigator.geolocation) { this.localError.set("GPS is not available on this device."); return; }
    this.gpsJobId.set(job.id); this.lastGpsSentAt = 0;
    this.gpsWatchId = navigator.geolocation.watchPosition((position) => {
      const now = Date.now(); if (now - this.lastGpsSentAt < 30_000) return; this.lastGpsSentAt = now;
      void this.staff.updateFieldJobLocation(job.id, position.coords.latitude, position.coords.longitude, position.coords.accuracy).catch(() => this.localError.set(this.staff.error() || "GPS location could not be shared."));
    }, () => { this.localError.set("GPS permission is required for live tracking."); this.stopGps(); }, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 });
  }
  async submitProof(job: StaffFieldJob) {
    if (!this.proofCustomerName.trim() || this.pendingFieldJobId()) return; this.pendingFieldJobId.set(job.id); this.localError.set("");
    try { await this.staff.submitFieldJobProof(job.id, this.proofCustomerName, this.proofCompletionNote); this.proofJobId.set(""); this.proofCustomerName = ""; this.proofCompletionNote = ""; this.message.set("Service proof saved."); this.fieldJobs.set(await this.staff.fieldJobs()); }
    catch { this.localError.set(this.staff.error() || "Service proof could not be saved."); }
    finally { this.pendingFieldJobId.set(""); }
  }
  private stopGps() { if (this.gpsWatchId !== null && typeof navigator !== "undefined") navigator.geolocation.clearWatch(this.gpsWatchId); this.gpsWatchId = null; this.gpsJobId.set(""); }
  private async connectRealtime() {
    if (this.destroyed || !navigator.onLine || this.socket) return;
    try {
      const url = await this.staff.realtimeSocketTicketUrl(); if (!url || this.destroyed) return;
      const socket = new WebSocket(url, this.staff.realtimeSocketProtocols()); this.socket = socket;
      socket.onmessage = (event) => { try { if (JSON.parse(String(event.data))?.type === "staff.task.updated") void this.load(); } catch {} };
      socket.onerror = () => socket.close();
      socket.onclose = () => { if (this.socket === socket) this.socket = null; if (!this.destroyed) this.reconnectTimer = window.setTimeout(() => void this.connectRealtime(), 5000); };
    } catch { if (!this.destroyed) this.reconnectTimer = window.setTimeout(() => void this.connectRealtime(), 5000); }
  }
  private async mutateTask(taskId: string, mutate: () => Promise<MutationResult<unknown>>, completedMessage: string) {
    if (this.pendingTaskId()) return;
    this.pendingTaskId.set(taskId);
    this.message.set("");
    this.localError.set("");
    try {
      const result = await mutate();
      if (isQueuedMutation(result)) { this.message.set(`Offline task change queued for sync (${result.queueId}).`); return; }
      this.message.set(completedMessage);
      await this.load();
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aura:tasks-updated"));
    } catch { this.localError.set(this.staff.error() || "Unable to update the task."); }
    finally { this.pendingTaskId.set(""); }
  }
}
