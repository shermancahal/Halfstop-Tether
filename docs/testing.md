# Testing

Every change that needs a device should arrive with the commands to put it on
one. This page is the standing version of those commands; anything unusual will
come with its own.

---

## First time on a new Mac

Clones live in `~/Documents/Claude/<repo>`. Every command on this page assumes it.

```bash
mkdir -p ~/Documents/Claude && cd ~/Documents/Claude
git clone git@github.com:shermancahal/Halfstop-Tether.git
cd Halfstop-Tether
npm install
npm run ios:add          # creates ios/, once per machine
npm run doctor           # says what Xcode or CocoaPods is missing
```

`ios/` and `android/` are generated and deliberately not committed — they are
large, mostly machine-written, and rebuilt from `capacitor.config.json` and
`www/` by the command above.

## Every time after that

```bash
npm run ios              # sync, then open Xcode at the right project
```

Then **⌘R** in Xcode with a device selected. `npm run ios` is `cap sync ios`
followed by `cap open ios`: sync copies `www/` into the native project and
installs any plugin that changed, open launches Xcode on the workspace.

For Android, same shape:

```bash
npm run android:add      # once per machine
npm run android          # sync, then open Android Studio
```

## Without a device

```bash
npm test                 # the parsing and solver suites
npm run probe            # needs a camera on USB and gphoto2 on the PATH
```

---

## The camera probe

The one test that matters most right now, and it does not need Xcode:

It needs no `npm install` — the probe imports nothing but Node's own built-ins.

```bash
cd ~/Documents/Claude/Halfstop-Tether
brew install gphoto2     # the only install
npm run probe
```

Plug the Z5 in first, and turn it on. The probe walks you through a mode-dial
sweep and a dial-turn event test, then writes `probe-output/<timestamp>/` with
`REPORT.md`, `report.json` and the raw dumps. Send the first two back.

If nothing is detected on macOS, the system has grabbed the camera first:

```bash
killall PTPCamera
```

---

## Why there is no simulator step

The Simulator has no USB stack and no camera, so it can run the interface and
nothing behind it. Anything touching the transport needs a real phone with a
real cable. Interface work can be done in a browser against fixtures, which is
faster than either:

```bash
npx serve www            # or any static server
```

---

## The browser harness

The only surface that needs nothing from Apple. WebUSB works in Chrome and Edge
on desktop and on Android; Safari has none, so it will not work there or on any
iOS browser.

```bash
sudo launchctl disable system/com.apple.ptpcamerad
sudo killall ptpcamerad
npm run web
```

Then open <http://localhost:8099> in Chrome. WebUSB needs a secure context, and
localhost counts as one — which is why this works with no certificate.

Deployed, it lives at <https://tether.halfstop.app>. `npm run build` assembles
`dist/` and refuses to finish if a module the page imports is not in it.
