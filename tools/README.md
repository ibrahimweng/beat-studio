# Tools

Small pages and scripts used while working on the project. None of them are
part of the built site.

## voice-check.html

Renders every sound design voice and measures how alike they are.

Each voice is rendered on its own, then reduced to a fingerprint of what it is
made of and how it moves over its own length. Every pair is then compared. The
page reports the pairs that came out closest together, and the middle value
across all of them.

Run the development server and open http://localhost:5173/tools/voice-check.html

Use it after changing any voice. If two of them come out close to each other,
they will sound alike, and one of them is not earning its place.

A note on what it measures. The fingerprint looks at eight moments across each
sound and twenty frequency bands at each moment, with every moment scaled on
its own so the comparison is about shape rather than loudness. Measuring each
sound over its own length matters. An earlier version used a fixed three second
window, which made every short sound look alike because most of both was
silence.

## voice-print.html

Measures whether a change to the code behind a voice altered how it sounds.

`voice-check.html` asks whether two voices are too alike. This asks a different
question: whether a voice still sounds like it did before. It writes a
fingerprint for every voice in the app, and a second fingerprint of the same
voice rendered again. Most of these voices are built on noise, so no two
renders are identical, and that second print is how much ordinary variation
there is. A rebuilt voice has to match the old print at least as closely as the
old print matches itself.

Run the development server and open http://localhost:5173/tools/voice-print.html

Save the output before changing any voice, then run it again afterwards and
compare. Anything that scores worse than a voice scores against itself has
changed, and anything that does not has only moved within the noise.

## master-check.html

Checks the work done to a file after it is rendered and before it is written.

There are three parts to that: holding the loudest moments back so a stack of
sounds on one frame cannot clip, measuring how loud a piece actually is rather
than how high it peaks, and bringing every export to the same loudness. The
page tests each one against signals it builds itself, including that a set of
layers still adds up to the mix after all of it, which is the whole point of
doing the work once and applying it to everything.

Run the development server and open http://localhost:5173/tools/master-check.html

## automation-check.html

Checks that what is drawn over a layer reaches the file: the level, the
position between the speakers, the room around it, and how hard it is
pushed.

It renders a steady bed of sound on one layer and then draws shapes over it:
nothing at all, a fade, and a dip in the middle. Then it reads back how loud
each second came out. It also checks that a drawn level takes over from the
fixed one rather than stacking with it, and that reading a value between two
points gives a straight line.

The position is checked on both sides at once. Drawn down the middle it has
to be the same mix as none at all, since otherwise adding a lane would move a
mix that was already right. Held hard over, the far side has to be silent
while the near side keeps everything it had. Swept across, it has to cross
over gradually, never get louder than it was, and not dip in the middle: what
a position is worth to each side is a curve, so it is written once a frame
rather than ramped straight between the drawn points.

The room is measured as what is left sounding in the gap after a short hit.
Drawn at nothing it has to be no room at all, drawn at the top it has to
leave about the same tail as the Space control on a single sound, which is
what keeps the two controls meaning the same thing. Every render in the file
uses the same sounds, since a sound draws its noise from its own id and two
projects built the same way would otherwise differ by a percent or two.

The shapes between points are checked on their own before any of it reaches
a sound: no shape is a straight line, a hold does not move until it arrives,
a bend never doubles back on itself, and bending up and bending down by the
same amount are the same curve turned over, so dragging a segment up and back
down again arrives where it started. Then the same shapes have to reach the
file. A segment bent to hang back has to be louder for longer than a straight
one, one bent the other way has to get out of the way sooner, and both have
to start and finish exactly where the points are, which is read with the room
at the end of the chain out of the way: it rings on past the last point by
design, most of all for the shape that was loudest going into it, and that
would otherwise be read as a level that had not reached zero.

The push cannot be measured as a level, because it is not one. The plain
render and the pushed one come from the same sounds, so the closest a push
could come to doing nothing is turning them up: the check fits the one scale
that brings the plain render nearest the pushed one, takes it away, and what
is left is exactly what the push added. That residue has to grow with the
lane, has to sit higher up the spectrum than the sound it came from, and has
to be nothing at all when the lane is at nothing. It is read across a stretch
where the sound holds steady, since a push gives a quiet sound far more gain
than a loud one and across a decay it would show mostly as an envelope that
changed shape.

Last, it renders one file per layer from a piece with a position drawn on one
layer, and a room and a push on another, and adds them back up. They have to come to the
mixed file: a layer's room and position belong to that layer, and a set of
files where the room appeared twice, or not at all, would be no use to
whoever picks them up.

Run the development server and open http://localhost:5173/tools/automation-check.html

## voice-check.html

Measures how alike every voice is to every other, which is the check on
whether adding voices is adding sounds or only adding names.

Each voice is fingerprinted by what it is made of and how that moves across
its own length, and every pair is compared. What matters is the closest pair:
if a new voice lands nearer to something than anything already in the palette
was to anything else, it is a variation rather than a voice.

