// Shared metronome maths, used by the client and the server. Pure: times are plain milliseconds on whatever
// clock the caller uses (the server's clock for a synced session).

export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const BEATS_PER_BAR = [2, 3, 4, 5, 6, 7] as const;

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return MIN_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

/** A song's shared metronome. Beat n is at startAt + n * 60000 / bpm on the server's clock. */
export interface MetroSession {
  bpm: number;
  beatsPerBar: number;
  /** Server time (ms) of beat 0, which is always the start of a bar. */
  startAt: number;
  running: boolean;
  updatedAt: string;
  /**
   * The device id of the phone that started it: the reference the others match by ear. Missing on sessions
   * started before leaders existed, or by a client that sends none.
   */
  leader?: string;
  /**
   * When a joined phone last marked it seen (server time, ISO). Written at most once per 10 minutes and never
   * with any other change; a session stays running while it is seen or changed (see the server's staleness).
   */
  seenAt?: string;
  /**
   * The grid that is sounding until this one starts at `startAt`: set by a tempo or beats-per-bar change while it
   * plays, so a phone that only sees the latest change (it missed one, or joins during the lead) still plays the
   * right bar until then. Missing on a start, a stop, and a change made before anything was sounding.
   */
  prev?: MetroGrid;
}

/** A grid on its own: beat n is at startAt + n * 60000 / bpm (server time), and beat 0 starts a bar. */
export interface MetroGrid {
  bpm: number;
  beatsPerBar: number;
  startAt: number;
}

/**
 * Every metronome answer (GET and PUT): the session, or null when nobody has started one, and the server's time
 * (ms) when it answered, so each answer is also a clock sample.
 */
export interface MetroAnswer {
  session: MetroSession | null;
  now: number;
  /**
   * On the answer to a start only: false when the start was "only if stopped" and the session was already
   * running, so it was left as it is and `session` is the running one.
   */
  applied?: boolean;
}

/** What a client asks for. Anything left out stays as it is. */
export interface MetroChange {
  bpm?: number;
  beatsPerBar?: number;
  running?: boolean;
  /** Sent with a start: the starter becomes the leader. Ignored on any other change. */
  leader?: string;
  /**
   * With a start: only start a stopped session. If it is already running, it is left as it is (tempo, start and
   * leader) and the answer says the start wasn't applied. Ignored on any other change.
   */
  onlyIfStopped?: boolean;
}

export interface GridBeat {
  n: number;
  timeMs: number;
  /** Position in the bar, 0 = the first beat. */
  beat: number;
  accent: boolean;
}

/** How far ahead of "now" the server puts a start or a change, so every polling phone hears of it first. */
export const LEAD_MS = 3000;

/**
 * A change that replaces one that hasn't started yet keeps its start when it is at least this far away: enough
 * for phones to hear of it in time (they check every 1.5 s while joined).
 */
export const KEEP_START_MS = 1500;

// Absorbs floating-point error, so a beat that falls exactly on a window edge isn't lost or doubled.
const EPS = 1e-9;

/** Every beat in [fromMs, toMs). Stateless, so a phone that joins late simply starts at the next beat. */
export function beatsInWindow(s: MetroSession, fromMs: number, toMs: number): GridBeat[] {
  if (!s.running) return [];
  const interval = 60000 / s.bpm;
  const out: GridBeat[] = [];
  for (let n = Math.max(0, Math.ceil((fromMs - s.startAt) / interval - EPS)); ; n++) {
    const timeMs = s.startAt + n * interval;
    if (timeMs >= toMs) break;
    const beat = n % s.beatsPerBar;
    out.push({ n, timeMs, beat, accent: beat === 0 });
  }
  return out;
}

/**
 * The beats a phone should play in [fromMs, toMs) right after a change: the grid that was sounding (`prev`)
 * until the new grid starts, then the new one (`cur`).
 */
export function gridBeats(prev: MetroSession | null, cur: MetroSession, fromMs: number, toMs: number): GridBeat[] {
  if (!cur.running) return [];
  const before = prev?.running ? beatsInWindow(prev, fromMs, Math.min(toMs, cur.startAt)) : [];
  return [...before, ...beatsInWindow(cur, fromMs, toMs)];
}

/**
 * The session after `change`, worked out on the server's clock:
 * - start: beat 0 is `leadMs` from now;
 * - a tempo or beats-per-bar change while running: the new tempo starts on the first bar line of the grid that is
 *   sounding at or after now + lead, so the grid never jumps, and that grid is kept as `prev` until then;
 * - a change before the current one has started replaces it rather than stacking on it (H23): it keeps that start
 *   while it is at least KEEP_START_MS away, otherwise it moves to the next bar line of the sounding grid at or
 *   after now + lead (or to now + lead when nothing is sounding yet, during a start's lead);
 * - stop: at once.
 * The leader is set by a start (from `change.leader`, or none) and kept by every other change.
 */
export function applyChange(
  current: MetroSession | null,
  change: MetroChange,
  nowMs: number,
  leadMs = LEAD_MS,
): MetroSession {
  const bpm = change.bpm ?? current?.bpm;
  const beatsPerBar = change.beatsPerBar ?? current?.beatsPerBar;
  if (bpm === undefined || beatsPerBar === undefined) {
    // Never invent a tempo: a new session needs one.
    throw new Error("bpm and beatsPerBar are needed to start a metronome");
  }
  const running = change.running ?? current?.running ?? false;
  const updatedAt = new Date(nowMs).toISOString();
  const kept = current?.leader ? { leader: current.leader } : {};
  if (!running) return { bpm, beatsPerBar, startAt: current?.startAt ?? nowMs, running: false, updatedAt, ...kept };
  if (!current?.running) {
    const leader = change.leader ? { leader: change.leader } : {};
    return { bpm, beatsPerBar, startAt: nowMs + leadMs, running: true, updatedAt, ...leader };
  }
  if (bpm === current.bpm && beatsPerBar === current.beatsPerBar) return current;
  const started = current.startAt <= nowMs;
  // The grid that is sounding now: the current one once it has started, otherwise the one it replaces (if any).
  const sounding: MetroGrid | undefined = started
    ? { bpm: current.bpm, beatsPerBar: current.beatsPerBar, startAt: current.startAt }
    : current.prev;
  const prev = sounding ? { prev: sounding } : {};
  if (!started && current.startAt - nowMs >= KEEP_START_MS) {
    return { bpm, beatsPerBar, startAt: current.startAt, running: true, updatedAt, ...kept, ...prev };
  }
  const startAt = sounding ? nextBarLine(sounding, nowMs + leadMs) : nowMs + leadMs;
  return { bpm, beatsPerBar, startAt, running: true, updatedAt, ...kept, ...prev };
}

/** The first bar line of `g` at or after `atMs`. */
function nextBarLine(g: MetroGrid, atMs: number): number {
  const barMs = (g.beatsPerBar * 60000) / g.bpm;
  return g.startAt + Math.max(0, Math.ceil((atMs - g.startAt) / barMs - EPS)) * barMs;
}
