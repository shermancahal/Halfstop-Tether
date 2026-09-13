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

`docs/camera-control.md` is the design, including the parts that are still
unknown until the camera is on the desk. `docs/intents.md` is the catalogue of
things a photographer might ask for, and the six solvers underneath them that
keep it from becoming a recipe book.

---

## Status

Design only. Nothing runs yet.

The next step is a probe: connect the Z5 and record what the body actually
exposes, because the published sources disagree with each other and with Nikon's
own software about what this camera can do.

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
