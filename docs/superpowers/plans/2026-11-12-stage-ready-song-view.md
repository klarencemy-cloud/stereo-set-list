# Stage-Ready Song View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the song page usable on a mic stand during a gig: the screen stays on, text size is adjustable, Previous/Next is instant (and swipeable), and a gig's songs work with no signal.

**Architecture:** Wake lock moves out of `useAutoscroll` into its own hook, held for as long as the song page is open. Font size is a small localStorage-backed hook. A module-level in-memory cache (`songCache.ts`) makes setlist navigation synchronous and prefetches the next song. Offline is a hand-written service worker (built by Vite as a second entry, `dist/sw.js`) that caches the app shell and every successful `GET /api/songs*` / `/api/gigs*` response; "Save for offline" on a gig just fetches every song through that worker.

**Tech Stack:** React 18, react-router 6, Vite 5, Vitest 2 (jsdom + node), Service Worker + Cache Storage APIs. No new dependencies.

**Spec:** The four-item improvement list pasted on 2026-11-12 (keep screen on, offline mode, font size control, faster song changes + swipe). Quoted where values matter below.

## Global Constraints

- **Never commit or push** (CLAUDE.md). Each task ends with tests + type check passing, then stop; the user commits.
- No new npm dependencies (avoids `vite-plugin-pwa`/workbox, which bundle their own rollup and may hit the Windows Application Control block).
- Don't touch `public/_redirects` — it must keep only `/* /index.html 200`.
- Site name stays "Stereo Set" (from `src/app/config.ts`); no Ultimate Guitar branding in the manifest or icon.
- Storage access stays in `netlify/functions/lib/`; this plan changes only the client and build.
- Every new browser API (`navigator.wakeLock`, `localStorage`, `navigator.serviceWorker`, `caches`) is feature-checked; absence must never throw or show an error.
- Touch targets ≥ 44px (matches existing `.pill { min-height: 44px }`).
- Run commands with `export PATH="/c/Program Files/nodejs:$PATH"` first in Git Bash.

## Review Focus

1. **Corrupt or blocked localStorage** (`"abc"`, `"999"`, or `getItem` throwing in private mode) → font size falls back to the default 15px, no crash. Test in Task 2.
2. **Horizontal scrolling of a wide chord line** must scroll, not change song; a vertical scroll with slight sideways drift must not change song. Tests in Task 4.
3. **A failed fetch must not poison a cache**: a rejected `getSong` is not memoised (Task 3); a non-2xx API response is never written to Cache Storage (Task 5).
4. **Edits made elsewhere show up**: after editing a song, transposing, or changing a setlist, the in-memory cache must not serve the old version. Tests in Task 3.
5. **"Save for offline" before the service worker controls the page** (very first visit) → a clear message, not a false "Saved". Test in Task 7.

---

## File Map

| File | Change | Responsibility |
|---|---|---|
| `src/app/components/useWakeLock.ts` | create | Hold a screen wake lock while `active`; re-take on visibility. |
| `src/app/components/useAutoscroll.ts` | modify | Scrolling only (wake lock code removed). |
| `src/app/components/useFontSize.ts` | create | Per-device sheet font size, persisted. |
| `src/app/components/useSwipe.ts` | create | Horizontal swipe detection on an element. |
| `src/app/components/ChordSheet.tsx` | modify | Accept `fontSize` and `sheetRef`. |
| `src/app/songCache.ts` | create | In-memory song + setlist cache, prefetch. |
| `src/app/pages/SongPage.tsx` | modify | Wire all of the above. |
| `src/app/pages/SongFormPage.tsx`, `GigPage.tsx` | modify | Invalidate the cache after mutations; Save-for-offline button. |
| `src/app/offline.ts` | create | `saveGigForOffline`, service worker registration. |
| `src/sw/strategy.ts` | create | Pure, testable caching strategies. |
| `src/sw/sw.ts` | create | Service worker entry (event wiring only). |
| `vite.config.ts`, `index.html`, `src/app/main.tsx` | modify | Build `sw.js`, link manifest, register worker. |
| `public/manifest.webmanifest`, `public/icon.svg` | create | Web app manifest. |
| `src/app/styles.css` | modify | Font pill. |

---

### Task 1: Keep the screen on for the whole song page

The current lock lives in `useAutoscroll` and is only held while `running`. Players often read without autoscroll, so hold it whenever the song page is mounted.

