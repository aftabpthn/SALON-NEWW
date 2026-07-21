import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { LanguageService } from '../../core/i18n/language.service';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';
import { filterPurchaseOrders, openPurchaseOrderValue, PurchaseOrderStage } from './purchase-order-register';

type Tab = 'products' | 'batches' | 'ledger' | 'reorder' | 'valuation' | 'suppliers' | 'orders' | 'grn' | 'returns' | 'payables' | 'transfers';
type Drawer = 'product' | 'kit' | 'supplier' | 'order' | 'orderHistory' | 'grn' | 'return' | 'payment' | 'transfer' | null;
type Supplier = { id: string; code: string; name: string; gstin: string; contactName: string; phone: string; email: string; address: string; paymentTermsDays: number; active: boolean };
type InventoryPolicy = { valuationMethod: 'weighted_average' | 'fifo'; negativeStockRule: 'block' | 'approval_required' };
type SupplierGovernance = { priceLists: Array<{ id:string; supplierId:string; productName:string; unitCostPaise:number; effectiveFrom:string }>; terms: Array<{ supplierId:string; inventoryItemId:string; leadTimeDays:number; minimumOrderQuantity:number; packSize:number }>; scorecards: Array<{ supplierId:string; purchaseOrders:number; receivedOrders:number; onTimeRateBps?:number; fillRateBps?:number; lastReceiptDate?:string }>; communications: Array<{ id:string; supplierId:string; channel:string; status:string; createdAt:string }> };
type SupplierDraft = Omit<Supplier, 'paymentTermsDays'> & { paymentTermsDays: number | null };
type Item = { id: string; sku: string; name: string; category: string; unit: string; stockQuantity: number; reorderPoint: number; unitCostPaise: number; hsnCode: string; gstPercent: number; barcode: string; batchTracked: boolean; active: boolean; createdAt: string; updatedAt?: string };
type KitComponent = { componentInventoryItemId: string; componentName: string; quantity: number };
type Product360 = { product: Item; stockInQuantity: number; stockOutQuantity: number; lastMovementAt?: string; lastReceiptDate?: string; lastSupplier?: string; recipeCount: number; consumedQuantity: number; kitComponents: KitComponent[] };
type Order = { id: string; orderNumber: string; supplierId: string; supplierName: string; status: string; expectedDate?: string; notes: string; totalPaise: number; lineCount: number; createdAt: string };
type OrderLine = { id: string; inventoryItemId: string; itemName: string; quantity: number; receivedQuantity: number; unitCostPaise: number; gstPercent: number; totalPaise: number };
type OrderEvent = { id: string; eventType: string; fromStatus: string; toStatus: string; note: string; actorUserId: string; details: Record<string, unknown>; createdAt: string };
type Receipt = { id: string; supplierName: string; supplierGstin: string; supplierInvoiceNumber: string; receivedDate: string; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; createdAt: string };
type ReceiptLine = { id: string; inventoryItemId: string; quantity: number; unitCostPaise: number; gstPercent: number; totalPaise: number };
type PurchaseReturn = { id: string; purchaseReceiptId: string; supplierName: string; reason: string; totalPaise: number; createdAt: string };
type Payable = { purchaseReceiptId: string; supplierName: string; supplierInvoiceNumber: string; dueDate?: string; totalPaise: number; returnedPaise: number; paidPaise: number; balancePaise: number };
type Transfer = { id: string; sourceBranchId: string; destinationBranchId: string; status: string; notes: string; dispatchedAt: string };
type EntryLine = { inventoryItemId: string; quantity: number | null; unitCostRupees: number | null; gstPercent: number | null; batchNumber?: string; batchBarcode?: string; expiryDate?: string; sourceLineId?: string; maxQuantity?: number };
type Batch = { id: string; inventoryItemId: string; productName: string; batchNumber: string; barcode: string; expiryDate?: string; receivedDate: string; quantity: number; unitCostPaise: number };
type LedgerRow = { id: string; inventoryItemId: string; itemName: string; movementType: string; quantityDelta: number; unitCostPaise: number; valuePaise: number; stockAfterQuantity?: number; source: string; createdAt: string };
type ReorderRow = { id?: string; productId: string; productName: string; sku: string; currentStock: number; reorderLevel: number; suggestedQuantity: number; priority: string; reason: string; estimatedValuePaise: number; confidenceBps?: number; status?: string };
type ReorderForecast = { run: { id: string; modelVersion: string; createdAt: string }; recommendations: Array<{ id: string; inventoryItemId: string; productName: string; sku: string; currentStock: number; reorderLevel: number; suggestedQuantity: number; unitCostPaise: number; confidenceBps: number; status: string; explanation: Record<string, unknown> }> };
type ValuationRow = { inventoryItemId: string; productName: string; category: string; stockQuantity: number; unitCostPaise: number; stockValuePaise: number; reorderPoint: number };

const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn',
  G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww',
  M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn',
  S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn',
  '$': 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

