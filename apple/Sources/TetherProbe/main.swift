//
//  TetherProbe — ask a camera what it is, through ImageCaptureCore.
//
//  WebUSB cannot claim a camera on macOS: the system refuses with "Access
//  denied (insufficient permissions)" on a device nothing else holds. That is
//  not a bug to route around. On Apple's platforms ImageCaptureCore *is* the
//  camera layer, and asking it is the supported path — the same one the iOS
//  app will take, since requestSendPTPCommand exists on both.
//
//  So this is not a macOS detour. It is the production path, tested early.
//
//  Build and run (needs Xcode command line tools, no developer account):
//
//      xcode-select --install          # once, if you have not
//      swiftc -O TetherProbe.swift -o tether-probe
//      ./tether-probe
//
//  The first run may prompt for permission to control the camera. Allow it.
//

import Foundation
import ImageCaptureCore

// MARK: - PTP containers, the same shape as src/ptp/codec.mjs

enum PTP {
    static let getDeviceInfo: UInt16 = 0x1001
    static let getDevicePropDesc: UInt16 = 0x1014
    static let exposureProgramMode: UInt32 = 0x500E
    static let fNumber: UInt32 = 0x5007

    /// A command container: length, type 1, opcode, transaction id, parameters.
    static func command(_ opcode: UInt16, transaction: UInt32 = 0, params: [UInt32] = []) -> Data {
        var data = Data()
        let length = UInt32(12 + params.count * 4)
        data.append(littleEndian: length)
        data.append(littleEndian: UInt16(1))
        data.append(littleEndian: opcode)
        data.append(littleEndian: transaction)
        for param in params { data.append(littleEndian: param) }
        return data
    }
}

extension Data {
    mutating func append<T: FixedWidthInteger>(littleEndian value: T) {
        var little = value.littleEndian
        Swift.withUnsafeBytes(of: &little) { append(contentsOf: $0) }
    }

    /// Enough of a hex dump to compare against what the JS codec produces.
    func hexPreview(_ limit: Int = 64) -> String {
        let shown = prefix(limit).map { String(format: "%02x", $0) }.joined(separator: " ")
        return count > limit ? "\(shown) … (\(count) bytes)" : "\(shown) (\(count) bytes)"
    }

    /// PTP strings: a character count including the terminator, then UTF-16LE.
    func ptpString(at offset: inout Int) -> String {
        guard offset < count else { return "" }
        let chars = Int(self[startIndex + offset]); offset += 1
        guard chars > 0 else { return "" }
        var scalars: [UInt16] = []
        for index in 0..<(chars - 1) {
            let base = startIndex + offset + index * 2
            guard base + 1 < endIndex else { break }
            scalars.append(UInt16(self[base]) | (UInt16(self[base + 1]) << 8))
        }
        offset += chars * 2
        return String(decoding: scalars, as: UTF16.self)
    }
}

// MARK: - The probe

final class Probe: NSObject, ICDeviceBrowserDelegate, ICCameraDeviceDelegate {
    private let browser = ICDeviceBrowser()
    private var camera: ICCameraDevice?
    private var finished = false

