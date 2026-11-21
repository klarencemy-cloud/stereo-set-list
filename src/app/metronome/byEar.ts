/**
 * TEST SWITCH: match the leader by ear (ADR 0001) on top of the clock-only sync (ADR 0002).
 *
 * true: a phone joining someone else's session, with its round trip measured ("Measure this phone"), listens to the
 * leader for about 2 bars, shifts its grid to what it heard, and from then on keeps that clock offset (plus drift).
 * false: it plays exactly as the clock-only build does, and nothing in the metronome asks for the mic.
 */
export const LISTEN_BY_EAR = true;
