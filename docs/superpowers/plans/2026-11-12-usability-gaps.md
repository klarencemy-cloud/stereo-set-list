# Usability Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the eight usability gaps from the 2026-11-12 site review: gig order, editing chords in place, faster setlist building (multi-add + drag), set breaks / notes, per-song autoscroll speed, stage mode, an unsaved-changes warning, and key filter + upcoming-gig badges on the song list.

**Architecture:** Most work is client-side. One data-model change goes through `repo.ts`: gigs get a `setlist` of song/break items (with an optional note per song) while still returning the old `songIds` derived from it, so offline-cached pages, `songCache`, and `offline.ts` keep working. Setlist logic lives in `src/shared/setlist.ts` so server and client share it. The router moves to a data router so `useBlocker` can guard the song form.

**Tech Stack:** React 18, react-router-dom 6.28, Vite 5, Vitest 2, Netlify Functions + Blobs. One new dependency family: `@dnd-kit` (pure JS).

**Spec:** Section 2 ("Usability gaps") of the site review given in conversation on 2026-11-12. There is no separate design doc; the decisions it left open are fixed under **Decisions** below.

## Decisions

- **Gig order:** "Upcoming" = date ≥ today on the device (today counts as upcoming), soonest first. "Past" = newest first. Sorting happens on the client; the server's order stays as it is.
- **Editing chords:** In edit mode the Chords box starts filled with the current sheet as plain text. If the text has not changed, Save sends the stored content unchanged (converting back and forth can lose formatting). An empty box still means "keep the current chords".
- **Multi-add:** Songs are added in the order they were ticked.
- **Setlist items:** `{type:"song", songId, note?}` or `{type:"break", id, label}`. A song can be in a setlist only once (same as today). Song numbers run on across breaks.
- **Old clients:** A write with only `songIds` (from an old open tab or an old cached app) rebuilds the setlist in that order and keeps each kept song's note. Breaks are dropped. This is accepted.
- **Autoscroll speed:** Remembered per song **on each device** (like text size), not shared, because the right speed depends on the screen and the text size.
- **Stage mode:** A "Stage" toggle on the song page hides the top bar and bottom nav and asks for browser fullscreen where it is supported. An "Exit stage" button floats top-right. It stays on while you move between songs in the gig.
- **Unsaved warning:** Applies to the song form only. It uses `window.confirm` on in-app navigation and `beforeunload` on reload/close.
- **Upcoming badge:** For each song, the soonest upcoming gig it is in, shown as `Gig: <name>`.

## Global Constraints

- Don't commit or push. Each task ends with its tests and `npx tsc --noEmit` passing, and then the user reviews and commits (repo convention from the previous plan).
- In Git Bash, first run `export PATH="/c/Program Files/nodejs:$PATH"`.
- The only new dependencies are `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0` and `@dnd-kit/utilities@3.2.2`. Pin them exactly, like the other runtime deps. Leave the rollup `overrides` alone.
- `src/shared/` must not use browser-only or Node-only APIs. All validation goes in `netlify/functions/lib/repo.ts`.
- Stay compatible with stored data and with responses the service worker cached before this change. Gigs that only have `songIds`, must load and render. Do not write a migration script.
- Wrap all `localStorage` and Fullscreen API use in feature checks and `try/catch`. If either is missing, nothing may throw and no error may be shown.
- Touch targets must be at least 44px (`.btn`, `.pill`).
- Keep the existing visible labels that tests depend on: `"1. Alpha — Key: A"`-style rows, "Edit setlist", "Done", "Move up", "Move down", "Remove", "Print setlist", "Save for offline".
- Each task adds one plain-language bullet to `CHANGELOG.md` under a new top heading `## Unreleased`, in the existing voice ("Added" / "Changed").

## Review Focus

