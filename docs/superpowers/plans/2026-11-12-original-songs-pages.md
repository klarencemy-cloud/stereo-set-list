# Original Songs: Title Autofill, Song Pages, and Songs-List Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an uploaded original song (mp3) a full song: the upload form autofills the title from the file name without overwriting typed titles, each original song opens its own page where it can be played, edited, and given lyrics/chords, and it shows up in the Songs list.

**Architecture:** An original song is a normal `Song` record linked to its `Track` (the mp3) — `Song.trackId` ↔ `Track.songId`. The server creates the linked song when the last mp3 part lands (so half-finished uploads never appear in Songs), keeps titles in sync both ways, and deletes the pair together. The "own place" for an original song is the existing `/songs/:id` page (chord sheet, Edit, transpose, autoscroll) plus an audio player when the song has a track; lyrics and chords are edited with the existing `SongFormPage`.

**Tech Stack:** React 18 + react-router, Netlify Functions, Netlify Blobs (`KV`), Vitest + Testing Library.

**Spec:** The user request (2026-11-12), restated:
1. Upload form: picking a file fills the title from the file name **only if the title is empty**; a title the user typed first is kept.
2. Currently a track can be played, renamed, downloaded, deleted. Each original song should be **clickable and open its own page**, where we can **edit and add lyrics and chords**.
3. An added original song should **also appear in the Songs list**.

## Global Constraints

- `src/shared/` stays free of browser/Node APIs; functions import it via relative paths.
- All validation and persistence lives in `netlify/functions/lib/repo.ts`; server tests use `memoryKV()`.
- `trackId` is server-managed: it is never accepted from a client in `SongInput` (not added to `SONG_FIELDS`).
- Songs created for an upload use: `title` = track title, `artist` = `""`, `sourceUrl` = `null`, `originalKey` = `"C"`, `bandKey` = `"C"`, `capo` = `0`, `content` = `""`.
- Existing tracks without a linked song must keep working (lazy-linked on first open; see Task 3).
- Don't touch the `@rollup/wasm-node` override in `package.json`.
- `npm run build` (type-check) and `npm test` must pass at the end of every task.

## Review Focus

1. **Legacy tracks** (uploaded before this change, no `songId`): clicking one must create/link its song once and open it — never create two songs on double-click. → idempotency test in Task 2 (`linkTrackSong` twice returns the same song).
2. **Rename from either side**: renaming in Original Songs, or editing the title in the song form, must leave both records with the same title. → tests in Task 2.
3. **Deleting from either side** removes both the song (and its setlist entries) and the mp3; the confirm text must say the mp3 goes too. → repo tests in Task 2, UI copy test in Task 4.
4. **Picking a second file after autofill**: if the title still equals the previous autofill, it updates to the new file name; if the user edited it, it stays. → test in Task 1.
5. **Song page offline / track fetch fails**: the chord sheet still renders; only the player shows an error. → test in Task 4.

---

### Task 1: Title autofill from the file name

**Files:**
- Modify: `src/app/upload.ts` (add helper)
- Modify: `src/app/pages/TracksPage.tsx` (file input `onChange`)
- Test: `tests/app/upload.test.ts`, `tests/app/TracksPage.test.tsx`

**Interfaces:**
- Produces: `titleFromFileName(name: string): string` in `src/app/upload.ts`.

- [ ] **Step 1: Write failing tests**

`tests/app/upload.test.ts`:
```ts
describe("titleFromFileName", () => {
  it("drops the extension and tidies separators", () => {
    expect(titleFromFileName("My Song.mp3")).toBe("My Song");
    expect(titleFromFileName("my_new-song.MP3")).toBe("my new-song");
    expect(titleFromFileName("  Demo  .mp3")).toBe("Demo");
    expect(titleFromFileName("no-extension")).toBe("no-extension");
    expect(titleFromFileName(".mp3")).toBe("");
  });
});
```

