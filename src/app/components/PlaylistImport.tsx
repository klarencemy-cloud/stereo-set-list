import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { parseTrackList, songMatchKey, uniqueTracks, type PlaylistTrack } from "../../shared/playlist";
import type { SongSummary } from "../../shared/types";

interface Props {
  /** Every song, to mark the tracks that are already in the Songs list. */
  songs: SongSummary[];
  /** Ids of songs already in the gig's setlist: those tracks can't be added again. */
  inSetlist?: Set<string>;
  /** Called with the ticked tracks (in playlist order) whenever the list or the ticks change. */
  onTicked: (tracks: PlaylistTrack[]) => void;
  disabled?: boolean;
}

type Status = "in setlist" | "in Songs" | "new";

/**
 * A Spotify playlist link (or a pasted "Title - Artist" list) shown as a ticked track list.
 * It never clears what was typed or ticked by itself: the parent removes it once its save worked.
 */
export default function PlaylistImport({ songs, inSetlist, onTicked, disabled = false }: Props) {
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [loaded, setLoaded] = useState<{ name: string; tracks: PlaylistTrack[]; truncated: boolean } | null>(null);
  // Match keys of tracks the user unticked; everything else starts ticked.
  const [unticked, setUnticked] = useState<Set<string>>(new Set());

  const tracks = useMemo(
    () => uniqueTracks(pasting ? parseTrackList(pasted) : (loaded?.tracks ?? [])),
    [pasting, pasted, loaded],
  );
  const statusOf = useMemo(() => {
    const byKey = new Map(songs.map((s) => [songMatchKey(s.title, s.artist), s.id]));
    return (t: PlaylistTrack): Status => {
      const id = byKey.get(songMatchKey(t.title, t.artist));
      if (id === undefined) return "new";
      return inSetlist?.has(id) ? "in setlist" : "in Songs";
    };
  }, [songs, inSetlist]);
  const ticked = useMemo(
    () => tracks.filter((t) => statusOf(t) !== "in setlist" && !unticked.has(songMatchKey(t.title, t.artist))),
    [tracks, statusOf, unticked],
  );

  // The parent may pass a new function on every render; only the ticked list should trigger a call.
  const onTickedRef = useRef(onTicked);
  onTickedRef.current = onTicked;
  useEffect(() => {
    onTickedRef.current(ticked);
  }, [ticked]);

  async function load() {
    if (!link.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      setLoaded(await api.readPlaylist(link.trim()));
      setPasting(false);
    } catch (e) {
      setError((e as Error).message);
      setPasting(true);
    } finally {
      setLoading(false);
    }
  }

  function toggle(t: PlaylistTrack) {
    const k = songMatchKey(t.title, t.artist);
    setUnticked((u) => {
      const next = new Set(u);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  return (
    <div className="playlist-import">
      <label className="field">
        Spotify playlist
        <input
          className="input"
          type="url"
          value={link}
          disabled={disabled}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://open.spotify.com/playlist/..."
        />
      </label>
      <div className="row">
        <button type="button" className="btn" disabled={disabled || loading || !link.trim()} onClick={load}>
          {loading ? "Loading..." : "Load"}
        </button>
        {!pasting && (
          <button type="button" className="btn" disabled={disabled} onClick={() => setPasting(true)}>
            Paste track list
          </button>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {pasting && (
        <label className="field">
          Paste track list
          <textarea
            className="input"
            rows={6}
            value={pasted}
            disabled={disabled}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"One per line: Title - Artist"}
          />
        </label>
      )}
      {!pasting && loaded && <h3>{loaded.name}</h3>}
      {!pasting && loaded?.truncated && <p className="muted">Spotify only shows the first 100 tracks.</p>}
      {tracks.length > 0 && (
        <ul className="add-songs-list">
          {tracks.map((t) => {
            const k = songMatchKey(t.title, t.artist);
            const status = statusOf(t);
            const locked = status === "in setlist";
            return (
              <li key={k}>
                <label className="add-songs-row">
                  <input
                    type="checkbox"
                    checked={!locked && !unticked.has(k)}
                    disabled={disabled || locked}
                    onChange={() => toggle(t)}
                  />
                  <span>{t.artist ? `${t.title} — ${t.artist}` : t.title}</span>{" "}
                  <span className="muted">{status}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
