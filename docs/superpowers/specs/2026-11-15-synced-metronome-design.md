# Synced metronome (Metronome v2)

Date: 2026-11-15, updated 2026-11-20. Branches: `feat/lyrics-and-tools`, then `fix/metronome-clock-only`. Handoffs:
`docs/superpowers/plans/2026-11-15-synced-metronome-handoff.md`,
`docs/superpowers/plans/2026-11-20-metronome-clock-only-handoff.md`.

This spec describes the app after the clock-only fix ([ADR 0002](../../adr/0002-no-matching-by-ear-for-now.md),
which supersedes ADR 0001): joining phones play by the clock alone, and the robustness fixes from
`docs/superpowers/reviews/2026-11-15-synced-metronome-robustness.md` that didn't hurt sync stay (the H numbers
below). Terms are used as `GLOSSARY.md` defines them: session, grid, lead, join, leader, nudge, network round trip.

## Why

Metronome v1 (on `/tools`) clicks on one phone only. The band wants every phone that opens a song's metronome
to click in time with the others, so a count-in or a practice run sounds like one click, not five.

**The target:** every joined phone's clicks within 5 ms of the grid on the same Wi-Fi, checked by tests. On mobile
data or a hotspot, as close as the clock allows: clock sync can't see a lopsided network (ADR 0002).

## Decided by the user

- **Per-song sessions.** The metronome opens from a "Metronome" pill on SongPage as an inline panel (no new
  route). Opening the metronome of a song whose session is running shows "Playing at N BPM" and a **Join** button.
- **Anyone** can start, stop or change the tempo. The last change wins.
- **Click plus beat flash.** The flash still runs when the phone can't play sound.
- **Songs store a tempo:** optional `bpm` (30–300) and `beatsPerBar` (2–7). Unknown is stored as `null` and
  shown as nothing, never as a made-up 120.
- **The nudge:** a per-phone slider (−300..+300 ms, 5 ms steps, in localStorage), under **Adjust timing**.
- **Joining phones play by the clock alone** (ADR 0002). The metronome never asks for the mic: no matching by
  ear, no loopback measurement, no tap-along. The server sets the grid; the leader never sends a beat.
- The Tools page metronome stays local and unchanged.

## How it works

Only the **session** record crosses the network, never the clicks:

```ts
interface MetroSession {
  bpm: number;
  beatsPerBar: number;
  startAt: number;   // server time (ms) of beat 0, always a bar line
  running: boolean;
  updatedAt: string; // the last change (start, stop, tempo)
  leader?: string;   // the device id of the phone that started it
  prev?: MetroGrid;  // the grid still sounding until startAt (H23)
  seenAt?: string;   // the last time a joined phone checked (H17)
}
```

### The grid

- Beat *n* (n ≥ 0) is at `startAt + n·60000/bpm` on the **server's clock**, accented when `n % beatsPerBar === 0`.
  Every phone in a session plays this one grid.
- **The server works out `startAt`** on every change (`applyChange`), with a lead of 3000 ms (`LEAD_MS`, H2), so
  a joined phone on a slow downlink still hears about a start or a change before its beat 1:
  - start (from stopped or no session): `startAt = now + lead`;
  - tempo or beats-per-bar change while running: the first bar line of the current grid at or after
    `now + lead`. The new tempo starts there on beat 1, so the grid never jumps;
  - change while stopped: the new tempo is stored, nothing starts;
  - stop: `running = false`, immediately.
- **Every change goes through compare-and-swap (H5).** The server reads the session with its version tag (the
  store's ETag) and writes only if the tag still matches, with a short retry loop. A Stop is applied to the latest
  session, so a tempo change sent at the same moment can't overwrite it.
- **"Only if stopped" starts (H18).** Start for everyone sends "only if stopped". When the session is already
  running, the server leaves it as it is and answers with the current session marked as not applied. The panel
  then shows "Already playing at N BPM — Join" instead of changing everyone's tempo.
- **The previous grid (H23).** A change that arrives before the current session's start (the lead of an earlier
  change) replaces that session instead of stacking on it. Its start stays put if that is still at least about
  1.5 s away; otherwise it moves to the next bar line of the grid that is sounding, at least one lead ahead. The
  record also keeps that sounding grid as an optional `prev`, so a phone that only sees the latest record still
  plays the right bar until the new start, and a phone that joins during the lead hears the sounding grid instead
  of silence.

### The leader

- The phone that taps **Start for everyone** sends its device id (`deviceId()`: a random id kept in
  localStorage at `stereo-set:device-id`) as `leader`. The server stores it on a start, and keeps it through
  every later change, including a stop. A start without one stores no leader.
- The leader does not set the grid or send the beat. It plays by the clock, like every other phone. Its id lets
  its own Stop not restart it (H4).

### Checking the session

- While the panel is open, the phone checks `GET /api/metronome/:songId`: every 1.5 s while joined (also while
  the session is stopped, so a restart reaches it), and every 10 s while not joined. With the 3 s lead, a joined
  phone hears about a change before its bar line on a downlink of up to about 1.4 s. No checks while the page is
  hidden (screen off, app in the background); one check straight away when it is visible again, one on Join, and
  one after this phone's Start, Stop or change answer. No WebSockets.
