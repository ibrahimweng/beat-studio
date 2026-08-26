import { audibleCues, cueLength, cueStart } from '../timeline/project.ts';
import type { Project } from '../timeline/types.ts';

/**
 * A list of where every sound lands.
 *
 * An audio file says what to play but not what is in it. Whoever picks the
 * work up next, or you in six months, gets a row per sound with the frame it
 * is on, what it is, and which layer it came from. It opens in a spreadsheet,
 * and the timecode column is the form editing software expects, so the list
 * can be read straight across as markers.
 *
 * Only the sounds that are actually heard are listed, so the file describes
 * the export it came with rather than the project behind it.
 */
export function markerCsv(project: Project): string {
  const rows = [
    ['timecode', 'seconds', 'frame', 'sound', 'layer', 'lands', 'length', 'level'].join(','),
  ];

  const layers = new Map(project.layers.map((layer) => [layer.id, layer.name]));
  const cues = [...audibleCues(project)].sort((a, b) => a.time - b.time);

  for (const cue of cues) {
    rows.push(
      [
        smpte(cue.time, project.fps),
        cue.time.toFixed(3),
        String(Math.round(cue.time * project.fps)),
        csv(String(cue.source.name)),
        csv(layers.get(cue.layerId) ?? cue.layerId),
        // Where the marker is relative to the sound, which is the difference
        // between a hit and the riser that arrives on it.
        cue.anchor === 'end' ? 'ends on it' : 'starts on it',
        cueLength(cue).toFixed(3),
        cue.gain.toFixed(2),
      ].join(','),
    );
  }

  // A last row for where the sound as a whole finishes, so anyone laying the
  // file up knows whether anything is still ringing past the end of the video.
  const last = cues.reduce((max, cue) => Math.max(max, cueStart(cue) + cueLength(cue)), 0);
  rows.push(
    [smpte(last, project.fps), last.toFixed(3), String(Math.round(last * project.fps)),
     'end of sound', '', '', '', ''].join(','),
  );

  return `${rows.join('\n')}\n`;
}

/** Hours, minutes, seconds and frames, which is the form editors read. */
function smpte(time: number, fps: number): string {
  const rate = fps || 30;
  const safe = Math.max(0, time);
  const whole = Math.floor(safe);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return [
    pad(Math.floor(whole / 3600)),
    pad(Math.floor((whole % 3600) / 60)),
    pad(whole % 60),
    pad(Math.floor((safe - whole) * rate)),
  ].join(':');
}

/** Quote a field only where it would otherwise break the row. */
function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
