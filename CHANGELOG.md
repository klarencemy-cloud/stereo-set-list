# Changelog

What's new on Stereo Set, newest first.

## Unreleased: Original songs get their own page

### Added

- **Original songs have a page.** In Original Songs, tap a title to open it. Play the recording, edit the song, and add lyrics and chords like any other song. Songs uploaded earlier get their page the first time you open them.
- **Original songs show up in Songs.** They are in the list (marked "Original"), can be searched, and can go in a setlist.
- **The title fills in from the file.** Pick an mp3 and the title becomes the file name, as long as the title is empty. A title you typed first is kept.

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
