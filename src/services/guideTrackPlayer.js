import { Platform } from 'react-native';
import Sound from 'react-native-sound';
import { resolveGuideAudioPath } from './guideAudioPicker';

// ══════════════════════════════════════════════════════
// GUIDE TRACK PLAYER
// Plays the user-selected guide audio file during a session.
//
// This is deliberately separate from src/services/audio.js (the tremor
// sonification, which needs a Web-Audio-style graph for real-time
// oscillator control). Guide tracks are just "play this file in the
// background" — react-native-sound wraps the native AVAudioPlayer
// (iOS) / MediaPlayer (Android), which streams from disk and starts
// near-instantly regardless of file length. The earlier approach used
// react-native-audio-api's decodeAudioDataSource(), which decodes the
// ENTIRE file into raw PCM before playback can begin — fine for short
// clips, but a 20+ minute guide track meant a 30-second wait before any
// sound played, even though most of that decoded audio would never be
// heard once the session (and its shorter duration) ended anyway.
//
// Path handling note: this takes a plain FILENAME (see guideAudioPicker.js
// for why — absolute paths go stale across app reinstalls), resolves it to
// today's actual absolute path, then prefixes it with "file://". Do NOT
// percent-encode the path ourselves — react-native-sound 0.11.2's native
// code (RNSound.m) calls `stringByAddingPercentEscapesUsingEncoding:` on
// whatever string we hand it before constructing the NSURL. Pre-encoding
// here as well caused double-encoding (a space became "%20", which then
// got re-escaped into "%2520"), pointing at a path that doesn't exist —
// which is exactly what produced the generic "unsupported file type" error
// even though the file itself was fine.
//
// FIFTY-NINTH follow-up (Android): the path is passed WITHOUT "file://".
// Android's MediaPlayer reads a file:// string as a URI, so a "#" in the
// file name ("Cello Suite #1.m4a") started a URI fragment and cut the path
// short -> "resource not found". A plain absolute path is opened as-is, any
// characters included. iOS keeps the file:// form above (RNSound.m escapes
// it). See guideTrackSource().
// ══════════════════════════════════════════════════════

// What to hand react-native-sound for an absolute path on this platform.
export function guideTrackSource(absPath, os = Platform.OS) {
  return os === 'android' ? absPath : 'file://' + absPath;
}

Sound.setCategory('Playback'); // audible even if the phone's silent switch is on — matches a guided-session use case

let currentSound = null;

export function playGuideTrack(fileName) {
  stopGuideTrack(); // clear any previous track first

  const absPath = resolveGuideAudioPath(fileName);
  if (!absPath) return;
  const fileUrl = guideTrackSource(absPath);

  const sound = new Sound(fileUrl, undefined, (error) => {
    if (error) {
      console.warn('playGuideTrack failed to load:', error.message || error);
      return;
    }
    // Only start playback if this is still the current track — guards
    // against a race if stopGuideTrack() was called while loading.
    if (currentSound === sound) {
      sound.play((success) => {
        if (!success) console.warn('playGuideTrack: playback did not complete successfully');
      });
    }
  });

  currentSound = sound;
}

// FIFTY-EIGHTH follow-up: paused during a phone/video call (Android call
// monitor, via sessionLogic) and resumed from the same point afterwards.
let pausedForCall = false;

export function pauseGuideTrackForCall() {
  if (!currentSound || pausedForCall) return;
  pausedForCall = true;
  currentSound.pause();
}

export function resumeGuideTrackAfterCall() {
  if (!pausedForCall) return;
  pausedForCall = false;
  if (!currentSound) return; // ended or stopped during the call
  currentSound.play((success) => {
    if (!success) console.warn('playGuideTrack: playback did not complete successfully');
  });
}

export function stopGuideTrack() {
  pausedForCall = false;
  if (currentSound) {
    const sound = currentSound;
    currentSound = null;
    sound.stop(() => sound.release());
  }
}
