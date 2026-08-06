import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';

type AuditStatus = 'counting' | 'recount_required' | 'review' | 'pending_approval' | 'approved' | 'posted' | 'rejected' | 'cancelled';
type Session = { id: string; name: string; status: AuditStatus; businessDate:string; auditScope:'full'|'cycle'; productScope:'all'|'retail'|'consumable'; unauditedPolicy:string; currentRound:number; blindCounting: boolean; requiredCounters: number; recountThreshold: number; cutoffAt: string; createdBy:string; submittedBy?:string; reconciledBy?:string; approvedBy?:string; rejectionReason:string; floorClosingId?:string; createdAt: string };
type MovementSummary = { openingQuantity: number; purchaseQuantity: number; purchaseReturnQuantity: number; transferInQuantity: number; transferOutQuantity: number; transferReversalQuantity: number; saleQuantity: number; returnQuantity: number; consumptionQuantity: number; kitComponentOutQuantity: number; kitAssemblyInQuantity: number; kitUnbundleOutQuantity: number; kitComponentInQuantity: number; adjustmentQuantity: number };
type AuditItem = { id: string; inventoryItemId: string; itemName: string; sku: string; unit: string; expectedQuantity: number | null; expectedUnitCostPaise?: number | null; expectedValuePaise?: number | null; expectedSourceLedgerId?: string | null; expectedLedgerMovementCount?: number | null; expectedProvenanceStatus?: 'verified_ledger' | 'opening_baseline' | 'legacy_snapshot' | null; expectedMovementSummary?: MovementSummary | null; auditSource:'pending'|'manual'|'projected'|'zero'|'excluded'; includedInReconciliation:boolean; approvedQuantity: number | null; varianceQuantity: number | null; countedValuePaise?: number | null; varianceValuePaise?: number | null; varianceCauseSuggestion?: 'possible_missing_inbound' | 'possible_unrecorded_consumption' | 'possible_missing_sale_or_checkout' | 'unaccounted' | null; varianceReason: string; reconciliationNotes:string; postedAt: string | null };
type Detail = { session: Session; items: AuditItem[]; counts: Array<{ sessionItemId: string; counterUserId: string; roundNumber: number; countedQuantity: number; createdAt: string }>; findings: Array<{ sessionItemId: string; findingType: string; notes: string; evidence: unknown[]; createdAt: string }>; events:Array<{id:string;eventType:string;actorUserId:string;notes:string;metadata:Record<string,unknown>;createdAt:string}>; valueSummary?: { expectedValuePaise: number | null; countedValuePaise: number | null; netVarianceValuePaise: number | null; absoluteVarianceValuePaise: number | null; approvalThresholdPaise: number; ownerApprovalRequired: boolean | null } };
type InventoryOption={id:string;sku:string;name:string;unit:string;productUsage:'retail'|'consumable'|'dual_use';active:boolean};

