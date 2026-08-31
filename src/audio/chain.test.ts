import { describe, expect, it } from 'vitest';
import { emptyProject } from '../timeline/project.ts';
import type { Cue, Project } from '../timeline/types.ts';
import { DEFAULT_CHAIN, type ChainSettings } from './chain.ts';
import { CEILING, measureLoudness } from './master.ts';
import { renderProject } from './render.ts';

/**
 * The mixer and the master, measured on the way out.
 *
 * The render tests next door check where a sound lands and how loud it is
 * relative to another. They pass the chain settings through without ever
 * asking what the chain does with them, so everything between the voice and
 * the file — three bands of EQ, a tilt, a reverb send, a room, the level, and
 * then the loudness and the limiter — was exercised only as far as "something
 * came out".
 *
 * That is the part of this app somebody hands to a client. What it is worth
 * checking is that each control moves what it says it moves, and that the
 * master lands where it says it landed: the interface prints "-18.0 LUFS" off
 * the report, and a report that does not describe the samples is worse than
 * no report.
 */

const RATE = 48_000;
const SLOW = 60_000;

const LAYERS = emptyProject().layers.map((layer) => layer.id);

function cue(over: Partial<Cue> & { id: string; time: number }): Cue {
  return {
    layerId: LAYERS[0],
    source: { kind: 'design', name: 'impact' },
    gain: 1,
    tune: 0,
    length: 0.5,
    anchor: 'start',
    space: 0,
    drive: 0,
    vary: 0,
    muted: false,
    ...over,
  };
}

function piece(seconds: number, cues: Cue[]): Project {
  return { ...emptyProject(), duration: seconds, cues };
}

const settings = (over: Partial<ChainSettings> = {}): ChainSettings => ({ ...DEFAULT_CHAIN, ...over });

const render = (project: Project, chain: Partial<ChainSettings> = {}, master?: { limit: boolean; target: number | null }) =>
  renderProject(project, {
    settings: settings(chain),
    sampleRate: RATE,
    ...(master ? { master } : {}),
  });

/** Loudest sample anywhere, both channels. */
function peak(buffer: AudioBuffer, from = 0, to = buffer.length): number {
  let most = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let at = Math.max(0, from); at < Math.min(samples.length, to); at += 1) {
      most = Math.max(most, Math.abs(samples[at]));
    }
  }
  return most;
}

