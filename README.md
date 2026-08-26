# Beat Studio

Beat Studio is a music workstation that runs in a web browser. It does two
things.

- You can load a video and build sound design against it, placing each sound on
  the exact frame it belongs on, then export a file that lines up when you drop
  it back into your editing software.
- You can play three instruments, program a drum pattern, record what you play,
  and save it as an audio file or a MIDI file.

The app opens on the Sound design screen. The instruments are on the bar down
the left.

All the sound is made in the browser using the Web Audio API. There are no audio
files to download and no server to run.

## Running it

You need Node.js version 20.19 or newer, or version 22.12 or newer. That is
what Vite requires.

```bash
npm install
npm run dev      # start the development server on http://localhost:5173
npm run build    # type check, then build into dist/
npm run preview  # serve the built files
```

After a build, the `dist/` folder contains plain static files. You can host that
folder on any web server. Paths in the build are relative, so it also works from
a subfolder.

Every push and pull request runs the type check and the build on both versions
of Node. The workflow is at `.github/workflows/ci.yml`.

## Deploying

The site is static, so any host that serves files will do. The settings for
Vercel are in `vercel.json`, and there is nothing to configure in the Vercel
dashboard. Import this repository and Vercel reads the file.

The build produces file names that contain a hash of the contents, so those
files are set to be cached for a year. The `index.html` file is set never to be
cached, otherwise a visitor would keep loading an old version after you deploy a
new one.

## Sound design

This is the part for sound design over motion graphics, and it is the screen
the app opens on. If you have gone off to an instrument, the first button in
the bar on the left brings you back.

### Load a video

Drag a video onto the page, or choose a file. The file is read straight from
your disk. Nothing is uploaded and the video never leaves your machine.

The frame rate is measured from the file and shown in the bar at the top. You
can change it there if the measurement is wrong. The video's own sound is muted
to start with. Turn on "Ref audio" to hear it, for example when you are working
around a music track. It is never included in anything you export.

### Place sounds

The timeline below the video is measured in time, not in bars. Pick a sound on
the right, then click a lane to place it. Click a sound to select it, and drag
it to move it.

Clicking a sound in the picker plays it, so you hear it before you place it.
The box at the top of the picker finds one by name, and with the box focused
the up and down arrows step through whatever is left, playing each. That is the
quickest way to compare a handful of similar sounds against each other.

There are four layers. Use them to keep your impacts apart from your movement
and detail, so you can balance them separately and export them separately.

Thirty nine sounds can be placed, in three groups.

Twenty four design voices, which are the ones made for this work, sorted by
what they are for.

| Group | Sounds |
|---|---|
| Hits | impact, thud, slam, metal, clank |
| Movement | whoosh, swipe, flutter, wobble |
| Lead in | riser, swell, reverse |
| Low end | sub, rumble, drone |
| Detail | click, tick, pop, beep, chirp |
| Texture | zap, glitch, shimmer, static |

Then thirteen drum voices, when you want something closer to a real
instrument, and piano and guitar for texture. A low piano note under an impact
gives it weight, and a note pitched down and stretched makes a bed.

Each design voice is built from a different method rather than from the same
one with the numbers changed, so they stay apart from each other however they
are tuned or stretched. The metal and the clank are made from partials that are
not whole multiples of each other, which is why they sound like struck objects
rather than notes. The reverse is a sound written into a buffer and read back
the other way round, which is a shape no envelope can make. The glitch is
several very short bursts at uneven spacing, so it never falls into a rhythm.

There is a page for checking this. It renders every voice, reduces each to a
fingerprint of what it is made of and how it moves, and compares every pair.
Across all 276 pairs the middle similarity is 0.37, and the closest pair is
0.84. See `tools/README.md`.

Every one of them can be tuned by two octaves up or down and given any length,
so the thirty nine are starting points rather than the whole set.

There is no limit on how many you can place. A thirty second piece was tested
with 1372 sounds on it and nothing broke, although writing the file took twenty
seconds at that density. Around fifty sounds, which is a lot for half a minute
of picture, everything is immediate and the file writes in about five
seconds.

### Let it find the hits for you

Click "Find hits" and Beat Studio reads the video and suggests where sounds
belong. Every cut, snap and fast move shows up, because it measures how much
the picture changes from frame to frame. The result is drawn as a strip under
the ruler, which is the same idea as a waveform but for the picture.

Click any suggestion to place the chosen sound there, or use "Place all" to put
it on every one of them.

