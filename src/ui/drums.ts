import type { PadName } from '../types.ts';
import type { Session } from '../session.ts';
import { button, el } from './dom.ts';
import type { View } from './view.ts';

/** Standard cymbal hammering: fine dark rings over the brass. */
const LATHE =
  'repeating-conic-gradient(from 0deg,rgba(0,0,0,.22) 0deg .45deg,rgba(255,255,255,.035) .45deg 1deg)';
/** The ride is larger, so its rings are wider apart and softer. */
const LATHE_RIDE =
  'repeating-conic-gradient(from 0deg,rgba(0,0,0,.2) 0deg .4deg,rgba(255,255,255,.035) .4deg .9deg)';

interface CymbalSpec {
  kind: 'cymbal';
  brass: string;
  bell: string;
  hole: string;
  lathe?: string;
  labelBottom: string;
  labelRotate: string;
  labelSize: string;
  labelTrack: string;
  labelColor?: string;
}

interface DrumSpec {
  kind: 'drum';
  shell: string;
  head: string;
  rimColor: string;
  rimWidth: string;
  rimInset?: string;
  rimOpacity?: string;
  headInset?: string;
  labelColor: string;
  labelSize: string;
  labelTrack: string;
  /** Kicks carry their name on a badge in the middle of the head. */
  badge?: string;
}

interface Pad {
  pad: PadName;
  label: string;
  /** Position and size as percentages of the 980x520 board. */
  left: string;
  top: string;
  width: string;
  z: number;
  shadow: string;
  spec: CymbalSpec | DrumSpec;
}

const TOM_SHELL = 'radial-gradient(circle at 40% 26%,#2a2d31,#16181a 60%,#0d0f10)';
const TOM_HEAD = 'radial-gradient(circle at 42% 30%,#23252a,#131518 74%)';
const KICK_SHELL = 'radial-gradient(circle at 40% 24%,#3a332b,#211d18 58%,#101011)';
const KICK_HEAD = 'radial-gradient(circle at 42% 28%,#38342d,#1e1c18 78%)';
const KICK_BADGE = 'radial-gradient(circle at 42% 30%,#c8cac6,#95988f)';

/**
 * The kit, laid out the way a drummer sits behind it: cymbals up and out,
 * toms across the middle, snare and kicks nearest. Later entries sit on top,
 * which is why the z-index climbs towards the front of the kit.
 */
