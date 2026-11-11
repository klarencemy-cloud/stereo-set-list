import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { SongSummary } from "../../shared/types";

export default function SongsPage() {
  const [songs, setSongs] = useState<SongSummary[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.listSongs().then(setSongs, (e: Error) => setError(e.message));
  }, []);

  const q = query.trim().toLowerCase();
  const shown = (songs ?? [])
    .filter((s) => !q || s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <main className="page">
      <div className="row">
        <h1>Songs</h1>
        <Link className="btn primary" to="/songs/new">Add song</Link>
      </div>
      <input
        type="search"
        className="input"
        placeholder="Search title or artist"
        aria-label="Search songs"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p className="error" role="alert">{error}</p>}
      {songs === null && !error && <p className="muted">Loading…</p>}
      {songs !== null && shown.length === 0 && (
        <p className="muted">{songs.length === 0 ? "No songs yet. Add the first one." : "No matches."}</p>
      )}
      <ul className="list">
        {shown.map((s) => (
          <li key={s.id}>
            <Link className="list-row" to={`/songs/${s.id}`}>
              <span className="grow">
                <strong>{s.title}</strong>
                <span className="muted block">{s.artist}</span>
              </span>
              <span className="pill">{s.bandKey}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
