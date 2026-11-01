// FIFTY-SECOND follow-up: minimal react-native-ble-plx mock for test10.mjs
export class BleManager {
  startDeviceScan(_u, _o, cb) { globalThis.__scanCb = cb; }
  stopDeviceScan() {}
  destroy() {}
}
