# Synced metronome: robustness review

> **Status: to be fixed soon.** None of the fixes below have been applied yet.

Date: 2026-11-15. Branch: `feat/lyrics-and-tools` (uncommitted). Plan: `~/.claude/plans/i-want-you-to-enumerated-wand.md`.
Spec: `docs/superpowers/specs/2026-11-15-synced-metronome-design.md`.

This pass only finds and reports problems. Nothing in `src/` or `netlify/` was changed. Every fix below is a
suggestion and has not been applied.

## Summary

- **Confirmed: 16** (H1, H2, H4, H5, H6, H7, H8, H9, H11, H12, H15, H17, H18, H21, plus two found while
  testing: H22 and H23).
- **Refuted: 2** (H13, H20). Part of H5 is also refuted: when two phones change the tempo at once, the clash
  shows on screen but can't be heard.
- **Needs a real device: 2** (H3, H10). Device work is also still needed to size H7, H8 and H12. H16 (no
  countdown and no bar number) is a missing feature, not a bug.
- **Questions for you: 2** (H14, H19).
- **Worst S1 problems:**
  - one hung request silently stops a phone following the session for good (H22);
  - audio that the phone pauses goes unnoticed while the flash keeps going (H12);
  - the starter misses its own count-in on 4G (H1);
  - a Stop sent together with a tempo change is lost for everyone (H5).

How to read the evidence: `file › test name` points at a test in `tests/robustness/`. A test named `BUG Hn: …`
is an `it.fails`: it passes **because** the bug is there, and it will start failing once the bug is fixed (then
turn it into a normal `it`). Every `it.fails` was also run as a plain `it` to check that it fails on its own
user-visible assertion, not on some other error (23 of 23 did). "Live" means the two-tab run in Chrome against
`netlify dev` (Phase 3).

## Baseline (Phase 0)

- `npm test`: **46 files, 717 tests passed** (51 s).
- `npm run build`: `tsc --noEmit` clean; vite built `dist/sw.js` 2.74 kB and `main` 340.41 kB.

## Targets

| # | Target | Result | Why |
|---|---|---|---|
| T1 | Every joined phone plays beat 1, with round trips up to 1 s | **Fail** | The starter misses it above about 210 ms RTT (H1). A follower misses it when the downlink is over about 450 ms (H2). Live: the starter missed 1.5 s of bar 1. |
| T2 | ≤ 20 ms p95 on Wi-Fi, ≤ 40 ms on 4G, once calibrated | **Fail in simulation, untested on devices** | Phones on the same kind of network: 18.8 ms p95 on Wi-Fi and 19.6 ms on 4G (just passes). Mixed Wi-Fi + lopsided 4G: **38.3 ms p95, 84.9 ms max**. The 10 ms re-align deadband alone allows 20 ms between two phones. |
| T3 | Stop silences every visible joined phone within about 2 s, and never restarts it | **Fail** | It usually works (live: 0.5 s and 1.3 s). But it restarts for up to 1.5 s when a poll is in flight (H4, live too). It can be lost altogether (H5). It never arrives after one hung request (H22). |
| T4 | 30-minute soak with no double, missing or flammed clicks | **Fail in code, device untested** | An audio clock 100 ppm fast flams about every 100 s (H9). With more than ±5 ms of link jitter it re-aligns, and flams, on every bar (H8). |
| T5 | Lost sync or sound shows on screen within 2 s | **Fail** | Audio paused by the phone: nothing shown (H12). Hung request: still "Synced ±N ms" (H22). After sleep: 250 ms off while it says "Synced ±10 ms" (H7). Plain offline does work: the message shows within 2 s. |
| T6 | Swiping songs, locking or losing the network always leaves a correct, visible state | **Fail** | Swiping is fine (H13 refuted, live too). Network: offline is fine, a hung request is not (H22). Lock/unlock: H12, needs a device. |

## S1: breaks trust

### H22 (new): a request that never answers stops all checks for good
- **Status:** confirmed (code and live). **Severity: S1.**
- **Impact:** on Wi-Fi with no internet, or while a phone switches between Wi-Fi and 4G, the phone keeps
  clicking the old grid forever. It never hears Stop or a tempo change, and still says "Synced ±N ms".
- **Evidence:**
  - Test: `silent.test.tsx › BUG H22: a hung poll … the phone stops following the session`. After one hung
    poll the network recovers, but **0 checks** are sent in the next 10 s.
  - Live (tab B): one hung request, then the network was fine again and someone pressed Stop. In the next
    10 s it sent `metronomeChecksSent: 0, timeChecksSent: 0`; it was still sounding, and still said "Synced
    ±154 ms".
  - Cause: `api.ts` has no fetch timeout. The poll chain in `useSyncedMetronome.ts:122-145` only schedules
    the next check after the previous one settles, and `sampleRound` awaits each `/api/time` call in turn.