**Files:**
- Create: `src/app/components/useWakeLock.ts`
- Modify: `src/app/components/useAutoscroll.ts` (delete the second `useEffect`, update the doc comment)
- Modify: `src/app/pages/SongPage.tsx`
- Test: rename `tests/app/useAutoscroll.test.ts` → `tests/app/useWakeLock.test.ts`; add a case to `tests/app/SongPage.test.tsx`

**Interfaces:**
- Produces: `export function useWakeLock(active: boolean): void`

- [ ] **Step 1: Move the existing wake-lock tests to the new hook.** In the renamed file, replace `renderHook(() => useAutoscroll(1, running))` with `renderHook(() => useWakeLock(running))`; keep every existing assertion. Add:

```ts
it("does nothing when the browser has no wake lock", async () => {
  const { unmount } = renderHook(() => useWakeLock(true));
  await act(async () => setVisibility("visible"));
  unmount(); // no throw
});
```

- [ ] **Step 2: Add a SongPage test** `"keeps the screen on while the song is open, without autoscroll"`: mock `navigator.wakeLock` as in the hook test, `renderPage()`, `await screen.findByText("[Intro]")`, expect `request` called once with `"screen"`; `unmount()` → expect `release` called.
- [ ] **Step 3: Run** `npm test -- useWakeLock SongPage` → FAIL (module not found / request not called).
- [ ] **Step 4: Implement** `useWakeLock` by moving the second effect of `useAutoscroll` verbatim (dependency `[active]`). Call `useWakeLock(true)` at the top level of `SongPage` (above the early `if (!song) return`, alongside `useAutoscroll`).
- [ ] **Step 5: Run** `npm test && npx tsc --noEmit` → all PASS.

---

### Task 2: Font size control (A− / A+)

Spec: "a pill with A− and A+ next to Speed, remembered per device in localStorage."

**Files:**
- Create: `src/app/components/useFontSize.ts`
- Modify: `src/app/components/ChordSheet.tsx`, `src/app/pages/SongPage.tsx`, `src/app/styles.css`
- Test: `tests/app/useFontSize.test.ts`, `tests/app/SongPage.test.tsx`

**Interfaces:**
- Produces:
  - `export const FONT_SIZES = [13, 15, 17, 20, 24, 28] as const;` `export const DEFAULT_FONT_SIZE = 15;` `export const FONT_SIZE_KEY = "stereo-set:sheet-font-size";`
  - `export function useFontSize(): { size: number; smaller: () => void; bigger: () => void; canShrink: boolean; canGrow: boolean }`
  - `ChordSheet` props become `{ content: string; onTap?: () => void; fontSize?: number; sheetRef?: React.Ref<HTMLDivElement> }` (`sheetRef` is used in Task 4; add it now). `fontSize` is applied as inline `style={{ fontSize }}` on `.sheet`.

- [ ] **Step 1: Write hook tests** (`localStorage.clear()` in `beforeEach`):
  - `"starts at 15px"` → `size === 15`.
  - `"steps through the sizes and saves them"`: `bigger()` → `size === 17`, `localStorage.getItem(FONT_SIZE_KEY) === "17"`; `smaller()` twice → `13`, `canShrink === false`; `smaller()` again stays `13`.
  - `"stops at 28px"`: set key to `"28"`, render → `canGrow === false`.
  - `"reads a saved size"`: key `"20"` → `size === 20`.
  - `"ignores a saved value that is not one of the sizes"`: for `"abc"`, `"999"`, `"16"` → `15`.
  - `"works when storage throws"`: `vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error() })` and same for `setItem` → `size === 15`, `bigger()` → `17`, no throw.
- [ ] **Step 2: Write SongPage test** `"makes the chord sheet bigger and smaller"`: click button named `"Bigger text"` → `screen.getByTestId("sheet")` has style `font-size: 17px`; click `"Smaller text"` twice → `13px`; `"Smaller text"` is disabled.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement.** Read once with lazy `useState` init inside `try/catch`; write in `try/catch`. In `SongPage`, right after the Speed pill:

```tsx
<div className="pill pill-split" role="group" aria-label="Text size">
  <button type="button" aria-label="Smaller text" disabled={!canShrink} onClick={smaller}>A−</button>
  <button type="button" aria-label="Bigger text" disabled={!canGrow} onClick={bigger}>A+</button>
</div>
```

