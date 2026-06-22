import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
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
          <span class="eyebrow">Client CRM · Enterprise cockpit</span>
          <h2>Client intelligence command center</h2>
          <p>One place to monitor value, risk, service affinity, rebooking behavior and relationship signals.</p>
          <div class="hero-signal-row">
            <span>{{ client360Report()?.client?.name || 'No client selected' }}</span>
            <span>{{ clientMetricCards().length || 0 }} live metrics</span>
            <span>{{ metricConnectionCount() || 0 }} data links</span>
          </div>
        </div>
        <div class="client-hero-actions">
          <button class="ghost-button" type="button" (click)="loadReports()" [disabled]="reportLoading()">Refresh reports</button>
          <button class="primary-button" type="button" (click)="showForm() ? closeForm() : openCreateForm()">{{ showForm() ? 'Close form' : 'Add client' }}</button>
        </div>
      </div>

      <section class="panel client-reports-panel">
        <div class="section-title client-report-heading">
          <div>
            <span class="eyebrow">Decision layer</span>
            <h2>Client revenue, retention and risk cockpit</h2>
            <p>Built from persisted invoices, appointments, sales, memberships, wallet, messages and reviews.</p>
          </div>
          <span class="badge">{{ reportBranchLabel() }}</span>
        </div>

        <app-state [loading]="reportLoading()" [error]="reportError()"></app-state>

        <ng-container *ngIf="clientReports() as reports">
          <div class="metrics-grid client-report-metrics">
            <article class="metric-card teal">
              <span>Client 360</span>
              <strong>{{ client360Report()?.client?.name || 'No client' }}</strong>
              <small>{{ (client360Report()?.metrics?.totalSpend || 0) | currency: 'INR':'symbol':'1.0-0' }} lifetime</small>
            </article>
            <article class="metric-card blue">
              <span>Top Clients RFM</span>
              <strong>{{ reportList('topRfm')[0]?.name || '-' }}</strong>
              <small>Score {{ reportList('topRfm')[0]?.rfmScore || 0 }} · {{ (reportList('topRfm')[0]?.monetary || 0) | currency: 'INR':'symbol':'1.0-0' }}</small>
            </article>
            <article class="metric-card red">
              <span>Lapsed / at-risk</span>
              <strong>{{ reportList('lapsed').length }}</strong>
              <small>60-180 day recovery queue</small>
            </article>
            <article class="metric-card green">
              <span>New vs returning</span>
              <strong>{{ latestMonthlyReport().newClients || 0 }} / {{ latestMonthlyReport().returningClients || 0 }}</strong>
              <small>{{ latestMonthlyReport().month || 'Current month' }}</small>
            </article>
            <article class="metric-card amber">
              <span>Birthdays / anniversaries</span>
              <strong>{{ reportList('occasions').length }}</strong>
              <small>Next 30 days</small>
            </article>
            <article class="metric-card violet">
              <span>Service-wise clients</span>
              <strong>{{ reportList('byService')[0]?.serviceName || '-' }}</strong>
              <small>{{ reportList('byService')[0]?.clientCount || 0 }} client(s)</small>
            </article>
          </div>

          <section class="client-report-card client-360-metric-board" *ngIf="clientMetricCards().length">
            <div class="section-title compact">
              <div>
                <span class="eyebrow">Connected Client 360</span>
                <h3>{{ client360Report()?.client?.name || 'Selected client' }} insight board</h3>
              </div>
              <div class="metric-board-actions">
                <span class="badge">{{ clientMetricCards().length }} metrics</span>
                <button class="ghost-button mini" type="button" *ngIf="client360Report()?.client?.id" (click)="openClient(client360Report()?.client?.id || '')">Open profile</button>
              </div>
            </div>

            <div class="metric-command-layout">
              <aside class="connected-card-inspector" *ngIf="selectedMetricCard() as card">
                <div class="inspector-focus">
                  <span class="eyebrow">Selected signal</span>
                  <h3>{{ card.label }}</h3>
                  <strong>{{ card.value }}</strong>
                  <p>{{ card.detail }}</p>
                  <small>Source: {{ card.source }}</small>
                </div>
                <div>
                  <span class="eyebrow">Connected metrics</span>
                  <div class="connected-card-links">
                    <button type="button" *ngFor="let linked of connectedMetricCards(card)" (click)="selectMetricCard(linked.id)">
                      <strong>{{ linked.label }}</strong>
                      <span>{{ linked.value }}</span>
                    </button>
                  </div>
                </div>
              </aside>

              <div class="metric-command-main">
                <div class="metric-category-tabs">
                  <button type="button" [class.active]="selectedMetricCategory() === 'All'" (click)="selectedMetricCategory.set('All')">All · {{ clientMetricCards().length }}</button>
                  <button type="button" *ngFor="let group of metricGroups()" [class.active]="selectedMetricCategory() === group.category" (click)="selectedMetricCategory.set(group.category)">
                    {{ group.category }} · {{ group.count }}
                  </button>
                </div>

                <div class="client-360-card-grid">
                  <button class="metric-card smart-client-card" type="button" *ngFor="let card of visibleMetricCards(); let index = index" [ngClass]="card.tone || 'teal'" [class.active]="selectedMetricCardId() === card.id" (click)="selectMetricCard(card.id)">
                    <span class="metric-card-header"><b>#{{ index + 1 }}</b><i>{{ card.category }}</i></span>
                    <strong>{{ card.value }}</strong>
                    <small>{{ card.label }}</small>
                    <em>{{ card.detail }}</em>
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div class="dashboard-grid client-report-grid">
            <section class="client-report-card">
              <div class="section-title compact">
                <h3>Client 360 profile</h3>
                <button class="ghost-button mini" type="button" *ngIf="client360Report()?.client?.id" (click)="openClient(client360Report()?.client?.id || '')">Open</button>
              </div>
              <div class="summary-lines" *ngIf="client360Report() as profile">
                <div><span>Total visits</span><strong>{{ profile.metrics.totalVisits || 0 }}</strong></div>
                <div><span>Total spend</span><strong>{{ (profile.metrics.totalSpend || 0) | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
                <div><span>Average bill</span><strong>{{ (profile.metrics.averageBill || 0) | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
                <div><span>Favorite service</span><strong>{{ profile.metrics.favoriteService }}</strong></div>
                <div><span>Last visit</span><strong>{{ profile.metrics.lastVisitAt ? (profile.metrics.lastVisitAt | date: 'mediumDate') : 'New' }}</strong></div>
              </div>
            </section>

            <section class="client-report-card">
              <div class="section-title compact"><h3>Top clients (RFM)</h3></div>
              <div class="mini-report-table">
                <div class="mini-report-row header"><span>Client</span><span>RFM</span><span>Spend</span></div>
                <button class="mini-report-row clickable" type="button" *ngFor="let row of reportList('topRfm').slice(0, 6)" (click)="loadClient360(row.id)">
                  <span><strong>{{ row.name }}</strong><small>{{ row.segment }}</small></span>
                  <span>{{ row.rfmScore }}</span>
                  <span>{{ row.monetary | currency: 'INR':'symbol':'1.0-0' }}</span>
                </button>
              </div>
            </section>

            <section class="client-report-card">
              <div class="section-title compact"><h3>Lapsed / at-risk clients</h3></div>
              <div class="activity-list compact-history">
                <article *ngFor="let row of reportList('lapsed').slice(0, 5)">
                  <strong>{{ row.name }} · {{ row.daysSinceLastVisit }} days</strong>
                  <span>{{ row.suggestedAction }} · {{ row.monetary | currency: 'INR':'symbol':'1.0-0' }}</span>
                </article>
                <article *ngIf="!reportList('lapsed').length"><strong>No lapsed clients in this window</strong><span>Current 60-180 day recovery queue is empty.</span></article>
              </div>
            </section>

            <section class="client-report-card">
              <div class="section-title compact"><h3>New vs returning clients</h3></div>
              <div class="mini-report-table">
                <div class="mini-report-row header"><span>Month</span><span>New</span><span>Returning</span></div>
                <div class="mini-report-row" *ngFor="let row of reportList('newVsReturning').slice(-6)">
                  <span>{{ row.month }}</span>
                  <span>{{ row.newClients }}</span>
                  <span>{{ row.returningClients }}</span>
                </div>
              </div>
            </section>

            <section class="client-report-card">
              <div class="section-title compact"><h3>Birthday / anniversary</h3></div>
              <div class="activity-list compact-history">
                <article *ngFor="let row of reportList('occasions').slice(0, 5)">
                  <strong>{{ row.name }} · {{ titleText(row.type) }}</strong>
                  <span>{{ row.nextDate | date: 'mediumDate' }} · in {{ row.daysUntil }} day(s)</span>
                </article>
                <article *ngIf="!reportList('occasions').length"><strong>No upcoming occasion</strong><span>No birthday or anniversary in the next 30 days.</span></article>
              </div>
            </section>

            <section class="client-report-card">
              <div class="section-title compact"><h3>Service-wise clients</h3></div>
              <div class="mini-report-table">
                <div class="mini-report-row header"><span>Service</span><span>Clients</span><span>Revenue</span></div>
                <div class="mini-report-row" *ngFor="let row of reportList('byService').slice(0, 6)">
                  <span><strong>{{ row.serviceName }}</strong><small>{{ row.visitCount }} visit(s)</small></span>
                  <span>{{ row.clientCount }}</span>
                  <span>{{ row.revenue | currency: 'INR':'symbol':'1.0-0' }}</span>
                </div>
              </div>
            </section>
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
            <button class="danger-button mini" type="button" (click)="deleteSelected()" [disabled]="!selectedCount || saving()">Delete selected</button>
          </div>
        </div>

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
                [attr.aria-label]="'Open profile for ' + client.name"
                (click)="openClient(client.id)"
                (keydown.enter)="openClient(client.id)"
                (keydown.space)="openClient(client.id); $event.preventDefault()"
              >
                <td>
                  <a class="identity-cell" [routerLink]="['/clients', client.id]" (click)="$event.stopPropagation()">
                    <span class="avatar">{{ initials(client.name) }}</span>
                    <span>
                      <strong>{{ client.name }}</strong>
                      <small>{{ client.phone }} · {{ client.email || 'No email' }}</small>
                    </span>
                  </a>
                </td>
                <td>{{ client.gender || '-' }}</td>
                <td>{{ client.birthday ? (client.birthday | date: 'mediumDate') : '-' }}</td>
                <td>{{ client.anniversary ? (client.anniversary | date: 'mediumDate') : '-' }}</td>
                <td class="note-cell" [title]="client.notes || ''">{{ shortText(client.notes) }}</td>
                <td class="right" [class.due-amount]="client.unpaidBalance > 0">{{ client.unpaidBalance | currency: 'INR':'symbol':'1.0-0' }}</td>
                <td>
                  <span class="badge" *ngFor="let tag of client.tags">{{ tag }}</span>
                </td>
                <td>{{ client.totalSpend | currency: 'INR':'symbol':'1.0-0' }}</td>
                <td>{{ client.visitCount }}</td>
                <td>{{ client.walletBalance | currency: 'INR':'symbol':'1.0-0' }}</td>
                <td>{{ client.loyaltyPoints }} pts</td>
                <td>{{ client.lastVisitAt ? (client.lastVisitAt | date: 'mediumDate') : 'New' }}</td>
                <td class="actions-cell right">
                  <button class="ghost-button mini" type="button" (click)="editClient(client, $event)" [disabled]="saving()">Edit</button>
                  <label class="row-select" (click)="$event.stopPropagation()">
                    <input
                      type="checkbox"
                      [checked]="isClientSelected(client.id)"
                      (change)="toggleClientSelection(client.id, $event)"
                      [attr.aria-label]="'Select ' + client.name"
                    />
                  </label>
                  <button class="danger-button mini" type="button" (click)="deleteClient(client, $event)" [disabled]="saving()">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
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
      align-items: stretch;
      gap: 22px;
      padding: 24px;
      border: 1px solid color-mix(in srgb, var(--teal) 20%, var(--line));
      background:
        radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--teal) 22%, transparent), transparent 32%),
        radial-gradient(circle at 78% 18%, color-mix(in srgb, var(--amber) 22%, transparent), transparent 30%),
        linear-gradient(135deg, color-mix(in srgb, var(--surface) 98%, white), color-mix(in srgb, var(--surface-2) 88%, var(--teal)));
      box-shadow: 0 24px 70px color-mix(in srgb, var(--ink) 8%, transparent);
    }

    .hero-copy {
      display: grid;
      gap: 8px;
      max-width: 760px;
    }

    .hero-copy h2 {
      margin: 0;
      font-size: clamp(28px, 4vw, 46px);
      letter-spacing: -0.055em;
      line-height: 0.98;
    }

    .hero-copy p,
    .client-report-heading p {
      max-width: 760px;
      margin: 0;
      color: var(--muted);
      font-weight: 650;
      line-height: 1.5;
    }

    .hero-signal-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 6px;
    }

    .hero-signal-row span {
      border: 1px solid color-mix(in srgb, var(--teal) 22%, var(--line));
      border-radius: 999px;
      padding: 7px 10px;
      background: color-mix(in srgb, var(--surface) 84%, white);
      color: var(--ink);
      font-size: 12px;
      font-weight: 900;
    }

    .client-hero-actions {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-content: flex-start;
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
      align-items: flex-start;
      gap: 14px;
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

    .client-report-grid {
      grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
      gap: 12px;
    }

    .client-report-card {
      min-width: 0;
      display: grid;
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--surface) 96%, white);
      box-shadow: 0 16px 34px color-mix(in srgb, var(--ink) 5%, transparent);
    }

    .client-360-metric-board {
      overflow: hidden;
      padding: 18px;
      border-color: color-mix(in srgb, var(--teal) 34%, var(--line));
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--surface) 98%, white), color-mix(in srgb, var(--surface-2) 94%, var(--teal))),
        var(--surface);
    }

    .section-title.compact {
      align-items: center;
      margin-bottom: 0;
    }

    .section-title.compact h3 {
      margin: 0;
      font-size: 15px;
    }

    .metric-board-actions {
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
      padding-inline-end: 2px;
    }

    .metric-command-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
      align-items: start;
      min-width: 0;
      max-width: 100%;
    }

    .metric-command-main {
      display: grid;
      gap: 12px;
      min-width: 0;
    }

    .metric-category-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 4px;
      border: 1px solid color-mix(in srgb, var(--line) 70%, white);
      border-radius: 999px;
      background: color-mix(in srgb, var(--surface) 72%, transparent);
    }

    .metric-category-tabs button {
      border: 1px solid transparent;
      border-radius: 999px;
      padding: 8px 12px;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
    }

    .metric-category-tabs button.active {
      border-color: color-mix(in srgb, var(--teal) 70%, var(--line));
      background: color-mix(in srgb, var(--teal) 14%, var(--surface));
      color: var(--ink);
    }

    .client-360-card-grid {
      display: grid;
      width: 100%;
      max-width: none;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 8px;
      padding: 2px;
      min-width: 0;
    }

    .smart-client-card {
      width: 100%;
      min-width: 0;
      min-height: 104px;
      border: 1px solid color-mix(in srgb, var(--line) 82%, white);
      border-left-width: 4px;
      border-radius: 12px;
      text-align: left;
      cursor: pointer;
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--surface) 98%, white), color-mix(in srgb, var(--surface-2) 94%, white)),
        var(--surface);
      transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
    }

    .smart-client-card.active,
    .smart-client-card:hover {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--teal) 70%, var(--line));
      background: color-mix(in srgb, var(--surface) 92%, var(--teal));
      box-shadow: 0 14px 34px color-mix(in srgb, var(--teal) 14%, transparent);
    }

    .metric-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .smart-client-card b {
      color: var(--teal);
      font-size: 11px;
      letter-spacing: 0.08em;
    }

    .smart-client-card i {
      overflow: hidden;
      max-width: 92px;
      color: var(--muted);
      font-size: 10px;
      font-style: normal;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .smart-client-card small {
      color: var(--ink);
      font-size: 12px;
      font-weight: 900;
    }

    .smart-client-card em {
      color: var(--muted);
      font-size: 11px;
      font-style: normal;
      font-weight: 700;
    }

    .connected-card-inspector {
      display: grid;
      width: 100%;
      max-width: none;
      grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.2fr);
      gap: 12px;
      align-items: stretch;
      min-width: 0;
      padding: 14px;
      border: 1px solid color-mix(in srgb, var(--teal) 30%, var(--line));
      border-radius: 14px;
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--surface) 98%, white), color-mix(in srgb, var(--surface-2) 94%, white)),
        var(--surface);
      color: var(--ink);
      box-shadow: 0 14px 32px color-mix(in srgb, var(--ink) 6%, transparent);
    }

    .connected-card-inspector h3,
    .connected-card-inspector p {
      margin: 0;
    }

    .connected-card-inspector p {
      color: var(--muted);
      font-weight: 650;
    }

    .connected-card-inspector .eyebrow,
    .connected-card-inspector small {
      color: var(--muted);
    }

    .inspector-focus {
      display: grid;
      gap: 8px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--line);
    }

    .inspector-focus strong {
      font-size: 30px;
      letter-spacing: -0.045em;
      line-height: 1;
    }

    .connected-card-links {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-top: 8px;
    }

    .connected-card-links button {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      background: color-mix(in srgb, var(--surface) 96%, white);
      color: var(--ink);
      text-align: left;
      cursor: pointer;
    }

    .connected-card-links button:hover {
      background: color-mix(in srgb, var(--teal) 10%, var(--surface));
    }

    .connected-card-links strong,
    .connected-card-links span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .connected-card-links span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }

    .mini-report-table {
      display: grid;
      gap: 4px;
    }

    .mini-report-row {
      width: 100%;
      min-height: 44px;
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) 70px 100px;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border: 0;
      border-radius: 7px;
      color: var(--ink);
      background: transparent;
      text-align: left;
    }

    .mini-report-row.header {
      min-height: 30px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .mini-report-row.clickable:hover,
    .mini-report-row:not(.header):hover {
      background: var(--surface-2);
    }

    .mini-report-row strong,
    .mini-report-row small {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mini-report-row small {
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
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

    .client-database-panel .actions-cell > * {
      margin-left: 6px;
      vertical-align: middle;
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

    @media (max-width: 1240px) {
      .connected-card-inspector {
        grid-template-columns: 1fr;
      }

      .client-360-card-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .connected-card-links {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .page-stack {
        width: 100%;
        max-width: 100%;
        padding-inline-end: 0;
      }

      .client-report-metrics,
      .client-360-card-grid,
      .connected-card-inspector {
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
        min-width: 204px;
        padding-right: 12px;
      }

      .client-report-metrics,
      .client-report-grid,
      .client-360-card-grid,
      .connected-card-links {
        grid-template-columns: 1fr;
      }

      .metric-category-tabs {
        flex-wrap: nowrap;
        overflow-x: auto;
        border-radius: 18px;
        -webkit-overflow-scrolling: touch;
      }

      .metric-category-tabs button {
        flex: 0 0 auto;
      }

      .mini-report-row {
        grid-template-columns: minmax(0, 1fr) 56px 86px;
      }
    }
  `]
})
export class ClientsComponent implements OnInit {
  readonly clients = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly showForm = signal(false);
  readonly tagFilter = signal('');
  readonly selectedClientIds = signal<string[]>([]);
  readonly editingClientId = signal('');
  readonly clientReports = signal<ApiRecord | null>(null);
  readonly client360Report = signal<ApiRecord | null>(null);
  readonly selectedMetricCardId = signal('');
  readonly selectedMetricCategory = signal('All');
  readonly reportLoading = signal(true);
  readonly reportError = signal('');
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
  }

  get filteredClients(): ApiRecord[] {
    return this.clients().filter((client) => {
      const queryMatch = JSON.stringify(client).toLowerCase().includes(this.query.toLowerCase());
      const tagMatch = this.tagFilter() ? (client.tags || []).includes(this.tagFilter()) : true;
      return queryMatch && tagMatch;
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

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const branchId = this.api.selectedBranchId();
    forkJoin({
      clients: this.api.list<ApiRecord[]>('clients', { limit: 10000, compact: 1, branchId }),
      invoices: this.api.list<ApiRecord[]>('invoices', { limit: 1000, branchId }),
      walletTransactions: this.api.list<ApiRecord[]>('walletTransactions', { limit: 5000, branchId })
    }).subscribe({
      next: ({ clients, invoices, walletTransactions }) => {
        const linkedWalletClients = this.withWalletBalances(clients || [], walletTransactions || []);
        this.clients.set(this.withUnpaidBalances(linkedWalletClients, invoices || []));
        this.selectedClientIds.set(this.selectedClientIds().filter((id) => this.clients().some((client) => client.id === id)));
        this.openPendingEditClient();
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load clients');
        this.loading.set(false);
      }
    });
  }

  loadReports(): void {
    this.reportLoading.set(true);
    this.reportError.set('');
    const branchId = this.api.selectedBranchId();
    forkJoin({
      topRfm: this.api.report<ApiRecord[]>('clients/top-rfm', { limit: 10, branchId }),
      lapsed: this.api.report<ApiRecord[]>('clients/lapsed', { minDays: 60, maxDays: 180, limit: 10, branchId }),
      newVsReturning: this.api.report<ApiRecord[]>('clients/new-vs-returning', { months: 6, branchId }),
      occasions: this.api.report<ApiRecord[]>('clients/occasions', { withinDays: 30, limit: 10, branchId }),
      byService: this.api.report<ApiRecord[]>('clients/by-service', { limit: 8, branchId })
    }).subscribe({
      next: (reports) => {
        this.clientReports.set(reports);
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
    this.editingClientId.set(String(client.id || ''));
    this.form.patchValue({
      name: client.name || '',
      phone: client.phone || '',
      email: client.email || '',
      gender: client.gender || '',
      birthday: this.dateInputValue(client.birthday),
      anniversary: this.dateInputValue(client.anniversary),
      tag: Array.isArray(client.tags) && client.tags.length ? client.tags[0] : 'new',
      notes: client.notes || ''
    });
    this.showForm.set(true);
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

  titleText(value: unknown): string {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