- **Suggested fix:**
  - Give `getMetronome`, `putMetronome` and `getTime` a timeout with `AbortSignal.timeout` (for example
    2.5 s for checks and 2 s for time), and count a timeout as a failed check.
  - After two failed or timed-out checks in a row, show "Can't reach the server".
  - In `check()`, schedule the next check from the timer even if the previous one hasn't settled, and drop a
    late answer by its generation.

### H12: the phone pauses the audio, and nothing notices
- **Status:** confirmed in code. How often iOS and Android do this needs a device. **Severity: S1.**
- **Impact:** after a phone call, Siri, another app's audio or the lock screen, the context is `suspended` or
  `interrupted`. The flash keeps going with no sound, and the screen says nothing.
- **Evidence:**
  - Test: `silent.test.tsx › BUG H12: the flash keeps going with no sound and nothing on screen says so`. The
    context is interrupted, `resume()` is refused, and the beat dots keep moving. No warning appears.
  - Test: `H12 measure`. After it resumes, it books one extra loop and plays 1 cut click.
  - Cause: nothing reads `ctx.state`. `noSound` only covers "no AudioContext at all".
- **Suggested fix:**
  - Listen for the context's `statechange`, and also check each tick that `ctx.currentTime` is still
    advancing.
  - While joined and the context isn't `running`, show "Sound paused — tap to resume". Tapping it calls
    `resume()`, from inside the tap so the browser allows it.
  - Re-book the loops when it resumes.

### H1: the starter, and anyone joining, waits for 10 serial clock samples before any sound
- **Status:** confirmed (code and live). **Severity: S1** (missed count-in).
- **Impact:**
  - On 4G, the person who taps Start for everyone misses the start of their own count-in.
  - Anyone who taps Join hears nothing for 10 × RTT: 5.2 s in the live run.
- **Evidence:**
  - Test: `countin.test.tsx › BUG H1: with a 300 ms round trip (4G) the starter misses the start of its own
    count-in`.
  - Test: `H1 measure` (96 BPM 3/4, 2 s lead). Beats of bar 1 the starter missed: RTT ≤ 200 ms: 0;
    220 ms: 1; 250 ms: 1; 300 ms: 2; 500 ms: 3 of 3; 1000 ms: 3 of 3. The threshold is about
    10·RTT + 50 ms > RTT/2 + 2000 ms, so **RTT ≈ 210 ms**.
  - Live: on `netlify dev`, each `/api/time` takes 308–681 ms. The starter's first click came 1521 ms after
    `startAt`, joined part-way through the 7-beat bar. Tab B's Join gave 5239 ms of silence.
- **Suggested fix (pick one or more):**
  - Start playing on the first good sample and refine as more arrive, showing "Syncing…" with the current
    bound.
  - Make the PUT and GET answers carry the server's `now`, so the start itself is a clock sample.
  - Take the samples in parallel with the PUT.
  - Keep the last offset in `sessionStorage`, so a re-join starts at once.
  - Raise the lead for a start from a stopped session to 3 s (see the simulation).

### H2: a joined follower hears about a restart too late on a slow downlink
- **Status:** confirmed. **Severity: S1** (missed count-in). It only happens on congested or slow links.
- **Impact:** when the network is slow, someone's phone misses beat 1 of a restart, or plays the old tempo past
  the bar line.
- **Evidence:**
  - Tests: `countin.test.tsx › BUG H2: 1 s round trip … misses beat 1` and `BUG H2: a slow downlink (100 ms
    up, 600 ms down) …`.
  - Test: `H2 measure`, with the change made right after the follower's poll was read. Beats missed
    against the downlink: down ≤ 440 ms: 0; 500: 1; 700: 1; 1000: 2. The threshold is **downlink ≈ 450 ms**
    (1.5 s poll + downlink + 75 ms > 2 s lead). The plan's "RTT > 450 ms" is too strict; the downlink alone
    decides.
  - Simulation, 5 phones, congested 300–1500 ms: only **62.7 %** of starts reach all of them in time (8.8 %
    of phones miss). Tempo changes: 94.9 %. Wi-Fi and 4G: 100 %.
  - Live: 6 of 6 restarts with 0 / 300 / 600 / 1000 ms added still arrived in time. This doesn't contradict
    the test: the poll phase was never the worst case.
- **Suggested fix:** use a 3 s lead. In the simulation that gives 100 % for every profile, at the cost of a
  1 s later start. A 0.75 s poll (97.4 %) doubles the request count, so it is the worse trade.

