import { button, el } from './dom.ts';

/**
 * Asking something, in the app's own voice.
 *
 * There were three `window.prompt` and `window.confirm` calls left, and they
 * were the only places the app dropped out of its own language: system chrome
 * in a system font, in the middle of a dark editor, styled by the browser and
 * placed by the operating system. They are also the only controls here that
 * cannot be made to look like anything, cannot say which of two answers is the
 * destructive one, and are suppressed outright in some embedded contexts —
 * where a confirm returns false and the thing you asked for silently does not
 * happen.
 *
 * So: one small modal, two shapes. It follows the help panel, which is the
 * app's existing overlay: a dimmed backdrop that closes on a click, Escape to
 * leave, and the same cards and chips as everything else.
 */

/** The one open at the moment, since two would be two answers to one question. */
let openAsk: (() => void) | null = null;

interface AskOptions {
  /** The question, as a heading. */
  title: string;
  /** What happens if they say yes, when that is not obvious from the title. */
  what?: string;
  /** The confirming button. */
  ok: string;
  /** Whether that button destroys something. */
  danger?: boolean;
  /** A single line to fill in, for the asking-for-a-name shape. */
  field?: { value: string; placeholder?: string; label: string };
}

/**
 * Put the question up and wait for an answer.
 *
 * Resolves with the typed text, or true, or null when it was refused — one
 * function because the two shapes differ only in whether there is a field, and
 * two copies of focus handling and Escape is how they drift apart.
 */
function ask(options: AskOptions): Promise<string | true | null> {
  openAsk?.();

  return new Promise((resolve) => {
    /*
     * Where focus was, so it can be given back.
     *
     * A modal that takes focus and does not return it leaves somebody who
     * works by keyboard at the top of the document, which in this app is a
     * long way from the button they just pressed.
     */
    const cameFrom = document.activeElement as HTMLElement | null;

    const field =
      options.field &&
      (el('input', {
        class: 'ask__field',
        type: 'text',
        attrs: {
          'aria-label': options.field.label,
          spellcheck: 'false',
          ...(options.field.placeholder ? { placeholder: options.field.placeholder } : {}),
        },
      }) as HTMLInputElement);
    if (field && options.field) field.value = options.field.value;

    const cancel = button(
      { class: 'chip chip--sm', on: { click: () => done(null) } },
      ['Cancel'],
    );

    const confirm = button(
      {
        class: options.danger ? 'chip chip--sm chip--danger' : 'btn-accent',
        on: { click: () => done(field ? field.value : true) },
      },
      [options.ok],
    );

    const card = el(
      'div',
      {
        class: 'ask__card',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title },
      },
      [
        el('div', { class: 'ask__title', text: options.title }),
        ...(options.what ? [el('div', { class: 'ask__what', text: options.what })] : []),
        ...(field ? [field] : []),
        el('div', { class: 'ask__row' }, [cancel, confirm]),
      ],
    );

    const root = el(
      'div',
      {
        class: 'ask',
        on: {
          // The dimmed area is a way out, as it is on the help panel. Presses
          // inside the card are not.
          pointerdown: (event) => {
            if (event.target === root) done(null);
          },
        },
      },
      [card],
    );

    /*
     * Keys, caught before anything else sees them.
     *
     * The app puts a great deal on the bare letters — six tools, thirteen drum
     * pads, the shuttle — and none of that should fire into a box somebody is
     * typing a name into. Capturing here and stopping everything is simpler
     * than teaching each of those to check whether a dialog is up, and it
     * cannot be forgotten by the next one added.
     */
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        done(null);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        done(field ? field.value : true);
        return;
      }
      /*
       * Tab is kept inside, which is what makes it a modal rather than a card
       * that happens to be on top: tabbing out lands on a timeline that cannot
       * be seen and should not be edited while a question is waiting.
       */
      if (event.key === 'Tab') {
        const stops: (HTMLInputElement | HTMLButtonElement)[] = [
          ...(field ? [field] : []),
          cancel,
          confirm,
        ];
        const at = stops.indexOf(document.activeElement as HTMLInputElement);
        const next = event.shiftKey ? at - 1 : at + 1;
        event.preventDefault();
        stops[(next + stops.length) % stops.length]?.focus();
        return;
      }
      event.stopPropagation();
    };

    /*
     * A flag rather than comparing against the closer itself.
     *
     * The first version of this asked whether the open dialog was this one by
     * identity, and then registered a wrapper around the closer instead of the
     * closer — so the comparison never matched, every answer returned early,
     * and Escape left an overlay on top of an app it had made unreachable. A
     * boolean cannot be got wrong that way.
     */
    let answered = false;

    function done(answer: string | true | null): void {
      if (answered) return;
      answered = true;
      openAsk = null;
      root.remove();
      window.removeEventListener('keydown', onKey, true);
      cameFrom?.focus?.();
      resolve(answer);
    }

    // Superseded by a later question: refused, so whoever asked this one is
    // not left waiting on a promise nothing will settle.
    openAsk = () => done(null);
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(root);

    /*
     * A field is there to be typed in, so it takes focus and its contents are
     * ready to be replaced. A question with no field starts on Cancel: these
     * are the destructive ones, and a stray Return should not be what throws
     * away a project.
     */
    if (field) {
      field.focus();
      field.select();
    } else {
      cancel.focus();
    }
  });
}

/** Ask for a line of text. Resolves with what was typed, or null if refused. */
export async function askText(options: {
  title: string;
  what?: string;
  label: string;
  value?: string;
  placeholder?: string;
  ok?: string;
}): Promise<string | null> {
  const answer = await ask({
    title: options.title,
    ...(options.what ? { what: options.what } : {}),
    ok: options.ok ?? 'Save',
    field: {
      value: options.value ?? '',
      label: options.label,
      ...(options.placeholder ? { placeholder: options.placeholder } : {}),
    },
  });
  return typeof answer === 'string' ? answer : null;
}

/** Ask a yes or no question. Resolves false unless it was actually agreed to. */
export async function askYesNo(options: {
  title: string;
  what?: string;
  ok: string;
  danger?: boolean;
}): Promise<boolean> {
  return (await ask(options)) === true;
}
