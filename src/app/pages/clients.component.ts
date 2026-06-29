import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink, CurrencyPipe, DatePipe, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero client-command-hero">
        <div class="hero-copy">
          <h2>Client intelligence</h2>
        </div>
        <div class="client-hero-actions">
          <button class="ghost-button" type="button" (click)="loadReports()" [disabled]="reportLoading()">Refresh reports</button>
          <button class="ghost-button" type="button" (click)="loadDuplicateGroups()" [disabled]="duplicateLoading()">{{ duplicateLoading() ? 'Scanning...' : 'Find duplicates' }}</button>
          <button class="primary-button" type="button" (click)="showForm() ? closeForm() : openCreateForm()">{{ showForm() ? 'Close form' : 'Add client' }}</button>
        </div>
      </div>

      <section class="panel client-reports-panel">
        <div class="section-title client-report-heading">
          <div class="client-api-strip" aria-label="Client report APIs">
            <span>clients/360</span>
            <span>clients/top-rfm</span>
            <span>clients/lapsed</span>
            <span>clients/new-vs-returning</span>
            <span>clients/occasions</span>
            <span>clients/by-service</span>
            <span>clients/metric-cards</span>
          </div>
        </div>

        <app-state [loading]="reportLoading()" [error]="reportError()"></app-state>

        <ng-container *ngIf="clientReports() as reports">
          <div class="metrics-grid client-report-metrics">
            <button class="metric-card teal kpi-link-card" type="button" (click)="openClient(client360Report()?.client?.id || '')">
              <span>Client 360</span>
              <strong>{{ client360Report()?.client?.name || 'No client' }}</strong>
              <small>{{ (client360Report()?.metrics?.totalSpend || 0) | currency: 'INR':'symbol':'1.0-0' }} lifetime</small>
            </button>
            <button class="metric-card blue kpi-link-card" type="button" (click)="openClientReport('top-rfm')">
              <span>Top Clients RFM</span>
              <strong>{{ reportList('topRfm')[0]?.name || '-' }}</strong>
              <small>Score {{ reportList('topRfm')[0]?.rfmScore || 0 }} · {{ (reportList('topRfm')[0]?.monetary || 0) | currency: 'INR':'symbol':'1.0-0' }}</small>
            </button>
            <button class="metric-card red kpi-link-card" type="button" (click)="openClientReport('lapsed')">
              <span>Lapsed / at-risk</span>
              <strong>{{ reportList('lapsed').length }}</strong>
              <small>60-180 day recovery queue</small>
            </button>
            <button class="metric-card green kpi-link-card" type="button" (click)="openClientReport('new-vs-returning')">
              <span>New vs returning</span>
              <strong>{{ latestMonthlyReport().newClients || 0 }} / {{ latestMonthlyReport().returningClients || 0 }}</strong>
              <small>{{ latestMonthlyReport().month || 'Current month' }}</small>
            </button>
            <button class="metric-card amber kpi-link-card" type="button" (click)="openClientReport('occasions')">
              <span>Birthdays / anniversaries</span>
              <strong>{{ reportList('occasions').length }}</strong>
              <small>Next 30 days</small>
            </button>
            <button class="metric-card violet kpi-link-card" type="button" (click)="openClientReport('by-service')">
              <span>Service-wise clients</span>
              <strong>{{ reportList('byService')[0]?.serviceName || '-' }}</strong>
              <small>{{ reportList('byService')[0]?.clientCount || 0 }} client(s)</small>
            </button>
            <article class="metric-card teal">
              <span>Visit & service</span>
              <strong>{{ metricCardValue('last-visit', 'New') }}</strong>
              <small>{{ metricCardValue('favorite-service', 'No favorite service') }}</small>
            </article>
            <article class="metric-card blue">
              <span>Average spend</span>
              <strong>{{ metricCardValue('average-spend', '₹0') }}</strong>
              <small>{{ metricCardValue('lifetime-value', 'No spend signal') }} lifetime</small>
            </article>
            <article class="metric-card green">
              <span>Relationship</span>
              <strong>{{ metricCardValue('preferred-staff', '-') }}</strong>
              <small>{{ metricCardValue('rebooking-rate', '0%') }} rebooking rate</small>
            </article>
            <article class="metric-card red">
              <span>Wallet & risk</span>
              <strong>{{ metricCardValue('outstanding-balance', '₹0') }}</strong>
              <small>{{ metricCardValue('loyalty-points', '0') }} loyalty · {{ metricCardValue('churn-risk-score', 'Low') }} risk</small>
            </article>
          </div>

        </ng-container>
      </section>

      <section class="form-panel client-edit-panel" *ngIf="showForm()">
        <div class="section-title compact-title">
          <div>
            <span class="eyebrow">{{ editingClientId() ? 'Edit client details' : 'New client' }}</span>
            <h2>{{ editingClientId() ? 'Fill gender, birthday, anniversary and note' : 'Add client profile' }}</h2>
          </div>
        </div>
        <form [formGroup]="form" (ngSubmit)="save()">
          <label class="field">
            <span>Name</span>
            <input formControlName="name" />
          </label>
          <label class="field">
            <span>Phone</span>
            <input formControlName="phone" />
          </label>
          <label class="field">
            <span>Email</span>
            <input type="email" formControlName="email" />
          </label>
          <label class="field">
            <span>Gender</span>
            <select formControlName="gender">
              <option value="">Select gender</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Other">Other</option>
              <option value="Prefer not to say">Prefer not to say</option>
            </select>
          </label>
          <label class="field">
            <span>Birthday</span>
            <input type="date" formControlName="birthday" />
          </label>
          <label class="field">
            <span>Anniversary</span>
            <input type="date" formControlName="anniversary" />
          </label>
          <label class="field">
            <span>Tags</span>
            <select formControlName="tag">
              <option>new</option>
              <option>VIP</option>
              <option>inactive</option>
              <option>high spender</option>
            </select>
          </label>
          <label class="field full">
            <span>Notes</span>
            <textarea formControlName="notes"></textarea>
          </label>
          <div class="form-actions">
            <button class="ghost-button" type="button" (click)="closeForm()">Cancel</button>
            <button class="primary-button" type="submit" [disabled]="form.invalid || saving()">{{ editingClientId() ? 'Update client' : 'Save client' }}</button>
          </div>
        </form>
      </section>

      <section class="panel client-database-panel">
        <div class="section-title client-list-title">
          <div><h2>Total client list</h2><p>{{ filteredClients.length }} visible · {{ totalClientCount }} loaded clients</p></div>
        </div>
        <div class="table-toolbar">
          <label class="search-field">
            <span>Search/filter</span>
            <input [(ngModel)]="query" placeholder="Name, phone, tag, membership" />
          </label>
          <div class="segmented">
            <button type="button" *ngFor="let tag of ['', 'VIP', 'new', 'inactive', 'high spender']" [class.active]="tagFilter() === tag" (click)="tagFilter.set(tag)">
              {{ tag || 'All' }}
            </button>
          </div>
          <div class="client-bulk-actions">
            <span>{{ selectedCount }} selected</span>
            <button class="ghost-button mini" type="button" (click)="toggleSelectAllVisible()" [disabled]="!filteredClients.length">
              {{ allVisibleSelected ? 'Clear visible' : 'Select all' }}
            </button>
            <button class="ghost-button mini" type="button" (click)="loadDuplicateGroups()" [disabled]="duplicateLoading()">Duplicates {{ duplicateGroups().length || '' }}</button>
            <button class="danger-button mini" type="button" (click)="deleteSelected()" [disabled]="!selectedCount || saving()">Delete selected</button>
          </div>
        </div>

        <section class="duplicate-merge-panel" *ngIf="duplicateLoading() || duplicateError() || duplicateMessage() || duplicateGroups().length">
          <div class="duplicate-panel-header">
            <div>
              <h3>Duplicate contacts</h3>
              <p>{{ duplicateGroups().length }} group(s) from matching phone or email</p>
            </div>
            <div class="duplicate-panel-actions">
              <button class="primary-button mini" type="button" *ngIf="duplicateGroups().length" (click)="mergeAllDuplicateGroups()" [disabled]="duplicateMergeAllLoading()">{{ duplicateMergeAllLoading() ? 'Merging...' : 'Merge all' }}</button>
              <button class="ghost-button mini" type="button" (click)="loadDuplicateGroups()" [disabled]="duplicateLoading() || duplicateMergeAllLoading()">Scan again</button>
            </div>
          </div>
          <app-state [loading]="duplicateLoading()" [error]="duplicateError()"></app-state>
          <p class="duplicate-message" *ngIf="duplicateMessage()">{{ duplicateMessage() }}</p>
          <p class="duplicate-message" *ngIf="duplicateGroups().length > visibleDuplicateGroups().length">Showing first {{ visibleDuplicateGroups().length }} groups. Merge all still processes all {{ duplicateGroups().length }} groups.</p>
          <div class="duplicate-group-list" *ngIf="!duplicateLoading() && duplicateGroups().length">
            <article class="duplicate-group" *ngFor="let group of visibleDuplicateGroups()" [class.active]="activeDuplicateGroupKey() === group.groupKey">
              <div class="duplicate-group-header">
                <div>
                  <strong>{{ group.matchLabel }}</strong>
                  <small>{{ duplicateMatchValues(group) }}</small>
                </div>
                <button class="primary-button mini" type="button" (click)="mergeDuplicateGroup(group, $event)" [disabled]="saving() || duplicateMergeAllLoading() || duplicateGroupClients(group).length < 2">Merge into selected</button>
              </div>
              <div class="duplicate-client-options">
                <button
                  class="duplicate-client-option"
                  type="button"
                  *ngFor="let duplicateClient of duplicateGroupClients(group)"
                  [class.primary]="duplicateGroupPrimaryId(group) === clientId(duplicateClient)"
                  (click)="setDuplicatePrimary(group, clientId(duplicateClient), $event)"
                >
                  <span class="avatar">{{ initials(clientDisplayName(duplicateClient)) }}</span>
                  <span>
                    <strong>{{ clientDisplayName(duplicateClient) }}</strong>
                    <small>{{ clientContactLine(duplicateClient) }}</small>
                    <small>{{ duplicateClient.visitCount || 0 }} visits · {{ (duplicateClient.totalSpend || 0) | currency: 'INR':'symbol':'1.0-0' }}</small>
                  </span>
                  <em>{{ duplicateGroupPrimaryId(group) === clientId(duplicateClient) ? 'Keep' : 'Merge' }}</em>
                </button>
              </div>
            </article>
          </div>
        </section>

        <app-state [loading]="loading()" [error]="error()"></app-state>

        <div class="table-wrap" *ngIf="!loading()">
          <table class="clients-crm-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Gender</th>
                <th>Birthday</th>
                <th>Anniversary</th>
                <th>Note</th>
                <th class="right">Unpaid</th>
                <th>Tags</th>
                <th>Spend</th>
                <th>Visits</th>
                <th>Wallet</th>
                <th>Loyalty</th>
                <th>Last visit</th>
                <th class="right">Edit / Delete</th>
              </tr>
            </thead>
            <tbody>
              <tr
                class="clickable-client-row"
                *ngFor="let client of filteredClients"
                tabindex="0"
                role="button"
                [attr.aria-label]="'Open profile for ' + clientDisplayName(client)"
                (click)="openClient(clientId(client))"
                (keydown.enter)="openClient(clientId(client))"
                (keydown.space)="openClient(clientId(client)); $event.preventDefault()"
              >
                <td>
                  <a class="identity-cell" [routerLink]="['/clients', clientId(client)]" (click)="$event.stopPropagation()">
                    <span class="avatar">{{ initials(clientDisplayName(client)) }}</span>
                    <span>
                      <strong>{{ clientDisplayName(client) }}</strong>
                      <small>{{ clientContactLine(client) }}</small>
                    </span>
                  </a>
                </td>
                <td>{{ client.gender || '-' }}</td>
                <td>{{ client.birthday ? (client.birthday | date: 'mediumDate') : '-' }}</td>
                <td>{{ client.anniversary ? (client.anniversary | date: 'mediumDate') : '-' }}</td>
                <td class="note-cell" [title]="client.notes || ''">{{ shortText(client.notes) }}</td>
                <td class="right" [class.due-amount]="client.unpaidBalance > 0">{{ client.unpaidBalance | currency: 'INR':'symbol':'1.0-0' }}</td>
                <td>
                  <span class="badge" *ngFor="let tag of clientTags(client)">{{ tag }}</span>
                </td>
                <td>{{ client.totalSpend | currency: 'INR':'symbol':'1.0-0' }}</td>
                <td>{{ client.visitCount }}</td>
                <td>{{ client.walletBalance | currency: 'INR':'symbol':'1.0-0' }}</td>
                <td>{{ client.loyaltyPoints }} pts</td>
                <td>{{ client.lastVisitAt ? (client.lastVisitAt | date: 'mediumDate') : 'New' }}</td>
                <td class="actions-cell right">
                  <button class="ghost-button mini duplicate-row-button" type="button" *ngIf="duplicateGroupForClient(client)" (click)="openDuplicateGroupForClient(client, $event)" [disabled]="saving()">Duplicates {{ duplicateCountForClient(client) }}</button>
                  <button class="ghost-button mini" type="button" (click)="editClient(client, $event)" [disabled]="saving()">Edit</button>
                  <label class="row-select" (click)="$event.stopPropagation()">
                    <input
                      type="checkbox"
                      [checked]="isClientSelected(clientId(client))"
                      (change)="toggleClientSelection(clientId(client), $event)"
                      [attr.aria-label]="'Select ' + clientDisplayName(client)"
                    />
                  </label>
                  <button class="danger-button mini" type="button" (click)="deleteClient(client, $event)" [disabled]="saving()">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="client-load-more" *ngIf="hasMoreClients()">
            <button class="ghost-button" type="button" (click)="loadMoreClients()" [disabled]="loading()">Load more clients</button>
            <span>Showing {{ totalClientCount }}. Next batch loads {{ clientBatchSize }} more.</span>
          </div>
        </div>
      </section>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .page-stack {
      --client-edge-safe: clamp(14px, 1.6vw, 28px);
      width: 100%;
      max-width: none;
      min-width: 0;
      padding-inline-end: var(--client-edge-safe);
      box-sizing: border-box;
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

    .client-load-more {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 2px 0;
      color: var(--muted);
      font-weight: 700;
      flex-wrap: wrap;
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
      overflow: hidden;
    }

    .client-database-panel .table-toolbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: grid;
      grid-template-columns: minmax(320px, 1fr) minmax(300px, max-content) minmax(260px, max-content);
      align-items: end;
      gap: 12px;
      overflow: visible;
      padding: 12px;
      border: 1px solid color-mix(in srgb, var(--line) 75%, white);
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--surface) 92%, white);
      backdrop-filter: blur(18px);
    }

    .client-database-panel .search-field {
      min-width: 0;
      width: min(760px, 100%);
    }

    .client-database-panel .client-bulk-actions {
      min-width: 0;
      max-width: 100%;
      display: flex;
      justify-self: end;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
    }

    .client-database-panel .client-bulk-actions .danger-button {
      flex: 0 0 auto;
    }

    .client-database-panel .table-wrap {
      max-height: min(780px, 72vh);
      overflow: auto;
      overscroll-behavior: contain;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: var(--surface);
      box-shadow: 0 14px 34px color-mix(in srgb, var(--ink) 4%, transparent);
    }

    .client-database-panel .clients-crm-table {
      min-width: 1360px;
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
      min-width: 292px;
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

    .client-database-panel .actions-cell > * {
      margin-left: 6px;
      vertical-align: middle;
    }

    .duplicate-merge-panel {
      display: grid;
      gap: 12px;
      margin: 12px 0;
      padding: 12px;
      border: 1px solid color-mix(in srgb, var(--teal) 24%, var(--line));
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--surface) 95%, var(--teal));
    }

    .duplicate-panel-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .duplicate-panel-header,
    .duplicate-group-header,
    .duplicate-client-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .duplicate-panel-header h3,
    .duplicate-panel-header p {
      margin: 0;
    }

    .duplicate-panel-header p,
    .duplicate-group-header small,
    .duplicate-client-option small {
      color: var(--muted);
      font-weight: 700;
    }

    .duplicate-group-list {
      display: grid;
      gap: 10px;
    }

    .duplicate-group {
      display: grid;
      gap: 10px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--surface);
    }

    .duplicate-group.active {
      border-color: color-mix(in srgb, var(--teal) 54%, var(--line));
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--teal) 12%, transparent);
    }

    .duplicate-client-options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 8px;
    }

    .duplicate-client-option {
      width: 100%;
      min-height: 74px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 9px;
      color: inherit;
      background: color-mix(in srgb, var(--surface) 96%, white);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .duplicate-client-option.primary {
      border-color: color-mix(in srgb, var(--green) 56%, var(--line));
      background: color-mix(in srgb, var(--surface) 88%, var(--green));
    }

    .duplicate-client-option > span:nth-child(2) {
      min-width: 0;
      display: grid;
      gap: 2px;
      flex: 1 1 auto;
    }

    .duplicate-client-option em {
      color: var(--muted);
      font-size: 12px;
      font-style: normal;
      font-weight: 900;
      text-transform: uppercase;
    }

    .duplicate-message {
      margin: 0;
      color: var(--teal);
      font-weight: 850;
    }

    .duplicate-row-button {
      border-color: color-mix(in srgb, var(--teal) 36%, var(--line));
    }

    @media (max-width: 1380px) {
      .client-command-hero {
        grid-template-columns: 1fr;
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
    }

    @media (max-width: 760px) {
      .page-stack {
        width: 100%;
        max-width: 100%;
        padding-inline-end: 0;
      }

      .client-report-metrics {
        width: 100%;
        max-width: 100%;
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
        min-width: 244px;
        padding-right: 12px;
      }

      .client-report-metrics {
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
  readonly showForm = signal(false);
  readonly tagFilter = signal('');
  readonly selectedClientIds = signal<string[]>([]);
  readonly hasMoreClients = signal(false);
  readonly editingClientId = signal('');
  readonly clientReports = signal<ApiRecord | null>(null);
  readonly client360Report = signal<ApiRecord | null>(null);
  readonly selectedMetricCardId = signal('');
  readonly selectedMetricCategory = signal('All');
  readonly reportLoading = signal(true);
  readonly reportError = signal('');
  readonly duplicateGroups = signal<ApiRecord[]>([]);
  readonly duplicateLoading = signal(false);
  readonly duplicateMergeAllLoading = signal(false);
  readonly duplicateError = signal('');
  readonly duplicateMessage = signal('');
  readonly duplicatePrimarySelection = signal<Record<string, string>>({});
  readonly activeDuplicateGroupKey = signal('');
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
  readonly clientBatchSize = 500;
  private clientLimit = this.clientBatchSize;
  private clientBatchTimer: ReturnType<typeof setTimeout> | undefined;
  private clientLoadInFlight = false;
  private reportLoadInFlight = false;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private readonly refreshOnFocus = () => this.refreshVisibleData();
  private readonly refreshOnVisibility = () => {
    if (document.visibilityState === 'visible') this.refreshVisibleData();
  };
  query = '';

  readonly form = this.fb.group({
    name: ['', Validators.required],
    phone: ['', Validators.required],
    email: [''],
    gender: [''],
    birthday: [''],
    anniversary: [''],
    tag: ['new'],
    notes: ['']
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
    this.pendingEditClientId = this.route.snapshot.queryParamMap.get('edit') || '';
    this.load();
    this.loadReports();
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.clientBatchTimer) clearTimeout(this.clientBatchTimer);
    window.removeEventListener('focus', this.refreshOnFocus);
    document.removeEventListener('visibilitychange', this.refreshOnVisibility);
  }

  get filteredClients(): ApiRecord[] {
    return this.clients()
      .filter((client) => client && typeof client === 'object')
      .filter((client) => {
        const queryMatch = JSON.stringify(client).toLowerCase().includes(this.query.toLowerCase());
        const tagMatch = this.tagFilter() ? this.clientTags(client).includes(this.tagFilter()) : true;
        return queryMatch && tagMatch;
      });
  }

  get totalClientCount(): number {
    return this.clients().filter((client) => client && typeof client === 'object').length;
  }

  get selectedCount(): number {
    return this.selectedClientIds().length;
  }

  get allVisibleSelected(): boolean {
    const visibleIds = this.filteredClientIds();
    const selected = new Set(this.selectedClientIds());
    return visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  }

  clientId(client: ApiRecord | null | undefined): string {
    return String(client?.id || '');
  }

  clientDisplayName(client: ApiRecord | null | undefined): string {
    if (!client) return 'Client';
    return String(client.name || client.fullName || client.full_name || client.clientName || client.customerName || client.phone || client.email || client.id || 'Client').trim() || 'Client';
  }

  clientPhone(client: ApiRecord | null | undefined): string {
    return String(client?.phone || client?.mobile || client?.mobileNumber || client?.contactNumber || '').trim();
  }

  clientContactLine(client: ApiRecord | null | undefined): string {
    const phone = this.clientPhone(client) || 'No phone';
    const email = String(client?.email || '').trim() || 'No email';
    return `${phone} · ${email}`;
  }

  clientTags(client: ApiRecord | null | undefined): string[] {
    const tags = client?.tags;
    if (Array.isArray(tags)) return tags.filter(Boolean).map(String);
    return tags ? [String(tags)] : [];
  }

  private normalizeClients(clients: ApiRecord[]): ApiRecord[] {
    return clients
      .filter((client) => client && typeof client === 'object')
      .map((client) => ({
        ...client,
        id: this.clientId(client),
        name: this.clientDisplayName(client),
        phone: this.clientPhone(client),
        email: String(client.email || '').trim(),
        tags: this.clientTags(client)
      }));
  }
  load(showSpinner = true): void {
    if (this.clientLoadInFlight) return;
    this.clientLoadInFlight = true;
    if (showSpinner) {
      this.loading.set(true);
      this.error.set('');
    }
    const listParams = { includeAllBranches: true, limit: this.clientLimit };
    forkJoin({
      clients: this.api.list<ApiRecord[]>('clients', listParams),
      invoices: this.api.list<ApiRecord[]>('invoices', listParams),
      walletTransactions: this.api.list<ApiRecord[]>('walletTransactions', listParams)
    }).subscribe({
      next: ({ clients, invoices, walletTransactions }) => {
        const loadedClients = this.normalizeClients(clients || []);
        this.hasMoreClients.set(loadedClients.length >= this.clientLimit);
        const linkedWalletClients = this.withWalletBalances(loadedClients, walletTransactions || []);
        this.clients.set(this.withUnpaidBalances(linkedWalletClients, invoices || []));
        this.selectedClientIds.set(this.selectedClientIds().filter((id) => this.clients().some((client) => this.clientId(client) === id)));
        this.openPendingEditClient();
        this.clientLoadInFlight = false;
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load clients');
        this.clientLoadInFlight = false;
        this.loading.set(false);
      }
    });
  }
  loadMoreClients(): void {
    if (this.clientBatchTimer) clearTimeout(this.clientBatchTimer);
    this.clientBatchTimer = undefined;
    this.loadNextClientBatch(true);
  }

  private loadNextClientBatch(showSpinner: boolean): void {
    if (this.clientLoadInFlight) return;
    this.clientLimit += this.clientBatchSize;
    this.load(showSpinner);
  }

  loadReports(showSpinner = true): void {
    if (this.reportLoadInFlight) return;
    this.reportLoadInFlight = true;
    if (showSpinner) {
      this.reportLoading.set(true);
      this.reportError.set('');
    }
    const reportScope = { includeAllBranches: true };
    forkJoin({
      topRfm: this.api.report<ApiRecord[]>('clients/top-rfm', { ...reportScope, limit: 10 }),
      lapsed: this.api.report<ApiRecord[]>('clients/lapsed', { ...reportScope, minDays: 60, maxDays: 180, limit: 10 }),
      newVsReturning: this.api.report<ApiRecord[]>('clients/new-vs-returning', { ...reportScope, months: 6 }),
      occasions: this.api.report<ApiRecord[]>('clients/occasions', { ...reportScope, withinDays: 30, limit: 10 }),
      byService: this.api.report<ApiRecord[]>('clients/by-service', { ...reportScope, limit: 8 })
    }).subscribe({
      next: (reports) => {
        this.clientReports.set(reports);
        this.reportLoadInFlight = false;
        this.reportLoading.set(false);
        const focusClientId = reports.topRfm?.[0]?.id || reports.lapsed?.[0]?.id || this.clients()[0]?.id || '';
        if (focusClientId) {
          this.loadClient360(String(focusClientId));
        } else {
          this.client360Report.set(null);
        }
      },
      error: (error) => {
        this.reportError.set(this.api.errorText(error, 'Unable to load client reports'));
        this.reportLoadInFlight = false;
        this.reportLoading.set(false);
      }
    });
  }
  loadClient360(clientId: string): void {
    if (!clientId) return;
    this.api.report<ApiRecord>(`clients/${encodeURIComponent(clientId)}/360`, {
      includeAllBranches: true
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

  loadDuplicateGroups(successMessage = ''): void {
    if (this.duplicateLoading()) return;
    this.duplicateLoading.set(true);
    this.duplicateError.set('');
    if (!successMessage) this.duplicateMessage.set('');
    this.api.list<ApiRecord[]>('clients/duplicates', { includeAllBranches: true }).subscribe({
      next: (groups) => {
        const duplicateGroups = Array.isArray(groups) ? groups : [];
        this.duplicateGroups.set(duplicateGroups);
        const selection: Record<string, string> = {};
        for (const group of duplicateGroups) {
          const key = String(group.groupKey || '');
          if (!key) continue;
          selection[key] = String(group.suggestedPrimaryId || this.duplicateGroupClients(group)[0]?.id || '');
        }
        this.duplicatePrimarySelection.set(selection);
        this.duplicateMessage.set(successMessage || (duplicateGroups.length ? '' : 'No duplicate contacts found from phone or email.'));
        this.duplicateLoading.set(false);
      },
      error: (error) => {
        this.duplicateError.set(this.api.errorText(error, 'Unable to scan duplicate clients'));
        this.duplicateLoading.set(false);
      }
    });
  }

  visibleDuplicateGroups(): ApiRecord[] {
    return this.duplicateGroups().slice(0, 100);
  }
  duplicateGroupClients(group: ApiRecord | null | undefined): ApiRecord[] {
    return Array.isArray(group?.clients) ? group.clients : [];
  }

  duplicateMatchValues(group: ApiRecord | null | undefined): string {
    const values = Array.isArray(group?.matchValues) ? group.matchValues.filter(Boolean).map(String) : [];
    return values.length ? values.join(', ') : 'Matching contact details';
  }

  duplicateGroupPrimaryId(group: ApiRecord | null | undefined): string {
    const key = String(group?.groupKey || '');
    const selection = this.duplicatePrimarySelection();
    return String(selection[key] || group?.suggestedPrimaryId || this.duplicateGroupClients(group)[0]?.id || '');
  }

  setDuplicatePrimary(group: ApiRecord, clientId: string, event?: Event): void {
    event?.stopPropagation();
    const key = String(group?.groupKey || '');
    const id = String(clientId || '');
    if (!key || !id) return;
    this.activeDuplicateGroupKey.set(key);
    this.duplicatePrimarySelection.set({ ...this.duplicatePrimarySelection(), [key]: id });
  }

  duplicateGroupForClient(client: ApiRecord | null | undefined): ApiRecord | null {
    const id = this.clientId(client);
    if (!id) return null;
    return this.duplicateGroups().find((group) => this.duplicateGroupClients(group).some((item) => this.clientId(item) === id)) || null;
  }

  duplicateCountForClient(client: ApiRecord | null | undefined): number {
    const group = this.duplicateGroupForClient(client);
    return group ? Math.max(this.duplicateGroupClients(group).length - 1, 0) : 0;
  }

  openDuplicateGroupForClient(client: ApiRecord, event?: Event): void {
    event?.stopPropagation();
    const group = this.duplicateGroupForClient(client);
    if (group?.groupKey) {
      this.activeDuplicateGroupKey.set(String(group.groupKey));
      return;
    }
    this.loadDuplicateGroups();
  }

  mergeAllDuplicateGroups(): void {
    const groupCount = this.duplicateGroups().length;
    if (!groupCount) return;
    if (!window.confirm(`Merge all ${groupCount} duplicate group(s)? This will keep the suggested primary contact in each group.`)) return;
    this.saving.set(true);
    this.duplicateMergeAllLoading.set(true);
    this.duplicateError.set('');
    this.duplicateMessage.set('Merging duplicate contacts...');
    this.api.post<ApiRecord>('clients/duplicates/merge-all', {
      includeAllBranches: true,
      allBranches: true,
      reason: 'Merged by frontdesk duplicate merge all'
    }).subscribe({
      next: (result) => {
        const mergedClients = Number(result?.mergedClients || 0);
        const mergedGroups = Number(result?.mergedGroups || 0);
        const remainingGroups = Number(result?.remainingGroups || 0);
        const successMessage = `Merged ${mergedClients} duplicate client(s) across ${mergedGroups} group(s). ${remainingGroups} group(s) remaining.`;
        this.duplicateMessage.set(successMessage);
        this.saving.set(false);
        this.duplicateMergeAllLoading.set(false);
        this.load(false);
        this.loadReports(false);
        this.loadDuplicateGroups(successMessage);
      },
      error: (error) => {
        this.duplicateError.set(this.api.errorText(error, 'Unable to merge all duplicate clients'));
        this.saving.set(false);
        this.duplicateMergeAllLoading.set(false);
      }
    });
  }
  mergeDuplicateGroup(group: ApiRecord, event?: Event): void {
    event?.stopPropagation();
    const clients = this.duplicateGroupClients(group);
    const primaryId = this.duplicateGroupPrimaryId(group);
    const duplicateClientIds = clients.map((client) => this.clientId(client)).filter((id) => id && id !== primaryId);
    if (!primaryId || !duplicateClientIds.length) return;
    const primary = clients.find((client) => this.clientId(client) === primaryId);
    if (!window.confirm(`Merge ${duplicateClientIds.length} duplicate client(s) into "${this.clientDisplayName(primary)}"?`)) return;
    this.saving.set(true);
    this.duplicateError.set('');
    this.duplicateMessage.set('');
    this.api.post<ApiRecord>(`clients/${encodeURIComponent(primaryId)}/merge-duplicates`, {
      duplicateClientIds,
      reason: 'Merged from frontdesk duplicate client panel'
    }).subscribe({
      next: (result) => {
        const archivedIds = Array.isArray(result?.archivedClientIds) ? result.archivedClientIds.map(String) : duplicateClientIds;
        const updatedPrimary = result?.primary ? this.normalizeClients([result.primary])[0] : null;
        const remaining = this.clients().filter((client) => !archivedIds.includes(this.clientId(client)));
        this.clients.set(updatedPrimary
          ? remaining.map((client) => this.clientId(client) === primaryId ? { ...client, ...updatedPrimary } : client)
          : remaining);
        this.selectedClientIds.set(this.selectedClientIds().filter((id) => !archivedIds.includes(id)));
        const successMessage = `Merged ${archivedIds.length} duplicate client(s).`;
        this.duplicateMessage.set(successMessage);
        this.saving.set(false);
        this.load(false);
        this.loadReports(false);
        this.loadDuplicateGroups(successMessage);
      },
      error: (error) => {
        this.duplicateError.set(this.api.errorText(error, 'Unable to merge duplicate clients'));
        this.saving.set(false);
      }
    });
  }
  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const value = this.form.value;
    const payload = {
      name: value.name,
      phone: value.phone,
      email: value.email,
      gender: value.gender,
      birthday: value.birthday,
      anniversary: value.anniversary,
      tags: [value.tag],
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
      email: '',
      gender: '',
      birthday: '',
      anniversary: '',
      tag: 'new',
      notes: ''
    });
    this.showForm.set(true);
  }

  closeForm(reset = true): void {
    this.showForm.set(false);
    this.editingClientId.set('');
    if (reset) {
      this.form.reset({
        name: '',
        phone: '',
        email: '',
        gender: '',
        birthday: '',
        anniversary: '',
        tag: 'new',
        notes: ''
      });
    }
  }

  editClient(client: ApiRecord, event?: Event): void {
    event?.stopPropagation();
    this.editingClientId.set(this.clientId(client));
    this.form.patchValue({
      name: this.clientDisplayName(client),
      phone: this.clientPhone(client),
      email: client.email || '',
      gender: client.gender || '',
      birthday: this.dateInputValue(client.birthday),
      anniversary: this.dateInputValue(client.anniversary),
      tag: this.clientTags(client)[0] || 'new',
      notes: client.notes || ''
    });
    this.showForm.set(true);
  }

  private openPendingEditClient(): void {
    const clientId = this.pendingEditClientId;
    if (!clientId) return;
    const client = this.clients().find((item) => this.clientId(item) === clientId);
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
    const id = this.clientId(client);
    if (!id || !window.confirm(`Delete client "${this.clientDisplayName(client) || id}"?`)) return;
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

  clientMetricCards(): ApiRecord[] {
    const value = this.client360Report()?.metricCards;
    return Array.isArray(value) ? value.filter((card) => this.usefulMetricCardIds.has(String(card.id))) : [];
  }

  metricCardValue(cardId: string, fallback = '-'): string {
    const card = this.clientMetricCards().find((item) => String(item.id) === cardId);
    const value = card?.value;
    return value === undefined || value === null || value === '' ? fallback : String(value);
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
    return 'All branches';
  }

  private startAutoRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => this.refreshVisibleData(), 30000);
    window.addEventListener('focus', this.refreshOnFocus);
    document.addEventListener('visibilitychange', this.refreshOnVisibility);
  }

  private refreshVisibleData(): void {
    if (document.visibilityState === 'hidden' || this.saving()) return;
    this.load(false);
    this.loadReports(false);
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
      unpaidBalance: unpaidByClient.get(this.clientId(client)) || 0
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
      const latest = latestByClient.get(this.clientId(client));
      const linkedBalance = latest?.balanceAfter ?? latest?.balance_after;
      return {
        ...client,
        walletBalance: linkedBalance !== undefined && linkedBalance !== null && linkedBalance !== ''
          ? this.money(linkedBalance)
          : this.money(client.walletBalance || 0)
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

  private filteredClientIds(): string[] {
    return this.filteredClients.map((client) => this.clientId(client)).filter(Boolean);
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
    this.clients.set(this.clients().filter((client) => !deleted.has(this.clientId(client))));
    this.selectedClientIds.set(this.selectedClientIds().filter((id) => !deleted.has(id)));
  }
}
