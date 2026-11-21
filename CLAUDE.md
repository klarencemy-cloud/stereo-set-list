# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — `netlify dev` (serves the Vite app plus functions at http://localhost:8888; Vite runs on 5173 behind it). Local data is kept in a local Blobs store.
- `npm run build` — `tsc --noEmit && vite build` (type-check is part of the build; there is no separate lint step).
- `npm test` — `vitest run`. Single file: `npx vitest run tests/shared/transpose.test.ts`; by name: `npx vitest run -t "name"`.
- Node 22+ required.

## Architecture

Private band site (setlists, chord sheets, mp3s). React 18 + react-router SPA on Netlify, with Netlify Functions as the API and Netlify Blobs as the only storage. There is no auth by design.

- `src/shared/` — code imported by BOTH the client and the functions (`types.ts`, `transpose.ts`, `sheet.ts`). Keep it free of browser/Node-specific APIs. Functions import it via relative paths (`../../src/shared/...`).
- `netlify/functions/*.ts` — one function per resource (`songs`, `gigs`, `tracks`, `import`), each mapped to `/api/...` via its exported `config.path`. Each exports `makeXHandler(repo)` for testing plus a default export wired to `blobsKV()`. Shared plumbing is in `lib/`:
  - `kv.ts`: `KV` interface with `memoryKV()` (tests) and `blobsKV()` (strong consistency, store `band`).
  - `repo.ts`: all validation (`ValidationError`/`NotFoundError`, `LIMITS`) and persistence logic over a `KV`. Add field validation here.
  - `http.ts`: `guard`, `json`, `routeParts`, etc.
  - `ug.ts`: Ultimate Guitar chord-page scraper (fixture in `tests/fixtures/ug-chords.html`); UG may block Netlify, so the UI falls back to pasting chords.
- mp3 tracks are uploaded in chunks (`CHUNK_SIZE`, `MAX_AUDIO_BYTES` in `types.ts`; client side in `src/app/upload.ts`), tracked by `parts`/`uploadedParts` on `Track`.
- `src/app/` — the SPA: `api.ts` (fetch wrapper), `pages/`, `components/` (including hooks like `useAutoscroll`, `useWakeLock`, `useFontSize`, `useSwipe`), `offline.ts` / `songCache.ts` (offline song caching).
- `src/app/tuner/` and `src/app/metronome/` — the `/tools` page's audio tools. The maths (`pitch.ts`, `schedule.ts`) is pure and unit-tested; the Web Audio and microphone code lives in the `use*` hooks (shared helpers in `src/app/audio.ts`).
- `src/sw/` — offline service worker. It is a **second Vite rollup entry** emitted as `/sw.js` (see `vite.config.ts`). `sw.ts` must import only from `./strategy` so the build produces one self-contained classic-worker file. Caching logic lives in `strategy.ts` so it is unit-testable.
- Routing: `public/_redirects` provides the SPA fallback in production; `netlify.toml` `[dev]` runs Vite as a custom framework, so don't add redirect rules to `netlify.toml`.

## Testing

Vitest with `globals: true`. `tests/app/**` run under jsdom (setup in `tests/app/setup.ts`); everything else runs in node. Server tests use `memoryKV()` rather than mocking Blobs.

## Conventions (learned from past bugs)

- Optimistic saves (e.g. `GigPage.save`) resolve `true`/`false`. Never clear what the user entered (typed text, ticked songs, search) until the save resolved `true`; a failed save must leave it in place to retry.
- When the same resource can be read more than one way (e.g. `getGig` and `listGigs`), every read path goes through the same normalising helper, so the responses can't disagree.
- Don't invent placeholder data. If a value isn't known, store it empty and show it as unknown in the UI (an original song with no key has `originalKey: ""`; the app shows `?` or nothing, never a made-up `C`).
- When a key/field can be empty, check every place that displays or transposes it (Songs list, gig view/edit, AddSongsPicker, SongPage, TransposeControl).
- Code-review findings: reproduce the claim first (a throwaway test is fine) before fixing; several past findings described a bug that couldn't actually happen.

## Environment quirks

`package.json` `overrides` swaps Rollup for `@rollup/wasm-node` because Windows Application Control blocks the native binary on the author's machine. Leave it in place.

Design specs and plans live in `docs/superpowers/`; `CHANGELOG.md` tracks releases.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `klarencemy-cloud/stereo-set-list`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created only when they're needed. See `docs/agents/domain.md`.

### Agent team

Two lanes: `/bug <symptom or #issue>` takes a bug to an open PR (never merges); features are typed by hand (`/grill-with-docs` → `/implement`, or `/to-spec` → `/to-tickets` → `/implement-spec`). `.claude/skills` must link to `.agents/skills` (committed as a symlink; on Windows run `scripts/setup-skills.ps1` once per clone, see the guide). See `docs/agents/workflow.md`.

Before opening any PR, run `npm test` and `npm run build` and show the output.
