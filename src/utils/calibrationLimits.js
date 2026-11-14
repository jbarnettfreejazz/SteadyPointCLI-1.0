// THIRTY-FIFTH follow-up: the four calibration values users can edit by hand
// on Settings > Calibration, with their allowed ranges and the checks that
// tie them together. Pure functions (no React) so they can be tested alone.

import { DEFAULT_FULL_SCALE_G, DEFAULT_NOISE_FLOOR_G } from './dsp';

// Typical tremor range — values outside it are allowed, with a gentle warning.
export const TYPICAL_TREMOR_MIN_HZ = 3;
export const TYPICAL_TREMOR_MAX_HZ = 12;

// SIXTY-THIRD follow-up: below this, a reading's ~2 s window can't reliably
// tell tremor from slow hand movement. Still allowed (useful for seeing where
// the band sits among all readings), with a note.
export const RELIABLE_BAND_MIN_HZ = 1;

// Smallest gap between the band's minimum and maximum.
export const MIN_BAND_WIDTH_HZ = 1;

// Noise floor can be at most this share of full scale (SIXTY-FIFTH
// follow-up: was strictly under it).
export const MAX_NOISE_FLOOR_SHARE = 0.1;

// SIXTY-FOURTH follow-up: noise floor maximum. With guardrails on (the
// default) it can go up to 0.100 g (was 0.050 g), and at most 10% of full
// scale (SIXTY-FIFTH follow-up: was under 10%). Settings › Calibration ›
// Disable Guardrails (advanced) allows up to
// 10% of full scale itself — at most 0.400 g, since full scale tops out at
// 4.00 g. Turning guardrails back on lowers a floor above 0.100 g to 0.100 g
// (see noiseFloorWithGuardrails()).
export const NOISE_FLOOR_MAX_G = 0.1;
export const NOISE_FLOOR_MAX_UNGUARDED_G = 0.4;

export function guardrailsDisabled(settings) {
  return settings?.calibrationGuardrailsDisabled === true;
}

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
    max: NOISE_FLOOR_MAX_G, // NOISE_FLOOR_MAX_UNGUARDED_G with guardrails disabled
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

// FIFTIETH follow-up: optional upper intensity limit — the sound goes
// silent above it (readings and saved sessions are unaffected). Kept apart
// from CALIBRATION_FIELDS because it's optional (a switch plus a value) and
// only affects the sound.
export const CEILING_FIELD = {
  key: 'intensityCeilingG',
  label: 'Upper limit',
  help: 'Sound goes silent when intensity is above this, so you only hear a middle range. Doesn’t change readings.',
  unit: 'g',
  min: 0.01,
  max: 4,
  step: 0.01,
  decimals: 2,
};

// Starting value when the upper limit is first switched on: full scale.
export function defaultCeilingEntry(settings) {
  const fs = typeof settings?.fullScaleG === 'number' ? settings.fullScaleG : DEFAULT_FULL_SCALE_G;
  return Math.min(CEILING_FIELD.max, Math.max(CEILING_FIELD.min, fs)).toFixed(CEILING_FIELD.decimals);
}

