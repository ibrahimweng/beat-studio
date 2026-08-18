# Beat Studio

Beat Studio is a music workstation that runs in a web browser. There are three
instruments you can play. You can program a drum pattern in the step sequencer.
You can record what you play and save it as an audio file or a MIDI file.

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

Every push and pull request that changes this folder runs the type check and the
build on both versions of Node. The workflow is at
`.github/workflows/beat-studio.yml`.

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
  audio/
    engine.ts      the audio graph, the mixer and the meters
    voices.ts      the synthesis for each instrument
    transport.ts   the step clock
    recorder.ts    capturing takes
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

## Browser support

Beat Studio needs the Web Audio API and CSS colour mixing. It works in current
versions of Chrome, Edge, Firefox and Safari.

Recording uses MediaRecorder. If a browser does not support it, the rest of the
app still works and a message appears in the status line.

## Where the design came from

The interface follows the Toolcraft design system. Everything visual is taken
from it directly, including the colours and the type sizes. The original design
files are in `design/`, and `design/README.md` explains what they are.
