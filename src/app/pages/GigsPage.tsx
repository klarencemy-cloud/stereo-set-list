import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { formatGigDate, todayISO } from "../formatDate";
import { splitGigs } from "../gigList";
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
    if (date < todayISO()) {
      setFormError("The date can't be in the past.");
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const gig = await api.createGig({ name: name.trim(), date, setlist: [] });
      navigate(`/gigs/${gig.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create the gig.");
      setSaving(false);
    }
  }

  const sections = splitGigs(gigs ?? [], todayISO());

  return (
    <main className="page">
      <div className="row">
        <h1>Gigs</h1>
        {!creating && (
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>New gig</button>
        )}
      </div>
      {creating && (
        <form onSubmit={create} noValidate>
          <label className="field">
            Name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Date
            <input className="input" type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
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
      {gigs !== null && gigs.length > 0 && (
        <>
          <section aria-labelledby="gigs-upcoming">
            <h2 id="gigs-upcoming">Upcoming</h2>
            {sections.upcoming.length === 0 ? (
              <p className="muted">No upcoming gigs.</p>
            ) : (
              <GigRows gigs={sections.upcoming} />
            )}
          </section>
          {sections.past.length > 0 && (
            <section aria-labelledby="gigs-past">
              <h2 id="gigs-past">Past</h2>
              <GigRows gigs={sections.past} />
            </section>
          )}
        </>
      )}
    </main>
  );
}

function GigRows({ gigs }: { gigs: Gig[] }) {
  return (
    <ul className="list">
      {gigs.map((g) => (
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
  );
}
