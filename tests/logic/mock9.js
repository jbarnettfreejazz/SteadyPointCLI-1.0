// FIFTY-SECOND follow-up: in-memory react-native / react-native-fs / device-info mock for test9.mjs
export const Platform = { get OS() { return globalThis.__os || 'ios'; } };
export const Share = { share: async (o) => { (globalThis.__shares = globalThis.__shares || []).push(o); } };
const files = (globalThis.__files = globalThis.__files || new Map());
const dirs = (globalThis.__dirs = globalThis.__dirs || new Set());
const tick = () => new Promise((r) => setTimeout(r, 1));
const RNFS = {
  DocumentDirectoryPath: '/data/docs',
  MainBundlePath: '/bundle/SteadyPointCLI.app',
  exists: async (p) => { await tick(); return files.has(p) || dirs.has(p); },
  mkdir: async (p) => { dirs.add(p); },
  unlink: async (p) => { files.delete(p); },
  readFile: async (p) => { if (!files.has(p)) throw new Error('ENOENT ' + p); return files.get(p); },
  writeFile: async (p, s) => { files.set(p, s); },
  appendFile: async (p, s) => { files.set(p, (files.get(p) || '') + s); },
  copyFileAssets: async (a, dest) => {
    await tick();
    (globalThis.__copies = globalThis.__copies || []).push(a);
    const assets = globalThis.__assets || {};
    if (!(a in assets)) throw new Error('Asset not found: ' + a);
    files.set(dest, assets[a]);
  },
};
export default RNFS;
export const getLastUpdateTime = async () => globalThis.__installTime ?? 1000;
