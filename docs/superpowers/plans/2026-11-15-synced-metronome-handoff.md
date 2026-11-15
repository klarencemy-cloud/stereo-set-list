# Metronome v2: synced per-song metronome

## Context
Metronome v1 (Tools page) only clicks on one phone. The band wants this: when someone starts the metronome on a song, anyone else who opens that song's metronome joins and clicks **in time** with them. Decisions so far (from the user):
- **Anyone** can change the tempo, start it or stop it. The last change wins.
- **Click plus beat flash.**
- **The session is per song.** The metronome opens from SongPage. Opening the same song's metronome joins a session that is already running.
- **Songs store a tempo:** optional `bpm` and `beatsPerBar`, empty when unknown.
- **Calibration:** a "nudge ±ms" slider per phone, plus an optional tap-along helper that fills in the slider.

The Tools page metronome stays as it is (local only, v1).

## How it works (one paragraph)
Only the session record goes over the network, never the clicks. The record `{bpm, beatsPerBar, startAt, running}` is stored per song. Beat *n* is at `startAt + n·60000/bpm` on the **server's clock**, and beat *n* is accented when `n % beatsPerBar === 0`. Each phone works out how far its clock is from the server's: it calls `/api/time` about 10 times and keeps the fastest round trip (Cristian's algorithm). It then books clicks locally on its Web Audio clock and applies its own nudge. **The server** works out `startAt` for every change: about 2 s ahead, on the next bar line of the current beat grid. That way every phone that checks every 1.5 s hears about the change before it happens, and the beat grid doesn't jump.

## Steps

### 0. Docs first (brainstorming output)
- Spec: `docs/superpowers/specs/2026-11-15-synced-metronome-design.md`. Plan: `docs/superpowers/plans/2026-11-15-synced-metronome.md`. Both follow this plan.
- Update `docs/superpowers/ideas/2026-11-14-feature-ideas.md`:
  - mark v2 as in progress;
  - fix the stale "not committed" note and the tuner section, which is now chromatic with an adjustable A4.

### 1. Song tempo fields (shared + server)
- `src/shared/types.ts`: add `bpm: number | null` and `beatsPerBar: number | null` to `Song` (so they're in `SongInput` too).
- `netlify/functions/lib/repo.ts`:
  - add both to `SONG_FIELDS` and `checkSongField`:
    - `bpm` is `null` or a whole number from 30 to 300 (reuse `MIN_BPM`/`MAX_BPM`; move them from `src/app/metronome/schedule.ts` to `src/shared/metronome.ts` and re-export them);
    - `beatsPerBar` is `null` or 2–7.
  - Older stored songs don't have these fields. Add one `toSong()` normaliser that sets missing fields to `null`, and send **every** song read path through it (get, list/summary, after update, import). This follows CLAUDE.md's "same normalising helper" rule.
  - Non-partial `cleanSong` currently requires every field. Make `bpm`/`beatsPerBar` default to `null` when they're missing, so older clients and the import keep working.
  - `blankSong` (playlist import) sets `null`, never a made-up 120.
- Empty-field rule: when it's `null`, nothing shows (no "120"). Places to check:
  - SongFormPage inputs, which are blank;
  - the SongPage metronome pill, which shows "Metronome" with no number;
  - Songs list, gig view/edit and AddSongsPicker, which don't show tempo (confirm they don't break);
  - `songCache` and offline copies, where `undefined` is treated as `null`.
- `src/app/pages/SongFormPage.tsx`: an optional "Tempo (BPM)" number field and a "Beats per bar" select ("—", 2–7). An empty field saves `null`.

### 2. Shared sync maths: `src/shared/metronome.ts` (pure, used by client and server)
- `MIN_BPM`, `MAX_BPM`, `BEATS_PER_BAR`, `clampBpm` (moved here; `schedule.ts` re-exports them).
- `type MetroSession = { bpm, beatsPerBar, startAt: number /* server ms */, running: boolean, updatedAt: string }`.
- `beatsInWindow(session, fromMs, toMs): {n, timeMs, beat, accent}[]`: a stateless beat grid, so late joiners just skip to the next beat.
- `applyChange(current | null, change: {bpm?, beatsPerBar?, running?}, nowMs, leadMs = 2000): MetroSession`
  - **start:** `startAt = now + lead`.
  - **tempo or beats-per-bar change while running:** `startAt` is the first bar line of the current grid at or after `now + lead`. The new tempo starts there on beat 1.
  - **stop:** `running: false`.

### 3. Server
- `netlify/functions/time.ts` (`/api/time`): `GET` returns `{ now: Date.now() }` with `Cache-Control: no-store`. Uses the `makeTimeHandler(clock)` pattern so tests can inject a clock.
- `netlify/functions/metronome.ts` (`/api/metronome/:songId`) with `makeMetronomeHandler(repo, clock)`:
  - `GET`: returns the session, or `null` if there isn't one;
  - `PUT {bpm?, beatsPerBar?, running?}`: validates, then `applyChange` with the server clock, and returns the new session;
  - the song doesn't exist: 404.
- `repo.ts`:
  - `getMetronome`/`setMetronome` at KV key `metronome/<songId>`, with validation there (CLAUDE.md);
  - `deleteSong` also deletes the song's session;
  - a session with `running` that hasn't been updated for 6 h counts as stopped when read, so a forgotten one doesn't trap people.

### 4. Client clock + scheduling: `src/app/metronome/`
- `clock.ts` (pure):
  - `estimateOffset(samples: {sentMs, serverMs, receivedMs}[])`: offset and RTT of the fastest sample;
  - `toAudioTime(serverMs, offsetMs, link: {perfMs, audioS}, nudgeMs)` converts server time to `AudioContext` time.
- `useClockSync(active)`:
  - 10 samples on join, then 3 every 10 s;
  - keeps the best one from the last few rounds;
  - exposes `{offset, rtt, status: "syncing" | "synced" | "failed"}`;
  - re-links `performance.now()` ↔ `ctx.currentTime` on each tick (using `getOutputTimestamp()` when the browser has it).
- `useSyncedMetronome(songId, nudgeMs)`:
  - checks `/api/metronome/:songId` every 1.5 s while the panel is open;
  - after **Join**, a 25 ms look-ahead loop books clicks from `beatsInWindow` and remembers the last booked `n`, so nothing plays twice when the offset or session changes;
  - when the session changes (a new `startAt`), it clears beats not yet booked from the new `startAt` onwards.
  - The flash uses the same booked times, so it still runs if sound is unavailable.
- Reuse:
  - move `click()` out of `useMetronome.ts` into `src/app/audio.ts` so both hooks share it;
  - use `createAudioContext`, `preferPlaybackAudio` and `useWakeLock`;
  - reuse the flash/dots markup from `Metronome.tsx` by splitting out a small `BeatDisplay` component.
- `api.ts`: `getTime()`, `getMetronome(songId)`, `putMetronome(songId, change)`.

### 5. UI
- **SongPage pill:** "Metronome", plus "· 120" when `song.bpm` is set and a live dot when a session is running. It opens a `SongMetronome` panel (an inline card, not a new route). The panel shows:
  - **Not running:** the tempo starts from `song.bpm`, or else this phone's last-used tempo. Buttons: −/+, slider, tap tempo, beats per bar, and **Start for everyone**.
  - **Running and not joined:** "Playing at 120 BPM" and **Join**. This tap also unlocks audio.
  - **Joined:** the beat flash and dots. Tempo controls send a change, which takes effect on the next bar for everyone. **Leave** stops only this phone; **Stop for everyone** stops the session.
  - **Sync status:** "Synced ±8 ms" or "Can't sync: playing on this phone only". When offline or `/api/time` fails, it falls back to local v1 `useMetronome`.
  - **Save as song tempo:** shown when the session's bpm/beats per bar differ from the song's. It saves through the normal song update with `baseVersion`, using `ConflictNotice` on a conflict.
  - **Warnings:** Bluetooth earphones lag 150–300 ms (use wired earphones or calibrate); the iPhone silent switch; keep the screen on.
- **Calibration** (a collapsible "Calibrate this phone" section in the panel):
  - Nudge slider from −300 to +300 ms in 5 ms steps, saved in localStorage `stereo-set:metronome-nudge`. Plus means "my phone sounds late, play earlier".
  - **Tap-along:** plays 12 local clicks at 90 BPM, and you tap the big button on each click. `nudgeFromTaps(clickTimes, tapTimes)` (pure, in `clock.ts`) matches each tap to its nearest click and ignores the first 4 taps and any more than 200 ms off. It takes the median, needs at least 5 good taps, and puts the result into the slider ("Measured +140 ms, saved"). Otherwise it says "Couldn't measure, try again".

### 6. Tests (write first)
- `tests/shared/metronome.test.ts`:
  - `beatsInWindow`: late joiner, accents, window edges;
  - `applyChange`: start lead, tempo change lands on the next bar line ≥ now+lead, beats-per-bar change, stop.
- `tests/app/clock.test.ts`:
  - `estimateOffset` with simulated asymmetric round trips (the fastest one wins);
  - `toAudioTime` with offset and nudge;
  - `nudgeFromTaps`: outliers, too few taps, median.
- `tests/server/`:
  - time handler with an injected clock;
  - metronome handler with `memoryKV()`: GET with no session, PUT start/change/stop, validation errors, 404 for an unknown song, session removed when the song is deleted, a stale running session reads as stopped;
  - song `bpm`/`beatsPerBar` validation, and an older song with no fields reads back as `null` through get **and** list.
- `tests/app/`:
  - SongPage pill and panel: Start → PUT; a running session → Join; Leave vs Stop for everyone; the offline fallback message;
  - SongFormPage tempo fields, where empty saves `null`;
  - the calibration slider is saved;
  - existing ToolsPage and schedule tests still pass.

## Critical files
`src/shared/types.ts`, `src/shared/metronome.ts` (new), `netlify/functions/lib/repo.ts`, `netlify/functions/time.ts` (new), `netlify/functions/metronome.ts` (new), `src/app/api.ts`, `src/app/audio.ts`, `src/app/metronome/{clock.ts,useClockSync.ts,useSyncedMetronome.ts}` (new), `src/app/metronome/{schedule.ts,useMetronome.ts}` (small moves only), `src/app/components/{Metronome.tsx,SongMetronome.tsx (new),BeatDisplay.tsx (new)}`, `src/app/pages/{SongPage.tsx,SongFormPage.tsx}`, `src/app/styles.css`.

## Verification
- Run `npm test` and `npm run build` (type-check plus both Rollup entries) and report the actual output.
- Manual test with `npm run dev`:
  - open the same song in two browser windows, or on a laptop and a phone on the LAN;
  - Start in one window, Join in the other, and confirm the clicks and flashes line up and the sync status shows ±ms;
  - change the tempo from the joined phone and confirm both switch on the same bar line;
  - Stop for everyone stops both;
  - offline mode falls back to local;
  - a song with no bpm shows no number anywhere.
- No commit, push or merge unless asked.

## Prompt for the next agent
```text
Build Metronome v2: a synced, per-song metronome. Several band members' phones click in time with each other. v1 (src/app/metronome/, src/app/components/Metronome.tsx on the Tools page) already exists. Keep the Tools page metronome local and unchanged.

The design is already settled. Don't re-brainstorm or re-ask these:
- Per-song sessions. The metronome opens from a "Metronome" pill on SongPage, as an inline panel, not a new route. If someone already started that song's metronome, others see "Playing at N BPM" and tap Join to click in sync.
- Anyone can start, stop or change the tempo. The last change wins.
- Click plus beat flash. The flash still works when sound isn't available.
- Song gets optional bpm (30-300) and beatsPerBar (2-7), stored as null when unknown, never a made-up default.
- Calibration: a per-phone "nudge ±ms" slider (-300..+300, 5 ms steps, in localStorage), plus a tap-along helper that measures the delay and fills in the slider.

First, write the spec to docs/superpowers/specs/2026-11-15-synced-metronome-design.md and the plan to docs/superpowers/plans/2026-11-15-synced-metronome.md. Then build it test-first (superpowers:test-driven-development).

How it works:
- Only the session record crosses the network: {bpm, beatsPerBar, startAt (server ms), running, updatedAt}. Beat n is at startAt + n*60000/bpm on the server clock, and beat n is accented when n % beatsPerBar === 0.
- The server computes startAt for every change, about 2 s ahead:
  - start: now + lead;
  - a tempo or beats-per-bar change while running: the first bar line of the current grid at or after now + lead, so the grid never jumps;
  - stop: running false.
- Clock sync uses Cristian's algorithm. Call /api/time about 10 times on Join and keep the fastest round trip: offset = serverTime - midpoint. After that, take 3 samples every 10 s. Each sync, re-link performance.now() to AudioContext.currentTime (use getOutputTimestamp() where available).
- Followers check the session every 1.5 s. No WebSockets.

Build:
1. src/shared/metronome.ts (pure, used by client and server):
   - move MIN_BPM, MAX_BPM, BEATS_PER_BAR and clampBpm here from src/app/metronome/schedule.ts, and re-export them from there;
   - add the MetroSession type;
   - beatsInWindow(session, fromMs, toMs): a stateless grid, so late joiners skip ahead;
   - applyChange(current, change, nowMs, leadMs = 2000).
2. Song fields:
   - add bpm and beatsPerBar (number | null) to Song in src/shared/types.ts;
   - in netlify/functions/lib/repo.ts, validate them in SONG_FIELDS and checkSongField, and default them to null when missing so older clients and the import keep working;
   - add ONE toSong() normaliser (missing fields become null) and send every song read path through it (get, list/summary, update result, import). See CLAUDE.md "same normalising helper";
   - blankSong sets null.
   - SongFormPage: an optional "Tempo (BPM)" field and a "Beats per bar" select ("—", 2-7). Empty saves null.
   - Check every place an empty value could show (CLAUDE.md empty-field rule, including songCache and offline copies, where undefined is treated as null).
3. Server, following the makeXHandler pattern with an injectable clock:
   - netlify/functions/time.ts at /api/time: GET returns {now}, with Cache-Control: no-store;
   - netlify/functions/metronome.ts at /api/metronome/:songId: GET returns the session or null, PUT {bpm?, beatsPerBar?, running?} applies applyChange with the server clock, and an unknown song is 404;
   - in repo.ts: getMetronome/setMetronome at KV key metronome/<songId>, with validation there. deleteSong also removes the session. A running session not updated for 6 h reads as stopped.
4. Client, in src/app/metronome/:
   - clock.ts (pure): estimateOffset(samples), toAudioTime(serverMs, offsetMs, link, nudgeMs), nudgeFromTaps(clickTimes, tapTimes). nudgeFromTaps matches each tap to its nearest click, ignores the first 4 taps and anything more than 200 ms off, takes the median, and needs at least 5 good taps, otherwise null;
   - useClockSync(active);
   - useSyncedMetronome(songId, nudgeMs): a 25 ms look-ahead loop that books clicks from beatsInWindow and tracks the last booked n, so nothing plays twice when the offset or session changes.
   - Move click() from useMetronome.ts into src/app/audio.ts and reuse it. Reuse createAudioContext, preferPlaybackAudio and useWakeLock.
   - Split the flash and dots markup out of Metronome.tsx into a BeatDisplay component that both use.
   - Add getTime, getMetronome and putMetronome to src/app/api.ts.
5. UI: src/app/components/SongMetronome.tsx, opened from a SongPage pill. The pill shows "Metronome", plus "· 120" when song.bpm is set and a live dot when a session is running.
   - Not running: the tempo starts from song.bpm, or else this phone's last-used tempo. Controls are −/+, slider, tap tempo and beats per bar, plus "Start for everyone".
   - Running and not joined: "Playing at N BPM" with Join, which unlocks audio.
   - Joined: beat flash and dots. Tempo changes apply on the next bar for everyone. "Leave" stops this phone only; "Stop for everyone" stops the session.
   - Sync status: "Synced ±N ms", or, when offline or /api/time fails, "Can't sync: playing on this phone only", falling back to the v1 useMetronome.
   - "Save as song tempo" appears when the session's tempo differs from the song's. It saves through the normal song update with baseVersion and shows ConflictNotice on a conflict.
   - A collapsible "Calibrate this phone" section: the nudge slider and a tap-along mode (12 local clicks at 90 BPM, a big tap button, "Measured +140 ms, saved" or "Couldn't measure, try again").
   - Short warnings: Bluetooth earphones lag 150-300 ms, the iPhone silent switch, keep the screen on.

Tests (write them first):
- tests/shared/metronome.test.ts: beatsInWindow (late joiner, accents, window edges), and applyChange (start lead, tempo change on the next bar line, beats-per-bar change, stop).
- tests/app/clock.test.ts: estimateOffset with asymmetric round trips, toAudioTime with offset and nudge, and nudgeFromTaps.
- tests/server/, using memoryKV() and no mocked Blobs:
  - time handler;
  - metronome GET/PUT start/change/stop, validation, unknown-song 404, cleanup on song delete, stale session;
  - song bpm/beatsPerBar validation, and an older song with no fields reads as null through both get and list.
- tests/app/:
  - SongPage panel: Start sends a PUT, a running session shows Join, Leave vs Stop for everyone, the offline fallback;
  - SongFormPage tempo fields, where empty saves null;
  - the calibration slider is saved.
- Existing ToolsPage and schedule tests must still pass.

Finally, update docs/superpowers/ideas/2026-11-14-feature-ideas.md:
- mark Metronome v2 as done and awaiting review, with a "Built" note;
- fix the stale "not committed" note (features 1-4 are in commits 10c38d2 and 0d3c50f);
- rewrite the Tuner section to match the chromatic tuner with an adjustable A4 (415-466 Hz).

Follow CLAUDE.md. Run npm test and npm run build and report the actual output before saying it works. Also try it with npm run dev: open the same song in two windows, Start in one and Join in the other, check the clicks and flashes line up, then change the tempo and Stop for everyone. Don't commit, push or merge unless I ask.
```
