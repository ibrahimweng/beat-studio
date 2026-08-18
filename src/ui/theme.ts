/** Ground finishes offered by the Toolcraft token set. */
export type Finish = 'black' | 'dark' | 'slate';

const FINISHES: Record<Finish, string> = {
  black: 'oklch(0 0 0)',
  dark: 'oklch(0.145 0 0)',
  slate: 'oklch(0.17 0.012 279)',
};

const DEFAULT_ACCENT = '#0c8ce9';

/** Accents the design ships with; any valid hex is accepted too. */
export const ACCENT_PRESETS = ['#0c8ce9', '#70b0fa', '#9149f5', '#ea733a'] as const;

export interface ThemeOptions {
  accent?: string;
  finish?: Finish;
}

/** Only plain hex colours are allowed — the value can come from the URL. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function isFinish(value: string): value is Finish {
  return value in FINISHES;
}

/**
 * Push accent and ground onto the document root.
 *
 * The rest of the token system is static CSS; only these two are variable,
 * which is exactly the split the original design exposed as canvas props.
 */
export function applyTheme({ accent, finish }: ThemeOptions = {}): void {
  const root = document.documentElement;

  const color = accent && HEX.test(accent) ? accent : DEFAULT_ACCENT;
  root.style.setProperty('--ac', color);
  root.style.setProperty('--ac-soft', `color-mix(in oklab, ${color} 14%, transparent)`);
  root.style.setProperty('--ac-line', `color-mix(in oklab, ${color} 34%, transparent)`);

  const ground = FINISHES[finish ?? 'black'];
  root.style.setProperty('--bg', ground);
  root.style.setProperty('--side', ground);
  root.style.setProperty('--stage', ground);
}

/**
 * Read theme options from the query string, so a particular look can be
 * linked to: `?accent=%239149f5&finish=slate`.
 */
export function themeFromUrl(search = window.location.search): ThemeOptions {
  const params = new URLSearchParams(search);
  const options: ThemeOptions = {};

  const accent = params.get('accent');
  if (accent) {
    const value = accent.startsWith('#') ? accent : `#${accent}`;
    if (HEX.test(value)) options.accent = value;
  }

  const finish = params.get('finish');
  if (finish && isFinish(finish)) options.finish = finish;

  return options;
}

/** Convert a hex colour to an `rgba(...)` string at the given alpha. */
export function rgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}
