import { describe, expect, it } from 'vitest';
import { STEPS } from './tour.ts';
import { MOMENT_GROUPS } from '../../timeline/types.ts';

describe('the walkthrough', () => {
  it('says something at every step', () => {
    expect(STEPS.length).toBeGreaterThan(4);
    for (const step of STEPS) {
      expect(step.title.trim()).not.toBe('');
      // Long enough to be worth stopping for, short enough to be read while
      // somebody is waiting to get on with it.
      expect(step.body.length).toBeGreaterThan(60);
      expect(step.body.length).toBeLessThan(420);
    }
  });

  it('points at something at every step', () => {
    /*
     * A step with nothing to point at dims the page and puts its card in the
     * middle, which is the tour saying "somewhere over there". That is the
     * fallback for a screen this cannot reach, not a thing to write on purpose.
     */
    for (const step of STEPS) {
      expect(step.target, `"${step.title}" points at nothing`).toBeTruthy();
    }
  });

  it('names which panel each step needs', () => {
    /*
     * Half of what there is to say lives behind a tab. Every step naming one
     * is what makes going back land on the same screens as going forward.
     */
    for (const step of STEPS) {
      expect(['moments', 'sounds', 'selected']).toContain(step.tab);
    }
  });

  it('opens a group of the library that exists, where a step wants one', () => {
    // A group id that is not there would leave the step pointing at a folded
    // browser, with nothing on screen to say why.
    const ids = new Set(MOMENT_GROUPS.map((group) => group.id));
    for (const step of STEPS) {
      if (!step.reveal) continue;
      expect(ids, `"${step.title}" opens a group that is not there`).toContain(step.reveal);
      // And the thing it points at has to be that group.
      expect(step.target).toContain(step.reveal);
    }
  });

  it('only opens a group on a step that is looking at the library', () => {
    for (const step of STEPS) {
      if (step.reveal) expect(step.tab).toBe('sounds');
    }
  });

  it('starts on the video and ends on the export', () => {
    // The order the work happens in, which is the only order worth walking.
    expect(STEPS[0].target).toBe('.vstage');
    expect(STEPS[STEPS.length - 1].target).toContain('export');
  });

  it('says nothing twice', () => {
    const titles = STEPS.map((step) => step.title);
    expect(new Set(titles).size).toBe(titles.length);
    const targets = STEPS.map((step) => step.target);
    expect(new Set(targets).size).toBe(targets.length);
  });
});
