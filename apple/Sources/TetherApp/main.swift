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
        camera.requestSendPTPCommand(command, outData: outData) { response, payload, error in
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

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let bridge = CameraBridge()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let controller = WKUserContentController()
        controller.add(self, name: "ptp")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: configuration)
        // The page is under active development; never serve it from a cache.
        webView.configuration.websiteDataStore = .nonPersistent()

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

        let address = ProcessInfo.processInfo.environment["TETHER_URL"] ?? "https://tether.halfstop.app"
        webView.load(URLRequest(url: URL(string: address)!))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

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
        case "transact":
            guard let commandText = body["command"] as? String,
                  let command = Data(base64Encoded: commandText) else {
                reply(id, ["error": "The page sent a command that was not base64."])
                return
            }
            let outData = (body["outData"] as? String).flatMap { Data(base64Encoded: $0) }
            bridge.transact(command: command, outData: outData) { [weak self] response, payload, error in
                if let error { self?.reply(id, ["error": error]); return }
                self?.reply(id, [
                    "response": response?.base64EncodedString() as Any,
                    "payload": payload?.base64EncodedString() as Any,
                ])
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
