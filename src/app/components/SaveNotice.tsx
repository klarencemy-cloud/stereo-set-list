import ConflictNotice from "./ConflictNotice";

/** Why the last save of a song or gig failed, with Reload when a bandmate saved first. Nothing when it didn't fail. */
export default function SaveNotice({ error, conflict, onReload }: { error: string; conflict: unknown; onReload: () => void }) {
  if (!error) return null;
  return conflict ? <ConflictNotice message={error} onReload={onReload} /> : <p role="alert" className="error">{error}</p>;
}
