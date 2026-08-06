import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { parseCsv } from './csv-import';
import { DataMigrationStore, DuplicateDecision, ImportAnalysis, ImportAnalysisRow, ImportEntity, ImportJob, ImportMapping, ImportMappingVersion, MigrationCutoverStatus, MigrationQuarantineRecord, MigrationSourceProfile, SourceFile } from './data-migration.store';

type Tab = 'Overview' | 'Integrations' | 'API Keys' | 'Webhooks' | 'Imports' | 'Exports';
type Provider = { provider: string; enabled: boolean; webhookConfigured: boolean; environment: string };
type ConnectorRow = { provider: 'quickbooks' | 'xero' | 'netsuite' | 'google' | 'zapier' | 'zenoti' | 'dingg' | 'meta'; label: string; category: string; authMode: string; configured: boolean; status: string; externalAccountId: string; externalAccountName: string; lastSyncedAt?: string; lastError: string };
type ConnectorSyncJob = { id: string; provider: string; triggerSource: string; status: string; attempts: number; lastError: string; createdAt: string; completedAt?: string };
type ConnectorAccountMapping = { localAccountCode: string; externalAccountId: string; externalAccountName: string; version: number; updatedBy: string; updatedAt: string };
type ConnectorReconciliation = { provider: string; localJournalCount: number; localDebitPaise: number; localCreditPaise: number; syncedJournalCount: number; syncedDebitPaise: number; syncedCreditPaise: number; pendingJournalCount: number; processingJournalCount: number; failedJournalCount: number; uncertainJournalCount: number; unmappedAccountCodes: string[]; balanced: boolean; reconciled: boolean };
type ReserveWithGoogleSettings = { merchantId: string; enabled: boolean; serverCredentialsConfigured: boolean; bookingServerPath: string; status: string };
type ApiKeyRow = { id: string; name: string; keyPrefix: string; scopesJson: string[]; ipAllowlistJson: string[]; rateLimitPerMinute: number; status: string; lastUsedAt?: string; createdAt: string };
type WebhookRow = { id: string; name: string; endpointUrl: string; events: string[]; active: boolean; updatedAt: string };
type WebhookDelivery = { id: string; subscriptionId: string; eventType: string; eventId: string; status: string; attempts: number; responseStatus?: number; lastError: string; deliveredAt?: string; deadLetteredAt?: string; replayedAt?: string; replayedBy?: string; createdAt: string; updatedAt: string };
type MappingAlternative = { targetField: string; confidencePercentage: number; reasons: string[]; rejectionReasons: string[]; requiredTransformation: string };
type MappingDecision = { sourceColumn: string; targetField?: string; candidates: string[]; aliasLevel: string; confidence: 'green' | 'yellow' | 'red'; confidencePercentage: number; collision: boolean; reason: string; alternativeTargets: MappingAlternative[]; suggestionReasons: string[]; rejectionReasons: string[]; detectedDataType: string; sampleEvidence: string[]; requiredTransformation?: string; approved: boolean; approvalId?: string; approvedBy?: string; approvedAt?: string };
type MappingSuggestions = { source: string; ruleVersion: string; fingerprint: string; headerFingerprint: string; profileMatch: 'exact' | 'drift' | 'none'; savedProfile?: { id: string; name: string; mappingVersion: number; approvedBy: string; approvedAt: string; headerFingerprint: string; columnCount: number }; headerDiff: { added: string[]; removed: string[] }; semanticSource: string; semanticAdvisory: Record<string, string>; suggestions: Record<string, string>; unmatchedColumns: string[]; decisions: MappingDecision[]; approvalRequiredIssues: string[]; hardBlockingIssues: string[]; blockingIssues: string[] };

