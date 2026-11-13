# Spotify Playlist Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste a Spotify playlist link when creating (or on) a gig. Every ticked track becomes a song, reusing any that already exist, and goes into the setlist in order. Chords are added later with a UG import that now also works on Edit song.

**Architecture:** A new `lib/spotify.ts` reads the public embed page server-side, the same way `lib/ug.ts` reads UG pages, behind `POST /api/playlist`. `repo.importSongs` does reuse-or-create behind `POST /api/songs/batch`. A shared `songMatchKey` keeps client and server matching the same. A `PlaylistImport` component shows the preview with ticks, and both GigsPage and GigPage use it.

**Tech Stack:** React 18, react-router, Netlify Functions, Netlify Blobs, Vitest (jsdom for `tests/app/**`).

**Spec:** `docs/superpowers/specs/2026-11-13-spotify-playlist-import-design.md`

## Global Constraints

- `src/shared/` stays free of browser/Node APIs. Functions import it via `../../src/shared/...`.
- Never clear what the user entered (link, ticks, pasted text, gig name and date) until the save resolved `true`/succeeded. A failed save leaves it in place.
- No placeholder data: imported songs are `{ sourceUrl: null, originalKey: "", bandKey: "", capo: 0, content: "" }`. A missing key displays as `?` or nothing.
- At most `LIMITS.gigSongs` (100) tracks per import.
- Titles and artists are stored exactly as Spotify gives them (trimmed only).
- User-facing copy (exact): `Import Playlist`, `Spotify playlist`, `Load`, `Paste track list`, `in Songs`, `new`, `in setlist`, `No chords yet`, `Spotify only shows the first 100 tracks.`, `That link isn't a Spotify playlist`, `Couldn't read that playlist. Paste the track list instead.`
- Don't add redirect rules to `netlify.toml`. Leave the Rollup override in `package.json` alone.

## Review Focus

1. **Gig save fails after the songs were created** (two requests). Expect: the error is shown, the form keeps every input, and pressing Create again doesn't duplicate songs. Test in Task 6.
2. **A track is duplicated inside the playlist, or a track matches an existing song only by case or spacing.** Expect: one song, used once in the setlist. Tests in Task 1 and Task 3.
3. **Import Playlist on a gig whose setlist already holds some of the tracks.** Expect: those rows show `in setlist`, can't be ticked, and are not added again (the server rejects duplicates). Test in Task 7.
4. **Edit-page UG import on a song that already has a band key.** Expect: the band key is kept, the title and artist are kept, and nothing is saved until Save. Test in Task 8.
5. **Spotify returns 200 with no playlist** (a bad or private id; I verified this happens). Expect: a `parse` error → the friendly message and the paste box. Test in Task 4.

---

### Task 1: Shared playlist helpers

**Files:**
- Create: `src/shared/playlist.ts`
- Test: `tests/shared/playlist.test.ts`

**Interfaces:**
- Produces: `interface PlaylistTrack { title: string; artist: string }`, `songMatchKey(title: string, artist: string): string`, `parseTrackList(text: string): PlaylistTrack[]`, `uniqueTracks(tracks: PlaylistTrack[]): PlaylistTrack[]` (first occurrence wins, by `songMatchKey`).

- [ ] **Step 1: Write the failing tests**

