import { BleManager } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { Platform, PermissionsAndroid } from 'react-native';
import { pushPacket } from '../state/liveSession';

// Same Nordic UART Service UUIDs as the original HTML — the M5StickC
// Plus firmware doesn't need to change at all.
export const BLE_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const BLE_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
export const BLE_CMD = '6e400004-b5a3-f393-e0a9-e50e24dcca9e';
const DEVICE_NAME = 'TremorMonitor';

const manager = new BleManager();

let connectedDevice = null;
let notifySubscription = null;

// Android 12+ requires runtime permission for BLE scanning/connecting.
// iOS handles this via Info.plist usage-description strings (see below).
export async function requestBlePermissions() {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version < 31) {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }
  const results = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  ]);
  return (
    results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
    results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
  );
}

// callbacks: { onConnecting, onConnected, onDisconnected, onError }
export async function connectBLE(callbacks = {}) {
  const { onConnecting, onConnected, onDisconnected, onError } = callbacks;

  const hasPerms = await requestBlePermissions();
  if (!hasPerms) {
    onError?.('Bluetooth permission denied.');
    return;
  }

  onConnecting?.();

  manager.startDeviceScan(null, null, async (error, device) => {
    if (error) {
      manager.stopDeviceScan();
      onError?.('Scan error: ' + error.message);
      return;
    }
    if (device?.name === DEVICE_NAME) {
      manager.stopDeviceScan();
      try {
        const connected = await device.connect();
        await connected.discoverAllServicesAndCharacteristics();
        connectedDevice = connected;

        notifySubscription = connected.monitorCharacteristicForService(
          BLE_SERVICE,
          BLE_CHAR,
          (charError, characteristic) => {
            if (charError) return; // fires on disconnect too — handled below
            const raw = Buffer.from(characteristic.value, 'base64').toString('utf-8');
            const pts = raw.split(',').map(Number);
            if (pts.length >= 3 && !pts.some(Number.isNaN)) {
              pushPacket(pts[0], pts[1], pts[2]);
            }
          },
        );

        connected.onDisconnected(() => {
          connectedDevice = null;
          notifySubscription?.remove();
          notifySubscription = null;
          onDisconnected?.();
        });

        onConnected?.();
      } catch (e) {
        onError?.('Connection error: ' + e.message);
      }
    }
  });

  // Give up scanning after 10s if nothing found (mirrors the browser's
  // requestDevice() picker timing out / user cancelling).
  setTimeout(() => {
    if (!connectedDevice) {
      manager.stopDeviceScan();
    }
  }, 10000);
}

export async function disconnectBLE() {
  try {
    notifySubscription?.remove();
    notifySubscription = null;
    if (connectedDevice) {
      await connectedDevice.cancelConnection();
    }
  } catch (e) {
    // ignore — device may already be gone
  }
  connectedDevice = null;
}

export async function sendCommand(cmd) {
  if (!connectedDevice) {
    console.warn('Command characteristic not available');
    return;
  }
  try {
    const base64Cmd = Buffer.from(cmd, 'utf-8').toString('base64');
    await connectedDevice.writeCharacteristicWithResponseForService(BLE_SERVICE, BLE_CMD, base64Cmd);
  } catch (e) {
    console.error('Failed to send command:', e.message);
  }
}

export function isBleConnected() {
  return !!connectedDevice;
}

export function destroyBleManager() {
  manager.destroy();
}
