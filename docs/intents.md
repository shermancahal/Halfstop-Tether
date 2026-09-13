# Intents

An intent is what the photographer said they want. A plan is what the app solves
from it. This page is the catalogue of intents and, more importantly, the small
set of solvers underneath them — because the catalogue is not the product.

---

## Six solvers, not thirteen features

Written as thirteen separate features, this becomes a recipe book with extra
steps: thirteen tables of numbers, each going stale on its own schedule. Written
as solvers, an intent is a thin configuration and a new one costs almost nothing.

**Exposure.** The triangle, solved under constraints and a priority order. Given
any two of shutter, aperture and ISO plus a target brightness, produce the third;
given a scene, produce all of them against what the intent holds fixed.

**Motion.** How long the shutter may be open before something moves too far.
Subject speed, distance and direction; focal length; sensor pixel pitch; whether
stabilisation is doing any work. It answers both "how long can I hold this" and,
for water, "how long *should* I".

**Depth.** Hyperfocal distance, near and far limits, and the diffraction ceiling
beyond which stopping down costs more sharpness than it buys. On a 24 MP full
frame that ceiling sits around f/11, which is why "just use f/22" is bad advice.

**Sequence.** Frames, interval, total duration, and the three things that end a
run early: card space, battery, and an interval shorter than exposure plus write
time.

**Filters.** How many stops of neutral density stand between the exposure the
scene gives and the exposure the intent wants — and whether the photographer owns
that filter.

**Stability.** Tripod or hand, and the consequences: mirror-less shutter shock,
exposure delay, electronic first curtain, and stabilisation that helps in the
hand and hurts on a solid tripod.

Every intent below is a set of choices over those six. The domain knowledge lives
in the configuration; the arithmetic lives in one place and is tested once.

---

## The conversation

**One open question.** *What are you shooting?* Free text, because the answer
"the waterfall at the bottom of the trail before the light goes" carries subject,
timing and constraint in one sentence, and a menu of thirteen buttons does not.

**Then only what cannot be sensed.** The app already knows the body, the lens,
the focal length, the maximum aperture at that focal length, every current
setting, the card, the battery, where it is and what the sky will do. What is
left is want and taste: how silky, how long a clip, lit foreground or silhouette.
Two or three questions. Never twenty, and never one the camera could have
answered.

**Disambiguate with what is already known.** "Long exposure" is waterfall or star
trails depending on whether the sun is up, and the app knows which. Ask only when
the ambiguity survives the evidence.

**Say when the gear cannot do it.** Milky Way with an f/5.6 kit zoom has an
honest answer — higher ISO and stacking, and a real limit on how good it gets —
and a dishonest one, which is a plan that looks like every other plan and quietly
disappoints. The app gives the honest one, and says what would change it.

---

## Waterfalls and flowing water

The look is the input. Water speed decides what each shutter speed buys, so the
app asks what the photographer wants the water to look like, not how many seconds
to leave it open.

- **1/4 to 1/2 second** — strands stay separate, texture survives.
- **1 to 2 seconds** — silk with structure still in it.
- **4 seconds and beyond** — smooth fog, detail gone. On a big slow fall this is
  where it wants to be; on a small fast chute it is already too much by a second.

**What it solves.** Base ISO 100 for cleanliness, aperture from the depth solver
rather than reflex — f/8 to f/11 for a scene with foreground, wider if the fall is
the whole subject and diffraction is the greater risk. Shutter then falls out of
the look, and the filter solver closes the gap.

**The output other apps never give.** On an overcast day at ISO 100 and f/11 the
scene meters near 1/30 second. Two seconds is six stops away, so the plan reads
*six-stop ND* — and in bright sun the same target is nine or ten stops away, which
is a different filter and worth knowing before the hike rather than at the rail. A
polarizer for wet-rock glare costs about a stop and a half and is counted in.

**Warnings it raises.** Stabilisation off on a solid tripod, where it can
introduce the blur it exists to prevent, and restored afterwards. Exposure delay
or electronic first curtain against shutter shock. Highlight warning on white
water, which clips earlier than anything else in the frame and cannot be
recovered.