`tests/app/TracksPage.test.tsx` (new `describe("TracksPage upload title")`; select the file input by its label `mp3 file (max 25 MB)`, fire `change` with `{ target: { files: [new File(["x"], "Demo Take.mp3", { type: "audio/mpeg" })] } }`):
- `it("fills an empty title from the file name")` → Title input value is `"Demo Take"`.
- `it("keeps a title the user typed before picking the file")` → type `"Real Name"`, pick file → value stays `"Real Name"`.
- `it("replaces an autofilled title when another file is picked")` → pick `"A.mp3"` then `"B.mp3"` → `"B"`.
- `it("keeps an edited autofilled title when another file is picked")` → pick `"A.mp3"`, change title to `"A live"`, pick `"B.mp3"` → `"A live"`.

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/app/upload.test.ts tests/app/TracksPage.test.tsx`
Expected: FAIL (`titleFromFileName` is not exported; title stays empty).

- [ ] **Step 3: Implement**

`titleFromFileName`: strip a trailing `.<ext>` (case-insensitive), replace `_` with space, collapse whitespace, trim.

In `TracksPage`, add `const autoTitle = useRef("")`. In the file input `onChange`: after `setFile(f)`, if `f` and (`title.trim() === ""` or `title === autoTitle.current`), set `autoTitle.current = titleFromFileName(f.name)` and `setTitle(autoTitle.current)`. Clear `autoTitle.current` after a successful upload.

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run tests/app/upload.test.ts tests/app/TracksPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/upload.ts src/app/pages/TracksPage.tsx tests/app/upload.test.ts tests/app/TracksPage.test.tsx
git commit -m "feat: autofill original song title from the mp3 file name"
```

---

### Task 2: Link tracks to songs on the server

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `netlify/functions/lib/repo.ts`
- Modify: `netlify/functions/tracks.ts`
- Modify: `src/app/api.ts`
- Test: `tests/server/repo.test.ts`, `tests/server/api.test.ts`

