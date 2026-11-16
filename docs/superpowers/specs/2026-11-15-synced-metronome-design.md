# Synced metronome (Metronome v2)

Date: 2026-11-15, updated 2026-11-16. Branch: `feat/lyrics-and-tools`. Handoff:
`docs/superpowers/plans/2026-11-15-synced-metronome-handoff.md`.

This spec describes the app as it is after a2acd91 (matching the leader by ear, [ADR 0001](../../adr/0001-match-the-leader-by-ear.md)),
and the changes the robustness plan (#4) makes to it. Each of those is marked **Planned (#N)** until its ticket
lands; the text around it says what the app does today. Terms are used as `GLOSSARY.md` defines them: session,
grid, lead, join, leader, match, nudge, network round trip, loopback delay.

## Why

Metronome v1 (on `/tools`) clicks on one phone only. The band wants every phone that opens a song's metronome
to click in time with the others, so a count-in or a practice run sounds like one click, not five.

## Decided by the user

- **Per-song sessions.** The metronome opens from a "Metronome" pill on SongPage as an inline panel (no new
  route). Opening the metronome of a song whose session is running shows "Playing at N BPM" and a **Join** button.
- **Anyone** can start, stop or change the tempo. The last change wins.
- **Click plus beat flash.** The flash still runs when the phone can't play sound.
- **Songs store a tempo:** optional `bpm` (30–300) and `beatsPerBar` (2–7). Unknown is stored as `null` and
  shown as nothing, never as a made-up 120.
- **The nudge:** a per-phone slider (−300..+300 ms, 5 ms steps, in localStorage), plus a tap-along helper
  that measures this phone's speaker or earphone delay and fills in the slider.
- **Joining phones match the leader by ear** (ADR 0001). The server still sets the grid; the leader never
  sends a beat.
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
}
```

### The grid

- Beat *n* (n ≥ 0) is at `startAt + n·60000/bpm` on the **server's clock**, accented when `n % beatsPerBar === 0`.
  Every phone in a session plays this one grid.
- **The server works out `startAt`** on every change (`applyChange`), with a lead of 3000 ms (`LEAD_MS`), so
  a joined phone on a slow downlink still hears about a start or a change before its beat 1:
  - start (from stopped or no session): `startAt = now + lead`;
  - tempo or beats-per-bar change while running: the first bar line of the current grid at or after
    `now + lead`. The new tempo starts there on beat 1, so the grid never jumps;
  - change while stopped: the new tempo is stored, nothing starts;
  - stop: `running = false`, immediately.
- **Planned (#8): every change goes through compare-and-swap.** The server reads the session with its version tag
  (the store's ETag) and writes only if the tag still matches, with a short retry loop. A Stop is applied to the latest session, so a
  tempo change sent at the same moment can't overwrite it. Today the last write wins outright.
- **Planned (#11): "only if stopped" starts.** Start for everyone sends "only if stopped". When the session is
  already running, the server leaves it as it is and answers with the current session marked as not applied.
  The panel then shows "Already playing at N BPM — Join" instead of changing everyone's tempo.
- **Planned (#13): the previous grid.** A change that arrives before the current session's start (the lead of
  an earlier change) replaces that session instead of stacking on it. Its start stays put if that is still at
  least about 1.5 s away; otherwise it moves to the next bar line of the grid that is sounding, at least one lead
  ahead. The record also keeps that sounding grid as an optional `prev` (bpm, beats per bar, start), so a phone
  that only sees the latest record still plays the right bar until the new start, and a phone that joins during
  the lead hears the sounding grid instead of silence.

### The leader

- The phone that taps **Start for everyone** sends its device id (`deviceId()`: a random id kept in
  localStorage at `stereo-set:device-id`) as `leader`. The server stores it on a start, and keeps it through
  every later change, including a stop. A start without one stores no leader.
- The leader is the reference the other phones match by ear. It does not set the grid or send the beat, and it
  never listens: it plays by the clock.
- Sessions started before leaders existed have none. Joining phones then play by the clock alone.

### Checking the session

- While the panel is open, the phone checks `GET /api/metronome/:songId`: every 1.5 s while joined (also while
  the session is stopped, so a restart reaches it), and every 10 s while not joined. With the 3 s lead, every
  joined phone hears about a change before it happens. No checks while the page is hidden (screen off, app in
  the background); one check straight away when it is visible again, and one on Join, and one after this
  phone's Start answer. No WebSockets.
- The next check is timed from when the last one started, but waits for its answer, so checks never overlap.
- **Planned (#24): the joined check becomes 2 s.** That is about 25 % fewer function calls on Netlify's Free plan.
  With the 3 s lead, a downlink up to about 900 ms still hears a change in time.
- **Planned (#12): seen-at.** A joined phone's check asks the server to mark the session seen. The server writes
  a seen-at time only when the stored one is over 10 minutes old, so at most one write per 10 minutes per session.
- **Planned (#15, #16): checks that can't freeze or undo.** Every check and time call gets a timeout (about
  2.5 s and 2 s). Two failed checks in a row show "Can't reach the server" and drop "Synced". The next check is
  scheduled even while one is still in flight, and a late answer to a check from before a restart of the checks is dropped. An answer
  whose session is older (by `updatedAt`) than the one held is ignored, and the phone checks at once after Stop
  and after a change, as it already does after Start.

### Clock sync

- **Cristian's algorithm**, while this phone is joined: `GET /api/time` answers the server's time, and each call
  is a sample `offset = serverMs − (sentMs + receivedMs)/2` (both local times from `performance.now()`). The
  phone keeps the sample with the fastest network round trip.
- **The first round is 20 samples**, one at a time (parallel calls would queue and look slower). Then a round
  of 3 every 60 s, and the best sample is chosen from the last 3 rounds, so a slow patch of network doesn't stick.
- **Drift:** the least-squares slope of each round's best clock offset over the last 10 rounds, once there are at
  least 3 rounds spanning at least 2 minutes (0 before that), capped at 200 ppm (anything steeper is the network, not the clock). A matched phone uses it.
- No samples while the page is hidden; a round straight away when it is visible again.
- "Synced ±N ms" shows half the network round trip of the sample in use.
- **Planned (#14): the clock syncs when the panel opens**, not on Join or Start, so the first round is done
  before anyone taps. After the first round, the check answers supply the samples (#9), so the separate 60 s
  rounds stop; not joined, the panel's 10 s check keeps feeding samples. A full round still runs after a paused
  clock is detected (#18).
- **The server's time in every answer.** Each metronome GET and PUT answer carries the server's time (see API),
  so while joined each answer is also a clock sample, with the phone's own send and receive times around the call.
  It joins the latest round, so it competes with that round's samples and ages out with it. Answers that land
  while the first round runs join it when it lands; if every time call of a round failed, the answers start a
  round of their own, so the phone still syncs.
- **Planned (#18): a paused clock is detected.** When the page is visible again and the wall clock and
  `performance.now()` moved apart by over about 50 ms, `performance.now()` paused during sleep. A phone syncing
  by the clock then drops its old samples and takes a full round; a matched phone clears its match and listens
  again (see below). With no pause, nothing changes.
- **Planned (#18): fresher samples win.** On a network round trip tie, the newer sample wins, and each sample's
  score is its network round trip plus its age times about 0.1 ms per second, so old samples age out.

### Playing the grid

- After Join, the clicks are **one bar rendered into a buffer that the audio engine loops by itself**
  (`startClickLoop`), lined up with the grid. Phones pause a page's timers when the screen is off but keep
  playing audio that is already running, so the clicks don't depend on a timer firing.
- **Server time → audio time:** local time is `serverMs − clockOffset − nudge` (for a matched phone, the match's
  shift is added on top of the nudge in memory; the saved nudge doesn't change). Local time → audio time uses a link `{perfMs, audioS}` from
  `getOutputTimestamp()` when the browser has it (it allows for output latency), else
  `{performance.now(), ctx.currentTime}`.
- **A 25 ms tick** (while the page runs and this phone is joined and synced) books a loop for a new grid, stops older loops at its start, pulls a
  drifting loop back, and moves the flash. A loop more than 10 ms off the grid is stopped at the next bar line
  at least 100 ms ahead and a corrected loop starts there.
- **Tempo changes:** the phone keeps the grid that is sounding (in memory, if it had already started) and plays
  it until the new `startAt`, then the new grid. A phone that joins during the lead has no previous grid, so it
  is silent until the new bar (fixed by #13's `prev`).
- **Planned (#22): smoother re-aligning.** The audio link is fitted as a line through the last 1–2 s of
  `(perfMs, audioS)` pairs, rather than one reading per tick. A loop is re-aligned only when the median phase
  error over about 8 ticks in a row is over about 12 ms.
- **Planned (#23): an early loop finishes its bar first.** A loop that runs early is stopped at its own bar
  line, before that bar line's click, and the corrected loop starts on the grid's bar line, so nothing is cut
  and nothing plays twice. Late loops already re-align cleanly.
- **Planned (#17): paused sound is shown.** While joined and the audio context isn't running (a call, Siri, the
  lock screen), or its clock stops advancing, the panel shows "Sound paused — tap to resume". The tap resumes the
  context inside the gesture and re-books the loops without a cut or doubled click. Today the phone only tries
  to resume the context when the page is visible again.

### Matching by ear (ADR 0001)

A joining phone lines its clicks up with the leader's by listening to them. Clock sync alone can't see a
lopsided network round trip, nor each phone's output delay.

- **When:** this phone is joined, synced and has sound; the session is running with a leader that isn't this
  phone; this phone's loopback delay is measured; and it has no match for this leader yet (or "Listen again" was
  tapped).
- **Listening:** the phone books no loops and records the mic (`listen()`: an AudioWorklet on the context's own
  clock, with a ScriptProcessor fallback; the mic is always released) for 2 bars and at least 3 s, plus the wait
  when the session hasn't started yet. The flash keeps going. The status says "Listening to the band…".
- **The match:** `detectOnsets` finds the clicks heard (an energy envelope over 1 ms, refined to the first
  sample at 20 % of the click's peak, nothing counted within 60 % of a beat after one). Each heard click minus
  the loopback delay is when it was played. `matchShift` pairs each beat this phone would play by the clock with
  the nearest of those within half a beat. The median of the differences is the shift, the median absolute
  deviation is the spread. Fewer than 5 matched beats, or a spread over 10 ms, is no match.
- **Once matched**, the shift is added on top of the nudge (in memory only), and the clock offset is frozen at its value when listening began,
  with only drift added after that, so a later sync round can't undo the match. The status says "Matched to the
  band ±N ms" (N is the spread).
- A tempo change keeps the match. A tempo change during listening listens again. A new leader clears the match
  and listens again. Leaving clears it, so the next Join listens again.
- **No match** (mic blocked, nothing heard, too unsure): the phone plays by the clock and shows "Couldn't hear
  the band, synced by clock ±N ms" and **Listen again**.
- **Planned (#18): a matched phone that slept listens again.** When a paused clock is detected, it clears its
  match and listens again: quiet for about 3–4 s, flash still on. Today its frozen offset stays wrong until it
  leaves (ADR 0001's consequence).

### Loopback delay

- **Measure this phone** (under Calibrate this phone) plays 8 clicks, 0.8 s apart, and times how long each takes
  to reach this phone's own mic (`measureRoundTrip`: the first onset after each click, the median of at least 5,
  a spread of at most 10 ms). It is saved at `stereo-set:metronome-roundtrip`. Nothing is saved if too few clicks
  are heard; the panel says to turn the sound up, unplug earphones and try somewhere quiet.
- Without a measured loopback delay, a joining phone can't match, and the panel says "To match the band by ear,
  open Calibrate this phone and tap Measure this phone."

### Sync phases

How a joined phone is lined up with the band (`SyncPhase`), and what its status line says once synced:

| Phase | When | Status |
|---|---|---|
| leading | this phone started the session | "Leading · synced ±N ms" |
| listening | recording the leader, no loops booked | "Listening to the band…" |
| matched | lined up by ear | "Matched to the band ±N ms" |
| failed | couldn't hear the band, so it plays by the clock | "Couldn't hear the band, synced by clock ±N ms" + Listen again |
| clock | nothing to match yet: no leader, the loopback delay isn't measured, no sound, or listening hasn't begun | "Synced ±N ms" |

Before the first round finishes it shows "Syncing...".

- **Planned (#20): clock-only phones warn.** A phone that plays by the clock alone (the clock or failed phase:
  it couldn't hear the band, or its loopback delay isn't measured) gets the warning style when its ±N is over
  25 ms, suggesting measuring this phone or using Wi-Fi. A matched phone never shows it.

### Stale sessions

- A running session not changed (start, stop, tempo) for 2 h reads as stopped, so a forgotten one doesn't trap
  the next rehearsal.
- **Planned (#12):** staleness runs from the later of the last change and the last seen-at, so a session with a
  phone joined keeps running past 2 h. A session nobody joins still reads as stopped after 2 h.

### Fallback

- When the session can't be fetched before its first answer (offline), or a joined phone's first clock round
  gets no sample at all, the panel says "Can't sync: playing on this phone only" and offers the v1 local metronome at the same tempo, with **Try syncing again**. Once a
  session has been seen, a failed check shows "Can't reach the server: changes from others won't show until it's
  back."
- **Planned (#19):** "Try syncing again" checks at once and shows the result. While the local metronome plays,
  the network coming back keeps it playing and offers "Back online — switch to the shared metronome?" instead of
  stopping it.

## API

- `GET /api/time` → `{ now }` with `Cache-Control: no-store`.
- Every metronome answer (GET and PUT) is an envelope, `MetroAnswer`: `{ session, now }`, the session (or
  `null`) and the server's time when it answered. The client and server ship together; older offline copies
  are not a concern for this endpoint. Errors (400, 404, 409) are not envelopes: they answer `{ message }` (and
  `current` on a 409) as before.
- `GET /api/metronome/:songId` → the envelope, with the session or `null`. 404 when the song doesn't exist. One storage read
  when a session exists (`metronome/<songId>` is read first; a session implies its song exists); the song is
  only looked up, for the 404, when there is no session.
- `PUT /api/metronome/:songId` with `{ bpm?, beatsPerBar?, running?, leader? }` → the envelope, with the new session.
  - `bpm` whole 30–300, `beatsPerBar` whole 2–7, `running` boolean, at least one of them; otherwise 400.
  - `leader` is optional text of 1–64 characters (`LIMITS.metroLeader`); it is used by a start only.
  - Starting when there is no stored session needs `bpm` and `beatsPerBar` (no invented default); otherwise 400.
  - A stop when there was never a session answers the envelope with `session: null`.
  - 404 when the song doesn't exist.
- Both metronome answers are `Cache-Control: no-store`.
- Every read path goes through one normaliser (`toMetroSession`): it keeps only the known fields, a leader only
  when it is valid, and applies staleness, the same way on GET and PUT.
- **Planned (#11, #13, #12):** the envelope also says, for a start, whether it was applied (#11). The normaliser
  also keeps a valid `prev` (#13) and seen-at (#12).
- **Planned (#25): shared answers behind a switch.** A Netlify environment switch, off by default. When on, the
  GET answer may be served from Netlify's cache for about 1 s under a per-song cache tag, and every stored change
  purges that tag. Check answers are then not used as clock samples (a cached server time can be 1 s old), so the
  separate time rounds return, and ignoring older answers (#16) protects against a stale cached session. The
  switch is turned on only after a hand test on a deploy preview passes (#26).
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
- **Status:** the sync phase line (see Sync phases), "No sound on this phone: follow the flash.", and "Can't
  reach the server" when a check fails.
- **Save as song tempo:** shown when the session's bpm/beats per bar differ from the song's. Saves through
  `api.updateSong` with `baseVersion`; a 409 shows `ConflictNotice`.
- **Calibrate this phone** (collapsible):
  - the nudge slider (+ means "my phone sounds late, play earlier");
  - **Tap along:** 12 local clicks at 90 BPM and a big Tap button. `nudgeFromTaps` matches each tap to its
    nearest click, skips the first 4 taps and any more than 200 ms off, takes the median and needs at least 5
    good taps. Shows "Measured +140 ms, saved" or "Couldn't measure, try again";
  - **Measure this phone:** the loopback delay (see above).
- **Warnings:** Bluetooth earphones lag 150–300 ms (use wired or calibrate); iPhone silent switch; keep the
  screen on (the song page holds a wake lock while it is open, joined or not).
- **Planned (#21):** when the phone drops the wake lock while the page is visible, the app asks again, silently;
  a refusal shows nothing. The panel is keyed by the song, so a song change can never reuse the previous song's
  state.

## Code layout

- `src/shared/metronome.ts` (pure): `MIN_BPM`, `MAX_BPM`, `BEATS_PER_BAR`, `clampBpm` (moved from
  `schedule.ts`, which re-exports them), `MetroSession`, `MetroChange`, `LEAD_MS`, `beatsInWindow`, `gridBeats`,
  `applyChange`.
- `netlify/functions/time.ts`, `netlify/functions/metronome.ts` (`makeTimeHandler(clock)`,
  `makeMetronomeHandler(repo, clock)`); `repo.getMetronome` / `repo.setMetronome`, with `checkMetroChange`,
  `toMetroSession` and `METRO_STALE_MS` in `repo.ts`.
- `src/app/metronome/clock.ts` (pure): `estimateOffset`, `fitDrift`, `toAudioTime`, `nudgeFromTaps`.
- `src/app/metronome/match.ts` (pure): `detectOnsets`, `matchShift`, `measureRoundTrip`.
- `src/app/metronome/loop.ts` (pure): `renderBar`, `loopStart`, `phaseError`.
- `src/app/metronome/listen.ts`: mic capture on the context's clock.
- `src/app/metronome/useClockSync.ts`, `useSyncedMetronome.ts`; `src/app/device.ts` (`deviceId`);
  `click()`, `audioLink()` and `startClickLoop()` in `src/app/audio.ts`.
- `src/app/components/BeatDisplay.tsx` (shared with `Metronome.tsx`), `SongMetronome.tsx`.

## Not doing

- WebSockets, or a leader that sends the beat (matching the leader by ear is not that: ADR 0001).
- Subdivisions or different click sounds.
- Gig-wide sessions (a per-phone Follow switch is #3).
- The NTP-style two-timestamp time endpoint (out of scope in #4): it fixes only the network part, not the output
  delay (ADR 0001), and matching by ear covers both between phones.