```ts
it("matches ignoring case and extra spaces", () => {
  expect(songMatchKey("  Mr.  Brightside ", "The KILLERS")).toBe(songMatchKey("mr. brightside", "the killers"));
  expect(songMatchKey("A", "B")).not.toBe(songMatchKey("A B", ""));
});
it("parses Title - Artist lines, splitting on the last separator", () => {
  expect(parseTrackList("Song 2 - Live - Blur\n\n  Yellow – Coldplay  \nUntitled\n")).toEqual([
    { title: "Song 2 - Live", artist: "Blur" },
    { title: "Yellow", artist: "Coldplay" },
    { title: "Untitled", artist: "" },
  ]);
});
it("drops repeated tracks, keeping the first", () => {
  expect(uniqueTracks([{ title: "A", artist: "x" }, { title: "a ", artist: "X" }, { title: "B", artist: "x" }]))
    .toEqual([{ title: "A", artist: "x" }, { title: "B", artist: "x" }]);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/shared/playlist.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** `songMatchKey` must not be able to confuse title and artist: join the normalised parts with `"\u0000"`. Separators are `" - "` and `" – "`; use whichever occurs last in the line.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit `feat: shared playlist helpers` (include the spec file `docs/superpowers/specs/2026-11-13-spotify-playlist-import-design.md` and this plan in this commit).

### Task 2: Songs may have no key

**Files:**
- Modify: `netlify/functions/lib/repo.ts` (`withKeys`, ~line 86)
- Modify: `src/app/pages/SongFormPage.tsx` (`canSave`, line 121)
- Test: `tests/server/repo.test.ts` (the case near line 63 that expects `originalKey: ""` to be rejected), `tests/app/SongFormPage.test.tsx` (the tests "saves pasted text … disables Save until title and key are set" ~line 93 and "still needs a key to save a song that is not an original" ~line 165)

- [ ] **Step 1: Update the tests.** In repo: `createSong(song({ originalKey: "", bandKey: "Em" }))` resolves with `{ originalKey: "", bandKey: "" }`, and `"Z#"` is still rejected. In the form: replace the "still needs a key" test with "saves a song with no key", where `getSong` returns `{ ...stored, originalKey: "", bandKey: "" }` with no trackId, rename it, click Save, and expect `updateSong` to be called with `{ originalKey: "", bandKey: "" }`. In the line-93 test, keep the "Save disabled until title" assertion and drop the key part.
- [ ] **Step 2:** Run `npx vitest run tests/server/repo.test.ts tests/app/SongFormPage.test.tsx`. Expected: the updated cases FAIL.
- [ ] **Step 3: Implement.** In `withKeys`, an empty `originalKey` always returns `{ ...song, bandKey: "" }` (drop the trackId check and update its doc comment). `canSave = title.trim() !== "" && !saving`. `isOriginal` is still used for the delete message.
- [ ] **Step 4:** Run the same command, then `npm test`. Expected: PASS. If other existing tests asserted the old rule, update them to the new one.
- [ ] **Step 5:** Commit `feat: allow songs without a key`.

### Task 3: hasChords, the "No chords yet" tag, and batch import

**Files:**
- Modify: `src/shared/types.ts` (`SongSummary`), `netlify/functions/lib/repo.ts` (`listSongs`, new `importSongs`), `netlify/functions/songs.ts`, `src/app/api.ts`, `src/app/pages/SongsPage.tsx`, `src/app/pages/GigPage.tsx` (setlist row, ~line 209)
- Test: `tests/server/repo.test.ts`, `tests/server/api.test.ts`, `tests/app/SongsPage.test.tsx`, `tests/app/GigPage.test.tsx`

**Interfaces:**
- Consumes: `PlaylistTrack`, `songMatchKey`, `uniqueTracks` (Task 1).
- Produces: `SongSummary = Omit<Song, "content"> & { hasChords: boolean }`; `repo.importSongs(tracks: unknown): Promise<Song[]>`; `POST /api/songs/batch` with body `{ tracks: PlaylistTrack[] }` → 200 `Song[]`; `api.importSongs(tracks: PlaylistTrack[]): Promise<Song[]>`.

- [ ] **Step 1: Write the failing tests**
  - repo `listSongs`: a song with `content: "  "` gives `hasChords: false`, and one with chords gives `true`.
  - repo `importSongs`:
    - With an existing `Wonderwall/Oasis`, `importSongs([{title:"wonderwall ",artist:"OASIS"},{title:"Yellow",artist:"Coldplay"},{title:"Yellow",artist:"coldplay"}])` returns 2 songs in that order. The first is the existing id. The second is new, with `{ originalKey:"", bandKey:"", capo:0, content:"", sourceUrl:null, artist:"Coldplay" }`. `listSongs()` has length 2.
    - Calling it again with the same input returns the same ids and creates no new songs.
    - It throws `ValidationError` for: not an array, more than `LIMITS.gigSongs` tracks, an empty title, a title longer than `LIMITS.title`.
  - api: `POST /api/songs/batch` `{tracks:[{title:"Yellow",artist:"Coldplay"}]}` gives 200 and an array of length 1. `GET /api/songs/batch` gives 404. `POST /api/songs/batch` `{tracks:"x"}` gives 400.
  - SongsPage: a summary with `hasChords: false` shows `No chords yet`, and one with `hasChords: true` doesn't. GigPage view: the same on a setlist row. Add `hasChords` to the existing test fixtures as needed.
- [ ] **Step 2:** Run `npx vitest run tests/server tests/app/SongsPage.test.tsx tests/app/GigPage.test.tsx`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement.**
  - `listSongs` maps each song to `{ ...summary, hasChords: content.trim() !== "" }`. Grep for every other place that builds a `SongSummary` (`src/app/songCache.ts`, `src/app/offline.ts`, components) and fill `hasChords` the same way. If any are built from a full `Song`, add a shared `summaryOf(song: Song): SongSummary` in `src/shared/` and use it in both places (CLAUDE.md: one normalising helper per read path).
  - `importSongs`: validate the array and its length, then `checkString` the title (required, non-blank) and artist for each track, trimmed. Run `uniqueTracks`. Build a `Map(songMatchKey → Song)` from one `readAll("songs/")`. Create the missing songs through the same path as `createSong`.
  - `songs.ts`: before the existing `extra` check, `if (id === "batch" && extra === undefined && req.method === "POST") return json(await repo.importSongs((await readBody<{tracks?: unknown}>(req)).tracks));`. Other methods on `batch` fall through to the existing handling (GET gives 404 because there is no such song).
  - Tag markup: `<span className="badge muted">No chords yet</span>`, next to the Original badge in SongsPage and after the title in the GigPage row. Reuse existing CSS classes and add none unless it looks broken.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: batch song import and no-chords tag`.

