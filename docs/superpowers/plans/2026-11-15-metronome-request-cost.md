# Metronome request cost: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the server requests the song metronome makes. An open panel that isn't playing along should check about every 10 s instead of every 1.5 s, and a phone with its screen off should make no requests at all.

**Architecture:** Three independent changes:
- the session check goes from a fixed 1.5 s interval to a self-scheduling timer that is fast only while this phone is joined, and pauses while the page is hidden;
- the clock check repeats every 60 s instead of every 10 s, and also pauses while hidden;
- the server reads one storage key per check instead of two.

**Tech Stack:** React 18 hooks, Vitest (fake timers, `renderHook`), Netlify Functions with `memoryKV()` in tests.

**Spec:** `docs/superpowers/specs/2026-11-15-synced-metronome-design.md`, plus the decisions below. They were agreed in conversation on 2026-11-15 and aren't in the spec yet; Task 4 writes them in.

## Decisions (what this plan implements)

| | Today | After |
|---|---|---|
| Session check, panel open, this phone **not joined** | every 1.5 s | every **10 s** |
| Session check, this phone **joined** (playing, or waiting for a restart) | every 1.5 s | every **1.5 s** (unchanged) |
| Session check, screen off / app in background | throttled, unpredictable | **none**; one check **immediately** when the page is visible again |
| Session check right after tapping **Join** | next interval | **immediately** |
| Clock check while joined | 10 at join, then 3 every **10 s** | 10 at join, then 3 every **60 s** |
| Clock check while hidden | throttled | **none**; a round of 3 **immediately** when visible again |
| Storage reads per session check (server) | 2 (song, then session) | **1** when a session exists; 2 only when there is none |
| A running session nobody has changed (start, stop, tempo) reads as stopped after | 6 h | **2 h** |

Expected effect per phone: an idle open panel goes from ~2,400 to ~360 requests/hour; a joined phone from ~3,500 to ~2,580.

**Not in this plan** (raised, not agreed):
- a longer change lead (4 s run-up) to allow 3 s checks while joined;
- CDN caching of the session answer.

## Global Constraints

- No commits, pushes or merges unless the user asks (project rule). Where a task would commit, stop with the changes left in the working tree.
- The service worker keeps passing `/api/time` and `/api/metronome/*` straight to the network. Don't touch `src/sw/`.
- The clicks must keep playing while the screen is off: they come from the looped bar in `useSyncedMetronome`/`useMetronome` (`startClickLoop`). This plan only changes *requests*, never the loop logic.
- Node 22+, `npm test` (Vitest), `npm run build` (`tsc --noEmit && vite build`).
- Follow CLAUDE.md, including: validation stays in `repo.ts`, and reproduce a claim with a test before fixing.

## Review Focus

1. **A joined phone waiting while the session is stopped** must still check every 1.5 s. Otherwise a bandmate's restart (2 s lead) would reach it up to 10 s late. Test in Task 2: "joined with the session stopped still checks every 1.5 s".
2. **Hidden → visible → hidden in quick succession** must not leave two check chains running, which would double the requests. Test in Task 2: "toggling visibility doesn't start a second chain".
3. **Unmounting while a check is in flight or scheduled** (panel closed, next song) must stop all further checks. Test in Task 2: "no checks after the panel closes".
4. **A check that fails while joined** (network blip) keeps the fast rate and keeps playing the known grid; it doesn't fall back to 10 s. Test in Task 2: "a failed check while joined keeps checking every 1.5 s".
5. **The clock sync's first round fails** (offline). The panel still switches to "Can't sync: playing on this phone only" as before. Covered by the existing test "plays on this phone only when the clock can't be synced"; it must still pass after Task 3.

---

### Task 1: One storage read per session check, and the 2-hour stale limit

**Files:**
- Modify: `netlify/functions/lib/repo.ts:434-438` (`getMetronome`)
- Test: `tests/server/metronome.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `repo.getMetronome(songId: string, nowMs: number): Promise<MetroSession | null>`. Same signature and behaviour; it throws `NotFoundError("song not found")` for an unknown song.

- [ ] **Step 1: Write the failing test** in `tests/server/metronome.test.ts`, in `describe("metronome API")`:

```ts
it("reads only the session when there is one", async () => {
  const kv = memoryKV();
  const reads: string[] = [];
  const counted = { ...kv, getText: async (k: string) => (reads.push(k), kv.getText(k)) };
  const repo = makeRepo(counted);
  const song = await repo.createSong(songBody);
  await repo.setMetronome(song.id, { bpm: 120, beatsPerBar: 4, running: true }, 1_000_000);
  reads.length = 0;
  expect(await repo.getMetronome(song.id, 1_000_500)).toMatchObject({ bpm: 120 });
  expect(reads).toEqual([`metronome/${song.id}`]);
});

