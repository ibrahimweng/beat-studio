import { svg } from './dom.ts';

/**
 * A recording's waveform, as one filled shape.
 *
 * SVG rather than a canvas, because the row's width is decided by the layout and
 * a canvas would have to be measured and redrawn on every resize. A path with no
 * fixed aspect ratio stretches to whatever it is given and stays crisp.
 *
 * Here rather than on either screen because two of them draw one now: a
 * separated part, and a voiceover take. The class names are passed in rather
 * than fixed, so each screen keeps its own stylesheet and neither has to know
 * about the other.
 */
export function waveform(
  peaks: Float32Array,
  classes: { svg: string; path: string },
): SVGElement {
  const wide = Math.max(1, peaks.length);
  const tall = 40;
  const middle = tall / 2;
  let top = '';
  let bottom = '';
  for (let at = 0; at < wide; at++) {
    // Never quite nothing, so a silent recording is a line rather than an absence.
    const half = Math.max(0.4, (peaks[at] ?? 0) * middle);
    top += `${at === 0 ? 'M' : 'L'}${at} ${middle - half}`;
    const back = wide - 1 - at;
    bottom = `L${back} ${middle + Math.max(0.4, (peaks[back] ?? 0) * middle)}` + bottom;
  }

  return svg(
    'svg',
    { class: classes.svg, viewBox: `0 0 ${wide} ${tall}`, preserveAspectRatio: 'none' },
    [svg('path', { d: `${top}${bottom}Z`, class: classes.path })],
  );
}

/**
 * The loudest sample in each slice of a recording, for drawing it.
 *
 * The loudest rather than the average, because an average of a waveform is
 * roughly nothing however loud it is: a voiceover drawn from its mean would be a
 * flat line with the odd bump.
 *
 * Not the counter in `audio/separate/written.ts`, which fills a waveform while a
 * part is being written and never reads a finished one. This reads a recording
 * that already exists, which is the other half of the same idea and is what
 * anything arriving as a file needs.
 */
export function peaksOf(buffer: AudioBuffer, count: number): Float32Array {
  const out = new Float32Array(count);
  const lanes: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) lanes.push(buffer.getChannelData(c));
  const per = buffer.length / count;

  for (let at = 0; at < count; at++) {
    const from = Math.floor(at * per);
    const to = Math.min(buffer.length, Math.floor((at + 1) * per));
    let most = 0;
    for (const lane of lanes) {
      for (let i = from; i < to; i++) {
        const loud = Math.abs(lane[i]);
        if (loud > most) most = loud;
      }
    }
    out[at] = Math.min(1, most);
  }
  return out;
}
