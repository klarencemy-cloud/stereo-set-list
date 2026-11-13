import { useState } from "react";
import type { ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { itemKey, reorderByKeys, songIdsOf } from "../../shared/setlist";
import AddSongsPicker from "./AddSongsPicker";
import type { SetlistItem, SongSummary } from "../../shared/types";

interface Props {
  items: SetlistItem[];
  songs: Map<string, SongSummary>;
  busy: boolean;
  /** Saves the new setlist; resolves true when the save succeeded. */
  onChange: (items: SetlistItem[]) => Promise<boolean>;
}

/**
 * A text box that only reports a change when it loses focus and the trimmed text differs.
 * What the user typed stays in the box until the save succeeds, so a failed save can be retried.
 */
function BlurField({
  label,
  value,
  maxLength,
  allowEmpty,
  disabled,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  maxLength: number;
  allowEmpty: boolean;
  disabled: boolean;
  placeholder?: string;
  onCommit: (text: string) => Promise<boolean>;
}) {
  // null means "show the saved value"; a string is the user's unsaved text.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="input"
      aria-label={label}
      value={draft ?? value}
      maxLength={maxLength}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={() => {
        if (draft === null) return;
        const t = draft.trim();
        if (t === value || (!t && !allowEmpty)) {
          setDraft(null);
          return;
        }
        setDraft(t);
        void onCommit(t).then((ok) => {
          if (ok) setDraft(null);
        });
      }}
    />
  );
}

/** One editable row. Only the handle starts a drag, so the page can still scroll by swiping elsewhere. */
function SortableRow({
  id,
  dragLabel,
  disabled,
  className = "",
  children,
}: {
  id: string;
  dragLabel: string;
  disabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <li ref={setNodeRef} style={style}>
      <div className={`list-row editing ${className}`}>
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="drag-handle"
          aria-label={dragLabel}
          disabled={disabled}
          {...attributes}
          {...listeners}
        >
          <span aria-hidden="true">{"⠿"}</span>
        </button>
        {children}
      </div>
    </li>
  );
}

export default function SetlistEditor({ items, songs, busy, onChange }: Props) {
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const replace = (i: number, item: SetlistItem) => onChange(items.map((x, j) => (j === i ? item : x)));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || busy) return;
    const next = reorderByKeys(items, String(active.id), String(over.id));
    if (next) onChange(next);
  }

  function addBreak() {
    const sets = items.filter((x) => x.type === "break").length + 1;
    onChange([...items, { type: "break", id: crypto.randomUUID(), label: `Set ${sets + 1}` }]);
  }

  const inSetlist = new Set(songIdsOf(items));
  const available = [...songs.values()]
    .filter((s) => !inSetlist.has(s.id))
    .sort((a, b) => a.title.localeCompare(b.title));

  let songNumber = 0;
  return (
    <>
      <h3 className="add-songs-heading">Add songs</h3>
      <AddSongsPicker
        songs={available}
        busy={busy}
        onAdd={(ids) => onChange([...items, ...ids.map((songId): SetlistItem => ({ type: "song", songId }))])}
      />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map(itemKey)} strategy={verticalListSortingStrategy}>
          <ul className="list">
            {items.map((item, i) => {
              const buttons = (
                <button type="button" className="btn" disabled={busy} onClick={() => remove(i)}>
                  Remove
                </button>
              );
              if (item.type === "break") {
                return (
                  <SortableRow
                    key={itemKey(item)}
                    id={itemKey(item)}
                    dragLabel={`Drag ${item.label}`}
                    disabled={busy}
                    className="setlist-break"
                  >
                    <span className="grow">
                      <BlurField
                        label={`Label for ${item.label}`}
                        value={item.label}
                        maxLength={100}
                        allowEmpty={false}
                        disabled={busy}
                        onCommit={(label) => replace(i, { ...item, label })}
                      />
                    </span>
                    {buttons}
                  </SortableRow>
                );
              }
              const song = songs.get(item.songId)!;
              songNumber++;
              return (
                <SortableRow key={itemKey(item)} id={itemKey(item)} dragLabel={`Drag ${song.title}`} disabled={busy}>
                  <span className="grow">{`${songNumber}. ${song.title}${song.bandKey ? ` — Key: ${song.bandKey}` : ""}`}</span>
                  {buttons}
                  <span className="setlist-note-edit">
                    <BlurField
                      label={`Note for ${song.title}`}
                      value={item.note ?? ""}
                      maxLength={200}
                      allowEmpty
                      disabled={busy}
                      placeholder="Note (optional)"
                      onCommit={(note) => {
                        const { note: _old, ...rest } = item;
                        return replace(i, note ? { ...rest, note } : rest);
                      }}
                    />
                  </span>
                </SortableRow>
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
      <button type="button" className="btn" disabled={busy} onClick={addBreak}>
        Add set break
      </button>
    </>
  );
}
