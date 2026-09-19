# Halfstop Tether

Tether to a camera and control it by saying what you want to shoot.

A Nikon Z5 first, over USB or Wi-Fi. Two ideas decide the shape of it:

**The camera is the source of truth.** Every physical dial, switch and button on
the body is reflected in the app within a fraction of a second, and the app never
shows a value the camera has not confirmed. A camera app that disagrees with the
camera is worse than no app.

**Ask what the photographer wants, not what the camera should be set to.** Say
"I want to shoot the Milky Way over the lake tonight" and the app works out the
settings from the lens actually mounted, the sky at that place and hour, and the
light that will be there — then tells you tonight is the wrong night and Thursday
is not. It does not store recipes.

An iOS and Android app, for phones and tablets with a USB-C port, talking to the
camera over that cable or over Wi-Fi.

`docs/camera-control.md` is the design, including the parts that are still
unknown until the camera is on the desk. `docs/intents.md` is the catalogue of
things a photographer might ask for, and the six solvers underneath them that
keep it from becoming a recipe book. `docs/transport.md` is how it reaches the
camera, and why two mobile platforms leave exactly one way to do that.
`docs/focus.md` is about focusing on a star, which is the app's best single
argument for existing.

---

## Status

Design, a probe that has been run, and the solvers. No app yet.

`src/photo/` is the arithmetic every plan comes out of — the exposure triangle
solved under whatever an intent holds fixed, the NPF limit, hyperfocal and the
diffraction ceiling, the neutral density a target shutter needs, whether a
sequence will survive its card and its battery, and what to switch off so the
camera holds still. Pure functions, no camera, no network, no model, 55 tests.

The solver deliberately refuses to balance an exposure when all three corners
are pinned. A waterfall wanting two seconds at f/11 and base ISO has no
solution, and inventing one would quietly drop something the photographer
asked for — so it reports the gap, and the caller decides what closes it.

```bash
npm test
```

`tools/probe.mjs` asks the camera what it can do, because the published sources
disagree with each other and with Nikon's own software. Plug the Z5 in and run:

```bash
npm run probe        # needs gphoto2 on the PATH
npm test             # the parsing, without a camera
```

It reads every setting and times how long that takes, tests live view and
measures its size and frame rate, sweeps the mode dial to find which settings
change writability and legal values with camera state, listens for whether a
hand-turned dial produces an event at all, and times a write round trip. It
changes nothing it does not put back and never touches the card.

## Prior art, and what this is for

[Cascable](https://cascable.se) already controls this camera over Wi-Fi and USB,
including the viewfinder stream, and it is good. It is worth being clear-eyed
about that: the control surface is solved, by them and in part by libgphoto2,
and rebuilding it is not the point.

What nothing does is the layer above it — answering "I want to shoot the Milky
Way over the lake tonight" with the right night, the right window, and numbers
derived from the lens actually mounted. That needs a camera connection and an
astronomy engine in the same program, which is a strange combination to have
lying around and is exactly what Halfstop leaves within reach.

## Its relationship to Halfstop

[Halfstop](https://github.com/shermancahal/Halfstop) is a separate app — a
back-roads atlas and trip planner. This is not part of it and does not ship with
it.

It does borrow from it. Halfstop's `assets/js/lib/sky.js` already computes sun
and moon position and times, twilight phases, moon illumination, the galactic
centre, the shootable Milky Way window for a night and the moonless sub-window
inside it, a quality score against cloud cover, and the best nights in the next
thirty. That is precisely the scene-fact layer an intent-driven camera app needs,
and `aurora.js` and `eclipse.js` cover more of the same ground.

The intended arrangement is that those modules become a shared dependency both
apps consume, rather than being copied into this one and left to drift. Until
that extraction happens this repository treats them as a planned import, not a
vendored copy.
