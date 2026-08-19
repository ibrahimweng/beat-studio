import { audibleCues, cueGain, cueLength, cueStart } from '../timeline/project.ts';
import type { Cue, Project } from '../timeline/types.ts';
import { buildChain, type ChainSettings } from './chain.ts';
import { playCue } from './sources.ts';

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
}

export interface Stem {
  layerId: string;
  layerName: string;
  buffer: AudioBuffer;
}

/**
 * Render cues to audio, faster than real time.
 *
 * This is the reason the export lines up. Nothing is performed and nothing is
 * captured through a microphone path, so every cue lands on the exact sample
 * its time works out to, and the file always starts at zero. Drop it on a
 * track at the start of the composition and it is in sync.
 */
export async function renderProject(
  project: Project,
  options: RenderOptions,
): Promise<AudioBuffer> {
  return renderCues(project, audibleCues(project), options);
}

/**
 * Render one file per layer, all the same length and all starting at zero.
 * Layer levels are applied, so the stems add back up to the mix.
 */
export async function renderStems(
  project: Project,
  options: RenderOptions,
): Promise<Stem[]> {
  const heard = audibleCues(project);
  const stems: Stem[] = [];

  for (const layer of project.layers) {
    const cues = heard.filter((c) => c.layerId === layer.id);
    if (!cues.length) continue;
    stems.push({
      layerId: layer.id,
      layerName: layer.name,
      buffer: await renderCues(project, cues, options),
    });
  }

  return stems;
}

async function renderCues(
  project: Project,
  cues: readonly Cue[],
  options: RenderOptions,
): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 48000;

  // Long enough for the video, plus whatever is still ringing at the end.
  const lastSound = cues.reduce(
    (max, cue) => Math.max(max, cueStart(cue) + Math.max(cueLength(cue), 2)),
    0,
  );
  const seconds = options.trimToDuration
    ? Math.max(project.duration, 0.1)
    : Math.max(project.duration, lastSound) + TAIL;

  const frames = Math.max(1, Math.ceil(seconds * sampleRate));
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const chain = buildChain(ctx, options.settings);
  chain.output.connect(ctx.destination);

  for (const cue of cues) {
    const at = cueStart(cue);
    if (at >= seconds) continue;
    playCue(ctx, chain.input, cue, at, cueGain(project, cue));
  }

  return ctx.startRendering();
}
