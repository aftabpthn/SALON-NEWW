import { Injectable, computed, effect, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiRecord, ApiService } from './api.service';
import { I18nService } from './i18n.service';
import { AppStateService } from './state/app-state.service';
import { WebSocketService } from './websocket.service';
import { configureBusinessCalendar, configureWeekStart } from '../shared/date-range-presets';

export type GeneralSettingsState = {
  workspace: { workspaceName: string; defaultLandingPage: string; fastPosEnabled: boolean };
  localization: { country: string; language: string; timezone: string; currency: string; locale: string };
  branchBehavior: { rememberLastBranch: boolean; requireBranchSelection: boolean; allowBranchSwitch: boolean };
  dateTime: { dateFormat: string; timeFormat: string; businessDayStartHour: number; weekStartsOn: string };
  interface: { compactMode: boolean; showModuleBadges: boolean; enableCommandSearch: boolean };
  defaults: { refreshReportsOnOpen: boolean; ownerNotifications: boolean; staffHints: boolean };
};

export type GeneralSettingsAudit = { lastChangedBy: string; lastChangedAt: string };
export type GeneralSettingsResponse = { branchId?: string; settings?: ApiRecord; audit?: ApiRecord };

export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsState = {
  workspace: { workspaceName: 'Aurashine OS', defaultLandingPage: 'dashboard', fastPosEnabled: true },
  localization: { country: 'India', language: 'English', timezone: 'Asia/Kolkata', currency: 'INR', locale: 'en-IN' },
  branchBehavior: { rememberLastBranch: true, requireBranchSelection: true, allowBranchSwitch: true },
  dateTime: { dateFormat: 'DD/MM/YYYY', timeFormat: '12h', businessDayStartHour: 0, weekStartsOn: 'Monday' },
  interface: { compactMode: false, showModuleBadges: true, enableCommandSearch: true },
  defaults: { refreshReportsOnOpen: true, ownerNotifications: true, staffHints: true }
};

const DEFAULT_AUDIT: GeneralSettingsAudit = { lastChangedBy: 'Not saved yet', lastChangedAt: '' };
const COUNTRY_CODES: Record<string, string> = { india: 'IN', 'united states': 'US', 'united kingdom': 'GB', 'united arab emirates': 'AE' };
const LANGUAGE_CODES: Record<string, string> = { english: 'en', hindi: 'hi', arabic: 'ar', french: 'fr', german: 'de', spanish: 'es' };

