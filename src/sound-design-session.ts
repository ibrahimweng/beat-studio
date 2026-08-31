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
import { specForCue, usesSample } from './audio/sources.ts';
import { MINE_ID } from './constants.ts';
import { forgetWork, keepSamples, keepVideo } from './keep.ts';
import {
  addSample,
  creditFromName,
  creditLine,
  decodeSample,
  forgetSample,
  sampleById,
  samples,
  setSamples,
  type Credit,
  type Sample,
  tagsFromPath,
} from './audio/samples.ts';
import { looksLikeZip, readZip } from './audio/zip.ts';
import { readTable, stemOf, type Described } from './audio/sidecar.ts';
import { alreadyStocked, markStocked, SHELVES, STOCK_TOTAL } from './audio/stock.ts';
import { creditFor, fetchSound, FreesoundError, search, type Found } from './audio/freesound.ts';
import { loadMine, loadPacks, saveMine, savePacks } from './persist.ts';
import { encodeMp3 } from './export/mp3.ts';
import { fileStem, saveBlob } from './export/save.ts';
import { markerCsv } from './export/markers.ts';
import { density } from './timeline/project.ts';
import { layerJob } from './timeline/types.ts';
import { cueNotes, encodeProjectMidi } from './export/timeline-midi.ts';
import { patchJson } from './export/patch.ts';
import { encodeWav } from './export/wav.ts';
import {
  addLayer,
  emptyProject,
  newId,
  cueLength,
  cueStart,
  cuesOnLayer,
  dressCue,
  fromSession,
  makeCue,
  MAX_LENGTH,
  MIN_LENGTH,
  removeAutoPoint,
  removeCue,
  removeLayer,
  snapTime,
  toSession,
  updateCue,
  updateLayer,
  frameDuration,
  timecode,
} from './timeline/project.ts';
import type {
  AutoPoint,
  Cue,
  CuePreset,
  CueSource,
  LaneName,
  Layer,
  Project,
} from './timeline/types.ts';
import { analyseMotion, filterPeaks, medianGap, pickPeaks, refinePeaks } from './video/analyse.ts';
import { readMoments } from './video/moments.ts';
import type { Moment } from './video/moments.ts';
import { suggestFor } from './audio/suggest.ts';
import type { Suggested } from './audio/suggest.ts';
import { VideoClock } from './video/clock.ts';
import { estimateFps, loadVideoFile } from './video/loader.ts';
import { listen } from './audio/listen.ts';

/**
 * How many decoded buffers an import holds on to.
 *
 * A two second stereo buffer at 48 kHz is 768 kB. Past this the audio is
 * decoded again when something asks for it, which is what everything restored
 * from a previous visit already does.
 */
const KEEP_DECODED = 32;

/** Past this many files an import says how far along it is. */
const PROGRESS_FROM = 40;

/**
 * One recording on its way into the library, whatever it arrived as.
 *
 * The one shape both importers hand to {@link SoundDesignSession.take}, so a
 * file off a disk and a sound off Freesound stop differing the moment their
 * bytes are in hand.
 */
interface TakeEntry {
  /** Where it came from, for reporting and for naming when nothing better exists. */
  path: string;
  blob: Blob;
  /** What to call it. */
  name: string;
  credit?: Credit;
  tags?: readonly string[];
  /** The id to file it under, when the caller needs to know it in advance. */
  id?: string;
}

/** What is worth pulling out of an archive. */
const AUDIO_FILE = /\.(wav|wave|mp3|m4a|aac|ogg|oga|opus|flac|aif|aiff|webm)$/i;

/** A table that might say what the files in an archive actually are. */
const TABLE_FILE = /\.(csv|tsv)$/i;

import { rebuild, type Made } from './audio/rebuild.ts';
import { emptyDetection, type MomentState, type PanelTab, type Store, type TimeRange } from './store.ts';

export type ExportFormat = 'wav' | 'mp3';

/** How often a held fast forward or rewind moves the playhead. */
const SHUTTLE_MS = 1000 / 30;

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
/**
 * The shortest a piece may be set to.
 *
 * A second, because below that the ruler has no room for a single label and
 * the whole timeline collapses to a sliver you cannot then click on to make
 * it longer again. There is nothing wrong with a half second piece; there is
 * something wrong with a window you cannot get back out of.
 */
const MIN_DURATION = 1;

const MIN_GAP = 0.08;
/** Candidates are gathered generously, then narrowed by the sensitivity. */
const WIDE_SENSITIVITY = 0.92;
/** An upper bound, so a noisy clip cannot start thousands of seeks. */
const MAX_CANDIDATES = 160;

/**
 * How many sounds a second is too many, and how few is too few to say so.
 *
 * Two a second is the point the plan this came from names: a sound every half
 * second is worse than four good ones. The floor is there because the rate on
 * a nearly empty piece is arithmetic on nothing — three sounds in the first
 * second of a clip nobody has finished is not a problem worth a line about.
 */
const CROWDED_RATE = 2;
const CROWDED_LEAST = 24;
/** How much busier it has to get before the line is worth repeating. */
const CROWDED_AGAIN = 1;
/** Always look back at least this many frames when pinning a moment. */
const MIN_REFINE_FRAMES = 3;
/** And never more than this, so a slow machine cannot cause a long wait. */
const MAX_REFINE_FRAMES = 12;

/**
 * How long a run of small changes still counts as one thing you did.
 *
 * Long enough to cover the pauses inside a drag, short enough that two
 * deliberate moves of the same sound are two steps rather than one.
 */
const COALESCE_MS = 700;

/** How far back it is possible to go. Projects share their parts, so this is cheap. */
const MAX_HISTORY = 200;

