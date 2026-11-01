import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import DeviceInfo from 'react-native-device-info';

// ══════════════════════════════════════════════════════
// BUNDLED SAMPLES — where the sonification WAVs are read from
// (FIFTY-SECOND follow-up: Android support, round 1)
//
// react-native-audio-api 0.4.18 decodes a sample with miniaudio's
// ma_decoder_init_file(), i.e. a plain fopen() on a filesystem path —
// on both platforms (ios/.../AudioDecoder.mm and
// android/.../AudioDecoder.cpp in the library).
//
// - iOS: the WAVs are loose files inside the app bundle, so
//   `${MainBundlePath}/<file>` is a real path and opens directly.
// - Android: `npx react-native-asset` puts them in the APK's assets
//   (android/app/src/main/assets/custom/). Assets are entries inside the
//   APK, not files on disk — `file:///android_asset/...` only means
//   something to Android's own AssetManager, so fopen() on it fails and
//   every sample-based voice was silent. Here they're copied out of the
//   APK into the app's own storage once (RNFS.copyFileAssets), and the
//   decoder is given that real path.
//
// The copies are refreshed whenever the APK is (re)installed: a marker
// file stores the install's lastUpdateTime, and a mismatch re-copies
// everything — so a changed WAV with an unchanged name still reaches
// the decoder after the next `run-android`, and a new release doesn't
// keep stale copies. First sonification session after an install pays
// the copy once (a second or two); later ones load straight from disk.
// ══════════════════════════════════════════════════════

export const ANDROID_ASSET_DIR = 'custom'; // must match react-native-asset's Android folder
export const SAMPLE_DIR = `${RNFS.DocumentDirectoryPath}/samples`;
const MARKER = `${SAMPLE_DIR}/.installed`;

let preparedFor = null; // install stamp the copies currently match (per app run)
let copying = null; // in-flight copy, shared by the three voices loading at once

async function installStamp() {
  try {
    return String(await DeviceInfo.getLastUpdateTime());
  } catch (e) {
    return 'unknown';
  }
}

// Copies every given file out of the APK unless the copies already match
// this install. Safe to call concurrently — callers share one copy pass.
async function prepareAndroidSamples(fileNames) {
  const stamp = await installStamp();
  if (preparedFor === stamp) return;
  if (copying) return copying;
  copying = (async () => {
    try {
      let current = null;
      if (await RNFS.exists(MARKER)) current = await RNFS.readFile(MARKER, 'utf8');
      const missing = [];
      for (const f of fileNames) {
        if (!(await RNFS.exists(`${SAMPLE_DIR}/${f}`))) missing.push(f);
      }
      if (current === stamp && missing.length === 0) {
        preparedFor = stamp;
        return;
      }
      if (!(await RNFS.exists(SAMPLE_DIR))) await RNFS.mkdir(SAMPLE_DIR);
      // New install (or first run): refresh all, so a changed WAV is never
      // left stale. Same install with a file missing: copy just those.
      const toCopy = current === stamp ? missing : fileNames;
      for (const f of toCopy) {
        const dest = `${SAMPLE_DIR}/${f}`;
        if (await RNFS.exists(dest)) await RNFS.unlink(dest);
        await RNFS.copyFileAssets(`${ANDROID_ASSET_DIR}/${f}`, dest);
      }
      await RNFS.writeFile(MARKER, stamp, 'utf8');
      preparedFor = stamp;
    } finally {
      copying = null;
    }
  })();
  return copying;
}

// Resolves each file name to a plain filesystem path the audio decoder
// can open, preparing the Android copies first. `allFileNames` is every
// sample the app uses, so the first voice to load copies the whole set
// in one pass.
export async function samplePaths(fileNames, allFileNames = fileNames) {
  if (Platform.OS === 'ios') {
    return fileNames.map((f) => `${RNFS.MainBundlePath}/${f}`);
  }
  await prepareAndroidSamples(allFileNames);
  return fileNames.map((f) => `${SAMPLE_DIR}/${f}`);
}

// Tests only: forget what this app run has prepared.
export function __resetForTests() {
  preparedFor = null;
  copying = null;
}
