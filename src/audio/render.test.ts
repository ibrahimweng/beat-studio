import { describe, expect, it } from 'vitest';
import { emptyProject } from '../timeline/project.ts';
import type { Cue, Project } from '../timeline/types.ts';
import { DEFAULT_CHAIN } from './chain.ts';
import { renderProject, renderStems } from './render.ts';

/**
 * The graph, rendered and measured.
 *
 * Everything else in this folder that is tested is arithmetic on the way to
 * the graph -- which sound belongs on which moment, what a curve describes.
 * This is the graph itself: a project goes in and samples come out, and the
 * claims worth checking are about where a sound lands, how loud it is, and
 * whether the things that are supposed to silence it do.
 *
 * They matter because this is the export path. What `renderProject` produces
 * is what gets written to the file somebody drops on a track, so "the cue is
 * at 1.2 seconds" is not an internal detail, it is the deliverable. Nothing
 * here is performed or captured: it is an offline render, so the same project
 * gives the same samples every time and a measurement is exact rather than
 * approximate.
 */

const RATE = 48_000;

/*
 * Rendering is not instant, even offline.
 *
 * Each of these builds the full chain -- a convolver with a two second
 * impulse among it -- and renders several seconds through it, which is a few
 * seconds of work rather than a few milliseconds. The default five is for
 * tests that are arithmetic.
 */
const SLOW = 60_000;

/** A design voice, which is synthesised, so no file has to be found first. */
function cue(over: Partial<Cue> & { id: string; time: number; layerId: string }): Cue {
  return {
    source: { kind: 'design', name: 'impact' },
    gain: 1,
    tune: 0,
    length: 0.6,
    anchor: 'start',
    space: 0,
    drive: 0,
    vary: 0,
    muted: false,
    ...over,
  };
}

/** A project of a given length with these cues on its first layer. */
function project(seconds: number, cues: Cue[], over: Partial<Project> = {}): Project {
  const base = emptyProject();
  return { ...base, duration: seconds, cues, ...over };
}

/** The layer ids a fresh project starts with. */
const LAYERS = emptyProject().layers.map((layer) => layer.id);

/** Loudest sample anywhere in a stretch of the render, both channels. */
function peak(buffer: AudioBuffer, from = 0, to = buffer.length): number {
  let most = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let at = Math.max(0, from); at < Math.min(samples.length, to); at += 1) {
      const size = Math.abs(samples[at]);
      if (size > most) most = size;
    }
  }
  return most;
}

/**
 * The moment the render stops being silent, in seconds.
 *
 * A threshold rather than the first non-zero sample: a convolver fed silence
 * still writes denormal-sized numbers, and the question being asked is when a
 * sound starts rather than when the arithmetic does.
 */
function firstSound(buffer: AudioBuffer, floor = 0.005): number | null {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  for (let at = 0; at < left.length; at += 1) {
    if (Math.abs(left[at]) > floor || Math.abs(right[at]) > floor) return at / buffer.sampleRate;
  }
  return null;
}

const render = (one: Project, over: Partial<Parameters<typeof renderProject>[1]> = {}) =>
  renderProject(one, { settings: DEFAULT_CHAIN, sampleRate: RATE, ...over });

describe('where a sound lands', () => {
  /*
   * The claim the export is built on, checked against the samples.
   *
   * "Every cue lands on the exact sample its time works out to" is what makes
   * the exported file line up when it is dropped on a track at zero. A drift
   * of a frame or two would be inaudible on its own and wrong against
   * picture, which is the whole job.
   */
  it('starts a cue at the time it is placed', async () => {
    const { parts } = await render(project(4, [cue({ id: 'c1', time: 1.25, layerId: LAYERS[0] })]));
    const at = firstSound(parts[0].buffer);

    expect(at, 'something sounded').not.toBeNull();
    // Within a millisecond: the voice's own attack is not instantaneous, so
    // the first sample over the floor is a hair late by construction.
    expect(at!).toBeGreaterThanOrEqual(1.25);
    expect(at!).toBeLessThan(1.26);
  });

  it('leaves silence before it', async () => {
    const { parts } = await render(project(4, [cue({ id: 'c1', time: 1.25, layerId: LAYERS[0] })]));
    const before = Math.floor(1.2 * RATE);
    expect(peak(parts[0].buffer, 0, before), 'nothing before the cue').toBeLessThan(0.005);
  });

  /*
   * A cue anchored to its end finishes on its marker rather than starting on
   * it, so it has to begin one length earlier. That is the rule the whole
   * "anchor" idea rests on: a riser is placed against the hit it leads into.
   */
  it('starts an end-anchored cue a length before its marker', async () => {
    const { parts } = await render(
      project(4, [cue({ id: 'c1', time: 2, layerId: LAYERS[0], anchor: 'end', length: 0.8 })]),
    );
    const at = firstSound(parts[0].buffer);

    expect(at, 'something sounded').not.toBeNull();
    expect(at!, 'it begins a length before the marker').toBeGreaterThanOrEqual(1.2);
    expect(at!).toBeLessThan(1.25);
  });
});

