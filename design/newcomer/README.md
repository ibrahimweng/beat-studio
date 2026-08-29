# The newcomer interface

Design source for the redesign these files were drawn for, which is the app
you are looking at: one screen, a panel that says what belongs on each moment
the video scan finds, and a library grouped by what is happening on screen.

- `Main.dc.html` is the redesigned sound design screen. The three panel tabs
  work, so Moments, Sounds and Selected can each be seen.
- `Classifier.dc.html` shows how the shape of the motion curve around a moment
  decides what sound is proposed for it.
- `Rail.dc.html` shows the left rail as it is now and as proposed.
- `canvas.json` places the three on the canvas.

Assembling these into the page that was published produces a single file of
about two and a half megabytes, because the canvas editor is bundled into it.
That file is generated and is not kept here: the four above are the source, and
between them they are under fifty kilobytes.

Colours, type sizes, radii and control heights are taken from
`src/styles/tokens.css`, `src/styles/layout.css`, `src/styles/controls.css` and
`src/styles/sound-design.css` rather than approximated.
