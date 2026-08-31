/**
 * GIFs, and the other moving pictures that are not video.
 *
 * A GIF cannot go in a `<video>` element. Nor can an animated PNG or an
 * animated WebP: they are image formats that happen to move, decoded by a
 * different part of the browser entirely, with no duration, no seeking and no
 * playback. Everything this app does to a clip -- scrubbing it, reading it
 * for cuts, running a playhead along it, exporting against it -- is built on
 * a video element, and none of it works on an image.
 *
 * So one is turned into the other on the way in, rather than a second kind of
 * clip being threaded through the whole app. The frames are decoded, drawn to
 * a canvas in their own time, and recorded off it as WebM. What comes out the
 * far side is a video file like any other, and nothing downstream knows a GIF
 * was ever involved.
 *
 * The cost is honest and worth stating: it happens in real time. A four
 * second GIF takes four seconds to bring in, because the recorder timestamps
 * frames as the clock passes them and there is no way to hurry it. That is
 * why this reports progress. GIFs are short, which is what makes the trade
 * the right way round; a four minute one would be a four minute wait.
 */

/** What a moving image arrives as. */
const ANIMATED = /^image\/(gif|apng|webp|avif)$/i;
const ANIMATED_SUFFIX = /\.(gif|apng|webp|avif)$/i;

/**
 * Whether this is a picture that moves rather than a video.
 *
 * By type and by name both, because a file dragged from some places arrives
 * with an empty type and nothing but its name to go on.
 */
export function isAnimatedImage(file: File): boolean {
  return ANIMATED.test(file.type) || (!file.type && ANIMATED_SUFFIX.test(file.name));
}

/** Told how far along the conversion is, from 0 to 1. */
export type OnProgress = (fraction: number) => void;

/**
 * What a browser has to be able to do before any of this is possible.
 *
 * `ImageDecoder` is what reads an animated image frame by frame, and it is
 * the newest thing this app depends on anywhere. Checked and reported rather
 * than assumed, because the alternative is a file that simply does not load
 * with nothing said about why.
 */
export function canReadAnimated(): boolean {
  return typeof globalThis.ImageDecoder === 'function' && typeof MediaRecorder === 'function';
}

interface Decoded {
  draw: (ctx: CanvasRenderingContext2D) => void;
  /** Seconds this frame is held for. */
  hold: number;
  width: number;
  height: number;
}

/** The shortest a frame may be held, so a zero-delay GIF is not infinitely fast. */
const MIN_HOLD = 0.02;
/** What a frame that does not say gets, which is what browsers settle on. */
const DEFAULT_HOLD = 0.1;

/** As many frames as there could sensibly be, so a bad file cannot spin forever. */
const MOST_FRAMES = 3000;

/**
 * Every frame of an animated image, in order, with how long each is held.
 *
 * How many there are is asked for and then not relied on. `frameCount` is the
 * proper way to know, and on the browser these tests run in `tracks` comes
 * back empty for a GIF that decodes perfectly well -- `selectedTrack` is
 * null, `frameCount` reads as nothing, and asking for frame zero hands one
 * over regardless. Trusting the count alone means a file that works being
 * turned away as empty, which is what the first version of this did.
 *
 * So it decodes until it is told there is no such frame, which is what the
 * end of a sequence looks like from the outside, and uses the count only as
 * an upper bound when there is one.
 */
async function frames(file: File): Promise<Decoded[]> {
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type || 'image/gif' });
  try {
    await decoder.completed;
    const count = decoder.tracks.selectedTrack?.frameCount || MOST_FRAMES;

    const out: Decoded[] = [];
    for (let at = 0; at < count; at += 1) {
      let image: VideoFrame;
      try {
        ({ image } = await decoder.decode({ frameIndex: at }));
      } catch {
        // No such frame: the sequence ended, which is the only way to know
        // when the count was not given.
        break;
      }
      // Duration is in microseconds, and may be missing entirely.
      const hold = image.duration ? image.duration / 1e6 : DEFAULT_HOLD;
      const bitmap = await createImageBitmap(image);
      image.close();
      out.push({
        draw: (ctx) => ctx.drawImage(bitmap, 0, 0),
        hold: Math.max(MIN_HOLD, hold),
        width: bitmap.width,
        height: bitmap.height,
      });
    }
    if (!out.length) throw new Error('there are no frames in that file');
    return out;
  } finally {
    decoder.close();
  }
}

