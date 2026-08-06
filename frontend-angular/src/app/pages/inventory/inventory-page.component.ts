import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { LanguageService } from '../../core/i18n/language.service';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';
import { ActionDialogService } from '../../shared/services/action-dialog.service';
import { AuthBranchAccess, AuthService } from '../../core/services/auth.service';
import { BranchNamePipe } from '../../shared/pipes/branch-name.pipe';
import { filterPurchaseOrders, openPurchaseOrderValue, PurchaseOrderStage } from './purchase-order-register';
import { ageingRows, AuditDetails, csvContent, nearExpiryRows, supplierPerformanceRows, traceabilityRows, varianceRows } from './inventory-report-model';

type Tab = 'products' | 'batches' | 'ledger' | 'reorder' | 'valuation' | 'reports' | 'suppliers' | 'orders' | 'grn' | 'returns' | 'payables' | 'transfers';
type ReportView = 'stock' | 'ageing' | 'cogs' | 'expiry' | 'traceability' | 'variance' | 'suppliers' | 'catalog';
type Drawer = 'product' | 'kit' | 'supplier' | 'order' | 'orderHistory' | 'grn' | 'return' | 'quarantine' | 'payment' | 'transfer' | null;
type Supplier = { id: string; code: string; name: string; gstin: string; contactName: string; phone: string; email: string; address: string; paymentTermsDays: number; active: boolean };
type InventoryPolicy = { valuationMethod: 'weighted_average' | 'fifo'; negativeStockRule: 'block' | 'approval_required' | 'allow_with_warning'; purchaseOrderSettings:{ bulkRaiseEnabled:boolean }; labelSettings:{ priceCaption:string; showName:boolean; showPrice:boolean; showSku:boolean; showBatch:boolean; showExpiry:boolean; widthMm:number; heightMm:number; columns:number } };
type SupplierGovernance = {
  priceLists: Array<{ id:string; supplierId:string; productName:string; unitCostPaise:number; discountBps:number; gstPercent:number; effectiveFrom:string }>;
  terms: Array<{ supplierId:string; inventoryItemId:string; productName?:string; vendorPartNumber:string; purchaseUnit:string; conversionQuantity:number; centerAvailable:boolean; leadTimeDays:number; minimumOrderQuantity:number; packSize:number }>;
  scorecards: Array<{ supplierId:string; purchaseOrders:number; receivedOrders:number; onTimeRateBps?:number; fillRateBps?:number; lastReceiptDate?:string }>;
  communications: Array<{ id:string; supplierId:string; channel:string; status:string; createdAt:string }>;
  qualityEvents: Array<{ supplierId:string; returnCount:number; returnedQuantity:number; returnedValuePaise:number; lastReturnAt?:string; reasons:string[] }>;
  expiryRisk: Array<{ supplierId:string; expiredQuantity:number; expiring30Quantity:number; riskValuePaise:number; nextExpiryDate?:string }>;
  replacementOptions: Array<{ supplierId:string; inventoryItemId:string; productName:string; replacementSupplierId:string; replacementSupplierName:string; leadTimeDays:number; minimumOrderQuantity:number; packSize:number; unitCostPaise?:number; currentUnitCostPaise?:number; priceDifferencePaise?:number }>;
};
type SupplierDraft = Omit<Supplier, 'paymentTermsDays'> & { paymentTermsDays: number | null };
type Item = { id: string; sku: string; name: string; category: string; subcategory:string; brand: string; productUsage:'retail'|'consumable'|'dual_use'; unit: string; packageUnit: string; unitsPerPackage: number; stockQuantity: number; reorderPoint: number; alertLevel:number; desiredLevel:number; orderLevel:number; safetyStockLevel:number; unitCostPaise: number; retailPricePaise: number; hsnCode: string; gstPercent: number; barcode: string; barcodes:string[]; batchTracked: boolean; dualUseStock: boolean; centerAvailable:boolean; onlineSaleEnabled:boolean; active: boolean; createdAt: string; updatedAt?: string };
type InventoryMasterData = { values:Array<{ id:string; kind:string; code:string; label:string; parentCode:string; active:boolean }>; units:Array<{ code:string; label:string; dimension:string; active:boolean }> };
type KitComponent = { componentInventoryItemId: string; componentName: string; quantity: number };
type KitOperation = { id:string; kitInventoryItemId:string; operationType:'bundle'|'unbundle'|'receipt_unbundle'; quantity:number; comments:string; actorUserId:string; sourceReceiptId?:string; sourceReceiptLineId?:string; unitCostPaise:number; stockAfterQuantity:number; createdAt:string };
type Product360 = {
  product: Item; stockInQuantity: number; stockOutQuantity: number; lastMovementAt?: string;
  lastReceiptDate?: string; lastSupplier?: string; recipeCount: number; consumedQuantity: number;
  retailShelfQuantity: number; sealedBackbarQuantity: number; openContainerBalance: number; openContainerUnit?: string;
  kitComponents: KitComponent[];
  kitAutoUnbundleOnReceive: boolean;
  kitHistory: KitOperation[];
  branchStocks: Array<{ branchId:string; branchName:string; inventoryItemId:string; stockQuantity:number; reorderPoint:number; unitCostPaise:number; stockValuePaise:number }>;
  expiryTimeline: Array<{ branchId:string; branchName:string; batchNumber:string; expiryDate?:string; receivedDate:string; quantity:number; unitCostPaise:number }>;
  clientUsage: Array<{ clientId:string; clientName:string; quantity:number; visits:number; lastUsedAt:string }>;
  entityLedger: Array<{ id:string; branchId:string; branchName:string; movementType:string; quantityDelta:number; unitCostPaise:number; stockBeforeQuantity:number; stockAfterQuantity:number; recordedStockAfterQuantity?:number; source:string; sourceType:string; sourceId:string; actorUserId?:string; clientId?:string; appointmentId?:string; serviceId?:string; staffId?:string; backbarContainerId?:string; batchAllocations:Array<{ batchId:string; batchNumber:string; expiryDate?:string; quantityDelta:number }>; provenanceComplete:boolean; snapshotStatus:'verified'|'reconstructed'|'mismatch'; createdAt:string }>;
  margin: { revenuePaise?:number; costPaise?:number; marginPaise?:number };
  lifecycleEvents:Array<{ id:string; eventType:string; replacementInventoryItemId?:string; replacementProductName?:string; reason:string; actorUserId:string; createdAt:string }>;
};
type Order = { id: string; orderNumber: string; supplierId: string; supplierName: string; status: string; expectedDate?: string; notes: string; shippingPaise: number; handlingPaise: number; totalPaise: number; lineCount: number; createdAt: string };
type OrderLine = { id: string; inventoryItemId: string; itemName: string; packageUnit: string; stockUnit: string; unitsPerPackage: number; quantity: number; receivedQuantity: number; retailQuantity:number; consumableQuantity:number; retailReceivedQuantity:number; consumableReceivedQuantity:number; unitCostPaise: number; discountBps: number; discountPaise: number; gstPercent: number; totalPaise: number };
type OrderEvent = { id: string; eventType: string; fromStatus: string; toStatus: string; note: string; actorUserId: string; details: Record<string, unknown>; createdAt: string };
type Receipt = { id: string; grrNumber: string; supplierName: string; supplierGstin: string; supplierInvoiceNumber: string; supplierInvoiceDate: string; receivedDate: string; challanNumber: string; deliveryReference: string; shippingPaise: number; handlingPaise: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; createdAt: string };
type ReceiptLine = { id: string; inventoryItemId: string; packageUnit: string; stockUnit: string; unitsPerPackage: number; stockQuantity: number; quantity: number; retailQuantity:number; consumableQuantity:number; deliveredQuantity: number; orderedQuantity?: number; shortQuantity: number; excessQuantity: number; damagedQuantity: number; rejectedQuantity: number; quarantineStatus: string; varianceReason: string; grossUnitCostPaise: number; unitCostPaise: number; landedCostPaise: number; landedUnitCostPaise: number; stockUnitCostPaise: number; discountBps: number; discountPaise: number; gstPercent: number; totalPaise: number };
type PurchaseReturn = { id: string; purchaseReceiptId: string; supplierName: string; reason: string; returnDate: string; creditNoteNumber: string; creditNoteDate?: string; evidenceReference: string; totalPaise: number; createdAt: string };
type ReceivingQuarantine = { id:string; purchaseReceiptId:string; inventoryItemId:string; productName:string; supplierName:string; quantity:number; remainingQuantity:number; packageUnit:string; stockUnit:string; quantityBasis:'purchase_unit'|'base_unit'; status:string; reason:string; batchNumber:string; expiryDate?:string; unitCostPaise:number; dispositions:Array<{id:string;action:string;quantity:number;reason:string;evidenceReference:string;creditNoteNumber:string;actorUserId:string;createdAt:string}>; createdAt:string };
type InventoryAdjustment = { id:string; inventoryItemId:string; itemName:string; businessDate:string; source:string; status:'pending_approval'|'applied'|'rejected'; stockBeforeQuantity:number; requestedStockQuantity:number; quantityDelta:number; valuePaise:number; material:boolean; reason:string; evidenceReference:string; requestedByUserId:string; reviewedByUserId?:string; reviewNote:string; requestedAt:string };
type Payable = { purchaseReceiptId: string; supplierName: string; supplierInvoiceNumber: string; dueDate?: string; totalPaise: number; returnedPaise: number; paidPaise: number; balancePaise: number };
type Transfer = { id: string; transferNumber:string; sourceBranchId: string; destinationBranchId: string; mode:string; status: string; notes: string; createdAt:string; dispatchedAt?: string };
type TransferLine = { id:string; sourceInventoryItemId:string; destinationInventoryItemId:string; productName:string; sku:string; quantity:number; retailQuantity:number; consumableQuantity:number; reservedRetailQuantity:number; reservedConsumableQuantity:number; dispatchedRetailQuantity:number; dispatchedConsumableQuantity:number; receivedRetailQuantity:number; receivedConsumableQuantity:number; damagedQuantity:number; expiredQuantity:number; shortQuantity:number; unitCostPaise:number; transferUnitPricePaise:number; discountBps:number; gstPercent:number };
type TransferShipmentLine = { id:string; transferLineId:string; dispatchedRetailQuantity:number; dispatchedConsumableQuantity:number; receivedRetailQuantity:number; receivedConsumableQuantity:number; damagedQuantity:number; expiredQuantity:number; shortQuantity:number; varianceReason:string };
type TransferShipment = { id:string; shipmentNumber:string; status:string; shippingPaise:number; handlingPaise:number; otherChargesPaise:number; autoCheckoutApplied:boolean; dispatchedAt:string; lines:TransferShipmentLine[] };
type TransferDetails = Transfer & { lines:TransferLine[]; shipments:TransferShipment[]; events:Array<{ id:string; eventType:string; fromStatus:string; toStatus:string; actorUserId:string; note:string; createdAt:string }> };
type TransferMismatch = { transferId:string; transferNumber:string; shipmentId:string; shipmentNumber:string; sourceBranchId:string; destinationBranchId:string; productName:string; sku:string; dispatchedQuantity:number; receivedQuantity:number; damagedQuantity:number; expiredQuantity:number; shortQuantity:number; varianceReason:string; status:string };
type TransferSettings = { branchId:string; centerRole:'branch'|'warehouse'|'franchise'; defaultRetailWarehouseBranchId?:string; defaultConsumableWarehouseBranchId?:string; defaultReturnsWarehouseBranchId?:string; autoCheckoutTransfers:boolean; cannotRaiseTransfer:boolean };
type TransferDraftLine = { sourceInventoryItemId:string; retailQuantity:number|null; consumableQuantity:number|null; transferPriceRupees:number|null; discountPercent:number|null; gstPercent:number|null };
type TransferOptimization = {
  sourceBranchName: string; destinationBranchName: string; productName: string; suggestedQuantity: number;
  earliestBatchNumber?: string; earliestExpiryDate?: string; destinationCoverageDaysAfter?: number;
  sourceCoverageDaysAfter?: number; sourceSafe: boolean; distanceKm?: number; stockTransferCostPaise?: number;
  transportCostPaise?: number; handlingCostPaise?: number; delayCostPaise?: number; estimatedTransferCostPaise?: number;
  savingsPaise?: number; costDecision: string;
  ownerApprovalRequired: boolean; approvalReason: string;
};
type EntryLine = { inventoryItemId: string; quantity: number | null; retailQuantity?:number|null; consumableQuantity?:number|null; unitCostRupees: number | null; discountPercent?: number | null; gstPercent: number | null; packageUnit?: string; stockUnit?: string; unitsPerPackage?: number; damagedQuantity?: number | null; rejectedQuantity?: number | null; orderedRemaining?: number; varianceReason?: string; batchNumber?: string; batchBarcode?: string; expiryDate?: string; sourceLineId?: string; maxQuantity?: number; requestMasterPriceUpdate?:boolean };
type PriceUpdateRequest = { id:string; grrNumber:string; supplierName:string; productName:string; currentUnitCostPaise?:number; requestedUnitCostPaise:number; status:string; requestedAt:string };
type BarcodeLabel = { productName:string; sku:string; productUsage:string; barcode:string; batchNumber:string; expiryDate?:string; retailQuantity:number; consumableQuantity:number; freeQuantity:number };
type ScanResolution = { event: { inventoryItemId: string | null }; aliasType: string; targetId: string };
type Batch = { id: string; inventoryItemId: string; productName: string; batchNumber: string; barcode: string; expiryDate?: string; receivedDate: string; quantity: number; unitCostPaise: number };
type LedgerRow = { id: string; inventoryItemId: string; itemName: string; movementType: string; quantityDelta: number; unitCostPaise: number; valuePaise: number; stockBeforeQuantity: number; stockAfterQuantity: number; recordedStockAfterQuantity?: number; source: string; sourceType: string; sourceId: string; actorUserId?: string; clientId?: string; appointmentId?: string; serviceId?: string; staffId?: string; backbarContainerId?: string; batchAllocations: Array<{ batchId:string; batchNumber:string; expiryDate?:string; quantityDelta:number }>; provenanceComplete: boolean; snapshotStatus: 'verified'|'reconstructed'|'mismatch'; createdAt: string };
type ReorderRow = { id?: string; productId: string; productName: string; sku: string; currentStock: number; reorderLevel: number; alertLevel: number; desiredLevel: number; orderLevel: number; safetyStockLevel: number; pendingPoQuantity: number; pendingTransferQuantity: number; undeliveredQuantity: number; recommendedQuantity: number; suggestedQuantity: number; minimumOrderQuantity: number; packSize: number; effectiveTargetLevel: number; priority: string; reason: string; estimatedValuePaise: number; confidenceBps?: number; status?: string };
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
    imports: [CommonModule, FormsModule, DatePickerComponent, TranslatePipe, BranchNamePipe],
    templateUrl: './inventory-page.component.html',
    styleUrls: ['./inventory-page.component.css']
})
export class InventoryPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(ActionDialogService);
  readonly language = inject(LanguageService);
  get canApproveBackdatedGrn() { return this.auth.hasRole('owner', 'superadmin', 'super-admin'); }
  get canManageTransfers() { return this.auth.hasAccess(['owner','admin','manager','inventory_manager'], ['inventory.manage','inventory.write']); }
  get canApproveTransfers() { return this.auth.hasAccess(['owner','admin'], ['inventory.approve']); }
  get canApproveAdjustments() { return this.auth.hasAccess(['owner','admin'], ['inventory.approve']); }
  get canViewInventoryCost() { return !this.auth.hasFieldMask('inventory.cost'); }
  get canExportReports() { return this.auth.hasAccess(['owner', 'admin'], ['reports.export']); }
  readonly tabs: { id: Tab; labelKey: string }[] = [
    { id: 'products', labelKey: 'inventory.products' },
    { id: 'batches', labelKey: 'inventory.batchesExpiry' },
    { id: 'ledger', labelKey: 'inventory.stockLedger' }, { id: 'reorder', labelKey: 'inventory.reorder' },
    { id: 'valuation', labelKey: 'inventory.valuation' }, { id: 'reports', labelKey: 'inventory.reports' }, { id: 'transfers', labelKey: 'inventory.transfers' },
    { id: 'suppliers', labelKey: 'inventory.suppliers' }, { id: 'orders', labelKey: 'inventory.purchaseOrders' },
    { id: 'grn', labelKey: 'inventory.grn' }, { id: 'returns', labelKey: 'inventory.returns' }, { id: 'payables', labelKey: 'inventory.payables' },
  ];
  tab: Tab = 'products';
  standaloneOrders = false;
  standaloneGrn = false;
  pageTitle = '';
  drawer: Drawer = null;
  loading = true;
  saving = false;
  error = '';
  notice = '';
  suppliers: Supplier[] = [];
  inventoryPolicy: InventoryPolicy = { valuationMethod: 'weighted_average', negativeStockRule: 'block', purchaseOrderSettings:{ bulkRaiseEnabled:true }, labelSettings:{ priceCaption:'MRP', showName:true, showPrice:true, showSku:true, showBatch:true, showExpiry:true, widthMm:76, heightMm:32, columns:5 } };
  private reloadRequestId = 0;
  private readonly referenceCacheMs = 30_000;
  private readonly referenceCache = new Map<string, { data: unknown; loadedAt: number }>();
  private readonly referenceRequests = new Map<string, Promise<unknown>>();
  private tabLoading = new Set<Tab>(['products']);
  private reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly itemById = new Map<string, Item>();
  private readonly batchTrackedInventoryItemIds = new Set<string>();
  private readonly supplierScorecardById = new Map<string, SupplierGovernance['scorecards'][number]>();
  private readonly supplierTermsById = new Map<string, SupplierGovernance['terms']>();
  private readonly supplierPriceListsById = new Map<string, SupplierGovernance['priceLists']>();
  private readonly supplierQualityById = new Map<string, SupplierGovernance['qualityEvents'][number]>();
  private readonly supplierExpiryRiskById = new Map<string, SupplierGovernance['expiryRisk'][number]>();
  private readonly supplierReplacementsById = new Map<string, SupplierGovernance['replacementOptions']>();
  private readonly orderStatusCounts = new Map<string, number>();
  private productCategoriesCache: string[] = [];
  private filteredItemsCache: Item[] = [];
  private lowStockItemsCache: Item[] = [];
  private outOfStockItemsCache: Item[] = [];
  private forecastReorderRows: ReorderRow[] = [];
  private baselineReorderRows: ReorderRow[] = [];
  private inventoryValueCache = 0;
  private filteredReorderRowsCache: ReorderRow[] = [];
  private reorderValueCache = 0;
  private valuationValueCache = 0;
  private valuationUnitsCache = 0;
  private valuationLowStockValueCache = 0;
  private valuationExceptionsCache = 0;
  private ledgerStockInCache = 0;
  private ledgerStockOutCache = 0;
  private ledgerAdjustmentsCache = 0;
  private filteredReceiptsCache: Receipt[] = [];
  private receiptSuppliersCache: string[] = [];
  private receiptTaxableCache = 0;
  private receiptTotalCache = 0;
  private receiptGstCache = 0;
  private receiptPayableTotalCache = 0;
  private filteredOrdersCache: Order[] = [];
  private orderStatusesCache: string[] = [];
  private orderOpenValueCache = 0;
  supplierGovernance: SupplierGovernance = { priceLists: [], terms: [], scorecards: [], communications: [], qualityEvents: [], expiryRisk: [], replacementOptions: [] };
  supplierTermsDraft = { inventoryItemId: '', leadTimeDays: null as number | null, minimumOrderQuantity: null as number | null, packSize: null as number | null, safetyStockDays: 7, vendorPartNumber:'', purchaseUnit:'pack', conversionQuantity:null as number|null, centerAvailable:true };
  supplierPriceDraft = { inventoryItemId: '', unitCostRupees: null as number | null, discountPercent:null as number|null, gstPercent:null as number|null, effectiveFrom: new Date().toISOString().slice(0,10) };
  supplierCommunicationDraft = { channel: 'email', destination: '', subject: '', message: '' };
  items: Item[] = [];
  selectedProductIds = new Set<string>();
  masterData: InventoryMasterData = { values:[], units:[] };
  orders: Order[] = [];
  selectedOrderIds = new Set<string>();
  orderHistoryOrder: Order | null = null;
  orderEvents: OrderEvent[] = [];
  orderQuery = '';
  orderStatus = '';
  orderSupplier = '';
  orderStage: PurchaseOrderStage = 'draft';
  receipts: Receipt[] = [];
  priceUpdateRequests: PriceUpdateRequest[] = [];
  receiptFrom = '';
  receiptTo = '';
  receiptQuery = '';
  receiptSupplier = '';
  returns: PurchaseReturn[] = [];
  quarantines: ReceivingQuarantine[] = [];
  payables: Payable[] = [];
  transfers: Transfer[] = [];
  transferMismatches: TransferMismatch[] = [];
  transferSettings: TransferSettings = { branchId:'', centerRole:'branch', autoCheckoutTransfers:false, cannotRaiseTransfer:false };
  selectedTransfer: TransferDetails | null = null;
  transferWorkflow: 'create'|'dispatch'|'receive'|'return' = 'create';
  branches: AuthBranchAccess[] = [];
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
  reportView: ReportView = 'stock';
  reportAsOf = new Date().toISOString().slice(0, 10);
  reportExpiryDays = 30;
  reportAudit: AuditDetails | null = null;
  reportAgeing: ReturnType<typeof ageingRows> = [];
  reportNearExpiry: ReturnType<typeof nearExpiryRows> = [];
  reportTraceability: ReturnType<typeof traceabilityRows> = [];
  reportVariance: ReturnType<typeof varianceRows> = [];
  reportSupplierPerformance: ReturnType<typeof supplierPerformanceRows> = [];
  productDetail: Product360 | null = null;
  adjustments: InventoryAdjustment[] = [];
  productLoading = false;
  productEditing = false;
  productCreating = false;
  productDraft = this.emptyProduct();
  stocktakeDraft = { stockQuantity: null as number | null, reason: '', evidenceReference: '', businessDate: new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Kolkata' }) };
  kitDraft = { components: [] as Array<{ inventoryItemId: string; quantity: number | null }>, quantity: null as number | null, autoUnbundleOnReceive: false, comments: '', scanCode: '' };
  kitScanBusy = false;

  supplierId = '';
  supplierDraft = this.emptySupplier();
  orderDraft = { supplierId: '', expectedDate: '', notes: '', shippingRupees: null as number | null, handlingRupees: null as number | null, lines: [this.emptyLine()] as EntryLine[] };
  orderOptimizations: TransferOptimization[] = [];
  orderOptimizerSignature = '';
  orderOptimizerAcknowledged = '';
  grnDraft = { supplierId: '', purchaseOrderId: '', invoiceNumber: '', invoiceDate: '', receivedDate: '', dueDate: '', challanNumber: '', deliveryReference: '', shippingRupees: null as number | null, handlingRupees: null as number | null, backdatedOperationalApproval: false, acceptExcess:false, lines: [this.emptyLine()] as EntryLine[] };
  importingOrder = false;
  grnScanCode = '';
  grnScanBusy = false;
  private grnScanStarted = false;
  showGrnAssociationAction = false;
  returnDraft = { receiptId: '', returnDate: '', creditNoteNumber: '', creditNoteDate: '', evidenceReference: '', reason: '', lines: [] as EntryLine[] };
  selectedQuarantine: ReceivingQuarantine | null = null;
  quarantineDraft = { action: 'release' as 'release'|'return'|'discard', quantity: null as number|null, reason: '', evidenceReference: '', creditNoteNumber: '' };
  paymentDraft = { receiptId: '', amountRupees: null as number | null, method: 'bank', reference: '' };
  transferDraft = { mode:'push', sourceBranchId:'', destinationBranchId: '', notes: '', lines: [this.emptyTransferLine()] };
  transferShipmentDraft = { shippingRupees:null as number|null, handlingRupees:null as number|null, otherChargesRupees:null as number|null, lines:[] as Array<{ transferLineId:string; productName:string; retailQuantity:number|null; consumableQuantity:number|null; maxRetail:number; maxConsumable:number }> };
  transferReceiptDraft = { shipmentId:'', shipmentNumber:'', notes:'', lines:[] as Array<{ shipmentLineId:string; productName:string; receivedRetailQuantity:number|null; receivedConsumableQuantity:number|null; damagedQuantity:number|null; expiredQuantity:number|null; shortQuantity:number|null; varianceReason:string; maxRetail:number; maxConsumable:number }> };
  transferReturnDraft = { reason:'damaged', notes:'', lines:[] as Array<{ transferLineId:string; productName:string; retailQuantity:number|null; consumableQuantity:number|null; maxRetail:number; maxConsumable:number }> };

  async ngOnInit() {
    void firstValueFrom(this.auth.loadProfile()).then((profile) => { this.branches = profile.branches; }).catch(() => undefined);
    const data = this.route.snapshot.data;
    this.standaloneOrders = this.route.snapshot.routeConfig?.path === 'purchase-orders';
    this.standaloneGrn = this.route.snapshot.routeConfig?.path === 'purchase-bill-entry';
    this.tab = data['inventoryTab'] ?? this.tab; this.pageTitle = data['inventoryTitle'] ?? '';
    const requestedTab = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    if (!this.standaloneOrders && !this.standaloneGrn && requestedTab && this.tabs.some((item) => item.id === requestedTab)) this.tab = requestedTab;
    const requestedReport = this.route.snapshot.queryParamMap.get('report') as ReportView | null;
    const requestedSupplierId = this.route.snapshot.queryParamMap.get('supplierId')?.trim() ?? '';
    if (requestedReport && ['ageing', 'expiry', 'traceability', 'variance', 'suppliers'].includes(requestedReport)) this.reportView = requestedReport;
    await this.reload();
    if (this.tab === 'suppliers' && requestedSupplierId) {
      await this.loadOperationalTab('suppliers', this.reloadRequestId);
      const supplier = this.suppliers.find((row) => row.id === requestedSupplierId);
      if (supplier) this.openSupplier(supplier);
    }
    if (data['inventoryDrawer'] === 'grn') await this.openGrn();
  }

  async reload() {
    const requestId = ++this.reloadRequestId;
    const tab = this.tab;
    this.setTabLoading(tab, true);
    this.error = '';
    try {
      const needsTabReferences = ['products','ledger','reorder','valuation','suppliers','orders','grn','transfers'].includes(tab);
      const references = needsTabReferences ? this.loadReferences(tab, requestId) : Promise.resolve();
      if (['products','suppliers','orders','grn','transfers'].includes(tab)) await references;
      else await this.loadOperationalTab(tab, requestId);
      this.defer(['products','suppliers','orders','grn','transfers'].includes(tab)
        ? this.loadOperationalTab(tab, requestId)
        : references);
    } catch (error) {
      this.error = this.message(error, this.language.text('inventory.errors.procurementLoad'));
    } finally {
      if (requestId === this.reloadRequestId) {
        this.setTabLoading(tab, false);
      }
    }
  }

  private defer<T>(request: Promise<T>) {
    void request.catch((error) => {
      this.error ||= this.message(error, this.language.text('inventory.errors.procurementLoad'));
    });
  }

  private async loadReferences(tab: Tab, requestId: number) {
    const requests = [] as Promise<unknown>[];
    if (['products','reorder','valuation','reports','suppliers','orders','grn','transfers'].includes(tab)) {
      requests.push(this.loadInventoryRows(tab, requestId));
    }
    if (['products','reorder','valuation','reports','grn','orders'].includes(tab)) {
      requests.push(this.getCached<InventoryPolicy>('inventory:policy', () => this.get<InventoryPolicy>('/inventory/policy')).then((policy) => {
        if (this.isCurrentLoad(requestId)) {
          this.inventoryPolicy = policy;
        }
      }));
    }
    if (['products','ledger','reorder','valuation','suppliers','orders','grn','transfers'].includes(tab)) {
      requests.push(this.getCached<InventoryMasterData>('inventory:masterData', () => this.get<InventoryMasterData>('/inventory/master-data')).then((data) => {
        if (this.isCurrentLoad(requestId)) this.masterData = data;
      }));
    }
    if (requests.length) {
      await Promise.all(requests);
    }
  }
  private async loadInventoryRows(tab: Tab, requestId: number) {
    const requestIdSnapshot = requestId;
    const params = new URLSearchParams();
    const query = tab === 'products' ? this.productQuery.trim() : '';
    if (query) params.set('q', query);
    const rows = await this.getAllPages<Item>(`/inventory?${params}`);
    if (this.isCurrentLoad(requestIdSnapshot)) {
      this.items = rows;
      this.rebuildItemLookup();
      this.recomputeProductViews();
      if (tab === 'reorder') this.rebuildReorderRows();
    }
  }
  onProductSearchChange(query: string) {
    this.productQuery = query;
    this.recomputeProductViews();
    if (this.tab === 'products') {
      this.scheduleReload();
    }
  }
  onProductCategoryChange(category: string) {
    this.productCategory = category;
    this.recomputeProductViews();
    if (this.tab === 'products') {
      this.scheduleReload();
    }
  }
  clearProductFilters() {
    this.productQuery = '';
    this.productCategory = '';
    this.recomputeProductViews();
    if (this.tab === 'products') {
      this.scheduleReload();
    }
  }

  onOrderQueryChange(orderQuery: string) {
    this.orderQuery = orderQuery;
    this.recomputeOrderViews();
  }

  onOrderSupplierChange(orderSupplier: string) {
    this.orderSupplier = orderSupplier;
    this.recomputeOrderViews();
  }

  onReceiptQueryChange(receiptQuery: string) {
    this.receiptQuery = receiptQuery;
    this.recomputeReceiptViews();
  }

  onReceiptSupplierChange(receiptSupplier: string) {
    this.receiptSupplier = receiptSupplier;
    this.recomputeReceiptViews();
  }

  onReceiptFromChange(receiptFrom: string) {
    this.receiptFrom = receiptFrom;
    this.recomputeReceiptViews();
  }

  onReceiptToChange(receiptTo: string) {
    this.receiptTo = receiptTo;
    this.recomputeReceiptViews();
  }
  selectTab(tab: Tab) { if (this.tab === tab) return; this.tab = tab; this.pageTitle = ''; this.closeDrawer(); void this.reload(); }
  closeDrawer() { if (!this.saving) { this.drawer = null; this.productEditing = false; this.productCreating = false; } }
  money(paise: number | null | undefined) { return this.canViewInventoryCost ? this.language.formatCurrency((paise || 0) / 100) : 'Restricted'; }
  date(value?: string) { return value ? this.language.formatDate(new Date(value.slice(0, 10) + 'T00:00:00')) : '-'; }
  dateTime(value?: string) { return value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '-'; }
  code(value?: string) { const text = (value || '').trim(); return text && text !== '\u00e2\u20ac\u201d' && text !== '\u2014' ? text : '-'; }
  itemName(id: string) { return this.itemById.get(id)?.name ?? id; }
  remaining(line: OrderLine) { return Math.max(line.quantity - line.receivedQuantity, 0); }
  accepted(line: EntryLine) { return Math.max(Number(line.quantity || 0) - Number(line.damagedQuantity || 0) - Number(line.rejectedQuantity || 0), 0); }
  packageSummary(item: Pick<Item, 'packageUnit' | 'unit' | 'unitsPerPackage'>) { return `1 ${item.packageUnit} = ${item.unitsPerPackage} ${item.unit}`; }
  packageCostPaise(item: Pick<Item, 'unitCostPaise' | 'unitsPerPackage'>) { return item.unitCostPaise * item.unitsPerPackage; }
  linePackageSummary(line: EntryLine) {
    const item = this.items.find((row) => row.id === line.inventoryItemId);
    const packageUnit = line.packageUnit || item?.packageUnit;
    const stockUnit = line.stockUnit || item?.unit;
    const units = line.unitsPerPackage || item?.unitsPerPackage;
    return packageUnit && stockUnit && units ? `1 ${packageUnit} = ${units} ${stockUnit}` : '';
  }
  draftBaseCostPaise() { return Math.round(Number(this.productDraft.packageCostRupees || 0) * 100 / Math.max(Number(this.productDraft.unitsPerPackage || 1), 1)); }
  short(line: EntryLine) { return Math.max(Number(line.orderedRemaining || 0) - this.accepted(line), 0); }
  excess(line: EntryLine) { return Math.max(this.accepted(line) - Number(line.orderedRemaining || 0), 0); }
  receiptGst(row: Receipt) { return row.cgstPaise + row.sgstPaise + row.igstPaise; }
  receiptSum(field: 'taxablePaise' | 'totalPaise') { return field === 'taxablePaise' ? this.receiptTaxableCache : this.receiptTotalCache; }
  get receiptGstTotal() { return this.receiptGstCache; }
  get receiptPayableTotal() { return this.receiptPayableTotalCache; }
  supplierScorecard(id: string) { return this.supplierScorecardById.get(id); }
  supplierTerms(id: string) { return this.supplierTermsById.get(id) ?? []; }
  supplierPrices(id: string) { return this.supplierPriceListsById.get(id) ?? []; }
  supplierQuality(id: string) { return this.supplierQualityById.get(id); }
  supplierExpiryRisk(id: string) { return this.supplierExpiryRiskById.get(id); }
  supplierReplacements(id: string) { return this.supplierReplacementsById.get(id) ?? []; }

  get receiptSuppliers() { return this.receiptSuppliersCache; }
  get heading() {
    if (this.pageTitle) return this.pageTitle;
    const key = ({ products: 'inventory.title', batches: 'inventory.batchesExpiry', ledger: 'inventory.stockLedger', reorder: 'inventory.reorderSuggestions', valuation: 'inventory.inventoryValuation', reports: 'inventory.reports', orders: 'inventory.purchaseOrders' } as Partial<Record<Tab, string>>)[this.tab] ?? 'inventory.procurement';
    return this.language.text(key);
  }
  get productCategories() { return this.productCategoriesCache; }
  get filteredItems() { return this.filteredItemsCache; }
  get lowStockItems() { return this.lowStockItemsCache; }
  get outOfStockItems() { return this.outOfStockItemsCache; }
  get inventoryValue() { return this.inventoryValueCache; }
  get filteredReorderRows() { return this.filteredReorderRowsCache; }
  get reorderValue() { return this.reorderValueCache; }
  onReorderPriorityChange(priority: string) { this.reorderPriority = priority; this.recomputeReorderViews(); }
  get valuationValue() { return this.valuationValueCache; }
  get valuationUnits() { return this.valuationUnitsCache; }
  get valuationLowStockValue() { return this.valuationLowStockValueCache; }
  get valuationExceptions() { return this.valuationExceptionsCache; }
  get ledgerStockIn() { return this.ledgerStockInCache; }
  get ledgerStockOut() { return this.ledgerStockOutCache; }
  get ledgerAdjustments() { return this.ledgerAdjustmentsCache; }
  get filteredReceipts() { return this.filteredReceiptsCache; }

  get filteredOrders() { return this.filteredOrdersCache; }
  get orderStatuses() { return this.orderStatusesCache; }
  get orderOpenValue() { return this.orderOpenValueCache; }
  get hasCurrentReportRows() {
    return ({ stock:this.items, ageing: this.reportAgeing, cogs:this.cogsRows, expiry: this.reportNearExpiry, traceability: this.reportTraceability, variance: this.reportVariance, suppliers: this.reportSupplierPerformance, catalog:this.items })[this.reportView].length > 0;
  }
  get cogsRows() { return this.ledgerRows.filter(row => ['sale','consumption','backbar_consumption','kit_component_out'].includes(row.movementType) && row.quantityDelta < 0); }
  orderCount(status: string) { return this.orderStatusCounts.get(status) ?? 0; }
  orderStatusLabel(status:string) { return ({ approved:'Raised', partially_received:'Partial delivery', received:'Fully delivered', pending_approval:'Pending approval' } as Record<string,string>)[status] ?? status.replaceAll('_',' '); }
  selectOrderStage(stage: Exclude<PurchaseOrderStage, ''>) { this.orderStage = stage; this.orderStatus = ''; this.recomputeOrderViews(); }
  selectOrderStatus(status: string) { this.orderStatus = status; if (status) this.orderStage = ''; this.recomputeOrderViews(); }

  async loadOperationalTab(tab: Tab = this.tab, requestId: number = this.reloadRequestId) {
    if (!this.isCurrentLoad(requestId)) {
      return;
    }
    try {
      if (tab === 'batches') {
        const rows = await this.get<Batch[]>('/inventory/batches');
        if (this.isCurrentLoad(requestId)) this.batches = rows;
      }
      if (tab === 'ledger') {
        await this.loadLedger(requestId);
      }
      if (tab === 'reorder') {
        await this.loadReorder(requestId);
      }
      if (tab === 'valuation') {
        await this.loadValuation(requestId);
      }
      if (tab === 'reports') {
        await this.loadInventoryReports(requestId);
      }
      if (tab === 'transfers') {
        const [rows, mismatches, settings] = await Promise.all([
          this.get<Transfer[]>('/inventory/transfers'),
          this.get<TransferMismatch[]>('/inventory/transfers/mismatches'),
          this.get<TransferSettings>('/inventory/transfer-settings'),
        ]);
        if (this.isCurrentLoad(requestId)) { this.transfers = rows; this.transferMismatches = mismatches; this.transferSettings = settings; }
      }
      if (tab === 'suppliers') {
        const [suppliers, supplierGovernance] = await Promise.all([
          this.getCached<Supplier[]>('inventory.suppliers', () => this.get<Supplier[]>('/purchases/suppliers')),
          this.getCached<SupplierGovernance>('inventory.supplierGovernance', () => this.get<SupplierGovernance>('/inventory/supplier-governance')),
        ]);
        if (this.isCurrentLoad(requestId)) {
          this.suppliers = suppliers;
          this.supplierGovernance = supplierGovernance;
          this.rebuildSupplierGovernanceLookups();
        }
      }
      if (tab === 'orders') {
        const [orders, suppliers] = await Promise.all([
          this.getCached<Order[]>('inventory.orders', () => this.getAllPages<Order>('/purchases/orders')),
          this.getCached<Supplier[]>('inventory.suppliers', () => this.get<Supplier[]>('/purchases/suppliers')),
        ]);
        if (this.isCurrentLoad(requestId)) {
          this.orders = orders;
          this.suppliers = suppliers;
          this.recomputeOrderViews();
        }
      }
      if (tab === 'grn') {
        const [receipts, suppliers, orders, priceUpdates, quarantines] = await Promise.all([
          this.getCached<Receipt[]>('inventory.receipts', () => this.getAllPages<Receipt>('/purchases/grn')),
          this.getCached<Supplier[]>('inventory.suppliers', () => this.get<Supplier[]>('/purchases/suppliers')),
          this.getCached<Order[]>('inventory.orders', () => this.getAllPages<Order>('/purchases/orders')),
          this.get<PriceUpdateRequest[]>('/purchases/price-update-requests?status=pending'),
          this.get<ReceivingQuarantine[]>('/purchases/quarantine'),
        ]);
        if (this.isCurrentLoad(requestId)) {
          this.receipts = receipts;
          this.suppliers = suppliers;
          this.orders = orders;
          this.priceUpdateRequests = priceUpdates;
          this.quarantines = quarantines;
          this.recomputeReceiptViews();
          this.recomputeOrderViews();
        }
      }
      if (tab === 'returns') {
        const [rows, receipts, quarantines] = await Promise.all([
          this.getCached<PurchaseReturn[]>('inventory.returns', () => this.getAllPages<PurchaseReturn>('/purchases/returns')),
          this.getCached<Receipt[]>('inventory.receipts', () => this.getAllPages<Receipt>('/purchases/grn')),
          this.get<ReceivingQuarantine[]>('/purchases/quarantine'),
        ]);
        if (this.isCurrentLoad(requestId)) {
          this.returns = rows;
          this.quarantines = quarantines;
          this.receipts = receipts;
          this.recomputeReceiptViews();
        }
      }
      if (tab === 'payables') {
        const [rows, receipts] = await Promise.all([
          this.getCached<Payable[]>('inventory.payables', () => this.getAllPages<Payable>('/purchases/payables')),
          this.getCached<Receipt[]>('inventory.receipts', () => this.getAllPages<Receipt>('/purchases/grn')),
        ]);
        if (this.isCurrentLoad(requestId)) {
          this.payables = rows;
          this.receipts = receipts;
          this.recomputeReceiptViews();
        }
      }
    } catch (error) {
      if (this.isCurrentLoad(requestId)) {
        this.error = this.message(error, this.language.text('inventory.message.c9afc27eb9'));
      }
    }
  }

  async loadLedger(requestId: number = this.reloadRequestId) {
    const query = new URLSearchParams();
    if (this.ledgerFrom) query.set('from', this.ledgerFrom);
    if (this.ledgerTo) query.set('to', this.ledgerTo);
    if (this.ledgerMovement) query.set('movement', this.ledgerMovement);
    if (this.ledgerQuery.trim()) query.set('q', this.ledgerQuery.trim());
    const rows = await this.getAllLedger(query);
    if (this.isCurrentLoad(requestId)) {
      this.ledgerRows = rows;
      this.recomputeLedgerViews();
    }
  }

  private async loadInventoryReports(requestId: number) {
    const [batches, ledger, governance, suppliers, audits] = await Promise.all([
      this.get<Batch[]>('/inventory/batches'),
      this.getAllLedger(),
      this.getCached<SupplierGovernance>('inventory.supplierGovernance', () => this.get<SupplierGovernance>('/inventory/supplier-governance')),
      this.getCached<Supplier[]>('inventory.suppliers', () => this.get<Supplier[]>('/purchases/suppliers')),
      this.get<Array<AuditDetails['session']>>('/inventory/stock-audits'),
    ]);
    const reportAudit = audits[0] ? await this.get<AuditDetails>(`/inventory/stock-audits/${audits[0].id}`) : null;
    if (!this.isCurrentLoad(requestId)) return;
    this.batches = batches;
    this.ledgerRows = ledger;
    this.supplierGovernance = governance;
    this.suppliers = suppliers;
    this.reportAudit = reportAudit;
    this.reportAsOf = new Date().toISOString().slice(0, 10);
    this.recomputeInventoryReports();
  }

  selectReportView(view: ReportView) { this.reportView = view; }
  refreshReportFilters() {
    this.reportExpiryDays = Math.min(Math.max(Number(this.reportExpiryDays) || 30, 1), 3650);
    this.recomputeInventoryReports();
  }
  private recomputeInventoryReports() {
    this.reportAgeing = ageingRows(this.batches, this.reportAsOf);
    this.reportNearExpiry = nearExpiryRows(this.batches, this.reportAsOf, this.reportExpiryDays);
    this.reportTraceability = traceabilityRows(this.ledgerRows);
    this.reportVariance = varianceRows(this.reportAudit);
    this.reportSupplierPerformance = supplierPerformanceRows(this.suppliers, this.supplierGovernance);
  }

  async loadReorder(requestId: number = this.reloadRequestId) {
    const [forecast, baseline] = await Promise.all([
      this.get<ReorderForecast | null>('/inventory/reorder-forecasts'),
      this.get<ReorderRow[]>('/inventory/reorder-suggestions'),
    ]);
    if (!this.isCurrentLoad(requestId)) return;
    this.reorderRun = forecast?.run ?? null;
    this.baselineReorderRows = baseline.map((row) => ({ ...row, minimumOrderQuantity:row.orderLevel, packSize:1, effectiveTargetLevel:row.desiredLevel }));
    this.forecastReorderRows = forecast?.recommendations.map((row) => ({
      id: row.id,
      productId: row.inventoryItemId,
      productName: row.productName,
      sku: row.sku,
      currentStock: row.currentStock,
      reorderLevel: row.reorderLevel,
      alertLevel: Number(row.explanation['alertLevel'] || 0),
      desiredLevel: Number(row.explanation['desiredLevel'] || row.reorderLevel),
      orderLevel: Number(row.explanation['orderLevel'] || 0),
      safetyStockLevel: Number(row.explanation['safetyStockLevel'] || 0),
      pendingPoQuantity: Number(row.explanation['pendingPoQuantity'] || 0),
      pendingTransferQuantity: Number(row.explanation['pendingTransferQuantity'] || 0),
      undeliveredQuantity: Number(row.explanation['undeliveredQuantity'] || 0),
      recommendedQuantity: Number(row.explanation['recommendedQuantity'] || 0),
      suggestedQuantity: row.suggestedQuantity,
      minimumOrderQuantity: Number(row.explanation['minimumOrderQuantity'] || 1),
      packSize: Number(row.explanation['packSize'] || 1),
      effectiveTargetLevel: Number(row.explanation['effectiveTargetLevel'] || row.explanation['desiredLevel'] || row.reorderLevel),
      priority: row.currentStock <= 0 ? 'critical' : row.confidenceBps >= 7500 ? 'high' : 'medium',
      reason: `${row.explanation['forecastBasis'] === 'desired_level' ? 'Desired-level baseline' : 'Seasonal service forecast'} · ${Math.round(row.confidenceBps / 100)}% confidence`,
      estimatedValuePaise: row.suggestedQuantity * row.unitCostPaise,
      confidenceBps: row.confidenceBps,
      status: row.status
    })) ?? [];
    this.rebuildReorderRows();
  }

  async generateReorder() {
    this.saving = true; this.clearFeedback();
    try {
      await firstValueFrom(this.api.post('/inventory/reorder-forecasts', {}));
      await this.reload();
      this.notice = this.language.text('inventory.message.398da20892');
    } catch (error) {
      this.error = this.message(error, this.language.text('inventory.message.8283ad1a35'));
    } finally {
      this.saving = false;
    }
  }

  async approveReorder(row: ReorderRow) {
    if (!row.id) { await this.createOrderFromSuggestion(row); return; }
    this.saving = true; this.clearFeedback();
    try {
      await firstValueFrom(this.api.post(`/inventory/reorder-recommendations/${row.id}/approve`, {}));
      await this.reload();
      this.notice = this.language.text('inventory.message.69bcbb3f55');
    } catch (error) {
      this.error = this.message(error, this.language.text('inventory.message.012f9fd0ea'));
    } finally {
      this.saving = false;
    }
  }

  async loadValuation(requestId: number = this.reloadRequestId) {
    const rows = await this.get<ValuationRow[]>(`/inventory/valuation?asOf=${this.valuationAsOf}`);
    if (this.isCurrentLoad(requestId)) {
      this.valuationRows = rows;
      this.recomputeValuationViews();
    }
  }

  private isCurrentLoad(requestId: number) {
    return requestId === this.reloadRequestId;
  }

  private scheduleReload(delayMs = 280) {
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
    }
    this.reloadDebounceTimer = setTimeout(() => {
      this.reloadDebounceTimer = null;
      void this.reload();
    }, delayMs);
  }

  private setTabLoading(tab: Tab, isLoading: boolean) {
    if (isLoading) {
      this.tabLoading.add(tab);
    } else {
      this.tabLoading.delete(tab);
    }
    this.loading = this.tabLoading.has(this.tab);
  }

  private async getCached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.referenceCache.get(key);
    const now = Date.now();
    if (cached && now - cached.loadedAt < this.referenceCacheMs) {
      return cached.data as T;
    }
    const inFlight = this.referenceRequests.get(key);
    if (inFlight) {
      return inFlight as Promise<T>;
    }
    const request = loader()
      .then((data: T) => {
        this.referenceCache.set(key, { data, loadedAt: Date.now() });
        this.referenceRequests.delete(key);
        return data;
      })
      .catch((error: unknown) => {
        this.referenceRequests.delete(key);
        throw error;
      });
    this.referenceRequests.set(key, request);
    return request as Promise<T>;
  }

  private clearReferenceCache(keys?: string | string[]) {
    if (!keys) {
      this.referenceCache.clear();
      this.referenceRequests.clear();
      return;
    }
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      this.referenceCache.delete(key);
      this.referenceRequests.delete(key);
    }
  }
  exportLedger() {
    const rows = this.ledgerRows.map((row) => [this.date(row.createdAt), row.itemName, row.movementType, row.quantityDelta, row.valuePaise / 100, row.source]);
    this.downloadCsv(`stock-ledger-${new Date().toISOString().slice(0, 10)}.csv`, ['Date', 'Product', 'Movement', 'Quantity', 'Value', 'Source'].map((value) => this.language.textValue(value)), rows);
  }

  exportValuation() {
    const rows = this.valuationRows.map((row) => [row.productName, row.category, row.stockQuantity, row.unitCostPaise / 100, row.stockValuePaise / 100, row.reorderPoint]);
    this.downloadCsv(`inventory-valuation-${this.valuationAsOf}.csv`, ['Product', 'Category', 'Stock', 'Unit cost', 'Stock value', 'Reorder level'].map((value) => this.language.textValue(value)), rows);
  }

  exportInventoryReport() {
    if (this.reportView === 'cogs' && !this.canViewInventoryCost) { this.error='Product cost visibility permission is required'; return; }
    const exports: Record<ReportView, { headers: string[]; rows: (string | number)[][] }> = {
      stock: this.canViewInventoryCost ? { headers:['Product','SKU','Category','Stock','Unit cost','Stock value','Reorder level'], rows:this.items.map(row => [row.name,row.sku,row.category,row.stockQuantity,row.unitCostPaise/100,row.stockQuantity*row.unitCostPaise/100,row.reorderPoint]) } : { headers:['Product','SKU','Category','Stock','Reorder level'], rows:this.items.map(row => [row.name,row.sku,row.category,row.stockQuantity,row.reorderPoint]) },
      ageing: { headers: ['Product', 'Batch', 'Received', 'Quantity', 'Age days', 'Age bucket', 'Stock value'], rows: this.reportAgeing.map((row) => [row.productName, row.batchNumber, this.date(row.receivedDate), row.quantity, row.ageDays, row.ageBucket, row.stockValuePaise / 100]) },
      cogs: { headers:['Date','Product','Movement','Quantity','Unit cost','COGS','Source'], rows:this.cogsRows.map(row => [this.date(row.createdAt),row.itemName,row.movementType,Math.abs(row.quantityDelta),row.unitCostPaise/100,Math.abs(row.valuePaise)/100,row.source]) },
      expiry: { headers: ['Product', 'Batch', 'Expiry', 'Days remaining', 'Quantity', 'Risk value'], rows: this.reportNearExpiry.map((row) => [row.productName, row.batchNumber, this.date(row.expiryDate), row.daysRemaining, row.quantity, row.riskValuePaise / 100]) },
      traceability: { headers: ['Date', 'Product', 'Batch', 'Movement', 'Quantity', 'Source type', 'Source ID', 'Expiry'], rows: this.reportTraceability.map((row) => [this.date(row.createdAt), row.productName, row.batchNumber, row.movementType, row.quantityDelta, row.sourceType, row.sourceId, this.date(row.expiryDate)]) },
      variance: { headers: ['Product', 'SKU', 'Expected', 'Counted', 'Variance', 'Reason', 'Posted'], rows: this.reportVariance.map((row) => [row.itemName, row.sku, row.expectedQuantity ?? '', row.approvedQuantity ?? '', row.varianceQuantity ?? '', row.varianceReason, this.date(row.postedAt)]) },
      suppliers: { headers: ['Supplier', 'Purchase orders', 'Received orders', 'On-time %', 'Fill %', 'Returns', 'Returned quantity', 'Returned value', 'Expiry risk value'], rows: this.reportSupplierPerformance.map((row) => [row.supplierName, row.purchaseOrders, row.receivedOrders, row.onTimeRateBps == null ? '' : row.onTimeRateBps / 100, row.fillRateBps == null ? '' : row.fillRateBps / 100, row.returnCount, row.returnedQuantity, row.returnedValuePaise / 100, row.expiryRiskValuePaise / 100]) },
      catalog: { headers:['Product','SKU','Category','Subcategory','Brand','Usage','Unit','Package unit','Units/package','Barcode','HSN/SAC','GST %','Retail price','Active'], rows:this.items.map(row => [row.name,row.sku,row.category,row.subcategory,row.brand,row.productUsage,row.unit,row.packageUnit,row.unitsPerPackage,row.barcode,row.hsnCode,row.gstPercent,row.retailPricePaise/100,row.active ? 'Yes':'No']) },
    };
    const report = exports[this.reportView];
    this.downloadCsv(`inventory-${this.reportView}-${this.reportAsOf}.csv`, report.headers, report.rows);
  }

  printInventoryReport() {
    if (this.canExportReports && this.hasCurrentReportRows) window.print();
  }

  async createOrderFromSuggestion(row: ReorderRow) {
    this.tab = 'orders'; this.pageTitle = ''; this.openOrder();
    const item = this.items.find((entry) => entry.id === row.productId);
    this.orderDraft.lines = [{ inventoryItemId: row.productId, quantity: Math.ceil(row.suggestedQuantity / Math.max(item?.unitsPerPackage ?? 1, 1)), unitCostRupees: item ? this.packageCostPaise(item) / 100 : 0, gstPercent: item?.gstPercent ?? 0, packageUnit: item?.packageUnit, stockUnit: item?.unit, unitsPerPackage: item?.unitsPerPackage }];
    await this.loadOperationalTab('orders');
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
    if (!this.canExportReports) { this.error = 'Report export permission is required'; return; }
    const csv = csvContent(headers, rows);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
  }

  async openProduct(row: Item) { await this.openProductById(row.id); }
  async openProductById(id: string) {
    this.drawer = 'product'; this.productEditing = false; this.productCreating = false; this.clearFeedback();
    this.stocktakeDraft = { stockQuantity: null, reason: '', evidenceReference: '', businessDate: new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Kolkata' }) };
    await this.loadProduct(id);
  }

  openNewProduct() {
    this.productDetail = null; this.productDraft = this.emptyProduct();
    this.productCreating = true; this.productEditing = true; this.drawer = 'product'; this.clearFeedback();
  }

  startProductEdit() {
    const product = this.productDetail?.product;
    if (!product) return;
    this.productDraft = {
      sku: product.sku, name: product.name, category: product.category, subcategory:product.subcategory, brand: product.brand, productUsage:product.productUsage, unit: product.unit,
      packageUnit: product.packageUnit, unitsPerPackage: product.unitsPerPackage,
      reorderPoint: product.reorderPoint, alertLevel:product.alertLevel, desiredLevel:product.desiredLevel, orderLevel:product.orderLevel, safetyStockLevel:product.safetyStockLevel, packageCostRupees: this.canViewInventoryCost ? this.packageCostPaise(product) / 100 : null, retailPriceRupees: product.retailPricePaise / 100,
      hsnCode: product.hsnCode, gstPercent: product.gstPercent, barcodesText:(product.barcodes?.length ? product.barcodes : [product.barcode]).filter(Boolean).join(', '),
      batchTracked: product.batchTracked, centerAvailable:product.centerAvailable, onlineSaleEnabled:product.onlineSaleEnabled, active: product.active,
    };
    this.productEditing = true; this.clearFeedback();
  }

  async saveProduct() {
    const product = this.productDetail?.product;
    if ((!product && !this.productCreating) || !this.productDraft.name.trim() || !this.productDraft.unit || !this.productDraft.packageUnit || !Number.isInteger(Number(this.productDraft.unitsPerPackage)) || Number(this.productDraft.unitsPerPackage) <= 0 || Number(this.productDraft.reorderPoint) < 0 || Number(this.productDraft.retailPriceRupees) < 0 || (this.canViewInventoryCost && Number(this.productDraft.packageCostRupees) < 0) || Number(this.productDraft.gstPercent) < 0 || Number(this.productDraft.gstPercent) > 100) {
      this.error = this.language.text('inventory.message.1436482d07'); return;
    }
    this.saving = true; this.clearFeedback();
    try {
      const payload = {
        sku: this.productDraft.sku.trim(),
        name: this.titleCase(this.productDraft.name), category: this.titleCase(this.productDraft.category), subcategory:this.titleCase(this.productDraft.subcategory), brand: this.titleCase(this.productDraft.brand), productUsage:this.productDraft.productUsage,
        unit: this.productDraft.unit, packageUnit: this.productDraft.packageUnit,
        unitsPerPackage: Number(this.productDraft.unitsPerPackage), reorderPoint: Number(this.productDraft.reorderPoint), alertLevel:Number(this.productDraft.alertLevel), desiredLevel:Number(this.productDraft.desiredLevel), orderLevel:Number(this.productDraft.orderLevel), safetyStockLevel:Number(this.productDraft.safetyStockLevel),
        ...(this.canViewInventoryCost ? { unitCostPaise: this.draftBaseCostPaise() } : {}),
        retailPricePaise: this.toPaise(this.productDraft.retailPriceRupees),
        hsnCode: this.productDraft.hsnCode.trim(), gstPercent: Number(this.productDraft.gstPercent),
        barcodes: this.productDraft.barcodesText.split(',').map(value => value.trim().toUpperCase()).filter(Boolean), batchTracked: this.productDraft.batchTracked,
        dualUseStock: this.productDraft.productUsage === 'dual_use', centerAvailable:this.productDraft.centerAvailable, onlineSaleEnabled:this.productDraft.productUsage === 'consumable' ? false : this.productDraft.onlineSaleEnabled, active: this.productDraft.active,
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

  toggleProductSelection(id:string, selected:boolean) { selected ? this.selectedProductIds.add(id) : this.selectedProductIds.delete(id); }
  toggleOrderSelection(id:string, selected:boolean) { selected ? this.selectedOrderIds.add(id) : this.selectedOrderIds.delete(id); }

  async bulkUpdateProducts(centerAvailable:boolean) {
    const ids = [...this.selectedProductIds];
    if (!ids.length || !await this.dialogs.confirm(`${centerAvailable ? 'Enable' : 'Disable'} ${ids.length} selected products at this center?`)) return;
    await this.mutate(this.api.patch('/inventory/bulk', { ids, centerAvailable }), 'Products updated', false);
    this.selectedProductIds.clear();
  }

  async cloneProduct() {
    const product = this.productDetail?.product; if (!product) return;
    const sku = await this.dialogs.prompt('New product SKU', { title:'Clone product', defaultValue:`${product.sku}-COPY`, required:true }); if (!sku) return;
    const name = await this.dialogs.prompt('New product name', { title:'Clone product', defaultValue:`${product.name} Copy`, required:true }); if (!name) return;
    this.saving = true; this.clearFeedback();
    try { const response = await firstValueFrom(this.api.post<ApiEnvelope<Item>>(`/inventory/${product.id}/clone`, { sku, name })); await this.reload(); if (response.data) await this.loadProduct(response.data.id); this.notice='Product cloned'; }
    catch (error) { this.error=this.message(error,'Product could not be cloned'); } finally { this.saving=false; }
  }

  async changeProductLifecycle(action:'discontinue'|'reactivate') {
    const product=this.productDetail?.product; if (!product) return;
    const reason=await this.dialogs.prompt(`${action === 'discontinue' ? 'Discontinuation' : 'Reactivation'} reason`, { required:true, multiline:true }); if (!reason) return;
    let replacementInventoryItemId:string|null=null;
    if (action === 'discontinue') { replacementInventoryItemId=await this.dialogs.prompt('Replacement product ID (optional)') || null; }
    await this.mutate(this.api.post(`/inventory/${product.id}/${action}`, { reason, replacementInventoryItemId }), `Product ${action === 'discontinue' ? 'discontinued' : 'reactivated'}`, false);
    await this.loadProduct(product.id);
  }

  async bulkRaiseOrders() {
    const ids=[...this.selectedOrderIds];
    if (!ids.length || !await this.dialogs.confirm(`Raise ${ids.length} selected draft purchase orders?`)) return;
    await this.mutate(this.api.post('/purchases/orders/bulk-raise', { ids, note:'' }), 'Purchase orders raised', false);
    this.selectedOrderIds.clear();
  }

  async openKit(row: Item) {
    this.clearFeedback();
    if (row.productUsage === 'dual_use' || row.batchTracked) { this.error = 'A kit must be a non-batch retail or consumable product'; return; }
    await this.loadProduct(row.id);
    if (!this.productDetail) return;
    this.kitDraft = {
      components: this.productDetail.kitComponents.length
        ? this.productDetail.kitComponents.map((component) => ({ inventoryItemId: component.componentInventoryItemId, quantity: component.quantity }))
        : [{ inventoryItemId: '', quantity: null }],
      quantity: null,
      autoUnbundleOnReceive: this.productDetail.kitAutoUnbundleOnReceive,
      comments: '',
      scanCode: '',
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
    if (!kit || !components.length || components.length !== this.kitDraft.components.length || new Set(components.map((row) => row.inventoryItemId)).size !== components.length) { this.error = this.language.text('inventory.message.8de312b32f'); return; }
    this.saving = true; this.clearFeedback();
    try {
      await firstValueFrom(this.api.put(`/inventory/${kit.id}/kit`, { components, autoUnbundleOnReceive: this.kitDraft.autoUnbundleOnReceive }));
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
      await firstValueFrom(this.api.post(`/inventory/${kit.id}/assemble`, { quantity, comments: this.kitDraft.comments.trim(), idempotencyKey: crypto.randomUUID() }));
      await this.reload(); await this.loadProduct(kit.id); this.kitDraft.quantity = null; this.kitDraft.comments = '';
      this.notice = this.language.text('inventory.message.ded0325efb');
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.a9c2be662d')); }
    finally { this.saving = false; }
  }

  printBarcode(row: Item) {
    this.printProductLabels([row]);
  }

  bulkPrintLabels() { const rows=this.items.filter(row => this.selectedProductIds.has(row.id)); if (!rows.length) return; this.printProductLabels(rows); }

  private printProductLabels(rows:Item[]) {
    const settings=this.inventoryPolicy.labelSettings;
    const codes=rows.map(row => ({ row, code:(row.barcode || row.sku).trim().toUpperCase() }));
    if (codes.some(({code}) => !code || [...code].some(char => !CODE39[char]))) { this.error=this.language.text('inventory.message.e2383ff060'); return; }
    const popup=window.open('','_blank','width=980,height=720'); if (!popup) { this.error=this.language.text('inventory.message.d37af2b6c8'); return; }
    popup.document.write(`<!doctype html><title>Product labels</title><style>body{margin:0;font:11px Arial}main{display:grid;grid-template-columns:repeat(${settings.columns},${settings.widthMm}mm);gap:2mm;padding:5mm}.label{width:${settings.widthMm}mm;height:${settings.heightMm}mm;border:1px solid #ddd;padding:2mm;text-align:center;box-sizing:border-box;break-inside:avoid;overflow:hidden}.label strong,.label small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.label svg{width:100%;height:16mm}@media print{main{padding:0}.label{border:0}}</style><main></main>`);
    const main=popup.document.querySelector('main')!;
    for (const {row,code} of codes) { const label=popup.document.createElement('section'); label.className='label'; if (settings.showName) { const name=popup.document.createElement('strong'); name.textContent=row.name; label.append(name); } const barcode=popup.document.createElement('div'); barcode.innerHTML=this.code39Svg(code); label.append(barcode); const details=popup.document.createElement('small'); details.textContent=[settings.showSku ? row.sku : '', settings.showPrice ? `${settings.priceCaption} ${this.money(row.retailPricePaise)}` : ''].filter(Boolean).join(' · '); label.append(details); main.append(label); }
    popup.document.close(); popup.focus(); popup.print();
  }

  isBatchTracked(id: string) { return this.batchTrackedInventoryItemIds.has(id); }

  async applyStocktake() {
    const product = this.productDetail?.product;
    const stockQuantity = Number(this.stocktakeDraft.stockQuantity);
    const reason = this.stocktakeDraft.reason.trim();
    const evidenceReference = this.stocktakeDraft.evidenceReference.trim();
    if (!product || this.stocktakeDraft.stockQuantity === null || !Number.isInteger(stockQuantity) || (stockQuantity < 0 && this.inventoryPolicy.negativeStockRule === 'block') || !reason || (stockQuantity >= 0 && (!evidenceReference || !this.stocktakeDraft.businessDate))) {
      this.error = this.language.text('inventory.message.fa79c19033'); return;
    }
    this.saving = true; this.clearFeedback();
    try {
      if (stockQuantity < 0) {
        await firstValueFrom(this.api.post('/inventory/negative-stock-requests', { inventoryItemId: product.id, requestedStockQuantity: stockQuantity, reason }));
        this.stocktakeDraft = { stockQuantity: null, reason: '', evidenceReference: '', businessDate: new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Kolkata' }) }; this.notice = this.language.text('inventory.message.bd80357f01');
      } else {
        const response = await firstValueFrom(this.api.post<ApiEnvelope<InventoryAdjustment>>('/inventory/adjustments', {
          inventoryItemId: product.id, requestedStockQuantity: stockQuantity,
          businessDate: this.stocktakeDraft.businessDate, reason, evidenceReference,
          idempotencyKey: crypto.randomUUID(),
        }));
        await this.reload(); await this.loadProduct(product.id);
        this.stocktakeDraft = { stockQuantity: null, reason: '', evidenceReference: '', businessDate: new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Kolkata' }) };
        this.notice = response.data?.status === 'pending_approval' ? 'Material adjustment sent for approval' : this.language.text('inventory.message.460f70de67');
      }
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.63c7a3b242')); }
    finally { this.saving = false; }
  }

  openSupplier(row?: Supplier) {
    this.supplierId = row?.id ?? '';
    this.supplierDraft = row ? { ...row } : this.emptySupplier();
    this.supplierTermsDraft = { inventoryItemId: '', leadTimeDays: null, minimumOrderQuantity: null, packSize: null, safetyStockDays: 7, vendorPartNumber:'', purchaseUnit:'pack', conversionQuantity:null, centerAvailable:true };
    this.supplierPriceDraft = { inventoryItemId: '', unitCostRupees: null, discountPercent:null, gstPercent:null, effectiveFrom: new Date().toISOString().slice(0,10) };
    this.supplierCommunicationDraft = { channel: 'email', destination: row?.email || '', subject: '', message: '' };
    this.drawer = 'supplier'; this.clearFeedback();
  }

  openOrder() {
    if (!this.canViewInventoryCost) { this.error = 'Product cost visibility permission is required'; return; }
    this.orderDraft = { supplierId: '', expectedDate: '', notes: '', shippingRupees: null, handlingRupees: null, lines: [this.emptyLine()] };
    this.orderOptimizations = []; this.orderOptimizerSignature = ''; this.orderOptimizerAcknowledged = '';
    this.drawer = 'order'; this.clearFeedback();
  }

  async openGrn(order?: Order) {
    if (!this.canViewInventoryCost) { this.error = 'Product cost visibility permission is required'; return; }
    this.clearFeedback();
    this.grnScanCode = ''; this.grnScanStarted = false;
    this.grnDraft = { supplierId: order?.supplierId ?? '', purchaseOrderId: order?.id ?? '', invoiceNumber: '', invoiceDate: '', receivedDate: '', dueDate: '', challanNumber: '', deliveryReference: '', shippingRupees: order ? order.shippingPaise / 100 : null, handlingRupees: order ? order.handlingPaise / 100 : null, backdatedOperationalApproval: false, acceptExcess:false, lines: [this.emptyLine()] };
    if (order) {
      try {
        const details = await this.get<{ order: Order; lines: OrderLine[] }>(`/purchases/orders/${order.id}`);
        this.grnDraft.lines = details.lines.filter((line) => this.remaining(line) > 0).map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: this.remaining(line), retailQuantity:line.retailQuantity-line.retailReceivedQuantity, consumableQuantity:line.consumableQuantity-line.consumableReceivedQuantity, orderedRemaining: this.remaining(line), unitCostRupees: line.unitCostPaise / 100, discountPercent: line.discountBps / 100, gstPercent: line.gstPercent, packageUnit: line.packageUnit, stockUnit: line.stockUnit, unitsPerPackage: line.unitsPerPackage, damagedQuantity: null, rejectedQuantity: null, varianceReason: '', requestMasterPriceUpdate:false }));
      } catch (error) { this.error = this.message(error, this.language.text('inventory.message.5749120dce')); return; }
    }
    this.drawer = 'grn';
  }

  async openReturn(receipt?: Receipt) {
    const selected = receipt ?? this.receipts[0];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    this.returnDraft = { receiptId: selected?.id ?? '', returnDate: today, creditNoteNumber: '', creditNoteDate: today, evidenceReference: '', reason: '', lines: [] };
    this.drawer = 'return'; this.clearFeedback();
    if (selected) await this.loadReturnLines();
  }

  async loadReturnLines() {
    if (!this.returnDraft.receiptId) { this.returnDraft.lines = []; return; }
    try {
      const details = await this.get<{ lines: ReceiptLine[] }>(`/purchases/grn/${this.returnDraft.receiptId}`);
      this.returnDraft.lines = details.lines.map((line) => ({ inventoryItemId: line.inventoryItemId, sourceLineId: line.id, quantity: null, unitCostRupees: line.unitCostPaise / 100, gstPercent: line.gstPercent, packageUnit: line.packageUnit, stockUnit: line.stockUnit, unitsPerPackage: line.unitsPerPackage, maxQuantity: line.quantity }));
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.50cf87fc57')); }
  }

  openPayment(row: Payable) {
    this.paymentDraft = { receiptId: row.purchaseReceiptId, amountRupees: row.balancePaise / 100, method: 'bank', reference: '' };
    this.drawer = 'payment'; this.clearFeedback();
  }

  openTransfer() {
    this.transferWorkflow = 'create'; this.selectedTransfer = null;
    this.transferDraft = { mode:'push', sourceBranchId:'', destinationBranchId: '', notes: '', lines: [this.emptyTransferLine()] };
    this.drawer = 'transfer'; this.clearFeedback();
  }

  async reviewAdjustment(row: InventoryAdjustment, decision: 'approve'|'reject') {
    const reviewNote = await this.dialogs.prompt(decision === 'reject' ? 'Rejection reason' : 'Approval note (optional)', { required:decision === 'reject', multiline:true }) ?? '';
    if (decision === 'reject' && !reviewNote.trim()) return;
    this.saving = true; this.clearFeedback();
    try {
      await firstValueFrom(this.api.post(`/inventory/adjustments/${row.id}/review`, { decision, reviewNote: reviewNote.trim(), idempotencyKey: crypto.randomUUID() }));
      await this.reload(); await this.loadProduct(row.inventoryItemId); this.notice = decision === 'approve' ? 'Adjustment approved' : 'Adjustment rejected';
    } catch (error) { this.error = this.message(error, 'Adjustment review failed'); }
    finally { this.saving = false; }
  }

  async unbundleKit() {
    const kit = this.productDetail?.product;
    const quantity = Number(this.kitDraft.quantity);
    if (!kit || !Number.isInteger(quantity) || quantity <= 0 || quantity > kit.stockQuantity) { this.error = 'Enter an available positive whole kit quantity'; return; }
    this.saving = true; this.clearFeedback();
    try {
      await firstValueFrom(this.api.post(`/inventory/${kit.id}/unbundle`, { quantity, comments: this.kitDraft.comments.trim(), idempotencyKey: crypto.randomUUID() }));
      await this.reload(); await this.loadProduct(kit.id); this.kitDraft.quantity = null; this.kitDraft.comments = '';
      this.notice = 'Kit unbundled';
    } catch (error) { this.error = this.message(error, 'Could not unbundle kit'); }
    finally { this.saving = false; }
  }

  kitComponentOptions(kit: Item) {
    return this.activeCenterItems.filter((item) => item.id !== kit.id && (item.productUsage === kit.productUsage || item.productUsage === 'dual_use'));
  }

  async scanKitBarcode() {
    const kit = this.productDetail?.product;
    const code = this.kitDraft.scanCode.trim();
    if (!kit || !code || this.kitScanBusy) return;
    this.kitScanBusy = true; this.clearFeedback();
    try {
      const response = await firstValueFrom(this.api.post<ApiEnvelope<ScanResolution>>('/inventory/scanner-events', { deviceId: this.scannerDeviceId(), workflow: 'kit', code, clientEventId: crypto.randomUUID(), capturedAt: new Date().toISOString() }));
      const itemId = response.data?.event.inventoryItemId;
      const item = this.activeCenterItems.find((row) => row.id === itemId);
      if (!item) throw new Error('Barcode is not mapped to an active product at this center');
      if (item.id === kit.id) this.notice = 'Kit barcode matched';
      else if (!this.kitComponentOptions(kit).some((row) => row.id === item.id)) throw new Error('Scanned product type does not match this kit');
      else if (this.kitDraft.components.some((row) => row.inventoryItemId === item.id)) this.notice = `${item.name} is already in the kit`;
      else { const empty = this.kitDraft.components.find((row) => !row.inventoryItemId); if (empty) { empty.inventoryItemId = item.id; empty.quantity = 1; } else this.kitDraft.components.push({ inventoryItemId: item.id, quantity: 1 }); this.notice = `${item.name} added`; }
      this.kitDraft.scanCode = '';
    } catch (error) { this.error = this.message(error, 'Could not match kit barcode'); }
    finally { this.kitScanBusy = false; }
  }

  addTransferLine() { this.transferDraft.lines.push(this.emptyTransferLine()); }
  removeTransferLine(index: number) { if (this.transferDraft.lines.length > 1) this.transferDraft.lines.splice(index, 1); }
  syncTransferLine(line: TransferDraftLine) {
    const item = this.items.find((row) => row.id === line.sourceInventoryItemId);
    line.retailQuantity = item?.productUsage === 'consumable' ? null : 0;
    line.consumableQuantity = item?.productUsage === 'retail' ? null : 0;
    line.transferPriceRupees = item ? item.unitCostPaise / 100 : null;
    line.gstPercent = this.transferDraft.mode === 'franchise_purchase' ? item?.gstPercent ?? 0 : 0;
  }
  transferAllowsRetail(line:TransferDraftLine) { return this.items.find((item) => item.id === line.sourceInventoryItemId)?.productUsage !== 'consumable'; }
  transferAllowsConsumable(line:TransferDraftLine) { return this.items.find((item) => item.id === line.sourceInventoryItemId)?.productUsage !== 'retail'; }

  addLine(target: 'order' | 'grn') { (target === 'order' ? this.orderDraft.lines : this.grnDraft.lines).push(this.emptyLine()); }
  removeLine(target: 'order' | 'grn', index: number) { const lines = target === 'order' ? this.orderDraft.lines : this.grnDraft.lines; if (lines.length > 1) lines.splice(index, 1); }
  syncItem(line: EntryLine) {
    const item = this.items.find((row) => row.id === line.inventoryItemId);
    if (item) { line.unitCostRupees = this.packageCostPaise(item) / 100; line.gstPercent = item.gstPercent; line.packageUnit = item.packageUnit; line.stockUnit = item.unit; line.unitsPerPackage = item.unitsPerPackage; line.retailQuantity = null; line.consumableQuantity = null; line.quantity = null; }
  }

  async importOrderCsv(event:Event) {
    if (!this.canViewInventoryCost) { this.error = 'Product cost visibility permission is required'; return; }
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv') || file.size > 3 * 1024 * 1024) { this.error = 'Select a CSV file up to 3 MB'; return; }
    this.importingOrder = true; this.clearFeedback();
    try {
      const csv = await file.text();
      const response = await firstValueFrom(this.api.post<ApiEnvelope<{ rowsImported:number; order:{ order:Order } }>>('/purchases/orders/import', { fileName:file.name, csv }));
      this.clearReferenceCache(); await this.reload();
      this.notice = `${response.data?.rowsImported || 0} CSV rows imported to draft ${response.data?.order.order.orderNumber || ''}`.trim();
    } catch (error) { this.error = this.message(error, 'Purchase order CSV import failed'); }
    finally { this.importingOrder = false; }
  }

  async reviewPriceUpdate(row:PriceUpdateRequest, approve:boolean) {
    if (!this.canViewInventoryCost) { this.error = 'Product cost visibility permission is required'; return; }
    const note = approve ? '' : await this.dialogs.prompt(`Reason for rejecting the master price update for ${row.productName}`, { required:true, multiline:true });
    if (!approve && !note) return;
    if (approve && !await this.dialogs.confirm(`Approve master price update for ${row.productName}?`)) return;
    await this.mutate(this.api.post(`/purchases/price-update-requests/${row.id}/review`, { approve, note }), `Master price update ${approve ? 'approved' : 'rejected'}`, false);
  }

  async printGrnLabels(receipt:Receipt) {
    this.clearFeedback();
    try {
      const rows = await this.get<BarcodeLabel[]>(`/purchases/grn/${receipt.id}/barcode-labels?productUsage=all`);
      const total = rows.reduce((sum, row) => sum + row.retailQuantity + row.consumableQuantity + row.freeQuantity, 0);
      if (!rows.length) throw new Error('No received products have a printable barcode');
      if (total > 5000) throw new Error('Print in smaller receipt batches; this GRN exceeds 5000 labels');
      if (rows.some(row => !row.barcode)) throw new Error('A received product has no barcode');
      if (rows.some(row => [...row.barcode.toUpperCase()].some(char => !CODE39[char]))) throw new Error('A received barcode is not Code 39 compatible');
      const popup = window.open('', '_blank', 'width=980,height=720');
      if (!popup) throw new Error('Allow pop-ups to print barcode labels');
      const settings=this.inventoryPolicy.labelSettings;
      popup.document.write(`<!doctype html><title>GRN barcode labels</title><style>body{margin:0;font:11px Arial}main{display:grid;grid-template-columns:repeat(${settings.columns},${settings.widthMm}mm);gap:2mm;padding:5mm}.label{width:${settings.widthMm}mm;height:${settings.heightMm}mm;border:1px solid #ddd;padding:2mm;text-align:center;box-sizing:border-box;break-inside:avoid;overflow:hidden}.label strong,.label small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.label svg{width:100%;height:16mm}@media print{main{padding:0}.label{border:0}}</style><main></main>`);
      const main = popup.document.querySelector('main')!;
      for (const row of rows) for (let index=0; index<row.retailQuantity+row.consumableQuantity+row.freeQuantity; index++) {
        const label = popup.document.createElement('section'); label.className='label';
        const name = popup.document.createElement('strong'); name.textContent=row.productName;
        const barcode = popup.document.createElement('div'); barcode.innerHTML=this.code39Svg(row.barcode.toUpperCase());
        const code = popup.document.createElement('small'); code.textContent=`${row.barcode}${row.batchNumber ? ` · ${row.batchNumber}` : ''}`;
        if (settings.showName) label.append(name); label.append(barcode);
        code.textContent=[settings.showSku ? row.sku : row.barcode, settings.showBatch && row.batchNumber ? row.batchNumber : '', settings.showExpiry && row.expiryDate ? this.date(row.expiryDate) : ''].filter(Boolean).join(' · ');
        label.append(code); main.append(label);
      }
      popup.document.close(); popup.focus(); popup.print();
    } catch (error) { this.error = this.message(error, 'Barcode labels could not be printed'); }
  }

  allowsRetail(line:EntryLine) { return ['retail','dual_use'].includes(this.itemById.get(line.inventoryItemId)?.productUsage || ''); }
  allowsConsumable(line:EntryLine) { return ['consumable','dual_use'].includes(this.itemById.get(line.inventoryItemId)?.productUsage || ''); }
  syncLineQuantities(line:EntryLine, grn:boolean) { if (line.retailQuantity == null && line.consumableQuantity == null) return; line.quantity = Number(line.retailQuantity || 0) + Number(line.consumableQuantity || 0) + (grn ? Number(line.damagedQuantity || 0) + Number(line.rejectedQuantity || 0) : 0); }

  async scanGrnBarcode() {
    const code = this.grnScanCode.trim();
    if (!code || this.grnScanBusy) return;
    this.grnScanBusy = true; this.clearFeedback();
    try {
      const response = await firstValueFrom(this.api.post<ApiEnvelope<ScanResolution>>('/inventory/scanner-events', { deviceId: this.scannerDeviceId(), workflow: 'receive', code, clientEventId: crypto.randomUUID(), capturedAt: new Date().toISOString() }));
      const itemId = response.data?.event.inventoryItemId;
      if (!itemId) throw new Error('Barcode is not mapped to an inventory product');
      let line = this.grnDraft.lines.find((row) => row.inventoryItemId === itemId);
      if (!line && this.grnDraft.purchaseOrderId) throw new Error('Scanned product is not pending on this purchase order');
      if (!this.itemById.has(itemId)) {
        const detail = await this.get<Product360>(`/inventory/${itemId}/360`);
        if (!this.items.some((row) => row.id === itemId)) this.items.push(detail.product);
        this.rebuildItemLookup();
      }
      if (!this.grnScanStarted) {
        for (const row of this.grnDraft.lines) { row.quantity = null; row.retailQuantity = null; row.consumableQuantity = null; row.damagedQuantity = null; row.rejectedQuantity = null; }
        this.grnScanStarted = true;
      }
      if (!line) {
        line = this.grnDraft.lines.find((row) => !row.inventoryItemId) ?? this.emptyLine();
        if (!this.grnDraft.lines.includes(line)) this.grnDraft.lines.push(line);
        line.inventoryItemId = itemId; this.syncItem(line);
      }
      if (this.allowsConsumable(line) && !this.allowsRetail(line)) line.consumableQuantity = Number(line.consumableQuantity || 0) + 1;
      else line.retailQuantity = Number(line.retailQuantity || 0) + 1;
      this.syncLineQuantities(line, true);
      this.grnScanCode = '';
      this.notice = `${this.itemName(itemId)} received quantity ${line.quantity}`;
    } catch (error) { this.error = this.message(error, 'Barcode receiving failed'); }
    finally { this.grnScanBusy = false; }
  }


  private rebuildItemLookup() {
    this.itemById.clear();
    this.batchTrackedInventoryItemIds.clear();
    for (const row of this.items) {
      this.itemById.set(row.id, row);
      if (row.batchTracked) this.batchTrackedInventoryItemIds.add(row.id);
    }
  }

  private recomputeProductViews() {
    const query = this.productQuery.trim().toLowerCase();
    const categories = new Set<string>();
    const filtered: Item[] = [];
    const lowStockItems: Item[] = [];
    const outOfStockItems: Item[] = [];
    let inventoryValue = 0;

    for (const row of this.items) {
      if (row.category) categories.add(row.category);
      if (row.stockQuantity > 0 && row.stockQuantity <= row.reorderPoint) {
        lowStockItems.push(row);
      }
      if (row.stockQuantity <= 0) {
        outOfStockItems.push(row);
      }
      inventoryValue += row.stockQuantity * row.unitCostPaise;

      if (!query || `${row.name} ${row.sku} ${row.barcode}`.toLowerCase().includes(query)) {
        if (!this.productCategory || row.category === this.productCategory) {
          filtered.push(row);
        }
      }
    }

    this.productCategoriesCache = [...categories].sort((a, b) => a.localeCompare(b));
    this.filteredItemsCache = filtered;
    this.lowStockItemsCache = lowStockItems;
    this.outOfStockItemsCache = outOfStockItems;
    this.inventoryValueCache = inventoryValue;
  }

  private recomputeReorderViews() {
    this.filteredReorderRowsCache = this.reorderPriority
      ? this.reorderRows.filter((row) => row.priority === this.reorderPriority)
      : this.reorderRows;
    this.reorderValueCache = this.filteredReorderRowsCache.reduce((sum, row) => sum + row.estimatedValuePaise, 0);
  }

  private rebuildReorderRows() {
    const forecastProductIds = new Set(this.forecastReorderRows.map((row) => row.productId));
    this.reorderRows = [...this.forecastReorderRows, ...this.baselineReorderRows.filter((row) => !forecastProductIds.has(row.productId))];
    this.recomputeReorderViews();
  }

  private recomputeValuationViews() {
    let valuationValue = 0;
    let valuationUnits = 0;
    let valuationLowStockValue = 0;
    let valuationExceptions = 0;
    for (const row of this.valuationRows) {
      valuationValue += row.stockValuePaise;
      valuationUnits += row.stockQuantity;
      if (row.stockQuantity <= row.reorderPoint) {
        valuationLowStockValue += row.stockValuePaise;
      }
      if (row.stockQuantity > 0 && row.unitCostPaise <= 0) {
        valuationExceptions += 1;
      }
    }
    this.valuationValueCache = valuationValue;
    this.valuationUnitsCache = valuationUnits;
    this.valuationLowStockValueCache = valuationLowStockValue;
    this.valuationExceptionsCache = valuationExceptions;
  }

  private recomputeLedgerViews() {
    let ledgerStockIn = 0;
    let ledgerStockOut = 0;
    let ledgerAdjustments = 0;
    for (const row of this.ledgerRows) {
      if (row.quantityDelta > 0) ledgerStockIn += 1;
      if (row.quantityDelta < 0) ledgerStockOut += 1;
      if (row.movementType === 'adjustment') ledgerAdjustments += 1;
    }
    this.ledgerStockInCache = ledgerStockIn;
    this.ledgerStockOutCache = ledgerStockOut;
    this.ledgerAdjustmentsCache = ledgerAdjustments;
  }

  private recomputeReceiptViews() {
    const query = this.receiptQuery.trim().toLowerCase();
    const filteredReceipts = this.receipts.filter((row) => {
      const received = row.receivedDate.slice(0, 10);
      return (!this.receiptFrom || received >= this.receiptFrom)
        && (!this.receiptTo || received <= this.receiptTo)
        && (!this.receiptSupplier || row.supplierName === this.receiptSupplier)
        && (!query || `${row.supplierName} ${row.supplierInvoiceNumber} ${row.supplierGstin}`.toLowerCase().includes(query));
    });

    const receiptSupplierSet = new Set(this.receipts.map((row) => row.supplierName));
    let receiptTaxable = 0;
    let receiptTotal = 0;
    let receiptGst = 0;
    for (const row of filteredReceipts) {
      receiptTaxable += row.taxablePaise;
      receiptTotal += row.totalPaise;
      receiptGst += this.receiptGst(row);
    }

    const ids = new Set(filteredReceipts.map((row) => row.id));
    let receiptPayableTotal = 0;
    for (const row of this.payables) {
      if (ids.has(row.purchaseReceiptId)) {
        receiptPayableTotal += row.balancePaise;
      }
    }

    this.receiptSuppliersCache = [...receiptSupplierSet].sort((a, b) => a.localeCompare(b));
    this.filteredReceiptsCache = filteredReceipts;
    this.receiptTaxableCache = receiptTaxable;
    this.receiptTotalCache = receiptTotal;
    this.receiptGstCache = receiptGst;
    this.receiptPayableTotalCache = receiptPayableTotal;
  }

  private recomputeOrderViews() {
    this.filteredOrdersCache = filterPurchaseOrders(this.orders, {
      query: this.orderQuery,
      status: this.orderStatus,
      supplierId: this.orderSupplier,
      stage: this.orderStage,
    });

    const statuses = new Set<string>();
    const orderStatusCounts = new Map<string, number>();
    for (const row of this.orders) {
      statuses.add(row.status);
      orderStatusCounts.set(row.status, (orderStatusCounts.get(row.status) ?? 0) + 1);
    }

    this.orderStatusesCache = [...statuses].sort();
    this.orderOpenValueCache = openPurchaseOrderValue(this.orders);
    this.orderStatusCounts.clear();
    for (const [status, count] of orderStatusCounts) {
      this.orderStatusCounts.set(status, count);
    }
  }

  private rebuildSupplierGovernanceLookups() {
    this.supplierScorecardById.clear();
    this.supplierTermsById.clear();
    this.supplierPriceListsById.clear();
    this.supplierQualityById.clear();
    this.supplierExpiryRiskById.clear();
    this.supplierReplacementsById.clear();

    for (const row of this.supplierGovernance.scorecards) {
      this.supplierScorecardById.set(row.supplierId, row);
    }
    for (const row of this.supplierGovernance.terms) {
      const current = this.supplierTermsById.get(row.supplierId) ?? [];
      current.push(row);
      this.supplierTermsById.set(row.supplierId, current);
    }
    for (const row of this.supplierGovernance.priceLists) {
      const current = this.supplierPriceListsById.get(row.supplierId) ?? [];
      current.push(row);
      this.supplierPriceListsById.set(row.supplierId, current);
    }
    for (const row of this.supplierGovernance.qualityEvents ?? []) {
      this.supplierQualityById.set(row.supplierId, row);
    }
    for (const row of this.supplierGovernance.expiryRisk ?? []) {
      this.supplierExpiryRiskById.set(row.supplierId, row);
    }
    for (const row of this.supplierGovernance.replacementOptions ?? []) {
      const current = this.supplierReplacementsById.get(row.supplierId) ?? [];
      current.push(row);
      this.supplierReplacementsById.set(row.supplierId, current);
    }
  }
  titleCase(value: string) { return value.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()); }
  masterValues(kind:string) { return this.masterData.values.filter(row => row.kind === kind && row.active); }
  get baseUnits() { return this.masterData.units.filter(row => row.active && row.dimension !== 'package'); }
  get packageUnits() { return this.masterData.units.filter(row => row.active && (row.dimension === 'package' || ['pcs','bottle','kit'].includes(row.code))); }
  get activeCenterItems() { return this.items.filter(row => row.active && row.centerAvailable); }
  movementLabel(code:string) { return this.masterData.values.find(row => row.kind === 'action_label' && row.active && row.code === code)?.label ?? code.replaceAll('_', ' '); }

  async saveSupplier() {
    const payload = { ...this.supplierDraft, name: this.titleCase(this.supplierDraft.name), contactName: this.titleCase(this.supplierDraft.contactName), paymentTermsDays: Number(this.supplierDraft.paymentTermsDays || 0) };
    await this.mutate(this.supplierId ? this.api.patch<ApiEnvelope<Supplier>>(`/purchases/suppliers/${this.supplierId}`, payload) : this.api.post<ApiEnvelope<Supplier>>('/purchases/suppliers', payload), 'Supplier saved');
  }

  async saveSupplierTerms() {
    const draft = this.supplierTermsDraft;
    if (!this.supplierId || !draft.inventoryItemId || draft.leadTimeDays === null || draft.minimumOrderQuantity === null || draft.packSize === null || draft.conversionQuantity === null) return;
    this.saving = true; this.clearFeedback();
    try {
      await firstValueFrom(this.api.post('/inventory/reorder-supplier-terms', { supplierId: this.supplierId, ...draft, conversionQuantity:Number(draft.conversionQuantity) }));
      this.clearReferenceCache('inventory.supplierGovernance');
      await this.reload();
      this.notice = this.language.text('inventory.message.1c28eea79e');
    } catch (error) {
      this.error = this.message(error, this.language.text('inventory.message.7f6964929f'));
    } finally {
      this.saving = false;
    }
  }
  async saveSupplierPrice() {
    if (!this.canViewInventoryCost) { this.error = 'Product cost visibility permission is required'; return; }
    if (!this.supplierId || !this.supplierPriceDraft.inventoryItemId || this.supplierPriceDraft.unitCostRupees === null) return;
    this.saving = true; this.clearFeedback();
    try {
      await firstValueFrom(this.api.post('/inventory/supplier-governance/prices', { supplierId: this.supplierId, inventoryItemId: this.supplierPriceDraft.inventoryItemId, unitCostPaise: Math.round(Number(this.supplierPriceDraft.unitCostRupees) * 100), discountBps:Math.round(Number(this.supplierPriceDraft.discountPercent || 0) * 100), gstPercent:Number(this.supplierPriceDraft.gstPercent || 0), effectiveFrom: this.supplierPriceDraft.effectiveFrom, effectiveTo: null }));
      this.clearReferenceCache('inventory.supplierGovernance');
      await this.reload();
      this.notice = this.language.text('inventory.message.570d7c46a0');
    } catch (error) {
      this.error = this.message(error, this.language.text('inventory.message.628af52a7a'));
    } finally {
      this.saving = false;
    }
  }
  async queueSupplierCommunication() {
    if (!this.supplierId || !this.supplierCommunicationDraft.destination.trim() || !this.supplierCommunicationDraft.message.trim()) return;
    this.saving = true; this.clearFeedback();
    try {
      await firstValueFrom(this.api.post('/inventory/supplier-governance/communications', { supplierId: this.supplierId, purchaseOrderId: null, ...this.supplierCommunicationDraft, idempotencyKey: crypto.randomUUID() }));
      this.clearReferenceCache('inventory.supplierGovernance');
      await this.reload();
      this.notice = this.language.text('inventory.message.ff44ae0a75');
    } catch (error) {
      this.error = this.message(error, this.language.text('inventory.message.84b2c1ec7f'));
    } finally {
      this.saving = false;
    }
  }
  async saveOrder() {
    if (!this.canViewInventoryCost) { this.error = 'Product cost visibility permission is required'; return; }
    for (const line of this.orderDraft.lines) this.syncLineQuantities(line, false);
    const lines = this.validLines(this.orderDraft.lines, false);
    if (!this.orderDraft.supplierId || !lines.length) { this.error = this.language.text('inventory.message.67fac0e7a7'); return; }
    const signature = JSON.stringify(lines.map((line) => [line.inventoryItemId, line.quantity, line.unitCostPaise, line.discountBps]));
    if (this.orderOptimizerAcknowledged !== signature) {
      this.saving = true; this.clearFeedback();
      try {
        const optimizerLines = lines.map((line) => ({ ...line, unitCostPaise: Math.round(line.unitCostPaise * (10_000 - line.discountBps) / 10_000) }));
        const response = await firstValueFrom(this.api.post<ApiEnvelope<TransferOptimization[]>>('/inventory/transfer-optimizer', { lines: optimizerLines }));
        this.orderOptimizations = response.data ?? [];
        this.orderOptimizerSignature = signature;
        if (this.orderOptimizations.length) return;
      } catch (error) {
        this.error = this.message(error, 'Unable to run cross-branch purchase precheck'); return;
      } finally { this.saving = false; }
    }
    await this.mutate(this.api.post('/purchases/orders', { supplierId: this.orderDraft.supplierId, expectedDate: this.orderDraft.expectedDate || null, notes: this.orderDraft.notes, shippingPaise: this.toPaise(this.orderDraft.shippingRupees), handlingPaise: this.toPaise(this.orderDraft.handlingRupees), lines }), 'Purchase order created');
  }

  continuePurchaseAfterOptimization() {
    this.orderOptimizerAcknowledged = this.orderOptimizerSignature;
    void this.saveOrder();
  }

  async orderAction(order: Order, action: 'submit' | 'approve' | 'reject' | 'send' | 'close' | 'cancel' | 'reopen') {
    if (['reject', 'close', 'cancel', 'reopen'].includes(action) && !await this.dialogs.confirm(`${action[0].toUpperCase()}${action.slice(1)} purchase order ${order.orderNumber}?`)) return;
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
    if (!this.canViewInventoryCost) { this.error = 'Product cost visibility permission is required'; return; }
    for (const line of this.grnDraft.lines) this.syncLineQuantities(line, true);
    const supplier = this.suppliers.find((row) => row.id === this.grnDraft.supplierId);
    const lines = this.validLines(this.grnDraft.lines, true);
    if (!supplier || !this.grnDraft.invoiceNumber.trim() || !this.grnDraft.invoiceDate || !lines.length) { this.error = this.language.text('inventory.message.d2dbbb62ba'); return; }
    if (!await this.validateGrnSupplierTerms(supplier.id, lines.map((line) => line.inventoryItemId))) return;
    await this.mutate(this.api.post('/purchases/grn', { supplierId: supplier.id, purchaseOrderId: this.grnDraft.purchaseOrderId || null, supplierName: supplier.name, supplierGstin: supplier.gstin, supplierInvoiceNumber: this.grnDraft.invoiceNumber.trim(), supplierInvoiceDate: this.grnDraft.invoiceDate, receivedDate: this.grnDraft.receivedDate || null, dueDate: this.grnDraft.dueDate || null, challanNumber: this.grnDraft.challanNumber.trim(), deliveryReference: this.grnDraft.deliveryReference.trim(), shippingPaise: this.toPaise(this.grnDraft.shippingRupees), handlingPaise: this.toPaise(this.grnDraft.handlingRupees), backdatedOperationalApproval: this.grnDraft.backdatedOperationalApproval, acceptExcess:this.grnDraft.acceptExcess, requestMasterPriceUpdates:this.grnDraft.lines.filter(line => line.requestMasterPriceUpdate).map(line => line.inventoryItemId), idempotencyKey: crypto.randomUUID(), lines }), 'GRN posted', !this.standaloneGrn);
    if (this.standaloneGrn && !this.error) {
      const notice = this.notice;
      await this.openGrn();
      this.notice = notice;
    }
  }

  async saveReturn() {
    const lines = this.returnDraft.lines.filter((line) => Number(line.quantity) > 0).map((line) => ({ purchaseReceiptLineId: line.sourceLineId, quantity: Number(line.quantity) }));
    if (!this.returnDraft.receiptId || !this.returnDraft.returnDate || !this.returnDraft.creditNoteDate
      || !this.returnDraft.creditNoteNumber.trim() || !this.returnDraft.evidenceReference.trim()
      || !this.returnDraft.reason.trim() || !lines.length) { this.error = 'Receipt, dates, credit note, evidence, reason and return lines are required'; return; }
    await this.mutate(this.api.post('/purchases/returns', {
      purchaseReceiptId: this.returnDraft.receiptId,
      returnDate: this.returnDraft.returnDate,
      creditNoteNumber: this.returnDraft.creditNoteNumber.trim(),
      creditNoteDate: this.returnDraft.creditNoteDate,
      evidenceReference: this.returnDraft.evidenceReference.trim(),
      reason: this.returnDraft.reason.trim(), idempotencyKey: crypto.randomUUID(), lines,
    }), 'Purchase return posted');
  }

  openQuarantineDisposition(row: ReceivingQuarantine) {
    if (row.remainingQuantity <= 0) return;
    this.selectedQuarantine = row;
    this.quarantineDraft = { action: 'release', quantity: null, reason: '', evidenceReference: '', creditNoteNumber: '' };
    this.drawer = 'quarantine';
  }

  async saveQuarantine() {
    const row = this.selectedQuarantine;
    const quantity = Number(this.quarantineDraft.quantity);
    if (!row || !Number.isInteger(quantity) || quantity <= 0 || quantity > row.remainingQuantity
      || !this.quarantineDraft.reason.trim() || !this.quarantineDraft.evidenceReference.trim()
      || (this.quarantineDraft.action === 'return' && !this.quarantineDraft.creditNoteNumber.trim())) {
      this.error = 'Valid quantity, reason and evidence are required; vendor return also needs a credit note'; return;
    }
    await this.mutate(this.api.post(`/purchases/quarantine/${row.id}/dispositions`, {
      action: this.quarantineDraft.action,
      quantity,
      reason: this.quarantineDraft.reason.trim(),
      evidenceReference: this.quarantineDraft.evidenceReference.trim(),
      creditNoteNumber: this.quarantineDraft.creditNoteNumber.trim() || null,
      idempotencyKey: crypto.randomUUID(),
    }), 'Quarantine disposition posted');
  }

  async savePayment() {
    const amountPaise = Math.round(Number(this.paymentDraft.amountRupees) * 100);
    if (!this.paymentDraft.receiptId || amountPaise <= 0) { this.error = this.language.text('inventory.message.62a3419043'); return; }
    await this.mutate(this.api.post('/purchases/payments', { purchaseReceiptId: this.paymentDraft.receiptId, amountPaise, paymentMethod: this.paymentDraft.method, reference: this.paymentDraft.reference.trim(), idempotencyKey: crypto.randomUUID() }), 'Supplier payment posted');
  }

  async saveTransfer() {
    const lines = this.transferDraft.lines.filter((line) => line.sourceInventoryItemId && Number(line.retailQuantity || 0) + Number(line.consumableQuantity || 0) > 0).map((line) => ({
      sourceInventoryItemId:line.sourceInventoryItemId,
      retailQuantity:Number(line.retailQuantity || 0), consumableQuantity:Number(line.consumableQuantity || 0),
      transferUnitPricePaise:this.toPaise(line.transferPriceRupees), discountBps:Math.round(Number(line.discountPercent || 0) * 100), gstPercent:Number(line.gstPercent || 0),
    }));
    const needsDestination = ['push','return'].includes(this.transferDraft.mode);
    if ((needsDestination && !this.transferDraft.destinationBranchId.trim()) || !lines.length) { this.error = this.language.text('inventory.message.e92deb7bf1'); return; }
    await this.mutate(this.api.post('/inventory/transfers', {
      mode:this.transferDraft.mode,
      sourceBranchId:this.transferDraft.sourceBranchId.trim() || null,
      destinationBranchId:this.transferDraft.destinationBranchId.trim() || null,
      notes:this.transferDraft.notes.trim(), idempotencyKey:crypto.randomUUID(), lines,
    }), 'Transfer draft created');
  }

  async transferAction(row: Transfer, action: 'raise'|'approve'|'reject'|'cancel') {
    const note = action === 'reject' ? await this.dialogs.prompt('Rejection reason', { required:true, multiline:true }) : action === 'cancel' ? await this.dialogs.prompt('Cancellation note', { multiline:true }) ?? '' : '';
    if (action === 'reject' && !note?.trim()) return;
    if (!['reject','cancel'].includes(action) && !await this.dialogs.confirm(`${action[0].toUpperCase()}${action.slice(1)} ${row.transferNumber}?`)) return;
    const completed = ({ raise:'raised', approve:'approved', reject:'rejected', cancel:'cancelled' } as const)[action];
    await this.mutate(this.api.post(`/inventory/transfers/${row.id}/${action}`, action === 'reject' || action === 'cancel' ? { notes:note } : {}), `Transfer ${completed}`, false);
  }

  async openTransferShipment(row: Transfer) {
    const detail = await this.loadTransfer(row.id); if (!detail) return;
    this.selectedTransfer = detail; this.transferWorkflow = 'dispatch';
    this.transferShipmentDraft = { shippingRupees:null, handlingRupees:null, otherChargesRupees:null, lines:detail.lines.map((line) => ({
      transferLineId:line.id, productName:line.productName,
      retailQuantity:line.reservedRetailQuantity || null, consumableQuantity:line.reservedConsumableQuantity || null,
      maxRetail:line.reservedRetailQuantity, maxConsumable:line.reservedConsumableQuantity,
    })).filter((line) => line.maxRetail + line.maxConsumable > 0) };
    this.drawer = 'transfer'; this.clearFeedback();
  }

  async saveTransferShipment() {
    if (!this.selectedTransfer) return;
    const lines = this.transferShipmentDraft.lines.filter((line) => Number(line.retailQuantity || 0) + Number(line.consumableQuantity || 0) > 0).map((line) => ({
      transferLineId:line.transferLineId, retailQuantity:Number(line.retailQuantity || 0), consumableQuantity:Number(line.consumableQuantity || 0),
    }));
    if (!lines.length) { this.error = 'Add at least one shipment quantity'; return; }
    await this.mutate(this.api.post(`/inventory/transfers/${this.selectedTransfer.id}/dispatch`, {
      shippingPaise:this.toPaise(this.transferShipmentDraft.shippingRupees), handlingPaise:this.toPaise(this.transferShipmentDraft.handlingRupees), otherChargesPaise:this.toPaise(this.transferShipmentDraft.otherChargesRupees), lines,
    }), 'Transfer shipment dispatched');
  }

  async shipNextTransferShipment(row: Transfer) {
    const detail = await this.loadTransfer(row.id); const shipment = detail?.shipments.find((item) => item.status === 'dispatched');
    if (!shipment) { this.error = 'No dispatched shipment is waiting to ship'; return; }
    if (!await this.dialogs.confirm(`Move shipment ${shipment.shipmentNumber} in transit?`)) return;
    await this.mutate(this.api.post(`/inventory/transfers/${row.id}/shipments/${shipment.id}/ship`, {}), 'Transfer shipment is in transit', false);
  }

  async openTransferReceipt(row: Transfer) {
    const detail = await this.loadTransfer(row.id); const shipment = detail?.shipments.find((item) => item.status === 'in_transit');
    if (!detail || !shipment) { this.error = 'No in-transit shipment is waiting for receipt'; return; }
    const names = new Map(detail.lines.map((line) => [line.id, line.productName]));
    this.selectedTransfer = detail; this.transferWorkflow = 'receive';
    this.transferReceiptDraft = { shipmentId:shipment.id, shipmentNumber:shipment.shipmentNumber, notes:'', lines:shipment.lines.map((line) => ({
      shipmentLineId:line.id, productName:names.get(line.transferLineId) || line.transferLineId,
      receivedRetailQuantity:line.dispatchedRetailQuantity || null, receivedConsumableQuantity:line.dispatchedConsumableQuantity || null,
      damagedQuantity:null, expiredQuantity:null, shortQuantity:null, varianceReason:'',
      maxRetail:line.dispatchedRetailQuantity, maxConsumable:line.dispatchedConsumableQuantity,
    })) };
    this.drawer = 'transfer'; this.clearFeedback();
  }

  async saveTransferReceipt() {
    if (!this.selectedTransfer) return;
    const lines = this.transferReceiptDraft.lines.map((line) => ({
      shipmentLineId:line.shipmentLineId, receivedRetailQuantity:Number(line.receivedRetailQuantity || 0), receivedConsumableQuantity:Number(line.receivedConsumableQuantity || 0),
      damagedQuantity:Number(line.damagedQuantity || 0), expiredQuantity:Number(line.expiredQuantity || 0), shortQuantity:Number(line.shortQuantity || 0), varianceReason:line.varianceReason.trim(),
    }));
    await this.mutate(this.api.post(`/inventory/transfers/${this.selectedTransfer.id}/shipments/${this.transferReceiptDraft.shipmentId}/receive`, { notes:this.transferReceiptDraft.notes.trim(), lines }), 'Transfer shipment received');
  }

  async openTransferReturn(row: Transfer) {
    const detail = await this.loadTransfer(row.id); if (!detail) return;
    this.selectedTransfer = detail; this.transferWorkflow = 'return';
    this.transferReturnDraft = { reason:'damaged', notes:'', lines:detail.lines.map((line) => ({
      transferLineId:line.id, productName:line.productName, retailQuantity:null, consumableQuantity:null,
      maxRetail:line.receivedRetailQuantity, maxConsumable:line.receivedConsumableQuantity,
    })).filter((line) => line.maxRetail + line.maxConsumable > 0) };
    this.drawer = 'transfer'; this.clearFeedback();
  }

  async saveTransferReturn() {
    if (!this.selectedTransfer) return;
    const lines = this.transferReturnDraft.lines.filter((line) => Number(line.retailQuantity || 0) + Number(line.consumableQuantity || 0) > 0).map((line) => ({
      transferLineId:line.transferLineId, retailQuantity:Number(line.retailQuantity || 0), consumableQuantity:Number(line.consumableQuantity || 0),
    }));
    if (!lines.length) { this.error = 'Add at least one return quantity'; return; }
    await this.mutate(this.api.post(`/inventory/transfers/${this.selectedTransfer.id}/returns`, { reason:this.transferReturnDraft.reason, notes:this.transferReturnDraft.notes.trim(), idempotencyKey:crypto.randomUUID(), lines }), 'Return transfer draft created');
  }

  async saveTransferSettings() {
    await this.mutate(this.api.put('/inventory/transfer-settings', this.transferSettings), 'Transfer settings saved', false);
  }

  useReturnsWarehouse() {
    const branchId = this.transferSettings.defaultReturnsWarehouseBranchId?.trim();
    if (!branchId) { this.error = 'Configure a returns warehouse first'; return; }
    this.transferDraft.mode = 'push'; this.transferDraft.destinationBranchId = branchId;
  }

  private async loadTransfer(id:string) {
    this.clearFeedback();
    try { return await this.get<TransferDetails>(`/inventory/transfers/${id}`); }
    catch (error) { this.error = this.message(error, 'Unable to load transfer details'); return null; }
  }

  private validLines(lines: EntryLine[], batches: boolean) {
    return lines.filter((line) => line.inventoryItemId && Number(line.quantity) > 0 && Number(line.unitCostRupees) >= 0).map((line) => ({
      inventoryItemId: line.inventoryItemId, quantity: Number(line.quantity),
      retailQuantity: line.retailQuantity == null ? undefined : Number(line.retailQuantity), consumableQuantity: line.consumableQuantity == null ? undefined : Number(line.consumableQuantity),
      unitCostPaise: Math.round(Number(line.unitCostRupees) * 100), discountBps: Math.round(Number(line.discountPercent || 0) * 100), gstPercent: Number(line.gstPercent || 0),
      ...(batches ? { damagedQuantity: Number(line.damagedQuantity || 0), rejectedQuantity: Number(line.rejectedQuantity || 0), varianceReason: line.varianceReason?.trim() || '', batchNumber: line.batchNumber?.trim() || null, batchBarcode: line.batchBarcode?.trim().toUpperCase() || null, expiryDate: line.expiryDate || null } : {}),
    }));
  }

  private async mutate(request: any, success: string, close = true) {
    this.saving = true; this.clearFeedback();
    try {
      const response: any = await firstValueFrom(request);
      const warnings = response?.data?.warnings as string[] | undefined;
      const notice = warnings?.length ? `${success} · ${warnings.join(' · ')}` : success;
      this.notice = notice;
      if (close) this.drawer = null;
      this.clearReferenceCache();
      await this.reload();
      this.notice = notice;
    } catch (error) {
      this.error = this.message(error, this.language.text('inventory.message.78b92a0634'));
    } finally {
      this.saving = false;
    }
  }
  private async get<T>(path: string) { const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path)); if (response.data === undefined) throw new Error('API response did not contain data'); return response.data; }
  private async getAllPages<T>(path: string, pageSize = 200) {
    const [base, rawQuery = ''] = path.split('?', 2);
    const params = new URLSearchParams(rawQuery);
    const rows: T[] = [];
    for (let page = 1; ; page++) {
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      params.set('withCount', 'false');
      const batch = await this.get<T[]>(`${base}?${params}`);
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
    }
  }
  private async getAllLedger(filters = new URLSearchParams()) {
    const rows: LedgerRow[] = [];
    const limit = 2000;
    for (let offset = 0; ; offset += limit) {
      const params = new URLSearchParams(filters);
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      const batch = await this.get<LedgerRow[]>(`/inventory/ledger?${params}`);
      rows.push(...batch);
      if (batch.length < limit) return rows;
    }
  }
  private async validateGrnSupplierTerms(supplierId: string, inventoryItemIds: string[]) {
    const governance = await this.getCached<SupplierGovernance>('inventory.supplierGovernance', () => this.get<SupplierGovernance>('/inventory/supplier-governance'));
    const available = new Set(governance.terms.filter((row) => row.supplierId === supplierId && row.centerAvailable).map((row) => row.inventoryItemId));
    const missing = [...new Set(inventoryItemIds)].filter((id) => !available.has(id));
    if (!missing.length) return true;
    const names = missing.map((id) => this.itemById.get(id)?.name ?? id);
    this.error = `Configure supplier-product association before posting: ${names.join(', ')}`;
    this.showGrnAssociationAction = true;
    return false;
  }
  async configureGrnSupplierProducts() {
    const supplierId = this.grnDraft.supplierId;
    if (!supplierId) return;
    await this.router.navigate(['/inventory'], { queryParams: { tab: 'suppliers', supplierId } });
  }
  private async loadProduct(id: string) {
    this.productLoading = true; this.productDetail = null;
    try {
      [this.productDetail, this.adjustments] = await Promise.all([
        this.get<Product360>(`/inventory/${id}/360`),
        this.get<InventoryAdjustment[]>(`/inventory/adjustments?inventoryItemId=${encodeURIComponent(id)}`),
      ]);
    }
    catch (error) { this.error = this.message(error, this.language.text('inventory.message.401335ec5e')); }
    finally { this.productLoading = false; }
  }
  private message(error: any, fallback: string) { return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback; }
  private clearFeedback() { this.error = ''; this.notice = ''; this.showGrnAssociationAction = false; }
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
  private emptyProduct() { return { sku: '', name: '', category: '', subcategory:'', brand: '', productUsage:'retail' as Item['productUsage'], unit: '', packageUnit: '', unitsPerPackage: 1, reorderPoint: null as number | null, alertLevel:null as number|null, desiredLevel:null as number|null, orderLevel:null as number|null, safetyStockLevel:null as number|null, packageCostRupees: null as number | null, retailPriceRupees: null as number | null, hsnCode: '', gstPercent: null as number | null, barcodesText:'', batchTracked: false, centerAvailable:true, onlineSaleEnabled:false, active: true }; }
  private toPaise(value: number | null) { return Math.round(Number(value || 0) * 100); }
  private emptyLine(): EntryLine { return { inventoryItemId: '', quantity: null, retailQuantity:null, consumableQuantity:null, unitCostRupees: null, discountPercent: null, gstPercent: null, damagedQuantity: null, rejectedQuantity: null, varianceReason: '', batchNumber: '', batchBarcode: '', expiryDate: '', requestMasterPriceUpdate:false }; }
  private emptyTransferLine(): TransferDraftLine { return { sourceInventoryItemId:'', retailQuantity:null, consumableQuantity:null, transferPriceRupees:null, discountPercent:null, gstPercent:null }; }
  private scannerDeviceId() { const key = 'aurashine.inventory.scanner.device.v1'; const existing = localStorage.getItem(key); if (existing) return existing; const value = crypto.randomUUID(); localStorage.setItem(key, value); return value; }
  private emptySupplier(): SupplierDraft { return { id: '', code: '', name: '', gstin: '', contactName: '', phone: '', email: '', address: '', paymentTermsDays: null, active: true }; }
}


















