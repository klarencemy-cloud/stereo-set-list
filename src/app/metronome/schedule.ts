// Metronome timing maths. Pure: it only knows "what beat happens when" on whatever clock it is given (seconds),
// so the Web Audio clock drives it today and a shared band clock can drive it later.

export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const BEATS_PER_BAR = [2, 3, 4, 5, 6, 7] as const;

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return MIN_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

export interface Beat {
  /** When the click sounds, on the scheduler's clock (seconds). */
  time: number;
  /** Position in the bar, 0 = the first beat. */
  beat: number;
  accent: boolean;
}

/**
 * Hands out beats ahead of time for a look-ahead scheduler. Beat times are worked out from an anchor rather than
 * by adding intervals, so they don't drift. A tempo change takes effect from the next beat not yet handed out.
 */
export class BeatScheduler {
  private anchorTime: number;
  private anchorCount = 0;
  private count = 0;
  private barStart = 0;
  private interval: number;

  constructor(
    startTime: number,
    bpm: number,
    private beatsPerBar: number,
  ) {
    this.anchorTime = startTime;
    this.interval = 60 / clampBpm(bpm);
  }

  private nextTime(): number {
    return this.anchorTime + (this.count - this.anchorCount) * this.interval;
  }

  /** Every beat starting before `until` that hasn't been handed out yet. */
  due(until: number): Beat[] {
    const out: Beat[] = [];
    for (let t = this.nextTime(); t < until; t = this.nextTime()) {
      const beat = (this.count - this.barStart) % this.beatsPerBar;
      out.push({ time: t, beat, accent: beat === 0 });
      this.count++;
    }
    return out;
  }

  setBpm(bpm: number): void {
    this.anchorTime = this.nextTime();
    this.anchorCount = this.count;
    this.interval = 60 / clampBpm(bpm);
  }

  /** The next beat starts a new, accented bar. */
  setBeatsPerBar(beatsPerBar: number): void {
    this.beatsPerBar = beatsPerBar;
    this.barStart = this.count;
  }
}

/** Taps further apart than this start a new tap tempo. */
const TAP_RESET_MS = 2000;
/** How many of the latest taps to average. */
const TAP_WINDOW = 5;

/** The tempo from tap times (ms, oldest first), or null until there are two taps close enough together. */
export function bpmFromTaps(taps: number[]): number | null {
  let start = 0;
  for (let i = 1; i < taps.length; i++) if (taps[i] - taps[i - 1] > TAP_RESET_MS) start = i;
  const recent = taps.slice(start).slice(-TAP_WINDOW);
  if (recent.length < 2) return null;
  const avg = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
  return avg > 0 ? clampBpm(60000 / avg) : null;
}