describe('what silences a sound', () => {
  it('a muted cue makes no sound at all', async () => {
    const { parts } = await render(
      project(3, [cue({ id: 'c1', time: 0.5, layerId: LAYERS[0], muted: true })]),
    );
    // Still a file, and still the right length: a mix is always rendered, and
    // a silent one is the correct answer to a project with nothing audible on
    // it. What is being checked is that nothing sounds, not that nothing ran.
    expect(parts, 'a mix is still produced').toHaveLength(1);
    expect(peak(parts[0].buffer), 'and it is silent').toBeLessThan(1e-4);
  });

  it('a muted layer silences what is on it', async () => {
    const one = project(3, [cue({ id: 'c1', time: 0.5, layerId: LAYERS[0] })]);
    const silenced: Project = {
      ...one,
      layers: one.layers.map((layer) =>
        layer.id === LAYERS[0] ? { ...layer, muted: true } : layer,
      ),
    };
    expect(peak((await render(silenced)).parts[0].buffer), 'silent while muted')
      .toBeLessThan(1e-4);
    expect(peak((await render(one)).parts[0].buffer), 'and audible when it is not')
      .toBeGreaterThan(0.01);
  });

  /*
   * Solo is the other half of mute and the half that is easy to get wrong:
   * it silences everything that is not soloed, including layers nobody
   * touched.
   */
  it('solo on one layer silences the others', async () => {
    const one = project(3, [
      cue({ id: 'c1', time: 0.4, layerId: LAYERS[0] }),
      cue({ id: 'c2', time: 1.6, layerId: LAYERS[1] }),
    ]);
    const soloed: Project = {
      ...one,
      layers: one.layers.map((layer) => (layer.id === LAYERS[1] ? { ...layer, solo: true } : layer)),
    };

    const { parts } = await render(soloed);
    const first = Math.floor(1.2 * RATE);
    expect(peak(parts[0].buffer, 0, first), 'the layer that is not soloed is gone')
      .toBeLessThan(0.005);
    expect(peak(parts[0].buffer, first), 'the soloed one is still there').toBeGreaterThan(0.01);
  });
});

describe('how loud a sound is', () => {
  it('a quieter cue renders quieter', async () => {
    const loud = await render(project(3, [cue({ id: 'c1', time: 0.5, layerId: LAYERS[0] })]));
    const soft = await render(
      project(3, [cue({ id: 'c1', time: 0.5, layerId: LAYERS[0], gain: 0.25 })]),
    );

    const one = peak(loud.parts[0].buffer);
    const other = peak(soft.parts[0].buffer);
    expect(one, 'the loud one is audible').toBeGreaterThan(0.01);
    expect(other, 'the quiet one is quieter').toBeLessThan(one * 0.6);
    expect(other, 'but not silent').toBeGreaterThan(0);
  });

  it('a layer turned down turns down what is on it', async () => {
    const one = project(3, [cue({ id: 'c1', time: 0.5, layerId: LAYERS[0] })]);
    const down: Project = {
      ...one,
      layers: one.layers.map((layer) => (layer.id === LAYERS[0] ? { ...layer, gain: 0.2 } : layer)),
    };

    const full = peak((await render(one)).parts[0].buffer);
    const quiet = peak((await render(down)).parts[0].buffer);
    expect(quiet).toBeLessThan(full * 0.6);
    expect(quiet).toBeGreaterThan(0);
  });
});

describe('the same sound twice', () => {
  /*
   * A placed sound is one sound, not a new one each time it is heard.
   *
   * The noise a voice is built from is drawn from the cue's own id, so
   * auditioning it, playing the timeline and exporting all produce the same
   * thing. Without that a set of stems adds up to the mix only nearly, and
   * "nearly" in a sum of noise is audible.
   */
  it('renders identically from the same project', async () => {
    const one = project(3, [cue({ id: 'fixed', time: 0.5, layerId: LAYERS[0], vary: 0.8 })]);
    const first = (await render(one)).parts[0].buffer.getChannelData(0);
    const again = (await render(one)).parts[0].buffer.getChannelData(0);

    expect(again.length).toBe(first.length);
    let worst = 0;
    for (let at = 0; at < first.length; at += 1) {
      worst = Math.max(worst, Math.abs(first[at] - again[at]));
    }
    expect(worst, 'sample for sample the same').toBe(0);
  });

  /*
   * And the other half of it: two placements of the same sound are meant to
   * differ, drawn from their own ids. A seed that is not actually read would
   * pass the test above and fail this one.
   */
  it('differs between two placements of the same sound', async () => {
    const settings = { time: 0.5, layerId: LAYERS[0], vary: 1 };
    const one = (await render(project(3, [cue({ id: 'aaa', ...settings })]))).parts[0].buffer;
    const other = (await render(project(3, [cue({ id: 'zzz', ...settings })]))).parts[0].buffer;

    const first = one.getChannelData(0);
    const second = other.getChannelData(0);
    let worst = 0;
    for (let at = 0; at < first.length; at += 1) {
      worst = Math.max(worst, Math.abs(first[at] - second[at]));
    }
    expect(worst, 'two takes of the same sound are not the same file').toBeGreaterThan(0.001);
  });
});

