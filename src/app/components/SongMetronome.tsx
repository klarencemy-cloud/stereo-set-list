import { useEffect, useRef, useState } from "react";
import { audioLink, click, createAudioContext, preferPlaybackAudio } from "../audio";
import { BEATS_PER_BAR, MAX_BPM, MIN_BPM, clampBpm, type MetroSession } from "../../shared/metronome";
import { songTempo } from "../../shared/song";
import type { Song } from "../../shared/types";
import { bpmFromTaps } from "../metronome/schedule";
import { MAX_NUDGE_MS, NUDGE_STEP_MS, nudgeFromTaps } from "../metronome/clock";
import { listen } from "../metronome/listen";
import { detectOnsets, measureRoundTrip } from "../metronome/match";
import { useMetronome } from "../metronome/useMetronome";
import { useSyncedMetronome } from "../metronome/useSyncedMetronome";
import BeatDisplay from "./BeatDisplay";
import { readSavedMetronome, saveMetronome } from "./Metronome";

/** This phone's calibration in ms (plus = plays earlier). */
export const NUDGE_KEY = "stereo-set:metronome-nudge";
/** This phone's measured speaker-to-mic round trip in ms, for matching the band by ear. Unset until measured. */
export const ROUNDTRIP_KEY = "stereo-set:metronome-roundtrip";
/** A round trip outside this is a bad reading, not a phone. */
const MAX_ROUNDTRIP_MS = 1000;
/** A tempo dragged or tapped while playing is sent once it settles, not on every step. */
const SEND_DELAY_MS = 400;
const OFFLINE = "Can't sync: playing on this phone only";
/** A phone synced by the clock alone warns when its bound is wider than this (H11). */
const ROUGH_SYNC_MS = 25;

function readNudge(): number {
  try {
    const v = Number(localStorage.getItem(NUDGE_KEY));
    if (Number.isFinite(v) && Math.abs(v) <= MAX_NUDGE_MS) return Math.round(v / NUDGE_STEP_MS) * NUDGE_STEP_MS;
  } catch {
    // Storage blocked: no nudge.
  }
  return 0;
}

/** The saved round trip, or null when it was never measured (no made-up default). */
function readRoundTrip(): number | null {
  try {
    const raw = localStorage.getItem(ROUNDTRIP_KEY);
    if (raw === null || raw === "") return null;
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0 && v <= MAX_ROUNDTRIP_MS) return v;
  } catch {
    // Storage blocked: not measured.
  }
  return null;
}

const signed = (ms: number) => (ms > 0 ? `+${ms}` : `${ms}`);

interface Tempo {
  bpm: number;
  beatsPerBar: number;
}

