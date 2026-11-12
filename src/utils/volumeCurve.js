// Pure (no React, no audio engine) so it's the same on iOS and Android and
// is tested directly (tests/logic/test18.mjs). Used by services/audio.js.

// SIXTY-THIRD follow-up: volume curve. Volume used to rise in a straight
// line with intensity (intensity 10 = 10% of full volume), so on a phone
// speaker anything under about intensity 10 was effectively silent — it
// sounded like a built-in threshold. Now volume follows how loudness is
// heard: a power curve (exponent below 1 lifts the quiet end) starting from
// a minimum volume as soon as the reading is in the zone (intensity > 0).
// Intensity 100 is still the voice's maxGain; 0 is still true silence.
//   intensity:  1     10    34    50    100
//   volume:   ~.18  ~.34  ~.58  ~.70   1.00   (share of maxGain)
// Brightness keeps following intensity in a straight line.
export const VOLUME_MIN_IN_ZONE = 0.12;
export const VOLUME_CURVE_EXP = 0.6;
export function volumeForLevel(norm) {
  if (!(norm > 0)) return 0;
  return VOLUME_MIN_IN_ZONE + (1 - VOLUME_MIN_IN_ZONE) * Math.pow(Math.min(1, norm), VOLUME_CURVE_EXP);
}
// Inverse, for resuming from a volume mid-fade.
export function levelForVolume(v) {
  if (!(v > 0)) return 0;
  if (v <= VOLUME_MIN_IN_ZONE) return 1e-4;
  return Math.pow((Math.min(1, v) - VOLUME_MIN_IN_ZONE) / (1 - VOLUME_MIN_IN_ZONE), 1 / VOLUME_CURVE_EXP);
}
