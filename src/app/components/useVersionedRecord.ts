import { useRef, useState } from "react";
import { ApiError, conflictOf } from "../api";

interface Versioned {
  id: string;
  /** Missing on records saved before versions existed. */
  updatedAt?: string;
}

/** Saves `patch` to record `id`, sending the version this page loaded; resolves to the record as stored. */
export type SendChange<T, P> = (id: string, patch: P, baseVersion: string | undefined) => Promise<T>;

export interface VersionedRecordOptions<T> {
  /** Called with every copy the server has stored: after a save (even one the page has moved on from), and on Reload. */
  onStored?: (record: T) => void;
}

/**
 * The copy of one song or gig a page shows and saves pieces of. Each save sends the version it was loaded at, shows
 * the change at once, and keeps the copy the server stored; a failed save puts the copy back. On a conflict the
 * bandmate's version waits in `conflict` until the user chooses Reload. One save runs at a time per record.
 */
export function useVersionedRecord<T extends Versioned, P extends Partial<T>>(
  send: SendChange<T, P>,
  { onStored }: VersionedRecordOptions<T> = {},
) {
  const [record, setRecord] = useState<T | null>(null);
  // The ids of records with a save running. Checked before React re-renders, so two quick taps can't both start one.
  const busy = useRef(new Set<string>());
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState("");
  // A bandmate saved first: the record as it is stored now, shown on Reload.
  const [conflict, setConflict] = useState<T | null>(null);
  const shown = useRef<T | null>(null);

  function show(r: T | null) {
    shown.current = r;
    setRecord(r);
  }

  function dismiss() {
    setError("");
    setConflict(null);
  }

  /** Shows a copy the page has just loaded (or `null` while one loads); clears any earlier error and conflict. */
  function load(r: T | null) {
    show(r);
    dismiss();
  }

  /** Resolves true when the server stored the change. */
  async function save(patch: P, failMessage: string): Promise<boolean> {
    const r = shown.current;
    if (!r || busy.current.has(r.id)) return false;
    busy.current.add(r.id);
    setSavingIds(new Set(busy.current));
    dismiss();
    // Shown at once; the server's answer replaces it.
    show({ ...r, ...patch });
    // The user may have moved to another record (a swipe) while this saved: leave that one alone.
    const stillHere = () => shown.current?.id === r.id;
    try {
      const saved = await send(r.id, patch, r.updatedAt);
      if (stillHere()) show(saved);
      onStored?.(saved);
      return true;
    } catch (e) {
      if (stillHere()) {
        show(r);
        setConflict(conflictOf<T>(e));
        setError(e instanceof ApiError ? e.message : failMessage);
      }
      return false;
    } finally {
      busy.current.delete(r.id);
      setSavingIds(new Set(busy.current));
    }
  }

  /** Shows the record as a bandmate saved it. Only on request: their changes are never merged in silently. */
  function reload() {
    if (!conflict) return;
    show(conflict);
    dismiss();
    onStored?.(conflict);
  }

  // Only the record on screen counts: a save left running on another one doesn't hold this one up.
  const saving = record !== null && savingIds.has(record.id);

  return { record, saving, error, conflict, load, save, reload, dismiss };
}