@Component({
    selector: 'page-integrations-data', imports: [CommonModule, FormsModule, RouterLink, DatePickerComponent],
    templateUrl: './integrations-data-page.component.html', styleUrls: ['./integrations-data-page.component.css', './integrations-data-connectors.css']
})
export class IntegrationsDataPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly migration = inject(DataMigrationStore);
  readonly tabs: Tab[] = ['Overview', 'Integrations', 'API Keys', 'Webhooks', 'Imports', 'Exports'];
  readonly apiScopes = ['clients.read', 'appointments.read', 'sales.read', 'staff.read'];
  readonly webhookEvents = ['client.created', 'appointment.created', 'appointment.status_changed', 'sale.status_changed'];
  readonly migrationProviders = ['auto', 'zenoti', 'dingg', 'salonist', 'fresha', 'tally', 'busy', 'marg', 'excel', 'csv', 'manual'];
  activeTab: Tab = 'Imports'; providers: Provider[] = []; connectors: ConnectorRow[] = []; connectorJobs: ConnectorSyncJob[] = []; apiKeys: ApiKeyRow[] = []; webhooks: WebhookRow[] = []; webhookDeliveries: WebhookDelivery[] = [];
  drawer: 'import' | 'cutover' | 'api-key' | 'webhook' | 'governance' | 'accounting' | '' = ''; entity: ImportEntity | '' = ''; mode: 'dry-run' | 'commit' = 'dry-run'; postingMode: 'history_only' | 'opening_snapshot' | 'opening_payable' | 'live_receipt' = 'history_only'; cutoverId = ''; cutoverDate = ''; selectedJob: ImportJob | null = null;
  cutoverDraft = { id: '', businessTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', cutoverDate: '', cutoverTime: '00:00', historicalPeriodEndDate: '', historicalPeriodEndTime: '23:59' };
  snapshotChecksum = '';
  goLiveApprovalNote = '';
  goLiveObservationHours = '72';
  fileName = ''; csvText = ''; rowCount = 0; selectedMappingId = ''; mappingName = ''; mappingSource = ''; mappingRuleVersion = ''; mappingFingerprint = ''; mappingHeaderFingerprint = ''; mappingProfileMatch: 'exact' | 'drift' | 'none' = 'none'; matchedSavedProfile: MappingSuggestions['savedProfile']; mappingHeaderDiff = { added: [] as string[], removed: [] as string[] }; mappingVersions: ImportMappingVersion[] = []; rollbackVersion = 0; mappingSemanticSource = ''; semanticAdvisory: Record<string, string> = {}; suggestedMapping: Record<string, string> = {}; mappingOverrides: Record<string, string> = {}; mappingDecisions: MappingDecision[] = []; approvalRequiredIssues: string[] = []; hardBlockingIssues: string[] = []; blockingMappingIssues: string[] = []; approvedAliasTargets: Record<string, string> = {}; importAnalysis: ImportAnalysis | null = null; duplicateDecisions: Record<string, DuplicateDecision> = {}; chunkSize = 5000; allowPartialImport = false; apiKeyDraft = { name: '', scopes: ['clients.read'] as string[], ipAllowlist: '', rateLimitPerMinute: 60 };
  webhookDraft = { name: '', endpointUrl: '', events: ['client.created'] as string[] }; revealedSecret = '';
  netsuiteAccountId = '';
  migrationConnectorDraft = { credential: '', authScheme: 'api_key', centerIds: '', startDate: '', endDate: '', exportUrl: '', sourceFileName: 'dingg-export.xlsx', mode: 'dry-run' as 'dry-run' | 'commit' };
  metaConnectorDraft = { credential: '', pageId: '', instagramBusinessAccountId: '', graphApiBaseUrl: '' };
  selectedAccountingConnector: ConnectorRow | null = null;
  accountingMappings: ConnectorAccountMapping[] = [];
  accountingReconciliation: ConnectorReconciliation | null = null;
  accountingMappingDraft: Record<string, { externalAccountId: string; externalAccountName: string }> = {};
  reserveWithGoogle: ReserveWithGoogleSettings = { merchantId: '', enabled: false, serverCredentialsConfigured: false, bookingServerPath: '/actions-center/v3', status: 'configuration_required' };
  reserveWithGoogleDraft = { merchantId: '', enabled: false };
  selectedSourceFile: File | null = null; selectedSourceFileId = ''; uploadSessionId = ''; uploadProgress = 0; uploadStatus = '';
  sourceProvider = 'auto'; evidenceRetentionDays = 90; sourceProfile: MigrationSourceProfile | null = null; selectedSourceSheet = ''; selectedHeaderSourceSheet = '';
  quarantineSelected: Record<string, boolean> = {}; quarantineCorrections: Record<string, string> = {};
  openingPayableOffsetAccount: 'OWNER_EQUITY' | 'RETAINED_EARNINGS' = 'OWNER_EQUITY';
  private refreshTimer = 0;
  busy = false; loading = true; error = '';

  get jobs() { return this.migration.jobs(); }
  get sourceFiles() { return this.migration.sourceFiles(); }
  get importMappings() { return this.migration.mappings(); }
  get importTemplates() { return this.migration.templates(); }
  get governance() { return this.migration.governance(); }
  get activeCutover() { return this.migration.activeCutover(); }
  get historicalPurchaseBills() { return this.migration.historicalPurchaseBills(); }
  get canViewApiClients() { return this.auth.hasRole('owner', 'admin', 'superadmin', 'super-admin') || this.auth.hasPermission('security.read', 'security.manage'); }
  get canManageApiClients() { return this.auth.hasRole('owner', 'admin', 'superadmin', 'super-admin') || this.auth.hasPermission('security.manage'); }
  get canManageMigrations() { return this.auth.hasAccess(['owner', 'admin', 'manager', 'superadmin', 'super-admin'], ['data_migration.manage']); }
  get canExportMigrations() { return this.auth.hasAccess(['owner', 'admin', 'superadmin', 'super-admin'], ['data_migration.export']); }
  get canApproveOpeningPayableFinance() { return this.canManageMigrations && this.auth.hasAccess(['owner', 'admin', 'superadmin', 'super-admin'], ['finance.write']); }
  get canConfirmOpeningPayableBranch() { return this.canManageMigrations && this.auth.hasRole('manager'); }
  get canApproveCutoverOwnerActions() { return this.auth.hasRole('owner', 'superadmin', 'super-admin'); }
  get canManageAccounting() { return this.auth.hasRole('owner', 'admin', 'manager', 'accountant', 'superadmin', 'super-admin') || this.auth.hasPermission('finance.write', 'security.manage'); }
  get accountingAccountCodes() { return [...new Set([...(this.accountingReconciliation?.unmappedAccountCodes || []), ...this.accountingMappings.map((row) => row.localAccountCode)])].sort(); }
  get nextCutoverStatus(): MigrationCutoverStatus | null { const current = this.activeCutover?.status; return current ? ({ draft: 'history_importing', history_importing: 'inventory_frozen', inventory_frozen: 'snapshot_approved', snapshot_approved: 'snapshot_applied', snapshot_applied: 'reconciled', reconciled: 'live', live: null } as const)[current] : null; }
  get nextCutoverNeedsOwner() { return this.nextCutoverStatus === 'inventory_frozen' || this.nextCutoverStatus === 'snapshot_approved' || this.nextCutoverStatus === 'live'; }
  get visibleTabs() { return this.canViewApiClients ? this.tabs : this.tabs.filter((tab) => tab !== 'API Keys' && tab !== 'Webhooks'); }

  async ngOnInit() { if (new URL(location.href).searchParams.get('connector')) this.activeTab = 'Integrations'; await this.reload(); this.refreshTimer = window.setInterval(() => { if (!this.busy && this.jobs.some((job) => ['staging', 'dependency_pending', 'queued', 'processing'].includes(job.status))) void this.reloadImportData(); }, 5000); }
  ngOnDestroy() { window.clearInterval(this.refreshTimer); }
  async reload() {
    this.loading = true; this.error = '';
    try {
      const [payments, delivery, connectors, connectorJobs, keys, hooks, hookDeliveries, reserveWithGoogle] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<Provider[]>>('/pos/payment-providers')),
        firstValueFrom(this.api.get<ApiEnvelope<Provider[]>>('/settings/integrations/delivery-providers')),
        firstValueFrom(this.api.get<ApiEnvelope<ConnectorRow[]>>('/settings/integrations/connectors')),
        firstValueFrom(this.api.get<ApiEnvelope<ConnectorSyncJob[]>>('/settings/integrations/connector-sync-jobs')),
        this.canViewApiClients
          ? firstValueFrom(this.api.get<ApiEnvelope<ApiKeyRow[]>>('/settings/integrations/api-keys'))
          : Promise.resolve({ success: true, data: [] } as ApiEnvelope<ApiKeyRow[]>),
        this.canViewApiClients
          ? firstValueFrom(this.api.get<ApiEnvelope<WebhookRow[]>>('/settings/integrations/webhooks'))
          : Promise.resolve({ success: true, data: [] } as ApiEnvelope<WebhookRow[]>),
        this.canViewApiClients
          ? firstValueFrom(this.api.get<ApiEnvelope<WebhookDelivery[]>>('/settings/integrations/webhook-deliveries'))
          : Promise.resolve({ success: true, data: [] } as ApiEnvelope<WebhookDelivery[]>),
        firstValueFrom(this.api.get<ApiEnvelope<ReserveWithGoogleSettings>>('/settings/integrations/reserve-with-google')),
        this.migration.reload(),
      ]);
      this.providers = [...(delivery.data || []), ...(payments.data || [])]; this.connectors = connectors.data || []; this.connectorJobs = connectorJobs.data || []; this.apiKeys = keys.data || []; this.webhooks = hooks.data || []; this.webhookDeliveries = hookDeliveries.data || []; this.reserveWithGoogle = reserveWithGoogle.data || this.reserveWithGoogle; this.reserveWithGoogleDraft = { merchantId: this.reserveWithGoogle.merchantId, enabled: this.reserveWithGoogle.enabled };
    } catch (error) { this.error = this.message(error, 'Integration data could not be loaded'); }
    finally { this.loading = false; }
  }

  openImport() { this.entity = ''; this.mode = 'dry-run'; this.postingMode = 'history_only'; this.cutoverId = this.activeCutover?.id || ''; this.cutoverDate = this.activeCutover?.cutoverDate || ''; this.fileName = ''; this.csvText = ''; this.rowCount = 0; this.selectedMappingId = ''; this.mappingName = ''; this.mappingSource = ''; this.mappingRuleVersion = ''; this.mappingFingerprint = ''; this.mappingHeaderFingerprint = ''; this.mappingProfileMatch = 'none'; this.matchedSavedProfile = undefined; this.mappingHeaderDiff = { added: [], removed: [] }; this.mappingVersions = []; this.rollbackVersion = 0; this.mappingSemanticSource = ''; this.semanticAdvisory = {}; this.suggestedMapping = {}; this.mappingOverrides = {}; this.mappingDecisions = []; this.approvalRequiredIssues = []; this.hardBlockingIssues = []; this.blockingMappingIssues = []; this.approvedAliasTargets = {}; this.importAnalysis = null; this.duplicateDecisions = {}; this.chunkSize = 5000; this.allowPartialImport = false; this.selectedSourceFile = null; this.selectedSourceFileId = ''; this.uploadSessionId = ''; this.uploadProgress = 0; this.uploadStatus = ''; this.sourceProvider = 'auto'; this.evidenceRetentionDays = 90; this.sourceProfile = null; this.selectedSourceSheet = ''; this.selectedHeaderSourceSheet = ''; this.selectedJob = null; this.migration.clearGovernance(); this.drawer = 'import'; }
  openCutover() { const cutover = this.activeCutover; const timezone = cutover?.businessTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; const cutoverParts = cutover ? this.zonedParts(cutover.cutoverAt, timezone) : null; const historicalParts = cutover ? this.zonedParts(cutover.historicalPeriodEnd, timezone) : null; this.cutoverDraft = { id: cutover?.id || '', businessTimezone: timezone, cutoverDate: cutover?.cutoverDate || '', cutoverTime: cutoverParts?.time || '00:00', historicalPeriodEndDate: historicalParts?.date || cutover?.cutoverDate || '', historicalPeriodEndTime: historicalParts?.time || '23:59' }; this.drawer = 'cutover'; }
  queueEvidence(file: SourceFile) { this.openImport(); this.fileName = file.originalFileName; this.selectedSourceFileId = file.id; this.uploadStatus = 'Evidence verified'; void this.action(() => this.profileSource(), 'Source profile could not be loaded'); }
  canQueueSource(file: SourceFile) { return ['csv', 'xlsx', 'zip'].includes(file.format); }
  openApiKey() { if (!this.canManageApiClients) return; this.apiKeyDraft = { name: '', scopes: ['clients.read'], ipAllowlist: '', rateLimitPerMinute: 60 }; this.revealedSecret = ''; this.drawer = 'api-key'; }
  openWebhook() { this.webhookDraft = { name: '', endpointUrl: '', events: ['client.created'] }; this.revealedSecret = ''; this.drawer = 'webhook'; }
  closeDrawer() { if (!this.busy) { this.drawer = ''; this.selectedJob = null; this.migration.clearGovernance(); } }
  toggleScope(scope: string) { this.apiKeyDraft.scopes = this.toggle(this.apiKeyDraft.scopes, scope); }
  toggleEvent(event: string) { this.webhookDraft.events = this.toggle(this.webhookDraft.events, event); }

  async saveReserveWithGoogle() {
    if (!this.canManageApiClients || !this.reserveWithGoogleDraft.merchantId.trim()) return;
    await this.action(async () => {
      const result = await firstValueFrom(this.api.put<ApiEnvelope<ReserveWithGoogleSettings>>('/settings/integrations/reserve-with-google', { merchantId: this.reserveWithGoogleDraft.merchantId.trim(), enabled: this.reserveWithGoogleDraft.enabled }));
      if (result.data) { this.reserveWithGoogle = result.data; this.reserveWithGoogleDraft = { merchantId: result.data.merchantId, enabled: result.data.enabled }; }
    }, 'Reserve with Google settings could not be saved');
  }

  async saveCutover() {
    const draft = this.cutoverDraft;
    if (!draft.id.trim() || !draft.cutoverDate || !draft.historicalPeriodEndDate) { this.error = 'Cutover ID, cutover date and historical period end are required'; return; }
    await this.action(async () => {
      await firstValueFrom(this.api.post('/settings/integrations/migration-cutovers', { id: draft.id.trim(), businessTimezone: draft.businessTimezone.trim(), cutoverDate: draft.cutoverDate, cutoverAt: this.zonedIso(draft.cutoverDate, draft.cutoverTime, draft.businessTimezone), historicalPeriodEnd: this.zonedIso(draft.historicalPeriodEndDate, draft.historicalPeriodEndTime, draft.businessTimezone) }));
      this.drawer = ''; await this.reloadImportData();
    }, 'Cutover could not be saved');
  }

  async advanceCutover() {
    const cutover = this.activeCutover; const targetStatus = this.nextCutoverStatus;
    if (!cutover || !targetStatus) return;
    if (targetStatus === 'snapshot_approved' && !/^[0-9a-f]{64}$/i.test(this.snapshotChecksum.trim())) { this.error = 'Snapshot approval requires a valid SHA-256 checksum'; return; }
    const observationPeriodHours = Number(this.goLiveObservationHours);
    if (targetStatus === 'live' && !this.goLiveApprovalNote.trim()) { this.error = 'Owner go-live approval note is required'; return; }
    if (targetStatus === 'live' && (!Number.isInteger(observationPeriodHours) || observationPeriodHours < 24 || observationPeriodHours > 72)) { this.error = 'Rollback observation window must be between 24 and 72 hours'; return; }
    if ((targetStatus === 'inventory_frozen' || targetStatus === 'snapshot_approved' || targetStatus === 'live') && !confirm(targetStatus === 'inventory_frozen' ? 'Freeze all stock movements for this branch?' : targetStatus === 'snapshot_approved' ? 'Approve this physical stock snapshot as Owner?' : 'Go live and release the inventory freeze?')) return;
    await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/migration-cutovers/${cutover.id}/transition`, { targetStatus, snapshotChecksum: targetStatus === 'snapshot_approved' ? this.snapshotChecksum.trim() : null, observationPeriodHours: targetStatus === 'live' ? observationPeriodHours : null, note: targetStatus === 'live' ? this.goLiveApprovalNote.trim() : '' })); this.snapshotChecksum = ''; this.goLiveApprovalNote = ''; await this.reloadImportData(); }, 'Cutover transition was blocked');
  }

  async downloadCutoverProofPack() { const cutover = this.activeCutover; if (!cutover || !this.canExportMigrations) return; await this.action(async () => this.downloadBlob(await firstValueFrom(this.api.getBlob(`/settings/integrations/migration-cutovers/${cutover.id}/proof-pack`)), `migration-cutover-proof-${cutover.id}.json`), 'Cutover proof pack could not be downloaded'); }

  async chooseFile(event: Event) {
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; this.error = ''; this.csvText = ''; this.fileName = ''; this.rowCount = 0; this.mappingSource = ''; this.mappingRuleVersion = ''; this.mappingFingerprint = ''; this.mappingSemanticSource = ''; this.semanticAdvisory = {}; this.suggestedMapping = {}; this.mappingOverrides = {}; this.mappingDecisions = []; this.approvalRequiredIssues = []; this.hardBlockingIssues = []; this.blockingMappingIssues = []; this.approvedAliasTargets = {}; this.importAnalysis = null; this.duplicateDecisions = {}; this.selectedSourceFileId = ''; this.selectedSourceSheet = ''; this.selectedHeaderSourceSheet = ''; this.uploadSessionId = ''; this.uploadProgress = 0; this.uploadStatus = '';
    if (!file) return;
    this.selectedSourceFile = file;
    this.busy = true;
    try { await this.uploadSourceFile(file); }
    catch (error) { this.error = this.message(error, error instanceof Error ? error.message : 'Source file could not be uploaded'); if (this.uploadStatus !== 'Evidence verified') this.uploadStatus = 'Upload paused'; }
    finally { this.busy = false; input.value = ''; }
  }
  async resumeSourceUpload() { if (!this.selectedSourceFile || !this.uploadSessionId) return; await this.action(() => this.uploadSourceFile(this.selectedSourceFile!), 'Source upload could not be resumed'); }
  entityChanged() { if (this.isThreeLayerEntity) { this.mode = 'dry-run'; this.postingMode = this.entity === 'inventory' ? 'opening_snapshot' : this.entity === 'opening-payables' ? 'opening_payable' : 'history_only'; } else { this.cutoverId = ''; this.cutoverDate = ''; } this.selectedMappingId = ''; this.mappingSource = ''; this.mappingRuleVersion = ''; this.mappingFingerprint = ''; this.mappingHeaderFingerprint = ''; this.mappingProfileMatch = 'none'; this.matchedSavedProfile = undefined; this.mappingHeaderDiff = { added: [], removed: [] }; this.mappingVersions = []; this.rollbackVersion = 0; this.mappingSemanticSource = ''; this.semanticAdvisory = {}; this.suggestedMapping = {}; this.mappingOverrides = {}; this.mappingDecisions = []; this.approvalRequiredIssues = []; this.hardBlockingIssues = []; this.blockingMappingIssues = []; this.approvedAliasTargets = {}; this.importAnalysis = null; this.duplicateDecisions = {}; const match = this.sourceProfile?.sheets.find((sheet) => sheet.targets.includes(this.entity as ImportEntity)); this.selectedSourceSheet = match?.id || ''; this.selectedHeaderSourceSheet = ''; }
  get sourceSheets() { return (this.sourceProfile?.sheets || []).filter((sheet) => sheet.importable && (!this.entity || sheet.targets.includes(this.entity as ImportEntity))); }
  get purchaseHeaderSheets() { return (this.sourceProfile?.sheets || []).filter((sheet) => sheet.importable && sheet.id !== this.selectedSourceSheet); }
  sourceSheetChanged() { if (this.selectedHeaderSourceSheet === this.selectedSourceSheet) this.selectedHeaderSourceSheet = ''; this.mappingContextChanged(); }
  get isThreeLayerEntity() { return this.entity === 'purchase-bills' || this.entity === 'inventory' || this.entity === 'opening-payables'; }
  get availableMappings() { return this.importMappings.filter((mapping) => mapping.entity === this.entity); }
  get selectedMapping() { return this.importMappings.find((mapping) => mapping.id === this.selectedMappingId); }
  get activeTemplate() { return this.importTemplates.find((template) => template.entity === this.entity); }
  get mappingReviewDecisions() { return this.mappingDecisions; }
  get greenMappingCount() { return this.mappingDecisions.filter((decision) => decision.confidence === 'green').length; }
  get yellowMappingCount() { return this.mappingDecisions.filter((decision) => decision.confidence === 'yellow' && !decision.approved).length; }
  get redMappingCount() { return this.mappingDecisions.filter((decision) => decision.confidence === 'red').length; }
  get analysisRows() { return (this.importAnalysis?.rows || []).slice(0, 100); }
  duplicateDecisionKey(row: ImportAnalysisRow) { return row.sourceExternalId || String(row.sourceRowNumber); }
  hasUnresolvedDuplicates() { return !!this.importAnalysis?.rows.some((row) => row.status === 'duplicate' && !this.duplicateDecisions[this.duplicateDecisionKey(row)]); }
  async analyzeImport() {
    if (!this.entity || (!this.csvText && !this.selectedSourceFileId)) return;
    if (this.selectedSourceFileId && this.isThreeLayerEntity && (!this.cutoverId.trim() || !this.cutoverDate)) { this.error = 'Cutover ID and date are required'; return; }
    if (this.selectedSourceFileId) {
      await this.action(async () => {
        await this.queueSourceDryRun();
        this.drawer = '';
      }, 'Import analysis could not be queued');
      return;
    }
    await this.action(async () => {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<ImportAnalysis>>('/settings/integrations/import-jobs/analyze', { entity: this.entity, sourceProvider: this.sourceProvider, csv: this.csvText, mapping: this.selectedMappingId ? {} : this.suggestedMapping, mappingId: this.selectedMappingId || null, duplicateDecisions: this.duplicateDecisions }));
      this.importAnalysis = result.data || null;
    }, 'Import analysis failed');
  }
  async suggestMapping() {
    if (!this.entity || (!this.csvText && !this.selectedSourceFileId)) return;
    await this.action(async () => {
      const request = this.mappingEvaluationRequest();
      const result = await firstValueFrom(this.api.post<ApiEnvelope<MappingSuggestions>>('/settings/integrations/import-mapping-suggestions', request));
      this.selectedMappingId = result.data?.profileMatch === 'exact' ? result.data.savedProfile?.id || '' : '';
      await this.loadMappingVersions();
      this.suggestedMapping = result.data?.suggestions || {};
      this.mappingDecisions = result.data?.decisions || [];
      this.approvalRequiredIssues = result.data?.approvalRequiredIssues || [];
      this.hardBlockingIssues = result.data?.hardBlockingIssues || [];
      this.blockingMappingIssues = result.data?.blockingIssues || [];
      this.approvedAliasTargets = {};
      this.mappingSource = result.data?.source || 'rust_deterministic';
      this.mappingRuleVersion = result.data?.ruleVersion || '';
      this.mappingFingerprint = result.data?.fingerprint || '';
      this.mappingHeaderFingerprint = result.data?.headerFingerprint || '';
      this.mappingProfileMatch = result.data?.profileMatch || 'none';
      this.matchedSavedProfile = result.data?.savedProfile;
      this.mappingHeaderDiff = result.data?.headerDiff || { added: [], removed: [] };
      this.mappingSemanticSource = result.data?.semanticSource || '';
      this.semanticAdvisory = result.data?.semanticAdvisory || {};
      if (this.csvText && !this.selectedSourceFileId) {
        const analysis = await firstValueFrom(this.api.post<ApiEnvelope<ImportAnalysis>>('/settings/integrations/import-jobs/analyze', { entity: this.entity, sourceProvider: this.sourceProvider, csv: this.csvText, mapping: this.suggestedMapping, mappingId: this.selectedMappingId || null, duplicateDecisions: this.duplicateDecisions }));
        this.importAnalysis = analysis.data || null;
      } else {
        this.importAnalysis = null;
        if (!this.blockingMappingIssues.length && (!this.isThreeLayerEntity || (this.cutoverId.trim() && this.cutoverDate))) {
          await this.queueSourceDryRun();
          this.uploadStatus = 'Mapping ready · dry-run queued';
        } else if (!this.blockingMappingIssues.length) {
          this.uploadStatus = 'Mapping ready · enter cutover ID and date';
        } else {
          this.uploadStatus = 'Mapping requires review';
        }
      }
    }, 'Mapping suggestions could not be generated');
  }
  aliasTargets(decision: MappingDecision) { return decision.candidates.length ? decision.candidates : (this.activeTemplate?.columns || []).map((column) => column.field); }
  async approveYellowMapping(decision: MappingDecision) {
    const targetField = this.approvedAliasTargets[decision.sourceColumn];
    if (!this.canManageMigrations || decision.confidence !== 'yellow' || decision.approved || !targetField || !this.mappingFingerprint) return;
    await this.action(async () => {
      await firstValueFrom(this.api.post('/settings/integrations/import-mapping-approvals', { evaluation: this.mappingEvaluationRequest(), sourceColumn: decision.sourceColumn, targetField, fingerprint: this.mappingFingerprint }));
      this.mappingOverrides[decision.sourceColumn] = targetField;
      await this.suggestMapping();
    }, 'Yellow mapping could not be approved');
  }
  async ignoreMappingColumn(decision: MappingDecision) { if (!this.canManageMigrations) return; this.mappingOverrides[decision.sourceColumn] = '__ignore'; await this.suggestMapping(); }
  async chooseDuplicateDecision(row: ImportAnalysisRow, decision: string) {
    if (!this.canManageMigrations) return;
    const key = this.duplicateDecisionKey(row);
    if (!decision) delete this.duplicateDecisions[key]; else this.duplicateDecisions[key] = decision as DuplicateDecision;
    await this.analyzeImport();
  }
  async saveCurrentMapping() {
    if (!this.entity || !this.mappingName.trim() || !this.mappingFingerprint || this.blockingMappingIssues.length) return;
    await this.action(async () => {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<ImportMapping>>('/settings/integrations/import-mappings', { name: this.mappingName.trim(), entity: this.entity, mapping: this.suggestedMapping, evaluation: this.mappingEvaluationRequest(), fingerprint: this.mappingFingerprint }));
      if (result.data) this.selectedMappingId = result.data.id;
      await this.migration.reload();
      await this.loadMappingVersions();
    }, 'Import mapping could not be saved');
  }
  async mappingSelectionChanged() { this.mappingSource = ''; this.mappingRuleVersion = ''; this.mappingFingerprint = ''; this.mappingHeaderFingerprint = ''; this.mappingProfileMatch = 'none'; this.matchedSavedProfile = undefined; this.mappingHeaderDiff = { added: [], removed: [] }; this.mappingSemanticSource = ''; this.semanticAdvisory = {}; this.suggestedMapping = {}; this.mappingOverrides = {}; this.mappingDecisions = []; this.approvalRequiredIssues = []; this.hardBlockingIssues = []; this.blockingMappingIssues = []; this.approvedAliasTargets = {}; this.importAnalysis = null; await this.loadMappingVersions(); }
  mappingContextChanged() { this.selectedMappingId = ''; void this.mappingSelectionChanged(); }
  async loadMappingVersions() { this.mappingVersions = []; this.rollbackVersion = 0; if (!this.selectedMappingId) return; const result = await firstValueFrom(this.api.get<ApiEnvelope<ImportMappingVersion[]>>(`/settings/integrations/import-mappings/${this.selectedMappingId}/versions`)); this.mappingVersions = result.data || []; }
  async rollbackMapping() { if (!this.canManageMigrations || !this.selectedMappingId || this.rollbackVersion < 1 || !confirm(`Rollback this mapping to version ${this.rollbackVersion}? A new audited version will be created.`)) return; await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-mappings/${this.selectedMappingId}/rollback/${this.rollbackVersion}`, {})); await this.migration.reload(); await this.loadMappingVersions(); }, 'Mapping rollback failed'); }
  async applyImport() {
    if (!this.entity || (!this.csvText && !this.selectedSourceFileId)) return;
    if (!this.canManageMigrations) { this.error = 'Data migration manage permission is required'; return; }
    if (this.isThreeLayerEntity && (!this.cutoverId.trim() || !this.cutoverDate)) { this.error = 'Cutover ID and date are required'; return; }
    if (this.blockingMappingIssues.length) { this.error = 'Resolve Yellow approvals and Red blockers before creating the import job'; return; }
    if (this.selectedSourceFileId) {
      await this.action(async () => { await firstValueFrom(this.api.post('/settings/integrations/import-jobs/from-source', { sourceFileId: this.selectedSourceFileId, sourceProvider: this.sourceProvider, sourceSheet: this.selectedSourceSheet, headerSourceSheet: this.selectedHeaderSourceSheet, entity: this.entity, mode: this.mode, postingMode: this.isThreeLayerEntity ? this.postingMode : null, cutoverId: this.isThreeLayerEntity ? this.cutoverId.trim() : null, cutoverDate: this.isThreeLayerEntity ? this.cutoverDate : null, mapping: this.selectedMappingId ? {} : this.suggestedMapping, mappingId: this.selectedMappingId || null, duplicateDecisions: this.duplicateDecisions, chunkSize: this.chunkSize, allowPartialImport: this.allowPartialImport })); this.drawer = ''; await this.reloadImportData(); }, 'Large import job could not be created');
      return;
    }
    if (!this.importAnalysis) { await this.analyzeImport(); if (!this.importAnalysis) return; }
    if (this.importAnalysis.summary.errorRows || this.hasUnresolvedDuplicates()) { this.error = 'Resolve row errors and duplicate decisions before creating the job'; return; }
    await this.action(async () => { await firstValueFrom(this.api.post('/settings/integrations/import-jobs', { entity: this.entity, sourceProvider: this.sourceProvider, fileName: this.fileName, mode: this.mode, postingMode: this.isThreeLayerEntity ? this.postingMode : null, cutoverId: this.isThreeLayerEntity ? this.cutoverId.trim() : null, cutoverDate: this.isThreeLayerEntity ? this.cutoverDate : null, csv: this.csvText, mapping: this.selectedMappingId ? {} : this.suggestedMapping, mappingId: this.selectedMappingId || null, duplicateDecisions: this.duplicateDecisions })); this.drawer = ''; await this.reloadImportData(); }, 'Import job could not be created');
  }
  async downloadEvidence(file: SourceFile) { await this.action(async () => this.downloadBlob(await firstValueFrom(this.api.getBlob(`/settings/integrations/import-source-files/${file.id}/evidence`)), file.originalFileName), 'Source evidence could not be downloaded'); }
  async saveApiKey() { if (!this.canManageApiClients || !this.apiKeyDraft.name.trim() || !this.apiKeyDraft.scopes.length) return; await this.action(async () => { const result = await firstValueFrom(this.api.post<ApiEnvelope<any>>('/settings/integrations/api-keys', { ...this.apiKeyDraft, ipAllowlist: this.apiKeyDraft.ipAllowlist.split(/[\s,]+/).filter(Boolean) })); this.revealedSecret = result.data?.apiKey || ''; await this.reload(); }, 'API key could not be created'); }
  async rotateApiKey(row: ApiKeyRow) { if (!this.canManageApiClients) return; await this.action(async () => { const result = await firstValueFrom(this.api.post<ApiEnvelope<any>>(`/settings/integrations/api-keys/${row.id}/rotate`, {})); this.revealedSecret = result.data?.apiKey || ''; await this.reload(); }, 'API key could not be rotated'); }
  async revokeApiKey(row: ApiKeyRow) { if (!this.canManageApiClients || !confirm(`Revoke ${row.name}?`)) return; await this.action(async () => { await firstValueFrom(this.api.delete(`/settings/integrations/api-keys/${row.id}`)); await this.reload(); }, 'API key could not be revoked'); }
  async saveWebhook() { if (!this.webhookDraft.name.trim() || !this.webhookDraft.endpointUrl.trim() || !this.webhookDraft.events.length) return; await this.action(async () => { const result = await firstValueFrom(this.api.post<ApiEnvelope<any>>('/settings/integrations/webhooks', this.webhookDraft)); this.revealedSecret = result.data?.signingSecret || ''; await this.reload(); }, 'Webhook could not be created'); }
  async testWebhook(row: WebhookRow) { await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/webhooks/${row.id}/test`, {})); }, 'Webhook test could not be queued'); }
  async replayWebhook(row: WebhookDelivery) { if (!this.canManageApiClients) return; await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/webhook-deliveries/${row.id}/replay`, {})); await this.reload(); }, 'Webhook delivery could not be replayed'); }
  async deactivateWebhook(row: WebhookRow) { if (!confirm(`Deactivate ${row.name}?`)) return; await this.action(async () => { await firstValueFrom(this.api.delete(`/settings/integrations/webhooks/${row.id}`)); await this.reload(); }, 'Webhook could not be deactivated'); }
  async connectConnector(row: ConnectorRow) {
    if (row.provider === 'zapier') { this.activeTab = 'API Keys'; return; }
    if (!row.configured) { this.error = `${row.label} credentials are not configured`; return; }
    if (row.provider === 'meta') {
      const draft = this.metaConnectorDraft;
      if (!draft.credential.trim() || !draft.pageId.trim() || !draft.graphApiBaseUrl.trim()) { this.error = 'Meta page token, Page ID, and Graph API base URL are required'; return; }
      await this.action(async () => {
        await firstValueFrom(this.api.post(`/settings/integrations/connectors/${row.provider}/credentials`, {
          credential: draft.credential.trim(), pageId: draft.pageId.trim(), instagramBusinessAccountId: draft.instagramBusinessAccountId.trim() || null, graphApiBaseUrl: draft.graphApiBaseUrl.trim(),
        }));
        this.metaConnectorDraft.credential = '';
        await this.reload();
      }, `${row.label} could not be connected`);
      return;
    }
    if (row.provider === 'zenoti' || row.provider === 'dingg') {
      const draft = this.migrationConnectorDraft;
      if (!draft.credential.trim()) { this.error = `${row.label} credential is required`; return; }
      if (row.provider === 'zenoti' && !draft.centerIds.trim()) { this.error = 'At least one Zenoti center ID is required'; return; }
      if (row.provider === 'dingg' && !draft.exportUrl.trim()) { this.error = 'DINGG HTTPS export URL is required'; return; }
      await this.action(async () => {
        await firstValueFrom(this.api.post(`/settings/integrations/connectors/${row.provider}/credentials`, {
          credential: draft.credential.trim(), authScheme: draft.authScheme,
          centerIds: row.provider === 'zenoti' ? draft.centerIds.split(/[\s,]+/).filter(Boolean) : [],
          startDate: row.provider === 'zenoti' ? this.migrationDateIso(draft.startDate) : null,
          endDate: row.provider === 'zenoti' ? this.migrationDateIso(draft.endDate) : null,
          exportUrl: row.provider === 'dingg' ? draft.exportUrl.trim() : null,
          sourceFileName: row.provider === 'dingg' ? draft.sourceFileName.trim() : null,
          mode: draft.mode, autoQueue: true,
        }));
        draft.credential = '';
        await this.reload();
      }, `${row.label} migration could not be queued`);
      return;
    }
    if (row.provider === 'netsuite' && !this.netsuiteAccountId.trim()) { this.error = 'NetSuite account ID is required'; return; }
    await this.action(async () => {
      const returnUrl = `${location.origin}${location.pathname}`;
      const result = await firstValueFrom(this.api.post<ApiEnvelope<{ authorizationUrl: string }>>(`/settings/integrations/connectors/${row.provider}/start`, { returnUri: returnUrl, ...(row.provider === 'netsuite' ? { accountId: this.netsuiteAccountId.trim() } : {}) }));
      if (!result.data?.authorizationUrl) throw new Error('Authorization URL was not returned');
      location.assign(result.data.authorizationUrl);
    }, `${row.label} authorization could not be started`);
  }
  async syncConnector(row: ConnectorRow) { await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/connectors/${row.provider}/sync`, {})); await this.reload(); }, `${row.label} sync could not be queued`); }
  async disconnectConnector(row: ConnectorRow) { if (!confirm(`Disconnect ${row.label}?`)) return; await this.action(async () => { await firstValueFrom(this.api.delete(`/settings/integrations/connectors/${row.provider}`)); await this.reload(); }, `${row.label} could not be disconnected`); }
  async openAccountingConnector(row: ConnectorRow) {
    if (row.category !== 'accounting') return;
    this.selectedAccountingConnector = row; this.accountingMappings = []; this.accountingReconciliation = null; this.accountingMappingDraft = {}; this.drawer = 'accounting';
    await this.action(async () => {
      const [mappings, reconciliation] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<ConnectorAccountMapping[]>>(`/settings/integrations/connectors/${row.provider}/account-mappings`)),
        firstValueFrom(this.api.get<ApiEnvelope<ConnectorReconciliation>>(`/settings/integrations/connectors/${row.provider}/reconciliation`)),
      ]);
      this.accountingMappings = mappings.data || []; this.accountingReconciliation = reconciliation.data || null;
      for (const mapping of this.accountingMappings) this.accountingMappingDraft[mapping.localAccountCode] = { externalAccountId: mapping.externalAccountId, externalAccountName: mapping.externalAccountName };
      for (const code of this.accountingReconciliation?.unmappedAccountCodes || []) this.accountingMappingDraft[code] ||= { externalAccountId: '', externalAccountName: '' };
    }, `${row.label} accounting configuration could not be loaded`);
  }
  async saveAccountingMappings() {
    const connector = this.selectedAccountingConnector; if (!connector || !this.canManageAccounting) return;
    const rows = Object.entries(this.accountingMappingDraft).filter(([, value]) => value.externalAccountId.trim());
    if (!rows.length) { this.error = 'Enter at least one external account ID'; return; }
    await this.action(async () => {
      for (const [code, value] of rows) await firstValueFrom(this.api.put(`/settings/integrations/connectors/${connector.provider}/account-mappings/${encodeURIComponent(code)}`, { externalAccountId: value.externalAccountId.trim(), externalAccountName: value.externalAccountName.trim() || null }));
      await this.openAccountingConnector(connector);
    }, `${connector.label} account mappings could not be saved`);
  }
  async resume(job: ImportJob) { await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/resume`, {})); await this.reloadImportData(); }, 'Import job could not be resumed'); }
  async pause(job: ImportJob) { await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/pause`, {})); await this.reloadImportData(); }, 'Import job could not be paused'); }
  async retryFailed(job: ImportJob) { await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/retry-failed`, {})); await this.reloadImportData(); }, 'Failed chunks could not be retried'); }
  async cancelImport(job: ImportJob) { if (!confirm(`Cancel ${job.fileName}?`)) return; await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/cancel`, {})); await this.reloadImportData(); }, 'Import job could not be cancelled'); }
  async decideApproval(job: ImportJob, approved: boolean) { if (!approved && !confirm(`Reject ${job.fileName}? The import will be cancelled.`)) return; await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/approval`, { approved, note: '' })); this.drawer = ''; this.selectedJob = null; this.migration.clearGovernance(); await this.reloadImportData(); }, 'Commit approval is blocked until Yellow, Red, duplicate and dependency issues are resolved'); }
  async approveYellowWarnings(job: ImportJob) { await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/yellow-approval`, {})); await this.migration.loadGovernance(job.id); await this.reloadImportData(); }, 'Current Yellow warnings could not be approved'); }
  async approveOpeningPayableFinance(job: ImportJob) { await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/opening-payable-controls`, { openingBalanceAccount: this.openingPayableOffsetAccount, payableAccount: 'ACCOUNTS_PAYABLE', supplierAdvanceAccount: 'SUPPLIER_ADVANCE_ASSET', note: '' })); await this.migration.loadGovernance(job.id); await this.reloadImportData(); }, 'Opening payable finance approval is blocked'); }
  async confirmOpeningPayableBranch(job: ImportJob) { await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/opening-payable-branch-confirmation`, { approved: true, note: '' })); await this.migration.loadGovernance(job.id); await this.reloadImportData(); }, 'Branch Manager confirmation is blocked'); }
  async reviewJob(job: ImportJob) { this.selectedJob = job; this.quarantineSelected = {}; this.quarantineCorrections = {}; this.drawer = 'governance'; await this.action(async () => { await this.migration.loadGovernance(job.id); const account = this.governance?.openingPayablePreview?.summary?.openingBalanceAccount; this.openingPayableOffsetAccount = account === 'RETAINED_EARNINGS' ? 'RETAINED_EARNINGS' : 'OWNER_EQUITY'; for (const row of this.governance?.quarantine.records || []) this.quarantineCorrections[this.quarantineKey(row)] = JSON.stringify(row.correction || {}, null, 0); if (job.status === 'failed') await this.migration.loadFailureAssistant(job.id); }, 'Governance report could not be loaded'); }
  async downloadProofPack(job: ImportJob) { await this.action(async () => { const blob = await firstValueFrom(this.api.getBlob(`/settings/integrations/import-jobs/${job.id}/proof-pack`)); this.downloadBlob(blob, `migration-proof-${job.id}.json`); }, 'Proof pack could not be downloaded'); }
  async downloadFailedRows(job: ImportJob) { await this.action(async () => { const blob = await firstValueFrom(this.api.getBlob(`/settings/integrations/import-jobs/${job.id}/failed-rows`)); this.downloadBlob(blob, `migration-failed-rows-${job.id}.csv`); }, 'Failed rows could not be exported'); }
  quarantineKey(row: MigrationQuarantineRecord) { return `${row.sourceSheet}:${row.sourceRowNumber}`; }
  async retryQuarantine(job: ImportJob, only?: MigrationQuarantineRecord) {
    if (!this.canManageMigrations) return;
    const rows = only ? [only] : (this.governance?.quarantine.records || []).filter((row) => this.quarantineSelected[this.quarantineKey(row)]);
    if (!rows.length) { this.error = 'Select at least one retry-eligible quarantined row'; return; }
    const sheets = new Set(rows.map((row) => row.sourceSheet));
    if (sheets.size !== 1) { this.error = 'Retry one source sheet per batch'; return; }
    let payload: { sourceSheet: string; sourceRowNumber: number; corrections: Record<string, string> }[];
    try {
      payload = rows.map((row) => { const corrections = JSON.parse(this.quarantineCorrections[this.quarantineKey(row)] || '{}'); if (!corrections || Array.isArray(corrections) || typeof corrections !== 'object' || Object.values(corrections).some((value) => typeof value !== 'string')) throw new Error(); return { sourceSheet: row.sourceSheet, sourceRowNumber: row.sourceRowNumber, corrections }; });
    } catch { this.error = 'Corrections must be a JSON object with source-column string values'; return; }
    if (!confirm(`Approve and retry ${rows.length} corrected row(s)? Successful rows will not be rerun.`)) return;
    await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/quarantine/retry`, { rows: payload, approvePartial: true })); await this.migration.loadGovernance(job.id); await this.reloadImportData(); this.quarantineSelected = {}; }, 'Selective retry could not be queued');
  }
  async downloadErrorExport(job: ImportJob, kind: string) { await this.action(async () => this.downloadBlob(await firstValueFrom(this.api.getBlob(`/settings/integrations/import-jobs/${job.id}/error-exports/${kind}`)), `migration-${kind}-${job.id}.csv`), 'Migration error export failed'); }
  async rollback(job: ImportJob) { await this.action(async () => { const result = await firstValueFrom(this.api.get<ApiEnvelope<any>>(`/settings/integrations/import-jobs/${job.id}/rollback-impact`)); const impact = result.data; if (!impact?.safeToRollback) throw new Error('Rollback has dependent records or the job is not completed'); const actions = impact.actions || {}; if (!confirm(`Rollback ${job.fileName}? Delete ${actions.wouldDelete || 0}, restore ${actions.wouldRestore || 0}, unlink ${actions.wouldUnlink || 0}.`)) return; await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/rollback`, {})); this.drawer = ''; this.selectedJob = null; this.migration.clearGovernance(); await this.reload(); }, 'Import rollback was blocked'); }
  async exportClients() { await this.action(async () => { const result = await firstValueFrom(this.api.get<ApiEnvelope<any[]>>('/clients/bulk/export?pageSize=5000')); this.download(JSON.stringify(result.data || [], null, 2), `clients-${new Date().toISOString().slice(0, 10)}.json`, 'application/json'); }, 'Client export failed'); }
  downloadStaffTemplate() { this.download('employeeCode,firstName,lastName,email,mobilePhone,jobTitle,active\r\n', 'staff-import-template.csv', 'text/csv'); }
  async downloadOpenApi() { await this.action(async () => { const spec = await firstValueFrom(this.api.get<any>('/openapi.json')); this.download(JSON.stringify(spec, null, 2), 'aurashine-openapi-v1.json', 'application/json'); }, 'OpenAPI export failed'); }
  formatDate(value?: string) { return value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'; }
  formatBusinessTime(value: string, timezone: string) { return new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: timezone }).format(new Date(value)); }
  providerLabel(value: string) { return value ? value[0].toUpperCase() + value.slice(1) : 'Provider'; }
  private async action(action: () => Promise<void>, fallback: string) { this.busy = true; this.error = ''; try { await action(); } catch (error) { this.error = this.message(error, fallback); } finally { this.busy = false; } }
  private async uploadSourceFile(file: File) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !['csv', 'xlsx', 'zip'].includes(extension)) throw new Error('Only CSV, XLSX and ZIP files are supported');
    this.uploadStatus = 'Uploading';
    const completed = await this.migration.uploadSourceFile(file, { provider: this.sourceProvider, retentionDays: this.evidenceRetentionDays, sessionId: this.uploadSessionId }, (progress) => this.uploadProgress = progress);
    this.uploadSessionId = completed.sessionId; this.fileName = file.name; this.selectedSourceFileId = completed.sourceFile.id; this.uploadStatus = 'Evidence verified';
    await this.profileSource();
    await this.reloadImportData();
    if (extension === 'csv' && file.size <= 5_000_000) {
      this.csvText = await file.text(); const table = parseCsv(this.csvText); if (table.length < 2) throw new Error('CSV has no data rows'); this.rowCount = table.length - 1;
    }
  }

  private mappingEvaluationRequest() {
    const sourceColumns = parseCsv(this.csvText)[0] || [];
    return this.selectedSourceFileId
      ? { entity: this.entity, sourceProvider: this.sourceProvider, sourceSheet: this.selectedSourceSheet, headerSourceSheet: this.selectedHeaderSourceSheet, sourceFileId: this.selectedSourceFileId, mapping: this.mappingOverrides }
      : { entity: this.entity, sourceProvider: this.sourceProvider, sourceColumns, mapping: this.mappingOverrides };
  }
  private async profileSource() { if (!this.selectedSourceFileId) return; const result = await firstValueFrom(this.api.get<ApiEnvelope<MigrationSourceProfile>>(`/settings/integrations/import-source-files/${this.selectedSourceFileId}/profile`)); this.sourceProfile = result.data || null; if (this.sourceProvider === 'auto' && result.data?.provider) this.sourceProvider = result.data.provider; const match = result.data?.sheets.find((sheet) => sheet.importable && (!this.entity || sheet.targets.includes(this.entity as ImportEntity))); this.selectedSourceSheet = match?.id || ''; this.selectedHeaderSourceSheet = ''; if (!this.entity && match?.targets.length) this.entity = match.targets[0]; }
  private async reloadImportData() { await this.migration.reload(); }
  private async queueSourceDryRun() { await firstValueFrom(this.api.post('/settings/integrations/import-jobs/from-source', { sourceFileId: this.selectedSourceFileId, sourceProvider: this.sourceProvider, sourceSheet: this.selectedSourceSheet, headerSourceSheet: this.selectedHeaderSourceSheet, entity: this.entity, mode: 'dry-run', postingMode: this.isThreeLayerEntity ? this.postingMode : null, cutoverId: this.isThreeLayerEntity ? this.cutoverId.trim() : null, cutoverDate: this.isThreeLayerEntity ? this.cutoverDate : null, mapping: this.selectedMappingId ? {} : this.suggestedMapping, mappingId: this.selectedMappingId || null, duplicateDecisions: this.duplicateDecisions, chunkSize: this.chunkSize, allowPartialImport: false })); await this.reloadImportData(); }
  private zonedParts(iso: string, timezone: string) { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((part) => [part.type, part.value])); return { date: `${parts['year']}-${parts['month']}-${parts['day']}`, time: `${parts['hour']}:${parts['minute']}` }; }
  private zonedIso(date: string, time: string, timezone: string) { const match = `${date}T${time}`.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/); if (!match) throw new Error('Date and time are invalid'); const wanted = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]); let instant = wanted; for (let pass = 0; pass < 3; pass++) { const parts = this.zonedParts(new Date(instant).toISOString(), timezone); const rendered = Date.parse(`${parts.date}T${parts.time}:00Z`); instant += wanted - rendered; } const result = new Date(instant).toISOString(); const verified = this.zonedParts(result, timezone); if (verified.date !== date || verified.time !== time) throw new Error('Selected time does not exist in the business timezone'); return result; }
  private toggle(values: string[], value: string) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }
  private migrationDateIso(value: string) { const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return match ? `${match[3]}-${match[2]}-${match[1]}` : null; }
  private downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
  private download(content: string, name: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.message || error?.message || fallback; }
}