CSS: `.pill-split { padding: 0; gap: 0; }` and `.pill-split button { min-height: 44px; min-width: 48px; background: none; border: 0; font: inherit; font-weight: 700; color: inherit; cursor: pointer; }` plus `.pill-split button:disabled { opacity: 0.35; }`. Pass `fontSize={size}` to `ChordSheet`.
- [ ] **Step 5: Run** `npm test && npx tsc --noEmit` → PASS.

---

### Task 3: Instant song changes (in-memory cache + prefetch)

Today `SongPage.tsx:48` reloads the gig and the full song list on every song change, and the song itself shows "Loading..." each time.

**Files:**
- Create: `src/app/songCache.ts`
- Modify: `src/app/pages/SongPage.tsx`, `src/app/pages/SongFormPage.tsx`, `src/app/pages/GigPage.tsx`
- Test: `tests/app/songCache.test.ts`, `tests/app/SongPage.test.tsx`, `tests/app/GigPage.test.tsx`, `tests/app/SongFormPage.test.tsx`

**Interfaces:**
- Consumes: `api.getSong`, `api.getGig`, `api.listSongs` from `src/app/api.ts`.
- Produces (all exported from `src/app/songCache.ts`):
  - `CACHE_TTL_MS = 60_000` — entries older than this are refetched (other band members may have transposed).
  - `loadSong(id: string): Promise<Song>` — shares one in-flight promise per id; a rejection removes the entry.
  - `peekSong(id: string): Song | undefined` — synchronous; only returns a resolved, unexpired song.
  - `prefetchSong(id: string): void` — `loadSong(id)` with the error swallowed.
  - `rememberSong(song: Song): void` — overwrite after a successful save.
  - `loadSetlist(gigId: string): Promise<string[]>` — `getGig` + `listSongs`, filtered to songs that still exist (the logic currently inline in `SongPage`), memoised per gig with the same TTL and rejection rule.
  - `clearSongCache(): void`

- [ ] **Step 1: Write `songCache` tests** (mock `api` the way `SongPage.test.tsx` does; `clearSongCache()` and `vi.useRealTimers()` in `beforeEach`):
  - `"fetches a song once for two loads"` → `getSong` called once.
  - `"peekSong is empty until the song arrives"` → `undefined` before `await`, the song after.
  - `"retries after a failed load"`: first `getSong` rejects, second resolves → second `loadSong` resolves.
  - `"refetches after 60 seconds"`: `vi.useFakeTimers()`, load, `vi.advanceTimersByTime(60_001)`, load → `getSong` called twice; `peekSong` returns `undefined` after expiry.
  - `"rememberSong replaces the cached copy"`.
  - `"loadSetlist drops deleted songs and is fetched once"`: gig `songIds: ["a","gone","b"]`, `listSongs` has `a`,`b` → `["a","b"]`; second call does not refetch.
  - `"clearSongCache forgets everything"`.
- [ ] **Step 2: Write SongPage tests** (add `clearSongCache()` to the existing `beforeEach`):
  - `"prefetches the next song in the setlist"`: open `/songs/s1?gig=g1` (existing gig fixture `sA, s1, sC`) → after render, `getSong` called with `"sC"`.
  - `"opens the next song without a loading screen"`: click `"Next song"` → `screen.queryByText("Loading...")` is null immediately after the click (no `await`), title of `sC` shown.
  - `"loads the setlist once while moving through the gig"`: click Next → `getGig` and `listSongs` each called once in total.
  - `"transposing updates the cached song"`: transpose up, navigate away and back → key line shows `Bb` and `getSong` not called again.
- [ ] **Step 3: Write invalidation tests**: in `GigPage.test.tsx`, after a successful setlist save, `loadSetlist("g1")` refetches (spy on `getGig` count). In `SongFormPage.test.tsx`, after a successful save and after a delete, `peekSong(id)` is `undefined`.
- [ ] **Step 4: Run** → FAIL.
- [ ] **Step 5: Implement.** In `SongPage`: song effect starts with `const cached = peekSong(id); setSong(cached ?? null);` then `loadSong(id)` (keep the `alive` guard and error text). Neighbour effect uses `loadSetlist(gigId)` and then calls `prefetchSong(next)` (also `prefetchSong(prev)`). In `transpose`, call `rememberSong` on success with the saved `bandKey`. In `SongFormPage` and `GigPage`, call `clearSongCache()` after every successful create/update/delete.
- [ ] **Step 6: Run** `npm test && npx tsc --noEmit` → PASS.

---

### Task 4: Swipe left/right for Next/Previous

Spec: "A swipe left or right could do the same as Previous and Next."