### H11: a lopsided link moves the clicks, and "Synced ±N ms" never warns
- **Status:** confirmed (code, simulation, live on `netlify dev`). The size of the effect in production needs a
  device. **Severity: S1** when phones are on different networks (more than 30 ms apart).
- **Impact:**
  - Cristian's method assumes that the server read its clock halfway through the round trip.
  - Time a function spends **before** it reads the clock (start-up, routing) counts as the uplink, so every
    click is early by (up − down)/2.
  - Phones on the same network share the error. Phones on different networks don't.
- **Evidence:**
  - Test: `countin.test.tsx › a lopsided link (10 ms up, 70 ms down) puts the clicks 30 ms late and calls it
    'Synced ±40 ms'`.
  - Test: `at a 400 ms round trip it shows 'Synced ±200 ms' with no warning style`.
  - Live: on one machine, tab A's bar lines were **122 ms early** against the server's grid, and tab B's
    149 ms, then 126 ms after a later round. Both tabs said "Synced ±154–176 ms".
  - Simulation:
    - "lopsided 4G": 36.9 ms p95 for a single phone against the grid;
    - mixed Wi-Fi + lopsided 4G: 38.3 ms p95 between phones, 84.9 ms max.
- **Suggested fix:**
  - Have `/api/time` return the time the request arrived and the time the answer left (two server
    timestamps, as NTP does), and subtract the server's own processing time.
  - Show a warning style when the bound is over 25 ms: "Sync is rough on this network: calibrate by ear or
    use Wi-Fi".

### H5: two phones change it at the same moment, so a Stop can be lost
- **Status:** confirmed (server code). Part refuted: the audible clash between two tempo changes. **Severity:
  S1** when the Stop is lost (rare: both requests must arrive within one storage round trip).
- **Impact:** Stop for everyone, pressed while a bandmate's tempo change is landing, is overwritten.
  - Everyone keeps playing.
  - The stopper's phone briefly says it stopped, then restarts at its next check.
- **Evidence:**
  - Test: `server.test.ts › BUG H5: Stop for everyone sent at the same moment as a tempo change is lost`.
    The stopper got `running=false`, the tempo phone got `running=true`, and `true` is what is stored.
  - Cause: `repo.setMetronome` reads, then writes, with no compare-and-swap.
  - Refuted part: `stop.test.tsx › refuted (audibly): the loser shows its own tempo until its next poll, but
    plays the winner's on the bar line`. Only the display shows the losing tempo, for up to 1.5 s.
- **Suggested fix:** the `KV` interface already has `getTextTagged` and `setTextIfMatch`. Use them in
  `setMetronome` with a short retry loop, so every change is applied to the latest session.

### H7: performance.now() pauses while the server's clock runs on
- **Status:** confirmed in code. Whether phones really pause `performance.now()` (sleep, a frozen page) needs a
  device. **Severity: S1** when it happens: hundreds of ms off, with the screen saying it's fine.
- **Impact:**
  - After waking, the fastest sample from before the sleep wins, because rounds are picked by round trip
    alone.
  - The clicks are off by however long the pause lasted (modulo one bar) for up to about 2 minutes.
- **Evidence:**
  - Test: `drift.test.tsx › BUG H7: after waking … the clicks are 250 ms off`. Downbeat errors after waking:
    250, 250, 250 ms, while the status says "Synced ±10 ms".
  - Related: `BUG H7: with equal round trips the OLDEST sample wins …`. When round trips tie, `<` keeps the
    oldest sample, so at 100 ppm the estimate is 17.8 ms stale after 239 s.
- **Suggested fix:**
  - When the page is visible again, throw away the old rounds and take a full round.
  - Penalise old samples: score each one as RTT + age × drift allowance (for example 0.1 ms per second).
  - Prefer the newer sample on a tie (`<=`).

## S2: a glitch it recovers from

### H9: re-aligning a loop that runs early cuts its downbeat and flams
- **Status:** confirmed (code and live). **Severity: S2.** It is S1 for T4 if it happens often (see H8).
- **Impact:** every re-align of a loop that runs early cuts the old downbeat and plays a second one N ms later,
  where N is how early the loop was. You hear it as a pop plus a flam.
- **Evidence:**
  - Test: `drift.test.tsx › BUG H9: the audio clock jumps 30 ms ahead …`. It gives "cut click at 3.900 s;
    flam: onsets 30 ms apart".
  - Test: `BUG H9 soak: an audio clock 100 ppm fast flams every ~100 s (T4)`. Over 250 s that is 2
    re-alignments, at 101.9 s and 201.9 s, each a cut click plus a 10 ms flam.
  - Regression: `H9 regression: a loop that runs LATE … re-aligns cleanly`. A late loop is clean.
  - Live (tab B): after a 60 s clock round moved the offset by 22.5 ms, the old loop's downbeat started at
    …789 ms and was cut at …811 ms, where the new loop's downbeat started.
  - The simulation counts **18.8 re-alignments per phone-hour** at ±100 ppm, and about half of them are early.
