# Architecture review (2026-11-13)

This review only reads the code. Nothing was changed. It looked at `main` @ `1f5a3eb`: about 4,200 lines of source and 444 tests in 32 files. `npm test` passes and `tsc --noEmit` is clean.

## Verdict

The architecture is good for what this app is: a private tool for one band. The layers are clean. `src/shared` holds pure domain logic with no React or Node imports, and both the client and the server use it. All storage goes through one `KV` interface and one `repo`. All client calls go through `api.ts`. The service-worker rules are pulled out into a pure, tested module. Comments explain *why*, and the test suite is strong.

The weak spot is **multiple people editing at once**. Every write blindly reads, changes and writes back the whole record. So two band members editing the same song or setlist overwrite each other without any warning.

**Data volume** is fine up to a few hundred songs. List calls cost one blob read per song, so they slow down as the library grows.

**Codebase growth** is OK. The friction comes from three things: large page components, cache invalidation done by hand in two places, and one 465-line `repo.ts`. None of these needs a rewrite. A real database, a state library like Redux, or real-time sync (CRDTs) would be over-engineering at band scale.

## Scalability on three axes

| Axis | Verdict | Why |
|---|---|---|
| Data volume (~1,000 songs, ~200 gigs) | **OK now, borderline at 1,000** | `listSongs` reads every song blob in full (chords up to 100 KB each) just to drop the chords again (`repo.ts:199-203`, `282-286`). Five client paths call it. At 1,000 songs that is 1,000 parallel Blobs GETs per page view. Gigs are small and 200 is fine. |
| People editing at once (a few band members) | **Weak** | No versions and no conditional writes. Whoever saves last wins (see F1). |
| Codebase growth | **Good base, some friction** | Clean layers and injectable handlers. Pages hold fetching, state and rules together, and cache clearing is spread around by hand (F3, F4). |

## Findings

Known findings in `docs/code-review-open-findings.md` (all 10 fixed) are not repeated here. Open access with no login is the owner's accepted decision (spec `2026-11-11-band-site-design.md:28`), so it is not filed as a bug. F7 just notes a cheap mitigation.