Two things had to be fixed here before the numbers meant anything. The
fingerprint had no idea about repetition, so a single tick and a run of
twenty of them measured as nearly the same sound; a run of hits is now
described by how much its level jumps about and how often it jumps upward,
which separates one event from many. And the renders were unseeded, so every
run drew different noise and an unchanged pair of voices moved by five
hundredths between runs, which is larger than the differences being looked
for. Seeded, and averaged over three seeds, a run now gives exactly the same
answer twice.

It also reports the loudest and quietest voices and any that are silent,
since a voice nobody can hear is no use however distinct it measures.

Run the development server and open http://localhost:5173/tools/voice-check.html

## mechanism-check.html

Checks that each way of making a sound actually does the thing it is named
after, rather than being another way of arriving at the same noise.

A struck body has to ring at the notes it was given and at nothing in
between, its louder partials have to be the louder ones, and its short
partials have to die first, which is the difference between an object and a
chord. A soft strike has to leave the high partials behind.

A pluck has to come out at the pitch asked for, put its harmonics where a
string puts them, and start bright and turn dull rather than only getting
quieter. Its damping has to mean something across its whole range.

A cloud has to be mostly the silence between its grains when it is thin and
continuous when it is thick, and spreading the pitch has to actually spread
it. A run of hits has to arrive at the rate it was given, and a run told to
speed up has to speed up.

Two of the measurements needed care. Counting hits by looking for samples
over a threshold counts the cycles of the tone inside each hit rather than
the hits, so they are counted as sharp rises instead, which also survives
hits arriving faster than they die away. Grains have no sharp rise at all,
since they are faded in deliberately so that a thousand a second is not a
thousand clicks, so a cloud is measured by what lies between its grains
instead.

Run the development server and open http://localhost:5173/tools/mechanism-check.html

## library-check.html

Checks the thousand-entry library: that it holds what it says it holds, that
everything in it can be found, and that the grid it is built on is made of
real steps rather than a thousand names over forty sounds.

The searching half is quick. Every entry has to be findable by typing its own
name, every word typed has to match something, a word carried only as a tag
has to still get you there, and a name match has to beat a tag match.

The listening half renders all thousand and asks how far apart they are. Four
things were learned the hard way and are worth not learning again.

Render at the rate the app exports at. Rendering at half rate to save time
reported ten entries as silent that are nothing of the kind: a click is noise
above a corner, and tuning one up walks that corner past 11 kHz. That also
turned up a real fault — the corner used to walk past the sample rate itself
at the top of the Tune range, and the sound vanished — which is why it is now
capped inside the audible band.

Give every render a fixed id. A placed sound draws its noise from its own id,
so leaving that to `makeCue` makes the page answer a slightly different
question every run.

Measure the room after the sound stops, and floor it. The first four features
could not see a reverb at all, because one here is added to the sound rather
than blended with it and so barely changes how long or how bright the whole
render is; what happens after the hit is over is nothing but room. Floored at
forty decibels down, or it measures the last bit of a float instead — two
renders of the same dry bell differ there, and unfloored that read as a whole
octave of difference.

Compare a step against one semitone, not against the engine's own noise. A
semitone is the smallest change any control in the app can make, it is
measured on the voice being stepped, and it holds still. How far apart two
placements of the same sound land is reported alongside, but it is not a bar
to clear: on the noisier voices it is larger than a small room is, and asking
a library step to out-shout that answers a question nobody has.

What it reports: a different voice is about forty times one semitone, one
size up about ten, one room bigger about five, and two placements of the same
sound about one and a half. A tenth of the steps come out under a semitone
and every one of them is a room step on a voice that sustains — a drone, a
sub, a motor, a swell. That is a fact about reverb rather than a fault in the
grid. A room shows itself in what happens after a sound stops, and a sound
that does not stop does not give it the chance.

The count of those moves by a few per cent between runs while the verdict does
not, for the reason `mechanism-check.html` measures directly: a struck body is
a stack of oscillators summed by the graph rather than numbers added in a
fixed order, so it comes back differing in the last bit of a float.

Takes about a minute and a half. Run the development server and open
http://localhost:5173/tools/library-check.html

## listen-check.html

Checks that sounds can be pulled out of a recording, against ground truth
that exists because the recording is made here: eight known voices at eight
known moments, at known settings.

Finding them works. All eight are found with nothing invented, the ones with
an attack land within thirteen milliseconds — under half a frame — and seven
of the eight lengths come back within a third or fifty milliseconds. The one
that does not is the whoosh, which fades up rather than starting, and is found
a third of a second late. That is reported rather than smoothed over: a sound
with no attack has no sharp answer to "when did it start", which is why the
app anchors risers and swells to their end rather than their beginning.

Four things had to be fixed before any of it worked, and each of them was
found by this page rather than by reading the code.

Onsets were over-detected. A hit is rarely one rise — a body arrives and a
brighter part of it follows — so a sound now casts a shadow over the next
three hundred milliseconds, inside which a rise has to be a decent fraction of
the one before it to count. Five spurious events became none.

Lengths were read at a single threshold, twenty two decibels down, which
returns a third of the true length for anything that decays. Two thresholds
give a rate and the rate gives the rest, and they are read early — six and
twenty decibels down — because a sound in a room stops being the sound and
starts being the room somewhere after that. Reading late measured the room and
returned three times the length for anything reverberant.