### Task 4: Spotify playlist reader and /api/playlist

**Files:**
- Create: `netlify/functions/lib/spotify.ts`, `netlify/functions/playlist.ts`, `tests/fixtures/spotify-embed.html`
- Modify: `src/app/api.ts`
- Test: `tests/server/spotify.test.ts`

**Interfaces:**
- Consumes: `PlaylistTrack` (Task 1).
- Produces: `class PlaylistError extends Error { code: "not_spotify" | "blocked" | "parse" | "empty" }`; `playlistIdFrom(url: string): string | null`; `parseSpotifyEmbedHtml(html: string): PlaylistResult`; `importPlaylist(url: string, fetchFn?: typeof fetch): Promise<PlaylistResult>`; `interface PlaylistResult { name: string; tracks: PlaylistTrack[]; truncated: boolean }` (put the type in `src/shared/playlist.ts` so the client can use it); `api.readPlaylist(url: string): Promise<PlaylistResult>`.

Facts verified on 2026-11-13:
- `GET https://open.spotify.com/embed/playlist/{id}` (send a browser `User-Agent`) returns HTML containing `<script id="__NEXT_DATA__" type="application/json">…</script>`.
- In that JSON, `props.pageProps.state.data.entity` has `name`, `type: "playlist"`, and `trackList: [{ uri, title, subtitle /* artists, ", "-joined */, … }]`. The page shows at most 100 tracks.
- An unknown id still returns **200**, with no `entity`.

- [ ] **Step 1: Create the fixture.** Fetch a public playlist's embed page with curl. Keep only a minimal HTML shell plus the `__NEXT_DATA__` script, with `entity` cut down to `name`, `type` and 3 `trackList` entries (`uri`, `title`, `subtitle`). Include one title with `&` or an accented letter so encoding is tested.
- [ ] **Step 2: Write the failing tests**
  - `playlistIdFrom`:
    - Accepts `https://open.spotify.com/playlist/37i9dQZF1DX4UtSsGT1Sbe?si=abc`, `https://open.spotify.com/intl-de/playlist/37i9dQZF1DX4UtSsGT1Sbe` and `spotify:playlist:37i9dQZF1DX4UtSsGT1Sbe` (each gives `37i9dQZF1DX4UtSsGT1Sbe`).
    - Returns null for `https://open.spotify.com/album/…`, `https://open.spotify.com.evil.com/playlist/…`, `http://example.com` and `not a url`.
  - `parseSpotifyEmbedHtml(fixture)` gives the fixture's name, 3 `{title, artist}` in order, and `truncated: false`.
  - A fixture with 100 tracks (built in the test from the fixture JSON) gives `truncated: true`.
  - HTML with no `__NEXT_DATA__`, or with `__NEXT_DATA__` but no entity, throws `PlaylistError("parse")`. An entity with `trackList: []` throws `"empty"`.
  - `importPlaylist` with a stub `fetchFn`: a non-Spotify url throws `"not_spotify"` and never calls fetch. A 403 or 429, or fetch rejecting, throws `"blocked"`. A 200 with the fixture resolves. The fetched URL is `https://open.spotify.com/embed/playlist/{id}`.
