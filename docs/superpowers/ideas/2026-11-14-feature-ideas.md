# Feature ideas: lyrics, audio and band tools (2026-11-14)

Five feature ideas for the band site, collected in one place. Each idea has four parts:

- **Idea (as given):** the original request, lightly cleaned up.
- **What already exists:** code the feature should reuse rather than rebuild.
- **Decisions:** what has already been decided, and what is still open for the brainstorming step.
- **Prompt:** an improved prompt you can paste into a fresh Claude Code session to start that feature.

**How to use:**
1. Pick one idea and start a new branch and a new session.
2. Paste its prompt.
3. Each prompt starts with brainstorming. Brainstorming writes a spec to `docs/superpowers/specs/<date>-<topic>-design.md`, then a plan to `docs/superpowers/plans/<date>-<topic>.md`.

## Suggested build order

| # | Feature | Why this order |
|---|---------|----------------|
| 1 | Lyrics Mode | Adds the shared "lyrics only" helper that Printable Lyrics also needs. |
| 2 | Printable Lyrics | Reuses that helper and the existing print-setlist CSS pattern. |
| 3 | Metronome v1 (one phone) | Adds the Tools page and the first Web Audio code. |
| 4 | Guitar Tuner | Lives on the same Tools page and reuses its audio setup. |
| 5 | Playable Audio | Needs research first, and adds new Song fields. |
| 6 | Synced Metronome v2 | Builds on v1 and adds a server clock and shared state. |

## Rules that apply to every feature

These come from `CLAUDE.md`. Every prompt below repeats them.

- Code used by both the app and the functions lives in `src/shared/`, with no browser- or Node-specific APIs.
- Field validation goes in `netlify/functions/lib/repo.ts` (`SONG_FIELDS`, `LIMITS`).
- Never invent placeholder data. An unknown value is stored empty and shown as unknown.
- When a field can be empty, check every place that displays it: the Songs list, the gig view and edit screens, AddSongsPicker, SongPage and TransposeControl.
- Write tests first with vitest. Run `npm run build` and `npm test` before saying the work is done.
- Never commit, push or merge unless explicitly asked.

---

## 1. Lyrics Mode

### Idea (as given)
A song page shows lyrics and chords together. Add a button that turns the chords off so only the lyrics show. In lyrics-only view, remove the gaps the chord lines leave behind. Where possible, keep the song structure labels such as "Verse 1", "Verse 2", "Chorus", "Break" and "Instrumental".

### What already exists
- **`src/shared/sheet.ts`**
  - Parses the Ultimate Guitar markup. Chords are `[ch]C[/ch]`, usually on their own line above the lyric line.
  - Already detects section labels: a line that is only `[Verse 1]` matches `SECTION_RE` and becomes `{kind: "section", label}`.
  - Nothing marks a line as chords-only yet.
  - `plainTextFromMarkup` removes the chord tags but leaves the chord text in place, so it does not give lyrics only.
- **`src/app/components/ChordSheet.tsx`**
  - Renders `layoutTabs(parseSheet(content), cols)`.
  - Lines use `.sheet-line` (`white-space: pre`, `min-height: 1.5em`), sections use `.sheet-section`, and chords use `.chord`. The styles are in `src/app/styles.css` around lines 207-225.
- **`src/app/pages/SongPage.tsx`**
  - Has a row of pill buttons (about lines 151-173) where the toggle can go.
  - Passes transposed content to `ChordSheet`.
- **`useFontSize`** shows how a per-device setting is saved in localStorage.

### Decisions
- **Decided:** chords toggle on/off, gaps close up in lyrics-only view, and section labels are kept.
- **Open:**
  - Should the on/off choice be remembered per device for all songs, or per song?
  - Should a section that is chords-only (an Instrumental, say) keep its label with no lines under it? Recommended: yes, so the band still sees "Instrumental".

