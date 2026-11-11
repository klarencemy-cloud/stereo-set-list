export const KEYS: string[] = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const FLAT_MAJOR = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb"]);
const FLAT_MINOR = new Set(["Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"]);

// Suffix is an allow-list of chord-quality parts so ordinary words are not chords.
const CHORD_RE =
  /^(\(?)([A-G][#b]?)((?:maj|min|dim|aug|sus|add|m|M|\+|\u00b0|\u00f8|b|#|-|\d+)*)(?:\/([A-G][#b]?))?(\)?)$/;

function noteIndex(note: string): number {
  const i = SHARP_NAMES.indexOf(note);
  return i >= 0 ? i : FLAT_NAMES.indexOf(note);
}

function rootOf(key: string): string {
  const m = /^([A-G][#b]?)/.exec(key);
  if (!m || noteIndex(m[1]) < 0) throw new Error(`Unknown key: ${key}`);
  return m[1];
}

export function semitonesBetween(fromKey: string, toKey: string): number {
  return (noteIndex(rootOf(toKey)) - noteIndex(rootOf(fromKey)) + 12) % 12;
}

export function prefersFlats(key: string): boolean {
  const root = rootOf(key);
  return key.endsWith("m") ? FLAT_MINOR.has(root + "m") : FLAT_MAJOR.has(root);
}

export function transposeKey(key: string, semitones: number): string {
  const minor = key.endsWith("m") ? "m" : "";
  const idx = (((noteIndex(rootOf(key)) + semitones) % 12) + 12) % 12;
  // F#/Gb is spelled F# to match KEYS.
  const flats = idx !== 6 && prefersFlats(FLAT_NAMES[idx] + minor);
  return (flats ? FLAT_NAMES[idx] : SHARP_NAMES[idx]) + minor;
}

function shiftNote(note: string, semitones: number, useFlats: boolean): string {
  const idx = (((noteIndex(note) + semitones) % 12) + 12) % 12;
  return (useFlats ? FLAT_NAMES : SHARP_NAMES)[idx];
}

export function isChord(token: string): boolean {
  return CHORD_RE.test(token);
}

export function transposeChord(chord: string, semitones: number, useFlats: boolean): string {
  const m = CHORD_RE.exec(chord);
  if (!m) return chord;
  const [, open, root, suffix, bass, close] = m;
  const newBass = bass ? "/" + shiftNote(bass, semitones, useFlats) : "";
  return open + shiftNote(root, semitones, useFlats) + suffix + newBass + close;
}
