import { sequence } from './voice-spec.ts';
import type {
  Curve,
  FilterSpec,
  LayerSpec,
  Point,
  SourceSpec,
  VoiceSpec,
} from './voice-spec.ts';

/**
 * Making the same sound twice give two takes of it rather than one file twice.
 *
 * A recorded library hands you five door slams and they differ: the door was
 * shut a little harder, the hinge rang a touch higher. Placing the same
 * synthesised sound six times gave six copies of one file — measured, a median
 * of 98.9% alike between two placements, and seven of the forty voices
 * identical to the last bit. Six of those in a row is the machine-gun sound
 * that makes synthesised effects read as fake however good any one of them is.
 *
 * So a placed sound gets a take of its own: pitch, brightness, how fast it
 * decays, how hard it was hit, and for the struck voices the ratios that decide
 * what the object is made of.
 *
 * Four things this is careful about, three of them learnt by measuring.
 *
 * **One take for the whole voice, not one per layer.** A glitch is a dozen
 * bursts described as a dozen layers. Drawing separately for each scattered
 * them independently and two placements came back 0% alike — not a second take
 * of a glitch, a different sound. One strike of one object moves all of it
 * together.
 *
 * **How much depends on what the voice is made of.** An oscillator renders the
 * same every time, so all of this is new to it. A cloud of grains already
 * redraws every grain from the noise seed and arrives varied; piling the same
 * amount on top takes it past being another handful of the same gravel.
 * Measured, `fire` and `static` fell to being nearer a different voice than
 * themselves.
 *
 * **Some things must not move at all.** A cloud's density and a run's rate say
 * when every event lands. Nudging them relocates all of them and nothing lines
 * up with anything: a ratchet varied that way came back 4% alike to itself.
 * What differs between two pulls of one zip is what the teeth ring at, not how
 * many there are.
 *
 * **It is drawn from the cue's own id**, so a sound is the same every time
 * *it* is played — while working, while auditioning, and in the exported file —
 * and different from the one beside it. Same rule the noise already follows,
 * and the reason a timeline can be rendered offline and still match what was
 * heard.
 *
 * `tools/redraw-check.html` measures both halves: how different two placements
 * are, and whether each is still nearer its own voice than any other.
 */

/**
 * How far each thing moves when the control is all the way up.
 *
 * Set by what a second take of the same source actually differs by rather than
 * by what sounds dramatic: a performer hits within a couple of dB and a few
 * tens of cents, and the brightness moves more than anything else, because how
 * hard a thing is struck changes its spectrum more than its pitch.
 */
const RANGE = {
  /**
   * Pitch, in cents either way.
   *
   * Wider than a musician would want and about right for an object: two
   * strikes on one piece of metal are a good half-semitone apart, and nothing
   * here is being played against anything else in tune.
   */
  cents: 180,
  /** Filter cutoff, as a share either way. */
  cutoff: 0.35,
  /** How fast the envelope runs, as a share either way. */
  pace: 0.25,
  /** Level, as a share either way — about two and a half dB at full. */
  level: 0.28,
  /** The ratios that decide what a struck thing is made of. */
  ratio: 0.06,
};

/**
 * How much of all that a voice built this way should get.
 *
 * Inversely to how much it already varies on its own. The deterministic ones
 * get all of it because they have none; the stochastic ones get a fraction
 * because they arrive with plenty. See the note above for what happens when
 * they are given the full amount.
 */
const BY_KIND: Record<SourceSpec['kind'], number> = {
  osc: 1,
  modal: 1,
  pluck: 1,
  noise: 1,
  reverse: 1,
  grains: 0.4,
  impulses: 0.4,
};

/** What this placement does differently, drawn once for the whole voice. */
interface Take {
  /** Pitch, as a multiplier. */
  bend: number;
  /** Filter cutoff and brightness, as a multiplier. */
  cutoff: number;
  /** How fast the envelope runs, as a multiplier. */
  pace: number;
  /** Level, as a multiplier. */
  level: number;
}

function drawTake(seed: number, amount: number): Take {
  // Seeded away from the noise seed — the noise uses the id as it is — so the
  // shape of a sound and the noise inside it are not two views of one number.
  const next = sequence((seed ^ 0x9e3779b9) >>> 0);
  // Centred on nothing, so turning the control down leaves the voice exactly
  // as its author wrote it rather than somewhere near it.
  const swing = (): number => (next() * 2 - 1) * amount;
  return {
    bend: Math.pow(2, (swing() * RANGE.cents) / 1200),
    cutoff: 1 + swing() * RANGE.cutoff,
    pace: 1 + swing() * RANGE.pace,
    level: 1 + swing() * RANGE.level,
  };
}

/** The same take, softened for a voice that already varies on its own. */
function scaled(take: Take, by: number): Take {
  const soften = (value: number): number => 1 + (value - 1) * by;
  return {
    bend: soften(take.bend),
    cutoff: soften(take.cutoff),
    pace: soften(take.pace),
    level: soften(take.level),
  };
}

