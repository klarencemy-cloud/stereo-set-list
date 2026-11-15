import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { printableSong } from "../../shared/print";
import type { PrintableSong, PrintSource } from "../../shared/print";

/**
 * Printing lyrics: builds the hidden print block, then opens the browser's print dialog. The block stays until
 * the dialog closes (afterprint), and `clear` removes it at once so another print (the setlist) can't pick it up.
 */
export function usePrintLyrics() {
  const [songs, setSongs] = useState<PrintableSong[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const done = () => setSongs(null);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);

  async function print(load: () => Promise<PrintSource[]>, withChords: boolean): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      let list: PrintSource[];
      try {
        list = await load();
      } catch {
        setError("Could not load the lyrics to print. Check your connection and try again.");
        return false;
      }
      // The block must be in the page before the dialog takes its snapshot.
      flushSync(() => setSongs(list.map((s) => printableSong(s, withChords))));
      window.print();
      return true;
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    flushSync(() => setSongs(null));
  }

  return { songs, busy, error, print, clear };
}

/** Asks "Lyrics + chords" or "Lyrics only" before printing. */
export function PrintLyricsChoice({
  busy,
  onPick,
  onCancel,
}: {
  busy: boolean;
  onPick: (withChords: boolean) => void;
  onCancel: () => void;
}) {
  return (
    <div className="print-choice" role="group" aria-label="Print lyrics">
      <span className="print-choice-label">Print lyrics:</span>
      <button type="button" className="btn primary" disabled={busy} onClick={() => onPick(true)}>
        Lyrics + chords
      </button>
      <button type="button" className="btn primary" disabled={busy} onClick={() => onPick(false)}>
        Lyrics only
      </button>
      <button type="button" className="btn" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      {busy && <span className="muted">Preparing…</span>}
    </div>
  );
}

/** The printed lyrics: invisible on screen, the only thing on paper (see @media print in styles.css). */
export default function PrintLyrics({ songs }: { songs: PrintableSong[] }) {
  return (
    <div className="print-lyrics" aria-hidden="true">
      {songs.map((song, i) => (
        <article key={`${song.id}:${i}`} className="print-song">
          <h2 className="print-song-title">{song.title}</h2>
          {song.meta && <p className="print-song-meta">{song.meta}</p>}
          {song.empty ? (
            <p className="print-empty">No lyrics yet</p>
          ) : (
            <div className="print-sheet">
              {song.blocks.map((block, b) => (
                <div key={b} className="print-block">
                  {block.label !== null && <div className="sheet-line sheet-section">{`[${block.label}]`}</div>}
                  {block.lines.map((line, l) => (
                    <div key={l} className="sheet-line">
                      {line.parts.map((p, j) =>
                        p.type === "chord" ? (
                          <span key={j} className="chord">{p.chord}</span>
                        ) : (
                          <span key={j}>{p.text}</span>
                        ),
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
