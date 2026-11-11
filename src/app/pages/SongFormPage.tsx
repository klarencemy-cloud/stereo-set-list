import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { KEYS } from "../../shared/transpose";
import { markupFromPlainText, parseSheet } from "../../shared/sheet";
import type { SongInput } from "../../shared/types";

const ALL_KEYS = KEYS.flatMap((k) => [k, `${k}m`]);

function previewOf(markup: string): string {
  return parseSheet(markup)
    .map((l) =>
      l.kind === "section"
        ? `[${l.label}]`
        : l.parts.map((p) => (p.type === "chord" ? `[${p.chord}]` : p.text)).join(""),
    )
    .join("\n");
}

export default function SongFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);

  const [mode, setMode] = useState<"link" | "paste">(editing ? "paste" : "link");
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [originalKey, setOriginalKey] = useState("");
  const [bandKey, setBandKey] = useState("");
  const [capo, setCapo] = useState(0);
  const [pasted, setPasted] = useState("");
  const [imported, setImported] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!id) return;
    api.getSong(id).then(
      (s) => {
        setTitle(s.title);
        setArtist(s.artist);
        setOriginalKey(s.originalKey);
        setBandKey(s.bandKey);
        setCapo(s.capo);
        setLink(s.sourceUrl ?? "");
        setExisting(s.content);
      },
      (e: Error) => setMessage(e.message),
    );
  }, [id]);

  async function doImport() {
    setImporting(true);
    setMessage("");
    try {
      const song = await api.importSong(link.trim());
      setTitle(song.title);
      setArtist(song.artist);
      setOriginalKey(song.originalKey);
      setBandKey(song.originalKey);
      setCapo(song.capo);
      setImported(song.content);
      setPasted("");
    } catch (e) {
      setMessage((e as Error).message);
      setMode("paste");
    } finally {
      setImporting(false);
    }
  }

  const content = pasted.trim() ? markupFromPlainText(pasted) : (imported ?? existing ?? "");
  const canSave = title.trim() !== "" && originalKey !== "" && !saving;

  async function save() {
    setSaving(true);
    setMessage("");
    const input: SongInput = {
      title: title.trim(),
      artist: artist.trim(),
      sourceUrl: link.trim() || null,
      originalKey,
      bandKey: bandKey || originalKey,
      capo,
      content,
    };
    try {
      const song = id ? await api.updateSong(id, input) : await api.createSong(input);
      navigate(`/songs/${song.id}`);
    } catch (e) {
      setMessage((e as Error).message);
      setSaving(false);
    }
  }

  async function removeSong() {
    if (!id || !window.confirm(`Delete "${title || "this song"}"? This cannot be undone.`)) return;
    setDeleting(true);
    setMessage("");
    try {
      await api.deleteSong(id);
      navigate("/songs");
    } catch (e) {
      setMessage((e as Error).message);
      setDeleting(false);
    }
  }

  const preview = pasted.trim() ? null : (imported ?? existing);

  return (
    <main className="page">
      <h1>{editing ? "Edit song" : "Add song"}</h1>

      {!editing && (
        <div className="seg" role="group" aria-label="How to add">
          <button type="button" className={mode === "link" ? "active" : ""} onClick={() => setMode("link")}>
            Import from link
          </button>
          <button type="button" className={mode === "paste" ? "active" : ""} onClick={() => setMode("paste")}>
            Paste chords
          </button>
        </div>
      )}

      {message && <p className="error" role="alert">{message}</p>}

      <label className="field">
        Link
        <input
          className="input"
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://tabs.ultimate-guitar.com/..."
        />
      </label>
      {mode === "link" && (
        <button type="button" className="btn" onClick={doImport} disabled={!link.trim() || importing}>
          {importing ? "Importing..." : "Import"}
        </button>
      )}

      <label className="field">
        Title
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        Artist
        <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} />
      </label>
      <label className="field">
        Original key
        <select
          className="input"
          value={originalKey}
          onChange={(e) => {
            setOriginalKey(e.target.value);
            if (!editing) setBandKey(e.target.value);
          }}
        >
          <option value="">Choose...</option>
          {ALL_KEYS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
          {originalKey && !ALL_KEYS.includes(originalKey) && <option value={originalKey}>{originalKey}</option>}
        </select>
      </label>
      <label className="field">
        Capo
        <input
          className="input"
          type="number"
          min={0}
          max={12}
          value={capo}
          onChange={(e) => setCapo(Math.max(0, Math.min(12, Number(e.target.value) || 0)))}
        />
      </label>

      {mode === "paste" && (
        <label className="field">
          Chords
          <textarea
            className="input sheet-input"
            rows={12}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={editing ? "Leave empty to keep the current chords" : "Paste chords above the lyrics"}
          />
        </label>
      )}

      {preview && (
        <section>
          <h2>Preview</h2>
          <pre className="sheet" data-testid="preview">{previewOf(preview)}</pre>
        </section>
      )}

      <button type="button" className="btn primary" disabled={!canSave} onClick={save}>
        Save
      </button>

      {editing && (
        <p className="danger-zone">
          <button type="button" className="btn danger" disabled={deleting || saving} onClick={removeSong}>
            {deleting ? "Deleting..." : "Delete song"}
          </button>
        </p>
      )}
    </main>
  );
}
