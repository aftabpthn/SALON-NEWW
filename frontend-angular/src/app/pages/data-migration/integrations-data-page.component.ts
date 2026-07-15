import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';
import { parseCsv } from './csv-import';

type Tab = 'Overview' | 'Integrations' | 'API Keys' | 'Webhooks' | 'Imports' | 'Exports';
type Provider = { provider: string; enabled: boolean; webhookConfigured: boolean; environment: string };
type ConnectorRow = { provider: 'quickbooks' | 'xero' | 'netsuite' | 'google' | 'zapier'; label: string; category: string; authMode: string; configured: boolean; status: string; externalAccountId: string; externalAccountName: string; lastSyncedAt?: string; lastError: string };
type ConnectorSyncJob = { id: string; provider: string; triggerSource: string; status: string; attempts: number; lastError: string; createdAt: string; completedAt?: string };
type ApiKeyRow = { id: string; name: string; keyPrefix: string; scopesJson: string[]; status: string; lastUsedAt?: string; createdAt: string };
type WebhookRow = { id: string; name: string; endpointUrl: string; events: string[]; active: boolean; updatedAt: string };
type ImportIssue = { code: string; message: string };
type ImportAnalysisRow = { sourceRowNumber: number; sourceExternalId: string; status: string; errors: ImportIssue[]; warnings: ImportIssue[]; duplicateTargetId?: string; duplicateDecision?: 'merge' | 'keep' | 'link' };
type ImportEntity = 'clients' | 'staff' | 'services' | 'products' | 'suppliers' | 'inventory' | 'memberships' | 'packages';
type ImportAnalysis = { entity: ImportEntity; mapping: Record<string, string>; unmatchedColumns: string[]; rows: ImportAnalysisRow[]; summary: { sourceRows: number; validRows: number; errorRows: number; warningRows: number; duplicateRows: number; readyRows: number } };
type ImportMapping = { id: string; name: string; entity: ImportEntity; mapping: Record<string, string>; sourceColumns: string[] };
type ImportTemplate = { entity: ImportEntity; columns: { field: string; required: boolean; aliases: string[] }[] };
type ImportJob = { id: string; entity: string; fileName: string; mode: string; status: string; errorsJson: { row: number; message: string }[]; totalRows: number; processedRows: number; warningRowCount: number; duplicateRowCount: number; lastError: string; sourceFileId?: string; chunkSize: number; allowPartialImport: boolean; workerPhase: string; heartbeatAt?: string; totalChunks: number; completedChunks: number; failedChunks: number; analysisJson?: ImportAnalysis; createdAt: string };
type UploadSession = { id: string; missingParts: number[]; receivedBytes: number; expectedSizeBytes: number; status: string };
type SourceFile = { id: string; originalFileName: string; format: string; sizeBytes: number; sha256: string; evidenceStatus: string; readOnly: boolean; artifacts: { id: string; entryName: string }[]; createdAt: string };

