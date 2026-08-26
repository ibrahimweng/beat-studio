import type { AudioEngine } from './audio/engine.ts';
import { renderPerSound, renderProject, renderStems, type Rendered } from './audio/render.ts';
import type { MasterReport } from './audio/master.ts';
import {
  readMine,
  readPack,
  registerPack,
  registerSounds,
  unregisterPack,
  type Pack,
  type PackSound,
} from './audio/pack.ts';
import { specForCue } from './audio/sources.ts';
import { MINE_ID } from './constants.ts';
import { loadMine, loadPacks, saveMine, savePacks } from './persist.ts';
import { encodeMp3 } from './export/mp3.ts';
import { fileStem, saveBlob } from './export/save.ts';
import { markerCsv } from './export/markers.ts';
import { patchJson } from './export/patch.ts';
import { encodeWav } from './export/wav.ts';
import {
  addLayer,
  newId,
  cueStart,
  cuesOnLayer,
  fromSession,
  makeCue,
  removeAutoPoint,
  removeCue,
  removeLayer,
  snapTime,
  toSession,
  updateCue,
  updateLayer,
  frameDuration,
} from './timeline/project.ts';
import type { AutoPoint, Cue, CueSource, Layer, Project } from './timeline/types.ts';
import { analyseMotion, filterPeaks, medianGap, pickPeaks, refinePeaks } from './video/analyse.ts';
import { VideoClock } from './video/clock.ts';
import { estimateFps, loadVideoFile } from './video/loader.ts';
import { emptyDetection, type Store } from './store.ts';

export type ExportFormat = 'wav' | 'mp3';

/**
 * The loudness every export is brought to, in LUFS.
 *
 * Sound for picture is not a finished mix. It sits under dialogue and music,
 * so it is aimed a few decibels below where a programme as a whole would be
 * delivered. What matters more than the exact number is that it is the same
 * number every time, so two pieces cut together do not need anyone reaching
 * for a fader.
 */
export const DEFAULT_TARGET_LUFS = -18;

/** How a file should be written, rather than what goes in it. */
export interface ExportSettings {
  /** Make the file exactly as long as the video. */
  trimToDuration: boolean;
  /** Hold the loudest moments back instead of letting them clip. */
  limit: boolean;
  /** Bring the file to a set loudness, or null to leave the level alone. */
  target: number | null;
}

export const DEFAULT_EXPORT: ExportSettings = {
  trimToDuration: false,
  limit: true,
  target: DEFAULT_TARGET_LUFS,
};

/** Two suggestions closer than this are treated as one moment. */
const MIN_GAP = 0.08;
/** Candidates are gathered generously, then narrowed by the sensitivity. */
const WIDE_SENSITIVITY = 0.92;
/** An upper bound, so a noisy clip cannot start thousands of seeks. */
const MAX_CANDIDATES = 160;
/** Always look back at least this many frames when pinning a moment. */
const MIN_REFINE_FRAMES = 3;
/** And never more than this, so a slow machine cannot cause a long wait. */
const MAX_REFINE_FRAMES = 12;

/** Visual feedback the timeline asks for. */
export interface SoundDesignEffects {
  /** Move the playhead to a video time. */
  onTime(time: number): void;
  /** Light a cue as it sounds. */
  flashCue(id: string): void;
}

const NO_EFFECTS: SoundDesignEffects = { onTime: () => {}, flashCue: () => {} };

/**
 * The sound design screen.
 *
 * Owns the loaded video, the cue list and the clock that ties them together.
 * The instrument half of the app is untouched by this; the two only share the
 * audio engine.
 */
export class SoundDesignSession {
  #engine: AudioEngine;
  #store: Store;
  #video: HTMLVideoElement | null = null;
  #clock: VideoClock | null = null;
  #objectUrl: string | null = null;

