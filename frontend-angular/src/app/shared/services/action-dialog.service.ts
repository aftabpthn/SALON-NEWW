import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

type PromptOptions = {
  title?: string;
  defaultValue?: string;
  required?: boolean;
  multiline?: boolean;
  confirmLabel?: string;
  valueInput?: boolean;
};

@Injectable({ providedIn: 'root' })
export class ActionDialogService {
  private readonly document = inject(DOCUMENT);

  confirm(message: string, title = 'Confirm action') {
    return this.open(message, { title, confirmLabel: 'Confirm' }).then((value) => value !== null);
  }

  prompt(message: string, options: PromptOptions = {}) {
    return this.open(message, { ...options, valueInput: true });
  }

  private open(message: string, options: PromptOptions) {
    return new Promise<string | null>((resolve) => {
      const dialog = this.document.createElement('dialog');
      dialog.className = 'app-action-dialog';
      const form = this.document.createElement('form');
      form.method = 'dialog';
      const heading = this.document.createElement('h2');
      heading.textContent = options.title ?? 'Action required';
      const label = this.document.createElement('label');
      const caption = this.document.createElement('span');
      caption.textContent = message;
      label.append(caption);
      const needsValue = options.valueInput === true;
      const input = options.multiline ? this.document.createElement('textarea') : this.document.createElement('input');
      if (needsValue) {
        input.value = options.defaultValue ?? '';
        input.required = options.required === true;
        label.append(input);
      }
      const actions = this.document.createElement('menu');
      const cancel = this.document.createElement('button');
      cancel.type = 'submit';
      cancel.formNoValidate = true;
      cancel.value = 'cancel';
      cancel.textContent = 'Cancel';
      const confirm = this.document.createElement('button');
      confirm.type = 'submit';
      confirm.value = 'confirm';
      confirm.className = 'primary';
      confirm.textContent = options.confirmLabel ?? 'Continue';
      actions.append(cancel, confirm);
      form.append(heading, label, actions);
      dialog.append(form);
      this.document.body.append(dialog);
      dialog.addEventListener('close', () => {
        const value = dialog.returnValue === 'confirm' ? (needsValue ? input.value.trim() : '') : null;
        dialog.remove();
        resolve(value);
      }, { once: true });
      dialog.showModal();
      if (needsValue) input.focus(); else confirm.focus();
    });
  }
}
