import { useState } from "react";
import { printableSong } from "../../shared/print";
import type { PrintableSong, PrintSource } from "../../shared/print";

/** Loads the songs for lyric sheets, laid out with or without their chords, for the print editor to open. */
export function usePrintLyrics() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** Resolves the laid-out songs, or null (with `error` set) when they couldn't load. */
  async function load(from: () => Promise<PrintSource[]>, withChords: boolean): Promise<PrintableSong[] | null> {
    if (busy) return null;
    setBusy(true);
    setError("");
    try {
      const list = await from();
      return list.map((s) => printableSong(s, withChords));
    } catch {
      setError("Could not load the lyrics to print. Check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, load };
}

/** Asks "Lyrics + chords" or "Lyrics only" before the print editor opens. Pressing Print lyrics again closes it. */
export function PrintLyricsChoice({ busy, onPick }: { busy: boolean; onPick: (withChords: boolean) => void }) {
  return (
    <div className="print-choice" role="group" aria-label="Print lyrics">
      <span className="print-choice-label">Print lyrics:</span>
      <button type="button" className="btn primary" disabled={busy} onClick={() => onPick(true)}>
        Lyrics + chords
      </button>
      <button type="button" className="btn primary" disabled={busy} onClick={() => onPick(false)}>
        Lyrics only
      </button>
      {busy && <span className="muted">Preparing…</span>}
    </div>
  );
}
