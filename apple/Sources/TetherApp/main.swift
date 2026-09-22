//
//  TetherApp — the interface, in a window, talking to a real camera.
//
//  The web page is the app. This is the shell Apple requires around it and the
//  one thing a browser cannot do on this platform: reach the camera. Swift
//  here knows no PTP at all — it passes bytes to requestSendPTPCommand and
//  hands back what comes out, so the codec stays in one language and this file
//  stays small enough to be obviously right.
//
//  Run it:
//
//      cd apple && swift run TetherApp
//
//  Or open Package.swift in Xcode and pick the TetherApp scheme. Neither needs
//  a developer account.
//
//  It loads https://tether.halfstop.app by default. To point it at a local
//  dev server instead:
//
//      npm run web                       # in another terminal
//      TETHER_URL=http://localhost:8099 swift run TetherApp
//

import AppKit
import WebKit
import ImageCaptureCore

// MARK: - The camera, as a pipe

final class CameraBridge: NSObject, ICDeviceBrowserDelegate, ICCameraDeviceDelegate {
    private let browser = ICDeviceBrowser()
    private var camera: ICCameraDevice?
    private var sessionOpen = false
    private var waitingForSession: ((Bool, String?) -> Void)?
    /* An open that arrived while a close was still in flight. */
    private var pendingOpen: ((Bool, String?) -> Void)?
    private var closing = false
    /*
     * ImageCaptureCore opens a session and then goes away to index the card.
     * Commands sent before it has finished are the leading suspect for the
     * silence, so they wait here — briefly, and audibly.
     */
    private var ready = false
    private var indexingTimer: Timer?

    /// Called with base64 event data whenever the camera volunteers one.
    var onEvent: ((String) -> Void)?
    var onStatus: ((String) -> Void)?

    func start() {
        browser.delegate = self
        browser.browsedDeviceTypeMask = ICDeviceTypeMask(
            rawValue: ICDeviceTypeMask.camera.rawValue | ICDeviceLocationTypeMask.local.rawValue)!
        browser.start()
    }

    func openSession(_ done: @escaping (Bool, String?) -> Void) {
        guard let camera else { done(false, "No camera found. Plug one in and switch it on."); return }
        if sessionOpen || camera.hasOpenSession { sessionOpen = true; done(true, nil); return }

        /*
         * Opening while a close is still in flight is how a reconnect ends up
         * talking to a session that is on its way out. Wait for the close to
         * land; `didCloseSessionWithError` picks this up.
         */
        if closing { pendingOpen = done; return }
        if waitingForSession != nil { done(false, "A session is already being opened."); return }
        waitingForSession = done
        camera.requestOpenSession()
    }

