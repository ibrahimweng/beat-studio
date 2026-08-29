import { describe, expect, it } from 'vitest';
import { MOMENT_TITLES, suggestFor } from './suggest.ts';
import { entryById } from './catalogue.ts';
import type { Moment, MomentKind } from '../video/moments.ts';
import { emptyProject } from '../timeline/project.ts';
import { DESIGN_DEFAULT_ANCHOR, DESIGN_NAMES } from '../timeline/types.ts';
import type { DesignName } from '../timeline/types.ts';

const KINDS: readonly MomentKind[] = [
  'appears',
  'builds',
  'moves',
  'lands',
  'sequence',
  'quiet',
];

const FPS = 25;

function moment(kind: MomentKind, over: Partial<Moment> = {}): Moment {
  return {
    id: 'm1.000',
    t: 1,
    span: kind === 'moves' ? 0.9 : kind === 'quiet' ? 5 : 0,
    kind,
    energy: 0.5,
    strength: 0.5,
    hits: kind === 'quiet' ? [] : kind === 'sequence' ? [1, 1.2, 1.4, 1.6] : [1],
    ...over,
  };
}

describe('what every kind of moment is offered', () => {
  it.each(KINDS)('has a name, a reason and something to place: %s', (kind) => {
    const suggested = suggestFor(moment(kind), FPS);
    expect(suggested.name.trim()).not.toBe('');
    expect(suggested.parts.length).toBeGreaterThan(0);
    // The sentence is the whole teaching plan, so an empty or stub one is a
    // failure rather than a cosmetic gap.
    expect(suggested.why.length).toBeGreaterThan(60);
    expect(suggested.why.trim().endsWith('.')).toBe(true);
  });

  it.each(KINDS)('names a voice this app actually has: %s', (kind) => {
    for (const part of suggestFor(moment(kind), FPS).parts) {
      expect(part.source.kind).toBe('design');
      expect(DESIGN_NAMES).toContain(part.source.name as DesignName);
      for (const stacked of part.source.with ?? []) {
        expect(DESIGN_NAMES).toContain(stacked.name as DesignName);
      }
    }
  });

  it.each(KINDS)('names a layer the project starts with: %s', (kind) => {
    /*
     * A layer id that does not exist would put the sound on a lane nothing
     * draws and nothing exports, and the only sign of it would be silence.
     */
    const layers = new Set(emptyProject().layers.map((layer) => layer.id));
    for (const part of suggestFor(moment(kind), FPS).parts) {
      expect(layers.has(part.layerId)).toBe(true);
    }
  });

  it.each(KINDS)('resolves every library entry it asks for: %s', (kind) => {
    /*
     * The entries are addressed by a name built out of a voice, a size and a
     * place. One wrong word in any of those resolves to nothing, and the cue
     * quietly falls back to the plain voice: a worse suggestion, with nothing
     * on screen to say so. This is the check that catches that.
     */
    for (const part of suggestFor(moment(kind), FPS).parts) {
      expect(part.preset, `${kind} asked for a library entry that does not exist`).not.toBeNull();
      expect(entryById(part.preset!.id)).not.toBeNull();
    }
  });

  it('has a title for every kind', () => {
    for (const kind of KINDS) {
      expect(MOMENT_TITLES[kind]).toBeTruthy();
    }
  });
});

describe('a build', () => {
  it('puts down a riser and the hit it arrives at, as two sounds', () => {
    /*
     * They cannot be one. A riser is anchored to where it ends and the hit to
     * where it starts, and one cue has one anchor.
     */
    const { parts } = suggestFor(moment('builds'), FPS);
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.source.name)).toEqual(['riser', 'impact']);
    // Both land on the moment itself.
    expect(parts.every((p) => p.at === 0)).toBe(true);
  });

  it('reaches for a voice that finishes on the marker rather than starting on it', () => {
    const [riser] = suggestFor(moment('builds'), FPS).parts;
    // The one mistake everybody new to this makes, settled in the data rather
    // than left to the person placing it.
    expect(DESIGN_DEFAULT_ANCHOR[riser.source.name as DesignName]).toBe('end');
  });
});

describe('a sequence', () => {
  it('puts one sound on each hit, at the time that hit happened', () => {
    const hits = [2, 2.2, 2.45, 2.6];
    const { parts } = suggestFor(moment('sequence', { t: 2, hits }), FPS);
    expect(parts).toHaveLength(hits.length);
    expect(parts.map((p) => Number((p.at + 2).toFixed(3)))).toEqual(hits);
  });

  it('thins them out, so the run reads as one flourish', () => {
    const { parts } = suggestFor(moment('sequence', { hits: [1, 1.2, 1.4, 1.6] }), FPS);
    const gains = parts.map((p) => p.gain!);
    expect(gains[0]).toBe(1);
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]).toBeLessThan(gains[i - 1]);
    }
    // Quieter, not gone.
    expect(gains[gains.length - 1]).toBeGreaterThan(0.4);
  });

  it('survives a sequence of one, rather than dividing by nothing', () => {
    const { parts } = suggestFor(moment('sequence', { hits: [1] }), FPS);
    expect(parts).toHaveLength(1);
    expect(Number.isFinite(parts[0].gain!)).toBe(true);
  });
});

describe('sounds cut to the picture', () => {
  it('makes a whoosh as long as the move it covers', () => {
    const { parts } = suggestFor(moment('moves', { span: 1.4 }), FPS);
    expect(parts[0].length).toBeCloseTo(1.4, 5);
  });

  it('makes a bed as long as the stretch it sits under', () => {
    const { parts } = suggestFor(moment('quiet', { span: 6.2 }), FPS);
    expect(parts[0].length).toBeCloseTo(6.2, 5);
    // Under everything else, since it is the thing nobody should notice.
    expect(parts[0].gain!).toBeLessThan(0.6);
  });

  it('gives a move with no measured length something to be', () => {
    const { parts } = suggestFor(moment('moves', { span: 0 }), FPS);
    expect(parts[0].length).toBeGreaterThan(0);
  });
});

describe('the size of a sound follows how much the moment stood out', () => {
  it('reaches for something bigger as the moment gets stronger', () => {
    const small = suggestFor(moment('appears', { strength: 0.1 }), FPS);
    const large = suggestFor(moment('appears', { strength: 0.95 }), FPS);
    expect(small.name).not.toBe(large.name);
    // Both still resolve, at either end of the range.
    expect(small.parts[0].preset).not.toBeNull();
    expect(large.parts[0].preset).not.toBeNull();
  });

  it('stays inside the library at the very edges', () => {
    for (const strength of [0, 1]) {
      for (const kind of KINDS) {
        for (const part of suggestFor(moment(kind, { strength }), FPS).parts) {
          expect(part.preset).not.toBeNull();
        }
      }
    }
  });
});

describe('the sentence names what it is about', () => {
  it('counts the hits in a sequence', () => {
    const { why } = suggestFor(moment('sequence', { hits: [1, 1.2, 1.4], span: 0.4 }), FPS);
    expect(why).toContain('3 hits');
    // In frames, because that is the unit the person reading this works in.
    expect(why).toContain('frames');
  });

  it('says how long a quiet stretch runs for', () => {
    expect(suggestFor(moment('quiet', { span: 6 }), FPS).why).toContain('6 seconds');
  });

  it('reads naturally for a stretch under a second', () => {
    expect(suggestFor(moment('moves', { span: 0.4 }), FPS).why).toContain('of a second');
  });
});
