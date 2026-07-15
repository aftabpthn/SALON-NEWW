import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthBranchAccess, AuthService } from '../core/services/auth.service';
import { Router } from '@angular/router';
import { AiConciergeService, AiMessage, AiSession } from '../core/services/ai-concierge.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app-header.component.html',
  styleUrls: ['./app-header.component.css'],
})
export class AppHeaderComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);
  private readonly concierge = inject(AiConciergeService);

  readonly appName = localStorage.getItem('aurashine_tenant_name')
    ?? localStorage.getItem('tenantName')
    ?? 'AuraShine';

  branches: AuthBranchAccess[] = [];
  branchSearch = '';
  branchMenuOpen = false;
  switchingBranchId = '';
  branchError = '';
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
      ?? localStorage.getItem('aurashine_branch_id')
      ?? 'No branch selected';
  }

  get currentBranch(): AuthBranchAccess | undefined {
    return this.branches.find((branch) => branch.branchId === this.auth.branchId);
  }

  get filteredBranches(): AuthBranchAccess[] {
    const search = this.branchSearch.trim().toLowerCase();
    if (!search) return this.branches;
    return this.branches.filter((branch) =>
      `${branch.branchName} ${branch.branchId} ${branch.roleName} ${branch.regionName} ${branch.zoneName} ${branch.clusterName}`.toLowerCase().includes(search));
  }

  ngOnInit(): void {
    if (!this.auth.accessToken) return;
    this.auth.loadProfile().subscribe({
      next: (profile) => {
        this.branches = profile.branches;
      },
      error: () => {
        this.branchError = 'Unable to load branches';
      },
    });
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
        this.branchError = 'Unable to switch branch';
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
    } catch (error) { this.assistantError = this.message(error, 'AI Assistant could not be opened'); }
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
    } catch (error) { this.assistantError = this.message(error, 'AI Assistant could not respond'); }
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
  }

  @HostListener('document:keydown.escape')
  closeBranchMenuWithKeyboard(): void {
    this.branchMenuOpen = false;
    this.branchSearch = '';
    this.assistantOpen = false;
  }

  formatTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  private message(error: any, fallback: string): string { return error?.error?.error?.message || error?.error?.message || error?.message || fallback; }
}
