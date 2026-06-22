import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, forkJoin } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuthSessionService } from '../core/auth-session.service';
import { StateComponent } from '../shared/ui/state/state.component';

type EodSession = ApiRecord & {
  id: string;
  businessDate: string;
  status: 'open' | 'closed';
  openingBalancePaise?: number;
  cashCollectedPaise?: number;
  cashPayoutPaise?: number;
  cashOperationImpactPaise?: number;
  cashDropPaise?: number;
  cashPickupPaise?: number;
  pettyCashPayoutPaise?: number;
  safeMovePaise?: number;
  expectedCashPaise?: number;
  countedCashPaise?: number;
  variancePaise?: number;
  varianceReason?: string;
  blindClose?: boolean;
  blindResult?: { matched?: boolean; managerApprovalRequired?: boolean };
  denominations?: DenominationRow[];
  collections?: CollectionRow[];
  settlements?: SettlementRow[];
  operations?: CashOperationRow[];
  operationTotals?: ApiRecord;
  tills?: TillRow[];
  handovers?: ApiRecord[];
  floatSuggestion?: FloatSuggestion;
  risk?: RiskSummary;
  blockers?: string[];
  canClose?: boolean;
};

type DenominationRow = {
  denominationPaise: number;
  kind: 'note' | 'coin';
  qty: number;
  subtotalPaise?: number;
};

type CollectionRow = ApiRecord & {
  mode: string;
  autoAmountPaise?: number;
  finalAmountPaise?: number;
  manualAdjustmentPaise?: number;
  adjustmentReason?: string;
  finalRupees?: number;
};

type SettlementRow = ApiRecord & {
  id: string;
  mode: string;
  grossPaise: number;
  settlementChargePaise: number;
  netPaise: number;
  bankRef: string;
  reconciled: number | boolean;
  grossRupees?: number;
  chargeRupees?: number;
};

type CashOperationRow = ApiRecord & {
  id: string;
  type: 'drop' | 'pickup' | 'payout';
  amountPaise: number;
  impactPaise: number;
  reason: string;
  tillId?: string;
  entryBy?: string;
  entryAt?: string;
};

type TillRow = ApiRecord & {
  id: string;
  tillName: string;
  cashierId?: string;
  status: 'open' | 'closed';
  openingFloatPaise?: number;
  cashCollectedPaise?: number;
  expectedCashPaise?: number;
  countedCashPaise?: number;
  variancePaise?: number;
  cashCollectedRupees?: number;
  countedRupees?: number;
};

type FloatSuggestion = {
  targetFloatPaise?: number;
  suggestedFloatPaise?: number;
  safeMovePaise?: number;
  largeNotePaise?: number;
  keepBreakdown?: DenominationRow[];
  largeNotes?: DenominationRow[];
};

type ThreeWayRow = ApiRecord & {
  mode: string;
  posCollectionPaise: number;
  settlementGrossPaise: number;
  physicalCashPaise: number;
  posSettlementDeltaPaise: number;
  posPhysicalDeltaPaise: number;
  status: 'matched' | 'exception' | 'pending';
  exceptionReason?: string;
};

type ThreeWayResponse = {
  rows: ThreeWayRow[];
  matched: ThreeWayRow[];
  exceptions: ThreeWayRow[];
  pending: ThreeWayRow[];
  depositSlips: ApiRecord[];
  cashierView?: boolean;
};

type AccountingSummary = {
  period?: string;
  periodLocked?: boolean;
  posting?: ApiRecord & { lineBreakdown?: ApiRecord[] };
  taxRegister?: ApiRecord;
  tallyExport?: ApiRecord;
  profitFeed?: ApiRecord;
};

type RiskEvent = {
  code: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  scoreImpact: number;
  title: string;
  detail?: string;
};

type RiskApproval = ApiRecord & {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  reviewNote?: string;
  approvalLink?: string;
  whatsappDeepLink?: string;
  whatsappMessage?: string;
};

type RiskSummary = {
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  evaluatedAt?: string;
  approvalNeeded?: boolean;
  approvalRequired?: boolean;
  approvalStatus: 'not_required' | 'required' | 'pending' | 'approved' | 'rejected';
  canApprove?: boolean;
  approval?: RiskApproval | null;
  cashierTrend?: ApiRecord;
  events: RiskEvent[];
};

type CurrentResponse = {
  session: EodSession | null;
  suggestedOpeningBalancePaise?: number;
  businessDate?: string;
};

type CanCloseResponse = {
  canClose: boolean;
  blockers: string[];
  risk?: RiskSummary;
};

type OwnerRiskRow = ApiRecord & {
  sessionId: string;
  businessDate: string;
  status: string;
  openedBy?: string;
  expectedCashPaise?: number;
  countedCashPaise?: number;
  variancePaise?: number;
  riskScore: number;
  riskLevel: string;
  approvalStatus: string;
  approval?: RiskApproval | null;
  approvalLink?: string;
  whatsappDeepLink?: string;
  settlementMatched?: number;
  settlementPending?: number;
  settlementExceptions?: number;
  blockers?: string[];
  topEvents?: RiskEvent[];
};

type OwnerRiskDashboard = {
  dateFrom: string;
  dateTo: string;
  summary: ApiRecord;
  rows: OwnerRiskRow[];
};

type SettlementImportSummary = ApiRecord & {
  importId?: string;
  rowCount?: number;
  matchedCount?: number;
  pendingCount?: number;
  unmatchedCount?: number;
};

type TokenApprovalContext = {
  tokenStatus: string;
  expired?: boolean;
  request?: RiskApproval | null;
  session?: {
    id: string;
    businessDate: string;
    branchId: string;
    status: string;
    openedBy?: string;
    expectedCashPaise?: number;
    countedCashPaise?: number;
    variancePaise?: number;
  };
  risk?: {
    score: number;
    level: string;
    approvalStatus: string;
    events: RiskEvent[];
  };
};

type CashWorkspaceKey =
  | 'overview'
  | 'cashCount'
  | 'collections'
  | 'operations'
  | 'reconciliation'
  | 'risk'
  | 'accounting'
  | 'float'
  | 'closeReport';

type CashWorkspaceCategory = {
  key: CashWorkspaceKey;
  label: string;
  source: string;
};

const DENOMINATION_TEMPLATE: DenominationRow[] = [
  { denominationPaise: 200000, kind: 'note', qty: 0 },
  { denominationPaise: 50000, kind: 'note', qty: 0 },
  { denominationPaise: 20000, kind: 'note', qty: 0 },
  { denominationPaise: 10000, kind: 'note', qty: 0 },
  { denominationPaise: 5000, kind: 'note', qty: 0 },
  { denominationPaise: 2000, kind: 'note', qty: 0 },
  { denominationPaise: 1000, kind: 'note', qty: 0 },
  { denominationPaise: 500, kind: 'note', qty: 0 },
  { denominationPaise: 2000, kind: 'coin', qty: 0 },
  { denominationPaise: 1000, kind: 'coin', qty: 0 },
  { denominationPaise: 500, kind: 'coin', qty: 0 },
  { denominationPaise: 200, kind: 'coin', qty: 0 },
  { denominationPaise: 100, kind: 'coin', qty: 0 }
];