/** Move a whole curve's values by a factor, leaving its timing alone. */
function scaleValues(curve: Curve, by: number): Curve {
  return curve.map((point) => ({ ...point, to: point.to * by }));
}

/** Move a curve's timing by a factor, leaving its values alone. */
function scaleTiming(curve: Curve, by: number): Curve {
  return curve.map((point: Point) => ({
    ...point,
    at: point.at * by,
    ...(point.tc !== undefined ? { tc: point.tc * by } : {}),
  }));
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function varySource(source: SourceSpec, take: Take, seed: number, amount: number): SourceSpec {
  switch (source.kind) {
    case 'osc':
      return {
        ...source,
        freq: scaleValues(source.freq, take.bend),
        ...(source.fm
          ? {
              // How far the modulator pushes moves further than what it is,
              // because how hard a thing is struck changes how much it rings
              // rather than what it is made of.
              fm: {
                ratio: source.fm.ratio * Math.pow(take.cutoff, 0.2),
                depth: source.fm.depth * take.cutoff,
              },
            }
          : {}),
      };

    case 'modal': {
      /*
       * The struck bodies — a bell, a glass, a pipe, a piece of wood.
       *
       * The ones anybody notices repeating, because a struck object is the
       * most recognisable thing in the palette. Two strikes on one object
       * differ in where it was hit and how hard, which comes out as the
       * partials sitting at slightly different ratios and ringing for
       * different lengths. Each partial is drawn on its own, from a stream of
       * its own so the number of partials cannot shift what the rest of the
       * voice got: the object stays the same object and stops being the same
       * recording of it.
       */
      const next = sequence((seed ^ 0x85ebca6b) >>> 0);
      const swing = (): number => (next() * 2 - 1) * amount;
      return {
        ...source,
        freq: source.freq * take.bend,
        partials: source.partials.map((partial) => ({
          ratio: partial.ratio * (1 + swing() * RANGE.ratio),
          gain: partial.gain * (1 + swing() * RANGE.level),
          decay: partial.decay * take.pace * (1 + swing() * RANGE.pace),
        })),
        ...(source.strike !== undefined
          ? { strike: clamp(source.strike * take.cutoff, 0, 1) }
          : {}),
      };
    }

    case 'pluck':
      return {
        ...source,
        freq: source.freq * take.bend,
        // How bright the string is, which is where along it you plucked.
        damping: clamp(source.damping / take.cutoff, 0, 1),
      };

    case 'grains':
      /*
       * Only the pitch, and even that softened.
       *
       * `density` is untouched on purpose: it says how thickly the cloud
       * arrives, which is what the cloud is. Grain length and pitch spread
       * were tried and taken back out — `gravel` fell from 90% alike to itself
       * to 59%, because the envelope around the cloud was already being paced
       * and doing it to the grains as well moved the same thing twice.
       */
      return { ...source, freq: source.freq * take.bend };

    case 'impulses':
      // `rate` and `jitter` are untouched for the same reason, and more
      // sharply: they decide when every hit lands.
      return {
        ...source,
        freq: source.freq * take.bend,
        ring: Math.max(0.001, source.ring * take.pace),
      };

    // A buffer read backwards, and plain noise, are already a different draw
    // every time from the seed the cue had. Only the envelope and the filter
    // around them move.
    default:
      return source;
  }
}

function varyFilter(filter: FilterSpec, take: Take): FilterSpec {
  return { ...filter, freq: scaleValues(filter.freq, take.cutoff) };
}

function varyLayer(layer: LayerSpec, whole: Take, seed: number, amount: number): LayerSpec {
  const by = BY_KIND[layer.source.kind] ?? 1;
  const take = by === 1 ? whole : scaled(whole, by);

  return {
    ...layer,
    source: varySource(layer.source, take, seed, amount * by),
    ...(layer.filter ? { filter: varyFilter(layer.filter, take) } : {}),
    /*
     * Faster or slower, not longer or shorter: the envelope inside moves and
     * the layer still runs for exactly as long as it was asked to, so a varied
     * sound stays on the frame it was placed on.
     *
     * `delay` is left alone for the same reason a run's rate is. It says where
     * this layer sits against the others, and a voice described as a dozen of
     * them — a glitch, a clatter — comes apart if they drift independently.
     */
    gain: scaleValues(scaleTiming(layer.gain, take.pace), take.level),
  };
}

/**
 * A take of this voice, decided by `seed`.
 *
 * `amount` is the cue's own setting, from nothing at zero. At zero the spec
 * comes back untouched — not nearly untouched — so anyone who wants one sound
 * exactly gets the one its author wrote.
 */
export function varySpec(spec: VoiceSpec, amount: number, seed: number): VoiceSpec {
  if (amount <= 0) return spec;
  const held = Math.min(1, amount);
  const take = drawTake(seed, held);
  return {
    ...spec,
    layers: spec.layers.map((layer) => varyLayer(layer, take, seed, held)),
  };
}
