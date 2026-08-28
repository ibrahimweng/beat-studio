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

### It is still there when you come back

The piece is kept as you work. Refresh the page, close the tab, come back
tomorrow: it opens on what you left, with the sounds where you put them, the
layers you made, the curves you drew and the frame rate you set.

The clip comes back with it. It is kept beside the timeline in this browser,
so you do not have to go and find the file again. Like the video itself,
nothing about this leaves your machine.

There is nothing to press. Writing happens as you work, a moment after the
edits stop, and again the instant the page is closed or hidden, so the last
thing you did is in there too.

"New project", under Session on the right, is the only thing that clears it.
It asks first and says what it is throwing away. What is kept on purpose
between projects — the sounds you saved, the packs you loaded, the patterns
on the instruments — is left alone, because starting a new piece is not the
same as forgetting your own sounds.

Takes come back too, and so do your patterns, your packs and the sounds you
saved. Everything except the audio engine's own idea of what is playing.

**Two tabs.** Only one tab keeps the piece. Open the app a second time and that
tab says so in a red line across the top, and works normally without writing
anything down. "Keep here instead", on that line, hands the keeping over and
writes whatever that tab has, including anything done while it was shut out.
Close the tab that was keeping and the other picks it up on its own within a
few seconds. Without this, two tabs both wrote to one place, the last to save
won, and the other tab carried on drawing sounds that were no longer stored
anywhere.

Two other things are worth knowing. A very long clip can be larger than the
browser will store, and when that happens it says so in the timeline bar: the
piece is kept either way, and only the clip has to be loaded again. And a
browser clearing its own storage can take the clip and leave the piece, in
which case the timeline comes back on its own and asks for the clip.

"Save session" is still there, and still worth using: it writes a file, which
is how a piece moves to another machine or outlives this browser.

### Moving about in the clip

The row of round buttons at the top is the transport, laid out either side of
play so that every backward control has its forward twin the same distance
away.

| Button | What it does |
|---|---|
| `❘◀` | Back to the start |
| `■` | Stop, and go back to where play started rather than to the top |
| `❘◀◀` and `▶▶❘` | The sound before or after the playhead, selected as you land on it |
| `◀◀` and `▶▶` | Held down, run through the clip at six times speed |
| `◀` and `▶` | One frame back or on |
| `▶` (the large one) | Play or pause |
| `●` | Record |

Stop goes back to where play started because a stop that drops you at the top
of a two minute clip means winding back to the part you were working on every
time.

The two skip buttons step by the moment a sound is pinned to, not by where it
starts sounding, so a riser anchored to its end steps to the moment it arrives
at. Whatever they land on is selected, which makes them the quickest way to
walk through a piece and check each hit in turn.

Hold rewind or fast forward and the clip runs while you hold it, at six times
speed, and stops the moment you let go — including if you let go with the
pointer somewhere else on the screen. It is for finding a moment by watching
rather than by reading timecode.

The playhead can also be dragged. Take hold of the small tab at the top of the
line, or press anywhere on the ruler and drag. Doing it while the clip is
playing scrubs, and playing picks up again from wherever you let go.

### Recording what you play

The round red button arms the timeline. With it on, whatever you play on the
drums, the keys or the guitar lands on the timeline at the playhead, on the
layer you are working on — by mouse or by keyboard, from whichever instrument
screen you are on.

It does not need the transport running. Standing still it drops everything at
the same moment, which is a way of building a stack by hand. Running, it is a
pass played in against the picture.

This is separate from the record button on the instrument screens, which
captures a take against the loop and has nothing to do with the timeline.

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

Fifty five sounds can be placed, in three groups.

Forty design voices, which are the ones made for this work, sorted by what
they are for.

| Group | Sounds |
|---|---|
| Hits | impact, thud, slam, metal, clank |
| Movement | whoosh, swipe, flutter, wobble |
| Lead in | riser, swell, reverse |
| Low end | sub, rumble, drone |
| Detail | click, tick, pop, beep, chirp |
| Texture | zap, glitch, shimmer, static |
| Struck | bell, glass, wood, pipe |
| Plucked | string, thunk, wire |
| Grains | rain, fire, gravel, swarm, pour |
| Mechanical | ratchet, clockwork, zip, motor |

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
Across all 780 pairs the middle similarity is 0.38, and the closest pair is
0.83. See `tools/README.md`.