The sensitivity slider decides how much has to change before a moment counts.
Turned down it keeps only the obvious cuts. Turned up it reaches the smaller
moves. The video is only read once, so moving the slider is instant even on a
long clip.

Reading takes about as long as half the clip, so a minute of video takes around
forty seconds. Most of that is the first pass, which plays the video quickly and
measures it. The second pass steps through each moment it found one frame at a
time, to pin it to the frame the change actually landed on.

On a thirty second test clip with forty hits in it, this found thirty nine of
them, and the ones it found were within one frame. Playing the video twice as
fast would halve the wait but only find eighteen, which is why it is not done
that way.

### Room to work

The line between the video and the timeline can be dragged. The timeline takes
the space and the video scales down to fit whatever is left, so you can give
most of the screen to the timeline once there are more layers than fit. Double
click the line to put it back where it started. The size is remembered.

Layers can be added, renamed and removed. Use "+ Layer" at the bottom of the
layer names, double click a name to change it, and the small cross removes a
layer. Removing one that still has sounds on it asks first. There is always at
least one layer.

### Give it a space, and some weight

Two controls on every placed sound, under Level, Tune and Length.

"Space" puts the sound in a room of its own. Everything used to share a single
reverb at the end of the chain, which meant a click and an impact were in the
same place whether that suited them or not. Now an impact can have a hall
behind it while the click next to it stays dry, which is most of the difference
between a sound that reads as part of a scene and one that reads as pasted on
top of it. The room is added to the sound rather than blended with it, so
turning it up does not thin out the hit you started with.

"Drive" pushes the sound into a gentle curve, which adds harmonics above what
was there. This is what people mean by punch. It matters most for anything low:
a sub with nothing above it cannot be reproduced by a phone at all, and a
little of this puts something up where a small speaker can reach. At low
settings it is heard as weight rather than as an effect.

Every voice starts with an amount that suits it. Hits arrive with a room and
some push, low end arrives pushed, and detail like the click and the tick
arrives completely dry, because a room makes nothing more exact. All of it is
a starting point and every sound can be set by hand.

Sessions saved before these existed open sounding exactly as they did, with
both at nothing.

### Getting the timing right

Each sound has a setting for how it lands. "Starts on it" begins the sound on
the marker. "Ends on it" finishes the sound on the marker, which is what a
riser or a reverse swell needs, because the moment that matters is where it
arrives rather than where it began.

Snapping holds sounds to whole frames. If the piece was animated to music, you
can snap to the beat instead, or turn snapping off.

These keys help.

| Key | What it does |
|---|---|
| Space | Play or pause |
| Left and right arrows | Move one frame |
| Shift and an arrow | Move the selected sound one frame |
| Delete | Remove the selected sound |
| Escape | Deselect |
| Pad keys | Drop that drum sound at the playhead |

"In context" plays from a second before the selected sound, so you hear it in
place rather than on its own. "Mute" silences a sound without deleting it, for
comparing.

### Export

The file is worked out rather than performed, so every sound lands on the exact
moment you placed it and the file always starts at zero. Drop it at the head of
your composition and it lines up. Exporting the same project twice gives the
same file.

Files are written at 24 bits and 48k, which is what post production expects.
The difference is not loudness but how much room there is underneath: at 16
bits the quietest detail sits close to the noise the format itself introduces,
and lowering the track to fit it under a voiceover brings that noise up with
it.

Two things happen to the level before a file is written, and both can be turned
off.

"Stop it clipping" holds the loudest moments back. A hundred sounds on the same
frame add up past what a file can hold, and the part that does not fit used to
be cut off, which is heard as a crack on exactly the loudest moment in the
piece. It reads a few milliseconds ahead so the reduction is already in place
when the peak arrives, and it lets go slowly, so a hit is held rather than
grabbed at and everything quieter is left alone.

"Match loudness" brings every export to the same loudness, measured the way a
broadcaster measures it rather than by looking at the highest peak. Two pieces
cut together then sit the same way against picture without anyone reaching for
a fader. Sound for picture is aimed a little below where a finished programme
would be delivered, because it has to sit under dialogue and music.

The status line says what happened, for example `WAV exported · -18.0 LUFS ·
+4.2 dB · held back 1.8 dB`.

There are four ways to hand the work over.

