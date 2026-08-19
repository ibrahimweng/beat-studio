import type { AudioEngine } from './audio/engine.ts';
import { renderProject, renderStems } from './audio/render.ts';
import { encodeMp3 } from './export/mp3.ts';
import { fileStem, saveBlob } from './export/save.ts';
import { encodeWav } from './export/wav.ts';
import {
  cueStart,
  fromSession,
  makeCue,
  removeCue,
  snapTime,
  toSession,
  updateCue,
  updateLayer,
  frameDuration,
} from './timeline/project.ts';
import type { Cue, CueSource, Layer, Project } from './timeline/types.ts';
import { VideoClock } from './video/clock.ts';
import { estimateFps, loadVideoFile } from './video/loader.ts';
import type { Store } from './store.ts';

export type ExportFormat = 'wav' | 'mp3';

/** Visual feedback the timeline asks for. */
export interface ScoreEffects {
  /** Move the playhead to a video time. */
  onTime(time: number): void;
  /** Light a cue as it sounds. */
  flashCue(id: string): void;
}

const NO_EFFECTS: ScoreEffects = { onTime: () => {}, flashCue: () => {} };

/**
 * Scoring to picture.
 *
 * Owns the loaded video, the cue list and the clock that ties them together.
 * The instrument half of the app is untouched by this; the two only share the
 * audio engine.
 */
export class ScoreSession {
  #engine: AudioEngine;
  #store: Store;
  #video: HTMLVideoElement | null = null;
  #clock: VideoClock | null = null;
  #objectUrl: string | null = null;

  effects: ScoreEffects = NO_EFFECTS;
  /** Called once a video is ready, so the timeline can frame the whole clip. */
  onVideoLoaded: (() => void) | null = null;

  constructor(engine: AudioEngine, store: Store) {
    this.#engine = engine;
    this.#store = store;
  }

  get project(): Project {
    return this.#store.state.project;
  }

  get playing(): boolean {
    return this.#clock?.playing ?? false;
  }

  get time(): number {
    return this.#clock?.time ?? 0;
  }