- **Suggested fix:**
  - When the loop is early, stop the old loop **before** its bar-line click: at its own bar line, not the
    grid's. Start the new one at the grid's bar line.
  - Or move the switch into the silence in the middle of a beat (at least 60 ms after a click).

### H8: jitter in the audio link re-aligns the loop again and again
- **Status:** the mechanism is confirmed. How much jitter real phones have needs a device (this machine's live
  audio clock was too irregular to measure). **Severity: S2.** It is S1 if real jitter is above ±5 ms.
- **Impact:** any jitter above about ±5 ms in `getOutputTimestamp()` re-aligns on **every bar**, because each
  re-align lands on a jittered position and the next reading differs by up to twice the jitter. Each re-align
  is a possible H9 flam.
- **Evidence:**
  - Test: `drift.test.tsx › BUG H8: ±15 ms of getOutputTimestamp jitter re-aligns the loop over and over`
    gives 30 re-alignments in 60 s.
  - Test: `H8 measure` (60 s, 120 BPM 4/4):

    | Jitter | Re-alignments | Cut clicks or flams |
    |---|---|---|
    | ±0 and ±5 ms | 0 | 0 |
    | ±8 ms | 30 | 30 |
    | ±10 ms | 30 | 30 |
    | ±15 ms | 30 | 30 |
    | ±30 ms | 30 | 22 |

  - Control: `control: ±5 ms of getOutputTimestamp jitter never re-aligns`.
  - Live, Chrome on Windows: this machine's AudioContext clock ran 1.5 % to 95 % slow against
    `performance.now()` in 2 s windows, with ±65 ms residuals on both link paths. Chrome seems to throttle
    audio rendering in tabs the automation leaves in the background. So no real jitter figure could be taken
    here.
- **Suggested fix:**
  - Smooth the link: fit a line through the last 1–2 s of (perf, audio) pairs instead of reading one pair
    per tick.
  - Re-align only when the phase error has been over the threshold for, say, 8 ticks in a row, measured as
    a median.
  - Use hysteresis: re-align above 12 ms, settle back to 0.

### H23 (new): two changes within one lead put phones on different grids for a bar
- **Status:** confirmed. **Severity: S2.** For one bar the accents differ between phones, so they are more than
  30 ms apart.
- **Impact:**
  - Two quick changes (beats per bar, then tempo, or two people) within about 2 s: the second one's start is
    worked out from the first one's grid, which hasn't started yet.
  - A phone that saw the first change plays it until the second one starts. A phone that didn't keeps playing
    the old grid.
- **Evidence:** `stop.test.tsx › BUG H23: a phone that polled between the two changes plays a different bar from
  one that didn't`. Accents in the bar between: A (missed change 1) at 0 and 500 ms; B (saw it) at 0 ms.
- **Suggested fix:**
  - In `applyChange`, when the current session hasn't started yet (`startAt > now`), replace it. Keep its
    `startAt` if it's still at least about 1.5 s ahead, worked out from the grid that is sounding.
  - Store that previous grid (`prev: {bpm, beatsPerBar, startAt}`) in the record, so a phone that only sees
    the latest change still plays the right thing until then.

### H4: a poll in flight when this phone sends a change comes back after it, and is taken
- **Status:** confirmed (code and live). **Severity: S2.**
- **Impact:** after Stop for everyone, the phone that pressed it starts clicking again for up to 1.5 s, and its
  panel flips back to playing. A tempo change shows the old value again for a moment.
- **Evidence:**
  - Test: `stop.test.tsx › BUG H4: Stop for everyone, then clicks start again on the phone that pressed it`.
    The log shows stopped at +100 ms, playing at +390 ms, stopped at +1890 ms, with clicks at +940 and +1440 ms.
  - Test: `BUG H4: a beats-per-bar change shows the old value again`. The dots go 4 → 6 → 4 → 6.
  - Regression: `H4 regression: the new beats per bar still starts on its bar line`. The audio is right.
  - Live (B, 800 ms slow poll answers): silent at +651 ms, sounding again from +1323 to +2650 ms, panel back to
    playing at +1417 ms.
  - Cause: `send()` doesn't drop a poll that is still in flight. `start()` does this already, through
    `checkNowRef` after the answer, so only Stop and changes are affected.
- **Suggested fix:**
  - In `accept()`, ignore a session whose `updatedAt` is older than the one held. The ISO strings from the
    server compare in order.
  - Also call `checkNowRef.current?.()` after `stopAll` and `change`, as `start` does.

