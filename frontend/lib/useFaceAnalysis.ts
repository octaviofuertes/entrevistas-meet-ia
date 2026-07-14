'use client';

import { useEffect, useRef, useState } from 'react';

// ─── Public interface ────────────────────────────────────────────────────────

export interface FaceMetrics {
  ready: boolean;
  faceDetected: boolean;
  // Head pose in actual degrees (from MediaPipe 4×4 transformation matrix)
  headPitch: number;      // + = looking up,   − = looking down
  headYaw:   number;      // + = turned right, − = turned left
  // Eye gaze (MediaPipe blendshape scores, 0–1 each)
  gazeDown:  number;      // iris looking down
  gazeUp:    number;      // iris looking up
  gazeLeft:  number;      // iris looking left
  gazeRight: number;      // iris looking right
  // Eye state
  eyeOpenness: number;    // 1 = fully open, 0 = closed
  blinking:    boolean;
  // Expression (from blendshapes)
  expression:      string | null;
  expressionLabel: string;
  // Composite attention (temporally smoothed)
  attention:       'attentive' | 'reading' | 'distracted' | 'absent' | 'sleepy';
  isLikelyReading: boolean;
  presenceRatio:   number;
  error:           string | null;
}

// ─── MediaPipe constants ─────────────────────────────────────────────────────

// All three URLs come from CDN so webpack never has to bundle the wasm/esm.
// The /* webpackIgnore: true */ comment on the import() call tells Next.js to leave
// the dynamic import as-is and let the browser resolve it natively.
const VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM_CDN   = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_CDN  = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// History sizes
const PRES_LEN = 12;   // presence window (~800ms at 60fps)
const ATTN_LEN = 8;    // attention smoothing window

// ─── Singleton landmarker (shared across hook instances) ─────────────────────

let _landmarker: any     = null;
let _loadPromise: Promise<any> | null = null;

async function getLandmarker(): Promise<any> {
  if (_landmarker)    return _landmarker;
  if (_loadPromise)   return _loadPromise;
  _loadPromise = (async () => {
    // webpackIgnore: Next.js won't try to bundle this URL — the browser loads
    // the ES module from CDN natively, avoiding the vision_bundle.mjs ENOENT.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — dynamic CDN URL, no local type resolution
    const { FaceLandmarker, FilesetResolver } = await import(
      /* webpackIgnore: true */ VISION_CDN
    );
    const fs = await FilesetResolver.forVisionTasks(WASM_CDN);
    _landmarker = await FaceLandmarker.createFromOptions(fs, {
      baseOptions: {
        modelAssetPath: MODEL_CDN,
        delegate: 'GPU',     // auto-falls back to CPU if WebGL unavailable
      },
      outputFaceBlendshapes:             true,
      outputFacialTransformationMatrixes: true,
      runningMode: 'VIDEO',
      numFaces: 1,
    });
    return _landmarker;
  })();
  return _loadPromise;
}

// ─── Math helpers ────────────────────────────────────────────────────────────

/**
 * Extract pitch and yaw (in degrees) from MediaPipe's 4×4 row-major
 * facial transformation matrix.  The matrix maps face-model space → camera
 * space, so we read the forward-vector column for yaw and the up-vector for
 * pitch using the standard ZYX Euler decomposition.
 */
function matrixToEuler(d: Float32Array | number[]): { pitch: number; yaw: number } {
  // Row-major indexing: element at row r, col c → d[r*4 + c]
  const r21 = d[9];
  const r22 = d[10];
  const r20 = d[8];
  const pitch = Math.atan2(r21, r22)  * (180 / Math.PI);
  const yaw   = Math.atan2(-r20, Math.sqrt(r21 * r21 + r22 * r22)) * (180 / Math.PI);
  return { pitch, yaw };
}

/** Look up a blendshape score by category name. */
function bs(categories: any[], name: string): number {
  return categories.find((c: any) => c.categoryName === name)?.score ?? 0;
}

