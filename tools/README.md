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
