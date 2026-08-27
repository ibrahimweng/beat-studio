import { cueGain, cueLength, cueStart, laneValueAt, scheduleLane } from '../timeline/project.ts';
import {
  LANES,
  type AutoPoint,
  type Cue,
  type CueSource,
  type DesignName,
  type Layer,
  type Project,
} from '../timeline/types.ts';
import type { PadName } from '../types.ts';
import { designSpec } from './design-voices.ts';
import { packSpec, shapeSpec } from './pack.ts';
import {
  layerShaper,
  renderVoice,
  roomImpulse,
  seedFrom,
  sequence,
  type EffectSpec,
  type VoiceSpec,
} from './voice-spec.ts';
import { guitarSpec, kitSpec, pianoSpec } from './voices.ts';

/**
 * What a cue is made of, at a given level.
 *
 * One place decides what a placed sound means, so live playback, auditioning,
 * the exported file and saving a sound of your own cannot disagree about it.
 * Every kind of source ends up as the same kind of description here, which is
 * what lets the room and the push reach all of them without any of them
 * knowing about it.
 */
export function specForCue(cue: Cue, gain: number): VoiceSpec | null {
  const spec = stacked(cue, gain);
  if (!spec) return null;

  // The room and the push belong to the placed sound rather than to the
  // voice, so they go after whatever the voice brought with it — and after
  // every voice in a stack, because a stack is one sound in one room.
  const effects = cueEffects(cue);
  return effects.length ? { ...spec, effects: [...(spec.effects ?? []), ...effects] } : spec;
}

/**
 * The cue's voice, and whatever is stacked onto it, as one description.
 *
 * Concatenating the layers rather than mixing two rendered sounds, because a
 * {@link VoiceSpec} is the one currency this app deals in: a stack that is
 * still a spec can be saved as your own, written to a patch file, rendered
 * offline and stretched by the length control without any of those knowing
 * that stacks exist.
 *
 * Two consequences worth stating rather than discovering. A stacked voice
 * draws its noise from further along the same stream as the one before it, so
 * it is a different metal from the metal you get on its own — still a metal,
 * and still the same one every time this cue is played, which is what
 * matters. And a sound that carries effects of its own, meaning a pack sound
 * with a room in it, is left out of a stack rather than mixed into one: those
 * sit above all the layers at once, so its room would land on everything
 * beside it, and pushing a copy down onto each layer would build a different
 * room for each. See `tools/README.md`.
 */
function stacked(cue: Cue, gain: number): VoiceSpec | null {
  const extras = cue.source.with ?? [];
  if (!extras.length) return voiceSpec(cue.source, cue, gain);

  // Equal power, so two voices together are about as loud as one was rather
  // than twice as loud, and how much of each is what `mix` is for.
  const share = 1 / Math.sqrt(1 + extras.length);
  const head = voiceSpec(cue.source, cue, gain * share);
  if (!head) return null;
  // Its own room would land on everything stacked beside it.
  if (head.effects?.length) return head;

  const parts = [head];
  for (const extra of extras) {
    const part = voiceSpec(extra, cue, gain * share * (extra.mix ?? 1));
    if (part && !part.effects?.length) parts.push(part);
  }
  if (parts.length === 1) return head;

  return {
    duration: Math.max(...parts.map((part) => part.duration)),
    layers: parts.flatMap((part) => part.layers),
  };
}

/** One sound, at the length, pitch and level the cue asks for. */
function voiceSpec(source: CueSource, cue: Cue, gain: number): VoiceSpec | null {
  const options = { length: cueLength(cue), tune: cue.tune, gain };

  if (source.kind === 'design') {
    return designSpec(source.name as DesignName, options);
  }
  if (source.kind === 'kit') {
    // Kit voices have fixed shapes, so tune is applied as level only.
    return kitSpec(source.name as PadName, gain);
  }
  if (source.kind === 'pack') {
    // A pack sound arrives at one length, pitch and level. Fitting it to what
    // was asked for keeps the shape and changes only the scale, so the three
    // controls mean the same thing as they do for the voices built in here.
    const base = source.pack ? packSpec(source.pack, source.name) : null;
    return base ? shapeSpec(base, options) : null;
  }
  const midi = (source.midi ?? 60) + cue.tune;
  return source.name === 'guitar' ? guitarSpec(midi, gain) : pianoSpec(midi, gain);
}