@Component({
    selector: 'page-stock-audit',
    imports: [CommonModule, FormsModule, TranslatePipe, DatePickerComponent],
    templateUrl: './stock-audit-page.component.html',
    styleUrls: ['./stock-audit-page.component.css']
})
export class StockAuditPageComponent implements OnInit {
  private readonly language = inject(LanguageService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  sessions: Session[] = [];
  inventoryItems:InventoryOption[]=[];
  allowZeroUnauditedAudit=false;
  selected: Detail | null = null;
  loading = false;
  saving = false;
  error = '';
  notice = '';
  searchQuery = '';
  countDrafts: Record<string, number | null> = {};
  createForm = { name: '', businessDate:this.today(), auditScope:'full' as 'full'|'cycle', productScope:'all' as 'all'|'retail'|'consumable', unauditedPolicy:'require_count', itemIds:[] as string[], blindCounting: true, requiredCounters: 1, recountThreshold: 0 };
  countForm = { inventoryItemId: '', quantity: null as number | null, deviceId: this.deviceId() };
  findingForm = { itemId: '', findingType: 'variance', notes: '', evidenceReference: '' };
  rejectionReason = '';

  ngOnInit() { void Promise.all([this.load(),this.loadSetup()]); }

  async loadSetup() {
    try {
      const [items,policy]=await Promise.all([this.getAllInventoryItems(),this.get<{allowZeroUnauditedAudit?:boolean}>('/inventory/policy')]);
      this.inventoryItems=items.filter((item)=>item.active);
      this.allowZeroUnauditedAudit=policy.allowZeroUnauditedAudit===true;
    } catch (error) { this.error=this.message(error,'Failed to load audit setup'); }
  }

  async load(selectId?: string) {
    this.loading = true;
    this.clearFeedback();
    try {
      this.sessions = await this.get<Session[]>('/inventory/stock-audits');
      const target = selectId ?? this.selected?.session.id ?? this.sessions[0]?.id;
      if (target) this.selected = await this.get<Detail>(`/inventory/stock-audits/${target}`);
      else this.selected = null;
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.5057d29aab')); }
    finally { this.loading = false; }
  }

  async select(session: Session) { await this.load(session.id); }

  get visibleItems() {
    const query = this.searchQuery.trim().toLocaleLowerCase();
    if (!query || !this.selected) return this.selected?.items ?? [];
    return this.selected.items.filter((item) => `${item.itemName} ${item.sku} ${item.unit}`.toLocaleLowerCase().includes(query));
  }
  get cycleItems(){ return this.inventoryItems.filter((item)=>this.createForm.productScope==='all' || item.productUsage===this.createForm.productScope); }
  toggleCycleItem(id:string,checked:boolean){ this.createForm.itemIds=checked ? [...new Set([...this.createForm.itemIds,id])] : this.createForm.itemIds.filter((item)=>item!==id); }

  get countedProductCount() { return this.selected?.items.filter((item) => this.countFor(item) > 0).length ?? 0; }
  get hasDraftCounts() { return this.selected?.items.some((item) => this.countDrafts[item.id] !== null && this.countDrafts[item.id] !== undefined) ?? false; }

  openScanner() {
    if (!this.selected) return;
    void this.router.navigate(['/inventory/scanner'], { queryParams: { auditSessionId: this.selected.session.id } });
  }

  async saveProgress() {
    const detail = this.selected;
    if (!detail) return;
    const rows = detail.items.flatMap((item) => {
      const quantity = this.countDrafts[item.id];
      return quantity === null || quantity === undefined ? [] : [{ item, quantity: Number(quantity) }];
    });
    if (!rows.length || rows.some(({ quantity }) => !Number.isSafeInteger(quantity) || quantity < 0)) {
      this.error = 'Enter a valid whole-number count for at least one product';
      return;
    }

    this.saving = true; this.clearFeedback();
    let saved = 0;
    let failure = '';
    for (const { item, quantity } of rows) {
      try {
        await this.post<Detail>(`/inventory/stock-audits/${detail.session.id}/counts`, { inventoryItemId: item.inventoryItemId, countedQuantity: quantity, deviceId: this.countForm.deviceId, idempotencyKey: crypto.randomUUID() });
        delete this.countDrafts[item.id];
        saved += 1;
      } catch (error) {
        failure = this.message(error, 'Failed to save stock count');
        break;
      }
    }
    await this.load(detail.session.id);
    if (failure) this.error = saved ? `${saved} product counts saved. ${failure}` : failure;
    else this.notice = `${saved} product counts saved`;
    this.saving = false;
  }

  async create() {
    if (this.createForm.auditScope==='cycle' && !this.createForm.itemIds.length) { this.error='Select at least one cycle-count product'; return; }
    if (this.createForm.unauditedPolicy==='zero' && !this.canUseZeroPolicy()) { this.error='Unaudited zero-stock policy is restricted'; return; }
    this.saving = true; this.clearFeedback();
    try {
      const detail = await this.post<Detail>('/inventory/stock-audits', this.createForm);
      this.createForm = { name: '', businessDate:this.today(), auditScope:'full', productScope:'all', unauditedPolicy:'require_count', itemIds:[], blindCounting: true, requiredCounters: 1, recountThreshold: 0 };
      this.notice = this.language.text('inventory.message.c714f46c02');
      await this.load(detail.session.id);
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.a2f3b17fa2')); }
    finally { this.saving = false; }
  }
  openContainerClosing(){void this.router.navigate(['/inventory/backbar/containers']);}

  exportCsv(){
    const detail=this.selected; if(!detail || !this.canExportReports())return;
    const revealExpected=!detail.session.blindCounting || !this.canCount();
    const headers=['inventoryItemId','sku','productName','unit','auditSource','countedQuantity','expectedQuantity','varianceQuantity','expectedValuePaise','countedValuePaise','varianceValuePaise'];
    const rows=detail.items.map((item)=>[item.inventoryItemId,item.sku,item.itemName,item.unit,item.auditSource,item.approvedQuantity ?? '',revealExpected ? item.expectedQuantity ?? '' : '',revealExpected ? item.varianceQuantity ?? '' : '',revealExpected ? item.expectedValuePaise ?? '' : '',revealExpected ? item.countedValuePaise ?? '' : '',revealExpected ? item.varianceValuePaise ?? '' : '']);
    const csv=[headers,...rows].map((row)=>row.map((value)=>this.csvCell(String(value))).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a'); link.href=url; link.download=`stock-audit-${detail.session.businessDate}-${detail.session.id}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  async importCsv(event:Event){
    const input=event.target as HTMLInputElement; const file=input.files?.[0]; const detail=this.selected;
    if(!file || !detail || !this.canCount())return;
    this.saving=true; this.clearFeedback();
    try{
      const lines=(await file.text()).replace(/^\uFEFF/,'').split(/\r?\n/).filter((line)=>line.trim());
      if(lines.length<2)throw new Error('CSV has no count rows');
      const headers=this.parseCsvLine(lines[0]).map((value)=>value.trim().toLowerCase());
      const idIndex=headers.indexOf('inventoryitemid'),skuIndex=headers.indexOf('sku'),quantityIndex=headers.indexOf('countedquantity');
      if(quantityIndex<0 || (idIndex<0 && skuIndex<0))throw new Error('CSV needs inventoryItemId or sku and countedQuantity columns');
      const byId=new Map(detail.items.map((item)=>[item.inventoryItemId,item])); const bySku=new Map(detail.items.map((item)=>[item.sku.trim().toLowerCase(),item]));
      const rows=lines.slice(1).map((line)=>{ const values=this.parseCsvLine(line); const item=(idIndex>=0 ? byId.get(values[idIndex]?.trim()) : undefined) ?? (skuIndex>=0 ? bySku.get(values[skuIndex]?.trim().toLowerCase()) : undefined); const quantity=Number(values[quantityIndex]); if(!item || !Number.isSafeInteger(quantity) || quantity<0)throw new Error(`Invalid CSV count row: ${line}`); return {inventoryItemId:item.inventoryItemId,countedQuantity:quantity}; });
      if(new Set(rows.map((row)=>row.inventoryItemId)).size!==rows.length)throw new Error('CSV contains duplicate products');
      await this.post<Detail>(`/inventory/stock-audits/${detail.session.id}/counts/import`,{deviceId:this.countForm.deviceId,idempotencyKey:crypto.randomUUID(),rows});
      this.notice=`${rows.length} CSV counts imported`; await this.load(detail.session.id);
    }catch(error){this.error=this.message(error,'Failed to import stock-count CSV');}
    finally{this.saving=false;input.value='';}
  }

  async submitCount() {
    const detail = this.selected;
    if (!detail || !this.countForm.inventoryItemId || this.countForm.quantity === null || !Number.isSafeInteger(Number(this.countForm.quantity)) || Number(this.countForm.quantity) < 0) { this.error = this.language.text('inventory.message.c16267c8cd'); return; }
    this.saving = true; this.clearFeedback();
    try {
      await this.post<Detail>(`/inventory/stock-audits/${detail.session.id}/counts`, { inventoryItemId: this.countForm.inventoryItemId, countedQuantity: Number(this.countForm.quantity), deviceId: this.countForm.deviceId, idempotencyKey: crypto.randomUUID() });
      this.countForm = { ...this.countForm, quantity: null };
      this.notice = this.language.text('inventory.message.14f753147d');
      await this.load(detail.session.id);
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.cda56c892d')); }
    finally { this.saving = false; }
  }

  async action(action: 'close-counting' | 'submit' | 'approve') {
    if (!this.selected) return;
    this.saving = true; this.clearFeedback();
    try { await this.post<Detail>(`/inventory/stock-audits/${this.selected.session.id}/${action}`, {}); this.notice = action === 'approve' ? 'Adjustment posted to stock ledger and GL' : 'Stock audit updated'; await this.load(this.selected.session.id); }
    catch (error) { this.error = this.message(error, this.language.text('inventory.message.a5449370e6')); }
    finally { this.saving = false; }
  }

  async saveReconciliation(item:AuditItem){
    if(!this.selected || item.approvedQuantity===null || !Number.isSafeInteger(Number(item.approvedQuantity)) || Number(item.approvedQuantity)<0){this.error='Enter a valid reconciled quantity';return;}
    this.saving=true;this.clearFeedback();
    try{await firstValueFrom(this.api.patch(`/inventory/stock-audits/${this.selected.session.id}/items/${item.inventoryItemId}/reconciliation`,{reconciledQuantity:Number(item.approvedQuantity),reason:item.varianceReason.trim(),notes:item.reconciliationNotes.trim()}));this.notice='Reconciliation saved';await this.load(this.selected.session.id);}
    catch(error){this.error=this.message(error,'Failed to save reconciliation');}
    finally{this.saving=false;}
  }

  async addFinding() {
    if (!this.selected || !this.findingForm.itemId) { this.error = this.language.text('inventory.message.4045e3633e'); return; }
    const reference = this.findingForm.evidenceReference.trim();
    if ((this.findingForm.findingType === 'leakage' || this.findingForm.findingType === 'theft') && !reference) { this.error = this.language.text('inventory.message.50f9c2cded'); return; }
    this.saving = true; this.clearFeedback();
    try {
      await this.post<Detail>(`/inventory/stock-audits/${this.selected.session.id}/items/${this.findingForm.itemId}/findings`, { findingType: this.findingForm.findingType, notes: this.findingForm.notes, evidence: reference ? [{ reference }] : [] });
      this.findingForm = { itemId: '', findingType: 'variance', notes: '', evidenceReference: '' };
      this.notice = this.language.text('inventory.message.2d9631d272'); await this.load(this.selected.session.id);
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.3fffb72492')); }
    finally { this.saving = false; }
  }

  async reject() {
    if (!this.selected || !this.rejectionReason.trim()) { this.error = this.language.text('inventory.message.dd4e16ac15'); return; }
    this.saving = true; this.clearFeedback();
    try { await this.post<Detail>(`/inventory/stock-audits/${this.selected.session.id}/reject`, { reason: this.rejectionReason.trim() }); this.rejectionReason = ''; this.notice = this.language.text('inventory.message.c512fa8f7e'); await this.load(this.selected.session.id); }
    catch (error) { this.error = this.message(error, this.language.text('inventory.message.9d50b30fe8')); }
    finally { this.saving = false; }
  }

  async resubmit(){if(!this.selected)return;this.saving=true;this.clearFeedback();try{await this.post<Detail>(`/inventory/stock-audits/${this.selected.session.id}/resubmit`,{});this.notice='Audit reopened for recount';await this.load(this.selected.session.id);}catch(error){this.error=this.message(error,'Failed to resubmit audit');}finally{this.saving=false;}}

  countFor(item: AuditItem) { return this.selected?.counts.filter((row) => row.sessionItemId === item.id && row.roundNumber===this.selected?.session.currentRound).length ?? 0; }
  provenanceLabel(item: AuditItem) {
    if (item.expectedProvenanceStatus === 'verified_ledger') return `Ledger verified · ${item.expectedLedgerMovementCount ?? 0} movements`;
    if (item.expectedProvenanceStatus === 'opening_baseline') return 'Opening baseline · no ledger movements';
    if (item.expectedProvenanceStatus === 'legacy_snapshot') return 'Legacy snapshot · evidence review required';
    return '';
  }
  movementBreakdown(item: AuditItem) {
    const summary = item.expectedMovementSummary;
    if (!summary) return [];
    return [
      ['Opening / carry-forward', summary.openingQuantity],
      ['Purchases', summary.purchaseQuantity],
      ['Purchase returns', summary.purchaseReturnQuantity],
      ['Transfers in', summary.transferInQuantity],
      ['Transfers out', summary.transferOutQuantity],
      ['Transfer reversals', summary.transferReversalQuantity],
      ['POS sales / checkout', summary.saleQuantity],
      ['Product returns / restock', summary.returnQuantity],
      ['Service consumption', summary.consumptionQuantity],
      ['Kit components', summary.kitComponentOutQuantity],
      ['Kit assemblies', summary.kitAssemblyInQuantity],
      ['Kits unbundled', summary.kitUnbundleOutQuantity],
      ['Unbundled components', summary.kitComponentInQuantity],
      ['Adjustments / discard', summary.adjustmentQuantity],
    ].filter((row, index) => index === 0 || row[1] !== 0) as Array<[string, number]>;
  }
  causeLabel(cause: AuditItem['varianceCauseSuggestion']) {
    if (!cause) return '';
    return ({
      possible_missing_inbound: 'Possible missing inbound',
      possible_unrecorded_consumption: 'Possible unrecorded consumption',
      possible_missing_sale_or_checkout: 'Possible missing sale / checkout',
      unaccounted: 'Unaccounted — investigate',
    } as const)[cause];
  }
  canManage() { return this.auth.hasAccess(['owner', 'admin', 'manager', 'inventory manager', 'inventory_manager', 'inventoryManager'], ['inventory.manage', 'inventory.write']); }
  canCount() { return this.canManage() && !!this.selected && ['counting', 'recount_required'].includes(this.selected.session.status); }
  canReview() { return this.canManage() && this.selected?.session.status === 'review'; }
  canApprove() { return this.auth.hasAccess(['owner'], ['inventory.approve']) && this.selected?.session.status === 'pending_approval'; }
  canExportReports() { return this.auth.hasAccess(['owner','admin'],['reports.export']); }
  canUseZeroPolicy(){return this.allowZeroUnauditedAudit && this.auth.hasAccess(['owner','admin'],['inventory.approve']);}
  money(paise: number | null | undefined) { return paise == null ? '—' : this.language.formatCurrency(paise / 100); }
  private async get<T>(path: string) { const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path)); if (response.data === undefined) throw new Error('API response did not contain data'); return response.data; }
  private async getAllInventoryItems() {
    const rows: InventoryOption[] = [];
    const pageSize = 200;
    for (let page = 1; ; page++) {
      const batch = await this.get<InventoryOption[]>(`/inventory?page=${page}&pageSize=${pageSize}&withCount=false`);
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
    }
  }
  private async post<T>(path: string, body: unknown) { const response = await firstValueFrom(this.api.post<ApiEnvelope<T>>(path, body)); if (response.data === undefined) throw new Error('API response did not contain data'); return response.data; }
  private clearFeedback() { this.error = ''; this.notice = ''; }
  private today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
  private csvCell(value:string){return /[",\r\n]/.test(value) ? `"${value.replaceAll('"','""')}"` : value;}
  private parseCsvLine(line:string){const cells:string[]=[];let value='',quoted=false;for(let index=0;index<line.length;index++){const char=line[index];if(char==='"'){if(quoted&&line[index+1]==='"'){value+='"';index++;}else quoted=!quoted;}else if(char===','&&!quoted){cells.push(value);value='';}else value+=char;}if(quoted)throw new Error('CSV contains an unmatched quote');cells.push(value);return cells;}
  private deviceId() { const key = 'aurashine.inventory.scanner.device.v1'; const existing = localStorage.getItem(key); if (existing) return existing; const value = crypto.randomUUID(); localStorage.setItem(key, value); return value; }
  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.error || error?.error?.message || error?.message || fallback; }
}
