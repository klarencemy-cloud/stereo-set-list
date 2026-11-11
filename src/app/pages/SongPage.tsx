import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import type { Song } from "../../shared/types";
import { transposeContent } from "../../shared/sheet";
import { transposeKey } from "../../shared/transpose";
import ChordSheet from "../components/ChordSheet";
import TransposeControl from "../components/TransposeControl";
import { useAutoscroll } from "../components/useAutoscroll";

const SPEEDS = [0.5, 1, 1.5, 2, 3];
const KEY_UNKNOWN = "Key unknown — fix it in Edit";

export default function SongPage() {
  const { id = "" } = useParams();
  const [song, setSong] = useState<Song | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [showTranspose, setShowTranspose] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getSong(id).then(
      (s) => alive && setSong(s),
      (e) => alive && setError(e instanceof ApiError ? e.message : "Could not load this song."),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  useAutoscroll(SPEEDS[speedIdx], running);

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
    } catch (e) {
      setSong((s) => (s ? { ...s, bandKey: previous } : s));
      setError(e instanceof ApiError ? e.message : "Could not save the new key.");
    } finally {
      setSaving(false);
    }
  }

  if (!song) {
    return (
      <main className="page">
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
      <h1 className="song-title">{song.title}</h1>
      <p className="song-by">
        <span className="muted">by</span> <strong>{song.artist}</strong>
      </p>
      <div className="pill-row">
        <button type="button" className="pill pill-yellow" onClick={() => setRunning((r) => !r)}>
          <span aria-hidden="true">{running ? "⏸" : "▶"}</span> Autoscroll
        </button>
        <button type="button" className="pill" onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}>
          {`Speed: ${SPEEDS[speedIdx]}`}
        </button>
        <button type="button" className="pill" aria-expanded={showTranspose} onClick={() => setShowTranspose((v) => !v)}>
          Transpose
        </button>
        <Link className="pill" to={`/songs/${song.id}/edit`}>Edit</Link>
      </div>
      {showTranspose && <TransposeControl bandKey={song.bandKey} onChange={transpose} busy={saving} />}
      {error && <p role="alert" className="error">{error}</p>}
      <p className="song-info">
        <span>Key: <strong>{song.bandKey}</strong></span>
        {" · "}
        <span>{song.capo > 0 ? `Capo: ${song.capo}` : "No capo"}</span>
        {source && (
          <>
            {" · "}
            <a className="source-link" href={source} target="_blank" rel="noopener noreferrer">
              Source
            </a>
          </>
        )}
      </p>
      {keyUnknown && <p className="muted key-note">{KEY_UNKNOWN}</p>}
      <ChordSheet content={content} onTap={() => setRunning(false)} />
    </main>
  );
}