/**
 * The room and the push a placed sound asks for.
 *
 * Pushed first and then put in a room, which is the order these happen in
 * anywhere else: saturating a room's tail sounds like a fault, while putting
 * a saturated sound in a room sounds like a sound in a room.
 */
function cueEffects(cue: Cue): EffectSpec[] {
  const effects: EffectSpec[] = [];
  if (cue.drive > 0) effects.push({ kind: 'drive', amount: cue.drive });
  if (cue.space > 0) {
    effects.push({
      kind: 'reverb',
      // A bigger setting is a bigger room as well as more of it, since a long
      // tail at a low level is a hall heard from outside rather than a space
      // the sound is in.
      decay: 0.4 + cue.space * 2.2,
      // Added to the sound rather than blended with it, so turning this up
      // puts the hit in a room instead of trading the hit away for one.
      dry: 1,
      mix: cue.space * 0.45,
      // A real room answers after the sound, not at the same instant as it.
      // Without this the first sample of the room lands on the transient and
      // colours it, at a polarity that is different every time, so the same
      // hit could come out fractionally softer or harder for no reason you
      // could see. A bigger room is heard from further away, so it waits
      // slightly longer.
      preDelay: 0.012 + cue.space * 0.02,
      damping: 0.35,
    });
  }
  return effects;
}

/** Play whatever a cue points at. */
export function playCue(
  ctx: BaseAudioContext,
  dest: AudioNode,
  cue: Cue,
  at: number,
  gain: number,
): void {
  const spec = specForCue(cue, gain);
  // A placed sound is one sound, not a new one each time it is heard. Drawing
  // its noise from its own id means auditioning it, playing the timeline and
  // exporting all produce the same thing, and that a set of stems adds up to
  // the mixed file exactly rather than nearly.
  if (spec) renderVoice(ctx, dest, spec, at, seedFrom(cue.id));
}

/**
 * Schedule a cue against a timeline whose zero sits at `originTime`.
 *
 * `atLevel` is for hearing one sound on its own, where there is no layer to
 * play through and so nothing carrying that layer's level over time.
 */
export function scheduleCue(
  ctx: BaseAudioContext,
  dest: AudioNode,
  project: Project,
  cue: Cue,
  originTime: number,
  atLevel = 1,
): void {
  playCue(ctx, dest, cue, originTime + cueStart(cue), cueGain(project, cue) * atLevel);
}

/**
 * How big the room a layer can be put in is, and how dull.
 *
 * One fixed room per layer, rather than one that changes shape as the lane
 * moves. What the drawing controls is how much of it you hear, which is what
 * a send is: changing the size of a room while its own tail is still ringing
 * is not something a room can do, and it sounds like the fault it is.
 */
const ROOM_SECONDS = 2.2;
const ROOM_DAMPING = 0.35;

/**
 * What a fully drawn space lane is worth as a send.
 *
 * Measured rather than picked: at this figure a layer taken all the way up
 * leaves about the same tail as a sound taken all the way up with its own
 * Space control, so the two mean the same thing to the ear. They part company
 * below the top, because a sound's own room gets smaller as its control comes
 * down while a layer's room stays the size it is and you simply hear less of
 * it, which is what a send is.
 */
const ROOM_SEND = 0.6;

/**
 * The nodes a layer's drawn curves play through.
 *
 * A drawn curve belongs to a moment rather than to a sound, so it cannot be
 * folded into each cue the way a fixed level can: two sounds overlapping on
 * the same layer have to move together. Everything on such a layer plays
 * through these instead.
 *
 * The level and the position are always here, because they cost four small
 * nodes and neither does anything at rest. The room and the push are not: a
 * room is two seconds of noise to generate and a convolution to run for the
 * length of the piece, and a push is a shaper running at four times the rate
 * so that what it makes does not fold back down the spectrum. Both are built
 * the first time anyone draws one and left in place afterwards, turned down
 * to nothing. Both are reached by connecting rather than by rewiring, so
 * adding one cannot interrupt a sound already playing through the bus.
 */
export interface LayerBus {
  /** Where this layer's sounds go. */
  input: GainNode;
  /** How much of it goes round the push. One when there is no push. */
  clean: GainNode;
  /** How much goes through it, or null until a push is asked for. */
  pushed: GainNode | null;
  /** Where the two halves of the push come back together. Carries the level. */
  level: GainNode;
  /** The two sides, which between them are where the layer sits. */
  left: GainNode;
  right: GainNode;
  /** The two sides put back together, and what the room is fed from. */
  out: ChannelMergerNode;
  /** How much of it reaches its room, or null until a room is asked for. */
  send: GainNode | null;
  /** Everything built for this bus, so all of it can be taken out again. */
  nodes: AudioNode[];
}

