import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { formatGigDate } from "../formatDate";
import type { Gig, SongSummary } from "../../shared/types";

export default function GigPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [gig, setGig] = useState<Gig | null>(null);
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toAdd, setToAdd] = useState("");
  const [editingDetails, setEditingDetails] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");

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
  const ids = gig.songIds.filter((sid) => byId.has(sid));

  async function save(songIds: string[]) {
    if (!gig || saving) return;
    const previous = gig;
    setError("");
    setSaving(true);
    setGig({ ...gig, songIds });
    try {
      await api.updateGig(gig.id, { songIds });
    } catch (e) {
      setGig(previous);
      setError(e instanceof ApiError ? e.message : "Could not save the setlist.");
    } finally {
      setSaving(false);
    }
  }

  function move(i: number, delta: number) {
    const next = [...ids];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    void save(next);
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
      setGig({ ...gig, name: updated.name, date: updated.date });
      setEditingDetails(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the gig.");
    } finally {
      setSaving(false);
    }
  }

  async function removeGig() {
    if (!gig || !window.confirm(`Delete "${gig.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteGig(gig.id);
      navigate("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete the gig.");
    }
  }

  const available = songs
    .filter((s) => !ids.includes(s.id))
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <main className="page">
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
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {ids.length === 0 && <p className="muted">No songs in the setlist yet.</p>}
      <ul className="list">
        {ids.map((sid, i) => {
          const s = byId.get(sid)!;
          const label = `${i + 1}. ${s.title} — Key: ${s.bandKey}`;
          return (
            <li key={sid}>
              {editing ? (
                <div className="list-row editing">
                  <span className="grow">{label}</span>
                  <button type="button" className="btn" disabled={saving || i === 0} onClick={() => move(i, -1)}>
                    Move up
                  </button>
                  <button type="button" className="btn" disabled={saving || i === ids.length - 1} onClick={() => move(i, 1)}>
                    Move down
                  </button>
                  <button type="button" className="btn" disabled={saving} onClick={() => save(ids.filter((x) => x !== sid))}>
                    Remove
                  </button>
                </div>
              ) : (
                <Link className="list-row" to={`/songs/${s.id}?gig=${gig.id}`}>
                  <span className="grow">{label}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {editing && (
        <>
          <label className="field">
            Song to add
            <select className="input" value={toAdd} onChange={(e) => setToAdd(e.target.value)}>
              <option value="">Choose a song</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={saving || !toAdd}
            onClick={() => {
              void save([...ids, toAdd]);
              setToAdd("");
            }}
          >
            Add song
          </button>
        </>
      )}
      <p>
        <button type="button" className="btn" onClick={removeGig}>Delete gig</button>
      </p>
    </main>
  );
}