    func run() {
        browser.delegate = self
        browser.browsedDeviceTypeMask = ICDeviceTypeMask(
            rawValue: ICDeviceTypeMask.camera.rawValue | ICDeviceLocationTypeMask.local.rawValue)!
        browser.start()
        say("Looking for a camera. Plug it in and switch it on.")

        // Delegate callbacks need a run loop, and a probe that hangs forever
        // tells you less than one that gives up and says so.
        let deadline = Date().addingTimeInterval(45)
        while !finished && Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.2))
        }
        if !finished { say("\nNo camera answered within 45 seconds.") }
        browser.stop()
    }

    func say(_ text: String) { print(text); fflush(stdout) }

    // MARK: Finding it

    func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        guard let camera = device as? ICCameraDevice else { return }
        self.camera = camera
        camera.delegate = self

        say("\nFound: \(camera.name ?? "unnamed")")
        say("  transport      \(camera.transportType ?? "unknown")")
        say("  capabilities   \(camera.capabilities.map { "\($0)" }.joined(separator: ", "))")

        // The gate on everything below. Apple documents that every PTP camera
        // has it, so if it is missing that is the finding.
        /*
         * capabilities is an array of String while the constant is an
         * ICDeviceCapability, so they cannot be compared directly and the
         * bridging differs by SDK. Matching the printed form sidesteps both:
         * the capability is spelled ICCameraDeviceCanAcceptPTPCommands, and
         * the full list is printed above anyway, so a wrong guess here is
         * visible rather than silent.
         */
        let canSendPTP = camera.capabilities.contains { "\($0)".contains("PTP") }
        say("  accepts PTP    \(canSendPTP ? "yes" : "NO — the rest of this will not work")")

        camera.requestOpenSession()
    }

    func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {}

    // MARK: Talking to it

    func device(_ device: ICDevice, didOpenSessionWithError error: (any Error)?) {
        if let error {
            say("\nCould not open a session: \(error.localizedDescription)")
            finished = true
            return
        }
        say("\nSession open. Sending GetDeviceInfo (0x1001)…")
        sendDeviceInfo()
    }

    private func sendDeviceInfo() {
        guard let camera else { finished = true; return }
        let command = PTP.command(PTP.getDeviceInfo)
        say("  command bytes  \(command.hexPreview())")

        camera.requestSendPTPCommand(command, outData: nil) { [weak self] ptpResponse, payload, error in
            guard let self else { return }
            self.report(label: "GetDeviceInfo", ptpResponse: ptpResponse, payload: payload, error: error)
            if error == nil { self.sendPropDesc(PTP.exposureProgramMode, named: "ExposureProgramMode") }
            else { self.finished = true }
        }
    }

    private func sendPropDesc(_ code: UInt32, named: String) {
        guard let camera else { finished = true; return }
        let command = PTP.command(PTP.getDevicePropDesc, transaction: 1, params: [code])
        say("\nSending GetDevicePropDesc for \(named) (0x\(String(code, radix: 16)))…")

        camera.requestSendPTPCommand(command, outData: nil) { [weak self] ptpResponse, payload, error in
            guard let self else { return }
            self.report(label: named, ptpResponse: ptpResponse, payload: payload, error: error)
            if code == PTP.exposureProgramMode {
                self.sendPropDesc(PTP.fNumber, named: "FNumber")
            } else {
                self.say("\nDone. Send this whole output back.")
                self.camera?.requestCloseSession()
                self.finished = true
            }
        }
    }

    /// Print everything, because the shape of what comes back is the point.
    /*
     * The first parameter is the PTP response container and the second is the
     * data payload — the reverse of what the names suggested. Proven by the
     * first decoding as twelve bytes of type 3, code 0x2001, OK.
     */
    private func report(label: String, ptpResponse: Data?, payload: Data?, error: (any Error)?) {
        say("  [\(label)]")
        if let error = error as NSError? {
            say("    ERROR \(error.code): \(error.localizedDescription)")
            if error.code == -21249 {
                say("    That is PTPNotAuthorizedToSendCommand — the one unknown that")
                say("    could reshape the iOS half. Worth knowing now rather than later.")
            }
            return
        }
        say("    response  \(ptpResponse?.hexPreview() ?? "none")")
        say("    payload   \(payload?.hexPreview() ?? "none")")

        // GetDeviceInfo carries the model and firmware; decoding it here proves
        // the bytes are the PTP payload rather than something Apple wraps.
        if label == "GetDeviceInfo", let payload, payload.count > 24 {
            decodeDeviceInfo(payload)
        }
    }

    private func decodeDeviceInfo(_ data: Data) {
        var offset = 0
        func u16() -> UInt16 {
            defer { offset += 2 }
            guard data.startIndex + offset + 1 < data.endIndex else { return 0 }
            return UInt16(data[data.startIndex + offset]) | (UInt16(data[data.startIndex + offset + 1]) << 8)
        }
        func u32() -> UInt32 { let low = UInt32(u16()); return low | (UInt32(u16()) << 16) }
        func skipArray() { let count = Int(u32()); offset += count * 2 }

        _ = u16()                       // standard version
        _ = u32()                       // vendor extension id
        _ = u16()                       // vendor extension version
        _ = data.ptpString(at: &offset) // vendor extension description
        _ = u16()                       // functional mode
        let opsStart = offset
        let opCount = Int(u32()); offset = opsStart; skipArray()
        skipArray()                     // events
        let propsAt = offset
        let propCount = Int(u32()); offset = propsAt; skipArray()
        skipArray()                     // capture formats
        skipArray()                     // image formats
        let manufacturer = data.ptpString(at: &offset)
        let model = data.ptpString(at: &offset)
        let version = data.ptpString(at: &offset)

        say("    decoded   \(manufacturer) \(model), firmware \(version)")
        say("              \(opCount) operations, \(propCount) properties")
        say("              (if that reads as a camera, the payload is raw PTP)")
    }

    // MARK: The event stream, which turns out to be free

    /// Apple requires this, which means it hands over raw PTP events — the
    /// same 0x90C7-shaped notifications the mirroring design needs to know a
    /// hand has moved a dial. Worth seeing what arrives unprompted.
    func cameraDevice(_ camera: ICCameraDevice, didReceivePTPEvent eventData: Data) {
        say("  [event] \(eventData.hexPreview(24))")
    }

    // MARK: Required stubs

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
    func device(_ device: ICDevice, didCloseSessionWithError error: (any Error)?) {}
}

Probe().run()
