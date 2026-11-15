/**
 * Shown when a save was refused because a bandmate saved first. Nothing is merged on its own:
 * the user decides when to load the other version.
 */
export default function ConflictNotice({ message, onReload }: { message: string; onReload: () => void }) {
  return (
    <p role="alert" className="error">
      {message}{" "}
      <button type="button" className="btn" onClick={onReload}>
        Reload
      </button>
    </p>
  );
}
