import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';
import { StockWorkflow, adjustedStock } from './scanner-stock';

type Workflow = 'lookup' | StockWorkflow | 'transfer';
type InventoryItem = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  stockQuantity: number;
  reorderPoint: number;
  unitCostPaise: number;
  barcode: string;
  active: boolean;
};
type ScanEvent = { code: string; workflow: Workflow; itemName: string; status: 'matched' | 'unmatched'; at: Date };

@Component({
  selector: 'page-inventory-scanner',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inventory-scanner-page.component.html',
  styleUrls: ['./inventory-scanner-page.component.css'],
})
export class InventoryScannerPageComponent implements OnDestroy {
  @ViewChild('camera') camera?: ElementRef<HTMLVideoElement>;
  private readonly api = inject(ApiService);
  private stream?: MediaStream;
  private detector?: { detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>> };
  private detectionFrame = 0;

  readonly workflows: Array<{ id: Workflow; label: string }> = [
    { id: 'lookup', label: 'Lookup' },
    { id: 'receive', label: 'Receive' },
    { id: 'count', label: 'Count' },
    { id: 'waste', label: 'Waste' },
    { id: 'transfer', label: 'Transfer' },
  ];
  workflow: Workflow = 'lookup';
  code = '';
  matched: InventoryItem | null = null;
  history: ScanEvent[] = [];
  historyOpen = false;
  loading = false;
  saving = false;
  cameraActive = false;
  error = '';
  notice = '';
  quantity: number | null = null;
  notes = '';
  destinationBranchId = '';
  destinationInventoryItemId = '';

  ngOnDestroy() { this.stopCamera(); }

  setWorkflow(workflow: Workflow) {
    this.workflow = workflow;
    this.historyOpen = false;
    this.quantity = null;
    this.notes = '';
    this.destinationBranchId = '';
    this.destinationInventoryItemId = '';
    this.clearFeedback();
  }

  async match(record = true) {
    const code = this.code.trim();
    if (!code) { this.error = 'SKU or barcode is required'; return; }
    this.loading = true;
    this.clearFeedback();
    try {
      const rows = await this.get<InventoryItem[]>(`/inventory?q=${encodeURIComponent(code)}&pageSize=200`);
      const normalized = code.toLowerCase();
      this.matched = rows.find((item) => item.sku.trim().toLowerCase() === normalized || item.barcode.trim().toLowerCase() === normalized || item.id.toLowerCase() === normalized) ?? null;
      if (record) this.addHistory(code, this.matched);
      this.notice = this.matched ? `${this.matched.name} matched` : '';
      if (!this.matched) this.error = 'No product matched';
    } catch (error) {
      this.matched = null;
      this.error = this.message(error, 'Product lookup failed');
    } finally {
      this.loading = false;
    }
  }

  async applyWorkflow() {
    const item = this.matched;
    if (!item || this.workflow === 'lookup') return;
    this.clearFeedback();
    this.saving = true;
    try {
      if (this.workflow === 'transfer') {
        const quantity = this.validQuantity(false);
        if (!this.destinationBranchId.trim() || !this.destinationInventoryItemId.trim()) throw new Error('Destination branch and item ID are required');
        await firstValueFrom(this.api.post('/inventory/transfers', {
          destinationBranchId: this.destinationBranchId.trim(),
          notes: this.notes.trim() || 'Scanner transfer',
          idempotencyKey: crypto.randomUUID(),
          lines: [{ sourceInventoryItemId: item.id, destinationInventoryItemId: this.destinationInventoryItemId.trim(), quantity }],
        }));
      } else {
        const quantity = this.validQuantity(this.workflow === 'count');
        const stockQuantity = adjustedStock(item.stockQuantity, this.workflow, quantity);
        await firstValueFrom(this.api.patch(`/inventory/${item.id}`, {
          stockQuantity,
          adjustmentReason: this.notes.trim() || `Scanner ${this.workflow}`,
          idempotencyKey: crypto.randomUUID(),
        }));
      }
      const label = this.workflows.find((row) => row.id === this.workflow)?.label ?? this.workflow;
      await this.match(false);
      this.quantity = null;
      this.notice = `${label} saved`;
    } catch (error) {
      this.error = this.message(error, 'Scanner action failed');
    } finally {
      this.saving = false;
    }
  }

  async openCamera() {
    this.clearFeedback();
    const Detector = (window as any).BarcodeDetector;
    if (!navigator.mediaDevices?.getUserMedia || !Detector) {
      this.error = 'Camera barcode scanning is not supported in this browser';
      return;
    }
    try {
      this.cameraActive = true;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      const video = this.camera?.nativeElement;
      if (!video) throw new Error('Camera preview is unavailable');
      video.srcObject = this.stream;
      await video.play();
      this.detector = new Detector();
      this.detectCode();
    } catch (error) {
      this.stopCamera();
      this.error = this.message(error, 'Camera could not be opened');
    }
  }

  stopCamera() {
    cancelAnimationFrame(this.detectionFrame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.detector = undefined;
    this.cameraActive = false;
  }

  money(paise: number) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((paise || 0) / 100);
  }

  private async detectCode() {
    if (!this.cameraActive || !this.detector || !this.camera?.nativeElement) return;
    try {
      const result = await this.detector.detect(this.camera.nativeElement);
      const code = result[0]?.rawValue?.trim();
      if (code) {
        this.code = code;
        this.stopCamera();
        await this.match();
        return;
      }
    } catch { /* retry while the camera is active */ }
    this.detectionFrame = requestAnimationFrame(() => this.detectCode());
  }

  private validQuantity(allowZero: boolean) {
    if (this.quantity === null) throw new Error('Valid whole quantity is required');
    const quantity = Number(this.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0 || (!allowZero && quantity === 0)) throw new Error('Valid whole quantity is required');
    return quantity;
  }

  private addHistory(code: string, item: InventoryItem | null) {
    const event: ScanEvent = { code, workflow: this.workflow, itemName: item?.name ?? '', status: item ? 'matched' : 'unmatched', at: new Date() };
    this.history = [event, ...this.history].slice(0, 20);
  }

  private async get<T>(path: string) {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<T>>(path));
    if (response.data === undefined) throw new Error('API response did not contain data');
    return response.data;
  }

  private clearFeedback() { this.error = ''; this.notice = ''; }
  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.error || error?.error?.message || error?.message || fallback; }
}