- [ ] **Step 3:** Run `npx vitest run tests/server/spotify.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `lib/spotify.ts`, following the shape of `lib/ug.ts`. Find the playlist entity by recursively searching the parsed JSON for the first object with an array `trackList`, rather than a fixed path. Map each track to `title.trim()` and `(subtitle ?? "").trim()`, and drop entries with an empty title. Then `playlist.ts`: copy the shape of `netlify/functions/import.ts` exactly, with messages `not_spotify` → `That link isn't a Spotify playlist`, and `blocked`/`parse`/`empty` → `Couldn't read that playlist. Paste the track list instead.`. Use `config.path` `/api/playlist`. Add `readPlaylist: (url) => json<PlaylistResult>("/api/playlist", send("POST", { url }))`.
- [ ] **Step 5:** Run `npm test`. Expected: PASS.
- [ ] **Step 6:** Commit `feat: read Spotify playlists`.

### Task 5: PlaylistImport component

**Files:**
- Create: `src/app/components/PlaylistImport.tsx`
- Test: `tests/app/PlaylistImport.test.tsx`

**Interfaces:**
- Consumes: `api.readPlaylist`, `PlaylistTrack`, `PlaylistResult`, `songMatchKey`, `uniqueTracks`, `parseTrackList`, `SongSummary`.
- Produces: the default export `PlaylistImport(props: { songs: SongSummary[]; inSetlist?: Set<string> /* song ids */; onTicked: (tracks: PlaylistTrack[]) => void; disabled?: boolean })`. It is controlled through `onTicked`: it calls `onTicked` with the ticked, not-in-setlist tracks in playlist order whenever the list or the ticks change. It holds its own link, pasted text and ticks, and never resets them by itself. The parent unmounts it once the save succeeds.

- [ ] **Step 1: Write the failing tests** (mock `api.readPlaylist`).
  - Type a link and press `Load`. The rows show `Wonderwall — Oasis` with `in Songs` (the songs prop has it, matched case-insensitively) and `Yellow — Coldplay` with `new`. All are ticked, and `onTicked` was last called with both.
  - Untick Yellow, and `onTicked` is called with only Wonderwall.
  - A song in `inSetlist` shows `in setlist`, its checkbox is unticked and disabled, and it is not in `onTicked`.
  - `truncated: true` shows `Spotify only shows the first 100 tracks.`
  - `readPlaylist` rejects with `ApiError(422, "Couldn't read that playlist. Paste the track list instead.")`: the alert shows the message, the link stays, and a `Paste track list` textarea appears. Typing `Yellow - Coldplay` produces the same preview row.
  - A duplicated track in the response shows once.
- [ ] **Step 2:** Run `npx vitest run tests/app/PlaylistImport.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use a `Spotify playlist` labelled url input with a `Load` button (disabled while loading or when the link is blank). Also show a `Paste track list` toggle so pasting is possible without a failed load first. Show a list of checkbox rows (`<label>` wrapping the checkbox and `title — artist` plus a muted status). Key the ticks by `songMatchKey`. Reuse the existing classes (`field`, `input`, `btn`, `list`, `muted`, `error`).
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit `feat: playlist import preview`.

### Task 6: Import Playlist in the New gig form

**Files:**
- Modify: `src/app/pages/GigsPage.tsx`
- Test: `tests/app/GigsPage.test.tsx` (new; follow the mocking pattern in `tests/app/GigPage.test.tsx`)

**Interfaces:**
- Consumes: `PlaylistImport` (Task 5), `api.importSongs` (Task 3), `api.listSongs`, `api.createGig`.

- [ ] **Step 1: Write the failing tests**
  - Open New gig and click `Import Playlist`: the songs list is fetched once and `PlaylistImport` is shown.
  - Load a playlist (2 tracks), fill in the name and date, and Create gig: `importSongs` is called with the 2 tracks, `createGig` with `setlist: [{type:"song",songId:id1},{type:"song",songId:id2}]`, and the app navigates to `/gigs/{id}`.
  - With no playlist loaded, Create gig behaves as today (`importSongs` is not called, `setlist: []`).
  - `createGig` rejects: the error is shown, the name, date and the ticked preview are still there, and pressing Create again calls `importSongs` again and `createGig` again (no duplicates, because the server reuses songs).
  - `importSongs` rejects: the error is shown, `createGig` is not called, and the inputs are kept.
- [ ] **Step 2:** Run `npx vitest run tests/app/GigsPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add an `Import Playlist` button inside the create form that reveals `PlaylistImport` and loads `api.listSongs()` once. Keep `ticked: PlaylistTrack[]` in state from `onTicked`. In `create()`, run the existing validation, then `const songs = ticked.length ? await api.importSongs(ticked) : []`, then `createGig({ name, date, setlist: songs.map(s => ({ type: "song", songId: s.id })) })`. Both are inside the existing try. Pass `disabled={saving}` to `PlaylistImport`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: import a playlist when creating a gig`.

