import { NativeModules, NativeEventEmitter, Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ══════════════════════════════════════════════════════
// SESSION SERVICE (Android) — FIFTY-FIFTH follow-up
//
// While a session runs, Android keeps SteadyPoint alive through a foreground
// service (android/app/src/main/java/com/steadypointcli/
// SessionForegroundService.kt): BLE readings, the session clock and the
// sound keep going with the screen off or another app open, and an ongoing
// "SteadyPoint session in progress" notification shows. Without it, Android
// (Samsung especially) pauses or stops a background app after a while.
//
// startSessionService() at session start/resume, stopSessionService() at
// every end. iOS: no-ops (its background modes cover this, 16th/18th
// follow-ups). Neither ever throws or blocks the session.
//
// Notification permission (Android 13+): asked once, at the first session
// start — the moment it matters. If declined the service still runs; Android
// just doesn't show its notification. Not asked again (the user can turn it
// on in the phone's Settings).
//
// Calls are queued in order, so a session that ends while the permission
// dialog is still open stops the service after it started, never before.
// ══════════════════════════════════════════════════════

export const NOTIFICATION_ASKED_KEY = 'steadypoint.notificationPermissionAsked';
export const CALL_STATE_EVENT = 'SteadyPointCallState';

// FIFTY-EIGHTH follow-up: phone/video calls (Android 12+). The native module
// watches the phone's audio mode while a session runs (startCallMonitor,
// started with the service, stopped with it) and reports { inCall }; the
// handler set by sessionLogic quiets the sound and pauses the guide track
// until the call ends. Other apps' audio is not affected (it keeps mixing).
let callHandler = null;
let callSubscription = null;

export function onCallStateChange(handler) {
  callHandler = handler || null;
}

function ensureCallSubscription(mod) {
  if (callSubscription) return;
  try {
    const emitter = new NativeEventEmitter(mod);
    callSubscription = emitter.addListener(CALL_STATE_EVENT, (e) => {
      try {
        callHandler?.(!!e?.inCall);
      } catch (err) {
        console.warn('[sessionService] call handler:', err?.message || err);
      }
    });
  } catch (e) {
    console.warn('[sessionService] call events unavailable:', e?.message || e);
  }
}

let queue = Promise.resolve();

function nativeModule() {
  return Platform.OS === 'android' ? NativeModules.SteadyPointSession || null : null;
}

// Second line of the notification: the session type.
export function sessionNotificationText(config) {
  const minutes = config && Number(config.duration);
  return minutes > 0 ? `${minutes}-minute session` : 'Continuous session';
}

async function askNotificationPermissionOnce() {
  if (Platform.OS !== 'android' || Platform.Version < 33) return;
  const perm = PermissionsAndroid.PERMISSIONS?.POST_NOTIFICATIONS;
  if (!perm) return;
  if (await PermissionsAndroid.check(perm)) return;
  if (await AsyncStorage.getItem(NOTIFICATION_ASKED_KEY)) return;
  await AsyncStorage.setItem(NOTIFICATION_ASKED_KEY, '1');
  await PermissionsAndroid.request(perm);
}

export function startSessionService(config) {
  const mod = nativeModule();
  if (!mod) return Promise.resolve(false);
  const text = sessionNotificationText(config);
  queue = queue.then(async () => {
    try {
      await askNotificationPermissionOnce();
    } catch (e) {
      console.warn('[sessionService] notification permission:', e?.message || e);
    }
    let started = false;
    try {
      started = !!(await mod.start(text));
    } catch (e) {
      console.warn('[sessionService] start failed:', e?.message || e);
    }
    try {
      ensureCallSubscription(mod);
      await mod.startCallMonitor?.();
    } catch (e) {
      console.warn('[sessionService] call monitor:', e?.message || e);
    }
    return started;
  });
  return queue;
}

export function stopSessionService() {
  const mod = nativeModule();
  if (!mod) return Promise.resolve(false);
  queue = queue.then(async () => {
    try {
      await mod.stopCallMonitor?.();
    } catch (e) {
      console.warn('[sessionService] call monitor stop:', e?.message || e);
    }
    try {
      return !!(await mod.stop());
    } catch (e) {
      console.warn('[sessionService] stop failed:', e?.message || e);
      return false;
    }
  });
  return queue;
}

// Tests only.
export function __resetForTests() {
  queue = Promise.resolve();
  callHandler = null;
  callSubscription = null;
}