// ─── Expression classification ───────────────────────────────────────────────

type ExprResult = { name: string; label: string };

function classifyExpression(cats: any[]): ExprResult {
  const smileL = bs(cats, 'mouthSmileLeft');
  const smileR = bs(cats, 'mouthSmileRight');
  const browUp = bs(cats, 'browInnerUp');
  const jawOpn = bs(cats, 'jawOpen');
  const browDL = bs(cats, 'browDownLeft');
  const browDR = bs(cats, 'browDownRight');
  const cheekS = bs(cats, 'cheekSquintLeft') + bs(cats, 'cheekSquintRight');

  const smile     = (smileL + smileR) / 2;
  const surprised = (browUp * 0.6 + jawOpn * 0.4);
  const tense     = (browDL + browDR) / 2;
  const focused   = Math.min(1, cheekS * 0.6 + tense * 0.3);

  if (smile > 0.32)         return { name: 'happy',     label: 'Sonriendo' };
  if (surprised > 0.35)     return { name: 'surprised', label: 'Sorprendido' };
  if (focused  > 0.28)      return { name: 'focused',   label: 'Concentrado' };
  if (tense    > 0.22)      return { name: 'tense',     label: 'Tenso' };
  return                           { name: 'neutral',   label: 'Neutral' };
}

// ─── Default state ────────────────────────────────────────────────────────────