Every one of them can be tuned by two octaves up or down and given any length,
so the forty are starting points rather than the whole set.

### The library

Above the voices there is a library of a thousand named sounds — "small metal,
hall", "huge bell, cavern", "tiny click, dry". Type a word and it answers with
what matches; type nothing and it shows one of each voice to browse. Choosing
one arms it exactly as choosing a voice does, and placing it brings its length,
its pitch, its room and its push with it.

Being straight about what that is: it is the forty voices at five sizes in five
places, not a thousand unrelated recordings. A size is a pitch and a length
together, because that is what size actually is — a large object is lower and
rings longer, and moving only one of the two gives the same object played
wrong. A place is how much room is around it. What the library buys is finding
a sound by name instead of dialling for it, which is what a sound library has
always actually been. Nothing is stored: every entry is a name and four
numbers, and the sound is worked out when you ask for it, which is the return
on describing a voice as data rather than as code.

It is measured rather than asserted. Against one semitone — the smallest change
any control in the app can make — a whole different voice is about forty times
that, one size up about ten, and one room bigger about five. A tenth of the
steps come out smaller than a semitone and every one of them is a room step on
a voice that sustains, because a room shows itself in what happens after a
sound stops and a drone does not stop. `tools/README.md` has the method.

There is no limit on how many you can place. A thirty second piece was tested
with 1372 sounds on it and nothing broke, although writing the file took twenty
seconds at that density. Around fifty sounds, which is a lot for half a minute
of picture, everything is immediate and the file writes in about five
seconds.

### Describe what you want

The same box takes a sentence. "A huge metal door slamming in a warehouse",
"very quick bright tick, no reverb", "a quiet drone in a cavern". What comes
back is built to order, at settings no entry in the library happens to sit on,
and the button says what it made: "huge slam, hall". Hovering one says why:
"slam, from “door” and “slamming” · huge · in the warehouse".

Nothing is uploaded and there is no model. A description is read as a set of
claims about seven things — what the thing is, how big, how long, where it is,
how hard it is pushed, how bright, how loud — and each of those is a number the
app already has a control for. That only works because a voice here is a
description rather than a recording: there is somewhere for the words to land.

What it cannot do is worth saying plainly.

It knows about five hundred and sixty words and no others, so "menacing" and
"eerie" mean nothing to it however much they mean to you. Rather than quietly
ignoring them it hands them back — "nothing here for “menacing”, “eerie”" —
which is how anybody finds out what it does know. Endings are handled, so
"slamming", "slammed" and "slam" are one word to it.

It reads one sound at a time. "A boom with a metallic ring over it" comes back
as two candidates to choose between, not as one sound with two parts.

And it has no idea what anything is for. It will build you a huge dull thud in
a cavern; whether that is the sound of a vault door closing is your call.

Measured on twenty descriptions written after the vocabulary was finished, it
names a sound you could reasonably have meant fifteen times out of twenty, and
every one of the five misses is a noun it had never heard. `tools/README.md`
has the method and is straight about what that number is worth.

### One sound made of several

A boom with a metallic ring over it is one sound, not two. Type it that way
and you get it that way: a joining word — with, over, under, and — between two
things it knows is what says a description is about two sounds rather than one
sound described twice. "A heavy metal door slamming" is one object and four
words for it, and comes back as one voice.

You can also build one by hand. With a sound selected, "Made of" lists what it
is, and the button under it adds whatever is currently armed. Each added voice
has a control for how much of it there is, and a cross to take it off again.
Four voices is the most a stack holds; past that it stops being a sound made
of parts.

A stack is one sound in every way that matters. It moves once, stretches once,
sits in one room, takes one push, and appears on the timeline as one thing,
labelled "impact +2". Two cues at the same moment are two things to keep lined
up forever; this is one.