const PADS: readonly Pad[] = [
  {
    pad: 'crash1', label: 'CRASH', left: '13%', top: '29%', width: '14.6%', z: 1,
    shadow: '0 10px 22px -12px #000',
    spec: {
      kind: 'cymbal',
      brass: 'radial-gradient(circle at 38% 30%,#c9a678,#9d7c4e 44%,#6d5433 78%)',
      bell: 'radial-gradient(circle at 40% 32%,#c0a074,#7e6340)',
      hole: '#151210',
      labelBottom: '11%', labelRotate: '-16deg',
      labelSize: 'clamp(7px,.85vw,10px)', labelTrack: '.16em',
    },
  },
  {
    pad: 'splash', label: 'SPLASH', left: '28%', top: '12%', width: '10%', z: 1,
    shadow: '0 8px 18px -11px #000',
    spec: {
      kind: 'cymbal',
      brass: 'radial-gradient(circle at 38% 30%,#c4a97c,#96814f 46%,#655433 80%)',
      bell: 'radial-gradient(circle at 40% 32%,#bda876,#7a6740)',
      hole: '#151310',
      labelBottom: '9%', labelRotate: '-14deg',
      labelSize: 'clamp(6px,.72vw,9px)', labelTrack: '.14em',
      labelColor: 'rgba(20,16,8,.6)',
    },
  },
  {
    pad: 'crash2', label: 'CRASH 2', left: '46%', top: '11%', width: '12.4%', z: 1,
    shadow: '0 10px 22px -12px #000',
    spec: {
      kind: 'cymbal',
      brass: 'radial-gradient(circle at 38% 30%,#cba57a,#9d7a50 44%,#6c5133 78%)',
      bell: 'radial-gradient(circle at 40% 32%,#c19f77,#7d6141)',
      hole: '#151110',
      labelBottom: '10%', labelRotate: '-15deg',
      labelSize: 'clamp(7px,.82vw,10px)', labelTrack: '.16em',
      labelColor: 'rgba(20,13,8,.62)',
    },
  },
  {
    pad: 'ride', label: 'RIDE', left: '67%', top: '20%', width: '16%', z: 1,
    shadow: '0 12px 26px -13px #000',
    spec: {
      kind: 'cymbal', lathe: LATHE_RIDE,
      brass: 'radial-gradient(circle at 36% 28%,#cdac7b,#a0814f 42%,#6d5732 76%)',
      bell: 'radial-gradient(circle at 40% 32%,#c3a678,#7e6641)',
      hole: '#151310',
      labelBottom: '12%', labelRotate: '-18deg',
      labelSize: 'clamp(8px,.9vw,11px)', labelTrack: '.18em',
      labelColor: 'rgba(20,15,8,.62)',
    },
  },
  {
    pad: 'hhc', label: 'CLOSED HH', left: '11%', top: '60%', width: '11.6%', z: 2,
    shadow: '0 9px 20px -12px #000',
    spec: {
      kind: 'cymbal',
      brass: 'radial-gradient(circle at 38% 30%,#c6a77a,#987d4f 46%,#665231 80%)',
      bell: 'radial-gradient(circle at 40% 32%,#bda476,#7a6440)',
      hole: '#151210',
      labelBottom: '10%', labelRotate: '-20deg',
      labelSize: 'clamp(6px,.74vw,9px)', labelTrack: '.12em',
    },
  },
  {
    pad: 'hho', label: 'OPEN HH', left: '8%', top: '86%', width: '10.8%', z: 2,
    shadow: '0 9px 20px -12px #000',
    spec: {
      kind: 'cymbal',
      brass: 'radial-gradient(circle at 38% 30%,#c3a577,#95794c 46%,#63502f 80%)',
      bell: 'radial-gradient(circle at 40% 32%,#baa173,#77613d)',
      hole: '#151210',
      labelBottom: '10%', labelRotate: '-20deg',
      labelSize: 'clamp(6px,.74vw,9px)', labelTrack: '.12em',
    },
  },
  {
    pad: 'tom1', label: 'TOM 1', left: '31%', top: '33%', width: '11.6%', z: 3,
    shadow: '0 14px 26px -14px #000',
    spec: {
      kind: 'drum', shell: TOM_SHELL, head: TOM_HEAD,
      rimColor: 'var(--ac)', rimWidth: '4px', rimOpacity: '.9',
      labelColor: '#7c8189', labelSize: 'clamp(7px,.82vw,10px)', labelTrack: '.14em',
    },
  },
  {
    pad: 'tom2', label: 'TOM 2', left: '45%', top: '31%', width: '11%', z: 3,
    shadow: '0 14px 26px -14px #000',
    spec: {
      kind: 'drum', shell: TOM_SHELL, head: TOM_HEAD,
      rimColor: 'var(--ac)', rimWidth: '4px', rimOpacity: '.9',
      labelColor: '#7c8189', labelSize: 'clamp(7px,.82vw,10px)', labelTrack: '.14em',
    },
  },
  {
    pad: 'tom3', label: 'TOM 3', left: '57%', top: '35%', width: '11%', z: 3,
    shadow: '0 14px 26px -14px #000',
    spec: {
      kind: 'drum', shell: TOM_SHELL, head: TOM_HEAD,
      rimColor: 'var(--ac)', rimWidth: '4px', rimOpacity: '.9',
      labelColor: '#7c8189', labelSize: 'clamp(7px,.82vw,10px)', labelTrack: '.14em',
    },
  },
  {
    pad: 'floor', label: 'FLOOR', left: '71%', top: '62%', width: '14.8%', z: 3,
    shadow: '0 16px 30px -14px #000',
    spec: {
      kind: 'drum', shell: TOM_SHELL,
      head: 'radial-gradient(circle at 42% 30%,#22242a,#121417 76%)',
      rimColor: 'var(--ac)', rimWidth: '5px', rimOpacity: '.9', headInset: '14%',
      labelColor: '#828790', labelSize: 'clamp(8px,.88vw,11px)', labelTrack: '.16em',
    },
  },
  {
    pad: 'snare', label: 'SNARE', left: '40%', top: '60%', width: '13.4%', z: 4,
    shadow: '0 16px 30px -14px #000',
    spec: {
      kind: 'drum',
      shell: 'radial-gradient(circle at 40% 26%,#33373c,#1b1e21 60%,#0f1112)',
      head: 'radial-gradient(circle at 42% 28%,#cfd2d0,#9a9d99 80%)',
      rimColor: '#8d939a', rimWidth: '4px',
      labelColor: '#33373c', labelSize: 'clamp(9px,1vw,13px)', labelTrack: '.18em',
    },
  },
  {
    pad: 'kick', label: 'KICK', left: '25%', top: '78%', width: '16.4%', z: 5,
    shadow: '0 20px 36px -16px #000',
    spec: {
      kind: 'drum', shell: KICK_SHELL, head: KICK_HEAD, badge: KICK_BADGE,
      rimColor: '#9a825f', rimWidth: '4px', rimInset: '4%', headInset: '12%',
      labelColor: '#2a2d30', labelSize: 'clamp(10px,1.25vw,17px)', labelTrack: '.02em',
    },
  },
  {
    pad: 'kick2', label: 'KICK 2', left: '45%', top: '78%', width: '16.4%', z: 5,
    shadow: '0 20px 36px -16px #000',
    spec: {
      kind: 'drum', shell: KICK_SHELL, head: KICK_HEAD, badge: KICK_BADGE,
      rimColor: '#9a825f', rimWidth: '4px', rimInset: '4%', headInset: '12%',
      labelColor: '#2a2d30', labelSize: 'clamp(10px,1.25vw,17px)', labelTrack: '.02em',
    },
  },
];

