# Handoff: iPhone mic fails after the metronome sets the "playback" audio session

Date: 2026-11-19. Branch: `fix/iphone-mic-session` (from `main` at `b8d2954`, nothing committed yet).

## Where things stand

- PR #28 (synced metronome robustness, spec #4) is merged into `main`. Only #3 (Follow switch) and #26 (hand test
  of shared answers on a deploy preview) are open.
- The owner then hand-tested on a real iPhone (Safari, live site) and found the bug below. No GitHub issue exists
  for it yet.

## Symptoms the owner saw on the iPhone

1. **Calibrate this phone → Measure this phone** always ends in "Couldn't hear the clicks…", even in a quiet room
   with the volume up.
2. While Measure runs, the clicks get **quieter** right after it starts. They still come from both the top and
   bottom speakers (loudspeaker, not the earpiece). Pressing volume up **during** Measure makes them louder
   (iOS has a separate volume for play-and-record), but Measure still fails.
3. **Tools → Tuner** says "Could not start the microphone." (the catch-all in `micErrorMessage`,
   `src/app/tuner/useTuner.ts:18`, so the error name is not NotAllowed/NotFound/NotReadable).
4. Decisive sequence: close the tab, open the site fresh → **tuner works**. Then run Measure (fails) → tuner again
   → **"Could not start the microphone."**

## Cause

`navigator.audioSession.type` (Safari 16.4+) is left at `"playback"`, and Safari refuses mic capture in that mode.

- `preferPlaybackAudio()` (`src/app/audio.ts:18`) sets `"playback"` so the silent switch doesn't mute clicks. It is
  called on every metronome start (`useMetronome.ts:107`, `useSyncedMetronome.ts:479`, `SongMetronome.tsx:228`
  tap-along, `:268` measure) and at the end of every `listen()` (`src/app/metronome/listen.ts:202`).
- `listen()` sets `"play-and-record"` before `getUserMedia` (`preferRecordAudio`, `listen.ts:74-81`). **The tuner
  does not** (`useTuner.ts:61-80`): it calls `getUserMedia` in whatever mode is left. **Proven** by sequence 4.
- **Measure** (`SongMetronome.tsx:266-305`): `preferPlaybackAudio()`, then creates/reuses an AudioContext under
  `"playback"`, then `listen()` switches to `"play-and-record"` and records on that same context. Capture is
  allowed (no mic error is shown), but the clicks aren't detected. **Hypothesis, not proven:** a context created
  under `"playback"` gets silence (or unusable input) from the mic after the session switch. It explains the volume
  drop too.
- **Joining** (matching the leader by ear) has the same shape: `useSyncedMetronome.ts:479-480` creates the context
  under `"playback"`, and `listen(ctx, …)` at `:384` records on it while it plays. Not tested on a device.

## Agreed plan (owner said "go ahead" is still pending: ask before starting)

1. **Tuner:** set `"play-and-record"` before `getUserMedia`. Move `preferRecordAudio` from `listen.ts` to
   `src/app/audio.ts` next to `preferPlaybackAudio`, and use it in both places.
2. **Measure:** set `"play-and-record"` first, then create a **new** AudioContext just for the measurement (clicks
   and recording on it), and close it afterwards. Don't reuse `ctxRef` (tap-along's context).
3. **Joining:** same idea as 2: a phone that will listen creates its context under `"play-and-record"`. **Do this
   only after the owner confirms fix 2 works on the iPhone.**
4. **Temporary readout:** when Measure fails, show a short line of what the mic heard (peak and background
   envelope, onsets found, delays in ms, sample rate, worklet or ScriptProcessor). Tag it so it is easy to remove
   (e.g. a `[DEBUG-mic]` comment); remove it once Measure works.
5. **Tests first** (TDD; CLAUDE.md: reproduce before fixing): assert the audio session is `"play-and-record"`
   **before** `getUserMedia` is called in the tuner, and before Measure's AudioContext is created. They must fail
   on today's code. Related tests: `tests/app/ToolsPage.test.tsx`, `tests/app/SongMetronome.test.tsx`,
   `tests/robustness/ear.test.tsx` (the robustness world in `tests/robustness/harness.ts` has a fake mic).
   Detection logic itself is in `src/app/metronome/match.ts` (`detectOnsets`, `measureRoundTrip`) and is not
   suspected.
6. Also consider: `micErrorMessage` could name the error (or handle `InvalidStateError`/`AbortError`) so this shows
   as something clearer than the catch-all.

## Verifying on the iPhone

Only the owner's iPhone reproduces this. To test, the branch needs a Netlify deploy preview (push + draft PR).
That is outward-facing: **ask the owner first.** Then on the preview: fresh tab → Measure → expect
"Measured N ms, saved"; then tuner → expect it to start. If Measure still fails, read the temporary readout.

## Owner's standing rules

- Never commit, push or merge unless the owner explicitly says so.
- No "Generated with Claude" or Co-Authored-By lines in commits, PRs or issues.
- Only one `netlify dev` at a time (check :8888 first).
- The site is on Netlify's Free plan (hard credit cap).
- Explain things in plain words; the owner is learning git/GitHub/Netlify step by step.
