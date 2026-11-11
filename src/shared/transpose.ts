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

/** True for a key the app can transpose: a note name with an optional trailing "m" (e.g. "F#m", "Bb"). */
export function isValidKey(key: string): boolean {
  const m = /^([A-G][#b]?)m?$/.exec(key);
  return m !== null && noteIndex(m[1]) >= 0;
}

// Loose pattern for chords already marked with [ch] tags: any suffix is kept as-is.
// "/X" is a slash bass only when X is a note, so "6/9" stays part of the suffix.
const LOOSE_CHORD_RE = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/;

export function transposeChord(chord: string, semitones: number, useFlats: boolean): string {
  // Only a leading "(" pairs with a trailing ")", so "C7(b9)" keeps its suffix intact.
  const bracketed = chord.length > 2 && chord.startsWith("(") && chord.endsWith(")");
  const inner = bracketed ? chord.slice(1, -1) : chord;
  const m = LOOSE_CHORD_RE.exec(inner);
  if (!m) return chord;
  const [, root, suffix, bass] = m;
  if (noteIndex(root) < 0 || (bass && noteIndex(bass) < 0)) return chord;
  const newBass = bass ? "/" + shiftNote(bass, semitones, useFlats) : "";
  const out = shiftNote(root, semitones, useFlats) + suffix + newBass;
  return bracketed ? `(${out})` : out;
}
