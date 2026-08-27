import type { Session } from '../session.ts';
import { createSliderH } from './controls.ts';
import { el, setText } from './dom.ts';
import { helpButton } from './help.ts';
import type { View } from './view.ts';

export interface MixerView extends View {
  /** Paint the meters from a master peak level, 0..1. */
  setLevel(peak: number): void;
}

/** Tick marks drawn along the volume track. */
const TICKS = 22;

/** Master volume, output meters, and the drum-pad keyboard map. */
export function createMixer(session: Session): MixerView {
  const volume = createSliderH({
    name: 'Master volume',
    value: session.engine.sliders.vol,
    ticks: TICKS,
    onStart: () => session.powerUp(),
    onChange: (value) => session.setSlider('vol', value),
  });

  const meter = (label: string): { row: HTMLElement; fill: HTMLElement; db: HTMLElement } => {
    const fill = el('i', { class: 'meter__fill' });
    const db = el('div', { class: 'meter__db', text: '−∞dB' });
    return {
      row: el('div', { class: 'meter__row' }, [
        el('div', { class: 'mixer__meter-label', text: label }),
        el('div', { class: 'meter' }, [fill]),
        db,
      ]),
      fill,
      db,
    };
  };

  const left = meter('L');
  const right = meter('R');

  const root = el('footer', { class: 'mixer' }, [
    el('div', { class: 'mixer__volume' }, [
      el('div', { class: 'micro-label', text: 'Volume' }),
      volume.el,
    ]),
    el('div', { class: 'mixer__meters' }, [left.row, right.row]),
    el('div', { class: 'mixer__map' }, [
      helpButton('engine', 'the mix and the meters'),
      el('div', { class: 'micro-label', style: { whiteSpace: 'nowrap', flex: '0 0 auto' }, text: 'Pad map' }),
      el('div', {
        class: 'mixer__map-keys',
        text: 'W E R T cymbals · A S hats · D F kicks · G H L toms · J snare · K floor',
      }),
    ]),
  ]);

  return {
    el: root,
    update() {
      // Volume is owned by the engine, not the store.
    },
    setLevel(peak: number) {
      // A 0.6 power curve opens the meter up at low levels, where a linear
      // scale would sit almost flat.
      const percent = Math.min(100, Math.round(Math.pow(peak, 0.6) * 118));
      left.fill.style.width = `${percent}%`;
      right.fill.style.width = `${Math.max(0, percent - 3)}%`;

      const db = peak > 0.001 ? Math.round(20 * Math.log10(peak)) : null;
      const text = db === null ? '−∞dB' : `${db > 0 ? '+' : '−'}${Math.abs(db)}dB`;
      setText(left.db, text);
      setText(right.db, text);
    },
  };
}
