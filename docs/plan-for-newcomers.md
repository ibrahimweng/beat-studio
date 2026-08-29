# An interface for people who edit video but have never done sound

This plan reshapes Beat Studio around one job: putting sound to picture, for
someone who already knows video and does not know sound.

## Who this is for

A motion designer or video editor. They already understand timelines, layers,
in and out points, snapping, frames and rendering. None of that needs
explaining and none of it should take up room on the screen.

What they do not know is sound. They do not know that a rising sound should
finish on the hit instead of starting on it. They do not know that low end is
felt rather than heard, so a logo landing with no sub under it feels weak on a
phone even though it sounds fine on a laptop. They do not know that four good
sounds beat forty, or that everything placed at the same level turns into mush.

So the rule for this redesign is simple. Do not teach the timeline. Spend every
word of explanation on sound.

## What is wrong with the interface today

**The app is two apps.** The left rail offers six places to go: Sound design,
Drums, Keys, Guitar, Sequencer and Takes. Five of those six live in a separate
mode that runs on bars, tempo, banks and takes, while the sound design screen
runs on seconds and frames. A newcomer opens the app to score a video and finds
half the interface is a drum machine.

**The library is organised by how a sound is made.** The ten groups are Hits,
Movement, Lead in, Low end, Detail, Texture, Struck, Plucked, Grains and
Mechanical. Four of those describe the mechanism rather than the use. Somebody
looking at a logo landing in their video does not think "I need something from
Struck." They think "something needs to happen here."

**The app finds the moments but says nothing about them.** The video scan
already works well. It reads the whole clip, measures how much the picture
changes, and marks every cut and fast move on the timeline. Then it stops. The
newcomer is left looking at a row of markers with no idea what belongs on any
of them. This is the single biggest missed opportunity in the app, because the
hard part is already done.

**The instruments are presented as instruments.** A piano is offered as a
keyboard to play a tune on. For this work a piano is not that. One low note
with a long tail is a stinger under a logo. A held chord is a bed under a
scene. A high harmonic is tension before a reveal. The instrument is a source
of three or four useful gestures, and the interface should offer those
gestures, not a keyboard.

## The five changes

### 1. One screen. Fold the instruments into the library.

Remove the separate play mode. The rail keeps the sound design button, the help
button and the engine light, and nothing else.

The instruments do not disappear. They become sources in the sound library,
described by what they do for picture:

- **The drum kit** joins the library as ordinary entries. The thirteen pads run
  through the same size and place axes every other sound gets, so a floor tom
  tuned down and stretched out appears as a large hit, and a closed hat appears
  as a tick. A newcomer never needs to know it came from a drum kit.
- **Piano and guitar** become a small set of fixed gestures rather than a
  keyboard. A single low note that rings. A held chord. A high harmonic. A
  rising figure of three notes. Each one is a single click and lands as one
  sound with one length, exactly like every other sound in the library.

Two parts do not fit and need a decision. The step sequencer is built on bars
and tempo, which is the wrong model for this work. My recommendation is to keep
it only as a way to make one rhythmic bed, which renders to a single sound and
is placed on the timeline like anything else. The takes dock is a recording
workflow that duplicates what the sound library already does with imported
recordings, so it should be folded into the library and removed as a separate
place.

If you would rather not lose either, put both behind one Advanced button. The
important thing is that a newcomer never meets them.

### 2. Organise the library by what is happening on screen

Replace the ten mechanism groups with seven groups named after moments:

| Group | The moment | What is in it |
|---|---|---|
| Something appears | A logo lands, text pops in, an element enters | impact, thud, pop, click, glass |
| Something moves | A pan, a swipe, a camera move, an element travelling | whoosh, swipe, flutter, wobble |
| Something builds | Before a reveal, a countdown, a push in | riser, swell, reverse |
| Something lands hard | The hero moment | slam, sub, impact stacked with sub |
| Something is there | A bed under a scene, ambience | drone, rumble, rain, fire, tone |
| A small thing happens | A tick, a counter, a cursor, interface sound | tick, click, beep, chirp |
| A transition | A cut, a wipe, a glitch | glitch, static, zap, reverse |

Every voice still exists and nothing is removed. This is a different index over
the same forty voices, which is cheap to add because the catalogue is already
generated from data rather than stored.

Keep the old grouping behind a toggle called "By sound type." People who learn
the vocabulary will want it, and it costs almost nothing to keep.

### 3. Suggest a sound for every moment

