import type { AppState, Draft, Reader } from '../../store.ts';
import type { VoiceoverSession } from '../../voiceover-session.ts';
import { button, clear, el, setText, toggleClass } from '../dom.ts';
import { helpButton } from '../help.ts';
import type { View } from '../view.ts';
import { waveform } from '../waveform.ts';

/**
 * Putting a voice to a script, on a screen of its own.
 *
 * The third screen, and the shape follows the second: a bar, a body that fills,
 * and a foot saying what just happened next to what can be done about it.
 *
 * The order down the page is the order of the work. Who is reading, then what
 * they are reading, then the take that came back. Designing a narrator is folded
 * away under the picker rather than given equal weight, because most of the time
 * the catalogue already has the voice somebody wants and describing one is four
 * steps and a wait.
 *
 * What it deliberately does not have is a timeline. A take goes to the piece and
 * the piece is where it is placed, trimmed and balanced — the same division as
 * the screen that takes a beat apart.
 */
export function createVoiceoverScreen(session: VoiceoverSession): View {
  /* ---------------------------------------------------------------- the bar */

  const title = el('div', { class: 'appbar__title', text: 'Voiceover' });

  const bar = el('header', { class: 'topbar appbar' }, [
    title,
    el('div', { class: 'topbar__spacer' }),
    helpButton('voiceover', 'making a voiceover'),
  ]);

  /* ------------------------------------------------------------ the narrator */

  const readers = el('select', {
    class: 'vo__readers',
    attrs: { 'aria-label': 'Who reads it' },
    on: {
      change: (event) => session.choose((event.currentTarget as HTMLSelectElement).value),
    },
  }) as HTMLSelectElement;

  /**
   * Describing a narrator, folded away until it is asked for.
   *
   * It is the longer road and the screen says so by putting it behind a
   * disclosure: the catalogue is four hundred voices that work immediately,
   * where a description is a sample, a wait, an audition and a decision.
   */
  const describing = el('input', {
    class: 'vo__describe',
    type: 'text',
    attrs: {
      'aria-label': 'Describe a narrator',
      placeholder: 'A British narrator in his fifties, warm and unhurried…',
      maxlength: '500',
      spellcheck: 'false',
    },
    on: {
      input: (event) => session.setDescribing((event.currentTarget as HTMLInputElement).value),
    },
  }) as HTMLInputElement;

  const language = el('select', {
    class: 'vo__language',
    attrs: { 'aria-label': 'Which language' },
    on: {
      change: (event) => session.setLanguage((event.currentTarget as HTMLSelectElement).value),
    },
  }) as HTMLSelectElement;
  for (const [code, name] of LANGUAGES) {
    language.appendChild(el('option', { text: name, attrs: { value: code } }));
  }

  const findThem = button(
    {
      class: 'chip chip--sm',
      title: 'Sample three narrators from that description. It takes a few seconds',
      on: { click: () => void session.describeNarrators() },
    },
    ['Find three'],
  );

  const drafts = el('div', { class: 'vo__drafts' });

  const design = el('details', { class: 'vo__design' }, [
    el('summary', { class: 'vo__summary', text: 'Or describe one that is not in the list' }),
    el('div', { class: 'vo__designbody' }, [
      el('div', { class: 'vo__row' }, [describing, language, findThem]),
      el('p', {
        class: 'hint',
        text:
          'Name the age, the accent, the pitch, the pace and what it is for. Three ' +
          'come back to listen to; keeping one is what lets it read a whole script.',
      }),
      drafts,
    ]),
  ]);

  /* -------------------------------------------------------------- the script */

  const script = el('textarea', {
    class: 'vo__script',
    attrs: {
      'aria-label': 'The script',
      placeholder: 'What should they say?',
      rows: '6',
      maxlength: String(MOST),
    },
    on: {
      input: (event) => session.setScript((event.currentTarget as HTMLTextAreaElement).value),
    },
  }) as HTMLTextAreaElement;

  const counted = el('span', { class: 'micro-label vo__counted' });

  const read = button(
    {
      class: 'btn-accent',
      title: 'Read the script in the chosen voice',
      on: { click: () => void session.read() },
    },
    ['Read it'],
  );

  /* ---------------------------------------------------------------- the take */

  const takeName = el('div', { class: 'vo__takename' });
  const takeWave = el('div', { class: 'vo__wave' });
  const hear = button(
    { class: 'chip chip--sm', title: 'Hear it', on: { click: () => void session.hear() } },
    ['▶'],
  );
  const place = button(
    {
      class: 'btn-accent',
      title: 'Put it on the timeline, on a layer of its own',
      on: { click: () => session.place() },
    },
    ['Place on the timeline'],
  );
  const take = el('div', { class: 'vo__take' }, [
    el('div', { class: 'vo__takehead' }, [takeName, el('div', { class: 'topbar__spacer' }), hear]),
    takeWave,
  ]);

  /* ------------------------------------------------------------- the nothing */

  const off = el('div', { class: 'vo__nothing' }, [
    el('div', { class: 'vo__nothing-title', text: 'The voiceover is off here' }),
    el('p', {
      class: 'hint',
      text:
        'This deployment has no Gradium key set, so there is nothing to ask. ' +
        'Everything else in the app works exactly as it did.',
    }),
    el('p', {
      class: 'hint',
      text:
        'Set GRADIUM_KEY in the deployment’s environment and it turns on. The key ' +
        'stays on the server and never reaches this page.',
    }),
  ]);

  const busy = el('div', { class: 'vo__busy' });
  const said = el('div', { class: 'vo__said' });

  const working = el('div', { class: 'vo__working' }, [
    el('div', { class: 'vo__block' }, [
      el('div', { class: 'micro-label', text: 'Who reads it' }),
      readers,
      design,
    ]),
    el('div', { class: 'vo__block' }, [
      el('div', { class: 'vo__row' }, [
        el('div', { class: 'micro-label', text: 'What they read' }),
        el('div', { class: 'topbar__spacer' }),
        counted,
      ]),
      script,
    ]),
    take,
  ]);

  const actions = el('div', { class: 'vo__actions' }, [
    read,
    place,
    el('div', { class: 'topbar__spacer' }),
    button(
      {
        class: 'chip chip--sm',
        title: 'Stop whatever is playing',
        on: { click: () => session.stop() },
      },
      ['Stop'],
    ),
    button(
      {
        class: 'chip chip--sm chip--danger',
        title: 'Clear the take and any drafts. Anything you placed stays',
        on: { click: () => session.clear() },
      },
      ['Forget'],
    ),
  ]);

  const foot = el('div', { class: 'vo__foot' }, [said, actions]);
  const root = el('div', { class: 'vo' }, [
    bar,
    el('div', { class: 'vo__body' }, [busy, off, working]),
    foot,
  ]);

  /* ------------------------------------------------------------- redrawing */

  /** What the narrator list was last drawn from, so it is rebuilt only when it moves. */
  let drawnReaders: readonly Reader[] | null = null;
  let drawnDrafts: readonly Draft[] | null = null;
  let drawnTake: string | null = null;

  const paint = (state: AppState['voiceover']): void => {
    const on = state.on !== false;
    off.style.display = state.on === false ? 'block' : 'none';
    working.style.display = on ? 'flex' : 'none';

    busy.style.display = state.busy ? 'block' : 'none';
    setText(busy, state.busy ?? '');

    setText(said, state.said ?? '');
    said.style.display = state.said ? 'block' : 'none';
    foot.style.display = on ? 'block' : 'none';

    if (drawnReaders !== state.readers) {
      drawnReaders = state.readers;
      clear(readers);
      for (const one of state.readers) {
        readers.appendChild(
          el('option', {
            text: one.about ? `${one.name} — ${one.about}` : one.name,
            attrs: { value: one.id },
          }),
        );
      }
    }
    if (state.reader && readers.value !== state.reader) readers.value = state.reader;
    if (document.activeElement !== language) language.value = state.language;
    if (document.activeElement !== describing) describing.value = state.describing;
    if (document.activeElement !== script) script.value = state.script;

    setText(counted, `${state.script.length} of ${MOST}`);
    toggleClass(counted, 'is-full', state.script.length >= MOST);

    const busyNow = state.busy !== null;
    read.disabled = busyNow || !state.script.trim() || !state.reader;
    place.disabled = busyNow || !state.take;
    findThem.disabled = busyNow || !state.describing.trim();
    setText(hear, state.hearing ? '■' : '▶');

    if (drawnDrafts !== state.drafts) {
      drawnDrafts = state.drafts;
      clear(drafts);
      state.drafts.forEach((one, at) => drafts.appendChild(draftRow(one, at)));
    }

    take.style.display = state.take ? 'block' : 'none';
    if (state.take && drawnTake !== state.take.sampleId) {
      drawnTake = state.take.sampleId;
      setText(takeName, `${state.take.name} · ${length(state.take.seconds)}`);
      clear(takeWave);
      takeWave.appendChild(waveform(state.take.peaks, { svg: 'vo__svg', path: 'vo__path' }));
    }
    if (!state.take) drawnTake = null;
  };

  /** One draft narrator: hear it, or keep it. */
  function draftRow(draft: Draft, at: number): HTMLElement {
    return el('div', { class: 'vo__draft', dataset: { draft: draft.id } }, [
      el('span', { class: 'vo__draftname', text: `Narrator ${at + 1}` }),
      el('div', { class: 'topbar__spacer' }),
      button(
        {
          class: 'chip chip--sm',
          title: 'Hear this one read the first line of your script',
          on: { click: () => void session.hearDraft(draft.id) },
        },
        ['▶'],
      ),
      button(
        {
          class: 'chip chip--sm',
          title:
            'Keep this one. It becomes a narrator that can read a whole script, and ' +
            'the others are thrown away',
          on: { click: () => void session.keepDraft(draft.id, describing.value) },
        },
        ['Keep this one'],
      ),
    ]);
  }

  return {
    el: root,
    update(state: AppState) {
      paint(state.voiceover);
    },
  };
}

/** How long a script can be, which is the proxy's limit said on screen. */
const MOST = 2000;

/** The languages a described narrator can be made for. */
const LANGUAGES: readonly (readonly [string, string])[] = [
  ['en', 'English'],
  ['fr', 'French'],
  ['de', 'German'],
  ['es', 'Spanish'],
  ['pt', 'Portuguese'],
];

/** A length in minutes and seconds. */
function length(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
