import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '@app/shared/services/api.service';

@Component({
  selector: 'page-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h3>Dashboard</h3>
    <p>Welcome to AuraShine CRM</p>
    <p>Backend status: {{ status || 'checking...' }}</p>
  `
})
export class DashboardComponent implements OnInit {
  private api = inject(ApiService);
  status = '';

  ngOnInit(): void {
    this.api.health().subscribe({
      next: (res) => (this.status = res.status),
      error: () => (this.status = 'backend unavailable'),
    });
  }
}
