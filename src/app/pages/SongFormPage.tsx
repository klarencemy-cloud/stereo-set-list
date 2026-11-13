import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { clearSongCache } from "../songCache";
import { useUnsavedChanges } from "../components/useUnsavedChanges";
import { KEYS } from "../../shared/transpose";
import { markupFromPlainText, mergeEditedText, plainTextFromMarkup } from "../../shared/sheet";
import ChordSheet from "../components/ChordSheet";
import type { SongInput } from "../../shared/types";

const ALL_KEYS = KEYS.flatMap((k) => [k, `${k}m`]);

interface FormValues {
  title: string;
  artist: string;
  link: string;
  originalKey: string;
  bandKey: string;
  capo: number;
  pasted: string;
}

const BLANK: FormValues = { title: "", artist: "", link: "", originalKey: "", bandKey: "", capo: 0, pasted: "" };

/** A comparable picture of the fields the user can change, to tell whether anything is unsaved. */
const snapshotOf = (v: FormValues) => JSON.stringify(v);

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
  const [initialPlain, setInitialPlain] = useState("");
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isOriginal, setIsOriginal] = useState(false);
  const [message, setMessage] = useState("");
  // What the form looked like when it was loaded (edit) or empty (new); null until an edit has loaded.
  const [baseline, setBaseline] = useState<string | null>(() => (id ? null : snapshotOf(BLANK)));

  useEffect(() => {
    if (!id) {
      setBaseline(snapshotOf(BLANK));
      return;
    }
    setBaseline(null);
    // Fresh, not a saved offline copy: whatever loads here is sent back whole on Save.
    api.getSong(id, { fresh: true }).then(
      (s) => {
        setTitle(s.title);
        setIsOriginal(Boolean(s.trackId));
        setArtist(s.artist);
        setOriginalKey(s.originalKey);
        setBandKey(s.bandKey);
        setCapo(s.capo);
        setLink(s.sourceUrl ?? "");
        setExisting(s.content);
        const plain = plainTextFromMarkup(s.content);
        setPasted(plain);
        setInitialPlain(plain);
        setBaseline(
          snapshotOf({
            title: s.title,
            artist: s.artist,
            link: s.sourceUrl ?? "",
            originalKey: s.originalKey,
            bandKey: s.bandKey,
            capo: s.capo,
            pasted: plain,
          }),
        );
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

  // Unchanged text sends the stored content as-is: converting back and forth can lose formatting.
  const content =
    editing && existing !== null && pasted === initialPlain
      ? existing
      : pasted.trim()
        ? editing && existing !== null
          ? mergeEditedText(existing, pasted)
          : markupFromPlainText(pasted)
        : (imported ?? existing ?? "");
  const dirty =
    baseline !== null && snapshotOf({ title, artist, link, originalKey, bandKey, capo, pasted }) !== baseline;
  const { allowNavigation } = useUnsavedChanges(dirty);
  // A song may have no key yet (an original nobody has worked out, or a song imported from a playlist).
  const canSave = title.trim() !== "" && !saving;

  async function save() {
    setSaving(true);
    setMessage("");
    const input: SongInput = {
      title: title.trim(),
      artist: artist.trim(),
      sourceUrl: link.trim() || null,
      originalKey,
      // No key means no band key either.
      bandKey: originalKey ? bandKey || originalKey : "",
      capo,
      content,
    };
    try {
      const song = id ? await api.updateSong(id, input) : await api.createSong(input);
      clearSongCache();
      allowNavigation();
      navigate(`/songs/${song.id}`);
    } catch (e) {
      setMessage((e as Error).message);
      setSaving(false);
    }
  }

  async function removeSong() {
    if (!id || !window.confirm(
        `Delete "${title || "this song"}"?${isOriginal ? " This also deletes the mp3." : ""} This cannot be undone.`,
      )) return;
    setDeleting(true);
    setMessage("");
    try {
      await api.deleteSong(id);
      clearSongCache();
      allowNavigation();
      navigate(isOriginal ? "/tracks" : "/songs");
    } catch (e) {
      setMessage((e as Error).message);
      setDeleting(false);
    }
  }

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
            placeholder={editing ? "Fix chords here. Leave empty to keep the current chords" : "Paste chords above the lyrics"}
          />
        </label>
      )}

      {content !== "" && (
        <section>
          <h2>Preview</h2>
          <div data-testid="preview">
            <ChordSheet content={content} full={false} />
          </div>
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