- The next check is timed from when the last one started.
- **Seen-at (H17).** A joined phone's check asks the server to mark the session seen. The server writes a seen-at
  time only when the stored one is over 10 minutes old, so at most one write per 10 minutes per session.
- **Checks that can't freeze or undo (H22).** Every check and time call gets a timeout (about 2.5 s and 2 s). Two
  failed checks in a row show "Can't reach the server" and drop "Synced". The next check is scheduled even while
  one is still in flight, and a late answer to a check from before a restart of the checks is dropped. An answer
  whose session is older (by `updatedAt`) than the one held is ignored (H4).

### Clock sync

- **Cristian's algorithm:** `GET /api/time` answers the server's time, and each call is a sample
  `offset = serverMs − (sentMs + receivedMs)/2` (both local times from `performance.now()`). The phone keeps the
  sample with the fastest network round trip.
- **Only `/api/time` calls are samples.** The metronome answers carry the server's time too (`now`), but the phone
  ignores it: the server reads it after the session's storage read or write, so it is late by that work and would
  put the server late.
- **The clock syncs when the panel opens (H1)**, not on Join or Start, so the first round is done before anyone
  taps. **The first round is 20 calls**, one at a time (parallel calls would queue and look slower). Then a round
  of 3 every 60 s, and the best sample is chosen from the last 3 rounds, so a slow patch of network doesn't stick.
- **Fresher samples win.** Each sample's score is its network round trip plus its age (against the newest sample)
  times 0.1 ms per second, so old samples age out; on a tie, the newer sample wins.
- **Drift:** the least-squares slope of each round's best clock offset over the last 10 rounds, once there are at
  least 3 rounds spanning at least 2 minutes (0 before that), capped at 200 ppm (anything steeper is the network,
  not the clock).
- No calls while the page is hidden; a round straight away when it is visible again.
- **A paused clock is detected (H7).** When the page is visible again and the wall clock and `performance.now()`
  moved apart by over 50 ms (since the page was hidden), `performance.now()` paused during sleep. The phone then
  drops its old samples (and any answer to a call sent before it woke) and takes a full round of 20. Until that
  round lands, the old offset moved by the measured pause stands in, so the clicks and the flash stay about right;
  if every call of that round fails, it keeps standing in. With no pause, nothing changes.
- The status says "Synced" once the first round has a sample, and "Syncing..." until then. No "±N ms" and no
  warning about rough sync: the number made players worry about timing it can't show.

### Playing the grid

- After Join, the clicks are **one bar rendered into a buffer that the audio engine loops by itself**
  (`startClickLoop`), lined up with the grid. Phones pause a page's timers when the screen is off but keep
  playing audio that is already running, so the clicks don't depend on a timer firing.
- **Server time → audio time:** local time is `serverMs − clockOffset − nudge`. Local time → audio time uses one
  link reading `{perfMs, audioS}` per tick: `getOutputTimestamp()` when the browser has it (it allows for output
  latency), else `{performance.now(), ctx.currentTime}`. No smoothing over readings.
- **A 25 ms tick** (while the page runs and this phone is joined and synced) books a loop for a new grid, stops
  older loops at its start, pulls a drifting loop back, and moves the flash.
- **Clock jitter:** a loop more than 10 ms off the grid is moved back onto it at the next bar line at least 100 ms
  ahead. Under 10 ms it stays put, so a jittery reading doesn't move it.
- **Nudge changes:** any change of the nudge, however small (even 1 ms), takes effect at the next bar line at least
  100 ms ahead. The 10 ms threshold is only for clock jitter, never for a change the player made.
- **An early loop finishes its bar first (H9).** A loop that runs early is stopped at its own bar line, before
  that bar line's click, and the corrected loop starts on the grid's bar line, so nothing is cut and nothing plays
  twice. A late loop stops at the grid's bar line.
- **Tempo changes:** until the new `startAt`, the phone plays the grid that is sounding (the session's `prev`),
  then the new grid.
- **Paused sound is shown (H12).** While joined and the audio context isn't running (a call, Siri, the lock
  screen), or its clock stops advancing, the panel shows "Sound paused — tap to resume". The tap resumes the
  context inside the gesture and re-books the loops without a cut or doubled click.

### Stale sessions

- A running session reads as stopped once 2 h have passed since the later of its last change and its last
  seen-at (H17), so a forgotten one doesn't trap the next rehearsal, while one with a phone joined keeps running.

### Fallback

- When the session can't be fetched before its first answer (offline), or a joined phone's first clock round
  gets no sample at all, the panel says "Can't sync: playing on this phone only" and offers the v1 local metronome
  at the same tempo, with **Try syncing again**. Once a session has been seen, a failed check shows "Can't reach
  the server: changes from others won't show until it's back."
