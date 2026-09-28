import React, { useId } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path, Line, Text as SvgText } from 'react-native-svg';

// Ported from the team's PWA IntensityChart.tsx — a filled area chart of
// tremor intensity (0-100) over the session duration, color-segmented by
// severity band via a vertical gradient: None (<20, success), Mild
// (20-44), Moderate (45-69, warning), High (70+, danger). Geometry and
// gradient-stop math translated directly (unchanged) from the PWA
// original; only the rendering layer changed, from raw web SVG elements
// to their react-native-svg equivalents, and CSS color variables to this
// app's own theme colors.
export default function IntensityChart({ trace, durationSec, height = 140, colors }) {
  const gid = useId().replace(/:/g, '');
  const W = 320;
  const H = height;
  const padL = 26;
  const padR = 8;
  const padT = 8;
  const padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  if (!trace || trace.length < 2) {
    return (
      <View style={[styles.emptyBox, { backgroundColor: colors.bg2 }]}>
        <Text style={{ fontSize: 12, color: colors.tx3 }}>Not enough data to draw a session trace.</Text>
      </View>
    );
  }

  const n = trace.length;
  const x = (i) => padL + (i / (n - 1)) * innerW;
  const y = (v) => padT + innerH * (1 - Math.min(100, Math.max(0, v)) / 100);

  const line = trace.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

  // Gradient stops are positioned top (level 100) to bottom (level 0).
  const stop = (level) => `${(100 - level).toFixed(0)}%`;

  const mins = Math.max(1, Math.round(durationSec / 60));

  return (
    <View style={[styles.container, { backgroundColor: colors.bg2 }]}>
      <Text style={[styles.eyebrow, { color: colors.tx3 }]}>INTENSITY OVER SESSION</Text>
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <Defs>
          <LinearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={colors.danger} stopOpacity="0.55" />
            <Stop offset={stop(70)} stopColor={colors.danger} stopOpacity="0.5" />
            <Stop offset={stop(70)} stopColor={colors.warning} stopOpacity="0.45" />
            <Stop offset={stop(45)} stopColor={colors.warning} stopOpacity="0.4" />
            <Stop offset={stop(45)} stopColor={colors.warning} stopOpacity="0.32" />
            <Stop offset={stop(20)} stopColor={colors.success} stopOpacity="0.3" />
            <Stop offset="100%" stopColor={colors.success} stopOpacity="0.12" />
          </LinearGradient>
          <LinearGradient id={`stroke-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={colors.danger} />
            <Stop offset={stop(70)} stopColor={colors.danger} />
            <Stop offset={stop(70)} stopColor={colors.warning} />
            <Stop offset={stop(45)} stopColor={colors.warning} />
            <Stop offset={stop(45)} stopColor={colors.success} />
            <Stop offset="100%" stopColor={colors.success} />
          </LinearGradient>
        </Defs>

        {[0, 20, 45, 70, 100].map((lv) => (
          <React.Fragment key={lv}>
            <Line
              x1={padL}
              x2={W - padR}
              y1={y(lv)}
              y2={y(lv)}
              stroke={colors.bd3}
              strokeWidth="0.5"
              strokeDasharray={lv === 0 ? undefined : '2 3'}
            />
            <SvgText x={padL - 6} y={y(lv) + 3} textAnchor="end" fontSize="8" fill={colors.tx3}>
              {lv}
            </SvgText>
          </React.Fragment>
        ))}

        <Path d={area} fill={`url(#fill-${gid})`} />
        <Path d={line} fill="none" stroke={`url(#stroke-${gid})`} strokeWidth="1.6" strokeLinejoin="round" />

        <SvgText x={padL} y={H - 5} fontSize="8" fill={colors.tx3}>
          0:00
        </SvgText>
        <SvgText x={W - padR} y={H - 5} fontSize="8" fill={colors.tx3} textAnchor="end">
          {mins} min
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, paddingTop: 12, paddingHorizontal: 8, paddingBottom: 4 },
  eyebrow: { fontSize: 10, letterSpacing: 0.7, marginBottom: 6, marginLeft: 18 },
  emptyBox: { borderRadius: 12, padding: 16 },
});
