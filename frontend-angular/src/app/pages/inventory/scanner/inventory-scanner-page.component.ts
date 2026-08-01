import { LanguageService } from '../../../core/i18n/language.service';
import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { StockWorkflow, adjustedStock } from './scanner-stock';
import { AuthBranchAccess, AuthService } from '../../../core/services/auth.service';

type Workflow = 'lookup' | StockWorkflow | 'transfer';
type InventoryItem = { id: string; sku: string; name: string; category: string; unit: string; stockQuantity: number; reorderPoint: number; unitCostPaise: number; barcode: string; active: boolean };
type ScanEvent = { code: string; workflow: Workflow; itemName: string; status: 'matched' | 'unmatched'; at: Date };
type AuditSession = { id: string; name: string; status: string };
type PersistedEvent = { code: string; workflow: Workflow; result: 'matched' | 'unmatched'; receivedAt: string };
type ScanPayload = { deviceId: string; workflow: Workflow; code: string; clientEventId: string; capturedAt: string };
type ScanResolution = { event: { inventoryItemId: string | null }; aliasType: string; targetId: string };
const OFFLINE_QUEUE_KEY = 'aurashine.inventory.scanner.queue.v1';
const DEVICE_KEY = 'aurashine.inventory.scanner.device.v1';

@Component({
    selector: 'page-inventory-scanner', imports: [CommonModule, FormsModule, TranslatePipe], templateUrl: './inventory-scanner-page.component.html', styleUrls: ['./inventory-scanner-page.component.css']
})
export class InventoryScannerPageComponent implements OnInit, OnDestroy {
  private readonly language = inject(LanguageService);
  @ViewChild('camera') camera?: ElementRef<HTMLVideoElement>;
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private stream?: MediaStream;
  private detector?: { detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>> };
  private detectionFrame = 0;
  private readonly onlineHandler = () => { void this.replayOfflineQueue(); };
  readonly workflows: Array<{ id: Workflow; label: string }> = [{ id: 'lookup', label: 'Lookup' }, { id: 'receive', label: 'Receive' }, { id: 'count', label: 'Count' }, { id: 'waste', label: 'Waste' }, { id: 'transfer', label: 'Transfer' }];
  workflow: Workflow = 'lookup'; code = ''; matched: InventoryItem | null = null; history: ScanEvent[] = []; audits: AuditSession[] = []; branches: AuthBranchAccess[] = [];
  historyOpen = false; loading = false; saving = false; cameraActive = false; error = ''; notice = ''; quantity: number | null = null; notes = ''; destinationBranchId = ''; destinationInventoryItemId = ''; auditSessionId = '';

  ngOnInit() {
    const auditSessionId = this.route.snapshot.queryParamMap.get('auditSessionId');
    if (auditSessionId) { this.auditSessionId = auditSessionId; this.workflow = 'count'; }
    window.addEventListener('online', this.onlineHandler); void this.loadScannerState(); void firstValueFrom(this.auth.loadProfile()).then((profile) => { this.branches = profile.branches; }).catch(() => undefined);
  }
  ngOnDestroy() { window.removeEventListener('online', this.onlineHandler); this.stopCamera(); }

  async loadScannerState() {
    try {
      const [events, audits] = await Promise.all([this.get<PersistedEvent[]>('/inventory/scanner-events'), this.get<AuditSession[]>('/inventory/stock-audits')]);
      this.history = events.map((row) => ({ code: row.code, workflow: row.workflow, itemName: row.result === 'matched' ? 'Matched product' : '', status: this.scanStatus(row.result), at: new Date(row.receivedAt) }));
      this.audits = audits.filter((row) => row.status === 'counting' || row.status === 'recount_required');
      if (this.auditSessionId && !this.audits.some((row) => row.id === this.auditSessionId)) this.auditSessionId = '';
      if (!this.auditSessionId && this.audits.length === 1) this.auditSessionId = this.audits[0].id;
      await this.replayOfflineQueue();
    } catch { /* scanner remains usable; the next online scan will retry */ }
  }

