# Synced metronome (Metronome v2)

Date: 2026-11-15. Branch: `feat/lyrics-and-tools`. Handoff: `docs/superpowers/plans/2026-11-15-synced-metronome-handoff.md`.

## Why

Metronome v1 (on `/tools`) clicks on one phone only. The band wants every phone that opens a song's metronome
to click in time with the others, so a count-in or a practice run sounds like one click, not five.

## Decided by the user

- **Per-song sessions.** The metronome opens from a "Metronome" pill on SongPage as an inline panel (no new
  route). Opening the metronome of a song that is already playing shows "Playing at N BPM" and a **Join** button.
- **Anyone** can start, stop or change the tempo. The last change wins.
- **Click plus beat flash.** The flash still runs when the phone can't play sound.
- **Songs store a tempo:** optional `bpm` (30–300) and `beatsPerBar` (2–7). Unknown is stored as `null` and
  shown as nothing, never as a made-up 120.
- **Calibration:** a per-phone "nudge ±ms" slider (−300..+300 ms, 5 ms steps, in localStorage), plus a
  tap-along helper that measures the delay and fills in the slider.
- The Tools page metronome stays local and unchanged.

## How it works

Only the **session record** crosses the network, never the clicks:

```ts
type MetroSession = { bpm: number; beatsPerBar: number; startAt: number; running: boolean; updatedAt: string };
```

- Beat *n* (n ≥ 0) is at `startAt + n·60000/bpm` on the **server's clock**, accented when `n % beatsPerBar === 0`.
- **The server works out `startAt`** on every change (`applyChange`, lead = 2000 ms):
  - start (from stopped or no session): `startAt = now + lead`;
  - tempo or beats-per-bar change while running: the first bar line of the current grid at or after
    `now + lead`. The new tempo starts there on beat 1, so the grid never jumps;
  - change while stopped: the new tempo is stored, nothing starts;
  - stop: `running = false`, immediately.
- **Followers** poll `GET /api/metronome/:songId` every 1.5 s while this phone is joined (also while the
  session is stopped, so a restart reaches it), and every 10 s while the panel is open but not joined. With a
  2 s lead, every joined phone hears about a change before it happens. No checks at all while the page is
  hidden (screen off, app in the background); one check straight away when it is visible again, and one on
  Join. No WebSockets.
