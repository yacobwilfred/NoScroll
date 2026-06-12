import { useEffect, useRef, useState, useCallback } from "react";

// ── Eye landmark indices (MediaPipe Face Landmarker, 478-point model) ────────
// Each set: [outer corner, upper-outer, upper-inner, inner corner, lower-inner, lower-outer]
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
const LEFT_EYE  = [263, 385, 387, 362, 373, 380];

const EAR_THRESHOLD    = 0.20;
const PROCESS_INTERVAL = 100;    // ~10fps
const PERCLOS_WINDOW   = 60_000;
const BLINK_WINDOW     = 60_000;
const FACE_GRACE_MS    = 4_000;  // sustained absence before reporting "no face"

// ── drawing helpers ───────────────────────────────────────────────────────────

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function computeEAR(landmarks, indices) {
  const [i1, i2, i3, i4, i5, i6] = indices;
  const v1 = dist(landmarks[i2], landmarks[i6]);
  const v2 = dist(landmarks[i3], landmarks[i5]);
  const h  = dist(landmarks[i1], landmarks[i4]);
  return h > 0 ? (v1 + v2) / (2 * h) : 0.3;
}

function drawEyeOverlay(ctx, landmarks, indices, canvasW, canvasH, ear) {
  const isOpen = ear >= EAR_THRESHOLD;
  const stroke = isOpen ? "rgba(87, 201, 138, 0.92)" : "rgba(232, 118, 118, 0.92)";

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.fillStyle   = stroke;
  ctx.lineWidth   = 1.5;

  // Outline polygon (mirrored x)
  ctx.beginPath();
  indices.forEach((idx, i) => {
    const lm = landmarks[idx];
    const x  = (1 - lm.x) * canvasW;
    const y  = lm.y * canvasH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();

  // Landmark dots
  indices.forEach(idx => {
    const lm = landmarks[idx];
    ctx.beginPath();
    ctx.arc((1 - lm.x) * canvasW, lm.y * canvasH, 2, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawPreviewFrame(canvas, video, landmarks, rightEAR, leftEAR) {
  if (!canvas || !video) return;
  const ctx = canvas.getContext("2d");
  const w   = canvas.width;
  const h   = canvas.height;

  // Mirrored video frame
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -w, 0, w, h);
  ctx.restore();

  if (!landmarks) return;
  drawEyeOverlay(ctx, landmarks, RIGHT_EYE, w, h, rightEAR);
  drawEyeOverlay(ctx, landmarks, LEFT_EYE,  w, h, leftEAR);
}

// ── component ─────────────────────────────────────────────────────────────────

/**
 * Background face tracking component — renders only a hidden video element.
 * Emits analytics via onUpdate; draws annotated preview to canvasRef when mounted.
 */
export default function FacialTracker({ enabled, onUpdate, onStatusChange, canvasRef }) {
  const videoRef        = useRef(null);
  const landmarkerRef   = useRef(null);
  const streamRef       = useRef(null);
  const rafRef          = useRef(null);
  const lastProcessRef  = useRef(0);
  const frameHistoryRef = useRef([]);
  const blinkHistoryRef = useRef([]);
  const eyeWasClosedRef = useRef(false);
  const lastLmRef       = useRef(null); // last detected landmarks + EARs (for smooth overlay)
  const lastFaceTimeRef = useRef(0);    // last time a face was seen
  const absentRef       = useRef(false); // whether we've already reported absence

  const [status, setStatus] = useState("idle");

  // Keep callbacks in refs so the camera-init effect can depend only on
  // `enabled` — otherwise new callback identities on every render would tear
  // down and restart getUserMedia in a loop (camera never settles to running).
  const onUpdateRef       = useRef(onUpdate);
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);
  useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);

  // Notify parent when status changes
  useEffect(() => { onStatusChangeRef.current?.(status); }, [status]);

  const processFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const landmarker = landmarkerRef.current;
    const now        = Date.now();

    // Run landmark detection on a throttle (only once the model has loaded).
    if (landmarker && now - lastProcessRef.current >= PROCESS_INTERVAL) {
      lastProcessRef.current = now;
      try {
        const result    = landmarker.detectForVideo(video, now);
        const landmarks = result?.faceLandmarks?.[0] ?? null;

        if (landmarks) {
          const rightEAR = computeEAR(landmarks, RIGHT_EYE);
          const leftEAR  = computeEAR(landmarks, LEFT_EYE);
          const avgEAR   = (rightEAR + leftEAR) / 2;
          lastLmRef.current = { landmarks, rightEAR, leftEAR };

          const isClosed = avgEAR < EAR_THRESHOLD;

          // PERCLOS
          frameHistoryRef.current.push({ timestamp: now, isClosed });
          frameHistoryRef.current = frameHistoryRef.current.filter(
            f => now - f.timestamp < PERCLOS_WINDOW
          );
          const frames  = frameHistoryRef.current;
          const perclos = frames.length > 0
            ? frames.filter(f => f.isClosed).length / frames.length
            : 0;

          // Blink detection
          if (!eyeWasClosedRef.current && isClosed)       eyeWasClosedRef.current = true;
          else if (eyeWasClosedRef.current && !isClosed) {
            blinkHistoryRef.current.push(now);
            eyeWasClosedRef.current = false;
          }
          blinkHistoryRef.current = blinkHistoryRef.current.filter(
            t => now - t < BLINK_WINDOW
          );
          const blinkRate = blinkHistoryRef.current.length;

          lastFaceTimeRef.current = now;
          absentRef.current = false;
          onUpdateRef.current?.({ perclos, blinkRate, ear: avgEAR, faceDetected: true });
        } else {
          lastLmRef.current = null;
          // Report sustained absence once (engagement → none → drain pauses).
          if (!absentRef.current && now - lastFaceTimeRef.current > FACE_GRACE_MS) {
            absentRef.current = true;
            onUpdateRef.current?.({ perclos: 0, blinkRate: 0, ear: 0.3, faceDetected: false });
          }
        }
      } catch {
        // skip bad frames — drawing below still runs
      }
    }

    // Always draw the (mirrored) camera frame so the preview shows even before
    // the landmark model has loaded, or if detection fails this frame.
    try {
      const lm = lastLmRef.current;
      drawPreviewFrame(
        canvasRef?.current,
        video,
        lm?.landmarks ?? null,
        lm?.rightEAR ?? 0.3,
        lm?.leftEAR ?? 0.3,
      );
    } catch {
      // ignore draw errors (e.g. canvas not mounted yet)
    }

    rafRef.current = requestAnimationFrame(processFrame);
  }, [canvasRef]); // canvasRef is a stable ref object; callbacks read via refs

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function init() {
      setStatus("loading");

      // 1. Start the camera first — most reliable + most important to show.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: "user" },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        lastFaceTimeRef.current = Date.now(); // grace period from camera start
        absentRef.current = false;
        setStatus("running");
        rafRef.current = requestAnimationFrame(processFrame);
      } catch (err) {
        if (!cancelled)
          setStatus(err?.name === "NotAllowedError" ? "denied" : "error");
        return;
      }

      // 2. Load the landmark model in the background. The camera keeps showing
      //    regardless; eye analysis overlays once this resolves.
      try {
        const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        if (cancelled) return;
        const resolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        let landmarker = null;
        for (const delegate of ["GPU", "CPU"]) {
          try {
            landmarker = await FaceLandmarker.createFromOptions(resolver, {
              baseOptions: {
                modelAssetPath:
                  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate,
              },
              runningMode: "VIDEO",
              numFaces: 1,
            });
            break;
          } catch {
            // try the next delegate (some machines lack a working GPU path)
          }
        }
        if (!cancelled && landmarker) landmarkerRef.current = landmarker;
      } catch {
        // analysis unavailable — camera preview still works
      }
    }

    init();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      landmarkerRef.current?.close?.();
      landmarkerRef.current = null;
      lastLmRef.current = null;
    };
  }, [enabled, processFrame]);

  // Only renders the hidden video feed — visual elements are in CognitiveMeter
  return (
    <video
      ref={videoRef}
      className="facial-tracker-video"
      playsInline
      muted
      aria-hidden="true"
    />
  );
}