  setWorkflow(workflow: Workflow) { this.workflow = workflow; this.historyOpen = false; this.quantity = null; this.notes = ''; this.destinationBranchId = ''; this.destinationInventoryItemId = ''; this.clearFeedback(); }

  async match(record = true) {
    const code = this.code.trim(); if (!code) { this.error = this.language.text('inventory.message.43fdc3ee4d'); return; }
    this.loading = true; this.clearFeedback();
    try {
      const persisted = record ? await this.persistScan(code) : null;
      const rows = await this.get<InventoryItem[]>(`/inventory?page=1&pageSize=200&withCount=false&q=${encodeURIComponent(code)}`);
      const normalized = code.toLowerCase();
      const localMatch = rows.find((item) => item.sku.trim().toLowerCase() === normalized || item.barcode.trim().toLowerCase() === normalized || item.id.toLowerCase() === normalized) ?? null;
      this.matched = persisted?.event.inventoryItemId
        ? rows.find((item) => item.id === persisted.event.inventoryItemId) ?? await this.get<InventoryItem>(`/inventory/${persisted.event.inventoryItemId}`)
        : localMatch;
      this.addHistory(code, this.matched);
      this.notice = this.matched ? `${this.matched.name} matched` : '';
      if (!this.matched) this.error = this.language.text('inventory.message.d7aa2bb20f');
    } catch (error) { this.matched = null; this.error = this.message(error, this.language.text('inventory.message.b5a1a12f0b')); }
    finally { this.loading = false; }
  }

  async applyWorkflow() {
    const item = this.matched; if (!item || this.workflow === 'lookup') return;
    this.clearFeedback(); this.saving = true;
    try {
      if (this.workflow === 'transfer') {
        const quantity = this.validQuantity(false);
        if (!this.destinationBranchId.trim() || !this.destinationInventoryItemId.trim()) throw new Error('Destination branch and item ID are required');
        await firstValueFrom(this.api.post('/inventory/transfers', { mode:'push', destinationBranchId: this.destinationBranchId.trim(), notes: this.notes.trim() || 'Scanner transfer draft', idempotencyKey: crypto.randomUUID(), lines: [{ sourceInventoryItemId: item.id, destinationInventoryItemId: this.destinationInventoryItemId.trim(), quantity }] }));
      } else if (this.workflow === 'count') {
        const quantity = this.validQuantity(true);
        if (!this.auditSessionId) throw new Error('Select an active stock audit session for this count');
        await firstValueFrom(this.api.post(`/inventory/stock-audits/${this.auditSessionId}/counts`, { inventoryItemId: item.id, countedQuantity: quantity, deviceId: this.deviceId(), idempotencyKey: crypto.randomUUID() }));
      } else {
        const quantity = this.validQuantity(false); const stockQuantity = adjustedStock(item.stockQuantity, this.workflow, quantity);
        await firstValueFrom(this.api.patch(`/inventory/${item.id}`, { stockQuantity, adjustmentReason: this.notes.trim() || `Scanner ${this.workflow}`, idempotencyKey: crypto.randomUUID() }));
      }
      const label = this.workflow === 'transfer' ? 'Transfer draft' : this.workflows.find((row) => row.id === this.workflow)?.label ?? this.workflow;
      await this.match(false); this.quantity = null; this.notice = `${label} saved`;
    } catch (error) { this.error = this.message(error, this.language.text('inventory.message.4d12d6a31f')); }
    finally { this.saving = false; }
  }

