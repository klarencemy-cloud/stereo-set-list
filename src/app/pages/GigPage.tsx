import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { clearSongCache } from "../songCache";
import { NOT_READY, canSaveOffline, saveGigForOffline } from "../offline";
import { formatGigDate } from "../formatDate";
import SetlistEditor from "../components/SetlistEditor";
import PlaylistImport from "../components/PlaylistImport";
import { setlistOf, songIdsOf } from "../../shared/setlist";
import type { PlaylistTrack } from "../../shared/playlist";
import { toSongSummary } from "../../shared/song";
import type { Gig, SetlistItem, Song, SongSummary } from "../../shared/types";

export default function GigPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [gig, setGig] = useState<Gig | null>(null);
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [savingOffline, setSavingOffline] = useState(false);
  const [offline, setOffline] = useState<{ ok: boolean; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [ticked, setTicked] = useState<PlaylistTrack[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([api.getGig(id), api.listSongs()]).then(
      ([g, s]) => {
        if (!alive) return;
        setGig(g);
        setSongs(s);
      },
      (e) => alive && setError(e instanceof ApiError ? e.message : "Could not load this gig."),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  if (!gig) {
    return (
      <main className="page">
        {error ? <p role="alert" className="error">{error}</p> : <p className="muted">Loading...</p>}
      </main>
    );
  }

  const byId = new Map(songs.map((s) => [s.id, s]));
  // Songs deleted after being added simply drop out of the setlist.
  const items = setlistOf(gig).filter((item) => item.type === "break" || byId.has(item.songId));
  const ids = songIdsOf(items);

  /** Saves the setlist optimistically; resolves true when the server accepted it. */
  async function save(next: SetlistItem[]): Promise<boolean> {
    if (!gig || saving) return false;
    const previous = gig;
    setError("");
    setSaving(true);
    setGig({ ...gig, setlist: next, songIds: songIdsOf(next) });
    try {
      await api.updateGig(gig.id, { setlist: next });
      clearSongCache();
      return true;
    } catch (e) {
      setGig(previous);
      setError(e instanceof ApiError ? e.message : "Could not save the setlist.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** Adds the ticked playlist tracks to the end of the setlist; the panel stays open until it saved. */
  async function addFromPlaylist() {
    if (ticked.length === 0 || importBusy || saving) return;
    setImportBusy(true);
    setError("");
    try {
      let added: Song[];
      try {
        added = await api.importSongs(ticked);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not import the playlist.");
        return;
      }
      setSongs((prev) => {
        const known = new Set(prev.map((s) => s.id));
        return [...prev, ...added.filter((s) => !known.has(s.id)).map(toSongSummary)];
      });
      const fresh = added.filter((s) => !ids.includes(s.id));
      const next: SetlistItem[] = [...items, ...fresh.map((s) => ({ type: "song" as const, songId: s.id }))];
      if (await save(next)) {
        setImporting(false);
        setTicked([]);
      }
    } finally {
      setImportBusy(false);
    }
  }

  function startEditDetails() {
    if (!gig) return;
    setName(gig.name);
    setDate(gig.date);
    setError("");
    setEditingDetails(true);
  }

  async function saveDetails(e: FormEvent) {
    e.preventDefault();
    if (!gig || saving) return;
    if (!name.trim() || !date) {
      setError("Enter a name and a date.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const updated = await api.updateGig(gig.id, { name: name.trim(), date });
      clearSongCache();
      setGig({ ...gig, name: updated.name, date: updated.date });
      setEditingDetails(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the gig.");
    } finally {
      setSaving(false);
    }
  }

  async function saveOffline() {
    if (!gig || savingOffline) return;
    setSavingOffline(true);
    setOffline(null);
    try {
      const { saved, total } = await saveGigForOffline(gig.id);
      setOffline({
        ok: true,
        text:
          saved === total
            ? `Saved ${saved} ${saved === 1 ? "song" : "songs"} for offline.`
            : `Saved ${saved} of ${total} songs. Try again with better signal.`,
      });
    } catch (e) {
      setOffline({ ok: false, text: e instanceof Error && e.message === NOT_READY ? NOT_READY : "Could not save for offline." });
    } finally {
      setSavingOffline(false);
    }
  }

  async function removeGig() {
    if (!gig || !window.confirm(`Delete "${gig.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteGig(gig.id);
      clearSongCache();
      navigate("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete the gig.");
    }
  }

  return (
    <main className="page gig-page">
      {editingDetails ? (
        <form onSubmit={saveDetails}>
          <label className="field">
            Name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Date
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="row">
            <button type="button" className="btn" onClick={() => { setEditingDetails(false); setError(""); }}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={saving}>Save</button>
          </div>
        </form>
      ) : (
        <>
          <h1>{gig.name}</h1>
          <p className="muted">{formatGigDate(gig.date)}</p>
          <button type="button" className="btn" onClick={startEditDetails}>Edit details</button>
        </>
      )}
      <div className="row">
        <h2>Setlist</h2>
        <button type="button" className="btn" onClick={() => setEditing((v) => !v)}>
          {editing ? "Done" : "Edit setlist"}
        </button>
        {!editing && !importing && (
          <button type="button" className="btn" onClick={() => setImporting(true)}>
            Import Playlist
          </button>
        )}
      </div>
      {!editing && importing && (
        <section className="playlist-panel" aria-label="Import Playlist">
          <PlaylistImport
            songs={songs}
            inSetlist={new Set(ids)}
            onTicked={setTicked}
            disabled={importBusy || saving}
          />
          <div className="row">
            <button type="button" className="btn" disabled={importBusy} onClick={() => setImporting(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={importBusy || saving || ticked.length === 0}
              onClick={addFromPlaylist}
            >
              {ticked.length === 0 ? "Add songs" : `Add ${ticked.length} ${ticked.length === 1 ? "song" : "songs"}`}
            </button>
          </div>
        </section>
      )}
      {!editing && (canSaveOffline() || ids.length > 0) && (
        <p className="actions">
          {canSaveOffline() && (
            <button type="button" className="btn" disabled={savingOffline} onClick={saveOffline}>
              {savingOffline ? "Saving…" : "Save for offline"}
            </button>
          )}
          {ids.length > 0 && (
            <button type="button" className="btn" onClick={() => window.print()}>
              Print setlist
            </button>
          )}
        </p>
      )}
      {offline &&
        (offline.ok ? (
          <p role="status" className="muted">{offline.text}</p>
        ) : (
          <p role="alert" className="error">{offline.text}</p>
        ))}
      {error && <p role="alert" className="error">{error}</p>}
      {!editing && ids.length === 0 && <p className="muted">No songs in the setlist yet.</p>}
      {editing ? (
        <SetlistEditor items={items} songs={byId} busy={saving} onChange={save} />
      ) : (
        <>
          <ul className="list">
            {(() => {
              let n = 0;
              return items.map((item) => {
                if (item.type === "break") {
                  return (
                    <li key={`break:${item.id}`} className="setlist-break">
                      {item.label}
                    </li>
                  );
                }
                const s = byId.get(item.songId)!;
                n++;
                return (
                  <li key={`song:${item.songId}`}>
                    <Link className="list-row" to={`/songs/${s.id}?gig=${gig.id}`}>
                      <span className="grow">
                        <span>{`${n}. ${s.title}${s.bandKey ? ` — Key: ${s.bandKey}` : ""}`}</span>
                        {s.hasChords === false && <span className="badge muted">No chords yet</span>}
                        {item.note && <span className="setlist-note muted block">{item.note}</span>}
                      </span>
                    </Link>
                  </li>
                );
              });
            })()}
          </ul>
        </>
      )}
      <p>
        <button type="button" className="btn" onClick={removeGig}>Delete gig</button>
      </p>
      {ids.length > 0 && (
        // Floor sheet: invisible on screen, the only thing on paper (see @media print in styles.css).
        <ol className="print-setlist" aria-hidden="true">
          {ids.map((sid) => (
            <li key={sid}>{byId.get(sid)!.title.toUpperCase()}</li>
          ))}
        </ol>
      )}
    </main>
  );
}
