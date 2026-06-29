import { Injectable, computed, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';

type MigrationSummary = {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  duplicateRows: number;
  affectedRecords?: number;
  byEntity: Record<string, { total: number; valid: number; warnings: number; errors: number; duplicates: number }>;
  byBranch?: Record<string, { total: number; valid: number; warnings: number; errors: number }>;
};

type SourceAdapter = { label: string; type: string; formats: string[]; status: string };

type MigrationTemplate = { resource: string; table: string; required: string[]; columns: Array<{ field: string; required: boolean; aliases: string[]; example: string }> };

type MappingDraftRow = { targetField: string; sourceColumn: string; required: boolean; confidence: number; aliases: string[] };

type ReconciliationLine = { metric: string; expected: number | null; actual: number; difference: number | null; match: boolean | null; status: string };

type LargeReconciliationSnapshot = { id: string; status: 'passed' | 'warning' | 'failed' | string; snapshotType?: string; createdAt?: string; expected?: any; actual?: any; differences?: Array<{ code?: string; severity?: string; resource?: string; expected?: number; actual?: number; missing?: number; message?: string }> };

type ApprovalRecord = { id: string; jobId?: string; resource?: string; sourceSoftware?: string; fileName?: string; sourceFileHash?: string; totalRows?: number; errorCount?: number; warningCount?: number; validRows?: number; importableRows?: number; status: string; note?: string; submittedAt?: string; reviewedAt?: string; summary?: any };

type LargeMigrationJob = { id: string; status: string; totalRows?: number; processedRows?: number; validRows?: number; importedRows?: number; skippedRows?: number; errorRows?: number; warningRows?: number; chunkSize?: number; resumeToken?: string; sourceSoftware?: string; resource?: string; fileName?: string; sourceFileHash?: string; settings?: { sourceFileHash?: string; sourceEvidence?: any } & Record<string, any>; chunks?: Array<{ id: string; chunkNumber: number; status: string; totalRows: number; importedRows?: number; skippedRows?: number; errorRows?: number; warningRows?: number; checksum?: string; completedAt?: string; failureReason?: string }>; reconciliations?: LargeReconciliationSnapshot[] };

type MigrationRecoveryReport = { status: string; blockers: string[]; summary: { totalRows: number; importedRows: number; failedRows: number; warningRows: number; retryCandidates: number; missingLiveTargets: number; batches: number }; failedRows: Array<{ rowKey: string; resource: string; sourceExternalId?: string; message: string; retryable: boolean; retryReason: string }>; warningRows: Array<{ rowKey: string; resource: string; sourceExternalId?: string; message: string; retryable: boolean; retryReason: string }>; retryCandidates: Array<{ rowKey: string; resource: string; sourceExternalId?: string; message: string; retryable: boolean; retryReason: string }>; rollbackPlan?: { recommended: boolean; endpoint: string; batches: Array<{ batchId: string; status: string; resource: string; importedRows: number; errorRows: number; createdAt?: string }> }; idMapCoverage?: Record<string, Record<string, number>>; missingLiveTargets?: Array<{ rowKey: string; resource: string; sourceExternalId?: string; targetId?: string; message: string }>; nextActions: string[] };

@Injectable({ providedIn: 'root' })
export class DataMigrationStore {
  readonly sourceOptions = [
    { value: 'zenoti', label: 'Zenoti' },
    { value: 'salonist', label: 'Salonist' },
    { value: 'dingg', label: 'DINGG' },
    { value: 'fresha', label: 'Fresha' },
    { value: 'tally', label: 'Tally' },
    { value: 'busy', label: 'Busy' },
    { value: 'marg', label: 'Marg' },
    { value: 'excel', label: 'Generic Excel' },
    { value: 'csv', label: 'Generic CSV' },
    { value: 'manual', label: 'Manual records' }
  ];
  readonly resourceOptions = [
    { value: 'clients', label: 'Clients' },
    { value: 'staff', label: 'Staff' },
    { value: 'services', label: 'Services' },
    { value: 'products', label: 'Products' },
    { value: 'inventory', label: 'Inventory' },
    { value: 'vendors', label: 'Vendors' },
    { value: 'expenses', label: 'Expenses' },
    { value: 'memberships', label: 'Memberships' },
    { value: 'appointments', label: 'Appointments' },
    { value: 'sales', label: 'Sales' },
    { value: 'invoices', label: 'Invoices' },
    { value: 'payments', label: 'Payments' }
  ];
  readonly expectedMetrics = [
    { key: 'clients', label: 'Clients' },
    { key: 'appointments', label: 'Appointments' },
    { key: 'invoices', label: 'Invoices' },
    { key: 'payments', label: 'Payments' },
    { key: 'revenue', label: 'Revenue total' }
  ];

  sourceSoftware = 'dingg';
  resource = '';
  selectedMappingId = '';
  approvalNote = '';
  rowFilter = signal<'all' | 'error' | 'warning' | 'duplicate'>('all');
  fileBase64 = signal('');
  fileName = signal('');
  fileSize = signal(0);
  loading = signal(false);
  error = signal('');
  message = signal('');
  summary = signal<MigrationSummary | null>(null);
  previewRows = signal<any[]>([]);
  jobs = signal<any[]>([]);
  onboarding = signal<any | null>(null);
  adapters = signal<Record<string, SourceAdapter>>({});
  templates = signal<Record<string, MigrationTemplate>>({});
  mappings = signal<any[]>([]);
  mappingDraft = signal<MappingDraftRow[]>([]);
  duplicateDecisions = signal<Record<string, 'merge' | 'keep' | 'link'>>({});
  expectedTotals = signal<Record<string, number>>({});
  reconciliationResult = signal<any | null>(null);
  approvals = signal<ApprovalRecord[]>([]);
  selectedJob = signal<any | null>(null);
  selectedJobRecovery = signal<MigrationRecoveryReport | null>(null);
  migrationProgress = signal(0);
  liveClientStats = signal({ total: 0, migrated: 0 });
  sandboxMode = signal(true);
  maskPreviewPii = signal(true);
  rollbackReason = signal('');
  assistantQuestion = signal('');
  assistantAnswer = signal('');
  approvalDebug = signal('');
  largeJob = signal<LargeMigrationJob | null>(null);
  largeChunkSize = signal(5000);
  largeMaxChunks = signal(5);
  allowPartialLargeImport = signal(false);
  lastWorkerResult = signal<any | null>(null);
  csvStagedRows = signal(0);
  csvStagedChunks = signal(0);
  private selectedSourceFile: File | null = null;
  private readonly emptyTemplateColumns: MigrationTemplate['columns'] = [];
  private relevantMappingsCacheKey = '';
  private relevantMappingsCacheSource: any[] | null = null;
  private relevantMappingsCache: any[] = [];

  entityRows = computed(() => {
    const summary = this.summary();
    if (!summary?.byEntity) return [];
    return Object.entries(summary.byEntity).map(([entity, value]) => ({ entity, ...value }));
  });

  hasCriticalErrors = computed(() => Boolean(this.summary()?.errorRows));
  mappingDraftPreview = computed(() => this.mappingDraft().slice(0, 10));
  recentApprovals = computed(() => this.approvals().slice(0, 5));
  duplicatePreviewRows = computed(() => this.duplicateRows().slice(0, 8));
  selectedJobRows = computed(() => (this.selectedJob()?.rows || []).slice(0, 200));
  recoveryFailedRows = computed(() => this.selectedJobRecovery()?.failedRows?.slice(0, 50) || []);
  recoveryNextActions = computed(() => this.selectedJobRecovery()?.nextActions || []);
  reconciliationLines = computed<ReconciliationLine[]>(() => this.reconciliationResult()?.lines || []);
  largeJobChunks = computed(() => this.largeJob()?.chunks || []);
  largeReadyChunks = computed(() => this.largeJobChunks().filter((chunk) => ['analyzed', 'analyzed_with_errors', 'failed'].includes(chunk.status)).length);
  largePendingChunks = computed(() => this.largeJobChunks().filter((chunk) => !['analyzed', 'analyzed_with_errors', 'failed', 'imported', 'imported_with_errors', 'rolled_back', 'cancelled'].includes(chunk.status)).length);
  latestLargeReconciliation = computed(() => this.largeJob()?.reconciliations?.[0] || null);
  largeReconciliationDifferences = computed(() => this.latestLargeReconciliation()?.differences || []);
  completionChecklist = computed(() => this.onboarding()?.completionChecklist || [
    { label: 'Upload source file', done: Boolean(this.fileBase64()) },
    { label: 'Run analyze', done: Boolean(this.summary()) },
    { label: 'Resolve critical errors', done: !this.hasCriticalErrors() },
    { label: 'Run dry-run validation', done: false },
    { label: 'Owner final sign-off', done: false }
  ]);
  validationQueues = computed<Array<{ status: 'all' | 'error' | 'warning' | 'duplicate'; label: string; count: number; detail: string }>>(() => {
    const rows = this.previewRows();
    const errors = rows.filter((row) => row.status === 'error').length;
    const warnings = rows.filter((row) => row.status === 'warning').length;
    return [
      { status: 'error', label: 'Critical fixes', count: errors, detail: errors ? 'Must resolve before import' : 'No blockers' },
      { status: 'warning', label: 'Review queue', count: warnings, detail: warnings ? 'Can import with owner sign-off' : 'No warnings' },
      { status: 'duplicate', label: 'Duplicate conflicts', count: this.duplicateRows().length, detail: 'Merge / keep / link required' },
      { status: 'all', label: 'All decisions', count: rows.length, detail: 'Full row-level report' }
    ];
  });
  enterpriseChecklist = computed(() => [
    { label: 'File size under 20MB', done: Boolean(this.fileBase64()) && this.fileSize() <= 20 * 1024 * 1024 },
    { label: 'Required mapping fields completed', done: this.requiredMappingComplete() },
    { label: 'No critical errors', done: !this.hasCriticalErrors() && Boolean(this.summary()) },
    { label: 'Duplicate decisions reviewed', done: !this.duplicateRows().length || this.duplicateDecisionCount() === this.duplicateRows().length },
    { label: 'Owner approval received', done: this.importApprovalReady() },
    { label: 'Sandbox mode reviewed before live import', done: this.sandboxMode() || this.importApprovalReady() }
  ]);
  anomalyCards = computed<Array<{ label: string; count: number; detail: string; tone: string }>>(() => {
    const rows = this.previewRows();
    const invalidDates = rows.filter((row) => /date|future|invalid/i.test(String(row.message || ''))).length;
    const badPhone = rows.filter((row) => /phone|mobile/i.test(String(row.message || ''))).length;
    const badMoney = rows.filter((row) => /negative|amount|payment|invoice|discount/i.test(String(row.message || ''))).length;
    return [
      { label: 'Invalid dates', count: invalidDates, detail: 'Future/invalid appointment or invoice dates', tone: invalidDates ? 'warning' : 'good' },
      { label: 'Phone/email issues', count: badPhone, detail: 'PII and contact validation issues', tone: badPhone ? 'warning' : 'good' },
      { label: 'Money anomalies', count: badMoney, detail: 'Negative invoice/payment/discount issues', tone: badMoney ? 'danger' : 'good' }
    ];
  });

  readinessScore = computed(() => {
    const summary = this.summary();
    const onboarding = this.onboarding();
    let score = 15;
    if (this.fileBase64()) score += 15;
    if (summary?.totalRows) score += 20;
    if (summary?.totalRows) score += Math.round((Number(summary.validRows || 0) / Math.max(1, Number(summary.totalRows || 1))) * 25);
    if (onboarding?.completionChecklist?.some((item: any) => item.key === 'dryRun' && item.done)) score += 10;
    if (summary && !summary.errorRows) score += 10;
    if (this.jobs().some((job) => Number(job.importedRows || 0) > 0)) score += 5;
    return Math.max(0, Math.min(100, score - Math.min(30, Number(summary?.errorRows || 0) * 3)));
  });

  pipelineSteps = computed(() => {
    const summary = this.summary();
    const hasFile = Boolean(this.fileBase64());
    const hasErrors = Number(summary?.errorRows || 0) > 0;
    const imported = this.jobs().some((job) => Number(job.importedRows || 0) > 0 && job.status !== 'rolled_back');
    return [
      { key: '01', label: 'Upload', detail: hasFile ? this.fileName() : 'Waiting for file', status: hasFile ? 'done' : 'active' },
      { key: '02', label: 'Map', detail: `${this.mappingCoverage()}% field confidence`, status: hasFile ? 'active' : 'blocked' },
      { key: '03', label: 'Validate', detail: summary ? `${summary.errorRows} critical errors` : 'Analyze pending', status: summary ? (hasErrors ? 'blocked' : 'done') : 'blocked' },
      { key: '04', label: 'Dry run', detail: 'No database write', status: summary && !hasErrors ? 'active' : 'blocked' },
      { key: '05', label: 'Import', detail: imported ? 'Live modules updated' : 'Awaiting sign-off', status: imported ? 'done' : (summary && !hasErrors ? 'active' : 'blocked') }
    ];
  });

  riskCards = computed(() => {
    const summary = this.summary();
    const errors = Number(summary?.errorRows || 0);
    const warnings = Number(summary?.warningRows || 0);
    const duplicates = Number(summary?.duplicateRows || 0);
    return [
      { label: 'Critical errors', value: errors, detail: errors ? 'Fix before final import' : 'No hard blocker detected', tone: errors ? 'danger' : 'good' },
      { label: 'Warnings', value: warnings, detail: warnings ? 'Review row-level decisions' : 'Clean validation layer', tone: warnings ? 'warning' : 'good' },
      { label: 'Duplicates', value: duplicates, detail: duplicates ? 'Merge studio review needed' : 'No duplicate pressure', tone: duplicates ? 'warning' : 'good' },
      { label: 'Adapter readiness', value: this.selectedAdapter()?.status || 'ready', detail: this.selectedAdapter()?.formats?.join(', ') || 'xlsx, csv', tone: 'good' }
    ];
  });

  filteredPreviewRows = computed(() => {
    const filter = this.rowFilter();
    const rows = this.previewRows();
    if (filter === 'all') return rows;
    if (filter === 'duplicate') return rows.filter((row) =>
      row.status === 'duplicate'
        || String(row.message || '').toLowerCase().includes('duplicate')
        || String(row.message || '').toLowerCase().includes('already')
    );
    return rows.filter((row) => row.status === filter);
  });

  duplicateRows = computed(() => this.previewRows().filter((row) =>
    row.status === 'duplicate'
      || String(row.message || '').toLowerCase().includes('duplicate')
      || String(row.message || '').toLowerCase().includes('already')
  ));

  reconciliationRows = computed(() => {
    const summary = this.summary();
    const total = Number(summary?.totalRows || 0);
    const valid = Number(summary?.validRows || 0);
    const imported = this.jobs().reduce((sum, job) => sum + Number(job.importedRows || 0), 0);
    const affected = Number(summary?.affectedRecords || 0);
    const liveClients = this.liveClientTotal();
    const tenantClients = this.tenantClientTotal();
    const migratedClients = this.migratedClientTotal();
    return [
      { label: 'Live clients', value: liveClients, detail: tenantClients !== liveClients ? `${tenantClients} clients across all branches` : 'Live client master records' },
      { label: 'Migrated clients', value: migratedClients, detail: 'Imported clients visible in live module' },
      { label: 'Source rows', value: total, detail: 'Rows read from uploaded workbook' },
      { label: 'Aura-ready rows', value: valid, detail: total ? `${Math.round(valid / Math.max(1, total) * 100)}% can move forward` : 'Awaiting analyze' },
      { label: 'Affected records', value: affected, detail: 'Expected create/update impact' },
      { label: 'Historical imported', value: imported, detail: 'Imported rows across all jobs' }
    ];
  });

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.loadIntelligence();
    this.loadJobs();
    this.loadApprovals();
  }

  selectedSourceLabel(): string {
    return this.selectedAdapter()?.label || this.sourceOptions.find((item) => item.value === this.sourceSoftware)?.label || this.sourceSoftware;
  }

  selectedAdapterType(): string {
    return this.selectedAdapter()?.type || 'adapter pending';
  }

  selectedAdapterStatus(): string {
    return this.selectedAdapter()?.status || 'local rule set';
  }

  fileSizeLabel(): string {
    const size = this.fileSize();
    if (!size) return 'Upload .xlsx, .xls or .csv';
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  goLiveGate(): string {
    if (!this.fileBase64()) return 'Upload source file';
    if (this.hasCriticalErrors()) return 'Blocked by validation errors';
    if (!this.summary()) return 'Run analyze';
    if (this.readinessScore() >= 85) return 'Ready for owner sign-off';
    return 'Dry run recommended';
  }

  mappingCoverage(): number {
    const rows = this.mappingDraft();
    if (!rows.length) return 0;
    return Math.round((rows.filter((row) => row.sourceColumn.trim()).length / rows.length) * 100);
  }

  refreshSourceContext(): void {
    this.message.set(`${this.selectedSourceLabel()} adapter selected.`);
    this.rebuildMappingDraft();
  }

  onResourceChange(): void {
    this.selectedMappingId = '';
    this.rebuildMappingDraft();
  }

  templateColumns = () => {
    const key = this.resource || 'clients';
    return this.templates()[key]?.columns || this.emptyTemplateColumns;
  };

  relevantMappings = () => {
    const resource = this.resource || 'clients';
    const mappings = this.mappings();
    const cacheKey = `${resource}|${this.sourceSoftware}|${mappings.length}`;
    if (cacheKey !== this.relevantMappingsCacheKey || mappings !== this.relevantMappingsCacheSource) {
      this.relevantMappingsCacheKey = cacheKey;
      this.relevantMappingsCacheSource = mappings;
      this.relevantMappingsCache = mappings.filter((mapping) => (!mapping.resource || mapping.resource === resource) && (!mapping.sourceSoftware || mapping.sourceSoftware === this.sourceSoftware));
    }
    return this.relevantMappingsCache;
  };

  selectedAdapter = () => this.adapters()[this.sourceSoftware];

  liveClientTotal(): number {
    const onboarding = this.onboarding();
    return Number(this.liveClientStats().total || onboarding?.liveClientBranchCount || onboarding?.liveClientCount || 0);
  }

  tenantClientTotal(): number {
    const onboarding = this.onboarding();
    return Number(onboarding?.liveClientCount ?? this.liveClientTotal());
  }

  migratedClientTotal(): number {
    const onboarding = this.onboarding();
    return Number(this.liveClientStats().migrated || onboarding?.migratedClientBranchCount || onboarding?.migratedClientCount || onboarding?.importedRecordsCount || 0);
  }

  largeMigrationChecklist(): Array<{ label: string; done: boolean }> {
    return [
      { label: 'Source file uploaded', done: this.canPrepareLargeMigration() },
      { label: 'Analyze completed', done: Boolean(this.summary()) },
      { label: 'No critical errors', done: Boolean(this.summary()) && !this.hasCriticalErrors() },
      { label: 'Chunk 1 staged', done: Boolean(this.largeJobChunks().length) },
      { label: 'Owner approval received', done: this.importApprovalReady() },
      { label: 'Worker queued or completed', done: ['queued', 'processing', 'completed'].includes(String(this.largeJob()?.status || '')) }
    ];
  }

  lastWorkerResultText(): string {
    const result = this.lastWorkerResult();
    if (!result) return '';
    const first = Array.isArray(result.results) ? result.results[0] : result;
    if (!first) return 'No queued jobs were ready.';
    return first.ok === false ? first.message || 'Worker failed.' : `${first.status || this.largeJob()?.status || 'processed'} · ${first.processedChunks || 0} chunk(s)`;
  }

  largeJobProgress(): number {
    const job = this.largeJob();
    const total = Number(job?.totalRows || 0);
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round(((Number(job?.importedRows || 0) + Number(job?.skippedRows || 0) + Number(job?.errorRows || 0)) / total) * 100)));
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.selectedSourceFile = file;
    this.fileName.set(file.name);
    this.fileSize.set(file.size);
    this.error.set('');
    this.message.set('');
    this.summary.set(null);
    this.previewRows.set([]);
    this.duplicateDecisions.set({});
    this.reconciliationResult.set(null);
    this.selectedJob.set(null);
    this.selectedJobRecovery.set(null);
    this.largeJob.set(null);
    this.lastWorkerResult.set(null);
    this.csvStagedRows.set(0);
    this.csvStagedChunks.set(0);
    this.fileBase64.set('');
    if (file.size > 20 * 1024 * 1024 && !this.isCsvFile(file)) {
      this.error.set('Excel files over 20MB must be exported as CSV for chunked migration.');
      input.value = '';
      this.selectedSourceFile = null;
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      this.message.set('Large CSV selected. Use Stage CSV chunks for worker import.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.fileBase64.set(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => this.error.set('File read failed.');
    reader.readAsDataURL(file);
  }

  async analyze(): Promise<void> {
    await this.callMigration('migration/analyze', 'Analyze complete. Validation cockpit updated.');
  }

  async dryRun(): Promise<void> {
    await this.callMigration('migration/dry-run', 'Dry run complete. Data was not saved.');
    await this.loadJobs();
  }

  async runImport(): Promise<void> {
    if (!this.importApprovalReady()) {
      this.error.set('Final import blocked: Approval required for this exact upload/job.');
      return;
    }
    if (!this.validateRequiredMapping()) return;
    if (!confirm(`${this.sandboxMode() ? 'Sandbox' : 'Live'} final import database me data save karega. Continue?`)) return;
    await this.callMigration('migration/import', this.sandboxMode() ? 'Sandbox import complete. Review results before live migration.' : 'Final import complete. Data saved in live modules.');
    await this.loadJobs();
  }

  numberInput(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  async prepareLargeMigrationJob(): Promise<void> {
    if (!this.canPrepareLargeMigration()) {
      this.error.set('Select an Excel or CSV file first.');
      return;
    }
    if (!this.fileBase64() && this.isCsvFileSelected()) {
      await this.stageCsvMigrationChunks();
      return;
    }
    if (!this.summary()) await this.analyze();
    const rows = this.previewChunkRows();
    if (!rows.length) {
      this.error.set('Analyze did not return preview rows to stage. Re-run Analyze and try again.');
      return;
    }
    try {
      this.loading.set(true);
      this.error.set('');
      const job = await firstValueFrom(this.api.post<LargeMigrationJob>('migration/large-jobs', {
        sourceSoftware: this.sourceSoftware,
        resource: this.resource || 'auto',
        fileName: this.fileName(),
        fileSizeBytes: this.fileSize(),
        totalRows: this.summary()?.totalRows || rows.length,
        chunkSize: this.largeChunkSize(),
        mapping: Object.fromEntries(this.mappingDraft().filter((row) => row.sourceColumn).map((row) => [row.sourceColumn, row.targetField]))
      }));
      const registered = await firstValueFrom(this.api.post<LargeMigrationJob>(`migration/large-jobs/${job.id}/chunks`, {
        chunkNumber: 1,
        totalRows: rows.length,
        rowStart: 1,
        rowEnd: rows.length,
        sourceSheet: this.previewRows()[0]?.sourceSheet || 'preview'
      }));
      const analyzed = await firstValueFrom(this.api.post<any>(`migration/large-jobs/${job.id}/chunks/1/analyze`, {
        rows,
        duplicateDecisions: this.duplicateDecisions()
      }));
      this.largeJob.set(analyzed.job || registered || job);
      this.message.set('Large migration chunk 1 staged. Queue worker after approval.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to prepare large migration job.'));
    } finally {
      this.loading.set(false);
    }
  }

  canPrepareLargeMigration(): boolean {
    return Boolean(this.fileBase64()) || this.isCsvFileSelected();
  }

  isCsvFileSelected(): boolean {
    return this.isCsvFile(this.selectedSourceFile);
  }

  async stageCsvMigrationChunks(): Promise<void> {
    const file = this.selectedSourceFile;
    if (!this.isCsvFile(file)) {
      this.error.set('Select a CSV file for multi-chunk staging.');
      return;
    }
    try {
      this.loading.set(true);
      this.error.set('');
      this.message.set('Streaming CSV chunks to backend parser...');
      const chunkSize = Math.max(100, this.largeChunkSize());
      const mapping = Object.fromEntries(this.mappingDraft().filter((row) => row.sourceColumn).map((row) => [row.sourceColumn, row.targetField]));
      const estimatedRows = await this.estimateCsvRows(file);
      const job = await firstValueFrom(this.api.post<LargeMigrationJob>('migration/large-jobs', {
        sourceSoftware: this.sourceSoftware,
        resource: this.resource || 'auto',
        fileName: this.fileName(),
        fileSizeBytes: this.fileSize(),
        totalRows: estimatedRows,
        chunkSize,
        mapping
      }));
      let latest: LargeMigrationJob = job;
      let header: string[] = [];
      let chunkRecords: string[] = [];
      let chunkNumber = 1;
      let stagedRows = 0;
      for await (const line of this.csvLineIterator(file)) {
        if (!header.length) {
          header = this.parseCsvRecords(line).shift() || [];
          continue;
        }
        if (!line.trim()) continue;
        chunkRecords.push(line);
        if (chunkRecords.length >= chunkSize) {
          latest = await this.stageCsvTextChunk(job.id, chunkNumber, header, chunkRecords, stagedRows + 1);
          stagedRows += chunkRecords.length;
          this.largeJob.set(latest);
          this.csvStagedRows.set(stagedRows);
          this.csvStagedChunks.set(chunkNumber);
          this.migrationProgress.set(estimatedRows ? Math.round((stagedRows / estimatedRows) * 65) : Math.min(65, chunkNumber * 5));
          chunkNumber++;
          chunkRecords = [];
        }
      }
      if (!header.length) {
        this.error.set('CSV header row is missing.');
        return;
      }
      if (chunkRecords.length) {
        latest = await this.stageCsvTextChunk(job.id, chunkNumber, header, chunkRecords, stagedRows + 1);
        stagedRows += chunkRecords.length;
        this.csvStagedChunks.set(chunkNumber);
      }
      this.largeJob.set(latest);
      this.csvStagedRows.set(stagedRows);
      this.summary.set({
        totalRows: stagedRows,
        validRows: Number(latest.validRows || 0),
        warningRows: Number(latest.warningRows || 0),
        errorRows: Number(latest.errorRows || 0),
        duplicateRows: 0,
        affectedRecords: Number(latest.validRows || 0) + Number(latest.warningRows || 0),
        byEntity: {}
      });
      this.previewRows.set([]);
      this.message.set(`${stagedRows} CSV rows streamed across ${this.csvStagedChunks()} chunk(s). Submit approval, then queue worker.`);
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to stream CSV chunks.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async stageCsvTextChunk(jobId: string, chunkNumber: number, header: string[], records: string[], rowStart: number): Promise<LargeMigrationJob> {
    const csvText = records.join('\n');
    const analyzed = await firstValueFrom(this.api.post<any>(`migration/large-jobs/${jobId}/chunks/${chunkNumber}/stage-csv`, {
      header, csvText, rowStart, rowEnd: rowStart + records.length - 1, sourceSheet: 'csv', duplicateDecisions: this.duplicateDecisions()
    }));
    return analyzed.job || this.largeJob() || { id: jobId, status: 'draft' };
  }

  private async estimateCsvRows(file: File): Promise<number> {
    let rows = 0;
    for await (const line of this.csvLineIterator(file)) {
      if (rows === 0 || line.trim()) rows++;
    }
    return Math.max(0, rows - 1);
  }

  private async *csvLineIterator(file: File): AsyncGenerator<string> {
    const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) yield line;
      }
      if (buffer) yield buffer;
    } finally {
      reader.releaseLock();
    }
  }

  private isCsvFile(file: File | null): file is File {
    return Boolean(file && (file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv'));
  }

  async queueLargeMigrationJob(): Promise<void> {
    const job = this.largeJob();
    if (!job) return;
    try {
      this.loading.set(true);
      this.error.set('');
      const queued = await firstValueFrom(this.api.post<LargeMigrationJob>(`migration/large-jobs/${job.id}/queue`, {
        maxChunks: this.largeMaxChunks(), stopOnError: true, migrationMode: true, allowPartialImport: this.allowPartialLargeImport()
      }));
      this.largeJob.set(queued);
      this.message.set('Large migration queued. Worker will process staged chunks.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to queue large migration job.'));
    } finally {
      this.loading.set(false);
    }
  }

  async runWorkerTick(): Promise<void> {
    try {
      this.loading.set(true);
      this.error.set('');
      const result = await firstValueFrom(this.api.post<any>('migration/large-jobs/worker/tick', {
        maxJobs: 1, maxChunks: this.largeMaxChunks(), allowPartialImport: this.allowPartialLargeImport()
      }));
      this.lastWorkerResult.set(result);
      await this.refreshLargeJob();
      this.message.set('Worker tick completed.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Worker tick failed.'));
    } finally {
      this.loading.set(false);
    }
  }

  async refreshLargeJobStatus(): Promise<void> {
    await this.refreshLargeJob();
    this.message.set('Large migration status refreshed.');
  }

  async pauseLargeMigrationJob(): Promise<void> {
    const job = this.largeJob();
    if (!job) return;
    try {
      this.loading.set(true);
      this.error.set('');
      const paused = await firstValueFrom(this.api.post<LargeMigrationJob>(`migration/large-jobs/${job.id}/pause`, { reason: 'operator pause from command center' }));
      this.largeJob.set(paused);
      this.message.set('Large migration paused. Resume when ready.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to pause large migration.'));
    } finally {
      this.loading.set(false);
    }
  }

  async cancelLargeMigrationJob(): Promise<void> {
    const job = this.largeJob();
    if (!job) return;
    if (!confirm('Cancel this large migration job? Imported chunks will remain; pending chunks will be cancelled.')) return;
    try {
      this.loading.set(true);
      this.error.set('');
      const cancelled = await firstValueFrom(this.api.post<LargeMigrationJob>(`migration/large-jobs/${job.id}/cancel`, { reason: 'operator cancel from command center' }));
      this.largeJob.set(cancelled);
      this.message.set('Large migration cancelled.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to cancel large migration.'));
    } finally {
      this.loading.set(false);
    }
  }

  async retryFailedLargeMigrationChunks(): Promise<void> {
    const job = this.largeJob();
    if (!job) return;
    try {
      this.loading.set(true);
      this.error.set('');
      const retry = await firstValueFrom(this.api.post<LargeMigrationJob>(`migration/large-jobs/${job.id}/retry-failed`, {}));
      this.largeJob.set(retry);
      this.message.set('Failed chunks reset for retry. Queue or resume the worker.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to retry failed chunks.'));
    } finally {
      this.loading.set(false);
    }
  }

  async resumeLargeMigrationJob(): Promise<void> {
    const job = this.largeJob();
    if (!job) return;
    try {
      this.loading.set(true);
      this.error.set('');
      const result = await firstValueFrom(this.api.post<any>(`migration/large-jobs/${job.id}/resume`, {
        maxChunks: this.largeMaxChunks(), stopOnError: true, migrationMode: true, allowPartialImport: this.allowPartialLargeImport()
      }));
      this.lastWorkerResult.set(result);
      this.largeJob.set(result.job || this.largeJob());
      this.message.set('Large migration resume completed.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to resume large migration.'));
    } finally {
      this.loading.set(false);
    }
  }

  async runLargeJobReconciliation(): Promise<void> {
    const job = this.largeJob();
    if (!job) return;
    try {
      this.loading.set(true);
      this.error.set('');
      const result = await firstValueFrom(this.api.post<{ job: LargeMigrationJob; snapshot: LargeReconciliationSnapshot }>(`migration/large-jobs/${job.id}/reconcile`, {
        snapshotType: 'post_import_operator_check'
      }));
      this.largeJob.set(result.job || this.largeJob());
      this.message.set(`Proof check saved: ${result.snapshot.status || 'completed'}.`);
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to run migration proof check.'));
    } finally {
      this.loading.set(false);
    }
  }

  downloadLargeReconciliationReport(): void {
    const job = this.largeJob();
    const snapshot = this.latestLargeReconciliation();
    if (!job || !snapshot) {
      this.error.set('Run proof check before exporting the migration report.');
      return;
    }
    const report = { generatedAt: new Date().toISOString(), tenantScope: 'current tenant and branch headers', job: { id: job.id, status: job.status, totalRows: job.totalRows || 0, processedRows: job.processedRows || 0, importedRows: job.importedRows || 0, skippedRows: job.skippedRows || 0, errorRows: job.errorRows || 0, warningRows: job.warningRows || 0, chunkSize: job.chunkSize || 0, resumeToken: job.resumeToken || '' }, chunks: job.chunks || [], chunkManifest: (job.chunks || []).map((chunk) => ({ chunkNumber: chunk.chunkNumber, status: chunk.status, totalRows: chunk.totalRows || 0, importedRows: chunk.importedRows || 0, skippedRows: chunk.skippedRows || 0, errorRows: chunk.errorRows || 0, warningRows: chunk.warningRows || 0, checksum: chunk.checksum || '', completedAt: chunk.completedAt || '', failureReason: chunk.failureReason || '' })), reconciliation: snapshot, handover: { status: snapshot.status, differences: snapshot.differences || [], clientNote: 'Use this proof file with the import batch and rollback history for migration sign-off.' } };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `migration-proof-${job.id}-${snapshot.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    this.message.set('Migration proof report exported.');
  }

  private async refreshLargeJob(): Promise<void> {
    const job = this.largeJob();
    if (!job?.id) return;
    try {
      const fresh = await firstValueFrom(this.api.get<LargeMigrationJob>('migration/large-jobs', job.id));
      this.largeJob.set(fresh);
    } catch {}
  }

  private previewChunkRows(): any[] {
    return this.previewRows().map((row) => {
      if (row?.raw && Object.keys(row.raw).length) return row.raw;
      if (row?.fields && Object.keys(row.fields).length) return row.fields;
      return row?.payload || row;
    }).filter((row) => row && Object.keys(row).length);
  }

  closeJobDetail(): void {
    this.selectedJob.set(null);
    this.selectedJobRecovery.set(null);
  }

  async loadJobRecovery(jobId: string): Promise<void> {
    try {
      this.loading.set(true);
      this.error.set('');
      const [job, recovery] = await Promise.all([
        firstValueFrom(this.api.get<any>('migration/jobs', jobId)),
        firstValueFrom(this.api.get<MigrationRecoveryReport>('migration/jobs', `${jobId}/recovery`))
      ]);
      this.selectedJob.set(job || null);
      this.selectedJobRecovery.set(recovery || null);
      this.message.set(recovery?.blockers?.length ? 'Recovery report loaded with blockers.' : 'Recovery report loaded.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to load recovery report.'));
    } finally {
      this.loading.set(false);
    }
  }

  exportRecoveryReport(): void {
    const report = this.selectedJobRecovery();
    const job = this.selectedJob();
    if (!report || !job) return;
    const blob = new Blob([JSON.stringify({ jobId: job.id, fileName: job.fileName, exportedAt: new Date().toISOString(), report }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `migration-recovery-${job.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    this.message.set('Recovery report exported.');
  }

  exportRecoveryFailedRows(): void {
    const rows = this.recoveryFailedRows().map((row) => ({ rowKey: row.rowKey, resource: row.resource, sourceExternalId: row.sourceExternalId || '', message: row.message, retryReason: row.retryReason }));
    this.downloadCsv('migration-recovery-failed-rows.csv', rows);
  }

  async rollbackRecoveryJob(): Promise<void> {
    const job = this.selectedJob();
    if (!job?.id) return;
    await this.rollback(job.id);
  }

  async rollback(jobId: string): Promise<void> {
    if (!confirm('Rollback selected import records delete karega. Continue?')) return;
    try {
      this.loading.set(true);
      const result = await firstValueFrom(this.api.post<any>(`migration/jobs/${jobId}/rollback`, { reason: this.rollbackReason() || 'manual rollback' }));
      this.message.set(result.message || 'Rollback complete.');
      await this.loadJobs();
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Rollback failed.'));
    } finally {
      this.loading.set(false);
    }
  }

  async rollbackLast(): Promise<void> {
    if (!confirm('Rollback last imported batch?')) return;
    try {
      this.loading.set(true);
      const result = await firstValueFrom(this.api.post<any>('migration/rollback/last', { reason: this.rollbackReason() || 'manual rollback last import' }));
      this.message.set(result.message || 'Rollback last import complete.');
      await this.loadJobs();
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Rollback failed.'));
    } finally {
      this.loading.set(false);
    }
  }

  async loadJobs(): Promise<void> {
    try {
      const jobs = await firstValueFrom(this.api.list<any[]>('migration/jobs'));
      this.jobs.set(jobs || []);
      const onboarding = await firstValueFrom(this.api.list<any>('migration/onboarding'));
      this.onboarding.set(onboarding || null);
      await this.loadLiveClientStats();
    } catch {
      this.jobs.set([]);
    }
  }

  async loadLiveClientStats(): Promise<void> {
    try {
      const clients = await firstValueFrom(this.api.list<any[]>('clients', { limit: 10000 }));
      const rows = clients || [];
      this.liveClientStats.set({
        total: rows.length,
        migrated: rows.filter((client) => Number(client.imported || 0) === 1 || client.importBatchId || client.migrationBatchId).length
      });
    } catch {
      this.liveClientStats.set({ total: 0, migrated: 0 });
    }
  }

  async loadIntelligence(): Promise<void> {
    try {
      const [adapters, templates, mappings] = await Promise.all([
        firstValueFrom(this.api.list<Record<string, SourceAdapter>>('migration/adapters')),
        firstValueFrom(this.api.list<Record<string, MigrationTemplate>>('migration/templates')),
        firstValueFrom(this.api.list<any[]>('migration/mappings'))
      ]);
      this.adapters.set(adapters || {});
      this.templates.set(templates || {});
      this.mappings.set(mappings || []);
      this.rebuildMappingDraft();
    } catch {
      this.adapters.set({});
      this.templates.set({});
      this.mappings.set([]);
      this.rebuildMappingDraft();
    }
  }

  setExpectedTotal(key: string, value: unknown): void {
    const amount = Number(value || 0);
    this.expectedTotals.update((current) => ({ ...current, [key]: Number.isFinite(amount) ? amount : 0 }));
  }

  async runReconciliation(): Promise<void> {
    if (!this.fileBase64()) {
      this.error.set('Select an Excel file first.');
      return;
    }
    try {
      this.loading.set(true);
      this.error.set('');
      const result = await firstValueFrom(this.api.post<any>('migration/reconcile', {
        sourceSoftware: this.sourceSoftware, resource: this.resource, migrationMode: true, fileName: this.fileName(), fileBase64: this.fileBase64(), expected: this.expectedTotals()
      }));
      this.reconciliationResult.set(result || null);
      this.message.set(result?.matched ? 'Reconciliation matched.' : 'Reconciliation completed with differences.');
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Reconciliation failed.'));
    } finally {
      this.loading.set(false);
    }
  }

  clearReconciliation(): void {
    this.reconciliationResult.set(null);
    this.expectedTotals.set({});
  }

  async loadApprovals(): Promise<void> {
    try {
      this.approvalDebug.set('');
      const rows = await firstValueFrom(this.api.list<ApprovalRecord[]>('migration/approvals'));
      const safeRows = Array.isArray(rows) ? rows : [];
      this.approvals.set(safeRows);
      if (!safeRows.length) this.approvalDebug.set('No approval records found from backend yet.');
    } catch (err: any) {
      this.approvals.set([]);
      this.approvalDebug.set(this.api.errorText(err, 'Approval refresh failed. Check /migration/approvals route.'));
    }
  }

  latestPendingApproval(): ApprovalRecord | null {
    return this.approvals().find((approval) => approval.status === 'pending' && this.approvalMatchesActiveUpload(approval)) || null;
  }

  private activeApprovalIdentity(): { jobId: string; sourceFileHash: string; fileName: string; totalRows: number } {
    const job = this.largeJob();
    const summary = this.summary() as any;
    const sourceEvidence = summary?.sourceEvidence || job?.settings?.sourceEvidence || {};
    return {
      jobId: String(job?.id || this.jobs()[0]?.id || ''),
      sourceFileHash: String(job?.sourceFileHash || job?.settings?.sourceFileHash || sourceEvidence?.sha256 || ''),
      fileName: String(job?.fileName || this.fileName() || sourceEvidence?.fileName || ''),
      totalRows: Number(job?.totalRows || summary?.totalRows || 0)
    };
  }

  private approvalMatchesActiveUpload(approval: ApprovalRecord | null | undefined): boolean {
    const activeJobId = String(this.largeJob()?.id || '');
    return Boolean(approval && activeJobId && approval.jobId === activeJobId);
  }

  async submitApproval(): Promise<void> {
    if (!this.summary()) {
      if (!this.fileBase64()) { this.error.set('Select a file before approval.'); return; }
      await this.analyze();
      if (!this.summary()) { this.error.set('Analyze summary is missing for approval. Check the network response.'); return; }
    }
    try {
      this.loading.set(true);
      this.error.set('');
      this.approvalDebug.set('');
      const summary = this.summary();
      const approvalIdentity = this.activeApprovalIdentity();
      const sourceEvidence = (summary as any)?.sourceEvidence || null;
      const errorCount = Number(summary?.errorRows || this.largeJob()?.errorRows || 0);
      const warningCount = Number(summary?.warningRows || this.largeJob()?.warningRows || 0);
      const validRows = Number(summary?.validRows || this.largeJob()?.validRows || 0);
      const importableRows = validRows + warningCount;
      const approvalSourceEvidence = { ...(sourceEvidence || {}), fileName: approvalIdentity.fileName, sha256: approvalIdentity.sourceFileHash };
      const approval = await firstValueFrom(this.api.post<ApprovalRecord>('migration/approvals', {
        jobId: approvalIdentity.jobId,
        resource: this.resource || 'auto',
        sourceSoftware: this.sourceSoftware,
        fileName: approvalIdentity.fileName,
        sourceFileHash: approvalIdentity.sourceFileHash,
        totalRows: approvalIdentity.totalRows,
        errorCount,
        warningCount,
        validRows,
        importableRows,
        sourceEvidence: approvalSourceEvidence,
        note: this.approvalNote || this.goLiveGate(),
        summary: { readinessScore: this.readinessScore(), dataQualityScore: this.dataQualityScore(), summary, sourceEvidence: approvalSourceEvidence, reconciliation: this.reconciliationResult(), duplicateDecisions: this.duplicateDecisions() }
      }));
      if (!approval?.id) this.approvalDebug.set('Backend approval response did not include an id. Check migrationService.submitApproval response.');
      this.approvals.update((current) => { const withoutDuplicate = current.filter((item) => item.id !== approval?.id); return approval?.id ? [approval, ...withoutDuplicate] : current; });
      this.message.set(`Approval request submitted: ${approval?.status || 'pending'}.`);
      await this.loadApprovals();
    } catch (err: any) {
      const text = this.api.errorText(err, 'Unable to submit approval.');
      this.error.set(text);
      this.approvalDebug.set(text);
    } finally {
      this.loading.set(false);
    }
  }

  async decideApproval(id: string, decision: 'approved' | 'rejected'): Promise<void> {
    if (!id) { this.approvalDebug.set('No pending approval selected. Submit for approval first.'); return; }
    try {
      this.loading.set(true);
      this.error.set('');
      this.approvalDebug.set('');
      const approval = await firstValueFrom(this.api.post<ApprovalRecord>(`migration/approvals/${id}/decide`, { decision, note: this.approvalNote || decision }));
      this.approvals.update((current) => current.map((item) => item.id === id ? approval : item));
      this.message.set(`Approval ${approval?.status || decision}.`);
      await this.loadApprovals();
    } catch (err: any) {
      const text = this.api.errorText(err, 'Unable to update approval.');
      this.error.set(text);
      this.approvalDebug.set(text);
    } finally {
      this.loading.set(false);
    }
  }

  async loadJobDetail(jobId: string): Promise<void> {
    try {
      this.loading.set(true);
      this.error.set('');
      const job = await firstValueFrom(this.api.get<any>('migration/jobs', jobId));
      this.selectedJob.set(job || null);
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to load migration job.'));
    } finally {
      this.loading.set(false);
    }
  }

  applySavedMapping(mappingId: string): void {
    const mapping = this.mappings().find((item) => item.id === mappingId);
    if (!mapping) { this.rebuildMappingDraft(); return; }
    this.resource = mapping.resource || this.resource || 'clients';
    const saved = mapping.mapping || {};
    this.mappingDraft.set(this.templateColumns().map((column) => ({
      targetField: column.field, sourceColumn: this.sourceForTarget(saved, column.field) || column.aliases[0] || column.field, required: column.required, confidence: this.mappingConfidence(column.required, true), aliases: column.aliases || []
    })));
    this.message.set(`${mapping.name || 'Mapping profile'} loaded.`);
  }

  async saveMappingProfile(): Promise<void> {
    const resource = this.resource || 'clients';
    const mapping = Object.fromEntries(this.mappingDraft().filter((row) => row.sourceColumn).map((row) => [row.sourceColumn, row.targetField]));
    try {
      this.loading.set(true);
      await firstValueFrom(this.api.post<any>('migration/mappings', {
        sourceSoftware: this.sourceSoftware, resource, name: `${this.selectedSourceLabel()} ${this.label(resource)} mapping`, mapping, unmatchedColumns: [], requiredFields: this.templates()[resource]?.required || []
      }));
      this.message.set('Mapping profile saved for future imports.');
      await this.loadIntelligence();
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Unable to save mapping profile.'));
    } finally {
      this.loading.set(false);
    }
  }

  setMappingSource(targetField: string, sourceColumn: string): void {
    this.mappingDraft.update((rows) => rows.map((row) => row.targetField === targetField ? { ...row, sourceColumn, confidence: this.mappingConfidence(row.required, Boolean(sourceColumn)) } : row));
  }

  duplicateDecision(row: any): 'merge' | 'keep' | 'link' | '' {
    return this.duplicateDecisions()[this.rowKey(row)] || '';
  }

  setDuplicateDecision(row: any, decision: 'merge' | 'keep' | 'link'): void {
    const key = this.rowKey(row);
    this.duplicateDecisions.update((current) => ({ ...current, [key]: decision }));
  }

  duplicateDecisionCount(): number {
    const decisions = this.duplicateDecisions();
    return this.duplicateRows().filter((row) => decisions[this.rowKey(row)]).length;
  }

  downloadTemplate(): void {
    const columns = this.templateColumns().map((column) => column.field);
    if (!columns.length) return;
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = `${columns.map(escape).join(',')}\n${this.templateColumns().map((column) => escape(column.example || '')).join(',')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.resource || 'clients'}-migration-template.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  label(value: string): string {
    return String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  dataQualityScore(): number {
    const summary = this.summary();
    if (!summary?.totalRows) return this.fileBase64() ? 35 : 0;
    const validRate = Number(summary.validRows || 0) / Math.max(1, Number(summary.totalRows || 1));
    const warningPenalty = Math.min(20, Number(summary.warningRows || 0) * 2);
    const errorPenalty = Math.min(35, Number(summary.errorRows || 0) * 5);
    const duplicatePenalty = Math.min(15, Number(summary.duplicateRows || 0) * 2);
    return Math.max(0, Math.min(100, Math.round(validRate * 100) - warningPenalty - errorPenalty - duplicatePenalty));
  }

  importApprovalReady(): boolean {
    return this.approvals().some((approval) => approval.status === 'approved' && this.approvalMatchesActiveUpload(approval));
  }

  progressLabel(): string {
    const progress = this.migrationProgress();
    if (!progress) return 'Not started';
    if (progress < 40) return 'Analyzing';
    if (progress < 80) return 'Dry-run / validation';
    if (progress < 100) return 'Importing';
    return 'Complete';
  }

  requiredMappingComplete(): boolean {
    return this.mappingDraft().filter((row) => row.required).every((row) => row.sourceColumn.trim());
  }

  validateRequiredMapping(): boolean {
    if (this.requiredMappingComplete()) return true;
    this.error.set('Required mapping fields are missing. Complete the required source columns in Mapping Studio.');
    return false;
  }

  askMigrationAssistant(): void {
    const rows = this.previewRows();
    const errors = rows.filter((row) => row.status === 'error');
    const warnings = rows.filter((row) => row.status === 'warning');
    const duplicates = this.duplicateRows();
    const topMessages = [...errors, ...warnings, ...duplicates].slice(0, 8).map((row) => row.message || `${row.entity || 'record'} row ${row.sourceRowNumber || ''}`).filter(Boolean);
    this.assistantAnswer.set([
      `${errors.length} critical errors, ${warnings.length} warnings aur ${duplicates.length} duplicate/conflict rows detect hui.`,
      topMessages.length ? `Top reasons: ${Array.from(new Set(topMessages)).slice(0, 5).join(' | ')}` : 'No row-level issue found.',
      this.hasCriticalErrors() ? 'Final import remains blocked until critical errors are fixed.' : 'No critical errors found. Complete the approval gate to import.'
    ].join(' '));
  }

  exportFailedRows(): void {
    const rows = this.previewRows().filter((row) => row.status === 'error' || row.status === 'warning' || this.duplicateRows().includes(row));
    this.downloadCsv('migration-failed-rows.csv', rows);
  }

  exportPreviewSummary(): void {
    const summary = this.summary();
    const rows = [
      { metric: 'totalRows', value: summary?.totalRows || 0 },
      { metric: 'validRows', value: summary?.validRows || 0 },
      { metric: 'warningRows', value: summary?.warningRows || 0 },
      { metric: 'errorRows', value: summary?.errorRows || 0 },
      { metric: 'duplicateRows', value: summary?.duplicateRows || 0 },
      { metric: 'dataQualityScore', value: this.dataQualityScore() },
      { metric: 'readinessScore', value: this.readinessScore() }
    ];
    this.downloadCsv('migration-preview-summary.csv', rows);
  }

  private downloadCsv(fileName: string, rows: Record<string, unknown>[]): void {
    if (!rows.length) return;
    const headers: string[] = Array.from(rows.reduce((set, row) => { Object.keys(row || {}).forEach((key) => set.add(key)); return set; }, new Set<string>()));
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => escape(row?.[key])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private rebuildMappingDraft(): void {
    const columns = this.templateColumns();
    this.mappingDraft.set(columns.map((column) => ({
      targetField: column.field, sourceColumn: column.aliases[0] || column.field, required: column.required, confidence: this.mappingConfidence(column.required, Boolean(column.aliases.length)), aliases: column.aliases || []
    })));
  }

  private sourceForTarget(mapping: Record<string, string>, targetField: string): string {
    const entry = Object.entries(mapping).find(([, target]) => target === targetField);
    return entry?.[0] || '';
  }

  private mappingConfidence(required: boolean, hasSource: boolean): number {
    if (!hasSource) return required ? 35 : 20;
    return required ? 96 : 82;
  }

  private rowKey(row: any): string {
    return `${row.sourceSheet || 'sheet'}:${row.sourceRowNumber || row.targetId || row.sourceExternalId || 'row'}`;
  }

  private async callMigration(path: string, successMessage: string): Promise<void> {
    if (!this.fileBase64()) {
      this.error.set('Select an Excel file first.');
      return;
    }
    try {
      this.loading.set(true);
      this.migrationProgress.set(path.includes('analyze') ? 20 : path.includes('dry-run') ? 55 : 82);
      this.error.set('');
      this.message.set('');
      const response = await firstValueFrom(
        this.api.post<any>(path, {
          sourceSoftware: this.sourceSoftware,
          resource: this.resource,
          migrationMode: true,
          sandboxMode: this.sandboxMode(),
          mapping: Object.fromEntries(this.mappingDraft().filter((row) => row.sourceColumn).map((row) => [row.sourceColumn, row.targetField])),
          duplicateDecisions: this.duplicateDecisions(),
          fileName: this.fileName(),
          fileBase64: this.fileBase64()
        })
      );
      this.summary.set(response.summary || null);
      this.previewRows.set(response.rows || response.details?.rows || []);
      this.duplicateDecisions.set({});
      this.migrationProgress.set(path.includes('import') ? 100 : path.includes('dry-run') ? 75 : 45);
      this.message.set(successMessage);
      if (path.includes('analyze') || path.includes('dry-run') || path.includes('import')) {
        await this.loadApprovals();
      }
    } catch (err: any) {
      this.error.set(this.api.errorText(err, 'Migration failed.'));
    } finally {
      this.loading.set(false);
    }
  }

  private parseCsvRecords(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      const next = text[index + 1];
      if (quoted) {
        if (char === '"' && next === '"') {
          field += '"';
          index++;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
        continue;
      }
      if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (char !== '\r') {
        field += char;
      }
    }
    row.push(field);
    if (row.some((value) => value !== '') || field) rows.push(row);
    return rows;
  }
}
