import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { InventoryZenotiChromeComponent } from '../shared/ui/inventory-zenoti-chrome/inventory-zenoti-chrome.component';
import { StateComponent } from '../shared/ui/state/state.component';

type RecipeTab = 'recipes' | 'planner' | 'intelligence' | 'usage' | 'alerts';

interface RecipeItemDraft {
  uid: string;
  productId: string;
  quantityPerService: number;
  unit: string;
  wastagePct: number;
  wastageApprovalPct: number;
  wastageHitLimit: number;
  minQuantityPerService: number;
  maxQuantityPerService: number;
  allowedSubstitutesText: string;
  notes: string;
}

const DEFAULT_MODIFIERS = [
  { key: 'short', label: 'Short hair', multiplier: 1 },
  { key: 'medium', label: 'Medium hair', multiplier: 1.5 },
  { key: 'long', label: 'Long hair', multiplier: 2 }
];

@Component({
  selector: 'app-inventory-recipes',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule, ReactiveFormsModule, InventoryZenotiChromeComponent, StateComponent],
  template: `
    <section class="page-stack inventory-enterprise-page recipes-page">
      <app-inventory-zenoti-chrome
        title="Service Recipes"
        breadcrumb="Inventory > Recipes"
        (refresh)="load()"
      >
        <div zenoti-actions class="hero-signal-row">
          <span>{{ branchRecipeStatus() }}</span>
          <span>{{ approvedRecipes().length }} approved BOMs</span>
          <span>{{ highAlertCount() }} high-risk alerts</span>
        </div>
      </app-inventory-zenoti-chrome>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="success()">{{ success() }}</div>

      <section class="zenoti-recipe-workspace">
        <div class="zenoti-result-bar">
          <div>
            <strong>{{ activeTabCount() }}</strong><span>Results</span>
            <small class="status-chip">Status: recipes active in this center</small>
          </div>
          <div class="zenoti-totals">
            <span>Configured <strong>{{ metric('configuredRecipes') }}</strong></span>
            <span>Approved <strong>{{ approvedRecipes().length }}</strong></span>
            <span>Missing <strong>{{ metric('missingRecipes') }}</strong></span>
            <span>Coverage <strong>{{ coveragePct() }}%</strong></span>
            <span>Stock risk <strong>{{ metric('lowStockForecast') }}</strong></span>
            <span>Margin <strong>{{ metric('averageMarginPct') }}%</strong></span>
          </div>
        </div>

        <div class="zenoti-filter-row">
          <div class="tab-strip">
            <button type="button" *ngFor="let tab of tabs" [class.active]="activeTab() === tab.id" (click)="activeTab.set(tab.id)">{{ tab.label }}</button>
          </div>
          <button type="button" class="primary-button" (click)="resetEditor()">Add recipe</button>
        </div>

        <ng-container *ngIf="activeTab() === 'recipes'">
          <div class="table-wrap zenoti-table-wrap">
            <table>
              <thead><tr><th>Service</th><th>Branch</th><th>Products</th><th>Cost</th><th>Margin</th><th>Status</th><th>Auto consume</th><th>Action</th></tr></thead>
              <tbody>
                <tr *ngFor="let recipe of recipes()">
                  <td><strong>{{ recipe.serviceName || recipe.recipeName }}</strong><small>{{ recipe.recipeName }}</small></td>
                  <td>{{ branchName(recipe.branchId) }}</td>
                  <td><span class="recipe-chip" *ngFor="let item of recipe.items">{{ item.productName }} x {{ item.quantityPerService }} {{ item.unit || 'pcs' }}</span></td>
                  <td>{{ recipe.expectedCost | currency:'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ recipe.expectedMarginPct || 0 }}%</td>
                  <td><span class="badge" [class.warn]="recipe.approvalStatus !== 'approved'">{{ recipe.approvalStatus || 'approved' }}</span></td>
                  <td>{{ recipe.approvalStatus === 'approved' ? 'Ready' : 'Approval pending' }}</td>
                  <td class="row-actions"><button class="ghost-button mini" type="button" (click)="editRecipe(recipe)">Edit</button><button class="ghost-button mini" type="button" (click)="approveRecipe(recipe)" *ngIf="recipe.approvalStatus !== 'approved'">Approve</button></td>
                </tr>
                <tr *ngIf="!recipes().length"><td colspan="8" class="empty-cell">No service BOMs configured yet.</td></tr>
              </tbody>
            </table>
          </div>
        </ng-container>

        <ng-container *ngIf="activeTab() === 'planner'">
          <div class="table-wrap zenoti-table-wrap">
            <table>
              <thead><tr><th>Queue</th><th>Service / product</th><th>Category</th><th>Need</th><th>Severity</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of dashboardList('missingRecipes')"><td>Missing BOM</td><td><strong>{{ row.serviceName }}</strong></td><td>{{ row.category || 'Service' }}</td><td>Create recipe</td><td>{{ row.severity || 'medium' }}</td></tr>
                <tr *ngFor="let row of weakMarginRows()"><td>Margin watch</td><td><strong>{{ row.serviceName }}</strong></td><td>Recipe</td><td>{{ row.expectedMarginPct }}% margin</td><td>floor {{ row.marginFloorPct || 0 }}%</td></tr>
                <tr *ngFor="let row of upcomingDemandRows()"><td>Stock pressure</td><td><strong>{{ row.productName }}</strong></td><td>{{ row.unit }}</td><td>{{ row.requiredQty }} required</td><td>{{ row.appointmentCount }} appointment(s)</td></tr>
                <tr *ngIf="!dashboardList('missingRecipes').length && !weakMarginRows().length && !upcomingDemandRows().length"><td colspan="5" class="empty-cell">No planner queue for selected branch.</td></tr>
              </tbody>
            </table>
          </div>
        </ng-container>

        <ng-container *ngIf="activeTab() === 'intelligence'">
          <div class="table-wrap zenoti-table-wrap">
            <table>
              <thead><tr><th>Signal</th><th>Name</th><th>Message</th><th>Action</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of dashboardList('missingRecipes')"><td>Missing recipe</td><td><strong>{{ row.serviceName }}</strong></td><td>{{ row.category || 'Service' }}</td><td>Create BOM</td></tr>
                <tr *ngFor="let row of dashboardList('lowStockForecast')"><td>Low stock forecast</td><td><strong>{{ row.productName }}</strong></td><td>Need {{ row.requiredQty }} {{ row.unit }}</td><td>Reorder</td></tr>
                <tr *ngFor="let row of dashboardList('aiSuggestions')"><td>AI suggestion</td><td><strong>{{ row.title }}</strong></td><td>{{ row.message }}</td><td>Review</td></tr>
                <tr *ngIf="!dashboardList('missingRecipes').length && !dashboardList('lowStockForecast').length && !dashboardList('aiSuggestions').length"><td colspan="4" class="empty-cell">No urgent recipe intelligence.</td></tr>
              </tbody>
            </table>
          </div>
        </ng-container>

        <ng-container *ngIf="activeTab() === 'usage'">
          <div class="table-wrap zenoti-table-wrap">
            <table>
              <thead><tr><th>Service</th><th>Staff</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Reference</th></tr></thead>
              <tbody>
                <tr *ngFor="let row of usageLogs()">
                  <td><strong>{{ row.serviceName || row.serviceId }}</strong><small>{{ row.usageModifierKey }} x {{ row.usageModifierMultiplier }}</small></td>
                  <td>{{ row.staffId || '-' }}</td>
                  <td>{{ row.expectedCost | currency:'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ row.actualCost | currency:'INR':'symbol':'1.0-0' }}</td>
                  <td><span class="badge" [class.warn]="row.overuseFlag">{{ row.variancePct || 0 }}%</span></td>
                  <td>{{ row.referenceType }} · {{ row.referenceId }}</td>
                </tr>
                <tr *ngIf="!usageLogs().length"><td colspan="6" class="empty-cell">No service recipe usage logged yet.</td></tr>
              </tbody>
            </table>
          </div>
        </ng-container>

        <ng-container *ngIf="activeTab() === 'alerts'">
          <div class="table-wrap zenoti-table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Title</th><th>Severity</th><th>Message</th></tr></thead>
              <tbody>
                <tr *ngFor="let alert of alerts()"><td>{{ alert.alertType }}</td><td><strong>{{ alert.title }}</strong></td><td><span class="badge" [class.warn]="alert.severity === 'high'">{{ alert.severity }}</span></td><td>{{ alert.message }}</td></tr>
                <tr *ngIf="!alerts().length"><td colspan="4" class="empty-cell">No open recipe alerts.</td></tr>
              </tbody>
            </table>
          </div>
        </ng-container>

        <div class="zenoti-footer">
          <span>1 to {{ activeTabCount() }} of {{ activeTabCount() }}</span>
          <span>{{ branchRecipeStatus() }}</span>
        </div>
      </section>

      <div class="enterprise-grid two editor-grid">
        <section class="panel editor-panel recipe-canvas">
          <div class="section-title">
            <div>
              <span class="eyebrow">Recipe editor</span>
              <h2>{{ editingRecipeId() ? 'Revise auto-consume recipe' : 'Auto-consume service recipe' }}</h2>
              <p>{{ selectedService()?.name || 'Select one service, then map every product that should be consumed automatically from live inventory.' }}</p>
            </div>
            <button type="button" class="ghost-button mini" (click)="addRecipeItem()">Add product line</button>
          </div>
          <div class="auto-consume-flow">
            <span>Auto Product Consume Service Setup</span>
            <span>POS checkout</span>
            <span>Appointment complete</span>
            <span>Invoice finalization</span>
          </div>
          <form [formGroup]="recipeForm" (ngSubmit)="saveRecipe()" class="enterprise-form">
            <label class="field"><span>Branch</span><select formControlName="branchId"><option value="">All branches</option><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select></label>
            <label class="field"><span>Service</span><select formControlName="serviceId"><option value="">Select service</option><option *ngFor="let service of services()" [value]="service.id">{{ service.name }} · {{ service.price | currency:'INR':'symbol':'1.0-0' }}</option></select></label>
            <label class="field"><span>Recipe name</span><input formControlName="recipeName" placeholder="Keratin standard usage" /></label>
            <label class="field"><span>Approval status</span><select formControlName="approvalStatus"><option value="approved">Approved</option><option value="pending_approval">Pending approval</option><option value="draft">Draft</option></select></label>
            <label class="field"><span>Margin floor %</span><input type="number" formControlName="marginFloorPct" /></label>
            <label class="field"><span>Template</span><select [ngModel]="selectedTemplateKey()" [ngModelOptions]="{standalone: true}" (ngModelChange)="selectedTemplateKey.set($event)"><option value="">AI template</option><option *ngFor="let template of templates()" [value]="template.templateKey">{{ template.templateName }}</option></select></label>

            <div class="template-hint full" *ngIf="selectedTemplate() as template">
              <span>Template guide</span>
              <strong>{{ template.templateName }}</strong>
              <small>{{ templateHint(template) }}</small>
            </div>

            <div class="recipe-lines full">
              <div class="recipe-line head">
                <span>Inventory product</span><span>Auto qty / unit</span><span>Waste %</span><span>Range min/max</span><span>Substitutes</span><span></span>
              </div>
              <div class="recipe-line" *ngFor="let item of recipeItems(); trackBy: trackRecipeItem">
                <select [ngModel]="item.productId" [ngModelOptions]="{standalone: true}" (ngModelChange)="setLineProduct(item, $event)">
                  <option value="">Select consumable</option>
                  <option *ngFor="let product of recipeProducts()" [value]="product.id">{{ product.name }} · {{ product.stock || 0 }} · {{ productType(product) }}</option>
                </select>
                <div class="inline-fields">
                  <input type="number" min="0" [ngModel]="item.quantityPerService" [ngModelOptions]="{standalone: true}" (ngModelChange)="item.quantityPerService = numberValue($event)" />
                  <select [ngModel]="item.unit" [ngModelOptions]="{standalone: true}" (ngModelChange)="item.unit = $event">
                    <option *ngFor="let unit of units" [value]="unit">{{ unit }}</option>
                  </select>
                </div>
                <input type="number" min="0" [ngModel]="item.wastagePct" [ngModelOptions]="{standalone: true}" (ngModelChange)="item.wastagePct = numberValue($event)" />
                <div class="inline-fields">
                  <input type="number" min="0" [ngModel]="item.minQuantityPerService" [ngModelOptions]="{standalone: true}" (ngModelChange)="item.minQuantityPerService = numberValue($event)" />
                  <input type="number" min="0" [ngModel]="item.maxQuantityPerService" [ngModelOptions]="{standalone: true}" (ngModelChange)="item.maxQuantityPerService = numberValue($event)" />
                </div>
                <input [ngModel]="item.allowedSubstitutesText" [ngModelOptions]="{standalone: true}" (ngModelChange)="item.allowedSubstitutesText = $event" placeholder="Alternate product ids/names" />
                <button type="button" class="ghost-button mini danger" (click)="removeRecipeItem(item.uid)" [disabled]="recipeItems().length <= 1">Remove</button>
              </div>
            </div>

            <label class="field full"><span>Notes</span><textarea formControlName="notes" placeholder="Mixing instruction, bowl use, brand preference, staff warning"></textarea></label>
            <div class="form-actions full">
              <span class="auto-ready-note">After save, billing uses this recipe. No physical stock entry needed.</span>
              <button class="ghost-button" type="button" (click)="resetEditor()">Clear</button>
              <button class="primary-button" type="submit" [disabled]="recipeForm.invalid || saving() || !validLines()">Save auto-consume recipe</button>
            </div>
          </form>
        </section>

        <section class="panel impact-panel">
          <div class="section-title"><div><span class="eyebrow">Recipe impact</span><h2>Cost, margin and stock</h2></div></div>
          <div class="impact-stack">
            <article><span>Expected service cost</span><strong>{{ expectedCostPreview() | currency:'INR':'symbol':'1.0-0' }}</strong><small>Qty + wastage + product unit cost</small></article>
            <article><span>Service margin</span><strong>{{ marginPreview() | currency:'INR':'symbol':'1.0-0' }}</strong><small>{{ marginPctPreview() }}% after professional stock</small></article>
            <article><span>Product filter</span><strong>Consumable / Both</strong><small>{{ recipeProducts().length }} products available for BOM</small></article>
            <article><span>FIFO mode</span><strong>Enforced</strong><small>Expiry-first batches are consumed before fresh stock</small></article>
            <article><span>Live tracking</span><strong>SERVICE_USE</strong><small>POS, appointment and invoice usage writes stock ledger rows.</small></article>
          </div>
          <div class="margin-meter">
            <div class="meter-label"><span>Margin health</span><strong>{{ marginPctPreview() }}%</strong></div>
            <div class="meter-track"><span [style.width.%]="safePercent(marginPctPreview())"></span></div>
            <small>Floor target: {{ recipeForm.value.marginFloorPct || 0 }}%</small>
          </div>
          <div class="line-audit">
            <div><strong>{{ activeLineCount() }}</strong><span>active lines</span></div>
            <div><strong>{{ totalWastePct() }}%</strong><span>avg waste</span></div>
            <div><strong>{{ selectedServicePrice() | currency:'INR':'symbol':'1.0-0' }}</strong><span>service price</span></div>
          </div>
        </section>
      </div>

    </section>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .recipes-page {
      --recipe-line: color-mix(in srgb, var(--line) 76%, white);
      --recipe-soft: color-mix(in srgb, var(--teal) 9%, white);
      --recipe-glow: 0 22px 58px color-mix(in srgb, var(--ink) 9%, transparent);
      gap: 0;
    }

    .zenoti-recipe-workspace {
      background: #fff;
      border: 1px solid #d8e1ea;
      display: grid;
      overflow: hidden;
    }

    .zenoti-result-bar,
    .zenoti-filter-row,
    .zenoti-footer {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 10px 16px;
    }

    .zenoti-result-bar,
    .zenoti-filter-row {
      border-bottom: 1px solid #d8e1ea;
    }

    .zenoti-result-bar > div,
    .zenoti-totals {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .zenoti-result-bar strong {
      color: #152033;
      font-size: 14px;
      font-weight: 900;
    }

    .zenoti-result-bar span,
    .zenoti-footer {
      color: #50637d;
      font-size: 12px;
      font-weight: 800;
    }

    .status-chip {
      background: #eaf6ff;
      border: 1px solid #b9d0e7;
      border-radius: 999px;
      color: #173f62;
      display: inline-flex;
      font-size: 12px;
      font-weight: 900;
      line-height: 1;
      padding: 6px 10px;
      white-space: nowrap;
    }

    .zenoti-table-wrap {
      border-radius: 0;
      overflow: auto;
    }

    .zenoti-table-wrap table {
      border-collapse: collapse;
      min-width: 1180px;
      width: 100%;
    }

    .zenoti-table-wrap th,
    .zenoti-table-wrap td {
      border-bottom: 1px solid #dfe6ee;
      color: #243142;
      font-size: 13px;
      padding: 11px 14px;
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }

    .zenoti-table-wrap th {
      background: #f5f8fb;
      color: #5d6e84;
      font-size: 12px;
      font-weight: 900;
    }

    .zenoti-table-wrap td strong {
      color: #075f9e;
      display: block;
      font-size: 14px;
      font-weight: 900;
    }

    .zenoti-table-wrap td small {
      color: #61738d;
      display: block;
      font-size: 11px;
      font-weight: 800;
      margin-top: 3px;
    }

    .empty-cell {
      color: #61738d;
      font-weight: 800;
      padding: 28px 14px;
      text-align: center;
    }

    .zenoti-footer {
      border-top: 1px solid #d8e1ea;
      justify-content: flex-end;
    }

    .editor-grid {
      background: #fff;
      border: 1px solid #d8e1ea;
      border-top: 0;
      padding: 14px 16px;
    }

    .hero-actions,
    .section-title,
    .form-actions,
    .row-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }

    .recipe-command-hero {
      align-items: center;
      width: 100%;
      min-height: 250px;
      padding: 12px 14px;
      border: 1px solid color-mix(in srgb, var(--teal) 18%, var(--line));
      background:
        radial-gradient(circle at 78% 18%, color-mix(in srgb, var(--amber) 18%, transparent), transparent 30%),
        radial-gradient(circle at 12% 10%, color-mix(in srgb, var(--teal) 20%, transparent), transparent 34%),
        linear-gradient(135deg, color-mix(in srgb, var(--surface) 98%, white), color-mix(in srgb, var(--surface-2) 88%, var(--teal)));
      box-shadow: var(--recipe-glow);
    }

    .hero-copy {
      display: grid;
      gap: 6px;
      max-width: 560px;
    }

    .hero-copy h2 {
      max-width: 920px;
      margin: 0;
      font-size: clamp(22px, 2.4vw, 30px);
      letter-spacing: 0;
      line-height: 1.04;
    }

    .hero-copy p,
    .section-title p,
    .command-card p,
    .planner-card p {
      margin: 0;
      color: var(--muted);
      font-weight: 650;
      line-height: 1.5;
    }

    .hero-signal-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 0;
    }

    .hero-signal-row span,
    .recipe-health-pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 9px;
      border: 1px solid color-mix(in srgb, var(--teal) 24%, var(--line));
      border-radius: 999px;
      background: color-mix(in srgb, var(--surface) 86%, white);
      color: var(--ink);
      font-size: 11px;
      font-weight: 900;
      white-space: nowrap;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .metric-grid article,
    .impact-stack article,
    .intel-grid article,
    .alert-grid article {
      border: 1px solid var(--recipe-line);
      border-radius: 18px;
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--surface) 98%, white), color-mix(in srgb, var(--surface-2) 94%, white)),
        var(--surface);
      padding: 14px;
      box-shadow: 0 14px 34px color-mix(in srgb, var(--ink) 5%, transparent);
    }

    .recipe-kpi-grid .kpi-card {
      position: relative;
      overflow: hidden;
      min-height: 104px;
      display: grid;
      align-content: start;
      gap: 6px;
      border-top: 4px solid var(--teal);
    }

    .recipe-kpi-grid .kpi-card::after {
      content: "";
      position: absolute;
      right: -38px;
      bottom: -44px;
      width: 118px;
      height: 118px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--teal) 10%, transparent);
    }

    .recipe-kpi-grid .accent-red { border-top-color: var(--red); }
    .recipe-kpi-grid .accent-amber { border-top-color: var(--amber); }
    .recipe-kpi-grid .accent-violet { border-top-color: var(--violet); }

    .metric-grid span,
    .impact-stack span,
    td small,
    .alert-grid small {
      color: var(--muted);
      display: block;
    }

    .metric-grid strong,
    .impact-stack strong {
      display: block;
      margin-top: 6px;
      font-size: 26px;
      letter-spacing: -0.045em;
    }

    .recipe-kpi-grid .kpi-card > span,
    .recipe-kpi-grid .kpi-card > small {
      position: relative;
      z-index: 1;
      max-width: calc(100% - 72px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .recipe-kpi-grid .kpi-card > strong {
      position: relative;
      z-index: 1;
      margin-top: 0;
      line-height: 1;
    }

    .recipe-kpi-grid .kpi-card > small {
      font-size: 12px;
      line-height: 1.25;
    }

    .recipe-command-strip {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(320px, 0.78fr);
      gap: 14px;
    }

    .command-card {
      min-width: 0;
      display: grid;
      gap: 8px;
      padding: 16px;
      border: 1px solid var(--recipe-line);
      border-radius: 22px;
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--surface) 98%, white), color-mix(in srgb, var(--surface-2) 92%, white)),
        var(--surface);
      box-shadow: var(--recipe-glow);
    }

    .command-card.primary {
      color: white;
      border-color: color-mix(in srgb, var(--teal) 54%, black);
      background:
        radial-gradient(circle at 92% 12%, color-mix(in srgb, var(--amber) 24%, transparent), transparent 34%),
        linear-gradient(135deg, color-mix(in srgb, var(--ink) 90%, var(--teal)), color-mix(in srgb, var(--ink) 82%, black));
    }

    .command-card.primary .eyebrow,
    .command-card.primary p {
      color: color-mix(in srgb, white 72%, transparent);
    }

    .decision-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .decision-row strong,
    .command-card > strong {
      font-size: clamp(21px, 2vw, 30px);
      letter-spacing: -0.03em;
      line-height: 1;
    }

    .command-card p {
      display: -webkit-box;
      overflow: hidden;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      font-size: 13px;
      line-height: 1.35;
    }

    .recipe-health-pill.watch {
      border-color: color-mix(in srgb, var(--amber) 42%, var(--line));
      background: color-mix(in srgb, var(--amber) 13%, white);
    }

    .recipe-health-pill.danger {
      border-color: color-mix(in srgb, var(--red) 42%, var(--line));
      background: color-mix(in srgb, var(--red) 12%, white);
      color: #8a1f17;
    }

    .automation-grid,
    .line-audit {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .automation-grid div,
    .line-audit div {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--recipe-line);
      border-radius: 16px;
      background: color-mix(in srgb, var(--surface) 86%, white);
    }

    .automation-grid strong,
    .line-audit strong,
    .automation-grid small,
    .line-audit span {
      display: block;
    }

    .automation-grid small,
    .line-audit span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
    }

    .auto-consume-flow {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .auto-consume-flow article {
      padding: 14px;
      border: 1px solid color-mix(in srgb, var(--teal) 22%, var(--recipe-line));
      border-radius: 18px;
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--teal) 9%, white), color-mix(in srgb, var(--amber) 8%, white)),
        var(--surface);
      box-shadow: var(--recipe-glow);
    }

    .auto-consume-flow span,
    .auto-consume-flow small,
    .auto-ready-note,
    .auto-status {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }

    .auto-consume-flow strong,
    .auto-consume-flow small,
    .auto-status {
      display: block;
    }

    .auto-status {
      margin-top: 6px;
      color: #0f766e;
    }

    .enterprise-grid.two {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(340px, .65fr);
      gap: 14px;
    }

    .recipe-canvas,
    .impact-panel {
      border: 1px solid #d8e1ea;
      border-radius: 3px;
      background: #fff;
      box-shadow: none;
    }

    .enterprise-form {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .auto-consume-flow {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }

    .auto-consume-flow span {
      border: 1px solid var(--recipe-line);
      border-radius: 999px;
      padding: 6px 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
      background: var(--recipe-soft);
    }

    .enterprise-form .full {
      grid-column: 1 / -1;
    }

    .enterprise-form textarea {
      min-height: 92px;
      resize: vertical;
    }

    .template-hint {
      display: grid;
      gap: 4px;
      padding: 12px;
      border: 1px dashed color-mix(in srgb, var(--teal) 28%, var(--line));
      border-radius: 16px;
      background: var(--recipe-soft);
    }

    .template-hint span,
    .template-hint small {
      color: var(--muted);
      font-weight: 750;
    }

    .recipe-lines {
      border: 1px solid var(--recipe-line);
      border-radius: 18px;
      overflow: auto;
      background: var(--surface);
    }

    .recipe-line {
      min-width: 1040px;
      display: grid;
      grid-template-columns: 2fr 1.15fr .85fr 1.2fr 1.35fr auto;
      gap: 8px;
      align-items: center;
      padding: 10px;
      border-top: 1px solid var(--recipe-line);
    }

    .recipe-line.head {
      border-top: 0;
      background: color-mix(in srgb, var(--surface-2) 86%, white);
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .inline-fields {
      display: grid;
      grid-template-columns: 1fr 92px;
      gap: 6px;
    }

    .impact-stack,
    .intel-grid,
    .alert-grid {
      display: grid;
      gap: 10px;
    }

    .impact-panel {
      display: grid;
      align-content: start;
      gap: 16px;
    }

    .margin-meter {
      display: grid;
      gap: 8px;
      padding: 14px;
      border: 1px solid var(--recipe-line);
      border-radius: 18px;
      background: color-mix(in srgb, var(--surface) 92%, white);
    }

    .meter-label {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: var(--muted);
      font-weight: 800;
    }

    .meter-track {
      height: 12px;
      overflow: hidden;
      border-radius: 999px;
      background: color-mix(in srgb, var(--line) 54%, white);
    }

    .meter-track span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--red), var(--amber), var(--teal));
    }

    .intel-grid,
    .planner-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .alert-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .planner-grid {
      display: grid;
      gap: 12px;
    }

    .planner-card {
      display: grid;
      gap: 10px;
      align-content: start;
      min-height: 280px;
      padding: 16px;
      border: 1px solid var(--recipe-line);
      border-radius: 20px;
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--surface) 98%, white), color-mix(in srgb, var(--surface-2) 94%, white)),
        var(--surface);
    }

    .planner-card h3 {
      margin: 0;
      font-size: 18px;
      letter-spacing: -0.035em;
    }

    .planner-row {
      display: grid;
      gap: 4px;
      width: 100%;
      border: 1px solid var(--recipe-line);
      border-radius: 14px;
      padding: 11px 12px;
      background: color-mix(in srgb, var(--surface) 88%, white);
      color: var(--ink);
      text-align: left;
      cursor: pointer;
    }

    .planner-row:hover {
      border-color: color-mix(in srgb, var(--teal) 34%, var(--line));
      background: var(--recipe-soft);
    }

    .planner-row span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }

    .alert-grid article.high {
      border-color: #fecaca;
      background: #fff7f7;
    }

    .table-wrap {
      overflow: auto;
      border-radius: 18px;
    }

    table {
      min-width: 980px;
    }

    .recipe-chip {
      display: inline-flex;
      margin: 2px 4px 2px 0;
      padding: 4px 8px;
      border-radius: 999px;
      background: #eef8f6;
      color: #0f766e;
      font-weight: 700;
      font-size: 12px;
    }

    .tab-strip {
      display: inline-flex;
      gap: 6px;
      border: 1px solid var(--recipe-line);
      border-radius: 999px;
      padding: 5px;
      background: color-mix(in srgb, var(--surface) 78%, transparent);
    }

    .tab-strip button {
      border: 0;
      background: transparent;
      padding: 8px 12px;
      border-radius: 999px;
      color: var(--muted);
      font-weight: 900;
      cursor: pointer;
    }

    .tab-strip button.active {
      background: #0f766e;
      color: #fff;
    }

    .danger {
      color: #b91c1c;
    }

    @media (max-width: 1180px) {
      .metric-grid,
      .enterprise-grid.two,
      .enterprise-form,
      .recipe-command-strip,
      .auto-consume-flow,
      .intel-grid,
      .planner-grid,
      .alert-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class InventoryRecipesComponent implements OnInit {
  readonly branches = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly products = signal<ApiRecord[]>([]);
  readonly recipes = signal<ApiRecord[]>([]);
  readonly templates = signal<ApiRecord[]>([]);
  readonly usageLogs = signal<ApiRecord[]>([]);
  readonly alerts = signal<ApiRecord[]>([]);
  readonly dashboard = signal<ApiRecord | null>(null);
  readonly approvedRecipes = computed(() => this.recipes().filter((recipe) => String(recipe.approvalStatus || 'approved') === 'approved'));
  readonly pendingRecipes = computed(() => this.recipes().filter((recipe) => String(recipe.approvalStatus || 'approved') !== 'approved'));
  readonly recipeItems = signal<RecipeItemDraft[]>([]);
  readonly selectedTemplateKey = signal('');
  readonly activeTab = signal<RecipeTab>('recipes');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly editingRecipeId = signal('');
  readonly units = ['ml', 'gm', 'g', 'pcs', 'tube', 'pack', 'box', 'nos'];
  readonly tabs: { id: RecipeTab; label: string }[] = [
    { id: 'recipes', label: 'Recipes' },
    { id: 'planner', label: 'Planner' },
    { id: 'intelligence', label: 'Intelligence' },
    { id: 'usage', label: 'Usage' },
    { id: 'alerts', label: 'Alerts' }
  ];

  readonly recipeForm = this.fb.group({
    branchId: [''],
    serviceId: ['', Validators.required],
    recipeName: [''],
    approvalStatus: ['approved'],
    marginFloorPct: [35],
    notes: ['']
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.recipeItems.set([this.blankLine()]);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const branchId = this.api.selectedBranchId();
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('branches', { limit: 1000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('services', { limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('products', { limit: 10000 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/service-recipes', { limit: 500 })),
      firstValueFrom(this.api.list<ApiRecord>('inventory-intelligence/service-recipes/dashboard', { branchId })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/service-recipes/templates')),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/service-recipes/usage', { branchId, limit: 100 })),
      firstValueFrom(this.api.list<ApiRecord[]>('inventory-intelligence/service-recipes/alerts', { branchId, status: 'open', limit: 100 }))
    ]).then(([branches, services, products, recipes, dashboard, templates, usage, alerts]) => {
      this.branches.set(branches || []);
      this.services.set(services || []);
      this.products.set(products || []);
      this.recipes.set(recipes || []);
      this.dashboard.set(dashboard || null);
      this.templates.set(templates || []);
      this.usageLogs.set(usage || []);
      this.alerts.set(alerts || []);
      if (!this.recipeForm.value.branchId) this.recipeForm.patchValue({ branchId: branchId || '' });
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(this.api.errorText(error, 'Unable to load service recipes'));
      this.loading.set(false);
    });
  }

  saveRecipe(): void {
    if (this.recipeForm.invalid || !this.validLines()) {
      this.recipeForm.markAllAsTouched();
      this.error.set('Service and at least one product line are required.');
      return;
    }
    const raw = this.recipeForm.getRawValue();
    const service = this.selectedService();
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('inventory-intelligence/service-recipes', {
      branchId: raw.branchId,
      serviceId: raw.serviceId,
      recipeName: raw.recipeName || service?.name || 'Service recipe',
      serviceCategory: service?.category || '',
      servicePrice: Number(service?.price || 0),
      approvalStatus: raw.approvalStatus,
      marginFloorPct: Number(raw.marginFloorPct || 0),
      notes: raw.notes,
      usageModifiers: DEFAULT_MODIFIERS,
      enforceConsumableFilter: this.hasTaggedRecipeProducts(),
      versionNote: this.editingRecipeId() ? 'Enterprise BOM revised' : 'Enterprise BOM created',
      items: this.recipeItems().filter((item) => item.productId).map((item, index) => {
        const product = this.productById(item.productId);
        return {
          productId: item.productId,
          quantityPerService: Number(item.quantityPerService || 0),
          unit: item.unit,
          unitCost: Number(product?.unitCost || 0),
          wastagePct: Number(item.wastagePct || 0),
          wastageApprovalPct: Number(item.wastageApprovalPct || 25),
          wastageHitLimit: Math.max(1, Number(item.wastageHitLimit || 3)),
          minQuantityPerService: Number(item.minQuantityPerService || 0),
          maxQuantityPerService: Number(item.maxQuantityPerService || 0),
          allowedSubstitutes: this.csv(item.allowedSubstitutesText),
          sortOrder: index,
          notes: item.notes
        };
      })
    }).subscribe({
      next: () => {
        this.success.set('Enterprise service BOM saved. Future completions will use FIFO, usage logs and margin tracking.');
        this.saving.set(false);
        this.resetEditor(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save recipe'));
        this.saving.set(false);
      }
    });
  }

  approveRecipe(recipe: ApiRecord): void {
    this.saving.set(true);
    this.api.post(`inventory-intelligence/service-recipes/${recipe.id}/approve`, { approved: true, note: 'Approved from recipe control center' }).subscribe({
      next: () => {
        this.success.set(`${recipe.serviceName || recipe.recipeName} approved.`);
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to approve recipe'));
        this.saving.set(false);
      }
    });
  }

  editRecipe(recipe: ApiRecord): void {
    this.editingRecipeId.set(String(recipe.id || ''));
    this.recipeForm.patchValue({
      branchId: recipe.branchId || '',
      serviceId: recipe.serviceId || '',
      recipeName: recipe.recipeName || '',
      approvalStatus: recipe.approvalStatus || 'approved',
      marginFloorPct: Number(recipe.marginFloorPct || 35),
      notes: recipe.notes || ''
    });
    this.recipeItems.set((recipe.items || []).map((item: ApiRecord) => ({
      uid: this.uid(),
      productId: item.productId || '',
      quantityPerService: Number(item.quantityPerService || 1),
      unit: item.unit || 'pcs',
      wastagePct: Number(item.wastagePct || 0),
      wastageApprovalPct: Number(item.wastageApprovalPct || 25),
      wastageHitLimit: Math.max(1, Number(item.wastageHitLimit || 3)),
      minQuantityPerService: Number(item.minQuantityPerService || 0),
      maxQuantityPerService: Number(item.maxQuantityPerService || 0),
      allowedSubstitutesText: (item.allowedSubstitutes || []).join(', '),
      notes: item.notes || ''
    })) || [this.blankLine()]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  resetEditor(clearMessage = true): void {
    this.editingRecipeId.set('');
    if (clearMessage) this.success.set('');
    this.recipeForm.reset({ branchId: this.api.selectedBranchId() || '', serviceId: '', recipeName: '', approvalStatus: 'approved', marginFloorPct: 35, notes: '' });
    this.recipeItems.set([this.blankLine()]);
  }

  addRecipeItem(): void {
    this.recipeItems.update((items) => [...items, this.blankLine()]);
  }

  removeRecipeItem(uid: string): void {
    this.recipeItems.update((items) => items.length > 1 ? items.filter((item) => item.uid !== uid) : items);
  }

  setLineProduct(item: RecipeItemDraft, productId: string): void {
    item.productId = productId;
    const product = this.productById(productId);
    if (product) {
      item.unit = item.unit || 'pcs';
    }
    this.recipeItems.update((items) => [...items]);
  }

  validLines(): boolean {
    return this.recipeItems().some((item) => item.productId && Number(item.quantityPerService || 0) > 0);
  }

  recipeProducts(): ApiRecord[] {
    const tagged = this.products().filter((product) => ['consumable', 'both'].includes(this.productType(product)));
    return tagged.length ? tagged : this.products();
  }

  hasTaggedRecipeProducts(): boolean {
    return this.products().some((product) => ['consumable', 'both'].includes(this.productType(product)));
  }

  expectedCostPreview(): number {
    return Math.round(this.recipeItems().reduce((sum, item) => {
      const product = this.productById(item.productId);
      return sum + Number(item.quantityPerService || 0) * (1 + Number(item.wastagePct || 0) / 100) * Number(product?.unitCost || 0);
    }, 0));
  }

  marginPreview(): number {
    return Math.round(Number(this.selectedService()?.price || 0) - this.expectedCostPreview());
  }

  marginPctPreview(): number {
    const price = Number(this.selectedService()?.price || 0);
    return price ? Math.round((this.marginPreview() / price) * 100) : 0;
  }

  metric(key: string): number {
    return Number((this.dashboard()?.['metrics'] || {})[key] || 0);
  }

  activeTabCount(): number {
    if (this.activeTab() === 'recipes') return this.recipes().length;
    if (this.activeTab() === 'planner') return this.dashboardList('missingRecipes').length + this.weakMarginRows().length + this.upcomingDemandRows().length;
    if (this.activeTab() === 'intelligence') return this.dashboardList('missingRecipes').length + this.dashboardList('lowStockForecast').length + this.dashboardList('aiSuggestions').length;
    if (this.activeTab() === 'usage') return this.usageLogs().length;
    return this.alerts().length;
  }

  coveragePct(): number {
    const configured = this.metric('configuredRecipes');
    const missing = this.metric('missingRecipes');
    const total = configured + missing;
    return total ? Math.round((configured / total) * 100) : 100;
  }

  highAlertCount(): number {
    return this.alerts().filter((alert) => String(alert.severity || '').toLowerCase() === 'high').length;
  }

  riskLevel(): 'Ready' | 'Watch' | 'High' {
    if (this.highAlertCount() || this.metric('missingRecipes') > 20 || this.coveragePct() < 50) return 'High';
    if (this.metric('missingRecipes') || this.metric('lowStockForecast') || this.weakMarginRows().length) return 'Watch';
    return 'Ready';
  }

  decisionSummary(): string {
    if (this.metric('missingRecipes')) {
      return `${this.metric('missingRecipes')} services need BOM.`;
    }
    if (this.metric('lowStockForecast')) {
      return `${this.metric('lowStockForecast')} product stock risks.`;
    }
    if (this.weakMarginRows().length) {
      return `${this.weakMarginRows().length} low-margin recipes.`;
    }
    return 'Recipes are healthy.';
  }

  topActionTitle(): string {
    const suggestion = this.dashboardList('aiSuggestions')[0];
    if (suggestion?.title) return String(suggestion.title);
    if (this.topMissingRecipe()?.serviceName) return 'Create BOM';
    if (this.topLowStockForecast()?.productName) return 'Check stock';
    if (this.weakMarginRows()[0]?.serviceName) return 'Check margin';
    return 'Stable';
  }

  topActionMessage(): string {
    const suggestion = this.dashboardList('aiSuggestions')[0];
    if (suggestion?.message) return String(suggestion.message);
    const missing = this.topMissingRecipe();
    if (missing) return `${missing.serviceName} needs a recipe.`;
    const lowStock = this.topLowStockForecast();
    if (lowStock) return `${lowStock.productName}: ${lowStock.requiredQty} ${lowStock.unit} needed.`;
    const weak = this.weakMarginRows()[0];
    if (weak) return `${weak.serviceName}: ${weak.expectedMarginPct}% margin.`;
    return 'No urgent action.';
  }

  dashboardList(key: string): ApiRecord[] {
    return ((this.dashboard()?.[key] || []) as ApiRecord[]);
  }

  weakMarginRows(): ApiRecord[] {
    return this.dashboardList('marginRows').filter((row) => Boolean(row.weakMargin) || Number(row.expectedMarginPct || 0) < Number(row.marginFloorPct || 0));
  }

  upcomingDemandRows(): ApiRecord[] {
    return this.dashboardList('upcomingDemand');
  }

  topMissingRecipe(): ApiRecord | undefined {
    return this.dashboardList('missingRecipes')[0];
  }

  topLowStockForecast(): ApiRecord | undefined {
    return this.dashboardList('lowStockForecast')[0];
  }

  branchRecipeStatus(): string {
    const branchId = this.api.selectedBranchId();
    return branchId ? `Branch scope · ${this.branchName(branchId)}` : 'All-branch recipe scope';
  }

  selectedTemplate(): ApiRecord | undefined {
    return this.templates().find((template) => template.templateKey === this.selectedTemplateKey());
  }

  templateHint(template: ApiRecord): string {
    const items = this.asTextList(template.items || template.itemsJson || template.items_json);
    const confidence = template.aiSuggestion?.confidence || this.parseJson(template.aiSuggestionJson || template.ai_suggestion_json)?.confidence;
    const guide = items.length ? `Suggested stock: ${items.join(', ')}` : 'Use this template as the service-category starting point.';
    return confidence ? `${guide} · confidence ${Math.round(Number(confidence) * 100)}%` : guide;
  }

  activeLineCount(): number {
    return this.recipeItems().filter((item) => item.productId && Number(item.quantityPerService || 0) > 0).length;
  }

  totalWastePct(): number {
    const active = this.recipeItems().filter((item) => item.productId);
    if (!active.length) return 0;
    return Math.round(active.reduce((sum, item) => sum + Number(item.wastagePct || 0), 0) / active.length);
  }

  safePercent(value: number): number {
    return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
  }

  selectedServicePrice(): number {
    return Number(this.selectedService()?.price || 0);
  }

  branchName(id: string): string {
    return this.branches().find((branch) => branch.id === id)?.name || (id ? id : 'All branches');
  }

  productType(product: ApiRecord): string {
    const type = String(product.usageType || product.productType || 'retail').toLowerCase();
    return type === 'internal' || type === 'professional' ? 'consumable' : type;
  }

  productById(id: string): ApiRecord | undefined {
    return this.products().find((product) => product.id === id);
  }

  selectedService(): ApiRecord | undefined {
    return this.services().find((service) => service.id === this.recipeForm.value.serviceId);
  }

  numberValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  trackRecipeItem(_: number, item: RecipeItemDraft): string {
    return item.uid;
  }

  private blankLine(): RecipeItemDraft {
    return {
      uid: this.uid(),
      productId: '',
      quantityPerService: 1,
      unit: 'pcs',
      wastagePct: 0,
      wastageApprovalPct: 25,
      wastageHitLimit: 3,
      minQuantityPerService: 0,
      maxQuantityPerService: 0,
      allowedSubstitutesText: '',
      notes: ''
    };
  }

  private asTextList(value: unknown): string[] {
    const parsed = Array.isArray(value) ? value : this.parseJson(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  }

  private parseJson(value: unknown): any {
    if (!value || typeof value !== 'string') return value || null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private csv(value: string): string[] {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  }

  private uid(): string {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
