import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../shared/services/api.service';

type ReportItem = {
  id: string;
  title: string;
  category: string;
  description: string;
  icon?: string;
  path: string;
};

type ReportCategory = { name: string; reports: ReportItem[] };

const LEGACY_REPORT_METADATA: Record<string, Pick<ReportItem, 'category' | 'description' | 'icon'>> = {
  dashboard: { category: 'Overview', description: "Appointments, clients, services and today's sales at a glance.", icon: 'dashboard' },
  appointments: { category: 'Appointments', description: 'Appointment counts and service time grouped by day and status.', icon: 'calendar' },
  sales: { category: 'Sales & Finance', description: 'Total, paid and outstanding sales for the selected period.', icon: 'sales' },
  'invoice-activity': { category: 'Sales & Finance', description: 'Invoice notifications and delivery activity.', icon: 'invoice' },
  'due-recovery': { category: 'Sales & Finance', description: 'Outstanding invoice balances and follow-up status.', icon: 'recovery' },
  'payment-modes': { category: 'Sales & Finance', description: 'Payment totals grouped by payment method.', icon: 'payment' },
  'cash-drawer-eod': { category: 'Sales & Finance', description: 'Expected cash, counted cash and variance for day close.', icon: 'cash' },
  'pos-parity': { category: 'Sales & Finance', description: 'Recorded parity checks between POS calculation paths.', icon: 'balance' },
  'staff-performance': { category: 'Staff', description: 'Staff-wise appointment count and billed value for the selected period.', icon: 'staff' },
};

@Component({
  selector: 'page-reports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reports-page.component.html',
  styleUrls: ['./reports-page.component.css'],
})
export class ReportsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly favouritesKey = 'aurashine_report_favourites';

  reports: ReportItem[] = [];
  favourites = new Set<string>(this.readFavourites());
  collapsed = new Set<string>();
  search = '';
  activeView: 'all' | 'favourites' = 'all';
  activeCategory = '';
  loading = true;
  error = '';

  ngOnInit(): void {
    this.api.get<{ data?: ReportItem[] } | ReportItem[]>('/api/v1/reports').subscribe({
      next: (response) => {
        const reports = Array.isArray(response) ? response : response.data ?? [];
        this.reports = reports.map((report) => this.normalizeReport(report));
        this.loading = false;
      },
      error: (error) => {
        this.error = error?.error?.message ?? 'Unable to load reports';
        this.loading = false;
      },
    });
  }

  get categories(): ReportCategory[] {
    const query = this.search.trim().toLowerCase();
    const visible = this.reports.filter((report) => {
      const matchesSearch = !query || `${report.title} ${report.description} ${report.category}`.toLowerCase().includes(query);
      return matchesSearch
        && (this.activeView === 'all' || this.favourites.has(report.id))
        && (!this.activeCategory || report.category === this.activeCategory);
    });
    return visible.reduce<ReportCategory[]>((categories, report) => {
      const category = categories.find((item) => item.name === report.category);
      if (category) category.reports.push(report);
      else categories.push({ name: report.category, reports: [report] });
      return categories;
    }, []);
  }

  get categoryNames(): string[] {
    const order = ['Sales & Finance', 'Customer', 'Staff', 'Packages', 'Appointments', 'Overview'];
    return [...new Set(this.reports.map((report) => report.category))]
      .sort((left, right) => (order.indexOf(left) + 1 || 99) - (order.indexOf(right) + 1 || 99));
  }

  toggleFavourite(id: string): void {
    this.favourites.has(id) ? this.favourites.delete(id) : this.favourites.add(id);
    localStorage.setItem(this.favouritesKey, JSON.stringify([...this.favourites]));
  }

  openReport(report: ReportItem): void {
    if (report.id === 'appointments') void this.router.navigateByUrl('/appointment-reports');
    if (report.id === 'staff-performance') void this.router.navigateByUrl('/reports/staff-bookings');
  }

  isFavourite(id: string): boolean { return this.favourites.has(id); }
  toggleCategory(name: string): void { this.collapsed.has(name) ? this.collapsed.delete(name) : this.collapsed.add(name); }
  isCollapsed(name: string): boolean { return this.collapsed.has(name); }
  selectCategory(category: string): void { this.activeCategory = this.activeCategory === category ? '' : category; this.activeView = 'all'; }

  reportIcon(icon?: string): string {
    const paths: Record<string, string> = {
      dashboard: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
      calendar: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V9h14v11Z',
      sales: 'M3 17h3v-7H3v7Zm5 0h3V7H8v10Zm5 0h3V3h-3v14Zm5 0h3v-4h-3v4ZM3 21h18v-2H3v2Z',
      invoice: 'M6 2h9l4 4v16H6V2Zm8 1.5V7h3.5L14 3.5ZM8 11h8v2H8v-2Zm0 4h8v2H8v-2Z',
      recovery: 'M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-2.34-5.66L14 10h8V2l-2.94 2.94A9.95 9.95 0 0 0 12 2Zm1 5h-2v6l5.25 3.15 1-1.65-4.25-2.5V7Z',
      payment: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm2 2v3h14V7H5Zm0 6v6h14v-6H5Zm3 2h4v2H8v-2Z',
      cash: 'M3 6h18v13H3V6Zm2 2v9h14V8H5Zm7 1a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
      balance: 'M12 3 2 8l10 5 8-4v7h2V8L12 3Zm-6 9v5l6 3 6-3v-5l-6 3-6-3Z',
      staff: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.67 0-8 1.34-8 4v3h10v-3c0-1.02.39-1.9 1.06-2.65C10.05 13.53 8.8 13 8 13Zm8 0c-.88 0-1.91.15-2.91.43A4.98 4.98 0 0 1 14 17v3h10v-3c0-2.66-5.33-4-8-4Z',
    };
    return paths[icon || ''] || 'M5 3h14v18H5V3Zm3 5h8V6H8v2Zm0 4h8v-2H8v2Zm0 4h5v-2H8v2Z';
  }

  categoryIcon(category: string): string {
    return {
      'Sales & Finance': this.reportIcon('sales'),
      Customer: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2C7.58 14 4 16.24 4 19v3h16v-3c0-2.76-3.58-5-8-5Z',
      Staff: this.reportIcon('staff'),
      Packages: 'm12 2 9 5v10l-9 5-9-5V7l9-5Zm0 2.3L6 7.6 12 11l6-3.4-6-3.3ZM5 9.3v6.5l6 3.3v-6.4L5 9.3Zm8 9.8 6-3.3V9.3l-6 3.4v6.4Z',
      Appointments: this.reportIcon('calendar'),
      Overview: this.reportIcon('dashboard'),
    }[category] || this.reportIcon('invoice');
  }

  private normalizeReport(report: ReportItem): ReportItem {
    const fallback = LEGACY_REPORT_METADATA[report.id];
    return {
      ...report,
      title: report.id === 'appointments' ? 'Detail Appointment List' : report.id === 'staff-performance' ? 'Appointments booked by staff' : report.title,
      category: report.category || fallback?.category || 'Other',
      description: report.description || fallback?.description || 'Report data for the selected scope.',
      icon: report.icon || fallback?.icon,
    };
  }

  private readFavourites(): string[] {
    try {
      const saved = JSON.parse(localStorage.getItem(this.favouritesKey) ?? '[]');
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }
}
