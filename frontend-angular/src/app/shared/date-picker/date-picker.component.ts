
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LanguageService } from '../../core/i18n/language.service';
import { TranslatePipe } from '../pipes/translate.pipe';

type CalendarDay = {
  iso: string;
  label: number;
  inMonth: boolean;
  selected: boolean;
  today: boolean;
  inRange: boolean;
};

@Component({
    selector: 'as-date-picker',
    imports: [FormsModule, TranslatePipe],
    templateUrl: './date-picker.component.html',
    styleUrls: ['./date-picker.component.css']
})
export class DatePickerComponent implements OnChanges {
  readonly language = inject(LanguageService);
  readonly yearOptions = this.buildYearOptions();
  @Input() value = '';
  @Input() ariaLabel = '';
  @Input() disabled = false;
  @Input() rangeMode = false;
  @Input() reportPresets = false;
  @Input() rangeEnd = '';
  @Output() valueChange = new EventEmitter<string>();
  @Output() rangeEndChange = new EventEmitter<string>();

  open = false;
  draft = '';
  rangeStartInput = '';
  rangeEndInput = '';
  viewDate = this.startOfMonth(new Date());
  private selectingRangeEnd = false;

  ngOnChanges(changes: SimpleChanges) {
    if ('value' in changes || 'rangeEnd' in changes) {
      this.draft = this.displayValue();
      this.rangeStartInput = this.toDisplayDate(this.value);
      this.rangeEndInput = this.toDisplayDate(this.rangeEnd);
      const parsed = this.fromIsoDate(this.value);
      if (parsed) this.viewDate = this.startOfMonth(parsed);
    }
  }

  get monthLabel() {
    return this.language.formatDate(this.viewDate, { month: 'long', year: 'numeric' });
  }

  get months() {
    const formatter = new Intl.DateTimeFormat(this.language.locale(), { month: 'short' });
    return Array.from({ length: 12 }, (_, month) => ({ value: month, label: formatter.format(new Date(2026, month, 1)) }));
  }

  get selectedMonth() { return this.viewDate.getMonth(); }

  get selectedYear() { return this.viewDate.getFullYear(); }

  get datePlaceholder() { return this.language.preferences().dateFormat; }