/** −/+, slider, tap tempo and beats per bar. */
function TempoControls({ tempo, onChange }: { tempo: Tempo; onChange: (next: Partial<Tempo>) => void }) {
  const taps = useRef<number[]>([]);
  const { bpm, beatsPerBar } = tempo;
  function tap() {
    taps.current = [...taps.current, performance.now()].slice(-8);
    const t = bpmFromTaps(taps.current);
    if (t !== null) onChange({ bpm: t });
  }
  return (
    <>
      <div className="metro-tempo">
        <button type="button" className="btn" aria-label="Slower" disabled={bpm <= MIN_BPM} onClick={() => onChange({ bpm: bpm - 1 })}>
          {"−"}
        </button>
        <input
          className="metro-slider"
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          step={1}
          value={bpm}
          aria-label="Tempo"
          aria-valuetext={`${bpm} BPM`}
          onChange={(e) => onChange({ bpm: Number(e.target.value) })}
        />
        <button type="button" className="btn" aria-label="Faster" disabled={bpm >= MAX_BPM} onClick={() => onChange({ bpm: bpm + 1 })}>
          +
        </button>
      </div>
      <div className="metro-row">
        <div className="seg" role="group" aria-label="Beats per bar">
          {BEATS_PER_BAR.map((n) => (
            <button
              key={n}
              type="button"
              className={n === beatsPerBar ? "active" : ""}
              aria-pressed={n === beatsPerBar}
              onClick={() => onChange({ beatsPerBar: n })}
            >
              {n}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={tap}>Tap tempo</button>
      </div>
    </>
  );
}

/**
 * v1's metronome, on this phone only: used when the session can't be reached or the clock can't be synced. While it
 * plays, the network coming back (`backOnline`) doesn't stop it: it offers the shared metronome instead (H21).
 */
function LocalMetronome({
  tempo,
  onChange,
  onRetry,
  onRunning,
  backOnline,
  onSwitch,
}: {
  tempo: Tempo;
  onChange: (t: Partial<Tempo>) => void;
  /** Checks again now; resolves whether the server answered. */
  onRetry: () => Promise<boolean>;
  onRunning: (running: boolean) => void;
  backOnline: boolean;
  /** Called from the tap, so the shared metronome may start its audio. */
  onSwitch: () => void;
}) {
  const metro = useMetronome(tempo.bpm, tempo.beatsPerBar);
  const [checking, setChecking] = useState(false);
  const [stillOffline, setStillOffline] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => onRunning(metro.running), [metro.running, onRunning]);
  useEffect(() => () => onRunning(false), [onRunning]);

  async function retry() {
    setChecking(true);
    setStillOffline(false);
    const ok = await onRetry();
    if (!alive.current) return;
    setChecking(false);
    setStillOffline(!ok);
  }

  return (
    <>
      {backOnline ? (
        <p className="metro-status" role="status">Back online — switch to the shared metronome?</p>
      ) : (
        <p className="metro-status warn" role="status">{OFFLINE}</p>
      )}
      <BeatDisplay bpm={tempo.bpm} beatsPerBar={tempo.beatsPerBar} beat={metro.beat} />
      <TempoControls tempo={tempo} onChange={onChange} />
      {metro.error && <p role="alert" className="error">{metro.error}</p>}
      <p className="actions">
        {metro.running ? (
          <button type="button" className="btn" onClick={metro.stop}>Stop</button>
        ) : (
          <button type="button" className="btn primary" onClick={metro.start}>Start on this phone</button>
        )}
        {backOnline ? (
          <button type="button" className="btn primary" onClick={() => { metro.stop(); onSwitch(); }}>Switch</button>
        ) : (
          <button type="button" className="btn" disabled={checking} onClick={retry}>
            {checking ? "Checking..." : "Try syncing again"}
          </button>
        )}
      </p>
      {stillOffline && !backOnline && <p className="muted">Still can't reach the server.</p>}
    </>
  );
}

const TAP_ALONG_CLICKS = 12;
const TAP_ALONG_BPM = 90;
const MEASURE_CLICKS = 8;
/** Far enough apart that even a slow phone hears each click before the next one plays. */
const MEASURE_GAP_S = 0.8;
/** The first click plays this long after the mic starts. */
const MEASURE_LEAD_S = 0.3;

function measureError(e: unknown): string {
  const name = typeof e === "object" && e !== null ? (e as { name?: string }).name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow the microphone for this site, then try again.";
  }
  if (name === "NotSupportedError") return "This browser can't use the microphone here.";
  return "Couldn't use the microphone. Try again.";
}

/** The nudge slider, the tap-along that measures it, and the round-trip measure for matching by ear. */
function Calibrate({
  nudge,
  onNudge,
  roundTrip,
  onRoundTrip,
}: {
  nudge: number;
  onNudge: (ms: number) => void;
  roundTrip: number | null;
  onRoundTrip: (ms: number) => void;
}) {
  const [tapping, setTapping] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [message, setMessage] = useState("");
  const ctxRef = useRef<AudioContext | null>(null);
  const clicks = useRef<number[]>([]);
  const taps = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      ctxRef.current?.close().catch(() => {});
    },
    [],
  );

  function begin() {
    setMessage("");
    preferPlaybackAudio();
    const ctx = ctxRef.current ?? createAudioContext();
    if (!ctx) {
      setMessage("This browser can't play sound.");
      return;
    }
    ctxRef.current = ctx;
    ctx.resume().catch(() => {});
    const link = audioLink(ctx);
    const first = ctx.currentTime + 1;
    const gap = 60 / TAP_ALONG_BPM;
    clicks.current = [];
    taps.current = [];
    for (let i = 0; i < TAP_ALONG_CLICKS; i++) {
      const at = first + i * gap;
      click(ctx, at, i % 4 === 0);
      // When this click is heard, on performance.now(): the clock the taps are timed on.
      clicks.current.push(link.perfMs + (at - link.audioS) * 1000);
    }
    setTapping(true);
    const doneIn = (first + TAP_ALONG_CLICKS * gap - ctx.currentTime) * 1000 + 500;
    timer.current = setTimeout(finish, doneIn);
  }

  function finish() {
    setTapping(false);
    const measured = nudgeFromTaps(clicks.current, taps.current);
    if (measured === null) {
      setMessage("Couldn't measure, try again");
      return;
    }
    onNudge(measured);
    setMessage(`Measured ${signed(measured)} ms, saved`);
  }

  const tap = () => taps.current.push(performance.now());

  /** Plays clicks on the speaker and times how long each takes to reach this phone's own mic. */
  async function measure() {
    setMessage("");
    preferPlaybackAudio();
    const ctx = ctxRef.current ?? createAudioContext();
    if (!ctx) {
      setMessage("This browser can't play sound.");
      return;
    }
    ctxRef.current = ctx;
    ctx.resume().catch(() => {});
    setMeasuring(true);
    const scheduled: number[] = [];
    try {
      const seconds = MEASURE_LEAD_S + MEASURE_CLICKS * MEASURE_GAP_S + 0.2;
      const rec = await listen(ctx, seconds, {
        onStart: () => {
          // From when the mic is recording, so none of the clicks is missed.
          const first = ctx.currentTime + MEASURE_LEAD_S;
          for (let i = 0; i < MEASURE_CLICKS; i++) {
            const at = first + i * MEASURE_GAP_S;
            click(ctx, at, false);
            scheduled.push(at);
          }
        },
      });
      const onsets = detectOnsets(rec.samples, ctx.sampleRate, rec.startS, 0.6 * MEASURE_GAP_S);
      const r = measureRoundTrip(scheduled, onsets, MEASURE_GAP_S);
      if (!r || r.roundTripMs > MAX_ROUNDTRIP_MS) {
        setMessage("Couldn't hear the clicks. Turn the sound up, unplug earphones, and try again somewhere quiet.");
        return;
      }
      const ms = Math.round(r.roundTripMs * 10) / 10;
      onRoundTrip(ms);
      setMessage(`Measured ${Math.round(ms)} ms, saved`);
    } catch (e) {
      setMessage(measureError(e));
    } finally {
      setMeasuring(false);
    }
  }

  return (
    <div className="metro-calibrate">
      <label className="field">
        Nudge
        <input
          className="metro-slider"
          type="range"
          min={-MAX_NUDGE_MS}
          max={MAX_NUDGE_MS}
          step={NUDGE_STEP_MS}
          value={nudge}
          aria-label="Nudge"
          aria-valuetext={`${signed(nudge)} ms`}
          onChange={(e) => onNudge(Number(e.target.value))}
        />
      </label>
      <p className="muted">
        <strong>{nudge === 0 ? "0 ms" : `${signed(nudge)} ms (plays ${nudge > 0 ? "earlier" : "later"})`}</strong>
        {" · "}Move it right if this phone sounds late next to the others.
      </p>
      {tapping ? (
        <button
          type="button"
          className="btn primary metro-tap"
          onPointerDown={tap}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              tap();
            }
          }}
        >
          Tap
        </button>
      ) : (
        <p className="actions">
          <button type="button" className="btn" disabled={measuring} onClick={begin}>Tap along</button>
          <button type="button" className="btn" disabled={measuring} onClick={measure}>
            {measuring ? "Measuring..." : "Measure this phone"}
          </button>
        </p>
      )}
      <p className="muted tool-note">
        Tap along plays 12 clicks on this phone. Tap the big button on each click you hear; the first few don't count.
      </p>
      <p className="muted tool-note">
        Measure this phone plays 8 clicks and listens with the mic, so this phone can match the band by ear when it
        joins. Do it once, somewhere quiet, sound up, no earphones.
        {roundTrip !== null ? ` Measured: ${Math.round(roundTrip)} ms.` : " Not measured yet."}
      </p>
      {message && <p role="status">{message}</p>}
    </div>
  );
}

