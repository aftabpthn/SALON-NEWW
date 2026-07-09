import { Component, OnInit, signal } from "@angular/core";
import { IonSpinner } from "@ionic/angular/standalone";
import { StaffAppService, StaffEnterpriseOs, StaffLearning } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [IonSpinner],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Learning</p><h1>Learning center</h1><p>Badges, coaching cues and suggested learning focus.</p></div></header>
      @if (!canReadLearning()) { <section class="notice">You do not have permission to view learning data.</section> }
      @if (loading()) { <section class="state"><ion-spinner name="crescent" /> Loading learning center...</section> }
      @if (message()) { <section class="notice success">{{ message() }}</section> }
      @if (staff.error()) { <section class="notice">{{ staff.error() }}</section> }
      @if (canReadLearning() && os(); as data) {
        <section class="grid four"><article class="kpi"><span>Progress</span><strong>{{ learning()?.summary?.progress || 0 }}%</strong></article><article class="kpi"><span>Modules</span><strong>{{ learning()?.summary?.completed || 0 }}/{{ learning()?.summary?.total || 0 }}</strong></article><article class="kpi"><span>Level</span><strong>{{ data.gamification.level }}</strong></article><article class="kpi"><span>Streak</span><strong>{{ data.gamification.monthlyStreak }}</strong></article></section>
        <section class="panel"><div class="panel-title"><h2>Learning progress</h2><span>{{ learning()?.summary?.progress || 0 }}%</span></div><div class="timer-track"><span [style.width.%]="learning()?.summary?.progress || 0"></span></div></section>
        <section class="grid two"><article class="panel"><div class="panel-title"><h2>Course modules</h2><span>{{ learning()?.modules?.length || 0 }}</span></div>@if (!canUpdateLearning()) { <p class="muted">Course progress is read-only for your role.</p> }<div class="list">@for (module of learning()?.modules || []; track module.id) { <div class="row"><div class="row-main"><strong>{{ module.title }}</strong><small>{{ module.category }} · {{ module.durationMinutes }} min · {{ module.description }}</small></div><div class="row-actions"><span class="badge" [class.green]="module.progressStatus === 'completed'">{{ module.progressStatus }}</span><button class="link-button" type="button" [disabled]="!canUpdateLearning()" (click)="complete(module.id)">{{ module.progressStatus === 'completed' ? 'Reopen' : 'Complete' }}</button></div></div> } @empty { <p class="empty">No modules available.</p> }</div></article><article class="panel"><div class="panel-title"><h2>Learning focus</h2><span>AI</span></div>@for (item of data.performance.opportunities; track item) { <p class="insight">{{ item }}</p> } @empty { <p class="empty">No learning gaps detected.</p> }</article></section>
      }
    </section>`,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffLearningPage implements OnInit {
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly learning = signal<StaffLearning | null>(null);
  readonly loading = signal(false);
  readonly message = signal("");

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadLearning()) void this.load(); }

  async load() {
    if (!this.canReadLearning()) return;
    this.loading.set(true);
    try {
      const [os, learning] = await Promise.all([this.staff.enterpriseOs(), this.staff.learning()]);
      this.os.set(os);
      this.learning.set(learning);
    } finally {
      this.loading.set(false);
    }
  }

  async complete(moduleId: string) {
    this.message.set("");
    if (!this.canUpdateLearning()) {
      this.message.set("You do not have permission to update learning progress.");
      return;
    }
    const module = this.learning()?.modules.find((item) => item.id === moduleId);
    const status = module?.progressStatus === "completed" ? "open" : "completed";
    this.learning.set(await this.staff.completeLearningModule(moduleId, status));
    this.message.set(status === "completed" ? "Module marked complete." : "Module reopened.");
  }

  canReadLearning(): boolean {
    return this.staff.hasPermission("read:staff");
  }

  canUpdateLearning(): boolean {
    return this.staff.hasAnyPermission(["write:staff", "update:staff"]);
  }
}
