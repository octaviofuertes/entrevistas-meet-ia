import { AfterViewChecked, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';

// Todo relativo al origen actual (:4200 en dev) para pasar por proxy.conf.json:
//   '/api'  → http://localhost:4000   ·   '/ws' → ws://localhost:4000
// Así no hay CORS y funciona igual detrás de cualquier host/https en producción.
const ORIGIN = typeof location !== 'undefined' ? location.origin : 'http://localhost:4200';
const WS_URL = typeof location !== 'undefined'
  ? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
  : 'ws://localhost:4200';
const API_URL = '';
const FRONTEND_URL = ORIGIN;

interface SalaInfo {
  interviewId: string; status: string;
  jobTitle: string; company: string;
  candidateName: string; voiceMode?: string;
}
type Phase = 'loading' | 'lobby' | 'running' | 'finished' | 'error';
type CvStatus = 'idle' | 'uploading' | 'ok' | 'error' | 'empty';

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
}

function resampleTo16kPCM(input: Float32Array, from: number): Int16Array {
  if (from === 16000) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = from / 16000;
  const len = Math.floor(input.length / ratio);
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const si = i * ratio;
    const i0 = Math.floor(si), i1 = Math.min(i0 + 1, input.length - 1);
    const sample = input[i0] * (1 - (si - i0)) + input[i1] * (si - i0);
    const s = Math.max(-1, Math.min(1, sample));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

@Component({
  selector: 'app-sala',
  templateUrl: './sala.component.html',
})
export class SalaComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('idleVid')  idleVidRef?:  ElementRef<HTMLVideoElement>;
  @ViewChild('talkVid')  talkVidRef?:  ElementRef<HTMLVideoElement>;
  @ViewChild('lobbyVid') lobbyVidRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('pipVid')   pipVidRef?:   ElementRef<HTMLVideoElement>;

  // Public state (template)
  info:      SalaInfo | null = null;
  phase:     Phase = 'loading';
  errMsg   = '';
  leiaSpeaking = false;
  leiaThinking = false;
  subtitle = '';
  showCC   = true;
  micOn    = true;
  cameraOn = true;
  consentRecording = false;
  consentAnalysis  = false;
  cvStatus: CvStatus = 'idle';
  elapsed  = 0;
  recording = false;
  reportsReady: number[] = [];
  reportSlow   = false;
  listening    = false;
  interimText  = '';
  dots = '';

  // Internal mirrors (stable refs for callbacks)
  private _micOn    = true;
  private _cameraOn = true;
  private _consentRec = false;
  private _consentAna = false;
  private _phase: Phase = 'loading';
  private _leiaSpeaking = false;

  private currentStream: MediaStream | null = null;
  private streamRef:     MediaStream | null = null;
  private lobbyStream:   MediaStream | null = null;

  private ws:   WebSocket | null = null;
  private timerInt: any = null;
  private dotsInt:  any = null;
  private reportSlowTimer: any = null;

  private audioCtx:     AudioContext | null = null;
  private masterGain:   GainNode | null = null;
  private leiaAudioDest: MediaStreamAudioDestinationNode | null = null;
  // leIA se reproduce por un <audio> alimentado por este MediaStreamDestination:
  // así el cancelador de eco (AEC) del navegador conoce la salida de leIA y la
  // cancela del micrófono. Enrutar Web Audio directo a ctx.destination NO pasa
  // por el AEC → el candidato escucha eco de su propia voz al hablar.
  private speakerDest:  MediaStreamAudioDestinationNode | null = null;
  private leiaAudioEl:  HTMLAudioElement | null = null;
  private drainTimer:   any = null;

  private decodeChain:   Promise<void> = Promise.resolve();
  private nextStartTime  = 0;
  private activeSources  = new Set<AudioBufferSourceNode>();
  private playbackGen    = 0;
  private leiaStreaming   = false;

  private micSource:    MediaStreamAudioSourceNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null;

  private recorder:  MediaRecorder | null = null;
  private chunks:    Blob[] = [];
  private mimeType   = '';
  private canvas:    HTMLCanvasElement | null = null;
  private animFrame  = 0;

  // Web Speech
  private recognition:   any = null;
  private silenceTimer:  any = null;
  private finalBuf       = '';
  private readonly SILENCE_MS = 2000;
  /** Gracia tras agotarse el audio antes de volver el avatar a idle (bridge de chunks). */
  private readonly DRAIN_GRACE_MS = 200;

  constructor(
    private route: ActivatedRoute,
    private api:   ApiService,
    private zone:  NgZone,
  ) {}

  get interviewId(): string { return this.route.snapshot.params['id']; }
  get apiUrl():      string { return API_URL; }
  get frontendUrl(): string { return FRONTEND_URL; }
  get hasReport():   boolean { return this.reportsReady.length > 0; }

  get meetCode(): string {
    const id = this.interviewId;
    return id.length >= 10 ? `${id.slice(0,3)}-${id.slice(3,7)}-${id.slice(7,10)}` : id;
  }

  fmt(s: number): string {
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  ngOnInit() {
    window.addEventListener('beforeunload', this.onUnload);
    fetch(`${API_URL}/api/sala/${this.interviewId}/info`)
      .then(r => { if (!r.ok) throw new Error('sala_no_encontrada'); return r.json(); })
      .then((d: SalaInfo) => this.zone.run(() => { this.info = d; this.setPhase('lobby'); this.startLobbyCamera(); }))
      .catch(e => this.zone.run(() => { this.errMsg = e?.message ?? 'Error'; this.setPhase('error'); }));
  }

  ngOnDestroy() {
    window.removeEventListener('beforeunload', this.onUnload);
    if (this.timerInt) clearInterval(this.timerInt);
    if (this.dotsInt)  clearInterval(this.dotsInt);
    if (this.reportSlowTimer) { clearTimeout(this.reportSlowTimer); this.reportSlowTimer = null; }
    if (this.drainTimer) { clearTimeout(this.drainTimer); this.drainTimer = null; }
    this.ws?.close();
    this.streamRef?.getTracks().forEach(t => t.stop());
    this.lobbyStream?.getTracks().forEach(t => t.stop());
    if (this.leiaAudioEl) { this.leiaAudioEl.pause(); this.leiaAudioEl.srcObject = null; this.leiaAudioEl.remove(); this.leiaAudioEl = null; }
    this.audioCtx?.close().catch(() => {});
    this.stopRecognition();
  }

  // Sync stream → video after each view check
  ngAfterViewChecked() {
    const str = this.currentStream;
    if (this.phase === 'lobby' && this.lobbyVidRef && str) {
      this.attachSelfView(this.lobbyVidRef.nativeElement, str);
    }
    if (this.phase === 'running' && this.pipVidRef && str) {
      this.attachSelfView(this.pipVidRef.nativeElement, str);
    }
  }

  /**
   * Asigna el stream al self-view SIN que suene nunca. El atributo `muted` del
   * HTML no siempre se respeta al setear srcObject por JS, así que forzamos las
   * PROPIEDADES muted/volume del elemento. Sumado a que el stream es video-only
   * (ver joinCall), el candidato jamás se escucha a sí mismo.
   */
  private attachSelfView(el: HTMLVideoElement, str: MediaStream) {
    el.muted = true;
    el.volume = 0;
    if (el.srcObject !== str) el.srcObject = str;
  }

  private onUnload = () => navigator.sendBeacon(`${API_URL}/api/sala/${this.interviewId}/finalize`);

  private setPhase(p: Phase) { this.phase = p; this._phase = p; }

  // ── Lobby camera ──────────────────────────────────────────────────────────
  private startLobbyCamera() {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(s => this.zone.run(() => { this.lobbyStream = s; this.currentStream = s; }))
      .catch(() => {});
  }

  // ── Voice recognition ─────────────────────────────────────────────────────
  private startRecognition() {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR || this.recognition) return;
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = 'es-AR';
    rec.onresult = (ev: any) => {
      this.zone.run(() => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) this.finalBuf += r[0].transcript + ' ';
          else interim += r[0].transcript;
        }
        this.interimText = interim;
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        this.silenceTimer = setTimeout(() => {
          const text = (this.finalBuf + interim).trim();
          this.finalBuf = ''; this.interimText = '';
          if (text && this._phase === 'running')
            this.ws?.readyState === WebSocket.OPEN &&
              this.ws!.send(JSON.stringify({ type: 'transcript', text, isFinal: true }));
        }, this.SILENCE_MS);
      });
    };
    rec.onend = () => {
      this.zone.run(() => this.listening = false);
      if (this._phase === 'running' && this._micOn && !this._leiaSpeaking && this.recognition)
        setTimeout(() => { try { rec.start(); this.zone.run(() => this.listening = true); } catch {} }, 200);
    };
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed') return;
      this.recognition = null;
    };
    this.recognition = rec;
    try { rec.start(); this.listening = true; } catch {}
  }

  private stopRecognition() {
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    if (!this.recognition) return;
    const r = this.recognition; this.recognition = null;
    r.onend = null; try { r.stop(); } catch {}
    this.zone.run(() => { this.listening = false; this.interimText = ''; });
  }

  // ── Playback ──────────────────────────────────────────────────────────────
  private enterSpeakingUI() {
    // Llega audio nuevo: cancelamos cualquier vuelta-a-idle pendiente.
    if (this.drainTimer) { clearTimeout(this.drainTimer); this.drainTimer = null; }
    if (this._leiaSpeaking) return; // ya en modo hablando (idempotente entre chunks)
    this._leiaSpeaking = true;
    this.zone.run(() => { this.leiaSpeaking = true; this.leiaThinking = false; });
    this.stopRecognition();
    const idle = this.idleVidRef?.nativeElement, talk = this.talkVidRef?.nativeElement;
    if (idle) { idle.style.display = 'none'; idle.pause(); }
    if (talk) { talk.style.display = 'block'; talk.currentTime = 0; talk.play().catch(() => {}); }
  }

  /**
   * El último source de audio terminó. En vez de saltar a idle de una (lo que
   * parpadea el avatar entre chunks), esperamos una ventana de gracia: si llega
   * más audio seguimos hablando; si no, el avatar vuelve a idle. Así el avatar
   * sigue el audio REAL y no la señal leiaStreaming del backend, que puede
   * quedar activa dejando el video "hablando" sin sonido.
   */
  private scheduleDrain() {
    if (this.drainTimer) return;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      if (this.activeSources.size > 0) return; // el audio se reanudó
      this.goIdle();
    }, this.DRAIN_GRACE_MS);
  }

  private goIdle() {
    if (this.drainTimer) { clearTimeout(this.drainTimer); this.drainTimer = null; }
    this._leiaSpeaking = false;
    this.zone.run(() => { this.leiaSpeaking = false; });
    this.nextStartTime = 0;
    const idle = this.idleVidRef?.nativeElement, talk = this.talkVidRef?.nativeElement;
    if (idle) { idle.style.display = 'block'; idle.play().catch(() => {}); }
    if (talk) { talk.style.display = 'none'; talk.pause(); }
    // Rehabilitamos el mic sólo si el backend ya terminó de mandar audio de este
    // turno (leiaStreaming=false). Si sigue streameando, lo hará speaking_done.
    if (!this.leiaStreaming && this._micOn && this._phase === 'running') this.startRecognition();
  }

  private stopPlayback() {
    this.playbackGen++;
    for (const s of this.activeSources) { try { s.stop(); } catch {} }
    this.activeSources.clear();
    this.nextStartTime = 0;
  }

  private enqueueAudio(audioBase64: string) {
    this.zone.run(() => this.leiaThinking = false);
    const gen = this.playbackGen;
    this.decodeChain = this.decodeChain.then(async () => {
      const ctx = this.audioCtx;
      if (!ctx || gen !== this.playbackGen) return;
      let buf: AudioBuffer;
      try {
        const bytes = atob(audioBase64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        buf = await ctx.decodeAudioData(arr.buffer);
      } catch { return; }
      if (gen !== this.playbackGen) return;
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(this.masterGain ?? ctx.destination);
      const startAt = Math.max(ctx.currentTime + 0.02, this.nextStartTime);
      this.nextStartTime = startAt + buf.duration;
      if (this.activeSources.size === 0) this.enterSpeakingUI();
      this.activeSources.add(source);
      source.onended = () => {
        this.activeSources.delete(source);
        if (this.activeSources.size === 0) this.scheduleDrain();
      };
      source.start(startAt);
    });
  }

  // ── Mic capture (live mode) ───────────────────────────────────────────────
  private startCandidateAudioCapture(stream: MediaStream) {
    const ctx = this.audioCtx;
    if (!ctx) return;
    const fromRate = ctx.sampleRate;
    const source = ctx.createMediaStreamSource(stream);
    this.micSource = source;
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const silent = ctx.createGain(); silent.gain.value = 0;
    proc.onaudioprocess = (e) => {
      if (!this._micOn) return;
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const pcm16 = resampleTo16kPCM(e.inputBuffer.getChannelData(0), fromRate);
      const bytes = new Uint8Array(pcm16.buffer);
      let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      ws.send(JSON.stringify({ type: 'candidate_audio', pcmBase64: btoa(bin) }));
    };
    source.connect(proc); proc.connect(silent); silent.connect(ctx.destination);
    this.micProcessor = proc;
  }

  private stopCandidateAudioCapture() {
    this.micProcessor?.disconnect(); this.micProcessor = null;
    this.micSource?.disconnect();    this.micSource = null;
  }

  // ── Join call ─────────────────────────────────────────────────────────────
  async joinCall() {
    this.lobbyStream?.getTracks().forEach(t => t.stop());
    this.lobbyStream = null;

    const ctx = new ((window as any).AudioContext ?? (window as any).webkitAudioContext)() as AudioContext;
    if (ctx.state === 'suspended') await ctx.resume();
    this.audioCtx = ctx;
    const gain = ctx.createGain();
    this.masterGain = gain;
    // leIA NO va directo a ctx.destination (bypassea el AEC → eco). Va a un
    // MediaStreamDestination reproducido por un <audio>, que el AEC sí cancela.
    const speakerDest = ctx.createMediaStreamDestination();
    gain.connect(speakerDest);
    this.speakerDest = speakerDest;
    const audioEl = new Audio();
    audioEl.srcObject = speakerDest.stream;
    audioEl.autoplay = true;
    (audioEl as any).playsInline = true;
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl); // adjunto al DOM: reproducción confiable del MediaStream
    audioEl.play().catch(() => {});
    this.leiaAudioEl = audioEl;

    this.zone.run(() => this.setPhase('running'));

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.streamRef = stream;
      stream.getVideoTracks().forEach(t => (t.enabled = this._cameraOn));
      stream.getAudioTracks().forEach(t => (t.enabled = this._micOn));
      // El self-view (PiP) recibe SÓLO la pista de video: sin pista de audio, el
      // candidato no puede escucharse a sí mismo pase lo que pase con el atributo
      // `muted` del <video>. El audio real del micrófono vive en streamRef (para
      // la grabación) y nunca se rutea a un elemento que suene.
      const displayStream = new MediaStream(stream.getVideoTracks());
      this.zone.run(() => { this.currentStream = displayStream; });
      if (this.info?.voiceMode === 'live') this.startCandidateAudioCapture(stream);
    } catch {}

    setTimeout(() => { this.talkVidRef?.nativeElement?.load(); }, 100);

    this.timerInt = setInterval(() => this.zone.run(() => this.elapsed++), 1000);

    const ws = new WebSocket(`${WS_URL}/ws/sala/${this.interviewId}`);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'ready', consentRecording: this._consentRec, consentAnalysis: this._consentAna }));
      this.zone.run(() => this.leiaThinking = true);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === 'audio')       this.enqueueAudio(msg.audioBase64);
        if (msg.type === 'question')    this.zone.run(() => this.subtitle = msg.text ?? '');
        if (msg.type === 'status' && msg.status === 'en_curso') this.zone.run(() => this.leiaThinking = true);
        if (msg.type === 'stop_audio')  {
          this.leiaStreaming = false;
          this.stopPlayback();
          this.goIdle(); // barge-in: cortar el avatar de una
        }
        if (msg.type === 'speaking_start') this.leiaStreaming = true;
        if (msg.type === 'speaking_done') {
          this.leiaStreaming = false;
          // Backend terminó de mandar audio del turno: si ya no suena nada,
          // avatar a idle + mic habilitado; si sigue sonando, lo hará el drain.
          if (this.activeSources.size === 0) this.goIdle();
        }
        if (msg.type === 'finished')    this.endCall();
        if (msg.type === 'report_ready') this.zone.run(() => {
          if (!this.reportsReady.includes(msg.kind)) this.reportsReady = [...this.reportsReady, msg.kind];
        });
      } catch {}
    };
    const ka = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 25000);
    ws.onclose = () => clearInterval(ka);
  }

  // ── Recording ─────────────────────────────────────────────────────────────
  startRecording() {
    if (this.recorder) return;
    const mime = getSupportedMimeType(); if (!mime) return;
    this.mimeType = mime; this.chunks = [];
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const ctx2d = canvas.getContext('2d')!;
    this.canvas = canvas;
    const drawFrame = () => {
      ctx2d.fillStyle = '#111'; ctx2d.fillRect(0, 0, 1280, 720);
      const leiaVid = this._leiaSpeaking ? this.talkVidRef?.nativeElement : this.idleVidRef?.nativeElement;
      if (leiaVid && leiaVid.readyState >= 2) { try { ctx2d.drawImage(leiaVid, 0, 0, 1280, 720); } catch {} }
      const pip = this.pipVidRef?.nativeElement;
      if (pip && pip.readyState >= 2) {
        const pw = 202, ph = 114, m = 12;
        ctx2d.save();
        ctx2d.translate(1280 - m - pw / 2, 720 - m - ph / 2);
        ctx2d.scale(-1, 1); ctx2d.drawImage(pip, -pw / 2, -ph / 2, pw, ph); ctx2d.restore();
        ctx2d.strokeStyle = 'rgba(255,255,255,0.25)'; ctx2d.lineWidth = 1;
        ctx2d.strokeRect(1280 - m - pw, 720 - m - ph, pw, ph);
      }
      this.animFrame = requestAnimationFrame(drawFrame);
    };
    drawFrame();
    const cs = canvas.captureStream(25);
    if (this.audioCtx && this.masterGain) {
      const dest = this.audioCtx.createMediaStreamDestination();
      this.masterGain.connect(dest); this.leiaAudioDest = dest;
      dest.stream.getAudioTracks().forEach(t => cs.addTrack(t));
      if (this.streamRef) {
        const ms = this.audioCtx.createMediaStreamSource(this.streamRef);
        const mg = this.audioCtx.createGain(); ms.connect(mg); mg.connect(dest);
      }
    }
    try {
      const mr = new MediaRecorder(cs, { mimeType: mime });
      mr.ondataavailable = e => { if (e.data.size > 0) this.chunks.push(e.data); };
      mr.start(3000); this.recorder = mr; this.zone.run(() => this.recording = true);
    } catch { cancelAnimationFrame(this.animFrame); this.canvas = null; }
  }

  async stopRecording(download = true) {
    cancelAnimationFrame(this.animFrame); this.canvas = null;
    const mr = this.recorder; this.recorder = null;
    this.zone.run(() => this.recording = false);
    if (mr && mr.state !== 'inactive') { mr.stop(); await new Promise<void>(r => { mr.onstop = () => r(); }); }
    if (this.leiaAudioDest && this.masterGain) {
      try { this.masterGain.disconnect(this.leiaAudioDest); } catch {} this.leiaAudioDest = null;
    }
    if (!download) return;
    const blob = new Blob(this.chunks, { type: this.mimeType || 'video/webm' });
    if (blob.size < 5000) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `entrevista-${this.interviewId.slice(0,8)}.${this.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 8000);
    fetch(`${API_URL}/api/sala/${this.interviewId}/recording`, {
      method: 'POST', headers: { 'Content-Type': blob.type.split(';')[0] || 'video/webm' }, body: blob,
    }).catch(err => console.warn('sala: no se pudo subir la grabación', err));
  }

  // ── End call ──────────────────────────────────────────────────────────────
  async endCall() {
    if (this._phase === 'finished') return;
    this.zone.run(() => this.setPhase('finished'));
    this.stopRecognition();
    if (this.timerInt) { clearInterval(this.timerInt); this.timerInt = null; }
    this.stopPlayback();
    if (this.drainTimer) { clearTimeout(this.drainTimer); this.drainTimer = null; }
    if (this.recorder) await this.stopRecording(true);
    if (this.leiaAudioEl) { this.leiaAudioEl.pause(); this.leiaAudioEl.srcObject = null; this.leiaAudioEl.remove(); this.leiaAudioEl = null; }
    this.speakerDest = null;
    this.audioCtx?.close().catch(() => {});
    this.stopCandidateAudioCapture();
    this.streamRef?.getTracks().forEach(t => t.stop());
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'hangup' }));
      setTimeout(() => { if (ws.readyState === WebSocket.OPEN) ws.close(); }, 90_000);
    }
    this.dotsInt = setInterval(() => this.zone.run(() => {
      this.dots = this.dots.length >= 3 ? '' : this.dots + '.';
    }), 500);
    // Red de seguridad: si el informe no llega en un tiempo razonable (backend
    // caído, WS perdido), no dejamos la pantalla en "Generando informe…" para
    // siempre — avisamos que quedará disponible en el detalle de la entrevista.
    this.reportSlowTimer = setTimeout(() => {
      if (!this.hasReport) this.zone.run(() => this.reportSlow = true);
    }, 45_000);
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  toggleMic() {
    const next = !this._micOn; this._micOn = next;
    this.zone.run(() => this.micOn = next);
    this.streamRef?.getAudioTracks().forEach(t => (t.enabled = next));
    if (!next) this.stopRecognition();
    else if (this._phase === 'running' && !this._leiaSpeaking) this.startRecognition();
  }

  toggleCam() {
    const next = !this._cameraOn; this._cameraOn = next;
    this.zone.run(() => this.cameraOn = next);
    this.streamRef?.getVideoTracks().forEach(t => (t.enabled = next));
  }

  toggleRec() { if (!this.recorder) this.startRecording(); else this.stopRecording(true); }

  setConsentRecording(v: boolean) { this.consentRecording = v; this._consentRec = v; }
  setConsentAnalysis(v: boolean)  { this.consentAnalysis  = v; this._consentAna  = v; }

  async uploadCv(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.cvStatus = 'uploading';
    try {
      const r = await this.api.apiUploadCv(this.interviewId, file);
      this.cvStatus = r.extracted ? 'ok' : 'empty';
    } catch { this.cvStatus = 'error'; }
  }
}
