# Fix plan: code-review findings on PR #1 (HEAD^1..HEAD)

## Context

`/code-review` against `HEAD^1` (everything PR #1 `spotify-playlist-feat` merged into `main`) found no hard
breaches of CLAUDE.md. It did find two possible bugs, one rule that is followed only in spirit, a few
duplications, and some undocumented additions. This plan lists each problem, the fix, and a
self-contained prompt that can be handed to another agent.

Ground rules for every task (from CLAUDE.md and the user's standing instructions):
- **Reproduce first.** Write a failing test that shows the problem before fixing it. If it can't be
  reproduced, stop and report back instead of changing code.
- **Don't commit, push or merge.** Leave the changes in the working tree.
- When finished, run `npm test` and `npm run build` (which includes `tsc`), and both must pass.


Order: P1 → P2 → P3 → P4 → P5 → P6 → P7. P1 and P2 are bugs. P3 and P4 both touch
`src/shared/playlist.ts` / `repo.ts`, so run them one after the other, not in parallel.

---

## P1: `deleteTrack` cleans up in the wrong order (bug, medium)

**Problem.** `deleteTrack` in [netlify/functions/lib/repo.ts](netlify/functions/lib/repo.ts) (around line 454) runs:
1. `removeTrackData(id)`: deletes the audio parts and the **track record**.
2. `kv.delete("songs/<songId>")`.
3. `removeSongFromGigs(songId)`.

`deleteSong` (around line 344) was already fixed to clean up the things that point at the record
first and delete the record last, so a retry can finish the job (open finding #3). `deleteTrack`
does the opposite. If it fails after step 1, the track is gone, a retry returns 404, and the song
(and any gig references) can no longer be cleaned up through this path. If it fails after step 2,
gigs keep stale song ids. Reads hide those ids through `withoutMissingSongs`, but they stay stored.

**Fix.** Reorder `deleteTrack` to match `deleteSong`:
`removeSongFromGigs(songId)` → `kv.delete(songs/songId)` → `removeTrackData(id)`, with the track record
deleted last. Keep the existing `t.songId && (await getSong(t.songId))` guard. Add a comment that
mirrors the one in `deleteSong`.

**Test.** In `tests/server/repo.test.ts`, use `memoryKV()`, wrap it so `delete("songs/…")` (or the
gig write) throws once, then call `deleteTrack` and confirm that it rejects, that a second
`deleteTrack(id)` succeeds, and that afterwards no track, song, audio part or gig reference remains.
Look in the existing tests for how `deleteSong`'s retry was tested (finding #3) and reuse that approach.

**Prompt for agent:**
> In `netlify/functions/lib/repo.ts`, `deleteTrack` deletes the track record (via `removeTrackData`) first, then the linked song, then removes the song from gigs. `deleteSong` in the same file does the reverse on purpose: it cleans up references first and deletes the record last, so a failure part-way can be retried (see its comment and `docs/code-review-open-findings.md` finding #3). First, reproduce the problem: in `tests/server/repo.test.ts`, write a test with `memoryKV()` wrapped so one of the later deletes/writes throws once. Show that a retried `deleteTrack` then returns NotFound and leaves the song and gig references behind. Model the test on the existing `deleteSong` retry test. Then reorder `deleteTrack` to `removeSongFromGigs(songId)` → delete `songs/<songId>` → `removeTrackData(id)`, keep the existing guard, and add a one-line comment like `deleteSong`'s. Make the test pass. Run `npm test` and `npm run build`. Do not commit.

---

## P2: playlist preview and server can match different songs (bug, medium)

**Problem.** The spec (`docs/superpowers/specs/2026-11-13-spotify-playlist-import-design.md`) says
`songMatchKey` is "the one helper used both by the server's reuse-or-create step and by the client's
'in Songs' marker, so the two can't disagree." Both sides call it, but when two existing songs share a
match key, they pick a different one:
- The client ([src/app/components/PlaylistImport.tsx:37](src/app/components/PlaylistImport.tsx#L37)) uses `new Map(songs.map(...))`, so the **last** song wins, over the title-sorted `listSongs` order.
- The server ([repo.ts](netlify/functions/lib/repo.ts) `importSongs`, around line 305) uses `if (!byKey.has(k))`, so the **first** song wins, in `readAll` storage order.

The result: the preview can lock a track as "in setlist" while the server returns the other copy, or the
reverse. In the reverse case, `GigPage.addFromPlaylist`
([src/app/pages/GigPage.tsx:98](src/app/pages/GigPage.tsx#L98)) filters out `added` songs already in
`ids`, so a track the user ticked is **silently not added**. Duplicates are possible because manual
"Add song" doesn't block them.

**Fix.** Make the tie-break a single shared, order-independent rule:
- Add `songsByMatchKey<T extends { id: string; title: string; artist: string }>(songs: T[]): Map<string, T>` to [src/shared/playlist.ts](src/shared/playlist.ts).
  - When several songs share a key, it picks one deterministically, independent of input order. Recommended rule: prefer a song **in the given setlist** if the caller passes one, otherwise the smallest `id` (string compare).
  - Simplest version: always the smallest `id`, plus the setlist preference on the client only if needed to keep the "in setlist" lock correct. Agent to choose the minimal version that makes both sides agree.
- Use it in `importSongs` (server) and in `PlaylistImport`'s `statusOf` (client).
- Update the doc comment on `songMatchKey`/`songsByMatchKey` to state the tie-break.

**Test.**
- `tests/shared/playlist.test.ts`: `songsByMatchKey` returns the same song regardless of input order.
- `tests/server/repo.test.ts`: two songs with the same title/artist. `importSongs` returns the one the helper picks.
- Optionally, `tests/app/GigPage.test.tsx`: a duplicate pair where one copy is in the setlist. The ticked track isn't silently dropped (or is shown as "in setlist" consistently).

**Prompt for agent:**
> The playlist import client and server can disagree about which existing song a track matches when two songs share the same `songMatchKey` (same title and artist, ignoring case and spaces). The client, in `src/app/components/PlaylistImport.tsx` `statusOf` (~line 37), builds `new Map(songs.map(...))`, so the last song wins over a title-sorted list. The server, in `netlify/functions/lib/repo.ts` `importSongs` (~line 305), keeps the first song in storage order. The consequence: `GigPage.addFromPlaylist` (`src/app/pages/GigPage.tsx` ~line 98) can silently drop a ticked track that the server matched to a song already in the setlist. The spec `docs/superpowers/specs/2026-11-13-spotify-playlist-import-design.md` requires the two sides "can't disagree". First, reproduce it: write a test showing the two sides choose different songs for a duplicate pair. Then add one shared helper to `src/shared/playlist.ts` (for example `songsByMatchKey(songs)`) that picks deterministically, independent of input order (smallest `id` is a fine rule), and use it on both sides. Keep `src/shared` free of browser and Node APIs. Add tests in `tests/shared/playlist.test.ts` and `tests/server/repo.test.ts`. Run `npm test` and `npm run build`. Do not commit.

---

## P3: `hasChords` is computed in two places (standards, low)

**Problem.** CLAUDE.md says every read path of the same resource should go through the same normalising helper.
`Song → SongSummary` (dropping `content`, adding `hasChords`) is written twice:
- In `listSongs` in [repo.ts:285](netlify/functions/lib/repo.ts#L285).
- As `summaryOf` in [GigPage.tsx:14](src/app/pages/GigPage.tsx#L14).

If one copy changes (for example, whitespace-only sheets), the Songs list and the gig page would disagree.

**Fix.** Add `toSongSummary(song: Song): SongSummary` to [src/shared/types.ts](src/shared/types.ts), or a
new `src/shared/song.ts` if types.ts should stay types-only. Use it in `listSongs` and in GigPage,
and delete `summaryOf`.

**Prompt for agent:**
> `Song → SongSummary` (drop `content`, set `hasChords: content.trim() !== ""`) is implemented twice: once in `listSongs` in `netlify/functions/lib/repo.ts` (~line 285), and once as `summaryOf` in `src/app/pages/GigPage.tsx` (line 14). CLAUDE.md requires one normalising helper per resource. Add a single `toSongSummary(song)` to `src/shared/` (a new `src/shared/song.ts` is fine; keep it free of browser and Node APIs, and have functions import it via `../../../src/shared/...`). Use it in both places and remove `summaryOf`. Add a small unit test in `tests/shared/`. Run `npm test` and `npm run build`. Do not commit.

---

## P4: duplicated new-song literal and a hard-coded "100" (smell, low)

**Problem.**
- The blank new-song record (`sourceUrl: null, originalKey: "", bandKey: "", capo: 0, content: ""`) is written out
  in both `linkTrackSong` (~line 238) and `importSongs` (~line 316) in `repo.ts`.
- [PlaylistImport.tsx:121](src/app/components/PlaylistImport.tsx#L121) hard-codes "first 100 tracks"
  even though `SPOTIFY_PAGE_TRACKS` exists in `src/shared/playlist.ts`.

**Fix.** Add a private `blankSong({ id, title, artist, trackId? }): Song` in `repo.ts` and use it in both
places, keeping the "no key yet" comment. Interpolate `SPOTIFY_PAGE_TRACKS` into the message.

**Prompt for agent:**
> Two small cleanups, with no behaviour change:
> (1) In `netlify/functions/lib/repo.ts`, the empty new-song object literal is duplicated in `linkTrackSong` and `importSongs`. Extract a private `blankSong({ id, title, artist, trackId })` inside `makeRepo` (or at module level) that returns the `Song` with empty keys, `capo: 0`, empty content and a fresh `updatedAt`, and use it in both. Keep the comment explaining why keys are empty (CLAUDE.md: never invent a placeholder key).
> (2) In `src/app/components/PlaylistImport.tsx` (~line 121), replace the literal "first 100 tracks" with `SPOTIFY_PAGE_TRACKS` from `src/shared/playlist.ts`.
> Existing tests must still pass unchanged. Run `npm test` and `npm run build`. Do not commit. Do this after the P2 task has landed if it's still pending, since both touch `importSongs`.

---

## P5: playlist function doesn't use the shared HTTP helpers (standards, low)

**Problem.** CLAUDE.md says each function uses the `lib/` plumbing. [netlify/functions/playlist.ts](netlify/functions/playlist.ts)
(and the older `import.ts`, which it copies) defines its own `json` instead of importing `json` from
`lib/http.ts`, and doesn't wrap the handler in `guard`. Neither stores data, so `makeXHandler(repo)` isn't needed.

**Fix.** In both `playlist.ts` and `import.ts`:
- Import `json` (and `methodNotAllowed` if its body matches) from `./lib/http`.
- Wrap the default export in `guard(...)`, after checking what `guard` does with thrown errors so the 422 mapping still wins.

Status codes and response bodies stay exactly the same.

**Prompt for agent:**
> `netlify/functions/playlist.ts` and `netlify/functions/import.ts` each define a local `json` helper instead of using `netlify/functions/lib/http.ts` (`json`, `methodNotAllowed`, `guard`). Read `lib/http.ts` and how `songs.ts`/`gigs.ts` use it. Then change both functions to use the shared helpers and wrap them in `guard`, without changing any status code or response body. Note in particular that 405 currently returns `{ code: "method", message }`; keep that body. Confirm with the existing tests (`tests/server/api.test.ts`, `tests/server/spotify.test.ts`, `tests/server/ug.test.ts`), and add a test for the 405 and 422 bodies if none exists. Run `npm test` and `npm run build`. Do not commit.

---

## P6: undocumented additions (docs, low)

**Problem.**
- `src/app/components/tabLayout.ts` (guitar-tab row layout, used by `ChordSheet.tsx`) came in with 00f2053, but no plan names it and `CHANGELOG.md` doesn't mention it.
- `img/Stereobloc-Logo.png` (8 MB) is committed but nothing references it. The app uses `public/logo-*.png`.

**Fix.**
- Add a CHANGELOG line for the tab layout under the release that contains 00f2053.
- For the logo, either untrack it (`git rm --cached`, add `img/` to `.gitignore`, keep the file locally) or keep it on purpose as the source artwork. **The user decides**, so the agent only reports and doesn't change the logo without approval.

**Prompt for agent:**
> Read `src/app/components/tabLayout.ts` and `ChordSheet.tsx` to see what the tab layout feature does for the user. Add one plain-language line describing it to `CHANGELOG.md` under the release that includes commit 00f2053, matching the file's existing style. Separately, `img/Stereobloc-Logo.png` (8 MB) is tracked in git but referenced nowhere. Do not delete or untrack it; just report back so the user can decide whether to keep it as source artwork or remove it from the repo. Do not commit.

---

## P7: optional "No chords yet" badge in AddSongsPicker (spec, optional)

**Problem.** The spec says AddSongsPicker "can show it too if that's trivial." It doesn't. It's trivial:
`SongsPage.tsx:47` and `GigPage.tsx:273` already render `{s.hasChords === false && <span className="badge muted">No chords yet</span>}`.

**Fix.** Render the same badge in the row label in
[src/app/components/AddSongsPicker.tsx](src/app/components/AddSongsPicker.tsx) (~line 53).

**Prompt for agent:**
> In `src/app/components/AddSongsPicker.tsx` (~line 53), each row shows `title — bandKey`. Add the same "No chords yet" badge the Songs list uses (`src/app/pages/SongsPage.tsx:47`: `{s.hasChords === false && <span className="badge muted">No chords yet</span>}`), showing it only when `hasChords === false` (undefined means an older cached copy, so show nothing). Add a case to `tests/app/AddSongsPicker.test.tsx`. Run `npm test` and `npm run build`. Do not commit.

---

## Not fixing (reviewed, harmless)

- **`truncated` uses `>=` rather than `=== 100`.** The embed never returns more than 100 tracks, so the result is the same.
- **GigPage adds the returned songs to the list instead of re-fetching `listSongs`.** It gives the same result.
- **`uniqueTracks` and `/embed/playlist/` link support** weren't in the spec, but they're harmless.
- **`repo.ts` grew for several reasons, and keys are plain strings.** These are judgement-call smells. Splitting `repo.ts` or adding a `Key` type is a bigger refactor that isn't worth doing now.
- **The name `norm` in `src/shared/playlist.ts`** is a minor issue. Rename it (for example to `normaliseForMatch`) while doing P2 if convenient.

## Verification

After all tasks:
- `npm test` passes, including the new tests from P1, P2, P3 and P7.
- `npm run build` passes.
- Manual check with `npm run dev`:
  1. Create two songs with the same title and artist, and add one of them to a gig.
  2. Import a playlist (or paste a list) containing that song into the gig.
  3. Confirm that the preview status and the result agree, and that nothing ticked is silently dropped.
  4. Delete a track that has a linked song in a gig, and confirm that the gig no longer lists it.