The two sides were printed over spans decided differently: a recording from
its onset to where its envelope ended, a candidate over its whole render
buffer. A fingerprint divides whatever it is given into eight slices, so that
put every slice out of step, and a recording of this app's own metal came back
as a bell. One function now decides both.

And the similarity itself was a plain dot product of two lists of non-negative
numbers, which is high for almost any pair. It gave ninety seven per cent for
the same sound twice, fifty nine for a deliberately wrong voice, and ninety
five for a sound the app has no way of making. It is now compared in logs,
with the average of the whole palette taken out first — without that, every
voice scores about ninety per cent against every other one, because they are
all sounds.

**There is no honest confidence number, and three were tried.** The similarity
barely separates: a recording of a sound this app made scores between seventy
three and ninety six, and a sound it has no way of making scores between
seventy and seventy six. Rescaling between a typical voice and a perfect one
put the impossible sounds at seventy per cent. Scoring how far the winner
stood above the other thirty nine put them at seventy two, the same as
everything else. So the feature does not claim one: it offers three ways of
making each sound and says the number is a similarity rather than a verdict.

That is founded on the measurement that matters. The voice that actually made
a sound is the closest one about a quarter of the time, and among the three
offered six times out of eight. A search that is right a quarter of the time
and useful three quarters of the time should hand you three and let you
listen.

The last section is the honest one. Everything else is the app listening to
itself, which is the only way to have ground truth and is also the easiest
possible case. Four sounds are built out of things the palette has no voice
for — a swept sine, a square wave, a resonant pair, a slow bowed swell — and
what they score is a fairer guess at what a recording off a hard drive would
score. There is no threshold on them; the numbers are printed.

Takes about a minute. Run the development server and open
http://localhost:5173/tools/listen-check.html

## stack-check.html

Checks that a sound made of several voices really is all of them, at a level
that says two voices rather than twice one voice.

The main claim is arithmetic rather than taste. Two voices that have nothing
to do with each other sum incoherently, so the energy of the pair is the
energy of each added together — and since a stack halves both to keep two
voices about as loud as one was, what should come back in every band is half
of each. Across six pairs it lands within a decibel, and it is nearer that sum
than either voice on its own by ten to sixty decibels.

Two measurements had to be fixed before they measured anything. The first
version read a single DFT bin per band, which is a hopeless energy estimator:
two unrelated sounds land anywhere from cancelling to doubling in any given
bin, and it reported sixteen decibels of error in the arithmetic rather than
in itself. It now takes overlapping windowed transforms and sums power across
each band. The second was the threshold. A stacked voice draws its noise from
further along the same stream as the one before it, so the metal inside a
stack is a different draw of the same voice, and how much that alone moves a
band is measured by rendering each part twice under two ids. On one pair —
slam and wire — a redraw moves a band by six decibels, which is far more than
the stack is out by.

The level check found nothing wrong and one thing worth knowing. A voice is
very slightly more than quadratic in its level, because the envelope curves
end at an absolute floor rather than one scaled by the level, and an
exponential ramp needs somewhere above zero to aim for. It is a fifth of a
decibel. Predicting half rather than measuring what the engine actually does
reads it as a five per cent error in the stack, which is what an earlier
version of this page did.

The rest is the rules that keep a stack simple: that it is one deep and a
session file cannot smuggle a deeper one in, that it adds layers rather than
replacing them, that how much of each can be set and lands where the square
law says, that it survives a session file and a patch file, that the same
stack comes back the same sound, and that three voices at once at the ends of
every slider still make one.

Run the development server and open
http://localhost:5173/tools/stack-check.html

## describe-check.html

Checks that a sentence comes out as a sound it could reasonably mean, and
that every word in it reaches a setting.

Two corpora, and the difference between them is the point. The first forty
descriptions were written before the vocabulary was, as things somebody
putting sound to picture would actually type. They scored 39 of 40, and the
one miss was that there was no word for an explosion — a hole worth filling
rather than a score worth protecting, so it was filled, and that list now
reads 40 of 40 and is no longer a measurement of anything. The second twenty
were written afterwards and lean deliberately on words nobody sat down and
added. They score 15 of 20, and all five misses are the same shape: a noun
the vocabulary has never heard of, reported back rather than guessed at.

Both lists were written by the same hand as the vocabulary, so what they
measure is coverage of the phrasings that hand thought of. That is a weaker
claim than a hit rate usually sounds like, and it is the reason the failures
are printed in full rather than counted.

One miss led to a change in mechanism rather than vocabulary. "Slamming" did
not reach the slam, and neither did "ringing" reach the bell, because a table
that has to carry every ending of every word will always be missing one.
Words are now tried as themselves first and then as the shorter word they
might be an inflection of, and only a stem that turns out to be a word one of
the tables already knows is used — so "menacing" does not quietly become
"menac".

The rest checks that the axes actually move: that size reaches pitch and
length together, that a room can be asked for and refused, that an
intensifier scales the word after it rather than the sentence, that
brightness moves a sound without changing its size, that a voice can be ruled
out, and that anything unasked for is left exactly as the voice made it. Then
every suggestion the two corpora produce is rendered, plus the corners where
two axes are pushed to their ends at once, to check that nothing it offers is
silent or outside what the sliders can hold.