it("still says 404 for an unknown song and null for a song with no session", async () => {
  const { repo, id } = await setup();
  await expect(repo.getMetronome("nope", 1)).rejects.toThrow(NotFoundError);
  expect(await repo.getMetronome(id, 1)).toBeNull();
});
```

Add `NotFoundError` to the import from `../../netlify/functions/lib/repo`.

- [ ] **Step 2: Run it and watch it fail.**
Run: `npx vitest run tests/server/metronome.test.ts -t "reads only the session"`
Expected: FAIL. `reads` is `["songs/<id>", "metronome/<id>"]`.

- [ ] **Step 3: Change `getMetronome`.** Read `metronome/<songId>` first. If there's a record, return it through `toMetroSession`. Only when there is none, check `songs/<songId>` and throw `NotFoundError("song not found")` if it's missing. A session record implies the song exists: `deleteSongAndTrack` deletes `metronome/<songId>` together with the song.

- [ ] **Step 4: Run the server tests.**
Run: `npx vitest run tests/server`
Expected: all pass, including every existing `metronome API` test.

- [ ] **Step 5: Write the failing stale-limit test** in `tests/server/metronome.test.ts`, next to the existing stale test. Rename that test from "…for 6 hours…" to "reads a running session nobody touched for METRO_STALE_MS as stopped". Then add:

```ts
it("treats a session nobody changed for 2 hours as stopped", async () => {
  const { metro, clock, id } = await setup();
  await metro(req("PUT", `/api/metronome/${id}`, { bpm: 120, beatsPerBar: 4, running: true }));
  clock.now += 2 * 60 * 60 * 1000 - 1;
  expect((await (await metro(req("GET", `/api/metronome/${id}`))).json()).running).toBe(true);
  clock.now += 2;
  expect((await (await metro(req("GET", `/api/metronome/${id}`))).json()).running).toBe(false);
});

it("restarts the 2 hours on every change", async () => {
  const { metro, clock, id } = await setup();
  await metro(req("PUT", `/api/metronome/${id}`, { bpm: 120, beatsPerBar: 4, running: true }));
  clock.now += 90 * 60 * 1000;
  await metro(req("PUT", `/api/metronome/${id}`, { bpm: 100 }));
  clock.now += 90 * 60 * 1000;
  expect((await (await metro(req("GET", `/api/metronome/${id}`))).json()).running).toBe(true);
});
```

- [ ] **Step 6: Run it and watch it fail.**
Run: `npx vitest run tests/server/metronome.test.ts -t "2 hours"`
Expected: FAIL for "nobody changed for 2 hours" (still `running: true` at 2 h + 1 ms). "Restarts the 2 hours" may already pass.

- [ ] **Step 7: Set `METRO_STALE_MS = 2 * 60 * 60 * 1000`** in `netlify/functions/lib/repo.ts`, and change its comment from 6 hours to 2 hours.

- [ ] **Step 8: Run the server tests.**
Run: `npx vitest run tests/server`
Expected: all pass.

---

### Task 2: Session checks fast only while joined, none while hidden

**Files:**
- Modify: `src/app/metronome/useSyncedMetronome.ts` (the "Check the session while the panel is open" effect, `POLL_MS`, `join`)
- Test: `tests/app/SongMetronome.test.tsx` (new `describe("session checks")`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export const POLL_JOINED_MS = 1500` and `export const POLL_IDLE_MS = 10_000` from `useSyncedMetronome.ts`. These replace `POLL_MS`; nothing else imports it.
  - The hook's return value is unchanged.

- [ ] **Step 1: Write the failing tests** as a new `describe("session checks")` in `tests/app/SongMetronome.test.tsx`:
  - Use fake timers: `vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] })`.
  - `calls()` counts `mocked.getMetronome` calls.
  - `advance(ms)` wraps `act(async () => { await vi.advanceTimersByTimeAsync(ms); })`.
  - `setHidden(b)` sets `document.visibilityState` and dispatches `visibilitychange`, as in the existing "keeps playing while the screen is off" test. Remove the property in `afterEach`.

