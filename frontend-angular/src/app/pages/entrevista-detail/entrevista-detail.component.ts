import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { ALL_DIMENSIONS, DIMENSION_LABELS } from '../../models/types';
import type { InterviewDetail, TTSDriver } from '../../models/types';

const FRONTEND_URL = 'http://localhost:4200';
const API_URL = 'http://localhost:4000';

const TTS_OPTIONS: Array<{ value: TTSDriver; label: string }> = [
  { value: 'gemini', label: 'Gemini TTS' },
  { value: 'edge', label: 'Microsoft TTS' },
];

@Component({
  selector: 'app-entrevista-detail',
  templateUrl: './entrevista-detail.component.html',
})
export class EntrevistaDetailComponent implements OnInit {
  data: InterviewDetail | null = null;
  loading = true;
  error: string | null = null;
  selectedTtsDriver: TTSDriver = 'gemini';
  savingTts = false;
  starting = false;
  copied = false;

  readonly ttsOptions = TTS_OPTIONS;
  readonly allDimensions = ALL_DIMENSIONS;
  readonly dimensionLabels = DIMENSION_LABELS;
  readonly apiUrl = API_URL;

  constructor(private route: ActivatedRoute, private api: ApiService) {}

  async ngOnInit() {
    await this.load();
  }

  get interviewId(): string {
    return this.route.snapshot.params['id'];
  }

  get salaUrl(): string {
    return `${FRONTEND_URL}/sala/${this.interviewId}`;
  }

  get isBrowser(): boolean {
    return this.data?.mode === 'browser';
  }

  get hasR1(): boolean {
    return this.data?.reports.some(r => r.kind === 1) ?? false;
  }

  get hasR2(): boolean {
    return this.data?.reports.some(r => r.kind === 2) ?? false;
  }

  get canEditVoice(): boolean {
    return this.data?.status === 'agendada';
  }

  get selectedVoiceLabel(): string {
    return TTS_OPTIONS.find(o => o.value === this.selectedTtsDriver)?.label ?? 'Gemini TTS';
  }

  async load() {
    try {
      this.loading = true;
      const interview = await this.api.apiGetInterview(this.interviewId);
      this.data = interview;
      this.selectedTtsDriver = interview.ttsDriver === 'edge' ? 'edge' : 'gemini';
      this.error = null;
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  async onStart() {
    if (!this.isBrowser) {
      if (!this.data?.meetUrl) { alert('No hay link de Meet configurado'); return; }
      window.open(this.data.meetUrl, '_blank');
    }
    try {
      this.starting = true;
      await this.api.apiStartInterview(this.interviewId, { ttsDriver: this.selectedTtsDriver });
      await this.load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      this.starting = false;
    }
  }

  async copySalaUrl() {
    await navigator.clipboard.writeText(this.salaUrl);
    this.copied = true;
    setTimeout(() => this.copied = false, 2000);
  }

  async onSelectTtsDriver(driver: TTSDriver) {
    if (!this.data || this.data.status !== 'agendada' || this.savingTts) return;
    const previous = this.selectedTtsDriver;
    this.selectedTtsDriver = driver;
    this.savingTts = true;
    try {
      const res = await this.api.apiUpdateInterviewTTS(this.interviewId, driver);
      if (this.data) {
        this.data = { ...this.data, ttsDriver: res.interview?.ttsDriver ?? driver };
      }
    } catch (e: any) {
      this.selectedTtsDriver = previous;
      alert(e.message || 'No se pudo guardar la voz');
    } finally {
      this.savingTts = false;
    }
  }

  formatDate(d: string): string {
    return new Date(d).toLocaleString('es-AR');
  }

  durationMin(sec: number): string {
    return `${Math.round(sec / 60)} min`;
  }
}
