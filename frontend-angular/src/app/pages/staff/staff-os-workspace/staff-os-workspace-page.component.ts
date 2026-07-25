import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { STAFF_OS_VIEWS, StaffOsAction, StaffOsSection } from '../../../features/staff-os/domain/staff-os.models';
import { StaffOsStore } from '../../../features/staff-os/application/staff-os.store';

@Component({
    selector: 'page-staff-os-workspace',
    imports: [CommonModule, TranslatePipe],
    providers: [StaffOsStore],
    templateUrl: './staff-os-workspace-page.component.html',
    styleUrls: ['./staff-os-workspace-page.component.css']
})
export class StaffOsWorkspacePageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly store = inject(StaffOsStore);

  readonly periodEnd = this.iso(new Date());
  readonly periodStart = this.iso(new Date(Date.now() - 29 * 86_400_000));
  readonly view = STAFF_OS_VIEWS[String(this.route.snapshot.data['staffOsView'])] || STAFF_OS_VIEWS['leaderboard'];
  sections: StaffOsSection[] = [];
  loading = false;
  error = '';

  async ngOnInit() { await this.refresh(); }

  async refresh() {
    this.loading = true;
    this.error = '';
    try {
      this.sections = await this.store.load(this.view, this.periodStart, this.periodEnd);
    } catch (error) {
      this.error = this.message(error);
    } finally {
      this.loading = false;
    }
  }

  async run(action: StaffOsAction) {
    if (action.route) {
      await this.router.navigateByUrl(action.route);
      return;
    }
    if (!action.postPath) return;
    const body: Record<string, unknown> = {};
    for (const field of action.fields || []) {
      const defaultValue = this.resolve(field.value || '');
      const value = window.prompt(field.label, defaultValue)?.trim();
      if (!value) return;
      body[field.key] = value;
    }
    if (action.postPath.includes('clock-in')) body['clockInAt'] = new Date().toISOString();
    if (action.postPath.includes('clock-out')) body['clockOutAt'] = new Date().toISOString();
    await this.store.post(action.postPath, body);
    await this.refresh();
  }

  back() { void this.router.navigate(['/staff']); }
  label(value: string) { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  display(value: unknown) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
  trackSection(_: number, section: StaffOsSection) { return section.title; }
  trackColumn(_: number, column: string) { return column; }
  trackRow(index: number, row: Record<string, unknown>) { return String(row['id'] || row['staffId'] || index); }

  private resolve(value: string) { return value.replace('{today}', this.periodEnd); }
  private iso(value: Date) { return value.toISOString().slice(0, 10); }
  private message(error: unknown) {
    const candidate = error as { error?: { error?: { message?: string }; message?: string }; message?: string };
    return candidate?.error?.error?.message || candidate?.error?.message || candidate?.message || 'Staff OS could not be loaded';
  }
}
