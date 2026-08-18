# Design source

These are the original design files for Beat Studio. They are kept here so you
can compare the built app against the design it came from.

## The files

- `Beat Studio.dc.html` is the design the app is built from. It uses the
  Toolcraft colours and type sizes.
- `Beat Studio v1 hardware.dc.html` is an earlier version. It has a different
  look, made to resemble a physical drum machine. Nothing in the app uses it. It
  is kept as a record of the earlier design.
- `support.js` is the runtime that the two files above need in order to display.
  It was produced by the design tool and should not be edited.
- `sync-notes.md` is the note that came with the design. It lists which parts of
  the Toolcraft starter each part of the screen was taken from.

## Viewing them

The design files need to be served over HTTP rather than opened from disk.

```bash
cd design
python3 -m http.server 8000
```

Then open `http://localhost:8000/Beat%20Studio.dc.html` in a browser.

## How they relate to the app

The design files are not source code and nothing builds from them. They are a
prototype written in a template language that `support.js` reads at runtime.
The app in `src/` is a separate piece of code that produces the same interface.

If you change the design, change the app by hand to match. If you change the
app's appearance, update these files or delete them, so the two do not drift
apart without anyone noticing.
