import type { Session } from '../session.ts';
import type { AppState } from '../store.ts';
import type { Metro } from '../types.ts';
import { createKnob, createSliderV } from './controls.ts';
import { button, el, setText, toggleClass } from './dom.ts';
import { helpButton } from './help.ts';
import { waveMark } from './icons.ts';
import type { View } from './view.ts';

const METRO_MODES: readonly { value: Metro; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'beat', label: 'Beat' },
  { value: 'sixteenth', label: '16ths' },
];

/** Take lengths in bars; 0 means keep recording until stopped. */
const LOOP_OPTIONS = [1, 2, 4, 0] as const;

const EQ_BANDS = [
  { key: 'low', label: 'Low' },
  { key: 'mid', label: 'Mid' },
  { key: 'high', label: 'High' },
] as const;

/** Engine status, effects, clock, EQ and keyboard settings. */
export function createInspector(session: Session): View {
  // ---------- header ----------
  const powerText = el('div', { class: 'status-head__meta', text: 'Off' });
  const powerDot = el('i', {
    style: {
      width: '11px',
      height: '11px',
      borderRadius: '50%',
      border: '1.6px solid var(--led-off)',
    },
  });

  const header = el('div', { class: 'status-head' }, [
    el('div', { class: 'rail__power', style: { cursor: 'default' } }, [waveMark([5, 11, 7], 1.5, 1.5, 0)]),
    el('div', {}, [
      el('div', { class: 'micro-label', text: 'Mode' }),
      el('div', { class: 'status-head__meta', text: 'Stereo' }),
    ]),
    el('div', { class: 'rail__spacer' }),
    el('div', { style: { textAlign: 'right' } }, [
      el('div', { class: 'micro-label', text: 'Power' }),
      powerText,
    ]),
    button(
      { class: 'rail__power', title: 'Start the audio engine', on: { click: () => session.powerUp() } },
      [powerDot],
    ),
  ]);

  // ---------- engine card ----------
  const engineLed = el('i', { class: 'led' });
  const engineName = el('div', { text: 'standby' });
  const recLed = el('i', { class: 'led' });
  const recState = el('div', { text: 'idle' });

  const engineCard = el('div', { class: 'card', style: { padding: '4px 12px' } }, [
    el('div', { class: 'engine-row' }, [
      el('div', { class: 'engine-row__icon engine-row__icon--on' }, [
        el('i', {
          style: { width: '10px', height: '10px', borderRadius: '50%', border: '1.6px solid var(--ac)' },
        }),
      ]),
      el('div', { class: 'engine-row__name', text: 'Sample engine' }),
      el('div', { class: 'engine-row__state' }, [engineLed, engineName]),
    ]),
    el('div', { class: 'engine-row' }, [
      el('div', { class: 'engine-row__icon engine-row__icon--off' }, [
        el('i', {
          style: { width: '9px', height: '9px', borderRadius: '2px', border: '1.6px solid var(--txt-3)' },
        }),
      ]),
      el('div', { class: 'engine-row__name', text: 'Recorder' }),
      el('div', { class: 'engine-row__state' }, [recLed, recState]),
    ]),
  ]);

  // ---------- effects ----------
  const reverb = createKnob({
    name: 'Reverb',
    value: session.engine.knobs.reverb,
    format: (v) => String(Math.round(v * 100)),
    onStart: () => session.powerUp(),
    onChange: (v) => session.setKnob('reverb', v),
  });

  const tilt = createKnob({
    name: 'Tilt',
    value: session.engine.knobs.tone,
    // Reads as decibels of tilt: negative is darker, positive brighter.
    format: (v) => (v * 24 - 12).toFixed(0),
    onStart: () => session.powerUp(),
    onChange: (v) => session.setKnob('tone', v),
  });

  const effects = el('div', { class: 'knob-grid' }, [
    el('div', {}, [el('div', { class: 'section-title', text: 'Reverb' }), reverb.el]),
    el('div', {}, [el('div', { class: 'section-title', text: 'Tilt' }), tilt.el]),
  ]);

  // ---------- clock ----------
  const metroButtons = METRO_MODES.map((mode) =>
    button(
      { class: 'metro', on: { click: () => session.setMetro(mode.value) } },
      [
        el('div', { class: 'metro__dial' }, [el('i')]),
        el('div', { class: 'metro__label', text: mode.label }),
      ],
    ),
  );

  const countInSwitch = button(
    {
      class: 'switch',
      attrs: { role: 'switch', 'aria-label': 'Count-in' },
      on: { click: () => session.toggleCountIn() },
    },
    [el('i', { class: 'switch__thumb' })],
  );

  const loopButtons = LOOP_OPTIONS.map((value) =>
    button(
      { class: 'cell cell--loop', on: { click: () => session.setLoops(value) } },
      [el('span', { text: value === 0 ? '∞' : `${value}x` })],
    ),
  );

  const clockCard = el('div', { class: 'card', style: { padding: '14px 14px 16px' } }, [
    el('div', { class: 'metro-row' }, metroButtons),
    el('div', { class: 'rule' }),
    el('div', { class: 'setting-row' }, [
      el('div', { class: 'setting-row__label', text: 'Count‑in' }),
      countInSwitch,
    ]),
    el('div', { class: 'setting-row' }, [
      el('div', { class: 'setting-row__label', text: 'Take length' }),
      el('div', { style: { display: 'flex', gap: '4px' } }, loopButtons),
    ]),
  ]);

  // ---------- equalizer ----------
  const eqCard = el('div', { class: 'card', style: { padding: '14px' } }, [
    el('div', { class: 'eq' }, [
      el('div', { class: 'eq__scale' }, [
        el('div', { text: '10' }),
        el('div', { text: '0' }),
        el('div', { text: '−10' }),
      ]),
      ...EQ_BANDS.map((band) => {
        const slider = createSliderV({
          name: `${band.label} EQ`,
          value: session.engine.sliders[band.key],
          onStart: () => session.powerUp(),
          onChange: (v) => session.setSlider(band.key, v),
        });
        return el('div', { class: 'eq__band' }, [
          slider.el,
          el('div', { class: 'eq__band-label', text: band.label }),
        ]);
      }),
    ]),
  ]);

  // ---------- keyboard ----------
  const octaveLcd = el('div', { class: 'stepper__lcd', text: 'C4' });
  const sustainSwitch = button(
    {
      class: 'switch',
      attrs: { role: 'switch', 'aria-label': 'Sustain' },
      on: { click: () => session.toggleSustain() },
    },
    [el('i', { class: 'switch__thumb' })],
  );

  const keyboardCard = el('div', { class: 'card', style: { padding: '12px 14px 14px' } }, [
    el('div', { class: 'setting-row' }, [
      el('div', { class: 'setting-row__label', text: 'Octave' }),
      el('div', { class: 'stepper stepper--sm' }, [
        button({ class: 'stepper__btn', attrs: { 'aria-label': 'Octave down' }, on: { click: () => session.nudgeOctave(-1) } }, ['−']),
        octaveLcd,
        button({ class: 'stepper__btn', attrs: { 'aria-label': 'Octave up' }, on: { click: () => session.nudgeOctave(1) } }, ['+']),
      ]),
    ]),
    el('div', { class: 'setting-row' }, [
      el('div', { class: 'setting-row__label', text: 'Sustain' }),
      sustainSwitch,
    ]),
  ]);

  /** A section heading with a small "?" that opens the help at its part. */
  const section = (text: string, at: string, body: HTMLElement): HTMLElement =>
    el('div', {}, [
      el('div', { class: 'section-title section-title--asks' }, [
        el('span', { text }),
        helpButton(at, text.toLowerCase()),
      ]),
      body,
    ]);

  const root = el('aside', { class: 'inspector' }, [
    header,
    section('Engine', 'engine', engineCard),
    effects,
    section('Clock', 'pattern', clockCard),
    section('Equalizer', 'engine', eqCard),
    section('Keyboard', 'instruments', keyboardCard),
  ]);

  return {
    el: root,
    update(state: AppState) {
      setText(powerText, state.ready ? 'On' : 'Off');
      powerDot.style.borderColor = state.ready ? 'var(--ac)' : 'var(--led-off)';

      engineLed.style.background = state.ready
        ? session.engine.sampled
          ? 'var(--ok)'
          : 'var(--ac)'
        : 'var(--led-dead)';
      setText(engineName, state.engineName);

      recLed.style.background = state.recording
        ? 'var(--rec)'
        : state.ready
          ? 'var(--txt-3)'
          : 'var(--led-dead)';
      setText(recState, state.recording ? 'recording' : state.ready ? 'ready' : 'idle');

      metroButtons.forEach((node, i) => toggleClass(node, 'is-on', state.metro === METRO_MODES[i].value));
      loopButtons.forEach((node, i) => toggleClass(node, 'is-on', state.loops === LOOP_OPTIONS[i]));
      toggleClass(countInSwitch, 'is-on', state.countIn);
      toggleClass(sustainSwitch, 'is-on', state.sustain);
      setText(octaveLcd, `C${state.octave}`);
    },
  };
}
