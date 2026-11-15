import { useState } from "react";
import type { SongSummary } from "../../shared/types";

interface Props {
  /** Songs not in the setlist yet, sorted by title. */
  songs: SongSummary[];
  busy: boolean;
  /** Resolves true when the songs were saved. */
  onAdd: (ids: string[]) => Promise<boolean>;
}

/** Search + checkboxes, so several songs can go into the setlist in one go. */
export default function AddSongsPicker({ songs, busy, onAdd }: Props) {
  const [query, setQuery] = useState("");
  // In the order they were ticked.
  const [picked, setPicked] = useState<string[]>([]);

  const q = query.trim().toLowerCase();
  const shown = songs.filter((s) => !q || s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function add() {
    if (picked.length === 0 || busy) return;
    // Only clear once saved: if the save fails, the picks are still here to try again.
    // Songs ticked while the save was running stay ticked.
    const adding = picked;
    if (await onAdd(adding)) {
      setPicked((p) => p.filter((id) => !adding.includes(id)));
      setQuery("");
    }
  }

  if (songs.length === 0) return <p className="muted">Every song is already in the setlist.</p>;

  return (
    <div className="add-songs">
      <input
        type="search"
        className="input"
        aria-label="Find songs to add"
        placeholder="Find songs to add"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="add-songs-list">
        {shown.map((s) => (
          <li key={s.id}>
            <label className="add-songs-row">
              <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
              <span>{s.bandKey ? `${s.title} — ${s.bandKey}` : s.title}</span>
              {s.hasChords === false && <span className="badge muted">No chords yet</span>}
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="muted">No matches.</li>}
      </ul>
      <button type="button" className="btn primary" disabled={busy || picked.length === 0} onClick={add}>
        {picked.length === 0 ? "Add songs" : `Add ${picked.length} ${picked.length === 1 ? "song" : "songs"}`}
      </button>
    </div>
  );
}