  effects: SoundDesignEffects = NO_EFFECTS;
  /** Called once a video is ready, so the timeline can frame the whole clip. */
  onVideoLoaded: (() => void) | null = null;

  constructor(engine: AudioEngine, store: Store) {
    this.#engine = engine;
    this.#store = store;
    this.#restorePacks();
    this.#setMine(readMine(loadMine()), false);
  }

  // ---------- sounds of your own ----------

  /**
   * Keep a sound as it is now, under a name, for good.
   *
   * A placed sound is a voice plus a length, a pitch, a level, a room and a
   * push. Getting that combination right is most of the work, and until now
   * it lived only in the one place it was placed. Saved, it becomes a sound
   * in its own right: it appears in the picker, it can be placed anywhere,
   * and it is there in the next project as well as this one.
   *
   * It is kept as a description rather than as a recording, so it is a few
   * hundred bytes and can still be tuned and stretched after the fact.
   */
  saveAsMine(cue: Cue, name: string): void {
    const clean = name.trim().slice(0, 40);
    if (!clean) return;

    // At the level it was set to, rather than the level its layer happens to
    // be at, which belongs to the project rather than to the sound.
    const spec = specForCue(cue, cue.gain);
    if (!spec) {
      this.#store.set({ status: 'that sound cannot be saved' });
      return;
    }

    const existing = this.#store.state.mine.some((sound) => sound.name === clean);
    const mine = existing
      ? this.#store.state.mine.map((sound) => (sound.name === clean ? { name: clean, spec } : sound))
      : [...this.#store.state.mine, { name: clean, spec }];

    this.#setMine(mine, true);
    this.#store.set({ status: existing ? `${clean} replaced` : `${clean} saved` });
  }

  /** Forget one. Sounds already placed from it stay where they are. */
  removeMine(name: string): void {
    this.#setMine(this.#store.state.mine.filter((sound) => sound.name !== name), true);
    this.#store.set({ status: `${name} removed` });
  }

  #setMine(mine: PackSound[], persist: boolean): void {
    registerSounds(MINE_ID, mine);
    this.#store.set({ mine });
    if (persist) saveMine(mine);
  }

  // ---------- sound packs ----------

