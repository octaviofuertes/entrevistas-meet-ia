import { Component, Input, OnChanges } from '@angular/core';

export type FaceKind = 'happy' | 'neutral' | 'sad' | 'na';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
  face: FaceKind;
}

interface ComputedSegment extends DonutSegment {
  len: number;
  dashoffset: number;
  circ: number;
}

@Component({
  selector: 'app-analytics-donut',
  template: `
    <div class="card">
      <div *ngIf="eyebrow" class="text-xs text-slate-400">{{ eyebrow }}</div>
      <h3 class="text-lg font-semibold text-slate-800 mb-4">{{ title }}</h3>

      <div class="flex items-center justify-center">
        <svg [attr.width]="size" [attr.height]="size" [attr.viewBox]="'0 0 ' + size + ' ' + size">
          <circle [attr.cx]="cx" [attr.cy]="cy" [attr.r]="r" fill="none" stroke="#f1f5f9" [attr.stroke-width]="stroke" />
          <ng-container *ngFor="let seg of computed">
            <circle *ngIf="seg.value > 0"
              [attr.cx]="cx" [attr.cy]="cy" [attr.r]="r"
              fill="none" [attr.stroke]="seg.color" [attr.stroke-width]="stroke"
              [attr.stroke-dasharray]="seg.len + ' ' + (seg.circ - seg.len)"
              [attr.stroke-dashoffset]="seg.dashoffset"
              [attr.transform]="'rotate(-90 ' + cx + ' ' + cy + ')'"
            />
          </ng-container>
        </svg>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
        <div *ngFor="let seg of segments" class="flex flex-col items-center text-center gap-1">
          <svg [attr.width]="26" [attr.height]="26" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="11" [attr.fill]="seg.color" />
            <ng-container *ngIf="seg.face === 'na'">
              <line x1="8" y1="8" x2="16" y2="16" stroke="#fff" stroke-width="2" stroke-linecap="round" />
              <line x1="16" y1="8" x2="8" y2="16" stroke="#fff" stroke-width="2" stroke-linecap="round" />
            </ng-container>
            <ng-container *ngIf="seg.face !== 'na'">
              <circle cx="8.5" cy="10" r="1.4" fill="#fff" />
              <circle cx="15.5" cy="10" r="1.4" fill="#fff" />
              <path *ngIf="seg.face === 'happy'" d="M7.5 14 Q12 18 16.5 14" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" />
              <line *ngIf="seg.face === 'neutral'" x1="8" y1="15" x2="16" y2="15" stroke="#fff" stroke-width="1.8" stroke-linecap="round" />
              <path *ngIf="seg.face === 'sad'" d="M7.5 16 Q12 12 16.5 16" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" />
            </ng-container>
          </svg>
          <span class="text-[11px] text-slate-500 leading-tight">{{ seg.label }}</span>
          <span class="text-sm font-semibold text-slate-800">{{ seg.value }}%</span>
        </div>
      </div>

      <p *ngIf="footnote" class="text-[11px] italic text-slate-400 text-center mt-4">{{ footnote }}</p>
    </div>
  `,
})
export class AnalyticsDonutComponent implements OnChanges {
  @Input() eyebrow?: string;
  @Input() title = '';
  @Input() segments: DonutSegment[] = [];
  @Input() footnote?: string;

  size = 180;
  stroke = 26;
  r = 0;
  cx = 0;
  cy = 0;
  computed: ComputedSegment[] = [];

  ngOnChanges(): void {
    this.r = (this.size - this.stroke) / 2;
    this.cx = this.size / 2;
    this.cy = this.size / 2;
    const circ = 2 * Math.PI * this.r;
    const total = this.segments.reduce((a, s) => a + (s.value > 0 ? s.value : 0), 0);
    let offsetAcc = 0;
    this.computed = this.segments.map(seg => {
      const len = total > 0 ? (seg.value / 100) * circ : 0;
      const dashoffset = -offsetAcc;
      offsetAcc += len;
      return { ...seg, len, dashoffset, circ };
    });
  }
}
