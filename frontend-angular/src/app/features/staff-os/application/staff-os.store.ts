import { Injectable, inject } from '@angular/core';
import { StaffOsApi } from '../data/staff-os.api';
import { StaffOsSection, StaffOsViewConfig, StaffOsRow } from '../domain/staff-os.models';

@Injectable()
export class StaffOsStore {
  private readonly api = inject(StaffOsApi);

  async load(view: StaffOsViewConfig, periodStart: string, periodEnd: string): Promise<StaffOsSection[]> {
    const today = periodEnd;
    const period = new URLSearchParams({ periodStart, periodEnd }).toString();
    return Promise.all(view.endpoints.map(async (endpoint) => {
      try {
        const value = await this.api.get<unknown>(endpoint.path.replace('{today}', today).replace('{period}', period));
        const rows = this.rows(value);
        return { ...endpoint, rows, columns: this.columns(rows), summary: rows.length ? [] : this.summary(value) };
      } catch (error) {
        return { ...endpoint, rows: [], columns: [], summary: [], error: this.message(error) };
      }
    }));
  }

  post<T>(path: string, body: unknown) {
    return this.api.post<T>(path, body);
  }

  private rows(value: unknown): StaffOsRow[] {
    if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object') as StaffOsRow[];
    if (!value || typeof value !== 'object') return [];
    const rowSource = value as Record<string, unknown>;
    for (const key of ['items', 'rows', 'topStaff', 'records', 'events']) {
      const candidate = rowSource[key];
      if (Array.isArray(candidate)) return candidate.filter((item) => item && typeof item === 'object') as StaffOsRow[];
    }
    return [];
  }

  private columns(rows: StaffOsRow[]) {
    return [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 8);
  }

  private summary(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>).slice(0, 12).map(([key, item]) => ({ key, value: item }));
  }

  private message(error: unknown) {
    const candidate = error as { error?: { error?: { message?: string }; message?: string }; message?: string };
    return candidate?.error?.error?.message || candidate?.error?.message || candidate?.message || 'Section could not be loaded';
  }
}