describe('stems', () => {
  /*
   * The claim in `renderStems`: the stems add back up to the mix.
   *
   * Somebody handed a set of stems balances them against each other and
   * expects that starting position to be the mix they were shown. Every part
   * of the chain that carries between files -- the reverb above all -- has to
   * be identical in each, which is the part that would not be true if the
   * noise were drawn fresh per render.
   */
  it('add back up to the mix', { timeout: SLOW }, async () => {
    const one = project(4, [
      cue({ id: 'c1', time: 0.4, layerId: LAYERS[0] }),
      cue({ id: 'c2', time: 1.1, layerId: LAYERS[1], source: { kind: 'design', name: 'whoosh' } }),
      cue({ id: 'c3', time: 2.2, layerId: LAYERS[0], source: { kind: 'design', name: 'sub' } }),
    ]);

    const mix = (await render(one)).parts;
    const stems = (await renderStems(one, { settings: DEFAULT_CHAIN, sampleRate: RATE })).parts;

    expect(mix, 'one mixed file').toHaveLength(1);
    expect(stems.length, 'a file per layer that has something on it').toBeGreaterThan(1);

    const mixed = mix[0].buffer;
    expect(peak(mixed), 'the mix is audible').toBeGreaterThan(0.01);

    for (let channel = 0; channel < mixed.numberOfChannels; channel += 1) {
      const wanted = mixed.getChannelData(channel);
      /*
       * Read once per channel, not once per sample.
       *
       * `getChannelData` hands back a copy here rather than a view onto the
       * buffer, so calling it inside the loop turned a sum over a few hundred
       * thousand samples into a minute of copying. Cheap in a browser, not
       * cheap everywhere.
       */
      const each = stems.map((stem) => stem.buffer.getChannelData(channel));
      let worst = 0;
      for (let at = 0; at < wanted.length; at += 1) {
        let sum = 0;
        for (const samples of each) sum += samples[at];
        worst = Math.max(worst, Math.abs(sum - wanted[at]));
      }
      // Not exact: the stems are summed in a different order from the graph's
      // own mix, and float addition is not associative. A thousandth is far
      // below anything audible and far above the error.
      expect(worst, `channel ${channel} adds back up`).toBeLessThan(0.001);
    }
  });

  it('are all the same length, so they stay lined up', async () => {
    const one = project(4, [
      cue({ id: 'c1', time: 0.4, layerId: LAYERS[0] }),
      cue({ id: 'c2', time: 3.5, layerId: LAYERS[1] }),
    ]);
    const { parts } = await renderStems(one, { settings: DEFAULT_CHAIN, sampleRate: RATE });

    const lengths = new Set(parts.map((part) => part.buffer.length));
    expect(lengths.size, `lengths were ${[...lengths]}`).toBe(1);
  });
});

describe('how long the file is', () => {
  /*
   * A tail is allowed to finish by default, which is why the file is longer
   * than the video. `trimToDuration` is for the case where it must not be.
   */
  it('runs past the video so a tail is not cut off', async () => {
    const one = project(2, [cue({ id: 'c1', time: 1.5, layerId: LAYERS[0], length: 1.5 })]);
    const { parts } = await render(one);
    expect(parts[0].buffer.length / RATE, 'there is room for the tail').toBeGreaterThan(2);
  });

  it('stops at the video when it is asked to', async () => {
    const one = project(2, [cue({ id: 'c1', time: 1.5, layerId: LAYERS[0], length: 1.5 })]);
    const { parts } = await render(one, { trimToDuration: true });
    expect(parts[0].buffer.length / RATE, 'exactly the video').toBeCloseTo(2, 3);
  });

  it('always starts at zero, whatever is on it', async () => {
    const late = project(5, [cue({ id: 'c1', time: 4, layerId: LAYERS[0] })]);
    const { parts } = await render(late);
    // A file that started at the first sound would line up nowhere.
    expect(firstSound(parts[0].buffer)!, 'the silence at the front is kept')
      .toBeGreaterThan(3.9);
  });
});
