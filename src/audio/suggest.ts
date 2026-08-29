/**
 * What sound belongs on a moment, and why.
 *
 * The other half of a suggestion. `video/moments.ts` says what kind of moment
 * something is by looking at the picture; this says what to put there by
 * looking at nothing but that answer. The two are apart because they are
 * different subjects: one is about a curve, the other is about a sound
 * library, and mixing them would leave the app unable to change either
 * without touching the other.
 *
 * Everything here is data. Nothing plays, nothing is scheduled, and nothing
 * touches the page, so the choice can be read, listed and reasoned about
 * before a single sound is made.
 *
 * The sentences matter as much as the sounds. Somebody who has edited video
 * for ten years and never put sound to it knows exactly what they are looking
 * at and has no idea what it needs. One line, about the frame in front of
 * them, at the moment it applies, is worth more than any amount of
 * documentation they will not open.
 */
import type { Moment, MomentKind } from '../video/moments.ts';
import type { CuePreset, CueSource } from '../timeline/types.ts';
import { entryById } from './catalogue.ts';

/** One cue a suggestion puts down. */
export interface SuggestedPart {
  /** Seconds from the moment's own time. Zero for all but a sequence. */
  at: number;
  source: CueSource;
  /** The library settings it arrives with, or null for the voice's own. */
  preset: CuePreset | null;
  layerId: string;
  /** Overrides the length, for a sound that has to cover a stretch of video. */
  length?: number;
  /** Level, where this part sits under the ones around it. */
  gain?: number;
}

export interface Suggested {
  /** What the panel calls it. */
  name: string;
  /** One sentence on why this belongs here. */
  why: string;
  /**
   * What placing it does. Usually one cue. Two for a build, because a riser
   * and the hit it arrives at are anchored to opposite ends of the same
   * moment and so cannot be one sound. One per hit for a sequence.
   */
  parts: readonly SuggestedPart[];
}

/**
 * Which group of the library serves each kind of moment.
 *
 * The link that lets somebody say "not that one, show me the others that
 * would work here". Without it a suggestion is take it or leave it, and
 * leaving it drops a newcomer into a thousand sounds with no idea where to
 * start; with it they land in the seven or eight that suit the moment they
 * were looking at.
 *
 * Four of the six map onto a group of the same name. The two that do not are
 * the two where what the picture did and what you reach for are different
 * things: a flurry of cuts wants the small detail sounds, and a still passage
 * wants something to sit underneath it.
 */
export const MOMENT_GROUP_FOR: Record<MomentKind, string> = {
  appears: 'appears',
  builds: 'builds',
  moves: 'moves',
  lands: 'lands',
  sequence: 'small',
  quiet: 'there',
};

/** What the panel calls each kind of moment. */
export const MOMENT_TITLES: Record<MomentKind, string> = {
  appears: 'Something appears',
  builds: 'Something builds',
  moves: 'Something moves',
  lands: 'Something lands hard',
  sequence: 'A quick sequence',
  quiet: 'A quiet stretch',
};

/** The five sizes the library is built on, smallest first. */
const SIZES = ['tiny', 'small', 'mid', 'large', 'huge'] as const;

/**
 * How big a sound to reach for, from how much the moment stood out.
 *
 * Three of the five sizes rather than all of them. The extremes are there for
 * somebody who wants them, but nothing about a motion measurement is precise
 * enough to justify choosing "huge" over "large" on a viewer's behalf.
 */
function sizeFor(strength: number, floor = 1): string {
  const step = strength < 0.34 ? 1 : strength < 0.7 ? 2 : 3;
  return SIZES[Math.max(floor, step)];
}

/**
 * A library entry as the settings a cue arrives with.
 *
 * Null when the name does not resolve, which leaves the cue on the voice's
 * own settings. That is a worse suggestion rather than a broken one, which is
 * the right way for this to fail.
 */
function preset(voice: string, size: string, place: string): CuePreset | null {
  return entryById(`cat:${voice}:${size}:${place}`);
}

function design(name: string, parts?: readonly CueSource[]): CueSource {
  return parts?.length ? { kind: 'design', name, with: parts } : { kind: 'design', name };
}

/** Seconds as a short phrase, for a sentence rather than a readout. */
function seconds(value: number): string {
  return value < 1 ? `${Math.round(value * 10) / 10} of a second` : `${Math.round(value * 10) / 10} seconds`;
}

export function suggestFor(moment: Moment, fps: number): Suggested {
  const size = sizeFor(moment.strength);

  switch (moment.kind) {
    case 'appears': {
      const place = moment.strength > 0.6 ? 'close' : 'dry';
      return {
        name: `${size === 'mid' ? '' : `${size} `}impact, ${place}`.trim(),
        why:
          'A sharp change with nothing leading into it. That reads as a cut, so it wants a ' +
          'short dry hit: anything with a tail arrives after the picture has moved on.',
        parts: [
          { at: 0, source: design('impact'), preset: preset('impact', size, place), layerId: 'impacts' },
        ],
      };
    }

    case 'builds': {
      const lead = sizeFor(moment.strength, 2);
      return {
        name: 'riser into impact',
        why:
          'The picture climbs into this rather than jumping to it, so the riser is set to ' +
          'finish here instead of starting here. Getting that the wrong way round is the ' +
          'commonest mistake there is.',
        parts: [
          { at: 0, source: design('riser'), preset: preset('riser', lead, 'room'), layerId: 'movement' },
          { at: 0, source: design('impact'), preset: preset('impact', size, 'close'), layerId: 'impacts' },
        ],
      };
    }

    case 'moves': {
      const span = moment.span || 0.7;
      return {
        name: 'whoosh, across the move',
        why:
          `Movement held for ${seconds(span)} rather than spent in one frame. One whoosh cut to ` +
          'the length of the move, not three separate hits inside it.',
        parts: [
          {
            at: 0,
            source: design('whoosh'),
            preset: preset('whoosh', size, 'close'),
            layerId: 'movement',
            length: span,
          },
        ],
      };
    }

    case 'lands': {
      return {
        name: `${size === 'mid' ? '' : `${size} `}thud and sub`.trim(),
        why:
          'Something arrives here and the picture is still settling after it. The sub under the ' +
          'hit is what makes it felt on a phone rather than only heard on a laptop.',
        parts: [
          {
            at: 0,
            source: design('thud', [{ kind: 'design', name: 'sub', mix: 0.55 }]),
            preset: preset('thud', size, 'close'),
            layerId: 'impacts',
          },
        ],
      };
    }

    case 'sequence': {
      const times = moment.hits;
      const frames = Math.round(moment.span * fps);
      return {
        name: `tick, ${times.length} of them`,
        why:
          `${times.length} hits inside ${frames} frames. One tick on each, each quieter than the ` +
          'last, so the run reads as one flourish rather than as separate events.',
        parts: times.map((t, i) => ({
          at: t - moment.t,
          source: design('tick'),
          preset: preset('tick', 'mid', 'dry'),
          layerId: 'detail',
          // Down to about half by the end of the run, however long it is.
          gain: 1 - (i / Math.max(1, times.length - 1)) * 0.5,
        })),
      };
    }

    case 'quiet': {
      return {
        name: 'drone bed, under the whole stretch',
        why:
          `${seconds(moment.span)} with almost nothing happening. Leaving it alone is a real ` +
          'answer. A low bed is the other, and it stops the silence reading as a mistake.',
        parts: [
          {
            at: 0,
            source: design('drone'),
            preset: preset('drone', 'large', 'hall'),
            layerId: 'tone',
            length: moment.span,
            gain: 0.45,
          },
        ],
      };
    }
  }
}