/** The recorder's container, whichever of them this browser will write. */
function container(): string {
  for (const type of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

/** A converted picture, and how long it really runs for. */
export interface Converted {
  file: File;
  /**
   * The length its own frames add up to, in seconds.
   *
   * Carried separately because the recorder will not report it. A WebM
   * written from a live stream ends at its last encoded frame, and the frames
   * after that are not enough to move it -- measured, 1428ms of wall clock
   * and a final frame requested at 1228ms came back as a 1.024 second file.
   * So a converted picture is always up to one frame short of itself.
   *
   * Usually that is nothing. GIFs are often five frames a second, though,
   * where one frame is 200ms -- six frames at thirty, which is not a rounding
   * error in an app whose whole job is landing a sound on the right one. The
   * frames say how long they are held for, so the true length is known here
   * and there is no reason to ask the recorder for it.
   */
  seconds: number;
}

/**
 * A moving picture, as a video file.
 *
 * One loop of it, at its own frame timings. Looping is left to the timeline:
 * a GIF that repeats forever has no length, and a piece has to have one.
 */
export async function videoFromAnimated(file: File, onProgress?: OnProgress): Promise<Converted> {
  if (!canReadAnimated()) {
    throw new Error('This browser cannot read animated images. Convert it to a video first.');
  }
  const mime = container();
  if (!mime) throw new Error('This browser cannot write the video that would be made from it.');

  const shots = await frames(file);
  if (!shots.length) throw new Error('there are no frames in that file');

  const canvas = document.createElement('canvas');
  canvas.width = shots[0].width;
  canvas.height = shots[0].height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('this browser cannot draw the frames out');

  /*
   * Frames are handed over one at a time rather than at a rate.
   *
   * `captureStream(0)` means nothing is captured until `requestFrame` says
   * so, which is what lets a GIF's own timings survive: its frames are held
   * for whatever each one asks for, and a stream running at a fixed rate
   * would resample them to something else.
   */
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const parts: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };

  const total = shots.reduce((sum, shot) => sum + shot.hold, 0);
  const done = new Promise<void>((settle) => { recorder.onstop = () => settle(); });
  recorder.start();

  let elapsed = 0;
  for (const shot of shots) {
    shot.draw(ctx);
    track.requestFrame();
    await new Promise((next) => window.setTimeout(next, shot.hold * 1000));
    elapsed += shot.hold;
    onProgress?.(Math.min(1, elapsed / total));
  }
  /*
   * The last frame is held for its own length before the recorder stops.
   *
   * A frame lasts until the next one is handed over, so the final frame of a
   * sequence has nothing after it to end it -- and stopping straight away
   * gives it whatever the gap happened to be. Measured on a six frame GIF at
   * 200ms each: 1.2 seconds of picture came back as 1.01, one whole frame
   * short, which in an app about landing sound on a frame is the wrong thing
   * to be casual about.
   */
  const last = shots[shots.length - 1];
  track.requestFrame();
  await new Promise((next) => window.setTimeout(next, last.hold * 1000));

  recorder.stop();
  await done;
  stream.getTracks().forEach((one) => one.stop());
  canvas.width = 0;

  const name = file.name.replace(ANIMATED_SUFFIX, '') || 'animation';
  return {
    file: new File(parts, `${name}.webm`, { type: mime.split(';')[0] }),
    seconds: total,
  };
}
