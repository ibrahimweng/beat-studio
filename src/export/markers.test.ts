import { describe, expect, it } from 'vitest';
import { emptyProject, makeCue } from '../timeline/project.ts';
import type { CueSource, Project } from '../timeline/types.ts';
import { markerCsv } from './markers.ts';

function projectWith(times: readonly number[], fps = 30): Project {
  return {
    ...emptyProject(),
    fps,
    duration: 30,
    cues: times.map((at) => makeCue(at, 'impacts', { kind: 'design', name: 'impact' } as CueSource)),
  };
}

/** The rows, split into columns, without the header. */
function rows(csv: string): string[][] {
  return csv.trim().split('\n').slice(1).map((line) => line.split(','));
}

/*
 * A marker list is handed to somebody laying the sound against picture, and
 * every column in it is a claim about which frame a sound is on.
 */
describe('the marker list', () => {
  /*
   * The fault this was written for.
   *
   * The frame column was rounded from the time and the timecode column was
   * floored from the fraction of a second, so the two disagreed whenever
   * floating point put them either side of a boundary. A sound at 2.3
   * seconds was written as frame 69 next to a timecode of 00:00:02:08, which
   * is frame 68. Whoever reads that has to pick one, with nothing to say
   * which is right.
   */
  it('says the same frame in both of its frame columns', () => {
    const fps = 30;
    const times: number[] = [];
    for (let frame = 0; frame < fps * 60; frame++) times.push(frame / fps);
    const disagreed = rows(markerCsv(projectWith(times, fps)))
      .filter((row) => row[3] !== 'end of sound')
      .filter((row) => Number(row[0].split(':')[3]) !== Number(row[2]) % fps)
      .map((row) => `${row[0]} vs frame ${row[2]}`);
    expect(disagreed.slice(0, 8), `${disagreed.length} rows disagreed with themselves`).toEqual([]);
  });

  it('puts a sound on the frame it was placed on', () => {
    const [first, second] = rows(markerCsv(projectWith([2.3, 7.3])));
    expect(first[0]).toBe('00:00:02:09');
    expect(first[2]).toBe('69');
    expect(second[0]).toBe('00:00:07:09');
    expect(second[2]).toBe('219');
  });

  it('still writes a header and a closing row', () => {
    const csv = markerCsv(projectWith([1]));
    expect(csv.split('\n')[0]).toBe('timecode,seconds,frame,sound,layer,lands,length,level');
    expect(rows(csv).at(-1)?.[3]).toBe('end of sound');
  });
});