Run the development server and open
http://localhost:5173/tools/describe-check.html

## shaper-check.html

Records why Drive is not oversampled, which is not the usual answer.

A shaper bends a sound, and bending makes harmonics. Some of them land above
what the sample rate can hold and fold back down as tones nothing played, and
the usual fix is to run the shaper at four times the rate. This measures what
that is worth and what it costs, on a tone whose folded harmonics land
between the real ones rather than on top of them.

It is worth about seventy eight decibels: what folds back sits seventy two
decibels under the harmonics without it and a hundred and forty nine with it.
It costs a hundred and ninety two samples, which is four milliseconds, or an
eighth of a frame. Seventy two decibels down is the noise floor of a twelve
bit recording and nobody will hear it. Four milliseconds lands on a pushed
sound and not on the one beside it, in a tool whose whole point is putting
sounds on exact frames. So the delay is the one that goes.

The last three checks show the other half of it. A push is a bent copy
blended against an untouched one, and oversampling only the bent half leaves
the two out of step: a comb filter, notches across the sound that nobody
asked for, worst at exactly the middle settings people use. Not oversampling
at all, the two halves add back up to the sound they came from.

Run the development server and open http://localhost:5173/tools/shaper-check.html

## character-check.html

Checks that Space and Drive do what they say.

Space should leave the sound itself completely alone and add a room after it,
Drive should add harmonics above what was there rather than just turning the
sound up, and both at nothing should leave the voice exactly as it was.

The first of those is the one worth having. It is what caught the room being
built from the same run of noise as the voice, which meant turning Space up
changed the hit rather than only what was around it. The page renders the
same placed sound with and without each and measures the difference: how long
the tail runs, how much of the sound sits above 200Hz, and whether anything at
all changed when neither was asked for.

Run the development server and open http://localhost:5173/tools/character-check.html

## export-check.html

Checks a whole export, from a project to the bytes of the file.

It builds a project that clips badly on purpose, exports it every way the app
offers, and then reads the results back: that nothing gets past the ceiling,
that the loudness lands where it was asked to, that the file really is 24 bit
at 48k, that every file in a set is the same length, that the layers add back
up to the mix, and that the marker list describes what was exported.

Run the development server and open http://localhost:5173/tools/export-check.html

## pack-check.html

Measures how well a sound pack written for `@web-kits/audio` survives being
read into this app.

Beat Studio describes its own voices as data, and that format describes sounds
as data too, so a pack can be read straight into the palette and played by the
same code that plays everything else. This page renders every sound in every
published pack twice, once with that project's own engine and once through
this app's reader, and compares the two.

It needs their engine and their packs, neither of which is a dependency here:

```bash
npm pack @web-kits/audio
mkdir -p tools/.wk && tar xzf web-kits-audio-*.tgz -C tools/.wk --strip-components=1
npx @web-kits/audio add raphaelsalaja/audio
mkdir -p tools/.wk/packs && cp .web-kits/*.json tools/.wk/packs/
```

Then run the development server and open http://localhost:5173/tools/pack-check.html

Across all 269 sounds in the ten published packs the middle score is 1.000 and
nothing falls below 0.95. Reading in is close to exact because this app's model
is wider than that format, which is also why writing a patch out is not: see
`src/export/patch.ts`.

## wk-check.html

Measures how well the exported patch survives leaving the app.

`Export patch` writes the palette as a `@web-kits/audio` patch. That format
describes a sound as a graph of standard nodes, and a few of these voices are
not that, so some of them come out close rather than exact. This page renders
every sound in the exported file using that project's own published engine,
renders the same voice here, and compares the two.

It needs their engine, which is not a dependency of this project because
nothing in the app uses it. Fetch it into place first:

```bash
npm pack @web-kits/audio
mkdir -p tools/.wk && tar xzf web-kits-audio-*.tgz -C tools/.wk --strip-components=1
```

Then export a patch from the app, save it as `tools/.wk/patch.json`, run the
development server and open http://localhost:5173/tools/wk-check.html

`tools/.wk/` is ignored by git. The scores it reports are recorded in
`src/export/patch.ts`, next to the reason for each one. Run it again after
changing a voice or the conversion, and update those numbers.

## Checking the transport, the playhead and record

There is no page for these three. Everything else in this folder measures the
audio, which can be rendered offline with nothing on screen; the transport
needs a real video element, a real clock and a real pointer, so it is checked
in a browser instead. What follows is what was checked and what it should do,
so it can be checked the same way again.

Load a clip on the sound design screen, then:

- **Before a clip is loaded** every round button except play is dark. There is
  nothing to stop, step through or run past.
- **Play, then stop.** The playhead goes back to where play started, not to
  zero. Press stop again and it stays there.
- **The two skip buttons** move to the next sound placed either side of the
  playhead and select it as they land. With no sounds placed they are dark.
  With the playhead exactly on a sound, one press moves off it rather than
  sticking.
- **Hold fast forward** and the clock runs on at six times speed — about three
  seconds of clip a second. Let go anywhere on the screen, including off the
  button, and it stops at once. Measured: a three minute clip ran 0:00:27 to
  0:03:00 while held, and stopped on release.
- **Drag the ruler.** The playhead follows the pointer. Doing it while playing
  scrubs, and playing resumes from where you let go.
