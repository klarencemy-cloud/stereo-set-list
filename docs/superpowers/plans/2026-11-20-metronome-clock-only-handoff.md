# Handoff: synced metronome back to clock-only sync

Date: 2026-11-20. Branch: `fix/metronome-clock-only` (from `main` at `b8d2954`). Old deploy that worked better: `d265883`.

## The problem

The robustness work on `main` (PR #28 and the commits before it) made the synced metronome worse than the old
deploy. In the band's test (outside, one phone on mobile data, the other on its hotspot), on both the old and the
new build: Join alone, by the clock, was only a few ms off; matching by ear, "Measure this phone" and Tap along each
made it worse. The band has rolled production back to the old build.

Background: `docs/superpowers/reviews/2026-11-15-synced-metronome-robustness.md` (the H-numbered findings) and the
review from this session (summarised under "Known causes" below).

## Decided by the user (don't relitigate)

Already written down: `docs/adr/0002-no-matching-by-ear-for-now.md` (supersedes ADR 0001), `GLOSSARY.md` (Match and
Loopback delay removed, Leader updated), `docs/known-issues.md`. These are uncommitted on this branch.

1. **Joining phones play by the clock alone.** Remove matching by ear completely: the listen at Join, the re-listen
   after waking, "Listen again", the listening/matched/failed phases, and the frozen-offset logic (`aligned()`'s match
   branch).
2. **Remove "Measure this phone"** (the loopback delay, its localStorage key `stereo-set:metronome-roundtrip`, the
   `roundTripMs` parameter, `needsRoundTrip`). The metronome must never ask for the mic. The tuner keeps its own mic code.
3. **Remove Tap along** (`nudgeFromTaps` and its UI).
4. **"Calibrate this phone" becomes "Adjust timing"** and opens only the Nudge slider.
5. **Clock sync goes back to the old build's (`d265883`) behaviour:** 20 `/api/time` calls at the start, then 3
   every 60 s; best of the last 3 rounds; drift as before. **Metronome answers are never clock samples** (drop
   `addSample`, `sampledAnswer`, `timeRounds`; the server's `now` stamped after the Blobs read biases them).
6. **Audio timing goes back to the old build's:** one `audioLink(ctx)` reading per tick, no `linkSmoother` /
   `smoothedLink` / `keepNewest`, and the old 10 ms re-align check instead of the median over `REALIGN_TICKS`.
7. **Any Nudge change takes effect at the next bar line**, however small (even 1 ms). The 10 ms threshold is only
   for clock jitter, not for a change the player made.
8. **Drop #24** (joined check back from 2 s to 1.5 s), **#25** (`METRONOME_SHARED_ANSWERS`, CDN cache headers,
   cache-tag purge, the `shared` answer field), **H7's re-listen**, and **the smoothing (H8/#22)**. Each can come back
   later only with a test showing it doesn't hurt sync.
9. **Remove the "Rough sync" warning completely** (`ROUGH_SYNC_MS`, H11). It makes players worry about timing.
10. **The status says just "Synced"** (no "±N ms"). "Syncing..." while the first round runs stays.
11. **Target: within 5 ms of the beat on the same Wi-Fi, checked by tests;** on mobile data or a hotspot, as close
    as the clock allows (the clock can't see a lopsided network, ADR 0002).
12. **Don't fix the beat-1 flam** (`docs/known-issues.md`); it gets retested after this.

## Keep from `main` (these fixes stay and their tests must still pass)

H5 (a Stop or change at the same moment is never lost, compare-and-swap), H2 (3 s lead), #9's server `now` in the
envelope may stay on the wire but the phone ignores it, H17 (seen-at keeps a joined session alive past 2 h),
H18 (Start doesn't take over a running session), H23 (two quick changes keep every phone on the same bar, `prev`),
H4 (Stop doesn't restart the phone that pressed it), wake-lock re-request and panel keyed by song, H22 (a hung
request can't freeze a phone), H9 (an early loop finishes its bar), H1 (the clock syncs when the panel opens, so it's
ready at Join), H12 (sound paused shown, fixed with one tap), H21 (network back keeps local play).

Commits since the old deploy, for reference: `git log --oneline d265883..main`.

## Waiting on the user: confirm these two before writing tests

1. **Keep H7's clock half.** H7 also detects that `performance.now()` paused during sleep, drops the pre-sleep
   samples and takes a full round (`pausedMs`, `CLOCK_PAUSE_MS`, `wakes`). The old build lacks it: after a sleep a
   clock-only phone can keep a pre-sleep sample (off by the whole sleep) for up to 3 minutes. Recommended: keep it,
   remove only the re-listen.
2. **Test seams** (the `tdd` skill needs them agreed first). Proposed:
   - `tests/robustness/` (real handlers, fake network and audio): the headline test. A phone that joins on
     symmetric Wi-Fi latency, with the metronome GET taking about 40 ms of server work before `now` is stamped (add
     a per-endpoint server-work delay to `harness.ts`; today the handler runs instantly), plays every downbeat
     within 5 ms of the grid for 4+ minutes (long enough for the first round to age out). Expect it red on `main`,
     green after. Also: a 5 ms Nudge change moves the downbeats by 5 ms from the next bar.
   - `tests/app/useClockSync.test.ts`: the offset comes only from `/api/time`; the sleep handling above.
   - `tests/app/SongMetronome.test.tsx`: Join never calls `getUserMedia`; status is "Synced"; no Rough sync;
     "Adjust timing" shows only the slider.

   Delete tests of removed features with their code (`tests/robustness/ear.test.tsx`, the #9/#24/#25/Tap
   along/Measure cases).

## Known causes (from the review; reproduce before relying on them)

- `netlify/functions/metronome.ts:39`: `now: clock()` is read after the Blobs read/write, so answers as samples put
  the server late. Once the `/api/time` rounds age out (`ROUNDS_KEPT = 3`, about 3 min), only those remain.
- `useSyncedMetronome.ts`: the match's `g0` comes from the smoother, which may hold one jittery reading, and is
  baked into a frozen shift; on iOS the audio clock can jump when the mic opens.
- `SongMetronome.tsx`: Tap along reads the raw `audioLink(ctx)`; playback reads the smoothed link.
- `loop.ts`: `REALIGN_S = 0.012` ignores nudges of 10 ms or less.

## How to work

1. Confirm the two items under "Waiting on the user".
2. Update `docs/superpowers/specs/2026-11-15-synced-metronome-design.md` to match the decisions (remove the Matching
   by ear, Loopback delay and #25 sections; Sync phases, UI, Code layout and Not doing to match), and the CHANGELOG's
   unreleased section.
3. Implement test-first (`.agents/skills/implement/SKILL.md` and `.agents/skills/tdd/SKILL.md`): the 5 ms join test
   first, watch it go red on this branch, then make it green. `npx tsc --noEmit` and single test files as you go,
   `npm test` and `npm run build` at the end.
4. Remove dead code: `listen.ts`, `match.ts` and `nudgeFromTaps` if nothing else uses them (check the tuner).
   `grep -r "DEBUG-"` must come back empty.
5. Run `/code-review` against `main` (`.claude/skills/code-review` or the user's `code-review` skill), then report.

## Rules for this repo

- **Never commit, push or merge** unless the user says so, even though the `implement` skill says to commit.
- No "Generated with Claude" or "Co-Authored-By" lines anywhere.
- Before `npm run dev`, check whether port 8888 is already in use; a second `netlify dev` breaks the running one.
- The site is on Netlify's Free plan: more function calls cost credits. Going back to 1.5 s checks is the user's
  call (item 8); don't add new polling.
- Don't touch `fix/iphone-mic-session` (iPhone mic fix for the tuner, plus `[DEBUG-mic]` logging); it ships separately.
