import { preferPlaybackAudio } from "../audio";

// Records the microphone on an AudioContext's own clock, so a heard click can be compared with when that context
// plays (or would play) one. Used by "Measure this phone" and by a joining phone matching the band by ear.

export interface Recording {
  /** Mono samples at ctx.sampleRate. */
  samples: Float32Array;
  /** Audio time (ctx.currentTime, s) of samples[0]. */
  startS: number;
}

export interface ListenOptions {
  /** Abort to stop early: the promise rejects with an AbortError and the microphone is released. */
  signal?: AbortSignal;
  /** Called once, when the first samples arrive: `seconds` are counted from then. */
  onStart?: () => void;
}

const PROCESSOR = "stereo-set-recorder";
/**
 * The recorder worklet. It posts blocks of samples with the context frame of their first sample (`currentFrame`),
 * so the recording's start is exact on the context's clock. Inline (a Blob URL), so the build needs no extra entry.
 */
const WORKLET_SOURCE = `
class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.live = true;
    this.buf = new Float32Array(2048);
    this.n = 0;
    this.at = 0;
    this.port.onmessage = () => { this.live = false; };
  }
  flush() {
    if (!this.n) return;
    const samples = this.buf.slice(0, this.n);
    this.port.postMessage({ frame: this.at, samples }, [samples.buffer]);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && this.live) {
      if (this.n && (currentFrame !== this.at + this.n || this.n + ch.length > this.buf.length)) this.flush();
      if (!this.n) this.at = currentFrame;
      this.buf.set(ch, this.n);
      this.n += ch.length;
    }
    if (!this.live) this.flush();
    return this.live;
  }
}
registerProcessor(${JSON.stringify(PROCESSOR)}, Recorder);
`;

/** The worklet module, loaded once per context. */
const modules = new WeakMap<BaseAudioContext, Promise<void>>();

function loadWorklet(ctx: AudioContext): Promise<void> {
  let p = modules.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    p = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    // A failed load can be tried again next time.
    p.catch(() => modules.delete(ctx));
    modules.set(ctx, p);
  }
  return p;
}

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

/** On iPhone, the mic needs a play-and-record audio session (Safari 16.4+). Elsewhere this does nothing. */
function preferRecordAudio(): void {
  const nav = navigator as AudioSessionNav;
  try {
    if (nav.audioSession) nav.audioSession.type = "play-and-record";
  } catch {
    // Older Safari: getUserMedia switches it anyway.
  }
}

const abortError = () => new DOMException("Listening was stopped", "AbortError");

/**
 * Records `seconds` of the microphone, with voice processing off (as the tuner does), on `ctx`'s clock. Prefers an
 * AudioWorklet (sample-exact start); falls back to a ScriptProcessor, whose start is only known to a buffer or so,
 * but by a fixed amount, which the measured round trip absorbs since it is recorded the same way. Always stops
 * the microphone and disconnects its nodes, also on error.
 */
export async function listen(ctx: AudioContext, seconds: number, opts: ListenOptions = {}): Promise<Recording> {
  const { signal, onStart } = opts;
  if (signal?.aborted) throw abortError();
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("This browser can't use the microphone here", "NotSupportedError");
  }
  let stream: MediaStream | null = null;
  const nodes: AudioNode[] = [];
  let worklet: AudioWorkletNode | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  preferRecordAudio();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (signal?.aborted) throw abortError();
    const sr = ctx.sampleRate;
    const total = Math.max(1, Math.round(seconds * sr));
    const out = new Float32Array(total);
    let first: number | null = null;

    const source = ctx.createMediaStreamSource(stream);
    nodes.push(source);
    // Recorders must be pulled by the destination to run; this keeps them silent.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    nodes.push(sink);

    let useWorklet = !!ctx.audioWorklet && typeof AudioWorkletNode !== "undefined";
    if (useWorklet) {
      try {
        await loadWorklet(ctx);
      } catch {
        useWorklet = false;
      }
      if (signal?.aborted) throw abortError();
    }

    return await new Promise<Recording>((resolve, reject) => {
      let done = false;
      const finish = (err: unknown, rec?: Recording) => {
        if (done) return;
        done = true;
        if (rec) resolve(rec);
        else reject(err);
      };
      /** Places a block that starts at context frame `frame`. */
      const push = (frame: number, data: Float32Array) => {
        if (done) return;
        if (first === null) {
          first = frame;
          try {
            onStart?.();
          } catch (e) {
            finish(e);
            return;
          }
        }
        const at = frame - first;
        if (at < 0) return;
        if (at < total) out.set(data.subarray(0, Math.min(data.length, total - at)), at);
        if (at + data.length >= total) finish(null, { samples: out, startS: first / sr });
      };
      onAbort = () => finish(abortError());
      signal?.addEventListener("abort", onAbort, { once: true });
      // The microphone never delivered: don't wait forever.
      timer = setTimeout(() => finish(new DOMException("The microphone sent no sound", "NotReadableError")), (seconds + 3) * 1000);

      if (useWorklet) {
        worklet = new AudioWorkletNode(ctx, PROCESSOR, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: "explicit",
        });
        worklet.port.onmessage = (e: MessageEvent<{ frame: number; samples: Float32Array }>) => push(e.data.frame, e.data.samples);
        source.connect(worklet);
        worklet.connect(sink);
        nodes.push(worklet);
      } else {
        const size = 2048;
        const proc = ctx.createScriptProcessor(size, 1, 1);
        proc.onaudioprocess = (e) => {
          // The block's start, estimated from when its output plays: a fixed bias, absorbed by the round trip.
          const frame = Math.round(e.playbackTime * sr) - size;
          push(frame, new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        source.connect(proc);
        proc.connect(sink);
        nodes.push(proc);
      }
    });
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    try {
      (worklet as AudioWorkletNode | null)?.port.postMessage("stop");
    } catch {
      // Already closed.
    }
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    stream?.getTracks().forEach((t) => t.stop());
    preferPlaybackAudio();
  }
}