const DEFAULTS: FaceMetrics = {
  ready: false, faceDetected: false,
  headPitch: 0, headYaw: 0,
  gazeDown: 0, gazeUp: 0, gazeLeft: 0, gazeRight: 0,
  eyeOpenness: 1, blinking: false,
  expression: null, expressionLabel: '—',
  attention: 'attentive', isLikelyReading: false, presenceRatio: 1,
  error: null,
};

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useFaceAnalysis(
  videoRef: React.RefObject<HTMLVideoElement>,
  enabled: boolean,
): FaceMetrics {
  const [metrics, setMetrics] = useState<FaceMetrics>(DEFAULTS);

  const rafRef    = useRef(0);
  const presHist  = useRef<boolean[]>([]);
  const attnHist  = useRef<string[]>([]);
  const lastTs    = useRef(-1);
  const lastSetTs = useRef(0);   // throttle React re-renders to ~15 fps

  useEffect(() => {
    if (!enabled) {
      setMetrics(DEFAULTS);
      return;
    }
    let alive = true;

    getLandmarker()
      .then((fl) => {
        if (!alive) return;
        setMetrics((m) => ({ ...m, ready: true, error: null }));

        const loop = () => {
          if (!alive) return;
          rafRef.current = requestAnimationFrame(loop);

          const video = videoRef.current;
          if (!video || video.readyState < 2 || video.paused || video.ended) return;

          const now = performance.now();
          if (now <= lastTs.current) return;   // MediaPipe requires monotonically increasing timestamps
          lastTs.current = now;

          try {
            const res = fl.detectForVideo(video, now);
            const pH  = presHist.current;

            // ── No face detected ────────────────────────────────────────────
            if (!res.faceLandmarks?.length) {
              pH.push(false);
              if (pH.length > PRES_LEN) pH.shift();
              const pres = pH.filter(Boolean).length / Math.max(pH.length, 1);

              if (now - lastSetTs.current > 150) {
                lastSetTs.current = now;
                setMetrics((m) => ({
                  ...m,
                  faceDetected: false,
                  presenceRatio: Math.round(pres * 100) / 100,
                  attention: pres < 0.35 ? 'absent' : m.attention,
                }));
              }
              return;
            }

            // ── Face detected ───────────────────────────────────────────────
            pH.push(true);
            if (pH.length > PRES_LEN) pH.shift();
            const pres = pH.filter(Boolean).length / Math.max(pH.length, 1);

            // Head pose from 4×4 transformation matrix
            let pitch = 0, yaw = 0;
            const mtx = res.facialTransformationMatrixes?.[0]?.data;
            if (mtx) ({ pitch, yaw } = matrixToEuler(mtx));

            // Blendshapes — iris gaze + eye openness
            const cats = res.faceBlendshapes?.[0]?.categories ?? [];

            const blinkL  = bs(cats, 'eyeBlinkLeft');
            const blinkR  = bs(cats, 'eyeBlinkRight');
            const dnL     = bs(cats, 'eyeLookDownLeft');
            const dnR     = bs(cats, 'eyeLookDownRight');
            const upL     = bs(cats, 'eyeLookUpLeft');
            const upR     = bs(cats, 'eyeLookUpRight');
            // Lateral: left eye outward = looking left; right eye outward = looking right
            const outL    = bs(cats, 'eyeLookOutLeft');
            const inR     = bs(cats, 'eyeLookInRight');
            const inL     = bs(cats, 'eyeLookInLeft');
            const outR    = bs(cats, 'eyeLookOutRight');

            const gazeDown    = (dnL + dnR) / 2;
            const gazeUp      = (upL + upR) / 2;
            const gazeLeft    = (outL + inR) / 2;   // both irises shift left
            const gazeRight   = (inL + outR) / 2;   // both irises shift right
            const eyeOpenness = 1 - (blinkL + blinkR) / 2;
            const blinking    = blinkL > 0.65 && blinkR > 0.65;

            // Expression
            const expr = classifyExpression(cats);

            // ── Attention classification (raw frame) ───────────────────────
            let raw: FaceMetrics['attention'] = 'attentive';

            if (pres < 0.35) {
              raw = 'absent';
            } else if (eyeOpenness < 0.28 && pres > 0.6) {
              // Eyes nearly closed with face reliably detected → drowsy
              raw = 'sleepy';
            } else if (pitch < -9 && gazeDown > 0.20) {
              // Head pitched down AND iris looking down → reading
              raw = 'reading';
            } else if (gazeDown > 0.45) {
              // Iris strongly down even without head tilt → reading notes below camera
              raw = 'reading';
            } else if (Math.abs(yaw) > 22 || gazeLeft > 0.42 || gazeRight > 0.42) {
              // Head turned or iris looking sideways → distracted
              raw = 'distracted';
            }

            // Smooth with majority vote over ATTN_LEN frames
            const aH = attnHist.current;
            aH.push(raw);
            if (aH.length > ATTN_LEN) aH.shift();
            const counts = aH.reduce(
              (acc, v) => { acc[v] = (acc[v] ?? 0) + 1; return acc; },
              {} as Record<string, number>,
            );
            const attn = Object.entries(counts)
              .sort((a, b) => b[1] - a[1])[0][0] as FaceMetrics['attention'];

            // Throttle React state updates to ~15 fps to avoid thrashing renders
            if (now - lastSetTs.current < 66) return;
            lastSetTs.current = now;

            setMetrics({
              ready: true,
              faceDetected: true,
              headPitch: Math.round(pitch * 10) / 10,
              headYaw:   Math.round(yaw   * 10) / 10,
              gazeDown:  Math.round(gazeDown  * 100) / 100,
              gazeUp:    Math.round(gazeUp    * 100) / 100,
              gazeLeft:  Math.round(gazeLeft  * 100) / 100,
              gazeRight: Math.round(gazeRight * 100) / 100,
              eyeOpenness: Math.round(eyeOpenness * 100) / 100,
              blinking,
              expression:      expr.name,
              expressionLabel: expr.label,
              attention:       attn,
              isLikelyReading: attn === 'reading',
              presenceRatio:   Math.round(pres * 100) / 100,
              error: null,
            });
          } catch {
            // Silently skip single-frame errors (video seek, resize, etc.)
          }
        };

        rafRef.current = requestAnimationFrame(loop);
      })
      .catch((err) => {
        if (alive) {
          setMetrics((m) => ({ ...m, ready: false, error: err?.message ?? 'MediaPipe error' }));
        }
      });

    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [videoRef, enabled]);

  return metrics;
}