  get weekDays() {
    const formatter = new Intl.DateTimeFormat(this.language.locale(), { weekday: 'short' });
    const sunday = new Date(2026, 0, 4);
    return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(2026, 0, sunday.getDate() + index)));
  }

  days(): CalendarDay[] {
    const first = this.startOfMonth(this.viewDate);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const iso = this.toIsoDate(date);
      return {
        iso,
        label: date.getDate(),
        inMonth: date.getMonth() === this.viewDate.getMonth(),
        selected: iso === this.value,
        today: iso === this.toIsoDate(new Date()),
        inRange: Boolean(this.rangeMode && this.value && this.rangeEnd && iso > this.value && iso < this.rangeEnd),
      };
    });
  }

  toggle() {
    if (this.disabled) return;
    this.open = !this.open;
  }

  close() {
    this.open = false;
    this.normalizeDraft();
  }

  setDraft(value: string) {
    this.draft = value;
    const iso = this.fromDisplayDate(value);
    if (!iso) return;
    this.valueChange.emit(iso);
    const parsed = this.fromIsoDate(iso);
    if (parsed) this.viewDate = this.startOfMonth(parsed);
  }

  setRangeDraft(part: 'start' | 'end', value: string) {
    if (part === 'start') this.rangeStartInput = value;
    else this.rangeEndInput = value;
    const iso = this.fromDisplayDate(value);
    if (!iso) return;
    let start = this.value;
    let end = this.rangeEnd;
    if (part === 'start') {
      start = this.rangeEnd && iso > this.rangeEnd ? this.rangeEnd : iso;
      end = this.rangeEnd && iso > this.rangeEnd ? iso : this.rangeEnd;
    } else {
      start = this.value && iso < this.value ? iso : this.value;
      end = this.value && iso < this.value ? this.value : iso;
    }
    this.valueChange.emit(start);
    this.rangeEndChange.emit(end);
    this.syncRangeInputs(start, end);
    const parsed = this.fromIsoDate(iso);
    if (parsed) this.viewDate = this.startOfMonth(parsed);
  }

  normalizeDraft() {
    this.draft = this.displayValue();
  }

  selectDate(iso: string) {
    if (this.rangeMode) {
      let start = iso;
      let end = '';
      if (!this.value || this.rangeEnd || !this.selectingRangeEnd) {
        this.selectingRangeEnd = true;
      } else if (iso < this.value) {
        end = this.value;
        this.selectingRangeEnd = false;
      } else {
        start = this.value;
        end = iso;
        this.selectingRangeEnd = false;
      }
      this.valueChange.emit(start);
      this.rangeEndChange.emit(end);
      this.syncRangeInputs(start, end);
      if (!this.selectingRangeEnd) this.open = false;
      return;
    }
    this.valueChange.emit(iso);
    this.draft = this.toDisplayDate(iso);
    const parsed = this.fromIsoDate(iso);
    if (parsed) this.viewDate = this.startOfMonth(parsed);
    this.open = false;
  }

  clear() {
    this.draft = '';
    this.rangeStartInput = '';
    this.rangeEndInput = '';
    this.valueChange.emit('');
    if (this.rangeMode) this.rangeEndChange.emit('');
    this.open = false;
  }

  today() {
    this.selectDate(this.toIsoDate(new Date()));
  }

  apply() {
    const iso = this.fromDisplayDate(this.draft);
    if (iso) this.valueChange.emit(iso);
    this.open = false;
    this.normalizeDraft();
  }

  shiftMonth(offset: number) {
    const next = new Date(this.viewDate);
    next.setMonth(next.getMonth() + offset);
    this.viewDate = this.startOfMonth(next);
  }

  setViewMonth(month: string | number) {
    this.viewDate = new Date(this.selectedYear, Number(month), 1);
  }

  setViewYear(year: string | number) {
    this.viewDate = new Date(Number(year), this.selectedMonth, 1);
  }

  selectQuarter(quarter: 1 | 2 | 3 | 4) {
    const startMonth = (quarter - 1) * 3;
    this.selectRangeByDates(new Date(this.selectedYear, startMonth, 1), new Date(this.selectedYear, startMonth + 3, 0));
  }

  selectViewYear() {
    this.selectRangeByDates(new Date(this.selectedYear, 0, 1), new Date(this.selectedYear, 11, 31));
  }

  private buildYearOptions() {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 141 }, (_, index) => currentYear + 20 - index);
  }

  private syncRangeInputs(start: string, end: string) {
    this.rangeStartInput = this.toDisplayDate(start);
    this.rangeEndInput = this.toDisplayDate(end);
    this.draft = end ? `${this.rangeStartInput} - ${this.rangeEndInput}` : this.rangeStartInput;
  }

  private selectRangeByDates(startDate: Date, endDate: Date) {
    const start = this.toIsoDate(startDate);
    const end = this.toIsoDate(endDate);
    this.valueChange.emit(start);
    this.rangeEndChange.emit(end);
    this.selectingRangeEnd = false;
    this.syncRangeInputs(start, end);
  }

  private startOfMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private toIsoDate(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private fromIsoDate(value: string) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toDisplayDate(value: string) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    const format = this.language.preferences().dateFormat;
    if (format === 'MM/DD/YYYY') return `${match[2]}/${match[3]}/${match[1]}`;
    if (format === 'YYYY-MM-DD') return `${match[1]}-${match[2]}-${match[3]}`;
    return `${match[3]}/${match[2]}/${match[1]}`;
  }

  private displayValue() {
    const start = this.toDisplayDate(this.value);
    if (!this.rangeMode || !this.rangeEnd) return start;
    return `${start} - ${this.toDisplayDate(this.rangeEnd)}`;
  }

  private fromDisplayDate(value: string) {
    const format = this.language.preferences().dateFormat;
    const expression = format === 'YYYY-MM-DD' ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const match = String(value || '').trim().match(expression);
    if (!match) return '';
    const [year, month, day] = format === 'YYYY-MM-DD'
      ? [Number(match[1]), Number(match[2]), Number(match[3])]
      : format === 'MM/DD/YYYY'
        ? [Number(match[3]), Number(match[1]), Number(match[2])]
        : [Number(match[3]), Number(match[2]), Number(match[1])];
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
}
