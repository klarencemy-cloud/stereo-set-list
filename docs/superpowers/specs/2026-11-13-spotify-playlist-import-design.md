# Import a Spotify playlist into a gig, and import UG chords when editing a song

## Context

Building a gig's setlist today means adding each song one at a time on Add song, and every song needs a key and usually chords before it can be saved. The band already plans gigs as Spotify playlists. They want to paste a playlist link and have every track become a song in the Songs list and in the gig's setlist, in playlist order. The chords get filled in later, song by song, by importing from Ultimate Guitar or pasting them. To do that, the Edit song page needs the UG import that only Add song has today.

## Decisions (from the Q&A)

| Topic | Decision |
|---|---|
| Where the songs go | Into the Songs list **and** into the gig's setlist, in playlist order |
| Song already exists (same title + artist, ignoring case and extra spaces) | Reuse the existing song and create no copy |
| Reading Spotify | Server reads the public embed page `open.spotify.com/embed/playlist/{id}` (`__NEXT_DATA__` → `trackList[]` with `title` and `subtitle` = artists). No Spotify account or keys. If that fails, the user pastes a "Title - Artist" list instead |
| Where the import is offered | In the New gig form, and as an "Import Playlist" button on an existing gig's page (adds to the end of the setlist) |
| Preview | Tracks are listed before saving, each marked "in Songs", "new" or "in setlist". Every track starts ticked and can be unticked; only ticked tracks are imported |
| Titles | Kept exactly as Spotify gives them (no stripping of "Remastered" etc.) |
| UG import on Edit song | Changes the chords, original key, capo and link. Keeps the title and artist. Sets the band key only if it's empty |
| "No chords yet" tag | Shown in the Songs list and the gig setlist for songs whose chord sheet is empty |

**Approaches considered for reading Spotify:** (a) official Web API. Since Feb 2026 a development-mode app needs a Premium owner, has 5 users, and needs a user sign-in; it only returns items for playlists the user owns or collaborates on. That clashes with the site's no-login design, so it was rejected. (b) Paste a list only: robust but tedious, so it was kept as the fallback. (c) **Read the public embed page plus the paste fallback: chosen.** I checked it: the embed page carries up to 100 tracks, which matches `LIMITS.gigSongs = 100`.