interface Props {
  song: Song;
  /** Saves the tempo on the screen as the song's own (Save as song tempo). The song page shows any error. */
  onSaveTempo: (tempo: Tempo) => Promise<boolean>;
  /** A save of this song (tempo or key) is running. */
  saving: boolean;
  /** The session whenever it is checked, for the pill's live dot. */
  onSession?: (session: MetroSession | null) => void;
}

/**
 * The song's shared metronome: anyone can start, change or stop it, and every joined phone clicks in time.
 * Keyed by the song, so another song always starts a fresh panel: its own tempo, session view and audio, never the
 * previous song's (H13).
 */
export default function SongMetronome(props: Props) {
  return <SongMetronomePanel key={props.song.id} {...props} />;
}

function SongMetronomePanel({ song, onSaveTempo, saving, onSession }: Props) {
  const [nudge, setNudgeState] = useState(readNudge);
  const [roundTrip, setRoundTripState] = useState(readRoundTrip);
  const m = useSyncedMetronome(song.id, nudge, roundTrip);
  const songT = songTempo(song);
  const [tempo, setTempo] = useState<Tempo>(() => {
    const saved = readSavedMetronome();
    return { bpm: songT.bpm ?? saved.bpm, beatsPerBar: songT.beatsPerBar ?? saved.beatsPerBar };
  });
  /** A tempo being changed while playing, until it is sent. */
  const [pendingBpm, setPendingBpm] = useState<number | null>(null);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [localOnly, setLocalOnly] = useState(false);
  /** The local metronome is playing: it stays on screen until it is stopped or switched from (H21). */
  const [localPlaying, setLocalPlaying] = useState(false);
  const [calibrating, setCalibrating] = useState(false);

  const { session } = m;
  const running = !!session?.running;

  useEffect(() => {
    if (session !== undefined) onSession?.(session);
  }, [session, onSession]);
  useEffect(() => () => clearTimeout(sendTimer.current), []);

  // When it stops, the controls keep the tempo it was playing at: that is this phone's last-used tempo now.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && session && !session.running) {
      setTempo({ bpm: session.bpm, beatsPerBar: session.beatsPerBar });
    }
    wasRunning.current = !!session?.running;
  }, [session]);

  // The clock can't be synced: play on this phone instead.
  const { joined, leave } = m;
  useEffect(() => {
    if (joined && m.clock.status === "failed") {
      leave();
      setLocalOnly(true);
    }
  }, [joined, m.clock.status, leave]);

  function setNudge(ms: number) {
    setNudgeState(ms);
    try {
      localStorage.setItem(NUDGE_KEY, String(ms));
    } catch {
      // Not saved; still applies now.
    }
  }

  function setRoundTrip(ms: number) {
    setRoundTripState(ms);
    try {
      localStorage.setItem(ROUNDTRIP_KEY, String(ms));
    } catch {
      // Not saved; still applies now.
    }
  }

  function changeIdle(next: Partial<Tempo>) {
    setTempo((t) => ({ ...t, ...next, bpm: clampBpm(next.bpm ?? t.bpm) }));
  }

  function changeRunning(next: Partial<Tempo>) {
    if (next.beatsPerBar !== undefined) m.change({ beatsPerBar: next.beatsPerBar });
    if (next.bpm !== undefined) {
      const bpm = clampBpm(next.bpm);
      setPendingBpm(bpm);
      clearTimeout(sendTimer.current);
      sendTimer.current = setTimeout(async () => {
        await m.change({ bpm });
        setPendingBpm((p) => (p === bpm ? null : p));
      }, SEND_DELAY_MS);
    }
  }

  function startForEveryone() {
    saveMetronome(tempo);
    m.start(tempo.bpm, tempo.beatsPerBar);
  }

  const cantSync = localOnly || (session === undefined && !m.reachable);
  /** The local metronome is on screen: it can't sync, or it is still playing after the network came back. */
  const showLocal = cantSync || localPlaying;
  let body;
  if (showLocal) {
    body = (
      <LocalMetronome
        tempo={tempo}
        onChange={changeIdle}
        onRetry={() => {
          setLocalOnly(false);
          return m.retry();
        }}
        onRunning={setLocalPlaying}
        backOnline={!cantSync}
        onSwitch={() => {
          setLocalPlaying(false);
          m.join();
        }}
      />
    );
  } else if (session === undefined) {
    body = <p className="muted">Checking whether it's playing...</p>;
  } else if (running && !m.joined) {
    body = (
      <>
        <p className="metro-playing">{`${m.alreadyPlaying ? "Already playing" : "Playing"} at ${session!.bpm} BPM`}</p>
        <p className="actions">
          <button type="button" className="btn primary" onClick={m.join}>Join</button>
          <button type="button" className="btn" onClick={m.stopAll}>Stop for everyone</button>
        </p>
      </>
    );
  } else if (running) {
    const shown = { bpm: pendingBpm ?? session!.bpm, beatsPerBar: session!.beatsPerBar };
    body = (
      <>
        <BeatDisplay bpm={shown.bpm} beatsPerBar={shown.beatsPerBar} beat={m.beat} />
        <TempoControls tempo={shown} onChange={changeRunning} />
        <p className="muted tool-note">A change starts on the next bar for everyone.</p>
        <p className="actions">
          <button type="button" className="btn" onClick={m.leave}>Leave</button>
          <button type="button" className="btn" onClick={m.stopAll}>Stop for everyone</button>
        </p>
      </>
    );
  } else {
    body = (
      <>
        <BeatDisplay bpm={tempo.bpm} beatsPerBar={tempo.beatsPerBar} beat={null} />
        <TempoControls tempo={tempo} onChange={changeIdle} />
        <p className="actions">
          <button type="button" className="btn primary" onClick={startForEveryone}>Start for everyone</button>
          {m.joined && <button type="button" className="btn" onClick={m.leave}>Leave</button>}
        </p>
        {m.joined && <p className="muted tool-note">You'll hear it here when someone starts it.</p>}
      </>
    );
  }

  const lostServerText = "Can't reach the server: changes from others won't show until it's back.";
  let status = "";
  /** The status is a warning: a clock-only sync whose bound is too wide to play together by (H11). */
  let rough = false;
  // Out of touch with the session, the phone can't hear changes to it: no claim of being synced.
  if (!showLocal && m.joined && session !== undefined && !m.reachable) status = lostServerText;
  else if (!showLocal && m.joined) {
    const boundMs = Math.max(1, Math.round(m.clock.rttMs / 2));
    const bound = `±${boundMs} ms`;
    if (m.clock.status === "synced") {
      if (m.phase === "leading") status = `Leading · synced ${bound}`;
      else if (m.phase === "listening") status = "Listening to the band…";
      else if (m.phase === "matched") status = `Matched to the band ±${Math.max(1, Math.round(m.matchSpreadMs ?? 0))} ms`;
      else if (m.phase === "failed") status = `Couldn't hear the band, synced by clock ${bound}`;
      else status = `Synced ${bound}`;
      // By the clock alone (couldn't hear the band, or nothing to match it with): a wide bound is a real error.
      rough = (m.phase === "failed" || m.phase === "clock") && boundMs > ROUGH_SYNC_MS;
      if (rough) status += ". Rough sync: measure this phone or use Wi-Fi.";
    } else if (m.clock.status === "syncing") status = "Syncing...";
  }
  // Save as song tempo saves what is on screen: the shared tempo while it plays, else the controls'.
  // Only once it has been played: before that the controls' starting value is nobody's choice.
  const onScreen: Tempo | null = showLocal || !session ? null : running ? session : tempo;
  const differs = onScreen && (onScreen.bpm !== songT.bpm || onScreen.beatsPerBar !== songT.beatsPerBar);

  return (
    <section className="tool song-metronome" aria-label="Metronome">
      {status && <p className={rough ? "metro-status warn" : "metro-status"} role="status">{status}</p>}
      {!showLocal && m.joined && m.phase === "failed" && (
        <p className="actions">
          <button type="button" className="btn" onClick={m.listenAgain}>Listen again</button>
        </p>
      )}
      {!showLocal && m.needsRoundTrip && (
        <p className="muted tool-note">
          To match the band by ear, open Calibrate this phone and tap Measure this phone.
        </p>
      )}
      {m.noSound && m.joined && <p className="muted">No sound on this phone: follow the flash.</p>}
      {!showLocal && m.soundPaused && (
        <p className="actions">
          <button type="button" className="btn primary" onClick={m.resumeSound}>Sound paused — tap to resume</button>
        </p>
      )}
      {!showLocal && !m.joined && session !== undefined && !m.reachable && <p className="muted">{lostServerText}</p>}
      {body}
      {m.error && <p role="alert" className="error">{m.error}</p>}
      {differs && (
        <p className="actions">
          <button type="button" className="btn" disabled={saving} onClick={() => void onSaveTempo({ bpm: onScreen!.bpm, beatsPerBar: onScreen!.beatsPerBar })}>
            Save as song tempo
          </button>
        </p>
      )}
      <button
        type="button"
        className="metro-disclose"
        aria-expanded={calibrating}
        onClick={() => setCalibrating((v) => !v)}
      >
        Calibrate this phone
      </button>
      {calibrating && <Calibrate nudge={nudge} onNudge={setNudge} roundTrip={roundTrip} onRoundTrip={setRoundTrip} />}
      <p className="muted tool-note">
        Bluetooth earphones lag 150–300 ms: use wired ones, or calibrate. On iPhone, check the silent switch.
        Keep the screen on while it plays.
      </p>
    </section>
  );
}
