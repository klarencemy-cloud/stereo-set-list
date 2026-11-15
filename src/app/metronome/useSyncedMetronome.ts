import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { audioLink, createAudioContext, preferPlaybackAudio, startClickLoop, type ClickLoop } from "../audio";
import type { MetroChange, MetroSession } from "../../shared/metronome";
import { toAudioTime } from "./clock";
import { loopStart, phaseError } from "./loop";
import { useClockSync } from "./useClockSync";

/**
 * How often a joined phone checks the session, also while it is stopped, so a restart reaches it in time.
 * Shorter than the server's 2 s lead.
 */
export const POLL_JOINED_MS = 1500;
/** How often an open panel checks the session while this phone isn't joined. */
export const POLL_IDLE_MS = 10_000;
/** How often the page lines the loop up with the grid and moves the flash. The clicks themselves don't need it. */
const TICK_MS = 25;
/** A loop never starts sooner than this from now, so the audio engine gets it in time. */
const START_MARGIN_S = 0.05;
/** A loop further than this from the grid is moved back onto it, at the next bar line. */
const REALIGN_S = 0.01;

/** A looped bar playing (or booked to start) for one session grid. */
interface Playing {
  loop: ClickLoop;
  grid: MetroSession;
  /** Audio time it starts. */
  when: number;
  /** Audio time it is set to stop, if any. */
  stopAt?: number;
}

/** Stops a loop at `at`, unless it is already set to stop sooner. */
function stopBy(p: Playing, at: number) {
  const t = p.stopAt === undefined ? at : Math.min(p.stopAt, at);
  p.loop.stop(t);
  p.stopAt = t;
}

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
 */
export function useSyncedMetronome(songId: string, nudgeMs: number) {
  /** undefined until the first answer; null when nobody has started one. */
  const [session, setSession] = useState<MetroSession | null | undefined>(undefined);
  /** False after the last check failed. */
  const [reachable, setReachable] = useState(true);
  const [joined, setJoined] = useState(false);
  const [beat, setBeat] = useState<{ index: number; n: number } | null>(null);
  const [error, setError] = useState("");
  const [noSound, setNoSound] = useState(false);
  const clock = useClockSync(joined);

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
  const live = useRef({ offsetMs: 0, nudgeMs, synced: false });
  live.current = { offsetMs: clock.offsetMs, nudgeMs, synced: clock.status === "synced" };

  /** Best guess at the server's time now; before syncing, this phone's own clock. */
  const serverNow = () => (live.current.synced ? performance.now() + live.current.offsetMs : Date.now());

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
      }
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
      api
        .getMetronome(songId)
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
  }, [songId, accept]);

  /** Makes the loops match the current grid. Safe to call any time; does nothing when they already match. */
  const reconcile = useCallback(() => {
    const ctx = ctxRef.current;
    const cur = grid.current.cur;
    if (!ctx || !cur?.running) {
      stopAudio();
      return;
    }
    const { offsetMs, nudgeMs: nudge } = live.current;
    const now = ctx.currentTime;
    const startS = toAudioTime(cur.startAt, offsetMs, audioLink(ctx), nudge);
    const barS = (cur.beatsPerBar * 60) / cur.bpm;
    const loops = (audio.current = audio.current.filter((p) => p.stopAt === undefined || p.stopAt > now));
    const last = loops[loops.length - 1];
    if (last?.grid === cur) {
      // Booked for this grid already. Once it plays, check it hasn't drifted (clock offset, nudge or audio clock).
      if (last.when > now || Math.abs(phaseError(startS, last.loop.origin, barS)) <= REALIGN_S) return;
      const at = startS + Math.ceil((now + 0.1 - startS) / barS) * barS;
      stopBy(last, at);
      loops.push({ loop: startClickLoop(ctx, cur.bpm, cur.beatsPerBar, at, 0), grid: cur, when: at });
      return;
    }
    // A new grid: book it from its start (or join it part-way). Whatever is booked so far plays until then;
    // a loop that would only start after it never plays.
    const { when, offset } = loopStart(startS, barS, now + START_MARGIN_S);
    for (const p of loops) stopBy(p, when);
    loops.push({ loop: startClickLoop(ctx, cur.bpm, cur.beatsPerBar, when, offset), grid: cur, when });
  }, [stopAudio]);

  /** Lights the beat this phone is playing now, from the grid alone. */
  const flash = useCallback(() => {
    const { prev, cur } = grid.current;
    if (!cur?.running) return;
    const heard = performance.now() + live.current.offsetMs + live.current.nudgeMs;
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
    joinPhone();
    checkNowRef.current?.();
  }, [joinPhone]);

  /** Stops this phone only. */
  const leave = useCallback(() => {
    stopAudio();
    joinedRef.current = false;
    setJoined(false);
    setBeat(null);
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

  const send = useCallback(
    async (change: MetroChange): Promise<boolean> => {
      setError("");
      try {
        accept(await api.putMetronome(songId, change));
        setReachable(true);
        return true;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't reach the server.");
        return false;
      }
    },
    [songId, accept],
  );

  /** Starts the session for everyone, and joins it on this phone. */
  const start = useCallback(
    async (bpm: number, beatsPerBar: number) => {
      joinPhone();
      if (!(await send({ bpm, beatsPerBar, running: true }))) return leave();
      // Check after the answer, not before it: a check answered before the start could undo it until the next one.
      checkNowRef.current?.();
    },
    [joinPhone, leave, send],
  );

  return {
    session,
    reachable,
    joined,
    clock,
    beat,
    error,
    noSound,
    join,
    leave,
    start,
    /** A tempo or beats-per-bar change: the server puts it on the next bar for everyone. */
    change: send,
    stopAll: useCallback(() => send({ running: false }), [send]),
  };
}