### Task 7: Import Playlist on an existing gig

**Files:**
- Modify: `src/app/pages/GigPage.tsx`
- Test: `tests/app/GigPage.test.tsx`

**Interfaces:**
- Consumes: `PlaylistImport`, `api.importSongs`, the existing `save(next: SetlistItem[]): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**
  - An `Import Playlist` button is shown next to `Edit setlist` (when not editing). It opens `PlaylistImport` with the gig's current song ids as `inSetlist`. A track matching a setlist song shows `in setlist`.
  - Confirm with an `Add N songs` button (N = the ticked count; disabled at 0): `importSongs` is called with the ticked tracks, then `updateGig` with the old setlist plus the new song items appended in order (any id already in the setlist is skipped), and the panel closes. The new songs appear in the list, because `listSongs` is re-fetched or the returned songs are merged into `songs` as summaries with `hasChords` from their content.
  - `updateGig` rejects: the panel stays open with its ticks, and the error is shown.
  - The server rejects the save (for example, over 100 songs): its message is shown through the existing `save` failure path, and the panel stays open.
- [ ] **Step 2:** Run `npx vitest run tests/app/GigPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `importing` panel state and `ticked` state. In the confirm handler: `const added = await api.importSongs(ticked)` (catch → setError, keep the panel), then merge `added` into `songs`, then `if (await save([...items, ...added.filter(s => !ids.includes(s.id)).map(toItem)])) close panel`. Disable the confirm button while it's busy.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: import a playlist into an existing gig`.

### Task 8: UG import on Edit song

**Files:**
- Modify: `src/app/pages/SongFormPage.tsx` (`doImport` lines 88-106, Import button lines 191-195)
- Test: `tests/app/SongFormPage.test.tsx`

- [ ] **Step 1: Write the failing tests** (in edit mode, `getSong` returns a song with `title "Yellow", artist "Coldplay", originalKey "", bandKey "", capo 0, content ""`).
  - An `Import` button is visible under Link. Type a UG url and click Import, with `importSong` resolving `{ title: "Yellow (Acoustic)", artist: "Cold Play", originalKey: "B", capo: 2, content: markupFromPlainText("B\nLook at the stars"), sourceUrl: url }`.
  - After that, the Title is still `Yellow`, the Artist is still `Coldplay`, the Original key is `B`, Capo is `2`, and the Chords box contains `Look at the stars`. `updateSong` has not been called.
  - Click Save: `updateSong` gets `{ title: "Yellow", artist: "Coldplay", originalKey: "B", bandKey: "B", capo: 2, sourceUrl: url }` and content equal to the imported markup.
  - With the stored `bandKey: "A"` and `originalKey: "G"`: after the import, Save sends `bandKey: "A"`.
  - After the import, leaving the page asks first (unsaved changes).
  - The import fails: the message is shown, and the fields and the chords box are unchanged.
- [ ] **Step 2:** Run `npx vitest run tests/app/SongFormPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Render the Import button when `mode === "link" || editing`. In `doImport`, keep the current behaviour when `!editing`. When `editing`: `setOriginalKey(song.originalKey); setCapo(song.capo); if (bandKey === "") setBandKey(song.originalKey); setExisting(song.content); const plain = plainTextFromMarkup(song.content); setPasted(plain); setInitialPlain(plain);`. Don't touch title or artist. On failure, don't switch mode (it's already paste on edit).
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: import chords from UG when editing a song`.

### Task 9: Changelog and full verification

**Files:**
- Modify: `CHANGELOG.md` (follow the file's existing format)

- [ ] **Step 1:** Add an entry: Import Playlist from Spotify (new and existing gigs), Import on Edit song, `No chords yet` tag, songs may have no key.
- [ ] **Step 2:** Run `npm test` and then `npm run build`. Expected: all tests pass, and the type-check and build succeed.
- [ ] **Step 3: Manual check** with `npm run dev` at http://localhost:8888:
  - New gig with a real public playlist link: the gig opens with the setlist in playlist order, and songs that already existed were reused.
  - Open a song, then Edit, then Import a UG link, then Save. The chords show and the title is unchanged.
  - A bad link shows the paste box, and the pasted list imports.
  - Import Playlist on an existing gig skips songs that are already in the setlist.
- [ ] **Step 4:** Commit `docs: changelog for playlist import`.
