import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../../core/api.service';

type WhiteLabelSettings = {
  displayName: string;
  customerDiscountLabel: string;
  customerAppliedLabel: string;
  customerBundleLabel: string;
  customerLimitedTimeLabel: string;
  publicRuleNameFallback: string;
  hideInternalRuleNames: boolean;
  status: string;
};

@Component({
  selector: 'app-white-label-rules',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './white-label-rules.component.html',
  styleUrls: ['./white-label-rules.component.css']
})
export class WhiteLabelRulesComponent implements OnInit {
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly savedAt = signal('');
  readonly publicLabels = signal<ApiRecord | null>(null);

  settings: WhiteLabelSettings = {
    displayName: 'Happy Hours',
    customerDiscountLabel: 'Special offer',
    customerAppliedLabel: 'Offer applied',
    customerBundleLabel: 'Bundle price',
    customerLimitedTimeLabel: 'Limited-time price',
    publicRuleNameFallback: 'Salon offer',
    hideInternalRuleNames: true,
    status: 'active'
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<{ settings?: ApiRecord; publicLabels?: ApiRecord }>('white-label-rules').subscribe({
      next: (result) => {
        this.applySettings(result.settings || {});
        this.publicLabels.set(result.publicLabels || null);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to load white-label rule settings'));
        this.loading.set(false);
      }
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<{ settings?: ApiRecord; publicLabels?: ApiRecord }>('white-label-rules', this.settings).subscribe({
      next: (result) => {
        this.applySettings(result.settings || {});
        this.publicLabels.set(result.publicLabels || null);
        this.savedAt.set(new Date().toLocaleTimeString());
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.errorText(error, 'Unable to save white-label rule settings'));
        this.saving.set(false);
      }
    });
  }

  previewRuleName(): string {
    return this.settings.hideInternalRuleNames ? this.settings.publicRuleNameFallback : 'VIP Retention Rule #42';
  }

  previewLabels(): ApiRecord {
    return this.publicLabels()?.labels || {
      discountProgramName: this.settings.displayName,
      discountBadge: this.settings.customerDiscountLabel,
      discountApplied: this.settings.customerAppliedLabel,
      bundlePrice: this.settings.customerBundleLabel,
      limitedTime: this.settings.customerLimitedTimeLabel,
      ruleName: this.previewRuleName()
    };
  }

  private applySettings(settings: ApiRecord): void {
    this.settings = {
      displayName: String(settings.displayName || this.settings.displayName),
      customerDiscountLabel: String(settings.customerDiscountLabel || this.settings.customerDiscountLabel),
      customerAppliedLabel: String(settings.customerAppliedLabel || this.settings.customerAppliedLabel),
      customerBundleLabel: String(settings.customerBundleLabel || this.settings.customerBundleLabel),
      customerLimitedTimeLabel: String(settings.customerLimitedTimeLabel || this.settings.customerLimitedTimeLabel),
      publicRuleNameFallback: String(settings.publicRuleNameFallback || this.settings.publicRuleNameFallback),
      hideInternalRuleNames: settings.hideInternalRuleNames !== false,
      status: settings.status === 'paused' ? 'paused' : 'active'
    };
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { error?: string; message?: string }; message?: string };
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }
}
