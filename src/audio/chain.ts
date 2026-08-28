import { buildRoom, ROOMS, type RoomName } from './room.ts';
import { sequence } from './voice-spec.ts';

/** Mixer positions, shared by live playback and offline rendering. */
export interface ChainSettings {
  /** Reverb send, 0 to 1. */
  reverb: number;
  /** Tilt between low and high, 0 to 1, with 0.5 flat. */
  tone: number;
  /** Master level, 0 to 1. */
  vol: number;
  low: number;
  mid: number;
  high: number;
  /**
   * Which space the send feeds.
   *
   * Named rather than a number, because the useful differences between rooms
   * are not on one axis: a plate is not a small hall and a booth is not a
   * quiet cathedral. See `room.ts`.
   */
  room: RoomName;
}

export const DEFAULT_CHAIN: ChainSettings = {
  reverb: 0.22,
  tone: 0.5,
  vol: 0.8,
  low: 0.5,
  mid: 0.5,
  high: 0.5,
  room: 'hall',
};

export interface Chain {
  /** Voices connect here. */
  input: GainNode;
  /** The end of the chain, ready to connect to a destination. */
  output: GainNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  reverbSend: GainNode;
  master: GainNode;
  mix: GainNode;
  /** The convolver, so the space can be swapped without rebuilding the chain. */
  reverb: ConvolverNode;
  /** Which room is currently loaded, so an unchanged one is not rebuilt. */
  room: RoomName;
}

/**
 * Build the signal chain.
 *
 * Live playback and the exported file run through the same construction, so
 * what you hear while working is what lands in the file. Building it twice in
 * two places is how those two drift apart.
 */
export function buildChain(ctx: BaseAudioContext, settings: ChainSettings): Chain {
  const input = ctx.createGain();

  const band = (type: BiquadFilterType, freq: number, q?: number): BiquadFilterNode => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q) f.Q.value = q;
    f.gain.value = 0;
    return f;
  };

  const eqLow = band('lowshelf', 220);
  const eqMid = band('peaking', 1100, 1);
  const eqHigh = band('highshelf', 4200);

  const mix = ctx.createGain();
  const reverb = ctx.createConvolver();
  // Seeded from a constant, so the same room is the same buffer in playback
  // and in an offline render and the two cannot come out different.
  reverb.buffer = buildRoom(ctx, ROOMS[settings.room], sequence(0x51a3f00d));
  const reverbSend = ctx.createGain();
  const master = ctx.createGain();

  input.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(mix);
  eqHigh.connect(reverbSend);
  reverbSend.connect(reverb);
  reverb.connect(mix);
  mix.connect(master);

  const chain: Chain = { input, output: master, eqLow, eqMid, eqHigh, reverbSend, master, mix, reverb, room: settings.room };
  applySettings(chain, settings);
  return chain;
}

/** Push mixer positions onto an existing chain. */
export function applySettings(chain: Chain, s: ChainSettings): void {
  /*
   * Building a room is a pass over a few hundred thousand samples, which is
   * nothing once and audible as a stall if it happens on every knob move. So
   * it is rebuilt only when the name actually changes.
   */
  if (s.room !== chain.room) {
    chain.reverb.buffer = buildRoom(
      chain.reverb.context,
      ROOMS[s.room],
      sequence(0x51a3f00d),
    );
    chain.room = s.room;
  }
  chain.reverbSend.gain.value = s.reverb * 0.9;
  chain.master.gain.value = s.vol;
  const tilt = (s.tone - 0.5) * 2;
  chain.eqLow.gain.value = (s.low - 0.5) * 24 - tilt * 5;
  chain.eqMid.gain.value = (s.mid - 0.5) * 24;
  chain.eqHigh.gain.value = (s.high - 0.5) * 24 + tilt * 5;
}
