import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { downloadFileName, loadTrackUrl } from "../upload";

/** Plays or downloads an original song's mp3. Nothing is fetched until a button is pressed. */
export default function TrackPlayer({ trackId }: { trackId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const urlRef = useRef<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  async function load(): Promise<{ url: string; title: string }> {
    const track = await api.getTrack(trackId);
    return { url: await loadTrackUrl(track), title: track.title };
  }

  async function play() {
    setError("");
    setBusy(true);
    try {
      const loaded = await load();
      if (!mountedRef.current) {
        // Song changed while loading; don't leak the blob URL.
        URL.revokeObjectURL(loaded.url);
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = loaded.url;
      setUrl(loaded.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setError("");
    setBusy(true);
    try {
      const loaded = await load();
      const a = document.createElement("a");
      a.href = loaded.url;
      a.download = downloadFileName(loaded.title);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(loaded.url), 10_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="track-player">
      <div className="pill-row">
        <button type="button" className="pill" disabled={busy} onClick={play}>
          {busy ? "Loading…" : "Play"}
        </button>
        <button type="button" className="pill" disabled={busy} onClick={download}>
          Download
        </button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {url && <audio controls autoPlay src={url} style={{ width: "100%" }} />}
    </div>
  );
}