**My calls (correct me):**
- **Any song may have no key.** Today `withKeys` in [repo.ts:86](netlify/functions/lib/repo.ts#L86) rejects `originalKey: ""` unless the song has a `trackId`, and `canSave` in SongFormPage needs a key unless the song is an original. Both are relaxed for all songs, so a playlist song can be saved and edited before anyone knows its key. That follows the "store empty, show unknown" rule, and the displays already show `?` ([SongPage.tsx:178](src/app/pages/SongPage.tsx#L178), [GigPage.tsx:209](src/app/pages/GigPage.tsx#L209)).
- Imported songs: `artist` = Spotify's artist string as given (e.g. "KAROL G, Judeline"), `sourceUrl: null`, `originalKey: ""`, `bandKey: ""`, `capo: 0`, `content: ""`. The Spotify link is not stored (`sourceUrl` is the chord source).
- A track that appears twice in the playlist is imported once (setlists can't hold a song twice).
- When the embed returns exactly 100 tracks, the preview notes "Spotify only shows the first 100 tracks."
- Paste fallback format: one track per line, split on the **last** " - " (or " – "). A line with no separator becomes a title with an empty artist. Blank lines are ignored.

## Design

### Shared (`src/shared/playlist.ts`, new)
- `type PlaylistTrack = { title: string; artist: string }`.
- `songMatchKey(title, artist)`: lowercase, trim, collapse whitespace. This is the **one** helper used both by the server's reuse-or-create step and by the client's "in Songs" marker, so the two can't disagree (CLAUDE.md convention).
- `parseTrackList(text): PlaylistTrack[]` for the paste fallback.

### Server
- **`netlify/functions/lib/spotify.ts`** (new, mirrors [ug.ts](netlify/functions/lib/ug.ts)): `PlaylistError` with codes `not_spotify | blocked | parse | empty`; `playlistIdFrom(url)` accepts `open.spotify.com/[intl-xx/]playlist/{id}[?si=…]` and `spotify:playlist:{id}`; `parseSpotifyEmbedHtml(html)` pulls `__NEXT_DATA__` and finds the `trackList` (look it up by key rather than a fixed path, so small layout changes don't break it) → `{ name, tracks, truncated }`; `importPlaylist(url, fetchFn = fetch)`.
- **`netlify/functions/playlist.ts`** (new, mirrors [import.ts](netlify/functions/import.ts)): `POST /api/playlist {url}` → `{ name, tracks, truncated }`; errors return 422 with friendly messages ("That link isn't a Spotify playlist" / "Couldn't read that playlist. Paste the track list instead.").
- **`repo.ts`**:
  - `withKeys`: allow `originalKey: ""` for any song (bandKey is then forced to `""`).
  - New `importSongs(tracks: PlaylistTrack[]): Song[]`: validates each title/artist with the existing `checkString`/`LIMITS`; at most `LIMITS.gigSongs` tracks; dedupes by `songMatchKey`; reuses existing songs by `songMatchKey`, otherwise creates a keyless, chordless song; returns songs in input order. Calling it again is safe: a retry after a failed gig save reuses the songs it already created.
  - `listSongs`: add `hasChords: boolean` (`content.trim() !== ""`) to `SongSummary` (types.ts). Check every other place that produces a `SongSummary` (offline/songCache) so they all fill it the same way.
- **`songs.ts`**: route `POST /api/songs/batch` → `repo.importSongs` (only when `id === "batch"` and method is POST; ids are UUIDs, so this can't clash with a real id).

### Client
- **`api.ts`**: `readPlaylist(url)`, `importSongs(tracks)`.
- **`components/PlaylistImport.tsx`** (new, used in both places): Spotify link field + **Load** button → preview list with checkboxes (all ticked), each row marked "in Songs" / "new" / "in setlist" (setlist rows unticked and disabled). If Load fails, show the error and switch to a "Paste track list" textarea that produces the same preview. Props: `songs: SongSummary[]`, `inSetlist?: Set<string>`, and `onChange(ticked: PlaylistTrack[])` (or a confirm callback; see below). Never clear the link, ticks or pasted text until the parent's save resolves `true`.
- **`GigsPage.tsx`** New gig form: an optional "Spotify playlist" section built from `PlaylistImport` (songs list loaded when the section is opened). **Create gig**: if tracks are ticked → `api.importSongs(ticked)` → `api.createGig({ name, date, setlist: songs.map(song item) })` → navigate. On failure, keep everything and show the error. A retry is safe because `importSongs` reuses songs.
- **`GigPage.tsx`**: an "Import Playlist" button next to "Edit setlist" opens `PlaylistImport` with `inSetlist = ids`; confirm → `api.importSongs` → the existing optimistic `save([...items, ...newSongItems])`; close the panel only when the save resolves `true`. Refresh `songs` (listSongs) so new songs show in the setlist. Also show "No chords yet" on setlist rows where `!hasChords`.
- **`SongsPage.tsx`**: "No chords yet" muted tag on rows where `!hasChords`. AddSongsPicker can show it too if that's trivial.
- **`SongFormPage.tsx`**:
  - Show the **Import** button under Link on Edit as well, not only in Add's link mode.
  - On Edit, `doImport` sets `originalKey`, `capo`, `link` (already typed), and `bandKey` only if it's currently `""`. It leaves `title`/`artist` alone, sets `existing = song.content` and `pasted = initialPlain = plainTextFromMarkup(song.content)` so the textarea shows the imported chords and the content/merge logic keeps working. The form then counts as unsaved (`dirty`), and nothing is stored until Save. A failed import keeps the paste box and shows the error, as now.
  - `canSave`: `title.trim() !== "" && !saving` (no key requirement), and `bandKey` stays `""` when there's no key, as `save()` already does.

### Not doing
Official Spotify API or OAuth; stripping title suffixes; fetching keys from Spotify; storing the Spotify link; importing more than 100 tracks.

## Files
- New: `src/shared/playlist.ts`, `netlify/functions/lib/spotify.ts`, `netlify/functions/playlist.ts`, `src/app/components/PlaylistImport.tsx`, `tests/fixtures/spotify-embed.html` (a trimmed real embed page), `docs/superpowers/specs/2026-11-13-spotify-playlist-import-design.md` (this design, committed first).
- Modified: `src/shared/types.ts`, `netlify/functions/lib/repo.ts`, `netlify/functions/songs.ts`, `src/app/api.ts`, `src/app/pages/GigsPage.tsx`, `src/app/pages/GigPage.tsx`, `src/app/pages/SongsPage.tsx`, `src/app/pages/SongFormPage.tsx`, `CHANGELOG.md`.

## Verification
- TDD, with these tests:
  - `tests/shared/playlist.test.ts`: match key, paste parsing (last separator, en dash, no separator, blank lines).
  - `tests/server/spotify.test.ts`: URL forms (`?si=`, intl path, `spotify:` URI, non-Spotify → `not_spotify`), fixture parse, blocked/garbled HTML.
  - `tests/server/repo.test.ts`: keyless song create/update; `importSongs` reuse (case and whitespace differences), dedupe, order, limit, idempotent retry; `hasChords`.
  - `tests/server/api.test.ts`: `POST /api/songs/batch`, `/api/playlist` error mapping.
  - `tests/app/SongFormPage.test.tsx`: Edit import keeps title/artist, fills key/capo/chords, keeps a set band key; save without a key.
  - `tests/app/GigPage.test.tsx` and a new `tests/app/GigsPage.test.tsx`: preview, untick, failed save keeps input, append skips setlist songs, "No chords yet".
- `npm test` and `npm run build` pass.
- Manual: `npm run dev` → New gig with a real public playlist link → the gig opens with the setlist in order, existing songs reused → open a song → Edit → Import a UG link → Save. Also try a bad link and check that the paste fallback works, and Import Playlist on an existing gig.
