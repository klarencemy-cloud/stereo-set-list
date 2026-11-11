import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { formatGigDate } from "../formatDate";
import type { Gig } from "../../shared/types";

export default function GigsPage() {
  const navigate = useNavigate();
  const [gigs, setGigs] = useState<Gig[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    api.listGigs().then(setGigs, (e: Error) => setError(e.message));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!name.trim() || !date) {
      setFormError("Enter a name and a date.");
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const gig = await api.createGig({ name: name.trim(), date, songIds: [] });
      navigate(`/gigs/${gig.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create the gig.");
      setSaving(false);
    }
  }

  return (
    <main className="page">
      <div className="row">
        <h1>Gigs</h1>
        {!creating && (
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>New gig</button>
        )}
      </div>
      {creating && (
        <form onSubmit={create}>
          <label className="field">
            Name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Date
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {formError && <p className="error" role="alert">{formError}</p>}
          <div className="row">
            <button type="button" className="btn" onClick={() => setCreating(false)}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving}>Create gig</button>
          </div>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {gigs === null && !error && <p className="muted">Loading...</p>}
      {gigs !== null && gigs.length === 0 && <p className="muted">No gigs yet. Add the first one.</p>}
      <ul className="list">
        {(gigs ?? []).map((g) => (
          <li key={g.id}>
            <Link className="list-row" to={`/gigs/${g.id}`}>
              <span className="grow">
                <strong>{g.name}</strong>
                <span className="muted block">{formatGigDate(g.date)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