### Prompt
```text
Add a "Lyrics mode" to the song page: a toggle that hides the chords so only the lyrics show.

Start with superpowers:brainstorming. Save the spec to docs/superpowers/specs/ and the plan to docs/superpowers/plans/. Then build it test-first.

Requirements:
- Add a "Chords on/off" pill button to the button row on src/app/pages/SongPage.tsx.
  - Remember the choice per device in localStorage, the same way useFontSize does.
  - Ask me whether it should be global or per song.
- Add a pure helper to src/shared/sheet.ts, for example lyricsOnly(lines: SheetLine[]): SheetLine[]. It must:
  - drop lines that contain only chords and whitespace,
  - remove inline chord parts from mixed lines,
  - collapse the blank space those removals leave, so lyric lines sit together with no gaps,
  - keep section lines ([Verse 1], [Chorus], [Bridge], [Break], [Instrumental], [Intro], [Outro] and so on),
  - keep a section label even when its body was all chords, so "Instrumental" still shows,
  - leave at most one blank line between sections.
- This helper will be reused by the Printable Lyrics feature, so keep it free of React and browser APIs.
- ChordSheet.tsx renders the helper's output when chords are off. Tab layout and column measuring must still work.
- Lyrics mode must work with transpose, autoscroll, stage mode, font size, and songs cached for offline use.
  - Transposing while chords are hidden must not break anything. When chords come back on, they show in the current key.
- A song with no content still shows the existing empty state. Don't invent text.

Tests:
- Write tests in tests/shared/ first: chord-only lines, mixed lines, section labels, an Instrumental with only chords, blank-line collapsing, and empty content.
- Add an app test in tests/app/ for the toggle.

Follow CLAUDE.md. Run npm run build and npm test before saying it works. Don't commit, push or merge unless I ask.
```

---

## 2. Printable Lyrics

### Idea (as given)
This works like Print setlist, but it prints the lyrics. Every song page gets a print-lyrics button. Inside a gig there is a "Print lyrics" button that prints every song's lyrics. The text is smaller than the setlist titles. When printing, you choose between lyrics with chords and lyrics only.

### What already exists
- **Print setlist** is the pattern to copy:
  - `src/app/pages/GigPage.tsx:235-239` has a button that calls `window.print()`.
  - The printed content is a hidden `<ol className="print-setlist">` at `GigPage.tsx:286-293`.
  - CSS is in `src/app/styles.css:233-255`:
    - `@page { size: A4 portrait; margin: 0 }`, with 15mm padding on `.gig-page` and `box-decoration-break: clone`;
    - everything else is hidden through `body:has(.print-setlist)`;
    - titles are `900 34pt "Arial Black"`.
  - It is the only `@media print` block in the app.
- **Lyrics Mode's `lyricsOnly` helper** (idea 1) supplies the lyrics-only text.
- **`transposeContent`** in `src/shared/sheet.ts` transposes content to the band key.
- **Gig setlist:** `Gig.setlist: SetlistItem[]` holds songs and breaks in order.

### Decisions
- **Decided:**
  - Body text is **14pt monospace**, much smaller than the 34pt setlist titles. Monospace keeps chords lined up over the lyrics.
  - **Each song starts on a new page.**
  - **Set breaks and notes do not print.** Only the songs' lyrics print.
  - You choose "Lyrics + chords" or "Lyrics only" each time you print.
- **Open:**
  - Should song titles be a larger heading, around 20-24pt? Recommended: yes.
  - Should the print show the key (for example "Key: G, capo 2")?