```ts
it("checks every 10 s while the panel is open but this phone isn't joined", async () => {
  mocked.getMetronome.mockResolvedValue(running());
  renderPanel();
  await advance(0);
  expect(calls()).toBe(1);           // on open
  await advance(9_000);
  expect(calls()).toBe(1);           // not every 1.5 s any more
  await advance(1_000);
  expect(calls()).toBe(2);
});

it("checks at once on Join, then every 1.5 s", async () => {
  mocked.getMetronome.mockResolvedValue(running());
  renderPanel();
  await advance(0);
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await advance(0);
  expect(calls()).toBe(2);
  await advance(1_500);
  expect(calls()).toBe(3);
});

it("joined with the session stopped still checks every 1.5 s", async () => {
  // Start for everyone joins this phone; the server answers with a session that someone then stops.
  mocked.putMetronome.mockResolvedValue(running());
  mocked.getMetronome.mockResolvedValue(null);
  renderPanel();
  await advance(0);
  fireEvent.click(screen.getByRole("button", { name: "Start for everyone" }));
  await advance(0);
  mocked.getMetronome.mockResolvedValue(running({ running: false, updatedAt: "2026-11-15T10:00:09.000Z" }));
  const before = calls();
  await advance(3_000);
  expect(calls() - before).toBe(2);
});

it("makes no checks while the screen is off, and one as soon as it is back", async () => {
  renderPanel();
  await advance(0);
  setHidden(true);
  const before = calls();
  await advance(60_000);
  expect(calls()).toBe(before);
  setHidden(false);
  await advance(0);
  expect(calls()).toBe(before + 1);
});

it("toggling visibility doesn't start a second chain", async () => {
  mocked.getMetronome.mockResolvedValue(running());
  renderPanel();
  await advance(0);
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await advance(0);
  setHidden(true); setHidden(false); setHidden(true); setHidden(false);
  await advance(0);
  const before = calls();
  await advance(3_000);
  expect(calls() - before).toBe(2);   // still one check per 1.5 s
});

it("a failed check while joined keeps checking every 1.5 s", async () => {
  mocked.getMetronome.mockResolvedValue(running());
  renderPanel();
  await advance(0);
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await advance(0);
  mocked.getMetronome.mockRejectedValue(new ApiError(0, "offline"));
  const before = calls();
  await advance(3_000);
  expect(calls() - before).toBe(2);
});

it("no checks after the panel closes", async () => {
  const { unmount } = renderPanel();
  await advance(0);
  unmount();
  const before = calls();
  await advance(30_000);
  expect(calls()).toBe(before);
});
```

- [ ] **Step 2: Run them and watch them fail.**
Run: `npx vitest run tests/app/SongMetronome.test.tsx -t "session checks"`
Expected:
- FAIL: "checks every 10 s…" (calls every 1.5 s), "checks at once on Join…" (no immediate check), "makes no checks while the screen is off…" (calls continue under fake timers).
- The others may already pass. Note which ones.

- [ ] **Step 3: Replace the fixed `setInterval` with a self-scheduling check in `useSyncedMetronome.ts`.**
  - After each `load()` settles, schedule the next with `setTimeout`. The delay is `POLL_JOINED_MS` when `joinedRef.current` is true, else `POLL_IDLE_MS`. A `joinedRef` mirrors `joined`, so the chain reads the current value without restarting.
  - Keep a single `timer` and a `generation` counter in the effect. Every (re)start clears the pending timer and bumps the generation; a `load()` that finishes for an older generation schedules nothing. This makes the "no second chain" and "no checks after close" tests hold.
  - While `document.visibilityState === "hidden"`: schedule nothing.
  - On `visibilitychange` to visible: restart the chain with an immediate `load()`. Merge this listener with the existing one that resumes the `AudioContext`.
  - Expose the restart from the effect through a `checkNowRef`. `join()` calls `checkNowRef.current?.()` after `setJoined(true)`.

- [ ] **Step 4: Run the panel tests.**
Run: `npx vitest run tests/app/SongMetronome.test.tsx`
Expected: all pass. That includes the existing "playing" tests, which advance 1.6 s while joined and rely on the 1.5 s rate.

---

### Task 3: Clock checks every 60 s, none while hidden

