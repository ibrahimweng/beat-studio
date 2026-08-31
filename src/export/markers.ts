import { audibleCues, cueLength, cueStart, frameAt, timecode } from '../timeline/project.ts';
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
    /*
     * One frame number, written twice.
     *
     * The two columns used to be worked out separately -- the frame rounded
     * from the time, the timecode floored from the fraction of a second --
     * and disagreed whenever floating point put those on either side of a
     * boundary. A sound at 2.3 seconds was written as frame 69 on the same
     * row that its timecode called 00:00:02:08, which is frame 68. Somebody
     * laying that up has to pick one and has no way to tell which.
     */
    const frame = frameAt(cue.time, project.fps);
    rows.push(
      [
        timecode(cue.time, project.fps),
        cue.time.toFixed(3),
        String(frame),
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
    [timecode(last, project.fps), last.toFixed(3), String(frameAt(last, project.fps)),
     'end of sound', '', '', '', ''].join(','),
  );

  return `${rows.join('\n')}\n`;
}

/** Quote a field only where it would otherwise break the row. */
function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
