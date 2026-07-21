import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';
import english from './catalogs/en-in';

export type LanguageCode = 'en-IN' | 'hi-IN';
export type LanguageDisplayMode = 'single' | 'bilingual';
export type TranslationParams = Record<string, string | number>;

export interface LanguagePreferences {
  primary: LanguageCode;
  secondary?: LanguageCode;
  mode: LanguageDisplayMode;
  currency: string;
  timeZone: string;
  region: string;
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  numberLocale: LanguageCode;
}

export interface TenantLanguageSettings {
  primaryLanguage: LanguageCode;
  secondaryLanguage?: LanguageCode;
  displayMode: LanguageDisplayMode;
  region: string;
  currency: string;
  timeZone: string;
  dateFormat: LanguagePreferences['dateFormat'];
  numberLocale: LanguageCode;
  allowUserOverride: boolean;
}

export interface UserLanguagePreference {
  primaryLanguage: LanguageCode;
  secondaryLanguage?: LanguageCode;
  displayMode: LanguageDisplayMode;
}

export interface LanguageSettingsView {
  tenantDefault: TenantLanguageSettings;
  userPreference?: UserLanguagePreference;
  effective: TenantLanguageSettings;
  source: 'user' | 'tenant' | 'english';
  canManageTenant: boolean;
}

type Catalog = Readonly<Record<string, string>>;

const DEFAULT_PREFERENCES: LanguagePreferences = {
  primary: 'en-IN',
  mode: 'single',
  currency: 'INR',
  timeZone: 'Asia/Kolkata',
  region: 'IN',
  dateFormat: 'DD/MM/YYYY',
  numberLocale: 'en-IN',
};

const LANGUAGE_LOADERS: Partial<Record<LanguageCode, () => Promise<Catalog>>> = {
  'hi-IN': () => import('./catalogs/hi-in').then(({ default: catalog }) => catalog),
};

