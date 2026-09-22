/*
 * PTP over WebUSB.
 *
 * Browsers may claim a USB interface unless its class is on WebUSB's protected
 * list — audio, video, HID, mass storage, smart card, hubs, wireless. Still
 * imaging, class 0x06, is not on it, which is why a camera can be driven from
 * a web page at all.
 *
 * Not on iOS: Safari has no WebUSB, and every iOS browser is Safari underneath.
 * Chrome on desktop and on Android, which covers the desk and one of the two
 * shipping targets.
 */

export const IMAGE_CLASS = 0x06;

export class WebUsbTransport {
  constructor(device) {
    this.device = device;
    this.endpointIn = null;
    this.endpointOut = null;
    this.interfaceNumber = null;
    /* Cameras answer in chunks of the endpoint's packet size; ask for plenty. */
    this.readSize = 512 * 1024;
  }

  /** Ask the viewer to pick a camera. Must be called from a click. */
  static async request() {
    if (!navigator.usb) throw new Error('This browser has no WebUSB. Chrome or Edge on desktop or Android.');
    const device = await navigator.usb.requestDevice({ filters: [{ classCode: IMAGE_CLASS }] });
    return new WebUsbTransport(device);
  }

  static async alreadyPaired() {
    if (!navigator.usb) return [];
    const devices = await navigator.usb.getDevices();
    return devices.map((d) => new WebUsbTransport(d));
  }

  async open() {
    await this.device.open();
    if (!this.device.configuration) await this.device.selectConfiguration(1);

    /* Find the still-imaging interface and its bulk endpoints. */
    for (const iface of this.device.configuration.interfaces) {
      for (const alt of iface.alternates) {
        if (alt.interfaceClass !== IMAGE_CLASS) continue;
        const bulkIn = alt.endpoints.find((e) => e.direction === 'in' && e.type === 'bulk');
        const bulkOut = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
        if (!bulkIn || !bulkOut) continue;
        this.interfaceNumber = iface.interfaceNumber;
        this.endpointIn = bulkIn.endpointNumber;
        this.endpointOut = bulkOut.endpointNumber;
      }
    }
    if (this.interfaceNumber == null) {
      throw new Error('No still-imaging interface with bulk endpoints on this device.');
    }
    await this.device.claimInterface(this.interfaceNumber);
    return this;
  }

  async send(bytes) {
    const result = await this.device.transferOut(this.endpointOut, bytes);
    if (result.status !== 'ok') throw new Error(`USB write ${result.status}`);
  }

  async receive() {
    const result = await this.device.transferIn(this.endpointIn, this.readSize);
    if (result.status !== 'ok') throw new Error(`USB read ${result.status}`);
    return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
  }

  async close() {
    try { if (this.interfaceNumber != null) await this.device.releaseInterface(this.interfaceNumber); } catch { /* already gone */ }
    try { await this.device.close(); } catch { /* already gone */ }
  }

  get name() {
    return [this.device.manufacturerName, this.device.productName].filter(Boolean).join(' ') || 'USB camera';
  }
}

/** Why a connection failed, in words rather than a DOMException. */
export function explainUsbError(error) {
  const text = String(error?.message ?? error);
  if (/No device selected/i.test(text)) return 'No camera was chosen.';
  if (/protected class/i.test(text)) return 'The browser refused this interface as a protected class. That should not happen for a camera — check it is in PTP mode rather than mass storage.';
  if (/Unable to claim|access denied|SecurityError/i.test(text)) {
    /*
     * On macOS the holder is ptpcamerad, which launchd restarts on demand.
     * Disabling only stops it loading next time, so the useful instruction is
     * to check it is actually gone rather than to run a command and hope —
     * which is how this failed twice before it was written down.
     */
    return [
      'Something else is holding the camera.',
      '',
      'On macOS three daemons can hold it, not one. Run these, and read the last line:',
      '  sudo launchctl disable system/com.apple.ptpcamerad',
      '  sudo launchctl disable system/com.apple.cameracaptured',
      '  sudo killall -9 ptpcamerad cameracaptured mscamerad-xpc 2>/dev/null; sleep 1',
      '  ps -ax -o comm | grep -icE "ptpcamerad|cameracaptured|mscamerad"',
      '',
      'A count of 0 means the port is free. Then RELOAD this page and connect again —',
      'a reload matters, because a half-open device from a failed attempt holds it too.',
      'Do not run "launchctl enable" until you have finished with the camera.',
      'Also close any other tab of this app: only one page can hold the camera.',
      '',
      'On Linux, stop gvfs-gphoto2-volume-monitor instead.',
      '',
      `What the browser actually said: ${text}`,
    ].join('\n');
  }
  if (/no WebUSB/i.test(text)) return text;
  return text;
}

/**
 * Claiming can fail for reasons that have nothing to do with the daemon, and
 * the interface should say which. Reported separately so a wrong guess about
 * the cause never hides what the browser actually reported.
 */
export function usbDiagnostics(device) {
  if (!device) return null;
  const configuration = device.configuration;
  return {
    product: [device.manufacturerName, device.productName].filter(Boolean).join(' '),
    vendorId: `0x${device.vendorId?.toString(16).padStart(4, '0')}`,
    productId: `0x${device.productId?.toString(16).padStart(4, '0')}`,
    opened: device.opened,
    configured: Boolean(configuration),
    interfaces: (configuration?.interfaces ?? []).map((iface) => ({
      number: iface.interfaceNumber,
      claimed: iface.claimed,
      classes: iface.alternates.map((a) => `0x${a.interfaceClass.toString(16).padStart(2, '0')}`),
      endpoints: iface.alternates.flatMap((a) => a.endpoints.map((e) => `${e.direction}/${e.type}`)),
    })),
  };
}