1. **A gig stored or offline-cached with only `songIds`** (no `setlist`) still shows its full setlist, and Next/Previous still work. Tests in Task 5 (repo) and Task 6 (GigPage).
2. **An old client PUTs `{songIds}`** to a gig that has notes and breaks. The order is applied, the notes survive, the breaks are dropped, and nothing errors. Test in Task 5.
3. **Saving a song without touching the chords** must not change `content`, even when the content doesn't round-trip (for example `[ch]Am[/ch] intro riff`). Test in Task 3.
4. **Moving to the next song reuses `SongPage`.** The speed must switch to the new song's saved speed instead of carrying over, and stage mode must stay on. Tests in Task 10 and Task 11.
5. **Save or Delete on a changed song form** must navigate without the unsaved-changes prompt. Test in Task 12.

---

## File Map

| File | Change | Responsibility |
|---|---|---|
| `src/app/gigList.ts` | create | `splitGigs`, `upcomingGigBySong` |
| `src/app/pages/GigsPage.tsx` | modify | Upcoming / Past sections; create with `setlist: []` |
| `src/app/pages/SongsPage.tsx` | modify | Key filter, upcoming filter, gig badge |
| `src/shared/sheet.ts` | modify | `plainTextFromMarkup` |
| `src/shared/types.ts` | modify | `SetlistItem`, `Gig.setlist`, `GigInput` |
| `src/shared/setlist.ts` | create | Setlist helpers shared by server and client |
| `netlify/functions/lib/repo.ts` | modify | Validate `setlist`; read legacy gigs |
| `src/app/pages/SongFormPage.tsx` | modify | Prefilled chords, unsaved guard |
| `src/app/pages/GigPage.tsx` | modify | Setlist view: breaks, notes, print |
| `src/app/components/SetlistEditor.tsx` | create | Edit-mode rows: move, remove, note, break, drag |
| `src/app/components/AddSongsPicker.tsx` | create | Search + checkboxes multi-add |
| `src/app/songCache.ts` | modify | `loadSetlist` returns ids + notes |
| `src/app/pages/SongPage.tsx` | modify | Setlist note, per-song speed, stage mode |
| `src/app/components/useSongSpeed.ts` | create | Per-song, per-device autoscroll speed |
| `src/app/components/useStageMode.ts` | create | Body class + fullscreen |
| `src/app/components/useUnsavedChanges.ts` | create | `useBlocker` + `beforeunload` |
| `src/app/App.tsx` | modify | Data router |
| `src/app/styles.css` | modify | Sections, badge, setlist break/note, stage mode, drag handle |

---

### Task 1: Gigs list split into Upcoming and Past

**Files:**
- Create: `src/app/gigList.ts`
- Modify: `src/app/pages/GigsPage.tsx`, `src/app/styles.css`
- Test: `tests/app/gigList.test.ts`, `tests/app/GigPage.test.tsx` (the GigsPage tests live here)

**Interfaces:**
- Produces: `splitGigs(gigs: Gig[], today: string): { upcoming: Gig[]; past: Gig[] }` and `upcomingGigBySong(gigs: Gig[], today: string): Map<string, Gig>`. Task 2 uses the second one.

- [ ] **Step 1: Write failing tests** in `tests/app/gigList.test.ts`

```ts
const g = (name: string, date: string, songIds: string[] = []) => ({ id: name, name, date, songIds, setlist: [] });
it("puts today and later in upcoming, soonest first; earlier in past, newest first", () => {
  const { upcoming, past } = splitGigs(
    [g("A", "2026-12-01"), g("B", "2026-11-20"), g("T", "2026-11-12"), g("P1", "2026-10-01"), g("P2", "2026-11-01")],
    "2026-11-12",
  );
  expect(upcoming.map((x) => x.name)).toEqual(["T", "B", "A"]);
  expect(past.map((x) => x.name)).toEqual(["P2", "P1"]);
});
it("maps each song to the soonest upcoming gig it is in, ignoring past gigs", () => {
  const m = upcomingGigBySong(
    [g("Later", "2026-12-24", ["s1"]), g("Sooner", "2026-11-30", ["s1", "s2"]), g("Old", "2026-01-01", ["s3"])],
    "2026-11-12",
  );
  expect(m.get("s1")?.name).toBe("Sooner");
  expect(m.get("s2")?.name).toBe("Sooner");
  expect(m.has("s3")).toBe(false);
});
```

