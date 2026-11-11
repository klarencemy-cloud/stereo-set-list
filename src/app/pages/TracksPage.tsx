import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { loadTrackUrl, uploadTrack } from "../upload";
import type { Track } from "../../shared/types";

export default function TracksPage() {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [loadingId, setLoadingId] = useState("");
  const urlRef = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => api.listTracks().then(setTracks, (e: Error) => setError(e.message));

  useEffect(() => {
    refresh();
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const stopPlaying = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setPlaying(null);
  };

  const onUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title.trim() || uploading) return;
    setUploadError("");
    setUploading(true);
    setProgress(0);
    try {
      await uploadTrack(file, title.trim(), setProgress);
      setTitle("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await refresh();
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const onPlay = async (t: Track) => {
    setError("");
    setLoadingId(t.id);
    try {
      const url = await loadTrackUrl(t);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPlaying({ id: t.id, url });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingId("");
    }
  };

  const onDelete = async (t: Track) => {
    if (!window.confirm(`Delete "${t.title}"?`)) return;
    try {
      await api.deleteTrack(t.id);
      if (playing?.id === t.id) stopPlaying();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <main className="page">
      <h1>Our Songs</h1>
      <form onSubmit={onUpload}>
        <label className="field">
          Title
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={uploading} />
        </label>
        <label className="field">
          mp3 file (max 25 MB)
          <input
            ref={fileInput}
            className="input"
            type="file"
            accept="audio/mpeg,.mp3"
            disabled={uploading}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {uploading && <progress value={progress} max={1} aria-label="Upload progress" style={{ width: "100%" }} />}
        {uploadError && <p className="error" role="alert">{uploadError}</p>}
        <button className="btn primary" type="submit" disabled={uploading || !file || !title.trim()}>
          {uploading ? "Uploading…" : uploadError ? "Retry upload" : "Upload"}
        </button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
      {tracks === null && !error && <p className="muted">Loading…</p>}
      {tracks !== null && tracks.length === 0 && <p className="muted">No songs yet. Upload the first one.</p>}
      <ul className="list">
        {(tracks ?? []).map((t) => (
          <li key={t.id} className="list-row" style={{ flexWrap: "wrap" }}>
            <span className="grow">
              <strong>{t.title}</strong>
            </span>
            <button className="btn" onClick={() => onPlay(t)} disabled={loadingId === t.id} aria-label={`Play ${t.title}`}>
              {loadingId === t.id ? "Loading…" : "Play"}
            </button>
            <button className="btn" onClick={() => onDelete(t)} aria-label={`Delete ${t.title}`}>Delete</button>
            {playing?.id === t.id && (
              <audio controls autoPlay src={playing.url} style={{ width: "100%" }} />
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
