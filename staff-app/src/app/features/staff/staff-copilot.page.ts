import { Component, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { StaffAppService, StaffCopilotAnswer, StaffCopilotTool } from "../../core/staff-app.service";
import { businessDate, businessDateOffset } from "../../core/business-date";
import { StaffDatePickerComponent } from "../../shared/staff-date-picker.component";

@Component({ standalone: true, imports: [FormsModule, RouterLink, StaffDatePickerComponent], templateUrl: "./staff-copilot.page.html", styleUrl: "./staff-copilot.page.css" })
export class StaffCopilotPage implements OnInit {
  readonly tools = signal<StaffCopilotTool[]>([]);
  readonly answer = signal<StaffCopilotAnswer | null>(null);
  readonly loading = signal(false);
  readonly error = signal("");
  tool = "";
  from = businessDateOffset(-29);
  to = businessDate();
  question = "";
  language = "en";

  constructor(readonly staff: StaffAppService) {}
  async ngOnInit() {
    try { const tools = await this.staff.copilotTools(); this.tools.set(tools); this.tool = tools[0]?.name || ""; }
    catch { this.error.set(this.staff.error() || "Unable to load permitted Copilot tools."); }
  }
  async ask() {
    if (!this.tool || this.loading()) return;
    this.loading.set(true); this.error.set("");
    try { this.answer.set(await this.staff.askCopilot({ tool: this.tool, startDate: this.from, endDate: this.to, question: this.question.trim(), language: this.language })); }
    catch { this.error.set(this.staff.error() || "Copilot could not answer from CRM evidence."); }
    finally { this.loading.set(false); }
  }
}