### H6: a joined phone with its screen off keeps playing the old grid
- **Status:** confirmed (code and live). It is by design: T3 only covers visible phones. Whether iOS keeps the
  audio running needs a device. **Severity: S2.**
- **Impact:** a phone that is locked or in the background can't be stopped from other phones, and misses tempo
  changes until it is visible again. Then it stops or switches at once.
- **Evidence:**
  - Test: `navigation.test.tsx › by design: it keeps playing the old grid after Stop for everyone, and stops
    at once when it is visible again`.
  - Live: tab B was hidden for about 10 s. It sent no polls between …24846 and …35761, and kept the old 7/4
    grid for 7 s past the 4/4 change at …29239. It rejoined part-way through a bar once visible.
- **Suggested fix:**
  - Chrome doesn't throttle timers in a page that is playing sound, so polling could carry on while hidden as
    long as the context is running (cost: unchanged).
  - iOS freezes the page's scripts, so there the fix is UX: "Keep this screen on", plus the wake lock that is
    already held.

### H17: a session that runs for 2 h at one tempo stops everywhere mid-song
- **Status:** confirmed. **Severity: S2.** It is visible, because the panel switches back to Start for everyone.
- **Impact:** a long practice loop or warm-up on one song stops on every phone at the 2 h mark. Joined phones
  polling don't count as use, and neither does tapping Start again at the same tempo.
- **Evidence:**
  - `server.test.ts › BUG H17: reads as stopped after 2 h, even with phones joined and polling`.
  - `BUG H17: pressing Start for everyone again at the same tempo doesn't keep it alive either`:
    `applyChange` returns `current` and nothing is written.
  - `silent.test.tsx › BUG H17: it stops on every phone mid-song`.
- **Suggested fix:**
  - Let a joined phone's check refresh a `seenAt` field at most every 10 minutes (one write per 10 minutes),
    and work out staleness from that.
  - Or make a same-tempo start refresh `updatedAt`.
  - Or raise the limit to 6 h.

### H18: Start for everyone from a panel whose view is old changes the tempo for everyone
- **Status:** confirmed. **Severity: S2.**
- **Impact:** the panel checks only every 10 s while you're not joined. If a bandmate has just started it at
  120/4 and you tap Start at the song's 96/3, everybody switches to 96/3 at the next bar.
- **Evidence:**
  - `stop.test.tsx › BUG H18: a phone that still shows 'stopped' turns a bandmate's fresh start into a tempo
    change for everyone`.
  - `server.test.ts › BUG H18: a start with another tempo becomes a tempo change for everyone`.
- **Suggested fix:**
  - Have Start send `{ running: true, ifStopped: true }`.
  - When the session is already running, the server answers with the current session (or a 409), and the
    panel shows "Already playing at 120 BPM — Join".

### H21 (part b): the network coming back stops the local metronome by itself
- **Status:** confirmed. **Severity: S2.**
- **Impact:** offline, someone plays "on this phone only". When the Wi-Fi comes back mid-song, the next 10 s
  check swaps the view and the local clicks stop without anyone tapping.
- **Evidence:** `silent.test.tsx › BUG H21: the network coming back stops the local metronome that is playing,
  without a tap`.
- **Suggested fix:** while the local metronome is playing, keep it, and show "Back online — switch to the shared
  metronome?" instead of switching on its own.

## S3: friction

### H21 (part a): "Try syncing again" does nothing visible for up to 10 s
- **Status:** confirmed. **Severity: S3.**
- **Evidence:** `silent.test.tsx › BUG H21: 'Try syncing again' does nothing visible for up to 10 s`. It also
  stops the local clicks straight away.
- **Regressions that pass:**
  - after a clock failure, the button offers Join at once;
  - a joined phone that goes offline keeps playing and says so within 2 s. This was confirmed live too.
- **Suggested fix:** expose a `retry()` from `useSyncedMetronome` that calls `checkNowRef.current`, and call it
  from the button.

### H15: the pill's live dot is only right when the song opens
- **Status:** confirmed. **Severity: S3.**
- **Evidence:**
  - `navigation.test.tsx › BUG H15: no live dot 30 s after a bandmate starts it, while the panel is closed`.
  - `BUG H15: the live dot stays lit 30 s after someone stops it`.
- **Suggested fix:** with the panel closed and the page visible, check every 15 s, or on focus or visibility.
  The cost is 240 requests an hour per phone.

### H16: no "starts in 2 s" countdown, and no bar number to compare by eye
- **Status:** observation, from reading `BeatDisplay.tsx`. It shows the beat in the bar and nothing else. It's
  a missing feature, not a bug. **Severity: S3.**
