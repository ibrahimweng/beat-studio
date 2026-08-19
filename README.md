# Beat Studio

Beat Studio is a music workstation that runs in a web browser. It does two
things.

- You can play three instruments, program a drum pattern, record what you play,
  and save it as an audio file or a MIDI file.
- You can load a video and build sound design against it, placing each sound on
  the exact frame it belongs on, then export a file that lines up when you drop
  it back into your editing software.

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

## Scoring to picture

This is the part for sound design over motion graphics. Click the first button
in the bar on the left to open it.

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

There are four layers. Use them to keep your impacts apart from your movement
and detail, so you can balance them separately and export them separately.

Three kinds of sound can be placed.

- Design voices, which are the ones made for this work. There are impacts,
  whooshes, risers, sub drops, clicks, pops and reverse swells. Each one
  stretches to whatever length you give it.
- The drum kit, when you want something more like a real instrument.
- Piano and guitar notes, for texture. A low piano note under an impact gives
  it weight, and a note pitched down and stretched makes a bed.

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
your composition and it lines up.

You can write one mixed file, or one file per layer. Files per layer are all
the same length and all start at zero, so they sit on separate tracks and stay
in sync. "Cut to video length" makes the file exactly as long as the video.
Leave it off and any sound still ringing at the end is allowed to finish.

"Save session" writes your sounds and settings to a small file you can reopen
later. The video is not stored in it, so you point at the video again when you
come back.

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
  score-session.ts every action the scoring half can perform
  audio/
    engine.ts      the audio graph, the mixer and the meters
    chain.ts       the signal chain, shared by playback and export
    voices.ts      the synthesis for each instrument
    design-voices.ts impacts, whooshes, risers and the rest
    sources.ts     turning a placed sound into a played sound
    render.ts      writing the file, faster than real time
    transport.ts   the step clock
    recorder.ts    capturing takes
  timeline/        the cue list, layers and timing
  video/           loading a video and following its clock
  export/
    wav.ts         WAV encoder
    mp3.ts         MP3 encoder, loaded only when you export
    midi.ts        MIDI file writer
    save.ts        handing a file to the browser
  ui/              one file per part of the interface
  styles/          design tokens and stylesheets
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