- **Drag the small tab** at the top of the playhead. Same thing, with
  something big enough to take hold of — the line itself is one pixel wide and
  passes pointer events through to the lanes underneath.
- **Record.** Arm it, go to the drums, hit some pads: each one lands on the
  timeline at the playhead. The keys and the guitar do the same. Disarm it and
  playing places nothing. Unarmed play placing nothing is the half worth
  checking, because a capture hook that fires when it should not is silent
  until the timeline fills up with things nobody asked for.

The floating video window is worth two checks of its own, both of which have
been wrong at some point:

- **It must never cover the bar on the left.** That bar is the only way
  between screens, so a window parked over it strands you on whichever screen
  you are on. It is clamped at 64 pixels, and the bar is also lifted above it,
  which is two locks on the same door.
- **The × means different things on different screens.** On the timeline it
  turns the Window setting off and gives the stage back. On the instruments
  there is no stage, so it means the window is not wanted until the Video chip
  asks for it again. Shutting it on one screen must not answer for the other:
  check that shutting it on the timeline still leaves the drums showing it.

## size-check.html

Does the size axis do anything, voice by voice?

The library is one grid — five sizes, five places — laid over forty mechanisms
that do not all respond to it the same way, and a grid that does not fit is
what produces two names for one sound. This measures each step on its own, so
a fix can go where the fault is instead of everywhere.

It reports two numbers per voice and you need both, because each is blind
where the other works:

- **the fingerprint**, which stops at 10 kHz;
- **five wide bands to Nyquist**, which cannot see a pitch that stays inside
  one of them.

That is not caution, it is the finding. A tiny click puts 97% of its energy
above 10 kHz and a huge one 63% — plainly different sounds — and the
fingerprint calls them 98.7% the same, because everything it can see is the
filter's skirt with the same shape at both ends. The other way round, `sub` and
`rumble` live entirely in the bottom band, so the band measure shows nothing
however far their pitch moves while the fingerprint sees it clearly. Anyone
tempted to "fix" a voice by one of these numbers should read the other first.

What it found, and what came of it:

- **Three voices ignored the Tune control entirely** — `rain`, `fire`,
  `ratchet`, `clockwork` and `zip` never read `o.tune`, so the slider did
  nothing at all for five of the forty. `zip`'s mid-to-large step measured
  100% identical because length was its only axis and it clamps its own
  length at 1.2 seconds. All five now follow it.
- **Voices already at the length floor.** A click is 20 ms and clamps at 60,
  so five lengths of it are one length. They get a size axis that runs on
  pitch instead, and pulled *down* rather than widened, because their filter
  corners ran into the top of hearing at the small end and were capped there.
- **`reverse` had no size at all.** Tune moved only the tone, which is two
  fifths of it; the noise over it was full band and went nowhere, so a tiny
  reverse and a huge one both put 45% of their energy below 2 kHz. It now
  carries a filter and an air amount that follow size: 19% below 2 kHz at tiny,
  95% at huge.

And what it did not fix. `riser`, `swell` and `reverse` sit in one cluster of
21 entries, dry, at both ends of the axis — they are three mechanisms that
converge into one low sweep however their size axes are set, and three
different axes were tried before concluding it. That is a question about
whether they should be three voices, not about the grid over them.

## Checking that work survives a reload

No page for this one either: it is about what two browser stores hold across
a page load, which needs a real page load.

With a clip loaded and a few sounds placed, and after a second's pause for the
write to settle:

- `localStorage['toolcraft.st88.work']` holds a session file — the same shape
  `Save session` writes, so one reader checks both.
- IndexedDB `toolcraft.st88` → `clip` → `current` holds the video as a blob.
- Reload. The sounds, the layers, the frame rate and the snapping come back,
  the clip comes back with them, and the timeline bar says so.
- Undo does not walk back past the restore into an empty project. The history
  is started again on the piece that was restored, not on nothing.
- `New project` asks first, clears both stores, and a reload after it opens on
  nothing rather than bringing the piece back.

Two failures are worth arranging on purpose, because both happen in the wild:

- **Delete the IndexedDB record and leave localStorage alone**, which is what
  a browser evicting storage looks like. The piece must come back on its own
  and say the clip has to be loaded again — never sit waiting for a clip that
  is not coming.
- **Fill the quota**, or use a clip larger than the browser will store. The
  piece is still kept; the timeline bar says the clip was not.

One thing this found: the status line the sound design screen writes to was
only ever drawn in the dock at the bottom of the instrument screens, so every
message about the timeline — a session opened, an export finished, a clip that
would not fit — was written somewhere nobody on that screen could see it. It
is now in the timeline bar.

## variety-check.html

Asks how many genuinely different sounds are in the thousand-entry library, by
rendering every one of them and comparing all 499,500 pairs.

`library-check.html` walks the grid one axis at a time — is one size step
bigger than a semitone, is one room step bigger than a semitone — and a
library can pass all of that while still holding entries that are the same
sound under two names. This looks at the whole grid at once.

What it reported when it was written:

