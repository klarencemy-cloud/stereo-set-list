import { useCallback, useEffect, useRef, useState } from "react";
import { createAudioContext, preferPlaybackAudio } from "../audio";
import { BeatScheduler } from "./schedule";

/** How often the scheduler wakes up. */
const TICK_MS = 25;
/** How far ahead clicks are booked on the audio clock. Covers a late timer without the clicks drifting. */
const LOOK_AHEAD_S = 0.12;

function click(ctx: AudioContext, time: number, accent: boolean) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1600 : 1000;
  gain.gain.setValueAtTime(accent ? 1 : 0.6, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.06);
}

/**
 * A look-ahead metronome: a short timer books clicks a little ahead on AudioContext.currentTime, so the clicks
 * keep perfect time even when the timer itself is late. The visual beat follows the same booked times.
 */
export function useMetronome(bpm: number, beatsPerBar: number) {
  const [running, setRunning] = useState(false);
  /** The beat being shown: position in the bar plus a counter that changes every beat (to restart the flash). */
  const [beat, setBeat] = useState<{ index: number; n: number } | null>(null);
  const [error, setError] = useState("");
  const ctxRef = useRef<AudioContext | null>(null);
  const scheduler = useRef<BeatScheduler | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashes = useRef<ReturnType<typeof setTimeout>[]>([]);
  const settings = useRef({ bpm, beatsPerBar });
  settings.current = { bpm, beatsPerBar };

  useEffect(() => {
    scheduler.current?.setBpm(bpm);
  }, [bpm]);
  useEffect(() => {
    scheduler.current?.setBeatsPerBar(beatsPerBar);
  }, [beatsPerBar]);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    flashes.current.forEach(clearTimeout);
    flashes.current = [];
    scheduler.current = null;
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
    const s = new BeatScheduler(ctx.currentTime + 0.05, settings.current.bpm, settings.current.beatsPerBar);
    scheduler.current = s;
    let n = 0;
    const tick = () => {
      for (const b of s.due(ctx.currentTime + LOOK_AHEAD_S)) {
        click(ctx, b.time, b.accent);
        const count = n++;
        const delay = Math.max(0, (b.time - ctx.currentTime) * 1000);
        const id = setTimeout(() => {
          flashes.current = flashes.current.filter((x) => x !== id);
          setBeat({ index: b.beat, n: count });
        }, delay);
        flashes.current.push(id);
      }
    };
    tick();
    timer.current = setInterval(tick, TICK_MS);
    setRunning(true);
  }

  return { running, beat, error, start, stop };
}
