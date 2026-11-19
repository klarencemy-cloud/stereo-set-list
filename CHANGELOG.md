# Changelog

What's new on Stereo Set, newest first.

## Unreleased: A steadier band metronome

### Fixed

- **Start for everyone no longer takes over.** If a bandmate has already started the metronome, tapping Start for everyone leaves theirs playing and shows "Already playing at 120 BPM" with Join, instead of switching everyone to your tempo.
- **It no longer stops by itself mid-gig.** A metronome that phones have joined keeps going for as long as they play along. One nobody has joined still switches itself off after 2 hours, so a forgotten one doesn't get in the way.
- **Stop for everyone always sticks.** Pressing Stop at the same moment as someone else changes the tempo no longer loses the Stop; the same goes for two tempo changes at once.
- **Two quick changes keep everyone on the same bar.** Changing the beats per bar and then the tempo within a few seconds (or two people changing it at once) no longer leaves phones playing different bars for a moment. A phone that joins just before a change starts also plays along straight away.
- **Changes reach every phone in time.** A start or a tempo change now begins 3 seconds after the tap (was 2), so a phone on a slow connection hears of it before it starts.
- **Tighter timing.** Phones keep their clocks in step with every check, not only when they join, and a phone on a jittery connection no longer nudges its clicks every bar.
- **Ready when you tap.** A phone starts setting its clock as soon as the metronome opens, not when you tap Start or Join. On a slow 4G connection the phone that starts it now hears its own count-in from beat 1, and Join plays straight away instead of after several seconds of silence. After that it makes no extra clock calls: the regular checks keep it in step.
- **A warning when timing is rough.** A phone that keeps time by its clock alone (it couldn't hear the band, or hasn't been measured) shows its sync status as a warning when it may be more than 25 ms off, and suggests measuring this phone or using Wi-Fi. A phone matched to the band by ear never shows it.
- **Paused sound is shown.** When a call, Siri or the lock screen pauses a joined phone's sound, it now says "Sound paused — tap to resume" instead of flashing on in silence. One tap brings the clicks back, in time with the band, with no cut or doubled click.
- **In time after the phone sleeps.** A joined phone whose screen was off long enough to sleep now notices when you come back and lines itself up again, instead of playing up to half a beat off while saying it is synced. A phone matched to the band by ear goes quiet for a few seconds and listens to the band again while the flash keeps going. A phone that didn't sleep carries on as it was. Phones also stay closer in time over a long rehearsal, as each one prefers its newest clock readings.
- **Lighter on the server.** A phone playing along checks for changes every 2 seconds (was 1.5), about a quarter fewer calls, so a month of rehearsals is less likely to use up the site's free allowance. Changes still reach a phone in time on a connection up to about 0.9 s slow.
- **Back online doesn't cut you off.** Playing on this phone only while offline, the clicks now keep going when the network comes back, and the phone offers "Back online — switch to the shared metronome?" instead. "Try syncing again" checks straight away and says if it still can't reach the server.

## Unreleased: Lyrics and band tools

### Added

