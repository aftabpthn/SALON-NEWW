import { Pipe, PipeTransform } from '@angular/core';
import { I18nService } from '../../core/i18n.service';

@Pipe({ name: 'auraMoney', standalone: true, pure: false })
export class AuraMoneyPipe implements PipeTransform {
  constructor(private readonly i18n: I18nService) {}

  transform(value: unknown, digitsInfo = '1.0-2'): string {
    return this.i18n.formatMoney(Number(value || 0), digitsInfo);
  }
}