**Interfaces:**
- Produces (types):
  - `Song.trackId?: string | null` — set when the song is an original song. Missing on older songs = `null`.
  - `SongInput = Omit<Song, "id" | "updatedAt" | "trackId">` (clients can't set it). `SongSummary` keeps `trackId`.
  - `Track.songId?: string | null`.
- Produces (repo):
  - `getTrack(id: string): Promise<Track | null>`
  - `linkTrackSong(trackId: string): Promise<Song>` — idempotent: returns the existing linked song if `track.songId` points at a song that exists; otherwise creates one (Global Constraints defaults), writes `song.trackId` and `track.songId`. Throws `NotFoundError` for an unknown track, `ValidationError("upload is not finished")` if `uploadedParts !== parts`.
- Produces (HTTP):
  - `GET /api/tracks/:id` → `Track` (404 if unknown).
  - `POST /api/tracks/:id/song` → `Song` (the linked song; creates it if missing).
- Produces (client): `api.getTrack(id: string): Promise<Track>`, `api.linkTrackSong(id: string): Promise<Song>`.

- [ ] **Step 1: Write failing repo tests** (`tests/server/repo.test.ts`, new `describe("original songs")`; upload helper = `createTrack` + `putTrackPart` for every part)

- `it("creates a linked song when the last part is uploaded")` → after the final `putTrackPart`, `getTrack(id).songId` is set; `getSong(songId)` has `title` = track title, `trackId` = track id, `content: ""`, `originalKey: "C"`, `bandKey: "C"`, `artist: ""`; `listSongs()` includes it.
- `it("does not create a song while the upload is unfinished")` → 2-part track, 1 part uploaded → `listSongs()` is empty.
- `it("linkTrackSong is idempotent")` → call twice on the same track → same song id, `listSongs().length === 1`.
- `it("linkTrackSong links a legacy track without a song")` → write a finished track directly with no `songId`, call `linkTrackSong` → returns song with `trackId`.
- `it("relinks if the linked song was removed")` → delete the song's KV key directly, `linkTrackSong` → new song, track's `songId` updated.
- `it("renaming a track renames its song")` → `renameTrack(id, "New")` → `getSong(songId).title === "New"`.
- `it("changing an original song's title renames its track")` → `updateSong(songId, { title: "Newer" })` → `getTrack(id).title === "Newer"`; `updateSong` with no `title` leaves the track untouched.
- `it("deleting a track deletes its song and removes it from setlists")` → put the song in a gig, `deleteTrack(id)` → `getSong` null, gig setlist no longer has it, `audio/<id>/` keys gone.
- `it("deleting an original song deletes its track and audio")` → `deleteSong(songId)` → `getTrack(id)` null, `listTracks()` empty, `audio/<id>/` keys gone.
- `it("clients cannot set trackId")` → `createSong({ ...validInput, trackId: "x" } as any)` → stored song has no `trackId`.

- [ ] **Step 2: Write failing API tests** (`tests/server/api.test.ts`, inside `describe("tracks API")`)

- `it("GET /api/tracks/:id returns the track, 404 for unknown")`
- `it("POST /api/tracks/:id/song returns the linked song; 404 unknown; 400 unfinished")`

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run tests/server`
Expected: FAIL (`linkTrackSong`/`getTrack` missing, no song created).

- [ ] **Step 4: Implement**

- `types.ts`: fields above.
- `repo.ts`:
  - `createSong` and `updateSong` keep using `cleanSong` (drops unknown fields, so `trackId` is never accepted); `updateSong` keeps the stored `trackId` from `cur`.
  - `putTrackPart`: after writing `uploadedParts`, if it now equals `parts`, call `linkTrackSong(id)`.
  - `renameTrack`: if `songId` points at an existing song, write that song's `title` (and `updatedAt`) too.
  - `updateSong`: if the patch has `title` and `cur.trackId` points at an existing track, write the track's `title` too.
  - Factor the existing gig-cleanup loop in `deleteSong` into an internal `removeSongEverywhere(id)`; `deleteSong` additionally deletes the linked track's audio + record; `deleteTrack` additionally calls `removeSongEverywhere(track.songId)` when that song exists. Avoid mutual recursion (each deletes the other's records directly).
  - `purgeAbandonedTracks` is unchanged (unfinished tracks never have a song).
- `tracks.ts`: `sub === undefined && GET` → `getTrack` (404 via `NotFoundError` if null). `sub === "song"` with `num === undefined` and `POST` → `json(await repo.linkTrackSong(id))`; other methods → 405. Keep the `parts` branch as is.
- `api.ts`: `getTrack`, `linkTrackSong`.

- [ ] **Step 5: Run to confirm pass**

Run: `npx vitest run tests/server && npm run build`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts netlify/functions/lib/repo.ts netlify/functions/tracks.ts src/app/api.ts tests/server
git commit -m "feat: link each original song mp3 to a song record"
```

---

### Task 3: Original Songs list rows open the song page

**Files:**
- Modify: `src/app/pages/TracksPage.tsx`
- Test: `tests/app/TracksPage.test.tsx`

**Interfaces:**
- Consumes: `Track.songId`, `api.linkTrackSong(id): Promise<Song>` (Task 2).

- [ ] **Step 1: Write failing tests** (render inside `MemoryRouter` with routes `/tracks` and `/songs/:id` → `<p>song page {id}</p>`; add `linkTrackSong` to the mocked api)

- `it("the title links to the song page")` → track with `songId: "s1"`; click link named `"Demo Song"` → shows `song page s1`; `linkTrackSong` not called.
- `it("links a legacy track before opening it")` → track without `songId`, `linkTrackSong` resolves `{ id: "s9", ... }`; click title → `linkTrackSong("t1")` called once, shows `song page s9`.
- `it("shows an error if linking fails")` → `linkTrackSong` rejects `new Error("nope")` → alert `nope`, stays on the list.
- Existing rename/play/download/delete tests still pass (wrap them in `MemoryRouter`).

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/app/TracksPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

Replace `<strong>{t.title}</strong>` with `<Link to={`/songs/${t.songId}`}>` when `t.songId` is set, otherwise a link-styled `<button>` whose click awaits `api.linkTrackSong(t.id)` then `navigate(`/songs/${song.id}`)` (disable while pending to block double-clicks). Keep Play, Rename, Download, Delete. Update the delete confirm to `Delete "${t.title}"? This also deletes its song page, lyrics and chords.`

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run tests/app/TracksPage.test.tsx tests/app/App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/TracksPage.tsx tests/app/TracksPage.test.tsx
git commit -m "feat: open an original song's page from the Original Songs list"
```

---

### Task 4: Song page player, empty-sheet hint, and form/delete copy for original songs

**Files:**
- Create: `src/app/components/TrackPlayer.tsx`
- Modify: `src/app/pages/SongPage.tsx`
- Modify: `src/app/pages/SongFormPage.tsx` (delete confirm copy)
- Test: `tests/app/SongPage.test.tsx`, `tests/app/SongFormPage.test.tsx`

**Interfaces:**
- Consumes: `Song.trackId`, `api.getTrack` (Task 2), `loadTrackUrl`, `downloadFileName` (`src/app/upload.ts`).
- Produces: `TrackPlayer({ trackId }: { trackId: string })` default export — Play button (loads the mp3 on click, not on page open, to save mobile data), then `<audio controls autoPlay>`; Download button; revokes object URLs on unmount; shows its own `role="alert"` error.

- [ ] **Step 1: Write failing tests**

`tests/app/SongPage.test.tsx`:
- `it("shows a player for an original song")` → song with `trackId: "t1"` → button `"Play recording"` present; click → `getTrack("t1")` then `getTrackPart` called; an `audio` element appears.
- `it("has no player for a regular song")` → no `trackId` → no `"Play recording"` button.
- `it("keeps the chord sheet when the recording can't load")` → `getTrack` rejects → alert shown, title and sheet still render.
- `it("hints how to add lyrics when the sheet is empty")` → `content: ""` → text `No lyrics or chords yet — tap Edit to add them.`

`tests/app/SongFormPage.test.tsx`:
- `it("warns that deleting an original song deletes the recording")` → editing a song with `trackId` → click "Delete song" → `window.confirm` called with a message containing `This also deletes the mp3.`

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/app/SongPage.test.tsx tests/app/SongFormPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

- `TrackPlayer.tsx` per the Interfaces block (lift the play/download logic out of `TracksPage` only if it stays simple; otherwise duplicate the ~20 lines — YAGNI on a shared hook).
- `SongPage.tsx`: render `{song.trackId && <TrackPlayer trackId={song.trackId} />}` between `.song-info` and the chord sheet; when `song.content.trim() === ""`, render `<p className="muted">No lyrics or chords yet — tap Edit to add them.</p>` instead of `ChordSheet`. Hide the artist line when `song.artist` is empty (originals default to `""`).
- `SongFormPage.tsx`: keep the loaded `trackId` in state; delete confirm becomes `Delete "${title}"? This also deletes the mp3. This cannot be undone.` when set. After deleting, navigate to `/tracks` if it was an original song, else `/songs`.

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run tests/app`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/components/TrackPlayer.tsx src/app/pages/SongPage.tsx src/app/pages/SongFormPage.tsx tests/app/SongPage.test.tsx tests/app/SongFormPage.test.tsx
git commit -m "feat: play original songs on their song page"
```

---

### Task 5: Mark original songs in the Songs list, changelog

**Files:**
- Modify: `src/app/pages/SongsPage.tsx`
- Modify: `src/app/styles.css` (only if the existing `.badge` style doesn't fit)
- Modify: `CHANGELOG.md`
- Test: `tests/app/SongsPage.test.tsx`

**Interfaces:**
- Consumes: `SongSummary.trackId` (Task 2).

- [ ] **Step 1: Write failing test**

- `it("labels original songs")` → `listSongs` returns one song with `trackId: "t1"` and one without → exactly one element with text `Original`, inside the first song's row.
- `it("finds original songs with the search box")` → searching its title shows it (guards against filtering it out).

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/app/SongsPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

In the row, render `{s.trackId && <span className="badge">Original</span>}` next to the gig badge; don't render the empty artist line when `s.artist` is `""`. Add an "Unreleased" entry to `CHANGELOG.md` covering: title autofill, original song pages with playback, lyrics/chords editing, Songs-list integration, linked rename/delete.

- [ ] **Step 4: Full verification**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds.

Manual check with `npm run dev` (http://localhost:8888): type a title then pick a file → title kept; clear title, pick file → autofilled; upload → row title is a link → song page plays the mp3 → Edit → paste chords → save → sheet shows; Songs tab lists it with "Original"; rename on either side updates both; delete from song form removes it from Original Songs.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/SongsPage.tsx src/app/styles.css CHANGELOG.md tests/app/SongsPage.test.tsx
git commit -m "feat: show original songs in the Songs list"
```
