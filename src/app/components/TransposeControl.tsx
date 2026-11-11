export default function TransposeControl({
  bandKey,
  onChange,
}: {
  bandKey: string;
  onChange: (semitones: number) => void;
}) {
  return (
    <div className="transpose-bar">
      <div className="transpose-row">
        <button type="button" className="pill" aria-label="Transpose down" onClick={() => onChange(-1)}>{"−"}</button>
        <span className="transpose-key" aria-live="polite">{bandKey}</span>
        <button type="button" className="pill" aria-label="Transpose up" onClick={() => onChange(1)}>+</button>
      </div>
      <p className="muted transpose-note">Changes the key for the whole band.</p>
    </div>
  );
}
