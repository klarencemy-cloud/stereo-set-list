// Small Web Audio helpers shared by the tuner and the metronome.

type AudioContextCtor = typeof AudioContext;

/** A new AudioContext, or null when the browser has none. Call it from a user tap so audio is allowed to start. */
export function createAudioContext(): AudioContext | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/**
 * On iPhone, Web Audio is muted by the silent switch unless the page says it plays media (Safari 16.4+).
 * Elsewhere this does nothing.
 */
export function preferPlaybackAudio(): void {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    // Older Safari: the switch may mute the clicks; the visual beat still works.
  }
}
