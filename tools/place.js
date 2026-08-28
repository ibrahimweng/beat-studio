/**
 * Putting a cue somewhere it can be its full length.
 *
 * Every page here renders one sound in isolation, and the obvious way to do
 * that is to place it at zero. For thirty seven of the forty voices that is
 * fine. For the other three it silently measures the wrong thing.
 *
 * `riser`, `swell`, `reverse` and `zip` finish on their marker rather than
 * starting from it, because a riser exists to lead into something. So `cueLength`
 * clamps them to how much timeline lies before them — a riser at 0.3 s is
 * 0.3 s long, since it cannot begin before the piece does. Place one at zero
 * and it has no room at all: it collapses to the 0.2 second stub its own
 * minimum allows.
 *
 * That is what made three of them measure as the same sound. `variety-check`
 * reported twenty five entries across two clusters that "nothing tells
 * apart", and every one of them was a riser, a swell or a reverse, because it
 * had been comparing three 0.2 second noise blips. The voices were never the
 * problem; the measurement was placing them where they could not sound.
 *
 * Placing an end-anchored cue at its own length puts its start back at zero
 * and gives it all of itself, so both anchors begin at the same moment and a
 * page can go on rendering from zero.
 */
export function placed(cue) {
  return cue.anchor === 'end' ? { ...cue, time: cue.length } : cue;
}
