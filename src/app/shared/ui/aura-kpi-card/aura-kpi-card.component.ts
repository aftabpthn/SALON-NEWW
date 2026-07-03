import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { Params, RouterLink } from '@angular/router';

type KpiTone = string | string[] | Set<string> | { [klass: string]: unknown } | null | undefined;

@Component({
  selector: 'aura-kpi-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <a
      class="metric-card aura-card aura-card--type-metric aura-card--hover aura-card--interactive"
      [ngClass]="tone"
      [routerLink]="safeTarget"
      [queryParams]="queryParams"
      [attr.aria-label]="ariaLabel || 'Open KPI detail page'">
      <ng-content></ng-content>
    </a>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
      height: 100%;
    }

    .metric-card {
      position: relative;
      width: 100%;
      min-width: 0;
      min-height: var(--kpi-min-height, 88px);
      height: 100%;
      display: grid;
      align-content: start;
      gap: var(--kpi-gap, 6px);
      padding: var(--kpi-padding, 14px 16px 12px);
      overflow: hidden;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
      transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
    }

    .metric-card:hover {
      transform: translateY(-2px);
      border-color: var(--aura-primary, #4B1238);
      box-shadow: 0 0 0 2px rgba(75, 18, 56, 0.2), 0 10px 24px rgba(75, 18, 56, 0.1);
    }

    .metric-card:focus-visible {
      outline: 3px solid rgba(75, 18, 56, 0.25);
      outline-offset: 3px;
    }

    .metric-card ::ng-deep span,
    .metric-card ::ng-deep strong,
    .metric-card ::ng-deep small {
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .metric-card ::ng-deep span {
      white-space: nowrap;
    }

    .metric-card ::ng-deep strong {
      white-space: nowrap;
      line-height: 1.15;
      font-size: var(--kpi-strong-size, inherit);
    }

    .metric-card ::ng-deep small {
      white-space: nowrap;
      line-height: 1.25;
      font-size: var(--kpi-small-size, inherit);
    }
  `]
})
export class AuraKpiCardComponent {
  @Input() tone: KpiTone = 'teal';
  @Input() target = '';
  @Input() queryParams: Params | null = null;
  @Input() ariaLabel = '';

  get safeTarget(): string {
    return this.target?.startsWith('/') ? this.target : '/dashboard';
  }
}