  #setProject(project: Project): void {
    this.#store.set({ project });
  }

  /** Give the session the video element the interface created. */
  attachVideo(video: HTMLVideoElement): void {
    this.#video = video;
    this.#clock = new VideoClock(video, this.#engine, {
      project: () => this.project,
      onTime: (t) => this.effects.onTime(t),
      onCue: (cue, at) => {
        // Light the cue when it actually sounds, not when it was queued.
        const delay = Math.max(0, (at - this.#engine.now()) * 1000);
        window.setTimeout(() => this.effects.flashCue(cue.id), delay);
      },
    });
  }

  // ---------- video ----------

  async loadVideo(file: File): Promise<void> {
    const video = this.#video;
    if (!video) return;

    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#store.set({ status: `loading ${file.name}…` });

    let loaded;
    try {
      loaded = await loadVideoFile(video, file);
    } catch (error) {
      this.#store.set({ status: error instanceof Error ? error.message : 'could not load video' });
      return;
    }

    this.#objectUrl = loaded.url;
    this.#setProject({
      ...this.project,
      duration: loaded.duration,
      videoName: loaded.name,
    });
    this.#store.set({ videoReady: true, status: `${loaded.name} loaded` });
    this.onVideoLoaded?.();

    // Measuring the frame rate needs frames to go past, so it runs during a
    // short muted play and then returns to the start.
    void this.#measureFps();
  }

  async #measureFps(): Promise<void> {
    const video = this.#video;
    if (!video) return;
    try {
      video.muted = true;
      await video.play();
      const fps = await estimateFps(video);
      video.pause();
      video.currentTime = 0;
      this.#setProject({ ...this.project, fps });
      this.effects.onTime(0);
    } catch {
      // Leave the default rate in place; it can be set by hand.
    }
  }

  setFps(fps: number): void {
    if (!Number.isFinite(fps) || fps <= 0) return;
    this.#setProject({ ...this.project, fps });
  }

  setSnap(snap: Project['snap']): void {
    this.#setProject({ ...this.project, snap });
  }

  setBpm(bpm: number): void {
    this.#setProject({ ...this.project, bpm: Math.max(20, Math.min(300, bpm)) });
  }

  /** Whether the video's own audio is heard. It is never exported. */
  setReferenceAudio(on: boolean): void {
    if (this.#video) this.#video.muted = !on;
  }

  get referenceAudio(): boolean {
    return this.#video ? !this.#video.muted : false;
  }

  // ---------- transport ----------

  togglePlay(): void {
    if (!this.#clock) return;
    if (this.#clock.playing) this.#clock.pause();
    else void this.#clock.play();
  }

  pause(): void {
    this.#clock?.pause();
  }

  seek(time: number): void {
    this.#clock?.seek(time);
  }

  /** Move by a number of frames, for landing a hit exactly. */
  stepFrames(frames: number): void {
    if (!this.#clock) return;
    this.#clock.seek(this.#clock.time + frames * frameDuration(this.project));
  }

  // ---------- cues ----------

  setSource(source: CueSource): void {
    this.#store.set({ currentSource: source });
  }

  setActiveLayer(layerId: string): void {
    this.#store.set({ activeLayerId: layerId });
  }

  select(id: string | null): void {
    this.#store.set({ selectedCueId: id });
  }

  toggleArmed(): void {
    this.#store.set({ armed: !this.#store.state.armed });
  }

  /**
   * Place the current sound at a time, snapped, and select it.
   *
   * The time is held inside the video, because a lane is drawn wider than the
   * clip whenever the clip is shorter than the window, and a sound dropped
   * past the end would never be seen or heard.
   */
  addCue(time: number, source?: CueSource, layerId?: string): Cue {
    const state = this.#store.state;
    const cue = makeCue(
      snapTime(this.project, this.#insideVideo(time)),
      layerId ?? state.activeLayerId,
      source ?? state.currentSource,
    );
    this.#store.set({
      project: { ...this.project, cues: [...this.project.cues, cue] },
      selectedCueId: cue.id,
    });
    this.audition(cue);
    return cue;
  }

  /** Place a cue at the playhead. Used when playing an instrument while armed. */
  addCueAtPlayhead(source: CueSource): void {
    this.addCue(this.time, source);
  }

  updateCue(id: string, patch: Partial<Cue>): void {
    const bounded =
      patch.time === undefined ? patch : { ...patch, time: this.#insideVideo(patch.time) };
    this.#setProject(updateCue(this.project, id, bounded));
  }

  /** Clamp a time to the loaded video. */
  #insideVideo(time: number): number {
    const end = this.project.duration;
    const t = Math.max(0, time);
    return end > 0 ? Math.min(t, end) : t;
  }

  /** Move a cue by whole frames. */
  nudgeCue(id: string, frames: number): void {
    const cue = this.project.cues.find((c) => c.id === id);
    if (!cue) return;
    const next = Math.max(0, cue.time + frames * frameDuration(this.project));
    this.updateCue(id, { time: next });
  }

  removeCue(id: string): void {
    this.#setProject(removeCue(this.project, id));
    if (this.#store.state.selectedCueId === id) this.#store.set({ selectedCueId: null });
  }

  updateLayer(id: string, patch: Partial<Layer>): void {
    this.#setProject(updateLayer(this.project, id, patch));
  }

  /** Hear one cue on its own. */
  audition(cue: Cue): void {
    this.#clock?.audition(cue);
  }

  /** Play from a little before a cue, so it is heard in context. */
  previewInContext(cue: Cue, lead = 1): void {
    this.seek(Math.max(0, cueStart(cue) - lead));
    void this.#clock?.play();
  }

  // ---------- export ----------

  async exportAudio(format: ExportFormat, trimToDuration = false): Promise<void> {
    if (!this.project.cues.length) {
      this.#store.set({ status: 'place some sounds first' });
      return;
    }
    this.pause();
    this.#store.set({ exporting: 'rendering…' });

    const settings = this.#engine.chainSettings();
    const buffer = await renderProject(this.project, { settings, trimToDuration });
    const stem = fileStem(this.project.videoName?.replace(/\.[^.]+$/, '') || 'score');
    await this.#write(buffer, stem, format);
    this.#store.set({ exporting: null });
  }

  /** One file per layer, all the same length and all starting at zero. */
  async exportStems(format: ExportFormat, trimToDuration = false): Promise<void> {
    if (!this.project.cues.length) {
      this.#store.set({ status: 'place some sounds first' });
      return;
    }
    this.pause();
    this.#store.set({ exporting: 'rendering layers…' });

    const settings = this.#engine.chainSettings();
    const stems = await renderStems(this.project, { settings, trimToDuration });
    const base = fileStem(this.project.videoName?.replace(/\.[^.]+$/, '') || 'score');

    for (let i = 0; i < stems.length; i++) {
      const s = stems[i];
      this.#store.set({ exporting: `writing ${i + 1} of ${stems.length}…` });
      await this.#write(s.buffer, `${base}-${fileStem(s.layerName)}`, format);
    }

    this.#store.set({ exporting: null, status: `${stems.length} layers exported` });
  }

  async #write(buffer: AudioBuffer, name: string, format: ExportFormat): Promise<void> {
    if (format === 'wav') {
      saveBlob(encodeWav(buffer), `${name}.wav`);
      this.#store.set({ status: `${name}.wav exported` });
      return;
    }
    const mp3 = await encodeMp3(buffer);
    if (mp3) {
      saveBlob(mp3, `${name}.mp3`);
      this.#store.set({ status: `${name}.mp3 exported` });
    } else {
      saveBlob(encodeWav(buffer), `${name}.wav`);
      this.#store.set({ status: 'MP3 encoder offline — saved WAV' });
    }
  }

  // ---------- session file ----------

  saveSession(): void {
    const blob = new Blob([JSON.stringify(toSession(this.project), null, 2)], {
      type: 'application/json',
    });
    const base = fileStem(this.project.videoName?.replace(/\.[^.]+$/, '') || 'score');
    saveBlob(blob, `${base}.beatstudio.json`);
    this.#store.set({ status: 'session saved' });
  }

  async openSession(file: File): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      this.#store.set({ status: 'that file is not a session' });
      return;
    }
    const project = fromSession(parsed);
    if (!project) {
      this.#store.set({ status: 'that file is not a session' });
      return;
    }
    // The video itself is not stored, so keep whichever one is loaded.
    const current = this.project;
    this.#setProject({
      ...project,
      duration: current.duration || project.duration,
      videoName: current.videoName ?? project.videoName,
    });
    this.#store.set({
      selectedCueId: null,
      status: `session loaded, ${project.cues.length} sounds`,
    });
  }

  dispose(): void {
    this.#clock?.pause();
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
  }
}
