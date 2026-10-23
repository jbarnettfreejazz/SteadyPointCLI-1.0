// THIRTY-FIFTH follow-up: the four calibration values users can edit by hand
// on Settings > Calibration, with their allowed ranges and the checks that
// tie them together. Pure functions (no React) so they can be tested alone.

import { DEFAULT_FULL_SCALE_G, DEFAULT_NOISE_FLOOR_G } from './dsp';

// Typical tremor range — values outside it are allowed, with a gentle warning.
export const TYPICAL_TREMOR_MIN_HZ = 3;
export const TYPICAL_TREMOR_MAX_HZ = 12;

// Smallest gap between the band's minimum and maximum.
export const MIN_BAND_WIDTH_HZ = 1;

// Noise floor must stay under this share of full scale.
export const MAX_NOISE_FLOOR_SHARE = 0.1;

export const CALIBRATION_FIELDS = [
  {
    key: 'fullScaleG',
    label: 'Full scale range',
    help: 'Motion that reads as intensity 100. Lower values are more sensitive.',
    unit: 'g',
    min: 0.1,
    max: 4,
    step: 0.01,
    decimals: 2,
  },
  {
    key: 'noiseFloorG',
    label: 'Noise floor',
    help: 'Motion at or below this reads as intensity 0.',
    unit: 'g',
    min: 0,
    max: 0.05,
    step: 0.001,
    decimals: 3,
  },
  {
    key: 'tremorBandMinHz',
    label: 'Minimum tremor band',
    help: 'Lowest tremor frequency counted when band filtering is on.',
    unit: 'Hz',
    min: 0.5,
    max: 18,
    step: 0.1,
    decimals: 1,
  },
  {
    key: 'tremorBandMaxHz',
    label: 'Maximum tremor band',
    help: 'Highest tremor frequency counted when band filtering is on.',
    unit: 'Hz',
    min: 1.5,
    max: 20,
    step: 0.1,
    decimals: 1,
  },
];

export const CALIBRATION_DEFAULTS = {
  fullScaleG: DEFAULT_FULL_SCALE_G,
  noiseFloorG: DEFAULT_NOISE_FLOOR_G,
  tremorBandMinHz: 3,
  tremorBandMaxHz: 14,
  bandFilterEnabled: false,
};

const fieldFor = (key) => CALIBRATION_FIELDS.find((f) => f.key === key);

export function formatValue(key, value) {
  const f = fieldFor(key);
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(f.decimals) : '';
}

// "0.10 – 4.00 g"
export function rangeHint(key) {
  const f = fieldFor(key);
  return `${f.min.toFixed(f.decimals)} – ${f.max.toFixed(f.decimals)} ${f.unit}`;
}

// A typed entry -> number, or null if it isn't a plain non-negative number
// ("1.", ".5", "0.25" are fine; "", "-1", "1e3", "abc", "1.2.3" are not).
export function parseEntry(text) {
  const t = String(text ?? '').trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Rounds to the field's step precision (what actually gets saved).
export function roundToField(key, value) {
  const f = fieldFor(key);
  const p = 10 ** f.decimals;
  return Math.round(value * p) / p;
}

// − / + buttons: one step from the typed value (or from the nearest limit
// if the entry is empty/invalid), kept within the field's range.
export function stepEntry(key, text, direction) {
  const f = fieldFor(key);
  const current = parseEntry(text);
  const base = current == null ? (direction > 0 ? f.min - f.step : f.max + f.step) : current;
  const next = Math.min(f.max, Math.max(f.min, roundToField(key, base + direction * f.step)));
  return formatValue(key, next);
}

// Checks every entry and the rules between them.
// entries: { fullScaleG, noiseFloorG, tremorBandMinHz, tremorBandMaxHz } as typed text.
// Returns { valid, values (rounded numbers, or null where invalid), errors, warnings }
// where errors / warnings map a field key to a short message.
export function validateCalibration(entries) {
  const errors = {};
  const warnings = {};
  const values = {};

  for (const f of CALIBRATION_FIELDS) {
    const n = parseEntry(entries[f.key]);
    if (n == null) {
      errors[f.key] = String(entries[f.key] ?? '').trim() === '' ? 'Enter a value' : 'Enter a number';
      values[f.key] = null;
      continue;
    }
    const v = roundToField(f.key, n);
    if (v < f.min || v > f.max) {
      errors[f.key] = `Must be between ${rangeHint(f.key)}`;
      values[f.key] = null;
      continue;
    }
    values[f.key] = v;
  }

  // Noise floor under 10% of full scale (which also keeps full scale above it).
  if (values.fullScaleG != null && values.noiseFloorG != null) {
    const limit = values.fullScaleG * MAX_NOISE_FLOOR_SHARE;
    if (values.noiseFloorG >= limit) {
      errors.noiseFloorG = `Must be under 10% of full scale (under ${limit.toFixed(3)} g)`;
    }
  }

  // Band minimum at least 1 Hz below the maximum.
  if (values.tremorBandMinHz != null && values.tremorBandMaxHz != null) {
    if (values.tremorBandMinHz > values.tremorBandMaxHz - MIN_BAND_WIDTH_HZ + 1e-9) {
      errors.tremorBandMinHz = `Must be at least ${MIN_BAND_WIDTH_HZ} Hz below the maximum`;
    }
  }

  // Gentle warnings outside the typical tremor range (still allowed).
  if (!errors.tremorBandMinHz && values.tremorBandMinHz != null && values.tremorBandMinHz < TYPICAL_TREMOR_MIN_HZ) {
    warnings.tremorBandMinHz = `Below the typical tremor range (${TYPICAL_TREMOR_MIN_HZ}–${TYPICAL_TREMOR_MAX_HZ} Hz)`;
  }
  if (!errors.tremorBandMaxHz && values.tremorBandMaxHz != null && values.tremorBandMaxHz > TYPICAL_TREMOR_MAX_HZ) {
    warnings.tremorBandMaxHz = `Above the typical tremor range (${TYPICAL_TREMOR_MIN_HZ}–${TYPICAL_TREMOR_MAX_HZ} Hz)`;
  }

  return { valid: Object.keys(errors).length === 0, values, errors, warnings };
}

// The entries to start editing from: the saved settings, formatted.
export function entriesFromSettings(settings) {
  const out = {};
  for (const f of CALIBRATION_FIELDS) {
    const v = settings?.[f.key];
    out[f.key] = formatValue(f.key, typeof v === 'number' ? v : CALIBRATION_DEFAULTS[f.key]);
  }
  return out;
}

// What a save would change, for the confirmation message.
// Returns { scale: bool (full scale / noise floor), band: bool (band or filter) }.
export function describeChanges(settings, values, bandFilterEnabled) {
  const differs = (key) => roundToField(key, settings?.[key] ?? CALIBRATION_DEFAULTS[key]) !== values[key];
  return {
    scale: differs('fullScaleG') || differs('noiseFloorG'),
    band: differs('tremorBandMinHz') || differs('tremorBandMaxHz') || !!settings?.bandFilterEnabled !== !!bandFilterEnabled,
  };
}
