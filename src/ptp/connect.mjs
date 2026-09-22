/*
 * Pick the way in.
 *
 * Inside the Mac or iOS app there is a native host and ImageCaptureCore is the
 * only door Apple leaves open. In Chrome on a desktop or on Android there is
 * WebUSB. Everything above this line is the same either way, which was the
 * point of putting the boundary at the transaction.
 */

import { WebUsbTransport, explainUsbError } from './webusb.mjs';
import { NativeTransport, hasNativeBridge } from './native.mjs';

export async function connectTransport() {
  if (hasNativeBridge()) return new NativeTransport().open();
  const transport = await WebUsbTransport.request();
  try {
    await transport.open();
  } catch (error) {
    await transport.close();
    throw error;
  }
  return transport;
}

export function describeConnectionFailure(error) {
  if (hasNativeBridge()) return String(error?.message ?? error);
  return explainUsbError(error);
}

export function transportKind() {
  return hasNativeBridge() ? 'ImageCaptureCore' : 'WebUSB';
}