It works because a voice here is a description rather than a recording. Two
voices are two lists of layers, and a stack is those lists joined — still one
description, so it can be saved as your own, written to a patch file and
rendered offline without any of those knowing that stacks exist.

Both voices are turned down so that two together come out about as loud as one
did, and how much of each is what the controls under "Made of" are for.
Measured, a stack holds what both its voices put into every band to within a
decibel. `tools/README.md` has the method, and is honest about the two
measurements that had to be fixed before they measured anything.

One thing it will not do: a sound that carries a room of its own, which means
a pack sound with reverb written into it, is left out of a stack rather than
mixed into one. Its room sits above all the layers at once, so it would land
on everything beside it.

### Take sounds out of a recording

Drop in an audio or video file and Beat Studio finds the separate sounds in it
and rebuilds each one out of these voices. Nothing is uploaded: the browser
decodes it, the app measures it, and it never leaves your machine.

What comes back is editable in a way a sample never is. A rebuilt hit is a
voice and five numbers, so it can be lengthened, tuned, put in a different
room, pushed and stacked — none of which a recording of it would allow. "Place
them all" puts each one where it was in the file, so a reference track comes
back as a timeline you can work on.

Being straight about what this is and is not.

Finding the sounds works well. Measured against a recording built out of eight
known voices at known moments, all eight are found with nothing invented, and
the ones with an attack land within thirteen milliseconds — under half a
frame. A sound that fades up rather than starting, like a whoosh, is found
about a third of a second late, because it has no attack to find.

Rebuilding them is a search of the palette, not a transcription. Forty
synthesised voices cannot reproduce an arbitrary recording. The voice that
actually made a sound comes out closest about a quarter of the time, and is
among the three offered about three quarters of the time — so the app offers
three, plays whichever you touch, and leaves the choosing to your ears.

**It cannot tell you whether a rebuild is any good.** The number beside each
offer is how alike the two are, and it is shown because it is real, not
because it is a verdict: a recording of a sound this app made itself scores
between seventy three and ninety six, and a sound it has no way of making
scores between seventy and seventy six. Those ranges overlap, so a middling
number tells you very little. Three ways of computing a confidence were tried
and none of them separated a good rebuild from a hopeless one, which is why
there are three offers instead of one answer. `tools/README.md` has all of it.

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

"Window", in the bar at the top, goes further: it floats the clip in a small
window over everything and takes the stage above the lanes out altogether, so
all of that height goes to the timeline. It is the same window the instrument
screens use, so it can be dragged anywhere and resized by its corner, and it
stays where you put it between sessions. Its × puts the stage back.

The window is clamped so it can never be parked over the bar on the left,
which is the only way between screens.

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

### Draw a level over time

The "A" next to a layer's name opens its level. A layer with a level drawn
over it fades, dips and swells across the piece rather than sitting at one
volume, which is what a bed of rumble under a sequence actually needs: it has
to come up as the shot opens out and get out of the way when someone speaks.

Click the lane to add a point, drag a point to move it, and click a point
twice to take it away. The level holds flat before the first point and after
the last, and reads as a straight line between them.

It moves everything on the layer together, including sounds that overlap,
which is why it is drawn on the layer rather than set on each sound. As soon
as anything is drawn it takes over from the layer's fixed level completely,
rather than multiplying with it, because two things claiming to be the same
control is how you end up unable to work out why something is quiet.

What you draw is what comes out. It is applied while you play and written into
every file you export, including the stems, which stay in sync with each other
because the shape is applied to each of them the same way.

### Work on several at once

Shift click, or Ctrl or Cmd click, adds a sound to what you are working on and
takes it out again. Dragging across the lanes draws a rectangle and takes
everything it covers, and a plain click still places a sound, so nothing you
did before has changed.

Everything then applies to all of them. Dragging one moves the group and keeps
its shape, including at either end of the piece, where holding each sound
separately would let the ends pile up while the middle carried on. Delete
removes them all, the arrows nudge them all, and the panel says how many are
chosen and reaches all of them, so setting six sounds to the same length is
one movement.

