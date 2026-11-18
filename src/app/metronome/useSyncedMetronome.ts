import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { audioLink, createAudioContext, preferPlaybackAudio, startClickLoop, type ClickLoop } from "../audio";
import { deviceId } from "../device";
import type { MetroAnswer, MetroChange, MetroSession } from "../../shared/metronome";
import { linkSmoother, toAudioTime, type TimeSample } from "./clock";
import { listen } from "./listen";
import { loopStart, phaseError, REALIGN_TICKS, shouldRealign } from "./loop";
import { detectOnsets, matchShift } from "./match";
import { useClockSync } from "./useClockSync";

/**
 * How often a joined phone checks the session, also while it is stopped, so a restart reaches it in time.
 * Shorter than the server's 3 s lead (LEAD_MS).
 */
export const POLL_JOINED_MS = 1500;
/** How often an open panel checks the session while this phone isn't joined. */
export const POLL_IDLE_MS = 10_000;
/** How often the page lines the loop up with the grid and moves the flash. The clicks themselves don't need it. */
const TICK_MS = 25;
/** A loop never starts sooner than this from now, so the audio engine gets it in time. */
const START_MARGIN_S = 0.05;

/** A joining phone listens to the band for this many bars (and at least LISTEN_MIN_S) before it plays. */
const LISTEN_BARS = 2;
const LISTEN_MIN_S = 3;
/** Clicks closer together than this share of a beat count as one. */
const REFRACTORY_BEATS = 0.6;

/**
 * How this phone is lined up with the band:
 * - leading: it started the session, so it is the reference;
 * - listening: silent, hearing the leader's clicks to match them;
 * - matched: lined up by ear;
 * - failed: couldn't hear the band, so it plays by the clock alone;
 * - clock: by the clock alone, with nothing to match (no leader, or no round trip measured).
 */
export type SyncPhase = "leading" | "listening" | "matched" | "failed" | "clock";

/** A match by ear, kept in memory only, for one leader. */
interface Match {
  leader: string;
  /** Added to the nudge: plus = played earlier. */
  shiftMs: number;
  spreadMs: number;
  /** The clock offset the match was made with, and when (performance.now()): only drift is added from then on. */
  offsetMs: number;
  atMs: number;
}

/** What the page shows about the match, for one leader. */
interface MatchView {
  leader: string;
  status: "listening" | "matched" | "failed";
  spreadMs?: number;
}

/** A looped bar playing (or booked to start) for one session grid. */
interface Playing {
  loop: ClickLoop;
  grid: MetroSession;
  /** Audio time it starts. */
  when: number;
  /** Audio time it is set to stop, if any. */
  stopAt?: number;
  /** Its phase error (s) on each of the last REALIGN_TICKS ticks since it started playing, oldest first. */
  errors: number[];
}

/** Stops a loop at `at`, unless it is already set to stop sooner. */
function stopBy(p: Playing, at: number) {
  const t = p.stopAt === undefined ? at : Math.min(p.stopAt, at);
  p.loop.stop(t);
  p.stopAt = t;
}

/**
 * Makes a metronome call and hands its answer to `addSample` as a clock sample (local send and receive times, and
 * the server's time in the answer). Resolves the answer.
 */
async function sampledAnswer(call: () => Promise<MetroAnswer>, addSample: (s: TimeSample) => void): Promise<MetroAnswer> {
  const sentMs = performance.now();
  const answer = await call();
  const receivedMs = performance.now();
  if (typeof answer.now === "number") addSample({ sentMs, serverMs: answer.now, receivedMs });
  return answer;
}

/** As sampledAnswer, resolving the session only. */
const sampled = async (call: () => Promise<MetroAnswer>, addSample: (s: TimeSample) => void) =>
  (await sampledAnswer(call, addSample)).session;

const sameSession = (a: MetroSession | null, b: MetroSession | null) =>
  a === b ||
  (!!a && !!b && a.updatedAt === b.updatedAt && a.startAt === b.startAt && a.running === b.running &&
    a.bpm === b.bpm && a.beatsPerBar === b.beatsPerBar);

