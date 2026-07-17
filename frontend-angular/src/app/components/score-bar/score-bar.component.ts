import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-score-bar',
  template: `
    <div>
      <div class="flex items-center justify-between mb-1 text-sm">
        <span class="text-slate-700 capitalize">{{ label }}</span>
        <span class="font-semibold text-slate-900">
          {{ value.toFixed(1) }}<span class="text-slate-400 text-xs font-normal"> / {{ max }}</span>
        </span>
      </div>
      <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div class="h-full transition-all rounded-full {{ colorClass }}" [style.width]="pct + '%'"></div>
      </div>
    </div>
  `,
})
export class ScoreBarComponent {
  @Input() label = '';
  @Input() value = 0;
  @Input() max = 10;

  get pct(): number {
    return Math.max(0, Math.min(100, (this.value / this.max) * 100));
  }

  get colorClass(): string {
    return this.value >= this.max * 0.75 ? 'bg-green-500'
      : this.value >= this.max * 0.55 ? 'bg-yellow-500'
      : 'bg-red-500';
  }
}
