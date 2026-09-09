# Taking a beat apart

Design source for the second screen, which reads a recording and divides it into
the parts it is made of.

- `Screen.dc.html` is the screen at 1440 by 900, with a beat taken apart and the
  drums opened. The rows are the real ones: a share, a name, what the part is, a
  waveform, and the buttons that act on it. Above them is the stretch to take
  apart, and below them what just happened and what can be done next.
- `Parts.dc.html` says what the four parts are, what each is measured from, and
  why they add back up to the recording. It is the part of the design that is
  not visible on the screen itself.
- `canvas.json` places the two on the canvas.

Colours, type sizes, radii and control heights are taken from
`src/styles/tokens.css` and `src/styles/separate.css` rather than approximated,
and the class names are the ones the app uses, so a board and the element it
draws can be compared by name.

## What the boards are showing

The screen is laid out as a mixer, which is what the job is: somebody taking a
beat apart is listening to one part against the others. So every row carries a
mute, a solo and a way to hear it on its own, and the row is the whole width of
the screen because the waveform is the thing being read.

A part opened out of another sits in from its parent, and the indent is padding
rather than a margin: the buttons are at the right-hand end of every row, and a
margin would step those in too, so the columns of a list with a part open would
no longer line up.

The tools down the left are drawn dimmed. They belong to the timeline and there
is no timeline on this screen, so they are out of reach rather than gone. A
strip that changes length when you change screen makes the whole window shift.

What is deliberately not here is a timeline, a playhead or any editing. This
screen ends when the parts go to the piece, and the piece is where all of that
already lives.

Two things on the board are less obvious than they look. The stretch to take
apart sits under the parts rather than in front of them, because dropping a file
in and getting the parts back is what the screen is for — the stretch is the
second question, asked once there is a length to choose from. And a part's name
is a box you can type in, drawn here at rest, where it has no border and looks
like the label it replaced: the measurements can say a line is bright and steady
between G4 and D5, and only the person listening can say it is a viola.
