'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type SR = any;

interface VoiceOptions {
  lang?: string;
  /**
   * Si se define, se invoca cuando hay {silenceMs} milisegundos sin actividad
   * después de un fragmento final del candidato. Útil para envío automático.
   */
  onSilence?: (finalText: string) => void;
  /** Tiempo de silencio para considerar que terminó de hablar (default 1800 ms). */
  silenceMs?: number;
  /** Cantidad mínima de palabras antes de disparar onSilence (default 2). */
  minWordsForSilence?: number;
}

export interface VoiceController {
  supported: boolean;
  listening: boolean;
  interimText: string;
  finalText: string;
  speaking: boolean;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  setSelectedVoice: (v: SpeechSynthesisVoice | null) => void;
  startListening: () => void;
  stopListening: () => void;
  resetFinal: () => void;
  speak: (text: string, opts?: { onEnd?: () => void }) => void;
  stopSpeaking: () => void;
}

/**
 * Hook que abstrae Web Speech Recognition (micrófono → texto) y
 * SpeechSynthesis (texto → voz). Funciona 100% en el navegador,
 * sin servicios externos.
 *
 * Disponibilidad:
 *   - Chrome, Edge: SpeechRecognition (con prefijo webkit) y SpeechSynthesis ✓
 *   - Firefox: SpeechSynthesis ✓ · SpeechRecognition limitado
 *   - Safari: ambos con limitaciones
 */
export function useVoice(opts: VoiceOptions = {}): VoiceController {
  const lang = opts.lang ?? 'es-AR';
  const silenceMs = opts.silenceMs ?? 1800;
  const minWords = opts.minWordsForSilence ?? 2;
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  const recRef = useRef<SR | null>(null);
  const finalTextRef = useRef('');
  const restartRequestedRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onSilenceRef = useRef(opts.onSilence);
  useEffect(() => {
    onSilenceRef.current = opts.onSilence;
  }, [opts.onSilence]);

  const supported =
    typeof window !== 'undefined' &&
    typeof (window as any).SpeechRecognition !== 'undefined' &&
    'speechSynthesis' in window;

  const supportedAny =
    typeof window !== 'undefined' &&
    (typeof (window as any).SpeechRecognition !== 'undefined' ||
      typeof (window as any).webkitSpeechRecognition !== 'undefined') &&
    'speechSynthesis' in window;

  // Cargar voces (cargan async en algunos browsers)
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const load = () => {
      const all = window.speechSynthesis.getVoices();
      setVoices(all);
      // Elegimos primero una voz en español rioplatense o español de cualquier región
      const esAR = all.find((v) => v.lang === 'es-AR');
      const esGeneric = all.find((v) => v.lang.startsWith('es'));
      setSelectedVoice((prev) => prev ?? esAR ?? esGeneric ?? all[0] ?? null);
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Crear / destruir reconocimiento
  const buildRecognition = useCallback((): SR | null => {
    if (typeof window === 'undefined') return null;
    const Ctor: any =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return null;
    const rec: SR = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev: any) => {
      let interim = '';
      let finals = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finals += t + ' ';
        else interim += t;
      }
      setInterimText(interim.trim());
      if (finals.trim()) {
        finalTextRef.current = (finalTextRef.current + ' ' + finals).trim();
        setFinalText(finalTextRef.current);
      }
      // Detección de silencio: cada nuevo fragmento reinicia el timer.
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        const text = finalTextRef.current.trim();
        const words = text.split(/\s+/).filter(Boolean).length;
        if (text && words >= minWords && onSilenceRef.current) {
          onSilenceRef.current(text);
        }
      }, silenceMs);
    };
    rec.onerror = () => {
      // ignorar; muchos errores son "no-speech" o "aborted"
    };
    rec.onend = () => {
      // Si el usuario sigue queriendo escuchar, reiniciamos automáticamente.
      // (Web Speech corta tras ~60s en Chrome.)
      if (restartRequestedRef.current) {
        try {
          rec.start();
          return;
        } catch {
          // ya estaba corriendo o falla por timing — pasa al estado detenido
        }
      }
      setListening(false);
      setInterimText('');
    };
    return rec;
  }, [lang]);

  const startListening = useCallback(() => {
    if (!supportedAny) return;
    finalTextRef.current = '';
    setFinalText('');
    setInterimText('');
    restartRequestedRef.current = true;
    const rec = recRef.current ?? buildRecognition();
    recRef.current = rec;
    if (!rec) return;
    try {
      rec.start();
      setListening(true);
    } catch {
      // .start() puede tirar si ya estaba corriendo
    }
  }, [buildRecognition, supportedAny]);

  const stopListening = useCallback(() => {
    restartRequestedRef.current = false;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recRef.current) {
      try {
        recRef.current.stop();
      } catch {
        /* noop */
      }
    }
    setListening(false);
  }, []);

  const resetFinal = useCallback(() => {
    finalTextRef.current = '';
    setFinalText('');
    setInterimText('');
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearSpeakTimers = useCallback(() => {
    if (speakWatchdogRef.current) {
      clearTimeout(speakWatchdogRef.current);
      speakWatchdogRef.current = null;
    }
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  }, []);

  const speak = useCallback(
    (text: string, opts?: { onEnd?: () => void }) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) {
        opts?.onEnd?.();
        return;
      }
      clearSpeakTimers();

      // onEnd debe ejecutarse EXACTAMENTE una vez. Chrome a veces no dispara
      // utterance.onend (bug conocido con texto largo o pérdida de foco), así que
      // usamos un watchdog basado en la duración estimada para no quedar colgados.
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearSpeakTimers();
        setSpeaking(false);
        opts?.onEnd?.();
      };

      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = selectedVoice?.lang ?? lang;
        if (selectedVoice) u.voice = selectedVoice;
        u.rate = 1.0;
        u.pitch = 1.0;
        u.onstart = () => setSpeaking(true);
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
        setSpeaking(true);

        // Keepalive: Chrome pausa la síntesis después de ~15 s. resume() lo evita.
        keepAliveRef.current = setInterval(() => {
          try {
            if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
            else clearSpeakTimers();
          } catch {
            /* noop */
          }
        }, 8000);

        // Watchdog: ~165 palabras/min ≈ 360 ms/palabra. + margen amplio.
        const words = text.split(/\s+/).filter(Boolean).length;
        const estimatedMs = Math.max(2500, words * 380 + 1200);
        speakWatchdogRef.current = setTimeout(finish, estimatedMs + 2500);
      } catch {
        finish();
      }
    },
    [lang, selectedVoice, clearSpeakTimers]
  );

  const stopSpeaking = useCallback(() => {
    clearSpeakTimers();
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* noop */
    }
    setSpeaking(false);
  }, [clearSpeakTimers]);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      restartRequestedRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (speakWatchdogRef.current) clearTimeout(speakWatchdogRef.current);
      if (keepAliveRef.current) clearInterval(keepAliveRef.current);
      if (recRef.current) {
        try {
          recRef.current.abort();
        } catch {
          /* noop */
        }
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  return {
    supported: supportedAny,
    listening,
    interimText,
    finalText,
    speaking,
    voices,
    selectedVoice,
    setSelectedVoice,
    startListening,
    stopListening,
    resetFinal,
    speak,
    stopSpeaking,
  };
}
