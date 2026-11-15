import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LOCK_OFF, nextLock } from "../tuner/lock";
import type { LockState } from "../tuner/lock";
import { DEFAULT_A4, MAX_A4, MIN_A4, clampA4, noteFromFrequency } from "../tuner/pitch";
import { approach } from "../tuner/smooth";
import { useTuner } from "../tuner/useTuner";
import { useWakeLock } from "./useWakeLock";

export const A4_KEY = "stereo-set:tuner-a4";
/** Meter ticks every 10 cents, -50 to +50. */
const TICKS = Array.from({ length: 11 }, (_, i) => i);
/** How quickly the needle glides to a new reading. */
const NEEDLE_TAU_MS = 80;

function readSaved(): number {
  try {
    const raw = localStorage.getItem(A4_KEY);
    const v = raw === null ? NaN : Number(raw);
    if (Number.isFinite(v) && v >= MIN_A4 && v <= MAX_A4) return clampA4(v);
  } catch {
    // Storage blocked: the default.
  }
  return DEFAULT_A4;
}

/** Whole cents to show: 0 under half a cent either way, otherwise rounded away from 0 symmetrically. */
function shownCents(exact: number): number {
  if (Math.abs(exact) < 0.5) return 0;
  return Math.sign(exact) * Math.max(1, Math.round(Math.abs(exact)));
}

/**
 * Glides the needle to `target` (cents, or null for no needle) by writing its `left` directly each animation
 * frame, so the page doesn't re-render 60 times a second. Jumps straight there when motion is reduced, when the
 * browser has no requestAnimationFrame, or when the needle first appears.
 */
function useNeedle(target: number | null) {
  const ref = useRef<HTMLSpanElement>(null);
  const anim = useRef({ pos: null as number | null, target: 0, frame: 0, last: 0 });

  useLayoutEffect(() => {
    const a = anim.current;
    const el = ref.current;
    if (target === null || !el) {
      if (a.frame) cancelAnimationFrame(a.frame);
      a.frame = 0;
      a.pos = null;
      return;
    }
    a.target = target;
    const place = (p: number) => {
      el.style.left = `${50 + p}%`;
    };
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (a.pos === null || reduced || typeof requestAnimationFrame !== "function") {
      a.pos = target;
      place(target);
      return;
    }
    if (a.frame) return; // Already gliding: it picks up the new target.
    a.last = performance.now();
    const step = (t: number) => {
      const dt = Math.max(0, t - a.last);
      a.last = t;
      a.pos = approach(a.pos ?? a.target, a.target, dt, NEEDLE_TAU_MS);
      if (Math.abs(a.pos - a.target) < 0.01) {
        a.pos = a.target;
        a.frame = 0;
      } else {
        a.frame = requestAnimationFrame(step);
      }
      place(a.pos);
    };
    a.frame = requestAnimationFrame(step);
  }, [target]);

  useEffect(
    () => () => {
      if (anim.current.frame) cancelAnimationFrame(anim.current.frame);
    },
    [],
  );

  return ref;
}

