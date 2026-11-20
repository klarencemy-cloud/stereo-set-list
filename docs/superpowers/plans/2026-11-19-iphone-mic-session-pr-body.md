Closes #30, closes #31. Part of #29.

## Summary

The iPhone's audio session is left on `"playback"` after the metronome plays, and Safari refuses or silences the mic in that mode.

```diff
 Tuner start
+  preferRecordAudio()            # "play-and-record"
   getUserMedia(...)

 Measure this phone
-  preferPlaybackAudio()
-  ctx = Tap along's context ?? new context     # made under "playback"
+  preferRecordAudio()
+  ctx = new context                            # made under "play-and-record", its own
   listen(ctx) + clicks on ctx
+  finally: ctx.close(); preferPlaybackAudio()  # loud again, even after a failure
```

- `preferRecordAudio` moved from `listen.ts` to `src/app/audio.ts`, next to `preferPlaybackAudio`.
- Mic errors without their own message now name the browser's error: "Could not start the microphone (InvalidStateError)."
- **Temporary:** a failed Measure shows `Mic heard: peak …, background …, N onsets, delays …, 48000 Hz, worklet`. Every line is tagged `[DEBUG-mic]`. Removal is #33.

## Evidence

- **Before** (new tests on today's code):
  - Tuner: session when the mic is requested → `"playback"` (expected `"play-and-record"`). ✗
  - Measure after Tap along: reused Tap along's context, made under `"playback"`, and couldn't measure. ✗
  - Unknown mic error → "Could not start the microphone." with no name. ✗
- **After:** all of the above ✓. Measure's context is closed and the session is back on `"playback"` after a save, after "Couldn't hear the clicks" and after a mic error. Tap along's context is untouched. `tsc --noEmit` OK; `vitest run` 56 files, 901 tests passed.
- **Still needed:** a hand test on the iPhone (deploy preview): fresh tab → Measure → "Measured N ms, saved" → tuner starts.

## Merge Danger

**Door:** two-way

**Blast Radius:** iPhone-only

On browsers without `navigator.audioSession`, the session calls do nothing. The one change everywhere is that Measure now uses a short-lived context of its own. Joining (#32) is unchanged on purpose until the iPhone check.
