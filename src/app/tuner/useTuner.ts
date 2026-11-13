import { useCallback, useEffect, useRef, useState } from "react";
import { createAudioContext } from "../audio";
import { analysisSize, detectPitch } from "./pitch";

/** How often the microphone is read. */
const READ_MS = 100;
/** Keep showing the last note this long after the sound stops, so the display doesn't flicker. */
const HOLD_MS = 1000;
/** Readings smoothed over (median), which drops one-off octave jumps. */
const SMOOTH = 3;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

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
  const [freq, setFreq] = useState<number | null>(null);
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
      setFreq(null);
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
    const recent: number[] = [];
    let lastHeard = 0;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      const f = detectPitch(buf, ctx.sampleRate);
      const now = Date.now();
      if (f !== null) {
        recent.push(f);
        if (recent.length > SMOOTH) recent.shift();
        lastHeard = now;
        setFreq(median(recent));
      } else if (now - lastHeard > HOLD_MS) {
        recent.length = 0;
        setFreq(null);
      }
    }, READ_MS);
    running.current = { stream, ctx, timer };
    setStarting(false);
    setListening(true);
  }

  return { listening, starting, freq, error, start, stop };
}