- **Clock sync** (Cristian's algorithm): on Join a phone calls `GET /api/time` 10 times and keeps the sample
  with the fastest round trip: `offset = serverMs − (sentMs + receivedMs)/2` (both local times from
  `performance.now()`). Then it takes 3 samples every 60 s and keeps the best of the last 3 rounds.
  No samples while the page is hidden; a round of 3 straight away when it is visible again.
  "Synced ±N ms" shows half that round trip.
- **Booking clicks:** a 25 ms timer books every beat whose play time falls in the next 120 ms on the
  `AudioContext` clock. Server time → local time is `serverMs − offset − nudge`; local time → audio time uses
  a link `{perfMs, audioS}` taken from `getOutputTimestamp()` when the browser has it (it allows for output
  latency), else `{performance.now(), ctx.currentTime}`. The link is renewed on every tick.
- **Nothing plays twice:** the loop remembers the server time of the last beat it booked and only books later
  beats, so a new offset or a re-fetched session can't repeat a click.
- **Tempo changes on followers:** a phone keeps the grid that is sounding and plays it until the new
  `startAt`, then the new grid. Clicks already booked at or after the new `startAt` are cancelled. (The
  record has no "previous grid", so a phone that joins during the 2 s lead is silent until the new bar.)
- **Stale sessions:** a running session not updated (start, stop, tempo) for 2 h reads as stopped, so a forgotten one doesn't
  trap the next rehearsal.
- **Fallback:** when the session can't be fetched (offline) or `/api/time` fails, the panel says
  "Can't sync: playing on this phone only" and offers the v1 local metronome at the same tempo.

## API

- `GET /api/time` → `{ now }` with `Cache-Control: no-store`.
- `GET /api/metronome/:songId` → the session or `null`. 404 when the song doesn't exist. One storage read
  when a session exists (`metronome/<songId>` is read first; a session implies its song exists); the song is
  only looked up, for the 404, when there is no session.
- `PUT /api/metronome/:songId` with `{ bpm?, beatsPerBar?, running? }` → the new session.
  - `bpm` whole 30–300, `beatsPerBar` whole 2–7, `running` boolean, at least one of them; otherwise 400.
  - Starting when there is no stored session needs `bpm` and `beatsPerBar` (no invented default); otherwise 400.
  - 404 when the song doesn't exist.
- Stored at KV key `metronome/<songId>`; deleting the song (or the track that owns it) deletes it.
- The offline service worker passes both paths straight to the network (they are not in its cached routes).

## Song fields

- `Song.bpm: number | null`, `Song.beatsPerBar: number | null` (so in `SongInput` too). `ImportedSong` (from the
  Ultimate Guitar scraper) leaves them out.
- Validation in `repo.ts`. A create that leaves them out stores `null`, so older clients keep working.
- Every song read path goes through one `toSong()` normaliser (missing → `null`): get, list, update result,
  conflict copy, import, track link.
- The client treats `undefined` (older offline copies) as `null`.
- SongFormPage: an optional "Tempo (BPM)" number field and a "Beats per bar" select ("—", 2–7). Empty saves `null`.

## UI (SongPage)

- **Pill:** "Metronome", plus " · 120" when the song has a bpm, plus a live dot when a session is running.
  It toggles the panel.
- **Panel, not running:** tempo starts from the song's bpm/beats per bar, else this phone's last-used tempo
  (the Tools page's saved setting, else 120/4 — a control value, not stored on the song). Controls: −/+, slider,
  tap tempo, beats per bar, **Start for everyone**.
- **Running, not joined:** "Playing at N BPM" and **Join** (this tap unlocks audio).
- **Joined:** beat flash and dots, tempo controls (each change applies on the next bar for everyone),
  **Leave** (this phone only) and **Stop for everyone**.
- **Sync status:** "Syncing…", "Synced ±N ms", or "Can't sync: playing on this phone only".
- **Save as song tempo:** shown when the session's bpm/beats per bar differ from the song's. Saves through
  `api.updateSong` with `baseVersion`; a 409 shows `ConflictNotice`.
- **Calibrate this phone** (collapsible): the nudge slider (+ means "my phone sounds late, play earlier") and
  a tap-along: 12 local clicks at 90 BPM and a big Tap button. `nudgeFromTaps` matches each tap to its nearest
  click, skips the first 4 taps and any more than 200 ms off, takes the median and needs at least 5 good taps.
  Shows "Measured +140 ms, saved" or "Couldn't measure, try again".
- **Warnings:** Bluetooth earphones lag 150–300 ms (use wired or calibrate); iPhone silent switch; keep the
  screen on (the panel holds a wake lock while joined).

## Code layout

- `src/shared/metronome.ts` (pure): `MIN_BPM`, `MAX_BPM`, `BEATS_PER_BAR`, `clampBpm` (moved from
  `schedule.ts`, which re-exports them), `MetroSession`, `beatsInWindow`, `gridBeats`, `applyChange`,
  `checkMetroChange`.
- `netlify/functions/time.ts`, `netlify/functions/metronome.ts` (`makeTimeHandler(clock)`,
  `makeMetronomeHandler(repo, clock)`); `repo.getMetronome` / `repo.setMetronome`.
- `src/app/metronome/clock.ts` (pure): `estimateOffset`, `toAudioTime`, `nudgeFromTaps`.
- `src/app/metronome/useClockSync.ts`, `useSyncedMetronome.ts`; `click()` moves to `src/app/audio.ts`.
- `src/app/components/BeatDisplay.tsx` (shared with `Metronome.tsx`), `SongMetronome.tsx`.

## Not doing

- WebSockets or a leader phone.
- Subdivisions or different click sounds.
- Gig-wide sessions.
