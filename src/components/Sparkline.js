import React from 'react';
import Svg, { Polyline } from 'react-native-svg';

// Ported from buildWavePoints() in the original — normalizes a data series
// against a shared min/max range (so X/Y/Z stay comparable to each other)
// and maps each point to an SVG polyline coordinate.
function buildWavePoints(data, w, h, minV, maxV) {
  const range = Math.max(maxV - minV, 0.0001);
  const n = data.length;
  if (n < 2) return '';
  return data
    .map((v, i) => {
      const x = Math.round((i / (n - 1)) * w);
      const y = Math.round(h - ((v - minV) / range) * h);
      return `${x},${y}`;
    })
    .join(' ');
}

export default function Sparkline({ dataX, dataY, dataZ, width = 330, height = 44, colors }) {
  const all = [...dataX, ...dataY, ...dataZ];
  const minV = Math.min(...all);
  const maxV = Math.max(...all);

  const ptsX = buildWavePoints(dataX, width, height, minV, maxV);
  const ptsY = buildWavePoints(dataY, width, height, minV, maxV);
  const ptsZ = buildWavePoints(dataZ, width, height, minV, maxV);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <Polyline
        points={ptsX}
        fill="none"
        stroke={colors.danger}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
      <Polyline points={ptsY} fill="none" stroke={colors.info} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <Polyline
        points={ptsZ}
        fill="none"
        stroke={colors.success}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
    </Svg>
  );
}
