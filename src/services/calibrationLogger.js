import RNFS from 'react-native-fs';
import { Share, Platform } from 'react-native';

// File-based calibration logging — console.log() alone isn't useful once
// this ships to TestFlight: there's no Metro/debugger attached to a
// Release build to receive that output, so it either goes nowhere
// visible, or at best to the device's low-level system log, which would
// require connecting a tester's physical phone to a Mac with Xcode to
// view (the same way we retrieved an earlier crash log) — not realistic
// for a remote tester. Writing to an actual file the user can share via
// the share sheet (iOS: AirDrop, email, Files; Android: shared as text) is the only
// practical way to get this data back from someone who isn't the
// developer.
const LOG_FILE_PATH = `${RNFS.DocumentDirectoryPath}/calibration-log.txt`;

// Tracks whether we've confirmed the file exists yet *this app session*,
// to avoid an RNFS.exists() check on every single log call — this gets
// called as often as every ~300ms during Active Calibration, so avoiding
// an extra async round-trip per call matters. Resets to false on a fresh
// app launch; the first call after that correctly re-checks and appends
// to whatever's already on disk from a previous session, rather than
// overwriting it.
let fileConfirmedToExist = false;

// Fire-and-forget by design — callers (especially the ~300ms live poll
// loop in CalibrationScreen.js) should not await this or have it add any
// latency/backpressure to their own work. A failed write is logged as a
// console warning but never surfaces to the user or interrupts
// calibration itself.
export function logCalibration(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  const write = fileConfirmedToExist
    ? RNFS.appendFile(LOG_FILE_PATH, line, 'utf8')
    : RNFS.exists(LOG_FILE_PATH).then((exists) =>
        exists ? RNFS.appendFile(LOG_FILE_PATH, line, 'utf8') : RNFS.writeFile(LOG_FILE_PATH, line, 'utf8'),
      );
  write.then(() => (fileConfirmedToExist = true)).catch((e) => console.warn('calibration log write failed:', e.message));
}

// Whether a log file exists yet at all — lets calling UI disable/hide a
// "Share Log" action until there's actually something to share.
export async function calibrationLogExists() {
  return RNFS.exists(LOG_FILE_PATH);
}

// Opens the share sheet with the log. Uses React Native's own built-in
// Share API (not a third-party package).
// - iOS: shares the file itself — Share's `url` option supports local
//   file:// URLs on iOS.
// - Android (FIFTY-SECOND follow-up): Share ignores `url` and only sends
//   `message`, so the file link produced an empty share. The log's text is
//   shared instead (email, Drive, messaging apps all take it). Android
//   passes shared text through a size-limited system channel, so a very
//   long log is cut to its most recent ANDROID_SHARE_MAX_CHARS characters,
//   with a note saying so; the file on the phone is untouched.
export const ANDROID_SHARE_MAX_CHARS = 100000; // ~200 KB as UTF-16, well under the ~1 MB limit

export function androidShareText(text, max = ANDROID_SHARE_MAX_CHARS) {
  if (text.length <= max) return text;
  const tail = text.slice(text.length - max);
  const firstLine = tail.indexOf('\n');
  const kept = firstLine >= 0 ? tail.slice(firstLine + 1) : tail; // start on a whole line
  return `[SteadyPoint calibration log — earlier lines left out; showing the most recent part]\n${kept}`;
}

export async function shareCalibrationLog() {
  const exists = await RNFS.exists(LOG_FILE_PATH);
  if (!exists) {
    throw new Error('No calibration log yet — run a calibration first.');
  }
  if (Platform.OS === 'android') {
    const text = await RNFS.readFile(LOG_FILE_PATH, 'utf8');
    await Share.share({ title: 'SteadyPoint calibration log', message: androidShareText(text) });
    return;
  }
  await Share.share({ url: `file://${LOG_FILE_PATH}` });
}

// Deletes the log file — lets a user start a clean log before a new
// round of testing, rather than the file only ever growing.
export async function clearCalibrationLog() {
  const exists = await RNFS.exists(LOG_FILE_PATH);
  if (exists) await RNFS.unlink(LOG_FILE_PATH);
  fileConfirmedToExist = false;
}
