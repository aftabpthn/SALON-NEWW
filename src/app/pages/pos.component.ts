import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, effect, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, distinctUntilChanged, forkJoin, of, Subscription } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { PosActiveBillingDraft, PosHeldInvoiceDraft, PosMembershipPlan, PosPaymentMode, PosSettingsService, PosTipPreset } from '../core/pos-settings.service';
import { AppStateService } from '../core/state/app-state.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type ItemDiscountType = 'amount' | 'percent';
type ItemDiscountSource = 'none' | 'manual' | 'membership';

type SaleItem = {
  type: 'service' | 'product' | 'membership' | 'package' | 'gift_card' | 'package_redeem' | 'custom';
  id: string;
  name: string;
  quantity: number;
  price: number;
  gstRate: number;
  staffId?: string;
  staffName?: string;
  staffSplits?: StaffSplitLine[];
  discountPercent?: number;
  discountType?: ItemDiscountType;
  discountValue?: number;
  discountSource?: ItemDiscountSource;
  validityDays?: number;
  serviceCredits?: ApiRecord[];
  planType?: string;
  planCredits?: number;
  creditsRemaining?: number;
  bonusAmount?: number;
  benefitRules?: ApiRecord;
  packageCredits?: ApiRecord[];
  giftCode?: string;
  expiryDate?: string;
};

type StaffSplitLine = {
  staffId: string;
  staffName: string;
  percent: number;
};

type BenefitServiceMapping = {
  lineIndex: number;
  serviceId: string;
  serviceName: string;
  staffId?: string;
  staffName?: string;
  credits: number;
};

type RedeemableServiceLine = {
  lineIndex: number;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  finalAmount: number;
};

type MembershipLineBenefitState = {
  status: 'credit' | 'unlimited' | 'discount' | 'eligible' | 'none';
  label: string;
  detail: string;
};

type TipLine = {
  id: string;
  staffId: string;
  staffName: string;
  paymentMode: string;
  amount: number;
  note: string;
};

type HighlightSegment = {
  text: string;
  match: boolean;
};

type ClientSearchIndex = {
  haystack: string;
  phone: string;
  name: string;
  email: string;
  codes: string;
  membershipIds: string[];
  membershipBadge: string;
  membershipMeta: string;
  duplicate: boolean;
};

type PackageRedeemRow = {
  id: string;
  membershipId: string;
  packageName: string;
  serviceId: string;
  serviceName: string;
  pendingQty: number;
  totalQty: number;
  expiry: string;
  status: 'active' | 'expired';
};