This is the centre of the redesign.

The video scan already produces two things: a full curve of how much the
picture changed over time, and a list of the moments that stood out. Today only
the moments are used, and only as markers.

Read the shape of the curve around each moment and the moment can be
classified. The rules are straightforward:

| Shape of the curve | What it is | What goes there |
|---|---|---|
| A sharp spike with flat either side | A cut | A short dry impact |
| Energy climbing for half a second, then a spike | A build to a hit | A riser that ends on the hit, and an impact on it |
| Raised energy held for a third of a second or more | A move | A whoosh across it |
| A spike then energy falling away | Something lands and settles | A thud with a sub under it and a tail |
| Fast repeated spikes | A quick sequence | Ticks, one per spike, each quieter |
| Long flat low energy | A quiet stretch | Nothing, or a bed |

The right panel then shows a list of moments instead of a wall of sounds:

```
0:02:14   Something lands hard              Large impact, room     ▶  ✓  ✕
          The picture jumps here after a build.
          A hit with a low sub under it. The sub is what makes it
          felt on a phone.
```

The play button auditions it against the video from a second before, so it is
heard in context rather than alone. The tick accepts it and places it. The
cross dismisses the moment. Clicking the sound name opens the other sounds that
suit that moment type, ranked.

Add an "Accept all" button. A motion designer gets a complete first pass over
their video in one click, hears it, and then fixes what is wrong. That is the
fastest possible route to a video that has sound, and it is what this audience
actually wants.

The sentence under each suggestion is the teaching. It is one line, it says why
that sound belongs there, and it is the difference between someone using the
tool and someone learning the craft.

### 4. Give the layers a job

The four starter layers are called Impacts, Movement, Detail and Tone. The
names are good but nothing is attached to them, so everything arrives at the
same level and the result is flat.

Give each layer a stated job and a default level relationship:

- **Impacts** are the loudest, the driest and the shortest.
- **Movement** sits under the impacts and is wider.
- **Detail** is quiet, dry and exact.
- **Tone** is the quietest, the widest and the longest.

Write those four lines into the layer list where they can be read. Then the
question of why a mix sounds muddy has an answer on screen.

### 5. Fix the three things every newcomer gets wrong

**A rising sound should finish on the hit.** The app already has the setting for
this, offered as "Starts on it" and "Ends on it." For anything in the builds
group, default it to "Ends on it" and say why in one line. Getting this wrong is
the most common beginner mistake in the whole craft and the app can simply
prevent it.

**Everything ends up at the same level.** Add one button called Balance that
applies the layer relationships from change four across everything placed.

**Too many sounds.** Nothing currently tells anyone that a sound every half
second is worse than four good ones. If the timeline passes a certain number of
sounds per second, say so once, quietly, in the status line.

## The screen

Keep the existing arrangement. Video on top, timeline underneath, panel down
the right side. A motion designer reads that layout instantly and there is no
reason to change it.

Three changes to it:

- The left rail loses the instrument and dock buttons and keeps only the sound
  design button, help and the engine light.
- The right panel gains three tabs: **Moments**, **Sounds** and **Selected**.
  Moments is the suggestion list and is what opens once a video has been
  scanned. Sounds is the library, grouped by moment. Selected is the existing
  inspector for whatever is currently picked on the timeline.
- The panel widens from 292 pixels to 340. This came out of drawing the
  mockup rather than out of the plan. A moment row has to carry a time, the
  kind of moment, the name of a sound, three controls and a sentence saying
  why, and at 292 the sentence breaks into five short lines and stops being
  readable. The sentence is the entire teaching plan, so the panel gives way
  instead. The two narrow window rules in `layout.css` scale from the new
  width in the same proportions.

## Build order

The phases are ordered so each one ships something useful on its own.

1. **The Moments panel.** The largest gain and it needs no new analysis, only a
   classifier over data the app already has.
2. **The library grouped by moment.** A new index over the existing catalogue,
   plus the toggle back to sound types.
3. **Folding the instruments in and stripping the rail.** The largest change to
   existing code, and worth doing after the new panel proves out.
4. **Layer jobs, Balance, the anchor default and the density warning.** Small
   changes with a real effect on how the first result sounds.
5. **A new walkthrough.** The current seven step tour describes the old flow and
   will be wrong once the panel changes.

## What this does not change

The audio engine, the signal chain, the export path and the timeline model all
stay as they are. This is a plan for the interface and for how sounds are
found and described. Nothing underneath it needs to move.