**Files:**
- Modify: `src/app/metronome/useClockSync.ts` (`ROUND_EVERY_MS`, the round scheduling)
- Create: `tests/app/useClockSync.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `useClockSync(active: boolean): ClockSync`. Unchanged signature. `export const ROUND_EVERY_MS = 60_000`.

- [ ] **Step 1: Write the failing tests** in `tests/app/useClockSync.test.ts`.
  - Mock `../../src/app/api` the way `SongMetronome.test.tsx` does, with `getTime: vi.fn(async () => ({ now: 1000 }))`.
  - Use `renderHook(() => useClockSync(true))` and the same fake-timer and `setHidden` helpers as Task 2.

```ts
it("takes 10 samples at the start, then 3 every 60 s", async () => {
  renderHook(() => useClockSync(true));
  await advance(0);
  expect(getTime).toHaveBeenCalledTimes(10);
  await advance(59_000);
  expect(getTime).toHaveBeenCalledTimes(10);
  await advance(1_000);
  expect(getTime).toHaveBeenCalledTimes(13);
});

it("takes no samples while hidden, and a round of 3 as soon as it is visible", async () => {
  renderHook(() => useClockSync(true));
  await advance(0);
  setHidden(true);
  await advance(180_000);
  expect(getTime).toHaveBeenCalledTimes(10);
  setHidden(false);
  await advance(0);
  expect(getTime).toHaveBeenCalledTimes(13);
});

it("keeps its estimate across hidden time", async () => {
  const { result } = renderHook(() => useClockSync(true));
  await advance(0);
  setHidden(true);
  await advance(120_000);
  expect(result.current.status).toBe("synced");
});

it("stops sampling when no longer active", async () => {
  const { rerender } = renderHook(({ on }) => useClockSync(on), { initialProps: { on: true } });
  await advance(0);
  rerender({ on: false });
  await advance(120_000);
  expect(getTime).toHaveBeenCalledTimes(10);
});
```

- [ ] **Step 2: Run them and watch them fail.**
Run: `npx vitest run tests/app/useClockSync.test.ts`
Expected: FAIL for "3 every 60 s" (13 calls at 10 s) and "no samples while hidden".

- [ ] **Step 3: Change `useClockSync.ts`.**
  - `ROUND_EVERY_MS = 60_000`, exported.
  - When a round finishes while the page is hidden, schedule nothing.
  - Add a `visibilitychange` listener inside the existing effect. On visible: clear any pending timer and run a round of `LATER_ROUND` (or `FIRST_ROUND` if there is no estimate yet). Remove the listener in the cleanup.
  - The status stays `"synced"` while hidden.

- [ ] **Step 4: Run the clock and panel tests.**
Run: `npx vitest run tests/app/useClockSync.test.ts tests/app/SongMetronome.test.tsx`
Expected: all pass, including "plays on this phone only when the clock can't be synced" (Review Focus 5).

---

### Task 4: Docs and full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-11-15-synced-metronome-design.md` (lines 37 and 41)
- Modify: `CHANGELOG.md` (the "Metronome for the whole band" entry)

- [ ] **Step 1: Update the spec.**
  - Line 37: followers check every 1.5 s **while joined**, every 10 s while the panel is open but not joined, and not at all while the page is hidden (once immediately on return and on Join).
  - Line 41: 3 samples every **60 s**, none while hidden, a round of 3 on return.
  - Add the server's one-read rule under "API".
  - Change every "6 h" to "2 h" (the "Stale sessions" bullet). Also search `docs/superpowers/ideas/2026-11-14-feature-ideas.md` and `docs/superpowers/plans/2026-11-15-synced-metronome.md` for "6 h"; update `synced-metronome.md` and leave the handoff plan as written.

- [ ] **Step 2: Add one sentence to the CHANGELOG entry:** "An open metronome that you haven't joined checks for changes only every 10 seconds, and a phone with its screen off doesn't check at all, so it uses far less data."

- [ ] **Step 3: Run the full suite and the build.**
Run: `npm test` then `npm run build`
Expected: all tests pass (699 before this plan, plus the new ones). The build exits 0, with `dist/sw.js` still emitted as its own file.

- [ ] **Step 4: Check the request rate by hand.** Restart `npm run dev`, open a song and its Metronome panel without joining, and watch the terminal:
  - about one `GET /api/metronome/…` every 10 s;
  - after Join, one every 1.5 s plus a burst of 10 `GET /api/time`, then 3 a minute;
  - switching to another tab stops both until you come back.