export function formatCeiling(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${value.toFixed(CEILING_FIELD.decimals)} g` : 'Off';
}

// − / + for the upper limit.
export function stepCeiling(text, direction) {
  const f = CEILING_FIELD;
  const current = parseEntry(text);
  const p = 10 ** f.decimals;
  const base = current == null ? (direction > 0 ? f.min - f.step : f.max + f.step) : current;
  const next = Math.min(f.max, Math.max(f.min, Math.round((base + direction * f.step) * p) / p));
  return next.toFixed(f.decimals);
}

// Checks the upper limit entry. enabled false -> always valid (value null).
// It must be above the noise floor (else nothing could ever sound).
// Returns { value, error }.
export function validateCeiling(text, enabled, noiseFloorG) {
  if (!enabled) return { value: null, error: null };
  const f = CEILING_FIELD;
  const n = parseEntry(text);
  if (n == null) return { value: null, error: String(text ?? '').trim() === '' ? 'Enter a value' : 'Enter a number' };
  const p = 10 ** f.decimals;
  const v = Math.round(n * p) / p;
  if (v < f.min || v > f.max) {
    return { value: null, error: `Must be between ${f.min.toFixed(f.decimals)} – ${f.max.toFixed(f.decimals)} g` };
  }
  if (typeof noiseFloorG === 'number' && v <= noiseFloorG) return { value: null, error: 'Must be above the noise floor' };
  return { value: v, error: null };
}

// SIXTY-FOURTH follow-up: the noise floor to save when guardrails are turned
// back on — min(current, 0.100 g). (SIXTY-FIFTH: with "at most 10%" in both
// modes the result is always allowed, so the 64th's exactly-10% adjustment is
// gone.) Returns null when the current floor is already allowed.
export function noiseFloorWithGuardrails(settings) {
  const nf = typeof settings?.noiseFloorG === 'number' ? settings.noiseFloorG : DEFAULT_NOISE_FLOOR_G;
  const next = Math.round(Math.min(nf, NOISE_FLOOR_MAX_G) * 1000) / 1000;
  return Math.abs(next - nf) < 1e-9 ? null : next;
}

export const CALIBRATION_DEFAULTS = {
  fullScaleG: DEFAULT_FULL_SCALE_G,
  noiseFloorG: DEFAULT_NOISE_FLOOR_G,
  tremorBandMinHz: 3,
  tremorBandMaxHz: 14,
  bandFilterEnabled: false,
};

// opts.guardrailsDisabled raises the noise floor's maximum.
const fieldFor = (key, opts) => {
  const f = CALIBRATION_FIELDS.find((x) => x.key === key);
  if (f && key === 'noiseFloorG' && opts?.guardrailsDisabled) return { ...f, max: NOISE_FLOOR_MAX_UNGUARDED_G };
  return f;
};

export function formatValue(key, value) {
  const f = fieldFor(key);
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(f.decimals) : '';
}

// "0.10 – 4.00 g"
export function rangeHint(key, opts) {
  const f = fieldFor(key, opts);
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
export function stepEntry(key, text, direction, opts) {
  const f = fieldFor(key, opts);
  const current = parseEntry(text);
  const base = current == null ? (direction > 0 ? f.min - f.step : f.max + f.step) : current;
  const next = Math.min(f.max, Math.max(f.min, roundToField(key, base + direction * f.step)));
  return formatValue(key, next);
}

// Checks every entry and the rules between them.
// entries: { fullScaleG, noiseFloorG, tremorBandMinHz, tremorBandMaxHz } as typed text.
// opts: { guardrailsDisabled } (SIXTY-FOURTH follow-up).
// Returns { valid, values (rounded numbers, or null where invalid), errors, warnings }
// where errors / warnings map a field key to a short message.
export function validateCalibration(entries, opts) {
  const errors = {};
  const warnings = {};
  const values = {};

  for (const f0 of CALIBRATION_FIELDS) {
    const f = fieldFor(f0.key, opts);
    const n = parseEntry(entries[f.key]);
    if (n == null) {
      errors[f.key] = String(entries[f.key] ?? '').trim() === '' ? 'Enter a value' : 'Enter a number';
      values[f.key] = null;
      continue;
    }
    const v = roundToField(f.key, n);
    if (v < f.min || v > f.max) {
      errors[f.key] = `Must be between ${rangeHint(f.key, opts)}`;
      values[f.key] = null;
      continue;
    }
    values[f.key] = v;
  }

  // Noise floor at most 10% of full scale (which also keeps full scale well
  // above it) — the same rule with or without guardrails. SIXTY-FIFTH
  // follow-up: was strictly under 10% with guardrails on, so a 0.100 g floor
  // at a 1.00 g full scale was refused.
  if (values.fullScaleG != null && values.noiseFloorG != null) {
    const limit = Math.round(values.fullScaleG * MAX_NOISE_FLOOR_SHARE * 1000) / 1000;
    if (values.noiseFloorG > limit + 1e-9) {
      errors.noiseFloorG = `Must be at most 10% of full scale (${limit.toFixed(3)} g or less)`;
    }
  }

  // Band minimum at least 1 Hz below the maximum.
  if (values.tremorBandMinHz != null && values.tremorBandMaxHz != null) {
    if (values.tremorBandMinHz > values.tremorBandMaxHz - MIN_BAND_WIDTH_HZ + 1e-9) {
      errors.tremorBandMinHz = `Must be at least ${MIN_BAND_WIDTH_HZ} Hz below the maximum`;
    }
  }

  // Gentle warnings outside the typical tremor range (still allowed).
  if (!errors.tremorBandMinHz && values.tremorBandMinHz != null && values.tremorBandMinHz < RELIABLE_BAND_MIN_HZ) {
    warnings.tremorBandMinHz = `Below ${RELIABLE_BAND_MIN_HZ} Hz, slow hand movement can't be reliably told apart from tremor, so readings near this edge may be unreliable.`;
  } else if (!errors.tremorBandMinHz && values.tremorBandMinHz != null && values.tremorBandMinHz < TYPICAL_TREMOR_MIN_HZ) {
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
// Returns { scale: bool (full scale / noise floor), band: bool (band or filter),
// ceiling: bool (upper limit) }.
export function describeChanges(settings, values, bandFilterEnabled, ceilingG) {
  const differs = (key) => roundToField(key, settings?.[key] ?? CALIBRATION_DEFAULTS[key]) !== values[key];
  return {
    scale: differs('fullScaleG') || differs('noiseFloorG'),
    band: differs('tremorBandMinHz') || differs('tremorBandMaxHz') || !!settings?.bandFilterEnabled !== !!bandFilterEnabled,
    // FIFTIETH follow-up: upper limit changed (only when one is passed).
    ceiling: ceilingG !== undefined && (settings?.intensityCeilingG ?? null) !== ceilingG,
  };
}
