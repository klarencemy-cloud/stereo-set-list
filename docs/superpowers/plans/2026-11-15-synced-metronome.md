# Synced metronome: implementation plan

Spec: `docs/superpowers/specs/2026-11-15-synced-metronome-design.md`. Every task is test-first: write the
test, watch it fail, implement, watch it pass, then run `npm test`. No commits unless the user asks.

## Task 1: shared maths (`src/shared/metronome.ts`)
- Move `MIN_BPM`, `MAX_BPM`, `BEATS_PER_BAR`, `clampBpm` here; `schedule.ts` re-exports them.
- `beatsInWindow(session, fromMs, toMs)` → `{n, timeMs, beat, accent}[]` for beats in `[from, to)`; none when stopped.
- `gridBeats(prev, cur, fromMs, toMs)`: `prev`'s beats before `cur.startAt`, then `cur`'s.
- `applyChange(current, change, nowMs, leadMs = 2000)`; `checkMetroChange(input)` validates a PUT body.
- Tests: `tests/shared/metronome.test.ts` (late joiner, accents, window edges, start lead, tempo change on the
  next bar line ≥ now+lead, beats-per-bar change, change while stopped, stop, validation).

## Task 2: song tempo fields
- `types.ts`: `bpm`, `beatsPerBar` on `Song`; `ImportedSong` omits them.
- `repo.ts`: `SONG_FIELDS`/`checkSongField`; create defaults missing ones to `null`; one `toSong()` on every read
  path; `blankSong` sets `null`.
- `src/shared/song.ts`: `songTempo(song)` (undefined → null) for the client.
- Tests: `tests/server/repo.test.ts` (validation, defaults, old song via get **and** list, import),
  `tests/shared/song.test.ts`.

## Task 3: server endpoints
- `netlify/functions/time.ts`, `netlify/functions/metronome.ts`; `repo.getMetronome(songId, nowMs)`,
  `repo.setMetronome(songId, change, nowMs)`; `deleteSongAndTrack` removes `metronome/<songId>`; 2 h stale rule.
- Tests: `tests/server/metronome.test.ts` (time handler, GET null, PUT start/change/stop, 400s, 404s, cleanup on
  song delete, stale session), `tests/sw` check that both paths pass through.

## Task 4: client clock and hooks
- `clock.ts`: `estimateOffset`, `toAudioTime`, `nudgeFromTaps`. Tests: `tests/app/clock.test.ts`.
- `click()` → `audio.ts`; `audioLink(ctx)` helper there.
- `api.ts`: `getTime`, `getMetronome`, `putMetronome`.
- `useClockSync(active)`, `useSyncedMetronome(songId, nudgeMs)`.

## Task 5: UI
- `BeatDisplay.tsx` split out of `Metronome.tsx` (ToolsPage tests must still pass).
- `SongMetronome.tsx` panel + SongPage pill; calibration section with tap-along; SongFormPage tempo fields;
  styles.
- Tests: `tests/app/SongMetronome.test.tsx` (Start → PUT, running → Join, Leave vs Stop for everyone, offline
  fallback, calibration slider saved, Save as song tempo), `tests/app/SongPage.test.tsx` (pill label),
  `tests/app/SongFormPage.test.tsx` (tempo fields, empty saves null).

## Task 6: docs and verification
- Update `docs/superpowers/ideas/2026-11-14-feature-ideas.md` (v2 done, awaiting review; the "not committed"
  note; the Tuner section).
- `npm test`, `npm run build`, manual two-window check with `npm run dev`.