Copy, cut and paste work as they do anywhere. Paste puts them at the playhead
and keeps the gaps between them, so a rhythm copied is a rhythm pasted.
Duplicate lays a copy out straight after the original and chooses the copy, so
pressing it again and again lays out a run rather than a stack. All of it is
one thing to undo.

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
| Ctrl or Cmd and Z | Undo |
| Ctrl or Cmd, shift and Z | Redo |
| Ctrl or Cmd and A | Choose every sound |
| Ctrl or Cmd and C, X, V | Copy, cut, paste |
| Ctrl or Cmd and D | Duplicate |
| Pad keys | Drop that drum sound at the playhead |

Everything that changes the piece can be undone: placing, moving and removing
sounds, adding, renaming and removing layers, and drawing a level. A drag is
one step rather than one per pixel, so undoing a move puts the sound back where
it started rather than partway along. Removing a layer takes its sounds with it
and undo brings all of them back. Opening a session starts the history again,
since the piece has been replaced rather than edited.

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

### Keep a sound you made

Getting a voice, a length, a pitch, a level, a room and some push to sit right
together is most of the work of a sound, and until now that combination lived
only in the one place you put it. "Save as mine" keeps it under a name.

A saved sound appears at the top of the picker, can be placed anywhere like any
other, and is there in your next project as well as this one. It is kept as a
description rather than as a recording, so it is a few hundred bytes and can
still be tuned and stretched afterwards.

They are remembered between sessions and written into the session file. Opening
a session adds any sounds it carries that you do not already have, and never
replaces one of yours with the same name. "Forget", next to Save, removes one,
and anything already placed from it stays where it is.

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

Once a video is loaded, "Video" in the bar at the top floats the clip over the
instrument in a small window, so you can play to the picture. Drag its strip to
move it and its corner to resize it; it stays where you put it. The same window
is available on the timeline, from the "Window" button there.

To put what you play onto the timeline, arm the round red button on the sound
design bar first. See "Recording what you play" above.

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

Your patterns, your tempo, the sounds you saved, the packs you loaded, whatever
is on the timeline and your takes are all kept in the browser. A take is kept
as the recording it was rather than as decoded audio, which is why it is a few
tens of kilobytes rather than a few tens of megabytes; the audio is worked out
again the first time you play it back. "New project" leaves takes alone: they
belong to the instruments, not to the piece.

There are three export formats.

- WAV is the recorded audio, uncompressed.
- MP3 is the same audio at 192 kbps.
- MIDI is the notes you played rather than the sound. If you have not recorded
  anything, you get the current drum pattern instead.

## Keyboard

| Key | What it does |
|---|---|
| Space | Start or stop the transport |
| R | Start or stop a take, except while the piano is showing |
| W E R T | Crash, splash, second crash, ride |
| A S | Closed hi-hat, open hi-hat |
| D F | Kick, second kick |
| G H | Tom 1, tom 2 |
| J K L | Snare, floor tom, tom 3 |
| Z to M | Lower octave on the piano and guitar |
| Q to U | Upper octave on the piano and guitar |

R plays a note on the piano, so it only starts a take when the piano is not
showing. This is the take recorder on the instrument screens, not the round red
button on the sound design bar that puts what you play onto the timeline.

## Help

The question mark at the bottom of the bar on the left opens a panel listing
what everything does and every keyboard shortcut, in fifteen sections covering
both halves of the app.

Beside that, every part of every screen has a small question mark of its own —
next to Library, next to Describe, next to the transport, next to the
sequencer, and so on. Pressing one opens the same panel scrolled to the
section that answers it, with that section marked, so you get the answer to
what you asked rather than the top of a long page.

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
  keep.ts          keeping the piece, its clip and the takes between visits,
                   and settling which tab does the keeping
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
    catalogue.ts   a thousand named sounds over those voices
    vocabulary.ts  the words the app knows, and what each one means
    describe.ts    turning a sentence into settings
    listen.ts      finding the sounds in a recording, and measuring them
    rebuild.ts     making the nearest thing this app can make to one
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
    help.ts        the help panel, and the small "?" that opens it at a section
    keep-notice.ts the line saying another tab is keeping the piece
    video-window.ts the clip, floating over whichever screen you are on
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
