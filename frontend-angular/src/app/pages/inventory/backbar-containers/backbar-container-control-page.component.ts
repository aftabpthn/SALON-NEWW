import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { TitleCaseInputsDirective } from '../../../shared/directives/title-case-inputs.directive';
import { AuthService } from '../../../core/services/auth.service';
import { ActionDialogService } from '../../../shared/services/action-dialog.service';
import {
  BackbarContainer,
  BackbarContainerEvent,
  BackbarControlService,
  BackbarItem,
  BackbarProduct360,
  BackbarStaff,
  BackbarUsage,
  FloorControl,
  FloorClosing,
} from '../../../features/inventory/backbar-control.service';

type ContainerTab = 'containers' | 'floor' | 'checkout' | 'history' | 'closings' | 'lifecycle' | 'overrides' | 'product360';
type LifecycleRow = BackbarContainerEvent & { containerId: string; productName: string; barcode: string };

@Component({
  selector: 'page-backbar-container-control',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent, TitleCaseInputsDirective],
  templateUrl: './backbar-container-control-page.component.html',
  styleUrls: ['./backbar-container-control-page.component.css'],
})
export class BackbarContainerControlPageComponent implements OnInit {
  private readonly backbar = inject(BackbarControlService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(ActionDialogService);

  items: BackbarItem[] = [];
  containers: BackbarContainer[] = [];
  usage: BackbarUsage[] = [];
  staff: BackbarStaff[] = [];
  floor: FloorControl = { locations: [], balances: [], custodyEvents: [], closings: [], operationalMovements: [] };
  activeTab: ContainerTab = 'containers';
  search = '';
  status = '';
  scanCode = '';
  selectedProductId = '';
  selectedContainerId = '';
  product360: BackbarProduct360 | null = null;
  loading = true;
  saving = false;
  productLoading = false;
  registerOpen = false;
  productDrawerOpen = false;
  error = '';
  notice = '';
  consumeQuantity: Record<string, number | null> = {};
  custodyDraft: Record<string, { locationCode:string; staffId:string; reason:string }> = {};
  closingCount: Record<string, number | null> = {};
  closingReason: Record<string, string> = {};
  closingDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  closingShift = '';
  locationDraft = { code:'', name:'', locationType:'backbar' as 'store'|'backbar'|'station'|'trolley' };
  checkoutDraft = { inventoryItemId:'', destinationBucket:'consumable_available', quantity:null as number|null, employeeId:'', comment:'' };
  conversionDraft = { inventoryItemId:'', sourceBucket:'retail_available', destinationBucket:'consumable_available', quantity:null as number|null, employeeId:'', comment:'' };
  draft = this.emptyDraft();

  ngOnInit() { void this.load(); }

  get canReview() { return ['owner', 'admin', 'manager', 'inventory manager', 'inventory_manager', 'inventoryManager'].some((role) => this.auth.hasRole(role)) || this.auth.hasPermission('inventory.approve'); }
  get sealedCount() { return this.containers.filter((row) => row.status === 'sealed').length; }
  get openCount() { return this.containers.filter((row) => row.status === 'open').length; }
  get nearEmptyCount() { return this.containers.filter((row) => row.status === 'open' && row.remainingQuantity <= Math.max(1, Math.ceil(row.capacityQuantity * .1))).length; }
  get pendingOverrideCount() { return this.containers.filter((row) => !!row.pendingOverrideId).length; }
  get filteredContainers() {
    const query = this.search.trim().toLowerCase();
    return this.containers.filter((row) => (!query || `${row.id} ${row.productName} ${row.barcode}`.toLowerCase().includes(query)) && (!this.status || row.status === this.status));
  }
  get lifecycleRows(): LifecycleRow[] {
    return this.containers.flatMap((container) => container.events.map((event) => ({ ...event, containerId: container.id, productName: container.productName, barcode: container.barcode })))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  get overrideContainers() { return this.containers.filter((row) => !!row.pendingOverrideId); }
  get selectedItem() { return this.items.find((row) => row.id === this.selectedProductId); }
  get productContainers() { return this.containers.filter((row) => row.inventoryItemId === this.selectedProductId); }
  get productUsage() { return this.usage.filter((row) => row.inventoryItemId === this.selectedProductId); }
  get productWastage() { return this.productUsage.filter((row) => row.varianceQuantity > 0); }
  get openContainers() { return this.containers.filter((row) => row.status === 'open'); }
  get pendingClosings() { return this.floor.closings.filter((row) => row.status === 'pending_approval'); }

  async load() {
    this.loading = true; this.clearFeedback();
    try {
      [this.containers, this.usage, this.floor, this.staff] = await Promise.all([this.backbar.containers(), this.backbar.usage(), this.backbar.floorControl(), this.backbar.staff()]);
      for (const row of this.containers) {
        this.custodyDraft[row.id] ||= { locationCode: row.locationCode || 'BACKBAR', staffId: row.custodianStaffId || '', reason: '' };
        if (row.status === 'open' && this.closingCount[row.id] === undefined) this.closingCount[row.id] = row.remainingQuantity;
      }
      void this.backbar.items().then((items) => { this.items = items; if (this.selectedProductId && !items.some((row) => row.id === this.selectedProductId)) this.closeProduct360(); })
        .catch((error) => { this.error ||= this.message(error, 'Products could not be loaded'); });
    } catch (error) { this.error = this.message(error, 'Unable to load backbar containers'); }
    finally { this.loading = false; }
  }

  openRegister() { this.draft = this.emptyDraft(); this.registerOpen = true; this.clearFeedback(); }
  containerProductChanged() {
    const item = this.items.find((row) => row.id === this.draft.inventoryItemId);
    if (!item) return;
    this.draft.capacityQuantity = item.unitsPerPackage;
    this.draft.unit = item.unit;
  }
  closeRegister() { if (!this.saving) this.registerOpen = false; }
  closeProduct360() { this.productDrawerOpen = false; this.product360 = null; this.selectedProductId = ''; }

  async registerContainer() {
    const capacity = Number(this.draft.capacityQuantity);
    if (!this.draft.inventoryItemId || !this.draft.barcode.trim() || !Number.isInteger(capacity) || capacity <= 0 || !this.draft.unit.trim()) {
      this.error = 'Product, barcode, capacity and unit are required'; return;
    }
    await this.action(async () => this.backbar.createContainer({
      inventoryItemId: this.draft.inventoryItemId,
      barcode: this.draft.barcode.trim(),
      capacityQuantity: capacity,
      unit: this.draft.unit.trim(),
      idempotencyKey: crypto.randomUUID(),
    }), 'Container registered');
    if (!this.error) this.registerOpen = false;
  }

  async openContainer(row: BackbarContainer) {
    await this.action(() => this.backbar.openContainer(row.id), 'Container opened and package stock posted');
  }

  async consumeContainer(row: BackbarContainer) {
    const quantity = Number(this.consumeQuantity[row.id]);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > row.remainingQuantity) { this.error = 'Enter a valid consumption quantity'; return; }
    await this.action(() => this.backbar.consumeContainer(row.id, quantity), 'Container usage recorded');
    this.consumeQuantity[row.id] = null;
  }

  async requestOverride(row: BackbarContainer) {
    const value = await this.dialogs.prompt(`Correct remaining quantity (0-${row.capacityQuantity})`, { defaultValue:String(row.remainingQuantity), required:true });
    if (value === null) return;
    const requestedRemaining = Number(value);
    const reason = await this.dialogs.prompt('Override reason', { required:true, multiline:true });
    if (!Number.isInteger(requestedRemaining) || requestedRemaining < 0 || requestedRemaining > row.capacityQuantity || !reason) return;
    await this.action(() => this.backbar.requestOverride(row.id, requestedRemaining, reason), 'Override sent for owner approval');
  }

  async printLabel(row:BackbarContainer){
    const popup=window.open('','_blank','width=520,height=720');
    if(!popup){this.error='Allow pop-ups to print the container label';return;}
    try{
      const label=await this.backbar.containerLabel(row.id);
      const safe=(value:unknown)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
      popup.document.write(`<!doctype html><html><head><title>Container ${safe(label.barcode)}</title><style>body{font-family:Arial,sans-serif;margin:0;padding:24px}.label{width:320px;border:1px solid #9fb3c8;border-radius:12px;padding:18px;text-align:center}.qr{width:220px;height:220px;margin:auto}.name{font-size:20px;font-weight:700}.meta{margin-top:8px;color:#334e68}@media print{body{padding:0}.label{border-color:#000}}</style></head><body><section class="label"><div class="name">${safe(label.productName)}</div><div class="qr">${label.qrSvg}</div><strong>${safe(label.barcode)}</strong><div class="meta">${safe(label.capacityQuantity)} ${safe(label.unit)} · ${safe(label.batchNumber||'No batch')}</div></section><script>window.onload=()=>window.print()<\/script></body></html>`);
      popup.document.close();
    }catch(error){popup.close();this.error=this.message(error,'Unable to generate container label');}
  }

  async reviewOverride(row: BackbarContainer, decision: 'approve' | 'reject') {
    if (!row.pendingOverrideId) return;
    const reviewNote = decision === 'reject' ? await this.dialogs.prompt('Rejection reason', { required:true, multiline:true }) : '';
    if (decision === 'reject' && !reviewNote) return;
    await this.action(() => this.backbar.reviewOverride(row.pendingOverrideId!, decision, reviewNote || ''), `Override ${decision}d`);
  }

  async saveLocation() {
    if (!this.locationDraft.code.trim() || !this.locationDraft.name.trim()) { this.error='Location code and name are required'; return; }
    await this.action(() => this.backbar.saveFloorLocation({ ...this.locationDraft, active:true }), 'Floor location saved');
    if (!this.error) this.locationDraft={ code:'',name:'',locationType:'backbar' };
  }

  async checkoutStock() {
    const quantity=Number(this.checkoutDraft.quantity);
    if (!this.checkoutDraft.inventoryItemId || !this.checkoutDraft.employeeId || !Number.isInteger(quantity) || quantity<=0) { this.error='Product, employee and positive quantity are required'; return; }
    await this.action(() => this.backbar.checkout({ ...this.checkoutDraft,quantity,idempotencyKey:crypto.randomUUID() }), 'Store-to-floor checkout posted');
    if (!this.error) this.checkoutDraft={ inventoryItemId:'',destinationBucket:'consumable_available',quantity:null,employeeId:'',comment:'' };
  }

  conversionDirectionChanged() {
    this.conversionDraft.destinationBucket=this.conversionDraft.sourceBucket==='retail_available'?'consumable_available':'retail_available';
  }

  async convertStock() {
    const quantity=Number(this.conversionDraft.quantity);
    if (!this.conversionDraft.inventoryItemId || !this.conversionDraft.employeeId || !Number.isInteger(quantity) || quantity<=0) { this.error='Dual-use product, employee and positive quantity are required'; return; }
    await this.action(() => this.backbar.convert({ ...this.conversionDraft,quantity,idempotencyKey:crypto.randomUUID() }), 'Retail/consumable conversion posted without value change');
    if (!this.error) this.conversionDraft={ inventoryItemId:'',sourceBucket:'retail_available',destinationBucket:'consumable_available',quantity:null,employeeId:'',comment:'' };
  }

  async reverseMovement(id:string) {
    const comment=await this.dialogs.prompt('Reversal reason', { required:true, multiline:true });
    if (!comment) return;
    await this.action(() => this.backbar.reverseMovement(id,comment), 'Operational movement reversed');
  }

  async transferCustody(row:BackbarContainer) {
    const draft=this.custodyDraft[row.id];
    if (!draft?.locationCode || !draft.reason.trim()) { this.error='Target location and custody reason are required'; return; }
    await this.action(() => this.backbar.transferCustody(row.id,{ toLocationCode:draft.locationCode,toStaffId:draft.staffId||null,reason:draft.reason.trim(),idempotencyKey:crypto.randomUUID() }), 'Container custody transferred');
  }

  async submitFloorClosing() {
    if (!this.closingDate || !this.closingShift.trim()) { this.error='Business date and shift are required'; return; }
    const lines=[] as Array<{containerId:string;countedRemaining:number;reason:string}>;
    for (const row of this.openContainers) {
      const counted=Number(this.closingCount[row.id]); const reason=(this.closingReason[row.id]||'').trim();
      if (!Number.isInteger(counted) || counted<0 || counted>row.capacityQuantity || (counted!==row.remainingQuantity && !reason)) { this.error=`Valid count and variance reason required for ${row.productName}`; return; }
      lines.push({containerId:row.id,countedRemaining:counted,reason});
    }
    await this.action(() => this.backbar.createFloorClosing({ businessDate:this.closingDate,shiftLabel:this.closingShift.trim(),lines,idempotencyKey:crypto.randomUUID() }), 'Floor closing recorded');
    if (!this.error) { this.closingShift=''; this.closingReason={}; }
  }

  async reviewFloorClosing(row:FloorClosing,decision:'approve'|'reject') {
    const reviewNote=decision==='reject' ? await this.dialogs.prompt('Rejection reason', { required:true, multiline:true }) : '';
    if (decision==='reject' && !reviewNote) return;
    await this.action(() => this.backbar.reviewFloorClosing(row.id,{decision,reviewNote:reviewNote||'',idempotencyKey:crypto.randomUUID()}),`Floor closing ${decision}d`);
  }

  scan() {
    const code = this.scanCode.trim().toLowerCase();
    if (!code) return;
    const row = this.containers.find((candidate) => candidate.barcode.toLowerCase() === code || candidate.id.toLowerCase() === code);
    if (!row) { this.error = 'Container barcode was not found in this branch'; return; }
    this.search = row.barcode; this.status = ''; this.activeTab = 'containers'; this.selectedContainerId = row.id; this.notice = `${row.productName} container selected`;
  }

  async openProduct360(productId: string) {
    this.selectedProductId = productId;
    if (!productId) { this.product360 = null; return; }
    this.productLoading = true; this.productDrawerOpen = true; this.clearFeedback();
    try { this.product360 = await this.backbar.product360(productId); }
    catch (error) { this.error = this.message(error, 'Unable to load Product 360'); this.product360 = null; }
    finally { this.productLoading = false; }
  }

  productSelectionChanged() { if (this.selectedProductId) void this.openProduct360(this.selectedProductId); else this.product360 = null; }
  date(value?: string) { return value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
  quantity(value: number, unit = '') { return `${Number(value || 0).toLocaleString('en-IN')} ${unit}`.trim(); }
  money(value:number) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Number(value||0)/100); }
  statusLabel(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()); }
  totalVariance(row:FloorClosing) { return row.lines.reduce((total,line) => total + line.varianceQuantity, 0); }

  private async action(run: () => Promise<unknown>, notice: string) {
    this.saving = true; this.clearFeedback();
    try { await run(); await this.load(); this.notice = notice; }
    catch (error) { const message = this.message(error, notice); await this.load(); this.error = message; }
    finally { this.saving = false; }
  }
  private emptyDraft() { return { inventoryItemId: '', barcode: '', capacityQuantity: null as number | null, unit: '' }; }
  private message(error: any, fallback: string) { return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? fallback; }
  private clearFeedback() { this.error = ''; this.notice = ''; }
}
