import { useCallback, useEffect, useRef, useState } from "react";
import { createAudioContext, preferPlaybackAudio, startClickLoop, type ClickLoop } from "../audio";
import { clampBpm } from "./schedule";

/** How often the flash checks the audio clock. The clicks don't depend on it. */
const TICK_MS = 25;
/** A change is put on the first beat at least this far ahead, so the audio engine gets it in time. */
const CHANGE_MARGIN_S = 0.03;

/** A looped bar playing (or booked to start). */
interface Run {
  loop: ClickLoop;
  /** Audio time it starts. */
  when: number;
  /** Audio time of its bar 0, so its beats are origin + k·beatS. */
  origin: number;
  beatS: number;
  beatsPerBar: number;
  /** Audio time it is set to stop, if any. */
  stopAt?: number;
}

function book(ctx: AudioContext, bpm: number, beatsPerBar: number, at: number, beatInBar: number): Run {
  const beatS = 60 / clampBpm(bpm);
  const offset = beatInBar * beatS;
  return { loop: startClickLoop(ctx, clampBpm(bpm), beatsPerBar, at, offset), when: at, origin: at - offset, beatS, beatsPerBar };
}

/** Stops a run at `at`, unless it is already set to stop sooner. */
function stopBy(r: Run, at: number) {
  const t = r.stopAt === undefined ? at : Math.min(r.stopAt, at);
  r.loop.stop(t);
  r.stopAt = t;
}

/**
 * A metronome on this phone. The clicks are one bar the audio engine loops by itself, so they keep perfect time
 * and keep going when the screen is off and the page's timers stop. A tempo change starts on the next beat, in
 * the same place in the bar; a beats-per-bar change starts a new, accented bar on the next beat. The visual beat
 * follows the audio clock.
 */
export function useMetronome(bpm: number, beatsPerBar: number) {
  const [running, setRunning] = useState(false);
  /** The beat being shown: position in the bar plus a counter that changes every beat (to restart the flash). */
  const [beat, setBeat] = useState<{ index: number; n: number } | null>(null);
  const [error, setError] = useState("");
  const ctxRef = useRef<AudioContext | null>(null);
  /** Loops booked, oldest first. */
  const runs = useRef<Run[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const shown = useRef({ key: "", count: 0 });
  const settings = useRef({ bpm, beatsPerBar });
  settings.current = { bpm, beatsPerBar };

  /** Moves to the current settings on the next beat. `newBar`: that beat starts a new bar. */
  const change = useCallback((newBar: boolean) => {
    const ctx = ctxRef.current;
    const last = runs.current[runs.current.length - 1];
    if (!ctx || !last) return;
    const t = ctx.currentTime + CHANGE_MARGIN_S;
    let at: number;
    let beatInBar: number;
    if (last.when > t) {
      // The last change hasn't started yet: replace it, from the same beat.
      at = last.when;
      beatInBar = Math.round((last.when - last.origin) / last.beatS) % last.beatsPerBar;
    } else {
      const k = Math.ceil((t - last.origin) / last.beatS - 1e-9);
      at = last.origin + k * last.beatS;
      beatInBar = k % last.beatsPerBar;
    }
    const { bpm: nextBpm, beatsPerBar: nextBeats } = settings.current;
    if (newBar || beatInBar >= nextBeats) beatInBar = 0;
    for (const r of runs.current) stopBy(r, at);
    runs.current.push(book(ctx, nextBpm, nextBeats, at, beatInBar));
  }, []);

  useEffect(() => {
    change(false);
  }, [bpm, change]);
  useEffect(() => {
    change(true);
  }, [beatsPerBar, change]);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    for (const r of runs.current) r.loop.stop();
    runs.current = [];
    ctxRef.current?.suspend().catch(() => {});
    setRunning(false);
    setBeat(null);
  }, []);

  useEffect(
    () => () => {
      stop();
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    },
    [stop],
  );

  function start() {
    if (timer.current) return;
    setError("");
    preferPlaybackAudio();
    // Made on the first tap: browsers only let a page start audio from a user gesture.
    const ctx = ctxRef.current ?? createAudioContext();
    if (!ctx) {
      setError("This browser can't play sound.");
      return;
    }
    ctxRef.current = ctx;
    ctx.resume().catch(() => {});
    runs.current = [book(ctx, settings.current.bpm, settings.current.beatsPerBar, ctx.currentTime + 0.05, 0)];
    const tick = () => {
      const now = ctx.currentTime;
      runs.current = runs.current.filter((r) => r.stopAt === undefined || r.stopAt > now);
      const playing = [...runs.current].reverse().find((r) => r.when <= now);
      if (!playing) return;
      const n = Math.floor((now - playing.origin) / playing.beatS);
      const key = `${playing.when}:${n}`;
      if (key === shown.current.key) return;
      shown.current = { key, count: shown.current.count + 1 };
      setBeat({ index: n % playing.beatsPerBar, n: shown.current.count });
    };
    tick();
    timer.current = setInterval(tick, TICK_MS);
    setRunning(true);
  }

  return { running, beat, error, start, stop };
}
