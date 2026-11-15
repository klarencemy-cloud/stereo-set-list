# Chromatic tuner

Date: 2026-11-15. Branch: `feat/lyrics-and-tools`.

## Why

The tuner on `/tools` made you pick Guitar or Bass and highlighted the nearest standard string. The user
wants a chromatic tuner with fewer buttons: it hears any note and shows the nearest of the 12 notes and how
far sharp or flat it is in cents, for any instrument or tuning.

Detection was already chromatic (`noteFromFrequency` snaps to the nearest equal-tempered note). The instrument
switch only drove the string-name row, so this is mostly a removal, plus two additions: a lower detection floor
and an adjustable reference pitch.

## Decided by the user

- The Guitar/Bass switch and the string row are removed entirely.
- The detection floor drops from 35 Hz to 28 Hz (`MIN_FREQ`), so a 5-string bass's low B (30.87 Hz) is heard,
  even tuned flat. `analysisSize` stays 4096 samples at 44.1 and 48 kHz, so there is no extra delay.
- Note names use sharps only (C#, D#, F#, G#, A#).
- The octave number stays (a big "E" with a small "2").
- The reference pitch A4 is adjustable: − / + buttons in 1 Hz steps, and the number can be tapped and typed.
  It is remembered on the device (localStorage). A "Reset to 440" button appears only when the value isn't 440.
- Everything else on the display stays: the needle meter, ±5 cents counts as "In tune", the
  "+12 cents (sharp, tune down)" text, and the Start/Stop button. The hint reads "Play a note"; the footer reads
  "Chromatic tuner. Uses the microphone."

## Builder's calls

- A4 range is 415–466 Hz, whole Hz only. Typed values are rounded and clamped. An empty or invalid entry goes
  back to the last good value. The value is committed on Enter or blur.
- localStorage key `stereo-set:tuner-a4`. An unreadable or out-of-range stored value falls back to 440. The old
  key `stereo-set:tuner-instrument` is no longer read.
- The A4 control sits above the note display: "A4", −, the number, "Hz", +, then Reset when shown. The row wraps
  on narrow phones. The browser's own number spinners are hidden, since − / + do the stepping.

## Changes

`src/app/tuner/pitch.ts` (pure maths, no browser APIs)
- Removed `TunerString`, `InstrumentId`, `INSTRUMENTS`, `stringOf`, `nearestString`, `freqOfMidi`.
- `MIN_FREQ = 28`.
- Added `DEFAULT_A4 = 440`, `MIN_A4 = 415`, `MAX_A4 = 466`, and `clampA4(n)` (rounds, clamps, non-numbers → 440).
- `noteFromFrequency(freq, a4 = DEFAULT_A4)`.

`src/app/components/Tuner.tsx`
- A4 state replaces the instrument state, read and saved like the Metronome's settings (try/catch around
  localStorage). Exports `A4_KEY` and `IN_TUNE_CENTS`.
- The number box keeps a local draft string while editing, so typing a partial value (e.g. "4") isn't clamped
  mid-keystroke.

`src/app/styles.css`
- Removed `.tuner-strings` / `.tuner-string`. `.seg` stays (Metronome and SongFormPage use it).
- Added `.tuner-ref` (flex row, centred, styled like `.metro-tempo`) and a 5ch-wide number box.

`src/app/tuner/useTuner.ts`: unchanged.

## Tests

- `tests/app/pitch.test.ts`: detection within 2 cents for B0 (30.87 Hz, and 20 cents flat), E1, A1, D2, G2, E2,
  A2, D3, G3, B3, E4, A4; `noteFromFrequency` against A4 = 432; `clampA4`.
- `tests/app/ToolsPage.test.tsx`: no Guitar/Bass buttons or Strings list; + and Reset; typed value is saved and
  survives a remount; 999 clamps to 466; an empty entry keeps the last value; a bad stored value gives 440;
  a 432 Hz sine with A4 = 432 shows "A4" and "In tune"; a 30.87 Hz sine shows "B0".