function cloneSettings(settings: GeneralSettingsState): GeneralSettingsState {
  return JSON.parse(JSON.stringify(settings)) as GeneralSettingsState;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringValue(value: unknown, fallback: string, allowed?: string[]): string {
  const next = String(value ?? fallback).trim() || fallback;
  return allowed && !allowed.includes(next) ? fallback : next;
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

export function normalizeGeneralSettings(input: ApiRecord = {}): GeneralSettingsState {
  const workspace = (input['workspace'] || {}) as ApiRecord;
  const localization = (input['localization'] || {}) as ApiRecord;
  const branchBehavior = (input['branchBehavior'] || {}) as ApiRecord;
  const dateTime = (input['dateTime'] || {}) as ApiRecord;
  const interfaceSettings = (input['interface'] || {}) as ApiRecord;
  const defaults = (input['defaults'] || {}) as ApiRecord;
  return {
    workspace: {
      workspaceName: stringValue(workspace['workspaceName'], DEFAULT_GENERAL_SETTINGS.workspace.workspaceName),
      defaultLandingPage: stringValue(workspace['defaultLandingPage'], DEFAULT_GENERAL_SETTINGS.workspace.defaultLandingPage, ['dashboard', 'pos', 'appointments', 'clients', 'reports']),
      fastPosEnabled: boolValue(workspace['fastPosEnabled'], DEFAULT_GENERAL_SETTINGS.workspace.fastPosEnabled)
    },
    localization: {
      country: stringValue(localization['country'], DEFAULT_GENERAL_SETTINGS.localization.country),
      language: stringValue(localization['language'], DEFAULT_GENERAL_SETTINGS.localization.language),
      timezone: stringValue(localization['timezone'], DEFAULT_GENERAL_SETTINGS.localization.timezone),
      currency: stringValue(localization['currency'], DEFAULT_GENERAL_SETTINGS.localization.currency),
      locale: stringValue(localization['locale'], DEFAULT_GENERAL_SETTINGS.localization.locale)
    },
    branchBehavior: {
      rememberLastBranch: boolValue(branchBehavior['rememberLastBranch'], DEFAULT_GENERAL_SETTINGS.branchBehavior.rememberLastBranch),
      requireBranchSelection: boolValue(branchBehavior['requireBranchSelection'], DEFAULT_GENERAL_SETTINGS.branchBehavior.requireBranchSelection),
      allowBranchSwitch: boolValue(branchBehavior['allowBranchSwitch'], DEFAULT_GENERAL_SETTINGS.branchBehavior.allowBranchSwitch)
    },
    dateTime: {
      dateFormat: stringValue(dateTime['dateFormat'], DEFAULT_GENERAL_SETTINGS.dateTime.dateFormat, ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']),
      timeFormat: stringValue(dateTime['timeFormat'], DEFAULT_GENERAL_SETTINGS.dateTime.timeFormat, ['12h', '24h']),
      businessDayStartHour: numberValue(dateTime['businessDayStartHour'], DEFAULT_GENERAL_SETTINGS.dateTime.businessDayStartHour, 0, 23),
      weekStartsOn: stringValue(dateTime['weekStartsOn'], DEFAULT_GENERAL_SETTINGS.dateTime.weekStartsOn, ['Sunday', 'Monday'])
    },
    interface: {
      compactMode: boolValue(interfaceSettings['compactMode'], DEFAULT_GENERAL_SETTINGS.interface.compactMode),
      showModuleBadges: boolValue(interfaceSettings['showModuleBadges'], DEFAULT_GENERAL_SETTINGS.interface.showModuleBadges),
      enableCommandSearch: boolValue(interfaceSettings['enableCommandSearch'], DEFAULT_GENERAL_SETTINGS.interface.enableCommandSearch)
    },
    defaults: {
      refreshReportsOnOpen: boolValue(defaults['refreshReportsOnOpen'], DEFAULT_GENERAL_SETTINGS.defaults.refreshReportsOnOpen),
      ownerNotifications: boolValue(defaults['ownerNotifications'], DEFAULT_GENERAL_SETTINGS.defaults.ownerNotifications),
      staffHints: boolValue(defaults['staffHints'], DEFAULT_GENERAL_SETTINGS.defaults.staffHints)
    }
  };
}

@Injectable({ providedIn: 'root' })
export class GeneralSettingsService {
  readonly settings = signal(cloneSettings(DEFAULT_GENERAL_SETTINGS));
  readonly audit = signal<GeneralSettingsAudit>({ ...DEFAULT_AUDIT });
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly workspaceName = computed(() => this.settings().workspace.workspaceName);
  readonly fastPosEnabled = computed(() => this.settings().workspace.fastPosEnabled);
  readonly compactMode = computed(() => this.settings().interface.compactMode);
  readonly showModuleBadges = computed(() => this.settings().interface.showModuleBadges);
  readonly commandSearchEnabled = computed(() => this.settings().interface.enableCommandSearch);
  readonly allowBranchSwitch = computed(() => this.settings().branchBehavior.allowBranchSwitch);
  readonly requireBranchSelection = computed(() => this.settings().branchBehavior.requireBranchSelection);
  readonly ownerNotificationsEnabled = computed(() => this.settings().defaults.ownerNotifications);
  readonly staffHintsEnabled = computed(() => this.settings().defaults.staffHints);

  private loadedScope = '';
  private lastRealtimeEventId = '';

  constructor(
    private readonly api: ApiService,
    private readonly state: AppStateService,
    private readonly i18n: I18nService,
    private readonly realtime: WebSocketService
  ) {
    effect(() => {
      const event = this.realtime.events().find((item) => item.type === 'settings.general.updated');
      if (!event || event.meta?.eventId === this.lastRealtimeEventId) return;
      this.lastRealtimeEventId = event.meta?.eventId || String(event.meta?.timestamp || 'event');
      const branchId = String((event.payload as ApiRecord)?.['branchId'] || '');
      if (!branchId || branchId === this.state.selectedBranchId()) this.load(true).subscribe({ error: () => undefined });
    });
  }

  load(force = false): Observable<GeneralSettingsResponse> {
    const scope = `${this.state.selectedTenantId()}|${this.state.selectedBranchId()}`;
    this.loading.set(true);
    this.realtime.connect();
    return this.api.list<GeneralSettingsResponse>('settings/general', force ? { noCache: true } : {}).pipe(
      tap({
        next: (response) => {
          this.apply(response.settings || {}, !this.i18n.hasSavedPreference());
          this.audit.set({
            lastChangedBy: String(response.audit?.['lastChangedBy'] || DEFAULT_AUDIT.lastChangedBy),
            lastChangedAt: String(response.audit?.['lastChangedAt'] || DEFAULT_AUDIT.lastChangedAt)
          });
          this.loadedScope = scope;
          this.loaded.set(true);
          this.loading.set(false);
        },
        error: () => this.loading.set(false)
      })
    );
  }

  ensureLoaded(): Observable<GeneralSettingsResponse> {
    const scope = `${this.state.selectedTenantId()}|${this.state.selectedBranchId()}`;
    return this.load(this.loadedScope !== scope);
  }

  save(settings: GeneralSettingsState): Observable<GeneralSettingsResponse> {
    return this.api.put<GeneralSettingsResponse>('settings/general', { settings: normalizeGeneralSettings(settings as unknown as ApiRecord) }).pipe(
      tap((response) => {
        this.apply(response.settings || settings as unknown as ApiRecord, true);
        this.audit.set({
          lastChangedBy: String(response.audit?.['lastChangedBy'] || DEFAULT_AUDIT.lastChangedBy),
          lastChangedAt: String(response.audit?.['lastChangedAt'] || DEFAULT_AUDIT.lastChangedAt)
        });
      })
    );
  }

  private apply(input: ApiRecord, applyLocalization: boolean): void {
    const settings = normalizeGeneralSettings(input);
    this.settings.set(settings);
    if (!settings.branchBehavior.rememberLastBranch) {
      localStorage.removeItem('aura.selectedBranchId');
      localStorage.removeItem(`aura.selectedBranchId.${this.state.selectedTenantId()}`);
    }
    this.api.setReportRefreshPolicy(settings.defaults.refreshReportsOnOpen);
    this.i18n.configureDateTime({
      dateFormat: settings.dateTime.dateFormat,
      timeFormat: settings.dateTime.timeFormat,
      timezone: settings.localization.timezone,
      businessDayStartHour: settings.dateTime.businessDayStartHour
    });
    configureWeekStart(settings.dateTime.weekStartsOn === 'Sunday' ? 'Sunday' : 'Monday');
    configureBusinessCalendar(settings.localization.timezone, settings.dateTime.businessDayStartHour);
    document.documentElement.dataset['compactMode'] = settings.interface.compactMode ? 'true' : 'false';
    document.documentElement.dataset['staffHints'] = settings.defaults.staffHints ? 'true' : 'false';
    document.title = `${settings.workspace.workspaceName} | Salon OS`;
    if (!applyLocalization) return;
    const countryCode = COUNTRY_CODES[settings.localization.country.toLowerCase()] || settings.localization.country;
    const languageCode = LANGUAGE_CODES[settings.localization.language.toLowerCase()] || settings.localization.language;
    this.i18n.setPreference({
      countryCode,
      languageCode,
      currencyCode: settings.localization.currency,
      dateLocale: settings.localization.locale,
      numberLocale: settings.localization.locale
    });
  }
}
