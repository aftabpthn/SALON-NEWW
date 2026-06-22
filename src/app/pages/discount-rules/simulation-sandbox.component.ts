import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../../core/api.service';

type CartItem = {
  itemId: string;
  name: string;
  serviceId: string;
  categoryId: string;
  pricePaise: number;
  costPaise?: number;
  qty: number;
};

type SimulationResult = ApiRecord & {
  grossPaise: number;
  projectedDiscountPaise: number;
  payablePaise: number;
  attemptedDiscountPaise: number;
  matchedRules: ApiRecord[];
  breakdown: ApiRecord[];
  marginImpact: ApiRecord;
  blocked?: boolean;
  blockReason?: string | null;
};

type DigitalTwinResult = ApiRecord & {
  blocked: boolean;
  blockReason?: string;
  readiness?: ApiRecord | null;
  summary?: ApiRecord;
  dataSource?: ApiRecord;
  candidates: ApiRecord[];
  recommendation?: ApiRecord | null;
  notes?: string[];
};

@Component({
  selector: 'app-discount-simulation-sandbox',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './simulation-sandbox.component.html',
  styleUrls: ['./simulation-sandbox.component.css']
})
export class DiscountSimulationSandboxComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly runningTwin = signal(false);
  readonly error = signal('');
  readonly result = signal<SimulationResult | null>(null);
  readonly digitalTwin = signal<DigitalTwinResult | null>(null);
  readonly saved = signal<ApiRecord[]>([]);

  simulationName = 'Happy Hours simulation';
  cartItems: CartItem[] = [
    { itemId: 'svc_haircut', name: 'Haircut', serviceId: 'svc_haircut', categoryId: 'hair', pricePaise: 120000, costPaise: 35000, qty: 1 },
    { itemId: 'svc_spa', name: 'Spa', serviceId: 'svc_spa', categoryId: 'spa', pricePaise: 250000, costPaise: 90000, qty: 1 }
  ];
  context: ApiRecord = {
    dayOfWeek: 5,
    hourSlot: 15,
    occupancyRate: 45,
    clientSegment: 'regular',
    weatherCondition: 'normal',
    groupSize: 1,
    minMarginPercent: 30
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.loadSaved();
  }

  get grossPaise(): number {
    return this.cartItems.reduce((sum, item) => sum + this.intPaise(item.pricePaise) * Math.max(1, Number(item.qty || 1)), 0);
  }

  addItem(): void {
    const index = this.cartItems.length + 1;
    this.cartItems = [
      ...this.cartItems,
      { itemId: `item_${index}`, name: `Service ${index}`, serviceId: `svc_${index}`, categoryId: 'hair', pricePaise: 100000, costPaise: 30000, qty: 1 }
    ];
  }

  removeItem(index: number): void {
    this.cartItems = this.cartItems.filter((_, itemIndex) => itemIndex !== index);
  }

  run(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.post<SimulationResult>('discount-simulations/run', this.payload()).subscribe({
      next: (result) => {
        this.result.set(result);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to run simulation'));
        this.loading.set(false);
      }
    });
  }

  runDigitalTwin(): void {
    this.runningTwin.set(true);
    this.error.set('');
    this.api.post<DigitalTwinResult>('discount-simulations/digital-twin', this.payload()).subscribe({
      next: (result) => {
        this.digitalTwin.set(result);
        this.runningTwin.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to run F5 digital twin'));
        this.runningTwin.set(false);
      }
    });
  }

  save(): void {
    const result = this.result();
    if (!result) {
      this.run();
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>('discount-simulations', {
      name: this.simulationName,
      ...this.payload(),
      result
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.loadSaved();
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to save simulation'));
        this.saving.set(false);
      }
    });
  }

  loadSaved(): void {
    this.api.list<{ rows: ApiRecord[] }>('discount-simulations').subscribe({
      next: (result) => this.saved.set(result.rows || []),
      error: () => this.saved.set([])
    });
  }

  loadSimulation(row: ApiRecord): void {
    this.simulationName = row.name || this.simulationName;
    this.cartItems = Array.isArray(row.cartItems) ? row.cartItems : this.cartItems;
    this.context = row.context || this.context;
    this.result.set(row.result || null);
  }

  deleteSimulation(row: ApiRecord): void {
    this.api.delete('discount-simulations', String(row.id)).subscribe({
      next: () => this.loadSaved(),
      error: (error) => this.error.set(this.errorText(error, 'Unable to delete simulation'))
    });
  }

  formatMoney(value: unknown): string {
    return `Rs ${Math.round(Number(value || 0)) / 100}`;
  }

  formatPercent(value: unknown): string {
    return `${Math.round(Number(value || 0) * 100)}%`;
  }

  private payload(): ApiRecord {
    return {
      cartItems: this.cartItems.map((item) => ({
        ...item,
        pricePaise: this.intPaise(item.pricePaise),
        costPaise: item.costPaise === undefined || item.costPaise === null ? undefined : this.intPaise(item.costPaise),
        qty: Math.max(1, Number(item.qty || 1))
      })),
      cartTotalPaise: this.grossPaise,
      ...this.context
    };
  }

  private intPaise(value: unknown): number {
    return Math.max(0, Math.round(Number(value || 0)));
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