  /**
   * Take on a pack that was loaded last time.
   *
   * Packs are kept as the files they arrived as, so what comes back is what
   * was loaded rather than anything derived from it. A file that no longer
   * reads is dropped without comment: there is nothing useful to say about it
   * at the moment the app opens.
   */
  #restorePacks(): void {
    const packs: Pack[] = [];
    for (const file of loadPacks()) {
      const pack = readPack(file, newId('p'));
      if (pack) {
        registerPack(pack);
        packs.push(pack);
      }
    }
    if (packs.length) this.#store.set({ packs });
  }

  /**
   * Read a sound pack and add everything in it to the palette.
   *
   * A pack is a small text file describing how to make its sounds, not the
   * sounds themselves, so nothing is fetched or decoded and it works with no
   * network at all. Loading one whose name is already here replaces it,
   * because two packs of the same name are almost always the same pack.
   */
  async loadPack(file: File): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      this.#store.set({ status: `${file.name} is not a sound pack` });
      return;
    }
    this.#addPack(parsed, `${file.name} is not a sound pack`);
  }

  #addPack(parsed: unknown, complaint: string): Pack | null {
    const pack = readPack(parsed, newId('p'));
    if (!pack) {
      this.#store.set({ status: complaint });
      return null;
    }

    const existing = this.#store.state.packs.find((p) => p.name === pack.name);
    if (existing) unregisterPack(existing.id);
    registerPack(pack);

    const packs = existing
      ? this.#store.state.packs.map((p) => (p.id === existing.id ? pack : p))
      : [...this.#store.state.packs, pack];

    this.#store.set({ packs, status: this.#packStatus(pack, existing !== undefined) });
    savePacks(packs.map((p) => p.file));
    return pack;
  }

  #packStatus(pack: Pack, replaced: boolean): string {
    const count = `${pack.sounds.length} sound${pack.sounds.length === 1 ? '' : 's'}`;
    const left = pack.skipped.length ? `, ${pack.skipped.length} left out` : '';
    return `${pack.name}: ${count}${left}${replaced ? ', replacing the one before' : ''}`;
  }

  /** Take a pack back out of the palette. Sounds already placed stay put. */
  removePack(id: string): void {
    const pack = this.#store.state.packs.find((p) => p.id === id);
    if (!pack) return;
    unregisterPack(id);
    const packs = this.#store.state.packs.filter((p) => p.id !== id);
    this.#store.set({ packs, status: `${pack.name} removed` });
    savePacks(packs.map((p) => p.file));
  }

  /** Read-only access for views that redraw outside a state change. */
  get store(): Store {
    return this.#store;
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
    // Anything found for the previous clip no longer applies.
    this.#store.set({ detect: emptyDetection() });
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

  /**
   * Work out the frame rate from the file.
   *
   * Frames have to go past to be measured, so the clip runs for a moment and
   * then returns to the start. It is silenced while that happens, and then
   * put back to whatever it was, because whether the video's own sound is
   * being heard is a choice the person made and not this method's to change.
   */
  async #measureFps(): Promise<void> {
    const video = this.#video;
    if (!video) return;
    const wasMuted = video.muted;
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
    } finally {
      video.muted = wasMuted;
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
    else {
      this.#wake();
      void this.#clock.play();
    }
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

  /**
   * Choose a sound and hear it.
   *
   * Picking from a list of three hundred names without hearing any of them is
   * guesswork, and the way round it was to place one, listen, undo, and try
   * again. Choosing now plays the sound at the settings it would arrive with,
   * so the list can be worked through by ear.
   */
  chooseSource(source: CueSource): void {
    this.setSource(source);
    this.preview(source);
  }

  /** Hear a sound as it would arrive, without putting it anywhere. */
  preview(source: CueSource): void {
    this.audition(makeCue(0, this.#store.state.activeLayerId, source));
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

  /**
   * Set a layer's level over time.
   *
   * Given whole rather than a point at a time, because drawing one is a
   * continuous movement and the interface has the finished shape by the time
   * the pointer comes up.
   */
  setAuto(id: string, auto: AutoPoint[]): void {
    this.updateLayer(id, { auto });
  }

  removeAutoPoint(id: string, index: number): void {
    this.#setProject(removeAutoPoint(this.project, id, index));
  }

  /** Add a layer and make it the one new sounds go on. */
  addLayer(): void {
    const next = addLayer(this.project);
    const added = next.layers[next.layers.length - 1];
    this.#setProject(next);
    this.#store.set({ activeLayerId: added.id, status: `${added.name} added` });
  }

  renameLayer(id: string, name: string): void {
    const clean = name.trim();
    if (!clean) return;
    this.updateLayer(id, { name: clean.slice(0, 40) });
  }

  /** How many sounds a layer holds, so the interface can warn before removing. */
  countOnLayer(id: string): number {
    return cuesOnLayer(this.project, id);
  }

  /** Remove a layer and everything on it. The last layer is kept. */
  removeLayer(id: string): void {
    const project = this.project;
    if (project.layers.length <= 1) {
      this.#store.set({ status: 'there has to be at least one layer' });
      return;
    }
    const layer = project.layers.find((l) => l.id === id);
    const lost = cuesOnLayer(project, id);
    const next = removeLayer(project, id);
    this.#setProject(next);

    const active = this.#store.state.activeLayerId === id ? next.layers[0].id : this.#store.state.activeLayerId;
    this.#store.set({
      activeLayerId: active,
      selectedCueId: null,
      status: lost
        ? `${layer?.name ?? 'layer'} removed with ${lost} sound${lost === 1 ? '' : 's'}`
        : `${layer?.name ?? 'layer'} removed`,
    });
  }

  /**
   * Start the audio engine, and say so.
   *
   * The engine starts itself the first time anything asks it to make a sound,
   * but the light on the rail is driven by the app's own idea of whether it
   * is on, which only the instrument half was setting. So the sound design
   * screen could be playing while the light said it was off.
   */
  #wake(): void {
    this.#engine.start();
    if (!this.#store.state.ready) this.#store.set({ ready: true });
  }

  /** Hear one cue on its own. */
  audition(cue: Cue): void {
    this.#wake();
    this.#clock?.audition(cue);
  }

  /** Play from a little before a cue, so it is heard in context. */
  previewInContext(cue: Cue, lead = 1): void {
    this.seek(Math.max(0, cueStart(cue) - lead));
    void this.#clock?.play();
  }

  // ---------- finding hits ----------

  /**
   * Read the video and suggest where sounds belong.
   *
   * Two passes. The first plays the clip quickly and measures how much the
   * picture changes, which finds roughly where things happen. The second
   * steps through each of those moments one frame at a time to pin it to the
   * frame the change actually landed on, because near enough is not much use
   * when the whole job is landing on the frame.
   */
  async findHits(): Promise<void> {
    const url = this.#objectUrl;
    if (!url) {
      this.#store.set({ status: 'load a video first' });
      return;
    }
    if (this.#store.state.detect.status !== 'idle' && this.#store.state.detect.status !== 'ready') {
      return;
    }

    this.pause();
    const project = this.project;
    const frame = frameDuration(project);
    this.#store.set({
      detect: { ...emptyDetection(), status: 'scanning', sensitivity: this.#store.state.detect.sensitivity },
      status: 'reading the video…',
    });

    let samples;
    try {
      samples = await analyseMotion(url, {
        fps: project.fps,
        onProgress: (fraction) => this.#progress('scanning', fraction),
      });
    } catch (error) {
      this.#store.set({
        detect: emptyDetection(),
        status: error instanceof Error ? error.message : 'could not read the video',
      });
      return;
    }

    if (!samples.length) {
      this.#store.set({ detect: emptyDetection(), status: 'nothing found in that video' });
      return;
    }

    // Cast wide here. Narrowing afterwards costs nothing, but a moment that
    // was never a candidate can never be recovered without reading again.
    const wide = pickPeaks(samples, WIDE_SENSITIVITY, MIN_GAP).slice(0, MAX_CANDIDATES);
    this.#store.set({ detect: { ...this.#store.state.detect, status: 'pinning', progress: 0 } });

    // Look back over the gap the fast pass actually left, since that is the
    // window the change could have happened in.
    const window = Math.max(
      MIN_REFINE_FRAMES,
      Math.min(MAX_REFINE_FRAMES, Math.ceil(medianGap(samples) / frame) + 1),
    );

    let candidates;
    try {
      candidates = await refinePeaks(url, wide, frame, window, (fraction) =>
        this.#progress('pinning', fraction),
      );
    } catch {
      candidates = wide;
    }

    const sensitivity = this.#store.state.detect.sensitivity;
    const peaks = filterPeaks(candidates, samples, sensitivity, MIN_GAP);
    this.#store.set({
      detect: { status: 'ready', progress: 1, samples, candidates, peaks, sensitivity },
      status: `${peaks.length} hits found`,
    });
  }

  #progress(status: 'scanning' | 'pinning', progress: number): void {
    const detect = this.#store.state.detect;
    if (detect.status !== status) return;
    this.#store.set({ detect: { ...detect, progress } });
  }

  /** Show more or fewer of what was already found. Does not read the video. */
  setSensitivity(sensitivity: number): void {
    const detect = this.#store.state.detect;
    const value = Math.max(0, Math.min(1, sensitivity));
    if (detect.status !== 'ready') {
      this.#store.set({ detect: { ...detect, sensitivity: value } });
      return;
    }
    const peaks = filterPeaks(detect.candidates, detect.samples, value, MIN_GAP);
    this.#store.set({ detect: { ...detect, sensitivity: value, peaks } });
  }

  /** Put the current sound on every suggested moment. */
  placeAllHits(): void {
    const { peaks } = this.#store.state.detect;
    if (!peaks.length) return;
    const state = this.#store.state;
    const cues = peaks.map((peak) =>
      makeCue(snapTime(this.project, this.#insideVideo(peak.t)), state.activeLayerId, state.currentSource),
    );
    this.#setProject({ ...this.project, cues: [...this.project.cues, ...cues] });
    this.#store.set({ status: `${cues.length} sounds placed` });
  }

  /** Put the current sound on one suggested moment. */
  placeHit(time: number): void {
    this.addCue(time);
  }

  clearHits(): void {
    this.#store.set({ detect: emptyDetection(), status: 'suggestions cleared' });
  }

  // ---------- export ----------

  /** One mixed file. */
  async exportAudio(format: ExportFormat, settings: ExportSettings = DEFAULT_EXPORT): Promise<void> {
    await this.#writeAll(format, settings, 'rendering…', (options) =>
      renderProject(this.project, options),
    );
  }

  /** One file per layer, all the same length and all starting at zero. */
  async exportStems(format: ExportFormat, settings: ExportSettings = DEFAULT_EXPORT): Promise<void> {
    await this.#writeAll(format, settings, 'rendering layers…', (options) =>
      renderStems(this.project, options),
    );
  }

  /** One file per sound, wherever that sound appears on the timeline. */
  async exportPerSound(
    format: ExportFormat,
    settings: ExportSettings = DEFAULT_EXPORT,
  ): Promise<void> {
    await this.#writeAll(format, settings, 'rendering sounds…', (options) =>
      renderPerSound(this.project, options),
    );
  }

  /** A list of where every sound lands, for whoever picks the work up next. */
  exportMarkers(): void {
    if (!this.project.cues.length) {
      this.#store.set({ status: 'place some sounds first' });
      return;
    }
    const blob = new Blob([markerCsv(this.project)], { type: 'text/csv' });
    saveBlob(blob, `${this.#stem()}-markers.csv`);
    this.#store.set({ status: 'marker list exported' });
  }

  /** The file name everything an export writes is built from. */
  #stem(): string {
    return fileStem(this.project.videoName?.replace(/\.[^.]+$/, '') || 'sound-design');
  }

  async #writeAll(
    format: ExportFormat,
    settings: ExportSettings,
    working: string,
    render: (options: {
      settings: ReturnType<AudioEngine['chainSettings']>;
      trimToDuration: boolean;
      master: { limit: boolean; target: number | null };
    }) => Promise<Rendered>,
  ): Promise<void> {
    if (!this.project.cues.length) {
      this.#store.set({ status: 'place some sounds first' });
      return;
    }
    this.pause();
    this.#store.set({ exporting: working });

    const rendered = await render({
      settings: this.#engine.chainSettings(),
      trimToDuration: settings.trimToDuration,
      master: { limit: settings.limit, target: settings.target },
    });

    const base = this.#stem();
    for (let i = 0; i < rendered.parts.length; i++) {
      const part = rendered.parts[i];
      if (rendered.parts.length > 1) {
        this.#store.set({ exporting: `writing ${i + 1} of ${rendered.parts.length}…` });
      }
      const name = part.id === 'mix' ? base : `${base}-${fileStem(part.name)}`;
      await this.#write(part.buffer, name, format);
    }

    this.#store.set({ exporting: null, status: this.#said(rendered, format) });
  }

  /**
   * What the export did, in a line.
   *
   * Worth saying rather than leaving to be discovered: if a piece was held
   * back from clipping, or lifted several decibels to reach the target, that
   * is something to know before the file goes anywhere.
   */
  #said(rendered: Rendered, format: ExportFormat): string {
    const count = rendered.parts.length;
    const what = count === 1 ? `${format.toUpperCase()} exported` : `${count} files exported`;
    const report: MasterReport | null = rendered.report;
    if (!report || !Number.isFinite(report.before)) return what;

    const parts = [what, `${report.after.toFixed(1)} LUFS`];
    if (Math.abs(report.gainDb) >= 0.1) {
      parts.push(`${report.gainDb > 0 ? '+' : ''}${report.gainDb.toFixed(1)} dB`);
    }
    if (report.reductionDb >= 0.1) {
      parts.push(`held back ${report.reductionDb.toFixed(1)} dB`);
    } else if (report.wouldHaveClipped) {
      parts.push('would have clipped');
    }
    return parts.join(' · ');
  }

  async #write(buffer: AudioBuffer, name: string, format: ExportFormat): Promise<void> {
    if (format === 'wav') {
      saveBlob(encodeWav(buffer), `${name}.wav`);
      return;
    }
    const mp3 = await encodeMp3(buffer);
    if (mp3) saveBlob(mp3, `${name}.mp3`);
    else {
      saveBlob(encodeWav(buffer), `${name}.wav`);
      this.#store.set({ status: 'MP3 encoder offline — saved WAV' });
    }
  }

  // ---------- the palette as a patch ----------

  /**
   * Write the palette out as a patch file.
   *
   * The sounds in Beat Studio have only ever existed inside Beat Studio. A
   * patch is the `@web-kits/audio` unit of exchange: commit the file to a
   * repository and anyone can install the whole palette with
   * `npx @web-kits/audio add <owner>/<repo>`, play it in their own page, or
   * read it to see how any of these sounds is put together.
   */
  exportPatch(): void {
    const blob = new Blob([patchJson()], { type: 'application/json' });
    saveBlob(blob, 'beat-studio.patch.json');
    this.#store.set({ status: 'palette written as a patch' });
  }

  // ---------- session file ----------

  saveSession(): void {
    // The packs and any sounds of your own go in too, so the file opens
    // complete somewhere else rather than with silent gaps on the timeline.
    const packs = this.#store.state.packs.map((pack) => pack.file);
    const blob = new Blob([JSON.stringify(toSession(this.project, packs, this.#store.state.mine), null, 2)], {
      type: 'application/json',
    });
    const base = fileStem(this.project.videoName?.replace(/\.[^.]+$/, '') || 'sound-design');
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
    const read = fromSession(parsed);
    if (!read) {
      this.#store.set({ status: 'that file is not a session' });
      return;
    }
    const { project } = read;

    // Packs first, so the sounds on the timeline have something to play with
    // by the time anything looks at them.
    for (const file of read.packs) this.#addPack(file, 'a pack in that session could not be read');

    // Sounds of your own are merged rather than replaced, since the ones
    // already here belong to you and not to the file being opened.
    const arriving = readMine(read.mine).filter(
      (sound) => !this.#store.state.mine.some((held) => held.name === sound.name),
    );
    if (arriving.length) this.#setMine([...this.#store.state.mine, ...arriving], true);
    // The video itself is not stored, so keep whichever one is loaded.
    const current = this.project;
    this.#setProject({
      ...project,
      duration: current.duration || project.duration,
      videoName: current.videoName ?? project.videoName,
    });
    // The layer sounds were being placed on may not exist in the file that
    // was just opened. Left pointing at a layer that is gone, everything
    // dropped at the playhead would land somewhere nothing draws or plays.
    const active = this.#store.state.activeLayerId;
    this.#store.set({
      activeLayerId: project.layers.some((l) => l.id === active) ? active : project.layers[0].id,
      selectedCueId: null,
      status: `session loaded, ${project.cues.length} sounds`,
    });
  }

  dispose(): void {
    this.#clock?.pause();
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
  }
}
