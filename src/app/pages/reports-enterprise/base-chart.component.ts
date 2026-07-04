import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'base-chart',
  standalone: true,
  imports: [CommonModule],
  template: `<canvas #canvas></canvas>`,
  styles: [`:host { display: block; width: 100%; height: 100%; min-height: 200px; } canvas { width: 100% !important; height: 100% !important; }`]
})
export class BaseChartComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;
  @Input() type: 'line' | 'bar' | 'doughnut' | 'pie' | 'horizontalBar' = 'bar';
  @Input() labels: string[] = [];
  @Input() datasets: { label: string; data: number[]; backgroundColor?: string | string[]; borderColor?: string; fill?: boolean; tension?: number; borderRadius?: number }[] = [];
  @Input() options: Record<string, unknown> = {};

  private chart: Chart | null = null;

  ngAfterViewInit(): void {
    this.render();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private render(): void {
    this.chart?.destroy();
    const ctx = this.canvas.nativeElement.getContext('2d');
    if (!ctx) return;
    const isBar = this.type === 'bar' || this.type === 'horizontalBar';
    this.chart = new Chart(ctx, {
      type: this.type === 'horizontalBar' ? 'bar' : this.type,
      data: { labels: this.labels, datasets: this.datasets.map(d => ({
        ...d,
        backgroundColor: d.backgroundColor || (isBar ? ['#4B1238', '#6B1E4B', '#10b981', '#f59e0b', '#ef4444', '#6d4cc2'] : '#4B1238'),
        borderColor: d.borderColor || '#4B1238',
        fill: d.fill ?? true,
        tension: d.tension ?? 0.4,
        borderRadius: d.borderRadius ?? (isBar ? 4 : undefined),
        indexAxis: this.type === 'horizontalBar' ? 'y' : undefined
      }))},
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: this.datasets.length > 1 || this.type === 'doughnut' || this.type === 'pie', position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } } },
        scales: (this.type === 'doughnut' || this.type === 'pie') ? undefined : {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { font: { size: 10 } } }
        },
        ...this.options
      }
    });
  }
}