    /*
     * Always hand the session back.
     *
     * The probe has carried this warning since the first run and the app did
     * not act on it: leaving one open makes the camera refuse the next program
     * that asks, and the cure a person finds is switching the body off and on.
     * Closing the window used to leak one every time.
     */
    func closeSession() {
        guard sessionOpen || camera?.hasOpenSession == true else { return }
        closing = true
        sessionOpen = false
        camera?.requestCloseSession()
        /* If the close is never acknowledged, do not wedge the next open. */
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self, self.closing else { return }
            self.closing = false
            if let pending = self.pendingOpen { self.pendingOpen = nil; self.openSession(pending) }
        }
    }

    /// Hand the session back, and stay alive long enough for that to land.
    func stop() {
        guard sessionOpen || camera?.hasOpenSession == true else { browser.stop(); return }
        closeSession()
        /*
         * requestCloseSession is asynchronous and the process is about to end.
         * Posting it and returning throws the request away with the run loop,
         * which looks exactly like closing it properly and is not. Wait for the
         * acknowledgement, briefly, rather than trust it.
         */
        let deadline = Date().addingTimeInterval(1.5)
        while closing, Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        browser.stop()
    }

    /// The whole of this bridge: bytes in, bytes out, no interpretation.
    func transact(command: Data, outData: Data?, done: @escaping (Data?, Data?, String?) -> Void) {
        guard let camera, sessionOpen else { done(nil, nil, "No session is open."); return }
        /*
         * The completion hands back (payload, responseContainer, error).
         *
         * Read off the probe rather than the documentation: the parameter that
         * decoded as twelve bytes of type 3, code 0x2001 was the SECOND one, and the
         * 519 bytes of DeviceInfo were the first. I called it the other way round
         * once and the runtime said "expected a response container, got type 65535" —
         * which is DeviceInfo's 0xffffffff vendor extension field being read as a
         * container header.
         */
        guard acceptsPTP(camera) else {
            done(nil, nil, "This camera is not advertising that it accepts PTP commands.")
            return
        }

        /*
         * Everything about one command, said out loud.
         *
         * Three guesses at the silence have now been wrong, so this stops
         * guessing: the opcode goes out with a label, and either a completion
         * arrives and says what it carried, or nothing does and the absence is
         * the finding. Both halves end up on screen.
         */
        /*
         * The opcode lives at bytes 6-7 of the container. Read it off a plain
         * array rather than indexing Data, whose indices are not guaranteed to
         * start at zero once it has been sliced.
         */
        let bytes = [UInt8](command)
        let opcode = bytes.count >= 8 ? Int(bytes[6]) | (Int(bytes[7]) << 8) : 0
        let label = String(format: "0x%04x", opcode)
        onStatus?("→ \(label), \(command.count) bytes, \(size(outData)) bytes out")

        /*
         * Sent straight away, because the wait is not ours to manage.
         *
         * ImageCaptureCore holds PTP commands until it has finished indexing
         * the card and does not tell you it is doing so. The log caught it:
         * two commands fifteen seconds apart both completed in the same
         * instant, fifty seconds in, immediately after "Device reports ready".
         * Gating our end changed nothing except when the "sent" line printed.
         */
        camera.requestSendPTPCommand(command, outData: outData) { [weak self] payload, response, error in
            if let error = error as NSError? {
                let hint = error.code == -21249 ? " (PTPNotAuthorizedToSendCommand)" : ""
                self?.onStatus?("← \(label) failed: \(error.localizedDescription)\(hint)")
                done(nil, nil, "\(error.localizedDescription)\(hint)")
            } else {
                self?.onStatus?("← \(label): \(self?.size(response) ?? 0) byte response, \(self?.size(payload) ?? 0) byte payload")
                done(response, payload, nil)
            }
        }
    }

    /*
     * How many bytes, whatever the SDK thinks.
     *
     * requestSendPTPCommand hands these back as Data here and as Data? on
     * other SDKs, and `x?.count` is an error for one while `x.count` is an
     * error for the other. A parameter typed Data? takes both, because a
     * non-optional promotes on the way in. One helper instead of a guess per
     * platform - this cost a build.
     */
    private func size(_ data: Data?) -> Int { data?.count ?? 0 }

    // MARK: Delegates

    func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        guard let found = device as? ICCameraDevice else { return }
        camera = found
        found.delegate = self
        ready = false
        onStatus?("Found \(found.name ?? "a camera") over \(found.transportType ?? "an unknown transport").")
        onStatus?("Capabilities: \(found.capabilities.map { "\($0)" }.joined(separator: ", "))")
        if !acceptsPTP(found) {
            onStatus?("This camera is NOT advertising that it accepts PTP commands. Nothing below will work.")
        }
    }

    private func acceptsPTP(_ camera: ICCameraDevice) -> Bool {
        camera.capabilities.contains { "\($0)".contains("PTP") }
    }

    /*
     * Say how the indexing is going, every second, until it is done.
     *
     * This is the whole of the mystery: nothing answers for the best part of a
     * minute and there was no way to tell that from a camera that had stopped
     * answering. Now the wait has a number on it and a cause attached.
     */
    private func reportIndexing() {
        indexingTimer?.invalidate()
        guard !ready else { return }
        var last = -1
        indexingTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] timer in
            guard let self, let camera = self.camera, !self.ready else { timer.invalidate(); return }
            let percent = camera.contentCatalogPercentCompleted
            if percent != last {
                last = percent
                self.onStatus?("macOS is indexing the card — \(percent)%. Nothing can be asked of the camera until it finishes.")
            }
        }
    }

    func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {
        if device === camera { camera = nil; sessionOpen = false; onStatus?("The camera went away.") }
    }

    func device(_ device: ICDevice, didOpenSessionWithError error: (any Error)?) {
        sessionOpen = error == nil
        onStatus?(error == nil ? "Session open." : "Session refused: \(error!.localizedDescription)")
        if error == nil { reportIndexing() }
        waitingForSession?(error == nil, error?.localizedDescription)
        waitingForSession = nil
    }

    /// Apple requires this, so the event stream comes free on this platform.
    func cameraDevice(_ camera: ICCameraDevice, didReceivePTPEvent eventData: Data) {
        onEvent?(eventData.base64EncodedString())
    }

    func didRemove(_ device: ICDevice) {}
    func cameraDevice(_ camera: ICCameraDevice, didAdd items: [ICCameraItem]) {}
    func cameraDevice(_ camera: ICCameraDevice, didRemove items: [ICCameraItem]) {}
    func cameraDevice(_ camera: ICCameraDevice, didRenameItems items: [ICCameraItem]) {}
    func cameraDeviceDidChangeCapability(_ camera: ICCameraDevice) {}
    func cameraDevice(_ camera: ICCameraDevice, didReceiveThumbnail thumbnail: CGImage?,
                      for item: ICCameraItem, error: (any Error)?) {}
    func cameraDevice(_ camera: ICCameraDevice, didReceiveMetadata metadata: [AnyHashable: Any]?,
                      for item: ICCameraItem, error: (any Error)?) {}
    func cameraDeviceDidEnableAccessRestriction(_ device: ICDevice) {}
    func cameraDeviceDidRemoveAccessRestriction(_ device: ICDevice) {}
    func deviceDidBecomeReady(_ device: ICDevice) {
        ready = true
        indexingTimer?.invalidate()
        onStatus?("Ready. Anything queued goes out now.")
    }

    func deviceDidBecomeReady(withCompleteContentCatalog device: ICCameraDevice) {
        ready = true
        indexingTimer?.invalidate()
        onStatus?("Card finished indexing.")
    }
    func device(_ device: ICDevice, didCloseSessionWithError error: (any Error)?) {
        sessionOpen = false
        closing = false
        if let pending = pendingOpen { pendingOpen = nil; openSession(pending) }
    }
}

