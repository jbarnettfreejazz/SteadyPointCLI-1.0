import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

// Ported from the original's score-ring markup (renderHome/renderSummary/
// renderSessionDetail): a background track circle + a foreground circle
// whose stroke-dasharray/stroke-dashoffset reveals a fraction of the ring,
// rotated -90deg so the fill starts at 12 o'clock and sweeps clockwise.
export default function ScoreRing({
  size = 84,
  strokeWidth = 5,
  score = 0,
  color,
  trackColor,
  centerLabel,
  subLabel,
  textColor,
  subTextColor,
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference * (1 - clamped / 100);
  const center = size / 2;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={center} cy={center} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          rotation="-90"
          origin={`${center}, ${center}`}
        />
      </Svg>
      {(centerLabel !== undefined || subLabel) && (
        <View style={styles.overlay} pointerEvents="none">
          {centerLabel !== undefined && (
            <Text style={[styles.centerLabel, { color: textColor, fontSize: size * 0.21 }]}>{centerLabel}</Text>
          )}
          {subLabel ? (
            <Text style={[styles.subLabel, { color: subTextColor, fontSize: size * 0.105 }]}>{subLabel}</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerLabel: { fontWeight: '500' },
  subLabel: { letterSpacing: 0.4, marginTop: 2 },
});
