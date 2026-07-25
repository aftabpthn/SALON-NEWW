import { Pipe, PipeTransform, inject } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

@Pipe({ name: 'branchName', standalone: true, pure: false })
export class BranchNamePipe implements PipeTransform {
  private readonly auth = inject(AuthService);

  transform(branchId?: string | null, suppliedName?: string | null): string {
    return suppliedName?.trim() || this.auth.branchNameFor(branchId) || '—';
  }
}
