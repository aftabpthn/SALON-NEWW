import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { StaffAppService, StaffRuleDocument } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Learning</p><h1>Courses, Rules & SOP</h1></div></header>
      @if (loading() && !rules().length) { <section staffPageState class="notice">Loading current rules...</section> }
      @if (error()) { <section staffPageState class="notice"><span>{{ error() }}</span><button type="button" class="link-button" (click)="load()">Retry</button></section> }
      @if (message()) { <section staffPageState class="notice success" role="status">{{ message() }}</section> }
      @if ((!loading() && !error()) || rules().length) {
        <section class="rules-toolbar panel">
          <label>Category<select [(ngModel)]="category"><option value="">All</option>@for (item of categories; track item) { <option [value]="item">{{ label(item) }}</option> }</select></label>
          <button type="button" [class.active]="outstandingOnly" (click)="outstandingOnly = !outstandingOnly">Outstanding {{ outstandingCount() }}</button>
          <span>{{ visibleRules().length }} current</span>
        </section>
        <section class="rules-layout">
          <article class="panel rule-list">
            <div class="panel-title"><h2>Current documents</h2><span>{{ unreadCount() }} unread</span></div>
            @for (rule of visibleRules(); track rule.id) {
              <button type="button" class="rule-row" [class.selected]="selected()?.id === rule.id" (click)="open(rule)">
                <span class="rule-state" [class.read]="!!rule.readAt"></span>
                <span><strong>{{ rule.title }}</strong><small>{{ label(rule.documentType) }} · {{ label(rule.category) }} · v{{ rule.documentVersion }}</small></span>
                <em [class.done]="!!rule.acknowledgedAt">{{ rule.trainingCompletedAt ? 'Completed' : rule.enrolmentStatus ? label(rule.enrolmentStatus) : rule.acknowledgedAt ? 'Acknowledged' : rule.mandatoryAcknowledgement ? 'Required' : 'Read' }}</em>
              </button>
            } @empty { <div class="empty">No current rules or SOPs.</div> }
          </article>
          <article class="panel rule-detail">
            @if (selected(); as rule) {
              <div class="panel-title"><div><h2>{{ rule.title }}</h2><small>{{ label(rule.category) }} · Version {{ rule.documentVersion }}</small></div><span>{{ rule.acknowledgedAt ? 'Acknowledged' : rule.readAt ? 'Read' : 'Unread' }}</span></div>
              <div class="rule-meta"><span>Effective <b>{{ rule.effectiveDate | date:'dd/MM/yyyy' }}</b></span>@if (rule.expiresOn) { <span>Expires <b>{{ rule.expiresOn | date:'dd/MM/yyyy' }}</b></span> }@if (rule.isCourse) { <span>{{ rule.expectedMinutes || 0 }} min</span> }@if (rule.skillName) { <span>{{ rule.skillName }} · Level {{ rule.skillLevel }}</span> }@if (rule.enrolmentDueAt) { <span>Due <b>{{ rule.enrolmentDueAt | date:'dd/MM/yyyy' }}</b></span> }</div>
              <div class="rule-content">{{ rule.content }}</div>
              @if (rule.trainingAttachmentUrl) { <a class="attachment" [href]="rule.trainingAttachmentUrl" target="_blank" rel="noopener">Open training attachment</a> }
              @if (rule.quiz.length) {
                <section class="quiz"><h3>Knowledge check · {{ rule.quizPassScore }}% required</h3>
                  @for (question of rule.quiz; track question.id; let questionIndex = $index) {
                    <fieldset><legend>{{ questionIndex + 1 }}. {{ question.question }}</legend>
                      @for (option of question.options; track $index; let optionIndex = $index) {
                        <label><input type="radio" [name]="'rule-' + rule.id + '-' + question.id" [value]="optionIndex" [(ngModel)]="answers[question.id]" />{{ option }}</label>
                      }
                    </fieldset>
                  }
                </section>
              }
              @if (rule.mandatoryAcknowledgement && !rule.acknowledgedAt) {
                <label class="confirm"><input type="checkbox" [(ngModel)]="confirmed" />I have read and understood this {{ rule.documentType }}.</label>
                <button type="button" class="button acknowledge" [disabled]="saving() || !confirmed" (click)="acknowledge(rule)">{{ saving() ? 'Saving...' : 'Acknowledge' }}</button>
              } @else if (rule.acknowledgedAt) {
                <p class="acknowledged">{{ rule.trainingCompletedAt ? 'Training completed' : 'Acknowledged' }} {{ (rule.trainingCompletedAt || rule.acknowledgedAt) | date:'dd/MM/yyyy, h:mm a' }}@if (rule.quizScore !== null) { · Score {{ rule.quizScore }}% }@if (rule.certificationValidDays > 0) { · Certification submitted for verification }</p>
              } @else if (rule.readAt) {
                <p class="acknowledged">Read {{ rule.readAt | date:'dd/MM/yyyy, h:mm a' }}</p>
              }
            } @else { <div class="empty">Select a document to read.</div> }
          </article>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .rules-toolbar { display:flex;align-items:end;gap:10px;padding:10px 12px;margin-bottom:12px; }
    .rules-toolbar label { display:grid;gap:5px;min-width:180px;color:var(--staff-text-secondary);font-size:.72rem;font-weight:700; }
    .rules-toolbar select { min-height:40px;border:1px solid var(--staff-border);border-radius:8px;background:var(--staff-surface);color:var(--staff-text);padding:0 10px;font:inherit;font-weight:600; }
    .rules-toolbar button { min-height:40px;border:1px solid var(--staff-border);border-radius:8px;background:var(--staff-surface);color:var(--staff-text);padding:0 12px;font-weight:700; }
    .rules-toolbar button.active { border-color:var(--staff-primary);background:var(--staff-primary-light);color:var(--staff-primary-hover); }
    .rules-toolbar>span { margin-left:auto;color:var(--staff-text-secondary);font-weight:700; }
    .rules-layout { display:grid;grid-template-columns:minmax(280px,.8fr) minmax(0,1.6fr);gap:12px; }
    .rule-list,.rule-detail { min-height:360px;overflow:hidden; }
    .rule-row { width:100%;display:grid;grid-template-columns:9px minmax(0,1fr) auto;align-items:center;gap:10px;padding:12px;border:0;border-bottom:1px solid var(--staff-border);background:transparent;color:var(--staff-text);text-align:left; }
    .rule-row:hover,.rule-row.selected { background:var(--staff-primary-light); }
    .rule-row strong,.rule-row small { display:block; }.rule-row small { margin-top:4px;color:var(--staff-text-secondary); }
    .rule-row em { color:var(--staff-warning);font-size:.68rem;font-style:normal;font-weight:800; }.rule-row em.done { color:var(--staff-success-text); }
    .rule-state { width:8px;height:8px;border-radius:50%;background:var(--staff-primary); }.rule-state.read { background:var(--staff-border-accent); }
    .rule-detail>.panel-title { padding:12px 14px; }.rule-detail>.panel-title small { color:var(--staff-text-secondary); }
    .rule-meta { display:flex;flex-wrap:wrap;gap:14px;padding:10px 14px;border-bottom:1px solid var(--staff-border);color:var(--staff-text-secondary);font-size:.76rem; }
    .rule-content { padding:16px 14px;line-height:1.65;white-space:pre-wrap; }
    .attachment { display:inline-flex;margin:0 14px 14px;color:var(--staff-primary-hover);font-weight:700; }
    .quiz { display:grid;gap:10px;padding:14px;border-top:1px solid var(--staff-border); }.quiz h3 { margin:0;font-size:.9rem; }
    fieldset { display:grid;gap:7px;margin:0;padding:12px;border:1px solid var(--staff-border);border-radius:8px; } legend { padding:0 5px;font-weight:700; } fieldset label,.confirm { display:flex;align-items:flex-start;gap:8px;color:var(--staff-text-secondary); }
    .confirm { margin:14px;font-weight:700; }.acknowledge { margin:0 14px 16px; }.acknowledged { margin:14px;padding:10px;border-radius:8px;background:var(--staff-success-surface);color:var(--staff-success-text);font-weight:700; }
    @media (max-width:760px) { .rules-toolbar { align-items:stretch;flex-direction:column; }.rules-toolbar label { min-width:0; }.rules-toolbar>span { margin-left:0; }.rules-layout { grid-template-columns:1fr; }.rule-row { grid-template-columns:9px minmax(0,1fr); }.rule-row em { grid-column:2; }.rule-detail { min-height:280px; } }
  `]
})
export class StaffRulesPage implements OnInit {
  readonly rules = signal<StaffRuleDocument[]>([]);
  readonly selected = signal<StaffRuleDocument | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal("");
  readonly message = signal("");
  readonly categories = ["service", "hygiene", "attendance", "behavior", "safety"];
  category = "";
  outstandingOnly = false;
  confirmed = false;
  answers: Record<string, number> = {};

  constructor(readonly staff: StaffAppService) {}
  ngOnInit() { void this.load(); }
  async load() {
    this.loading.set(true); this.error.set("");
    try {
      const currentId = this.selected()?.id;
      const rows = await this.staff.rules();
      this.rules.set(rows);
      this.selected.set(rows.find((row) => row.id === currentId) || null);
    } catch { this.error.set(this.staff.error() || "Unable to load rules and SOPs."); }
    finally { this.loading.set(false); }
  }
  visibleRules() { return this.rules().filter((rule) => (!this.category || rule.category === this.category) && (!this.outstandingOnly || rule.mandatoryAcknowledgement && !rule.acknowledgedAt)); }
  unreadCount() { return this.rules().filter((rule) => !rule.readAt).length; }
  outstandingCount() { return this.rules().filter((rule) => rule.mandatoryAcknowledgement && !rule.acknowledgedAt).length; }
  label(value: string) { return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  async open(rule: StaffRuleDocument) {
    this.selected.set(rule); this.confirmed = false; this.answers = {}; this.message.set("");
    if (rule.readAt) return;
    try { await this.staff.markRuleRead(rule.id); await this.load(); }
    catch { this.error.set(this.staff.error() || "Unable to record read status."); }
  }
  async acknowledge(rule: StaffRuleDocument) {
    if (this.saving()) return;
    if (rule.quiz.some((question) => this.answers[question.id] === undefined)) { this.error.set("Answer every quiz question."); return; }
    this.saving.set(true); this.error.set(""); this.message.set("");
    try {
      const status = await this.staff.acknowledgeRule(rule.id, rule.quiz.map((question) => this.answers[question.id]));
      this.message.set(status.acknowledgedAt ? (rule.isCourse ? "Training completion recorded." : "Acknowledgement recorded.") : `Quiz score ${status.quizScore || 0}%. ${rule.quizPassScore}% is required; please retry.`);
      await this.load();
    } catch { this.error.set(this.staff.error() || "Unable to acknowledge this document."); }
    finally { this.saving.set(false); }
  }
}