type PackageClientNotice = {
  status: 'active' | 'expired';
  title: string;
  summary: string;
  credits: string;
  expiry: string;
};

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack inner-page-shell">
      <div class="module-hero pos-command-hero inner-page-header">
        <div class="pos-command-copy">
          <span class="pos-eyebrow">POS billing</span>
          <h1>Counter checkout</h1>
          <p>Search client, add services and products, collect payment, and save invoice.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/pos/invoices">Invoices</a>
          <a class="ghost-button" routerLink="/pos/holds">Held invoices</a>
          <a class="ghost-button" routerLink="/pos/tips">Tip register</a>
          <button class="ghost-button" type="button" (click)="printInvoice()" [disabled]="!invoice()">Print invoice</button>
        </div>
      </div>

      <section class="client-crm-strip" *ngIf="selectedClient() as client">
        <article class="client-crm-tile identity">
          <span>Name</span>
          <strong>{{ client.name || 'Client' }}</strong>
          <small>{{ client.phone || client.email || client.id }}</small>
          <div class="client-crm-actions" *ngIf="client.id">
            <a
              class="ghost-button mini client-crm-edit-button"
              [routerLink]="['/clients']"
              [queryParams]="{ edit: client.id }"
            >
              Edit
            </a>
            <a
              class="ghost-button mini client-crm-history-button"
              [routerLink]="['/clients', client.id]"
            >
              Client History
            </a>
          </div>
        </article>
        <article class="client-crm-tile">
          <span>E-wallet Amt</span>
          <strong>{{ Number(client.walletBalance || 0) | auraMoney:'1.0-0' }}</strong>
        </article>
        <article class="client-crm-tile">
          <span>Unpaid Amt</span>
          <strong [class.due-amount]="Number(client.unpaidBalance || 0) > 0">
            {{ Number(client.unpaidBalance || 0) | auraMoney:'1.0-0' }}
          </strong>
        </article>
        <ng-container *ngIf="selectedClientMembership() as membership; else noClientMembershipSnapshot">
          <article class="client-crm-tile">
            <span>Membership assign date</span>
            <strong>{{ membershipTakenDate(membership) }}</strong>
            <small>{{ membership.planName || 'Active membership' }}</small>
          </article>
          <article class="client-crm-tile">
            <span>Membership expire date</span>
            <strong>{{ membershipExpiryDate(membership) }}</strong>
            <small>{{ selectedClientMembershipStatus() }}</small>
          </article>
        </ng-container>
        <ng-template #noClientMembershipSnapshot>
          <article class="client-crm-tile muted-tile">
            <span>Membership assign date</span>
            <strong>-</strong>
            <small>No active membership</small>
          </article>
          <article class="client-crm-tile muted-tile">
            <span>Membership expire date</span>
            <strong>-</strong>
            <small>No active membership</small>
          </article>
        </ng-template>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state warning" *ngIf="dataHint()">{{ dataHint() }}</div>

      <div class="pos-layout" *ngIf="!loading()">
        <section class="panel">
          <form [formGroup]="form" class="pos-form">
            <div class="client-search-row pos-client-search-row">
            <label class="field smart-search-field pos-floating-search client-search-field" style="min-width: 0;">
              <span>Client</span>
              <input
                #clientSearchInput
                type="search"
                [ngModel]="clientSearchText"
                (ngModelChange)="setClientSearch($event)"
                (focus)="clientSearchActive = true"
                (blur)="closeClientSearchSoon()"
                (keydown)="handleClientSearchKeydown($event)"
                [ngModelOptions]="{ standalone: true }"
                placeholder="Search name, mobile, email, code, membership"
              />
              <small *ngIf="clientSearchPending()">Searching...</small>
            </label>
            <div class="smart-search-results pos-search-results client-search-results" *ngIf="showClientResults()">
              <div class="client-search-caption">
                <span>{{ debouncedClientQuery() ? 'Matching contacts' : 'Recent contacts' }}</span>
                <small>{{ clientSearchResults().length }} shown</small>
              </div>
              <button
                class="client-result-card"
                [class.active]="clientResultActive(client)"
                type="button"
                *ngFor="let client of clientSearchResults()"
                (pointerdown)="selectClientFromResult($event, client)"
                (click)="selectClient(client)"
              >
                <span class="client-avatar">{{ clientInitial(client) }}</span>
                <span class="client-result-main">
                  <strong>
                    <ng-container *ngFor="let segment of highlightSegments(client.name || 'Client')">
                      <mark *ngIf="segment.match; else clientNamePlain">{{ segment.text }}</mark>
                      <ng-template #clientNamePlain>{{ segment.text }}</ng-template>
                    </ng-container>
                  </strong>
                  <span>
                    <ng-container *ngFor="let segment of highlightSegments(clientPrimaryPhone(client))">
                      <mark *ngIf="segment.match; else clientPhonePlain">{{ segment.text }}</mark>
                      <ng-template #clientPhonePlain>{{ segment.text }}</ng-template>
                    </ng-container>
                  </span>
                  <small>{{ clientResultMeta(client) }}</small>
                  <span class="client-badges">
                    <span class="client-badge good" *ngIf="clientMembershipBadge(client)">{{ clientMembershipBadge(client) }}</span>
                    <span class="client-badge wallet" *ngIf="Number(client.walletBalance || 0) > 0">Wallet {{ Number(client.walletBalance || 0) | auraMoney:'1.0-0' }}</span>
                    <span class="client-badge due" *ngIf="Number(client.unpaidBalance || 0) > 0">Due {{ Number(client.unpaidBalance || 0) | auraMoney:'1.0-0' }}</span>
                    <span class="client-badge warning" *ngIf="possibleDuplicateClient(client)">Duplicate?</span>
                  </span>
                </span>
                <a
                  class="client-call-button whatsapp"
                  *ngIf="clientWhatsAppHref(client)"
                  [href]="clientWhatsAppHref(client)"
                  target="_blank"
                  rel="noopener"
                  aria-label="WhatsApp client"
                  (mousedown)="$event.preventDefault(); $event.stopPropagation()"
                  (click)="$event.stopPropagation()"
                >
                  WA
                </a>
                <a
                  class="client-call-button"
                  *ngIf="clientCallHref(client)"
                  [href]="clientCallHref(client)"
                  aria-label="Call client"
                  (mousedown)="$event.preventDefault(); $event.stopPropagation()"
                  (click)="$event.stopPropagation()"
                >
                  Call
                </a>
              </button>
              <div class="client-empty-state" *ngIf="clientSearchActive && debouncedClientQuery() && !clientSearchResults().length">
                No contacts found
              </div>
            </div>
            <button class="ghost-button fit pos-add-client-button" type="button" *ngIf="canCreateClientFromSearch()" (click)="openClientFormFromSearch()">Add client</button>
            <div class="client-search-actions">
              <button class="dark-button fit" type="button" (click)="useWalkinClient()">Walkin Client</button>
              <button class="ghost-button fit" type="button" (click)="holdInvoice()">Hold invoice</button>
            </div>
            </div>
            <div class="branch-context-card">
              <span>Header branch</span>
              <strong>{{ currentBranchName() }}</strong>
            </div>
            <section
              class="package-billing-alert"
              [class.package-billing-alert--expired]="packageNotice.status === 'expired'"
              *ngIf="selectedClientPackageNotice() as packageNotice"
            >
              <div>
                <span>{{ packageNotice.status === 'active' ? 'Active package' : 'Expired package' }}</span>
                <strong>{{ packageNotice.title }}</strong>
                <small>{{ packageNotice.summary }}</small>
              </div>
              <div class="package-billing-alert__meta">
                <span>Credits {{ packageNotice.credits }}</span>
                <span>Expiry {{ packageNotice.expiry }}</span>
              </div>
            </section>
            <section class="package-redeem-panel" *ngIf="selectedClientPackageRows().length">
              <div class="package-redeem-header">
                <strong>Package redemption</strong>
                <small>{{ selectedClientPackageRows().length }} package service row(s)</small>
              </div>
              <div class="package-redeem-grid package-redeem-grid--head">
                <span>Package</span>
                <span>Service</span>
                <span>Pending Qty</span>
                <span>Redeem Qty</span>
                <span>Staff</span>
                <span>Action</span>
              </div>
              <div
                class="package-redeem-grid"
                [class.package-redeem-grid--expired]="row.status === 'expired'"
                *ngFor="let row of selectedClientPackageRows(); trackBy: trackPackageRedeemRow"
              >
                <strong>{{ row.packageName }}</strong>
                <span>{{ row.serviceName }}</span>
                <span>{{ row.pendingQty }}</span>
                <input
                  type="number"
                  min="0"
                  [max]="row.pendingQty"
                  [ngModel]="packageRedeemQty(row)"
                  (ngModelChange)="setPackageRedeemQty(row, $event)"
                  [ngModelOptions]="{ standalone: true }"
                  [disabled]="row.status === 'expired'"
                />
                <select
                  [ngModel]="packageRedeemStaff(row)"
                  (ngModelChange)="setPackageRedeemStaff(row, $event)"
                  [ngModelOptions]="{ standalone: true }"
                  [disabled]="row.status === 'expired'"
                >
                  <option value="">Use invoice staff</option>
                  <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
                </select>
                <button
                  class="ghost-button mini"
                  type="button"
                  (click)="redeemPackageRow(row)"
                  [disabled]="row.status === 'expired' || packageRedeemQty(row) <= 0"
                >
                  Redeem
                </button>
                <small class="package-redeem-expiry">Expiry {{ row.expiry }}</small>
              </div>
            </section>
            <label class="field billing-date-field">
              <span>Invoice date</span>
              <input type="date" formControlName="invoiceDate" [attr.max]="invoiceDateMax" />
            </label>
            <label class="field smart-search-field pos-floating-search staff-search-field">
              <span>Staff</span>
              <div class="staff-search-input-wrap">
                <input
                  #staffSearchInput
                  type="search"
                  [ngModel]="staffSearchText"
                  (ngModelChange)="setStaffSearch($event)"
                  (focus)="staffSearchActive = true"
                  (blur)="closeStaffSearchSoon()"
                  (keydown)="handleStaffSearchKeydown($event)"
                  [ngModelOptions]="{ standalone: true }"
                  placeholder="Search staff name, phone, role, ID 1/2"
                />
                <button
                  class="staff-clear-button"
                  *ngIf="staffSearchText"
                  type="button"
                  aria-label="Clear staff"
                  (mousedown)="$event.preventDefault()"
                  (click)="clearStaffSelection()"
                >
                  x
                </button>
              </div>
              <div class="smart-search-results pos-search-results staff-search-results" *ngIf="showStaffResults()">
                <button
                  type="button"
                  *ngFor="let person of filteredStaff()"
                  (mousedown)="$event.preventDefault()"
                  (click)="selectStaff(person)"
                >
                  <strong>{{ person.name || person.fullName || 'Staff' }}</strong>
                  <span>{{ staffResultMeta(person) }}</span>
                </button>
              </div>
              <small *ngIf="staffSearchText && staffSearchActive && !filteredStaff().length">No matching active staff found.</small>
            </label>
            <label class="field">
              <span>Completed appointment</span>
              <select formControlName="appointmentId">
                <option value="">Walk-in / no appointment</option>
                <option *ngFor="let appointment of billableAppointments()" [value]="appointment.id">
                  {{ clientName(appointment.clientId) }} Â· {{ appointment.startAt | auraDate:'date' }}
                </option>
              </select>
            </label>
          </form>

          <section class="form-panel pos-client-form" *ngIf="showClientForm()">
            <div class="section-title compact-title">
              <div>
                <h2>New client details</h2>
              </div>
              <button class="ghost-button mini" type="button" (click)="closeClientForm()">Close form</button>
            </div>
            <form [formGroup]="clientForm" (ngSubmit)="saveClientFromPos()">
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
                  <option>pos-created</option>
                </select>
              </label>
              <label class="field full">
                <span>Notes</span>
                <textarea formControlName="notes"></textarea>
              </label>
              <div class="form-actions">
                <button class="ghost-button" type="button" (click)="closeClientForm()">Cancel</button>
                <button class="primary-button" type="submit" [disabled]="clientForm.invalid || clientSaving()">Save client</button>
              </div>
            </form>
          </section>

          <div class="catalog-picker">
            <label class="field smart-search-field">
              <span>Add service</span>
              <input
                #serviceSearchInput
                type="search"
                [ngModel]="serviceSearchText"
                (ngModelChange)="setServiceSearch($event)"
                (focus)="serviceSearchActive = true"
                (blur)="closeServiceSearchSoon()"
                (keydown)="handleServiceSearchKeydown($event)"
                [ngModelOptions]="{ standalone: true }"
                placeholder="Type service name, e.g. cut"
              />
              <div class="smart-search-results service-search-results" *ngIf="showServiceResults()">
                <button
                  class="service-result-option"
                  type="button"
                  *ngFor="let service of filteredServices()"
                  [class.selected]="isServiceSelected(service.id)"
                  (mousedown)="$event.preventDefault()"
                  (click)="toggleServiceSelection(service)"
                >
                  <span class="multi-select-box" [class.checked]="isServiceSelected(service.id)" aria-hidden="true"></span>
                  <span class="result-copy">
                    <strong>{{ service.name || 'Service' }}</strong>
                    <span>{{ service.category || 'Service' }} Â· â‚¹{{ service.price || 0 }}</span>
                  </span>
                  <span class="select-pill">{{ isServiceSelected(service.id) ? 'Selected' : 'Select' }}</span>
                </button>
                <div class="service-result-actions">
                  <button type="button" (mousedown)="$event.preventDefault()" (click)="selectVisibleServices()">Select visible</button>
                  <button type="button" *ngIf="selectedServiceIds.length" (mousedown)="$event.preventDefault()" (click)="clearServiceSelection()">Clear</button>
                </div>
              </div>
              <small class="smart-search-hint selected" *ngIf="selectedServiceIds.length">
                {{ selectedServiceIds.length }} service selected. Add will include all of them.
              </small>
              <small class="smart-search-hint" *ngIf="serviceSearchActive && serviceSearchText.trim().length > 0 && filteredServices().length > 1">
                Multiple services matched. Select the required services.
              </small>
              <small class="smart-search-hint is-empty" *ngIf="serviceSearchActive && serviceSearchText.trim().length > 0 && !filteredServices().length">
                No service found with this name.
              </small>
            </label>
            <button class="ghost-button" type="button" (click)="addSelectedService()" [disabled]="!selectedServiceIds.length">
              {{ selectedServiceIds.length ? 'Add ' + selectedServiceIds.length : 'Add' }}
            </button>
            <label class="field smart-search-field">
              <span>Add product</span>
              <input
                #productSearchInput
                type="search"
                [ngModel]="productSearchText"
                (ngModelChange)="setProductSearch($event)"
                (focus)="productSearchActive = true"
                (blur)="closeProductSearchSoon()"
                (keydown)="handleProductSearchKeydown($event)"
                [ngModelOptions]="{ standalone: true }"
                placeholder="Type product name, SKU, barcode"
              />
              <div class="smart-search-results service-search-results" *ngIf="showProductResults()">
                <button
                  class="service-result-option"
                  type="button"
                  *ngFor="let product of filteredProducts()"
                  [class.selected]="isProductSelected(product.id)"
                  (mousedown)="$event.preventDefault()"
                  (click)="toggleProductSelection(product)"
                >
                  <span class="multi-select-box" [class.checked]="isProductSelected(product.id)" aria-hidden="true"></span>
                  <span class="result-copy">
                    <strong>{{ product.name || 'Product' }}</strong>
                    <span>{{ product.category || product.sku || 'Product' }} Â· â‚¹{{ product.price || 0 }} Â· {{ product.stock || 0 }} left</span>
                  </span>
                  <span class="select-pill">{{ isProductSelected(product.id) ? 'Selected' : 'Select' }}</span>
                </button>
                <div class="service-result-actions">
                  <button type="button" (mousedown)="$event.preventDefault()" (click)="selectVisibleProducts()">Select visible</button>
                  <button type="button" *ngIf="selectedProductIds.length" (mousedown)="$event.preventDefault()" (click)="clearProductSelection()">Clear</button>
                </div>
              </div>
              <small class="smart-search-hint selected" *ngIf="selectedProductIds.length">
                {{ selectedProductIds.length }} product selected. Add will include all of them.
              </small>
              <small class="smart-search-hint" *ngIf="productSearchActive && productSearchText.trim().length > 0 && filteredProducts().length > 1">
                Multiple products matched. Select the required products.
              </small>
              <small class="smart-search-hint is-empty" *ngIf="productSearchActive && productSearchText.trim().length > 0 && !filteredProducts().length">
                No product found with this name.
              </small>
            </label>
            <button class="ghost-button" type="button" (click)="addSelectedProduct()" [disabled]="!selectedProductIds.length">
              {{ selectedProductIds.length ? 'Add ' + selectedProductIds.length : 'Add' }}
            </button>
          </div>

          <div class="benefit-lines">
            <label class="field">
              <span>Membership sale</span>
              <select
                #membershipPlanSelect
                (change)="addMembershipPlanFromSelect(membershipPlanSelect)"
                (keydown)="handleMembershipPlanKeydown($event, membershipPlanSelect)"
              >
                <option value="">Choose membership</option>
                <option *ngFor="let plan of activeMembershipPlans()" [value]="plan.id">{{ membershipPlanLabel(plan) }}</option>
              </select>
            </label>
            <button class="ghost-button" type="button" (click)="addMembershipPlanFromSelect(membershipPlanSelect)">Add</button>

            <label class="field">
              <span>Package sale</span>
              <select
                #packageSelect
                (change)="addPackageFromSelect(packageSelect)"
                (keydown)="handlePackageKeydown($event, packageSelect)"
              >
                <option value="">Choose package</option>
                <option *ngFor="let itemPackage of packages()" [value]="itemPackage.id">{{ itemPackage.name }} - â‚¹{{ itemPackage.price }}</option>
              </select>
            </label>
            <button class="ghost-button" type="button" (click)="addPackageFromSelect(packageSelect)">Add</button>

            <label class="field">
              <span>Gift card sale</span>
              <input #giftCardAmount type="number" min="0" placeholder="Gift card amount" (keydown)="handleGiftCardAmountKeydown($event, giftCardAmount)" />
            </label>
            <button class="ghost-button" type="button" (click)="addGiftCardFromInput(giftCardAmount)">Add</button>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Staff</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Discount</th>
                  <th>GST</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let item of items(); let index = index">
                  <td>
                    <span style="display: block; margin-bottom: 6px; color: #64748b; font-size: 12px; font-weight: 800; text-transform: uppercase;">{{ itemCategoryTitle(item) }}</span>
                    <span>{{ item.name }}</span>
                    <small
                      *ngIf="membershipLineBenefitState(item, index).status !== 'none'"
                      class="membership-line-badge"
                      [ngClass]="'membership-line-badge--' + membershipLineBenefitState(item, index).status"
                    >
                      {{ membershipLineBenefitState(item, index).label }}
                      <span *ngIf="membershipLineBenefitState(item, index).detail">Â· {{ membershipLineBenefitState(item, index).detail }}</span>
                    </small>
                  </td>
                  <td>
                    <div class="line-staff-box" [class.has-splits]="item.staffSplits?.length">
                      <div class="staff-primary-row">
                        <select class="line-staff-select" [ngModel]="item.staffId || ''" (ngModelChange)="setItemStaff(item, $event)" [ngModelOptions]="{ standalone: true }">
                          <option value="">Unassigned</option>
                          <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
                        </select>
                        <button class="ghost-button mini split-action" type="button" (click)="addStaffSplit(item)">
                          {{ item.staffSplits?.length ? '+ Staff' : 'Split' }}
                        </button>
                      </div>
                      <div class="split-lines" *ngIf="item.staffSplits?.length">
                        <div class="split-line" *ngFor="let split of item.staffSplits; let splitIndex = index">
                          <span class="split-number">{{ splitIndex + 1 }}</span>
                          <select class="split-staff-select" [ngModel]="split.staffId" (ngModelChange)="setItemSplitStaff(item, splitIndex, $event)" [ngModelOptions]="{ standalone: true }">
                            <option value="">Staff</option>
                            <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
                          </select>
                          <div class="split-percent-field">
                            <input type="number" min="0" max="100" [ngModel]="split.percent" (ngModelChange)="setItemSplitPercent(item, splitIndex, $event)" [ngModelOptions]="{ standalone: true }" />
                            <span>%</span>
                          </div>
                          <button class="icon-button split-remove" type="button" title="Remove split" (click)="removeStaffSplit(item, splitIndex)">x</button>
                        </div>
                        <small class="split-total" [class.warning-text]="splitPercentTotal(item) !== 100">
                          Split total {{ splitPercentTotal(item) }}%
                        </small>
                      </div>
                    </div>
                  </td>
                  <td><input class="small-input" type="number" min="1" [(ngModel)]="item.quantity" (ngModelChange)="touchItems()" /></td>
                  <td><input class="small-input" type="number" min="0" [(ngModel)]="item.price" (ngModelChange)="touchItems()" /></td>
                  <td>
                    <div class="line-discount-cell">
                      <div class="line-discount-control">
                        <select
                          [ngModel]="item.discountType || 'amount'"
                          (ngModelChange)="setItemDiscountType(item, $event)"
                          [ngModelOptions]="{ standalone: true }"
                        >
                          <option value="amount">â‚¹</option>
                          <option value="percent">%</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          [ngModel]="item.discountValue || 0"
                          (ngModelChange)="setItemDiscountValue(item, $event)"
                          [ngModelOptions]="{ standalone: true }"
                        />
                      </div>
                      <small *ngIf="lineDiscountAmount(item) > 0">
                        {{ lineDiscountSourceLabel(item) }} {{ lineDiscountAmount(item) | auraMoney:'1.0-0' }}
                      </small>
                    </div>
                  </td>
                  <td>{{ item.gstRate }}%</td>
                  <td class="line-total-cell">
                    <strong>{{ lineTotal(item) | auraMoney:'1.0-0' }}</strong>
                    <small *ngIf="lineDiscountAmount(item) > 0">
                      Gross {{ lineGross(item) | auraMoney:'1.0-0' }}
                    </small>
                  </td>
                  <td><button class="ghost-button mini" type="button" (click)="removeItem(index)">Remove</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <aside class="panel checkout-panel">
          <div class="section-title checkout-title">
            <div>
              <span class="pos-eyebrow">Settlement</span>
              <h2>Cart and payment</h2>
            </div>
          </div>
          <div class="summary-control-grid summary-control-grid--discount">
            <label class="field">
              <span>Discount</span>
              <input type="number" min="0" [(ngModel)]="discount" />
            </label>
            <label class="field">
              <span>Type</span>
              <select [(ngModel)]="discountMode">
                <option value="amount">â‚¹</option>
                <option value="percent">%</option>
              </select>
            </label>
            <label class="field">
              <span>Coupon code</span>
              <input type="text" [(ngModel)]="couponCode" (ngModelChange)="clearCoupon()" placeholder="GLOW10" />
            </label>
            <button class="ghost-button summary-apply-button" type="button" (click)="validateCoupon()" [disabled]="couponChecking() || !couponCode || !items().length || !form.value.branchId">
              {{ couponChecking() ? 'Checking...' : 'Apply' }}
            </button>
          </div>
          <p class="inline-hint" *ngIf="couponMessage()">{{ couponMessage() }}</p>
          <div class="summary-control-grid summary-control-grid--membership">
            <label class="field">
              <span>Benefit credits to redeem</span>
              <input type="number" min="0" [ngModel]="creditsUsed" (ngModelChange)="setRedeemableCredits($event)" />
            </label>
            <label class="field">
              <span>Membership / package</span>
              <select [ngModel]="membershipId" (ngModelChange)="selectRedeemableBenefit($event)">
                <option value="">No redemption</option>
                <option *ngFor="let benefit of redeemableBenefits()" [value]="benefit.membershipId || benefit.id">{{ redeemableBenefitOption(benefit) }}</option>
              </select>
            </label>
            <button class="ghost-button summary-apply-button" type="button" (click)="useAllRedeemableCredits()" [disabled]="!selectedRedeemableBenefit() || !membershipCreditRedeemCap()">
              Use all
            </button>
          </div>
          <p class="inline-hint" *ngIf="selectedRedeemableBenefit() as benefit">
            Redeeming {{ redeemableBenefitTypeLabel(benefit) }} {{ benefit.planName || benefit.name || benefit.membershipId }}.
            {{ selectedRedeemableBenefitRemainingCredits() }} credits available Â· {{ membershipCreditRedeemCap(benefit) }} eligible for this bill.
          </p>
          <div class="membership-redemption-panel" *ngIf="selectedClient()">
            <strong>{{ membershipRedemptionPanelTitle() }}</strong>
            <span>{{ membershipRedemptionPanelSummary() }}</span>
            <span *ngIf="membershipRedemptionConflictReason()" class="warning-text">{{ membershipRedemptionConflictReason() }}</span>
          </div>
          <div class="inline-hint" *ngIf="membershipEligibilityNotes().length">
            <span *ngFor="let note of membershipEligibilityNotes()">{{ note }}</span>
          </div>
          <section class="benefit-mapping-box" *ngIf="selectedRedeemableBenefit() as benefit">
            <div class="benefit-mapping-box__header">
              <div>
                <strong>Choose service lines before save</strong>
              </div>
              <button class="ghost-button mini" type="button" (click)="autoAllocateBenefitCredits()" [disabled]="!creditsUsed || !redeemableServiceLines().length">
                Auto map
              </button>
            </div>
            <div class="benefit-mapping-box__summary">
              <span>Allocated {{ allocatedBenefitCredits() }} / {{ creditsUsed }} credits</span>
              <span>Balance after redeem {{ benefitRemainingAfterRedeem() }} credits</span>
            </div>
            <p class="inline-hint" *ngIf="!redeemableServiceLines().length">
              Add at least one service line to redeem benefit credits.
            </p>
            <div class="benefit-mapping-lines" *ngIf="redeemableServiceLines().length">
              <article class="benefit-mapping-line" *ngFor="let line of redeemableServiceLines()">
                <div>
                  <strong>{{ line.serviceName }}</strong>
                  <small>{{ line.staffName || 'Unassigned staff' }} Â· {{ line.finalAmount | auraMoney:'1.0-0' }}</small>
                </div>
                <label class="field compact-field">
                  <span>Credits</span>
                  <input
                    type="number"
                    min="0"
                    [max]="maxServiceLineMappedCredits(line.lineIndex)"
                    [ngModel]="serviceLineMappedCredits(line.lineIndex)"
                    (ngModelChange)="setServiceLineMappedCredits(line.lineIndex, $event)"
                    [ngModelOptions]="{ standalone: true }"
                  />
                </label>
              </article>
            </div>
            <p class="inline-hint warning-text" *ngIf="creditsUsed > 0 && unallocatedBenefitCredits() > 0">
              {{ unallocatedBenefitCredits() }} credits are not mapped to service lines.
            </p>
            <div class="benefit-mapping-summary-list" *ngIf="selectedBenefitServiceMappings().length">
              <div *ngFor="let mapping of selectedBenefitServiceMappings()">
                <span>{{ benefit.planName || benefit.name || benefit.membershipId }} -> {{ mapping.serviceName }}</span>
                <strong>{{ mapping.credits }} credits</strong>
              </div>
            </div>
          </section>
          <p class="inline-hint" *ngIf="selectedClient() && !redeemableBenefits().length">
            This client has no redeemable membership or package credits.
          </p>

          <section class="tip-box">
            <div class="section-title compact-title tip-box-title">
              <a class="ghost-button mini" routerLink="/pos/tips">Tip register</a>
            </div>
            <div class="tip-draft-grid">
              <label class="field">
                <span>Staff</span>
                <select [(ngModel)]="tipDraft.staffId">
                  <option value="">Use invoice staff</option>
                  <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
                </select>
              </label>
              <label class="field">
                <span>Amount</span>
                <input type="number" min="0" [(ngModel)]="tipDraft.amount" />
              </label>
              <button class="ghost-button tip-add-button" type="button" (click)="addTip()">Add tip</button>
            </div>
            <p class="inline-hint" *ngIf="tipMessage()">{{ tipMessage() }}</p>
            <div class="tip-lines" *ngIf="tips().length">
              <article *ngFor="let tip of tips(); let index = index">
                <div>
                  <strong>{{ tip.staffName }}</strong>
                  <span>Invoice tip</span>
                </div>
                <strong>{{ tip.amount | auraMoney:'1.0-0' }}</strong>
                <button class="ghost-button mini" type="button" (click)="removeTip(index)">Remove</button>
              </article>
            </div>
          </section>

          <div class="summary-lines">
            <div><span>Subtotal</span><strong>{{ subtotal | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Manual discount</span><strong>{{ manualDiscountAmount | auraMoney:'1.0-0' }}</strong></div>
            <div *ngIf="membershipAutoDiscount > 0"><span>{{ membershipAutoDiscountLabel }}</span><strong>{{ membershipAutoDiscount | auraMoney:'1.0-0' }}</strong></div>
            <div *ngIf="membershipCreditAdjustmentAmount() > 0"><span>Membership credit redeem</span><strong>{{ membershipCreditAdjustmentAmount() | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Coupon discount</span><strong>{{ couponDiscount | auraMoney:'1.0-0' }}</strong></div>
            <div><span>GST</span><strong>{{ gst | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Staff tips</span><strong>{{ tipTotal | auraMoney:'1.0-0' }}</strong></div>
            <div *ngIf="appliedBookingAdvanceAmount() > 0"><span>Booking advance applied</span><strong>{{ appliedBookingAdvanceAmount() | auraMoney:'1.0-0' }}</strong></div>
            <div class="total"><span>Total</span><strong>{{ total | auraMoney:'1.0-0' }}</strong></div>
            <div><span>Paid now</span><strong>{{ paidTotal | auraMoney:'1.0-0' }}</strong></div>
            <div [class.total]="balanceDue > 0"><span>Balance due</span><strong>{{ balanceDue | auraMoney:'1.0-0' }}</strong></div>
          </div>

          <section class="unpaid-receive-box" *ngIf="bookingAdvanceInfo() as advance">
            <div class="unpaid-receive-copy">
              <strong>{{ bookingAdvancePaidAmount() | auraMoney:'1.0-0' }}</strong>
              <small *ngIf="hasBookingAdvanceSuggestion">Advance is available. Apply it to include it in this invoice.</small>
              <small *ngIf="appliedBookingAdvanceAmount() > 0">Advance is included. Collect remaining {{ bookingAdvanceRemainingSuggestion | auraMoney:'1.0-0' }}.</small>
              <small *ngIf="advance['status'] === 'pending'">Advance link is created; payment is still pending.</small>
            </div>
            <div class="client-search-actions">
              <button class="ghost-button" type="button" *ngIf="hasBookingAdvanceSuggestion" (click)="applyBookingAdvanceSuggestion()">
                Apply booking advance
              </button>
              <button class="ghost-button" type="button" *ngIf="appliedBookingAdvanceAmount() > 0" (click)="removeBookingAdvanceSuggestion()">
                Remove advance
              </button>
            </div>
          </section>

          <div class="payment-header">
            <div class="payment-title-copy">
              <h2>Payment collection</h2>
            </div>
            <div class="payment-actions">
              <button
                class="ghost-button mini wallet-action-button"
                type="button"
                [class.ready]="walletButtonReady"
                [disabled]="!walletButtonReady"
                (click)="handleWalletButton()"
              >
                {{ walletButtonLabel }}
              </button>
              <a class="ghost-button mini" routerLink="/pos/payment-modes">Manage modes</a>
            </div>
          </div>
          <div class="payment-grid">
            <label
              class="field payment-mode-card"
              *ngFor="let mode of activePaymentModes()"
              [class.filled]="paymentAmount(mode.id) > 0"
              (click)="fillPaymentDue(mode.id)"
            >
              <span>{{ mode.label }} <small>{{ paymentHint(mode.id) }}</small></span>
              <input
                type="number"
                min="0"
                [ngModel]="paymentAmount(mode.id)"
                (ngModelChange)="setPaymentAmount(mode.id, $event)"
                (focus)="fillPaymentDue(mode.id)"
              />
            </label>
          </div>
          <section class="unpaid-receive-box round-off-box" *ngIf="roundOffDueAmount > 0">
            <div class="unpaid-receive-copy">
              <strong>{{ roundOffDueAmount | auraMoney:'1.0-0' }}</strong>
              <small *ngIf="roundOffPreviewLabel()">{{ roundOffPreviewLabel() }}</small>
            </div>
            <div class="client-search-actions round-off-actions">
              <button class="ghost-button" type="button" (click)="keepRoundOffAsUnpaid()">
                Keep unpaid
              </button>
              <button class="primary-button" type="button" (click)="applyBalanceRoundOff()" [disabled]="!canApplyRoundOff()">
                Round off {{ roundOffDueAmount | auraMoney:'1.0-0' }}
              </button>
            </div>
          </section>
          <section class="unpaid-receive-box" *ngIf="selectedClientUnpaidBalance > 0">
            <div class="unpaid-receive-copy">
              <strong>{{ selectedClientUnpaidBalance | auraMoney:'1.0-0' }}</strong>
            </div>
            <label class="field">
              <span>Amount</span>
              <input
                type="number"
                min="0"
                [max]="selectedClientUnpaidBalance"
                name="unpaidReceiveAmount"
                [ngModel]="unpaidReceiveAmount"
                (ngModelChange)="setUnpaidReceiveAmount($event)"
                [ngModelOptions]="{ standalone: true }"
              />
            </label>
            <label class="field">
              <span>Mode</span>
              <select
                name="unpaidReceiveMode"
                [(ngModel)]="unpaidReceiveMode"
                [ngModelOptions]="{ standalone: true }"
              >
                <option *ngFor="let mode of activePaymentModes()" [value]="mode.id">{{ mode.label }}</option>
              </select>
            </label>
            <button class="ghost-button" type="button" (click)="fillUnpaidReceiveAmount()">Fill due</button>
            <button class="primary-button" type="button" (click)="receiveUnpaid()" [disabled]="!canReceiveUnpaid">
              Receive unpaid
            </button>
          </section>
          <p class="inline-hint" *ngIf="unpaidReceiveMessage()">{{ unpaidReceiveMessage() }}</p>
          <p class="inline-hint" *ngIf="overPaid > 0 && !walletCreditRequested()">Extra {{ overPaid | auraMoney:'1.0-0' }} received. Click Wallet to add extra amount to client wallet.</p>
          <p class="inline-hint wallet-status" *ngIf="walletCreditRequested() && overPaid > 0">After invoice save, {{ overPaid | auraMoney:'1.0-0' }} will be credited to this client's wallet.</p>
          <p class="inline-hint" *ngIf="selectedClient() as client">Wallet balance: {{ Number(client.walletBalance || 0) | auraMoney:'1.0-0' }}</p>

          <section class="settlement-preview-bar" *ngIf="items().length">
            <div class="settlement-preview-copy">
              <strong>Review payment split before saving</strong>
            </div>
            <div class="settlement-preview-metrics">
              <article>
                <span>Advance adjusted</span>
                <strong>{{ settlementPreviewAdvance | auraMoney:'1.0-0' }}</strong>
              </article>
              <article>
                <span>Counter payment</span>
                <strong>{{ settlementPreviewCounterCollected | auraMoney:'1.0-0' }}</strong>
              </article>
              <article [class.is-due]="settlementPreviewDueAfterSave > 0">
                <span>Due after save</span>
                <strong>{{ settlementPreviewDueAfterSave | auraMoney:'1.0-0' }}</strong>
              </article>
              <article *ngIf="settlementPreviewWalletCredit > 0">
                <span>Wallet credit</span>
                <strong>{{ settlementPreviewWalletCredit | auraMoney:'1.0-0' }}</strong>
              </article>
            </div>
          </section>

          <button class="primary-button full-button" type="button" (click)="checkout()" [disabled]="!canSaveCheckout">
            {{ saving() ? 'Saving sale...' : 'Save sale and invoice' }}
          </button>

          <section class="invoice-preview" *ngIf="invoice() as invoice">
            <h3>{{ invoice.invoiceNumber }}</h3>
            <p>Status: <strong>{{ invoice.status }}</strong></p>
            <section class="generated-settlement-card" *ngIf="generatedInvoiceSettlement() as settlement">
              <div class="generated-settlement-lines">
                <div><span>Advance adjusted</span><strong>{{ settlement.advance | auraMoney:'1.0-0' }}</strong></div>
                <div><span>Counter paid</span><strong>{{ settlement.counter | auraMoney:'1.0-0' }}</strong></div>
                <div [class.total]="settlement.due > 0"><span>Counter due</span><strong>{{ settlement.due | auraMoney:'1.0-0' }}</strong></div>
                <div *ngIf="settlement.walletCredit > 0"><span>Wallet credit</span><strong>{{ settlement.walletCredit | auraMoney:'1.0-0' }}</strong></div>
              </div>
              <div class="generated-benefit-card" *ngIf="generatedInvoiceBenefitRedeem() as benefitRedeem">
                <div class="generated-settlement-lines">
                  <div><span>Benefit</span><strong>{{ generatedBenefitRedeemLabel(benefitRedeem) }}</strong></div>
                  <div><span>Credits used</span><strong>{{ generatedBenefitRedeemCredits(benefitRedeem) }}</strong></div>
                  <div><span>Balance left</span><strong>{{ generatedBenefitRedeemBalance(benefitRedeem) }}</strong></div>
                </div>
                <div class="benefit-mapping-summary-list" *ngIf="generatedBenefitServiceMappings(benefitRedeem).length">
                  <div *ngFor="let mapping of generatedBenefitServiceMappings(benefitRedeem)">
                    <span>{{ mapping.serviceName }}</span>
                    <strong>{{ mapping.credits }} credits</strong>
                  </div>
                </div>
              </div>
              <small class="generated-whatsapp-preview">WhatsApp summary: {{ generatedInvoiceWhatsappPreview(settlement) }}</small>
            </section>
            <button class="ghost-button" type="button" (click)="downloadInvoice()">Download invoice</button>
          </section>
        </aside>
      </div>

    </section>
  `,
  styles: [`
    :host .pos-layout,
    :host .pos-layout > .panel,
    :host .pos-form {
      overflow: visible;
    }

    :host .client-crm-tile.identity {
      align-content: start;
      gap: 7px;
    }

    :host .client-crm-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin-top: 6px;
    }

    :host .settlement-preview-bar {
      display: grid;
      gap: 12px;
      border: 1px solid rgba(75, 18, 56, 0.18);
      border-radius: 10px;
      padding: 14px;
      margin: 14px 0 16px;
      background: linear-gradient(180deg, rgba(248, 238, 244, 0.96), rgba(255, 255, 255, 0.98));
    }

    :host .settlement-preview-copy {
      display: grid;
      gap: 4px;
    }

    :host .settlement-preview-copy strong {
      color: #0f172a;
      font-size: 15px;
    }

    :host .settlement-preview-copy small {
      color: #475569;
      line-height: 1.4;
    }

    :host .settlement-preview-metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    :host .settlement-preview-metrics article {
      border: 1px solid rgba(75, 18, 56, 0.14);
      border-radius: 8px;
      padding: 12px;
      background: #fff;
      display: grid;
      gap: 4px;
    }

    :host .settlement-preview-metrics span {
      color: #4B1238;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }

    :host .settlement-preview-metrics strong {
      color: #0f172a;
      font-size: 18px;
      line-height: 1.1;
    }

    :host .settlement-preview-metrics article.is-due {
      border-color: rgba(220, 38, 38, 0.22);
      background: rgba(254, 242, 242, 0.96);
    }

    :host .settlement-preview-metrics article.is-due span {
      color: #b91c1c;
    }

    :host .benefit-mapping-box {
      display: grid;
      gap: 10px;
      margin: 12px 0;
      padding: 12px;
      border: 1px solid rgba(75, 18, 56, 0.14);
      border-radius: 10px;
      background: #f8fffd;
    }

    :host .membership-redemption-panel {
      display: grid;
      gap: 4px;
      margin: 8px 0 12px;
      padding: 10px 12px;
      border: 1px solid #d7e8e2;
      border-radius: 8px;
      background: #f8fcfa;
      color: #315148;
      font-size: 12px;
      font-weight: 800;
    }

    :host .membership-line-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid #E7DDD6;
      background: #f8fafc;
      color: #52625d;
      font-size: 11px;
      font-weight: 900;
    }

    :host .membership-line-badge--credit,
    :host .membership-line-badge--unlimited {
      border-color: #9bd8c4;
      background: #F3EAF0;
      color: #7A4A28;
    }

    :host .membership-line-badge--discount {
      border-color: #E7DDD6;
      background: #F8EEF4;
      color: #4B1238;
    }

    :host .membership-line-badge--eligible {
      border-color: #fde68a;
      background: #fffbeb;
      color: #92400e;
    }

    :host .benefit-mapping-box__header,
    :host .benefit-mapping-box__summary,
    :host .benefit-mapping-line,
    :host .benefit-mapping-summary-list div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }

    :host .benefit-mapping-box__header strong {
      display: block;
      color: #0f172a;
    }

    :host .benefit-mapping-box__summary {
      flex-wrap: wrap;
      color: #475569;
      font-size: 13px;
    }

    :host .benefit-mapping-lines,
    :host .benefit-mapping-summary-list {
      display: grid;
      gap: 8px;
    }

    :host .benefit-mapping-line,
    :host .benefit-mapping-summary-list div {
      padding: 10px 12px;
      border-radius: 8px;
      background: #fff;
      border: 1px solid rgba(148, 163, 184, 0.18);
    }

    :host .benefit-mapping-line small,
    :host .benefit-mapping-summary-list span {
      color: #64748b;
    }

    :host .compact-field {
      min-width: 96px;
      margin: 0;
    }

    :host .compact-field input {
      min-width: 80px;
    }

    :host .generated-benefit-card {
      display: grid;
      gap: 8px;
      border-top: 1px solid rgba(148, 163, 184, 0.18);
      padding-top: 10px;
    }

    :host .generated-settlement-card {
      display: grid;
      gap: 8px;
      border: 1px solid rgba(75, 18, 56, 0.18);
      border-radius: 10px;
      padding: 12px;
      margin: 12px 0;
      background: #f8fffd;
    }

    :host .generated-settlement-lines {
      display: grid;
      gap: 6px;
    }

    :host .generated-settlement-lines div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 0;
      border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    }

    :host .generated-settlement-lines div:last-child {
      border-bottom: 0;
    }

    :host .generated-settlement-lines span {
      color: #475569;
    }

    :host .generated-settlement-lines strong {
      color: #0f172a;
    }

    :host .generated-whatsapp-preview {
      color: #475569;
      line-height: 1.5;
    }

    @media (max-width: 960px) {
      :host .settlement-preview-metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      :host .benefit-mapping-line,
      :host .benefit-mapping-summary-list div {
        align-items: start;
        flex-direction: column;
      }
    }

    :host .client-crm-history-button {
      border-color: rgba(90, 21, 63, 0.26);
      background: #F1E8EE;
      color: #0f3f3a;
    }

    :host .pos-client-search-row {
      position: relative;
      z-index: 35;
      overflow: visible;
    }

    :host .pos-floating-search {
      position: relative;
      z-index: 30;
    }

    :host .pos-floating-search:focus-within {
      z-index: 120;
    }

    :host .pos-search-results {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      right: 0;
      z-index: 1000;
      display: grid;
      max-height: min(340px, 42vh);
      overflow-y: auto;
      padding: 8px;
      border: 1px solid rgba(75, 18, 56, 0.22);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 26px 70px rgba(15, 23, 42, 0.2);
      backdrop-filter: blur(12px);
    }

    :host .client-search-results {
      width: min(100%, 780px);
      gap: 8px;
    }

    :host .client-search-caption {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 8px 8px;
      color: #475569;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    :host .staff-search-results {
      max-height: min(280px, 36vh);
    }

    :host .staff-search-input-wrap {
      position: relative;
    }

    :host .staff-search-input-wrap input {
      padding-right: 44px;
    }

    :host .staff-clear-button {
      position: absolute;
      top: 50%;
      right: 12px;
      width: 26px;
      height: 26px;
      display: grid;
      place-items: center;
      transform: translateY(-50%);
      border: 0;
      border-radius: 999px;
      color: #4B1238;
      background: rgba(75, 18, 56, 0.1);
      font-weight: 900;
      cursor: pointer;
    }

    :host .pos-search-results button,
    :host .client-result-card {
      min-height: 48px;
      border-radius: 12px;
    }

    :host .client-result-card {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 10px;
      border: 0;
      background: transparent;
      text-align: left;
      cursor: pointer;
    }

    :host .client-result-card:hover,
    :host .client-result-card:focus-visible,
    :host .client-result-card.active {
      background: rgba(75, 18, 56, 0.09);
      outline: 0;
    }

    :host .client-avatar {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      color: #f8fafc;
      background: linear-gradient(135deg, #4B1238, #55173D);
      font-weight: 900;
    }

    :host .client-result-main {
      display: grid;
      min-width: 0;
      gap: 2px;
    }

    :host .client-result-main strong,
    :host .client-result-main span,
    :host .client-result-main small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    :host .client-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 4px;
    }

    :host .client-badge {
      width: fit-content;
      padding: 3px 7px;
      border-radius: 999px;
      color: #334155;
      background: #f1f5f9;
      font-size: 11px;
      font-weight: 900;
      line-height: 1.2;
    }

    :host .client-badge.good {
      color: #7A4A28;
      background: #FBF0E8;
    }

    :host .client-badge.wallet {
      color: #4B1238;
      background: #F8EEF4;
    }

    :host .client-badge.due,
    :host .client-badge.warning {
      color: #b45309;
      background: #fef3c7;
    }

    :host .package-billing-alert {
      grid-column: 1 / -1;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      min-height: 58px;
      border: 2px solid #C87D4B;
      border-radius: 8px;
      padding: 10px 14px;
      background: #F3EAF0;
      box-shadow: inset 4px 0 0 #C87D4B;
    }

    :host .package-billing-alert div {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    :host .package-billing-alert span {
      color: #7A4A28;
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }

    :host .package-billing-alert strong {
      color: #0f172a;
      font-size: 15px;
      overflow-wrap: anywhere;
    }

    :host .package-billing-alert small {
      color: #7A4A28;
      line-height: 1.35;
    }

    :host .package-billing-alert__meta {
      flex: 0 0 auto;
      justify-items: end;
      text-align: right;
    }

    :host .package-billing-alert--expired {
      border-color: #f59e0b;
      background: #fffbeb;
      box-shadow: inset 4px 0 0 #dc2626;
    }

    :host .package-billing-alert--expired span {
      color: #b45309;
    }

    :host .package-billing-alert--expired small {
      color: #92400e;
    }

    :host .package-redeem-panel {
      grid-column: 1 / -1;
      display: grid;
      gap: 8px;
      border: 1px solid #c7d2fe;
      border-radius: 8px;
      padding: 10px;
      background: #ede9fe;
    }

    :host .package-redeem-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      color: #111827;
    }

    :host .package-redeem-header small,
    :host .package-redeem-expiry {
      color: #475569;
      font-size: 12px;
      font-weight: 700;
    }

    :host .package-redeem-grid {
      display: grid;
      grid-template-columns: 1.35fr 1.35fr 0.65fr 0.7fr 1.2fr auto;
      gap: 8px;
      align-items: center;
      padding: 8px;
      border-radius: 8px;
      background: #f8fafc;
    }

    :host .package-redeem-grid--head {
      padding: 0 8px;
      color: #1f2937;
      background: transparent;
      font-size: 12px;
      font-weight: 900;
    }

    :host .package-redeem-grid input,
    :host .package-redeem-grid select {
      width: 100%;
      min-height: 40px;
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      padding: 8px 10px;
      background: #fff;
      color: #0f172a;
    }

    :host .package-redeem-grid--expired {
      opacity: 0.72;
      background: #fff7ed;
    }

    :host .package-redeem-expiry {
      grid-column: 1 / -1;
    }

    :host .client-result-main mark {
      padding: 0 1px;
      border-radius: 3px;
      color: #0f172a;
      background: #fde68a;
    }

    :host .client-call-button {
      padding: 8px 12px;
      border-radius: 999px;
      color: #4B1238;
      background: rgba(75, 18, 56, 0.1);
      font-size: 12px;
      font-weight: 900;
      text-decoration: none;
    }

    :host .client-call-button.whatsapp {
      color: #C87D4B;
      background: #FBF0E8;
    }

    :host .client-empty-state {
      padding: 18px 12px;
      color: #64748b;
      text-align: center;
      font-weight: 800;
    }

    :host .pos-drawer-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1500;
      background: rgba(15, 23, 42, 0.34);
      backdrop-filter: blur(6px);
    }

    :host .pos-drawer {
      position: fixed;
      top: 16px;
      right: 16px;
      bottom: 16px;
      z-index: 1501;
      width: min(520px, calc(100vw - 32px));
      display: grid;
      grid-template-rows: auto auto auto auto 1fr;
      gap: 16px;
      padding: 18px;
      overflow-y: auto;
      border: 1px solid rgba(75, 18, 56, 0.18);
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 30px 90px rgba(15, 23, 42, 0.26);
    }

    :host .drawer-title {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    :host .drawer-title h3 {
      margin: 4px 0;
      color: #0f172a;
      font-size: 28px;
      line-height: 1.05;
    }

    :host .drawer-title small {
      color: #64748b;
      font-weight: 700;
    }

    :host .inline-hint.success {
      color: #7A4A28;
    }

    :host .inline-hint.danger {
      color: #b91c1c;
    }

    @media (max-width: 720px) {
      :host .client-search-results {
        position: fixed;
        inset: auto 12px 12px 12px;
        width: auto;
        max-height: 58vh;
        border-radius: 22px;
      }

      :host .client-result-card {
        grid-template-columns: 40px minmax(0, 1fr) auto auto;
      }

      :host .pos-drawer {
        inset: auto 10px 10px 10px;
        width: auto;
        max-height: 84vh;
        border-radius: 22px;
      }

    }

    :host .pos-search-results button:hover,
    :host .pos-search-results button:focus-visible {
      background: rgba(75, 18, 56, 0.09);
      outline: 0;
    }
    :host .page-stack { gap: 16px; padding: 8px 4px 24px; background: var(--color-surface-muted); }
    :host .pos-command-hero { align-items: center; min-height: auto; padding: 18px 22px; border: 1px solid rgba(117, 79, 71, 0.12); border-radius: 14px; background: linear-gradient(180deg, #fff, #faf8f6); box-shadow: 0 10px 28px rgba(89, 64, 54, 0.06); }
    :host .pos-command-copy { display: grid; gap: 4px; min-width: 0; }
    :host .pos-eyebrow { color: #8a625b; font-size: 11px; font-weight: 680; letter-spacing: 0.08em; text-transform: uppercase; }
    :host .pos-command-copy h1 { margin: 0; color: #241b19; font-size: clamp(1.28rem, 1.75vw, 1.82rem); font-weight: 690; letter-spacing: -0.025em; }
    :host .pos-command-copy p { max-width: 620px; margin: 0; color: #6f625f; font-size: 13px; line-height: 1.45; }
    :host .hero-actions { gap: 8px; align-items: center; }
    :host .client-crm-strip { gap: 12px; }
    :host .client-crm-tile { border: 1px solid rgba(117, 79, 71, 0.12); border-radius: 13px; background: #fff; box-shadow: 0 6px 18px rgba(89, 64, 54, 0.035); }
    :host .client-crm-tile span, :host .field > span, :host .settlement-preview-metrics span, :host .summary-lines span, :host .payment-mode-card span, :host .package-billing-alert span, :host .package-redeem-header small, :host .package-redeem-expiry { font-weight: 620; letter-spacing: 0.035em; }
    :host .client-crm-tile strong, :host .summary-lines strong, :host .payment-title-copy h2, :host .checkout-title h2 { color: #2f2421; font-weight: 680; }
    :host .pos-layout { display: grid; grid-template-columns: minmax(0, 1.48fr) minmax(360px, 0.82fr); gap: 16px; align-items: start; }
    :host .pos-layout > .panel, :host .checkout-panel, :host .form-panel, :host .invoice-preview, :host .tip-box { border: 1px solid rgba(117, 79, 71, 0.12); border-radius: 14px; background: #fff; box-shadow: 0 8px 24px rgba(89, 64, 54, 0.04); }
    :host .pos-layout > .panel { min-width: 0; padding: 18px; }
    :host .checkout-panel { position: sticky; top: 14px; display: grid; gap: 14px; padding: 18px; }
    :host .pos-form, :host .catalog-picker, :host .benefit-lines, :host .summary-control-grid, :host .tip-draft-grid, :host .payment-grid { gap: 12px; }
    :host .pos-form { padding: 0; }
    :host .client-search-row, :host .catalog-picker, :host .benefit-lines, :host .summary-control-grid, :host .payment-grid, :host .tip-draft-grid { align-items: end; }
    :host .field input, :host .field select, :host .field textarea, :host .small-input, :host .line-discount-control input, :host .line-discount-control select, :host .package-redeem-grid input, :host .package-redeem-grid select { border-color: rgba(117, 79, 71, 0.14); border-radius: 9px; background: #fff; box-shadow: none; }
    :host .field input:focus, :host .field select:focus, :host .field textarea:focus, :host .small-input:focus, :host .line-discount-control input:focus, :host .line-discount-control select:focus { border-color: rgba(143, 92, 84, 0.32); box-shadow: 0 0 0 3px rgba(143, 92, 84, 0.08); outline: 0; }
    :host .ghost-button, :host .primary-button, :host .dark-button, :host .icon-button { border-radius: 9px; font-weight: 620; box-shadow: none; }
    :host .primary-button, :host .dark-button { border-color: #7a4d47; background: #7a4d47; color: #fff; }
    :host .primary-button:hover, :host .dark-button:hover { background: #6b443f; transform: none; box-shadow: 0 10px 22px rgba(122, 77, 71, 0.18); }
    :host .ghost-button { border-color: rgba(117, 79, 71, 0.16); background: #fff; color: #5f4742; }
    :host .ghost-button:hover, :host .ghost-button:focus-visible { border-color: rgba(143, 92, 84, 0.28); background: #fff8f5; color: #6f4741; transform: none; }
    :host .client-crm-history-button, :host .client-call-button, :host .client-call-button.whatsapp, :host .staff-clear-button, :host .client-badge.good, :host .client-badge.wallet, :host .client-badge.due, :host .client-badge.warning { background: #fbf1ec; color: #6f4741; border-color: rgba(143, 92, 84, 0.16); }
    :host .client-avatar { color: #7a4d47; background: #fbf1ec; }
    :host .pos-search-results { border-color: rgba(117, 79, 71, 0.16); border-radius: 14px; background: rgba(255, 255, 255, 0.99); box-shadow: 0 22px 56px rgba(89, 64, 54, 0.16); backdrop-filter: blur(10px); }
    :host .pos-search-results button:hover, :host .pos-search-results button:focus-visible, :host .client-result-card:hover, :host .client-result-card:focus-visible, :host .client-result-card.active { background: #fff8f5; }
    :host .service-result-option, :host .client-result-card, :host .benefit-mapping-line, :host .benefit-mapping-summary-list div, :host .tip-lines article, :host .generated-settlement-lines div { border-color: rgba(117, 79, 71, 0.1); border-radius: 10px; }
    :host .package-billing-alert, :host .package-billing-alert--expired, :host .package-redeem-panel, :host .benefit-mapping-box, :host .membership-redemption-panel, :host .generated-settlement-card, :host .settlement-preview-bar, :host .unpaid-receive-box, :host .round-off-box { border: 1px solid rgba(117, 79, 71, 0.12); border-left: 3px solid rgba(143, 92, 84, 0.72); border-radius: 12px; background: #fffaf7; box-shadow: none; }
    :host .package-redeem-grid, :host .settlement-preview-metrics article { border: 1px solid rgba(117, 79, 71, 0.1); border-radius: 10px; background: #fff; }
    :host .settlement-preview-metrics article.is-due { border-color: rgba(185, 28, 28, 0.18); background: #fff7f5; }
    :host .summary-lines { display: grid; gap: 0; border: 1px solid rgba(117, 79, 71, 0.1); border-radius: 12px; overflow: hidden; background: #fff; }
    :host .summary-lines div { display: flex; justify-content: space-between; gap: 16px; padding: 10px 12px; border-bottom: 1px solid rgba(117, 79, 71, 0.08); }
    :host .summary-lines div:last-child { border-bottom: 0; }
    :host .summary-lines .total { background: #fff8f5; }
    :host .payment-header { align-items: start; gap: 12px; padding-top: 2px; }
    :host .payment-title-copy h2, :host .checkout-title h2 { margin: 2px 0 0; font-size: 1.02rem; letter-spacing: -0.015em; }
    :host .payment-mode-card { border: 1px solid rgba(117, 79, 71, 0.12); border-radius: 12px; background: #fff; transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease; }
    :host .payment-mode-card:hover, :host .payment-mode-card.filled { border-color: rgba(143, 92, 84, 0.26); background: #fff8f5; box-shadow: 0 8px 18px rgba(89, 64, 54, 0.045); }
    :host .full-button { min-height: 46px; font-size: 0.94rem; }
    :host table { border-collapse: separate; border-spacing: 0; }
    :host th { position: sticky; top: 0; z-index: 1; background: #fff8f5; color: #6b5a55; font-weight: 650; }
    :host td { border-bottom-color: rgba(117, 79, 71, 0.08); vertical-align: middle; }
    :host tbody tr:hover td { background: #fffaf7; }
    @media (max-width: 1180px) { :host .pos-layout { grid-template-columns: 1fr; } :host .checkout-panel { position: static; } }
    @media (max-width: 760px) {
      :host .pos-command-hero, :host .payment-header, :host .package-billing-alert, :host .unpaid-receive-box { align-items: stretch; flex-direction: column; }
      :host .hero-actions, :host .payment-actions, :host .client-search-actions { width: 100%; }
      :host .hero-actions > *, :host .payment-actions > *, :host .client-search-actions > * { flex: 1 1 auto; justify-content: center; }
      :host .pos-layout > .panel, :host .checkout-panel { padding: 14px; }
      :host .summary-lines div { padding: 9px 10px; }
    }
    :host .pos-layout > .panel:first-child {
      display: grid;
      gap: 18px;
      background: #fffdfb;
    }

    :host .checkout-panel {
      background: #ffffff;
      box-shadow: 0 18px 44px rgba(73, 51, 43, 0.075);
    }

    :host .client-crm-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(176px, 1fr));
    }

    :host .client-crm-tile {
      min-height: 92px;
      padding: 14px 15px;
      align-content: center;
      border-left: 3px solid rgba(154, 106, 96, 0.68);
    }

    :host .client-crm-tile span {
      color: #83736e;
      font-size: 0.68rem;
      text-transform: uppercase;
    }

    :host .client-crm-tile strong {
      font-size: 1rem;
      letter-spacing: -0.01em;
    }

    :host .pos-client-search-row,
    :host .catalog-picker,
    :host .benefit-lines {
      padding: 14px;
      border: 1px solid rgba(118, 85, 76, 0.11);
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 8px 24px rgba(73, 51, 43, 0.035);
    }

    :host .catalog-picker,
    :host .benefit-lines,
    :host .summary-control-grid,
    :host .tip-draft-grid,
    :host .payment-grid {
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    }

    :host .field > span {
      color: #766763;
      font-size: 0.69rem;
      text-transform: uppercase;
    }

    :host .field input,
    :host .field select,
    :host .field textarea {
      min-height: 40px;
      color: #2f2522;
    }

    :host .service-search-results,
    :host .client-search-results,
    :host .staff-search-results {
      border-color: rgba(118, 85, 76, 0.14);
      box-shadow: 0 24px 60px rgba(73, 51, 43, 0.16);
    }

    :host .service-result-option,
    :host .client-result-card {
      min-height: 58px;
      background: #fff;
    }

    :host .select-pill,
    :host .client-badge,
    :host .membership-line-badge,
    :host .split-number {
      border-radius: 999px;
      background: #fff7f3;
      color: #75524b;
      font-weight: 620;
    }

    :host .package-billing-alert,
    :host .package-redeem-panel,
    :host .benefit-mapping-box,
    :host .membership-redemption-panel,
    :host .settlement-preview-bar,
    :host .unpaid-receive-box,
    :host .generated-settlement-card {
      background: #fffdfb;
      border-left-color: #9a6a60;
    }

    :host .summary-lines div.total,
    :host .summary-lines .total {
      color: #2f2522;
      background: #fff7f3;
    }

    :host .payment-header {
      padding: 12px 0 2px;
      border-top: 1px solid rgba(118, 85, 76, 0.1);
    }

    :host .payment-mode-card {
      padding: 12px;
    }

    :host .payment-mode-card span {
      color: #6f625f;
      font-size: 0.72rem;
    }

    :host .full-button {
      border-radius: 12px;
      background: #744a44;
      box-shadow: 0 14px 28px rgba(116, 74, 68, 0.18);
    }

    :host .invoice-preview {
      padding: 14px;
      background: #fffdfb;
    }

    :host table {
      width: 100%;
      overflow: hidden;
      border: 1px solid rgba(118, 85, 76, 0.1);
      border-radius: 12px;
      background: #fff;
    }

    :host th,
    :host td {
      padding: 12px 10px;
    }

    :host .line-total-cell strong,
    :host .summary-lines strong {
      font-weight: 640;
    }

    @media (max-width: 900px) {
      :host .catalog-picker,
      :host .benefit-lines,
      :host .summary-control-grid,
      :host .tip-draft-grid,
      :host .payment-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class PosComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('clientSearchInput') private clientSearchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('staffSearchInput') private staffSearchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('serviceSearchInput') private serviceSearchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('productSearchInput') private productSearchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('membershipPlanSelect') private membershipPlanSelect?: ElementRef<HTMLSelectElement>;
  @ViewChild('packageSelect') private packageSelect?: ElementRef<HTMLSelectElement>;
  @ViewChild('giftCardAmount') private giftCardAmount?: ElementRef<HTMLInputElement>;

  readonly clients = signal<ApiRecord[]>([]);
  readonly staff = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly products = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly appointments = signal<ApiRecord[]>([]);
  readonly invoices = signal<ApiRecord[]>([]);
  readonly memberships = signal<ApiRecord[]>([]);
  readonly packages = signal<ApiRecord[]>([]);
  readonly membershipPlans = signal<PosMembershipPlan[]>([]);
  readonly membershipEligibility = signal<ApiRecord | null>(null);
  readonly membershipSuggestion = signal<ApiRecord | null>(null);
  readonly items = signal<SaleItem[]>([]);
  readonly paymentModes = signal<PosPaymentMode[]>([]);
  readonly tipPresets = signal<PosTipPreset[]>([]);
  readonly tips = signal<TipLine[]>([]);
  readonly invoice = signal<ApiRecord | null>(null);
  readonly couponResult = signal<ApiRecord | null>(null);
  readonly couponMessage = signal('');
  readonly tipMessage = signal('');
  readonly walletCreditRequested = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly couponChecking = signal(false);
  readonly error = signal('');
  readonly dataHint = signal('');
  readonly bookingAdvanceInfo = signal<ApiRecord | null>(null);
  readonly bookingAdvanceLoading = signal(false);
  readonly bookingAdvanceAppliedAmount = signal(0);
  readonly generatedInvoiceSettlement = signal<{ advance: number; counter: number; due: number; walletCredit: number } | null>(null);
  readonly generatedInvoiceBenefitRedeem = signal<ApiRecord | null>(null);
  readonly showClientForm = signal(false);
  readonly clientSaving = signal(false);
  readonly debouncedClientQuery = signal('');
  readonly clientSearchPending = signal(false);
  readonly clientSearchResults = signal<ApiRecord[]>([]);
  readonly activeClientResultIndex = signal(0);
  discount = 0;
  discountMode: 'amount' | 'percent' = 'amount';
  couponCode = '';
  creditsUsed = 0;
  membershipId = '';
  benefitServiceMappings: BenefitServiceMapping[] = [];
  packageRedeemQuantities: Record<string, number> = {};
  packageRedeemStaffIds: Record<string, string> = {};
  clientSearchText = '';
  staffSearchText = '';
  serviceSearchText = '';
  productSearchText = '';
  clientSearchActive = false;
  staffSearchActive = false;
  serviceSearchActive = false;
  productSearchActive = false;
  selectedServiceId = '';
  selectedServiceIds: string[] = [];
  selectedProductId = '';
  selectedProductIds: string[] = [];
  currentHoldId = '';
  private pendingHoldId = '';
  payments: Record<string, number> = {};
  tipDraft = { staffId: '', paymentMode: 'card', amount: 0, note: '' };
  unpaidReceiveAmount = 0;
  unpaidReceiveMode = 'cash';
  readonly unpaidReceiveMessage = signal('');
  readonly Number = Number;
  readonly invoiceDateMax = this.todayDateInput();

  readonly form = this.fb.group({
    clientId: ['', Validators.required],
    branchId: ['', Validators.required],
    staffId: [''],
    appointmentId: [''],
    invoiceDate: [this.invoiceDateMax, Validators.required]
  });

  readonly clientForm = this.fb.group({
    name: ['', Validators.required],
    phone: ['', Validators.required],
    email: [''],
    birthday: [''],
    anniversary: [''],
    tag: ['new'],
    notes: ['']
  });

  private fallbackTried = false;
  private fallbackNotice = false;
  private activeDraftRestored = false;
  private suppressActiveDraftPersistence = false;
  private readonly loadFailures = new Set<string>();
  private readonly branchSelectionSub = new Subscription();
  private branchSyncReady = false;
  private clientSearchTimer = 0;
  private clientSearchRequestId = 0;
  private redeemableBenefitsCacheKey = '';
  private redeemableBenefitsCache: ApiRecord[] = [];
  private redeemableServiceLinesCacheKey = '';
  private redeemableServiceLinesCache: RedeemableServiceLine[] = [];
  private selectedBenefitMappingsCacheKey = '';
  private selectedBenefitMappingsCache: BenefitServiceMapping[] = [];
  private readonly clientSearchIndex = new Map<string, ClientSearchIndex>();
  private readonly selectedClientId = signal('');
  readonly selectedClientPackageRecords = computed<ApiRecord[]>(() => {
    const clientId = this.selectedClientId();
    return clientId ? this.clientPackageRecords(clientId) : [];
  });
  readonly selectedClientPackageRows = computed<PackageRedeemRow[]>(() => [...this.selectedClientPackageRecords()]
    .sort((a, b) => this.packageSortTime(b) - this.packageSortTime(a))
    .flatMap((membership) => this.packageCreditRows(membership)));
  readonly selectedClientPackageNotice = computed<PackageClientNotice | null>(() => {
    const packages = [...this.selectedClientPackageRecords()];
    if (!packages.length) return null;
    const active = packages
      .filter((membership) => this.packageStatus(membership) === 'active')
      .sort((a, b) => this.packageSortTime(b) - this.packageSortTime(a))[0];
    const selected = active || packages.sort((a, b) => this.packageSortTime(b) - this.packageSortTime(a))[0];
    const status = this.packageStatus(selected);
    const creditsRemaining = this.packageRemainingCredits(selected);
    const totalCredits = this.packageTotalCredits(selected);
    const expiry = selected.validityDate ? this.dateLabel(selected.validityDate) : 'No expiry';
    const title = this.packageDisplayName(selected);
    return {
      status,
      title,
      summary: status === 'active'
        ? `${title} active hai. Billing me package redeem kar sakte ho.`
        : `${title} expire/used ho gaya hai. Renewal ya new package sale check karo.`,
      credits: totalCredits > 0 ? `${creditsRemaining}/${totalCredits}` : String(creditsRemaining),
      expiry
    };
  });

  constructor(
    private readonly api: ApiService,
    private readonly fb: UntypedFormBuilder,
    private readonly posSettings: PosSettingsService,
    private readonly appState: AppStateService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {
    effect(() => {
      const branchId = this.appState.selectedBranchId();
      this.syncHeaderBranchToForm(branchId, true);
      if (this.branchSyncReady) this.load();
    });
  }

  ngOnInit(): void {
    this.pendingHoldId = this.route.snapshot.queryParamMap.get('holdId') || '';
    this.syncHeaderBranchToForm(this.appState.selectedBranchId(), false);
    const branchControl = this.form.get('branchId');
    if (branchControl) {
      this.branchSelectionSub.add(
        branchControl.valueChanges.pipe(distinctUntilChanged()).subscribe((branchId) => {
          this.loadStaffForBranch(String(branchId || ''));
        })
      );
    }
    const appointmentControl = this.form.get('appointmentId');
    if (appointmentControl) {
      this.branchSelectionSub.add(
        appointmentControl.valueChanges.pipe(distinctUntilChanged()).subscribe((appointmentId) => {
          this.loadBookingAdvanceSuggestion(String(appointmentId || ''));
        })
      );
    }
    this.loadPosSettings();
    this.branchSyncReady = true;
    this.load();
  }

  ngAfterViewInit(): void {
    this.focusInitialDirectInvoiceField();
  }

  private focusInitialDirectInvoiceField(): void {
    this.focusLater(() => {
      if (!this.form.value.clientId) {
        this.focusClientSearch();
        return;
      }
      if (!this.form.value.staffId) {
        this.focusStaffSearch();
        return;
      }
      this.focusServiceSearch();
    });
  }

  private focusLater(action: () => void): void {
    window.setTimeout(action, 0);
  }

  private focusClientSearch(): void {
    this.clientSearchActive = true;
    this.clientSearchInput?.nativeElement.focus();
  }

  private focusStaffSearch(): void {
    this.staffSearchActive = true;
    this.staffSearchInput?.nativeElement.focus();
  }

  private focusServiceSearch(): void {
    this.serviceSearchActive = true;
    this.serviceSearchInput?.nativeElement.focus();
  }

  private focusProductSearch(): void {
    this.productSearchActive = true;
    this.productSearchInput?.nativeElement.focus();
  }

  private focusMembershipPlan(): void {
    this.membershipPlanSelect?.nativeElement.focus();
  }

  private focusPackageSelect(): void {
    this.packageSelect?.nativeElement.focus();
  }

  private focusGiftCardAmount(): void {
    this.giftCardAmount?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    window.clearTimeout(this.clientSearchTimer);
    this.branchSelectionSub.unsubscribe();
    this.persistActiveBillingDraft();
  }

  @HostListener('window:beforeunload')
  persistActiveBillingDraft(): void {
    if (this.suppressActiveDraftPersistence) {
      return;
    }
    if (!this.hasActiveBillingDraftDetails()) {
      this.posSettings.clearActiveBillingDraft();
      return;
    }
    this.posSettings.saveActiveBillingDraft(this.buildActiveBillingDraft());
  }

  get subtotal(): number {
    return this.items().reduce((sum, item) => sum + this.lineGross(item), 0);
  }

  get itemDiscountTotal(): number {
    return this.money(this.items().reduce((sum, item) => sum + this.lineDiscountAmount(item), 0));
  }

  get itemManualDiscountTotal(): number {
    return this.money(
      this.items()
        .filter((item) => item.discountSource !== 'membership')
        .reduce((sum, item) => sum + this.lineDiscountAmount(item), 0)
    );
  }

  get billLevelDiscount(): number {
    const base = Math.max(0, this.subtotal - this.itemDiscountTotal);
    return this.money(Math.min(base, this.manualDiscountAmount + this.couponDiscount + this.membershipCreditAdjustmentAmount()));
  }

  get gst(): number {
    const itemTaxableSubtotal = Math.max(0, this.subtotal - this.itemDiscountTotal);
    const afterBillDiscountRatio = itemTaxableSubtotal
      ? Math.max(0, itemTaxableSubtotal - this.billLevelDiscount) / itemTaxableSubtotal
      : 0;
    return this.money(
      this.items().reduce((sum, item) => {
        const taxable = this.lineTaxableSubtotal(item) * afterBillDiscountRatio;
        return sum + taxable * (Number(item.gstRate) / 100);
      }, 0)
    );
  }

  get total(): number {
    return this.money(Math.max(0, this.subtotal - this.totalDiscount) + this.gst + this.tipTotal);
  }

  get tipTotal(): number {
    return this.money(this.tips().reduce((sum, tip) => sum + Number(tip.amount || 0), 0));
  }

  get paidTotal(): number {
    return this.money(
      Object.values(this.payments).reduce((sum, amount) => sum + Number(amount || 0), 0)
      + this.appliedBookingAdvanceAmount()
    );
  }

  get balanceDue(): number {
    return this.money(Math.max(0, this.total - this.paidTotal));
  }

  get roundOffDueAmount(): number {
    if (!this.items().length || this.paidTotal <= 0 || this.overPaid > 0) return 0;
    return this.balanceDue > 0 ? this.balanceDue : 0;
  }

  get overPaid(): number {
    return this.money(Math.max(0, this.paidTotal - this.total));
  }

  get walletBalance(): number {
    return this.money(Number(this.selectedClient()?.walletBalance || 0));
  }

  get selectedClientUnpaidBalance(): number {
    return this.money(Number(this.selectedClient()?.unpaidBalance || 0));
  }

  get canReceiveUnpaid(): boolean {
    return !this.saving()
      && !!this.form.value.clientId
      && this.selectedClientUnpaidBalance > 0
      && this.money(Number(this.unpaidReceiveAmount || 0)) > 0
      && this.unpaidInvoicesForSelectedClient().length > 0;
  }

  get redeemableWalletAmount(): number {
    return this.money(Math.min(this.balanceDue, this.walletBalance));
  }

  get walletButtonReady(): boolean {
    return !!this.form.value.clientId && (this.overPaid > 0 || this.redeemableWalletAmount > 0);
  }

  get walletButtonLabel(): string {
    if (!this.form.value.clientId) return 'Wallet';
    if (this.overPaid > 0) {
      return this.walletCreditRequested()
        ? `Wallet +â‚¹${this.overPaid}`
        : `Add â‚¹${this.overPaid} to wallet`;
    }
    if (this.redeemableWalletAmount > 0) return `Redeem â‚¹${this.redeemableWalletAmount}`;
    return `Wallet â‚¹${this.walletBalance}`;
  }

  get canSaveCheckout(): boolean {
    return !this.saving() && !!this.items().length && !this.form.invalid && (this.overPaid <= 0 || this.walletCreditRequested());
  }

  get hasBookingAdvanceSuggestion(): boolean {
    return this.bookingAdvancePaidAmount() > 0 && this.appliedBookingAdvanceAmount() <= 0;
  }

  get bookingAdvanceRemainingSuggestion(): number {
    return this.money(Math.max(0, this.total - this.bookingAdvancePaidAmount()));
  }

  get settlementPreviewAdvance(): number {
    return this.appliedBookingAdvanceAmount();
  }

  get settlementPreviewCounterCollected(): number {
    return this.money(Object.values(this.payments).reduce((sum, amount) => sum + Number(amount || 0), 0));
  }

  get settlementPreviewDueAfterSave(): number {
    return this.balanceDue;
  }

  get settlementPreviewWalletCredit(): number {
    return this.walletCreditRequested() ? this.overPaid : 0;
  }

  currentSettlementPreview(): { advance: number; counter: number; due: number; walletCredit: number } {
    return {
      advance: this.settlementPreviewAdvance,
      counter: this.settlementPreviewCounterCollected,
      due: this.settlementPreviewDueAfterSave,
      walletCredit: this.settlementPreviewWalletCredit
    };
  }

  generatedInvoiceWhatsappPreview(settlement: { advance: number; counter: number; due: number; walletCredit: number }): string {
    const advance = this.money(Number(settlement?.advance || 0)).toFixed(2);
    const counter = this.money(Number(settlement?.counter || 0)).toFixed(2);
    const due = this.money(Number(settlement?.due || 0)).toFixed(2);
    return `Advance adjusted: INR ${advance} | Counter paid: INR ${counter} | Counter due: INR ${due}`;
  }

  get couponDiscount(): number {
    return Number(this.couponResult()?.discountAmount || 0);
  }

  get manualDiscountAmount(): number {
    const value = Math.max(0, Number(this.discount || 0));
    const base = Math.max(0, this.subtotal - this.itemDiscountTotal);
    if (this.discountMode === 'percent') {
      return this.money((base * Math.min(value, 100)) / 100);
    }
    return this.money(value);
  }

  roundOffPreviewLabel(): string {
    if (!this.canApplyRoundOff()) return '';
    const targetDiscount = this.roundOffManualDiscountTarget();
    const addedDiscount = this.money(Math.max(0, targetDiscount - this.manualDiscountAmount));
    if (this.discountMode === 'percent') {
      return `Discount auto ${this.discountPercentForManualAmount(targetDiscount)}% ho jayega. Add-on discount approx ${addedDiscount.toLocaleString('en-IN')}.`;
    }
    return `Discount auto ${targetDiscount.toLocaleString('en-IN')} ho jayega. Add-on discount approx ${addedDiscount.toLocaleString('en-IN')}.`;
  }

  canApplyRoundOff(): boolean {
    return this.roundOffManualDiscountTarget() > this.manualDiscountAmount + 0.009;
  }

  keepRoundOffAsUnpaid(): void {
    if (this.roundOffDueAmount <= 0) return;
    this.dataHint.set(`Balance â‚¹${this.roundOffDueAmount.toLocaleString('en-IN')} will be saved as unpaid.`);
  }

  applyBalanceRoundOff(): void {
    const dueAmount = this.roundOffDueAmount;
    const targetDiscount = this.roundOffManualDiscountTarget();
    if (dueAmount <= 0 || targetDiscount <= this.manualDiscountAmount + 0.009) {
      this.dataHint.set('No discount space is available for round off.');
      return;
    }
    if (this.discountMode === 'percent') {
      this.discount = this.discountPercentForManualAmount(targetDiscount);
    } else {
      this.discount = this.money(targetDiscount);
    }
    this.walletCreditRequested.set(false);
    this.dataHint.set(`Round off â‚¹${dueAmount.toLocaleString('en-IN')} applied. No unpaid balance remains.`);
  }

  get membershipAutoDiscount(): number {
    return this.money(
      this.items()
        .filter((item) => item.discountSource === 'membership')
        .reduce((sum, item) => sum + this.lineDiscountAmount(item), 0)
    );
  }

  get membershipAutoDiscountLabel(): string {
    const membership = this.activeMembershipForClient();
    const percent = this.activeMembershipDiscountPercent();
    return membership ? `${membership.planName} ${percent}% discount` : 'Membership discount';
  }

  get prepaidMembershipRedeemDiscount(): number {
    const benefit = this.selectedRedeemableBenefit();
    if (!benefit || !this.isPrepaidCreditBenefit(benefit) || Number(this.creditsUsed || 0) <= 0) return 0;
    const mappedLines = this.selectedBenefitServiceMappings();
    const taxableMappedTotal = mappedLines.length
      ? mappedLines.reduce((sum, mapping) => {
          const item = this.items()[mapping.lineIndex];
          return item && this.membershipCreditAllowedForItem(item, benefit) ? sum + this.lineTaxableSubtotal(item) : sum;
        }, 0)
      : this.redeemableServiceLines(benefit).reduce((sum, line) => {
          const item = this.items()[line.lineIndex];
          return item ? sum + this.lineTaxableSubtotal(item) : sum;
        }, 0);
    const baseAfterManual = Math.max(0, this.subtotal - this.itemDiscountTotal - this.manualDiscountAmount - this.couponDiscount);
    return this.money(Math.min(Math.max(0, Number(this.creditsUsed || 0)), taxableMappedTotal, baseAfterManual, this.membershipCreditRedeemCap(benefit)));
  }

  membershipCreditAdjustmentAmount(): number {
    const benefit = this.selectedRedeemableBenefit();
    if (!benefit || Number(this.creditsUsed || 0) <= 0) return 0;
    if (this.isPrepaidCreditBenefit(benefit)) return this.prepaidMembershipRedeemDiscount;
    if (!this.isCreditBenefit(benefit)) return 0;
    const mappedLines = this.selectedBenefitServiceMappings();
    if (!mappedLines.length) return 0;
    const taxableMappedTotal = mappedLines.reduce((sum, mapping) => {
      const item = this.items()[mapping.lineIndex];
      if (!item || !this.membershipCreditAllowedForItem(item, benefit)) return sum;
      return sum + this.lineTaxableSubtotal(item);
    }, 0);
    const baseAfterManual = Math.max(0, this.subtotal - this.itemDiscountTotal - this.manualDiscountAmount - this.couponDiscount);
    return this.money(Math.min(taxableMappedTotal, baseAfterManual));
  }

  get totalDiscount(): number {
    return this.money(Math.min(this.subtotal, this.itemDiscountTotal + this.billLevelDiscount));
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    if (!this.fallbackNotice) this.dataHint.set('');
    this.loadFailures.clear();

    forkJoin({
      clients: this.safeList('clients', { limit: 1000 }),
      staff: this.safeList('staff-os/staff', this.staffQueryParams()),
      services: this.safeList('services', { limit: 1000 }),
      products: this.safeList('products', { limit: 1000 }),
      branches: this.safeList('branches', { limit: 1000 }),
      appointments: this.safeList('appointments', { limit: 1000 }),
      memberships: this.safeList('memberships', { limit: 1000 }),
      invoices: this.safeList('invoices', { limit: 1000 }),
      walletTransactions: this.safeList('walletTransactions', { limit: 5000 }),
      packages: this.safeList('packages', { limit: 1000 }),
      packagesAllBranches: this.safeList('packages', { limit: 1000, includeAllBranches: true }),
      membershipPlans: this.safeList('membership-enterprise/plans')
    }).subscribe({
      next: ({ clients, staff, services, products, branches, appointments, memberships, invoices, walletTransactions, packages, packagesAllBranches, membershipPlans }) => {
        if (this.shouldSwitchToDemoTenant({ clients, staff, services, products, branches })) {
          this.fallbackTried = true;
          this.fallbackNotice = true;
          this.appState.setTenant('tenant_aura');
          this.dataHint.set('Current POS catalog is empty. Loading the default catalog.');
          this.load();
          return;
        }
        const clientsWithWallet = this.withWalletBalances(clients || [], walletTransactions || []);
        const clientsWithBalances = this.withUnpaidBalances(clientsWithWallet, invoices || []);
        this.invoices.set(invoices || []);
        this.clients.set(clientsWithBalances);
        this.applyStaffRows(staff || [], branches || []);
        this.services.set(services || []);
        this.products.set(products || []);
        this.branches.set(branches || []);
        this.appointments.set(appointments || []);
        this.memberships.set(memberships || []);
        this.rebuildClientSearchIndex();
        this.refreshClientSearchResults();
        const packageRows = packages?.length ? packages : packagesAllBranches || [];
        this.packages.set(packageRows);
        const livePlans = (membershipPlans || []).map((plan) => this.normalizeMembershipPlan(plan as PosMembershipPlan));
        if (livePlans.length) {
          this.membershipPlans.set(livePlans);
          this.posSettings.saveMembershipPlans(livePlans);
        }
        this.applyDefaultBranch(branches || []);
        this.reloadStaffIfBranchScopeChanged(staff || []);
        this.setDataHint({ clients, staff, services, products, branches });
        const hadPendingHold = !!this.pendingHoldId;
        this.restorePendingHold();
        if (!hadPendingHold) this.restoreActiveBillingDraft();
        this.applyRouteClientSelection(clientsWithBalances);
        this.loading.set(false);
        this.focusInitialDirectInvoiceField();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load POS data');
        this.loading.set(false);
      }
    });
  }

  loadPosSettings(): void {
    this.applyPaymentModes(this.posSettings.loadPaymentModes());
    this.tipPresets.set(this.posSettings.loadTipPresets());
    this.membershipPlans.set(this.posSettings.loadMembershipPlans());
    this.posSettings.loadPaymentModesRemote().subscribe((modes) => this.applyPaymentModes(modes));
  }

  private applyPaymentModes(paymentModes: PosPaymentMode[]): void {
    const modes = paymentModes.filter((mode) => mode.active);
    this.paymentModes.set(modes);
    const nextPayments: Record<string, number> = {};
    for (const mode of modes) {
      nextPayments[mode.id] = Number(this.payments[mode.id] || 0);
    }
    this.payments = nextPayments;
    this.tipDraft.paymentMode = modes[0]?.id || 'cash';
  }

  private applyRouteClientSelection(clients: ApiRecord[]): void {
    if (this.currentHoldId) {
      return;
    }
    const params = this.route.snapshot.queryParamMap;
    const appointmentId = params.get('appointmentId') || '';
    if (appointmentId) {
      if (this.appointmentAlreadyBilled(appointmentId)) {
        this.blockBilledRouteAppointment(appointmentId);
        return;
      }
      this.api.list<ApiRecord>(`enterprise-scheduler/appointments/${appointmentId}/billing-status`).subscribe({
        next: (status) => {
          if (status?.['billed'] || status?.['billingLocked']) {
            this.blockBilledRouteAppointment(appointmentId, String(status?.['invoiceNumber'] || ''));
            return;
          }
          this.applyRouteAppointmentSelection(appointmentId, clients);
        },
        error: () => this.applyRouteAppointmentSelection(appointmentId, clients)
      });
      return;
    }
    if (this.form.value.clientId) {
      return;
    }
    const clientId = params.get('clientId') || '';
    const queryPhone = this.phoneDigits(params.get('q') || '');
    if (!clientId && !queryPhone) {
      return;
    }
    const target = clients.find((client) => clientId && String(client.id) === clientId)
      || clients.find((client) => queryPhone && this.clientPhoneDigits(client) === queryPhone);
    if (!target) {
      return;
    }

    this.selectClient(target);
    const receiveDue = Number(params.get('receiveDue') || 0);
    if (receiveDue > 0) {
      this.setUnpaidReceiveAmount(receiveDue);
    }
  }

  private blockBilledRouteAppointment(appointmentId: string, invoiceNumber = ''): void {
    this.items.set([]);
    this.bookingAdvanceInfo.set(null);
    this.bookingAdvanceLoading.set(false);
    this.bookingAdvanceAppliedAmount.set(0);
    this.selectedClientId.set('');
    this.form.patchValue({ clientId: '', staffId: '', appointmentId: '', invoiceDate: this.todayDateInput() }, { emitEvent: false });
    const invoiceText = invoiceNumber ? ` Invoice ${invoiceNumber} already exists.` : '';
    this.dataHint.set(`Appointment ${appointmentId} is already billed.${invoiceText} POS will not reopen it.`);
    void this.router.navigate(['/appointments'], { replaceUrl: true });
  }

  private applyRouteAppointmentSelection(appointmentId: string, clients: ApiRecord[]): boolean {
    const appointment = this.appointments().find((item) => String(item.id || '') === appointmentId);
    if (!appointment) return false;
    if (this.appointmentAlreadyBilled(appointmentId)) {
      this.blockBilledRouteAppointment(appointmentId);
      return true;
    }
    const clientId = String(appointment.clientId || '');
    const client = clients.find((item) => String(item.id || '') === clientId);
    if (client) {
      this.selectClient(client);
    } else {
      this.selectedClientId.set(clientId);
      this.form.patchValue({ clientId }, { emitEvent: false });
      this.clientSearchText = clientId;
    }
    const staffId = String(appointment.staffId || '');
    const staff = this.staff().find((person) => String(person.id || '') === staffId);
    if (staff) {
      this.selectStaff(staff);
    } else {
      this.form.patchValue({ staffId }, { emitEvent: false });
      this.staffSearchText = staffId;
    }
    this.form.patchValue({ appointmentId }, { emitEvent: false });
    this.resetCounterPayments();
    this.tips.set([]);
    this.items.set([]);
    const routeAppointments = this.routeAppointmentRows(appointment);
    const explicitServiceIds = this.routeIdList(this.route.snapshot.queryParamMap.get('serviceIds') || '');
    if (routeAppointments.length > 1 || !explicitServiceIds.length) {
      for (const row of routeAppointments) {
        for (const serviceId of this.appointmentServiceIds(row)) {
          this.addService(serviceId, String(row.staffId || staffId));
        }
      }
    } else {
      for (const serviceId of explicitServiceIds) {
        this.addService(serviceId, staffId);
      }
    }
    this.serviceSearchText = '';
    this.selectedServiceIds = [];
    this.loadBookingAdvanceSuggestion(appointmentId);
    this.dataHint.set(`Appointment ${appointmentId} loaded in POS with ${this.items().length} service line(s).`);
    return true;
  }

  activePaymentModes(): PosPaymentMode[] {
    return this.paymentModes().filter((mode) => mode.active).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }

  activeTipPresets(): PosTipPreset[] {
    return this.tipPresets().filter((preset) => preset.active);
  }

  activeMembershipPlans(): PosMembershipPlan[] {
    return this.membershipPlans().filter((plan) => plan.active);
  }

  paymentAmount(modeId: string): number {
    return Number(this.payments[modeId] || 0);
  }

  setPaymentAmount(modeId: string, value: number | string): void {
    const rawAmount = this.money(Number(value || 0));
    const amount = modeId === 'wallet' ? Math.min(rawAmount, this.walletBalance) : rawAmount;
    this.payments = { ...this.payments, [modeId]: this.money(amount) };
    this.walletCreditRequested.set(false);
  }

  fillPaymentDue(modeId: string): void {
    if (this.paymentAmount(modeId) > 0 || this.balanceDue <= 0) return;
    const amount = modeId === 'wallet' ? this.redeemableWalletAmount : this.balanceDue;
    if (amount > 0) this.setPaymentAmount(modeId, amount);
  }

  paymentHint(modeId: string): string {
    const amount = this.paymentAmount(modeId);
    if (amount > 0) return `â‚¹${amount} applied`;
    if (modeId === 'wallet' && this.walletBalance > 0) return `redeem â‚¹${this.redeemableWalletAmount}`;
    if (modeId === 'wallet') return 'wallet â‚¹0';
    if (this.balanceDue > 0) return `click â‚¹${this.balanceDue}`;
    return 'settled';
  }

  paymentModeLabel(modeId: string): string {
    if (modeId === 'booking_advance') return 'Booking advance';
    return this.paymentModes().find((mode) => mode.id === modeId)?.label || modeId;
  }

  private resetCounterPayments(): void {
    this.payments = Object.fromEntries(this.activePaymentModes().map((mode) => [mode.id, 0]));
    this.walletCreditRequested.set(false);
  }

  bookingAdvancePaidAmount(): number {
    const info = this.bookingAdvanceInfo() || {};
    const status = String(info['status'] || '').toLowerCase();
    const amount = this.money(Number(info['amount'] || 0));
    return status === 'paid' ? amount : 0;
  }

  appliedBookingAdvanceAmount(): number {
    return this.money(Math.min(this.total, Number(this.bookingAdvanceAppliedAmount() || 0)));
  }

  applyBookingAdvanceSuggestion(): void {
    const amount = this.bookingAdvancePaidAmount();
    if (amount <= 0) return;
    this.bookingAdvanceAppliedAmount.set(this.money(Math.min(this.total, amount)));
    this.walletCreditRequested.set(false);
    const remaining = this.money(Math.max(0, this.total - this.appliedBookingAdvanceAmount()));
    this.dataHint.set(`Booking advance â‚¹${this.appliedBookingAdvanceAmount()} applied. Collect remaining â‚¹${remaining}.`);
  }

  removeBookingAdvanceSuggestion(): void {
    if (this.appliedBookingAdvanceAmount() <= 0) return;
    this.bookingAdvanceAppliedAmount.set(0);
    this.dataHint.set('Booking advance removed. Invoice payment is back to normal collection.');
  }

  handleWalletButton(): void {
    if (this.overPaid > 0) {
      this.walletCreditRequested.set(true);
      return;
    }
    this.redeemWalletBalance();
  }

  redeemWalletBalance(): void {
    if (this.redeemableWalletAmount <= 0) return;
    this.setPaymentAmount('wallet', this.redeemableWalletAmount);
  }

  addTip(): void {
    const amount = this.money(this.tipDraft.amount);
    const staffId = this.tipDraft.staffId || String(this.form.value.staffId || '');
    const staffName = this.staff().find((person) => person.id === staffId)?.name || '';
    if (!staffId || !staffName) {
      this.tipMessage.set('Select staff before adding a tip.');
      return;
    }
    if (amount <= 0) {
      this.tipMessage.set('Tip amount must be greater than 0.');
      return;
    }
    const mode = this.tipDraft.paymentMode || this.activePaymentModes()[0]?.id || 'cash';
    this.tips.update((tips) => [
      ...tips,
      {
        id: `tip_${Date.now()}_${tips.length}`,
        staffId,
        staffName,
        paymentMode: mode,
        amount,
        note: this.tipDraft.note || ''
      }
    ]);
    this.tipDraft = { staffId: '', paymentMode: mode, amount: 0, note: '' };
    this.tipMessage.set('');
  }

  removeTip(index: number): void {
    this.tips.update((tips) => tips.filter((_, itemIndex) => itemIndex !== index));
  }

  holdInvoice(): void {
    if (!this.items().length) {
      this.error.set('Add at least one service, product, membership, package or gift card before holding the invoice.');
      return;
    }
    const draft = this.buildHeldInvoiceDraft();
    this.posSettings.upsertHeldInvoice(draft);
    this.posSettings.clearActiveBillingDraft();
    this.dataHint.set(`Invoice held: ${draft.title}. You can resume it from Held invoices.`);
    this.resetDraftAfterHold();
  }

  filteredClients(): ApiRecord[] {
    return this.clientSearchResults();
  }

  clientResultActive(client: ApiRecord): boolean {
    return this.clientSearchResults()[this.activeClientResultIndex()]?.id === client.id;
  }

  private recentClients(clients: ApiRecord[]): ApiRecord[] {
    return [...clients]
      .sort((a, b) => this.dateMs(b.lastVisitAt || b.lastInvoiceAt || b.updatedAt || b.createdAt) - this.dateMs(a.lastVisitAt || a.lastInvoiceAt || a.updatedAt || a.createdAt))
      .slice(0, 20);
  }

  private refreshClientSearchResults(): void {
    const query = this.normalizeSearch(this.debouncedClientQuery());
    const clients = this.clients();
    const queryDigits = this.phoneDigits(query);
    const results = !query
      ? this.recentClients(clients)
      : query.length < 2 && queryDigits.length < 2
        ? this.recentClients(clients)
      : clients
        .filter((client) => this.clientMatchesSearchQuery(client, query))
        .sort((a, b) => this.clientSearchScore(b, query) - this.clientSearchScore(a, query))
        .slice(0, 12);
    this.clientSearchResults.set(results);
    this.activeClientResultIndex.set(Math.min(this.activeClientResultIndex(), Math.max(0, results.length - 1)));
  }

  private refreshRemoteClientSearchResults(rawQuery: string): void {
    const query = this.normalizeSearch(rawQuery);
    const queryDigits = this.phoneDigits(rawQuery);
    if (query.length < 2 && queryDigits.length < 2) return;
    const requestId = ++this.clientSearchRequestId;
    this.api.list<ApiRecord[]>('clients', { limit: 50, q: rawQuery.trim(), includeAllBranches: true }).pipe(
      catchError(() => of([] as ApiRecord[]))
    ).subscribe((rows) => {
      if (requestId !== this.clientSearchRequestId) return;
      const remoteRows = rows || [];
      if (!remoteRows.length) return;
      const existing = this.clients();
      const existingIds = new Set(existing.map((client) => String(client.id || '')));
      const additions = remoteRows.filter((client) => !existingIds.has(String(client.id || '')));
      if (additions.length) {
        this.clients.set(this.withUnpaidBalances([...existing, ...additions], this.invoices()));
        this.rebuildClientSearchIndex();
      }
      this.refreshClientSearchResults();
    });
  }

  private rebuildClientSearchIndex(): void {
    const phoneCounts = new Map<string, number>();
    const emailCounts = new Map<string, number>();
    for (const client of this.clients()) {
      const phone = this.clientPhoneDigits(client);
      const email = this.normalizeSearch(client.email || '');
      if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) || 0) + 1);
      if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
    }
    this.clientSearchIndex.clear();
    for (const client of this.clients()) {
      const id = String(client.id || '');
      const membershipIds = this.clientMembershipIds(client);
      const phone = this.clientPhoneDigits(client);
      const email = this.normalizeSearch(client.email || '');
      const codes = this.normalizeSearch([
        client.customerCode,
        client.clientCode,
        client.code,
        client.cardNumber,
        client.fileNo,
        ...membershipIds
      ].filter(Boolean).join(' '));
      const membershipBadge = this.buildClientMembershipBadge(id);
      this.clientSearchIndex.set(id, {
        haystack: this.clientSearchHaystack(client, membershipIds),
        phone,
        name: this.normalizeSearch(client.name || ''),
        email,
        codes,
        membershipIds,
        membershipBadge,
        membershipMeta: this.buildClientMembershipSearchSnapshot(client, id),
        duplicate: Boolean((phone && (phoneCounts.get(phone) || 0) > 1) || (email && (emailCounts.get(email) || 0) > 1))
      });
    }
  }

  private clientSearchHaystack(client: ApiRecord, membershipIds = this.clientMembershipIds(client)): string {
    return this.normalizeSearch([
      client.name,
      client.phone,
      client.mobile,
      client.whatsapp,
      client.contact,
      client.phoneNumber,
      client.mobileNumber,
      client.email,
      client.customerCode,
      client.clientCode,
      client.code,
      client.cardNumber,
      client.fileNo,
      client.membershipId,
      client.membershipCode,
      ...membershipIds
    ].filter(Boolean).join(' '));
  }

  private clientSearchScore(client: ApiRecord, query: string): number {
    const index = this.clientSearchIndex.get(String(client.id || ''));
    const phone = index?.phone || this.phoneDigits(this.clientPrimaryPhone(client));
    const queryDigits = this.phoneDigits(query);
    const name = index?.name || this.normalizeSearch(client.name || '');
    const email = index?.email || this.normalizeSearch(client.email || '');
    const codes = index?.codes || '';
    const compactQuery = this.compactSearch(query);
    const compactName = this.compactSearch(name);
    const initials = this.compactSearch(this.clientNameInitials(client));
    let score = 0;
    if (queryDigits && phone === queryDigits) score += 140;
    if (queryDigits && phone.startsWith(queryDigits)) score += 110;
    if (name === query) score += 100;
    if (name.startsWith(query)) score += 80;
    if (compactQuery && compactName.startsWith(compactQuery)) score += 75;
    if (compactQuery && initials.startsWith(compactQuery)) score += 70;
    if (compactQuery && this.isWalkInAliasMatch(client, compactQuery)) score += 95;
    if (compactQuery && this.smartSearchMatch(name, compactQuery)) score += 55;
    if (codes.includes(query)) score += 60;
    if (email.includes(query)) score += 40;
    if (Number(client.unpaidBalance || 0) > 0) score += 4;
    if (Number(client.walletBalance || 0) > 0) score += 3;
    if (index?.membershipBadge) score += 2;
    return score;
  }

  private clientMatchesSearchQuery(client: ApiRecord, query: string): boolean {
    const index = this.clientSearchIndex.get(String(client.id || ''));
    const haystack = index?.haystack || this.clientSearchHaystack(client);
    const queryDigits = this.phoneDigits(query);
    if (queryDigits && (index?.phone || this.clientPhoneDigits(client)).includes(queryDigits)) return true;
    if (haystack.includes(query)) return true;

    const compactQuery = this.compactSearch(query);
    if (!compactQuery) return false;

    const compactHaystack = this.compactSearch(haystack);
    return compactHaystack.includes(compactQuery)
      || this.compactSearch(this.clientNameInitials(client)).startsWith(compactQuery)
      || this.isWalkInAliasMatch(client, compactQuery)
      || this.smartSearchMatch(haystack, compactQuery)
      || this.smartSearchMatch(client.name || '', compactQuery);
  }

  private clientNameInitials(client: ApiRecord): string {
    return this.normalizeSearch(client.name || '')
      .split(' ')
      .filter(Boolean)
      .map((part) => part.slice(0, 1))
      .join('');
  }

  private searchLettersExistInName(name: string, query: string): boolean {
    const letters = this.compactSearch(query).split('');
    if (!letters.length || letters.some((letter) => /\d/.test(letter))) return false;
    const counts = new Map<string, number>();
    for (const letter of this.compactSearch(name)) {
      counts.set(letter, (counts.get(letter) || 0) + 1);
    }
    return letters.every((letter) => {
      const next = (counts.get(letter) || 0) - 1;
      if (next < 0) return false;
      counts.set(letter, next);
      return true;
    });
  }

  private smartSearchMatch(value: unknown, query: string): boolean {
    const normalizedValue = this.normalizeSearch(value);
    const normalizedQuery = this.normalizeSearch(query);
    const compactValue = this.compactSearch(normalizedValue);
    const compactQuery = this.compactSearch(normalizedQuery);
    if (!compactQuery) return true;
    if (normalizedValue.includes(normalizedQuery) || compactValue.includes(compactQuery)) return true;
    const queryTokens = normalizedQuery.split(' ').filter(Boolean);
    if (queryTokens.length > 1 && queryTokens.every((token) => compactValue.includes(this.compactSearch(token)))) return true;
    if (compactQuery.length >= 3 && this.searchLettersExistInName(normalizedValue, compactQuery)) return true;
    return false;
  }

  private isWalkInAliasMatch(client: ApiRecord, compactQuery: string): boolean {
    if (compactQuery.length < 3) return false;
    const isWalkInQuery = ['wai', 'wak', 'walk', 'walki', 'walkin'].some((prefix) => compactQuery.startsWith(prefix));
    return isWalkInQuery && this.compactSearch(client.name || '').startsWith('walkin');
  }

  private clientMembershipIds(client: ApiRecord): string[] {
    const clientId = String(client.id || '');
    const direct = [client.membershipId, client.membershipCode].filter(Boolean).map(String);
    const linked = this.memberships()
      .filter((membership) => String(membership.clientId || membership.client_id || '') === clientId)
      .flatMap((membership) => [membership.id, membership.membershipId, membership.membershipCode, membership.memberCode, membership.planId])
      .filter(Boolean)
      .map(String);
    return Array.from(new Set([...direct, ...linked]));
  }

  private buildClientMembershipBadge(clientId: string): string {
    const active = this.activeMembershipForClientId(clientId);
    if (!active) return '';
    const days = this.membershipDaysLeft(active);
    if (days < 0) return 'Membership expired';
    return days <= 30 ? `Membership ${days}d left` : 'Membership active';
  }

  private buildClientMembershipSearchSnapshot(client: ApiRecord, clientId: string): string {
    const active = this.activeMembershipForClientId(clientId);
    const packageCount = this.activePackageCountForClientId(clientId);
    const walletBalance = Number(client.walletBalance || 0);
    if (!active && !packageCount) return `Wallet â‚¹${walletBalance} Â· No active benefits`;
    const packageLabel = packageCount ? ` Â· ${packageCount} package${packageCount === 1 ? '' : 's'}` : '';
    if (!active) return `Wallet â‚¹${walletBalance}${packageLabel}`;
    return `Wallet â‚¹${walletBalance} Â· ${active.planName || 'Membership'} Â· ${Number(active.creditsRemaining || 0)} credits${packageLabel}`;
  }

  filteredStaff(): ApiRecord[] {
    const query = this.normalizeSearch(this.staffSearchText);
    const staff = this.staff();
    if (!query) return staff.slice(0, 25);
    return staff
      .map((person, index) => ({ person, score: this.staffSearchScore(person, query, index) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.person)
      .slice(0, 25);
  }

  filteredServices(): ApiRecord[] {
    const query = this.normalizeSearch(this.serviceSearchText);
    if (!query) return this.services().slice(0, 25);
    return this.services()
      .filter((service) => this.smartSearchMatch(`${service.name || ''} ${service.category || ''} ${service.description || ''} ${service.code || ''}`, query))
      .slice(0, 25);
  }

  filteredProducts(): ApiRecord[] {
    const query = this.normalizeSearch(this.productSearchText);
    if (!query) return this.products().slice(0, 25);
    return this.products()
      .filter((product) => this.productMatchesSearchQuery(product, query))
      .sort((a, b) => this.productSearchScore(b, query) - this.productSearchScore(a, query))
      .slice(0, 25);
  }

  private productMatchesSearchQuery(product: ApiRecord, query: string): boolean {
    const haystack = this.normalizeSearch(`${product.name || ''} ${product.category || ''} ${product.brand || ''} ${product.sku || ''} ${product.barcode || ''}`);
    if (haystack.includes(query)) return true;
    const compactQuery = this.compactSearch(query);
    return Boolean(compactQuery)
      && (this.compactSearch(haystack).includes(compactQuery)
        || this.searchLettersExistInName(this.normalizeSearch(product.name || ''), query));
  }

  private productSearchScore(product: ApiRecord, query: string): number {
    const name = this.normalizeSearch(product.name || '');
    const haystack = this.normalizeSearch(`${product.name || ''} ${product.category || ''} ${product.brand || ''} ${product.sku || ''} ${product.barcode || ''}`);
    const compactQuery = this.compactSearch(query);
    let score = 0;
    if (name === query) score += 100;
    if (name.startsWith(query)) score += 80;
    if (compactQuery && this.compactSearch(name).startsWith(compactQuery)) score += 75;
    if (haystack.includes(query)) score += 45;
    if (this.searchLettersExistInName(name, query)) score += 30;
    if (Number(product.stock || 0) > 0) score += 2;
    return score;
  }

  showClientResults(): boolean {
    return this.clientSearchActive;
  }

  showStaffResults(): boolean {
    return this.staffSearchActive && this.filteredStaff().length > 0;
  }

  showServiceResults(): boolean {
    return this.serviceSearchActive && this.normalizeSearch(this.serviceSearchText).length > 0 && this.filteredServices().length > 0;
  }

  showProductResults(): boolean {
    return this.productSearchActive && this.normalizeSearch(this.productSearchText).length > 0 && this.filteredProducts().length > 0;
  }

  canCreateClientFromSearch(): boolean {
    const query = this.normalizeSearch(this.debouncedClientQuery());
    return query.length >= 3 && !this.form.value.clientId && this.clientSearchResults().length === 0;
  }

  clientOption(client: ApiRecord): string {
    return String(client.name || client.phone || client.email || client.id || 'Client');
  }

  clientInitial(client: ApiRecord): string {
    return String(client.name || client.phone || client.email || 'C').trim().slice(0, 1).toUpperCase() || 'C';
  }

  clientPrimaryPhone(client: ApiRecord): string {
    return String(client.phone || client.mobile || client.whatsapp || client.contact || client.phoneNumber || client.mobileNumber || '');
  }

  clientCallHref(client: ApiRecord): string {
    const phone = this.phoneDigits(this.clientPrimaryPhone(client));
    return phone ? `tel:${phone}` : '';
  }

  clientWhatsAppHref(client: ApiRecord): string {
    const phone = this.phoneDigits(this.clientPrimaryPhone(client));
    return phone ? `https://wa.me/91${phone.slice(-10)}` : '';
  }

  clientResultMeta(client: ApiRecord): string {
    const index = this.clientSearchIndex.get(String(client.id || ''));
    const email = client.email ? String(client.email) : '';
    const code = client.customerCode || client.clientCode || client.code || client.cardNumber || client.fileNo || '';
    const membership = (index?.membershipIds || []).join(', ');
    return [email, code ? `Code ${code}` : '', membership ? `Membership ${membership}` : index?.membershipMeta || this.clientMembershipSearchSnapshot(client)]
      .filter(Boolean)
      .join(' Â· ');
  }

  clientMembershipBadge(client: ApiRecord): string {
    return this.clientSearchIndex.get(String(client.id || ''))?.membershipBadge || '';
  }

  possibleDuplicateClient(client: ApiRecord): boolean {
    return Boolean(this.clientSearchIndex.get(String(client.id || ''))?.duplicate);
  }

  highlightSegments(value: unknown): HighlightSegment[] {
    const text = String(value || '');
    const query = String(this.debouncedClientQuery() || '').trim();
    if (!text || !query) return [{ text, match: false }];
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    if (index >= 0) {
      return [
        { text: text.slice(0, index), match: false },
        { text: text.slice(index, index + query.length), match: true },
        { text: text.slice(index + query.length), match: false }
      ].filter((segment) => segment.text);
    }

    return [{ text, match: false }];
  }

  staffOption(person: ApiRecord): string {
    return String(person.name || person.fullName || person.phone || person.mobile || person.id || 'Staff');
  }

  staffResultMeta(person: ApiRecord): string {
    const role = person.role || person.designation || person.specialization || person.department || 'Staff';
    const phone = person.phone || person.mobile || person.contact || person.phoneNumber || '';
    const branch = person.branchName || person.branch || '';
    const smartId = this.staffSmartIdLabel(person);
    return [smartId, role, phone, branch].filter(Boolean).join(' Â· ');
  }

  private staffSmartIdLabel(person: ApiRecord): string {
    const code = person.employeeCode || person.staffCode || person.code || person.id || '';
    return code ? `ID ${code}` : '';
  }

  private staffSearchScore(person: ApiRecord, query: string, index: number): number {
    const fields = this.staffSearchFields(person, index);
    const compactQuery = query.replace(/\s+/g, '');
    const digitQuery = this.phoneDigits(query);
    if (fields.some((field) => field === query || field.replace(/\s+/g, '') === compactQuery)) return 120;
    if (digitQuery && fields.some((field) => this.phoneDigits(field).includes(digitQuery))) return 110;
    if (fields.some((field) => field.startsWith(query) || field.replace(/\s+/g, '').startsWith(compactQuery))) return 95;
    if (fields.some((field) => field.includes(query) || field.replace(/\s+/g, '').includes(compactQuery))) return 80;
    if (fields.some((field) => this.smartSearchDistance(field, query) <= this.smartSearchTolerance(query))) return 54;
    return 0;
  }

  private staffSearchFields(person: ApiRecord, index: number): string[] {
    const name = String(person.name || person.fullName || '').trim();
    const words = name.split(/\s+/).filter(Boolean);
    const initials = words.map((word) => word[0]).join('');
    const numericAlias = String(index + 1);
    return [
      name,
      initials,
      person.fullName,
      person.phone,
      person.mobile,
      person.contact,
      person.phoneNumber,
      person.role,
      person.designation,
      person.specialization,
      person.department,
      person.employeeCode,
      person.staffCode,
      person.code,
      person.id,
      numericAlias,
      `id ${numericAlias}`,
      `staff ${numericAlias}`,
      `employee ${numericAlias}`
    ].map((field) => this.normalizeSearch(field)).filter(Boolean);
  }

  private smartSearchTolerance(query: string): number {
    if (query.length < 4) return 0;
    if (query.length < 7) return 1;
    return 2;
  }

  private smartSearchDistance(value: string, query: string): number {
    const target = value.split(/\s+/).find((part) => Math.abs(part.length - query.length) <= 2) || value;
    if (Math.abs(target.length - query.length) > 2) return 9;
    const previous = Array.from({ length: query.length + 1 }, (_, index) => index);
    for (let i = 1; i <= target.length; i += 1) {
      let diagonal = previous[0];
      previous[0] = i;
      for (let j = 1; j <= query.length; j += 1) {
        const temp = previous[j];
        previous[j] = target[i - 1] === query[j - 1]
          ? diagonal
          : Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + 1);
        diagonal = temp;
      }
    }
    return previous[query.length];
  }

  clientMembershipSearchSnapshot(client: ApiRecord): string {
    const active = this.activeMembershipForClientId(String(client.id || ''));
    const packageCount = this.activePackageCountForClientId(String(client.id || ''));
    const walletBalance = Number(client.walletBalance || 0);
    if (!active && !packageCount) return `Wallet â‚¹${walletBalance} Â· No active benefits`;
    const packageLabel = packageCount ? ` Â· ${packageCount} package${packageCount === 1 ? '' : 's'}` : '';
    if (!active) return `Wallet â‚¹${walletBalance}${packageLabel}`;
    return `Wallet â‚¹${walletBalance} Â· ${active.planName || 'Membership'} Â· ${Number(active.creditsRemaining || 0)} credits${packageLabel}`;
  }

  redeemableBenefits(): ApiRecord[] {
    const wallet = this.membershipEligibility()?.['wallet'] as ApiRecord | undefined;
    const rows = Array.isArray(wallet?.['memberships']) ? wallet['memberships'] as ApiRecord[] : [];
    const clientId = String(this.form.value.clientId || '');
    const activePackages = this.clientPackageRecords(clientId).filter((membership) => this.packageStatus(membership) === 'active');
    const cacheKey = [
      clientId,
      rows.map((benefit) => this.benefitCachePart(benefit)).join(';'),
      activePackages.map((benefit) => this.benefitCachePart(benefit)).join(';')
    ].join('|');
    if (cacheKey === this.redeemableBenefitsCacheKey) return this.redeemableBenefitsCache;
    const localPackages: ApiRecord[] = activePackages.map((membership) => ({
        ...membership,
        membershipId: membership.id,
        entitlementType: 'package',
        planName: membership.planName || this.packageDisplayName(membership)
      }));
    const byId = new Map<string, ApiRecord>();
    for (const benefit of [...rows, ...localPackages]) {
      const id = String(benefit['membershipId'] || benefit['id'] || '');
      if (!id || this.redeemableBenefitRemainingCredits(benefit) <= 0) continue;
      byId.set(id, { ...benefit, membershipId: id });
    }
    this.redeemableBenefitsCacheKey = cacheKey;
    this.redeemableBenefitsCache = [...byId.values()];
    return this.redeemableBenefitsCache;
  }

  private prepaidCreditLine(benefit?: ApiRecord): ApiRecord | undefined {
    const rows = this.benefitServiceCreditEntries(benefit);
    return rows.find((credit) => String(credit['type'] || '') === 'prepaid_credit');
  }

  private benefitServiceCreditEntries(benefit?: ApiRecord): ApiRecord[] {
    const direct = Array.isArray(benefit?.['serviceCredits']) ? benefit?.['serviceCredits'] as ApiRecord[] : [];
    const nestedMembership = benefit?.['membership'] as ApiRecord | undefined;
    const nested = Array.isArray(nestedMembership?.['serviceCredits']) ? nestedMembership?.['serviceCredits'] as ApiRecord[] : [];
    return [...direct, ...nested].filter((credit) => credit && typeof credit === 'object');
  }

  private benefitRulesFor(benefit?: ApiRecord): ApiRecord {
    const directRules = this.readJsonObject(benefit?.['benefitRules']) || {};
    const planBenefits = this.readJsonObject(benefit?.['planBenefits']) || {};
    const planRules = this.readJsonObject(planBenefits['benefitRules']) || {};
    const creditRules = this.readJsonObject(this.prepaidCreditLine(benefit)?.['benefitRules']) || {};
    return { ...planRules, ...creditRules, ...directRules };
  }

  private isPrepaidCreditBenefit(benefit?: ApiRecord): boolean {
    const rules = this.benefitRulesFor(benefit);
    return this.redeemableBenefitTypeLabel(benefit) === 'membership'
      && (String(rules['planType'] || '') === 'prepaid_credit' || rules['prepaidCredit'] === true || !!this.prepaidCreditLine(benefit));
  }

  private isCreditBenefit(benefit?: ApiRecord): boolean {
    const rules = this.benefitRulesFor(benefit);
    const planType = String(rules['planType'] || '');
    return this.isPrepaidCreditBenefit(benefit)
      || ['visit_pack', 'service_credit', 'combo', 'unlimited'].includes(planType)
      || this.redeemableBenefitTypeLabel(benefit) === 'package';
  }

  private isAutoServiceCreditBenefit(benefit?: ApiRecord): boolean {
    const rules = this.benefitRulesFor(benefit);
    const planType = String(rules['planType'] || '').toLowerCase();
    return ['visit_pack', 'service_credit', 'combo', 'unlimited'].includes(planType)
      || this.redeemableBenefitTypeLabel(benefit) === 'package';
  }

  private isUnlimitedBenefit(benefit?: ApiRecord): boolean {
    return String(this.benefitRulesFor(benefit)['planType'] || '').toLowerCase() === 'unlimited';
  }

  private membershipCreditAllowedForItem(item: SaleItem, benefit?: ApiRecord): boolean {
    const rules = this.benefitRulesFor(benefit);
    if (item.type === 'product') return Boolean(rules['allowProductRedeem']);
    if (item.type !== 'service' && item.type !== 'package_redeem') return false;
    const creditEntries = this.benefitServiceCreditEntries(benefit)
      .filter((credit) => !['bill_discount', 'product_discount', 'prepaid_credit'].includes(String(credit['type'] || '')));
    if (creditEntries.length && creditEntries.some((credit) => this.serviceCreditEntryMatchesItem(credit, item))) return true;
    const restriction = this.readJsonObject(rules['serviceRestriction']) || {};
    const type = String(restriction['type'] || 'all');
    const value = String(restriction['value'] || '').trim().toLowerCase();
    if (type === 'all' || !value) return true;
    const tokens = value.split(',').map((token) => token.trim()).filter(Boolean);
    const service = this.services().find((row) => String(row.id) === item.id);
    const haystack = `${item.id} ${item.name} ${service?.['category'] || ''} ${service?.['code'] || ''}`.toLowerCase();
    return tokens.some((token) => haystack.includes(token));
  }

  private serviceCreditEntryMatchesItem(credit: ApiRecord, item: SaleItem): boolean {
    const serviceId = String(credit['serviceId'] || credit['service_id'] || '').trim().toLowerCase();
    const serviceName = String(credit['serviceName'] || credit['service_name'] || credit['name'] || '').trim().toLowerCase();
    const category = String(credit['category'] || credit['serviceCategory'] || credit['service_category'] || '').trim().toLowerCase();
    const service = this.services().find((row) => String(row.id || '') === String(item.id || ''));
    const itemCategory = String(service?.['category'] || '').toLowerCase();
    if (!serviceId && !serviceName && !category) return true;
    if (serviceId && serviceId === String(item.id || '').toLowerCase()) return true;
    if (serviceName && String(item.name || '').toLowerCase().includes(serviceName)) return true;
    if (category && itemCategory.includes(category)) return true;
    return false;
  }

  membershipCreditRedeemCap(benefit: ApiRecord | undefined = this.selectedRedeemableBenefit()): number {
    if (!benefit) return 0;
    const remaining = this.selectedRedeemableBenefitRemainingCredits();
    if (!this.isCreditBenefit(benefit)) return remaining;
    const eligible = this.redeemableServiceLines(benefit).reduce((sum, line) => sum + this.money(line.finalAmount), 0);
    if (!this.isPrepaidCreditBenefit(benefit)) return Math.min(remaining, this.redeemableServiceLines(benefit).length || remaining);
    const rules = this.benefitRulesFor(benefit);
    const limit = this.readJsonObject(rules['perVisitLimit']) || {};
    const limitType = String(limit['type'] || 'none');
    const limitValue = Math.max(0, Number(limit['value'] || 0));
    const perVisitCap = limitType === 'fixed'
      ? limitValue
      : limitType === 'bill_percent' && limitValue > 0
        ? this.money(eligible * (limitValue / 100))
        : eligible;
    return this.money(Math.min(remaining, eligible, perVisitCap));
  }

  redeemableServiceLines(benefit: ApiRecord | undefined = this.selectedRedeemableBenefit()): RedeemableServiceLine[] {
    const serviceItems = this.items()
      .map((item, lineIndex) => ({ item, lineIndex }))
      .filter(({ item }) => item.type === 'service' || item.type === 'package_redeem' || (this.isCreditBenefit(benefit) && item.type === 'product'))
      .filter(({ item }) => !this.isCreditBenefit(benefit) || this.membershipCreditAllowedForItem(item, benefit));
    const cacheKey = serviceItems
      .map(({ item, lineIndex }) => `${benefit?.['membershipId'] || benefit?.['id'] || ''}:${lineIndex}:${item.type}:${item.id}:${item.name}:${item.staffName}:${item.quantity}:${item.price}:${item.discountValue}:${this.lineTotal(item)}`)
      .join('|');
    if (cacheKey === this.redeemableServiceLinesCacheKey) return this.redeemableServiceLinesCache;
    this.redeemableServiceLinesCacheKey = cacheKey;
    this.redeemableServiceLinesCache = serviceItems.map(({ item, lineIndex }) => ({
        lineIndex,
        serviceId: String(item.id || ''),
        serviceName: item.name || `Service ${lineIndex + 1}`,
        staffId: item.staffId || '',
        staffName: item.staffName || '',
        finalAmount: this.lineTotal(item)
      }));
    return this.redeemableServiceLinesCache;
  }

  private eligibleAutoCreditBenefits(): ApiRecord[] {
    return this.redeemableBenefits()
      .filter((benefit) => this.isAutoServiceCreditBenefit(benefit))
      .filter((benefit) => this.membershipCreditRedeemCap(benefit) > 0 && this.redeemableServiceLines(benefit).length > 0);
  }

  private autoSuggestMembershipRedemption(reason = ''): void {
    if (this.membershipId || this.creditsUsed > 0 || !this.form.value.clientId) return;
    const matches = this.eligibleAutoCreditBenefits();
    if (matches.length === 1) {
      const benefit = matches[0];
      this.membershipId = String(benefit['membershipId'] || benefit['id'] || '');
      this.creditsUsed = Math.min(this.membershipCreditRedeemCap(benefit), this.redeemableServiceLines(benefit).length || 1);
      this.autoAllocateBenefitCredits();
      this.applyMembershipDiscountsToEligibleItems();
      const name = benefit['businessLabel'] || benefit['planName'] || benefit['name'] || 'membership benefit';
      this.dataHint.set(`${name} auto-applied${reason ? ` for ${reason}` : ''}.`);
      return;
    }
    if (matches.length > 1) {
      this.dataHint.set(`${matches.length} membership benefits match this bill. Select the benefit before saving.`);
    }
  }

  membershipRedemptionPanelTitle(): string {
    const selected = this.selectedRedeemableBenefit();
    if (selected) return 'Membership credit applied';
    const matches = this.eligibleAutoCreditBenefits();
    if (matches.length > 1) return 'Multiple membership benefits matched';
    if (matches.length === 1) return 'Membership benefit ready';
    return 'Membership redemption';
  }

  membershipRedemptionPanelSummary(): string {
    const selected = this.selectedRedeemableBenefit();
    if (selected) {
      const name = String(selected['businessLabel'] || selected['planName'] || selected['name'] || 'Selected benefit');
      const amount = this.membershipCreditAdjustmentAmount();
      const mappings = this.selectedBenefitServiceMappings().length;
      const creditLabel = this.isUnlimitedBenefit(selected) ? 'unlimited use' : `${Number(this.creditsUsed || 0)} credit${Number(this.creditsUsed || 0) === 1 ? '' : 's'}`;
      return `${name}: ${creditLabel} mapped to ${mappings} line${mappings === 1 ? '' : 's'}${amount > 0 ? `, bill adjusted â‚¹${amount.toLocaleString('en-IN')}` : ''}.`;
    }
    const matches = this.eligibleAutoCreditBenefits();
    if (matches.length === 1) {
      const benefit = matches[0];
      return `${benefit['businessLabel'] || benefit['planName'] || benefit['name'] || 'Benefit'} can cover matching service lines.`;
    }
    if (matches.length > 1) return 'Select one benefit so credits are not deducted from the wrong membership/package.';
    return 'No matching service credit is selected for this bill.';
  }

  membershipRedemptionConflictReason(): string {
    if (this.membershipId) return '';
    const matches = this.eligibleAutoCreditBenefits();
    return matches.length > 1 ? `${matches.length} benefits match this service. Manual selection required.` : '';
  }

  membershipLineBenefitState(item: SaleItem, index: number): MembershipLineBenefitState {
    const mappedCredits = this.serviceLineMappedCredits(index);
    const selected = this.selectedRedeemableBenefit();
    if (selected && mappedCredits > 0) {
      return {
        status: this.isUnlimitedBenefit(selected) ? 'unlimited' : 'credit',
        label: this.isUnlimitedBenefit(selected) ? 'Unlimited covered' : 'Credit covered',
        detail: `${mappedCredits} credit${mappedCredits === 1 ? '' : 's'}`
      };
    }
    if (item.discountSource === 'membership') {
      return {
        status: 'discount',
        label: 'Membership discount',
        detail: `${this.lineDiscountAmount(item).toLocaleString('en-IN')} off`
      };
    }
    const matches = this.redeemableBenefits()
      .filter((benefit) => this.isAutoServiceCreditBenefit(benefit))
      .filter((benefit) => this.membershipCreditAllowedForItem(item, benefit));
    if (matches.length) {
      return {
        status: 'eligible',
        label: matches.length === 1 ? 'Credit eligible' : 'Multiple credits',
        detail: matches.length === 1 ? String(matches[0]['businessLabel'] || matches[0]['planName'] || matches[0]['name'] || '') : 'select benefit'
      };
    }
    return { status: 'none', label: '', detail: '' };
  }

  private benefitCachePart(benefit: ApiRecord): string {
    return [
      benefit['membershipId'] || benefit['id'] || '',
      benefit['planName'] || benefit['name'] || '',
      benefit['expiryDate'] || benefit['validityDate'] || '',
      benefit['status'] || '',
      this.redeemableBenefitRemainingCredits(benefit)
    ].join(':');
  }

  selectedRedeemableBenefit(): ApiRecord | undefined {
    const benefitId = String(this.membershipId || '');
    if (!benefitId) return undefined;
    return this.redeemableBenefits().find((benefit) => String(benefit['membershipId'] || benefit['id'] || '') === benefitId);
  }

  redeemableBenefitRemainingCredits(benefit?: ApiRecord): number {
    const serviceCredits = benefit?.['serviceCredits'];
    if (Array.isArray(serviceCredits)) {
      return Math.max(0, serviceCredits.reduce((sum, credit: ApiRecord) =>
        sum + Number(credit.remaining ?? credit.creditsRemaining ?? credit.credits_remaining ?? credit.credits ?? credit.quantity ?? 0), 0));
    }
    if (serviceCredits && typeof serviceCredits === 'object') {
      return Math.max(0, Number((serviceCredits as ApiRecord)['remaining'] || (serviceCredits as ApiRecord)['creditsRemaining'] || 0));
    }
    return Math.max(0, Number(benefit?.['creditsRemaining'] ?? benefit?.['credits_remaining'] ?? 0));
  }

  redeemableBenefitTypeLabel(benefit?: ApiRecord): string {
    return this.membershipBenefitType(benefit) === 'package' ? 'package' : 'membership';
  }

  redeemableBenefitOption(benefit: ApiRecord): string {
    const remaining = this.redeemableBenefitRemainingCredits(benefit);
    const expiry = benefit['expiryDate'] ? ` Â· exp ${String(benefit['expiryDate']).slice(0, 10)}` : '';
    const rules = this.benefitRulesFor(benefit);
    const planType = String(rules['planType'] || this.redeemableBenefitTypeLabel(benefit));
    const label = benefit['businessLabel'] || this.membershipBusinessLabel({
      name: String(benefit['planName'] || benefit['name'] || benefit['membershipId'] || 'Benefit'),
      price: 0,
      discountPercent: 0,
      benefitRules: rules,
      validityDays: 0,
      active: true,
      createdAt: ''
    } as PosMembershipPlan);
    return `${planType.replace('_', ' ')} Â· ${label} Â· ${remaining} credits${expiry}`;
  }

  membershipEligibilityNotes(): string[] {
    const wallet = (this.membershipEligibility()?.['wallet'] || {}) as ApiRecord;
    const notes: string[] = [];
    if (wallet['businessLabel']) notes.push(`Active benefit: ${wallet['businessLabel']}`);
    const fairUsage = Array.isArray(wallet['fairUsage']) ? wallet['fairUsage'] as ApiRecord[] : [];
    for (const item of fairUsage.slice(0, 2)) {
      notes.push(`Fair usage ${item['planName'] || ''}: ${item['monthlyUsed'] || 0}/${item['monthlyCap'] || 0} used this month.`);
    }
    const family = wallet['familySharing'] as ApiRecord | undefined;
    if (family?.['status'] === 'shared') notes.push(`Family shared benefits active (${family['activeLinks'] || 0} link).`);
    const corporate = Array.isArray(wallet['corporate']) ? wallet['corporate'] as ApiRecord[] : [];
    if (corporate[0]?.['label']) notes.push(`Corporate rule: ${corporate[0]['label']}${corporate[0]['employeeIdRequired'] ? ' employee ID required' : ''}.`);
    const occasions = Array.isArray(wallet['occasionBenefits']) ? wallet['occasionBenefits'] as ApiRecord[] : [];
    if (occasions.some((item) => item['birthday'] || item['anniversary'])) notes.push('Birthday/anniversary membership benefit configured.');
    const tiers = Array.isArray(wallet['tierSuggestions']) ? wallet['tierSuggestions'] as ApiRecord[] : [];
    if (tiers[0]?.['eligible']) notes.push(`Tier upgrade ready: ${tiers[0]['tierName'] || 'next tier'}.`);
    return notes.slice(0, 5);
  }

  selectRedeemableBenefit(value: string): void {
    this.membershipId = String(value || '');
    if (!this.membershipId) {
      this.creditsUsed = 0;
      this.benefitServiceMappings = [];
      return;
    }
    const remaining = this.selectedRedeemableBenefitRemainingCredits();
    if (this.creditsUsed <= 0) {
      this.creditsUsed = 0;
      return;
    }
    this.creditsUsed = Math.min(this.creditsUsed, this.membershipCreditRedeemCap(this.selectedRedeemableBenefit()), remaining);
    this.normalizeBenefitServiceMappings();
  }

  setRedeemableCredits(value: number | string): void {
    const requested = Math.max(0, Math.floor(Number(value || 0)));
    const remaining = this.selectedRedeemableBenefitRemainingCredits();
    const benefit = this.selectedRedeemableBenefit();
    const cap = this.isPrepaidCreditBenefit(benefit) ? this.membershipCreditRedeemCap(benefit) : remaining;
    this.creditsUsed = remaining > 0 ? Math.min(requested, cap) : 0;
    this.normalizeBenefitServiceMappings();
  }

  selectedRedeemableBenefitRemainingCredits(): number {
    return this.redeemableBenefitRemainingCredits(this.selectedRedeemableBenefit());
  }

  useAllRedeemableCredits(): void {
    const benefit = this.selectedRedeemableBenefit();
    this.creditsUsed = this.isPrepaidCreditBenefit(benefit) ? this.membershipCreditRedeemCap(benefit) : this.selectedRedeemableBenefitRemainingCredits();
    this.autoAllocateBenefitCredits();
  }

  selectedBenefitServiceMappings(): BenefitServiceMapping[] {
    const cacheKey = this.benefitServiceMappings
      .map((mapping) => `${mapping.lineIndex}:${mapping.serviceId}:${mapping.serviceName}:${mapping.credits}`)
      .join('|');
    if (cacheKey === this.selectedBenefitMappingsCacheKey) return this.selectedBenefitMappingsCache;
    this.selectedBenefitMappingsCacheKey = cacheKey;
    this.selectedBenefitMappingsCache = this.benefitServiceMappings.filter((mapping) => Number(mapping.credits || 0) > 0);
    return this.selectedBenefitMappingsCache;
  }

  serviceLineMappedCredits(lineIndex: number): number {
    return Number(this.benefitServiceMappings.find((mapping) => mapping.lineIndex === lineIndex)?.credits || 0);
  }

  maxServiceLineMappedCredits(lineIndex: number): number {
    const current = this.serviceLineMappedCredits(lineIndex);
    const line = this.redeemableServiceLines().find((item) => item.lineIndex === lineIndex);
    const others = this.selectedBenefitServiceMappings()
      .filter((mapping) => mapping.lineIndex !== lineIndex)
      .reduce((sum, mapping) => sum + Number(mapping.credits || 0), 0);
    return Math.max(current, Math.min(this.creditsUsed - others, this.isPrepaidCreditBenefit(this.selectedRedeemableBenefit()) ? Math.floor(line?.finalAmount || 0) : this.creditsUsed));
  }

  setServiceLineMappedCredits(lineIndex: number, value: number | string): void {
    const requested = Math.max(0, Math.floor(Number(value || 0)));
    const serviceLine = this.redeemableServiceLines().find((line) => line.lineIndex === lineIndex);
    if (!serviceLine) return;
    const next = this.selectedBenefitServiceMappings().filter((mapping) => mapping.lineIndex !== lineIndex);
    const remaining = Math.max(0, this.creditsUsed - next.reduce((sum, mapping) => sum + Number(mapping.credits || 0), 0));
    const benefit = this.selectedRedeemableBenefit();
    const lineCap = this.isPrepaidCreditBenefit(benefit) ? Math.floor(serviceLine.finalAmount || 0) : remaining;
    const credits = Math.min(requested, remaining, lineCap);
    if (credits > 0) {
      next.push({
        lineIndex,
        serviceId: serviceLine.serviceId,
        serviceName: serviceLine.serviceName,
        staffId: serviceLine.staffId,
        staffName: serviceLine.staffName,
        credits
      });
    }
    this.benefitServiceMappings = next.sort((left, right) => left.lineIndex - right.lineIndex);
  }

  allocatedBenefitCredits(): number {
    return this.selectedBenefitServiceMappings().reduce((sum, mapping) => sum + Number(mapping.credits || 0), 0);
  }

  unallocatedBenefitCredits(): number {
    return Math.max(0, Number(this.creditsUsed || 0) - this.allocatedBenefitCredits());
  }

  benefitRemainingAfterRedeem(): number {
    return Math.max(0, this.selectedRedeemableBenefitRemainingCredits() - Number(this.creditsUsed || 0));
  }

  autoAllocateBenefitCredits(): void {
    const serviceLines = this.redeemableServiceLines();
    if (!serviceLines.length || this.creditsUsed <= 0) {
      this.benefitServiceMappings = [];
      return;
    }
    let remaining = Number(this.creditsUsed || 0);
    const benefit = this.selectedRedeemableBenefit();
    const next: BenefitServiceMapping[] = [];
    for (const line of serviceLines) {
      if (remaining <= 0) break;
      const lineCap = this.isPrepaidCreditBenefit(benefit) ? Math.floor(line.finalAmount || 0) : remaining;
      const credits = Math.min(Math.floor(remaining), lineCap);
      if (credits <= 0) continue;
      next.push({
        lineIndex: line.lineIndex,
        serviceId: line.serviceId,
        serviceName: line.serviceName,
        staffId: line.staffId,
        staffName: line.staffName,
        credits
      });
      remaining -= credits;
    }
    this.benefitServiceMappings = next;
  }

  generatedBenefitRedeemLabel(benefitRedeem: ApiRecord): string {
    return String(benefitRedeem['benefitName'] || benefitRedeem['planName'] || benefitRedeem['membershipName'] || benefitRedeem['membershipId'] || 'Benefit');
  }

  generatedBenefitRedeemCredits(benefitRedeem: ApiRecord): string {
    return `${Number(benefitRedeem['creditsUsed'] || 0)} credits`;
  }

  generatedBenefitRedeemBalance(benefitRedeem: ApiRecord): string {
    return `${Number(benefitRedeem['remainingAfterRedeem'] || 0)} credits`;
  }

  generatedBenefitServiceMappings(benefitRedeem: ApiRecord): BenefitServiceMapping[] {
    const rows = Array.isArray(benefitRedeem['serviceLineMappings']) ? benefitRedeem['serviceLineMappings'] as BenefitServiceMapping[] : [];
    return rows.filter((mapping) => Number(mapping.credits || 0) > 0);
  }

  private readJsonObject(value: unknown): ApiRecord | null {
    if (!value) return null;
    if (typeof value === 'object') return value as ApiRecord;
    try {
      return JSON.parse(String(value));
    } catch {
      return null;
    }
  }

  private readJsonArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
      const parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private normalizeBenefitServiceMappings(): void {
    const validLines = new Map(this.redeemableServiceLines().map((line) => [line.lineIndex, line]));
    if (!this.membershipId || this.creditsUsed <= 0 || !validLines.size) {
      this.benefitServiceMappings = [];
      return;
    }
    let remaining = Number(this.creditsUsed || 0);
    const next: BenefitServiceMapping[] = [];
    const benefit = this.selectedRedeemableBenefit();
    for (const mapping of this.selectedBenefitServiceMappings().sort((left, right) => left.lineIndex - right.lineIndex)) {
      const line = validLines.get(mapping.lineIndex);
      if (!line || remaining <= 0) continue;
      const lineCap = this.isPrepaidCreditBenefit(benefit) ? Math.floor(line.finalAmount || 0) : remaining;
      const credits = Math.min(Math.max(0, Math.floor(Number(mapping.credits || 0))), remaining, lineCap);
      if (credits <= 0) continue;
      next.push({
        lineIndex: mapping.lineIndex,
        serviceId: line.serviceId,
        serviceName: line.serviceName,
        staffId: line.staffId,
        staffName: line.staffName,
        credits
      });
      remaining -= credits;
    }
    this.benefitServiceMappings = next;
  }

  private invoiceClientId(invoice: ApiRecord): string {
    return String(invoice.clientId || invoice.client_id || invoice.customerId || invoice.customer_id || '');
  }

  private phoneDigits(value: unknown): string {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  private clientPhoneDigits(client: ApiRecord | undefined): string {
    if (!client) {
      return '';
    }
    return this.phoneDigits(client.phone || client.mobile || client.whatsapp || client.contact || client.phoneNumber || client.mobileNumber || '');
  }

  private invoicePhoneDigits(invoice: ApiRecord): string {
    return this.phoneDigits(
      invoice.clientPhone ||
        invoice.customerPhone ||
        invoice.phone ||
        invoice.mobile ||
        invoice.customerMobile ||
        invoice.clientMobile ||
        ''
    );
  }

  private invoiceKey(invoice: ApiRecord): string {
    return String(invoice.id || invoice.invoiceId || invoice.invoice_id || invoice.invoiceNumber || invoice.invoice_no || invoice.createdAt || invoice.created_at || 'invoice');
  }

  private invoiceBalance(invoice: ApiRecord): number {
    const direct = invoice.balance ?? invoice.balanceDue ?? invoice.dueAmount ?? invoice.due_amount ?? invoice.due;
    if (direct !== undefined && direct !== null && direct !== '') {
      return Math.max(0, this.money(Number(direct)));
    }
    const total = Number(invoice.grandTotal ?? invoice.grand_total ?? invoice.total ?? 0);
    const paid = Number(invoice.paidAmount ?? invoice.paid_amount ?? invoice.paid ?? 0);
    return Math.max(0, this.money(total - paid));
  }

  private invoiceDateMs(invoice: ApiRecord): number {
    return this.dateMs(invoice.createdAt || invoice.created_at || invoice.date || invoice.updatedAt || invoice.updated_at);
  }

  private unpaidInvoicesForSelectedClient(): Array<ApiRecord & { __balance: number }> {
    const clientId = String(this.form.value.clientId || '');
    const selected = this.selectedClient();
    if (!clientId || !selected) {
      return [];
    }
    const selectedPhone = this.clientPhoneDigits(selected);
    const matchingClientIds = new Set(
      this.clients()
        .filter((client) => String(client.id) === clientId || (!!selectedPhone && this.clientPhoneDigits(client) === selectedPhone))
        .map((client) => String(client.id))
    );
    return this.invoices()
      .map((invoice) => ({ ...invoice, __balance: this.invoiceBalance(invoice) }))
      .filter((invoice) => {
        if (invoice.__balance <= 0) {
          return false;
        }
        const invoiceClientId = this.invoiceClientId(invoice);
        if (invoiceClientId && matchingClientIds.has(invoiceClientId)) {
          return true;
        }
        return !!selectedPhone && this.invoicePhoneDigits(invoice) === selectedPhone;
      })
      .sort((a, b) => this.invoiceDateMs(a) - this.invoiceDateMs(b));
  }

  private withUnpaidBalances(clients: ApiRecord[], invoices: ApiRecord[]): ApiRecord[] {
    const clientsById = new Map(clients.map((client) => [String(client.id), client]));
    const idsByPhone = new Map<string, string[]>();
    for (const client of clients) {
      const phone = this.clientPhoneDigits(client);
      if (!phone) {
        continue;
      }
      idsByPhone.set(phone, [...(idsByPhone.get(phone) || []), String(client.id)]);
    }

    const unpaidByClient = new Map<string, Map<string, number>>();
    const addInvoiceBalance = (clientId: string, invoiceKey: string, balance: number) => {
      if (!clientId || balance <= 0) {
        return;
      }
      const ledger = unpaidByClient.get(clientId) || new Map<string, number>();
      ledger.set(invoiceKey, balance);
      unpaidByClient.set(clientId, ledger);
    };

    for (const invoice of invoices) {
      const clientId = this.invoiceClientId(invoice);
      const balance = this.invoiceBalance(invoice);
      if (balance <= 0) {
        continue;
      }
      const key = this.invoiceKey(invoice);
      if (clientId) {
        addInvoiceBalance(clientId, key, balance);
      }
      const invoicePhone = this.invoicePhoneDigits(invoice) || this.clientPhoneDigits(clientsById.get(clientId));
      if (!invoicePhone) {
        continue;
      }
      for (const relatedClientId of idsByPhone.get(invoicePhone) || []) {
        addInvoiceBalance(relatedClientId, key, balance);
      }
    }
    return clients.map((client) => ({
      ...client,
      unpaidBalance: unpaidByClient.has(String(client.id))
        ? this.money([...(unpaidByClient.get(String(client.id)) || new Map()).values()].reduce((sum, balance) => sum + balance, 0))
        : this.money(Number(client.unpaidBalance || 0))
    }));
  }

  private withWalletBalances(clients: ApiRecord[], transactions: ApiRecord[]): ApiRecord[] {
    const latestByClient = new Map<string, ApiRecord>();
    for (const transaction of transactions) {
      const clientId = String(transaction.clientId || transaction.client_id || '');
      if (!clientId) continue;
      const current = latestByClient.get(clientId);
      const currentTime = this.dateMs(current?.createdAt || current?.created_at || current?.date || current?.updatedAt);
      const transactionTime = this.dateMs(transaction.createdAt || transaction.created_at || transaction.date || transaction.updatedAt);
      if (!current || transactionTime >= currentTime) {
        latestByClient.set(clientId, transaction);
      }
    }
    return clients.map((client) => {
      const latest = latestByClient.get(String(client.id));
      const linkedBalance = latest?.balanceAfter ?? latest?.balance_after ?? latest?.balance;
      return {
        ...client,
        walletBalance: linkedBalance !== undefined && linkedBalance !== null && linkedBalance !== ''
          ? this.money(Number(linkedBalance))
          : this.money(Number(client.walletBalance || 0))
      };
    });
  }

  serviceOption(service: ApiRecord): string {
    return `${service.name || 'Service'} - â‚¹${service.price || 0}`;
  }

  productOption(product: ApiRecord): string {
    return `${product.name || 'Product'} - â‚¹${product.price || 0} (${product.stock || 0} left)`;
  }

  setClientSearch(value: string): void {
    this.clientSearchText = value || '';
    this.clientSearchActive = true;
    this.activeClientResultIndex.set(0);
    window.clearTimeout(this.clientSearchTimer);
    const selected = this.clients().find((client) => this.clientOption(client) === this.clientSearchText);
    if (selected) {
      this.selectClient(selected);
      return;
    }
    this.selectedClientId.set('');
    this.form.patchValue({ clientId: '' }, { emitEvent: false });
    const trimmed = this.clientSearchText.trim();
    if (!trimmed) {
      this.clientSearchRequestId++;
      this.clientSearchPending.set(false);
      this.debouncedClientQuery.set('');
      this.refreshClientSearchResults();
      return;
    }
    if (this.phoneDigits(this.clientSearchText)) {
      this.clientSearchPending.set(false);
      this.debouncedClientQuery.set(trimmed);
      this.refreshClientSearchResults();
      this.refreshRemoteClientSearchResults(trimmed);
      return;
    }
    this.clientSearchPending.set(true);
    this.clientSearchTimer = window.setTimeout(() => {
      this.debouncedClientQuery.set(this.clientSearchText.trim());
      this.clientSearchPending.set(false);
      this.activeClientResultIndex.set(0);
      this.refreshClientSearchResults();
      this.refreshRemoteClientSearchResults(this.clientSearchText.trim());
    }, 300);
  }

  setStaffSearch(value: string): void {
    this.staffSearchText = value || '';
    this.staffSearchActive = true;
    const selected = this.staff().find((person) => this.staffOption(person) === this.staffSearchText);
    this.form.patchValue({ staffId: selected?.id || '' }, { emitEvent: false });
  }

  setServiceSearch(value: string): void {
    this.serviceSearchText = value || '';
    this.serviceSearchActive = true;
  }

  setProductSearch(value: string): void {
    this.productSearchText = value || '';
    this.productSearchActive = true;
  }

  selectClient(client: ApiRecord): void {
    const clientId = String(client.id || '');
    this.clientSearchText = this.clientOption(client);
    this.clientSearchRequestId++;
    this.clientSearchPending.set(false);
    this.debouncedClientQuery.set('');
    this.clientSearchResults.set([client]);
    this.activeClientResultIndex.set(0);
    this.selectedClientId.set(clientId);
    this.form.patchValue({ clientId }, { emitEvent: false });
    this.clientSearchActive = false;
    this.creditsUsed = 0;
    this.membershipId = '';
    this.benefitServiceMappings = [];
    this.packageRedeemQuantities = {};
    this.packageRedeemStaffIds = {};
    this.walletCreditRequested.set(false);
    this.unpaidReceiveAmount = 0;
    this.unpaidReceiveMode = this.activePaymentModes()[0]?.id || 'cash';
    this.unpaidReceiveMessage.set('');
    if (clientId) this.loadMembershipIntelligence(clientId);
    this.focusLater(() => this.focusStaffSearch());
  }

  selectClientFromResult(event: Event, client: ApiRecord): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectClient(client);
  }

  handleClientSearchKeydown(event: KeyboardEvent): void {
    if (!this.clientSearchActive) return;
    const results = this.clientSearchResults();
    if (!results.length && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeClientResultIndex.set(Math.min(results.length - 1, this.activeClientResultIndex() + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeClientResultIndex.set(Math.max(0, this.activeClientResultIndex() - 1));
      return;
    }
    if (event.key === 'Enter' && results[this.activeClientResultIndex()]) {
      event.preventDefault();
      this.selectClient(results[this.activeClientResultIndex()]);
      return;
    }
    if (event.key === 'Enter' && this.form.value.clientId) {
      event.preventDefault();
      this.focusStaffSearch();
      return;
    }
    if (event.key === 'Escape') {
      this.clientSearchActive = false;
    }
  }

  selectStaff(person: ApiRecord): void {
    this.staffSearchText = this.staffOption(person);
    this.form.patchValue({ staffId: person.id }, { emitEvent: false });
    this.staffSearchActive = false;
    this.focusLater(() => this.focusServiceSearch());
  }

  handleStaffSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.staffSearchActive = false;
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const query = this.normalizeSearch(this.staffSearchText);
    const candidate = query ? this.filteredStaff()[0] : undefined;
    if (candidate) {
      this.selectStaff(candidate);
      return;
    }
    this.staffSearchActive = false;
    this.focusServiceSearch();
  }

  clearStaffSelection(): void {
    this.staffSearchText = '';
    this.staffSearchActive = false;
    this.form.patchValue({ staffId: '' }, { emitEvent: false });
  }

  setUnpaidReceiveAmount(value: unknown): void {
    const max = this.selectedClientUnpaidBalance;
    const next = Math.max(0, this.money(Number(value || 0)));
    this.unpaidReceiveAmount = max > 0 ? this.money(Math.min(next, max)) : next;
    this.unpaidReceiveMessage.set('');
  }

  fillUnpaidReceiveAmount(): void {
    const invoiceBalance = this.money(this.unpaidInvoicesForSelectedClient().reduce((sum, invoice) => sum + invoice.__balance, 0));
    this.setUnpaidReceiveAmount(invoiceBalance || this.selectedClientUnpaidBalance);
  }

  receiveUnpaid(): void {
    const requestedAmount = this.money(Number(this.unpaidReceiveAmount || 0));
    const invoices = this.unpaidInvoicesForSelectedClient();
    const totalOpen = this.money(invoices.reduce((sum, invoice) => sum + invoice.__balance, 0));
    if (!this.form.value.clientId || totalOpen <= 0) {
      this.unpaidReceiveMessage.set('No old unpaid balance is available for this client.');
      return;
    }
    if (requestedAmount <= 0) {
      this.unpaidReceiveMessage.set('Receive amount must be greater than 0.');
      return;
    }

    const cappedAmount = this.money(Math.min(requestedAmount, totalOpen));
    const mode = this.unpaidReceiveMode || this.activePaymentModes()[0]?.id || 'cash';
    let remaining = cappedAmount;
    const requests = [];
    for (const invoice of invoices) {
      if (remaining <= 0) {
        break;
      }
      const paymentAmount = this.money(Math.min(remaining, invoice.__balance));
      remaining = this.money(remaining - paymentAmount);
      requests.push(this.api.post<ApiRecord>(`invoices/${invoice.id}/payments`, {
        mode,
        amount: paymentAmount,
        reference: 'POS unpaid receive',
        remarks: 'Old unpaid balance received from POS Billing'
      }));
    }

    if (!requests.length) {
      this.unpaidReceiveMessage.set('No pending invoice found for receive payment.');
      return;
    }

    this.saving.set(true);
    this.unpaidReceiveMessage.set('');
    forkJoin(requests).pipe(
      catchError((error) => {
        this.unpaidReceiveMessage.set(error?.error?.error || error?.message || 'Unable to receive old unpaid amount');
        return of([] as ApiRecord[]);
      })
    ).subscribe((result) => {
      this.saving.set(false);
      if (!result.length) {
        return;
      }
      this.unpaidReceiveAmount = 0;
      const cappedCopy = requestedAmount > totalOpen
        ? ` Open balance â‚¹${totalOpen.toLocaleString('en-IN')} tha, isliye amount cap kiya gaya.`
        : '';
      this.unpaidReceiveMessage.set(`Old unpaid â‚¹${cappedAmount.toLocaleString('en-IN')} received.${cappedCopy}`);
      this.load();
    });
  }

  selectService(service: ApiRecord): void {
    this.serviceSearchText = this.serviceOption(service);
    this.selectedServiceId = service.id;
    this.selectedServiceIds = service.id ? [service.id] : [];
    this.serviceSearchActive = false;
  }

  selectProduct(product: ApiRecord): void {
    this.productSearchText = this.productOption(product);
    this.selectedProductId = product.id;
    this.selectedProductIds = product.id ? [product.id] : [];
    this.productSearchActive = false;
  }

  isServiceSelected(id: string): boolean {
    return this.selectedServiceIds.includes(id);
  }

  isProductSelected(id: string): boolean {
    return this.selectedProductIds.includes(id);
  }

  toggleServiceSelection(service: ApiRecord): void {
    if (!service.id) return;
    this.addServiceFromSearch(service);
  }

  toggleProductSelection(product: ApiRecord): void {
    if (!product.id) return;
    this.addProductFromSearch(product);
  }

  selectVisibleServices(): void {
    const next = new Set(this.selectedServiceIds);
    this.filteredServices().forEach((service) => {
      if (service.id) next.add(service.id);
    });
    this.selectedServiceIds = Array.from(next);
    this.selectedServiceId = this.selectedServiceIds[0] || '';
    this.serviceSearchActive = true;
  }

  selectVisibleProducts(): void {
    const next = new Set(this.selectedProductIds);
    this.filteredProducts().forEach((product) => {
      if (product.id) next.add(product.id);
    });
    this.selectedProductIds = Array.from(next);
    this.selectedProductId = this.selectedProductIds[0] || '';
    this.productSearchActive = true;
  }

  clearServiceSelection(): void {
    this.selectedServiceIds = [];
    this.selectedServiceId = '';
    this.serviceSearchActive = true;
  }

  clearProductSelection(): void {
    this.selectedProductIds = [];
    this.selectedProductId = '';
    this.productSearchActive = true;
  }

  handleServiceSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.serviceSearchActive = false;
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (this.selectedServiceIds.length) {
      this.addSelectedService();
      return;
    }
    const query = this.normalizeSearch(this.serviceSearchText);
    const candidate = query ? this.filteredServices()[0] : undefined;
    if (candidate) {
      this.addServiceFromSearch(candidate);
      return;
    }
    this.serviceSearchActive = false;
    this.focusProductSearch();
  }

  handleProductSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.productSearchActive = false;
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (this.selectedProductIds.length) {
      this.addSelectedProduct();
      return;
    }
    const query = this.normalizeSearch(this.productSearchText);
    const candidate = query ? this.filteredProducts()[0] : undefined;
    if (candidate) {
      this.addProductFromSearch(candidate);
      return;
    }
    this.productSearchActive = false;
    this.focusMembershipPlan();
  }

  handleMembershipPlanKeydown(event: KeyboardEvent, select: HTMLSelectElement): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.addMembershipPlanFromSelect(select);
  }

  handlePackageKeydown(event: KeyboardEvent, select: HTMLSelectElement): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.addPackageFromSelect(select);
  }

  handleGiftCardAmountKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.addGiftCardFromInput(input);
  }

  closeClientSearchSoon(): void {
    window.setTimeout(() => {
      this.selectBestClientSearchMatch();
      this.clientSearchActive = false;
    }, 120);
  }

  private selectBestClientSearchMatch(): void {
    if (this.form.value.clientId) return;
    const query = this.debouncedClientQuery() || this.clientSearchText.trim();
    const candidate = this.clientSearchResults()[this.activeClientResultIndex()] || this.clientSearchResults()[0];
    if (!candidate || !this.shouldAutoSelectClient(candidate, query)) return;
    this.selectClient(candidate);
  }

  private shouldAutoSelectClient(client: ApiRecord, query: string): boolean {
    const digits = this.phoneDigits(query);
    if (digits.length >= 4) {
      return this.clientPhoneDigits(client).includes(digits);
    }
    const compactQuery = this.compactSearch(query);
    if (compactQuery.length < 3) return false;
    const name = this.compactSearch(client.name || '');
    return name.startsWith(compactQuery)
      || this.isWalkInAliasMatch(client, compactQuery)
      || this.normalizeSearch(client.name || '').startsWith(this.normalizeSearch(query));
  }

  closeStaffSearchSoon(): void {
    window.setTimeout(() => {
      this.staffSearchActive = false;
    }, 120);
  }

  closeServiceSearchSoon(): void {
    window.setTimeout(() => {
      this.serviceSearchActive = false;
    }, 120);
  }

  closeProductSearchSoon(): void {
    window.setTimeout(() => {
      this.productSearchActive = false;
    }, 120);
  }

  openClientFormFromSearch(): void {
    const raw = this.clientSearchText.trim();
    if (!raw || this.normalizeSearch(raw).length < 3) return;
    const digits = raw.replace(/\D/g, '');
    const looksLikePhone = digits.length > 0 && !/[a-z]/i.test(raw);
    this.clientForm.reset({
      name: looksLikePhone ? '' : raw,
      phone: looksLikePhone ? digits : '',
      email: '',
      birthday: '',
      anniversary: '',
      tag: 'new',
      notes: 'Created from POS billing.'
    });
    this.showClientForm.set(true);
    this.clientSearchActive = false;
  }

  closeClientForm(): void {
    this.showClientForm.set(false);
  }

  saveClientFromPos(): void {
    if (this.clientForm.invalid) {
      this.clientForm.markAllAsTouched();
      return;
    }
    const branchId = this.form.value.branchId || this.appState.selectedBranchId() || 'branch_hyd';
    const value = this.clientForm.value;
    this.clientSaving.set(true);
    this.api.create<ApiRecord>('clients', {
      name: value.name,
      phone: value.phone,
      email: value.email,
      birthday: value.birthday,
      anniversary: value.anniversary,
      branchId,
      tags: [value.tag || 'new'],
      notes: value.notes,
      walletBalance: 0,
      loyaltyPoints: 0,
      visitCount: 0,
      totalSpend: 0,
      visitHistory: [],
      purchaseHistory: [],
      whatsappHistory: [],
      consentForms: []
    }).subscribe({
      next: (client) => {
        this.clients.update((clients) => [client, ...clients]);
        this.selectClient(client);
        this.showClientForm.set(false);
        this.clientSaving.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save client');
        this.clientSaving.set(false);
      }
    });
  }

  useWalkinClient(): void {
    const existing = this.clients().find((client) => this.normalizeSearch(`${client.name} ${client.phone}`) === 'walk in client 0000000000' || this.normalizeSearch(client.name || '').includes('walk'));
    if (existing) {
      this.selectClient(existing);
      return;
    }
    const branchId = this.form.value.branchId || this.appState.selectedBranchId() || 'branch_hyd';
    this.api.create<ApiRecord>('clients', {
      name: 'Walk-in Client',
      phone: '0000000000',
      branchId,
      tags: ['walk-in'],
      visitHistory: [],
      purchaseHistory: [],
      whatsappHistory: [],
      consentForms: []
    }).subscribe({
      next: (client) => {
        this.clients.update((clients) => [client, ...clients]);
        this.selectClient(client);
      },
      error: (error) => this.error.set(error?.error?.error || 'Unable to create walk-in client')
    });
  }

  billableAppointments(): ApiRecord[] {
    const clientId = this.form.value.clientId;
    return this.appointments().filter((appointment) =>
      appointment.status === 'completed'
      && !this.appointmentAlreadyBilled(String(appointment.id || ''))
      && (!clientId || appointment.clientId === clientId)
    );
  }

  private appointmentAlreadyBilled(appointmentId: string): boolean {
    if (!appointmentId) return false;
    return this.invoices().some((invoice) => {
      const status = String(invoice.status || invoice.payment_status || '').trim().toLowerCase();
      if (status === 'deleted') return false;
      return String(invoice.appointmentId || invoice.appointment_id || '') === appointmentId;
    });
  }

  private appointmentServiceIds(appointment: ApiRecord): string[] {
    const raw = appointment.serviceIds ?? appointment.service_ids ?? appointment.serviceId ?? appointment.service_id ?? [];
    if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
    const value = String(raw || '').trim();
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [String(parsed)].filter(Boolean);
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }

  private routeIdList(value: string): string[] {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  }

  private routeAppointmentRows(appointment: ApiRecord): ApiRecord[] {
    const params = this.route.snapshot.queryParamMap;
    const routeAppointmentIds = new Set(this.routeIdList(params.get('appointmentIds') || ''));
    const bookingGroupId = String(params.get('bookingGroupId') || appointment.bookingGroupId || appointment.booking_group_id || '').trim();
    const rows = this.appointments()
      .filter((row) => routeAppointmentIds.has(String(row.id || '')) || (!!bookingGroupId && String(row.bookingGroupId || row.booking_group_id || '') === bookingGroupId))
      .sort((a, b) => new Date(String(a.startAt || '')).getTime() - new Date(String(b.startAt || '')).getTime());
    if (!rows.some((row) => String(row.id || '') === String(appointment.id || ''))) rows.unshift(appointment);
    return rows.length ? rows : [appointment];
  }

  addService(id: string, staffIdOverride = ''): void {
    const service = this.services().find((item) => item.id === id);
    if (!service) return;
    this.items.update((items) => [
      ...items,
      {
        type: 'service',
        id: service.id,
        name: service.name,
        quantity: 1,
        price: Number(service.price),
        gstRate: Number(service.gstRate || 18),
        ...this.defaultItemStaff(staffIdOverride),
        ...this.defaultItemDiscount('service')
      }
    ]);
    this.normalizeBenefitServiceMappings();
    this.autoSuggestMembershipRedemption(service.name || 'service');
    this.clearCoupon();
  }

  addServiceFromSearch(service: ApiRecord): void {
    const serviceId = String(service.id || '');
    if (!serviceId) return;
    this.addService(serviceId);
    this.serviceSearchText = '';
    this.clearServiceSelection();
    this.serviceSearchActive = false;
    this.focusLater(() => this.focusProductSearch());
  }

  addSelectedService(): void {
    if (!this.selectedServiceIds.length) return;
    this.selectedServiceIds.forEach((id) => this.addService(id));
    this.serviceSearchText = '';
    this.clearServiceSelection();
    this.serviceSearchActive = false;
    this.focusLater(() => this.focusProductSearch());
  }

  addProduct(id: string): void {
    const product = this.products().find((item) => item.id === id);
    if (!product) return;
    this.items.update((items) => [
      ...items,
      {
        type: 'product',
        id: product.id,
        name: product.name,
        quantity: 1,
        price: Number(product.price),
        gstRate: Number(product.gstRate || 18),
        ...this.defaultItemStaff(),
        ...this.defaultItemDiscount('product')
      }
    ]);
    this.normalizeBenefitServiceMappings();
    this.autoSuggestMembershipRedemption(product.name || 'product');
    this.clearCoupon();
  }

  addProductFromSearch(product: ApiRecord): void {
    const productId = String(product.id || '');
    if (!productId) return;
    this.addProduct(productId);
    this.productSearchText = '';
    this.clearProductSelection();
    this.productSearchActive = false;
    this.focusLater(() => this.focusMembershipPlan());
  }

  addSelectedProduct(): void {
    if (!this.selectedProductIds.length) return;
    this.selectedProductIds.forEach((id) => this.addProduct(id));
    this.productSearchText = '';
    this.clearProductSelection();
    this.productSearchActive = false;
    this.focusLater(() => this.focusMembershipPlan());
  }

  addMembershipPlan(id: string): void {
    const plan = this.membershipPlans().find((item) => item.id === id);
    if (!plan) return;
    const planType = this.membershipPlanType(plan);
    const creditAmount = this.membershipPlanCreditAmount(plan);
    const bonusAmount = this.membershipPlanBonusAmount(plan);
    const benefitRules = plan.benefitRules || {};
    const serviceCredits = this.planServiceCreditsForSale(plan, planType, creditAmount, benefitRules);
    this.items.update((items) => [
      ...items,
      {
        type: 'membership',
        id: plan.id,
        name: plan.name,
        quantity: 1,
        price: Number(plan.price || 0),
        gstRate: 18,
        ...this.defaultItemStaff(),
        discountPercent: this.planUsesCredits(planType) ? 0 : Number(plan.discountPercent || 0),
        validityDays: Number(plan.validityDays || 365),
        planType,
        planCredits: this.planUsesCredits(planType) ? creditAmount : 0,
        creditsRemaining: this.planUsesCredits(planType) ? creditAmount : 0,
        bonusAmount,
        benefitRules,
        serviceCredits
      }
    ]);
    this.normalizeBenefitServiceMappings();
    this.clearCoupon();
  }

  private planUsesCredits(planType: string): boolean {
    return ['prepaid_credit', 'visit_pack', 'service_credit', 'combo', 'unlimited'].includes(planType);
  }

  private planServiceCreditsForSale(plan: PosMembershipPlan, planType: string, creditAmount: number, benefitRules: ApiRecord): ApiRecord[] {
    if (planType === 'prepaid_credit') {
      return [{ type: 'prepaid_credit', credits: creditAmount, remaining: creditAmount, planId: plan.id, bonusAmount: this.membershipPlanBonusAmount(plan), benefitPercent: plan.benefitPercent || 0, benefitRules }];
    }
    if (['visit_pack', 'service_credit', 'combo'].includes(planType)) {
      const included = Array.isArray(plan.includedServices) && plan.includedServices.length ? plan.includedServices as ApiRecord[] : [{}];
      return included.map((item) => ({
        type: planType,
        serviceId: String(item['serviceId'] || ''),
        serviceName: String(item['serviceName'] || item['name'] || item['serviceId'] || plan.name),
        credits: Number(item['credits'] || creditAmount || 1),
        remaining: Number(item['credits'] || creditAmount || 1),
        planId: plan.id,
        creditUnit: planType === 'visit_pack' ? 'visit' : 'service',
        benefitRules
      }));
    }
    if (planType === 'unlimited') {
      return [{ type: 'unlimited_service', credits: creditAmount, remaining: creditAmount, planId: plan.id, creditUnit: 'unlimited', fairUsage: benefitRules['fairUsage'] || {}, benefitRules }];
    }
    return [
      { type: 'bill_discount', percent: Number(plan.discountPercent || 0), planId: plan.id, benefitRules },
      { type: 'product_discount', percent: Number(plan.productDiscountPercent || 0), planId: plan.id, benefitRules }
    ];
  }

  addMembershipPlanFromSelect(select: HTMLSelectElement): void {
    const planId = String(select.value || '');
    if (planId) this.addMembershipPlan(planId);
    select.value = '';
    this.focusLater(() => this.focusPackageSelect());
  }

  addPackage(id: string): void {
    const itemPackage = this.packages().find((item) => item.id === id);
    if (!itemPackage) return;
    this.items.update((items) => [
      ...items,
      {
        type: 'package',
        id: itemPackage.id,
        name: itemPackage.name,
        quantity: 1,
        price: Number(itemPackage.price || 0),
        gstRate: 18,
        ...this.defaultItemStaff(),
        validityDays: Number(itemPackage.validityDays || 90),
        packageCredits: Array.isArray(itemPackage.packageCredits) ? itemPackage.packageCredits : []
      }
    ]);
    this.normalizeBenefitServiceMappings();
    this.clearCoupon();
  }

  addPackageFromSelect(select: HTMLSelectElement): void {
    const packageId = String(select.value || '');
    if (packageId) this.addPackage(packageId);
    select.value = '';
    this.focusLater(() => this.focusGiftCardAmount());
  }

  addGiftCard(value: number | string): void {
    const amount = this.money(value);
    if (amount <= 0) return;
    const code = `GC-${Date.now().toString().slice(-6)}`;
    this.items.update((items) => [
      ...items,
      {
        type: 'gift_card',
        id: code,
        name: `Gift Card ${code}`,
        quantity: 1,
        price: amount,
        gstRate: 0,
        ...this.defaultItemStaff(),
        giftCode: code,
        expiryDate: this.futureDate(365)
      }
    ]);
    this.normalizeBenefitServiceMappings();
    this.clearCoupon();
  }

  addGiftCardFromInput(input: HTMLInputElement): void {
    this.addGiftCard(input.value);
    input.value = '';
    this.focusLater(() => this.focusGiftCardAmount());
  }

  removeItem(index: number): void {
    this.items.update((items) => items.filter((_, itemIndex) => itemIndex !== index));
    this.normalizeBenefitServiceMappings();
    this.clearCoupon();
  }

  touchItems(): void {
    this.items.set([...this.items()]);
    this.normalizeBenefitServiceMappings();
    this.clearCoupon();
  }

  setItemDiscountType(item: SaleItem, type: ItemDiscountType): void {
    item.discountType = type === 'percent' ? 'percent' : 'amount';
    item.discountValue = this.cleanItemDiscountValue(item, item.discountValue || 0);
    item.discountSource = item.discountValue > 0 ? 'manual' : 'none';
    this.touchItems();
  }

  setItemDiscountValue(item: SaleItem, value: number | string): void {
    item.discountValue = this.cleanItemDiscountValue(item, value);
    item.discountSource = item.discountValue > 0 ? 'manual' : 'none';
    this.touchItems();
  }

  setItemStaff(item: SaleItem, staffId: string): void {
    const person = this.staff().find((entry) => entry.id === staffId);
    item.staffId = staffId || '';
    item.staffName = person?.name || '';
    if (item.staffSplits?.length) {
      item.staffSplits[0] = { staffId: item.staffId || '', staffName: item.staffName || '', percent: Number(item.staffSplits[0]?.percent || 0) || 100 };
    }
    this.items.set([...this.items()]);
  }

  addStaffSplit(item: SaleItem): void {
    const primary = {
      staffId: item.staffId || '',
      staffName: item.staffName || '',
      percent: item.staffSplits?.length ? 0 : 50
    };
    const nextPercent = item.staffSplits?.length ? 0 : 50;
    item.staffSplits = item.staffSplits?.length
      ? [...item.staffSplits, { staffId: '', staffName: '', percent: nextPercent }]
      : [primary, { staffId: '', staffName: '', percent: nextPercent }];
    this.items.set([...this.items()]);
  }

  removeStaffSplit(item: SaleItem, index: number): void {
    item.staffSplits = (item.staffSplits || []).filter((_, splitIndex) => splitIndex !== index);
    if (item.staffSplits.length <= 1) item.staffSplits = [];
    this.items.set([...this.items()]);
  }

  setItemSplitStaff(item: SaleItem, index: number, staffId: string): void {
    const person = this.staff().find((entry) => entry.id === staffId);
    const splits = [...(item.staffSplits || [])];
    if (!splits[index]) return;
    splits[index] = { ...splits[index], staffId: staffId || '', staffName: person?.name || '' };
    item.staffSplits = splits;
    if (index === 0) {
      item.staffId = staffId || '';
      item.staffName = person?.name || '';
    }
    this.items.set([...this.items()]);
  }

  setItemSplitPercent(item: SaleItem, index: number, value: number | string): void {
    const splits = [...(item.staffSplits || [])];
    if (!splits[index]) return;
    splits[index] = { ...splits[index], percent: Math.max(0, Math.min(100, this.money(value))) };
    item.staffSplits = splits;
    this.items.set([...this.items()]);
  }

  splitPercentTotal(item: SaleItem): number {
    return Math.round((item.staffSplits || []).reduce((sum, split) => sum + Number(split.percent || 0), 0));
  }

  lineGross(item: SaleItem): number {
    return this.money(Number(item.price || 0) * Number(item.quantity || 1));
  }

  lineDiscountAmount(item: SaleItem): number {
    const gross = this.lineGross(item);
    const value = Math.max(0, Number(item.discountValue || 0));
    const amount = item.discountType === 'percent'
      ? (gross * Math.min(value, 100)) / 100
      : value;
    return this.money(Math.min(gross, amount));
  }

  lineTaxableSubtotal(item: SaleItem): number {
    return this.money(Math.max(0, this.lineGross(item) - this.lineDiscountAmount(item)));
  }

  lineTotal(item: SaleItem): number {
    return this.lineTaxableSubtotal(item);
  }

  lineDiscountSourceLabel(item: SaleItem): string {
    return item.discountSource === 'membership' ? 'Membership' : 'Line discount';
  }

  itemCategoryTitle(item: SaleItem): string {
    const titles: Record<SaleItem['type'], string> = {
      service: 'Service',
      product: 'Product',
      membership: 'Membership sale',
      package: 'Package sale',
      gift_card: 'Gift card sale',
      package_redeem: 'Package redeem',
      custom: 'Custom item'
    };
    return titles[item.type] || 'Item';
  }

  private defaultItemStaff(staffIdOverride = ''): Pick<SaleItem, 'staffId' | 'staffName'> {
    const staffId = String(staffIdOverride || this.form.value.staffId || '');
    const person = this.staff().find((item) => item.id === staffId);
    return {
      staffId,
      staffName: person?.name || ''
    };
  }

  private defaultItemDiscount(type: SaleItem['type']): Pick<SaleItem, 'discountType' | 'discountValue' | 'discountSource'> {
    const percent = type === 'service'
      ? this.activeMembershipDiscountPercent()
      : type === 'product'
        ? this.activeMembershipProductDiscountPercent()
        : 0;
    if (percent > 0) {
      return { discountType: 'percent', discountValue: percent, discountSource: 'membership' };
    }
    return { discountType: 'amount', discountValue: 0, discountSource: 'none' };
  }

  private cleanItemDiscountValue(item: SaleItem, value: number | string): number {
    const numeric = Math.max(0, Number(value || 0));
    if (item.discountType === 'percent') return this.money(Math.min(numeric, 100));
    return this.money(Math.min(numeric, this.lineGross(item)));
  }

  selectedClient(): ApiRecord | undefined {
    return this.clients().find((client) => client.id === this.form.value.clientId);
  }

  selectedClientMembership(): ApiRecord | undefined {
    const active = this.activeMembershipForClient();
    if (active) return active;
    const clientId = this.form.value.clientId;
    if (!clientId) return undefined;
    return this.memberships()
      .filter((membership) => membership.clientId === clientId)
      .sort((a, b) => this.dateMs(b.validityDate || b.createdAt) - this.dateMs(a.validityDate || a.createdAt))[0];
  }

  selectedClientMembershipIsExpired(): boolean {
    const membership = this.selectedClientMembership();
    if (!membership?.validityDate) return false;
    return String(membership.validityDate) < new Date().toISOString().slice(0, 10);
  }

  selectedClientMembershipStatus(): string {
    const membership = this.selectedClientMembership();
    if (!membership) return 'No membership';
    const days = this.membershipDaysLeft(membership);
    if (days < 0) return `Expired ${Math.abs(days)}d ago`;
    if (days === 0) return 'Expires today';
    if (days < 30) return `${days}d left`;
    return membership.status === 'active' ? 'Active' : String(membership.status || 'Active');
  }

  membershipTakenDate(membership: ApiRecord): string {
    const history = Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [];
    const sold = history.find((item) => item?.type === 'membership_sale' || item?.type === 'manual_membership_assignment');
    return this.dateLabel(sold?.date || membership.createdAt);
  }

  membershipExpiryDate(membership: ApiRecord): string {
    return membership.validityDate ? this.dateLabel(membership.validityDate) : 'No expiry';
  }

  private todayDateInput(): string {
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
  }

  private invoiceDateValue(): string {
    const value = String(this.form.value.invoiceDate || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : this.todayDateInput();
  }

  private selectedInvoiceTimestamp(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const millis = String(now.getMilliseconds()).padStart(3, '0');
    const offsetMinutes = -now.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
    const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
    return `${this.invoiceDateValue()}T${hours}:${minutes}:${seconds}.${millis}${sign}${offsetHours}:${offsetRemainder}`;
  }

  private buildHeldInvoiceDraft(): PosHeldInvoiceDraft {
    const now = new Date().toISOString();
    const client = this.selectedClient();
    const branch = this.branches().find((item) => item.id === this.form.value.branchId);
    const staff = this.staff().find((item) => item.id === this.form.value.staffId);
    const id = this.currentHoldId || `hold_${Date.now()}`;
    const clientName = client?.name || this.clientSearchText || 'Walk-in client';
    return {
      id,
      title: `${clientName} Â· â‚¹${this.total}`,
      clientId: String(this.form.value.clientId || ''),
      clientName,
      branchId: String(this.form.value.branchId || ''),
      branchName: branch?.name || String(this.form.value.branchId || 'Branch'),
      staffId: String(this.form.value.staffId || ''),
      staffName: staff?.name || 'Unassigned',
      appointmentId: String(this.form.value.appointmentId || ''),
      invoiceDate: this.invoiceDateValue(),
      items: this.items(),
      tips: this.tips(),
      payments: { ...this.payments },
      bookingAdvanceAppliedAmount: this.appliedBookingAdvanceAmount(),
      discount: this.manualDiscountAmount,
      discountMode: this.discountMode,
      couponCode: this.couponCode,
      creditsUsed: Number(this.creditsUsed || 0),
      membershipId: this.membershipId,
      benefitServiceMappings: this.selectedBenefitServiceMappings(),
      subtotal: this.subtotal,
      total: this.total,
      balanceDue: this.balanceDue,
      note: this.currentHoldId ? 'Updated held invoice from POS.' : 'Held from POS before final invoice save.',
      createdAt: this.posSettings.getHeldInvoice(id)?.createdAt || now,
      updatedAt: now
    };
  }

  private buildActiveBillingDraft(): PosActiveBillingDraft {
    const client = this.selectedClient();
    return {
      version: 1,
      currentHoldId: this.currentHoldId,
      clientId: String(this.form.value.clientId || ''),
      clientName: client?.name || this.clientSearchText || '',
      branchId: String(this.form.value.branchId || ''),
      staffId: String(this.form.value.staffId || ''),
      appointmentId: String(this.form.value.appointmentId || ''),
      invoiceDate: this.invoiceDateValue(),
      items: this.items(),
      tips: this.tips(),
      payments: { ...this.payments },
      bookingAdvanceAppliedAmount: this.appliedBookingAdvanceAmount(),
      discount: Number(this.discount || 0),
      discountMode: this.discountMode === 'percent' ? 'percent' : 'amount',
      couponCode: this.couponCode || '',
      couponResult: this.couponResult(),
      couponMessage: this.couponMessage(),
      creditsUsed: Number(this.creditsUsed || 0),
      membershipId: this.membershipId || '',
      benefitServiceMappings: this.selectedBenefitServiceMappings(),
      clientSearchText: this.clientSearchText || '',
      serviceSearchText: this.serviceSearchText || '',
      productSearchText: this.productSearchText || '',
      selectedServiceId: this.selectedServiceId || '',
      selectedServiceIds: [...this.selectedServiceIds],
      selectedProductId: this.selectedProductId || '',
      selectedProductIds: [...this.selectedProductIds],
      tipDraft: { ...this.tipDraft },
      unpaidReceiveAmount: Number(this.unpaidReceiveAmount || 0),
      unpaidReceiveMode: this.unpaidReceiveMode || this.activePaymentModes()[0]?.id || 'cash',
      walletCreditRequested: this.walletCreditRequested(),
      updatedAt: new Date().toISOString()
    };
  }

  private hasActiveBillingDraftDetails(): boolean {
    const paymentTotal = Object.values(this.payments || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
    const hasBillContent = !!this.currentHoldId
      || !!this.items().length
      || !!this.tips().length
      || paymentTotal > 0
      || Number(this.discount || 0) > 0
      || !!this.couponCode.trim()
      || Number(this.creditsUsed || 0) > 0
      || !!this.membershipId
      || this.selectedServiceIds.length > 0
      || this.selectedProductIds.length > 0;
    if (this.invoice() && !hasBillContent) {
      return false;
    }
    return !!this.currentHoldId
      || !!this.form.value.clientId
      || !!this.items().length
      || !!this.tips().length
      || paymentTotal > 0
      || Number(this.discount || 0) > 0
      || !!this.couponCode.trim()
      || Number(this.creditsUsed || 0) > 0
      || !!this.membershipId
      || !!this.clientSearchText.trim()
      || !!this.serviceSearchText.trim()
      || !!this.productSearchText.trim()
      || this.selectedServiceIds.length > 0
      || this.selectedProductIds.length > 0;
  }

  private restoreActiveBillingDraft(): void {
    if (this.activeDraftRestored || this.pendingHoldId) {
      return;
    }
    this.activeDraftRestored = true;
    const draft = this.posSettings.loadActiveBillingDraft();
    if (!draft) {
      return;
    }
    if (!this.shouldRestoreActiveBillingDraft()) {
      this.posSettings.clearActiveBillingDraft();
      return;
    }
    this.currentHoldId = draft.currentHoldId || '';
    this.selectedClientId.set(String(draft.clientId || ''));
    this.form.patchValue({
      clientId: draft.clientId || '',
      branchId: draft.branchId || this.form.value.branchId || '',
      staffId: draft.staffId || '',
      appointmentId: draft.appointmentId || '',
      invoiceDate: draft.invoiceDate || this.todayDateInput()
    }, { emitEvent: false });
    this.items.set((draft.items || []) as SaleItem[]);
    this.tips.set((draft.tips || []) as TipLine[]);
    this.payments = {
      ...Object.fromEntries(this.activePaymentModes().map((mode) => [mode.id, 0])),
      ...(draft.payments || {})
    };
    this.discount = Number(draft.discount || 0);
    this.discountMode = draft.discountMode === 'percent' ? 'percent' : 'amount';
    this.couponCode = draft.couponCode || '';
    this.couponResult.set((draft.couponResult || null) as ApiRecord | null);
    this.couponMessage.set(draft.couponMessage || '');
    this.creditsUsed = Number(draft.creditsUsed || 0);
    this.membershipId = draft.membershipId || '';
    this.benefitServiceMappings = Array.isArray(draft.benefitServiceMappings) ? draft.benefitServiceMappings as BenefitServiceMapping[] : [];
    this.clientSearchText = draft.clientSearchText || (draft.clientId
      ? this.clientOption(this.clients().find((client) => client.id === draft.clientId) || { id: draft.clientId, name: draft.clientName })
      : '');
    this.staffSearchText = draft.staffId
      ? this.staffOption(this.staff().find((person) => person.id === draft.staffId) || { id: draft.staffId, name: draft.staffId })
      : '';
    this.serviceSearchText = draft.serviceSearchText || '';
    this.productSearchText = draft.productSearchText || '';
    this.selectedServiceId = draft.selectedServiceId || '';
    this.selectedServiceIds = Array.isArray(draft.selectedServiceIds) ? draft.selectedServiceIds : [];
    this.selectedProductId = draft.selectedProductId || '';
    this.selectedProductIds = Array.isArray(draft.selectedProductIds) ? draft.selectedProductIds : [];
    this.tipDraft = {
      staffId: draft.tipDraft?.staffId || '',
      paymentMode: draft.tipDraft?.paymentMode || this.activePaymentModes()[0]?.id || 'cash',
      amount: Number(draft.tipDraft?.amount || 0),
      note: draft.tipDraft?.note || ''
    };
    this.unpaidReceiveAmount = Number(draft.unpaidReceiveAmount || 0);
    this.unpaidReceiveMode = draft.unpaidReceiveMode || this.activePaymentModes()[0]?.id || 'cash';
    this.walletCreditRequested.set(!!draft.walletCreditRequested);
    this.bookingAdvanceAppliedAmount.set(this.money(Number(draft.bookingAdvanceAppliedAmount || 0)));
    this.loadBookingAdvanceSuggestion(String(draft.appointmentId || ''), { preserveApplied: true });
    if (draft.clientId) this.loadMembershipIntelligence(draft.clientId);
    this.dataHint.set('Unsaved POS bill restored. Checkout, hold or clear the bill to remove this draft.');
  }

  private shouldRestoreActiveBillingDraft(): boolean {
    const params = this.route.snapshot.queryParamMap;
    return params.get('restoreDraft') === '1';
  }

  private restorePendingHold(): void {
    const id = this.pendingHoldId;
    if (!id) return;
    const draft = this.posSettings.getHeldInvoice(id);
    this.pendingHoldId = '';
    if (!draft) {
      this.dataHint.set('Selected held invoice was not found. It may have been deleted or saved.');
      return;
    }
    this.currentHoldId = draft.id;
    this.selectedClientId.set(String(draft.clientId || ''));
    this.form.patchValue({
      clientId: draft.clientId || '',
      branchId: draft.branchId || this.form.value.branchId || '',
      staffId: draft.staffId || '',
      appointmentId: draft.appointmentId || '',
      invoiceDate: draft.invoiceDate || this.todayDateInput()
    }, { emitEvent: false });
    this.items.set((draft.items || []) as SaleItem[]);
    this.tips.set((draft.tips || []) as TipLine[]);
    this.payments = {
      ...Object.fromEntries(this.activePaymentModes().map((mode) => [mode.id, 0])),
      ...(draft.payments || {})
    };
    this.walletCreditRequested.set(false);
    this.bookingAdvanceAppliedAmount.set(this.money(Number(draft.bookingAdvanceAppliedAmount || 0)));
    this.discount = Number(draft.discount || 0);
    this.discountMode = draft.discountMode === 'percent' ? 'percent' : 'amount';
    this.couponCode = draft.couponCode || '';
    this.creditsUsed = Number(draft.creditsUsed || 0);
    this.membershipId = draft.membershipId || '';
    this.benefitServiceMappings = Array.isArray(draft.benefitServiceMappings) ? draft.benefitServiceMappings as BenefitServiceMapping[] : [];
    this.clientSearchText = draft.clientId
      ? this.clientOption(this.clients().find((client) => client.id === draft.clientId) || { id: draft.clientId, name: draft.clientName })
      : draft.clientName || '';
    this.staffSearchText = draft.staffId
      ? this.staffOption(this.staff().find((person) => person.id === draft.staffId) || { id: draft.staffId, name: draft.staffName })
      : '';
    this.loadBookingAdvanceSuggestion(String(draft.appointmentId || ''), { preserveApplied: true });
    if (draft.clientId) this.loadMembershipIntelligence(draft.clientId);
    this.dataHint.set(`Held invoice resumed: ${draft.title}`);
  }

  private resetDraftAfterHold(): void {
    this.currentHoldId = '';
    this.items.set([]);
    this.tips.set([]);
    this.payments = Object.fromEntries(this.activePaymentModes().map((mode) => [mode.id, 0]));
    this.walletCreditRequested.set(false);
    this.bookingAdvanceInfo.set(null);
    this.bookingAdvanceLoading.set(false);
    this.bookingAdvanceAppliedAmount.set(0);
    this.discount = 0;
    this.discountMode = 'amount';
    this.couponCode = '';
    this.creditsUsed = 0;
    this.membershipId = '';
    this.benefitServiceMappings = [];
    this.clientSearchText = '';
    this.staffSearchText = '';
    this.serviceSearchText = '';
    this.productSearchText = '';
    this.selectedServiceId = '';
    this.selectedServiceIds = [];
    this.selectedProductId = '';
    this.selectedProductIds = [];
    this.staffSearchActive = false;
    this.productSearchActive = false;
    this.membershipEligibility.set(null);
    this.membershipSuggestion.set(null);
    this.selectedClientId.set('');
    this.form.patchValue({ clientId: '', staffId: '', appointmentId: '', invoiceDate: this.todayDateInput() }, { emitEvent: false });
    this.clearCoupon();
  }

  clearCoupon(): void {
    this.couponResult.set(null);
    this.couponMessage.set('');
  }

  validateCoupon(): void {
    const code = this.couponCode.trim();
    if (!code || !this.items().length) return;
    this.couponChecking.set(true);
    this.couponMessage.set('');
    this.api.post<ApiRecord>('sales/coupons/validate', {
      code,
      branchId: this.form.value.branchId || '',
      items: this.items(),
      subtotal: this.subtotal
    }).subscribe({
      next: (result) => {
        this.couponResult.set(result);
        const isGiftCard = result['giftCard'] || result.coupon?.['source'] === 'gift_card';
        this.couponMessage.set(isGiftCard
          ? `Gift card ${result.coupon?.['code'] || code} applied: ${result.discountAmount || 0} redeemable`
          : `Applied ${result.coupon?.['code'] || code}: ${result.discountAmount || 0} discount`);
        this.couponChecking.set(false);
      },
      error: (error) => {
        this.couponResult.set(null);
        this.couponMessage.set(error?.error?.error || 'Coupon could not be applied');
        this.couponChecking.set(false);
      }
    });
  }

  checkout(): void {
    if (this.form.invalid || !this.items().length) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.overPaid > 0 && !this.walletCreditRequested()) {
      this.error.set('Click Wallet to add the extra payment to the client wallet.');
      return;
    }
    if (this.membershipId && this.creditsUsed > 0 && this.unallocatedBenefitCredits() > 0) {
      this.error.set('Map selected benefit credits to service lines before saving.');
      return;
    }
    const appointmentId = String(this.form.value.appointmentId || '');
    if (appointmentId) {
      this.saving.set(true);
      this.error.set('');
      this.api.list<ApiRecord>(`enterprise-scheduler/appointments/${appointmentId}/billing-status`).subscribe({
        next: (status) => {
          if (status?.['billed'] || status?.['billingLocked']) {
            this.error.set('This appointment is already billed. POS is locked.');
            this.saving.set(false);
            this.clearPosRouteSelection(() => this.load());
            return;
          }
          this.submitCheckout();
        },
        error: () => this.submitCheckout()
      });
      return;
    }
    this.submitCheckout();
  }

  private submitCheckout(): void {
    this.saving.set(true);
    this.error.set('');
    const walletCreditAmount = this.walletCreditRequested() ? this.overPaid : 0;
    const splitPayments = this.invoicePaymentEntries();
    const billingDate = this.invoiceDateValue();
    const billingTimestamp = this.selectedInvoiceTimestamp();
    const settlementPreview = this.currentSettlementPreview();
    const selectedBenefit = this.selectedRedeemableBenefit();
    const serviceLineMappings = this.selectedBenefitServiceMappings();
    this.api.post<{ sale: ApiRecord; invoice: ApiRecord; coupon?: ApiRecord | null; invoiceDocument?: ApiRecord }>('sales/checkout', {
      ...this.form.value,
      billingDate,
      invoiceDate: billingDate,
      billingTimestamp,
      items: this.items().map((item) => ({
        ...item,
        lineGross: this.lineGross(item),
        lineDiscountAmount: this.lineDiscountAmount(item),
        lineTaxableSubtotal: this.lineTaxableSubtotal(item)
      })),
      discount: this.money(this.manualDiscountAmount + this.itemManualDiscountTotal),
      discountMode: 'amount',
      discountBreakdown: {
        manualDiscountAmount: this.manualDiscountAmount,
        itemDiscountTotal: this.itemDiscountTotal,
        itemManualDiscountTotal: this.itemManualDiscountTotal,
        membershipAutoDiscount: this.membershipAutoDiscount,
        prepaidMembershipRedeemDiscount: this.prepaidMembershipRedeemDiscount,
        membershipCreditAdjustmentAmount: this.membershipCreditAdjustmentAmount(),
        couponDiscount: this.couponDiscount,
        totalDiscount: this.totalDiscount
      },
      couponCode: this.couponCode.trim(),
      payments: splitPayments,
      tips: this.tips(),
      tipTotal: this.tipTotal,
      membershipRedeem: {
        ...(this.membershipId ? {
          membershipId: this.membershipId,
          creditsUsed: Number(this.creditsUsed || 0),
          benefitType: this.redeemableBenefitTypeLabel(selectedBenefit),
          benefitName: selectedBenefit?.['planName'] || selectedBenefit?.['name'] || this.membershipId,
          remainingBeforeRedeem: this.selectedRedeemableBenefitRemainingCredits(),
          remainingAfterRedeem: this.benefitRemainingAfterRedeem(),
          invoiceAdjustmentAmount: this.membershipCreditAdjustmentAmount(),
          serviceId: serviceLineMappings[0]?.serviceId || '',
          serviceLineMappings
        } : {}),
        autoDiscountAmount: this.membershipAutoDiscount,
        autoDiscountPercent: this.activeMembershipDiscountPercent(),
        autoDiscountMembershipId: this.activeMembershipForClient()?.id || ''
      }
    }).subscribe({
      next: (result) => {
        if (walletCreditAmount > 0) {
          this.creditOverpayToWallet(result, walletCreditAmount, settlementPreview);
          return;
        }
        this.finishCheckout(result, '', settlementPreview);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save sale');
        this.saving.set(false);
      }
    });
  }

  private invoicePaymentEntries(): Array<{ mode: string; amount: number; reference: string; label: string }> {
    let remaining = this.total;
    const entries: Array<{ mode: string; amount: number; reference: string; label: string }> = [];
    const bookingAdvanceAmount = Math.min(this.appliedBookingAdvanceAmount(), remaining);
    const appointmentId = String(this.form.value.appointmentId || '');
    if (bookingAdvanceAmount > 0) {
      entries.push({
        mode: 'booking_advance',
        amount: bookingAdvanceAmount,
        reference: appointmentId ? `Booking advance from appointment ${appointmentId}` : 'Booking advance adjustment',
        label: this.paymentModeLabel('booking_advance')
      });
      remaining = this.money(remaining - bookingAdvanceAmount);
    }
    for (const [mode, rawAmount] of Object.entries(this.payments)) {
      if (remaining <= 0) break;
      const amount = Math.min(this.money(rawAmount), remaining);
      if (amount <= 0) continue;
      entries.push({
        mode,
        amount,
        reference: mode === 'upi' ? 'UPI collected at counter' : '',
        label: this.paymentModeLabel(mode)
      });
      remaining = this.money(remaining - amount);
    }
    return entries;
  }

  private creditOverpayToWallet(
    result: { sale: ApiRecord; invoice: ApiRecord; coupon?: ApiRecord | null; invoiceDocument?: ApiRecord },
    amount: number,
    settlementPreview?: { advance: number; counter: number; due: number; walletCredit: number }
  ): void {
    const clientId = String(this.form.value.clientId || '');
    this.api.post<{ transaction: ApiRecord; client: ApiRecord }>(`clients/${clientId}/wallet`, {
      type: 'credit',
      amount,
      branchId: this.form.value.branchId || '',
      referenceType: 'invoice_overpay',
      referenceId: result.invoice.id,
      notes: `Extra POS payment from invoice ${result.invoice.invoiceNumber || result.invoice.id}`,
      billingDate: this.invoiceDateValue(),
      createdAt: this.selectedInvoiceTimestamp()
    }).subscribe({
      next: (walletResult) => {
        if (walletResult?.client) {
          this.clients.update((clients) => clients.map((client) => client.id === walletResult.client.id ? walletResult.client : client));
        }
        this.finishCheckout(result, `Extra â‚¹${amount} added to client wallet.`, settlementPreview);
      },
      error: (error) => {
        this.invoice.set(result.invoice);
        this.error.set(`Invoice saved, but wallet credit failed: ${error?.error?.error || error?.message || 'wallet error'}`);
        this.saving.set(false);
      }
    });
  }

  private finishCheckout(
    result: { sale: ApiRecord; invoice: ApiRecord; coupon?: ApiRecord | null; invoiceDocument?: ApiRecord },
    message = '',
    settlementPreview?: { advance: number; counter: number; due: number; walletCredit: number }
  ): void {
    const benefitRedeem = this.readJsonObject(result.sale?.membershipRedeem);
    const invoiceNumber = String(result.invoice?.invoiceNumber || result.invoice?.id || 'Invoice');
    this.invoice.set(result.invoice);
    this.generatedInvoiceSettlement.set(settlementPreview || this.currentSettlementPreview());
    this.generatedInvoiceBenefitRedeem.set(Number(benefitRedeem?.['creditsUsed'] || 0) > 0 ? benefitRedeem : null);
    this.couponResult.set(result.coupon || null);
    if (this.currentHoldId) this.posSettings.deleteHeldInvoice(this.currentHoldId);
    this.posSettings.clearActiveBillingDraft();
    this.currentHoldId = '';
    this.items.set([]);
    this.tips.set([]);
    this.payments = Object.fromEntries(this.activePaymentModes().map((mode) => [mode.id, 0]));
    this.walletCreditRequested.set(false);
    this.bookingAdvanceInfo.set(null);
    this.bookingAdvanceLoading.set(false);
    this.bookingAdvanceAppliedAmount.set(0);
    this.discount = 0;
    this.discountMode = 'amount';
    this.couponCode = '';
    this.creditsUsed = 0;
    this.membershipId = '';
    this.benefitServiceMappings = [];
    this.clientSearchText = '';
    this.staffSearchText = '';
    this.serviceSearchText = '';
    this.productSearchText = '';
    this.clientSearchActive = false;
    this.selectedServiceId = '';
    this.selectedServiceIds = [];
    this.selectedProductId = '';
    this.selectedProductIds = [];
    this.staffSearchActive = false;
    this.clientSearchResults.set([]);
    this.membershipEligibility.set(null);
    this.membershipSuggestion.set(null);
    this.tipDraft = { staffId: '', paymentMode: this.activePaymentModes()[0]?.id || 'cash', amount: 0, note: '' };
    this.unpaidReceiveAmount = 0;
    this.unpaidReceiveMessage.set('');
    this.selectedClientId.set('');
    this.form.patchValue({ clientId: '', staffId: '', appointmentId: '', invoiceDate: this.todayDateInput() }, { emitEvent: false });
    this.saving.set(false);
    this.clearPosRouteSelection(() => {
      this.load();
      this.dataHint.set(message || `${invoiceNumber} generated. Fresh POS bill ready.`);
    });
  }

  private clearPosRouteSelection(onFinally?: () => void): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true
    }).finally(() => onFinally?.());
  }

  printInvoice(): void {
    window.print();
  }

  downloadInvoice(): void {
    const invoice = this.invoice();
    if (!invoice) return;
    this.api.post<ApiRecord>(`invoices/${invoice.id}/document`, {}).subscribe({
      next: (documentRecord) => {
        const blob = new Blob([String(documentRecord.content || '')], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${invoice.invoiceNumber}.html`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (error) => this.error.set(error?.error?.error || 'Unable to download invoice')
    });
  }

  clientName(id: string): string {
    return this.clients().find((client) => client.id === id)?.name || 'Client';
  }

  activeMembershipForClient(): ApiRecord | undefined {
    const walletMembership = this.membershipEligibility()?.['wallet']?.['activeMembership'];
    if (walletMembership) return walletMembership;
    const eligibilityMembership = this.membershipEligibility()?.activeMembership;
    if (eligibilityMembership) return eligibilityMembership;
    const clientId = this.form.value.clientId;
    return this.activeMembershipForClientId(String(clientId || ''));
  }

  activeMembershipForClientId(clientId: string): ApiRecord | undefined {
    const today = new Date().toISOString().slice(0, 10);
    return this.memberships()
      .filter((membership) => membership.clientId === clientId && membership.status !== 'expired' && (!membership.validityDate || membership.validityDate >= today))
      .sort((a, b) => this.membershipDiscountPercent(b) - this.membershipDiscountPercent(a))[0];
  }

  activePackageCountForClientId(clientId: string): number {
    const today = new Date().toISOString().slice(0, 10);
    return this.memberships().filter((membership) =>
      membership.clientId === clientId
      && membership.status !== 'expired'
      && (!membership.validityDate || membership.validityDate >= today)
      && this.membershipBenefitType(membership) === 'package'
    ).length;
  }

  trackPackageRedeemRow(_index: number, row: PackageRedeemRow): string {
    return row.id;
  }

  private clientPackageRecords(clientId: string): ApiRecord[] {
    return this.memberships().filter((membership) =>
      String(membership.clientId || membership.client_id || '') === clientId
      && this.membershipBenefitType(membership) === 'package'
    );
  }

  private packageCreditRows(membership: ApiRecord): PackageRedeemRow[] {
    const credits = this.packageServiceCredits(membership);
    const status = this.packageStatus(membership);
    const packageName = this.packageDisplayName(membership);
    const expiry = membership.validityDate ? this.dateLabel(membership.validityDate) : 'No expiry';
    if (!credits.length) {
      const pendingQty = this.packageRemainingCredits(membership);
      return [{
        id: `${membership.id || membership.membershipId || packageName}:package`,
        membershipId: String(membership.id || membership.membershipId || ''),
        packageName,
        serviceId: '',
        serviceName: 'Package credit',
        pendingQty,
        totalQty: this.packageTotalCredits(membership),
        expiry,
        status
      }];
    }
    return credits.map((credit, index) => {
      const serviceId = String(credit.serviceId || credit.service_id || credit.id || '');
      const service = this.services().find((item) => String(item.id || '') === serviceId);
      const qty = Math.max(0, Number(credit.remaining ?? credit.creditsRemaining ?? credit.credits ?? credit.quantity ?? 0));
      return {
        id: `${membership.id || membership.membershipId || packageName}:${serviceId || index}`,
        membershipId: String(membership.id || membership.membershipId || ''),
        packageName,
        serviceId,
        serviceName: String(credit.serviceName || credit.name || service?.name || serviceId || 'Package service'),
        pendingQty: Math.min(qty, this.packageRemainingCredits(membership) || qty),
        totalQty: Number(credit.credits ?? credit.quantity ?? qty),
        expiry,
        status
      };
    });
  }

  packageRedeemQty(row: PackageRedeemRow): number {
    const current = this.packageRedeemQuantities[row.id];
    if (current !== undefined) return Math.min(Math.max(0, Number(current || 0)), row.pendingQty);
    return 0;
  }

  setPackageRedeemQty(row: PackageRedeemRow, value: number | string): void {
    this.packageRedeemQuantities[row.id] = Math.min(row.pendingQty, Math.max(0, Math.floor(Number(value || 0))));
    if (this.error().includes('Package service')) this.error.set('');
  }

  packageRedeemStaff(row: PackageRedeemRow): string {
    return this.packageRedeemStaffIds[row.id] || String(this.form.value.staffId || '');
  }

  setPackageRedeemStaff(row: PackageRedeemRow, staffId: string): void {
    this.packageRedeemStaffIds[row.id] = String(staffId || '');
  }

  redeemPackageRow(row: PackageRedeemRow): void {
    const credits = this.packageRedeemQty(row);
    if (row.status === 'expired' || credits <= 0) return;
    const staffId = this.packageRedeemStaff(row);
    const lineId = this.packageRedeemLineId(row);
    let lineIndex = this.items().findIndex((item) => this.isPackageRedeemLine(item, lineId));
    if (lineIndex < 0) {
      this.addPackageRedeemServiceLine(row, staffId, credits);
      lineIndex = this.items().findIndex((item) => this.isPackageRedeemLine(item, lineId));
    }
    if (lineIndex < 0) {
      this.error.set('Package redeem service line could not be prepared.');
      return;
    }
    const line = this.redeemableServiceLines().find((item) => item.lineIndex === lineIndex);
    this.membershipId = row.membershipId;
    this.creditsUsed = credits;
    this.benefitServiceMappings = [{
      lineIndex,
      serviceId: lineId,
      serviceName: line?.serviceName || row.serviceName,
      credits
    }];
    this.error.set('');
    this.dataHint.set(`${row.packageName} package redeem selected: ${credits} credit(s) for ${row.serviceName}.`);
  }

  private addPackageRedeemServiceLine(row: PackageRedeemRow, staffId: string, credits: number): void {
    const service = this.services().find((item) => String(item.id || '') === row.serviceId);
    const type: SaleItem['type'] = service ? 'service' : 'package_redeem';
    this.items.update((items) => [
      ...items,
      {
        type,
        id: this.packageRedeemLineId(row),
        name: service?.name || row.serviceName || 'Package service',
        quantity: Math.max(1, credits),
        price: 0,
        gstRate: Number(service?.gstRate || 0),
        ...this.defaultItemStaff(staffId),
        discountType: 'amount',
        discountValue: 0,
        discountSource: 'none'
      }
    ]);
    this.normalizeBenefitServiceMappings();
    this.clearCoupon();
  }

  private packageRedeemLineId(row: PackageRedeemRow): string {
    return row.serviceId || `package-redeem:${row.id}`;
  }

  private isPackageRedeemLine(item: SaleItem, lineId: string): boolean {
    return (item.type === 'service' || item.type === 'package_redeem') && String(item.id || '') === lineId;
  }

  private packageStatus(membership: ApiRecord): 'active' | 'expired' {
    const today = new Date().toISOString().slice(0, 10);
    const status = String(membership.status || '').toLowerCase();
    if (status === 'expired' || status === 'cancelled' || status === 'inactive') return 'expired';
    if (membership.validityDate && String(membership.validityDate) < today) return 'expired';
    return this.packageRemainingCredits(membership) > 0 ? 'active' : 'expired';
  }

  private packageDisplayName(membership: ApiRecord): string {
    return String(membership.planName || membership.name || membership.membershipId || 'Package').replace(/^Package:\s*/i, '');
  }

  private packageRemainingCredits(membership: ApiRecord): number {
    if (membership.creditsRemaining !== undefined || membership.credits_remaining !== undefined) {
      return Math.max(0, Number(membership.creditsRemaining ?? membership.credits_remaining ?? 0));
    }
    const credits = this.packageServiceCredits(membership);
    return credits.reduce((sum, credit) => sum + Number(credit.remaining ?? credit.creditsRemaining ?? credit.credits ?? credit.quantity ?? 0), 0);
  }

  private packageTotalCredits(membership: ApiRecord): number {
    const direct = Number(membership.planCredits ?? membership.plan_credits ?? 0);
    if (direct > 0) return direct;
    const credits = this.packageServiceCredits(membership);
    return credits.reduce((sum, credit) => sum + Number(credit.credits ?? credit.quantity ?? credit.remaining ?? credit.creditsRemaining ?? 0), 0);
  }

  private packageServiceCredits(membership: ApiRecord): ApiRecord[] {
    if (Array.isArray(membership.serviceCredits)) return membership.serviceCredits as ApiRecord[];
    const parsed = this.readJsonArray(membership.serviceCredits || membership.service_credits || []);
    return parsed.filter((credit) => credit && typeof credit === 'object') as ApiRecord[];
  }

  private packageSortTime(membership: ApiRecord): number {
    return this.dateMs(membership.validityDate || membership.updatedAt || membership.createdAt);
  }

  activeMembershipDiscountPercent(): number {
    const walletBenefits = this.membershipEligibility()?.['wallet']?.['planBenefits'] as ApiRecord | undefined;
    if (walletBenefits) return Number(walletBenefits['serviceDiscountPercent'] || 0);
    return this.membershipDiscountPercent(this.activeMembershipForClient());
  }

  activeMembershipProductDiscountPercent(): number {
    const walletBenefits = this.membershipEligibility()?.['wallet']?.['planBenefits'] as ApiRecord | undefined;
    if (walletBenefits) return Number(walletBenefits['productDiscountPercent'] || 0);
    return this.membershipProductDiscountPercent(this.activeMembershipForClient());
  }

  private roundOffManualDiscountTarget(): number {
    if (this.roundOffDueAmount <= 0) return this.manualDiscountAmount;
    const base = this.discountableSubtotal();
    const maxManualDiscount = this.money(Math.max(0, base - this.couponDiscount));
    const currentManualDiscount = this.money(Math.min(this.manualDiscountAmount, maxManualDiscount));
    if (base <= 0 || maxManualDiscount <= currentManualDiscount) return currentManualDiscount;

    const targetTotal = this.paidTotal;
    if (this.totalWithManualDiscount(maxManualDiscount) > targetTotal + 0.009) return currentManualDiscount;

    let low = currentManualDiscount;
    let high = maxManualDiscount;
    for (let index = 0; index < 24; index += 1) {
      const mid = (low + high) / 2;
      if (this.totalWithManualDiscount(mid) > targetTotal) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return this.money(high);
  }

  private discountPercentForManualAmount(amount: number): number {
    const base = this.discountableSubtotal();
    if (base <= 0) return 0;
    return this.money(Math.min(100, (this.money(amount) / base) * 100));
  }

  private discountableSubtotal(): number {
    return this.money(Math.max(0, this.subtotal - this.itemDiscountTotal));
  }

  private totalWithManualDiscount(manualDiscountAmount: number): number {
    const discountableSubtotal = this.discountableSubtotal();
    const billDiscount = this.money(Math.min(discountableSubtotal, this.money(manualDiscountAmount) + this.couponDiscount));
    const afterBillDiscountRatio = discountableSubtotal
      ? Math.max(0, discountableSubtotal - billDiscount) / discountableSubtotal
      : 0;
    const gst = this.money(
      this.items().reduce((sum, item) => {
        const taxable = this.lineTaxableSubtotal(item) * afterBillDiscountRatio;
        return sum + taxable * (Number(item.gstRate) / 100);
      }, 0)
    );
    const totalDiscount = this.money(Math.min(this.subtotal, this.itemDiscountTotal + billDiscount));
    return this.money(Math.max(0, this.subtotal - totalDiscount) + gst + this.tipTotal);
  }

  private money(value: number | string): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private normalizeSearch(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
  }

  private compactSearch(value: unknown): string {
    return this.normalizeSearch(value).replace(/\s+/g, '');
  }

  membershipDiscountPercent(membership?: ApiRecord): number {
    const credits = Array.isArray(membership?.serviceCredits) ? membership?.serviceCredits : [];
    const benefit = credits.find((item: ApiRecord) => item?.type === 'bill_discount');
    return Number(benefit?.percent || 0);
  }

  membershipBenefitType(membership?: ApiRecord): 'membership' | 'package' {
    const history = Array.isArray(membership?.redeemHistory) ? membership?.redeemHistory : [];
    if (history.some((item: ApiRecord) => item?.type === 'package_sale' || item?.packageId)) return 'package';
    if (String(membership?.planName || '').trim().toLowerCase().startsWith('package:')) return 'package';
    const credits = Array.isArray(membership?.serviceCredits) ? membership?.serviceCredits : [];
    if (credits.some((item: ApiRecord) => item?.packageId)) return 'package';
    return 'membership';
  }

  membershipProductDiscountPercent(membership?: ApiRecord): number {
    const credits = Array.isArray(membership?.serviceCredits) ? membership?.serviceCredits : [];
    const benefit = credits.find((item: ApiRecord) => item?.type === 'product_discount');
    return Number(benefit?.percent || 0);
  }

  private loadMembershipIntelligence(clientId: string): void {
    if (!clientId) {
      this.membershipEligibility.set(null);
      this.membershipSuggestion.set(null);
      this.benefitServiceMappings = [];
      return;
    }
    forkJoin({
      eligibility: this.api.list<ApiRecord>(`membership-enterprise/client/${clientId}/eligibility`).pipe(catchError(() => of(null))),
      suggestion: this.api.list<ApiRecord>(`membership-enterprise/client/${clientId}/suggestion`).pipe(catchError(() => of(null)))
    }).subscribe(({ eligibility, suggestion }) => {
      this.membershipEligibility.set(eligibility);
      this.membershipSuggestion.set(suggestion);
      if (this.membershipId) {
        this.selectRedeemableBenefit(this.membershipId);
      }
      this.normalizeBenefitServiceMappings();
      this.applyMembershipDiscountsToEligibleItems();
      this.autoSuggestMembershipRedemption('client');
    });
  }

  private loadBookingAdvanceSuggestion(
    appointmentId: string,
    options: { preserveApplied?: boolean } = {}
  ): void {
    if (!options.preserveApplied) {
      this.bookingAdvanceAppliedAmount.set(0);
    }
    if (!appointmentId) {
      this.bookingAdvanceInfo.set(null);
      this.bookingAdvanceLoading.set(false);
      return;
    }
    this.bookingAdvanceLoading.set(true);
    this.api.list<ApiRecord>(`booking-payments/${appointmentId}/status`).pipe(
      catchError(() => of(null))
    ).subscribe((result) => {
      this.bookingAdvanceLoading.set(false);
      const info = result && typeof result === 'object' ? result : null;
      this.bookingAdvanceInfo.set(info);
      const paidAmount = String(info?.['status'] || '').toLowerCase() === 'paid'
        ? this.money(Number(info?.['amount'] || 0))
        : 0;
      if (options.preserveApplied) {
        this.bookingAdvanceAppliedAmount.set(this.money(Math.min(this.total, Number(this.bookingAdvanceAppliedAmount() || 0), paidAmount)));
      } else if (paidAmount <= 0) {
        this.bookingAdvanceAppliedAmount.set(0);
      }
    });
  }

  private applyMembershipDiscountsToEligibleItems(): void {
    const nextItems = this.items().map((item, index) => {
      if (!['service', 'product'].includes(item.type)) return item;
      if (item.discountSource === 'manual') return item;
      if (this.selectedRedeemableBenefit() && this.serviceLineMappedCredits(index) > 0) {
        return {
          ...item,
          discountType: 'amount' as ItemDiscountType,
          discountValue: 0,
          discountSource: 'none' as ItemDiscountSource
        };
      }
      return {
        ...item,
        ...this.defaultItemDiscount(item.type)
      };
    });
    this.items.set(nextItems);
  }

  private normalizeMembershipPlan(plan: PosMembershipPlan): PosMembershipPlan {
    const benefitRules = plan.benefitRules || {};
    const planType = String(plan.planType || benefitRules['planType'] || (benefitRules['prepaidCredit'] ? 'prepaid_credit' : 'discount'));
    const price = Number(plan.price || 0);
    const creditAmount = Math.max(0, Number(plan.creditAmount || benefitRules['creditAmount'] || 0));
    const bonusAmount = Math.max(0, Number(plan.bonusAmount || benefitRules['bonusAmount'] || Math.max(0, creditAmount - price)));
    const perVisitLimit = (benefitRules['perVisitLimit'] || {}) as ApiRecord;
    const serviceRestriction = (benefitRules['serviceRestriction'] || {}) as ApiRecord;
    return {
      ...plan,
      price,
      discountPercent: Number(plan.discountPercent || 0),
      productDiscountPercent: Number(plan.productDiscountPercent || 0),
      planType,
      creditAmount,
      bonusAmount,
      benefitPercent: Number(plan.benefitPercent || benefitRules['benefitPercent'] || (price > 0 ? Math.round((bonusAmount / price) * 100) : 0)),
      perVisitLimitType: String(plan.perVisitLimitType || perVisitLimit['type'] || 'none'),
      perVisitLimitValue: Number(plan.perVisitLimitValue || perVisitLimit['value'] || 0),
      serviceRestrictionType: String(plan.serviceRestrictionType || serviceRestriction['type'] || 'all'),
      serviceRestrictionValue: String(plan.serviceRestrictionValue || serviceRestriction['value'] || ''),
      allowProductRedeem: Boolean(plan.allowProductRedeem || benefitRules['allowProductRedeem']),
      gstRate: Number(plan.gstRate || 18),
      validityDays: Number(plan.validityDays || 365),
      active: plan.active !== false && plan.status !== 'inactive',
      status: plan.status || (plan.active === false ? 'inactive' : 'active'),
      createdAt: plan.createdAt || new Date().toISOString()
    };
  }

  membershipPlanLabel(plan: PosMembershipPlan): string {
    const businessLabel = this.membershipBusinessLabel(plan);
    if (businessLabel) return `${plan.name} - ${businessLabel}`;
    if (this.membershipPlanType(plan) === 'prepaid_credit') {
      return `${plan.name} - Pay â‚¹${Math.round(Number(plan.price || 0)).toLocaleString('en-IN')} / Get â‚¹${Math.round(this.membershipPlanCreditAmount(plan)).toLocaleString('en-IN')} credit`;
    }
    return `${plan.name} - â‚¹${Math.round(Number(plan.price || 0)).toLocaleString('en-IN')} / ${Number(plan.discountPercent || 0)}% every bill`;
  }

  private membershipBusinessLabel(plan: PosMembershipPlan | null | undefined): string {
    if (!plan) return '';
    const rules = plan.benefitRules || {};
    const planType = this.membershipPlanType(plan);
    const credits = this.membershipPlanCreditAmount(plan);
    if (planType === 'prepaid_credit') return `Pay â‚¹${Math.round(Number(plan.price || 0)).toLocaleString('en-IN')} / Get â‚¹${Math.round(credits).toLocaleString('en-IN')} credit`;
    if (planType === 'visit_pack') return `${credits || 10} visits`;
    if (planType === 'service_credit') return `${credits || 1} service credits`;
    if (planType === 'combo') return `${credits || 1} combo credits`;
    if (planType === 'unlimited') return `Unlimited ${Number(((rules['fairUsage'] || {}) as ApiRecord)['monthlyCap'] || 4)} / month`;
    if (planType === 'family') return `Family ${Number(((rules['family'] || {}) as ApiRecord)['memberLimit'] || 4)} members`;
    if (planType === 'corporate') return `Corporate ${String(((rules['corporate'] || {}) as ApiRecord)['label'] || plan.name)} ${Number(plan.discountPercent || 0)}%`;
    if (planType === 'tiered') return `Tier ${String(((rules['tier'] || {}) as ApiRecord)['name'] || plan.name)} after â‚¹${Math.round(Number(((rules['tier'] || {}) as ApiRecord)['spendThreshold'] || 0)).toLocaleString('en-IN')}`;
    return '';
  }

  private membershipPlanType(plan: PosMembershipPlan | null | undefined): string {
    const rules = plan?.benefitRules || {};
    return String(plan?.planType || rules['planType'] || (rules['prepaidCredit'] ? 'prepaid_credit' : 'discount'));
  }

  private membershipPlanCreditAmount(plan: PosMembershipPlan | null | undefined): number {
    const rules = plan?.benefitRules || {};
    if (this.membershipPlanType(plan) === 'unlimited') return Math.max(1, Number(((rules['fairUsage'] || {}) as ApiRecord)['monthlyCap'] || 4));
    return Math.max(0, Number(plan?.creditAmount || rules['creditAmount'] || rules['credits'] || 0));
  }

  private membershipPlanBonusAmount(plan: PosMembershipPlan | null | undefined): number {
    const rules = plan?.benefitRules || {};
    return Math.max(0, Number(plan?.bonusAmount || rules['bonusAmount'] || Math.max(0, this.membershipPlanCreditAmount(plan) - Number(plan?.price || 0))));
  }

  private membershipDaysLeft(membership: ApiRecord): number {
    if (!membership.validityDate) return 99999;
    const expiry = this.dateMs(membership.validityDate);
    const today = this.dateMs(new Date().toISOString().slice(0, 10));
    if (!expiry) return 99999;
    return Math.ceil((expiry - today) / 86400000);
  }

  private dateLabel(value: unknown): string {
    if (!value) return '-';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private timeLabel(value: unknown): string {
    if (!value) return '';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }

  private dateMs(value: unknown): number {
    const time = new Date(String(value || '')).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  private futureDate(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  private safeList(resource: string, params: ApiRecord = {}) {
    return this.api.list<ApiRecord[]>(resource, params).pipe(
      catchError((error) => {
        this.loadFailures.add(resource);
        console.warn(`POS ${resource} list failed`, error);
        return of([]);
      })
    );
  }

  private staffQueryParams(branchId = this.posStaffBranchId()): ApiRecord {
    return {
      limit: 200,
      status: 'active',
      branchId
    };
  }

  private posStaffBranchId(): string {
    return String(this.form.value.branchId || this.appState.selectedBranchId() || '');
  }

  currentBranchName(): string {
    const branchId = this.posStaffBranchId();
    if (!branchId) return 'Header branch not selected';
    return this.branches().find((branch) => branch.id === branchId)?.name || branchId;
  }

  private loadStaffForBranch(branchId: string): void {
    this.safeList('staff-os/staff', this.staffQueryParams(branchId)).subscribe((staff) => {
      this.applyStaffRows(staff || [], this.branches());
      this.clearUnavailableStaffSelection();
    });
  }

  private applyStaffRows(staff: ApiRecord[], branches: ApiRecord[]): void {
    this.staff.set(this.activeStaff(this.normalizeStaffRows(staff || [], branches || [])));
  }

  private reloadStaffIfBranchScopeChanged(initialStaff: ApiRecord[]): void {
    const branchId = this.posStaffBranchId();
    if (!branchId || !initialStaff.length) return;
    const hasDifferentBranch = initialStaff.some((person) => String(person.branchId || person.branch_id || '') !== branchId);
    if (hasDifferentBranch) this.loadStaffForBranch(branchId);
  }

  private clearUnavailableStaffSelection(): void {
    const selectedStaffId = String(this.form.value.staffId || '');
    if (!selectedStaffId || this.staff().some((person) => String(person.id || '') === selectedStaffId)) return;
    this.clearStaffSelection();
    for (const item of this.items()) {
      if (item.staffId === selectedStaffId) {
        item.staffId = '';
        item.staffName = '';
      }
      if (item.staffSplits?.length) {
        item.staffSplits = item.staffSplits.filter((split) => split.staffId !== selectedStaffId);
      }
    }
    this.items.set([...this.items()]);
    if (this.tipDraft.staffId === selectedStaffId) this.tipDraft.staffId = '';
  }

  private applyDefaultBranch(branches: ApiRecord[]): void {
    if (!branches.length || this.form.value.branchId) return;
    const selectedBranchId = this.appState.selectedBranchId();
    const selected = branches.find((branch) => branch.id === selectedBranchId) || branches[0];
    if (selected?.id) {
      this.form.patchValue({ branchId: selected.id }, { emitEvent: false });
    }
  }

  private syncHeaderBranchToForm(branchId: string, emitEvent: boolean): void {
    if (!branchId || this.form.get('branchId')?.value === branchId) return;
    this.form.patchValue({ branchId }, { emitEvent });
  }

  private activeStaff(staff: ApiRecord[]): ApiRecord[] {
    const inactiveStatuses = new Set(['archived', 'blocked', 'deleted', 'inactive', 'not active', 'suspended', 'terminated']);
    return staff.filter((person) => {
      if (person.active === false || person.isActive === false || person.is_active === 0 || person.archived === true) {
        return false;
      }
      const status = this.normalizeSearch(person.status || person.state || person.employmentStatus || person.staffStatus || '');
      return !status || !inactiveStatuses.has(status);
    });
  }

  private normalizeStaffRows(staff: ApiRecord[], branches: ApiRecord[]): ApiRecord[] {
    const branchNameById = new Map(branches.map((branch) => [String(branch.id || ''), String(branch.name || branch.branchName || '')]));
    return staff.map((person) => {
      const branchId = String(person.branchId || person.branch_id || '');
      const fullName = String(person.fullName || person.full_name || person.name || '').trim();
      const mobile = String(person.mobile || person.phone || person.contact || '').trim();
      const designation = person.designation || person.role || person.staffCategoryName || person.department || 'Staff';
      const displayName = fullName || String(person.employeeCode || person.id || 'Staff');
      return {
        ...person,
        branchId,
        name: displayName,
        fullName: displayName,
        phone: mobile,
        mobile,
        role: designation,
        designation,
        branchName: person.branchName || person.branch_name || branchNameById.get(branchId) || branchId
      };
    });
  }

  private shouldSwitchToDemoTenant(data: { clients: ApiRecord[]; staff: ApiRecord[]; services: ApiRecord[]; products: ApiRecord[]; branches: ApiRecord[] }): boolean {
    if (this.fallbackTried || this.loadFailures.size) return false;
    if (this.appState.selectedTenantId() === 'tenant_aura') return false;
    return !data.clients.length && !data.staff.length && !data.services.length && !data.products.length && !data.branches.length;
  }

  private setDataHint(data: { clients: ApiRecord[]; staff: ApiRecord[]; services: ApiRecord[]; products: ApiRecord[]; branches: ApiRecord[] }): void {
    if (this.loadFailures.size) {
      this.dataHint.set(`Some POS lists could not load: ${[...this.loadFailures].join(', ')}. Baaki fields usable hain.`);
      return;
    }
    const empty = Object.entries(data)
      .filter(([, rows]) => !rows.length)
      .map(([name]) => name);
    if (empty.length) {
      this.dataHint.set(`No records found for: ${empty.join(', ')}. Check selected tenant or branch data.`);
      return;
    }
    if (this.fallbackNotice) {
      this.dataHint.set('Previous tenant POS data was empty, so the default catalog was loaded.');
      this.fallbackNotice = false;
      return;
    }
    this.dataHint.set('');
  }
}
