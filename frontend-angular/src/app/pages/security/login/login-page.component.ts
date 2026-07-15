import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, finalize, of } from 'rxjs';
import {
  AuthBranchAccess,
  AuthService,
  AuthTokenPair,
  BranchSelectionResponse,
  LoginResponse,
  SsoProviders,
} from '../../../core/services/auth.service';
import { WebauthnService } from '../../../core/services/webauthn.service';

@Component({
  selector: 'aura-login-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login-page.component.html',
  styleUrls: ['./login-page.component.css'],
})
export class LoginPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly webauthn = inject(WebauthnService);

  readonly loginForm = new FormGroup({
    loginId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    mfaCode: new FormControl('', { nonNullable: true }),
  });
  readonly branchSearch = new FormControl('', { nonNullable: true });
  readonly passwordChangeForm = new FormGroup({
    newPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(12), Validators.maxLength(128)],
    }),
    confirmPassword: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  view: 'signin' | 'branches' | 'password-change' = 'signin';
  branches: AuthBranchAccess[] = [];
  selectionToken = '';
  tenantContext = '';
  showPassword = false;
  mfaRequired = false;
  signingIn = false;
  selectingBranchId = '';
  changingPassword = false;
  errorMessage = '';
  successMessage = '';
  ssoProviders: SsoProviders = { google: false, microsoft: false, saml: false };

  ngOnInit(): void {
    if (this.auth.hasValidAccessToken() && this.auth.mustChangePassword) {
      this.view = 'password-change';
    }
    this.auth.ssoProviders(this.auth.resolveTenantContext() || '').pipe(catchError(() => of({ google: false, microsoft: false, saml: false }))).subscribe((providers) => {
      this.ssoProviders = providers;
    });
    const ssoCode = this.route.snapshot.queryParamMap.get('ssoCode');
    if (ssoCode) this.completeSso(ssoCode);
  }

  signInWithSso(provider: 'google' | 'microsoft' | 'saml'): void {
    if (this.signingIn) return;
    const tenantContext = this.auth.resolveTenantContext();
    if (!tenantContext) {
      this.errorMessage = 'Salon workspace is not configured.';
      return;
    }
    const returnUrl = new URL(location.href);
    returnUrl.searchParams.delete('ssoCode');
    returnUrl.searchParams.delete('tenant');
    location.assign(this.auth.ssoStartUrl(provider, tenantContext, returnUrl.toString()));
  }

  get filteredBranches(): AuthBranchAccess[] {
    const query = this.branchSearch.value.trim().toLowerCase();
    if (!query) return this.branches;
    return this.branches.filter((branch) =>
      `${branch.branchName} ${branch.roleName} ${branch.regionName} ${branch.zoneName} ${branch.clusterName}`.toLowerCase().includes(query),
    );
  }

  submitLogin(): void {
    if (this.loginForm.invalid || this.signingIn) {
      this.loginForm.markAllAsTouched();
      return;
    }

    const tenantContext = this.auth.resolveTenantContext();
    if (!tenantContext) {
      this.errorMessage = 'Salon workspace is not configured.';
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.signingIn = true;
    this.tenantContext = tenantContext;
    const { loginId, password, mfaCode } = this.loginForm.getRawValue();
    if (this.mfaRequired && !mfaCode.trim()) {
      this.errorMessage = 'Enter your authenticator or recovery code.';
      return;
    }
    this.auth.login(tenantContext, loginId, password, mfaCode)
      .pipe(finalize(() => { this.signingIn = false; }))
      .subscribe({
        next: (response) => this.handleLoginResponse(response),
        error: (error) => {
          if (error?.error?.error?.details?.mfaRequired) this.mfaRequired = true;
          this.errorMessage = this.readError(error);
        },
      });
  }

  async signInWithPasskey(): Promise<void> {
    const loginId = this.loginForm.controls.loginId.value.trim();
    if (!loginId || this.signingIn) {
      this.loginForm.controls.loginId.markAsTouched();
      this.errorMessage = 'Enter your login ID or email.';
      return;
    }
    const tenantContext = this.auth.resolveTenantContext();
    if (!tenantContext) {
      this.errorMessage = 'Salon workspace is not configured.';
      return;
    }
    this.signingIn = true;
    this.errorMessage = '';
    this.tenantContext = tenantContext;
    try {
      this.handleLoginResponse(await this.webauthn.login(tenantContext, loginId));
    } catch (error) {
      this.errorMessage = this.readError(error);
    } finally {
      this.signingIn = false;
    }
  }

  selectBranch(branch: AuthBranchAccess): void {
    if (!this.selectionToken || this.selectingBranchId) return;

    this.errorMessage = '';
    this.selectingBranchId = branch.branchId;
    this.auth.selectBranch(this.tenantContext, this.selectionToken, branch.branchId)
      .pipe(finalize(() => { this.selectingBranchId = ''; }))
      .subscribe({
        next: (tokens) => this.finishAuthentication(tokens, branch),
        error: (error) => { this.errorMessage = this.readError(error); },
      });
  }

  backToSignIn(): void {
    this.view = 'signin';
    this.branches = [];
    this.selectionToken = '';
    this.branchSearch.setValue('');
    this.loginForm.controls.password.setValue('');
    this.loginForm.controls.mfaCode.setValue('');
    this.mfaRequired = false;
    this.errorMessage = '';
  }

  submitPasswordChange(): void {
    if (this.passwordChangeForm.invalid || this.changingPassword) {
      this.passwordChangeForm.markAllAsTouched();
      return;
    }
    const { newPassword, confirmPassword } = this.passwordChangeForm.getRawValue();
    if (newPassword !== confirmPassword) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }
    this.errorMessage = '';
    this.changingPassword = true;
    this.auth.changePassword(newPassword)
      .pipe(finalize(() => { this.changingPassword = false; }))
      .subscribe({
        next: () => {
          this.passwordChangeForm.reset();
          this.loginForm.controls.password.setValue('');
          this.view = 'signin';
          this.successMessage = 'Password changed. Sign in again.';
        },
        error: (error) => { this.errorMessage = this.readError(error); },
      });
  }

  signOutFromPasswordChange(): void {
    this.auth.clearSession(true);
    this.passwordChangeForm.reset();
    this.view = 'signin';
    this.errorMessage = '';
  }

  trackBranch(_index: number, branch: AuthBranchAccess): string {
    return branch.branchId;
  }

  private handleLoginResponse(response: LoginResponse): void {
    if (this.isBranchSelection(response)) {
      this.branches = response.branches;
      this.selectionToken = response.selectionToken;
      this.view = 'branches';
      return;
    }
    this.finishAuthentication(response);
  }

  private completeSso(code: string): void {
    this.signingIn = true;
    this.errorMessage = '';
    this.tenantContext = this.route.snapshot.queryParamMap.get('tenant') || this.auth.resolveTenantContext() || '';
    this.auth.exchangeSso(code).pipe(finalize(() => { this.signingIn = false; })).subscribe({
      next: (response) => this.handleLoginResponse(response),
      error: (error) => { this.errorMessage = this.readError(error); },
    });
  }

  private finishAuthentication(tokens: AuthTokenPair, branch?: AuthBranchAccess): void {
    try {
      this.auth.acceptTokenPair(tokens, branch);
    } catch {
      this.errorMessage = 'Unable to start a secure session.';
      return;
    }

    if (tokens.must_change_password) {
      this.view = 'password-change';
      this.passwordChangeForm.reset();
      return;
    }

    this.auth.hydrateCurrentBranchName()
      .pipe(catchError(() => of(undefined)))
      .subscribe(() => {
        void this.router.navigateByUrl(this.safeReturnUrl(), { replaceUrl: true });
      });
  }

  private isBranchSelection(response: LoginResponse): response is BranchSelectionResponse {
    return 'requiresBranchSelection' in response && response.requiresBranchSelection === true;
  }

  private safeReturnUrl(): string {
    const requested = this.route.snapshot.queryParamMap.get('returnUrl') || '/dashboard';
    if (!requested.startsWith('/') || requested.startsWith('//') || requested.startsWith('/login')) {
      return '/dashboard';
    }
    return requested;
  }

  private readError(error: any): string {
    const backendMessage = error?.error?.error?.message;
    if (error?.status === 401 && error?.error?.error?.details?.mfaRequired) {
      return this.mfaRequired && this.loginForm.controls.mfaCode.value.trim()
        ? 'Invalid authenticator or recovery code.'
        : 'Enter your authenticator or recovery code.';
    }
    if (error?.status === 401) return 'Invalid login ID or password.';
    if (error?.status === 429) return backendMessage || 'Too many attempts. Try again later.';
    return backendMessage || error?.message || 'Unable to continue. Try again.';
  }
}
