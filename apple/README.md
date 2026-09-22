# The Apple side

macOS and iOS reach a camera through the same door: ImageCaptureCore, and
`ICCameraDevice.requestSendPTPCommand`. Not a convenience — the only door.
WebUSB is refused outright on macOS (`Access denied (insufficient
permissions)` on a device nothing holds), and iOS has no WebUSB at all.

Which makes this the production path rather than a detour, and worth testing
before an app exists around it.

---

## What a paid account is actually for

Very little of what is left here. Worth being precise, because "waiting on
enrolment" sounds like a blocker and mostly is not.

**Free, no Apple ID at all:**

- Building and running a macOS command line tool or app on your own Mac.
  Xcode signs it to run locally. This is everything the probe needs.

**Free, with any Apple ID signed into Xcode — a "Personal Team":**

- Running an app on your own iPhone or iPad over the cable. The provisioning
  profile expires after seven days and you re-run to renew it, and a device
  holds at most three such apps. Annoying; not a wall.
- The iOS Simulator, which needs no signing — though it has no USB stack, so
  the camera half cannot be exercised there. A simulator proves the interface,
  never the transport.

**Only with the paid programme:**

- TestFlight and the App Store.
- Profiles that outlive a week.
- Entitlements this app does not appear to need. ImageCaptureCore asks for
  `NSCameraUsageDescription` in the plist and no entitlement, which is the
  single assumption worth confirming on the first device build.

So the enrolment gates shipping, not building. Everything between here and a
working app on your own phone can be done today.

---

## Open it in Xcode

```bash
cd ~/Documents/Claude/Halfstop-Tether/apple
open Package.swift
```

Xcode opens the package as a project. Press Run. No `.xcodeproj` to
maintain, and Swift Package Manager is what Xcode uses natively.

## Or stay at the command line

```bash
cd ~/Documents/Claude/Halfstop-Tether/apple
swift run tether-probe
```

Or the plain compiler, which is fastest for a one-file fix-and-retry loop:

```bash
swiftc -O Sources/TetherProbe/main.swift -o tether-probe && ./tether-probe
```

Plug the camera in and switch it on first. The first run may ask permission to
control it; allow that.

---

## What the probe is asking

**Does `requestSendPTPCommand` work at all on this body**, or does it come back
`-21249 PTPNotAuthorizedToSendCommand`? That has been the one open unknown in
`docs/transport.md` since the transport was chosen, and the only thing that
could still reshape the iOS half. Nothing on the desktop could answer it,
because the desktop was using libusb.

**What shape the reply takes.** Whether the bytes coming back are the raw PTP
payload — in which case `src/ptp/codec.mjs` parses them unchanged and the whole
engine ports over — or something Apple wraps first. The probe decodes
GetDeviceInfo itself and prints the manufacturer, model and firmware: if that
reads as your camera, the payload is raw PTP and the answer is the good one.

**Whether the descriptor survives.** It then asks for ExposureProgramMode and
FNumber, the two the mirroring design leans on hardest — the mode dial the app
must never pretend to set, and an aperture whose writability moves with it.

**What arrives unprompted.** `ICCameraDeviceDelegate` requires
`didReceivePTPEvent`, so Apple hands over raw PTP events rather than only the
file-level notifications its own API deals in. Turn a dial while the probe is
running: any `[event]` line is the mirroring design's notification channel,
present on a platform where we had no idea whether we would get one.

Send the whole output back. Every line is a finding, errors included.
