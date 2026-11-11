export default function TransposeControl({
  bandKey,
  onChange,
  busy = false,
}: {
  bandKey: string;
  onChange: (semitones: number) => void;
  busy?: boolean;
}) {
  return (
    <div className="transpose-bar">
      <div className="transpose-row" aria-busy={busy}>
        <button type="button" className="pill" disabled={busy} aria-label="Transpose down" onClick={() => onChange(-1)}>{"−"}</button>
        <span className="transpose-key" aria-live="polite">{bandKey}</span>
        <button type="button" className="pill" disabled={busy} aria-label="Transpose up" onClick={() => onChange(1)}>+</button>
      </div>
      <p className="muted transpose-note">Changes the key for the whole band.</p>
    </div>
  );
}
