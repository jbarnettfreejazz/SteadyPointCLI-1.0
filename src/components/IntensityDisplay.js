import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import ScoreRing from './ScoreRing';
import { radii } from '../utils/theme';
import { INTENSITY_BANDS } from '../utils/intensityStats';

// TWENTY-SIXTH follow-up: replaces the SteadyPoint Score ring on Summary and
// Session Detail. `info` is sessionIntensity(...) from utils/intensityStats.

// The session's median intensity in a ring filled to that level (0-100) and
// coloured by its band, with the band name under the number. `animate`
// false shows an empty ring (Summary fills it in after arriving, like the
// old score ring).
export function MedianIntensityRing({ info, c, size = 128, animate = true }) {
  const color = info.valid ? c[info.band.color] : c.bd3;
  return (
    <View style={styles.ringWrap}>
      <ScoreRing
        size={size}
        strokeWidth={7}
        score={info.valid && animate ? info.median : 0}
        color={color}
        trackColor={c.bd3}
        centerLabel={info.valid ? info.median : '—'}
        subLabel={info.valid ? info.band.label.toUpperCase() : 'TOO SHORT'}
        textColor={c.tx1}
        subTextColor={info.valid ? color : c.tx3}
      />
      <Text style={{ fontSize: 12, color: c.tx3, marginTop: 8 }}>Median intensity</Text>
    </View>
  );
}

// Time spent in each band: a single stacked bar plus a legend with the
// percentage for every band (all four, adding up to 100%).
export function TimeInBands({ info, c }) {
  if (!info.valid) return null;
  return (
    <View style={[styles.card, { backgroundColor: c.bg2 }]}>
      <Text style={[styles.title, { color: c.tx3 }]}>TIME IN EACH BAND</Text>
      <View style={[styles.bar, { backgroundColor: c.bd3 }]}>
        {INTENSITY_BANDS.filter((b) => info.pct[b.key] > 0).map((b) => (
          <View key={b.key} style={{ flex: info.pct[b.key], backgroundColor: c[b.color] }} />
        ))}
      </View>
      {INTENSITY_BANDS.map((b) => (
        <View key={b.key} style={styles.legendRow}>
          <View style={[styles.dot, { backgroundColor: c[b.color] }]} />
          <Text style={{ fontSize: 13, color: c.tx1, width: 72 }}>{b.label}</Text>
          <Text style={{ fontSize: 11, color: c.tx3, flex: 1 }}>{b.range}</Text>
          <Text style={{ fontSize: 13, fontWeight: '600', color: c.tx1 }}>{info.pct[b.key]}%</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ringWrap: { alignItems: 'center', marginBottom: 20 },
  card: { borderRadius: radii.lg, padding: 14, marginBottom: 14 },
  title: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginBottom: 10 },
  bar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 12 },
  legendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
});
