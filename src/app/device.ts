/** A random id for this phone, made once and kept, so a synced metronome can tell which phone leads it. */
export const DEVICE_KEY = "stereo-set:device-id";

/** Kept for this page's life when storage is blocked, so the id at least stays the same until a reload. */
let fallback: string | null = null;

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Not a secure context: use the fallback below.
  }
  let id = "";
  for (let i = 0; i < 4; i++) id += Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, "0");
  return id;
}

export function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved && saved.length <= 64) return saved;
    const id = randomId();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return (fallback ??= randomId());
  }
}
