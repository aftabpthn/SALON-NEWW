import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type AccountMaster = ApiRecord & {
  id: string;
  accountName: string;
  groupName: string;
  groupId?: string;
  openingBalance?: number;
  openingBalanceType?: 'Dr' | 'Cr';
  isHidden?: boolean;
  status?: string;
};

type AccountGroup = ApiRecord & {
  id: string;
  groupName: string;
  groupCode?: string;
  accountType?: string;
  normalBalance?: 'Dr' | 'Cr';
  isActive?: boolean;
  isHidden?: boolean;
  systemGroup?: boolean;
  sortOrder?: number;
};

type GroupBucket = {
  key: string;
  label: string;
  groups: AccountGroup[];
};

@Component({
  selector: 'app-account-master',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="account-page inner-page-shell">
      <header class="account-hero inner-page-header">
        <div>
          <h2>Account Master</h2>
        </div>
        <div class="hero-actions inner-action-bar">
          <button class="group-button" type="button" (click)="openGroupPanel()">Account Group</button>
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
          <button class="primary-button" type="button" (click)="startAdd()">Add account</button>
        </div>
      </header>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <p class="state success" *ngIf="success()">{{ success() }}</p>

      <section class="metric-grid inner-stats-grid" *ngIf="!loading() && !error()">
        <article><span>Total accounts</span><strong>{{ accounts().length }}</strong></article>
        <article><span>Visible</span><strong>{{ visibleAccounts().length }}</strong></article>
        <article><span>Hidden</span><strong>{{ hiddenAccounts().length }}</strong></article>
        <article><span>GST ready</span><strong>{{ gstReadyAccounts().length }}</strong></article>
      </section>

      <div class="account-master-shell" *ngIf="!loading() && !error()">
        <aside class="account-list-panel inner-page-card">
          <div class="panel-title">
            <div>
              <h3>Accounts</h3>
            </div>
            <button class="ghost-button mini" type="button" (click)="startAdd()">Add</button>
          </div>

          <label class="search-row">
            <span>Search</span>
            <input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Name, group, GSTIN, city" />
          </label>

          <div class="account-table">
            <div class="table-head">
              <span>Name</span>
              <span>Group Name</span>
              <span>Hide</span>
            </div>
            <button
              type="button"
              class="account-row"
              *ngFor="let account of filteredAccounts()"
              [class.selected]="selected()?.id === account.id"
              (click)="selectAccount(account)"
            >
              <span>{{ account.accountName }}</span>
              <span>{{ account.groupName || '-' }}</span>
              <span><input type="checkbox" [checked]="account.isHidden" disabled /></span>
            </button>
            <div class="empty-state" *ngIf="!filteredAccounts().length">
              <strong>No account found</strong>

            </div>
          </div>
        </aside>

        <section class="account-form-panel inner-page-card">
          <form [formGroup]="accountForm" (ngSubmit)="saveAccount()" class="master-form">
            <div class="form-header">
              <div>
                <span class="eyebrow">{{ editingId() ? 'Edit ledger' : 'New ledger' }}</span>
                <h3>{{ formTitle() }}</h3>
              </div>
              <label class="hide-toggle">
                <input type="checkbox" formControlName="isHidden" />
                <span>Hide</span>
              </label>
            </div>

            <div class="form-grid top-fields inner-form-grid">
              <label class="field wide"><span>Name</span><input formControlName="accountName" /></label>
              <label class="field"><span>Group</span>
                <select formControlName="groupId" (change)="syncGroupName()">
                  <option value="">Select group</option>
                  <option *ngFor="let group of groups()" [value]="group.id">{{ group.groupName }}</option>
                </select>
              </label>
              <label class="field amount"><span>Opg. Bal</span><input type="number" formControlName="openingBalance" /></label>
              <div class="drcr-toggle">
                <button type="button" [class.active]="accountForm.value.openingBalanceType === 'Dr'" (click)="setBalanceType('Dr')">Dr.</button>
                <button type="button" [class.active]="accountForm.value.openingBalanceType === 'Cr'" (click)="setBalanceType('Cr')">Cr.</button>
              </div>
            </div>

            <div class="form-grid">
              <label class="field wide"><span>Short Name</span><input formControlName="shortName" /></label>
              <label class="field compact"><span>IGST %</span><input type="number" formControlName="igstPct" /></label>
              <label class="field compact"><span>GST %</span><input type="number" formControlName="gstPct" /></label>
              <label class="field compact"><span>UTGST %</span><input type="number" formControlName="utgstPct" /></label>
              <label class="field"><span>HSN / SAC</span><input formControlName="hsnSacCode" placeholder="HSN / SAC Code" /></label>
              <label class="field wide"><span>Description</span><input formControlName="hsnSacDescription" placeholder="HSN / SAC Description" /></label>
            </div>

            <div class="section-band">
              <span>Contact and address</span>
            </div>

            <div class="form-grid contact-grid">
              <label class="field wide"><span>Cont Person</span><input formControlName="contactPerson" /></label>
              <label class="field"><span>Mobile</span><input formControlName="mobile" /></label>
              <label class="field wide"><span>Address</span><input formControlName="addressLine1" /></label>
              <label class="field"><span>Phone</span><input formControlName="phone" /></label>
              <label class="field wide no-label"><input formControlName="addressLine2" /></label>
              <label class="field"><span>Fax</span><input formControlName="fax" /></label>
              <label class="field wide no-label"><input formControlName="addressLine3" /></label>
              <label class="field wide"><span>Landmark</span><input formControlName="landmark" /></label>
              <label class="field"><span>City</span><input formControlName="city" /></label>
              <label class="field"><span>Pin</span><input formControlName="pin" /></label>
              <label class="field"><span>State</span><input formControlName="state" /></label>
              <label class="field"><span>Country</span><input formControlName="country" /></label>
              <label class="field wide"><span>Area</span><input formControlName="area" /></label>
            </div>

            <div class="section-band">
              <span>Tax and statutory IDs</span>
            </div>

            <div class="form-grid ids-grid">
              <label class="field"><span>E-Mail</span><input type="email" formControlName="email" /></label>
              <label class="field"><span>Web</span><input formControlName="web" /></label>
              <label class="field"><span>GSTIN No</span><input formControlName="gstin" /></label>
              <label class="field"><span>PAN No</span><input formControlName="panNo" /></label>
              <label class="field"><span>VAT No</span><input formControlName="vatNo" /></label>
              <label class="field"><span>CST No</span><input formControlName="cstNo" /></label>
              <label class="field"><span>TIN No</span><input formControlName="tinNo" /></label>
              <label class="field"><span>Status</span>
                <select formControlName="status">
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="blocked">Blocked</option>
                </select>
              </label>
            </div>

            <div class="bottom-toolbar">
              <button class="tool-button" type="button" (click)="startAdd()"><span>+</span>Add</button>
              <button class="tool-button" type="button" (click)="editSelected()" [disabled]="!selected()">Edit</button>
              <button class="tool-button primary-tool" type="submit" [disabled]="accountForm.invalid || saving()">{{ saving() ? 'Saving' : 'Save' }}</button>
              <button class="tool-button danger-tool" type="button" (click)="deleteSelected()" [disabled]="!editingId() || saving()">Delete</button>
              <button class="tool-button" type="button" (click)="cancelEdit()">Cancel</button>
            </div>
          </form>
        </section>
      </div>

      <div class="group-overlay" *ngIf="groupPanelOpen()">
        <section class="group-window" role="dialog" aria-label="Account Group">
          <header class="group-titlebar">
            <h3>Account Group</h3>
            <button class="close-button" type="button" (click)="closeGroupPanel()">×</button>
          </header>

          <div class="group-body">
            <aside class="group-tree">
              <div class="group-tree-head">
                <span>Group</span>
                <span>Hide</span>
              </div>
              <div class="root-row">
                <span class="tree-toggle">−</span>
                <strong>Account Group</strong>
                <input type="checkbox" disabled />
              </div>
              <ng-container *ngFor="let bucket of groupBuckets()">
                <div class="bucket-row">
                  <span class="tree-toggle">−</span>
                  <strong>{{ bucket.label }}</strong>
                  <input type="checkbox" disabled />
                </div>
                <button
                  class="group-row"
                  type="button"
                  *ngFor="let group of bucket.groups"
                  [class.selected]="selectedGroup()?.id === group.id"
                  (click)="selectGroup(group)"
                >
                  <span>{{ group.groupName }}</span>
                  <input type="checkbox" [checked]="group.isHidden || group.isActive === false" disabled />
                </button>
              </ng-container>
            </aside>

            <form [formGroup]="groupForm" class="group-form" (ngSubmit)="saveGroup()">
              <label class="group-name-field">
                <span>Name :</span>
                <input formControlName="groupName" />
              </label>
              <label class="hide-toggle group-hide">
                <input type="checkbox" formControlName="isHidden" />
                <span>Hide</span>
              </label>
              <label class="group-name-field">
                <span>Type :</span>
                <select formControlName="accountType">
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                  <option value="asset">Asset / Bank / Cash</option>
                  <option value="liability">Liability</option>
                  <option value="equity">Capital / Equity</option>
                </select>
              </label>
              <label class="group-name-field">
                <span>Normal :</span>
                <select formControlName="normalBalance">
                  <option value="Dr">Debit</option>
                  <option value="Cr">Credit</option>
                </select>
              </label>
            </form>
          </div>

          <footer class="group-toolbar">
            <button class="tool-button restore-tool" type="button" (click)="restoreDefaultGroups()" [disabled]="groupSaving()">Restore Default</button>
            <span class="toolbar-spacer"></span>
            <button class="tool-button" type="button" (click)="editGroup()" [disabled]="!selectedGroup()">Edit</button>
            <button class="tool-button primary-tool" type="button" (click)="saveGroup()" [disabled]="groupForm.invalid || groupSaving()">{{ groupSaving() ? 'Saving' : 'Save' }}</button>
            <button class="tool-button danger-tool" type="button" (click)="deleteGroup()" [disabled]="!groupEditingId() || groupSaving()">Delete</button>
            <button class="tool-button" type="button" (click)="closeGroupPanel()">Cancel</button>
          </footer>
        </section>
      </div>
    </section>
  `,
  styles: [`
    .account-page { display: grid; gap: 18px; padding: 24px; color: var(--ink); }
    .account-hero, .account-list-panel, .account-form-panel, .metric-grid article, .group-window {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
    }
    .account-hero { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 22px 24px; }
    .account-hero h2 { margin: 4px 0 8px; font-size: 28px; letter-spacing: 0; }
    .account-hero p { margin: 0; color: var(--muted); max-width: 780px; line-height: 1.5; }
    .hero-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .group-button {
      min-width: 118px;
      border: 1px solid var(--color-primary);
      border-radius: 6px;
      background: var(--surface);
      color: var(--color-primary);
      padding: 9px 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all .15s;
    }
    .group-button:hover { background: var(--color-primary-soft); }
    .eyebrow { text-transform: uppercase; font-size: 12px; font-weight: 800; color: var(--muted); letter-spacing: .08em; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .metric-grid article { padding: 16px; border-top: 4px solid var(--color-primary); }
    .metric-grid span, .metric-grid small { display: block; color: var(--muted); font-weight: 700; }
    .metric-grid strong { display: block; margin: 6px 0 4px; font-size: 26px; line-height: 1; color: var(--color-primary); }
    .account-master-shell { display: grid; grid-template-columns: 1fr; gap: 18px; }
    .account-list-panel { padding: 14px; }
    .account-list-panel:hover, .account-form-panel:hover { border-color: var(--color-primary-ring); }
    .panel-title, .form-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .panel-title h3, .form-header h3 { margin: 2px 0 0; letter-spacing: 0; font-size: 18px; font-weight: 800; }
    .search-row { display: grid; grid-template-columns: 52px 1fr; align-items: center; gap: 8px; font-weight: 700; color: var(--ink); margin-bottom: 10px; font-size: 13px; }
    .search-row input, .field input, .field select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 9px 10px;
      font: inherit;
      background: var(--surface);
      color: var(--ink);
      transition: border-color .15s;
      box-sizing: border-box;
    }
    .search-row input:focus, .field input:focus, .field select:focus { outline: none; border-color: var(--color-primary); box-shadow: var(--ring-brand); }
    .account-table { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; max-height: 480px; overflow-y: auto; }
    .table-head, .account-row { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(132px, 1fr) 46px; gap: 0; align-items: center; }
    .table-head { position: sticky; top: 0; z-index: 1; background: var(--surface-2); color: var(--muted); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .table-head span, .account-row span { padding: 8px 10px; border-right: 1px solid var(--line); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .account-row { width: 100%; border: 0; border-top: 1px solid var(--line); background: var(--surface); color: var(--ink); text-align: left; cursor: pointer; transition: background .15s; }
    .account-row:hover { background: var(--surface-2); }
    .account-row.selected { background: var(--color-primary-soft); }
    .account-form-panel { padding: 16px; }
    .master-form { display: grid; gap: 12px; }
    .hide-toggle { display: inline-flex; align-items: center; gap: 8px; color: var(--ink); font-weight: 700; cursor: pointer; }
    .hide-toggle input { accent-color: var(--color-primary); }
    .form-grid { display: grid; grid-template-columns: 120px minmax(0, 1fr) 130px minmax(0, 1fr); gap: 10px 12px; align-items: end; }
    .field { display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: center; gap: 8px; color: var(--ink); font-weight: 700; }
    .field span { text-align: right; font-size: 13px; color: var(--muted); }
    .field.wide { grid-column: span 2; }
    .field.compact { grid-template-columns: 70px minmax(0, 1fr); }
    .field.amount { grid-template-columns: 76px minmax(0, 1fr); }
    .field.no-label { grid-template-columns: 96px minmax(0, 1fr); }
    .field.no-label::before { content: ''; }
    .top-fields { grid-template-columns: minmax(0, 1.2fr) minmax(220px, .8fr) 190px 140px; }
    .top-fields .wide, .top-fields .field { grid-column: auto; }
    .top-fields .field { grid-template-columns: 58px minmax(0, 1fr); }
    .drcr-toggle { display: flex; gap: 6px; align-items: end; }
    .drcr-toggle button { min-width: 60px; border: 1px solid var(--line); background: var(--surface-2); color: var(--ink); border-radius: 6px; padding: 8px 10px; font-weight: 700; cursor: pointer; transition: all .15s; }
    .drcr-toggle button.active { background: var(--color-primary); border-color: var(--color-primary); color: var(--surface); }
    .section-band { background: var(--color-primary-soft); border: 1px solid var(--color-primary-ring); color: var(--color-primary); border-radius: 6px; padding: 7px 10px; font-weight: 800; font-size: 13px; }
    .contact-grid, .ids-grid { grid-template-columns: minmax(0, 1fr) minmax(220px, .6fr); }
    .contact-grid .wide { grid-column: 1; }
    .ids-grid .field { grid-template-columns: 90px minmax(0, 1fr); }
    .bottom-toolbar { display: flex; justify-content: flex-end; gap: 8px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 10px; margin-top: 4px; }
    .tool-button, .ghost-button, .primary-button {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--ink);
      padding: 8px 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all .15s;
    }
    .tool-button:hover, .ghost-button:hover { background: var(--surface-2); border-color: var(--muted); }
    .tool-button span { display: inline-block; margin-right: 6px; font-size: 18px; line-height: 0; }
    .primary-button, .primary-tool { background: var(--color-primary); color: var(--surface); border-color: var(--color-primary); }
    .primary-button:hover, .primary-tool:hover { background: var(--color-primary-strong); border-color: var(--color-primary-strong); }
    .danger-tool { color: var(--red); }
    .danger-tool:hover { background: #fef2f2; border-color: #fca5a5; }
    .tool-button:disabled, .ghost-button:disabled, .primary-button:disabled { opacity: .55; cursor: not-allowed; }
    .ghost-button.mini { padding: 6px 10px; font-size: 12px; }
    .empty-state { padding: 28px 16px; display: grid; gap: 6px; text-align: center; color: var(--muted); }
    .empty-state strong { color: var(--ink); }
    .group-overlay {
      position: fixed; inset: 0; z-index: 40;
      display: grid; align-items: start; justify-items: center;
      background: rgba(15, 23, 42, .36); padding: 64px 18px 24px; overflow: auto;
    }
    .group-window {
      width: min(980px, calc(100vw - 36px));
      height: min(650px, calc(100vh - 112px)); min-height: 420px;
      display: grid; grid-template-rows: auto 1fr auto; overflow: hidden;
    }
    .group-titlebar {
      display: flex; align-items: center; justify-content: space-between;
      background: var(--color-primary); color: var(--surface); padding: 10px 14px;
    }
    .group-titlebar h3 { margin: 0; font-size: 20px; letter-spacing: 0; font-weight: 800; }
    .close-button {
      display: grid; width: 30px; height: 30px; place-items: center;
      border: 1px solid rgba(255,255,255,.3); border-radius: 999px;
      background: rgba(255,255,255,.15); color: var(--surface);
      font-size: 22px; font-weight: 800; line-height: 1; cursor: pointer; transition: background .15s;
    }
    .close-button:hover { background: rgba(255,255,255,.3); }
    .group-body {
      display: grid; grid-template-columns: 440px minmax(0, 1fr); gap: 14px;
      min-height: 0; padding: 10px; overflow: hidden;
    }
    .group-tree { border: 1px solid var(--line); background: var(--surface); overflow: auto; min-height: 0; border-radius: 8px; }
    .group-tree-head, .root-row, .bucket-row, .group-row {
      display: grid; grid-template-columns: 1fr 52px; align-items: center;
      border-bottom: 1px solid var(--line); color: var(--ink);
    }
    .group-tree-head {
      position: sticky; top: 0; z-index: 1; background: var(--surface-2);
      font-weight: 800; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
    }
    .group-tree-head span, .root-row strong, .bucket-row strong, .group-row span {
      padding: 7px 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .root-row, .bucket-row {
      grid-template-columns: 20px 1fr 52px; font-weight: 800; background: var(--surface-2);
    }
    .bucket-row { padding-left: 16px; }
    .group-row {
      width: 100%; grid-template-columns: 1fr 52px;
      border: 0; background: var(--surface); text-align: left; cursor: pointer; padding-left: 48px; transition: background .15s;
    }
    .group-row:hover { background: var(--surface-2); }
    .group-row.selected { background: var(--color-primary-soft); }
    .group-row input[type='checkbox'] { accent-color: var(--color-primary); }
    .tree-toggle { display: grid; place-items: center; color: var(--muted); font-weight: 800; }
    .group-form {
      display: grid; align-content: start; grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px 10px; padding: 6px; min-width: 0; overflow: auto;
    }
    .group-name-field {
      display: grid; grid-template-columns: 82px minmax(0, 1fr); align-items: center; gap: 8px;
      color: var(--ink); font-weight: 700; font-size: 13px;
    }
    .group-name-field input, .group-name-field select {
      border: 1px solid var(--line); background: var(--surface); padding: 8px 10px; font: inherit; border-radius: 6px;
    }
    .group-hide { margin-top: 4px; }
    .group-toolbar {
      display: flex; gap: 8px; align-items: center; justify-content: flex-end;
      background: var(--surface); border-top: 1px solid var(--line); padding: 8px 14px;
    }
    .toolbar-spacer { flex: 1; }
    .restore-tool { color: var(--color-primary); }
    @media (max-width: 1240px) {
      .account-table { max-height: 360px; }
    }
    @media (max-width: 820px) {
      .account-page { padding: 16px; }
      .account-hero { align-items: stretch; flex-direction: column; }
      .metric-grid { grid-template-columns: repeat(2, 1fr); }
      .form-grid, .top-fields, .contact-grid, .ids-grid { grid-template-columns: 1fr; }
      .field, .top-fields .field, .field.no-label, .ids-grid .field { grid-template-columns: 1fr; }
      .field span { text-align: left; }
      .field.wide, .contact-grid .wide { grid-column: auto; }
      .bottom-toolbar { justify-content: stretch; flex-wrap: wrap; }
      .tool-button { flex: 1 1 120px; }
      .group-overlay { padding: 18px; }
      .group-body { grid-template-columns: 1fr; overflow: auto; }
      .group-window { height: calc(100vh - 36px); min-height: 0; }
      .group-form, .group-name-field { grid-template-columns: 1fr; }
      .group-toolbar { flex-wrap: wrap; padding: 8px; }
      .toolbar-spacer { display: none; }
    }
  `]
})
export class AccountMasterComponent implements OnInit {
  readonly accounts = signal<AccountMaster[]>([]);
  readonly groups = signal<AccountGroup[]>([]);
  readonly managedGroups = signal<AccountGroup[]>([]);
  readonly selected = signal<AccountMaster | null>(null);
  readonly selectedGroup = signal<AccountGroup | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly groupSaving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly editingId = signal('');
  readonly groupEditingId = signal('');
  readonly groupPanelOpen = signal(false);
  readonly query = signal('');

  readonly visibleAccounts = computed(() => this.accounts().filter((account) => !account.isHidden && account.status !== 'deleted'));
  readonly hiddenAccounts = computed(() => this.accounts().filter((account) => account.isHidden));
  readonly gstReadyAccounts = computed(() => this.accounts().filter((account) => stringValue(account.gstin) || stringValue(account.panNo)));
  readonly filteredAccounts = computed(() => {
    const term = this.query().trim().toLowerCase();
    const usable = this.accounts().filter((account) => account.status !== 'deleted');
    if (!term) return usable;
    return usable.filter((account) =>
      [
        account.accountName,
        account.groupName,
        account.shortName,
        account.contactPerson,
        account.mobile,
        account.phone,
        account.gstin,
        account.panNo,
        account.city,
        account.area
      ].some((value) => stringValue(value).toLowerCase().includes(term))
    );
  });
  readonly groupBuckets = computed<GroupBucket[]>(() => {
    const labels: Record<string, string> = {
      income: 'INCOMES',
      expense: 'EXPENSES',
      asset: 'BANKS / ASSETS',
      liability: 'LIABILITIES',
      equity: 'CAPITAL'
    };
    const order = ['income', 'expense', 'asset', 'liability', 'equity'];
    return order
      .map((key) => ({
        key,
        label: labels[key],
        groups: this.managedGroups()
          .filter((group) => (group.accountType || 'asset') === key)
          .sort((left, right) => stringValue(left.groupName).localeCompare(stringValue(right.groupName)))
      }))
      .filter((bucket) => bucket.groups.length);
  });

  readonly accountForm = this.fb.group({
    accountName: ['', Validators.required],
    groupId: [''],
    groupName: [''],
    openingBalance: [0],
    openingBalanceType: ['Dr'],
    isHidden: [false],
    shortName: [''],
    igstPct: [0],
    gstPct: [0],
    utgstPct: [0],
    hsnSacCode: [''],
    hsnSacDescription: [''],
    description: [''],
    contactPerson: [''],
    mobile: [''],
    phone: [''],
    fax: [''],
    addressLine1: [''],
    addressLine2: [''],
    addressLine3: [''],
    landmark: [''],
    city: [''],
    pin: [''],
    state: [''],
    country: ['India'],
    area: [''],
    email: [''],
    web: [''],
    gstin: [''],
    panNo: [''],
    vatNo: [''],
    cstNo: [''],
    tinNo: [''],
    status: ['active']
  });

  readonly groupForm = this.fb.group({
    groupName: ['', Validators.required],
    accountType: ['asset'],
    normalBalance: ['Dr'],
    isHidden: [false]
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      groups: this.api.list<AccountGroup[]>('account-master/groups', { branchId: this.api.selectedBranchId(), includeHidden: true }),
      accounts: this.api.list<AccountMaster[]>('account-master/accounts', { branchId: this.api.selectedBranchId(), includeHidden: true, limit: 1000 })
    }).subscribe({
      next: ({ groups, accounts }) => {
        this.setGroupLists(groups || []);
        this.accounts.set(accounts || []);
        this.loading.set(false);
        const current = this.selected();
        const nextSelected = current ? accounts.find((account) => account.id === current.id) || null : accounts[0] || null;
        if (nextSelected) this.selectAccount(nextSelected);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load account master');
        this.loading.set(false);
      }
    });
  }

  formTitle(): string {
    return this.editingId() ? this.accountForm.value.accountName || 'Edit account' : 'New account';
  }

  startAdd(): void {
    this.editingId.set('');
    this.selected.set(null);
    this.success.set('');
    this.accountForm.reset(defaultForm());
  }

  selectAccount(account: AccountMaster): void {
    this.selected.set(account);
    this.editingId.set(account.id);
    this.accountForm.reset({
      ...defaultForm(),
      ...account,
      isHidden: Boolean(account.isHidden),
      openingBalanceType: account.openingBalanceType || 'Dr'
    });
  }

  editSelected(): void {
    const account = this.selected();
    if (account) this.selectAccount(account);
  }

  cancelEdit(): void {
    const account = this.selected();
    if (account) {
      this.selectAccount(account);
    } else {
      this.startAdd();
    }
  }

  openGroupPanel(): void {
    this.groupPanelOpen.set(true);
    if (this.selectedGroup()) {
      this.selectGroup(this.selectedGroup() as AccountGroup);
    } else {
      this.startAddGroup();
    }
  }

  closeGroupPanel(): void {
    this.groupPanelOpen.set(false);
  }

  startAddGroup(): void {
    this.groupEditingId.set('');
    this.selectedGroup.set(null);
    this.groupForm.reset(defaultGroupForm());
  }

  selectGroup(group: AccountGroup): void {
    this.selectedGroup.set(group);
    this.groupEditingId.set(group.id);
    this.groupForm.reset({
      groupName: group.groupName || '',
      accountType: group.accountType || 'asset',
      normalBalance: group.normalBalance || 'Dr',
      isHidden: Boolean(group.isHidden || group.isActive === false)
    });
  }

  editGroup(): void {
    const group = this.selectedGroup();
    if (group) this.selectGroup(group);
  }

  saveGroup(): void {
    if (this.groupForm.invalid) {
      this.groupForm.markAllAsTouched();
      return;
    }
    this.groupSaving.set(true);
    this.error.set('');
    this.success.set('');
    const payload = {
      ...this.groupForm.getRawValue(),
      branchId: this.api.selectedBranchId()
    };
    const request = this.groupEditingId()
      ? this.api.update<AccountGroup>('account-master/groups', this.groupEditingId(), payload)
      : this.api.create<AccountGroup>('account-master/groups', payload);
    request.subscribe({
      next: (group) => {
        this.groupSaving.set(false);
        this.success.set(this.groupEditingId() ? 'Account group updated.' : 'Account group saved.');
        this.groupEditingId.set(group.id);
        this.selectedGroup.set(group);
        this.refreshGroups(group.id);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to save account group');
        this.groupSaving.set(false);
      }
    });
  }

  deleteGroup(): void {
    if (!this.groupEditingId()) return;
    this.groupSaving.set(true);
    this.error.set('');
    this.api.delete('account-master/groups', this.groupEditingId()).subscribe({
      next: () => {
        this.groupSaving.set(false);
        this.success.set('Account group hidden from select group.');
        this.startAddGroup();
        this.refreshGroups();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to delete account group');
        this.groupSaving.set(false);
      }
    });
  }

  restoreDefaultGroups(): void {
    this.groupSaving.set(true);
    this.error.set('');
    this.api.post<AccountGroup[]>('account-master/groups/restore-defaults', { branchId: this.api.selectedBranchId() }).subscribe({
      next: (groups) => {
        this.groupSaving.set(false);
        this.success.set('Default account groups restored.');
        this.setGroupLists(groups || []);
        this.startAddGroup();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to restore account groups');
        this.groupSaving.set(false);
      }
    });
  }

  refreshGroups(selectedGroupId = ''): void {
    this.api.list<AccountGroup[]>('account-master/groups', { branchId: this.api.selectedBranchId(), includeHidden: true }).subscribe({
      next: (groups) => {
        this.setGroupLists(groups || []);
        const group = selectedGroupId ? this.managedGroups().find((item) => item.id === selectedGroupId) : null;
        if (group) this.selectGroup(group);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to refresh account groups');
      }
    });
  }

  private setGroupLists(groups: AccountGroup[]): void {
    this.managedGroups.set(groups);
    this.groups.set(groups.filter((group) => group.isActive !== false && !group.isHidden));
  }

  setBalanceType(type: 'Dr' | 'Cr'): void {
    this.accountForm.patchValue({ openingBalanceType: type });
  }

  syncGroupName(): void {
    const groupId = this.accountForm.value.groupId || '';
    const group = this.groups().find((item) => item.id === groupId);
    this.accountForm.patchValue({
      groupName: group?.groupName || '',
      openingBalanceType: group?.normalBalance || this.accountForm.value.openingBalanceType || 'Dr'
    });
  }

  saveAccount(): void {
    if (this.accountForm.invalid) {
      this.accountForm.markAllAsTouched();
      return;
    }
    this.syncGroupName();
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    const payload = {
      ...this.accountForm.getRawValue(),
      branchId: this.api.selectedBranchId()
    };
    const request = this.editingId()
      ? this.api.update<AccountMaster>('account-master/accounts', this.editingId(), payload)
      : this.api.create<AccountMaster>('account-master/accounts', payload);
    request.subscribe({
      next: (account) => {
        this.saving.set(false);
        this.success.set(this.editingId() ? 'Account updated.' : 'Account saved.');
        this.editingId.set(account.id);
        this.selected.set(account);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to save account');
        this.saving.set(false);
      }
    });
  }

  deleteSelected(): void {
    if (!this.editingId()) return;
    this.saving.set(true);
    this.error.set('');
    this.api.delete('account-master/accounts', this.editingId()).subscribe({
      next: () => {
        this.saving.set(false);
        this.success.set('Account deleted from active register.');
        this.startAdd();
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to delete account');
        this.saving.set(false);
      }
    });
  }
}

function defaultForm(): ApiRecord {
  return {
    accountName: '',
    groupId: '',
    groupName: '',
    openingBalance: 0,
    openingBalanceType: 'Dr',
    isHidden: false,
    shortName: '',
    igstPct: 0,
    gstPct: 0,
    utgstPct: 0,
    hsnSacCode: '',
    hsnSacDescription: '',
    description: '',
    contactPerson: '',
    mobile: '',
    phone: '',
    fax: '',
    addressLine1: '',
    addressLine2: '',
    addressLine3: '',
    landmark: '',
    city: '',
    pin: '',
    state: '',
    country: 'India',
    area: '',
    email: '',
    web: '',
    gstin: '',
    panNo: '',
    vatNo: '',
    cstNo: '',
    tinNo: '',
    status: 'active'
  };
}

function defaultGroupForm(): ApiRecord {
  return {
    groupName: '',
    accountType: 'asset',
    normalBalance: 'Dr',
    isHidden: false
  };
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}
