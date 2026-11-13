import { useRef, useState } from "react";
import { BEATS_PER_BAR, MAX_BPM, MIN_BPM, bpmFromTaps, clampBpm } from "../metronome/schedule";
import { useMetronome } from "../metronome/useMetronome";
import { useWakeLock } from "./useWakeLock";

export const METRONOME_KEY = "stereo-set:metronome";
const DEFAULT = { bpm: 120, beatsPerBar: 4 };

function readSaved(): { bpm: number; beatsPerBar: number } {
  try {
    const v = JSON.parse(localStorage.getItem(METRONOME_KEY) ?? "null") as { bpm?: unknown; beatsPerBar?: unknown } | null;
    if (v && typeof v.bpm === "number" && (BEATS_PER_BAR as readonly unknown[]).includes(v.beatsPerBar)) {
      return { bpm: clampBpm(v.bpm), beatsPerBar: v.beatsPerBar as number };
    }
  } catch {
    // Storage blocked or unreadable: the default.
  }
  return DEFAULT;
}

export default function Metronome() {
  const [settings, setSettings] = useState(readSaved);
  const { bpm, beatsPerBar } = settings;
  const metro = useMetronome(bpm, beatsPerBar);
  const taps = useRef<number[]>([]);
  useWakeLock(metro.running);

  function update(next: Partial<typeof settings>) {
    const merged = { ...settings, ...next };
    merged.bpm = clampBpm(merged.bpm);
    setSettings(merged);
    try {
      localStorage.setItem(METRONOME_KEY, JSON.stringify(merged));
    } catch {
      // Not saved; still applies now.
    }
  }

  function tap() {
    const now = performance.now();
    taps.current = [...taps.current, now].slice(-8);
    const t = bpmFromTaps(taps.current);
    if (t !== null) update({ bpm: t });
  }

  const current = metro.beat;
  return (
    <section className="tool" aria-labelledby="metronome-heading">
      <h2 id="metronome-heading">Metronome</h2>
      <div
        key={current?.n ?? "idle"}
        className={`metro-flash${current ? (current.index === 0 ? " on accent" : " on") : ""}`}
        aria-hidden="true"
      >
        <span className="metro-bpm">{bpm}</span>
        <span className="metro-unit">BPM</span>
      </div>
      <ol className="metro-dots" aria-label="Beats in the bar">
        {Array.from({ length: beatsPerBar }, (_, i) => (
          <li
            key={i}
            className={`metro-dot${i === 0 ? " first" : ""}${current?.index === i ? " lit" : ""}`}
            aria-current={current?.index === i ? "step" : undefined}
          />
        ))}
      </ol>
      <div className="metro-tempo">
        <button type="button" className="btn" aria-label="Slower" disabled={bpm <= MIN_BPM} onClick={() => update({ bpm: bpm - 1 })}>
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
          onChange={(e) => update({ bpm: Number(e.target.value) })}
        />
        <button type="button" className="btn" aria-label="Faster" disabled={bpm >= MAX_BPM} onClick={() => update({ bpm: bpm + 1 })}>
          +
        </button>
      </div>
      <div className="seg" role="group" aria-label="Beats per bar">
        {BEATS_PER_BAR.map((n) => (
          <button
            key={n}
            type="button"
            className={n === beatsPerBar ? "active" : ""}
            aria-pressed={n === beatsPerBar}
            onClick={() => update({ beatsPerBar: n })}
          >
            {n}
          </button>
        ))}
      </div>
      {metro.error && <p role="alert" className="error">{metro.error}</p>}
      <p className="actions">
        <button type="button" className="btn" onClick={tap}>Tap tempo</button>
        {metro.running ? (
          <button type="button" className="btn" onClick={metro.stop}>Stop</button>
        ) : (
          <button type="button" className="btn primary" onClick={metro.start}>Start</button>
        )}
      </p>
      <p className="muted tool-note">
        On iPhone, if you hear nothing, check the silent switch. Bluetooth headphones lag the click a little.
      </p>
    </section>
  );
}
