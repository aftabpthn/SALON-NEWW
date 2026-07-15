import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../../shared/services/api.service';

@Component({
  selector: 'app-cash-drawer-approval-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cash-drawer-approval-page.component.html',
  styleUrls: ['./cash-drawer-approval-page.component.css'],
})
export class CashDrawerApprovalPageComponent implements OnInit {
  token = '';
  request: any = null;
  reviewerName = '';
  note = '';
  loading = true;
  busy = false;
  error = '';
  complete = false;

  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute) {}
  ngOnInit(): void { this.token = this.route.snapshot.paramMap.get('token') ?? ''; this.load(); }
  load(): void { this.loading = true; this.api.get<any>(`/api/v1/public/cash-drawer-approval/${encodeURIComponent(this.token)}`).subscribe({ next: (response) => { this.request = response?.data ?? response; this.loading = false; }, error: (error) => { this.error = this.errorText(error); this.loading = false; } }); }
  review(decision: 'approved' | 'rejected'): void { if (!this.reviewerName.trim() || !this.note.trim()) { this.error = 'Name and review note are required'; return; } this.busy = true; this.error = ''; this.api.post(`/api/v1/public/cash-drawer-approval/${encodeURIComponent(this.token)}`, { decision, reviewerName: this.reviewerName.trim(), note: this.note.trim() }).subscribe({ next: () => { this.busy = false; this.complete = true; }, error: (error) => { this.busy = false; this.error = this.errorText(error); } }); }
  money(value: number): number { return Number(value || 0) / 100; }
  private errorText(error: any): string { return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Request failed'; }
}