- **"Try syncing again"** checks at once and shows the result, and takes a round of time calls at once too (the
  status says "Syncing..." again while a clock that never synced tries), so a phone whose first round failed
  doesn't wait for the next 60 s round. While the local metronome plays, the network
  coming back keeps it playing and offers "Back online — switch to the shared metronome?" instead of stopping it
  (H21).

## API

- `GET /api/time` → `{ now }` with `Cache-Control: no-store`.
- Every metronome answer (GET and PUT) is an envelope, `MetroAnswer`: `{ session, now }`, the session (or
  `null`) and the server's time when it answered. The phone ignores `now` (see Clock sync). Errors (400, 404, 409)
  are not envelopes: they answer `{ message }` (and `current` on a 409) as before.
- `GET /api/metronome/:songId` → the envelope, with the session or `null`. 404 when the song doesn't exist. One
  storage read when a session exists (`metronome/<songId>` is read first; a session implies its song exists); the
  song is only looked up, for the 404, when there is no session. `?seen=1` marks it seen (H17).
- `PUT /api/metronome/:songId` with `{ bpm?, beatsPerBar?, running?, leader?, onlyIfStopped? }` → the envelope,
  with the new session; a start's answer also says whether it was `applied` (H18).
  - `bpm` whole 30–300, `beatsPerBar` whole 2–7, `running` boolean, at least one of them; otherwise 400.
  - `leader` is optional text of 1–64 characters (`LIMITS.metroLeader`); it is used by a start only.
  - Starting when there is no stored session needs `bpm` and `beatsPerBar` (no invented default); otherwise 400.
  - A stop when there was never a session answers the envelope with `session: null`.
  - 404 when the song doesn't exist.
- Both metronome answers are `Cache-Control: no-store`.
- Every read path goes through one normaliser (`toMetroSession`): it keeps only the known fields, a leader, `prev`
  and seen-at only when they are valid, and applies staleness, the same way on GET and PUT.
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
  tap tempo, beats per bar, **Start for everyone** (this phone plays it too, and becomes the leader).
- **Running, not joined:** "Playing at N BPM", **Join** (this tap unlocks audio) and **Stop for everyone**.
- **Joined:** beat flash and dots, tempo controls (each change applies on the next bar for everyone; a bpm
  change is sent 400 ms after the last move), **Leave** (this phone only) and **Stop for everyone**.
- **Status:** "Syncing..." then "Synced"; "No sound on this phone: follow the flash."; "Sound paused — tap to
  resume"; and "Can't reach the server" when checks fail.
- **Save as song tempo:** shown when the session's bpm/beats per bar differ from the song's. Saves through
  `api.updateSong` with `baseVersion`; a 409 shows `ConflictNotice`.
- **Adjust timing** (collapsible): only the nudge slider (+ means "my phone sounds late, play earlier").
- **Warnings:** Bluetooth earphones lag 150–300 ms (use wired, or move the slider); iPhone silent switch; keep the
  screen on (the song page holds a wake lock while it is open, joined or not).
- When the phone drops the wake lock while the page is visible, the app asks again, silently; a refusal shows
  nothing. The panel is keyed by the song, so a song change can never reuse the previous song's state.

## Code layout

- `src/shared/metronome.ts` (pure): `MIN_BPM`, `MAX_BPM`, `BEATS_PER_BAR`, `clampBpm` (moved from
  `schedule.ts`, which re-exports them), `MetroSession`, `MetroChange`, `MetroAnswer`, `LEAD_MS`, `beatsInWindow`,
  `gridBeats`, `applyChange`.
- `netlify/functions/time.ts`, `netlify/functions/metronome.ts` (`makeTimeHandler(clock)`,
  `makeMetronomeHandler(repo, clock)`); `repo.getMetronome` / `repo.setMetronome`, with `checkMetroChange`,
  `toMetroSession` and `METRO_STALE_MS` in `repo.ts`.
- `src/app/metronome/clock.ts` (pure): `estimateOffset`, `fitDrift`, `pausedMs`, `toAudioTime`.
- `src/app/metronome/loop.ts` (pure): `renderBar`, `loopStart`, `phaseError`.
- `src/app/metronome/useClockSync.ts`, `useSyncedMetronome.ts`; `src/app/device.ts` (`deviceId`);
  `click()`, `audioLink()` and `startClickLoop()` in `src/app/audio.ts`.
- `src/app/components/BeatDisplay.tsx` (shared with `Metronome.tsx`), `SongMetronome.tsx`.

## Not doing

- WebSockets, or a leader that sends the beat.
- Matching by ear, measuring the loopback delay, or tap-along calibration (ADR 0002). Each can come back only with a
  test showing it beats the clock.
- Metronome answers as clock samples, shared (CDN-cached) answers, a 2 s joined check, and smoothing the audio
  link over readings. Each can come back only with a test showing it doesn't hurt sync.
- A "rough sync" warning or a "±N ms" in the status.
- Subdivisions or different click sounds.
- Gig-wide sessions (a per-phone Follow switch is #3).
- The NTP-style two-timestamp time endpoint.
