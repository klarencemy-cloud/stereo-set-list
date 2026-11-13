import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { loadSetlist, loadSong, peekSong, prefetchSong, rememberSong } from "../songCache";
import type { Song } from "../../shared/types";
import { transposeContent } from "../../shared/sheet";
import { transposeKey } from "../../shared/transpose";
import ChordSheet from "../components/ChordSheet";
import TrackPlayer from "../components/TrackPlayer";
import TransposeControl from "../components/TransposeControl";
import { useAutoscroll } from "../components/useAutoscroll";
import { useWakeLock } from "../components/useWakeLock";
import { useSongSpeed } from "../components/useSongSpeed";
import { useStageMode } from "../components/useStageMode";
import { useFontSize } from "../components/useFontSize";
import { useSwipe } from "../components/useSwipe";

const KEY_UNKNOWN = "Key unknown \u2014 fix it in Edit";

export default function SongPage() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const gigId = searchParams.get("gig");
  const [neighbours, setNeighbours] = useState<{ prev: string | null; next: string | null }>({ prev: null, next: null });
  const [setlistNote, setSetlistNote] = useState<string | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const speed = useSongSpeed(id);
  const stage = useStageMode();
  const [showTranspose, setShowTranspose] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    // Moving between songs reuses this component: start each one fresh, at the top.
    // A song fetched ahead of time shows straight away, with no loading screen.
    setSong(peekSong(id) ?? null);
    setError(null);
    setRunning(false);
    setShowTranspose(false);
    window.scrollTo?.(0, 0);
    loadSong(id).then(
      (s) => alive && setSong(s),
      (e) => alive && setError(e instanceof ApiError ? e.message : "Could not load this song."),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  // Opened from a gig's setlist: work out the neighbouring songs.
  useEffect(() => {
    setNeighbours({ prev: null, next: null });
    setSetlistNote(null);
    if (!gigId) return;
    let alive = true;
    loadSetlist(gigId).then(
      ({ ids, notes }) => {
        if (!alive) return;
        const i = ids.indexOf(id);
        if (i === -1) return;
        setSetlistNote(notes[id] ?? null);
        const prev = ids[i - 1] ?? null;
        const next = ids[i + 1] ?? null;
        setNeighbours({ prev, next });
        // Fetch the neighbours now so Next and Previous open instantly.
        if (next) prefetchSong(next);
        if (prev) prefetchSong(prev);
      },
      () => {
        // Navigation is a convenience; the song itself still works without it.
      },
    );
    return () => {
      alive = false;
    };
  }, [id, gigId]);

  useAutoscroll(speed.speed, running);
  // Keep the phone from dimming or locking for as long as a song is open.
  useWakeLock(true);
  const font = useFontSize();
  const navigate = useNavigate();
  const sheetRef = useRef<HTMLDivElement>(null);
  const { prev, next } = neighbours;
  useSwipe(sheetRef, {
    onLeft: next ? () => navigate(`/songs/${next}?gig=${gigId}`) : undefined,
    onRight: prev ? () => navigate(`/songs/${prev}?gig=${gigId}`) : undefined,
  });

  async function transpose(semitones: number) {
    if (!song || saving) return;
    const previous = song.bandKey;
    let next: string;
    try {
      next = transposeKey(previous, semitones);
    } catch {
      setError(KEY_UNKNOWN);
      return;
    }
    setError(null);
    setSaving(true);
    setSong({ ...song, bandKey: next });
    try {
      await api.updateSong(song.id, { bandKey: next });
      rememberSong({ ...song, bandKey: next });
    } catch (e) {
      setSong((s) => (s ? { ...s, bandKey: previous } : s));
      setError(e instanceof ApiError ? e.message : "Could not save the new key.");
    } finally {
      setSaving(false);
    }
  }

  // Also shown while a song loads or fails to load: the top bar is hidden in stage mode, so this is the way out.
  const exitStage = stage.on && (
    <button type="button" className="stage-exit" onClick={stage.toggle}>
      Exit stage
    </button>
  );

  if (!song) {
    return (
      <main className="page">
        {exitStage}
        {error ? <p role="alert" className="error">{error}</p> : <p className="muted">Loading...</p>}
      </main>
    );
  }

  let content = song.content;
  let keyUnknown = false;
  try {
    content = transposeContent(song.content, song.originalKey, song.bandKey);
  } catch {
    // A stored key we can't read: show the sheet as written rather than crash.
    keyUnknown = true;
  }
  const source = song.sourceUrl && /^https?:\/\//i.test(song.sourceUrl) ? song.sourceUrl : null;

  return (
    <main className="page song-page">
      {exitStage}
      <h1 className="song-title">{song.title}</h1>
      {song.artist && (
        <p className="song-by">
          <span className="muted">by</span> <strong>{song.artist}</strong>
        </p>
      )}
      <div className="pill-row">
        <button type="button" className="pill pill-yellow" onClick={() => setRunning((r) => !r)}>
          <span aria-hidden="true">{running ? "\u23f8" : "\u25b6"}</span> Autoscroll
        </button>
        <button type="button" className="pill" onClick={speed.cycle}>
          {`Speed: ${speed.speed}`}
        </button>
        <div className="pill pill-split" role="group" aria-label="Text size">
          <button type="button" aria-label="Smaller text" disabled={!font.canShrink} onClick={font.smaller}>
            {"A−"}
          </button>
          <button type="button" aria-label="Bigger text" disabled={!font.canGrow} onClick={font.bigger}>
            A+
          </button>
        </div>
        <button type="button" className="pill" aria-expanded={showTranspose} onClick={() => setShowTranspose((v) => !v)}>
          Transpose
        </button>
        <button type="button" className="pill" aria-pressed={stage.on} onClick={stage.toggle}>
          Stage
        </button>
        <Link className="pill" to={`/songs/${song.id}/edit`}>Edit</Link>
      </div>
      {showTranspose && <TransposeControl bandKey={song.bandKey || "?"} onChange={transpose} busy={saving} />}
      {error && <p role="alert" className="error">{error}</p>}
      {setlistNote && <p className="setlist-note" role="note">{setlistNote}</p>}
      <p className="song-info">
        <span>Key: <strong>{song.bandKey || "?"}</strong></span>
        {" \u00b7 "}
        <span>{song.capo > 0 ? `Capo: ${song.capo}` : "No capo"}</span>
        {source && (
          <>
            {" \u00b7 "}
            <a className="source-link" href={source} target="_blank" rel="noopener noreferrer">
              Source
            </a>
          </>
        )}
      </p>
      {keyUnknown && <p className="muted key-note">{KEY_UNKNOWN}</p>}
      {song.trackId && <TrackPlayer key={song.trackId} trackId={song.trackId} />}
      {song.content.trim() === "" ? (
        <p className="muted">No lyrics or chords yet {"—"} tap Edit to add them.</p>
      ) : (
        <ChordSheet content={content} sheetRef={sheetRef} fontSize={font.size} onTap={() => setRunning(false)} />
      )}
      {(neighbours.prev || neighbours.next) && (
        <nav className="song-nav" aria-label="Setlist">
          {neighbours.prev ? (
            <Link className="pill" to={`/songs/${neighbours.prev}?gig=${gigId}`}>
              <span aria-hidden="true">{"←"}</span> Previous song
            </Link>
          ) : <span />}
          {neighbours.next ? (
            <Link className="pill pill-yellow" to={`/songs/${neighbours.next}?gig=${gigId}`}>
              Next song <span aria-hidden="true">{"→"}</span>
            </Link>
          ) : <span />}
        </nav>
      )}
    </main>
  );
}
