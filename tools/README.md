# Tools

Small pages used while working on the project. They are not part of the built
site and are only served by the development server.

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
