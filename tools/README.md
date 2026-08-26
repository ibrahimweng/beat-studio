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
