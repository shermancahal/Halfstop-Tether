# The Apple side

macOS and iOS reach a camera through the same door: ImageCaptureCore, and
`ICCameraDevice.requestSendPTPCommand`. Not a convenience — the only door.
WebUSB is refused outright on macOS (`Access denied (insufficient
permissions)` on a device nothing holds), and iOS has no WebUSB at all.

Which makes this the production path rather than a detour, and worth testing
before an app exists around it.

## Run the probe

Needs the Xcode command line tools. **No developer account, no signing, no
provisioning profile.**

```bash
xcode-select --install          # once, if you have not
cd ~/Documents/Claude/Halfstop-Tether/apple
swiftc -O TetherProbe.swift -o tether-probe
./tether-probe
```

Plug the camera in and switch it on. The first run may ask permission to
control it; allow that.

## What it is asking

**Does `requestSendPTPCommand` work at all on this body**, or does it come back
`-21249 PTPNotAuthorizedToSendCommand`? That error has been the one open
unknown in `docs/transport.md` since the transport was chosen, and it is the
only thing that could still reshape the iOS half of the product. Nothing on the
desktop could answer it, because the desktop was using libusb.

**What shape the reply takes.** Whether the bytes coming back are the raw PTP
data payload — in which case `src/ptp/codec.mjs` parses them unchanged and the
whole engine ports over — or something Apple wraps first. The probe decodes
GetDeviceInfo itself and prints the manufacturer, model and firmware: if that
reads as your camera, the payload is raw PTP and the answer is the good one.

**Whether the descriptor survives.** It then asks for ExposureProgramMode and
FNumber, which are the two the mirroring design leans on hardest — the mode
dial the app must never pretend to set, and an aperture whose writability moves
with it.

Send the whole output back. Every line of it is a finding, including the errors.