| # | Area | Issue | Evidence | Sev | Effort | Recommended fix |
|---|---|---|---|---|---|---|
| F1 | Data layer / concurrency | **Lost updates.** Every update reads, changes and writes back with no version check. (1) The song edit form sends the *whole* song, including the `bandKey` it loaded when it opened. If a bandmate transposes the song while the form is open, Save puts the old key back. (2) A setlist save sends the whole setlist, so two people editing the same gig drop each other's changes. Neither person is told. | `SongFormPage.tsx:141-152` (full `SongInput`, incl. `bandKey`); `SongPage.tsx:106`; `GigPage.tsx:62-69` (whole `setlist`); `repo.ts:332-343`, `372-384` (no version check); `@netlify/blobs` 8.1.0 returns etags but this version has no conditional write | High | M | Add a `version` (or reuse `updatedAt`) to songs and gigs. The client sends `baseVersion`, and the server returns **409** when it doesn't match. The UI says "Someone else changed this, reload". Check whether a newer `@netlify/blobs` supports conditional writes (`onlyIfMatch`); if so, use it to close the race fully. Also have SongFormPage send only the fields that changed. |
| F2 | Data layer / volume | List and scan calls read every record in full. `listSongs` downloads every chord sheet to build summaries. `importSongs` reads all songs. `removeSongFromGigs` reads all gigs and writes them one by one. Each GET of `/api/songs` grows linearly with the library and risks Netlify function timeouts and Blobs rate limits around 1,000 songs. | `repo.ts:199-203`, `282-286`, `305`, `209-216`; callers `SongsPage.tsx:12`, `GigPage.tsx:35`, `GigsPage.tsx:33`, `songCache.ts:66`, `offline.ts:47` | Med (Low today) | M | **Measure first** (time `/api/songs` with about 300 seeded songs). If it's slow, keep a `index/songs` summary blob that updates on each song write and rebuilds when missing. Do this *after* F1, because an index blob is one hot record that every write touches. |
| F3 | Client state | Cache clearing is manual and spread across two layers: the in-memory `songCache` and the SW `API_CACHE`. Each mutation site has to remember to call `clearSongCache()`. A new feature that forgets will show stale setlists and songs for up to 60 s. | `GigPage.tsx:70,128,162`; `SongFormPage.tsx:153`; `songCache.ts:6,80`; SW invalidation is separate in `sw.ts:63-76` | Med | S | Move invalidation into `api.ts`: every mutating function clears the matching `songCache` entries after a successful response, and pages stop calling `clearSongCache` themselves. Optionally add tiny `useGig(id)` / `useSongs()` hooks. Don't add a state library. |
| F4 | Pages | Page components mix data loading, optimistic updates, business rules and rendering. `GigPage` has 13 `useState`s across about 300 lines and `SongFormPage` has about 16. Adding a feature means editing these large files, and their tests are large too (55 and 61 tests). | `GigPage.tsx:19-31`, `62-107`; `SongFormPage.tsx:33-50`, `123-160` | Med | M | Split along existing seams. Move the gig's save, import and offline actions into a `useGigEditor(id)` hook. Move the song form's content building (lines 123-130) into a pure function in `src/shared/sheet.ts` with unit tests. Only do this as part of the next feature that touches these files, not as a standalone refactor. |
| F5 | Server structure | `repo.ts` holds validation, three entities and the rules that keep them consistent with each other (465 lines). That's fine today, but it's the first file to get uncomfortable as features grow. | `repo.ts:22-189` (validation), `191-463` (songs, gigs, tracks, cascades) | Low | S | Split into `lib/validate.ts` plus `lib/repo/{songs,gigs,tracks}.ts` behind the same `makeRepo(kv)` facade, so handlers and tests don't change. Keep the single facade, because the spec relies on it for adding login later. |
| F6 | Data layer / multi-step writes | `deleteTrack` deletes the song *before* removing it from gigs. That's the opposite of the "delete the record last" rule `deleteSong` follows. If it fails halfway, it leaves dangling gig references and can't be retried, because the track is already gone. It's hidden in practice by `withoutMissingSongs`. | `repo.ts:453-460` vs `344-355` | Low | S | Reuse the same order: clean up gigs, then the audio, then the song, then the track. Or call `deleteSong` from `deleteTrack`. Add a repo test that injects a KV failure partway through. |
| F7 | Backend / access | Open access is accepted, but anyone who finds the URL can `DELETE` every song, gig and mp3, and there's no backup. Netlify Blobs has no point-in-time restore. | `README.md:5`; spec `:28`; all handlers | Med (accepted) | S | Optional, for the owner to decide: a shared band passphrase. Store it in a Netlify env var, have `guard()` check a header (`http.ts:30`) and have `api.ts` send it. Separately, add an "export everything as JSON" endpoint so there's a backup. |
| F8 | Backend handlers | `import.ts` and `playlist.ts` copy the `json` helper and body parsing instead of using `lib/http.ts`, and they don't go through `guard`. So an unexpected error returns Netlify's default non-JSON 500, and they don't get the same error handling as the other handlers. Neither handler has its own test (the libraries behind them do). | `import.ts:10-26`; `playlist.ts:12-28` | Low | S | Wrap both in `guard` and reuse `json` / `readBody`. Add a handler test for each. |
| F9 | Backend | `GET /api/tracks` deletes abandoned uploads as a side effect, so a read path runs deletes. | `tracks.ts:13-16` | Low | S | Move this to a Netlify scheduled function (daily). Keep the repo method. |
| F10 | Offline | When the network takes longer than 4 s, the SW answers from its saved copy, and nothing in the UI says the data may be old. On stage, someone could play a key from before a bandmate transposed it and not know. | `strategy.ts:6`, `76-109`; no "offline/saved copy" indicator in `src/app` | Low | S | Have the SW add an `X-From-Cache: 1` header when it answers from the cache. `api.ts` passes that through, and the song and gig pages show a small "Saved copy — may be out of date" note. |
| F11 | Testing | All server tests run on `memoryKV`, which is instant, has no concurrency and no list paging. So the races in F1 and F6 can't show up in tests. There's no browser-level test of the service worker or offline flow. | `tests/server/*` use `memoryKV()`; `kv.test.ts` has 1 test | Low | S–M | Add a "slow/interleaving" test KV that can pause between read and write, to cover F1 and F6. Optionally add one Playwright smoke test against `netlify dev` for the offline flow. |

## Top 3 to do first

1. **F1: optimistic concurrency for songs and gigs.** It's the only finding where real use (two bandmates at a rehearsal) silently loses data, and F2's index blob depends on it.
2. **F3: centralize cache invalidation in `api.ts`.** It's small, and it removes the most likely source of bugs in every future feature.
3. **F2: measure list cost, then add a summary index if needed.** It only matters as the library grows, so measure before building.

F7 (passphrase and backup) is cheap and worth asking the owner about. The other items can wait until a feature touches that code.

## What's good and should be kept

- **Pure shared domain.** `src/shared` (transpose, sheet, setlist, playlist, types) has no framework imports, is used by client and server, and has thorough tests.
- **`KV` interface + `makeRepo(kv)` + `make*Handler(repo)`.** Storage is swappable and handlers can be tested without Netlify. All data access is in one place, as the spec asks, to make adding login later easy.
- **Server-side validation by allow-list** (`cleanSong`, `cleanGig`, `checkSetlist`) with explicit `LIMITS`.
- **Deliberate consistency choices.** Blobs strong consistency (`kv.ts:39`), tolerance for dangling references (`withoutMissingSongs`), idempotent `linkTrackSong`, and support for old data formats (`songIds` → `setlist`).
- **SW logic split out as pure functions** (`src/sw/strategy.ts`, 46 tests) and a carefully built app-shell save (`saveShell`).
- **Outbound fetch safety.** The UG import checks hosts and follows redirects by hand, the Spotify import builds its URL from a checked ID, and both have timeouts.
- **Tooling.** Strict TypeScript, pinned runtime dependencies, fast test suite, and comments that explain why.
