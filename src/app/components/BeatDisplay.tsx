/** The beat being shown: position in the bar plus a counter that changes every beat (to restart the flash). */
export type ShownBeat = { index: number; n: number } | null;

/** The big flashing tempo and the beat dots, shared by the Tools metronome and the song metronome. */
export default function BeatDisplay({ bpm, beatsPerBar, beat }: { bpm: number; beatsPerBar: number; beat: ShownBeat }) {
  return (
    <>
      <div
        key={beat?.n ?? "idle"}
        className={`metro-flash${beat ? (beat.index === 0 ? " on accent" : " on") : ""}`}
        aria-hidden="true"
      >
        <span className="metro-bpm">{bpm}</span>
        <span className="metro-unit">BPM</span>
      </div>
      <ol className="metro-dots" aria-label="Beats in the bar">
        {Array.from({ length: beatsPerBar }, (_, i) => (
          <li
            key={i}
            className={`metro-dot${i === 0 ? " first" : ""}${beat?.index === i ? " lit" : ""}`}
            aria-current={beat?.index === i ? "step" : undefined}
          />
        ))}
      </ol>
    </>
  );
}