@Component({
  selector: 'app-cash-drawer-eod',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="cash-eod-page">
      <header class="module-hero">
        <div>
          <span class="eyebrow">POS / Day close</span>
          <h2>Cash Drawer Tally</h2>
          <p>Open the drawer day, count notes and coins blind, reconcile bank settlements and close the shift.</p>
        </div>
        <div class="hero-actions">
          <input type="date" [(ngModel)]="businessDate" />
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
          <a class="ghost-button" routerLink="/pos">Back to POS</a>
        </div>
      </header>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <p class="state success" *ngIf="success()">{{ success() }}</p>

      <section class="panel token-approval-panel" *ngIf="tokenApproval() as approvalContext">
        <div>
          <span class="eyebrow">WhatsApp approval link</span>
          <h3>Owner cash-risk approval</h3>
          <p>{{ approvalContext.session?.businessDate }} · risk {{ approvalContext.risk?.score || 0 }}/100 {{ approvalContext.risk?.level || 'low' }}</p>
        </div>
        <div class="approval-link-grid">
          <span>Status <strong [class.warn]="approvalContext.tokenStatus === 'pending' || approvalContext.tokenStatus === 'expired'">{{ approvalContext.tokenStatus }}</strong></span>
          <span>Expected <strong>{{ money(approvalContext.session?.expectedCashPaise) }}</strong></span>
          <span>Counted <strong>{{ money(approvalContext.session?.countedCashPaise) }}</strong></span>
          <span>Variance <strong [class.warn]="approvalContext.session?.variancePaise">{{ money(approvalContext.session?.variancePaise) }}</strong></span>
        </div>
        <div class="risk-events" *ngIf="approvalContext.risk?.events?.length">
          <article *ngFor="let event of approvalContext.risk?.events || []" [class.high]="event.severity === 'high' || event.severity === 'critical'">
            <strong>{{ event.title }}</strong>
            <span>{{ event.detail }}</span>
          </article>
        </div>
        <label class="field" *ngIf="approvalContext.tokenStatus === 'pending'">
          <span>Owner review note</span>
          <input [(ngModel)]="tokenApprovalReviewNote" placeholder="Optional for approve, required for reject" />
        </label>
        <div class="button-row" *ngIf="approvalContext.tokenStatus === 'pending'">
          <button class="primary-button" type="button" (click)="reviewTokenApproval('approved')" [disabled]="saving()">Approve from WhatsApp link</button>
          <button class="ghost-button danger" type="button" (click)="reviewTokenApproval('rejected')" [disabled]="saving() || !tokenApprovalReviewNote.trim()">Reject</button>
        </div>
      </section>

      <section class="cash-workspace-shell" *ngIf="!loading() && !approvalToken">
          <aside class="cash-category-rail" aria-label="Cash drawer tally KPIs">
            <button
              type="button"
              class="cash-category-tile"
              *ngFor="let item of cashWorkspaceCategories"
              [class.active]="cashWorkspace() === item.key"
              [attr.data-state]="cashWorkspaceState(item.key, session())"
              (click)="cashWorkspace.set(item.key)">
              <span>{{ item.label }}</span>
              <strong>{{ cashWorkspaceValue(item.key, session()) }}</strong>
              <small>{{ cashWorkspaceNote(item.key, session()) }}</small>
            </button>
          </aside>

          <div class="cash-workspace-detail">
            <div class="detail-head">
              <div>
                <span class="eyebrow">Selected KPI</span>
                <h3>{{ selectedCashWorkspace().label }}</h3>
                <p>{{ selectedCashWorkspace().source }}</p>
              </div>
              <span class="status-pill" [attr.data-state]="cashWorkspaceState(cashWorkspace(), session())">
                {{ cashWorkspaceState(cashWorkspace(), session()) }}
              </span>
            </div>

            <ng-container *ngIf="session() as active; else openDayWorkspace">

            <section class="metric-grid" *ngIf="cashWorkspace() === 'overview'">
              <article><span>Status</span><strong>{{ active.status }}</strong><small>{{ active.businessDate }}</small></article>
              <article *ngIf="!isBlind(active)"><span>Expected cash</span><strong>{{ money(active.expectedCashPaise) }}</strong><small>Opening + cash invoices - payout</small></article>
              <article><span>Counted cash</span><strong>{{ money(countedTotal()) }}</strong><small>Notes and coins entered</small></article>
              <article *ngIf="!isBlind(active)"><span>Variance</span><strong [class.warn]="(active.variancePaise || 0) !== 0">{{ money(active.variancePaise) }}</strong><small>Zero required unless manager override</small></article>
              <article *ngIf="isBlind(active)"><span>Blind close</span><strong>{{ active.blindResult?.matched ? 'Matched' : active.blindResult?.managerApprovalRequired ? 'Approval' : 'Counting' }}</strong><small>Expected and variance hidden for cashier</small></article>
            </section>

            <div class="workspace" *ngIf="cashWorkspace() === 'cashCount' || cashWorkspace() === 'operations' || cashWorkspace() === 'collections'">
              <section class="panel denomination-panel" *ngIf="cashWorkspace() === 'cashCount'">
            <div class="section-title">
              <div>
                <span class="eyebrow">Physical drawer</span>
                <h3>Note and coin count</h3>
              </div>
              <strong>{{ money(countedTotal()) }}</strong>
            </div>
            <div class="denom-grid">
              <label *ngFor="let row of denominationRows" class="denom-row">
                <span>{{ row.kind }} {{ money(row.denominationPaise) }}</span>
                <input type="number" min="0" step="1" [(ngModel)]="row.qty" (ngModelChange)="touchDenoms()" />
                <strong>{{ money(row.denominationPaise * row.qty) }}</strong>
              </label>
            </div>
            <button class="primary-button" type="button" (click)="saveDenominations(active)" [disabled]="saving()">Save count</button>
          </section>

          <section class="panel" *ngIf="cashWorkspace() === 'operations'">
            <div class="section-title">
              <div>
                <span class="eyebrow">Cash operations</span>
                <h3>Drops, pickups and payouts</h3>
              </div>
            </div>
            <div class="inline-action-grid">
              <label class="field">
                <span>Type</span>
                <select [(ngModel)]="operationDraft.type">
                  <option value="drop">Cash drop</option>
                  <option value="pickup">Cash pickup</option>
                  <option value="payout">Petty payout</option>
                </select>
              </label>
              <label class="field">
                <span>Amount</span>
                <input type="number" min="0" step="0.01" [(ngModel)]="operationDraft.amountRupees" />
              </label>
              <label class="field">
                <span>Till</span>
                <select [(ngModel)]="operationDraft.tillId">
                  <option value="">Main till</option>
                  <option *ngFor="let till of tillRows()" [value]="till.id">{{ till.tillName }}</option>
                </select>
              </label>
              <label class="field wide">
                <span>Reason</span>
                <input [(ngModel)]="operationDraft.reason" placeholder="Safe drop, change pickup, chai/supplies" />
              </label>
              <button class="primary-button" type="button" (click)="saveOperation(active)" [disabled]="saving()">Add</button>
            </div>
            <div class="operation-list" *ngIf="operationRows().length; else noOps">
              <article *ngFor="let row of operationRows()" class="operation-row">
                <div>
                  <strong>{{ row.type }}</strong>
                  <span>{{ operationImpact(row) }} · {{ row.reason }}</span>
                </div>
                <button class="ghost-button mini" type="button" (click)="deleteOperation(row)" [disabled]="saving()">Delete</button>
              </article>
            </div>
            <ng-template #noOps><p class="empty-state">No mid-day cash movement recorded.</p></ng-template>
          </section>

          <section class="panel" *ngIf="cashWorkspace() === 'operations'">
            <div class="section-title">
              <div>
                <span class="eyebrow">Multi till</span>
                <h3>Tills and handover</h3>
              </div>
              <button class="ghost-button mini" type="button" (click)="createTill(active)" [disabled]="saving()">Add till</button>
            </div>
            <div class="inline-action-grid">
              <label class="field"><span>Till name</span><input [(ngModel)]="tillDraft.tillName" placeholder="Chair 1 till" /></label>
              <label class="field"><span>Cashier ID</span><input [(ngModel)]="tillDraft.cashierId" placeholder="staff/cashier id" /></label>
              <label class="field"><span>Opening float</span><input type="number" min="0" step="0.01" [(ngModel)]="tillDraft.openingFloatRupees" /></label>
            </div>
            <div class="till-list">
              <article *ngFor="let till of tillRows()" class="till-card" [class.closed]="till.status === 'closed'">
                <div>
                  <strong>{{ till.tillName }}</strong>
                  <span>{{ till.status }} · {{ till.cashierId || 'no cashier' }}</span>
                </div>
                <label><span>Cash collected</span><input type="number" min="0" step="0.01" [(ngModel)]="till.cashCollectedRupees" /></label>
                <label><span>Counted</span><input type="number" min="0" step="0.01" [(ngModel)]="till.countedRupees" /></label>
                <small *ngIf="!isBlind(active)">Expected {{ money(till.expectedCashPaise) }} · Variance {{ money(till.variancePaise) }}</small>
                <button class="ghost-button mini" type="button" (click)="closeTill(till)" [disabled]="saving() || till.status === 'closed'">Close till</button>
              </article>
            </div>
            <div class="handover-box">
              <label class="field"><span>Till</span><select [(ngModel)]="handoverDraft.tillId"><option value="">Main till</option><option *ngFor="let till of tillRows()" [value]="till.id">{{ till.tillName }}</option></select></label>
              <label class="field"><span>Incoming cashier</span><input [(ngModel)]="handoverDraft.incomingCashierId" /></label>
              <label class="field"><span>Signature</span><input [(ngModel)]="handoverDraft.signature" placeholder="Manager/cashier sign" /></label>
              <button class="ghost-button" type="button" (click)="handover(active)" [disabled]="saving()">Record handover</button>
            </div>
          </section>

          <section class="panel" *ngIf="cashWorkspace() === 'collections' && !isBlind(active)">
            <div class="section-title">
              <div>
                <span class="eyebrow">Collection by mode</span>
                <h3>Auto pull + manual edit</h3>
              </div>
              <button class="ghost-button mini" type="button" (click)="saveCash(active)" [disabled]="saving()">Save</button>
            </div>
            <label class="field">
              <span>Cash payout</span>
              <input type="number" min="0" step="0.01" [(ngModel)]="cashPayoutRupees" />
            </label>
            <div class="mode-table">
              <div class="mode-head"><span>Mode</span><span>Auto</span><span>Final</span><span>Reason</span></div>
              <div class="mode-row" *ngFor="let row of collectionRows()">
                <strong>{{ row.mode }}</strong>
                <span>{{ money(row.autoAmountPaise) }}</span>
                <input type="number" min="0" step="0.01" [(ngModel)]="row.finalRupees" (ngModelChange)="touchCollections()" />
                <input [(ngModel)]="row.adjustmentReason" placeholder="Reason if adjusted" />
              </div>
            </div>
          </section>

          <section class="panel" *ngIf="cashWorkspace() === 'collections'">
            <div class="section-title">
              <div>
                <span class="eyebrow">Bank settlement</span>
                <h3>Non-cash reconciliation</h3>
              </div>
            </div>
            <div class="settlement-list" *ngIf="settlementRows().length; else noSettlement">
              <article *ngFor="let row of settlementRows()" class="settlement-card">
                <div>
                  <strong>{{ row.mode }}</strong>
                  <span>Gross {{ money(row.grossPaise) }} · Net {{ money(netPaise(row)) }}</span>
                </div>
                <label><span>Charge</span><input type="number" min="0" step="0.01" [(ngModel)]="row.chargeRupees" (ngModelChange)="touchSettlements()" /></label>
                <label><span>Bank ref</span><input [(ngModel)]="row.bankRef" /></label>
                <label class="check-field"><input type="checkbox" [(ngModel)]="row.reconciled" /> Reconciled</label>
                <button class="ghost-button mini" type="button" (click)="saveSettlement(row)" [disabled]="saving()">Save</button>
              </article>
            </div>
            <ng-template #noSettlement>
              <p class="empty-state">No non-cash collection needs settlement yet.</p>
            </ng-template>
          </section>
        </div>

        <section class="panel reconciliation-panel" *ngIf="cashWorkspace() === 'reconciliation'">
          <div class="section-title">
            <div>
              <span class="eyebrow">Three-way reconciliation</span>
              <h3>POS collection, bank settlement and physical count</h3>
            </div>
            <button class="ghost-button mini" type="button" (click)="loadThreeWay(active)" [disabled]="saving()">Refresh match</button>
          </div>
          <div class="recon-tabs">
            <button type="button" [class.active]="reconciliationTab() === 'exception'" (click)="reconciliationTab.set('exception')">Exceptions {{ exceptionRows().length }}</button>
            <button type="button" [class.active]="reconciliationTab() === 'pending'" (click)="reconciliationTab.set('pending')">Pending {{ pendingRows().length }}</button>
            <button type="button" [class.active]="reconciliationTab() === 'matched'" (click)="reconciliationTab.set('matched')">Matched {{ matchedRows().length }}</button>
          </div>
          <div class="recon-grid" *ngIf="visibleReconciliationRows().length; else noReconRows">
            <article *ngFor="let row of visibleReconciliationRows()" class="recon-row" [class.exception]="row.status === 'exception'" [class.pending]="row.status === 'pending'">
              <div>
                <strong>{{ row.mode }}</strong>
                <span>{{ row.status }} · {{ row.exceptionReason || 'auto-pass' }}</span>
              </div>
              <span>POS <strong>{{ money(row.posCollectionPaise) }}</strong></span>
              <span>Settlement <strong>{{ money(row.settlementGrossPaise) }}</strong></span>
              <span>Physical <strong>{{ money(row.physicalCashPaise) }}</strong></span>
              <span>Delta <strong>{{ money(row.posSettlementDeltaPaise || row.posPhysicalDeltaPaise) }}</strong></span>
            </article>
          </div>
          <ng-template #noReconRows>
            <p class="empty-state">No rows for this tab. Matched rows are auto-passed for cashier view.</p>
          </ng-template>

          <div class="recon-tools">
            <div class="csv-box">
              <label class="field">
                <span>Gateway</span>
                <select [(ngModel)]="settlementProvider">
                  <option value="razorpay">Razorpay</option>
                  <option value="pinelabs">Pine Labs</option>
                  <option value="phonepe">PhonePe</option>
                  <option value="paytm">Paytm</option>
                  <option value="gateway">Other</option>
                </select>
              </label>
              <label class="field wide">
                <span>Settlement CSV</span>
                <textarea [(ngModel)]="settlementCsv" rows="5" placeholder="payment_id,amount,fee,net,method,date,settled_at"></textarea>
              </label>
              <button class="primary-button" type="button" (click)="importSettlement(active)" [disabled]="saving() || !settlementCsv.trim()">Import and auto-match</button>
              <div class="match-summary" *ngIf="settlementImportSummary() as importSummary">
                <span>Rows <strong>{{ importSummary.rowCount || 0 }}</strong></span>
                <span>Matched <strong>{{ importSummary.matchedCount || 0 }}</strong></span>
                <span>Pending <strong [class.warn]="importSummary.pendingCount">{{ importSummary.pendingCount || 0 }}</strong></span>
                <span>Unmatched <strong [class.warn]="importSummary.unmatchedCount">{{ importSummary.unmatchedCount || 0 }}</strong></span>
              </div>
            </div>
            <div class="deposit-box">
              <label class="field"><span>Deposit amount</span><input type="number" min="0" step="0.01" [(ngModel)]="depositDraft.amountRupees" /></label>
              <label class="field"><span>Bank</span><input [(ngModel)]="depositDraft.bankName" /></label>
              <label class="field"><span>Deposit ref</span><input [(ngModel)]="depositDraft.depositRef" /></label>
              <button class="ghost-button" type="button" (click)="createDepositSlip(active)" [disabled]="saving()">Generate slip</button>
            </div>
          </div>

          <div class="deposit-list" *ngIf="depositSlips().length">
            <article *ngFor="let slip of depositSlips()" class="deposit-row">
              <div>
                <strong>{{ slip.slipNo }}</strong>
                <span>{{ slip.status }} · {{ slip.bankName || 'bank pending' }}</span>
              </div>
              <strong>{{ money(slip.amountPaise) }}</strong>
              <button class="ghost-button mini" type="button" (click)="confirmDepositSlip(slip)" [disabled]="saving() || slip.status === 'confirmed'">Confirm</button>
            </article>
          </div>
        </section>

        <ng-container *ngIf="cashWorkspace() === 'risk'">
        <section class="panel owner-risk-panel" *ngIf="ownerRiskDashboard() as dashboard">
          <div class="section-title">
            <div>
              <span class="eyebrow">Owner risk dashboard</span>
              <h3>Risk approvals and WhatsApp links</h3>
            </div>
            <button class="ghost-button mini" type="button" (click)="loadOwnerRiskDashboard()" [disabled]="saving()">Refresh dashboard</button>
          </div>
          <div class="risk-grid">
            <span>Pending <strong [class.warn]="dashboard.summary['pendingApproval']">{{ dashboard.summary['pendingApproval'] || 0 }}</strong></span>
            <span>Required <strong [class.warn]="dashboard.summary['approvalRequired']">{{ dashboard.summary['approvalRequired'] || 0 }}</strong></span>
            <span>High risk <strong [class.warn]="dashboard.summary['highRisk']">{{ dashboard.summary['highRisk'] || 0 }}</strong></span>
            <span>Variance <strong>{{ money(dashboard.summary['variancePaise']) }}</strong></span>
            <span>Bank pending <strong [class.warn]="dashboard.summary['settlementPending']">{{ dashboard.summary['settlementPending'] || 0 }}</strong></span>
            <span>Auto-match exceptions <strong [class.warn]="dashboard.summary['settlementExceptions']">{{ dashboard.summary['settlementExceptions'] || 0 }}</strong></span>
          </div>
          <div class="owner-risk-list" *ngIf="dashboard.rows.length; else noOwnerRiskRows">
            <article *ngFor="let row of dashboard.rows" [class.high]="row.riskScore >= 50">
              <div>
                <strong>{{ row.businessDate }} · {{ row.riskScore }}/100 {{ row.riskLevel }}</strong>
                <span>{{ row.approvalStatus }} · {{ row.status }} · variance {{ money(row.variancePaise) }}</span>
                <span>Bank match: {{ row.settlementMatched || 0 }} matched · {{ row.settlementPending || 0 }} pending · {{ row.settlementExceptions || 0 }} exception</span>
              </div>
              <span>{{ row.topEvents?.[0]?.title || 'Review session' }}</span>
              <div class="button-row">
                <a class="ghost-button mini" *ngIf="row.whatsappDeepLink || row.approvalLink" [href]="row.whatsappDeepLink || row.approvalLink" target="_blank" rel="noreferrer">WhatsApp</a>
                <button class="ghost-button mini" type="button" (click)="approveOwnerRisk(row)" [disabled]="saving() || row.approval?.status !== 'pending'">Approve</button>
              </div>
            </article>
          </div>
          <ng-template #noOwnerRiskRows>
            <p class="empty-state">No pending risk approval in this date range.</p>
          </ng-template>
        </section>

        <section class="panel risk-panel" *ngIf="risk() as riskState">
          <div class="section-title">
            <div>
              <span class="eyebrow">Cash risk & approval control</span>
              <h3>Close approval gate</h3>
            </div>
            <button class="ghost-button mini" type="button" (click)="loadRisk(active)" [disabled]="saving()">Refresh risk</button>
          </div>
          <div class="risk-grid">
            <span>Risk score <strong [class.warn]="riskState.score >= 25">{{ riskState.score }}/100</strong></span>
            <span>Level <strong>{{ riskState.level }}</strong></span>
            <span>Approval <strong [class.warn]="riskState.approvalRequired">{{ riskState.approvalStatus }}</strong></span>
            <span>Cashier trend <strong>{{ riskState.cashierTrend?.['varianceSessions'] || 0 }} variance day(s)</strong></span>
          </div>
          <div class="risk-events" *ngIf="riskState.events.length; else noRiskEvents">
            <article *ngFor="let event of riskState.events" [class.high]="event.severity === 'high' || event.severity === 'critical'">
              <strong>{{ event.title }}</strong>
              <span>{{ event.detail }}</span>
            </article>
          </div>
          <ng-template #noRiskEvents>
            <p class="empty-state">No risk event detected for this drawer session.</p>
          </ng-template>
          <div class="approval-box" *ngIf="riskState.approvalRequired || riskState.approval">
            <label class="field">
              <span>Approval reason</span>
              <input [(ngModel)]="approvalReason" [placeholder]="riskState.approval?.reason || 'Reason for variance/risk approval'" />
            </label>
            <label class="field">
              <span>Review note</span>
              <input [(ngModel)]="approvalReviewNote" placeholder="Manager/owner note" />
            </label>
            <div class="button-row">
              <button class="primary-button" type="button" (click)="requestApproval(active)" [disabled]="saving() || !(approvalReason.trim() || varianceReason.trim()) || riskState.approvalStatus === 'approved'">Request approval</button>
              <button class="ghost-button mini" type="button" (click)="reviewApproval('approved')" [disabled]="saving() || riskState.approval?.status !== 'pending'">Approve</button>
              <button class="ghost-button mini danger" type="button" (click)="reviewApproval('rejected')" [disabled]="saving() || riskState.approval?.status !== 'pending' || !approvalReviewNote.trim()">Reject</button>
            </div>
          </div>
        </section>
        </ng-container>

        <section class="panel accounting-panel" *ngIf="cashWorkspace() === 'accounting'">
          <div class="section-title">
            <div>
              <span class="eyebrow">Accounting auto-integration</span>
              <h3>Journal, tax register and Tally export</h3>
            </div>
            <div class="button-row">
              <button class="ghost-button mini" type="button" (click)="loadAccounting(active)" [disabled]="saving()">Refresh</button>
              <button class="ghost-button mini" type="button" (click)="postAccounting(active)" [disabled]="saving() || active.status !== 'closed'">Post journal</button>
              <button class="ghost-button mini" type="button" (click)="loadTallyExport(active, true)" [disabled]="saving()">Tally CSV</button>
            </div>
          </div>
          <div *ngIf="accounting() as acct; else noAccounting" class="accounting-stack">
            <div class="accounting-grid">
              <span>Period <strong>{{ acct.period || '-' }}</strong></span>
              <span>Lock <strong [class.warn]="acct.periodLocked">{{ acct.periodLocked ? 'Locked' : 'Open' }}</strong></span>
              <span>Posting <strong>{{ acct.posting?.['status'] || 'pending' }}</strong></span>
              <span>Journal <strong>{{ acct.posting?.['journalEntryId'] || '-' }}</strong></span>
              <span>{{ acct.taxRegister?.['taxType'] || 'GST' }} <strong>{{ money(acct.taxRegister?.['outputTaxPaise']) }}</strong></span>
              <span>Cash position <strong>{{ money(acct.profitFeed?.['cashPositionPaise']) }}</strong></span>
            </div>
            <div class="ledger-lines" *ngIf="acct.posting?.lineBreakdown?.length">
              <article *ngFor="let line of acct.posting?.lineBreakdown || []">
                <strong>{{ line['accountCode'] }} {{ line['accountName'] }}</strong>
                <span>Dr {{ money(line['debitPaise']) }} · Cr {{ money(line['creditPaise']) }}</span>
              </article>
            </div>
            <pre class="tally-preview" *ngIf="acct.tallyExport?.['content']">{{ acct.tallyExport?.['content'] }}</pre>
          </div>
          <ng-template #noAccounting>
            <p class="empty-state">Accounting status pending.</p>
          </ng-template>
        </section>

        <section class="report-card" *ngIf="cashWorkspace() === 'float'">
          <div>
            <span class="eyebrow">Float control</span>
            <h3>Next-day change float</h3>
            <p>Suggested float keeps change-ready denominations and moves excess cash/large notes to safe.</p>
          </div>
          <div class="report-metrics" *ngIf="floatSuggestion() as suggestion">
            <span>Keep float <strong>{{ money(suggestion.suggestedFloatPaise) }}</strong></span>
            <span>Move to safe <strong>{{ money(suggestion.safeMovePaise) }}</strong></span>
            <span>Large notes <strong>{{ money(suggestion.largeNotePaise) }}</strong></span>
            <span>Denoms <strong>{{ suggestion.keepBreakdown?.length || 0 }}</strong></span>
          </div>
          <button class="ghost-button" type="button" (click)="loadFloatSuggestion(active)" [disabled]="saving()">Refresh suggestion</button>
        </section>

        <section class="close-panel" *ngIf="cashWorkspace() === 'closeReport'">
          <div>
            <span class="eyebrow">Close gate</span>
            <h3>Din Band Karein</h3>
            <p *ngIf="active.canClose">All checks are clear. Closing will freeze the report and logout this user.</p>
            <p *ngIf="!active.canClose">Close is blocked until denomination count, cash variance and settlement checks pass.</p>
          </div>
          <div class="blockers" *ngIf="active.blockers?.length">
            <span *ngFor="let blocker of active.blockers">{{ blockerLabel(blocker) }}</span>
          </div>
          <label class="field" *ngIf="(active.variancePaise || 0) !== 0 || active.blockers?.includes('VARIANCE_REASON_REQUIRED')">
            <span>Manager override reason</span>
            <input [(ngModel)]="varianceReason" placeholder="Required for non-zero variance override" />
          </label>
          <button class="primary-button danger" type="button" (click)="closeDay(active)" [disabled]="saving() || closeDisabled(active)">Close day and logout</button>
        </section>

        <ng-container *ngIf="cashWorkspace() === 'closeReport'">
        <section class="report-card" *ngIf="todayReport() as report">
          <div>
            <span class="eyebrow">Today's Close</span>
            <h3>{{ report.businessDate }}</h3>
            <p>Owner notification: {{ report.notificationStatus || 'pending' }}</p>
          </div>
          <div class="report-metrics">
            <span>Expected <strong>{{ money(report.expectedCashPaise) }}</strong></span>
            <span>Counted <strong>{{ money(report.countedCashPaise) }}</strong></span>
            <span>Variance <strong>{{ money(report.variancePaise) }}</strong></span>
            <span>Invoices <strong>{{ report.invoiceCount || 0 }}</strong></span>
          </div>
        </section>
        </ng-container>
            </ng-container>
            <ng-template #openDayWorkspace>
              <section class="open-panel open-workspace-panel">
                <div>
                  <span class="eyebrow">Day open</span>
                  <h3>Start cash drawer session</h3>
                  <p>Opening balance is stored in paise in backend. Previous close is prefilled when available.</p>
                </div>
                <label class="field">
                  <span>Opening balance</span>
                  <input type="number" min="0" step="0.01" [(ngModel)]="openingBalanceRupees" />
                </label>
                <label class="field wide">
                  <span>Notes</span>
                  <input [(ngModel)]="openingNotes" placeholder="Opening float note" />
                </label>
                <button class="primary-button" type="button" (click)="openSession()" [disabled]="saving()">Open day</button>
              </section>
            </ng-template>
          </div>
        </section>
    </section>
  `,
  styles: [`
    .cash-eod-page { display: grid; gap: 18px; }
    .hero-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .hero-actions input, .field input { border: 1px solid #cbd8d2; border-radius: 8px; padding: 10px 12px; min-height: 40px; }
    .open-panel, .panel, .close-panel, .report-card {
      border: 1px solid #dbe7e4; background: #fff; border-radius: 8px; padding: 18px; box-shadow: 0 12px 28px rgba(15, 23, 42, .05);
    }
    .open-panel { display: grid; grid-template-columns: minmax(260px, 1fr) 220px minmax(260px, 1fr) auto; gap: 14px; align-items: end; }
    .field { display: grid; gap: 6px; font-weight: 800; color: #334155; }
    .field span { font-size: 12px; text-transform: uppercase; color: #64748b; }
    .cash-workspace-shell { display: grid; grid-template-columns: 338px minmax(0, 1fr); gap: 16px; align-items: start; }
    .cash-category-rail { display: grid; gap: 10px; }
    .cash-category-tile {
      width: 100%; border: 1px solid #dbe7e4; border-left: 4px solid #0f766e; background: #fff; border-radius: 8px; padding: 14px 16px;
      display: grid; gap: 5px; text-align: left; cursor: pointer; box-shadow: 0 10px 24px rgba(15, 23, 42, .04);
    }
    .cash-category-tile.active { background: #f2fbf8; border-color: #9bd8cc; border-left-color: #0f766e; }
    .cash-category-tile[data-state="warn"] { border-left-color: #f59e0b; }
    .cash-category-tile[data-state="bad"] { border-left-color: #dc2626; }
    .cash-category-tile span { color: #0f172a; font-weight: 900; }
    .cash-category-tile strong { color: #0f172a; font-size: 22px; letter-spacing: 0; }
    .cash-category-tile small { color: #64748b; line-height: 1.35; }
    .cash-workspace-detail { border: 1px solid #dbe7e4; background: #fff; border-radius: 8px; padding: 18px; display: grid; gap: 16px; box-shadow: 0 12px 28px rgba(15, 23, 42, .05); }
    .detail-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 1px solid #e5edf0; padding-bottom: 14px; }
    .detail-head h3 { margin: 2px 0 4px; color: #0f172a; letter-spacing: 0; }
    .detail-head p { margin: 0; color: #64748b; }
    .status-pill { border: 1px solid #bbf7d0; background: #f0fdf4; color: #166534; border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .status-pill[data-state="warn"] { border-color: #fde68a; background: #fffbeb; color: #92400e; }
    .status-pill[data-state="bad"] { border-color: #fecaca; background: #fff1f2; color: #9f1239; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .metric-grid article { border: 1px solid #dbe7e4; background: #f8fbfa; border-radius: 8px; padding: 14px; display: grid; gap: 5px; }
    .metric-grid span, .metric-grid small, .settlement-card span, .report-card p { color: #64748b; }
    .metric-grid strong { font-size: 24px; color: #0f172a; letter-spacing: 0; }
    .metric-grid strong.warn, .accounting-grid strong.warn, .risk-grid strong.warn, .approval-link-grid strong.warn, .match-summary strong.warn { color: #b42318; }
    .workspace { display: grid; grid-template-columns: repeat(2, minmax(280px, 1fr)); gap: 14px; align-items: start; }
    .section-title, .close-panel, .report-card, .settlement-card { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
    .section-title h3, .close-panel h3, .report-card h3 { margin: 2px 0 0; color: #0f172a; letter-spacing: 0; }
    .denom-grid { display: grid; gap: 8px; margin: 14px 0; }
    .denom-row { display: grid; grid-template-columns: 1fr 88px 110px; gap: 10px; align-items: center; border-bottom: 1px solid #edf2f7; padding-bottom: 8px; }
    .denom-row input, .mode-row input, .settlement-card input { width: 100%; border: 1px solid #d8e2df; border-radius: 8px; padding: 8px 10px; }
    .mode-table { display: grid; gap: 8px; margin-top: 12px; }
    .mode-head, .mode-row { display: grid; grid-template-columns: 80px 105px 110px minmax(130px, 1fr); gap: 10px; align-items: center; }
    .mode-head { font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 900; }
    .settlement-list { display: grid; gap: 10px; margin-top: 12px; }
    .settlement-card { border: 1px solid #e1e9ef; border-radius: 8px; padding: 12px; align-items: center; }
    .settlement-card label { display: grid; gap: 5px; font-size: 12px; color: #64748b; font-weight: 800; min-width: 120px; }
    .inline-action-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; align-items: end; margin-top: 12px; }
    .inline-action-grid .wide { grid-column: span 2; }
    .operation-list, .till-list { display: grid; gap: 10px; margin-top: 12px; }
    .operation-row, .till-card, .handover-box { border: 1px solid #e1e9ef; border-radius: 8px; padding: 12px; display: grid; gap: 10px; }
    .operation-row { grid-template-columns: 1fr auto; align-items: center; }
    .operation-row span, .till-card span, .till-card small { color: #64748b; }
    .till-card { grid-template-columns: minmax(120px, 1fr) 120px 120px minmax(150px, 1fr) auto; align-items: end; }
    .till-card.closed { background: #f8fafc; }
    .till-card label { display: grid; gap: 5px; color: #64748b; font-size: 12px; font-weight: 800; }
    .handover-box { grid-template-columns: repeat(3, minmax(0, 1fr)) auto; align-items: end; margin-top: 12px; }
    .reconciliation-panel { display: grid; gap: 14px; }
    .recon-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
    .recon-tabs button { border: 1px solid #cbd8d2; background: #fff; border-radius: 999px; padding: 8px 12px; font-weight: 900; cursor: pointer; }
    .recon-tabs button.active { background: #0f766e; color: #fff; border-color: #0f766e; }
    .recon-grid, .deposit-list { display: grid; gap: 10px; }
    .recon-row, .deposit-row { border: 1px solid #e1e9ef; border-radius: 8px; padding: 12px; display: grid; grid-template-columns: minmax(160px, 1fr) repeat(4, minmax(110px, auto)); gap: 10px; align-items: center; }
    .recon-row.exception { border-color: #fecaca; background: #fff7f7; }
    .recon-row.pending { border-color: #fde68a; background: #fffbeb; }
    .recon-row span, .deposit-row span { color: #64748b; }
    .recon-tools { display: grid; grid-template-columns: minmax(360px, 1fr) minmax(280px, .75fr); gap: 14px; }
    .csv-box, .deposit-box { border: 1px solid #e1e9ef; border-radius: 8px; padding: 12px; display: grid; gap: 10px; }
    .csv-box textarea { width: 100%; resize: vertical; border: 1px solid #d8e2df; border-radius: 8px; padding: 10px; font-family: inherit; }
    .deposit-row { grid-template-columns: 1fr auto auto; }
    .button-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .accounting-stack { display: grid; gap: 12px; }
    .accounting-grid { display: grid; grid-template-columns: repeat(3, minmax(140px, 1fr)); gap: 10px; }
    .accounting-grid span, .ledger-lines article { border: 1px solid #e1e9ef; border-radius: 8px; padding: 10px; color: #64748b; background: #f8fbfa; }
    .accounting-grid strong, .ledger-lines strong { display: block; color: #0f172a; margin-top: 4px; }
    .ledger-lines { display: grid; grid-template-columns: repeat(2, minmax(180px, 1fr)); gap: 10px; }
    .risk-grid { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 10px; margin: 12px 0; }
    .risk-grid span { border: 1px solid #dbe7e4; border-radius: 8px; padding: 10px; background: #f8fafc; color: #475569; }
    .risk-grid strong { display: block; color: #0f172a; margin-top: 4px; text-transform: capitalize; }
    .token-approval-panel { max-width: 980px; margin: 0 auto 18px; display: grid; gap: 14px; }
    .approval-link-grid, .match-summary { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px; }
    .match-summary { margin-top: 10px; }
    .approval-link-grid span, .match-summary span { border: 1px solid #dbe7e4; border-radius: 8px; padding: 10px; background: #f8fafc; color: #475569; }
    .approval-link-grid strong, .match-summary strong { display: block; color: #0f172a; margin-top: 4px; text-transform: capitalize; }
    .approval-link-actions { display: grid; grid-template-columns: minmax(220px, 1fr) auto auto; gap: 10px; align-items: end; }
    .risk-events { display: grid; grid-template-columns: repeat(3, minmax(180px, 1fr)); gap: 10px; }
    .risk-events article { border: 1px solid #e1e9ef; border-left: 3px solid #0f766e; border-radius: 8px; padding: 10px; background: #fff; color: #475569; }
    .risk-events article.high { border-left-color: #b42318; background: #fff7ed; }
    .risk-events strong { display: block; color: #0f172a; margin-bottom: 4px; }
    .approval-box { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(220px, 1fr) auto; gap: 12px; align-items: end; margin-top: 12px; }
    .owner-risk-list { display: grid; gap: 10px; margin-top: 12px; }
    .owner-risk-list article { border: 1px solid #e1e9ef; border-radius: 8px; padding: 12px; display: grid; grid-template-columns: minmax(220px, 1fr) minmax(180px, 1fr) auto; gap: 12px; align-items: center; }
    .owner-risk-list article.high { border-color: #fecaca; background: #fff7f7; }
    .owner-risk-list span { color: #64748b; }
    .tally-preview { max-height: 180px; overflow: auto; border: 1px solid #d8e2df; border-radius: 8px; padding: 12px; background: #0f172a; color: #e2e8f0; white-space: pre-wrap; }
    .check-field { display: flex !important; align-items: center; gap: 8px; color: #334155 !important; }
    .blockers { display: flex; gap: 8px; flex-wrap: wrap; max-width: 520px; }
    .blockers span { border: 1px solid #fecaca; background: #fff1f2; color: #9f1239; border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 900; }
    .report-metrics { display: grid; grid-template-columns: repeat(4, minmax(100px, 1fr)); gap: 10px; }
    .report-metrics span { border-left: 3px solid #0f766e; padding-left: 10px; color: #475569; }
    .report-metrics strong { display: block; color: #0f172a; margin-top: 4px; }
    .empty-state { border: 1px dashed #cbd8d2; border-radius: 8px; padding: 14px; color: #64748b; background: #f8fafc; }
    .danger { border-color: #b42318 !important; }
    @media (max-width: 1180px) {
      .cash-workspace-shell { grid-template-columns: 1fr; }
      .cash-category-rail, .workspace, .metric-grid, .open-panel, .approval-link-grid, .match-summary { grid-template-columns: 1fr 1fr; }
      .close-panel, .report-card { display: grid; }
    }
    @media (max-width: 720px) {
      .cash-category-rail, .workspace, .metric-grid, .open-panel, .report-metrics, .inline-action-grid, .handover-box, .recon-tools, .accounting-grid, .ledger-lines, .risk-grid, .risk-events, .approval-box, .owner-risk-list article, .approval-link-grid, .match-summary, .approval-link-actions { grid-template-columns: 1fr; }
      .detail-head { display: grid; }
      .inline-action-grid .wide { grid-column: auto; }
      .mode-head, .mode-row, .till-card, .recon-row, .deposit-row { grid-template-columns: 1fr; }
      .settlement-card { display: grid; }
    }
  `]
})
export class CashDrawerEodComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly session = signal<EodSession | null>(null);
  readonly todayReport = signal<ApiRecord | null>(null);
  readonly collectionRows = signal<CollectionRow[]>([]);
  readonly settlementRows = signal<SettlementRow[]>([]);
  readonly operationRows = signal<CashOperationRow[]>([]);
  readonly tillRows = signal<TillRow[]>([]);
  readonly floatSuggestion = signal<FloatSuggestion | null>(null);
  readonly matchedRows = signal<ThreeWayRow[]>([]);
  readonly exceptionRows = signal<ThreeWayRow[]>([]);
  readonly pendingRows = signal<ThreeWayRow[]>([]);
  readonly depositSlips = signal<ApiRecord[]>([]);
  readonly accounting = signal<AccountingSummary | null>(null);
  readonly risk = signal<RiskSummary | null>(null);
  readonly ownerRiskDashboard = signal<OwnerRiskDashboard | null>(null);
  readonly settlementImportSummary = signal<SettlementImportSummary | null>(null);
  readonly tokenApproval = signal<TokenApprovalContext | null>(null);
  readonly reconciliationTab = signal<'exception' | 'pending' | 'matched'>('exception');
  readonly cashWorkspace = signal<CashWorkspaceKey>('overview');
  readonly cashWorkspaceCategories: CashWorkspaceCategory[] = [
    { key: 'overview', label: 'Drawer Summary', source: 'Session status, expected cash and counted drawer' },
    { key: 'cashCount', label: 'Cash Drawer Tally', source: 'Physical note and coin denomination count' },
    { key: 'collections', label: 'Collection Settlement', source: 'Cash, card, UPI, PhonePe, Paytm and bank net' },
    { key: 'operations', label: 'Drops / Tills', source: 'Cash drops, petty payouts, pickups and till handover' },
    { key: 'reconciliation', label: '3-Way Match', source: 'POS invoices, bank settlement and physical drawer match' },
    { key: 'risk', label: 'Risk & Approval', source: 'Owner approval, WhatsApp link and variance risk control' },
    { key: 'accounting', label: 'Accounting Posting', source: 'Journal, tax register and Tally export status' },
    { key: 'float', label: 'Next Day Float', source: 'Suggested change float and safe move amount' },
    { key: 'closeReport', label: 'Close Gate / Report', source: 'Final blocker check, day close and owner report' }
  ];
  readonly denomVersion = signal(0);
  readonly countedTotal = computed(() => {
    this.denomVersion();
    return this.denominationRows.reduce((sum, row) => sum + row.denominationPaise * Number(row.qty || 0), 0);
  });

  businessDate = this.today();
  openingBalanceRupees = 0;
  openingNotes = '';
  cashPayoutRupees = 0;
  varianceReason = '';
  approvalReason = '';
  approvalReviewNote = '';
  operationDraft = { type: 'drop' as 'drop' | 'pickup' | 'payout', amountRupees: 0, reason: '', tillId: '' };
  tillDraft = { tillName: '', cashierId: '', openingFloatRupees: 0 };
  handoverDraft = { tillId: '', incomingCashierId: '', signature: '' };
  settlementProvider = 'razorpay';
  settlementCsv = '';
  depositDraft = { amountRupees: 0, bankName: '', depositRef: '' };
  approvalToken = '';
  tokenApprovalReviewNote = '';
  denominationRows: DenominationRow[] = DENOMINATION_TEMPLATE.map((row) => ({ ...row }));

  constructor(
    private readonly api: ApiService,
    private readonly authSession: AuthSessionService,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.approvalToken = this.route.snapshot.paramMap.get('token') || this.route.snapshot.queryParamMap.get('approvalToken') || '';
    if (this.approvalToken) {
      this.cashWorkspace.set('risk');
      this.loadApprovalToken();
      return;
    }
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      current: this.api.list<CurrentResponse>('cash-drawer-eod/current', { date: this.businessDate }),
      report: this.api.list<ApiRecord | null>('cash-drawer-eod/reports/today', { date: this.businessDate })
    }).subscribe({
      next: ({ current, report }) => {
        this.applyCurrent(current);
        this.todayReport.set(report);
        this.loading.set(false);
        this.loadOwnerRiskDashboard();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load cash drawer EOD'));
        this.loading.set(false);
      }
    });
  }

  loadOwnerRiskDashboard(): void {
    this.api.list<OwnerRiskDashboard>('cash-drawer-eod/risk-dashboard', {
      dateTo: this.businessDate
    }).subscribe({
      next: (dashboard) => this.ownerRiskDashboard.set(dashboard),
      error: () => undefined
    });
  }

  loadApprovalToken(): void {
    if (!this.approvalToken) return;
    this.loading.set(true);
    this.error.set('');
    this.api.list<TokenApprovalContext>(`cash-drawer-eod/approval-token/${this.approvalToken}`).subscribe({
      next: (context) => {
        this.tokenApproval.set(context);
        if (context.session?.businessDate) this.businessDate = context.session.businessDate;
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load approval link'));
        this.loading.set(false);
      }
    });
  }

  reviewTokenApproval(decision: 'approved' | 'rejected'): void {
    if (!this.approvalToken) return;
    this.saving.set(true);
    this.error.set('');
    this.api.post<TokenApprovalContext>(`cash-drawer-eod/approval-token/${this.approvalToken}/review`, {
      decision,
      reviewNote: this.tokenApprovalReviewNote
    }).subscribe({
      next: (context) => {
        this.tokenApproval.set(context);
        this.success.set(decision === 'approved' ? 'Owner approval granted from WhatsApp link' : 'Owner approval rejected');
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to review approval link'));
        this.saving.set(false);
      }
    });
  }

  openSession(): void {
    this.mutate(() => this.api.post<EodSession>('cash-drawer-eod/open', {
      businessDate: this.businessDate,
      openingBalancePaise: this.toPaise(this.openingBalanceRupees),
      notes: this.openingNotes
    }), 'Day opened');
  }

  saveDenominations(active: EodSession): void {
    this.mutate(() => this.api.put<EodSession>(`cash-drawer-eod/${active.id}/denominations`, {
      denominations: this.denominationRows.map((row) => ({
        denominationPaise: row.denominationPaise,
        kind: row.kind,
        qty: Number(row.qty || 0)
      }))
    }), 'Cash count saved');
  }

  saveCash(active: EodSession): void {
    this.mutate(() => this.api.put<EodSession>(`cash-drawer-eod/${active.id}/cash`, {
      cashPayoutPaise: this.toPaise(this.cashPayoutRupees),
      collections: this.collectionRows().map((row) => ({
        mode: row.mode,
        finalAmountPaise: this.toPaise(row.finalRupees || 0),
        adjustmentReason: row.adjustmentReason || ''
      }))
    }), 'Collections saved');
  }

  saveOperation(active: EodSession): void {
    this.mutate(() => this.api.post<EodSession>(`cash-drawer-eod/${active.id}/operations`, {
      type: this.operationDraft.type,
      amountPaise: this.toPaise(this.operationDraft.amountRupees),
      reason: this.operationDraft.reason,
      tillId: this.operationDraft.tillId
    }), 'Cash operation saved');
    this.operationDraft = { type: this.operationDraft.type, amountRupees: 0, reason: '', tillId: '' };
  }

  deleteOperation(row: CashOperationRow): void {
    this.saving.set(true);
    this.error.set('');
    this.api.delete<EodSession>('cash-drawer-eod/operations', row.id).subscribe({
      next: (session) => {
        this.applySession(session);
        this.success.set('Cash operation deleted');
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to delete cash operation'));
        this.saving.set(false);
      }
    });
  }

  createTill(active: EodSession): void {
    this.mutate(() => this.api.post<EodSession>(`cash-drawer-eod/${active.id}/tills`, {
      tillName: this.tillDraft.tillName,
      cashierId: this.tillDraft.cashierId,
      openingFloatPaise: this.toPaise(this.tillDraft.openingFloatRupees)
    }), 'Till created');
    this.tillDraft = { tillName: '', cashierId: '', openingFloatRupees: 0 };
  }

  closeTill(till: TillRow): void {
    this.mutate(() => this.api.post<EodSession>(`cash-drawer-eod/tills/${till.id}/close`, {
      cashCollectedPaise: this.toPaise(till.cashCollectedRupees || 0),
      countedCashPaise: this.toPaise(till.countedRupees || 0)
    }), 'Till closed');
  }

  handover(active: EodSession): void {
    this.mutate(() => this.api.post<EodSession>(`cash-drawer-eod/${active.id}/handover`, {
      tillId: this.handoverDraft.tillId,
      incomingCashierId: this.handoverDraft.incomingCashierId,
      signature: this.handoverDraft.signature,
      countedCashPaise: this.countedTotal()
    }), 'Shift handover recorded');
    this.handoverDraft = { tillId: '', incomingCashierId: '', signature: '' };
  }

  loadFloatSuggestion(active: EodSession): void {
    this.api.list<FloatSuggestion>(`cash-drawer-eod/${active.id}/float-suggestion`).subscribe({
      next: (suggestion) => this.floatSuggestion.set(suggestion),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load float suggestion'))
    });
  }

  loadThreeWay(active: EodSession): void {
    this.api.list<ThreeWayResponse>(`cash-drawer-eod/${active.id}/three-way`).subscribe({
      next: (response) => this.applyThreeWay(response),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load three-way reconciliation'))
    });
  }

  loadAccounting(active: EodSession): void {
    this.api.list<AccountingSummary>(`cash-drawer-eod/${active.id}/accounting`).subscribe({
      next: (summary) => this.accounting.set(summary),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load accounting status'))
    });
  }

  loadRisk(active: EodSession): void {
    this.api.list<RiskSummary>(`cash-drawer-eod/${active.id}/risk`).subscribe({
      next: (summary) => {
        this.risk.set(summary);
        this.session.set({ ...active, risk: summary });
        if (!this.approvalReason && summary.approval?.reason) this.approvalReason = summary.approval.reason;
      },
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load cash risk'))
    });
  }

  requestApproval(active: EodSession): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<RiskSummary>(`cash-drawer-eod/${active.id}/approval-request`, {
      reason: this.approvalReason || this.varianceReason,
      varianceReason: this.varianceReason
    }).subscribe({
      next: (summary) => {
        this.risk.set(summary);
        this.success.set('Approval request sent');
        this.saving.set(false);
        this.refreshCanClose();
        this.loadOwnerRiskDashboard();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to request approval'));
        this.saving.set(false);
      }
    });
  }

  reviewApproval(decision: 'approved' | 'rejected'): void {
    const approval = this.risk()?.approval;
    if (!approval) return;
    this.saving.set(true);
    this.error.set('');
    this.api.post<RiskSummary>(`cash-drawer-eod/approval-requests/${approval.id}/review`, {
      decision,
      reviewNote: this.approvalReviewNote,
      varianceReason: this.varianceReason || this.approvalReason
    }).subscribe({
      next: (summary) => {
        this.risk.set(summary);
        this.success.set(decision === 'approved' ? 'Approval granted' : 'Approval rejected');
        this.saving.set(false);
        this.refreshCanClose();
        this.loadOwnerRiskDashboard();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to review approval'));
        this.saving.set(false);
      }
    });
  }

  approveOwnerRisk(row: OwnerRiskRow): void {
    const approvalId = row.approval?.id;
    if (!approvalId) return;
    this.saving.set(true);
    this.error.set('');
    this.api.post<RiskSummary>(`cash-drawer-eod/approval-requests/${approvalId}/review`, {
      decision: 'approved',
      reviewNote: 'Approved from owner risk dashboard',
      varianceReason: row.approval?.reason || 'Approved from owner risk dashboard'
    }).subscribe({
      next: () => {
        this.success.set('Owner approval granted');
        this.saving.set(false);
        this.loadOwnerRiskDashboard();
        this.refreshCanClose();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to approve risk request'));
        this.saving.set(false);
      }
    });
  }

  postAccounting(active: EodSession): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<AccountingSummary>(`cash-drawer-eod/${active.id}/accounting/post`, {}).subscribe({
      next: (summary) => {
        this.accounting.set(summary);
        this.success.set('Accounting journal posted');
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to post accounting journal'));
        this.saving.set(false);
      }
    });
  }

  loadTallyExport(active: EodSession, refresh = false): void {
    this.api.list<ApiRecord>(`cash-drawer-eod/${active.id}/tally-export`, refresh ? { refresh: '1' } : {}).subscribe({
      next: (tallyExport) => this.accounting.set({ ...(this.accounting() || {}), tallyExport }),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load Tally export'))
    });
  }

  importSettlement(active: EodSession): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>(`cash-drawer-eod/${active.id}/settlement-import`, {
      provider: this.settlementProvider,
      csv: this.settlementCsv
    }).subscribe({
      next: (response) => {
        this.applyThreeWay(response['reconciliation'] as ThreeWayResponse);
        this.settlementImportSummary.set(response as SettlementImportSummary);
        this.settlementCsv = '';
        this.success.set(`Settlement import matched ${response['matchedCount'] || 0} row(s)`);
        this.saving.set(false);
        this.loadOwnerRiskDashboard();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to import settlement CSV'));
        this.saving.set(false);
      }
    });
  }

  createDepositSlip(active: EodSession): void {
    this.saving.set(true);
    this.error.set('');
    const amountPaise = this.toPaise(this.depositDraft.amountRupees) || Number(active.countedCashPaise || this.countedTotal());
    this.api.post<ThreeWayResponse>(`cash-drawer-eod/${active.id}/deposit-slip`, {
      amountPaise,
      bankName: this.depositDraft.bankName,
      depositRef: this.depositDraft.depositRef
    }).subscribe({
      next: (response) => {
        this.applyThreeWay(response);
        this.depositDraft = { amountRupees: 0, bankName: '', depositRef: '' };
        this.success.set('Deposit slip generated');
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to generate deposit slip'));
        this.saving.set(false);
      }
    });
  }

  confirmDepositSlip(slip: ApiRecord): void {
    this.saving.set(true);
    this.error.set('');
    this.api.patch<ThreeWayResponse>(`cash-drawer-eod/deposit-slip/${slip['id']}`, {
      bankName: slip['bankName'] || this.depositDraft.bankName,
      depositRef: slip['depositRef'] || this.depositDraft.depositRef,
      status: 'confirmed'
    }).subscribe({
      next: (response) => {
        this.applyThreeWay(response);
        this.success.set('Deposit slip confirmed');
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to confirm deposit slip'));
        this.saving.set(false);
      }
    });
  }

  saveSettlement(row: SettlementRow): void {
    this.saving.set(true);
    this.error.set('');
    this.api.patch<EodSession>(`cash-drawer-eod/settlement/${row.id}`, {
      settlementChargePaise: this.toPaise(row.chargeRupees || 0),
      bankRef: row.bankRef || '',
      reconciled: Boolean(row.reconciled)
    }).subscribe({
      next: (session) => {
        this.applySession(session);
        this.success.set('Settlement saved');
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save settlement'));
        this.saving.set(false);
      }
    });
  }

  closeDay(active: EodSession): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<EodSession>(`cash-drawer-eod/${active.id}/close`, {
      varianceReason: this.varianceReason
    }).subscribe({
      next: (session) => {
        this.applySession(session);
        this.todayReport.set(session['report'] || null);
        const accounting = session['accounting'] as AccountingSummary | undefined;
        this.accounting.set(accounting || this.accounting());
        this.success.set('Day closed. Logging out.');
        this.saving.set(false);
        this.authSession.logout();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to close day'));
        this.saving.set(false);
      }
    });
  }

  netPaise(row: SettlementRow): number {
    return Number(row.grossPaise || 0) - this.toPaise(row.chargeRupees || 0);
  }

  operationImpact(row: CashOperationRow): string {
    const sign = Number(row.impactPaise || 0) >= 0 ? '+' : '-';
    return sign + this.money(Math.abs(Number(row.impactPaise || 0)));
  }

  touchDenoms(): void {
    this.denomVersion.update((value) => value + 1);
  }

  touchCollections(): void {
    this.collectionRows.set([...this.collectionRows()]);
  }

  touchSettlements(): void {
    this.settlementRows.set([...this.settlementRows()]);
  }

  isBlind(active: EodSession): boolean {
    return Boolean(active.blindResult);
  }

  money(value: unknown): string {
    return '₹' + ((Number(value) || 0) / 100).toFixed(2);
  }

  blockerLabel(blocker: string): string {
    return blocker.replaceAll('_', ' ').toLowerCase();
  }

  selectedCashWorkspace(): CashWorkspaceCategory {
    return this.cashWorkspaceCategories.find((item) => item.key === this.cashWorkspace()) || {
      key: 'overview',
      label: 'Drawer Summary',
      source: 'Session status, expected cash and counted drawer'
    };
  }

  cashWorkspaceValue(key: CashWorkspaceKey, active?: EodSession | null): string {
    const reconIssues = this.exceptionRows().length + this.pendingRows().length;
    if (!active) {
      if (key === 'overview') return 'Not open';
      if (key === 'cashCount' || key === 'collections' || key === 'operations' || key === 'float') return this.money(0);
      if (key === 'reconciliation') return 'Open day';
      if (key === 'risk') return '0/100';
      if (key === 'accounting') return 'pending';
      if (key === 'closeReport') return 'Open day';
      return '-';
    }
    switch (key) {
      case 'overview':
        return active?.status || 'Not open';
      case 'cashCount':
        return this.money(this.countedTotal());
      case 'collections':
        return this.money(active?.cashCollectedPaise);
      case 'operations':
        return this.money(active?.cashOperationImpactPaise);
      case 'reconciliation':
        return reconIssues ? `${reconIssues} issue` : 'Matched';
      case 'risk':
        return `${this.risk()?.score || 0}/100`;
      case 'accounting':
        return String(this.accounting()?.posting?.['status'] || 'pending');
      case 'float':
        return this.money(this.floatSuggestion()?.safeMovePaise);
      case 'closeReport':
        if (active?.status === 'closed') return 'Closed';
        return active?.canClose ? 'Ready' : `${active?.blockers?.length || 0} blocker`;
      default:
        return '-';
    }
  }

  cashWorkspaceNote(key: CashWorkspaceKey, active?: EodSession | null): string {
    if (!active) {
      if (key === 'overview') return this.businessDate;
      return 'Open day first';
    }
    switch (key) {
      case 'overview':
        return active.businessDate || this.businessDate;
      case 'cashCount':
        return this.isBlind(active) ? 'Blind count active' : `Variance ${this.money(active.variancePaise)}`;
      case 'collections':
        return `${this.collectionRows().length} modes · ${this.settlementRows().length} settlements`;
      case 'operations':
        return `${this.operationRows().length} cash moves · ${this.tillRows().length} tills`;
      case 'reconciliation':
        return `${this.exceptionRows().length} exceptions · ${this.pendingRows().length} pending`;
      case 'risk':
        return `${this.ownerRiskDashboard()?.summary?.['pendingApproval'] || 0} pending approval`;
      case 'accounting':
        return this.accounting()?.period || 'Period pending';
      case 'float':
        return `${this.floatSuggestion()?.keepBreakdown?.length || 0} denominations kept`;
      case 'closeReport':
        if (active.status === 'closed') return 'Report locked';
        return active.canClose ? 'All checks clear' : 'Close blocked';
      default:
        return '';
    }
  }

  cashWorkspaceState(key: CashWorkspaceKey, active?: EodSession | null): 'ok' | 'warn' | 'bad' {
    if (!active) return key === 'overview' ? 'warn' : 'bad';
    switch (key) {
      case 'cashCount':
        if (active.blindResult?.managerApprovalRequired || (!this.isBlind(active) && Number(active.variancePaise || 0) !== 0)) return 'bad';
        return this.countedTotal() ? 'ok' : 'warn';
      case 'collections':
        return this.settlementRows().some((row) => !row.reconciled) ? 'warn' : 'ok';
      case 'reconciliation':
        if (this.exceptionRows().length) return 'bad';
        return this.pendingRows().length ? 'warn' : 'ok';
      case 'risk': {
        const score = Number(this.risk()?.score || 0);
        if (this.risk()?.approvalRequired || score >= 50) return 'bad';
        return score >= 25 ? 'warn' : 'ok';
      }
      case 'accounting':
        return this.accounting()?.posting?.['status'] === 'posted' ? 'ok' : 'warn';
      case 'closeReport':
        if (active.status === 'closed') return 'ok';
        return active.canClose ? 'ok' : 'bad';
      default:
        return 'ok';
    }
  }

  visibleReconciliationRows(): ThreeWayRow[] {
    if (this.reconciliationTab() === 'pending') return this.pendingRows();
    if (this.reconciliationTab() === 'matched') return this.matchedRows();
    return this.exceptionRows();
  }

  closeDisabled(active: EodSession): boolean {
    if (active.canClose) return false;
    const blockers = active.blockers || [];
    if (blockers.includes('RISK_APPROVAL_REQUIRED') || blockers.includes('APPROVAL_PENDING')) return true;
    return !(blockers.length === 1 && blockers[0] === 'VARIANCE_REASON_REQUIRED' && this.varianceReason.trim());
  }

  private mutate(request: () => Observable<EodSession>, message: string): void {
    this.saving.set(true);
    this.error.set('');
    request().subscribe({
      next: (session) => {
        this.applySession(session);
        this.success.set(message);
        this.saving.set(false);
        this.refreshCanClose();
        this.loadOwnerRiskDashboard();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, message + ' failed'));
        this.saving.set(false);
      }
    });
  }

  private refreshCanClose(): void {
    const active = this.session();
    if (!active) return;
    this.api.list<CanCloseResponse>(`cash-drawer-eod/${active.id}/can-close`).subscribe({
      next: (state) => {
        if (state.risk) this.risk.set(state.risk);
        this.session.set({ ...active, canClose: state.canClose, blockers: state.blockers, risk: state.risk || active.risk });
      },
      error: () => undefined
    });
  }

  private applyCurrent(current: CurrentResponse): void {
    if (!current.session) {
      this.session.set(null);
      this.risk.set(null);
      this.openingBalanceRupees = (Number(current.suggestedOpeningBalancePaise || 0) / 100);
      return;
    }
    this.applySession(current.session);
  }

  private applySession(session: EodSession): void {
    this.session.set(session);
    if (session.risk) this.risk.set(session.risk);
    this.cashPayoutRupees = Number(session.cashPayoutPaise || 0) / 100;
    this.collectionRows.set((session.collections || []).filter((row) => 'finalAmountPaise' in row).map((row) => ({
      ...row,
      finalRupees: Number(row.finalAmountPaise || 0) / 100
    })));
    this.settlementRows.set((session.settlements || []).map((row) => ({
      ...row,
      grossRupees: Number(row.grossPaise || 0) / 100,
      chargeRupees: Number(row.settlementChargePaise || 0) / 100,
      reconciled: Boolean(row.reconciled)
    })));
    this.operationRows.set(session.operations || []);
    this.tillRows.set((session.tills || []).map((row) => ({
      ...row,
      cashCollectedRupees: Number(row.cashCollectedPaise || 0) / 100,
      countedRupees: Number(row.countedCashPaise || 0) / 100
    })));
    this.floatSuggestion.set(session.floatSuggestion || null);
    this.loadThreeWay(session);
    this.loadAccounting(session);
    this.loadRisk(session);
    const saved = new Map((session.denominations || []).map((row) => [`${row.kind}:${row.denominationPaise}`, row]));
    this.denominationRows = DENOMINATION_TEMPLATE.map((row) => ({
      ...row,
      qty: Number(saved.get(`${row.kind}:${row.denominationPaise}`)?.qty || 0)
    }));
    this.touchDenoms();
  }

  private toPaise(value: unknown): number {
    return Math.round((Number(value) || 0) * 100);
  }

  private applyThreeWay(response?: ThreeWayResponse): void {
    if (!response) return;
    this.matchedRows.set(response.matched || []);
    this.exceptionRows.set(response.exceptions || []);
    this.pendingRows.set(response.pending || []);
    this.depositSlips.set(response.depositSlips || []);
    if (response.exceptions?.length) this.reconciliationTab.set('exception');
    else if (response.pending?.length) this.reconciliationTab.set('pending');
    else this.reconciliationTab.set('matched');
  }

  private today(): string {
    return new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  }
}
