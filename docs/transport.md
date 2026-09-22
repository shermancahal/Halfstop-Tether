# How the app talks to the camera

**Decision: raw PTP, spoken directly, over USB-C and Wi-Fi, on iOS and Android.**

Not because raw is purer. Because scoping the app to two mobile platforms
removes every other option, and it happens that the constraint also produces the
better architecture.

---

## The four candidates, and how three of them died

**libgphoto2** — LGPL, cross-platform, twenty years of device coverage, this
camera in its supported list. It needs raw USB through libusb, and an iOS app
cannot open a USB device that way. Dead on iOS.

**CascableCore** — commercial, 200-odd bodies, proven against this exact camera,
viewfinder streaming included. iOS, macOS and visionOS only. Dead on Android.

**Nikon's SDK** — registration-gated, desktop-oriented, one manufacturer. Dead
on both.

**Raw PTP** — survives, and turns out to be the only thing that does.

There is no cross-platform mobile option that is not writing the protocol. That
is worth stating plainly, because it means the effort below is not a preference
to be revisited later. It is the price of the platforms.

---

## What "raw PTP" is, layer by layer

libgphoto2 is itself a raw PTP implementation with three things stacked on it,
and it is worth being precise about which of them are actually being given up.
Measured against its source:

**The plumbing — about a thousand lines.** PTP/IP is TCP port 15740, two
sockets, one for commands and one for events, opened with a short handshake that
carries a GUID and a friendly name. USB is bulk transfers with a container
header. This layer is well specified, finite, and testable against the one
camera on the desk. Writing it is a known quantity.

**The quirk knowledge — about twenty thousand lines, with some fourteen hundred
Nikon-specific references.** This is the expensive part and it is not plumbing.
It is *this body claims an opcode it does not implement*, and *poll DeviceReady
here or the next command disappears*, and *this property lies about its type*.
Most of it concerns cameras we will never touch. The Nikon share of it concerns
ours.

**The abstraction — the config tree.** gphoto2 flattens PTP's typed model into
labelled strings: `1/250`, `f/4`. Convenient for a command line, and wrong for
this app, because the design rests on precisely what the flattening discards —
raw property codes, whether a property is an enumeration or a range, the real
numerator and denominator, and the detail in an event. Reaching around that
abstraction to recover them would cost more than not having it.

So the trade is: write the small layer, borrow the large one, skip the one that
would have been in the way.

**Borrow, meaning read.** libgphoto2's source is the best public documentation
of Nikon's PTP behaviour in existence — Nikon publishes none of this. Learn the
protocol from `ptp.c` and `library.c`; do not copy code out of them. Protocol
facts are not copyrightable and reimplementing from a reading is ordinary
practice, which also keeps the licence question from ever arising.

---

## The boundary is a transaction, not a byte stream

This is the part that decides whether the code is portable, and it is easy to
get wrong by assuming every platform hands you bytes.

**Android hands you bytes.** `UsbManager` and `UsbDeviceConnection.bulkTransfer`
give raw endpoint access after the user grants permission for the device. The
app frames its own PTP containers and owns transaction IDs.

**iOS does not.** There is no libusb, no DriverKit on iPhone, and no MFi path a
camera would satisfy. What there is instead is ImageCaptureCore:
`ICCameraDevice.requestSendPTPCommand(_:outData:completion:)` takes a command
and returns a response, with Apple doing the framing and the transaction IDs.
It is gated on the device advertising `cameraDeviceCanAcceptPTPCommands`, which
every PTP camera does, and it needs `NSCameraUsageDescription` in the plist. No
special entitlement. This is how the one app already doing USB camera control on
iOS does it.

**Wi-Fi hands both platforms bytes,** because PTP/IP is a plain TCP socket and
neither platform restricts that.

**A browser hands you bytes too, and that turned out to matter.** WebUSB may
claim any interface whose class is not on its protected list — audio, video,
HID, mass storage, smart card, hubs, wireless. Still imaging, class 0x06, is
not on it, so a web page can drive a camera. Not on iOS, where Safari has no
WebUSB and every browser is Safari underneath; but Chrome and Edge on the
desktop, and Chrome on Android, which is one of the two shipping targets.

That makes the browser a fourth shim under the same boundary. `www/index.html`
is that harness, and it works — on Android and on Linux.

**It does not work on macOS, and the reason is worth recording.** Chrome there
reports `Failed to claim interface: Access denied (insufficient permissions)`
on a device it can see perfectly: interface 0, class 0x06, with the bulk in,
bulk out and interrupt in endpoints PTP needs, claimed by nobody. Killing every
system camera daemon does not change it. gphoto2 succeeds against the same
camera because libusb opens with `USBDeviceOpenSeize`, which takes the device
from whatever holds it; Chrome opens without seizing and macOS refuses.