```
median 0.3%   90th 59.2%   99th 84.1%   worst 100.0%
49 of 1000 entries sit in 12 clusters, closer than 97%
  1. 15 entries — tiny click, dry · small click, dry · click, dry · … · huge tick, dry
  2.  7 entries — large riser, dry · huge riser, dry · large swell, dry · …
  3.  6 entries — small riser, dry · tiny swell, dry · …
one voice, its 25 versions:     median 60.1%
same size and place, 40 voices: median 0.3%
```

So the palette is well separated — a median of 0.3% across every pair — and
the duplicates are concentrated in two corners rather than spread about.

Per-placement variation, added afterwards, took that to 38 entries in 8
clusters and the worst pair from 100% to 99.4%, so nothing in the library is
identical to anything else any more. It broke the fifteen clicks and ticks
apart into three. It made the risers and swells *worse*, from 7 in a cluster to
21.

Then per-voice size axes — see `size-check.html` — took it to **33 entries in 5
clusters**. Twenty-seven of the thirty-three are the riser, swell and reverse
family, which no size axis fixes: those three converge whatever they are given,
and it is a question about the voices rather than the grid. The other six are
three pairs, of clicks and glitches, at neighbouring points.

Both corners have the same cause, which is worth knowing before changing
anything: the size axis multiplies length, and `click` is 0.02s to begin with,
which is `MIN_LENGTH`. Five sizes of it span 0.02s to 0.042s, and at eight
windows of twenty bands those print identically. Risers and swells collapse at
the other end for the mirror-image reason. Size wants to be a per-voice idea
rather than one multiplier.

## redraw-check.html

Places the same library entry twice and asks how different the two are.

This is the question a recorded library answers by giving you five takes of a
door slam. What it reported:

```
bit for bit identical: 7 of 40 voices (wobble, sub, drone, pop, beep, chirp, zap)
how alike the two are: median 98.9%
most different: ratchet 30.7%, glitch 37.4%, motor 73.0%
```

It now runs every voice twice at two settings — the control off, which is what
the app did before `src/audio/vary.ts` existed, and on at its default — so the
two sides cannot drift apart between runs. What it reports:

```
TWO TAKES OF ONE SOUND        off        on
  how alike they are       98.9%     94.8%   (median)
  bit for bit the same        13         0   of 40
  level between takes     0.06dB    0.47dB   (median)
  nearer its own voice than any other: 34 off, 37 on, of 40
```

Three things to read out of that.

The second measure exists because the first cannot see the tail. The
fingerprint is twenty bands from 40 Hz to 10 kHz, so a third of a semitone is a
tenth of a band: moving a `sub` or a `beep` by that much leaves the print at
99.8% while the two are no longer the same file at all. Peak level says what
actually moved.

The identity count is the half that stops this being a win on paper. Two takes
of a sound have to still be that sound, so beside "how alike are two
placements" sits "how alike is a placement to a *different* voice", and the
first has to stay clear of the second. It went up rather than down, which is
the result worth having: nothing lost an identity it had.

Three voices — `fire`, `ratchet`, `motor` — read as nearer another voice than
themselves with the control **off**. That is the noise seed alone, and it was
true before any of this. Do not read it as damage from the variation.

Three findings came out of building it, all of them from this page:

- **One take for the whole voice, not one per layer.** A glitch is a dozen
  bursts described as a dozen layers; drawing separately for each scattered
  them and two placements came back 0% alike.
- **A cloud's density and a run's rate must not move.** They say when every
  event lands, so nudging them relocates all of them: a ratchet came back 4%
  alike to itself.
- **How much depends on what the voice is made of.** Grains and impulses
  already redraw from the noise seed; giving them the full amount pushed
  `fire` and `static` past being themselves. They get 40% of it.

## Checking the things a review turned up

Six faults came out of using the app rather than reading it. Each is worth
re-checking the same way, because none of them shows up in a type checker and
four of them look fine until you try the exact thing.

- **Two tabs.** Open the app twice on one browser profile. The second says so
  in a strip across the top and writes nothing; `toolcraft.st88.work` must
  still hold the first tab's piece however much is placed in the second.
  "Keep here instead" hands it over and writes what that tab has, including
  what it did while shut out. Closing the keeping tab hands it back within a
  heartbeat (four seconds) without anybody pressing anything. Before this,
  measured: a second tab's sounds vanished from the store while still being
  drawn on screen.
- **Narrow windows.** At 880, 700 and 640 pixels the sound design panel must
  still be there with sounds to pick and an export button. The *instrument*
  inspector must still hide — that one really is supporting detail. Before
  this, one rule hid both, and the timeline screen at 880px could place sounds
  and do nothing else with them.
- **The small "?".** It has to clear 3:1 against its background. Measured by
  compositing it on a canvas rather than by parsing the colour: these are
  `oklab` with alpha, and reading the numbers out of the string gives ratios
  above 300:1, which is not a thing. The first pass measured 2.1:1. It is now
  9.9:1.
- **Export.** Press WAV three times. One file. The buttons disable while a
  render runs and come back after.
- **Takes.** Record a pass, reload, it is still listed with its name and
  waveform and it plays. What is written down is the recording, not the
  decoded audio — 24 kB for a five-hit take rather than megabytes — so check
  the stored record has no `buffer` field. "New project" must leave takes
  alone.
