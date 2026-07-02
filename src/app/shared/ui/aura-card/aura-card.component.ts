import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type AuraCardTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'rose' | 'green' | 'amber' | 'red' | 'blue' | 'teal' | 'violet' | 'slate';
export type AuraCardVariant = 'surface' | 'muted' | 'outlined' | 'elevated';
export type AuraCardPadding = 'none' | 'sm' | 'md' | 'lg';
export type AuraCardRadius = 'sm' | 'md' | 'lg';
export type AuraCardShadow = 'none' | 'xs' | 'card' | 'soft';

@Component({
  selector: 'aura-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './aura-card.component.html',
  styleUrls: ['./aura-card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AuraCardComponent {
  @Input() tone: AuraCardTone = 'neutral';
  @Input() variant: AuraCardVariant = 'surface';
  @Input() padding: AuraCardPadding = 'md';
  @Input() radius: AuraCardRadius = 'lg';
  @Input() shadow: AuraCardShadow = 'xs';
  @Input() hover = false;
  @Input() interactive = false;

  get classes(): string[] {
    return [
      `aura-card--tone-${this.tone}`,
      `aura-card--variant-${this.variant}`,
      `aura-card--padding-${this.padding}`,
      `aura-card--radius-${this.radius}`,
      `aura-card--shadow-${this.shadow}`,
      this.hover ? 'aura-card--hover' : '',
      this.interactive ? 'aura-card--interactive' : ''
    ].filter(Boolean);
  }
}