@Component({
  selector: 'page-integrations-data', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './integrations-data-page.component.html', styleUrls: ['./integrations-data-page.component.css', './integrations-data-connectors.css'],
})
export class IntegrationsDataPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly tabs: Tab[] = ['Overview', 'Integrations', 'API Keys', 'Webhooks', 'Imports', 'Exports'];
  readonly apiScopes = ['clients.read', 'appointments.read', 'sales.read'];
  readonly webhookEvents = ['client.created', 'appointment.created', 'appointment.status_changed', 'sale.status_changed'];
  activeTab: Tab = 'Imports'; providers: Provider[] = []; connectors: ConnectorRow[] = []; connectorJobs: ConnectorSyncJob[] = []; apiKeys: ApiKeyRow[] = []; webhooks: WebhookRow[] = []; jobs: ImportJob[] = []; sourceFiles: SourceFile[] = []; importMappings: ImportMapping[] = []; importTemplates: ImportTemplate[] = [];
  drawer: 'import' | 'api-key' | 'webhook' | '' = ''; entity: ImportEntity | '' = ''; mode: 'dry-run' | 'commit' = 'dry-run';
  fileName = ''; csvText = ''; rowCount = 0; selectedMappingId = ''; mappingName = ''; importAnalysis: ImportAnalysis | null = null; duplicateDecisions: Record<string, 'merge' | 'keep' | 'link'> = {}; chunkSize = 5000; allowPartialImport = false; apiKeyDraft = { name: '', scopes: ['clients.read'] as string[] };
  webhookDraft = { name: '', endpointUrl: '', events: ['client.created'] as string[] }; revealedSecret = '';
  netsuiteAccountId = '';
  selectedSourceFile: File | null = null; selectedSourceFileId = ''; uploadSessionId = ''; uploadProgress = 0; uploadStatus = '';
  private refreshTimer = 0;
  busy = false; loading = true; error = '';

  async ngOnInit() { if (new URL(location.href).searchParams.get('connector')) this.activeTab = 'Integrations'; await this.reload(); this.refreshTimer = window.setInterval(() => { if (!this.busy && this.jobs.some((job) => ['staging', 'queued', 'processing'].includes(job.status))) void this.reloadImportData(); }, 5000); }
  ngOnDestroy() { window.clearInterval(this.refreshTimer); }
  async reload() {
    this.loading = true; this.error = '';
    try {
      const [payments, delivery, connectors, connectorJobs, keys, hooks, jobs, sourceFiles, mappings, templates] = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<Provider[]>>('/pos/payment-providers')),
        firstValueFrom(this.api.get<ApiEnvelope<Provider[]>>('/settings/integrations/delivery-providers')),
        firstValueFrom(this.api.get<ApiEnvelope<ConnectorRow[]>>('/settings/integrations/connectors')),
        firstValueFrom(this.api.get<ApiEnvelope<ConnectorSyncJob[]>>('/settings/integrations/connector-sync-jobs')),
        firstValueFrom(this.api.get<ApiEnvelope<ApiKeyRow[]>>('/settings/integrations/api-keys')),
        firstValueFrom(this.api.get<ApiEnvelope<WebhookRow[]>>('/settings/integrations/webhooks')),
        firstValueFrom(this.api.get<ApiEnvelope<ImportJob[]>>('/settings/integrations/import-jobs')),
        firstValueFrom(this.api.get<ApiEnvelope<SourceFile[]>>('/settings/integrations/import-source-files')),
        firstValueFrom(this.api.get<ApiEnvelope<ImportMapping[]>>('/settings/integrations/import-mappings')),
        firstValueFrom(this.api.get<ApiEnvelope<ImportTemplate[]>>('/settings/integrations/import-templates')),
      ]);
      this.providers = [...(delivery.data || []), ...(payments.data || [])]; this.connectors = connectors.data || []; this.connectorJobs = connectorJobs.data || []; this.apiKeys = keys.data || []; this.webhooks = hooks.data || []; this.jobs = jobs.data || []; this.sourceFiles = sourceFiles.data || []; this.importMappings = mappings.data || []; this.importTemplates = templates.data || [];
    } catch (error) { this.error = this.message(error, 'Integration data could not be loaded'); }
    finally { this.loading = false; }
  }

  openImport() { this.entity = ''; this.mode = 'dry-run'; this.fileName = ''; this.csvText = ''; this.rowCount = 0; this.selectedMappingId = ''; this.mappingName = ''; this.importAnalysis = null; this.duplicateDecisions = {}; this.chunkSize = 5000; this.allowPartialImport = false; this.selectedSourceFile = null; this.selectedSourceFileId = ''; this.uploadSessionId = ''; this.uploadProgress = 0; this.uploadStatus = ''; this.drawer = 'import'; }
  queueEvidence(file: SourceFile) { this.openImport(); this.fileName = file.originalFileName; this.selectedSourceFileId = file.id; this.uploadStatus = 'Evidence verified'; }
  openApiKey() { this.apiKeyDraft = { name: '', scopes: ['clients.read'] }; this.revealedSecret = ''; this.drawer = 'api-key'; }
  openWebhook() { this.webhookDraft = { name: '', endpointUrl: '', events: ['client.created'] }; this.revealedSecret = ''; this.drawer = 'webhook'; }
  closeDrawer() { if (!this.busy) this.drawer = ''; }
  toggleScope(scope: string) { this.apiKeyDraft.scopes = this.toggle(this.apiKeyDraft.scopes, scope); }
  toggleEvent(event: string) { this.webhookDraft.events = this.toggle(this.webhookDraft.events, event); }

  async chooseFile(event: Event) {
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; this.error = ''; this.csvText = ''; this.fileName = ''; this.rowCount = 0; this.importAnalysis = null; this.duplicateDecisions = {}; this.selectedSourceFileId = ''; this.uploadSessionId = ''; this.uploadProgress = 0; this.uploadStatus = '';
    if (!file) return;
    this.selectedSourceFile = file;
    this.busy = true;
    try { if (!this.entity) throw new Error('Select entity before choosing a file'); await this.uploadSourceFile(file); }
    catch (error) { this.error = this.message(error, error instanceof Error ? error.message : 'Source file could not be uploaded'); if (this.uploadStatus !== 'Evidence verified') this.uploadStatus = 'Upload paused'; }
    finally { this.busy = false; input.value = ''; }
  }
  async resumeSourceUpload() { if (!this.selectedSourceFile || !this.uploadSessionId) return; await this.action(() => this.uploadSourceFile(this.selectedSourceFile!), 'Source upload could not be resumed'); }
  entityChanged() { this.selectedMappingId = ''; this.importAnalysis = null; this.duplicateDecisions = {}; }
  get availableMappings() { return this.importMappings.filter((mapping) => mapping.entity === this.entity); }
  get activeTemplate() { return this.importTemplates.find((template) => template.entity === this.entity); }
  get analysisRows() { return (this.importAnalysis?.rows || []).slice(0, 100); }
  duplicateDecisionKey(row: ImportAnalysisRow) { return row.sourceExternalId || String(row.sourceRowNumber); }
  hasUnresolvedDuplicates() { return !!this.importAnalysis?.rows.some((row) => row.status === 'duplicate' && !this.duplicateDecisions[this.duplicateDecisionKey(row)]); }
  async analyzeImport() {
    if (!this.entity || !this.csvText) return;
    await this.action(async () => {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<ImportAnalysis>>('/settings/integrations/import-jobs/analyze', { entity: this.entity, csv: this.csvText, mappingId: this.selectedMappingId || null, duplicateDecisions: this.duplicateDecisions }));
      this.importAnalysis = result.data || null;
    }, 'Import analysis failed');
  }
  async chooseDuplicateDecision(row: ImportAnalysisRow, decision: string) {
    const key = this.duplicateDecisionKey(row);
    if (!decision) delete this.duplicateDecisions[key]; else this.duplicateDecisions[key] = decision as 'merge' | 'keep' | 'link';
    await this.analyzeImport();
  }
  async saveCurrentMapping() {
    if (!this.entity || !this.mappingName.trim() || !this.importAnalysis) return;
    await this.action(async () => {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<ImportMapping>>('/settings/integrations/import-mappings', { name: this.mappingName.trim(), entity: this.entity, mapping: this.importAnalysis!.mapping, sourceColumns: Object.keys(this.importAnalysis!.mapping) }));
      if (result.data) { this.importMappings = [result.data, ...this.importMappings.filter((mapping) => mapping.id !== result.data!.id)]; this.selectedMappingId = result.data.id; }
    }, 'Import mapping could not be saved');
  }
  async applyImport() {
    if (!this.entity || (!this.csvText && !this.selectedSourceFileId)) return;
    if (!this.csvText) {
      await this.action(async () => { await firstValueFrom(this.api.post('/settings/integrations/import-jobs/from-source', { sourceFileId: this.selectedSourceFileId, entity: this.entity, mode: this.mode, mappingId: this.selectedMappingId || null, duplicateDecisions: this.duplicateDecisions, chunkSize: this.chunkSize, allowPartialImport: this.allowPartialImport })); this.drawer = ''; await this.reloadImportData(); }, 'Large import job could not be created');
      return;
    }
    if (!this.importAnalysis) { await this.analyzeImport(); if (!this.importAnalysis) return; }
    if (this.importAnalysis.summary.errorRows || this.hasUnresolvedDuplicates()) { this.error = 'Resolve row errors and duplicate decisions before creating the job'; return; }
    await this.action(async () => { await firstValueFrom(this.api.post('/settings/integrations/import-jobs', { entity: this.entity, fileName: this.fileName, mode: this.mode, csv: this.csvText, mappingId: this.selectedMappingId || null, duplicateDecisions: this.duplicateDecisions })); this.drawer = ''; await this.reload(); }, 'Import job could not be created');
  }
  async downloadEvidence(file: SourceFile) { await this.action(async () => { const blob = await firstValueFrom(this.api.getBlob(`/settings/integrations/import-source-files/${file.id}/evidence`)); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.originalFileName; anchor.click(); URL.revokeObjectURL(url); }, 'Source evidence could not be downloaded'); }
  async saveApiKey() { if (!this.apiKeyDraft.name.trim() || !this.apiKeyDraft.scopes.length) return; await this.action(async () => { const result = await firstValueFrom(this.api.post<ApiEnvelope<any>>('/settings/integrations/api-keys', this.apiKeyDraft)); this.revealedSecret = result.data?.apiKey || ''; await this.reload(); }, 'API key could not be created'); }
  async rotateApiKey(row: ApiKeyRow) { await this.action(async () => { const result = await firstValueFrom(this.api.post<ApiEnvelope<any>>(`/settings/integrations/api-keys/${row.id}/rotate`, {})); this.revealedSecret = result.data?.apiKey || ''; await this.reload(); }, 'API key could not be rotated'); }
  async revokeApiKey(row: ApiKeyRow) { if (!confirm(`Revoke ${row.name}?`)) return; await this.action(async () => { await firstValueFrom(this.api.delete(`/settings/integrations/api-keys/${row.id}`)); await this.reload(); }, 'API key could not be revoked'); }
  async saveWebhook() { if (!this.webhookDraft.name.trim() || !this.webhookDraft.endpointUrl.trim() || !this.webhookDraft.events.length) return; await this.action(async () => { const result = await firstValueFrom(this.api.post<ApiEnvelope<any>>('/settings/integrations/webhooks', this.webhookDraft)); this.revealedSecret = result.data?.signingSecret || ''; await this.reload(); }, 'Webhook could not be created'); }
  async testWebhook(row: WebhookRow) { await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/webhooks/${row.id}/test`, {})); }, 'Webhook test could not be queued'); }
  async deactivateWebhook(row: WebhookRow) { if (!confirm(`Deactivate ${row.name}?`)) return; await this.action(async () => { await firstValueFrom(this.api.delete(`/settings/integrations/webhooks/${row.id}`)); await this.reload(); }, 'Webhook could not be deactivated'); }
  async connectConnector(row: ConnectorRow) {
    if (row.provider === 'zapier') { this.activeTab = 'API Keys'; return; }
    if (!row.configured) { this.error = `${row.label} credentials are not configured`; return; }
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
  async resume(job: ImportJob) { await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/resume`, {})); await this.reload(); }, 'Import job could not be resumed'); }
  async pause(job: ImportJob) { await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/pause`, {})); await this.reloadImportData(); }, 'Import job could not be paused'); }
  async retryFailed(job: ImportJob) { await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/retry-failed`, {})); await this.reloadImportData(); }, 'Failed chunks could not be retried'); }
  async cancelImport(job: ImportJob) { if (!confirm(`Cancel ${job.fileName}?`)) return; await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/cancel`, {})); await this.reloadImportData(); }, 'Import job could not be cancelled'); }
  async rollback(job: ImportJob) { if (!confirm(`Rollback ${job.fileName}? Imported records will be removed.`)) return; await this.action(async () => { await firstValueFrom(this.api.post(`/settings/integrations/import-jobs/${job.id}/rollback`, {})); await this.reload(); }, 'Import rollback was blocked'); }
  async exportClients() { await this.action(async () => { const result = await firstValueFrom(this.api.get<ApiEnvelope<any[]>>('/clients/bulk/export?pageSize=5000')); this.download(JSON.stringify(result.data || [], null, 2), `clients-${new Date().toISOString().slice(0, 10)}.json`, 'application/json'); }, 'Client export failed'); }
  downloadStaffTemplate() { this.download('employeeCode,firstName,lastName,email,mobilePhone,jobTitle,active\r\n', 'staff-import-template.csv', 'text/csv'); }
  async downloadOpenApi() { await this.action(async () => { const spec = await firstValueFrom(this.api.get<any>('/openapi.json')); this.download(JSON.stringify(spec, null, 2), 'aurashine-openapi-v1.json', 'application/json'); }, 'OpenAPI export failed'); }
  formatDate(value?: string) { return value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'; }
  providerLabel(value: string) { return value ? value[0].toUpperCase() + value.slice(1) : 'Provider'; }
  private async action(action: () => Promise<void>, fallback: string) { this.busy = true; this.error = ''; try { await action(); } catch (error) { this.error = this.message(error, fallback); } finally { this.busy = false; } }
  private async uploadSourceFile(file: File) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !['csv', 'xlsx', 'zip'].includes(extension)) throw new Error('Only CSV, XLSX and ZIP files are supported');
    if (!file.size || file.size > 500 * 1024 * 1024) throw new Error('File must be between 1 byte and 500 MB');
    const partSize = 8 * 1024 * 1024; const totalParts = Math.ceil(file.size / partSize);
    let session: UploadSession;
    if (!this.uploadSessionId) {
      const created = await firstValueFrom(this.api.post<ApiEnvelope<UploadSession>>('/settings/integrations/import-uploads', { fileName: file.name, contentType: file.type || 'application/octet-stream', sizeBytes: file.size, totalParts }));
      if (!created.data) throw new Error('Upload session was not created'); this.uploadSessionId = created.data.id; session = created.data;
    } else {
      const existing = await firstValueFrom(this.api.get<ApiEnvelope<UploadSession>>(`/settings/integrations/import-uploads/${this.uploadSessionId}`));
      if (!existing.data) throw new Error('Upload session was not found'); session = existing.data;
    }
    this.uploadStatus = 'Uploading';
    for (const partNumber of session.missingParts) {
      const chunk = file.slice((partNumber - 1) * partSize, Math.min(partNumber * partSize, file.size), file.type || 'application/octet-stream');
      const hash = await this.sha256(chunk);
      const receipt = await firstValueFrom(this.api.putBytes<ApiEnvelope<{ session: UploadSession }>>(`/settings/integrations/import-uploads/${this.uploadSessionId}/parts/${partNumber}`, chunk, { 'X-Part-Sha256': hash }));
      this.uploadProgress = Math.round(100 * (receipt.data?.session.receivedBytes || 0) / file.size);
    }
    const completed = await firstValueFrom(this.api.post<ApiEnvelope<{ sourceFile: SourceFile }>>(`/settings/integrations/import-uploads/${this.uploadSessionId}/complete`, {}));
    if (!completed.data?.sourceFile) throw new Error('Source evidence was not finalized');
    this.fileName = file.name; this.selectedSourceFileId = completed.data.sourceFile.id; this.uploadProgress = 100; this.uploadStatus = 'Evidence verified';
    await this.reloadImportData();
    if (extension === 'csv' && file.size <= 5_000_000) {
      this.csvText = await file.text(); const table = parseCsv(this.csvText); if (table.length < 2) throw new Error('CSV has no data rows'); this.rowCount = table.length - 1;
    }
  }
  private async reloadImportData() { const [jobs, files] = await Promise.all([firstValueFrom(this.api.get<ApiEnvelope<ImportJob[]>>('/settings/integrations/import-jobs')), firstValueFrom(this.api.get<ApiEnvelope<SourceFile[]>>('/settings/integrations/import-source-files'))]); this.jobs = jobs.data || []; this.sourceFiles = files.data || []; }
  private async sha256(blob: Blob) { const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
  private toggle(values: string[], value: string) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }
  private download(content: string, name: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
  private message(error: any, fallback: string) { return error?.error?.error?.message || error?.error?.message || fallback; }
}
