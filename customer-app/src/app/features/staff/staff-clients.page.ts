import { CurrencyPipe, DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { IonSpinner } from "@ionic/angular/standalone";
import { StaffAppService, StaffClientListItem } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [CurrencyPipe, DatePipe, FormsModule, RouterLink, IonSpinner],
  template: `
    <section class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Clients</p>
          <h1>Client book</h1>
          <p>Search branch clients connected to your staff workspace.</p>
        </div>
      </header>

      @if (!canReadClients()) { <section class="notice">You do not have permission to view client data.</section> }
      @if (loading()) { <section class="state"><ion-spinner name="crescent" /> Loading clients...</section> }
      @if (message()) { <section class="notice success">{{ message() }}</section> }
      @if (staff.error()) { <section class="notice">{{ staff.error() }}</section> }

      @if (canReadClients()) {
        <section class="panel">
          <div class="panel-title"><h2>Search clients</h2><span>{{ clients().length }}</span></div>
          <div class="form-grid compact-grid">
            <label>Find by name, phone or email<input [(ngModel)]="query" (keyup.enter)="search()" placeholder="Search clients" /></label>
          </div>
          <div class="row-actions permission-actions">
            <button class="button primary" type="button" (click)="search()">Search</button>
            <button class="button" type="button" (click)="clear()">Clear</button>
          </div>
        </section>
      }

      @if (canReadClients()) {
        <section class="panel">
          <div class="panel-title"><h2>Connected clients</h2><span>{{ clients().length }}</span></div>
          <div class="list">
            @for (client of clients(); track client.id) {
              <div class="row">
                <div class="row-main">
                  <strong>{{ client.name }}</strong>
                  <small>{{ client.phone || client.email || 'No contact on file' }}</small>
                  <small>{{ client.visitCount }} visits · {{ client.totalSpend | currency:'INR':'symbol':'1.0-0' }} spend · {{ client.lastVisitAt ? (client.lastVisitAt | date:'mediumDate') : 'no visit yet' }}</small>
                </div>
                <div class="row-actions">
                  @if (client.membershipStatus) { <span class="badge green">{{ client.membershipStatus }}</span> }
                  <a class="button primary" [routerLink]="['/staff/client-360', client.id]">Client 360</a>
                </div>
              </div>
            } @empty { <p class="empty">No clients found for this branch/search.</p> }
          </div>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffClientsPage implements OnInit {
  readonly clients = signal<StaffClientListItem[]>([]);
  readonly loading = signal(false);
  readonly message = signal("");
  query = "";

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadClients()) void this.load(); }

  async load() {
    if (!this.canReadClients()) {
      this.clients.set([]);
      return;
    }
    this.loading.set(true);
    try {
      this.clients.set(await this.staff.clients(this.query));
    } finally {
      this.loading.set(false);
    }
  }

  async search() {
    if (!this.canReadClients()) {
      this.message.set("Client search is blocked by permissions.");
      return;
    }
    this.message.set("");
    await this.load();
  }

  async clear() {
    if (!this.canReadClients()) return;
    this.query = "";
    this.message.set("Search filters cleared.");
    await this.load();
  }

  canReadClients(): boolean {
    return this.staff.hasPermission("read:staff");
  }
}
