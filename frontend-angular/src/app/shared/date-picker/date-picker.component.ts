import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

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
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './date-picker.component.html',
  styleUrls: ['./date-picker.component.css'],
})
export class DatePickerComponent implements OnChanges {
  @Input() value = '';
  @Input() ariaLabel = 'Date';
  @Input() disabled = false;
  @Input() rangeMode = false;
  @Input() rangeEnd = '';
  @Output() valueChange = new EventEmitter<string>();
  @Output() rangeEndChange = new EventEmitter<string>();

  open = false;
  draft = '';
  viewDate = this.startOfMonth(new Date());
  private selectingRangeEnd = false;

  readonly weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  ngOnChanges(changes: SimpleChanges) {
    if ('value' in changes || 'rangeEnd' in changes) {
      this.draft = this.displayValue();
      const parsed = this.fromIsoDate(this.value);
      if (parsed) this.viewDate = this.startOfMonth(parsed);
    }
  }

  get monthLabel() {
    return this.viewDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
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

  normalizeDraft() {
    this.draft = this.displayValue();
  }

  selectDate(iso: string) {
    if (this.rangeMode) {
      if (!this.value || this.rangeEnd || !this.selectingRangeEnd) {
        this.valueChange.emit(iso);
        this.rangeEndChange.emit('');
        this.selectingRangeEnd = true;
      } else if (iso < this.value) {
        this.rangeEndChange.emit(this.value);
        this.valueChange.emit(iso);
        this.selectingRangeEnd = false;
      } else {
        this.rangeEndChange.emit(iso);
        this.selectingRangeEnd = false;
      }
      this.draft = this.displayValue();
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
    this.valueChange.emit('');
    if (this.rangeMode) this.rangeEndChange.emit('');
    this.open = false;
  }

  today() {
    this.selectDate(this.toIsoDate(new Date()));
  }

  tomorrow() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    this.selectDate(this.toIsoDate(date));
  }

  thisWeek() {
    this.today();
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
    return `${match[3]}/${match[2]}/${match[1]}`;
  }

  private displayValue() {
    const start = this.toDisplayDate(this.value);
    if (!this.rangeMode || !this.rangeEnd) return start;
    return `${start} - ${this.toDisplayDate(this.rangeEnd)}`;
  }

  private fromDisplayDate(value: string) {
    const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return '';
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
}
