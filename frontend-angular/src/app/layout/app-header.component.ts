
import { Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthBranchAccess, AuthService } from '../core/services/auth.service';
import { Router } from '@angular/router';
import { AiConciergeService, AiMessage, AiSession } from '../core/services/ai-concierge.service';
import { LANGUAGE_OPTIONS, LanguageService, UserLanguagePreference } from '../core/i18n/language.service';
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
  readonly languageOptions = LANGUAGE_OPTIONS;
  assistantOpen = false;
  assistantBusy = false;
  assistantError = '';
  assistantDraft = '';
  assistantSession: AiSession | null = null;
  assistantMessages: AiMessage[] = [];
  assistantAction: { type: string; serviceId: string } | null = null;

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
    const primary = this.languageName(preferences.primary);
    if (preferences.mode !== 'bilingual' || !preferences.secondary) return primary;
    return `${primary} + ${this.languageName(preferences.secondary)}`;
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

  languageName(code: string): string {
    return this.languageOptions.find((option) => option.code === code)?.label ?? code;
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
    this.assistantBusy = true;
    this.assistantError = '';
    try {
      this.assistantSession = await this.concierge.open();
      this.assistantMessages = await this.concierge.transcript(this.assistantSession.id);
    } catch (error) { this.assistantError = this.message(error, 'error.unableToLoad'); }
    finally { this.assistantBusy = false; }
  }

  async sendAssistantMessage(): Promise<void> {
    const body = this.assistantDraft.trim();
    if (!body || !this.assistantSession || this.assistantBusy) return;
    this.assistantBusy = true;
    this.assistantError = '';
    try {
      const response = await this.concierge.send(this.assistantSession.id, body);
      this.assistantDraft = '';
      this.assistantMessages = await this.concierge.transcript(this.assistantSession.id);
      this.assistantAction = response.actionType ? { type: response.actionType, serviceId: response.actionPayload?.serviceId || '' } : null;
    } catch (error) { this.assistantError = this.message(error, 'common.error'); }
    finally { this.assistantBusy = false; }
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