- One mixed file.
- One file per layer. Use these to balance impacts against movement later.
- One file per sound. Every impact in one file, every whoosh in another.
- A marker list, which is a spreadsheet of every sound and the frame it lands
  on, with timecode in the form editing software reads.

Every file in a set is the same length and starts at zero, so they sit on
separate tracks and stay in sync. The layers and the per sound files add back
up to the mixed file exactly, because the level work is measured once from the
whole thing and then applied to each file unchanged.

"Cut to video length" makes the file exactly as long as the video. Leave it off
and any sound still ringing at the end is allowed to finish.

"Save session" writes your sounds and settings to a small file you can reopen
later. The video is not stored in it, so you point at the video again when you
come back.

### Bring more sounds in

"Load a sound pack" adds someone else's sounds to your palette. A pack is a
small text file describing how to make its sounds rather than the sounds
themselves, so nothing is uploaded, nothing is downloaded while you work, and
a pack of two hundred sounds is a few tens of kilobytes.

Anything written for `@web-kits/audio` works. The ten packs published with that
project come to 269 sounds between them, covering interface clicks, notification
tones, bells, chiptune, and a small drum kit. Get them with:

```bash
npx @web-kits/audio add raphaelsalaja/audio
```

That writes the files into `.web-kits/`, and you load them from there.

Pack sounds sit in the picker under the pack's name, and behave exactly like
the ones built in: the same level, tuning and length controls, placed the same
way, exported the same way. Loading a pack that is already there replaces it.
The small cross next to a pack's name takes it out again, and sounds already
placed from it stay where they are.

Once packs are loaded there are several hundred sounds to choose from, so
there is a box at the top of the picker to find one by name.

Packs are remembered between sessions, and "Save session" writes them into the
session file, so a session opens complete on another machine.

### Take the sounds with you

"Export patch" writes all 37 sounds to a file in the `@web-kits/audio` format.
Commit that file to a repository and anyone can install the whole palette with
`npx @web-kits/audio add <owner>/<repo>`, play the sounds in their own page, or
read the file to see how any of them is put together.

The sounds are described rather than coded, which is what makes this possible.
Each voice says what it is built from and how each part moves, and one piece of
code turns that into sound, whether you are hearing it here or exporting it.

Most of them survive the trip exactly. That format describes a sound as a graph
of standard parts, and a few of these are not that, so those come out close
rather than identical. Across all 37 the middle score is 0.987 and levels land
within a tenth. The ten that come out under 0.93 are listed in
`src/export/patch.ts` with the reason for each. `tools/README.md` says how to
measure it again.

## What you can do

### Play an instrument

Pick an instrument from the bar on the left. There are three of them.

- The drum kit has 13 pads. You can click a pad or use the keyboard.
- The piano has all 88 keys. Two rows of your keyboard play the lit octaves.
- The guitar has 15 frets and 6 strings. You can also strum one of 6 chords.

The first click starts the audio engine. A browser does not allow a page to make
sound until the person using it interacts with the page. That is why the screen
stays covered until you click "Power up".

### Program a beat

The sequencer at the bottom has 8 lanes and either 16 or 32 steps. Click a step
to switch it on or off. The button in the top bar switches between 16 and 32
steps.

There are 4 pattern banks called A, B, C and D. Your patterns and your tempo are
saved in the browser, so they are still there when you come back.

### Record a take

Press the record button or the R key. Beat Studio records everything you play,
together with the pattern that is running. When you stop, the recording appears
in the Takes panel with a picture of the waveform.

You can do several things with a take.

- Play it back.
- Turn on Layer, and you hear the take underneath while you record the next one.
- Save it as a WAV file, an MP3 file or a MIDI file.
- Delete it.

You hear the metronome while you play, but it is not included in the recording.

Two settings change how recording works.

- When Count-in is on, you hear one bar of clicks before the recording starts.
- Take length sets how long a recording runs. You can choose 1, 2 or 4 bars, or
  let it run until you stop it yourself.

### Save your work

There are three export formats.

- WAV is the recorded audio, uncompressed.
- MP3 is the same audio at 192 kbps.
- MIDI is the notes you played rather than the sound. If you have not recorded
  anything, you get the current drum pattern instead.

## Keyboard

| Key | What it does |
|---|---|
| Space | Start or stop the transport |
| R | Start or stop recording, except while the piano is showing |
| W E R T | Crash, splash, second crash, ride |
| A S | Closed hi-hat, open hi-hat |
| D F | Kick, second kick |
| G H | Tom 1, tom 2 |
| J K L | Snare, floor tom, tom 3 |
| Z to M | Lower octave on the piano and guitar |
| Q to U | Upper octave on the piano and guitar |

