import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LanguageService } from '../../../core/i18n/language.service';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type PaymentProviderRow = {
  provider: string;
  displayName: string;
  regions: string[];
  countries: string[];
  currencies: string[];
  documentationUrl: string;
  integrationStatus: 'available' | 'planned';
  recommended: boolean;
  enabled: boolean;
  webhookConfigured: boolean;
  environment: string | null;
};

type PaymentProviderApiRow = Partial<PaymentProviderRow> & Pick<PaymentProviderRow, 'provider'>;

type MerchantAccount = {
  id: string;
  provider: string;
  status: string;
  kycStatus: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  pciStatus: string;
  requirements: Record<string, unknown>;
};

type PaymentPlatformOverview = {
  accounts: MerchantAccount[];
  operations?: {
    pending?: number;
    failed?: number;
    payoutsPending?: number;
  };
  openDisputes?: number;
  providers?: Record<string, { configured?: boolean; webhookConfigured?: boolean }>;
};

@Component({
  selector: 'app-payments-integrations-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './payments-integrations-page.component.html',
  styleUrls: ['./payments-integrations-page.component.css'],
})
export class PaymentsIntegrationsPageComponent implements OnInit {
  providers: PaymentProviderRow[] = [];
  loading = true;
  error = '';
  search = '';
  country = 'IN';
  accounts: MerchantAccount[] = [];
  selectedProvider: PaymentProviderRow | null = null;
  businessName = '';
  businessType: 'company' | 'individual' | 'non_profit' = 'company';
  onboardingCurrency = 'INR';
  actionLoading = false;
  actionError = '';
  operations = { pending: 0, failed: 0, payoutsPending: 0 };
  openDisputes = 0;
  providerSetup: Record<string, { configured?: boolean; webhookConfigured?: boolean }> = {};
  private readonly countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

  constructor(
    private readonly api: ApiService,
    private readonly language: LanguageService,
  ) {}

  ngOnInit(): void {
    void this.load();
    void this.loadBusinessCountry();
  }

  get connectedCount(): number {
    return this.eligibleProviders.filter((provider) => this.isConnected(provider)).length;
  }

  get availableCount(): number {
    return this.eligibleProviders.filter((provider) => this.isAvailable(provider)).length;
  }

  get countryOptions(): string[] {
    return [...new Set(this.providers.flatMap((provider) => provider.countries).filter((code) => code !== '*'))]
      .sort((left, right) => this.countryLabel(left).localeCompare(this.countryLabel(right)));
  }

  get eligibleProviders(): PaymentProviderRow[] {
    return this.providers.filter((provider) => provider.countries.includes('*') || provider.countries.includes(this.country));
  }

