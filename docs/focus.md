# Focusing on a star

The infinity mark is not infinity, and this is the app's best single argument
for existing.

---

## Why the mark lies

**Z lenses are focus-by-wire.** The ring is a sensor, not a mechanism. There is
no hard stop that corresponds to infinity, and the same ring movement means
different things at different speeds.

**Lenses focus past infinity on purpose,** to allow for thermal expansion and
for infrared work. So the end of travel is not the answer, and neither is the
engraved mark, which is printed for a nominal temperature.

**Focus drifts as the lens cools.** A lens focused at dusk is not in focus at
midnight. On a two-hour sequence this ruins the second half of the night without
announcing itself.

Which is why the usual advice — dial it to the mark, or rack to the stop and
back off a hair — is a starting point and never the finish.

---

## What the camera gives us to work with

`MfDrive` (0x9204) takes a direction flag and a step count from 1 to 32767. Two
things about it decide the design:

**It only runs in live view.** libgphoto2 carries a dedicated error for calling
it otherwise, so focus control is not a separate feature from the viewfinder —
it is the same feature. If live view works on this body, so does this.

**Its steps are relative and unitless.** The same count moves a different
distance on different lenses and at different points in the travel. That is
fine for a search and useless for "go to infinity" as an absolute instruction.

Alongside it: `LiveViewImageZoomRatio` (0xD1A3) magnifies the live view, and
`SaveFocusPosition` (0xD0CD) may let a nailed focus be stored and recalled.

---

## Four steps, each useful without the next

**1. A number instead of an eyeball.** Magnify live view on a bright star,
compute a sharpness figure on every frame, and show it large with a trend arrow
and a mark for the best reading so far. The photographer still turns the ring;
the app only tells the truth about whether it is getting better. This needs
nothing but live view, so it is the floor — and it is already better than
squinting at a rear screen.

**2. Measure the right thing.** Ordinary contrast detection fails on a dim point
of light. Astronomy uses **half-flux diameter** — the radius of the circle
containing half the star's total light. It holds up at low signal, and it traces
a clean V against focus position, so the minimum can be fitted from a handful of
samples rather than hunted for.

**3. Sweep it automatically.** Drive `MfDrive` across a range, sample the
half-flux diameter at each stop, fit the V, then drive back to its minimum,
arriving from one direction so backlash is always taken up the same way. This is
what dedicated astronomy focusers do, and it beats any human with a loupe.

**4. Read a Bahtinov mask.** If there is one in the bag — they are cheap and
common — its diffraction spikes encode a *signed* error: not just how far off,
but which way. Reading the pattern from live view turns "does that look
symmetrical to you" into "three steps nearer".

---

## Then hold it

Getting focus is half the problem. **Re-check it during the run.** Every N
frames, or when the temperature has moved a degree, sample again and correct.
A star trail that goes soft at frame 300 is a wasted night, and nothing about it
is visible on a phone screen until the morning.

This is the same argument as the rest of the design: the plan lives in the app,
and the app keeps watching.

---

## What is not known yet

**Live view on this body** is the dependency under all of it. Cascable streams
the Z5's viewfinder, so the body serves it — but the frame is small and JPEG
compressed, and a star may land on two or three pixels. Half-flux diameter on
three noisy pixels is not a measurement.

Two ways around it, and the probe's live view figures decide which: magnify
first, so the star spans enough pixels to measure; or sample with real two-second
frames at high ISO instead of live view frames — far slower per sample, far more
accurate. The likely answer is both, coarse sweep on live view and the last
confirmation on a real frame.

**Whether `MfDrive` is supported here** the probe reports directly.

**`StarlightView`** (0x1D00E) exists in Nikon's vendor properties and would
brighten the view for composing in the dark, but it sits in the 0x1D0xx block,
which is the newer bodies' address space. Probably absent on a 2020 camera. The
probe will say rather than guess.
