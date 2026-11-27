import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, conflictOf } from "../api";
import { useUnsavedChanges } from "../components/useUnsavedChanges";
import { KEYS } from "../../shared/transpose";
import { markupFromPlainText, mergeEditedText, plainTextFromMarkup } from "../../shared/sheet";
import ChordSheet from "../components/ChordSheet";
import ConflictNotice from "../components/ConflictNotice";
import type { Song, SongInput } from "../../shared/types";
import { BEATS_PER_BAR, MAX_BPM, MIN_BPM } from "../../shared/metronome";
import { songTempo } from "../../shared/song";
import { spotifyTrackIdFrom, spotifyTrackUrl } from "../../shared/spotify";

const ALL_KEYS = KEYS.flatMap((k) => [k, `${k}m`]);

interface FormValues {
  title: string;
  artist: string;
  link: string;
  spotify: string;
  originalKey: string;
  bandKey: string;
  capo: number;
  bpm: string;
  beatsPerBar: string;
  pasted: string;
}

const SONG_FIELDS = [
  "title", "artist", "sourceUrl", "originalKey", "bandKey", "capo", "content", "bpm", "beatsPerBar", "spotifyTrackId",
] as const;

const SPOTIFY_LINK_HELP = "Paste one song's link from Spotify (Share, then Copy Song Link), not an album or playlist.";

/** The typed Spotify link as a track id: "" when empty, null when it isn't a link to one song. */
function parseSpotifyLink(text: string): string | null {
  return text.trim() ? spotifyTrackIdFrom(text) : "";
}

/** The typed tempo: null when empty, undefined when it isn't a tempo the server accepts. */
function parseBpm(text: string): number | null | undefined {
  if (!text.trim()) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= MIN_BPM && n <= MAX_BPM ? n : undefined;
}

/**
 * Only the fields the user changed since the song loaded. Sending the rest would put back what
 * this form loaded, e.g. undo a bandmate's transpose made while the form was open.
 */
function changedFields(input: SongInput, loaded: Song): Partial<SongInput> {
  const out: Partial<Record<keyof SongInput, unknown>> = {};
  // A copy saved before tempo (or links) existed has no bpm, beatsPerBar or spotifyTrackId: that's the same as empty.
  const was = { ...loaded, ...songTempo(loaded), spotifyTrackId: loaded.spotifyTrackId ?? "" };
  for (const f of SONG_FIELDS) if (input[f] !== was[f]) out[f] = input[f];
  return out as Partial<SongInput>;
}

const BLANK: FormValues = {
  title: "", artist: "", link: "", spotify: "", originalKey: "", bandKey: "", capo: 0, bpm: "", beatsPerBar: "", pasted: "",
};

/** A comparable picture of the fields the user can change, to tell whether anything is unsaved. */
const snapshotOf = (v: FormValues) => JSON.stringify(v);

