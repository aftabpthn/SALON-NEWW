import { Component, inject, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize, firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type StaffInvitePreview = {
  tenantName: string;
  branchName: string;
  staffName: string;
  email: string;
  roleName: string;
  expiresAt: string;
};

type StaffInviteAcceptance = { accepted: boolean; loginId: string; tenantContext: string };

@Component({
  selector: 'aura-staff-invite-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './staff-invite-page.component.html',
  styleUrls: ['../login/login-page.component.css'],
})
export class StaffInvitePageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  readonly form = new FormGroup({
    loginId: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[a-zA-Z0-9._-]{3,80}$/)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(12), Validators.maxLength(128)],
    }),
    confirmPassword: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  token = '';
  preview?: StaffInvitePreview;
  loading = true;
  accepting = false;
  accepted?: StaffInviteAcceptance;
  errorMessage = '';

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token')?.trim() ?? '';
    void this.loadPreview();
  }

  async accept(): Promise<void> {
    if (this.form.invalid || this.accepting) {
      this.form.markAllAsTouched();
      return;
    }
    const { loginId, password, confirmPassword } = this.form.getRawValue();
    if (password !== confirmPassword) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }
    this.accepting = true;
    this.errorMessage = '';
    this.api.post<ApiEnvelope<StaffInviteAcceptance>>(`/auth/staff-invitations/${encodeURIComponent(this.token)}`, {
      loginId: loginId.trim().toLowerCase(), password,
    }).pipe(finalize(() => { this.accepting = false; })).subscribe({
      next: (response) => {
        if (!response.success || !response.data) {
          this.errorMessage = response.error?.message || 'Unable to accept invitation.';
          return;
        }
        this.accepted = response.data;
      },
      error: (error) => { this.errorMessage = this.readError(error); },
    });
  }

  private async loadPreview(): Promise<void> {
    if (!this.token) {
      this.errorMessage = 'Invitation is invalid or expired.';
      this.loading = false;
      return;
    }
    try {
      const response = await firstValueFrom(
        this.api.get<ApiEnvelope<StaffInvitePreview>>(`/auth/staff-invitations/${encodeURIComponent(this.token)}`),
      );
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Invitation is invalid or expired.');
      this.preview = response.data;
    } catch (error) {
      this.errorMessage = this.readError(error);
    } finally {
      this.loading = false;
    }
  }

  private readError(error: any): string {
    return error?.error?.error?.message || error?.message || 'Invitation is invalid or expired.';
  }
}