- **Suggested fix:** show a countdown before `startAt`, and a bar number counted from `startAt`, so bandmates
  can check by eye that they agree.

## Refuted

- **H13: swiping to the next song.** The panel closes, this phone leaves and stops, its AudioContext is
  closed, checks for the old song stop, and the next song's panel starts fresh.
  - Tests: `navigation.test.tsx › refuted: the panel closes …` and `regression: even an unkeyed SongMetronome
    … resets its session view`.
  - Live: after a router navigation, `panel: false, sounding: 0, ctx: closed, oldSongChecksAfter: 0`.
  - Leftover risk: if `SongPage` ever stops closing the panel on a song change, the unkeyed `SongMetronome`
    keeps the first song's starting tempo (the log shows 96 BPM for a 140 BPM song). Key it by `song.id` for
    safety.
- **H20: the service worker caching metronome calls.** `routeFor` passes `GET /api/time` and `GET` and `PUT
  /api/metronome/:id` straight to the network (`server.test.ts › refuted: …`, 3 cases). The built `dist/sw.js`
  only caches `/^\/api\/(songs|gigs)(\/[^/]+)?$/`. Live, every metronome request had a network timing.

## Needs a real device

- **H3: Netlify cold starts.** Untested: it needs a deploy, and I didn't deploy. On `netlify dev`, every
  function call took 300–680 ms, which is slower than production. That is enough to show H1, H2 and H11 live.
- **H10: output latency differs per device, and tap bias.** Untested. The simulation leaves out output latency
  on purpose: it assumes perfect calibration.
- How large H7, H8 and H12 are on real phones: see the checklist.

## Questions for you

- **H14: Join on every song.** Every phone has to open the panel and tap Join on each song, and swiping to the
  next song leaves (confirmed live). In a gig that means one tap per phone per song. Do you want a "follow the
  metronome through this gig" mode? The spec lists gig-wide sessions under "Not doing".