### Prompt
```text
Add "Print lyrics" to the band site. It works like the existing Print setlist, but prints each song's lyrics.

Start with superpowers:brainstorming. Save the spec to docs/superpowers/specs/ and the plan to docs/superpowers/plans/. Then build it test-first.

This depends on the Lyrics Mode feature: reuse its lyricsOnly() helper from src/shared/sheet.ts. If that helper doesn't exist yet, stop and tell me.

Where:
- SongPage: a "Print lyrics" button prints that one song.
- GigPage: a "Print lyrics" button next to "Print setlist" prints every song in the setlist, in setlist order.
  - Show it only when you're not editing and the setlist has at least one song, the same rule as Print setlist.

Print options:
- Before printing, ask "Lyrics + chords" or "Lyrics only", for example with a small dialog or two buttons. Then call window.print().
- Use the band key, meaning the transposed content as the song page shows it, via transposeContent.

Layout:
- Body text: 14pt monospace, so chord columns stay lined up over the lyrics.
- Each song begins with its title (and artist, if known) as a heading, smaller than the 34pt setlist titles.
- Every song starts on a new page: break-before: page on every song after the first.
- Keep section labels ([Verse 1], [Chorus] and so on). Avoid splitting a section across pages where possible.
- Print only songs. Set breaks and notes from the setlist are not printed.
- A song with no content prints its title and "No lyrics yet". Don't invent text.
- Print on A4 with the same margin approach as the setlist: @page margin 0, 15mm padding, box-decoration-break: clone.

Implementation notes:
- Copy the existing print pattern: a hidden print-only block, plus a body:has(...) selector that hides the rest of the page.
- Don't break Print setlist. Make sure the two print modes can't both show at once.
- Don't add a print route. Routing rules are in CLAUDE.md.

Tests:
- Unit tests for any shared function that builds the print content.
- App tests that the buttons render the right hidden print block for each option.
- Then check the print preview by hand in Chrome for one song and for a gig with breaks. Tell me what you checked.

Follow CLAUDE.md. Run npm run build and npm test before saying it works. Don't commit, push or merge unless I ask.
```

---

## 3. Playable Audio (research first)

### Idea (as given)
Research whether a song can be played through Spotify, or through YouTube if Spotify isn't possible.

### What already exists
- **Uploaded mp3s:** `src/app/components/TrackPlayer.tsx` plays them, and `SongPage` shows it when `song.trackId` is set.
- **Song fields:** `Song` in `src/shared/types.ts` has no Spotify or YouTube field.
- **Spotify playlist import:** `netlify/functions/lib/spotify.ts` reads the playlist embed page.
  - It keeps only `{title, artist}`.
  - Each track's `spotify:track:...` URI is in that page (see `tests/fixtures/spotify-embed.html`), but it is thrown away.

### First research (2026-11-14)
These findings come mostly from community forums and need confirming against the official docs.

- **Spotify embed (iframe):**
  - It plays **full songs only when the listener is logged into spotify.com in a desktop browser**, and the iframe has `allow="encrypted-media"`.
  - On phones, in app WebViews, or when logged out, it plays **30-second previews**.
  - Several people say it falls back to previews even when they're logged in.
- **Spotify Web Playback SDK:** needs Spotify Premium and a sign-in (OAuth) for each listener. That is a poor fit for a site with no logins.
- **YouTube IFrame Player API:**
  - It plays **full songs for free**, on phones too.
  - The listener must tap play: mobile browsers block autoplay. Use `playsinline` and the `onAutoplayBlocked` event.
  - Some videos have embedding turned off by the uploader.
- **First take:** YouTube is the reliable way to hear a full song on a phone. Spotify suits people on a laptop who are logged in. A song could store either link, or both.

