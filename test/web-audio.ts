import {
  AudioBuffer,
  AudioContext,
  BiquadFilterNode,
  ConvolverNode,
  GainNode,
  OfflineAudioContext,
  OscillatorNode,
  PeriodicWave,
} from 'node-web-audio-api';

/**
 * Web Audio in Node, so the graph can be rendered rather than reasoned about.
 *
 * The comment in `audio-buffer.ts` next door used to end "which is the reason
 * these two files can be tested at all while the graph that fills them
 * cannot". That was true of a stub and not true of the thing itself: the
 * export path is an `OfflineAudioContext` rendering faster than real time,
 * which is a plain function of its inputs in every sense that matters — the
 * same project in gives the same samples out, with no page, no device and no
 * clock. It only ever needed an implementation.
 *
 * `node-web-audio-api` is one, in Rust, and it carries every node this app
 * builds with: convolver, biquad, compressor, shaper, panner and the rest.
 * What it is not is Chromium, so this checks that we schedule and mix what we
 * meant to, not that two implementations sound identical. The browser suite is
 * where the real thing gets driven.
 *
 * Installed as globals rather than imported by the modules under test, since
 * `audio/` is written against the browser's names and should stay that way:
 * the day it imports from a test package is the day it stops being the code
 * that ships.
 */
const globals = {
  OfflineAudioContext,
  AudioContext,
  AudioBuffer,
  OscillatorNode,
  GainNode,
  BiquadFilterNode,
  ConvolverNode,
  PeriodicWave,
};

for (const [name, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
