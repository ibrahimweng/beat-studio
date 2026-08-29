import { describe, expect, it } from 'vitest';
import { LAYER_JOBS, layerJob, DESIGN_DEFAULT_ANCHOR, MOMENT_GROUPS } from './types.ts';
import type { Cue, CueSource, DesignName, Project } from './types.ts';
import { addLayer, density, emptyProject, makeCue } from './project.ts';

function project(cues: Cue[] = [], over: Partial<Project> = {}): Project {
  return { ...emptyProject(), duration: 30, cues, ...over };
}

const design = (name: string, at: number, over: Partial<Cue> = {}): Cue => ({
  ...makeCue(at, 'impacts', { kind: 'design', name } as CueSource),
  ...over,
});

describe('what each layer is for', () => {
  it('describes every layer the project starts with', () => {
    const starting = emptyProject().layers;
    expect(starting).toHaveLength(LAYER_JOBS.length);
    for (const layer of starting) {
      const job = layerJob(layer.id);
      expect(job, `${layer.name} has no job`).not.toBeNull();
      expect(job!.name).toBe(layer.name);
    }
  });

  it('says something worth reading about each', () => {
    for (const job of LAYER_JOBS) {
      expect(job.job.length).toBeGreaterThan(30);
      expect(job.job).not.toBe(job.name);
    }
  });

  it('puts them in an order, loudest first', () => {
    /*
     * A mix is mostly an order of importance. If two layers sat at the same
     * level the order would say nothing, which is the state this replaced.
     */
    const levels = LAYER_JOBS.map((job) => job.level);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeLessThan(levels[i - 1]);
    }
    // Quieter, not gone.
    expect(levels[levels.length - 1]).toBeGreaterThan(0.2);
  });

  it('knows nothing about a layer somebody added', () => {
    const added = addLayer(emptyProject(), 'Foley');
    const theirs = added.layers[added.layers.length - 1];
    expect(layerJob(theirs.id)).toBeNull();
  });
});

describe('balancing', () => {
  /** What the session does, as the pure part of it. */
  const balanced = (p: Project): Project => ({
    ...p,
    layers: p.layers.map((layer) => {
      const job = layerJob(layer.id);
      return job ? { ...layer, gain: job.level } : layer;
    }),
  });

  it('takes a flat piece and gives it an order', () => {
    const flat = emptyProject();
    expect(new Set(flat.layers.map((l) => l.gain)).size).toBe(1);

    const after = balanced(flat).layers.map((l) => l.gain);
    expect(new Set(after).size).toBe(after.length);
    for (let i = 1; i < after.length; i++) {
      expect(after[i]).toBeLessThan(after[i - 1]);
    }
  });

  it('leaves a layer somebody added exactly as it was', () => {
    const added = addLayer(emptyProject(), 'Foley');
    const theirs = added.layers.length - 1;
    const before = { ...added, layers: added.layers.map((l, i) => (i === theirs ? { ...l, gain: 0.31 } : l)) };
    expect(balanced(before).layers[theirs].gain).toBe(0.31);
  });

  it('changes nothing about what is placed', () => {
    // It is four numbers on four layers. A sound's own level, length and room
    // are its own, and balancing is not an excuse to touch them.
    const before = project([design('impact', 1, { gain: 0.4 })]);
    expect(balanced(before).cues).toEqual(before.cues);
  });
});

describe('how crowded a piece is', () => {
  it('counts the sounds against the length of the picture', () => {
    const cues = Array.from({ length: 30 }, (_, i) => design('impact', i * 0.5));
    expect(density(project(cues, { duration: 30 }))).toBeCloseTo(1, 5);
  });

  it('leaves out anything silenced, since it is not in the audio either', () => {
    const cues = [
      ...Array.from({ length: 10 }, (_, i) => design('impact', i)),
      ...Array.from({ length: 10 }, (_, i) => design('thud', i, { muted: true })),
    ];
    expect(density(project(cues, { duration: 10 }))).toBeCloseTo(1, 5);
  });

  it('says nothing about an empty piece rather than dividing by nothing', () => {
    expect(density(project([], { duration: 30 }))).toBe(0);
    expect(density(project([design('impact', 1)], { duration: 0 }))).toBeGreaterThan(0);
    expect(Number.isFinite(density(project([], { duration: 0 })))).toBe(true);
  });

  it('measures a piece with no clip against the sounds themselves', () => {
    const cues = [design('impact', 0), design('impact', 4)];
    const rate = density(project(cues, { duration: 0 }));
    expect(rate).toBeGreaterThan(0);
    expect(Number.isFinite(rate)).toBe(true);
  });

  it('reads a wall as crowded and a considered pass as not', () => {
    const wall = Array.from({ length: 200 }, (_, i) => design('impact', i * 0.15));
    const considered = Array.from({ length: 40 }, (_, i) => design('impact', i * 0.75));
    expect(density(project(wall, { duration: 30 }))).toBeGreaterThan(2);
    expect(density(project(considered, { duration: 30 }))).toBeLessThan(2);
  });
});

describe('the mistake that was already settled in the data', () => {
  it('makes every lead-in finish on the marker rather than start on it', () => {
    /*
     * The commonest mistake in this craft, and it needs no button: a riser
     * that starts on the hit arrives after the picture has already moved. The
     * three voices that lead somewhere carry the answer themselves, so a
     * newcomer gets it right without knowing there was a question.
     */
    for (const name of ['riser', 'swell', 'reverse'] as const) {
      expect(DESIGN_DEFAULT_ANCHOR[name], `${name} should end on the marker`).toBe('end');
    }
  });

  it('starts every voice that is the moment rather than the run-up on it', () => {
    for (const name of ['impact', 'thud', 'slam', 'whoosh', 'tick', 'click'] as const) {
      expect(DESIGN_DEFAULT_ANCHOR[name]).toBe('start');
    }
  });

  it('anchors what a cue is made with, so a placed riser lands right', () => {
    const riser = makeCue(5, 'movement', { kind: 'design', name: 'riser' });
    expect(riser.anchor).toBe('end');
  });

  it('leaves every lead-in in the group that leads somewhere', () => {
    // So that the default and the place somebody finds it agree.
    const builds = MOMENT_GROUPS.find((group) => group.id === 'builds')!;
    for (const name of builds.names) {
      if (DESIGN_DEFAULT_ANCHOR[name as DesignName] === 'end') continue;
      // Not every sound in the group leads with its tail, but the three that
      // do must be here rather than somewhere else.
      expect(['swarm', 'shimmer']).toContain(name);
    }
  });
});