  async openCamera() {
    this.clearFeedback(); const Detector = (window as any).BarcodeDetector;
    if (!navigator.mediaDevices?.getUserMedia || !Detector) { this.error = this.language.text('inventory.message.c28f3ea6a7'); return; }
    try { this.cameraActive = true; await new Promise((resolve) => requestAnimationFrame(resolve)); this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); const video = this.camera?.nativeElement; if (!video) throw new Error('Camera preview is unavailable'); video.srcObject = this.stream; await video.play(); this.detector = new Detector(); this.detectCode(); }
    catch (error) { this.stopCamera(); this.error = this.message(error, this.language.text('inventory.message.50875d5051')); }
  }
  stopCamera() { cancelAnimationFrame(this.detectionFrame); this.stream?.getTracks().forEach((track) => track.stop()); this.stream = undefined; this.detector = undefined; this.cameraActive = false; }
  money(paise: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((paise || 0) / 100); }
  private async detectCode() { if (!this.cameraActive || !this.detector || !this.camera?.nativeElement) return; try { const result = await this.detector.detect(this.camera.nativeElement); const code = result[0]?.rawValue?.trim(); if (code) { this.code = code; this.stopCamera(); await this.match(); return; } } catch { /* retry while active */ } this.detectionFrame = requestAnimationFrame(() => this.detectCode()); }
  private validQuantity(allowZero: boolean) { if (this.quantity === null) throw new Error('Valid whole quantity is required'); const quantity = Number(this.quantity); if (!Number.isSafeInteger(quantity) || quantity < 0 || (!allowZero && quantity === 0)) throw new Error('Valid whole quantity is required'); return quantity; }
  private async persistScan(code: string): Promise<ScanResolution | null> {
    const payload: ScanPayload = { deviceId: this.deviceId(), workflow: this.workflow, code, clientEventId: crypto.randomUUID(), capturedAt: new Date().toISOString() };
    if (!navigator.onLine) { this.enqueue(payload); this.notice = this.language.text('inventory.message.08d63ad705'); return null; }
    try { return await this.post<ScanResolution>('/inventory/scanner-events', payload); }
    catch (error) { if (this.isOffline(error)) { this.enqueue(payload); this.notice = this.language.text('inventory.message.08d63ad705'); return null; } throw error; }
  }
  private async replayOfflineQueue() {
    if (!navigator.onLine) return;
    const queued = this.queue(); if (!queued.length) return;
    const remaining: ScanPayload[] = [];
    for (const payload of queued) { try { await this.post('/inventory/scanner-events', payload); } catch { remaining.push(payload); } }
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    if (!remaining.length) await this.loadHistoryOnly();
  }
  private async loadHistoryOnly() { const events = await this.get<PersistedEvent[]>('/inventory/scanner-events'); this.history = events.map((row) => ({ code: row.code, workflow: row.workflow, itemName: row.result === 'matched' ? 'Matched product' : '', status: this.scanStatus(row.result), at: new Date(row.receivedAt) })); }
  private enqueue(payload: ScanPayload) { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify([...this.queue(), payload])); }
  private queue(): ScanPayload[] { try { const value = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
  private isOffline(error: any) { return !navigator.onLine || error?.status === 0; }
  private scanStatus(value: string): ScanEvent['status'] { return value === 'matched' ? 'matched' : 'unmatched'; }
  private deviceId() { const existing = localStorage.getItem(DEVICE_KEY); if (existing) return existing; const value = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, value); return value; }
  private addHistory(code: string, item: InventoryItem | null) { const event: ScanEvent = { code, workflow: this.workflow, itemName: item?.name ?? '', status: item ? 'matched' : 'unmatched', at: new Date() }; this.history = [event, ...this.history].slice(0, 100); }
  private async get<T>(path: string) { const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path)); if (response.data === undefined) throw new Error('API response did not contain data'); return response.data; }
  private async post<T = unknown>(path: string, body: unknown) { const response = await firstValueFrom(this.api.post<ApiEnvelope<T>>(path, body)); if (response.data === undefined) throw new Error('API response did not contain data'); return response.data; }
  private clearFeedback() { this.error = ''; this.notice = ''; }
  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.error || error?.error?.message || error?.message || fallback; }
}