/**
 * How far each side is turned down when the layer is moved across.
 *
 * A balance rather than a pan, because a layer is a mix of sounds rather than
 * one sound. The near side is left alone and the far side is faded away, so
 * the middle is exactly the signal that went in: drawing a position and not
 * moving it changes nothing at all, which is the property that matters most.
 * The alternative law holds the loudness up across the sweep by taking three
 * decibels off the middle, and quietly changing a mix that was already right
 * is not a trade worth making.
 */
function leftSide(pan: number): number {
  return pan <= 0 ? 1 : Math.cos((Math.min(pan, 1) * Math.PI) / 2);
}

function rightSide(pan: number): number {
  return pan >= 0 ? 1 : Math.cos((Math.max(pan, -1) * Math.PI) / -2);
}

/**
 * How often the position is written while it is moving.
 *
 * What a position is worth to each side is a curve, not a line, so ramping
 * straight from one drawn point to the next is not the same shape: a sound
 * swept from one side to the other in two moves would be taken through the
 * middle six decibels down, which is a hole in the mix nobody drew. Written
 * once a frame instead, which is far finer than the ear resolves a movement
 * and costs a handful of events a tick.
 */
const PAN_STEP = 1 / 30;

/** Write a position onto the two sides, following the curve between points. */
function schedulePan(
  left: AudioParam,
  right: AudioParam,
  points: readonly AutoPoint[],
  origin: number,
  from: number,
  to: number,
): void {
  if (to <= from) return;
  left.cancelScheduledValues(origin + from);
  right.cancelScheduledValues(origin + from);

  if (!points.length) {
    left.setValueAtTime(1, origin + from);
    right.setValueAtTime(1, origin + from);
    return;
  }

  const at = (t: number): number => laneValueAt(points, t, 0);
  left.setValueAtTime(leftSide(at(from)), origin + from);
  right.setValueAtTime(rightSide(at(from)), origin + from);

  for (let t = from + PAN_STEP; t < to; t += PAN_STEP) {
    left.linearRampToValueAtTime(leftSide(at(t)), origin + t);
    right.linearRampToValueAtTime(rightSide(at(t)), origin + t);
  }
  left.linearRampToValueAtTime(leftSide(at(to)), origin + to);
  right.linearRampToValueAtTime(rightSide(at(to)), origin + to);
}

/** Whether a layer has anything drawn on it at all. */
function drawn(layer: Layer): boolean {
  return LANES.some((lane) => layer.auto[lane.name].length > 0);
}

/**
 * Bring the layer buses into line with the project.
 *
 * Brought into line rather than rebuilt, because a sound queued a moment ago
 * is still playing through the nodes it was given, and replacing those would
 * cut it off. Adding a room only connects new nodes to a node that is already
 * running, so even that is not felt.
 *
 * Layers with nothing drawn are absent from the map, and their sounds go
 * straight to the destination, so nothing is built for a project that draws
 * nothing.
 */
export function syncLayerBuses(
  ctx: BaseAudioContext,
  project: Project,
  dest: AudioNode,
  buses: Map<string, LayerBus>,
): void {
  for (const layer of project.layers) {
    if (!drawn(layer)) continue;

    let bus = buses.get(layer.id);
    if (!bus) {
      bus = buildBus(ctx, dest);
      buses.set(layer.id, bus);
    }

    if (layer.auto.drive.length && !bus.pushed) addDrive(ctx, bus);
    if (layer.auto.space.length && !bus.send) addRoom(ctx, bus, dest);
  }

  const wanted = new Set(project.layers.filter(drawn).map((l) => l.id));
  for (const [id, bus] of buses) {
    if (wanted.has(id)) continue;
    releaseBus(bus);
    buses.delete(id);
  }
}

/**
 * The push, then the level, then the two sides, then back together again.
 *
 * In that order because that is the order a desk is in: what shapes the sound
 * comes before the fader that decides how much of it there is. The other way
 * round, drawing a layer quieter would quietly push it less as well, which is
 * a second thing happening that nobody drew.
 *
 * The push is a hard-driven copy of the layer blended against the untouched
 * one, and the two halves are summed by the level node rather than by one of
 * their own. At nothing drawn the copy is turned all the way down and what
 * comes out is what went in, to the sample.
 *
 * The entry is held to two channels on purpose. A voice with no room of its
 * own is one channel, and a bus that took it as it came would hand the
 * splitter a silent right side. Made stereo here, a sound sent nowhere in
 * particular arrives at both sides exactly as it does when there is no bus at
 * all, which is what makes drawing a curve on a layer safe.
 */
