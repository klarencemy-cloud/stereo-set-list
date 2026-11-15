import { describe, expect, it } from "vitest";
import { LOCK_HOLD_MS, LOCK_OFF, nextLock } from "../../src/app/tuner/lock";
import type { LockState } from "../../src/app/tuner/lock";

/** Runs readings (cents, all on midi 45 unless given) 50 ms apart and returns each state. */
function run(readings: (number | { cents: number; midi: number } | null)[], from: LockState = LOCK_OFF, t0 = 0) {
  const states: LockState[] = [];
  let s = from;
  readings.forEach((r, i) => {
    const reading = r === null ? null : typeof r === "number" ? { cents: r, midi: 45 } : r;
    s = nextLock(s, reading, t0 + i * 50);
    states.push(s);
  });
  return states;
}

/** A state that is already locked on midi 45. */
function locked(): LockState {
  const s = run(Array(25).fill(0)).at(-1)!;
  expect(s.phase).toBe("locked");
  return s;
}

describe("nextLock", () => {
  it("is off with no reading, or more than 5 cents out", () => {
    expect(nextLock(LOCK_OFF, null, 0).phase).toBe("off");
    expect(nextLock(LOCK_OFF, { cents: 8, midi: 45 }, 0)).toMatchObject({ phase: "off", progress: 0 });
    expect(nextLock(LOCK_OFF, { cents: -5.01, midi: 45 }, 0).phase).toBe("off");
  });

  it("is near within 5 cents but past 3", () => {
    expect(nextLock(LOCK_OFF, { cents: 5, midi: 45 }, 0)).toMatchObject({ phase: "near", progress: 0 });
    expect(nextLock(LOCK_OFF, { cents: -4, midi: 45 }, 0).phase).toBe("near");
    expect(nextLock(LOCK_OFF, { cents: 3.01, midi: 45 }, 0).phase).toBe("near");
  });

  it("holds within 3 cents either way, inclusive", () => {
    expect(nextLock(LOCK_OFF, { cents: 3, midi: 45 }, 0).phase).toBe("holding");
    expect(nextLock(LOCK_OFF, { cents: -3, midi: 45 }, 0).phase).toBe("holding");
  });

  it("locks only after 1000 ms continuously within 3 cents, with progress going 0 to 1", () => {
    const states = run(Array(22).fill(2.5)); // t = 0 .. 1050
    expect(states[0]).toMatchObject({ phase: "holding", progress: 0 });
    expect(states[10]).toMatchObject({ phase: "holding", progress: 0.5 }); // t = 500
    expect(states[19].phase).toBe("holding"); // t = 950
    expect(states[19].progress).toBeCloseTo(0.95, 6);
    expect(states[20]).toMatchObject({ phase: "locked", progress: 1 }); // t = 1000
    for (let i = 1; i < states.length; i++) expect(states[i].progress).toBeGreaterThanOrEqual(states[i - 1].progress);
    expect(LOCK_HOLD_MS).toBe(1000);
  });

  it("starts the hold again if the pitch leaves the 3-cent band before 1000 ms", () => {
    // Within 3 from 0 to 550 ms, 4 at 600 ms, then back within 3.
    const states = run([...Array(12).fill(-2), 4, ...Array(21).fill(-2)]);
    expect(states[12]).toMatchObject({ phase: "near", progress: 0 });
    expect(states[13]).toMatchObject({ phase: "holding", progress: 0 }); // t = 650: from scratch
    expect(states[13 + 19].phase).toBe("holding"); // t = 1600: only 950 ms of the new hold
    expect(states[13 + 20].phase).toBe("locked"); // t = 1650
  });

  it("stays locked up to 4 cents and unlocks past it", () => {
    const states = run([3.5, -3.8, 4, 2, 4.1], locked(), 2000);
    expect(states.slice(0, 4).map((s) => s.phase)).toEqual(["locked", "locked", "locked", "locked"]);
    expect(states[4]).toMatchObject({ phase: "near", progress: 0 });
  });

  it("after unlocking, needs a fresh 1000 ms hold", () => {
    const states = run([6, 0.1, 0.1], locked(), 2000);
    expect(states.map((s) => s.phase)).toEqual(["off", "holding", "holding"]);
    expect(states[1].progress).toBe(0);
  });

  it("unlocks when the note changes or the sound stops", () => {
    expect(nextLock(locked(), { cents: 0, midi: 46 }, 2000)).toMatchObject({ phase: "holding", progress: 0 });
    expect(nextLock(locked(), null, 2000)).toMatchObject({ phase: "off", progress: 0 });
  });

  it("a note change also restarts a hold in progress", () => {
    const states = run([...Array(15).fill(0), { cents: 0, midi: 47 }]);
    expect(states[14].progress).toBeCloseTo(0.7, 6);
    expect(states[15]).toMatchObject({ phase: "holding", progress: 0 });
  });
});