@Component({
  selector: 'page-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent, TranslatePipe],
  templateUrl: './inventory-page.component.html',
  styleUrls: ['./inventory-page.component.css'],
})
export class InventoryPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  readonly language = inject(LanguageService);
  readonly tabs: { id: Tab; labelKey: string }[] = [
    { id: 'products', labelKey: 'inventory.products' },
    { id: 'batches', labelKey: 'inventory.batchesExpiry' },
    { id: 'ledger', labelKey: 'inventory.stockLedger' }, { id: 'reorder', labelKey: 'inventory.reorder' },
    { id: 'valuation', labelKey: 'inventory.valuation' }, { id: 'transfers', labelKey: 'inventory.transfers' },
    { id: 'suppliers', labelKey: 'inventory.suppliers' }, { id: 'orders', labelKey: 'inventory.purchaseOrders' },
    { id: 'grn', labelKey: 'inventory.grn' }, { id: 'returns', labelKey: 'inventory.returns' }, { id: 'payables', labelKey: 'inventory.payables' },
  ];
  tab: Tab = 'products';
  standaloneOrders = false;
  pageTitle = '';
  drawer: Drawer = null;
  loading = true;
  saving = false;
  error = '';
  notice = '';
  suppliers: Supplier[] = [];
  inventoryPolicy: InventoryPolicy = { valuationMethod: 'weighted_average', negativeStockRule: 'block' };
  supplierGovernance: SupplierGovernance = { priceLists: [], terms: [], scorecards: [], communications: [] };
  supplierTermsDraft = { inventoryItemId: '', leadTimeDays: null as number | null, minimumOrderQuantity: null as number | null, packSize: null as number | null, safetyStockDays: 7 };
  supplierPriceDraft = { inventoryItemId: '', unitCostRupees: null as number | null, effectiveFrom: new Date().toISOString().slice(0,10) };
  supplierCommunicationDraft = { channel: 'email', destination: '', subject: '', message: '' };
  items: Item[] = [];
  orders: Order[] = [];
  orderHistoryOrder: Order | null = null;
  orderEvents: OrderEvent[] = [];
  orderQuery = '';
  orderStatus = '';
  orderSupplier = '';
  orderStage: PurchaseOrderStage = 'draft';
  receipts: Receipt[] = [];
  receiptFrom = '';
  receiptTo = '';
  receiptQuery = '';
  receiptSupplier = '';
  returns: PurchaseReturn[] = [];
  payables: Payable[] = [];
  transfers: Transfer[] = [];
  batches: Batch[] = [];
  ledgerRows: LedgerRow[] = [];
  reorderRows: ReorderRow[] = [];
  reorderRun: ReorderForecast['run'] | null = null;
  valuationRows: ValuationRow[] = [];
  productQuery = '';
  productCategory = '';
  ledgerFrom = '';
  ledgerTo = '';
  ledgerMovement = '';
  ledgerQuery = '';
  reorderPriority = '';
  valuationAsOf = new Date().toISOString().slice(0, 10);
  productDetail: Product360 | null = null;
  productLoading = false;
  productEditing = false;
  productCreating = false;
  productDraft = this.emptyProduct();
  stocktakeDraft = { stockQuantity: null as number | null, reason: '' };
  kitDraft = { components: [] as Array<{ inventoryItemId: string; quantity: number | null }>, quantity: null as number | null };

  supplierId = '';
  supplierDraft = this.emptySupplier();
  orderDraft = { supplierId: '', expectedDate: '', notes: '', lines: [this.emptyLine()] as EntryLine[] };
  grnDraft = { supplierId: '', purchaseOrderId: '', invoiceNumber: '', receivedDate: '', dueDate: '', lines: [this.emptyLine()] as EntryLine[] };
  returnDraft = { receiptId: '', reason: '', lines: [] as EntryLine[] };
  paymentDraft = { receiptId: '', amountRupees: null as number | null, method: 'bank', reference: '' };
  transferDraft = { destinationBranchId: '', notes: '', lines: [{ sourceInventoryItemId: '', destinationInventoryItemId: '', quantity: null as number | null }] };

  async ngOnInit() {
    const data = this.route.snapshot.data;
    this.standaloneOrders = this.route.snapshot.routeConfig?.path === 'purchase-orders';
    this.tab = data['inventoryTab'] ?? this.tab; this.pageTitle = data['inventoryTitle'] ?? '';
    await this.reload();
    if (data['inventoryDrawer'] === 'grn') await this.openGrn();
  }

  async reload() {
    this.loading = true; this.error = '';
    try {
      const [suppliers, items, orders, receipts, returns, payables, transfers, batches, governance, policy] = await Promise.all([
        this.get<Supplier[]>('/purchases/suppliers'), this.get<Item[]>('/inventory?pageSize=200'),
        this.get<Order[]>('/purchases/orders'), this.get<Receipt[]>('/purchases/grn'),
        this.get<PurchaseReturn[]>('/purchases/returns'), this.get<Payable[]>('/purchases/payables'), this.get<Transfer[]>('/inventory/transfers'), this.get<Batch[]>('/inventory/batches'), this.get<SupplierGovernance>('/inventory/supplier-governance'), this.get<InventoryPolicy>('/inventory/policy'),
      ]);
      this.suppliers = suppliers; this.items = items; this.orders = orders;
      this.receipts = receipts; this.returns = returns; this.payables = payables; this.transfers = transfers; this.batches = batches; this.supplierGovernance = governance; this.inventoryPolicy = policy;
      await this.loadOperationalTab();
    } catch (error) { this.error = this.message(error, this.language.text('inventory.errors.procurementLoad')); }
    finally { this.loading = false; }
  }

  selectTab(tab: Tab) { this.tab = tab; this.pageTitle = ''; this.closeDrawer(); void this.loadOperationalTab(); }
  closeDrawer() { if (!this.saving) { this.drawer = null; this.productEditing = false; this.productCreating = false; } }
  money(paise: number) { return this.language.formatCurrency((paise || 0) / 100); }
  date(value?: string) { return value ? this.language.formatDate(new Date(`${value.slice(0, 10)}T00:00:00`)) : '—'; }
  itemName(id: string) { return this.items.find((item) => item.id === id)?.name ?? id; }
  remaining(line: OrderLine) { return Math.max(line.quantity - line.receivedQuantity, 0); }
  receiptGst(row: Receipt) { return row.cgstPaise + row.sgstPaise + row.igstPaise; }
  receiptSum(field: 'taxablePaise' | 'totalPaise') { return this.filteredReceipts.reduce((sum, row) => sum + row[field], 0); }
  get receiptGstTotal() { return this.filteredReceipts.reduce((sum, row) => sum + this.receiptGst(row), 0); }
  get receiptPayableTotal() {
    const ids = new Set(this.filteredReceipts.map((row) => row.id));
    return this.payables.filter((row) => ids.has(row.purchaseReceiptId)).reduce((sum, row) => sum + row.balancePaise, 0);
  }
  supplierScorecard(id: string) { return this.supplierGovernance.scorecards.find((row) => row.supplierId === id); }
  supplierTerms(id: string) { return this.supplierGovernance.terms.filter((row) => row.supplierId === id); }
  supplierPrices(id: string) { return this.supplierGovernance.priceLists.filter((row) => row.supplierId === id); }

  get receiptSuppliers() { return [...new Set(this.receipts.map((row) => row.supplierName))].sort((a, b) => a.localeCompare(b)); }
  get heading() {
    if (this.pageTitle) return this.pageTitle;
    const key = ({ products: 'inventory.title', batches: 'inventory.batchesExpiry', ledger: 'inventory.stockLedger', reorder: 'inventory.reorderSuggestions', valuation: 'inventory.inventoryValuation', orders: 'inventory.purchaseOrders' } as Partial<Record<Tab, string>>)[this.tab] ?? 'inventory.procurement';
    return this.language.text(key);
  }
  get productCategories() { return [...new Set(this.items.map((row) => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
  get filteredItems() {
    const query = this.productQuery.trim().toLowerCase();
    return this.items.filter((row) => (!query || `${row.name} ${row.sku} ${row.barcode}`.toLowerCase().includes(query))
      && (!this.productCategory || row.category === this.productCategory));
  }
  get lowStockItems() { return this.items.filter((row) => row.stockQuantity > 0 && row.stockQuantity <= row.reorderPoint); }
  get outOfStockItems() { return this.items.filter((row) => row.stockQuantity <= 0); }
  get inventoryValue() { return this.items.reduce((sum, row) => sum + row.stockQuantity * row.unitCostPaise, 0); }
  get filteredReorderRows() { return this.reorderRows.filter((row) => !this.reorderPriority || row.priority === this.reorderPriority); }
  get reorderValue() { return this.filteredReorderRows.reduce((sum, row) => sum + row.estimatedValuePaise, 0); }
  get valuationValue() { return this.valuationRows.reduce((sum, row) => sum + row.stockValuePaise, 0); }
  get valuationUnits() { return this.valuationRows.reduce((sum, row) => sum + row.stockQuantity, 0); }
  get valuationLowStockValue() { return this.valuationRows.filter((row) => row.stockQuantity <= row.reorderPoint).reduce((sum, row) => sum + row.stockValuePaise, 0); }
  get valuationExceptions() { return this.valuationRows.filter((row) => row.stockQuantity > 0 && row.unitCostPaise <= 0).length; }
  get ledgerStockIn() { return this.ledgerRows.filter((row) => row.quantityDelta > 0).length; }
  get ledgerStockOut() { return this.ledgerRows.filter((row) => row.quantityDelta < 0).length; }
  get ledgerAdjustments() { return this.ledgerRows.filter((row) => row.movementType === 'adjustment').length; }
  get filteredReceipts() {
    const query = this.receiptQuery.trim().toLowerCase();
    return this.receipts.filter((row) => {
      const received = row.receivedDate.slice(0, 10);
      return (!this.receiptFrom || received >= this.receiptFrom)
        && (!this.receiptTo || received <= this.receiptTo)
        && (!this.receiptSupplier || row.supplierName === this.receiptSupplier)
        && (!query || `${row.supplierName} ${row.supplierInvoiceNumber} ${row.supplierGstin}`.toLowerCase().includes(query));
    });
  }

  get filteredOrders() {
    return filterPurchaseOrders(this.orders, { query: this.orderQuery, status: this.orderStatus, supplierId: this.orderSupplier, stage: this.orderStage });
  }
  get orderStatuses() { return [...new Set(this.orders.map((row) => row.status))].sort(); }
  get orderOpenValue() { return openPurchaseOrderValue(this.orders); }
  orderCount(status: string) { return this.orders.filter((row) => row.status === status).length; }
  selectOrderStage(stage: Exclude<PurchaseOrderStage, ''>) { this.orderStage = stage; this.orderStatus = ''; }
  selectOrderStatus(status: string) { this.orderStatus = status; if (status) this.orderStage = ''; }

  async loadOperationalTab() {
    try {
      if (this.tab === 'ledger') await this.loadLedger();
      if (this.tab === 'reorder') await this.loadReorder();
      if (this.tab === 'valuation') await this.loadValuation();
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.c9afc27eb9')); }
  }

  async loadLedger() {
    const query = new URLSearchParams();
    if (this.ledgerFrom) query.set('from', this.ledgerFrom);
    if (this.ledgerTo) query.set('to', this.ledgerTo);
    if (this.ledgerMovement) query.set('movement', this.ledgerMovement);
    if (this.ledgerQuery.trim()) query.set('q', this.ledgerQuery.trim());
    this.ledgerRows = await this.get<LedgerRow[]>(`/inventory/ledger?${query}`);
  }

  async loadReorder() {
    const forecast = await this.get<ReorderForecast | null>('/inventory/reorder-forecasts');
    this.reorderRun = forecast?.run ?? null;
    this.reorderRows = forecast?.recommendations.map((row) => ({ id: row.id, productId: row.inventoryItemId, productName: row.productName, sku: row.sku, currentStock: row.currentStock, reorderLevel: row.reorderLevel, suggestedQuantity: row.suggestedQuantity, priority: row.confidenceBps >= 7500 ? 'high' : 'medium', reason: `AI forecast · ${Math.round(row.confidenceBps / 100)}% confidence`, estimatedValuePaise: row.suggestedQuantity * row.unitCostPaise, confidenceBps: row.confidenceBps, status: row.status })) ?? [];
  }
  async generateReorder() {
    this.saving = true; this.clearFeedback();
    try { await firstValueFrom(this.api.post('/inventory/reorder-forecasts', {})); await this.loadReorder(); this.notice = this.language.text('inventory.message.398da20892'); }
    catch (error) { this.error = this.message(error, this.language.text('inventory.message.8283ad1a35')); }
    finally { this.saving = false; }
  }
  async approveReorder(row: ReorderRow) {
    if (!row.id) { this.createOrderFromSuggestion(row); return; }
    this.saving = true; this.clearFeedback();
    try { await firstValueFrom(this.api.post(`/inventory/reorder-recommendations/${row.id}/approve`, {})); await this.reload(); this.notice = this.language.text('inventory.message.69bcbb3f55'); }
    catch (error) { this.error = this.message(error, this.language.text('inventory.message.012f9fd0ea')); }
    finally { this.saving = false; }
  }
  async loadValuation() { this.valuationRows = await this.get<ValuationRow[]>(`/inventory/valuation?asOf=${this.valuationAsOf}`); }

  exportLedger() {
    const rows = this.ledgerRows.map((row) => [this.date(row.createdAt), row.itemName, row.movementType, row.quantityDelta, row.valuePaise / 100, row.source]);
    this.downloadCsv(`stock-ledger-${new Date().toISOString().slice(0, 10)}.csv`, ['Date', 'Product', 'Movement', 'Quantity', 'Value', 'Source'].map((value) => this.language.textValue(value)), rows);
  }

  exportValuation() {
    const rows = this.valuationRows.map((row) => [row.productName, row.category, row.stockQuantity, row.unitCostPaise / 100, row.stockValuePaise / 100, row.reorderPoint]);
    this.downloadCsv(`inventory-valuation-${this.valuationAsOf}.csv`, ['Product', 'Category', 'Stock', 'Unit cost', 'Stock value', 'Reorder level'].map((value) => this.language.textValue(value)), rows);
  }

  createOrderFromSuggestion(row: ReorderRow) {
    this.tab = 'orders'; this.pageTitle = ''; this.openOrder();
    const item = this.items.find((entry) => entry.id === row.productId);
    this.orderDraft.lines = [{ inventoryItemId: row.productId, quantity: row.suggestedQuantity, unitCostRupees: (item?.unitCostPaise ?? 0) / 100, gstPercent: item?.gstPercent ?? 0 }];
  }

  exportOrders() {
    const rows = this.filteredOrders.map((row) => [row.orderNumber, row.supplierName, this.date(row.createdAt), this.date(row.expectedDate), row.lineCount, row.totalPaise / 100, row.status]);
    this.downloadCsv(`purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`, ['PO number', 'Supplier', 'Created date', 'Expected date', 'Items', 'Total', 'Status'].map((value) => this.language.textValue(value)), rows);
  }

  exportReceipts() {
    const rows = this.filteredReceipts.map((row) => [this.date(row.receivedDate), row.supplierName, row.supplierGstin, row.supplierInvoiceNumber, row.taxablePaise / 100, this.receiptGst(row) / 100, row.totalPaise / 100]);
    this.downloadCsv(`purchase-bills-${new Date().toISOString().slice(0, 10)}.csv`, ['Bill date', 'Supplier', 'GSTIN', 'Invoice number', 'Taxable', 'GST', 'Total'].map((value) => this.language.textValue(value)), rows);
  }

  private downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
  }

  async openProduct(row: Item) {
    this.drawer = 'product'; this.productEditing = false; this.productCreating = false; this.clearFeedback();
    this.stocktakeDraft = { stockQuantity: null, reason: '' };
    await this.loadProduct(row.id);
  }

  openNewProduct() {
    this.productDetail = null; this.productDraft = this.emptyProduct();
    this.productCreating = true; this.productEditing = true; this.drawer = 'product'; this.clearFeedback();
  }

  startProductEdit() {
    const product = this.productDetail?.product;
    if (!product) return;
    this.productDraft = {
      sku: product.sku, name: product.name, category: product.category, unit: product.unit,
      reorderPoint: product.reorderPoint, unitCostRupees: product.unitCostPaise / 100,
      hsnCode: product.hsnCode, gstPercent: product.gstPercent, barcode: product.barcode,
      batchTracked: product.batchTracked, active: product.active,
    };
    this.productEditing = true; this.clearFeedback();
  }

  async saveProduct() {
    const product = this.productDetail?.product;
    if ((!product && !this.productCreating) || !this.productDraft.name.trim() || !this.productDraft.unit.trim() || Number(this.productDraft.reorderPoint) < 0 || Number(this.productDraft.unitCostRupees) < 0 || Number(this.productDraft.gstPercent) < 0 || Number(this.productDraft.gstPercent) > 100) {
      this.error = this.language.text('inventory.message.1436482d07'); return;
    }
    this.saving = true; this.clearFeedback();
    try {
      const payload = {
        sku: this.productDraft.sku.trim(),
        name: this.titleCase(this.productDraft.name), category: this.titleCase(this.productDraft.category),
        unit: this.productDraft.unit.trim(), reorderPoint: Number(this.productDraft.reorderPoint),
        unitCostPaise: Math.round(Number(this.productDraft.unitCostRupees) * 100),
        hsnCode: this.productDraft.hsnCode.trim(), gstPercent: Number(this.productDraft.gstPercent),
        barcode: this.productDraft.barcode.trim().toUpperCase(), batchTracked: this.productDraft.batchTracked,
        active: this.productDraft.active,
      };
      const response = product
        ? await firstValueFrom(this.api.patch<ApiEnvelope<Item>>(`/inventory/${product.id}`, payload))
        : await firstValueFrom(this.api.post<ApiEnvelope<Item>>('/inventory', { ...payload, stockQuantity: 0 }));
      const savedId = response.data?.id ?? product?.id;
      await this.reload();
      if (savedId) await this.loadProduct(savedId);
      this.productCreating = false; this.productEditing = false; this.notice = this.language.text('inventory.message.0809e15440');
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.e52c90c1c7')); }
    finally { this.saving = false; }
  }

  async openKit(row: Item) {
    this.clearFeedback();
    await this.loadProduct(row.id);
    if (!this.productDetail) return;
    this.kitDraft = {
      components: this.productDetail.kitComponents.length
        ? this.productDetail.kitComponents.map((component) => ({ inventoryItemId: component.componentInventoryItemId, quantity: component.quantity }))
        : [{ inventoryItemId: '', quantity: null }],
      quantity: null,
    };
    this.drawer = 'kit';
  }

  addKitComponent() { this.kitDraft.components.push({ inventoryItemId: '', quantity: null }); }
  removeKitComponent(index: number) { if (this.kitDraft.components.length > 1) this.kitDraft.components.splice(index, 1); }

  async saveKit() {
    const kit = this.productDetail?.product;
    const components = this.kitDraft.components
      .filter((row) => row.inventoryItemId && Number(row.quantity) > 0)
      .map((row) => ({ inventoryItemId: row.inventoryItemId, quantity: Number(row.quantity) }));
    if (!kit || !components.length) { this.error = this.language.text('inventory.message.8de312b32f'); return; }
    this.saving = true; this.clearFeedback();
    try {
      await firstValueFrom(this.api.put(`/inventory/${kit.id}/kit`, { components }));
      await this.loadProduct(kit.id);
      this.notice = this.language.text('inventory.message.80419f63f0');
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.8d5c3750bc')); }
    finally { this.saving = false; }
  }

  async assembleKit() {
    const kit = this.productDetail?.product;
    const quantity = Number(this.kitDraft.quantity);
    if (!kit || !Number.isInteger(quantity) || quantity <= 0) { this.error = this.language.text('inventory.message.b4ffc8fa18'); return; }
    this.saving = true; this.clearFeedback();
    try {
      await firstValueFrom(this.api.post(`/inventory/${kit.id}/assemble`, { quantity, idempotencyKey: crypto.randomUUID() }));
      await this.reload(); await this.loadProduct(kit.id); this.kitDraft.quantity = null;
      this.notice = this.language.text('inventory.message.ded0325efb');
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.a9c2be662d')); }
    finally { this.saving = false; }
  }

  printBarcode(row: Item) {
    const code = (row.barcode || row.sku).trim().toUpperCase();
    if (!code || [...code].some((char) => !CODE39[char])) { this.error = this.language.text('inventory.message.e2383ff060'); return; }
    const popup = window.open('', '_blank', 'width=520,height=420');
    if (!popup) { this.error = this.language.text('inventory.message.d37af2b6c8'); return; }
    popup.document.write('<!doctype html><title>Product label</title><style>body{margin:0;font:14px Arial}main{width:76mm;padding:5mm;text-align:center}h1{font-size:18px;margin:0 0 4mm}svg{width:100%;height:24mm}p{margin:2mm 0;font-weight:700}@media print{main{padding:2mm}}</style><main><h1></h1><div></div><p></p></main>');
    popup.document.querySelector('h1')!.textContent = row.name;
    popup.document.querySelector('div')!.innerHTML = this.code39Svg(code);
    popup.document.querySelector('p')!.textContent = code;
    popup.document.close(); popup.focus(); popup.print();
  }

  isBatchTracked(id: string) { return this.items.find((item) => item.id === id)?.batchTracked ?? false; }

  async applyStocktake() {
    const product = this.productDetail?.product;
    const stockQuantity = Number(this.stocktakeDraft.stockQuantity);
    const reason = this.stocktakeDraft.reason.trim();
    if (!product || this.stocktakeDraft.stockQuantity === null || !Number.isInteger(stockQuantity) || (stockQuantity < 0 && this.inventoryPolicy.negativeStockRule !== 'approval_required') || !reason) {
      this.error = this.language.text('inventory.message.fa79c19033'); return;
    }
    this.saving = true; this.clearFeedback();
    try {
      if (stockQuantity < 0) {
        await firstValueFrom(this.api.post('/inventory/negative-stock-requests', { inventoryItemId: product.id, requestedStockQuantity: stockQuantity, reason }));
        this.stocktakeDraft = { stockQuantity: null, reason: '' }; this.notice = this.language.text('inventory.message.bd80357f01');
      } else {
        await firstValueFrom(this.api.patch<ApiEnvelope<Item>>(`/inventory/${product.id}`, { stockQuantity, adjustmentReason: reason, idempotencyKey: crypto.randomUUID() }));
        await this.reload(); await this.loadProduct(product.id); this.stocktakeDraft = { stockQuantity: null, reason: '' }; this.notice = this.language.text('inventory.message.460f70de67');
      }
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.63c7a3b242')); }
    finally { this.saving = false; }
  }

  openSupplier(row?: Supplier) {
    this.supplierId = row?.id ?? '';
    this.supplierDraft = row ? { ...row } : this.emptySupplier();
    this.supplierTermsDraft = { inventoryItemId: '', leadTimeDays: null, minimumOrderQuantity: null, packSize: null, safetyStockDays: 7 };
    this.supplierPriceDraft = { inventoryItemId: '', unitCostRupees: null, effectiveFrom: new Date().toISOString().slice(0,10) };
    this.supplierCommunicationDraft = { channel: 'email', destination: row?.email || '', subject: '', message: '' };
    this.drawer = 'supplier'; this.clearFeedback();
  }

  openOrder() {
    this.orderDraft = { supplierId: '', expectedDate: '', notes: '', lines: [this.emptyLine()] };
    this.drawer = 'order'; this.clearFeedback();
  }

  async openGrn(order?: Order) {
    this.clearFeedback();
    this.grnDraft = { supplierId: order?.supplierId ?? '', purchaseOrderId: order?.id ?? '', invoiceNumber: '', receivedDate: '', dueDate: '', lines: [this.emptyLine()] };
    if (order) {
      try {
        const details = await this.get<{ order: Order; lines: OrderLine[] }>(`/purchases/orders/${order.id}`);
        this.grnDraft.lines = details.lines.filter((line) => this.remaining(line) > 0).map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: this.remaining(line), unitCostRupees: line.unitCostPaise / 100, gstPercent: line.gstPercent }));
      } catch (error) { this.error = this.message(error, this.language.text('inventory.message.5749120dce')); return; }
    }
    this.drawer = 'grn';
  }

  async openReturn(receipt?: Receipt) {
    const selected = receipt ?? this.receipts[0];
    this.returnDraft = { receiptId: selected?.id ?? '', reason: '', lines: [] };
    this.drawer = 'return'; this.clearFeedback();
    if (selected) await this.loadReturnLines();
  }

  async loadReturnLines() {
    if (!this.returnDraft.receiptId) { this.returnDraft.lines = []; return; }
    try {
      const details = await this.get<{ lines: ReceiptLine[] }>(`/purchases/grn/${this.returnDraft.receiptId}`);
      this.returnDraft.lines = details.lines.map((line) => ({ inventoryItemId: line.inventoryItemId, sourceLineId: line.id, quantity: null, unitCostRupees: line.unitCostPaise / 100, gstPercent: line.gstPercent, maxQuantity: line.quantity }));
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.50cf87fc57')); }
  }

  openPayment(row: Payable) {
    this.paymentDraft = { receiptId: row.purchaseReceiptId, amountRupees: row.balancePaise / 100, method: 'bank', reference: '' };
    this.drawer = 'payment'; this.clearFeedback();
  }

  openTransfer() {
    this.transferDraft = { destinationBranchId: '', notes: '', lines: [{ sourceInventoryItemId: '', destinationInventoryItemId: '', quantity: null }] };
    this.drawer = 'transfer'; this.clearFeedback();
  }

  addTransferLine() { this.transferDraft.lines.push({ sourceInventoryItemId: '', destinationInventoryItemId: '', quantity: null }); }
  removeTransferLine(index: number) { if (this.transferDraft.lines.length > 1) this.transferDraft.lines.splice(index, 1); }

  addLine(target: 'order' | 'grn') { (target === 'order' ? this.orderDraft.lines : this.grnDraft.lines).push(this.emptyLine()); }
  removeLine(target: 'order' | 'grn', index: number) { const lines = target === 'order' ? this.orderDraft.lines : this.grnDraft.lines; if (lines.length > 1) lines.splice(index, 1); }
  syncItem(line: EntryLine) {
    const item = this.items.find((row) => row.id === line.inventoryItemId);
    if (item) { line.unitCostRupees = item.unitCostPaise / 100; line.gstPercent = item.gstPercent; }
  }

  titleCase(value: string) { return value.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()); }

  async saveSupplier() {
    const payload = { ...this.supplierDraft, name: this.titleCase(this.supplierDraft.name), contactName: this.titleCase(this.supplierDraft.contactName), paymentTermsDays: Number(this.supplierDraft.paymentTermsDays || 0) };
    await this.mutate(this.supplierId ? this.api.patch<ApiEnvelope<Supplier>>(`/purchases/suppliers/${this.supplierId}`, payload) : this.api.post<ApiEnvelope<Supplier>>('/purchases/suppliers', payload), 'Supplier saved');
  }

  async saveSupplierTerms() {
    const draft = this.supplierTermsDraft;
    if (!this.supplierId || !draft.inventoryItemId || draft.leadTimeDays === null || draft.minimumOrderQuantity === null || draft.packSize === null) return;
    this.saving = true; this.clearFeedback(); try { await firstValueFrom(this.api.post('/inventory/reorder-supplier-terms', { supplierId: this.supplierId, ...draft })); await this.reload(); this.notice = this.language.text('inventory.message.1c28eea79e'); } catch (error) { this.error = this.message(error, this.language.text('inventory.message.7f6964929f')); } finally { this.saving = false; }
  }
  async saveSupplierPrice() {
    if (!this.supplierId || !this.supplierPriceDraft.inventoryItemId || this.supplierPriceDraft.unitCostRupees === null) return;
    this.saving = true; this.clearFeedback(); try { await firstValueFrom(this.api.post('/inventory/supplier-governance/prices', { supplierId: this.supplierId, inventoryItemId: this.supplierPriceDraft.inventoryItemId, unitCostPaise: Math.round(Number(this.supplierPriceDraft.unitCostRupees) * 100), effectiveFrom: this.supplierPriceDraft.effectiveFrom, effectiveTo: null })); await this.reload(); this.notice = this.language.text('inventory.message.570d7c46a0'); } catch (error) { this.error = this.message(error, this.language.text('inventory.message.628af52a7a')); } finally { this.saving = false; }
  }
  async queueSupplierCommunication() {
    if (!this.supplierId || !this.supplierCommunicationDraft.destination.trim() || !this.supplierCommunicationDraft.message.trim()) return;
    this.saving = true; this.clearFeedback(); try { await firstValueFrom(this.api.post('/inventory/supplier-governance/communications', { supplierId: this.supplierId, purchaseOrderId: null, ...this.supplierCommunicationDraft, idempotencyKey: crypto.randomUUID() })); await this.reload(); this.notice = this.language.text('inventory.message.ff44ae0a75'); } catch (error) { this.error = this.message(error, this.language.text('inventory.message.84b2c1ec7f')); } finally { this.saving = false; }
  }
  async saveOrder() {
    const lines = this.validLines(this.orderDraft.lines, false);
    if (!this.orderDraft.supplierId || !lines.length) { this.error = this.language.text('inventory.message.67fac0e7a7'); return; }
    await this.mutate(this.api.post('/purchases/orders', { supplierId: this.orderDraft.supplierId, expectedDate: this.orderDraft.expectedDate || null, notes: this.orderDraft.notes, lines }), 'Purchase order created');
  }

  async orderAction(order: Order, action: 'submit' | 'approve' | 'reject' | 'send' | 'close' | 'cancel' | 'reopen') {
    if (['reject', 'close', 'cancel', 'reopen'].includes(action) && !confirm(`${action[0].toUpperCase()}${action.slice(1)} purchase order ${order.orderNumber}?`)) return;
    const labels: Record<string, string> = { submit: 'submitted', approve: 'approved', reject: 'rejected', send: 'sent', close: 'closed', cancel: 'cancelled', reopen: 'reopened' };
    await this.mutate(this.api.post(`/purchases/orders/${order.id}/${action}`, { note: '' }), `Purchase order ${labels[action]}`, false);
  }

  async openOrderHistory(order: Order) {
    this.clearFeedback();
    try {
      this.orderEvents = await this.get<OrderEvent[]>(`/purchases/orders/${order.id}/events`);
      this.orderHistoryOrder = order;
      this.drawer = 'orderHistory';
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.d5bda6eae7')); }
  }

  async saveGrn() {
    const supplier = this.suppliers.find((row) => row.id === this.grnDraft.supplierId);
    const lines = this.validLines(this.grnDraft.lines, true);
    if (!supplier || !this.grnDraft.invoiceNumber.trim() || !lines.length) { this.error = this.language.text('inventory.message.d2dbbb62ba'); return; }
    await this.mutate(this.api.post('/purchases/grn', { supplierId: supplier.id, purchaseOrderId: this.grnDraft.purchaseOrderId || null, supplierName: supplier.name, supplierGstin: supplier.gstin, supplierInvoiceNumber: this.grnDraft.invoiceNumber.trim(), receivedDate: this.grnDraft.receivedDate || null, dueDate: this.grnDraft.dueDate || null, idempotencyKey: crypto.randomUUID(), lines }), 'GRN posted');
  }

  async saveReturn() {
    const lines = this.returnDraft.lines.filter((line) => Number(line.quantity) > 0).map((line) => ({ purchaseReceiptLineId: line.sourceLineId, quantity: Number(line.quantity) }));
    if (!this.returnDraft.receiptId || !this.returnDraft.reason.trim() || !lines.length) { this.error = this.language.text('inventory.message.b558c2701e'); return; }
    await this.mutate(this.api.post('/purchases/returns', { purchaseReceiptId: this.returnDraft.receiptId, reason: this.returnDraft.reason.trim(), idempotencyKey: crypto.randomUUID(), lines }), 'Purchase return posted');
  }

  async savePayment() {
    const amountPaise = Math.round(Number(this.paymentDraft.amountRupees) * 100);
    if (!this.paymentDraft.receiptId || amountPaise <= 0) { this.error = this.language.text('inventory.message.62a3419043'); return; }
    await this.mutate(this.api.post('/purchases/payments', { purchaseReceiptId: this.paymentDraft.receiptId, amountPaise, paymentMethod: this.paymentDraft.method, reference: this.paymentDraft.reference.trim(), idempotencyKey: crypto.randomUUID() }), 'Supplier payment posted');
  }

  async saveTransfer() {
    const lines = this.transferDraft.lines.filter((line) => line.sourceInventoryItemId && line.destinationInventoryItemId && Number(line.quantity) > 0).map((line) => ({ ...line, quantity: Number(line.quantity) }));
    if (!this.transferDraft.destinationBranchId.trim() || !lines.length) { this.error = this.language.text('inventory.message.e92deb7bf1'); return; }
    await this.mutate(this.api.post('/inventory/transfers', { destinationBranchId: this.transferDraft.destinationBranchId.trim(), notes: this.transferDraft.notes.trim(), idempotencyKey: crypto.randomUUID(), lines }), 'Inventory transfer dispatched');
  }

  async transferAction(row: Transfer, action: 'receive' | 'cancel') {
    if (!confirm(`${action === 'receive' ? 'Receive' : 'Cancel'} this inventory transfer?`)) return;
    await this.mutate(this.api.post(`/inventory/transfers/${row.id}/${action}`, {}), `Transfer ${action === 'receive' ? 'received' : 'cancelled'}`, false);
  }

  private validLines(lines: EntryLine[], batches: boolean) {
    return lines.filter((line) => line.inventoryItemId && Number(line.quantity) > 0 && Number(line.unitCostRupees) >= 0).map((line) => ({
      inventoryItemId: line.inventoryItemId, quantity: Number(line.quantity),
      unitCostPaise: Math.round(Number(line.unitCostRupees) * 100), gstPercent: Number(line.gstPercent || 0),
      ...(batches ? { batchNumber: line.batchNumber?.trim() || null, batchBarcode: line.batchBarcode?.trim().toUpperCase() || null, expiryDate: line.expiryDate || null } : {}),
    }));
  }

  private async mutate(request: any, success: string, close = true) {
    this.saving = true; this.clearFeedback();
    try { await firstValueFrom(request); this.notice = success; if (close) this.drawer = null; await this.reload(); this.notice = success; }
    catch (error) { this.error = this.message(error, this.language.text('inventory.message.78b92a0634')); }
    finally { this.saving = false; }
  }

  private async get<T>(path: string) { const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path)); if (response.data === undefined) throw new Error('API response did not contain data'); return response.data; }
  private async loadProduct(id: string) {
    this.productLoading = true; this.productDetail = null;
    try { this.productDetail = await this.get<Product360>(`/inventory/${id}/360`); }
    catch (error) { this.error = this.message(error, this.language.text('inventory.message.401335ec5e')); }
    finally { this.productLoading = false; }
  }
  private message(error: any, fallback: string) { return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback; }
  private clearFeedback() { this.error = ''; this.notice = ''; }
  private code39Svg(code: string) {
    let x = 0; const bars: string[] = [];
    for (const char of `*${code}*`) {
      CODE39[char].split('').forEach((width, index) => {
        const size = width === 'w' ? 5 : 2;
        if (index % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${size}" height="70"/>`);
        x += size;
      });
      x += 2;
    }
    return `<svg viewBox="0 0 ${x} 70" role="img" aria-label="Barcode ${code}" xmlns="http://www.w3.org/2000/svg">${bars.join('')}</svg>`;
  }
  private emptyProduct() { return { sku: '', name: '', category: '', unit: '', reorderPoint: null as number | null, unitCostRupees: null as number | null, hsnCode: '', gstPercent: null as number | null, barcode: '', batchTracked: false, active: true }; }
  private emptyLine(): EntryLine { return { inventoryItemId: '', quantity: null, unitCostRupees: null, gstPercent: null, batchNumber: '', batchBarcode: '', expiryDate: '' }; }
  private emptySupplier(): SupplierDraft { return { id: '', code: '', name: '', gstin: '', contactName: '', phone: '', email: '', address: '', paymentTermsDays: null, active: true }; }
}