export default function SongFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);
  // Opened from a song in a gig's setlist: go back there with the gig kept, so Previous/Next still show.
  const [searchParams] = useSearchParams();
  const gigId = searchParams.get("gig");
  const songUrl = (songId: string) => `/songs/${songId}${gigId ? `?gig=${encodeURIComponent(gigId)}` : ""}`;

  const [mode, setMode] = useState<"link" | "paste">(editing ? "paste" : "link");
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [spotify, setSpotify] = useState("");
  const [originalKey, setOriginalKey] = useState("");
  const [bandKey, setBandKey] = useState("");
  const [capo, setCapo] = useState(0);
  const [bpm, setBpm] = useState("");
  const [beatsPerBar, setBeatsPerBar] = useState("");
  const [pasted, setPasted] = useState("");
  const [imported, setImported] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [initialPlain, setInitialPlain] = useState("");
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isOriginal, setIsOriginal] = useState(false);
  const [message, setMessage] = useState("");
  // The song as it was loaded: what Save compares against, and the version it sends.
  const [loaded, setLoaded] = useState<Song | null>(null);
  // A bandmate saved the song first: what is stored now, loaded into the form on Reload.
  const [conflict, setConflict] = useState<Song | null>(null);
  // What the form looked like when it was loaded (edit) or empty (new); null until an edit has loaded.
  const [baseline, setBaseline] = useState<string | null>(() => (id ? null : snapshotOf(BLANK)));

  useEffect(() => {
    if (!id) {
      setBaseline(snapshotOf(BLANK));
      return;
    }
    setBaseline(null);
    // Fresh, not a saved offline copy: Save compares against it and sends its version.
    api.getSong(id, { fresh: true }).then(fill, (e: Error) => setMessage(e.message));
  }, [id]);

  function fill(s: Song) {
    setLoaded(s);
    setTitle(s.title);
    setIsOriginal(Boolean(s.trackId));
    setArtist(s.artist);
    const spotifyText = s.spotifyTrackId ? spotifyTrackUrl(s.spotifyTrackId) : "";
    setSpotify(spotifyText);
    setOriginalKey(s.originalKey);
    setBandKey(s.bandKey);
    setCapo(s.capo);
    const tempo = songTempo(s);
    const bpmText = tempo.bpm === null ? "" : String(tempo.bpm);
    const beatsText = tempo.beatsPerBar === null ? "" : String(tempo.beatsPerBar);
    setBpm(bpmText);
    setBeatsPerBar(beatsText);
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
        spotify: spotifyText,
        originalKey: s.originalKey,
        bandKey: s.bandKey,
        capo: s.capo,
        bpm: bpmText,
        beatsPerBar: beatsText,
        pasted: plain,
      }),
    );
  }

  async function doImport() {
    setImporting(true);
    setMessage("");
    try {
      const song = await api.importSong(link.trim());
      if (editing) {
        // The song already has its title and artist (often from a playlist): keep them, and keep
        // a band key the band already chose. Nothing is stored until Save.
        // Some UG pages have no key: then keep the keys the song already has.
        if (song.originalKey) {
          setOriginalKey(song.originalKey);
          if (bandKey === "") setBandKey(song.originalKey);
        }
        setCapo(song.capo);
        const plain = plainTextFromMarkup(song.content);
        setExisting(song.content);
        setPasted(plain);
        setInitialPlain(plain);
        return;
      }
      setTitle(song.title);
      setArtist(song.artist);
      setOriginalKey(song.originalKey);
      setBandKey(song.originalKey);
      setCapo(song.capo);
      setImported(song.content);
      setPasted("");
    } catch (e) {
      setMessage((e as Error).message);
      if (!editing) setMode("paste");
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
    baseline !== null &&
    snapshotOf({ title, artist, link, spotify, originalKey, bandKey, capo, bpm, beatsPerBar, pasted }) !== baseline;
  const { allowNavigation } = useUnsavedChanges(dirty);
  // A song may have no key yet (an original nobody has worked out, or a song imported from a playlist).
  const bpmValue = parseBpm(bpm);
  const spotifyTrackId = parseSpotifyLink(spotify);
  const canSave = title.trim() !== "" && bpmValue !== undefined && spotifyTrackId !== null && !saving;

  async function save() {
    setSaving(true);
    setMessage("");
    setConflict(null);
    const input: SongInput = {
      title: title.trim(),
      artist: artist.trim(),
      sourceUrl: link.trim() || null,
      originalKey,
      // No key means no band key either.
      bandKey: originalKey ? bandKey || originalKey : "",
      capo,
      content,
      // Empty means nobody has set it: stored as null, never a made-up tempo.
      bpm: bpmValue ?? null,
      beatsPerBar: beatsPerBar ? Number(beatsPerBar) : null,
      // Save is off while the link isn't a song's link, so null never gets here.
      spotifyTrackId: spotifyTrackId ?? "",
    };
    const patch = loaded ? changedFields(input, loaded) : input;
    if (id && Object.keys(patch).length === 0) {
      // Nothing changed: nothing to save (and nothing that could clash with a bandmate's edit).
      allowNavigation();
      navigate(songUrl(id));
      return;
    }
    try {
      const song = id ? await api.updateSong(id, patch, loaded?.updatedAt) : await api.createSong(input);
      allowNavigation();
      navigate(songUrl(song.id));
    } catch (e) {
      // Everything typed stays in the form; Reload is the user's choice.
      setConflict(conflictOf<Song>(e));
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

      {message && conflict ? (
        <ConflictNotice
          message={`${message} Reloading replaces what you typed here.`}
          onReload={() => {
            fill(conflict);
            setConflict(null);
            setMessage("");
          }}
        />
      ) : (
        message && <p className="error" role="alert">{message}</p>
      )}

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
      {(mode === "link" || editing) && (
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
        Spotify link
        <input
          className="input"
          type="url"
          value={spotify}
          placeholder="https://open.spotify.com/track/..."
          aria-invalid={spotifyTrackId === null}
          onChange={(e) => setSpotify(e.target.value)}
        />
      </label>
      {spotifyTrackId === null && <p className="error">{SPOTIFY_LINK_HELP}</p>}
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
      <div className="field-row">
        <label className="field">
          Tempo (BPM)
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={MIN_BPM}
            max={MAX_BPM}
            step={1}
            value={bpm}
            placeholder="Not set"
            aria-invalid={bpmValue === undefined}
            onChange={(e) => setBpm(e.target.value)}
          />
        </label>
        <label className="field">
          Beats per bar
          <select className="input" value={beatsPerBar} onChange={(e) => setBeatsPerBar(e.target.value)}>
            <option value="">{"—"}</option>
            {BEATS_PER_BAR.map((n) => (
              <option key={n} value={String(n)}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      {bpmValue === undefined && (
        <p className="error">{`Tempo must be a whole number from ${MIN_BPM} to ${MAX_BPM}.`}</p>
      )}

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