- **A broken session file.** `{"format":"beat-studio-session","project":
  {"cues":"not an array","layers":null}}` must be refused, not welcomed. It
  used to validate every field away and then report "session loaded, 0
  sounds".

One migration to check while any of this is being changed: the IndexedDB
version went from 1 to 2 when takes were added. Build a version 1 database with
a clip in it by hand, then load the app, and the clip must still be there
afterwards with a `takes` store beside it.

## Checking recorded sound

No page for this one: it needs a real file chosen through a real file input,
which is a browser away from anything this folder can do.

Make a short WAV by hand — a tone with a decay is easiest to recognise — and:

- It arrives, and the button shows its length. A file that is not audio in the
  same batch is named and left out rather than taking the others with it.
- Placed, it lands at its own length and renders with real audio in it. Check
  the peak and where the sound stops, not just that a cue appeared.
- An octave up plays it in about half the time. That is the whole meaning of
  Tune on a recording, and it is easy to wire so that only the pitch moves.
- It survives a reload, and so does the piece using it.
- "New project" leaves the recordings and clears the timeline.

**The one that matters most: export from a fresh page.** Load, place, reload,
press export without touching anything else, and read the samples out of the
file. Before this was fixed that came out silent, because decoding needs an
audio context, a browser withholds one until something is clicked, and pressing
export is a click that never starts the engine. Playing first hid it — the
piece sounded correct and the file was empty.

Two things about measuring it, both of which cost time here:

- **The app writes 24-bit WAV.** Reading it as 16-bit walks off the sample
  boundary and reports silence for a file that is not silent. Always check a
  reader against a control — export a synthesised sound and confirm the same
  code finds audio in *that* — before believing it about anything else.
- **Never probe the app's modules from `page.evaluate`.** A dynamic `import()`
  gets its own instance in a Vite dev server, so `samples()` read that way came
  back empty while the UI was drawing the recording and IndexedDB was holding
  it. Assert on what is drawn and on the exported file.

## Importing an archive

There is no page for this: it needs a real file input and a real IndexedDB, so
it lives in the Playwright harness rather than here. What it covers, and what
it caught:

- A zip is opened on import, its non-audio entries skipped, and the folders
  inside it become tags — `Foley/Doors/oak.wav` arrives filed under `foley` and
  `doors`, because that is where an archive already keeps its categories.
- Freesound names every download `<id>__<username>__<name>`, so a library
  assembled by hand from the site arrives knowing who to credit without the API
  or the readme. The licence is not in the name and stays unset, because
  guessing between CC0, CC-BY and non-commercial would be worse than admitting
  the file did not say.
- A CSV or TSV shipped with the archive is read and used to name the sounds,
  which is what makes the BBC archive usable at all: its files are called
  things like `07076051.wav` and the descriptions live in a separate list.
  Which column holds the filename is found by seeing which one is full of the
  files actually being imported, rather than by matching headings — there is no
  single format to match, and content-matching fails safely, so a track listing
  or a licence list in the same zip contributes nothing rather than renaming
  the library after its columns.
- 400 files import in 1.4 seconds and restore in 0.8. Only 60 buttons are drawn
  at once; the search reaches the rest.

Three faults it found:

- `#keepSamples` picked out four fields by name, which silently dropped the
  credit and the tags on the way to the store. The library came back after a
  reload with its names and its lengths and no idea who had made any of it.
  Spreading and removing what cannot be written is the shape that does not go
  wrong the next time a sample gains a field.
- `owesCredit` tested the start of the licence string for `cc0`, and Freesound
  writes it as "Creative Commons 0" — so every public domain sound was about to
  be listed as owing a credit it does not owe.
- A Freesound name is shown with its dashes turned into spaces, so someone
  searching for `sound-37` — what they can see in their downloads folder — got
  nothing. Both sides are flattened before matching now.

And one that was the test's fault, not the app's: placed cues are `.cue`, not
`.tl__cue`, so "a recording can be placed" failed while placing worked
perfectly. Check a selector against the DOM before believing what it reports.

## preview-check.html, and place.js

Whether every sound in the library can actually be heard before it is placed.

Four voices — riser, swell, reverse and zip — are anchored to their **end**:
they finish on their marker rather than starting from it, because a riser
exists to lead into something. `cueLength` therefore clamps them to how much
timeline lies before them, so a riser dropped at 0.3 s is 0.3 s long. That is
right for a placed sound and nonsense for a preview, where the position is a
fiction — and a preview cue was being built at time zero, so all four
collapsed to the 0.2 second stub their own minimum allows.

**A hundred of the thousand library entries could not be auditioned**, and
clicking any of those four in the palette played a blip rather than the sound.

It also poisoned the measurements, which is how it was found. Every page here
that renders one sound in isolation placed its cue at zero, so `variety-check`
had been comparing three 0.2 second noise blips and reporting twenty five
entries in clusters that "nothing tells apart" — every one of them a riser, a
swell or a reverse. That was written up as a design question about whether
those should be three voices. It was not a design question. `place.js` now
holds the one line that puts an end-anchored cue where it can sound, and the
pages import it.

Two things worth carrying forward:

- **The number of affected voices was wrong in three separate comments** until
  the check enumerated them from `DESIGN_DEFAULT_ANCHOR` instead of being
  told. Reading a forty-entry record by eye finds three of the four.
- A cluster of "identical" sounds is a claim about the measurement as much as
  about the sounds. Check what the probe is doing before concluding anything
  about the library.

## What the variety check cannot see

`alike` compares 8 windows of 20 log-spaced bands plus an envelope. Inside one
band it cannot tell a partial from noise, so it is blind to tonality.

Measured while separating `reverse` from `swell`: driving the reverse voice's
noise share from 0.28 down to 0.02 moves its spectral flatness from 0.51 to
0.18 — the difference between a wash and a clearly ringing object — and moves
its `alike` score against the swell from 93.3% to 92.5%. Splitting the print
into its spectrum and envelope halves shows the same thing: the spectrum half
alone stays at 92%.

So a high `alike` between two voices is not on its own evidence that they
sound the same, and a change that does not move it is not on its own a change
that does nothing. Spectral flatness is the measure for tonality. Both are in
`redraw-check` and `variety-check`; neither replaces listening.

## attack-check.html

Whether a voice reads as an event or as a tone that starts, by how far its
spectral centroid falls over the first 30 ms and how sharp its onset is.

Written to justify giving the twenty-eight single-layer voices a contact layer
— the mallet touching the bell, separate from the bell ringing. **It measured
the opposite and the change was reverted.** Kept so the idea is not had twice:

- A modal source already has a broad, bright onset. Five partials starting at
  once is close enough to a step to be broadband on its own. `bell` measures
  5460 Hz at its onset with no contact layer at all; adding one at a sensible
  level moved it to 5466 Hz and raised the energy in the first 3 ms by 0.7%.
  Driven to a gain of 10 — clipping, peak 4.26 — it reached 5829 Hz. The
  contact is not wrong, it is masked.
- Randomising each partial's phase was tried next, on the theory that partials
  all starting at phase 0 sum into an unnaturally coherent spike. With five
  widely spaced inharmonic ratios they do not: peak 0.393 in phase against
  0.420 random.
- **"28 of the 40 voices are a single layer" does not mean what it looks like.**
  Counting `one()` calls counts how a voice is written down, not whether it has
  structure. `impact` scores 1.44 because it carries an explicit transient
  layer, but `bell` scores 0.74 with one layer and nothing else.
- A low number is not a fault. `glass` scores 0.07 because glass does not dim
  as it rings, which is the whole difference between glass and wood; `thud` is
  documented as having no transient; `click` is a contact with nothing to
  settle into.

One trap in the measurement itself, which produced a confident null result
first: the FFT window was 2048 samples, which is 42.7 ms — longer than the 3 ms
event being looked for, so the contact was averaged in with twelve times as
much ringing and every voice measured exactly as it had before the layer
existed. A window has to be shorter than the thing it measures. It is 256
samples now.

## room-check.html

Whether the rooms are rooms, or decaying noise with a new name.

Measures the three things that separate a space from noise that fades: that
discrete reflections arrive where the room's size says they should, that the
tail thickens instead of starting at full density, and that the top end dies
before the bottom does.

Four traps, every one of which gave a confident wrong answer first.

- **Counting non-zero samples does not measure density on a filtered tail.** A
  one-pole at 250 Hz takes 13 ms to ring below 1e-9, so any gap shorter than
  that reads as full and every room came back at 1.00 density from its first
  sample. Crest factor — peak over RMS in a window — survives filtering and
  says what is actually there.
- **Looking for a sample that stands out finds the sparse tail, not the
  reflections.** It reported a first arrival at 3.3 ms for every room,
  cathedral included. Differencing against the same room built with `early: 0`
  isolates the taps — but only after matching the two on a late window, because
  adding taps changes the energy the buffer is normalised to and the raw
  difference is otherwise mostly a global rescale.
- **Waiting for a band to fall a full 60 dB does not work when the buffer ends
  first.** Every band read as "however long the buffer is", so the top looked
  like 0.83 of the bottom's life when the curves themselves were nearer a half.
  T30 — the slope from -5 to -35 dB, doubled — is what an acoustician uses and
  what this uses. It also found a real fault: the buffer was cut at the nominal
  length while the bass rings 1.22 times longer, so every room ended by
  stopping rather than fading.
- **Measurement bands leak.** At 6 dB an octave the "8 kHz" band carries enough
  2 kHz to floor the result. These are 30 dB an octave. The same mistake was in
  the synthesis: splitting the tail into bands with one-pole crossovers and
  giving each its own decay measured 0.91 when it was designed for 0.53,
  because the high band was mostly low band. A filter that closes over the
  length of the tail has no crossover to leak through.

## make-icons.mjs

Draws the site icons.

`public/favicon.svg` is the master. This script holds the same geometry and
writes the raster versions that some browsers and phones want:
`public/favicon.ico` at 16, 32 and 48 pixels, `public/favicon-96.png`, and
`public/apple-touch-icon.png` for a home screen.

```bash
node tools/make-icons.mjs
```

Run it after changing the icon, and change the SVG to match. Nothing is
installed to do this. The picture is five rounded rectangles, so the script
draws them itself and writes the PNG files with the zlib that comes with Node.