/**
 * A song's shared metronome on this phone. The session is polled while this is mounted. After `join`, the clicks
 * are one bar the audio engine loops by itself, lined up with the shared grid (clock offset plus this phone's
 * `nudgeMs`), so they keep going when the screen is off and the page's timers stop. While the page runs, a short
 * timer starts and stops loops, switches tempo on the server's bar line, pulls a drifting loop back, and moves
 * the flash, which works without sound too.
 *
 * A phone that joins someone else's session, with its round trip (`roundTripMs`, speaker to its own mic) measured,
 * first stays silent for about 2 bars and listens to the leader through the mic, then shifts its grid to match
 * what it heard. The match is kept for that leader (a tempo change keeps it, a new leader listens again), and from
 * then on the clock offset is frozen and only drifts, so a later sync round can't undo it.
 */
export function useSyncedMetronome(songId: string, nudgeMs: number, roundTripMs: number | null = null) {
  /** undefined until the first answer; null when nobody has started one. */
  const [session, setSession] = useState<MetroSession | null | undefined>(undefined);
  /** False after the last check failed. */
  const [reachable, setReachable] = useState(true);
  const [joined, setJoined] = useState(false);
  const [beat, setBeat] = useState<{ index: number; n: number } | null>(null);
  const [error, setError] = useState("");
  const [noSound, setNoSound] = useState(false);
  /** True after this phone's start found the session already running (it was left as it is). */
  const [alreadyPlaying, setAlreadyPlaying] = useState(false);
  const clock = useClockSync(joined);
  const { addSample } = clock;

  const ctxRef = useRef<AudioContext | null>(null);
  /** Mirrors `joined` for the session checks, which pick their next delay without restarting. */
  const joinedRef = useRef(false);
  joinedRef.current = joined;
  /** Checks the session now (set while the panel is open). */
  const checkNowRef = useRef<(() => void) | null>(null);
  // `cur` is undefined until the first answer, so a first answer of "no session" still counts as news.
  // `prev` is the grid that was sounding before the latest change; the flash follows it until the new one starts.
  const grid = useRef<{ prev: MetroSession | null; cur: MetroSession | null | undefined }>({ prev: null, cur: undefined });
  /** Loops booked, oldest first; the last one is for the newest grid. */
  const audio = useRef<Playing[]>([]);
  const shown = useRef<{ key: string; count: number }>({ key: "", count: 0 });
  const live = useRef({ offsetMs: 0, nudgeMs, synced: false, driftPerMs: 0 });
  live.current = { offsetMs: clock.offsetMs, nudgeMs, synced: clock.status === "synced", driftPerMs: clock.driftPerMs };
  const [me] = useState(deviceId);
  const match = useRef<Match | null>(null);
  const [matchView, setMatchView] = useState<MatchView | null>(null);
  /** True while listening: no loops are booked. */
  const listening = useRef(false);
  /** The audio link, averaged over the last LINK_WINDOW_MS, so its jitter doesn't move the loops. */
  const smoother = useRef(linkSmoother());
  /** Takes a reading of the audio link and gives back the smoothed link. */
  const smoothedLink = (ctx: AudioContext) => smoother.current.add(audioLink(ctx));
  /** Bumped by "Listen again" (and by a listen spoilt by a tempo change), to listen once more. */
  const [attempt, setAttempt] = useState(0);

  /**
   * The offset and nudge the grid is played with. Once matched: the offset taken at match time plus drift since,
   * and the nudge plus the match's shift.
   */
  const aligned = () => {
    const { offsetMs, nudgeMs: nudge, driftPerMs } = live.current;
    const m = match.current;
    if (!m) return { offsetMs, nudgeMs: nudge };
    return { offsetMs: m.offsetMs + driftPerMs * (performance.now() - m.atMs), nudgeMs: nudge + m.shiftMs };
  };

  /** Best guess at the server's time now; before syncing, this phone's own clock. */
  const serverNow = () => (live.current.synced ? performance.now() + aligned().offsetMs : Date.now());

  /** Stops every loop at `at` (audio s; default now). */
  const stopAudio = useCallback((at = 0) => {
    for (const p of audio.current) p.loop.stop(at);
    audio.current = [];
  }, []);

  const accept = useCallback(
    (next: MetroSession | null) => {
      const old = grid.current.cur;
      if (old !== undefined && sameSession(old, next)) return;
      if (next?.running) {
        if (old?.running && old.startAt < next.startAt) {
          // The flash keeps following whatever is sounding until the new grid starts on its bar line.
          if (old.startAt <= serverNow()) grid.current.prev = old;
        } else {
          grid.current.prev = null;
        }
      } else {
        grid.current.prev = null;
        stopAudio();
        setBeat(null);
        setAlreadyPlaying(false);
      }
      // A different leader: the match was against someone else's phone. (A stop keeps the leader, and the match.)
      if (next && match.current && next.leader !== match.current.leader) match.current = null;
      grid.current.cur = next;
      setSession(next);
    },
    [stopAudio],
  );

  // Check the session while the panel is open: fast while joined, slowly otherwise, never while the page is hidden.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Bumped on every restart, so only one chain of checks runs and a late answer from an older one is dropped.
    let generation = 0;
    grid.current = { prev: null, cur: undefined };
    setSession(undefined);
    setReachable(true);
    const hidden = () => document.visibilityState === "hidden";
    const current = (gen: number) => alive && gen === generation;
    // The next check is timed from when this one starts, so a slow answer doesn't stretch the gap; it still
    // waits for this answer, so checks never overlap.
    function check(gen: number) {
      let due = false;
      let settled = false;
      timer = setTimeout(() => {
        due = true;
        if (settled && current(gen)) check(gen);
      }, joinedRef.current ? POLL_JOINED_MS : POLL_IDLE_MS);
      sampled(() => api.getMetronome(songId), addSample)
        .then(
          (s) => {
            if (!current(gen)) return;
            setReachable(true);
            accept(s);
          },
          () => {
            if (current(gen)) setReachable(false);
          },
        )
        .finally(() => {
          settled = true;
          if (due && current(gen) && !hidden()) check(gen);
        });
    }
    /** Drops the pending check and checks now. */
    function restart() {
      clearTimeout(timer);
      check(++generation);
    }
    const onVisibility = () => {
      if (hidden()) {
        clearTimeout(timer);
        return;
      }
      // Back from the screen being off: the phone may have paused the audio, and the session may have changed.
      ctxRef.current?.resume().catch(() => {});
      restart();
    };
    checkNowRef.current = restart;
    document.addEventListener("visibilitychange", onVisibility);
    restart();
    return () => {
      alive = false;
      clearTimeout(timer);
      checkNowRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [songId, accept, addSample]);

  /** Makes the loops match the current grid. Safe to call any time; does nothing when they already match. */
  const reconcile = useCallback(() => {
    const ctx = ctxRef.current;
    const cur = grid.current.cur;
    if (!ctx || !cur?.running || listening.current) {
      stopAudio();
      return;
    }
    const { offsetMs, nudgeMs: nudge } = aligned();
    const now = ctx.currentTime;
    const startS = toAudioTime(cur.startAt, offsetMs, smoothedLink(ctx), nudge);
    const barS = (cur.beatsPerBar * 60) / cur.bpm;
    const loops = (audio.current = audio.current.filter((p) => p.stopAt === undefined || p.stopAt > now));
    const last = loops[loops.length - 1];
    if (last?.grid === cur) {
      // Booked for this grid already. Once it plays, check it hasn't drifted (clock offset, nudge or audio clock):
      // only a lasting error moves it, onto the grid itself, at the next bar line.
      if (last.when > now) return;
      last.errors = [...last.errors, phaseError(startS, last.loop.origin, barS)].slice(-REALIGN_TICKS);
      if (!shouldRealign(last.errors)) return;
      // The error lasted, so the clocks really moved: place the new loop from the readings of those ticks only,
      // which are all from after the move, not from the full average, which is still catching up.
      const gridS = toAudioTime(cur.startAt, offsetMs, smoother.current.keepNewest(REALIGN_TICKS), nudge);
      const at = gridS + Math.ceil((now + 0.1 - gridS) / barS) * barS;
      stopBy(last, at);
      loops.push({ loop: startClickLoop(ctx, cur.bpm, cur.beatsPerBar, at, 0), grid: cur, when: at, errors: [] });
      return;
    }
    // A new grid: book it from its start (or join it part-way). Whatever is booked so far plays until then;
    // a loop that would only start after it never plays.
    const { when, offset } = loopStart(startS, barS, now + START_MARGIN_S);
    for (const p of loops) stopBy(p, when);
    loops.push({ loop: startClickLoop(ctx, cur.bpm, cur.beatsPerBar, when, offset), grid: cur, when, errors: [] });
  }, [stopAudio]);

  /** Lights the beat this phone is playing now, from the grid alone. */
  const flash = useCallback(() => {
    const { prev, cur } = grid.current;
    if (!cur?.running) return;
    const a = aligned();
    const heard = performance.now() + a.offsetMs + a.nudgeMs;
    const g = prev?.running && heard < cur.startAt ? prev : cur;
    if (heard < g.startAt) return;
    const n = Math.floor((heard - g.startAt) / (60000 / g.bpm));
    const key = `${g.startAt}:${n}`;
    if (key === shown.current.key) return;
    shown.current = { key, count: shown.current.count + 1 };
    setBeat({ index: n % g.beatsPerBar, n: shown.current.count });
  }, []);

  // While joined and synced: keep the loops right and the flash moving. The clicks don't depend on this running.
  const synced = clock.status === "synced";
  // Listen to the leader before playing: while the session runs, someone else leads it, the round trip is known,
  // and there is no match for this leader yet (or "Listen again" was tapped). Declared before the tick below,
  // so a listen starts before the tick can book a loop.
  const leader = session?.running ? session.leader : undefined;
  const shouldListen = joined && synced && !noSound && !!leader && leader !== me && roundTripMs !== null;
  /** The attempt a match was made on, so only "Listen again" (a new attempt) re-listens to the same leader. */
  const matchedAttempt = useRef(-1);
  useEffect(() => {
    const ctx = ctxRef.current;
    const cur = grid.current.cur;
    if (!shouldListen || !ctx || !leader || roundTripMs === null || !cur?.running) return;
    if (match.current?.leader === leader && matchedAttempt.current === attempt) return;
    const ac = new AbortController();
    match.current = null;
    listening.current = true;
    stopAudio();
    setMatchView({ leader, status: "listening" });
    // The grid as this phone would play it now, by the clock: the offset and nudge are frozen from here.
    const offsetMs = live.current.offsetMs;
    const nudge = live.current.nudgeMs;
    const atMs = performance.now();
    const beatS = 60 / cur.bpm;
    const barS = cur.beatsPerBar * beatS;
    const gridStartS = () => toAudioTime(cur.startAt, offsetMs, smoothedLink(ctx), nudge);
    // Don't count the silence before a session that hasn't started yet.
    const waitS = Math.max(0, gridStartS() - ctx.currentTime);
    const seconds = waitS + Math.max(LISTEN_MIN_S, LISTEN_BARS * barS);
    const done = (m: Match | null, spreadMs?: number) => {
      listening.current = false;
      match.current = m;
      matchedAttempt.current = attempt;
      setMatchView({ leader, status: m ? "matched" : "failed", spreadMs });
    };
    listen(ctx, seconds, { signal: ac.signal }).then(
      ({ samples, startS }) => {
        if (ac.signal.aborted) return;
        if (grid.current.cur !== cur) {
          // The tempo changed mid-listen: what was heard doesn't fit the grid any more. Listen again.
          listening.current = false;
          setAttempt((n) => n + 1);
          return;
        }
        const rtS = roundTripMs / 1000;
        const endS = startS + samples.length / ctx.sampleRate;
        const g0 = gridStartS();
        // The beats whose clicks, heard a round trip later, fall inside the recording.
        const expected: number[] = [];
        for (let n = Math.max(0, Math.ceil((startS - rtS - g0) / beatS)); g0 + n * beatS + rtS < endS; n++) {
          expected.push(g0 + n * beatS);
        }
        const onsets = detectOnsets(samples, ctx.sampleRate, startS, REFRACTORY_BEATS * beatS);
        const r = matchShift(expected, onsets, rtS, beatS);
        done(r && { leader, shiftMs: r.shiftMs, spreadMs: r.spreadMs, offsetMs, atMs }, r?.spreadMs);
      },
      () => {
        // Mic blocked or missing, or nothing heard: play by the clock alone.
        if (!ac.signal.aborted) done(null);
      },
    );
    return () => {
      ac.abort();
      if (listening.current) {
        listening.current = false;
        setMatchView(null);
      }
    };
  }, [shouldListen, leader, me, roundTripMs, attempt, stopAudio]);

  /** Goes silent and matches the band by ear again. */
  const listenAgain = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!joined || !synced) return;
    const tick = () => {
      reconcile();
      flash();
    };
    tick();
    const t = setInterval(tick, TICK_MS);
    return () => clearInterval(t);
  }, [joined, synced, reconcile, flash]);

  /** Starts this phone's audio and marks it joined. */
  const joinPhone = useCallback(() => {
    setError("");
    preferPlaybackAudio();
    const ctx = ctxRef.current ?? createAudioContext();
    if (ctx) {
      ctxRef.current = ctx;
      ctx.resume().catch(() => {});
    }
    // No sound: the flash still follows the beat.
    setNoSound(!ctx);
    joinedRef.current = true;
    setJoined(true);
  }, []);

  /** Starts this phone playing along. Call it from a tap: browsers only start audio from a user gesture. */
  const join = useCallback(() => {
    setAlreadyPlaying(false);
    joinPhone();
    checkNowRef.current?.();
  }, [joinPhone]);

  /** Stops this phone only. */
  const leave = useCallback(() => {
    stopAudio();
    // A new join listens again.
    match.current = null;
    setMatchView(null);
    joinedRef.current = false;
    setJoined(false);
    setBeat(null);
    // Suspended, the audio clock stands still while performance.now() runs on: the old readings are wrong now.
    smoother.current.clear();
    ctxRef.current?.suspend().catch(() => {});
  }, [stopAudio]);

  useEffect(
    () => () => {
      stopAudio();
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    },
    [stopAudio],
  );

  /** Sends a change and takes the session it answers with. Resolves the answer, or null when it failed. */
  const put = useCallback(
    async (change: MetroChange): Promise<MetroAnswer | null> => {
      setError("");
      try {
        const answer = await sampledAnswer(() => api.putMetronome(songId, change), addSample);
        accept(answer.session);
        setReachable(true);
        return answer;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't reach the server.");
        return null;
      }
    },
    [songId, accept, addSample],
  );

  const send = useCallback(async (change: MetroChange) => (await put(change)) !== null, [put]);

  /**
   * Starts the session for everyone, and joins it on this phone. Only if it is stopped: if a bandmate has started it
   * meanwhile, theirs is left as it is, and this phone leaves and offers to join it (`alreadyPlaying`).
   */
  const start = useCallback(
    async (bpm: number, beatsPerBar: number) => {
      setAlreadyPlaying(false);
      joinPhone();
      const answer = await put({ bpm, beatsPerBar, running: true, leader: me, onlyIfStopped: true });
      if (!answer) return leave();
      if (answer.applied === false) {
        leave();
        setAlreadyPlaying(!!answer.session?.running);
        return;
      }
      // Check after the answer, not before it: a check answered before the start could undo it until the next one.
      checkNowRef.current?.();
    },
    [joinPhone, leave, put, me],
  );

  let phase: SyncPhase = "clock";
  if (joined && session?.running && leader === me) phase = "leading";
  else if (joined && session?.running && matchView && matchView.leader === leader) phase = matchView.status;

  return {
    session,
    reachable,
    joined,
    clock,
    beat,
    error,
    noSound,
    /** This phone's Start for everyone found it already playing, so it offers to join instead. */
    alreadyPlaying,
    /** How this phone is lined up with the band (see SyncPhase). */
    phase,
    /** With phase "matched": how much the heard beats disagreed (ms). */
    matchSpreadMs: phase === "matched" ? (matchView?.spreadMs ?? null) : null,
    /** Someone else leads, but this phone can't match by ear until its round trip is measured. */
    needsRoundTrip: joined && !!session?.running && !!leader && leader !== me && roundTripMs === null,
    listenAgain,
    join,
    leave,
    start,
    /** A tempo or beats-per-bar change: the server puts it on the next bar for everyone. */
    change: send,
    stopAll: useCallback(() => send({ running: false }), [send]),
  };
}
