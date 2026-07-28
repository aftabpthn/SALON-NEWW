import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { StaffAppService, StaffFeedback } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Feedback</p><h1>Speak to management</h1></div></header>
      @if (!canUseFeedback()) { <section staffPageState class="notice">You do not have permission to use feedback.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading feedback...</section> }
      @if (message()) { <section staffPageState class="notice success">{{ message() }}</section> }
      @if (localError()) { <section staffPageState class="notice">{{ localError() }}</section> }
      @if (staff.error() && !localError()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

      @if (canUseFeedback()) {
        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Send feedback</h2><span>{{ saving() ? 'Saving...' : 'Open' }}</span></div>
            <div class="form-grid">
              <label>Type<select [(ngModel)]="category">@for (item of categories; track item) { <option [value]="item">{{ label(item) }}</option> }</select></label>
              <label>Title<input [(ngModel)]="title" maxlength="160" placeholder="Short title" /></label>
              <label class="span-two">Message<textarea [(ngModel)]="body" maxlength="2000" rows="5" placeholder="Write the issue, suggestion, training need, or complaint"></textarea></label>
            </div>
            <button class="link-button" type="button" [disabled]="saving()" (click)="submit()">{{ saving() ? 'Sending...' : 'Send' }}</button>
          </article>
          <article class="panel">
            <div class="panel-title"><h2>Status</h2><span>{{ feedback().length }}</span></div>
            <div class="list">
              @for (item of feedback(); track item.id) {
                <div class="row">
                  <div class="row-main">
                    <strong>{{ item.title }}</strong>
                    <small>{{ label(item.category) }} · {{ item.createdAt | date:'mediumDate' }}</small>
                    @if (item.managerNote) { <small>{{ item.managerNote }}</small> }
                  </div>
                  <span class="badge">{{ item.status }}</span>
                </div>
              } @empty {
                <p class="empty">No feedback submitted yet.</p>
              }
            </div>
          </article>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffFeedbackPage implements OnInit {
  readonly feedback = signal<StaffFeedback[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly message = signal("");
  readonly localError = signal("");
  readonly categories = ["opinion", "suggestion", "training", "complaint", "difficulty"];
  category = "suggestion";
  title = "";
  body = "";
  constructor(readonly staff: StaffAppService) {}
  ngOnInit() { if (this.canUseFeedback()) void this.load(); }
  async load() { this.loading.set(true); try { this.feedback.set(await this.staff.feedback()); } finally { this.loading.set(false); } }
  canUseFeedback(): boolean { return this.staff.hasPermission("staff.app.feedback.manage"); }
  label(value: string): string { return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  async submit() {
    if (this.saving()) return;
    this.message.set("");
    this.localError.set("");
    const title = this.title.trim();
    const body = this.body.trim();
    if (!title || !body) { this.localError.set("Title and message are required."); return; }
    this.saving.set(true);
    try {
      await this.staff.submitFeedback({ category: this.category, title, body });
      this.title = "";
      this.body = "";
      this.message.set("Feedback sent.");
      await this.load();
    } catch {
      this.localError.set(this.staff.error() || "Unable to send feedback.");
    } finally {
      this.saving.set(false);
    }
  }
}
