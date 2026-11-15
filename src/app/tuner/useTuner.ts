import { useCallback, useEffect, useRef, useState } from "react";
import { createAudioContext } from "../audio";
import { analysisSize, detectPitch } from "./pitch";
import { createSmoother } from "./smooth";

/** How often the microphone is read. */
export const READ_MS = 50;
/** Keep showing the last note this long after the sound stops, so the display doesn't flicker. */
const HOLD_MS = 1000;

export function micErrorMessage(e: unknown): string {
  const name = e instanceof Error || (typeof e === "object" && e !== null) ? (e as { name?: string }).name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow the microphone for this site in your browser settings, then tap Start again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found on this device.";
  if (name === "NotReadableError") return "The microphone is busy in another app. Close it and tap Start again.";
  return "Could not start the microphone.";
}

interface Running {
  stream: MediaStream;
  ctx: AudioContext;
  timer: ReturnType<typeof setInterval>;
}

/** Listens to the microphone after `start` (a user tap) and reports the pitch heard, in Hz. */
export function useTuner() {
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  /** The steady pitch heard (Hz, or null) and when it was read (ms). Each reading is a new object, so a pitch
   * that holds exactly still still re-renders: the in-tune hold counts time between readings. */
  const [reading, setReading] = useState<{ freq: number | null; at: number }>({ freq: null, at: 0 });
  const [error, setError] = useState("");
  const running = useRef<Running | null>(null);
  const alive = useRef(true);

  const stop = useCallback(() => {
    const r = running.current;
    running.current = null;
    if (r) {
      clearInterval(r.timer);
      r.stream.getTracks().forEach((t) => t.stop());
      r.ctx.close().catch(() => {});
    }
    if (alive.current) {
      setListening(false);
      setReading({ freq: null, at: Date.now() });
    }
  }, []);

  // Leaving the page turns the microphone off.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop();
    };
  }, [stop]);

  async function start() {
    if (running.current || starting) return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't use the microphone here. Open the site over https in Chrome or Safari.");
      return;
    }
    setStarting(true);
    let stream: MediaStream;
    try {
      // Voice processing smears pitch: turn it all off.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      setStarting(false);
      setError(micErrorMessage(e));
      return;
    }
    const ctx = createAudioContext();
    if (!alive.current || !ctx) {
      stream.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
      setStarting(false);
      if (!ctx) setError("This browser can't analyse sound.");
      return;
    }
    ctx.resume().catch(() => {});
    const analyser = ctx.createAnalyser();
    analyser.fftSize = analysisSize(ctx.sampleRate);
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const smoother = createSmoother();
    let lastHeard = 0;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      const f = detectPitch(buf, ctx.sampleRate);
      const now = Date.now();
      const steady = smoother.push(f, now);
      if (f !== null) lastHeard = now;
      if (steady !== null) {
        setReading({ freq: steady, at: now });
      } else if (now - lastHeard > HOLD_MS) {
        // Silent for a while: forget the note. (A short gap, or a note's skipped attack, keeps the last one shown.)
        smoother.reset();
        setReading((r) => (r.freq === null ? r : { freq: null, at: now }));
      }
    }, READ_MS);
    running.current = { stream, ctx, timer };
    setStarting(false);
    setListening(true);
  }

  return { listening, starting, freq: reading.freq, at: reading.at, error, start, stop };
}
