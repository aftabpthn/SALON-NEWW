import { Directive, HostListener } from '@angular/core';
import { isTitleCaseField, titleCaseWords } from '../utils/title-case-input.util';

@Directive({ selector: '[asTitleCaseInputs]' })
export class TitleCaseInputsDirective {
  @HostListener('input', ['$event'])
  onInput(event: Event): void {
    const input = event.target;
    if (
      !(input instanceof HTMLInputElement)
      || input.type !== 'text'
      || input.readOnly
      || input.disabled
      || event instanceof InputEvent && event.isComposing
    ) return;

    const metadata = [
      input.name,
      input.id,
      input.getAttribute('formcontrolname'),
      input.placeholder,
      input.getAttribute('aria-label'),
      Array.from(input.labels ?? [], (label) => label.textContent).join(' '),
    ].filter(Boolean).join(' ');
    if (!isTitleCaseField(metadata)) return;

    const formatted = titleCaseWords(input.value);
    if (formatted === input.value) return;
    const { selectionStart, selectionEnd } = input;
    input.value = formatted;
    input.setSelectionRange(selectionStart, selectionEnd);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
