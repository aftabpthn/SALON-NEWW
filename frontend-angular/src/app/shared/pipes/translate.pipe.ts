import { Pipe, PipeTransform, inject } from '@angular/core';
import { LanguageService, TranslationParams } from '../../core/i18n/language.service';

@Pipe({ name: 'translate', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly language = inject(LanguageService);

  transform(key: string, params: TranslationParams = {}): string {
    return this.language.text(key, params);
  }
}
