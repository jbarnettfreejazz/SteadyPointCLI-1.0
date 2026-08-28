// ══════════════════════════════════════════════════════
// MATH / DSP UTILITIES
// Ported directly from steadypoint_v5.html — pure functions,
// no changes needed for React Native.
// ══════════════════════════════════════════════════════

export function mean(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

export function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
}

export function rmsOf(xs, ys, zs) {
  const n = xs.length;
  if (!n) return 0;
  const mx = mean(xs),
    my = mean(ys),
    mz = mean(zs);
  return Math.sqrt(
    xs.reduce((s, v, i) => s + (v - mx) ** 2 + (ys[i] - my) ** 2 + (zs[i] - mz) ** 2, 0) / n,
  );
}

// In-place recursive FFT (Cooley-Tukey), same as original.
export function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  const h = n >> 1,
    reE = [],
    imE = [],
    reO = [],
    imO = [];
  for (let i = 0; i < h; i++) {
    reE.push(re[i * 2]);
    imE.push(im[i * 2]);
    reO.push(re[i * 2 + 1]);
    imO.push(im[i * 2 + 1]);
  }
  fft(reE, imE);
  fft(reO, imO);
  for (let k = 0; k < h; k++) {
    const a = (-2 * Math.PI * k) / n,
      wr = Math.cos(a),
      wi = Math.sin(a);
    const tr = wr * reO[k] - wi * imO[k],
      ti = wr * imO[k] + wi * reO[k];
    re[k] = reE[k] + tr;
    im[k] = imE[k] + ti;
    re[k + h] = reE[k] - tr;
    im[k + h] = imE[k] - ti;
  }
}

export function dominantFreq(signal, sr) {
  let n = 1;
  while (n < signal.length) n <<= 1;
  const re = signal.slice(0, n).concat(new Array(Math.max(0, n - signal.length)).fill(0));
  const im = new Array(n).fill(0);
  fft(re, im);
  let best = -1,
    bestP = 0;
  for (let i = 1; i < n / 2; i++) {
    const f = (i * sr) / n;
    if (f >= 1 && f <= 15) {
      const p = re[i] * re[i] + im[i] * im[i];
      if (p > bestP) {
        bestP = p;
        best = i;
      }
    }
  }
  return best >= 0 ? parseFloat(((best * sr) / n).toFixed(1)) : 0;
}

export function fmt(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// Maps a gravity-free AC-RMS value (see rmsOf() above) to an absolute
// 0-100 tremor intensity level, calibrated against fixed device thresholds
// rather than anything session-relative — so the same physical tremor
// severity always produces the same level, comparable across sessions.
// NOISE_FLOOR_G: below this, the sensor reads as still (level 0).
// FULL_SCALE_G: this RMS value (in units of g) maps to level 100.
const NOISE_FLOOR_G = 0.006;
const FULL_SCALE_G = 0.35;

export function rmsToLevel(rms) {
  if (rms <= NOISE_FLOOR_G) return 0;
  const pct = ((rms - NOISE_FLOOR_G) / (FULL_SCALE_G - NOISE_FLOOR_G)) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)));
}

export function severityInfo(level, colors) {
  if (level < 20) return { label: 'None', color: colors.success };
  if (level < 45) return { label: 'Mild', color: colors.info };
  if (level < 70) return { label: 'Moderate', color: colors.warning };
  return { label: 'High', color: colors.danger };
}

export function orbSize(level, screenWidth) {
  const cap = Math.min(screenWidth * 0.52, 202);
  return Math.min(Math.round(112 + level * 0.9), cap);
}

export function orbRGB(l) {
  const t = l / 100,
    a = [29, 158, 117],
    b = [186, 117, 23];
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}
