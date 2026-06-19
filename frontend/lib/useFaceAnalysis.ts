'use client';

import { useEffect, useRef, useState } from 'react';

export interface FaceMetrics {
  ready: boolean;
  faceDetected: boolean;
  expression: 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'fearful' | 'disgusted' | null;
  expressionLabel: string;
  /** Aproximación de yaw/pitch desde landmarks. */
  headPitch: number; // negativo = mira hacia abajo
  headYaw: number; // negativo = mira a la izquierda
  /** Heurística "está leyendo": mirada hacia abajo prolongada o cara descentrada. */
  isLikelyReading: boolean;
  /** Presencia: fracción de los últimos N frames con cara detectada. */
  presenceRatio: number;
  /** Estado agregado. */
  attention: 'attentive' | 'reading' | 'absent' | 'distracted';
  /** Errores de carga del modelo. */
  error: string | null;
}

const MODELS_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';
const SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.js';
const SAMPLING_MS = 700;
const HISTORY_LEN = 8;

declare global {
  interface Window {
    faceapi?: any;
  }
}

let loadingPromise: Promise<any> | null = null;

function loadFaceApi(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  if (window.faceapi) return Promise.resolve(window.faceapi);
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    // Por si otro hook ya inyectó el script.
    const existing = document.querySelector(`script[src="${SCRIPT_URL}"]`);
    if (existing) {
      if (window.faceapi) return resolve(window.faceapi);
      existing.addEventListener('load', () => resolve(window.faceapi));
      existing.addEventListener('error', () => reject(new Error('face-api script error')));
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.faceapi);
    s.onerror = () => reject(new Error('No se pudo cargar face-api.js'));
    document.head.appendChild(s);
  });
  return loadingPromise;
}

let modelsLoaded = false;
async function ensureModels(faceapi: any): Promise<void> {
  if (modelsLoaded) return;
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL);
  await faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL);
  await faceapi.nets.faceExpressionNet.loadFromUri(MODELS_URL);
  modelsLoaded = true;
}

const EXPR_LABELS: Record<string, string> = {
  neutral: 'Neutral',
  happy: 'Sonriendo',
  sad: 'Triste',
  angry: 'Enojado',
  surprised: 'Sorprendido',
  fearful: 'Tenso',
  disgusted: 'Disgustado',
};

export function useFaceAnalysis(
  videoRef: React.RefObject<HTMLVideoElement>,
  enabled: boolean
): FaceMetrics {
  const [metrics, setMetrics] = useState<FaceMetrics>({
    ready: false,
    faceDetected: false,
    expression: null,
    expressionLabel: '—',
    headPitch: 0,
    headYaw: 0,
    isLikelyReading: false,
    presenceRatio: 1,
    attention: 'attentive',
    error: null,
  });

  const historyRef = useRef<{ detected: boolean; pitch: number; yaw: number }[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    let faceapi: any = null;

    (async () => {
      try {
        faceapi = await loadFaceApi();
        await ensureModels(faceapi);
        if (!alive) return;
        setMetrics((m) => ({ ...m, ready: true, error: null }));

        const detectorOpts = new faceapi.TinyFaceDetectorOptions({
          inputSize: 224,
          scoreThreshold: 0.5,
        });

        interval = setInterval(async () => {
          const video = videoRef.current;
          if (!alive || !video || video.readyState < 2 || video.paused || video.ended) return;
          try {
            const detection = await faceapi
              .detectSingleFace(video, detectorOpts)
              .withFaceLandmarks()
              .withFaceExpressions();

            let pitch = 0;
            let yaw = 0;
            let detected = false;
            let expression: FaceMetrics['expression'] = null;

            if (detection) {
              detected = true;
              const landmarks = detection.landmarks;
              const positions = landmarks.positions as Array<{ x: number; y: number }>;
              // Heurística simple: pitch ~ relación ojos-nariz en eje Y;
              // yaw ~ asimetría horizontal de los ojos respecto a la nariz.
              const leftEye = avgPoint(positions.slice(36, 42));
              const rightEye = avgPoint(positions.slice(42, 48));
              const nose = positions[30];
              const chin = positions[8];
              const eyeMid = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
              const eyeChinDist = chin.y - eyeMid.y;
              // pitch normalizado: si la nariz queda muy abajo respecto al eje ojos→mentón, mira abajo.
              pitch = eyeChinDist > 0 ? -(nose.y - eyeMid.y) / eyeChinDist + 0.5 : 0;
              // yaw: distancia horizontal de la nariz a la mitad de los ojos.
              const eyeDist = Math.max(1, rightEye.x - leftEye.x);
              yaw = (nose.x - eyeMid.x) / eyeDist;

              const exps = detection.expressions as Record<string, number>;
              expression = (Object.entries(exps).sort(
                (a, b) => b[1] - a[1]
              )[0]?.[0] ?? 'neutral') as FaceMetrics['expression'];
            }

            const h = historyRef.current;
            h.push({ detected, pitch, yaw });
            if (h.length > HISTORY_LEN) h.shift();

            const presence = h.filter((x) => x.detected).length / Math.max(1, h.length);
            const lookingDownStreak = h.slice(-4).every((x) => x.detected && x.pitch < -0.2);
            const lookingAwayStreak = h.slice(-4).every((x) => x.detected && Math.abs(x.yaw) > 0.35);
            const isLikelyReading = lookingDownStreak;

            let attention: FaceMetrics['attention'] = 'attentive';
            if (presence < 0.3) attention = 'absent';
            else if (isLikelyReading) attention = 'reading';
            else if (lookingAwayStreak) attention = 'distracted';

            if (alive) {
              setMetrics({
                ready: true,
                faceDetected: detected,
                expression,
                expressionLabel: expression ? EXPR_LABELS[expression] ?? expression : '—',
                headPitch: round2(pitch),
                headYaw: round2(yaw),
                isLikelyReading,
                presenceRatio: round2(presence),
                attention,
                error: null,
              });
            }
          } catch {
            // ignorar errores ocasionales del detector
          }
        }, SAMPLING_MS);
      } catch (err: any) {
        if (alive)
          setMetrics((m) => ({ ...m, error: err?.message ?? 'face-api error' }));
      }
    })();

    return () => {
      alive = false;
      if (interval) clearInterval(interval);
    };
  }, [videoRef, enabled]);

  return metrics;
}

function avgPoint(pts: Array<{ x: number; y: number }>) {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
