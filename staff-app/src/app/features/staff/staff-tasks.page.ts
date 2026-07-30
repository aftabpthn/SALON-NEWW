import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { isQueuedMutation, MutationResult, StaffAppService, StaffServiceTarget, StaffToday } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, PaiseInrPipe, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Tasks</p><h1>Tasks</h1></div></header>
      @if (!canReadTasks()) { <section staffPageState class="notice">You do not have permission to read staff tasks.</section> }
      @if (loading() && !today()) {
        <section class="tasks-skeleton" aria-label="Loading tasks">
          <div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
          <div class="tasks-skeleton-board"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
        </section>
      }
      @if (loadError()) { <section staffPageState class="notice tasks-error"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" (click)="load()">Retry</button></section> }
      @if (message()) { <section staffPageState class="notice success" role="status">{{ message() }}</section> }
      @if (localError()) { <section staffPageState class="notice">{{ localError() }}</section> }
      @if (staff.error() && !localError() && !loadError()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
      @if (canReadTasks() && today(); as data) {
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
        <section class="grid four"><article class="kpi"><span>Today</span><strong>{{ data.tasks.length }}</strong></article><article class="kpi"><span>Open</span><strong>{{ taskCount('open') }}</strong></article><article class="kpi"><span>In progress</span><strong>{{ taskCount('in_progress') }}</strong></article><article class="kpi"><span>Done</span><strong>{{ taskCount('completed') }}</strong></article></section>
        <section class="kanban-board">
          @for (column of columns; track column.status) {
            <article class="panel kanban-column" (dragover)="$event.preventDefault()" (drop)="dropTask(column.status)">
              <div class="panel-title"><h2>{{ column.label }}</h2><span>{{ loading() ? 'Refreshing...' : taskCount(column.status) }}</span></div>
              <div class="list">
                @for (task of tasksByStatus(column.status); track task.id) {
                   <div class="kanban-card task-card" draggable="true" (dragstart)="dragTask(task.id, task.version)" [class.pending]="pendingTaskId() === task.id"><div class="task-heading"><strong>{{ task.title }}</strong>@if (task.taskType === 'training' || task.taskType === 'compliance') { <span class="pill">{{ task.taskType === 'training' ? 'SOP' : 'Rule' }}</span> }</div>@if (task.description) { <p>{{ task.description }}</p> }<small>{{ task.priority || 'medium' }} · {{ task.dueAt ? (task.dueAt | date:'short') : 'no due date' }}</small><div class="row-actions task-actions"><span class="badge">{{ task.status || 'open' }}</span>@if (canUpdateTasks() && (!task.status || task.status === 'open')) { <button type="button" class="link-button" [disabled]="!!pendingTaskId()" [attr.aria-busy]="pendingTaskId() === task.id" (click)="moveTask(task.id, task.version, 'in_progress')">{{ pendingTaskId() === task.id ? 'Saving...' : 'Start' }}</button> } @if (canUpdateTasks() && task.status === 'in_progress') { <button type="button" class="button" [disabled]="!!pendingTaskId()" [attr.aria-busy]="pendingTaskId() === task.id" (click)="completeTask(task.id, task.version)">{{ pendingTaskId() === task.id ? 'Saving...' : 'Done' }}</button> } @if (canUpdateTasks() && task.status === 'completed') { <button type="button" class="link-button" [disabled]="!!pendingTaskId()" [attr.aria-busy]="pendingTaskId() === task.id" (click)="moveTask(task.id, task.version, 'open')">{{ pendingTaskId() === task.id ? 'Saving...' : 'Reopen' }}</button> }</div></div>
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
    .tasks-skeleton-board .skeleton { min-height: 280px; }
    .tasks-error { justify-content: space-between; }
    .task-card.pending { opacity: .72; }
    .task-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .task-card p { margin: 7px 0; color: var(--staff-text-secondary); font-size: .78rem; line-height: 1.45; white-space: pre-wrap; }
    .tasks-empty { display: grid; justify-items: center; gap: 4px; min-height: 96px; padding: 22px 8px; color: var(--staff-text-secondary); font-weight: 600; text-align: center; }
    .tasks-empty p { margin: 0; }
    .tasks-empty small { font-weight: 600; }
    .task-actions .button, .task-actions .link-button { min-width: 88px; }
    @media (max-width: 700px) {
      .tasks-skeleton-board { grid-template-columns: 1fr; }
      .tasks-error, .task-actions { align-items: stretch; flex-direction: column; }
      .tasks-error button, .task-actions .button, .task-actions .link-button { width: 100%; }
      .task-actions .badge { width: fit-content; }
    }
  `]
})
export class StaffTasksPage implements OnInit {
  readonly today = signal<StaffToday | null>(null);
  readonly serviceTargets = signal<StaffServiceTarget[]>([]);
  readonly loading = signal(false);
  readonly message = signal("");
  readonly localError = signal("");
  readonly loadError = signal("");
  readonly pendingTaskId = signal("");
  readonly draggedTask = signal<{ id: string; version: number } | null>(null);
  readonly columns = [{ label: "Open", status: "open" }, { label: "In Progress", status: "in_progress" }, { label: "Done", status: "completed" }];
  constructor(readonly staff: StaffAppService) {}
  ngOnInit() { if (this.canReadTasks()) void this.load(); }
  async load() { this.loading.set(true); this.loadError.set(""); try { const [today, targets] = await Promise.all([this.staff.today(), this.staff.serviceTargets()]); this.today.set(today); this.serviceTargets.set(targets); } catch { this.loadError.set(this.staff.error() || "Unable to load tasks."); } finally { this.loading.set(false); } }
  canReadTasks(): boolean { return this.staff.hasPermission("staff.app.tasks.read"); }
  canUpdateTasks(): boolean { return this.staff.hasPermission("staff.app.tasks.manage"); }
  taskCount(status: string): number { return this.tasksByStatus(status).length; }
  tasksByStatus(status: string) { return (this.today()?.tasks || []).filter((task) => status === "open" ? !task.status || task.status === "open" : task.status === status); }
  targetTicks(target: StaffServiceTarget): number[] { return Array.from({ length: Math.min(target.targetCount, 30) }); }
  dragTask(id: string, version: number) { this.draggedTask.set({ id, version }); }
  async dropTask(status: string) { const task = this.draggedTask(); if (!task || !this.canUpdateTasks()) return; await this.mutateTask(task.id, () => this.staff.moveTask(task.id, task.version, status), `Task moved to ${status.replace(/_/g, " ")}.`); this.draggedTask.set(null); }
  async moveTask(taskId: string, version: number, status: string) { await this.mutateTask(taskId, () => this.staff.moveTask(taskId, version, status), `Task moved to ${status.replace(/_/g, " ")}.`); }
  async completeTask(taskId: string, version: number) { await this.mutateTask(taskId, () => this.staff.completeTask(taskId, version), "Task completed."); }
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
