// A metronome that keeps going with the screen off: one bar of clicks is rendered into a buffer and the audio
// engine loops it on its own. Phones pause a page's timers when the screen is off, but keep playing audio that
// is already running, so nothing here may depend on a timer firing on time. Pure: no browser APIs.

const CLICK_S = 0.05;
/** The click's decay: from full to 1/1000 over CLICK_S, like v1's exponential ramp. */
const DECAY = Math.log(1000) / CLICK_S;

/** One bar of clicks as samples: a higher, louder click on beat 1, then the other beats. Exactly one bar long. */
export function renderBar(sampleRate: number, bpm: number, beatsPerBar: number): Float32Array {
  const beatS = 60 / bpm;
  // Rounded up, so the loop point (exactly one bar, set on the player) always falls inside the buffer.
  const out = new Float32Array(Math.ceil(beatsPerBar * beatS * sampleRate - 1e-6));
  const clickLen = Math.round(CLICK_S * sampleRate);
  for (let beat = 0; beat < beatsPerBar; beat++) {
    const accent = beat === 0;
    const freq = accent ? 1600 : 1000;
    const amp = accent ? 1 : 0.6;
    const onset = Math.round(beat * beatS * sampleRate);
    for (let j = 0; j < clickLen && onset + j < out.length; j++) {
      const t = j / sampleRate;
      out[onset + j] = amp * Math.exp(-DECAY * t) * Math.sin(2 * Math.PI * freq * t);
    }
  }
  return out;
}

/**
 * When to start the looped bar so it lines up with a grid whose bar 0 starts at `gridStartS` (all on the audio
 * clock), starting no earlier than `earliestS`: at the grid's start if that is still ahead, else straight away,
 * part-way into the bar.
 */
export function loopStart(gridStartS: number, barS: number, earliestS: number): { when: number; offset: number } {
  if (earliestS <= gridStartS) return { when: gridStartS, offset: 0 };
  const into = (earliestS - gridStartS) % barS;
  return { when: earliestS, offset: into < 1e-9 || barS - into < 1e-9 ? 0 : into };
}

/** How many ticks in a row the drift check looks at, and how big the median phase error must be to re-align. */
export const REALIGN_TICKS = 8;
export const REALIGN_S = 0.012;

/**
 * Whether a playing loop should be re-aligned, from its phase errors on the last REALIGN_TICKS ticks (s): only
 * when their median is over REALIGN_S, so a few jittery readings never move it.
 */
export function shouldRealign(errorsS: number[]): boolean {
  if (errorsS.length < REALIGN_TICKS) return false;
  const last = errorsS.slice(-REALIGN_TICKS).sort((a, b) => a - b);
  const mid = REALIGN_TICKS / 2;
  return Math.abs((last[mid - 1] + last[mid]) / 2) > REALIGN_S;
}

/**
 * How far a playing loop is from where it should be (seconds, + = the loop is late), given where bar lines are
 * expected and where the loop's bar lines actually fall. Within half a bar either way.
 */
export function phaseError(expectedBarLineS: number, actualBarLineS: number, barS: number): number {
  let d = (actualBarLineS - expectedBarLineS) % barS;
  if (d > barS / 2) d -= barS;
  if (d <= -barS / 2) d += barS;
  return d;
}