/** How much signal there is over a stretch, which is what a tail is made of. */
function energy(buffer: AudioBuffer, from = 0, to = buffer.length): number {
  const samples = buffer.getChannelData(0);
  let sum = 0;
  let n = 0;
  for (let at = Math.max(0, from); at < Math.min(samples.length, to); at += 1) {
    sum += samples[at] * samples[at];
    n += 1;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/**
 * How much of a render sits in one part of the spectrum.
 *
 * By running it back through a filter rather than by transforming it: the
 * question is only ever "more or less than the other one", the filters are
 * the same ones the mixer is built from, and a comparison between two renders
 * measured the same way does not care about the filter's own shape.
 */
async function inBand(buffer: AudioBuffer, type: BiquadFilterType, freq: number): Promise<number> {
  const ctx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  source.connect(filter);
  filter.connect(ctx.destination);
  source.start();
  return energy(await ctx.startRendering());
}

describe('the level', () => {
  it('turns the whole thing down', async () => {
    const one = piece(3, [cue({ id: 'c1', time: 0.4 })]);
    const loud = peak((await render(one, { vol: 0.8 })).parts[0].buffer);
    const quiet = peak((await render(one, { vol: 0.2 })).parts[0].buffer);

    expect(loud).toBeGreaterThan(0.01);
    // A quarter of the level, within the tolerance a chain of filters allows.
    expect(quiet / loud).toBeGreaterThan(0.2);
    expect(quiet / loud).toBeLessThan(0.3);
  });

  it('at zero, nothing comes out', async () => {
    const one = piece(3, [cue({ id: 'c1', time: 0.4 })]);
    expect(peak((await render(one, { vol: 0 })).parts[0].buffer)).toBeLessThan(1e-6);
  });
});

describe('the three bands', () => {
  /*
   * A broadband source, since a band that is not there cannot be turned up.
   * `static` is noise by construction, which is the one voice that has
   * something at every frequency to move.
   */
  const noisy = () =>
    piece(3, [cue({ id: 'c1', time: 0.3, source: { kind: 'design', name: 'static' }, length: 1 })]);

  it('the low band moves the bottom and leaves the top', async () => {
    const flat = (await render(noisy())).parts[0].buffer;
    const up = (await render(noisy(), { low: 1 })).parts[0].buffer;

    const bottomFlat = await inBand(flat, 'lowpass', 180);
    const bottomUp = await inBand(up, 'lowpass', 180);
    const topFlat = await inBand(flat, 'highpass', 6000);
    const topUp = await inBand(up, 'highpass', 6000);

    expect(bottomUp, 'the bottom came up').toBeGreaterThan(bottomFlat * 1.5);
    expect(topUp / topFlat, 'the top stayed where it was').toBeGreaterThan(0.8);
    expect(topUp / topFlat).toBeLessThan(1.25);
  });

  it('the high band moves the top and leaves the bottom', async () => {
    const flat = (await render(noisy())).parts[0].buffer;
    const up = (await render(noisy(), { high: 1 })).parts[0].buffer;

    expect(await inBand(up, 'highpass', 6000), 'the top came up')
      .toBeGreaterThan((await inBand(flat, 'highpass', 6000)) * 1.5);
    const bottom = (await inBand(up, 'lowpass', 180)) / (await inBand(flat, 'lowpass', 180));
    expect(bottom, 'the bottom stayed where it was').toBeGreaterThan(0.8);
    expect(bottom).toBeLessThan(1.25);
  });

  it('cutting a band takes it away rather than adding elsewhere', async () => {
    const flat = (await render(noisy())).parts[0].buffer;
    const down = (await render(noisy(), { low: 0 })).parts[0].buffer;

    expect(await inBand(down, 'lowpass', 180)).toBeLessThan(await inBand(flat, 'lowpass', 180));
  });

  /*
   * Tone is one control across two bands, which is what makes it a tilt: it
   * has to move them in opposite directions rather than moving one.
   */
  it('the tone tilts the top against the bottom', async () => {
    const noisyOne = noisy();
    const dark = (await render(noisyOne, { tone: 0 })).parts[0].buffer;
    const bright = (await render(noisyOne, { tone: 1 })).parts[0].buffer;

    const darkRatio = (await inBand(dark, 'highpass', 6000)) / (await inBand(dark, 'lowpass', 180));
    const brightRatio = (await inBand(bright, 'highpass', 6000)) / (await inBand(bright, 'lowpass', 180));

    expect(brightRatio, 'bright has more top for its bottom than dark does')
      .toBeGreaterThan(darkRatio * 1.5);
  });
});

describe('the room', () => {
  /*
   * A tail is what is still there after the sound has stopped, so it is
   * measured where there is nothing else: a short hit early on, and a look at
   * a stretch well after it could still be sounding on its own.
   */
  const shortHit = () => piece(4, [cue({ id: 'c1', time: 0.2, length: 0.2 })]);
  const afterwards = (buffer: AudioBuffer) =>
    energy(buffer, Math.floor(1.2 * RATE), Math.floor(2.2 * RATE));

  it('the send is what puts a tail after the sound', async () => {
    const dry = (await render(shortHit(), { reverb: 0 })).parts[0].buffer;
    const wet = (await render(shortHit(), { reverb: 0.8 })).parts[0].buffer;

    expect(afterwards(dry), 'dry, there is nothing ringing').toBeLessThan(1e-4);
    expect(afterwards(wet), 'wet, there is').toBeGreaterThan(afterwards(dry) * 10);
  });

  it('a bigger room rings for longer than a smaller one', async () => {
    const booth = (await render(shortHit(), { reverb: 0.8, room: 'booth' })).parts[0].buffer;
    const cathedral = (await render(shortHit(), { reverb: 0.8, room: 'cathedral' })).parts[0].buffer;

    expect(afterwards(cathedral), 'the cathedral is still going').toBeGreaterThan(afterwards(booth));
  });

  it('the send does not change the sound itself, only what follows it', async () => {
    const dry = (await render(shortHit(), { reverb: 0 })).parts[0].buffer;
    const wet = (await render(shortHit(), { reverb: 0.8 })).parts[0].buffer;

    // Over the hit itself, before the room has had time to say much back.
    const hit = [Math.floor(0.2 * RATE), Math.floor(0.26 * RATE)] as const;
    const ratio = energy(wet, hit[0], hit[1]) / energy(dry, hit[0], hit[1]);
    expect(ratio, 'the hit arrives at about the level it did').toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.3);
  });
});

describe('the master', () => {
  const busy = () =>
    piece(4, [
      cue({ id: 'c1', time: 0.3, gain: 1.4 }),
      cue({ id: 'c2', time: 1.1, gain: 1.4, layerId: LAYERS[1] }),
      cue({ id: 'c3', time: 2.0, gain: 1.4, source: { kind: 'design', name: 'sub' } }),
    ]);

  it('does nothing at all when it is asked to do nothing', async () => {
    const { report } = await render(busy(), {}, { limit: false, target: null });
    expect(report, 'no report, because nothing was done').toBeNull();
  });

  /*
   * The number the interface prints comes from the report, so the report has
   * to describe the samples rather than the intention.
   */
  it('lands on the loudness it was asked for, and says so truthfully', async () => {
    const { parts, report } = await render(busy(), {}, { limit: true, target: -18 });
    expect(report).not.toBeNull();

    const measured = measureLoudness(parts[0].buffer);
    expect(measured, 'the file is at the target').toBeCloseTo(-18, 0);
    expect(report!.after, 'and the report agrees with the file').toBeCloseTo(measured, 1);
  }, SLOW);

  it('a quieter target gives a quieter file', async () => {
    const loud = await render(busy(), {}, { limit: true, target: -14 });
    const quiet = await render(busy(), {}, { limit: true, target: -24 });

    expect(measureLoudness(loud.parts[0].buffer)).toBeGreaterThan(
      measureLoudness(quiet.parts[0].buffer) + 5,
    );
  }, SLOW);

  /*
   * The limiter's whole job: a piece pushed past the top comes back under the
   * ceiling rather than wrapping round into distortion.
   */
  it('holds the peaks under the ceiling', async () => {
    const shouted = piece(3, [
      cue({ id: 'c1', time: 0.3, gain: 1.5 }),
      cue({ id: 'c2', time: 0.3, gain: 1.5, layerId: LAYERS[1] }),
      cue({ id: 'c3', time: 0.32, gain: 1.5, layerId: LAYERS[2] }),
    ]);
    const { parts, report } = await render(shouted, { vol: 1 }, { limit: true, target: -9 });

    expect(peak(parts[0].buffer), 'nothing above the ceiling')
      .toBeLessThanOrEqual(CEILING + 1e-4);
    expect(report!.reductionDb, 'and it says it had to work').toBeGreaterThan(0);
    expect(report!.wouldHaveClipped, 'which it would have, left alone').toBe(true);
  }, SLOW);

  /*
   * The one that was wrong, and the number that gave it away.
   *
   * The limiter was handed a copy of the mix that had already been clamped to
   * plus or minus one, so however loud the mix really was it saw a peak of one
   * and asked for the single decibel that takes one down to the ceiling. A mix
   * at two and a half times full scale therefore came back hard clipped —
   * thousands of samples flat against the top — while the report claimed a
   * reduction of exactly 1.00 dB, which it did at every target that clipped.
   *
   * Checked at several targets because the fault only appeared once the gain
   * pushed the mix past full scale: quiet targets were always fine, which is
   * why nothing noticed.
   */
  it('does not clip however hard it is pushed', async () => {
    const shouted = piece(3, [
      cue({ id: 'c1', time: 0.3, gain: 1.5 }),
      cue({ id: 'c2', time: 0.31, gain: 1.5, layerId: LAYERS[1] }),
      cue({ id: 'c3', time: 0.32, gain: 1.5, layerId: LAYERS[2] }),
    ]);

    for (const target of [-14, -9, -6]) {
      const { parts, report } = await render(shouted, { vol: 1 }, { limit: true, target });
      const buffer = parts[0].buffer;

      let flat = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const samples = buffer.getChannelData(channel);
        for (let at = 0; at < samples.length; at += 1) if (Math.abs(samples[at]) >= 0.99999) flat += 1;
      }

      expect(flat, `at ${target} LUFS, samples flat against the top`).toBe(0);
      expect(peak(buffer), `at ${target} LUFS, above the ceiling`)
        .toBeLessThanOrEqual(CEILING + 1e-4);
      // The old fault reported exactly one decibel every time, because that is
      // what takes a clamped one down to the ceiling.
      expect(report!.reductionDb, `at ${target} LUFS, the reduction is real work`)
        .toBeGreaterThan(1.5);
    }
  }, SLOW);

  it('reports honestly that it never had to work when it did not', async () => {
    const quiet = piece(3, [cue({ id: 'c1', time: 0.3, gain: 0.2 })]);
    const { report } = await render(quiet, { vol: 0.3 }, { limit: true, target: -30 });

    expect(report!.reductionDb, 'nothing was held back').toBe(0);
    expect(report!.wouldHaveClipped).toBe(false);
  }, SLOW);
});