/** One point in the history: what the project was, and what changed it. */
interface Step {
  project: Project;
  label: string;
  at: number;
}

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
  /** Running while fast forward or rewind is held. */
  #shuttling: ReturnType<typeof setInterval> | null = null;
  /** Where the playhead was when play was last pressed, for stop. */
  #playedFrom: number | null = null;
  #objectUrl: string | null = null;

  /** What was copied, waiting to be put somewhere. */
  #clipboard: Cue[] = [];
  /** What the project was, most recent last. */
  #past: Step[] = [];
  /** And what it was before it was undone. */
  #future: Step[] = [];

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

  // ---------- recordings ----------

  /**
   * Take on recordings somebody dropped in.
   *
   * Built for an archive rather than for a handful. Someone assembling a real
   * palette arrives with a Freesound pack or a folder off the BBC archive —
   * hundreds of files, nested in folders, quite possibly still zipped — and an
   * importer that takes one file at a time turns that into an afternoon.
   *
   * So: zips are opened, folders keep their shape as tags, the Freesound
   * naming convention is read for who to credit, progress is reported because
   * four hundred files is long enough to look broken, and anything that is not
   * audio is named and skipped rather than stopping the rest.
   */
  async addSamples(files: readonly File[]): Promise<void> {
    if (!files.length) return;
    this.#wake();

    const { audio: found, tables } = await this.#unpack(files);
    if (!found.length) {
      this.#store.set({ status: 'nothing in there could be read' });
      return;
    }

    /*
     * What the archive's own spreadsheet says these are.
     *
     * A library that names its files by catalogue number keeps the meaning in
     * a table beside them — the BBC archive is thirty three thousand files
     * called things like `07076051.wav` — and imported without it you get a
     * library that cannot be searched. See `audio/sidecar.ts`.
     */
    const described = new Map<string, Described>();
    if (tables.length) {
      const stems = new Set(found.map((entry) => stemOf(entry.path)));
      for (const table of tables) {
        for (const [stem, about] of readTable(table, stems)) described.set(stem, about);
      }
      if (described.size) {
        this.#store.set({ status: `${described.size} named from the archive's own list…` });
      }
    }

    const entries: TakeEntry[] = found.map((entry) => {
      const { name, credit } = creditFromName(entry.path);
      const about = described.get(stemOf(entry.path));
      const tags = tagsFromPath(entry.path);
      // What the archive itself calls it beats what its filename does: a
      // catalogue number is a name only in the sense that it is unique.
      if (about?.category) tags.push(about.category);
      return {
        path: entry.path,
        blob: entry.blob,
        name: about?.description || name,
        ...(credit ? { credit } : {}),
        tags,
      };
    });

    const added = await this.#take(entries);
    const failed = found.length - added;
    const taken = new Set(
      entries.map((e) => e.credit?.author).filter((a): a is string => Boolean(a)),
    );

    this.#keepSamples();
    this.#store.set({
      samples: [...samples()],
      status: added
        ? `${added} recording${added === 1 ? '' : 's'} added` +
          (failed > 0 ? `, ${failed} could not be read` : '') +
          (taken.size ? ` · ${taken.size} author(s) to credit` : '')
        : 'nothing could be read',
    });
  }

  /**
   * Sounds fetched to be heard, not yet asked for.
   *
   * Clicking a Freesound result plays it and arms it, which means it has to
   * be in the sample store — a placed sound names a recording by id, so
   * nothing can be armed that is not there. But somebody working through
   * twenty results wanted to hear twenty sounds, not to acquire twenty, and
   * a library that fills up with everything you ever clicked is a library
   * you have to tidy.
   *
   * So they go in, and their ids go here. What is in here is left out of what
   * gets written down, and cleared when the search moves on. Placing one
   * takes it off this list, which is the moment it stops being something you
   * were listening to and becomes something you are using.
   */
  #onLoan = new Set<string>();

  /**
   * Hear a Freesound result now, and arm it.
   *
   * The same gesture as clicking anything else in the palette, which is what
   * it should have been from the start: search, Keep, wait, scroll to the
   * recordings, click it, place it was five steps to hear one sound, against
   * one for a sound this app makes.
   *
   * The preview starts through an audio element the instant it is asked for,
   * so there is sound while the file is still arriving. The download and the
   * arming happen behind that.
   */
  async tryFreesound(sound: Found): Promise<void> {
    this.#wake();
    const already = samples().find((s) => s.credit?.url === sound.url);
    if (already) {
      this.chooseSource({ kind: 'sample', name: already.id });
      return;
    }

    this.#store.set({ status: `fetching ${sound.name}…` });
    try {
      const file = await fetchSound(sound);
      const id = newId('s');
      const took = await this.#take([
        {
          path: file.name,
          blob: file,
          name: sound.name,
          credit: creditFor(sound),
          tags: ['preview', ...sound.tags.slice(0, 6).map((t) => t.toLowerCase())],
          id,
        },
      ]);
      if (!took) {
        this.#store.set({ status: `could not read ${sound.name}` });
        return;
      }
      this.#onLoan.add(id);
      this.#store.set({ samples: [...samples()] });
      // Armed and played, exactly as a palette sound is when it is clicked.
      this.chooseSource({ kind: 'sample', name: id });
    } catch (error) {
      this.#store.set({
        status: error instanceof Error ? error.message : `could not fetch ${sound.name}`,
      });
    }
  }

  /**
   * Fill the shelves, once, behind whatever is going on.
   *
   * A first visit arrives to an empty recordings list, and the two ways to
   * fix that — drop a folder in, or search and click — are both a job to do
   * before any work starts. This does it instead: sixty CC0 recordings across
   * the categories this kind of work reaches for, fetched in the background.
   *
   * Everything about it is deliberately unassertive. It does not run for
   * anybody who already has recordings, it does not run twice, it never
   * blocks, it says what it is doing in the status line and nowhere else, and
   * a deployment with no key simply skips it. If it fails halfway, what
   * arrived stays and it does not try again. See `audio/stock.ts`.
   */
  async stockLibrary(): Promise<void> {
    if (alreadyStocked() || samples().length) return;
    markStocked('done');

    let got = 0;
    for (const shelf of SHELVES) {
      let page;
      try {
        page = await search(shelf.find, { licence: 'Creative Commons 0' });
      } catch (error) {
        /*
         * A deployment with no key is the ordinary case, not a failure, and
         * the app is complete without any of this — so it goes quiet rather
         * than reporting something nobody asked for.
         */
        if (error instanceof FreesoundError && error.fault.kind === 'off') return;
        continue;
      }

      for (const sound of page.sounds.slice(0, shelf.take)) {
        try {
          const file = await fetchSound(sound);
          const took = await this.#take([
            {
              path: file.name,
              blob: file,
              name: sound.name,
              credit: creditFor(sound),
              // The shelf it came off, so the library arrives already filed.
              tags: [shelf.of, 'preview', ...sound.tags.slice(0, 4).map((t) => t.toLowerCase())],
            },
          ]);
          if (!took) continue;
        } catch {
          continue;
        }
        got++;
        // Written down as it goes, so a tab closed halfway keeps what arrived.
        this.#keepSamples();
        this.#store.set({
          samples: [...samples()],
          status: `filling the shelves · ${got} of ${STOCK_TOTAL}`,
        });
        // Let the page draw and stay usable while this runs.
        await new Promise((done) => setTimeout(done, 0));
      }
    }

    this.#store.set({
      samples: [...samples()],
      status: got ? `${got} recordings ready to use` : '',
    });
  }

  /** Forget anything fetched to be heard and never used. */
  releaseLoans(): void {
    if (!this.#onLoan.size) return;
    const armed = this.#store.state.currentSource;
    const inUse = new Set<string>();
    for (const cue of this.project.cues) {
      if (cue.source.kind === 'sample') inUse.add(cue.source.name);
      for (const part of cue.source.with ?? []) {
        if (part.kind === 'sample') inUse.add(part.name);
      }
    }
    // Whatever is armed stays: it was clicked a moment ago and is about to be
    // placed, which is the whole reason it was fetched.
    if (armed.kind === 'sample') inUse.add(armed.name);

    for (const id of [...this.#onLoan]) {
      if (inUse.has(id)) continue;
      forgetSample(id);
      this.#onLoan.delete(id);
    }
    this.#store.set({ samples: [...samples()] });
  }

  /**
   * Take on sounds found on Freesound.
   *
   * The same destination as a dropped file, reached without the round trip
   * through a downloads folder. What arrives is the preview rather than the
   * original — see `audio/freesound.ts` for why a static page cannot fetch
   * the original — and the credit comes from the API rather than from the
   * filename, which means it carries the licence too. That is the part worth
   * having: a search that pulls in fifty sounds and forgets which of them are
   * CC-BY has created an obligation nobody can keep.
   */
  async addFromFreesound(sounds: readonly Found[]): Promise<void> {
    if (!sounds.length) return;
    this.#wake();

    const entries: TakeEntry[] = [];
    const refused: string[] = [];

    for (const [at, sound] of sounds.entries()) {
      this.#store.set({ status: `fetching ${at + 1} of ${sounds.length}…` });
      try {
        const file = await fetchSound(sound);
        entries.push({
          path: file.name,
          blob: file,
          name: sound.name,
          credit: creditFor(sound),
          /*
           * Freesound's own tags, which are the closest thing it has to the
           * folders a downloaded archive would have arrived in — plus a note
           * that this is a preview and not the master, because that is the
           * one thing about these the library could not otherwise say and the
           * one thing somebody would want to know before mastering from it.
           */
          tags: ['preview', ...sound.tags.slice(0, 6).map((t) => t.toLowerCase())],
        });
      } catch (error) {
        refused.push(sound.name);
        if (error instanceof FreesoundError && error.fault.kind !== 'unreachable') {
          this.#store.set({ status: error.message });
          break;
        }
      }
    }

    if (!entries.length) {
      this.#store.set({
        status: refused.length
          ? `could not fetch ${refused.length === 1 ? refused[0] : `${refused.length} sounds`}`
          : 'nothing to add',
      });
      return;
    }

    const added = await this.#take(entries);
    this.#keepSamples();
    this.#store.set({
      samples: [...samples()],
      status:
        `${added} added from Freesound` +
        (refused.length ? `, ${refused.length} could not be fetched` : ''),
    });
  }

  /**
   * Decode what has been gathered and put it in the library.
   *
   * Shared by the file importer and the Freesound one, because the difference
   * between them is entirely in where the bytes came from: past that point a
   * recording is a recording, and having two copies of "decode it, measure
   * it, file it, remember who made it" is how the two come to disagree.
   */
  async #take(entries: readonly TakeEntry[]): Promise<number> {
    /*
     * Decoding needs a context and a browser withholds one until something has
     * been clicked. `#wake()` usually provides it, but an import is itself the
     * first click often enough to matter, so a throwaway offline context
     * stands in — the same fallback `decodeSample` uses, and the difference
     * between a folder importing and a folder silently refusing.
     */
    const ctx = this.#engine.context ?? new OfflineAudioContext(1, 1, 48000);
    let added = 0;

    for (const [at, entry] of entries.entries()) {
      if (entries.length > PROGRESS_FROM && at % 20 === 0) {
        this.#store.set({ status: `reading ${at + 1} of ${entries.length}…` });
        // Let the page draw. Without this the whole import is one frame and
        // the count goes from nothing straight to the total.
        await new Promise((done) => setTimeout(done, 0));
      }

      let buffer: AudioBuffer | null = null;
      try {
        buffer = await ctx.decodeAudioData(await entry.blob.arrayBuffer());
      } catch {
        buffer = null;
      }
      if (!buffer) continue;

      addSample(
        {
          id: entry.id ?? newId('s'),
          name: entry.name || entry.path,
          duration: buffer.duration,
          blob: entry.blob,
          ...(entry.credit ? { credit: entry.credit } : {}),
          ...(entry.tags && entry.tags.length ? { tags: entry.tags } : {}),
        },
        /*
         * Past a certain number the decoded audio is not kept.
         *
         * A two second stereo buffer at 48 kHz is 768 kB, so four hundred of
         * them is three hundred megabytes of decoded audio for a library
         * nobody has played a note of yet. Beyond this they are decoded again
         * when something actually asks for one, which `decodeSample` already
         * does for everything restored from last time.
         */
        at < KEEP_DECODED ? buffer : null,
      );
      added++;
    }

    return added;
  }

  /**
   * Everything worth decoding out of what was handed over, zips opened.
   *
   * A file picked from a folder carries its path in `webkitRelativePath` and
   * one picked on its own does not, so the path is whichever of those exists.
   * That path is the whole point: it is where the archive kept its categories.
   */
  async #unpack(
    files: readonly File[],
  ): Promise<{ audio: { path: string; blob: Blob }[]; tables: string[] }> {
    const audio: { path: string; blob: Blob }[] = [];
    const tables: string[] = [];

    for (const file of files) {
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const data = await file.arrayBuffer();

      if (!looksLikeZip(new Uint8Array(data))) {
        if (TABLE_FILE.test(path)) tables.push(await file.text());
        else audio.push({ path, blob: file });
        continue;
      }

      this.#store.set({ status: `opening ${file.name}…` });
      const read = await readZip(
        data,
        (inside) => AUDIO_FILE.test(inside) || TABLE_FILE.test(inside),
      );
      const stem = file.name.replace(/\.zip$/i, '');
      for (const entry of read.entries) {
        if (TABLE_FILE.test(entry.path)) {
          tables.push(new TextDecoder().decode(entry.bytes));
          continue;
        }
        audio.push({
          // Kept under the archive's own name, so two packs with a `hits`
          // folder in each do not merge into one tag.
          path: `${stem}/${entry.path}`,
          blob: new Blob([entry.bytes as BlobPart]),
        });
      }
    }

    return { audio, tables };
  }

  /**
   * Write out who is owed a credit.
   *
   * CC-BY, which most of Freesound is, requires the author be named wherever
   * the work is used. That is an obligation on whoever exports the video, not
   * on this app, but an app that knows the answer and does not offer it has
   * made the obligation harder to meet than it needs to be.
   *
   * Sounds under CC0 are left out: they ask for nothing, and a list padded
   * with them is one nobody reads. A recording whose licence was never
   * recorded is included, because an unknown licence is a reason to check.
   */
  saveCredits(): void {
    const lines: string[] = [];
    for (const sample of samples()) {
      const line = creditLine(sample);
      if (line) lines.push(line);
    }

    if (!lines.length) {
      this.#store.set({
        status: samples().length
          ? 'no recording here asks to be credited'
          : 'no recordings to credit',
      });
      return;
    }

    const text =
      'Sounds used in this piece\n' +
      '=========================\n\n' +
      lines.map((line) => `- ${line}`).join('\n') +
      '\n\nRecordings under CC0 or public domain are not listed: they ask for\n' +
      'no credit. Anything listed without a licence is one this app was never\n' +
      'told about — check it before publishing.\n';

    saveBlob(new Blob([text], { type: 'text/plain' }), `${this.#stem()}-credits.txt`);
    this.#store.set({ status: `${lines.length} credit${lines.length === 1 ? '' : 's'} written` });
  }

  /** Take a recording back out. Sounds already placed from it stay put. */
  removeSample(id: string): void {
    const sample = sampleById(id);
    if (!sample) return;
    forgetSample(id);
    this.#keepSamples();
    this.#store.set({ samples: [...samples()], status: `${sample.name} removed` });
  }

  #keepSamples(): void {
    /*
     * Everything but the decoded audio.
     *
     * This picked out four fields by name once, which silently dropped the
     * credit and the tags on the way to the store — the library came back
     * after a reload with its names and its lengths and no idea who had made
     * any of it. Spreading and removing what cannot be written is the shape
     * that does not go wrong when the sample gains a field.
     */
    void keepSamples(
      samples()
        // Anything still on loan was fetched to be heard and has not been
        // used, so it is not part of the library yet. See #onLoan.
        .filter((sample) => !this.#onLoan.has(sample.id))
        .map(({ ...rest }) => rest),
    );
  }

  /**
   * Take on the recordings from last time.
   *
   * Without their audio, which is decoded the first time one is played or
   * placed: decoding needs an audio context and a browser will not give one
   * until something has been clicked, and a piece that refused to open until
   * then would be worse than one whose sounds arrive a moment late.
   */
  restoreSamples(list: readonly Sample[]): void {
    setSamples(list);
    if (list.length) this.#store.set({ samples: [...samples()] });
  }

  /**
   * Make sure every recording a piece uses has audio, before it is heard.
   *
   * No early return when the engine is asleep: an export is a click that never
   * starts it, and giving up here is what made an exported piece come out with
   * silence where its recordings were. `decodeSample` stands an offline
   * context in when there is no live one.
   */
  async readySamples(): Promise<void> {
    const ctx = this.#engine.context;
    const wanted = new Set<string>();
    for (const cue of this.project.cues) {
      if (cue.source.kind === 'sample') wanted.add(cue.source.name);
      for (const part of cue.source.with ?? []) {
        if (part.kind === 'sample') wanted.add(part.name);
      }
    }
    let changed = false;
    for (const id of wanted) changed = (await decodeSample(id, ctx)) || changed;
    if (changed) this.#store.set({ samples: [...samples()] });
  }

  /** Read-only access for views that redraw outside a state change. */
  get store(): Store {
    return this.#store;
  }

  get project(): Project {
    return this.#store.state.project;
  }

  /**
   * Whether the transport is running.
   *
   * From the store rather than from the clock, so that everything reading it
   * is reading the same thing the last render saw. The clock is still what
   * decides; it says so on the way in and out, and this is where that lands.
   */
  get playing(): boolean {
    return this.#store.state.playing;
  }

  get time(): number {
    return this.#clock?.time ?? 0;
  }

  /**
   * Change the project, remembering what it was.
   *
   * Everything that edits the piece goes through here, which is what makes
   * undo possible at all: the project is replaced rather than modified, so
   * keeping the one before costs a reference and undoing is putting it back.
   *
   * `label` is what groups a run of small changes into one step. Dragging a
   * sound writes a new project on every movement of the pointer, and undoing
   * that a pixel at a time would be useless, so consecutive changes carrying
   * the same label inside {@link COALESCE_MS} count as one.
   *
   * `remember` is off for changes that are not edits. Loading a video and
   * measuring its frame rate both change the project, and neither is
   * something anyone would expect to undo.
   */
  #setProject(project: Project, label = '', remember = true): void {
    if (remember && project !== this.project) {
      const top = this.#past[this.#past.length - 1];
      const sameGesture = label !== '' && top?.label === label && this.#now() - top.at < COALESCE_MS;

      if (sameGesture) top.at = this.#now();
      else this.#past.push({ project: this.project, label, at: this.#now() });

      if (this.#past.length > MAX_HISTORY) this.#past.shift();
      this.#future.length = 0;
    }
    this.#store.set({ project });
    // After the state is set, so the line it may write is the last word rather
    // than something the same change overwrites.
    this.#noticeCrowding();
  }

  #now(): number {
    return performance.now();
  }

  // ---------- undo ----------

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  /** Put the piece back the way it was before the last thing you did. */
  undo(): void {
    this.#step(this.#past, this.#future, 'nothing to undo');
  }

  /** And forward again. */
  redo(): void {
    this.#step(this.#future, this.#past, 'nothing to redo');
  }

  #step(from: Step[], to: Step[], nothing: string): void {
    const step = from.pop();
    if (!step) {
      this.#store.set({ status: nothing });
      return;
    }
    to.push({ project: this.project, label: step.label, at: this.#now() });

    // A sound that no longer exists cannot stay selected, or the panel would
    // be editing something that is not there.
    // Sounds that no longer exist cannot stay chosen, or the panel would be
    // editing something that is not there.
    const alive = new Set(step.project.cues.map((cue) => cue.id));

    this.#store.set({
      project: step.project,
      selection: this.#store.state.selection.filter((id) => alive.has(id)),
      status: from === this.#past ? 'undone' : 'redone',
    });
  }

  /** Forget the history. Used where the piece is replaced rather than edited. */
  #forgetHistory(): void {
    this.#past.length = 0;
    this.#future.length = 0;
  }

  /** Give the session the video element the interface created. */
  attachVideo(video: HTMLVideoElement): void {
    this.#video = video;
    this.#clock = new VideoClock(video, this.#engine, {
      project: () => this.project,
      onTime: (t) => this.effects.onTime(t),
      onPlaying: (playing) => this.#store.set({ playing }),
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
    this.#setProject(
      { ...this.project, duration: loaded.duration, videoName: loaded.name },
      '',
      false,
    );
    this.#store.set({ videoReady: true, status: `${loaded.name} loaded` });
    this.onVideoLoaded?.();

    // Measuring the frame rate needs frames to go past, so it runs during a
    // short muted play and then returns to the start.
    void this.#measureFps();

    /*
     * Kept so a reload opens on the picture as well as the piece.
     *
     * Not awaited: a large file takes a moment to write and there is nothing
     * about the app that has to wait for it. If it will not fit, that is
     * worth one line in the status — the timeline is kept either way, and
     * only the clip has to be found again.
     */
    void keepVideo(file).then((kept) => {
      if (!kept) {
        this.#store.set({
          status: `${loaded.name} is too large to keep for next time — the timeline is still kept`,
        });
      }
    });
  }

  /**
   * Put a clip back that was kept from last time.
   *
   * Deliberately not {@link loadVideo}: that one is somebody choosing a file,
   * so it clears what was found for the last clip and measures the frame rate
   * afresh. Here the piece has already been restored, carrying whatever frame
   * rate was being worked to — corrected by hand, quite possibly — and this
   * is the same file it was carrying it for. Measuring again would overwrite
   * a decision that was already made.
   */
  async restoreVideo(file: File): Promise<boolean> {
    const video = this.#video;
    if (!video) return false;
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);

    let loaded;
    try {
      loaded = await loadVideoFile(video, file);
    } catch {
      return false;
    }

    this.#objectUrl = loaded.url;
    // The duration comes from the file rather than from what was written
    // down, since the file is the one that decides how long it is.
    this.#setProject(
      { ...this.project, duration: loaded.duration, videoName: loaded.name },
      '',
      false,
    );
    this.#store.set({ videoReady: true });
    this.onVideoLoaded?.();
    return true;
  }

  /**
   * Carry on with the piece that was being worked on.
   *
   * Runs before anything is on screen, so it is not an edit and there is
   * nothing to undo back to. The clip follows separately, and later: it lives
   * in a store that has to be waited for, and there is no reason to hold the
   * whole app up for it when the timeline is ready now.
   */
  restoreProject(project: Project): void {
    this.#setProject(project, '', false);
    this.#forgetHistory();
    const active = this.#store.state.activeLayerId;
    this.#store.set({
      activeLayerId: project.layers.some((l) => l.id === active) ? active : project.layers[0].id,
      selection: [],
    });
  }

  /**
   * Start again on nothing.
   *
   * Throws the piece away, and the kept copy of it with it, which is the
   * whole point: anything short of that and the next reload brings back what
   * was just cleared. What is kept on purpose across projects — the packs,
   * the sounds you saved, the patterns on the instruments — is left alone,
   * because starting a new piece is not the same as forgetting your own
   * sounds.
   */
  async newProject(): Promise<void> {
    this.pause();
    this.stopShuttle();
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#objectUrl = null;
    if (this.#video) {
      this.#video.removeAttribute('src');
      this.#video.load();
    }

    await forgetWork();

    const project = emptyProject();
    this.#setProject(project, '', false);
    this.#forgetHistory();
    this.#store.set({
      videoReady: false,
      selection: [],
      activeLayerId: project.layers[0].id,
      detect: emptyDetection(),
      extract: { busy: null, sounds: [], from: null },
      armed: false,
      videoWindow: false,
      status: 'new project',
    });
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
      // Measuring the rate is not an edit, so it is not something to undo.
      this.#setProject({ ...this.project, fps }, '', false);

      /*
       * Unless somebody started playing while this was going on.
       *
       * The clip is announced as ready before the rate is measured, and the
       * transport comes alive with it, so pressing play inside that half
       * second is a fair thing to do. It was answered by this method finishing
       * a moment later, stopping the clip and putting it back to the start --
       * a play that turned into a jump to zero with nothing said about why.
       * Whoever is driving wins.
       */
      if (this.playing) {
        void video.play().catch(() => {});
        return;
      }
      video.currentTime = 0;
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

  /**
   * How long the piece is, whatever the clip is.
   *
   * Loading a video sets this, and until now that was the only way it was
   * ever set: the length of the piece was the length of the file and there
   * was no saying otherwise. Two things want otherwise. A reverb tail that
   * runs past the last frame has nowhere to be, and a pass over the first
   * thirty seconds of a five minute clip is thirty seconds of work on four
   * and a half minutes of ruler.
   *
   * Nothing is thrown away by shortening it. Sounds already past the new end
   * stay where they are and are drawn past the mark that says where the piece
   * stops, the same way sounds past the end of a video always have been; what
   * changes is the ruler, where End goes, and how long an export runs for.
   * Somebody who shortens the piece by mistake loses nothing by putting it
   * back.
   */
  setDuration(seconds: number): void {
    const wanted = Math.max(MIN_DURATION, seconds);
    if (Math.abs(wanted - this.project.duration) < 1e-6) return;
    this.#setProject({ ...this.project, duration: wanted }, 'duration');
    this.#store.set({ status: `length ${timecode(wanted, this.project.fps)}` });
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
    // Whichever way this goes, a held fast forward is over.
    this.stopShuttle();
    if (this.#clock.playing) this.#clock.pause();
    else {
      // Remembered so stop can put it back, rather than dropping you at zero.
      this.#playedFrom = this.#clock.time;
      this.#wake();
      // Anything restored from last time has no audio yet. Pressing play is a
      // gesture, so there is a context now and this is the first moment the
      // recordings on the timeline can be made ready to sound.
      void this.readySamples();
      void this.#clock.play();
    }
  }

  pause(): void {
    this.#clock?.pause();
  }

  seek(time: number): void {
    this.#clock?.seek(time);
  }

  /** Whether playing an instrument lands on the timeline. */
  get armed(): boolean {
    return this.#store.state.armed;
  }

  /**
   * Stop: pause, and go back to where the playhead was before it ran.
   *
   * Not back to zero. Stopping and finding yourself at the top of a two
   * minute clip means winding back to the part you were working on every
   * time, which is what makes a stop button annoying rather than useful.
   */
  stop(): void {
    const from = this.#playedFrom;
    this.pause();
    this.stopShuttle();
    this.seek(from ?? 0);
  }

  /**
   * Jump to the sound before or after the playhead, and take it.
   *
   * By where each sound is pinned rather than where it starts sounding: a
   * riser anchored to its end begins well before the moment it is for, and
   * the moment it is for is the one worth stepping between.
   */
  toSound(direction: -1 | 1): void {
    const now = this.time;
    // A hair either side, or a second press sticks on the sound just reached.
    const edge = 1e-3;
    const ordered = [...this.project.cues].sort((a, b) => a.time - b.time);
    const found =
      direction > 0
        ? ordered.find((cue) => cue.time > now + edge)
        : [...ordered].reverse().find((cue) => cue.time < now - edge);
    if (!found) return;
    this.seek(found.time);
    this.select([found.id]);
  }

  /**
   * Run through the clip at a multiple of speed until told to stop.
   *
   * Driven by the wall clock rather than by a fixed step per tick, so the
   * speed is the speed whatever the browser is doing: a tab that drops frames
   * shuttles the same distance, just less smoothly.
   */
  shuttle(rate: number): void {
    this.stopShuttle();
    if (!rate || !this.#clock) return;
    this.pause();
    let last = performance.now();
    this.#shuttling = setInterval(() => {
      const now = performance.now();
      const moved = ((now - last) / 1000) * rate;
      last = now;
      const to = this.time + moved;
      this.seek(to);
      // Nothing left to run through in that direction.
      if (to <= 0 || (this.project.duration > 0 && to >= this.project.duration)) {
        this.stopShuttle();
      }
    }, SHUTTLE_MS);
  }

  stopShuttle(): void {
    if (this.#shuttling !== null) clearInterval(this.#shuttling);
    this.#shuttling = null;
  }

  /** Move by a number of frames, for landing a hit exactly. */
  stepFrames(frames: number): void {
    if (!this.#clock) return;
    this.#clock.seek(this.#clock.time + frames * frameDuration(this.project));
  }

  // ---------- cues ----------

  /**
   * Arm a sound, and whatever settings it was picked with.
   *
   * A preset of null means the voice's own settings, so picking a plain voice
   * after a library entry puts the plain voice back rather than leaving the
   * last entry's length and room quietly attached to it.
   */
  setSource(source: CueSource, preset: CuePreset | null = null): void {
    this.#store.set({ currentSource: source, currentPreset: preset });
  }

  /**
   * Choose a sound and hear it.
   *
   * Picking from a list of three hundred names without hearing any of them is
   * guesswork, and the way round it was to place one, listen, undo, and try
   * again. Choosing now plays the sound at the settings it would arrive with,
   * so the list can be worked through by ear.
   */
  chooseSource(source: CueSource, preset: CuePreset | null = null): void {
    this.setSource(source, preset);
    this.preview(source, preset);
  }

  /**
   * Hear a sound as it would arrive, without putting it anywhere.
   *
   * Given room to be its full length, which takes explaining.
   *
   * Four voices — riser, swell, reverse and zip — finish on their marker
   * rather than starting from it, because the whole point of a riser is to
   * lead into something. {@link cueLength} therefore clamps them to how much
   * timeline lies before them: a riser dropped at 0.3 s is 0.3 s long, since
   * it cannot begin before the piece does. That is right for a placed sound.
   *
   * It is wrong here. This cue is never placed anywhere — it exists to be
   * heard once — so building it at zero gave it no room at all, and clicking
   * any of those four in the palette played the 0.2 second stub their own
   * minimum length allows instead of the sound. A hundred of the thousand
   * library entries could not be auditioned, which is most of the reason
   * riser, swell and reverse measured as indistinguishable from each other:
   * three 0.2 second noise blips are indistinguishable.
   *
   * Placing it at its own length puts its start at zero and gives it all of
   * itself, for the two anchors alike.
   */
  preview(source: CueSource, preset: CuePreset | null = null): void {
    const cue = dressCue(makeCue(0, this.#store.state.activeLayerId, source), preset);
    this.audition(cue.anchor === 'end' ? { ...cue, time: cue.length } : cue);
  }

  /**
   * The armed sound, built ready to place.
   *
   * Everywhere that puts down "the current sound" goes through here, so the
   * timeline, the playhead and the suggested hits cannot come to disagree
   * about what a library entry means.
   */
  #armedCue(time: number, layerId: string): Cue {
    const { currentSource, currentPreset } = this.#store.state;
    return dressCue(makeCue(time, layerId, currentSource), currentPreset);
  }

  /**
   * Put every layer at the level its job asks for.
   *
   * The four names were always good and never meant anything: every sound
   * arrived at the same level whatever it was on, and a first pass came out
   * flat because a mix is mostly an order of importance and there was none.
   *
   * One button rather than a mode, and nothing here is enforced afterwards:
   * it sets four numbers that were all one, and anything moved after it wins.
   * A layer somebody added themselves is left alone, since guessing what a
   * layer called "Foley" is for and quietly changing its level on that guess
   * is worse than doing nothing.
   */
  balanceLayers(): void {
    const layers = this.project.layers.map((layer) => {
      const job = layerJob(layer.id);
      return job ? { ...layer, gain: job.level } : layer;
    });

    const moved = layers.filter((layer, i) => layer.gain !== this.project.layers[i].gain).length;
    if (!moved) {
      this.#store.set({ status: 'the layers are already balanced' });
      return;
    }

    this.#setProject({ ...this.project, layers }, 'balance');
    this.#store.set({
      status:
        moved === 1
          ? 'one layer moved to the level its job asks for — undo takes it back'
          : `${moved} layers moved to the levels their jobs ask for — undo takes it back`,
    });
  }

/**
   * The rate this last said something about, or nought if it has not.
   *
   * Said when it crosses, and then only again if it has grown by another
   * whole sound a second. A line that reappears every time a sound is placed
   * is a line somebody learns to look past, which is the opposite of what it
   * is for; a line that says two while the piece is at four is worse still,
   * because it is simply wrong by then. Growing far enough to be worth saying
   * again is the one case where repeating it earns its place.
   */
  #saidAt = 0;

  #noticeCrowding(): void {
    const rate = density(this.project);
    const heard = this.project.cues.filter((cue) => !cue.muted).length;

    if (rate <= CROWDED_RATE || heard < CROWDED_LEAST) {
      this.#saidAt = 0;
      return;
    }
    if (this.#saidAt && rate < this.#saidAt + CROWDED_AGAIN) return;
    this.#saidAt = rate;
    this.#store.set({
      status:
        `${rate.toFixed(1)} sounds a second. Four good ones usually beat forty: ` +
        'try taking some out before adding more.',
    });
  }

  setActiveLayer(layerId: string): void {
    this.#store.set({ activeLayerId: layerId });
  }

  /** Work on exactly these, replacing whatever was chosen before. */
  select(ids: readonly string[]): void {
    this.#store.set({ selection: [...ids] });
  }

  /** Add one to what is chosen, or take it out if it is already there. */
  toggleSelected(id: string): void {
    const selection = this.#store.state.selection;
    this.select(selection.includes(id) ? selection.filter((it) => it !== id) : [...selection, id]);
  }

  selectAll(): void {
    this.select(this.project.cues.map((cue) => cue.id));
  }

  /** The sounds chosen, in the order they sit on the timeline. */
  get selected(): Cue[] {
    const chosen = new Set(this.#store.state.selection);
    return this.project.cues.filter((cue) => chosen.has(cue.id));
  }

  toggleArmed(): void {
    this.#store.set({ armed: !this.#store.state.armed });
  }

  /** Float the video over everything instead of sitting it on the stage. */
  toggleVideoWindow(): void {
    this.#store.set({ videoWindow: !this.#store.state.videoWindow });
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
    const at = snapTime(this.project, this.#insideVideo(time));
    const on = layerId ?? state.activeLayerId;
    // An explicit source is an instrument being played, which arms nothing
    // and so carries none of the library's settings.
    const cue = source ? makeCue(at, on, source) : this.#armedCue(at, on);
    this.#setProject({ ...this.project, cues: [...this.project.cues, cue] }, `place:${cue.id}`);
    this.#store.set({ selection: [cue.id] });
    // Using a sound is what turns it from one you were listening to into one
    // you have. See #onLoan.
    this.#settle(cue);
    this.audition(cue);
    return cue;
  }

  /**
   * A placed recording stops being on loan and is written down.
   *
   * Only the ones actually used, so auditioning a page of results leaves the
   * library as it was and placing one adds exactly that one.
   */
  #settle(cue: Cue): void {
    if (!this.#onLoan.size) return;
    const used: string[] = [];
    if (cue.source.kind === 'sample') used.push(cue.source.name);
    for (const part of cue.source.with ?? []) {
      if (part.kind === 'sample') used.push(part.name);
    }
    let kept = false;
    for (const id of used) {
      if (this.#onLoan.delete(id)) kept = true;
    }
    if (kept) this.#keepSamples();
  }

  /** Place a cue at the playhead. Used when playing an instrument while armed. */
  addCueAtPlayhead(source: CueSource): void {
    this.addCue(this.time, source);
  }

  updateCue(id: string, patch: Partial<Cue>): void {
    const bounded =
      patch.time === undefined ? patch : { ...patch, time: this.#insideVideo(patch.time) };
    // Labelled by what is being changed, so a drag is one step and moving the
    // same sound again later is another.
    this.#setProject(updateCue(this.project, id, bounded), `cue:${id}:${Object.keys(patch).join()}`);
  }

  /** Clamp a time to the loaded video. */
  #insideVideo(time: number): number {
    const end = this.project.duration;
    const t = Math.max(0, time);
    return end > 0 ? Math.min(t, end) : t;
  }

  /**
   * Change everything chosen at once.
   *
   * One change to the piece rather than one per sound, so a slider moved over
   * six sounds is one thing to undo rather than six.
   */
  /**
   * How many sounds can be stacked into one.
   *
   * Four voices is already eight or more layers, and past that a stack stops
   * being a sound made of parts and becomes a sound made of mud.
   */
  static readonly MAX_STACK = 3;

  /**
   * Put the armed sound on top of the ones selected.
   *
   * Reaching every selected sound, the same way the sliders do, so adding a
   * metallic ring to four impacts is one movement rather than four.
   */
  stackArmed(): void {
    const { currentSource } = this.#store.state;
    // A stack is one deep, so what is armed goes on without whatever is on it.
    const part: CueSource = { ...currentSource, mix: 1 };
    delete (part as { with?: unknown }).with;

    this.#eachSelected('stack', (source) => {
      const on = source.with ?? [];
      if (on.length >= SoundDesignSession.MAX_STACK) return source;
      return { ...source, with: [...on, part] };
    });
  }

  /** Take one of the stacked sounds off again. */
  unstack(at: number): void {
    this.#eachSelected(`unstack:${at}`, (source) => {
      const on = source.with ?? [];
      if (at < 0 || at >= on.length) return source;
      const left = on.filter((_, i) => i !== at);
      const next = { ...source };
      if (left.length) next.with = left;
      else delete next.with;
      return next;
    });
  }

  /** How much of one of the stacked sounds there is. */
  setStackMix(at: number, mix: number): void {
    const held = Math.max(0, Math.min(1, mix));
    this.#eachSelected(`mix:${at}`, (source) => {
      const on = source.with ?? [];
      if (at < 0 || at >= on.length) return source;
      return { ...source, with: on.map((part, i) => (i === at ? { ...part, mix: held } : part)) };
    });
  }

  /**
   * Change the source of everything selected, each from its own.
   *
   * Not {@link updateSelected}, which writes one value over every sound
   * chosen: a source belongs to the sound it is on, and handing four sounds
   * the same one would replace three of them rather than add to them.
   */
  #eachSelected(label: string, change: (source: CueSource) => CueSource): void {
    const chosen = new Set(this.#store.state.selection);
    if (!chosen.size) return;
    this.#setProject(
      {
        ...this.project,
        cues: this.project.cues.map((cue) =>
          chosen.has(cue.id) ? { ...cue, source: change(cue.source) } : cue,
        ),
      },
      `${label}:${[...chosen].join()}`,
    );
  }

  updateSelected(patch: Partial<Cue>): void {
    const chosen = new Set(this.#store.state.selection);
    if (!chosen.size) return;
    const bounded =
      patch.time === undefined ? patch : { ...patch, time: this.#insideVideo(patch.time) };
    this.#setProject(
      {
        ...this.project,
        cues: this.project.cues.map((cue) => (chosen.has(cue.id) ? { ...cue, ...bounded } : cue)),
      },
      `cues:${[...chosen].join()}:${Object.keys(patch).join()}`,
    );
  }

  /** Move everything chosen by a number of seconds, together. */
  moveSelection(seconds: number): void {
    const chosen = this.selected;
    if (!chosen.length || seconds === 0) return;

    /*
     * Held at both ends before anything moves, rather than each sound being
     * held on its own. Holding them one at a time would let the ends of the
     * group pile up against the start or the finish while the middle carried
     * on, and the shape of what was being moved would be lost.
     */
    const earliest = Math.min(...chosen.map((cue) => cue.time));
    const latest = Math.max(...chosen.map((cue) => cue.time));
    const end = this.project.duration;
    let shift = Math.max(seconds, -earliest);
    if (end > 0) shift = Math.min(shift, end - latest);
    if (shift === 0) return;

    const moving = new Set(chosen.map((cue) => cue.id));
    this.#setProject(
      {
        ...this.project,
        cues: this.project.cues.map((cue) =>
          moving.has(cue.id) ? { ...cue, time: Math.max(0, cue.time + shift) } : cue,
        ),
      },
      `move:${[...moving].join()}`,
    );
  }

  /** Move everything chosen by whole frames. */
  nudgeSelection(frames: number): void {
    this.moveSelection(frames * frameDuration(this.project));
  }

  /**
   * Make everything chosen longer or shorter by the same amount.
   *
   * By an amount rather than to a length, so dragging one edge of a group
   * keeps the differences between them: a quarter of a second, a half and a
   * whole one stay in that relation instead of collapsing into three of the
   * same length. The Length control is there for when you do want them equal.
   *
   * Held at both ends before anything changes, for the same reason moving a
   * group is. Letting each sound stop on its own would squash the shortest
   * against the floor while the rest carried on.
   */
  resizeSelection(seconds: number): void {
    const chosen = this.selected;
    if (!chosen.length || seconds === 0) return;

    const shortest = Math.min(...chosen.map((cue) => cue.length));
    const longest = Math.max(...chosen.map((cue) => cue.length));
    const change = Math.max(MIN_LENGTH - shortest, Math.min(MAX_LENGTH - longest, seconds));
    if (change === 0) return;

    const sizing = new Set(chosen.map((cue) => cue.id));
    this.#setProject(
      {
        ...this.project,
        cues: this.project.cues.map((cue) =>
          sizing.has(cue.id)
            ? { ...cue, length: Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, cue.length + change)) }
            : cue,
        ),
      },
      `resize:${[...sizing].join()}`,
    );
  }

  /** Remove everything chosen. */
  removeSelected(): void {
    const chosen = new Set(this.#store.state.selection);
    if (!chosen.size) return;
    this.#setProject(
      { ...this.project, cues: this.project.cues.filter((cue) => !chosen.has(cue.id)) },
      `remove:${[...chosen].join()}`,
    );
    this.#store.set({
      selection: [],
      status: chosen.size === 1 ? 'sound removed' : `${chosen.size} sounds removed`,
    });
  }

  // ---------- the range tool ----------

  /** The stretch of time drawn with the range tool, or null to clear it. */
  setRange(range: TimeRange | null): void {
    this.#store.set({ range });
  }

  /**
   * Clear every sound inside the drawn range.
   *
   * The range is a selection, so Delete does to it what Delete does to chosen
   * sounds. A sound counts as inside when it starts inside: judging it by the
   * whole of its length would take out a long tail that merely reaches into
   * the range from before it, which is not what was drawn round.
   */
  clearRange(): void {
    const range = this.#store.state.range;
    if (!range) return;
    const from = Math.min(range.from, range.to);
    const to = Math.max(range.from, range.to);

    const going = this.project.cues.filter((cue) => {
      const at = cueStart(cue);
      return at >= from && at <= to;
    });
    if (!going.length) {
      this.#store.set({ status: 'nothing in that stretch' });
      return;
    }

    const gone = new Set(going.map((cue) => cue.id));
    this.#setProject(
      { ...this.project, cues: this.project.cues.filter((cue) => !gone.has(cue.id)) },
      `range:${from.toFixed(2)}-${to.toFixed(2)}`,
    );
    this.#store.set({
      selection: [],
      status: gone.size === 1 ? 'sound removed' : `${gone.size} sounds removed`,
    });
  }

  // ---------- copying ----------

  /**
   * Copy what is chosen.
   *
   * Kept here rather than on the system clipboard. What is being copied is a
   * set of placed sounds, which means nothing outside this app, and reading
   * the system clipboard needs permission that would have to be asked for
   * every time.
   */
  copySelection(): void {
    const chosen = this.selected;
    if (!chosen.length) {
      this.#store.set({ status: 'nothing to copy' });
      return;
    }
    this.#clipboard = chosen.map((cue) => ({ ...cue }));
    this.#store.set({
      status: chosen.length === 1 ? 'sound copied' : `${chosen.length} sounds copied`,
    });
  }

  cutSelection(): void {
    const count = this.#store.state.selection.length;
    if (!count) return;
    this.copySelection();
    this.removeSelected();
    this.#store.set({ status: count === 1 ? 'sound cut' : `${count} sounds cut` });
  }

  /**
   * Put what was copied at the playhead.
   *
   * The gaps between them are kept, so a rhythm copied is a rhythm pasted.
   * Anything whose layer has gone since goes on the layer new sounds are
   * going on, rather than being dropped.
   */
  paste(): void {
    this.pasteAt(this.time);
  }

  /**
   * Paste at a moment, keeping the group's shape.
   *
   * The keyboard pastes at the playhead, which is where you are looking.
   * Right-clicking is a way of pointing at somewhere you are not, so it says
   * where instead. Both land the earliest of the copied sounds on the moment
   * given and lay the rest out behind it at the spacing they had.
   */
  pasteAt(at: number, layerId?: string): void {
    if (!this.#clipboard.length) {
      this.#store.set({ status: 'nothing to paste' });
      return;
    }
    const earliest = Math.min(...this.#clipboard.map((cue) => cue.time));
    const landing = snapTime(this.project, this.#insideVideo(at));
    const cues = this.#clipboard.map((cue) => {
      const copy = this.#copyOf(cue, landing + (cue.time - earliest));
      // Pasting onto a named layer puts the whole group there, since asking
      // for it on that lane and getting it on the lane it was cut from is
      // not what pointing at a lane means.
      return layerId ? { ...copy, layerId } : copy;
    });

    this.#setProject({ ...this.project, cues: [...this.project.cues, ...cues] }, 'paste');
    this.#store.set({
      selection: cues.map((cue) => cue.id),
      status: cues.length === 1 ? 'sound pasted' : `${cues.length} sounds pasted`,
    });
  }

  /**
   * Copy what is chosen and lay it out straight after itself.
   *
   * Offset by how much of the timeline the group occupies, so pressing it
   * again and again lays out a run rather than a stack. The copies become
   * what is chosen, which is what makes that work.
   */
  duplicateSelection(): void {
    const chosen = this.selected;
    if (!chosen.length) return;

    const from = Math.min(...chosen.map((cue) => cueStart(cue)));
    const to = Math.max(...chosen.map((cue) => cueStart(cue) + cueLength(cue)));
    const offset = Math.max(to - from, 0.1);

    const cues = chosen.map((cue) => this.#copyOf(cue, cue.time + offset));
    this.#setProject({ ...this.project, cues: [...this.project.cues, ...cues] }, 'duplicate');
    this.#store.set({
      selection: cues.map((cue) => cue.id),
      status: cues.length === 1 ? 'sound duplicated' : `${cues.length} sounds duplicated`,
    });
  }

  /** The same sound somewhere else, with an id of its own. */
  #copyOf(cue: Cue, time: number): Cue {
    const layers = new Set(this.project.layers.map((layer) => layer.id));
    return {
      ...cue,
      id: newId('c'),
      time: this.#insideVideo(Math.max(0, time)),
      layerId: layers.has(cue.layerId) ? cue.layerId : this.#store.state.activeLayerId,
    };
  }

  /** Move a cue by whole frames. */
  nudgeCue(id: string, frames: number): void {
    const cue = this.project.cues.find((c) => c.id === id);
    if (!cue) return;
    const next = Math.max(0, cue.time + frames * frameDuration(this.project));
    this.updateCue(id, { time: next });
  }

  removeCue(id: string): void {
    this.#setProject(removeCue(this.project, id), `remove:${id}`);
    this.select(this.#store.state.selection.filter((it) => it !== id));
  }

  updateLayer(id: string, patch: Partial<Layer>): void {
    this.#setProject(updateLayer(this.project, id, patch), `layer:${id}:${Object.keys(patch).join()}`);
  }

  /**
   * Set one of a layer's curves.
   *
   * Given whole rather than a point at a time, because drawing one is a
   * continuous movement and the interface has the finished shape by the time
   * the pointer comes up.
   */
  setAuto(id: string, lane: LaneName, points: AutoPoint[], what = 'draw'): void {
    const layer = this.project.layers.find((l) => l.id === id);
    if (!layer) return;
    // Labelled by the lane and by what was done, so drawing a level and then
    // a position, or moving a point and then shaping the line into it, are
    // two things to undo rather than one.
    this.#setProject(
      updateLayer(this.project, id, { auto: { ...layer.auto, [lane]: points } }),
      `${what}:${lane}:${id}`,
    );
  }

  removeAutoPoint(id: string, lane: LaneName, index: number): void {
    this.#setProject(removeAutoPoint(this.project, id, lane, index), `${lane}:${id}:remove`);
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
      selection: [],
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
    if (usesSample(cue)) {
      void this.readySamples().then(() => this.#clock?.audition(cue));
      return;
    }
    this.#clock?.audition(cue);
  }

  /** Play from a little before a cue, so it is heard in context. */
  previewInContext(cue: Cue, lead = 1): void {
    this.seek(Math.max(0, cueStart(cue) - lead));
    void this.#clock?.play();
  }

  /**
   * Run from a moment, with a little of what leads into it.
   *
   * The same thing {@link previewInContext} does for a sound, said in
   * seconds, for the places that have a time and no cue to hand: a
   * right-click on empty timeline, or on a sound whose start is what is
   * wanted rather than the sound itself.
   */
  playFrom(at: number, lead = 1): void {
    this.seek(Math.max(0, at - lead));
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
    this.#reading = new AbortController();
    const reading = this.#reading;
    this.#readingFrom = performance.now();
    this.#store.set({
      detect: { ...emptyDetection(), status: 'scanning', sensitivity: this.#store.state.detect.sensitivity },
      status: 'reading the video…',
    });

    let samples;
    try {
      samples = await analyseMotion(url, {
        fps: project.fps,
        onProgress: (fraction) => this.#progress('scanning', fraction),
        signal: reading.signal,
      });
    } catch (error) {
      this.#store.set({
        detect: emptyDetection(),
        status: error instanceof Error ? error.message : 'could not read the video',
      });
      return;
    }

    /*
     * Called off part way. What was read is thrown away rather than half
     * offered: a pass over the first third of a clip would suggest sounds for
     * the first third and say nothing about the rest, which reads as the app
     * having found nothing there.
     */
    if (reading.signal.aborted) return;

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
    const moments = readMoments(samples, peaks, this.project.duration);
    this.#store.set({
      detect: {
        status: 'ready',
        progress: 1,
        secondsLeft: null,
        samples,
        candidates,
        peaks,
        sensitivity,
        moments,
        settled: {},
      },
      panelTab: 'moments',
      status: `${moments.length} moments found`,
    });
  }

  /** When the current read began, so how long is left can be worked out. */
  #readingFrom = 0;

  #progress(status: 'scanning' | 'pinning', progress: number): void {
    const detect = this.#store.state.detect;
    if (detect.status !== status) return;

    /*
     * How long is left, from the rate so far rather than from a guess.
     *
     * Nothing is said until a twentieth of the way in, because before that
     * the rate is mostly the cost of starting and the answer swings about by
     * minutes. Rounded up to whole seconds, since a number that changes
     * several times a second is a number nobody can read.
     */
    const gone = (performance.now() - this.#readingFrom) / 1000;
    const secondsLeft =
      progress > 0.05 && gone > 0.5 ? Math.ceil((gone / progress) * (1 - progress)) : null;

    this.#store.set({ detect: { ...detect, progress, secondsLeft } });
  }

  /**
   * Stop a read that is going, keeping nothing.
   *
   * Reading takes about half the length of the clip, so a ten minute video is
   * five minutes, and there was no way out of it: the button that starts the
   * read is the one that shows the progress, and it was greyed out for the
   * duration. Loading the wrong file meant waiting it out.
   */
  stopFindingHits(): void {
    const { status } = this.#store.state.detect;
    if (status !== 'scanning' && status !== 'pinning') return;
    this.#reading?.abort();
    this.#store.set({ detect: emptyDetection(), status: 'stopped reading the video' });
  }

  /** How to call off the read that is going, if one is. */
  #reading: AbortController | null = null;

  /** Show more or fewer of what was already found. Does not read the video. */
  setSensitivity(sensitivity: number): void {
    const detect = this.#store.state.detect;
    const value = Math.max(0, Math.min(1, sensitivity));
    if (detect.status !== 'ready') {
      this.#store.set({ detect: { ...detect, sensitivity: value } });
      return;
    }
    const peaks = filterPeaks(detect.candidates, detect.samples, value, MIN_GAP);
    const moments = readMoments(detect.samples, peaks, this.project.duration);
    // Decisions outlive the list they were made about. Anything already
    // placed or passed over keeps that answer if it is still here, and a
    // moment the new sensitivity dropped takes its answer with it.
    const settled: Record<string, MomentState> = {};
    for (const moment of moments) {
      const was = detect.settled[moment.id];
      if (was) settled[moment.id] = was;
    }
    this.#store.set({ detect: { ...detect, sensitivity: value, peaks, moments, settled } });
  }

  /** Put the current sound on every suggested moment. */
  placeAllHits(): void {
    const { peaks } = this.#store.state.detect;
    if (!peaks.length) return;
    const state = this.#store.state;
    const cues = peaks.map((peak) =>
      this.#armedCue(snapTime(this.project, this.#insideVideo(peak.t)), state.activeLayerId),
    );
    this.#setProject({ ...this.project, cues: [...this.project.cues, ...cues] }, 'place all');
    this.#store.set({ status: `${cues.length} sounds placed` });
  }

  // ---------- reading sounds out of a recording ----------

  /**
   * Find the sounds in a file and rebuild each out of the palette.
   *
   * Nothing is uploaded: the browser decodes it, the app measures it, and it
   * never leaves the machine. What comes back is offers rather than answers —
   * three ways of making each sound, none of which the app can tell you is
   * the right one.
   */
  async extractFrom(file: File): Promise<void> {
    this.#wake();
    this.#store.set({ extract: { busy: 'reading the file…', from: file.name, sounds: [] } });

    const buffer = await this.#engine.decode(file);
    if (!buffer) {
      this.#store.set({
        extract: { busy: null, from: null, sounds: [] },
        status: 'that file could not be read as sound',
      });
      return;
    }

    this.#store.set({
      extract: { busy: 'finding the sounds…', from: file.name, sounds: [] },
    });
    // A turn of the loop, so the message is drawn before the work starts.
    await new Promise((wake) => setTimeout(wake, 0));
    const heard = listen(buffer);
    if (!heard.length) {
      this.#store.set({
        extract: { busy: null, from: file.name, sounds: [] },
        status: 'nothing in that file sounded like a separate sound',
      });
      return;
    }

    const sounds = await rebuild(heard, (done, of) => {
      this.#store.set({
        extract: { busy: `rebuilding ${done} of ${of}…`, from: file.name, sounds: [] },
      });
    });
    this.#store.set({
      extract: { busy: null, from: file.name, sounds },
      status: `${sounds.length} sounds rebuilt from ${file.name}`,
    });
  }

  /** Arm one of the ways of making a sound that was heard, and hear it. */
  chooseMade(made: Made): void {
    this.chooseSource(made.source, made.preset);
  }

  /** Put one where it was in the recording. */
  placeMade(heardAt: number, made: Made): void {
    const at = snapTime(this.project, this.#insideVideo(heardAt));
    const cue = dressCue(
      makeCue(at, this.#store.state.activeLayerId, made.source),
      made.preset,
    );
    this.#setProject({ ...this.project, cues: [...this.project.cues, cue] }, `place:${cue.id}`);
    this.#store.set({ selection: [cue.id] });
    this.audition(cue);
  }

  /** Put the closest of each where it was, which is the whole point of this. */
  placeAllExtracted(): void {
    const { extract, activeLayerId } = this.#store.state;
    if (!extract.sounds.length) return;
    const cues = extract.sounds.map((sound) =>
      dressCue(
        makeCue(snapTime(this.project, this.#insideVideo(sound.heard.at)), activeLayerId, sound.source),
        sound.preset,
      ),
    );
    this.#setProject({ ...this.project, cues: [...this.project.cues, ...cues] }, 'place rebuilt');
    this.#store.set({ status: `${cues.length} rebuilt sounds placed` });
  }

  clearExtracted(): void {
    this.#store.set({ extract: { busy: null, from: null, sounds: [] } });
  }

  /** Put the current sound on one suggested moment. */
  placeHit(time: number): void {
    this.addCue(time);
  }

  // ---------- moments ----------

  /** Which of the three the right panel shows. */
  setPanelTab(tab: PanelTab): void {
    this.#store.set({ panelTab: tab });
  }

  /** The moments found, with what the app would put on each one. */
  get moments(): { moment: Moment; suggested: Suggested; state: MomentState | null }[] {
    const { moments, settled } = this.#store.state.detect;
    return moments.map((moment) => ({
      moment,
      suggested: suggestFor(moment, this.project.fps),
      state: settled[moment.id] ?? null,
    }));
  }

  /** How many are still waiting on an answer. */
  get momentsLeft(): number {
    const { moments, settled } = this.#store.state.detect;
    return moments.filter((m) => !settled[m.id]).length;
  }

  /**
   * Put the suggested sound down, and remember that this one is done.
   *
   * The cues are made here rather than through addCue because a suggestion is
   * not the armed sound: it carries its own source, its own settings and its
   * own layer, and a build puts down two of them at once. Nothing about the
   * palette on the left is touched, so accepting a suggestion never changes
   * what the next click on the timeline would place.
   */
  acceptMoment(id: string): void {
    const found = this.#store.state.detect.moments.find((m) => m.id === id);
    if (!found || this.#store.state.detect.settled[id]) return;
    const made = this.#cuesFor(found);
    if (!made.length) return;

    this.#setProject({ ...this.project, cues: [...this.project.cues, ...made] }, `moment:${id}`);
    this.#settleMoment(id, 'placed');
    this.#store.set({ selection: made.map((cue) => cue.id) });
    for (const cue of made) this.#settle(cue);
    this.audition(made[0]);
  }

  /** Leave this one alone, and stop offering it. */
  dismissMoment(id: string): void {
    if (!this.#store.state.detect.moments.some((m) => m.id === id)) return;
    this.#settleMoment(id, 'skipped');
  }

  /** Put it back in the list, whichever way it was answered. */
  reopenMoment(id: string): void {
    const settled = { ...this.#store.state.detect.settled };
    if (!(id in settled)) return;
    delete settled[id];
    this.#store.set({ detect: { ...this.#store.state.detect, settled } });
  }

  /**
   * Accept everything still waiting, in one pass.
   *
   * The whole point of the panel for somebody in a hurry: a complete first
   * pass over the clip, which they then fix. Written as one change to the
   * project rather than one per moment so that undo takes the pass back as
   * the single thing it was, rather than forty times.
   */
  acceptAllMoments(): void {
    const { moments, settled } = this.#store.state.detect;
    const waiting = moments.filter((m) => !settled[m.id]);
    if (!waiting.length) return;

    const made: Cue[] = [];
    const done: Record<string, MomentState> = { ...settled };
    for (const moment of waiting) {
      const cues = this.#cuesFor(moment);
      if (!cues.length) continue;
      made.push(...cues);
      done[moment.id] = 'placed';
    }
    if (!made.length) return;

    this.#setProject({ ...this.project, cues: [...this.project.cues, ...made] }, 'moments:all');
    this.#store.set({
      detect: { ...this.#store.state.detect, settled: done },
      selection: [],
      status: `${made.length} sounds placed over ${waiting.length} moments`,
    });
    for (const cue of made) this.#settle(cue);
  }

  /** Hear what is suggested, against the picture, without placing it. */
  auditionMoment(id: string, inContext = true): void {
    const found = this.#store.state.detect.moments.find((m) => m.id === id);
    if (!found) return;
    const cues = this.#cuesFor(found);
    if (!cues.length) return;
    if (inContext) {
      this.previewInContext(cues[0]);
      return;
    }
    // Off the timeline, so the sound is heard from its own start whichever
    // end of it is anchored to the moment.
    for (const cue of cues) {
      this.audition(cue.anchor === 'end' ? { ...cue, time: cue.length } : cue);
    }
  }

  /** Take back every sound a suggestion put down, and offer them again. */
  clearPlacedMoments(): void {
    const { moments, settled } = this.#store.state.detect;
    const placed = new Set(moments.filter((m) => settled[m.id] === 'placed').map((m) => m.id));
    if (!placed.size) return;
    const cues = this.project.cues.filter((cue) => !cue.fromMoment || !placed.has(cue.fromMoment));
    const settledNow: Record<string, MomentState> = {};
    for (const [id, state] of Object.entries(settled)) {
      if (!placed.has(id)) settledNow[id] = state;
    }
    this.#setProject({ ...this.project, cues }, 'moments:clear');
    this.#store.set({
      detect: { ...this.#store.state.detect, settled: settledNow },
      selection: [],
      status: 'suggested sounds taken back',
    });
  }

  #settleMoment(id: string, state: MomentState): void {
    const detect = this.#store.state.detect;
    this.#store.set({ detect: { ...detect, settled: { ...detect.settled, [id]: state } } });
  }

  /**
   * The cues a moment's suggestion comes to.
   *
   * Every part is placed against the project's own snapping and held inside
   * the clip, exactly as a click on the timeline would be, so a suggested
   * sound and a hand-placed one land on the same frame and are afterwards
   * indistinguishable.
   */
  #cuesFor(moment: Moment): Cue[] {
    const { parts } = suggestFor(moment, this.project.fps);
    return parts.map((part) => {
      const at = snapTime(this.project, this.#insideVideo(moment.t + part.at));
      const cue = dressCue(makeCue(at, part.layerId, part.source), part.preset);
      return {
        ...cue,
        fromMoment: moment.id,
        ...(part.length === undefined ? {} : { length: Math.max(0.02, part.length) }),
        ...(part.gain === undefined ? {} : { gain: cue.gain * part.gain }),
      };
    });
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

  /**
   * The same thing again, as a file a music program opens on its timeline.
   *
   * The marker list says where everything lands in a spreadsheet. This says it
   * where somebody scoring the piece is already working, in sync, with every
   * sound on a row of its own. The kit is written as real percussion, so it
   * plays as a kit; nothing else is a note, so each voice is given a row and
   * keeps it, and the piano roll reads as the shape of the piece.
   */
  exportTimelineMidi(): void {
    if (!this.project.cues.length) {
      this.#store.set({ status: 'place some sounds first' });
      return;
    }
    const notes = cueNotes(this.project);
    if (!notes.length) {
      // Everything there is, is silenced. A file of nothing is not useful and
      // saying why is better than handing one over.
      this.#store.set({ status: 'every sound is muted, so there is nothing to write' });
      return;
    }
    saveBlob(encodeProjectMidi(this.project), `${this.#stem()}.mid`);
    this.#store.set({ status: `MIDI exported, ${notes.length} sounds` });
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
    // A recording with nothing decoded renders as silence, so an export that
    // did not wait would quietly write a file with holes in it.
    await this.readySamples();
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
    // A session replaces the piece rather than editing it, so there is
    // nothing sensible to go back to and the history starts again.
    this.#forgetHistory();

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
      selection: [],
      status: `session loaded, ${project.cues.length} sounds`,
    });
  }

  dispose(): void {
    this.#clock?.pause();
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
  }
}
