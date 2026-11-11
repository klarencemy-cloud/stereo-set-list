# Stereo Set

A private website for the band: cover songs with chords in one agreed key, gig setlists, and mp3s of our unreleased songs. It works on phones and desktop.

There is no login yet. Anyone with the site's address can view, add, change and delete everything, including the mp3s. Only share the address with the band.

## What it does

- **Songs:** paste an Ultimate Guitar chords link and the site imports the title, artist, key and chords.
  - If the import fails, paste the chords instead.
  - **Transpose** changes the key for the whole band.
- **Gigs:** a name, a date and an ordered setlist. Each song shows its agreed key.
- **Original Songs:** upload mp3s (max 25 MB each) and play them back.

## Run it on your computer

You need Node.js 22 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:8888. Data you add locally stays on your computer.

Run the tests:

```bash
npm test
```

## Deploy on Netlify (free plan)

1. Push this repository to GitHub.
2. In Netlify, choose **Add new site → Import an existing project**, then pick the GitHub repository.
3. Netlify reads the settings from `netlify.toml`, so you don't need to change anything:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
   - Node version: 22
4. Deploy. Songs, gigs and mp3s are stored in Netlify Blobs, which comes with the site, so no other account or database is needed.

### Check after the first deploy

- Open `/api/songs`. It should show `[]` or a list.
- Open `/api/nope`. It should show a "Not found" message.
- Import an Ultimate Guitar link. Ultimate Guitar may block requests from Netlify's servers; if so, the site switches to the paste box.
- Transpose a song on one phone, then reload it on another phone. Both should show the same key.

## Notes for this computer

`package.json` swaps Rollup's native binary for `@rollup/wasm-node`, because Windows Application Control blocks the native one here. The swap also works on Netlify, just with slightly slower builds. You can remove the `overrides` entry if the project moves to a machine without that block.