Sources:
- [Spotify Community: Play Button only preview](https://community.spotify.com/t5/Other-Podcasts-Partners-etc/Spotify-Play-Button-only-preview/m-p/4501924)
- [Spotify Community: 30s preview on Android WebView embeds](https://community.spotify.com/t5/Spotify-for-Developers/Only-30s-preview-on-Android-WebView-embeds/td-p/5386262)
- [Spotify Community: iFrame API stuck in preview mode](https://community.spotify.com/t5/Spotify-for-Developers/ANGULAR-iFrameApi-Stuck-in-preview-mode-after-authenticating/m-p/5603083)
- [YouTube IFrame API revision history (onAutoplayBlocked)](https://developers.google.com/youtube/iframe_api_revision_history)
- [YouTube iframe autoplay on iOS (Stack Overflow archive)](https://kaweah.freedombox.rocks/kiwix/content/stackoverflow.com_en_all_2023-11/questions/48675910/youtube-iframe-api-not-autoplaying-on-ios)

### Decisions
- **Open:**
  - Store a Spotify link, a YouTube link, or both?
  - Should the playlist import keep the Spotify track link automatically?
  - Paste a link by hand, or search YouTube from the app? Searching needs an API key, so pasting is simpler.
  - Where does the player sit on SongPage relative to the mp3 TrackPlayer?

### Prompt
```text
I want band members to hear a song's original recording from the song page: through Spotify if that works, otherwise YouTube.

Step 1, research (no code yet):
- Check the official Spotify for Developers docs (Embeds / iFrame API, Web Playback SDK) and the YouTube IFrame Player API reference. Confirm or correct these findings:
  - The Spotify embed plays full tracks only for listeners logged into spotify.com in a desktop browser, with allow="encrypted-media"; otherwise it plays 30-second previews, including on phones.
  - The Web Playback SDK needs Premium plus OAuth.
  - YouTube plays full videos on phones after a user tap (playsinline, onAutoplayBlocked); some videos block embedding.
- Also check the terms of use for embedding each one on a private site.
- Report back with a short comparison and your recommendation before designing anything. List your sources.

Step 2, after I choose (use superpowers:brainstorming, then write the spec and plan to docs/superpowers/):
- Likely shape: optional spotifyUrl and/or youtubeUrl fields on Song.
  - Stored as "" when unknown. Never guess a link.
  - Validated in netlify/functions/lib/repo.ts (SONG_FIELDS, LIMITS): accept only real open.spotify.com/track/... and youtube.com / youtu.be links.
- Show the matching player on SongPage alongside the existing mp3 TrackPlayer, and allow editing the links on the song edit page.
- Consider keeping the spotify:track: URI during Spotify playlist import (netlify/functions/lib/spotify.ts currently throws it away; see tests/fixtures/spotify-embed.html).
- The player must not break offline mode: when offline, hide it or show "needs internet".
- Check every place an empty link could show (CLAUDE.md "empty field" rule).

Build test-first. Follow CLAUDE.md. Run npm run build and npm test before saying it works. Don't commit, push or merge unless I ask.
```

---

## 4. Guitar Tuner

### Idea (as given)
A simple guitar tuner tool, with two instrument options: guitar and bass.

### What already exists
- No Web Audio or `getUserMedia` code exists in the app yet.
- **`useWakeLock(active)`** keeps the screen on.
- **Routes** are in `src/app/App.tsx`.
  - The bottom nav has three links: Gigs, Songs, Original Songs. A fourth "Tools" link fits, since each link is `flex: 1`.
  - `public/_redirects` already sends every path to the SPA, so a `/tools` route needs only a `<Route>` and a `NavLink`.

### Decisions
- **Decided:** two instruments.
  - **Guitar**, 6-string standard tuning: E2 A2 D3 G3 B3 E4.
  - **Bass**, 4-string standard tuning: E1 A1 D2 G2.
- **Open:**
  - Alternate tunings (drop D, 5-string bass with low B)?
  - A4 reference pitch fixed at 440 Hz, or adjustable?
  - A needle display, a strobe display, or both?

### Prompt
```text
Add a tuner to the band site with two instrument options: Guitar and Bass.

Start with superpowers:brainstorming. Save the spec to docs/superpowers/specs/ and the plan to docs/superpowers/plans/. Then build it test-first.

Where:
- Add a new /tools page (src/app/pages/ToolsPage.tsx) and a fourth "Tools" link in the bottom nav in src/app/App.tsx.
- The metronome will live on this page too.
- If the Tools page already exists, add the tuner to it.

Instruments (the user can switch between them; remember the choice per device in localStorage):
- Guitar, 6-string standard: E2 A2 D3 G3 B3 E4.
- Bass, 4-string standard: E1 A1 D2 G2.
- Ask me whether to add drop D or 5-string bass.

How it works:
- Microphone via navigator.mediaDevices.getUserMedia({ audio: true }), turning off echoCancellation, noiseSuppression and autoGainControl so pitch is accurate.
- Feed it into an AudioContext with an AnalyserNode.
- Put pitch detection in a pure module with no React or browser APIs (for example src/app/tuner/pitch.ts): autocorrelation or YIN, plus a helper from frequency to note, octave and cents.
  - It must detect bass low E (about 41.2 Hz): use a large enough sample window, and ignore readings that are too quiet or too unclear.
- UI:
  - the nearest note name and octave,
  - cents sharp or flat with a needle or meter, and a clear "in tune" state within about ±5 cents,
  - the selected instrument's strings, with the nearest string highlighted.
- Ask for the microphone only after the user taps Start. Handle permission denied with a clear message.
- Stop the microphone tracks and close the AudioContext when the user stops or leaves the page.
- Keep the screen awake while tuning with useWakeLock.
- Test on iOS Safari and Android Chrome. Note anything browser-specific in the spec.

Tests:
- Unit-test pitch detection with synthetic sine waves (plus some harmonics) at every string frequency of both instruments.
- Unit-test the cents calculation and nearest-string choice.
- Add an app test for the instrument switch.

Follow CLAUDE.md. Run npm run build and npm test before saying it works. Don't commit, push or merge unless I ask.
```

---

## 5. Metronome

Split into two parts: **v1** is a metronome on one phone. **v2** keeps several phones in time with each other, based on the research you pasted, summarised below.

### Idea (as given)
A metronome. The research you pasted adds an option to keep every band member's phone clicking together.

### What already exists
- **`useWakeLock`** and **`useStageMode`** for on-stage use.
- **The Tools page** from the tuner, or create it here if the metronome is built first.
- **Song fields:** `Song` has no `bpm` or time-signature field yet.
- **Backend:** Netlify Functions plus Blobs (`netlify/functions/lib/kv.ts`, strong consistency) is enough for v2. No WebSockets are needed.

### Notes on syncing phones (summary of the pasted research)
- **Only events cross the network, not clicks.** Each phone needs three things:
  - the tempo and time signature,
  - a shared start time,
  - its own clock offset.
  - From those it works out "beat N happens at start + N × 60/bpm" and plays its clicks locally with Web Audio.
- **Shared clock:**
  - A tiny `/api/time` function returns the server's time.
  - Each phone calls it about 10 times and keeps the fastest reply.
  - offset = server time − midpoint of that round trip (Cristian's algorithm, the simple form of NTP).
  - Accuracy is usually 5-20 ms on decent Wi-Fi.
- **Shared state:**
  - The leader saves `{bpm, beatsPerBar, startAt, running}` to Blobs.
  - `startAt` is a couple of seconds in the future, for example the next bar.
  - Followers check for changes every 1-2 seconds. Because changes are scheduled ahead, everyone gets them in time.
- **Re-sync:** phones drift apart within minutes (Google's Racer project found this). Re-measure the offset every few seconds and re-link `performance.now()` to `AudioContext.currentTime`.
- **Problems to know about:**
  - Speaker output delay differs per device. `AudioContext.outputLatency` is unreliable, especially in Safari before 18.4, so add a per-device "nudge ±ms" slider.
  - **Bluetooth headphones and in-ears add 150-300 ms.** Use wired earphones or calibrate by hand.
  - **The iPhone silent switch** mutes Web Audio unless the page sets `navigator.audioSession.type = "playback"` (Safari 16.4+).
  - Browsers pause audio when the page is hidden, so keep the screen on with `useWakeLock`.
  - Each person must tap "Join" once before any sound plays (browser autoplay rules).
- **A visual beat flash** has none of these audio-delay problems and is useful on stage by itself.
- **A simpler alternative:** if the drummer only needs everyone on the same tempo, one phone can play the click into the in-ear or monitor mix.

Sources (from the pasted research): Case Study – The Sounds of Racer (web.dev); W3C webtiming list on Web Audio sync jitter and latency; PeerClock Metronome; Synchronome (GitHub); Synchronize audio and video playback on the web (web.dev); MDN AudioContext.outputLatency; MDN getOutputTimestamp(); Apple forums on getOutputTimestamp in Safari; WebKit bug 232728; Netlify docs on real-time; Introducing Netlify Server; Netlify: WebSockets in a serverless world.

### Decisions
- **Open (v1):**
  - Store a tempo (`bpm`) and time signature on each song, so the metronome can open at that song's tempo?
  - Which click sounds, and should subdivisions (8ths, 16ths) be included?
- **Open (v2):**
  - Who controls the tempo: anyone, or one leader?
  - Is a session tied to a gig, a song, or neither?
  - How does calibration work?
  - Visual flash only, or click plus flash?

### Prompt: v1 (one phone)
```text
Add a metronome to the band site.

Start with superpowers:brainstorming. Save the spec to docs/superpowers/specs/ and the plan to docs/superpowers/plans/. Then build it test-first.

Where:
- On the /tools page (src/app/pages/ToolsPage.tsx), with a "Tools" link in the bottom nav in src/app/App.tsx. Create the page if the tuner hasn't already.
- Also add a launcher on SongPage that opens the metronome at that song's tempo, when the song has one.

Features:
- Tempo 30-300 BPM, with +/- buttons and a slider or number field.
- Tap tempo.
- Beats per bar (2, 3, 4, 6 and so on), with an accented first beat.
- Start and stop, plus a large visual beat flash that is readable on stage.
- Keep the screen awake while running (useWakeLock).

Timing:
- Use a Web Audio look-ahead scheduler: a short timer schedules clicks a little ahead on AudioContext.currentTime.
- Never play clicks straight from setInterval or setTimeout.
- Put the scheduling maths in a pure, testable module, for example src/app/metronome/schedule.ts.
- Create the AudioContext on the first user tap.
- On iOS, set navigator.audioSession.type = "playback" where supported, so the silent switch doesn't mute it.

Data (ask me first):
- Should Song get optional bpm and timeSignature fields?
- If yes:
  - store "" or null when unknown, never a made-up default;
  - validate them in netlify/functions/lib/repo.ts (SONG_FIELDS, LIMITS);
  - make them editable on the song edit page;
  - check every place an empty value is shown (CLAUDE.md "empty field" rule).

Design v1 so v2 can add a shared clock later: keep "what beat happens when" separate from "which clock it uses".

Tests:
- Unit-test the scheduler maths (beat times, accents, tempo changes taking effect on the next beat) and tap-tempo averaging.
- Add an app test for start, stop and BPM controls.

Follow CLAUDE.md. Run npm run build and npm test before saying it works. Don't commit, push or merge unless I ask.
```

### Prompt: v2 (keep several phones in time)
```text
Extend the existing metronome (v1 must already be built) so several band members' phones click in time with each other.

Start with superpowers:brainstorming. Ask me:
- who controls the tempo,
- whether a session is tied to a gig or song,
- how calibration should work,
- whether it should be visual-only or click plus flash.
Then write the spec and plan to docs/superpowers/.

Approach (from earlier research, please check it again):
- Send only events, never clicks. Each phone works out beat N at startAt + N * 60/bpm and plays it locally with Web Audio.
- Shared clock:
  - Add a new netlify/functions/time.ts at /api/time that returns the server time, following the makeXHandler pattern.
  - The client calls it about 10 times, keeps the fastest round trip, and sets offset = serverTime - midpoint (Cristian's algorithm).
  - Re-sync every few seconds, and re-link performance.now() to AudioContext.currentTime each time.
- Shared state:
  - The leader writes {bpm, beatsPerBar, startAt, running, updatedAt} to Blobs through a repo function with validation in netlify/functions/lib/repo.ts.
  - Changes are scheduled about 2 s ahead, for example "start at the next bar".
  - Followers poll every 1-2 s. No WebSockets.
- Each person taps "Join" once, to unlock audio and start syncing.
- Per-device "nudge ±ms" calibration slider, saved in localStorage.
- Show the measured offset and sync quality on screen, so problems are visible.
- Show warnings in the UI:
  - Bluetooth headphones add 150-300 ms;
  - the iPhone silent switch (set navigator.audioSession.type = "playback");
  - the screen must stay on (useWakeLock).
- The visual beat flash must work even when audio is off.

Tests:
- Server tests use memoryKV(), not mocked Blobs.
- Unit-test the offset estimate with simulated round trips, and the beat-time maths with an offset applied.

Follow CLAUDE.md. Run npm run build and npm test before saying it works. Don't commit, push or merge unless I ask.
```
