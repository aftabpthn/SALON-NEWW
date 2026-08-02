import { DatePipe } from "@angular/common";
import { Component, HostListener, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { StaffAppService, StaffFeedback, StaffSurvey } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Feedback</p><h1>Speak to management</h1><p>Submit issues, suggestions, training needs, or complaints from your own staff record.</p></div></header>
      @if (!canReadFeedback()) { <section staffPageState class="notice">You do not have permission to view feedback.</section> }
      @if (loading() && !feedback().length) {
        <section class="feedback-skeleton" aria-label="Loading feedback">
          <div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span></div>
          <span class="skeleton feedback-list-skeleton"></span>
        </section>
      }
      @if (loadError()) { <section staffPageState class="notice feedback-error"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" [attr.aria-busy]="loading()" (click)="load()">Retry</button></section> }
      @if (message()) { <section staffPageState class="notice success" role="status">{{ message() }}</section> }
      @if (localError()) { <section staffPageState class="notice">{{ localError() }}</section> }

      @if (canReadFeedback()) {
        @if (canReadSurveys()) {
          <section class="panel survey-panel">
            <div class="panel-title"><h2>Employee surveys</h2><span>{{ surveys().length }}</span></div>
            @for (survey of surveys(); track survey.id) {
              <article class="survey-card">
                <div><strong>{{ survey.title }}</strong>@if (survey.description) { <p>{{ survey.description }}</p> }</div>
                @if (survey.answered) { <span class="badge green">Submitted</span> }
                @else {
                  @for (question of survey.questions; track question.id) {
                    <fieldset><legend>{{ question.prompt }}</legend>
                      @if (question.type === 'text') { <textarea rows="3" maxlength="2000" [ngModel]="surveyAnswer(survey.id, question.id)" (ngModelChange)="setSurveyAnswer(survey.id, question.id, $event)"></textarea> }
                      @if (question.type === 'rating') { <select [ngModel]="surveyAnswer(survey.id, question.id)" (ngModelChange)="setSurveyAnswer(survey.id, question.id, +$event)"><option value="">Select</option>@for (rating of ratings; track rating) { <option [value]="rating">{{ rating }}</option> }</select> }
                      @if (question.type === 'single_choice') { @for (option of question.options || []; track option) { <label class="survey-choice"><input type="radio" [name]="survey.id + '-' + question.id" [value]="option" [ngModel]="surveyAnswer(survey.id, question.id)" (ngModelChange)="setSurveyAnswer(survey.id, question.id, $event)" />{{ option }}</label> } }
                    </fieldset>
                  }
                  <button class="link-button primary" type="button" [disabled]="surveySaving() === survey.id || !canSubmitSurvey(survey)" (click)="submitSurvey(survey)">{{ surveySaving() === survey.id ? 'Submitting...' : 'Submit survey' }}</button>
                }
              </article>
            } @empty { <div class="feedback-empty"><p>No active surveys.</p></div> }
          </section>
        }
        <section class="grid two feedback-layout">
          <article class="panel feedback-form-panel">
            <div class="panel-title"><h2>Send feedback</h2><span>{{ saving() ? 'Saving...' : (canSubmitFeedback() ? 'Open' : 'Read-only') }}</span></div>
            @if (!canSubmitFeedback()) { <p class="muted">Feedback submit action is not enabled for your role.</p> }
            <div class="form-grid">
              <label>Type<select [(ngModel)]="category" [disabled]="saving() || !canSubmitFeedback()">@for (item of categories; track item) { <option [value]="item">{{ label(item) }}</option> }</select></label>
              <label>Title<input [(ngModel)]="title" maxlength="160" placeholder="Short title" [disabled]="saving() || !canSubmitFeedback()" [attr.aria-invalid]="titleTouched() && !title.trim()" (blur)="titleTouched.set(true)" /></label>
              <label class="span-two">Message<textarea [(ngModel)]="body" maxlength="2000" rows="5" placeholder="Write the issue, suggestion, training need, or complaint" [disabled]="saving() || !canSubmitFeedback()" [attr.aria-invalid]="bodyTouched() && !body.trim()" (blur)="bodyTouched.set(true)"></textarea></label>
            </div>
            <div class="feedback-form-footer">
              <small>{{ body.trim().length }}/2000</small>
              <button class="link-button primary" type="button" [disabled]="saving() || !canSubmitFeedback() || !canSubmit()" [attr.aria-busy]="saving()" (click)="submit()">{{ saving() ? 'Sending...' : 'Send' }}</button>
            </div>
          </article>
          <article class="panel feedback-status-panel">
            <div class="panel-title"><h2>Status</h2><span>{{ loading() && feedback().length ? 'Refreshing...' : feedback().length }}</span></div>
            <div class="list">
              @for (item of feedback(); track item.id) {
                <div class="row feedback-row">
                  <div class="row-main">
                    <strong>{{ item.title }}</strong>
                    <small>{{ label(item.category) }} · {{ item.createdAt | date:'mediumDate' }}</small>
                    <p>{{ item.body }}</p>
                    @if (item.managerNote) { <small class="manager-note">Manager: {{ item.managerNote }}</small> }
                  </div>
                  <span class="badge" [class.green]="item.status === 'resolved' || item.status === 'closed'">{{ item.status || 'open' }}</span>
                </div>
              } @empty {
                @if (!loading() && !loadError()) { <div class="feedback-empty"><p>No feedback submitted yet.</p><small>Your submitted CRM feedback and manager response status will appear here.</small></div> }
              }
            </div>
          </article>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .feedback-skeleton { display: grid; gap: 12px; }
    .feedback-list-skeleton { min-height: 260px; }
    .feedback-error { justify-content: space-between; }
    .feedback-form-panel, .feedback-status-panel { min-width: 0; }
    .feedback-form-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 14px; }
    .feedback-form-footer small { color: var(--staff-text-secondary); font-weight: 700; }
    .feedback-form-footer .link-button { min-width: 112px; }
    .feedback-row { align-items: flex-start; }
    .feedback-row p { margin-top: 8px; white-space: pre-wrap; }
    .manager-note { padding: 8px 10px; border-radius: 12px; background: var(--staff-primary-light); color: var(--staff-primary-hover); }
    .feedback-empty { display: grid; justify-items: center; gap: 5px; padding: 26px 10px; color: var(--staff-text-secondary); font-weight: 600; text-align: center; }
    .feedback-empty p { margin: 0; }
    .feedback-empty small { font-weight: 600; line-height: 1.4; }
    .survey-panel { margin-bottom: 14px; }.survey-card { display:grid;gap:10px;padding:12px 0;border-top:1px solid var(--staff-border); }.survey-card p { margin:4px 0 0;color:var(--staff-text-secondary); }.survey-card fieldset { display:grid;gap:8px;margin:0;padding:10px;border:1px solid var(--staff-border);border-radius:8px; }.survey-choice { display:flex;gap:8px;align-items:center; }
    @media (max-width: 700px) {
      .feedback-error, .feedback-form-footer { align-items: stretch; flex-direction: column; }
      .feedback-error button, .feedback-form-footer .link-button { width: 100%; }
      .feedback-layout { gap: 14px; }
      .feedback-row .badge { width: fit-content; }
    }
  `]
})
export class StaffFeedbackPage implements OnInit {
  readonly feedback = signal<StaffFeedback[]>([]);
  readonly surveys = signal<StaffSurvey[]>([]);
  readonly surveySaving = signal("");
  readonly loading = signal(false);
  readonly loadError = signal("");
  readonly saving = signal(false);
  readonly message = signal("");
  readonly localError = signal("");
  readonly titleTouched = signal(false);
  readonly bodyTouched = signal(false);
  readonly categories = ["opinion", "suggestion", "training", "complaint", "difficulty"];
  readonly ratings = [1, 2, 3, 4, 5];
  readonly surveyAnswers: Record<string, Record<string, string | number>> = {};
  category = "suggestion";
  title = "";
  body = "";

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadFeedback()) void this.load(); }

  async load() {
    if (!this.canReadFeedback()) {
      this.feedback.set([]);
      return;
    }
    this.loading.set(true);
    this.loadError.set("");
    try {
      const [feedback, surveys] = await Promise.all([
        this.staff.feedback(),
        this.canReadSurveys() ? this.staff.surveys() : Promise.resolve([])
      ]);
      this.feedback.set(feedback); this.surveys.set(surveys);
    } catch {
      this.loadError.set(this.staff.error() || "Unable to load feedback.");
    } finally {
      this.loading.set(false);
    }
  }

  @HostListener("window:aura:feedback-updated")
  onFeedbackUpdated() { if (this.canReadFeedback()) void this.load(); }

  canReadFeedback(): boolean { return this.staff.hasPermission("staff.app.feedback.read"); }
  canSubmitFeedback(): boolean { return this.staff.hasPermission("staff.app.feedback.manage"); }
  canReadSurveys(): boolean { return this.staff.hasPermission("staff.app.surveys.read"); }
  canManageSurveys(): boolean { return this.staff.hasPermission("staff.app.surveys.manage"); }
  surveyAnswer(surveyId: string, questionId: string): string | number { return this.surveyAnswers[surveyId]?.[questionId] ?? ""; }
  setSurveyAnswer(surveyId: string, questionId: string, value: string | number): void { (this.surveyAnswers[surveyId] ||= {})[questionId] = value; }
  canSubmitSurvey(survey: StaffSurvey): boolean { return this.canManageSurveys() && survey.questions.every((question) => String(this.surveyAnswer(survey.id, question.id)).trim()); }
  canSubmit(): boolean { return !!this.title.trim() && !!this.body.trim() && this.body.trim().length <= 2000 && this.title.trim().length <= 160; }
  label(value: string): string { return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

  async submit() {
    this.message.set("");
    this.localError.set("");
    this.titleTouched.set(true);
    this.bodyTouched.set(true);
    if (!this.canSubmitFeedback()) { this.localError.set("You do not have permission to submit feedback."); return; }
    if (this.saving()) return;
    const title = this.title.trim();
    const body = this.body.trim();
    if (!title || !body) { this.localError.set("Title and message are required."); return; }
    if (title.length > 160 || body.length > 2000) { this.localError.set("Feedback title or message is too long."); return; }
    this.saving.set(true);
    try {
      const created = await this.staff.submitFeedback({ category: this.category, title, body });
      this.feedback.set([created, ...this.feedback().filter((item) => item.id !== created.id)]);
      this.title = "";
      this.body = "";
      this.titleTouched.set(false);
      this.bodyTouched.set(false);
      this.message.set("Feedback sent.");
    } catch {
      this.localError.set(this.staff.error() || "Unable to send feedback.");
    } finally {
      this.saving.set(false);
    }
  }

  async submitSurvey(survey: StaffSurvey): Promise<void> {
    if (!this.canSubmitSurvey(survey) || this.surveySaving()) return;
    this.surveySaving.set(survey.id); this.localError.set(""); this.message.set("");
    try {
      await this.staff.submitSurveyResponse(survey.id, this.surveyAnswers[survey.id] || {}, crypto.randomUUID());
      this.message.set("Survey submitted."); await this.load();
    } catch { this.localError.set(this.staff.error() || "Unable to submit survey."); }
    finally { this.surveySaving.set(""); }
  }
}