(The `setlist: []` field is there for type-checking after Task 5. Until Task 5 lands, cast the helper's return value `as Gig`.)

- [ ] **Step 2: Run them to see them fail.** `npx vitest run tests/app/gigList.test.ts` should fail because the module doesn't exist yet.
- [ ] **Step 3: Implement `src/app/gigList.ts`.** If two gigs share a date, sort them by name.
- [ ] **Step 4: Add a GigsPage test.** Use `vi.useFakeTimers({ toFake: ["Date"] })` with `vi.setSystemTime(new Date(2026, 10, 12, 12))`, and list gigs dated `2026-12-20`, `2026-11-15` and `2026-10-01`.
  - `getByRole("region", { name: "Upcoming" })` shows the links in the order 15 Nov, then 20 Dec.
  - `getByRole("region", { name: "Past" })` shows the October gig.
  - A second test: with only past gigs, the Upcoming region shows "No upcoming gigs." When there are no past gigs, there is no Past region.
- [ ] **Step 5: Update GigsPage.** Render two `<section aria-labelledby>` blocks, each with an `<h2>` ("Upcoming", "Past"), using `splitGigs(gigs, todayISO())`. Keep the "No gigs yet. Add the first one." message for the case where there are no gigs at all.
- [ ] **Step 6: Run** `npx vitest run tests/app/gigList.test.ts tests/app/GigPage.test.tsx`. Everything should pass. Then add the CHANGELOG bullet.

### Task 2: Song list key filter and upcoming-gig badge

**Files:**
- Modify: `src/app/pages/SongsPage.tsx`, `src/app/styles.css` (`.badge`: a small pill, `--accent` border, 13px)
- Test: create `tests/app/SongsPage.test.tsx` (mock `api.listSongs` and `api.listGigs`, as `GigPage.test.tsx` does)

**Interfaces:**
- Consumes: `upcomingGigBySong` from Task 1, and `todayISO` from `formatDate.ts`.

- [ ] **Step 1: Write failing tests.** Use songs Alpha (key A), Beta (C) and Gamma (E), and the gig "Winter Show" on 2026-12-20 with songIds `["s1","s2"]`. Fix the date to 2026-11-12.
  - Alpha's row contains "Gig: Winter Show". Gamma's row has no `.badge`.
  - Choose "C" in `getByLabelText("Filter by key")`. Only Beta is listed. The options are "All keys", "A", "C" and "E" (only the keys that are in use, sorted).
  - Tick `getByLabelText("Only songs in upcoming gigs")`. Only Alpha and Beta are listed.
  - If `listGigs` rejects, the songs still list with no error and no badges.
- [ ] **Step 2: Run them to see them fail.** `npx vitest run tests/app/SongsPage.test.tsx`
- [ ] **Step 3: Implement.** Call `api.listGigs()` separately from `listSongs`, and ignore it if it fails. The search, key filter and upcoming filter all combine (AND). Show the badge inside the row's `.grow` span, under the artist.
- [ ] **Step 4: Run the tests again; they should pass.** Then add the CHANGELOG bullet.

### Task 3: Edit chords in place

**Files:**
- Modify: `src/shared/sheet.ts`, `src/app/pages/SongFormPage.tsx`
- Test: `tests/shared/sheet.test.ts`, `tests/app/SongFormPage.test.tsx`

**Interfaces:**
- Produces: `plainTextFromMarkup(markup: string): string`. It removes the `[ch]`/`[/ch]` tags (keeping the chord text) and the `[tab]`/`[/tab]` tags, and leaves section lines such as `[Verse]` as they are.

- [ ] **Step 1: Write failing sheet tests**

```ts
expect(plainTextFromMarkup("[Verse]\n[ch]G[/ch]   [ch]D/F#[/ch]\nHello there")).toBe("[Verse]\nG   D/F#\nHello there");
expect(plainTextFromMarkup("[tab][ch]Am[/ch]\nla[/tab]")).toBe("Am\nla");
const plain = "[Chorus]\nG  D  Em  C\nSing it loud\nAm x2 | C";
expect(markupFromPlainText(plainTextFromMarkup(markupFromPlainText(plain)))).toBe(markupFromPlainText(plain));
```

- [ ] **Step 2: Run them to see them fail.** `npx vitest run tests/shared/sheet.test.ts`
- [ ] **Step 3: Implement `plainTextFromMarkup`.** It's two regex replaces. Normalise `\r\n` the same way `parseSheet` does.
- [ ] **Step 4: Write failing SongFormPage tests** (edit mode, `stored` fixture):
  - The Chords box has the value `"G"` once the page loads.
  - With `content: "[ch]Am[/ch] intro riff"`, clicking Save without touching Chords calls `updateSong` with `content: "[ch]Am[/ch] intro riff"`. This is Review Focus 3.
  - Changing Chords to `"A"` and clicking Save sends `content: "[ch]A[/ch]"`.
  - The preview (`getByTestId("preview")`) shows the current content while you edit.
- [ ] **Step 5: Implement it in SongFormPage.**
  - After the song loads, set `pasted` and a new `initialPlain` state to `plainTextFromMarkup(s.content)`.
  - `content` becomes: `existing` if `editing && pasted === initialPlain`; otherwise `markupFromPlainText(pasted)` if `pasted.trim()`; otherwise `imported ?? existing ?? ""`.
  - The preview shows `content` whenever it is not empty.
  - The edit-mode placeholder is "Fix chords here. Leave empty to keep the current chords".
- [ ] **Step 6: Run** `npx vitest run tests/shared/sheet.test.ts tests/app/SongFormPage.test.tsx`. All tests should pass, including the existing ones; update any assertion that expected the preview to be hidden while pasting. Then add the CHANGELOG bullet.

### Task 4: Removed

Dropped after this plan was written. The number is kept so the other task references still match.

### Task 5: Setlist data model (server + shared)

**Files:**
- Create: `src/shared/setlist.ts`
- Modify: `src/shared/types.ts`, `netlify/functions/lib/repo.ts`
- Test: `tests/shared/setlist.test.ts`, `tests/server/repo.test.ts`, `tests/server/api.test.ts`

**Interfaces:**
- Produces (types.ts):

```ts
export type SetlistItem =
  | { type: "song"; songId: string; note?: string }
  | { type: "break"; id: string; label: string };
export interface Gig { id: string; name: string; date: string; setlist: SetlistItem[]; /** derived, read-only */ songIds: string[] }
export interface GigInput { name: string; date: string; setlist?: SetlistItem[] }
```

- Produces (setlist.ts):
  - `setlistOf(gig: { songIds?: string[]; setlist?: SetlistItem[] }): SetlistItem[]`
  - `songIdsOf(items: SetlistItem[]): string[]`
  - `fromSongIds(songIds: string[], previous: SetlistItem[]): SetlistItem[]`
  - `moveItem<T>(items: T[], from: number, to: number): T[]`
  - `itemKey(item: SetlistItem): string`, which returns `song:<songId>` or `break:<id>`
- Produces (repo.ts): `LIMITS.setlistItems = 150`, `LIMITS.note = 200` and `LIMITS.breakLabel = 100`. `LIMITS.gigSongs = 100` now counts song items.

- [ ] **Step 1: Write failing `setlist.test.ts`.**
  - `setlistOf({songIds:["a","b"]})` returns the two song items.
  - `setlistOf` prefers `setlist` when it is present.
  - `fromSongIds(["b","a"], [{song a, note "x"}, {break}, {song b}])` returns `[{song b}, {song a, note "x"}]`.
  - `moveItem([1,2,3], 0, 2)` returns `[2,3,1]`.
- [ ] **Step 2: Write failing repo tests.**
  - **Legacy read (Review Focus 1).** Write `{id:"x",name:"Pub",date:"2026-12-01",songIds:[a,b]}` straight to the KV. `getGig("x")` and `listGigs()` return the two song items as `setlist`, and `songIds` `[a,b]`.
  - **Round trip.** Update with a setlist that contains a note and a break. Reading it back gives the same setlist, with `songIds` leaving out the break. The note is trimmed, and an empty note is left out.
  - **Legacy write (Review Focus 2).** On that gig, `updateGig(id, {songIds:[b,a]})` gives `[{song b},{song a, note}]`.
  - **Rejected (each with `ValidationError`):** setlist not an array; an item with an unknown `type`; a duplicate songId ("a song can only be in the setlist once"); 101 songs; 151 items; a note over 200 characters; a blank break label ("break label is required"); a break label over 100 characters; a break id that is not a string.
  - Unknown keys on items are stripped.
  - `createGig({name,date})` with no setlist gives `setlist: []`. The existing `createGig({…, songIds})` tests still pass.
  - `deleteSong` removes the song item and keeps the breaks.
  - `getGig` drops songs that have been deleted from `setlist` and from `songIds`.
- [ ] **Step 3: Add a failing API test.** `PUT /api/gigs/:id` with `{setlist}` returns 200 with matching `songIds`.
- [ ] **Step 4: Run them to see them fail.** `npx vitest run tests/shared/setlist.test.ts tests/server`
- [ ] **Step 5: Implement.**
  - `GIG_FIELDS` becomes `["name","date","setlist"]`.
  - `cleanGig(input, partial, current: SetlistItem[] = [])`: if `setlist` is missing but `songIds` is present, validate it as before and then convert it with `fromSongIds(v, current)`.
  - Store `{id,name,date,setlist}`. Convert every read with a `toGig(stored)` helper (`setlistOf` + `songIdsOf`).
- [ ] **Step 6: Type-check the client.** Run `npx tsc --noEmit`. Change `GigsPage` to create gigs with `{ name, date, setlist: [] }`, and add `setlist` to the test fixtures that build `Gig` objects. `offline.ts` and `songCache.ts` keep using `gig.songIds`.
- [ ] **Step 7: Run** `npm test`. Everything should pass. Then add the CHANGELOG bullet (under Changed: gigs keep their notes and breaks).

### Task 6: Gig page shows and edits breaks and notes

**Files:**
- Create: `src/app/components/SetlistEditor.tsx`
- Modify: `src/app/pages/GigPage.tsx`, `src/app/styles.css` (`.setlist-break`, `.setlist-note`, `.print-break`)
- Test: `tests/app/GigPage.test.tsx`

**Interfaces:**
- Consumes: everything in `setlist.ts` (Task 5)..
- Produces: `SetlistEditor({ items, songs, busy, onChange }: { items: SetlistItem[]; songs: Map<string, SongSummary>; busy: boolean; onChange: (items: SetlistItem[]) => void })`. Tasks 8 and 9 extend it.

- [ ] **Step 1: Update the fixtures and write failing tests.** Give the `gig` fixture `setlist`.
  - **View mode.** With setlist `[s1 (note "Klarence count-in"), break "Set 2", s2]`, the page shows "1. Alpha — Key: A", "Klarence count-in", "Set 2" and "2. Beta — Key: C".
  - **Legacy gig (Review Focus 1).** A gig object with only `songIds` (no `setlist`) still lists its songs.
  - **Notes in edit mode.** Change `getByLabelText("Note for Alpha")` and blur it. `updateGig` is called with `{ setlist: [{type:"song",songId:"s1",note:"Segue"}, …] }`. Clearing the note removes the `note` key.
  - **Breaks in edit mode.** "Add set break" calls `updateGig` with a last item `{type:"break", label:"Set 2", id: expect.any(String)}`. `getByLabelText("Label for Set 2")` saves on blur, and the break has its own "Move up", "Move down" and "Remove" buttons.
  - **Existing tests.** Update the move/remove tests to expect `{ setlist: [...] }` payloads.
  - **Print.** The print list includes `— SET 2 —`.
- [ ] **Step 2: Run them to see them fail.** `npx vitest run tests/app/GigPage.test.tsx`
- [ ] **Step 3: Implement.**
  - GigPage keeps `items = setlistOf(gig)` filtered to songs that exist, and changes `save(items: SetlistItem[])` to call `api.updateGig(id, { setlist: items })`. Update optimistically (`songIds: songIdsOf(items)`) and roll back on error, as it does now.
  - View-mode rows stay in GigPage. The edit rows move into `SetlistEditor`.
  - New break ids come from `crypto.randomUUID()`.
  - A note or label is saved only on blur, and only if the trimmed value changed.
- [ ] **Step 4: Run the tests again; they should pass.** Then run `npx tsc --noEmit` and add the CHANGELOG bullet.

### Task 7: Song page shows the setlist note

**Files:**
- Modify: `src/app/songCache.ts`, `src/app/pages/SongPage.tsx`, `src/app/styles.css`
- Test: `tests/app/SongPage.test.tsx`, `tests/app/songCache.test.ts`, `tests/app/GigPage.test.tsx` (wherever `loadSetlist` is asserted)

**Interfaces:**
- Produces: `loadSetlist(gigId: string): Promise<{ ids: string[]; notes: Record<string, string> }>`. Deleted songs are still skipped, as now.

- [ ] **Step 1: Write failing tests.**
  - `loadSetlist` returns `{ ids: ["s1","s2"], notes: { s1: "Klarence count-in" } }`, and works with a legacy gig that has only `songIds`.
  - SongPage opened at `/songs/s1?gig=g1` shows "Klarence count-in". On s2 it doesn't.
  - Without `?gig`, no note is shown.
- [ ] **Step 2: Run them to see them fail.** `npx vitest run tests/app/songCache.test.ts tests/app/SongPage.test.tsx`
- [ ] **Step 3: Implement.** Show the note as `<p className="setlist-note" role="note">` just above `.song-info`. Update the existing callers and tests from `ids` to `.ids`.
- [ ] **Step 4: Run the tests again; they should pass.** Then add the CHANGELOG bullet.

### Task 8: Add several songs at once

**Files:**
- Create: `src/app/components/AddSongsPicker.tsx`
- Modify: `src/app/components/SetlistEditor.tsx` (render the picker under the rows, replacing the "Song to add" select and the "Add song" button in GigPage)
- Test: create `tests/app/AddSongsPicker.test.tsx`; update `tests/app/GigPage.test.tsx`

**Interfaces:**
- Produces: `AddSongsPicker({ songs, busy, onAdd }: { songs: SongSummary[]; busy: boolean; onAdd: (ids: string[]) => void })`. `songs` holds the songs that are not in the setlist yet, sorted by title.

- [ ] **Step 1: Write failing tests.** Use songs Alpha, Delta and Gamma.
  - Typing "gam" in `getByLabelText("Find songs to add")` shows only Gamma's checkbox (labelled "Gamma — A"). The search matches title or artist.
  - Tick Gamma, then Delta. The button reads "Add 2 songs", and clicking it calls `onAdd(["s3","s4"])`, in the order they were ticked.
  - A ticked song stays ticked after the search text changes.
  - The button reads "Add songs" and is disabled when nothing is ticked, or while `busy`.
  - After adding, the selection and the search are cleared.
  - GigPage: picking two songs calls `updateGig` with both appended as song items.
- [ ] **Step 2: Run them to see them fail.** `npx vitest run tests/app/AddSongsPicker.test.tsx tests/app/GigPage.test.tsx`
- [ ] **Step 3: Implement.** Make the list a scrollable box (`max-height: 50vh`) with rows at least 44px tall.
- [ ] **Step 4: Run the tests again; they should pass.** Then add the CHANGELOG bullet.

### Task 9: Drag to reorder the setlist

**Files:**
- Modify: `package.json` (add the three pinned `@dnd-kit` packages), `src/app/components/SetlistEditor.tsx`, `src/shared/setlist.ts`, `src/app/styles.css` (`.drag-handle`: 44×44px, `touch-action: none`, `cursor: grab`)
- Test: `tests/shared/setlist.test.ts`, `tests/app/GigPage.test.tsx`

**Interfaces:**
- Produces: `reorderByKeys(items: SetlistItem[], activeKey: string, overKey: string): SetlistItem[] | null`. It returns `null` when the item didn't move or a key is unknown.

- [ ] **Step 1: Write failing tests.**
  - `reorderByKeys([a, break1, b], "song:b", "song:a")` returns `[b, a, break1]`.
  - The same key twice returns `null`, and so does an unknown key.
  - GigPage in edit mode shows `getByRole("button", { name: "Drag Alpha" })` and `"Drag Set 2"`. There are no drag handles in view mode.
- [ ] **Step 2: Run them to see them fail.** `npx vitest run tests/shared/setlist.test.ts tests/app/GigPage.test.tsx`
- [ ] **Step 3: Install** with `npm install --save-exact @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2`.
- [ ] **Step 4: Implement drag in `SetlistEditor`.**
  - Wrap the rows in `DndContext` and a `SortableContext` (`verticalListSortingStrategy`, ids from `itemKey`).
  - Each row uses `useSortable`, with the listeners on the handle only, so the page can still scroll.
  - Sensors: `PointerSensor` with `{ activationConstraint: { distance: 4 } }`, and `KeyboardSensor` with `sortableKeyboardCoordinates`.
  - `onDragEnd` calls `reorderByKeys`; if the result isn't `null`, pass it to `onChange`.
  - Disable dragging while `busy`. Keep the Move up / Move down buttons for accessibility.
- [ ] **Step 5: Verify.** Run `npm test` and `npm run build`; both should pass. Then check by hand in `npm run dev`, with a phone-sized viewport: dragging by the handle reorders, and swiping elsewhere scrolls. Add the CHANGELOG bullet.

### Task 10: Remember autoscroll speed per song

**Files:**
- Create: `src/app/components/useSongSpeed.ts`
- Modify: `src/app/pages/SongPage.tsx` (remove the local `SPEEDS` / `speedIdx`)
- Test: create `tests/app/useSongSpeed.test.ts`; update `tests/app/SongPage.test.tsx`

**Interfaces:**
- Produces:
  - `SPEEDS = [0.5, 1, 1.5, 2, 3] as const`
  - `DEFAULT_SPEED = 1`
  - `speedKey(songId: string): string`, which returns `` `stereo-set:scroll-speed:${songId}` ``
  - `useSongSpeed(songId: string): { speed: number; cycle: () => void }`

- [ ] **Step 1: Write failing tests** (with `renderHook`).
  - The default is 1. `cycle()` gives 1.5 and stores `"1.5"` under `speedKey("s1")`.
  - After 3, cycling wraps round to 0.5.
  - **Review Focus 4.** Rerender from `"s1"` (saved 2) to `"s2"` (nothing saved) and the speed is 1. Back on `"s1"` it is 2.
  - A stored value of `"7"` or `"abc"` gives 1. If `getItem` or `setItem` throws, the speed is 1 and `cycle` still changes the speed for this visit.
  - SongPage: with `"2"` saved for s1, the page shows "Speed: 2".
- [ ] **Step 2: Run them to see them fail.** `npx vitest run tests/app/useSongSpeed.test.ts tests/app/SongPage.test.tsx`
- [ ] **Step 3: Implement.** Store the speed as `{ songId, speed }` state. When `songId` changes, return the freshly read value during that render (don't wait for an effect), so a song never scrolls at the previous song's speed.
- [ ] **Step 4: Run the tests again; they should pass.** Then add the CHANGELOG bullet.

### Task 11: Stage mode

**Files:**
- Create: `src/app/components/useStageMode.ts`
- Modify: `src/app/pages/SongPage.tsx`, `src/app/styles.css`
- Test: create `tests/app/useStageMode.test.ts`; update `tests/app/SongPage.test.tsx`

**Interfaces:**
- Produces: `useStageMode(): { on: boolean; toggle: () => void }`. While `on`, `document.body` has the class `stage`.

- [ ] **Step 1: Write failing tests.**
  - `toggle()` adds the `stage` body class and calls `document.documentElement.requestFullscreen` (a stub). Toggling again removes the class and calls `document.exitFullscreen` when `document.fullscreenElement` is set.
  - With no `requestFullscreen`, toggling still adds the class and nothing throws. A rejected `requestFullscreen` promise is swallowed.
  - If the browser leaves fullscreen (set `fullscreenElement` to null and dispatch `fullscreenchange`) after the hook entered it, stage mode turns off.
  - Unmounting removes the class.
  - **SongPage (Review Focus 4).** Click `getByRole("button", { name: "Stage" })` (`aria-pressed="true"`), then follow "Next song". The body still has `stage`, and "Exit stage" is visible. Clicking "Exit stage" removes the class.
- [ ] **Step 2: Run them to see them fail.** `npx vitest run tests/app/useStageMode.test.ts tests/app/SongPage.test.tsx`
- [ ] **Step 3: Implement.**
  - CSS: `body.stage .topbar, body.stage .bottom-nav { display: none; }` and `body.stage { padding-bottom: 0; }`.
  - `.stage-exit`: `position: fixed; top: 8px; right: 8px`, 44px tall, semi-transparent surface, `z-index` above the sheet.
  - Add the "Stage" pill to `.pill-row` after Transpose.
- [ ] **Step 4: Run the tests again; they should pass.** Then add the CHANGELOG bullet.

### Task 12: Warn before leaving the song form with unsaved changes

**Files:**
- Create: `src/app/components/useUnsavedChanges.ts`
- Modify: `src/app/App.tsx`, `src/app/pages/SongFormPage.tsx`
- Test: create `tests/app/useUnsavedChanges.test.tsx`; update `tests/app/SongFormPage.test.tsx`

**Interfaces:**
- Produces:
  - `UNSAVED_MESSAGE = "You have unsaved changes. Leave without saving?"`
  - `useUnsavedChanges(when: boolean): { allowNavigation: () => void }`. It must be used inside a data router. `allowNavigation()` lets the next navigation through without asking.
- App: `App` builds its router once with `useState(() => createBrowserRouter([{ path: "*", element: <AppRoutes /> }]))` and renders `<RouterProvider>`. `AppRoutes` is unchanged, so `App.test.tsx` still renders it inside `MemoryRouter`.

- [ ] **Step 1: Write failing tests.** Switch the `SongFormPage.test.tsx` render helpers to `createMemoryRouter(routes, { initialEntries })` and `<RouterProvider>`, and keep a reference to the router.
  - **Not dirty.** `router.navigate("/songs")` goes there without calling `window.confirm`.
  - **Dirty, cancelled.** After editing Title, `router.navigate("/songs")` calls `window.confirm(UNSAVED_MESSAGE)`. If confirm returns `false`, the form stays.
  - **Dirty, confirmed.** If confirm returns `true`, you end up on the songs list.
  - **Review Focus 5.** On a dirty form, Save goes to `/songs/:id` without calling confirm, and so does Delete (after its own delete confirmation).
  - **Reload/close.** While dirty, dispatching `new Event("beforeunload", { cancelable: true })` on `window` leaves `defaultPrevented` set to `true`. When not dirty, it is `false`.
- [ ] **Step 2: Run them to see them fail.** `npx vitest run tests/app/SongFormPage.test.tsx tests/app/useUnsavedChanges.test.tsx`
- [ ] **Step 3: Implement.**
  - The hook: `useBlocker(() => when && !allowRef.current)`. When the blocker's state is `"blocked"`, call `window.confirm(UNSAVED_MESSAGE)`, then `blocker.proceed()` or `blocker.reset()`. While `when` is true, add a `beforeunload` listener that calls `preventDefault()`.
  - SongFormPage: `dirty` compares a snapshot of `{title, artist, link, originalKey, bandKey, capo, pasted}` against the snapshot taken after loading (edit) or the initial blanks (new). Call `allowNavigation()` just before the `navigate` in `save` and in `removeSong`.
- [ ] **Step 4: Swap the router in `App.tsx`.** Run `npm test` and `npm run build`; both should pass. Then check by hand in `npm run dev`:
  - Edit a song, tap "Songs" in the bottom nav, and the prompt appears.
  - Save, and there's no prompt.
  - Reload while dirty, and the browser's own prompt appears.
- [ ] **Step 5: Add the CHANGELOG bullet.**