- **H19: request volume against Netlify's limits.**
  - Real request counts, from the constants:
    - a joined phone makes **2,400 session checks + about 190 `/api/time` calls ≈ 2,590 function calls an
      hour**;
    - an open panel that isn't joined makes 360 an hour.
  - Netlify's published numbers, read on 2026-11-15:
    - Credit plans: Free 300 credits a month with a **hard limit**, Personal 1,000, Pro 3,000.
      ([pricing](https://www.netlify.com/pricing/),
      [credit plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/),
      the latter last updated 2026-10-30.)
    - "Web requests use 2 credits per 10 thousand (10,000) requests", and compute is 10 credits per GB-hour,
      at a default of 1024 MB.
      ([how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/),
      last updated 2026-08-12.)
    - When the credits run out, "all of your web projects (sites/apps) are paused" with a "Site not available"
      page. That takes down the whole band site, not just the metronome.
    - Personal and Pro can turn on auto recharge, which is off by default.
    - Blobs operations have no published price or allowance.
  - Arithmetic (mine): 5 phones joined for a 3-hour rehearsal is 38,850 calls.
    - Request credits: 7.8.
    - Compute credits: 5.4 at 50 ms per call, 21.6 at 200 ms.
    - In total roughly **13–29 credits per rehearsal**, so a Free plan pauses the site after about 10–23 such
      rehearsals a month, before deploys and bandwidth.
  - Not checked: per-call duration in production (needs a deploy), and the numbers for legacy, request-billed
    plans (Starter). **Which plan is the site on?**

## Simulation (Phase 2)

`tests/robustness/simulation.test.ts` uses the real `estimateOffset`, `toAudioTime`, `phaseError`,
`applyChange` and `beatsInWindow`, and the real `POLL_JOINED_MS`, `LEAD_MS` and `ROUND_EVERY_MS`, plus mirrored
copies of the private constants.

The setup:
- 5 phones, 12 trials of 30 minutes each, 120 BPM 4/4.
- Each phone's `performance.now()` and audio clock drift by up to ±100 ppm.
- Sync works as in `useClockSync`: 10 samples, then 3 every 60 s, keeping the best of the last 3 rounds.
- Re-aligning works as in `reconcile`, with a 10 ms threshold.
- Output latency is assumed to be calibrated out.

### Error between phones (|bar line A − bar line B|, ms)

| Profile | p50 | p95 | max | One phone vs grid, p95 | Re-alignments per phone-hour |
|---|---|---|---|---|---|
| Wi-Fi 20–80 ms | 6.3 | 18.8 | 36.7 | 13.0 | 18.8 |
| 4G 80–400 ms | 6.4 | 19.6 | 41.9 | 13.6 | 20.0 |
| Congested 300–1500 ms | 10.7 | 29.1 | 57.5 | 19.5 | 27.5 |
| Lopsided Wi-Fi (up 25 %) | 6.3 | 18.8 | 37.2 | 15.3 | 18.7 |
| Lopsided 4G (up 20 %) | 6.6 | 20.6 | 52.3 | 36.9 | 20.7 |
| *Wi-Fi, no drift at all* | 0.5 | 1.6 | 1.9 | 1.0 | 0 |
| *Wi-Fi, perf ±100 ppm, audio 0* | 1.2 | 10.7 | 21.4 | 9.8 | 4.0 |
| *Wi-Fi, perf 0, audio ±100 ppm* | 5.7 | 15.4 | 21.7 | 9.5 | 18.2 |
| *Wi-Fi, ±20 ppm on both* | 4.6 | 14.4 | 23.7 | 9.3 | 2.9 |
| *Mixed: Wi-Fi + lopsided 4G* | **17.4** | **38.3** | **84.9** | 34.2 | 19.7 |

What this shows:
- The network adds almost nothing on its own (1.6 ms p95 with no drift).
- The error is mostly audio-clock drift wandering inside the ±10 ms re-align deadband, plus the offset going
  stale between rounds (H7).
- Phones on different networks are where T2 fails (H11).

### Changes that reach all 5 joined phones in time for beat 1

| Profile | Kind | Now: lead 2 s, poll 1.5 s | Lead 3 s | Lead 4 s | Poll 1 s | Poll 0.75 s |
|---|---|---|---|---|---|---|
| Wi-Fi 20–80 ms | start / tempo | 100 % / 100 % | 100 % | 100 % | 100 % | 100 % |
| 4G 80–400 ms | start / tempo | 100 % / 100 % | 100 % | 100 % | 100 % | 100 % |
| Congested 300–1500 ms | start | **62.7 %** (8.8 % of phones miss) | 100 % | 100 % | 90.6 % | 97.4 % |
| Congested 300–1500 ms | tempo | 94.9 % (1.1 % of phones miss) | 100 % | 100 % | 99.5 % | 99.9 % |
| Lopsided Wi-Fi and 4G | both | 100 % | 100 % | 100 % | 100 % | 100 % |

This is data only. A longer lead fixes followers at no cost in requests. A faster poll costs 1.5–2× the
requests, and helps less. Neither fixes H1: the starter is limited by its own 10-sample sync.

## Live two-tab run (Phase 3), as logged

The setup: `netlify dev` on localhost:8888, two tabs on one song, and Claude in Chrome. The instrumentation
patched `AudioBufferSourceNode.start` and `stop` to log times on `performance.timeOrigin + performance.now()`,
through the same `getOutputTimestamp` link the app uses. A `fetch` wrapper added delay, offline and hang.

Caveat: Chrome throttled this machine's audio rendering in the tab that wasn't active, and only one tab per
window is visible. For the "both visible" scenarios, `visibilityState` was pinned to `visible`. Timing between
the tabs is therefore only indicative. The logic results stand.

| Scenario | Result |
|---|---|
| Start (A) | First click 1521 ms after `startAt`, joined part-way (H1). `/api/time` round trips 308–574 ms. Bar line 122 ms early against the server (H11). |
| Late join (B) | 5239 ms of silence after Join (H1). 149 ms early. 27 ms from A, then 4.8 ms after a later round. |
| B's 60 s clock round | The offset moved 22.5 ms, so it re-aligned with a cut downbeat and a 22 ms flam (H9). |
| Beats per bar 7 → 4 (A), B hidden | A switched on the bar line. B (really hidden) kept 7/4 for 7 s past it (H6). |
| Beats per bar 4 → 3 (A), both visible | Both switched on the same bar line, 17.5 ms apart. B booked it 1.6 s ahead. |
| Stop for everyone (B) | B silent at +508 ms, A at +1257 ms (T3 met). |
| Stop race (B, polls 800 ms slow) | Silent at +651 ms, **clicking again +1323 to +2650 ms**, panel flipped back to playing (H4). |
| Fetch delay +0 / 300 / 600 / 1000 ms (B) | 6 of 6 restarts booked 0.7–1.8 s ahead of `startAt` (the worst-case phase wasn't hit). |
| Offline (B) | "Can't reach the server…" within 2 s, kept playing, cleared once back online. |
| Requests hang (B) | **No checks at all afterwards**: still sounding after Stop, still "Synced ±154 ms" (H22). |
| Swipe to the next song (A) | Panel closed, AudioContext closed, no more checks for the old song (H13 refuted). |

## Real-device checklist (Phase 4, for you to run)

Nothing has been deployed. A deploy preview or a LAN URL is outward-facing, so tell me which you want and I'll
set it up only after you say yes.

### Setup
- **Devices:** every phone the band uses (note the model and OS for each: at least one iPhone and one Android),
  plus a laptop.
- **Recorder:** one separate device (a laptop or a third phone) running a voice recorder in WAV or lossless
  format. Put it the same distance (about 50 cm) from every phone's speaker, with the phones side by side.
- **Song:** one with a set tempo (say 120 BPM 4/4). Volume about 70 % on every phone.
- **Reading the results (Audacity):**
  - open the recording, then Analyze → Label Sounds (or zoom in);
  - mark the onset of each click per phone (tell the phones apart by pausing one, or by panning if you
    record in stereo with two mics);
  - write down the gap between phones on 20 downbeats and give the median and the worst;
  - 10 ms is about one 441-sample block at 44.1 kHz.

### Runs (write down: median gap, worst gap, missed or double clicks, what the screen said)
1. **Wi-Fi, no calibration.** All phones on the same Wi-Fi, nudge 0. Start from phone 1. Did every phone
   play beat 1? Record 60 s.
2. **Wi-Fi, calibrated.** Do the tap-along on each phone (Calibrate this phone), then repeat run 1.
   Target: ≤ 20 ms p95 (T2).
3. **4G vs Wi-Fi.** Put one phone on 4G (Wi-Fi off) and the rest on Wi-Fi. Repeat runs 1 and 2. Write down
   each phone's "Synced ±N ms". Target: ≤ 40 ms. This tests H11 in production.
4. **Count-in from a 4G phone.** The 4G phone taps Start for everyone. Does **it** play beat 1? (H1)
5. **Late join.** With it running, a phone that hasn't joined taps Join. Time from the tap to the first click.
6. **Bluetooth.** One phone on Bluetooth earphones, no calibration, then calibrated. Record through the
   earphone held to the mic. Expect 150–300 ms before calibrating.
7. **Lock and unlock.** While it plays, lock one phone for 20 s.
   - Does the sound keep going while locked? (H6: iOS vs Android)
   - Change the tempo from another phone while it's locked, then unlock. How long until it follows?
   - Is it back in time? Re-record 30 s and compare the gap with run 2 (H7).
8. **Incoming call or Siri.** Call one phone, or trigger Siri or Google Assistant, while it plays. Hang up.
   - Does the sound come back by itself?
   - Does the screen say anything? (H12: expect "flash, no sound, no message")
9. **Silent switch (iPhone).** Flip it to silent while playing, and before joining. Is there sound? (The app
   asks for `audioSession.type = "playback"` on Safari 16.4+.)
10. **Wi-Fi with no internet.** Unplug the router's internet, or join a hotspot with no data, while joined.
    - Does the screen say "Can't reach the server" within about 2 s?
    - Plug it back in, then press Stop on another phone. Does this phone stop? (H22: expect it not to until you
      lock and unlock)
11. **Stop.** Press Stop for everyone 5 times from different phones (restart in between).
    - Does every visible phone stop within 2 s?
    - Does the stopping phone ever click again? (H4)
12. **30-minute soak.** All phones joined, screens on, record 30 minutes.
    - Listen and look for flams or double clicks: Audacity's Analyze → Find Clipping won't help, so zoom in at
      each one you hear.
    - Count them per phone (H8, H9: expect 0 if the link is clean, up to 1 per bar if it isn't).
    - Note the worst gap at the end.
13. **Swiping through a gig.** Open a gig, run the metronome on song 1, swipe to song 2, and start it there.
    - How many taps per phone per song? (H14)
    - Does the pill's dot show a bandmate's session? (H15)
14. **Cold start (needs a deploy).** After the site has been idle for 30 minutes, the first Start for everyone:
    did every phone hear beat 1? (H3)

## Files added in this pass

- `tests/robustness/harness.ts`: the shared world. One virtual clock drives `performance.now()`, fake timers,
  `Date` and the fake AudioContext. A fake network sends calls to the real `repo` over `memoryKV()`, with a
  delay each way. Click onsets are read from the rendered bar buffer.
- `tests/robustness/countin.test.tsx` (H1, H2, H11), `stop.test.tsx` (H4, H5, H18, H23), `drift.test.tsx` (H7,
  H8, H9), `silent.test.tsx` (H12, H17, H21, H22), `navigation.test.tsx` (H13, H15, H6), `server.test.ts` (H5,
  H17, H18, H20), `simulation.test.ts`.
- The jsdom files use a `// @vitest-environment jsdom` docblock, because `vite.config.ts` only matches
  `tests/app/**`. The existing `include: ["tests/**/*.test.{ts,tsx}"]` already picks up the folder.