  get filteredProviders(): PaymentProviderRow[] {
    const query = this.search.trim().toLowerCase();
    return this.eligibleProviders.filter((provider) => {
      const searchable = [provider.displayName, provider.provider, ...provider.regions, ...provider.currencies]
        .join(' ')
        .toLowerCase();
      return !query || searchable.includes(query);
    });
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const [response, platform] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<PaymentProviderApiRow[]>>(`/pos/payment-providers?refresh=${Date.now()}`)),
        firstValueFrom(this.api.get<ApiEnvelope<PaymentPlatformOverview>>('/pos/payment-platform/overview')),
      ]);
      this.accounts = platform.data?.accounts ?? [];
      this.operations = {
        pending: Number(platform.data?.operations?.pending) || 0,
        failed: Number(platform.data?.operations?.failed) || 0,
        payoutsPending: Number(platform.data?.operations?.payoutsPending) || 0,
      };
      this.openDisputes = Number(platform.data?.openDisputes) || 0;
      this.providerSetup = platform.data?.providers ?? {};
      this.providers = (response.data ?? []).map((provider) => ({
        provider: provider.provider,
        displayName: provider.displayName || this.titleCase(provider.provider),
        regions: Array.isArray(provider.regions) && provider.regions.length ? provider.regions : ['India'],
        countries: Array.isArray(provider.countries) && provider.countries.length ? provider.countries : ['IN'],
        currencies: Array.isArray(provider.currencies) && provider.currencies.length ? provider.currencies : ['INR'],
        documentationUrl: provider.documentationUrl || '',
        integrationStatus: provider.integrationStatus === 'planned' ? 'planned' : 'available',
        recommended: !!provider.recommended,
        enabled: this.providerSetup[provider.provider]?.configured ?? !!provider.enabled,
        webhookConfigured: this.providerSetup[provider.provider]?.webhookConfigured ?? !!provider.webhookConfigured,
        environment: provider.environment || null,
      }));
    } catch (error) {
      this.error = this.messageFor(error, 'Unable to load payment integrations');
    } finally {
      this.loading = false;
    }
  }

  isConnected(provider: PaymentProviderRow): boolean {
    if (this.isPlatformProvider(provider)) {
      const account = this.accountFor(provider);
      return !!account?.chargesEnabled && provider.webhookConfigured;
    }
    return this.isAvailable(provider) && !!provider.enabled && !!provider.webhookConfigured;
  }

  isAvailable(provider: PaymentProviderRow): boolean {
    return provider.integrationStatus === 'available';
  }

  isRecommended(provider: PaymentProviderRow): boolean {
    return provider.recommended;
  }

  providerLabel(provider: PaymentProviderRow): string {
    return provider.displayName || this.titleCase(provider.provider);
  }

  environmentLabel(value: string | null): string {
    if (!value) return 'Not applicable';
    return this.titleCase(value.replace(/[_-]+/g, ' '));
  }

  statusLabel(provider: PaymentProviderRow): string {
    if (this.isRecommended(provider)) return 'Recommended';
    if (!this.isAvailable(provider)) return 'Planned';
    return this.isConnected(provider) ? 'Connected' : 'Setup required';
  }

  statusClass(provider: PaymentProviderRow): string {
    if (this.isRecommended(provider)) return 'recommended';
    if (!this.isAvailable(provider)) return 'planned';
    return this.isConnected(provider) ? 'connected' : 'pending';
  }

  initials(provider: PaymentProviderRow): string {
    return this.providerLabel(provider).slice(0, 1).toUpperCase();
  }

  actionLabel(provider: PaymentProviderRow): string {
    return this.isConnected(provider) ? 'Manage setup' : 'Connect';
  }

  isPlatformProvider(provider: PaymentProviderRow): boolean {
    return provider.provider === 'stripe' || provider.provider === 'adyen';
  }

  accountFor(provider: PaymentProviderRow): MerchantAccount | undefined {
    return this.accounts.find((account) => account.provider === provider.provider);
  }

  openPlatformProvider(provider: PaymentProviderRow): void {
    this.selectedProvider = provider;
    this.onboardingCurrency = this.defaultCurrency(this.country);
    this.businessName = '';
    this.actionError = '';
  }

  openProvider(provider: PaymentProviderRow): void {
    this.openPlatformProvider(provider);
  }

  closeProvider(): void {
    if (this.actionLoading) return;
    this.selectedProvider = null;
    this.actionError = '';
  }

  async refreshSelectedAccount(): Promise<void> {
    const provider = this.selectedProvider;
    if (!provider) return;
    this.actionLoading = true;
    this.actionError = '';
    try {
      await firstValueFrom(this.api.post(`/pos/payment-platform/accounts/${provider.provider}/refresh`, {}));
      await this.load();
    } catch (error) {
      this.actionError = this.messageFor(error, 'Unable to refresh merchant account');
    } finally {
      this.actionLoading = false;
    }
  }

  async beginOnboarding(): Promise<void> {
    const provider = this.selectedProvider;
    if (!provider || !this.businessName.trim()) {
      this.actionError = 'Business name is required';
      return;
    }
    this.actionLoading = true;
    this.actionError = '';
    try {
      const response = await firstValueFrom(
        this.api.post<ApiEnvelope<{ onboardingUrl: string }>>('/pos/payment-platform/onboarding', {
          provider: provider.provider,
          country: this.country,
          currency: this.onboardingCurrency.trim().toUpperCase(),
          businessType: this.businessType,
          businessName: this.businessName.trim(),
        }),
      );
      const url = response.data?.onboardingUrl;
      if (!url?.startsWith('https://')) throw new Error('Provider onboarding URL was not returned');
      window.location.assign(url);
    } catch (error) {
      this.actionError = this.messageFor(error, 'Unable to start provider onboarding');
      this.actionLoading = false;
    }
  }

  canStartHostedOnboarding(provider: PaymentProviderRow): boolean {
    return this.isPlatformProvider(provider) && !this.accountFor(provider)?.chargesEnabled;
  }

  setupRows(provider: PaymentProviderRow): Array<{ label: string; ready: boolean }> {
    const rows = [
      { label: 'API credentials', ready: !!provider.enabled },
      { label: 'Webhook secret', ready: !!provider.webhookConfigured },
    ];
    if (this.isPlatformProvider(provider)) rows.push({ label: 'Merchant account', ready: !!this.accountFor(provider)?.chargesEnabled });
    return rows;
  }

  setupHint(provider: PaymentProviderRow): string {
    if (!provider.enabled) return `${provider.provider.toUpperCase()} credentials missing in backend environment`;
    if (!provider.webhookConfigured) return `${provider.provider.toUpperCase()} webhook is not configured`;
    return this.isConnected(provider) ? 'Ready for live payments' : 'Setup in progress';
  }

  updateSearch(event: Event): void {
    this.search = (event.target as HTMLInputElement).value;
  }

  updateCountry(event: Event): void {
    this.country = (event.target as HTMLSelectElement).value;
  }

  countryLabel(code: string): string {
    return this.countryNames.of(code) || code;
  }

  private async loadBusinessCountry(): Promise<void> {
    try {
      const settings = await this.language.loadSettings();
      this.country = settings.tenantDefault.region || settings.effective.region || 'IN';
    } catch {
      this.country = 'IN';
    }
  }

  private titleCase(value: string): string {
    return value
      .replace(/[_-]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  private defaultCurrency(country: string): string {
    return ({ IN: 'INR', US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', SG: 'SGD', AE: 'AED' } as Record<string, string>)[country] || 'USD';
  }

  private messageFor(error: any, fallback: string): string {
    return error?.error?.error?.message || error?.error?.message || error?.message || fallback;
  }
}