R plays a note on the piano, so it only starts recording when the piano is not
showing.

## Help

The question mark at the bottom of the bar on the left opens a panel listing
what everything does and every keyboard shortcut.

The first time you open the app, a short walkthrough points at each part of
the Sound design screen in turn. You can leave it at any step and it does not come
back on its own. The help panel can start it again.

## Options

You can set three things in the address bar.

- `?accent=%239149f5` changes the accent colour. The value must be a hex colour.
  Remember that `#` is written as `%23` in a web address.
- `?finish=slate` changes the background. The choices are `black`, `dark` and
  `slate`.
- `?samples=off` turns off the sampled instruments described below.

## How the sound is made

Every drum is made from two parts.

- A short burst of noise passed through a filter. This makes the hi-hats, the
  snare rattle and the cymbals.
- A tuned oscillator whose pitch falls quickly. This makes the kick, the toms
  and the body of the snare.

The piano is built from four tuned oscillators played together. The guitar is
built the same way, with a filter that closes as the note fades.

The signal passes through a three band equaliser, a reverb and a master volume
control. The reverb uses an impulse response that the app generates when it
starts, so there is no file to load.

Notes are scheduled ahead of the audio clock rather than played the moment a
timer fires. A timer on its own drifts, and you would hear the timing slip. The
scheduler runs every 25 milliseconds and queues every step due in the next 140
milliseconds.

### Sampled instruments

When the audio engine starts, Beat Studio tries to load General MIDI samples for
the piano and the guitar using the `smplr` library. These samples come from a
server run by someone else, at `gleitz.github.io`. If that request fails, or you
are offline, the app uses the built-in synthesised voices instead and everything
keeps working. The Engine panel on the right tells you which set of sounds is in
use.

If you would rather the app never contacted another server, add `?samples=off`
to the address.

## How the code is organised

```
src/
  main.ts          entry point, applies the theme and mounts the app
  app.ts           builds the views, handles the keyboard, drives the meters
  session.ts       every action the interface can perform
  store.ts         application state and change notifications
  constants.ts     lanes, pad mapping, chords, tuning, the starter pattern
  pattern.ts       creating and editing patterns
  persist.ts       reading and writing saved state
  types.ts         shared types
  sound-design-session.ts every action the sound design screen can perform
  audio/
    engine.ts      the audio graph, the mixer and the meters
    chain.ts       the signal chain, shared by playback and export
    master.ts      loudness, and holding the loudest moments back
    voice-spec.ts  what a voice is made of, and the one thing that plays it
    pack.ts        reading someone else's sound pack into that
    voices.ts      the drum kit and the pitched instruments
    design-voices.ts impacts, whooshes, risers and the rest
    sources.ts     turning a placed sound into a played sound
    render.ts      writing the file, faster than real time
    transport.ts   the step clock
    recorder.ts    capturing takes
  timeline/        the cue list, layers and timing
  video/           loading a video, following its clock, and reading its hits
  export/
    markers.ts     a list of where every sound lands
    patch.ts       the palette, written out for other apps to play
    wav.ts         WAV encoder
    mp3.ts         MP3 encoder, loaded only when you export
    midi.ts        MIDI file writer
    save.ts        handing a file to the browser
  ui/              one file per part of the interface
    sound-design/  the video, the timeline, the sound picker and the walkthrough
  styles/          design tokens and stylesheets
public/            files copied to the site root, which is where the icons live
```

There are two rules that keep the parts separate. Nothing in `audio/` touches
the page, and nothing in `ui/` talks to the audio engine directly. The views
read state from the store and call methods on the session. The session is the
only place where state, sound and timing meet.

The MP3 encoder and the sample library are loaded only when they are needed, so
neither is part of the first download.

Exported files are rendered offline rather than recorded in real time. The same
signal chain is used for both, so what you hear while working is what lands in
the file.

## Browser support

Beat Studio needs the Web Audio API and CSS colour mixing. It works in current
versions of Chrome, Edge, Firefox and Safari.

Recording uses MediaRecorder. If a browser does not support it, the rest of the
app still works and a message appears in the status line.

## Where the design came from

The interface follows the Toolcraft design system. Everything visual is taken
from it directly, including the colours and the type sizes. The original design
files are in `design/`, and `design/README.md` explains what they are.