function buildBus(ctx: BaseAudioContext, dest: AudioNode): LayerBus {
  const input = ctx.createGain();
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';

  const clean = ctx.createGain();
  clean.gain.value = 1;

  const level = ctx.createGain();
  const split = ctx.createChannelSplitter(2);
  const left = ctx.createGain();
  const right = ctx.createGain();
  const out = ctx.createChannelMerger(2);

  input.connect(clean);
  clean.connect(level);

  level.connect(split);
  split.connect(left, 0);
  split.connect(right, 1);
  left.connect(out, 0, 0);
  right.connect(out, 0, 1);
  out.connect(dest);

  return {
    input,
    clean,
    pushed: null,
    level,
    left,
    right,
    out,
    send: null,
    nodes: [input, clean, level, split, left, right, out],
  };
}

/**
 * Give a layer a push: a hard-driven copy of it, blended against the one that
 * was left alone.
 *
 * Fixed at the hardest it goes, with the lane deciding how much of it is
 * heard, since a shaping curve is a table rather than a number and cannot be
 * moved while it runs. Drawn all the way up it is the same push a single
 * sound gets at the top of its own control; below that it is a hard copy
 * mixed in rather than a gentler bend, which is what a bus wants and is how
 * weight is added to a mix everywhere else.
 */
function addDrive(ctx: BaseAudioContext, bus: LayerBus): void {
  // Fixed at the hardest it goes, with the lane deciding how much of it is
  // heard, since a shaping curve is a table rather than a number and cannot
  // be changed while it runs.
  const shaper = layerShaper(ctx);

  const pushed = ctx.createGain();
  pushed.gain.value = 0;
  bus.input.connect(pushed);
  pushed.connect(shaper);
  shaper.connect(bus.level);

  bus.pushed = pushed;
  bus.nodes.push(pushed, shaper);
}

/**
 * Give a layer a room, tapped after the position.
 *
 * After rather than before, so a sound moved to one side is answered from
 * that side. A room fed before it answers from the middle, which reads as a
 * room somewhere else rather than the room the sound is in.
 */
function addRoom(ctx: BaseAudioContext, bus: LayerBus, dest: AudioNode): void {
  const send = ctx.createGain();
  send.gain.value = 0;

  const room = ctx.createConvolver();
  // Fixed, so the same session renders the same file every time.
  room.buffer = roomImpulse(ctx, ROOM_SECONDS, ROOM_DAMPING, sequence(0x51a3f00d));

  // What the lane is worth as a send lives here rather than in the drawn
  // numbers, so the drawing stays in the nought to one it shows.
  const trim = ctx.createGain();
  trim.gain.value = ROOM_SEND;

  bus.out.connect(send);
  send.connect(room);
  room.connect(trim);
  trim.connect(dest);

  bus.send = send;
  bus.nodes.push(send, room, trim);
}

/** Take a bus out of the graph, whatever it was built with. */
export function releaseBus(bus: LayerBus): void {
  for (const node of bus.nodes) node.disconnect();
}

/**
 * Write each layer's drawn curves onto its nodes, over a stretch of the video.
 *
 * The level falls back to one rather than to the layer's fixed level, because
 * a layer with nothing drawn there has already had that fixed level folded
 * into each of its sounds. See {@link cueGain}.
 */
export function scheduleLayerLanes(
  buses: ReadonlyMap<string, LayerBus>,
  project: Project,
  origin: number,
  from: number,
  to: number,
): void {
  for (const layer of project.layers) {
    const bus = buses.get(layer.id);
    if (!bus) continue;
    if (bus.pushed) scheduleLane(bus.pushed.gain, layer.auto.drive, 0, origin, from, to);
    scheduleLane(bus.clean.gain, layer.auto.drive, 0, origin, from, to, (v) => 1 - v);
    scheduleLane(bus.level.gain, layer.auto.level, 1, origin, from, to);
    schedulePan(bus.left.gain, bus.right.gain, layer.auto.pan, origin, from, to);
    if (bus.send) scheduleLane(bus.send.gain, layer.auto.space, 0, origin, from, to);
  }
}
