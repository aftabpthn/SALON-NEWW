
import { Component, inject, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, finalize, of, timeout } from 'rxjs';
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
    imports: [ReactiveFormsModule],
    templateUrl: './login-page.component.html',
    styleUrls: ['./login-page.component.css']
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
  subscriptionStatus = '';
  ssoProviders: SsoProviders = { google: false, microsoft: false, saml: false };

  get subscriptionTitle(): string {
    return this.subscriptionStatus === 'paused' ? 'Subscription paused' : 'Subscription expired';
  }

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
    this.subscriptionStatus = '';
    this.tenantContext = tenantContext;
    const { loginId, password, mfaCode } = this.loginForm.getRawValue();
    if (this.mfaRequired && !mfaCode.trim()) {
      this.errorMessage = 'Enter your authenticator or recovery code.';
      return;
    }
    this.signingIn = true;
    this.auth.login(tenantContext, loginId, password, mfaCode)
      .pipe(finalize(() => { this.signingIn = false; }))
      .subscribe({
        next: (response) => this.handleLoginResponse(response),
        error: (error) => {
          this.handleAuthError(error);
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
    this.subscriptionStatus = '';
    this.tenantContext = tenantContext;
    try {
      this.handleLoginResponse(await this.webauthn.login(tenantContext, loginId));
    } catch (error) {
      this.handleAuthError(error);
    } finally {
      this.signingIn = false;
    }
  }

  selectBranch(branch: AuthBranchAccess): void {
    if (!this.selectionToken || this.selectingBranchId) return;

    this.errorMessage = '';
    this.subscriptionStatus = '';
    this.selectingBranchId = branch.branchId;
    this.auth.selectBranch(this.tenantContext, this.selectionToken, branch.branchId)
      .pipe(finalize(() => { this.selectingBranchId = ''; }))
      .subscribe({
        next: (tokens) => this.finishAuthentication(tokens, branch),
        error: (error) => { this.handleAuthError(error); },
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
    this.subscriptionStatus = '';
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
    this.successMessage = '';
    this.changingPassword = true;
    this.auth.changePassword(newPassword)
      .pipe(
        timeout({ first: 15000 }),
        finalize(() => { this.changingPassword = false; }),
      )
      .subscribe({
        next: () => {
          this.passwordChangeForm.reset();
          this.loginForm.controls.password.setValue('');
          this.view = 'signin';
          this.successMessage = 'Password changed. Sign in again.';
        },
        error: (error) => {
          this.errorMessage = error?.name === 'TimeoutError'
            ? 'Password change is taking too long. Check backend and try again.'
            : this.readError(error);
        },
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
      error: (error) => { this.handleAuthError(error); },
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

    void this.router.navigateByUrl(this.safeReturnUrl(), { replaceUrl: true });
    this.auth.hydrateCurrentBranchName()
      .pipe(catchError(() => of(undefined)))
      .subscribe();
  }

  private isBranchSelection(response: LoginResponse): response is BranchSelectionResponse {
    return 'requiresBranchSelection' in response && response.requiresBranchSelection === true;
  }

  private handleAuthError(error: any): void {
    if (error?.error?.error?.details?.mfaRequired) this.mfaRequired = true;
    const status = error?.status === 403
      ? String(error?.error?.error?.details?.subscriptionStatus || '')
      : '';
    this.subscriptionStatus = status;
    this.errorMessage = status ? '' : this.readError(error);
  }

  private safeReturnUrl(): string {
    const requested = this.route.snapshot.queryParamMap.get('returnUrl') || '/dashboard';
    const cleanPath = requested.split('http://')[0].split('https://')[0] || '/dashboard';
    if (!cleanPath.startsWith('/') || cleanPath.startsWith('//') || cleanPath.startsWith('/login')) {
      return '/dashboard';
    }
    return cleanPath;
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
    if (error?.status === 0 || error?.status >= 500) return backendMessage || 'Server is unavailable. Start the backend API and try again.';
    return backendMessage || error?.message || 'Unable to continue. Try again.';
  }
}