**What the sky layer adds.** Overcast is the good light here and direct sun is
the enemy, so the app can say that the falls face east and will be in hard sun
until eleven, which is a scheduling answer to a settings question — and the right
answer.

---

## The Milky Way

**What it solves, in order.** Longest exposure before stars trail, from the NPF
limit rather than the 500 rule: at 20 mm and f/1.8 on this body the answer is
about twelve seconds, where 500/20 would have said twenty-five. The 500 rule was
written for film and visibly trails on 24 megapixels. Then aperture wide open, or
a stop down where the lens profile says wide open is soft enough to matter. Then
ISO, solved from the exposure equation against how dark the site actually is —
which a map app can know.

**It answers the schedule question first,** because tonight may be the wrong
night and no exposure triangle fixes that. Halfstop's `sky.js` gives the window
where the core is up and the sun is far enough down, the moonless sub-window
inside it, a quality score against cloud cover, and the best nights in the next
thirty. *Tonight is poor; Thursday is clean from 22:10.*

**What it asks.** Lit foreground or silhouette. Single frame or a stack for
noise. That is all.

**Warnings it raises.** Long-exposure noise reduction doubles every frame and
should usually be off for a stack — and the app can turn it off. Autofocus will
not find a star; it offers to drive manual focus to infinity and confirm on a
magnified live view, if live view proves to exist on this body.

---

## The rest of the catalogue

Each is the same shape — inputs sensed, one or two asked, numbers derived — so
they are stated compactly.

**Star trails.** The inverse of the Milky Way. Arc length comes from total
duration; gaps between frames become dashes in the trail, so the interval is
pushed to the minimum the write speed allows. Polaris azimuth for a circular
composition. Frames, card and battery from the sequence solver, because two hours
of thirty-second frames is 240 files and a flat battery if nobody checked.

**Timelapse.** Arithmetic, mostly: a twenty-second clip at 30 fps is 600 frames,
and 600 frames across a two-hour sunset is a twelve-second interval — checked
against exposure plus write time, card space, and battery. Crossing sunset makes
it a holy grail, and because `sky.js` knows when the light will go, the ramp can
be planned rather than chased.

**Aurora.** Faster than people expect. Active curtains move visibly in seconds,
so the exposure that captures structure is one to eight seconds rather than the
twenty that turns it into green fog. `aurora.js` supplies the activity input.

**Wildlife and birds in flight.** Shutter from the motion solver — perched is not
flight, and flight is not a raptor stooping — with auto-ISO under a minimum
shutter, continuous AF and subject detection. Honest limit: this body runs about
4.5 frames a second, which is a real constraint and gets said rather than
discovered.

**Handheld low light.** The reciprocal rule with five stops of in-body
stabilisation credited against it, and a question about how much noise is
acceptable, which is taste and cannot be sensed.

**Focus stacking.** The body has focus shift shooting built in. Step size comes
from focal length, aperture and magnification against the circle of confusion;
the app computes the step and the frame count instead of asking someone to guess.

**Golden hour and portraits.** Aperture wide for separation, and the window and
sun azimuth from the sky layer, so *the light will come from behind her at 18:40*
is a thing the app can say.

**Eclipse.** `eclipse.js` has the contact times. Partial phases and totality are
about ten stops apart, so this is a bracket-and-sequence problem with a hard
safety rule attached: a solar filter for everything except totality itself.

**Panning, storms, interiors.** Shutter matched to subject speed for panning;
repeated long frames for lightning, with the storm layer for timing; brackets and
a level horizon for interiors, where the body's own pitch and yaw readout is
worth surfacing.

---

## What this deliberately does not do

**No saved settings.** An intent can be saved and re-solved. Its numbers cannot
be saved, because a number that outlives the lens it was computed for is a recipe
wearing a disguise.

**No plan without provenance.** Every derived value carries the line that
produced it — *12s, NPF limit at 20mm f/1.8, 24MP full frame* — so it can be
argued with. A number nobody can interrogate is a number nobody should trust at
two in the morning.

**No pretending about the body.** Where an intent needs something the camera does
not expose or cannot do, the plan says so plainly instead of quietly producing
something worse.