**Files:**
- Create: `src/app/components/useSwipe.ts`
- Modify: `src/app/pages/SongPage.tsx`, `src/app/components/ChordSheet.tsx` (attach `sheetRef` to the `.sheet` div)
- Test: `tests/app/useSwipe.test.tsx`, `tests/app/SongPage.test.tsx`

**Interfaces:**
- Produces: `export function useSwipe(ref: React.RefObject<HTMLElement>, handlers: { onLeft?: () => void; onRight?: () => void }): void`
  - Constants: `SWIPE_MIN_PX = 60`, `SWIPE_MAX_MS = 600`.
  - Fires only if `|dx| ≥ 60`, `|dx| > 2·|dy|`, and the gesture took ≤ 600 ms.
  - Finger moving left (`dx < 0`) → `onLeft` (= next song), but only when the element is already scrolled fully right (`scrollLeft + clientWidth >= scrollWidth - 1`). Finger moving right → `onRight` (= previous) only when `scrollLeft <= 0`. This keeps wide chord lines scrollable.
  - Listeners are `touchstart`/`touchend` with `{ passive: true }`, attached in an effect on `ref.current`; handlers read through a ref so changing them doesn't re-attach.

- [ ] **Step 1: Write hook tests** (render a `<div>` with the hook; helper `swipe(el, fromX, toX, dy = 0)` fires `touchStart` with `touches: [{ clientX, clientY: 100 }]` and `touchEnd` with `changedTouches`):
  - `"a left swipe calls onLeft"` (300 → 200).
  - `"a right swipe calls onRight"` (100 → 200).
  - `"a short movement does nothing"` (300 → 260).
  - `"a mostly vertical drag does nothing"` (dx −80, dy 60).
  - `"a slow drag does nothing"`: `vi.spyOn(performance, "now")` 0 then 700.
  - `"does not navigate while the content can still scroll that way"`: `Object.defineProperty` `scrollWidth: 800`, `clientWidth: 300`, `scrollLeft: 100` → neither handler fires for left or right swipes.
- [ ] **Step 2: Write SongPage test** `"swiping left on the sheet opens the next song"` on `/songs/s1?gig=g1` → `getSong` called with `"sC"` and its title rendered; and `"swiping does nothing outside a gig"`.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement.** In `SongPage`: `const sheetRef = useRef<HTMLDivElement>(null)`, `const navigate = useNavigate()`, `useSwipe(sheetRef, { onLeft: next ? () => navigate(\`/songs/${next}?gig=${gigId}\`) : undefined, onRight: … prev … })`; pass `sheetRef` to `ChordSheet`. The hook must be called before the `if (!song)` early return, and must re-attach when `ref.current` appears (depend on `song !== null`).
- [ ] **Step 5: Run** `npm test && npx tsc --noEmit` → PASS.

---

### Task 5: Service-worker caching strategies (pure module)

**Files:**
- Create: `src/sw/strategy.ts`
- Test: `tests/sw/strategy.test.ts` (node environment; Node has `Request`/`Response`)

