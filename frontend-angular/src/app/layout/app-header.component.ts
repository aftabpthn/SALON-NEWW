
import { Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthBranchAccess, AuthService } from '../core/services/auth.service';
import { Router } from '@angular/router';
import { AiConciergeError, AiConciergeFailure, AiConciergeService, AiCopilotAnswer, AiCopilotProposal, AiMessage, AiSession, AiSuggestedQuestion } from '../core/services/ai-concierge.service';
import { LanguageService, UserLanguagePreference } from '../core/i18n/language.service';
import { LoadingTickerService } from '../core/services/loading-ticker.service';
import { TranslatePipe } from '../shared/pipes/translate.pipe';

@Component({
    selector: 'app-header',
    imports: [FormsModule, TranslatePipe],
    templateUrl: './app-header.component.html',
    styleUrls: ['./app-header.component.css']
})
export class AppHeaderComponent implements OnInit {
  @Input() mobileNavOpen = false;
  @Output() readonly mobileNavToggle = new EventEmitter<void>();

  private readonly auth = inject(AuthService);
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);
  private readonly concierge = inject(AiConciergeService);
  readonly loadingTicker = inject(LoadingTickerService);
  readonly language = inject(LanguageService);

  readonly appName = localStorage.getItem('aurashine_tenant_name')
    ?? localStorage.getItem('tenantName')
    ?? 'AuraShine';

  branches: AuthBranchAccess[] = [];
  branchSearch = '';
  branchMenuOpen = false;
  switchingBranchId = '';
  branchError = '';
  languageMenuOpen = false;
  languageSaving = false;
  languageError = '';
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
  /** Starter chips, already filtered to what this role may ask. */
  assistantSuggestions: AiSuggestedQuestion[] = [];
  /** Assistant message the last answer came from, so feedback can attach to it. */
  assistantLastMessageId = '';
  /** The user's verdict on the last answer, once they give one. */
  assistantFeedback: 'helpful' | 'not_helpful' | '' = '';
  private assistantRetry: (() => Promise<void>) | null = null;

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

  get languageLabel(): string {
    const preferences = this.language.preferences();
    if (preferences.mode === 'bilingual') return 'English + हिन्दी';
    return preferences.primary === 'hi-IN' ? 'हिन्दी' : 'English';
  }

  get filteredBranches(): AuthBranchAccess[] {
    const search = this.branchSearch.trim().toLowerCase();
    if (!search) return this.branches;
    return this.branches.filter((branch) =>
      `${branch.branchName} ${branch.branchId} ${branch.roleName} ${branch.regionName} ${branch.zoneName} ${branch.clusterName}`.toLowerCase().includes(search));
  }

  ngOnInit(): void {
    if (!this.auth.accessToken) return;
    void this.language.loadSettings().catch((error) => {
      this.languageError = this.message(error, 'error.unableToLoad');
    });
    this.auth.loadProfile().subscribe({
      next: (profile) => {
        this.branches = profile.branches;
      },
      error: () => {
        this.branchError = this.language.text('error.unableToLoad');
      },
    });
  }

  toggleLanguageMenu(): void {
    if (this.languageSaving) return;
    this.languageMenuOpen = !this.languageMenuOpen;
  }

  async selectLanguage(preference: UserLanguagePreference): Promise<void> {
    if (this.languageSaving || this.language.settings()?.tenantDefault.allowUserOverride === false) return;
    this.languageSaving = true;
    this.languageError = '';
    try {
      await this.language.saveUserPreference(preference);
      this.languageMenuOpen = false;
    } catch (error) {
      this.languageError = this.message(error, 'error.unableToSave');
    } finally {
      this.languageSaving = false;
    }
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
    try {
      const response = await this.concierge.send(this.assistantSession.id, body);
      this.assistantDraft = '';
      this.assistantProviderStatus = response.providerStatus || '';
      this.assistantCopilot = response.copilot ?? null;
      this.assistantRestrictedTool = response.restrictedTool ?? '';
      this.assistantLastMessageId = response.assistantMessage?.id ?? '';
      this.assistantMessages = await this.concierge.transcript(this.assistantSession.id);
      this.assistantConnection = 'ready';
      this.assistantAction = response.actionType ? { type: response.actionType, serviceId: response.actionPayload?.serviceId || '' } : null;
    } catch (error) {
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
      this.assistantPendingProposal = proposal;
      return;
    }
    await this.openProposal(proposal);
  }

  /** The user approved: open the prefilled screen so they can complete it there. */
  async confirmProposal(): Promise<void> {
    const proposal = this.assistantPendingProposal;
    if (!proposal) return;
    this.assistantPendingProposal = null;
    await this.openProposal(proposal);
  }

  cancelProposal(): void {
    this.assistantPendingProposal = null;
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
    this.assistantPendingProposal = null;
    this.assistantLastMessageId = '';
    this.assistantFeedback = '';
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
  closeBranchMenu(event: MouseEvent): void {
    if (this.branchMenuOpen && !this.element.nativeElement.contains(event.target as Node)) {
      this.branchMenuOpen = false;
      this.branchSearch = '';
    }
    if (this.languageMenuOpen && !this.element.nativeElement.contains(event.target as Node)) this.languageMenuOpen = false;
  }

  @HostListener('document:keydown.escape')
  closeBranchMenuWithKeyboard(): void {
    this.branchMenuOpen = false;
    this.languageMenuOpen = false;
    this.branchSearch = '';
    this.assistantOpen = false;
  }

  formatTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(this.language.locale(), { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  private message(error: any, fallbackKey: string): string { return this.language.apiError(error, fallbackKey); }
}
