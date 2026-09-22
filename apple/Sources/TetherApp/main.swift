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
        if sessionOpen { done(true, nil); return }
        waitingForSession = done
        camera.requestOpenSession()
    }

    func closeSession() {
        guard sessionOpen else { return }
        camera?.requestCloseSession()
        sessionOpen = false
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
        camera.requestSendPTPCommand(command, outData: outData) { payload, response, error in
            if let error = error as NSError? {
                let hint = error.code == -21249 ? " (PTPNotAuthorizedToSendCommand)" : ""
                done(nil, nil, "\(error.localizedDescription)\(hint)")
            } else {
                done(response, payload, nil)
            }
        }
    }

    // MARK: Delegates

    func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        guard let found = device as? ICCameraDevice else { return }
        camera = found
        found.delegate = self
        onStatus?("Found \(found.name ?? "a camera").")
    }

    func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {
        if device === camera { camera = nil; sessionOpen = false; onStatus?("The camera went away.") }
    }

    func device(_ device: ICDevice, didOpenSessionWithError error: (any Error)?) {
        sessionOpen = error == nil
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
    func deviceDidBecomeReady(_ device: ICDevice) {}
    func deviceDidBecomeReady(withCompleteContentCatalog device: ICCameraDevice) {}
    func device(_ device: ICDevice, didCloseSessionWithError error: (any Error)?) { sessionOpen = false }
}

// MARK: - The window

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let bridge = CameraBridge()
    private var address = ""
    private var waitingForServer = false

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
        bridge.onStatus = { text in FileHandle.standardError.write(Data("\(text)\n".utf8)) }
        bridge.start()

        /*
         * Where the interface comes from. The deployed site by default, which
         * means a change here is not a change there until it ships — so say
         * plainly which one is loaded, in the title bar and on the way past.
         * For a fast loop, run `npm run web` and set TETHER_URL.
         */
        address = ProcessInfo.processInfo.environment["TETHER_URL"] ?? "https://tether.halfstop.app"
        let local = address.contains("localhost") || address.contains("127.0.0.1")
        window.title = local ? "Halfstop Tether — local" : "Halfstop Tether — deployed"
        FileHandle.standardError.write(Data("Loading \(address)\n".utf8))
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