export interface DrumsView extends View {
  /** Light a pad briefly, from a click, a key press or the sequencer. */
  flash(pad: PadName): void;
}

export function createDrums(session: Session): DrumsView {
  const nodes = new Map<PadName, HTMLElement>();
  const timers = new Map<PadName, number>();

  const board = el(
    'div',
    { class: 'kit__board' },
    PADS.map((entry) => {
      const pad = buildPad(entry, () => session.hitPad(entry.pad));
      nodes.set(entry.pad, pad);
      return el(
        'div',
        {
          class: 'kit__slot',
          style: { left: entry.left, top: entry.top, width: entry.width, zIndex: String(entry.z) },
        },
        [pad],
      );
    }),
  );

  return {
    el: el('div', { class: 'kit' }, [board]),
    update() {
      // The kit is static; hits are driven through flash().
    },
    flash(pad: PadName) {
      const node = nodes.get(pad);
      if (!node) return;
      node.classList.add('is-hit');
      clearTimeout(timers.get(pad));
      timers.set(pad, window.setTimeout(() => node.classList.remove('is-hit'), 110));
    },
  };
}

function buildPad(entry: Pad, onHit: () => void): HTMLElement {
  const { spec } = entry;

  const layers =
    spec.kind === 'cymbal'
      ? [
          el('i', { class: 'pad__bell', style: { background: spec.bell } }),
          el('i', { class: 'pad__hole', style: { background: spec.hole } }),
          el('span', {
            class: 'pad__label--edge',
            text: entry.label,
            vars: {
              '--label-bottom': spec.labelBottom,
              '--label-rotate': spec.labelRotate,
              '--label-size': spec.labelSize,
              '--label-track': spec.labelTrack,
            },
            style: spec.labelColor ? { color: spec.labelColor } : {},
          }),
        ]
      : [
          el('i', { class: 'pad__rim' }),
          el('i', { class: 'pad__head', style: { background: spec.head } }),
          spec.badge
            ? el('i', { class: 'pad__badge', style: { background: spec.badge } }, [
                el('span', {
                  class: 'pad__label--centre',
                  text: entry.label,
                  vars: {
                    '--label-size': spec.labelSize,
                    '--label-track': spec.labelTrack,
                    '--label-color': spec.labelColor,
                  },
                  style: { position: 'static', translate: 'none' },
                }),
              ])
            : el('span', {
                class: 'pad__label--centre',
                text: entry.label,
                vars: {
                  '--label-size': spec.labelSize,
                  '--label-track': spec.labelTrack,
                  '--label-color': spec.labelColor,
                },
              }),
        ];

  const background =
    spec.kind === 'cymbal' ? `${spec.lathe ?? LATHE},${spec.brass}` : spec.shell;

  const vars: Record<string, string> = {};
  if (spec.kind === 'drum') {
    vars['--rim-color'] = spec.rimColor;
    vars['--rim-width'] = spec.rimWidth;
    if (spec.rimInset) vars['--rim-inset'] = spec.rimInset;
    if (spec.rimOpacity) vars['--rim-opacity'] = spec.rimOpacity;
    if (spec.headInset) vars['--head-inset'] = spec.headInset;
  }

  return button(
    {
      class: 'pad',
      title: entry.label,
      attrs: { 'aria-label': entry.label },
      style: { background, boxShadow: entry.shadow },
      vars,
      on: {
        pointerdown: (event) => {
          event.preventDefault();
          onHit();
        },
      },
    },
    layers,
  );
}
