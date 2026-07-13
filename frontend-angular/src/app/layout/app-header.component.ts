import { Component } from '@angular/core';

@Component({
  selector: 'app-header',
  standalone: true,
  templateUrl: './app-header.component.html',
  styleUrls: ['./app-header.component.css'],
})
export class AppHeaderComponent {
  readonly appName = localStorage.getItem('aurashine_tenant_name')
    ?? localStorage.getItem('tenantName')
    ?? 'AuraShine';
  get branchName(): string {
    return localStorage.getItem('aurashine_branch_name')
      ?? localStorage.getItem('selectedBranchName')
      ?? localStorage.getItem('branchName')
      ?? localStorage.getItem('aurashine_branch_id')
      ?? 'No branch selected';
  }
}
