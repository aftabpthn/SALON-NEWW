
import { Component, DOCUMENT, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthBranchAccess, AuthService } from '../core/services/auth.service';
import { Router } from '@angular/router';
import { AiConciergeError, AiConciergeFailure, AiConciergeService, AiCopilotAnswer, AiCopilotEntity, AiCopilotProposal, AiMessage, AiSession, AiSuggestedQuestion } from '../core/services/ai-concierge.service';
import { LanguageCode, LANGUAGE_OPTIONS, LanguageService } from '../core/i18n/language.service';
import { LoadingTickerService } from '../core/services/loading-ticker.service';
import { TranslatePipe } from '../shared/pipes/translate.pipe';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../shared/services/api.service';

type HeaderNotification = {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  notificationType?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: {
    deepLink?: string;
    clientId?: string;
    appointmentId?: string;
    sections?: Array<{ openReportLink?: string }>;
  };
};
type HeaderNotificationSummary = { unread: number; data: HeaderNotification[] };

@Component({
    selector: 'app-header',
    imports: [FormsModule, TranslatePipe],
    templateUrl: './app-header.component.html',
    styleUrls: ['./app-header.component.css']
})
export class AppHeaderComponent implements OnInit, OnDestroy {
  @Input() mobileNavOpen = false;
  @Output() readonly mobileNavToggle = new EventEmitter<void>();

