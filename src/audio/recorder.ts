import type { NoteEvent, Take } from '../types.ts';
import type { AudioEngine } from './engine.ts';

/** Number of bars drawn in a take's waveform strip. */
const WAVE_BARS = 96;
/** Every third sample is enough to find a peak for a 96-bar overview. */
const PEAK_STRIDE = 3;

/** Container types to try, best first. An empty string means browser default. */
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', ''];

export type TakeListener = (take: Take) => void;

/**
 * Captures the master bus to a take.
 *
 * Audio is recorded through MediaRecorder while played notes are logged
 * separately as MIDI events, so a single take can be exported either as sound
 * (WAV/MP3) or as notes (MIDI).
 */
export class Recorder {
  #engine: AudioEngine;
  #recorder: MediaRecorder | null = null;
  #chunks: Blob[] = [];
  #events: NoteEvent[] = [];
  #startedAt: number | null = null;
  #sequence = 0;
  #recording = false;

  /** Called once a stopped recording has been decoded and measured. */
  onTake: TakeListener | null = null;
  /** Called when a take is dropped or capture fails, with a reason to show. */
  onProblem: ((message: string) => void) | null = null;

  constructor(engine: AudioEngine) {
    this.#engine = engine;
  }

  get recording(): boolean {
    return this.#recording;
  }

  /** Seconds captured so far, or 0 when idle. */
  get elapsed(): number {
    if (this.#startedAt === null) return 0;
    return Math.max(0, this.#engine.now() - this.#startedAt);
  }

  /**
   * Begin capturing. Returns false when the browser has no usable recorder, in
   * which case nothing has been started and the caller should stay idle.
   */
  start(bpm: number): boolean {
    this.#engine.start();
    this.#events = [];
    this.#chunks = [];

    const mimeType = MIME_TYPES.find(
      (t) => !t || (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)),
    );

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this.#engine.stream, mimeType ? { mimeType } : undefined);
    } catch {
      this.onProblem?.('recording unsupported in this browser');
      return false;
    }

    this.#recorder = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) this.#chunks.push(e.data);
    };
    recorder.onstop = () => {
      const type = this.#chunks[0]?.type ?? 'audio/webm';
      void this.#land(new Blob(this.#chunks, { type }), bpm);
    };

    this.#startedAt = this.#engine.now();
    this.#recording = true;
    // A short timeslice keeps chunks flowing so a stop lands promptly.
    recorder.start(120);
    return true;
  }

  stop(): void {
    this.#recording = false;
    if (this.#recorder && this.#recorder.state !== 'inactive') this.#recorder.stop();
  }

  /** Record a played note. Ignored unless a capture is running. */
  log(midi: number, t: number, dur: number, vel: number, ch = 0): void {
    if (!this.#recording || this.#startedAt === null) return;
    this.#events.push({ midi, t: Math.max(0, t - this.#startedAt), dur, vel, ch });
  }

  async #land(blob: Blob, bpm: number): Promise<void> {
    this.#startedAt = null;
    if (!blob.size) {
      this.onProblem?.('empty take discarded');
      return;
    }

    const buffer = await this.#engine.decode(blob);
    const dur = buffer ? buffer.duration : 0;
    const bars = buffer ? peaks(buffer) : [];

    this.#sequence++;
    const events = this.#events.slice();
    const take: Take = {
      id: `t${Date.now().toString(36)}-${this.#sequence}`,
      name: `Take ${String(this.#sequence).padStart(2, '0')}`,
      dur,
      blob,
      buffer,
      bars,
      layered: false,
      events,
      bpm,
      meta: `${dur.toFixed(1)}s · ${bpm} bpm · ${events.length} notes`,
    };
    this.onTake?.(take);
  }
}

/**
 * Reduce a buffer to {@link WAVE_BARS} normalised peaks, 3..100, for drawing.
 * Normalising against the loudest bar means a quiet take still reads clearly.
 */
function peaks(buffer: AudioBuffer): number[] {
  const data = buffer.getChannelData(0);
  const chunk = Math.floor(data.length / WAVE_BARS) || 1;
  const found: number[] = [];
  let max = 0.0001;

  for (let i = 0; i < WAVE_BARS; i++) {
    let peak = 0;
    const end = Math.min((i + 1) * chunk, data.length);
    for (let j = i * chunk; j < end; j += PEAK_STRIDE) {
      const a = Math.abs(data[j]);
      if (a > peak) peak = a;
    }
    found.push(peak);
    if (peak > max) max = peak;
  }

  return found.map((p) => Math.max(3, Math.round((p / max) * 100)));
}
