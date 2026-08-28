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
// ══════════════════════════════════════════════════════

Sound.setCategory('Playback'); // audible even if the phone's silent switch is on — matches a guided-session use case

let currentSound = null;

export function playGuideTrack(fileName) {
  stopGuideTrack(); // clear any previous track first

  const absPath = resolveGuideAudioPath(fileName);
  if (!absPath) return;
  const fileUrl = 'file://' + absPath;

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

export function stopGuideTrack() {
  if (currentSound) {
    const sound = currentSound;
    currentSound = null;
    sound.stop(() => sound.release());
  }
}
