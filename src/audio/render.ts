import { audibleCues, cueGain, cueLength, cueStart } from '../timeline/project.ts';
import type { Cue, Project } from '../timeline/types.ts';
import { buildChain, type ChainSettings } from './chain.ts';
import {
  applyMaster,
  planMaster,
  type Master,
  type MasterOptions,
  type MasterReport,
} from './master.ts';
import { playCue, scheduleLayerLevels, syncLayerBuses } from './sources.ts';

/** Extra time past the video's end so a long tail is not cut off mid-decay. */
const TAIL = 2;

export interface RenderOptions {
  settings: ChainSettings;
  sampleRate?: number;
  /**
   * Keep the file exactly the length of the video. Anything still sounding at
   * the end is cut. Off by default, so tails are allowed to finish.
   */
  trimToDuration?: boolean;
  /** What to do to the level before it is written. */
  master?: MasterOptions;
}

/** One file, and what it holds. */
export interface Part {
  id: string;
  name: string;
  buffer: AudioBuffer;
}

export interface Rendered {
  parts: Part[];
  /** What the master did, or null when it was asked to do nothing. */
  report: MasterReport | null;
}

/**
 * Render cues to audio, faster than real time.
 *
 * This is the reason the export lines up. Nothing is performed and nothing is
 * captured through a microphone path, so every cue lands on the exact sample
 * its time works out to, and the file always starts at zero. Drop it on a
 * track at the start of the composition and it is in sync.
 */
export async function renderProject(project: Project, options: RenderOptions): Promise<Rendered> {
  return renderGroups(project, [{ id: 'mix', name: 'mix', cues: audibleCues(project) }], options);
}

/**
 * One file per layer, all the same length and all starting at zero.
 *
 * Layer levels are applied, so the stems add back up to the mix. So does
 * everything the master does, because it is worked out once from the sum and
 * then applied to each layer unchanged.
 */
export async function renderStems(project: Project, options: RenderOptions): Promise<Rendered> {
  const heard = audibleCues(project);
  const groups = project.layers
    .map((layer) => ({
      id: layer.id,
      name: layer.name,
      cues: heard.filter((cue) => cue.layerId === layer.id),
    }))
    .filter((group) => group.cues.length > 0);

  return renderGroups(project, groups, options);
}

/**
 * One file per sound, wherever that sound appears.
 *
 * Layers group by what a sound is for; this groups by what it is. Handing
 * over an impacts file and a whooshes file lets whoever picks it up balance
 * one against the other without going back to the source.
 */
export async function renderPerSound(project: Project, options: RenderOptions): Promise<Rendered> {
  const heard = audibleCues(project);
  const order: string[] = [];
  const bySound = new Map<string, Cue[]>();

  for (const cue of heard) {
    const name = String(cue.source.name);
    const found = bySound.get(name);
    if (found) found.push(cue);
    else {
      bySound.set(name, [cue]);
      order.push(name);
    }
  }

  return renderGroups(
    project,
    order.map((name) => ({ id: name, name, cues: bySound.get(name) ?? [] })),
    options,
  );
}

interface Group {
  id: string;
  name: string;
  cues: Cue[];
}

/**
 * Render each group to its own file, all the same length and all starting at
 * zero, then treat them all the same way.
 *
 * The level work is worked out from the sum of the groups rather than from
 * each one, because a file that has been dealt with on its own no longer sits
 * where it did against the others. Summing them costs nothing next to
 * rendering, and it is exact: the parts of the chain that carry over between
 * files, the reverb above all, are the same every time now.
 */
async function renderGroups(
  project: Project,
  groups: Group[],
  options: RenderOptions,
): Promise<Rendered> {
  if (!groups.length) return { parts: [], report: null };

  const sampleRate = options.sampleRate ?? 48000;
  const seconds = lengthFor(project, groups.flatMap((g) => g.cues), options);
  const frames = Math.max(1, Math.ceil(seconds * sampleRate));

  const parts: Part[] = [];
  for (const group of groups) {
    parts.push({
      id: group.id,
      name: group.name,
      buffer: await renderCues(project, group.cues, frames, sampleRate, options.settings),
    });
  }

  if (!options.master || (!options.master.limit && options.master.target === null)) {
    return { parts, report: null };
  }

  const mix = parts.length === 1 ? parts[0].buffer : sum(parts, frames, sampleRate);
  const plan = planMaster(mix, options.master);
  const master: Master = plan;

  return {
    parts: parts.map((part) => ({ ...part, buffer: applyMaster(part.buffer, master) })),
    report: plan.report,
  };
}

/** How long every file in a set has to be, so they stay in sync with each other. */
function lengthFor(project: Project, cues: readonly Cue[], options: RenderOptions): number {
  // Long enough for the video, plus whatever is still ringing at the end.
  const lastSound = cues.reduce(
    (max, cue) => Math.max(max, cueStart(cue) + Math.max(cueLength(cue), 2)),
    0,
  );
  return options.trimToDuration
    ? Math.max(project.duration, 0.1)
    : Math.max(project.duration, lastSound) + TAIL;
}

async function renderCues(
  project: Project,
  cues: readonly Cue[],
  frames: number,
  sampleRate: number,
  settings: ChainSettings,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const chain = buildChain(ctx, settings);
  chain.output.connect(ctx.destination);

  const seconds = frames / sampleRate;
  // Written in one pass here, since the whole file is known in advance.
  const buses = new Map<string, GainNode>();
  syncLayerBuses(ctx, project, chain.input, buses);
  scheduleLayerLevels(buses, project, 0, 0, seconds);

  for (const cue of cues) {
    const at = cueStart(cue);
    if (at >= seconds) continue;
    playCue(ctx, buses.get(cue.layerId) ?? chain.input, cue, at, cueGain(project, cue));
  }

  return ctx.startRendering();
}

function sum(parts: readonly Part[], frames: number, sampleRate: number): AudioBuffer {
  const out = new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate });
  for (let c = 0; c < 2; c++) {
    const to = out.getChannelData(c);
    for (const part of parts) {
      const from = part.buffer.getChannelData(Math.min(c, part.buffer.numberOfChannels - 1));
      for (let i = 0; i < frames; i++) to[i] += from[i];
    }
  }
  return out;
}
