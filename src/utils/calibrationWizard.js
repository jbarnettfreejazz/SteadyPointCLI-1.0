// THIRTY-NINTH follow-up: rules for finishing Calibration Mode and turning
// its measurements into settings. Pure functions, so they can be tested
// alone (see CalibrationScreen.js / CalibrationResultsScreen.js).

import { CALIBRATION_FIELDS, CALIBRATION_DEFAULTS } from './calibrationLimits';

// Finish ("100 Level Reached") is only offered after this much recording:
// the frequency-band detector needs 1-second windows that stay consistent
// for 2 seconds (3 s at the very least), plus some margin.
export const MIN_CALIBRATION_SECONDS = 5;

// Below this the recording is treated as "no tremor detected" — the same
// threshold the frequency-band detector uses to ignore quiet windows.
export const MIN_TREMOR_RMS_G = 0.01;

const field = (key) => CALIBRATION_FIELDS.find((f) => f.key === key);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Whether Finish can be offered yet, and why not.
// detector: createSustainedPeakDetector().state(); elapsedSec: recording time.
// Returns { ready, reason: null | 'noTremor' | 'tooShort' }.
export function finishReadiness(detector, elapsedSec) {
  if (!detector?.hasData || detector.fullScaleG == null || detector.fullScaleG < MIN_TREMOR_RMS_G) {
    return { ready: false, reason: 'noTremor' };
  }
  if (elapsedSec < MIN_CALIBRATION_SECONDS) return { ready: false, reason: 'tooShort' };
  return { ready: true, reason: null };
}

// Turns the measurements into the values Results shows and saves.
//   fullScaleG: the detector's fullScaleG
//   band: detectSustainedFrequencyBand() result ({ minHz, maxHz } or null)
//   current: the current settings (band kept as-is when none was detected)
// Values are kept within the Settings > Calibration limits so the saved
// calibration can always be edited there. Returns { fullScaleG,
// fullScaleAdjusted, measuredFullScaleG, tremorBandMinHz, tremorBandMaxHz,
// bandDetected }.
export function calibrationResult({ fullScaleG, band, current = {} }) {
  const fs = field('fullScaleG');
  const minF = field('tremorBandMinHz');
  const maxF = field('tremorBandMaxHz');
  const roundTo = (v, decimals) => Math.round(v * 10 ** decimals) / 10 ** decimals;

  const measured = fullScaleG;
  const savedFs = roundTo(clamp(measured, fs.min, fs.max), fs.decimals);

  let tremorBandMinHz = current.tremorBandMinHz ?? 3;
  let tremorBandMaxHz = current.tremorBandMaxHz ?? 14;
  const bandDetected = !!band && band.minHz != null && band.maxHz != null;
  if (bandDetected) {
    // Measured range plus a 1 Hz margin each side (same as before and as the
    // Flutter app), then kept within the editable limits with at least 1 Hz
    // between them.
    tremorBandMaxHz = roundTo(clamp(band.maxHz + 1, maxF.min, maxF.max), 1);
    tremorBandMinHz = roundTo(clamp(Math.max(0.5, band.minHz - 1), minF.min, Math.min(minF.max, tremorBandMaxHz - 1)), 1);
  }
  return {
    fullScaleG: savedFs,
    measuredFullScaleG: measured,
    fullScaleAdjusted: Math.abs(savedFs - roundTo(measured, fs.decimals)) > 1e-9,
    tremorBandMinHz,
    tremorBandMaxHz,
    bandDetected,
  };
}

// FORTIETH follow-up: "Use default values" on first launch — skips the
// wizard and starts with the app's default calibration (0.35 g full scale,
// 0.006 g noise floor, 3–14 Hz band, band filtering off), which applies
// until the user changes it. Marks first-launch setup as done so the
// wizard doesn't come back; not a wizard calibration (lastCalibratedAt is
// untouched, so no recalibration reminder).
export function defaultCalibrationPatch(now = new Date()) {
  return {
    fullScaleG: CALIBRATION_DEFAULTS.fullScaleG,
    noiseFloorG: CALIBRATION_DEFAULTS.noiseFloorG,
    tremorBandMinHz: CALIBRATION_DEFAULTS.tremorBandMinHz,
    tremorBandMaxHz: CALIBRATION_DEFAULTS.tremorBandMaxHz,
    bandFilterEnabled: CALIBRATION_DEFAULTS.bandFilterEnabled,
    hasCalibrated: true,
    calibrationSource: 'default',
    calibrationSetAt: now.toISOString(),
  };
}
