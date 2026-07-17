import { Component, Input, OnChanges } from '@angular/core';

export interface RadarSeries {
  name: string;
  values: number[];
  color: string;
  fill: string;
}

interface AxisData { label: string; x: number; y: number; lx: number; ly: number; anchor: string; }
interface SeriesData { name: string; color: string; fill: string; points: string; dots: { x: number; y: number }[]; }

@Component({
  selector: 'app-radar-chart',
  template: `
    <div class="flex flex-col items-center">
      <svg width="100%" [attr.viewBox]="'0 0 ' + size + ' ' + size" class="max-w-[460px]">
        <polygon *ngFor="let ring of rings" [attr.points]="ring" fill="none" stroke="#e2e8f0" stroke-width="1" />
        <g *ngFor="let axis of axisData">
          <line [attr.x1]="cx" [attr.y1]="cy" [attr.x2]="axis.x" [attr.y2]="axis.y" stroke="#e2e8f0" stroke-width="1" />
          <text [attr.x]="axis.lx" [attr.y]="axis.ly" [attr.text-anchor]="axis.anchor"
            dominant-baseline="middle" class="fill-slate-500" font-size="12">{{ axis.label }}</text>
        </g>
        <g *ngFor="let s of seriesData">
          <polygon [attr.points]="s.points" [attr.fill]="s.fill" [attr.stroke]="s.color" stroke-width="2" />
          <circle *ngFor="let d of s.dots" [attr.cx]="d.x" [attr.cy]="d.y" r="3" [attr.fill]="s.color" />
        </g>
      </svg>
      <div class="flex flex-wrap items-center justify-center gap-4 mt-2">
        <div *ngFor="let s of series" class="flex items-center gap-2 text-sm text-slate-600">
          <span class="inline-block w-4 h-2 rounded" [style.backgroundColor]="s.color"></span>
          {{ s.name }}
        </div>
      </div>
    </div>
  `,
})
export class RadarChartComponent implements OnChanges {
  @Input() axes: string[] = [];
  @Input() series: RadarSeries[] = [];
  @Input() max = 10;

  size = 420;
  cx = 210;
  cy = 210;
  radius = 140;
  rings: string[] = [];
  axisData: AxisData[] = [];
  seriesData: SeriesData[] = [];

  ngOnChanges(): void {
    this.cx = this.size / 2;
    this.cy = this.size / 2;
    this.radius = this.size / 2 - 70;
    const n = this.axes.length;
    const rings = 5;

    const angleOf = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const point = (i: number, value: number): [number, number] => {
      const r = (Math.max(0, Math.min(this.max, value)) / this.max) * this.radius;
      const a = angleOf(i);
      return [this.cx + r * Math.cos(a), this.cy + r * Math.sin(a)];
    };

    this.rings = Array.from({ length: rings }, (_, k) =>
      this.axes.map((_, i) => {
        const r = ((k + 1) / rings) * this.radius;
        const a = angleOf(i);
        return `${this.cx + r * Math.cos(a)},${this.cy + r * Math.sin(a)}`;
      }).join(' ')
    );

    this.axisData = this.axes.map((label, i) => {
      const [x, y] = point(i, this.max);
      const a = angleOf(i);
      const lr = this.radius + 26;
      const lx = this.cx + lr * Math.cos(a);
      const ly = this.cy + lr * Math.sin(a);
      const anchor = Math.abs(lx - this.cx) < 12 ? 'middle' : lx > this.cx ? 'start' : 'end';
      return { label, x, y, lx, ly, anchor };
    });

    this.seriesData = this.series.map(s => ({
      name: s.name,
      color: s.color,
      fill: s.fill,
      points: s.values.map((v, i) => point(i, v).join(',')).join(' '),
      dots: s.values.map((v, i) => { const [x, y] = point(i, v); return { x, y }; }),
    }));
  }
}
