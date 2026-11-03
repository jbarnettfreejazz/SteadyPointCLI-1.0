// FIFTY-FOURTH follow-up: react-native mock for test12.mjs (react-native-sound on RN 0.81)
const calls = (globalThis.__rnsound = []);
export const NativeModules = {
  RNSound: {
    IsAndroid: false,
    IsWindows: false,
    prepare: (path, key, options, cb) => { calls.push(['prepare', path, key]); cb(null, { duration: 12.5, numberOfChannels: 2 }); },
    setCategory: (...a) => calls.push(['setCategory', ...a]),
    enable: () => {},
  },
};
export class NativeEventEmitter { addListener() { return { remove() {} }; } }
export const Image = { resolveAssetSource: (src) => (typeof src === 'number' ? { uri: 'asset://' + src } : null) };
export const Platform = { OS: 'ios' };
