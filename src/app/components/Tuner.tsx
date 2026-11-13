import { useState } from "react";
import { INSTRUMENTS, nearestString, noteFromFrequency } from "../tuner/pitch";
import type { InstrumentId } from "../tuner/pitch";
import { useTuner } from "../tuner/useTuner";
import { useWakeLock } from "./useWakeLock";

export const INSTRUMENT_KEY = "stereo-set:tuner-instrument";
/** Within this many cents counts as in tune. */
export const IN_TUNE_CENTS = 5;

function readInstrument(): InstrumentId {
  try {
    const v = localStorage.getItem(INSTRUMENT_KEY);
    if (v === "guitar" || v === "bass") return v;
  } catch {
    // Storage blocked: guitar.
  }
  return "guitar";
}

export default function Tuner() {
  const [instrument, setInstrument] = useState<InstrumentId>(readInstrument);
  const tuner = useTuner();
  useWakeLock(tuner.listening);

  function choose(id: InstrumentId) {
    setInstrument(id);
    try {
      localStorage.setItem(INSTRUMENT_KEY, id);
    } catch {
      // Not saved; still applies now.
    }
  }

  const strings = INSTRUMENTS[instrument].strings;
  const note = tuner.freq !== null ? noteFromFrequency(tuner.freq) : null;
  const near = tuner.freq !== null ? nearestString(tuner.freq, strings) : null;
  const inTune = note !== null && Math.abs(note.cents) <= IN_TUNE_CENTS;
  const needle = note ? Math.max(-50, Math.min(50, note.cents)) : 0;

  return (
    <section className="tool" aria-labelledby="tuner-heading">
      <h2 id="tuner-heading">Tuner</h2>
      <div className="seg" role="group" aria-label="Instrument">
        {(Object.keys(INSTRUMENTS) as InstrumentId[]).map((id) => (
          <button
            key={id}
            type="button"
            className={id === instrument ? "active" : ""}
            aria-pressed={id === instrument}
            onClick={() => choose(id)}
          >
            {INSTRUMENTS[id].label}
          </button>
        ))}
      </div>
      <ul className="tuner-strings" aria-label="Strings">
        {strings.map((s) => (
          <li key={s.name} className={near?.name === s.name ? "tuner-string near" : "tuner-string"}>
            {s.name}
          </li>
        ))}
      </ul>
      <div className={`tuner-display${inTune ? " in-tune" : ""}`} aria-live="polite">
        <div className="tuner-note">
          {note ? (
            <>
              {note.name}
              <span className="tuner-octave">{note.octave}</span>
            </>
          ) : (
            <span className="muted">{tuner.listening ? "Play a string" : "—"}</span>
          )}
        </div>
        <div className="tuner-meter" aria-hidden="true">
          <span className="tuner-zone" />
          <span className="tuner-needle" style={{ left: `${50 + needle}%`, opacity: note ? 1 : 0.25 }} />
        </div>
        <div className="tuner-cents">
          {note
            ? inTune
              ? "In tune"
              : `${note.cents > 0 ? "+" : ""}${note.cents} cents ${note.cents > 0 ? "(sharp, tune down)" : "(flat, tune up)"}`
            : " "}
        </div>
      </div>
      {tuner.error && <p role="alert" className="error">{tuner.error}</p>}
      <p className="actions">
        {tuner.listening ? (
          <button type="button" className="btn" onClick={tuner.stop}>Stop tuner</button>
        ) : (
          <button type="button" className="btn primary" disabled={tuner.starting} onClick={tuner.start}>
            {tuner.starting ? "Starting…" : "Start tuner"}
          </button>
        )}
      </p>
      <p className="muted tool-note">Uses the microphone. Standard tuning, A4 = 440 Hz.</p>
    </section>
  );
}
