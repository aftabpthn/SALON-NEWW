import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-metric-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="metric-card aura-card aura-card--type-metric aura-card--hover" [ngClass]="toneClasses">
      <span>{{ label }}</span>
      <strong>{{ value }}</strong>
      <small>{{ hint }}</small>
    </article>
  `
})
export class MetricCardComponent {
  @Input() label = '';
  @Input() value: string | number = '';
  @Input() hint = '';
  @Input() tone = 'teal';

  get toneClasses(): string[] {
    return [this.tone, `aura-card--tone-${this.tone}`].filter(Boolean);
  }
}