export default function Tuner() {
  const [a4, setA4] = useState(readSaved);
  /** What is typed in the A4 box while editing; null shows the saved value. */
  const [draft, setDraft] = useState<string | null>(null);
  const tuner = useTuner();
  useWakeLock(tuner.listening);

  function update(n: number) {
    const next = clampA4(n);
    setA4(next);
    try {
      localStorage.setItem(A4_KEY, String(next));
    } catch {
      // Not saved; still applies now.
    }
  }

  /** While typing: a whole number in range applies at once. Partial input ("4", "44") waits for blur. */
  function type(value: string) {
    setDraft(value);
    const n = Number(value);
    if (value.trim() !== "" && Number.isInteger(n) && n >= MIN_A4 && n <= MAX_A4) update(n);
  }

  /** Applies what was typed. An empty or invalid entry goes back to the last good value. */
  function commit() {
    if (draft === null) return;
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) update(n);
    setDraft(null);
  }

  // A4 is applied here, at render, so changing it shifts the reading at once without restarting anything.
  const note = tuner.freq !== null ? noteFromFrequency(tuner.freq, a4) : null;

  // The in-tune lock advances once per reading. It's kept in a ref, keyed by the reading's time and A4, so every
  // render of the same reading sees the same lock, and a new A4 starts the lock over.
  const lockRef = useRef<{ at: number; a4: number; state: LockState }>({ at: -1, a4, state: LOCK_OFF });
  if (lockRef.current.at !== tuner.at || lockRef.current.a4 !== a4) {
    const prev = lockRef.current.a4 === a4 ? lockRef.current.state : LOCK_OFF;
    const reading = note ? { cents: note.exactCents, midi: note.midi } : null;
    lockRef.current = { at: tuner.at, a4, state: nextLock(prev, reading, tuner.at) };
  }
  const lock = lockRef.current.state;

  const inTune = note !== null && lock.phase === "locked";
  const holding = note !== null && lock.phase === "holding";
  const cents = note ? shownCents(note.exactCents) : 0;
  const flat = note !== null && !inTune && !holding && cents < 0;
  const sharp = note !== null && !inTune && !holding && cents > 0;
  const needleRef = useNeedle(note ? Math.max(-50, Math.min(50, note.exactCents)) : null);

  const tone = inTune ? " in-tune" : holding || lock.phase === "near" ? " near" : "";

  return (
    <section className={`tool tuner${tone}`} aria-labelledby="tuner-heading">
      <div className="tuner-head">
        <h2 id="tuner-heading">Tuner</h2>
        {tuner.listening && (
          <span className="tuner-live" role="status">
            <span className="tuner-live-dot" aria-hidden="true" />
            Listening
          </span>
        )}
      </div>
      <div className="tuner-display" aria-live="polite">
        <div className={`tuner-note${note ? "" : " idle"}`}>
          {note ? (
            <>
              {note.name}
              <span className="tuner-octave">{note.octave}</span>
            </>
          ) : (
            "—"
          )}
        </div>
        <div className="tuner-cents">
          {!note ? (
            tuner.listening ? "Play a note" : "Tap Start, then play a note"
          ) : inTune ? (
            <>
              <span className="tuner-check" aria-hidden="true">✓</span> <span>In tune</span>
            </>
          ) : holding ? (
            <>
              <strong>{`${cents > 0 ? "+" : ""}${cents} cents`}</strong> · hold…
            </>
          ) : (
            <>
              <strong>{`${cents > 0 ? "+" : ""}${cents} cents`}</strong>
              {cents > 0 ? " · tune down" : " · tune up"}
            </>
          )}
        </div>
      </div>
      <div className="tuner-meter" aria-hidden="true">
        <div className="tuner-dir">
          <span className={flat ? "on" : ""}>♭ ◀</span>
          <span className={sharp ? "on" : ""}>▶ ♯</span>
        </div>
        <div className="tuner-track">
          <span className="tuner-zone" />
          {TICKS.map((i) => (
            <span key={i} className={`tuner-tick${i === 5 ? " mid" : ""}`} style={{ left: `${i * 10}%` }} />
          ))}
          {note && <span ref={needleRef} className="tuner-needle" />}
        </div>
        <div className="tuner-hold">
          <span className="tuner-hold-fill" style={{ width: `${(note ? lock.progress : 0) * 100}%` }} />
        </div>
        <div className="tuner-scale">
          <span>-50</span>
          <span>0</span>
          <span>+50</span>
        </div>
      </div>
      {tuner.error && <p role="alert" className="error">{tuner.error}</p>}
      {tuner.listening ? (
        <button type="button" className="btn tuner-go" onClick={tuner.stop}>Stop tuner</button>
      ) : (
        <button type="button" className="btn primary tuner-go" disabled={tuner.starting} onClick={tuner.start}>
          {tuner.starting ? "Starting…" : "Start tuner"}
        </button>
      )}
      <div className="tuner-ref">
        <span>Reference A4</span>
        <button type="button" className="btn tuner-step" aria-label="Lower reference" disabled={a4 <= MIN_A4} onClick={() => update(a4 - 1)}>
          {"−"}
        </button>
        {/* The box is the label; the input inside it is borderless, so "Hz" sits in the same box. */}
        <label className="tuner-ref-box">
          <input
            className="tuner-ref-input"
            type="number"
            inputMode="numeric"
            min={MIN_A4}
            max={MAX_A4}
            step={1}
            value={draft ?? String(a4)}
            aria-label="Reference pitch A4"
            onChange={(e) => type(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
          />
          <span className="tuner-ref-unit">Hz</span>
        </label>
        <button type="button" className="btn tuner-step" aria-label="Raise reference" disabled={a4 >= MAX_A4} onClick={() => update(a4 + 1)}>
          +
        </button>
        {a4 !== DEFAULT_A4 && (
          <button type="button" className="tuner-reset" onClick={() => update(DEFAULT_A4)}>
            Reset to 440
          </button>
        )}
      </div>
    </section>
  );
}
