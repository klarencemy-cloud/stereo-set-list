# Band Site: Design

Date: 2026-11-11. Status: draft, waiting for approval.

## Intent and the why
The band plans gigs in Messenger. Members have to ask "what key is this?" and sometimes practice in different keys. They also can't share unreleased songs on streaming platforms to practice with. This site gives the band one shared place that shows the agreed key and chords for every song, the setlist for each gig, and audio of the band's unreleased songs.

## Goals
- One agreed key per song, set by the band (the singer decides). Everyone sees the same key.
- Add a cover song by pasting an Ultimate Guitar link. The site imports title, artist and the chord sheet.
- Transpose the chords to the agreed key.
- Gigs: a name, a date, and an ordered setlist of songs. Each entry shows its agreed key.
- Upload mp3s (3 to 5 minutes each) of unreleased songs and play them in the site.
- Works well on phones (primary, used at practice and on stage) and on desktop.
- Simple. Few screens, little to learn.

## Non-goals (for now)
- Login, accounts and permissions. Planned for later.
- Audio chord detection, and any chord source other than Ultimate Guitar.
- Per-song notes, who sings what, or other extras on the setlist.

## Anti-goals
- Members practicing in different keys because the site was unclear about the key.
- Chord text too small or cluttered to read on a phone on stage.
- Making the site complicated to look simple on paper.

## Constraints
- **Open access (the user's decision):** anyone with the address can add, edit and delete everything, including hearing unreleased uploads. The user knows this and accepted it. Login and permissions come later, so keep data access in one place to make that easy.
- Hosting is Netlify's free plan (the user's choice). Everything (data, audio, link import) must run there with no other account.
- Uploads are mp3 files of 3 to 5 minutes, roughly 3 to 12 MB depending on quality. Netlify function requests are limited to about 6 MB, so audio upload must not depend on sending the whole file through one function call.
- Link import is unofficial and may break or get blocked. A quick test on one Ultimate Guitar page worked: the page contains the song name, artist, listed key and chord sheet (chords marked above lyric lines, with section labels such as [Intro] and [Verse 1]). Ultimate Guitar's terms do not clearly allow this, so it must fail gracefully.

## Decisions by the user
- Ultimate Guitar link as the way to get chords.
- Everyone in the band can add songs and change keys.
- Fully open for now. No login.
- Gig = name, date, setlist.
- Phones and desktop.
- Netlify free hosting.

## My calls (please check)
- A normal website, with no app to install.
- A "paste the chords yourself" box as the backup when link import fails.
- Keep a link back to the original Ultimate Guitar page on each song.
- Netlify's own storage for songs, gigs and audio, so no other service is needed.
- Transposing happens when viewing. The stored chords stay as imported, and the band's key is stored separately.
- Each song stores the key the imported chords are written in (taken from the listed key, and editable if it is missing or wrong) and the band's agreed key. Transposing goes from the first to the second.
- Chord sheet view: large text, chords shown above lyrics, usable one-handed on a phone.

## Chord view (the user's decision: look and feel like Ultimate Guitar)
The band already knows Ultimate Guitar's chord page, so the chord view follows its layout for familiarity:
- Header: song title in large bold text, then "by" and the artist.
- A row of rounded pill buttons under the header. At least: Autoscroll (with a Speed control) and Transpose. (My guess: Autoscroll belongs here because it is the main on-stage control.)
- An info line: "Key: G" showing the band's agreed key, plus capo if any.
- The sheet in a monospace font, with each chord in a small light-grey highlighted box sitting directly above the lyric syllable it belongs to, keeping the exact spacing from the source.
- Transpose changes the band's agreed key for everyone (the user's decision). There is no per-phone transpose. Because a change affects the whole band, the new key should be clearly visible on the Key line and in setlists right away.
- Section labels in brackets on their own line, e.g. [Intro], [Verse 1], [Pre-chorus 1].
- Copy the layout and feel only, not Ultimate Guitar's name, logo or branding, so the site is clearly the band's own.

## Left to the builder
- Tech stack and project layout within Netlify's free plan.
- How to read the chord markup and how to transpose it (including flats vs sharps, and slash chords).
- How to upload audio within Netlify's size limits.
- Look and layout, following the phone-first, large-text goal above.
- Naming, error messages, empty states.