const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ps', 'sd', 'ug', 'ur', 'yi']);

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly document = inject(DOCUMENT);
  private readonly api = inject(ApiService);
  private readonly preferencesState = signal<LanguagePreferences>(DEFAULT_PREFERENCES);
  private readonly settingsState = signal<LanguageSettingsView | null>(null);
  private readonly catalogs = new Map<LanguageCode, Catalog>([['en-IN', english]]);
  private loadRequest?: Promise<LanguageSettingsView>;

  readonly preferences = this.preferencesState.asReadonly();
  readonly settings = this.settingsState.asReadonly();
  readonly locale = computed(() => this.preferencesState().primary);
  readonly direction = computed<'ltr' | 'rtl'>(() => this.directionFor(this.locale()));

  constructor() {
    this.applyDocumentLocale();
  }

  async configure(preferences: Partial<LanguagePreferences>): Promise<void> {
    const next = this.normalize({ ...this.preferencesState(), ...preferences });
    await Promise.all([this.load(next.primary), next.secondary ? this.load(next.secondary) : Promise.resolve()]);
    this.preferencesState.set(next);
    this.applyDocumentLocale();
  }

  async loadSettings(force = false): Promise<LanguageSettingsView> {
    if (!force && this.settingsState()) return this.settingsState()!;
    if (!force && this.loadRequest) return this.loadRequest;
    this.loadRequest = firstValueFrom(this.api.get<ApiEnvelope<LanguageSettingsView>>('/settings/language'))
      .then((response) => this.acceptSettings(response))
      .finally(() => { this.loadRequest = undefined; });
    return this.loadRequest;
  }

  async saveUserPreference(preference: UserLanguagePreference): Promise<LanguageSettingsView> {
    const response = await firstValueFrom(this.api.patch<ApiEnvelope<LanguageSettingsView>>('/settings/language/me', preference));
    return this.acceptSettings(response);
  }

  async saveTenantSettings(settings: TenantLanguageSettings): Promise<LanguageSettingsView> {
    const response = await firstValueFrom(this.api.patch<ApiEnvelope<LanguageSettingsView>>('/settings/language/tenant', settings));
    return this.acceptSettings(response);
  }

  directionFor(locale: string): 'ltr' | 'rtl' {
    return this.isRtl(locale) ? 'rtl' : 'ltr';
  }

  text(key: string, params: TranslationParams = {}): string {
    const preferences = this.preferencesState();
    const primary = this.lookup(preferences.primary, key, params);
    if (preferences.mode !== 'bilingual' || !preferences.secondary || preferences.secondary === preferences.primary) return primary;
    const secondary = this.lookup(preferences.secondary, key, params);
    return secondary === primary ? primary : `${primary} / ${secondary}`;
  }

  textValue(value: string): string {
    const key = Object.keys(english).find((candidate) => english[candidate as keyof typeof english] === value);
    return key ? this.text(key) : value;
  }

  apiError(error: any, fallbackKey = 'common.error'): string {
    const code = String(error?.error?.error?.code ?? error?.error?.code ?? '').toUpperCase();
    const key = ({
      CONFLICT: 'error.conflict',
      FORBIDDEN: 'common.permissionDenied',
      INTERNAL_ERROR: 'error.internal',
      NOT_FOUND: 'error.notFound',
      RATE_LIMITED: 'error.rateLimited',
      UNAUTHENTICATED: 'error.unauthenticated',
      VALIDATION_FAILED: 'error.validation',
    } as Record<string, string>)[code];
    return this.text(key || fallbackKey);
  }

  formatDate(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}): string {
    const preferences = this.preferencesState();
    const parts = new Intl.DateTimeFormat(this.locale(), { timeZone: preferences.timeZone, day: '2-digit', month: '2-digit', year: 'numeric', ...options }).formatToParts(new Date(value));
    if (Object.keys(options).length) return new Intl.DateTimeFormat(this.locale(), { timeZone: preferences.timeZone, ...options }).format(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
    if (preferences.dateFormat === 'MM/DD/YYYY') return `${part('month')}/${part('day')}/${part('year')}`;
    if (preferences.dateFormat === 'YYYY-MM-DD') return `${part('year')}-${part('month')}-${part('day')}`;
    return `${part('day')}/${part('month')}/${part('year')}`;
  }

  formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
    return new Intl.NumberFormat(this.preferencesState().numberLocale, options).format(value);
  }

  formatCurrency(value: number, options: Intl.NumberFormatOptions = {}): string {
    return new Intl.NumberFormat(this.locale(), {
      style: 'currency',
      currency: this.preferencesState().currency,
      ...options,
    }).format(value);
  }

  private async load(language: LanguageCode): Promise<void> {
    if (this.catalogs.has(language)) return;
    const loader = LANGUAGE_LOADERS[language];
    if (loader) this.catalogs.set(language, await loader());
  }

  private async acceptSettings(response: ApiEnvelope<LanguageSettingsView>): Promise<LanguageSettingsView> {
    if (!response.success || !response.data) throw new Error(response.error?.message || 'Unable to load language settings');
    const view = response.data;
    await this.configure({
      primary: view.effective.primaryLanguage,
      secondary: view.effective.secondaryLanguage,
      mode: view.effective.displayMode,
      currency: view.effective.currency,
      timeZone: view.effective.timeZone,
      region: view.effective.region,
      dateFormat: view.effective.dateFormat,
      numberLocale: view.effective.numberLocale,
    });
    this.settingsState.set(view);
    return view;
  }

  private lookup(language: LanguageCode, key: string, params: TranslationParams): string {
    const template = this.catalogs.get(language)?.[key] ?? english[key as keyof typeof english] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
  }

  private normalize(preferences: LanguagePreferences): LanguagePreferences {
    return {
      ...preferences,
      secondary: preferences.mode === 'bilingual' ? preferences.secondary : undefined,
      currency: preferences.currency.trim().toUpperCase() || DEFAULT_PREFERENCES.currency,
      timeZone: preferences.timeZone.trim() || DEFAULT_PREFERENCES.timeZone,
    };
  }

  private applyDocumentLocale(): void {
    this.document.documentElement.lang = this.locale();
    this.document.documentElement.dir = this.direction();
  }

  private isRtl(locale: string): boolean {
    return RTL_LANGUAGES.has(locale.split('-')[0].toLowerCase());
  }
}