Four rounds went into blaming `ptpcamerad` before the browser was asked what it
actually said. The lesson is the one this file already argued for iOS and turns
out to hold for the whole platform: **on Apple's systems you go through
ImageCaptureCore rather than around it.** WebUSB stays the desktop and Android
surface; macOS gets the same native path as iOS.

So the transport layer cannot be *write bytes*. The line has to be drawn one
level higher, at the transaction:

    { opcode, params[], dataOut? }  ->  { responseCode, params[], dataIn? }

Above that line sits everything worth writing — the property model, the
descriptor cache, the event loop, the mirroring rules, the solvers — shared and
platform-agnostic. Below it sit three small shims: Android USB, iOS
ImageCaptureCore, and a TCP socket that serves both. Draw the line at the byte
stream instead and the iOS shim has nowhere to live.

**A lucky consequence.** Nikon's event mechanism, `GetEvent` (0x90C7), is a
vendor *command* rather than an interrupt endpoint. It is an ordinary
transaction, so it works identically above the line on both platforms. Had
Nikon used the standard PTP interrupt endpoint, iOS would have had no way to
reach it and the event half of the design would have been Android-only.

---

## The stack

**Capacitor**, with a native PTP transport plugin on each side.

The reasoning is the same reasoning that makes this app worth building at all.
The differentiator is the planning layer, that layer is Halfstop's `sky.js`, and
`sky.js` is JavaScript. Capacitor reuses it verbatim rather than porting it to
Dart or Rust and maintaining two copies of the astronomy. Halfstop is already
headed to Capacitor for its own iOS and Android build, so it is one toolchain
across both products rather than two.

The plumbing has to be native on both platforms under any choice, so no stack
avoids writing the shims. What varies is what happens to everything above them.

**The risk this carries, named up front:** live view is a stream of JPEG frames
at some rate the probe will establish, and pushing them through the Capacitor
bridge is the plausible bottleneck. It should be measured with a spike before
anything is built on top of it, and the fallback is rendering the viewfinder in
a native view with only control flowing through the bridge.

---

## Verify early, because each of these can invalidate a plan

**`PTPNotAuthorizedToSendCommand`, error −21249.** iOS is documented to refuse
PTP commands under conditions Apple does not fully describe, and there is a
long-standing radar about it. Whether the Z5 hits it is not knowable from here.
This is the first thing to test on device, because a "no" reshapes the iOS half
of the product.

**The Wi-Fi handshake.** Control over Wi-Fi reaches Nikon bodies through
SnapBridge's Wi-Fi Mode — the path a phone takes, not the Connect to PC path a
computer takes. The Bluetooth step that wakes the radio is undocumented and is
the piece most likely to need packet capture.

**Live view frame rate and size,** which the probe reports and which decides
whether the bridge is viable.

---

## What gphoto2 is still for

Not a dependency. An instrument.

`gphoto2 --debug` prints the wire traffic of a session that *works*, against the
exact camera being targeted. When a hand-written implementation fails, the
expensive question is whether the packet was malformed or the camera was being
strange, and a known-good trace to diff against answers it directly. That is the
single most useful debugging asset available for this kind of work, and it is
why `tools/probe.mjs` shells out to gphoto2 rather than implementing anything.

## ImageCaptureCore indexes the card before it will pass a command

Measured, not assumed: two GetDeviceInfo commands sent fifteen seconds apart
both completed in the same instant, fifty seconds after the session opened,
immediately after `deviceDidBecomeReady`. ImageCaptureCore queues PTP until it
has finished cataloguing the storage, and says nothing about doing so.

This is the one failure mode that looks exactly like a broken camera, and it
cost four wrong diagnoses — sleep, transaction framing, a leaked session, and
sleep again. Three different fixed timeouts (30s, 8s, 15s) all expired on a
connection that was working and about to answer.

Two consequences for anything built on this transport:

- **A deadline on the clock cannot tell a slow start from a dead one.** The
  timeout measures silence instead: any word from the native side resets it,
  so progress keeps a request alive indefinitely while true silence still
  ends it.
- **The heartbeat has to beat even when nothing changes.** The first attempt
  at this reported progress only when the percentage moved, to keep the log
  readable. `contentCatalogPercentCompleted` stayed at 0 for the entire fifty
  seconds, so it spoke once and the timeout tripped anyway. Collapsing repeats
  in the log and collapsing them on the wire are different things: the page
  keeps only the last progress line, but every repeat reaches the timer.
- **The wait has to be visible.** `contentCatalogPercentCompleted` is reported
  every second while it runs. A wait with a number on it is a different
  experience from a wait with nothing.

The cost scales with what is on the card, and it is paid once per app launch
rather than once per connect. An empty card is close to instant.