- **Lyrics mode.** On a song, tap "Chords: on" to switch the chords off and see only the lyrics. The gaps the chord lines leave close up, and section labels such as [Verse 1], [Chorus] and [Instrumental] stay. Your phone remembers the choice for every song. Tap again to bring the chords back, in the current key.
- **Print lyrics.** A song's page and a gig's page each have a "Print lyrics" button. Choose "Lyrics + chords" or "Lyrics only", then print. A gig prints every song in setlist order, each on a new page; set breaks and notes are left off. Chords print in the band key.
- **Tools page.** A new Tools tab in the bottom bar.
- **Tuner.** A chromatic tuner on Tools, for any instrument and any tuning. Tap Start tuner and play a note: it shows the nearest note (with its octave) and how many cents sharp or flat. It hears down to a 5-string bass's low B. The reference pitch is A4 = 440 Hz; change it with - / + or type a number from 415 to 466, and tap "Reset to 440" to go back. Your phone remembers it. Uses the microphone; the screen stays on while it listens.
- **Tuner: smooth and strict.** The needle glides and the cents reading holds steady instead of jumping. "In tune" (green, with a ✓) means within 3 cents either way: hold the note there for a second while a bar under the meter fills. 4 or more cents off says tune up or tune down. The needle has no outline. A new A4 applies straight away, even while you're still typing it.
- **Metronome.** On Tools: 30-300 BPM with - / + and a slider, tap tempo, 2 to 7 beats per bar with an accented first beat, and a big flashing beat you can see on stage. Your phone remembers the tempo and beats per bar.
- **Song tempo.** A song can have a tempo (30-300 BPM) and beats per bar (2-7), set on its Edit page. Leave them empty if nobody knows yet: nothing made-up is shown.
- **Metronome for the whole band.** On a song, tap "Metronome" (it shows the song's tempo, and a green dot while someone is playing it). Tap "Start for everyone": anyone else who opens that song's metronome sees "Playing at 120 BPM" and taps Join, and every phone clicks and flashes in time. Anyone can change the tempo (it switches on the next bar for everyone), tap Leave to stop just their phone, or Stop for everyone. "Save as song tempo" keeps the tempo on the song. If a phone sounds late (Bluetooth earphones lag), use "Calibrate this phone": move the slider, or tap along to 12 clicks and it measures the delay for you. With no connection it says so and plays on that phone only. An open metronome that you haven't joined checks for changes only every 10 seconds, and a phone with its screen off doesn't check at all, so it uses far less data.

## Unreleased: Safer edits

### Fixed

- **Two people editing at once no longer overwrite each other.** If a bandmate saved a song or a setlist after you opened it, your save stops and says "Someone else changed this". Tap Reload to see their version. What you typed stays until you tap Reload.
- **Editing a song no longer undoes a transpose.** Saving the edit form only changes what you edited, so a key a bandmate picked in the meantime stays.
- **Fewer out-of-date pages after a change.** Saving or deleting a song, gig or recording now always forgets the app's saved copy of exactly what changed, so the next page you open shows the change.
- **Deleting an original song can always be finished.** If deleting a recording or its song fails part-way (for example on a bad connection), deleting it again cleans up everything that is left.

## Unreleased: Import a Spotify playlist

### Added

- **Import Playlist.** When you create a gig, tap "Import Playlist", paste a Spotify playlist link and tap Load. Every track is listed and ticked; untick any you won't play. Create the gig and the ticked tracks become its setlist, in playlist order. Each track also goes into Songs. A song you already have (same title and artist) is reused, with its chords, instead of being added twice.
- **Import Playlist on an existing gig.** The same button on a gig's page adds the ticked tracks to the end of its setlist. Songs already in the setlist are marked "in setlist" and skipped.
- **Paste a track list instead.** If Spotify can't be read, paste the tracks yourself, one per line as "Title - Artist". Spotify's page only lists the first 100 tracks of a playlist.
- **Import chords while editing.** Edit song now has the Import button. Paste an Ultimate Guitar link to fill in the chords, key and capo. The title and artist stay as they are, and a band key you already chose is kept. Nothing is saved until you tap Save.
- **"No chords yet" tag.** Songs with no chords are marked in the Songs list and in gig setlists, so you can see what's left to fill in.

### Changed

- **Any song can be saved without a key.** Imported songs start with no key; they show "?" until you set one or import the chords.

## Unreleased: Original songs get their own page

### Added

- **Original songs have a page.** In Original Songs, tap a title to open it. Play the recording, edit the song, and add lyrics and chords like any other song. Songs uploaded earlier get their page the first time you open them.
- **Original songs show up in Songs.** They are in the list (marked "Original"), can be searched, and can go in a setlist.
- **The title fills in from the file.** Pick an mp3 and the title becomes the file name, as long as the title is empty. A title you typed first is kept.
- **Guitar tabs fit the phone screen.** A tab too wide for the screen is wrapped the way Ultimate Guitar does it: the first piece of all six strings, then the next piece, so the strings stay lined up under their chords instead of each one wrapping on its own.

### Changed

- **The printed setlist is just the song titles.** The date, site name, web address and page number the browser used to add at the edges are gone.
- **Rename and delete go both ways.** Renaming an original song in either place renames both. Deleting one deletes the song page, its lyrics and chords, and the mp3 together.

### Fixed

- **New original songs no longer claim to be in C.** A song made from an uploaded recording now starts with no key. The Songs list and setlists show no key for it, and the song page shows "Key: ?" until you set one in Edit. You can save an original song without choosing a key. Original songs uploaded before this fix still say C; fix those in Edit.
- **A failed save no longer wipes your setlist note.** If a note or set-break name can't be saved, what you typed stays in the box so you can try again.
- **A failed "Add songs" keeps your picks.** If adding songs to a setlist fails, the songs stay ticked and the search stays filled in, so you can tap Add again.

## Unreleased: Plan the setlist

### Added

- **Set breaks.** In Edit setlist, tap "Add set break" to split the gig into sets. Name each break (Set 2, Encore...). Song numbers keep counting across breaks. The printed sheet still lists only song titles.
- **Notes on songs.** Write a short note on any song in a gig, like a count-in or a segue. It shows in the setlist, and above the chords when you open the song from that gig.
- **Add several songs at once.** At the top of Edit setlist, search the song list, tick as many songs as you want, and add them in one go. They go in the order you ticked them.
- **Drag to reorder.** In Edit setlist, drag a song or a break by the dots on its left. This replaces the Move up and Move down buttons.
- **Edit chords in the song form.** The Chords box now starts filled with the song's current chords. Fix them and save. If you don't touch the box, the chords are saved exactly as they were.
- **Stage mode.** Tap Stage on a song to hide the top bar and bottom menu and go fullscreen, where your phone allows it. It stays on as you move through the gig. Tap Exit stage (top right) to leave.
- **A warning before you lose edits.** If you change a song and then tap away or reload without saving, the site asks first. Saving or deleting never asks.

### Changed

- **Gigs are split into Upcoming and Past.** Upcoming comes first, soonest gig at the top, and today's gig counts as upcoming. Past gigs are below, newest first.
- **Autoscroll speed is remembered per song.** Each phone remembers the speed you chose for each song, so the next song no longer starts at the last one's speed.
- **Old open tabs still work.** If someone has an old copy of the site open and reorders a setlist, notes are kept but set breaks are removed. Reload to get the new version.

## 2026-11-12: Ready for the stage

### Added

- **The screen stays on** while a song is open, even without autoscroll. It won't dim or lock in the middle of a song.
- **Text size buttons (A− / A+)** next to Speed. There are six sizes, from 13px to 28px. Each phone remembers its own choice.
- **Swipe between songs.** When you open a song from a gig, swipe left on the chords for the next song and right for the previous one.
  - A wide chord line scrolls sideways first. It only changes song once it's scrolled to the end.
  - Pinching to zoom, or moving around while zoomed in, never changes song.
- **Offline mode.** The site keeps a copy of itself and of every song and gig you open. If the signal is bad, it shows the saved copy after 4 seconds.
- **"Save for offline" button** on each gig. It saves the gig and every song in its setlist in one go, then says how many songs were saved.
- **Site logo** in the top bar, plus icons for adding the site to your phone's home screen.

### Changed

- **Next and Previous are instant.** The setlist loads once, and the songs either side are fetched in advance.
- **Editing a song always loads the latest version from the server**, never a saved offline copy. This keeps you from saving over someone else's newer changes.

### Good to know

- **Saving for offline needs signal.** Do it before you leave for the gig, ideally on the day or the day before.
- **iPhones delete saved copies** of a site that hasn't been opened for about 7 days, unless it's on the Home Screen.
- **On iPhone, Safari and a Home Screen icon don't share saved copies.** Save the gig from whichever one you'll open at the gig.
- **Offline, you can read but not change anything.** Changes need signal. The mp3s in Original Songs are not saved for offline.
