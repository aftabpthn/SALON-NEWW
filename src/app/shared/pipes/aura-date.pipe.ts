import { Pipe, PipeTransform } from '@angular/core';
import { I18nService } from '../../core/i18n.service';

export type AuraDateMode = 'date' | 'time' | 'dateTime' | 'monthYear';

@Pipe({ name: 'auraDate', standalone: true, pure: false })
export class AuraDatePipe implements PipeTransform {
  constructor(private readonly i18n: I18nService) {}

  transform(value: unknown, mode: AuraDateMode = 'date'): string {
    if (value === null || value === undefined || value === '') return '';
    if (mode === 'time') return this.i18n.formatTime(value as string | number | Date);
    if (mode === 'dateTime') return this.i18n.formatDateTime(value as string | number | Date);
    if (mode === 'monthYear') return this.i18n.formatMonthYear(value as string | number | Date);
    return this.i18n.formatDate(value as string | number | Date);
  }
}
