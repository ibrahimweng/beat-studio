import { describe, expect, it } from 'vitest';
import { DESIGN_NAMES } from '../timeline/types.ts';
import { designSpec } from './design-voices.ts';
import { varySpec } from './vary.ts';
import type { LayerSpec, VoiceSpec } from './voice-spec.ts';

/**
 * A second take of the same sound.
 *
 * Placing one sound six times used to give six copies of one file, which is
 * the fault this exists for: a footstep laid down a dozen times reads as a
 * loop rather than as somebody walking. So each placement draws a take of its
 * own from its own id.
 *
 * Every way it can go wrong is quiet. Varying nothing brings back the loop.
 * Varying too much makes a sound that is not the one you chose. Varying the
 * timing rather than the shape moves it off the frame it was placed on, which
 * is the whole job of the app. And varying from anything other than the id
 * means the file you export is not what you heard.
 */

const options = { length: 0.5, tune: 0, gain: 1 };
const subject = (): VoiceSpec => designSpec('impact', options);

/** Every number in a spec, flattened, so two takes can be compared at all. */
function numbers(spec: VoiceSpec): number[] {
  const out: number[] = [spec.duration];
  const walk = (value: unknown): void => {
    if (typeof value === 'number') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  spec.layers.forEach(walk);
  spec.effects?.forEach(walk);
  return out;
}

const same = (a: VoiceSpec, b: VoiceSpec): boolean =>
  JSON.stringify(numbers(a)) === JSON.stringify(numbers(b));

describe('varying a sound', () => {
  it('leaves it exactly alone at nothing, not nearly alone', () => {
    for (const name of DESIGN_NAMES) {
      const spec = designSpec(name, options);
      expect(varySpec(spec, 0, 1234), `${name} at zero`).toBe(spec);
      expect(varySpec(spec, -1, 1234), `${name} below zero`).toBe(spec);
    }
  });

  it('gives the same take from the same id, every time', () => {
    for (const name of DESIGN_NAMES) {
      const spec = designSpec(name, options);
      const once = varySpec(spec, 0.5, 99);
      const again = varySpec(spec, 0.5, 99);
      expect(same(once, again), `${name} drew two different takes from one id`).toBe(true);
    }
  });

  it('gives a different take from a different id', () => {
    const unchanged: string[] = [];
    for (const name of DESIGN_NAMES) {
      const spec = designSpec(name, options);
      if (same(varySpec(spec, 1, 1), varySpec(spec, 1, 2))) unchanged.push(name);
    }
    expect(unchanged, `${unchanged.length} voices gave one take whatever the id`).toEqual([]);
  });

  /*
   * The one that matters against picture.
   *
   * A varied sound is faster or slower inside itself, not longer or shorter:
   * the envelope moves and the layer still runs for exactly as long as it was
   * asked to. If that stopped holding, a placed sound would drift off the
   * frame it was put on, and it would drift by a different amount for every
   * placement -- which is the hardest kind of fault to see and the worst kind
   * to have in an app that exists to land sounds on frames.
   */
  it('does not change how long the sound runs', () => {
    const moved: string[] = [];
    for (const name of DESIGN_NAMES) {
      const spec = designSpec(name, options);
      for (const seed of [1, 2, 3, 40, 500]) {
        const varied = varySpec(spec, 1, seed);
        if (varied.duration !== spec.duration) {
          moved.push(`${name} at seed ${seed}: ${spec.duration} became ${varied.duration}`);
        }
        varied.layers.forEach((layer: LayerSpec, at: number) => {
          if (layer.delay !== spec.layers[at].delay) {
            moved.push(`${name} layer ${at} at seed ${seed}: delay moved`);
          }
        });
      }
    }
    expect(moved, `${moved.length} varied takes moved off their place`).toEqual([]);
  });

  it('keeps the same number of layers, so it is still the sound you chose', () => {
    const wrong: string[] = [];
    for (const name of DESIGN_NAMES) {
      const spec = designSpec(name, options);
      const varied = varySpec(spec, 1, 7);
      if (varied.layers.length !== spec.layers.length) wrong.push(name);
    }
    expect(wrong, `${wrong.length} varied takes gained or lost a layer`).toEqual([]);
  });

  it('varies more when it is asked for more', () => {
    const spec = subject();
    const little = numbers(varySpec(spec, 0.1, 11));
    const lots = numbers(varySpec(spec, 1, 11));
    const plain = numbers(spec);
    const drift = (take: number[]): number =>
      take.reduce((most, value, at) => Math.max(most, Math.abs(value - plain[at])), 0);
    expect(drift(lots), 'a full take moves further than a tenth of one')
      .toBeGreaterThan(drift(little));
  });
});
