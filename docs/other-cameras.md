# Testing against cameras nobody here owns

One Z5 on the desk, and a product that claims more. This is how that gap gets
closed without buying a shelf of bodies.

---

## What a fixture does not contain

A camera knows its owner's name — it is in the Artist field, written into every
photograph's metadata — along with its own serial number and whatever was typed
into the image comment. None of that is needed to plan a photograph.

So the probe removes it as it writes, not before publishing: anyone sending a
fixture should not have to know this. `src/camera/privacy.mjs` blanks the value
of any setting whose path or label names a serial, an artist, a copyright, a
comment or an owner, and leaves the property itself intact — its code, its type
and its writability still describe the camera completely.

`node tools/scrub.mjs <dir>` cleans a run captured before that was true, and a
test fails the build if anything committed still carries one.

---

## How to add a camera

Run the probe, turn its output into a fixture, drop the fixture in. No code.

```bash
npm run probe
node tools/make-fixture.mjs probe-output/<timestamp> fixtures/<make>-<model>.json
npm test
```

The suite discovers every file in `fixtures/` and runs the whole plan layer
against each one: that the body reports a mode where an intent's pins are
writable, that solved values are ones it will actually accept, that it is asked
for the dial when it is in a mode that will not allow the plan, and that every
number carries a reason. A camera joins the test suite by existing as a file.

---

## The probe is already most of the answer

`tools/probe.mjs` writes a machine-readable description of a camera's entire
surface: every setting, its legal values, whether it is writable, how that
changes as the mode dial moves, whether live view exists and at what size,
whether manual focus drive is there. That is not a diagnostic. **That is a test
fixture**, and it was produced by someone with a camera in about three minutes.

So the ask on a stranger with a Z7 is: run one command, send back one file.
Their camera then has a permanent seat in the test suite, running in CI on every
commit, on a machine that has never seen it. This is roughly how libgphoto2
accumulated two decades of device coverage, and it works because the expensive
part — having the camera — is separated from the repeatable part.

---

## Four layers, and only one of them needs hardware

**The solvers** (`src/photo/`) never touch a camera. The NPF limit does not care
what took the photograph. Tested already, no fixtures required.

**The plan layer** (`src/plan/`) needs a *description* of a camera, not a
camera. It already works this way: `modesThatAllow` takes the writability map
the body reports and derives which exposure modes allow an intent, so a fixture
from a body with different rules produces a different answer from the same code.
A test asserts precisely that, using an invented map no Nikon has.

**The PTP engine** needs recorded conversations rather than a live one.
`gphoto2 --debug` prints the wire traffic of a session that worked, against a
real body; captured, that becomes a transcript to replay. The engine is fed
recorded responses and its bytes are compared against the ones that are known to
have been accepted. No camera present.

**The transport shims** — Android USB, iOS ImageCaptureCore, the TCP socket —
genuinely need hardware. But there are three of them, they are small, and
crucially they do not vary per camera model. One Nikon and one Canon exercise a
shim as well as thirty bodies would.

That is the payoff from drawing the portability line at the transaction rather
than the byte stream: everything above it is testable from a file.

---

## What actually differs between cameras

Worth being precise, because it decides what a fixture has to capture.

**The vendor dialect is the big one.** Nikon's ~70 vendor operations are not
Canon's, and Canon's EOS protocol is close to a different protocol wearing PTP's
clothes. Sony and Fujifilm differ again. "Supporting all cameras" is really
supporting N dialects, and the first body of a new brand is a genuine
investment while the second is nearly free. That is the argument for finishing
Nikon properly before starting anyone else.

**Within a dialect, what varies** is which properties exist, which are writable
in which modes, the legal value lists, whether live view exists and its size,
what the event stream volunteers, and the quirks — operations a body claims in
its device info and does not actually implement.

**What does not vary** is the standard PTP core, and every line of the
photographic arithmetic.

---

## Getting fixtures

**Ask for them.** A "does it work with my camera?" question is a fixture
request in disguise: one command, one file, and the answer becomes permanent.

**Rent the first of each brand.** Rental houses charge little for a day, and the
first Canon buys the whole Canon dialect. Camera clubs and friends cover the
long tail of bodies within a brand.

**Read libgphoto2 for what to expect.** Its source encodes which models support
which operations. Not a substitute for a fixture, but it says where to look and
what quirk to expect before anyone has run anything.

---

## Do not claim what has not been tested

Three tiers, and the app should say which one the connected body is in:

- **Verified** — a fixture exists and the app has been run against the body.
- **Expected** — same dialect, same generation, nobody has tried it.
- **Unknown** — never seen. Connect anyway; the app discovers the surface at
  runtime through `GetVendorPropCodes` and offers what is actually there.

The third tier is not a failure state. The design already discovers rather than
assumes, so an unknown body should mostly work — it simply has not earned the
right to be advertised.
