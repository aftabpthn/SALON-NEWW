import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { isQueuedMutation, MutationResult, StaffAppService, StaffToday } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Tasks</p><h1>Task management</h1><p>Assigned checklist and completion workspace.</p></div></header>
      @if (!canReadTasks()) { <section staffPageState class="notice">You do not have permission to read staff tasks.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading tasks...</section> }
      @if (message()) { <section staffPageState class="notice success">{{ message() }}</section> }
      @if (localError()) { <section staffPageState class="notice">{{ localError() }}</section> }
      @if (staff.error() && !localError()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
      @if (canReadTasks() && today(); as data) {
        <section class="grid four"><article class="kpi"><span>Today</span><strong>{{ data.tasks.length }}</strong></article><article class="kpi"><span>Open</span><strong>{{ taskCount('open') }}</strong></article><article class="kpi"><span>In progress</span><strong>{{ taskCount('in_progress') }}</strong></article><article class="kpi"><span>Done</span><strong>{{ taskCount('completed') }}</strong></article></section>
        <section class="kanban-board">
          @for (column of columns; track column.status) {
            <article class="panel kanban-column" (dragover)="$event.preventDefault()" (drop)="dropTask(column.status)">
              <div class="panel-title"><h2>{{ column.label }}</h2><span>{{ taskCount(column.status) }}</span></div>
              <div class="list">
                @for (task of tasksByStatus(column.status); track task.id) {
                   <div class="kanban-card" draggable="true" (dragstart)="dragTask(task.id, task.version)"><strong>{{ task.title }}</strong><small>{{ task.priority || 'medium' }} · {{ task.dueAt ? (task.dueAt | date:'short') : 'no due date' }}</small><div class="row-actions"><span class="badge">{{ task.status || 'open' }}</span>@if (canUpdateTasks() && (!task.status || task.status === 'open')) { <button type="button" class="link-button" [disabled]="!!pendingTaskId()" (click)="moveTask(task.id, task.version, 'in_progress')">Start</button> } @if (canUpdateTasks() && task.status === 'in_progress') { <button type="button" class="link-button" [disabled]="!!pendingTaskId()" (click)="completeTask(task.id, task.version)">Done</button> } @if (canUpdateTasks() && task.status === 'completed') { <button type="button" class="link-button" [disabled]="!!pendingTaskId()" (click)="moveTask(task.id, task.version, 'open')">Reopen</button> }</div></div>
                } @empty { <p class="empty">No {{ column.label.toLowerCase() }} tasks.</p> }
              </div>
            </article>
          }
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffTasksPage implements OnInit {
  readonly today = signal<StaffToday | null>(null);
  readonly loading = signal(false);
  readonly message = signal("");
  readonly localError = signal("");
  readonly pendingTaskId = signal("");
  readonly draggedTask = signal<{ id: string; version: number } | null>(null);
  readonly columns = [{ label: "Open", status: "open" }, { label: "In Progress", status: "in_progress" }, { label: "Done", status: "completed" }];
  constructor(readonly staff: StaffAppService) {}
  ngOnInit() { if (this.canReadTasks()) void this.load(); }
  async load() { this.loading.set(true); try { this.today.set(await this.staff.today()); } finally { this.loading.set(false); } }
  canReadTasks(): boolean { return this.staff.hasPermission("read:staff"); }
  canUpdateTasks(): boolean { return this.staff.hasAnyPermission(["write:staff", "update:staff"]); }
  taskCount(status: string): number { return this.tasksByStatus(status).length; }
  tasksByStatus(status: string) { return (this.today()?.tasks || []).filter((task) => status === "open" ? !task.status || task.status === "open" : task.status === status); }
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
    } catch { this.localError.set(this.staff.error() || "Unable to update the task."); }
    finally { this.pendingTaskId.set(""); }
  }
}