**Interfaces:**
- Produces:
  - `SHELL_CACHE = "stereo-set-shell-v1"`, `API_CACHE = "stereo-set-api-v1"`, `NETWORK_TIMEOUT_MS = 4000`, `SHELL_KEY = "/index.html"`.
  - `interface CacheLike { match(key: string): Promise<Response | undefined>; put(key: string, res: Response): Promise<void> }`
  - `type Route = "asset" | "api" | "navigate" | "pass"`
  - `routeFor(method: string, url: URL, isNavigation: boolean, origin: string): Route`
    - not `GET`, or other origin → `"pass"`
    - path starts `/assets/` → `"asset"`
    - path matches `^/api/(songs|gigs)(/[^/]+)?$` → `"api"` (so `/api/tracks*` and `/api/import` → `"pass"`)
    - else `isNavigation` → `"navigate"`, otherwise `"pass"`
  - `cacheFirst(key: string, cache: CacheLike, load: () => Promise<Response>): Promise<Response>` — return the match, else load, store a clone if `res.ok`, return it.
  - `networkFirst(key: string, cache: CacheLike, load: () => Promise<Response>, timeoutMs?: number): Promise<Response>` — algorithm:
    1. Start `load()`. When it resolves `ok`, `put(key, res.clone())`.
    2. If it resolves within `timeoutMs`, return it (even if not ok — the app shows the server's error).
    3. If it rejects, or `timeoutMs` passes first: return the cached match if there is one; otherwise keep waiting on `load()` (if that rejects, rethrow).
  - `assetUrlsFromHtml(html: string): string[]` — unique `/assets/...` paths found in `src="…"` or `href="…"`.

- [ ] **Step 1: Write tests** with a `Map`-backed fake `CacheLike`:
  - `routeFor`: `GET /api/songs` → api; `GET /api/gigs/g1` → api; `PUT /api/songs/s1` → pass; `GET /api/tracks/t1/parts/0` → pass; `GET /api/import` → pass; `GET /assets/index-abc.js` → asset; `GET /songs/s1` with navigation → navigate; `GET https://other.example/x` → pass.
  - `cacheFirst`: hit doesn't call `load`; miss stores and returns; a `500` is returned but not stored.
  - `networkFirst`: fresh `200` is returned and stored; `500` returned, not stored, old cached copy kept; `load` rejects with cache → cached body; `load` rejects with no cache → rejects; with fake timers, a `load` that never settles + cached copy → cached body after `4000` ms; slow `load` + no cache → resolves with the network body when it arrives.
  - `assetUrlsFromHtml` on `<script type="module" crossorigin src="/assets/index-a1.js"></script><link rel="stylesheet" href="/assets/index-b2.css">` → `["/assets/index-a1.js", "/assets/index-b2.css"]`.
- [ ] **Step 2: Run** `npm test -- strategy` → FAIL.
- [ ] **Step 3: Implement** `src/sw/strategy.ts`. Use only `Response`/`URL` types (DOM lib); no `ServiceWorkerGlobalScope` here.
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit` → PASS.

---

### Task 6: Service worker, manifest and build wiring

**Files:**
- Create: `src/sw/sw.ts`, `public/manifest.webmanifest`, `public/icon.svg`
- Modify: `vite.config.ts`, `index.html`, `src/app/main.tsx`, `src/app/offline.ts` (create with the register function)
- Test: `tests/app/offline.test.ts` (registration part)

**Interfaces:**
- Consumes: everything from Task 5.
- Produces: `registerServiceWorker(): void` in `src/app/offline.ts` — registers `"/sw.js"` only when `"serviceWorker" in navigator` and `import.meta.env.PROD`; swallows rejection.

- [ ] **Step 1: Write tests** for `registerServiceWorker`: calls `navigator.serviceWorker.register("/sw.js")` when present and PROD (`vi.stubEnv("PROD", true)`); does nothing without `navigator.serviceWorker`; a rejected `register` doesn't throw (unhandled rejection would fail Vitest).
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement and call it from `main.tsx` after `render`.
- [ ] **Step 4: Write `src/sw/sw.ts`.** No `webworker` lib (it clashes with DOM in one tsconfig); declare a narrow local type: `const sw = self as unknown as { addEventListener(t: string, fn: (e: any) => void): void; skipWaiting(): Promise<void>; clients: { claim(): Promise<void> } }`. Behaviour:
  - `install`: open `SHELL_CACHE`, fetch `/index.html` (`cache: "no-store"`), put it under `SHELL_KEY`, then `cache.addAll(assetUrlsFromHtml(html))`; then `skipWaiting()`. Wrap in `event.waitUntil`.
  - `activate`: delete any cache whose name starts with `stereo-set-` and isn't `SHELL_CACHE`/`API_CACHE`; `clients.claim()`.
  - `fetch`: `routeFor(req.method, new URL(req.url), req.mode === "navigate", location.origin)`; `asset` → `cacheFirst(url.pathname, shell, () => fetch(req))`; `api` → `networkFirst(url.pathname, api, () => fetch(req))`; `navigate` → `networkFirst(SHELL_KEY, shell, () => fetch(req))`; `pass` → don't call `respondWith`.
  - `sw.ts` must import only from `./strategy` so Rollup emits it as one self-contained file.
- [ ] **Step 5: Build config.** In `vite.config.ts` add:

```ts
build: {
  rollupOptions: {
    input: { main: "index.html", sw: "src/sw/sw.ts" },
    output: { entryFileNames: (c) => (c.name === "sw" ? "sw.js" : "assets/[name]-[hash].js") },
  },
},
```

- [ ] **Step 6: Manifest.** `public/manifest.webmanifest`: `name` and `short_name` `"Stereo Set"`, `start_url "/"`, `display "standalone"`, `background_color`/`theme_color` matching `--bg` in `styles.css`, `icons: [{ "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml" }]`. `icon.svg`: a plain yellow (`#ffd600`) rounded square with a dark "S". In `index.html` add `<link rel="manifest" href="/manifest.webmanifest">`, `<meta name="theme-color" content="…">`, `<link rel="icon" href="/icon.svg">`.
- [ ] **Step 7: Verify the build.** `npm run build` → succeeds; `ls dist/sw.js dist/manifest.webmanifest` both exist; `grep -c "^import\|import(" dist/sw.js` → `0` (classic worker, no imports); `dist/assets/` has no file named `sw-*`.
- [ ] **Step 8: Run** `npm test` → PASS.

---

### Task 7: "Save for offline" on a gig

Spec: "a 'Download gig for offline' button that saves every song in a setlist."

Because the worker stores every successful `GET /api/songs*`/`/api/gigs*`, saving a gig means fetching all of it while the worker controls the page.

**Files:**
- Modify: `src/app/offline.ts`, `src/app/pages/GigPage.tsx`
- Test: `tests/app/offline.test.ts`, `tests/app/GigPage.test.tsx`

**Interfaces:**
- Consumes: `api.listGigs`, `api.getGig`, `api.listSongs`, `api.getSong`.
- Produces:
  - `canSaveOffline(): boolean` — `"serviceWorker" in navigator`.
  - `saveGigForOffline(gigId: string): Promise<{ saved: number; total: number }>` — throws `new Error(NOT_READY)` when `navigator.serviceWorker.controller` is null; otherwise fetches `listGigs()`, `getGig(gigId)`, `listSongs()` (any failure here rethrows), then each setlist song that still exists via `getSong`, **one at a time** (bad signal; don't flood). `saved` counts successes.
  - `export const NOT_READY = "Offline mode is still setting up. Reload the page and try again.";`

- [ ] **Step 1: Write `offline.ts` tests**: all succeed → `{ saved: 3, total: 3 }` and `getSong` called in setlist order; one `getSong` rejects → `{ saved: 2, total: 3 }`; deleted song skipped from `total`; no controller → rejects with `NOT_READY` and no API calls.
- [ ] **Step 2: Write GigPage tests** (mock `../offline`):
  - Button `"Save for offline"` is shown when `canSaveOffline()` is true and hidden when false.
  - While running it reads `"Saving…"` and is disabled.
  - Result `{3,3}` → status text `"Saved 3 songs for offline."`; `{2,3}` → `"Saved 2 of 3 songs. Try again with better signal."`; rejection with `NOT_READY` → that message in `role="alert"`; other rejection → `"Could not save for offline."`.
  - Status uses `role="status"`.
- [ ] **Step 3: Run** → FAIL. **Step 4:** implement; put the button next to "Edit setlist", hidden while editing the setlist.
- [ ] **Step 5: Run** `npm test && npx tsc --noEmit && npm run build` → PASS.

---

### Task 8: Manual check on a real phone

Service workers need a production build over HTTPS, so this happens after the user pushes and Netlify deploys.

- [ ] Desktop Chrome on https://stereo-set.netlify.app: DevTools → Application → Service Workers shows `sw.js` activated; Manifest panel shows "Stereo Set".
- [ ] Open a gig → "Save for offline" → "Saved N songs for offline." Then DevTools → Network → Offline, reload: the gigs list, the gig, and every song in it open; a song not in the gig shows "Can't reach the server…".
- [ ] Phone: open a song, don't start autoscroll, leave it 2+ minutes → screen stays on. A− / A+ change the text and survive a reload. Swipe left/right on the sheet changes song inside a gig; a wide chord line still scrolls sideways.
- [ ] Tap Next repeatedly through a setlist → no "Loading..." flash.

---

## Self-Review Notes

- **Coverage:** wake lock → T1; offline (manifest, SW, download button) → T5–T7; font size → T2; faster changes (cache, prefetch) → T3; swipe → T4.
- **Out of scope (YAGNI):** offline mp3 tracks (up to 25 MB each; `/api/tracks*` deliberately passes through), editing while offline, PNG icons for iOS home screen, an "offline" banner.
- **Names used across tasks:** `sheetRef`/`fontSize` (T2 → T4), `clearSongCache` (T3), `SHELL_CACHE`/`API_CACHE`/`SHELL_KEY`/`routeFor`/`cacheFirst`/`networkFirst`/`assetUrlsFromHtml` (T5 → T6), `registerServiceWorker`/`canSaveOffline`/`saveGigForOffline`/`NOT_READY` (T6/T7, all in `src/app/offline.ts`).