// MARK: - The window

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let bridge = CameraBridge()
    private var address = ""
    private var waitingForServer = false
    static let build = ProcessInfo.processInfo.environment["TETHER_BUILD"] ?? "unstamped"

    func applicationDidFinishLaunching(_ notification: Notification) {
        let controller = WKUserContentController()
        controller.add(self, name: "ptp")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        // Must be set BEFORE the web view is built: the configuration is
        // copied at init, so assigning it afterwards changes nothing and the
        // page quietly comes from a cache. That cost a round trip.
        configuration.websiteDataStore = .nonPersistent()

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Halfstop Tether"
        window.center()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        bridge.onEvent = { [weak self] base64 in
            self?.call("window.__ptpEvent && window.__ptpEvent('\(base64)')")
        }
        bridge.onStatus = { [weak self] text in
            FileHandle.standardError.write(Data("\(text)\n".utf8))
            /* The terminal is not where the person is looking. */
            let escaped = text.replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
                .replacingOccurrences(of: "\n", with: " ")
            self?.call("window.__ptpStatus && window.__ptpStatus('\(escaped)')")
        }
        bridge.start()

        /*
         * Where the interface comes from. The deployed site by default, which
         * means a change here is not a change there until it ships — so say
         * plainly which one is loaded, in the title bar and on the way past.
         * For a fast loop, run `npm run web` and set TETHER_URL.
         */
        address = ProcessInfo.processInfo.environment["TETHER_URL"] ?? "https://tether.halfstop.app"
        let local = address.contains("localhost") || address.contains("127.0.0.1")
        /*
         * Which build is this. Rounds have now been spent on a fault that may
         * or may not have been in the binary being run, and neither of us
         * could tell from anything on screen. The launcher stamps it;
         * "unstamped" means it was started some other way.
         */
        window.title = "Halfstop Tether — \(local ? "local" : "deployed") · \(Self.build)"
        FileHandle.standardError.write(Data("App build \(Self.build)\nLoading \(address)\n".utf8))
        if !local {
            let hint = "This is the deployed site, not your working copy. For local changes:\n"
                + "  npm run web\n"
                + "  TETHER_URL=http://localhost:8099 swift run TetherApp\n"
            FileHandle.standardError.write(Data(hint.utf8))
        }

        load()
        NSApp.activate(ignoringOtherApps: true)
    }

    private func load() {
        guard let url = URL(string: address) else { return }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        webView.load(request)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /* The session outlives this process unless it is handed back here. */
    func applicationWillTerminate(_ notification: Notification) { bridge.stop() }

    // MARK: When the page will not load

    /*
     * A blank white window is the worst answer to give. Both failure hooks land
     * here: the page says which address it tried and what the system said about
     * it, and then a probe waits quietly for the address to start answering.
     * Start the server and the window fills itself in.
     */
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) { showFailure(error) }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!,
                 withError error: Error) { showFailure(error) }

    private func showFailure(_ error: Error) {
        let local = address.contains("localhost") || address.contains("127.0.0.1")
        let advice = local
            ? "The dev server is not answering. It needs a terminal of its own \u{2014} if you typed this one into its window, the ^C that gave you a prompt back took the server with it."
            : "Check the network, or point the app at a local copy instead."
        let commands = local
            ? "cd ~/Documents/Claude/Halfstop-Tether\nnpm run web"
            : "cd ~/Documents/Claude/Halfstop-Tether\nnpm run web\n\ncd apple\nTETHER_URL=http://localhost:8099 swift run TetherApp"

        let page = """
        <!doctype html><meta charset="utf-8">
        <style>
          :root { color-scheme: dark }
          body { margin:0; padding:56px 34px; background:#0f1115; color:#e7e9ee;
                 font:15px/1.65 -apple-system, system-ui, sans-serif }
          h1 { font-size:19px; margin:0 0 10px; font-weight:600 }
          p { color:#9aa1ad; margin:0 0 20px }
          .said { color:#e5a05a; font-size:13px }
          pre { background:#181c22; border:1px solid #272c35; border-radius:9px;
                padding:13px 15px; overflow-x:auto; color:#cfd5df; font-size:13px; margin:0 0 20px }
          button { font:inherit; font-size:14px; color:#0f1115; background:#7fb2ff; border:0;
                   border-radius:8px; padding:9px 16px; cursor:pointer }
        </style>
        <h1>Nothing is serving \(address)</h1>
        <p class="said">\(error.localizedDescription)</p>
        <p>\(advice)</p>
        <pre>\(commands)</pre>
        <p>Leave it running. This window is watching, and will load the moment it answers.</p>
        <button onclick="window.webkit.messageHandlers.ptp.postMessage({id:0,kind:'reload'})">Try now</button>
        """
        webView.loadHTMLString(page, baseURL: nil)
        waitForServer()
    }

    /*
     * Poll rather than reload, so the message on screen does not flicker. The
     * delay sits in front of every attempt, not only the failed ones: a probe
     * that somehow succeeds while the web view keeps failing would otherwise
     * spin between the two as fast as the machine allows.
     */
    private func waitForServer() {
        guard !waitingForServer, let url = URL(string: address) else { return }
        waitingForServer = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self else { return }
            var probe = URLRequest(url: url)
            probe.timeoutInterval = 2
            probe.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            URLSession.shared.dataTask(with: probe) { [weak self] _, response, error in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.waitingForServer = false
                    if error == nil, response != nil { self.load() } else { self.waitForServer() }
                }
            }.resume()
        }
    }

    // MARK: The bridge, from the page's side

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? Int,
              let kind = body["kind"] as? String else { return }

        switch kind {
        case "open":
            bridge.openSession { [weak self] ok, error in
                self?.reply(id, ok ? [:] : ["error": error ?? "Could not open a session."])
            }
        case "close":
            bridge.closeSession()
            reply(id, [:])
        case "reload":
            load()
        case "hello":
            /* The page announcing itself. Answer down the status channel too,
             * so the build lands in the log the person can actually see. */
            bridge.onStatus?("App build \(Self.build)")
            reply(id, ["build": Self.build])
        case "transact":
            guard let commandText = body["command"] as? String,
                  let command = Data(base64Encoded: commandText) else {
                reply(id, ["error": "The page sent a command that was not base64."])
                return
            }
            let outData = (body["outData"] as? String).flatMap { Data(base64Encoded: $0) }
            bridge.transact(command: command, outData: outData) { [weak self] response, payload, error in
                if let error { self?.reply(id, ["error": error]); return }
                /*
                 * Only the keys that have a value. A nil wrapped in `Any` is not
                 * a JSON value, so JSONSerialization would have refused the whole
                 * dictionary and the page would have been handed `{}` — a missing
                 * response code reading as success. Every command without a data
                 * phase takes that path.
                 */
                var result: [String: Any] = [:]
                if let response { result["response"] = response.base64EncodedString() }
                if let payload { result["payload"] = payload.base64EncodedString() }
                self?.reply(id, result)
            }
        default:
            reply(id, ["error": "Unknown request \(kind)"])
        }
    }

    private func reply(_ id: Int, _ payload: [String: Any]) {
        let json = (try? JSONSerialization.data(withJSONObject: payload))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        call("window.__ptpReply && window.__ptpReply(\(id), \(json))")
    }

    private func call(_ script: String) {
        DispatchQueue.main.async { [weak self] in self?.webView.evaluateJavaScript(script) }
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
