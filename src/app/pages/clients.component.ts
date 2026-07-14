import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack inner-page-shell">
      <div class="module-hero client-command-hero inner-page-header">
        <div class="hero-copy">
          <h2>Client list</h2>
        </div>
        <div class="client-hero-actions">
          <button class="ghost-button" type="button" (click)="loadReports()" [disabled]="reportLoading()">Refresh reports</button>
          <button class="floating-add-client" type="button" (click)="openCreateForm()" aria-label="Add client">+</button>
        </div>
      </div>

      <section class="salonist-kpis inner-stats-grid" aria-label="Client summary">
        <button class="client-kpi-card" type="button" (click)="applyClientTypeFilter('')">
          <span class="kpi-icon">CL</span>
          <strong>{{ totalClientsCount() }}</strong>
          <small>Total Clients</small>
        </button>
        <button class="client-kpi-card" type="button" (click)="applyClientTypeFilter('')">
          <span class="kpi-icon">TV</span>
          <strong>{{ totalVisitsThisMonth() }}</strong>
          <small>Total Visits This Month</small>
        </button>
        <button class="client-kpi-card" type="button" (click)="applyClientTypeFilter('Old Client Visits')">
          <span class="kpi-icon">OV</span>
          <strong>{{ oldClientVisitsThisMonth() }}</strong>
          <small>Old Client Visits This Month</small>
        </button>
        <button class="client-kpi-card" type="button" (click)="applyClientTypeFilter('New Client Visits')">
          <span class="kpi-icon">NV</span>
          <strong>{{ newClientVisitsThisMonth() }}</strong>
          <small>New Client Visits This Month</small>
        </button>
        <button class="client-kpi-card" type="button" (click)="applyClientTypeFilter('Male')">
          <span class="kpi-icon">M</span>
          <strong>{{ genderCount('male') }}</strong>
          <small>Male Clients</small>
        </button>
        <button class="client-kpi-card" type="button" (click)="applyClientTypeFilter('Female')">
          <span class="kpi-icon">F</span>
          <strong>{{ genderCount('female') }}</strong>
          <small>Female Clients</small>
        </button>
        <button class="client-kpi-card" type="button" (click)="applyClientTypeFilter('Membership')">
          <span class="kpi-icon">MB</span>
          <strong>{{ memberClientCount() }}</strong>
          <small>Member Clients</small>
        </button>
        <button class="client-kpi-card" type="button" (click)="applyClientTypeFilter('Non-member')">
          <span class="kpi-icon">NM</span>
          <strong>{{ nonMemberClientCount() }}</strong>
          <small>Non-member Clients</small>
        </button>
        <button class="client-kpi-card" type="button" (click)="applyClientTypeFilter('Unpaid Client')">
          <span class="kpi-icon">UP</span>
          <strong>{{ unpaidClientCount() }}</strong>
          <small>Unpaid Clients</small>
        </button>
        <button class="client-kpi-card" type="button" (click)="applyClientTypeFilter('Wallet Client')">
          <span class="kpi-icon">WA</span>
          <strong>{{ walletClientCount() }}</strong>
          <small>Wallet Clients</small>
        </button>
      </section>

      <section class="panel client-database-panel inner-page-card">
        <p class="client-notice" *ngIf="notice()">{{ notice() }}</p>
        <section class="duplicate-phone-panel" *ngIf="duplicatePhoneLoading() || duplicatePhoneError() || duplicatePhoneMessage() || duplicatePhoneGroups().length">
          <div class="duplicate-phone-head">
            <div>
              <h3>Duplicate phone numbers</h3>
              <p>{{ duplicatePhoneGroups().length }} same-number group(s). Same name is allowed; same phone number is not.</p>
            </div>
            <div class="duplicate-phone-actions">
              <button class="ghost-button mini" type="button" (click)="loadDuplicatePhoneGroups()" [disabled]="duplicatePhoneLoading()">{{ duplicatePhoneLoading() ? 'Scanning...' : 'Scan again' }}</button>
              <button class="primary-button mini" type="button" (click)="mergeAllDuplicatePhoneGroups()" [disabled]="duplicatePhoneMerging() || duplicatePhoneLoading() || !duplicatePhoneGroups().length">{{ duplicatePhoneMerging() ? 'Merging...' : 'Merge all numbers' }}</button>
            </div>
          </div>
          <app-state [loading]="duplicatePhoneLoading()" [error]="duplicatePhoneError()"></app-state>
          <p class="duplicate-phone-message" *ngIf="duplicatePhoneMessage()">{{ duplicatePhoneMessage() }}</p>
          <div class="duplicate-phone-list" *ngIf="!duplicatePhoneLoading() && duplicatePhoneGroups().length">
            <article class="duplicate-phone-group" *ngFor="let group of visibleDuplicatePhoneGroups()">
              <div>
                <strong>{{ duplicatePhoneLabel(group) }}</strong>
                <small>{{ duplicateGroupClients(group).length }} clients found</small>
              </div>
              <div class="duplicate-phone-clients">
                <span *ngFor="let client of duplicateGroupClients(group)">{{ duplicateClientName(client) }} · {{ duplicateClientPhone(client) }}</span>
              </div>
              <button class="primary-button mini" type="button" (click)="mergeDuplicatePhoneGroup(group)" [disabled]="duplicatePhoneMerging()">Merge group</button>
            </article>
          </div>
        </section>
        <div class="table-toolbar inner-action-bar">
          <label class="field">
            <span>Client Type</span>
            <select [ngModel]="clientTypeFilter()" (ngModelChange)="setClientTypeFilter($event)">
              <option value="">All Clients</option>
              <option *ngFor="let type of clientTypeOptions" [value]="type">{{ type }}</option>
            </select>
          </label>
          <label class="field">
            <span>Select Country</span>
            <select [ngModel]="countryFilter()" (ngModelChange)="countryFilter.set($event)">
              <option value="">Select Country</option>
              <option *ngFor="let country of countryOptions()" [value]="country">{{ country }}</option>
            </select>
          </label>
          <label class="field date-field">
            <span>Date</span>
            <input type="date" [ngModel]="dateFromFilter()" (ngModelChange)="dateFromFilter.set($event)" />
          </label>
          <label class="field date-field">
            <span>&nbsp;</span>
            <input type="date" [ngModel]="dateToFilter()" (ngModelChange)="dateToFilter.set($event)" />
          </label>
          <label class="search-field">
            <span>Search client</span>
            <input [ngModel]="query" (ngModelChange)="onClientQueryChange($event)" placeholder="Name, phone, tag, membership" />
          </label>
          <button class="primary-button" type="button" (click)="load()">Search</button>
          <div class="client-action-menu">
            <button class="dark-button" type="button" (click)="toggleActionMenu($event)">Action ▾</button>
            <div class="dropdown-panel" *ngIf="actionMenuOpen()" (click)="$event.stopPropagation()">
              <button type="button" (click)="openClientGroups()">Client Groups</button>
              <button type="button" (click)="loadDuplicatePhoneGroups()">Find duplicate numbers</button>
              <button type="button" (click)="mergeAllDuplicatePhoneGroups()">Merge duplicate numbers</button>
              <button type="button" (click)="downloadClientSample()">Sample File Download</button>
              <button type="button" (click)="openImportClient()">Import Client</button>
            </div>
          </div>
          <div class="column-editor">
            <button class="ghost-button" type="button" (click)="toggleColumnEditor($event)">Edit Columns</button>
            <div class="column-popover" *ngIf="columnEditorOpen()" (click)="$event.stopPropagation()">
              <label *ngFor="let column of clientColumns" [class.disabled]="column.locked">
                <span>...</span>
                <input type="checkbox" [checked]="isColumnVisible(column.key)" [disabled]="column.locked" (change)="toggleColumn(column.key, $event)" />
                {{ column.label }}
              </label>
              <button class="dark-button" type="button" (click)="columnEditorOpen.set(false)">Save</button>
            </div>
          </div>
          <div class="segmented client-tag-segment">
            <button type="button" *ngFor="let tag of ['', 'VIP', 'new', 'inactive', 'high spender']" [class.active]="tagFilter() === tag" (click)="tagFilter.set(tag)">
              {{ tag || 'All' }}
            </button>
          </div>
          <div class="client-bulk-actions">
            <span>{{ selectedCount }} selected</span>
            <button class="ghost-button mini" type="button" (click)="toggleSelectAllVisible()" [disabled]="!filteredClients.length">
              {{ allVisibleSelected ? 'Clear visible' : 'Select all' }}
            </button>
            <button class="danger-button mini" type="button" (click)="deleteSelected()" [disabled]="!selectedCount || saving()">Delete selected</button>
          </div>
        </div>

        <app-state [loading]="loading()" [error]="error()"></app-state>

        <div class="table-wrap" *ngIf="!loading()">
          <table class="clients-crm-table">
            <thead>
              <tr>
                <th class="select-col">
                  <input type="checkbox" [checked]="allVisibleSelected" (change)="toggleSelectAllVisible()" aria-label="Select visible clients" />
                </th>
                <th *ngIf="isColumnVisible('name')">Name</th>
                <th *ngIf="isColumnVisible('contact')">Contact</th>
                <th *ngIf="isColumnVisible('gender')">Gender</th>
                <th *ngIf="isColumnVisible('birthday')">Birthday</th>
                <th *ngIf="isColumnVisible('anniversary')">Anniversary</th>
                <th *ngIf="isColumnVisible('ewallet')">Ewallet</th>
                <th *ngIf="isColumnVisible('notes')">Notes</th>
                <th *ngIf="isColumnVisible('firstVisit')">First Visit</th>
                <th *ngIf="isColumnVisible('spending')">Spending</th>
                <th *ngIf="isColumnVisible('childAge')">Child Age</th>
                <th *ngIf="isColumnVisible('assignedDiscount')">Assigned Discount %</th>
                <th *ngIf="isColumnVisible('discountValidity')">Discount Validity</th>
                <th *ngIf="isColumnVisible('image')">Image</th>
                <th *ngIf="isColumnVisible('phoneCode')">Phone Code</th>
                <th *ngIf="isColumnVisible('cardNumber')">Card Number/File No</th>
                <th class="right">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr
                class="clickable-client-row"
                *ngFor="let client of filteredClients"
                tabindex="0"
                role="button"
                [attr.aria-label]="'Open profile for ' + client.name"
                (click)="openClient(client.id)"
                (keydown.enter)="openClient(client.id)"
                (keydown.space)="openClient(client.id); $event.preventDefault()"
              >
                <td class="select-col" (click)="$event.stopPropagation()">
                  <input
                    type="checkbox"
                    [checked]="isClientSelected(client.id)"
                    (change)="toggleClientSelection(client.id, $event)"
                    [attr.aria-label]="'Select ' + client.name"
                  />
                </td>
                <td *ngIf="isColumnVisible('name')">
                  <a class="identity-cell" [routerLink]="['/clients', client.id]" (click)="$event.stopPropagation()">
                    <span class="avatar">{{ initials(client.name) }}</span>
                    <span>
                      <strong>{{ client.name }}</strong>
                      <small>{{ client.email || 'No email' }}</small>
                    </span>
                  </a>
                </td>
                <td *ngIf="isColumnVisible('contact')">{{ client.phone || client.mobile || '-' }}</td>
                <td *ngIf="isColumnVisible('gender')">{{ client.gender || '-' }}</td>
                <td *ngIf="isColumnVisible('birthday')">{{ client.birthday ? (client.birthday | auraDate:'date') : '-' }}</td>
                <td *ngIf="isColumnVisible('anniversary')">{{ client.anniversary ? (client.anniversary | auraDate:'date') : '-' }}</td>
                <td *ngIf="isColumnVisible('ewallet')" class="wallet-cell">
                  <strong>{{ client.walletBalance | auraMoney:'1.0-0' }}</strong>
                  <small *ngIf="walletActivityLabel(client)">{{ walletActivityLabel(client) }}</small>
                </td>
                <td *ngIf="isColumnVisible('notes')" class="note-cell" [title]="client.notes || ''">{{ shortText(client.notes) }}</td>
                <td *ngIf="isColumnVisible('firstVisit')">{{ firstVisitLabel(client) }}</td>
                <td *ngIf="isColumnVisible('spending')">{{ client.totalSpend | auraMoney:'1.0-0' }}</td>
                <td *ngIf="isColumnVisible('childAge')">{{ client.childAge || '-' }}</td>
                <td *ngIf="isColumnVisible('assignedDiscount')">{{ assignedDiscount(client) }}</td>
                <td *ngIf="isColumnVisible('discountValidity')">{{ discountValidity(client) }}</td>
                <td *ngIf="isColumnVisible('image')">{{ client.image || client.photoUrl ? 'Available' : '-' }}</td>
                <td *ngIf="isColumnVisible('phoneCode')">{{ client.phoneCode || client.countryCode || '+91' }}</td>
                <td *ngIf="isColumnVisible('cardNumber')">{{ client.cardNumber || client.fileNo || client.memberCode || '-' }}</td>
                <td class="actions-cell right">
                  <button class="row-action-trigger" type="button" (click)="toggleRowAction(client.id, $event)" aria-label="Client actions">...</button>
                  <div class="row-action-menu" *ngIf="rowActionClientId() === clientId(client)" (click)="$event.stopPropagation()">
                    <button type="button" (click)="openClient(client.id)">View Details</button>
                    <button type="button" (click)="deleteClient(client, $event)" [disabled]="saving()">Delete</button>
                    <button type="button" (click)="blockClient(client, $event)" [disabled]="saving()">Block</button>
                    <button type="button" (click)="editClient(client, $event)" [disabled]="saving()">Edit</button>
                    <button type="button" (click)="resetClientPassword(client, $event)">Reset Password</button>
                    <button type="button" (click)="addNotes(client, $event)">Add Notes</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="client-empty-state" *ngIf="!filteredClients.length">
            <strong>No clients found</strong>
            <span>Filter/search change karo ya All Clients select karo.</span>
            <button class="ghost-button mini" type="button" (click)="clearClientFilters()">Show all clients</button>
          </div>
          <div class="client-list-footer">
            <span>{{ clients().length }} clients loaded</span>
            <button class="ghost-button mini" type="button" (click)="loadMoreClients()" [disabled]="!clientListHasMore() || clientListLoadingMore()">
              {{ clientListLoadingMore() ? 'Loading...' : (clientListHasMore() ? 'Load more' : 'All loaded') }}
            </button>
          </div>
        </div>
      </section>

      <div class="client-drawer-backdrop" *ngIf="showForm()" (click)="closeForm()"></div>
      <aside class="client-drawer" *ngIf="showForm()" (click)="$event.stopPropagation()" aria-label="Add client drawer">
        <form [formGroup]="form" (ngSubmit)="save()">
          <header class="drawer-header">
            <button class="drawer-close" type="button" (click)="closeForm()" aria-label="Close">x</button>
            <h2>{{ editingClientId() ? 'Edit Client' : 'Add Client' }}</h2>
          </header>
          <div class="drawer-grid">
            <label class="field">
              <span>Name*</span>
              <input formControlName="name" placeholder="Name*" />
            </label>
            <label class="field phone-field">
              <span>Contact*</span>
              <span class="phone-entry">
                <select formControlName="countryCode" aria-label="Country code">
                  <option value="+91">IN +91</option>
                  <option value="+1">US +1</option>
                  <option value="+44">UK +44</option>
                  <option value="+971">AE +971</option>
                </select>
                <input formControlName="phone" placeholder="Contact*" />
              </span>
            </label>
            <label class="field">
              <span>Date of Birth</span>
              <input type="date" formControlName="birthday" />
            </label>
            <label class="field">
              <span>DOA</span>
              <input type="date" formControlName="anniversary" />
            </label>
            <label class="field">
              <span>Gender</span>
              <select formControlName="gender">
                <option value="">Select Gender</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Other">Other</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </label>
            <label class="field">
              <span>Email</span>
              <input type="email" formControlName="email" placeholder="Email" />
            </label>
          </div>
          <section class="drawer-checks">
            <h3>Select Group</h3>
            <label><input type="checkbox" formControlName="groupFreeMembership" /> FREE MEMBERSHIP</label>
            <label><input type="checkbox" formControlName="groupMembershipFees" /> MEMBERSHIP FEES</label>
            <label><input type="checkbox" formControlName="groupMembershipRenewFees" /> MEMBERSHIP RENEW FEES</label>
          </section>
          <section class="drawer-checks">
            <h3>Notifications</h3>
            <label><input type="checkbox" formControlName="smsNotifications" /> SMS Notifications</label>
            <label><input type="checkbox" formControlName="emailNotifications" /> Email Notifications</label>
            <label><input type="checkbox" formControlName="whatsappNotifications" /> Whatsapp Notifications</label>
          </section>
          <label class="field full drawer-notes">
            <span>Notes</span>
            <textarea formControlName="notes" placeholder="Add notes"></textarea>
          </label>
          <footer class="drawer-actions">
            <button class="dark-button" type="submit" [disabled]="form.invalid || saving()">{{ saving() ? 'Saving...' : 'Save' }}</button>
          </footer>
        </form>
      </aside>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow-x: hidden;
      box-sizing: border-box;
    }

    .page-stack {
      --client-edge-safe: clamp(14px, 1.6vw, 28px);
      width: 100%;
      max-width: 100%;
      min-width: 0;
      padding-inline-end: var(--client-edge-safe);
      box-sizing: border-box;
      overflow-x: hidden;
    }

    .client-command-hero {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
      overflow: hidden;
      align-items: center;
      gap: 16px;
      min-height: 84px;
      padding: 18px 22px;
      border: 1px solid color-mix(in srgb, var(--teal) 20%, var(--line));
      background: color-mix(in srgb, var(--surface) 96%, white);
      box-shadow: 0 14px 34px color-mix(in srgb, var(--ink) 6%, transparent);
    }

    .hero-copy {
      display: grid;
      gap: 0;
      max-width: 760px;
    }

    .hero-copy h2 {
      margin: 0;
      font-size: 34px;
      letter-spacing: 0;
      line-height: 1.05;
    }

    .client-report-heading p {
      max-width: 760px;
      margin: 0;
      color: var(--muted);
      font-weight: 650;
      line-height: 1.5;
    }

    .client-hero-actions {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-content: center;
      padding-inline-end: 2px;
    }

    .hero-copy p {
      margin: 6px 0 0;
      color: var(--muted);
      font-weight: 650;
    }

    .duplicate-phone-panel {
      display: grid;
      gap: 10px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fff;
      padding: 12px;
      margin-bottom: 12px;
    }

    .duplicate-phone-head,
    .duplicate-phone-group,
    .duplicate-phone-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }

    .duplicate-phone-head h3,
    .duplicate-phone-head p {
      margin: 0;
    }

    .duplicate-phone-head p,
    .duplicate-phone-group small,
    .duplicate-phone-message {
      color: var(--muted);
      font-weight: 700;
    }

    .duplicate-phone-list {
      display: grid;
      gap: 8px;
    }

    .duplicate-phone-group {
      border: 1px solid rgba(118, 85, 76, 0.16);
      border-radius: 10px;
      background: #fff8fb;
      padding: 10px;
    }

    .duplicate-phone-clients {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-width: min(100%, 360px);
    }

    .duplicate-phone-clients span {
      border: 1px solid rgba(118, 85, 76, 0.16);
      border-radius: 999px;
      background: #fff;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 750;
    }

    .floating-add-client {
      width: 52px;
      height: 52px;
      border: 0;
      border-radius: 8px;
      background: color-mix(in srgb, var(--ink) 92%, black);
      color: white;
      font-size: 34px;
      line-height: 1;
      box-shadow: 0 18px 34px color-mix(in srgb, var(--ink) 18%, transparent);
      cursor: pointer;
    }

    .salonist-kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
      gap: 14px;
      width: 100%;
      min-width: 0;
    }

    .client-kpi-card {
      min-height: 130px;
      display: grid;
      align-content: center;
      justify-items: start;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      padding: 16px;
      background: var(--surface);
      color: var(--ink);
      text-align: left;
      box-shadow: 0 12px 30px color-mix(in srgb, var(--ink) 5%, transparent);
      cursor: pointer;
    }

    .client-kpi-card:hover,
    .client-kpi-card:focus-visible {
      border-color: color-mix(in srgb, var(--teal) 45%, var(--line));
      transform: translateY(-1px);
      outline: none;
    }

    .client-kpi-card strong {
      font-size: 26px;
      line-height: 1;
    }

    .client-kpi-card small {
      color: var(--muted);
      font-weight: 750;
    }

    .kpi-icon {
      width: 36px;
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid color-mix(in srgb, var(--ink) 18%, var(--line));
      border-radius: 999px;
      color: var(--ink);
      font-size: 12px;
      font-weight: 900;
    }

    .client-reports-panel {
      display: grid;
      gap: 18px;
      min-width: 0;
      padding: 18px;
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--surface) 96%, white), color-mix(in srgb, var(--surface-2) 92%, white)),
        var(--surface);
    }

    .client-report-heading {
      align-items: center;
      gap: 0;
      margin-bottom: 18px;
    }

    .client-api-strip {
      display: flex;
      width: 100%;
      min-width: 0;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    .client-api-strip span {
      min-height: 28px;
      display: inline-flex;
      align-items: center;
      border: 1px solid color-mix(in srgb, var(--teal) 28%, var(--line));
      border-radius: 999px;
      padding: 6px 10px;
      background: color-mix(in srgb, var(--surface) 92%, var(--teal));
      color: var(--ink);
      font-size: 12px;
      font-weight: 850;
      line-height: 1;
      white-space: nowrap;
    }

    .client-report-metrics {
      width: 100%;
      max-width: none;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 10px;
    }

    .client-report-metrics .metric-card {
      min-height: 104px;
      border-top-width: 4px;
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--surface) 96%, white), var(--surface)),
        var(--surface);
      box-shadow: 0 12px 28px color-mix(in srgb, var(--ink) 5%, transparent);
    }

    .client-report-metrics .kpi-link-card {
      width: 100%;
      border: 1px solid var(--line);
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    .client-report-metrics .kpi-link-card:hover,
    .client-report-metrics .kpi-link-card:focus-visible {
      transform: translateY(-2px);
      box-shadow: 0 18px 34px color-mix(in srgb, var(--ink) 8%, transparent);
      outline: none;
    }

    .client-database-panel {
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--surface) 98%, white), color-mix(in srgb, var(--surface-2) 92%, white)),
        var(--surface);
      overflow: visible;
    }

    .client-notice {
      margin: 0 0 12px;
      border: 1px solid color-mix(in srgb, var(--teal) 22%, var(--line));
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      background: color-mix(in srgb, var(--teal) 8%, white);
      color: var(--ink);
      font-weight: 750;
    }

    .client-database-panel .table-toolbar {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 12px;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow: visible;
      padding: 12px;
      border: 1px solid color-mix(in srgb, var(--line) 75%, white);
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--surface) 92%, white);
      backdrop-filter: blur(18px);
    }

    .client-database-panel .field {
      flex: 1 1 220px;
      min-width: 0;
    }

    .client-database-panel .date-field {
      flex: 0 1 170px;
    }

    .client-database-panel .search-field {
      flex: 2 1 320px;
      min-width: 0;
      width: 100%;
    }

    .client-tag-segment {
      flex: 1 0 100%;
      justify-content: flex-start;
    }

    .client-action-menu,
    .column-editor,
    .actions-cell {
      position: relative;
    }

    .dark-button {
      min-height: 40px;
      border: 0;
      border-radius: 8px;
      padding: 0 18px;
      background: color-mix(in srgb, var(--ink) 92%, black);
      color: white;
      font-weight: 900;
      cursor: pointer;
    }

    .client-action-menu,
    .column-editor,
    .client-database-panel .table-toolbar > .primary-button {
      flex: 0 0 auto;
      max-width: 100%;
    }

    .dropdown-panel,
    .column-popover,
    .row-action-menu {
      position: absolute;
      z-index: 20;
      display: grid;
      min-width: 190px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: 0 18px 42px color-mix(in srgb, var(--ink) 18%, transparent);
      overflow: hidden;
    }

    .dropdown-panel {
      top: calc(100% + 6px);
      right: 0;
    }

    .dropdown-panel button,
    .row-action-menu button {
      border: 0;
      padding: 12px 16px;
      background: transparent;
      color: var(--ink);
      text-align: left;
      font-weight: 850;
      cursor: pointer;
    }

    .dropdown-panel button:hover,
    .row-action-menu button:hover {
      background: color-mix(in srgb, var(--surface-2) 86%, white);
    }

    .column-popover {
      top: calc(100% + 6px);
      right: 0;
      width: 260px;
      max-height: min(420px, 48vh);
      padding: 8px;
      overflow: auto;
      z-index: 60;
    }

    .column-popover label {
      display: grid;
      grid-template-columns: 26px 20px 1fr;
      align-items: center;
      gap: 8px;
      min-height: 38px;
      border-bottom: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
      color: var(--ink);
      font-weight: 750;
    }

    .column-popover label.disabled {
      color: color-mix(in srgb, var(--muted) 60%, white);
    }

    .column-popover .dark-button {
      width: 100%;
      margin-top: 10px;
    }

    .client-database-panel .client-bulk-actions {
      flex: 1 0 100%;
      min-width: 0;
      max-width: 100%;
      display: flex;
      justify-content: flex-start;
      flex-wrap: wrap;
      gap: 8px;
    }

    .client-database-panel .client-bulk-actions .danger-button {
      flex: 0 0 auto;
    }

    .client-database-panel .table-wrap {
      width: 100%;
      max-width: 100%;
      max-height: min(780px, 72vh);
      overflow: auto;
      overscroll-behavior: contain;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: var(--surface);
      box-shadow: 0 14px 34px color-mix(in srgb, var(--ink) 4%, transparent);
    }

    .client-empty-state {
      position: sticky;
      left: 0;
      display: grid;
      place-items: center;
      gap: 8px;
      min-height: 150px;
      padding: 24px;
      color: var(--muted);
      text-align: center;
    }

    .client-empty-state strong {
      color: var(--ink);
      font-size: 18px;
    }

    .client-database-panel .clients-crm-table {
      min-width: 1360px;
    }

    .client-database-panel .select-col {
      width: 44px;
      min-width: 44px;
      text-align: center;
    }

    .client-database-panel .clients-crm-table thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: color-mix(in srgb, var(--surface-2) 88%, white);
      box-shadow: 0 1px 0 var(--line);
    }

    .client-database-panel .clients-crm-table th:last-child,
    .client-database-panel .clients-crm-table td:last-child {
      position: sticky;
      right: 0;
      z-index: 1;
      min-width: 232px;
      padding-right: 18px;
      background: color-mix(in srgb, var(--surface) 97%, white);
      box-shadow: -12px 0 24px color-mix(in srgb, var(--ink) 5%, transparent);
    }

    .client-database-panel .clients-crm-table th:last-child {
      z-index: 4;
      background: color-mix(in srgb, var(--surface-2) 88%, white);
    }

    .client-database-panel .actions-cell {
      text-align: right;
      white-space: nowrap;
    }

    .row-action-trigger {
      border: 0;
      background: transparent;
      color: var(--ink);
      font-size: 24px;
      font-weight: 900;
      letter-spacing: 2px;
      cursor: pointer;
    }

    .row-action-menu {
      right: 12px;
      top: 34px;
      text-align: left;
    }

    .client-database-panel .wallet-cell {
      min-width: 130px;
    }

    .client-database-panel .wallet-cell strong,
    .client-database-panel .wallet-cell small {
      display: block;
      white-space: nowrap;
    }

    .client-database-panel .wallet-cell small {
      color: var(--teal);
      font-size: 11px;
      font-weight: 800;
    }

    .client-database-panel .actions-cell > * {
      margin-left: 6px;
      vertical-align: middle;
    }

    .client-drawer-backdrop {
      position: fixed;
      inset: 0;
      z-index: 80;
      background: color-mix(in srgb, black 72%, transparent);
    }

    .client-drawer {
      position: fixed;
      top: 0;
      right: 0;
      z-index: 81;
      width: min(760px, 100vw);
      height: 100vh;
      overflow: auto;
      border-left: 1px solid var(--line);
      background: var(--surface);
      box-shadow: -22px 0 48px color-mix(in srgb, black 26%, transparent);
    }

    .client-drawer form {
      min-height: 100%;
      display: grid;
      grid-template-rows: auto auto auto auto 1fr auto;
      gap: 18px;
      padding: 26px 28px;
    }

    .drawer-header {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .drawer-header h2 {
      margin: 0;
      font-size: 26px;
    }

    .drawer-close {
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--ink);
      font-size: 34px;
      line-height: 1;
      cursor: pointer;
    }

    .drawer-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .phone-entry {
      display: grid;
      grid-template-columns: 88px 1fr;
      gap: 8px;
    }

    .drawer-checks {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .drawer-checks h3 {
      flex: 0 0 100%;
      margin: 0;
      font-size: 22px;
    }

    .drawer-checks label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--muted);
      font-weight: 750;
    }

    .drawer-notes textarea {
      min-height: 94px;
    }

    .drawer-actions {
      display: flex;
      justify-content: flex-end;
      border-top: 1px solid var(--line);
      padding-top: 16px;
    }

    .drawer-actions .dark-button {
      min-width: 130px;
    }


    :host .page-stack { background: var(--bg); }

    :host .client-command-hero,
    :host .salonist-kpis,
    :host .client-database-panel,
    :host .client-reports-panel,
    :host .client-api-strip,
    :host .client-report-metrics .metric-card,
    :host .client-report-metrics .kpi-link-card,
    :host .client-empty-state,
    :host .client-drawer {
      border-color: rgba(118, 85, 76, 0.13) !important;
      border-radius: 14px !important;
      background: #fff !important;
      background-image: none !important;
      box-shadow: 0 1px 2px rgba(41, 31, 28, 0.03), 0 10px 26px rgba(73, 51, 43, 0.045) !important;
    }

    :host .client-command-hero {
      padding: 18px 20px;
      align-items: center;
    }

    :host .client-command-hero h2,
    :host .client-kpi-card strong,
    :host .client-report-heading h2,
    :host .client-report-metrics strong,
    :host .identity-cell strong,
    :host .wallet-cell strong,
    :host .drawer-header h2 {
      color: #302522 !important;
      font-weight: 630 !important;
    }

    :host .client-report-heading p,
    :host .client-kpi-card small,
    :host .client-kpi-card span,
    :host .client-database-panel .field span,
    :host .client-database-panel .search-field span,
    :host .clients-crm-table th,
    :host .identity-cell small,
    :host .wallet-cell small {
      color: #766763 !important;
      font-weight: 540 !important;
    }

    :host .salonist-kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
      gap: 12px;
      padding: 14px;
    }

    :host .client-kpi-card {
      min-height: 92px;
      border: 1px solid rgba(118, 85, 76, 0.13) !important;
      border-left: 3px solid rgba(154, 106, 96, 0.68) !important;
      border-radius: 13px !important;
      background: #fff !important;
      box-shadow: none !important;
    }

    :host .client-kpi-card:hover,
    :host .client-kpi-card:focus-visible {
      border-color: rgba(154, 106, 96, 0.24) !important;
      background: #fffaf7 !important;
      transform: translateY(-1px);
    }

    :host .kpi-icon,
    :host .badge,
    :host .segmented button.active,
    :host .client-tag-segment button.active {
      border-color: rgba(154, 106, 96, 0.16) !important;
      border-radius: 999px !important;
      background: #fff7f3 !important;
      color: #75524b !important;
      font-weight: 620 !important;
    }

    :host .client-database-panel .table-toolbar {
      gap: 12px;
      padding: 14px;
      border: 1px solid rgba(118, 85, 76, 0.11);
      border-radius: 14px;
      background: #fffdfb;
    }

    :host .client-database-panel .field input,
    :host .client-database-panel .field select,
    :host .client-database-panel .search-field input,
    :host .client-drawer input,
    :host .client-drawer select,
    :host .client-drawer textarea {
      border-color: rgba(118, 85, 76, 0.14) !important;
      border-radius: 10px !important;
      background: #fff !important;
      box-shadow: none !important;
    }

    :host .client-database-panel .table-wrap {
      border-color: rgba(118, 85, 76, 0.13) !important;
      border-radius: 14px !important;
      background: #fff !important;
    }

    :host .clients-crm-table thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #faf7f4 !important;
      border-bottom-color: rgba(118, 85, 76, 0.12) !important;
    }

    :host .clients-crm-table td {
      border-bottom-color: rgba(118, 85, 76, 0.08) !important;
      vertical-align: middle;
    }

    :host .clickable-client-row:hover td {
      background: #fffaf7 !important;
    }

    :host .avatar {
      background: #fff7f3 !important;
      color: #75524b !important;
    }

    :host .dropdown-panel,
    :host .column-popover,
    :host .row-action-menu {
      border-color: rgba(118, 85, 76, 0.14) !important;
      border-radius: 14px !important;
      background: #fff !important;
      box-shadow: 0 24px 60px rgba(73, 51, 43, 0.18) !important;
    }

    :host .ghost-button,
    :host .primary-button,
    :host .dark-button,
    :host .danger-button,
    :host .floating-add-client {
      border-radius: 10px !important;
      font-weight: 580 !important;
    }

    :host .primary-button,
    :host .dark-button,
    :host .floating-add-client {
      border-color: #744a44 !important;
      background: #744a44 !important;
      color: #fff !important;
    }

    @media (max-width: 760px) {
      :host .salonist-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      :host .client-command-hero { align-items: stretch; }
    }
    @media (max-width: 1380px) {
      .client-command-hero {
        grid-template-columns: 1fr;
      }

      .salonist-kpis {
        grid-template-columns: repeat(3, minmax(180px, 1fr));
      }

      .client-hero-actions {
        justify-content: flex-start;
      }

      .client-database-panel .table-toolbar {
        grid-template-columns: 1fr;
      }

      .client-database-panel .client-bulk-actions {
        justify-self: start;
        justify-content: flex-start;
      }

      .client-action-menu,
      .column-editor {
        justify-self: start;
      }
    }

    @media (max-width: 760px) {
      :host {
        max-width: 100vw;
      }

      .page-stack {
        width: 100%;
        max-width: 100%;
        padding-inline-end: 0;
      }

      .client-report-metrics {
        width: 100%;
        max-width: 100%;
      }

      .salonist-kpis {
        grid-template-columns: 1fr;
      }

      .client-hero-actions,
      .module-hero {
        align-items: stretch;
      }

      .client-database-panel .table-toolbar {
        grid-template-columns: 1fr;
      }

      .client-database-panel .client-bulk-actions {
        justify-self: start;
        justify-content: flex-start;
      }

      .client-database-panel .clients-crm-table th:last-child,
      .client-database-panel .clients-crm-table td:last-child {
        right: 0;
        min-width: 204px;
        padding-right: 12px;
      }

      .client-report-metrics {
        grid-template-columns: 1fr;
      }

      .client-drawer form {
        padding: 20px 16px;
      }

      .drawer-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class ClientsComponent implements OnInit, OnDestroy {
  readonly clients = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly showForm = signal(false);
  readonly tagFilter = signal('');
  readonly clientTypeFilter = signal('');
  readonly countryFilter = signal('');
  readonly dateFromFilter = signal('');
  readonly dateToFilter = signal('');
  readonly actionMenuOpen = signal(false);
  readonly duplicatePhoneGroups = signal<ApiRecord[]>([]);
  readonly duplicatePhoneLoading = signal(false);
  readonly duplicatePhoneMerging = signal(false);
  readonly duplicatePhoneError = signal('');
  readonly duplicatePhoneMessage = signal('');
  readonly columnEditorOpen = signal(false);
  readonly rowActionClientId = signal('');
  readonly visibleColumnKeys = signal<string[]>([
    'name',
    'contact',
    'ewallet',
    'firstVisit',
    'spending'
  ]);
  readonly selectedClientIds = signal<string[]>([]);
  readonly editingClientId = signal('');
  readonly clientReports = signal<ApiRecord | null>(null);
  readonly client360Report = signal<ApiRecord | null>(null);
  readonly selectedMetricCardId = signal('');
  readonly selectedMetricCategory = signal('All');
  readonly reportLoading = signal(true);
  readonly reportError = signal('');
  readonly clientListHasMore = signal(false);
  readonly clientListLoadingMore = signal(false);
  readonly clientTotalCount = signal(0);
  private readonly clientListPageSize = 500;
  private clientQueryTimer: ReturnType<typeof setTimeout> | null = null;
  private clientAutoLoadTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly usefulMetricCardIds = new Set([
    'last-visit',
    'favorite-service',
    'average-spend',
    'preferred-staff',
    'outstanding-balance',
    'loyalty-points',
    'lifetime-value',
    'highest-single-bill',
    'membership-package-balance',
    'no-show-count',
    'cancellation-rate',
    'top-3-services',
    'product-purchase-history',
    'communication-preference',
    'last-contacted',
    'churn-risk-score',
    'inactive-days-trend',
    'rebooking-rate'
  ]);
  private pendingEditClientId = '';
  private requestedReportClientId = '';
  query = '';

  readonly clientTypeOptions = [
    'Male',
    'Female',
    'Active',
    'Inactive',
    'Membership',
    'Non-member',
    'Unpaid Client',
    'Wallet Client',
    'Client Group',
    'New Client Visits',
    'Old Client Visits'
  ];
  readonly clientColumns = [
    { key: 'name', label: 'Name', locked: true },
    { key: 'contact', label: 'Contact', locked: false },
    { key: 'gender', label: 'Gender', locked: false },
    { key: 'birthday', label: 'Birthday', locked: false },
    { key: 'anniversary', label: 'Anniversary', locked: false },
    { key: 'ewallet', label: 'Ewallet', locked: false },
    { key: 'notes', label: 'Notes', locked: false },
    { key: 'firstVisit', label: 'First Visit', locked: false },
    { key: 'spending', label: 'Spending', locked: false },
    { key: 'childAge', label: 'Child Age', locked: false },
    { key: 'assignedDiscount', label: 'Assigned Discount %', locked: false },
    { key: 'discountValidity', label: 'Discount Validity', locked: false },
    { key: 'image', label: 'Image', locked: false },
    { key: 'phoneCode', label: 'Phone Code', locked: false },
    { key: 'cardNumber', label: 'Card Number/File No', locked: false }
  ];

  readonly form = this.fb.group({
    name: ['', Validators.required],
    phone: ['', Validators.required],
    countryCode: ['+91'],
    email: [''],
    gender: [''],
    birthday: [''],
    anniversary: [''],
    tag: ['new'],
    notes: [''],
    groupFreeMembership: [false],
    groupMembershipFees: [false],
    groupMembershipRenewFees: [false],
    smsNotifications: [true],
    emailNotifications: [true],
    whatsappNotifications: [true]
  });

  constructor(
    private readonly api: ApiService,
    private readonly fb: UntypedFormBuilder,
    private readonly router: Router,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    const queryClient = this.route.snapshot.queryParamMap.get('q');
    if (queryClient) this.query = queryClient;
    this.requestedReportClientId = this.route.snapshot.queryParamMap.get('clientId') || '';
    this.pendingEditClientId = this.route.snapshot.queryParamMap.get('edit') || '';
    this.load();
    this.loadReports();
  }

  ngOnDestroy(): void {
    if (this.clientQueryTimer) clearTimeout(this.clientQueryTimer);
    if (this.clientAutoLoadTimer) clearTimeout(this.clientAutoLoadTimer);
  }

  get filteredClients(): ApiRecord[] {
    return this.clients().filter((client) => {
      const queryMatch = JSON.stringify(client).toLowerCase().includes(this.query.toLowerCase());
      const tagMatch = this.tagFilter() ? (client.tags || []).includes(this.tagFilter()) : true;
      const typeMatch = this.clientTypeMatches(client, this.clientTypeFilter());
      const countryMatch = this.countryFilter() ? this.clientCountry(client) === this.countryFilter() : true;
      const dateMatch = this.clientDateMatches(client);
      return queryMatch && tagMatch && typeMatch && countryMatch && dateMatch;
    });
  }

  get selectedCount(): number {
    return this.selectedClientIds().length;
  }

  get allVisibleSelected(): boolean {
    const visibleIds = this.filteredClientIds();
    const selected = new Set(this.selectedClientIds());
    return visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  }

  totalClientsCount(): number {
    return this.clientTotalCount() || this.clients().length;
  }

  totalVisitsThisMonth(): number {
    const latest = this.latestMonthlyReport();
    const fromReport = Number(latest.newClients || 0) + Number(latest.returningClients || 0);
    if (fromReport > 0) return fromReport;
    return this.clients().filter((client) => this.isThisMonth(this.clientActivityDate(client))).length;
  }

  oldClientVisitsThisMonth(): number {
    const latest = this.latestMonthlyReport();
    const returning = Number(latest.returningClients || 0);
    if (returning > 0) return returning;
    return this.clients().filter((client) => this.isThisMonth(this.clientActivityDate(client)) && !this.isNewClient(client)).length;
  }

  newClientVisitsThisMonth(): number {
    const latest = this.latestMonthlyReport();
    const newClients = Number(latest.newClients || 0);
    if (newClients > 0) return newClients;
    return this.clients().filter((client) => this.isThisMonth(this.clientActivityDate(client)) && this.isNewClient(client)).length;
  }

  genderCount(gender: string): number {
    const key = gender.toLowerCase();
    return this.clients().filter((client) => String(client.gender || '').toLowerCase() === key).length;
  }

  memberClientCount(): number {
    return this.clients().filter((client) => this.isMemberClient(client)).length;
  }

  nonMemberClientCount(): number {
    return this.clients().filter((client) => !this.isMemberClient(client)).length;
  }

  unpaidClientCount(): number {
    return this.clients().filter((client) => this.money(client.unpaidBalance || 0) > 0).length;
  }

  walletClientCount(): number {
    return this.clients().filter((client) => this.money(client.walletBalance || client.wallet || 0) > 0).length;
  }

  applyClientTypeFilter(type: string): void {
    this.clientTypeFilter.set(type);
  }

  setClientTypeFilter(type: string): void {
    this.clientTypeFilter.set(type || '');
  }

  clearClientFilters(): void {
    this.clientTypeFilter.set('');
    this.countryFilter.set('');
    this.dateFromFilter.set('');
    this.dateToFilter.set('');
    this.tagFilter.set('');
    if (this.query) {
      this.query = '';
      this.load();
    }
  }

  countryOptions(): string[] {
    const countries = new Set<string>();
    for (const client of this.clients()) {
      const country = this.clientCountry(client);
      if (country) countries.add(country);
    }
    if (!countries.size) countries.add('India');
    return [...countries].sort();
  }

  isColumnVisible(key: string): boolean {
    return this.visibleColumnKeys().includes(key);
  }

  toggleColumn(key: string, event: Event): void {
    const checked = !!(event.target as HTMLInputElement | null)?.checked;
    if (key === 'name') return;
    const current = new Set(this.visibleColumnKeys());
    if (checked) current.add(key);
    else current.delete(key);
    current.add('name');
    this.visibleColumnKeys.set([...current]);
  }

  toggleActionMenu(event: Event): void {
    event.stopPropagation();
    this.actionMenuOpen.set(!this.actionMenuOpen());
    this.columnEditorOpen.set(false);
    this.rowActionClientId.set('');
  }

  toggleColumnEditor(event: Event): void {
    event.stopPropagation();
    this.columnEditorOpen.set(!this.columnEditorOpen());
    this.actionMenuOpen.set(false);
    this.rowActionClientId.set('');
  }

  toggleRowAction(clientId: unknown, event: Event): void {
    event.stopPropagation();
    const id = String(clientId || '');
    this.rowActionClientId.set(this.rowActionClientId() === id ? '' : id);
    this.actionMenuOpen.set(false);
    this.columnEditorOpen.set(false);
  }

  openClientGroups(): void {
    this.actionMenuOpen.set(false);
    this.clientTypeFilter.set('Client Group');
    this.notice.set('Client group filter active. Group management can be opened from selected client profiles.');
  }

  openImportClient(): void {
    this.actionMenuOpen.set(false);
    this.notice.set('Import Client selected. Use the sample CSV format and Data Migration Center for bulk upload.');
  }

  downloadClientSample(): void {
    this.actionMenuOpen.set(false);
    const csv = 'Name,Contact,Gender,Birthday,Anniversary,Email,Notes\nSample Client,9999999999,Female,1995-01-01,2020-01-01,sample@example.com,VIP client\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'client-import-sample.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  firstVisitLabel(client: ApiRecord): string {
    const value = client.firstVisit || client.firstVisitAt || client.createdAt || client.lastVisitAt;
    return value ? this.displayDate(value) : 'NA';
  }

  assignedDiscount(client: ApiRecord): string {
    const value = client.assignedDiscountPercent ?? client.discountPercent ?? client.assignedDiscount ?? client.discount;
    return value === undefined || value === null || value === '' ? '-' : String(value);
  }

  discountValidity(client: ApiRecord): string {
    const value = client.discountValidity || client.discountValidUntil || client.discountExpiry;
    return value ? this.displayDate(value) : '-';
  }

  clientId(client: ApiRecord): string {
    return String(client.id || '');
  }

  loadDuplicatePhoneGroups(successMessage = ''): void {
    if (this.duplicatePhoneLoading()) return;
    this.actionMenuOpen.set(false);
    this.duplicatePhoneLoading.set(true);
    this.duplicatePhoneError.set('');
    if (!successMessage) this.duplicatePhoneMessage.set('');
    this.api.list<ApiRecord[]>('clients/duplicates', { includeAllBranches: true, matchType: 'phone' }).subscribe({
      next: (groups) => {
        const phoneGroups = (Array.isArray(groups) ? groups : []).filter((group) => this.isPhoneDuplicateGroup(group));
        this.duplicatePhoneGroups.set(phoneGroups);
        this.duplicatePhoneMessage.set(successMessage || (phoneGroups.length ? '' : 'No duplicate phone numbers found.'));
        this.duplicatePhoneLoading.set(false);
      },
      error: (error) => {
        this.duplicatePhoneError.set(this.api.errorText(error, 'Unable to scan duplicate phone numbers'));
        this.duplicatePhoneLoading.set(false);
      }
    });
  }

  visibleDuplicatePhoneGroups(): ApiRecord[] {
    return this.duplicatePhoneGroups().slice(0, 25);
  }

  duplicateGroupClients(group: ApiRecord | null | undefined): ApiRecord[] {
    return Array.isArray(group?.clients) ? group.clients : [];
  }

  duplicatePhoneLabel(group: ApiRecord | null | undefined): string {
    const values = Array.isArray(group?.matchValues) ? group.matchValues.filter(Boolean).map(String) : [];
    return values[0] || String(group?.groupKey || '').replace(/^phone:/, '') || 'Same phone';
  }

  duplicateClientName(client: ApiRecord | null | undefined): string {
    return String(client?.name || client?.fullName || client?.clientName || client?.phone || client?.id || 'Client');
  }

  duplicateClientPhone(client: ApiRecord | null | undefined): string {
    return String(client?.phone || client?.mobile || client?.mobileNumber || client?.contactNumber || '-');
  }

  mergeDuplicatePhoneGroup(group: ApiRecord): void {
    const clients = this.duplicateGroupClients(group);
    const primaryId = String(group.suggestedPrimaryId || clients[0]?.id || '');
    const duplicateClientIds = clients.map((client) => String(client.id || '')).filter((id) => id && id !== primaryId);
    if (!primaryId || !duplicateClientIds.length) return;
    const primary = clients.find((client) => String(client.id || '') === primaryId);
    if (!window.confirm(`Merge ${duplicateClientIds.length} duplicate number client(s) into "${this.duplicateClientName(primary)}"?`)) return;
    this.duplicatePhoneMerging.set(true);
    this.duplicatePhoneError.set('');
    this.api.post<ApiRecord>(`clients/${encodeURIComponent(primaryId)}/merge-duplicates`, {
      duplicateClientIds,
      includeAllBranches: true,
      reason: 'Merged duplicate phone number from clients page'
    }).subscribe({
      next: (result) => {
        const archivedIds = Array.isArray(result?.archivedClientIds) ? result.archivedClientIds : duplicateClientIds;
        const successMessage = `Merged ${archivedIds.length} duplicate client(s).`;
        this.duplicatePhoneMessage.set(successMessage);
        this.duplicatePhoneMerging.set(false);
        this.load();
        this.loadDuplicatePhoneGroups(successMessage);
      },
      error: (error) => {
        this.duplicatePhoneError.set(this.api.errorText(error, 'Unable to merge duplicate phone group'));
        this.duplicatePhoneMerging.set(false);
      }
    });
  }

  mergeAllDuplicatePhoneGroups(): void {
    if (this.duplicatePhoneMerging()) return;
    this.actionMenuOpen.set(false);
    if (!this.duplicatePhoneGroups().length) {
      this.loadDuplicatePhoneGroups();
      return;
    }
    if (!window.confirm(`Merge all ${this.duplicatePhoneGroups().length} duplicate phone group(s)?`)) return;
    this.duplicatePhoneMerging.set(true);
    this.duplicatePhoneError.set('');
    this.duplicatePhoneMessage.set('Merging duplicate phone numbers...');
    this.runDuplicatePhoneMergeBatch({ mergedClients: 0, mergedGroups: 0, skippedGroupKeys: [] });
  }

  private runDuplicatePhoneMergeBatch(totals: { mergedClients: number; mergedGroups: number; skippedGroupKeys: string[] }): void {
    this.api.post<ApiRecord>('clients/duplicates/merge-all', {
      includeAllBranches: true,
      allBranches: true,
      matchType: 'phone',
      limit: 100,
      skipGroupKeys: totals.skippedGroupKeys,
      reason: 'Merged duplicate phone numbers from clients page'
    }).subscribe({
      next: (result) => {
        totals.mergedClients += Number(result?.mergedClients || 0);
        totals.mergedGroups += Number(result?.mergedGroups || 0);
        const skippedGroupKeys = Array.isArray(result?.skippedGroupKeys) ? result.skippedGroupKeys.map(String).filter(Boolean) : [];
        totals.skippedGroupKeys = [...new Set([...totals.skippedGroupKeys, ...skippedGroupKeys])];
        const remainingGroups = Number(result?.remainingGroups || 0);
        this.duplicatePhoneMessage.set(`Merging duplicate phone numbers... ${totals.mergedClients} clients merged across ${totals.mergedGroups} groups. ${remainingGroups} groups remaining.`);
        if (remainingGroups > 0 && Number(result?.processedGroups || result?.scannedGroups || 0) > 0) {
          this.runDuplicatePhoneMergeBatch(totals);
          return;
        }
        const successMessage = `Merge complete: ${totals.mergedClients} duplicate client(s) merged across ${totals.mergedGroups} group(s).`;
        this.duplicatePhoneMessage.set(successMessage);
        this.duplicatePhoneMerging.set(false);
        this.load();
        this.loadDuplicatePhoneGroups(successMessage);
      },
      error: (error) => {
        this.duplicatePhoneError.set(this.api.errorText(error, 'Unable to merge duplicate phone numbers'));
        this.duplicatePhoneMerging.set(false);
      }
    });
  }

  private isPhoneDuplicateGroup(group: ApiRecord | null | undefined): boolean {
    const type = String(group?.matchType || '').toLowerCase();
    const key = String(group?.groupKey || '').toLowerCase();
    return type === 'phone' || key.startsWith('phone:');
  }

  load(options: { append?: boolean } = {}): void {
    const append = options.append === true;
    if (append) {
      this.clientListLoadingMore.set(true);
    } else {
      this.loading.set(true);
      this.clientListHasMore.set(false);
      this.clearClientAutoLoadTimer();
    }
    this.error.set('');
    const branchId = this.api.selectedBranchId();
    forkJoin({
      clients: this.api.list<ApiRecord[]>('clients', {
        limit: this.clientListPageSize,
        offset: append ? this.clients().length : 0,
        compact: 1,
        q: this.query.trim(),
        branchId
      }),
      invoices: this.api.list<ApiRecord[]>('invoices', { limit: 1000, branchId }).pipe(catchError(() => of([]))),
      walletTransactions: this.api.list<ApiRecord[]>('walletTransactions', { limit: 1000, branchId }).pipe(catchError(() => of([]))),
      clientSummary: this.api.list<ApiRecord>('client-masters/summary', { branchId }).pipe(catchError(() => of({} as ApiRecord)))
    }).subscribe({
      next: ({ clients, invoices, walletTransactions, clientSummary }) => {
        const rows = clients || [];
        const linkedWalletClients = this.withWalletBalances(rows, walletTransactions || []);
        const hydratedClients = this.withUnpaidBalances(linkedWalletClients, invoices || []);
        this.clients.set(append ? [...this.clients(), ...hydratedClients] : hydratedClients);
        this.clientTotalCount.set(Number(clientSummary?.clientProfiles || 0) || this.clients().length);
        this.clientListHasMore.set(rows.length === this.clientListPageSize);
        this.scheduleClientAutoLoad(rows.length);
        this.selectedClientIds.set(this.selectedClientIds().filter((id) => this.clients().some((client) => client.id === id)));
        this.openPendingEditClient();
        const focusClientId = this.reportFocusClientId();
        if (focusClientId) this.loadClient360(focusClientId);
        this.loading.set(false);
        this.clientListLoadingMore.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load clients');
        this.loading.set(false);
        this.clientListLoadingMore.set(false);
      }
    });
  }

  onClientQueryChange(value: string): void {
    this.query = value || '';
    if (this.clientQueryTimer) clearTimeout(this.clientQueryTimer);
    this.clientQueryTimer = setTimeout(() => this.load(), 250);
  }

  loadMoreClients(): void {
    if (!this.clientListHasMore() || this.clientListLoadingMore()) return;
    this.load({ append: true });
  }

  private scheduleClientAutoLoad(lastBatchCount: number): void {
    this.clearClientAutoLoadTimer();
    if (lastBatchCount < this.clientListPageSize || !this.clientListHasMore()) return;
    this.clientAutoLoadTimer = setTimeout(() => this.loadMoreClients(), 150);
  }

  private clearClientAutoLoadTimer(): void {
    if (!this.clientAutoLoadTimer) return;
    clearTimeout(this.clientAutoLoadTimer);
    this.clientAutoLoadTimer = null;
  }

  loadReports(): void {
    this.reportLoading.set(true);
    this.reportError.set('');
    const branchId = this.api.selectedBranchId();
    forkJoin({
      clientRevenue: this.api.report<ApiRecord>('clients/revenue', { limit: 10, branchId }),
      topRfm: this.api.report<ApiRecord[]>('clients/top-rfm', { limit: 10, branchId }),
      lapsed: this.api.report<ApiRecord[]>('clients/lapsed', { minDays: 60, maxDays: 180, limit: 10, branchId }),
      newVsReturning: this.api.report<ApiRecord[]>('clients/new-vs-returning', { months: 6, branchId }),
      occasions: this.api.report<ApiRecord[]>('clients/occasions', { withinDays: 30, limit: 10, branchId }),
      byService: this.api.report<ApiRecord[]>('clients/by-service', { limit: 8, branchId })
    }).subscribe({
      next: (reports) => {
        this.clientReports.set(reports);
        this.reportLoading.set(false);
        const focusClientId = this.reportFocusClientId() || reports.topRfm?.[0]?.id || reports.lapsed?.[0]?.id || this.clients()[0]?.id || '';
        if (focusClientId) {
          this.loadClient360(String(focusClientId));
        } else {
          this.client360Report.set(null);
        }
      },
      error: (error) => {
        this.reportError.set(this.api.errorText(error, 'Unable to load client reports'));
        this.reportLoading.set(false);
      }
    });
  }

  loadClient360(clientId: string): void {
    if (!clientId) return;
    this.api.report<ApiRecord>(`clients/${encodeURIComponent(clientId)}/360`, {
      branchId: this.api.selectedBranchId()
    }).subscribe({
      next: (report) => {
        this.client360Report.set(report);
        const cards = Array.isArray(report?.metricCards) ? report.metricCards : [];
        if (cards.length && !cards.some((card: ApiRecord) => String(card.id) === this.selectedMetricCardId())) {
          this.selectedMetricCardId.set(String(cards[0].id || ''));
        }
      },
      error: (error) => this.reportError.set(this.api.errorText(error, 'Unable to load client 360 report'))
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const value = this.form.value;
    const groups = this.selectedGroupsFromForm(value);
    const payload = {
      name: value.name,
      phone: value.phone,
      phoneCode: value.countryCode,
      countryCode: value.countryCode,
      email: value.email,
      gender: value.gender,
      birthday: value.birthday,
      anniversary: value.anniversary,
      tags: this.clientTagsFromForm(value, groups),
      clientGroups: groups,
      notificationPreferences: {
        sms: !!value.smsNotifications,
        email: !!value.emailNotifications,
        whatsapp: !!value.whatsappNotifications
      },
      notes: value.notes,
      branchId: this.api.selectedBranchId() || 'branch_hyd'
    };
    const createPayload = {
      ...payload,
      walletBalance: 0,
      loyaltyPoints: 0,
      visitCount: 0,
      totalSpend: 0,
      visitHistory: [],
      purchaseHistory: [],
      whatsappHistory: [],
      consentForms: []
    };
    const editingId = this.editingClientId();
    const request = editingId
      ? this.api.update('clients', editingId, payload)
      : this.api.create('clients', createPayload);
    request.subscribe({
      next: (client) => {
        this.saving.set(false);
        this.notice.set(editingId ? 'Client updated.' : 'Client added.');
        this.closeForm(false);
        if (editingId) {
          this.clients.set(this.clients().map((item) => item.id === editingId ? { ...item, ...(client || payload) } : item));
        }
        this.load();
        this.loadReports();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save client');
        this.saving.set(false);
      }
    });
  }

  openCreateForm(): void {
    this.editingClientId.set('');
    this.form.reset({
      name: '',
      phone: '',
      countryCode: '+91',
      email: '',
      gender: '',
      birthday: '',
      anniversary: '',
      tag: 'new',
      notes: '',
      groupFreeMembership: false,
      groupMembershipFees: false,
      groupMembershipRenewFees: false,
      smsNotifications: true,
      emailNotifications: true,
      whatsappNotifications: true
    });
    this.showForm.set(true);
    this.rowActionClientId.set('');
  }

  closeForm(reset = true): void {
    this.showForm.set(false);
    this.editingClientId.set('');
    if (reset) {
      this.form.reset({
        name: '',
        phone: '',
        countryCode: '+91',
        email: '',
        gender: '',
        birthday: '',
        anniversary: '',
        tag: 'new',
        notes: '',
        groupFreeMembership: false,
        groupMembershipFees: false,
        groupMembershipRenewFees: false,
        smsNotifications: true,
        emailNotifications: true,
        whatsappNotifications: true
      });
    }
  }

  editClient(client: ApiRecord, event?: Event): void {
    event?.stopPropagation();
    const groups = this.clientGroups(client);
    const notifications = client.notificationPreferences || client.notifications || {};
    this.editingClientId.set(String(client.id || ''));
    this.form.patchValue({
      name: client.name || '',
      phone: client.phone || '',
      countryCode: client.phoneCode || client.countryCode || '+91',
      email: client.email || '',
      gender: client.gender || '',
      birthday: this.dateInputValue(client.birthday),
      anniversary: this.dateInputValue(client.anniversary),
      tag: Array.isArray(client.tags) && client.tags.length ? client.tags[0] : 'new',
      notes: client.notes || '',
      groupFreeMembership: groups.includes('FREE MEMBERSHIP'),
      groupMembershipFees: groups.includes('MEMBERSHIP FEES'),
      groupMembershipRenewFees: groups.includes('MEMBERSHIP RENEW FEES'),
      smsNotifications: notifications.sms !== false,
      emailNotifications: notifications.email !== false,
      whatsappNotifications: notifications.whatsapp !== false
    });
    this.showForm.set(true);
    this.rowActionClientId.set('');
  }

  private openPendingEditClient(): void {
    const clientId = this.pendingEditClientId;
    if (!clientId) return;
    const client = this.clients().find((item) => String(item.id || '') === clientId);
    if (!client) return;
    this.pendingEditClientId = '';
    this.editClient(client);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { edit: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  openClient(clientId: string): void {
    if (!clientId) return;
    this.router.navigate(['/clients', clientId]);
  }

  openClientReport(reportKey: string): void {
    this.router.navigate(['/clients', 'reports', reportKey]);
  }

  isClientSelected(clientId: string): boolean {
    return this.selectedClientIds().includes(String(clientId || ''));
  }

  toggleClientSelection(clientId: string, event?: Event): void {
    event?.stopPropagation();
    const id = String(clientId || '');
    if (!id) return;
    const selected = this.selectedClientIds();
    this.selectedClientIds.set(
      selected.includes(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id]
    );
  }

  toggleSelectAllVisible(): void {
    const visibleIds = this.filteredClientIds();
    if (!visibleIds.length) return;
    const selected = new Set(this.selectedClientIds());
    if (visibleIds.every((id) => selected.has(id))) {
      visibleIds.forEach((id) => selected.delete(id));
    } else {
      visibleIds.forEach((id) => selected.add(id));
    }
    this.selectedClientIds.set([...selected]);
  }

  deleteClient(client: ApiRecord, event?: Event): void {
    event?.stopPropagation();
    const id = String(client?.id || '');
    if (!id || !window.confirm(`Delete client "${client.name || id}"?`)) return;
    this.saving.set(true);
    this.api.delete('clients', id).subscribe({
      next: () => {
        this.removeDeletedClients([id]);
        this.saving.set(false);
        this.loadReports();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to delete client');
        this.saving.set(false);
      }
    });
  }

  deleteSelected(): void {
    const ids = this.selectedClientIds();
    if (!ids.length || !window.confirm(`Delete ${ids.length} selected client(s)?`)) return;
    this.saving.set(true);
    forkJoin(ids.map((id) => this.api.delete('clients', id))).subscribe({
      next: () => {
        this.removeDeletedClients(ids);
        this.saving.set(false);
        this.loadReports();
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to delete selected clients');
        this.saving.set(false);
      }
    });
  }

  blockClient(client: ApiRecord, event?: Event): void {
    event?.stopPropagation();
    const id = String(client?.id || '');
    if (!id || !window.confirm(`Block client "${client.name || id}"?`)) return;
    this.saving.set(true);
    const tags = new Set(Array.isArray(client.tags) ? client.tags.map(String) : []);
    tags.add('blocked');
    this.api.update<ApiRecord>('clients', id, { status: 'blocked', tags: [...tags] }).subscribe({
      next: (updated) => {
        this.clients.set(this.clients().map((item) => String(item.id || '') === id ? { ...item, ...(updated || {}), status: 'blocked', tags: [...tags] } : item));
        this.notice.set('Client blocked.');
        this.rowActionClientId.set('');
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to block client');
        this.saving.set(false);
      }
    });
  }

  resetClientPassword(client: ApiRecord, event?: Event): void {
    event?.stopPropagation();
    this.rowActionClientId.set('');
    this.notice.set(`Reset password action noted for ${client.name || 'client'}.`);
  }

  addNotes(client: ApiRecord, event?: Event): void {
    event?.stopPropagation();
    this.editClient(client, event);
    this.notice.set('Add note in the right-side client drawer, then Save.');
  }

  initials(name: string): string {
    return String(name || '?').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  }

  shortText(value: unknown): string {
    const text = String(value || '').trim();
    if (!text) return '-';
    return text.length > 46 ? `${text.slice(0, 46)}...` : text;
  }

  reportList(key: string): ApiRecord[] {
    const value = this.clientReports()?.[key];
    return Array.isArray(value) ? value : [];
  }

  clientRevenueSummary(): ApiRecord {
    const report = this.clientReports()?.['clientRevenue'];
    return report && typeof report === 'object' && !Array.isArray(report) ? report['summary'] || {} : {};
  }

  clientMetricCards(): ApiRecord[] {
    const value = this.client360Report()?.metricCards;
    return Array.isArray(value) ? value.filter((card) => this.usefulMetricCardIds.has(String(card.id))) : [];
  }

  metricCardValue(cardId: string, fallback = '-'): string {
    const card = this.clientMetricCards().find((item) => String(item.id) === cardId);
    const value = card?.value;
    return value === undefined || value === null || value === '' ? fallback : String(value);
  }

  walletMetricValue(): string {
    const loyaltyCard = this.clientMetricCards().find((item) => String(item.id) === 'loyalty-points');
    const walletText = String(loyaltyCard?.detail || '').match(/([^·]+?)\s+wallet/i)?.[1]?.trim();
    if (walletText) return walletText;
    const client = this.client360Report()?.client || {};
    return this.currencyText(client.walletBalance ?? client.wallet_balance ?? client.wallet ?? 0);
  }

  walletMetricActivity(): string {
    const clientId = String(this.client360Report()?.client?.id || '');
    const client = this.clients().find((item) => String(item.id || '') === clientId);
    return this.walletActivityLabel(client || {}) || 'No wallet activity';
  }

  walletActivityLabel(client: ApiRecord): string {
    const type = String(client.walletLastType || '').toLowerCase();
    const amount = this.money(client.walletLastAmount || 0);
    if (!type || amount <= 0) return '';
    const action = type.includes('debit') || type.includes('use') ? 'used' : 'added';
    return `Last wallet ${action} ${this.currencyText(amount)}`;
  }

  metricGroups(): ApiRecord[] {
    const counts = new Map<string, number>();
    for (const card of this.clientMetricCards()) {
      const category = String(card.category || 'Other');
      counts.set(category, (counts.get(category) || 0) + 1);
    }
    return [...counts.entries()].map(([category, count]) => ({ category, count }));
  }

  filteredMetricCards(): ApiRecord[] {
    const category = this.selectedMetricCategory();
    const cards = this.clientMetricCards();
    return category === 'All' ? cards : cards.filter((card) => card.category === category);
  }

  visibleMetricCards(): ApiRecord[] {
    return this.filteredMetricCards().slice(0, 12);
  }

  selectedMetricCard(): ApiRecord | null {
    const cards = this.filteredMetricCards();
    const selected = cards.find((card) => String(card.id) === this.selectedMetricCardId());
    return selected || cards[0] || this.clientMetricCards()[0] || null;
  }

  selectMetricCard(cardId: unknown): void {
    const id = String(cardId || '');
    if (id) this.selectedMetricCardId.set(id);
  }

  connectedMetricCards(card: ApiRecord): ApiRecord[] {
    const relatedIds = Array.isArray(card.relatedCardIds) ? card.relatedCardIds.map(String) : [];
    const ids = new Set(relatedIds);
    return this.clientMetricCards().filter((item) => ids.has(String(item.id))).slice(0, 6);
  }

  metricConnectionCount(): number {
    return this.clientMetricCards().reduce((sum, card) => {
      const relatedIds = Array.isArray(card.relatedCardIds) ? card.relatedCardIds.map(String) : [];
      return sum + relatedIds.filter((id) => this.usefulMetricCardIds.has(id)).length;
    }, 0);
  }

  latestMonthlyReport(): ApiRecord {
    const rows = this.reportList('newVsReturning');
    return rows[rows.length - 1] || {};
  }

  reportBranchLabel(): string {
    return this.api.selectedBranchId() ? 'Branch scope' : 'All branches';
  }

  private selectedGroupsFromForm(value: ApiRecord): string[] {
    const groups: string[] = [];
    if (value.groupFreeMembership) groups.push('FREE MEMBERSHIP');
    if (value.groupMembershipFees) groups.push('MEMBERSHIP FEES');
    if (value.groupMembershipRenewFees) groups.push('MEMBERSHIP RENEW FEES');
    return groups;
  }

  private clientTagsFromForm(value: ApiRecord, groups: string[]): string[] {
    const tags = new Set<string>();
    if (value.tag) tags.add(String(value.tag));
    for (const group of groups) tags.add(group);
    return [...tags];
  }

  private clientGroups(client: ApiRecord): string[] {
    const raw = client.clientGroups || client.groups || client.group || [];
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        return raw.split(',').map((item) => item.trim()).filter(Boolean);
      }
    }
    return Array.isArray(client.tags) ? client.tags.filter((tag) => String(tag).toUpperCase().includes('MEMBERSHIP')).map(String) : [];
  }

  private clientTypeMatches(client: ApiRecord, type: string): boolean {
    if (!type) return true;
    const normalizedType = type.toLowerCase();
    const gender = String(client.gender || '').toLowerCase();
    const tags = Array.isArray(client.tags) ? client.tags.map((tag) => String(tag).toLowerCase()) : [];
    const status = String(client.status || '').toLowerCase();
    if (normalizedType === 'male' || normalizedType === 'female') return gender === normalizedType;
    if (normalizedType === 'active') return status !== 'inactive' && status !== 'blocked' && !tags.includes('inactive');
    if (normalizedType === 'inactive') return status === 'inactive' || status === 'blocked' || tags.includes('inactive');
    if (normalizedType === 'membership') return this.isMemberClient(client);
    if (normalizedType === 'non-member') return !this.isMemberClient(client);
    if (normalizedType === 'unpaid client') return this.money(client.unpaidBalance || 0) > 0;
    if (normalizedType === 'wallet client') return this.money(client.walletBalance || client.wallet || 0) > 0;
    if (normalizedType === 'client group') return this.clientGroups(client).length > 0;
    if (normalizedType === 'new client visits') return this.isNewClient(client);
    if (normalizedType === 'old client visits') return !this.isNewClient(client);
    return true;
  }

  private isMemberClient(client: ApiRecord): boolean {
    const tags = Array.isArray(client.tags) ? client.tags.map((tag) => String(tag).toLowerCase()) : [];
    return tags.some((tag) => tag.includes('membership') || tag.includes('member'))
      || this.clientGroups(client).length > 0
      || !!client.membershipId
      || !!client.membershipPlanId
      || String(client.membershipStatus || '').toLowerCase() === 'active';
  }

  private clientCountry(client: ApiRecord): string {
    return String(client.country || client.countryName || client.countryLabel || (client.countryCode === '+1' ? 'United States' : '') || 'India');
  }

  private clientDateMatches(client: ApiRecord): boolean {
    const from = this.dateFromFilter();
    const to = this.dateToFilter();
    if (!from && !to) return true;
    const activity = this.normalizeDateMs(this.clientActivityDate(client));
    if (!activity) return false;
    const fromMs = from ? this.normalizeDateMs(from) : 0;
    const toMs = to ? this.normalizeDateMs(to) : 0;
    return (!fromMs || activity >= fromMs) && (!toMs || activity <= toMs);
  }

  private isNewClient(client: ApiRecord): boolean {
    const created = this.normalizeDateMs(client.createdAt || client.firstVisit || client.firstVisitAt);
    if (!created) return false;
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const date = new Date(created);
    return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
  }

  private isThisMonth(value: unknown): boolean {
    const ms = this.normalizeDateMs(value);
    if (!ms) return false;
    const date = new Date(ms);
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }

  private clientActivityDate(client: ApiRecord): unknown {
    return client.lastVisitAt || client.firstVisit || client.firstVisitAt || client.createdAt || client.updatedAt;
  }

  private displayDate(value: unknown): string {
    const ms = this.normalizeDateMs(value);
    if (!ms) return 'NA';
    return new Date(ms).toLocaleDateString('en-IN');
  }

  private normalizeDateMs(value: unknown): number {
    if (!value) return 0;
    const ms = new Date(String(value)).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }

  private withUnpaidBalances(clients: ApiRecord[], invoices: ApiRecord[]): ApiRecord[] {
    const unpaidByClient = new Map<string, number>();
    for (const invoice of invoices) {
      const clientId = String(invoice.clientId || invoice.client_id || '');
      if (!clientId) continue;
      const balance = this.invoiceBalance(invoice);
      if (balance <= 0) continue;
      unpaidByClient.set(clientId, Math.round(((unpaidByClient.get(clientId) || 0) + balance) * 100) / 100);
    }
    return clients.map((client) => ({
      ...client,
      unpaidBalance: unpaidByClient.get(String(client.id)) || 0
    }));
  }

  private withWalletBalances(clients: ApiRecord[], transactions: ApiRecord[]): ApiRecord[] {
    const latestByClient = new Map<string, ApiRecord>();
    for (const transaction of transactions) {
      const clientId = String(transaction.clientId || transaction.client_id || '');
      if (!clientId) continue;
      const existing = latestByClient.get(clientId);
      if (!existing || String(transaction.createdAt || '') >= String(existing.createdAt || '')) {
        latestByClient.set(clientId, transaction);
      }
    }
    return clients.map((client) => {
      const latest = latestByClient.get(String(client.id));
      const linkedBalance = latest?.balanceAfter ?? latest?.balance_after ?? latest?.walletBalance ?? latest?.wallet_balance ?? latest?.balance;
      return {
        ...client,
        walletBalance: linkedBalance !== undefined && linkedBalance !== null && linkedBalance !== ''
          ? this.money(linkedBalance)
          : this.money(client.walletBalance ?? client.wallet_balance ?? client.ewalletBalance ?? client.eWalletBalance ?? client.wallet ?? 0),
        walletLastAmount: latest ? this.money(latest.amount ?? latest.value ?? latest.walletAmount ?? 0) : 0,
        walletLastType: latest ? String(latest.type || latest.transactionType || latest.action || '') : ''
      };
    });
  }

  private invoiceBalance(invoice: ApiRecord): number {
    const direct = invoice.balance ?? invoice.dueAmount ?? invoice.due_amount;
    if (direct !== undefined && direct !== null && direct !== '') return Math.max(0, Number(direct) || 0);
    const total = Number(invoice.total ?? invoice.grand_total ?? invoice.grandTotal ?? 0);
    const paid = Number(invoice.paid ?? invoice.paid_amount ?? invoice.paidAmount ?? 0);
    return Math.max(0, total - paid);
  }

  private money(value: unknown): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private currencyText(value: unknown): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(this.money(value));
  }

  private reportFocusClientId(): string {
    if (this.requestedReportClientId) return this.requestedReportClientId;
    const visible = this.filteredClients;
    if (visible.length === 1) return String(visible[0].id || '');
    const query = this.query.trim().toLowerCase();
    if (!query) return '';
    const match = this.clients().find((client) => {
      const values = [client.id, client.name, client.phone, client.mobile, client.whatsapp, client.email];
      return values.some((value) => String(value || '').toLowerCase().includes(query));
    });
    return String(match?.id || '');
  }

  private filteredClientIds(): string[] {
    return this.filteredClients.map((client) => String(client.id || '')).filter(Boolean);
  }

  private dateInputValue(value: unknown): string {
    if (!value) return '';
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
  }

  private removeDeletedClients(ids: string[]): void {
    const deleted = new Set(ids);
    this.clients.set(this.clients().filter((client) => !deleted.has(String(client.id))));
    this.selectedClientIds.set(this.selectedClientIds().filter((id) => !deleted.has(id)));
  }
}
