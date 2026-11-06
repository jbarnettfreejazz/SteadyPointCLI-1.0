// FIFTY-FIFTH follow-up: react-native mock for test13.mjs (sessionService)
const g = globalThis;
export const Platform = { get OS() { return g.__os || 'android'; }, get Version() { return g.__ver ?? 34; } };
export const NativeModules = {
  get SteadyPointSession() {
    if (g.__noModule) return undefined;
    return {
      start: (text) => { g.__native.push(['start', text]); return g.__startFails ? Promise.reject(new Error('boom')) : Promise.resolve(true); },
      stop: () => { g.__native.push(['stop']); return Promise.resolve(true); },
      startCallMonitor: () => { g.__native.push(['monitorStart']); return Promise.resolve(true); },
      stopCallMonitor: () => { g.__native.push(['monitorStop']); return Promise.resolve(true); },
      addListener: () => {}, removeListeners: () => {},
    };
  },
};
export const PermissionsAndroid = {
  PERMISSIONS: { POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS' },
  check: async () => !!g.__granted,
  request: (p) => new Promise((res) => { g.__native.push(['ask', p]); setTimeout(() => res(g.__answer || 'denied'), 20); }),
};
// FIFTY-EIGHTH follow-up: event emitter — tests fire native events with globalThis.__emit(name, data)
export class NativeEventEmitter {
  constructor(mod) { this.mod = mod; g.__emitterCount = (g.__emitterCount || 0) + 1; }
  addListener(name, fn) { (g.__listeners = g.__listeners || []).push([name, fn]); return { remove() {} }; }
}
g.__emit = (name, data) => (g.__listeners || []).filter(([n]) => n === name).forEach(([, fn]) => fn(data));
