import { ChangeDetectionStrategy, Component, EventEmitter, HostListener, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiRecord } from '../../../core/api.service';
import { AppStateService } from '../../../core/state/app-state.service';
import { I18nService } from '../../../core/i18n.service';
import { AuthSessionService } from '../../../core/auth-session.service';
import { GeneralSettingsService } from '../../../core/general-settings.service';

type Panel = 'branch' | 'workspace' | null;

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'superAdmin', label: 'Super admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'frontDesk', label: 'Front desk' },
  { value: 'staff', label: 'Staff' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'inventoryManager', label: 'Inventory manager' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'customMarketingLead', label: 'Marketing lead' }
];

const ROLE_PICKER_ROLES = new Set(['owner', 'superadmin', 'admin']);

/**
 * Premium workspace + branch switcher. Replaces the raw topbar <select>s.
 * Emits changes back to the shell so existing side-effects (locale persist,
 * branch reload) keep running — it does not mutate state behind the shell.
 */
@Component({
  selector: 'aura-workspace-switcher',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wsw">
      <!-- Branch -->
      <div class="wsw-pop">
        <button class="wsw-btn" type="button" [class.is-open]="panel() === 'branch'" [disabled]="!generalSettings.allowBranchSwitch()" (click)="toggle('branch')" [title]="generalSettings.allowBranchSwitch() ? 'Switch branch' : 'Branch switching disabled by policy'">
          <span class="wsw-btn-icon" aria-hidden="true">⌂</span>
          <span class="wsw-btn-copy">
            <strong>{{ branchLabel() }}</strong>
          </span>
          <span class="wsw-chevron" aria-hidden="true">▾</span>
        </button>
        <div class="wsw-menu" *ngIf="panel() === 'branch'">
          <div class="wsw-menu-head">Branches</div>
          <div class="wsw-list">
            <button
              *ngFor="let b of branches"
              type="button"
              class="wsw-opt"
              [class.active]="b.id === state.selectedBranchId()"
              (click)="pick('branch', b.id)">
              <span class="wsw-opt-dot"></span>
              <span class="wsw-opt-copy"><strong>{{ b.name || b.id }}</strong><small>{{ b.id }}</small></span>
              <span class="wsw-check" *ngIf="b.id === state.selectedBranchId()">✓</span>
            </button>
            <div class="wsw-empty" *ngIf="!branches?.length">No branches available</div>
          </div>
        </div>
      </div>

      <!-- Workspace (tenant · role · region · language) -->
      <div class="wsw-pop">
        <button class="wsw-btn wsw-btn-wide" type="button" [class.is-open]="panel() === 'workspace'" (click)="toggle('workspace')" title="Workspace &amp; scope">
          <span class="wsw-btn-icon brand" aria-hidden="true">◆</span>
          <span class="wsw-btn-copy">
            <small>Workspace · {{ roleLabel() }}</small>
            <strong>{{ tenantLabel() }}</strong>
          </span>
          <span class="wsw-chevron" aria-hidden="true">▾</span>
        </button>
        <div class="wsw-menu wsw-menu-wide" *ngIf="panel() === 'workspace'">
          <div class="wsw-section">
            <div class="wsw-menu-head">Tenant</div>
            <div class="wsw-list scroll">
              <button
                *ngFor="let t of tenants"
                type="button"
                class="wsw-opt"
                [class.active]="t.id === state.selectedTenantId()"
                (click)="pick('tenant', t.id)">
                <span class="wsw-opt-copy"><strong>{{ t.name || t.id }}</strong><small>{{ t.id }}</small></span>
                <span class="wsw-check" *ngIf="t.id === state.selectedTenantId()">✓</span>
              </button>
              <div class="wsw-empty" *ngIf="!tenants?.length">No tenants</div>
            </div>
          </div>

          <div class="wsw-section" *ngIf="canPickRole()">
            <div class="wsw-menu-head">Acting role</div>
            <div class="wsw-chips">
              <button
                *ngFor="let r of roles"
                type="button"
                class="wsw-chip"
                [class.active]="r.value === state.userRole()"
                (click)="pick('role', r.value)">{{ r.label }}</button>
            </div>
          </div>

          <div class="wsw-grid2">
            <div class="wsw-section">
              <div class="wsw-menu-head">Region</div>
              <select class="wsw-select" [value]="i18n.countryCode()" (change)="pick('country', $any($event.target).value)">
                <option *ngFor="let c of i18n.countries" [value]="c.code">{{ c.label }}</option>
              </select>
            </div>
            <div class="wsw-section">
              <div class="wsw-menu-head">Language</div>
              <select class="wsw-select" [value]="i18n.languageCode()" (change)="pick('language', $any($event.target).value)">
                <option *ngFor="let l of i18n.languages" [value]="l.code">{{ l.label }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .wsw { display: inline-flex; align-items: center; gap: 8px; }
    .wsw-pop { position: relative; }
    .wsw-btn {
      display: inline-grid; grid-template-columns: auto auto auto; align-items: center; gap: 9px;
      height: 42px; padding: 0 10px; border-radius: 12px;
      border: 1px solid rgba(79, 70, 229, 0.16); background: rgba(255, 255, 255, 0.9);
      cursor: pointer; transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
    }
    .wsw-btn-wide { min-width: 168px; }
    .wsw-btn:hover, .wsw-btn.is-open {
      border-color: rgba(75, 18, 56, 0.42);
      box-shadow: 0 6px 18px rgba(79, 70, 229, 0.16);
      transform: translateY(-1px);
    }
    .wsw-btn:disabled { cursor: not-allowed; opacity: 0.68; transform: none; box-shadow: none; }
    .wsw-btn-icon {
      width: 28px; height: 28px; display: grid; place-items: center; border-radius: 8px;
      font-size: 0.82rem; color: var(--aura-primary, #4B1238); background: rgba(75, 18, 56, 0.12);
    }
    .wsw-btn-icon.brand { color: #fff; background: var(--gradient-brand, linear-gradient(135deg, #4B1238, #7c3aed)); }
    .wsw-btn-copy { display: grid; gap: 0; text-align: left; min-width: 0; }
    .wsw-btn-copy small {
      font-size: 0.64rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #98a1b4;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px;
    }
    .wsw-btn-copy strong {
      font-size: 0.82rem; color: #1d2740; max-width: 150px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .wsw-chevron { font-size: 0.6rem; color: #98a1b4; }

    .wsw-menu {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 80;
      width: 268px; padding: 8px; border-radius: 16px;
      border: 1px solid rgba(75, 18, 56, 0.14); background: rgba(255, 255, 255, 0.98);
      box-shadow: var(--elev-3, 0 24px 60px rgba(15, 23, 42, 0.2));
      animation: wsw-pop 150ms cubic-bezier(0.2, 0.9, 0.3, 1);
    }
    .wsw-menu-wide { width: 320px; }
    .wsw-menu-head {
      padding: 8px 8px 6px; font-size: 0.62rem; font-weight: 800;
      letter-spacing: 0.08em; text-transform: uppercase; color: #98a1b4;
    }
    .wsw-section + .wsw-section, .wsw-grid2 { border-top: 1px solid rgba(15,23,42,0.06); margin-top: 4px; }
    .wsw-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding-top: 2px; }
    .wsw-list { display: grid; gap: 2px; }
    .wsw-list.scroll { max-height: 168px; overflow-y: auto; }
    .wsw-opt {
      width: 100%; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 9px;
      padding: 8px 9px; border: 1px solid transparent; border-radius: 10px;
      background: transparent; text-align: left; cursor: pointer; color: #1d2740;
    }
    .wsw-opt:hover { background: #f4f5fb; }
    .wsw-opt.active { background: var(--gradient-brand-soft, rgba(75,18,56,0.1)); border-color: rgba(75,18,56,0.2); }
    .wsw-opt-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--aura-primary, #4B1238); }
    .wsw-opt-copy { min-width: 0; display: grid; gap: 0; }
    .wsw-opt-copy strong { font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wsw-opt-copy small { font-size: 0.68rem; color: #98a1b4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wsw-check { color: var(--aura-primary, #4B1238); font-weight: 800; }
    .wsw-chips { display: flex; flex-wrap: wrap; gap: 5px; padding: 2px 4px 6px; }
    .wsw-chip {
      padding: 5px 10px; border-radius: 999px; cursor: pointer;
      border: 1px solid rgba(15,23,42,0.1); background: #fff; color: #56607a;
      font-size: 0.72rem; font-weight: 700; transition: all 120ms ease;
    }
    .wsw-chip:hover { border-color: rgba(75,18,56,0.4); color: var(--aura-primary, #4B1238); }
    .wsw-chip.active { color: #fff; border-color: transparent; background: var(--gradient-brand, linear-gradient(135deg,#4B1238,#7c3aed)); }
    .wsw-select {
      width: 100%; height: 36px; padding: 0 8px; border-radius: 10px;
      border: 1px solid rgba(15,23,42,0.12); background: #fff; color: #1d2740;
      font-size: 0.78rem; font-weight: 600;
    }
    .wsw-empty { padding: 12px 9px; font-size: 0.76rem; color: #98a1b4; }
    @keyframes wsw-pop { from { opacity: 0; transform: translateY(-6px) scale(0.98); } to { opacity: 1; transform: none; } }
  `]
})
export class WorkspaceSwitcherComponent {
  @Input() tenants: ApiRecord[] = [];
  @Input() branches: ApiRecord[] = [];

  @Output() tenantChange = new EventEmitter<string>();
  @Output() branchChange = new EventEmitter<string>();
  @Output() roleChange = new EventEmitter<string>();
  @Output() countryChange = new EventEmitter<string>();
  @Output() languageChange = new EventEmitter<string>();

  readonly panel = signal<Panel>(null);
  readonly roles = ROLE_OPTIONS;
  readonly canPickRole = computed(() => ROLE_PICKER_ROLES.has(this.compactRole(this.session.currentUser()?.role || this.state.userRole())));

  readonly branchLabel = computed(() => {
    const id = this.state.selectedBranchId();
    if (!id) return 'All branches';
    return this.branches.find((b) => b.id === id)?.['name'] as string || id;
  });
  readonly tenantLabel = computed(() => {
    const id = this.state.selectedTenantId();
    return this.tenants.find((t) => t.id === id)?.['name'] as string || id;
  });
  readonly roleLabel = computed(() =>
    ROLE_OPTIONS.find((r) => r.value === this.state.userRole())?.label || this.state.userRole()
  );

  constructor(readonly state: AppStateService, readonly i18n: I18nService, readonly generalSettings: GeneralSettingsService, private readonly session: AuthSessionService) {}

  private compactRole(role: string): string {
    return String(role || '').trim().replace(/[\s_-]+/g, '').toLowerCase();
  }

  toggle(id: Exclude<Panel, null>): void {
    if (id === 'branch' && !this.generalSettings.allowBranchSwitch()) return;
    this.panel.set(this.panel() === id ? null : id);
  }

  close(): void {
    this.panel.set(null);
  }

  pick(kind: 'tenant' | 'branch' | 'role' | 'country' | 'language', value: string): void {
    switch (kind) {
      case 'tenant': this.tenantChange.emit(value); this.close(); break;
      case 'branch': this.branchChange.emit(value); this.close(); break;
      case 'role': this.roleChange.emit(value); break;
      case 'country': this.countryChange.emit(value); break;
      case 'language': this.languageChange.emit(value); break;
    }
  }

  @HostListener('document:click', ['$event'])
  onDocClick(event: MouseEvent): void {
    if (this.panel() && !(event.target as HTMLElement).closest('aura-workspace-switcher')) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.close();
  }
}