  private readonly auth = inject(AuthService);
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);
  private readonly concierge = inject(AiConciergeService);
  private readonly api = inject(ApiService);
  readonly loadingTicker = inject(LoadingTickerService);
  readonly language = inject(LanguageService);
  private readonly document = inject(DOCUMENT);
  readonly primaryLanguage: LanguageCode = 'en-IN';

  readonly appName = localStorage.getItem('aurashine_tenant_name')
    ?? localStorage.getItem('tenantName')
    ?? 'AuraShine';

  branches: AuthBranchAccess[] = [];
  branchSearch = '';
  branchMenuOpen = false;
  switchingBranchId = '';
  branchError = '';
  languagePickerOpen = false;
  languageSearch = '';
  languageDraftSecondary: LanguageCode | '' = '';
  languageSaving = false;
  languageError = '';
  notificationOpen = false;
  notificationLoading = false;
  notificationError = '';
  notificationUnread = 0;
  notificationItems: HeaderNotification[] = [];
  private notificationTimer?: number;
  readonly languageOptions = LANGUAGE_OPTIONS;
  assistantOpen = false;
  assistantBusy = false;
  assistantError = '';
  assistantDraft = '';
  assistantSession: AiSession | null = null;
  assistantMessages: AiMessage[] = [];
  assistantAction: { type: string; serviceId: string } | null = null;
  /** Exact failure behind `assistantError`, so the drawer can show code + request id. */
  assistantFailure: AiConciergeFailure | null = null;
  assistantConnection: 'idle' | 'connecting' | 'ready' | 'error' = 'idle';
  /** `live` when the AI provider answered, otherwise why the CRM fallback replied. */
  assistantProviderStatus = '';
  /** Evidence from the CRM tool that answered the last question, if any. */
  assistantCopilot: AiCopilotAnswer | null = null;
  /** Tool name when the last question needed a report this role cannot open. */
  assistantRestrictedTool = '';
  /** Proposal awaiting the user's explicit go-ahead; nothing runs until they confirm. */
  assistantPendingProposal: AiCopilotProposal | null = null;
  private assistantPendingActionId = '';
  private assistantProposalConfirmationId = '';
  /** Starter chips, already filtered to what this role may ask. */
  assistantSuggestions: AiSuggestedQuestion[] = [];
  /** Assistant message the last answer came from, so feedback can attach to it. */
  assistantLastMessageId = '';
  /** The user's verdict on the last answer, once they give one. */
  assistantFeedback: 'helpful' | 'not_helpful' | '' = '';
  @ViewChild('assistantTranscript') private assistantTranscript?: ElementRef<HTMLElement>;
  private assistantRetry: (() => Promise<void>) | null = null;
  /** Identifies the message being sent, so retrying it cannot post it twice. */
  private assistantSubmissionId = '';
  /** Text that id was minted for; editing after a failure earns a fresh id. */
  private assistantSubmissionBody = '';

  /** Stable id for one submission; `randomUUID` needs a secure context. */
  private newSubmissionId(): string {
    return crypto.randomUUID?.() ?? `sub-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  get branchName(): string {
    return this.currentBranch?.branchName
      ?? localStorage.getItem('aurashine_branch_name')
      ?? localStorage.getItem('selectedBranchName')
      ?? localStorage.getItem('branchName')
      ?? this.language.text('header.noBranchSelected');
  }

  get currentBranch(): AuthBranchAccess | undefined {
    return this.branches.find((branch) => branch.branchId === this.auth.branchId);
  }

  get currentRoleLabel(): string {
    const role = this.auth.currentRole ?? this.currentBranch?.roleName ?? 'User';
    const normalized = role.trim().toLowerCase().replace(/_/g, '-');
    const labels: Record<string, string> = {
      superadmin: 'Platform Super Admin', 'super-admin': 'Platform Super Admin',
      platformadmin: 'Platform Admin', 'platform-admin': 'Platform Admin',
      owner: 'Salon Owner', admin: 'Tenant Admin', manager: 'Branch Manager',
      receptionist: 'Front Desk', frontdesk: 'Front Desk', 'front-desk': 'Front Desk',
      cashier: 'Cashier', accountant: 'Accountant',
      inventorymanager: 'Inventory Manager', 'inventory-manager': 'Inventory Manager',
      marketinglead: 'Marketing Lead', 'marketing-lead': 'Marketing Lead',
      analyst: 'Analyst', staff: 'Staff',
    };
    return labels[normalized] ?? role;
  }

  get currentRoleInitials(): string {
    return this.currentRoleLabel.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  }

  get languageLabel(): string {
    const preferences = this.language.preferences();
    const primary = this.languageName(preferences.primary);
    if (preferences.mode !== 'bilingual' || !preferences.secondary) return primary;
    return `${primary} + ${this.languageName(preferences.secondary)}`;
  }

  get languageSearchResults() {
    const term = this.languageSearch.trim().toLowerCase();
    if (!term) return this.languageOptions;
    return this.languageOptions.filter((option) => option.label.toLowerCase().includes(term) || option.code.toLowerCase().includes(term));
  }

  get canManageLanguage(): boolean {
    return this.language.settings()?.tenantDefault?.allowUserOverride !== false;
  }

  languageName(code: string): string {
    return this.languageOptions.find((option) => option.code === code)?.label ?? code;
  }

  get isLanguageDraftBilingual(): boolean {
    return Boolean(this.languageDraftSecondary);
  }

  get selectedLanguageList() {
    const selected = [{ code: this.primaryLanguage, label: this.languageName(this.primaryLanguage), removable: false }];
    if (this.languageDraftSecondary) selected.push({ code: this.languageDraftSecondary, label: this.languageName(this.languageDraftSecondary), removable: true });
    return selected;
  }

  get filteredBranches(): AuthBranchAccess[] {
    const search = this.branchSearch.trim().toLowerCase();
    if (!search) return this.branches;
    return this.branches.filter((branch) =>
      `${branch.branchName} ${branch.branchId} ${branch.roleName} ${branch.regionName} ${branch.zoneName} ${branch.clusterName}`.toLowerCase().includes(search));
  }

  ngOnInit(): void {
    if (!this.auth.accessToken) return;
    void this.refreshNotifications();
    this.notificationTimer = window.setInterval(() => void this.refreshNotifications(), 30_000);
    if (!this.auth.hasRole('superadmin', 'super-admin', 'platformadmin', 'platform-admin')) {
      void this.language.loadSettings().catch((error) => {
        this.languageError = this.message(error, 'error.unableToLoad');
      });
    }
    this.auth.loadProfile().subscribe({
      next: (profile) => {
        this.branches = profile.branches;
      },
      error: () => {
        this.branchError = this.language.text('error.unableToLoad');
      },
    });
  }

  ngOnDestroy(): void {
    if (this.notificationTimer !== undefined) window.clearInterval(this.notificationTimer);
  }

  async toggleNotifications(): Promise<void> {
    this.notificationOpen = !this.notificationOpen;
    this.branchMenuOpen = false;
    this.languagePickerOpen = false;
    if (this.notificationOpen) await this.refreshNotifications();
  }

  async openNotification(notification: HeaderNotification): Promise<void> {
    try {
      if (!notification.isRead) {
        await firstValueFrom(this.api.patch<ApiEnvelope<HeaderNotification>>(`/notifications/${encodeURIComponent(notification.id)}`, { isRead: true }));
        notification.isRead = true;
        this.notificationUnread = Math.max(0, this.notificationUnread - 1);
      }
    } catch { /* Navigation remains available if marking read fails. */ }
    this.notificationOpen = false;
    await this.router.navigateByUrl(this.notificationLink(notification));
  }

  private notificationLink(notification: HeaderNotification): string {
    const direct = this.safeNotificationLink(notification.metadata?.deepLink);
    if (direct) return direct;

    const briefingLink = notification.metadata?.sections
      ?.map((section) => this.safeNotificationLink(section.openReportLink))
      .find(Boolean);
    if (briefingLink) return briefingLink;

    const kind = `${notification.notificationType || ''} ${notification.resourceType || ''}`.toLowerCase();
    const resourceId = encodeURIComponent(notification.resourceId || notification.metadata?.clientId || '');
    if (kind.includes('staff_approval')) return '/staff/control-center?tab=governance';
    if (kind.includes('staff_leave')) return '/staff/leave-management';
    if (kind.includes('staff_rule')) return '/staff/control-center?tab=content';
    if (kind.includes('appointment')) return '/appointments';
    if (kind.includes('client')) return resourceId ? `/clients/${resourceId}` : '/clients';
    if (kind.includes('inventory') || kind.includes('stock')) return '/inventory';
    if (kind.includes('invoice') || kind.includes('payment')) return '/pos/invoices';
    if (kind.includes('marketing') || kind.includes('campaign')) return '/marketing';
    if (kind.includes('sms') || kind.includes('message')) return '/sms-center';
    if (kind.includes('staff')) return '/staff';
    return '/command-center';
  }

  private safeNotificationLink(value?: string): string {
    const link = value?.trim() || '';
    if (!link.startsWith('/') || link.startsWith('//')) return '';
    const aliases: Record<string, string> = {
      '/reports/profit': '/reports/profit-intelligence',
      '/staff/attendance': '/staff/attendance-summary',
      '/staff/dashboard': '/staff',
      '/staff/leaves': '/staff/leave-management',
      '/staff/rules': '/staff/control-center?tab=content',
    };
    return aliases[link] || link;
  }

  private async refreshNotifications(): Promise<void> {
    if (!this.auth.accessToken || this.notificationLoading) return;
    this.notificationLoading = true;
    this.notificationError = '';
    try {
      const response = await firstValueFrom(this.api.get<ApiEnvelope<HeaderNotificationSummary>>('/notifications?page=1&pageSize=20'));
      this.notificationUnread = Number(response.data?.unread || 0);
      this.notificationItems = response.data?.data || [];
    } catch (error) {
      this.notificationError = this.message(error, 'error.unableToLoad');
    } finally {
      this.notificationLoading = false;
    }
  }

  openLanguagePicker(): void {
    if (this.languageSaving || !this.canManageLanguage) return;
    this.branchMenuOpen = false;
    this.notificationOpen = false;
    const current = this.language.preferences();
    this.languageDraftSecondary = current.mode === 'bilingual' && current.secondary && current.secondary !== this.primaryLanguage ? current.secondary : '';
    this.languageSearch = '';
    this.languagePickerOpen = true;
    this.setBodyScrollLocked(true);
  }

  closeLanguagePicker(): void {
    if (!this.languagePickerOpen) return;
    this.languagePickerOpen = false;
    this.languageSearch = '';
    this.languageDraftSecondary = '';
    this.setBodyScrollLocked(false);
  }

  selectLanguageCode(code: LanguageCode): void {
    if (!this.canManageLanguage || this.languageSaving) return;
    if (code === this.primaryLanguage) {
      this.languageDraftSecondary = '';
      return;
    }
    this.languageDraftSecondary = this.languageDraftSecondary === code ? '' : code;
  }

  async saveLanguagePicker(): Promise<void> {
    if (this.languageSaving || !this.canManageLanguage) return;
    this.languageSaving = true;
    this.languageError = '';
    try {
      await this.language.saveUserPreference({
        primaryLanguage: this.primaryLanguage,
        secondaryLanguage: this.languageDraftSecondary || undefined,
        displayMode: this.languageDraftSecondary ? 'bilingual' : 'single',
      });
      this.closeLanguagePicker();
      this.languageSearch = '';
    } catch (error) {
      this.languageError = this.message(error, 'error.unableToSave');
    } finally {
      this.languageSaving = false;
    }
  }

  private setBodyScrollLocked(locked: boolean): void {
    if (!this.document.body) return;
    this.document.body.style.overflow = locked ? 'hidden' : '';
  }

  toggleBranchMenu(): void {
    if (this.branches.length < 2) return;
    this.branchMenuOpen = !this.branchMenuOpen;
    if (!this.branchMenuOpen) this.branchSearch = '';
  }

  switchBranch(branch: AuthBranchAccess): void {
    if (branch.branchId === this.auth.branchId) {
      this.branchMenuOpen = false;
      return;
    }

    this.branchError = '';
    this.switchingBranchId = branch.branchId;
    this.auth.switchBranch(branch.branchId).subscribe({
      next: (tokens) => {
        this.auth.acceptTokenPair(tokens, branch);
        location.reload();
      },
      error: () => {
        this.switchingBranchId = '';
        this.branchError = this.language.text('error.unableToSave');
      },
    });
  }

  async toggleAssistant(): Promise<void> {
    this.assistantOpen = !this.assistantOpen;
    if (!this.assistantOpen || this.assistantSession) return;
    await this.connectAssistant();
  }

  /** Opens the session and loads its transcript, keeping itself as the retry action. */
  async connectAssistant(): Promise<void> {
    if (this.assistantBusy) return;
    this.assistantBusy = true;
    this.assistantConnection = 'connecting';
    this.assistantProviderStatus = '';
    this.clearCopilotResult();
    this.clearAssistantError();
    try {
      this.assistantSession ??= await this.concierge.open(this.language.locale());
      this.assistantMessages = await this.concierge.transcript(this.assistantSession.id);
      // Chips are advisory: failing to load them must not break the drawer.
      this.assistantSuggestions = await this.concierge
        .suggestions(this.language.locale())
        .catch(() => []);
      this.scrollTranscriptToLatest();
      this.assistantConnection = 'ready';
    } catch (error) {
      this.assistantConnection = 'error';
      this.captureAssistantError(error, 'error.unableToLoad', () => this.connectAssistant());
    } finally { this.assistantBusy = false; }
  }

  async sendAssistantMessage(): Promise<void> {
    const body = this.assistantDraft.trim();
    if (!body || !this.assistantSession || this.assistantBusy) return;
    this.assistantBusy = true;
    this.assistantProviderStatus = '';
    this.clearCopilotResult();
    this.clearAssistantError();
    // Identifies what the user typed, not this attempt, so a retry cannot post
    // the same message twice. Editing the text after a failure is a different
    // message and earns a fresh id.
    if (!this.assistantSubmissionId || this.assistantSubmissionBody !== body) {
      this.assistantSubmissionId = this.newSubmissionId();
      this.assistantSubmissionBody = body;
    }
    try {
      const response = await this.concierge.send(this.assistantSession.id, body, this.assistantSubmissionId);
      this.assistantSubmissionId = '';
      this.assistantSubmissionBody = '';
      this.assistantDraft = '';
      this.assistantProviderStatus = response.providerStatus || '';
      this.assistantCopilot = response.copilot ?? null;
      this.assistantRestrictedTool = response.restrictedTool ?? '';
      this.assistantLastMessageId = response.assistantMessage?.id ?? '';
      this.assistantMessages = await this.concierge.transcript(this.assistantSession.id);
      this.scrollTranscriptToLatest();
      this.assistantConnection = 'ready';
      this.assistantAction = response.actionType ? { type: response.actionType, serviceId: response.actionPayload?.serviceId || '' } : null;
    } catch (error) {
      // A conflict means the server already stored this submission, so the send
      // succeeded even though the response did not arrive. Show the transcript
      // rather than an error the user cannot act on.
      if (error instanceof AiConciergeError && error.failure.code === 'CONFLICT') {
        this.assistantSubmissionId = '';
        this.assistantSubmissionBody = '';
        this.assistantDraft = '';
        this.assistantMessages = await this.concierge.transcript(this.assistantSession.id).catch(() => this.assistantMessages);
        this.assistantConnection = 'ready';
        return;
      }
      // Keep the text in the box so a retry does not lose what the user typed.
      this.assistantDraft = body;
      this.captureAssistantError(error, 'common.error', () => this.sendAssistantMessage());
    } finally { this.assistantBusy = false; }
  }

  async retryAssistant(): Promise<void> {
    const retry = this.assistantRetry;
    if (!retry || this.assistantBusy) return;
    await retry();
  }

  get assistantCanRetry(): boolean {
    return !!this.assistantRetry && !this.assistantBusy;
  }

  /** Non-empty only when the deterministic CRM fallback answered instead of the AI provider. */
  get assistantFallbackReasonKey(): string {
    return ({
      not_configured: 'header.aiProviderNotConfigured',
      unreachable: 'header.aiProviderUnreachable',
      http_error: 'header.aiProviderErrored',
      invalid_response: 'header.aiProviderErrored',
    } as Record<string, string>)[this.assistantProviderStatus] ?? '';
  }

  get assistantConnectionKey(): string {
    return ({
      idle: 'header.aiNotConnected',
      connecting: 'header.connecting',
      ready: 'header.aiConnected',
      error: 'header.aiConnectionFailed',
    } as Record<string, string>)[this.assistantConnection];
  }

  /** Opens the CRM screen the tool pointed at, and closes the drawer behind it. */
  async openCopilotLink(): Promise<void> {
    const link = this.assistantCopilot?.deepLink;
    if (!link) return;
    this.assistantOpen = false;
    await this.router.navigateByUrl(link);
  }

  /**
   * Read-only proposals open straight away. Anything that would change business
   * data is held here until the user confirms it — the copilot never acts alone.
   */
  async selectProposal(proposal: AiCopilotProposal): Promise<void> {
    if (proposal.requiresApproval) {
      this.clearProposalApproval();
      this.assistantPendingProposal = proposal;
      return;
    }
    await this.openProposal(proposal);
  }

  /** The user approved: open the prefilled screen so they can complete it there. */
  async confirmProposal(): Promise<void> {
    const proposal = this.assistantPendingProposal;
    if (!proposal || this.assistantBusy) return;
    this.assistantBusy = true;
    this.clearAssistantError();
    try {
      if (!this.assistantPendingActionId) {
        const draft = await this.concierge.createAction(
          proposal.kind,
          proposal.params,
          proposal.approvalPrompt || proposal.label,
        );
        this.assistantPendingActionId = draft.id;
      }
      this.assistantProposalConfirmationId ||= this.newSubmissionId();
      await this.concierge.confirmAction(
        this.assistantPendingActionId,
        this.assistantProposalConfirmationId,
      );
      await this.openProposal(proposal);
      this.clearProposalApproval();
    } catch (error) {
      this.captureAssistantError(error, 'common.error', () => this.confirmProposal());
    } finally {
      this.assistantBusy = false;
    }
  }

  cancelProposal(): void {
    const draftId = this.assistantPendingActionId;
    this.clearProposalApproval();
    if (draftId) void this.concierge.cancelAction(draftId).catch(() => undefined);
  }

  private async openProposal(proposal: AiCopilotProposal): Promise<void> {
    this.assistantOpen = false;
    // Params only prefill the target screen; the change is completed there.
    await this.router.navigate([proposal.route], { queryParams: this.queryParams(proposal.params) });
  }

  /** Flattens a prefill payload into query params, dropping anything unusable. */
  private queryParams(params: Record<string, unknown>): Record<string, string> {
    const flattened: Record<string, string> = {};
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        if (value.length) flattened[key] = value.join(',');
      } else if (typeof value !== 'object') {
        flattened[key] = String(value);
      }
    }
    return flattened;
  }

  /** Sends a chip as if the user typed it. */
  /**
   * Opens the CRM record an answer referred to.
   *
   * Uses the link the backend supplied rather than building a route from the
   * entity kind, so the drawer cannot invent a path the API did not sanction.
   */
  async openEntity(entity: AiCopilotEntity): Promise<void> {
    if (!entity.link) return;
    this.assistantOpen = false;
    await this.router.navigateByUrl(entity.link);
  }

  /**
   * Keeps the newest message in view.
   *
   * Deferred a frame because the transcript has not rendered the new message at
   * the point the reply resolves, so scrolling immediately would land short.
   */
  private scrollTranscriptToLatest(): void {
    const transcript = this.assistantTranscript?.nativeElement;
    if (!transcript) return;
    requestAnimationFrame(() => {
      transcript.scrollTop = transcript.scrollHeight;
    });
  }

  async askSuggestion(suggestion: AiSuggestedQuestion): Promise<void> {
    if (this.assistantBusy) return;
    this.assistantDraft = suggestion.question;
    await this.sendAssistantMessage();
  }

  /** Records whether the last answer helped. Failing to record is not fatal. */
  async rateAnswer(helpful: boolean): Promise<void> {
    if (!this.assistantSession || !this.assistantLastMessageId) return;
    const previous = this.assistantFeedback;
    this.assistantFeedback = helpful ? 'helpful' : 'not_helpful';
    try {
      await this.concierge.sendFeedback(
        this.assistantSession.id,
        this.assistantLastMessageId,
        helpful,
        this.assistantCopilot?.tool ?? '',
      );
    } catch {
      // Put the button back the way it was rather than claim a vote was stored.
      this.assistantFeedback = previous;
    }
  }

  private clearCopilotResult(): void {
    this.assistantCopilot = null;
    this.assistantRestrictedTool = '';
    this.clearProposalApproval();
    this.assistantLastMessageId = '';
    this.assistantFeedback = '';
  }

  private clearProposalApproval(): void {
    this.assistantPendingProposal = null;
    this.assistantPendingActionId = '';
    this.assistantProposalConfirmationId = '';
  }

  private clearAssistantError(): void {
    this.assistantError = '';
    this.assistantFailure = null;
    this.assistantRetry = null;
  }

  private captureAssistantError(error: unknown, fallbackKey: string, retry: () => Promise<void>): void {
    if (error instanceof AiConciergeError) {
      this.assistantFailure = error.failure;
      this.assistantError = this.language.errorCodeText(error.failure.code, fallbackKey);
    } else {
      this.assistantFailure = null;
      this.assistantError = this.message(error, fallbackKey);
    }
    this.assistantRetry = retry;
    // Status 0 means the API was never reached, so the drawer is genuinely disconnected.
    if (this.assistantFailure?.status === 0) this.assistantConnection = 'error';
  }

  async continueBooking(): Promise<void> {
    this.assistantOpen = false;
    await this.router.navigate(['/appointments'], { queryParams: this.assistantAction?.serviceId ? { serviceId: this.assistantAction.serviceId } : {} });
  }

  @HostListener('document:click', ['$event'])
  closeOverlays(event: MouseEvent): void {
    if (this.element.nativeElement.contains(event.target as Node)) return;
    if (this.branchMenuOpen) {
      this.branchMenuOpen = false;
      this.branchSearch = '';
    }
    if (this.notificationOpen) {
      this.notificationOpen = false;
      this.notificationError = '';
    }
    this.closeLanguagePicker();
  }

  @HostListener('document:keydown.escape')
  closeOverlaysWithKeyboard(): void {
    this.branchMenuOpen = false;
    this.branchSearch = '';
    this.closeLanguagePicker();
    this.notificationOpen = false;
    this.notificationError = '';
    this.assistantOpen = false;
  }

  formatTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(this.language.locale(), { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  private message(error: any, fallbackKey: string): string { return this.language.apiError(error, fallbackKey); }
}
