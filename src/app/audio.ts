import { renderBar } from "./metronome/loop";

// Small Web Audio helpers shared by the tuner and the metronome.

type AudioContextCtor = typeof AudioContext;

/** A new AudioContext, or null when the browser has none. Call it from a user tap so audio is allowed to start. */
export function createAudioContext(): AudioContext | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/**
 * On iPhone, Web Audio is muted by the silent switch unless the page says it plays media (Safari 16.4+).
 * Elsewhere this does nothing.
 */
export function preferPlaybackAudio(): void {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    // Older Safari: the switch may mute the clicks; the visual beat still works.
  }
}

/** On iPhone, the mic needs a play-and-record audio session (Safari 16.4+): call it before asking for the mic. Elsewhere this does nothing. */
export function preferRecordAudio(): void {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession) nav.audioSession.type = "play-and-record";
  } catch {
    // Older Safari: getUserMedia switches it anyway.
  }
}

/**
 * Books one metronome click at `time` on the context's clock. Returns a function that cancels it if it
 * hasn't sounded yet.
 */
export function click(ctx: AudioContext, time: number, accent: boolean): () => void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1600 : 1000;
  gain.gain.setValueAtTime(accent ? 1 : 0.6, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.06);
  return () => {
    try {
      gain.disconnect();
    } catch {
      // Already finished.
    }
  };
}

/**
 * The same moment on performance.now() (ms) and on the context's clock (s). Uses getOutputTimestamp() when the
 * browser has it, which allows for the delay before audio reaches the speaker.
 */
export function audioLink(ctx: AudioContext): { perfMs: number; audioS: number } {
  try {
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime && ts.performanceTime) return { perfMs: ts.performanceTime, audioS: ts.contextTime };
  } catch {
    // Not supported here: fall back to the two clocks read together.
  }
  return { perfMs: performance.now(), audioS: ctx.currentTime };
}

/** A bar of clicks the audio engine loops by itself: it keeps time with the screen off, when timers don't run. */
export interface ClickLoop {
  /** Audio time (s) at which this loop's bar 0 starts (or would have started), so its bar lines are origin + k·barS. */
  origin: number;
  barS: number;
  /** Stops it at `when` (audio s); before it has started, it never plays. Calling again moves the stop time. */
  stop(when?: number): void;
}

const barBuffers = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

function barBuffer(ctx: AudioContext, bpm: number, beatsPerBar: number): AudioBuffer {
  let cache = barBuffers.get(ctx);
  if (!cache) barBuffers.set(ctx, (cache = new Map()));
  const key = `${bpm}/${beatsPerBar}`;
  let buffer = cache.get(key);
  if (!buffer) {
    const data = renderBar(ctx.sampleRate, bpm, beatsPerBar);
    buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.getChannelData(0).set(data);
    cache.set(key, buffer);
  }
  return buffer;
}

/** Starts a looped bar at `when` (audio s), `offset` seconds into the bar. */
export function startClickLoop(ctx: AudioContext, bpm: number, beatsPerBar: number, when: number, offset: number): ClickLoop {
  const barS = (beatsPerBar * 60) / bpm;
  const src = ctx.createBufferSource();
  src.buffer = barBuffer(ctx, bpm, beatsPerBar);
  src.loop = true;
  src.loopStart = 0;
  // Exactly one bar (sub-sample), so the loop never drifts from the tempo.
  src.loopEnd = barS;
  src.connect(ctx.destination);
  src.start(when, offset);
  return {
    origin: when - offset,
    barS,
    stop(at = 0) {
      try {
        src.stop(at);
      } catch {
        // Already stopped.
      }
    },
  };
}
